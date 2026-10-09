import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { MemberMenu } from './MemberMenu'
import { memberMenuOptions } from './memberMenuOptions'
import { confirmRemoveMember } from './removeMember'

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
        {list.map((m) => {
          const options = memberMenuOptions(m.clientId, selfId, isGm, m.role)
          const hasMenu = options.dm || options.edit || options.clear
          return (
          <li
            key={m.clientId}
            className={m.online ? '' : 'offline'}
            title={options.dm ? 'Dois cliques: conversa privada. Botão direito: mais opções' : undefined}
            onDoubleClick={(e) => {
              if (!options.dm || (e.target as HTMLElement).closest('button')) return
              window.getSelection()?.removeAllRanges()
              actions.openDm(m.clientId)
            }}
            onContextMenu={(e) => {
              if (!hasMenu) return
              e.preventDefault()
              setMenu({ clientId: m.clientId, x: e.clientX, y: e.clientY })
            }}
          >
            <span className="dot" style={{ background: m.color }} />
            {m.nickname}
            {m.clientId === selfId ? ' (você)' : ''}
            {m.role === 'gm' ? ' · mestre' : ''}
            {options.remove && !m.online && (
              <button
                className="icon-button"
                aria-label={`Remover ${m.nickname} da lista`}
                title="Remover da lista"
                onClick={() => void confirmRemoveMember(m, actions.submit)}
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </li>
          )
        })}
      </ul>
      {menu && menuMember && (
        <MemberMenu key={menu.clientId} member={menuMember} x={menu.x} y={menu.y} onClose={closeMenu} />
      )}
    </div>
  )
}
