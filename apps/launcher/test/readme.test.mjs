import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8')

describe('README', () => {
  it('cobre o §9 do spec', () => {
    for (const text of [
      '## Rodar no Windows (pacote)',
      'https://github.com/joaovictorjtorres/PersonalBoard/releases/latest',
      'MesaVirtual-vX.Y.Z-win64.zip',
      'Mais informações → Executar assim mesmo',
      '%LOCALAPPDATA%\\MesaVirtual\\',
      '"autoUpdate": false',
      'apps/worker/.wrangler/state/',
      'backups\\AAAA-MM-DD_HHMMSS',
      '## Publicar uma versão (pacote Windows)',
      'pnpm release 0.4.0',
      'não grava versão, commit nem tag (só um git fetch)',
      'o commit local é mantido (os arquivos não\nsão restaurados)',
      'app\\node\\node.exe',
      'app\\cloudflared.exe',
      '%TEMP%\\MesaVirtual-update\\node.exe',
      'a extração do Explorer falha em caminhos muito longos',
      'porta mostrada na janela (8787–8797)',
      'trocar só\no domínio',
    ]) {
      expect(readme).toContain(text)
    }
  })
})
