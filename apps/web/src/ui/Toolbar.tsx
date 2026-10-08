import { useCallback, useRef, useState } from 'react'
import { Eraser, Hand, ImagePlus, MousePointer2, Pencil, Undo2 } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { PenPopover } from './PenPopover'

const ICON = 18

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const actions = useTableActions()
  const fileInput = useRef<HTMLInputElement>(null)
  const [penMenu, setPenMenu] = useState(false)
  const closePenMenu = useCallback(() => setPenMenu(false), [])
  const penLabel = penMode === 'erase' ? 'Borracha (E)' : 'Lápis (P)'

  return (
    <div className="panel toolbar">
      <button aria-label="Selecionar (V)" title="Selecionar (V)" aria-pressed={tool === 'select'} onClick={() => actions.setTool('select')}>
        <MousePointer2 size={ICON} aria-hidden />
      </button>
      <button aria-label="Mão (H)" title="Mão (H)" aria-pressed={tool === 'hand'} onClick={() => actions.setTool('hand')}>
        <Hand size={ICON} aria-hidden />
      </button>
      <div className="pen-anchor">
        <button
          aria-label={penLabel}
          title={`${penLabel} — botão direito: opções`}
          aria-pressed={tool === 'pencil'}
          aria-haspopup="dialog"
          aria-expanded={penMenu}
          onClick={() => actions.setPen(penMode)}
          onContextMenu={(e) => {
            e.preventDefault()
            setPenMenu(true)
          }}
        >
          {penMode === 'erase' ? <Eraser size={ICON} aria-hidden /> : <Pencil size={ICON} aria-hidden />}
        </button>
        {penMenu && <PenPopover onClose={closePenMenu} />}
      </div>
      <button aria-label="Adicionar imagem" title="Adicionar imagem na camada ativa" onClick={() => fileInput.current?.click()}>
        <ImagePlus size={ICON} aria-hidden />
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        data-testid="image-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void actions.addImageFile(file)
          e.target.value = ''
        }}
      />
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>
        <Undo2 size={ICON} aria-hidden />
      </button>
    </div>
  )
}
