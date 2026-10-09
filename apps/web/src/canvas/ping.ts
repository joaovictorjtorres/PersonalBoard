import { useRef } from 'react'
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

/** Guarda de arrasto: um clique de ping (modificador no pointerdown) nunca arrasta, trava nem confirma o objeto. */
export function createPingDragGuard() {
  // 'ping': pointerdown com modificador; 'cancelled': arrasto já cancelado (dragend tratado). Só o próximo pointerdown limpa.
  let state: 'none' | 'ping' | 'cancelled' = 'none'
  return {
    pointerDown(evt: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
      state = isPingClick(evt) ? 'ping' : 'none'
    },
    /** true = ping: o chamador não deve enviar nada. `stop` pode disparar dragend de forma síncrona (Konva), por isso o estado é lido antes. */
    dragStart(stop: () => void): boolean {
      const was = state === 'ping'
      if (was) stop()
      return was
    },
    /** true = pular commit/release (ping ou arrasto já cancelado); idempotente. */
    dragEnd(): boolean {
      if (state === 'none') return false
      state = 'cancelled'
      return true
    },
  }
}

export function usePingDragGuard() {
  const ref = useRef<ReturnType<typeof createPingDragGuard>>(null)
  ref.current ??= createPingDragGuard()
  return ref.current
}
