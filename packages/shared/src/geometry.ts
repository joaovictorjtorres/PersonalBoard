// Ramer–Douglas–Peucker iterativo sobre array plano [x0,y0,x1,y1,...].
export function simplifyPoints(points: number[], tolerance: number): number[] {
  const n = points.length / 2
  if (n <= 2) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const tol2 = tolerance * tolerance
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    let maxDist = -1
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance2(points, i, a, b)
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (index !== -1 && maxDist > tol2) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[2 * i], points[2 * i + 1])
  return out
}

function segmentDistance2(p: number[], i: number, a: number, b: number): number {
  const px = p[2 * i], py = p[2 * i + 1]
  const ax = p[2 * a], ay = p[2 * a + 1]
  const bx = p[2 * b], by = p[2 * b + 1]
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx - px
  const cy = ay + t * dy - py
  return cx * cx + cy * cy
}

export function boundsOf(points: number[]): { minX: number; minY: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i])
    maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1])
    maxY = Math.max(maxY, points[i + 1])
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

/**
 * Apaga dos pedaços tudo que estiver a até `radius + strokeWidth / 2` do caminho da borracha.
 * `segments` e `eraserPath` precisam estar no mesmo referencial. Devolve a MESMA referência
 * de `segments` quando nada foi apagado; pedaços não tocados são reaproveitados.
 */
export function eraseSegments(
  segments: number[][],
  eraserPath: number[],
  radius: number,
  strokeWidth: number,
  tolerance = 1,
): number[][] {
  if (eraserPath.length < 2) return segments
  const reach = radius + strokeWidth / 2
  const reach2 = reach * reach
  const step = Math.max(radius / 2, 0.01)
  const out: number[][] = []
  let changed = false

  for (const segment of segments) {
    const pts = resample(segment, step)
    const n = pts.length / 2
    const keep: boolean[] = []
    let removed = 0
    for (let i = 0; i < n; i++) {
      const hit = distanceToPath2(pts[2 * i], pts[2 * i + 1], eraserPath) <= reach2
      keep.push(!hit)
      if (hit) removed++
    }
    if (removed === 0) {
      out.push(segment)
      continue
    }
    changed = true
    let run: number[] = []
    const flush = () => {
      if (run.length >= 4 && pathLength(run) >= 2) out.push(simplifyPoints(run, tolerance))
      run = []
    }
    for (let i = 0; i < n; i++) {
      if (keep[i]) run.push(pts[2 * i], pts[2 * i + 1])
      else flush()
    }
    flush()
  }
  return changed ? out : segments
}

/** Caixa do caminho expandida por `reach` encosta na caixa do objeto? */
export function pathTouchesBox(
  path: number[],
  reach: number,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  if (path.length < 2) return false
  const b = boundsOf(path)
  return (
    b.minX - reach <= box.x + box.width &&
    b.minX + b.width + reach >= box.x &&
    b.minY - reach <= box.y + box.height &&
    b.minY + b.height + reach >= box.y
  )
}

// Insere pontos a cada `step` em toda aresta, para que arestas longas também sejam cortadas no meio.
function resample(points: number[], step: number): number[] {
  const n = points.length / 2
  const out: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const ax = points[2 * i], ay = points[2 * i + 1]
    const bx = points[2 * i + 2], by = points[2 * i + 3]
    const parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 0; k < parts; k++) out.push(ax + ((bx - ax) * k) / parts, ay + ((by - ay) * k) / parts)
  }
  out.push(points[2 * (n - 1)], points[2 * (n - 1) + 1])
  return out
}

function distanceToPath2(px: number, py: number, path: number[]): number {
  if (path.length === 2) return (px - path[0]) ** 2 + (py - path[1]) ** 2
  let best = Infinity
  for (let i = 0; i + 3 < path.length; i += 2) {
    best = Math.min(best, pointSegmentDistance2(px, py, path[i], path[i + 1], path[i + 2], path[i + 3]))
  }
  return best
}

function pointSegmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx - px
  const cy = ay + t * dy - py
  return cx * cx + cy * cy
}

function pathLength(points: number[]): number {
  let total = 0
  for (let i = 2; i < points.length; i += 2) total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1])
  return total
}
