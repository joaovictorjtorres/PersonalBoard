import type { TableObject } from '@mesa/shared'
import { NO_SELECTION, type TableState } from '../store/state'
import { dropFromSelection } from './model'

/** Mesmo lugar, tamanho, rotação, camada e desenho: o objeto continua valendo para a seleção. */
function sameShape(a: TableObject, b: TableObject): boolean {
  if (a === b) return true
  if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height || a.rotation !== b.rotation || a.layerId !== b.layerId) {
    return false
  }
  return a.type !== 'stroke' || b.type !== 'stroke' || JSON.stringify(a.segments) === JSON.stringify(b.segments)
}

/** Item selecionado que outra pessoa apagou, moveu ou mudou de camada sai da seleção na hora. */
export function reconcileSelection<S extends TableState>(prev: S, next: S): S {
  const sel = next.selection
  if (!sel || next.objects === prev.objects) return next
  const gone = new Set<string>()
  for (const id of [...sel.whole, ...Object.keys(sel.parts)]) {
    const before = prev.objects[id]
    const after = next.objects[id]
    if (!before || !after || !sameShape(before, after)) gone.add(id)
  }
  if (gone.size === 0) return next
  const selection = dropFromSelection(sel, gone, next.objects)
  return selection ? { ...next, selection } : { ...next, ...NO_SELECTION }
}
