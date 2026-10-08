import { useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { nanoid } from 'nanoid'
import { MAX_SEGMENT_NUMBERS, boundsOf, simplifyPoints } from '@mesa/shared'
import { throttle } from '../lib/throttle'
import { useTableStore } from '../store/context'

interface OwnPreview {
  layerId: string
  points: number[]
  color: string
  strokeWidth: number
}

export function useDrawingTools() {
  const store = useTableStore()
  const [ownPreview, setOwnPreview] = useState<OwnPreview | null>(null)
  const current = useRef<{ strokeId: string; layerId: string; points: number[]; unsent: number[] } | null>(null)
  const erased = useRef(new Set<string>())

  // Envia só os pontos novos desde o último envio (~30/s); quem recebe concatena.
  const flushPreview = useMemo(
    () =>
      throttle(() => {
        const cur = current.current
        if (!cur || cur.unsent.length === 0) return
        const s = store.getState()
        s.actions.sendPresence({
          kind: 'stroke', strokeId: cur.strokeId, layerId: cur.layerId,
          points: cur.unsent, color: s.color, strokeWidth: s.strokeWidth,
        })
        cur.unsent = []
      }, 33),
    [store],
  )

  const eraseTarget = (target: Konva.Node) => {
    const node = target.findAncestor('.stroke', true)
    if (!node) return
    const id = node.id()
    if (erased.current.has(id)) return
    const s = store.getState()
    const object = s.objects[id]
    if (!object || object.layerId !== s.activeLayerId) return
    erased.current.add(id)
    s.actions.submit({ kind: 'delete', id })
  }

  const onDown = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool === 'eraser') {
      erased.current.clear()
      eraseTarget(e.target)
      return
    }
    if (s.tool !== 'pencil' || e.evt.button !== 0) return
    if (s.status !== 'open' || !s.actions.canEditLayer(s.activeLayerId)) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    current.current = { strokeId: nanoid(), layerId: s.activeLayerId, points: [pos.x, pos.y], unsent: [pos.x, pos.y] }
    setOwnPreview({ layerId: s.activeLayerId, points: [pos.x, pos.y], color: s.color, strokeWidth: s.strokeWidth })
    flushPreview()
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool === 'eraser') {
      if (e.evt.buttons & 1) eraseTarget(e.target)
      return
    }
    const cur = current.current
    if (!cur) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    cur.points.push(pos.x, pos.y)
    cur.unsent.push(pos.x, pos.y)
    setOwnPreview((p) => (p ? { ...p, points: [...cur.points] } : p))
    flushPreview()
  }

  const onUp = () => {
    const cur = current.current
    if (!cur) return
    current.current = null
    flushPreview.flush()
    setOwnPreview(null)
    const s = store.getState()
    s.actions.sendPresence({ kind: 'strokeEnd', strokeId: cur.strokeId })

    let points = simplifyPoints(cur.points, 1 / s.viewport.scale)
    if (points.length < 4) points = [points[0], points[1], points[0] + 0.01, points[1]]
    if (points.length > MAX_SEGMENT_NUMBERS) {
      points = simplifyPoints(points, 4 / s.viewport.scale).slice(0, MAX_SEGMENT_NUMBERS)
    }
    const b = boundsOf(points)
    s.actions.submit({
      kind: 'create',
      object: {
        id: cur.strokeId,
        type: 'stroke',
        layerId: cur.layerId,
        x: b.minX,
        y: b.minY,
        width: b.width,
        height: b.height,
        rotation: 0,
        zIndex: s.actions.nextZ(cur.layerId),
        segments: [points.map((v, i) => (i % 2 === 0 ? v - b.minX : v - b.minY))],
        color: s.color,
        strokeWidth: s.strokeWidth,
      },
    })
  }

  return { ownPreview, onDown, onMove, onUp }
}
