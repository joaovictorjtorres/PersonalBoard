import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { RegistryView } from '@mesa/shared'
import { isJsonRequest, isLocalRequest } from '../src/local'
import { LOCAL, createTable } from './helpers'

const SELF = exports.default
const TUNNEL_HEADERS = { 'cf-ray': '8f00000000000000-GRU', 'cf-connecting-ip': '200.100.50.25' }
const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

export async function registryView(): Promise<RegistryView> {
  const res = await SELF.fetch(`${LOCAL}/api/registry/tables`)
  expect(res.status).toBe(200)
  return res.json<RegistryView>()
}

const postTunnel = (body: string) =>
  SELF.fetch(`${LOCAL}/api/registry/tunnel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

describe('isLocalRequest', () => {
  // Review Focus #1
  it('local: localhost, 127.0.0.1 e [::1] em qualquer porta (inclui o proxy do Vite), com cf-connecting-ip de loopback ou sem ele', () => {
    for (const url of ['http://localhost:8787/api/registry/tables', 'http://127.0.0.1:8790/', 'http://[::1]:8787/', 'http://localhost:5173/api/x']) {
      expect(isLocalRequest(req(url, { 'cf-connecting-ip': '127.0.0.1' })), url).toBe(true)
    }
    expect(isLocalRequest(req('http://localhost/'))).toBe(true)
    expect(isLocalRequest(req('http://localhost/', { 'cf-connecting-ip': '::1' }))).toBe(true)
    for (const origin of ['http://localhost:5173', 'http://127.0.0.1:8787', 'http://[::1]:8787']) {
      expect(isLocalRequest(req('http://localhost:8787/', { Origin: origin })), origin).toBe(true)
    }
  })

  it('não local: Host da Cloudflare, qualquer cabeçalho da borda, IP de fora, IP da rede ou Host parecido', () => {
    expect(isLocalRequest(req('https://abc-def.trycloudflare.com/', TUNNEL_HEADERS))).toBe(false)
    expect(isLocalRequest(req('https://abc-def.trycloudflare.com/'))).toBe(false)
    for (const h of ['cf-ray', 'cf-visitor', 'cf-ipcountry', 'cdn-loop', 'cf-warp-tag-id']) {
      expect(isLocalRequest(req('http://localhost:8787/', { [h]: 'x' })), h).toBe(false)
    }
    expect(isLocalRequest(req('http://localhost:8787/', { 'cf-connecting-ip': '200.100.50.25' }))).toBe(false)
    expect(isLocalRequest(req('http://192.168.0.10:8787/'))).toBe(false)
    expect(isLocalRequest(req('http://localhost.evil.com/'))).toBe(false)
    for (const origin of ['https://evil.example', 'http://localhost.evil.com', 'null', 'https://abc-def.trycloudflare.com']) {
      expect(isLocalRequest(req('http://localhost:8787/', { Origin: origin })), origin).toBe(false)
    }
  })

  it('isJsonRequest: só application/json (com ou sem charset)', () => {
    const post = (type?: string) => new Request('http://localhost/', { method: 'POST', headers: type ? { 'Content-Type': type } : {}, body: '{}' })
    expect(isJsonRequest(post('application/json'))).toBe(true)
    expect(isJsonRequest(post('Application/JSON; charset=utf-8'))).toBe(true)
    for (const type of ['text/plain', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x']) {
      expect(isJsonRequest(post(type)), type).toBe(false)
    }
    expect(isJsonRequest(new Request('http://localhost/', { method: 'POST' }))).toBe(false)
  })
})

describe('índice de mesas', () => {
  it('o SELF.fetch dos testes não acrescenta cabeçalhos da borda: pedido a LOCAL é local e o mesmo pedido com cf-ray não é', async () => {
    // Garante que os testes "local" acima e abaixo não passam por acaso: se o harness pusesse cf-ray ou um
    // cf-connecting-ip de fora, este GET daria 404.
    expect((await SELF.fetch(`${LOCAL}/api/registry/tables`)).status).toBe(200)
    expect((await SELF.fetch(`${LOCAL}/api/registry/tables`, { headers: { 'cf-connecting-ip': '200.100.50.25' } })).status).toBe(404)
  })

  it('pedido de fora não vê o índice, não informa túnel e não cria mesa: 404', async () => {
    expect((await SELF.fetch('https://abc-def.trycloudflare.com/api/registry/tables', { headers: TUNNEL_HEADERS })).status).toBe(404)
    expect((await SELF.fetch(`${LOCAL}/api/registry/tables`, { headers: { 'cf-ray': 'x' } })).status).toBe(404)
    expect((await SELF.fetch('https://mesa.test/api/tables', { method: 'POST' })).status).toBe(404)
    expect((await SELF.fetch(`${LOCAL}/api/tables`, { method: 'POST', headers: TUNNEL_HEADERS })).status).toBe(404)
    expect(
      (await SELF.fetch('https://abc-def.trycloudflare.com/api/registry/tunnel', { method: 'POST', headers: TUNNEL_HEADERS, body: '{"url":null}' })).status,
    ).toBe(404)
  })

  it('outro site aberto no navegador (CSRF): Origin de fora dá 404; corpo que não é JSON dá 415; Origin local passa', async () => {
    const evil = { Origin: 'https://evil.example', 'Content-Type': 'application/json' }
    expect((await SELF.fetch(`${LOCAL}/api/tables`, { method: 'POST', headers: evil, body: '{"name":"x"}' })).status).toBe(404)
    expect((await SELF.fetch(`${LOCAL}/api/registry/tunnel`, { method: 'POST', headers: evil, body: '{"url":null}' })).status).toBe(404)
    expect((await SELF.fetch(`${LOCAL}/api/registry/tables`, { headers: { Origin: 'https://evil.example' } })).status).toBe(404)
    // Sem Content-Type JSON (o que um <form> ou fetch "simples" de outro site mandaria): recusado.
    for (const headers of [{}, { 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/x-www-form-urlencoded' }] as Record<string, string>[]) {
      expect((await SELF.fetch(`${LOCAL}/api/tables`, { method: 'POST', headers, body: '{"name":"x"}' })).status, JSON.stringify(headers)).toBe(415)
      expect((await SELF.fetch(`${LOCAL}/api/registry/tunnel`, { method: 'POST', headers, body: '{"url":null}' })).status, JSON.stringify(headers)).toBe(415)
    }
    const ok = await SELF.fetch(`${LOCAL}/api/tables`, {
      method: 'POST',
      headers: { Origin: 'http://localhost:5173', 'Content-Type': 'application/json' },
      body: '{"name":"Mesmo site"}',
    })
    expect(ok.status).toBe(201)
    expect(ok.headers.get('access-control-allow-origin')).toBeNull()
    expect(
      (await SELF.fetch(`${LOCAL}/api/registry/tunnel`, { method: 'POST', headers: { Origin: 'http://127.0.0.1:8787', 'Content-Type': 'application/json' }, body: '{"url":null}' })).status,
    ).toBe(204)
  })

  it('criar registra a mesa; a lista traz nome, datas, jogadores e o segredo do mestre, mais recente primeiro', async () => {
    const a = await createTable('Primeira')
    const b = await createTable('Segunda')
    const { tables } = await registryView()
    const ia = tables.findIndex((t) => t.id === a.tableId)
    const ib = tables.findIndex((t) => t.id === b.tableId)
    expect(ia).toBeGreaterThanOrEqual(0)
    expect(ib).toBeGreaterThanOrEqual(0)
    expect(ib).toBeLessThan(ia)
    expect(tables[ia]).toMatchObject({ name: 'Primeira', players: 0, gmSecret: a.gmSecret })
    expect(tables[ia].lastActivityAt).toBe(tables[ia].createdAt)
  })

  it('túnel: guarda a origem informada, recusa endereço inválido sem perder a atual e volta a null', async () => {
    expect((await postTunnel(JSON.stringify({ url: 'https://abc-def.trycloudflare.com' }))).status).toBe(204)
    expect((await registryView()).tunnelUrl).toBe('https://abc-def.trycloudflare.com')
    for (const bad of ['{"url":"javascript:alert(1)"}', '{"url":"https://abc.trycloudflare.com/t/x"}', '{}', 'lixo']) {
      expect((await postTunnel(bad)).status, bad).toBe(400)
    }
    expect((await registryView()).tunnelUrl).toBe('https://abc-def.trycloudflare.com')
    expect((await postTunnel('{"url":null}')).status).toBe(204)
    expect((await registryView()).tunnelUrl).toBeNull()
  })
})
