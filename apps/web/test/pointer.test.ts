import { describe, expect, it } from 'vitest'
import { coalescedPoints, isHover, pointerAction, toWorld } from '../src/canvas/pointer'

describe('caneta e mouse', () => {
  it('mouse: esquerdo é principal, direito é secundário, meio não faz nada', () => {
    expect(pointerAction({ pointerType: 'mouse', button: 0, buttons: 1 })).toBe('primary')
    expect(pointerAction({ pointerType: 'mouse', button: 2, buttons: 2 })).toBe('secondary')
    expect(pointerAction({ pointerType: 'mouse', button: 1, buttons: 4 })).toBeNull()
  })

  it('caneta: ponta é principal; botão lateral vale como direito, mesmo encostando a ponta', () => {
    expect(pointerAction({ pointerType: 'pen', button: 0, buttons: 1 })).toBe('primary')
    expect(pointerAction({ pointerType: 'pen', button: 2, buttons: 2 })).toBe('secondary')
    expect(pointerAction({ pointerType: 'pen', button: 0, buttons: 3 })).toBe('secondary')
  })

  it('caneta: ponta de trás é borracha', () => {
    expect(pointerAction({ pointerType: 'pen', button: 5, buttons: 32 })).toBe('eraser')
    expect(pointerAction({ pointerType: 'pen', button: 0, buttons: 32 })).toBe('eraser')
    // mouse com botões extras não vira borracha
    expect(pointerAction({ pointerType: 'mouse', button: 5, buttons: 32 })).toBeNull()
  })

  it('pairar (nada apertado) não desenha', () => {
    expect(isHover({ buttons: 0 })).toBe(true)
    expect(isHover({ buttons: 1 })).toBe(false)
    expect(isHover({ buttons: 32 })).toBe(false)
  })

  it('usa todos os pontos juntados pelo navegador; sem eles, o do próprio evento', () => {
    const evt = {
      clientX: 30, clientY: 30,
      getCoalescedEvents: () => [{ clientX: 10, clientY: 10 }, { clientX: 20, clientY: 25 }, { clientX: 30, clientY: 30 }],
    }
    expect(coalescedPoints(evt)).toEqual([{ clientX: 10, clientY: 10 }, { clientX: 20, clientY: 25 }, { clientX: 30, clientY: 30 }])
    expect(coalescedPoints({ clientX: 5, clientY: 6, getCoalescedEvents: () => [] })).toEqual([{ clientX: 5, clientY: 6 }])
    expect(coalescedPoints({ clientX: 5, clientY: 6 })).toEqual([{ clientX: 5, clientY: 6 }])
  })

  it('converte pontos de tela para o mundo pela câmera', () => {
    expect(toWorld([{ clientX: 110, clientY: 70 }], { left: 10, top: 20 }, { x: 0, y: 0, scale: 2 })).toEqual([{ x: 50, y: 25 }])
    expect(toWorld([{ clientX: 100, clientY: 100 }], { left: 0, top: 0 }, { x: 40, y: -20, scale: 1 })).toEqual([{ x: 60, y: 120 }])
  })
})
