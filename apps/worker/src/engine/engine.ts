import {
  LOCK_TTL_MS,
  MEMBER_COLORS,
  TableObjectSchema,
  mergePatch,
  type Layer,
  type LockInfo,
  type Member,
  type Op,
  type RejectReason,
  type Role,
  type Snapshot,
  type TableObject,
} from '@mesa/shared'
import type { StoredMember, TableStore } from './store'

export type OpResult =
  | { ok: true; duplicate: true; version: number }
  | { ok: true; duplicate: false; version: number; before: TableObject | null; after: TableObject | null }
  | { ok: false; reason: RejectReason; current: TableObject | null }

interface Lock {
  clientId: string
  expiresAt: number
}

const reject = (reason: RejectReason, current: TableObject | null): OpResult => ({ ok: false, reason, current })

export class TableEngine {
  // Travas ficam só em memória: se o DO hibernar, elas somem — aceitável, pois expiram em 10 s.
  private locks = new Map<string, Lock>()

  constructor(
    private store: TableStore,
    private now: () => number = Date.now,
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

  join(input: { clientId: string; nickname: string; role: Role }, online: Set<string>): Member {
    const existing = this.store.getMember(input.clientId)
    const usedByOthers = new Set(
      this.store
        .listMembers()
        .filter((m) => m.clientId !== input.clientId && online.has(m.clientId))
        .map((m) => m.color),
    )
    const color =
      existing && !usedByOthers.has(existing.color)
        ? existing.color
        : (MEMBER_COLORS.find((c) => !usedByOthers.has(c)) ?? MEMBER_COLORS[usedByOthers.size % MEMBER_COLORS.length])
    const stored: StoredMember = { ...input, color, lastSeenAt: this.now() }
    this.store.upsertMember(stored)
    return { clientId: input.clientId, nickname: input.nickname, color, role: input.role, online: true }
  }

  touchMember(clientId: string): void {
    const m = this.store.getMember(clientId)
    if (m) this.store.upsertMember({ ...m, lastSeenAt: this.now() })
  }

  snapshot(role: Role, online: Set<string>): Snapshot {
    const meta = this.store.getMeta()!
    return {
      meta: { id: meta.id, name: meta.name },
      members: this.store.listMembers().map((m) => ({
        clientId: m.clientId,
        nickname: m.nickname,
        color: m.color,
        role: m.role,
        online: online.has(m.clientId),
      })),
      layers: this.store.getLayers().filter((l) => this.canSeeLayer(role, l.id)),
      objects: this.store.listObjects().filter((o) => this.canSeeObject(role, o)),
      locks: this.activeLocks().filter((l) => {
        const o = this.store.getObject(l.objectId)
        return !!o && this.canSeeObject(role, o)
      }),
    }
  }

  applyOp(clientId: string, role: Role, opId: string, op: Op): OpResult {
    const duplicate = this.store.getAppliedOp(clientId, opId)
    if (duplicate !== null) return { ok: true, duplicate: true, version: duplicate }
    const result = this.execute(clientId, role, op)
    if (result.ok) this.store.recordAppliedOp(clientId, opId, result.version)
    return result
  }

  private execute(clientId: string, role: Role, op: Op): OpResult {
    if (op.kind === 'create') {
      const { object } = op
      if (!this.canEditLayer(role, object.layerId)) return reject('forbidden', null)
      const existing = this.store.getObject(object.id)
      if (existing) return reject('exists', this.canSeeObject(role, existing) ? existing : null)
      const after = {
        ...object,
        control: { mode: 'list', clientIds: [clientId] },
        ownerId: clientId,
        version: 1,
        updatedBy: clientId,
      } as TableObject
      this.store.putObject(after)
      return { ok: true, duplicate: false, version: 1, before: null, after }
    }

    const before = this.store.getObject(op.id)
    if (!before || !this.canSeeObject(role, before)) return reject('not_found', null)
    if (!this.canEditLayer(role, before.layerId)) return reject('forbidden', before)
    if (this.lockHeldByOther(op.id, clientId)) return reject('locked', before)

    if (op.kind === 'delete') {
      this.store.deleteObject(op.id)
      this.locks.delete(op.id)
      return { ok: true, duplicate: false, version: 0, before, after: null }
    }

    if (op.patch.layerId !== undefined && !this.canEditLayer(role, op.patch.layerId)) return reject('forbidden', before)
    const parsed = TableObjectSchema.safeParse({
      ...mergePatch(before, op.patch),
      version: before.version + 1,
      updatedBy: clientId,
    })
    if (!parsed.success) return reject('invalid', before)
    this.store.putObject(parsed.data)
    return { ok: true, duplicate: false, version: parsed.data.version, before, after: parsed.data }
  }

  grab(clientId: string, role: Role, objectId: string): boolean {
    const object = this.store.getObject(objectId)
    if (!object || !this.canEditLayer(role, object.layerId)) return false
    if (this.lockHeldByOther(objectId, clientId)) return false
    this.locks.set(objectId, { clientId, expiresAt: this.now() + LOCK_TTL_MS })
    return true
  }

  touchLock(clientId: string, objectId: string): boolean {
    const lock = this.locks.get(objectId)
    if (!lock || lock.clientId !== clientId || lock.expiresAt <= this.now()) return false
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
