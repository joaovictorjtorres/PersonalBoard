import { useCallback, useEffect, useRef, useState } from 'react'
import { Dices, ImagePlus, MessageSquare, X } from 'lucide-react'
import { CHAT_TEXT_MAX, type ChatEntry, type RollRequest } from '@mesa/shared'
import type { ChatTab } from '../../store/chat'
import { useTable, useTableActions } from '../../store/context'
import { ChatEntryView } from './ChatEntryView'
import { DiceModal } from './DiceModal'
import { ImageLightbox } from './ImageLightbox'
import { pickImageFile } from './format'

const EMPTY: ChatEntry[] = []
const D20: RollRequest = { die: 20, count: 1, bonus: 0, mode: 'normal' }

export function ChatPanel() {
  const open = useTable((s) => s.chatOpen)
  const active = useTable((s) => s.chatActive)
  const tabs = useTable((s) => s.chatTabs)
  const unread = useTable((s) => s.chatUnread)
  const members = useTable((s) => s.members)
  const entries = useTable((s) => (s.chatActive === 'table' ? s.chatTable : (s.chatDms[s.chatActive] ?? EMPTY)))
  const actions = useTableActions()
  const [text, setText] = useState('')
  const [dice, setDice] = useState<{ x: number; y: number } | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const closeDice = useCallback(() => setDice(null), [])
  const closeLightbox = useCallback(() => setLightbox(null), [])
  const totalUnread = Object.values(unread).reduce((sum, n) => sum + n, 0)
  const tabName = (tab: ChatTab) => (tab === 'table' ? 'Mesa' : (members[tab]?.nickname ?? 'Conversa'))

  // Sempre mostra o fim da conversa.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [entries, active, open])

  const sendImage = (file: Blob | null) => {
    if (file) void actions.sendChatImage(file)
  }

  return (
    <section
      className={open ? 'panel chat open' : 'panel chat'}
      aria-label="Chat"
      onPaste={(e) => {
        const file = pickImageFile(e.clipboardData.files)
        if (!file) return // texto colado segue para o campo normalmente
        e.preventDefault()
        sendImage(file)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        sendImage(pickImageFile(e.dataTransfer.files))
      }}
    >
      <header className="chat-header">
        <button
          className="icon-button"
          aria-label={open ? 'Recolher chat' : 'Abrir chat'}
          aria-expanded={open}
          title="Chat"
          onClick={() => actions.setChatOpen(!open)}
        >
          <MessageSquare size={16} aria-hidden /> Chat
          {!open && totalUnread > 0 && <span className="badge">{totalUnread}</span>}
        </button>
      </header>

      {open && (
        <>
          <div className="chat-tabs" role="tablist" aria-label="Conversas">
            {['table', ...tabs].map((tab) => {
              const count = unread[tab] ?? 0
              return (
                <div key={tab} className="chat-tab">
                  <button role="tab" aria-selected={active === tab} onClick={() => actions.selectChatTab(tab)}>
                    {tabName(tab)}
                    {count > 0 && (
                      <span className="badge" aria-label={`${count} não lidas`}>
                        {count}
                      </span>
                    )}
                  </button>
                  {tab !== 'table' && (
                    <button
                      className="icon-button"
                      aria-label={`Fechar conversa com ${tabName(tab)}`}
                      title="Fechar (apaga a conversa)"
                      onClick={() => actions.closeDm(tab)}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <ol ref={listRef} className="chat-list" aria-label={`Mensagens — ${tabName(active)}`}>
            {entries.map((entry) => (
              <ChatEntryView key={entry.id} entry={entry} author={members[entry.authorId] ?? null} onOpenImage={setLightbox} />
            ))}
          </ol>

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault()
              if (actions.sendChatText(text)) setText('')
            }}
          >
            <input
              aria-label="Mensagem"
              value={text}
              maxLength={CHAT_TEXT_MAX}
              placeholder="Mensagem ou /r 1d20+3"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="button" className="icon-button" aria-label="Enviar imagem" title="Enviar imagem ou GIF" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Rolar 1d20 (botão direito: mais opções)"
              title="Rolar 1d20 — botão direito: mais opções"
              onClick={() => actions.sendRoll(D20, false)}
              onContextMenu={(e) => {
                e.preventDefault()
                setDice({ x: e.clientX, y: e.clientY })
              }}
            >
              <Dices size={16} aria-hidden />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              data-testid="chat-image-input"
              onChange={(e) => {
                sendImage(pickImageFile(e.target.files))
                e.target.value = ''
              }}
            />
          </form>
        </>
      )}

      {dice && <DiceModal x={dice.x} y={dice.y} onClose={closeDice} />}
      {lightbox && <ImageLightbox assetKey={lightbox} onClose={closeLightbox} />}
    </section>
  )
}
