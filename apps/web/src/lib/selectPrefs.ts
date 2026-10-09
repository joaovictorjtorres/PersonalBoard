import type { SelectShape } from '../selection/model'
import type { KeyValueStorage } from './dice-config'

export const SELECT_PREFS_KEY = 'mesa:select'

/** Opções do Selecionar, por pessoa (localStorage). */
export interface SelectPrefs {
  selectShape: SelectShape
  selectAllLayers: boolean
}

export const DEFAULT_SELECT_PREFS: SelectPrefs = { selectShape: 'rect', selectAllLayers: false }

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadSelectPrefs(storage: KeyValueStorage | null = defaultStorage()): SelectPrefs {
  try {
    const raw = storage?.getItem(SELECT_PREFS_KEY)
    const r = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>
    return {
      selectShape: r.selectShape === 'lasso' ? 'lasso' : 'rect',
      selectAllLayers: r.selectAllLayers === true,
    }
  } catch {
    return { ...DEFAULT_SELECT_PREFS }
  }
}

export function saveSelectPrefs(prefs: SelectPrefs, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(SELECT_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // armazenamento bloqueado: a opção vale só nesta aba
  }
}
