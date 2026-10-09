import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TURNS,
  INITIATIVE_MAX,
  INITIATIVE_MIN,
  InitiativeSchema,
  TURNS_MAX,
  TURN_NAME_MAX,
  TurnAddOpSchema,
  TurnMoveOpSchema,
  TurnNameSchema,
  TurnUpdateOpSchema,
  TurnsSchema,
  applyTurnOp,
  duplicateName,
  parseTurns,
  sortByInitiative,
  type TurnEntry,
  type Turns,
} from '../src'

const entry = (id: string, name = id, initiative: number | null = null, tokenId: string | null = null): TurnEntry => ({
  id, name, tokenId, initiative,
})
const prep = (...entries: TurnEntry[]): Turns => ({ ...DEFAULT_TURNS, entries })
const combat = (currentId: string, round: number, ...entries: TurnEntry[]): Turns => ({
  open: true, phase: 'combat', round, currentId, entries,
})
const ids = (t: Turns | null) => t?.entries.map((e) => e.id)
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++]
}

describe('schemas dos turnos', () => {
  it('nome: apara as pontas, de 1 a 32 caracteres', () => {
    expect(TurnNameSchema.parse('  Goblin  ')).toBe('Goblin')
    expect(TurnNameSchema.safeParse('   ').success).toBe(false)
    expect(TurnNameSchema.safeParse('x'.repeat(TURN_NAME_MAX)).success).toBe(true)
    expect(TurnNameSchema.safeParse('x'.repeat(TURN_NAME_MAX + 1)).success).toBe(false)
  })

  it('iniciativa: inteiro de -99 a 999', () => {
    for (const ok of [INITIATIVE_MIN, 0, INITIATIVE_MAX]) expect(InitiativeSchema.safeParse(ok).success).toBe(true)
    for (const bad of [INITIATIVE_MIN - 1, INITIATIVE_MAX + 1, 1.5, Number.NaN]) expect(InitiativeSchema.safeParse(bad).success).toBe(false)
  })

  it('ações: turnAdd apara o nome e recusa campo extra; turnUpdate vazio ou fora do limite é recusado; null limpa', () => {
    expect(TurnAddOpSchema.parse({ kind: 'turnAdd', entry: { id: 'a', name: ' Ana ' } })).toEqual({
      kind: 'turnAdd', entry: { id: 'a', name: 'Ana' },
    })
    expect(TurnAddOpSchema.safeParse({ kind: 'turnAdd', entry: { id: 'a', name: 'Ana', extra: 1 } }).success).toBe(false)
    expect(TurnUpdateOpSchema.safeParse({ kind: 'turnUpdate', id: 'a', patch: {} }).success).toBe(false)
    expect(TurnUpdateOpSchema.safeParse({ kind: 'turnUpdate', id: 'a', patch: { initiative: 1000 } }).success).toBe(false)
    expect(TurnUpdateOpSchema.safeParse({ kind: 'turnUpdate', id: 'a', patch: { initiative: null } }).success).toBe(true)
    expect(TurnMoveOpSchema.safeParse({ kind: 'turnMove', id: 'a', index: -1 }).success).toBe(false)
  })

  it('estado: no máximo 50 entradas', () => {
    const many = Array.from({ length: TURNS_MAX + 1 }, (_, i) => entry(`e${i}`))
    expect(TurnsSchema.safeParse(prep(...many.slice(0, TURNS_MAX))).success).toBe(true)
    expect(TurnsSchema.safeParse(prep(...many)).success).toBe(false)
  })

  it('parseTurns: ausente, corrompido ou incoerente vira o padrão', () => {
    expect(parseTurns(null)).toEqual(DEFAULT_TURNS)
    expect(parseTurns({ open: 'sim' })).toEqual(DEFAULT_TURNS)
    expect(parseTurns(combat('zz', 1, entry('a')))).toEqual(DEFAULT_TURNS)
    expect(parseTurns(prep(entry('a'), entry('a')))).toEqual(DEFAULT_TURNS)
    const ok = combat('a', 2, entry('a', 'Ana', 12))
    expect(parseTurns(ok)).toEqual(ok)
  })
})

describe('duplicateName', () => {
  it('próximo número livre, a partir do nome sem o sufixo', () => {
    expect(duplicateName([entry('a', 'Goblin')], 'Goblin')).toBe('Goblin 2')
    expect(duplicateName([entry('a', 'Goblin'), entry('b', 'Goblin 2')], 'Goblin')).toBe('Goblin 3')
    expect(duplicateName([entry('a', 'Goblin'), entry('b', 'Goblin 2')], 'Goblin 2')).toBe('Goblin 3')
    expect(duplicateName([entry('a', 'Goblin'), entry('c', 'Goblin 3')], 'Goblin')).toBe('Goblin 2')
  })

  // Review Focus #4
  it('nome de 32 caracteres: corta a base para o sufixo caber', () => {
    const long = 'x'.repeat(TURN_NAME_MAX)
    const name = duplicateName([entry('a', long)], long)
    expect(name).toBe(`${'x'.repeat(TURN_NAME_MAX - 2)} 2`)
    expect(TurnNameSchema.safeParse(name).success).toBe(true)
  })
})

describe('sortByInitiative', () => {
  it('do maior para o menor; empate mantém a ordem; sem valor vai para o fim', () => {
    const sorted = sortByInitiative([entry('a', 'a', 5), entry('b', 'b', null), entry('c', 'c', 9), entry('d', 'd', 5)])
    expect(sorted.map((e) => e.id)).toEqual(['c', 'a', 'd', 'b'])
  })
})

describe('applyTurnOp', () => {
  it('turnsOpen abre e fecha em qualquer fase', () => {
    expect(applyTurnOp(DEFAULT_TURNS, { kind: 'turnsOpen', open: true })?.open).toBe(true)
    expect(applyTurnOp(combat('a', 3, entry('a')), { kind: 'turnsOpen', open: false })).toEqual({ ...combat('a', 3, entry('a')), open: false })
  })

  it('turnAdd: no fim, sem iniciativa; id repetido ou 51ª entrada → null', () => {
    const t = applyTurnOp(prep(entry('a')), { kind: 'turnAdd', entry: { id: 'b', name: 'Orc', tokenId: 't1' } })
    expect(t?.entries).toEqual([entry('a'), entry('b', 'Orc', null, 't1')])
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnAdd', entry: { id: 'a', name: 'X' } })).toBeNull()
    const full = prep(...Array.from({ length: TURNS_MAX }, (_, i) => entry(`e${i}`)))
    expect(applyTurnOp(full, { kind: 'turnAdd', entry: { id: 'z', name: 'Z' } })).toBeNull()
  })

  it('turnDuplicate: logo abaixo, mesmo token, sem iniciativa; no limite ou newId repetido → null', () => {
    const t = prep(entry('a', 'Orc', 15, 't1'), entry('b', 'Ana'))
    expect(applyTurnOp(t, { kind: 'turnDuplicate', id: 'a', newId: 'c' })?.entries).toEqual([
      entry('a', 'Orc', 15, 't1'), entry('c', 'Orc 2', null, 't1'), entry('b', 'Ana'),
    ])
    expect(applyTurnOp(t, { kind: 'turnDuplicate', id: 'a', newId: 'b' })).toBeNull()
    expect(applyTurnOp(t, { kind: 'turnDuplicate', id: 'zz', newId: 'c' })).toBeNull()
    const full = prep(...Array.from({ length: TURNS_MAX }, (_, i) => entry(`e${i}`)))
    expect(applyTurnOp(full, { kind: 'turnDuplicate', id: 'e0', newId: 'z' })).toBeNull()
  })

  it('turnUpdate edita sem reordenar; null limpa a iniciativa; id inexistente → null', () => {
    const t = prep(entry('a', 'a', 3), entry('b', 'b', 10))
    expect(ids(applyTurnOp(t, { kind: 'turnUpdate', id: 'a', patch: { initiative: 20 } }))).toEqual(['a', 'b'])
    expect(applyTurnOp(t, { kind: 'turnUpdate', id: 'a', patch: { name: 'Ana', initiative: null } })?.entries[0]).toEqual(entry('a', 'Ana'))
    expect(applyTurnOp(t, { kind: 'turnUpdate', id: 'zz', patch: { name: 'X' } })).toBeNull()
  })

  it('turnMove move para a posição; índice fora da lista → null', () => {
    const t = prep(entry('a'), entry('b'), entry('c'))
    expect(ids(applyTurnOp(t, { kind: 'turnMove', id: 'a', index: 2 }))).toEqual(['b', 'c', 'a'])
    expect(ids(applyTurnOp(t, { kind: 'turnMove', id: 'c', index: 0 }))).toEqual(['c', 'a', 'b'])
    expect(applyTurnOp(t, { kind: 'turnMove', id: 'a', index: 3 })).toBeNull()
  })

  it('turnsRoll: só quem está sem valor, ou todos; ordena do maior para o menor com empate estável', () => {
    const t = prep(entry('a'), entry('b', 'b', 12), entry('c'), entry('d'))
    // a=12, c=5, d=12 → a(12) b(12) d(12) c(5)
    expect(applyTurnOp(t, { kind: 'turnsRoll', all: false }, seq(12, 5, 12))?.entries.map((e) => `${e.id}:${e.initiative}`)).toEqual([
      'a:12', 'b:12', 'd:12', 'c:5',
    ])
    expect(ids(applyTurnOp(t, { kind: 'turnsRoll', all: true }, seq(1, 2, 3, 4)))).toEqual(['d', 'c', 'b', 'a'])
  })

  it('turnsRoll sem d20 (cliente) não muda nada; no combate, vazio ou sem quem rolar → null', () => {
    const t = prep(entry('a'))
    expect(applyTurnOp(t, { kind: 'turnsRoll', all: false })).toBe(t)
    expect(applyTurnOp(DEFAULT_TURNS, { kind: 'turnsRoll', all: true }, seq(1))).toBeNull()
    expect(applyTurnOp(prep(entry('a', 'a', 3)), { kind: 'turnsRoll', all: false }, seq(1))).toBeNull()
    expect(applyTurnOp(combat('a', 1, entry('a')), { kind: 'turnsRoll', all: true }, seq(1))).toBeNull()
  })

  it('turnsStart: combate, rodada 1, vez da primeira e abre a janela; sem entradas ou já no combate → null', () => {
    expect(applyTurnOp(prep(entry('a'), entry('b')), { kind: 'turnsStart' })).toEqual(combat('a', 1, entry('a'), entry('b')))
    expect(applyTurnOp(DEFAULT_TURNS, { kind: 'turnsStart' })).toBeNull()
    expect(applyTurnOp(combat('a', 1, entry('a')), { kind: 'turnsStart' })).toBeNull()
  })

  it('turnNext/turnPrev: viram a rodada nos dois sentidos, mínimo 1; na preparação → null', () => {
    const t = combat('a', 1, entry('a'), entry('b'))
    const n1 = applyTurnOp(t, { kind: 'turnNext' })!
    expect([n1.currentId, n1.round]).toEqual(['b', 1])
    const n2 = applyTurnOp(n1, { kind: 'turnNext' })!
    expect([n2.currentId, n2.round]).toEqual(['a', 2])
    const p1 = applyTurnOp(n2, { kind: 'turnPrev' })!
    expect([p1.currentId, p1.round]).toEqual(['b', 1])
    const p0 = applyTurnOp(t, { kind: 'turnPrev' })!
    expect([p0.currentId, p0.round]).toEqual(['b', 1])
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnNext' })).toBeNull()
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnPrev' })).toBeNull()
  })

  it('turnRemove: a da vez passa para a seguinte, ou a primeira sem mudar a rodada; vazia no combate volta à preparação', () => {
    const t = combat('b', 4, entry('a'), entry('b'), entry('c'))
    expect(applyTurnOp(t, { kind: 'turnRemove', id: 'b' })).toMatchObject({ currentId: 'c', round: 4 })
    expect(applyTurnOp({ ...t, currentId: 'c' }, { kind: 'turnRemove', id: 'c' })).toMatchObject({ currentId: 'a', round: 4 })
    expect(applyTurnOp(t, { kind: 'turnRemove', id: 'a' })).toMatchObject({ currentId: 'b' })
    expect(applyTurnOp(combat('a', 3, entry('a')), { kind: 'turnRemove', id: 'a' })).toEqual({ ...DEFAULT_TURNS, open: true })
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnRemove', id: 'a' })).toEqual(DEFAULT_TURNS)
    expect(applyTurnOp(t, { kind: 'turnRemove', id: 'zz' })).toBeNull()
  })

  it('turnsEnd: keep zera as iniciativas; sem keep limpa; ambos voltam à preparação; na preparação → null', () => {
    const t = combat('b', 3, entry('a', 'a', 15, 't1'), entry('b', 'b', 7))
    expect(applyTurnOp(t, { kind: 'turnsEnd', keep: true })).toEqual({
      open: true, phase: 'prep', round: 1, currentId: null, entries: [entry('a', 'a', null, 't1'), entry('b')],
    })
    expect(applyTurnOp(t, { kind: 'turnsEnd', keep: false })).toEqual({ ...DEFAULT_TURNS, open: true })
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnsEnd', keep: true })).toBeNull()
  })
})
