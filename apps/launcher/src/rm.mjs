import path from 'node:path'

/*
 * Remoção e cópia de pastas sem fs.rmSync e sem fs.cpSync.
 *
 * No Node 24.12 os dois são C++ com std::filesystem::path montado a partir da string UTF-8
 * "estreita" (src/node_file.cc: RmSync faz `std::filesystem::path(path.ToStringView())`;
 * CpSyncCopyDir faz `std::filesystem::path(*src)`). No Windows o MSVC converte isso pela code page
 * ANSI, então "C:\...\João" vira "C:\...\JoÃ£o":
 *  - rmSync não acha o caminho e volta SEM erro e sem apagar nada;
 *  - cpSync de pasta chama `std::filesystem::directory_iterator(src)` (versão que lança) num caminho
 *    inexistente → exceção C++ não tratada → abort → processo morre com 0xC0000409.
 * Aqui só usamos lstat/readdir/unlink/rmdir/mkdir/copyFile (libuv, UTF-16 correto), sem recursão
 * (pilha explícita), sem seguir links/junções e com limites de itens, tentativas e espera.
 */

const RETRYABLE = new Set(['EBUSY', 'EPERM', 'EACCES', 'ENOTEMPTY', 'EMFILE', 'ENFILE'])
const MAX_ATTEMPTS = 20
const MAX_DELAY_MS = 2000
const MAX_ENTRIES = 1_000_000
/** Maior caminho possível no Windows (\\?\ incluso). Passou disso, algo está errado (fs maluco/laço). */
const MAX_PATH_CHARS = 32_767

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? Math.floor(n) : lo))

/** Caminho longo demais: lança (sem `code`, então não é tentado de novo) em vez de crescer sem fim. */
function checkPathLength(p, target) {
  if (p.length > MAX_PATH_CHARS) throw new Error(`caminho longo demais dentro de ${target.slice(0, 200)}`)
}

/** Espera síncrona curta e limitada (Atomics.wait é permitido na thread principal do Node). */
function defaultSleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, clamp(ms, 0, MAX_DELAY_MS))
}

function lstatOrNull(fs, target) {
  try {
    return fs.lstatSync(target)
  } catch (err) {
    if (err && err.code === 'ENOENT') return null
    throw err
  }
}

function ignoreEnoent(fn) {
  try {
    fn()
  } catch (err) {
    if (!(err && err.code === 'ENOENT')) throw err
  }
}

/** Apaga um item que não é pasta "de verdade": arquivo, link simbólico ou junção (sem seguir). */
function removeEntry(fs, target, stat) {
  try {
    fs.unlinkSync(target)
  } catch (err) {
    const code = err && err.code
    if (code === 'ENOENT') return
    if (code !== 'EPERM' && code !== 'EACCES') throw err
    if (stat.isSymbolicLink()) {
      // link/junção para pasta no Windows: some com rmdir (apaga o link, não o alvo)
      ignoreEnoent(() => fs.rmdirSync(target))
      return
    }
    // arquivo somente-leitura no Windows: unlink dá EPERM até tirar o atributo (só em arquivos)
    fs.chmodSync(target, 0o666)
    ignoreEnoent(() => fs.unlinkSync(target))
  }
}

function removeOnce(fs, target, maxEntries) {
  /** @type {{ p: string, listed: boolean }[]} */
  const stack = [{ p: target, listed: false }]
  let seen = 0
  while (stack.length > 0) {
    const top = stack[stack.length - 1]
    if (top.listed) {
      stack.pop()
      ignoreEnoent(() => fs.rmdirSync(top.p))
      continue
    }
    if (++seen > maxEntries) throw new Error(`itens demais para apagar em ${target}`)
    checkPathLength(top.p, target)
    const stat = lstatOrNull(fs, top.p)
    if (!stat) {
      stack.pop()
      continue
    }
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      top.listed = true
      let names = []
      try {
        names = fs.readdirSync(top.p)
      } catch (err) {
        if (!(err && err.code === 'ENOENT')) throw err
      }
      for (const name of names) stack.push({ p: path.join(top.p, name), listed: false })
      continue
    }
    stack.pop()
    removeEntry(fs, top.p, stat)
  }
}

/**
 * Apaga arquivo ou pasta inteira; ausente não é erro. Nunca segue links/junções (apaga o link).
 * Tenta de novo em erros temporários (antivírus/indexador) e lança se, no fim, o alvo ainda existir.
 * Tentativas ≤ 20, espera ≤ 2 s cada, itens ≤ maxEntries (≤ 1 milhão), caminho ≤ 32 767 caracteres.
 */
export function removeTree(fs, target, { attempts = 5, delayMs = 200, sleepSync = defaultSleepSync, maxEntries = MAX_ENTRIES } = {}) {
  maxEntries = clamp(maxEntries, 1, MAX_ENTRIES)
  const maxAttempts = clamp(attempts, 1, MAX_ATTEMPTS)
  const delay = clamp(delayMs, 0, MAX_DELAY_MS)
  for (let attempt = 1; ; attempt++) {
    try {
      removeOnce(fs, target, maxEntries)
      if (!lstatOrNull(fs, target)) return
      if (attempt >= maxAttempts) throw new Error(`não foi possível apagar ${target}`)
    } catch (err) {
      const code = err && /** @type {any} */ (err).code
      if (code === 'ENOENT') return
      if (attempt >= maxAttempts || (code && !RETRYABLE.has(code))) throw err
    }
    sleepSync(delay)
  }
}

/**
 * Copia uma pasta (ou arquivo) para `dest`, criando as pastas. Sem recursão; links/junções e itens
 * especiais são ignorados (não há nenhum em state\ nem em launcher\).
 */
export function copyTree(fs, src, dest, { maxEntries = MAX_ENTRIES } = {}) {
  maxEntries = clamp(maxEntries, 1, MAX_ENTRIES)
  const rel = path.relative(path.resolve(src), path.resolve(dest))
  if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) {
    throw new Error(`não dá para copiar ${src} para dentro dela mesma (${dest})`)
  }
  const stack = [[src, dest]]
  let count = 0
  while (stack.length > 0) {
    if (++count > maxEntries) throw new Error(`itens demais para copiar em ${src}`)
    const [from, to] = /** @type {[string, string]} */ (stack.pop())
    checkPathLength(from, src)
    checkPathLength(to, dest)
    const stat = fs.lstatSync(from)
    if (stat.isSymbolicLink()) continue
    if (stat.isDirectory()) {
      fs.mkdirSync(to, { recursive: true })
      for (const name of fs.readdirSync(from)) stack.push([path.join(from, name), path.join(to, name)])
    } else if (stat.isFile()) {
      fs.mkdirSync(path.dirname(to), { recursive: true })
      fs.copyFileSync(from, to)
    }
  }
}
