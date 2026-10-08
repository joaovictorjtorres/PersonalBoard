import { describe, expect, it } from 'vitest'
import { ClientMessageSchema, ObjectPatchSchema, OpSchema, TableObjectSchema } from '../src'

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
