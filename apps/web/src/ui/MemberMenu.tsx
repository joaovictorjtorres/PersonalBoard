import { useRef, useState, type ReactNode } from 'react'
import { Eraser, Layers, MessageCircle, UserPen } from 'lucide-react'
import { MEMBER_COLORS, type Member } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { confirmClear, planMember, type ClearPlan } from './clearPlans'
import { ColorPicker } from './ColorPicker'
import { memberMenuOptions, memberPatch } from './memberMenuOptions'
import { OverlayPortal } from './OverlayPortal'
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
  const self = useTable((s) => s.self)
  const objects = useTable((s) => s.objects)
  const layers = useTable((s) => s.layers)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const view = self ? { objects, layers, self } : null
  // Fecha o menu antes do aviso (o clique no aviso não pode contar como "fora" do menu).
  const clear = (plan: ClearPlan) => {
    onClose()
    void confirmClear(plan, actions.submit)
  }
  const clearButton = (plan: ClearPlan | null, label: string, icon: ReactNode) => (
    <button
      className="danger"
      disabled={!plan || plan.count === 0}
      title={plan && plan.count === 0 ? 'Nada para apagar' : undefined}
      onClick={() => plan && clear(plan)}
    >
      {icon} {label}
    </button>
  )

  return (
    <OverlayPortal>
    <div
      ref={ref}
      className="panel popover floating"
      role="dialog"
      aria-label={`Ações para ${member.nickname}`}
      style={floatingStyle(x - 300, y, 280)}
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
          <ColorPicker label="Cor do membro" value={color} presets={MEMBER_COLORS} onChange={setColor} />
          <button type="submit" disabled={!nickname.trim()}>
            Salvar
          </button>
        </form>
      )}
      {options.clear && !editing && view && (
        <>
          {clearButton(
            planMember(view, member, activeLayerId),
            `Apagar desenhos de ${member.nickname} na camada atual`,
            <Eraser size={16} aria-hidden />,
          )}
          {clearButton(
            planMember(view, member, null),
            `Apagar desenhos de ${member.nickname} em todas as camadas`,
            <Layers size={16} aria-hidden />,
          )}
        </>
      )}
    </div>
    </OverlayPortal>
  )
}
