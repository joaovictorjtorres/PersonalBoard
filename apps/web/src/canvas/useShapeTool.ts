import { useRef, useState } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { nanoid } from 'nanoid'
import type { Point, ShapeKind, ShapeObject } from '@mesa/shared'
import { useTableStore } from '../store/context'
import { newShapeObject, shapeFromDrag, type ShapeGeometry } from './shapes'

/** Arrasto menor que isso (px de tela) não cria forma. */
const MIN_EXTENT_PX = 3

interface Drag {
  layerId: string
  kind: ShapeKind
  start: Point
  geometry: ShapeGeometry
}

export function useShapeTool() {
  const store = useTableStore()
  const [preview, setPreview] = useState<{ layerId: string; object: ShapeObject } | null>(null)
  const drag = useRef<Drag | null>(null)

  const build = (d: Drag, id: string, zIndex: number) => {
    const s = store.getState()
    return newShapeObject({
      id, layerId: d.layerId, zIndex, kind: d.kind, geometry: d.geometry, stroke: s.color, strokeWidth: s.strokeWidth, fill: s.shapeFill,
    })
  }

  const showPreview = (d: Drag) => {
    const draft = { ...build(d, 'shape-preview', 0), ownerId: '', version: 0, updatedBy: '', control: { mode: 'all', clientIds: [] } }
    setPreview({ layerId: d.layerId, object: draft as unknown as ShapeObject })
  }

  const onDown = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool !== 'shape') return
    if (s.status !== 'open' || !s.actions.canEditLayer(s.activeLayerId)) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    drag.current = { layerId: s.activeLayerId, kind: s.shapeKind, start: pos, geometry: shapeFromDrag(s.shapeKind, pos, pos, false) }
    showPreview(drag.current)
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
    const d = drag.current
    if (!d) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    // Shift lido a cada movimento: apertar depois de começar o arrasto força quadrado/círculo/45°.
    d.geometry = shapeFromDrag(d.kind, d.start, pos, e.evt.shiftKey)
    showPreview(d)
  }

  const onUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setPreview(null)
    const s = store.getState()
    const w = d.geometry.width * s.viewport.scale
    const h = d.geometry.height * s.viewport.scale
    if (d.kind === 'line' ? Math.max(w, h) < MIN_EXTENT_PX : Math.min(w, h) < MIN_EXTENT_PX) return
    s.actions.submit({ kind: 'create', object: build(d, nanoid(), s.actions.nextZ(d.layerId)) })
  }

  return { preview, onDown, onMove, onUp }
}
