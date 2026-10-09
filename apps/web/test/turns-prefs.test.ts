import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampPosition, defaultPosition, readTurnsPrefs, writeTurnsPrefs } from '../src/ui/turns/windowPrefs'

let mem: Map<string, string>

beforeEach(() => {
  mem = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('preferências da janela de turnos', () => {
  it('sem nada guardado: posição padrão (centralizada no topo) e aberta', () => {
    expect(readTurnsPrefs('T')).toEqual({ x: null, y: null, minimized: false })
    expect(defaultPosition(1280)).toEqual({ x: 480, y: 56 })
    expect(defaultPosition(200)).toEqual({ x: 8, y: 56 })
  })

  it('guarda posição e minimizado por mesa', () => {
    writeTurnsPrefs('T', { x: 10, y: 20, minimized: true })
    expect(mem.get('mesa:turns:T')).toBe(JSON.stringify({ x: 10, y: 20, minimized: true }))
    expect(readTurnsPrefs('T')).toEqual({ x: 10, y: 20, minimized: true })
    expect(readTurnsPrefs('U')).toEqual({ x: null, y: null, minimized: false })
  })

  it('conteúdo corrompido ou armazenamento bloqueado: padrão, sem erro', () => {
    mem.set('mesa:turns:T', '{x')
    expect(readTurnsPrefs('T')).toEqual({ x: null, y: null, minimized: false })
    mem.set('mesa:turns:T', JSON.stringify({ x: 'a', y: Infinity, minimized: 'sim' }))
    expect(readTurnsPrefs('T')).toEqual({ x: null, y: null, minimized: false })
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') },
    })
    expect(readTurnsPrefs('T')).toEqual({ x: null, y: null, minimized: false })
    expect(() => writeTurnsPrefs('T', { x: 1, y: 2, minimized: false })).not.toThrow()
  })

  it('clampPosition mantém o cabeçalho dentro da tela', () => {
    const viewport = { width: 1000, height: 600 }
    const size = { width: 320, height: 40 }
    expect(clampPosition({ x: -50, y: -10 }, size, viewport)).toEqual({ x: 0, y: 0 })
    expect(clampPosition({ x: 900, y: 700 }, size, viewport)).toEqual({ x: 680, y: 560 })
    expect(clampPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 })
  })
})
