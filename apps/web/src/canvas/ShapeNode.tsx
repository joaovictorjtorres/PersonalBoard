import type { Context } from 'konva/lib/Context'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Shape as KonvaShape } from 'konva/lib/Shape'
import { Line, Rect, Shape } from 'react-konva'
import { canControl, type ShapeObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { useGroupOffset } from './hooks'
import { commitNodeChange, geometryFromNode } from './nodeChange'
import { isPingClick, usePingDragGuard } from './ping'
import { hexToRgba } from './shapes'

function drawEllipse(ctx: Context, shape: KonvaShape): void {
  const w = shape.width()
  const h = shape.height()
  ctx.beginPath()
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStrokeShape(shape)
}

/** Retângulo e elipse redimensionam/giram pelo Transformer; a linha só se move. */
export function ShapeNode({ object, preview = false }: { object: ShapeObject; preview?: boolean }) {
  const store = useTableStore()
  const actions = useTableActions()
  const pingGuard = usePingDragGuard()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const dragPreview = useTable((s) => s.dragPreviews[object.id])
  const mayControl = useTable((s) => !!s.self && canControl(object, s.self.clientId, s.self.role))
  const layerEditable = useTable(() => actions.canEditLayer(object.layerId))
  const g = lockedByOther && dragPreview ? dragPreview : object
  // Na seleção em área, o item se move com o grupo (não sozinho) e não é selecionado pelo clique.
  const grouped = useTable((s) => !!s.selection && (s.selection.whole.includes(object.id) || object.id in s.selection.parts))
  const groupOffset = useGroupOffset(object.id)
  const interactive = !preview && tool === 'select' && !lockedByOther && mayControl && layerEditable && !grouped

  const common = {
    id: preview ? undefined : object.id,
    name: preview ? undefined : 'object shape',
    x: g.x + (groupOffset?.x ?? 0),
    y: g.y + (groupOffset?.y ?? 0),
    stroke: object.stroke,
    strokeWidth: object.strokeWidth,
    hitStrokeWidth: Math.max(object.strokeWidth, 12),
    listening: !preview,
    draggable: interactive,
    onMouseDown: (e: KonvaEventObject<MouseEvent>) => {
      pingGuard.mouseDown(e.evt)
      if (interactive && !isPingClick(e.evt)) actions.select(object.id)
    },
    onDragStart: (e: KonvaEventObject<DragEvent>) => {
      if (pingGuard.dragStart(() => e.target.stopDrag())) return
      actions.grab(object.id)
    },
    onDragEnd: (e: KonvaEventObject<DragEvent>) => {
      if (!pingGuard.dragEnd()) commitNodeChange(store, object.id, e.target, 'drag')
    },
  }

  if (object.kind === 'line') {
    return (
      <Line
        {...common}
        points={object.points ?? [0, 0, object.width, object.height]}
        lineCap="round"
        onDragMove={(e) =>
          actions.dragPreview(object.id, { x: e.target.x(), y: e.target.y(), width: object.width, height: object.height, rotation: 0 })
        }
      />
    )
  }

  const sized = {
    ...common,
    width: g.width,
    height: g.height,
    rotation: g.rotation,
    fill: object.fill ? hexToRgba(object.fill.color, object.fill.opacity) : undefined,
    onDragMove: (e: KonvaEventObject<DragEvent>) => actions.dragPreview(object.id, geometryFromNode(e.target)),
    onTransformStart: () => actions.grab(object.id),
    onTransform: (e: KonvaEventObject<Event>) => actions.dragPreview(object.id, geometryFromNode(e.target)),
    onTransformEnd: (e: KonvaEventObject<Event>) => commitNodeChange(store, object.id, e.target, 'transform'),
  }
  return object.kind === 'rect' ? <Rect {...sized} /> : <Shape {...sized} sceneFunc={drawEllipse} />
}
