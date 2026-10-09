// Fakes para testar o launcher no Linux: processos, fetch, relógio, console e sinais.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

export const T0 = Date.parse('2026-10-08T12:00:00.000Z')

/** Pasta temporária com espaço e acento no nome (Review Focus 3). */
export function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mesa launcher ção '))
}

export function writeFakeApp(appDir, version) {
  fs.mkdirSync(path.join(appDir, 'launcher'), { recursive: true })
  fs.mkdirSync(path.join(appDir, 'node'), { recursive: true })
  fs.mkdirSync(path.join(appDir, 'server'), { recursive: true })
  fs.writeFileSync(path.join(appDir, 'version.txt'), `${version}\n`)
  fs.writeFileSync(path.join(appDir, 'launcher', 'launcher.mjs'), `// launcher ${version}\n`)
  fs.writeFileSync(path.join(appDir, 'node', 'node.exe'), 'node falso')
}

/** <base>/MesaVirtual/app (versão dada), <base>/tmp e <base>/node-atual.exe. Devolve a raiz do pacote. */
export function makePackage(base, version = '0.4.0') {
  const root = path.join(base, 'MesaVirtual')
  writeFakeApp(path.join(root, 'app'), version)
  fs.mkdirSync(path.join(base, 'tmp'), { recursive: true })
  fs.writeFileSync(path.join(base, 'node-atual.exe'), 'node em execução')
  return root
}

export function releaseFixture(version = '0.5.0', size = 3) {
  const name = `MesaVirtual-v${version}-win64.zip`
  return {
    tag_name: `v${version}`,
    assets: [
      {
        name,
        size,
        browser_download_url: `https://github.com/joaovictorjtorres/PersonalBoard/releases/download/v${version}/${name}`,
      },
    ],
  }
}

export function fakeChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.exited = false
  child.killedWith = undefined
  child.exit = (code = 0) => {
    if (child.exited) return
    child.exited = true
    child.stdout.end()
    child.stderr.end()
    setImmediate(() => child.emit('exit', code))
  }
  child.kill = (signal = 'SIGTERM') => {
    child.killedWith = signal
    child.exit(null)
    return true
  }
  child.unref = () => {}
  return child
}

export async function until(predicate, label = 'condição') {
  for (let i = 0; i < 5000; i++) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`tempo esgotado esperando ${label}`)
}

/**
 * @param {object} o
 * @param {string} o.base            pasta temporária (makeTmp)
 * @param {string} [o.dataDir]       vira MESA_DATA_DIR
 * @param {string} [o.platform]      'win32' (padrão) | 'linux'
 * @param {number} [o.now]           relógio inicial (T0)
 * @param {'ready'|'never'|((n: number) => 'ready'|'never')} [o.server]
 * @param {'url'|'silent'|'exit'|((n: number) => 'url'|'silent'|'exit')} [o.tunnel]
 * @param {object|Error|null} [o.release]  resposta da API (null = 404; Error = falha de rede)
 * @param {string} [o.answer]        resposta ao [S/n]
 * @param {number[]|null} [o.freePorts]    null = todas livres
 * @param {boolean} [o.timersFireImmediately]  setTimer dispara no próximo tick (timeout do túnel)
 * @param {number} [o.tableStatus]   status do POST /api/tables
 * @param {Buffer} [o.download]      corpo do download do asset
 * @param {string} [o.extractVersion]  versão que o "zip" extraído contém
 * @param {boolean} [o.extractOk]    false = tar.exe e PowerShell falham
 */
export function createHarness(o) {
  const {
    base, dataDir = path.join(base, 'dados'), platform = 'win32', now: start = T0, server = 'ready', tunnel = 'url',
    release = null, answer = 's', freePorts = null, timersFireImmediately = false, tableStatus = 201,
    download = Buffer.from('zip'), extractVersion = '0.5.0', extractOk = true,
  } = o
  let now = start
  let nextPid = 1000
  const byPid = new Map()
  const h = {
    output: [], chdirs: [], spawns: [], fetches: [], clipboard: [], browser: [], signalHandlers: [],
    children: { server: [], tunnel: [] },
  }
  const pick = (mode, n) => (typeof mode === 'function' ? mode(n) : mode)

  const spawn = (command, args = [], options = {}) => {
    const child = fakeChild(++nextPid)
    byPid.set(child.pid, child)
    h.spawns.push({ command, args, options, pid: child.pid })
    const name = path.win32.basename(command).toLowerCase()
    if (String(args[0] ?? '').endsWith('wrangler.js')) {
      h.children.server.push(child)
      child.mode = pick(server, h.children.server.length)
      if (child.mode === 'never') {
        for (let i = 1; i <= 25; i++) child.stdout.write(`linha ${i}\n`)
      } else {
        child.stdout.write('\x1b[32m⎔ Starting local server...\x1b[0m\n')
      }
    } else if (name === 'cloudflared.exe') {
      h.children.tunnel.push(child)
      const n = h.children.tunnel.length
      const mode = pick(tunnel, n)
      child.stderr.write('INF Requesting new quick Tunnel on trycloudflare.com...\n')
      child.stderr.write('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": EOF\n')
      if (mode === 'url') child.stderr.write(`INF |  https://mesa-${n}.trycloudflare.com  |\n`)
      if (mode === 'exit') child.exit(1)
    } else if (name === 'taskkill.exe') {
      byPid.get(Number(args[1]))?.exit(1)
      child.exit(0)
    } else if (name === 'clip.exe') {
      let text = ''
      child.stdin.on('data', (d) => { text += d })
      child.stdin.on('finish', () => { h.clipboard.push(text); child.exit(0) })
    } else if (name === 'cmd.exe') {
      h.browser.push(args.at(-1))
      child.exit(0)
    } else if (name === 'tar.exe') {
      if (extractOk) writeFakeApp(path.join(args[3], 'MesaVirtual', 'app'), extractVersion)
      if (!extractOk) child.stderr.write('tar.exe: erro de leitura\n')
      child.exit(extractOk ? 0 : 1)
    } else if (name === 'powershell.exe') {
      child.stderr.write('Expand-Archive: falhou\n')
      child.exit(1)
    } else if (name === 'exit0.exe') {
      child.stdout.write('feito\n')
      child.exit(0)
    }
    // qualquer outro comando fica "rodando" até exit()/kill()
    return child
  }

  const fetch = async (input, init = {}) => {
    const url = String(input)
    h.fetches.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body })
    if (url.startsWith('https://api.github.com/')) {
      if (release instanceof Error) throw release
      if (release === null) return new Response('{"message":"Not Found"}', { status: 404 })
      return Response.json(release)
    }
    if (url.startsWith('https://github.com/')) return new Response(download)
    if (url.endsWith('/api/tables')) return new Response('{"tableId":"abc"}', { status: tableStatus })
    const srv = h.children.server.at(-1)
    if (srv && !srv.exited && srv.mode === 'ready') return new Response('<!doctype html>', { status: 200 })
    throw new TypeError('fetch failed')
  }

  h.deps = {
    fs,
    spawn,
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms
      await new Promise((resolve) => setImmediate(resolve))
    },
    sleepSync: () => {},
    setTimer: (fn) => {
      if (!timersFireImmediately) return () => {}
      const t = setImmediate(fn)
      return () => clearImmediate(t)
    },
    platform,
    env: { MESA_DATA_DIR: dataDir, SystemRoot: 'C:\\Windows', PATH: '/usr/bin' },
    homedir: base,
    tmpdir: path.join(base, 'tmp'),
    execPath: path.join(base, 'node-atual.exe'),
    launcherDir: path.join(base, 'MesaVirtual', 'app', 'launcher'),
    isPortFree: async (p) => (freePorts ? freePorts.includes(p) : true),
    ask: async (question) => {
      h.output.push(question)
      return answer
    },
    chdir: (dir) => { h.chdirs.push(dir) },
    print: (line) => { h.output.push(line) },
    onExitSignal: (handler) => { h.signalHandlers.push(handler) },
  }
  h.signal = () => { for (const handler of h.signalHandlers) handler() }
  h.text = () => h.output.join('\n')
  h.advance = (ms) => { now += ms }
  return h
}
