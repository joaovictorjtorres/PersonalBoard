const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1'])
/** Cabeçalhos que só a borda da Cloudflare (e o cloudflared) põem; o wrangler local não cria nenhum deles. */
const EDGE_HEADERS = ['cf-ray', 'cf-visitor', 'cf-ipcountry', 'cdn-loop', 'cf-warp-tag-id']

/**
 * Pedido feito no próprio PC, direto no servidor (não pelo túnel). O wrangler local põe
 * `cf-connecting-ip: 127.0.0.1` e mantém o que vier de fora; o hostname de `request.url` vem do Host.
 */
export function isLocalRequest(request: Request): boolean {
  if (!LOOPBACK_HOSTS.has(new URL(request.url).hostname)) return false
  if (EDGE_HEADERS.some((h) => request.headers.has(h))) return false
  // Um site qualquer aberto no navegador do mestre também fala com localhost: o Origin dele denuncia.
  const origin = request.headers.get('origin')
  if (origin !== null && !isLoopbackOrigin(origin)) return false
  const ip = request.headers.get('cf-connecting-ip')
  return ip === null || LOOPBACK_IPS.has(ip)
}

function isLoopbackOrigin(origin: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(origin).hostname)
  } catch {
    return false // inclui "null" (iframe isolado, file://)
  }
}

/**
 * Pedido que muda estado precisa vir com corpo JSON: assim, de outro site, o navegador exige um
 * preflight CORS, que nunca autorizamos (não há cabeçalhos CORS nas respostas).
 */
export function isJsonRequest(request: Request): boolean {
  const type = request.headers.get('content-type')
  return type !== null && type.split(';')[0].trim().toLowerCase() === 'application/json'
}
