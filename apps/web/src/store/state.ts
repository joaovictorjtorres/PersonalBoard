import type { Layer, Member, Op, TableMetaPublic, TableObject } from '@mesa/shared'
import type { ConnStatus } from '../sync/SyncClient'

export type Tool = 'select' | 'hand' | 'pencil' | 'eraser'

export interface Viewport { x: number; y: number; scale: number }
export interface Geometry { x: number; y: number; width: number; height: number; rotation: number }

export interface PendingOp {
  op: Op
  before: TableObject | null
  isUndo: boolean
  inverse: Op | null
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
  fatal: 'table_not_found' | null
  self: Member | null
  meta: TableMetaPublic | null
  members: Record<string, Member>
  layers: Layer[]
  objects: Record<string, TableObject>
  locks: Record<string, { clientId: string; expiresAt: number }>
  cursors: Record<string, { x: number; y: number }>
  dragPreviews: Record<string, Geometry>
  strokePreviews: Record<string, StrokePreview>
  pending: Record<string, PendingOp>
  undoStack: Op[]
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
    objects: {},
    locks: {},
    cursors: {},
    dragPreviews: {},
    strokePreviews: {},
    pending: {},
    undoStack: [],
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
