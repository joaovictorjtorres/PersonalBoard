import {
  snapPatch,
  type Control,
  type GridSettings,
  type NewObject,
  type ObjectOp,
  type Role,
  type StrokeObject,
  type TableObject,
} from '@mesa/shared'
import { fitSegmentLimits, rebaseSegments } from '../canvas/eraser'
import type { Selection } from './model'

export interface PlanInput {
  selection: Selection
  objects: Record<string, TableObject>
  selfId: string
  role: Role
  newId: () => string
  /** zIndex do topo da camada (o maior + 1). */
  nextZ: (layerId: string) => number
  grid: GridSettings
}

export interface BatchPlan {
  /** Lotes a enviar, em ordem (hoje, sempre um: a ação inteira). */
  batches: ObjectOp[][]
  /** Ids que continuam selecionados (inteiros) depois da ação; null = mantém a seleção atual. */
  selectAfter: string[] | null
}

interface PieceSpec {
  world: number[][]
  layerId: string
  zIndex: number
  title: boolean
}

const shifted = (segments: number[][], dx: number, dy: number) =>
  segments.map((seg) => seg.map((v, i) => v + (i % 2 === 0 ? dx : dy)))

/** Traço novo com os pedaços (coordenadas do mapa), no formato e nos limites do schema. */
function piece(original: StrokeObject, id: string, spec: PieceSpec): NewObject {
  const r = rebaseSegments(fitSegmentLimits(spec.world, 1), 0, 0)
  return {
    id,
    type: 'stroke',
    layerId: spec.layerId,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    rotation: 0,
    zIndex: spec.zIndex,
    segments: r.segments,
    color: original.color,
    strokeWidth: original.strokeWidth,
    ...(spec.title && original.title ? { title: original.title } : {}),
  }
}

class Builder {
  ops: ObjectOp[] = []
  constructor(private input: PlanInput) {}

  /**
   * Corta o traço: cria os pedaços com `from` (herdam dono e controle do original) e só depois
   * apaga o original, porque o cliente copia dono e controle de objects[from] ao aplicar.
   * Só o mestre muda pedaço de camada. Devolve os ids dos pedaços, na ordem de `specs`.
   */
  cut(original: StrokeObject, specs: PieceSpec[]): string[] {
    const ids = specs.map((spec) => {
      const id = this.input.newId()
      const layerId = this.input.role === 'gm' ? spec.layerId : original.layerId
      this.ops.push({ kind: 'create', object: piece(original, id, { ...spec, layerId }), from: original.id })
      return id
    })
    this.ops.push({ kind: 'delete', id: original.id })
    return ids
  }

  done(selectAfter: string[] | null): BatchPlan {
    return { batches: [this.ops], selectAfter }
  }
}

function strokesCut(input: PlanInput): Array<{ o: StrokeObject; inside: number[][]; outside: number[][] }> {
  const out: Array<{ o: StrokeObject; inside: number[][]; outside: number[][] }> = []
  for (const [id, part] of Object.entries(input.selection.parts)) {
    const o = input.objects[id]
    if (o?.type === 'stroke') out.push({ o, ...part })
  }
  return out
}

function wholeObjects(input: PlanInput): TableObject[] {
  return input.selection.whole.map((id) => input.objects[id]).filter((o): o is TableObject => !!o)
}

/** Pedaço de fora: fica onde estava, com o título do original. */
const outsideSpec = (o: StrokeObject, outside: number[][]): PieceSpec[] =>
  outside.length > 0 ? [{ world: outside, layerId: o.layerId, zIndex: o.zIndex, title: true }] : []

export function planMove(input: PlanInput, dx: number, dy: number): BatchPlan {
  const b = new Builder(input)
  const keep: string[] = []
  for (const o of wholeObjects(input)) {
    let patch = { x: o.x + dx, y: o.y + dy }
    if (o.type === 'image' && input.grid.snap) patch = snapPatch(patch, input.grid.size)
    b.ops.push({ kind: 'update', id: o.id, patch })
    keep.push(o.id)
  }
  for (const { o, inside, outside } of strokesCut(input)) {
    const ids = b.cut(o, [
      ...outsideSpec(o, outside),
      { world: shifted(inside, dx, dy), layerId: o.layerId, zIndex: o.zIndex, title: false },
    ])
    keep.push(ids[ids.length - 1])
  }
  return b.done(keep)
}

export function planDelete(input: PlanInput): BatchPlan {
  const b = new Builder(input)
  for (const o of wholeObjects(input)) b.ops.push({ kind: 'delete', id: o.id })
  for (const { o, outside } of strokesCut(input)) b.cut(o, outsideSpec(o, outside))
  return b.done([])
}

/** Mudar de camada é do mestre; para outra pessoa, traço cortado fica como está (pedaço não muda de camada). */
export function planToLayer(input: PlanInput, layerId: string): BatchPlan {
  const b = new Builder(input)
  let z = input.nextZ(layerId)
  for (const o of wholeObjects(input)) {
    if (o.layerId === layerId) continue
    b.ops.push({ kind: 'update', id: o.id, patch: { layerId, zIndex: z++ } })
  }
  if (input.role === 'gm') {
    for (const { o, inside, outside } of strokesCut(input)) {
      if (o.layerId === layerId) continue
      b.cut(o, [...outsideSpec(o, outside), { world: inside, layerId, zIndex: z++, title: false }])
    }
  }
  return b.done([])
}

/** Controle e permissões: um update por token (imagem inteira); sem corte. */
export function planControl(input: PlanInput, control: Control): BatchPlan {
  const ops: ObjectOp[] = wholeObjects(input)
    .filter((o) => o.type === 'image')
    .map((o) => ({ kind: 'update', id: o.id, patch: { control } }))
  return { batches: [ops], selectAfter: null }
}
