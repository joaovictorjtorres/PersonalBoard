import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Op, ServerMessage } from '@mesa/shared'
import { SyncClient, type ConnStatus, type WebSocketLike } from '../src/sync/SyncClient'

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = []
  sent: unknown[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.onclose?.({ code: 1000 }) }
  open() { this.onopen?.({}) }
  receive(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  drop() { this.onclose?.({ code: 1006 }) }
}

const welcome: ServerMessage = {
  t: 'welcome',
  self: { clientId: 'c', nickname: 'Ana', color: '#000000', role: 'player', online: true },
  snapshot: { meta: { id: 'T', name: 'M' }, members: [], layers: [], objects: [], locks: [], notes: {} },
}
const op: Op = { kind: 'delete', id: 'x' }

let statuses: ConnStatus[]
let received: ServerMessage[]
let client: SyncClient
const last = () => FakeSocket.all[FakeSocket.all.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  statuses = []
  received = []
  client = new SyncClient({
    url: 'ws://x',
    hello: () => ({ t: 'hello', clientId: 'c', nickname: 'Ana' }),
    onMessage: (m) => received.push(m),
    onStatus: (s) => statuses.push(s),
    createSocket: (url) => new FakeSocket(url),
  })
})
afterEach(() => vi.useRealTimers())

describe('SyncClient', () => {
  it('envia hello ao abrir e só manda ops depois do welcome', () => {
    client.connect()
    last().open()
    client.sendOp('op_1', op)
    expect(last().sent).toEqual([{ t: 'hello', clientId: 'c', nickname: 'Ana' }])
    last().receive(welcome)
    expect(last().sent).toEqual([
      { t: 'hello', clientId: 'c', nickname: 'Ana' },
      { t: 'op', opId: 'op_1', op },
    ])
    expect(statuses).toEqual(['connecting', 'open'])
    expect(received[0]).toEqual(welcome)
  })

  it('reenvia apenas ops sem ack após reconectar', () => {
    client.connect()
    last().open()
    last().receive(welcome)
    client.sendOp('op_1', op)
    client.sendOp('op_2', op)
    last().receive({ t: 'ack', opId: 'op_1', version: 0 })
    last().drop()
    vi.advanceTimersByTime(1000)
    last().open()
    last().receive(welcome)
    expect(last().sent).toEqual([
      { t: 'hello', clientId: 'c', nickname: 'Ana' },
      { t: 'op', opId: 'op_2', op },
    ])
  })

  it('backoff 1s, 2s e reinicia após welcome', () => {
    client.connect()
    last().drop()
    expect(statuses.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(999)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(2)
    last().drop()
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)
    last().open()
    last().receive(welcome)
    last().drop()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(4)
  })

  it('backoff limitado a 30s', () => {
    client.connect()
    for (let i = 0; i < 10; i++) {
      last().drop()
      vi.advanceTimersByTime(30_000)
    }
    const before = FakeSocket.all.length
    last().drop()
    vi.advanceTimersByTime(29_999)
    expect(FakeSocket.all).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(before + 1)
  })

  it('error do servidor encerra sem reconectar', () => {
    client.connect()
    last().open()
    last().receive({ t: 'error', reason: 'table_not_found' })
    last().drop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(statuses.at(-1)).toBe('closed')
  })

  it('send descarta presença quando não está pronto; conta estatísticas', () => {
    client.connect()
    last().open()
    client.send({ t: 'presence', p: { kind: 'cursor', x: 1, y: 1 } })
    expect(last().sent).toHaveLength(1)
    last().receive(welcome)
    client.send({ t: 'presence', p: { kind: 'cursor', x: 1, y: 1 } })
    expect(last().sent).toHaveLength(2)
    expect(client.stats).toEqual({ sent: 2, received: 1 })
  })

  it('close() não reconecta', () => {
    client.connect()
    client.close()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(statuses.at(-1)).toBe('closed')
  })
})

/** close() does not fire onclose synchronously, like a real WebSocket. */
class AsyncCloseSocket extends FakeSocket {
  closed = false
  close() { this.closed = true }
}
const asyncClient = (): SyncClient =>
  new SyncClient({
    url: 'ws://x',
    hello: () => ({ t: 'hello', clientId: 'c', nickname: 'Ana' }),
    onMessage: (m) => received.push(m),
    onStatus: (s) => statuses.push(s),
    createSocket: (url) => new AsyncCloseSocket(url),
  })

describe('SyncClient stale sockets', () => {
  it('close() then connect(): old socket onclose does not affect the new connection', () => {
    const c = asyncClient()
    c.connect()
    const s1 = last()
    s1.open()
    s1.receive(welcome)
    c.close()
    c.connect()
    const s2 = last()
    expect(FakeSocket.all).toHaveLength(2)
    s2.open()
    s2.receive(welcome)
    s1.drop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(2)
    expect(statuses.at(-1)).toBe('open')
  })

  it('connect() twice keeps exactly one live socket and ignores the first one', () => {
    const c = asyncClient()
    c.connect()
    const s1 = last()
    c.connect()
    const s2 = last()
    expect(FakeSocket.all).toHaveLength(2)
    expect((FakeSocket.all as AsyncCloseSocket[]).filter((s) => !s.closed)).toEqual([s2])
    s1.open()
    s1.receive(welcome)
    expect(s1.sent).toEqual([])
    expect(received).toEqual([])
    expect(c.ready).toBe(false)
    s2.open()
    s2.receive(welcome)
    expect(received).toEqual([welcome])
    expect(c.ready).toBe(true)
  })
})
