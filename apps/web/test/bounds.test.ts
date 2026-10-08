import { describe, expect, it } from 'vitest'
import { rotatedBounds } from '../src/canvas/bounds'

describe('rotatedBounds', () => {
  it('sem rotação é a própria caixa', () => {
    expect(rotatedBounds({ x: 10, y: 20, width: 70, height: 30, rotation: 0 })).toEqual({ minX: 10, minY: 20, maxX: 80, maxY: 50 })
  })

  it('90° gira em torno do canto (x, y), como o Konva', () => {
    const b = rotatedBounds({ x: 0, y: 0, width: 10, height: 20, rotation: 90 })
    expect(b.minX).toBeCloseTo(-20)
    expect(b.maxX).toBeCloseTo(0)
    expect(b.minY).toBeCloseTo(0)
    expect(b.maxY).toBeCloseTo(10)
  })
})
