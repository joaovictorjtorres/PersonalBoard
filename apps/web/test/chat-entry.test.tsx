import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatEntry } from '@mesa/shared'
import { ChatEntryView, type ChatAuthor } from '../src/ui/chat/ChatEntryView'

const ana: ChatAuthor = { nickname: 'Ana', color: '#3cb44b' }
const render = (entry: ChatEntry, author: ChatAuthor | null = ana) =>
  renderToStaticMarkup(<ChatEntryView entry={entry} author={author} onOpenImage={() => {}} />).replace(/<!-- -->/g, '')

describe('ChatEntryView', () => {
  it('com menu do autor, o nome ganha a classe que indica o botão direito; sem menu, não', () => {
    const entry: ChatEntry = { id: 'm0', at: 0, authorId: 'a', kind: 'message', text: 'oi' }
    const withMenu = renderToStaticMarkup(
      <ChatEntryView entry={entry} author={ana} onOpenImage={() => {}} onAuthorMenu={() => {}} />,
    )
    expect(withMenu).toContain('class="chat-author has-menu"')
    expect(render(entry)).not.toContain('has-menu')
  })

  // Review Focus #1
  it('texto e apelido com HTML aparecem como texto, nunca como marcação', () => {
    const html = render(
      { id: 'm1', at: 0, authorId: 'a', kind: 'message', text: '<img src=x onerror=alert(1)><b>oi</b>' },
      { nickname: '<i>Ana</i>', color: '#ff0000' },
    )
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&lt;b&gt;oi&lt;/b&gt;')
    expect(html).toContain('&lt;i&gt;Ana&lt;/i&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<i>')
  })

  it('rolagem: fórmula, modo, descartado riscado, bônus e total', () => {
    const html = render({
      id: 'r1', at: 0, authorId: 'a', kind: 'roll', secret: false,
      request: { die: 20, count: 1, bonus: 5, mode: 'advantage' },
      result: { rolls: [17, 8], kept: [17], total: 22 },
    })
    expect(html).toMatch(/Ana<\/strong> rolou <strong>1d20\+5<\/strong> \(vantagem\): \[/)
    expect(html).toContain('<s><span>8</span></s>')
    expect(html).toContain('] + 5 = <strong>22</strong>')
    expect(html).not.toContain('(só mestre)')
  })

  it('rolagem secreta tem o rótulo (só mestre); 20 natural ganha a classe crit', () => {
    const html = render({
      id: 'r2', at: 0, authorId: 'a', kind: 'roll', secret: true,
      request: { die: 20, count: 1, bonus: 0, mode: 'normal' },
      result: { rolls: [20], kept: [20], total: 20 },
    })
    expect(html).toContain('chat-entry roll secret')
    expect(html).toContain('(só mestre)')
    expect(html).toContain('<span class="crit">20</span>')
  })

  it('imagem vira miniatura clicável; autor desconhecido aparece como "Alguém"', () => {
    const html = render({ id: 'i1', at: 0, authorId: 'x', kind: 'image', assetKey: 'a'.repeat(64), width: 1000, height: 500 }, null)
    expect(html).toContain(`src="/files/${'a'.repeat(64)}"`)
    expect(html).toContain('width="240"')
    expect(html).toContain('Alguém')
  })

  it('a hora vem antes do apelido em todos os tipos de entrada', () => {
    const base = { id: 'x', at: 0, authorId: 'a' }
    const request = { die: 20 as const, count: 1, bonus: 0, mode: 'normal' as const }
    const result = { rolls: [5], kept: [5], total: 5 }
    const entries: ChatEntry[] = [
      { ...base, kind: 'message', text: 'oi' },
      { ...base, kind: 'image', assetKey: 'a'.repeat(64), width: 10, height: 10 },
      { ...base, kind: 'roll', secret: false, request, result },
      { ...base, kind: 'roll', secret: true, request, result },
    ]
    for (const entry of entries) {
      const html = render(entry)
      expect(html).toContain('class="chat-time"')
      expect(html.indexOf('<time')).toBeGreaterThan(-1)
      expect(html.indexOf('<time')).toBeLessThan(html.indexOf('Ana'))
      expect(html.indexOf('</time>')).toBeLessThan(html.indexOf('Ana'))
    }
  })
})
