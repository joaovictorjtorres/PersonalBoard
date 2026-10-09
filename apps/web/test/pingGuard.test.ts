import { describe, expect, it, vi } from 'vitest'
import { createPingDragGuard } from '../src/canvas/ping'

const plain = { shiftKey: false, ctrlKey: false, metaKey: false, pointerType: 'mouse', button: 0, buttons: 1 }

// Mesma sequência dos nós. `stop` imita o Konva: stopDrag() dispara dragend de forma síncrona.
function drag(guard: ReturnType<typeof createPingDragGuard>, evt: typeof plain) {
  const grab = vi.fn()
  const commit = vi.fn()
  const release = vi.fn()
  const onEnd = () => {
    if (!guard.dragEnd()) {
      commit()
      release()
    }
  }
  const stop = vi.fn(onEnd)
  guard.pointerDown(evt)
  if (!guard.dragStart(stop)) grab()
  onEnd() // dragend real (ou espúrio) ao soltar
  return { grab, commit, release, stop }
}

describe('createPingDragGuard', () => {
  it('clique de ping: cancela o arrasto e não envia grab, update nem release', () => {
    const guard = createPingDragGuard()
    for (const evt of [{ ...plain, shiftKey: true }, { ...plain, ctrlKey: true }, { ...plain, metaKey: true }]) {
      const r = drag(guard, evt)
      expect(r.stop).toHaveBeenCalledOnce()
      expect(r.grab).not.toHaveBeenCalled()
      expect(r.commit).not.toHaveBeenCalled()
      expect(r.release).not.toHaveBeenCalled()
    }
  })

  it('arrasto normal depois de um ping ainda trava, confirma e libera', () => {
    const guard = createPingDragGuard()
    drag(guard, { ...plain, shiftKey: true })
    const r = drag(guard, plain)
    expect(r.stop).not.toHaveBeenCalled()
    expect(r.grab).toHaveBeenCalledOnce()
    expect(r.commit).toHaveBeenCalledOnce()
    expect(r.release).toHaveBeenCalledOnce()
  })

  it('ponta de borracha da caneta: nunca arrasta o objeto', () => {
    const guard = createPingDragGuard()
    for (const evt of [{ ...plain, pointerType: 'pen', button: 5, buttons: 32 }, { ...plain, pointerType: 'pen', button: 0, buttons: 32 }]) {
      const r = drag(guard, evt)
      expect(r.stop).toHaveBeenCalledOnce()
      expect(r.grab).not.toHaveBeenCalled()
      expect(r.commit).not.toHaveBeenCalled()
    }
  })
})
