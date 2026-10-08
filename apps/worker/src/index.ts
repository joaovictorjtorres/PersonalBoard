import { TABLE_ID_RE } from '@mesa/shared'
import { randomId, randomSecret, sha256Hex } from './crypto'
import { serveFile, uploadAsset } from './files'

export { TableDO } from './table-do'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function createTable(request: Request, env: Env): Promise<Response> {
  let name = 'Nova mesa'
  try {
    const body = await request.json<{ name?: unknown }>()
    if (typeof body.name === 'string' && body.name.trim()) name = body.name.trim().slice(0, 60)
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
    if (res.status === 201) return json({ tableId, gmSecret }, 201)
  }
  return json({ error: 'could_not_create' }, 500)
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'api' && parts[1] === 'tables') {
      if (parts.length === 2 && request.method === 'POST') return createTable(request, env)
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

    return json({ error: 'not_found' }, 404)
  },
} satisfies ExportedHandler<Env>
