import { useRef, useState } from 'react'
import { MessageCircle, UserPen } from 'lucide-react'
import type { Member } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { memberMenuOptions, memberPatch } from './memberMenu'
import { floatingStyle, useDismiss } from './useDismiss'

export function MemberMenu({ member, x, y, onClose }: { member: Member; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const selfId = useTable((s) => s.self?.clientId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(member.nickname)
  const [color, setColor] = useState(member.color)
  const options = memberMenuOptions(member.clientId, selfId, isGm)

  return (
    <div
      ref={ref}
      className="panel popover floating"
      role="dialog"
      aria-label={`Ações para ${member.nickname}`}
      style={floatingStyle(x - 260, y, 240)}
    >
      {options.dm && (
        <button
          onClick={() => {
            actions.openDm(member.clientId)
            onClose()
          }}
        >
          <MessageCircle size={16} aria-hidden /> Conversa privada
        </button>
      )}
      {options.edit && !editing && (
        <button onClick={() => setEditing(true)}>
          <UserPen size={16} aria-hidden /> Editar apelido e cor
        </button>
      )}
      {options.edit && editing && (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault()
            const patch = memberPatch(member, nickname, color)
            if (patch) actions.updateMember(member.clientId, patch)
            onClose()
          }}
        >
          <label className="field">
            Apelido
            <input autoFocus value={nickname} maxLength={32} onChange={(e) => setNickname(e.target.value)} />
          </label>
          <label>
            Cor
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <button type="submit" disabled={!nickname.trim()}>
            Salvar
          </button>
        </form>
      )}
    </div>
  )
}
