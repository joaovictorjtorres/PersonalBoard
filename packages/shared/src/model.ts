import { z } from 'zod'
import { MAX_CONTROL_IDS, MAX_SEGMENTS, MAX_SEGMENT_NUMBERS, SHAPE_STROKE_MAX, TITLE_MAX } from './constants'

export const IdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)

export const RoleSchema = z.enum(['gm', 'player'])
export type Role = z.infer<typeof RoleSchema>

export interface Layer {
  id: string
  name: string
  order: number
  visibility: 'all' | 'gm'
  locked: boolean
}

export interface Member {
  clientId: string
  nickname: string
  color: string
  role: Role
  online: boolean
}

export interface TableMetaPublic {
  id: string
  name: string
}

// z.number() no Zod 4 já recusa NaN/Infinity.
const coord = z.number()
const size = z.number().nonnegative()
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const color = ColorSchema
const strokeWidth = z.number().min(1).max(100)

const segment = z
  .array(z.number())
  .min(4)
  .refine((p) => p.length % 2 === 0, 'segment must be x,y pairs')
const segments = z
  .array(segment)
  .min(1)
  .max(MAX_SEGMENTS)
  .refine((list) => list.reduce((n, s) => n + s.length, 0) <= MAX_SEGMENT_NUMBERS, 'too many points')

export const ControlSchema = z.strictObject({
  mode: z.enum(['all', 'gm', 'list']),
  clientIds: z.array(z.string().min(1).max(64)).max(MAX_CONTROL_IDS),
})
export type Control = z.infer<typeof ControlSchema>

export const TitleSchema = z.string().trim().min(1).max(TITLE_MAX)

const objectBase = {
  id: IdSchema,
  layerId: IdSchema,
  x: coord,
  y: coord,
  width: size,
  height: size,
  rotation: coord,
  zIndex: coord,
  title: TitleSchema.optional(),
}

const serverFields = {
  ownerId: z.string(),
  version: z.number().int().nonnegative(),
  updatedBy: z.string(),
  control: ControlSchema,
}

const imageFields = {
  type: z.literal('image'),
  assetKey: z.string().regex(/^[a-f0-9]{64}$/),
}

const strokeFields = {
  type: z.literal('stroke'),
  segments,
  color,
  strokeWidth,
}

const shapeFields = {
  type: z.literal('shape'),
  kind: z.enum(['rect', 'ellipse', 'line']),
  stroke: color,
  strokeWidth: z.number().min(1).max(SHAPE_STROKE_MAX),
  fill: z.strictObject({ color, opacity: z.number().min(0).max(1) }).nullable(),
  /** Só linha: [x1, y1, x2, y2] relativos a (x, y). */
  points: z.tuple([coord, coord, coord, coord]).optional(),
}

// Linha: com points e sem preenchimento. Retângulo/elipse: sem points.
const shapeIsConsistent = (o: { kind: string; fill: unknown; points?: unknown }) =>
  o.kind === 'line' ? o.points !== undefined && o.fill === null : o.points === undefined

// Sem `control`: o servidor define o controle na criação (campo enviado é descartado).
export const NewObjectSchema = z.discriminatedUnion('type', [
  z.object({ ...objectBase, ...imageFields }),
  z.object({ ...objectBase, ...strokeFields }),
  z.object({ ...objectBase, ...shapeFields }).refine(shapeIsConsistent, 'shape fields do not match kind'),
])
export type NewObject = z.infer<typeof NewObjectSchema>

export const TableObjectSchema = z.discriminatedUnion('type', [
  z.object({ ...objectBase, ...serverFields, ...imageFields }),
  z.object({ ...objectBase, ...serverFields, ...strokeFields }),
  z.object({ ...objectBase, ...serverFields, ...shapeFields }).refine(shapeIsConsistent, 'shape fields do not match kind'),
])
export type TableObject = z.infer<typeof TableObjectSchema>
export type ImageObject = Extract<TableObject, { type: 'image' }>
export type StrokeObject = Extract<TableObject, { type: 'stroke' }>
export type ShapeObject = Extract<TableObject, { type: 'shape' }>
export type ShapeKind = ShapeObject['kind']

export const ObjectPatchSchema = z
  .strictObject({
    layerId: IdSchema,
    x: coord,
    y: coord,
    width: size,
    height: size,
    rotation: coord,
    zIndex: coord,
    segments,
    color,
    strokeWidth,
    control: ControlSchema,
    title: TitleSchema.nullable(),
  })
  .partial()
export type ObjectPatch = z.infer<typeof ObjectPatchSchema>

/** Aplica o patch sem validar; `title: null` remove o título. */
export function mergePatch(before: TableObject, patch: ObjectPatch): TableObject {
  const merged: Record<string, unknown> = { ...before, ...patch }
  if (merged.title === null) delete merged.title
  return merged as TableObject
}

/** Autor dos itens de um jogador excluído com "manter as coisas" (nunca é um clientId válido de hello). */
export const ORPHAN_OWNER_ID = 'orphan'

export function canControl(object: Pick<TableObject, 'control'>, clientId: string, role: Role): boolean {
  if (role === 'gm') return true
  const { mode, clientIds } = object.control
  return mode === 'all' || (mode === 'list' && clientIds.includes(clientId))
}
