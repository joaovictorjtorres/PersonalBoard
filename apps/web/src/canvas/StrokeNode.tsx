import { Line } from 'react-konva'
import type { StrokeObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { commitNodeChange } from './nodeChange'

export function StrokeNode({ object }: { object: StrokeObject }) {
  const store = useTableStore()
  const actions = useTableActions()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const pos = lockedByOther && preview ? preview : object
  const interactive = tool === 'select' && !lockedByOther

  return (
    <Line
      id={object.id}
      name="object stroke"
      x={pos.x}
      y={pos.y}
      points={object.points}
      stroke={object.color}
      strokeWidth={object.strokeWidth}
      hitStrokeWidth={Math.max(object.strokeWidth, 12)}
      lineCap="round"
      lineJoin="round"
      draggable={interactive}
      onMouseDown={() => {
        if (interactive) actions.select(object.id)
      }}
      onDragStart={() => actions.grab(object.id)}
      onDragMove={(e) =>
        actions.dragPreview(object.id, { x: e.target.x(), y: e.target.y(), width: object.width, height: object.height, rotation: 0 })
      }
      onDragEnd={(e) => commitNodeChange(store, object.id, e.target, 'drag')}
    />
  )
}
