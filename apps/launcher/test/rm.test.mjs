import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyTree, removeTree } from '../src/rm.mjs'

let base
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa rm João ')) })
afterEach(() => {
  // limpeza independente do código testado
  fs.chmodSync(base, 0o755)
  fs.rmSync(base, { recursive: true, force: true })
})

const noSleep = { sleepSync: () => {} }
/** fs sem rmSync/cpSync: no Windows (Node 24.12) os dois montam o caminho na code page ANSI. */
const winFs = { ...fs, rmSync() { throw new Error('rmSync não deve ser usado') }, cpSync() { throw new Error('cpSync não deve ser usado') } }

describe('removeTree (iterativo)', () => {
  it('300 níveis de pastas: apaga sem recursão', () => {
    let dir = path.join(base, 'fundo')
    const top = dir
    // caminho relativo curto para não esbarrar no limite de tamanho de caminho
    fs.mkdirSync(dir)
    for (let i = 0; i < 300; i++) {
      dir = path.join(dir, 'd')
    }
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x')
    removeTree(winFs, top, noSleep)
    expect(fs.existsSync(top)).toBe(false)
  })

  it('não recorre na pilha do JS (10 000 níveis)', () => {
    // fs falso com 10 000 níveis: uma versão recursiva estouraria a pilha
    const depth = 10_000
    const done = new Set()
    const level = (p) => p.split('/').length - 1
    const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    const fake = {
      lstatSync(p) {
        if (done.has(p)) throw enoent()
        const dir = level(p) < depth
        return { isDirectory: () => dir, isSymbolicLink: () => false, isFile: () => !dir }
      },
      readdirSync(p) { return level(p) < depth ? ['d'] : [] },
      rmdirSync(p) { done.add(p) },
      unlinkSync(p) { done.add(p) },
    }
    removeTree(fake, '/r', { ...noSleep, maxEntries: 100_000 })
    expect(done.has('/r')).toBe(true)
    expect(done.size).toBe(depth)
  })

  it('laço de links simbólicos: apaga o link sem seguir e sem tocar no alvo', () => {
    const dir = path.join(base, 'alvo')
    const outside = path.join(base, 'fora')
    fs.mkdirSync(dir)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'precioso.txt'), 'não apagar')
    fs.symlinkSync(dir, path.join(dir, 'laço'), 'dir') // aponta para si mesma
    fs.symlinkSync(outside, path.join(dir, 'fora-link'), 'dir')
    removeTree(winFs, dir, noSleep)
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.readFileSync(path.join(outside, 'precioso.txt'), 'utf8')).toBe('não apagar')
  })

  it('o próprio alvo é link: apaga só o link', () => {
    const real = path.join(base, 'real')
    fs.mkdirSync(real)
    fs.writeFileSync(path.join(real, 'a.txt'), 'a')
    const link = path.join(base, 'link')
    fs.symlinkSync(real, link, 'dir')
    removeTree(winFs, link, noSleep)
    expect(fs.existsSync(link)).toBe(false)
    expect(fs.existsSync(path.join(real, 'a.txt'))).toBe(true)
  })

  it('arquivo somente-leitura: tira o atributo (só de arquivos) e apaga', () => {
    const dir = path.join(base, 'ro')
    fs.mkdirSync(path.join(dir, 'sub'), { recursive: true })
    const ro = path.join(dir, 'sub', 'somente-leitura.txt')
    fs.writeFileSync(ro, 'x')
    fs.chmodSync(ro, 0o444)
    const chmods = []
    let unlinkFails = 1
    const fake = {
      ...winFs,
      unlinkSync(p) {
        // simula o Windows: unlink de arquivo somente-leitura dá EPERM
        if (p === ro && unlinkFails-- > 0) throw Object.assign(new Error('EPERM'), { code: 'EPERM' })
        return fs.unlinkSync(p)
      },
      chmodSync(p, mode) {
        chmods.push(p)
        return fs.chmodSync(p, mode)
      },
    }
    removeTree(fake, dir, noSleep)
    expect(fs.existsSync(dir)).toBe(false)
    expect(chmods).toEqual([ro])
  })

  it('erro que persiste: esgota as tentativas (limitadas) e lança', () => {
    const dir = path.join(base, 'presa')
    fs.mkdirSync(dir)
    const waits = []
    const busy = {
      ...winFs,
      rmdirSync(p) {
        if (p === dir) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
        return fs.rmdirSync(p)
      },
    }
    expect(() => removeTree(busy, dir, { attempts: 4, delayMs: 10, sleepSync: (ms) => waits.push(ms) })).toThrow('EBUSY')
    expect(waits).toEqual([10, 10, 10])
    expect(fs.existsSync(dir)).toBe(true)
    // tentativas e espera têm teto, mesmo se pedirem demais
    waits.length = 0
    expect(() => removeTree(busy, dir, { attempts: 1000, delayMs: 60_000, sleepSync: (ms) => waits.push(ms) })).toThrow('EBUSY')
    expect(waits.length).toBeLessThanOrEqual(20)
    expect(Math.max(...waits)).toBeLessThanOrEqual(2000)
  })

  it('a espera padrão é síncrona, curta e não quebra', () => {
    const dir = path.join(base, 'presa')
    fs.mkdirSync(dir)
    let calls = 0
    const busy = { ...winFs, rmdirSync() { calls++; throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' }) } }
    const t0 = Date.now()
    expect(() => removeTree(busy, dir, { attempts: 3, delayMs: 20 })).toThrow('EBUSY')
    expect(calls).toBe(3)
    expect(Date.now() - t0).toBeGreaterThanOrEqual(30)
  })

  it('limite de itens: lança em vez de rodar para sempre', () => {
    const dir = path.join(base, 'muitos')
    fs.mkdirSync(dir)
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(dir, `f${i}`), '')
    expect(() => removeTree(winFs, dir, { ...noSleep, attempts: 1, maxEntries: 5 })).toThrow(/itens demais/)
  })

  it('ausente não é erro; arquivo solto também é apagado', () => {
    removeTree(winFs, path.join(base, 'nada'), noSleep)
    const f = path.join(base, 'solto.txt')
    fs.writeFileSync(f, 'x')
    removeTree(winFs, f, noSleep)
    expect(fs.existsSync(f)).toBe(false)
  })
})

describe('copyTree (sem fs.cpSync)', () => {
  it('copia pasta com subpastas para caminho com acento', () => {
    const src = path.join(base, 'Dados do João', 'state')
    fs.mkdirSync(path.join(src, 'sub', 'ção'), { recursive: true })
    fs.writeFileSync(path.join(src, 'mesa.sqlite'), 'dados')
    fs.writeFileSync(path.join(src, 'sub', 'ção', 'b.txt'), 'olá')
    const dest = path.join(base, 'cópia', '.x.partial')
    copyTree(winFs, src, dest)
    expect(fs.readFileSync(path.join(dest, 'mesa.sqlite'), 'utf8')).toBe('dados')
    expect(fs.readFileSync(path.join(dest, 'sub', 'ção', 'b.txt'), 'utf8')).toBe('olá')
  })

  it('não segue links e recusa copiar para dentro de si mesma', () => {
    const src = path.join(base, 'src')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'a.txt'), 'a')
    fs.symlinkSync(src, path.join(src, 'laço'), 'dir')
    const dest = path.join(base, 'dest')
    copyTree(winFs, src, dest)
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('a')
    expect(fs.existsSync(path.join(dest, 'laço'))).toBe(false)
    expect(() => copyTree(winFs, src, path.join(src, 'dentro'))).toThrow(/dentro dela mesma/)
  })
})
