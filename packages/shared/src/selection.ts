import type { Box, Point } from './grid'

/** Caixa de um objeto; a rotação (graus) é em torno de (x, y), como no Konva. */
export interface RotatedBox extends Box {
  rotation: number
}

/** Pedaços de um traço (pontos planos [x0, y0, ...]) dentro e fora de uma área. */
export interface StrokeSplit {
  inside: number[][]
  outside: number[][]
}

/** Retângulo como polígono plano. */
export function rectPolygon(r: Box): number[] {
  return [r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height]
}

/** Retângulo do arrasto entre dois pontos, em qualquer direção. */
export function rectFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

/** Os 4 cantos da caixa girada, planos e em ordem. */
export function boxCorners(b: RotatedBox): number[] {
  const r = (b.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const out: number[] = []
  const local: Array<[number, number]> = [[0, 0], [b.width, 0], [b.width, b.height], [0, b.height]]
  for (const [px, py] of local) out.push(b.x + px * cos - py * sin, b.y + px * sin + py * cos)
  return out
}

/** Regra par/ímpar (vale para laço que se cruza); menos de 3 pontos não contém nada. */
export function pointInPolygon(x: number, y: number, polygon: number[]): boolean {
  const n = polygon.length / 2
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[2 * i], yi = polygon[2 * i + 1]
    const xj = polygon[2 * j], yj = polygon[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Parâmetros t (0 < t < 1) em que o segmento a→b cruza alguma aresta do polígono fechado. */
function crossings(ax: number, ay: number, bx: number, by: number, polygon: number[]): number[] {
  const out: number[] = []
  const n = polygon.length / 2
  const dx = bx - ax
  const dy = by - ay
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const cx = polygon[2 * i], cy = polygon[2 * i + 1]
    const ex = polygon[2 * j] - cx, ey = polygon[2 * j + 1] - cy
    const den = dx * ey - dy * ex
    if (den === 0) continue // paralelos
    const t = ((cx - ax) * ey - (cy - ay) * ex) / den
    const u = ((cx - ax) * dy - (cy - ay) * dx) / den
    if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t)
  }
  return out
}

const inRect = (x: number, y: number, r: Box) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height

/** O item inteiro (caixa girada) dentro do retângulo; a borda conta como dentro. */
export function insideRect(item: RotatedBox, rect: Box): boolean {
  const c = boxCorners(item)
  for (let i = 0; i < c.length; i += 2) if (!inRect(c[i], c[i + 1], rect)) return false
  return true
}

/** O item inteiro (caixa girada) dentro do laço (par/ímpar). */
export function insidePolygon(item: RotatedBox, polygon: number[]): boolean {
  if (polygon.length < 6) return false
  const c = boxCorners(item)
  for (let i = 0; i < c.length; i += 2) if (!pointInPolygon(c[i], c[i + 1], polygon)) return false
  // Laço côncavo pode entrar na caixa sem cobrir um canto: nenhuma aresta da caixa pode cruzar o laço.
  for (let i = 0; i < 8; i += 2) {
    if (crossings(c[i], c[i + 1], c[(i + 2) % 8], c[(i + 3) % 8], polygon).length > 0) return false
  }
  return true
}

/**
 * Corta o traço (pontos planos) nas arestas do polígono, exatamente no ponto de cruzamento.
 * Cada trecho é classificado pelo seu ponto do meio (par/ímpar). Laço com menos de 3 pontos: tudo fora.
 */
export function splitStrokeByPolygon(points: number[], polygon: number[]): StrokeSplit {
  const n = points.length / 2
  if (polygon.length < 6 || n < 2) return { inside: [], outside: n >= 1 ? [points.slice()] : [] }
  const inside: number[][] = []
  const outside: number[][] = []
  let run: number[] = [points[0], points[1]]
  let runInside: boolean | null = null
  const close = () => {
    if (run.length >= 4 && runInside !== null) (runInside ? inside : outside).push(run)
  }
  for (let i = 0; i < n - 1; i++) {
    const ax = points[2 * i], ay = points[2 * i + 1]
    const bx = points[2 * i + 2], by = points[2 * i + 3]
    const cuts = [0, ...[...new Set(crossings(ax, ay, bx, by, polygon))].sort((p, q) => p - q), 1]
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k]
      const t1 = cuts[k + 1]
      const tm = (t0 + t1) / 2
      const piece = pointInPolygon(ax + (bx - ax) * tm, ay + (by - ay) * tm, polygon)
      if (runInside === null) runInside = piece
      if (piece !== runInside) {
        close()
        run = [ax + (bx - ax) * t0, ay + (by - ay) * t0]
        runInside = piece
      }
      if (t1 === 1) run.push(bx, by)
      else run.push(ax + (bx - ax) * t1, ay + (by - ay) * t1)
    }
  }
  close()
  return { inside, outside }
}

export function splitStrokeByRect(points: number[], rect: Box): StrokeSplit {
  return splitStrokeByPolygon(points, rectPolygon(rect))
}
