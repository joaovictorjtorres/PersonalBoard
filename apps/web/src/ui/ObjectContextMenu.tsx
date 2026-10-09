import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Layers, StickyNote, Swords, Trash2 } from 'lucide-react'
import {
  MAX_CONTROL_IDS,
  NOTE_MAX,
  TITLE_MAX,
  TURNS_MAX,
  canControl,
  type Control,
  type ObjectPatch,
  type TableObject,
} from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { floatingStyle, useDismiss } from './useDismiss'

const MODES: Array<{ mode: Control['mode']; label: string }> = [
  { mode: 'all', label: 'Todos' },
  { mode: 'gm', label: 'Só o mestre' },
  { mode: 'list', label: 'Jogadores escolhidos' },
]

export function ObjectContextMenu() {
  const menu = useTable((s) => s.objectMenu)
  const object = useTable((s) => (s.objectMenu ? s.objects[s.objectMenu.objectId] : undefined))
  const allowed = useTable((s) => {
    const o = s.objectMenu ? s.objects[s.objectMenu.objectId] : undefined
    return !!o && !!s.self && canControl(o, s.self.clientId, s.self.role)
  })
  const actions = useTableActions()

  // Objeto apagado (ou controle perdido) com o menu aberto: o menu fecha.
  useEffect(() => {
    if (menu && (!object || !allowed)) actions.closeObjectMenu()
  }, [menu, object, allowed, actions])

  if (!menu || !object || !allowed) return null
  return <ObjectMenuBody key={object.id} object={object} x={menu.x} y={menu.y} onClose={actions.closeObjectMenu} />
}

function ObjectMenuBody({ object, x, y, onClose }: { object: TableObject; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const layerEditable = useTable(() => actions.canEditLayer(object.layerId))
  const update = (patch: ObjectPatch) => actions.submit({ kind: 'update', id: object.id, patch })

  return (
    <div
      ref={ref}
      className="panel popover floating context-menu"
      role="dialog"
      aria-label="Menu do objeto"
      style={floatingStyle(x, y, 260)}
    >
      <TitleField title={object.title} onSave={(title) => update({ title })} />
      {isGm && <PermissionsField objectId={object.id} control={object.control} onChange={(control) => update({ control })} />}
      {isGm && <NoteField objectId={object.id} />}
      {isGm && (
        <MoveToLayerField
          exclude={object.layerId}
          onPick={(layerId) => {
            actions.moveObjectToLayer(object.id, layerId)
            onClose()
          }}
        />
      )}
      {isGm && object.type === 'image' && <AddToTurns objectId={object.id} onDone={onClose} />}
      {layerEditable && (
        <button
          className="danger"
          onClick={() => {
            actions.submit({ kind: 'delete', id: object.id })
            onClose()
          }}
        >
          <Trash2 size={16} aria-hidden /> Apagar
        </button>
      )}
    </div>
  )
}

function TitleField({ title, onSave }: { title: string | undefined; onSave: (title: string | null) => void }) {
  const current = title ?? ''
  return (
    <label className="field">
      Título
      <input
        defaultValue={current}
        maxLength={TITLE_MAX}
        placeholder="Sem título"
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        onBlur={(e) => {
          const value = e.currentTarget.value.trim().slice(0, TITLE_MAX)
          if (value === current) return
          onSave(value === '' ? null : value) // vazio remove o título
        }}
      />
    </label>
  )
}

export function PermissionsField({
  objectId,
  control,
  onChange,
  legend = 'Permissões',
}: {
  objectId: string
  control: Control
  onChange: (control: Control) => void
  legend?: string
}) {
  const members = useTable((s) => s.members)
  const players = Object.values(members)
    .filter((m) => m.role === 'player')
    .sort((a, b) => a.nickname.localeCompare(b.nickname))
  const toggle = (clientId: string) => {
    const clientIds = control.clientIds.includes(clientId)
      ? control.clientIds.filter((id) => id !== clientId)
      : [...control.clientIds, clientId].slice(-MAX_CONTROL_IDS)
    onChange({ mode: 'list', clientIds })
  }

  return (
    <fieldset className="field">
      <legend>{legend}</legend>
      {MODES.map((m) => (
        <label key={m.mode}>
          <input
            type="radio"
            name={`control-${objectId}`}
            checked={control.mode === m.mode}
            onChange={() => onChange({ mode: m.mode, clientIds: control.clientIds })}
          />
          {m.label}
        </label>
      ))}
      {players.map((p) => (
        <label key={p.clientId} className="indent">
          <input
            type="checkbox"
            disabled={control.mode !== 'list'}
            checked={control.clientIds.includes(p.clientId)}
            onChange={() => toggle(p.clientId)}
          />
          {p.nickname}
        </label>
      ))}
      {players.length === 0 && <small>Nenhum jogador na lista</small>}
    </fieldset>
  )
}

function NoteField({ objectId }: { objectId: string }) {
  const current = useTable((s) => s.notes[objectId] ?? '')
  const actions = useTableActions()
  return (
    <label className="field">
      <span className="row">
        <StickyNote size={14} aria-hidden /> Anotação do mestre
      </span>
      <textarea
        defaultValue={current}
        maxLength={NOTE_MAX}
        rows={3}
        onBlur={(e) => {
          const text = e.currentTarget.value
          if (text !== current) actions.submit({ kind: 'noteSet', objectId, text })
        }}
      />
    </label>
  )
}

/** "Mover para camada" e a lista de destino (da mais alta para a mais baixa, sem `exclude`): menu do objeto e do grupo. */
export function MoveToLayerField({ exclude, onPick }: { exclude?: string; onPick: (layerId: string) => void }) {
  const [open, setOpen] = useState(false)
  const layers = useTable((s) => s.layers)
  const targets = [...layers].reverse().filter((l) => l.id !== exclude)

  return (
    <div className="field">
      <button aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Layers size={16} aria-hidden /> Mover para camada <ChevronRight size={14} aria-hidden />
      </button>
      {open && (
        <div className="submenu" role="group" aria-label="Camadas de destino">
          {targets.map((layer) => (
            <button key={layer.id} onClick={() => onPick(layer.id)}>
              {layer.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function AddToTurns({ objectId, onDone }: { objectId: string; onDone: () => void }) {
  const full = useTable((s) => s.turns.entries.length >= TURNS_MAX)
  const actions = useTableActions()
  return (
    <button
      disabled={full}
      title={full ? 'A ordem de turnos está cheia (máximo 50)' : undefined}
      onClick={() => {
        actions.addTokenToTurns(objectId)
        onDone()
      }}
    >
      <Swords size={16} aria-hidden /> Adicionar à ordem de turnos
    </button>
  )
}
