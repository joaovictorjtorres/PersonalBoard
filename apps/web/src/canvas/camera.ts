import type { Point } from '@mesa/shared'
import type { Viewport } from '../store/state'

/** Viewport que centraliza `p` (coordenadas do mapa) na tela, mantendo o zoom atual. */
export function centerOn(v: Viewport, p: Point, screenW: number, screenH: number): Viewport {
  return { x: screenW / 2 - p.x * v.scale, y: screenH / 2 - p.y * v.scale, scale: v.scale }
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

export function glideStep(from: Viewport, to: Viewport, t: number): Viewport {
  const k = easeInOut(Math.min(1, Math.max(0, t)))
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, scale: to.scale }
}
