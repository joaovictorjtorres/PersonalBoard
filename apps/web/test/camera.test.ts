import { describe, expect, it } from 'vitest'
import { centerOn, glideStep } from '../src/canvas/camera'
import { isPingClick, pingRing } from '../src/canvas/ping'
import { rulerBend, rulerLabel, rulerMoveTo, rulerSegmentLabels, rulerStart } from '../src/canvas/ruler'

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
  it('rótulo "Apelido · N,N q" com a soma dos trechos', () => {
    expect(rulerLabel('Ana', { points: [{ x: 35, y: 35 }, { x: 329, y: 35 }] }, 70)).toBe('Ana · 4,2 m')
    expect(rulerLabel('Bia', { points: [{ x: 0, y: 0 }, { x: 0, y: 0 }] }, 70)).toBe('Bia · 0,0 m')
    expect(rulerLabel('Ana', { points: [{ x: 385, y: 315 }, { x: 735, y: 315 }, { x: 735, y: 455 }] }, 70)).toBe('Ana · 7,0 m')
  })

  it('início no centro do quadrado; mover só troca a ponta', () => {
    const r = rulerStart({ x: 400, y: 300 }, 70)
    expect(r).toEqual({ points: [{ x: 385, y: 315 }, { x: 400, y: 300 }] })
    expect(rulerMoveTo(r, { x: 700, y: 300 })).toEqual({ points: [{ x: 385, y: 315 }, { x: 700, y: 300 }] })
  })

  it('dobra no centro do quadrado do cursor e continua até o cursor', () => {
    const r = rulerMoveTo(rulerStart({ x: 400, y: 300 }, 70), { x: 700, y: 300 })
    const bent = rulerBend(r, { x: 700, y: 300 }, 70)!
    expect(bent.points).toEqual([{ x: 385, y: 315 }, { x: 735, y: 315 }, { x: 700, y: 300 }])
    expect(rulerMoveTo(bent, { x: 735, y: 455 }).points).toEqual([{ x: 385, y: 315 }, { x: 735, y: 315 }, { x: 735, y: 455 }])
    expect(rulerBend(bent, { x: 710, y: 290 }, 70)).toBeNull() // mesmo quadrado da última dobra
  })

  it('no máximo 32 pontos', () => {
    let r = rulerStart({ x: 0, y: 0 }, 10)
    for (let i = 1; i < 40; i++) r = rulerBend(r, { x: i * 10, y: 0 }, 10) ?? r
    expect(r.points).toHaveLength(32)
  })

  it('distância por trecho só com dobras', () => {
    expect(rulerSegmentLabels({ points: [{ x: 0, y: 0 }, { x: 70, y: 0 }] }, 70)).toEqual([])
    expect(rulerSegmentLabels({ points: [{ x: 385, y: 315 }, { x: 735, y: 315 }, { x: 735, y: 455 }] }, 70)).toEqual([
      { x: 560, y: 315, text: '5,0 m' },
      { x: 735, y: 385, text: '2,0 m' },
    ])
  })
})
