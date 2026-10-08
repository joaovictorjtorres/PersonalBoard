import {
  ERASER_MIN_SIZE,
  MAX_SEGMENTS,
  MAX_SEGMENT_NUMBERS,
  boundsOf,
  canControl,
  eraseSegments,
  pathTouchesBox,
  simplifyPoints,
  type Op,
  type Role,
  type TableObject,
} from '@mesa/shared'

/** Quem apaga o quê (spec §4.1). Travas e camada são checadas em planErase. */
export function erasableBy(object: TableObject, selfId: string, role: Role, eraseAll: boolean): boolean {
  if (object.type !== 'stroke') return false
  if (role === 'gm') return eraseAll || object.ownerId === selfId
  return canControl(object, selfId, role)
}

/** Raio em unidades do mundo: max(8, espessura) / 2 pixels de tela, dividido pelo zoom. */
export function eraserRadius(penWidth: number, scale: number): number {
  return Math.max(ERASER_MIN_SIZE, penWidth) / 2 / scale
}

export function rebaseSegments(
  segments: number[][],
  originX: number,
  originY: number,
): { segments: number[][]; x: number; y: number; width: number; height: number } {
  const world = segments.map((seg) => seg.map((v, i) => v + (i % 2 === 0 ? originX : originY)))
  const b = boundsOf(world.flat())
  return {
    segments: world.map((seg) => seg.map((v, i) => v - (i % 2 === 0 ? b.minX : b.minY))),
    x: b.minX,
    y: b.minY,
    width: b.width,
    height: b.height,
  }
}

/** Garante os limites do schema (200 pedaços, 20 000 números) para o update nunca virar `invalid`. */
export function fitSegmentLimits(segments: number[][], tolerance: number): number[][] {
  let out = segments
  if (out.length > MAX_SEGMENTS) {
    const keep = new Set(
      out
        .map((s, i) => [s.length, i] as const)
        .sort((a, b) => b[0] - a[0] || a[1] - b[1])
        .slice(0, MAX_SEGMENTS)
        .map(([, i]) => i),
    )
    out = out.filter((_, i) => keep.has(i))
  }
  let tol = tolerance
  while (out.reduce((n, s) => n + s.length, 0) > MAX_SEGMENT_NUMBERS) {
    tol *= 2
    out = out.map((s) => simplifyPoints(s, tol))
  }
  return out
}

export interface EraseInput {
  objects: TableObject[]
  layerId: string
  /** Caminho da borracha em coordenadas do mundo. */
  path: number[]
  selfId: string
  role: Role
  eraseAll: boolean
  penWidth: number
  scale: number
  isLocked: (id: string) => boolean
}

export function planErase(input: EraseInput): { previews: Record<string, number[][]>; ops: Op[] } {
  const radius = eraserRadius(input.penWidth, input.scale)
  const tolerance = 1 / input.scale
  const previews: Record<string, number[][]> = {}
  const ops: Op[] = []
  for (const o of input.objects) {
    if (o.type !== 'stroke' || o.layerId !== input.layerId) continue
    if (!erasableBy(o, input.selfId, input.role, input.eraseAll) || input.isLocked(o.id)) continue
    if (!pathTouchesBox(input.path, radius + o.strokeWidth / 2, o)) continue
    const local = input.path.map((v, i) => v - (i % 2 === 0 ? o.x : o.y))
    const cut = eraseSegments(o.segments, local, radius, o.strokeWidth, tolerance)
    if (cut === o.segments) continue
    const result = fitSegmentLimits(cut, tolerance)
    previews[o.id] = result
    ops.push(result.length === 0 ? { kind: 'delete', id: o.id } : { kind: 'update', id: o.id, patch: rebaseSegments(result, o.x, o.y) })
  }
  return { previews, ops }
}
