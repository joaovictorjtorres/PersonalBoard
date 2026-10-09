import { RULER_MAX_POINTS, cellCenter, formatDistance, rulerDistance, segmentDistance, type Point } from '@mesa/shared'
import type { Ruler } from '../store/state'

/** Rótulo da ponta: distância total (soma dos trechos). */
export function rulerLabel(nickname: string, ruler: Ruler, size: number): string {
  return `${nickname} · ${formatDistance(rulerDistance(ruler.points, size))}`
}

/** Começa no centro do quadrado clicado; a ponta segue o cursor. */
export function rulerStart(p: Point, size: number): Ruler {
  return { points: [cellCenter(p, size), p] }
}

/** A ponta (último ponto) vai para o cursor; início e dobras ficam. */
export function rulerMoveTo(ruler: Ruler, p: Point): Ruler {
  return { points: [...ruler.points.slice(0, -1), p] }
}

/**
 * Dobra no ponto do cursor, com o mesmo encaixe do início (centro do quadrado); a linha segue
 * dali até o cursor. No limite de pontos, ou repetindo a última dobra, nada muda (null).
 */
export function rulerBend(ruler: Ruler, p: Point, size: number): Ruler | null {
  if (ruler.points.length >= RULER_MAX_POINTS) return null
  const bend = cellCenter(p, size)
  const fixed = ruler.points.slice(0, -1)
  const last = fixed[fixed.length - 1]
  if (last && last.x === bend.x && last.y === bend.y) return null
  return { points: [...fixed, bend, p] }
}

/** Distância de cada trecho, no meio dele (só quando há dobras). */
export function rulerSegmentLabels(ruler: Ruler, size: number): Array<{ x: number; y: number; text: string }> {
  const pts = ruler.points
  if (pts.length < 3) return []
  return pts.slice(1).map((to, i) => {
    const from = pts[i]
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, text: formatDistance(segmentDistance(from, to, size)) }
  })
}
