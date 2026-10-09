// Falha se o repositório rastreia dois arquivos cujos caminhos diferem só por maiúsculas/minúsculas.
// Windows e macOS (sistemas de arquivos case-insensitive) não conseguem checkout de ambos.
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('caminhos rastreados pelo git', () => {
  it('não têm duplicatas que diferem só por caixa', () => {
    const files = execFileSync('git', ['ls-files', '-z'], { cwd: repo, encoding: 'utf8' })
      .split('\0')
      .filter(Boolean)
    const groups = new Map()
    for (const f of files) {
      const key = f.toLowerCase()
      groups.set(key, [...(groups.get(key) ?? []), f])
    }
    const collisions = [...groups.values()].filter((g) => g.length > 1)
    expect(collisions).toEqual([])
  })
})
