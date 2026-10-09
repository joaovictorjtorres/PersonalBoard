import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { run } from '../src/main.mjs'
import { MSG } from '../src/messages.mjs'
import { T0, createHarness, makePackage, makeTmp, releaseFixture, until, writeFakeApp } from './harness.mjs'

let base
afterEach(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true })
  base = undefined
})

function setup(options = {}) {
  base = makeTmp()
  const root = makePackage(base, '0.4.0')
  const dataDir = path.join(base, 'Dados do João')
  const h = createHarness({ base, dataDir, ...options })
  return { h, root, dataDir }
}

async function startServing(h, root, opts = { noUpdate: true }) {
  const result = run(h.deps, { root, ...opts })
  await until(() => h.output.includes(MSG.closeHint) || h.output.includes(MSG.portsBusy), 'mesa pronta')
  // devolve dentro de um objeto: retornar a promise de run() faria o await esperar o desligamento
  return { result }
}

const taskkills = (h) => h.spawns.filter((s) => path.win32.basename(s.command) === 'taskkill.exe').map((s) => s.args[1])

describe('run: caminho feliz', () => {
  it('sobe servidor e túnel, copia e abre o link e desliga no Ctrl+C', async () => {
    const { h, root, dataDir } = setup()
    const result = (await startServing(h, root)).result
    expect(h.output[0]).toBe('Mesa Virtual v0.4.0')
    expect(h.output).toContain(MSG.updateSkippedFlag)
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)

    const server = h.spawns.find((s) => String(s.args[0]).endsWith('wrangler.js'))
    expect(server.command).toBe(h.deps.execPath)
    expect(server.args.slice(1)).toEqual([
      'dev', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', path.join(dataDir, 'state'), '--inspector-port', '9229',
    ])
    expect(server.options.cwd).toBe(path.join(root, 'app', 'server'))
    expect(server.options.env.WRANGLER_SEND_METRICS).toBe('false')

    const tunnel = h.spawns.find((s) => s.command.endsWith('cloudflared.exe'))
    expect(tunnel.command).toBe(path.join(root, 'app', 'cloudflared.exe'))
    expect(tunnel.args).toEqual(['tunnel', '--url', 'http://127.0.0.1:8787', '--no-autoupdate'])

    // Review Focus 2: a linha de erro com api.trycloudflare.com veio antes e foi ignorada
    expect(h.clipboard).toEqual(['https://mesa-1.trycloudflare.com'])
    expect(h.browser).toHaveLength(1)
    expect(h.browser[0]).toContain('https://mesa-1.trycloudflare.com')
    const at = h.output.indexOf('    https://mesa-1.trycloudflare.com')
    expect(h.output.slice(at - 2, at + 2)).toEqual(['', MSG.linkTitle, '    https://mesa-1.trycloudflare.com', ''])
    expect(h.output).toContain(MSG.copied)

    h.signal()
    expect(await result).toBe(0)
    expect(taskkills(h)).toEqual([String(h.children.tunnel[0].pid), String(h.children.server[0].pid)])
    expect(h.output.slice(-2)).toEqual([MSG.shuttingDown, MSG.bye])
    expect(fs.readFileSync(path.join(dataDir, 'logs', 'launcher.log'), 'utf8')).toContain('[túnel] INF |  https://mesa-1.trycloudflare.com  |')
  })

  it('usa a próxima porta livre para o servidor e para a inspeção', async () => {
    const { h, root } = setup({ freePorts: [8790, 9231] })
    const result = (await startServing(h, root)).result
    const server = h.spawns.find((s) => String(s.args[0]).endsWith('wrangler.js'))
    expect(server.args).toEqual(expect.arrayContaining(['--port', '8790', '--inspector-port', '9231']))
    expect(h.fetches.some((f) => f.url === 'http://127.0.0.1:8790/')).toBe(true)
    h.signal()
    expect(await result).toBe(0)
  })
})

describe('run: erros', () => {
  it('portas 8787–8797 ocupadas → mensagem clara e código 1', async () => {
    const { h, root } = setup({ freePorts: [] })
    expect(await run(h.deps, { root, noUpdate: true })).toBe(1)
    expect(h.output.at(-1)).toBe(MSG.portsBusy)
    expect(h.output.at(-1)).toContain('Feche outros programas usando as portas 8787–8797')
    expect(h.children.server).toHaveLength(0)
  })

  it('--port ocupada → código 1', async () => {
    const { h, root } = setup({ freePorts: [8787] })
    expect(await run(h.deps, { root, noUpdate: true, port: 9000 })).toBe(1)
    expect(h.output.at(-1)).toBe(MSG.portBusy(9000))
  })

  it('servidor não responde em 60 s → últimas 20 linhas do log e código 1', async () => {
    const { h, root } = setup({ server: 'never' })
    expect(await run(h.deps, { root, noUpdate: true })).toBe(1)
    expect(h.output).toContain(MSG.serverFailed)
    expect(h.output).toContain('    linha 25')
    expect(h.output).toContain('    linha 6')
    expect(h.output).not.toContain('    linha 5')
    expect(taskkills(h)).toEqual([String(h.children.server[0].pid)])
    expect(h.children.tunnel).toHaveLength(0)
  })

  it('túnel sem URL em 60 s → link local copiado e aberto', async () => {
    const { h, root } = setup({ tunnel: 'silent', timersFireImmediately: true })
    const result = (await startServing(h, root)).result
    expect(h.output).toContain(MSG.tunnelFailed)
    expect(h.clipboard).toEqual(['http://localhost:8787'])
    expect(h.browser[0]).toContain('http://localhost:8787')
    expect(taskkills(h)).toContain(String(h.children.tunnel[0].pid))
    h.signal()
    expect(await result).toBe(0)
  })

  it('cloudflared.exe ausente (erro de spawn) → link local', async () => {
    const { h, root } = setup({ tunnel: 'silent' })
    const result = run(h.deps, { root, noUpdate: true })
    await until(() => h.children.tunnel.length === 1)
    h.children.tunnel[0].emit('error', new Error('spawn ENOENT'))
    await until(() => h.output.includes(MSG.closeHint))
    expect(h.output).toContain(MSG.tunnelFailed)
    expect(h.clipboard).toEqual(['http://localhost:8787'])
    h.signal()
    expect(await result).toBe(0)
  })
})

describe('run: quedas e encerramento', () => {
  it('servidor cai: reinicia uma vez; cai de novo → desliga com código 1', async () => {
    const { h, root } = setup()
    const result = (await startServing(h, root)).result
    h.children.server[0].exit(1)
    await until(() => h.output.filter((l) => l === MSG.serverReady).length === 2, 'reinício')
    expect(h.output.filter((l) => l === MSG.serverCrashed)).toHaveLength(1)
    h.children.server[1].exit(1)
    expect(await result).toBe(1)
    expect(h.output).toContain(MSG.serverGaveUp)
    expect(h.children.server).toHaveLength(2)
  })

  it('túnel cai: reabre uma vez com link novo copiado (sem reabrir o navegador); cai de novo → link local', async () => {
    const { h, root } = setup()
    const result = (await startServing(h, root)).result
    h.children.tunnel[0].exit(1)
    await until(() => h.clipboard.length === 2, 'link novo')
    expect(h.output).toContain(MSG.tunnelCrashed)
    expect(h.clipboard[1]).toBe('https://mesa-2.trycloudflare.com')
    h.children.tunnel[1].exit(1)
    await until(() => h.clipboard.length === 3, 'link local')
    expect(h.output).toContain(MSG.tunnelGaveUp)
    expect(h.clipboard[2]).toBe('http://localhost:8787')
    expect(h.browser).toHaveLength(1)
    expect(h.children.tunnel).toHaveLength(2)
    h.signal()
    expect(await result).toBe(0)
  })

  it('Review Focus 1: Ctrl+C mata os filhos antes do sinal → não reinicia, sai com 0', async () => {
    const { h, root } = setup()
    const result = (await startServing(h, root)).result
    let release = () => {}
    const gate = new Promise((resolve) => { release = resolve })
    let slept = false
    h.deps.sleep = async () => { slept = true; await gate }
    h.children.server[0].exit(1)
    h.children.tunnel[0].exit(1)
    await until(() => slept, 'espera de 1 s após a queda')
    h.signal()
    release()
    expect(await result).toBe(0)
    expect(h.children.server).toHaveLength(1)
    expect(h.children.tunnel).toHaveLength(1)
    expect(h.text()).not.toContain('Tentando reiniciar')
    expect(h.text()).not.toContain('Reabrindo')
  })
})

describe('run: dados, atualização e limpeza', () => {
  it('backup diário: faz na primeira abertura, não repete em 1 h, repete depois de 24 h', async () => {
    const { h, root, dataDir } = setup()
    fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'state', 'mesa.sqlite'), 'dados')
    const backups = () => fs.readdirSync(path.join(dataDir, 'backups'))

    let result = (await startServing(h, root)).result
    expect(backups()).toHaveLength(1)
    expect(h.output).toContain(MSG.backupDone(backups()[0]))
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).lastBackup).toBe(new Date(T0).toISOString())
    h.signal()
    await result

    const later = createHarness({ base, dataDir, now: T0 + 60 * 60 * 1000 })
    result = (await startServing(later, root)).result
    expect(backups()).toHaveLength(1)
    later.signal()
    await result

    const nextDay = createHarness({ base, dataDir, now: T0 + 25 * 60 * 60 * 1000 })
    result = (await startServing(nextDay, root)).result
    expect(backups()).toHaveLength(2)
    nextDay.signal()
    await result
  })

  it('Review Focus 4: config.json quebrado → aviso, a mesa abre e o arquivo fica intacto', async () => {
    const { h, root, dataDir } = setup()
    fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'state', 'mesa.sqlite'), 'dados')
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{ "autoUpdate": false, ')
    const result = (await startServing(h, root, {})).result
    expect(h.output).toContain(MSG.configWarning('arquivo inválido; usando o padrão (o arquivo não foi alterado)'))
    expect(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).toBe('{ "autoUpdate": false, ')
    h.signal()
    expect(await result).toBe(0)
  })

  it('apaga app.old depois que o servidor responde e app.new interrompido no início', async () => {
    const { h, root } = setup()
    writeFakeApp(path.join(root, 'app.old'), '0.3.0')
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    const result = (await startServing(h, root)).result
    expect(fs.existsSync(path.join(root, 'app.old'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'app.new'))).toBe(false)
    h.signal()
    await result
  })

  it('troca que falhou antes: avisa, apaga o recado e não consulta o GitHub', async () => {
    const { h, root, dataDir } = setup({ release: releaseFixture('0.5.0') })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'update-failed.txt'), 'arquivo em uso ao trocar a pasta app (EBUSY)')
    const result = (await startServing(h, root, {})).result
    expect(h.output).toContain(MSG.updateFailed('arquivo em uso ao trocar a pasta app (EBUSY)'))
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, 'update-failed.txt'))).toBe(false)
    h.signal()
    await result
  })

  it('"autoUpdate": false → não consulta o GitHub', async () => {
    const { h, root, dataDir } = setup({ release: releaseFixture('0.5.0') })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{"autoUpdate": false}')
    const result = (await startServing(h, root, {})).result
    expect(h.output).toContain(MSG.updateDisabled)
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)
    h.signal()
    await result
  })

  it('erro na API do GitHub → uma linha de aviso e a mesa abre', async () => {
    const { h, root } = setup({ release: new TypeError('fetch failed') })
    const result = (await startServing(h, root, {})).result
    expect(h.output).toContain(MSG.updateCheckFailed('sem conexão'))
    expect(h.output).toContain(MSG.closeHint)
    h.signal()
    expect(await result).toBe(0)
  })

  it('recusa a atualização → a mesa abre na versão atual', async () => {
    const { h, root } = setup({ release: releaseFixture('0.5.0'), answer: 'n' })
    const result = (await startServing(h, root, {})).result
    expect(h.output).toContain('Versão 0.5.0 disponível (atual 0.4.0). Atualizar agora? [S/n] ')
    expect(h.output).toContain(MSG.updateDeclined)
    h.signal()
    expect(await result).toBe(0)
  })

  it('aceita a atualização → sai com 75 sem subir o servidor', async () => {
    const { h, root } = setup({ release: releaseFixture('0.5.0'), answer: '' })
    expect(await run(h.deps, { root })).toBe(75)
    expect(fs.readFileSync(path.join(root, 'app.new', 'version.txt'), 'utf8').trim()).toBe('0.5.0')
    expect(h.children.server).toHaveLength(0)
  })

  it('--apply-update troca app e não mostra cabeçalho', async () => {
    const { h, root } = setup()
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    expect(await run(h.deps, { root, applyUpdate: true })).toBe(0)
    expect(fs.readFileSync(path.join(root, 'app', 'version.txt'), 'utf8').trim()).toBe('0.5.0')
    expect(h.output).toEqual([MSG.updateApplied])
  })
})

describe('run --smoke', () => {
  it('só servidor: POST /api/tables → 201, desliga e sai com 0', async () => {
    const { h, root, dataDir } = setup({ release: releaseFixture('0.5.0') })
    fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'state', 'mesa.sqlite'), 'dados')
    expect(await run(h.deps, { root, smoke: true, port: 18787 })).toBe(0)
    const post = h.fetches.find((f) => f.method === 'POST')
    expect(post.url).toBe('http://127.0.0.1:18787/api/tables')
    expect(JSON.parse(post.body)).toEqual({ name: 'Teste de fumaça' })
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)
    expect(h.children.tunnel).toHaveLength(0)
    expect(h.clipboard).toHaveLength(0)
    expect(h.browser).toHaveLength(0)
    expect(fs.existsSync(path.join(dataDir, 'backups'))).toBe(false)
    expect(taskkills(h)).toEqual([String(h.children.server[0].pid)])
    expect(h.output).toContain(MSG.smokeOk)
  })

  it('status diferente de 201 → código 1', async () => {
    const { h, root } = setup({ tableStatus: 500 })
    expect(await run(h.deps, { root, smoke: true, port: 18787 })).toBe(1)
    expect(h.output).toContain(MSG.smokeFailed('POST /api/tables respondeu 500'))
  })
})

describe('run: endurecimento (T5)', () => {
  it('mkdir da pasta de dados falha → aviso e segue', async () => {
    const { h, root } = setup()
    h.deps.fs = {
      ...fs,
      mkdirSync: (p, o) => {
        if (String(p).endsWith('state')) throw new Error('EACCES: negado')
        return fs.mkdirSync(p, o)
      },
    }
    const result = (await startServing(h, root)).result
    expect(h.output).toContain(MSG.dataDirFailed('EACCES: negado'))
    h.signal()
    expect(await result).toBe(0)
  })

  it('removeLeftovers falha → aviso e segue', async () => {
    const { h, root } = setup()
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    h.deps.fs = {
      ...fs,
      lstatSync: (p, o) => {
        if (String(p).endsWith('app.new.tmp')) throw new Error('EBUSY: em uso')
        return fs.lstatSync(p, o)
      },
    }
    const result = (await startServing(h, root)).result
    expect(h.output).toContain(MSG.leftoversFailed('EBUSY: em uso'))
    h.signal()
    expect(await result).toBe(0)
  })

  it('app\\ ausente e app.old\\ presente → restaura antes de qualquer limpeza', async () => {
    const { h, root } = setup()
    fs.rmSync(path.join(root, 'app'), { recursive: true })
    writeFakeApp(path.join(root, 'app.old'), '0.3.0')
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    const result = (await startServing(h, root)).result
    expect(h.output).toContain('Mesa Virtual v0.3.0')
    expect(h.output).toContain(MSG.oldRestored)
    expect(fs.readFileSync(path.join(root, 'app', 'version.txt'), 'utf8').trim()).toBe('0.3.0')
    h.signal()
    expect(await result).toBe(0)
  })

  it('espera o link do túnel responder antes de copiar e abrir o navegador', async () => {
    const { h, root } = setup()
    const baseFetch = h.deps.fetch
    let calls = 0
    let clipboardWhenAnswered = -1
    h.deps.fetch = async (url, init) => {
      if (String(url).includes('mesa-1.trycloudflare.com')) {
        calls++
        if (calls < 4) throw new TypeError('fetch failed')
        clipboardWhenAnswered = h.clipboard.length + h.browser.length
        return new Response('ok', { status: 200 })
      }
      return baseFetch(url, init)
    }
    const result = (await startServing(h, root)).result
    expect(calls).toBe(4)
    expect(clipboardWhenAnswered).toBe(0)
    expect(h.clipboard).toEqual(['https://mesa-1.trycloudflare.com'])
    expect(h.output).not.toContain(MSG.linkMayDelay)
    h.signal()
    expect(await result).toBe(0)
  })

  it('link nunca responde → espera até 30 s, depois mostra e copia com o aviso', async () => {
    const { h, root } = setup()
    const baseFetch = h.deps.fetch
    let calls = 0
    h.deps.fetch = async (url, init) => {
      if (String(url).includes('mesa-1.trycloudflare.com')) {
        calls++
        throw new TypeError('fetch failed')
      }
      return baseFetch(url, init)
    }
    const before = h.deps.now()
    const result = (await startServing(h, root)).result
    expect(calls).toBeGreaterThanOrEqual(29)
    expect(calls).toBeLessThanOrEqual(31)
    expect(h.deps.now() - before).toBeLessThanOrEqual(35_000)
    expect(h.output).toContain(MSG.linkMayDelay)
    expect(h.clipboard).toEqual(['https://mesa-1.trycloudflare.com'])
    expect(h.browser).toHaveLength(1)
    h.signal()
    expect(await result).toBe(0)
  })

  it('servidor não sobe → sugere o VC++ Redistributable', async () => {
    const { h, root } = setup({ server: 'never' })
    expect(await run(h.deps, { root, noUpdate: true })).toBe(1)
    expect(h.output).toContain(MSG.serverVcHint)
    expect(MSG.serverVcHint).toContain('Microsoft Visual C++ Redistributable (x64)')
  })

  it('inspeção usa 9229–9239 e nunca a porta do servidor', async () => {
    const { h, root } = setup({ freePorts: [8787, 9239] })
    const result = (await startServing(h, root)).result
    const server = h.spawns.find((s) => String(s.args[0]).endsWith('wrangler.js'))
    expect(server.args.slice(-2)).toEqual(['--inspector-port', '9239'])
    h.signal()
    expect(await result).toBe(0)
  })

  it('--apply-update roda com o diretório atual fora de app\\ (na raiz do pacote)', async () => {
    const { h, root } = setup()
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    expect(await run(h.deps, { root, applyUpdate: true })).toBe(0)
    expect(h.chdirs).toEqual([root])
  })
})

describe('run: ajustes da revisão final', () => {
  it('app.new sem update-failed.txt: avisa, apaga e NÃO consulta o GitHub', async () => {
    const { h, root } = setup({ release: releaseFixture('0.5.0') })
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    const result = (await startServing(h, root, {})).result
    expect(h.output).toContain(MSG.updateFailed('a atualização preparada não foi instalada'))
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'app.new'))).toBe(false)
    h.signal()
    await result
  })

  it('app.new COM update-failed.txt: só a mensagem do recado', async () => {
    const { h, root, dataDir } = setup({ release: releaseFixture('0.5.0') })
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'update-failed.txt'), 'EBUSY')
    const result = (await startServing(h, root, {})).result
    expect(h.output.filter((l) => l.includes('Não foi possível atualizar'))).toEqual([MSG.updateFailed('EBUSY')])
    h.signal()
    await result
  })

  it('link velho: túnel morre durante a espera → só o link do túnel novo é mostrado e copiado', async () => {
    const { h, root } = setup()
    const baseFetch = h.deps.fetch
    let calls = 0
    h.deps.fetch = async (url, init) => {
      if (String(url).includes('mesa-1.trycloudflare.com')) {
        if (++calls === 3) h.children.tunnel[0].exit(1)
        throw new TypeError('fetch failed')
      }
      if (String(url).includes('mesa-2.trycloudflare.com')) return new Response('ok', { status: 200 })
      return baseFetch(url, init)
    }
    const result = (await startServing(h, root)).result
    await until(() => h.clipboard.length > 0, 'link novo copiado')
    expect(h.clipboard).toEqual(['https://mesa-2.trycloudflare.com'])
    expect(h.text()).not.toContain('mesa-1.trycloudflare.com')
    expect(h.browser).toHaveLength(0)
    h.signal()
    await result
  })

  it('poda os logs do wrangler: ficam só os 10 mais novos', async () => {
    const { h, root, dataDir } = setup()
    const dir = path.join(dataDir, 'logs', 'wrangler')
    fs.mkdirSync(dir, { recursive: true })
    for (let i = 0; i < 14; i++) {
      const f = path.join(dir, `wrangler-${String(i).padStart(2, '0')}.log`)
      fs.writeFileSync(f, 'x')
      fs.utimesSync(f, new Date(T0 + i * 1000), new Date(T0 + i * 1000))
    }
    const result = (await startServing(h, root)).result
    expect(fs.readdirSync(dir).sort()).toEqual(
      Array.from({ length: 10 }, (_, i) => `wrangler-${String(i + 4).padStart(2, '0')}.log`),
    )
    h.signal()
    await result
  })

  it('instância única: segunda janela recebe EADDRINUSE → mensagem e código 1', async () => {
    const { h, root } = setup()
    const sock = path.join(base, 'mesa.sock')
    h.deps.net = net
    h.deps.pipePath = sock
    const first = (await startServing(h, root)).result
    const second = createHarness({ base, dataDir: path.join(base, 'Dados do João') })
    second.deps.net = net
    second.deps.pipePath = sock
    expect(await run(second.deps, { root, noUpdate: true })).toBe(1)
    expect(second.output).toEqual([MSG.alreadyOpen])
    expect(second.spawns).toHaveLength(0)
    h.signal()
    await first
    // liberou o pipe: dá para abrir de novo
    const third = createHarness({ base, dataDir: path.join(base, 'Dados do João') })
    third.deps.net = net
    third.deps.pipePath = sock
    const again = (await startServing(third, root)).result
    third.signal()
    expect(await again).toBe(0)
  })

  it('--smoke e --apply-update não pegam o pipe; fora do Windows sem pipePath é no-op', async () => {
    const { h, root } = setup({ platform: 'linux' })
    h.deps.net = { createServer: () => { throw new Error('não devia criar servidor') } }
    const result = (await startServing(h, root)).result
    h.signal()
    expect(await result).toBe(0)
    const s = createHarness({ base, dataDir: path.join(base, 'Dados do João') })
    s.deps.net = h.deps.net
    s.deps.pipePath = path.join(base, 'x.sock')
    expect(await run(s.deps, { root, smoke: true })).toBe(0)
  })
})
