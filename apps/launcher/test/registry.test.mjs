import { describe, expect, it } from 'vitest'
import { TUNNEL_REPORT_INTERVAL_MS, repeatEvery, reportTunnel } from '../src/registry.mjs'

describe('reportTunnel', () => {
  it('POST local com o endereço; 204 = aceito; servidor fora do ar não lança', async () => {
    const calls = []
    const deps = { fetch: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }) } }
    expect(await reportTunnel(deps, 8790, 'https://abc.trycloudflare.com')).toBe(true)
    expect(calls[0].url).toBe('http://127.0.0.1:8790/api/registry/tunnel')
    expect(calls[0].init.method).toBe('POST')
    expect(calls[0].init.headers['Content-Type']).toBe('application/json')
    expect(JSON.parse(calls[0].init.body)).toEqual({ url: 'https://abc.trycloudflare.com' })
    expect(await reportTunnel({ fetch: async () => { throw new TypeError('fetch failed') } }, 8790, null)).toBe(false)
  })
})

describe('repeatEvery', () => {
  it('repete a cada intervalo até parar', () => {
    const timers = []
    const deps = { setTimer: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true } } }
    let n = 0
    const stop = repeatEvery(deps, TUNNEL_REPORT_INTERVAL_MS, () => n++)
    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(30_000)
    timers[0].fn()
    timers[1].fn()
    expect(n).toBe(2)
    stop()
    expect(timers[2].cancelled).toBe(true)
    timers[2].fn()
    expect(n).toBe(2)
  })
})
