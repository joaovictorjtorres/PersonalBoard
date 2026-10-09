import path from 'node:path'

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const SAFE_URL_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/

export function stripAnsi(text) {
  return text.replace(ANSI_RE, '')
}

/** Lê um stream em linhas; ignora linhas vazias; emite a sobra no fim. */
export function pipeLines(stream, onLine) {
  if (!stream) return
  stream.setEncoding('utf8')
  let carry = ''
  const emit = (raw) => {
    const line = stripAnsi(raw).trimEnd()
    if (line.trim()) onLine(line)
  }
  stream.on('data', (chunk) => {
    const parts = (carry + chunk).split(/\r?\n/)
    carry = parts.pop() ?? ''
    parts.forEach(emit)
  })
  stream.on('end', () => {
    emit(carry)
    carry = ''
  })
}

/** @returns {import('./main.mjs').ManagedProcess} */
export function launch(deps, command, args, options, onLine) {
  const child = deps.spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let alive = true
  const exited = new Promise((resolve) => {
    child.once('exit', (code) => {
      alive = false
      resolve(code ?? null)
    })
    child.once('error', (err) => {
      alive = false
      onLine(`falha ao iniciar ${path.win32.basename(command)}: ${err.message}`)
      resolve(null)
    })
  })
  pipeLines(child.stdout, onLine)
  pipeLines(child.stderr, onLine)
  return { child, exited, isAlive: () => alive }
}

/** Roda até o fim e devolve código + últimos 4 KB de saída. */
export function runCommand(deps, command, args, options = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = deps.spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ code: -1, output: err.message })
      return
    }
    let output = ''
    const collect = (chunk) => { output = (output + chunk).slice(-4096) }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', (err) => resolve({ code: -1, output: `${output}${err.message}` }))
    child.once('exit', (code) => resolve({ code: code ?? -1, output }))
  })
}

/** Mata o processo e seus filhos (wrangler → workerd). Resolve quando sai ou após timeoutMs. */
export function killTree(deps, proc, timeoutMs = 5_000) {
  if (!proc || !proc.isAlive()) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    let cancel = () => {}
    const finish = () => {
      if (done) return
      done = true
      cancel()
      resolve()
    }
    proc.exited.then(finish)
    cancel = deps.setTimer(finish, timeoutMs)
    if (deps.platform === 'win32') {
      const killer = deps.spawn('taskkill', ['/PID', String(proc.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => proc.child.kill())
    } else {
      proc.child.kill('SIGTERM')
    }
  })
}

/** GET url até 200, a cada intervalMs, por até timeoutMs. false se o processo morrer. */
export async function waitForServer(deps, url, { timeoutMs = 60_000, intervalMs = 500, isAlive = () => true } = {}) {
  const deadline = deps.now() + timeoutMs
  while (deps.now() < deadline) {
    if (!isAlive()) return false
    try {
      const res = await deps.fetch(url, { signal: AbortSignal.timeout(2_000) })
      await res.body?.cancel?.()
      if (res.status === 200) return true
    } catch {
      // ainda subindo
    }
    await deps.sleep(intervalMs)
  }
  return false
}

export function serverCommand({ execPath, serverDir, port, inspectorPort, stateDir }) {
  const args = [
    path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', stateDir,
  ]
  if (inspectorPort !== undefined) args.push('--inspector-port', String(inspectorPort))
  return { command: execPath, args }
}

export function serverEnv(env, logsDir) {
  return {
    ...env,
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: path.join(logsDir, 'wrangler'),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
}

export function tunnelCommand({ cloudflaredPath, port }) {
  return { command: cloudflaredPath, args: ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'] }
}

export function copyToClipboard(deps, text) {
  if (deps.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    let child
    try {
      child = deps.spawn('clip.exe', [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
    child.stdin.on('error', () => {})
    child.stdin.end(text)
  })
}

/** Abre o navegador padrão. Só aceita URL simples (sem caracteres que o cmd interpretaria). */
export function openBrowser(deps, url) {
  if (!SAFE_URL_RE.test(url)) return false
  let child
  try {
    if (deps.platform === 'win32') {
      child = deps.spawn('cmd.exe', ['/d', '/s', '/c', `"start "" "${url}""`], {
        stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, detached: true,
      })
    } else {
      child = deps.spawn(deps.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true })
    }
  } catch {
    return false
  }
  child.on('error', () => {})
  child.unref?.()
  return true
}

const psQuote = (text) => `'${text.replaceAll("'", "''")}'`

/** Extrai um zip: tar.exe do Windows (rápido) com fallback para Expand-Archive; fora do Windows, unzip. */
export async function extractZip(deps, zipFile, destDir) {
  deps.fs.mkdirSync(destDir, { recursive: true })
  if (deps.platform === 'win32') {
    const systemRoot = deps.env.SystemRoot || deps.env.SYSTEMROOT || 'C:\\Windows'
    const tar = path.win32.join(systemRoot, 'System32', 'tar.exe')
    const first = await runCommand(deps, tar, ['-xf', zipFile, '-C', destDir])
    if (first.code === 0) return
    const ps = await runCommand(deps, 'powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${psQuote(zipFile)} -DestinationPath ${psQuote(destDir)} -Force`,
    ])
    if (ps.code === 0) return
    throw new Error(`não foi possível extrair o zip (${(ps.output || first.output).trim().slice(-200)})`)
  }
  const result = await runCommand(deps, 'unzip', ['-q', '-o', zipFile, '-d', destDir])
  if (result.code !== 0) throw new Error(`não foi possível extrair o zip (${result.output.trim().slice(-200)})`)
}
