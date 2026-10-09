import {
  APPLIED_OPS_KEEP,
  CHAT_HISTORY_LIMIT,
  parseSettings,
  parseTurns,
  type ChatEntry,
  type Layer,
  type TableObject,
  type TableSettings,
  type Turns,
} from '@mesa/shared'
import { normalizeObject } from './migrate'
import type { StoredMember, TableMeta, TableStore } from './store'

export class SqlStore implements TableStore {
  constructor(private sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, name TEXT NOT NULL, gm_secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS layers (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS members (client_id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, layer_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS applied_ops (seq INTEGER PRIMARY KEY, client_id TEXT NOT NULL, op_id TEXT NOT NULL, version INTEGER NOT NULL, UNIQUE(client_id, op_id))')
    sql.exec('CREATE TABLE IF NOT EXISTS gm_notes (object_id TEXT PRIMARY KEY, text TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS chat (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS turns (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS player_key (id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL)')
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

  renameTable(name: string): void {
    this.sql.exec('UPDATE meta SET name = ?', name)
  }

  getPlayerKeyHash(): string | null {
    return this.sql.exec<{ hash: string }>('SELECT hash FROM player_key WHERE id = 1').toArray()[0]?.hash ?? null
  }

  setPlayerKeyHash(hash: string): void {
    this.sql.exec('INSERT OR REPLACE INTO player_key (id, hash) VALUES (1, ?)', hash)
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

  putLayer(layer: Layer): void {
    this.sql.exec('INSERT OR REPLACE INTO layers (id, data) VALUES (?, ?)', layer.id, JSON.stringify(layer))
  }

  deleteLayer(id: string): void {
    this.sql.exec('DELETE FROM layers WHERE id = ?', id)
  }

  deleteMember(clientId: string): void {
    this.sql.exec('DELETE FROM members WHERE client_id = ?', clientId)
  }

  listNotes(): Record<string, string> {
    const rows = this.sql.exec<{ object_id: string; text: string }>('SELECT object_id, text FROM gm_notes').toArray()
    return Object.fromEntries(rows.map((r) => [r.object_id, r.text]))
  }

  setNote(objectId: string, text: string): void {
    if (text === '') this.deleteNote(objectId)
    else this.sql.exec('INSERT OR REPLACE INTO gm_notes (object_id, text) VALUES (?, ?)', objectId, text)
  }

  deleteNote(objectId: string): void {
    this.sql.exec('DELETE FROM gm_notes WHERE object_id = ?', objectId)
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

  getSettings(): TableSettings {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM settings WHERE id = 1').toArray()[0]
    return parseSettings(row ? JSON.parse(row.data) : null)
  }

  putSettings(settings: TableSettings): void {
    this.sql.exec('INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)', JSON.stringify(settings))
  }

  appendChat(entry: ChatEntry): void {
    this.sql.exec('INSERT INTO chat (data) VALUES (?)', JSON.stringify(entry))
    this.sql.exec(
      'DELETE FROM chat WHERE seq <= (SELECT seq FROM chat ORDER BY seq DESC LIMIT 1 OFFSET ?)',
      CHAT_HISTORY_LIMIT,
    )
  }

  listChat(): ChatEntry[] {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM chat ORDER BY seq')
      .toArray()
      .map((r) => JSON.parse(r.data) as ChatEntry)
  }

  getTurns(): Turns {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM turns WHERE id = 1').toArray()[0]
    return parseTurns(row ? JSON.parse(row.data) : null)
  }

  putTurns(turns: Turns): void {
    this.sql.exec('INSERT OR REPLACE INTO turns (id, data) VALUES (1, ?)', JSON.stringify(turns))
  }
}
