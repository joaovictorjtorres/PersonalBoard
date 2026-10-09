import { useCallback, useEffect, useRef, useState } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { rectFromPoints, type Point } from '@mesa/shared'
import { useTableStore } from '../store/context'
import { pointInBox, type SelectionArea } from '../selection/model'

/** Abaixo disso (px de tela) o gesto é clique, não arrasto (o mesmo limiar da ferramenta Formas). */
export const CLICK_SLOP_PX = 3
/** Folga (px de tela) em volta da caixa da seleção para pegar o grupo. */
export const GRAB_PAD_PX = 6

type Gesture =
  | { kind: 'area'; additive: boolean; start: Point; end: Point; screen: Point; points: number[]; moved: boolean }
  | { kind: 'group'; start: Point; screen: Point; moved: boolean }

export function useSelectTool() {
  const store = useTableStore()
  const [area, setArea] = useState<SelectionArea | null>(null)
  const gesture = useRef<Gesture | null>(null)

  const cancel = useCallback(() => {
    gesture.current = null
    setArea(null)
    store.getState().actions.setSelectionOffset(null)
  }, [store])

  // Esc no meio do gesto cancela (a seleção em si é desfeita pelo atalho global): nada é enviado.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && gesture.current) cancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cancel])

  const areaOf = (g: Extract<Gesture, { kind: 'area' }>): SelectionArea =>
    store.getState().selectShape === 'lasso'
      ? { kind: 'lasso', points: [...g.points] }
      : { kind: 'rect', rect: rectFromPoints(g.start, g.end) }

  /** true = o gesto é da seleção (o resto do mousedown do Stage não roda). */
  const onDown = (e: KonvaEventObject<MouseEvent>): boolean => {
    const s = store.getState()
    if (s.tool !== 'select' || e.evt.button !== 0 || e.evt.ctrlKey || e.evt.metaKey) return false
    const stage = e.target.getStage()
    const pos = stage?.getRelativePointerPosition()
    if (!stage || !pos) return false
    if (e.target !== stage) {
      const item = e.target.findAncestor('.object', true)
      // Alças do Transformer e afins: não são da seleção em área.
      if (!item) return false
      // Sem Shift, apertar num item livre é do próprio item (seleciona só ele), mesmo dentro da caixa.
      if (!e.evt.shiftKey && item.draggable()) return false
    }
    const screen = { x: e.evt.clientX, y: e.evt.clientY }
    // A caixa tracejada é a seleção: apertar dentro dela pega o grupo.
    if (!e.evt.shiftKey && s.selection && pointInBox(pos, s.selection.bounds, GRAB_PAD_PX / s.viewport.scale)) {
      gesture.current = { kind: 'group', start: pos, screen, moved: false }
      return true
    }
    gesture.current = { kind: 'area', additive: e.evt.shiftKey, start: pos, end: pos, screen, points: [pos.x, pos.y], moved: false }
    return true
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
    const g = gesture.current
    if (!g) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    if (!g.moved && Math.hypot(e.evt.clientX - g.screen.x, e.evt.clientY - g.screen.y) < CLICK_SLOP_PX) return
    g.moved = true
    if (g.kind === 'group') {
      // Seleção desfeita no meio do arrasto (Esc, item apagado por outra pessoa): o arrasto acaba.
      if (!store.getState().selection) return cancel()
      store.getState().actions.setSelectionOffset({ x: pos.x - g.start.x, y: pos.y - g.start.y })
      return
    }
    g.end = pos
    g.points.push(pos.x, pos.y)
    setArea(areaOf(g))
  }

  const onUp = () => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    const { actions, selectionOffset } = store.getState()
    if (g.kind === 'group') {
      if (g.moved && selectionOffset) actions.moveSelection(selectionOffset.x, selectionOffset.y)
      else actions.setSelectionOffset(null)
      return
    }
    setArea(null)
    if (!g.moved) {
      // Shift + clique: ping, sem mexer na seleção. Clique simples no vazio: desfaz a seleção.
      if (g.additive) actions.ping(g.start, false)
      else actions.select(null)
      return
    }
    actions.selectArea(areaOf(g), g.additive)
  }

  return { area, onDown, onMove, onUp }
}
