import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, DEFAULT_TURNS, TURNS_MAX, type Member, type ServerMessage, type TableObject, type Turns } from '@mesa/shared'
import type { WebSocketLike } from '../src/sync/SyncClient'
import { createTableStore } from '../src/store/tableStore'

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = []
  sent: any[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) { this.sent.push(data === 'ping' ? 'ping' : JSON.parse(data)) }
  close() { this.onclose?.({ code: 1000 }) }
  receive(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

const me: Member = { clientId: 'me', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const base = {
  type: 'image' as const, layerId: 'tokens', assetKey: 'a'.repeat(64), x: 100, y: 200, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'me', version: 1, updatedBy: 'me', control: { mode: 'list' as const, clientIds: ['me'] },
}
const orc = { ...base, id: 't1', title: 'Orc' } as TableObject
const untitled = { ...base, id: 't2' } as TableObject

function connected(turns: Turns = DEFAULT_TURNS) {
  const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
  store.getState().actions.connect('Mestre')
  FakeSocket.all[0].onopen?.({})
  FakeSocket.all[0].receive({
    t: 'welcome',
    self: me,
    snapshot: {
      meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS, objects: [orc, untitled], locks: [], notes: {},
      settings: DEFAULT_SETTINGS, chat: [], turns,
    },
  })
  return store
}

const opsSent = () => FakeSocket.all[0].sent.filter((m) => typeof m === 'object' && m.t === 'op').map((m) => m.op)

beforeEach(() => {
  FakeSocket.all = []
  const mem = new Map<string, string>()
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('ações de turno da store', () => {
  it('adicionar token com a janela fechada: turnAdd com o título e turnsOpen; aparece na hora', () => {
    const store = connected()
    store.getState().actions.addTokenToTurns('t1')
    expect(opsSent()).toEqual([
      { kind: 'turnAdd', entry: { id: expect.any(String), name: 'Orc', tokenId: 't1' } },
      { kind: 'turnsOpen', open: true },
    ])
    expect(store.getState().turns).toMatchObject({ open: true, entries: [{ name: 'Orc', tokenId: 't1', initiative: null }] })
  })

  it('janela já aberta: só o turnAdd; token sem título vira "Token"', () => {
    const store = connected({ ...DEFAULT_TURNS, open: true })
    store.getState().actions.addTokenToTurns('t2')
    expect(opsSent()).toEqual([{ kind: 'turnAdd', entry: { id: expect.any(String), name: 'Token', tokenId: 't2' } }])
  })

  it('ordem cheia: avisa e não envia', () => {
    const entries = Array.from({ length: TURNS_MAX }, (_, i) => ({ id: `e${i}`, name: `E${i}`, tokenId: null, initiative: null }))
    const store = connected({ ...DEFAULT_TURNS, open: true, entries })
    store.getState().actions.addTokenToTurns('t1')
    expect(opsSent()).toEqual([])
    expect(store.getState().toasts.at(-1)?.text).toBe('A ordem de turnos está cheia (máximo 50)')
  })

  it('focusObject pede à câmera o centro do token; setTurnHover guarda o token destacado', () => {
    const store = connected()
    store.getState().actions.focusObject('t1')
    expect(store.getState().cameraTarget).toMatchObject({ x: 135, y: 235 })
    store.getState().actions.setTurnHover('t1')
    expect(store.getState().turnHover).toBe('t1')
    store.getState().actions.setTurnHover(null)
    expect(store.getState().turnHover).toBeNull()
  })
})
