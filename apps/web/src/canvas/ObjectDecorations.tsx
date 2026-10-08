import { Group, Line, Rect, Text } from 'react-konva'
import type { TableObject } from '@mesa/shared'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { rotatedBounds } from './bounds'

const TITLE_FONT_PX = 13
const TITLE_BOX_PX = 320
const NOTE_ICON_PX = 14

/** Título (todos) e glifo de "nota adesiva" (só mestre), com tamanho fixo na tela. */
export function ObjectDecorations({ object }: { object: TableObject }) {
  const scale = useTable((s) => s.viewport.scale)
  const showNote = useTable((s) => s.self?.role === 'gm' && !!s.notes[object.id])
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  if (!object.title && !showNote) return null

  const g = lockedByOther && preview ? preview : object
  const box = rotatedBounds(g)
  const k = 1 / scale

  return (
    <Group listening={false}>
      {object.title && (
        <Text
          text={object.title}
          x={(box.minX + box.maxX) / 2 - (TITLE_BOX_PX * k) / 2}
          y={box.maxY + 4 * k}
          width={TITLE_BOX_PX * k}
          align="center"
          wrap="none"
          ellipsis
          fontSize={TITLE_FONT_PX * k}
          fill="#ffffff"
          stroke="#111111"
          strokeWidth={3 * k}
          fillAfterStrokeEnabled
        />
      )}
      {showNote && (
        <Group x={box.maxX - (NOTE_ICON_PX * k) / 2} y={box.minY - (NOTE_ICON_PX * k) / 2} scaleX={k} scaleY={k}>
          <Rect width={NOTE_ICON_PX} height={NOTE_ICON_PX} cornerRadius={2} fill="#ffd43b" stroke="#5c4500" strokeWidth={1} />
          <Line points={[4, 5, 10, 5]} stroke="#5c4500" strokeWidth={1} />
          <Line points={[4, 8, 10, 8]} stroke="#5c4500" strokeWidth={1} />
        </Group>
      )}
    </Group>
  )
}
