import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RegistryTable } from '@mesa/shared'
import { deleteConfirmOptions, formatWhen, playersLabel, tableLinks, type RegistryLoad } from '../src/lib/registry'
import { HomeView, type HomeActions } from '../src/ui/HomeView'

const table: RegistryTable = {
  id: 'AbCdEfGhIj', name: 'Campanha <b>', createdAt: Date.UTC(2026, 9, 1, 12), lastActivityAt: Date.UTC(2026, 9, 8, 12),
  players: 2, gmSecret: 'segredo', playerKey: null,
}
const actions: HomeActions = { create: async () => true, rename: async () => true, remove: async () => {}, retry: () => {} }
const render = (load: RegistryLoad | null) =>
  renderToStaticMarkup(<HomeView load={load} origin="http://localhost:8787" actions={actions} notice={null} />).replace(/<!-- -->/g, '')

describe('HomeView', () => {
  it('local com túnel: link do túnel, card com nome escapado, jogadores e todos os botões', () => {
    const html = render({ kind: 'local', view: { tables: [table], tunnelUrl: 'https://abc-def.trycloudflare.com' } })
    expect(html).toContain('https://abc-def.trycloudflare.com')
    expect(html).toContain('Campanha &lt;b&gt;')
    expect(html).not.toContain('Campanha <b>')
    expect(html).toContain('2 jogadores')
    for (const label of ['Abrir como mestre', 'Copiar link de mestre', 'Copiar link de jogador', 'Renomear', 'Apagar', 'Criar mesa', 'Nome da mesa']) {
      expect(html, label).toContain(label)
    }
    expect(html).toContain('href="/t/AbCdEfGhIj#gm=segredo"')
  })

  it('local sem túnel: "Túnel indisponível, só local"; lista vazia convida a criar', () => {
    const html = render({ kind: 'local', view: { tables: [], tunnelUrl: null } })
    expect(html).toContain('Túnel indisponível, só local')
    expect(html).toContain('Nenhuma mesa ainda')
  })

  it('remoto: só "Peça o link da mesa ao mestre", sem lista e sem criar mesa', () => {
    const html = render({ kind: 'remote' })
    expect(html).toContain('Peça o link da mesa ao mestre')
    expect(html).not.toContain('Criar mesa')
    expect(html).not.toContain('Abrir como mestre')
  })

  it('erro mostra "Tentar de novo"; nenhum estado tem travessão', () => {
    expect(render({ kind: 'error' })).toContain('Tentar de novo')
    for (const load of [null, { kind: 'remote' }, { kind: 'error' }, { kind: 'local', view: { tables: [table], tunnelUrl: null } }] as const) {
      expect(render(load as RegistryLoad | null)).not.toMatch(/[–—]/)
    }
  })
})

describe('helpers da página inicial', () => {
  it('tableLinks: com túnel usa o túnel; sem túnel usa a origem local; "Abrir como mestre" é relativo; chave de jogador vai no #j=', () => {
    expect(tableLinks('http://localhost:8787', 'https://t.trycloudflare.com', table)).toEqual({
      player: 'https://t.trycloudflare.com/t/AbCdEfGhIj',
      gm: 'https://t.trycloudflare.com/t/AbCdEfGhIj#gm=segredo',
      openAsGm: '/t/AbCdEfGhIj#gm=segredo',
    })
    expect(tableLinks('http://localhost:8787', null, { ...table, playerKey: 'k1' }).player).toBe('http://localhost:8787/t/AbCdEfGhIj#j=k1')
  })

  it('playersLabel, formatWhen e texto do aviso de apagar', () => {
    expect([0, 1, 3].map(playersLabel)).toEqual(['Nenhum jogador', '1 jogador', '3 jogadores'])
    expect(formatWhen(Date.UTC(2026, 9, 8, 12))).toContain('2026')
    expect(deleteConfirmOptions('Sexta')).toEqual({
      title: 'Apagar mesa',
      message: 'Apagar a mesa Sexta? Desenhos, tokens, chat e turnos serão perdidos.',
      confirmLabel: 'Apagar',
      danger: true,
    })
  })
})
