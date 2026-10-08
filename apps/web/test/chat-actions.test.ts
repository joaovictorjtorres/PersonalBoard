import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ServerMessage } from '@mesa/shared'
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

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const bia: Member = { clientId: 'bia', nickname: 'Bia', color: '#3cb44b', role: 'player', online: true }
const welcome: ServerMessage = {
  t: 'welcome',
  self: me,
  snapshot: { meta: { id: 'T', name: 'M' }, members: [me, bia], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
}

const chatSent = () => FakeSocket.all[0].sent.filter((m) => typeof m === 'object' && ['chatSend', 'roll', 'chatImage'].includes(m.t))

function connected() {
  const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
  store.getState().actions.connect('Eu')
  FakeSocket.all[0].onopen?.({})
  FakeSocket.all[0].receive(welcome)
  return store
}

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

describe('ações de chat', () => {
  it('texto simples envia chatSend na aba ativa e registra o pedido', () => {
    const store = connected()
    expect(store.getState().status).toBe('open')
    expect(store.getState().actions.sendChatText('  oi  ')).toBe(true)
    const [m] = chatSent()
    expect(m).toMatchObject({ t: 'chatSend', channel: 'table', text: 'oi' })
    expect(store.getState().chatPending[m.reqId]).toBe('table')
  })

  it('/r 2d6+3 envia uma rolagem com o pedido interpretado, no canal da aba ativa', () => {
    const store = connected()
    store.getState().actions.openDm('bia')
    expect(store.getState().actions.sendChatText('/r 2d6+3')).toBe(true)
    const [m] = chatSent()
    expect(m).toMatchObject({ t: 'roll', channel: { dm: 'bia' }, secret: false, request: { die: 6, count: 2, bonus: 3, mode: 'normal' } })
    expect(store.getState().chatPending[m.reqId]).toEqual({ dm: 'bia' })
  })

  it('/r xx mostra o aviso e não envia nada', () => {
    const store = connected()
    expect(store.getState().actions.sendChatText('/r xx')).toBe(false)
    expect(store.getState().toasts.at(-1)?.text).toBe('Fórmula inválida — ex.: /r 2d6+3')
    expect(chatSent()).toEqual([])
  })

  it('texto vazio não envia', () => {
    const store = connected()
    expect(store.getState().actions.sendChatText('   ')).toBe(false)
    expect(chatSent()).toEqual([])
  })

  it('sendRoll: secret só vale na Mesa; na conversa privada vai como false', () => {
    const store = connected()
    const request = { die: 20, count: 1, bonus: 0, mode: 'normal' } as const
    store.getState().actions.sendRoll(request, true)
    store.getState().actions.openDm('bia')
    store.getState().actions.sendRoll(request, true)
    const [a, b] = chatSent()
    expect(a).toMatchObject({ channel: 'table', secret: true })
    expect(b).toMatchObject({ channel: { dm: 'bia' }, secret: false })
  })

  it('sem conexão: avisa e não envia', async () => {
    const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
    expect(store.getState().actions.sendChatText('oi')).toBe(false)
    expect(store.getState().actions.sendRoll({ die: 20, count: 1, bonus: 0, mode: 'normal' }, false)).toBe(false)
    await store.getState().actions.sendChatImage(new Blob(['x'], { type: 'image/gif' }))
    expect(store.getState().toasts.at(-1)?.text).toBe('Sem conexão — aguarde reconectar')
    expect(store.getState().chatPending).toEqual({})
    expect(FakeSocket.all).toEqual([])
  })
})
