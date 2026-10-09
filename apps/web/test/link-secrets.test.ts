import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

function stub(hash: string) {
  const mem = new Map<string, string>()
  const replaced: string[] = []
  const location = { hash, pathname: '/t/T', search: '?debug=1' }
  vi.stubGlobal('window', { location })
  // como no navegador: trocar a URL sem fragmento também limpa location.hash
  vi.stubGlobal('history', {
    replaceState: (_s: unknown, _t: string, url: string) => {
      replaced.push(url)
      location.hash = ''
    },
  })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
  return { mem, replaced }
}

describe('segredos do link', () => {
  it('#j= é guardado por mesa e o fragmento sai da barra; segunda leitura vem do armazenamento', async () => {
    const { mem, replaced } = stub('#j=chave1')
    const { readPlayerKey, readGmSecret } = await import('../src/lib/identity')
    expect(readPlayerKey('T')).toBe('chave1')
    expect(readGmSecret('T')).toBeUndefined()
    expect(mem.get('mesa:key:T')).toBe('chave1')
    expect(replaced).toEqual(['/t/T?debug=1'])
    expect(readPlayerKey('T')).toBe('chave1')
  })

  it('#gm= continua funcionando depois de ler a chave (uma passada só lê os dois)', async () => {
    stub('#gm=segredo')
    const { readPlayerKey, readGmSecret } = await import('../src/lib/identity')
    expect(readPlayerKey('T')).toBeUndefined()
    expect(readGmSecret('T')).toBe('segredo')
  })

  it('segredo de mestre e chave novos gravados por outra aba valem para a aba aberta (armazenamento antes da memória)', async () => {
    const { mem } = stub('#gm=velho&j=chaveVelha')
    const { readPlayerKey, readGmSecret, rememberGmSecret } = await import('../src/lib/identity')
    expect(readGmSecret('T')).toBe('velho')
    rememberGmSecret('T', 'novo')
    mem.set('mesa:key:T', 'chaveNova')
    expect(readGmSecret('T')).toBe('novo')
    expect(readPlayerKey('T')).toBe('chaveNova')
  })

  it('armazenamento bloqueado: a memória do link aberto continua valendo', async () => {
    stub('#gm=segredo&j=chave')
    vi.stubGlobal('localStorage', {
      getItem: () => {
        throw new Error('bloqueado')
      },
      setItem: () => {
        throw new Error('bloqueado')
      },
    })
    const { readPlayerKey, readGmSecret } = await import('../src/lib/identity')
    expect(readGmSecret('T')).toBe('segredo')
    expect(readPlayerKey('T')).toBe('chave')
  })
})
