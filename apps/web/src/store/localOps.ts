import type { Op, TableObject } from '@mesa/shared'

export function opTargetId(op: Op): string {
  return op.kind === 'create' ? op.object.id : op.id
}

export function applyLocalOp(objects: Record<string, TableObject>, op: Op, selfId: string): Record<string, TableObject> {
  switch (op.kind) {
    case 'create':
      return { ...objects, [op.object.id]: { ...op.object, ownerId: selfId, version: 0, updatedBy: selfId } as TableObject }
    case 'update': {
      const current = objects[op.id]
      if (!current) return objects
      return { ...objects, [op.id]: { ...current, ...op.patch, updatedBy: selfId } as TableObject }
    }
    case 'delete': {
      if (!objects[op.id]) return objects
      const { [op.id]: _removed, ...rest } = objects
      return rest
    }
  }
}
