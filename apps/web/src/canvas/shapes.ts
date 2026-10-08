import type { NewObject, Point, ShapeKind } from '@mesa/shared'
import type { ShapeFill } from '../store/state'

export interface ShapeGeometry {
  x: number
  y: number
  width: number
  height: number
  /** Só linha: [x1, y1, x2, y2] relativos a (x, y). */
  points?: [number, number, number, number]
}

// 3 casas bastam e evitam lixo de ponto flutuante (ex.: cos(90°) ≈ 6e-17); `+ 0` tira o -0.
const round = (v: number) => Math.round(v * 1000) / 1000 + 0

/** Geometria da forma arrastada de `start` até `end`. Shift: quadrado/círculo, ou linha a 45°. */
export function shapeFromDrag(kind: ShapeKind, start: Point, end: Point, shift: boolean): ShapeGeometry {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let ex = end.x
  let ey = end.y
  if (shift && kind === 'line') {
    const length = Math.hypot(dx, dy)
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    ex = round(start.x + length * Math.cos(angle))
    ey = round(start.y + length * Math.sin(angle))
  } else if (shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    ex = start.x + (dx < 0 ? -side : side)
    ey = start.y + (dy < 0 ? -side : side)
  }
  const x = Math.min(start.x, ex)
  const y = Math.min(start.y, ey)
  const box = { x, y, width: Math.abs(ex - start.x), height: Math.abs(ey - start.y) }
  if (kind !== 'line') return box
  return { ...box, points: [start.x - x, start.y - y, ex - x, ey - y] }
}

export function shapeFillFor(kind: ShapeKind, fill: ShapeFill, stroke: string): { color: string; opacity: number } | null {
  if (kind === 'line' || !fill.enabled) return null
  return { color: fill.color ?? stroke, opacity: fill.opacity }
}

export function hexToRgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`
}

export function newShapeObject(input: {
  id: string
  layerId: string
  zIndex: number
  kind: ShapeKind
  geometry: ShapeGeometry
  stroke: string
  strokeWidth: number
  fill: ShapeFill
}): NewObject {
  const { points, ...box } = input.geometry
  return {
    id: input.id,
    type: 'shape',
    kind: input.kind,
    layerId: input.layerId,
    ...box,
    rotation: 0,
    zIndex: input.zIndex,
    stroke: input.stroke,
    strokeWidth: input.strokeWidth,
    fill: shapeFillFor(input.kind, input.fill, input.stroke),
    ...(input.kind === 'line' && points ? { points } : {}),
  } as NewObject
}
