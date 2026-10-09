import type { BatchOp, ObjectOp, ObjectPatch, Op, Role, TableObject } from '@mesa/shared'
import { opTargetId } from './localOps'

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

/**
 * Lote que desfaz um lote: as inversas de cada sub-ação em ordem reversa. Original cortado em pedaços
 * (`create … from: X` + `delete X`): a recriação de X sai com `from` = o primeiro pedaço, que o lote
 * inverso apaga; assim X volta com o dono e o controle de antes. Quando o mestre recria objetos
 * apagados inteiros, os updates de controle vão num segundo lote (no mesmo lote seriam id repetido).
 */
export function batchInverse(op: BatchOp, before: Record<string, TableObject | null>, role: Role | undefined): Op[] | null {
  const firstPiece = new Map<string, string>()
  for (const sub of op.ops) {
    if (sub.kind === 'create' && sub.from !== undefined && !firstPiece.has(sub.from)) firstPiece.set(sub.from, sub.object.id)
  }
  const main: ObjectOp[] = []
  const follow: ObjectOp[] = []
  for (const sub of [...op.ops].reverse()) {
    const prior = before[opTargetId(sub)] ?? null
    const piece = sub.kind === 'delete' ? firstPiece.get(sub.id) : undefined
    if (piece !== undefined) {
      const recreate = inverseOf(sub, prior)
      if (recreate?.kind === 'create') main.push({ ...recreate, from: piece })
      continue
    }
    const group = inverseGroupOf(sub, prior, role)
    if (!group) continue
    const [inverse, ...rest] = group as ObjectOp[]
    main.push(inverse)
    follow.push(...rest)
  }
  if (main.length === 0) return null
  const out: Op[] = [{ kind: 'batch', ops: main }]
  if (follow.length > 0) out.push({ kind: 'batch', ops: follow })
  return out
}
