import { describe, expect, it } from 'vitest'
import { ClientMessageSchema, ObjectPatchSchema, OpSchema, TableObjectSchema, isObjectOp, readOpId } from '../src'

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
