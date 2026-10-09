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

describe('travar camada com trava ativa', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
    engine.grab('A', 'player', 'tok1')
  })

  it('solta a trava do jogador e o mestre passa a editar', () => {
    const r = engine.applyOp('G', 'gm', 'g1', { kind: 'layerUpdate', id: 'tokens', patch: { locked: true } })
    expect(effects(r)).toContainEqual({ kind: 'released', objectId: 'tok1', clientId: 'A' })
    expect(engine.applyOp('G', 'gm', 'g2', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
  })

  it('touchLock não renova quando o dono não pode mais editar', () => {
    store.putLayer({ ...store.getLayers().find((l) => l.id === 'tokens')!, locked: true })
    expect(engine.touchLock('A', 'tok1')).toBe(false)
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

const rect = (over: Record<string, unknown> = {}): NewObject =>
  ({
    id: 'r1', type: 'shape', kind: 'rect', layerId: 'drawings', x: 0, y: 0, width: 100, height: 40, rotation: 0, zIndex: 1,
    stroke: '#ffffff', strokeWidth: 3, fill: null, ...over,
  }) as NewObject

describe('M3 — configurações', () => {
  it('só o mestre muda; o patch é mesclado e vira efeito; snapshot traz o resultado', () => {
    expect(engine.applyOp('A', 'player', 'p1', { kind: 'settingsUpdate', patch: { grid: { enabled: true } } })).toMatchObject({
      ok: false, reason: 'forbidden',
    })
    const r = engine.applyOp('G', 'gm', 'g1', { kind: 'settingsUpdate', patch: { grid: { enabled: true, size: 50 } } })
    expect(effects(r)).toEqual([{ kind: 'settings', settings: { grid: { enabled: true, size: 50, snap: false } } }])
    expect(engine.snapshot('player', new Set()).settings).toEqual({ grid: { enabled: true, size: 50, snap: false } })
  })
})

describe('M3 — encaixe na grade', () => {
  const snapOn = () => engine.applyOp('G', 'gm', `gs${clock}`, { kind: 'settingsUpdate', patch: { grid: { snap: true, size: 50 } } })

  it('create de imagem encaixa e pede eco ao autor; traço e forma não encaixam', () => {
    snapOn()
    const r = engine.applyOp('A', 'player', 'op1', create(token({ x: 26, y: 74, width: 70, height: 20 })))
    expect(store.getObject('tok1')).toMatchObject({ x: 50, y: 50, width: 50, height: 50 })
    expect(effects(r)[0]).toMatchObject({ kind: 'object', echo: true })
    const stroke = {
      id: 's1', type: 'stroke', layerId: 'drawings', x: 26, y: 74, width: 10, height: 10, rotation: 0, zIndex: 1,
      segments: [[0, 0, 10, 10]], color: '#ffffff', strokeWidth: 3,
    } as NewObject
    const rs = engine.applyOp('A', 'player', 'op2', create(stroke))
    expect(store.getObject('s1')).toMatchObject({ x: 26, y: 74 })
    expect(effects(rs)[0]).not.toHaveProperty('echo')
    engine.applyOp('A', 'player', 'op3', create(rect({ x: 26, y: 74 })))
    expect(store.getObject('r1')).toMatchObject({ x: 26, y: 74, width: 100, height: 40 })
  })

  it('update de imagem encaixa só os campos enviados e não mexe na rotação', () => {
    engine.applyOp('A', 'player', 'op0', create(token({ x: 13, y: 13 })))
    snapOn()
    engine.applyOp('A', 'player', 'op1', update('tok1', { x: 76, rotation: 33 }))
    expect(store.getObject('tok1')).toMatchObject({ x: 100, y: 13, width: 70, height: 70, rotation: 33 })
  })

  it('update de imagem sem geometria (ex.: título) não encaixa nem pede eco', () => {
    engine.applyOp('A', 'player', 'op0', create(token({ x: 13, y: 13 })))
    snapOn()
    const r = engine.applyOp('A', 'player', 'op1', update('tok1', { title: 'Orc' }))
    expect(store.getObject('tok1')).toMatchObject({ x: 13, y: 13, title: 'Orc' })
    expect(effects(r)[0]).not.toHaveProperty('echo')
  })

  it('ligar o encaixe ou mudar o tamanho não move objetos existentes', () => {
    engine.applyOp('A', 'player', 'op0', create(token({ x: 13, y: 13 })))
    snapOn()
    engine.applyOp('G', 'gm', 'g2', { kind: 'settingsUpdate', patch: { grid: { size: 30 } } })
    expect(store.getObject('tok1')).toMatchObject({ x: 13, y: 13 })
  })
})

describe('M3 — formas', () => {
  it('seguem as regras de objeto: o dono move e redimensiona, outro jogador não', () => {
    engine.applyOp('A', 'player', 'op1', create(rect()))
    expect(engine.applyOp('B', 'player', 'op2', update('r1', { x: 5 }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('A', 'player', 'op3', update('r1', { x: 5, width: 300, rotation: 45 }))).toMatchObject({ ok: true })
    expect(store.getObject('r1')).toMatchObject({ type: 'shape', kind: 'rect', x: 5, width: 300, rotation: 45, stroke: '#ffffff' })
  })

  it('espessura acima de 30 vira invalid', () => {
    engine.applyOp('A', 'player', 'op1', create(rect()))
    expect(engine.applyOp('A', 'player', 'op2', update('r1', { strokeWidth: 31 }))).toEqual({ ok: false, reason: 'invalid' })
  })

  it('linha é criada com points relativos', () => {
    engine.applyOp('A', 'player', 'op1', create(rect({ id: 'l1', kind: 'line', points: [0, 40, 100, 0] })))
    expect(store.getObject('l1')).toMatchObject({ kind: 'line', points: [0, 40, 100, 0], fill: null })
  })
})

describe('M3 — memberUpdate', () => {
  it('só o mestre; inexistente é not_found; grava, marca e devolve o membro', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    const op: Op = { kind: 'memberUpdate', clientId: 'A', patch: { nickname: 'Aninha', color: '#123456' } }
    expect(engine.applyOp('B', 'player', 'p1', op)).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g0', { kind: 'memberUpdate', clientId: 'Z', patch: { nickname: 'X' } })).toMatchObject({ ok: false, reason: 'not_found' })
    const r = engine.applyOp('G', 'gm', 'g1', op, new Set(['A']))
    expect(effects(r)).toEqual([
      { kind: 'memberUpdated', member: { clientId: 'A', nickname: 'Aninha', color: '#123456', role: 'player', online: true } },
    ])
    expect(store.getMember('A')).toMatchObject({ nickname: 'Aninha', color: '#123456', nicknameSetByGm: true, colorSetByGm: true })
  })

  it('patch só de cor não marca o apelido', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    engine.applyOp('G', 'gm', 'g1', { kind: 'memberUpdate', clientId: 'A', patch: { color: '#123456' } })
    expect(store.getMember('A')).toMatchObject({ nickname: 'Ana', color: '#123456', colorSetByGm: true })
    expect(store.getMember('A')?.nicknameSetByGm).toBeUndefined()
  })

  it('join mantém apelido e cor definidos pelo mestre, mesmo com a cor repetida', () => {
    engine.join({ clientId: 'G', nickname: 'Mestre', role: 'gm' }, new Set())
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set(['G']))
    const gmColor = store.getMember('G')!.color
    engine.applyOp('G', 'gm', 'g1', { kind: 'memberUpdate', clientId: 'A', patch: { nickname: 'Aninha', color: gmColor } })
    const back = engine.join({ clientId: 'A', nickname: 'Outro nome', role: 'player' }, new Set(['G']))
    expect(back).toMatchObject({ nickname: 'Aninha', color: gmColor })
    expect(store.getMember('A')).toMatchObject({ nicknameSetByGm: true, colorSetByGm: true })
  })
})

describe('M3 — chat e dados', () => {
  const seq = (...values: number[]) => {
    let i = 0
    return () => values[i++]
  }

  it('rolagem usa o gerador injetado: normal com bônus, vantagem e desvantagem', () => {
    const e = new TableEngine(store, () => clock, seq(0, 1, 5, 16, 7, 16, 7))
    expect(e.chatEntry('A', { kind: 'roll', request: { die: 6, count: 3, bonus: 2, mode: 'normal' }, secret: false })).toMatchObject({
      kind: 'roll', authorId: 'A', at: clock, secret: false, result: { rolls: [1, 2, 6], kept: [1, 2, 6], total: 11 },
    })
    expect(e.chatEntry('A', { kind: 'roll', request: { die: 20, count: 1, bonus: 5, mode: 'advantage' }, secret: true })).toMatchObject({
      secret: true, result: { rolls: [17, 8], kept: [17], total: 22 },
    })
    expect(e.chatEntry('A', { kind: 'roll', request: { die: 20, count: 1, bonus: 0, mode: 'disadvantage' }, secret: false })).toMatchObject({
      result: { rolls: [17, 8], kept: [8], total: 8 },
    })
  })

  it('rolagem inválida é recusada antes de rolar (nunca chega ao uniformInt)', () => {
    for (const request of [{ die: 0, count: 1, bonus: 0, mode: 'normal' }, { die: 20, count: 9999, bonus: 0, mode: 'normal' }, { die: 1.5, count: 1, bonus: 0, mode: 'normal' }]) {
      expect(() => engine.chatEntry('A', { kind: 'roll', request: request as never, secret: false })).toThrow()
    }
  })

  it('mensagem e imagem ganham id e hora do servidor', () => {
    const m = engine.chatEntry('A', { kind: 'message', text: 'oi' })
    expect(m).toMatchObject({ kind: 'message', text: 'oi', authorId: 'A', at: clock })
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(engine.chatEntry('A', { kind: 'image', assetKey: 'a'.repeat(64), width: 10, height: 20 })).toMatchObject({
      kind: 'image', width: 10, height: 20,
    })
  })

  it('histórico guarda as últimas 200 e o snapshot esconde a rolagem secreta de terceiros', () => {
    for (let i = 0; i < 205; i++) engine.appendTableChat(engine.chatEntry('A', { kind: 'message', text: `m${i}` }))
    engine.appendTableChat(engine.chatEntry('B', { kind: 'roll', request: { die: 20, count: 1, bonus: 0, mode: 'normal' }, secret: true }))
    const forC = engine.snapshot('player', new Set(), 'C').chat
    expect(forC).toHaveLength(199)
    expect(forC[0]).toMatchObject({ kind: 'message', text: 'm6' })
    expect(engine.snapshot('player', new Set(), 'B').chat).toHaveLength(200)
    expect(engine.snapshot('gm', new Set(), 'G').chat.at(-1)).toMatchObject({ kind: 'roll', secret: true })
  })
})

describe('applyOp clearObjects', () => {
  const stroke = (id: string, layerId = 'drawings'): NewObject =>
    ({ id, type: 'stroke', layerId, x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, segments: [[0, 0, 5, 5]], color: '#ffffff', strokeWidth: 2 }) as NewObject
  const rect = (id: string, layerId = 'drawings'): NewObject =>
    ({ id, type: 'shape', kind: 'rect', layerId, x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, stroke: '#ffffff', strokeWidth: 2, fill: null }) as NewObject
  const clear = (layerId: string | null, scope: 'drawings' | 'all', authorId?: string): Op => ({
    kind: 'clearObjects', layerId, scope, ...(authorId ? { authorId } : {}),
  })
  const left = () => store.listObjects().map((o) => o.id).sort()
  const removedIds = (r: OpResult) =>
    effects(r).flatMap((e) => (e.kind === 'objectsRemoved' ? e.objects.map((o) => o.id) : [])).sort()

  beforeEach(() => {
    engine.applyOp('A', 'player', 'a1', create(stroke('a-draw')))
    engine.applyOp('A', 'player', 'a2', create(rect('a-rect', 'tokens')))
    engine.applyOp('A', 'player', 'a3', create(token({ id: 'a-img', layerId: 'drawings' })))
    engine.applyOp('B', 'player', 'b1', create(stroke('b-draw')))
    engine.applyOp('G', 'gm', 'g1', create(stroke('g-secret', 'gm')))
    engine.applyOp('G', 'gm', 'g2', create(token({ id: 'g-img' })))
  })

  it('jogador apaga só os próprios desenhos (camada atual e todas); imagens e desenhos dos outros ficam', () => {
    const r1 = engine.applyOp('A', 'player', 'c1', clear('drawings', 'drawings', 'A'))
    expect(r1).toMatchObject({ ok: true, version: 0 })
    expect(removedIds(r1)).toEqual(['a-draw'])
    const r2 = engine.applyOp('A', 'player', 'c2', clear(null, 'drawings', 'A'))
    expect(removedIds(r2)).toEqual(['a-rect'])
    expect(left()).toEqual(['a-img', 'b-draw', 'g-img', 'g-secret'])
  })

  it('jogador não apaga desenhos de outra pessoa, nem de todos, nem limpa camada', () => {
    expect(engine.applyOp('A', 'player', 'c1', clear('drawings', 'drawings', 'B'))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('A', 'player', 'c2', clear('drawings', 'drawings'))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('A', 'player', 'c3', clear('drawings', 'all'))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(left()).toHaveLength(6)
  })

  it('camada oculta ou travada: pedida diretamente é recusada; em "todas" é pulada', () => {
    engine.applyOp('G', 'gm', 'l1', { kind: 'layerUpdate', id: 'tokens', patch: { locked: true } })
    expect(engine.applyOp('A', 'player', 'c1', clear('tokens', 'drawings', 'A'))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('A', 'player', 'c2', clear('gm', 'drawings', 'A'))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(removedIds(engine.applyOp('A', 'player', 'c3', clear(null, 'drawings', 'A')))).toEqual(['a-draw'])
    engine.applyOp('G', 'gm', 'l2', { kind: 'layerUpdate', id: 'tokens', patch: { locked: false, visibility: 'gm' } })
    expect(engine.applyOp('A', 'player', 'c4', clear('tokens', 'drawings', 'A'))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(left()).toContain('a-rect')
  })

  it('mestre: desenhos de alguém em todas as camadas, de todos numa camada, e a camada inteira', () => {
    expect(removedIds(engine.applyOp('G', 'gm', 'c1', clear(null, 'drawings', 'A')))).toEqual(['a-draw', 'a-rect'])
    expect(removedIds(engine.applyOp('G', 'gm', 'c2', clear('drawings', 'drawings')))).toEqual(['b-draw'])
    expect(removedIds(engine.applyOp('G', 'gm', 'c3', clear('tokens', 'all')))).toEqual(['g-img'])
    expect(left()).toEqual(['a-img', 'g-secret'])
    expect(store.getLayers().some((l) => l.id === 'tokens')).toBe(true)
  })

  it('opId repetido não reaplica; anotações saem junto', () => {
    engine.applyOp('G', 'gm', 'n1', { kind: 'noteSet', objectId: 'b-draw', text: 'nota' })
    engine.applyOp('G', 'gm', 'c1', clear('drawings', 'drawings'))
    expect(store.listNotes()).toEqual({})
    engine.applyOp('B', 'player', 'b2', create(stroke('b-new')))
    expect(engine.applyOp('G', 'gm', 'c1', clear('drawings', 'drawings'))).toEqual({ ok: true, duplicate: true, version: 0 })
    expect(left()).toContain('b-new')
  })

  it('objeto travado por outra pessoa é apagado e a trava some', () => {
    expect(engine.grab('B', 'player', 'b-draw')).toBe(true)
    expect(removedIds(engine.applyOp('G', 'gm', 'c1', clear('drawings', 'drawings', 'B')))).toEqual(['b-draw'])
    expect(engine.activeLocks()).toEqual([])
  })
})
