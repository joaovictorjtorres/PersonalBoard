import { createStore, type StoreApi } from 'zustand/vanilla'
import { nanoid } from 'nanoid'
import type { Box, ChatChannel, ClientMessage, Control, MemberPatch, ObjectOp, Op, Point, Presence, RollRequest, SettingsPatch, ShapeKind } from '@mesa/shared'
import { BATCH_MAX, CHAT_TEXT_MAX, DEFAULT_LAYER_NAME, RULER_THROTTLE_MS, TURNS_MAX, canControl, parseCommand, snapToGrid } from '@mesa/shared'
import { SyncClient, type SyncClientOptions } from '../sync/SyncClient'
import { throttle, type Throttled } from '../lib/throttle'
import { getClientId, readClientSecret, readGmSecret, rememberClientSecret, shouldRetryAuth } from '../lib/identity'
import { uploadAsset, wsUrl } from '../lib/api'
import { initialSize, prepareChatImage, prepareImage, uploadErrorText, viewportCenter } from '../lib/image'
import {
  makeInitialState,
  NO_SELECTION,
  type Geometry,
  type PenMode,
  type Ruler,
  type ShapeFill,
  type TableState,
  type Toast,
  type Tool,
  type Viewport,
} from './state'
import { rulerBend as bendRuler, rulerMoveTo, rulerStart } from '../canvas/ruler'
import { addToast, canUseLayer, isLockedByOther, reduceServer, reduceStatus, reduceSubmitBatch } from './reducers'
import { rotatedBounds } from '../canvas/bounds'
import { linkedImage, turnNameFor } from './turns'
import { channelOf, closeDmTab, openDmTab, selectChatTab, setChatOpen, type ChatTab } from './chat'
import { addArea, collectSelection, selectionLayerIds, selectionOfIds, type SelectContext, type SelectionArea, type SelectShape } from '../selection/model'
import { planControl, planDelete, planMove, planToLayer, type PlanInput } from '../selection/plan'
import { reconcileSelection } from '../selection/reconcile'
import { loadSelectPrefs, saveSelectPrefs } from '../lib/selectPrefs'

export interface TableActions {
  connect(nickname: string): void
  disconnect(): void
  submit(op: Op): boolean
  submitGroup(ops: Op[]): boolean
  /**
   * Lotes atômicos (`batch`) como um só passo de desfazer. Lote com mais de 200 sub-ações é recusado
   * aqui, com aviso. `failText`: aviso se o servidor recusar.
   */
  submitBatches(batches: ObjectOp[][], failText: string): boolean
  undo(): void
  grab(id: string): void
  release(id: string): void
  dragPreview(id: string, g: Geometry): void
  cursor(x: number, y: number): void
  sendPresence(p: Presence): void
  setTool(tool: Tool): void
  setPen(mode: PenMode): void
  setEraseAll(value: boolean): void
  setColor(color: string): void
  setStrokeWidth(width: number): void
  setActiveLayer(id: string): void
  createLayer(): void
  select(id: string | null): void
  openObjectMenu(objectId: string, x: number, y: number): void
  closeObjectMenu(): void
  moveObjectToLayer(objectId: string, layerId: string): void
  setViewport(v: Viewport): void
  toast(text: string, action?: Toast['action']): void
  dismissToast(id: number): void
  clearDenied(id: string): void
  nextZ(layerId: string): number
  canEditLayer(layerId: string): boolean
  stats(): { sent: number; received: number; writes: number }
  addImageFile(file: Blob, at?: { x: number; y: number }): Promise<void>
  updateSettings(patch: SettingsPatch): void
  updateMember(clientId: string, patch: MemberPatch): void
  /** Escolhe o tipo e ativa a ferramenta Formas. */
  setShapeKind(kind: ShapeKind): void
  setShapeFill(patch: Partial<ShapeFill>): void
  /** Sem régua: começa no ponto clicado. Com régua: remove. */
  rulerClick(p: Point): void
  rulerMove(p: Point): void
  /** Botão direito medindo: dobra a régua exatamente no ponto. */
  rulerBend(p: Point): void
  rulerCancel(): void
  ping(p: Point, recenter: boolean): void
  /** true = enviado (o campo pode ser limpo); false = vazio, fórmula inválida ou sem conexão. */
  sendChatText(text: string): boolean
  sendRoll(request: RollRequest, secret: boolean): boolean
  sendChatImage(file: Blob): Promise<void>
  openDm(clientId: string): void
  closeDm(clientId: string): void
  selectChatTab(tab: ChatTab): void
  setChatOpen(open: boolean): void
  /** Mestre: põe o token (imagem) no fim da ordem de turnos e abre a janela se estiver fechada. */
  addTokenToTurns(objectId: string): void
  /** Token destacado no mapa enquanto o mouse está sobre o card dele (só na minha tela). */
  setTurnHover(tokenId: string | null): void
  /** Desliza a minha câmera até o centro do objeto, mantendo o zoom. */
  focusObject(objectId: string): void
  /** Troca (ou soma, com Shift) a seleção pela área; área sem nada editável não seleciona nada. */
  selectArea(area: SelectionArea, additive: boolean): void
  clearSelection(): void
  /** Arrasto do grupo: deslocamento atual (null = parado). */
  setSelectionOffset(offset: Point | null): void
  moveSelection(dx: number, dy: number): void
  deleteSelection(): void
  selectionToLayer(layerId: string): void
  selectionControl(control: Control): void
  openSelectionMenu(x: number, y: number): void
  closeSelectionMenu(): void
  setSelectShape(shape: SelectShape): void
  setSelectAllLayers(value: boolean): void
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
  let groupDragLive = false
  const groupDragThrottle = throttle((box: Box, layerIds: string[]) => {
    sync?.send({ t: 'presence', p: { kind: 'groupDrag', ...box, layerIds } })
  }, RULER_THROTTLE_MS)
  /** Os outros param de ver o contorno (soltou, cancelou, a seleção sumiu ou o lote foi recusado). */
  const endGroupDrag = () => {
    if (!groupDragLive) return
    groupDragLive = false
    groupDragThrottle.cancel()
    sync?.send({ t: 'presence', p: { kind: 'groupDragEnd' } })
  }

  const store = createStore<TableStoreState>()((set, get) => {
    const cursorThrottle = throttle((x: number, y: number) => {
      sync?.send({ t: 'presence', p: { kind: 'cursor', x, y } })
    }, 66)

    const dropOwnPreview = (id: string) => {
      if (!(id in get().ownDragPreviews)) return
      set((s) => ({ ownDragPreviews: Object.fromEntries(Object.entries(s.ownDragPreviews).filter(([k]) => k !== id)) }))
    }

    const rulerThrottle = throttle((ruler: Ruler) => {
      sync?.send({ t: 'presence', p: { kind: 'ruler', points: ruler.points } })
    }, RULER_THROTTLE_MS)

    const submitMany = (ops: Op[], isUndo: boolean, failText?: string): boolean => {
      if (ops.length === 0) return true
      const s = get()
      if (s.status !== 'open' || !sync) {
        set(addToast(s, 'Sem conexão. Aguarde reconectar'))
        return false
      }
      const items = ops.map((op) => ({ opId: `op_${nanoid()}`, op }))
      set(reduceSubmitBatch(s, items, { isUndo, groupId: `g_${nanoid()}`, ...(failText ? { failText } : {}) }))
      for (const { opId, op } of items) sync.sendOp(opId, op)
      return true
    }

    // Mensagens de chat não entram na fila de reenvio: sem conexão, avisa e não envia.
    const sendChat = (channel: ChatChannel, build: (reqId: string) => ClientMessage): boolean => {
      const s = get()
      if (s.status !== 'open' || !sync) {
        set(addToast(s, 'Sem conexão. Aguarde reconectar'))
        return false
      }
      const reqId = `c_${nanoid()}`
      set({ chatPending: { ...s.chatPending, [reqId]: channel } })
      sync.send(build(reqId))
      return true
    }

    const selectContext = (s: TableStoreState): SelectContext | null => {
      if (!s.self) return null
      const now = Date.now()
      return {
        objects: s.objects, layers: s.layers, activeLayerId: s.activeLayerId, allLayers: s.selectAllLayers,
        selfId: s.self.clientId, role: s.self.role, isLocked: (id) => isLockedByOther(s, id, now),
      }
    }

    const planInput = (s: TableStoreState): PlanInput | null =>
      s.selection && s.self
        ? {
            selection: s.selection, objects: s.objects, selfId: s.self.clientId, role: s.self.role,
            newId: () => nanoid(), nextZ: (layerId) => actions.nextZ(layerId), grid: s.settings.grid,
          }
        : null

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
              v: 2,
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
            set((s) => reconcileSelection(s, reduceServer(s, msg, Date.now())))
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
      submit: (op) => submitMany([op], false),
      submitGroup: (ops) => submitMany(ops, false),
      submitBatches(batches, failText) {
        const list = batches.filter((ops) => ops.length > 0)
        if (list.length === 0) return true
        if (list.some((ops) => ops.length > BATCH_MAX)) {
          set((s) => addToast(s, 'Seleção grande demais; selecione menos itens'))
          return false
        }
        return submitMany(list.map((ops): Op => ({ kind: 'batch', ops })), false, failText)
      },
      undo() {
        const s = get()
        const group = s.undoStack[s.undoStack.length - 1]
        if (!group) return
        set({ undoStack: s.undoStack.slice(0, -1) })
        // offline/sem sync: submitMany recusa — devolve o grupo à pilha para não perdê-lo
        if (!submitMany(group, true)) set((st) => ({ undoStack: [...st.undoStack, group] }))
      },
      grab(id) {
        set((s) => ({ deniedGrabs: Object.fromEntries(Object.entries(s.deniedGrabs).filter(([k]) => k !== id)) }))
        sync?.send({ t: 'grab', objectId: id })
      },
      release(id) {
        dragThrottles.get(id)?.cancel()
        dragThrottles.delete(id)
        dropOwnPreview(id)
        sync?.send({ t: 'release', objectId: id })
      },
      dragPreview(id, g) {
        set((s) => ({ ownDragPreviews: { ...s.ownDragPreviews, [id]: g } }))
        let t = dragThrottles.get(id)
        if (!t) {
          t = throttle((geom: Geometry) => sync?.send({ t: 'presence', p: { kind: 'drag', objectId: id, ...geom } }), 33)
          dragThrottles.set(id, t)
        }
        t(g)
      },
      cursor: (x, y) => cursorThrottle(x, y),
      sendPresence: (p) => sync?.send({ t: 'presence', p }),
      setTool(tool) {
        if (tool !== 'ruler') actions.rulerCancel()
        const s = get()
        set({ tool, selectedId: tool === 'select' ? s.selectedId : null, ...(tool === s.tool ? {} : NO_SELECTION) })
      },
      setPen(penMode) {
        actions.rulerCancel()
        set({ tool: 'pencil', penMode, selectedId: null, ...NO_SELECTION })
      },
      setEraseAll: (eraseAll) => set({ eraseAll }),
      setColor: (color) => set({ color }),
      setStrokeWidth: (strokeWidth) => set({ strokeWidth }),
      setActiveLayer(activeLayerId) {
        const s = get()
        const layer = s.layers.find((l) => l.id === activeLayerId)
        // Jogador não escolhe camada travada (não poderia desenhar nela).
        if (layer && !canUseLayer(layer, s.self?.role)) {
          set(addToast(s, 'Camada travada pelo mestre'))
          return
        }
        set({ activeLayerId, selectedId: null, ...(s.selectAllLayers ? {} : NO_SELECTION) })
      },
      createLayer() {
        const id = nanoid()
        if (actions.submit({ kind: 'layerCreate', layer: { id, name: DEFAULT_LAYER_NAME } })) {
          set({ activeLayerId: id, selectedId: null, ...(get().selectAllLayers ? {} : NO_SELECTION) })
        }
      },
      // Clique num item (ou no vazio) desfaz a seleção em área.
      select: (selectedId) => set({ selectedId, ...NO_SELECTION }),
      openObjectMenu(objectId, x, y) {
        const s = get()
        const object = s.objects[objectId]
        // Jogador que não controla o objeto: o menu não abre.
        if (!object || !s.self || !canControl(object, s.self.clientId, s.self.role)) return
        set({ objectMenu: { objectId, x, y }, selectedId: objectId, ...NO_SELECTION })
      },
      closeObjectMenu: () => set({ objectMenu: null }),
      moveObjectToLayer(objectId, layerId) {
        // Só layerId e zIndex (topo da camada de destino): posição e tamanho ficam iguais.
        actions.submit({ kind: 'update', id: objectId, patch: { layerId, zIndex: actions.nextZ(layerId) } })
        set({ selectedId: null })
      },
      setViewport: (viewport) => set({ viewport }),
      toast: (text, action) => set((s) => addToast(s, text, action)),
      dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
      clearDenied(id) {
        dropOwnPreview(id)
        set((s) => ({ deniedGrabs: Object.fromEntries(Object.entries(s.deniedGrabs).filter(([k]) => k !== id)) }))
      },
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
      updateSettings(patch) {
        actions.submit({ kind: 'settingsUpdate', patch })
      },
      updateMember(clientId, patch) {
        actions.submit({ kind: 'memberUpdate', clientId, patch })
      },
      setShapeKind(shapeKind) {
        actions.rulerCancel()
        set({ tool: 'shape', shapeKind, selectedId: null, ...NO_SELECTION })
      },
      setShapeFill: (patch) => set((s) => ({ shapeFill: { ...s.shapeFill, ...patch } })),
      rulerClick(p) {
        const s = get()
        if (s.ownRuler) {
          actions.rulerCancel()
          return
        }
        // A linha fica onde a pessoa aponta; a distância conta pelo centro dos quadrados
        // (com a grade desligada, os quadrados do tamanho configurado, do mesmo jeito).
        const ruler = rulerStart(p)
        set({ ownRuler: ruler })
        rulerThrottle(ruler)
      },
      rulerMove(p) {
        const current = get().ownRuler
        if (!current) return
        const ruler = rulerMoveTo(current, p)
        set({ ownRuler: ruler })
        rulerThrottle(ruler)
      },
      rulerBend(p) {
        const s = get()
        if (!s.ownRuler) return
        const ruler = bendRuler(s.ownRuler, p, s.settings.grid.size)
        if (!ruler) return
        set({ ownRuler: ruler })
        rulerThrottle(ruler)
      },
      rulerCancel() {
        if (!get().ownRuler) return
        rulerThrottle.cancel()
        set({ ownRuler: null })
        sync?.send({ t: 'presence', p: { kind: 'rulerEnd' } })
      },
      ping(p, recenter) {
        sync?.send({ t: 'presence', p: { kind: 'ping', x: p.x, y: p.y, recenter } })
      },
      sendChatText(text) {
        const trimmed = text.trim()
        if (!trimmed) return false
        const command = parseCommand(trimmed)
        if (command?.kind === 'invalid') {
          set((s) => addToast(s, 'Fórmula inválida. Ex.: /r 2d6+3'))
          return false
        }
        if (command?.kind === 'roll') return actions.sendRoll(command.request, false)
        const channel = channelOf(get().chatActive)
        return sendChat(channel, (reqId) => ({ t: 'chatSend', reqId, channel, text: trimmed.slice(0, CHAT_TEXT_MAX) }))
      },
      sendRoll(request, secret) {
        const channel = channelOf(get().chatActive)
        // "Só o mestre vê" não existe na conversa privada.
        return sendChat(channel, (reqId) => ({ t: 'roll', reqId, channel, request, secret: secret && channel === 'table' }))
      },
      async sendChatImage(file) {
        // canal capturado antes do upload: trocar de aba durante o envio não muda o destino
        const channel = channelOf(get().chatActive)
        if (get().status !== 'open' || !sync) {
          set((s) => addToast(s, 'Sem conexão. Aguarde reconectar'))
          return
        }
        try {
          const prepared = await prepareChatImage(file)
          const assetKey = await uploadAsset(tableId, prepared.blob)
          sendChat(channel, (reqId) => ({ t: 'chatImage', reqId, channel, assetKey, width: prepared.width, height: prepared.height }))
        } catch (err) {
          const { text, retry } = uploadErrorText(err)
          set((s) => addToast(s, text, retry ? { label: 'Tentar novamente', run: () => void actions.sendChatImage(file) } : undefined))
        }
      },
      openDm: (clientId) => set((s) => openDmTab(s, clientId)),
      closeDm: (clientId) => set((s) => closeDmTab(s, clientId)),
      selectChatTab: (tab) => set((s) => selectChatTab(s, tab)),
      setChatOpen: (open) => set((s) => setChatOpen(s, open)),
      addTokenToTurns(objectId) {
        const s = get()
        const object = linkedImage(s, objectId)
        if (!object) return
        if (s.turns.entries.length >= TURNS_MAX) {
          set(addToast(s, 'A ordem de turnos está cheia (máximo 50)'))
          return
        }
        const ops: Op[] = [{ kind: 'turnAdd', entry: { id: nanoid(), name: turnNameFor(object.title), tokenId: objectId } }]
        if (!s.turns.open) ops.push({ kind: 'turnsOpen', open: true })
        actions.submitGroup(ops)
      },
      setTurnHover: (turnHover) => set({ turnHover }),
      focusObject(objectId) {
        const object = linkedImage(get(), objectId)
        if (!object) return
        const b = rotatedBounds(object)
        set((s) => ({
          cameraTarget: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, seq: (s.cameraTarget?.seq ?? 0) + 1 },
        }))
      },
      async addImageFile(file, at) {
        // capturado antes do primeiro await: trocar de camada/pan durante o upload não pode mudar o destino
        const s0 = get()
        const layerId = s0.activeLayerId
        const center = at ?? viewportCenter(s0.viewport, window.innerWidth, window.innerHeight)
        try {
          const prepared = await prepareImage(file)
          const assetKey = await uploadAsset(tableId, prepared.blob)
          const size = initialSize(layerId, prepared.width, prepared.height)
          const box = { x: center.x - size.width / 2, y: center.y - size.height / 2, width: size.width, height: size.height }
          // Mesmo encaixe do servidor: a imagem nova já aparece alinhada.
          const grid = get().settings.grid
          const placed = grid.snap ? snapToGrid(box, grid.size) : box
          actions.submit({
            kind: 'create',
            object: {
              id: nanoid(),
              type: 'image',
              layerId,
              assetKey,
              ...placed,
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
      selectArea(area, additive) {
        const s = get()
        const ctx = selectContext(s)
        if (!ctx) return
        const selection = additive ? addArea(s.selection, area, ctx) : collectSelection([area], ctx)
        set({ selection, selectionOffset: null, selectionMenu: null, selectedId: null })
      },
      clearSelection: () => set(NO_SELECTION),
      setSelectionOffset(selectionOffset) {
        set({ selectionOffset })
        const { selection, objects } = get()
        if (!selectionOffset || !selection) return
        const b = selection.bounds
        groupDragLive = true
        groupDragThrottle(
          { x: b.x + selectionOffset.x, y: b.y + selectionOffset.y, width: b.width, height: b.height },
          selectionLayerIds(selection, objects),
        )
      },
      moveSelection(dx, dy) {
        const input = planInput(get())
        if (!input || (dx === 0 && dy === 0)) {
          set({ selectionOffset: null })
          return
        }
        const plan = planMove(input, dx, dy)
        // Recusado no navegador (grande demais ou sem conexão): volta para o lugar, seleção mantida.
        if (!actions.submitBatches(plan.batches, 'Não foi possível mover a seleção')) {
          set({ selectionOffset: null })
          return
        }
        set((s) => ({ selection: selectionOfIds(plan.selectAfter ?? [], s.objects), selectionOffset: null }))
      },
      deleteSelection() {
        const input = planInput(get())
        if (input && actions.submitBatches(planDelete(input).batches, 'Não foi possível apagar a seleção')) set(NO_SELECTION)
      },
      selectionToLayer(layerId) {
        const input = planInput(get())
        if (input && actions.submitBatches(planToLayer(input, layerId).batches, 'Não foi possível mover a seleção')) set(NO_SELECTION)
      },
      selectionControl(control) {
        const input = planInput(get())
        if (input) actions.submitBatches(planControl(input, control).batches, 'Não foi possível mudar as permissões')
      },
      openSelectionMenu(x, y) {
        if (get().selection) set({ selectionMenu: { x, y }, objectMenu: null })
      },
      closeSelectionMenu: () => set({ selectionMenu: null }),
      setSelectShape(selectShape) {
        set({ selectShape })
        saveSelectPrefs({ selectShape, selectAllLayers: get().selectAllLayers })
      },
      setSelectAllLayers(selectAllLayers) {
        set({ selectAllLayers, ...NO_SELECTION })
        saveSelectPrefs({ selectShape: get().selectShape, selectAllLayers })
      },
    }

    return { ...makeInitialState(), ...loadSelectPrefs(), actions }
  })

  // Qualquer caminho que zere o deslocamento (soltar, Esc, trocar de ferramenta, recusa) encerra o contorno.
  store.subscribe((s, prev) => {
    if (prev.selectionOffset && !s.selectionOffset) endGroupDrag()
  })
  return store
}
