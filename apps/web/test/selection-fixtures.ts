import type { TableObject } from '@mesa/shared'

export const server = (owner: string) => ({ ownerId: owner, version: 1, updatedBy: owner, control: { mode: 'list' as const, clientIds: [owner] } })

/** Traço a partir de pontos do mapa. */
export const strokeAt = (id: string, points: number[], over: Partial<TableObject> = {}): TableObject => {
  const xs = points.filter((_, i) => i % 2 === 0)
  const ys = points.filter((_, i) => i % 2 === 1)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    id, type: 'stroke', layerId: 'drawings', x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation: 0, zIndex: 1,
    segments: [points.map((v, i) => v - (i % 2 === 0 ? x : y))], color: '#ffffff', strokeWidth: 2, ...server('me'), ...over,
  } as TableObject
}

/** Imagem 20 x 20 na posição dada. */
export const tokenAt = (id: string, x: number, y: number, over: Partial<TableObject> = {}): TableObject =>
  ({ id, type: 'image', layerId: 'drawings', assetKey: 'a'.repeat(64), x, y, width: 20, height: 20, rotation: 0, zIndex: 2, ...server('me'), ...over }) as TableObject
