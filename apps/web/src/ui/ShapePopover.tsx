import { useRef } from 'react'
import { Circle, Minus, Square } from 'lucide-react'
import type { ShapeKind } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'
import type { HoverMenuBinding } from './useHoverMenu'

const KINDS: Array<{ kind: ShapeKind; label: string; Icon: typeof Square }> = [
  { kind: 'rect', label: 'Retângulo', Icon: Square },
  { kind: 'ellipse', label: 'Elipse', Icon: Circle },
  { kind: 'line', label: 'Linha', Icon: Minus },
]

export function ShapePopover({ onClose, hover }: { onClose: () => void; hover?: HoverMenuBinding }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, hover?.anchor)
  const kind = useTable((s) => s.shapeKind)
  const fill = useTable((s) => s.shapeFill)
  const strokeColor = useTable((s) => s.color)
  const actions = useTableActions()
  const fillDisabled = kind === 'line'
  const percent = Math.round(fill.opacity * 100)

  return (
    <div
      ref={ref}
      className="panel popover pen-popover"
      role="dialog"
      onPointerEnter={hover?.onPointerEnter}
      onPointerLeave={hover?.onPointerLeave}
      aria-label="Opções das formas"
    >
      <div className="field">
        <span>Tipo</span>
        <div className="row">
          {KINDS.map(({ kind: k, label, Icon }) => (
            <button key={k} aria-pressed={kind === k} onClick={() => actions.setShapeKind(k)}>
              <Icon size={16} aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Preenchimento</span>
        <label>
          <input
            type="checkbox"
            checked={fill.enabled && !fillDisabled}
            disabled={fillDisabled}
            onChange={(e) => actions.setShapeFill({ enabled: e.target.checked })}
          />
          Preencher
        </label>
        <div className="row">
          <input
            type="color"
            aria-label="Cor do preenchimento"
            value={fill.color ?? strokeColor}
            disabled={fillDisabled || !fill.enabled}
            onChange={(e) => actions.setShapeFill({ color: e.target.value })}
          />
          <input
            type="range"
            aria-label="Opacidade do preenchimento"
            min={0}
            max={100}
            value={percent}
            disabled={fillDisabled || !fill.enabled}
            onChange={(e) => actions.setShapeFill({ opacity: Number(e.target.value) / 100 })}
          />
          <span>{percent}%</span>
        </div>
      </div>
      <small>Contorno e espessura vêm da caneta.</small>
    </div>
  )
}
