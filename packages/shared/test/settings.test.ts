import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsPatchSchema, TableSettingsSchema, mergeSettings, parseSettings } from '../src'

describe('configurações da mesa', () => {
  it('padrão: grade ligada, 70 px, sem encaixe', () => {
    expect(DEFAULT_SETTINGS).toEqual({ grid: { enabled: true, size: 70, snap: false } })
  })

  it('patch parcial mescla só o que veio', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { grid: { snap: true } })).toEqual({ grid: { enabled: true, size: 70, snap: true } })
    expect(mergeSettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS)
  })

  // Review Focus #4
  it('tamanho inteiro de 10 a 500', () => {
    expect(SettingsPatchSchema.safeParse({ grid: { size: 10 } }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ grid: { size: 500 } }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ grid: { size: 9 } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ grid: { size: 501 } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ grid: { size: 12.5 } }).success).toBe(false)
  })

  it('recusa campos desconhecidos', () => {
    expect(SettingsPatchSchema.safeParse({ grid: { color: '#ffffff' } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ theme: 'dark' }).success).toBe(false)
  })

  it('parseSettings completa o que falta e descarta lixo', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ grid: { enabled: true } })).toEqual({ grid: { enabled: true, size: 70, snap: false } })
    // mesa antiga: sem o campo, a grade aparece; desligada de propósito pelo mestre, continua desligada
    expect(parseSettings({ grid: { size: 50 } })).toEqual({ grid: { enabled: true, size: 50, snap: false } })
    expect(parseSettings({ grid: { enabled: false, size: 70, snap: false } })).toEqual({ grid: { enabled: false, size: 70, snap: false } })
    expect(parseSettings({ grid: { size: 3 } })).toEqual(DEFAULT_SETTINGS)
    expect(TableSettingsSchema.safeParse(parseSettings('x')).success).toBe(true)
    expect(parseSettings(null)).not.toBe(DEFAULT_SETTINGS)
  })
})
