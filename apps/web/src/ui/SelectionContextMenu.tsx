import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'
import type { ImageObject } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { plural } from './confirm'
import { MoveToLayerField, PermissionsField } from './ObjectContextMenu'
import { floatingStyle, useDismiss } from './useDismiss'

/** Menu do botão direito na seleção em área: "Apagar" para todos; mestre também move de camada e muda permissões. */
export function SelectionContextMenu() {
  const menu = useTable((s) => s.selectionMenu)
  const hasSelection = useTable((s) => !!s.selection)
  const actions = useTableActions()

  // Seleção desfeita com o menu aberto: o menu fecha.
  useEffect(() => {
    if (menu && !hasSelection) actions.closeSelectionMenu()
  }, [menu, hasSelection, actions])

  if (!menu || !hasSelection) return null
  return <SelectionMenuBody x={menu.x} y={menu.y} onClose={actions.closeSelectionMenu} />
}

function SelectionMenuBody({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const selection = useTable((s) => s.selection)
  const objects = useTable((s) => s.objects)
  const actions = useTableActions()
  if (!selection) return null
  const count = selection.whole.length + Object.keys(selection.parts).length
  const tokens = selection.whole.map((id) => objects[id]).filter((o): o is ImageObject => o?.type === 'image')

  return (
    <div ref={ref} className="panel popover floating context-menu" role="dialog" aria-label="Menu da seleção" style={floatingStyle(x, y, 260)}>
      <small>{plural(count, 'item selecionado', 'itens selecionados')}</small>
      {isGm && (
        <MoveToLayerField
          onPick={(layerId) => {
            actions.selectionToLayer(layerId)
            onClose()
          }}
        />
      )}
      {isGm && tokens.length > 0 && (
        <PermissionsField
          objectId="selection"
          legend="Controle e permissões"
          control={tokens[0].control}
          onChange={(control) => actions.selectionControl(control)}
        />
      )}
      <button
        className="danger"
        onClick={() => {
          actions.deleteSelection()
          onClose()
        }}
      >
        <Trash2 size={16} aria-hidden /> Apagar
      </button>
    </div>
  )
}
