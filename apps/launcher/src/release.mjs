import { isNewer, normalizeVersion } from './semver.mjs'

export const REPO = 'joaovictorjtorres/PersonalBoard'
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
  if (typeof asset.browser_download_url !== 'string') return null
  if (!Number.isInteger(asset.size) || asset.size <= 0) return null
  return { version, url: asset.browser_download_url, size: asset.size, name }
}
