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

/** Guarda de arrasto: um clique de ping (modificador no mousedown) nunca arrasta, trava nem confirma o objeto. */
export function createPingDragGuard() {
  let ping = false
  return {
    mouseDown(evt: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): void {
      ping = isPingClick(evt)
    },
    /** true = ping: o chamador não deve enviar nada. Chama `stop` para cancelar o arrasto. */
    dragStart(stop: () => void): boolean {
      if (ping) stop()
      return ping
    },
    /** true = ping: pular commit/release; limpa a marca. */
    dragEnd(): boolean {
      const was = ping
      ping = false
      return was
    },
  }
}

export function usePingDragGuard() {
  const ref = useRef<ReturnType<typeof createPingDragGuard>>(null)
  ref.current ??= createPingDragGuard()
  return ref.current
}
