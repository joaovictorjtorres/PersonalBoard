import { GM_LAYER_ID } from './constants'
import type { Layer } from './model'

const isGm = (l: Layer) => l.id === GM_LAYER_ID

/** Cópia ordenada por `order` crescente; a camada do Mestre fica sempre por último (no topo). */
export function sortLayers(layers: Layer[]): Layer[] {
  return [...layers].sort((a, b) => Number(isGm(a)) - Number(isGm(b)) || a.order - b.order)
}

function renumber(layers: Layer[]): Layer[] {
  return layers.map((l, i) => (l.order === i ? l : { ...l, order: i }))
}

/** Nova camada logo abaixo do Mestre (acima de todas as outras); orders viram 0..n-1. */
export function insertLayer(layers: Layer[], input: { id: string; name: string }): Layer[] {
  const sorted = sortLayers(layers)
  const common = sorted.filter((l) => !isGm(l))
  const gm = sorted.filter(isGm)
  const created: Layer = { id: input.id, name: input.name, order: 0, visibility: 'all', locked: false }
  return renumber([...common, created, ...gm])
}

/** Troca com a vizinha; `null` quando não é permitido (Mestre, inexistente ou fora dos limites). */
export function moveLayer(layers: Layer[], id: string, direction: 'up' | 'down'): Layer[] | null {
  if (id === GM_LAYER_ID) return null
  const sorted = sortLayers(layers)
  const common = sorted.filter((l) => !isGm(l))
  const gm = sorted.filter(isGm)
  const i = common.findIndex((l) => l.id === id)
  const j = direction === 'up' ? i + 1 : i - 1
  if (i === -1 || j < 0 || j >= common.length) return null
  ;[common[i], common[j]] = [common[j], common[i]]
  return renumber([...common, ...gm])
}

export function changedLayers(before: Layer[], after: Layer[]): Array<{ before: Layer | null; after: Layer }> {
  const previous = new Map(before.map((l) => [l.id, l]))
  return after
    .filter((l) => {
      const p = previous.get(l.id)
      return !p || p.order !== l.order || p.name !== l.name || p.visibility !== l.visibility || p.locked !== l.locked
    })
    .map((l) => ({ before: previous.get(l.id) ?? null, after: l }))
}
