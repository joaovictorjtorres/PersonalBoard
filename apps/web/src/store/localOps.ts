import { isObjectOp, mergePatch, type ObjectOp, type Op, type TableObject } from '@mesa/shared'

export function opTargetId(op: ObjectOp): string {
  return op.kind === 'create' ? op.object.id : op.id
}

/** Ops de objeto que `op` aplica localmente: ela mesma, ou as sub-ações de um lote, em ordem. */
export function objectOpsOf(op: Op): ObjectOp[] {
  if (isObjectOp(op)) return [op]
  return op.kind === 'batch' ? op.ops : []
}

/**
 * Aplica localmente só operações de objeto; as demais são tratadas nos reducers.
 * `create … from`: o pedaço herda dono e controle do original, se ele ainda está em `objects`
 * (por isso o lote cria os pedaços antes de apagar o original); sem o original, os do objeto que já
 * existe com esse id.
 */
export function applyLocalOp(objects: Record<string, TableObject>, op: Op, selfId: string): Record<string, TableObject> {
  switch (op.kind) {
    case 'create': {
      const origin = op.from !== undefined ? objects[op.from] : undefined
      // Reaplicação com o original já apagado: o pedaço que já está aqui mantém dono e controle.
      const existing = objects[op.object.id]
      return {
        ...objects,
        [op.object.id]: {
          ...op.object,
          control: origin?.control ?? existing?.control ?? { mode: 'list', clientIds: [selfId] },
          ownerId: origin?.ownerId ?? existing?.ownerId ?? selfId,
          version: 0,
          updatedBy: selfId,
        } as TableObject,
      }
    }
    case 'update': {
      const current = objects[op.id]
      if (!current) return objects
      return { ...objects, [op.id]: { ...mergePatch(current, op.patch), updatedBy: selfId } as TableObject }
    }
    case 'delete': {
      if (!objects[op.id]) return objects
      const { [op.id]: _removed, ...rest } = objects
      return rest
    }
    default:
      return objects
  }
}
