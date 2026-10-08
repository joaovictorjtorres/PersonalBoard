import { Image as KonvaImage } from 'react-konva'
import useImage from 'use-image'
import { canControl, type ImageObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { commitNodeChange, geometryFromNode } from './nodeChange'
import { isPingClick } from './ping'

export function ImageNode({ object }: { object: ImageObject }) {
  const [image] = useImage(`/files/${object.assetKey}`)
  const store = useTableStore()
  const actions = useTableActions()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const mayControl = useTable((s) => !!s.self && canControl(object, s.self.clientId, s.self.role))
  const g = lockedByOther && preview ? preview : object
  const layerEditable = useTable(() => actions.canEditLayer(object.layerId))
  const interactive = tool === 'select' && !lockedByOther && mayControl && layerEditable

  return (
    <KonvaImage
      id={object.id}
      name="object image"
      image={image}
      x={g.x}
      y={g.y}
      width={g.width}
      height={g.height}
      rotation={g.rotation}
      draggable={interactive}
      onMouseDown={(e) => {
        if (interactive && !isPingClick(e.evt)) actions.select(object.id)
      }}
      onDragStart={() => actions.grab(object.id)}
      onDragMove={(e) => actions.dragPreview(object.id, geometryFromNode(e.target))}
      onDragEnd={(e) => commitNodeChange(store, object.id, e.target, 'drag')}
      onTransformStart={() => actions.grab(object.id)}
      onTransform={(e) => actions.dragPreview(object.id, geometryFromNode(e.target))}
      onTransformEnd={(e) => commitNodeChange(store, object.id, e.target, 'transform')}
    />
  )
}
