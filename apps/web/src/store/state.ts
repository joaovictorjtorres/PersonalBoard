import {
  DEFAULT_SETTINGS,
  type ChatChannel,
  type ChatEntry,
  type Layer,
  type Member,
  type Op,
  type Point,
  type ShapeKind,
  type TableMetaPublic,
  type TableObject,
  type TableSettings,
} from '@mesa/shared'
import type { ConnStatus } from '../sync/SyncClient'

export type Tool = 'select' | 'hand' | 'pencil' | 'ruler' | 'shape'
export type PenMode = 'draw' | 'erase'

export interface Viewport { x: number; y: number; scale: number }
export interface Geometry { x: number; y: number; width: number; height: number; rotation: number }

/** O que desfazer localmente se uma op que não é de objeto for recusada. */
export type LocalPrev =
  | { kind: 'layers'; layers: Layer[]; objects: TableObject[]; notes: Record<string, string> }
  | { kind: 'note'; objectId: string; text: string | null }
  | { kind: 'member'; member: Member | null }
  | { kind: 'settings'; settings: TableSettings }
  /** clearObjects: o que a limpeza otimista tirou, para voltar se o servidor recusar. */
  | { kind: 'objects'; objects: TableObject[]; notes: Record<string, string> }

export interface PendingOp {
  op: Op
  before: TableObject | null
  isUndo: boolean
  /** Ops que desfazem esta, na ordem de execução. */
  inverse: Op[] | null
  group: { id: string; index: number } | null
  prev: LocalPrev | null
  /** layerMove: ordem absoluta resultante, para a reaplicação ser idempotente */
  layerOrders: Record<string, number> | null
}

/** Grupo de desfazer ainda esperando ack/reject de todas as ops. */
export interface UndoGroup {
  inverses: Array<Op[] | null>
  settled: number
}

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export interface ObjectMenu {
  objectId: string
  /** Posição do clique na tela (clientX/clientY). */
  x: number
  y: number
}

export interface StrokePreview {
  clientId: string
  layerId: string
  points: number[]
  color: string
  strokeWidth: number
}

export interface Ruler {
  /** Início, dobras e ponta (o cursor), em coordenadas do mapa. */
  points: Point[]
}

export interface Ping {
  id: number
  clientId: string
  x: number
  y: number
  /** Date.now() de quando chegou. */
  at: number
}

export interface ShapeFill {
  enabled: boolean
  /** null = mesma cor do contorno (a da caneta). */
  color: string | null
  opacity: number
}

export interface TableState {
  status: ConnStatus
  fatal: 'table_not_found' | 'auth' | null
  self: Member | null
  meta: TableMetaPublic | null
  members: Record<string, Member>
  layers: Layer[]
  /** camadas confirmadas pelo servidor; `layers` = confirmadas + ops de camada pendentes */
  confirmedLayers: Layer[]
  objects: Record<string, TableObject>
  notes: Record<string, string>
  locks: Record<string, { clientId: string; expiresAt: number }>
  cursors: Record<string, { x: number; y: number }>
  dragPreviews: Record<string, Geometry>
  /**
   * Minha prévia de arrasto/redimensionamento, a cada movimento (só local): o nó do Konva já se move
   * sozinho, e título/ícones seguem por aqui até soltar.
   */
  ownDragPreviews: Record<string, Geometry>
  strokePreviews: Record<string, StrokePreview>
  pending: Record<string, PendingOp>
  undoStack: Op[][]
  undoGroups: Record<string, UndoGroup>
  deniedGrabs: Record<string, true>
  toasts: Toast[]
  activeLayerId: string
  tool: Tool
  color: string
  strokeWidth: number
  penMode: PenMode
  /** Mestre no modo apagar: false = só os meus traços; true = de todos. */
  eraseAll: boolean
  selectedId: string | null
  objectMenu: ObjectMenu | null
  viewport: Viewport
  settings: TableSettings
  /** Réguas das outras pessoas, por clientId (a minha é `ownRuler`). */
  rulers: Record<string, Ruler>
  ownRuler: Ruler | null
  pings: Ping[]
  /** Ping com recenter de outra pessoa; `seq` muda a cada pedido. */
  cameraTarget: { x: number; y: number; seq: number } | null
  shapeKind: ShapeKind
  shapeFill: ShapeFill
  /** Histórico da mesa (até 200), já filtrado pelo servidor. */
  chatTable: ChatEntry[]
  /** Histórico das conversas privadas abertas, por clientId da outra pessoa (só no cliente). */
  chatDms: Record<string, ChatEntry[]>
  /** Abas privadas abertas, em ordem de abertura. */
  chatTabs: string[]
  /** 'table' ou o clientId da conversa privada. */
  chatActive: string
  /** Não lidas por aba; ausente = 0. */
  chatUnread: Record<string, number>
  chatOpen: boolean
  /** Canal de cada pedido de chat ainda sem chatAck/chatReject, por reqId. */
  chatPending: Record<string, ChatChannel>
}

export function makeInitialState(): TableState {
  return {
    status: 'connecting',
    fatal: null,
    self: null,
    meta: null,
    members: {},
    layers: [],
    confirmedLayers: [],
    objects: {},
    notes: {},
    locks: {},
    cursors: {},
    dragPreviews: {},
    ownDragPreviews: {},
    strokePreviews: {},
    pending: {},
    undoStack: [],
    undoGroups: {},
    deniedGrabs: {},
    toasts: [],
    activeLayerId: 'tokens',
    tool: 'select',
    color: '#e6194b',
    strokeWidth: 4,
    penMode: 'draw',
    eraseAll: false,
    selectedId: null,
    objectMenu: null,
    viewport: { x: 0, y: 0, scale: 1 },
    settings: { grid: { ...DEFAULT_SETTINGS.grid } },
    rulers: {},
    ownRuler: null,
    pings: [],
    cameraTarget: null,
    shapeKind: 'rect',
    shapeFill: { enabled: false, color: null, opacity: 0.3 },
    chatTable: [],
    chatDms: {},
    chatTabs: [],
    chatActive: 'table',
    chatUnread: {},
    chatOpen: true,
    chatPending: {},
  }
}
