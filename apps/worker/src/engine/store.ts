import type { Layer, Role, TableObject } from '@mesa/shared'

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
}
