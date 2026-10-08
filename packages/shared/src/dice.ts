import { z } from 'zod'
import { DICE_MAX_BONUS, DICE_MAX_COUNT } from './constants'

export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const
export type DieSides = (typeof DIE_SIDES)[number]

export const RollModeSchema = z.enum(['normal', 'advantage', 'disadvantage'])
export type RollMode = z.infer<typeof RollModeSchema>

export const RollRequestSchema = z
  .strictObject({
    die: z.literal(DIE_SIDES),
    count: z.number().int().min(1).max(DICE_MAX_COUNT),
    bonus: z.number().int().min(-DICE_MAX_BONUS).max(DICE_MAX_BONUS),
    mode: RollModeSchema,
  })
  .refine((r) => r.mode === 'normal' || r.count === 1, 'advantage/disadvantage only with count 1')
export type RollRequest = z.infer<typeof RollRequestSchema>

export interface RollResult {
  rolls: number[]
  kept: number[]
  total: number
}

const RANGE = 2 ** 32

/** Inteiro uniforme em [0, n) a partir de uint32; descarta a sobra para não enviesar o módulo. */
export function uniformInt(n: number, nextUint32: () => number): number {
  const limit = RANGE - (RANGE % n)
  for (;;) {
    const x = nextUint32()
    if (x < limit) return x % n
  }
}

export function rollDice(request: RollRequest, nextUint32: () => number): RollResult {
  const n = request.mode === 'normal' ? request.count : 2
  const rolls = Array.from({ length: n }, () => uniformInt(request.die, nextUint32) + 1)
  const kept =
    request.mode === 'advantage' ? [Math.max(...rolls)] : request.mode === 'disadvantage' ? [Math.min(...rolls)] : [...rolls]
  return { rolls, kept, total: kept.reduce((sum, v) => sum + v, 0) + request.bonus }
}

export function formatRollFormula(r: Pick<RollRequest, 'die' | 'count' | 'bonus'>): string {
  const bonus = r.bonus > 0 ? `+${r.bonus}` : r.bonus < 0 ? `${r.bonus}` : ''
  return `${r.count}d${r.die}${bonus}`
}
