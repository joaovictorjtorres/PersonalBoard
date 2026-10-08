import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, type Layer, type Member, type ServerMessage, type TableObject } from '@mesa/shared'
import { reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const gm: Member = { clientId: 'gm1', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const player: Member = { clientId: 'p1', nickname: 'Ana', color: '#3cb44b', role: 'player', online: true }

const token = (id: string, layerId = 'tokens'): TableObject => ({
  id, type: 'image', layerId, assetKey: 'a'.repeat(64), x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'gm1', version: 1, updatedBy: 'gm1', control: { mode: 'list', clientIds: ['gm1'] },
})

function joined(self: Member, layers: Layer[], objects: TableObject[] = [], notes: Record<string, string> = {}): TableState {
  const welcome: ServerMessage = {
    t: 'welcome',
    self,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [self, player], layers, objects, locks: [], notes },
  }
  return reduceServer(makeInitialState(), welcome, 0)
}
const ids = (s: TableState) => s.layers.map((l) => l.id)
const PUBLIC = DEFAULT_LAYERS.slice(0, 3)

describe('mensagens de camada', () => {
  it('layerUpsert com order nova reordena a lista', () => {
    let s = joined(player, PUBLIC)
    s = reduceServer(s, { t: 'layerUpsert', layer: { ...DEFAULT_LAYERS[0], order: 1 } }, 0)
    s = reduceServer(s, { t: 'layerUpsert', layer: { ...DEFAULT_LAYERS[1], order: 0 } }, 0)
    expect(ids(s)).toEqual(['tokens', 'map', 'drawings'])
  })

  it('layerUpsert de camada nova entra na posição da order', () => {
    let s = joined(player, PUBLIC)
    s = reduceServer(s, { t: 'layerUpsert', layer: { id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false } }, 0)
    expect(ids(s)).toEqual(['map', 'tokens', 'drawings', 'nova'])
  })

  it('layerHidden remove camada, objetos, seleção e muda a ativa para a visível mais alta', () => {
    let s = { ...joined(player, PUBLIC, [token('t1')]), selectedId: 't1', activeLayerId: 'tokens' }
    s = reduceServer(s, { t: 'layerHidden', id: 'tokens' }, 0)
    expect(ids(s)).toEqual(['map', 'drawings'])
    expect(s.objects).toEqual({})
    expect(s.selectedId).toBeNull()
    expect(s.activeLayerId).toBe('drawings')
  })

  // Review Focus #5
  it('layerShown repetido devolve camada e objetos sem duplicar e mantém minha op pendente por cima', () => {
    let s = joined(player, PUBLIC, [token('t1')])
    s = reduceServer(s, { t: 'layerHidden', id: 'tokens' }, 0)
    const shown: ServerMessage = { t: 'layerShown', layer: DEFAULT_LAYERS[1], objects: [token('t1')] }
    s = reduceServer(s, shown, 0)
    s = reduceSubmit(s, 'op_1', { kind: 'update', id: 't1', patch: { x: 50 } }, { isUndo: false })
    s = reduceServer(s, shown, 0)
    expect(ids(s)).toEqual(['map', 'tokens', 'drawings'])
    expect(Object.keys(s.objects)).toEqual(['t1'])
    expect(s.objects.t1.x).toBe(50)
  })

  it('layerRemoved apaga objetos e anotações da camada', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1'), token('m1', 'map')], { t1: 'nota', m1: 'outra' })
    s = reduceServer(s, { t: 'layerRemoved', id: 'tokens' }, 0)
    expect(Object.keys(s.objects)).toEqual(['m1'])
    expect(s.notes).toEqual({ m1: 'outra' })
  })

  it('noteSet grava e texto vazio remove; delete remoto também remove', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1')])
    s = reduceServer(s, { t: 'noteSet', objectId: 't1', text: 'tem 3 PV' }, 0)
    expect(s.notes).toEqual({ t1: 'tem 3 PV' })
    s = reduceServer(s, { t: 'noteSet', objectId: 't1', text: '' }, 0)
    expect(s.notes).toEqual({})
    s = reduceServer(s, { t: 'noteSet', objectId: 't1', text: 'de novo' }, 0)
    s = reduceServer(s, { t: 'op', by: 'x', op: { kind: 'delete', id: 't1' } }, 0)
    expect(s.notes).toEqual({})
  })

  it('welcome guarda as anotações do snapshot', () => {
    expect(joined(gm, DEFAULT_LAYERS, [token('t1')], { t1: 'nota' }).notes).toEqual({ t1: 'nota' })
  })

  it('memberRemoved tira o membro e o cursor', () => {
    let s = joined(gm, DEFAULT_LAYERS)
    s = reduceServer(s, { t: 'presence', clientId: 'p1', p: { kind: 'cursor', x: 1, y: 1 } }, 0)
    s = reduceServer(s, { t: 'memberRemoved', clientId: 'p1' }, 0)
    expect(s.members.p1).toBeUndefined()
    expect(s.cursors.p1).toBeUndefined()
  })
})

describe('operações otimistas do mestre', () => {
  it('layerCreate entra abaixo do Mestre na hora', () => {
    const s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerCreate', layer: { id: 'nova', name: 'Nova camada' } }, { isUndo: false })
    expect(s.layers.map((l) => `${l.id}:${l.order}`)).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
  })

  it('reject de layerUpdate volta ao estado anterior com toast', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerUpdate', id: 'map', patch: { locked: true } }, { isUndo: false })
    expect(s.layers[0].locked).toBe(true)
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden', current: null }, 0)
    expect(s.layers[0].locked).toBe(false)
    expect(s.toasts.at(-1)?.text).toBe('Sem permissão nessa camada')
  })

  it('reject de uma op de camada não desfaz outra pendente feita depois', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerUpdate', id: 'map', patch: { name: 'A' } }, { isUndo: false })
    s = reduceSubmit(s, 'op_2', { kind: 'layerMove', id: 'drawings', direction: 'down' }, { isUndo: false })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'invalid', current: null }, 0)
    expect(s.layers.map((l) => `${l.id}:${l.name}`)).toEqual(['map:Mapa', 'drawings:Desenhos', 'tokens:Tokens', 'gm:Mestre'])
  })

  it('layerDelete some na hora e o reject devolve camada, objetos e anotações', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1')], { t1: 'nota' })
    s = { ...s, activeLayerId: 'tokens' }
    s = reduceSubmit(s, 'op_1', { kind: 'layerDelete', id: 'tokens' }, { isUndo: false })
    expect(ids(s)).toEqual(['map', 'drawings', 'gm'])
    expect(s.objects).toEqual({})
    expect(s.activeLayerId).toBe('drawings')
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden', current: null }, 0)
    expect(ids(s)).toEqual(['map', 'tokens', 'drawings', 'gm'])
    expect(Object.keys(s.objects)).toEqual(['t1'])
    expect(s.notes).toEqual({ t1: 'nota' })
    expect(s.toasts.at(-1)?.text).toBe('Essa camada não pode ser removida')
  })

  it('noteSet otimista e reject devolve o texto anterior', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1')], { t1: 'antiga' })
    s = reduceSubmit(s, 'op_1', { kind: 'noteSet', objectId: 't1', text: 'nova' }, { isUndo: false })
    expect(s.notes.t1).toBe('nova')
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'not_found', current: null }, 0)
    expect(s.notes.t1).toBe('antiga')
  })

  it('memberRemove recusado devolve o membro e explica', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'memberRemove', clientId: 'p1' }, { isUndo: false })
    expect(s.members.p1).toBeUndefined()
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden', current: null }, 0)
    expect(s.members.p1).toEqual(player)
    expect(s.toasts.at(-1)?.text).toBe('Não dá para remover quem está online')
  })

  it('ops de camada não entram na pilha de desfazer', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerUpdate', id: 'map', patch: { name: 'A' } }, { isUndo: false })
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 0 }, 0)
    expect(s.undoStack).toEqual([])
    expect(s.undoGroups).toEqual({})
  })
})

describe('rulings do controlador', () => {
  it('reject com current ausente (invalid) volta ao before do op pendente', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1')])
    s = reduceSubmit(s, 'op_1', { kind: 'update', id: 't1', patch: { x: 50 } }, { isUndo: false })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'invalid' }, 0)
    expect(s.objects.t1.x).toBe(0)
  })

  it('welcome reaplica ops pendentes de camada, anotação e membro', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1')])
    s = reduceSubmit(s, 'op_1', { kind: 'layerCreate', layer: { id: 'nova', name: 'Nova camada' } }, { isUndo: false })
    s = reduceSubmit(s, 'op_2', { kind: 'noteSet', objectId: 't1', text: 'oi' }, { isUndo: false })
    s = reduceSubmit(s, 'op_3', { kind: 'memberRemove', clientId: 'p1' }, { isUndo: false })
    s = reduceServer(
      s,
      { t: 'welcome', self: gm, snapshot: { meta: { id: 'T', name: 'M' }, members: [gm, player], layers: DEFAULT_LAYERS, objects: [token('t1')], locks: [], notes: {} } },
      0,
    )
    expect(ids(s)).toContain('nova')
    expect(s.notes.t1).toBe('oi')
    expect(s.members.p1).toBeUndefined()
  })

  it('layerRemoved na camada ativa do jogador move para a visível mais alta', () => {
    let s = { ...joined(player, PUBLIC), activeLayerId: 'drawings' }
    s = reduceServer(s, { t: 'layerRemoved', id: 'drawings' }, 0)
    expect(s.activeLayerId).toBe('tokens')
  })

  it('layerUpsert visibility gm não muda a camada ativa do mestre', () => {
    let s = { ...joined(gm, DEFAULT_LAYERS), activeLayerId: 'tokens' }
    s = reduceServer(s, { t: 'layerUpsert', layer: { ...DEFAULT_LAYERS[1], visibility: 'gm' } }, 0)
    expect(s.activeLayerId).toBe('tokens')
  })

  it('layerHidden limpa locks, previews e seleção da camada', () => {
    let s = { ...joined(player, PUBLIC, [token('t1'), token('m1', 'map')]), selectedId: 't1' }
    s = reduceServer(s, { t: 'presence', clientId: 'gm1', p: { kind: 'drag', objectId: 't1', x: 1, y: 1, width: 1, height: 1, rotation: 0 } }, 0)
    s = reduceServer(s, { t: 'presence', clientId: 'gm1', p: { kind: 'stroke', strokeId: 's1', layerId: 'tokens', points: [0, 0], color: '#fff', strokeWidth: 2 } }, 0)
    s = reduceServer(s, { t: 'presence', clientId: 'gm1', p: { kind: 'stroke', strokeId: 's2', layerId: 'map', points: [0, 0], color: '#fff', strokeWidth: 2 } }, 0)
    s = reduceServer(s, { t: 'layerHidden', id: 'tokens' }, 0)
    expect(s.dragPreviews).toEqual({})
    expect(s.locks).toEqual({})
    expect(Object.keys(s.strokePreviews)).toEqual(['s2'])
    expect(s.selectedId).toBeNull()
  })
})

describe('base confirmada de camadas', () => {
  const welcomeMsg = (layers: Layer[]): ServerMessage => ({
    t: 'welcome',
    self: gm,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [gm, player], layers, objects: [], locks: [], notes: {} },
  })

  it('rejeitar op1 e depois op2 não ressuscita a mudança de op1', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerUpdate', id: 'map', patch: { name: 'A' } }, { isUndo: false })
    s = reduceSubmit(s, 'op_2', { kind: 'layerMove', id: 'drawings', direction: 'down' }, { isUndo: false })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'invalid' }, 0)
    s = reduceServer(s, { t: 'reject', opId: 'op_2', reason: 'invalid' }, 0)
    expect(s.layers.map((l) => `${l.id}:${l.name}`)).toEqual(['map:Mapa', 'tokens:Tokens', 'drawings:Desenhos', 'gm:Mestre'])
  })

  it('layerMove com ack perdido + welcome já com a nova ordem move uma vez só', () => {
    const s0 = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerMove', id: 'drawings', direction: 'down' }, { isUndo: false })
    const moved = s0.layers
    expect(ids(s0)).toEqual(['map', 'drawings', 'tokens', 'gm'])
    const s = reduceServer(s0, welcomeMsg(moved), 0)
    expect(ids(s)).toEqual(['map', 'drawings', 'tokens', 'gm'])
    expect(s.layers).toEqual(moved)
  })

  it('layerUpsert remoto com op local pendente: ambos aparecem e o remoto sobrevive ao reject', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerUpdate', id: 'map', patch: { name: 'Local' } }, { isUndo: false })
    s = reduceServer(s, { t: 'layerUpsert', layer: { ...DEFAULT_LAYERS[1], name: 'Remoto' } }, 0)
    expect(s.layers.map((l) => l.name)).toEqual(['Local', 'Remoto', 'Desenhos', 'Mestre'])
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden', current: null }, 0)
    expect(s.layers.map((l) => l.name)).toEqual(['Mapa', 'Remoto', 'Desenhos', 'Mestre'])
  })
})
