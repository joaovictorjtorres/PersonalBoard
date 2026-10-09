import { describe, expect, it } from 'vitest'
import type { Op } from '@mesa/shared'
import { confirmStore, settleConfirm } from '../src/ui/confirm'
import { confirmRemoveMember, removeMemberChoice } from '../src/ui/removeMember'

describe('excluir jogador', () => {
  it('texto e botões do aviso', () => {
    expect(removeMemberChoice('Ana')).toEqual({
      title: 'Excluir Ana da mesa?',
      message: 'Escolha o que acontece com os desenhos e tokens criados por Ana.',
      confirmLabel: 'Excluir e manter as coisas',
      alternativeLabel: 'Excluir e apagar as coisas dele',
      alternativeDanger: true,
    })
  })

  it('manter → deleteItems false; apagar → true; cancelar não envia', async () => {
    const sent: Op[] = []
    const submit = (op: Op) => (sent.push(op), true)
    const ana = { clientId: 'a', nickname: 'Ana' }
    let p = confirmRemoveMember(ana, submit)
    settleConfirm(true)
    await p
    p = confirmRemoveMember(ana, submit)
    settleConfirm('alternative')
    await p
    p = confirmRemoveMember(ana, submit)
    settleConfirm(false)
    await p
    expect(sent).toEqual([
      { kind: 'memberRemove', clientId: 'a', deleteItems: false },
      { kind: 'memberRemove', clientId: 'a', deleteItems: true },
    ])
    expect(confirmStore.getState().request).toBeNull()
  })
})
