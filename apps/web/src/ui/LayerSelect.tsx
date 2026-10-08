import { useTable, useTableActions } from '../store/context'

export function LayerSelect() {
  const layers = useTable((s) => s.layers)
  const active = useTable((s) => s.activeLayerId)
  const actions = useTableActions()
  return (
    <label>
      Camada ativa{' '}
      <select value={active} onChange={(e) => actions.setActiveLayer(e.target.value)}>
        {layers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {l.visibility === 'gm' ? ' (só mestre)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
