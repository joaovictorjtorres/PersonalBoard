import type Konva from 'konva'
import type { ObjectPatch } from '@mesa/shared'
import type { Geometry } from '../store/state'
import type { TableStore } from '../store/tableStore'

export function geometryFromNode(node: Konva.Node): Geometry {
  return {
    x: node.x(),
    y: node.y(),
    width: Math.max(1, node.width() * node.scaleX()),
    height: Math.max(1, node.height() * node.scaleY()),
    rotation: node.rotation(),
  }
}

export function commitNodeChange(store: TableStore, id: string, node: Konva.Node, kind: 'drag' | 'transform'): void {
  const s = store.getState()
  const object = s.objects[id]
  if (!object) return

  const revert = () => {
    node.position({ x: object.x, y: object.y })
    node.scale({ x: 1, y: 1 })
    node.rotation(object.rotation)
    if (object.type === 'image') node.size({ width: object.width, height: object.height })
  }

  if (s.deniedGrabs[id]) {
    revert()
    s.actions.clearDenied(id)
    return
  }

  let patch: ObjectPatch
  if (kind === 'drag') {
    patch = { x: node.x(), y: node.y() }
  } else {
    const g = geometryFromNode(node)
    // Konva redimensiona via scale; normalizamos para width/height com scale 1.
    node.scale({ x: 1, y: 1 })
    node.size({ width: g.width, height: g.height })
    patch = g
  }
  if (!s.actions.submit({ kind: 'update', id, patch })) revert()
  s.actions.release(id)
}
