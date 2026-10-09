import { describe, expect, it } from 'vitest'
import Konva from 'konva'
import { sortObjectNodes } from '../src/canvas/lift'

const ids = (g: Konva.Group) => g.children.map((c) => c.id() || c.name())

describe('sortObjectNodes', () => {
  it('põe os objetos na ordem da store, nos lugares que já ocupavam; título e Transformer ficam onde estão', () => {
    const g = new Konva.Group()
    // "novo" inserido no lugar errado (o vizinho estava levantado); depois dos objetos, um título e o Transformer.
    for (const id of ['novo', 'a', 'b']) g.add(new Konva.Rect({ id }))
    g.add(new Konva.Group({ name: 'titulo' }), new Konva.Rect({ name: 'transformer' }))
    const rank = new Map([['a', 0], ['b', 1], ['novo', 2]])
    expect(sortObjectNodes(g, rank)).toBe(true)
    expect(ids(g)).toEqual(['a', 'b', 'novo', 'titulo', 'transformer'])
    expect(g.children.map((c) => c.index)).toEqual([0, 1, 2, 3, 4])
    expect(sortObjectNodes(g, rank)).toBe(false)
  })

  it('ignora nós que não são objetos da camada', () => {
    const g = new Konva.Group()
    g.add(new Konva.Rect({ id: 'b' }), new Konva.Rect({ name: 'previa' }), new Konva.Rect({ id: 'a' }))
    sortObjectNodes(g, new Map([['a', 0], ['b', 1]]))
    expect(ids(g)).toEqual(['a', 'previa', 'b'])
  })
})
