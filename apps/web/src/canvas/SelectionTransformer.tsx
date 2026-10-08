import { useEffect, useRef } from 'react'
import type Konva from 'konva'
import { Transformer } from 'react-konva'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'

export function SelectionTransformer() {
  const ref = useRef<Konva.Transformer>(null)
  const object = useTable((s) => (s.selectedId ? s.objects[s.selectedId] : undefined))
  const tool = useTable((s) => s.tool)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const lockedByOther = useTable((s) => (s.selectedId ? isLockedByOther(s, s.selectedId, Date.now()) : false))

  // Só imagens redimensionam/giram; traços apenas se movem.
  const targetId =
    object && object.type === 'image' && object.layerId === activeLayerId && tool === 'select' && !lockedByOther
      ? object.id
      : null

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
      keepRatio
      shiftBehavior="inverted"
      enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
      flipEnabled={false}
      boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10 ? oldBox : newBox)}
    />
  )
}
