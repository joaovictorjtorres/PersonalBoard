import type { ChatEntry, Layer, Role, TableObject, TableSettings, Turns } from '@mesa/shared'

export interface TableMeta {
  id: string
  name: string
  gmSecretHash: string
  createdAt: number
}

export interface StoredMember {
  clientId: string
  nickname: string
  color: string
  role: Role
  lastSeenAt: number
  /** SHA-256 hex do clientSecret; ausente em membros gravados pelo M1. */
  secretHash?: string
  /** M3: o mestre definiu o apelido; o `hello` não o sobrescreve. */
  nicknameSetByGm?: boolean
  /** M3: o mestre definiu a cor; o `hello` não a reatribui. */
  colorSetByGm?: boolean
}

export interface TableStore {
  getMeta(): TableMeta | null
  initTable(meta: TableMeta, layers: Layer[]): void
  getLayers(): Layer[]
  putLayer(layer: Layer): void
  deleteLayer(id: string): void
  getMember(clientId: string): StoredMember | null
  upsertMember(member: StoredMember): void
  deleteMember(clientId: string): void
  listMembers(): StoredMember[]
  getObject(id: string): TableObject | null
  listObjects(): TableObject[]
  putObject(object: TableObject): void
  deleteObject(id: string): void
  listNotes(): Record<string, string>
  /** Texto vazio apaga a anotação. */
  setNote(objectId: string, text: string): void
  deleteNote(objectId: string): void
  getAppliedOp(clientId: string, opId: string): number | null
  recordAppliedOp(clientId: string, opId: string, version: number): void
  /** Padrão quando nunca foi gravado; sempre devolve uma cópia. */
  getSettings(): TableSettings
  putSettings(settings: TableSettings): void
  /** Guarda a entrada e apaga as mais antigas além de CHAT_HISTORY_LIMIT. */
  appendChat(entry: ChatEntry): void
  /** Da mais antiga para a mais nova. */
  listChat(): ChatEntry[]
  /** Padrão (DEFAULT_TURNS) quando nunca foi gravado; sempre devolve uma cópia. */
  getTurns(): Turns
  putTurns(turns: Turns): void
}
