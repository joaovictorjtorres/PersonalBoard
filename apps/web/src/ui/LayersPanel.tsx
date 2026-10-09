import { useCallback, useState } from 'react'
import { Eye, EyeOff, Lock, LockOpen, Plus } from 'lucide-react'
import { GM_LAYER_ID } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { LayerMenu } from './LayerMenu'

export function LayersPanel() {
  const layers = useTable((s) => s.layers)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const [menu, setMenu] = useState<{ layerId: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // state.layers está em ordem crescente; o painel mostra a mais alta primeiro (Mestre no topo).
  const rows = [...layers].reverse()

  return (
    <section className="panel layers" aria-label="Camadas">
      <header>
        <strong>Camadas</strong>
        {isGm && (
          <button className="icon-button" aria-label="Nova camada" title="Nova camada" onClick={() => actions.createLayer()}>
            <Plus size={16} aria-hidden />
          </button>
        )}
      </header>
      <ul>
        {rows.map((layer) => {
          const active = layer.id === activeLayerId
          const hidden = layer.visibility === 'gm'
          const lockedForMe = layer.locked && !isGm
          return (
            <li key={layer.id} className={active ? 'layer-item active' : 'layer-item'}>
              <button
                className="layer-row"
                aria-label={layer.name}
                aria-pressed={active}
                aria-current={active ? 'true' : undefined}
                aria-disabled={lockedForMe || undefined}
                title={active ? 'Sua camada ativa' : lockedForMe ? 'Travada pelo mestre' : 'Botão direito: mais ações'}
                onClick={() => actions.setActiveLayer(layer.id)}
                onContextMenu={(e) => {
                  e.preventDefault()
                  setMenu({ layerId: layer.id, x: e.clientX, y: e.clientY })
                }}
              >
                <span className="layer-name">{layer.name}</span>
                {!isGm && layer.locked && (
                  <span className="layer-flags" title="Travada para jogadores">
                    <Lock size={14} aria-hidden />
                  </span>
                )}
              </button>
              {isGm && (
                <>
                  <button
                    className="icon-button layer-toggle"
                    aria-label={hidden ? `Mostrar ${layer.name} para jogadores` : `Ocultar ${layer.name} para jogadores`}
                    title={layer.id === GM_LAYER_ID ? 'A camada do Mestre é sempre oculta' : hidden ? 'Oculta para jogadores' : 'Visível para jogadores'}
                    aria-pressed={hidden}
                    disabled={layer.id === GM_LAYER_ID}
                    onClick={() =>
                      actions.submit({ kind: 'layerUpdate', id: layer.id, patch: { visibility: hidden ? 'all' : 'gm' } })
                    }
                  >
                    {hidden ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  </button>
                  <button
                    className="icon-button layer-toggle"
                    aria-label={layer.locked ? `Destravar ${layer.name} para jogadores` : `Travar ${layer.name} para jogadores`}
                    title={layer.locked ? 'Travada para jogadores' : 'Destravada para jogadores'}
                    aria-pressed={layer.locked}
                    onClick={() => actions.submit({ kind: 'layerUpdate', id: layer.id, patch: { locked: !layer.locked } })}
                  >
                    {layer.locked ? <Lock size={14} aria-hidden /> : <LockOpen size={14} aria-hidden />}
                  </button>
                </>
              )}
            </li>
          )
        })}
      </ul>
      {menu && <LayerMenu layerId={menu.layerId} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </section>
  )
}
