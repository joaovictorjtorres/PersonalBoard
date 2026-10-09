export class ArgError extends Error {}

/** @param {string[]} argv @returns {import('./main.mjs').LauncherOptions} */
export function parseArgs(argv) {
  const opts = { smoke: false, noUpdate: false, applyUpdate: false, port: undefined, root: undefined }
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1
    const flag = eq > 0 ? raw.slice(0, eq) : raw
    const inline = eq > 0 ? raw.slice(eq + 1) : undefined
    switch (flag) {
      case '--smoke':
        opts.smoke = true
        break
      case '--no-update':
        opts.noUpdate = true
        break
      case '--apply-update':
        opts.applyUpdate = true
        break
      case '--port':
      case '--root': {
        const value = inline ?? argv[++i]
        if (value === undefined || value === '') throw new ArgError(`${flag} precisa de um valor`)
        if (flag === '--root') {
          opts.root = value
          break
        }
        const port = Number(value)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ArgError(`porta inválida: ${value}`)
        opts.port = port
        break
      }
      default:
        throw new ArgError(`opção desconhecida: ${raw}`)
    }
  }
  return opts
}
