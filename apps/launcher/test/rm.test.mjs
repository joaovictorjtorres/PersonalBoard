import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { copyTree, removeTree } from '../src/rm.mjs'

const isWin = process.platform === 'win32'
let base
beforeEach(() => { base = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa rm João ')) })
afterEach(() => {
  try {
    fs.chmodSync(base, 0o755)
  } catch { /* ignora */ }
  // No Windows (Node 24.12) fs.rmSync monta o caminho na code page ANSI (C++ std::filesystem): com
  // "João" ele não apaga nada. Lá a limpeza usa removeTree; fora do Windows, rmSync (independente).
  if (isWin) removeTree(fs, base, { attempts: 3, delayMs: 100 })
  else fs.rmSync(base, { recursive: true, force: true })
})

/**
 * Link para pasta: no Windows usa junção (não exige admin/modo desenvolvedor); se mesmo assim der
 * EPERM, pula só este teste.
 */
function linkDir(ctx, target, p) {
  try {
    fs.symlinkSync(target, p, isWin ? 'junction' : 'dir')
  } catch (err) {
    if (err?.code === 'EPERM') ctx.skip()
    throw err
  }
}

const noSleep = { sleepSync: () => {} }
/** fs sem rmSync/cpSync: no Windows (Node 24.12) os dois montam o caminho na code page ANSI. */
const winFs = { ...fs, rmSync() { throw new Error('rmSync não deve ser usado') }, cpSync() { throw new Error('cpSync não deve ser usado') } }

describe('removeTree (iterativo)', () => {
  it('pastas profundas (300 níveis; no Windows, até ~240 caracteres): apaga sem recursão', () => {
    let dir = path.join(base, 'fundo')
    const top = dir
    fs.mkdirSync(dir)
    // no Windows o caminho inteiro fica abaixo de 240 caracteres (MAX_PATH = 260)
    const levels = isWin ? Math.max(5, Math.floor((239 - top.length - '\\f.txt'.length) / 2)) : 300
    for (let i = 0; i < levels; i++) {
      dir = path.join(dir, 'd')
    }
    if (isWin) expect(path.join(dir, 'f.txt').length).toBeLessThan(240)
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, 'f.txt'), 'x')
    removeTree(winFs, top, noSleep)
    expect(fs.existsSync(top)).toBe(false)
  })

  it('não recorre na pilha do JS (10 000 níveis)', () => {
    // fs falso com 10 000 níveis: uma versão recursiva estouraria a pilha.
    // O nível conta '/' E '\\': no Windows path.join usa '\\' e o antigo split('/') nunca chegava ao
    // fundo → pasta infinita, caminhos cada vez maiores e o worker morria sem memória (abort 134).
    // maxEntries justo garante que um erro desses falhe rápido, nunca derrube o processo.
    const depth = 10_000
    const done = new Set()
    const level = (p) => p.split(/[\\/]/).length - 1 // split também "achata" a string (menos memória)
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
    removeTree(fake, '/r', { ...noSleep, maxEntries: depth + 10 })
    expect(done.has('/r')).toBe(true)
    expect(done.size).toBe(depth)
  }, 60_000)

  it('fs que nunca acaba (caminho sempre crescendo): para no teto de tamanho de caminho', () => {
    let longest = 0
    const fake = {
      lstatSync(p) {
        longest = Math.max(longest, p.length)
        if (p.length > 40_000) throw new Error('passou do teto de caminho')
        return { isDirectory: () => true, isSymbolicLink: () => false, isFile: () => false }
      },
      readdirSync() { return ['n'.repeat(1000)] }, // nomes longos: chega ao teto com poucos níveis
      rmdirSync() {},
      unlinkSync() {},
    }
    let message = ''
    try {
      removeTree(fake, '/r', { ...noSleep, attempts: 1 })
    } catch (err) {
      message = String(err?.message).slice(0, 300)
    }
    expect(message).toMatch(/caminho longo demais/)
    expect(longest).toBeLessThanOrEqual(32_767)
  })

  it('laço de links simbólicos: apaga o link sem seguir e sem tocar no alvo', (ctx) => {
    const dir = path.join(base, 'alvo')
    const outside = path.join(base, 'fora')
    fs.mkdirSync(dir)
    fs.mkdirSync(outside)
    fs.writeFileSync(path.join(outside, 'precioso.txt'), 'não apagar')
    linkDir(ctx, dir, path.join(dir, 'laço')) // aponta para si mesma
    linkDir(ctx, outside, path.join(dir, 'fora-link'))
    removeTree(winFs, dir, noSleep)
    expect(fs.existsSync(dir)).toBe(false)
    expect(fs.readFileSync(path.join(outside, 'precioso.txt'), 'utf8')).toBe('não apagar')
  })

  it('o próprio alvo é link: apaga só o link', (ctx) => {
    const real = path.join(base, 'real')
    fs.mkdirSync(real)
    fs.writeFileSync(path.join(real, 'a.txt'), 'a')
    const link = path.join(base, 'link')
    linkDir(ctx, real, link)
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

  it('não segue links e recusa copiar para dentro de si mesma', (ctx) => {
    const src = path.join(base, 'src')
    fs.mkdirSync(src)
    fs.writeFileSync(path.join(src, 'a.txt'), 'a')
    linkDir(ctx, src, path.join(src, 'laço'))
    const dest = path.join(base, 'dest')
    copyTree(winFs, src, dest)
    expect(fs.readFileSync(path.join(dest, 'a.txt'), 'utf8')).toBe('a')
    expect(fs.existsSync(path.join(dest, 'laço'))).toBe(false)
    expect(() => copyTree(winFs, src, path.join(src, 'dentro'))).toThrow(/dentro dela mesma/)
  })
})
