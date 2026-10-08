import { expect } from 'vitest'
import { DEFAULT_LAYERS } from '@mesa/shared'
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
}
