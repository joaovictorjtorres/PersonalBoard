import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UPDATE_EXIT_CODE, appPaths, removeLeftovers, removeOldApp, renameWithRetry, swapApp } from '../src/swap.mjs'

let base
let root
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa swap '))
  root = path.join(base, 'Downloads do João Silva', 'Mesa Virtual')
  writeApp(path.join(root, 'app'), '0.4.0')
  writeApp(path.join(root, 'app.new'), '0.5.0')
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

function writeApp(dir, version) {
  fs.mkdirSync(path.join(dir, 'launcher'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'version.txt'), version)
  fs.writeFileSync(path.join(dir, 'launcher', 'launcher.mjs'), '//')
}
const versionOf = (dir) => fs.readFileSync(path.join(dir, 'version.txt'), 'utf8')
const noSleep = { sleepSync: () => {} }

/** fs que falha no rename de número `failOn` (1 = app→app.old, 2 = app.new→app). */
function flakyFs(failOn, times = Infinity) {
  let calls = 0
  let failures = 0
  return {
    ...fs,
    renameSync(from, to) {
      calls++
      if (calls >= failOn && failures < times) {
        failures++
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
      return fs.renameSync(from, to)
    },
  }
}

describe('swapApp', () => {
  it('troca app → app.old e app.new → app (caminho com espaços e acentos)', () => {
    expect(UPDATE_EXIT_CODE).toBe(75)
    const p = appPaths(root)
    swapApp(fs, root, noSleep)
    expect(versionOf(p.app)).toBe('0.5.0')
    expect(versionOf(p.appOld)).toBe('0.4.0')
    expect(fs.existsSync(p.appNew)).toBe(false)
  })

  it('app.old antigo é substituído', () => {
    writeApp(path.join(root, 'app.old'), '0.3.0')
    swapApp(fs, root, noSleep)
    expect(versionOf(appPaths(root).appOld)).toBe('0.4.0')
  })

  it('falha no segundo rename → restaura app e avisa "arquivo em uso"', () => {
    const p = appPaths(root)
    const flaky = flakyFs(2, 5) // app→app.old ok; app.new→app falha 5x; restauração ok
    expect(() => swapApp(flaky, root, noSleep)).toThrow('arquivo em uso ao trocar a pasta app')
    expect(versionOf(p.app)).toBe('0.4.0')
    expect(fs.existsSync(p.appOld)).toBe(false)
    expect(versionOf(p.appNew)).toBe('0.5.0')
  })

  it('falha no primeiro rename → nada muda', () => {
    expect(() => swapApp(flakyFs(1), root, noSleep)).toThrow('EBUSY')
    expect(versionOf(appPaths(root).app)).toBe('0.4.0')
  })

  it('restauração também falha → mensagem aponta app.old', () => {
    expect(() => swapApp(flakyFs(2), root, noSleep)).toThrow('a versão anterior está em app.old')
  })

  it('app.new incompleto → recusa sem tocar em nada', () => {
    fs.rmSync(path.join(root, 'app.new', 'launcher'), { recursive: true })
    expect(() => swapApp(fs, root, noSleep)).toThrow('a versão nova está incompleta')
    expect(versionOf(appPaths(root).app)).toBe('0.4.0')
  })
})

describe('renameWithRetry', () => {
  it('tenta de novo após falha temporária (antivírus)', () => {
    const waits = []
    const from = path.join(base, 'a')
    fs.mkdirSync(from)
    renameWithRetry(flakyFs(1, 2), from, path.join(base, 'b'), { attempts: 5, delayMs: 500, sleepSync: (ms) => waits.push(ms) })
    expect(fs.existsSync(path.join(base, 'b'))).toBe(true)
    expect(waits).toEqual([500, 500])
  })
})

describe('limpeza', () => {
  it('removeLeftovers apaga app.new e app.new.tmp; removeOldApp apaga app.old', () => {
    const p = appPaths(root)
    fs.mkdirSync(p.appNewTmp)
    removeLeftovers(fs, root)
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(fs.existsSync(p.appNewTmp)).toBe(false)
    expect(removeOldApp(fs, root)).toBe(false)
    writeApp(p.appOld, '0.3.0')
    expect(removeOldApp(fs, root)).toBe(true)
    expect(fs.existsSync(p.appOld)).toBe(false)
  })
})
