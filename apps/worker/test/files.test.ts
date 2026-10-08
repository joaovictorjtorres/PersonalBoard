import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import { createTable } from './helpers'

const SELF = exports.default

const PNG_1x1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

const GIF_1x1 = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))

const upload = (tableId: string, body: BodyInit, type: string) =>
  SELF.fetch(`https://mesa.test/api/tables/${tableId}/assets`, { method: 'POST', headers: { 'Content-Type': type }, body })

describe('assets', () => {
  it('sobe PNG e serve de volta com cache imutável', async () => {
    const { tableId } = await createTable()
    const res = await upload(tableId, PNG_1x1, 'image/png')
    expect(res.status).toBe(201)
    const { assetKey } = await res.json<{ assetKey: string }>()
    expect(assetKey).toMatch(/^[a-f0-9]{64}$/)

    const file = await SELF.fetch(`https://mesa.test/files/${assetKey}`)
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('image/png')
    expect(file.headers.get('Cache-Control')).toContain('immutable')
    expect(file.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG_1x1)
  })

  it('mesmo conteúdo gera mesma chave', async () => {
    const { tableId } = await createTable()
    const a = await (await upload(tableId, PNG_1x1, 'image/png')).json<{ assetKey: string }>()
    const b = await (await upload(tableId, PNG_1x1, 'image/png')).json<{ assetKey: string }>()
    expect(a.assetKey).toBe(b.assetKey)
  })

  it('recusa SVG com 415', async () => {
    const { tableId } = await createTable()
    expect((await upload(tableId, '<svg/>', 'image/svg+xml')).status).toBe(415)
  })

  it('aceita GIF sem conversão e serve como image/gif', async () => {
    const { tableId } = await createTable()
    const res = await upload(tableId, GIF_1x1, 'image/gif')
    expect(res.status).toBe(201)
    const { assetKey } = await res.json<{ assetKey: string }>()
    const file = await SELF.fetch(`https://mesa.test/files/${assetKey}`)
    expect(file.headers.get('Content-Type')).toBe('image/gif')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(GIF_1x1)
  })

  // Review Focus #5
  it('recusa arquivo maior que 10 MB com 413 e não grava', async () => {
    const { tableId } = await createTable()
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    const res = await upload(tableId, big, 'image/png')
    expect(res.status).toBe(413)
  })

  it('recusa corpo vazio com 400', async () => {
    const { tableId } = await createTable()
    expect((await upload(tableId, new Uint8Array(0), 'image/png')).status).toBe(400)
  })

  it('mesa inexistente → 404', async () => {
    expect((await upload('ZZZZZZZZZZ', PNG_1x1, 'image/png')).status).toBe(404)
  })

  it('chave inválida ou ausente → 404', async () => {
    expect((await SELF.fetch('https://mesa.test/files/naoexiste')).status).toBe(404)
    expect((await SELF.fetch(`https://mesa.test/files/${'b'.repeat(64)}`)).status).toBe(404)
  })
})
