import { describe, expect, it } from 'vitest'
import { TURN_RING_PERIOD_MS, turnRing, turnRingPulse } from '../src/canvas/turnRing'

describe('anel da vez', () => {
  it('elipse no centro da caixa, com folga de 6 px de tela', () => {
    const box = { minX: 100, minY: 200, maxX: 170, maxY: 240 }
    expect(turnRing(box, 1)).toEqual({ x: 135, y: 220, radiusX: 41, radiusY: 26 })
    expect(turnRing(box, 2)).toEqual({ x: 135, y: 220, radiusX: 38, radiusY: 23 })
  })

  it('pulso: cresce até 6 px e volta; a opacidade cai junto', () => {
    expect(turnRingPulse(0)).toEqual({ grow: 3, opacity: 0.75 })
    const peak = turnRingPulse(TURN_RING_PERIOD_MS / 4)
    expect(peak.grow).toBeCloseTo(6)
    expect(peak.opacity).toBeCloseTo(0.5)
    const low = turnRingPulse((TURN_RING_PERIOD_MS * 3) / 4)
    expect(low.grow).toBeCloseTo(0)
    expect(low.opacity).toBeCloseTo(1)
  })
})
