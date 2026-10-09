export interface TurnsWindowPrefs {
  /** null = posição padrão (centralizada no topo). */
  x: number | null
  y: number | null
  minimized: boolean
}

export const TURNS_WINDOW_WIDTH = 320
/** Abaixo da faixa com o nome da mesa. */
export const TURNS_WINDOW_TOP = 56

const key = (tableId: string) => `mesa:turns:${tableId}`
const defaults = (): TurnsWindowPrefs => ({ x: null, y: null, minimized: false })
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Posição e minimizado da MINHA janela nesta mesa; armazenamento bloqueado ou corrompido = padrão. */
export function readTurnsPrefs(tableId: string): TurnsWindowPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(tableId)) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return defaults()
    const r = raw as Record<string, unknown>
    return { x: finite(r.x), y: finite(r.y), minimized: r.minimized === true }
  } catch {
    return defaults()
  }
}

export function writeTurnsPrefs(tableId: string, prefs: TurnsWindowPrefs): void {
  try {
    localStorage.setItem(key(tableId), JSON.stringify(prefs))
  } catch {
    // modo privado/armazenamento bloqueado: vale só nesta sessão
  }
}

export function defaultPosition(viewportWidth: number): { x: number; y: number } {
  return { x: Math.max(8, Math.round((viewportWidth - TURNS_WINDOW_WIDTH) / 2)), y: TURNS_WINDOW_TOP }
}

/** Mantém `size` (largura da janela, altura do cabeçalho) dentro da tela. */
export function clampPosition(
  p: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, p.x), Math.max(0, viewport.width - size.width)),
    y: Math.min(Math.max(0, p.y), Math.max(0, viewport.height - size.height)),
  }
}
