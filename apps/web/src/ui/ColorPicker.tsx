import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { clamp01, hexToHsv, hsvToHex, normalizeHex, type Hsv } from './color'

/**
 * Seletor de cor dentro da própria página (o <input type="color"> nativo não abre em alguns
 * navegadores, como o Brave). Fica dentro do popover/menu: o hover dos menus continua valendo.
 */
export function ColorPicker({
  label,
  value,
  onChange,
  presets,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (hex: string) => void
  presets: readonly string[]
  disabled?: boolean
}) {
  const current = normalizeHex(value) ?? '#000000'
  // HSV local: com saturação ou brilho zero o hex perde a matiz, e o controle não pode pular.
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(current) ?? { h: 0, s: 0, v: 0 })
  const [draft, setDraft] = useState(current)
  const [expanded, setExpanded] = useState(false)
  const square = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setDraft(current)
    setHsv((prev) => (hsvToHex(prev) === current ? prev : (hexToHsv(current) ?? prev)))
  }, [current])

  const pick = (next: Hsv) => {
    setHsv(next)
    const hex = hsvToHex(next)
    setDraft(hex)
    if (hex !== current) onChange(hex)
  }

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = square.current?.getBoundingClientRect()
    if (!r || r.width === 0 || r.height === 0) return
    pick({ h: hsv.h, s: clamp01((e.clientX - r.left) / r.width), v: clamp01(1 - (e.clientY - r.top) / r.height) })
  }

  const onSquareKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01
    const delta: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, step],
      ArrowDown: [0, -step],
    }
    const d = delta[e.key]
    if (!d) return
    e.preventDefault()
    pick({ h: hsv.h, s: clamp01(hsv.s + d[0]), v: clamp01(hsv.v + d[1]) })
  }

  const commitDraft = () => {
    const hex = normalizeHex(draft)
    if (!hex) {
      setDraft(current) // inválido não é enviado
      return
    }
    setDraft(hex)
    if (hex !== current) onChange(hex)
  }

  return (
    <div className="color-picker" role="group" aria-label={label} aria-disabled={disabled || undefined}>
      <div className="row">
        {presets.map((c) => (
          <button
            key={c}
            type="button"
            className="swatch"
            aria-label={`Cor ${c}`}
            aria-pressed={current === c.toLowerCase()}
            disabled={disabled}
            style={{ background: c }}
            onClick={() => onChange(c.toLowerCase())}
          />
        ))}
      </div>
      <div className="row">
        <button
          type="button"
          className="swatch color-current"
          aria-label={`${label}: mais cores`}
          title="Mais cores"
          aria-expanded={expanded}
          disabled={disabled}
          style={{ background: current }}
          onClick={() => setExpanded((v) => !v)}
        />
        <input
          type="text"
          className="color-hex"
          aria-label={`${label} (hex)`}
          spellCheck={false}
          maxLength={7}
          value={draft}
          disabled={disabled}
          aria-invalid={normalizeHex(draft) === null}
          onChange={(e) => {
            setDraft(e.target.value)
            const hex = normalizeHex(e.target.value)
            if (hex && hex !== current) onChange(hex)
          }}
          onBlur={commitDraft}
          onKeyDown={(e) => {
            if (e.key !== 'Enter') return
            if (!normalizeHex(draft)) e.preventDefault() // num formulário, hex inválido não envia
            commitDraft()
          }}
        />
      </div>
      {expanded && !disabled && (
        <>
          <div
            ref={square}
            className="color-sv"
            role="slider"
            tabIndex={0}
            aria-label={`${label}: saturação e brilho`}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(hsv.s * 100)}
            aria-valuetext={`saturação ${Math.round(hsv.s * 100)}%, brilho ${Math.round(hsv.v * 100)}%`}
            style={{ backgroundColor: `hsl(${hsv.h} 100% 50%)` }}
            onPointerDown={(e) => {
              e.currentTarget.setPointerCapture(e.pointerId)
              fromPointer(e)
            }}
            onPointerMove={(e) => {
              if (e.currentTarget.hasPointerCapture(e.pointerId)) fromPointer(e)
            }}
            onKeyDown={onSquareKey}
          >
            <span className="color-sv-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%` }} />
          </div>
          <input
            type="range"
            className="color-hue"
            aria-label={`${label}: matiz`}
            min={0}
            max={359}
            value={Math.round(hsv.h)}
            onChange={(e) => pick({ ...hsv, h: Number(e.target.value) })}
          />
        </>
      )}
    </div>
  )
}
