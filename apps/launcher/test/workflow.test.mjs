import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PINS, assetName } from '../../../scripts/win-package/lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const workflowFile = path.join(repo, '.github', 'workflows', 'release.yml')

describe('release.yml', () => {
  it('existe e segue o spec (tag v*, main, dispatch, windows-latest, contents: write)', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    expect(yml).toMatch(/on:\s*\n\s*push:\s*\n\s*branches:\s*\[main\]\s*\n\s*tags:\s*\['v\*'\]\s*\n\s*workflow_dispatch:/)
    expect(yml).toMatch(/runs-on:\s*windows-latest/)
    expect(yml).toMatch(/permissions:\s*\n\s*contents:\s*write/)
  })

  it('Node do CI = Node portátil do pacote; pnpm 12; lockfile congelado', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    expect(yml).toContain(`node-version: ${PINS.node.version}`)
    expect(yml).toMatch(/version:\s*12\.\d+\.\d+/)
    expect(yml).toContain('pnpm install --frozen-lockfile')
  })

  it('confere a tag, testa, monta, faz a fumaça no zip extraído e publica', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    const order = [
      'version.txt', 'pnpm typecheck', '@mesa/shared exec vitest', '@mesa/launcher exec vitest',
      '@mesa/web exec vitest', '@mesa/worker exec vitest', 'pnpm build', 'pnpm win:package',
      '--smoke --port 18787', 'gh release create',
    ].map((s) => yml.indexOf(s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(yml).toContain(`dist-win\\${assetName('$env:VERSION')}`)
    expect(yml).toContain('MESA_DATA_DIR')
    expect(yml).toContain('--generate-notes')
    expect(yml).toContain('GH_TOKEN: ${{ github.token }}')
    expect(yml).not.toContain('pnpm e2e')
  })

  it('o build do front roda imediatamente antes do pacote, no mesmo job', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    const build = yml.indexOf('run: pnpm build')
    const pkg = yml.indexOf('run: pnpm win:package')
    expect(build).toBeGreaterThan(0)
    const between = yml.slice(build, pkg)
    expect(between.match(/^\s*- (name|uses):/gm)?.length).toBe(1)
    expect(yml.match(/^ {2}[\w-]+:\s*$/gm)).toContain('  windows-package:')
    expect(yml.match(/runs-on:/g)).toHaveLength(1)
  })

  it('ensaio sem tag: confere a tag e cria a Release só em refs/tags/v*; version.txt dá a versão', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    const steps = yml.split(/^ {6}- /m)
    const tagStep = steps.find((s) => s.includes('name: Tag confere com version.txt'))
    const releaseStep = steps.find((s) => s.includes('name: Criar a Release'))
    expect(tagStep).toContain("if: startsWith(github.ref, 'refs/tags/v')")
    expect(releaseStep).toContain("if: startsWith(github.ref, 'refs/tags/v')")
    const versionStep = steps.find((s) => s.includes('Get-Content version.txt'))
    expect(versionStep).not.toContain('if:')
    expect(versionStep).toContain('VERSION=$version')
    // os testes por pacote: o primeiro roda sempre; os demais rodam mesmo se um anterior falhar
    const testSteps = steps.filter((s) => s.includes('name: "Testes: '))
    expect(testSteps).toHaveLength(4)
    testSteps.forEach((s, i) => {
      expect(s).toContain('--reporter=github-actions')
      if (i === 0) expect(s).not.toMatch(/^\s+if:/m)
      else expect(s).toContain('if: ${{ !cancelled() }}')
    })
    // os demais passos rodam sempre
    for (const s of steps.filter((s) => /^(name|uses):/.test(s) && s !== tagStep && s !== releaseStep && !testSteps.includes(s))) {
      expect(s).not.toMatch(/^\s+if:/m)
    }
  })

  it('fumaça com timeout de 5 min e checkout sem credenciais', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    const smoke = yml.split(/^ {6}- /m).find((s) => s.includes('Teste de fumaça'))
    expect(smoke).toContain('timeout-minutes: 5')
    expect(yml).toContain('persist-credentials: false')
  })

  it('todo `uses:` fixado em SHA de 40 hex com comentário de versão', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    const uses = yml.split('\n').filter((l) => /^\s*(- )?uses:/.test(l))
    expect(uses.length).toBeGreaterThanOrEqual(3)
    for (const line of uses) expect(line).toMatch(/uses:\s*[\w.-]+\/[\w.-]+@[0-9a-f]{40}\s+# v\d+(\.\d+)*\s*$/)
  })
})
