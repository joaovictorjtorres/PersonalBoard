import { TABLE_ID_RE, TableNameSchema, TunnelReportSchema, type RegistryView } from '@mesa/shared'
import { randomSecret, sha256Hex } from './crypto'
import { registryStub } from './registry-do'

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
export const notFound = () => json({ error: 'not_found' }, 404)
const noContent = () => new Response(null, { status: 204 })
const invalid = () => json({ error: 'invalid' }, 400)

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/** Rotas /api/registry/* (o chamador já garantiu que o pedido é local). `rest` = partes depois de "registry". */
export async function handleRegistry(request: Request, env: Env, rest: string[]): Promise<Response> {
  const registry = registryStub(env)
  if (rest.length === 1 && rest[0] === 'tables' && request.method === 'GET') {
    const [tables, tunnelUrl] = await Promise.all([registry.listTables(), registry.getTunnel()])
    const view: RegistryView = { tables, tunnelUrl }
    return json(view)
  }
  if (rest.length === 1 && rest[0] === 'tunnel' && request.method === 'POST') {
    const parsed = TunnelReportSchema.safeParse(await readJson(request))
    if (!parsed.success) return invalid()
    await registry.setTunnel(parsed.data.url)
    return noContent()
  }
  if (rest.length === 2 && rest[0] === 'tables' && TABLE_ID_RE.test(rest[1])) {
    const id = rest[1]
    if (request.method === 'PATCH') return renameTable(env, id, await readJson(request))
    if (request.method === 'DELETE') return deleteTable(env, id)
  }
  if (rest.length === 3 && rest[0] === 'tables' && TABLE_ID_RE.test(rest[1]) && request.method === 'POST') {
    if (rest[2] === 'player-link') return rotateLink(env, rest[1], 'player')
    if (rest[2] === 'gm-link') return rotateLink(env, rest[1], 'gm')
  }
  return notFound()
}

const tableStub = (env: Env, id: string) => env.TABLES.get(env.TABLES.idFromName(id))

async function renameTable(env: Env, id: string, body: unknown): Promise<Response> {
  const parsed = TableNameSchema.safeParse((body as { name?: unknown } | null)?.name)
  if (!parsed.success) return invalid()
  if (!(await registryStub(env).renameTable(id, parsed.data))) return notFound()
  await tableStub(env, id).renameTable(parsed.data)
  return noContent()
}

async function deleteTable(env: Env, id: string): Promise<Response> {
  const registry = registryStub(env)
  if (!(await registry.findTable(id))) return notFound()
  const keys = await tableStub(env, id).deleteTable()
  await registry.removeTable(id)
  await pruneFiles(env, keys)
  return noContent()
}

/** Apaga do R2 os arquivos que nenhuma outra mesa do índice usa (mesas antigas, fora do índice, não contam). */
async function pruneFiles(env: Env, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const used = new Set<string>()
  for (const t of await registryStub(env).listTables()) {
    for (const key of await tableStub(env, t.id).listAssetKeys()) used.add(key)
  }
  const orphans = keys.filter((k) => !used.has(k))
  if (orphans.length > 0) await env.FILES.delete(orphans)
}

/** Link novo (chave de jogador ou segredo de mestre): o antigo para de funcionar; conectados continuam. */
async function rotateLink(env: Env, id: string, kind: 'player' | 'gm'): Promise<Response> {
  const registry = registryStub(env)
  if (!(await registry.findTable(id))) return notFound()
  const secret = randomSecret()
  const hash = await sha256Hex(secret)
  const table = tableStub(env, id)
  // TableDO primeiro: se falhar no meio, o índice ainda mostra o link que funciona.
  if (kind === 'player') {
    if (!(await table.setPlayerKeyHash(hash))) return notFound()
    await registry.setPlayerKey(id, secret)
  } else {
    if (!(await table.setGmSecretHash(hash))) return notFound()
    await registry.setGmSecret(id, secret)
  }
  return noContent()
}
