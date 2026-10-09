import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Layer, type Member, type Op, type ServerMessage, type TableObject } from '@mesa/shared'
import { pickActiveLayer, pruneUndoStack, reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const gm: Member = { clientId: 'gm1', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const ana: Member = { clientId: 'p1', nickname: 'Ana', color: '#3cb44b', role: 'player', online: true }
const own = (id: string) => ({ ownerId: id, updatedBy: id, version: 1, control: { mode: 'list' as const, clientIds: [id] } })
const box = { x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1 }
const stroke = (id: string, layerId: string, owner: string): TableObject =>
  ({ ...box, ...own(owner), id, layerId, type: 'stroke', segments: [[0, 0, 1, 1]], color: '#ffffff', strokeWidth: 2 }) as TableObject
const image = (id: string, layerId: string, owner: string): TableObject =>
  ({ ...box, ...own(owner), id, layerId, type: 'image', assetKey: 'a'.repeat(64) }) as TableObject

const PUBLIC = DEFAULT_LAYERS.filter((l) => l.id !== 'gm')
function joined(self: Member, layers: Layer[], objects: TableObject[]): TableState {
  const welcome: ServerMessage = {
    t: 'welcome',
    self,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [gm, ana], layers, objects, locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  }
  return reduceServer(makeInitialState(), welcome, 0)
}
const objs = [stroke('mine', 'drawings', 'p1'), stroke('mine2', 'tokens', 'p1'), stroke('other', 'drawings', 'p2'), image('img', 'drawings', 'p1')]
const keys = (s: TableState) => Object.keys(s.objects).sort()

describe('clearObjects no cliente', () => {
  it('otimista: tira só os meus desenhos; não entra na pilha de desfazer; ack confirma', () => {
    let s = joined(ana, PUBLIC, objs)
    s = reduceSubmit(s, 'c1', { kind: 'clearObjects', layerId: null, authorId: 'p1', scope: 'drawings' }, { isUndo: false })
    expect(keys(s)).toEqual(['img', 'other'])
    s = reduceServer(s, { t: 'ack', opId: 'c1', version: 0 }, 0)
    expect(s.undoStack).toEqual([])
    expect(s.pending).toEqual({})
  })

  it('recusa devolve os objetos apagados e avisa', () => {
    let s = { ...joined(ana, PUBLIC, objs), selectedId: 'mine' }
    s = reduceSubmit(s, 'c1', { kind: 'clearObjects', layerId: 'drawings', authorId: 'p1', scope: 'drawings' }, { isUndo: false })
    expect(keys(s)).toEqual(['img', 'mine2', 'other'])
    expect(s.selectedId).toBeNull()
    s = reduceServer(s, { t: 'reject', opId: 'c1', reason: 'forbidden' }, 0)
    expect(keys(s)).toEqual(['img', 'mine', 'mine2', 'other'])
    expect(s.toasts.at(-1)?.text).toBe('Sem permissão para apagar nessa camada')
  })

  it('objectsRemoved do servidor apaga, solta travas e limpa a pilha de desfazer que apontava para eles', () => {
    let s = joined(gm, DEFAULT_LAYERS, objs)
    s = reduceServer(s, { t: 'grabbed', objectId: 'other', clientId: 'p2' }, 0)
    s = { ...s, undoStack: [[{ kind: 'update', id: 'other', patch: { x: 1 } }], [{ kind: 'delete', id: 'img' }]] }
    s = reduceServer(s, { t: 'objectsRemoved', ids: ['other', 'mine'], by: 'gm1' }, 0)
    expect(keys(s)).toEqual(['img', 'mine2'])
    expect(s.locks).toEqual({})
    expect(s.undoStack).toEqual([[{ kind: 'delete', id: 'img' }]])
  })

  it('reconexão com limpeza pendente: o snapshot não traz de volta o que apaguei', () => {
    let s = joined(ana, PUBLIC, objs)
    s = reduceSubmit(s, 'c1', { kind: 'clearObjects', layerId: null, authorId: 'p1', scope: 'drawings' }, { isUndo: false })
    s = reduceServer(s, { t: 'welcome', self: ana, snapshot: { meta: { id: 'T', name: 'M' }, members: [ana], layers: PUBLIC, objects: objs, locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] } }, 0)
    expect(keys(s)).toEqual(['img', 'other'])
  })
})

describe('pruneUndoStack', () => {
  it('mantém a mesma pilha quando nada aponta para os apagados', () => {
    const stack: Op[][] = [[{ kind: 'delete', id: 'a' }]]
    expect(pruneUndoStack(stack, new Set(['b']))).toBe(stack)
  })
})

describe('camada ativa', () => {
  const L = (id: string, order: number, over: Partial<Layer> = {}): Layer => ({ id, name: id, order, visibility: 'all', locked: false, ...over })

  it('travada para o jogador: vai para a permitida mais próxima; o mestre fica', () => {
    const layers = [L('a', 0), L('b', 1, { locked: true }), L('c', 2), L('d', 3)]
    expect(pickActiveLayer(layers, layers, 'b', 'player')).toBe('c')
    expect(pickActiveLayer(layers, layers, 'b', 'gm')).toBe('b')
    const lower = [L('a', 0), L('b', 1), L('c', 2, { locked: true }), L('d', 3, { locked: true }), L('e', 4, { locked: true })]
    expect(pickActiveLayer(lower, lower, 'd', 'player')).toBe('b')
  })

  it('ocultada (sumiu da lista do jogador): vizinha mais próxima pela posição antiga', () => {
    const prev = [L('a', 0), L('b', 1), L('c', 2), L('d', 3)]
    const next = prev.filter((l) => l.id !== 'd')
    expect(pickActiveLayer(prev, next, 'd', 'player')).toBe('c')
  })

  it('travar a camada ativa do jogador muda a ativa dele ao receber layerUpsert', () => {
    let s = { ...joined(ana, PUBLIC, []), activeLayerId: 'tokens' }
    s = reduceServer(s, { t: 'layerUpsert', layer: { ...DEFAULT_LAYERS.find((l) => l.id === 'tokens')!, locked: true } }, 0)
    expect(s.activeLayerId).toBe('drawings')
  })
})
