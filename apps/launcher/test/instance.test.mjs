import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import { LOCK_TIMEOUT_MS, acquireInstanceLock } from '../src/instance.mjs'

/** net falso: `behavior` decide o que o listen faz (nada, sucesso, erro ou exceção). */
function fakeNet(behavior) {
  const servers = []
  return {
    servers,
    createServer() {
      const s = new EventEmitter()
      Object.assign(s, {
        closed: 0,
        unrefed: false,
        listen(_path, cb) {
          if (behavior === 'listen') queueMicrotask(cb)
          else if (behavior === 'throw') throw new Error('listen explodiu')
          else if (behavior !== 'hang') queueMicrotask(() => s.emit('error', Object.assign(new Error(behavior), { code: behavior })))
        },
        close() { s.closed++ },
        unref() { s.unrefed = true },
      })
      servers.push(s)
      return s
    },
  }
}

/** timer manual: guarda o pedido; `fire()` dispara. */
function manualTimer() {
  const t = { ms: /** @type {number | null} */ (null), fn: /** @type {null | (() => void)} */ (null), cancelled: false }
  return {
    t,
    setTimer(fn, ms) {
      t.fn = fn
      t.ms = ms
      return () => { t.cancelled = true }
    },
  }
}

const deps = (net) => ({ net, pipePath: '\\\\.\\pipe\\mesa-test', platform: 'win32' })

describe('acquireInstanceLock', () => {
  it('listen nunca responde: o timeout libera a abertura (ok, sem lock) e fecha o servidor', async () => {
    const net = fakeNet('hang')
    const { t, setTimer } = manualTimer()
    const p = acquireInstanceLock(deps(net), { setTimer })
    expect(t.ms).toBe(LOCK_TIMEOUT_MS)
    expect(LOCK_TIMEOUT_MS).toBeLessThanOrEqual(3_000)
    t.fn?.()
    const lock = await p
    expect(lock.ok).toBe(true)
    expect(net.servers[0].closed).toBe(1)
    expect(net.servers[0].unrefed).toBe(true)
  })

  it('timeout pedido acima do teto (ou inválido) vira o teto de 3 s', async () => {
    for (const timeoutMs of [60_000, Number.NaN, Infinity, -5]) {
      const { t, setTimer } = manualTimer()
      const p = acquireInstanceLock(deps(fakeNet('hang')), { timeoutMs, setTimer })
      expect(t.ms).toBe(timeoutMs === -5 ? 0 : LOCK_TIMEOUT_MS)
      t.fn?.()
      expect((await p).ok).toBe(true)
    }
  })

  it('timeout real (curto) com listen pendurado não trava', async () => {
    const t0 = Date.now()
    const lock = await acquireInstanceLock(deps(fakeNet('hang')), { timeoutMs: 20 })
    expect(lock.ok).toBe(true)
    expect(Date.now() - t0).toBeLessThan(2_000)
  })

  it('EADDRINUSE → ok: false; cancela o timer', async () => {
    const { t, setTimer } = manualTimer()
    const lock = await acquireInstanceLock(deps(fakeNet('EADDRINUSE')), { setTimer })
    expect(lock.ok).toBe(false)
    expect(t.cancelled).toBe(true)
  })

  it('outro erro de listen (EACCES) ou exceção → segue sem lock, sem travar', async () => {
    for (const behavior of ['EACCES', 'throw']) {
      const net = fakeNet(behavior)
      const { t, setTimer } = manualTimer()
      const lock = await acquireInstanceLock(deps(net), { setTimer })
      expect(lock.ok).toBe(true)
      expect(t.cancelled || behavior === 'throw').toBe(true)
      expect(net.servers[0].closed).toBe(1)
    }
  })

  it('sucesso: ok, close fecha o servidor; listen depois do timeout fecha na hora', async () => {
    const net = fakeNet('listen')
    const { t, setTimer } = manualTimer()
    const lock = await acquireInstanceLock(deps(net), { setTimer })
    expect(lock.ok).toBe(true)
    expect(t.cancelled).toBe(true)
    lock.close()
    expect(net.servers[0].closed).toBe(1)

    const late = fakeNet('listen')
    const m = manualTimer()
    const p = acquireInstanceLock(deps(late), { setTimer: m.setTimer })
    m.t.fn?.() // timeout antes do listen
    expect((await p).ok).toBe(true)
    await new Promise((r) => setImmediate(r))
    expect(late.servers[0].closed).toBe(2) // uma no timeout, outra quando o listen chegou atrasado
  })

  it('createServer que lança → no-op', async () => {
    const lock = await acquireInstanceLock({ net: { createServer() { throw new Error('x') } }, pipePath: 'p' })
    expect(lock.ok).toBe(true)
  })
})
