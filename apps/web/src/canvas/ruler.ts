import { formatDistance, rulerDistance } from '@mesa/shared'
import type { Ruler } from '../store/state'

export function rulerLabel(nickname: string, ruler: Ruler, size: number): string {
  return `${nickname} · ${formatDistance(rulerDistance(ruler.from, ruler.to, size))}`
}
