import { useRef } from 'react'
import { Eraser, Pencil } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { ColorPicker } from './ColorPicker'
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
  const eraseAllLayers = useTable((s) => s.eraseAllLayers)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()

  return (
    <div
      ref={ref}
      className="panel popover pen-popover"
      role="dialog"
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
        <ColorPicker label="Cor do traço" value={color} presets={PEN_COLORS} onChange={actions.setColor} />
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

      {penMode === 'erase' && (
        <div className="field">
          <span>Alcance</span>
          <label>
            <input type="checkbox" checked={eraseAllLayers} onChange={(e) => actions.setEraseAllLayers(e.target.checked)} /> Todas as camadas
          </label>
        </div>
      )}

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
