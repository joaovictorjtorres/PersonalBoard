import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { backupNow } from './backup.mjs'
import { MSG } from './messages.mjs'
import { extractZip } from './processes.mjs'
import { LATEST_URL, pickUpdate } from './release.mjs'
import { readVersion } from './semver.mjs'
import { appPaths, renameWithRetry, swapApp } from './swap.mjs'

/** Pasta em %TEMP% de onde o "Iniciar Mesa.cmd" roda a troca. Contrato congelado. */
export const STAGING_DIR_NAME = 'MesaVirtual-update'
export const API_TIMEOUT_MS = 5_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const USER_AGENT = 'MesaVirtual-launcher'
const YES = new Set(['', 's', 'sim', 'y', 'yes'])

/** rm recursivo com novas tentativas (antivírus/indexador seguram arquivos por instantes no Windows). */
function rmWithRetry(deps, target, { attempts = 5, delayMs = 500 } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      deps.fs.rmSync(target, { recursive: true, force: true })
      return
    } catch (err) {
      if (attempt >= attempts) throw err
      deps.sleepSync(delayMs)
    }
  }
}

export async function fetchLatestRelease(deps, timeoutMs = API_TIMEOUT_MS) {
  const res = await deps.fetch(LATEST_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`)
  return await res.json()
}

export function describeError(err, timeoutText = 'sem resposta em 5 s') {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return timeoutText
  if (err instanceof TypeError) return 'sem conexão'
  return err?.message ?? String(err)
}

export async function downloadAsset(deps, asset, destFile) {
  const { fs } = deps
  fs.rmSync(destFile, { force: true })
  try {
    const res = await deps.fetch(asset.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!res.ok || !res.body) throw new Error(`o download respondeu ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destFile))
    const size = fs.statSync(destFile).size
    if (size !== asset.size) throw new Error(`download incompleto (${size} de ${asset.size} bytes)`)
  } catch (err) {
    fs.rmSync(destFile, { force: true })
    throw err
  }
}

export function stagingDir(deps) {
  return path.join(deps.tmpdir, STAGING_DIR_NAME)
}

/** Copia o node.exe em execução e a pasta launcher\ atual para %TEMP%\MesaVirtual-update\. */
export function stageSwapper(deps) {
  const { fs } = deps
  const dir = stagingDir(deps)
  rmWithRetry(deps, dir)
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(deps.execPath, path.join(dir, 'node.exe'))
  fs.cpSync(deps.launcherDir, path.join(dir, 'launcher'), { recursive: true })
  return dir
}

/** Baixa, faz backup, extrai e prepara app.new\ + trocador. true = pronto para sair com 75. */
export async function stageUpdate(deps, ctx, asset) {
  const { fs } = deps
  const p = appPaths(ctx.root)
  const zipFile = path.join(deps.tmpdir, asset.name)
  try {
    deps.print(MSG.updateDownloading(asset.version, Math.max(1, Math.round(asset.size / 1_048_576))))
    await downloadAsset(deps, asset, zipFile)
    const backup = backupNow(deps, ctx)
    if (backup) deps.print(MSG.backupDone(backup))
    rmWithRetry(deps, p.appNewTmp)
    rmWithRetry(deps, p.appNew)
    await extractZip(deps, zipFile, p.appNewTmp)
    const extracted = path.join(p.appNewTmp, 'MesaVirtual', 'app')
    const complete =
      readVersion(fs, path.join(extracted, 'version.txt')) === asset.version &&
      fs.existsSync(path.join(extracted, 'launcher', 'launcher.mjs')) &&
      fs.existsSync(path.join(extracted, 'node', 'node.exe'))
    if (!complete) throw new Error('o pacote baixado não tem o conteúdo esperado')
    renameWithRetry(fs, extracted, p.appNew, { sleepSync: deps.sleepSync })
    rmWithRetry(deps, p.appNewTmp)
    stageSwapper(deps)
    try {
      rmWithRetry(deps, zipFile)
    } catch {
      // o zip sobrando em %TEMP% não impede a atualização
    }
    ctx.log.write(`atualização ${asset.version} preparada`)
    deps.print(MSG.updateReady(asset.version))
    return true
  } catch (err) {
    for (const leftover of [p.appNewTmp, p.appNew, zipFile]) {
      try {
        rmWithRetry(deps, leftover)
      } catch {
        // ignora
      }
    }
    try {
      rmWithRetry(deps, stagingDir(deps))
    } catch {
      // ignora
    }
    ctx.log.write(`falha na atualização: ${err?.stack ?? err}`)
    deps.print(MSG.updateFailed(describeError(err, 'o download demorou demais')))
    return false
  }
}

/** Consulta a Release mais recente e, se o usuário aceitar, prepara a atualização. */
export async function checkForUpdate(deps, ctx) {
  let release
  try {
    release = await fetchLatestRelease(deps)
  } catch (err) {
    ctx.log.write(`verificação de atualização falhou: ${err?.stack ?? err}`)
    deps.print(MSG.updateCheckFailed(describeError(err)))
    return false
  }
  const asset = pickUpdate(release, ctx.version)
  if (!asset) {
    deps.print(MSG.upToDate)
    return false
  }
  const answer = String(await deps.ask(MSG.updateAvailable(asset.version, ctx.version))).trim().toLowerCase()
  if (!YES.has(answer)) {
    deps.print(MSG.updateDeclined)
    return false
  }
  return stageUpdate(deps, ctx, asset)
}

/** Modo --apply-update (rodando de %TEMP%): troca app\ por app.new\. Sempre devolve 0. */
export function applyUpdate(deps, root, paths, log) {
  const { fs } = deps
  try {
    swapApp(fs, root, { sleepSync: deps.sleepSync })
    log.write('atualização aplicada')
    deps.print(MSG.updateApplied)
    try {
      // melhor esforço: no Windows o node.exe em execução desta pasta a mantém presa
      rmWithRetry(deps, stagingDir(deps), { attempts: 2 })
    } catch {
      // ignora
    }
  } catch (err) {
    log.write(`falha ao aplicar a atualização: ${err?.stack ?? err}`)
    try {
      rmWithRetry(deps, appPaths(root).appNew)
    } catch {
      // ignora
    }
    try {
      fs.mkdirSync(paths.dataDir, { recursive: true })
      fs.writeFileSync(paths.updateFailedFile, err.message)
    } catch {
      // ignora
    }
    // a mensagem é mostrada uma vez só, pelo próximo launcher (consumeUpdateFailure)
  }
  return 0
}

/** Lê e apaga o recado deixado por uma troca que falhou. */
export function consumeUpdateFailure(fs, paths) {
  if (!fs.existsSync(paths.updateFailedFile)) return null
  let reason = 'erro desconhecido'
  try {
    reason = fs.readFileSync(paths.updateFailedFile, 'utf8').trim() || reason
    fs.rmSync(paths.updateFailedFile, { force: true })
  } catch {
    // ignora
  }
  return reason
}
