import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { makePackage, makeTmp, writeFakeApp } from './harness.mjs'

const launcher = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'launcher.mjs')
let base
afterEach(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true })
  base = undefined
})

describe('launcher.mjs (processo Node real, sem servidor)', () => {
  it('argumento inválido → código 2 e mensagem', () => {
    const r = spawnSync(process.execPath, [launcher, '--turbo'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('✗ opção desconhecida: --turbo')
  })

  it('--apply-update troca app\\ e sai com 0', () => {
    base = makeTmp()
    const root = makePackage(base, '0.4.0')
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    const dataDir = path.join(base, 'dados')
    const r = spawnSync(process.execPath, [launcher, '--root', root, '--apply-update'], {
      encoding: 'utf8',
      env: { ...process.env, MESA_DATA_DIR: dataDir },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('✓ Atualização instalada.')
    expect(fs.readFileSync(path.join(root, 'app', 'version.txt'), 'utf8').trim()).toBe('0.5.0')
    expect(fs.readFileSync(path.join(root, 'app.old', 'version.txt'), 'utf8').trim()).toBe('0.4.0')
    expect(fs.readFileSync(path.join(dataDir, 'logs', 'launcher.log'), 'utf8')).toContain('atualização aplicada')
  })
})
