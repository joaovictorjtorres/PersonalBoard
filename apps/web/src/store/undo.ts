import type { ObjectPatch, Op, TableObject } from '@mesa/shared'

export function inverseOf(op: Op, before: TableObject | null): Op | null {
  switch (op.kind) {
    case 'create':
      return { kind: 'delete', id: op.object.id }
    case 'delete': {
      if (!before) return null
      const { ownerId: _o, version: _v, updatedBy: _u, ...object } = before
      return { kind: 'create', object }
    }
    case 'update': {
      if (!before) return null
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(op.patch)) patch[key] = (before as Record<string, unknown>)[key]
      return { kind: 'update', id: op.id, patch: patch as ObjectPatch }
    }
  }
}
