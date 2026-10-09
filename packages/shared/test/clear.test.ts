import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, OpSchema, clearTargets, isDrawing, type Layer, type TableObject } from '../src'

const base = { x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, version: 1 }
const own = (clientId: string) => ({ ownerId: clientId, updatedBy: clientId, control: { mode: 'list' as const, clientIds: [clientId] } })
const stroke = (id: string, layerId: string, owner: string): TableObject =>
  ({ ...base, ...own(owner), id, layerId, type: 'stroke', segments: [[0, 0, 1, 1]], color: '#ffffff', strokeWidth: 2 }) as TableObject
const rect = (id: string, layerId: string, owner: string): TableObject =>
  ({ ...base, ...own(owner), id, layerId, type: 'shape', kind: 'rect', stroke: '#ffffff', strokeWidth: 2, fill: null }) as TableObject
const image = (id: string, layerId: string, owner: string): TableObject =>
  ({ ...base, ...own(owner), id, layerId, type: 'image', assetKey: 'a'.repeat(64) }) as TableObject

const layers: Layer[] = DEFAULT_LAYERS.map((l) => (l.id === 'map' ? { ...l, locked: true } : l))
const objects = [
  stroke('s1', 'drawings', 'A'),
  rect('r1', 'tokens', 'A'),
  image('i1', 'drawings', 'A'),
  stroke('s2', 'drawings', 'B'),
  stroke('s3', 'map', 'A'), // travada para jogadores
  stroke('s4', 'gm', 'A'), // oculta (o jogador nem a recebe, mas o servidor tem)
]
const ids = (list: TableObject[]) => list.map((o) => o.id).sort()
const player = { clientId: 'A', role: 'player' as const }
const gm = { clientId: 'G', role: 'gm' as const }

describe('clearObjects — schema', () => {
  it('aceita desenhos de uma camada ou de todas, com ou sem autor', () => {
    expect(OpSchema.safeParse({ kind: 'clearObjects', layerId: 'drawings', scope: 'drawings' }).success).toBe(true)
    expect(OpSchema.safeParse({ kind: 'clearObjects', layerId: null, authorId: 'A', scope: 'drawings' }).success).toBe(true)
    expect(OpSchema.safeParse({ kind: 'clearObjects', layerId: 'tokens', scope: 'all' }).success).toBe(true)
  })
  it('recusa "tudo" em todas as camadas, "tudo" com autor e escopo desconhecido', () => {
    expect(OpSchema.safeParse({ kind: 'clearObjects', layerId: null, scope: 'all' }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'clearObjects', layerId: 'tokens', authorId: 'A', scope: 'all' }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'clearObjects', layerId: 'tokens', scope: 'images' }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'clearObjects', layerId: 'bad id', scope: 'drawings' }).success).toBe(false)
  })
})

describe('clearTargets', () => {
  it('desenhos são traços e formas; imagens nunca', () => {
    expect(objects.filter(isDrawing).map((o) => o.id)).toEqual(['s1', 'r1', 's2', 's3', 's4'])
  })

  it('jogador: só os próprios desenhos, pulando camadas ocultas e travadas', () => {
    expect(ids(clearTargets(objects, layers, { layerId: null, authorId: 'A', scope: 'drawings' }, player))).toEqual(['r1', 's1'])
    expect(ids(clearTargets(objects, layers, { layerId: 'drawings', authorId: 'A', scope: 'drawings' }, player))).toEqual(['s1'])
    expect(clearTargets(objects, layers, { layerId: 'map', authorId: 'A', scope: 'drawings' }, player)).toEqual([])
    expect(clearTargets(objects, layers, { layerId: 'gm', authorId: 'A', scope: 'drawings' }, player)).toEqual([])
  })

  it('jogador não apaga de outra pessoa nem limpa a camada', () => {
    expect(clearTargets(objects, layers, { layerId: 'drawings', authorId: 'B', scope: 'drawings' }, player)).toEqual([])
    expect(clearTargets(objects, layers, { layerId: 'drawings', scope: 'drawings' }, player)).toEqual([])
    expect(clearTargets(objects, layers, { layerId: 'drawings', scope: 'all' }, player)).toEqual([])
  })

  it('jogador pula o próprio desenho cujo controle o mestre tirou', () => {
    const taken = { ...stroke('s9', 'drawings', 'A'), control: { mode: 'gm' as const, clientIds: [] } }
    expect(clearTargets([taken], layers, { layerId: null, authorId: 'A', scope: 'drawings' }, player)).toEqual([])
  })

  it('mestre: desenhos de alguém em todas as camadas (inclui ocultas e travadas), de todos numa camada, ou tudo', () => {
    expect(ids(clearTargets(objects, layers, { layerId: null, authorId: 'A', scope: 'drawings' }, gm))).toEqual(['r1', 's1', 's3', 's4'])
    expect(ids(clearTargets(objects, layers, { layerId: 'drawings', scope: 'drawings' }, gm))).toEqual(['s1', 's2'])
    expect(ids(clearTargets(objects, layers, { layerId: 'drawings', scope: 'all' }, gm))).toEqual(['i1', 's1', 's2'])
    expect(clearTargets(objects, layers, { layerId: null, scope: 'all' }, gm)).toEqual([])
  })
})
