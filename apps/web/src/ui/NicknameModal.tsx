import { useState } from 'react'

export function NicknameModal({ onSubmit }: { onSubmit: (nickname: string) => void }) {
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
        <label>
          Seu apelido
          <input autoFocus value={value} maxLength={32} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />
        </label>
        <button type="submit" disabled={!trimmed}>Entrar</button>
      </form>
    </div>
  )
}
