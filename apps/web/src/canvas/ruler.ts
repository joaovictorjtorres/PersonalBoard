import { RULER_MAX_POINTS, cellCenter, formatDistance, rulerDistance, segmentDistance, type Point } from '@mesa/shared'
import type { Ruler } from '../store/state'

/** Rótulo da ponta: distância total (soma dos trechos). */
export function rulerLabel(nickname: string, ruler: Ruler, size: number): string {
  return `${nickname} · ${formatDistance(rulerDistance(ruler.points, size))}`
}

/**
 * Começa exatamente no ponto clicado; a ponta segue o cursor. A linha não encaixa em nada: só a
 * distância usa o centro dos quadrados (ver `rulerDistance`).
 */
export function rulerStart(p: Point): Ruler {
  return { points: [p, p] }
}

/** A ponta (último ponto) vai para o cursor; início e dobras ficam. */
export function rulerMoveTo(ruler: Ruler, p: Point): Ruler {
  return { points: [...ruler.points.slice(0, -1), p] }
}

/**
 * Dobra exatamente no ponto do cursor; a linha segue dali até o cursor. No limite de pontos, ou no
 * mesmo quadrado do ponto anterior (o trecho mediria 0 m), nada muda (null).
 */
export function rulerBend(ruler: Ruler, p: Point, size: number): Ruler | null {
  if (ruler.points.length >= RULER_MAX_POINTS) return null
  const fixed = ruler.points.slice(0, -1)
  const last = fixed[fixed.length - 1]
  if (last) {
    const a = cellCenter(last, size)
    const b = cellCenter(p, size)
    if (a.x === b.x && a.y === b.y) return null
  }
  return { points: [...fixed, p, p] }
}

/** Distância de cada trecho, no meio da linha desenhada (só quando há dobras). */
export function rulerSegmentLabels(ruler: Ruler, size: number): Array<{ x: number; y: number; text: string }> {
  const pts = ruler.points
  if (pts.length < 3) return []
  return pts.slice(1).map((to, i) => {
    const from = pts[i]
    return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2, text: formatDistance(segmentDistance(from, to, size)) }
  })
}
