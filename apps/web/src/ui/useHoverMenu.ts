import { useCallback, useState, type PointerEvent, type RefObject } from 'react'

export interface HoverHandlers {
  onPointerEnter: (e: PointerEvent) => void
  onPointerLeave: (e: PointerEvent) => void
}

/** O que o popover recebe: o elemento que não conta como "clique fora". */
export interface HoverMenuBinding {
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
 * Menus de hover com um só aberto por vez, sem atraso: abre ao entrar e fecha ao sair.
 * Os handlers vão no contêiner que envolve o botão E o popover (o popover é filho dele, e a
 * ponte transparente .popover-bridge cobre o vão), então ir do botão ao menu não conta como saída.
 */
export function useHoverMenus<K extends string>() {
  const [open, setOpen] = useState<K | null>(null)
  const show = useCallback((id: K) => setOpen(id), [])
  const close = useCallback(() => setOpen(null), [])

  const trigger = useCallback(
    (id: K): HoverHandlers => ({
      onPointerEnter(e) {
        if (!isTouch(e)) setOpen(id)
      },
      onPointerLeave(e) {
        if (isTouch(e) || typingInPopover()) return
        setOpen((cur) => (cur === id ? null : cur))
      },
    }),
    [],
  )

  return { open, show, close, trigger }
}
