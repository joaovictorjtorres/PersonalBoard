import { describe, expect, it } from 'vitest'
import { TableNameSchema, TunnelReportSchema, normalizeNickname } from '../src/registry'

describe('registro de mesas', () => {
  it('TableNameSchema corta espaços nas pontas e recusa vazio ou mais de 60', () => {
    expect(TableNameSchema.parse('  Campanha  ')).toBe('Campanha')
    expect(TableNameSchema.safeParse('   ').success).toBe(false)
    expect(TableNameSchema.safeParse('x'.repeat(61)).success).toBe(false)
    expect(TableNameSchema.safeParse('x'.repeat(60)).success).toBe(true)
  })

  it('TunnelReportSchema aceita origem https ou null; recusa caminho, http, javascript: e corpo sem url', () => {
    expect(TunnelReportSchema.parse({ url: 'https://abc-def.trycloudflare.com' })).toEqual({ url: 'https://abc-def.trycloudflare.com' })
    expect(TunnelReportSchema.parse({ url: null })).toEqual({ url: null })
    for (const bad of [
      { url: 'https://abc.trycloudflare.com/t/x' },
      { url: 'http://abc.trycloudflare.com' },
      { url: 'javascript:alert(1)' },
      { url: 'https://a"b.com' },
      {},
      { url: null, extra: 1 },
    ]) {
      expect(TunnelReportSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})

describe('normalizeNickname', () => {
  it('ignora maiúsculas/minúsculas e espaços nas pontas', () => {
    expect(normalizeNickname('  ANA ')).toBe(normalizeNickname('ana'))
    expect(normalizeNickname('Ana Paula')).not.toBe(normalizeNickname('AnaPaula'))
    expect(normalizeNickname('ÉRICO')).toBe('érico')
  })
})
