import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  type ClientMessage,
  type HelloMessage,
  type Op,
  type ServerMessage,
} from '@mesa/shared'

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface WebSocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
}

export interface SyncClientOptions {
  url: string
  hello: () => HelloMessage
  onMessage: (msg: ServerMessage) => void
  onStatus: (status: ConnStatus) => void
  createSocket?: (url: string) => WebSocketLike
}

const MAX_BACKOFF_MS = 30_000

export class SyncClient {
  readonly stats = { sent: 0, received: 0 }
  private ws: WebSocketLike | null = null
  private pending = new Map<string, Extract<ClientMessage, { t: 'op' }>>()
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private isReady = false
  private stopped = false

  constructor(private opts: SyncClientOptions) {}

  get ready(): boolean {
    return this.isReady
  }

  connect(): void {
    this.stopped = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.detachSocket(1000, 'replaced')
    this.open('connecting')
  }

  close(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.detachSocket(1000, 'bye')
    this.opts.onStatus('closed')
  }

  /** Drops the current socket: stale callbacks are ignored once it is detached. */
  private detachSocket(code: number, reason: string): void {
    this.stopHeartbeat()
    const ws = this.ws
    this.ws = null
    this.isReady = false
    if (ws) ws.close(code, reason)
  }

  sendOp(opId: string, op: Op): void {
    const msg = { t: 'op' as const, opId, op }
    this.pending.set(opId, msg)
    if (this.isReady) this.raw(msg)
  }

  send(msg: ClientMessage): void {
    if (this.isReady) this.raw(msg)
  }

  private open(status: ConnStatus): void {
    this.opts.onStatus(status)
    const create = this.opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike)
    const ws = create(this.opts.url)
    this.ws = ws
    this.isReady = false
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.startHeartbeat(ws)
      this.raw(this.opts.hello())
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      this.clearPongTimer()
      if (typeof ev.data !== 'string' || ev.data === 'pong') return
      this.stats.received++
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data) as ServerMessage
      } catch {
        return
      }
      this.handle(msg)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.handleClose()
    }
  }

  private startHeartbeat(ws: WebSocketLike): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      if (this.ws !== ws) return
      try {
        ws.send('ping')
      } catch {
        // socket fechando; o onclose cuida
      }
      if (!this.pongTimer) this.pongTimer = setTimeout(() => this.onHeartbeatTimeout(ws), HEARTBEAT_TIMEOUT_MS)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.clearPongTimer()
  }

  private clearPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.pongTimer = null
  }

  // Conexão "zumbi": não espera o close do navegador (pode demorar minutos) — solta e reconecta já.
  private onHeartbeatTimeout(ws: WebSocketLike): void {
    this.pongTimer = null
    if (this.ws !== ws) return
    this.stopHeartbeat()
    this.ws = null
    try {
      ws.close(4000, 'heartbeat_timeout')
    } catch {
      // ignora
    }
    this.handleClose()
  }

  private handle(msg: ServerMessage): void {
    if (msg.t === 'welcome') {
      this.isReady = true
      this.attempt = 0
      this.opts.onMessage(msg)
      this.opts.onStatus('open')
      for (const op of this.pending.values()) this.raw(op)
      return
    }
    if (msg.t === 'ack' || msg.t === 'reject') this.pending.delete(msg.opId)
    if (msg.t === 'error') this.stopped = true
    this.opts.onMessage(msg)
  }

  private handleClose(): void {
    this.stopHeartbeat()
    this.ws = null
    this.isReady = false
    if (this.stopped) {
      this.opts.onStatus('closed')
      return
    }
    const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS)
    this.attempt++
    this.opts.onStatus('reconnecting')
    this.timer = setTimeout(() => {
      this.timer = null
      this.open('reconnecting')
    }, delay)
  }

  private raw(msg: ClientMessage): void {
    if (!this.ws) return
    this.ws.send(JSON.stringify(msg))
    this.stats.sent++
  }
}
