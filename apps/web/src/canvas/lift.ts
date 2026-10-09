import { useEffect, type RefObject } from 'react'
import type Konva from 'konva'
import type { TableState } from '../store/state'
import type { TableStore } from '../store/tableStore'

/** Grupo, na camada de arrasto (acima de todas as camadas da mesa), que recebe os nós levantados. */
export const LIFT_GROUP_NAME = 'lift-items'

/**
 * Objetos que ficam por cima de todas as camadas na minha tela: o que eu arrasto sozinho e os itens
 * inteiros do grupo que eu arrasto. Em ordem de desenho (camada, depois zIndex).
 */
export function liftedIds(s: Pick<TableState, 'draggingId' | 'selection' | 'selectionOffset' | 'objects' | 'layers'>): string[] {
  const ids = new Set<string>()
  if (s.draggingId && s.objects[s.draggingId]) ids.add(s.draggingId)
  if (s.selectionOffset && s.selection) for (const id of s.selection.whole) if (s.objects[id]) ids.add(id)
  const order = new Map(s.layers.map((l, i) => [l.id, i]))
  const rank = (id: string) => order.get(s.objects[id].layerId) ?? -1
  return [...ids].sort((a, b) => rank(a) - rank(b) || s.objects[a].zIndex - s.objects[b].zIndex)
}

/**
 * Recoloca os nós de objeto de uma camada na ordem de `rank` (posição de cada id na lista da sua camada),
 * nos mesmos lugares que já ocupavam; os outros filhos (títulos, prévias, Transformer) ficam onde estão.
 * Conserta a inserção do react-konva, que usa o índice do vizinho: com o vizinho levantado, o item novo
 * cai no lugar errado. Devolve true se mudou algo.
 */
export function sortObjectNodes(container: Konva.Container, rank: ReadonlyMap<string, number>): boolean {
  const slots: number[] = []
  const nodes: Konva.Node[] = []
  container.children.forEach((child, i) => {
    if (!rank.has(child.id())) return
    slots.push(i)
    nodes.push(child)
  })
  const sorted = [...nodes].sort((a, b) => rank.get(a.id())! - rank.get(b.id())!)
  if (sorted.every((node, i) => node === nodes[i])) return false
  sorted.forEach((node, i) => (container.children[slots[i]] = node))
  container._setChildrenIndices()
  return true
}

interface Lifted {
  node: Konva.Node
  home: Konva.Container
  index: number
  opacity: number
}

/**
 * Levanta os nós do Konva para o grupo de arrasto e os devolve ao lugar exato de onde saíram. Roda na
 * mudança da store (antes do React redesenhar): ao soltar, o nó já está de volta na sua camada quando
 * o React reordena pelo zIndex novo. O nó em si não é recriado, então o arrasto do Konva continua.
 */
export function useLiftManager(stageRef: RefObject<Konva.Stage | null>, store: TableStore): void {
  useEffect(() => {
    let lifted: Lifted[] = []
    let key = ''

    const restoreAll = () => {
      // Ordem inversa: cada nó volta para o índice que tinha quando saiu.
      for (const { node, home, index, opacity } of lifted.reverse()) {
        if (!node.getParent()?.hasName(LIFT_GROUP_NAME)) continue // apagado, ou o React já o recolocou
        if (!home.getStage()) {
          node.destroy() // a camada de origem sumiu no meio do arrasto
          continue
        }
        node.moveTo(home)
        node.setZIndex(Math.min(index, home.children.length - 1))
        node.opacity(opacity)
      }
      lifted = []
    }

    const sync = (s: TableState) => {
      const ids = liftedIds(s)
      const next = ids.join(',')
      if (next === key) return
      key = next
      const stage = stageRef.current
      const group = stage?.findOne<Konva.Group>(`.${LIFT_GROUP_NAME}`)
      restoreAll()
      if (!stage) return
      if (group) for (const id of ids) {
        const node = stage.findOne(`#${id}`)
        const home = node?.getParent()
        if (!node || !home || home === group) continue
        const item = { node, home, index: node.index, opacity: node.opacity() }
        // A opacidade da camada (camada do mestre a 50%) vai junto.
        node.opacity(item.opacity * home.getAbsoluteOpacity())
        node.moveTo(group)
        lifted.push(item)
      }
      stage.batchDraw()
    }

    sync(store.getState())
    const unsubscribe = store.subscribe(sync)
    return () => {
      unsubscribe()
      restoreAll()
    }
  }, [stageRef, store])
}
