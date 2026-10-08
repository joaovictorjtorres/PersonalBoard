import { z } from 'zod'
import { CHAT_IMAGE_MAX_SIDE, CHAT_TEXT_MAX } from './constants'
import type { RollRequest, RollResult } from './dice'

export const ChatChannelSchema = z.union([z.literal('table'), z.strictObject({ dm: z.string().min(1).max(64) })])
export type ChatChannel = z.infer<typeof ChatChannelSchema>

export const ChatTextSchema = z.string().trim().min(1).max(CHAT_TEXT_MAX)
export const ChatImageSideSchema = z.number().int().min(1).max(CHAT_IMAGE_MAX_SIDE)

interface ChatBase {
  /** Gerado pelo servidor. */
  id: string
  /** Timestamp do servidor (ms). */
  at: number
  authorId: string
}

export type ChatEntry =
  | (ChatBase & { kind: 'message'; text: string })
  | (ChatBase & { kind: 'image'; assetKey: string; width: number; height: number })
  | (ChatBase & { kind: 'roll'; request: RollRequest; result: RollResult; secret: boolean })

export type ChatRejectReason = 'invalid' | 'not_found' | 'rate_limited'
