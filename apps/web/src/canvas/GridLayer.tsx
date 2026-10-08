import { Layer, Shape } from 'react-konva'
import { useTable } from '../store/context'
import { visibleGridLines } from './grid'
import { useWindowSize } from './hooks'

/** Linhas de 1 px de tela (strokeScaleEnabled=false), branco 25%, só na área visível. */
export function GridLayer() {
  const grid = useTable((s) => s.settings.grid)
  const viewport = useTable((s) => s.viewport)
  const screen = useWindowSize()
  if (!grid.enabled) return null
  const lines = visibleGridLines(viewport, screen.width, screen.height, grid.size)
  if (!lines) return null
  return (
    <Layer listening={false}>
      <Shape
        stroke="rgba(255, 255, 255, 0.25)"
        strokeWidth={1}
        strokeScaleEnabled={false}
        sceneFunc={(ctx, shape) => {
          ctx.beginPath()
          for (const x of lines.xs) {
            ctx.moveTo(x, lines.minY)
            ctx.lineTo(x, lines.maxY)
          }
          for (const y of lines.ys) {
            ctx.moveTo(lines.minX, y)
            ctx.lineTo(lines.maxX, y)
          }
          ctx.strokeShape(shape)
        }}
      />
    </Layer>
  )
}
