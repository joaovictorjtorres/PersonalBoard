import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_MAX, DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ObjectOp, type ServerMessage } from '@mesa/shared'
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
const opsSent = () => FakeSocket.all[0].sent.filter((m) => typeof m === 'object' && m.t === 'op')

function connected() {
  const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
  store.getState().actions.connect('Eu')
  FakeSocket.all[0].onopen?.({})
  FakeSocket.all[0].receive({
    t: 'welcome', self: me,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  })
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

const del = (n: number): ObjectOp[] => Array.from({ length: n }, (_, i) => ({ kind: 'delete', id: `d${i}` }))

describe('submitBatches', () => {
  it('envia um op batch por lote, sem lotes vazios', () => {
    const store = connected()
    expect(store.getState().actions.submitBatches([del(2), [], del(1)], 'Falhou')).toBe(true)
    expect(opsSent().map((m) => [m.op.kind, m.op.ops.length])).toEqual([['batch', 2], ['batch', 1]])
  })

  it('lote com mais de 200 sub-ações é recusado no navegador com aviso, sem enviar', () => {
    const store = connected()
    expect(store.getState().actions.submitBatches([del(BATCH_MAX + 1)], 'Falhou')).toBe(false)
    expect(opsSent()).toEqual([])
    expect(store.getState().toasts.at(-1)?.text).toBe('Seleção grande demais; selecione menos itens')
  })

  it('recusa do servidor mostra o aviso do lote', () => {
    const store = connected()
    store.getState().actions.submitBatches([del(1)], 'Falhou')
    FakeSocket.all[0].receive({ t: 'reject', opId: opsSent()[0].opId, reason: 'locked' })
    expect(store.getState().toasts.at(-1)?.text).toBe('Falhou')
  })
})
