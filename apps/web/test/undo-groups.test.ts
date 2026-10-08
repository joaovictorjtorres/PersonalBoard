import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type TableObject } from '@mesa/shared'
import { addToast, reduceServer, reduceSubmit, reduceSubmitBatch } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const stroke = (id: string): TableObject => ({
  id, type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 0, rotation: 0, zIndex: 1,
  segments: [[0, 0, 10, 0]], color: '#ffffff', strokeWidth: 3,
  ownerId: 'me', version: 1, updatedBy: 'me', control: { mode: 'list', clientIds: ['me'] },
})

function joined(): TableState {
  return reduceServer(
    makeInitialState(),
    {
      t: 'welcome',
      self: me,
      snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects: [stroke('a'), stroke('b')], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
    },
    0,
  )
}

const batch = (s: TableState) =>
  reduceSubmitBatch(
    s,
    [
      { opId: 'op_a', op: { kind: 'update', id: 'a', patch: { x: 5 } } },
      { opId: 'op_b', op: { kind: 'delete', id: 'b' } },
    ],
    { isUndo: false, groupId: 'g1' },
  )

describe('desfazer em grupo', () => {
  it('o lote vira um grupo quando todas as ops são confirmadas, com inversas em ordem reversa', () => {
    let s = batch(joined())
    expect(s.objects.a.x).toBe(5)
    expect(s.objects.b).toBeUndefined()
    s = reduceServer(s, { t: 'ack', opId: 'op_a', version: 2 }, 0)
    expect(s.undoStack).toEqual([])
    s = reduceServer(s, { t: 'ack', opId: 'op_b', version: 0 }, 0)
    expect(s.undoStack).toEqual([
      [
        { kind: 'create', object: expect.objectContaining({ id: 'b', segments: [[0, 0, 10, 0]] }) },
        { kind: 'update', id: 'a', patch: { x: 0 } },
      ],
    ])
    expect(s.undoGroups).toEqual({})
  })

  it('op recusada no lote: as confirmadas entram mesmo assim', () => {
    let s = batch(joined())
    s = reduceServer(s, { t: 'reject', opId: 'op_b', reason: 'locked', current: stroke('b') }, 0)
    s = reduceServer(s, { t: 'ack', opId: 'op_a', version: 2 }, 0)
    expect(s.undoStack).toEqual([[{ kind: 'update', id: 'a', patch: { x: 0 } }]])
    expect(s.objects.b).toBeDefined()
  })

  it('lote todo recusado não empilha grupo vazio', () => {
    let s = batch(joined())
    s = reduceServer(s, { t: 'reject', opId: 'op_a', reason: 'locked', current: stroke('a') }, 0)
    s = reduceServer(s, { t: 'reject', opId: 'op_b', reason: 'locked', current: stroke('b') }, 0)
    expect(s.undoStack).toEqual([])
  })

  it('ops de desfazer não criam grupo', () => {
    const s = reduceSubmitBatch(joined(), [{ opId: 'op_u', op: { kind: 'delete', id: 'a' } }], { isUndo: true, groupId: 'gu' })
    expect(s.undoGroups).toEqual({})
    expect(reduceServer(s, { t: 'ack', opId: 'op_u', version: 0 }, 0).undoStack).toEqual([])
  })

  it('guarda no máximo 50 grupos', () => {
    let s = joined()
    for (let i = 0; i < 51; i++) {
      s = reduceSubmit(s, `op_${i}`, { kind: 'update', id: 'a', patch: { x: i } }, { isUndo: false })
      s = reduceServer(s, { t: 'ack', opId: `op_${i}`, version: i + 2 }, 0)
    }
    expect(s.undoStack).toHaveLength(50)
    expect(s.undoStack.at(-1)).toEqual([{ kind: 'update', id: 'a', patch: { x: 49 } }])
  })

  // Review Focus #4
  it('desfazer com várias ops recusadas mostra um único toast', () => {
    let s = reduceSubmitBatch(
      joined(),
      [
        { opId: 'op_1', op: { kind: 'delete', id: 'a' } },
        { opId: 'op_2', op: { kind: 'update', id: 'b', patch: { x: 9 } } },
        { opId: 'op_3', op: { kind: 'update', id: 'a', patch: { y: 9 } } },
      ],
      { isUndo: true, groupId: 'gu' },
    )
    s = reduceServer(s, { t: 'reject', opId: 'op_2', reason: 'locked', current: stroke('b') }, 0)
    s = reduceServer(s, { t: 'reject', opId: 'op_3', reason: 'not_found', current: null }, 0)
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 0 }, 0)
    expect(s.toasts.map((t) => t.text)).toEqual(['Não foi possível desfazer'])
  })

  it('addToast não repete texto igual sem ação', () => {
    let s = addToast(joined(), 'Sem permissão nessa camada')
    s = addToast(s, 'Sem permissão nessa camada')
    expect(s.toasts).toHaveLength(1)
  })
})
