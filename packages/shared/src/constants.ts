import type { Layer } from './model'

export const DEFAULT_LAYERS: Layer[] = [
  { id: 'map', name: 'Mapa', order: 0, visibility: 'all', locked: false },
  { id: 'tokens', name: 'Tokens', order: 1, visibility: 'all', locked: false },
  { id: 'drawings', name: 'Desenhos', order: 2, visibility: 'all', locked: false },
  { id: 'gm', name: 'Mestre', order: 3, visibility: 'gm', locked: false },
]

export const GM_LAYER_ID = 'gm'
export const DEFAULT_LAYER_NAME = 'Nova camada'

export const MEMBER_COLORS = [
  '#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4',
  '#46f0f0', '#f032e6', '#bcf60c', '#fabebe', '#008080', '#e6beff',
]

export const LOCK_TTL_MS = 10_000
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024
export const ALLOWED_UPLOAD_TYPES = ['image/webp', 'image/png', 'image/jpeg']
export const TABLE_ID_RE = /^[A-Za-z0-9]{10}$/
export const ASSET_KEY_RE = /^[a-f0-9]{64}$/
export const UNDO_LIMIT = 50
export const APPLIED_OPS_KEEP = 200
export const MAX_IMAGE_SIDE = 4096
export const TOKEN_INITIAL_SIDE = 70

// M2
export const MAX_CONTROL_IDS = 20
export const TITLE_MAX = 40
export const NOTE_MAX = 2000
export const LAYER_NAME_MAX = 40
export const MAX_SEGMENTS = 200
export const MAX_SEGMENT_NUMBERS = 20_000
export const MEMBER_RECENT_MS = 7 * 24 * 60 * 60 * 1000
export const HEARTBEAT_INTERVAL_MS = 25_000
export const HEARTBEAT_TIMEOUT_MS = 10_000
export const ERASER_MIN_SIZE = 8
