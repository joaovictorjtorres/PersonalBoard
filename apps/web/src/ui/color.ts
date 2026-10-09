/** Matiz em graus [0, 360); saturação e valor em [0, 1]. */
export interface Hsv {
  h: number
  s: number
  v: number
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/

/** '#RRGGBB', 'rrggbb' ou com espaços → '#rrggbb'; qualquer outra coisa → null. */
export function normalizeHex(input: string): string | null {
  const m = HEX_RE.exec(input.trim())
  return m ? `#${m[1].toLowerCase()}` : null
}

export function hexToRgb(hex: string): [number, number, number] | null {
  const norm = normalizeHex(hex)
  if (!norm) return null
  const n = Number.parseInt(norm.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)))

export function rgbToHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => byte(v).toString(16).padStart(2, '0')).join('')}`
}

export function rgbToHsv(r: number, g: number, b: number): Hsv {
  const [rn, gn, bn] = [r / 255, g / 255, b / 255]
  const max = Math.max(rn, gn, bn)
  const d = max - Math.min(rn, gn, bn)
  let h = 0
  if (d > 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max }
}

export function hsvToRgb({ h, s, v }: Hsv): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 60
  const c = v * s
  const x = c * (1 - Math.abs((hh % 2) - 1))
  const [r, g, b] =
    hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x]
  const m = v - c
  return [byte((r + m) * 255), byte((g + m) * 255), byte((b + m) * 255)]
}

export function hexToHsv(hex: string): Hsv | null {
  const rgb = hexToRgb(hex)
  return rgb ? rgbToHsv(...rgb) : null
}

export function hsvToHex(hsv: Hsv): string {
  return rgbToHex(...hsvToRgb(hsv))
}

export const clamp01 = (n: number) => Math.max(0, Math.min(1, n))
