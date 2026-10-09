import { describe, expect, it } from 'vitest'
import { BATCH_MAX, ClientMessageSchema, ObjectPatchSchema, OpSchema, RULER_MAX_POINTS, TableObjectSchema, isObjectOp, isTurnOp, readChatReqId, readOpId } from '../src'

const uuid = '3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192'
const image = {
  id: 'tok1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
  x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 1,
}

describe('ClientMessageSchema', () => {
  it('aceita hello válido e apara o apelido', () => {
    const r = ClientMessageSchema.parse({ t: 'hello', clientId: uuid, nickname: '  Ana  ' })
    expect(r).toEqual({ t: 'hello', clientId: uuid, nickname: 'Ana' })
  })

  it('recusa apelido só com espaços', () => {
    expect(ClientMessageSchema.safeParse({ t: 'hello', clientId: uuid, nickname: '   ' }).success).toBe(false)
  })

  it('recusa clientId que não é uuid', () => {
    expect(ClientMessageSchema.safeParse({ t: 'hello', clientId: 'x', nickname: 'Ana' }).success).toBe(false)
  })

  it('aceita op create de imagem', () => {
    expect(ClientMessageSchema.safeParse({ t: 'op', opId: 'op_1', op: { kind: 'create', object: image } }).success).toBe(true)
  })

  it('recusa presença de traço com mais de 4000 números', () => {
    const p = { kind: 'stroke', strokeId: 's1', layerId: 'drawings', points: new Array(4002).fill(1), color: '#ffffff', strokeWidth: 4 }
    expect(ClientMessageSchema.safeParse({ t: 'presence', p }).success).toBe(false)
  })
})

describe('OpSchema', () => {
  it('recusa assetKey inválida', () => {
    expect(OpSchema.safeParse({ kind: 'create', object: { ...image, assetKey: 'nope' } }).success).toBe(false)
  })

  it('recusa traço com quantidade ímpar de coordenadas', () => {
    const stroke = { ...image, type: 'stroke', segments: [[0, 0, 1, 0, 2]], color: '#000000', strokeWidth: 3 }
    delete (stroke as Record<string, unknown>).assetKey
    expect(OpSchema.safeParse({ kind: 'create', object: stroke }).success).toBe(false)
  })

  it('recusa NaN e Infinity em coordenadas', () => {
    expect(OpSchema.safeParse({ kind: 'create', object: { ...image, x: Number.POSITIVE_INFINITY } }).success).toBe(false)
  })
})

describe('ObjectPatchSchema', () => {
  it('aceita patch parcial', () => {
    expect(ObjectPatchSchema.parse({ x: 5 })).toEqual({ x: 5 })
  })

  it('recusa campos desconhecidos ou de servidor', () => {
    expect(ObjectPatchSchema.safeParse({ version: 9 }).success).toBe(false)
    expect(ObjectPatchSchema.safeParse({ foo: 1 }).success).toBe(false)
  })

  it('recusa largura negativa', () => {
    expect(ObjectPatchSchema.safeParse({ width: -1 }).success).toBe(false)
  })
})

describe('TableObjectSchema', () => {
  it('exige campos de servidor', () => {
    const control = { mode: 'list', clientIds: ['c'] }
    expect(TableObjectSchema.safeParse(image).success).toBe(false)
    expect(TableObjectSchema.safeParse({ ...image, ownerId: 'c', version: 1, updatedBy: 'c', control }).success).toBe(true)
  })
})

describe('operações do M2', () => {
  it('aceita as operações novas', () => {
    const ops = [
      { kind: 'layerCreate', layer: { id: 'nova_1', name: 'Nova camada' } },
      { kind: 'layerUpdate', id: 'map', patch: { name: 'Masmorra', visibility: 'gm', locked: true } },
      { kind: 'layerDelete', id: 'map' },
      { kind: 'layerMove', id: 'map', direction: 'up' },
      { kind: 'noteSet', objectId: 'tok1', text: 'tem 3 PV' },
      { kind: 'memberRemove', clientId: '3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192' },
    ]
    for (const op of ops) expect(OpSchema.safeParse(op).success, op.kind).toBe(true)
  })

  // Review Focus #2
  it('recusa nome de camada só com espaços ou com mais de 40 caracteres', () => {
    expect(OpSchema.safeParse({ kind: 'layerCreate', layer: { id: 'n', name: '   ' } }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'layerUpdate', id: 'map', patch: { name: 'x'.repeat(41) } }).success).toBe(false)
    expect(OpSchema.parse({ kind: 'layerUpdate', id: 'map', patch: { name: '  Cripta ' } })).toEqual({
      kind: 'layerUpdate', id: 'map', patch: { name: 'Cripta' },
    })
  })

  it('layerUpdate recusa campos fora do patch (ex.: order)', () => {
    expect(OpSchema.safeParse({ kind: 'layerUpdate', id: 'map', patch: { order: 9 } }).success).toBe(false)
  })

  it('layerMove só aceita up/down e noteSet limita 2000 caracteres', () => {
    expect(OpSchema.safeParse({ kind: 'layerMove', id: 'map', direction: 'top' }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'noteSet', objectId: 'tok1', text: 'x'.repeat(2001) }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'noteSet', objectId: 'tok1', text: '' }).success).toBe(true)
  })

  it('isObjectOp separa operações de objeto', () => {
    expect(isObjectOp({ kind: 'delete', id: 'x' })).toBe(true)
    expect(isObjectOp({ kind: 'layerDelete', id: 'x' })).toBe(false)
  })
})

describe('readOpId', () => {
  it('lê opId de op mal formada', () => {
    expect(readOpId({ t: 'op', opId: 'op_1', op: { kind: '???' } })).toBe('op_1')
  })
  it('ignora o que não é op ou não tem opId legível', () => {
    expect(readOpId({ t: 'grab', opId: 'op_1' })).toBeNull()
    expect(readOpId({ t: 'op', opId: 42 })).toBeNull()
    expect(readOpId({ t: 'op', opId: 'x'.repeat(65) })).toBeNull()
    expect(readOpId('op')).toBeNull()
    expect(readOpId(null)).toBeNull()
  })
})

describe('hello com clientSecret', () => {
  it('aceita segredo opcional até 128 caracteres', () => {
    const base = { t: 'hello', clientId: uuid, nickname: 'Ana' }
    expect(ClientMessageSchema.safeParse({ ...base, clientSecret: 'a'.repeat(43) }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ ...base, clientSecret: 'a'.repeat(129) }).success).toBe(false)
  })
})

describe('protocolo do M3', () => {
  const d20 = { die: 20, count: 1, bonus: 0, mode: 'normal' }

  it('settingsUpdate valida a grade', () => {
    expect(OpSchema.safeParse({ kind: 'settingsUpdate', patch: { grid: { enabled: true, size: 50 } } }).success).toBe(true)
    expect(OpSchema.safeParse({ kind: 'settingsUpdate', patch: { grid: { size: 5 } } }).success).toBe(false)
  })

  it('memberUpdate: apelido aparado 1..32, cor #rrggbb, ao menos um campo, nada além disso', () => {
    expect(OpSchema.parse({ kind: 'memberUpdate', clientId: 'c', patch: { nickname: '  Bia  ' } })).toEqual({
      kind: 'memberUpdate', clientId: 'c', patch: { nickname: 'Bia' },
    })
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { color: '#123456' } }).success).toBe(true)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: {} }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { nickname: '   ' } }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { nickname: 'x'.repeat(33) } }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { color: 'red' } }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { role: 'gm' } }).success).toBe(false)
  })

  it('chatSend apara o texto e limita 500; aceita conversa privada', () => {
    expect(ClientMessageSchema.parse({ t: 'chatSend', reqId: 'c1', channel: 'table', text: '  oi  ' })).toEqual({
      t: 'chatSend', reqId: 'c1', channel: 'table', text: 'oi',
    })
    expect(ClientMessageSchema.safeParse({ t: 'chatSend', reqId: 'c1', channel: 'table', text: 'x'.repeat(501) }).success).toBe(false)
    expect(ClientMessageSchema.safeParse({ t: 'chatSend', reqId: 'c1', channel: { dm: 'abc' }, text: 'oi' }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'chatSend', reqId: '', channel: 'table', text: 'oi' }).success).toBe(false)
  })

  it('roll: pedido validado; secreta só na mesa', () => {
    expect(ClientMessageSchema.safeParse({ t: 'roll', reqId: 'r1', channel: 'table', request: d20, secret: true }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'roll', reqId: 'r1', channel: { dm: 'abc' }, request: d20, secret: false }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'roll', reqId: 'r1', channel: { dm: 'abc' }, request: d20, secret: true }).success).toBe(false)
    expect(ClientMessageSchema.safeParse({ t: 'roll', reqId: 'r1', channel: 'table', request: { ...d20, count: 51 }, secret: false }).success).toBe(false)
  })

  it('chatImage exige assetKey e lados inteiros', () => {
    const img = { t: 'chatImage', reqId: 'i1', channel: 'table', assetKey: 'a'.repeat(64), width: 300, height: 200 }
    expect(ClientMessageSchema.safeParse(img).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ ...img, assetKey: 'x' }).success).toBe(false)
    expect(ClientMessageSchema.safeParse({ ...img, width: 0 }).success).toBe(false)
  })

  it('presença de régua e ping', () => {
    const ruler = (points: unknown) => ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'ruler', points } }).success
    const pts = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i, y: -i }))
    expect(ruler(pts(2))).toBe(true)
    expect(ruler(pts(RULER_MAX_POINTS))).toBe(true)
    expect(ruler(pts(1))).toBe(false)
    expect(ruler(pts(RULER_MAX_POINTS + 1))).toBe(false)
    expect(ruler([{ x: 0, y: 0 }, { x: Infinity, y: 0 }])).toBe(false)
    expect(ruler([{ x: 0, y: 0 }, { x: NaN, y: 0 }])).toBe(false)
    expect(ruler([{ x: 0, y: 0 }, { x: '1', y: 0 }])).toBe(false)
    // formato antigo (from/to) não é mais aceito
    expect(ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'ruler', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } } }).success).toBe(false)
    expect(ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'rulerEnd' } }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'ping', x: 1, y: 2, recenter: true } }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'ping', x: 1, y: 2 } }).success).toBe(false)
  })

  it('readChatReqId lê o reqId de mensagens de chat mal formadas', () => {
    expect(readChatReqId({ t: 'chatSend', reqId: 'c1', text: 5 })).toBe('c1')
    expect(readChatReqId({ t: 'roll', reqId: 'r1' })).toBe('r1')
    expect(readChatReqId({ t: 'op', reqId: 'c1' })).toBeNull()
    expect(readChatReqId({ t: 'chatImage', reqId: 'x'.repeat(65) })).toBeNull()
    expect(readChatReqId(null)).toBeNull()
  })
})

describe('ações de turno no protocolo', () => {
  it('OpSchema aceita as ações de turno e isTurnOp as reconhece', () => {
    const ops = [
      { kind: 'turnsOpen', open: true },
      { kind: 'turnAdd', entry: { id: 'a', name: 'Ana', tokenId: 'tok1' } },
      { kind: 'turnDuplicate', id: 'a', newId: 'b' },
      { kind: 'turnUpdate', id: 'a', patch: { initiative: 12 } },
      { kind: 'turnRemove', id: 'a' },
      { kind: 'turnMove', id: 'a', index: 0 },
      { kind: 'turnsRoll', all: false },
      { kind: 'turnsStart' },
      { kind: 'turnNext' },
      { kind: 'turnPrev' },
      { kind: 'turnsEnd', keep: true },
    ]
    for (const op of ops) {
      const parsed = OpSchema.parse(op)
      expect(isTurnOp(parsed)).toBe(true)
      expect(isObjectOp(parsed)).toBe(false)
    }
    expect(isTurnOp(OpSchema.parse({ kind: 'delete', id: 'x' }))).toBe(false)
  })

  it('op de turno inválida no envelope é recusada (iniciativa fora do limite, nome vazio)', () => {
    const bad = [
      { kind: 'turnUpdate', id: 'a', patch: { initiative: 1000 } },
      { kind: 'turnAdd', entry: { id: 'a', name: '   ' } },
    ]
    for (const op of bad) expect(ClientMessageSchema.safeParse({ t: 'op', opId: 'op_1', op }).success).toBe(false)
  })
})

describe('OpSchema batch', () => {
  const del = (id: string) => ({ kind: 'delete', id })
  const parse = (ops: unknown[]) => OpSchema.safeParse({ kind: 'batch', ops }).success

  it('aceita de 1 a 200 sub-ações de objeto (create, update, delete)', () => {
    expect(parse([{ kind: 'create', object: image }, { kind: 'update', id: 'x', patch: { x: 1 } }, del('y')])).toBe(true)
    expect(parse(Array.from({ length: BATCH_MAX }, (_, i) => del(`d${i}`)))).toBe(true)
  })

  it('create aceita `from` (pedaço de um traço apagado no mesmo lote)', () => {
    expect(parse([{ kind: 'create', object: image, from: 's1' }, del('s1')])).toBe(true)
  })

  it('recusa vazio, mais de 200, lote dentro de lote e ações que não são de objeto', () => {
    expect(parse([])).toBe(false)
    expect(parse(Array.from({ length: BATCH_MAX + 1 }, (_, i) => del(`d${i}`)))).toBe(false)
    expect(parse([{ kind: 'batch', ops: [del('a')] }])).toBe(false)
    expect(parse([{ kind: 'layerCreate', layer: { id: 'l1', name: 'Nova' } }])).toBe(false)
    expect(parse([{ kind: 'settingsUpdate', patch: {} }])).toBe(false)
    expect(parse([{ kind: 'turnNext' }])).toBe(false)
    expect(parse([{ kind: 'turnsOpen', open: true }])).toBe(false)
    expect(parse([{ kind: 'noteSet', objectId: 'a', text: 'x' }])).toBe(false)
    expect(parse([{ kind: 'memberRemove', clientId: 'c1' }])).toBe(false)
    expect(parse([{ kind: 'memberUpdate', clientId: 'c1', patch: { nickname: 'Bia' } }])).toBe(false)
    expect(parse([{ kind: 'clearObjects', layerId: null, scope: 'drawings' }])).toBe(false)
  })

  it('recusa o mesmo id duas vezes (contraditório)', () => {
    expect(parse([del('a'), { kind: 'update', id: 'a', patch: { x: 1 } }])).toBe(false)
    expect(parse([{ kind: 'create', object: image }, { kind: 'create', object: image }])).toBe(false)
  })
})
