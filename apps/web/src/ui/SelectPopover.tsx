import { useRef } from 'react'
import { Lasso, SquareDashed } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'
import type { HoverMenuBinding } from './useHoverMenu'

export function SelectPopover({ onClose, hover }: { onClose: () => void; hover?: HoverMenuBinding }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, hover?.anchor)
  const shape = useTable((s) => s.selectShape)
  const allLayers = useTable((s) => s.selectAllLayers)
  const actions = useTableActions()

  return (
    <div ref={ref} className="panel popover select-popover" role="dialog" aria-label="Opções da seleção">
      <div className="field">
        <span>Forma da seleção</span>
        <div className="row">
          <button aria-pressed={shape === 'rect'} onClick={() => actions.setSelectShape('rect')}>
            <SquareDashed size={16} aria-hidden /> Retângulo
          </button>
          <button aria-pressed={shape === 'lasso'} onClick={() => actions.setSelectShape('lasso')}>
            <Lasso size={16} aria-hidden /> Laço
          </button>
        </div>
      </div>
      <label>
        <input type="checkbox" checked={allLayers} onChange={(e) => actions.setSelectAllLayers(e.target.checked)} /> Todas as camadas
      </label>
      <small>Arraste no vazio para selecionar; Shift soma outra área.</small>
    </div>
  )
}
