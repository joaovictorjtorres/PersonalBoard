import { describe, expect, it } from 'vitest'
import { DEFAULT_TURNS, type Turns } from '@mesa/shared'
import { initiativeLabel, parseInitiativeInput, turnsSummary } from '../src/ui/turns/format'

describe('formatação dos turnos', () => {
  it('iniciativa sem valor aparece como "?"', () => {
    expect(initiativeLabel(null)).toBe('?')
    expect(initiativeLabel(-5)).toBe('-5')
    expect(initiativeLabel(17)).toBe('17')
  })

  it('campo de iniciativa: vazio limpa; inteiro de -99 a 999 vale; o resto é recusado', () => {
    expect(parseInitiativeInput('')).toBeNull()
    expect(parseInitiativeInput('   ')).toBeNull()
    expect(parseInitiativeInput(' 12 ')).toBe(12)
    expect(parseInitiativeInput('-99')).toBe(-99)
    expect(parseInitiativeInput('−5')).toBe(-5) // sinal de menos tipográfico
    expect(parseInitiativeInput('999')).toBe(999)
    for (const bad of ['1000', '-100', '1.5', 'abc', '1e2', '+5', '--1']) expect(parseInitiativeInput(bad)).toBeUndefined()
  })

  it('resumo da janela minimizada', () => {
    expect(turnsSummary(DEFAULT_TURNS)).toBe('Turnos · preparação')
    const turns: Turns = {
      open: true, phase: 'combat', round: 3, currentId: 'b',
      entries: [{ id: 'a', name: 'Ana', tokenId: null, initiative: 9 }, { id: 'b', name: 'Goblin', tokenId: null, initiative: 4 }],
    }
    expect(turnsSummary(turns)).toBe('Rodada 3 · Vez de: Goblin')
  })
})

describe('textos da janela de turnos sem travessões', () => {
  const sources = import.meta.glob<string>('../src/ui/turns/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

  it('nenhum — ou – nos arquivos da janela de turnos', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4)
    const offenders = Object.entries(sources).filter(([, text]) => /[–—]/.test(text)).map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
