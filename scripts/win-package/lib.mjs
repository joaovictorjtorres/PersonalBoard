import crypto from 'node:crypto'
import fs from 'node:fs'

export { assetName } from '../../apps/launcher/src/release.mjs'

// Versões e SHA-256 fixados. Node: https://nodejs.org/dist/v24.12.0/SHASUMS256.txt
// cloudflared: campo "digest" do asset em https://api.github.com/repos/cloudflare/cloudflared/releases/tags/2026.10.0
export const PINS = {
  node: {
    version: '24.12.0',
    url: 'https://nodejs.org/dist/v24.12.0/node-v24.12.0-win-x64.zip',
    file: 'node-v24.12.0-win-x64.zip',
    dir: 'node-v24.12.0-win-x64',
    sha256: '9c125f61ae947b52e779095830f9cac267846a043ef7192183c84016aaad2812',
  },
  cloudflared: {
    version: '2026.10.0',
    url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-windows-amd64.exe',
    file: 'cloudflared-windows-amd64.exe',
    sha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c',
  },
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export function assertSha256(actual, expected, label) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`checksum de ${label} não confere: esperado ${expected}, obtido ${actual}`)
  }
}

// JSONC → JSON: tira comentários de linha e de bloco fora de strings, e vírgulas antes de } ou ].
export function stripJsonComments(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (inString) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i++
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else {
      out += c
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** wrangler.jsonc do pacote: Worker pré-empacotado em worker/index.js e front em web/. */
export function serverWranglerConfig(sourceText) {
  const config = JSON.parse(stripJsonComments(sourceText))
  delete config.$schema
  config.main = 'worker/index.js'
  config.assets = { ...config.assets, directory: 'web' }
  return config
}

export function serverPackageJson(wranglerVersion) {
  return {
    name: 'mesa-virtual-server',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: { wrangler: wranglerVersion },
  }
}

export function toCrlf(text) {
  return text.replace(/\r?\n/g, '\r\n')
}
