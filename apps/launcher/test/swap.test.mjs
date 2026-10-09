import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTree } from '../src/rm.mjs'
import { UPDATE_EXIT_CODE, appPaths, removeLeftovers, removeOldApp, restoreOldApp, renameWithRetry, swapApp } from '../src/swap.mjs'

let base
let root
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa swap '))
  root = path.join(base, 'Downloads do João Silva', 'Mesa Virtual')
  writeApp(path.join(root, 'app'), '0.4.0')
  writeApp(path.join(root, 'app.new'), '0.5.0')
})
afterEach(() => removeTree(fs, base))

/*
 * No Windows (Node 24) o fs.rmSync ignora em silêncio caminhos com acento ("João"): ele monta o
 * caminho na code page ANSI e não acha nada. Este fs reproduz isso no Linux: rmSync não faz nada.
 * Os testes de produção usam este fs para garantir que a troca/limpeza não dependem do rmSync.
 */
const winFs = { ...fs, rmSync() {} }

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
    swapApp(winFs, root, noSleep)
    expect(versionOf(appPaths(root).appOld)).toBe('0.4.0')
    expect(versionOf(appPaths(root).app)).toBe('0.5.0')
  })

  it('falha no segundo rename → restaura app e avisa "arquivo em uso"', () => {
    const p = appPaths(root)
    const flaky = flakyFs(2, 10) // app→app.old ok; app.new→app falha 10x; restauração ok
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
    removeTree(fs, path.join(root, 'app.new', 'launcher'))
    expect(() => swapApp(winFs, root, noSleep)).toThrow('a versão nova está incompleta')
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

describe('renameWithRetry: orçamento padrão', () => {
  it('10 tentativas com 1000 ms entre elas', () => {
    const waits = []
    const from = path.join(base, 'a')
    fs.mkdirSync(from)
    renameWithRetry(flakyFs(1, 9), from, path.join(base, 'b'), { sleepSync: (ms) => waits.push(ms) })
    expect(waits).toEqual(Array(9).fill(1000))
    expect(fs.existsSync(path.join(base, 'b'))).toBe(true)
  })

  it('desiste na 10ª falha (9 esperas) e lança', () => {
    const waits = []
    const from = path.join(base, 'a')
    fs.mkdirSync(from)
    expect(() => renameWithRetry(flakyFs(1), from, path.join(base, 'b'), { sleepSync: (ms) => waits.push(ms) })).toThrow('EBUSY')
    expect(waits).toHaveLength(9)
  })

  it('swapApp usa o mesmo orçamento', () => {
    const waits = []
    swapApp(flakyFs(1, 9), root, { sleepSync: (ms) => waits.push(ms) })
    expect(waits).toEqual(Array(9).fill(1000))
  })
})

describe('limpeza', () => {
  it('removeLeftovers apaga app.new e app.new.tmp; removeOldApp apaga app.old', () => {
    const p = appPaths(root)
    fs.mkdirSync(p.appNewTmp)
    removeLeftovers(winFs, root, noSleep)
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(fs.existsSync(p.appNewTmp)).toBe(false)
    expect(removeOldApp(winFs, root, noSleep)).toBe(false)
    writeApp(p.appOld, '0.3.0')
    expect(removeOldApp(winFs, root, noSleep)).toBe(true)
    expect(fs.existsSync(p.appOld)).toBe(false)
  })
})

describe('restoreOldApp', () => {
  it('app\\ ausente e app.old\\ presente → renomeia de volta', () => {
    removeTree(fs, path.join(root, 'app'))
    writeApp(path.join(root, 'app.old'), '0.3.0')
    expect(restoreOldApp(winFs, root, noSleep)).toBe(true)
    expect(versionOf(path.join(root, 'app'))).toBe('0.3.0')
    expect(fs.existsSync(path.join(root, 'app.old'))).toBe(false)
  })

  it('app\\ presente ou sem app.old\\ → não mexe', () => {
    writeApp(path.join(root, 'app.old'), '0.3.0')
    expect(restoreOldApp(fs, root, noSleep)).toBe(false)
    expect(versionOf(path.join(root, 'app'))).toBe('0.4.0')
    removeTree(fs, path.join(root, 'app'))
    removeTree(fs, path.join(root, 'app.old'))
    expect(restoreOldApp(fs, root, noSleep)).toBe(false)
  })
})

describe('removeTree', () => {
  it('apaga pasta com subpastas e arquivo somente-leitura sem usar fs.rmSync', () => {
    const dir = path.join(root, 'app.old')
    writeApp(dir, '0.3.0')
    const ro = path.join(dir, 'launcher', 'somente-leitura.txt')
    fs.writeFileSync(ro, 'x')
    fs.chmodSync(ro, 0o444)
    removeTree(winFs, dir, noSleep)
    expect(fs.existsSync(dir)).toBe(false)
    removeTree(winFs, dir, noSleep) // ausente não é erro
  })

  it('erro temporário → tenta de novo; persistente → lança em vez de fingir que apagou', () => {
    const dir = path.join(root, 'app.old')
    writeApp(dir, '0.3.0')
    let fails = 0
    const busy = (times) => ({
      ...winFs,
      rmdirSync(p) {
        if (p === dir && fails++ < times) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
        return fs.rmdirSync(p)
      },
    })
    const waits = []
    removeTree(busy(2), dir, { sleepSync: (ms) => waits.push(ms) })
    expect(fs.existsSync(dir)).toBe(false)
    expect(waits).toEqual([200, 200])
    writeApp(dir, '0.3.0')
    fails = 0
    expect(() => removeTree(busy(Infinity), dir, noSleep)).toThrow('EBUSY')
    expect(fs.existsSync(dir)).toBe(true)
  })
})
