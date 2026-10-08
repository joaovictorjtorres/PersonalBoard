import { expect } from 'vitest'
import { CHAT_HISTORY_LIMIT, DEFAULT_LAYERS, DEFAULT_SETTINGS } from '@mesa/shared'
import type { TableStore } from '../src/engine/store'

/** Verificações síncronas válidas para qualquer TableStore recém-criado. */
export function checkStoreContract(store: TableStore): void {
  store.initTable({ id: 'T', name: 'Mesa', gmSecretHash: 'h', createdAt: 0 }, DEFAULT_LAYERS)

  store.putLayer({ id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false })
  store.putLayer({ ...DEFAULT_LAYERS[3], order: 4 })
  expect(store.getLayers().map((l) => `${l.id}:${l.order}`)).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
  store.putLayer({ id: 'nova', name: 'Renomeada', order: 3, visibility: 'gm', locked: true })
  expect(store.getLayers().find((l) => l.id === 'nova')).toEqual({ id: 'nova', name: 'Renomeada', order: 3, visibility: 'gm', locked: true })
  store.deleteLayer('nova')
  expect(store.getLayers().map((l) => l.id)).toEqual(['map', 'tokens', 'drawings', 'gm'])

  store.setNote('o1', 'segredo')
  store.setNote('o2', 'outra')
  store.setNote('o2', 'outra editada')
  expect(store.listNotes()).toEqual({ o1: 'segredo', o2: 'outra editada' })
  store.setNote('o1', '')
  store.deleteNote('o2')
  expect(store.listNotes()).toEqual({})

  store.upsertMember({ clientId: 'A', nickname: 'Ana', color: '#e6194b', role: 'player', lastSeenAt: 1 })
  store.deleteMember('A')
  expect(store.getMember('A')).toBeNull()
  expect(store.listMembers()).toEqual([])

  // M3 — configurações
  expect(store.getSettings()).toEqual(DEFAULT_SETTINGS)
  store.putSettings({ grid: { enabled: true, size: 50, snap: true } })
  expect(store.getSettings()).toEqual({ grid: { enabled: true, size: 50, snap: true } })
  store.getSettings().grid.size = 999 // o retorno é cópia: mexer nele não altera o guardado
  expect(store.getSettings().grid.size).toBe(50)

  // M3 — chat: só as últimas 200, da mais antiga para a mais nova
  expect(store.listChat()).toEqual([])
  for (let i = 0; i < CHAT_HISTORY_LIMIT + 5; i++) {
    store.appendChat({ id: `m${i}`, at: i, authorId: 'A', kind: 'message', text: `t${i}` })
  }
  const chat = store.listChat()
  expect(chat).toHaveLength(CHAT_HISTORY_LIMIT)
  expect(chat[0]).toEqual({ id: 'm5', at: 5, authorId: 'A', kind: 'message', text: 't5' })
  expect(chat.at(-1)?.id).toBe('m204')

  // M3 — marcas do mestre no membro
  store.upsertMember({ clientId: 'B', nickname: 'Bia', color: '#3cb44b', role: 'player', lastSeenAt: 1, nicknameSetByGm: true, colorSetByGm: true })
  expect(store.getMember('B')).toMatchObject({ nicknameSetByGm: true, colorSetByGm: true })
}
