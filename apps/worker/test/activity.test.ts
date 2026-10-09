import { describe, expect, it } from 'vitest'
import { ActivityReporter } from '../src/activity'

describe('ActivityReporter', () => {
  it('primeira vez avisa; depois no máximo uma vez por intervalo; mudança no número de jogadores avisa na hora', () => {
    const r = new ActivityReporter(60_000)
    expect(r.shouldReport(0, 0)).toBe(true)
    expect(r.shouldReport(30_000, 0)).toBe(false)
    expect(r.shouldReport(30_000, 1)).toBe(true)
    expect(r.shouldReport(89_999, 1)).toBe(false)
    expect(r.shouldReport(90_000, 1)).toBe(true)
  })
})
