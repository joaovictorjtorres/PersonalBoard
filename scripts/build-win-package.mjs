#!/usr/bin/env node
// Monta dist-win/MesaVirtual e dist-win/MesaVirtual-vX.Y.Z-win64.zip.
// Só roda no Windows (CI windows-latest): o node_modules do servidor precisa do workerd win-x64,
// que o npm só instala na plataforma certa. Pré-requisito: `pnpm build` (apps/web/dist).
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  PINS, assertSha256, assetName, serverPackageJson, serverWranglerConfig, sha256File, toCrlf,
} from './win-package/lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(repo, 'dist-win')

function sh(command, cwd = repo) {
  console.log(`> ${command}`)
  const result = spawnSync(command, {
    cwd, shell: true, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  if (result.status !== 0) throw new Error(`comando falhou (${result.status}): ${command}`)
}

async function downloadVerified(pin, dir) {
  const file = path.join(dir, pin.file)
  console.log(`> baixando ${pin.url}`)
  const res = await fetch(pin.url, { headers: { 'User-Agent': 'mesa-virtual-build' } })
  if (!res.ok || !res.body) throw new Error(`download falhou (${res.status}): ${pin.url}`)
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file))
  assertSha256(await sha256File(file), pin.sha256, pin.file)
  console.log(`✓ SHA-256 de ${pin.file} confere`)
  return file
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('monte o pacote no Windows (o CI usa windows-latest): o servidor precisa do workerd win-x64')
  }
  const version = fs.readFileSync(path.join(repo, 'version.txt'), 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version.txt inválido: "${version}"`)
  const webDist = path.join(repo, 'apps', 'web', 'dist')
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('apps/web/dist não existe: rode `pnpm build` antes')

  fs.rmSync(out, { recursive: true, force: true })
  const pkg = path.join(out, 'MesaVirtual')
  const app = path.join(pkg, 'app')
  const server = path.join(app, 'server')
  const downloads = path.join(out, 'downloads')
  const bundle = path.join(out, 'worker-bundle')
  fs.mkdirSync(server, { recursive: true })
  fs.mkdirSync(downloads, { recursive: true })

  // 1. Worker pré-empacotado (zod e @mesa/shared embutidos; cloudflare:workers externo)
  sh(`pnpm --filter @mesa/worker exec wrangler deploy --dry-run --outdir "${bundle}"`)
  fs.mkdirSync(path.join(server, 'worker'))
  for (const f of ['index.js', 'index.js.map']) fs.copyFileSync(path.join(bundle, f), path.join(server, 'worker', f))

  // 2. Front compilado
  fs.cpSync(webDist, path.join(server, 'web'), { recursive: true })

  // 3. package.json + wrangler.jsonc do servidor
  const wranglerPkg = path.join(repo, 'apps', 'worker', 'node_modules', 'wrangler', 'package.json')
  const wranglerVersion = JSON.parse(fs.readFileSync(wranglerPkg, 'utf8')).version
  fs.writeFileSync(path.join(server, 'package.json'), `${JSON.stringify(serverPackageJson(wranglerVersion), null, 2)}\n`)
  const sourceConfig = fs.readFileSync(path.join(repo, 'apps', 'worker', 'wrangler.jsonc'), 'utf8')
  fs.writeFileSync(path.join(server, 'wrangler.jsonc'), `${JSON.stringify(serverWranglerConfig(sourceConfig), null, 2)}\n`)

  // 4. Dependências de produção instaladas NESTE Windows (traz @cloudflare/workerd-windows-64)
  sh('npm install --omit=dev --no-audit --no-fund --loglevel=error', server)
  const workerdExe = path.join(server, 'node_modules', '@cloudflare', 'workerd-windows-64', 'bin', 'workerd.exe')
  if (!fs.existsSync(workerdExe)) throw new Error(`workerd win-x64 ausente: ${workerdExe}`)

  // 5. Node portátil (só node.exe + LICENSE)
  const nodeZip = await downloadVerified(PINS.node, downloads)
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  execFileSync(tar, ['-xf', nodeZip, '-C', downloads], { stdio: 'inherit' })
  fs.mkdirSync(path.join(app, 'node'))
  for (const f of ['node.exe', 'LICENSE']) {
    fs.copyFileSync(path.join(downloads, PINS.node.dir, f), path.join(app, 'node', f))
  }

  // 6. cloudflared
  fs.copyFileSync(await downloadVerified(PINS.cloudflared, downloads), path.join(app, 'cloudflared.exe'))

  // 7. launcher (src inteiro, sem testes)
  const launcherSrc = path.join(repo, 'apps', 'launcher', 'src')
  fs.mkdirSync(path.join(app, 'launcher'))
  for (const f of fs.readdirSync(launcherSrc)) {
    if (f.endsWith('.mjs')) fs.copyFileSync(path.join(launcherSrc, f), path.join(app, 'launcher', f))
  }

  // 8. Versão + ponto de entrada (CRLF)
  fs.writeFileSync(path.join(app, 'version.txt'), `${version}\n`)
  const cmd = fs.readFileSync(path.join(repo, 'scripts', 'win', 'Iniciar Mesa.cmd'), 'utf8')
  fs.writeFileSync(path.join(pkg, 'Iniciar Mesa.cmd'), toCrlf(cmd))

  // 9. Zip (7z vem no windows-latest)
  const zip = path.join(out, assetName(version))
  execFileSync('7z', ['a', '-tzip', '-mx=5', zip, 'MesaVirtual'], { cwd: out, stdio: 'inherit' })
  console.log(`✓ ${zip} (${(fs.statSync(zip).size / 1_048_576).toFixed(1)} MB)`)
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
