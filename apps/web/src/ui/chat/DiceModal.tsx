import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { DICE_MAX_BONUS, DICE_MAX_COUNT, DIE_SIDES, type RollMode } from '@mesa/shared'
import { loadDiceConfig, normalizeDiceConfig, saveDiceConfig, toRollRequest, type DiceConfig } from '../../lib/dice-config'
import { useTable, useTableActions } from '../../store/context'
import { floatingStyle, useDismiss } from '../useDismiss'

const MODES: Array<{ mode: RollMode; label: string }> = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'advantage', label: 'Vantagem' },
  { mode: 'disadvantage', label: 'Desvantagem' },
]

export function DiceModal({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const onTable = useTable((s) => s.chatActive === 'table')
  const actions = useTableActions()
  // Lembra a última configuração usada (salva ao rolar).
  const [config, setConfig] = useState<DiceConfig>(() => loadDiceConfig())
  const update = (patch: Partial<DiceConfig>) => setConfig((c) => normalizeDiceConfig({ ...c, ...patch }))

  const roll = () => {
    saveDiceConfig(config)
    actions.sendRoll(toRollRequest(config), onTable && config.secret)
    onClose()
  }

  return (
    <div
      ref={ref}
      className="panel popover floating dice-modal"
      role="dialog"
      aria-label="Rolar dados"
      style={floatingStyle(x - 300, y - 360, 280)}
    >
      <div className="field">
        <span>Dado</span>
        <div className="row">
          {DIE_SIDES.map((die) => (
            <button key={die} aria-pressed={config.die === die} onClick={() => update({ die })}>
              d{die}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Quantidade</span>
        <div className="row">
          <button aria-label="Menos um dado" disabled={config.count <= 1} onClick={() => update({ count: config.count - 1 })}>
            <Minus size={14} aria-hidden />
          </button>
          <input
            key={`count-${config.count}`}
            type="number"
            aria-label="Quantidade"
            min={1}
            max={DICE_MAX_COUNT}
            defaultValue={config.count}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onBlur={(e) => update({ count: e.currentTarget.valueAsNumber })}
          />
          <button
            aria-label="Mais um dado"
            disabled={config.count >= DICE_MAX_COUNT}
            onClick={() => update({ count: config.count + 1 })}
          >
            <Plus size={14} aria-hidden />
          </button>
        </div>
      </div>

      <label className="field">
        Bônus
        <input
          key={`bonus-${config.bonus}`}
          type="number"
          min={-DICE_MAX_BONUS}
          max={DICE_MAX_BONUS}
          step={1}
          defaultValue={config.bonus}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => update({ bonus: e.currentTarget.valueAsNumber })}
        />
      </label>

      <div className="field" role="radiogroup" aria-label="Modo">
        {MODES.map((m) => (
          <label key={m.mode}>
            <input
              type="radio"
              name="dice-mode"
              checked={config.mode === m.mode}
              disabled={m.mode !== 'normal' && config.count !== 1}
              onChange={() => update({ mode: m.mode })}
            />
            {m.label}
          </label>
        ))}
      </div>

      {onTable && (
        <label>
          <input type="checkbox" checked={config.secret} onChange={(e) => update({ secret: e.target.checked })} />
          Só o mestre vê
        </label>
      )}

      <button onClick={roll}>Rolar</button>
    </div>
  )
}
