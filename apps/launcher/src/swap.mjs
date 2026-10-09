import path from 'node:path'

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
export function renameWithRetry(fs, from, to, { attempts = 5, delayMs = 500, sleepSync = defaultSleepSync } = {}) {
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
  fs.rmSync(p.appOld, { recursive: true, force: true })
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

/** Sobras de uma atualização interrompida. */
export function removeLeftovers(fs, root) {
  const p = appPaths(root)
  fs.rmSync(p.appNewTmp, { recursive: true, force: true })
  fs.rmSync(p.appNew, { recursive: true, force: true })
}

/** Apaga app.old\ (chamado depois que o servidor respondeu). true se havia o que apagar. */
export function removeOldApp(fs, root) {
  const { appOld } = appPaths(root)
  if (!fs.existsSync(appOld)) return false
  try {
    fs.rmSync(appOld, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
