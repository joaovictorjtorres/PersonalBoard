import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type RefObject } from 'react'

/** Abre na hora; o atraso de fechar deixa atravessar o vão até o popover. */
export const HOVER_CLOSE_MS = 250

export interface HoverHandlers {
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
}

/** O que o popover recebe: o mesmo par de handlers do botão e o elemento que não conta como "clique fora". */
export interface HoverMenuBinding extends HoverHandlers {
  anchor: RefObject<HTMLElement | null>
}

/** Toque não tem hover: lá o menu continua abrindo pelo botão direito / toque longo. */
const isTouch = (e: PointerEvent) => e.pointerType === 'touch'

/** Campo de texto focado dentro de um popover: sair com o mouse não descarta o que está sendo digitado. */
function typingInPopover(): boolean {
  const a = document.activeElement
  return a instanceof HTMLInputElement && (a.type === 'text' || a.type === 'number') && !!a.closest('.popover')
}

/**
 * Menus de hover com um só aberto por vez. Botão e popover compartilham o mesmo timer de fechar:
 * o menu fica aberto enquanto o ponteiro estiver em qualquer um dos dois (funciona mesmo com o
 * popover em portal, porque os eventos são ligados em cada elemento).
 */
export function useHoverMenus<K extends string>() {
  const [open, setOpen] = useState<K | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const clearTimers = useCallback(() => clearTimeout(closeTimer.current), [])
  useEffect(() => clearTimers, [clearTimers])

  const show = useCallback(
    (id: K) => {
      clearTimers()
      setOpen(id)
    },
    [clearTimers],
  )
  const close = useCallback(() => {
    clearTimers()
    setOpen(null)
  }, [clearTimers])
  const scheduleClose = useCallback(() => {
    clearTimeout(closeTimer.current)
    closeTimer.current = setTimeout(() => {
      if (!typingInPopover()) setOpen(null)
    }, HOVER_CLOSE_MS)
  }, [])

  const trigger = useCallback(
    (id: K): HoverHandlers => ({
      onPointerEnter(e) {
        if (isTouch(e)) return
        clearTimeout(closeTimer.current)
        setOpen(id)
      },
      onPointerLeave(e) {
        if (!isTouch(e)) scheduleClose()
      },
    }),
    [scheduleClose],
  )

  const surface = useMemo<HoverHandlers>(
    () => ({
      onPointerEnter(e) {
        if (!isTouch(e)) clearTimeout(closeTimer.current)
      },
      onPointerLeave(e) {
        if (!isTouch(e)) scheduleClose()
      },
    }),
    [scheduleClose],
  )

  return { open, show, close, trigger, surface }
}
