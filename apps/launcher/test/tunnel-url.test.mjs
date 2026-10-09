import { describe, expect, it } from 'vitest'
import { findTunnelUrl } from '../src/tunnel-url.mjs'

describe('findTunnelUrl', () => {
  it('acha a URL na caixa que o cloudflared imprime', () => {
    const line = '2026-10-08T12:00:00Z INF |  https://brave-otter-quiet.trycloudflare.com                              |'
    expect(findTunnelUrl(line)).toBe('https://brave-otter-quiet.trycloudflare.com')
  })

  it('ignora o endereço da API do trycloudflare (linha de erro)', () => {
    expect(findTunnelUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": EOF')).toBeNull()
    expect(
      findTunnelUrl('Post "https://api.trycloudflare.com/tunnel" … depois https://ok-tunnel.trycloudflare.com'),
    ).toBe('https://ok-tunnel.trycloudflare.com')
  })

  it('normaliza para minúsculas e ignora outros domínios', () => {
    expect(findTunnelUrl('HTTPS://ABC-Def.TryCloudflare.com')).toBe('https://abc-def.trycloudflare.com')
    expect(findTunnelUrl('Requesting new quick Tunnel on trycloudflare.com...')).toBeNull()
    expect(findTunnelUrl('https://evil.trycloudflare.com.example.org')).toBeNull()
    expect(findTunnelUrl('')).toBeNull()
  })
})
