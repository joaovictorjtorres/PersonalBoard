import { useRef } from 'react'
import { Eraser, Pencil } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'
import type { HoverMenuBinding } from './useHoverMenu'

export const PEN_COLORS = ['#e6194b', '#f58231', '#ffe119', '#3cb44b', '#4363d8', '#911eb4', '#ffffff', '#000000']

export function PenPopover({ onClose, hover }: { onClose: () => void; hover?: HoverMenuBinding }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, hover?.anchor)
  const color = useTable((s) => s.color)
  const strokeWidth = useTable((s) => s.strokeWidth)
  const penMode = useTable((s) => s.penMode)
  const eraseAll = useTable((s) => s.eraseAll)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()

  return (
    <div
      ref={ref}
      className="panel popover pen-popover"
      role="dialog"
      onPointerEnter={hover?.onPointerEnter}
      onPointerLeave={hover?.onPointerLeave}
      aria-label="Opções da caneta"
    >
      <div className="field">
        <span>Espessura</span>
        <div className="row">
          <input
            type="range"
            aria-label="Espessura do traço"
            min={1}
            max={30}
            value={strokeWidth}
            onChange={(e) => actions.setStrokeWidth(Number(e.target.value))}
          />
          <span className="width-preview" style={{ width: strokeWidth, height: strokeWidth, background: color }} />
        </div>
      </div>

      <div className="field">
        <span>Cor</span>
        <div className="row">
          <input type="color" aria-label="Cor do traço" value={color} onChange={(e) => actions.setColor(e.target.value)} />
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              aria-label={`Cor ${c}`}
              aria-pressed={color === c}
              style={{ background: c }}
              onClick={() => actions.setColor(c)}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <span>Modo</span>
        <div className="row">
          <button aria-pressed={penMode === 'draw'} onClick={() => actions.setPen('draw')}>
            <Pencil size={16} aria-hidden /> Desenhar
          </button>
          <button aria-pressed={penMode === 'erase'} onClick={() => actions.setPen('erase')}>
            <Eraser size={16} aria-hidden /> Apagar
          </button>
        </div>
      </div>

      {isGm && penMode === 'erase' && (
        <div className="field" role="radiogroup" aria-label="Apagar">
          <span>Apagar</span>
          <label>
            <input type="radio" name="erase-scope" checked={!eraseAll} onChange={() => actions.setEraseAll(false)} /> Só os meus
          </label>
          <label>
            <input type="radio" name="erase-scope" checked={eraseAll} onChange={() => actions.setEraseAll(true)} /> De todos
          </label>
        </div>
      )}
    </div>
  )
}
