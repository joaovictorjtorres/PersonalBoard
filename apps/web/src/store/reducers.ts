import {
  LOCK_TTL_MS,
  PING_DURATION_MS,
  UNDO_LIMIT,
  applyTurnOp,
  canClearLayer,
  clearTargets,
  defaultTurns,
  insertLayer,
  isObjectOp,
  isTurnOp,
  mergeSettings,
  moveLayer,
  sortLayers,
  type AppliedOp,
  type ClearObjectsOp,
  type Layer,
  type Member,
  type Op,
  type RejectReason,
  type Role,
  type ServerMessage,
  type TableObject,
} from '@mesa/shared'
import type { ConnStatus } from '../sync/SyncClient'
import { chatRejectText, reduceChatEntry } from './chat'
import { ackTurnOp, recomputeTurns } from './turns'
import { applyLocalOp, objectOpsOf, opTargetId } from './localOps'
import { batchInverse, inverseGroupOf } from './undo'
import { NO_SELECTION, type LocalPrev, type PendingOp, type TableState, type Toast } from './state'

const REJECT_TEXT: Record<RejectReason, string> = {
  invalid: 'Ação inválida',
  not_found: 'O objeto não existe mais',
  exists: 'Esse objeto já existe',
  locked: 'Outra pessoa está mexendo nesse objeto',
  forbidden: 'Sem permissão nessa camada',
}

export function rejectText(op: Op, reason: RejectReason, layerGone = false): string {
  if (isTurnOp(op)) return reason === 'forbidden' ? 'Só o mestre pode fazer isso' : 'Não foi possível mudar a ordem de turnos'
  if (op.kind === 'clearObjects') {
    if (reason === 'forbidden') return 'Sem permissão para apagar nessa camada'
    return 'Não foi possível apagar'
  }
  if (op.kind === 'settingsUpdate' || op.kind === 'memberUpdate') {
    if (reason === 'forbidden') return 'Só o mestre pode fazer isso'
    if (reason === 'not_found') return 'Essa pessoa não está mais na lista'
  }
  // a camada sumiu no meio da ação: o servidor responde not_found, mas o que vale para o usuário é a permissão
  if (reason === 'not_found' && layerGone) return REJECT_TEXT.forbidden
  if (reason === 'forbidden') {
    if (op.kind === 'memberRemove') return 'Não dá para remover quem está online'
    if (op.kind === 'layerDelete') return 'Essa camada não pode ser removida'
    if (op.kind === 'layerMove') return 'A camada não pode ir para lá'
  }
  return REJECT_TEXT[reason]
}

let toastSeq = 0
let pingSeq = 0

export function addToast<S extends TableState>(s: S, text: string, action?: Toast['action']): S {
  // um lote recusado (ex.: borracha) não empilha o mesmo aviso várias vezes
  if (!action && s.toasts.some((t) => t.text === text && !t.action)) return s
  return { ...s, toasts: [...s.toasts, { id: ++toastSeq, text, action }] }
}

export function reduceStatus<S extends TableState>(s: S, status: ConnStatus): S {
  return s.status === status ? s : { ...s, status }
}

export function isLockedByOther(s: TableState, objectId: string, now: number): boolean {
  const lock = s.locks[objectId]
  return !!lock && lock.clientId !== s.self?.clientId && lock.expiresAt > now
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

function reapplyPending(
  objects: Record<string, TableObject>,
  pending: Record<string, PendingOp>,
  selfId: string,
  onlyId?: string,
): Record<string, TableObject> {
  let out = objects
  for (const p of Object.values(pending)) {
    for (const op of objectOpsOf(p.op)) {
      if (onlyId === undefined || opTargetId(op) === onlyId) out = applyLocalOp(out, op, selfId)
    }
  }
  return out
}

export function applyLayerOp(layers: Layer[], op: Op): Layer[] {
  switch (op.kind) {
    case 'layerCreate':
      return layers.some((l) => l.id === op.layer.id) ? layers : insertLayer(layers, op.layer)
    case 'layerUpdate':
      return layers.map((l) => (l.id === op.id ? { ...l, ...op.patch } : l))
    case 'layerDelete':
      return layers.filter((l) => l.id !== op.id)
    case 'layerMove':
      return moveLayer(layers, op.id, op.direction) ?? layers
    default:
      return layers
  }
}

function isLayerOp(op: Op): boolean {
  return op.kind === 'layerCreate' || op.kind === 'layerUpdate' || op.kind === 'layerMove' || op.kind === 'layerDelete'
}

function setNote(notes: Record<string, string>, objectId: string, text: string): Record<string, string> {
  return text === '' ? omit(notes, objectId) : { ...notes, [objectId]: text }
}

/** Atualiza o membro na lista e, se for eu, o apelido e a cor do `self`. */
function withMember<S extends TableState>(s: S, member: Member): S {
  const self = s.self && s.self.clientId === member.clientId ? { ...s.self, nickname: member.nickname, color: member.color } : s.self
  return { ...s, self, members: { ...s.members, [member.clientId]: member } }
}

function upsertLayer(layers: Layer[], layer: Layer): Layer[] {
  return sortLayers([...layers.filter((l) => l.id !== layer.id), layer])
}

/** Camada visível (para jogadores) de maior order; senão a de maior order. */
export function topLayerId(layers: Layer[]): string {
  const sorted = sortLayers(layers)
  const visible = sorted.filter((l) => l.visibility === 'all')
  return (visible.at(-1) ?? sorted.at(-1))?.id ?? ''
}

/** Camada em que eu posso desenhar: o jogador não usa camada oculta (nem a recebe) nem travada. */
export function canUseLayer(layer: Layer, role: Role | undefined): boolean {
  return canClearLayer(layer, role ?? 'player')
}

/**
 * A camada ativa continua se ainda posso usá-la; senão vai para a permitida mais próxima (pela posição
 * que a ativa tinha em `prev`; empate: a de cima). Sem nenhuma permitida, fica onde está se ainda existe.
 */
export function pickActiveLayer(prev: Layer[], next: Layer[], activeId: string, role: Role | undefined): string {
  const current = next.find((l) => l.id === activeId)
  if (current && canUseLayer(current, role)) return activeId
  const allowed = sortLayers(next).filter((l) => canUseLayer(l, role))
  if (allowed.length === 0) return current ? activeId : topLayerId(next)
  const order = (current ?? prev.find((l) => l.id === activeId))?.order
  if (order === undefined) return topLayerId(allowed)
  let best = allowed[0]
  for (const l of allowed) if (Math.abs(l.order - order) <= Math.abs(best.order - order)) best = l
  return best.id
}

function replayLayerOp(layers: Layer[], op: Op, orders: Record<string, number> | null): Layer[] {
  if (op.kind === 'layerMove' && orders) return sortLayers(layers.map((l) => (l.id in orders ? { ...l, order: orders[l.id] } : l)))
  return applyLayerOp(layers, op)
}

/** layers = confirmadas + ops de camada pendentes, em ordem de envio. */
function recomputeLayers<S extends TableState>(s: S, pending: Record<string, PendingOp> = s.pending): S {
  let layers = s.confirmedLayers
  for (const p of Object.values(pending)) layers = replayLayerOp(layers, p.op, p.layerOrders)
  return withActiveLayer({ ...s, layers }, s.layers)
}

/** `prev`: as camadas antes da mudança, para achar a vizinha mais próxima da ativa que sumiu. */
function withActiveLayer<S extends TableState>(s: S, prev: Layer[]): S {
  const activeLayerId = pickActiveLayer(prev, s.layers, s.activeLayerId, s.self?.role)
  if (activeLayerId === s.activeLayerId) return s
  // A camada ativa mudou: a seleção em área só sobrevive com "Todas as camadas".
  return { ...s, activeLayerId, selectedId: null, ...(s.selectAllLayers ? {} : NO_SELECTION) }
}

/** Tira objetos (e o que depende deles) do estado local. */
function withoutObjects<S extends TableState>(s: S, ids: ReadonlySet<string>): S {
  if (ids.size === 0) return s
  const keep = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => !ids.has(id)))
  return {
    ...s,
    objects: keep(s.objects),
    notes: keep(s.notes),
    locks: keep(s.locks),
    dragPreviews: keep(s.dragPreviews),
    ownDragPreviews: keep(s.ownDragPreviews),
    deniedGrabs: keep(s.deniedGrabs),
    selectedId: s.selectedId && ids.has(s.selectedId) ? null : s.selectedId,
    objectMenu: s.objectMenu && ids.has(s.objectMenu.objectId) ? null : s.objectMenu,
  }
}

function clearIds(s: TableState, op: ClearObjectsOp): Set<string> {
  if (!s.self) return new Set()
  return new Set(clearTargets(Object.values(s.objects), s.layers, op, s.self).map((o) => o.id))
}

/**
 * Desfazer não pode tentar mexer em objeto que a limpeza apagou: ops de update/delete para eles saem
 * da pilha (grupos que ficam vazios também). A limpeza em si não entra na pilha — o aviso é a proteção.
 * Dentro de um lote inverso, saem as sub-ações que citam os apagados, e também a recriação `from` de
 * um pedaço apagado (o servidor a recusaria sem o pedaço); lote que fica vazio sai.
 */
export function pruneUndoStack(stack: Op[][], gone: ReadonlySet<string>): Op[][] {
  const touchesGone = (op: Op): boolean => {
    if (op.kind === 'update' || op.kind === 'delete') return gone.has(op.id)
    if (op.kind === 'create') return op.from !== undefined && gone.has(op.from)
    return op.kind === 'batch' && op.ops.some(touchesGone)
  }
  const prune = (op: Op): Op | null => {
    if (op.kind !== 'batch') return touchesGone(op) ? null : op
    const ops = op.ops.filter((sub) => !touchesGone(sub))
    return ops.length === 0 ? null : ops.length === op.ops.length ? op : { ...op, ops }
  }
  if (!stack.some((group) => group.some(touchesGone))) return stack
  return stack
    .map((group) => group.map(prune).filter((op): op is Op => op !== null))
    .filter((group) => group.length > 0)
}

function withoutLayer<S extends TableState>(s: S, layerId: string): S {
  const gone = new Set(Object.values(s.objects).filter((o) => o.layerId === layerId).map((o) => o.id))
  const keep = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => !gone.has(id)))
  return withActiveLayer({
    ...s,
    layers: s.layers.filter((l) => l.id !== layerId),
    objects: keep(s.objects),
    notes: keep(s.notes),
    locks: keep(s.locks),
    dragPreviews: keep(s.dragPreviews),
    deniedGrabs: keep(s.deniedGrabs),
    strokePreviews: Object.fromEntries(Object.entries(s.strokePreviews).filter(([, p]) => p.layerId !== layerId)),
    selectedId: s.selectedId && gone.has(s.selectedId) ? null : s.selectedId,
  }, s.layers)
}

function applyOptimistic<S extends TableState>(
  s: S,
  op: Op,
): { next: S; before: TableObject | null; prev: LocalPrev | null; layerOrders: Record<string, number> | null } {
  if (isObjectOp(op)) {
    const targetId = opTargetId(op)
    return {
      next: {
        ...s,
        objects: applyLocalOp(s.objects, op, s.self?.clientId ?? ''),
        selectedId: op.kind === 'delete' && s.selectedId === targetId ? null : s.selectedId,
      },
      before: s.objects[targetId] ?? null,
      prev: null,
      layerOrders: null,
    }
  }
  // Turnos: a reversão é recalcular a partir de confirmedTurns (não há `prev`).
  if (isTurnOp(op)) return { next: { ...s, turns: applyTurnOp(s.turns, op) ?? s.turns }, before: null, prev: null, layerOrders: null }
  switch (op.kind) {
    case 'layerCreate':
    case 'layerUpdate':
    case 'layerMove': {
      const layers = applyLayerOp(s.layers, op)
      let layerOrders: Record<string, number> | null = null
      if (op.kind === 'layerMove') {
        const old = new Map(s.layers.map((l) => [l.id, l.order]))
        layerOrders = Object.fromEntries(layers.filter((l) => old.get(l.id) !== l.order).map((l) => [l.id, l.order]))
      }
      return {
        next: withActiveLayer({ ...s, layers }, s.layers),
        before: null,
        prev: { kind: 'layers', layers: s.layers, objects: [], notes: {} },
        layerOrders,
      }
    }
    case 'layerDelete': {
      const objects = Object.values(s.objects).filter((o) => o.layerId === op.id)
      const notes = Object.fromEntries(objects.filter((o) => s.notes[o.id] !== undefined).map((o) => [o.id, s.notes[o.id]]))
      return { next: withoutLayer(s, op.id), before: null, prev: { kind: 'layers', layers: s.layers, objects, notes }, layerOrders: null }
    }
    case 'noteSet':
      return {
        next: { ...s, notes: setNote(s.notes, op.objectId, op.text.trim() === '' ? '' : op.text) },
        before: null,
        prev: { kind: 'note', objectId: op.objectId, text: s.notes[op.objectId] ?? null },
        layerOrders: null,
      }
    case 'memberRemove':
      return {
        next: { ...s, members: omit(s.members, op.clientId) },
        before: null,
        prev: { kind: 'member', member: s.members[op.clientId] ?? null },
        layerOrders: null,
      }
    case 'settingsUpdate':
      return {
        next: { ...s, settings: mergeSettings(s.settings, op.patch) },
        before: null,
        prev: { kind: 'settings', settings: s.settings },
        layerOrders: null,
      }
    case 'memberUpdate': {
      const member = s.members[op.clientId]
      return {
        next: member ? withMember(s, { ...member, ...op.patch }) : s,
        before: null,
        prev: { kind: 'member', member: member ?? null },
        layerOrders: null,
      }
    }
    case 'clearObjects': {
      const ids = clearIds(s, op)
      const objects = Object.values(s.objects).filter((o) => ids.has(o.id))
      const notes = Object.fromEntries(objects.filter((o) => s.notes[o.id] !== undefined).map((o) => [o.id, s.notes[o.id]]))
      return { next: withoutObjects(s, ids), before: null, prev: { kind: 'objects', objects, notes }, layerOrders: null }
    }
    case 'batch': {
      const selfId = s.self?.clientId ?? ''
      const before: Record<string, TableObject | null> = {}
      let objects = s.objects
      for (const sub of op.ops) {
        const id = opTargetId(sub)
        if (!(id in before)) before[id] = s.objects[id] ?? null
        objects = applyLocalOp(objects, sub, selfId)
      }
      const selectedId = s.selectedId && !objects[s.selectedId] ? null : s.selectedId
      return { next: { ...s, objects, selectedId }, before: null, prev: { kind: 'batch', before }, layerOrders: null }
    }
    default: {
      const unreachable: never = op
      return unreachable
    }
  }
}

// Desfaz localmente o que a op recusada tinha mudado (fora das camadas, que são recalculadas).
function revertLocal<S extends TableState>(s: S, p: PendingOp): S {
  const prev = p.prev
  if (!prev) return s
  switch (prev.kind) {
    case 'layers': {
      // camadas são recalculadas a partir da base confirmada; aqui só voltam objetos e anotações de um layerDelete
      const objects = { ...s.objects }
      for (const o of prev.objects) objects[o.id] = o
      return { ...s, objects, notes: { ...s.notes, ...prev.notes } }
    }
    case 'note':
      return { ...s, notes: setNote(s.notes, prev.objectId, prev.text ?? '') }
    case 'member':
      return prev.member ? withMember(s, prev.member) : s
    case 'settings':
      return { ...s, settings: prev.settings }
    case 'objects': {
      const objects = { ...s.objects }
      for (const o of prev.objects) objects[o.id] = o
      return { ...s, objects, notes: { ...s.notes, ...prev.notes } }
    }
    case 'batch':
      // tratado em rejectBatch
      return s
  }
}

function settleGroup<S extends TableState>(s: S, p: PendingOp, inverse: Op[] | null): S {
  if (!p.group) return s
  const group = s.undoGroups[p.group.id]
  if (!group) return s
  const inverses = [...group.inverses]
  inverses[p.group.index] = inverse
  const settled = group.settled + 1
  if (settled < inverses.length) return { ...s, undoGroups: { ...s.undoGroups, [p.group.id]: { inverses, settled } } }
  const ops = inverses.filter((i): i is Op[] => i !== null).reverse().flat()
  return {
    ...s,
    undoGroups: omit(s.undoGroups, p.group.id),
    undoStack: ops.length > 0 ? [...s.undoStack, ops].slice(-UNDO_LIMIT) : s.undoStack,
  }
}

function inverseOfApplied(op: Op, applied: { before: TableObject | null; prev: LocalPrev | null }, role: Role | undefined): Op[] | null {
  if (op.kind === 'batch') return applied.prev?.kind === 'batch' ? batchInverse(op, applied.prev.before, role) : null
  return inverseGroupOf(op, applied.before, role)
}

/** Lote recusado: os objetos dele voltam ao estado de antes, com as outras ops pendentes por cima. */
function rejectBatch<S extends TableState>(s: S, opId: string, p: PendingOp, reason: RejectReason): S {
  const pending = omit(s.pending, opId)
  const before = p.prev?.kind === 'batch' ? p.prev.before : {}
  let objects = { ...s.objects }
  for (const [id, o] of Object.entries(before)) {
    if (o) objects[id] = o
    else delete objects[id]
  }
  const selfId = s.self?.clientId ?? ''
  for (const id of Object.keys(before)) objects = reapplyPending(objects, pending, selfId, id)
  const next = settleGroup({ ...s, pending, objects }, p, null)
  // Lote recusado: a seleção em área é desfeita.
  return addToast({ ...next, ...NO_SELECTION }, p.isUndo ? 'Não foi possível desfazer' : (p.failText ?? rejectText(p.op, reason)))
}

export function reduceSubmitBatch<S extends TableState>(
  s: S,
  items: Array<{ opId: string; op: Op }>,
  opts: { isUndo: boolean; groupId: string; failText?: string },
): S {
  let next = s
  const pending = { ...s.pending }
  items.forEach(({ opId, op }, index) => {
    const applied = applyOptimistic(next, op)
    next = applied.next
    pending[opId] = {
      op,
      before: applied.before,
      prev: applied.prev,
      layerOrders: applied.layerOrders,
      isUndo: opts.isUndo,
      inverse: opts.isUndo ? null : inverseOfApplied(op, applied, s.self?.role),
      group: opts.isUndo ? null : { id: opts.groupId, index },
      ...(opts.failText ? { failText: opts.failText } : {}),
    }
  })
  const undoGroups =
    opts.isUndo || items.length === 0
      ? next.undoGroups
      : { ...next.undoGroups, [opts.groupId]: { inverses: items.map(() => null), settled: 0 } }
  return { ...next, pending, undoGroups }
}

export function reduceSubmit<S extends TableState>(s: S, opId: string, op: Op, opts: { isUndo: boolean }): S {
  return reduceSubmitBatch(s, [{ opId, op }], { isUndo: opts.isUndo, groupId: opId })
}

/** Um upsert/delete vindo do servidor (op avulsa ou item de um lote). */
function applyServerOp<S extends TableState>(s: S, op: AppliedOp, selfId: string): S {
  if (op.kind === 'upsert') {
    const object = op.object
    const objects = reapplyPending({ ...s.objects, [object.id]: object }, s.pending, selfId, object.id)
    return { ...s, objects, dragPreviews: omit(s.dragPreviews, object.id) }
  }
  const id = op.id
  return {
    ...s,
    objects: omit(s.objects, id),
    notes: omit(s.notes, id),
    dragPreviews: omit(s.dragPreviews, id),
    locks: omit(s.locks, id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  }
}

export function reduceServer<S extends TableState>(s: S, msg: ServerMessage, now: number): S {
  const selfId = s.self?.clientId ?? ''

  switch (msg.t) {
    case 'welcome': {
      const snap = msg.snapshot
      const objects = reapplyPending(Object.fromEntries(snap.objects.map((o) => [o.id, o])), s.pending, msg.self.clientId)
      const layers = sortLayers(snap.layers)
      const pendingLayers = recomputeLayers({ ...s, confirmedLayers: layers }).layers
      const preferred = pendingLayers.some((l) => l.id === s.activeLayerId)
        ? s.activeLayerId
        : layers.some((l) => l.id === 'tokens')
          ? 'tokens'
          : topLayerId(pendingLayers)
      const activeLayerId = pickActiveLayer(s.layers, pendingLayers, preferred, msg.self.role)
      const base: S = {
        ...s,
        status: 'open',
        fatal: null,
        self: msg.self,
        meta: snap.meta,
        layers: pendingLayers,
        confirmedLayers: layers,
        objects,
        notes: snap.notes,
        members: Object.fromEntries(snap.members.map((m) => [m.clientId, m])),
        locks: Object.fromEntries(snap.locks.map((l) => [l.objectId, { clientId: l.clientId, expiresAt: now + LOCK_TTL_MS }])),
        cursors: {},
        dragPreviews: {},
        strokePreviews: {},
        deniedGrabs: {},
        settings: snap.settings,
        rulers: {},
        groupDrags: {},
        ownRuler: null,
        pings: [],
        cameraTarget: null,
        chatTable: snap.chat,
        chatUnread: omit(s.chatUnread, 'table'),
        // Pedidos sem resposta se perdem na reconexão; abas privadas e o histórico delas ficam.
        chatPending: {},
        confirmedTurns: snap.turns ?? defaultTurns(),
        activeLayerId,
        selectedId: s.selectedId && objects[s.selectedId] ? s.selectedId : null,
      }
      // ops de camada, anotação e membro ainda não confirmadas voltam por cima do snapshot
      let out = base
      for (const p of Object.values(s.pending)) {
        if (isObjectOp(p.op)) continue
        switch (p.op.kind) {
          case 'layerDelete':
            out = withoutLayer(out, p.op.id)
            break
          case 'noteSet':
            out = { ...out, notes: setNote(out.notes, p.op.objectId, p.op.text.trim() === '' ? '' : p.op.text) }
            break
          case 'memberRemove':
            out = { ...out, members: omit(out.members, p.op.clientId) }
            break
          case 'settingsUpdate':
            out = { ...out, settings: mergeSettings(out.settings, p.op.patch) }
            break
          case 'memberUpdate': {
            const member = out.members[p.op.clientId]
            if (member) out = withMember(out, { ...member, ...p.op.patch })
            break
          }
          case 'clearObjects':
            out = withoutObjects(out, clearIds(out, p.op))
            break
        }
      }
      return recomputeTurns(out, s.pending)
    }

    case 'ack': {
      const p = s.pending[msg.opId]
      if (!p) return s
      let objects = s.objects
      let notes = s.notes
      if (isObjectOp(p.op)) {
        const id = opTargetId(p.op)
        if (p.op.kind === 'delete') notes = omit(notes, id)
        else if (objects[id]) objects = { ...objects, [id]: { ...objects[id], version: msg.version } }
      } else if (p.op.kind === 'batch') {
        for (const sub of p.op.ops) if (sub.kind === 'delete') notes = omit(notes, sub.id)
      }
      const pending = omit(s.pending, msg.opId)
      let acked: S = { ...s, pending, objects, notes }
      if (isLayerOp(p.op)) acked = recomputeLayers({ ...acked, confirmedLayers: replayLayerOp(s.confirmedLayers, p.op, p.layerOrders) })
      if (isTurnOp(p.op)) acked = recomputeTurns({ ...acked, confirmedTurns: ackTurnOp(s.confirmedTurns, p.op) })
      return settleGroup(acked, p, p.inverse)
    }

    case 'reject': {
      const p = s.pending[msg.opId]
      if (!p) return s
      if (p.op.kind === 'batch') return rejectBatch(s, msg.opId, p, msg.reason)
      const pending = omit(s.pending, msg.opId)
      let next: S
      if (isObjectOp(p.op)) {
        const id = opTargetId(p.op)
        const base = msg.current !== undefined ? msg.current : p.before
        const objects = { ...s.objects }
        if (base) objects[id] = base
        else delete objects[id]
        next = { ...s, pending, objects: reapplyPending(objects, pending, selfId, id) }
      } else {
        next = recomputeTurns(recomputeLayers({ ...revertLocal(s, p), pending }, pending), pending)
      }
      next = settleGroup(next, p, null)
      if (p.op.kind === 'delete' && msg.reason === 'not_found') return next
      const layerIds: string[] = []
      if (p.op.kind === 'create') layerIds.push(p.op.object.layerId)
      else if (p.op.kind === 'update' && p.op.patch.layerId) layerIds.push(p.op.patch.layerId)
      if (p.before) layerIds.push(p.before.layerId)
      const layerGone = layerIds.some((id) => !next.layers.some((l) => l.id === id))
      return addToast(next, p.isUndo ? 'Não foi possível desfazer' : rejectText(p.op, msg.reason, layerGone))
    }

    case 'op':
      return applyServerOp(s, msg.op, selfId)

    case 'batch': {
      const out = msg.ops.reduce((acc, op) => applyServerOp(acc, op, selfId), s)
      return { ...out, groupDrags: omit(out.groupDrags, msg.by) }
    }

    case 'objectsRemoved': {
      const gone = new Set(msg.ids)
      const out = withoutObjects(s, gone)
      return { ...out, undoStack: pruneUndoStack(s.undoStack, gone) }
    }

    case 'grabbed':
      return {
        ...s,
        locks: { ...s.locks, [msg.objectId]: { clientId: msg.clientId, expiresAt: now + LOCK_TTL_MS } },
        deniedGrabs: msg.clientId === selfId ? omit(s.deniedGrabs, msg.objectId) : s.deniedGrabs,
      }

    case 'grabDenied':
      return { ...s, deniedGrabs: { ...s.deniedGrabs, [msg.objectId]: true } }

    case 'released':
      return { ...s, locks: omit(s.locks, msg.objectId), dragPreviews: omit(s.dragPreviews, msg.objectId) }

    case 'presence': {
      const p = msg.p
      switch (p.kind) {
        case 'groupDrag': {
          const { kind: _k, layerIds: _l, ...box } = p
          return { ...s, groupDrags: { ...s.groupDrags, [msg.clientId]: box } }
        }
        case 'groupDragEnd':
          return { ...s, groupDrags: omit(s.groupDrags, msg.clientId) }
        case 'cursor':
          return { ...s, cursors: { ...s.cursors, [msg.clientId]: { x: p.x, y: p.y } } }
        case 'drag': {
          const { objectId, kind: _k, ...geometry } = p
          return {
            ...s,
            dragPreviews: { ...s.dragPreviews, [objectId]: geometry },
            locks: { ...s.locks, [objectId]: { clientId: msg.clientId, expiresAt: now + LOCK_TTL_MS } },
          }
        }
        case 'stroke': {
          const prev = s.strokePreviews[p.strokeId]
          return {
            ...s,
            strokePreviews: {
              ...s.strokePreviews,
              [p.strokeId]: {
                clientId: msg.clientId,
                layerId: p.layerId,
                color: p.color,
                strokeWidth: p.strokeWidth,
                points: prev ? [...prev.points, ...p.points] : p.points,
              },
            },
          }
        }
        case 'strokeEnd':
          return { ...s, strokePreviews: omit(s.strokePreviews, p.strokeId) }
        case 'ruler':
          return { ...s, rulers: { ...s.rulers, [msg.clientId]: { points: p.points } } }
        case 'rulerEnd':
          return { ...s, rulers: omit(s.rulers, msg.clientId) }
        case 'ping': {
          const pings = [
            ...s.pings.filter((old) => now - old.at < PING_DURATION_MS),
            { id: ++pingSeq, clientId: msg.clientId, x: p.x, y: p.y, at: now },
          ]
          // Só centraliza com pedido de outra pessoa (o servidor só deixa o mestre pedir).
          const recenter = p.recenter && msg.clientId !== selfId
          return {
            ...s,
            pings,
            cameraTarget: recenter ? { x: p.x, y: p.y, seq: (s.cameraTarget?.seq ?? 0) + 1 } : s.cameraTarget,
          }
        }
      }
      return s
    }

    case 'memberJoined':
      return { ...s, members: { ...s.members, [msg.member.clientId]: msg.member } }

    case 'memberLeft': {
      const member = s.members[msg.clientId]
      return {
        ...s,
        members: member ? { ...s.members, [msg.clientId]: { ...member, online: false } } : s.members,
        cursors: omit(s.cursors, msg.clientId),
        rulers: omit(s.rulers, msg.clientId),
        groupDrags: omit(s.groupDrags, msg.clientId),
        locks: Object.fromEntries(Object.entries(s.locks).filter(([, l]) => l.clientId !== msg.clientId)),
        strokePreviews: Object.fromEntries(Object.entries(s.strokePreviews).filter(([, p]) => p.clientId !== msg.clientId)),
      }
    }

    case 'memberRemoved':
      return {
        ...s,
        members: omit(s.members, msg.clientId),
        cursors: omit(s.cursors, msg.clientId),
        rulers: omit(s.rulers, msg.clientId),
        groupDrags: omit(s.groupDrags, msg.clientId),
      }

    case 'layerUpsert':
      return recomputeLayers({ ...s, confirmedLayers: upsertLayer(s.confirmedLayers, msg.layer) })

    case 'layerShown': {
      const objects = { ...s.objects }
      for (const o of msg.objects) objects[o.id] = o
      return recomputeLayers({
        ...s,
        confirmedLayers: upsertLayer(s.confirmedLayers, msg.layer),
        objects: reapplyPending(objects, s.pending, selfId),
      })
    }

    case 'layerHidden':
    case 'layerRemoved':
      return withoutLayer(recomputeLayers({ ...s, confirmedLayers: s.confirmedLayers.filter((l) => l.id !== msg.id) }), msg.id)

    case 'noteSet':
      return { ...s, notes: setNote(s.notes, msg.objectId, msg.text) }

    case 'error':
      return { ...s, fatal: msg.reason, status: 'closed' }
    case 'settingsUpdated':
      return { ...s, settings: msg.settings }

    case 'memberUpdated':
      return withMember(s, msg.member)

    case 'turnsUpdated':
      return recomputeTurns({ ...s, confirmedTurns: msg.turns })

    case 'chat':
      return reduceChatEntry(s, msg.channel, msg.entry)

    case 'chatAck':
      return { ...s, chatPending: omit(s.chatPending, msg.reqId) }

    case 'chatReject': {
      const channel = s.chatPending[msg.reqId]
      return addToast({ ...s, chatPending: omit(s.chatPending, msg.reqId) }, chatRejectText(msg.reason, channel, s.members))
    }
  }
}
