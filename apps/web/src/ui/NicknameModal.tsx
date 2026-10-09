import { useState } from 'react'
import type { KnownPlayer } from '@mesa/shared'

export const NICKNAME_TAKEN = 'Esse apelido está em uso na mesa agora'

export function NicknameModal({
  onSubmit,
  knownPlayers = [],
  error = null,
}: {
  onSubmit: (nickname: string) => void
  knownPlayers?: KnownPlayer[]
  error?: string | null
}) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onSubmit(trimmed.slice(0, 32))
        }}
      >
        <h2>Entrar na mesa</h2>
        {knownPlayers.length > 0 && (
          <div className="known-players">
            <p>Já jogou aqui? Clique no seu nome</p>
            <div className="known-list">
              {knownPlayers.map((p, i) => (
                <button key={`${p.nickname}-${i}`} type="button" onClick={() => onSubmit(p.nickname)}>
                  <span className="dot" style={{ background: p.color }} aria-hidden="true" />
                  {p.nickname}
                </button>
              ))}
            </div>
          </div>
        )}
        <label>
          Seu apelido
          <input autoFocus value={value} maxLength={32} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit" disabled={!trimmed}>Entrar</button>
      </form>
    </div>
  )
}
