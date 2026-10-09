import path from 'node:path'

export const DEFAULT_CONFIG = Object.freeze({ autoUpdate: true, lastBackup: null })

/** @returns {import('./main.mjs').DataPaths} */
export function dataPaths(env, homedir) {
  const localAppData = env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local')
  const dataDir = env.MESA_DATA_DIR ? path.resolve(env.MESA_DATA_DIR) : path.join(localAppData, 'MesaVirtual')
  return {
    dataDir,
    stateDir: path.join(dataDir, 'state'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    logFile: path.join(dataDir, 'logs', 'launcher.log'),
    configFile: path.join(dataDir, 'config.json'),
    updateFailedFile: path.join(dataDir, 'update-failed.txt'),
  }
}

const INVALID_FILE = 'arquivo inválido; usando o padrão (o arquivo não foi alterado)'

/** @returns {{ config: import('./main.mjs').Config, warnings: string[], writable: boolean }} */
export function readConfig(fs, file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { config: { ...DEFAULT_CONFIG }, warnings: [], writable: true }
  }
  let parsed
  try {
    parsed = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw)
  } catch {
    return { config: { ...DEFAULT_CONFIG }, warnings: [INVALID_FILE], writable: false }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: { ...DEFAULT_CONFIG }, warnings: [INVALID_FILE], writable: false }
  }
  const warnings = []
  const config = { ...parsed, autoUpdate: true, lastBackup: null }
  if (typeof parsed.autoUpdate === 'boolean') config.autoUpdate = parsed.autoUpdate
  else if (parsed.autoUpdate !== undefined) warnings.push('"autoUpdate" deve ser true ou false (sem aspas); usando true')
  if (typeof parsed.lastBackup === 'string' && !Number.isNaN(Date.parse(parsed.lastBackup))) {
    config.lastBackup = parsed.lastBackup
  }
  return { config, warnings, writable: true }
}

export function writeConfig(fs, file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`)
  fs.renameSync(tmp, file)
}
