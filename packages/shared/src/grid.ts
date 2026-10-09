export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

// `+ 0` transforma -0 em 0 (Math.round(-0.3) === -0).
const snap = (value: number, size: number) => Math.round(value / size) * size + 0
const snapSide = (value: number, size: number) => Math.max(size, snap(value, size))

/** x/y no múltiplo de `size` mais próximo; largura/altura no múltiplo mais próximo, mínimo `size`. */
export function snapToGrid(box: Box, size: number): Box {
  return { x: snap(box.x, size), y: snap(box.y, size), width: snapSide(box.width, size), height: snapSide(box.height, size) }
}

/** Encaixa só os campos de geometria presentes; os outros (ex.: rotation) passam intactos. */
export function snapPatch<T extends Partial<Box>>(patch: T, size: number): T {
  const out: Partial<Box> = {}
  if (patch.x !== undefined) out.x = snap(patch.x, size)
  if (patch.y !== undefined) out.y = snap(patch.y, size)
  if (patch.width !== undefined) out.width = snapSide(patch.width, size)
  if (patch.height !== undefined) out.height = snapSide(patch.height, size)
  return { ...patch, ...out }
}

export function cellCenter(p: Point, size: number): Point {
  return { x: (Math.floor(p.x / size) + 0.5) * size, y: (Math.floor(p.y / size) + 0.5) * size }
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** Distância em quadrados (= metros) de um trecho, com uma casa decimal. */
export function segmentDistance(from: Point, to: Point, size: number): number {
  return round1(Math.hypot(to.x - from.x, to.y - from.y) / size)
}

/** Distância total da régua (soma de todos os trechos), em quadrados (= metros), com uma casa decimal. */
export function rulerDistance(points: readonly Point[], size: number): number {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return round1(total / size)
}

/** Cada quadrado da grade vale 1 metro: a distância em quadrados é a mesma em metros. */
export function formatDistance(metres: number): string {
  return `${metres.toFixed(1).replace('.', ',')} m`
}
