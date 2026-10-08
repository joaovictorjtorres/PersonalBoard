import { env, exports } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { SqlStore } from '../src/engine/sql-store'
import { TestClient, createTable, tokenObject } from './helpers'

const SELF = exports.default

describe('TableDO', () => {
  it('mestre recebe 4 camadas; jogador 3; segredo errado vira jogador', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const { welcome: w1 } = await gm.hello('Mestre', { gmSecret })
    expect(w1.self.role).toBe('gm')
    expect(w1.snapshot.layers).toHaveLength(4)
    expect(w1.snapshot.meta.name).toBe('Teste')

    const p = await TestClient.connect(tableId)
    const { welcome: w2 } = await p.hello('Ana', { gmSecret: 'errado' })
    expect(w2.self.role).toBe('player')
    expect(w2.snapshot.layers.map((l) => l.id)).toEqual(['map', 'tokens', 'drawings'])
  })

  it('create gera ack para o autor e op para os outros', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    const { clientId } = await a.hello('Ana')
    await b.hello('Bia')
    const obj = tokenObject()
    a.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    expect(await a.waitFor('ack')).toEqual({ t: 'ack', opId: 'op_1', version: 1 })
    const op = await b.waitFor('op')
    expect(op.by).toBe(clientId)
    expect(op.op).toMatchObject({ kind: 'upsert', object: { id: obj.id, ownerId: clientId } })
    await a.expectNone('op')
  })

  it('opId repetido recebe ack sem retransmitir', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    await a.hello('Ana')
    await b.hello('Bia')
    const msg = { t: 'op' as const, opId: 'op_1', op: { kind: 'create' as const, object: tokenObject() } }
    a.send(msg)
    await a.waitFor('ack')
    await b.waitFor('op')
    a.send(msg)
    await a.waitFor('ack')
    await b.expectNone('op')
  })

  it('jogador é rejeitado na camada do mestre e não vê objetos dela', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    p.send({ t: 'op', opId: 'op_p', op: { kind: 'create', object: tokenObject({ layerId: 'gm' }) } })
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_p', reason: 'forbidden' })
    gm.send({ t: 'op', opId: 'op_g', op: { kind: 'create', object: tokenObject({ layerId: 'gm' }) } })
    await gm.waitFor('ack')
    await p.expectNone('op')
  })

  // Review Focus #2
  it('mover objeto entre camada do mestre e pública faz aparecer/sumir para o jogador', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    const obj = tokenObject({ layerId: 'gm' })
    gm.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await gm.waitFor('ack')
    gm.send({ t: 'op', opId: 'op_2', op: { kind: 'update', id: obj.id, patch: { layerId: 'tokens' } } })
    expect((await p.waitFor('op')).op).toMatchObject({ kind: 'upsert', object: { id: obj.id, layerId: 'tokens' } })
    gm.send({ t: 'op', opId: 'op_3', op: { kind: 'update', id: obj.id, patch: { layerId: 'gm' } } })
    expect((await p.waitFor('op')).op).toEqual({ kind: 'delete', id: obj.id })
  })

  it('trava: segundo grab é negado; desconexão do dono libera e avisa saída', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    const { clientId: aId } = await a.hello('Ana')
    await b.hello('Bia')
    const obj = tokenObject()
    a.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await a.waitFor('ack')
    a.send({ t: 'grab', objectId: obj.id })
    expect(await b.waitFor('grabbed')).toEqual({ t: 'grabbed', objectId: obj.id, clientId: aId })
    b.send({ t: 'grab', objectId: obj.id })
    expect(await b.waitFor('grabDenied')).toEqual({ t: 'grabDenied', objectId: obj.id })
    b.send({ t: 'op', opId: 'op_b', op: { kind: 'update', id: obj.id, patch: { x: 1 } } })
    expect(await b.waitFor('reject')).toMatchObject({ reason: 'locked' })
    a.close()
    expect(await b.waitFor('released')).toEqual({ t: 'released', objectId: obj.id, clientId: aId })
    expect(await b.waitFor('memberLeft')).toEqual({ t: 'memberLeft', clientId: aId })
  })

  // Review Focus #1
  it('mesma pessoa em duas abas: fechar uma não gera memberLeft nem solta a trava', async () => {
    const { tableId } = await createTable()
    const tab1 = await TestClient.connect(tableId)
    const tab2 = await TestClient.connect(tableId)
    const other = await TestClient.connect(tableId)
    const { clientId, welcome } = await tab1.hello('Ana')
    await tab2.hello('Ana', { clientId, clientSecret: welcome.clientSecret })
    await other.hello('Bia')
    const obj = tokenObject()
    tab1.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await tab1.waitFor('ack')
    tab2.send({ t: 'grab', objectId: obj.id })
    await other.waitFor('grabbed')
    tab1.close()
    await other.expectNone('memberLeft')
    await other.expectNone('released')
    tab2.close()
    expect(await other.waitFor('memberLeft')).toEqual({ t: 'memberLeft', clientId })
  })

  // Review Focus #4
  it('ignora lixo e mensagens antes do hello; hello válido depois funciona', async () => {
    const { tableId } = await createTable()
    const c = await TestClient.connect(tableId)
    c.send('isto não é json')
    c.send({ t: 'op', opId: 'op_x', op: { kind: 'create', object: tokenObject() } })
    c.send(JSON.stringify({ t: 'hello', clientId: crypto.randomUUID(), nickname: '   ' }))
    await c.expectNone('welcome')
    await c.expectNone('ack')
    const { welcome } = await c.hello('Ana')
    expect(welcome.snapshot.objects).toEqual([])
  })

  it('mesa inexistente recebe error', async () => {
    const c = await TestClient.connect('ZZZZZZZZZZ')
    expect(await c.waitFor('error')).toEqual({ t: 'error', reason: 'table_not_found' })
  })

  it('estado persiste após todos saírem', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    await a.hello('Ana')
    const obj = tokenObject()
    a.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await a.waitFor('ack')
    a.close()
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Ana')
    expect(welcome.snapshot.objects.map((o) => o.id)).toEqual([obj.id])
  })

  it('presença de cursor chega aos outros, não ao autor', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    const { clientId } = await a.hello('Ana')
    await b.hello('Bia')
    a.send({ t: 'presence', p: { kind: 'cursor', x: 5, y: 6 } })
    expect(await b.waitFor('presence')).toEqual({ t: 'presence', clientId, p: { kind: 'cursor', x: 5, y: 6 } })
    await a.expectNone('presence')
  })

  it('stroke na camada do mestre não chega ao jogador; na pública chega com strokeEnd', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    gm.send({ t: 'presence', p: { kind: 'stroke', strokeId: 's_gm', layerId: 'gm', color: '#ffffff', strokeWidth: 2, points: [1, 2] } })
    gm.send({ t: 'presence', p: { kind: 'strokeEnd', strokeId: 's_gm' } })
    await p.expectNone('presence')
    gm.send({ t: 'presence', p: { kind: 'stroke', strokeId: 's_pub', layerId: 'drawings', color: '#ffffff', strokeWidth: 2, points: [1, 2] } })
    gm.send({ t: 'presence', p: { kind: 'strokeEnd', strokeId: 's_pub' } })
    expect((await p.waitFor('presence')).p.kind).toBe('stroke')
    expect((await p.waitFor('presence')).p.kind).toBe('strokeEnd')
  })

  it('POST /api/tables recusa id malformado em rotas e cria com nome padrão', async () => {
    const bad = await SELF.fetch('https://mesa.test/api/tables/abc/ws', { headers: { Upgrade: 'websocket' } })
    expect(bad.status).toBe(400)
    const res = await SELF.fetch('https://mesa.test/api/tables', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json<{ tableId: string; gmSecret: string }>()
    expect(body.tableId).toMatch(/^[A-Za-z0-9]{10}$/)
    expect(body.gmSecret.length).toBeGreaterThanOrEqual(43)
  })
})

describe('TableDO — identidade (clientSecret)', () => {
  it('primeiro hello recebe um segredo; hello falsificado é recusado sem atrapalhar o dono; segredo certo reconecta', async () => {
    const { tableId } = await createTable()
    const real = await TestClient.connect(tableId)
    const { clientId, welcome } = await real.hello('Ana')
    expect(welcome.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const noSecret = await TestClient.connect(tableId)
    noSecret.send({ t: 'hello', clientId, nickname: 'Falsa' })
    expect(await noSecret.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })

    const wrongSecret = await TestClient.connect(tableId)
    wrongSecret.send({ t: 'hello', clientId, nickname: 'Falsa', clientSecret: 'b'.repeat(43) })
    expect(await wrongSecret.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })
    await wrongSecret.expectNone('welcome')

    await real.expectNone('memberJoined')
    await real.expectNone('memberLeft')
    real.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: tokenObject() } })
    expect(await real.waitFor('ack')).toMatchObject({ opId: 'op_1' })

    const tab2 = await TestClient.connect(tableId)
    const { welcome: again } = await tab2.hello('Ana', { clientId, clientSecret: welcome.clientSecret })
    expect(again.self.clientId).toBe(clientId)
    expect(again.clientSecret).toBeUndefined()
    expect(again.snapshot.members.find((m) => m.clientId === clientId)?.nickname).toBe('Ana')
  })

  it('membro do M1 sem hash adota o primeiro segredo que chegar (trust-on-first-use)', async () => {
    const { tableId } = await createTable()
    const clientId = crypto.randomUUID()
    await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(tableId)), (_instance, state) => {
      new SqlStore(state.storage.sql).upsertMember({ clientId, nickname: 'Ana', color: '#e6194b', role: 'player', lastSeenAt: Date.now() })
    })
    const first = await TestClient.connect(tableId)
    const { welcome } = await first.hello('Ana', { clientId })
    expect(welcome.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    first.close()

    const intruder = await TestClient.connect(tableId)
    intruder.send({ t: 'hello', clientId, nickname: 'Ana' })
    expect(await intruder.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })
  })
})
