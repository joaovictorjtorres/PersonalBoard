import { useEffect, useRef, useState } from 'react'
import { Copy, GripVertical, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { TURN_NAME_MAX, type TurnEntry } from '@mesa/shared'
import { useTable, useTableActions } from '../../store/context'
import { linkedImage } from '../../store/turns'
import { initiativeLabel, parseInitiativeInput } from './format'

/** Tipo do arrasto entre cards (não se mistura com arquivos soltos na mesa). */
const TURN_DRAG_TYPE = 'application/x-mesa-turn'

interface TurnCardProps {
  entry: TurnEntry
  index: number
  current: boolean
  isGm: boolean
  /** 50 entradas: duplicar desativado. */
  full: boolean
}

export function TurnCard({ entry, index, current, isGm, full }: TurnCardProps) {
  const actions = useTableActions()
  // Miniatura só se eu tenho o token (imagem) no estado: apagado ou em camada oculta, sem miniatura.
  const assetKey = useTable((s) => linkedImage(s, entry.tokenId)?.assetKey ?? null)
  const [editing, setEditing] = useState<'name' | 'initiative' | null>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const ref = useRef<HTMLLIElement>(null)

  // A lista rola até o card da vez quando a vez muda.
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <li
      ref={ref}
      className={`turn-card${current ? ' current' : ''}${dropTarget ? ' drop-target' : ''}`}
      aria-current={current ? 'true' : undefined}
      onPointerEnter={() => actions.setTurnHover(entry.tokenId)}
      onPointerLeave={() => actions.setTurnHover(null)}
      onDragOver={(e) => {
        if (!isGm || !e.dataTransfer.types.includes(TURN_DRAG_TYPE)) return
        e.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        if (!isGm) return
        e.preventDefault()
        setDropTarget(false)
        const id = e.dataTransfer.getData(TURN_DRAG_TYPE)
        if (id && id !== entry.id) actions.submit({ kind: 'turnMove', id, index })
      }}
    >
      {isGm && (
        <span
          className="turn-handle"
          draggable
          role="img"
          aria-label="Arrastar para reordenar"
          title="Arrastar para reordenar"
          onDragStart={(e) => {
            e.dataTransfer.setData(TURN_DRAG_TYPE, entry.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
        >
          <GripVertical size={14} aria-hidden />
        </span>
      )}
      {assetKey && entry.tokenId && (
        <button
          type="button"
          className="turn-thumb"
          aria-label={`Centralizar em ${entry.name}`}
          title="Centralizar no token"
          onClick={() => entry.tokenId && actions.focusObject(entry.tokenId)}
        >
          <img src={`/files/${assetKey}`} alt="" />
        </button>
      )}
      {editing === 'name' ? (
        <NameField entry={entry} onDone={() => setEditing(null)} />
      ) : (
        <span
          className={`turn-name${isGm ? ' editable' : ''}`}
          title={isGm ? 'Clique para editar o nome' : entry.name}
          onClick={isGm ? () => setEditing('name') : undefined}
        >
          {entry.name}
        </span>
      )}
      {isGm && (
        <span className="turn-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`Duplicar ${entry.name}`}
            title={full ? 'A ordem de turnos está cheia' : 'Duplicar'}
            disabled={full}
            onClick={() => actions.submit({ kind: 'turnDuplicate', id: entry.id, newId: nanoid() })}
          >
            <Copy size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button danger"
            aria-label={`Remover ${entry.name}`}
            title="Remover"
            onClick={() => actions.submit({ kind: 'turnRemove', id: entry.id })}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </span>
      )}
      {editing === 'initiative' ? (
        <InitiativeField entry={entry} onDone={() => setEditing(null)} />
      ) : (
        <span
          className={`turn-init${isGm ? ' editable' : ''}`}
          title={isGm ? 'Clique para editar a iniciativa' : 'Iniciativa'}
          onClick={isGm ? () => setEditing('initiative') : undefined}
        >
          {initiativeLabel(entry.initiative)}
        </span>
      )}
    </li>
  )
}

/** Enter ou sair do campo salva; Esc cancela; vazio volta ao nome anterior. */
function NameField({ entry, onDone }: { entry: TurnEntry; onDone: () => void }) {
  const actions = useTableActions()
  const cancelled = useRef(false)
  return (
    <input
      className="turn-name-input"
      aria-label={`Nome de ${entry.name}`}
      autoFocus
      defaultValue={entry.name}
      maxLength={TURN_NAME_MAX}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => {
        const name = e.currentTarget.value.trim()
        if (!cancelled.current && name !== '' && name !== entry.name) {
          actions.submit({ kind: 'turnUpdate', id: entry.id, patch: { name } })
        }
        onDone()
      }}
    />
  )
}

/** Inteiro de -99 a 999 (vazio limpa); valor recusado fica marcado e não é salvo. */
function InitiativeField({ entry, onDone }: { entry: TurnEntry; onDone: () => void }) {
  const actions = useTableActions()
  const cancelled = useRef(false)
  const [text, setText] = useState(entry.initiative === null ? '' : String(entry.initiative))
  const parsed = parseInitiativeInput(text)
  const invalid = parsed === undefined
  return (
    <input
      className="turn-init-input"
      aria-label={`Iniciativa de ${entry.name}`}
      autoFocus
      inputMode="numeric"
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
        if (e.key === 'Enter' && !invalid) e.currentTarget.blur()
      }}
      onBlur={() => {
        if (!cancelled.current && parsed !== undefined && parsed !== entry.initiative) {
          actions.submit({ kind: 'turnUpdate', id: entry.id, patch: { initiative: parsed } })
        }
        onDone()
      }}
    />
  )
}
