import {
  boundsOf,
  canClearLayer,
  canControl,
  insidePolygon,
  insideRect,
  splitStrokeByPolygon,
  splitStrokeByRect,
  type Box,
  type Layer,
  type Point,
  type Role,
  type StrokeObject,
  type StrokeSplit,
  type TableObject,
} from '@mesa/shared'
import { rotatedBounds } from '../canvas/bounds'

export type SelectShape = 'rect' | 'lasso'

/** Área desenhada com o Selecionar, em coordenadas do mapa; o laço é um polígono plano [x0, y0, ...]. */
export type SelectionArea = { kind: 'rect'; rect: Box } | { kind: 'lasso'; points: number[] }

/** Traço cortado pela área: pedaços de dentro e de fora, em coordenadas do mapa. */
export interface SelectionPart {
  inside: number[][]
  outside: number[][]
}

export interface Selection {
  /** Áreas que formaram a seleção (para somar outra área a um traço já cortado). */
  areas: SelectionArea[]
  /** Itens inteiros: imagens, formas e traços que caíram todos dentro. */
  whole: string[]
  /** Traços cortados, por id. O corte só acontece ao agir. */
  parts: Record<string, SelectionPart>
  /** Caixa de tudo que está selecionado (coordenadas do mapa). */
  bounds: Box
}

export interface SelectContext {
  objects: Record<string, TableObject>
  layers: Layer[]
  activeLayerId: string
  allLayers: boolean
  selfId: string
  role: Role
  /** Travado por outra pessoa (sendo arrastado): fica de fora. */
  isLocked: (id: string) => boolean
}

/** Pedaço menor que isso (unidades do mapa) é poeira do corte. */
const MIN_PIECE = 0.5

export function pointInBox(p: Point, b: Box, pad = 0): boolean {
  return p.x >= b.x - pad && p.x <= b.x + b.width + pad && p.y >= b.y - pad && p.y <= b.y + b.height + pad
}

function usable(area: SelectionArea): boolean {
  return area.kind === 'rect' ? area.rect.width > 0 && area.rect.height > 0 : area.points.length >= 6
}

/** Camadas em que a seleção pega itens: a ativa (ou todas) que a pessoa vê e pode editar. */
export function selectableLayerIds(ctx: SelectContext): Set<string> {
  return new Set(
    ctx.layers.filter((l) => (ctx.allLayers || l.id === ctx.activeLayerId) && canClearLayer(l, ctx.role)).map((l) => l.id),
  )
}

export function worldSegments(o: StrokeObject): number[][] {
  return o.segments.map((seg) => seg.map((v, i) => v + (i % 2 === 0 ? o.x : o.y)))
}

function pathLength(points: number[]): number {
  let total = 0
  for (let i = 2; i < points.length; i += 2) total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1])
  return total
}

function splitByArea(points: number[], area: SelectionArea): StrokeSplit {
  return area.kind === 'rect' ? splitStrokeByRect(points, area.rect) : splitStrokeByPolygon(points, area.points)
}

/**
 * Corta os pedaços (coordenadas do mapa) por todas as áreas: dentro de qualquer uma = dentro.
 * Só poeira de um lado: o traço conta como todo do outro lado (sem corte).
 */
export function splitByAreas(segments: number[][], areas: SelectionArea[]): SelectionPart {
  const inside: number[][] = []
  let outside = segments
  for (const area of areas) {
    const rest: number[][] = []
    for (const seg of outside) {
      const r = splitByArea(seg, area)
      inside.push(...r.inside)
      rest.push(...r.outside)
    }
    outside = rest
  }
  const solid = (list: number[][]) => list.filter((p) => pathLength(p) >= MIN_PIECE)
  if (inside.length === 0) return { inside: [], outside: segments }
  if (outside.length === 0 || solid(outside).length === 0) return { inside: segments, outside: [] }
  const keptIn = solid(inside)
  if (keptIn.length === 0) return { inside: [], outside: segments }
  return { inside: keptIn, outside: solid(outside) }
}

function itemInArea(o: TableObject, area: SelectionArea): boolean {
  const box = { x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation }
  return area.kind === 'rect' ? insideRect(box, area.rect) : insidePolygon(box, area.points)
}

export function selectionBounds(whole: TableObject[], parts: SelectionPart[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
  }
  for (const o of whole) {
    const b = rotatedBounds(o)
    add(b.minX, b.minY, b.maxX, b.maxY)
  }
  for (const p of parts) {
    for (const seg of p.inside) {
      const b = boundsOf(seg)
      add(b.minX, b.minY, b.minX + b.width, b.minY + b.height)
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function build(areas: SelectionArea[], whole: TableObject[], parts: Record<string, SelectionPart>): Selection | null {
  if (whole.length === 0 && Object.keys(parts).length === 0) return null
  return { areas, whole: whole.map((o) => o.id), parts, bounds: selectionBounds(whole, Object.values(parts)) }
}

/** Seleção pelas áreas: só itens que a pessoa pode editar, na camada ativa (ou em todas). */
export function collectSelection(areas: SelectionArea[], ctx: SelectContext): Selection | null {
  const list = areas.filter(usable)
  if (list.length === 0) return null
  const layerIds = selectableLayerIds(ctx)
  const whole: TableObject[] = []
  const parts: Record<string, SelectionPart> = {}
  for (const o of Object.values(ctx.objects)) {
    if (!layerIds.has(o.layerId) || !canControl(o, ctx.selfId, ctx.role) || ctx.isLocked(o.id)) continue
    if (o.type === 'stroke') {
      const split = splitByAreas(worldSegments(o), list)
      if (split.inside.length === 0) continue
      if (split.outside.length === 0) whole.push(o)
      else parts[o.id] = split
    } else if (list.some((a) => itemInArea(o, a))) {
      whole.push(o)
    }
  }
  return build(list, whole, parts)
}

/** Shift + arrastar: soma a área. Traço cortado pelas duas é recortado pelas áreas somadas. */
export function addArea(current: Selection | null, area: SelectionArea, ctx: SelectContext): Selection | null {
  const added = collectSelection([area], ctx)
  if (!current) return added
  if (!added) return current
  const areas = [...current.areas, area]
  const wholeIds = new Set([...current.whole, ...added.whole])
  const parts: Record<string, SelectionPart> = {}
  for (const id of new Set([...Object.keys(current.parts), ...Object.keys(added.parts)])) {
    if (wholeIds.has(id)) continue
    const o = ctx.objects[id]
    if (!o || o.type !== 'stroke') continue
    if (current.parts[id] && added.parts[id]) {
      const split = splitByAreas(worldSegments(o), areas)
      if (split.outside.length === 0) wholeIds.add(id)
      else parts[id] = split
    } else {
      parts[id] = current.parts[id] ?? added.parts[id]
    }
  }
  const whole = [...wholeIds].map((id) => ctx.objects[id]).filter((o): o is TableObject => !!o)
  return build(areas, whole, parts)
}

/** Tira itens (apagados ou mudados por outra pessoa); sem nada, null. */
export function dropFromSelection(sel: Selection, ids: ReadonlySet<string>, objects: Record<string, TableObject>): Selection | null {
  const whole = sel.whole.filter((id) => !ids.has(id) && objects[id])
  const parts = Object.fromEntries(Object.entries(sel.parts).filter(([id]) => !ids.has(id) && objects[id]))
  if (whole.length === 0 && Object.keys(parts).length === 0) return null
  return { ...sel, whole, parts, bounds: selectionBounds(whole.map((id) => objects[id]), Object.values(parts)) }
}

/** Seleção de itens inteiros pelos ids (o que fica selecionado depois de mover). */
export function selectionOfIds(ids: string[], objects: Record<string, TableObject>): Selection | null {
  const whole = ids.map((id) => objects[id]).filter((o): o is TableObject => !!o)
  return build([], whole, {})
}
