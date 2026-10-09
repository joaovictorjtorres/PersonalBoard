import { clearTargets, type ClearObjectsOp, type Layer, type Member, type TableObject } from '@mesa/shared'
import { askConfirm, plural } from './confirm'

/** Uma limpeza pronta para confirmar: a op e o texto do aviso, com as contas feitas na visão local. */
export interface ClearPlan {
  op: ClearObjectsOp
  count: number
  title: string
  message: string
  confirmLabel: string
}

export interface ClearView {
  objects: Record<string, TableObject>
  layers: Layer[]
  self: Pick<Member, 'clientId' | 'role'>
}

const IRREVERSIBLE = 'Isso não pode ser desfeito.'

function targets(view: ClearView, op: ClearObjectsOp): { count: number; layers: number } {
  const list = clearTargets(Object.values(view.objects), view.layers, op, view.self)
  return { count: list.length, layers: new Set(list.map((o) => o.layerId)).size }
}

const layerName = (view: ClearView, id: string) => view.layers.find((l) => l.id === id)?.name ?? 'atual'

export function planMine(view: ClearView, layerId: string | null): ClearPlan {
  const op: ClearObjectsOp = { kind: 'clearObjects', layerId, authorId: view.self.clientId, scope: 'drawings' }
  const { count, layers } = targets(view, op)
  const where = layerId === null ? `em ${plural(layers, 'camada', 'camadas')}` : `na camada ${layerName(view, layerId)}`
  return {
    op,
    count,
    title: 'Apagar meus desenhos',
    message: `Apagar ${plural(count, 'desenho seu', 'desenhos seus')} ${where}? Imagens e desenhos de outras pessoas ficam. ${IRREVERSIBLE}`,
    confirmLabel: 'Apagar',
  }
}

export function planMember(view: ClearView, member: Pick<Member, 'clientId' | 'nickname'>, layerId: string | null): ClearPlan {
  const op: ClearObjectsOp = { kind: 'clearObjects', layerId, authorId: member.clientId, scope: 'drawings' }
  const { count, layers } = targets(view, op)
  const where = layerId === null ? `em ${plural(layers, 'camada', 'camadas')}` : `na camada ${layerName(view, layerId)}`
  return {
    op,
    count,
    title: `Apagar desenhos de ${member.nickname}`,
    message: `Apagar ${plural(count, 'desenho', 'desenhos')} de ${member.nickname} ${where}? Imagens ficam. ${IRREVERSIBLE}`,
    confirmLabel: 'Apagar',
  }
}

export function planLayerDrawings(view: ClearView, layerId: string): ClearPlan {
  const op: ClearObjectsOp = { kind: 'clearObjects', layerId, scope: 'drawings' }
  const { count } = targets(view, op)
  return {
    op,
    count,
    title: 'Limpar desenhos',
    message: `Apagar ${plural(count, 'desenho', 'desenhos')} de todos na camada ${layerName(view, layerId)}? Imagens e tokens ficam. ${IRREVERSIBLE}`,
    confirmLabel: 'Apagar',
  }
}

export function planLayerEverything(view: ClearView, layerId: string): ClearPlan {
  const op: ClearObjectsOp = { kind: 'clearObjects', layerId, scope: 'all' }
  const { count } = targets(view, op)
  return {
    op,
    count,
    title: 'Limpar camada',
    message: `Apagar ${plural(count, 'objeto', 'objetos')} da camada ${layerName(view, layerId)} (desenhos, imagens e tokens)? A camada continua existindo. ${IRREVERSIBLE}`,
    confirmLabel: 'Limpar camada',
  }
}

/** Pede confirmação e, se aceita, envia. Nada a apagar: não abre o aviso. */
export async function confirmClear(plan: ClearPlan, submit: (op: ClearObjectsOp) => void): Promise<boolean> {
  if (plan.count === 0) return false
  const ok = await askConfirm({ title: plan.title, message: plan.message, confirmLabel: plan.confirmLabel, danger: true })
  if (ok) submit(plan.op)
  return ok
}
