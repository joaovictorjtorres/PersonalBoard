import { useRef, useState } from 'react'
import { createTable } from '../lib/api'
import { rememberGmSecret } from '../lib/identity'

export function HomePage() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ tableId: string; gmSecret: string } | null>(null)

  const origin = window.location.origin
  const playerLink = created ? `${origin}/t/${created.tableId}` : ''
  const gmLink = created ? `${playerLink}#gm=${created.gmSecret}` : ''

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await createTable(name.trim() || 'Nova mesa')
      rememberGmSecret(result.tableId, result.gmSecret)
      setCreated(result)
    } catch {
      setError('Não foi possível criar a mesa. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="home">
      <h1>Mesa Virtual</h1>
      {!created ? (
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
          <label>
            Nome da mesa
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Campanha de sexta" style={{ width: '100%' }} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar mesa'}</button>
          {error && <p role="alert">{error}</p>}
        </form>
      ) : (
        <>
          <p>Mesa criada! Guarde o link de mestre, ele não pode ser recuperado.</p>
          <LinkRow label="Link dos jogadores" value={playerLink} />
          <LinkRow label="Link do mestre (secreto)" value={gmLink} />
          <button onClick={() => window.location.assign(gmLink)}>Abrir como mestre</button>
        </>
      )}
    </main>
  )
}

function LinkRow({ label, value }: { label: string; value: string }) {
  const [feedback, setFeedback] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  return (
    <label>
      {label}
      <div className="link-row">
        <input ref={inputRef} readOnly value={value} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          onClick={async () => {
            try {
              if (!navigator.clipboard?.writeText) throw new Error('no_clipboard')
              await navigator.clipboard.writeText(value)
              setFeedback('Copiado')
            } catch {
              inputRef.current?.select()
              setFeedback('Selecionado. Copie com Ctrl+C')
            }
          }}
        >
          {feedback ?? 'Copiar'}
        </button>
      </div>
    </label>
  )
}
