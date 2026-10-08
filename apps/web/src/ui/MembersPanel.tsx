import { useTable } from '../store/context'

export function MembersPanel() {
  const members = useTable((s) => s.members)
  const selfId = useTable((s) => s.self?.clientId)
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
          </li>
        ))}
      </ul>
    </div>
  )
}
