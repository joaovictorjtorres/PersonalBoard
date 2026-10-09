import { Circle, Group, Layer, Line, Rect, Text } from 'react-konva'
import { PING_DURATION_MS, type Member } from '@mesa/shared'
import { useTable } from '../store/context'
import type { Ruler } from '../store/state'
import { useFrameClock, useNow } from './hooks'
import { pingRing } from './ping'
import { rulerLabel, rulerSegmentLabels } from './ruler'

export function Overlay() {
  const now = useNow(1000)
  const cursors = useTable((s) => s.cursors)
  const members = useTable((s) => s.members)
  const locks = useTable((s) => s.locks)
  const objects = useTable((s) => s.objects)
  const dragPreviews = useTable((s) => s.dragPreviews)
  const strokePreviews = useTable((s) => s.strokePreviews)
  const scale = useTable((s) => s.viewport.scale)
  const self = useTable((s) => s.self)
  const rulers = useTable((s) => s.rulers)
  const ownRuler = useTable((s) => s.ownRuler)
  const gridSize = useTable((s) => s.settings.grid.size)
  const selfId = self?.clientId

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
          <Group key={objectId} x={g.x} y={g.y} rotation={object.type === 'stroke' ? 0 : g.rotation}>
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

      {/* Réguas dos outros (a de outra aba minha não aparece) e a minha, desenhada do estado local. */}
      {Object.entries(rulers).map(([clientId, ruler]) =>
        clientId === selfId ? null : (
          <RulerMark key={clientId} ruler={ruler} member={members[clientId]} size={gridSize} scale={scale} />
        ),
      )}
      {ownRuler && self && <RulerMark ruler={ownRuler} member={self} size={gridSize} scale={scale} />}

      <Pings members={members} scale={scale} />
    </Layer>
  )
}

function RulerMark({
  ruler,
  member,
  size,
  scale,
}: {
  ruler: Ruler
  member: Pick<Member, 'nickname' | 'color'> | undefined
  size: number
  scale: number
}) {
  const color = member?.color ?? '#ffffff'
  const k = 1 / scale
  const pts = ruler.points
  const end = pts[pts.length - 1]
  return (
    <Group>
      <Line
        name="ruler-line"
        points={pts.flatMap((p) => [p.x, p.y])}
        stroke={color}
        strokeWidth={2 * k}
        dash={[8 * k, 6 * k]}
        lineCap="round"
        lineJoin="round"
      />
      {/* início e dobras */}
      {pts.slice(0, -1).map((p, i) => (
        <Circle key={i} x={p.x} y={p.y} radius={3 * k} fill={color} />
      ))}
      {rulerSegmentLabels(ruler, size).map((s, i) => (
        <Text
          key={i}
          name="ruler-segment-label"
          text={s.text}
          x={s.x + 6 * k}
          y={s.y - 16 * k}
          fontSize={11 * k}
          fill={color}
          opacity={0.85}
          stroke="#111111"
          strokeWidth={3 * k}
          fillAfterStrokeEnabled
        />
      ))}
      <Text
        name="ruler-label"
        text={rulerLabel(member?.nickname ?? '?', ruler, size)}
        x={end.x + 12 * k}
        y={end.y + 12 * k}
        fontSize={13 * k}
        fill={color}
        stroke="#111111"
        strokeWidth={3 * k}
        fillAfterStrokeEnabled
      />
    </Group>
  )
}

function Pings({ members, scale }: { members: Record<string, Member>; scale: number }) {
  const pings = useTable((s) => s.pings)
  const last = pings[pings.length - 1]
  const now = useFrameClock(!!last && Date.now() - last.at < PING_DURATION_MS)
  return (
    <>
      {pings.map((p) => {
        // O estado só poda pings na chegada de outro; a idade é filtrada aqui (pingRing → null).
        const ring = pingRing(now - p.at)
        if (!ring) return null
        const member = members[p.clientId]
        const color = member?.color ?? '#ffffff'
        return (
          <Group key={p.id} x={p.x} y={p.y} scaleX={1 / scale} scaleY={1 / scale} opacity={ring.opacity}>
            <Circle radius={ring.radius} stroke={color} strokeWidth={3} />
            <Circle radius={4} fill={color} />
            <Text text={member?.nickname ?? '?'} x={ring.radius + 6} y={-6} fontSize={12} fill={color} />
          </Group>
        )
      })}
    </>
  )
}
