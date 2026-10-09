import type { TableObject } from '@mesa/shared'

type Ordered = Pick<TableObject, 'id' | 'layerId' | 'zIndex'>

/** zIndex do topo da camada: o maior + 1 (camada vazia: 1). */
export function topZ(objects: Record<string, TableObject>, layerId: string): number {
  let max = 0
  for (const o of Object.values(objects)) if (o.layerId === layerId) max = Math.max(max, o.zIndex)
  return max + 1
}

/**
 * Itens soltos vão para o topo da própria camada (nunca para outra camada), mantendo a ordem
 * relativa que tinham entre si: zIndex novo de cada id.
 */
export function liftToTop(objects: Record<string, TableObject>, items: readonly Ordered[]): Record<string, number> {
  const byLayer = new Map<string, Ordered[]>()
  for (const item of items) {
    const list = byLayer.get(item.layerId) ?? []
    list.push(item)
    byLayer.set(item.layerId, list)
  }
  const out: Record<string, number> = {}
  for (const [layerId, list] of byLayer) {
    const top = topZ(objects, layerId)
    // sort é estável: zIndex empatado fica na ordem recebida.
    ;[...list].sort((a, b) => a.zIndex - b.zIndex).forEach((item, i) => (out[item.id] = top + i))
  }
  return out
}
