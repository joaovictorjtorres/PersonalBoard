import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, MAX_SEGMENTS, NewObjectSchema, type NewObject, type ObjectOp, type TableObject } from '@mesa/shared'
import { collectSelection, type SelectionArea } from '../src/selection/model'
import { planControl, planDelete, planMove, planToLayer, type PlanInput } from '../src/selection/plan'
import { strokeAt, tokenAt } from './selection-fixtures'

const rect = (x: number, y: number, width: number, height: number): SelectionArea => ({ kind: 'rect', rect: { x, y, width, height } })
const byId = (objects: TableObject[]) => Object.fromEntries(objects.map((o) => [o.id, o]))

function input(objects: TableObject[], area: SelectionArea, over: Partial<PlanInput> = {}): PlanInput {
  const role = over.role ?? 'player'
  const selection = collectSelection([area], {
    objects: byId(objects), layers: DEFAULT_LAYERS, activeLayerId: 'drawings', allLayers: false,
    selfId: over.selfId ?? 'me', role, isLocked: () => false,
  })!
  let n = 0
  return {
    selection, objects: byId(objects), selfId: 'me', role, newId: () => `n${++n}`, nextZ: () => 10,
    grid: { enabled: true, size: 70, snap: false }, ...over,
  }
}

const line = strokeAt('l', [0, 50, 200, 50], { title: 'Rio' })
const t1 = tokenAt('t1', 60, 40)
const area = rect(50, 0, 100, 100)
const stroke = (o: Partial<NewObject>) => ({ type: 'stroke', rotation: 0, color: '#ffffff', strokeWidth: 2, ...o })

const piece = (from: string, o: Partial<NewObject>): ObjectOp => ({ kind: 'create', object: stroke(o) as NewObject, from })

/** Os pedaços de X vêm antes do `delete` de X (o cliente copia dono e controle de objects[X]). */
function piecesBeforeDelete(batch: ObjectOp[]): boolean {
  return batch.every((op, i) => op.kind !== 'create' || op.from === undefined || batch.slice(0, i).every((p) => p.kind !== 'delete' || p.id !== op.from))
}

describe('planMove', () => {
  it('itens inteiros: update de posição; traço cortado: cria os pedaços (o de dentro já no lugar novo) e depois apaga o original', () => {
    const plan = planMove(input([line, t1], area), 10, 100)
    expect(plan.batches).toEqual([[
      { kind: 'update', id: 't1', patch: { x: 70, y: 140, zIndex: 4 } },
      piece('l', { id: 'n1', layerId: 'drawings', x: 0, y: 50, width: 200, height: 0, zIndex: 1, segments: [[0, 0, 50, 0], [150, 0, 200, 0]], title: 'Rio' }),
      piece('l', { id: 'n2', layerId: 'drawings', x: 60, y: 150, width: 100, height: 0, zIndex: 3, segments: [[0, 0, 100, 0]] }),
      { kind: 'delete', id: 'l' },
    ]])
    expect(plan.selectAfter).toEqual(['t1', 'n2'])
  })

  it('com encaixe ligado, imagens caem na grade', () => {
    const plan = planMove(input([t1], area, { grid: { enabled: true, size: 50, snap: true } }), 10, 100)
    expect(plan.batches[0]).toEqual([{ kind: 'update', id: 't1', patch: { x: 50, y: 150, zIndex: 3 } }])
  })

  it('o que se move vai para o topo da própria camada, na ordem relativa de antes; o resto da camada não muda', () => {
    const a = tokenAt('a', 60, 10, { zIndex: 7 })
    const b = tokenAt('b', 100, 10, { zIndex: 2 })
    const top = tokenAt('top', 400, 400, { zIndex: 9 })
    const map = tokenAt('m', 60, 60, { layerId: 'map', zIndex: 50 })
    const plan = planMove(input([a, b, top, map], area), 5, 0)
    expect(plan.batches[0]).toEqual([
      { kind: 'update', id: 'a', patch: { x: 65, y: 10, zIndex: 11 } },
      { kind: 'update', id: 'b', patch: { x: 105, y: 10, zIndex: 10 } },
    ])
  })

  it('mestre cortando o traço de outra pessoa: um lote só; os pedaços vêm do original (herdam dono e controle)', () => {
    const theirs = strokeAt('l', [0, 50, 200, 50], { ownerId: 'bia', control: { mode: 'list', clientIds: ['bia'] } })
    const plan = planMove(input([theirs], area, { role: 'gm' }), 0, 10)
    expect(plan.batches).toHaveLength(1)
    expect(plan.batches[0].map((op) => [op.kind, op.kind === 'create' ? op.from : op.id])).toEqual([
      ['create', 'l'],
      ['create', 'l'],
      ['delete', 'l'],
    ])
  })
})

describe('planDelete', () => {
  it('apaga os inteiros; do traço cortado sobra só o pedaço de fora', () => {
    const plan = planDelete(input([line, t1], area))
    expect(plan.batches).toEqual([[
      { kind: 'delete', id: 't1' },
      piece('l', { id: 'n1', layerId: 'drawings', x: 0, y: 50, width: 200, height: 0, zIndex: 1, segments: [[0, 0, 50, 0], [150, 0, 200, 0]], title: 'Rio' }),
      { kind: 'delete', id: 'l' },
    ]])
    expect(plan.selectAfter).toEqual([])
  })

  it('traço em zigue-zague cortado em centenas de pedaços continua válido no schema', () => {
    const zig: number[] = []
    for (let i = 0; i <= 300; i++) zig.push(i * 2, i % 2 === 0 ? 0 : 100)
    const plan = planDelete(input([strokeAt('z', zig)], rect(-10, 40, 700, 20)))
    const created = plan.batches[0].filter((op): op is Extract<ObjectOp, { kind: 'create' }> => op.kind === 'create')
    expect(created).toHaveLength(1)
    expect(created[0].from).toBe('z')
    const object = created[0].object as Extract<NewObject, { type: 'stroke' }>
    expect(object.segments.length).toBeLessThanOrEqual(MAX_SEGMENTS)
    expect(NewObjectSchema.safeParse(object).success).toBe(true)
  })
})

describe('planToLayer', () => {
  it('mestre: troca a camada no topo do destino; o pedaço de dentro vai para a camada nova, o de fora fica', () => {
    const plan = planToLayer(input([line, t1], area, { role: 'gm' }), 'tokens')
    expect(plan.batches).toEqual([[
      { kind: 'update', id: 't1', patch: { layerId: 'tokens', zIndex: 10 } },
      piece('l', { id: 'n1', layerId: 'drawings', x: 0, y: 50, width: 200, height: 0, zIndex: 1, segments: [[0, 0, 50, 0], [150, 0, 200, 0]], title: 'Rio' }),
      piece('l', { id: 'n2', layerId: 'tokens', x: 50, y: 50, width: 100, height: 0, zIndex: 11, segments: [[0, 0, 100, 0]] }),
      { kind: 'delete', id: 'l' },
    ]])
    expect(plan.selectAfter).toEqual([])
  })

  it('itens que já estão no destino são pulados', () => {
    expect(planToLayer(input([line, t1], area, { role: 'gm' }), 'drawings').batches.flat()).toEqual([])
  })

  it('jogador: pedaço de traço nunca muda de camada (o traço cortado fica como está)', () => {
    const ops = planToLayer(input([line, t1], area), 'tokens').batches.flat()
    expect(ops.filter((op) => op.kind === 'create' && op.object.layerId !== 'drawings')).toEqual([])
    expect(ops.some((op) => op.kind !== 'update' && (op.kind === 'create' ? op.from : op.id) === 'l')).toBe(false)
  })
})

describe('ordem dos lotes de corte', () => {
  it('em mover, apagar e mudar de camada, os pedaços vêm antes do delete do original', () => {
    const two = [line, strokeAt('m', [0, 70, 200, 70]), t1]
    for (const plan of [planMove(input(two, area), 5, 5), planDelete(input(two, area)), planToLayer(input(two, area, { role: 'gm' }), 'tokens')]) {
      expect(plan.batches).toHaveLength(1)
      expect(plan.batches[0].some((op) => op.kind === 'create' && op.from === 'm')).toBe(true)
      expect(piecesBeforeDelete(plan.batches[0])).toBe(true)
    }
  })
})

describe('planControl', () => {
  it('um update por token inteiro; traços e formas ficam de fora; a seleção é mantida', () => {
    const control = { mode: 'all' as const, clientIds: [] }
    const plan = planControl(input([t1, strokeAt('s', [60, 50, 80, 50])], area, { role: 'gm' }), control)
    expect(plan).toEqual({ batches: [[{ kind: 'update', id: 't1', patch: { control } }]], selectAfter: null })
  })
})
