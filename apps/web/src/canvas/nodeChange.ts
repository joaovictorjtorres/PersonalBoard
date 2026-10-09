import type Konva from 'konva'
import { snapPatch, type ObjectPatch, type TableObject } from '@mesa/shared'
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

/** Devolve o nó do Konva à geometria do objeto. */
function revertNode(node: Konva.Node, object: TableObject): void {
  node.position({ x: object.x, y: object.y })
  node.scale({ x: 1, y: 1 })
  node.rotation(object.rotation)
  if (object.type === 'image' || (object.type === 'shape' && object.kind !== 'line')) {
    node.size({ width: object.width, height: object.height })
  }
}

/** Esc no meio do arrasto: o objeto volta para onde estava (e para a sua camada) e nada é enviado. */
export function cancelNodeDrag(store: TableStore, id: string, node: Konva.Node): void {
  const s = store.getState()
  const object = s.objects[id]
  if (object) revertNode(node, object)
  s.actions.release(id)
}

/**
 * Soltar ou terminar de redimensionar. Soltar um arrasto também leva o objeto ao topo da própria camada
 * (na mesma ação da posição: um passo de desfazer); redimensionar não muda a ordem.
 */
export function commitNodeChange(store: TableStore, id: string, node: Konva.Node, kind: 'drag' | 'transform'): void {
  const s = store.getState()
  const object = s.objects[id]
  if (!object) return

  const revert = () => revertNode(node, object)

  if (s.deniedGrabs[id]) {
    revert()
    s.actions.clearDenied(id)
    return
  }

  let patch: ObjectPatch
  if (kind === 'drag') {
    patch = { x: node.x(), y: node.y(), zIndex: s.actions.nextZ(object.layerId) }
  } else {
    const g = geometryFromNode(node)
    // Konva redimensiona via scale; normalizamos para width/height com scale 1.
    node.scale({ x: 1, y: 1 })
    node.size({ width: g.width, height: g.height })
    patch = g
  }

  // Encaixe: a mesma conta do servidor, para a imagem já cair no lugar certo.
  const grid = s.settings.grid
  if (object.type === 'image' && grid.snap) {
    patch = snapPatch(patch, grid.size)
    node.position({ x: patch.x ?? node.x(), y: patch.y ?? node.y() })
    if (kind === 'transform') node.size({ width: patch.width ?? node.width(), height: patch.height ?? node.height() })
  }

  if (!s.actions.submit({ kind: 'update', id, patch })) revert()
  s.actions.release(id)
}
