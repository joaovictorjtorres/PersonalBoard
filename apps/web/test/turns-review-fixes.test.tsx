import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { TurnEntry } from '@mesa/shared'

vi.mock('../src/store/context', () => ({
  useTable: (selector: (s: unknown) => unknown) => selector({ objects: {} }),
  useTableActions: () => ({}),
  useTableStore: () => ({ getState: () => ({ turnHover: null }) }),
}))

import { TurnCard } from '../src/ui/turns/TurnCard'
import { onActivateKey } from '../src/ui/turns/format'
import { hoveredTurnImage, isRollPending } from '../src/store/turns'

const image = { id: 'tok', type: 'image' } as never
const entry = (tokenId: string | null): TurnEntry => ({ id: 'e1', name: 'Orc', initiative: 12, tokenId }) as TurnEntry
const turns = (entries: TurnEntry[]) => ({ entries }) as never

describe('anel de hover', () => {
  it('só aparece enquanto o card do token existe', () => {
    const objects = { tok: image }
    expect(hoveredTurnImage({ turns: turns([entry('tok')]), objects, turnHover: 'tok' })).toBe(image)
    expect(hoveredTurnImage({ turns: turns([]), objects, turnHover: 'tok' })).toBeNull()
    expect(hoveredTurnImage({ turns: turns([entry('outro')]), objects, turnHover: 'tok' })).toBeNull()
    expect(hoveredTurnImage({ turns: turns([entry('tok')]), objects, turnHover: null })).toBeNull()
  })
})

describe('rolagem pendente', () => {
  it('detecta turnsRoll no pending', () => {
    const p = (kind: string) => ({ op: { kind } }) as never
    expect(isRollPending({ pending: {} })).toBe(false)
    expect(isRollPending({ pending: { a: p('turnNext') } })).toBe(false)
    expect(isRollPending({ pending: { a: p('turnNext'), b: p('turnsRoll') } })).toBe(true)
  })
})

describe('edição por teclado', () => {
  it('nome e iniciativa do mestre são botões focáveis; para jogador, não', () => {
    const card = (isGm: boolean) =>
      renderToStaticMarkup(<TurnCard entry={entry(null)} index={0} current={false} isGm={isGm} full={false} />)
    const gm = card(true)
    expect(gm).toMatch(/<span[^>]*class="turn-name editable"[^>]*>/)
    expect(gm.match(/role="button"/g)).toHaveLength(2)
    expect(gm.match(/tabindex="0"/g)).toHaveLength(2)
    expect(card(false)).not.toContain('role="button"')
  })

  it('Enter e Espaço acionam; outras teclas, não', () => {
    const action = vi.fn()
    const handler = onActivateKey(action)
    const preventDefault = vi.fn()
    handler({ key: 'Enter', preventDefault })
    handler({ key: ' ', preventDefault })
    handler({ key: 'a', preventDefault })
    expect(action).toHaveBeenCalledTimes(2)
    expect(preventDefault).toHaveBeenCalledTimes(2)
  })
})
