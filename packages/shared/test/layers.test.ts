import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, changedLayers, insertLayer, moveLayer, sortLayers, type Layer } from '../src'

const summary = (layers: Layer[]) => layers.map((l) => `${l.id}:${l.order}`)

describe('sortLayers', () => {
  it('ordena por order e mantém o Mestre por último mesmo com order baixa', () => {
    const broken = [{ ...DEFAULT_LAYERS[3], order: 0 }, { ...DEFAULT_LAYERS[1] }, { ...DEFAULT_LAYERS[0], order: 5 }]
    expect(sortLayers(broken).map((l) => l.id)).toEqual(['tokens', 'map', 'gm'])
  })
})

describe('insertLayer', () => {
  it('nova camada entra logo abaixo do Mestre e as orders são renumeradas', () => {
    const out = insertLayer(DEFAULT_LAYERS, { id: 'nova', name: 'Nova camada' })
    expect(summary(out)).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
    expect(out.find((l) => l.id === 'nova')).toEqual({ id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false })
  })

  it('não altera o array recebido', () => {
    const copy = structuredClone(DEFAULT_LAYERS)
    insertLayer(copy, { id: 'nova', name: 'X' })
    expect(copy).toEqual(DEFAULT_LAYERS)
  })
})

describe('moveLayer', () => {
  it('sobe e desce trocando com a vizinha', () => {
    expect(summary(moveLayer(DEFAULT_LAYERS, 'map', 'up')!)).toEqual(['tokens:0', 'map:1', 'drawings:2', 'gm:3'])
    expect(summary(moveLayer(DEFAULT_LAYERS, 'drawings', 'down')!)).toEqual(['map:0', 'drawings:1', 'tokens:2', 'gm:3'])
  })

  it('nada passa acima do Mestre, nada desce abaixo do fundo e o Mestre não se move', () => {
    expect(moveLayer(DEFAULT_LAYERS, 'drawings', 'up')).toBeNull()
    expect(moveLayer(DEFAULT_LAYERS, 'map', 'down')).toBeNull()
    expect(moveLayer(DEFAULT_LAYERS, 'gm', 'down')).toBeNull()
    expect(moveLayer(DEFAULT_LAYERS, 'nope', 'up')).toBeNull()
  })
})

describe('changedLayers', () => {
  it('lista só as camadas novas ou alteradas', () => {
    const after = insertLayer(DEFAULT_LAYERS, { id: 'nova', name: 'Nova camada' })
    expect(changedLayers(DEFAULT_LAYERS, after).map((c) => [c.before?.id ?? null, c.after.id])).toEqual([
      [null, 'nova'],
      ['gm', 'gm'],
    ])
  })
})
