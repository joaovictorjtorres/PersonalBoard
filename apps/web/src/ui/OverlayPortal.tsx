import type { ReactNode, SyntheticEvent } from 'react'
import { createPortal } from 'react-dom'

/**
 * Eventos sintéticos do React sobem pela árvore de componentes, não pelo DOM: sem isto, arrastar,
 * soltar ou colar dentro de um overlay chegaria aos handlers do painel (ex.: o chat enviaria o arquivo).
 */
export function guardFileEvent(e: Pick<SyntheticEvent, 'stopPropagation'>): void {
  e.stopPropagation()
}

export function guardDropEvent(e: Pick<SyntheticEvent, 'stopPropagation' | 'preventDefault'>): void {
  e.stopPropagation()
  e.preventDefault() // o navegador não abre o arquivo solto
}

/** Renderiza o overlay em document.body, fora dos contextos de empilhamento dos painéis. */
export function OverlayPortal({ children }: { children: ReactNode }) {
  return createPortal(
    <div style={{ display: 'contents' }} onPaste={guardFileEvent} onDragOver={guardDropEvent} onDrop={guardDropEvent}>
      {children}
    </div>,
    document.body,
  )
}
