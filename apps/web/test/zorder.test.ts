import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, type TableObject } from '@mesa/shared'
import { liftedIds } from '../src/canvas/lift'
import { collectSelection } from '../src/selection/model'
import { liftToTop, topZ } from '../src/store/zorder'
import { tokenAt } from './selection-fixtures'

const byId = (objects: TableObject[]) => Object.fromEntries(objects.map((o) => [o.id, o]))

describe('topZ', () => {
  it('é o maior zIndex da camada + 1; outras camadas não contam; camada vazia dá 1', () => {
    const objects = byId([tokenAt('a', 0, 0, { zIndex: 4 }), tokenAt('b', 0, 0, { zIndex: -2 }), tokenAt('m', 0, 0, { layerId: 'map', zIndex: 99 })])
    expect(topZ(objects, 'drawings')).toBe(5)
    expect(topZ(objects, 'map')).toBe(100)
    expect(topZ(objects, 'gm')).toBe(1)
  })
})

describe('liftToTop', () => {
  it('cada item vai para o topo da própria camada, mantendo a ordem relativa entre eles', () => {
    const a = tokenAt('a', 0, 0, { zIndex: 3 })
    const b = tokenAt('b', 0, 0, { zIndex: 1 })
    const c = tokenAt('c', 0, 0, { zIndex: 6 })
    const m1 = tokenAt('m1', 0, 0, { layerId: 'map', zIndex: 2 })
    const m2 = tokenAt('m2', 0, 0, { layerId: 'map', zIndex: 0 })
    const objects = byId([a, b, c, m1, m2])
    expect(liftToTop(objects, [a, m1, b, m2])).toEqual({ b: 7, a: 8, m2: 3, m1: 4 })
  })

  it('o item que já é o topo continua acima de todos', () => {
    const a = tokenAt('a', 0, 0, { zIndex: 3 })
    const b = tokenAt('b', 0, 0, { zIndex: 1 })
    expect(liftToTop(byId([a, b]), [a])).toEqual({ a: 4 })
  })
})

describe('liftedIds', () => {
  const a = tokenAt('a', 0, 0, { zIndex: 3 })
  const b = tokenAt('b', 40, 0, { zIndex: 1 })
  const m = tokenAt('m', 80, 0, { layerId: 'map', zIndex: 9 })
  const objects = byId([a, b, m])
  const base = { objects, layers: DEFAULT_LAYERS, draggingId: null, selection: null, selectionOffset: null }

  it('nada levantado fora de um arrasto', () => {
    expect(liftedIds(base)).toEqual([])
  })

  it('o objeto que eu arrasto sozinho', () => {
    expect(liftedIds({ ...base, draggingId: 'b' })).toEqual(['b'])
    expect(liftedIds({ ...base, draggingId: 'sumiu' })).toEqual([])
  })

  it('no arrasto do grupo, os itens inteiros em ordem de desenho (camada, depois zIndex)', () => {
    const selection = collectSelection([{ kind: 'rect', rect: { x: -10, y: -10, width: 200, height: 50 } }], {
      objects, layers: DEFAULT_LAYERS, activeLayerId: 'drawings', allLayers: true, selfId: 'me', role: 'gm', isLocked: () => false,
    })
    expect(liftedIds({ ...base, selection })).toEqual([])
    expect(liftedIds({ ...base, selection, selectionOffset: { x: 5, y: 5 } })).toEqual(['m', 'b', 'a'])
  })
})
