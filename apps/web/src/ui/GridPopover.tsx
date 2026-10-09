import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { GRID_MAX, GRID_MIN } from '@mesa/shared'
import { parseGridSize } from '../canvas/grid'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'
import type { HoverMenuBinding } from './useHoverMenu'

export function GridPopover({ onClose, hover }: { onClose: () => void; hover?: HoverMenuBinding }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, hover?.anchor)
  const grid = useTable((s) => s.settings.grid)
  const actions = useTableActions()
  // Valor ao vivo do controle deslizante; null = segue o valor da store.
  const [drag, setDrag] = useState<number | null>(null)
  const shown = drag ?? grid.size
  const commitSlider = (value: number) => {
    setDrag(null)
    if (value !== grid.size) actions.updateSettings({ grid: { size: value } })
  }

  return (
    <div
      ref={ref}
      className="panel popover pen-popover"
      role="dialog"
      onPointerEnter={hover?.onPointerEnter}
      onPointerLeave={hover?.onPointerLeave}
      aria-label="Grade"
    >
      <label>
        <input
          type="checkbox"
          checked={grid.enabled}
          onChange={(e) => actions.updateSettings({ grid: { enabled: e.target.checked } })}
        />
        Mostrar grade
      </label>
      <div className="field">
        <span>Tamanho do quadrado (px)</span>
        <div className="row stepper">
        <button
          aria-label="Diminuir o quadrado"
          disabled={grid.size <= GRID_MIN}
          onClick={() => actions.updateSettings({ grid: { size: Math.max(GRID_MIN, grid.size - 1) } })}
        >
          <Minus size={14} aria-hidden />
        </button>
        <input
          aria-label="Tamanho do quadrado (px)"
          key={shown}
          type="number"
          min={GRID_MIN}
          max={GRID_MAX}
          step={1}
          defaultValue={shown}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => {
            const size = parseGridSize(e.currentTarget.value)
            if (size === null) {
              e.currentTarget.value = String(grid.size) // inválido não é enviado
              return
            }
            if (size !== grid.size) actions.updateSettings({ grid: { size } })
          }}
        />
        <button
          aria-label="Aumentar o quadrado"
          disabled={grid.size >= GRID_MAX}
          onClick={() => actions.updateSettings({ grid: { size: Math.min(GRID_MAX, grid.size + 1) } })}
        >
          <Plus size={14} aria-hidden />
        </button>
        </div>
      </div>
      <input
        type="range"
        aria-label="Tamanho do quadrado (controle deslizante)"
        min={GRID_MIN}
        max={GRID_MAX}
        step={1}
        value={shown}
        onChange={(e) => setDrag(Number(e.currentTarget.value))}
        onPointerUp={(e) => commitSlider(Number(e.currentTarget.value))}
        onKeyUp={(e) => commitSlider(Number(e.currentTarget.value))}
        onBlur={(e) => commitSlider(Number(e.currentTarget.value))}
      />
      <small>1 quadrado = 1 m</small>
      <label>
        <input
          type="checkbox"
          checked={grid.snap}
          onChange={(e) => actions.updateSettings({ grid: { snap: e.target.checked } })}
        />
        Encaixar imagens na grade
      </label>
    </div>
  )
}
