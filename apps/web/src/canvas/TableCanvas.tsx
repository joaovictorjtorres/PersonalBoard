import { Fragment, useEffect, useMemo, useRef } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Layer, Line, Stage } from 'react-konva'
import { CAMERA_GLIDE_MS, type TableObject } from '@mesa/shared'
import { pointInBox } from '../selection/model'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { centerOn, glideStep } from './camera'
import { GridLayer } from './GridLayer'
import { useModifierKeys, useWindowSize } from './hooks'
import { ImageNode } from './ImageNode'
import { ObjectDecorations } from './ObjectDecorations'
import { Overlay } from './Overlay'
import { isPingClick } from './ping'
import { isHover, pointerAction } from './pointer'
import { SelectionLayer } from './SelectionLayer'
import { SelectionTransformer } from './SelectionTransformer'
import { ShapeNode } from './ShapeNode'
import { StrokeNode } from './StrokeNode'
import { TurnHighlights } from './TurnHighlights'
import { useDrawingTools } from './useDrawingTools'
import { GRAB_PAD_PX, useSelectTool } from './useSelectTool'
import { useShapeTool } from './useShapeTool'

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
  const shapes = useShapeTool()
  const select = useSelectTool()
  const store = useTableStore()
  const stageRef = useRef<Konva.Stage>(null)
  const activePointer = useRef<number | null>(null)
  // Último aperto da caneta foi o botão lateral (vale como botão direito).
  const penBarrel = useRef(false)
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
  // Medindo com a régua, o botão direito é a dobra: nenhum menu abre.
  const onContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    // Caneta parada encostada (Windows Ink) vira "botão direito": só o botão lateral da caneta abre menu.
    if (e.evt.pointerType === 'pen' && !penBarrel.current) return
    if (panning || (tool === 'ruler' && store.getState().ownRuler)) return
    // Botão direito na caixa da seleção: menu do grupo.
    const sel = store.getState().selection
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (tool === 'select' && sel && pos && pointInBox(pos, sel.bounds, GRAB_PAD_PX / viewport.scale)) {
      actions.openSelectionMenu(e.evt.clientX, e.evt.clientY)
      return
    }
    const node = e.target.findAncestor('.object', true)
    if (node) actions.openObjectMenu(node.id(), e.evt.clientX, e.evt.clientY)
  }

  // Soltar, cancelar (o sistema tomou o ponteiro) ou perder a captura: o gesto termina com o que já foi feito.
  const endGesture = (pointerId: number) => {
    if (activePointer.current !== pointerId) return
    activePointer.current = null
    select.onUp()
    drawing.onUp()
    shapes.onUp()
  }
  const endGestureRef = useRef(endGesture)
  endGestureRef.current = endGesture

  useEffect(() => {
    const content = stageRef.current?.content
    if (!content) return
    const onLost = (e: PointerEvent) => endGestureRef.current(e.pointerId)
    content.addEventListener('lostpointercapture', onLost)
    return () => content.removeEventListener('lostpointercapture', onLost)
  }, [])

  const cursor = panning
    ? 'grab'
    : tool === 'pencil'
      ? penMode === 'erase'
        ? 'cell'
        : 'crosshair'
      : tool === 'ruler' || tool === 'shape'
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
      // Sem gestos do navegador (rolar, selecionar texto) sobre o canvas: a caneta desenha em vez de arrastar a página.
      style={{ position: 'absolute', inset: 0, cursor, touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none' }}
      onWheel={onWheel}
      onDragMove={onStageDrag}
      onDragEnd={onStageDrag}
      onContextMenu={onContextMenu}
      onPointerDown={(e) => {
        const evt = e.evt
        // Um ponteiro por gesto: outro dedo ou caneta no meio do traço é ignorado.
        if (activePointer.current !== null && activePointer.current !== evt.pointerId) return
        const action = pointerAction(evt)
        if (evt.pointerType === 'pen') penBarrel.current = action === 'secondary'
        if (!action) return
        activePointer.current = evt.pointerId
        // Captura: a caneta rápida, ou saindo e voltando ao canvas, não interrompe o traço.
        try {
          stageRef.current?.content.setPointerCapture(evt.pointerId)
        } catch {
          // ponteiro já solto: o gesto acaba no pointerup
        }
        const pos = e.target.getStage()?.getRelativePointerPosition()
        const primary = action === 'primary'
        // Com o Selecionar, Shift é da seleção (Shift + arrastar soma área); o ping do Shift + clique sai ao soltar.
        const selectShift = tool === 'select' && !panning && evt.shiftKey && !evt.ctrlKey && !evt.metaKey
        // Shift/Ctrl + clique: ping em qualquer ferramenta (inclusive Mão e Espaço), sem selecionar, desenhar nem medir.
        if (pos && primary && isPingClick(evt) && !selectShift) {
          actions.ping(pos, evt.ctrlKey || evt.metaKey)
          return
        }
        // Ponta de trás da caneta: apaga como a Borracha, seja qual for a ferramenta escolhida.
        if (action === 'eraser') {
          drawing.onDown(e, true)
          return
        }
        if (panning) return
        if (tool === 'ruler') {
          if (pos && primary) actions.rulerClick(pos)
          if (pos && action === 'secondary') actions.rulerBend(pos)
          return
        }
        if (!primary) return
        if (select.onDown(e)) return
        // Shift + clique que a seleção em área não pega (ex.: alças do Transformer): ping na hora, como nas outras ferramentas.
        if (selectShift && pos) {
          actions.ping(pos, false)
          return
        }
        drawing.onDown(e)
        shapes.onDown(e)
      }}
      onPointerMove={(e) => {
        const evt = e.evt
        if (activePointer.current !== null && activePointer.current !== evt.pointerId) return
        const pos = e.target.getStage()?.getRelativePointerPosition()
        if (pos) {
          actions.cursor(pos.x, pos.y)
          actions.rulerMove(pos)
        }
        if (activePointer.current === null) return
        // Nada mais apertado (o pointerup se perdeu): o gesto acaba; pairar nunca desenha.
        if (isHover(evt)) {
          endGesture(evt.pointerId)
          return
        }
        if (!panning) {
          select.onMove(e)
          drawing.onMove(e)
          shapes.onMove(e)
        }
      }}
      onPointerUp={(e) => endGesture(e.evt.pointerId)}
      onPointerCancel={(e) => endGesture(e.evt.pointerId)}
      onPointerLeave={(e) => endGesture(e.evt.pointerId)}
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
                ) : (
                  <ShapeNode key={o.id} object={o} />
                ),
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
              {shapes.preview?.layerId === layer.id && <ShapeNode object={shapes.preview.object} preview />}
              {active && <SelectionTransformer />}
            </Layer>
            {layer.id === 'map' && <GridLayer />}
          </Fragment>
        )
      })}
      <TurnHighlights />
      <SelectionLayer area={select.area} />
      <Overlay />
    </Stage>
  )
}
