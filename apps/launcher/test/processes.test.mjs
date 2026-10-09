import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { removeTree } from '../src/rm.mjs'
import {
  copyToClipboard, extractZip, killTree, launch, openBrowser, pipeLines, runCommand,
  serverCommand, serverEnv, tunnelCommand, waitForServer,
} from '../src/processes.mjs'
import { createHarness, makeTmp } from './harness.mjs'

let base
beforeEach(() => { base = makeTmp() })
afterEach(() => removeTree(fs, base))

describe('pipeLines', () => {
  it('junta pedaços, aceita CRLF, tira ANSI e emite a sobra no fim', async () => {
    const stream = new PassThrough()
    const lines = []
    pipeLines(stream, (l) => lines.push(l))
    stream.write('linha 1\r\nlin')
    stream.write('ha 2\n\x1b[32mverde\x1b[0m\n\n   \n')
    stream.end('sem fim')
    await new Promise((resolve) => stream.on('end', resolve))
    expect(lines).toEqual(['linha 1', 'linha 2', 'verde', 'sem fim'])
  })
})

describe('launch / killTree', () => {
  it('acompanha vida e saída do processo e repassa as linhas', async () => {
    const h = createHarness({ base })
    const lines = []
    const proc = launch(h.deps, '/bin/algo', ['x'], { cwd: base }, (l) => lines.push(l))
    expect(h.spawns[0].options).toMatchObject({ cwd: base, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    proc.child.stderr.write('oi\n')
    expect(proc.isAlive()).toBe(true)
    proc.child.exit(3)
    expect(await proc.exited).toBe(3)
    expect(proc.isAlive()).toBe(false)
    expect(lines).toEqual(['oi'])
  })

  it('erro de spawn (exe ausente) vira linha e exited null', async () => {
    const h = createHarness({ base })
    const lines = []
    const proc = launch(h.deps, 'C:\\x\\outro.exe', [], {}, (l) => lines.push(l))
    proc.child.emit('error', new Error('spawn ENOENT'))
    expect(await proc.exited).toBeNull()
    expect(lines).toEqual(['falha ao iniciar outro.exe: spawn ENOENT'])
  })

  it('win32: taskkill /PID <pid> /T /F e espera o processo sair', async () => {
    const h = createHarness({ base })
    const proc = launch(h.deps, 'C:\\app\\node\\node.exe', ['wrangler.js'], {}, () => {})
    await killTree(h.deps, proc)
    expect(h.spawns.at(-1)).toMatchObject({ command: 'C:\\Windows\\System32\\taskkill.exe', args: ['/PID', String(proc.child.pid), '/T', '/F'] })
    expect(proc.isAlive()).toBe(false)
  })

  it('taskkill com código diferente de zero → child.kill()', async () => {
    const h = createHarness({ base })
    const proc = launch(h.deps, 'C:\\app\\node\\node.exe', ['wrangler.js'], {}, () => {})
    const spawn = h.deps.spawn
    h.deps.spawn = (command, args, options) => {
      if (String(command).endsWith('taskkill.exe')) {
        const killer = spawn('x', [], options)
        setImmediate(() => killer.emit('exit', 128))
        return killer
      }
      return spawn(command, args, options)
    }
    await killTree(h.deps, proc)
    expect(proc.child.killedWith).toBe('SIGTERM')
    expect(proc.isAlive()).toBe(false)
  })

  it('taskkill com erro de spawn → child.kill()', async () => {
    const h = createHarness({ base })
    const proc = launch(h.deps, 'C:\\app\\node\\node.exe', ['wrangler.js'], {}, () => {})
    const spawn = h.deps.spawn
    h.deps.spawn = (command, args, options) => {
      if (String(command).endsWith('taskkill.exe')) {
        const killer = spawn('x', [], options)
        setImmediate(() => killer.emit('error', new Error('ENOENT')))
        return killer
      }
      return spawn(command, args, options)
    }
    await killTree(h.deps, proc)
    expect(proc.child.killedWith).toBe('SIGTERM')
  })

  it('launch: spawn que lança vira processo já encerrado com linha "falha ao iniciar"', async () => {
    const h = createHarness({ base })
    h.deps.spawn = () => { throw new Error('EPERM: bloqueado') }
    const lines = []
    const proc = launch(h.deps, 'C:\\x\\cloudflared.exe', [], {}, (l) => lines.push(l))
    expect(proc.isAlive()).toBe(false)
    expect(await proc.exited).toBeNull()
    expect(lines).toEqual(['falha ao iniciar cloudflared.exe: EPERM: bloqueado'])
    await killTree(h.deps, proc)
  })

  it('linux: SIGTERM; processo já morto ou null → nada', async () => {
    const h = createHarness({ base, platform: 'linux' })
    const proc = launch(h.deps, '/bin/algo', [], {}, () => {})
    await killTree(h.deps, proc)
    expect(proc.child.killedWith).toBe('SIGTERM')
    const count = h.spawns.length
    await killTree(h.deps, proc)
    await killTree(h.deps, null)
    expect(h.spawns).toHaveLength(count)
  })
})

describe('waitForServer', () => {
  it('tenta a cada 500 ms até o 200', async () => {
    const h = createHarness({ base })
    let calls = 0
    h.deps.fetch = async () => {
      calls++
      if (calls < 3) throw new TypeError('fetch failed')
      return new Response('ok', { status: 200 })
    }
    expect(await waitForServer(h.deps, 'http://127.0.0.1:8787/')).toBe(true)
    expect(calls).toBe(3)
    expect(h.deps.now()).toBe(Date.parse('2026-10-08T12:00:01.000Z'))
  })

  it('desiste em 60 s', async () => {
    const h = createHarness({ base })
    let calls = 0
    h.deps.fetch = async () => { calls++; return new Response('x', { status: 503 }) }
    const start = h.deps.now()
    expect(await waitForServer(h.deps, 'http://127.0.0.1:8787/')).toBe(false)
    expect(h.deps.now() - start).toBe(60_000)
    expect(calls).toBe(120)
  })

  it('processo morreu → false sem esperar', async () => {
    const h = createHarness({ base })
    expect(await waitForServer(h.deps, 'http://127.0.0.1:8787/', { isAlive: () => false })).toBe(false)
    expect(h.deps.now()).toBe(Date.parse('2026-10-08T12:00:00.000Z'))
  })
})

describe('comandos', () => {
  it('Review Focus 3: wrangler dev com caminhos com espaço/acento como argumentos inteiros', () => {
    const serverDir = path.join('C:', 'Users', 'João Silva', 'Mesa Virtual', 'app', 'server')
    const stateDir = path.join('C:', 'Users', 'João Silva', 'AppData', 'Local', 'MesaVirtual', 'state')
    const { command, args } = serverCommand({ execPath: 'node.exe', serverDir, port: 8788, inspectorPort: 9230, stateDir })
    expect(command).toBe('node.exe')
    expect(args).toEqual([
      path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'dev', '--ip', '127.0.0.1', '--port', '8788', '--persist-to', stateDir, '--inspector-port', '9230',
    ])
    expect(serverCommand({ execPath: 'n', serverDir, port: 8787, stateDir }).args).not.toContain('--inspector-port')
  })

  it('ambiente do servidor sem telemetria e com log na pasta de dados', () => {
    const env = serverEnv({ PATH: 'x' }, path.join('d', 'logs'))
    expect(env).toMatchObject({ PATH: 'x', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join('d', 'logs', 'wrangler') })
  })

  it('túnel', () => {
    expect(tunnelCommand({ cloudflaredPath: 'cf.exe', port: 8790 })).toEqual({
      command: 'cf.exe', args: ['tunnel', '--url', 'http://127.0.0.1:8790', '--no-autoupdate'],
    })
  })
})

describe('área de transferência e navegador', () => {
  it('win32 copia com clip.exe', async () => {
    const h = createHarness({ base })
    expect(await copyToClipboard(h.deps, 'https://a.trycloudflare.com')).toBe(true)
    expect(h.clipboard).toEqual(['https://a.trycloudflare.com'])
  })

  it('fora do Windows não copia', async () => {
    const h = createHarness({ base, platform: 'linux' })
    expect(await copyToClipboard(h.deps, 'x')).toBe(false)
    expect(h.spawns).toHaveLength(0)
  })

  it('win32 abre com start "" e recusa URL estranha', () => {
    const h = createHarness({ base })
    expect(openBrowser(h.deps, 'https://a-b.trycloudflare.com')).toBe(true)
    expect(h.spawns[0]).toMatchObject({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"start "" "https://a-b.trycloudflare.com""'],
      options: { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' },
    })
    expect(openBrowser(h.deps, 'http://localhost:8787')).toBe(true)
    expect(openBrowser(h.deps, 'https://x.com/&calc')).toBe(false)
    expect(openBrowser(h.deps, 'https://x.com" & calc')).toBe(false)
    expect(h.spawns).toHaveLength(2)
  })
})

describe('extractZip / runCommand', () => {
  it('win32 usa %SystemRoot%\\System32\\tar.exe', async () => {
    const h = createHarness({ base })
    const dest = path.join(base, 'app.new.tmp')
    await extractZip(h.deps, path.join(base, 'a.zip'), dest)
    expect(h.spawns[0].command).toBe('C:\\Windows\\System32\\tar.exe')
    expect(h.spawns[0].args).toEqual(['-xf', path.join(base, 'a.zip'), '-C', dest])
    expect(fs.existsSync(path.join(dest, 'MesaVirtual', 'app', 'version.txt'))).toBe(true)
  })

  it("Review Focus 3: cai para Expand-Archive com aspas simples escapadas (D'Ávila) e lança se falhar", async () => {
    const h = createHarness({ base, extractOk: false })
    const zip = "C:\\Users\\D'Ávila\\AppData\\Local\\Temp\\a b.zip"
    await expect(extractZip(h.deps, zip, path.join(base, 'dest'))).rejects.toThrow('não foi possível extrair o zip')
    expect(h.spawns[1].command).toBe('powershell.exe')
    expect(h.spawns[1].args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(h.spawns[1].args[3]).toBe(
      `$ProgressPreference='SilentlyContinue'; Expand-Archive -LiteralPath 'C:\\Users\\D''Ávila\\AppData\\Local\\Temp\\a b.zip' -DestinationPath '${path.join(base, 'dest').replaceAll("'", "''")}' -Force`,
    )
  })

  it('runCommand: código e saída; -1 em erro de spawn', async () => {
    const h = createHarness({ base })
    expect(await runCommand(h.deps, 'exit0.exe', [])).toEqual({ code: 0, output: 'feito\n' })
    h.deps.spawn = () => { throw new Error('ENOENT') }
    expect(await runCommand(h.deps, 'exit0.exe', [])).toEqual({ code: -1, output: 'ENOENT' })
  })
})

/** PowerShell/tar/taskkill frios no runner do Windows passam fácil de 5 s. */
const WIN_REAL_TIMEOUT_MS = 30_000

describe.runIf(process.platform === 'win32')('Windows real', () => {
  const realDeps = () => ({
    fs, spawn: spawn, platform: 'win32', env: process.env, now: () => Date.now(),
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)), setTimer: (fn, ms) => { const t = setTimeout(fn, ms); return () => clearTimeout(t) },
  })

  async function makeZip(dir) {
    const src = path.join(dir, 'src')
    fs.mkdirSync(src, { recursive: true })
    fs.writeFileSync(path.join(src, 'oi.txt'), 'olá')
    const zip = path.join(dir, 'pacote.zip')
    const r = await runCommand(realDeps(), 'powershell.exe', ['-NoProfile', '-Command',
      `Compress-Archive -LiteralPath '${path.join(src, 'oi.txt')}' -DestinationPath '${zip}'`])
    expect(r.code).toBe(0)
    return zip
  }

  it('extractZip (tar.exe) em pasta "a b ção"', async () => {
    const zip = await makeZip(base)
    const dest = path.join(base, 'a b ção')
    await extractZip(realDeps(), zip, dest)
    expect(fs.readFileSync(path.join(dest, 'oi.txt'), 'utf8')).toBe('olá')
  }, WIN_REAL_TIMEOUT_MS)

  it('extractZip (Expand-Archive) em pasta "a b ção"', async () => {
    const zip = await makeZip(base)
    const dest = path.join(base, 'a b ção')
    const env = { ...process.env, SystemRoot: path.join(base, 'sem-tar') }
    await extractZip({ ...realDeps(), env }, zip, dest)
    expect(fs.readFileSync(path.join(dest, 'oi.txt'), 'utf8')).toBe('olá')
  }, WIN_REAL_TIMEOUT_MS)

  it('killTree mata o neto (node → node)', async () => {
    const deps = realDeps()
    const pidFile = path.join(base, 'neto.pid')
    const grandchild = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(()=>{},1000)`
    const child = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(grandchild)}], {stdio:'ignore'}); setInterval(()=>{},1000)`
    const proc = launch(deps, process.execPath, ['-e', child], {}, () => {})
    for (let i = 0; i < 100 && !fs.existsSync(pidFile); i++) await new Promise((r) => setTimeout(r, 100))
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    await killTree(deps, proc)
    await new Promise((r) => setTimeout(r, 500))
    expect(() => process.kill(pid, 0)).toThrow()
  }, WIN_REAL_TIMEOUT_MS)
})
