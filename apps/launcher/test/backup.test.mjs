import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KEEP_BACKUPS, backupDue, backupName, backupNow, backupsToDelete, makeBackup } from '../src/backup.mjs'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-08T12:00:00Z')

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa backup João ')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

function makeState() {
  const stateDir = path.join(dir, 'state')
  fs.mkdirSync(path.join(stateDir, 'v3', 'do'), { recursive: true })
  fs.writeFileSync(path.join(stateDir, 'v3', 'do', 'mesa.sqlite'), 'dados')
  return stateDir
}

describe('backupDue', () => {
  it('decide o backup diário', () => {
    expect(backupDue(null, NOW)).toBe(true)
    expect(backupDue('lixo', NOW)).toBe(true)
    expect(backupDue(new Date(NOW - 23 * HOUR).toISOString(), NOW)).toBe(false)
    expect(backupDue(new Date(NOW - 25 * HOUR).toISOString(), NOW)).toBe(true)
    expect(backupDue(new Date(NOW + 2 * HOUR).toISOString(), NOW)).toBe(true) // relógio voltou
  })
})

describe('backupName / backupsToDelete', () => {
  it('nome em hora local AAAA-MM-DD_HHMMSS', () => {
    expect(backupName(new Date(2026, 9, 8, 7, 5, 9))).toBe('2026-10-08_070509')
  })

  it('apaga só os automáticos mais antigos além de 10', () => {
    const names = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}_120000`)
    expect(KEEP_BACKUPS).toBe(10)
    expect(backupsToDelete([...names, 'minha-copia', 'leia.txt'])).toEqual(['2026-09-01_120000', '2026-09-02_120000'])
    expect(backupsToDelete(['2026-09-01_120000-10', '2026-09-01_120000-2', '2026-09-01_120000'], 1)).toEqual([
      '2026-09-01_120000', '2026-09-01_120000-2',
    ])
  })
})

describe('makeBackup', () => {
  it('copia state\\ para backups\\<nome> (conteúdo aninhado)', () => {
    const stateDir = makeState()
    const backupsDir = path.join(dir, 'backups')
    const name = makeBackup(fs, { stateDir, backupsDir, date: new Date(2026, 9, 8, 12, 0, 0) })
    expect(name).toBe('2026-10-08_120000')
    expect(fs.readFileSync(path.join(backupsDir, name, 'v3', 'do', 'mesa.sqlite'), 'utf8')).toBe('dados')
    expect(fs.readdirSync(backupsDir)).toEqual([name])
  })

  it('state ausente ou vazio → null, nada criado', () => {
    const backupsDir = path.join(dir, 'backups')
    expect(makeBackup(fs, { stateDir: path.join(dir, 'state'), backupsDir, date: new Date() })).toBeNull()
    fs.mkdirSync(path.join(dir, 'state'))
    expect(makeBackup(fs, { stateDir: path.join(dir, 'state'), backupsDir, date: new Date() })).toBeNull()
    expect(fs.existsSync(backupsDir)).toBe(false)
  })

  it('mesmo segundo → sufixo -2', () => {
    const stateDir = makeState()
    const backupsDir = path.join(dir, 'backups')
    const date = new Date(2026, 9, 8, 12, 0, 0)
    makeBackup(fs, { stateDir, backupsDir, date })
    expect(makeBackup(fs, { stateDir, backupsDir, date })).toBe('2026-10-08_120000-2')
  })

  it('Review Focus 5: mantém 10 automáticos e nunca apaga coisas do usuário', () => {
    const stateDir = makeState()
    const backupsDir = path.join(dir, 'backups')
    for (let i = 1; i <= 11; i++) fs.mkdirSync(path.join(backupsDir, `2026-09-${String(i).padStart(2, '0')}_120000`), { recursive: true })
    fs.mkdirSync(path.join(backupsDir, 'minha-copia'))
    fs.writeFileSync(path.join(backupsDir, 'leia.txt'), 'oi')
    fs.mkdirSync(path.join(backupsDir, '.2026-09-30_120000.partial'))
    const name = makeBackup(fs, { stateDir, backupsDir, date: new Date(2026, 9, 8, 12, 0, 0) })
    const left = fs.readdirSync(backupsDir).sort()
    expect(left.filter((n) => /^\d{4}-/.test(n))).toHaveLength(10)
    expect(left).toContain(name)
    expect(left).not.toContain('2026-09-01_120000')
    expect(left).not.toContain('2026-09-02_120000')
    expect(left).toContain('minha-copia')
    expect(left).toContain('leia.txt')
    expect(left.some((n) => n.endsWith('.partial'))).toBe(false)
  })
})

describe('backupNow', () => {
  it('atualiza lastBackup e grava o config só quando pode', () => {
    makeState()
    const configFile = path.join(dir, 'config.json')
    const ctx = {
      paths: { stateDir: path.join(dir, 'state'), backupsDir: path.join(dir, 'backups'), configFile },
      config: { autoUpdate: true, lastBackup: null },
      configWritable: true,
    }
    const deps = { fs, now: () => NOW }
    expect(backupNow(deps, ctx)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}$/)
    expect(ctx.config.lastBackup).toBe(new Date(NOW).toISOString())
    expect(JSON.parse(fs.readFileSync(configFile, 'utf8')).lastBackup).toBe(new Date(NOW).toISOString())

    fs.rmSync(configFile)
    ctx.configWritable = false
    expect(backupNow(deps, ctx)).not.toBeNull()
    expect(fs.existsSync(configFile)).toBe(false)
  })
})
