import { useEffect, useState } from 'react'
import { TABLE_NAME_MAX, type RegistryTable } from '@mesa/shared'
import { copyText, formatWhen, playersLabel, tableLinks, type LinkKind, type RegistryLoad, type TableLinks } from '../lib/registry'

export interface HomeActions {
  create(name: string): Promise<boolean>
  rename(id: string, name: string): Promise<boolean>
  remove(table: RegistryTable): Promise<void>
  rotate(table: RegistryTable, kind: LinkKind): Promise<void>
  retry(): void
}

export function HomeView({
  load,
  origin,
  actions,
  notice,
}: {
  load: RegistryLoad | null
  origin: string
  actions: HomeActions
  notice: string | null
}) {
  if (!load) {
    return (
      <main className="home">
        <h1>Mesa Virtual</h1>
      </main>
    )
  }
  if (load.kind === 'remote') {
    return (
      <main className="home">
        <h1>Mesa Virtual</h1>
        <p className="home-message">Peça o link da mesa ao mestre</p>
      </main>
    )
  }
  if (load.kind === 'error') {
    return (
      <main className="home">
        <h1>Mesa Virtual</h1>
        <p role="alert" className="form-error">Não foi possível carregar as mesas.</p>
        <div>
          <button type="button" onClick={actions.retry}>Tentar de novo</button>
        </div>
      </main>
    )
  }
  const { tables, tunnelUrl } = load.view
  return (
    <main className="home">
      <h1>Mesa Virtual</h1>
      <TunnelBox tunnelUrl={tunnelUrl} />
      <NewTableForm onCreate={actions.create} />
      {notice && <p role="alert" className="form-error">{notice}</p>}
      <section aria-label="Suas mesas" className="home-section">
        <h2>Suas mesas</h2>
        {tables.length === 0 ? (
          <p className="muted">Nenhuma mesa ainda. Dê um nome e clique em Criar mesa.</p>
        ) : (
          <ul className="table-list">
            {tables.map((t) => (
              <TableCard key={t.id} table={t} links={tableLinks(origin, tunnelUrl, t)} actions={actions} />
            ))}
          </ul>
        )}
      </section>
    </main>
  )
}

function TunnelBox({ tunnelUrl }: { tunnelUrl: string | null }) {
  if (!tunnelUrl) return <p className="tunnel-box tunnel-off">Túnel indisponível, só local</p>
  return (
    <div className="tunnel-box">
      <span className="muted">Link do túnel:</span>
      <code>{tunnelUrl}</code>
      <CopyButton text={tunnelUrl} label="Copiar" />
    </div>
  )
}

/** Copia; sem área de transferência, mostra o texto selecionado para Ctrl+C. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state !== 'copied') return
    const timer = setTimeout(() => setState('idle'), 2_000)
    return () => clearTimeout(timer)
  }, [state])
  return (
    <>
      <button type="button" onClick={async () => setState((await copyText(text)) ? 'copied' : 'failed')}>
        {state === 'copied' ? 'Copiado' : label}
      </button>
      {state === 'failed' && (
        <input className="copy-fallback" readOnly value={text} aria-label="Copie com Ctrl+C" autoFocus onFocus={(e) => e.target.select()} />
      )}
    </>
  )
}

export function TableCard({ table, links, actions }: { table: RegistryTable; links: TableLinks; actions: HomeActions }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(table.name)
  const [busy, setBusy] = useState(false)

  async function save() {
    const name = draft.trim()
    if (!name || name === table.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    const ok = await actions.rename(table.id, name)
    setBusy(false)
    if (ok) setEditing(false)
  }

  return (
    <li className="table-card">
      <h3>{table.name}</h3>
      <p className="table-meta">
        <span>Criada em {formatWhen(table.createdAt)}</span>
        <span>Última atividade em {formatWhen(table.lastActivityAt)}</span>
        <span>{playersLabel(table.players)}</span>
      </p>
      {editing && (
        <form
          className="rename-row"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input
            aria-label="Novo nome"
            value={draft}
            maxLength={TABLE_NAME_MAX}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button type="submit" className="primary" disabled={busy || !draft.trim()}>Salvar</button>
          <button type="button" onClick={() => setEditing(false)}>Cancelar</button>
        </form>
      )}
      <div className="table-actions">
        <div className="table-actions-group">
          <a className="button primary" href={links.openAsGm}>Abrir como mestre</a>
          <CopyButton text={links.gm} label="Copiar link de mestre" />
          <CopyButton text={links.player} label="Copiar link de jogador" />
        </div>
        <div className="table-actions-group">
          <button type="button" onClick={() => void actions.rotate(table, 'player')}>Gerar novo link de jogador</button>
          <button type="button" onClick={() => void actions.rotate(table, 'gm')}>Gerar novo link de mestre</button>
          <button
            type="button"
            onClick={() => {
              setDraft(table.name)
              setEditing(true)
            }}
          >
            Renomear
          </button>
          <button type="button" className="danger" onClick={() => void actions.remove(table)}>Apagar</button>
        </div>
      </div>
    </li>
  )
}

function NewTableForm({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="new-table"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const ok = await onCreate(name)
        setBusy(false)
        if (ok) setName('')
      }}
    >
      <h2>Nova mesa</h2>
      <label htmlFor="new-table-name">Nome da mesa</label>
      <div className="new-table-row">
        <input id="new-table-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={TABLE_NAME_MAX} placeholder="Campanha de sexta" />
        <button type="submit" className="primary" disabled={busy}>{busy ? 'Criando…' : 'Criar mesa'}</button>
      </div>
    </form>
  )
}
