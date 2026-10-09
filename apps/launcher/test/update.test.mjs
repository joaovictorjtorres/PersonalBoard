import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dataPaths } from '../src/config.mjs'
import { MSG } from '../src/messages.mjs'
import { appPaths } from '../src/swap.mjs'
import {
  STAGING_DIR_NAME, applyUpdate, checkForUpdate, consumeUpdateFailure, fetchLatestRelease,
} from '../src/update.mjs'
import { createHarness, makePackage, makeTmp, releaseFixture, writeFakeApp } from './harness.mjs'

let base
let root
beforeEach(() => {
  base = makeTmp()
  root = makePackage(base, '0.4.0')
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

function setup(options = {}) {
  const h = createHarness({ base, ...options })
  const paths = dataPaths(h.deps.env, h.deps.homedir)
  fs.mkdirSync(paths.stateDir, { recursive: true })
  fs.writeFileSync(path.join(paths.stateDir, 'mesa.sqlite'), 'dados')
  const logged = []
  const ctx = {
    root, paths, version: '0.4.0',
    config: { autoUpdate: true, lastBackup: null }, configWritable: true,
    log: { write: (text) => logged.push(text) },
  }
  return { h, paths, ctx, logged, p: appPaths(root) }
}
const versionOf = (dir) => fs.readFileSync(path.join(dir, 'version.txt'), 'utf8').trim()

describe('fetchLatestRelease', () => {
  it('404 (nenhuma Release) → null; erro HTTP → lança; manda User-Agent', async () => {
    const { h } = setup({ release: null })
    expect(await fetchLatestRelease(h.deps)).toBeNull()
    expect(h.fetches[0]).toMatchObject({
      url: 'https://api.github.com/repos/joaovictorjtorres/PersonalBoard/releases/latest',
      headers: { 'User-Agent': 'MesaVirtual-launcher' },
    })
    h.deps.fetch = async () => new Response('x', { status: 500 })
    await expect(fetchLatestRelease(h.deps)).rejects.toThrow('GitHub respondeu 500')
  })
})

describe('checkForUpdate', () => {
  it('sem internet: avisa em uma linha e não pergunta', async () => {
    const { h, ctx } = setup({ release: new TypeError('fetch failed') })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output).toEqual([MSG.updateCheckFailed('sem conexão')])
  })

  it('API não responde em 5 s', async () => {
    const { h, ctx } = setup({ release: Object.assign(new Error('aborted'), { name: 'TimeoutError' }) })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output).toEqual([MSG.updateCheckFailed('sem resposta em 5 s')])
  })

  it('já está na mais recente', async () => {
    const { h, ctx } = setup({ release: releaseFixture('0.4.0') })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output).toEqual([MSG.upToDate])
  })

  it('recusa ("n"): não baixa nada', async () => {
    const { h, ctx, p } = setup({ release: releaseFixture('0.5.0'), answer: 'n' })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output).toEqual([MSG.updateAvailable('0.5.0', '0.4.0'), MSG.updateDeclined])
    expect(h.fetches.some((f) => f.url.startsWith('https://github.com/'))).toBe(false)
    expect(fs.existsSync(p.appNew)).toBe(false)
  })

  it('aceita (Enter): baixa, faz backup, prepara app.new e o trocador no %TEMP%', async () => {
    const { h, ctx, paths, p } = setup({ release: releaseFixture('0.5.0'), answer: '' })
    expect(await checkForUpdate(h.deps, ctx)).toBe(true)
    expect(versionOf(p.appNew)).toBe('0.5.0')
    expect(versionOf(p.app)).toBe('0.4.0')
    expect(fs.existsSync(p.appNewTmp)).toBe(false)
    expect(fs.existsSync(path.join(h.deps.tmpdir, 'MesaVirtual-v0.5.0-win64.zip'))).toBe(false)
    const staging = path.join(h.deps.tmpdir, STAGING_DIR_NAME)
    expect(fs.readFileSync(path.join(staging, 'node.exe'), 'utf8')).toBe('node em execução')
    expect(fs.existsSync(path.join(staging, 'launcher', 'launcher.mjs'))).toBe(true)
    const backups = fs.readdirSync(paths.backupsDir)
    expect(backups).toHaveLength(1)
    expect(ctx.config.lastBackup).toBe(new Date(h.deps.now()).toISOString())
    expect(JSON.parse(fs.readFileSync(paths.configFile, 'utf8')).lastBackup).toBe(ctx.config.lastBackup)
    expect(h.output).toEqual([
      MSG.updateAvailable('0.5.0', '0.4.0'),
      MSG.updateDownloading('0.5.0', 1),
      MSG.backupDone(backups[0]),
      MSG.updateReady('0.5.0'),
    ])
  })

  it('"sim" e "S" também aceitam', async () => {
    for (const answer of ['sim', 'S']) {
      const { h, ctx } = setup({ release: releaseFixture('0.5.0'), answer })
      expect(await checkForUpdate(h.deps, ctx)).toBe(true)
    }
  })

  it('download incompleto: descarta, mantém a versão atual e avisa', async () => {
    const { h, ctx, paths, p, logged } = setup({ release: releaseFixture('0.5.0', 3), answer: 's', download: Buffer.from('zi') })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output.at(-1)).toBe(MSG.updateFailed('download incompleto (2 de 3 bytes)'))
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(fs.existsSync(path.join(h.deps.tmpdir, 'MesaVirtual-v0.5.0-win64.zip'))).toBe(false)
    expect(fs.existsSync(paths.backupsDir)).toBe(false)
    expect(versionOf(p.app)).toBe('0.4.0')
    expect(logged.some((l) => l.includes('download incompleto'))).toBe(true)
  })

  it('zip com conteúdo inesperado (versão diferente): limpa tudo', async () => {
    const { h, ctx, p } = setup({ release: releaseFixture('0.5.0'), answer: 's', extractVersion: '0.4.9' })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output.at(-1)).toBe(MSG.updateFailed('o pacote baixado não tem o conteúdo esperado'))
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(fs.existsSync(p.appNewTmp)).toBe(false)
    expect(fs.existsSync(path.join(h.deps.tmpdir, STAGING_DIR_NAME))).toBe(false)
  })

  it('falha ao extrair: avisa e segue', async () => {
    const { h, ctx } = setup({ release: releaseFixture('0.5.0'), answer: 's', extractOk: false })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output.at(-1)).toMatch(/^✗ Não foi possível atualizar: não foi possível extrair o zip/)
  })
})

describe('applyUpdate / consumeUpdateFailure', () => {
  it('troca app e mostra "Atualização instalada"', () => {
    const { h, paths, p } = setup()
    writeFakeApp(p.appNew, '0.5.0')
    expect(applyUpdate(h.deps, root, paths, { write() {} })).toBe(0)
    expect(versionOf(p.app)).toBe('0.5.0')
    expect(versionOf(p.appOld)).toBe('0.4.0')
    expect(h.output).toEqual([MSG.updateApplied])
  })

  it('remove a pasta de preparação do %TEMP% depois de aplicar', () => {
    const { h, paths, p } = setup()
    writeFakeApp(p.appNew, '0.5.0')
    const staging = path.join(h.deps.tmpdir, STAGING_DIR_NAME)
    fs.mkdirSync(path.join(staging, 'launcher'), { recursive: true })
    applyUpdate(h.deps, root, paths, { write() {} })
    expect(fs.existsSync(staging)).toBe(false)
  })

  it('arquivo em uso: restaura, apaga app.new e deixa o recado para a próxima abertura', () => {
    const { h, paths, p } = setup()
    writeFakeApp(p.appNew, '0.5.0')
    const busy = {
      ...fs,
      renameSync(from, to) {
        if (from === p.appNew) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
        return fs.renameSync(from, to)
      },
    }
    expect(applyUpdate({ ...h.deps, fs: busy }, root, paths, { write() {} })).toBe(0)
    expect(versionOf(p.app)).toBe('0.4.0')
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(h.output).toEqual([]) // mensagem só na próxima abertura (consumeUpdateFailure)
    const reason = consumeUpdateFailure(fs, paths)
    expect(reason).toMatch(/^arquivo em uso ao trocar a pasta app/)
    expect(fs.existsSync(paths.updateFailedFile)).toBe(false)
    expect(consumeUpdateFailure(fs, paths)).toBeNull()
  })
})

describe('stageUpdate com arquivos presos', () => {
  it('usa novas tentativas no rename e no rm (nada de rename/rm sem retry)', async () => {
    const { h, ctx, p } = setup({ release: releaseFixture('0.5.0'), answer: '' })
    const fails = { rename: 0, rm: 0 }
    h.deps.fs = {
      ...fs,
      renameSync(from, to) {
        if (to === p.appNew && fails.rename++ < 2) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
        return fs.renameSync(from, to)
      },
      rmSync(target, opts) {
        if (String(target).endsWith('MesaVirtual-update') && fails.rm++ < 2) throw Object.assign(new Error('EBUSY'), { code: 'EBUSY' })
        return fs.rmSync(target, opts)
      },
    }
    expect(await checkForUpdate(h.deps, ctx)).toBe(true)
    expect(fails.rename).toBe(3)
    expect(fails.rm).toBe(3)
    expect(versionOf(p.appNew)).toBe('0.5.0')
  })
})
