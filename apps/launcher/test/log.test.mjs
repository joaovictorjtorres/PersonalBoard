import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOG_FILES, LOG_MAX_BYTES, createLogger, createTail, rotatedName } from '../src/log.mjs'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-log-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('log rotativo', () => {
  it('limites do spec', () => {
    expect(LOG_MAX_BYTES).toBe(1024 * 1024)
    expect(LOG_FILES).toBe(3)
    expect(rotatedName('/x/launcher.log', 0)).toBe('/x/launcher.log')
    expect(rotatedName('/x/launcher.log', 2)).toBe('/x/launcher.2.log')
  })

  it('gira ao passar do tamanho e guarda no máximo 3 arquivos', () => {
    const file = path.join(dir, 'logs', 'launcher.log')
    const log = createLogger(fs, file, { maxBytes: 100, now: () => Date.parse('2026-10-08T12:00:00Z') })
    for (let i = 0; i < 20; i++) log.write(`linha ${String(i).padStart(2, '0')}`)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.existsSync(rotatedName(file, 1))).toBe(true)
    expect(fs.existsSync(rotatedName(file, 2))).toBe(true)
    expect(fs.existsSync(rotatedName(file, 3))).toBe(false)
    for (const i of [0, 1, 2]) expect(fs.statSync(rotatedName(file, i)).size).toBeLessThanOrEqual(100)
    expect(fs.readFileSync(file, 'utf8')).toContain('2026-10-08T12:00:00.000Z linha 19')
  })

  it('continua do tamanho que o arquivo já tinha', () => {
    const file = path.join(dir, 'launcher.log')
    fs.writeFileSync(file, 'x'.repeat(95))
    createLogger(fs, file, { maxBytes: 100 }).write('nova')
    expect(fs.readFileSync(rotatedName(file, 1), 'utf8')).toBe('x'.repeat(95))
  })

  it('rotação que falha não impede o append', () => {
    const file = path.join(dir, 'launcher.log')
    fs.writeFileSync(file, 'x'.repeat(95))
    const broken = { ...fs, renameSync: () => { throw new Error('EBUSY') }, rmSync: () => { throw new Error('EBUSY') }, unlinkSync: () => { throw new Error('EBUSY') } }
    createLogger(broken, file, { maxBytes: 100 }).write('nova')
    expect(fs.readFileSync(file, 'utf8')).toContain('nova')
  })

  it('createTail guarda só as últimas N linhas', () => {
    const tail = createTail(3)
    for (const l of ['a', 'b', 'c', 'd']) tail.push(l)
    expect(tail.lines()).toEqual(['b', 'c', 'd'])
  })
})
