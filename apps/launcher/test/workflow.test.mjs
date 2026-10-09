import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PINS, assetName } from '../../../scripts/win-package/lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const workflowFile = path.join(repo, '.github', 'workflows', 'release.yml')

describe('release.yml', () => {
  it('existe e segue o spec (tag v*, windows-latest, contents: write)', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    expect(yml).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:\s*\['v\*'\]/)
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
      'version.txt', 'pnpm typecheck', 'pnpm test', 'pnpm build', 'pnpm win:package',
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
})
