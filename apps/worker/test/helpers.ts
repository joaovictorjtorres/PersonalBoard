import { exports } from 'cloudflare:workers'
import { expect } from 'vitest'
import type { ClientMessage, NewObject, ServerMessage } from '@mesa/shared'

const SELF = exports.default
const BASE = 'https://mesa.test'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function createTable(name = 'Teste'): Promise<{ tableId: string; gmSecret: string }> {
  const res = await SELF.fetch(`${BASE}/api/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  expect(res.status).toBe(201)
  return res.json()
}

export function tokenObject(over: Partial<NewObject> = {}): NewObject {
  return {
    id: `tok_${crypto.randomUUID().slice(0, 8)}`,
    type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
    x: 10, y: 20, width: 70, height: 70, rotation: 0, zIndex: 1,
    ...over,
  } as NewObject
}

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>

export class TestClient {
  readonly messages: ServerMessage[] = []
  private consumed = new Set<number>()

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      this.messages.push(JSON.parse(e.data as string) as ServerMessage)
    })
  }

  static async connect(tableId: string): Promise<TestClient> {
    const res = await SELF.fetch(`${BASE}/api/tables/${tableId}/ws`, { headers: { Upgrade: 'websocket' } })
    const ws = res.webSocket
    if (!ws) throw new Error(`no websocket (status ${res.status})`)
    ws.accept()
    return new TestClient(ws)
  }

  send(msg: ClientMessage | string): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  async hello(nickname: string, opts: { clientId?: string; gmSecret?: string; clientSecret?: string } = {}) {
    const clientId = opts.clientId ?? crypto.randomUUID()
    this.send({
      t: 'hello',
      clientId,
      nickname,
      ...(opts.gmSecret ? { gmSecret: opts.gmSecret } : {}),
      ...(opts.clientSecret ? { clientSecret: opts.clientSecret } : {}),
    })
    const welcome = await this.waitFor('welcome')
    return { clientId, welcome }
  }

  async waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true): Promise<Msg<T>> {
    for (let i = 0; i < 200; i++) {
      const index = this.messages.findIndex((m, idx) => !this.consumed.has(idx) && m.t === t && pred(m as Msg<T>))
      if (index !== -1) {
        this.consumed.add(index)
        return this.messages[index] as Msg<T>
      }
      await sleep(10)
    }
    throw new Error(`timeout esperando ${t}`)
  }

  async expectNone<T extends ServerMessage['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, ms = 300): Promise<void> {
    await sleep(ms)
    const found = this.messages.some((m, idx) => !this.consumed.has(idx) && m.t === t && pred(m as Msg<T>))
    expect(found, `não esperava ${t}`).toBe(false)
  }

  close(): void {
    this.ws.close(1000, 'test')
  }
}
