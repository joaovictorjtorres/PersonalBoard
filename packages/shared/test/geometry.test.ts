import { describe, expect, it } from 'vitest'
import { boundsOf, simplifyPoints } from '../src'

describe('simplifyPoints', () => {
  it('reduz linha reta aos dois extremos', () => {
    expect(simplifyPoints([0, 0, 1, 0, 2, 0, 3, 0, 10, 0], 0.5)).toEqual([0, 0, 10, 0])
  })

  it('mantém o canto de um L', () => {
    expect(simplifyPoints([0, 0, 5, 0, 10, 0, 10, 5, 10, 10], 0.5)).toEqual([0, 0, 10, 0, 10, 10])
  })

  it('mantém ponto que desvia mais que a tolerância', () => {
    expect(simplifyPoints([0, 0, 5, 3, 10, 0], 1)).toEqual([0, 0, 5, 3, 10, 0])
  })

  it('descarta desvio menor que a tolerância', () => {
    expect(simplifyPoints([0, 0, 5, 0.4, 10, 0], 1)).toEqual([0, 0, 10, 0])
  })

  it('devolve cópia quando há 1 ou 2 pontos', () => {
    const one = [3, 4]
    const out = simplifyPoints(one, 1)
    expect(out).toEqual([3, 4])
    expect(out).not.toBe(one)
  })
})

describe('boundsOf', () => {
  it('calcula caixa envolvente', () => {
    expect(boundsOf([5, 10, -2, 3, 8, 1])).toEqual({ minX: -2, minY: 1, width: 10, height: 9 })
  })
})
