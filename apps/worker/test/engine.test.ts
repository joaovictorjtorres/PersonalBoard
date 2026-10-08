import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, LOCK_TTL_MS, MEMBER_RECENT_MS, type NewObject, type ObjectPatch, type Op } from '@mesa/shared'
import { MemoryStore } from '../src/engine/memory-store'
import { TableEngine, type OpResult } from '../src/engine/engine'

let clock = 1_000
let store: MemoryStore
let engine: TableEngine

const token = (over: Partial<NewObject> = {}): NewObject =>
  ({
    id: 'tok1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
    x: 10, y: 20, width: 70, height: 70, rotation: 0, zIndex: 1, ...over,
  }) as NewObject

const create = (o: NewObject): Op => ({ kind: 'create', object: o })
const update = (id: string, patch: ObjectPatch): Op => ({ kind: 'update', id, patch })
const effects = (r: OpResult) => (r.ok && !r.duplicate ? r.effects : [])
const order = () => store.getLayers().map((l) => `${l.id}:${l.order}`)
const ALL = { mode: 'all' as const, clientIds: [] }

beforeEach(() => {
  clock = 1_000
  store = new MemoryStore()
  store.initTable({ id: 'T', name: 'Mesa', gmSecretHash: 'h', createdAt: 0 }, DEFAULT_LAYERS)
  engine = new TableEngine(store, () => clock)
})

describe('applyOp create', () => {
  it('cria com version 1, dono = autor e controle só do autor', () => {
    const r = engine.applyOp('A', 'player', 'op1', create(token()))
    expect(r).toMatchObject({ ok: true, duplicate: false, version: 1 })
    expect(store.getObject('tok1')).toMatchObject({ ownerId: 'A', updatedBy: 'A', version: 1, control: { mode: 'list', clientIds: ['A'] } })
  })

  it('ignora control enviado pelo cliente', () => {
    engine.applyOp('A', 'player', 'op1', create({ ...token(), control: ALL } as unknown as NewObject))
    expect(store.getObject('tok1')?.control).toEqual({ mode: 'list', clientIds: ['A'] })
  })

  it('opId repetido não reaplica', () => {
    engine.applyOp('A', 'player', 'op1', create(token()))
    expect(engine.applyOp('A', 'player', 'op1', create(token()))).toEqual({ ok: true, duplicate: true, version: 1 })
  })

  it('id existente é rejeitado com exists', () => {
    engine.applyOp('A', 'player', 'op1', create(token()))
    expect(engine.applyOp('B', 'player', 'op2', create(token()))).toMatchObject({ ok: false, reason: 'exists' })
  })

  it('jogador não cria na camada do mestre; mestre cria; camada inexistente é forbidden', () => {
    expect(engine.applyOp('A', 'player', 'op1', create(token({ layerId: 'gm' })))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'op2', create(token({ layerId: 'gm' })))).toMatchObject({ ok: true })
    expect(engine.applyOp('A', 'player', 'op3', create(token({ id: 'x', layerId: 'nope' })))).toMatchObject({ ok: false, reason: 'forbidden' })
  })
})

describe('applyOp update/delete', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('mescla patch, incrementa version e devolve o efeito de objeto', () => {
    const r = engine.applyOp('A', 'player', 'op1', update('tok1', { x: 99 }))
    expect(r).toMatchObject({ ok: true, version: 2 })
    expect(effects(r)).toEqual([
      { kind: 'object', before: expect.objectContaining({ x: 10 }), after: expect.objectContaining({ x: 99, version: 2 }) },
    ])
    expect(store.getObject('tok1')).toMatchObject({ x: 99, y: 20, version: 2, updatedBy: 'A', ownerId: 'A' })
  })

  it('patch de campo de outro tipo é descartado sem corromper', () => {
    engine.applyOp('A', 'player', 'op1', update('tok1', { color: '#ffffff' }))
    expect(store.getObject('tok1')).not.toHaveProperty('color')
  })

  it('objeto inexistente → not_found', () => {
    expect(engine.applyOp('A', 'player', 'op1', update('zzz', { x: 1 }))).toMatchObject({ ok: false, reason: 'not_found', current: null })
  })

  it('jogador não enxerga objeto da camada do mestre (not_found)', () => {
    engine.applyOp('G', 'gm', 'opg', create(token({ id: 'secret', layerId: 'gm' })))
    expect(engine.applyOp('A', 'player', 'op1', update('secret', { x: 1 }))).toMatchObject({ ok: false, reason: 'not_found', current: null })
  })

  it('delete remove e devolve o efeito com before', () => {
    const r = engine.applyOp('A', 'player', 'op1', { kind: 'delete', id: 'tok1' })
    expect(effects(r)).toEqual([{ kind: 'object', before: expect.objectContaining({ id: 'tok1' }), after: null }])
    expect(store.getObject('tok1')).toBeNull()
  })

  it('title: define, remove com null', () => {
    engine.applyOp('A', 'player', 'op1', update('tok1', { title: 'Goblin' }))
    expect(store.getObject('tok1')?.title).toBe('Goblin')
    engine.applyOp('A', 'player', 'op2', update('tok1', { title: null }))
    expect(store.getObject('tok1')).not.toHaveProperty('title')
  })
})

describe('controle', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('lista: quem não está nela recebe forbidden com o estado atual e não pega a trava', () => {
    expect(engine.applyOp('B', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: false, reason: 'forbidden', current: { id: 'tok1', x: 10 } })
    expect(engine.applyOp('B', 'player', 'op2', { kind: 'delete', id: 'tok1' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.grab('B', 'player', 'tok1')).toBe(false)
  })

  it('modo all: qualquer jogador controla', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { control: ALL }))
    expect(engine.applyOp('B', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
    expect(engine.grab('B', 'player', 'tok1')).toBe(true)
  })

  it('modo gm: nem o autor controla; o mestre sim', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { control: { mode: 'gm', clientIds: ['A'] } }))
    expect(engine.applyOp('A', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.grab('A', 'player', 'tok1')).toBe(false)
    expect(engine.applyOp('G', 'gm', 'g2', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
  })

  it('lista com outro jogador incluído', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { control: { mode: 'list', clientIds: ['A', 'B'] } }))
    expect(engine.applyOp('B', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
  })

  it('só o mestre muda control', () => {
    expect(engine.applyOp('A', 'player', 'op1', update('tok1', { control: ALL }))).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('jogador que controla não muda layerId, nem para a mesma camada', () => {
    expect(engine.applyOp('A', 'player', 'op1', update('tok1', { layerId: 'drawings' }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('A', 'player', 'op2', update('tok1', { layerId: 'tokens' }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(store.getObject('tok1')?.layerId).toBe('tokens')
  })

  it('mestre move entre camadas mantendo posição e tamanho', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { layerId: 'gm', zIndex: 5 }))
    expect(store.getObject('tok1')).toMatchObject({ layerId: 'gm', x: 10, y: 20, width: 70, height: 70, zIndex: 5 })
    expect(engine.applyOp('G', 'gm', 'g2', update('tok1', { layerId: 'nope' }))).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('camada travada: jogador que controla não edita; mestre edita', () => {
    engine.applyOp('G', 'gm', 'g1', { kind: 'layerUpdate', id: 'tokens', patch: { locked: true } })
    expect(engine.applyOp('A', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g2', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
  })
})

describe('travas', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
    engine.applyOp('G', 'gm', 'g0', update('tok1', { control: ALL }))
  })

  it('outro cliente não altera objeto travado', () => {
    expect(engine.grab('A', 'player', 'tok1')).toBe(true)
    expect(engine.grab('B', 'player', 'tok1')).toBe(false)
    expect(engine.applyOp('B', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: false, reason: 'locked' })
    expect(engine.applyOp('A', 'player', 'op2', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
  })

  it('trava expira após LOCK_TTL_MS', () => {
    engine.grab('A', 'player', 'tok1')
    clock += LOCK_TTL_MS + 1
    expect(engine.grab('B', 'player', 'tok1')).toBe(true)
  })

  it('touchLock renova só para o dono', () => {
    engine.grab('A', 'player', 'tok1')
    clock += LOCK_TTL_MS - 1
    expect(engine.touchLock('B', 'tok1')).toBe(false)
    expect(engine.touchLock('A', 'tok1')).toBe(true)
    clock += LOCK_TTL_MS - 1
    expect(engine.grab('B', 'player', 'tok1')).toBe(false)
  })

  it('release só pelo dono; releaseAll devolve ids', () => {
    engine.grab('A', 'player', 'tok1')
    expect(engine.release('B', 'tok1')).toBe(false)
    expect(engine.releaseAll('A')).toEqual(['tok1'])
    expect(engine.activeLocks()).toEqual([])
  })

  it('delete libera a trava do objeto', () => {
    engine.grab('A', 'player', 'tok1')
    engine.applyOp('A', 'player', 'op1', { kind: 'delete', id: 'tok1' })
    expect(engine.activeLocks()).toEqual([])
  })

  it('esconder a camada solta as travas de jogadores, não as do mestre', () => {
    engine.applyOp('G', 'gm', 'g1', create(token({ id: 'tok2' })))
    engine.grab('A', 'player', 'tok1')
    engine.grab('G', 'gm', 'tok2')
    const r = engine.applyOp('G', 'gm', 'g2', { kind: 'layerUpdate', id: 'tokens', patch: { visibility: 'gm' } })
    expect(effects(r)).toContainEqual({ kind: 'released', objectId: 'tok1', clientId: 'A' })
    expect(engine.activeLocks()).toEqual([{ objectId: 'tok2', clientId: 'G' }])
  })
})

describe('camadas', () => {
  it('jogador não mexe em camadas', () => {
    const ops: Op[] = [
      { kind: 'layerCreate', layer: { id: 'n', name: 'N' } },
      { kind: 'layerUpdate', id: 'map', patch: { name: 'X' } },
      { kind: 'layerDelete', id: 'map' },
      { kind: 'layerMove', id: 'map', direction: 'up' },
    ]
    ops.forEach((op, i) => expect(engine.applyOp('A', 'player', `p${i}`, op)).toMatchObject({ ok: false, reason: 'forbidden', current: null }))
  })

  it('layerCreate entra logo abaixo do Mestre e devolve as camadas afetadas', () => {
    const r = engine.applyOp('G', 'gm', 'g1', { kind: 'layerCreate', layer: { id: 'nova', name: 'Nova camada' } })
    expect(r).toMatchObject({ ok: true, version: 0 })
    expect(order()).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
    expect(effects(r)).toEqual([
      {
        kind: 'layers',
        changes: [
          { before: null, after: { id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false } },
          { before: expect.objectContaining({ id: 'gm', order: 3 }), after: expect.objectContaining({ id: 'gm', order: 4 }) },
        ],
      },
    ])
    expect(engine.applyOp('G', 'gm', 'g2', { kind: 'layerCreate', layer: { id: 'nova', name: 'Outra' } })).toMatchObject({ ok: false, reason: 'exists' })
  })

  it('layerUpdate renomeia e trava; a camada do Mestre não pode ser mostrada', () => {
    engine.applyOp('G', 'gm', 'g1', { kind: 'layerUpdate', id: 'gm', patch: { name: 'Segredos', locked: true } })
    expect(store.getLayers().find((l) => l.id === 'gm')).toMatchObject({ name: 'Segredos', locked: true, visibility: 'gm' })
    expect(engine.applyOp('G', 'gm', 'g2', { kind: 'layerUpdate', id: 'gm', patch: { visibility: 'all' } })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g3', { kind: 'layerUpdate', id: 'nope', patch: { name: 'X' } })).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('layerMove troca com a vizinha; não passa do Mestre, não desce do fundo e o Mestre não se move', () => {
    expect(engine.applyOp('G', 'gm', 'g1', { kind: 'layerMove', id: 'map', direction: 'up' })).toMatchObject({ ok: true })
    expect(order()).toEqual(['tokens:0', 'map:1', 'drawings:2', 'gm:3'])
    expect(engine.applyOp('G', 'gm', 'g2', { kind: 'layerMove', id: 'drawings', direction: 'up' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g3', { kind: 'layerMove', id: 'tokens', direction: 'down' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g4', { kind: 'layerMove', id: 'gm', direction: 'down' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g5', { kind: 'layerMove', id: 'nope', direction: 'up' })).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('layerDelete apaga objetos, anotações e travas da camada', () => {
    engine.applyOp('A', 'player', 'p1', create(token({ id: 'd1', layerId: 'drawings' })))
    engine.applyOp('G', 'gm', 'g1', { kind: 'noteSet', objectId: 'd1', text: 'nota' })
    engine.grab('A', 'player', 'd1')
    const r = engine.applyOp('G', 'gm', 'g2', { kind: 'layerDelete', id: 'drawings' })
    expect(effects(r)).toEqual([{ kind: 'layerRemoved', layer: expect.objectContaining({ id: 'drawings' }) }])
    expect(store.getObject('d1')).toBeNull()
    expect(store.listNotes()).toEqual({})
    expect(engine.activeLocks()).toEqual([])
    expect(store.getLayers().map((l) => l.id)).toEqual(['map', 'tokens', 'gm'])
  })

  it('layerDelete recusa o Mestre e a última camada comum', () => {
    expect(engine.applyOp('G', 'gm', 'g1', { kind: 'layerDelete', id: 'gm' })).toMatchObject({ ok: false, reason: 'forbidden' })
    engine.applyOp('G', 'gm', 'g2', { kind: 'layerDelete', id: 'map' })
    engine.applyOp('G', 'gm', 'g3', { kind: 'layerDelete', id: 'tokens' })
    expect(engine.applyOp('G', 'gm', 'g4', { kind: 'layerDelete', id: 'drawings' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(store.getLayers().map((l) => l.id)).toEqual(['drawings', 'gm'])
  })
})

describe('anotações', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('só o mestre escreve; snapshot entrega só ao mestre; texto vazio remove', () => {
    expect(engine.applyOp('A', 'player', 'p1', { kind: 'noteSet', objectId: 'tok1', text: 'x' })).toMatchObject({ ok: false, reason: 'forbidden' })
    const r = engine.applyOp('G', 'gm', 'g1', { kind: 'noteSet', objectId: 'tok1', text: 'tem 3 PV' })
    expect(effects(r)).toEqual([{ kind: 'note', objectId: 'tok1', text: 'tem 3 PV' }])
    expect(engine.snapshot('gm', new Set()).notes).toEqual({ tok1: 'tem 3 PV' })
    expect(engine.snapshot('player', new Set()).notes).toEqual({})
    engine.applyOp('G', 'gm', 'g2', { kind: 'noteSet', objectId: 'tok1', text: '   ' })
    expect(engine.snapshot('gm', new Set()).notes).toEqual({})
  })

  it('apagar o objeto apaga a anotação; objeto inexistente é not_found', () => {
    engine.applyOp('G', 'gm', 'g1', { kind: 'noteSet', objectId: 'tok1', text: 'nota' })
    engine.applyOp('A', 'player', 'p1', { kind: 'delete', id: 'tok1' })
    expect(store.listNotes()).toEqual({})
    expect(engine.applyOp('G', 'gm', 'g2', { kind: 'noteSet', objectId: 'tok1', text: 'x' })).toMatchObject({ ok: false, reason: 'not_found' })
  })
})

describe('membros e snapshot', () => {
  it('cores distintas para membros online; quem volta mantém a cor', () => {
    const a = engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    const b = engine.join({ clientId: 'B', nickname: 'Bia', role: 'player' }, new Set(['A']))
    expect(a.color).not.toBe(b.color)
    const a2 = engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set(['B']))
    expect(a2.color).toBe(a.color)
  })

  it('snapshot do jogador omite camada e objetos do mestre', () => {
    engine.applyOp('G', 'gm', 'op1', create(token({ id: 'secret', layerId: 'gm' })))
    engine.applyOp('A', 'player', 'op2', create(token({ id: 'pub' })))
    const s = engine.snapshot('player', new Set())
    expect(s.layers.map((l) => l.id)).toEqual(['map', 'tokens', 'drawings'])
    expect(s.objects.map((o) => o.id)).toEqual(['pub'])
    const g = engine.snapshot('gm', new Set())
    expect(g.layers).toHaveLength(4)
    expect(g.objects).toHaveLength(2)
  })

  it('snapshot marca online conforme o conjunto recebido', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    engine.join({ clientId: 'B', nickname: 'Bia', role: 'player' }, new Set())
    const s = engine.snapshot('player', new Set(['A']))
    expect(s.members.find((m) => m.clientId === 'A')?.online).toBe(true)
    expect(s.members.find((m) => m.clientId === 'B')?.online).toBe(false)
  })

  it('lista só quem está online ou foi visto nos últimos 7 dias', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    engine.join({ clientId: 'B', nickname: 'Bia', role: 'player' }, new Set())
    clock += MEMBER_RECENT_MS
    engine.touchMember('B')
    clock += 1
    expect(engine.snapshot('player', new Set()).members.map((m) => m.clientId)).toEqual(['B'])
    expect(engine.snapshot('player', new Set(['A'])).members.map((m) => m.clientId).sort()).toEqual(['A', 'B'])
  })

  it('join mantém o hash do segredo quando não recebe outro e não o expõe no snapshot', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player', secretHash: 'h1' }, new Set())
    engine.join({ clientId: 'A', nickname: 'Ana 2', role: 'player' }, new Set())
    expect(store.getMember('A')).toMatchObject({ nickname: 'Ana 2', secretHash: 'h1' })
    expect(engine.snapshot('gm', new Set(['A'])).members[0]).not.toHaveProperty('secretHash')
  })

  it('memberRemove: recusa online, remove offline, e quem volta reaparece', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    const remove: Op = { kind: 'memberRemove', clientId: 'A' }
    expect(engine.applyOp('G', 'gm', 'g1', remove, new Set(['A', 'G']))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('B', 'player', 'p1', remove, new Set())).toMatchObject({ ok: false, reason: 'forbidden' })
    const r = engine.applyOp('G', 'gm', 'g2', remove, new Set(['G']))
    expect(effects(r)).toEqual([{ kind: 'memberRemoved', clientId: 'A' }])
    expect(engine.snapshot('gm', new Set()).members).toEqual([])
    expect(engine.applyOp('G', 'gm', 'g3', remove, new Set())).toMatchObject({ ok: false, reason: 'not_found' })
    const back = engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    expect(back.online).toBe(true)
    expect(engine.snapshot('gm', new Set(['A'])).members.map((m) => m.clientId)).toEqual(['A'])
  })
})
