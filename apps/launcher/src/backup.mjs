import path from 'node:path'
import { writeConfig } from './config.mjs'

export const KEEP_BACKUPS = 10
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const BACKUP_NAME_RE = /^(\d{4}-\d{2}-\d{2}_\d{6})(?:-(\d+))?$/

export function backupDue(lastBackupIso, nowMs) {
  if (typeof lastBackupIso !== 'string') return true
  const last = Date.parse(lastBackupIso)
  if (Number.isNaN(last) || last > nowMs) return true
  return nowMs - last > BACKUP_INTERVAL_MS
}

const pad = (n) => String(n).padStart(2, '0')

/** Hora local: AAAA-MM-DD_HHMMSS */
export function backupName(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function compareBackupNames(a, b) {
  const ma = BACKUP_NAME_RE.exec(a)
  const mb = BACKUP_NAME_RE.exec(b)
  if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1
  return Number(ma[2] ?? 1) - Number(mb[2] ?? 1)
}

/** Só pastas com o padrão automático contam; o resto (do usuário) nunca é apagado. */
export function backupsToDelete(names, keep = KEEP_BACKUPS) {
  const managed = names.filter((n) => BACKUP_NAME_RE.test(n)).sort(compareBackupNames)
  return managed.slice(0, Math.max(0, managed.length - keep))
}

/** Copia state\ para backups\<nome>. Devolve o nome, ou null se não havia o que copiar. */
export function makeBackup(fs, { stateDir, backupsDir, date, keep = KEEP_BACKUPS }) {
  if (!fs.existsSync(stateDir) || fs.readdirSync(stateDir).length === 0) return null
  fs.mkdirSync(backupsDir, { recursive: true })
  for (const entry of fs.readdirSync(backupsDir)) {
    if (entry.startsWith('.') && entry.endsWith('.partial')) {
      fs.rmSync(path.join(backupsDir, entry), { recursive: true, force: true })
    }
  }
  const base = backupName(date)
  let name = base
  for (let i = 2; fs.existsSync(path.join(backupsDir, name)); i++) name = `${base}-${i}`
  const partial = path.join(backupsDir, `.${name}.partial`)
  fs.cpSync(stateDir, partial, { recursive: true })
  fs.renameSync(partial, path.join(backupsDir, name))
  for (const old of backupsToDelete(fs.readdirSync(backupsDir), keep)) {
    fs.rmSync(path.join(backupsDir, old), { recursive: true, force: true })
  }
  return name
}

/** Backup agora + atualiza config.lastBackup. Lança se a cópia falhar. */
export function backupNow(deps, ctx) {
  const date = new Date(deps.now())
  const name = makeBackup(deps.fs, { stateDir: ctx.paths.stateDir, backupsDir: ctx.paths.backupsDir, date })
  if (!name) return null
  ctx.config.lastBackup = date.toISOString()
  if (ctx.configWritable) writeConfig(deps.fs, ctx.paths.configFile, ctx.config)
  return name
}
