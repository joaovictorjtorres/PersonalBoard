import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Minus, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { TURNS_MAX, TURN_NAME_MAX, type Turns } from '@mesa/shared'
import { useTable, useTableActions } from '../../store/context'
import { askChoice } from '../confirm'
import { turnsSummary } from './format'
import { TurnCard } from './TurnCard'
import {
  TURNS_WINDOW_WIDTH,
  clampPosition,
  defaultPosition,
  readTurnsPrefs,
  writeTurnsPrefs,
  type TurnsWindowPrefs,
} from './windowPrefs'

/** O cabeçalho fica sempre alcançável na tela. */
const HEADER_HEIGHT = 40
/** A partir deste deslocamento (px) o gesto no cabeçalho é arrasto, não clique. */
const DRAG_THRESHOLD = 4

/** Janela da ordem de turnos: aparece para todos quando o mestre abre. */
export function TurnsWindow() {
  const open = useTable((s) => s.turns.open)
  const tableId = useTable((s) => s.meta?.id)
  if (!open || !tableId) return null
  return <TurnsWindowBody key={tableId} tableId={tableId} />
}

interface Gesture {
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  moved: boolean
}

function TurnsWindowBody({ tableId }: { tableId: string }) {
  const turns = useTable((s) => s.turns)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const [prefs, setPrefs] = useState<TurnsWindowPrefs>(() => readTurnsPrefs(tableId))
  const gesture = useRef<Gesture | null>(null)

  // Fechou a janela com o mouse sobre um card: o destaque no mapa não fica preso.
  useEffect(() => () => actions.setTurnHover(null), [actions])

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const stored = prefs.x !== null && prefs.y !== null ? { x: prefs.x, y: prefs.y } : defaultPosition(viewport.width)
  const pos = clampPosition(stored, { width: Math.min(TURNS_WINDOW_WIDTH, viewport.width), height: HEADER_HEIGHT }, viewport)

  const save = (next: TurnsWindowPrefs) => {
    setPrefs(next)
    writeTurnsPrefs(tableId, next)
  }

  const header = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
      gesture.current = { startX: e.clientX, startY: e.clientY, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const g = gesture.current
      if (!g) return
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return
      g.moved = true
      setPrefs((p) => ({ ...p, x: e.clientX - g.offsetX, y: e.clientY - g.offsetY }))
    },
    onPointerUp() {
      const g = gesture.current
      gesture.current = null
      if (!g) return
      if (g.moved) save({ ...prefs, x: pos.x, y: pos.y })
      else if (prefs.minimized) save({ ...prefs, minimized: false }) // clique na faixa reabre
    },
    onPointerCancel() {
      gesture.current = null
    },
  }

  const style = { left: pos.x, top: pos.y }

  if (prefs.minimized) {
    return (
      <section className="panel turns-window minimized" aria-label="Turnos" style={style}>
        <header
          className="turns-header"
          role="button"
          tabIndex={0}
          title="Clique para abrir; arraste para mover"
          {...header}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            save({ ...prefs, minimized: false })
          }}
        >
          <span className="turns-summary">{turnsSummary(turns)}</span>
        </header>
      </section>
    )
  }

  return (
    <section className="panel turns-window" aria-label="Turnos" style={style}>
      <header className="turns-header" title="Arraste para mover" {...header}>
        <strong>Turnos</strong>
        {turns.phase === 'combat' && <span className="turns-round">Rodada {turns.round}</span>}
        <span className="turns-header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Minimizar"
            title="Minimizar"
            onClick={() => save({ ...prefs, minimized: true })}
          >
            <Minus size={16} aria-hidden />
          </button>
          {isGm && (
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar para todos"
              title="Fechar para todos"
              onClick={() => actions.submit({ kind: 'turnsOpen', open: false })}
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </span>
      </header>
      {turns.entries.length === 0 ? (
        <p className="turns-empty">
          {isGm ? 'Adicione participantes aqui embaixo ou pelo botão direito num token.' : 'Nenhum participante ainda.'}
        </p>
      ) : (
        <ol className="turns-list" onPointerLeave={() => actions.setTurnHover(null)}>
          {turns.entries.map((entry, index) => (
            <TurnCard
              key={entry.id}
              entry={entry}
              index={index}
              current={entry.id === turns.currentId}
              isGm={isGm}
              full={turns.entries.length >= TURNS_MAX}
            />
          ))}
        </ol>
      )}
      {isGm && <TurnsFooter turns={turns} />}
    </section>
  )
}

function TurnsFooter({ turns }: { turns: Turns }) {
  const actions = useTableActions()
  const [name, setName] = useState('')
  const full = turns.entries.length >= TURNS_MAX
  const empty = turns.entries.length === 0
  const missing = turns.entries.some((e) => e.initiative === null)

  const add = () => {
    const trimmed = name.trim().slice(0, TURN_NAME_MAX)
    if (!trimmed || full) return
    if (actions.submit({ kind: 'turnAdd', entry: { id: nanoid(), name: trimmed } })) setName('')
  }

  const end = async () => {
    const answer = await askChoice({
      title: 'Encerrar combate',
      message: 'Voltar à preparação. Manter os participantes zera as iniciativas; limpar tira todos da lista.',
      confirmLabel: 'Encerrar e manter participantes',
      alternativeLabel: 'Encerrar e limpar',
      alternativeDanger: true,
    })
    if (answer === 'confirm') actions.submit({ kind: 'turnsEnd', keep: true })
    if (answer === 'alternative') actions.submit({ kind: 'turnsEnd', keep: false })
  }

  const addForm = (
    <form
      className="turns-add"
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
    >
      <input
        aria-label="Nome do participante"
        placeholder="Nome"
        maxLength={TURN_NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" disabled={full || name.trim() === ''} title={full ? 'A ordem de turnos está cheia' : undefined}>
        Adicionar
      </button>
    </form>
  )

  if (turns.phase === 'prep') {
    return (
      <footer className="turns-footer">
        {addForm}
        <div className="turns-buttons">
          <button type="button" disabled={!missing} onClick={() => actions.submit({ kind: 'turnsRoll', all: false })}>
            Rolar iniciativa
          </button>
          <button type="button" disabled={empty} onClick={() => actions.submit({ kind: 'turnsRoll', all: true })}>
            Rolar de novo para todos
          </button>
          <button type="button" className="primary" disabled={empty} onClick={() => actions.submit({ kind: 'turnsStart' })}>
            Iniciar combate
          </button>
        </div>
      </footer>
    )
  }

  return (
    <footer className="turns-footer">
      <div className="turns-buttons">
        <button type="button" onClick={() => actions.submit({ kind: 'turnPrev' })}>
          Turno anterior
        </button>
        <button type="button" className="primary" onClick={() => actions.submit({ kind: 'turnNext' })}>
          Próximo turno
        </button>
      </div>
      {addForm}
      <div className="turns-buttons">
        <button type="button" className="danger" onClick={() => void end()}>
          Encerrar
        </button>
      </div>
    </footer>
  )
}
