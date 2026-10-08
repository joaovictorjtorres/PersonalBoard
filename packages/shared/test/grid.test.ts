import { describe, expect, it } from 'vitest'
import { cellCenter, formatDistance, rulerDistance, snapPatch, snapToGrid } from '../src'

describe('snapToGrid', () => {
  it('posição vai ao múltiplo mais próximo; lado ao múltiplo, com mínimo de um quadrado', () => {
    expect(snapToGrid({ x: 34, y: 36, width: 110, height: 20 }, 70)).toEqual({ x: 0, y: 70, width: 140, height: 70 })
  })

  it('coordenadas negativas sem gerar -0', () => {
    expect(snapToGrid({ x: -20, y: -50, width: 70, height: 70 }, 70)).toEqual({ x: 0, y: -70, width: 70, height: 70 })
    expect(Object.is(snapToGrid({ x: -20, y: 0, width: 70, height: 70 }, 70).x, 0)).toBe(true)
  })
})

describe('snapPatch', () => {
  it('só mexe nos campos de geometria presentes e preserva os outros', () => {
    expect(snapPatch({ x: 101, rotation: 15 }, 50)).toEqual({ x: 100, rotation: 15 })
    expect(snapPatch({ width: 10 }, 50)).toEqual({ width: 50 })
    expect(snapPatch({}, 50)).toEqual({})
  })
})

describe('régua', () => {
  it('cellCenter devolve o centro do quadrado clicado', () => {
    expect(cellCenter({ x: 75, y: 10 }, 70)).toEqual({ x: 105, y: 35 })
    expect(cellCenter({ x: -1, y: 0 }, 70)).toEqual({ x: -35, y: 35 })
  })

  it('rulerDistance = hypot / size com uma casa', () => {
    expect(rulerDistance({ x: 0, y: 0 }, { x: 210, y: 280 }, 70)).toBe(5)
    expect(rulerDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 70)).toBe(1.4)
    expect(rulerDistance({ x: 385, y: 315 }, { x: 700, y: 300 }, 70)).toBe(4.5)
  })

  it('formatDistance usa vírgula decimal e "q"', () => {
    expect(formatDistance(4.2)).toBe('4,2 q')
    expect(formatDistance(5)).toBe('5,0 q')
    expect(formatDistance(0)).toBe('0,0 q')
  })
})
