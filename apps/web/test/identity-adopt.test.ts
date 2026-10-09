import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ServerMessage } from '@mesa/shared'
import type { WebSocketLike } from '../src/sync/SyncClient'
import { createTableStore } from '../src/store/tableStore'
import { getClientId, getTableClientId } from '../src/lib/identity'

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

const old: Member = { clientId: 'old-id', nickname: 'Ana', color: '#e6194b', role: 'player', online: true }
const welcome = (self: Member, clientSecret?: string): ServerMessage => ({
  t: 'welcome',
  self,
  snapshot: { meta: { id: 'T', name: 'M' }, members: [self], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  ...(clientSecret ? { clientSecret } : {}),
})
const hello = (i: number) => FakeSocket.all[i].sent.find((m) => m.t === 'hello')

let mem: Map<string, string>
beforeEach(() => {
  FakeSocket.all = []
  mem = new Map()
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('membro assumido', () => {
  it('welcome com outro clientId: grava id e segredo desta mesa; a próxima conexão usa os dois; outras mesas seguem com o id global', () => {
    const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
    store.getState().actions.connect('Ana')
    FakeSocket.all[0].onopen?.({})
    expect(hello(0).clientId).toBe(getClientId())
    FakeSocket.all[0].receive(welcome(old, 's'.repeat(43)))
    expect(store.getState().self?.clientId).toBe('old-id')
    expect(mem.get('mesa:clientId:T')).toBe('old-id')

    store.getState().actions.connect('Ana')
    FakeSocket.all[1].onopen?.({})
    expect(hello(1)).toMatchObject({ clientId: 'old-id', clientSecret: 's'.repeat(43) })
    expect(getTableClientId('U')).toBe(getClientId())
  })

  it('nickname_taken vira fatal; um novo connect limpa o fatal antes de tentar de novo', () => {
    const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
    store.getState().actions.connect('Ana')
    FakeSocket.all[0].onopen?.({})
    FakeSocket.all[0].receive({ t: 'error', reason: 'nickname_taken' })
    expect(store.getState().fatal).toBe('nickname_taken')
    store.getState().actions.connect('Bia')
    expect(store.getState().fatal).toBeNull()
  })
})
