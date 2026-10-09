export const PIPE_NAME = '\\\\.\\pipe\\MesaVirtual'

/**
 * Impede duas janelas da mesa ao mesmo tempo: escuta num named pipe (Windows).
 * `deps.net` e `deps.pipePath` são injetáveis; sem pipe ou sem net vira no-op.
 * @returns {Promise<{ ok: boolean, close(): void }>}
 */
export function acquireInstanceLock(deps) {
  const pipePath = deps.pipePath ?? (deps.platform === 'win32' ? PIPE_NAME : null)
  const none = { ok: true, close() {} }
  if (!pipePath || !deps.net) return Promise.resolve(none)
  return new Promise((resolve) => {
    let server
    try {
      server = deps.net.createServer()
    } catch {
      resolve(none)
      return
    }
    server.on('error', (err) => {
      resolve(err?.code === 'EADDRINUSE' ? { ok: false, close() {} } : none)
    })
    try {
      server.listen(pipePath, () => {
        server.unref?.()
        resolve({ ok: true, close: () => { try { server.close() } catch { /* ignora */ } } })
      })
    } catch {
      resolve(none)
    }
  })
}
