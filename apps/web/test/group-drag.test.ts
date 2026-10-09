import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ServerMessage } from '@mesa/shared'
import { reduceServer } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const joined = (): TableState =>
  reduceServer(makeInitialState(), {
    t: 'welcome', self: me,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS, objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  }, 0)
const drag = (clientId: string): ServerMessage => ({
  t: 'presence', clientId, p: { kind: 'groupDrag', x: 1, y: 2, width: 3, height: 4, layerIds: ['tokens'] },
})

describe('contorno do arrasto em grupo', () => {
  it('chega com a caixa; some no fim, quando a pessoa sai e quando o lote dela chega', () => {
    let s = reduceServer(joined(), drag('bia'), 0)
    expect(s.groupDrags).toEqual({ bia: { x: 1, y: 2, width: 3, height: 4 } })
    s = reduceServer(s, { t: 'presence', clientId: 'bia', p: { kind: 'groupDragEnd' } }, 0)
    expect(s.groupDrags).toEqual({})
    s = reduceServer(s, drag('bia'), 0)
    s = reduceServer(s, { t: 'memberLeft', clientId: 'bia' }, 0)
    expect(s.groupDrags).toEqual({})
    s = reduceServer(s, drag('bia'), 0)
    s = reduceServer(s, { t: 'batch', by: 'bia', ops: [] }, 0)
    expect(s.groupDrags).toEqual({})
  })
})
