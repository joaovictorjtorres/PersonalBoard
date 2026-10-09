import { Fragment, type MouseEvent } from 'react'
import { formatRollFormula, type ChatEntry } from '@mesa/shared'
import { bonusLabel, formatTime, modeLabel, rollParts, thumbSize } from './format'

export interface ChatAuthor {
  nickname: string
  color: string
}

const UNKNOWN: ChatAuthor = { nickname: 'Alguém', color: '#9aa0aa' }

/** Tudo vira nó de texto do React: nada que chega pelo chat é interpretado como HTML. */
export function ChatEntryView({
  entry,
  author,
  onOpenImage,
  onAuthorMenu,
}: {
  entry: ChatEntry
  author: ChatAuthor | null
  onOpenImage: (assetKey: string) => void
  /** Botão direito no nome do autor (conversa privada / editar). Ausente = sem menu. */
  onAuthorMenu?: (e: MouseEvent) => void
}) {
  const { nickname, color } = author ?? UNKNOWN
  const name = onAuthorMenu ? (
    <strong
      className="chat-author has-menu"
      style={{ color }}
      onContextMenu={(e) => {
        e.preventDefault()
        onAuthorMenu(e)
      }}
    >
      {nickname}
    </strong>
  ) : (
    <strong style={{ color }}>{nickname}</strong>
  )
  const time = <time className="chat-time" dateTime={new Date(entry.at).toISOString()}>{formatTime(entry.at)}</time>

  if (entry.kind === 'roll') {
    const { request, result } = entry
    return (
      <li className={entry.secret ? 'chat-entry roll secret' : 'chat-entry roll'}>
        {time} {name} rolou <strong>{formatRollFormula(request)}</strong>{modeLabel(request.mode)}: [
        {rollParts(request, result).map((d, i) => {
          const value = <span className={d.tone ?? undefined}>{d.value}</span>
          return (
            <Fragment key={i}>
              {i > 0 && ', '}
              {d.kept ? value : <s>{value}</s>}
            </Fragment>
          )
        })}
        ]{bonusLabel(request.bonus)} = <strong>{result.total}</strong>
        {entry.secret && <span className="secret-label"> (só mestre)</span>}
      </li>
    )
  }

  if (entry.kind === 'image') {
    const { assetKey } = entry
    return (
      <li className="chat-entry">
        <div>
          {time} {name}
        </div>
        <button type="button" className="chat-thumb" aria-label={`Abrir imagem enviada por ${nickname}`} onClick={() => onOpenImage(assetKey)}>
          <img src={`/files/${assetKey}`} alt={`Imagem enviada por ${nickname}`} {...thumbSize(entry.width, entry.height)} />
        </button>
      </li>
    )
  }

  return (
    <li className="chat-entry">
      <div>
        {time} {name}
      </div>
      <p className="chat-text">{entry.text}</p>
    </li>
  )
}
