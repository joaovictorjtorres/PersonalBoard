import { afterEach, describe, expect, it } from 'vitest'
import { askChoice, askConfirm, confirmKeyAction, confirmStore, plural, settleConfirm } from '../src/ui/confirm'

afterEach(() => settleConfirm(false))

describe('askConfirm', () => {
  it('abre um pedido e resolve com a resposta', async () => {
    const answer = askConfirm({ title: 'Apagar', message: 'Certeza?', danger: true })
    expect(confirmStore.getState().request).toMatchObject({ title: 'Apagar', message: 'Certeza?', danger: true })
    settleConfirm(true)
    await expect(answer).resolves.toBe(true)
    expect(confirmStore.getState().request).toBeNull()
  })

  it('um pedido novo cancela o anterior', async () => {
    const first = askConfirm({ title: 'A', message: 'a' })
    const second = askConfirm({ title: 'B', message: 'b' })
    await expect(first).resolves.toBe(false)
    expect(confirmStore.getState().request?.title).toBe('B')
    settleConfirm(false)
    await expect(second).resolves.toBe(false)
  })

  it('teclas: Esc cancela; Enter confirma, salvo com o foco em Cancelar; o resto não faz nada', () => {
    expect(confirmKeyAction('Escape', false)).toBe('cancel')
    expect(confirmKeyAction('Enter', false)).toBe('confirm')
    expect(confirmKeyAction('Enter', true)).toBe('cancel')
    expect(confirmKeyAction('a', false)).toBeNull()
  })

  it('plural', () => {
    expect(plural(1, 'desenho', 'desenhos')).toBe('1 desenho')
    expect(plural(0, 'desenho', 'desenhos')).toBe('0 desenhos')
  })
})

describe('askChoice', () => {
  it('três respostas: confirmar, alternativa e cancelar', async () => {
    const a = askChoice({ title: 'Encerrar', message: 'm', confirmLabel: 'Manter', alternativeLabel: 'Limpar', alternativeDanger: true })
    expect(confirmStore.getState().request).toMatchObject({ alternativeLabel: 'Limpar', alternativeDanger: true })
    settleConfirm('alternative')
    await expect(a).resolves.toBe('alternative')
    const b = askChoice({ title: 'E', message: 'm', alternativeLabel: 'L' })
    settleConfirm(true)
    await expect(b).resolves.toBe('confirm')
    const c = askChoice({ title: 'E', message: 'm', alternativeLabel: 'L' })
    settleConfirm(false)
    await expect(c).resolves.toBe('cancel')
  })

  it('askConfirm continua booleano; um pedido novo cancela o anterior', async () => {
    const a = askConfirm({ title: 'A', message: 'a' })
    settleConfirm('alternative')
    await expect(a).resolves.toBe(false)
    const first = askChoice({ title: 'A', message: 'a', alternativeLabel: 'L' })
    const second = askConfirm({ title: 'B', message: 'b' })
    await expect(first).resolves.toBe('cancel')
    settleConfirm(true)
    await expect(second).resolves.toBe(true)
  })
})

describe('sem diálogos do navegador', () => {
  // Fonte crua de todo o apps/web/src (o Vite resolve o glob no carregamento do teste).
  const sources = import.meta.glob<string>('../src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

  it('apps/web/src não usa window.confirm/alert/prompt (usar askConfirm)', () => {
    expect(Object.keys(sources).length).toBeGreaterThan(20)
    const offenders = Object.entries(sources).flatMap(([path, text]) =>
      text
        .split('\n')
        .map((line, i) => `${path}:${i + 1}: ${line.trim()}`)
        .filter((line) => /\bwindow\.(confirm|alert|prompt)\b|\b(alert|confirm|prompt)\(/.test(line.slice(line.indexOf(': ') + 2))),
    )
    expect(offenders).toEqual([])
  })
})
