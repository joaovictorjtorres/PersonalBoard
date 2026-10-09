import { useEffect, useState } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { useTable, useTableActions, useTableStore } from '../store/context'
import type { Geometry } from '../store/state'
import { cancelNodeDrag, commitNodeChange } from './nodeChange'
import { isPingClick, usePingDragGuard } from './ping'
import { pointerAction } from './pointer'

/**
 * Clique e arrasto de um objeto (imagem, traço, forma): seleciona, trava, mostra a prévia e confirma ao
 * soltar. Enquanto eu arrasto, o objeto fica por cima de todas as camadas (useLiftManager); Esc cancela.
 */
export function useObjectDrag(id: string, interactive: boolean, geometryOf: (node: Konva.Node) => Geometry) {
  const store = useTableStore()
  const actions = useTableActions()
  const pingGuard = usePingDragGuard()
  const dragging = useTable((s) => s.draggingId === id)
  const [node, setNode] = useState<Konva.Node | null>(null)

  useEffect(() => {
    if (!dragging || !node) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      pingGuard.cancel()
      node.stopDrag() // dispara o dragend na hora; o guarda faz ele não confirmar nada
      cancelNodeDrag(store, id, node)
      actions.endDrag(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragging, node, pingGuard, store, actions, id])

  return {
    ref: setNode,
    onPointerDown: (e: KonvaEventObject<PointerEvent>) => {
      pingGuard.pointerDown(e.evt)
      if (interactive && !isPingClick(e.evt) && pointerAction(e.evt) !== 'eraser') actions.select(id)
    },
    onDragStart: (e: KonvaEventObject<DragEvent>) => {
      if (pingGuard.dragStart(() => e.target.stopDrag())) return
      actions.startDrag(id)
    },
    onDragMove: (e: KonvaEventObject<DragEvent>) => actions.dragPreview(id, geometryOf(e.target)),
    onDragEnd: (e: KonvaEventObject<DragEvent>) => {
      if (!pingGuard.dragEnd()) commitNodeChange(store, id, e.target, 'drag')
      actions.endDrag(id)
    },
  }
}
