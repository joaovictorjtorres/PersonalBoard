import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, LOCK_TTL_MS, type NewObject, type Op } from '@mesa/shared'
import { MemoryStore } from '../src/engine/memory-store'
import { TableEngine } from '../src/engine/engine'

let clock = 1_000
let store: MemoryStore
let engine: TableEngine

const token = (over: Partial<NewObject> = {}): NewObject =>
  ({
    id: 'tok1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
    x: 10, y: 20, width: 70, height: 70, rotation: 0, zIndex: 1, ...over,
  }) as NewObject

const create = (o: NewObject): Op => ({ kind: 'create', object: o })

beforeEach(() => {
  clock = 1_000
  store = new MemoryStore()
  store.initTable({ id: 'T', name: 'Mesa', gmSecretHash: 'h', createdAt: 0 }, DEFAULT_LAYERS)
  engine = new TableEngine(store, () => clock)
})

describe('applyOp create', () => {
  it('cria com version 1 e dono = autor', () => {
    const r = engine.applyOp('A', 'player', 'op1', create(token()))
    expect(r).toMatchObject({ ok: true, duplicate: false, version: 1 })
    expect(store.getObject('tok1')).toMatchObject({ ownerId: 'A', updatedBy: 'A', version: 1 })
  })

  it('opId repetido não reaplica', () => {
    engine.applyOp('A', 'player', 'op1', create(token()))
    const r = engine.applyOp('A', 'player', 'op1', create(token()))
    expect(r).toEqual({ ok: true, duplicate: true, version: 1 })
  })

  it('id existente é rejeitado com exists', () => {
    engine.applyOp('A', 'player', 'op1', create(token()))
    expect(engine.applyOp('B', 'player', 'op2', create(token()))).toMatchObject({ ok: false, reason: 'exists' })
  })

  it('jogador não cria na camada do mestre', () => {
    expect(engine.applyOp('A', 'player', 'op1', create(token({ layerId: 'gm' })))).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('mestre cria na camada do mestre', () => {
    expect(engine.applyOp('G', 'gm', 'op1', create(token({ layerId: 'gm' })))).toMatchObject({ ok: true })
  })

  it('camada inexistente é forbidden', () => {
    expect(engine.applyOp('A', 'player', 'op1', create(token({ layerId: 'nope' })))).toMatchObject({ ok: false, reason: 'forbidden' })
  })
})

describe('applyOp update/delete', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('mescla patch e incrementa version', () => {
    const r = engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'tok1', patch: { x: 99 } })
    expect(r).toMatchObject({ ok: true, version: 2 })
    expect(store.getObject('tok1')).toMatchObject({ x: 99, y: 20, version: 2, updatedBy: 'B', ownerId: 'A' })
  })

  it('patch inválido para o tipo é descartado ou rejeitado sem corromper', () => {
    engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'tok1', patch: { color: '#ffffff' } })
    expect(store.getObject('tok1')).not.toHaveProperty('color')
  })

  it('objeto inexistente → not_found', () => {
    expect(engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'zzz', patch: { x: 1 } })).toMatchObject({ ok: false, reason: 'not_found', current: null })
  })

  it('jogador não move objeto para a camada do mestre', () => {
    expect(engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'tok1', patch: { layerId: 'gm' } })).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('jogador não enxerga objeto da camada do mestre (not_found)', () => {
    engine.applyOp('G', 'gm', 'opg', create(token({ id: 'secret', layerId: 'gm' })))
    expect(engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'secret', patch: { x: 1 } })).toMatchObject({ ok: false, reason: 'not_found', current: null })
  })

  it('delete remove e retorna before', () => {
    const r = engine.applyOp('B', 'player', 'op1', { kind: 'delete', id: 'tok1' })
    expect(r).toMatchObject({ ok: true, after: null, before: { id: 'tok1' } })
    expect(store.getObject('tok1')).toBeNull()
  })
})

describe('travas', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('outro cliente não altera objeto travado', () => {
    expect(engine.grab('A', 'player', 'tok1')).toBe(true)
    expect(engine.grab('B', 'player', 'tok1')).toBe(false)
    expect(engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'tok1', patch: { x: 1 } })).toMatchObject({ ok: false, reason: 'locked' })
    expect(engine.applyOp('A', 'player', 'op2', { kind: 'update', id: 'tok1', patch: { x: 1 } })).toMatchObject({ ok: true })
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
})
