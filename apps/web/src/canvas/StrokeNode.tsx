import { Group, Line } from 'react-konva'
import { canControl, type StrokeObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { isInSelection } from '../selection/model'
import { useGroupOffset } from './hooks'
import { commitNodeChange } from './nodeChange'
import { isPingClick, usePingDragGuard } from './ping'
import { pointerAction } from './pointer'

export function StrokeNode({ object, segments }: { object: StrokeObject; segments?: number[][] }) {
  const store = useTableStore()
  const actions = useTableActions()
  const pingGuard = usePingDragGuard()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const mayControl = useTable((s) => !!s.self && canControl(object, s.self.clientId, s.self.role))
  const pos = lockedByOther && preview ? preview : object
  const layerEditable = useTable(() => actions.canEditLayer(object.layerId))
  // Na seleção em área, o item se move com o grupo (não sozinho) e não é selecionado pelo clique.
  const grouped = useTable((s) => isInSelection(s.selection, object.id))
  const groupOffset = useGroupOffset(object.id)
  const interactive = tool === 'select' && !lockedByOther && mayControl && layerEditable && !grouped
  const draggedPart = useTable((s) => (s.selectionOffset ? s.selection?.parts[object.id] : undefined))

  // Prévia local da borracha sobrepõe o traço original; [] = apagado por inteiro.
  // No arrasto do grupo, o traço cortado mostra só os pedaços de fora (os de dentro andam na SelectionLayer).
  const shown =
    segments ??
    (draggedPart ? draggedPart.outside.map((seg) => seg.map((v, i) => v - (i % 2 === 0 ? object.x : object.y))) : object.segments)
  if (shown.length === 0) return null

  // Um Group com uma Line por pedaço: clique e arrasto valem para o traço inteiro.
  return (
    <Group
      id={object.id}
      name="object stroke"
      x={pos.x + (groupOffset?.x ?? 0)}
      y={pos.y + (groupOffset?.y ?? 0)}
      draggable={interactive}
      onPointerDown={(e) => {
        pingGuard.pointerDown(e.evt)
        if (interactive && !isPingClick(e.evt) && pointerAction(e.evt) !== 'eraser') actions.select(object.id)
      }}
      onDragStart={(e) => {
        if (pingGuard.dragStart(() => e.target.stopDrag())) return
        actions.grab(object.id)
      }}
      onDragMove={(e) =>
        actions.dragPreview(object.id, { x: e.target.x(), y: e.target.y(), width: object.width, height: object.height, rotation: 0 })
      }
      onDragEnd={(e) => {
        if (!pingGuard.dragEnd()) commitNodeChange(store, object.id, e.target, 'drag')
      }}
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
