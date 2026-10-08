import {
  LOCK_TTL_MS,
  UNDO_LIMIT,
  insertLayer,
  isObjectOp,
  moveLayer,
  sortLayers,
  type Layer,
  type Op,
  type RejectReason,
  type ServerMessage,
  type TableObject,
} from '@mesa/shared'
import type { ConnStatus } from '../sync/SyncClient'
import { applyLocalOp, opTargetId } from './localOps'
import { inverseGroupOf } from './undo'
import type { LocalPrev, PendingOp, TableState, Toast } from './state'

const REJECT_TEXT: Record<RejectReason, string> = {
  invalid: 'Ação inválida',
  not_found: 'O objeto não existe mais',
  exists: 'Esse objeto já existe',
  locked: 'Outra pessoa está mexendo nesse objeto',
  forbidden: 'Sem permissão nessa camada',
}

export function rejectText(op: Op, reason: RejectReason, layerGone = false): string {
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
    if (!isObjectOp(p.op)) continue
    if (onlyId === undefined || opTargetId(p.op) === onlyId) out = applyLocalOp(out, p.op, selfId)
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

function upsertLayer(layers: Layer[], layer: Layer): Layer[] {
  return sortLayers([...layers.filter((l) => l.id !== layer.id), layer])
}

/** Camada visível (para jogadores) de maior order; senão a de maior order. */
export function topLayerId(layers: Layer[]): string {
  const sorted = sortLayers(layers)
  const visible = sorted.filter((l) => l.visibility === 'all')
  return (visible.at(-1) ?? sorted.at(-1))?.id ?? ''
}

function replayLayerOp(layers: Layer[], op: Op, orders: Record<string, number> | null): Layer[] {
  if (op.kind === 'layerMove' && orders) return sortLayers(layers.map((l) => (l.id in orders ? { ...l, order: orders[l.id] } : l)))
  return applyLayerOp(layers, op)
}

/** layers = confirmadas + ops de camada pendentes, em ordem de envio. */
function recomputeLayers<S extends TableState>(s: S, pending: Record<string, PendingOp> = s.pending): S {
  let layers = s.confirmedLayers
  for (const p of Object.values(pending)) layers = replayLayerOp(layers, p.op, p.layerOrders)
  return withActiveLayer({ ...s, layers })
}

function withActiveLayer<S extends TableState>(s: S): S {
  return s.layers.some((l) => l.id === s.activeLayerId) ? s : { ...s, activeLayerId: topLayerId(s.layers), selectedId: null }
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
  })
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
        next: withActiveLayer({ ...s, layers }),
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
    default:
      // settingsUpdate e memberUpdate ganham efeito otimista na Task 6.
      return { next: s, before: null, prev: null, layerOrders: null }
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
      return prev.member ? { ...s, members: { ...s.members, [prev.member.clientId]: prev.member } } : s
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

export function reduceSubmitBatch<S extends TableState>(
  s: S,
  items: Array<{ opId: string; op: Op }>,
  opts: { isUndo: boolean; groupId: string },
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
      inverse: opts.isUndo ? null : inverseGroupOf(op, applied.before, s.self?.role),
      group: opts.isUndo ? null : { id: opts.groupId, index },
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

export function reduceServer<S extends TableState>(s: S, msg: ServerMessage, now: number): S {
  const selfId = s.self?.clientId ?? ''

  switch (msg.t) {
    case 'welcome': {
      const snap = msg.snapshot
      const objects = reapplyPending(Object.fromEntries(snap.objects.map((o) => [o.id, o])), s.pending, msg.self.clientId)
      const layers = sortLayers(snap.layers)
      const pendingLayers = recomputeLayers({ ...s, confirmedLayers: layers }).layers
      const activeLayerId = pendingLayers.some((l) => l.id === s.activeLayerId)
        ? s.activeLayerId
        : layers.some((l) => l.id === 'tokens')
          ? 'tokens'
          : topLayerId(pendingLayers)
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
        }
      }
      return out
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
      }
      const pending = omit(s.pending, msg.opId)
      let acked: S = { ...s, pending, objects, notes }
      if (isLayerOp(p.op)) acked = recomputeLayers({ ...acked, confirmedLayers: replayLayerOp(s.confirmedLayers, p.op, p.layerOrders) })
      return settleGroup(acked, p, p.inverse)
    }

    case 'reject': {
      const p = s.pending[msg.opId]
      if (!p) return s
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
        next = recomputeLayers({ ...revertLocal(s, p), pending }, pending)
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

    case 'op': {
      if (msg.op.kind === 'upsert') {
        const object = msg.op.object
        const objects = reapplyPending({ ...s.objects, [object.id]: object }, s.pending, selfId, object.id)
        return { ...s, objects, dragPreviews: omit(s.dragPreviews, object.id) }
      }
      const id = msg.op.id
      return {
        ...s,
        objects: omit(s.objects, id),
        notes: omit(s.notes, id),
        dragPreviews: omit(s.dragPreviews, id),
        locks: omit(s.locks, id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      }
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
        locks: Object.fromEntries(Object.entries(s.locks).filter(([, l]) => l.clientId !== msg.clientId)),
        strokePreviews: Object.fromEntries(Object.entries(s.strokePreviews).filter(([, p]) => p.clientId !== msg.clientId)),
      }
    }

    case 'memberRemoved':
      return { ...s, members: omit(s.members, msg.clientId), cursors: omit(s.cursors, msg.clientId) }

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
    default:
      // Configurações e membros: Task 6; chat: Task 7.
      return s
  }
}
