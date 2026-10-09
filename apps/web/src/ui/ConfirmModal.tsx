import { useEffect, useRef } from 'react'
import { useStore } from 'zustand'
import { confirmKeyAction, confirmStore, settleConfirm, type ConfirmRequest } from './confirm'
import { OverlayPortal } from './OverlayPortal'

/** Monta o aviso de confirmação pedido por `askConfirm` (um por vez). */
export function ConfirmHost() {
  const request = useStore(confirmStore, (s) => s.request)
  return request ? <ConfirmModal key={request.id} request={request} /> : null
}

function ConfirmModal({ request }: { request: ConfirmRequest }) {
  const cancelRef = useRef<HTMLButtonElement>(null)
  const confirmRef = useRef<HTMLButtonElement>(null)
  const altRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    confirmRef.current?.focus()
    // Captura no document: nenhuma tecla chega aos atalhos da mesa (Ctrl+Z, Delete, ferramentas) nem aos menus.
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation()
      if (e.key === 'Tab') {
        // foco preso entre os botões do aviso
        e.preventDefault()
        const order = [cancelRef.current, altRef.current, confirmRef.current].filter((b): b is HTMLButtonElement => !!b)
        const i = order.indexOf(document.activeElement as HTMLButtonElement)
        order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]?.focus()
        return
      }
      if (e.key === 'Enter' && altRef.current && document.activeElement === altRef.current) {
        e.preventDefault()
        settleConfirm('alternative')
        return
      }
      const action = confirmKeyAction(e.key, document.activeElement === cancelRef.current)
      if (!action) return
      e.preventDefault()
      settleConfirm(action === 'confirm')
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      if (previous?.isConnected) previous.focus()
    }
  }, [])

  return (
    <OverlayPortal>
      <div
        className="modal-backdrop confirm-backdrop"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) settleConfirm(false)
        }}
      >
        <div
          className="modal confirm-modal"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-title"
          aria-describedby="confirm-message"
        >
          <h2 id="confirm-title">{request.title}</h2>
          <p id="confirm-message">{request.message}</p>
          <div className="modal-actions">
            <button ref={cancelRef} type="button" onClick={() => settleConfirm(false)}>
              Cancelar
            </button>
            {request.alternativeLabel && (
              <button
                ref={altRef}
                type="button"
                className={request.alternativeDanger ? 'danger-solid' : undefined}
                onClick={() => settleConfirm('alternative')}
              >
                {request.alternativeLabel}
              </button>
            )}
            <button
              ref={confirmRef}
              type="button"
              className={request.danger ? 'danger-solid' : 'primary'}
              onClick={() => settleConfirm(true)}
            >
              {request.confirmLabel ?? 'Confirmar'}
            </button>
          </div>
        </div>
      </div>
    </OverlayPortal>
  )
}
