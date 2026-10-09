import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NICKNAME_TAKEN, NicknameModal } from '../src/ui/NicknameModal'

const render = (props: Partial<Parameters<typeof NicknameModal>[0]> = {}) =>
  renderToStaticMarkup(<NicknameModal onSubmit={() => {}} {...props} />).replace(/<!-- -->/g, '')

describe('NicknameModal', () => {
  it('com jogadores conhecidos: "Já jogou aqui? Clique no seu nome" e um botão por nome (texto escapado)', () => {
    const html = render({ knownPlayers: [{ nickname: 'Ana', color: '#e6194b' }, { nickname: '<b>Bia</b>', color: '#3cb44b' }] })
    expect(html).toContain('Já jogou aqui? Clique no seu nome')
    expect(html).toContain('>Ana</button>')
    expect(html).toContain('&lt;b&gt;Bia&lt;/b&gt;')
    expect(html).not.toContain('<b>Bia')
  })

  it('sem jogadores conhecidos não mostra a seção; erro aparece como alerta; sem travessões', () => {
    const html = render({ error: NICKNAME_TAKEN })
    expect(html).not.toContain('Já jogou aqui?')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Esse apelido está em uso na mesa agora')
    expect(html).toContain('Seu apelido')
    expect(html).not.toMatch(/[–—]/)
  })
})
