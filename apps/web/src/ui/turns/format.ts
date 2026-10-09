import { INITIATIVE_MAX, INITIATIVE_MIN, type Turns } from '@mesa/shared'

/** "?" sem valor (o app não usa travessões). */
export function initiativeLabel(value: number | null): string {
  return value === null ? '?' : String(value)
}

/** Vazio = limpar (null); inteiro de -99 a 999 = valor; qualquer outra coisa = recusado (undefined). */
export function parseInitiativeInput(text: string): number | null | undefined {
  const t = text.trim().replace('−', '-')
  if (t === '') return null
  if (!/^-?\d{1,3}$/.test(t)) return undefined
  const n = Number(t)
  return n >= INITIATIVE_MIN && n <= INITIATIVE_MAX ? n : undefined
}

/** Texto da janela minimizada. */
export function turnsSummary(turns: Turns): string {
  if (turns.phase === 'prep') return 'Turnos · preparação'
  const current = turns.entries.find((e) => e.id === turns.currentId)
  return `Rodada ${turns.round} · Vez de: ${current?.name ?? '?'}`
}
