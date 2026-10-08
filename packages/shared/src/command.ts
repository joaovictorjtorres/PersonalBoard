import { RollRequestSchema, type RollRequest } from './dice'

export type ParsedCommand = { kind: 'roll'; request: RollRequest } | { kind: 'invalid' }

const ROLL_RE = /^\/r\s+(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?(?:\s+(adv|dis))?$/i

/** `null` = texto comum; `/r …` vira rolagem ou `invalid`. */
export function parseCommand(input: string): ParsedCommand | null {
  const text = input.trim()
  if (!/^\/r(\s|$)/i.test(text)) return null
  const match = ROLL_RE.exec(text)
  if (!match) return { kind: 'invalid' }
  const [, count, die, sign, bonus, suffix] = match
  const mode = suffix === undefined ? 'normal' : suffix.toLowerCase() === 'adv' ? 'advantage' : 'disadvantage'
  const parsed = RollRequestSchema.safeParse({
    die: Number(die),
    count: count === '' ? 1 : Number(count),
    bonus: bonus === undefined ? 0 : sign === '-' ? -Number(bonus) : Number(bonus),
    mode,
  })
  return parsed.success ? { kind: 'roll', request: parsed.data } : { kind: 'invalid' }
}
