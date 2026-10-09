import { describe, expect, it } from 'vitest'
import { pickUpdate } from '../src/release.mjs'
import { releaseFixture } from './harness.mjs'

const withAsset = (patch) => {
  const r = releaseFixture('0.5.0')
  Object.assign(r.assets[0], patch)
  return r
}

describe('pickUpdate: integridade', () => {
  it('aceita só URLs de download do repositório oficial', () => {
    expect(pickUpdate(releaseFixture('0.5.0'), '0.4.0')?.version).toBe('0.5.0')
    for (const url of [
      'https://evil.example/releases/download/v0.5.0/MesaVirtual-v0.5.0-win64.zip',
      'https://github.com/outro/repo/releases/download/v0.5.0/MesaVirtual-v0.5.0-win64.zip',
      'http://github.com/joaovictorjtorres/PersonalBoard/releases/download/v0.5.0/x.zip',
    ]) {
      expect(pickUpdate(withAsset({ browser_download_url: url }), '0.4.0')).toBeNull()
    }
  })

  it('digest sha256:<hex> vira asset.sha256; sem digest segue sem; digest quebrado recusa', () => {
    const hex = 'ab'.repeat(32)
    expect(pickUpdate(withAsset({ digest: `sha256:${hex.toUpperCase()}` }), '0.4.0')?.sha256).toBe(hex)
    expect(pickUpdate(releaseFixture('0.5.0'), '0.4.0')).not.toHaveProperty('sha256')
    expect(pickUpdate(withAsset({ digest: 'sha256:xyz' }), '0.4.0')).toBeNull()
  })
})
