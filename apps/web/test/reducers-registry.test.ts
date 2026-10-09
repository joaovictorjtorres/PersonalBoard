import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member } from '@mesa/shared'
import { reduceServer } from '../src/store/reducers'
import { makeInitialState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Ana', color: '#e6194b', role: 'player', online: true }
const joined = () =>
  reduceServer(
    makeInitialState(),
    {
      t: 'welcome',
      self: me,
      snapshot: { meta: { id: 'T', name: 'Antigo' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
    },
    0,
  )

describe('mesa renomeada e apagada', () => {
  it('tableRenamed troca o nome mostrado', () => {
    expect(reduceServer(joined(), { t: 'tableRenamed', name: 'Nova' }, 0).meta?.name).toBe('Nova')
  })

  it('error table_deleted vira fatal e fecha', () => {
    const s = reduceServer(joined(), { t: 'error', reason: 'table_deleted' }, 0)
    expect(s.fatal).toBe('table_deleted')
    expect(s.status).toBe('closed')
  })
})
