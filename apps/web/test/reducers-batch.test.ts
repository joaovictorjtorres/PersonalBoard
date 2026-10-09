import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ObjectOp, type TableObject } from '@mesa/shared'
import { pruneUndoStack, reduceServer, reduceSubmit, reduceSubmitBatch } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'
import { applyLocalOp } from '../src/store/localOps'

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const gm: Member = { ...me, clientId: 'gm1', nickname: 'Mestre', role: 'gm' }
const server = (owner: string) => ({ ownerId: owner, version: 1, updatedBy: owner, control: { mode: 'list' as const, clientIds: [owner] } })
const stroke = (id: string, owner = 'me'): TableObject =>
  ({
    id, type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 0, rotation: 0, zIndex: 1,
    segments: [[0, 0, 10, 0]], color: '#ffffff', strokeWidth: 3, ...server(owner),
  }) as TableObject
const image = (id: string, owner = 'me'): TableObject =>
  ({
    id, type: 'image', layerId: 'drawings', assetKey: 'a'.repeat(64), x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 2,
    ...server(owner),
  }) as TableObject
const piece = (id: string, x: number) => ({
  id, type: 'stroke' as const, layerId: 'drawings', x, y: 0, width: 5, height: 0, rotation: 0, zIndex: 1,
  segments: [[0, 0, 5, 0]], color: '#ffffff', strokeWidth: 3,
})
const STROKE_A = {
  id: 'a', type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 0, rotation: 0, zIndex: 1,
  segments: [[0, 0, 10, 0]], color: '#ffffff', strokeWidth: 3,
}

const snapshot = (objects: TableObject[], self: Member) => ({
  meta: { id: 'T', name: 'M' }, members: [self], layers: DEFAULT_LAYERS, objects, locks: [], notes: { a: 'nota' },
  settings: DEFAULT_SETTINGS, chat: [],
})
const joined = (self: Member = me, objects: TableObject[] = [stroke('a'), image('img')]): TableState =>
  reduceServer(makeInitialState(), { t: 'welcome', self, snapshot: snapshot(objects, self) }, 0)

/** Corte do traço `a` em dois pedaços (os pedaços antes do apagar, como o plano da seleção monta) e um item movido. */
const CUT: ObjectOp[] = [
  { kind: 'create', object: piece('p1', 0), from: 'a' },
  { kind: 'create', object: piece('p2', 20), from: 'a' },
  { kind: 'delete', id: 'a' },
  { kind: 'update', id: 'img', patch: { x: 30 } },
]
const CUT_INVERSE = {
  kind: 'batch',
  ops: [
    { kind: 'update', id: 'img', patch: { x: 0 } },
    { kind: 'create', object: STROKE_A, from: 'p1' },
    { kind: 'delete', id: 'p2' },
    { kind: 'delete', id: 'p1' },
  ],
}
const submit = (s: TableState, ops: ObjectOp[] = CUT) =>
  reduceSubmitBatch(s, [{ opId: 'b1', op: { kind: 'batch', ops } }], { isUndo: false, groupId: 'g1', failText: 'Não foi possível mover a seleção' })
const keys = (s: TableState) => Object.keys(s.objects).sort()

describe('lote no cliente', () => {
  it('aplica na hora; o ack tira a anotação do apagado e empilha o lote inverso em ordem reversa', () => {
    let s = submit(joined())
    expect(keys(s)).toEqual(['img', 'p1', 'p2'])
    expect(s.objects.img.x).toBe(30)
    s = reduceServer(s, { t: 'ack', opId: 'b1', version: 0 }, 0)
    expect(s.pending).toEqual({})
    expect(s.notes).toEqual({})
    expect(s.undoStack).toEqual([[CUT_INVERSE]])
  })

  it('mestre corta o traço de outra pessoa: os pedaços herdam dono e controle; desfazer recria com from, num lote só', () => {
    let s = submit(joined(gm, [stroke('a', 'ana'), image('img', 'ana')]))
    for (const id of ['p1', 'p2']) {
      expect(s.objects[id]).toMatchObject({ ownerId: 'ana', updatedBy: 'gm1', control: { mode: 'list', clientIds: ['ana'] } })
    }
    s = reduceServer(s, { t: 'ack', opId: 'b1', version: 0 }, 0)
    expect(s.undoStack).toEqual([[CUT_INVERSE]])
  })

  it('desfazer do corte: o original volta com o dono do pedaço', () => {
    let s = submit(joined(gm, [stroke('a', 'ana'), image('img', 'ana')]))
    s = reduceServer(s, { t: 'ack', opId: 'b1', version: 0 }, 0)
    const [undo] = s.undoStack[0]
    s = reduceSubmit(s, 'u1', undo, { isUndo: true })
    expect(keys(s)).toEqual(['a', 'img'])
    expect(s.objects.a).toMatchObject({ ownerId: 'ana', control: { mode: 'list', clientIds: ['ana'] } })
  })

  it('mestre apagando item inteiro: o desfazer devolve o controle num segundo lote', () => {
    let s = submit(joined(gm, [stroke('a', 'ana'), image('img', 'ana')]), [{ kind: 'delete', id: 'img' }])
    s = reduceServer(s, { t: 'ack', opId: 'b1', version: 0 }, 0)
    const [group] = s.undoStack
    expect(group).toHaveLength(2)
    expect(group[0]).toMatchObject({ kind: 'batch', ops: [{ kind: 'create', object: expect.objectContaining({ id: 'img' }) }] })
    expect(group[1]).toEqual({ kind: 'batch', ops: [{ kind: 'update', id: 'img', patch: { control: { mode: 'list', clientIds: ['ana'] } } }] })
  })

  it('recusa: tudo volta, outras ops pendentes ficam por cima, aviso do lote e nenhum desfazer', () => {
    let s = reduceSubmit(joined(), 'u1', { kind: 'update', id: 'img', patch: { y: 9 } }, { isUndo: false })
    s = submit(s)
    s = reduceServer(s, { t: 'reject', opId: 'b1', reason: 'locked' }, 0)
    expect(keys(s)).toEqual(['a', 'img'])
    expect(s.objects.img).toMatchObject({ x: 0, y: 9 })
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível mover a seleção')
    expect(s.undoStack).toEqual([])
  })

  it('recusa depois de o servidor apagar um item do lote: o item não volta', () => {
    let s = submit(joined())
    s = reduceServer(s, { t: 'op', by: 'bia', op: { kind: 'delete', id: 'img' } }, 0)
    s = reduceServer(s, { t: 'reject', opId: 'b1', reason: 'not_found' }, 0)
    expect(keys(s)).toEqual(['a'])
  })

  it('recusa depois de o servidor mudar um item do lote: volta o valor do servidor', () => {
    let s = submit(joined())
    s = reduceServer(s, { t: 'batch', by: 'bia', ops: [{ kind: 'upsert', object: { ...image('img'), x: 99, version: 2 } }] }, 0)
    expect(s.objects.img.x).toBe(30)
    s = reduceServer(s, { t: 'reject', opId: 'b1', reason: 'locked' }, 0)
    expect(keys(s)).toEqual(['a', 'img'])
    expect(s.objects.img).toMatchObject({ x: 99, version: 2 })
  })

  it('recusa depois de uma limpeza ou de a camada sumir: o que saiu no servidor não volta', () => {
    let s = submit(joined())
    s = reduceServer(s, { t: 'objectsRemoved', ids: ['a'], by: 'gm1' }, 0)
    s = reduceServer(s, { t: 'reject', opId: 'b1', reason: 'not_found' }, 0)
    expect(keys(s)).toEqual(['img'])

    let t = submit(joined())
    t = reduceServer(t, { t: 'layerRemoved', id: 'drawings' }, 0)
    t = reduceServer(t, { t: 'reject', opId: 'b1', reason: 'not_found' }, 0)
    expect(keys(t)).toEqual([])
  })

  it('desfazer em lote recusado (item apagado por outra pessoa): tudo volta e avisa', () => {
    let s = reduceSubmitBatch(joined(), [{ opId: 'u1', op: { kind: 'batch', ops: CUT } }], { isUndo: true, groupId: 'g' })
    s = reduceServer(s, { t: 'reject', opId: 'u1', reason: 'not_found' }, 0)
    expect(keys(s)).toEqual(['a', 'img'])
    expect(s.objects.img.x).toBe(0)
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível desfazer')
  })

  it('lote de outra pessoa: upserts e deletes; o apagado leva anotação, trava e seleção', () => {
    let s: TableState = { ...joined(), selectedId: 'a' }
    s = reduceServer(s, { t: 'grabbed', objectId: 'a', clientId: 'bia' }, 0)
    s = reduceServer(s, { t: 'batch', by: 'bia', ops: [{ kind: 'delete', id: 'a' }, { kind: 'upsert', object: { ...image('img'), x: 99 } }] }, 0)
    expect(s.objects.a).toBeUndefined()
    expect(s.objects.img.x).toBe(99)
    expect(s.notes).toEqual({})
    expect(s.locks).toEqual({})
    expect(s.selectedId).toBeNull()
  })

  it('reconexão com lote pendente: o snapshot recebe o lote por cima, sem duplicar', () => {
    let s = submit(joined())
    s = reduceServer(s, { t: 'welcome', self: me, snapshot: snapshot([stroke('a'), image('img')], me) }, 0)
    expect(keys(s)).toEqual(['img', 'p1', 'p2'])
    expect(s.objects.img.x).toBe(30)
    expect(Object.keys(s.pending)).toEqual(['b1'])
  })
})

describe('poda do desfazer dentro de lotes', () => {
  const acked = () => reduceServer(submit(joined()), { t: 'ack', opId: 'b1', version: 0 }, 0)

  it('limpar o pedaço do `from`: a recriação passa a sair do outro pedaço; desfazer devolve o original', () => {
    let s = reduceServer(acked(), { t: 'objectsRemoved', ids: ['p1'], by: 'gm1' }, 0)
    expect(s.undoStack).toEqual([[{
      kind: 'batch',
      ops: [{ kind: 'update', id: 'img', patch: { x: 0 } }, { kind: 'create', object: STROKE_A, from: 'p2' }, { kind: 'delete', id: 'p2' }],
    }]])
    s = reduceSubmit(s, 'u1', s.undoStack[0][0], { isUndo: true })
    expect(keys(s)).toEqual(['a', 'img'])
  })

  it('limpar o outro pedaço: a recriação continua do `from`', () => {
    const s = reduceServer(acked(), { t: 'objectsRemoved', ids: ['p2'], by: 'gm1' }, 0)
    expect(s.undoStack).toEqual([[{
      kind: 'batch',
      ops: [{ kind: 'update', id: 'img', patch: { x: 0 } }, { kind: 'create', object: STROKE_A, from: 'p1' }, { kind: 'delete', id: 'p1' }],
    }]])
  })

  it('pedaços limpos um de cada vez: sem nenhum pedaço, a recriação sai junto', () => {
    let s = reduceServer(acked(), { t: 'objectsRemoved', ids: ['p1'], by: 'gm1' }, 0)
    s = reduceServer(s, { t: 'objectsRemoved', ids: ['p2'], by: 'gm1' }, 0)
    expect(s.undoStack).toEqual([[{ kind: 'batch', ops: [{ kind: 'update', id: 'img', patch: { x: 0 } }] }]])
  })

  it('lote que fica vazio sai da pilha', () => {
    const s = reduceServer(acked(), { t: 'objectsRemoved', ids: ['img', 'p1', 'p2'], by: 'gm1' }, 0)
    expect(s.undoStack).toEqual([])
  })

  it('pilha sem nada apagado continua a mesma', () => {
    const stack = acked().undoStack
    expect(pruneUndoStack(stack, new Set(['zzz']))).toBe(stack)
  })
})

describe('reaplicação de pedaço sem o original', () => {
  it('o pedaço que já existe mantém dono e controle (não vira de quem reaplica)', () => {
    const p1 = { ...piece('p1', 0), ...server('ana') } as TableObject
    const out = applyLocalOp({ p1 }, { kind: 'create', object: piece('p1', 0), from: 'a' }, 'gm1')
    expect(out.p1).toMatchObject({ ownerId: 'ana', control: { mode: 'list', clientIds: ['ana'] }, updatedBy: 'gm1' })
  })

  it('sem original nem pedaço anterior, fica com quem aplica', () => {
    const out = applyLocalOp({}, { kind: 'create', object: piece('p1', 0), from: 'a' }, 'gm1')
    expect(out.p1).toMatchObject({ ownerId: 'gm1', control: { mode: 'list', clientIds: ['gm1'] } })
  })

  it('mestre com corte pendente recebe o pedaço do servidor: o dono continua o do original', () => {
    let s = submit(joined(gm, [stroke('a', 'ana'), image('img', 'ana')]))
    s = reduceServer(s, { t: 'op', by: 'gm1', op: { kind: 'upsert', object: { ...piece('p1', 0), ...server('ana') } as TableObject } }, 0)
    expect(s.objects.p1).toMatchObject({ ownerId: 'ana', control: { mode: 'list', clientIds: ['ana'] } })
  })
})
