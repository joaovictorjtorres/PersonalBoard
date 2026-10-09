import { Fragment } from 'react'
import { Group, Layer, Line, Rect } from 'react-konva'
import { useTable } from '../store/context'
import type { SelectionArea } from '../selection/model'
import { rotatedBounds } from './bounds'

const HIGHLIGHT = '#4dabf7'
const AREA_FILL = 'rgba(77, 171, 247, 0.08)'

/** Realce das partes de dentro, caixa tracejada do grupo (segue o arrasto) e a área sendo desenhada. */
export function SelectionLayer({ area }: { area: SelectionArea | null }) {
  const selection = useTable((s) => s.selection)
  const offset = useTable((s) => s.selectionOffset)
  const objects = useTable((s) => s.objects)
  const scale = useTable((s) => s.viewport.scale)
  const k = 1 / scale

  return (
    <Layer listening={false}>
      {selection && (
        <Group x={offset?.x ?? 0} y={offset?.y ?? 0}>
          {Object.entries(selection.parts).map(([id, part]) => {
            const o = objects[id]
            if (!o || o.type !== 'stroke') return null
            return part.inside.map((points, i) => (
              <Fragment key={`${id}_${i}`}>
                <Line points={points} stroke={HIGHLIGHT} strokeWidth={o.strokeWidth + 6 * k} opacity={0.45} lineCap="round" lineJoin="round" />
                <Line points={points} stroke={o.color} strokeWidth={o.strokeWidth} lineCap="round" lineJoin="round" />
              </Fragment>
            ))
          })}
          {selection.whole.map((id) => {
            const o = objects[id]
            if (!o) return null
            const b = rotatedBounds(o)
            return (
              <Rect
                key={id}
                x={b.minX}
                y={b.minY}
                width={b.maxX - b.minX}
                height={b.maxY - b.minY}
                stroke={HIGHLIGHT}
                strokeWidth={1.5 * k}
                opacity={0.8}
              />
            )
          })}
          <Rect
            name="selection-box"
            x={selection.bounds.x}
            y={selection.bounds.y}
            width={selection.bounds.width}
            height={selection.bounds.height}
            stroke={HIGHLIGHT}
            strokeWidth={1.5 * k}
            dash={[6 * k, 4 * k]}
          />
        </Group>
      )}
      {area?.kind === 'rect' && (
        <Rect name="selection-area" {...area.rect} stroke={HIGHLIGHT} strokeWidth={1.5 * k} dash={[6 * k, 4 * k]} fill={AREA_FILL} />
      )}
      {area?.kind === 'lasso' && (
        <Line
          name="selection-area"
          points={area.points}
          closed
          stroke={HIGHLIGHT}
          strokeWidth={1.5 * k}
          dash={[6 * k, 4 * k]}
          fill={AREA_FILL}
        />
      )}
    </Layer>
  )
}
