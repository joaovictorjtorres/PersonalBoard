import { canControl, type Layer, type Role, type TableObject } from './model'

/** "Desenhos" são o que se faz com as ferramentas (caneta e formas); imagens e tokens nunca entram. */
export function isDrawing(object: Pick<TableObject, 'type'>): boolean {
  return object.type === 'stroke' || object.type === 'shape'
}

export interface ClearRequest {
  /** null = todas as camadas em que quem pede pode mexer. */
  layerId: string | null
  /** Só os objetos criados por esta pessoa (ownerId). */
  authorId?: string
  scope: 'drawings' | 'all'
}

export interface ClearActor {
  clientId: string
  role: Role
}

/** Camada que a pessoa vê e em que pode mexer (o mestre pode em todas). */
export function canClearLayer(layer: Layer, role: Role): boolean {
  return role === 'gm' || (layer.visibility === 'all' && !layer.locked)
}

/** Jogador só apaga os próprios desenhos; o mestre apaga de qualquer um e limpa uma camada inteira. */
export function clearAllowed(req: ClearRequest, actor: ClearActor): boolean {
  if (req.scope === 'all' && req.layerId === null) return false
  return actor.role === 'gm' || (req.scope === 'drawings' && req.authorId === actor.clientId)
}

/**
 * Objetos que a limpeza apaga, na visão de quem pede. O mesmo cálculo roda no servidor (fonte da verdade)
 * e no cliente (aplicação otimista e contagem do aviso). Camadas ocultas/travadas para o jogador são puladas;
 * desenhos próprios cujo controle o mestre tirou dele também.
 */
export function clearTargets(objects: Iterable<TableObject>, layers: Layer[], req: ClearRequest, actor: ClearActor): TableObject[] {
  if (!clearAllowed(req, actor)) return []
  const allowed = new Set(
    layers.filter((l) => (req.layerId === null || l.id === req.layerId) && canClearLayer(l, actor.role)).map((l) => l.id),
  )
  const out: TableObject[] = []
  for (const o of objects) {
    if (!allowed.has(o.layerId)) continue
    if (req.scope === 'drawings' && !isDrawing(o)) continue
    if (req.authorId !== undefined && o.ownerId !== req.authorId) continue
    if (!canControl(o, actor.clientId, actor.role)) continue
    out.push(o)
  }
  return out
}
