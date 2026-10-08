import { describe, expect, it } from 'vitest'
import { RateLimiter } from '../src/rate-limit'

describe('RateLimiter', () => {
  it('permite N por janela, por chave, e libera quando a janela passa', () => {
    let t = 0
    const limiter = new RateLimiter(3, 1000, () => t)
    expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([true, true, true, false])
    expect(limiter.allow('b')).toBe(true)
    t = 999
    expect(limiter.allow('a')).toBe(false)
    t = 1000
    expect(limiter.allow('a')).toBe(true)
  })

  it('tentativas recusadas não contam', () => {
    let t = 0
    const limiter = new RateLimiter(1, 1000, () => t)
    expect(limiter.allow('a')).toBe(true)
    t = 500
    expect(limiter.allow('a')).toBe(false)
    t = 1000
    expect(limiter.allow('a')).toBe(true)
  })
})
