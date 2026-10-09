import { DurableObject } from 'cloudflare:workers'
import type { RegistryTable } from '@mesa/shared'

/** Um índice só para o servidor todo. */
export const REGISTRY_NAME = 'registry'

export function registryStub(env: Env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName(REGISTRY_NAME))
}

type Row = {
  id: string
  name: string
  created_at: number
  last_activity_at: number
  players: number
  gm_secret: string
  player_key: string | null
}

const toTable = (r: Row): RegistryTable => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  lastActivityAt: r.last_activity_at,
  players: r.players,
  gmSecret: r.gm_secret,
  playerKey: r.player_key,
})

/** Índice das mesas criadas por este servidor (mesas antigas, de antes do índice, não entram). */
export class RegistryDO extends DurableObject<Env> {
  /** Endereço do túnel: só em memória; o launcher reenvia a cada 30 s e quando muda. */
  private tunnelUrl: string | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, ' +
        'last_activity_at INTEGER NOT NULL, players INTEGER NOT NULL DEFAULT 0, gm_secret TEXT NOT NULL, player_key TEXT)',
    )
  }

  register(entry: { id: string; name: string; gmSecret: string; playerKey: string | null }, now = Date.now()): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO tables (id, name, created_at, last_activity_at, players, gm_secret, player_key) VALUES (?, ?, ?, ?, 0, ?, ?)',
      entry.id, entry.name, now, now, entry.gmSecret, entry.playerKey,
    )
  }

  listTables(): RegistryTable[] {
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM tables ORDER BY last_activity_at DESC, rowid DESC').toArray().map(toTable)
  }

  findTable(id: string): RegistryTable | null {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM tables WHERE id = ?', id).toArray()[0]
    return row ? toTable(row) : null
  }

  renameTable(id: string, name: string): boolean {
    return this.ctx.storage.sql.exec('UPDATE tables SET name = ? WHERE id = ? RETURNING id', name, id).toArray().length > 0
  }

  removeTable(id: string): boolean {
    return this.ctx.storage.sql.exec('DELETE FROM tables WHERE id = ? RETURNING id', id).toArray().length > 0
  }

  /** Mesa fora do índice (antiga): não afeta nada. */
  touchTable(id: string, activity: { at: number; players: number }): void {
    this.ctx.storage.sql.exec(
      'UPDATE tables SET last_activity_at = MAX(last_activity_at, ?), players = ? WHERE id = ?',
      activity.at, activity.players, id,
    )
  }

  setTunnel(url: string | null): void {
    this.tunnelUrl = url
  }

  getTunnel(): string | null {
    return this.tunnelUrl
  }
}
