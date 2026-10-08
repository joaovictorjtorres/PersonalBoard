import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type ChatEntry, type Member, type ServerMessage } from '@mesa/shared'
import { closeDmTab, openDmTab, selectChatTab, setChatOpen } from '../src/store/chat'
import { reduceServer } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const bia: Member = { clientId: 'bia', nickname: 'Bia', color: '#3cb44b', role: 'player', online: true }
const msg = (id: string, authorId = 'bia'): ChatEntry => ({ id, at: 0, authorId, kind: 'message', text: id })
const welcome = (chat: ChatEntry[] = []): ServerMessage => ({
  t: 'welcome',
  self: me,
  snapshot: { meta: { id: 'T', name: 'M' }, members: [me, bia], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat },
})
const joined = (chat: ChatEntry[] = []): TableState => reduceServer(makeInitialState(), welcome(chat), 0)
const receive = (s: TableState, channel: 'table' | { dm: string }, entry: ChatEntry) => reduceServer(s, { t: 'chat', channel, entry }, 0)
const ids = (list: ChatEntry[] | undefined) => (list ?? []).map((e) => e.id)

describe('chat da mesa', () => {
  it('welcome carrega o histórico já filtrado pelo servidor; aba Mesa ativa e painel aberto', () => {
    const s = joined([msg('a'), msg('b')])
    expect(ids(s.chatTable)).toEqual(['a', 'b'])
    expect(s.chatActive).toBe('table')
    expect(s.chatOpen).toBe(true)
  })

  it('não lidas só contam com a aba fora de vista e nunca para mensagens minhas', () => {
    let s = receive(joined(), 'table', msg('m1'))
    expect(ids(s.chatTable)).toEqual(['m1'])
    expect(s.chatUnread.table).toBeUndefined()
    s = setChatOpen(s, false)
    s = receive(s, 'table', msg('m2'))
    s = receive(s, 'table', msg('m3', 'me'))
    expect(s.chatUnread.table).toBe(1)
    s = setChatOpen(s, true)
    expect(s.chatUnread.table).toBeUndefined()
  })

  it('guarda no máximo 200 entradas', () => {
    let s = joined()
    for (let i = 0; i < 205; i++) s = receive(s, 'table', msg(`m${i}`))
    expect(s.chatTable).toHaveLength(200)
    expect(s.chatTable[0].id).toBe('m5')
  })

  it('chatReject mostra o aviso certo e esquece o pedido; chatAck só esquece', () => {
    let s: TableState = { ...joined(), chatPending: { r1: { dm: 'bia' }, r2: 'table', r3: 'table', r4: 'table' } }
    s = reduceServer(s, { t: 'chatReject', reqId: 'r1', reason: 'not_found' }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Bia está offline')
    s = reduceServer(s, { t: 'chatReject', reqId: 'r2', reason: 'rate_limited' }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Devagar…')
    s = reduceServer(s, { t: 'chatReject', reqId: 'r3', reason: 'invalid' }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Mensagem inválida')
    s = reduceServer(s, { t: 'chatAck', reqId: 'r4' }, 0)
    expect(s.chatPending).toEqual({})
  })
})

describe('conversas privadas', () => {
  it('mensagem recebida sem aba cria a aba sem tirar o foco e conta não lida', () => {
    const s = receive(joined(), { dm: 'bia' }, msg('d1'))
    expect(s.chatTabs).toEqual(['bia'])
    expect(s.chatActive).toBe('table')
    expect(s.chatUnread.bia).toBe(1)
    expect(ids(s.chatDms.bia)).toEqual(['d1'])
  })

  it('abrir a aba foca, abre o painel e zera as não lidas', () => {
    let s = setChatOpen(receive(joined(), { dm: 'bia' }, msg('d1')), false)
    s = openDmTab(s, 'bia')
    expect(s.chatActive).toBe('bia')
    expect(s.chatOpen).toBe(true)
    expect(s.chatUnread.bia).toBeUndefined()
    expect(s.chatTabs).toEqual(['bia'])
  })

  it('selecionar aba zera as não lidas dela', () => {
    let s = receive(joined(), { dm: 'bia' }, msg('d1'))
    s = selectChatTab(s, 'bia')
    expect(s.chatActive).toBe('bia')
    expect(s.chatUnread.bia).toBeUndefined()
  })

  it('fechar a aba apaga o histórico e volta para Mesa; reabrir começa vazia', () => {
    let s = openDmTab(receive(joined(), { dm: 'bia' }, msg('d1')), 'bia')
    s = closeDmTab(s, 'bia')
    expect(s.chatTabs).toEqual([])
    expect(s.chatDms).toEqual({})
    expect(s.chatActive).toBe('table')
    s = openDmTab(s, 'bia')
    expect(ids(s.chatDms.bia)).toEqual([])
  })

  it('fechar a aba ativa com o painel aberto zera as não lidas da Mesa', () => {
    let s = openDmTab(joined(), 'bia')
    s = receive(s, 'table', msg('t1'))
    expect(s.chatUnread.table).toBe(1)
    s = closeDmTab(s, 'bia')
    expect(s.chatUnread.table).toBeUndefined()
  })

  it('reconexão mantém as abas privadas e o histórico local; pedidos pendentes são esquecidos', () => {
    let s: TableState = { ...receive(joined(), { dm: 'bia' }, msg('d1')), chatPending: { r1: 'table' } }
    s = reduceServer(s, welcome([msg('t1')]), 0)
    expect(s.chatTabs).toEqual(['bia'])
    expect(ids(s.chatDms.bia)).toEqual(['d1'])
    expect(ids(s.chatTable)).toEqual(['t1'])
    expect(s.chatPending).toEqual({})
  })
})
