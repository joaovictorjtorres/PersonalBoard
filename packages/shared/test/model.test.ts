import { describe, expect, it } from 'vitest'
import { NewObjectSchema, ObjectPatchSchema, TableObjectSchema, canControl, mergePatch, type TableObject } from '../src'

const stroke = {
  id: 's1', type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1,
  segments: [[0, 0, 10, 10]], color: '#ffffff', strokeWidth: 3,
}
const server = { ownerId: 'A', version: 1, updatedBy: 'A', control: { mode: 'list', clientIds: ['A'] } }
const stored = (over: Record<string, unknown> = {}) => ({ ...stroke, ...server, ...over }) as TableObject

describe('segments', () => {
  it('aceita vários pedaços', () => {
    expect(NewObjectSchema.safeParse({ ...stroke, segments: [[0, 0, 1, 1], [5, 5, 6, 6, 7, 7]] }).success).toBe(true)
  })

  it('recusa pedaço com 1 ponto, quantidade ímpar ou lista vazia', () => {
    expect(NewObjectSchema.safeParse({ ...stroke, segments: [[0, 0]] }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...stroke, segments: [[0, 0, 1, 1, 2]] }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...stroke, segments: [] }).success).toBe(false)
  })

  it('aceita 200 pedaços e recusa 201', () => {
    const many = (n: number) => Array.from({ length: n }, () => [0, 0, 1, 1])
    expect(NewObjectSchema.safeParse({ ...stroke, segments: many(200) }).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...stroke, segments: many(201) }).success).toBe(false)
  })

  it('aceita 20 000 números somados e recusa mais', () => {
    const ok = [new Array(10_000).fill(0), new Array(10_000).fill(0)]
    const tooMany = [new Array(10_000).fill(0), new Array(10_002).fill(0)]
    expect(NewObjectSchema.safeParse({ ...stroke, segments: ok }).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...stroke, segments: tooMany }).success).toBe(false)
  })

  it('traço no formato do M1 (points) não é um TableObject válido', () => {
    const { segments: _s, ...rest } = stored() as Record<string, unknown>
    expect(TableObjectSchema.safeParse({ ...rest, points: [0, 0, 1, 1] }).success).toBe(false)
  })
})

describe('control e title', () => {
  it('NewObject descarta control enviado pelo cliente', () => {
    const parsed = NewObjectSchema.parse({ ...stroke, control: { mode: 'all', clientIds: [] } })
    expect(parsed).not.toHaveProperty('control')
  })

  it('TableObject exige control', () => {
    const { control: _c, ...noControl } = stored()
    expect(TableObjectSchema.safeParse(noControl).success).toBe(false)
    expect(TableObjectSchema.safeParse(stored()).success).toBe(true)
  })

  it('patch aceita control, title (aparado), null e segments', () => {
    expect(ObjectPatchSchema.parse({ control: { mode: 'gm', clientIds: [] }, title: '  Goblin  ', segments: [[0, 0, 1, 1]] })).toEqual({
      control: { mode: 'gm', clientIds: [] },
      title: 'Goblin',
      segments: [[0, 0, 1, 1]],
    })
    expect(ObjectPatchSchema.parse({ title: null })).toEqual({ title: null })
  })

  // Review Focus #2
  it('recusa título só com espaços ou com mais de 40 caracteres', () => {
    expect(ObjectPatchSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(ObjectPatchSchema.safeParse({ title: 'x'.repeat(41) }).success).toBe(false)
    expect(ObjectPatchSchema.safeParse({ title: 'x'.repeat(40) }).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...stroke, title: '   ' }).success).toBe(false)
  })

  it('recusa control com mais de 20 ids ou modo desconhecido', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `c${i}`)
    expect(ObjectPatchSchema.safeParse({ control: { mode: 'list', clientIds: ids } }).success).toBe(false)
    expect(ObjectPatchSchema.safeParse({ control: { mode: 'list', clientIds: ids.slice(0, 20) } }).success).toBe(true)
    expect(ObjectPatchSchema.safeParse({ control: { mode: 'todos', clientIds: [] } }).success).toBe(false)
  })

  it('patch não aceita mais points', () => {
    expect(ObjectPatchSchema.safeParse({ points: [0, 0, 1, 1] }).success).toBe(false)
  })
})

describe('mergePatch', () => {
  it('aplica campos e remove title com null', () => {
    const withTitle = stored({ title: 'Orc' })
    expect(mergePatch(withTitle, { x: 5 })).toMatchObject({ x: 5, title: 'Orc' })
    expect(mergePatch(withTitle, { title: null })).not.toHaveProperty('title')
    expect(withTitle.title).toBe('Orc')
  })
})

describe('canControl', () => {
  const obj = (mode: 'all' | 'gm' | 'list', clientIds: string[] = []) => ({ control: { mode, clientIds } })
  it('mestre sempre controla', () => {
    expect(canControl(obj('gm'), 'G', 'gm')).toBe(true)
    expect(canControl(obj('list', ['A']), 'G', 'gm')).toBe(true)
  })
  it('jogador: all sim, gm não, list só se estiver na lista', () => {
    expect(canControl(obj('all'), 'B', 'player')).toBe(true)
    expect(canControl(obj('gm', ['B']), 'B', 'player')).toBe(false)
    expect(canControl(obj('list', ['A', 'B']), 'B', 'player')).toBe(true)
    expect(canControl(obj('list', ['A']), 'B', 'player')).toBe(false)
  })
})

describe('formas (M3)', () => {
  const shape = {
    id: 'sh1', type: 'shape', layerId: 'drawings', x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1,
    kind: 'rect', stroke: '#ffffff', strokeWidth: 3, fill: null,
  }
  const line = { ...shape, kind: 'line', points: [0, 0, 100, 50] }

  it('retângulo e elipse, com ou sem preenchimento', () => {
    expect(NewObjectSchema.safeParse(shape).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...shape, kind: 'ellipse', fill: { color: '#ff0000', opacity: 0.3 } }).success).toBe(true)
  })

  it('linha exige points e não tem preenchimento; rect/ellipse não têm points', () => {
    expect(NewObjectSchema.safeParse(line).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...line, points: undefined }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...line, fill: { color: '#ff0000', opacity: 0.3 } }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...line, points: [0, 0, 1] }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, points: [0, 0, 1, 1] }).success).toBe(false)
  })

  it('limites: espessura 1..30, opacidade 0..1, cor #rrggbb e tipo conhecido', () => {
    expect(NewObjectSchema.safeParse({ ...shape, strokeWidth: 30 }).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...shape, strokeWidth: 31 }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, strokeWidth: 0 }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, fill: { color: '#ff0000', opacity: 1.1 } }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, stroke: 'white' }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, kind: 'polygon' }).success).toBe(false)
  })

  it('forma gravada exige campos de servidor; imagens e traços do M2 continuam válidos sem migração', () => {
    expect(TableObjectSchema.safeParse({ ...shape, ...server }).success).toBe(true)
    expect(TableObjectSchema.safeParse(shape).success).toBe(false)
    expect(TableObjectSchema.safeParse(stored()).success).toBe(true)
  })
})
