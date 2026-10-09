import { useCallback, useEffect, useState } from 'react'
import { createTable } from '../lib/api'
import { rememberGmSecret } from '../lib/identity'
import {
  deleteConfirmOptions,
  deleteTable,
  loadRegistry,
  renameTable,
  rotateConfirmOptions,
  rotateLink,
  type RegistryLoad,
} from '../lib/registry'
import { askConfirm } from './confirm'
import { HomeView, type HomeActions } from './HomeView'

const REFRESH_MS = 10_000

export function HomePage() {
  const [load, setLoad] = useState<RegistryLoad | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = useCallback(async () => setLoad(await loadRegistry()), [])

  useEffect(() => {
    void refresh()
    // O launcher informa o túnel depois que o navegador abriu: a lista se atualiza sozinha (só com a aba visível).
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const actions: HomeActions = {
    async create(name) {
      setNotice(null)
      try {
        const result = await createTable(name.trim() || 'Nova mesa')
        rememberGmSecret(result.tableId, result.gmSecret)
        await refresh()
        return true
      } catch {
        setNotice('Não foi possível criar a mesa. Tente de novo.')
        return false
      }
    },
    async rename(id, name) {
      setNotice(null)
      const ok = await renameTable(id, name)
      if (!ok) setNotice('Não foi possível renomear a mesa. Tente de novo.')
      await refresh()
      return ok
    },
    async remove(table) {
      if (!(await askConfirm(deleteConfirmOptions(table.name)))) return
      setNotice(null)
      if (!(await deleteTable(table.id))) setNotice('Não foi possível apagar a mesa. Tente de novo.')
      await refresh()
    },
    async rotate(table, kind) {
      if (!(await askConfirm(rotateConfirmOptions(kind)))) return
      setNotice(null)
      if (!(await rotateLink(table.id, kind))) {
        setNotice('Não foi possível gerar o link novo. Tente de novo.')
        await refresh()
        return
      }
      const next = await loadRegistry()
      setLoad(next)
      // O mestre deste PC continua entrando como mestre: o segredo guardado no navegador passa a ser o novo.
      const gmSecret = next.kind === 'local' ? next.view.tables.find((t) => t.id === table.id)?.gmSecret : undefined
      if (kind === 'gm' && gmSecret) rememberGmSecret(table.id, gmSecret)
    },
    retry: () => void refresh(),
  }

  return <HomeView load={load} origin={window.location.origin} actions={actions} notice={notice} />
}
