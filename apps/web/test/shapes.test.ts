import { describe, expect, it } from 'vitest'
import { NewObjectSchema } from '@mesa/shared'
import { hexToRgba, newShapeObject, shapeFillFor, shapeFromDrag } from '../src/canvas/shapes'

const noFill = { enabled: false, color: null, opacity: 0.3 }

describe('shapeFromDrag', () => {
  it('retângulo/elipse: caixa normalizada em qualquer direção', () => {
    expect(shapeFromDrag('rect', { x: 10, y: 10 }, { x: 50, y: 30 }, false)).toEqual({ x: 10, y: 10, width: 40, height: 20 })
    expect(shapeFromDrag('ellipse', { x: 50, y: 30 }, { x: 10, y: 10 }, false)).toEqual({ x: 10, y: 10, width: 40, height: 20 })
  })

  it('Shift força quadrado/círculo pelo maior lado, respeitando a direção', () => {
    expect(shapeFromDrag('rect', { x: 10, y: 10 }, { x: 50, y: 30 }, true)).toEqual({ x: 10, y: 10, width: 40, height: 40 })
    expect(shapeFromDrag('ellipse', { x: 50, y: 50 }, { x: 40, y: 10 }, true)).toEqual({ x: 10, y: 10, width: 40, height: 40 })
  })

  it('linha: caixa + pontos relativos a (x, y)', () => {
    expect(shapeFromDrag('line', { x: 10, y: 10 }, { x: 50, y: 30 }, false)).toEqual({
      x: 10, y: 10, width: 40, height: 20, points: [0, 0, 40, 20],
    })
    expect(shapeFromDrag('line', { x: 50, y: 10 }, { x: 10, y: 30 }, false)).toEqual({
      x: 10, y: 10, width: 40, height: 20, points: [40, 0, 0, 20],
    })
  })

  it('linha com Shift fica em múltiplos de 45°, com o mesmo comprimento', () => {
    expect(shapeFromDrag('line', { x: 0, y: 0 }, { x: 100, y: 10 }, true)).toEqual({
      x: 0, y: 0, width: 100.499, height: 0, points: [0, 0, 100.499, 0],
    })
    expect(shapeFromDrag('line', { x: 0, y: 0 }, { x: 30, y: -28 }, true)).toEqual({
      x: 0, y: -29.017, width: 29.017, height: 29.017, points: [0, 29.017, 29.017, 0],
    })
    expect(shapeFromDrag('line', { x: 10, y: 10 }, { x: 12, y: 80 }, true)).toEqual({
      x: 10, y: 10, width: 0, height: 70.029, points: [0, 0, 0, 70.029],
    })
  })
})

describe('preenchimento', () => {
  it('desligado = null; ligado sem cor usa a do contorno; linha nunca tem', () => {
    expect(shapeFillFor('rect', noFill, '#ff0000')).toBeNull()
    expect(shapeFillFor('rect', { enabled: true, color: null, opacity: 0.3 }, '#ff0000')).toEqual({ color: '#ff0000', opacity: 0.3 })
    expect(shapeFillFor('ellipse', { enabled: true, color: '#00ff00', opacity: 1 }, '#ff0000')).toEqual({ color: '#00ff00', opacity: 1 })
    expect(shapeFillFor('line', { enabled: true, color: '#00ff00', opacity: 1 }, '#ff0000')).toBeNull()
  })

  it('hexToRgba', () => {
    expect(hexToRgba('#ff8000', 0.3)).toBe('rgba(255, 128, 0, 0.3)')
  })
})

describe('newShapeObject', () => {
  it('gera objetos válidos para o schema', () => {
    const base = { id: 's1', layerId: 'drawings', zIndex: 3, stroke: '#ffffff', strokeWidth: 4, fill: { enabled: true, color: null, opacity: 0.3 } }
    const rect = newShapeObject({ ...base, kind: 'rect', geometry: { x: 1, y: 2, width: 30, height: 40 } })
    expect(rect).toEqual({
      id: 's1', type: 'shape', kind: 'rect', layerId: 'drawings', x: 1, y: 2, width: 30, height: 40, rotation: 0, zIndex: 3,
      stroke: '#ffffff', strokeWidth: 4, fill: { color: '#ffffff', opacity: 0.3 },
    })
    expect(NewObjectSchema.safeParse(rect).success).toBe(true)
    const line = newShapeObject({ ...base, kind: 'line', geometry: { x: 0, y: 0, width: 10, height: 0, points: [0, 0, 10, 0] } })
    expect(line).toMatchObject({ kind: 'line', fill: null, points: [0, 0, 10, 0] })
    expect(NewObjectSchema.safeParse(line).success).toBe(true)
  })
})
