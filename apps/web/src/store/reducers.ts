import { LOCK_TTL_MS, UNDO_LIMIT, type Op, type RejectReason, type ServerMessage, type TableObject } from '@mesa/shared'
import type { ConnStatus } from '../sync/SyncClient'
import { applyLocalOp, opTargetId } from './localOps'
import { inverseOf } from './undo'
import type { PendingOp, TableState, Toast } from './state'

const REJECT_TEXT: Record<RejectReason, string> = {
  invalid: 'Ação inválida',
  not_found: 'O objeto não existe mais',
  exists: 'Esse objeto já existe',
  locked: 'Outra pessoa está mexendo nesse objeto',
  forbidden: 'Sem permissão nessa camada',
}

let toastSeq = 0

export function addToast<S extends TableState>(s: S, text: string, action?: Toast['action']): S {
  return { ...s, toasts: [...s.toasts, { id: ++toastSeq, text, action }] }
}

export function reduceStatus<S extends TableState>(s: S, status: ConnStatus): S {
  return s.status === status ? s : { ...s, status }
}

export function isLockedByOther(s: TableState, objectId: string, now: number): boolean {
  const lock = s.locks[objectId]
  return !!lock && lock.clientId !== s.self?.clientId && lock.expiresAt > now
}

function reapplyPending(
  objects: Record<string, TableObject>,
  pending: Record<string, PendingOp>,
  selfId: string,
  onlyId?: string,
): Record<string, TableObject> {
  let out = objects
  for (const p of Object.values(pending)) {
    if (onlyId === undefined || opTargetId(p.op) === onlyId) out = applyLocalOp(out, p.op, selfId)
  }
  return out
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

export function reduceSubmit<S extends TableState>(s: S, opId: string, op: Op, opts: { isUndo: boolean }): S {
  const selfId = s.self?.clientId ?? ''
  const targetId = opTargetId(op)
  const before = s.objects[targetId] ?? null
  return {
    ...s,
    objects: applyLocalOp(s.objects, op, selfId),
    pending: { ...s.pending, [opId]: { op, before, isUndo: opts.isUndo, inverse: opts.isUndo ? null : inverseOf(op, before) } },
    selectedId: op.kind === 'delete' && s.selectedId === targetId ? null : s.selectedId,
  }
}

export function reduceServer<S extends TableState>(s: S, msg: ServerMessage, now: number): S {
  const selfId = s.self?.clientId ?? ''

  switch (msg.t) {
    case 'welcome': {
      const snap = msg.snapshot
      const objects = reapplyPending(Object.fromEntries(snap.objects.map((o) => [o.id, o])), s.pending, msg.self.clientId)
      const layers = [...snap.layers].sort((a, b) => a.order - b.order)
      return {
        ...s,
        status: 'open',
        fatal: null,
        self: msg.self,
        meta: snap.meta,
        layers,
        objects,
        members: Object.fromEntries(snap.members.map((m) => [m.clientId, m])),
        locks: Object.fromEntries(snap.locks.map((l) => [l.objectId, { clientId: l.clientId, expiresAt: now + LOCK_TTL_MS }])),
        cursors: {},
        dragPreviews: {},
        strokePreviews: {},
        deniedGrabs: {},
        activeLayerId: layers.some((l) => l.id === s.activeLayerId) ? s.activeLayerId : 'tokens',
        selectedId: s.selectedId && objects[s.selectedId] ? s.selectedId : null,
      }
    }

    case 'ack': {
      const p = s.pending[msg.opId]
      if (!p) return s
      const id = opTargetId(p.op)
      const objects =
        p.op.kind !== 'delete' && s.objects[id] ? { ...s.objects, [id]: { ...s.objects[id], version: msg.version } } : s.objects
      return {
        ...s,
        pending: omit(s.pending, msg.opId),
        objects,
        undoStack: p.inverse ? [...s.undoStack, p.inverse].slice(-UNDO_LIMIT) : s.undoStack,
      }
    }

    case 'reject': {
      const p = s.pending[msg.opId]
      if (!p) return s
      const pending = omit(s.pending, msg.opId)
      const id = opTargetId(p.op)
      const base = msg.current !== undefined ? msg.current : p.before
      const objects = { ...s.objects }
      if (base) objects[id] = base
      else delete objects[id]
      const next = { ...s, pending, objects: reapplyPending(objects, pending, selfId, id) }
      if (p.op.kind === 'delete' && msg.reason === 'not_found') return next
      return addToast(next, p.isUndo ? 'Não foi possível desfazer' : REJECT_TEXT[msg.reason])
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

    case 'error':
      return { ...s, fatal: msg.reason, status: 'closed' }
  }
}
