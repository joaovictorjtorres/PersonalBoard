import { describe, expect, it } from 'vitest'
import { shouldRetryAuth } from '../src/lib/identity'

describe('shouldRetryAuth', () => {
  // Review Focus #3
  it('tenta de novo uma vez quando outra aba gravou um segredo diferente do enviado', () => {
    expect(shouldRetryAuth(undefined, 'novo', false)).toBe(true)
    expect(shouldRetryAuth('velho', 'novo', false)).toBe(true)
  })

  it('não tenta de novo se já tentou, se nada mudou ou se não há segredo guardado', () => {
    expect(shouldRetryAuth(undefined, 'novo', true)).toBe(false)
    expect(shouldRetryAuth('igual', 'igual', false)).toBe(false)
    expect(shouldRetryAuth('velho', undefined, false)).toBe(false)
  })
})
