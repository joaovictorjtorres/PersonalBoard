import path from 'node:path'
import { backupDue, backupNow } from './backup.mjs'
import { dataPaths, readConfig } from './config.mjs'
import { acquireInstanceLock } from './instance.mjs'
import { createLogger, createTail } from './log.mjs'
import { MSG } from './messages.mjs'
import { pruneOldFiles } from './prune.mjs'
import { INSPECTOR_FIRST, INSPECTOR_LAST, pickPort } from './ports.mjs'
import {
  copyToClipboard, killTree, launch, openBrowser, serverCommand, serverEnv, tunnelCommand, waitForServer,
} from './processes.mjs'
import { readVersion } from './semver.mjs'
import { UPDATE_EXIT_CODE, appPaths, removeLeftovers, removeOldApp, restoreOldApp } from './swap.mjs'
import { findTunnelUrl } from './tunnel-url.mjs'
import { applyUpdate, checkForUpdate, consumeUpdateFailure } from './update.mjs'

/**
 * @typedef {object} Deps
 * @property {typeof import('node:fs')} fs
 * @property {typeof import('node:net')} [net]
 * @property {string} [pipePath]
 * @property {typeof import('node:child_process').spawn} spawn
 * @property {typeof fetch} fetch
 * @property {() => number} now
 * @property {(ms: number) => Promise<void>} sleep
 * @property {(ms: number) => void} sleepSync
 * @property {(fn: () => void, ms: number) => () => void} setTimer
 * @property {string} platform
 * @property {Record<string, string | undefined>} env
 * @property {string} homedir
 * @property {string} tmpdir
 * @property {string} execPath
 * @property {string} launcherDir
 * @property {(port: number) => Promise<boolean>} isPortFree
 * @property {(question: string) => Promise<string>} ask
 * @property {(dir: string) => void} [chdir]
 * @property {(line: string) => void} print
 * @property {(handler: () => void) => void} onExitSignal
 *
 * @typedef {{ dataDir: string, stateDir: string, backupsDir: string, logsDir: string,
 *   logFile: string, configFile: string, updateFailedFile: string }} DataPaths
 * @typedef {{ autoUpdate: boolean, lastBackup: string | null, [key: string]: unknown }} Config
 * @typedef {{ write(text: string): void }} Logger
 * @typedef {{ root: string, paths: DataPaths, version: string, config: Config,
 *   configWritable: boolean, log: Logger }} Ctx
 * @typedef {{ version: string, url: string, size: number, name: string }} UpdateAsset
 * @typedef {{ child: import('node:child_process').ChildProcess, exited: Promise<number | null>,
 *   isAlive(): boolean }} ManagedProcess
 * @typedef {{ smoke: boolean, noUpdate: boolean, applyUpdate: boolean,
 *   port: number | undefined, root: string | undefined }} LauncherOptions
 */

export const TUNNEL_TIMEOUT_MS = 60_000
export const EXIT_GRACE_MS = 1_000
export const LINK_WAIT_MS = 30_000

/** @param {Deps} deps @param {LauncherOptions} opts @returns {Promise<number>} */
export async function run(deps, opts) {
  if (opts.applyUpdate || opts.smoke) return runMain(deps, opts)
  const lock = await acquireInstanceLock(deps)
  if (!lock.ok) {
    deps.print(MSG.alreadyOpen)
    return 1
  }
  try {
    return await runMain(deps, opts)
  } finally {
    lock.close()
  }
}

/** @param {Deps} deps @param {LauncherOptions} opts @returns {Promise<number>} */
async function runMain(deps, opts) {
  const { fs } = deps
  const root = path.resolve(opts.root ?? path.join(deps.launcherDir, '..', '..'))
  const paths = dataPaths(deps.env, deps.homedir)
  try {
    fs.mkdirSync(paths.stateDir, { recursive: true })
  } catch (err) {
    deps.print(MSG.dataDirFailed(err?.message ?? String(err)))
  }
  const log = createLogger(fs, paths.logFile, { now: deps.now })
  if (!opts.applyUpdate) pruneOldFiles(fs, path.join(paths.logsDir, 'wrangler'))
  if (opts.applyUpdate) {
    // Windows não renomeia app\ se o diretório atual do processo estiver dentro dela.
    try {
      deps.chdir?.(root)
    } catch (err) {
      log.write(`chdir falhou: ${err?.message ?? err}`)
    }
    return applyUpdate(deps, root, paths, log)
  }

  const { app } = appPaths(root)
  try {
    if (restoreOldApp(fs, root, { sleepSync: deps.sleepSync })) {
      log.write('app\\ ausente: app.old restaurada')
      deps.print(MSG.oldRestored)
    }
  } catch (err) {
    log.write(`restauração de app.old falhou: ${err?.stack ?? err}`)
  }
  const version = readVersion(fs, path.join(app, 'version.txt'))
  deps.print(MSG.header(version))
  log.write(`início v${version} ${JSON.stringify(opts)}`)
  // app.new sem update-failed.txt = uma atualização preparada que nunca foi instalada
  const stagedNotInstalled = fs.existsSync(appPaths(root).appNew) && !fs.existsSync(paths.updateFailedFile)
  if (stagedNotInstalled) log.write('app.new encontrada sem recado de falha: atualização preparada não instalada')
  try {
    removeLeftovers(fs, root, { sleepSync: deps.sleepSync })
  } catch (err) {
    log.write(`limpeza de app.new falhou: ${err?.stack ?? err}`)
    deps.print(MSG.leftoversFailed(err?.message ?? String(err)))
  }

  const { config, warnings, writable } = readConfig(fs, paths.configFile)
  for (const warning of warnings) deps.print(MSG.configWarning(warning))
  /** @type {Ctx} */
  const ctx = { root, paths, version, config, configWritable: writable, log }

  if (!opts.smoke) {
    const failure = consumeUpdateFailure(fs, paths)
    if (failure) deps.print(MSG.updateFailed(failure))
    else if (stagedNotInstalled) deps.print(MSG.updateFailed(MSG.updateNotInstalled))
    else if (opts.noUpdate) deps.print(MSG.updateSkippedFlag)
    else if (!config.autoUpdate) deps.print(MSG.updateDisabled)
    else if (await checkForUpdate(deps, ctx)) return UPDATE_EXIT_CODE
    dailyBackup(deps, ctx)
  }

  const port = await pickPort(deps.isPortFree, { forced: opts.port })
  if (port === null) {
    deps.print(opts.port === undefined ? MSG.portsBusy : MSG.portBusy(opts.port))
    return 1
  }
  const inspectorPort = await pickPort((p) => (p === port ? Promise.resolve(false) : deps.isPortFree(p)), {
    first: INSPECTOR_FIRST,
    last: INSPECTOR_LAST,
  })
  const session = createSession(deps, ctx, { app, port, inspectorPort: inspectorPort ?? undefined })
  return opts.smoke ? session.smoke() : session.serve()
}

function dailyBackup(deps, ctx) {
  if (!backupDue(ctx.config.lastBackup, deps.now())) return
  try {
    const name = backupNow(deps, ctx)
    if (name) deps.print(MSG.backupDone(name))
  } catch (err) {
    ctx.log.write(`backup falhou: ${err?.stack ?? err}`)
    deps.print(MSG.backupFailed(err?.message ?? String(err)))
  }
}

function createSession(deps, ctx, { app, port, inspectorPort }) {
  const { log } = ctx
  const serverDir = path.join(app, 'server')
  const localUrl = `http://localhost:${port}`
  const tail = createTail(20)
  /** @type {ManagedProcess | null} */
  let server = null
  /** @type {ManagedProcess | null} */
  let tunnel = null
  let shuttingDown = false
  let serverRestarted = false
  let tunnelRestarted = false
  let finish = (_code) => {}
  const done = new Promise((resolve) => { finish = resolve })

  async function bootServer() {
    deps.print(MSG.serverStarting(port))
    const { command, args } = serverCommand({
      execPath: deps.execPath, serverDir, port, inspectorPort, stateDir: ctx.paths.stateDir,
    })
    const proc = launch(deps, command, args, { cwd: serverDir, env: serverEnv(deps.env, ctx.paths.logsDir) }, (line) => {
      tail.push(line)
      log.write(`[servidor] ${line}`)
    })
    server = proc
    const ok = await waitForServer(deps, `http://127.0.0.1:${port}/`, { isAlive: proc.isAlive })
    if (ok) {
      deps.print(MSG.serverReady)
      return true
    }
    if (shuttingDown) return false
    deps.print(MSG.serverFailed)
    for (const line of tail.lines()) deps.print(`    ${line}`)
    deps.print(MSG.serverVcHint)
    await killTree(deps, proc)
    return false
  }

  async function openTunnel() {
    deps.print(MSG.tunnelStarting)
    const { command, args } = tunnelCommand({ cloudflaredPath: path.join(app, 'cloudflared.exe'), port })
    let resolveUrl = (_url) => {}
    const urlPromise = new Promise((resolve) => { resolveUrl = resolve })
    const proc = launch(deps, command, args, { cwd: app, env: deps.env }, (line) => {
      log.write(`[túnel] ${line}`)
      const found = findTunnelUrl(line)
      if (found) resolveUrl(found)
    })
    tunnel = proc
    proc.exited.then(() => resolveUrl(null))
    const cancel = deps.setTimer(() => resolveUrl(null), TUNNEL_TIMEOUT_MS)
    const link = await urlPromise
    cancel()
    if (link) {
      deps.print(MSG.tunnelReady)
      return link
    }
    await killTree(deps, proc)
    return null
  }

  const isCurrent = (proc) => !shuttingDown && (proc === null || (proc === tunnel && proc.isAlive()))

  async function announce(link, { browser, remote = false, proc = null }) {
    let answered = true
    if (remote) {
      deps.print(MSG.linkWaiting)
      answered = await waitForServer(deps, link, {
        timeoutMs: LINK_WAIT_MS, intervalMs: 1_000, isAlive: () => isCurrent(proc),
      })
      // túnel trocado/morto durante a espera: este link é velho, não mostra nem copia
      if (!isCurrent(proc)) return
    }
    deps.print('')
    deps.print(MSG.linkTitle)
    deps.print(`    ${link}`)
    if (!answered) deps.print(MSG.linkMayDelay)
    deps.print('')
    log.write(`link: ${link}`)
    if (await copyToClipboard(deps, link)) deps.print(MSG.copied)
    if (browser) openBrowser(deps, link)
  }

  async function shutdown(code) {
    if (shuttingDown) return
    shuttingDown = true
    deps.print(MSG.shuttingDown)
    await killTree(deps, tunnel)
    await killTree(deps, server)
    log.write(`fim (código ${code})`)
    deps.print(MSG.bye)
    finish(code)
  }

  function watchServer(proc) {
    proc.exited.then(async (code) => {
      if (shuttingDown || proc !== server) return
      log.write(`servidor saiu sozinho (código ${code})`)
      await deps.sleep(EXIT_GRACE_MS)
      if (shuttingDown) return
      if (serverRestarted) {
        deps.print(MSG.serverGaveUp)
        await shutdown(1)
        return
      }
      serverRestarted = true
      deps.print(MSG.serverCrashed)
      if (await bootServer()) {
        watchServer(server)
      } else if (!shuttingDown) {
        deps.print(MSG.serverGaveUp)
        await shutdown(1)
      }
    })
  }

  function watchTunnel(proc) {
    proc.exited.then(async (code) => {
      if (shuttingDown || proc !== tunnel) return
      log.write(`túnel saiu sozinho (código ${code})`)
      await deps.sleep(EXIT_GRACE_MS)
      if (shuttingDown) return
      if (tunnelRestarted) {
        deps.print(MSG.tunnelGaveUp)
        await announce(localUrl, { browser: false })
        return
      }
      tunnelRestarted = true
      deps.print(MSG.tunnelCrashed)
      const link = await openTunnel()
      if (shuttingDown) return
      if (link) {
        await announce(link, { browser: false, remote: true, proc: tunnel })
        watchTunnel(tunnel)
      } else {
        deps.print(MSG.tunnelGaveUp)
        await announce(localUrl, { browser: false })
      }
    })
  }

  async function serve() {
    deps.onExitSignal(() => { void shutdown(0) })
    const ok = await bootServer()
    if (shuttingDown) return done
    if (!ok) return 1
    if (removeOldApp(deps.fs, ctx.root, { sleepSync: deps.sleepSync })) log.write('versão anterior (app.old) removida')
    watchServer(server)
    const link = await openTunnel()
    if (shuttingDown) return done
    if (link) watchTunnel(tunnel)
    else deps.print(MSG.tunnelFailed)
    await announce(link ?? localUrl, { browser: true, remote: link !== null, proc: link ? tunnel : null })
    deps.print(MSG.closeHint)
    return done
  }

  async function smoke() {
    const ok = await bootServer()
    if (!ok) return 1
    let code = 1
    try {
      const res = await deps.fetch(`http://127.0.0.1:${port}/api/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Teste de fumaça' }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 201) {
        deps.print(MSG.smokeOk)
        code = 0
      } else {
        deps.print(MSG.smokeFailed(`POST /api/tables respondeu ${res.status}`))
      }
    } catch (err) {
      deps.print(MSG.smokeFailed(err?.message ?? String(err)))
    }
    shuttingDown = true
    await killTree(deps, server)
    log.write(`fumaça: código ${code}`)
    return code
  }

  return { serve, smoke }
}
