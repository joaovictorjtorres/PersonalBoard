const CLIENT_KEY = 'mesa:clientId'
const NICK_KEY = 'mesa:nickname'
const gmKey = (tableId: string) => `mesa:gm:${tableId}`

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // modo privado/armazenamento bloqueado: segue só em memória
  }
}

// crypto.randomUUID só existe em contexto seguro (https/localhost);
// acesso por IP de VPN em http cai neste fallback.
function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

let memoryClientId: string | null = null

export function getClientId(): string {
  const stored = safeGet(CLIENT_KEY)
  if (stored) return stored
  memoryClientId ??= uuidV4()
  safeSet(CLIENT_KEY, memoryClientId)
  return memoryClientId
}

export function getNickname(): string | null {
  return safeGet(NICK_KEY)
}

export function setNickname(nickname: string): void {
  safeSet(NICK_KEY, nickname)
}

export function rememberGmSecret(tableId: string, secret: string): void {
  safeSet(gmKey(tableId), secret)
}

// fallback em memória quando o localStorage está bloqueado (o hash já foi removido)
const memoryGm = new Map<string, string>()

export function readGmSecret(tableId: string): string | undefined {
  const match = /(?:^#|&)gm=([^&]+)/.exec(window.location.hash)
  if (match) {
    rememberGmSecret(tableId, match[1])
    memoryGm.set(tableId, match[1])
    // tira o segredo da barra de endereço (histórico, screenshots, compartilhamento)
    try {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    } catch {
      // ignora
    }
    return match[1]
  }
  return safeGet(gmKey(tableId)) ?? memoryGm.get(tableId)
}

const secretKey = (tableId: string) => `mesa:secret:${tableId}`
// fallback em memória quando o localStorage está bloqueado
const memorySecrets = new Map<string, string>()

export function readClientSecret(tableId: string): string | undefined {
  return safeGet(secretKey(tableId)) ?? memorySecrets.get(tableId)
}

export function rememberClientSecret(tableId: string, secret: string): void {
  memorySecrets.set(tableId, secret)
  safeSet(secretKey(tableId), secret)
}

/**
 * Duas abas entrando pela primeira vez ao mesmo tempo: a segunda é recusada porque a
 * primeira já adotou um segredo. Se o armazenamento passou a ter um segredo diferente
 * do que esta aba enviou, vale tentar de novo — uma vez só.
 */
export function shouldRetryAuth(sentSecret: string | undefined, storedSecret: string | undefined, alreadyRetried: boolean): boolean {
  return !alreadyRetried && !!storedSecret && storedSecret !== sentSecret
}
