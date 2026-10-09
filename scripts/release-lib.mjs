import { compareVersions } from '../apps/launcher/src/semver.mjs'

const USAGE = 'uso: pnpm release X.Y.Z [--dry-run]  (ex.: pnpm release 0.4.0)'

export function parseReleaseVersion(input, currentVersion) {
  if (typeof input !== 'string' || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(input)) throw new Error(USAGE)
  if (compareVersions(input, currentVersion) <= 0) {
    throw new Error(`a versão ${input} precisa ser maior que a atual (${currentVersion})`)
  }
  return input
}

export function gitProblems({ status, branch, behind, tagExists }) {
  const problems = []
  if (status.trim()) problems.push('há alterações não commitadas (git status não está limpo)')
  if (branch !== 'main') problems.push(`você está no branch "${branch}"; publique a partir da main`)
  if (behind > 0) problems.push(`a main local está ${behind} commit(s) atrás de origin/main; rode git pull`)
  if (tagExists) problems.push('a tag já existe')
  return problems
}

export function setPackageVersion(packageJsonText, version) {
  const { name, version: _previous, ...rest } = JSON.parse(packageJsonText)
  const next = name === undefined ? { version, ...rest } : { name, version, ...rest }
  return `${JSON.stringify(next, null, 2)}\n`
}

export function recoveryHint(step, version) {
  const tag = `v${version}`
  if (step === 'push') {
    return `o commit e a tag ${tag} existem só localmente. Para publicar: git push --atomic origin main ${tag}. Para desistir: git tag -d ${tag} && git reset --hard HEAD~1`
  }
  if (step === 'tag') {
    return 'o commit de release existe só localmente; para desfazer: git reset --hard HEAD~1'
  }
  return 'nada foi publicado; package.json e version.txt foram restaurados (se não, rode: git checkout -- package.json version.txt)'
}
