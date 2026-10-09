import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYERS,
  DEFAULT_SETTINGS,
  DEFAULT_TURNS,
  type Member,
  type Op,
  type ServerMessage,
  type Snapshot,
  type TableObject,
  type TurnEntry,
  type Turns,
} from '@mesa/shared'
import { reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'
import { currentTurnToken, turnNameFor } from '../src/store/turns'

const gm: Member = { clientId: 'gm1', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const ana: Member = { clientId: 'p1', nickname: 'Ana', color: '#3cb44b', role: 'player', online: true }

const token = (id: string): TableObject => ({
  id, type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64), x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'gm1', version: 1, updatedBy: 'gm1', control: { mode: 'list', clientIds: ['gm1'] },
})
const entry = (id: string, name = id, tokenId: string | null = null, initiative: number | null = null): TurnEntry => ({
  id, name, tokenId, initiative,
})
const combat = (currentId: string, ...entries: TurnEntry[]): Turns => ({ open: true, phase: 'combat', round: 1, currentId, entries })
const welcome = (self: Member, over: Partial<Snapshot> = {}): ServerMessage => ({
  t: 'welcome',
  self,
  snapshot: {
    meta: { id: 'T', name: 'M' }, members: [gm, ana], layers: DEFAULT_LAYERS, objects: [], locks: [], notes: {},
    settings: DEFAULT_SETTINGS, chat: [], ...over,
  },
})
const joined = (self: Member, over: Partial<Snapshot> = {}) => reduceServer(makeInitialState(), welcome(self, over), 0)
const submit = (s: TableState, opId: string, op: Op) => reduceSubmit(s, opId, op, { isUndo: false })
const ack = (s: TableState, opId: string) => reduceServer(s, { t: 'ack', opId, version: 0 }, 0)
const updated = (s: TableState, turns: Turns) => reduceServer(s, { t: 'turnsUpdated', turns }, 0)
const names = (s: TableState) => s.turns.entries.map((e) => e.name)

describe('turnos no cliente', () => {
  it('welcome traz os turnos; snapshot sem turnos vira o padrão', () => {
    const turns = combat('a', entry('a', 'Ana'))
    expect(joined(ana, { turns }).turns).toEqual(turns)
    expect(joined(ana).turns).toEqual(DEFAULT_TURNS)
  })

  it('ações do mestre são otimistas; ack e turnsUpdated mantêm; nada entra no desfazer', () => {
    let s = submit(joined(gm), 'o1', { kind: 'turnAdd', entry: { id: 'a', name: 'Goblin' } })
    s = submit(s, 'o2', { kind: 'turnDuplicate', id: 'a', newId: 'b' })
    expect(names(s)).toEqual(['Goblin', 'Goblin 2'])
    s = ack(s, 'o1')
    expect(names(s)).toEqual(['Goblin', 'Goblin 2'])
    s = updated(s, { ...DEFAULT_TURNS, entries: [entry('a', 'Goblin')] })
    expect(names(s)).toEqual(['Goblin', 'Goblin 2']) // o2 ainda pendente, por cima
    s = ack(s, 'o2')
    s = updated(s, { ...DEFAULT_TURNS, entries: [entry('a', 'Goblin'), entry('b', 'Goblin 2')] })
    expect(names(s)).toEqual(['Goblin', 'Goblin 2'])
    expect(s.undoStack).toEqual([])
    expect(s.pending).toEqual({})
  })

  it('recusa volta ao estado do servidor, com aviso', () => {
    let s = submit(joined(gm), 'o1', { kind: 'turnsOpen', open: true })
    expect(s.turns.open).toBe(true)
    s = reduceServer(s, { t: 'reject', opId: 'o1', reason: 'forbidden' }, 0)
    expect(s.turns).toEqual(DEFAULT_TURNS)
    expect(s.toasts.at(-1)?.text).toBe('Só o mestre pode fazer isso')
    s = submit(s, 'o2', { kind: 'turnNext' })
    s = reduceServer(s, { t: 'reject', opId: 'o2', reason: 'invalid' }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível mudar a ordem de turnos')
  })

  it('rolagem espera o servidor', () => {
    let s = joined(gm, { turns: { ...DEFAULT_TURNS, entries: [entry('a'), entry('b')] } })
    s = submit(s, 'r1', { kind: 'turnsRoll', all: false })
    expect(s.turns.entries.map((e) => e.initiative)).toEqual([null, null])
    s = ack(s, 'r1')
    s = updated(s, { ...DEFAULT_TURNS, entries: [entry('b', 'b', null, 15), entry('a', 'a', null, 3)] })
    expect(s.turns.entries.map((e) => e.id)).toEqual(['b', 'a'])
  })

  // Review Focus #1
  it('dois "Próximo" rápidos: avança duas casas, sem voltar enquanto as respostas chegam', () => {
    const base = combat('a', entry('a'), entry('b'), entry('c'))
    let s = joined(gm, { turns: base })
    s = submit(s, 'n1', { kind: 'turnNext' })
    s = submit(s, 'n2', { kind: 'turnNext' })
    expect(s.turns.currentId).toBe('c')
    s = ack(s, 'n1')
    expect(s.turns.currentId).toBe('c')
    s = updated(s, { ...base, currentId: 'b' })
    expect(s.turns.currentId).toBe('c')
    s = ack(s, 'n2')
    s = updated(s, { ...base, currentId: 'c' })
    expect(s.turns).toMatchObject({ currentId: 'c', round: 1 })
  })

  // Review Focus #3
  it('op pendente volta por cima de um welcome novo, sem duplicar se o servidor já a aplicou', () => {
    let s = submit(joined(gm), 'o1', { kind: 'turnAdd', entry: { id: 'a', name: 'Ana' } })
    s = reduceServer(s, welcome(gm), 0)
    expect(names(s)).toEqual(['Ana'])
    s = reduceServer(s, welcome(gm, { turns: { ...DEFAULT_TURNS, entries: [entry('a', 'Ana')] } }), 0)
    expect(names(s)).toEqual(['Ana'])
  })

  // Review Focus #2
  it('token apagado: a entrada continua e o anel some', () => {
    let s = joined(gm, { objects: [token('t1')], turns: combat('a', entry('a', 'Token', 't1')) })
    expect(currentTurnToken(s)?.id).toBe('t1')
    s = reduceServer(s, { t: 'op', by: 'gm1', op: { kind: 'delete', id: 't1' } }, 0)
    expect(s.turns.entries).toEqual([entry('a', 'Token', 't1')])
    expect(currentTurnToken(s)).toBeNull()
  })

  // Review Focus #5
  it('anel só no combate e só para quem tem o token no estado (camada oculta: sem anel)', () => {
    const turns = combat('a', entry('a', 'Token', 't1'))
    expect(currentTurnToken(joined(gm, { objects: [token('t1')], turns: { ...turns, phase: 'prep', currentId: null } }))).toBeNull()
    const player = joined(ana, { turns }) // o objeto está na camada do mestre: o jogador não o recebe
    expect(names(player)).toEqual(['Token'])
    expect(currentTurnToken(player)).toBeNull()
  })

  it('nome do token na ordem: título (até 32 caracteres) ou "Token"', () => {
    expect(turnNameFor(undefined)).toBe('Token')
    expect(turnNameFor('Orc chefe')).toBe('Orc chefe')
    expect(turnNameFor('x'.repeat(40))).toBe('x'.repeat(32))
  })
})
