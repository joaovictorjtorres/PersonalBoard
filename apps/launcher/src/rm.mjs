import path from 'node:path'

/*
 * Remoção recursiva sem fs.rmSync.
 *
 * No Node 24 o fs.rmSync é implementado em C++ com std::filesystem::path construído a partir da
 * string UTF-8 "estreita"; no Windows ela é interpretada na code page ANSI, então um caminho com
 * acento (ex.: C:\Users\João\...) vira outro caminho inexistente e o rmSync volta SEM erro e sem
 * apagar nada. Aqui usamos só lstat/readdir/unlink/rmdir (libuv, UTF-16 correto) e conferimos no fim
 * que o alvo sumiu de fato.
 */

const RETRYABLE = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE'])

function defaultSleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function lstatOrNull(fs, target) {
  try {
    return fs.lstatSync(target)
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

function removeOnce(fs, target) {
  const stat = lstatOrNull(fs, target)
  if (!stat) return
  if (stat.isDirectory()) {
    for (const entry of fs.readdirSync(target)) removeOnce(fs, path.join(target, entry))
    fs.rmdirSync(target)
    return
  }
  try {
    fs.unlinkSync(target)
  } catch (err) {
    // Arquivo somente-leitura no Windows: unlink dá EPERM até tirar o atributo.
    if (err && (err.code === 'EPERM' || err.code === 'EACCES')) {
      fs.chmodSync(target, 0o666)
      fs.unlinkSync(target)
      return
    }
    if (err && err.code === 'ENOENT') return
    throw err
  }
}

/**
 * Apaga arquivo ou pasta (recursivo); ausente não é erro. Tenta de novo em erros temporários
 * (antivírus/indexador) e lança se, no fim, o alvo ainda existir.
 */
export function removeTree(fs, target, { attempts = 5, delayMs = 200, sleepSync = defaultSleepSync } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      removeOnce(fs, target)
      if (!lstatOrNull(fs, target)) return
      if (attempt >= attempts) throw new Error(`não foi possível apagar ${target}`)
    } catch (err) {
      const code = err && /** @type {any} */ (err).code
      if (code === 'ENOENT') return
      if (attempt >= attempts || (code && !RETRYABLE.has(code))) throw err
    }
    sleepSync(delayMs)
  }
}
