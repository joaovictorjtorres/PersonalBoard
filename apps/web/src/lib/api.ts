import type { KnownPlayer } from '@mesa/shared'

export async function createTable(name: string): Promise<{ tableId: string; gmSecret: string }> {
  const res = await fetch('/api/tables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`create_failed_${res.status}`)
  return res.json()
}

export async function uploadAsset(tableId: string, blob: Blob): Promise<string> {
  const res = await fetch(`/api/tables/${tableId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  })
  if (!res.ok) throw new Error(`upload_failed_${res.status}`)
  const body = (await res.json()) as { assetKey: string }
  return body.assetKey
}

export function wsUrl(tableId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/tables/${tableId}/ws`
}

/** "Já jogou aqui?": jogadores fora da mesa; qualquer falha vira lista vazia. */
export async function fetchKnownPlayers(tableId: string): Promise<KnownPlayer[]> {
  try {
    const res = await fetch(`/api/tables/${tableId}/members`)
    if (!res.ok) return []
    const body = (await res.json()) as { players?: unknown }
    return Array.isArray(body.players) ? (body.players as KnownPlayer[]) : []
  } catch {
    return []
  }
}
