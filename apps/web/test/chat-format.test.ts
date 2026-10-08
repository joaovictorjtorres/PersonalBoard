import { describe, expect, it } from 'vitest'
import { bonusLabel, formatTime, modeLabel, pickImageFile, rollParts, thumbSize } from '../src/ui/chat/format'

describe('rollParts', () => {
  it('vantagem: o dado descartado fica marcado', () => {
    expect(rollParts({ die: 20 }, { rolls: [17, 8], kept: [17] })).toEqual([
      { value: 17, kept: true, tone: null },
      { value: 8, kept: false, tone: null },
    ])
  })

  it('valores iguais: só um é mantido', () => {
    expect(rollParts({ die: 20 }, { rolls: [5, 5], kept: [5] }).map((d) => d.kept)).toEqual([true, false])
  })

  it('no d20, 20 natural é verde (crit) e 1 natural é vermelho (fumble); nos outros dados não', () => {
    expect(rollParts({ die: 20 }, { rolls: [20, 1], kept: [20] }).map((d) => d.tone)).toEqual(['crit', 'fumble'])
    expect(rollParts({ die: 6 }, { rolls: [6, 1], kept: [6, 1] }).map((d) => d.tone)).toEqual([null, null])
  })
})

describe('rótulos', () => {
  it('modo, bônus e hora', () => {
    expect(modeLabel('normal')).toBe('')
    expect(modeLabel('advantage')).toBe(' (vantagem)')
    expect(modeLabel('disadvantage')).toBe(' (desvantagem)')
    expect(bonusLabel(5)).toBe(' + 5')
    expect(bonusLabel(-3)).toBe(' - 3')
    expect(bonusLabel(0)).toBe('')
    expect(formatTime(new Date(2026, 0, 2, 9, 5).getTime())).toBe('09:05')
    expect(formatTime(new Date(2026, 0, 2, 23, 59).getTime())).toBe('23:59')
  })

  it('miniatura até 240 px sem ampliar imagem pequena', () => {
    expect(thumbSize(1000, 500)).toEqual({ width: 240, height: 120 })
    expect(thumbSize(100, 50)).toEqual({ width: 100, height: 50 })
  })
})

describe('pickImageFile', () => {
  // Review Focus #5
  it('ignora o que não é imagem aceita (texto, PDF, SVG)', () => {
    expect(pickImageFile([{ type: 'text/plain' }, { type: 'application/pdf' }, { type: 'image/svg+xml' }])).toBeNull()
    expect(pickImageFile(null)).toBeNull()
    expect(pickImageFile([])).toBeNull()
  })

  it('pega a primeira imagem aceita, inclusive GIF', () => {
    const gif = { type: 'image/gif', name: 'a.gif' }
    expect(pickImageFile([{ type: 'text/plain' }, gif, { type: 'image/png' }])).toBe(gif)
  })
})
