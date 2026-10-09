import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ServerMessage, type TableObject } from '@mesa/shared'
import type { WebSocketLike } from '../src/sync/SyncClient'
import { createTableStore } from '../src/store/tableStore'
import type { SelectionArea } from '../src/selection/model'
import { strokeAt, tokenAt } from './selection-fixtures'

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = []
  sent: any[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) { this.sent.push(data === 'ping' ? 'ping' : JSON.parse(data)) }
  close() { this.onclose?.({ code: 1000 }) }
  receive(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const sock = () => FakeSocket.all[FakeSocket.all.length - 1]
const opsSent = () => sock().sent.filter((m) => typeof m === 'object' && m.t === 'op')
const rect = (x: number, y: number, width: number, height: number): SelectionArea => ({ kind: 'rect', rect: { x, y, width, height } })

// Tudo na camada Tokens (a ativa depois do welcome).
const line = strokeAt('l', [0, 50, 200, 50], { layerId: 'tokens' })
const t1 = tokenAt('t1', 60, 40, { layerId: 'tokens' })

function connected(objects: TableObject[] = [line, t1]) {
  const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
  store.getState().actions.connect('Eu')
  sock().onopen?.({})
  sock().receive({
    t: 'welcome', self: me,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects, locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  })
  return store
}

beforeEach(() => {
  FakeSocket.all = []
  const mem = new Map<string, string>()
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('seleção na store', () => {
  it('mover envia um lote; a seleção vira os itens movidos (inteiros)', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    expect(store.getState().selection).toMatchObject({ whole: ['t1'], parts: { l: expect.anything() } })
    a.setSelectionOffset({ x: 10, y: 100 })
    a.moveSelection(10, 100)
    const [sent] = opsSent()
    expect(sent.op.kind).toBe('batch')
    expect(sent.op.ops).toHaveLength(4)
    const s = store.getState()
    expect(s.selectionOffset).toBeNull()
    expect(s.selection?.parts).toEqual({})
    expect(s.selection?.whole).toHaveLength(2)
    expect(s.objects.t1).toMatchObject({ x: 70, y: 140 })
  })

  it('lote recusado: tudo volta, aviso e seleção desfeita', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.moveSelection(10, 100)
    sock().receive({ t: 'reject', opId: opsSent()[0].opId, reason: 'locked' })
    const s = store.getState()
    expect(Object.keys(s.objects).sort()).toEqual(['l', 't1'])
    expect(s.objects.t1.x).toBe(60)
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível mover a seleção')
    expect(s.selection).toBeNull()
  })

  it('soltar no mesmo lugar não envia nada e mantém a seleção', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    const before = store.getState().selection
    a.setSelectionOffset({ x: 0, y: 0 })
    a.moveSelection(0, 0)
    expect(opsSent()).toEqual([])
    expect(store.getState().selection).toBe(before)
    expect(store.getState().selectionOffset).toBeNull()
  })

  it('apagar envia o lote e desfaz a seleção', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.deleteSelection()
    expect(opsSent()[0].op.ops.map((o: { kind: string }) => o.kind)).toEqual(['delete', 'create', 'delete'])
    expect(store.getState().selection).toBeNull()
  })

  it('mais de 200 sub-ações: aviso, nada enviado, seleção mantida', () => {
    const many = Array.from({ length: 201 }, (_, i) => tokenAt(`k${i}`, 60, 40, { layerId: 'tokens' }))
    const store = connected(many)
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.deleteSelection()
    expect(opsSent()).toEqual([])
    expect(store.getState().toasts.at(-1)?.text).toBe('Seleção grande demais; selecione menos itens')
    expect(store.getState().selection?.whole).toHaveLength(201)
  })

  it('trocar de ferramenta ou de camada desfaz; com "Todas as camadas", trocar de camada mantém', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setTool('select')
    expect(store.getState().selection).not.toBeNull()
    a.setTool('hand')
    expect(store.getState().selection).toBeNull()
    a.setTool('select')
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setActiveLayer('drawings')
    expect(store.getState().selection).toBeNull()
    a.setSelectAllLayers(true)
    a.setActiveLayer('tokens')
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setActiveLayer('drawings')
    expect(store.getState().selection).not.toBeNull()
    a.select('t1')
    expect(store.getState().selection).toBeNull()
  })

  it('item apagado por outra pessoa no meio do arrasto sai da seleção; soltar move só o resto', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setSelectionOffset({ x: 10, y: 100 })
    sock().receive({ t: 'op', by: 'bia', op: { kind: 'delete', id: 't1' } })
    expect(store.getState().selection?.whole).toEqual([])
    a.moveSelection(10, 100)
    expect(opsSent()[0].op.ops.map((o: { kind: string }) => o.kind)).toEqual(['create', 'create', 'delete'])
  })

  it('movido por outra pessoa sai; mensagem que não muda a forma não tira', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(-10, 0, 300, 100), false)
    expect(store.getState().selection?.whole.sort()).toEqual(['l', 't1'])
    sock().receive({ t: 'op', by: 'bia', op: { kind: 'upsert', object: { ...t1, title: 'Goblin' } } })
    expect(store.getState().selection?.whole.sort()).toEqual(['l', 't1'])
    sock().receive({ t: 'op', by: 'bia', op: { kind: 'upsert', object: { ...t1, x: 5 } } })
    expect(store.getState().selection?.whole).toEqual(['l'])
  })

  it('opções do Selecionar ficam no localStorage', () => {
    const store = connected()
    store.getState().actions.setSelectShape('lasso')
    store.getState().actions.setSelectAllLayers(true)
    const again = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
    expect(again.getState()).toMatchObject({ selectShape: 'lasso', selectAllLayers: true })
  })

  it('arrastar o grupo manda a caixa deslocada e as camadas; soltar manda o fim', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setSelectionOffset({ x: 10, y: 100 })
    const presence = () => sock().sent.filter((m) => typeof m === 'object' && m.t === 'presence').map((m) => m.p)
    expect(presence()).toEqual([{ kind: 'groupDrag', x: 60, y: 140, width: 100, height: 20, layerIds: ['tokens'] }])
    a.moveSelection(10, 100)
    expect(presence().at(-1)).toEqual({ kind: 'groupDragEnd' })
  })
})
