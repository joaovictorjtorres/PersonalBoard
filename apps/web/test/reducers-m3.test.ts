import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, PING_DURATION_MS, type Member, type Presence, type ServerMessage, type Snapshot } from '@mesa/shared'
import { reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const gm: Member = { clientId: 'gm1', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const ana: Member = { clientId: 'p1', nickname: 'Ana', color: '#3cb44b', role: 'player', online: true }

const welcome = (self: Member, over: Partial<Snapshot> = {}): ServerMessage => ({
  t: 'welcome',
  self,
  snapshot: {
    meta: { id: 'T', name: 'M' }, members: [gm, ana], layers: DEFAULT_LAYERS, objects: [], locks: [], notes: {},
    settings: DEFAULT_SETTINGS, chat: [], ...over,
  },
})
const joined = (self: Member, over: Partial<Snapshot> = {}): TableState => reduceServer(makeInitialState(), welcome(self, over), 0)
const presence = (s: TableState, clientId: string, p: Presence, now = 0) => reduceServer(s, { t: 'presence', clientId, p }, now)
const grid = { enabled: true, size: 50, snap: true }

describe('configurações', () => {
  it('welcome traz as configurações da mesa', () => {
    expect(joined(ana, { settings: { grid } }).settings).toEqual({ grid })
  })

  it('settingsUpdate é otimista e volta atrás se recusado, com aviso', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'settingsUpdate', patch: { grid: { enabled: true } } }, { isUndo: false })
    expect(s.settings.grid.enabled).toBe(true)
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden' }, 0)
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
    expect(s.toasts.at(-1)?.text).toBe('Só o mestre pode fazer isso')
  })

  it('settingsUpdated substitui as configurações; a op não entra no desfazer', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'settingsUpdate', patch: { grid: { enabled: true } } }, { isUndo: false })
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 0 }, 0)
    expect(s.undoStack).toEqual([])
    s = reduceServer(s, { t: 'settingsUpdated', settings: { grid } }, 0)
    expect(s.settings).toEqual({ grid })
  })

  it('settingsUpdate pendente volta por cima de um welcome novo', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'settingsUpdate', patch: { grid: { snap: true } } }, { isUndo: false })
    s = reduceServer(s, welcome(gm), 0)
    expect(s.settings.grid.snap).toBe(true)
  })
})

describe('membros', () => {
  it('memberUpdated muda a lista e, se for eu, o self', () => {
    const s = reduceServer(joined(ana), { t: 'memberUpdated', member: { ...ana, nickname: 'Aninha', color: '#123456' } }, 0)
    expect(s.members.p1).toMatchObject({ nickname: 'Aninha', color: '#123456' })
    expect(s.self).toMatchObject({ clientId: 'p1', nickname: 'Aninha', color: '#123456', role: 'player' })
  })

  it('memberUpdated de outra pessoa não mexe no self', () => {
    const s = reduceServer(joined(gm), { t: 'memberUpdated', member: { ...ana, nickname: 'Aninha' } }, 0)
    expect(s.self?.nickname).toBe('Mestre')
    expect(s.members.p1.nickname).toBe('Aninha')
  })

  it('memberUpdate do mestre é otimista e volta atrás no reject', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'memberUpdate', clientId: 'p1', patch: { nickname: 'Aninha' } }, { isUndo: false })
    expect(s.members.p1.nickname).toBe('Aninha')
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'not_found' }, 0)
    expect(s.members.p1.nickname).toBe('Ana')
    expect(s.toasts.at(-1)?.text).toBe('Essa pessoa não está mais na lista')
  })

  it('memberUpdate pendente volta por cima de um welcome novo', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'memberUpdate', clientId: 'p1', patch: { color: '#123456' } }, { isUndo: false })
    s = reduceServer(s, welcome(gm), 0)
    expect(s.members.p1.color).toBe('#123456')
  })
})

describe('régua', () => {
  const ruler: Presence = { kind: 'ruler', from: { x: 35, y: 35 }, to: { x: 100, y: 35 } }

  it('guarda uma régua por pessoa; rulerEnd remove', () => {
    let s = presence(joined(gm), 'p1', ruler)
    expect(s.rulers).toEqual({ p1: { from: { x: 35, y: 35 }, to: { x: 100, y: 35 } } })
    s = presence(s, 'p1', { kind: 'ruler', from: { x: 35, y: 35 }, to: { x: 200, y: 35 } })
    expect(s.rulers.p1.to).toEqual({ x: 200, y: 35 })
    s = presence(s, 'p1', { kind: 'rulerEnd' })
    expect(s.rulers).toEqual({})
  })

  it('memberLeft e memberRemoved removem a régua da pessoa', () => {
    let s = reduceServer(presence(joined(gm), 'p1', ruler), { t: 'memberLeft', clientId: 'p1' }, 0)
    expect(s.rulers).toEqual({})
    s = reduceServer(presence(s, 'p1', ruler), { t: 'memberRemoved', clientId: 'p1' }, 0)
    expect(s.rulers).toEqual({})
  })

  it('welcome (reconexão) limpa réguas, pings e pedido de câmera', () => {
    let s = presence(joined(ana), 'gm1', ruler)
    s = presence(s, 'gm1', { kind: 'ping', x: 1, y: 2, recenter: true }, 10)
    s = reduceServer(s, welcome(ana), 20)
    expect(s.rulers).toEqual({})
    expect(s.pings).toEqual([])
    expect(s.cameraTarget).toBeNull()
  })
})

describe('ping', () => {
  it('ping de outra pessoa com recenter pede a câmera; o meu e o comum não', () => {
    let s = presence(joined(ana), 'gm1', { kind: 'ping', x: 10, y: 20, recenter: true }, 1000)
    expect(s.pings).toMatchObject([{ clientId: 'gm1', x: 10, y: 20, at: 1000 }])
    expect(s.cameraTarget).toMatchObject({ x: 10, y: 20, seq: 1 })
    s = presence(s, 'p1', { kind: 'ping', x: 1, y: 1, recenter: true }, 1100)
    expect(s.cameraTarget?.seq).toBe(1)
    s = presence(s, 'gm1', { kind: 'ping', x: 3, y: 3, recenter: false }, 1200)
    expect(s.cameraTarget?.seq).toBe(1)
    expect(s.pings).toHaveLength(3)
  })

  it('pings com mais de 2 s saem da lista quando chega outro', () => {
    let s = presence(joined(ana), 'gm1', { kind: 'ping', x: 1, y: 1, recenter: false }, 0)
    s = presence(s, 'gm1', { kind: 'ping', x: 2, y: 2, recenter: false }, PING_DURATION_MS + 1)
    expect(s.pings.map((p) => p.x)).toEqual([2])
  })
})
