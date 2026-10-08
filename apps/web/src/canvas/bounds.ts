import type { Geometry } from '../store/state'

/** Caixa alinhada aos eixos de um retângulo girado em torno de (x, y) — a origem de rotação do Konva. */
export function rotatedBounds(g: Geometry): { minX: number; minY: number; maxX: number; maxY: number } {
  const r = (g.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const corners: Array<[number, number]> = [[0, 0], [g.width, 0], [0, g.height], [g.width, g.height]]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of corners) {
    const x = g.x + px * cos - py * sin
    const y = g.y + px * sin + py * cos
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}
