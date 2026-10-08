import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttle } from '../src/lib/throttle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('throttle', () => {
  it('primeira chamada é imediata; seguintes viram uma chamada final com últimos args', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t(1)
    t(2)
    t(3)
    expect(fn.mock.calls).toEqual([[1]])
    vi.advanceTimersByTime(100)
    expect(fn.mock.calls).toEqual([[1], [3]])
  })

  it('flush executa pendente na hora; cancel descarta', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t('a')
    t('b')
    t.flush()
    expect(fn.mock.calls).toEqual([['a'], ['b']])
    t('c')
    t.cancel()
    vi.advanceTimersByTime(200)
    expect(fn.mock.calls).toEqual([['a'], ['b']])
  })
})
