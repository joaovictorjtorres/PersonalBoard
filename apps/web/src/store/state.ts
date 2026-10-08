import type { Layer, Member, Op, TableMetaPublic, TableObject } from '@mesa/shared'
import type { ConnStatus } from '../sync/SyncClient'

export type Tool = 'select' | 'hand' | 'pencil' | 'eraser'

export interface Viewport { x: number; y: number; scale: number }
export interface Geometry { x: number; y: number; width: number; height: number; rotation: number }

/** O que desfazer localmente se uma op que não é de objeto for recusada. */
export type LocalPrev =
  | { kind: 'layers'; layers: Layer[]; objects: TableObject[]; notes: Record<string, string> }
  | { kind: 'note'; objectId: string; text: string | null }
  | { kind: 'member'; member: Member | null }

export interface PendingOp {
  op: Op
  before: TableObject | null
  isUndo: boolean
  inverse: Op | null
  group: { id: string; index: number } | null
  prev: LocalPrev | null
  /** layerMove: ordem absoluta resultante, para a reaplicação ser idempotente */
  layerOrders: Record<string, number> | null
}

/** Grupo de desfazer ainda esperando ack/reject de todas as ops. */
export interface UndoGroup {
  inverses: Array<Op | null>
  settled: number
}

export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export interface StrokePreview {
  clientId: string
  layerId: string
  points: number[]
  color: string
  strokeWidth: number
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
  selectedId: string | null
  viewport: Viewport
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
    selectedId: null,
    viewport: { x: 0, y: 0, scale: 1 },
  }
}
