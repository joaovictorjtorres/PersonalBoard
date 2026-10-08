import { describe, expect, it } from 'vitest'
import { centerOn, glideStep } from '../src/canvas/camera'
import { isPingClick, pingRing } from '../src/canvas/ping'
import { rulerLabel } from '../src/canvas/ruler'

describe('câmera', () => {
  it('centerOn põe o ponto no meio da tela mantendo o zoom', () => {
    expect(centerOn({ x: 0, y: 0, scale: 2 }, { x: 100, y: 50 }, 1280, 720)).toEqual({ x: 440, y: 260, scale: 2 })
  })

  it('glideStep vai de um viewport ao outro com aceleração suave', () => {
    const from = { x: 0, y: 0, scale: 1 }
    const to = { x: 100, y: -40, scale: 1 }
    expect(glideStep(from, to, 0)).toEqual(from)
    expect(glideStep(from, to, 0.5)).toEqual({ x: 50, y: -20, scale: 1 })
    expect(glideStep(from, to, 1)).toEqual(to)
    expect(glideStep(from, to, 2)).toEqual(to)
    expect(glideStep(from, to, 0.25).x).toBeLessThan(25)
  })
})

describe('ping', () => {
  it('Shift, Ctrl ou ⌘ no clique viram ping', () => {
    expect(isPingClick({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe(true)
    expect(isPingClick({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe(true)
    expect(isPingClick({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe(true)
    expect(isPingClick({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe(false)
  })

  it('anel cresce e some em 2 s', () => {
    expect(pingRing(0)).toEqual({ radius: 6, opacity: 1 })
    expect(pingRing(-5)).toEqual({ radius: 6, opacity: 1 })
    expect(pingRing(1000)).toEqual({ radius: 23, opacity: 0.5 })
    expect(pingRing(2000)).toBeNull()
  })
})

describe('régua', () => {
  it('rótulo "Apelido · N,N q"', () => {
    expect(rulerLabel('Ana', { from: { x: 35, y: 35 }, to: { x: 329, y: 35 } }, 70)).toBe('Ana · 4,2 q')
    expect(rulerLabel('Bia', { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }, 70)).toBe('Bia · 0,0 q')
  })
})
