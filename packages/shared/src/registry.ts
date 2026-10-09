import { z } from 'zod'

export const TABLE_NAME_MAX = 60

/** Nome de mesa: sem espaços nas pontas, 1 a 60 caracteres. */
export const TableNameSchema = z.string().trim().min(1).max(TABLE_NAME_MAX)

/** Origem https sem caminho (o launcher manda a do Quick Tunnel). */
export const TunnelUrlSchema = z.string().max(200).regex(/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/)

export const TunnelReportSchema = z.strictObject({ url: TunnelUrlSchema.nullable() })

/** O TableDO avisa o índice no máximo uma vez por este intervalo (ou na hora, se o número de jogadores mudar). */
export const ACTIVITY_REPORT_MS = 60_000

export interface RegistryTable {
  id: string
  name: string
  createdAt: number
  lastActivityAt: number
  /** Membros com papel jogador conhecidos pela mesa. */
  players: number
  gmSecret: string
  /** Chave do link de jogador (`#j=`); null em mesas sem chave. */
  playerKey: string | null
}

export interface RegistryView {
  tables: RegistryTable[]
  /** Endereço do túnel informado pelo launcher; null = sem túnel (só local). */
  tunnelUrl: string | null
}
