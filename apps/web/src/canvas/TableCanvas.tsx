import { Fragment, useEffect, useMemo, useRef } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Layer, Line, Stage } from 'react-konva'
import { CAMERA_GLIDE_MS, type TableObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { centerOn, glideStep } from './camera'
import { GridLayer } from './GridLayer'
import { useModifierKeys, useWindowSize } from './hooks'
import { ImageNode } from './ImageNode'
import { ObjectDecorations } from './ObjectDecorations'
import { Overlay } from './Overlay'
import { isPingClick } from './ping'
import { SelectionTransformer } from './SelectionTransformer'
import { StrokeNode } from './StrokeNode'
import { useDrawingTools } from './useDrawingTools'

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const debug = new URLSearchParams(window.location.search).has('debug')

/** Desliza a câmera (≈400 ms) até centralizar o ponto pedido pelo mestre, mantendo o zoom. */
function useCameraGlide(): void {
  const store = useTableStore()
  const target = useTable((s) => s.cameraTarget)
  useEffect(() => {
    if (!target) return
    const from = store.getState().viewport
    const to = centerOn(from, target, window.innerWidth, window.innerHeight)
    const start = performance.now()
    let frame = requestAnimationFrame(function step(time) {
      const t = Math.min(1, (time - start) / CAMERA_GLIDE_MS)
      store.getState().actions.setViewport(glideStep(from, to, t))
      if (t < 1) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [store, target])
}

export function TableCanvas() {
  const layers = useTable((s) => s.layers)
  const objects = useTable((s) => s.objects)
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const viewport = useTable((s) => s.viewport)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const { space } = useModifierKeys()
  const size = useWindowSize()
  const drawing = useDrawingTools()
  const stageRef = useRef<Konva.Stage>(null)
  const panning = tool === 'hand' || space
  // A grade fica logo acima da camada "map"; sem ela (removida pelo mestre), abaixo de tudo.
  const hasMapLayer = layers.some((l) => l.id === 'map')
  useCameraGlide()

  useEffect(() => {
    if (debug) (window as unknown as { __stage?: Konva.Stage | null }).__stage = stageRef.current
  }, [])

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

  // O menu do navegador fica desativado sobre o canvas; sobre um objeto, abre o nosso.
  const onContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    if (panning) return
    const node = e.target.findAncestor('.object', true)
    if (node) actions.openObjectMenu(node.id(), e.evt.clientX, e.evt.clientY)
  }

  const cursor = panning
    ? 'grab'
    : tool === 'pencil'
      ? penMode === 'erase'
        ? 'cell'
        : 'crosshair'
      : tool === 'ruler'
        ? 'crosshair'
        : 'default'

  return (
    <Stage
      ref={stageRef}
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
      onContextMenu={onContextMenu}
      onMouseDown={(e) => {
        const pos = e.target.getStage()?.getRelativePointerPosition()
        // Shift/Ctrl + clique: ping em qualquer ferramenta (inclusive Mão e Espaço), sem selecionar, desenhar nem medir.
        if (pos && e.evt.button === 0 && isPingClick(e.evt)) {
          actions.ping(pos, e.evt.ctrlKey || e.evt.metaKey)
          return
        }
        if (panning) return
        if (tool === 'ruler') {
          if (pos && e.evt.button === 0) actions.rulerClick(pos)
          return
        }
        if (tool === 'select' && e.target === e.target.getStage()) actions.select(null)
        drawing.onDown(e)
      }}
      onMouseMove={(e) => {
        const pos = e.target.getStage()?.getRelativePointerPosition()
        if (pos) {
          actions.cursor(pos.x, pos.y)
          actions.rulerMove(pos)
        }
        if (!panning) drawing.onMove(e)
      }}
      onMouseUp={drawing.onUp}
      onMouseLeave={drawing.onUp}
    >
      {!hasMapLayer && <GridLayer />}
      {layers.map((layer) => {
        const active = layer.id === activeLayerId
        const list = byLayer[layer.id] ?? []
        return (
          <Fragment key={layer.id}>
            <Layer listening={active && !panning} opacity={isGm && layer.visibility === 'gm' ? 0.5 : 1}>
              {list.map((o) =>
                o.type === 'image' ? (
                  <ImageNode key={o.id} object={o} />
                ) : o.type === 'stroke' ? (
                  <StrokeNode key={o.id} object={o} segments={drawing.erasePreview[o.id]} />
                ) : null,
              )}
              {list.map((o) => (
                <ObjectDecorations key={`deco_${o.id}`} object={o} />
              ))}
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
            {layer.id === 'map' && <GridLayer />}
          </Fragment>
        )
      })}
      <Overlay />
    </Stage>
  )
}
