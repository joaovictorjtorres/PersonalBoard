import { useEffect, useState } from 'react'
import { useTableStore } from '../store/context'

export function DebugPanel() {
  const store = useTableStore()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const s = store.getState()
  const stats = s.actions.stats()
  return (
    <div className="panel debug">
      msgs enviadas: {stats.sent}
      <br />
      msgs recebidas: {stats.received}
      <br />
      escritas confirmadas: {stats.writes}
      <br />
      ops pendentes: {Object.keys(s.pending).length}
      <br />
      objetos: {Object.keys(s.objects).length}
    </div>
  )
}
