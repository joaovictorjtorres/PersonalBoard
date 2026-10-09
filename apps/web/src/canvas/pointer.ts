import type { KonvaEventObject } from 'konva/lib/Node'
import type { Point } from '@mesa/shared'

/** O que um aperto faz no canvas: principal (clique esquerdo/ponta da caneta), secundário (direito/botão da caneta) ou borracha (ponta de trás). */
export type PointerAction = 'primary' | 'secondary' | 'eraser'

interface ButtonState {
  pointerType?: string
  button: number
  buttons: number
}

/** Botão da caneta: 2 = botão lateral (vale como direito), 5 / buttons&32 = ponta da borracha. */
export function pointerAction(evt: ButtonState): PointerAction | null {
  const pen = evt.pointerType === 'pen'
  if (pen && (evt.button === 5 || (evt.buttons & 32) !== 0)) return 'eraser'
  if (evt.button === 2 || (pen && (evt.buttons & 2) !== 0)) return 'secondary'
  if (evt.button === 0) return 'primary'
  return null
}

/** Movimento sem nada apertado (caneta pairando sobre a mesa, mouse solto). */
export function isHover(evt: { buttons: number }): boolean {
  return evt.buttons === 0
}

interface ClientPoint {
  clientX: number
  clientY: number
}

/** Todos os pontos que o navegador juntou neste movimento (caneta rápida manda vários por quadro); sem suporte, só o do evento. */
export function coalescedPoints(evt: ClientPoint & { getCoalescedEvents?: () => ClientPoint[] }): ClientPoint[] {
  const list = typeof evt.getCoalescedEvents === 'function' ? evt.getCoalescedEvents() : []
  return (list.length > 0 ? list : [evt]).map((e) => ({ clientX: e.clientX, clientY: e.clientY }))
}

/** Converte pontos de tela para o mundo, como o getRelativePointerPosition do Konva. */
export function toWorld(points: ClientPoint[], origin: { left: number; top: number }, viewport: { x: number; y: number; scale: number }): Point[] {
  return points.map((p) => ({
    x: (p.clientX - origin.left - viewport.x) / viewport.scale,
    y: (p.clientY - origin.top - viewport.y) / viewport.scale,
  }))
}

/** Pontos do movimento no mundo, com os intermediários juntados pelo navegador. */
export function eventWorldPoints(e: KonvaEventObject<MouseEvent>): Point[] {
  const stage = e.target.getStage()
  if (!stage) return []
  const rect = stage.content.getBoundingClientRect()
  return toWorld(coalescedPoints(e.evt as PointerEvent), rect, { x: stage.x(), y: stage.y(), scale: stage.scaleX() })
}
