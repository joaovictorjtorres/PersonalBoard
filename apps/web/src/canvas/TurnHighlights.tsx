import { Ellipse, Layer } from 'react-konva'
import type { ImageObject } from '@mesa/shared'
import { useTable } from '../store/context'
import { currentTurnToken, hoveredTurnImage } from '../store/turns'
import { rotatedBounds } from './bounds'
import { useFrameClock, useLiveGeometry } from './hooks'
import { turnRing, turnRingPulse } from './turnRing'

const CURRENT_COLOR = '#ffd43b'
const HOVER_COLOR = '#9db4ff'

/**
 * Anel da vez (pulsante, para todos que têm o token no estado) e destaque do card sob o mouse
 * (tracejado, só na minha tela). Fica acima de todas as camadas e não recebe cliques.
 */
export function TurnHighlights() {
  const current = useTable(currentTurnToken)
  const hovered = useTable(hoveredTurnImage)
  if (!current && !hovered) return null
  return (
    <Layer listening={false}>
      {hovered && hovered.id !== current?.id && <TokenRing object={hovered} pulse={false} />}
      {current && <TokenRing object={current} pulse />}
    </Layer>
  )
}

function TokenRing({ object, pulse }: { object: ImageObject; pulse: boolean }) {
  const scale = useTable((s) => s.viewport.scale)
  const now = useFrameClock(pulse)
  const g = useLiveGeometry(object)
  const ring = turnRing(rotatedBounds(g), scale)
  const { grow, opacity } = pulse ? turnRingPulse(now) : { grow: 0, opacity: 0.9 }
  return (
    <Ellipse
      name={pulse ? 'turn-ring' : 'turn-hover'}
      x={ring.x}
      y={ring.y}
      radiusX={ring.radiusX + grow / scale}
      radiusY={ring.radiusY + grow / scale}
      stroke={pulse ? CURRENT_COLOR : HOVER_COLOR}
      strokeWidth={(pulse ? 4 : 2) / scale}
      dash={pulse ? undefined : [8 / scale, 5 / scale]}
      opacity={opacity}
    />
  )
}
