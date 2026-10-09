import net from 'node:net'

export const PORT_FIRST = 8787
export const PORT_LAST = 8797
export const INSPECTOR_FIRST = 9229
export const INSPECTOR_LAST = 9239

/**
 * @param {(port: number) => Promise<boolean>} isFree
 * @param {{ forced?: number, first?: number, last?: number }} [options]
 * @returns {Promise<number | null>}
 */
export async function pickPort(isFree, { forced, first = PORT_FIRST, last = PORT_LAST } = {}) {
  if (forced !== undefined) return (await isFree(forced)) ? forced : null
  for (let port = first; port <= last; port++) {
    if (await isFree(port)) return port
  }
  return null
}

/** Livre = ninguém aceita conexão em host:port E dá para escutar em host:port. */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    let settled = false
    const tryListen = () => {
      if (settled) return
      settled = true
      socket.destroy()
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
    }
    socket.setTimeout(500)
    socket.once('connect', () => {
      settled = true
      socket.destroy()
      resolve(false)
    })
    socket.once('error', tryListen)
    socket.once('timeout', tryListen)
  })
}
