import { useEffect, useLayoutEffect, type CSSProperties, type RefObject } from 'react'

/**
 * Fecha um popover com Esc ou clique fora. Antes de fechar, tira o foco de um campo
 * dentro dele: o onBlur do campo dispara e salva o que foi digitado. Clique em `ignore`
 * (ex.: o botão que abriu o popover) não conta como "fora".
 */
export function useDismiss(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  ignore?: RefObject<HTMLElement | null>,
): void {
  useKeepInView(ref)
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
      if (ignore?.current?.contains(e.target as Node)) return
      commit()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [ref, onClose, ignore])
}

/** Posição fixa perto do clique, sem sair da janela. */
export function floatingStyle(x: number, y: number, width: number): CSSProperties {
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - 240)),
    width,
  }
}

/**
 * Overlay fixo: depois de medido, desliza para dentro da janela (a altura real só se sabe após o layout).
 * Também quando cresce depois (ex.: um submenu que abre dentro dele).
 */
function useKeepInView(ref: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || getComputedStyle(el).position !== 'fixed') return
    const fit = () => {
      const r = el.getBoundingClientRect()
      const left = Math.max(8, Math.min(r.left, window.innerWidth - r.width - 8))
      const top = Math.max(8, Math.min(r.top, window.innerHeight - r.height - 8))
      if (Math.abs(left - r.left) > 0.5) el.style.left = `${left}px`
      if (Math.abs(top - r.top) > 0.5) el.style.top = `${top}px`
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(el)
    return () => observer.disconnect()
  })
}
