import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { RegistryView } from '@mesa/shared'
import worker from '../src/index'
import { isJsonRequest, isLocalRequest } from '../src/local'
import { handleRegistry } from '../src/registry-api'
import { LOCAL, TestClient, createTable, tokenObject } from './helpers'

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
    expect(tables[ia]).toMatchObject({ name: 'Primeira', players: 0, gmSecret: a.gmSecret, playerKey: a.playerKey })
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

const patchName = (id: string, body: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${LOCAL}/api/registry/tables/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body })
const deleteTable = (id: string) =>
  SELF.fetch(`${LOCAL}/api/registry/tables/${id}`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })

async function uploadRandom(tableId: string): Promise<string> {
  const res = await SELF.fetch(`${LOCAL}/api/tables/${tableId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: crypto.getRandomValues(new Uint8Array(64)),
  })
  expect(res.status).toBe(201)
  return (await res.json<{ assetKey: string }>()).assetKey
}

describe('renomear e apagar mesa', () => {
  it('renomear: nome novo no índice, aviso para quem está na mesa e no snapshot de quem entra depois', async () => {
    const { tableId } = await createTable('Antigo')
    const p = await TestClient.connect(tableId)
    await p.hello('Ana')
    expect((await patchName(tableId, JSON.stringify({ name: '  Nova  ' }))).status).toBe(204)
    expect((await registryView()).tables.find((t) => t.id === tableId)?.name).toBe('Nova')
    expect(await p.waitFor('tableRenamed')).toEqual({ t: 'tableRenamed', name: 'Nova' })
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Bia')).welcome.snapshot.meta.name).toBe('Nova')
  })

  it('renomear: só espaços, mais de 60, corpo inválido → 400 sem mudar; mesa fora do índice → 404; pelo túnel → 404', async () => {
    const { tableId } = await createTable('Fica')
    for (const body of ['{"name":"   "}', JSON.stringify({ name: 'x'.repeat(61) }), '{}', 'lixo']) {
      expect((await patchName(tableId, body)).status, body).toBe(400)
    }
    expect((await registryView()).tables.find((t) => t.id === tableId)?.name).toBe('Fica')
    expect((await patchName('ZZZZZZZZZZ', '{"name":"x"}')).status).toBe(404)
    expect((await patchName(tableId, '{"name":"x"}', { 'cf-ray': 'x' })).status).toBe(404)
  })

  // Review Focus #2
  it('apagar: quem está na mesa recebe table_deleted; some do índice; reconexão vê mesa não encontrada; arquivo só dela sai do R2, compartilhado fica', async () => {
    const a = await createTable('Apagar')
    const b = await createTable('Fica')
    const pa = await TestClient.connect(a.tableId)
    await pa.hello('Ana')
    const pb = await TestClient.connect(b.tableId)
    await pb.hello('Bia')
    const onlyA = await uploadRandom(a.tableId)
    const shared = await uploadRandom(a.tableId)
    pa.send({ t: 'op', opId: 'a1', op: { kind: 'create', object: tokenObject({ assetKey: onlyA }) } })
    pa.send({ t: 'op', opId: 'a2', op: { kind: 'create', object: tokenObject({ assetKey: shared }) } })
    pb.send({ t: 'op', opId: 'b1', op: { kind: 'create', object: tokenObject({ assetKey: shared }) } })
    await pa.waitFor('ack', (m) => m.opId === 'a2')
    await pb.waitFor('ack', (m) => m.opId === 'b1')

    expect((await deleteTable(a.tableId)).status).toBe(204)
    expect(await pa.waitFor('error')).toEqual({ t: 'error', reason: 'table_deleted' })
    expect((await registryView()).tables.some((t) => t.id === a.tableId)).toBe(false)
    expect(await env.FILES.head(onlyA)).toBeNull()
    expect(await env.FILES.head(shared)).not.toBeNull()

    const again = await TestClient.connect(a.tableId)
    expect(await again.waitFor('error')).toEqual({ t: 'error', reason: 'table_not_found' })
    expect((await deleteTable(a.tableId)).status).toBe(404)
  })
})

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitEntry(id: string, pred: (t: RegistryView['tables'][number]) => boolean) {
  for (let i = 0; i < 100; i++) {
    const entry = (await registryView()).tables.find((t) => t.id === id)
    if (entry && pred(entry)) return entry
    await sleep(20)
  }
  throw new Error('o índice não foi atualizado')
}

describe('atividade no índice', () => {
  it('jogador entrando atualiza jogadores e última atividade; o mestre não conta como jogador', async () => {
    const { tableId, gmSecret } = await createTable('Atividade')
    const created = (await registryView()).tables.find((t) => t.id === tableId)!
    const gm = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const p = await TestClient.connect(tableId)
    await p.hello('Ana')
    const entry = await waitEntry(tableId, (t) => t.players === 1)
    expect(entry.lastActivityAt).toBeGreaterThanOrEqual(created.lastActivityAt)
  })

  it('mesa fora do índice (antiga) continua fora da lista mesmo com atividade', async () => {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    const stub = env.TABLES.get(env.TABLES.idFromName(id))
    expect((await stub.fetch('https://table/init', { method: 'POST', body: JSON.stringify({ id, name: 'Antiga', gmSecretHash: 'h' }) })).status).toBe(201)
    const c = await TestClient.connect(id)
    await c.hello('Ana')
    await sleep(100)
    expect((await registryView()).tables.some((t) => t.id === id)).toBe(false)
  })
})

const rotate = (id: string, kind: 'player-link' | 'gm-link', headers: Record<string, string> = {}) =>
  SELF.fetch(`${LOCAL}/api/registry/tables/${id}/${kind}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers } })

describe('gerar novos links', () => {
  it('link de jogador novo: quem está conectado continua; a chave antiga expira (inclusive com segredo guardado); a nova entra', async () => {
    const { tableId, playerKey: oldKey } = await createTable('Links')
    const p = await TestClient.connect(tableId)
    const { clientId, welcome } = await p.hello('Ana')
    expect((await rotate(tableId, 'player-link')).status).toBe(204)
    const newKey = (await registryView()).tables.find((t) => t.id === tableId)!.playerKey!
    expect(newKey).not.toBe(oldKey)

    p.send({ t: 'op', opId: 'still', op: { kind: 'create', object: tokenObject() } })
    expect(await p.waitFor('ack')).toMatchObject({ opId: 'still' })

    const stale = await TestClient.connect(tableId)
    stale.send({ t: 'hello', v: 2, clientId: crypto.randomUUID(), nickname: 'Bia', playerKey: oldKey })
    expect(await stale.waitFor('error')).toEqual({ t: 'error', reason: 'link_expired' })
    const back = await TestClient.connect(tableId)
    back.send({ t: 'hello', v: 2, clientId, nickname: 'Ana', clientSecret: welcome.clientSecret, playerKey: oldKey })
    expect(await back.waitFor('error')).toEqual({ t: 'error', reason: 'link_expired' })
    const fresh = await TestClient.connect(tableId)
    expect((await fresh.hello('Bia', { playerKey: newKey })).welcome.self.role).toBe('player')
  })

  it('link de mestre novo: o segredo antigo deixa de dar mestre; o novo dá e volta a ser o mesmo membro', async () => {
    const { tableId, gmSecret: oldSecret } = await createTable('Mestre novo')
    const gm = await TestClient.connect(tableId)
    const { welcome: w1 } = await gm.hello('Mestre', { gmSecret: oldSecret })
    expect((await rotate(tableId, 'gm-link')).status).toBe(204)
    const newSecret = (await registryView()).tables.find((t) => t.id === tableId)!.gmSecret
    expect(newSecret).not.toBe(oldSecret)

    const stale = await TestClient.connect(tableId)
    stale.send({ t: 'hello', v: 2, clientId: crypto.randomUUID(), nickname: 'X', gmSecret: oldSecret })
    expect(await stale.waitFor('error')).toEqual({ t: 'error', reason: 'link_expired' })
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Mestre', { gmSecret: newSecret, playerKey: null })
    expect(welcome.self).toMatchObject({ role: 'gm', clientId: w1.self.clientId })
  })

  it('gerar link: mesa fora do índice → 404; pelo túnel → 404; sem corpo JSON → 415', async () => {
    expect((await rotate('ZZZZZZZZZZ', 'player-link')).status).toBe(404)
    const { tableId } = await createTable()
    expect((await rotate(tableId, 'gm-link', { 'cf-ray': 'x' })).status).toBe(404)
    expect((await SELF.fetch(`${LOCAL}/api/registry/tables/${tableId}/player-link`, { method: 'POST' })).status).toBe(415)
  })
})

describe('gerar link: mesa some do índice no meio do caminho', () => {
  it('registro não grava (mesa apagada do índice) → 404', async () => {
    const { tableId } = await createTable()
    const gone = { findTable: async () => ({ id: tableId }), setPlayerKey: async () => false, setGmSecret: async () => false }
    const fakeEnv = { ...env, REGISTRY: { idFromName: () => 'x', get: () => gone } } as unknown as Env
    for (const kind of ['player-link', 'gm-link']) {
      const res = await handleRegistry(new Request(`${LOCAL}/x`, { method: 'POST' }), fakeEnv, ['tables', tableId, kind])
      expect(res.status, kind).toBe(404)
    }
  })
})

describe('servidor aberto na rede (MESA_EXPOSED, `pnpm host`)', () => {
  const exposedEnv = { ...env, MESA_EXPOSED: '1' } as Env
  const call = (url: string, init: RequestInit = {}) =>
    worker.fetch!(new Request(url, init) as Parameters<NonNullable<typeof worker.fetch>>[0], exposedEnv)
  const spoofed = { 'cf-connecting-ip': '127.0.0.1' }
  const jsonHeaders = { 'Content-Type': 'application/json', ...spoofed }

  it('toda rota /api/registry/* responde 404, mesmo com Host e cf-connecting-ip de loopback', async () => {
    const { tableId } = await createTable()
    const routes: [string, RequestInit][] = [
      ['/api/registry/tables', { headers: spoofed }],
      ['/api/registry/tunnel', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ url: null }) }],
      [`/api/registry/tables/${tableId}`, { method: 'PATCH', headers: jsonHeaders, body: JSON.stringify({ name: 'x' }) }],
      [`/api/registry/tables/${tableId}`, { method: 'DELETE', headers: jsonHeaders }],
      [`/api/registry/tables/${tableId}/player-link`, { method: 'POST', headers: jsonHeaders }],
      [`/api/registry/tables/${tableId}/gm-link`, { method: 'POST', headers: jsonHeaders }],
    ]
    for (const [path, init] of routes) {
      for (const host of ['http://localhost:8787', 'http://100.64.0.2:8787']) {
        expect((await call(`${host}${path}`, init)).status, `${init.method ?? 'GET'} ${host}${path}`).toBe(404)
      }
    }
    // nada mudou: a mesa continua no índice
    expect((await registryView()).tables.some((t) => t.id === tableId)).toBe(true)
  })

  it('POST /api/tables funciona para quem está na rede e devolve só os segredos da mesa criada', async () => {
    const other = await createTable('Outra')
    const res = await call('http://100.64.0.2:8787/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '100.64.0.5' },
      body: JSON.stringify({ name: 'Pela VPN' }),
    })
    expect(res.status).toBe(201)
    const text = await res.text()
    const body = JSON.parse(text) as Record<string, unknown>
    expect(Object.keys(body).sort()).toEqual(['gmSecret', 'playerKey', 'tableId'])
    for (const secret of [other.gmSecret, other.playerKey, other.tableId]) expect(text).not.toContain(secret)
    // ainda exige corpo JSON (outro site não cria mesas pelo navegador de ninguém)
    expect((await call('http://100.64.0.2:8787/api/tables', { method: 'POST', body: '{}' })).status).toBe(415)
  })

  it('sem MESA_EXPOSED (127.0.0.1): pedido da rede não cria mesa; local vê a lista', async () => {
    const res = await SELF.fetch('http://100.64.0.2:8787/api/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '100.64.0.5' },
      body: '{}',
    })
    expect(res.status).toBe(404)
    expect((await SELF.fetch(`${LOCAL}/api/registry/tables`)).status).toBe(200)
  })
})
