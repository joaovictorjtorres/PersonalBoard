import { TABLE_ID_RE, TABLE_NAME_MAX } from '@mesa/shared'
import { randomId, randomSecret, sha256Hex } from './crypto'
import { serveFile, uploadAsset } from './files'
import { isJsonRequest, isLocalRequest } from './local'
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
    const playerKey = randomSecret()
    const stub = env.TABLES.get(env.TABLES.idFromName(tableId))
    const res = await stub.fetch('https://table/init', {
      method: 'POST',
      body: JSON.stringify({ id: tableId, name, gmSecretHash: await sha256Hex(gmSecret), playerKeyHash: await sha256Hex(playerKey) }),
    })
    if (res.status === 201) {
      await registryStub(env).register({ id: tableId, name, gmSecret, playerKey })
      return json({ tableId, gmSecret, playerKey }, 201)
    }
  }
  return json({ error: 'could_not_create' }, 500)
}

/**
 * Servidor aberto na rede (`pnpm host`, --ip 0.0.0.0): alguém da rede/VPN consegue forjar Host e
 * cf-connecting-ip de loopback, então o filtro de pedido local não vale e o índice (com os segredos) some.
 */
const isExposed = (env: Env) => !!env.MESA_EXPOSED

const rejectNonJson = (request: Request): Response | null =>
  request.method !== 'GET' && request.method !== 'HEAD' && !isJsonRequest(request) ? json({ error: 'unsupported_media_type' }, 415) : null

/** Índice e criação: só do próprio PC (nunca pelo túnel nem por outro site), e escrita só com corpo JSON. */
function rejectNonLocal(request: Request): Response | null {
  if (!isLocalRequest(request)) return notFound()
  return rejectNonJson(request)
}

/** Aberto na rede: criar mesa fica livre como antes do índice (devolve só os segredos da mesa criada). */
const rejectCreate = (request: Request, env: Env) => (isExposed(env) ? rejectNonJson(request) : rejectNonLocal(request))

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'api' && parts[1] === 'registry') {
      if (isExposed(env)) return json({ error: 'not_found', exposed: true }, 404)
      return rejectNonLocal(request) ?? handleRegistry(request, env, parts.slice(2))
    }

    if (parts[0] === 'api' && parts[1] === 'tables') {
      if (parts.length === 2 && request.method === 'POST') return rejectCreate(request, env) ?? createTable(request, env)
      const tableId = parts[2]
      if (!tableId || !TABLE_ID_RE.test(tableId)) return json({ error: 'invalid_table' }, 400)
      const stub = env.TABLES.get(env.TABLES.idFromName(tableId))
      if (parts.length === 4 && parts[3] === 'ws' && request.method === 'GET') {
        return stub.fetch(new Request('https://table/ws', request))
      }
      if (parts.length === 4 && parts[3] === 'assets' && request.method === 'POST') {
        return uploadAsset(request, env, stub)
      }
      if (parts.length === 4 && parts[3] === 'members' && request.method === 'GET') {
        return stub.fetch(new Request('https://table/members', request))
      }
    }

    if (parts[0] === 'files' && parts.length === 2 && request.method === 'GET') {
      return serveFile(parts[1], env)
    }

    return notFound()
  },
} satisfies ExportedHandler<Env>
