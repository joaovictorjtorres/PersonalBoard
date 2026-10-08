import {
  GM_LAYER_ID,
  LOCK_TTL_MS,
  MEMBER_COLORS,
  MEMBER_RECENT_MS,
  TableObjectSchema,
  canControl,
  changedLayers,
  insertLayer,
  mergePatch,
  mergeSettings,
  moveLayer,
  rollDice,
  snapPatch,
  snapToGrid,
  type ChatEntry,
  type Layer,
  type LayerPatch,
  type LockInfo,
  type Member,
  type MemberPatch,
  type NewObject,
  type ObjectPatch,
  type Op,
  type RejectReason,
  type Role,
  type RollRequest,
  type SettingsPatch,
  type Snapshot,
  type TableObject,
  type TableSettings,
} from '@mesa/shared'
import { randomUint32 } from '../crypto'
import type { StoredMember, TableStore } from './store'

export type LayerChange = { before: Layer | null; after: Layer }

/** O que mudou; o TableDO decide quem recebe o quê. */
export type OpEffect =
  /** `echo`: o servidor alterou o objeto (encaixe na grade); o autor também precisa recebê-lo. */
  | { kind: 'object'; before: TableObject | null; after: TableObject | null; echo?: true }
  | { kind: 'layers'; changes: LayerChange[] }
  | { kind: 'layerRemoved'; layer: Layer }
  | { kind: 'note'; objectId: string; text: string }
  | { kind: 'memberRemoved'; clientId: string }
  | { kind: 'released'; objectId: string; clientId: string }
  | { kind: 'settings'; settings: TableSettings }
  | { kind: 'memberUpdated'; member: Member }

export type OpResult =
  | { ok: true; duplicate: true; version: number }
  | { ok: true; duplicate: false; version: number; effects: OpEffect[] }
  | { ok: false; reason: RejectReason; current?: TableObject | null }

/** Conteúdo de uma entrada do chat antes de o servidor dar id, hora e (na rolagem) o resultado. */
export type ChatBody =
  | { kind: 'message'; text: string }
  | { kind: 'image'; assetKey: string; width: number; height: number }
  | { kind: 'roll'; request: RollRequest; secret: boolean }

interface Lock {
  clientId: string
  role: Role
  expiresAt: number
}

const reject = (reason: RejectReason, current: TableObject | null): OpResult => ({ ok: false, reason, current })
// 'invalid' omite `current`: o cliente reverte para o `before` da operação pendente.
const rejectInvalid = (): OpResult => ({ ok: false, reason: 'invalid' })
const done = (version: number, ...effects: OpEffect[]): OpResult => ({ ok: true, duplicate: false, version, effects })

const toMember = (m: StoredMember, online: boolean): Member => ({
  clientId: m.clientId,
  nickname: m.nickname,
  color: m.color,
  role: m.role,
  online,
})

const touchesGeometry = (p: ObjectPatch) =>
  p.x !== undefined || p.y !== undefined || p.width !== undefined || p.height !== undefined

export class TableEngine {
  // Travas ficam só em memória: se o DO hibernar, elas somem — aceitável, pois expiram em 10 s.
  private locks = new Map<string, Lock>()

  constructor(
    private store: TableStore,
    private now: () => number = Date.now,
    /** Gerador de uint32 dos dados; injetável nos testes. */
    private rng: () => number = randomUint32,
  ) {}

  private layer(id: string): Layer | null {
    return this.store.getLayers().find((l) => l.id === id) ?? null
  }

  canSeeLayer(role: Role, layerId: string): boolean {
    const layer = this.layer(layerId)
    return !!layer && (layer.visibility === 'all' || role === 'gm')
  }

  canEditLayer(role: Role, layerId: string): boolean {
    const layer = this.layer(layerId)
    return !!layer && this.canSeeLayer(role, layerId) && (!layer.locked || role === 'gm')
  }

  canSeeObject(role: Role, object: TableObject): boolean {
    return this.canSeeLayer(role, object.layerId)
  }

  canEditObject(clientId: string, role: Role, object: TableObject): boolean {
    return this.canEditLayer(role, object.layerId) && canControl(object, clientId, role)
  }

  /** Rolagem secreta: só o autor e os mestres. O resto: todos. */
  canSeeChat(viewerId: string, role: Role, entry: ChatEntry): boolean {
    return entry.kind !== 'roll' || !entry.secret || role === 'gm' || entry.authorId === viewerId
  }

  join(input: { clientId: string; nickname: string; role: Role; secretHash?: string }, online: Set<string>): Member {
    const existing = this.store.getMember(input.clientId)
    const usedByOthers = new Set(
      this.store
        .listMembers()
        .filter((m) => m.clientId !== input.clientId && online.has(m.clientId))
        .map((m) => m.color),
    )
    // Cor escolhida pelo mestre nunca é reatribuída, mesmo repetida.
    const color =
      existing && (existing.colorSetByGm || !usedByOthers.has(existing.color))
        ? existing.color
        : (MEMBER_COLORS.find((c) => !usedByOthers.has(c)) ?? MEMBER_COLORS[usedByOthers.size % MEMBER_COLORS.length])
    // Apelido definido pelo mestre vence o enviado no hello.
    const nickname = existing?.nicknameSetByGm ? existing.nickname : input.nickname
    const secretHash = input.secretHash ?? existing?.secretHash
    const stored: StoredMember = {
      clientId: input.clientId,
      nickname,
      role: input.role,
      color,
      lastSeenAt: this.now(),
      ...(secretHash ? { secretHash } : {}),
      ...(existing?.nicknameSetByGm ? { nicknameSetByGm: true } : {}),
      ...(existing?.colorSetByGm ? { colorSetByGm: true } : {}),
    }
    this.store.upsertMember(stored)
    return toMember(stored, true)
  }

  touchMember(clientId: string): void {
    const m = this.store.getMember(clientId)
    if (m) this.store.upsertMember({ ...m, lastSeenAt: this.now() })
  }

  snapshot(role: Role, online: Set<string>, viewerId = ''): Snapshot {
    const meta = this.store.getMeta()!
    const now = this.now()
    return {
      meta: { id: meta.id, name: meta.name },
      members: this.store
        .listMembers()
        .filter((m) => online.has(m.clientId) || now - m.lastSeenAt <= MEMBER_RECENT_MS)
        .map((m) => toMember(m, online.has(m.clientId))),
      layers: this.store.getLayers().filter((l) => this.canSeeLayer(role, l.id)),
      objects: this.store.listObjects().filter((o) => this.canSeeObject(role, o)),
      locks: this.activeLocks().filter((l) => {
        const o = this.store.getObject(l.objectId)
        return !!o && this.canSeeObject(role, o)
      }),
      notes: role === 'gm' ? this.store.listNotes() : {},
      settings: this.store.getSettings(),
      chat: this.store.listChat().filter((e) => this.canSeeChat(viewerId, role, e)),
    }
  }

  applyOp(clientId: string, role: Role, opId: string, op: Op, online: Set<string> = new Set()): OpResult {
    const duplicate = this.store.getAppliedOp(clientId, opId)
    if (duplicate !== null) return { ok: true, duplicate: true, version: duplicate }
    const result = this.execute(clientId, role, op, online)
    if (result.ok) this.store.recordAppliedOp(clientId, opId, result.version)
    return result
  }

  private execute(clientId: string, role: Role, op: Op, online: Set<string>): OpResult {
    if (op.kind === 'create') return this.create(clientId, role, op.object)
    if (op.kind === 'update' || op.kind === 'delete') return this.change(clientId, role, op)
    // Camadas, anotações, membros e configurações: só o mestre.
    if (role !== 'gm') return reject('forbidden', null)
    switch (op.kind) {
      case 'layerCreate': return this.layerCreate(op.layer)
      case 'layerUpdate': return this.layerUpdate(op.id, op.patch)
      case 'layerDelete': return this.layerDelete(op.id)
      case 'layerMove': return this.layerMove(op.id, op.direction)
      case 'noteSet': return this.noteSet(op.objectId, op.text)
      case 'memberRemove': return this.memberRemove(op.clientId, online)
      case 'settingsUpdate': return this.settingsUpdate(op.patch)
      case 'memberUpdate': return this.memberUpdate(op.clientId, op.patch, online)
    }
  }

  private create(clientId: string, role: Role, object: NewObject): OpResult {
    if (!this.canEditLayer(role, object.layerId)) return reject('forbidden', null)
    const existing = this.store.getObject(object.id)
    if (existing) return reject('exists', this.canSeeObject(role, existing) ? existing : null)
    // Encaixe só para imagens (mapa e tokens); traços e formas ficam onde foram soltos.
    const grid = this.store.getSettings().grid
    const snap = object.type === 'image' && grid.snap
    const placed = snap ? { ...object, ...snapToGrid(object, grid.size) } : object
    const after = {
      ...placed,
      control: { mode: 'list', clientIds: [clientId] },
      ownerId: clientId,
      version: 1,
      updatedBy: clientId,
    } as TableObject
    this.store.putObject(after)
    return done(1, { kind: 'object', before: null, after, ...(snap ? { echo: true as const } : {}) })
  }

  private change(clientId: string, role: Role, op: Extract<Op, { kind: 'update' | 'delete' }>): OpResult {
    const before = this.store.getObject(op.id)
    if (!before || !this.canSeeObject(role, before)) return reject('not_found', null)
    if (!this.canEditObject(clientId, role, before)) return reject('forbidden', before)
    if (this.lockHeldByOther(op.id, clientId)) return reject('locked', before)

    if (op.kind === 'delete') {
      this.store.deleteObject(op.id)
      this.store.deleteNote(op.id)
      this.locks.delete(op.id)
      return done(0, { kind: 'object', before, after: null })
    }

    const { patch } = op
    // Mudar controle ou camada é só do mestre — mesmo que o valor seja o atual.
    if ((patch.control !== undefined || patch.layerId !== undefined) && role !== 'gm') return reject('forbidden', before)
    if (patch.layerId !== undefined && !this.canEditLayer(role, patch.layerId)) return reject('forbidden', before)
    const grid = this.store.getSettings().grid
    const snap = before.type === 'image' && grid.snap && touchesGeometry(patch)
    const parsed = TableObjectSchema.safeParse({
      ...mergePatch(before, snap ? snapPatch(patch, grid.size) : patch),
      version: before.version + 1,
      updatedBy: clientId,
    })
    if (!parsed.success) return rejectInvalid()
    this.store.putObject(parsed.data)
    return done(parsed.data.version, { kind: 'object', before, after: parsed.data, ...(snap ? { echo: true as const } : {}) })
  }

  private saveLayers(before: Layer[], after: Layer[], extra: OpEffect[] = []): OpResult {
    const changes = changedLayers(before, after)
    for (const change of changes) this.store.putLayer(change.after)
    return done(0, { kind: 'layers', changes }, ...extra)
  }

  private layerCreate(input: { id: string; name: string }): OpResult {
    const layers = this.store.getLayers()
    if (layers.some((l) => l.id === input.id)) return reject('exists', null)
    return this.saveLayers(layers, insertLayer(layers, input))
  }

  private layerUpdate(id: string, patch: LayerPatch): OpResult {
    const layers = this.store.getLayers()
    const before = layers.find((l) => l.id === id)
    if (!before) return reject('not_found', null)
    if (id === GM_LAYER_ID && patch.visibility !== undefined) return reject('forbidden', null)
    const after: Layer = { ...before, ...patch }
    const hidden = before.visibility === 'all' && after.visibility === 'gm'
    const locked = !before.locked && after.locked
    const released = hidden || locked ? this.releasePlayerLocks(id) : []
    return this.saveLayers(layers, layers.map((l) => (l.id === id ? after : l)), released)
  }

  private layerDelete(id: string): OpResult {
    const layers = this.store.getLayers()
    const layer = layers.find((l) => l.id === id)
    if (!layer) return reject('not_found', null)
    const common = layers.filter((l) => l.id !== GM_LAYER_ID)
    if (id === GM_LAYER_ID || common.length <= 1) return reject('forbidden', null)
    for (const o of this.store.listObjects()) {
      if (o.layerId !== id) continue
      this.store.deleteObject(o.id)
      this.store.deleteNote(o.id)
      this.locks.delete(o.id)
    }
    this.store.deleteLayer(id)
    return done(0, { kind: 'layerRemoved', layer })
  }

  private layerMove(id: string, direction: 'up' | 'down'): OpResult {
    const layers = this.store.getLayers()
    if (!layers.some((l) => l.id === id)) return reject('not_found', null)
    const after = moveLayer(layers, id, direction)
    if (!after) return reject('forbidden', null)
    return this.saveLayers(layers, after)
  }

  private noteSet(objectId: string, text: string): OpResult {
    if (!this.store.getObject(objectId)) return reject('not_found', null)
    const value = text.trim() === '' ? '' : text
    this.store.setNote(objectId, value)
    return done(0, { kind: 'note', objectId, text: value })
  }

  private memberRemove(clientId: string, online: Set<string>): OpResult {
    if (online.has(clientId)) return reject('forbidden', null)
    if (!this.store.getMember(clientId)) return reject('not_found', null)
    this.store.deleteMember(clientId)
    return done(0, { kind: 'memberRemoved', clientId })
  }

  // Mudar o tamanho ou ligar o encaixe não move objetos existentes.
  private settingsUpdate(patch: SettingsPatch): OpResult {
    const settings = mergeSettings(this.store.getSettings(), patch)
    this.store.putSettings(settings)
    return done(0, { kind: 'settings', settings })
  }

  private memberUpdate(clientId: string, patch: MemberPatch, online: Set<string>): OpResult {
    const member = this.store.getMember(clientId)
    if (!member) return reject('not_found', null)
    const updated: StoredMember = {
      ...member,
      ...(patch.nickname !== undefined ? { nickname: patch.nickname, nicknameSetByGm: true } : {}),
      ...(patch.color !== undefined ? { color: patch.color, colorSetByGm: true } : {}),
    }
    this.store.upsertMember(updated)
    return done(0, { kind: 'memberUpdated', member: toMember(updated, online.has(clientId)) })
  }

  chatEntry(authorId: string, body: ChatBody): ChatEntry {
    const base = { id: crypto.randomUUID(), at: this.now(), authorId }
    switch (body.kind) {
      case 'message':
        return { ...base, kind: 'message', text: body.text }
      case 'image':
        return { ...base, kind: 'image', assetKey: body.assetKey, width: body.width, height: body.height }
      case 'roll':
        return { ...base, kind: 'roll', request: body.request, result: rollDice(body.request, this.rng), secret: body.secret }
    }
  }

  /** Só o canal da mesa é guardado; conversas privadas nunca passam por aqui. */
  appendTableChat(entry: ChatEntry): void {
    this.store.appendChat(entry)
  }

  private releasePlayerLocks(layerId: string): OpEffect[] {
    const out: OpEffect[] = []
    for (const [objectId, lock] of this.locks) {
      if (lock.role === 'gm' || this.store.getObject(objectId)?.layerId !== layerId) continue
      this.locks.delete(objectId)
      out.push({ kind: 'released', objectId, clientId: lock.clientId })
    }
    return out
  }

  grab(clientId: string, role: Role, objectId: string): boolean {
    const object = this.store.getObject(objectId)
    if (!object || !this.canSeeObject(role, object) || !this.canEditObject(clientId, role, object)) return false
    if (this.lockHeldByOther(objectId, clientId)) return false
    this.locks.set(objectId, { clientId, role, expiresAt: this.now() + LOCK_TTL_MS })
    return true
  }

  touchLock(clientId: string, objectId: string): boolean {
    const lock = this.locks.get(objectId)
    if (!lock || lock.clientId !== clientId || lock.expiresAt <= this.now()) return false
    const object = this.store.getObject(objectId)
    if (!object || !this.canSeeObject(lock.role, object) || !this.canEditObject(clientId, lock.role, object)) {
      this.locks.delete(objectId)
      return false
    }
    lock.expiresAt = this.now() + LOCK_TTL_MS
    return true
  }

  release(clientId: string, objectId: string): boolean {
    const lock = this.locks.get(objectId)
    if (!lock || lock.clientId !== clientId) return false
    this.locks.delete(objectId)
    return true
  }

  releaseAll(clientId: string): string[] {
    const released: string[] = []
    for (const [objectId, lock] of this.locks) {
      if (lock.clientId === clientId) {
        this.locks.delete(objectId)
        released.push(objectId)
      }
    }
    return released
  }

  activeLocks(): LockInfo[] {
    const now = this.now()
    const out: LockInfo[] = []
    for (const [objectId, lock] of this.locks) {
      if (lock.expiresAt > now) out.push({ objectId, clientId: lock.clientId })
      else this.locks.delete(objectId)
    }
    return out
  }

  private lockHeldByOther(objectId: string, clientId: string): boolean {
    const lock = this.locks.get(objectId)
    if (!lock) return false
    if (lock.expiresAt <= this.now()) {
      this.locks.delete(objectId)
      return false
    }
    return lock.clientId !== clientId
  }
}
