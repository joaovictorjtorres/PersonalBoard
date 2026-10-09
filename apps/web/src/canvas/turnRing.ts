export const TURN_RING_PERIOD_MS = 1200
/** Folga entre a caixa do token e o anel, em px de tela. */
const RING_PAD_PX = 6
/** Quanto o anel cresce no pico do pulso, em px de tela. */
const RING_GROW_PX = 6

/** Elipse em volta da caixa (já girada) do token, em coordenadas do mapa. */
export function turnRing(
  b: { minX: number; minY: number; maxX: number; maxY: number },
  scale: number,
): { x: number; y: number; radiusX: number; radiusY: number } {
  const pad = RING_PAD_PX / scale
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    radiusX: (b.maxX - b.minX) / 2 + pad,
    radiusY: (b.maxY - b.minY) / 2 + pad,
  }
}

/** Pulso contínuo do anel da vez: `grow` em px de tela; mais aberto = mais transparente. */
export function turnRingPulse(ms: number): { grow: number; opacity: number } {
  const t = (Math.sin((ms / TURN_RING_PERIOD_MS) * 2 * Math.PI) + 1) / 2
  return { grow: RING_GROW_PX * t, opacity: 1 - 0.5 * t }
}
