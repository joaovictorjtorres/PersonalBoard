import { PING_DURATION_MS } from '@mesa/shared'

/** Shift + clique = ping; Ctrl/⌘ + clique = ping pedindo para centralizar (o servidor só aceita do mestre). */
export function isPingClick(evt: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return evt.shiftKey || evt.ctrlKey || evt.metaKey
}

/** Anel que cresce de 6 a 40 px de tela e some ao longo de 2 s; null quando acabou. */
export function pingRing(ageMs: number): { radius: number; opacity: number } | null {
  if (ageMs >= PING_DURATION_MS) return null
  const t = Math.max(0, ageMs) / PING_DURATION_MS
  return { radius: 6 + 34 * t, opacity: 1 - t }
}
