import { z } from 'zod'
import { ASSET_KEY_RE, BATCH_MAX, LAYER_NAME_MAX, NOTE_MAX, RULER_MAX_POINTS } from './constants'
import {
  ChatChannelSchema,
  ChatImageSideSchema,
  ChatTextSchema,
  type ChatChannel,
  type ChatEntry,
  type ChatRejectReason,
} from './chat'
import { RollRequestSchema } from './dice'
import {
  ColorSchema,
  IdSchema,
  NewObjectSchema,
  ObjectPatchSchema,
  type Layer,
  type Member,
  type TableMetaPublic,
  type TableObject,
} from './model'
import { SettingsPatchSchema, type TableSettings } from './settings'
import {
  TURN_OP_KINDS,
  TurnAddOpSchema,
  TurnDuplicateOpSchema,
  TurnMoveOpSchema,
  TurnNextOpSchema,
  TurnPrevOpSchema,
  TurnRemoveOpSchema,
  TurnUpdateOpSchema,
  TurnsEndOpSchema,
  TurnsOpenOpSchema,
  TurnsRollOpSchema,
  TurnsStartOpSchema,
  type TurnOp,
  type Turns,
} from './turns'

export const LayerNameSchema = z.string().trim().min(1).max(LAYER_NAME_MAX)

export const LayerPatchSchema = z
  .strictObject({
    name: LayerNameSchema,
    visibility: z.enum(['all', 'gm']),
    locked: z.boolean(),
  })
  .partial()
export type LayerPatch = z.infer<typeof LayerPatchSchema>

export const NicknameSchema = z.string().trim().min(1).max(32)

export const MemberPatchSchema = z
  .strictObject({ nickname: NicknameSchema, color: ColorSchema })
  .partial()
  .refine((p) => p.nickname !== undefined || p.color !== undefined, 'empty member patch')
export type MemberPatch = z.infer<typeof MemberPatchSchema>

/**
 * Apagar em lote. `layerId: null` = todas as camadas; `authorId` = só os objetos dessa pessoa;
 * `scope: 'all'` (inclui imagens) só numa camada específica e sem autor.
 */
export const ClearObjectsOpSchema = z
  .object({
    kind: z.literal('clearObjects'),
    layerId: IdSchema.nullable(),
    authorId: z.string().min(1).max(64).optional(),
    scope: z.enum(['drawings', 'all']),
  })
  .refine((op) => op.scope === 'drawings' || (op.layerId !== null && op.authorId === undefined), 'clear all needs one layer')
export type ClearObjectsOp = z.infer<typeof ClearObjectsOpSchema>

const CreateOpSchema = z.object({
  kind: z.literal('create'),
  object: NewObjectSchema,
  /**
   * Só dentro de um lote: o traço novo é um pedaço do traço `from`, que o mesmo lote apaga.
   * O pedaço herda o dono e o controle do original.
   */
  from: IdSchema.optional(),
})
const UpdateOpSchema = z.object({ kind: z.literal('update'), id: IdSchema, patch: ObjectPatchSchema })
const DeleteOpSchema = z.object({ kind: z.literal('delete'), id: IdSchema })

export const ObjectOpSchema = z.discriminatedUnion('kind', [CreateOpSchema, UpdateOpSchema, DeleteOpSchema])
export type ObjectOp = z.infer<typeof ObjectOpSchema>

/** Cada id aparece uma vez só no lote: criar, mexer ou apagar o mesmo id duas vezes é contraditório. */
export function batchTargetsUnique(ops: ObjectOp[]): boolean {
  const seen = new Set<string>()
  for (const op of ops) {
    const id = op.kind === 'create' ? op.object.id : op.id
    if (seen.has(id)) return false
    seen.add(id)
  }
  return true
}

/** Lote atômico de ações de objeto: o servidor aplica tudo ou nada. */
export const BatchOpSchema = z
  .object({ kind: z.literal('batch'), ops: z.array(ObjectOpSchema).min(1).max(BATCH_MAX) })
  .refine((op) => batchTargetsUnique(op.ops), 'batch touches the same id twice')
export type BatchOp = z.infer<typeof BatchOpSchema>

export const OpSchema = z.discriminatedUnion('kind', [
  CreateOpSchema,
  UpdateOpSchema,
  DeleteOpSchema,
  z.object({ kind: z.literal('layerCreate'), layer: z.object({ id: IdSchema, name: LayerNameSchema }) }),
  z.object({ kind: z.literal('layerUpdate'), id: IdSchema, patch: LayerPatchSchema }),
  z.object({ kind: z.literal('layerDelete'), id: IdSchema }),
  z.object({ kind: z.literal('layerMove'), id: IdSchema, direction: z.enum(['up', 'down']) }),
  z.object({ kind: z.literal('noteSet'), objectId: IdSchema, text: z.string().max(NOTE_MAX) }),
  /** Excluir jogador (só o mestre, nunca sobre um mestre): apaga ou mantém (órfãos, só do mestre) os itens dele. */
  z.object({ kind: z.literal('memberRemove'), clientId: z.string().min(1).max(64), deleteItems: z.boolean() }),
  z.object({ kind: z.literal('settingsUpdate'), patch: SettingsPatchSchema }),
  z.object({ kind: z.literal('memberUpdate'), clientId: z.string().min(1).max(64), patch: MemberPatchSchema }),
  ClearObjectsOpSchema,
  // Turnos (só o mestre): ver turns.ts
  TurnsOpenOpSchema,
  TurnAddOpSchema,
  TurnDuplicateOpSchema,
  TurnUpdateOpSchema,
  TurnRemoveOpSchema,
  TurnMoveOpSchema,
  TurnsRollOpSchema,
  TurnsStartOpSchema,
  TurnNextOpSchema,
  TurnPrevOpSchema,
  TurnsEndOpSchema,
  BatchOpSchema,
])
export type Op = z.infer<typeof OpSchema>

export function isObjectOp(op: Op): op is ObjectOp {
  return op.kind === 'create' || op.kind === 'update' || op.kind === 'delete'
}

export function isTurnOp(op: Op): op is TurnOp {
  return TURN_OP_KINDS.has(op.kind)
}

const PointSchema = z.object({ x: z.number(), y: z.number() })

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
  /** Início, dobras e ponta (o cursor); a distância é a soma dos trechos. */
  z.object({ kind: z.literal('ruler'), points: z.array(PointSchema).min(2).max(RULER_MAX_POINTS) }),
  z.object({ kind: z.literal('rulerEnd') }),
  /** Contorno da seleção arrastada (caixa já deslocada) e as camadas dos itens, para o filtro de quem vê. */
  z.object({
    kind: z.literal('groupDrag'),
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    layerIds: z.array(IdSchema).min(1).max(64),
  }),
  z.object({ kind: z.literal('groupDragEnd') }),
  z.object({ kind: z.literal('ping'), x: z.number(), y: z.number(), recenter: z.boolean() }),
])
export type Presence = z.infer<typeof PresenceSchema>

const HelloSchema = z.object({
  t: z.literal('hello'),
  clientId: z.uuid(),
  nickname: NicknameSchema,
  gmSecret: z.string().max(128).optional(),
  clientSecret: z.string().max(128).optional(),
  /** Chave do link de jogador (`#j=`); quem tem o segredo de mestre não precisa. */
  playerKey: z.string().max(128).optional(),
  /** Versão do protocolo do cliente; 2 = guarda clientSecret (M2). */
  v: z.number().int().optional(),
})
export type HelloMessage = z.infer<typeof HelloSchema>

const ReqIdSchema = z.string().min(1).max(64)

export const ClientMessageSchema = z.discriminatedUnion('t', [
  HelloSchema,
  z.object({ t: z.literal('op'), opId: z.string().min(1).max(64), op: OpSchema }),
  z.object({ t: z.literal('grab'), objectId: IdSchema }),
  z.object({ t: z.literal('release'), objectId: IdSchema }),
  z.object({ t: z.literal('presence'), p: PresenceSchema }),
  z.object({ t: z.literal('chatSend'), reqId: ReqIdSchema, channel: ChatChannelSchema, text: ChatTextSchema }),
  z.object({
    t: z.literal('chatImage'),
    reqId: ReqIdSchema,
    channel: ChatChannelSchema,
    assetKey: z.string().regex(ASSET_KEY_RE),
    width: ChatImageSideSchema,
    height: ChatImageSideSchema,
  }),
  z
    .object({ t: z.literal('roll'), reqId: ReqIdSchema, channel: ChatChannelSchema, request: RollRequestSchema, secret: z.boolean() })
    .refine((m) => !m.secret || m.channel === 'table', 'secret roll only on the table channel'),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type ChatMessage = Extract<ClientMessage, { t: 'chatSend' | 'chatImage' | 'roll' }>

/** `opId` de uma mensagem `{ t: 'op' }` que falhou no schema, para responder `reject invalid`. */
export function readOpId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const { t, opId } = json as { t?: unknown; opId?: unknown }
  return t === 'op' && typeof opId === 'string' && opId.length >= 1 && opId.length <= 64 ? opId : null
}

const CHAT_MESSAGE_TYPES: ReadonlySet<unknown> = new Set(['chatSend', 'chatImage', 'roll'])

/** `reqId` de uma mensagem de chat que falhou no schema, para responder `chatReject invalid`. */
export function readChatReqId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const { t, reqId } = json as { t?: unknown; reqId?: unknown }
  return CHAT_MESSAGE_TYPES.has(t) && typeof reqId === 'string' && reqId.length >= 1 && reqId.length <= 64 ? reqId : null
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
  settings: TableSettings
  /** Só o canal da mesa, já filtrado para quem recebe (rolagem secreta: autor e mestres). */
  chat: ChatEntry[]
  /** Ordem de turnos, igual para todos. O servidor sempre envia; ausente = padrão (fixtures antigas). */
  turns?: Turns
}

/** Motivos de `error` (o servidor fecha a conexão logo depois). */
export type ServerErrorReason = 'table_not_found' | 'auth' | 'table_deleted' | 'nickname_taken' | 'removed' | 'link_expired'

export type ServerMessage =
  | { t: 'welcome'; self: Member; snapshot: Snapshot; clientSecret?: string }
  | { t: 'ack'; opId: string; version: number }
  | { t: 'reject'; opId: string; reason: RejectReason; current?: TableObject | null }
  | { t: 'op'; op: AppliedOp; by: string }
  /** Lote aplicado (batch), já filtrado pelo que quem recebe enxerga, num envio só. */
  | { t: 'batch'; ops: AppliedOp[]; by: string }
  /** Apagados em lote (clearObjects), já filtrados pelo que quem recebe enxerga; o autor também recebe. */
  | { t: 'objectsRemoved'; ids: string[]; by: string }
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
  | { t: 'settingsUpdated'; settings: TableSettings }
  | { t: 'memberUpdated'; member: Member }
  /** Estado completo dos turnos depois de cada ação; vai a todos, inclusive ao autor. */
  | { t: 'turnsUpdated'; turns: Turns }
  /** Na conversa privada, `channel.dm` é sempre a OUTRA pessoa do ponto de vista de quem recebe. */
  | { t: 'chat'; channel: ChatChannel; entry: ChatEntry }
  | { t: 'chatAck'; reqId: string }
  | { t: 'chatReject'; reqId: string; reason: ChatRejectReason }
  | { t: 'error'; reason: ServerErrorReason }
  /** O mestre renomeou a mesa na página local. */
  | { t: 'tableRenamed'; name: string }
