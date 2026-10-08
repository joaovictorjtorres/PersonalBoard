import { useEffect, useMemo, useState } from 'react'
import { TableCanvas } from '../canvas/TableCanvas'
import { getNickname, setNickname } from '../lib/identity'
import { TableStoreContext, useTable, useTableActions } from '../store/context'
import { createTableStore } from '../store/tableStore'
import { ConnectionBanner } from './ConnectionBanner'
import { DebugPanel } from './DebugPanel'
import { LayerSelect } from './LayerSelect'
import { MembersPanel } from './MembersPanel'
import { NicknameModal } from './NicknameModal'
import { Toasts } from './Toasts'
import { Toolbar } from './Toolbar'
import { useKeyboard } from './useKeyboard'

const debug = new URLSearchParams(window.location.search).has('debug')

export function TablePage({ tableId }: { tableId: string }) {
  const store = useMemo(() => createTableStore(tableId), [tableId])
  const [nickname, setNick] = useState<string | null>(() => getNickname())

  useEffect(() => {
    if (debug) (window as unknown as { __mesa?: typeof store }).__mesa = store
  }, [store])

  useEffect(() => {
    if (!nickname) return
    store.getState().actions.connect(nickname)
    return () => store.getState().actions.disconnect()
  }, [store, nickname])

  return (
    <TableStoreContext.Provider value={store}>
      {nickname ? (
        <TableView />
      ) : (
        <NicknameModal
          onSubmit={(n) => {
            setNickname(n)
            setNick(n)
          }}
        />
      )}
    </TableStoreContext.Provider>
  )
}

function TableView() {
  const fatal = useTable((s) => s.fatal)
  const name = useTable((s) => s.meta?.name)
  const actions = useTableActions()
  const viewport = useTable((s) => s.viewport)
  useKeyboard()

  if (fatal) {
    return (
      <div className="fullscreen-msg">
        <div>
          <p>Mesa não encontrada.</p>
          <a href="/" style={{ color: '#9db4ff' }}>Criar uma nova mesa</a>
        </div>
      </div>
    )
  }

  return (
    <>
      <div
        style={{ position: 'absolute', inset: 0 }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault()
          const file = e.dataTransfer.files[0]
          if (!file) return
          void actions.addImageFile(file, {
            x: (e.clientX - viewport.x) / viewport.scale,
            y: (e.clientY - viewport.y) / viewport.scale,
          })
        }}
      >
        <TableCanvas />
      </div>
      <Toolbar />
      <div className="panel topbar">
        <strong>{name ?? '…'}</strong>
        <LayerSelect />
      </div>
      <MembersPanel />
      <ConnectionBanner />
      <Toasts />
      {debug && <DebugPanel />}
    </>
  )
}
