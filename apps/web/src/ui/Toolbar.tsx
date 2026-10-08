import { useCallback, useRef, useState } from 'react'
import { Eraser, Grid3x3, Hand, ImagePlus, MousePointer2, Pencil, Ruler, Shapes, Undo2 } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { GridPopover } from './GridPopover'
import { PenPopover } from './PenPopover'
import { ShapePopover } from './ShapePopover'

const ICON = 18

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const fileInput = useRef<HTMLInputElement>(null)
  const [penMenu, setPenMenu] = useState(false)
  const [shapeMenu, setShapeMenu] = useState(false)
  const [gridMenu, setGridMenu] = useState(false)
  const closePenMenu = useCallback(() => setPenMenu(false), [])
  const closeShapeMenu = useCallback(() => setShapeMenu(false), [])
  const closeGridMenu = useCallback(() => setGridMenu(false), [])
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
      <div className="pen-anchor">
        <button
          aria-label="Formas (S)"
          title="Formas (S) — botão direito: tipo e preenchimento"
          aria-pressed={tool === 'shape'}
          aria-haspopup="dialog"
          aria-expanded={shapeMenu}
          onClick={() => actions.setTool('shape')}
          onContextMenu={(e) => {
            e.preventDefault()
            setShapeMenu(true)
          }}
        >
          <Shapes size={ICON} aria-hidden />
        </button>
        {shapeMenu && <ShapePopover onClose={closeShapeMenu} />}
      </div>
      <button
        aria-label="Régua (R)"
        title="Régua (R) — clique fixa o início; novo clique ou Esc remove"
        aria-pressed={tool === 'ruler'}
        onClick={() => actions.setTool('ruler')}
      >
        <Ruler size={ICON} aria-hidden />
      </button>
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
      {isGm && (
        <div className="pen-anchor">
          <button
            aria-label="Grade"
            title="Grade (só o mestre)"
            aria-haspopup="dialog"
            aria-expanded={gridMenu}
            onClick={() => setGridMenu(true)}
          >
            <Grid3x3 size={ICON} aria-hidden />
          </button>
          {gridMenu && <GridPopover onClose={closeGridMenu} />}
        </div>
      )}
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>
        <Undo2 size={ICON} aria-hidden />
      </button>
    </div>
  )
}
