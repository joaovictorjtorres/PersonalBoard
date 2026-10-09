import { TABLE_ID_RE, TABLE_NAME_MAX } from '@mesa/shared'
import { randomId, randomSecret, sha256Hex } from './crypto'
import { serveFile, uploadAsset } from './files'
import { isLocalRequest } from './local'
import { handleRegistry, json, notFound } from './registry-api'
import { registryStub } from './registry-do'

export { TableDO } from './table-do'
export { RegistryDO } from './registry-do'

async function createTable(request: Request, env: Env): Promise<Response> {
  let name = 'Nova mesa'
  try {
    const body = await request.json<{ name?: unknown }>()
    if (typeof body.name === 'string' && body.name.trim()) name = body.name.trim().slice(0, TABLE_NAME_MAX)
  } catch {
    // body ausente ou inválido → nome padrão
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const tableId = randomId(10)
    const gmSecret = randomSecret()
    const stub = env.TABLES.get(env.TABLES.idFromName(tableId))
    const res = await stub.fetch('https://table/init', {
      method: 'POST',
      body: JSON.stringify({ id: tableId, name, gmSecretHash: await sha256Hex(gmSecret) }),
    })
    if (res.status === 201) {
      await registryStub(env).register({ id: tableId, name, gmSecret, playerKey: null })
      return json({ tableId, gmSecret }, 201)
    }
  }
  return json({ error: 'could_not_create' }, 500)
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    // Índice e criação: só do próprio PC (nunca pelo túnel).
    if (parts[0] === 'api' && parts[1] === 'registry') {
      return isLocalRequest(request) ? handleRegistry(request, env, parts.slice(2)) : notFound()
    }

    if (parts[0] === 'api' && parts[1] === 'tables') {
      if (parts.length === 2 && request.method === 'POST') return isLocalRequest(request) ? createTable(request, env) : notFound()
      const tableId = parts[2]
      if (!tableId || !TABLE_ID_RE.test(tableId)) return json({ error: 'invalid_table' }, 400)
      const stub = env.TABLES.get(env.TABLES.idFromName(tableId))
      if (parts.length === 4 && parts[3] === 'ws' && request.method === 'GET') {
        return stub.fetch(new Request('https://table/ws', request))
      }
      if (parts.length === 4 && parts[3] === 'assets' && request.method === 'POST') {
        return uploadAsset(request, env, stub)
      }
    }

    if (parts[0] === 'files' && parts.length === 2 && request.method === 'GET') {
      return serveFile(parts[1], env)
    }

    return notFound()
  },
} satisfies ExportedHandler<Env>
