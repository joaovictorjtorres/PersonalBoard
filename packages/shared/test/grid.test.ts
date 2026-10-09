import { describe, expect, it } from 'vitest'
import { cellCenter, formatDistance, rulerDistance, segmentDistance, snapPatch, snapToGrid } from '../src'

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

  it('segmentDistance mede entre os centros dos quadrados dos pontos, com uma casa', () => {
    expect(segmentDistance({ x: 0, y: 0 }, { x: 210, y: 280 }, 70)).toBe(5)
    // (35,35) → (105,35): 1 quadrado, não 100/70
    expect(segmentDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 70)).toBe(1)
    expect(segmentDistance({ x: 400, y: 300 }, { x: 700, y: 300 }, 70)).toBe(5)
    expect(segmentDistance({ x: 1, y: 1 }, { x: 69, y: 69 }, 70)).toBe(0) // mesmo quadrado
    expect(segmentDistance({ x: 0, y: 0 }, { x: 70, y: 70 }, 70)).toBe(1.4) // diagonal
  })

  it('rulerDistance soma todos os trechos e arredonda só o total', () => {
    expect(rulerDistance([{ x: 0, y: 0 }, { x: 210, y: 280 }], 70)).toBe(5)
    expect(rulerDistance([{ x: 385, y: 315 }, { x: 735, y: 315 }, { x: 735, y: 455 }], 70)).toBe(7)
    // pontos crus em qualquer lugar do quadrado contam pelo centro
    expect(rulerDistance([{ x: 400, y: 300 }, { x: 700, y: 300 }, { x: 740, y: 450 }], 70)).toBe(7)
    // 5 diagonais de 1,414 m: soma 7,1 (e não 5 × 1,4 = 7,0)
    expect(rulerDistance(Array.from({ length: 6 }, (_, i) => ({ x: i * 70, y: i * 70 })), 70)).toBe(7.1)
    expect(rulerDistance([{ x: 5, y: 5 }], 70)).toBe(0)
  })

  it('formatDistance usa vírgula decimal e "m" (1 quadrado = 1 m)', () => {
    expect(formatDistance(4.2)).toBe('4,2 m')
    expect(formatDistance(5)).toBe('5,0 m')
    expect(formatDistance(0)).toBe('0,0 m')
  })
})
