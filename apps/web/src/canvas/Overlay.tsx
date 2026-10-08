import { Circle, Group, Layer, Line, Rect, Text } from 'react-konva'
import { useTable } from '../store/context'
import { useNow } from './hooks'

export function Overlay() {
  const now = useNow(1000)
  const cursors = useTable((s) => s.cursors)
  const members = useTable((s) => s.members)
  const locks = useTable((s) => s.locks)
  const objects = useTable((s) => s.objects)
  const dragPreviews = useTable((s) => s.dragPreviews)
  const strokePreviews = useTable((s) => s.strokePreviews)
  const scale = useTable((s) => s.viewport.scale)
  const selfId = useTable((s) => s.self?.clientId)

  return (
    <Layer listening={false}>
      {Object.entries(strokePreviews).map(([id, p]) => (
        <Line key={id} points={p.points} stroke={p.color} strokeWidth={p.strokeWidth} lineCap="round" lineJoin="round" />
      ))}

      {Object.entries(locks).map(([objectId, lock]) => {
        if (lock.clientId === selfId || lock.expiresAt <= now) return null
        const object = objects[objectId]
        if (!object) return null
        const g = dragPreviews[objectId] ?? object
        const member = members[lock.clientId]
        const color = member?.color ?? '#ffffff'
        return (
          <Group key={objectId} x={g.x} y={g.y} rotation={object.type === 'image' ? g.rotation : 0}>
            <Rect width={g.width} height={g.height} stroke={color} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
            <Text text={member?.nickname ?? '?'} y={-16 / scale} fontSize={12 / scale} fill={color} />
          </Group>
        )
      })}

      {Object.entries(cursors).map(([clientId, c]) => {
        const member = members[clientId]
        if (!member) return null
        return (
          <Group key={clientId} x={c.x} y={c.y} scaleX={1 / scale} scaleY={1 / scale}>
            <Circle radius={5} fill={member.color} />
            <Text text={member.nickname} x={8} y={-4} fontSize={12} fill={member.color} />
          </Group>
        )
      })}
    </Layer>
  )
}
