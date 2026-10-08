import { useEffect } from 'react'
import type { Toast } from '../store/state'
import { useTable, useTableActions } from '../store/context'

export function Toasts() {
  const toasts = useTable((s) => s.toasts)
  return (
    <div className="panel toasts" role="status">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const actions = useTableActions()
  useEffect(() => {
    const id = setTimeout(() => actions.dismissToast(toast.id), toast.action ? 8000 : 4000)
    return () => clearTimeout(id)
  }, [actions, toast.id, toast.action])
  return (
    <div className="toast">
      <span>{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run()
            actions.dismissToast(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
