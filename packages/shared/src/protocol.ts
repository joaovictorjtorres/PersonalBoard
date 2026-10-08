import { z } from 'zod'
import { LAYER_NAME_MAX, NOTE_MAX } from './constants'
import {
  IdSchema,
  NewObjectSchema,
  ObjectPatchSchema,
  type Layer,
  type Member,
  type TableMetaPublic,
  type TableObject,
} from './model'

export const LayerNameSchema = z.string().trim().min(1).max(LAYER_NAME_MAX)

export const LayerPatchSchema = z
  .strictObject({
    name: LayerNameSchema,
    visibility: z.enum(['all', 'gm']),
    locked: z.boolean(),
  })
  .partial()
export type LayerPatch = z.infer<typeof LayerPatchSchema>

export const OpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), object: NewObjectSchema }),
  z.object({ kind: z.literal('update'), id: IdSchema, patch: ObjectPatchSchema }),
  z.object({ kind: z.literal('delete'), id: IdSchema }),
  z.object({ kind: z.literal('layerCreate'), layer: z.object({ id: IdSchema, name: LayerNameSchema }) }),
  z.object({ kind: z.literal('layerUpdate'), id: IdSchema, patch: LayerPatchSchema }),
  z.object({ kind: z.literal('layerDelete'), id: IdSchema }),
  z.object({ kind: z.literal('layerMove'), id: IdSchema, direction: z.enum(['up', 'down']) }),
  z.object({ kind: z.literal('noteSet'), objectId: IdSchema, text: z.string().max(NOTE_MAX) }),
  z.object({ kind: z.literal('memberRemove'), clientId: z.string().min(1).max(64) }),
])
export type Op = z.infer<typeof OpSchema>
export type ObjectOp = Extract<Op, { kind: 'create' | 'update' | 'delete' }>

export function isObjectOp(op: Op): op is ObjectOp {
  return op.kind === 'create' || op.kind === 'update' || op.kind === 'delete'
}

export const PresenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cursor'), x: z.number(), y: z.number() }),
  z.object({
    kind: z.literal('drag'),
    objectId: IdSchema,
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    rotation: z.number(),
  }),
  z.object({
    kind: z.literal('stroke'),
    strokeId: IdSchema,
    layerId: IdSchema,
    points: z.array(z.number()).max(4000).refine((p) => p.length % 2 === 0),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    strokeWidth: z.number().min(1).max(100),
  }),
  z.object({ kind: z.literal('strokeEnd'), strokeId: IdSchema }),
])
export type Presence = z.infer<typeof PresenceSchema>

const HelloSchema = z.object({
  t: z.literal('hello'),
  clientId: z.uuid(),
  nickname: z.string().trim().min(1).max(32),
  gmSecret: z.string().max(128).optional(),
  clientSecret: z.string().max(128).optional(),
})
export type HelloMessage = z.infer<typeof HelloSchema>

export const ClientMessageSchema = z.discriminatedUnion('t', [
  HelloSchema,
  z.object({ t: z.literal('op'), opId: z.string().min(1).max(64), op: OpSchema }),
  z.object({ t: z.literal('grab'), objectId: IdSchema }),
  z.object({ t: z.literal('release'), objectId: IdSchema }),
  z.object({ t: z.literal('presence'), p: PresenceSchema }),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

/** `opId` de uma mensagem `{ t: 'op' }` que falhou no schema, para responder `reject invalid`. */
export function readOpId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const { t, opId } = json as { t?: unknown; opId?: unknown }
  return t === 'op' && typeof opId === 'string' && opId.length >= 1 && opId.length <= 64 ? opId : null
}

export type AppliedOp = { kind: 'upsert'; object: TableObject } | { kind: 'delete'; id: string }

export type RejectReason = 'invalid' | 'not_found' | 'exists' | 'locked' | 'forbidden'

export interface LockInfo {
  objectId: string
  clientId: string
}

export interface Snapshot {
  meta: TableMetaPublic
  members: Member[]
  layers: Layer[]
  objects: TableObject[]
  locks: LockInfo[]
  /** Só o mestre recebe anotações; jogadores recebem `{}`. */
  notes: Record<string, string>
}

export type ServerMessage =
  | { t: 'welcome'; self: Member; snapshot: Snapshot; clientSecret?: string }
  | { t: 'ack'; opId: string; version: number }
  | { t: 'reject'; opId: string; reason: RejectReason; current?: TableObject | null }
  | { t: 'op'; op: AppliedOp; by: string }
  | { t: 'grabbed'; objectId: string; clientId: string }
  | { t: 'grabDenied'; objectId: string }
  | { t: 'released'; objectId: string; clientId: string }
  | { t: 'presence'; clientId: string; p: Presence }
  | { t: 'memberJoined'; member: Member }
  | { t: 'memberLeft'; clientId: string }
  | { t: 'layerUpsert'; layer: Layer }
  | { t: 'layerShown'; layer: Layer; objects: TableObject[] }
  | { t: 'layerHidden'; id: string }
  | { t: 'layerRemoved'; id: string }
  | { t: 'noteSet'; objectId: string; text: string }
  | { t: 'memberRemoved'; clientId: string }
  | { t: 'error'; reason: 'table_not_found' | 'auth' }
