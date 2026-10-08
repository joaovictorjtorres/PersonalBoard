import { z } from 'zod'
import {
  IdSchema,
  NewObjectSchema,
  ObjectPatchSchema,
  type Layer,
  type Member,
  type TableMetaPublic,
  type TableObject,
} from './model'

export const OpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), object: NewObjectSchema }),
  z.object({ kind: z.literal('update'), id: IdSchema, patch: ObjectPatchSchema }),
  z.object({ kind: z.literal('delete'), id: IdSchema }),
])
export type Op = z.infer<typeof OpSchema>

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
}

export type ServerMessage =
  | { t: 'welcome'; self: Member; snapshot: Snapshot }
  | { t: 'ack'; opId: string; version: number }
  | { t: 'reject'; opId: string; reason: RejectReason; current: TableObject | null }
  | { t: 'op'; op: AppliedOp; by: string }
  | { t: 'grabbed'; objectId: string; clientId: string }
  | { t: 'grabDenied'; objectId: string }
  | { t: 'released'; objectId: string; clientId: string }
  | { t: 'presence'; clientId: string; p: Presence }
  | { t: 'memberJoined'; member: Member }
  | { t: 'memberLeft'; clientId: string }
  | { t: 'error'; reason: 'table_not_found' }
