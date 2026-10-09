import { useMemo, useRef, type MouseEvent } from 'react'
import { Eraser, Grid3x3, Hand, ImagePlus, MousePointer2, Pencil, Ruler, Shapes, Undo2 } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { GridPopover } from './GridPopover'
import { PenPopover } from './PenPopover'
import { ShapePopover } from './ShapePopover'
import { useHoverMenus, type HoverMenuBinding } from './useHoverMenu'

const ICON = 18

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const fileInput = useRef<HTMLInputElement>(null)
  // Menus abrem ao passar o mouse (e pelo botão direito / toque longo); um aberto por vez.
  const menus = useHoverMenus<'pen' | 'shape' | 'grid'>()
  const penAnchor = useRef<HTMLDivElement>(null)
  const shapeAnchor = useRef<HTMLDivElement>(null)
  const gridAnchor = useRef<HTMLDivElement>(null)
  const { surface } = menus
  const penHover = useMemo<HoverMenuBinding>(() => ({ anchor: penAnchor, ...surface }), [surface])
  const shapeHover = useMemo<HoverMenuBinding>(() => ({ anchor: shapeAnchor, ...surface }), [surface])
  const gridHover = useMemo<HoverMenuBinding>(() => ({ anchor: gridAnchor, ...surface }), [surface])
  const openOnContextMenu = (id: 'pen' | 'shape' | 'grid') => (e: MouseEvent) => {
    e.preventDefault()
    menus.show(id)
  }
  const penLabel = penMode === 'erase' ? 'Borracha (E)' : 'Lápis (P)'

  return (
    <div className="panel toolbar">
      <button aria-label="Selecionar (V)" title="Selecionar (V)" aria-pressed={tool === 'select'} onClick={() => actions.setTool('select')}>
        <MousePointer2 size={ICON} aria-hidden />
      </button>
      <button aria-label="Mão (H)" title="Mão (H)" aria-pressed={tool === 'hand'} onClick={() => actions.setTool('hand')}>
        <Hand size={ICON} aria-hidden />
      </button>
      <div className="pen-anchor" ref={penAnchor}>
        <button
          aria-label={penLabel}
          title={`${penLabel} (passe o mouse: opções)`}
          aria-pressed={tool === 'pencil'}
          aria-haspopup="dialog"
          aria-expanded={menus.open === 'pen'}
          onClick={() => {
            menus.cancelOpen()
            actions.setPen(penMode)
          }}
          onContextMenu={openOnContextMenu('pen')}
          {...menus.trigger('pen')}
        >
          {penMode === 'erase' ? <Eraser size={ICON} aria-hidden /> : <Pencil size={ICON} aria-hidden />}
        </button>
        {menus.open === 'pen' && <PenPopover onClose={menus.close} hover={penHover} />}
      </div>
      <div className="pen-anchor" ref={shapeAnchor}>
        <button
          aria-label="Formas (S)"
          title="Formas (S): passe o mouse para tipo e preenchimento"
          aria-pressed={tool === 'shape'}
          aria-haspopup="dialog"
          aria-expanded={menus.open === 'shape'}
          onClick={() => {
            menus.cancelOpen()
            actions.setTool('shape')
          }}
          onContextMenu={openOnContextMenu('shape')}
          {...menus.trigger('shape')}
        >
          <Shapes size={ICON} aria-hidden />
        </button>
        {menus.open === 'shape' && <ShapePopover onClose={menus.close} hover={shapeHover} />}
      </div>
      <button
        aria-label="Régua (R)"
        title="Régua (R): clique fixa o início; botão direito dobra; novo clique ou Esc remove"
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
        <div className="pen-anchor" ref={gridAnchor}>
          <button
            aria-label="Grade"
            title="Grade (só o mestre)"
            aria-haspopup="dialog"
            aria-expanded={menus.open === 'grid'}
            onClick={() => menus.show('grid')}
            onContextMenu={openOnContextMenu('grid')}
            {...menus.trigger('grid')}
          >
            <Grid3x3 size={ICON} aria-hidden />
          </button>
          {menus.open === 'grid' && <GridPopover onClose={menus.close} hover={gridHover} />}
        </div>
      )}
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>
        <Undo2 size={ICON} aria-hidden />
      </button>
    </div>
  )
}
