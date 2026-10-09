const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

/** @param {unknown} text @returns {[number, number, number] | null} */
export function parseVersion(text) {
  if (typeof text !== 'string') return null
  const match = VERSION_RE.exec(text.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** @param {unknown} text @returns {string | null} "X.Y.Z" sem "v" */
export function normalizeVersion(text) {
  const parts = parseVersion(text)
  return parts ? parts.join('.') : null
}

/** @param {string} a @param {string} b @returns {-1 | 0 | 1} */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) throw new Error(`versão inválida: ${pa ? b : a}`)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/** @param {unknown} candidate @param {unknown} current */
export function isNewer(candidate, current) {
  if (!parseVersion(candidate) || !parseVersion(current)) return false
  return compareVersions(/** @type {string} */ (candidate), /** @type {string} */ (current)) > 0
}

/** Lê version.txt; ausente ou inválido → '0.0.0'. */
export function readVersion(fs, file) {
  try {
    return normalizeVersion(fs.readFileSync(file, 'utf8')) ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
