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

const tableClientKey = (tableId: string) => `mesa:clientId:${tableId}`
// fallback em memória quando o localStorage está bloqueado
const memoryTableClient = new Map<string, string>()

/** Id do membro nesta mesa: o assumido (apelido ou link de mestre) ou, sem ele, o id global do navegador. */
export function getTableClientId(tableId: string): string {
  return memoryTableClient.get(tableId) ?? safeGet(tableClientKey(tableId)) ?? getClientId()
}

export function rememberTableClientId(tableId: string, clientId: string): void {
  memoryTableClient.set(tableId, clientId)
  safeSet(tableClientKey(tableId), clientId)
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

// fallback em memória quando o localStorage está bloqueado (o fragmento já foi removido)
const memoryGm = new Map<string, string>()
const keyKey = (tableId: string) => `mesa:key:${tableId}`
const memoryKeys = new Map<string, string>()

/** Lê `#gm=` e `#j=` numa passada, guarda por mesa e tira o fragmento da barra (histórico, prints, compartilhamento). */
function captureLinkSecrets(tableId: string): void {
  const hash = typeof window === 'undefined' ? '' : (window.location.hash ?? '')
  const gm = /(?:^#|&)gm=([^&]+)/.exec(hash)?.[1]
  const key = /(?:^#|&)j=([^&]+)/.exec(hash)?.[1]
  if (!gm && !key) return
  if (gm) {
    rememberGmSecret(tableId, gm)
    memoryGm.set(tableId, gm)
  }
  if (key) {
    memoryKeys.set(tableId, key)
    safeSet(keyKey(tableId), key)
  }
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    // ignora
  }
}

export function readGmSecret(tableId: string): string | undefined {
  captureLinkSecrets(tableId)
  return memoryGm.get(tableId) ?? safeGet(gmKey(tableId)) ?? undefined
}

/** Chave do link de jogador desta mesa (do link aberto agora ou guardada de antes). */
export function readPlayerKey(tableId: string): string | undefined {
  captureLinkSecrets(tableId)
  return memoryKeys.get(tableId) ?? safeGet(keyKey(tableId)) ?? undefined
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
