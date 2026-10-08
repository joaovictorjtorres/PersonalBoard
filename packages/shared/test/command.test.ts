import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src'

describe('parseCommand', () => {
  it('texto comum não é comando', () => {
    expect(parseCommand('oi pessoal')).toBeNull()
    expect(parseCommand('/me acena')).toBeNull()
    expect(parseCommand('/rolar')).toBeNull()
  })

  it('/r NdM, NdM+B, NdM-B e dM', () => {
    expect(parseCommand('/r 2d6')).toEqual({ kind: 'roll', request: { die: 6, count: 2, bonus: 0, mode: 'normal' } })
    expect(parseCommand('/r 1d20+5')).toEqual({ kind: 'roll', request: { die: 20, count: 1, bonus: 5, mode: 'normal' } })
    expect(parseCommand('/r 3d8 - 2')).toEqual({ kind: 'roll', request: { die: 8, count: 3, bonus: -2, mode: 'normal' } })
    expect(parseCommand('  /R d20  ')).toEqual({ kind: 'roll', request: { die: 20, count: 1, bonus: 0, mode: 'normal' } })
  })

  it('sufixos adv e dis', () => {
    expect(parseCommand('/r d20+3 adv')).toEqual({ kind: 'roll', request: { die: 20, count: 1, bonus: 3, mode: 'advantage' } })
    expect(parseCommand('/r 1d20 dis')).toEqual({ kind: 'roll', request: { die: 20, count: 1, bonus: 0, mode: 'disadvantage' } })
  })

  it('fórmula inválida', () => {
    for (const bad of ['/r', '/r 2d7', '/r 0d6', '/r 51d6', '/r d20+101', '/r 2d20 adv', '/r abc', '/r 1d20 vantagem']) {
      expect(parseCommand(bad), bad).toEqual({ kind: 'invalid' })
    }
  })
})
