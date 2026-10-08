import type { ObjectPatch, Op, Role, TableObject } from '@mesa/shared'

export function inverseOf(op: Op, before: TableObject | null): Op | null {
  switch (op.kind) {
    case 'create':
      return { kind: 'delete', id: op.object.id }
    case 'delete': {
      if (!before) return null
      // control é do servidor: a recriação volta com o autor do desfazer como controlador
      const { ownerId: _o, version: _v, updatedBy: _u, control: _c, ...object } = before
      return { kind: 'create', object }
    }
    case 'update': {
      if (!before) return null
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(op.patch)) {
        const value = (before as Record<string, unknown>)[key]
        // título ausente antes → desfazer remove o título
        patch[key] = value === undefined && key === 'title' ? null : value
      }
      return { kind: 'update', id: op.id, patch: patch as ObjectPatch }
    }
    default:
      return null
  }
}

/**
 * Grupo de ops que desfaz `op`. Quando o mestre desfaz um delete, a recriação o torna
 * controlador; o update extra devolve o controle anterior (o servidor permite ao mestre).
 */
export function inverseGroupOf(op: Op, before: TableObject | null, role: Role | undefined): Op[] | null {
  const inv = inverseOf(op, before)
  if (!inv) return null
  if (op.kind === 'delete' && inv.kind === 'create' && role === 'gm' && before) {
    return [inv, { kind: 'update', id: before.id, patch: { control: before.control } }]
  }
  return [inv]
}
