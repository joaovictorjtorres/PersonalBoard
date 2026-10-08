import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, LOCK_TTL_MS, type NewObject, type ServerMessage, type TableObject } from '@mesa/shared'
import { isLockedByOther, reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const self = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player' as const, online: true }
const newToken = (id = 't1'): NewObject => ({
  id, type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
  x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 1,
})
const stored = (id = 't1', over: Partial<TableObject> = {}): TableObject =>
  ({ ...newToken(id), ownerId: 'other', version: 1, updatedBy: 'other', control: { mode: 'list', clientIds: ['other'] }, ...over }) as TableObject

const welcome = (objects: TableObject[] = []): ServerMessage => ({
  t: 'welcome',
  self,
  snapshot: { meta: { id: 'T', name: 'M' }, members: [self], layers: DEFAULT_LAYERS.slice(0, 3), objects, locks: [] },
})

function joined(objects: TableObject[] = []): TableState {
  return reduceServer(makeInitialState(), welcome(objects), 0)
}

describe('welcome', () => {
  it('monta estado e marca open', () => {
    const s = joined([stored()])
    expect(s.status).toBe('open')
    expect(s.self).toEqual(self)
    expect(Object.keys(s.objects)).toEqual(['t1'])
    expect(s.layers.map((l) => l.id)).toEqual(['map', 'tokens', 'drawings'])
  })

  // Review Focus #3
  it('reaplica ops pendentes por cima do snapshot novo', () => {
    let s = joined()
    s = reduceSubmit(s, 'op_1', { kind: 'create', object: newToken('mine') }, { isUndo: false })
    s = reduceServer(s, welcome([]), 1000)
    expect(s.objects.mine).toBeDefined()
    expect(s.pending.op_1).toBeDefined()
  })

  it('camada ativa inexistente volta para tokens', () => {
    const s = reduceServer({ ...makeInitialState(), activeLayerId: 'gm' }, welcome(), 0)
    expect(s.activeLayerId).toBe('tokens')
  })
})

describe('submit / ack / reject', () => {
  it('create otimista; ack seta version e empilha inversa', () => {
    let s = reduceSubmit(joined(), 'op_1', { kind: 'create', object: newToken() }, { isUndo: false })
    expect(s.objects.t1).toMatchObject({ ownerId: 'me', version: 0 })
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 1 }, 0)
    expect(s.objects.t1.version).toBe(1)
    expect(s.pending).toEqual({})
    expect(s.undoStack).toEqual([{ kind: 'delete', id: 't1' }])
  })

  it('ack de desfazer não empilha nada', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'delete', id: 't1' }, { isUndo: true })
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 0 }, 0)
    expect(s.undoStack).toEqual([])
  })

  it('reject com current restaura estado do servidor e mostra toast', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'update', id: 't1', patch: { x: 99 } }, { isUndo: false })
    expect(s.objects.t1.x).toBe(99)
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'locked', current: stored('t1', { x: 5 }) }, 0)
    expect(s.objects.t1.x).toBe(5)
    expect(s.toasts.at(-1)?.text).toBe('Outra pessoa está mexendo nesse objeto')
  })

  it('reject com current null remove o objeto', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'update', id: 't1', patch: { x: 99 } }, { isUndo: false })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'not_found', current: null }, 0)
    expect(s.objects.t1).toBeUndefined()
  })

  it('reject de desfazer usa texto próprio', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'update', id: 't1', patch: { x: 1 } }, { isUndo: true })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'locked', current: stored() }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível desfazer')
  })

  it('reject de delete por not_found não mostra toast', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'delete', id: 't1' }, { isUndo: false })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'not_found', current: null }, 0)
    expect(s.toasts).toEqual([])
  })
})

describe('mensagens de outros', () => {
  it('upsert remoto mantém meu update pendente por cima', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'update', id: 't1', patch: { x: 99 } }, { isUndo: false })
    s = reduceServer(s, { t: 'op', by: 'other', op: { kind: 'upsert', object: stored('t1', { y: 40, version: 2 }) } }, 0)
    expect(s.objects.t1).toMatchObject({ x: 99, y: 40 })
  })

  it('delete remoto limpa seleção, trava e prévia', () => {
    let s = { ...joined([stored()]), selectedId: 't1' }
    s = reduceServer(s, { t: 'grabbed', objectId: 't1', clientId: 'other' }, 0)
    s = reduceServer(s, { t: 'op', by: 'other', op: { kind: 'delete', id: 't1' } }, 0)
    expect(s.objects.t1).toBeUndefined()
    expect(s.selectedId).toBeNull()
    expect(s.locks.t1).toBeUndefined()
  })

  it('presença de traço acumula pontos incrementais', () => {
    let s = joined()
    const base = { kind: 'stroke' as const, strokeId: 's1', layerId: 'drawings', color: '#ffffff', strokeWidth: 3 }
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { ...base, points: [0, 0, 1, 1] } }, 0)
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { ...base, points: [2, 2] } }, 0)
    expect(s.strokePreviews.s1.points).toEqual([0, 0, 1, 1, 2, 2])
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { kind: 'strokeEnd', strokeId: 's1' } }, 0)
    expect(s.strokePreviews.s1).toBeUndefined()
  })

  it('presença de drag cria/renova trava e prévia; trava expira', () => {
    let s = joined([stored()])
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { kind: 'drag', objectId: 't1', x: 5, y: 5, width: 70, height: 70, rotation: 0 } }, 100)
    expect(s.dragPreviews.t1).toMatchObject({ x: 5 })
    expect(isLockedByOther(s, 't1', 100)).toBe(true)
    expect(isLockedByOther(s, 't1', 100 + LOCK_TTL_MS + 1)).toBe(false)
  })

  it('memberLeft marca offline e limpa cursor e travas da pessoa', () => {
    let s = reduceServer(joined([stored()]), { t: 'memberJoined', member: { ...self, clientId: 'other', nickname: 'Bia' } }, 0)
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { kind: 'cursor', x: 1, y: 1 } }, 0)
    s = reduceServer(s, { t: 'grabbed', objectId: 't1', clientId: 'other' }, 0)
    s = reduceServer(s, { t: 'memberLeft', clientId: 'other' }, 0)
    expect(s.members.other.online).toBe(false)
    expect(s.cursors.other).toBeUndefined()
    expect(s.locks.t1).toBeUndefined()
  })

  it('grabDenied marca e grabbed próprio limpa a marca', () => {
    let s = reduceServer(joined([stored()]), { t: 'grabDenied', objectId: 't1' }, 0)
    expect(s.deniedGrabs.t1).toBe(true)
    s = reduceServer(s, { t: 'grabbed', objectId: 't1', clientId: 'me' }, 0)
    expect(s.deniedGrabs.t1).toBeUndefined()
  })

  it('error marca fatal e fecha', () => {
    const s = reduceServer(makeInitialState(), { t: 'error', reason: 'table_not_found' }, 0)
    expect(s.fatal).toBe('table_not_found')
    expect(s.status).toBe('closed')
  })
})
