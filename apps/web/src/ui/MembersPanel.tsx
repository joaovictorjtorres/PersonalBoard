import { X } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'

export function MembersPanel() {
  const members = useTable((s) => s.members)
  const selfId = useTable((s) => s.self?.clientId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  // O servidor já filtra: online ou vistos nos últimos 7 dias.
  const list = Object.values(members).sort(
    (a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname),
  )
  return (
    <div className="panel members">
      <strong>Na mesa</strong>
      <ul>
        {list.map((m) => (
          <li key={m.clientId} className={m.online ? '' : 'offline'}>
            <span className="dot" style={{ background: m.color }} />
            {m.nickname}
            {m.clientId === selfId ? ' (você)' : ''}
            {m.role === 'gm' ? ' · mestre' : ''}
            {isGm && !m.online && m.clientId !== selfId && (
              <button
                className="icon-button"
                aria-label={`Remover ${m.nickname} da lista`}
                title="Remover da lista"
                onClick={() => actions.submit({ kind: 'memberRemove', clientId: m.clientId })}
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
