import { describe, expect, it } from 'vitest'
import {
  boxCorners,
  insidePolygon,
  insideRect,
  pointInPolygon,
  rectFromPoints,
  rectPolygon,
  splitStrokeByPolygon,
  splitStrokeByRect,
} from '../src'

// Laço que se cruza (gravata): triângulos da esquerda e da direita ficam dentro; os de cima e de baixo, fora.
const BOWTIE = [0, 0, 10, 10, 10, 0, 0, 10]
// "U" com o vão entre x 40..60, de y 40 até embaixo.
const U = [0, 0, 100, 0, 100, 100, 60, 100, 60, 40, 40, 40, 40, 100, 0, 100]

describe('pointInPolygon', () => {
  it('quadrado: dentro e fora', () => {
    const sq = rectPolygon({ x: 0, y: 0, width: 10, height: 10 })
    expect(pointInPolygon(5, 5, sq)).toBe(true)
    expect(pointInPolygon(15, 5, sq)).toBe(false)
  })

  it('laço que se cruza usa par/ímpar', () => {
    expect(pointInPolygon(1, 5, BOWTIE)).toBe(true)
    expect(pointInPolygon(9, 5, BOWTIE)).toBe(true)
    expect(pointInPolygon(5, 1, BOWTIE)).toBe(false)
    expect(pointInPolygon(5, 9, BOWTIE)).toBe(false)
  })

  it('menos de 3 pontos não contém nada', () => {
    expect(pointInPolygon(0, 0, [0, 0, 10, 10])).toBe(false)
  })
})

describe('rectFromPoints e boxCorners', () => {
  it('retângulo em qualquer direção do arrasto', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, width: 10, height: 15 })
  })

  it('cantos giram em torno de (x, y)', () => {
    const c = boxCorners({ x: 10, y: 10, width: 20, height: 10, rotation: 90 })
    expect(c.map((v) => Math.round(v))).toEqual([10, 10, 10, 30, 0, 30, 0, 10])
  })
})

describe('insideRect', () => {
  const area = { x: 0, y: 0, width: 100, height: 100 }

  it('inteiro dentro entra; pela metade, não', () => {
    expect(insideRect({ x: 10, y: 10, width: 20, height: 20, rotation: 0 }, area)).toBe(true)
    expect(insideRect({ x: 90, y: 10, width: 20, height: 20, rotation: 0 }, area)).toBe(false)
  })

  it('usa a caixa girada', () => {
    // girado 45°: cantos em x de 35,86 a 64,14
    const item = { x: 50, y: 0, width: 20, height: 20, rotation: 45 }
    expect(insideRect(item, { x: 30, y: 0, width: 40, height: 30 })).toBe(true)
    expect(insideRect(item, { x: 40, y: 0, width: 40, height: 30 })).toBe(false)
  })
})

describe('insidePolygon', () => {
  it('laço que cobre o item inteiro', () => {
    expect(insidePolygon({ x: 10, y: 10, width: 20, height: 20, rotation: 0 }, U)).toBe(true)
  })

  it('laço côncavo que entra na caixa sem cobrir um canto: fora', () => {
    // os 4 cantos caem nos braços do U, mas o meio da caixa fica no vão
    expect(insidePolygon({ x: 10, y: 50, width: 80, height: 20, rotation: 0 }, U)).toBe(false)
  })

  it('laço com menos de 3 pontos não pega nada', () => {
    expect(insidePolygon({ x: 1, y: 1, width: 1, height: 1, rotation: 0 }, [0, 0, 10, 10])).toBe(false)
  })
})

describe('splitStrokeByRect', () => {
  const rect = { x: 5, y: 0, width: 10, height: 10 }

  it('atravessando: corta exatamente na borda', () => {
    expect(splitStrokeByRect([0, 5, 20, 5], rect)).toEqual({
      inside: [[5, 5, 15, 5]],
      outside: [[0, 5, 5, 5], [15, 5, 20, 5]],
    })
  })

  it('todo dentro e todo fora', () => {
    expect(splitStrokeByRect([6, 5, 14, 5], rect)).toEqual({ inside: [[6, 5, 14, 5]], outside: [] })
    expect(splitStrokeByRect([0, 50, 20, 50], rect)).toEqual({ inside: [], outside: [[0, 50, 20, 50]] })
  })

  it('linha com vários pontos sai pelo lado de baixo', () => {
    expect(splitStrokeByRect([0, 5, 10, 5, 10, 15], rect)).toEqual({
      inside: [[5, 5, 10, 5, 10, 10]],
      outside: [[0, 5, 5, 5], [10, 10, 10, 15]],
    })
  })
})

describe('splitStrokeByPolygon', () => {
  it('laço que se cruza: dentro nos dois triângulos laterais, fora no meio', () => {
    expect(splitStrokeByPolygon([1, 2, 9, 2], BOWTIE)).toEqual({
      inside: [[1, 2, 2, 2], [8, 2, 9, 2]],
      outside: [[2, 2, 8, 2]],
    })
  })

  it('laço com menos de 3 pontos: tudo fora', () => {
    expect(splitStrokeByPolygon([0, 0, 10, 0], [0, 0, 5, 5])).toEqual({ inside: [], outside: [[0, 0, 10, 0]] })
  })
})
