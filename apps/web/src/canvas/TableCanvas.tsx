import { useMemo } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Layer, Line, Stage } from 'react-konva'
import type { TableObject } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { useModifierKeys, useWindowSize } from './hooks'
import { ImageNode } from './ImageNode'
import { Overlay } from './Overlay'
import { SelectionTransformer } from './SelectionTransformer'
import { StrokeNode } from './StrokeNode'
import { useDrawingTools } from './useDrawingTools'

const MIN_SCALE = 0.1
const MAX_SCALE = 8

export function TableCanvas() {
  const layers = useTable((s) => s.layers)
  const objects = useTable((s) => s.objects)
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const viewport = useTable((s) => s.viewport)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const actions = useTableActions()
  const { space } = useModifierKeys()
  const size = useWindowSize()
  const drawing = useDrawingTools()
  const panning = tool === 'hand' || space

  const byLayer = useMemo(() => {
    const groups: Record<string, TableObject[]> = {}
    for (const o of Object.values(objects)) (groups[o.layerId] ??= []).push(o)
    for (const list of Object.values(groups)) list.sort((a, b) => a.zIndex - b.zIndex)
    return groups
  }, [objects])

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor))
    const worldX = (pointer.x - viewport.x) / viewport.scale
    const worldY = (pointer.y - viewport.y) / viewport.scale
    actions.setViewport({ scale, x: pointer.x - worldX * scale, y: pointer.y - worldY * scale })
  }

  // Mantém o viewport da store em sincronia durante o pan; senão um re-render no meio
  // do arrasto devolveria o Stage para a posição antiga.
  const onStageDrag = (e: KonvaEventObject<DragEvent>) => {
    if (e.target === e.target.getStage()) actions.setViewport({ ...viewport, x: e.target.x(), y: e.target.y() })
  }

  const cursor = panning ? 'grab' : tool === 'pencil' ? (penMode === 'erase' ? 'cell' : 'crosshair') : 'default'

  return (
    <Stage
      width={size.width}
      height={size.height}
      x={viewport.x}
      y={viewport.y}
      scaleX={viewport.scale}
      scaleY={viewport.scale}
      draggable={panning}
      style={{ position: 'absolute', inset: 0, cursor }}
      onWheel={onWheel}
      onDragMove={onStageDrag}
      onDragEnd={onStageDrag}
      onMouseDown={(e) => {
        if (panning) return
        if (tool === 'select' && e.target === e.target.getStage()) actions.select(null)
        drawing.onDown(e)
      }}
      onMouseMove={(e) => {
        const pos = e.target.getStage()?.getRelativePointerPosition()
        if (pos) actions.cursor(pos.x, pos.y)
        if (!panning) drawing.onMove(e)
      }}
      onMouseUp={drawing.onUp}
      onMouseLeave={drawing.onUp}
    >
      {layers.map((layer) => {
        const active = layer.id === activeLayerId
        return (
          <Layer key={layer.id} listening={active && !panning}>
            {(byLayer[layer.id] ?? []).map((o) =>
              o.type === 'image' ? <ImageNode key={o.id} object={o} /> : <StrokeNode key={o.id} object={o} />,
            )}
            {drawing.ownPreview?.layerId === layer.id && (
              <Line
                points={drawing.ownPreview.points}
                stroke={drawing.ownPreview.color}
                strokeWidth={drawing.ownPreview.strokeWidth}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
            {active && <SelectionTransformer />}
          </Layer>
        )
      })}
      <Overlay />
    </Stage>
  )
}
