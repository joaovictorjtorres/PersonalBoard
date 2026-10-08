import { GRID_MAX, GRID_MIN } from '@mesa/shared'
import type { Viewport } from '../store/state'

/** Abaixo disso (em px de tela) a grade viraria uma mancha: não desenha. */
export const MIN_CELL_PX = 4

export interface GridLines {
  xs: number[]
  ys: number[]
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Linhas da grade que caem na área visível, em coordenadas do mapa. */
export function visibleGridLines(v: Viewport, screenW: number, screenH: number, size: number): GridLines | null {
  if (size * v.scale < MIN_CELL_PX) return null
  const minX = -v.x / v.scale + 0
  const maxX = (screenW - v.x) / v.scale
  const minY = -v.y / v.scale + 0
  const maxY = (screenH - v.y) / v.scale
  const xs: number[] = []
  const ys: number[] = []
  // `+ 0` evita -0 quando o início cai em zero vindo de um negativo.
  for (let x = Math.ceil(minX / size) * size + 0; x <= maxX; x += size) xs.push(x)
  for (let y = Math.ceil(minY / size) * size + 0; y <= maxY; y += size) ys.push(y)
  return { xs, ys, minX, maxX, minY, maxY }
}

/** Valor digitado no campo de tamanho; null = inválido (o campo volta ao valor atual). */
export function parseGridSize(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= GRID_MIN && value <= GRID_MAX ? value : null
}
