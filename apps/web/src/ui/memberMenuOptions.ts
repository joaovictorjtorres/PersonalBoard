import type { Member, MemberPatch } from '@mesa/shared'

const NICKNAME_MAX = 32
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/**
 * "Conversa privada" não aparece para si mesmo; "Editar apelido e cor" e "Apagar desenhos de…" são só
 * do mestre (inclusive sobre si mesmo).
 */
export function memberMenuOptions(
  targetId: string,
  selfId: string | undefined,
  isGm: boolean,
): { dm: boolean; edit: boolean; clear: boolean } {
  return { dm: targetId !== selfId, edit: isGm, clear: isGm }
}

/** Patch só com o que mudou; null quando não há nada válido a enviar. */
export function memberPatch(member: Pick<Member, 'nickname' | 'color'>, nickname: string, color: string): MemberPatch | null {
  const patch: MemberPatch = {}
  const name = nickname.trim().slice(0, NICKNAME_MAX)
  if (name && name !== member.nickname) patch.nickname = name
  if (COLOR_RE.test(color) && color.toLowerCase() !== member.color.toLowerCase()) patch.color = color.toLowerCase()
  return patch.nickname !== undefined || patch.color !== undefined ? patch : null
}
