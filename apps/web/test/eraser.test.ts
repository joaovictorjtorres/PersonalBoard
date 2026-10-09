import { describe, expect, it } from 'vitest'
import { MAX_SEGMENTS, MAX_SEGMENT_NUMBERS, type TableObject } from '@mesa/shared'
import { chunk, erasableBy, eraserRadius, fitSegmentLimits, planErase, rebaseSegments, type EraseInput } from '../src/canvas/eraser'

const stroke = (over: Partial<TableObject> = {}): TableObject =>
  ({
    id: 's1', type: 'stroke', layerId: 'drawings', x: 100, y: 100, width: 100, height: 0, rotation: 0, zIndex: 1,
    segments: [[0, 0, 100, 0]], color: '#ffffff', strokeWidth: 2,
    ownerId: 'me', version: 1, updatedBy: 'me', control: { mode: 'list', clientIds: ['me'] },
    ...over,
  }) as TableObject

const input = (over: Partial<EraseInput> = {}): EraseInput => ({
  objects: [stroke()],
  layerId: 'drawings',
  path: [150, 80, 150, 120],
  selfId: 'me',
  role: 'player',
  eraseAll: false,
  penWidth: 4,
  scale: 1,
  isLocked: () => false,
  ...over,
})

describe('eraserRadius', () => {
  it('max(8, espessura) / 2 em pixels de tela, dividido pelo zoom', () => {
    expect(eraserRadius(4, 1)).toBe(4)
    expect(eraserRadius(20, 1)).toBe(10)
    expect(eraserRadius(4, 2)).toBe(2)
  })
})

describe('erasableBy', () => {
  it('jogador apaga só traços que controla; nunca imagens', () => {
    expect(erasableBy(stroke(), 'me', 'player', false)).toBe(true)
    expect(erasableBy(stroke({ control: { mode: 'list', clientIds: ['other'] } }), 'me', 'player', false)).toBe(false)
    expect(erasableBy(stroke({ control: { mode: 'all', clientIds: [] } }), 'me', 'player', false)).toBe(true)
    const image = { ...stroke(), type: 'image', assetKey: 'a'.repeat(64) } as unknown as TableObject
    expect(erasableBy(image, 'me', 'player', false)).toBe(false)
  })

  it('mestre: "só os meus" usa ownerId; "de todos" apaga qualquer traço', () => {
    const others = stroke({ ownerId: 'p1' })
    expect(erasableBy(others, 'gm1', 'gm', false)).toBe(false)
    expect(erasableBy(stroke({ ownerId: 'gm1' }), 'gm1', 'gm', false)).toBe(true)
    expect(erasableBy(others, 'gm1', 'gm', true)).toBe(true)
  })

  it('traço órfão (jogador excluído mantendo as coisas): só o mestre com "de todos"', () => {
    const orphan = stroke({ ownerId: 'orphan', control: { mode: 'gm', clientIds: [] } })
    expect(erasableBy(orphan, 'me', 'player', false)).toBe(false)
    expect(erasableBy(orphan, 'orphan', 'player', false)).toBe(false)
    expect(erasableBy(orphan, 'gm1', 'gm', false)).toBe(false)
    expect(erasableBy(orphan, 'gm1', 'gm', true)).toBe(true)
  })
})

describe('rebaseSegments', () => {
  it('recalcula caixa e pontos relativos', () => {
    expect(rebaseSegments([[0, 0, 44, 0], [56, 0, 100, 10]], 100, 100)).toEqual({
      segments: [[0, 0, 44, 0], [56, 0, 100, 10]],
      x: 100, y: 100, width: 100, height: 10,
    })
    expect(rebaseSegments([[10, 5, 20, 5]], 100, 100)).toEqual({ segments: [[0, 0, 10, 0]], x: 110, y: 105, width: 10, height: 0 })
  })
})

describe('planErase', () => {
  it('passada no meio gera update com 2 pedaços e caixa recalculada', () => {
    // raio 4 + metade da espessura 1 = 5; passo 2 → some x ∈ [46, 54]
    const plan = planErase(input())
    expect(plan.ops).toEqual([
      { kind: 'update', id: 's1', patch: { segments: [[0, 0, 44, 0], [56, 0, 100, 0]], x: 100, y: 100, width: 100, height: 0 } },
    ])
    expect(plan.previews.s1).toEqual([[0, 0, 44, 0], [56, 0, 100, 0]])
  })

  it('cobrindo tudo vira delete com prévia vazia', () => {
    const plan = planErase(input({ path: [90, 100, 210, 100] }))
    expect(plan.ops).toEqual([{ kind: 'delete', id: 's1' }])
    expect(plan.previews.s1).toEqual([])
  })

  it('ignora traço travado por outra pessoa, de outra camada, que não controla ou longe', () => {
    expect(planErase(input({ isLocked: () => true })).ops).toEqual([])
    expect(planErase(input({ layerId: 'tokens' })).ops).toEqual([])
    expect(planErase(input({ objects: [stroke({ control: { mode: 'gm', clientIds: [] } })] })).ops).toEqual([])
    expect(planErase(input({ path: [500, 500, 600, 600] }))).toEqual({ previews: {}, ops: [] })
  })
})

// Review Focus #1
describe('fitSegmentLimits', () => {
  it('fica com os 200 pedaços de mais pontos, na ordem original', () => {
    const short = Array.from({ length: 200 }, (_, i) => [i, 0, i, 1])
    const long = Array.from({ length: 50 }, (_, i) => [i, 5, i, 6, i + 0.5, 7])
    const mixed = [...long.slice(0, 25), ...short, ...long.slice(25)]
    const out = fitSegmentLimits(mixed, 1)
    expect(out).toHaveLength(MAX_SEGMENTS)
    expect(out.filter((s) => s.length === 6)).toHaveLength(50)
    expect(out[0]).toBe(mixed[0])
  })

  it('simplifica mais forte até caber em 20 000 números', () => {
    const zigzag: number[] = []
    for (let i = 0; i < 12_500; i++) zigzag.push(i, i % 2) // 25 000 números, desvio 1
    const out = fitSegmentLimits([zigzag], 0.5)
    expect(out.reduce((n, s) => n + s.length, 0)).toBeLessThanOrEqual(MAX_SEGMENT_NUMBERS)
    expect(out[0].slice(0, 2)).toEqual([0, 0])
  })

  it('não mexe no que já cabe', () => {
    const ok = [[0, 0, 1, 1]]
    expect(fitSegmentLimits(ok, 1)).toBe(ok)
  })
})

describe('borracha em todas as camadas', () => {
  const other = stroke({ id: 's2', layerId: 'tokens' })

  it('sem layerIds só corta a camada ativa; com layerIds, todas as da lista', () => {
    expect(planErase(input({ objects: [stroke(), other] })).ops.map((o) => (o.kind === 'create' ? '' : o.id))).toEqual(['s1'])
    const all = planErase(input({ objects: [stroke(), other], layerIds: new Set(['drawings', 'tokens']) }))
    expect(all.ops.map((o) => (o.kind === 'create' ? '' : o.id))).toEqual(['s1', 's2'])
    expect(Object.keys(all.previews)).toEqual(['s1', 's2'])
  })

  it('camada fora da lista (travada ou oculta para a pessoa) fica de fora', () => {
    const locked = stroke({ id: 's3', layerId: 'map' })
    const all = planErase(input({ objects: [stroke(), locked], layerIds: new Set(['drawings']) }))
    expect(all.ops.map((o) => (o.kind === 'create' ? '' : o.id))).toEqual(['s1'])
  })

  it('chunk divide em lotes de até N', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 2)).toEqual([])
  })
})
