import { describe, expect, it, vi } from 'vitest'
import { createPingDragGuard } from '../src/canvas/ping'

const plain = { shiftKey: false, ctrlKey: false, metaKey: false }

// Mesma sequência dos nós: mousedown -> dragstart (grab) -> dragend (commit + release).
function run(evt: typeof plain) {
  const guard = createPingDragGuard()
  const grab = vi.fn()
  const commit = vi.fn()
  const stop = vi.fn()
  guard.mouseDown(evt)
  if (!guard.dragStart(stop)) grab()
  if (!guard.dragEnd()) commit()
  return { grab, commit, stop, guard }
}

describe('createPingDragGuard', () => {
  it('clique de ping: cancela o arrasto e não envia grab, update nem release', () => {
    for (const evt of [{ ...plain, shiftKey: true }, { ...plain, ctrlKey: true }, { ...plain, metaKey: true }]) {
      const r = run(evt)
      expect(r.stop).toHaveBeenCalledOnce()
      expect(r.grab).not.toHaveBeenCalled()
      expect(r.commit).not.toHaveBeenCalled()
    }
  })

  it('arrasto normal ainda trava e confirma; a marca de ping é limpa no dragend', () => {
    const r = run(plain)
    expect(r.stop).not.toHaveBeenCalled()
    expect(r.grab).toHaveBeenCalledOnce()
    expect(r.commit).toHaveBeenCalledOnce()
    const g = createPingDragGuard()
    g.mouseDown({ ...plain, shiftKey: true })
    g.dragEnd()
    g.mouseDown(plain)
    expect(g.dragStart(() => {})).toBe(false)
  })
})
