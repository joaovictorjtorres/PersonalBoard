import { ALLOWED_UPLOAD_TYPES, ASSET_KEY_RE, MAX_UPLOAD_BYTES } from '@mesa/shared'
import { sha256Hex } from './crypto'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function uploadAsset(request: Request, env: Env, table: DurableObjectStub): Promise<Response> {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_UPLOAD_TYPES.includes(type)) return json({ error: 'unsupported_type' }, 415)
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_UPLOAD_BYTES) return json({ error: 'too_large' }, 413)

  const exists = await table.fetch('https://table/exists')
  if (exists.status !== 204) return json({ error: 'table_not_found' }, 404)

  const body = await request.arrayBuffer()
  if (body.byteLength === 0) return json({ error: 'empty' }, 400)
  if (body.byteLength > MAX_UPLOAD_BYTES) return json({ error: 'too_large' }, 413)

  const assetKey = await sha256Hex(body)
  if (!(await env.FILES.head(assetKey))) {
    await env.FILES.put(assetKey, body, { httpMetadata: { contentType: type } })
  }
  return json({ assetKey }, 201)
}

export async function serveFile(key: string, env: Env): Promise<Response> {
  if (!ASSET_KEY_RE.test(key)) return new Response('not found', { status: 404 })
  const object = await env.FILES.get(key)
  if (!object) return new Response('not found', { status: 404 })
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
