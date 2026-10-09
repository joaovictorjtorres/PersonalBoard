import { describe, expect, it } from 'vitest'
import { hexToHsv, hexToRgb, hsvToHex, hsvToRgb, normalizeHex, rgbToHex, rgbToHsv } from '../src/ui/color'

describe('normalizeHex', () => {
  it('aceita #rrggbb com ou sem #, maiúsculas e espaços; devolve minúsculo', () => {
    expect(normalizeHex('#12AB34')).toBe('#12ab34')
    expect(normalizeHex('12ab34')).toBe('#12ab34')
    expect(normalizeHex('  #ffffff ')).toBe('#ffffff')
  })

  it('recusa formato curto, tamanho errado e caracteres fora do hex', () => {
    for (const bad of ['', '#fff', '#12345', '#1234567', '#12ab3g', 'red', '##12ab34']) expect(normalizeHex(bad)).toBeNull()
  })
})

describe('rgb ↔ hex', () => {
  it('converte nos dois sentidos', () => {
    expect(hexToRgb('#4363d8')).toEqual([67, 99, 216])
    expect(rgbToHex(67, 99, 216)).toBe('#4363d8')
    expect(hexToRgb('nada')).toBeNull()
  })

  it('arredonda e limita a 0..255', () => {
    expect(rgbToHex(-5, 255.4, 300)).toBe('#00ffff')
  })
})

describe('rgb ↔ hsv', () => {
  it('cores primárias e cinzas', () => {
    expect(rgbToHsv(255, 0, 0)).toEqual({ h: 0, s: 1, v: 1 })
    expect(rgbToHsv(0, 255, 0)).toEqual({ h: 120, s: 1, v: 1 })
    expect(rgbToHsv(0, 0, 255)).toEqual({ h: 240, s: 1, v: 1 })
    expect(rgbToHsv(0, 0, 0)).toEqual({ h: 0, s: 0, v: 0 })
    expect(rgbToHsv(255, 255, 255)).toEqual({ h: 0, s: 0, v: 1 })
    expect(rgbToHsv(255, 0, 255).h).toBe(300)
  })

  it('hsv → rgb, inclusive matiz fora de 0..360', () => {
    expect(hsvToRgb({ h: 60, s: 1, v: 1 })).toEqual([255, 255, 0])
    expect(hsvToRgb({ h: 180, s: 0.5, v: 1 })).toEqual([128, 255, 255])
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual([255, 0, 0])
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual([0, 0, 255])
    expect(hsvToRgb({ h: 200, s: 0, v: 0.5 })).toEqual([128, 128, 128])
  })

  it('ida e volta preserva o hex', () => {
    for (const hex of ['#e6194b', '#f58231', '#ffe119', '#3cb44b', '#4363d8', '#911eb4', '#ffffff', '#000000', '#008080']) {
      expect(hsvToHex(hexToHsv(hex)!)).toBe(hex)
    }
  })
})
