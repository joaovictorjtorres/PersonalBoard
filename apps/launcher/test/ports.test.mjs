import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { PORT_FIRST, PORT_LAST, isPortFree, pickPort } from '../src/ports.mjs'

const freeOnly = (...ports) => async (p) => ports.includes(p)

describe('pickPort', () => {
  it('usa 8787 quando está livre', async () => {
    expect(await pickPort(freeOnly(8787, 8788))).toBe(8787)
  })

  it('pula as ocupadas e para em 8797', async () => {
    const asked = []
    const isFree = async (p) => { asked.push(p); return p === 8790 }
    expect(await pickPort(isFree)).toBe(8790)
    expect(asked).toEqual([8787, 8788, 8789, 8790])
    expect(await pickPort(freeOnly(8798))).toBeNull()
    expect([PORT_FIRST, PORT_LAST]).toEqual([8787, 8797])
  })

  it('--port força a porta: livre → ela; ocupada → null', async () => {
    expect(await pickPort(freeOnly(9000), { forced: 9000 })).toBe(9000)
    expect(await pickPort(freeOnly(8787), { forced: 9000 })).toBeNull()
  })

  it('isPortFree enxerga uma porta em uso de verdade (porta efêmera, nunca 8787)', async () => {
    const server = net.createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    expect(await isPortFree(port)).toBe(false)
    await new Promise((resolve) => server.close(resolve))
    expect(await isPortFree(port)).toBe(true)
  })
})
