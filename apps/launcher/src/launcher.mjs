// Mesa Virtual — launcher do pacote Windows. Chamado pelo "Iniciar Mesa.cmd":
//   app\node\node.exe app\launcher\launcher.mjs --root "<pasta do pacote>" [--smoke] [--no-update] [--port N]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArgError, parseArgs } from './args.mjs'
import { createRealDeps } from './deps.mjs'
import { run } from './main.mjs'

const launcherDir = path.dirname(fileURLToPath(import.meta.url))

/** Sai com o código sem cortar o console (no Windows a escrita no TTY é assíncrona). */
function exitWith(code) {
  process.exitCode = code
  setTimeout(() => process.exit(code), 1_000).unref()
}

let opts
try {
  opts = parseArgs(process.argv.slice(2))
} catch (err) {
  process.stderr.write(`✗ ${err instanceof ArgError ? err.message : String(err)}\n`)
  process.exit(2)
}

run(createRealDeps(launcherDir), opts).then(exitWith, (err) => {
  process.stderr.write(`✗ Erro inesperado: ${err?.stack ?? err}\n`)
  exitWith(1)
})
