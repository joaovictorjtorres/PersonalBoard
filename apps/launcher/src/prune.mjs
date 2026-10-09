import path from 'node:path'

export const KEEP_WRANGLER_LOGS = 10

/** Mantém só os `keep` arquivos mais novos da pasta. Melhor esforço: nunca lança. */
export function pruneOldFiles(fs, dir, keep = KEEP_WRANGLER_LOGS) {
  try {
    const files = []
    for (const name of fs.readdirSync(dir)) {
      try {
        const full = path.join(dir, name)
        const st = fs.statSync(full)
        if (st.isFile()) files.push({ full, name, mtime: st.mtimeMs })
      } catch {
        // some entre a listagem e o stat
      }
    }
    files.sort((a, b) => b.mtime - a.mtime || (a.name < b.name ? 1 : -1))
    for (const old of files.slice(keep)) {
      try {
        fs.rmSync(old.full, { force: true })
      } catch {
        // arquivo preso: fica para a próxima
      }
    }
  } catch {
    // pasta inexistente ou ilegível
  }
}
