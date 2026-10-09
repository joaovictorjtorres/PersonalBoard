import path from 'node:path'
import { removeTree } from './rm.mjs'

export const LOG_MAX_BYTES = 1024 * 1024
export const LOG_FILES = 3

/** launcher.log (0), launcher.1.log (1), launcher.2.log (2)… */
export function rotatedName(file, index) {
  if (index === 0) return file
  const ext = path.extname(file)
  return `${file.slice(0, file.length - ext.length)}.${index}${ext}`
}

export function rotateLogs(fs, file, maxFiles = LOG_FILES) {
  removeTree(fs, rotatedName(file, maxFiles - 1), { attempts: 1 })
  for (let i = maxFiles - 2; i >= 0; i--) {
    const from = rotatedName(file, i)
    if (fs.existsSync(from)) fs.renameSync(from, rotatedName(file, i + 1))
  }
}

/** @returns {import('./main.mjs').Logger} — nunca lança: log não pode derrubar o launcher. */
export function createLogger(fs, file, { maxBytes = LOG_MAX_BYTES, maxFiles = LOG_FILES, now = () => Date.now() } = {}) {
  let size = 0
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    size = fs.existsSync(file) ? fs.statSync(file).size : 0
  } catch {
    // sem pasta de log: write() vai falhar em silêncio
  }
  return {
    write(text) {
      const line = `${new Date(now()).toISOString()} ${text}\n`
      const bytes = Buffer.byteLength(line)
      if (size > 0 && size + bytes > maxBytes) {
        try {
          rotateLogs(fs, file, maxFiles)
        } catch {
          // rotação falhou: segue anexando ao arquivo atual
        }
        size = 0
      }
      try {
        fs.appendFileSync(file, line)
        size += bytes
      } catch {
        // ignora
      }
    },
  }
}

export function createTail(max) {
  const lines = []
  return {
    push(line) {
      lines.push(line)
      if (lines.length > max) lines.shift()
    },
    lines: () => [...lines],
  }
}
