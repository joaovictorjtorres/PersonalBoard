import { useRef } from 'react'
import type { Tool } from '../store/state'
import { useTable, useTableActions } from '../store/context'

const TOOLS: Array<{ tool: Tool; label: string; icon: string }> = [
  { tool: 'select', label: 'Selecionar (V)', icon: '↖' },
  { tool: 'hand', label: 'Mão (H)', icon: '✋' },
  { tool: 'pencil', label: 'Lápis (P)', icon: '✏️' },
  { tool: 'eraser', label: 'Borracha (E)', icon: '🧽' },
]

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const color = useTable((s) => s.color)
  const strokeWidth = useTable((s) => s.strokeWidth)
  const actions = useTableActions()
  const fileInput = useRef<HTMLInputElement>(null)

  return (
    <div className="panel toolbar">
      {TOOLS.map((t) => (
        <button key={t.tool} aria-label={t.label} title={t.label} aria-pressed={tool === t.tool} onClick={() => actions.setTool(t.tool)}>
          {t.icon}
        </button>
      ))}
      <button aria-label="Adicionar imagem" title="Adicionar imagem na camada ativa" onClick={() => fileInput.current?.click()}>
        🖼️
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
      <input type="color" aria-label="Cor do traço" title="Cor do traço" value={color} onChange={(e) => actions.setColor(e.target.value)} />
      <input
        type="range" aria-label="Espessura do traço" title="Espessura do traço"
        min={1} max={30} value={strokeWidth}
        onChange={(e) => actions.setStrokeWidth(Number(e.target.value))}
        style={{ width: 44 }}
      />
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>↶</button>
    </div>
  )
}
