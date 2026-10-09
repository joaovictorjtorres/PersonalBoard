import { useEffect, useMemo, useState } from 'react'
import { useStore } from 'zustand'
import type { KnownPlayer, ServerErrorReason } from '@mesa/shared'
import { TableCanvas } from '../canvas/TableCanvas'
import { fetchKnownPlayers } from '../lib/api'
import { getNickname, setNickname } from '../lib/identity'
import { TableStoreContext, useTable, useTableActions } from '../store/context'
import { createTableStore } from '../store/tableStore'
import { ChatPanel } from './chat/ChatPanel'
import { ConnectionBanner } from './ConnectionBanner'
import { DebugPanel } from './DebugPanel'
import { LayersPanel } from './LayersPanel'
import { ObjectContextMenu } from './ObjectContextMenu'
import { MembersPanel } from './MembersPanel'
import { NICKNAME_TAKEN, NicknameModal } from './NicknameModal'
import { SelectionContextMenu } from './SelectionContextMenu'
import { Toasts } from './Toasts'
import { Toolbar } from './Toolbar'
import { TurnsWindow } from './turns/TurnsWindow'
import { useKeyboard } from './useKeyboard'

const debug = new URLSearchParams(window.location.search).has('debug')

export function TablePage({ tableId }: { tableId: string }) {
  const store = useMemo(() => createTableStore(tableId), [tableId])
  const [nickname, setNick] = useState<string | null>(() => getNickname())
  const [nickError, setNickError] = useState<string | null>(null)
  const [known, setKnown] = useState<KnownPlayer[]>([])
  const fatal = useStore(store, (s) => s.fatal)

  useEffect(() => {
    if (debug) (window as unknown as { __mesa?: typeof store }).__mesa = store
  }, [store])

  useEffect(() => {
    if (!nickname) return
    store.getState().actions.connect(nickname)
    return () => store.getState().actions.disconnect()
  }, [store, nickname])

  // Apelido de alguém online: volta para a tela de entrada com o aviso.
  useEffect(() => {
    if (fatal !== 'nickname_taken') return
    setNickError(NICKNAME_TAKEN)
    setNick(null)
  }, [fatal])

  useEffect(() => {
    if (nickname) return
    let alive = true
    void fetchKnownPlayers(tableId).then((players) => {
      if (alive) setKnown(players)
    })
    return () => {
      alive = false
    }
  }, [tableId, nickname])

  return (
    <TableStoreContext.Provider value={store}>
      {nickname ? (
        <TableView />
      ) : (
        <NicknameModal
          knownPlayers={known}
          error={nickError}
          onSubmit={(n) => {
            setNickname(n)
            setNickError(null)
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

  if (fatal) return <FatalMessage reason={fatal} />

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
      </div>
      <TurnsWindow />
      <div className="right-column">
        <MembersPanel />
        <ChatPanel />
        <LayersPanel />
      </div>
      <ObjectContextMenu />
      <SelectionContextMenu />
      <ConnectionBanner />
      <Toasts />
      {debug && <DebugPanel />}
    </>
  )
}

function FatalMessage({ reason }: { reason: ServerErrorReason }) {
  if (reason === 'nickname_taken') return null
  if (reason === 'table_deleted') return <DeletedNotice />
  if (reason === 'removed') {
    return (
      <div className="fullscreen-msg">
        <div>
          <p>Você foi removido da mesa</p>
        </div>
      </div>
    )
  }
  return (
    <div className="fullscreen-msg">
      <div>
        {reason === 'auth' ? (
          <p>Identidade inválida nesta mesa. Peça ao mestre para remover você da lista de membros e recarregue a página.</p>
        ) : (
          <>
            <p>Mesa não encontrada.</p>
            <a href="/" style={{ color: '#9db4ff' }}>Voltar à página inicial</a>
          </>
        )}
      </div>
    </div>
  )
}

const DELETED_REDIRECT_MS = 3_000

/** A mesa foi apagada pelo mestre: avisa e volta sozinho para a página inicial. */
function DeletedNotice() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.assign('/'), DELETED_REDIRECT_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="fullscreen-msg">
      <div>
        <p>A mesa foi apagada</p>
        <a href="/" style={{ color: '#9db4ff' }}>Voltar à página inicial</a>
      </div>
    </div>
  )
}
