import { TURN_NAME_MAX, applyTurnOp, isTurnOp, type ImageObject, type Op, type Turns } from '@mesa/shared'
import type { PendingOp, TableState } from './state'

/** Confirmados + ações de turno pendentes, na ordem de envio. A rolagem não muda nada aqui: espera o servidor. */
export function replayTurns(confirmed: Turns, pending: Record<string, PendingOp>): Turns {
  let turns = confirmed
  for (const p of Object.values(pending)) if (isTurnOp(p.op)) turns = applyTurnOp(turns, p.op) ?? turns
  return turns
}

export function recomputeTurns<S extends TableState>(s: S, pending: Record<string, PendingOp> = s.pending): S {
  const turns = replayTurns(s.confirmedTurns, pending)
  return turns === s.turns ? s : { ...s, turns }
}

/** No ack, a ação passa a valer na base confirmada; o turnsUpdated que chega logo depois traz o mesmo estado. */
export function ackTurnOp(confirmed: Turns, op: Op): Turns {
  return isTurnOp(op) ? (applyTurnOp(confirmed, op) ?? confirmed) : confirmed
}

/** Imagem do token ligado a uma entrada, se eu a tenho no estado (apagada ou em camada oculta: undefined). */
export function linkedImage(s: Pick<TableState, 'objects'>, tokenId: string | null | undefined): ImageObject | undefined {
  const object = tokenId ? s.objects[tokenId] : undefined
  return object?.type === 'image' ? object : undefined
}

/** Token da vez para o anel: só no combate e só se eu tenho o objeto (imagem) no estado. */
export function currentTurnToken(s: Pick<TableState, 'turns' | 'objects'>): ImageObject | null {
  if (s.turns.phase !== 'combat') return null
  const entry = s.turns.entries.find((e) => e.id === s.turns.currentId)
  return linkedImage(s, entry?.tokenId) ?? null
}

/** Nome da entrada criada pelo token: o título (cortado em 32) ou "Token". */
export function turnNameFor(title: string | undefined): string {
  return (title ?? '').trim().slice(0, TURN_NAME_MAX).trim() || 'Token'
}

/** Imagem sob o card em foco: só enquanto o card ainda existe (remover o card sob o mouse não dispara pointerleave). */
export function hoveredTurnImage(s: Pick<TableState, 'turns' | 'objects' | 'turnHover'>): ImageObject | null {
  if (!s.turnHover || !s.turns.entries.some((e) => e.tokenId === s.turnHover)) return null
  return linkedImage(s, s.turnHover) ?? null
}

/** Há uma rolagem de iniciativa esperando o servidor (evita rolar duas vezes com clique duplo). */
export function isRollPending(s: Pick<TableState, 'pending'>): boolean {
  return Object.values(s.pending).some((p) => p.op.kind === 'turnsRoll')
}
