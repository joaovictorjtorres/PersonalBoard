import { createStore, type StoreApi } from 'zustand/vanilla'
import { nanoid } from 'nanoid'
import type { Op, Presence } from '@mesa/shared'
import { SyncClient, type SyncClientOptions } from '../sync/SyncClient'
import { throttle, type Throttled } from '../lib/throttle'
import { getClientId, readClientSecret, readGmSecret, rememberClientSecret, shouldRetryAuth } from '../lib/identity'
import { uploadAsset, wsUrl } from '../lib/api'
import { initialSize, prepareImage, uploadErrorText, viewportCenter } from '../lib/image'
import { makeInitialState, type Geometry, type TableState, type Toast, type Tool, type Viewport } from './state'
import { addToast, reduceServer, reduceStatus, reduceSubmit } from './reducers'

export interface TableActions {
  connect(nickname: string): void
  disconnect(): void
  submit(op: Op): boolean
  undo(): void
  grab(id: string): void
  release(id: string): void
  dragPreview(id: string, g: Geometry): void
  cursor(x: number, y: number): void
  sendPresence(p: Presence): void
  setTool(tool: Tool): void
  setColor(color: string): void
  setStrokeWidth(width: number): void
  setActiveLayer(id: string): void
  select(id: string | null): void
  setViewport(v: Viewport): void
  toast(text: string, action?: Toast['action']): void
  dismissToast(id: number): void
  clearDenied(id: string): void
  nextZ(layerId: string): number
  canEditLayer(layerId: string): boolean
  stats(): { sent: number; received: number; writes: number }
  addImageFile(file: Blob, at?: { x: number; y: number }): Promise<void>
}

export type TableStoreState = TableState & { actions: TableActions }
export type TableStore = StoreApi<TableStoreState>

export function createTableStore(
  tableId: string,
  deps: { createSocket?: SyncClientOptions['createSocket'] } = {},
): TableStore {
  let sync: SyncClient | null = null
  const dragThrottles = new Map<string, Throttled<[Geometry]>>()
  let writes = 0
  let authRetried = false

  return createStore<TableStoreState>()((set, get) => {
    const cursorThrottle = throttle((x: number, y: number) => {
      sync?.send({ t: 'presence', p: { kind: 'cursor', x, y } })
    }, 66)

    const submitInternal = (op: Op, isUndo: boolean): boolean => {
      const s = get()
      if (s.status !== 'open' || !sync) {
        set(addToast(s, 'Sem conexão — aguarde reconectar'))
        return false
      }
      const opId = `op_${nanoid()}`
      set(reduceSubmit(s, opId, op, { isUndo }))
      sync.sendOp(opId, op)
      return true
    }

    const actions: TableActions = {
      connect(nickname) {
        sync?.close()
        let sentSecret: string | undefined
        // Callbacks de um cliente antigo (ex.: o close assíncrono do StrictMode)
        // são ignorados para não sobrescrever o status do cliente atual.
        const client: SyncClient = new SyncClient({
          url: wsUrl(tableId),
          hello: () => {
            const gmSecret = readGmSecret(tableId)
            sentSecret = readClientSecret(tableId)
            return {
              t: 'hello',
              clientId: getClientId(),
              nickname,
              ...(gmSecret ? { gmSecret } : {}),
              ...(sentSecret ? { clientSecret: sentSecret } : {}),
            }
          },
          onMessage: (msg) => {
            if (sync !== client) return
            if (msg.t === 'ack') writes++
            if (msg.t === 'welcome' && msg.clientSecret) rememberClientSecret(tableId, msg.clientSecret)
            if (msg.t === 'error' && msg.reason === 'auth' && shouldRetryAuth(sentSecret, readClientSecret(tableId), authRetried)) {
              authRetried = true
              actions.connect(nickname)
              return
            }
            set((s) => reduceServer(s, msg, Date.now()))
          },
          onStatus: (status) => {
            if (sync === client) set((s) => reduceStatus(s, status))
          },
          createSocket: deps.createSocket,
        })
        sync = client
        client.connect()
      },
      disconnect() {
        sync?.close()
        sync = null
      },
      submit: (op) => submitInternal(op, false),
      undo() {
        const s = get()
        const op = s.undoStack[s.undoStack.length - 1]
        if (!op) return
        set({ undoStack: s.undoStack.slice(0, -1) })
        // offline/sem sync: submitInternal recusa — devolve a op à pilha para não perdê-la
        if (!submitInternal(op, true)) set((st) => ({ undoStack: [...st.undoStack, op] }))
      },
      grab(id) {
        set((s) => ({ deniedGrabs: Object.fromEntries(Object.entries(s.deniedGrabs).filter(([k]) => k !== id)) }))
        sync?.send({ t: 'grab', objectId: id })
      },
      release(id) {
        dragThrottles.get(id)?.cancel()
        dragThrottles.delete(id)
        sync?.send({ t: 'release', objectId: id })
      },
      dragPreview(id, g) {
        let t = dragThrottles.get(id)
        if (!t) {
          t = throttle((geom: Geometry) => sync?.send({ t: 'presence', p: { kind: 'drag', objectId: id, ...geom } }), 33)
          dragThrottles.set(id, t)
        }
        t(g)
      },
      cursor: (x, y) => cursorThrottle(x, y),
      sendPresence: (p) => sync?.send({ t: 'presence', p }),
      setTool: (tool) => set({ tool, selectedId: tool === 'select' ? get().selectedId : null }),
      setColor: (color) => set({ color }),
      setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
      setActiveLayer: (activeLayerId) => set({ activeLayerId, selectedId: null }),
      select: (selectedId) => set({ selectedId }),
      setViewport: (viewport) => set({ viewport }),
      toast: (text, action) => set((s) => addToast(s, text, action)),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      clearDenied: (id) =>
        set((s) => ({ deniedGrabs: Object.fromEntries(Object.entries(s.deniedGrabs).filter(([k]) => k !== id)) })),
      nextZ(layerId) {
        let max = 0
        for (const o of Object.values(get().objects)) if (o.layerId === layerId) max = Math.max(max, o.zIndex)
        return max + 1
      },
      canEditLayer(layerId) {
        const s = get()
        const layer = s.layers.find((l) => l.id === layerId)
        return !!layer && (!layer.locked || s.self?.role === 'gm')
      },
      stats: () => ({ ...(sync ? sync.stats : { sent: 0, received: 0 }), writes }),
      async addImageFile(file, at) {
        // capturado antes do primeiro await: trocar de camada/pan durante o upload não pode mudar o destino
        const s0 = get()
        const layerId = s0.activeLayerId
        const center = at ?? viewportCenter(s0.viewport, window.innerWidth, window.innerHeight)
        try {
          const prepared = await prepareImage(file)
          const assetKey = await uploadAsset(tableId, prepared.blob)
          const size = initialSize(layerId, prepared.width, prepared.height)
          actions.submit({
            kind: 'create',
            object: {
              id: nanoid(),
              type: 'image',
              layerId,
              assetKey,
              x: center.x - size.width / 2,
              y: center.y - size.height / 2,
              width: size.width,
              height: size.height,
              rotation: 0,
              zIndex: actions.nextZ(layerId),
            },
          })
        } catch (err) {
          const { text, retry } = uploadErrorText(err)
          set((s) =>
            addToast(s, text, retry ? { label: 'Tentar novamente', run: () => void actions.addImageFile(file, center) } : undefined),
          )
        }
      },
    }

    return { ...makeInitialState(), actions }
  })
}
