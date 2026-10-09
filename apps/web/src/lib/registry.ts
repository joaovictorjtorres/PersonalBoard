import type { RegistryTable, RegistryView } from '@mesa/shared'
import type { ConfirmOptions } from '../ui/confirm'

export type RegistryLoad = { kind: 'local'; view: RegistryView } | { kind: 'remote' } | { kind: 'error' }

/** 404 = pedido de fora do PC (túnel): a página não mostra lista nem criação. */
export async function loadRegistry(): Promise<RegistryLoad> {
  try {
    const res = await fetch('/api/registry/tables')
    if (res.status === 404) return { kind: 'remote' }
    if (!res.ok) return { kind: 'error' }
    return { kind: 'local', view: (await res.json()) as RegistryView }
  } catch {
    return { kind: 'error' }
  }
}

// O índice só aceita pedidos que mudam algo com Content-Type JSON (proteção contra outros sites).
const JSON_HEADERS = { 'Content-Type': 'application/json' }

export async function renameTable(id: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/registry/tables/${id}`, { method: 'PATCH', headers: JSON_HEADERS, body: JSON.stringify({ name }) })
    return res.ok
  } catch {
    return false
  }
}

export async function deleteTable(id: string): Promise<boolean> {
  try {
    return (await fetch(`/api/registry/tables/${id}`, { method: 'DELETE', headers: JSON_HEADERS })).ok
  } catch {
    return false
  }
}

export interface TableLinks {
  player: string
  gm: string
  openAsGm: string
}

/** Links para mandar usam o túnel (sem túnel, a origem local); "Abrir como mestre" fica na origem local. */
export function tableLinks(
  localOrigin: string,
  tunnelUrl: string | null,
  table: Pick<RegistryTable, 'id' | 'gmSecret' | 'playerKey'>,
): TableLinks {
  const share = tunnelUrl ?? localOrigin
  return {
    player: `${share}/t/${table.id}${table.playerKey ? `#j=${table.playerKey}` : ''}`,
    gm: `${share}/t/${table.id}#gm=${table.gmSecret}`,
    openAsGm: `/t/${table.id}#gm=${table.gmSecret}`,
  }
}

export function playersLabel(n: number): string {
  if (n === 0) return 'Nenhum jogador'
  return n === 1 ? '1 jogador' : `${n} jogadores`
}

const WHEN = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function formatWhen(ms: number): string {
  return WHEN.format(ms)
}

export function deleteConfirmOptions(name: string): ConfirmOptions {
  return {
    title: 'Apagar mesa',
    message: `Apagar a mesa ${name}? Desenhos, tokens, chat e turnos serão perdidos.`,
    confirmLabel: 'Apagar',
    danger: true,
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export type LinkKind = 'player' | 'gm'

/** Link novo de jogador ou de mestre: o antigo para de funcionar; quem está na mesa continua. */
export async function rotateLink(id: string, kind: LinkKind): Promise<boolean> {
  try {
    const path = kind === 'player' ? 'player-link' : 'gm-link'
    return (await fetch(`/api/registry/tables/${id}/${path}`, { method: 'POST', headers: JSON_HEADERS })).ok
  } catch {
    return false
  }
}

export function rotateConfirmOptions(kind: LinkKind): ConfirmOptions {
  const who = kind === 'player' ? 'jogador' : 'mestre'
  return {
    title: `Gerar novo link de ${who}`,
    message: `O link de ${who} atual vai parar de funcionar. Quem já está na mesa continua conectado.`,
    confirmLabel: 'Gerar novo link',
  }
}
