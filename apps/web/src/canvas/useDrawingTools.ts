import { useEffect, useMemo, useRef, useState } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { nanoid } from 'nanoid'
import { MAX_SEGMENT_NUMBERS, boundsOf, simplifyPoints } from '@mesa/shared'
import { throttle } from '../lib/throttle'
import { useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { planErase } from './eraser'

interface OwnPreview {
  layerId: string
  points: number[]
  color: string
  strokeWidth: number
}

export function useDrawingTools() {
  const store = useTableStore()
  const [ownPreview, setOwnPreview] = useState<OwnPreview | null>(null)
  const [erasePreview, setErasePreview] = useState<Record<string, number[][]>>({})
  const current = useRef<{ strokeId: string; layerId: string; points: number[]; unsent: number[] } | null>(null)
  const erasing = useRef<{ layerId: string; path: number[] } | null>(null)
  const frame = useRef<number | null>(null)

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

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  // Corte sempre sobre a versão local atual dos traços (vale a última escrita).
  const plan = () => {
    const cur = erasing.current
    const s = store.getState()
    if (!cur || !s.self) return { previews: {}, ops: [] }
    const now = Date.now()
    return planErase({
      objects: Object.values(s.objects),
      layerId: cur.layerId,
      path: cur.path,
      selfId: s.self.clientId,
      role: s.self.role,
      eraseAll: s.eraseAll,
      penWidth: s.strokeWidth,
      scale: s.viewport.scale,
      isLocked: (id) => isLockedByOther(s, id, now),
    })
  }

  // Prévia local no máximo uma vez por quadro.
  const scheduleErasePreview = () => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (erasing.current) setErasePreview(plan().previews)
    })
  }

  const finishErase = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const { ops } = plan()
    erasing.current = null
    setErasePreview({})
    // Lote único: vira um só grupo de desfazer.
    if (ops.length > 0) store.getState().actions.submitGroup(ops)
  }

  const onDown = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool !== 'pencil' || e.evt.button !== 0) return
    if (s.status !== 'open' || !s.actions.canEditLayer(s.activeLayerId)) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    if (s.penMode === 'erase') {
      erasing.current = { layerId: s.activeLayerId, path: [pos.x, pos.y] }
      scheduleErasePreview()
      return
    }
    current.current = { strokeId: nanoid(), layerId: s.activeLayerId, points: [pos.x, pos.y], unsent: [pos.x, pos.y] }
    setOwnPreview({ layerId: s.activeLayerId, points: [pos.x, pos.y], color: s.color, strokeWidth: s.strokeWidth })
    flushPreview()
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    const er = erasing.current
    if (er) {
      er.path.push(pos.x, pos.y)
      scheduleErasePreview()
      return
    }
    const cur = current.current
    if (!cur) return
    cur.points.push(pos.x, pos.y)
    cur.unsent.push(pos.x, pos.y)
    setOwnPreview((p) => (p ? { ...p, points: [...cur.points] } : p))
    flushPreview()
  }

  const onUp = () => {
    if (erasing.current) {
      finishErase()
      return
    }
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

  return { ownPreview, erasePreview, onDown, onMove, onUp }
}
