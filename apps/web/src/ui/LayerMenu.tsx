import { useEffect, useRef } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react'
import { GM_LAYER_ID, LAYER_NAME_MAX, sortLayers, type LayerPatch } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
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

  return (
    <div
      ref={ref}
      className="panel popover floating"
      role="dialog"
      aria-label="Propriedades da camada"
      style={floatingStyle(x, y, 240)}
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
            onClick={() => {
              if (!window.confirm(`Remover a camada ${layer.name} e ${count} objetos?`)) return
              actions.submit({ kind: 'layerDelete', id: layerId })
              onClose()
            }}
          >
            <Trash2 size={16} aria-hidden /> Remover camada
          </button>
        </>
      )}
    </div>
  )
}
