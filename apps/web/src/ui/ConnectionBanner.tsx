import { useTable } from '../store/context'

export function ConnectionBanner() {
  const status = useTable((s) => s.status)
  if (status === 'connecting') return <div className="panel banner">Conectando…</div>
  if (status === 'reconnecting') return <div className="panel banner">Reconectando… (edição pausada)</div>
  return null
}
