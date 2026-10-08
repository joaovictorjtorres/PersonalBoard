import { CHAT_HISTORY_LIMIT, type ChatChannel, type ChatEntry, type ChatRejectReason, type Member } from '@mesa/shared'
import type { TableState } from './state'

/** 'table' ou o clientId da outra pessoa da conversa privada. */
export type ChatTab = string

export function tabOf(channel: ChatChannel): ChatTab {
  return channel === 'table' ? 'table' : channel.dm
}

export function channelOf(tab: ChatTab): ChatChannel {
  return tab === 'table' ? 'table' : { dm: tab }
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

/** Entrada nova: mesa (até 200) ou conversa privada (cria a aba sem tirar o foco). */
export function reduceChatEntry<S extends TableState>(s: S, channel: ChatChannel, entry: ChatEntry): S {
  const tab = tabOf(channel)
  const unseen = entry.authorId !== s.self?.clientId && (!s.chatOpen || s.chatActive !== tab)
  const chatUnread = unseen ? { ...s.chatUnread, [tab]: (s.chatUnread[tab] ?? 0) + 1 } : s.chatUnread
  if (tab === 'table') return { ...s, chatTable: [...s.chatTable, entry].slice(-CHAT_HISTORY_LIMIT), chatUnread }
  return {
    ...s,
    chatTabs: s.chatTabs.includes(tab) ? s.chatTabs : [...s.chatTabs, tab],
    chatDms: { ...s.chatDms, [tab]: [...(s.chatDms[tab] ?? []), entry] },
    chatUnread,
  }
}

export function openDmTab<S extends TableState>(s: S, clientId: string): S {
  return {
    ...s,
    chatOpen: true,
    chatActive: clientId,
    chatTabs: s.chatTabs.includes(clientId) ? s.chatTabs : [...s.chatTabs, clientId],
    chatUnread: without(s.chatUnread, clientId),
  }
}

/** Fechar a aba apaga o histórico dela (não há cópia no servidor). */
export function closeDmTab<S extends TableState>(s: S, clientId: string): S {
  return {
    ...s,
    chatTabs: s.chatTabs.filter((t) => t !== clientId),
    chatDms: without(s.chatDms, clientId),
    chatUnread: without(s.chatUnread, clientId),
    chatActive: s.chatActive === clientId ? 'table' : s.chatActive,
  }
}

export function selectChatTab<S extends TableState>(s: S, tab: ChatTab): S {
  return { ...s, chatActive: tab, chatUnread: without(s.chatUnread, tab) }
}

export function setChatOpen<S extends TableState>(s: S, open: boolean): S {
  return { ...s, chatOpen: open, chatUnread: open ? without(s.chatUnread, s.chatActive) : s.chatUnread }
}

export function chatRejectText(reason: ChatRejectReason, channel: ChatChannel | undefined, members: Record<string, Member>): string {
  if (reason === 'rate_limited') return 'Devagar…'
  if (reason === 'not_found') {
    const id = channel && channel !== 'table' ? channel.dm : null
    return `${(id && members[id]?.nickname) || 'A pessoa'} está offline`
  }
  return 'Mensagem inválida'
}
