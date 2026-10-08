import { APPLIED_OPS_KEEP, type Layer, type TableObject } from '@mesa/shared'
import { normalizeObject } from './migrate'
import type { StoredMember, TableMeta, TableStore } from './store'

export class SqlStore implements TableStore {
  constructor(private sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, name TEXT NOT NULL, gm_secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS layers (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS members (client_id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, layer_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS applied_ops (seq INTEGER PRIMARY KEY, client_id TEXT NOT NULL, op_id TEXT NOT NULL, version INTEGER NOT NULL, UNIQUE(client_id, op_id))')
  }

  getMeta(): TableMeta | null {
    const row = this.sql
      .exec<{ id: string; name: string; gm_secret_hash: string; created_at: number }>('SELECT * FROM meta LIMIT 1')
      .toArray()[0]
    return row ? { id: row.id, name: row.name, gmSecretHash: row.gm_secret_hash, createdAt: row.created_at } : null
  }

  initTable(meta: TableMeta, layers: Layer[]): void {
    this.sql.exec('INSERT INTO meta (id, name, gm_secret_hash, created_at) VALUES (?, ?, ?, ?)', meta.id, meta.name, meta.gmSecretHash, meta.createdAt)
    for (const layer of layers) this.sql.exec('INSERT INTO layers (id, data) VALUES (?, ?)', layer.id, JSON.stringify(layer))
  }

  getLayers(): Layer[] {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM layers')
      .toArray()
      .map((r) => JSON.parse(r.data) as Layer)
      .sort((a, b) => a.order - b.order)
  }

  getMember(clientId: string): StoredMember | null {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM members WHERE client_id = ?', clientId).toArray()[0]
    return row ? (JSON.parse(row.data) as StoredMember) : null
  }

  upsertMember(member: StoredMember): void {
    this.sql.exec('INSERT OR REPLACE INTO members (client_id, data) VALUES (?, ?)', member.clientId, JSON.stringify(member))
  }

  listMembers(): StoredMember[] {
    return this.sql.exec<{ data: string }>('SELECT data FROM members').toArray().map((r) => JSON.parse(r.data) as StoredMember)
  }

  getObject(id: string): TableObject | null {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM objects WHERE id = ?', id).toArray()[0]
    return row ? normalizeObject(JSON.parse(row.data)) : null
  }

  listObjects(): TableObject[] {
    return this.sql.exec<{ data: string }>('SELECT data FROM objects').toArray().map((r) => normalizeObject(JSON.parse(r.data)))
  }

  putObject(object: TableObject): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO objects (id, layer_id, type, data, version) VALUES (?, ?, ?, ?, ?)',
      object.id, object.layerId, object.type, JSON.stringify(object), object.version,
    )
  }

  deleteObject(id: string): void {
    this.sql.exec('DELETE FROM objects WHERE id = ?', id)
  }

  getAppliedOp(clientId: string, opId: string): number | null {
    const row = this.sql
      .exec<{ version: number }>('SELECT version FROM applied_ops WHERE client_id = ? AND op_id = ?', clientId, opId)
      .toArray()[0]
    return row ? row.version : null
  }

  recordAppliedOp(clientId: string, opId: string, version: number): void {
    this.sql.exec('INSERT OR IGNORE INTO applied_ops (client_id, op_id, version) VALUES (?, ?, ?)', clientId, opId, version)
    this.sql.exec(
      'DELETE FROM applied_ops WHERE client_id = ? AND seq <= (SELECT seq FROM applied_ops WHERE client_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)',
      clientId, clientId, APPLIED_OPS_KEEP,
    )
  }
}
