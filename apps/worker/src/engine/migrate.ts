import type { TableObject } from '@mesa/shared'

// Objetos gravados pelo M1: traço com `points` e nenhum `control`.
// A versão normalizada é gravada na próxima escrita do objeto.
export function normalizeObject(raw: Record<string, unknown>): TableObject {
  const o: Record<string, unknown> = { ...raw }
  if (o.type === 'stroke' && !Array.isArray(o.segments)) {
    let points = Array.isArray(o.points) ? (o.points as number[]) : []
    if (points.length === 2) points = [points[0], points[1], points[0] + 0.01, points[1]]
    o.segments = [points]
  }
  delete o.points
  if (!o.control) o.control = { mode: 'list', clientIds: [o.ownerId] }
  return o as unknown as TableObject
}
