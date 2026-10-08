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
