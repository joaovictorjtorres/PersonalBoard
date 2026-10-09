import { z } from 'zod'
import { INITIATIVE_MAX, INITIATIVE_MIN, TURNS_MAX, TURN_NAME_MAX } from './constants'
import { IdSchema } from './model'

export const TurnNameSchema = z.string().trim().min(1).max(TURN_NAME_MAX)
export const InitiativeSchema = z.number().int().min(INITIATIVE_MIN).max(INITIATIVE_MAX)

export const TurnEntrySchema = z.strictObject({
  id: IdSchema,
  name: TurnNameSchema,
  tokenId: IdSchema.nullable(),
  initiative: InitiativeSchema.nullable(),
})
export type TurnEntry = z.infer<typeof TurnEntrySchema>

export const TurnsSchema = z.strictObject({
  open: z.boolean(),
  phase: z.enum(['prep', 'combat']),
  round: z.number().int().min(1),
  currentId: IdSchema.nullable(),
  entries: z.array(TurnEntrySchema).max(TURNS_MAX),
})
export type Turns = z.infer<typeof TurnsSchema>
export type TurnPhase = Turns['phase']

/** Mesa sem estado salvo. Não altere: use `defaultTurns()` para uma cópia. */
export const DEFAULT_TURNS: Turns = { open: false, phase: 'prep', round: 1, currentId: null, entries: [] }

export function defaultTurns(): Turns {
  return { ...DEFAULT_TURNS, entries: [] }
}

function isConsistent(t: Turns): boolean {
  const ids = new Set(t.entries.map((e) => e.id))
  if (ids.size !== t.entries.length) return false
  return t.phase === 'prep' ? t.currentId === null : t.currentId !== null && ids.has(t.currentId)
}

/** Lê o JSON guardado; ausente, inválido ou incoerente vira o padrão. */
export function parseTurns(raw: unknown): Turns {
  const parsed = TurnsSchema.safeParse(raw)
  return parsed.success && isConsistent(parsed.data) ? parsed.data : defaultTurns()
}

// ---- Ações (todas só do mestre; entram no OpSchema do protocolo)

export const TurnsOpenOpSchema = z.object({ kind: z.literal('turnsOpen'), open: z.boolean() })
export const TurnAddOpSchema = z.object({
  kind: z.literal('turnAdd'),
  entry: z.strictObject({ id: IdSchema, name: TurnNameSchema, tokenId: IdSchema.nullable().optional() }),
})
export const TurnDuplicateOpSchema = z.object({ kind: z.literal('turnDuplicate'), id: IdSchema, newId: IdSchema })
export const TurnUpdateOpSchema = z.object({
  kind: z.literal('turnUpdate'),
  id: IdSchema,
  patch: z
    .strictObject({ name: TurnNameSchema, initiative: InitiativeSchema.nullable() })
    .partial()
    .refine((p) => p.name !== undefined || p.initiative !== undefined, 'empty turn patch'),
})
export const TurnRemoveOpSchema = z.object({ kind: z.literal('turnRemove'), id: IdSchema })
export const TurnMoveOpSchema = z.object({
  kind: z.literal('turnMove'),
  id: IdSchema,
  index: z.number().int().min(0).max(TURNS_MAX - 1),
})
export const TurnsRollOpSchema = z.object({ kind: z.literal('turnsRoll'), all: z.boolean() })
export const TurnsStartOpSchema = z.object({ kind: z.literal('turnsStart') })
export const TurnNextOpSchema = z.object({ kind: z.literal('turnNext') })
export const TurnPrevOpSchema = z.object({ kind: z.literal('turnPrev') })
export const TurnsEndOpSchema = z.object({ kind: z.literal('turnsEnd'), keep: z.boolean() })

export type TurnOp =
  | z.infer<typeof TurnsOpenOpSchema>
  | z.infer<typeof TurnAddOpSchema>
  | z.infer<typeof TurnDuplicateOpSchema>
  | z.infer<typeof TurnUpdateOpSchema>
  | z.infer<typeof TurnRemoveOpSchema>
  | z.infer<typeof TurnMoveOpSchema>
  | z.infer<typeof TurnsRollOpSchema>
  | z.infer<typeof TurnsStartOpSchema>
  | z.infer<typeof TurnNextOpSchema>
  | z.infer<typeof TurnPrevOpSchema>
  | z.infer<typeof TurnsEndOpSchema>

export const TURN_OP_KINDS: ReadonlySet<string> = new Set<TurnOp['kind']>([
  'turnsOpen', 'turnAdd', 'turnDuplicate', 'turnUpdate', 'turnRemove', 'turnMove',
  'turnsRoll', 'turnsStart', 'turnNext', 'turnPrev', 'turnsEnd',
])

// ---- Regras (as mesmas no servidor e na aplicação otimista do cliente)

/** "Goblin" → "Goblin 2"; "Goblin 2" → "Goblin 3" (próximo número livre). Corta a base para caber em 32. */
export function duplicateName(entries: TurnEntry[], name: string): string {
  const base = name.replace(/ \d+$/, '') || name
  const taken = new Set(entries.map((e) => e.name))
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`
    const candidate = `${base.slice(0, TURN_NAME_MAX - suffix.length).trimEnd()}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Do maior para o menor; empate mantém a ordem atual; sem iniciativa vai para o fim. */
export function sortByInitiative(entries: TurnEntry[]): TurnEntry[] {
  const rank = (e: TurnEntry) => e.initiative ?? Number.NEGATIVE_INFINITY
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(b.e) - rank(a.e) || a.i - b.i)
    .map((x) => x.e)
}

const indexOf = (turns: Turns, id: string) => turns.entries.findIndex((e) => e.id === id)

/**
 * Aplica uma ação de turno; `null` = inválida (fase errada, id inexistente, limite).
 * `d20` só existe no servidor: sem ele, um `turnsRoll` válido devolve `turns` sem mudar (o cliente espera o resultado).
 */
export function applyTurnOp(turns: Turns, op: TurnOp, d20?: () => number): Turns | null {
  const { entries } = turns
  switch (op.kind) {
    case 'turnsOpen':
      return { ...turns, open: op.open }
    case 'turnAdd': {
      if (entries.length >= TURNS_MAX || indexOf(turns, op.entry.id) !== -1) return null
      const added: TurnEntry = { id: op.entry.id, name: op.entry.name, tokenId: op.entry.tokenId ?? null, initiative: null }
      return { ...turns, entries: [...entries, added] }
    }
    case 'turnDuplicate': {
      const i = indexOf(turns, op.id)
      if (i === -1 || entries.length >= TURNS_MAX || indexOf(turns, op.newId) !== -1) return null
      const copy: TurnEntry = { id: op.newId, name: duplicateName(entries, entries[i].name), tokenId: entries[i].tokenId, initiative: null }
      return { ...turns, entries: [...entries.slice(0, i + 1), copy, ...entries.slice(i + 1)] }
    }
    case 'turnUpdate': {
      const i = indexOf(turns, op.id)
      if (i === -1) return null
      const updated: TurnEntry = {
        ...entries[i],
        ...(op.patch.name !== undefined ? { name: op.patch.name } : {}),
        ...(op.patch.initiative !== undefined ? { initiative: op.patch.initiative } : {}),
      }
      return { ...turns, entries: entries.map((e, j) => (j === i ? updated : e)) }
    }
    case 'turnRemove': {
      const i = indexOf(turns, op.id)
      if (i === -1) return null
      const rest = entries.filter((_, j) => j !== i)
      if (turns.phase === 'combat' && rest.length === 0) return { ...turns, phase: 'prep', round: 1, currentId: null, entries: [] }
      const currentId = turns.currentId === op.id ? (rest[i] ?? rest[0]).id : turns.currentId
      return { ...turns, entries: rest, currentId }
    }
    case 'turnMove': {
      const i = indexOf(turns, op.id)
      if (i === -1 || op.index >= entries.length) return null
      const rest = entries.filter((_, j) => j !== i)
      rest.splice(op.index, 0, entries[i])
      return { ...turns, entries: rest }
    }
    case 'turnsRoll': {
      if (turns.phase !== 'prep') return null
      const rolls = (e: TurnEntry) => op.all || e.initiative === null
      if (!entries.some(rolls)) return null
      if (!d20) return turns
      const rolled = entries.map((e) => (rolls(e) ? { ...e, initiative: d20() } : e))
      return { ...turns, entries: sortByInitiative(rolled) }
    }
    case 'turnsStart':
      if (turns.phase !== 'prep' || entries.length === 0) return null
      return { ...turns, open: true, phase: 'combat', round: 1, currentId: entries[0].id }
    case 'turnNext':
    case 'turnPrev': {
      if (turns.phase !== 'combat') return null
      const i = entries.findIndex((e) => e.id === turns.currentId)
      if (i === -1) return null
      if (op.kind === 'turnNext') {
        const wraps = i === entries.length - 1
        return { ...turns, currentId: entries[wraps ? 0 : i + 1].id, round: wraps ? turns.round + 1 : turns.round }
      }
      const wraps = i === 0
      return {
        ...turns,
        currentId: entries[wraps ? entries.length - 1 : i - 1].id,
        round: wraps ? Math.max(1, turns.round - 1) : turns.round,
      }
    }
    case 'turnsEnd':
      if (turns.phase !== 'combat') return null
      return {
        ...turns,
        phase: 'prep',
        round: 1,
        currentId: null,
        entries: op.keep ? entries.map((e) => ({ ...e, initiative: null })) : [],
      }
  }
}
