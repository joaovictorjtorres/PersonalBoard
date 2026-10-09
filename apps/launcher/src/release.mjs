import { isNewer, normalizeVersion } from './semver.mjs'

export const REPO = 'joaovictorjtorres/PersonalBoard'
export const DOWNLOAD_PREFIX = `https://github.com/${REPO}/releases/download/`
export const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`

/** @param {string} version "X.Y.Z" */
export function assetName(version) {
  return `MesaVirtual-v${version}-win64.zip`
}

/**
 * Resposta de GET /releases/latest → asset da atualização, ou null se não há o que fazer.
 * @param {unknown} release
 * @param {string} currentVersion
 * @returns {import('./main.mjs').UpdateAsset | null}
 */
export function pickUpdate(release, currentVersion) {
  if (!release || typeof release !== 'object') return null
  const version = normalizeVersion(/** @type {any} */ (release).tag_name)
  if (!version || !isNewer(version, currentVersion)) return null
  const assets = /** @type {any} */ (release).assets
  if (!Array.isArray(assets)) return null
  const name = assetName(version)
  const asset = assets.find((a) => a && a.name === name)
  if (!asset) return null
  if (typeof asset.browser_download_url !== 'string' || !asset.browser_download_url.startsWith(DOWNLOAD_PREFIX)) return null
  if (!Number.isInteger(asset.size) || asset.size <= 0) return null
  /** @type {string | undefined} */
  let sha256
  if (typeof asset.digest === 'string' && asset.digest.toLowerCase().startsWith('sha256:')) {
    const hex = asset.digest.slice(7)
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) return null
    sha256 = hex.toLowerCase()
  }
  return { version, url: asset.browser_download_url, size: asset.size, name, ...(sha256 ? { sha256 } : {}) }
}
