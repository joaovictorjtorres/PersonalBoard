import { z } from 'zod'

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
const points = z
  .array(z.number())
  .min(2)
  .max(20000)
  .refine((p) => p.length % 2 === 0, 'points must be x,y pairs')
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const strokeWidth = z.number().min(1).max(100)

const objectBase = {
  id: IdSchema,
  layerId: IdSchema,
  x: coord,
  y: coord,
  width: size,
  height: size,
  rotation: coord,
  zIndex: coord,
}

const serverFields = {
  ownerId: z.string(),
  version: z.number().int().nonnegative(),
  updatedBy: z.string(),
}

const imageFields = {
  type: z.literal('image'),
  assetKey: z.string().regex(/^[a-f0-9]{64}$/),
}

const strokeFields = {
  type: z.literal('stroke'),
  points,
  color,
  strokeWidth,
}

export const NewObjectSchema = z.discriminatedUnion('type', [
  z.object({ ...objectBase, ...imageFields }),
  z.object({ ...objectBase, ...strokeFields }),
])
export type NewObject = z.infer<typeof NewObjectSchema>

export const TableObjectSchema = z.discriminatedUnion('type', [
  z.object({ ...objectBase, ...serverFields, ...imageFields }),
  z.object({ ...objectBase, ...serverFields, ...strokeFields }),
])
export type TableObject = z.infer<typeof TableObjectSchema>
export type ImageObject = Extract<TableObject, { type: 'image' }>
export type StrokeObject = Extract<TableObject, { type: 'stroke' }>

export const ObjectPatchSchema = z
  .strictObject({
    layerId: IdSchema,
    x: coord,
    y: coord,
    width: size,
    height: size,
    rotation: coord,
    zIndex: coord,
    points,
    color,
    strokeWidth,
  })
  .partial()
export type ObjectPatch = z.infer<typeof ObjectPatchSchema>
