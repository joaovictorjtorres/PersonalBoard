import { useEffect, useRef, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, Brush, Eraser, Eye, EyeOff, Layers, Lock, LockOpen, Trash2 } from 'lucide-react'
import { GM_LAYER_ID, LAYER_NAME_MAX, sortLayers, type LayerPatch } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { askConfirm, plural } from './confirm'
import { confirmClear, planLayerDrawings, planLayerEverything, planMine, type ClearPlan } from './clearPlans'
import { OverlayPortal } from './OverlayPortal'
import { floatingStyle, useDismiss } from './useDismiss'

interface Props {
  layerId: string
  x: number
  y: number
  onClose: () => void
}

export function LayerMenu({ layerId, x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const layers = useTable((s) => s.layers)
  const objects = useTable((s) => s.objects)
  const actions = useTableActions()
  const self = useTable((s) => s.self)
  const layer = layers.find((l) => l.id === layerId)

  // Camada removida (por outra aba do mestre, por exemplo): o menu fecha.
  useEffect(() => {
    if (!layer) onClose()
  }, [layer, onClose])
  if (!layer) return null

  const isGmLayer = layer.id === GM_LAYER_ID
  const common = sortLayers(layers).filter((l) => l.id !== GM_LAYER_ID)
  const index = common.findIndex((l) => l.id === layerId)
  const count = Object.values(objects).filter((o) => o.layerId === layerId).length
  const update = (patch: LayerPatch) => actions.submit({ kind: 'layerUpdate', id: layerId, patch })
  const isGm = self?.role === 'gm'
  const view = self ? { objects, layers, self } : null
  // O menu fecha antes do aviso: o clique no aviso não pode contar como "fora" de um menu ainda aberto.
  const clear = (plan: ClearPlan) => {
    onClose()
    void confirmClear(plan, actions.submit)
  }
  const clearButton = (plan: ClearPlan | null, label: string, icon: ReactNode) => (
    <button
      className="danger"
      disabled={!plan || plan.count === 0}
      title={plan && plan.count === 0 ? 'Nada para apagar' : undefined}
      onClick={() => plan && clear(plan)}
    >
      {icon} {label}
    </button>
  )
  const clearSection = (
    <>
      {clearButton(view && planMine(view, layerId), 'Apagar meus desenhos nesta camada', <Eraser size={16} aria-hidden />)}
      {clearButton(view && planMine(view, null), 'Apagar meus desenhos em todas as camadas', <Layers size={16} aria-hidden />)}
    </>
  )

  if (!isGm) {
    return (
      <OverlayPortal>
        <div ref={ref} className="panel popover floating" role="dialog" aria-label="Ações da camada" style={floatingStyle(x, y, 280)}>
          <strong className="menu-title">{layer.name}</strong>
          {clearSection}
        </div>
      </OverlayPortal>
    )
  }

  return (
    <OverlayPortal>
    <div
      ref={ref}
      className="panel popover floating"
      role="dialog"
      aria-label="Propriedades da camada"
      style={floatingStyle(x, y, 280)}
    >
      <label className="field">
        Nome
        <input
          key={layer.id}
          defaultValue={layer.name}
          maxLength={LAYER_NAME_MAX}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim().slice(0, LAYER_NAME_MAX)
            if (!name) {
              e.currentTarget.value = layer.name // vazio não é enviado
              return
            }
            if (name !== layer.name) update({ name })
          }}
        />
      </label>

      {!isGmLayer && (
        <label>
          <input
            type="checkbox"
            checked={layer.visibility === 'gm'}
            onChange={(e) => update({ visibility: e.target.checked ? 'gm' : 'all' })}
          />
          {layer.visibility === 'gm' ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          Oculta para jogadores
        </label>
      )}

      <label>
        <input type="checkbox" checked={layer.locked} onChange={(e) => update({ locked: e.target.checked })} />
        {layer.locked ? <Lock size={14} aria-hidden /> : <LockOpen size={14} aria-hidden />}
        Travada para jogadores
      </label>

      {!isGmLayer && (
        <>
          <button
            disabled={index >= common.length - 1}
            onClick={() => actions.submit({ kind: 'layerMove', id: layerId, direction: 'up' })}
          >
            <ArrowUp size={16} aria-hidden /> Subir camada
          </button>
          <button disabled={index <= 0} onClick={() => actions.submit({ kind: 'layerMove', id: layerId, direction: 'down' })}>
            <ArrowDown size={16} aria-hidden /> Descer camada
          </button>
          <button
            className="danger"
            disabled={common.length <= 1}
            onClick={async () => {
              onClose()
              const ok = await askConfirm({
                title: 'Remover camada',
                message: `Remover a camada ${layer.name} e ${plural(count, 'objeto', 'objetos')} dela? Isso não pode ser desfeito.`,
                confirmLabel: 'Remover',
                danger: true,
              })
              if (ok) actions.submit({ kind: 'layerDelete', id: layerId })
            }}
          >
            <Trash2 size={16} aria-hidden /> Remover camada
          </button>
        </>
      )}

      <hr className="menu-sep" />
      {clearSection}
      {clearButton(view && planLayerDrawings(view, layerId), 'Limpar desenhos (de todos)', <Brush size={16} aria-hidden />)}
      {clearButton(view && planLayerEverything(view, layerId), 'Limpar camada (tudo, mantém a camada)', <Trash2 size={16} aria-hidden />)}
    </div>
    </OverlayPortal>
  )
}
