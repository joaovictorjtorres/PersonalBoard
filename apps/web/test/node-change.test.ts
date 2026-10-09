import { describe, expect, it, vi } from 'vitest'
import type Konva from 'konva'
import { cancelNodeDrag, commitNodeChange } from '../src/canvas/nodeChange'
import { createTableStore, type TableStore } from '../src/store/tableStore'

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
    objects: { a: { id: 'a', type, layerId: 'tokens', x: 0, y: 0, width: 100, height: 100, rotation: 0 } },
    deniedGrabs: {},
    settings: { grid: { enabled: true, size: 70, snap } },
    actions: { submit, release: vi.fn(), clearDenied: vi.fn(), nextZ: (layerId: string) => (layerId === 'tokens' ? 8 : -1) },
  }
  return { store: { getState: () => state } as unknown as TableStore, submit }
}

describe('commitNodeChange com encaixe', () => {
  it('imagem solta na grade é encaixada (patch e nó)', () => {
    const { store, submit } = setup('image', true)
    const node = fakeNode(80, 100)
    commitNodeChange(store, 'a', node as unknown as Konva.Node, 'drag')
    expect(submit).toHaveBeenCalledWith({ kind: 'update', id: 'a', patch: { x: 70, y: 70, zIndex: 8 } })
    expect(node.pos).toEqual({ x: 70, y: 70 })
  })

  it('traço e forma não são encaixados', () => {
    for (const type of ['stroke', 'shape'] as const) {
      const { store, submit } = setup(type, true)
      commitNodeChange(store, 'a', fakeNode(80, 100) as unknown as Konva.Node, 'drag')
      expect(submit).toHaveBeenCalledWith({ kind: 'update', id: 'a', patch: { x: 80, y: 100, zIndex: 8 } })
    }
  })

  it('com encaixe desligado nada muda', () => {
    const { store, submit } = setup('image', false)
    commitNodeChange(store, 'a', fakeNode(80, 100) as unknown as Konva.Node, 'drag')
    expect(submit).toHaveBeenCalledWith({ kind: 'update', id: 'a', patch: { x: 80, y: 100, zIndex: 8 } })
  })
})

describe('ordem ao soltar', () => {
  it('redimensionar não muda a ordem (sem zIndex no patch)', () => {
    const { store, submit } = setup('shape', false)
    commitNodeChange(store, 'a', fakeNode(80, 100) as unknown as Konva.Node, 'transform')
    expect(submit).toHaveBeenCalledWith({ kind: 'update', id: 'a', patch: { x: 80, y: 100, width: 100, height: 100, rotation: 0 } })
  })

  it('Esc (cancelNodeDrag): o nó volta para o lugar, nada é enviado e a trava é solta', () => {
    const { store, submit } = setup('image', false)
    const node = fakeNode(80, 100)
    cancelNodeDrag(store, 'a', node as unknown as Konva.Node)
    expect(node.pos).toEqual({ x: 0, y: 0 })
    expect(submit).not.toHaveBeenCalled()
    expect(store.getState().actions.release).toHaveBeenCalledWith('a')
  })
})

describe('prévia local do arrasto (título/ícones seguem o nó)', () => {
  const g = { x: 10, y: 20, width: 70, height: 70, rotation: 0 }

  it('cada movimento atualiza a prévia; soltar (release) apaga', () => {
    const store = createTableStore('T')
    const { actions } = store.getState()
    actions.dragPreview('a', g)
    actions.dragPreview('a', { ...g, x: 15 })
    expect(store.getState().ownDragPreviews).toEqual({ a: { ...g, x: 15 } })
    actions.release('a')
    expect(store.getState().ownDragPreviews).toEqual({})
  })

  it('startDrag marca o objeto que eu arrasto; endDrag de outro id não mexe', () => {
    const store = createTableStore('T')
    const { actions } = store.getState()
    actions.startDrag('a')
    expect(store.getState().draggingId).toBe('a')
    actions.endDrag('b')
    expect(store.getState().draggingId).toBe('a')
    actions.endDrag('a')
    expect(store.getState().draggingId).toBeNull()
  })

  it('arrasto negado (clearDenied) também apaga', () => {
    const store = createTableStore('T')
    store.getState().actions.dragPreview('a', g)
    store.getState().actions.dragPreview('b', g)
    store.getState().actions.clearDenied('a')
    expect(store.getState().ownDragPreviews).toEqual({ b: g })
  })
})
