import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DICE_CONFIG,
  DICE_CONFIG_KEY,
  loadDiceConfig,
  normalizeDiceConfig,
  saveDiceConfig,
  toRollRequest,
  type KeyValueStorage,
} from '../src/lib/dice-config'

class FakeStorage implements KeyValueStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

describe('configuração do dado', () => {
  it('sem nada guardado: 1d20 normal, sem bônus, não secreta', () => {
    expect(loadDiceConfig(new FakeStorage())).toEqual({ die: 20, count: 1, bonus: 0, mode: 'normal', secret: false })
    expect(DEFAULT_DICE_CONFIG).toEqual({ die: 20, count: 1, bonus: 0, mode: 'normal', secret: false })
  })

  it('lembra a última configuração', () => {
    const storage = new FakeStorage()
    saveDiceConfig({ die: 6, count: 3, bonus: -2, mode: 'normal', secret: true }, storage)
    expect(loadDiceConfig(storage)).toEqual({ die: 6, count: 3, bonus: -2, mode: 'normal', secret: true })
    saveDiceConfig({ die: 20, count: 1, bonus: 5, mode: 'advantage', secret: false }, storage)
    expect(loadDiceConfig(storage)).toEqual({ die: 20, count: 1, bonus: 5, mode: 'advantage', secret: false })
  })

  it('valores guardados inválidos são corrigidos; JSON quebrado volta ao padrão', () => {
    const storage = new FakeStorage()
    storage.setItem(DICE_CONFIG_KEY, JSON.stringify({ die: 7, count: 99, bonus: -500, mode: 'advantage', secret: 'sim' }))
    expect(loadDiceConfig(storage)).toEqual({ die: 20, count: 50, bonus: -100, mode: 'normal', secret: false })
    storage.setItem(DICE_CONFIG_KEY, '{x')
    expect(loadDiceConfig(storage)).toEqual(DEFAULT_DICE_CONFIG)
  })

  it('normalizeDiceConfig: quantidade > 1 volta para normal; números fora do limite são presos', () => {
    expect(normalizeDiceConfig({ die: 8, count: 2, bonus: 3.7, mode: 'disadvantage', secret: true })).toEqual({
      die: 8, count: 2, bonus: 3, mode: 'normal', secret: true,
    })
    expect(normalizeDiceConfig({ count: 0, bonus: Number.NaN })).toEqual({ ...DEFAULT_DICE_CONFIG, count: 1, bonus: 0 })
  })

  it('armazenamento indisponível não quebra', () => {
    expect(loadDiceConfig(null)).toEqual(DEFAULT_DICE_CONFIG)
    expect(() => saveDiceConfig(DEFAULT_DICE_CONFIG, null)).not.toThrow()
  })

  it('toRollRequest tira o campo secret', () => {
    expect(toRollRequest({ die: 12, count: 1, bonus: 1, mode: 'advantage', secret: true })).toEqual({ die: 12, count: 1, bonus: 1, mode: 'advantage' })
  })
})
