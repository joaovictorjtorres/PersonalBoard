import { TunnelReportSchema, type RegistryView } from '@mesa/shared'
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
  return notFound()
}
