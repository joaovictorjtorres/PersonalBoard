import type { Member, Op } from '@mesa/shared'
import { askChoice, type ConfirmOptions } from './confirm'

export function removeMemberChoice(nickname: string): ConfirmOptions {
  return {
    title: `Excluir ${nickname} da mesa?`,
    message: `Escolha o que acontece com os desenhos e tokens criados por ${nickname}.`,
    confirmLabel: 'Excluir e manter as coisas',
    alternativeLabel: 'Excluir e apagar as coisas dele',
    alternativeDanger: true,
  }
}

/** Aviso do app com três botões; Cancelar não envia nada. */
export async function confirmRemoveMember(member: Pick<Member, 'clientId' | 'nickname'>, submit: (op: Op) => boolean): Promise<void> {
  const answer = await askChoice(removeMemberChoice(member.nickname))
  if (answer === 'cancel') return
  submit({ kind: 'memberRemove', clientId: member.clientId, deleteItems: answer === 'alternative' })
}
