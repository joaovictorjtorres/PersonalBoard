import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { TableObjectSchema } from '@mesa/shared'
import { normalizeObject } from '../src/engine/migrate'
import { SqlStore } from '../src/engine/sql-store'
import { MemoryStore } from '../src/engine/memory-store'
import { checkStoreContract } from './store-contract'

const freshStub = () => env.TABLES.get(env.TABLES.idFromName(`store-${crypto.randomUUID()}`))

const m1Stroke = {
  id: 'old_stroke', type: 'stroke', layerId: 'drawings', x: 5, y: 6, width: 10, height: 0, rotation: 0, zIndex: 1,
  points: [0, 0, 10, 0], color: '#ffffff', strokeWidth: 3, ownerId: 'A', version: 2, updatedBy: 'A',
}
const m1Image = {
  id: 'old_image', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64), x: 0, y: 0, width: 70, height: 70,
  rotation: 0, zIndex: 1, ownerId: 'B', version: 1, updatedBy: 'B',
}

describe('SqlStore — migração do M1', () => {
  it('traço com points vira segments e objeto sem control ganha a lista do dono', async () => {
    await runInDurableObject(freshStub(), (_instance, state) => {
      const store = new SqlStore(state.storage.sql)
      for (const o of [m1Stroke, m1Image]) {
        state.storage.sql.exec(
          'INSERT INTO objects (id, layer_id, type, data, version) VALUES (?, ?, ?, ?, ?)',
          o.id, o.layerId, o.type, JSON.stringify(o), o.version,
        )
      }
      const stroke = store.getObject('old_stroke')
      expect(stroke).toMatchObject({ segments: [[0, 0, 10, 0]], control: { mode: 'list', clientIds: ['A'] } })
      expect(stroke).not.toHaveProperty('points')
      expect(store.getObject('old_image')?.control).toEqual({ mode: 'list', clientIds: ['B'] })
      const all = store.listObjects()
      expect(all).toHaveLength(2)
      for (const o of all) expect(TableObjectSchema.safeParse(o).success).toBe(true)
    })
  })

  it('ponto único do M1 vira pedaço válido; objeto já no formato novo não muda', () => {
    const single = normalizeObject({ ...m1Stroke, points: [3, 4] })
    expect(single).toMatchObject({ segments: [[3, 4, 3.01, 4]] })
    const current = { ...m1Image, control: { mode: 'all', clientIds: [] } }
    expect(normalizeObject(current)).toEqual(current)
  })

  it('configurações gravadas com JSON parcial voltam completas', async () => {
    await runInDurableObject(freshStub(), (_instance, state) => {
      const store = new SqlStore(state.storage.sql)
      state.storage.sql.exec('INSERT INTO settings (id, data) VALUES (1, ?)', JSON.stringify({ grid: { enabled: true } }))
      expect(store.getSettings()).toEqual({ grid: { enabled: true, size: 70, snap: false } })
    })
  })
})

describe('contrato do TableStore', () => {
  it('MemoryStore', () => {
    checkStoreContract(new MemoryStore())
  })

  it('SqlStore', async () => {
    await runInDurableObject(freshStub(), (_instance, state) => {
      checkStoreContract(new SqlStore(state.storage.sql))
    })
  })
})
