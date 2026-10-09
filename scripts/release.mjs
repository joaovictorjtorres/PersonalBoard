#!/usr/bin/env node
// pnpm release X.Y.Z [--dry-run]
// Confere git e testes, grava a versão (package.json + version.txt), commita "release: vX.Y.Z",
// cria a tag e envia commit + tag juntos. O GitHub Actions monta o pacote e cria a Release.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readVersion } from '../apps/launcher/src/semver.mjs'
import { gitProblems, parseReleaseVersion, recoveryHint, setPackageVersion } from './release-lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const input = args.find((a) => !a.startsWith('--'))

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: repo, encoding: 'utf8' }).trim()

function sh(command) {
  console.log(`> ${command}`)
  const result = spawnSync(command, { cwd: repo, shell: true, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`falhou: ${command}`)
}

function main() {
  const versionFile = path.join(repo, 'version.txt')
  const version = parseReleaseVersion(input, readVersion(fs, versionFile))
  const tag = `v${version}`

  git('fetch', 'origin', 'main', '--tags')
  const problems = gitProblems({
    status: git('status', '--porcelain'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    behind: Number(git('rev-list', '--count', 'HEAD..origin/main')),
    tagExists: git('tag', '--list', tag) !== '',
  })
  if (problems.length) throw new Error(`não dá para publicar ${tag}:\n  - ${problems.join('\n  - ')}`)

  sh('pnpm typecheck')
  sh('pnpm test')
  if (dryRun) {
    console.log(`✓ Simulação de ${tag} ok: nada foi commitado nem enviado (só um git fetch).`)
    return
  }

  const packageFile = path.join(repo, 'package.json')
  let step = 'write'
  try {
    fs.writeFileSync(packageFile, setPackageVersion(fs.readFileSync(packageFile, 'utf8'), version))
    fs.writeFileSync(versionFile, `${version}\n`)
    step = 'add'
    git('add', 'package.json', 'version.txt')
    step = 'commit'
    git('commit', '-m', `release: ${tag}`)
    step = 'tag'
    git('tag', '-a', tag, '-m', `Mesa Virtual ${tag}`)
    step = 'push'
    git('push', '--atomic', 'origin', 'main', tag)
  } catch (err) {
    if (step === 'write' || step === 'add' || step === 'commit') {
      try {
        git('checkout', '--', 'package.json', 'version.txt')
      } catch {}
    }
    throw new Error(`${err.message}\n${recoveryHint(step, version)}`)
  }
  console.log(`✓ ${tag} enviada. O GitHub Actions monta o pacote e cria a Release:`)
  console.log('  https://github.com/joaovictorjtorres/PersonalBoard/actions')
}

try {
  main()
} catch (err) {
  console.error(`✗ ${err.message}`)
  process.exit(1)
}
