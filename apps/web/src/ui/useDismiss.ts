import { useEffect, type CSSProperties, type RefObject } from 'react'

/**
 * Fecha um popover com Esc ou clique fora. Antes de fechar, tira o foco de um campo
 * dentro dele: o onBlur do campo dispara e salva o que foi digitado.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const commit = () => {
      const active = document.activeElement
      if (active instanceof HTMLElement && ref.current?.contains(active)) active.blur()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      commit()
      onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      commit()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [ref, onClose])
}

/** Posição fixa perto do clique, sem sair da janela. */
export function floatingStyle(x: number, y: number, width: number): CSSProperties {
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - 240)),
    width,
  }
}
