import { describe, expect, it } from 'vitest'
import { DEFAULT_SELECT_PREFS, SELECT_PREFS_KEY, loadSelectPrefs, saveSelectPrefs } from '../src/lib/selectPrefs'

const memory = () => {
  const mem = new Map<string, string>()
  return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), mem }
}

describe('opções do Selecionar', () => {
  it('padrão: retângulo, só a camada ativa', () => {
    expect(loadSelectPrefs(memory())).toEqual({ selectShape: 'rect', selectAllLayers: false, eraseAllLayers: false })
    expect(DEFAULT_SELECT_PREFS).toEqual({ selectShape: 'rect', selectAllLayers: false, eraseAllLayers: false })
  })

  it('guarda e lê de volta', () => {
    const storage = memory()
    saveSelectPrefs({ selectShape: 'lasso', selectAllLayers: true, eraseAllLayers: true }, storage)
    expect(JSON.parse(storage.mem.get(SELECT_PREFS_KEY)!)).toEqual({ selectShape: 'lasso', selectAllLayers: true, eraseAllLayers: true })
    expect(loadSelectPrefs(storage)).toEqual({ selectShape: 'lasso', selectAllLayers: true, eraseAllLayers: true })
  })

  it('conteúdo inválido ou armazenamento bloqueado: padrão', () => {
    const storage = memory()
    storage.setItem(SELECT_PREFS_KEY, '{"selectShape":"estrela","selectAllLayers":"sim"}')
    expect(loadSelectPrefs(storage)).toEqual(DEFAULT_SELECT_PREFS)
    const broken = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    expect(loadSelectPrefs(broken)).toEqual(DEFAULT_SELECT_PREFS)
    expect(() => saveSelectPrefs(DEFAULT_SELECT_PREFS, broken)).not.toThrow()
    expect(loadSelectPrefs(null)).toEqual(DEFAULT_SELECT_PREFS)
  })
})
