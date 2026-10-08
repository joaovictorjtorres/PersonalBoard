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
}

export interface TableStore {
  getMeta(): TableMeta | null
  initTable(meta: TableMeta, layers: Layer[]): void
  getLayers(): Layer[]
  getMember(clientId: string): StoredMember | null
  upsertMember(member: StoredMember): void
  listMembers(): StoredMember[]
  getObject(id: string): TableObject | null
  listObjects(): TableObject[]
  putObject(object: TableObject): void
  deleteObject(id: string): void
  getAppliedOp(clientId: string, opId: string): number | null
  recordAppliedOp(clientId: string, opId: string, version: number): void
}
