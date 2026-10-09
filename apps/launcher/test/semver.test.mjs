import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions, isNewer, normalizeVersion, parseVersion, readVersion } from '../src/semver.mjs'

describe('semver', () => {
  it('compara numericamente, não como texto', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('v0.4.0', '0.4.1')).toBe(-1)
    expect(() => compareVersions('x', '1.0.0')).toThrow('versão inválida')
  })

  it('isNewer só aceita versões X.Y.Z válidas', () => {
    expect(isNewer('v0.5.0', '0.4.0')).toBe(true)
    expect(isNewer('0.4.0', '0.4.0')).toBe(false)
    expect(isNewer('0.3.9', '0.4.0')).toBe(false)
    expect(isNewer('v0.5.0-beta', '0.4.0')).toBe(false)
    expect(isNewer('latest', '0.4.0')).toBe(false)
    expect(isNewer(undefined, '0.4.0')).toBe(false)
    expect(isNewer('0.5.0', 'lixo')).toBe(false)
  })

  it('parseVersion e normalizeVersion', () => {
    expect(parseVersion(' v1.2.3\n')).toEqual([1, 2, 3])
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion(42)).toBeNull()
    expect(normalizeVersion('v01.2.3')).toBe('1.2.3')
    expect(normalizeVersion('1.2.3.4')).toBeNull()
  })

  it('readVersion lê version.txt e usa 0.0.0 se faltar ou for inválido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-semver-'))
    const file = path.join(dir, 'version.txt')
    expect(readVersion(fs, file)).toBe('0.0.0')
    fs.writeFileSync(file, '0.4.0\r\n')
    expect(readVersion(fs, file)).toBe('0.4.0')
    fs.writeFileSync(file, 'lixo')
    expect(readVersion(fs, file)).toBe('0.0.0')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
