import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYERS, type TableObject } from '@mesa/shared'
import { confirmClear, planLayerDrawings, planLayerEverything, planMember, planMine } from '../src/ui/clearPlans'
import { confirmStore, settleConfirm } from '../src/ui/confirm'

afterEach(() => settleConfirm(false))

const box = { x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1, version: 1 }
const own = (id: string) => ({ ownerId: id, updatedBy: id, control: { mode: 'list' as const, clientIds: [id] } })
const stroke = (id: string, layerId: string, owner: string) =>
  ({ ...box, ...own(owner), id, layerId, type: 'stroke', segments: [[0, 0, 1, 1]], color: '#ffffff', strokeWidth: 2 }) as TableObject
const image = (id: string, layerId: string, owner: string) =>
  ({ ...box, ...own(owner), id, layerId, type: 'image', assetKey: 'a'.repeat(64) }) as TableObject
const objects = Object.fromEntries(
  [stroke('a1', 'drawings', 'A'), stroke('a2', 'tokens', 'A'), stroke('b1', 'drawings', 'B'), image('i1', 'drawings', 'A')].map((o) => [o.id, o]),
)
const layers = DEFAULT_LAYERS.filter((l) => l.id !== 'gm')

describe('planos de limpeza', () => {
  const player = { objects, layers, self: { clientId: 'A', role: 'player' as const } }
  const gm = { objects, layers: DEFAULT_LAYERS, self: { clientId: 'G', role: 'gm' as const } }

  it('meus desenhos: conta e texto com a camada ou o número de camadas', () => {
    const here = planMine(player, 'drawings')
    expect(here.op).toEqual({ kind: 'clearObjects', layerId: 'drawings', authorId: 'A', scope: 'drawings' })
    expect(here.count).toBe(1)
    expect(here.message).toContain('1 desenho seu na camada Desenhos')
    expect(planMine(player, null).message).toContain('2 desenhos seus em 2 camadas')
  })

  it('mestre: de alguém, de todos na camada e a camada inteira', () => {
    expect(planMember(gm, { clientId: 'B', nickname: 'Bia' }, 'drawings')).toMatchObject({ count: 1, title: 'Apagar desenhos de Bia' })
    expect(planLayerDrawings(gm, 'drawings').count).toBe(2)
    const all = planLayerEverything(gm, 'drawings')
    expect(all.count).toBe(3)
    expect(all.message).toContain('A camada continua existindo')
  })

  it('confirmClear: envia só se confirmado; sem nada a apagar não abre o aviso', async () => {
    const submit = vi.fn()
    const plan = planMine(player, 'drawings')
    const pending = confirmClear(plan, submit)
    expect(confirmStore.getState().request?.danger).toBe(true)
    settleConfirm(true)
    await expect(pending).resolves.toBe(true)
    expect(submit).toHaveBeenCalledWith(plan.op)

    const cancelled = confirmClear(plan, submit)
    settleConfirm(false)
    await expect(cancelled).resolves.toBe(false)
    expect(submit).toHaveBeenCalledTimes(1)

    await expect(confirmClear(planMine(player, 'map'), submit)).resolves.toBe(false)
    expect(confirmStore.getState().request).toBeNull()
  })
})
