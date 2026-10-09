const TUNNEL_URL_RE = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com(?![a-z0-9.-])/gi

/** Primeira URL de Quick Tunnel no texto, ignorando api.trycloudflare.com. */
export function findTunnelUrl(text) {
  for (const match of String(text).matchAll(TUNNEL_URL_RE)) {
    const sub = match[1].toLowerCase()
    if (sub === 'api') continue
    return `https://${sub}.trycloudflare.com`
  }
  return null
}
