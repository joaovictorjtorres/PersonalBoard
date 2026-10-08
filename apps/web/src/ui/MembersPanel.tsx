import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { MemberMenu } from './MemberMenu'
import { memberMenuOptions } from './memberMenu'

export function MembersPanel() {
  const members = useTable((s) => s.members)
  const selfId = useTable((s) => s.self?.clientId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const [menu, setMenu] = useState<{ clientId: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // O servidor já filtra: online ou vistos nos últimos 7 dias.
  const list = Object.values(members).sort(
    (a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname),
  )
  const menuMember = menu ? members[menu.clientId] : undefined

  return (
    <div className="panel members">
      <strong>Na mesa</strong>
      <ul>
        {list.map((m) => (
          <li
            key={m.clientId}
            className={m.online ? '' : 'offline'}
            title="Botão direito: conversa privada"
            onContextMenu={(e) => {
              e.preventDefault()
              const options = memberMenuOptions(m.clientId, selfId, isGm)
              if (options.dm || options.edit) setMenu({ clientId: m.clientId, x: e.clientX, y: e.clientY })
            }}
          >
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
      {menu && menuMember && (
        <MemberMenu key={menu.clientId} member={menuMember} x={menu.x} y={menu.y} onClose={closeMenu} />
      )}
    </div>
  )
}
