import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, type TableObject } from '@mesa/shared'
import {
  addArea,
  collectSelection,
  dropFromSelection,
  isInSelection,
  pointInBox,
  selectionOfIds,
  type SelectContext,
  type SelectionArea,
} from '../src/selection/model'
import { server, strokeAt, tokenAt } from './selection-fixtures'

const rect = (x: number, y: number, width: number, height: number): SelectionArea => ({ kind: 'rect', rect: { x, y, width, height } })
const ctx = (objects: TableObject[], over: Partial<SelectContext> = {}): SelectContext => ({
  objects: Object.fromEntries(objects.map((o) => [o.id, o])),
  layers: DEFAULT_LAYERS, activeLayerId: 'drawings', allLayers: false, selfId: 'me', role: 'player', isLocked: () => false,
  ...over,
})

describe('collectSelection', () => {
  const line = strokeAt('l', [0, 50, 200, 50])
  const t1 = tokenAt('t1', 60, 40)
  const t2 = tokenAt('t2', 140, 40)

  it('retângulo: token inteiro entra, o traço é cortado na borda, token pela metade fica de fora', () => {
    const sel = collectSelection([rect(50, 0, 100, 100)], ctx([line, t1, t2]))!
    expect(sel.whole).toEqual(['t1'])
    expect(sel.parts).toEqual({ l: { inside: [[50, 50, 150, 50]], outside: [[0, 50, 50, 50], [150, 50, 200, 50]] } })
    expect(sel.bounds).toEqual({ x: 50, y: 40, width: 100, height: 20 })
  })

  it('traço todo dentro entra inteiro, sem corte', () => {
    expect(collectSelection([rect(50, 0, 100, 100)], ctx([strokeAt('s', [60, 50, 80, 50])]))).toMatchObject({ whole: ['s'], parts: {} })
  })

  it('área sem nada editável, retângulo sem altura ou laço com menos de 3 pontos: nada', () => {
    expect(collectSelection([rect(500, 500, 10, 10)], ctx([line, t1]))).toBeNull()
    expect(collectSelection([rect(0, 0, 0, 100)], ctx([line, t1]))).toBeNull()
    expect(collectSelection([{ kind: 'lasso', points: [0, 0, 300, 300] }], ctx([line, t1]))).toBeNull()
  })

  it('alcance: a camada ativa; com "Todas as camadas", as que a pessoa pode usar', () => {
    const layers = DEFAULT_LAYERS.map((l) => (l.id === 'map' ? { ...l, locked: true } : l))
    const objs = [tokenAt('a', 60, 40), tokenAt('b', 60, 40, { layerId: 'tokens' }), tokenAt('c', 60, 40, { layerId: 'map' }), tokenAt('d', 60, 40, { layerId: 'gm' })]
    const area = [rect(0, 0, 100, 100)]
    expect(collectSelection(area, ctx(objs, { layers }))?.whole).toEqual(['a'])
    expect(collectSelection(area, ctx(objs, { layers, allLayers: true }))?.whole.sort()).toEqual(['a', 'b'])
    expect(collectSelection(area, ctx(objs, { layers, allLayers: true, role: 'gm' }))?.whole.sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('jogador não pega token de outra pessoa; item travado por outra pessoa fica de fora', () => {
    const objs = [tokenAt('mine', 60, 40), tokenAt('theirs', 60, 40, server('bia')), tokenAt('busy', 60, 40)]
    expect(collectSelection([rect(0, 0, 100, 100)], ctx(objs, { isLocked: (id) => id === 'busy' }))?.whole).toEqual(['mine'])
  })

  it('laço: item girado dentro do triângulo entra; o de fora, não', () => {
    const objs = [tokenAt('r', 40, 40, { rotation: 45 }), tokenAt('far', 150, 150)]
    expect(collectSelection([{ kind: 'lasso', points: [0, 0, 200, 0, 0, 200] }], ctx(objs))?.whole).toEqual(['r'])
  })
})

describe('addArea (Shift)', () => {
  const line = strokeAt('l', [0, 50, 300, 50])

  it('soma itens e junta os pedaços de dentro de um traço cortado pelas duas áreas', () => {
    const c = ctx([line, tokenAt('t', 210, 70)])
    const first = collectSelection([rect(50, 0, 50, 100)], c)
    const both = addArea(first, rect(200, 0, 50, 100), c)!
    expect(both.whole).toEqual(['t'])
    expect(both.parts.l).toEqual({
      inside: [[50, 50, 100, 50], [200, 50, 250, 50]],
      outside: [[0, 50, 50, 50], [100, 50, 200, 50], [250, 50, 300, 50]],
    })
    expect(both.areas).toHaveLength(2)
  })

  it('área que cobre o resto do traço o torna inteiro', () => {
    const c = ctx([line])
    const sel = addArea(collectSelection([rect(50, 0, 50, 100)], c), rect(-10, 0, 400, 100), c)!
    expect(sel.whole).toEqual(['l'])
    expect(sel.parts).toEqual({})
  })

  it('área vazia não muda a seleção; sem seleção, vira a seleção', () => {
    const c = ctx([line])
    const sel = collectSelection([rect(50, 0, 50, 100)], c)
    expect(addArea(sel, rect(900, 900, 10, 10), c)).toBe(sel)
    expect(addArea(null, rect(50, 0, 50, 100), c)).toEqual(sel)
  })
})

describe('dropFromSelection, selectionOfIds e pointInBox', () => {
  it('tira o item e recalcula a caixa; sem nada, null', () => {
    const objs = [tokenAt('a', 0, 0), tokenAt('b', 100, 0)]
    const c = ctx(objs)
    const sel = collectSelection([rect(-10, -10, 200, 100)], c)!
    expect(sel.bounds).toEqual({ x: 0, y: 0, width: 120, height: 20 })
    const kept = dropFromSelection(sel, new Set(['b']), c.objects)!
    expect(kept.whole).toEqual(['a'])
    expect(isInSelection(kept, 'a')).toBe(true)
    expect(isInSelection(kept, 'b')).toBe(false)
    expect(kept.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 })
    expect(dropFromSelection(kept, new Set(['a']), c.objects)).toBeNull()
  })

  it('selectionOfIds monta a seleção de itens inteiros (depois de mover)', () => {
    const objs = Object.fromEntries([tokenAt('a', 0, 0)].map((o) => [o.id, o]))
    expect(selectionOfIds(['a', 'sumiu'], objs)).toEqual({ areas: [], whole: ['a'], wholeIds: new Set(['a']), parts: {}, bounds: { x: 0, y: 0, width: 20, height: 20 } })
    expect(selectionOfIds([], objs)).toBeNull()
  })

  it('pointInBox com folga', () => {
    const b = { x: 0, y: 0, width: 10, height: 0 }
    expect(pointInBox({ x: 5, y: 3 }, b)).toBe(false)
    expect(pointInBox({ x: 5, y: 3 }, b, 4)).toBe(true)
  })
})
