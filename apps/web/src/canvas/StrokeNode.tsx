import { Group, Line } from 'react-konva'
import { canControl, type StrokeObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { commitNodeChange } from './nodeChange'

export function StrokeNode({ object, segments }: { object: StrokeObject; segments?: number[][] }) {
  const store = useTableStore()
  const actions = useTableActions()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const mayControl = useTable((s) => !!s.self && canControl(object, s.self.clientId, s.self.role))
  const pos = lockedByOther && preview ? preview : object
  const interactive = tool === 'select' && !lockedByOther && mayControl

  // Prévia local da borracha sobrepõe o traço original; [] = apagado por inteiro.
  const shown = segments ?? object.segments
  if (shown.length === 0) return null

  // Um Group com uma Line por pedaço: clique e arrasto valem para o traço inteiro.
  return (
    <Group
      id={object.id}
      name="object stroke"
      x={pos.x}
      y={pos.y}
      draggable={interactive}
      onMouseDown={() => {
        if (interactive) actions.select(object.id)
      }}
      onDragStart={() => actions.grab(object.id)}
      onDragMove={(e) =>
        actions.dragPreview(object.id, { x: e.target.x(), y: e.target.y(), width: object.width, height: object.height, rotation: 0 })
      }
      onDragEnd={(e) => commitNodeChange(store, object.id, e.target, 'drag')}
    >
      {shown.map((points, i) => (
        <Line
          key={i}
          points={points}
          stroke={object.color}
          strokeWidth={object.strokeWidth}
          hitStrokeWidth={Math.max(object.strokeWidth, 12)}
          lineCap="round"
          lineJoin="round"
        />
      ))}
    </Group>
  )
}
