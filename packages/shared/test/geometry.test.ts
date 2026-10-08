import { describe, expect, it } from 'vitest'
import { boundsOf, eraseSegments, pathTouchesBox, simplifyPoints } from '../src'

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

describe('eraseSegments', () => {
  it('corte no meio gera 2 pedaços', () => {
    // raio 5 + metade da espessura 1 = 6; passo de reamostragem 2.5
    expect(eraseSegments([[0, 0, 100, 0]], [50, -20, 50, 20], 5, 2)).toEqual([
      [0, 0, 42.5, 0],
      [57.5, 0, 100, 0],
    ])
  })

  it('borracha longe não muda nada (mesma referência)', () => {
    const segments = [[0, 0, 100, 0]]
    expect(eraseSegments(segments, [50, 100, 60, 100], 5, 2)).toBe(segments)
  })

  it('cobertura total gera []', () => {
    expect(eraseSegments([[0, 0, 10, 0]], [-5, 0, 15, 0], 5, 0)).toEqual([])
  })

  it('aresta longa de 2 pontos é cortada no meio por um toque só', () => {
    expect(eraseSegments([[0, 0, 1000, 0]], [500, 0], 4, 0)).toEqual([
      [0, 0, 494, 0],
      [506, 0, 1000, 0],
    ])
  })

  it('descarta fragmentos com menos de 2 pontos ou comprimento < 2', () => {
    // alcance 3, passo 1: sobra [0..1] (comprimento 1) à esquerda e [9..20] à direita
    expect(eraseSegments([[0, 0, 20, 0]], [5, 0], 2, 2)).toEqual([[9, 0, 20, 0]])
  })

  it('pedaço não tocado é mantido por referência', () => {
    const segments = [[0, 0, 100, 0], [0, 50, 100, 50]]
    const out = eraseSegments(segments, [50, -10, 50, 10], 5, 2)
    expect(out).toHaveLength(3)
    expect(out[2]).toBe(segments[1])
  })

  it('simplifica os trechos com a tolerância recebida', () => {
    const wavy = [0, 0, 10, 0.4, 20, 0, 30, 0.4, 40, 0, 100, 0]
    const out = eraseSegments([wavy], [100, -10, 100, 10], 2, 0, 1)
    expect(out).toEqual([[0, 0, 97, 0]])
  })
})

describe('pathTouchesBox', () => {
  const box = { x: 100, y: 100, width: 50, height: 10 }
  it('detecta caminho dentro ou encostando pelo alcance', () => {
    expect(pathTouchesBox([120, 50, 120, 200], 0, box)).toBe(true)
    expect(pathTouchesBox([90, 105], 10, box)).toBe(true)
  })
  it('descarta caminho distante', () => {
    expect(pathTouchesBox([0, 0, 50, 50], 5, box)).toBe(false)
    expect(pathTouchesBox([], 5, box)).toBe(false)
  })
})
