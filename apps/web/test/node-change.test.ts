import { describe, expect, it, vi } from 'vitest'
import type Konva from 'konva'
import { commitNodeChange } from '../src/canvas/nodeChange'
import type { TableStore } from '../src/store/tableStore'

function fakeNode(x: number, y: number) {
  const node = {
    x: () => node.pos.x,
    y: () => node.pos.y,
    pos: { x, y },
    width: () => 100,
    height: () => 100,
    scaleX: () => 1,
    scaleY: () => 1,
    rotation: () => 0,
    position: vi.fn((p: { x: number; y: number }) => void (node.pos = p)),
    scale: vi.fn(),
    size: vi.fn(),
  }
  return node
}

function setup(type: 'image' | 'stroke' | 'shape', snap: boolean) {
  const submit = vi.fn(() => true)
  const state = {
    objects: { a: { id: 'a', type, x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
    deniedGrabs: {},
    settings: { grid: { enabled: true, size: 70, snap } },
    actions: { submit, release: vi.fn(), clearDenied: vi.fn() },
  }
  return { store: { getState: () => state } as unknown as TableStore, submit }
}

describe('commitNodeChange com encaixe', () => {
  it('imagem solta na grade é encaixada (patch e nó)', () => {
    const { store, submit } = setup('image', true)
    const node = fakeNode(80, 100)
    commitNodeChange(store, 'a', node as unknown as Konva.Node, 'drag')
    expect(submit).toHaveBeenCalledWith({ kind: 'update', id: 'a', patch: { x: 70, y: 70 } })
    expect(node.pos).toEqual({ x: 70, y: 70 })
  })

  it('traço e forma não são encaixados', () => {
    for (const type of ['stroke', 'shape'] as const) {
      const { store, submit } = setup(type, true)
      commitNodeChange(store, 'a', fakeNode(80, 100) as unknown as Konva.Node, 'drag')
      expect(submit).toHaveBeenCalledWith({ kind: 'update', id: 'a', patch: { x: 80, y: 100 } })
    }
  })

  it('com encaixe desligado nada muda', () => {
    const { store, submit } = setup('image', false)
    commitNodeChange(store, 'a', fakeNode(80, 100) as unknown as Konva.Node, 'drag')
    expect(submit).toHaveBeenCalledWith({ kind: 'update', id: 'a', patch: { x: 80, y: 100 } })
  })
})
