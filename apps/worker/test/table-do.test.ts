import { env, exports } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { DEFAULT_TURNS, type NewObject, type Op } from '@mesa/shared'
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
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const { clientId: aId } = await a.hello('Ana')
    await b.hello('Bia')
    const obj = tokenObject()
    gm.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await gm.waitFor('ack')
    gm.send({ t: 'op', opId: 'op_2', op: { kind: 'update', id: obj.id, patch: { control: { mode: 'all', clientIds: [] } } } })
    await gm.waitFor('ack')
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

describe('TableDO — migração M1→M2 e recuperação do mestre', () => {
  it('hello sem v (bundle M1) entra sem segredo e sem hash; v:2 depois adota um (TOFU)', async () => {
    const { tableId } = await createTable()
    const clientId = crypto.randomUUID()
    const old = await TestClient.connect(tableId)
    const { welcome } = await old.hello('Ana', { clientId, v: null })
    expect(welcome.clientSecret).toBeUndefined()
    const stored = await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(tableId)), (_i, state) =>
      new SqlStore(state.storage.sql).getMember(clientId),
    )
    expect(stored?.secretHash).toBeUndefined()
    old.close()

    const again = await TestClient.connect(tableId)
    const { welcome: w2 } = await again.hello('Ana', { clientId, v: null })
    expect(w2.clientSecret).toBeUndefined()
    again.close()

    const fresh = await TestClient.connect(tableId)
    const { welcome: w3 } = await fresh.hello('Ana', { clientId })
    expect(w3.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    fresh.close()

    const intruder = await TestClient.connect(tableId)
    intruder.send({ t: 'hello', v: 2, clientId, nickname: 'Ana' })
    expect(await intruder.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })
  })

  it('mestre com gmSecret válido recupera identidade e rotaciona o segredo; jogador com segredo errado leva auth', async () => {
    const { tableId, gmSecret } = await createTable()
    const first = await TestClient.connect(tableId)
    const { clientId, welcome } = await first.hello('Mestre', { gmSecret })
    const oldSecret = welcome.clientSecret!
    first.close()

    const recovered = await TestClient.connect(tableId)
    const { welcome: w2 } = await recovered.hello('Mestre', { clientId, gmSecret, clientSecret: 'x'.repeat(43) })
    expect(w2.self.role).toBe('gm')
    expect(w2.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(w2.clientSecret).not.toBe(oldSecret)
    recovered.close()

    const noSecret = await TestClient.connect(tableId)
    const { welcome: w3 } = await noSecret.hello('Mestre', { clientId, gmSecret })
    expect(w3.clientSecret).toBeDefined()
    noSecret.close()

    const stale = await TestClient.connect(tableId)
    stale.send({ t: 'hello', v: 2, clientId, nickname: 'Mestre', clientSecret: oldSecret })
    expect(await stale.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })

    const player = await TestClient.connect(tableId)
    const { clientId: pid } = await player.hello('Ana')
    player.close()
    const bad = await TestClient.connect(tableId)
    bad.send({ t: 'hello', v: 2, clientId: pid, nickname: 'Ana', clientSecret: 'b'.repeat(43), gmSecret: 'errado' })
    expect(await bad.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })
  })
})

describe('TableDO — M2', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })

  async function table() {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const { clientId: playerId } = await p.hello('Ana')
    return { tableId, gmSecret, gm, p, playerId }
  }

  it('responde pong ao ping sem passar pelo handler', async () => {
    const { tableId } = await createTable()
    const c = await TestClient.connect(tableId)
    c.send('ping')
    await c.waitForRaw('pong')
  })

  it('op com opId legível e schema inválido recebe reject invalid (só depois do hello)', async () => {
    const { tableId } = await createTable()
    const c = await TestClient.connect(tableId)
    const bad = JSON.stringify({ t: 'op', opId: 'op_bad', op: { kind: 'create', object: { ...tokenObject(), x: 'x' } } })
    c.send(bad)
    await c.expectNone('reject')
    await c.hello('Ana')
    c.send(bad)
    const msg = await c.waitFor('reject')
    expect(msg).toEqual({ t: 'reject', opId: 'op_bad', reason: 'invalid' })
    expect('current' in msg).toBe(false)
  })

  it('anotação nunca chega ao jogador: nem ao vivo nem no snapshot', async () => {
    const { tableId, gmSecret, gm, p } = await table()
    const gm2 = await TestClient.connect(tableId)
    await gm2.hello('Mestre 2', { gmSecret })
    const obj = tokenObject()
    gm.send(op('op_1', { kind: 'create', object: obj }))
    await gm.waitFor('ack')
    gm.send(op('op_2', { kind: 'noteSet', objectId: obj.id, text: 'segredo do mestre' }))
    await gm.waitFor('ack')
    expect(await gm2.waitFor('noteSet')).toEqual({ t: 'noteSet', objectId: obj.id, text: 'segredo do mestre' })
    await p.expectNone('noteSet')
    expect(JSON.stringify(p.messages)).not.toContain('segredo')
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Bia')).welcome.snapshot.notes).toEqual({})
    const gm3 = await TestClient.connect(tableId)
    expect((await gm3.hello('Mestre', { gmSecret })).welcome.snapshot.notes).toEqual({ [obj.id]: 'segredo do mestre' })
  })

  it('esconder e mostrar camada ao vivo: layerHidden e layerShown com os objetos', async () => {
    const { gm, p } = await table()
    const obj = tokenObject()
    gm.send(op('op_1', { kind: 'create', object: obj }))
    await p.waitFor('op')
    gm.send(op('op_2', { kind: 'layerUpdate', id: 'tokens', patch: { visibility: 'gm' } }))
    expect(await p.waitFor('layerHidden')).toEqual({ t: 'layerHidden', id: 'tokens' })
    gm.send(op('op_3', { kind: 'layerUpdate', id: 'tokens', patch: { visibility: 'all' } }))
    const shown = await p.waitFor('layerShown')
    expect(shown.layer).toMatchObject({ id: 'tokens', visibility: 'all' })
    expect(shown.objects.map((o) => o.id)).toEqual([obj.id])
  })

  it('esconder a camada solta a trava do jogador e avisa o mestre', async () => {
    const { gm, p, playerId } = await table()
    const obj = tokenObject()
    p.send(op('op_1', { kind: 'create', object: obj }))
    await p.waitFor('ack')
    p.send({ t: 'grab', objectId: obj.id })
    await gm.waitFor('grabbed')
    gm.send(op('op_2', { kind: 'layerUpdate', id: 'tokens', patch: { visibility: 'gm' } }))
    expect(await gm.waitFor('released')).toEqual({ t: 'released', objectId: obj.id, clientId: playerId })
  })

  it('layerCreate entra abaixo do Mestre; jogador não recebe a camada do Mestre', async () => {
    const { tableId, gmSecret, gm, p } = await table()
    gm.send(op('op_1', { kind: 'layerCreate', layer: { id: 'nova', name: 'Nova camada' } }))
    await gm.waitFor('ack')
    expect((await p.waitFor('layerUpsert')).layer).toEqual({ id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false })
    await p.expectNone('layerUpsert', (m) => m.layer.id === 'gm')
    const gm2 = await TestClient.connect(tableId)
    const { welcome } = await gm2.hello('Mestre', { gmSecret })
    expect(welcome.snapshot.layers.map((l) => `${l.id}:${l.order}`)).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
  })

  it('layerMove: limites recusados; troca válida chega ao jogador', async () => {
    const { gm, p } = await table()
    gm.send(op('op_1', { kind: 'layerMove', id: 'drawings', direction: 'up' }))
    expect(await gm.waitFor('reject')).toMatchObject({ opId: 'op_1', reason: 'forbidden' })
    gm.send(op('op_2', { kind: 'layerMove', id: 'gm', direction: 'down' }))
    expect(await gm.waitFor('reject')).toMatchObject({ opId: 'op_2', reason: 'forbidden' })
    gm.send(op('op_3', { kind: 'layerMove', id: 'map', direction: 'up' }))
    await gm.waitFor('ack')
    expect((await p.waitFor('layerUpsert', (m) => m.layer.id === 'map')).layer.order).toBe(1)
    expect((await p.waitFor('layerUpsert', (m) => m.layer.id === 'tokens')).layer.order).toBe(0)
  })

  it('layerDelete apaga objetos e anotações; Mestre e última camada comum não saem', async () => {
    const { tableId, gmSecret, gm, p } = await table()
    const obj = tokenObject({ layerId: 'drawings' })
    gm.send(op('op_1', { kind: 'create', object: obj }))
    gm.send(op('op_2', { kind: 'noteSet', objectId: obj.id, text: 'nota' }))
    gm.send(op('op_3', { kind: 'layerDelete', id: 'drawings' }))
    expect(await p.waitFor('layerRemoved')).toEqual({ t: 'layerRemoved', id: 'drawings' })
    gm.send(op('op_4', { kind: 'layerDelete', id: 'gm' }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'op_4')).toMatchObject({ reason: 'forbidden' })
    gm.send(op('op_5', { kind: 'layerDelete', id: 'map' }))
    await gm.waitFor('ack', (m) => m.opId === 'op_5')
    gm.send(op('op_6', { kind: 'layerDelete', id: 'tokens' }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'op_6')).toMatchObject({ reason: 'forbidden' })
    const gm2 = await TestClient.connect(tableId)
    const { welcome } = await gm2.hello('Mestre', { gmSecret })
    expect(welcome.snapshot.layers.map((l) => l.id)).toEqual(['tokens', 'gm'])
    expect(welcome.snapshot.objects).toEqual([])
    expect(welcome.snapshot.notes).toEqual({})
  })

  it('memberRemove: online recusado; offline removido e avisado', async () => {
    const { tableId, gm, p, playerId } = await table()
    const other = await TestClient.connect(tableId)
    await other.hello('Bia')
    gm.send(op('op_1', { kind: 'memberRemove', clientId: playerId }))
    expect(await gm.waitFor('reject')).toMatchObject({ opId: 'op_1', reason: 'forbidden' })
    p.close()
    await gm.waitFor('memberLeft')
    gm.send(op('op_2', { kind: 'memberRemove', clientId: playerId }))
    await gm.waitFor('ack', (m) => m.opId === 'op_2')
    expect(await other.waitFor('memberRemoved')).toEqual({ t: 'memberRemoved', clientId: playerId })
    const late = await TestClient.connect(tableId)
    const { welcome } = await late.hello('Caio')
    expect(welcome.snapshot.members.map((m) => m.clientId)).not.toContain(playerId)
  })

  it('jogador que controla o token não muda layerId nem control', async () => {
    const { p } = await table()
    const obj = tokenObject()
    p.send(op('op_1', { kind: 'create', object: obj }))
    await p.waitFor('ack')
    p.send(op('op_2', { kind: 'update', id: obj.id, patch: { layerId: 'drawings' } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_2', reason: 'forbidden', current: { id: obj.id, layerId: 'tokens' } })
    p.send(op('op_3', { kind: 'update', id: obj.id, patch: { control: { mode: 'all', clientIds: [] } } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_3', reason: 'forbidden' })
  })

  it('token "só o mestre": jogador não pega nem altera', async () => {
    const { gm, p } = await table()
    const obj = tokenObject()
    p.send(op('op_1', { kind: 'create', object: obj }))
    await p.waitFor('ack')
    gm.send(op('op_2', { kind: 'update', id: obj.id, patch: { control: { mode: 'gm', clientIds: [] } } }))
    expect((await p.waitFor('op')).op).toMatchObject({ kind: 'upsert', object: { control: { mode: 'gm' } } })
    p.send({ t: 'grab', objectId: obj.id })
    expect(await p.waitFor('grabDenied')).toEqual({ t: 'grabDenied', objectId: obj.id })
    p.send(op('op_3', { kind: 'update', id: obj.id, patch: { x: 999 } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_3', reason: 'forbidden' })
  })
})

describe('TableDO — M3: configurações, membros e encaixe', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })

  async function table() {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    const { welcome: gmWelcome } = await gm.hello('Mestre', { gmSecret })
    const { clientId: playerId, welcome } = await p.hello('Ana')
    return { tableId, gmSecret, gm, p, playerId, playerSecret: welcome.clientSecret, gmColor: gmWelcome.self.color }
  }

  it('settingsUpdate: jogador recusado; mestre muda e todos recebem; snapshot traz as configurações', async () => {
    const { tableId, gm, p } = await table()
    p.send(op('op_p', { kind: 'settingsUpdate', patch: { grid: { enabled: true } } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_p', reason: 'forbidden' })
    gm.send(op('op_g', { kind: 'settingsUpdate', patch: { grid: { enabled: true, size: 50 } } }))
    await gm.waitFor('ack', (m) => m.opId === 'op_g')
    const expected = { grid: { enabled: true, size: 50, snap: false } }
    expect(await p.waitFor('settingsUpdated')).toEqual({ t: 'settingsUpdated', settings: expected })
    expect(await gm.waitFor('settingsUpdated')).toEqual({ t: 'settingsUpdated', settings: expected })
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Bia')).welcome.snapshot.settings).toEqual(expected)
  })

  it('memberUpdate: só o mestre; todos recebem; o hello seguinte não sobrescreve apelido nem cor', async () => {
    const { tableId, gm, p, playerId, playerSecret, gmColor } = await table()
    p.send(op('op_p', { kind: 'memberUpdate', clientId: playerId, patch: { nickname: 'Hacker' } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_p', reason: 'forbidden' })
    gm.send(op('op_g', { kind: 'memberUpdate', clientId: playerId, patch: { nickname: 'Aninha', color: gmColor } }))
    expect((await p.waitFor('memberUpdated')).member).toMatchObject({ clientId: playerId, nickname: 'Aninha', color: gmColor, online: true })
    expect((await gm.waitFor('memberUpdated')).member).toMatchObject({ nickname: 'Aninha' })
    p.close()
    await gm.waitFor('memberLeft')
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Ana de novo', { clientId: playerId, clientSecret: playerSecret })
    expect(welcome.self).toMatchObject({ nickname: 'Aninha', color: gmColor })
    expect((await gm.waitFor('memberJoined', (m) => m.member.clientId === playerId && m.member.nickname === 'Aninha')).member.color).toBe(gmColor)
  })

  it('encaixe: o autor também recebe o objeto encaixado; traço não encaixa nem ecoa', async () => {
    const { gm, p } = await table()
    gm.send(op('op_s', { kind: 'settingsUpdate', patch: { grid: { snap: true, size: 50 } } }))
    await p.waitFor('settingsUpdated')
    const obj = tokenObject({ x: 26, y: 74 })
    p.send(op('op_1', { kind: 'create', object: obj }))
    expect(await p.waitFor('ack', (m) => m.opId === 'op_1')).toMatchObject({ version: 1 })
    expect((await p.waitFor('op')).op).toMatchObject({ kind: 'upsert', object: { id: obj.id, x: 50, y: 50, width: 50, height: 50 } })
    expect((await gm.waitFor('op')).op).toMatchObject({ kind: 'upsert', object: { id: obj.id, x: 50, y: 50 } })
    const stroke: NewObject = {
      id: 'st1', type: 'stroke', layerId: 'drawings', x: 26, y: 74, width: 10, height: 10, rotation: 0, zIndex: 1,
      segments: [[0, 0, 10, 10]], color: '#ffffff', strokeWidth: 3,
    }
    p.send(op('op_2', { kind: 'create', object: stroke }))
    const seen = await gm.waitFor('op', (m) => m.op.kind === 'upsert' && m.op.object.id === 'st1')
    expect(seen.op).toMatchObject({ object: { x: 26, y: 74 } })
    await p.expectNone('op', (m) => m.op.kind === 'upsert' && m.op.object.id === 'st1')
  })
})

describe('TableDO — M3: chat, dados e presença', () => {
  const d20 = { die: 20, count: 1, bonus: 0, mode: 'normal' } as const

  async function trio() {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    const { clientId: gmId } = await gm.hello('Mestre', { gmSecret })
    const { clientId: aId, welcome } = await a.hello('Ana')
    const { clientId: bId } = await b.hello('Bia')
    return { tableId, gmSecret, gm, a, b, gmId, aId, bId, aSecret: welcome.clientSecret }
  }

  it('mensagem da mesa: ack para o autor e chat para todos, inclusive ele', async () => {
    const { gm, a, b, aId } = await trio()
    a.send({ t: 'chatSend', reqId: 'c1', channel: 'table', text: 'olá' })
    expect(await a.waitFor('chatAck')).toEqual({ t: 'chatAck', reqId: 'c1' })
    for (const c of [gm, a, b]) {
      expect(await c.waitFor('chat')).toMatchObject({ channel: 'table', entry: { kind: 'message', text: 'olá', authorId: aId } })
    }
  })

  it('rolagem secreta chega ao autor e ao mestre, nunca a outro jogador; snapshot idem', async () => {
    const { tableId, gmSecret, gm, a, b } = await trio()
    a.send({ t: 'roll', reqId: 'r1', channel: 'table', request: d20, secret: true })
    expect((await a.waitFor('chat')).entry).toMatchObject({ kind: 'roll', secret: true })
    expect((await gm.waitFor('chat')).entry).toMatchObject({ kind: 'roll', secret: true })
    await b.expectNone('chat')
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Caio')).welcome.snapshot.chat).toEqual([])
    const gm2 = await TestClient.connect(tableId)
    expect((await gm2.hello('Mestre 2', { gmSecret })).welcome.snapshot.chat).toHaveLength(1)
  })

  it('rolagem com vantagem: dois dados de 1 a 20, mantém o maior, soma o bônus', async () => {
    const { a, b } = await trio()
    a.send({ t: 'roll', reqId: 'r1', channel: 'table', request: { die: 20, count: 1, bonus: 3, mode: 'advantage' }, secret: false })
    const { entry } = await b.waitFor('chat')
    if (entry.kind !== 'roll') throw new Error('esperava rolagem')
    expect(entry.result.rolls).toHaveLength(2)
    for (const v of entry.result.rolls) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(20)
    }
    expect(entry.result.kept).toEqual([Math.max(...entry.result.rolls)])
    expect(entry.result.total).toBe(entry.result.kept[0] + 3)
  })

  // Review Focus #3
  it('conversa privada: só as sessões do remetente (todas as abas) e do destinatário; mestre não recebe; nada é guardado', async () => {
    const { tableId, gmSecret, gm, a, b, aId, bId, aSecret } = await trio()
    const a2 = await TestClient.connect(tableId)
    await a2.hello('Ana', { clientId: aId, clientSecret: aSecret })
    a.send({ t: 'chatSend', reqId: 'd1', channel: { dm: bId }, text: 'segredo' })
    expect(await a.waitFor('chatAck')).toEqual({ t: 'chatAck', reqId: 'd1' })
    expect(await a.waitFor('chat')).toMatchObject({ channel: { dm: bId }, entry: { text: 'segredo', authorId: aId } })
    expect(await a2.waitFor('chat')).toMatchObject({ channel: { dm: bId }, entry: { text: 'segredo' } })
    expect(await b.waitFor('chat')).toMatchObject({ channel: { dm: aId }, entry: { text: 'segredo' } })
    await gm.expectNone('chat')
    expect(JSON.stringify(gm.messages)).not.toContain('segredo')
    const gm2 = await TestClient.connect(tableId)
    expect((await gm2.hello('Mestre 2', { gmSecret })).welcome.snapshot.chat).toEqual([])
  })

  it('privada: destinatário offline → not_found; para si mesmo → invalid; rolagem secreta na privada → invalid', async () => {
    const { a, b, aId, bId } = await trio()
    b.close()
    await a.waitFor('memberLeft')
    a.send({ t: 'chatSend', reqId: 'd1', channel: { dm: bId }, text: 'oi' })
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'd1', reason: 'not_found' })
    a.send({ t: 'chatSend', reqId: 'd2', channel: { dm: aId }, text: 'oi' })
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'd2', reason: 'invalid' })
    a.send({ t: 'roll', reqId: 'd3', channel: { dm: bId }, request: d20, secret: true })
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'd3', reason: 'invalid' })
  })

  it('texto acima de 500 caracteres recebe chatReject invalid', async () => {
    const { a } = await trio()
    a.send(JSON.stringify({ t: 'chatSend', reqId: 'c9', channel: 'table', text: 'x'.repeat(501) }))
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'c9', reason: 'invalid' })
  })

  // Review Focus #2
  it('limite de 5 envios por segundo por pessoa, somando mesa, privada e rolagem', async () => {
    const { a, bId } = await trio()
    for (let i = 0; i < 3; i++) a.send({ t: 'chatSend', reqId: `t${i}`, channel: 'table', text: `m${i}` })
    for (let i = 0; i < 2; i++) a.send({ t: 'chatSend', reqId: `d${i}`, channel: { dm: bId }, text: `p${i}` })
    a.send({ t: 'roll', reqId: 'x', channel: 'table', request: d20, secret: false })
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'x', reason: 'rate_limited' })
    for (const reqId of ['t0', 't1', 't2', 'd0', 'd1']) await a.waitFor('chatAck', (m) => m.reqId === reqId)
  })

  it('régua vai só para os outros; ping vai para todos; recenter de jogador vira false', async () => {
    const { gm, a, b, gmId, aId } = await trio()
    const points = [{ x: 35, y: 35 }, { x: 105, y: 35 }, { x: 200, y: 90 }]
    a.send({ t: 'presence', p: { kind: 'ruler', points } })
    expect(await b.waitFor('presence')).toEqual({ t: 'presence', clientId: aId, p: { kind: 'ruler', points } })
    a.send({ t: 'presence', p: { kind: 'rulerEnd' } })
    expect((await b.waitFor('presence')).p).toEqual({ kind: 'rulerEnd' })
    await a.expectNone('presence')
    a.send({ t: 'presence', p: { kind: 'ping', x: 1, y: 2, recenter: true } })
    expect((await b.waitFor('presence')).p).toEqual({ kind: 'ping', x: 1, y: 2, recenter: false })
    expect((await a.waitFor('presence')).p).toEqual({ kind: 'ping', x: 1, y: 2, recenter: false })
    gm.send({ t: 'presence', p: { kind: 'ping', x: 5, y: 6, recenter: true } })
    expect(await b.waitFor('presence', (m) => m.clientId === gmId)).toMatchObject({ p: { kind: 'ping', recenter: true } })
  })

  it('ping: no máximo 3 por segundo por pessoa', async () => {
    const { a, b } = await trio()
    for (let i = 0; i < 5; i++) a.send({ t: 'presence', p: { kind: 'ping', x: i, y: 0, recenter: false } })
    await b.waitFor('presence', (m) => m.p.kind === 'ping' && m.p.x === 2)
    await b.expectNone('presence', (m) => m.p.kind === 'ping' && m.p.x >= 3)
  })

  it('régua: no máximo 40 por segundo por pessoa; fim da régua sempre passa; formato inválido não chega', async () => {
    const { a, b } = await trio()
    const at = (x: number) => [{ x: 0, y: 0 }, { x, y: 0 }]
    for (let i = 0; i < 45; i++) a.send({ t: 'presence', p: { kind: 'ruler', points: at(i) } })
    a.send({ t: 'presence', p: { kind: 'rulerEnd' } })
    await b.waitFor('presence', (m) => m.p.kind === 'rulerEnd')
    const xs = b.messages.flatMap((m) => (m.t === 'presence' && m.p.kind === 'ruler' ? [m.p.points[1].x] : []))
    expect(xs).toEqual(Array.from({ length: 40 }, (_, i) => i))

    const seen = b.messages.length
    a.send({ t: 'presence', p: { kind: 'ruler', points: [{ x: 0, y: 0 }] } })
    a.send({ t: 'presence', p: { kind: 'ruler', points: Array.from({ length: 33 }, () => ({ x: 1, y: 1 })) } })
    await new Promise((r) => setTimeout(r, 300))
    expect(b.messages.slice(seen).filter((m) => m.t === 'presence')).toEqual([])
  })
})

describe('TableDO — limpar desenhos (clearObjects)', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })
  const stroke = (layerId = 'drawings'): NewObject =>
    ({
      id: `s_${crypto.randomUUID().slice(0, 8)}`, type: 'stroke', layerId, x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1,
      segments: [[0, 0, 5, 5]], color: '#ffffff', strokeWidth: 2,
    }) as NewObject

  it('jogador apaga os próprios desenhos: todos recebem objectsRemoved; o outro jogador e o mestre mantêm o resto', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const { clientId: aId } = await a.hello('Ana')
    await b.hello('Bia')
    const mine = stroke()
    const theirs = stroke()
    const img = tokenObject({ layerId: 'drawings' })
    a.send(op('a1', { kind: 'create', object: mine }))
    a.send(op('a2', { kind: 'create', object: img }))
    b.send(op('b1', { kind: 'create', object: theirs }))
    await a.waitFor('ack', (m) => m.opId === 'a2')
    await b.waitFor('ack')

    a.send(op('c1', { kind: 'clearObjects', layerId: null, authorId: aId, scope: 'drawings' }))
    expect(await a.waitFor('ack', (m) => m.opId === 'c1')).toEqual({ t: 'ack', opId: 'c1', version: 0 })
    for (const c of [a, b, gm]) expect(await c.waitFor('objectsRemoved')).toEqual({ t: 'objectsRemoved', ids: [mine.id], by: aId })

    // repetido: ack sem nova transmissão
    a.send(op('c1', { kind: 'clearObjects', layerId: null, authorId: aId, scope: 'drawings' }))
    await a.waitFor('ack', (m) => m.opId === 'c1')
    await b.expectNone('objectsRemoved')

    a.send(op('c2', { kind: 'clearObjects', layerId: 'drawings', scope: 'drawings' }))
    expect(await a.waitFor('reject')).toMatchObject({ opId: 'c2', reason: 'forbidden' })
  })

  it('mestre limpa a camada oculta: jogador não recebe nada; limpa a pública inteira: a camada continua', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    gm.send(op('g1', { kind: 'create', object: stroke('gm') }))
    await gm.waitFor('ack')
    gm.send(op('g2', { kind: 'clearObjects', layerId: 'gm', scope: 'all' }))
    expect((await gm.waitFor('objectsRemoved')).ids).toHaveLength(1)
    await p.expectNone('objectsRemoved')

    const tok = tokenObject()
    p.send(op('p1', { kind: 'create', object: tok }))
    await p.waitFor('ack')
    gm.send(op('g3', { kind: 'clearObjects', layerId: 'tokens', scope: 'all' }))
    expect((await p.waitFor('objectsRemoved')).ids).toEqual([tok.id])
    await p.expectNone('layerRemoved')
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Bia')
    expect(welcome.snapshot.layers.map((l) => l.id)).toContain('tokens')
    expect(welcome.snapshot.objects).toEqual([])
  })
})

describe('TableDO — turnos', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })

  async function table() {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    const { welcome } = await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    return { tableId, gm, p, gmWelcome: welcome }
  }

  it('jogador recusado; mestre muda e todos, inclusive ele, recebem turnsUpdated; quem entra depois recebe no welcome', async () => {
    const { tableId, gm, p, gmWelcome } = await table()
    expect(gmWelcome.snapshot.turns).toEqual(DEFAULT_TURNS)
    p.send(op('p1', { kind: 'turnsOpen', open: true }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'p1', reason: 'forbidden' })
    await gm.expectNone('turnsUpdated')

    gm.send(op('g1', { kind: 'turnAdd', entry: { id: 'a', name: 'Ana' } }))
    await gm.waitFor('ack', (m) => m.opId === 'g1')
    const expected = { ...DEFAULT_TURNS, entries: [{ id: 'a', name: 'Ana', tokenId: null, initiative: null }] }
    expect(await p.waitFor('turnsUpdated')).toEqual({ t: 'turnsUpdated', turns: expected })
    expect(await gm.waitFor('turnsUpdated')).toEqual({ t: 'turnsUpdated', turns: expected })
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Bia')).welcome.snapshot.turns).toEqual(expected)
  })

  it('rolagem no servidor: iniciativas de 1 a 20 em ordem decrescente; opId repetido não rola de novo', async () => {
    const { gm, p } = await table()
    for (const id of ['a', 'b', 'c', 'd', 'e']) gm.send(op(`add_${id}`, { kind: 'turnAdd', entry: { id, name: id.toUpperCase() } }))
    await gm.waitFor('ack', (m) => m.opId === 'add_e')
    gm.send(op('r1', { kind: 'turnsRoll', all: true }))
    const rolled = await p.waitFor('turnsUpdated', (m) => m.turns.entries.every((e) => e.initiative !== null))
    const values = rolled.turns.entries.map((e) => e.initiative as number)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(20)
    }
    expect([...values].sort((x, y) => y - x)).toEqual(values)
    await gm.waitFor('ack', (m) => m.opId === 'r1')
    gm.send(op('r1', { kind: 'turnsRoll', all: true }))
    await gm.waitFor('ack', (m) => m.opId === 'r1')
    await p.expectNone('turnsUpdated', (m) => m.turns.entries.every((e) => e.initiative !== null))
  })

  it('opId repetido de turno: o autor recebe o estado atual de novo, os outros nada', async () => {
    const { gm, p } = await table()
    gm.send(op('g1', { kind: 'turnAdd', entry: { id: 'a', name: 'Ana' } }))
    await gm.waitFor('ack', (m) => m.opId === 'g1')
    const first = await gm.waitFor('turnsUpdated')
    await p.waitFor('turnsUpdated')
    gm.send(op('g1', { kind: 'turnAdd', entry: { id: 'a', name: 'Ana' } }))
    expect(await gm.waitFor('turnsUpdated')).toEqual(first)
    await p.expectNone('turnsUpdated')
  })

  it('fora da fase ou dado inválido: reject invalid e ninguém recebe turnsUpdated', async () => {
    const { gm, p } = await table()
    gm.send(op('n1', { kind: 'turnNext' }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'n1')).toMatchObject({ reason: 'invalid' })
    gm.send(JSON.stringify({ t: 'op', opId: 'u1', op: { kind: 'turnUpdate', id: 'a', patch: { initiative: 1000 } } }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'u1')).toMatchObject({ reason: 'invalid' })
    await p.expectNone('turnsUpdated')
  })

  it('reconecta depois que todos saem e recebe o estado dos turnos no welcome', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    gm.send(op('g1', { kind: 'turnAdd', entry: { id: 'a', name: 'Ana' } }))
    gm.send(op('g2', { kind: 'turnsStart' }))
    await gm.waitFor('ack', (m) => m.opId === 'g2')
    gm.close()
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Ana')
    expect(welcome.snapshot.turns).toMatchObject({ open: true, phase: 'combat', round: 1, currentId: 'a' })
  })
})

describe('TableDO — lote (batch)', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })
  const strokeObject = (id: string): NewObject =>
    ({
      id, type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 0, rotation: 0, zIndex: 1,
      segments: [[0, 0, 10, 0]], color: '#ffffff', strokeWidth: 3,
    }) as NewObject

  it('autor recebe ack; cada um recebe um envio só, com o que enxerga', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    const pub = tokenObject()
    const secret = tokenObject({ layerId: 'gm' })
    gm.send(op('b1', { kind: 'batch', ops: [{ kind: 'create', object: pub }, { kind: 'create', object: secret }] }))
    expect(await gm.waitFor('ack')).toEqual({ t: 'ack', opId: 'b1', version: 0 })
    const got = await p.waitFor('batch')
    expect(got.ops).toEqual([{ kind: 'upsert', object: expect.objectContaining({ id: pub.id }) }])
    await gm.expectNone('batch')
    await p.expectNone('op')
  })

  it('lote recusado não chega a ninguém', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    p.send(op('b1', { kind: 'batch', ops: [{ kind: 'create', object: tokenObject() }, { kind: 'create', object: tokenObject({ layerId: 'gm' }) }] }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'b1', reason: 'forbidden' })
    await gm.expectNone('batch')
    const { welcome } = await (await TestClient.connect(tableId)).hello('Bia')
    expect(welcome.snapshot.objects).toEqual([])
  })

  it('mais de 200 sub-ações ou ação que não é de objeto (turno, camada): reject invalid, sem efeito', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    const many = Array.from({ length: 201 }, (_, i) => ({ kind: 'delete', id: `d${i}` }))
    p.send(JSON.stringify({ t: 'op', opId: 'b1', op: { kind: 'batch', ops: many } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'b1', reason: 'invalid' })
    p.send(JSON.stringify({ t: 'op', opId: 'b2', op: { kind: 'batch', ops: [{ kind: 'layerCreate', layer: { id: 'l1', name: 'X' } }] } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'b2', reason: 'invalid' })
    gm.send(JSON.stringify({ t: 'op', opId: 'b3', op: { kind: 'batch', ops: [{ kind: 'turnsOpen', open: true }] } }))
    expect(await gm.waitFor('reject')).toMatchObject({ opId: 'b3', reason: 'invalid' })
    await gm.expectNone('turnsUpdated')
    await p.expectNone('turnsUpdated')
  })

  it('mestre corta o traço da Ana: os pedaços chegam com a Ana como dona', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const { clientId: ana } = await p.hello('Ana')
    p.send(op('c1', { kind: 'create', object: strokeObject('s1') }))
    await p.waitFor('ack')
    gm.send(op('b1', {
      kind: 'batch',
      ops: [{ kind: 'create', object: strokeObject('p1'), from: 's1' }, { kind: 'delete', id: 's1' }],
    }))
    expect(await gm.waitFor('ack')).toMatchObject({ opId: 'b1' })
    expect((await p.waitFor('batch')).ops).toEqual([
      { kind: 'upsert', object: expect.objectContaining({ id: 'p1', ownerId: ana, control: { mode: 'list', clientIds: [ana] } }) },
      { kind: 'delete', id: 's1' },
    ])
  })

  it('encaixe: o autor recebe no lote só o que o servidor encaixou', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    gm.send(op('s1', { kind: 'settingsUpdate', patch: { grid: { snap: true } } }))
    await p.waitFor('settingsUpdated')
    const tok = tokenObject({ x: 0, y: 0 })
    p.send(op('c1', { kind: 'create', object: tok }))
    await p.waitFor('ack')
    p.send(op('b1', { kind: 'batch', ops: [{ kind: 'update', id: tok.id, patch: { x: 61 } }] }))
    expect((await p.waitFor('batch')).ops).toEqual([{ kind: 'upsert', object: expect.objectContaining({ id: tok.id, x: 70 }) }])
  })
})
