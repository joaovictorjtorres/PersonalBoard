/** Janela deslizante por chave, só em memória (zera se o DO hibernar). Tentativas recusadas não contam. */
export class RateLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs)
    const allowed = recent.length < this.limit
    if (allowed) recent.push(t)
    if (recent.length === 0) this.hits.delete(key)
    else this.hits.set(key, recent)
    return allowed
  }
}
