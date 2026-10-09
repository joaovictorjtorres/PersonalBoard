import { useCallback, useEffect, useState } from 'react'
import { createTable, type CreatedTable } from '../lib/api'
import { rememberGmSecret } from '../lib/identity'
import {
  deleteConfirmOptions,
  deleteTable,
  loadRegistry,
  nextHomeLoad,
  renameTable,
  rotateConfirmOptions,
  rotateLink,
  type HomeLoad,
  type RegistryLoad,
} from '../lib/registry'
import { askConfirm } from './confirm'
import { HomeView, type HomeActions } from './HomeView'

const REFRESH_MS = 10_000

export function HomePage() {
  const [state, setState] = useState<HomeLoad>({ load: null, stale: false })
  const [notice, setNotice] = useState<string | null>(null)
  // Servidor aberto na rede (sem lista): a mesa recém-criada mostra os links uma vez.
  const [created, setCreated] = useState<CreatedTable | null>(null)
  const apply = useCallback((next: RegistryLoad) => setState((prev) => nextHomeLoad(prev, next)), [])
  const refresh = useCallback(async () => {
    const next = await loadRegistry()
    apply(next)
    return next
  }, [apply])

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
        setCreated(result)
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
      const next = await refresh()
      // O mestre deste PC continua entrando como mestre: o segredo guardado no navegador passa a ser o novo.
      const gmSecret = next.kind === 'local' ? next.view.tables.find((t) => t.id === table.id)?.gmSecret : undefined
      if (kind === 'gm' && gmSecret) rememberGmSecret(table.id, gmSecret)
    },
    retry: () => void refresh(),
  }

  return (
    <HomeView
      load={state.load}
      stale={state.stale}
      created={created}
      origin={window.location.origin}
      actions={actions}
      notice={notice}
    />
  )
}
