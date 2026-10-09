import { DurableObject } from 'cloudflare:workers'
import {
  CHAT_RATE_PER_SEC,
  ClientMessageSchema,
  DEFAULT_LAYERS,
  PING_RATE_PER_SEC,
  RULER_RATE_PER_SEC,
  readChatReqId,
  readOpId,
  type ChatMessage,
  type ChatRejectReason,
  type ClientMessage,
  type Role,
  type ServerMessage,
  type TableObject,
} from '@mesa/shared'
import { TableEngine, type ChatBody, type LayerChange, type OpEffect } from './engine/engine'
import { SqlStore } from './engine/sql-store'
import { randomSecret, safeEqual, sha256Hex } from './crypto'
import { RateLimiter } from './rate-limit'

interface Attachment {
  sessionId: string
  clientId: string
  role: Role
}

type Msg<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>

function chatBody(msg: ChatMessage): ChatBody {
  switch (msg.t) {
    case 'chatSend':
      return { kind: 'message', text: msg.text }
    case 'chatImage':
      return { kind: 'image', assetKey: msg.assetKey, width: msg.width, height: msg.height }
    case 'roll':
      return { kind: 'roll', request: msg.request, secret: msg.secret }
  }
}

export class TableDO extends DurableObject<Env> {
  private store: SqlStore
  private engine: TableEngine
  private strokeLayers = new Map<string, string>()
  // Limites por pessoa (clientId), só em memória.
  private chatLimiter = new RateLimiter(CHAT_RATE_PER_SEC, 1000)
  private pingLimiter = new RateLimiter(PING_RATE_PER_SEC, 1000)
  private rulerLimiter = new RateLimiter(RULER_RATE_PER_SEC, 1000)

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new SqlStore(ctx.storage.sql)
    this.engine = new TableEngine(this.store)
    // Heartbeat: responde sem acordar o DO da hibernação.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/init' && request.method === 'POST') {
      if (this.store.getMeta()) return new Response('exists', { status: 409 })
      const body = await request.json<{ id: string; name: string; gmSecretHash: string }>()
      this.store.initTable({ ...body, createdAt: Date.now() }, DEFAULT_LAYERS)
      return new Response(null, { status: 201 })
    }

    if (url.pathname === '/exists') {
      return new Response(null, { status: this.store.getMeta() ? 204 : 404 })
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.ctx.acceptWebSocket(server)
      if (!this.store.getMeta()) {
        this.send(server, { t: 'error', reason: 'table_not_found' })
        server.close(4404, 'table_not_found')
      }
      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('not found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return
    }
    const att = this.attachment(ws)
    const parsed = ClientMessageSchema.safeParse(json)
    if (!parsed.success) {
      const opId = readOpId(json)
      const reqId = readChatReqId(json)
      if (opId && att) this.send(ws, { t: 'reject', opId, reason: 'invalid' })
      else if (reqId && att) this.send(ws, { t: 'chatReject', reqId, reason: 'invalid' })
      else console.warn('mensagem inválida', parsed.error.issues[0]?.message)
      return
    }
    const msg = parsed.data
    if (msg.t === 'hello') {
      if (!att) await this.onHello(ws, msg)
      return
    }
    if (!att) return
    switch (msg.t) {
      case 'op': return this.onOp(ws, att, msg)
      case 'grab': return this.onGrab(ws, att, msg)
      case 'release': return this.onRelease(att, msg)
      case 'presence': return this.onPresence(att, msg)
      case 'chatSend':
      case 'chatImage':
      case 'roll':
        return this.onChat(ws, att, msg)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.onDisconnect(ws)
    try {
      ws.close(1000, 'bye')
    } catch {
      // já fechado
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onDisconnect(ws)
  }

  // Regras do clientSecret: Task 4 (inalteradas aqui).
  private async onHello(ws: WebSocket, msg: Msg<'hello'>): Promise<void> {
    const meta = this.store.getMeta()
    if (!meta) return
    let role: Role = 'player'
    if (msg.gmSecret && safeEqual(await sha256Hex(msg.gmSecret), meta.gmSecretHash)) role = 'gm'
    // Todos os awaits antes de ler o membro: ler-decidir-gravar fica atômico no DO.
    const providedHash = msg.clientSecret ? await sha256Hex(msg.clientSecret) : null
    const candidate = randomSecret()
    const candidateHash = await sha256Hex(candidate)

    const existing = this.store.getMember(msg.clientId)
    // Cliente M1 (sem v:2) não guarda segredo: admitido sem emitir hash, para não se trancar fora.
    const m2 = msg.v === 2
    let issued: string | undefined
    if (existing?.secretHash) {
      const ok = providedHash !== null && safeEqual(providedHash, existing.secretHash)
      if (!ok) {
        if (role !== 'gm') {
          this.send(ws, { t: 'error', reason: 'auth' })
          ws.close(4401, 'auth')
          return
        }
        // O link do mestre já prova a identidade de mestre: recupera e rotaciona o segredo.
        if (m2) issued = candidate
      }
    } else if (m2) {
      issued = candidate // membro novo ou do M1 sem hash: trust-on-first-use
    }

    const online = this.onlineClientIds()
    const member = this.engine.join(
      { clientId: msg.clientId, nickname: msg.nickname, role, ...(issued ? { secretHash: candidateHash } : {}) },
      online,
    )
    const att: Attachment = { sessionId: crypto.randomUUID(), clientId: msg.clientId, role }
    ws.serializeAttachment(att)
    online.add(msg.clientId)
    this.send(ws, {
      t: 'welcome',
      self: member,
      snapshot: this.engine.snapshot(role, online, msg.clientId),
      ...(issued ? { clientSecret: issued } : {}),
    })
    this.broadcast(att.sessionId, () => ({ t: 'memberJoined', member }))
  }

  private onOp(ws: WebSocket, att: Attachment, msg: Msg<'op'>): void {
    const res = this.engine.applyOp(att.clientId, att.role, msg.opId, msg.op, this.onlineClientIds())
    if (!res.ok) {
      this.send(ws, { t: 'reject', opId: msg.opId, reason: res.reason, current: res.current })
      return
    }
    this.send(ws, { t: 'ack', opId: msg.opId, version: res.version })
    if (res.duplicate) return
    for (const effect of res.effects) this.broadcastEffect(att, effect)
  }

  private broadcastEffect(author: Attachment, effect: OpEffect): void {
    switch (effect.kind) {
      case 'object': {
        const { before, after } = effect
        // Com `echo` (encaixe na grade) o autor também recebe: o `ack` não traz a posição corrigida.
        this.broadcast(effect.echo ? null : author.sessionId, (other) => {
          if (after && this.engine.canSeeObject(other.role, after)) {
            return { t: 'op', by: author.clientId, op: { kind: 'upsert', object: after } }
          }
          if (before && this.engine.canSeeObject(other.role, before)) {
            return { t: 'op', by: author.clientId, op: { kind: 'delete', id: before.id } }
          }
          return null
        })
        return
      }
      case 'layers':
        for (const change of effect.changes) this.broadcastLayerChange(author.sessionId, change)
        return
      case 'layerRemoved': {
        const { layer } = effect
        this.broadcast(author.sessionId, (other) =>
          other.role === 'gm' || layer.visibility === 'all' ? { t: 'layerRemoved', id: layer.id } : null,
        )
        return
      }
      case 'note':
        this.broadcast(author.sessionId, (other) =>
          other.role === 'gm' ? { t: 'noteSet', objectId: effect.objectId, text: effect.text } : null,
        )
        return
      case 'memberRemoved':
        this.broadcast(author.sessionId, () => ({ t: 'memberRemoved', clientId: effect.clientId }))
        return
      case 'released':
        this.broadcastReleased(effect.objectId, effect.clientId)
        return
      case 'settings':
        this.broadcast(null, () => ({ t: 'settingsUpdated', settings: effect.settings }))
        return
      case 'memberUpdated':
        this.broadcast(null, () => ({ t: 'memberUpdated', member: effect.member }))
        return
      case 'objectsRemoved': {
        // O autor também recebe: a lista do servidor é a definitiva (o cliente só estimou).
        this.broadcast(null, (other) => {
          const ids = effect.objects.filter((o) => this.engine.canSeeObject(other.role, o)).map((o) => o.id)
          return ids.length > 0 ? { t: 'objectsRemoved', ids, by: author.clientId } : null
        })
        return
      }
    }
  }

  // Jogadores só enxergam camadas com visibility 'all'; o mestre recebe tudo.
  private broadcastLayerChange(excludeSessionId: string, { before, after }: LayerChange): void {
    const wasVisible = before?.visibility === 'all'
    const isVisible = after.visibility === 'all'
    let shownObjects: TableObject[] | null = null
    this.broadcast(excludeSessionId, (other) => {
      if (other.role === 'gm') return { t: 'layerUpsert', layer: after }
      if (isVisible && (wasVisible || before === null)) return { t: 'layerUpsert', layer: after }
      if (isVisible) {
        shownObjects ??= this.store.listObjects().filter((o) => o.layerId === after.id)
        return { t: 'layerShown', layer: after, objects: shownObjects }
      }
      if (wasVisible) return { t: 'layerHidden', id: after.id }
      return null
    })
  }

  private onGrab(ws: WebSocket, att: Attachment, msg: Msg<'grab'>): void {
    if (!this.engine.grab(att.clientId, att.role, msg.objectId)) {
      this.send(ws, { t: 'grabDenied', objectId: msg.objectId })
      return
    }
    const object = this.store.getObject(msg.objectId)!
    this.broadcast(null, (other) =>
      this.engine.canSeeObject(other.role, object) ? { t: 'grabbed', objectId: msg.objectId, clientId: att.clientId } : null,
    )
  }

  private onRelease(att: Attachment, msg: Msg<'release'>): void {
    if (!this.engine.release(att.clientId, msg.objectId)) return
    this.broadcastReleased(msg.objectId, att.clientId)
  }

  private onChat(ws: WebSocket, att: Attachment, msg: ChatMessage): void {
    const fail = (reason: ChatRejectReason) => this.send(ws, { t: 'chatReject', reqId: msg.reqId, reason })
    const dm = msg.channel === 'table' ? null : msg.channel.dm
    if (dm === att.clientId) return fail('invalid')
    if (!this.chatLimiter.allow(att.clientId)) return fail('rate_limited')
    if (dm !== null && !this.onlineClientIds().has(dm)) return fail('not_found')

    const entry = this.engine.chatEntry(att.clientId, chatBody(msg))
    this.send(ws, { t: 'chatAck', reqId: msg.reqId })
    if (dm === null) {
      this.engine.appendTableChat(entry)
      this.broadcast(null, (other) =>
        this.engine.canSeeChat(other.clientId, other.role, entry) ? { t: 'chat', channel: 'table', entry } : null,
      )
      return
    }
    // Conversa privada: só retransmite, nunca grava; `dm` aponta sempre para a outra pessoa.
    this.broadcast(null, (other) => {
      if (other.clientId === att.clientId) return { t: 'chat', channel: { dm }, entry }
      if (other.clientId === dm) return { t: 'chat', channel: { dm: att.clientId }, entry }
      return null
    })
  }

  private onPresence(att: Attachment, msg: Msg<'presence'>): void {
    const p = msg.p
    const out = { t: 'presence' as const, clientId: att.clientId, p }
    switch (p.kind) {
      case 'cursor':
        this.broadcast(att.sessionId, () => out)
        return
      case 'strokeEnd': {
        const layerId = this.strokeLayers.get(p.strokeId)
        this.strokeLayers.delete(p.strokeId)
        this.broadcast(att.sessionId, (other) =>
          (layerId ? this.engine.canSeeLayer(other.role, layerId) : other.role === 'gm') ? out : null,
        )
        return
      }
      case 'drag': {
        if (!this.engine.touchLock(att.clientId, p.objectId)) return
        const object = this.store.getObject(p.objectId)
        if (!object) return
        this.broadcast(att.sessionId, (other) => (this.engine.canSeeObject(other.role, object) ? out : null))
        return
      }
      case 'stroke':
        if (!this.engine.canEditLayer(att.role, p.layerId)) return
        this.strokeLayers.set(p.strokeId, p.layerId)
        this.broadcast(att.sessionId, (other) => (this.engine.canSeeLayer(other.role, p.layerId) ? out : null))
        return
      case 'ruler':
        // Cada mensagem traz a régua inteira (até 32 pontos): descartar excesso não perde estado.
        if (!this.rulerLimiter.allow(att.clientId)) return
        this.broadcast(att.sessionId, () => out)
        return
      case 'rulerEnd':
        this.broadcast(att.sessionId, () => out)
        return
      case 'ping': {
        if (!this.pingLimiter.allow(att.clientId)) return
        // Só o mestre centraliza a tela dos outros; de jogador vira ping comum.
        const ping: ServerMessage = { t: 'presence', clientId: att.clientId, p: { ...p, recenter: p.recenter && att.role === 'gm' } }
        this.broadcast(null, () => ping)
        return
      }
    }
  }

  private onDisconnect(ws: WebSocket): void {
    const att = this.attachment(ws)
    if (!att) return
    ws.serializeAttachment(null)
    const stillOnline = this.ctx.getWebSockets().some((other) => {
      const o = this.attachment(other)
      return !!o && o.sessionId !== att.sessionId && o.clientId === att.clientId
    })
    if (stillOnline) return
    for (const objectId of this.engine.releaseAll(att.clientId)) this.broadcastReleased(objectId, att.clientId)
    this.engine.touchMember(att.clientId)
    this.broadcast(att.sessionId, () => ({ t: 'memberLeft', clientId: att.clientId }))
  }

  private broadcastReleased(objectId: string, clientId: string): void {
    const object = this.store.getObject(objectId)
    this.broadcast(null, (other) =>
      !object || this.engine.canSeeObject(other.role, object) ? { t: 'released', objectId, clientId } : null,
    )
  }

  private attachment(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null
  }

  private onlineClientIds(): Set<string> {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws)
      if (att) ids.add(att.clientId)
    }
    return ids
  }

  private broadcast(excludeSessionId: string | null, build: (other: Attachment) => ServerMessage | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws)
      if (!att || att.sessionId === excludeSessionId) continue
      const msg = build(att)
      if (msg) this.send(ws, msg)
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // socket fechando; o close handler cuida do resto
    }
  }
}
