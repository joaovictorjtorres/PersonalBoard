/**
 * Quando o TableDO avisa o índice: no máximo uma vez por intervalo, ou já quando muda o número de
 * jogadores. Só em memória (se o DO hibernar, o próximo evento avisa de novo).
 */
export class ActivityReporter {
  private lastAt = Number.NEGATIVE_INFINITY
  private lastPlayers = -1

  constructor(private intervalMs: number) {}

  shouldReport(now: number, players: number): boolean {
    if (players === this.lastPlayers && now - this.lastAt < this.intervalMs) return false
    this.lastAt = now
    this.lastPlayers = players
    return true
  }
}
