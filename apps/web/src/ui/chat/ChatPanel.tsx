import { useCallback, useEffect, useRef, useState } from 'react'
import { Dices, ImagePlus, MessageSquare, X } from 'lucide-react'
import { CHAT_TEXT_MAX, type ChatEntry, type RollRequest } from '@mesa/shared'
import type { ChatTab } from '../../store/chat'
import { useTable, useTableActions } from '../../store/context'
import { MemberMenu } from '../MemberMenu'
import { memberMenuOptions } from '../memberMenuOptions'
import { ChatEntryView } from './ChatEntryView'
import { DiceModal } from './DiceModal'
import { ImageLightbox } from './ImageLightbox'
import { pickImageFile, isNearBottom, shouldAutoScroll } from './format'

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
  const [memberMenu, setMemberMenu] = useState<{ clientId: string; x: number; y: number } | null>(null)
  const closeMemberMenu = useCallback(() => setMemberMenu(null), [])
  const isGm = useTable((s) => s.self?.role === 'gm')
  const totalUnread = Object.values(unread).reduce((sum, n) => sum + n, 0)
  const tabName = (tab: ChatTab) => (tab === 'table' ? 'Mesa' : (members[tab]?.nickname ?? 'Conversa'))

  // Mostra o fim da conversa ao abrir/trocar de aba; em novas mensagens, só se já estava perto do fim
  // (ou se a nova mensagem é minha), para não tirar quem está lendo o histórico.
  const selfId = useTable((s) => s.self?.clientId)
  const lastSeen = useRef<{ tab: ChatTab; open: boolean; count: number }>({ tab: active, open, count: 0 })
  const wasNearBottom = useRef(true)
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const prev = lastSeen.current
    const lastEntry = entries[entries.length - 1]
    const fresh = prev.tab !== active || prev.open !== open
    const mine = !fresh && entries.length > prev.count && lastEntry?.authorId === selfId
    lastSeen.current = { tab: active, open, count: entries.length }
    if (fresh || shouldAutoScroll(wasNearBottom.current, mine)) list.scrollTop = list.scrollHeight
  }, [entries, active, open, selfId])


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
                      className="icon-button chat-tab-close"
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

          <ol
            ref={listRef}
            onScroll={(e) => {
              const el = e.currentTarget
              wasNearBottom.current = isNearBottom(el.scrollHeight, el.scrollTop, el.clientHeight)
            }}
            className="chat-list" aria-label={`Mensagens — ${tabName(active)}`}>
            {entries.map((entry) => {
              const author = members[entry.authorId]
              const options = memberMenuOptions(entry.authorId, selfId, isGm)
              const hasMenu = author !== undefined && (options.dm || options.edit || options.clear)
              return (
                <ChatEntryView
                  key={entry.id}
                  entry={entry}
                  author={author ?? null}
                  onOpenImage={setLightbox}
                  onAuthorMenu={hasMenu ? (e) => setMemberMenu({ clientId: entry.authorId, x: e.clientX, y: e.clientY }) : undefined}
                />
              )
            })}
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
      {memberMenu && members[memberMenu.clientId] && (
        <MemberMenu
          key={memberMenu.clientId}
          member={members[memberMenu.clientId]}
          x={memberMenu.x}
          y={memberMenu.y}
          onClose={closeMemberMenu}
        />
      )}
    </section>
  )
}
