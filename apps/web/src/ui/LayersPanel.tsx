import { useCallback, useState } from 'react'
import { EyeOff, Lock, Plus } from 'lucide-react'
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
        {rows.map((layer) => (
          <li key={layer.id}>
            <button
              className="layer-row"
              aria-label={layer.name}
              aria-pressed={layer.id === activeLayerId}
              onClick={() => actions.setActiveLayer(layer.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (isGm) setMenu({ layerId: layer.id, x: e.clientX, y: e.clientY })
              }}
            >
              <span className="layer-name">{layer.name}</span>
              <span className="layer-flags">
                {layer.visibility === 'gm' && (
                  <span title="Oculta para jogadores">
                    <EyeOff size={14} aria-hidden />
                  </span>
                )}
                {layer.locked && (
                  <span title="Travada para jogadores">
                    <Lock size={14} aria-hidden />
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {menu && <LayerMenu layerId={menu.layerId} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </section>
  )
}
