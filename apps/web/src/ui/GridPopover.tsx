import { useRef } from 'react'
import { GRID_MAX, GRID_MIN } from '@mesa/shared'
import { parseGridSize } from '../canvas/grid'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'

export function GridPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const grid = useTable((s) => s.settings.grid)
  const actions = useTableActions()

  return (
    <div ref={ref} className="panel popover pen-popover" role="dialog" aria-label="Grade">
      <label>
        <input
          type="checkbox"
          checked={grid.enabled}
          onChange={(e) => actions.updateSettings({ grid: { enabled: e.target.checked } })}
        />
        Mostrar grade
      </label>
      <label className="field">
        Tamanho do quadrado (px)
        <input
          key={grid.size}
          type="number"
          min={GRID_MIN}
          max={GRID_MAX}
          step={1}
          defaultValue={grid.size}
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
      </label>
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
