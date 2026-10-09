import { describe, expect, it } from 'vitest'
import { LATEST_URL, assetName, pickUpdate } from '../src/release.mjs'

const asset = (version, extra = {}) => ({
  name: `MesaVirtual-v${version}-win64.zip`,
  size: 1234,
  browser_download_url: `https://github.com/joaovictorjtorres/PersonalBoard/releases/download/v${version}/MesaVirtual-v${version}-win64.zip`,
  ...extra,
})

describe('release', () => {
  it('URL da API e nome do asset', () => {
    expect(LATEST_URL).toBe('https://api.github.com/repos/joaovictorjtorres/PersonalBoard/releases/latest')
    expect(assetName('0.4.0')).toBe('MesaVirtual-v0.4.0-win64.zip')
  })

  it('escolhe o zip da versão nova', () => {
    const release = { tag_name: 'v0.5.0', assets: [{ name: 'Source code.zip', size: 9 }, asset('0.5.0')] }
    expect(pickUpdate(release, '0.4.0')).toEqual({
      version: '0.5.0',
      url: asset('0.5.0').browser_download_url,
      size: 1234,
      name: 'MesaVirtual-v0.5.0-win64.zip',
    })
  })

  it('nada a fazer quando a versão é igual ou mais velha', () => {
    expect(pickUpdate({ tag_name: 'v0.4.0', assets: [asset('0.4.0')] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.3.0', assets: [asset('0.3.0')] }, '0.4.0')).toBeNull()
  })

  it('tag inválida, sem asset ou asset de outra versão → null', () => {
    expect(pickUpdate({ tag_name: 'latest', assets: [asset('0.5.0')] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0-beta', assets: [asset('0.5.0')] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0', assets: [] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0' }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.1', assets: [asset('0.5.0')] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0', assets: [asset('0.5.0', { size: 0 })] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0', assets: [asset('0.5.0', { browser_download_url: 7 })] }, '0.4.0')).toBeNull()
    expect(pickUpdate(null, '0.4.0')).toBeNull()
    expect(pickUpdate('texto', '0.4.0')).toBeNull()
  })
})
