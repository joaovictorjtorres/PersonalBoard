import { ALLOWED_UPLOAD_TYPES, CHAT_THUMB_MAX, type RollMode, type RollRequest, type RollResult } from '@mesa/shared'
import { fitWithin } from '../../lib/image'

export interface DiePart {
  value: number
  /** false = descartado (vantagem/desvantagem): aparece riscado. */
  kept: boolean
  /** Só no d20: 20 natural = 'crit' (verde), 1 natural = 'fumble' (vermelho). */
  tone: 'crit' | 'fumble' | null
}

export function rollParts(request: Pick<RollRequest, 'die'>, result: Pick<RollResult, 'rolls' | 'kept'>): DiePart[] {
  const remaining = [...result.kept]
  return result.rolls.map((value) => {
    const i = remaining.indexOf(value)
    if (i !== -1) remaining.splice(i, 1)
    const tone = request.die !== 20 ? null : value === 20 ? 'crit' : value === 1 ? 'fumble' : null
    return { value, kept: i !== -1, tone }
  })
}

export function modeLabel(mode: RollMode): string {
  return mode === 'advantage' ? ' (vantagem)' : mode === 'disadvantage' ? ' (desvantagem)' : ''
}

export function bonusLabel(bonus: number): string {
  return bonus > 0 ? ` + ${bonus}` : bonus < 0 ? ` - ${-bonus}` : ''
}

export function formatTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function thumbSize(width: number, height: number): { width: number; height: number } {
  return fitWithin(width, height, CHAT_THUMB_MAX)
}

/** Primeiro arquivo de imagem aceito pelo upload (PNG, JPEG, WebP ou GIF); o resto é ignorado. */
export function pickImageFile<T extends { type: string }>(files: ArrayLike<T> | null | undefined): T | null {
  return Array.from(files ?? []).find((f) => ALLOWED_UPLOAD_TYPES.includes(f.type)) ?? null
}
