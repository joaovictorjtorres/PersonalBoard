import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, dataPaths, readConfig, writeConfig } from '../src/config.mjs'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa config ç ')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('dataPaths', () => {
  it('usa %LOCALAPPDATA%\\MesaVirtual', () => {
    const p = dataPaths({ LOCALAPPDATA: path.join(dir, 'Local') }, '/home/x')
    expect(p.dataDir).toBe(path.join(dir, 'Local', 'MesaVirtual'))
    expect(p.stateDir).toBe(path.join(p.dataDir, 'state'))
    expect(p.backupsDir).toBe(path.join(p.dataDir, 'backups'))
    expect(p.logFile).toBe(path.join(p.dataDir, 'logs', 'launcher.log'))
    expect(p.configFile).toBe(path.join(p.dataDir, 'config.json'))
    expect(p.updateFailedFile).toBe(path.join(p.dataDir, 'update-failed.txt'))
  })

  it('sem LOCALAPPDATA cai em <home>/AppData/Local; MESA_DATA_DIR tem prioridade', () => {
    expect(dataPaths({}, dir).dataDir).toBe(path.join(dir, 'AppData', 'Local', 'MesaVirtual'))
    expect(dataPaths({ MESA_DATA_DIR: path.join(dir, 'dados') }, '/x').dataDir).toBe(path.join(dir, 'dados'))
  })
})

describe('readConfig / writeConfig', () => {
  const file = () => path.join(dir, 'config.json')

  it('arquivo ausente → padrão, sem aviso, pode gravar', () => {
    expect(readConfig(fs, file())).toEqual({ config: { ...DEFAULT_CONFIG }, warnings: [], writable: true })
    expect(DEFAULT_CONFIG).toEqual({ autoUpdate: true, lastBackup: null })
  })

  it('lê autoUpdate false e lastBackup, preservando chaves desconhecidas na gravação', () => {
    fs.writeFileSync(file(), JSON.stringify({ autoUpdate: false, lastBackup: '2026-10-08T12:00:00.000Z', tema: 'escuro' }))
    const { config, warnings } = readConfig(fs, file())
    expect(warnings).toEqual([])
    expect(config).toMatchObject({ autoUpdate: false, lastBackup: '2026-10-08T12:00:00.000Z', tema: 'escuro' })
    writeConfig(fs, file(), { ...config, lastBackup: '2026-10-09T00:00:00.000Z' })
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({
      autoUpdate: false, lastBackup: '2026-10-09T00:00:00.000Z', tema: 'escuro',
    })
    expect(fs.existsSync(`${file()}.tmp`)).toBe(false)
  })

  it('Review Focus 4: JSON quebrado → aviso, padrão e não sobrescreve', () => {
    fs.writeFileSync(file(), '{ "autoUpdate": false, }}')
    const result = readConfig(fs, file())
    expect(result.config).toEqual({ ...DEFAULT_CONFIG })
    expect(result.writable).toBe(false)
    expect(result.warnings).toEqual(['arquivo inválido; usando o padrão (o arquivo não foi alterado)'])
  })

  it('Review Focus 4: "autoUpdate": "false" (texto) → aviso e true; lastBackup inválido → null', () => {
    fs.writeFileSync(file(), JSON.stringify({ autoUpdate: 'false', lastBackup: 'ontem' }))
    const result = readConfig(fs, file())
    expect(result.config.autoUpdate).toBe(true)
    expect(result.config.lastBackup).toBeNull()
    expect(result.writable).toBe(true)
    expect(result.warnings).toEqual(['"autoUpdate" deve ser true ou false (sem aspas); usando true'])
  })

  it('JSON que não é objeto → aviso e não sobrescreve', () => {
    fs.writeFileSync(file(), '[1,2]')
    expect(readConfig(fs, file())).toMatchObject({ writable: false, warnings: [expect.stringContaining('inválido')] })
  })

  it('T2: remove BOM UTF-8 antes do JSON.parse (Bloco de Notas)', () => {
    fs.writeFileSync(file(), `\uFEFF${JSON.stringify({ autoUpdate: false })}`)
    const result = readConfig(fs, file())
    expect(result.warnings).toEqual([])
    expect(result.writable).toBe(true)
    expect(result.config.autoUpdate).toBe(false)
  })
})
