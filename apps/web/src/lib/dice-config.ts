import { DICE_MAX_BONUS, DICE_MAX_COUNT, DIE_SIDES, type DieSides, type RollMode, type RollRequest } from '@mesa/shared'

export interface DiceConfig {
  die: DieSides
  count: number
  bonus: number
  mode: RollMode
  secret: boolean
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

export const DICE_CONFIG_KEY = 'mesa:dice'
export const DEFAULT_DICE_CONFIG: DiceConfig = { die: 20, count: 1, bonus: 0, mode: 'normal', secret: false }

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback
}

/** Sempre devolve uma configuração válida para o RollRequestSchema. */
export function normalizeDiceConfig(raw: unknown): DiceConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const die = DIE_SIDES.find((d) => d === r.die) ?? DEFAULT_DICE_CONFIG.die
  const count = clampInt(r.count, 1, DICE_MAX_COUNT, 1)
  const bonus = clampInt(r.bonus, -DICE_MAX_BONUS, DICE_MAX_BONUS, 0)
  const mode: RollMode = count === 1 && (r.mode === 'advantage' || r.mode === 'disadvantage') ? r.mode : 'normal'
  return { die, count, bonus, mode, secret: r.secret === true }
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadDiceConfig(storage: KeyValueStorage | null = defaultStorage()): DiceConfig {
  try {
    const raw = storage?.getItem(DICE_CONFIG_KEY)
    return raw ? normalizeDiceConfig(JSON.parse(raw)) : { ...DEFAULT_DICE_CONFIG }
  } catch {
    return { ...DEFAULT_DICE_CONFIG }
  }
}

export function saveDiceConfig(config: DiceConfig, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(DICE_CONFIG_KEY, JSON.stringify(normalizeDiceConfig(config)))
  } catch {
    // armazenamento bloqueado: a configuração vale só até fechar o modal
  }
}

export function toRollRequest(config: DiceConfig): RollRequest {
  return { die: config.die, count: config.count, bonus: config.bonus, mode: config.mode }
}
