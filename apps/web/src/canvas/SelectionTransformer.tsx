import { useEffect, useRef } from 'react'
import type Konva from 'konva'
import { Transformer } from 'react-konva'
import { canControl } from '@mesa/shared'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const ALL_ANCHORS = [...CORNERS, 'top-center', 'bottom-center', 'middle-left', 'middle-right']

export function SelectionTransformer() {
  const ref = useRef<Konva.Transformer>(null)
  const object = useTable((s) => (s.selectedId ? s.objects[s.selectedId] : undefined))
  const tool = useTable((s) => s.tool)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const lockedByOther = useTable((s) => (s.selectedId ? isLockedByOther(s, s.selectedId, Date.now()) : false))
  const mayControl = useTable((s) => {
    const o = s.selectedId ? s.objects[s.selectedId] : undefined
    return !!o && !!s.self && canControl(o, s.self.clientId, s.self.role)
  })

  // Imagens, retângulos e elipses redimensionam/giram; traços e linhas apenas se movem.
  const resizable = !!object && (object.type === 'image' || (object.type === 'shape' && object.kind !== 'line'))
  const targetId =
    object && resizable && object.layerId === activeLayerId && tool === 'select' && !lockedByOther && mayControl ? object.id : null
  const isImage = object?.type === 'image'

  useEffect(() => {
    const tr = ref.current
    if (!tr) return
    const node = targetId ? tr.getStage()?.findOne(`#${targetId}`) : undefined
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [targetId, object])

  return (
    <Transformer
      ref={ref}
      keepRatio={isImage}
      shiftBehavior="inverted"
      enabledAnchors={isImage ? CORNERS : ALL_ANCHORS}
      flipEnabled={false}
      boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10 ? oldBox : newBox)}
    />
  )
}
