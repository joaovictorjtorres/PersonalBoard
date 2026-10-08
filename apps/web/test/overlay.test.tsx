import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('react-dom', () => ({ createPortal: (children: unknown, container: unknown) => ({ children, container }) }))

import { guardDropEvent, guardFileEvent, OverlayPortal } from '../src/ui/OverlayPortal'
import { isNearBottom, shouldAutoScroll } from '../src/ui/chat/format'

afterEach(() => vi.unstubAllGlobals())

describe('OverlayPortal', () => {
  it('renderiza em document.body', () => {
    const body = { tag: 'body' }
    vi.stubGlobal('document', { body })
    const out = OverlayPortal({ children: null }) as unknown as { container: unknown }
    expect(out.container).toBe(body)
  })
  it('guardas param a propagação e impedem o navegador de abrir arquivos soltos', () => {
    const e = { stopPropagation: vi.fn(), preventDefault: vi.fn() }
    guardFileEvent(e)
    expect(e.stopPropagation).toHaveBeenCalledOnce()
    expect(e.preventDefault).not.toHaveBeenCalled()
    guardDropEvent(e)
    expect(e.stopPropagation).toHaveBeenCalledTimes(2)
    expect(e.preventDefault).toHaveBeenCalledOnce()
  })
})

describe('autoscroll do chat', () => {
  it('isNearBottom usa 40px de tolerância', () => {
    expect(isNearBottom(1000, 560, 400)).toBe(true) // 40px do fim
    expect(isNearBottom(1000, 559, 400)).toBe(false)
    expect(isNearBottom(300, 0, 400)).toBe(true) // sem rolagem
  })
  it('rola só se estava perto do fim ou a entrada é minha', () => {
    expect(shouldAutoScroll(true, false)).toBe(true)
    expect(shouldAutoScroll(false, false)).toBe(false)
    expect(shouldAutoScroll(false, true)).toBe(true)
  })
})
