import { z } from 'zod'
import { DEFAULT_GRID_SIZE, GRID_MAX, GRID_MIN } from './constants'

export const GridSchema = z.strictObject({
  enabled: z.boolean(),
  size: z.number().int().min(GRID_MIN).max(GRID_MAX),
  snap: z.boolean(),
})
export type GridSettings = z.infer<typeof GridSchema>

export const TableSettingsSchema = z.strictObject({ grid: GridSchema })
export type TableSettings = z.infer<typeof TableSettingsSchema>

export const SettingsPatchSchema = z.strictObject({ grid: GridSchema.partial() }).partial()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const DEFAULT_SETTINGS: TableSettings = { grid: { enabled: false, size: DEFAULT_GRID_SIZE, snap: false } }

export function mergeSettings(current: TableSettings, patch: SettingsPatch): TableSettings {
  return { ...current, grid: { ...current.grid, ...patch.grid } }
}

/** Lê o JSON guardado; campos ausentes voltam ao padrão e conteúdo inválido vira o padrão inteiro. */
export function parseSettings(raw: unknown): TableSettings {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as { grid?: unknown }
  const grid = typeof stored.grid === 'object' && stored.grid !== null ? stored.grid : {}
  const parsed = TableSettingsSchema.safeParse({ grid: { ...DEFAULT_SETTINGS.grid, ...grid } })
  return parsed.success ? parsed.data : { grid: { ...DEFAULT_SETTINGS.grid } }
}
