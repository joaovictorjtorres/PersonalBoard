import { describe, expect, it } from 'vitest'
import { parseGridSize, visibleGridLines } from '../src/canvas/grid'

describe('visibleGridLines', () => {
  it('linhas só na área visível, sem zoom', () => {
    expect(visibleGridLines({ x: 0, y: 0, scale: 1 }, 200, 100, 70)).toEqual({
      xs: [0, 70, 140], ys: [0, 70], minX: 0, maxX: 200, minY: 0, maxY: 100,
    })
  })

  it('com pan e zoom, em coordenadas do mapa e sem -0', () => {
    const lines = visibleGridLines({ x: -100, y: 50, scale: 2 }, 200, 100, 70)
    expect(lines).toEqual({ xs: [70, 140], ys: [0], minX: 50, maxX: 150, minY: -25, maxY: 25 })
    expect(Object.is(lines!.ys[0], 0)).toBe(true)
  })

  it('não desenha quando o quadrado teria menos de 4 px na tela', () => {
    expect(visibleGridLines({ x: 0, y: 0, scale: 0.1 }, 1000, 1000, 30)).toBeNull()
    expect(visibleGridLines({ x: 0, y: 0, scale: 0.1 }, 1000, 1000, 40)).not.toBeNull()
  })
})

describe('parseGridSize', () => {
  it('aceita inteiros de 10 a 500 (com espaços em volta)', () => {
    expect(parseGridSize('70')).toBe(70)
    expect(parseGridSize(' 10 ')).toBe(10)
    expect(parseGridSize('500')).toBe(500)
  })

  it('recusa fora do intervalo, decimal, vazio e texto', () => {
    for (const bad of ['9', '501', '12.5', '', '   ', 'abc', '-70']) expect(parseGridSize(bad), bad).toBeNull()
  })
})
