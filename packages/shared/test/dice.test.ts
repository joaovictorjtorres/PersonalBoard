import { describe, expect, it } from 'vitest'
import { RollRequestSchema, formatRollFormula, rollDice, uniformInt } from '../src'

const seq = (...values: number[]) => {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('gerador esgotado')
    return values[i++]
  }
}
const ok = { die: 20, count: 1, bonus: 0, mode: 'normal' }

describe('RollRequestSchema', () => {
  it('aceita d4..d100 e recusa outros dados', () => {
    for (const die of [4, 6, 8, 10, 12, 20, 100]) expect(RollRequestSchema.safeParse({ ...ok, die }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, die: 7 }).success).toBe(false)
  })

  it('quantidade de 1 a 50 e bônus inteiro de -100 a +100', () => {
    expect(RollRequestSchema.safeParse({ ...ok, count: 50 }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, count: 0 }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, count: 51 }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, count: 1.5 }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, bonus: 100 }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, bonus: -100 }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, bonus: 101 }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, bonus: 1.5 }).success).toBe(false)
  })

  it('vantagem e desvantagem só com quantidade 1', () => {
    expect(RollRequestSchema.safeParse({ ...ok, mode: 'advantage' }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, mode: 'disadvantage' }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, count: 2, mode: 'advantage' }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, mode: 'sorte' }).success).toBe(false)
  })

  it('recusa campos extras', () => {
    expect(RollRequestSchema.safeParse({ ...ok, sides: 3 }).success).toBe(false)
  })
})

describe('uniformInt', () => {
  it('descarta a sobra do módulo (2^32 % 6 = 4: 4294967292..4294967295 são descartados)', () => {
    expect(uniformInt(6, seq(4294967295, 4294967292, 7))).toBe(1)
  })

  it('aceita o maior valor abaixo da sobra', () => {
    expect(uniformInt(6, seq(4294967291))).toBe(5)
  })
})

describe('rollDice', () => {
  it('normal: soma todos os dados e o bônus', () => {
    expect(rollDice({ die: 6, count: 3, bonus: 2, mode: 'normal' }, seq(0, 1, 5))).toEqual({ rolls: [1, 2, 6], kept: [1, 2, 6], total: 11 })
  })

  it('vantagem: rola 2 e mantém o maior', () => {
    expect(rollDice({ die: 20, count: 1, bonus: 5, mode: 'advantage' }, seq(16, 7))).toEqual({ rolls: [17, 8], kept: [17], total: 22 })
  })

  it('desvantagem: rola 2 e mantém o menor', () => {
    expect(rollDice({ die: 20, count: 1, bonus: -1, mode: 'disadvantage' }, seq(16, 7))).toEqual({ rolls: [17, 8], kept: [8], total: 7 })
  })

  it('d100 vai de 1 a 100', () => {
    expect(rollDice({ die: 100, count: 2, bonus: 0, mode: 'normal' }, seq(0, 99))).toEqual({ rolls: [1, 100], kept: [1, 100], total: 101 })
  })
})

describe('formatRollFormula', () => {
  it('NdM com bônus positivo, negativo ou ausente', () => {
    expect(formatRollFormula({ die: 20, count: 1, bonus: 5 })).toBe('1d20+5')
    expect(formatRollFormula({ die: 6, count: 2, bonus: -3 })).toBe('2d6-3')
    expect(formatRollFormula({ die: 8, count: 4, bonus: 0 })).toBe('4d8')
  })
})
