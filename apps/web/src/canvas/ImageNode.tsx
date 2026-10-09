import { Image as KonvaImage } from 'react-konva'
import useImage from 'use-image'
import { canControl, type ImageObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { isInSelection } from '../selection/model'
import { useGroupOffset } from './hooks'
import { commitNodeChange, geometryFromNode } from './nodeChange'
import { isPingClick, usePingDragGuard } from './ping'

export function ImageNode({ object }: { object: ImageObject }) {
  const [image] = useImage(`/files/${object.assetKey}`)
  const store = useTableStore()
  const actions = useTableActions()
  const pingGuard = usePingDragGuard()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const mayControl = useTable((s) => !!s.self && canControl(object, s.self.clientId, s.self.role))
  const g = lockedByOther && preview ? preview : object
  const layerEditable = useTable(() => actions.canEditLayer(object.layerId))
  // Na seleção em área, o item se move com o grupo (não sozinho) e não é selecionado pelo clique.
  const grouped = useTable((s) => isInSelection(s.selection, object.id))
  const groupOffset = useGroupOffset(object.id)
  const interactive = tool === 'select' && !lockedByOther && mayControl && layerEditable && !grouped

  return (
    <KonvaImage
      id={object.id}
      name="object image"
      image={image}
      x={g.x + (groupOffset?.x ?? 0)}
      y={g.y + (groupOffset?.y ?? 0)}
      width={g.width}
      height={g.height}
      rotation={g.rotation}
      draggable={interactive}
      onMouseDown={(e) => {
        pingGuard.mouseDown(e.evt)
        if (interactive && !isPingClick(e.evt)) actions.select(object.id)
      }}
      onDragStart={(e) => {
        if (pingGuard.dragStart(() => e.target.stopDrag())) return
        actions.grab(object.id)
      }}
      onDragMove={(e) => actions.dragPreview(object.id, geometryFromNode(e.target))}
      onDragEnd={(e) => {
        if (!pingGuard.dragEnd()) commitNodeChange(store, object.id, e.target, 'drag')
      }}
      onTransformStart={() => actions.grab(object.id)}
      onTransform={(e) => actions.dragPreview(object.id, geometryFromNode(e.target))}
      onTransformEnd={(e) => commitNodeChange(store, object.id, e.target, 'transform')}
    />
  )
}
