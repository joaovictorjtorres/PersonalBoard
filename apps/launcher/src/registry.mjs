export const TUNNEL_REPORT_INTERVAL_MS = 30_000

/** Informa ao servidor local o endereço do túnel (null = sem túnel). Nunca lança; true = servidor aceitou. */
export async function reportTunnel(deps, port, url) {
  try {
    const res = await deps.fetch(`http://127.0.0.1:${port}/api/registry/tunnel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(5_000),
    })
    await res.body?.cancel?.()
    return res.status === 204
  } catch {
    return false
  }
}

/** Chama `fn` a cada `ms` (deps.setTimer é de disparo único). Devolve a função que para. */
export function repeatEvery(deps, ms, fn) {
  let stopped = false
  let cancel = () => {}
  const schedule = () => {
    cancel = deps.setTimer(() => {
      if (stopped) return
      fn()
      schedule()
    }, ms)
  }
  schedule()
  return () => {
    stopped = true
    cancel()
  }
}
