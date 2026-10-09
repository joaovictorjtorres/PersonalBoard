export const PIPE_NAME = '\\\\.\\pipe\\MesaVirtual'
/** Teto para pegar o lock: nunca segura a abertura da mesa por mais que isso. */
export const LOCK_TIMEOUT_MS = 3_000

/** @param {() => void} fn @param {number} ms @returns {() => void} */
function realTimer(fn, ms) {
  const t = setTimeout(fn, ms)
  t.unref?.()
  return () => clearTimeout(t)
}

/**
 * Impede duas janelas da mesa ao mesmo tempo: escuta num named pipe (Windows).
 * Só EADDRINUSE (pipe já tem dono) dá `ok: false`; qualquer outro erro, exceção ou demora acima de
 * `timeoutMs` libera a abertura (`ok: true`, sem lock) — o lock nunca pode travar a mesa.
 * `deps.net` e `deps.pipePath` são injetáveis; sem pipe ou sem net vira no-op.
 * @param {{ net?: any, pipePath?: string, platform?: string }} deps
 * @param {{ timeoutMs?: number, setTimer?: (fn: () => void, ms: number) => () => void }} [opts]
 * @returns {Promise<{ ok: boolean, close(): void }>}
 */
export function acquireInstanceLock(deps, { timeoutMs = LOCK_TIMEOUT_MS, setTimer = realTimer } = {}) {
  const pipePath = deps.pipePath ?? (deps.platform === 'win32' ? PIPE_NAME : null)
  const none = { ok: true, close() {} }
  if (!pipePath || !deps.net) return Promise.resolve(none)
  return new Promise((resolve) => {
    /** @type {any} */
    let server
    let settled = false
    let cancel = () => {}
    const closeServer = () => {
      try {
        server?.close()
      } catch {
        /* ignora */
      }
    }
    /** @param {{ ok: boolean, close(): void }} result */
    const settle = (result) => {
      if (settled) return false
      settled = true
      cancel()
      resolve(result)
      return true
    }
    try {
      server = deps.net.createServer()
      server.on('error', (/** @type {any} */ err) => {
        if (err?.code === 'EADDRINUSE') settle({ ok: false, close() {} })
        else if (settle(none)) closeServer()
      })
      server.unref?.()
      const ms = Number.isFinite(timeoutMs) ? Math.min(Math.max(0, timeoutMs), LOCK_TIMEOUT_MS) : LOCK_TIMEOUT_MS
      cancel = setTimer(() => {
        // demorou demais: segue sem lock e desiste do pipe
        if (settle(none)) closeServer()
      }, ms)
      server.listen(pipePath, () => {
        if (!settle({ ok: true, close: closeServer })) closeServer() // chegou depois do timeout
      })
    } catch {
      if (settle(none)) closeServer()
    }
  })
}
