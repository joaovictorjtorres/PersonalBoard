import { describe, expect, it } from 'vitest'
import type { TableObject } from '@mesa/shared'
import { inverseGroupOf, inverseOf } from '../src/store/undo'

const obj: TableObject = {
  id: 't1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
  x: 1, y: 2, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'c', version: 3, updatedBy: 'c', control: { mode: 'list', clientIds: ['c'] },
}

describe('inverseOf', () => {
  it('create → delete', () => {
    const { ownerId, version, updatedBy, control, ...object } = obj
    expect(inverseOf({ kind: 'create', object }, null)).toEqual({ kind: 'delete', id: 't1' })
  })

  it('delete → create sem campos de servidor', () => {
    const inv = inverseOf({ kind: 'delete', id: 't1' }, obj)
    expect(inv).toEqual({
      kind: 'create',
      object: { id: 't1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64), x: 1, y: 2, width: 70, height: 70, rotation: 0, zIndex: 1 },
    })
  })

  it('update → update com valores anteriores só das chaves alteradas', () => {
    expect(inverseOf({ kind: 'update', id: 't1', patch: { x: 50, rotation: 90 } }, obj)).toEqual({
      kind: 'update', id: 't1', patch: { x: 1, rotation: 0 },
    })
  })

  it('sem before não há inversa para update/delete', () => {
    expect(inverseOf({ kind: 'delete', id: 't1' }, null)).toBeNull()
    expect(inverseOf({ kind: 'update', id: 't1', patch: { x: 1 } }, null)).toBeNull()
  })

  it('update de title sem título anterior desfaz com null; com título volta o antigo', () => {
    expect(inverseOf({ kind: 'update', id: 't1', patch: { title: 'Orc' } }, obj)).toEqual({ kind: 'update', id: 't1', patch: { title: null } })
    expect(inverseOf({ kind: 'update', id: 't1', patch: { title: null } }, { ...obj, title: 'Orc' })).toEqual({
      kind: 'update', id: 't1', patch: { title: 'Orc' },
    })
  })
})

describe('inverseGroupOf', () => {
  it('mestre desfazendo delete recria e devolve o controle anterior', () => {
    const group = inverseGroupOf({ kind: 'delete', id: 't1' }, obj, 'gm')
    expect(group).toHaveLength(2)
    expect(group?.[0]).toMatchObject({ kind: 'create' })
    expect(group?.[1]).toEqual({ kind: 'update', id: 't1', patch: { control: obj.control } })
  })

  it('jogador desfazendo delete só recria; outras ops têm uma inversa', () => {
    expect(inverseGroupOf({ kind: 'delete', id: 't1' }, obj, 'player')).toEqual([inverseOf({ kind: 'delete', id: 't1' }, obj)])
    expect(inverseGroupOf({ kind: 'update', id: 't1', patch: { x: 5 } }, obj, 'gm')).toHaveLength(1)
    expect(inverseGroupOf({ kind: 'delete', id: 't1' }, null, 'gm')).toBeNull()
  })
})
