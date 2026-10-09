import path from 'node:path'
import { removeTree } from './rm.mjs'

/** Código de saída que pede ao "Iniciar Mesa.cmd" para aplicar a atualização. Contrato congelado. */
export const UPDATE_EXIT_CODE = 75

export function appPaths(root) {
  return {
    app: path.join(root, 'app'),
    appNew: path.join(root, 'app.new'),
    appNewTmp: path.join(root, 'app.new.tmp'),
    appOld: path.join(root, 'app.old'),
  }
}

function defaultSleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** rename com novas tentativas (antivírus/indexador seguram arquivos por instantes no Windows). */
export function renameWithRetry(fs, from, to, { attempts = 10, delayMs = 1000, sleepSync = defaultSleepSync } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (err) {
      if (attempt >= attempts) throw err
      sleepSync(delayMs)
    }
  }
}

/** app\ → app.old\, app.new\ → app\. Em falha restaura app\ e lança com o motivo. */
export function swapApp(fs, root, retryOptions = {}) {
  const p = appPaths(root)
  if (!fs.existsSync(path.join(p.appNew, 'launcher', 'launcher.mjs'))) {
    throw new Error('a versão nova está incompleta')
  }
  // No Windows, renomear uma pasta por cima de outra que existe dá EPERM: app.old precisa sumir antes.
  removeTree(fs, p.appOld, { sleepSync: retryOptions.sleepSync })
  renameWithRetry(fs, p.app, p.appOld, retryOptions)
  try {
    renameWithRetry(fs, p.appNew, p.app, retryOptions)
  } catch (err) {
    try {
      renameWithRetry(fs, p.appOld, p.app, retryOptions)
    } catch {
      throw new Error(`falha ao trocar a pasta app e ao restaurar a anterior (${err.message}); a versão anterior está em app.old`)
    }
    throw new Error(`arquivo em uso ao trocar a pasta app (${err.message})`)
  }
}

/** Atualização interrompida entre os dois renames: app\ sumiu mas app.old\ existe → volta. */
export function restoreOldApp(fs, root, retryOptions = {}) {
  const p = appPaths(root)
  if (fs.existsSync(p.app) || !fs.existsSync(p.appOld)) return false
  renameWithRetry(fs, p.appOld, p.app, retryOptions)
  return true
}

/** Sobras de uma atualização interrompida. */
export function removeLeftovers(fs, root, { sleepSync } = {}) {
  const p = appPaths(root)
  removeTree(fs, p.appNewTmp, { sleepSync })
  removeTree(fs, p.appNew, { sleepSync })
}

/** Apaga app.old\ (chamado depois que o servidor respondeu). true se havia o que apagar. */
export function removeOldApp(fs, root, { sleepSync } = {}) {
  const { appOld } = appPaths(root)
  if (!fs.existsSync(appOld)) return false
  try {
    removeTree(fs, appOld, { sleepSync })
    return true
  } catch {
    return false
  }
}
