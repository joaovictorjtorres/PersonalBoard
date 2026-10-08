# Mesa Virtual — M1: Mesa Compartilhada — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir uma mesa virtual colaborativa (estilo Roll20) onde ~6 pessoas, entrando por link, compartilham mapa, tokens e desenhos em tempo real, com camada exclusiva do mestre e persistência entre sessões.

**Architecture:** Um Cloudflare Worker serve o front-end (Workers Static Assets), a API HTTP e encaminha WebSockets para um Durable Object `TableDO` por mesa. O DO é a autoridade: valida mensagens (Zod), aplica operações via um `TableEngine` puro (testável sem rede), persiste em SQLite embutido e retransmite filtrando a camada do mestre. Imagens ficam no R2. O front (React + react-konva + Zustand) aplica operações de forma otimista e reconcilia com `ack`/`reject`.

**Tech Stack:** TypeScript, pnpm workspaces, Zod 4, Cloudflare Workers + Durable Objects (SQLite) + R2, Wrangler, Vitest + `@cloudflare/vitest-pool-workers`, React 19, Vite, react-konva/Konva, use-image, Zustand 5, nanoid, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-08-mesa-virtual-m1-design.md`

**Desvio deliberado do spec:** o spec cita Cloudflare Pages para o front. Este plano usa **Workers Static Assets** (o mesmo Worker serve `apps/web/dist`), o que elimina CORS e mantém um único deploy. Como o Vite gera `dist/assets/*`, a rota de imagens do R2 é **`/files/:key`** (não `/assets/:key`). Também foi adicionada a mensagem `grabDenied` ao protocolo (resposta a um `grab` recusado). O upload retorna só `{ assetKey }`; largura/altura vêm do cliente, que já decodificou a imagem.

## Global Constraints

- Sem git por enquanto (pedido do usuário): os passos de "commit" viram **checkpoints** — rodar a suíte indicada e só seguir se estiver verde.
- Node.js ≥ 20 e pnpm ≥ 9.
- Tudo em TypeScript `strict`.
- Plano gratuito da Cloudflare: apenas Durable Objects com SQLite (`new_sqlite_classes`).
- Limites (copiados do spec): trava expira em **10 s**; upload aceita `image/webp`, `image/png`, `image/jpeg` até **10 MB**; imagens redimensionadas no cliente para no máx. **4096 px** no maior lado, WebP qualidade **0.85**; token inicial com maior lado = **70 px**; zoom **10%–800%**; desfazer guarda **50** ações; idempotência guarda os últimos **200** `opId` por cliente; paleta de **12** cores de membro.
- Throttle: cursor ~**15/s** (66 ms), arrasto e traço ~**30/s** (33 ms).
- Camadas fixas do M1: `map` (Mapa, 0, all), `tokens` (Tokens, 1, all), `drawings` (Desenhos, 2, all), `gm` (Mestre, 3, gm).
- Texto de interface em português.
- `tableId`: 10 caracteres base62; `gmSecret`: 32 bytes aleatórios (base64url); DO guarda só SHA-256 hex do segredo.
- Imagens servidas com `Cache-Control: public, max-age=31536000, immutable` e `X-Content-Type-Options: nosniff`.

## Review Focus

1. **Mesma pessoa em duas abas (mesmo `clientId`)**: fechar uma aba não pode marcar a pessoa como desconectada nem soltar as travas dela → teste no Task 4.
2. **Objeto movido entre a camada do Mestre e uma camada pública**: o jogador deve ver o objeto aparecer (`upsert`) ou sumir (`delete`) → teste no Task 4.
3. **Reconexão com operação própria ainda sem `ack`**: o objeto criado pelo autor não pode sumir da tela dele quando chega o snapshot novo → teste no Task 8.
4. **Mensagens lixo** (JSON inválido, mensagem antes do `hello`, apelido só com espaços): ignoradas sem derrubar a conexão; um `hello` válido depois funciona → teste no Task 4.
5. **Upload de SVG/GIF ou arquivo > 10 MB**: recusado com 415/413 e nada é gravado → teste no Task 5.

---

## Mapa de arquivos

```
package.json                     # scripts raiz
pnpm-workspace.yaml
tsconfig.base.json
playwright.config.ts
e2e/table.spec.ts

packages/shared/
  package.json, tsconfig.json
  src/index.ts                   # re-exporta tudo
  src/model.ts                   # schemas/tipos de objetos, camadas, membros
  src/protocol.ts                # mensagens cliente↔servidor
  src/constants.ts               # camadas padrão, cores, limites
  src/geometry.ts                # simplificação RDP, bounds
  test/protocol.test.ts
  test/geometry.test.ts

apps/worker/
  package.json, tsconfig.json, wrangler.jsonc, vitest.config.ts
  src/index.ts                   # roteador HTTP
  src/crypto.ts                  # sha256Hex, randomId, randomSecret, safeEqual
  src/files.ts                   # upload/serve R2
  src/table-do.ts                # Durable Object TableDO
  src/engine/store.ts            # interface TableStore + tipos persistidos
  src/engine/memory-store.ts     # implementação em memória (testes)
  src/engine/sql-store.ts        # implementação SQLite (DO)
  src/engine/engine.ts           # TableEngine: regras, permissões, travas
  test/env.d.ts
  test/helpers.ts
  test/engine.test.ts
  test/table-do.test.ts
  test/files.test.ts

apps/web/
  package.json, tsconfig.json, vite.config.ts, index.html
  src/main.tsx, src/App.tsx, src/styles.css
  src/lib/identity.ts            # clientId, apelido, gmSecret
  src/lib/api.ts                 # createTable, uploadAsset, wsUrl
  src/lib/throttle.ts
  src/lib/image.ts               # prepareImage, fitWithin, initialSize
  src/sync/SyncClient.ts         # WebSocket, reconexão, ops pendentes
  src/store/state.ts             # tipos do estado + estado inicial
  src/store/localOps.ts          # applyLocalOp, opTargetId
  src/store/undo.ts              # inverseOf
  src/store/reducers.ts          # reducers puros
  src/store/tableStore.ts        # Zustand + SyncClient + ações
  src/store/context.ts           # contexto React + hooks
  src/canvas/TableCanvas.tsx
  src/canvas/ImageNode.tsx
  src/canvas/StrokeNode.tsx
  src/canvas/Overlay.tsx
  src/canvas/SelectionTransformer.tsx
  src/canvas/nodeChange.ts       # commit de drag/transform
  src/canvas/useDrawingTools.ts  # lápis e borracha
  src/canvas/hooks.ts            # useModifierKeys, useWindowSize, useNow
  src/ui/HomePage.tsx, TablePage.tsx, NicknameModal.tsx, Toolbar.tsx,
  src/ui/LayerSelect.tsx, MembersPanel.tsx, ConnectionBanner.tsx,
  src/ui/Toasts.tsx, DebugPanel.tsx, useKeyboard.ts
  test/throttle.test.ts, test/sync-client.test.ts,
  test/undo.test.ts, test/reducers.test.ts, test/image.test.ts
```

---

### Task 1: Monorepo + pacote `shared` (modelo, protocolo, constantes)

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`
- Create: `packages/shared/package.json`, `packages/shared/tsconfig.json`
- Create: `packages/shared/src/{index,model,protocol,constants}.ts`
- Test: `packages/shared/test/protocol.test.ts`

**Interfaces:**
- Produces (importado de `@mesa/shared`):
  - `IdSchema`, `RoleSchema`, `Role = 'gm' | 'player'`
  - `Layer { id; name; order; visibility: 'all' | 'gm'; locked }`
  - `Member { clientId; nickname; color; role; online }`
  - `TableMetaPublic { id; name }`
  - `NewObjectSchema`/`NewObject` (objeto sem `ownerId`, `version`, `updatedBy`)
  - `TableObjectSchema`/`TableObject`, `ImageObject`, `StrokeObject`
  - `ObjectPatchSchema`/`ObjectPatch`
  - `OpSchema`/`Op` (`create` | `update` | `delete`), `PresenceSchema`/`Presence`, `ClientMessageSchema`/`ClientMessage`, `HelloMessage`
  - `AppliedOp`, `RejectReason`, `LockInfo`, `Snapshot`, `ServerMessage`
  - Constantes: `DEFAULT_LAYERS`, `MEMBER_COLORS`, `LOCK_TTL_MS`, `MAX_UPLOAD_BYTES`, `ALLOWED_UPLOAD_TYPES`, `TABLE_ID_RE`, `ASSET_KEY_RE`, `UNDO_LIMIT`, `APPLIED_OPS_KEEP`, `MAX_IMAGE_SIDE`, `TOKEN_INITIAL_SIDE`

- [ ] **Step 1: Criar arquivos raiz**

`package.json`:
```json
{
  "name": "mesa-virtual",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "dev:worker": "pnpm --filter @mesa/worker dev",
    "dev:web": "pnpm --filter @mesa/web dev",
    "build": "pnpm --filter @mesa/web build",
    "e2e": "playwright test",
    "deploy": "pnpm build && pnpm --filter @mesa/worker run deploy"
  }
}
```

`pnpm-workspace.yaml`:
```yaml
packages:
  - "apps/*"
  - "packages/*"
```

`tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "noEmit": true
  }
}
```

`packages/shared/package.json`:
```json
{
  "name": "@mesa/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": { ".": "./src/index.ts" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

`packages/shared/tsconfig.json`:
```json
{ "extends": "../../tsconfig.base.json", "include": ["src", "test"] }
```

Run:
```bash
pnpm add -w -D typescript
pnpm --filter @mesa/shared add zod@^4
pnpm --filter @mesa/shared add -D vitest typescript
```

- [ ] **Step 2: Escrever o teste do protocolo (falhando)**

`packages/shared/test/protocol.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { ClientMessageSchema, ObjectPatchSchema, OpSchema, TableObjectSchema } from '../src'

const uuid = '3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192'
const image = {
  id: 'tok1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
  x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 1,
}

describe('ClientMessageSchema', () => {
  it('aceita hello válido e apara o apelido', () => {
    const r = ClientMessageSchema.parse({ t: 'hello', clientId: uuid, nickname: '  Ana  ' })
    expect(r).toEqual({ t: 'hello', clientId: uuid, nickname: 'Ana' })
  })

  it('recusa apelido só com espaços', () => {
    expect(ClientMessageSchema.safeParse({ t: 'hello', clientId: uuid, nickname: '   ' }).success).toBe(false)
  })

  it('recusa clientId que não é uuid', () => {
    expect(ClientMessageSchema.safeParse({ t: 'hello', clientId: 'x', nickname: 'Ana' }).success).toBe(false)
  })

  it('aceita op create de imagem', () => {
    expect(ClientMessageSchema.safeParse({ t: 'op', opId: 'op_1', op: { kind: 'create', object: image } }).success).toBe(true)
  })

  it('recusa presença de traço com mais de 4000 números', () => {
    const p = { kind: 'stroke', strokeId: 's1', layerId: 'drawings', points: new Array(4002).fill(1), color: '#ffffff', strokeWidth: 4 }
    expect(ClientMessageSchema.safeParse({ t: 'presence', p }).success).toBe(false)
  })
})

describe('OpSchema', () => {
  it('recusa assetKey inválida', () => {
    expect(OpSchema.safeParse({ kind: 'create', object: { ...image, assetKey: 'nope' } }).success).toBe(false)
  })

  it('recusa traço com quantidade ímpar de coordenadas', () => {
    const stroke = { ...image, type: 'stroke', points: [0, 0, 1], color: '#000000', strokeWidth: 3 }
    delete (stroke as Record<string, unknown>).assetKey
    expect(OpSchema.safeParse({ kind: 'create', object: stroke }).success).toBe(false)
  })

  it('recusa NaN e Infinity em coordenadas', () => {
    expect(OpSchema.safeParse({ kind: 'create', object: { ...image, x: Number.POSITIVE_INFINITY } }).success).toBe(false)
  })
})

describe('ObjectPatchSchema', () => {
  it('aceita patch parcial', () => {
    expect(ObjectPatchSchema.parse({ x: 5 })).toEqual({ x: 5 })
  })

  it('recusa campos desconhecidos ou de servidor', () => {
    expect(ObjectPatchSchema.safeParse({ version: 9 }).success).toBe(false)
    expect(ObjectPatchSchema.safeParse({ foo: 1 }).success).toBe(false)
  })

  it('recusa largura negativa', () => {
    expect(ObjectPatchSchema.safeParse({ width: -1 }).success).toBe(false)
  })
})

describe('TableObjectSchema', () => {
  it('exige campos de servidor', () => {
    expect(TableObjectSchema.safeParse(image).success).toBe(false)
    expect(TableObjectSchema.safeParse({ ...image, ownerId: 'c', version: 1, updatedBy: 'c' }).success).toBe(true)
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @mesa/shared test`
Expected: FAIL — módulo `../src` não encontrado.

- [ ] **Step 4: Implementar**

`packages/shared/src/model.ts`:
```ts
import { z } from 'zod'

export const IdSchema = z.string().min(1).max(64).regex(/^[A-Za-z0-9_-]+$/)

export const RoleSchema = z.enum(['gm', 'player'])
export type Role = z.infer<typeof RoleSchema>

export interface Layer {
  id: string
  name: string
  order: number
  visibility: 'all' | 'gm'
  locked: boolean
}

export interface Member {
  clientId: string
  nickname: string
  color: string
  role: Role
  online: boolean
}

export interface TableMetaPublic {
  id: string
  name: string
}

// z.number() no Zod 4 já recusa NaN/Infinity.
const coord = z.number()
const size = z.number().nonnegative()
const points = z
  .array(z.number())
  .min(2)
  .max(20000)
  .refine((p) => p.length % 2 === 0, 'points must be x,y pairs')
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const strokeWidth = z.number().min(1).max(100)

const objectBase = {
  id: IdSchema,
  layerId: IdSchema,
  x: coord,
  y: coord,
  width: size,
  height: size,
  rotation: coord,
  zIndex: coord,
}

const serverFields = {
  ownerId: z.string(),
  version: z.number().int().nonnegative(),
  updatedBy: z.string(),
}

const imageFields = {
  type: z.literal('image'),
  assetKey: z.string().regex(/^[a-f0-9]{64}$/),
}

const strokeFields = {
  type: z.literal('stroke'),
  points,
  color,
  strokeWidth,
}

export const NewObjectSchema = z.discriminatedUnion('type', [
  z.object({ ...objectBase, ...imageFields }),
  z.object({ ...objectBase, ...strokeFields }),
])
export type NewObject = z.infer<typeof NewObjectSchema>

export const TableObjectSchema = z.discriminatedUnion('type', [
  z.object({ ...objectBase, ...serverFields, ...imageFields }),
  z.object({ ...objectBase, ...serverFields, ...strokeFields }),
])
export type TableObject = z.infer<typeof TableObjectSchema>
export type ImageObject = Extract<TableObject, { type: 'image' }>
export type StrokeObject = Extract<TableObject, { type: 'stroke' }>

export const ObjectPatchSchema = z
  .strictObject({
    layerId: IdSchema,
    x: coord,
    y: coord,
    width: size,
    height: size,
    rotation: coord,
    zIndex: coord,
    points,
    color,
    strokeWidth,
  })
  .partial()
export type ObjectPatch = z.infer<typeof ObjectPatchSchema>
```

`packages/shared/src/protocol.ts`:
```ts
import { z } from 'zod'
import {
  IdSchema,
  NewObjectSchema,
  ObjectPatchSchema,
  type Layer,
  type Member,
  type TableMetaPublic,
  type TableObject,
} from './model'

export const OpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), object: NewObjectSchema }),
  z.object({ kind: z.literal('update'), id: IdSchema, patch: ObjectPatchSchema }),
  z.object({ kind: z.literal('delete'), id: IdSchema }),
])
export type Op = z.infer<typeof OpSchema>

export const PresenceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('cursor'), x: z.number(), y: z.number() }),
  z.object({
    kind: z.literal('drag'),
    objectId: IdSchema,
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    rotation: z.number(),
  }),
  z.object({
    kind: z.literal('stroke'),
    strokeId: IdSchema,
    layerId: IdSchema,
    points: z.array(z.number()).max(4000).refine((p) => p.length % 2 === 0),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    strokeWidth: z.number().min(1).max(100),
  }),
  z.object({ kind: z.literal('strokeEnd'), strokeId: IdSchema }),
])
export type Presence = z.infer<typeof PresenceSchema>

const HelloSchema = z.object({
  t: z.literal('hello'),
  clientId: z.uuid(),
  nickname: z.string().trim().min(1).max(32),
  gmSecret: z.string().max(128).optional(),
})
export type HelloMessage = z.infer<typeof HelloSchema>

export const ClientMessageSchema = z.discriminatedUnion('t', [
  HelloSchema,
  z.object({ t: z.literal('op'), opId: z.string().min(1).max(64), op: OpSchema }),
  z.object({ t: z.literal('grab'), objectId: IdSchema }),
  z.object({ t: z.literal('release'), objectId: IdSchema }),
  z.object({ t: z.literal('presence'), p: PresenceSchema }),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>

export type AppliedOp = { kind: 'upsert'; object: TableObject } | { kind: 'delete'; id: string }

export type RejectReason = 'invalid' | 'not_found' | 'exists' | 'locked' | 'forbidden'

export interface LockInfo {
  objectId: string
  clientId: string
}

export interface Snapshot {
  meta: TableMetaPublic
  members: Member[]
  layers: Layer[]
  objects: TableObject[]
  locks: LockInfo[]
}

export type ServerMessage =
  | { t: 'welcome'; self: Member; snapshot: Snapshot }
  | { t: 'ack'; opId: string; version: number }
  | { t: 'reject'; opId: string; reason: RejectReason; current: TableObject | null }
  | { t: 'op'; op: AppliedOp; by: string }
  | { t: 'grabbed'; objectId: string; clientId: string }
  | { t: 'grabDenied'; objectId: string }
  | { t: 'released'; objectId: string; clientId: string }
  | { t: 'presence'; clientId: string; p: Presence }
  | { t: 'memberJoined'; member: Member }
  | { t: 'memberLeft'; clientId: string }
  | { t: 'error'; reason: 'table_not_found' }
```

`packages/shared/src/constants.ts`:
```ts
import type { Layer } from './model'

export const DEFAULT_LAYERS: Layer[] = [
  { id: 'map', name: 'Mapa', order: 0, visibility: 'all', locked: false },
  { id: 'tokens', name: 'Tokens', order: 1, visibility: 'all', locked: false },
  { id: 'drawings', name: 'Desenhos', order: 2, visibility: 'all', locked: false },
  { id: 'gm', name: 'Mestre', order: 3, visibility: 'gm', locked: false },
]

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
```

`packages/shared/src/index.ts`:
```ts
export * from './model'
export * from './protocol'
export * from './constants'
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/shared typecheck`
Expected: todos os testes PASS, sem erros de tipo.

- [ ] **Step 6: Checkpoint** — `pnpm test` verde.

---

### Task 2: Geometria compartilhada (simplificação de traços)

**Files:**
- Create: `packages/shared/src/geometry.ts`
- Modify: `packages/shared/src/index.ts` (adicionar export)
- Test: `packages/shared/test/geometry.test.ts`

**Interfaces:**
- Produces: `simplifyPoints(points: number[], tolerance: number): number[]`, `boundsOf(points: number[]): { minX: number; minY: number; width: number; height: number }`

- [ ] **Step 1: Teste falhando**

`packages/shared/test/geometry.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { boundsOf, simplifyPoints } from '../src'

describe('simplifyPoints', () => {
  it('reduz linha reta aos dois extremos', () => {
    expect(simplifyPoints([0, 0, 1, 0, 2, 0, 3, 0, 10, 0], 0.5)).toEqual([0, 0, 10, 0])
  })

  it('mantém o canto de um L', () => {
    expect(simplifyPoints([0, 0, 5, 0, 10, 0, 10, 5, 10, 10], 0.5)).toEqual([0, 0, 10, 0, 10, 10])
  })

  it('mantém ponto que desvia mais que a tolerância', () => {
    expect(simplifyPoints([0, 0, 5, 3, 10, 0], 1)).toEqual([0, 0, 5, 3, 10, 0])
  })

  it('descarta desvio menor que a tolerância', () => {
    expect(simplifyPoints([0, 0, 5, 0.4, 10, 0], 1)).toEqual([0, 0, 10, 0])
  })

  it('devolve cópia quando há 1 ou 2 pontos', () => {
    const one = [3, 4]
    const out = simplifyPoints(one, 1)
    expect(out).toEqual([3, 4])
    expect(out).not.toBe(one)
  })
})

describe('boundsOf', () => {
  it('calcula caixa envolvente', () => {
    expect(boundsOf([5, 10, -2, 3, 8, 1])).toEqual({ minX: -2, minY: 1, width: 10, height: 9 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/shared test`
Expected: FAIL — `simplifyPoints` não exportado.

- [ ] **Step 3: Implementar**

`packages/shared/src/geometry.ts`:
```ts
// Ramer–Douglas–Peucker iterativo sobre array plano [x0,y0,x1,y1,...].
export function simplifyPoints(points: number[], tolerance: number): number[] {
  const n = points.length / 2
  if (n <= 2) return points.slice()
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const tol2 = tolerance * tolerance
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length > 0) {
    const [a, b] = stack.pop()!
    let maxDist = -1
    let index = -1
    for (let i = a + 1; i < b; i++) {
      const d = segmentDistance2(points, i, a, b)
      if (d > maxDist) {
        maxDist = d
        index = i
      }
    }
    if (index !== -1 && maxDist > tol2) {
      keep[index] = 1
      stack.push([a, index], [index, b])
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(points[2 * i], points[2 * i + 1])
  return out
}

function segmentDistance2(p: number[], i: number, a: number, b: number): number {
  const px = p[2 * i], py = p[2 * i + 1]
  const ax = p[2 * a], ay = p[2 * a + 1]
  const bx = p[2 * b], by = p[2 * b + 1]
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx - px
  const cy = ay + t * dy - py
  return cx * cx + cy * cy
}

export function boundsOf(points: number[]): { minX: number; minY: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (let i = 0; i < points.length; i += 2) {
    minX = Math.min(minX, points[i])
    maxX = Math.max(maxX, points[i])
    minY = Math.min(minY, points[i + 1])
    maxY = Math.max(maxY, points[i + 1])
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}
```

Em `packages/shared/src/index.ts`, adicionar:
```ts
export * from './geometry'
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @mesa/shared test`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — `pnpm test` verde.

---
### Task 3: Worker — esqueleto + `TableEngine` (regras puras)

**Files:**
- Create: `apps/worker/package.json`, `apps/worker/tsconfig.json`, `apps/worker/wrangler.jsonc`, `apps/worker/vitest.config.ts`, `apps/worker/test/env.d.ts`
- Create: `apps/worker/src/engine/store.ts`, `apps/worker/src/engine/memory-store.ts`, `apps/worker/src/engine/engine.ts`
- Create: `apps/worker/src/index.ts` (stub mínimo para o wrangler subir; substituído no Task 4)
- Test: `apps/worker/test/engine.test.ts`

**Interfaces:**
- Consumes: tudo de `@mesa/shared` (Task 1).
- Produces:
  - `interface TableMeta { id: string; name: string; gmSecretHash: string; createdAt: number }`
  - `interface StoredMember { clientId: string; nickname: string; color: string; role: Role; lastSeenAt: number }`
  - `interface TableStore { getMeta(): TableMeta | null; initTable(meta: TableMeta, layers: Layer[]): void; getLayers(): Layer[]; getMember(clientId: string): StoredMember | null; upsertMember(m: StoredMember): void; listMembers(): StoredMember[]; getObject(id: string): TableObject | null; listObjects(): TableObject[]; putObject(o: TableObject): void; deleteObject(id: string): void; getAppliedOp(clientId: string, opId: string): number | null; recordAppliedOp(clientId: string, opId: string, version: number): void }`
  - `class MemoryStore implements TableStore`
  - `type OpResult = { ok: true; duplicate: true; version: number } | { ok: true; duplicate: false; version: number; before: TableObject | null; after: TableObject | null } | { ok: false; reason: RejectReason; current: TableObject | null }`
  - `class TableEngine(store: TableStore, now?: () => number)` com: `canSeeLayer(role, layerId): boolean`, `canEditLayer(role, layerId): boolean`, `canSeeObject(role, obj): boolean`, `join({ clientId, nickname, role }, online: Set<string>): Member`, `touchMember(clientId): void`, `snapshot(role, online: Set<string>): Snapshot`, `applyOp(clientId, role, opId, op): OpResult`, `grab(clientId, role, objectId): boolean`, `touchLock(clientId, objectId): boolean`, `release(clientId, objectId): boolean`, `releaseAll(clientId): string[]`, `activeLocks(): LockInfo[]`

- [ ] **Step 1: Esqueleto do worker**

`apps/worker/package.json`:
```json
{
  "name": "@mesa/worker",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "ensure-assets": "node -e \"require('fs').mkdirSync('../web/dist',{recursive:true})\"",
    "dev": "pnpm ensure-assets && wrangler dev",
    "test": "pnpm ensure-assets && vitest run",
    "types": "wrangler types",
    "typecheck": "tsc --noEmit",
    "deploy": "wrangler deploy"
  }
}
```

`apps/worker/wrangler.jsonc` (use como `compatibility_date` a data atual; se o wrangler instalado reclamar que a data é futura, use a que ele sugerir):
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "mesa-virtual",
  "main": "src/index.ts",
  "compatibility_date": "2026-10-01",
  "assets": {
    "directory": "../web/dist",
    "not_found_handling": "single-page-application",
    "run_worker_first": ["/api/*", "/files/*"]
  },
  "durable_objects": {
    "bindings": [{ "name": "TABLES", "class_name": "TableDO" }]
  },
  "migrations": [{ "tag": "v1", "new_sqlite_classes": ["TableDO"] }],
  "r2_buckets": [{ "binding": "FILES", "bucket_name": "mesa-virtual-files" }],
  "observability": { "enabled": true }
}
```

`apps/worker/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022"],
    "types": ["@cloudflare/vitest-pool-workers"]
  },
  "include": ["src", "test", "worker-configuration.d.ts"]
}
```

`apps/worker/vitest.config.ts`:
```ts
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config'

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        // WebSockets em Durable Objects não funcionam com isolatedStorage;
        // cada teste cria a própria mesa, então não há vazamento de estado.
        isolatedStorage: false,
        wrangler: { configPath: './wrangler.jsonc' },
      },
    },
  },
})
```

> Se a versão instalada de `@cloudflare/vitest-pool-workers` expuser outra API de configuração (ex.: um plugin no lugar de `defineWorkersConfig`), siga o README dela com as mesmas opções: `wrangler.configPath`, `singleWorker: true`, `isolatedStorage: false`. O código dos testes (`SELF`, `env` de `cloudflare:test`) não muda.

`apps/worker/test/env.d.ts`:
```ts
declare module 'cloudflare:test' {
  interface ProvidedEnv extends Env {}
}
```

`apps/worker/src/index.ts` (stub temporário):
```ts
export { TableDO } from './table-do'

export default {
  async fetch(): Promise<Response> {
    return new Response('not found', { status: 404 })
  },
} satisfies ExportedHandler<Env>
```

`apps/worker/src/table-do.ts` (stub temporário, substituído no Task 4):
```ts
import { DurableObject } from 'cloudflare:workers'

export class TableDO extends DurableObject<Env> {}
```

Run:
```bash
pnpm --filter @mesa/worker add @mesa/shared@workspace:*
pnpm --filter @mesa/worker add -D wrangler typescript @cloudflare/vitest-pool-workers
pnpm --filter @mesa/worker exec npm view @cloudflare/vitest-pool-workers peerDependencies
# instale a versão de vitest exigida no peerDependencies acima, ex.:
pnpm --filter @mesa/worker add -D vitest@<versão-do-peer>
pnpm --filter @mesa/worker types
```
Expected: `apps/worker/worker-configuration.d.ts` gerado, contendo `interface Env` com `TABLES` e `FILES`.

- [ ] **Step 2: Interface de store e store em memória**

`apps/worker/src/engine/store.ts`:
```ts
import type { Layer, Role, TableObject } from '@mesa/shared'

export interface TableMeta {
  id: string
  name: string
  gmSecretHash: string
  createdAt: number
}

export interface StoredMember {
  clientId: string
  nickname: string
  color: string
  role: Role
  lastSeenAt: number
}

export interface TableStore {
  getMeta(): TableMeta | null
  initTable(meta: TableMeta, layers: Layer[]): void
  getLayers(): Layer[]
  getMember(clientId: string): StoredMember | null
  upsertMember(member: StoredMember): void
  listMembers(): StoredMember[]
  getObject(id: string): TableObject | null
  listObjects(): TableObject[]
  putObject(object: TableObject): void
  deleteObject(id: string): void
  getAppliedOp(clientId: string, opId: string): number | null
  recordAppliedOp(clientId: string, opId: string, version: number): void
}
```

`apps/worker/src/engine/memory-store.ts`:
```ts
import { APPLIED_OPS_KEEP, type Layer, type TableObject } from '@mesa/shared'
import type { StoredMember, TableMeta, TableStore } from './store'

export class MemoryStore implements TableStore {
  private meta: TableMeta | null = null
  private layers: Layer[] = []
  private members = new Map<string, StoredMember>()
  private objects = new Map<string, TableObject>()
  private applied = new Map<string, number>()
  private appliedOrder = new Map<string, string[]>()

  getMeta() { return this.meta }

  initTable(meta: TableMeta, layers: Layer[]) {
    this.meta = meta
    this.layers = layers.map((l) => ({ ...l }))
  }

  getLayers() { return [...this.layers].sort((a, b) => a.order - b.order) }
  getMember(clientId: string) { return this.members.get(clientId) ?? null }
  upsertMember(member: StoredMember) { this.members.set(member.clientId, { ...member }) }
  listMembers() { return [...this.members.values()] }
  getObject(id: string) { return this.objects.get(id) ?? null }
  listObjects() { return [...this.objects.values()] }
  putObject(object: TableObject) { this.objects.set(object.id, object) }
  deleteObject(id: string) { this.objects.delete(id) }

  getAppliedOp(clientId: string, opId: string) {
    return this.applied.get(`${clientId}:${opId}`) ?? null
  }

  recordAppliedOp(clientId: string, opId: string, version: number) {
    this.applied.set(`${clientId}:${opId}`, version)
    const order = this.appliedOrder.get(clientId) ?? []
    order.push(opId)
    while (order.length > APPLIED_OPS_KEEP) this.applied.delete(`${clientId}:${order.shift()}`)
    this.appliedOrder.set(clientId, order)
  }
}
```

- [ ] **Step 3: Teste do engine (falhando)**

`apps/worker/test/engine.test.ts`:
```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, LOCK_TTL_MS, type NewObject, type Op } from '@mesa/shared'
import { MemoryStore } from '../src/engine/memory-store'
import { TableEngine } from '../src/engine/engine'

let clock = 1_000
let store: MemoryStore
let engine: TableEngine

const token = (over: Partial<NewObject> = {}): NewObject =>
  ({
    id: 'tok1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
    x: 10, y: 20, width: 70, height: 70, rotation: 0, zIndex: 1, ...over,
  }) as NewObject

const create = (o: NewObject): Op => ({ kind: 'create', object: o })

beforeEach(() => {
  clock = 1_000
  store = new MemoryStore()
  store.initTable({ id: 'T', name: 'Mesa', gmSecretHash: 'h', createdAt: 0 }, DEFAULT_LAYERS)
  engine = new TableEngine(store, () => clock)
})

describe('applyOp create', () => {
  it('cria com version 1 e dono = autor', () => {
    const r = engine.applyOp('A', 'player', 'op1', create(token()))
    expect(r).toMatchObject({ ok: true, duplicate: false, version: 1 })
    expect(store.getObject('tok1')).toMatchObject({ ownerId: 'A', updatedBy: 'A', version: 1 })
  })

  it('opId repetido não reaplica', () => {
    engine.applyOp('A', 'player', 'op1', create(token()))
    const r = engine.applyOp('A', 'player', 'op1', create(token()))
    expect(r).toEqual({ ok: true, duplicate: true, version: 1 })
  })

  it('id existente é rejeitado com exists', () => {
    engine.applyOp('A', 'player', 'op1', create(token()))
    expect(engine.applyOp('B', 'player', 'op2', create(token()))).toMatchObject({ ok: false, reason: 'exists' })
  })

  it('jogador não cria na camada do mestre', () => {
    expect(engine.applyOp('A', 'player', 'op1', create(token({ layerId: 'gm' })))).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('mestre cria na camada do mestre', () => {
    expect(engine.applyOp('G', 'gm', 'op1', create(token({ layerId: 'gm' })))).toMatchObject({ ok: true })
  })

  it('camada inexistente é forbidden', () => {
    expect(engine.applyOp('A', 'player', 'op1', create(token({ layerId: 'nope' })))).toMatchObject({ ok: false, reason: 'forbidden' })
  })
})

describe('applyOp update/delete', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('mescla patch e incrementa version', () => {
    const r = engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'tok1', patch: { x: 99 } })
    expect(r).toMatchObject({ ok: true, version: 2 })
    expect(store.getObject('tok1')).toMatchObject({ x: 99, y: 20, version: 2, updatedBy: 'B', ownerId: 'A' })
  })

  it('patch inválido para o tipo é descartado ou rejeitado sem corromper', () => {
    engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'tok1', patch: { color: '#ffffff' } })
    expect(store.getObject('tok1')).not.toHaveProperty('color')
  })

  it('objeto inexistente → not_found', () => {
    expect(engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'zzz', patch: { x: 1 } })).toMatchObject({ ok: false, reason: 'not_found', current: null })
  })

  it('jogador não move objeto para a camada do mestre', () => {
    expect(engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'tok1', patch: { layerId: 'gm' } })).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('jogador não enxerga objeto da camada do mestre (not_found)', () => {
    engine.applyOp('G', 'gm', 'opg', create(token({ id: 'secret', layerId: 'gm' })))
    expect(engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'secret', patch: { x: 1 } })).toMatchObject({ ok: false, reason: 'not_found', current: null })
  })

  it('delete remove e retorna before', () => {
    const r = engine.applyOp('B', 'player', 'op1', { kind: 'delete', id: 'tok1' })
    expect(r).toMatchObject({ ok: true, after: null, before: { id: 'tok1' } })
    expect(store.getObject('tok1')).toBeNull()
  })
})

describe('travas', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('outro cliente não altera objeto travado', () => {
    expect(engine.grab('A', 'player', 'tok1')).toBe(true)
    expect(engine.grab('B', 'player', 'tok1')).toBe(false)
    expect(engine.applyOp('B', 'player', 'op1', { kind: 'update', id: 'tok1', patch: { x: 1 } })).toMatchObject({ ok: false, reason: 'locked' })
    expect(engine.applyOp('A', 'player', 'op2', { kind: 'update', id: 'tok1', patch: { x: 1 } })).toMatchObject({ ok: true })
  })

  it('trava expira após LOCK_TTL_MS', () => {
    engine.grab('A', 'player', 'tok1')
    clock += LOCK_TTL_MS + 1
    expect(engine.grab('B', 'player', 'tok1')).toBe(true)
  })

  it('touchLock renova só para o dono', () => {
    engine.grab('A', 'player', 'tok1')
    clock += LOCK_TTL_MS - 1
    expect(engine.touchLock('B', 'tok1')).toBe(false)
    expect(engine.touchLock('A', 'tok1')).toBe(true)
    clock += LOCK_TTL_MS - 1
    expect(engine.grab('B', 'player', 'tok1')).toBe(false)
  })

  it('release só pelo dono; releaseAll devolve ids', () => {
    engine.grab('A', 'player', 'tok1')
    expect(engine.release('B', 'tok1')).toBe(false)
    expect(engine.releaseAll('A')).toEqual(['tok1'])
    expect(engine.activeLocks()).toEqual([])
  })

  it('delete libera a trava do objeto', () => {
    engine.grab('A', 'player', 'tok1')
    engine.applyOp('A', 'player', 'op1', { kind: 'delete', id: 'tok1' })
    expect(engine.activeLocks()).toEqual([])
  })
})

describe('membros e snapshot', () => {
  it('cores distintas para membros online; quem volta mantém a cor', () => {
    const a = engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    const b = engine.join({ clientId: 'B', nickname: 'Bia', role: 'player' }, new Set(['A']))
    expect(a.color).not.toBe(b.color)
    const a2 = engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set(['B']))
    expect(a2.color).toBe(a.color)
  })

  it('snapshot do jogador omite camada e objetos do mestre', () => {
    engine.applyOp('G', 'gm', 'op1', create(token({ id: 'secret', layerId: 'gm' })))
    engine.applyOp('A', 'player', 'op2', create(token({ id: 'pub' })))
    const s = engine.snapshot('player', new Set())
    expect(s.layers.map((l) => l.id)).toEqual(['map', 'tokens', 'drawings'])
    expect(s.objects.map((o) => o.id)).toEqual(['pub'])
    const g = engine.snapshot('gm', new Set())
    expect(g.layers).toHaveLength(4)
    expect(g.objects).toHaveLength(2)
  })

  it('snapshot marca online conforme o conjunto recebido', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    engine.join({ clientId: 'B', nickname: 'Bia', role: 'player' }, new Set())
    const s = engine.snapshot('player', new Set(['A']))
    expect(s.members.find((m) => m.clientId === 'A')?.online).toBe(true)
    expect(s.members.find((m) => m.clientId === 'B')?.online).toBe(false)
  })
})
```

- [ ] **Step 4: Rodar e ver falhar**

Run: `pnpm --filter @mesa/worker test -- test/engine.test.ts`
Expected: FAIL — `../src/engine/engine` não existe.

- [ ] **Step 5: Implementar o engine**

`apps/worker/src/engine/engine.ts`:
```ts
import {
  LOCK_TTL_MS,
  MEMBER_COLORS,
  TableObjectSchema,
  type Layer,
  type LockInfo,
  type Member,
  type Op,
  type RejectReason,
  type Role,
  type Snapshot,
  type TableObject,
} from '@mesa/shared'
import type { StoredMember, TableStore } from './store'

export type OpResult =
  | { ok: true; duplicate: true; version: number }
  | { ok: true; duplicate: false; version: number; before: TableObject | null; after: TableObject | null }
  | { ok: false; reason: RejectReason; current: TableObject | null }

interface Lock {
  clientId: string
  expiresAt: number
}

const reject = (reason: RejectReason, current: TableObject | null): OpResult => ({ ok: false, reason, current })

export class TableEngine {
  // Travas ficam só em memória: se o DO hibernar, elas somem — aceitável, pois expiram em 10 s.
  private locks = new Map<string, Lock>()

  constructor(
    private store: TableStore,
    private now: () => number = Date.now,
  ) {}

  private layer(id: string): Layer | null {
    return this.store.getLayers().find((l) => l.id === id) ?? null
  }

  canSeeLayer(role: Role, layerId: string): boolean {
    const layer = this.layer(layerId)
    return !!layer && (layer.visibility === 'all' || role === 'gm')
  }

  canEditLayer(role: Role, layerId: string): boolean {
    const layer = this.layer(layerId)
    return !!layer && this.canSeeLayer(role, layerId) && (!layer.locked || role === 'gm')
  }

  canSeeObject(role: Role, object: TableObject): boolean {
    return this.canSeeLayer(role, object.layerId)
  }

  join(input: { clientId: string; nickname: string; role: Role }, online: Set<string>): Member {
    const existing = this.store.getMember(input.clientId)
    const usedByOthers = new Set(
      this.store
        .listMembers()
        .filter((m) => m.clientId !== input.clientId && online.has(m.clientId))
        .map((m) => m.color),
    )
    const color =
      existing && !usedByOthers.has(existing.color)
        ? existing.color
        : (MEMBER_COLORS.find((c) => !usedByOthers.has(c)) ?? MEMBER_COLORS[usedByOthers.size % MEMBER_COLORS.length])
    const stored: StoredMember = { ...input, color, lastSeenAt: this.now() }
    this.store.upsertMember(stored)
    return { clientId: input.clientId, nickname: input.nickname, color, role: input.role, online: true }
  }

  touchMember(clientId: string): void {
    const m = this.store.getMember(clientId)
    if (m) this.store.upsertMember({ ...m, lastSeenAt: this.now() })
  }

  snapshot(role: Role, online: Set<string>): Snapshot {
    const meta = this.store.getMeta()!
    return {
      meta: { id: meta.id, name: meta.name },
      members: this.store.listMembers().map((m) => ({
        clientId: m.clientId,
        nickname: m.nickname,
        color: m.color,
        role: m.role,
        online: online.has(m.clientId),
      })),
      layers: this.store.getLayers().filter((l) => this.canSeeLayer(role, l.id)),
      objects: this.store.listObjects().filter((o) => this.canSeeObject(role, o)),
      locks: this.activeLocks().filter((l) => {
        const o = this.store.getObject(l.objectId)
        return !!o && this.canSeeObject(role, o)
      }),
    }
  }

  applyOp(clientId: string, role: Role, opId: string, op: Op): OpResult {
    const duplicate = this.store.getAppliedOp(clientId, opId)
    if (duplicate !== null) return { ok: true, duplicate: true, version: duplicate }
    const result = this.execute(clientId, role, op)
    if (result.ok) this.store.recordAppliedOp(clientId, opId, result.version)
    return result
  }

  private execute(clientId: string, role: Role, op: Op): OpResult {
    if (op.kind === 'create') {
      const { object } = op
      if (!this.canEditLayer(role, object.layerId)) return reject('forbidden', null)
      const existing = this.store.getObject(object.id)
      if (existing) return reject('exists', this.canSeeObject(role, existing) ? existing : null)
      const after = { ...object, ownerId: clientId, version: 1, updatedBy: clientId } as TableObject
      this.store.putObject(after)
      return { ok: true, duplicate: false, version: 1, before: null, after }
    }

    const before = this.store.getObject(op.id)
    if (!before || !this.canSeeObject(role, before)) return reject('not_found', null)
    if (!this.canEditLayer(role, before.layerId)) return reject('forbidden', before)
    if (this.lockHeldByOther(op.id, clientId)) return reject('locked', before)

    if (op.kind === 'delete') {
      this.store.deleteObject(op.id)
      this.locks.delete(op.id)
      return { ok: true, duplicate: false, version: 0, before, after: null }
    }

    if (op.patch.layerId !== undefined && !this.canEditLayer(role, op.patch.layerId)) return reject('forbidden', before)
    const parsed = TableObjectSchema.safeParse({
      ...before,
      ...op.patch,
      version: before.version + 1,
      updatedBy: clientId,
    })
    if (!parsed.success) return reject('invalid', before)
    this.store.putObject(parsed.data)
    return { ok: true, duplicate: false, version: parsed.data.version, before, after: parsed.data }
  }

  grab(clientId: string, role: Role, objectId: string): boolean {
    const object = this.store.getObject(objectId)
    if (!object || !this.canEditLayer(role, object.layerId)) return false
    if (this.lockHeldByOther(objectId, clientId)) return false
    this.locks.set(objectId, { clientId, expiresAt: this.now() + LOCK_TTL_MS })
    return true
  }

  touchLock(clientId: string, objectId: string): boolean {
    const lock = this.locks.get(objectId)
    if (!lock || lock.clientId !== clientId || lock.expiresAt <= this.now()) return false
    lock.expiresAt = this.now() + LOCK_TTL_MS
    return true
  }

  release(clientId: string, objectId: string): boolean {
    const lock = this.locks.get(objectId)
    if (!lock || lock.clientId !== clientId) return false
    this.locks.delete(objectId)
    return true
  }

  releaseAll(clientId: string): string[] {
    const released: string[] = []
    for (const [objectId, lock] of this.locks) {
      if (lock.clientId === clientId) {
        this.locks.delete(objectId)
        released.push(objectId)
      }
    }
    return released
  }

  activeLocks(): LockInfo[] {
    const now = this.now()
    const out: LockInfo[] = []
    for (const [objectId, lock] of this.locks) {
      if (lock.expiresAt > now) out.push({ objectId, clientId: lock.clientId })
      else this.locks.delete(objectId)
    }
    return out
  }

  private lockHeldByOther(objectId: string, clientId: string): boolean {
    const lock = this.locks.get(objectId)
    if (!lock) return false
    if (lock.expiresAt <= this.now()) {
      this.locks.delete(objectId)
      return false
    }
    return lock.clientId !== clientId
  }
}
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @mesa/worker test -- test/engine.test.ts && pnpm --filter @mesa/worker typecheck`
Expected: PASS, sem erros de tipo.

- [ ] **Step 7: Checkpoint** — `pnpm test` verde.

---

### Task 4: Worker — `SqlStore`, Durable Object `TableDO` e rotas de mesa

**Files:**
- Create: `apps/worker/src/engine/sql-store.ts`, `apps/worker/src/crypto.ts`
- Modify (substituir inteiro): `apps/worker/src/table-do.ts`, `apps/worker/src/index.ts`
- Create: `apps/worker/test/helpers.ts`
- Test: `apps/worker/test/table-do.test.ts`

**Interfaces:**
- Consumes: `TableEngine`, `TableStore`, `TableMeta` (Task 3); `ClientMessageSchema`, `ServerMessage`, `DEFAULT_LAYERS`, `TABLE_ID_RE` (Task 1).
- Produces:
  - HTTP `POST /api/tables` body `{ name?: string }` → `201 { tableId: string, gmSecret: string }`
  - HTTP `GET /api/tables/:id/ws` (Upgrade) → WebSocket do protocolo
  - `sha256Hex(data: string | ArrayBuffer): Promise<string>`, `randomId(len?: number): string`, `randomSecret(): string`, `safeEqual(a: string, b: string): boolean`
  - O roteamento fica todo em `index.ts`; o Task 5 adiciona `files.ts` e duas rotas ao roteador.
  - Helpers de teste: `createTable(name?)`, `TestClient.connect(tableId)`, `client.hello(nickname, { clientId?, gmSecret? })`, `client.send(msg | string)`, `client.waitFor(t, pred?)`, `client.expectNone(t, pred?, ms?)`, `client.close()`, `tokenObject(over?)`

- [ ] **Step 1: SqlStore**

`apps/worker/src/engine/sql-store.ts`:
```ts
import { APPLIED_OPS_KEEP, type Layer, type TableObject } from '@mesa/shared'
import type { StoredMember, TableMeta, TableStore } from './store'

export class SqlStore implements TableStore {
  constructor(private sql: SqlStorage) {
    sql.exec('CREATE TABLE IF NOT EXISTS meta (id TEXT PRIMARY KEY, name TEXT NOT NULL, gm_secret_hash TEXT NOT NULL, created_at INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS layers (id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS members (client_id TEXT PRIMARY KEY, data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS objects (id TEXT PRIMARY KEY, layer_id TEXT NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL, version INTEGER NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS applied_ops (seq INTEGER PRIMARY KEY, client_id TEXT NOT NULL, op_id TEXT NOT NULL, version INTEGER NOT NULL, UNIQUE(client_id, op_id))')
  }

  getMeta(): TableMeta | null {
    const row = this.sql
      .exec<{ id: string; name: string; gm_secret_hash: string; created_at: number }>('SELECT * FROM meta LIMIT 1')
      .toArray()[0]
    return row ? { id: row.id, name: row.name, gmSecretHash: row.gm_secret_hash, createdAt: row.created_at } : null
  }

  initTable(meta: TableMeta, layers: Layer[]): void {
    this.sql.exec('INSERT INTO meta (id, name, gm_secret_hash, created_at) VALUES (?, ?, ?, ?)', meta.id, meta.name, meta.gmSecretHash, meta.createdAt)
    for (const layer of layers) this.sql.exec('INSERT INTO layers (id, data) VALUES (?, ?)', layer.id, JSON.stringify(layer))
  }

  getLayers(): Layer[] {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM layers')
      .toArray()
      .map((r) => JSON.parse(r.data) as Layer)
      .sort((a, b) => a.order - b.order)
  }

  getMember(clientId: string): StoredMember | null {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM members WHERE client_id = ?', clientId).toArray()[0]
    return row ? (JSON.parse(row.data) as StoredMember) : null
  }

  upsertMember(member: StoredMember): void {
    this.sql.exec('INSERT OR REPLACE INTO members (client_id, data) VALUES (?, ?)', member.clientId, JSON.stringify(member))
  }

  listMembers(): StoredMember[] {
    return this.sql.exec<{ data: string }>('SELECT data FROM members').toArray().map((r) => JSON.parse(r.data) as StoredMember)
  }

  getObject(id: string): TableObject | null {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM objects WHERE id = ?', id).toArray()[0]
    return row ? (JSON.parse(row.data) as TableObject) : null
  }

  listObjects(): TableObject[] {
    return this.sql.exec<{ data: string }>('SELECT data FROM objects').toArray().map((r) => JSON.parse(r.data) as TableObject)
  }

  putObject(object: TableObject): void {
    this.sql.exec(
      'INSERT OR REPLACE INTO objects (id, layer_id, type, data, version) VALUES (?, ?, ?, ?, ?)',
      object.id, object.layerId, object.type, JSON.stringify(object), object.version,
    )
  }

  deleteObject(id: string): void {
    this.sql.exec('DELETE FROM objects WHERE id = ?', id)
  }

  getAppliedOp(clientId: string, opId: string): number | null {
    const row = this.sql
      .exec<{ version: number }>('SELECT version FROM applied_ops WHERE client_id = ? AND op_id = ?', clientId, opId)
      .toArray()[0]
    return row ? row.version : null
  }

  recordAppliedOp(clientId: string, opId: string, version: number): void {
    this.sql.exec('INSERT OR IGNORE INTO applied_ops (client_id, op_id, version) VALUES (?, ?, ?)', clientId, opId, version)
    this.sql.exec(
      'DELETE FROM applied_ops WHERE client_id = ? AND seq <= (SELECT seq FROM applied_ops WHERE client_id = ? ORDER BY seq DESC LIMIT 1 OFFSET ?)',
      clientId, clientId, APPLIED_OPS_KEEP,
    )
  }
}
```

- [ ] **Step 2: Utilitários de criptografia**

`apps/worker/src/crypto.ts`:
```ts
const BASE62 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'

export async function sha256Hex(data: string | ArrayBuffer): Promise<string> {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

export function randomId(length = 10): string {
  const out: string[] = []
  while (out.length < length) {
    for (const b of crypto.getRandomValues(new Uint8Array(length * 2))) {
      // rejeita bytes >= 248 para não enviesar o módulo 62
      if (b < 248 && out.length < length) out.push(BASE62[b % 62])
    }
  }
  return out.join('')
}

export function randomSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}
```

- [ ] **Step 3: Helpers de teste**

`apps/worker/test/helpers.ts`:
```ts
import { SELF } from 'cloudflare:test'
import { expect } from 'vitest'
import type { ClientMessage, NewObject, ServerMessage } from '@mesa/shared'

const BASE = 'https://mesa.test'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function createTable(name = 'Teste'): Promise<{ tableId: string; gmSecret: string }> {
  const res = await SELF.fetch(`${BASE}/api/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  expect(res.status).toBe(201)
  return res.json()
}

export function tokenObject(over: Partial<NewObject> = {}): NewObject {
  return {
    id: `tok_${crypto.randomUUID().slice(0, 8)}`,
    type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
    x: 10, y: 20, width: 70, height: 70, rotation: 0, zIndex: 1,
    ...over,
  } as NewObject
}

type Msg<T extends ServerMessage['t']> = Extract<ServerMessage, { t: T }>

export class TestClient {
  readonly messages: ServerMessage[] = []
  private consumed = new Set<number>()

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      this.messages.push(JSON.parse(e.data as string) as ServerMessage)
    })
  }

  static async connect(tableId: string): Promise<TestClient> {
    const res = await SELF.fetch(`${BASE}/api/tables/${tableId}/ws`, { headers: { Upgrade: 'websocket' } })
    const ws = res.webSocket
    if (!ws) throw new Error(`no websocket (status ${res.status})`)
    ws.accept()
    return new TestClient(ws)
  }

  send(msg: ClientMessage | string): void {
    this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg))
  }

  async hello(nickname: string, opts: { clientId?: string; gmSecret?: string } = {}) {
    const clientId = opts.clientId ?? crypto.randomUUID()
    this.send({ t: 'hello', clientId, nickname, ...(opts.gmSecret ? { gmSecret: opts.gmSecret } : {}) })
    const welcome = await this.waitFor('welcome')
    return { clientId, welcome }
  }

  async waitFor<T extends ServerMessage['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true): Promise<Msg<T>> {
    for (let i = 0; i < 200; i++) {
      const index = this.messages.findIndex((m, idx) => !this.consumed.has(idx) && m.t === t && pred(m as Msg<T>))
      if (index !== -1) {
        this.consumed.add(index)
        return this.messages[index] as Msg<T>
      }
      await sleep(10)
    }
    throw new Error(`timeout esperando ${t}`)
  }

  async expectNone<T extends ServerMessage['t']>(t: T, pred: (m: Msg<T>) => boolean = () => true, ms = 300): Promise<void> {
    await sleep(ms)
    const found = this.messages.some((m, idx) => !this.consumed.has(idx) && m.t === t && pred(m as Msg<T>))
    expect(found, `não esperava ${t}`).toBe(false)
  }

  close(): void {
    this.ws.close(1000, 'test')
  }
}
```

- [ ] **Step 4: Testes do DO (falhando)**

`apps/worker/test/table-do.test.ts`:
```ts
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { TestClient, createTable, tokenObject } from './helpers'

describe('TableDO', () => {
  it('mestre recebe 4 camadas; jogador 3; segredo errado vira jogador', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const { welcome: w1 } = await gm.hello('Mestre', { gmSecret })
    expect(w1.self.role).toBe('gm')
    expect(w1.snapshot.layers).toHaveLength(4)
    expect(w1.snapshot.meta.name).toBe('Teste')

    const p = await TestClient.connect(tableId)
    const { welcome: w2 } = await p.hello('Ana', { gmSecret: 'errado' })
    expect(w2.self.role).toBe('player')
    expect(w2.snapshot.layers.map((l) => l.id)).toEqual(['map', 'tokens', 'drawings'])
  })

  it('create gera ack para o autor e op para os outros', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    const { clientId } = await a.hello('Ana')
    await b.hello('Bia')
    const obj = tokenObject()
    a.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    expect(await a.waitFor('ack')).toEqual({ t: 'ack', opId: 'op_1', version: 1 })
    const op = await b.waitFor('op')
    expect(op.by).toBe(clientId)
    expect(op.op).toMatchObject({ kind: 'upsert', object: { id: obj.id, ownerId: clientId } })
    await a.expectNone('op')
  })

  it('opId repetido recebe ack sem retransmitir', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    await a.hello('Ana')
    await b.hello('Bia')
    const msg = { t: 'op' as const, opId: 'op_1', op: { kind: 'create' as const, object: tokenObject() } }
    a.send(msg)
    await a.waitFor('ack')
    await b.waitFor('op')
    a.send(msg)
    await a.waitFor('ack')
    await b.expectNone('op')
  })

  it('jogador é rejeitado na camada do mestre e não vê objetos dela', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    p.send({ t: 'op', opId: 'op_p', op: { kind: 'create', object: tokenObject({ layerId: 'gm' }) } })
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_p', reason: 'forbidden' })
    gm.send({ t: 'op', opId: 'op_g', op: { kind: 'create', object: tokenObject({ layerId: 'gm' }) } })
    await gm.waitFor('ack')
    await p.expectNone('op')
  })

  // Review Focus #2
  it('mover objeto entre camada do mestre e pública faz aparecer/sumir para o jogador', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    const obj = tokenObject({ layerId: 'gm' })
    gm.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await gm.waitFor('ack')
    gm.send({ t: 'op', opId: 'op_2', op: { kind: 'update', id: obj.id, patch: { layerId: 'tokens' } } })
    expect((await p.waitFor('op')).op).toMatchObject({ kind: 'upsert', object: { id: obj.id, layerId: 'tokens' } })
    gm.send({ t: 'op', opId: 'op_3', op: { kind: 'update', id: obj.id, patch: { layerId: 'gm' } } })
    expect((await p.waitFor('op')).op).toEqual({ kind: 'delete', id: obj.id })
  })

  it('trava: segundo grab é negado; desconexão do dono libera e avisa saída', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    const { clientId: aId } = await a.hello('Ana')
    await b.hello('Bia')
    const obj = tokenObject()
    a.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await a.waitFor('ack')
    a.send({ t: 'grab', objectId: obj.id })
    expect(await b.waitFor('grabbed')).toEqual({ t: 'grabbed', objectId: obj.id, clientId: aId })
    b.send({ t: 'grab', objectId: obj.id })
    expect(await b.waitFor('grabDenied')).toEqual({ t: 'grabDenied', objectId: obj.id })
    b.send({ t: 'op', opId: 'op_b', op: { kind: 'update', id: obj.id, patch: { x: 1 } } })
    expect(await b.waitFor('reject')).toMatchObject({ reason: 'locked' })
    a.close()
    expect(await b.waitFor('released')).toEqual({ t: 'released', objectId: obj.id, clientId: aId })
    expect(await b.waitFor('memberLeft')).toEqual({ t: 'memberLeft', clientId: aId })
  })

  // Review Focus #1
  it('mesma pessoa em duas abas: fechar uma não gera memberLeft nem solta a trava', async () => {
    const { tableId } = await createTable()
    const tab1 = await TestClient.connect(tableId)
    const tab2 = await TestClient.connect(tableId)
    const other = await TestClient.connect(tableId)
    const { clientId } = await tab1.hello('Ana')
    await tab2.hello('Ana', { clientId })
    await other.hello('Bia')
    const obj = tokenObject()
    tab1.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await tab1.waitFor('ack')
    tab2.send({ t: 'grab', objectId: obj.id })
    await other.waitFor('grabbed')
    tab1.close()
    await other.expectNone('memberLeft')
    await other.expectNone('released')
    tab2.close()
    expect(await other.waitFor('memberLeft')).toEqual({ t: 'memberLeft', clientId })
  })

  // Review Focus #4
  it('ignora lixo e mensagens antes do hello; hello válido depois funciona', async () => {
    const { tableId } = await createTable()
    const c = await TestClient.connect(tableId)
    c.send('isto não é json')
    c.send({ t: 'op', opId: 'op_x', op: { kind: 'create', object: tokenObject() } })
    c.send(JSON.stringify({ t: 'hello', clientId: crypto.randomUUID(), nickname: '   ' }))
    await c.expectNone('welcome')
    await c.expectNone('ack')
    const { welcome } = await c.hello('Ana')
    expect(welcome.snapshot.objects).toEqual([])
  })

  it('mesa inexistente recebe error', async () => {
    const c = await TestClient.connect('ZZZZZZZZZZ')
    expect(await c.waitFor('error')).toEqual({ t: 'error', reason: 'table_not_found' })
  })

  it('estado persiste após todos saírem', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    await a.hello('Ana')
    const obj = tokenObject()
    a.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await a.waitFor('ack')
    a.close()
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Ana')
    expect(welcome.snapshot.objects.map((o) => o.id)).toEqual([obj.id])
  })

  it('presença de cursor chega aos outros, não ao autor', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    const { clientId } = await a.hello('Ana')
    await b.hello('Bia')
    a.send({ t: 'presence', p: { kind: 'cursor', x: 5, y: 6 } })
    expect(await b.waitFor('presence')).toEqual({ t: 'presence', clientId, p: { kind: 'cursor', x: 5, y: 6 } })
    await a.expectNone('presence')
  })

  it('POST /api/tables recusa id malformado em rotas e cria com nome padrão', async () => {
    const bad = await SELF.fetch('https://mesa.test/api/tables/abc/ws', { headers: { Upgrade: 'websocket' } })
    expect(bad.status).toBe(400)
    const res = await SELF.fetch('https://mesa.test/api/tables', { method: 'POST' })
    expect(res.status).toBe(201)
    const body = await res.json<{ tableId: string; gmSecret: string }>()
    expect(body.tableId).toMatch(/^[A-Za-z0-9]{10}$/)
    expect(body.gmSecret.length).toBeGreaterThanOrEqual(43)
  })
})
```

- [ ] **Step 5: Rodar e ver falhar**

Run: `pnpm --filter @mesa/worker test -- test/table-do.test.ts`
Expected: FAIL — `POST /api/tables` responde 404 (stub).

- [ ] **Step 6: Implementar o Durable Object**

`apps/worker/src/table-do.ts` (substitui o stub):
```ts
import { DurableObject } from 'cloudflare:workers'
import {
  ClientMessageSchema,
  DEFAULT_LAYERS,
  type ClientMessage,
  type Role,
  type ServerMessage,
} from '@mesa/shared'
import { TableEngine } from './engine/engine'
import { SqlStore } from './engine/sql-store'
import { safeEqual, sha256Hex } from './crypto'

interface Attachment {
  sessionId: string
  clientId: string
  role: Role
}

type Msg<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>

export class TableDO extends DurableObject<Env> {
  private store: SqlStore
  private engine: TableEngine

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new SqlStore(ctx.storage.sql)
    this.engine = new TableEngine(this.store)
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url)

    if (url.pathname === '/init' && request.method === 'POST') {
      if (this.store.getMeta()) return new Response('exists', { status: 409 })
      const body = await request.json<{ id: string; name: string; gmSecretHash: string }>()
      this.store.initTable({ ...body, createdAt: Date.now() }, DEFAULT_LAYERS)
      return new Response(null, { status: 201 })
    }

    if (url.pathname === '/exists') {
      return new Response(null, { status: this.store.getMeta() ? 204 : 404 })
    }

    if (url.pathname === '/ws') {
      if (request.headers.get('Upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 })
      const pair = new WebSocketPair()
      const [client, server] = Object.values(pair)
      this.ctx.acceptWebSocket(server)
      if (!this.store.getMeta()) {
        this.send(server, { t: 'error', reason: 'table_not_found' })
        server.close(4404, 'table_not_found')
      }
      return new Response(null, { status: 101, webSocket: client })
    }

    return new Response('not found', { status: 404 })
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    if (typeof raw !== 'string') return
    let json: unknown
    try {
      json = JSON.parse(raw)
    } catch {
      return
    }
    const parsed = ClientMessageSchema.safeParse(json)
    if (!parsed.success) {
      console.warn('mensagem inválida', parsed.error.issues[0]?.message)
      return
    }
    const msg = parsed.data
    const att = this.attachment(ws)
    if (msg.t === 'hello') {
      if (!att) await this.onHello(ws, msg)
      return
    }
    if (!att) return
    switch (msg.t) {
      case 'op': return this.onOp(ws, att, msg)
      case 'grab': return this.onGrab(ws, att, msg)
      case 'release': return this.onRelease(att, msg)
      case 'presence': return this.onPresence(att, msg)
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    this.onDisconnect(ws)
    try {
      ws.close(1000, 'bye')
    } catch {
      // já fechado
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.onDisconnect(ws)
  }

  private async onHello(ws: WebSocket, msg: Msg<'hello'>): Promise<void> {
    const meta = this.store.getMeta()
    if (!meta) return
    let role: Role = 'player'
    if (msg.gmSecret && safeEqual(await sha256Hex(msg.gmSecret), meta.gmSecretHash)) role = 'gm'
    const online = this.onlineClientIds()
    const member = this.engine.join({ clientId: msg.clientId, nickname: msg.nickname, role }, online)
    const att: Attachment = { sessionId: crypto.randomUUID(), clientId: msg.clientId, role }
    ws.serializeAttachment(att)
    online.add(msg.clientId)
    this.send(ws, { t: 'welcome', self: member, snapshot: this.engine.snapshot(role, online) })
    this.broadcast(att.sessionId, () => ({ t: 'memberJoined', member }))
  }

  private onOp(ws: WebSocket, att: Attachment, msg: Msg<'op'>): void {
    const res = this.engine.applyOp(att.clientId, att.role, msg.opId, msg.op)
    if (!res.ok) {
      this.send(ws, { t: 'reject', opId: msg.opId, reason: res.reason, current: res.current })
      return
    }
    this.send(ws, { t: 'ack', opId: msg.opId, version: res.version })
    if (res.duplicate) return
    const { before, after } = res
    this.broadcast(att.sessionId, (other) => {
      if (after && this.engine.canSeeObject(other.role, after)) {
        return { t: 'op', by: att.clientId, op: { kind: 'upsert', object: after } }
      }
      if (before && this.engine.canSeeObject(other.role, before)) {
        return { t: 'op', by: att.clientId, op: { kind: 'delete', id: before.id } }
      }
      return null
    })
  }

  private onGrab(ws: WebSocket, att: Attachment, msg: Msg<'grab'>): void {
    if (!this.engine.grab(att.clientId, att.role, msg.objectId)) {
      this.send(ws, { t: 'grabDenied', objectId: msg.objectId })
      return
    }
    const object = this.store.getObject(msg.objectId)!
    this.broadcast(null, (other) =>
      this.engine.canSeeObject(other.role, object) ? { t: 'grabbed', objectId: msg.objectId, clientId: att.clientId } : null,
    )
  }

  private onRelease(att: Attachment, msg: Msg<'release'>): void {
    if (!this.engine.release(att.clientId, msg.objectId)) return
    this.broadcastReleased(msg.objectId, att.clientId)
  }

  private onPresence(att: Attachment, msg: Msg<'presence'>): void {
    const p = msg.p
    const out = { t: 'presence' as const, clientId: att.clientId, p }
    switch (p.kind) {
      case 'cursor':
      case 'strokeEnd':
        this.broadcast(att.sessionId, () => out)
        return
      case 'drag': {
        if (!this.engine.touchLock(att.clientId, p.objectId)) return
        const object = this.store.getObject(p.objectId)
        if (!object) return
        this.broadcast(att.sessionId, (other) => (this.engine.canSeeObject(other.role, object) ? out : null))
        return
      }
      case 'stroke':
        if (!this.engine.canEditLayer(att.role, p.layerId)) return
        this.broadcast(att.sessionId, (other) => (this.engine.canSeeLayer(other.role, p.layerId) ? out : null))
        return
    }
  }

  private onDisconnect(ws: WebSocket): void {
    const att = this.attachment(ws)
    if (!att) return
    ws.serializeAttachment(null)
    const stillOnline = this.ctx.getWebSockets().some((other) => {
      const o = this.attachment(other)
      return !!o && o.sessionId !== att.sessionId && o.clientId === att.clientId
    })
    if (stillOnline) return
    for (const objectId of this.engine.releaseAll(att.clientId)) this.broadcastReleased(objectId, att.clientId)
    this.engine.touchMember(att.clientId)
    this.broadcast(att.sessionId, () => ({ t: 'memberLeft', clientId: att.clientId }))
  }

  private broadcastReleased(objectId: string, clientId: string): void {
    const object = this.store.getObject(objectId)
    this.broadcast(null, (other) =>
      !object || this.engine.canSeeObject(other.role, object) ? { t: 'released', objectId, clientId } : null,
    )
  }

  private attachment(ws: WebSocket): Attachment | null {
    return (ws.deserializeAttachment() as Attachment | null) ?? null
  }

  private onlineClientIds(): Set<string> {
    const ids = new Set<string>()
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws)
      if (att) ids.add(att.clientId)
    }
    return ids
  }

  private broadcast(excludeSessionId: string | null, build: (other: Attachment) => ServerMessage | null): void {
    for (const ws of this.ctx.getWebSockets()) {
      const att = this.attachment(ws)
      if (!att || att.sessionId === excludeSessionId) continue
      const msg = build(att)
      if (msg) this.send(ws, msg)
    }
  }

  private send(ws: WebSocket, msg: ServerMessage): void {
    try {
      ws.send(JSON.stringify(msg))
    } catch {
      // socket fechando; o close handler cuida do resto
    }
  }
}
```

- [ ] **Step 7: Implementar o roteador**

`apps/worker/src/index.ts` (substitui o stub):
```ts
import { TABLE_ID_RE } from '@mesa/shared'
import { randomId, randomSecret, sha256Hex } from './crypto'

export { TableDO } from './table-do'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function createTable(request: Request, env: Env): Promise<Response> {
  let name = 'Nova mesa'
  try {
    const body = await request.json<{ name?: unknown }>()
    if (typeof body.name === 'string' && body.name.trim()) name = body.name.trim().slice(0, 60)
  } catch {
    // body ausente ou inválido → nome padrão
  }
  for (let attempt = 0; attempt < 3; attempt++) {
    const tableId = randomId(10)
    const gmSecret = randomSecret()
    const stub = env.TABLES.get(env.TABLES.idFromName(tableId))
    const res = await stub.fetch('https://table/init', {
      method: 'POST',
      body: JSON.stringify({ id: tableId, name, gmSecretHash: await sha256Hex(gmSecret) }),
    })
    if (res.status === 201) return json({ tableId, gmSecret }, 201)
  }
  return json({ error: 'could_not_create' }, 500)
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    if (parts[0] === 'api' && parts[1] === 'tables') {
      if (parts.length === 2 && request.method === 'POST') return createTable(request, env)
      const tableId = parts[2]
      if (!tableId || !TABLE_ID_RE.test(tableId)) return json({ error: 'invalid_table' }, 400)
      const stub = env.TABLES.get(env.TABLES.idFromName(tableId))
      if (parts.length === 4 && parts[3] === 'ws' && request.method === 'GET') {
        return stub.fetch(new Request('https://table/ws', request))
      }
    }

    return json({ error: 'not_found' }, 404)
  },
} satisfies ExportedHandler<Env>
```

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: PASS em `engine.test.ts` e `table-do.test.ts`.

- [ ] **Step 9: Checkpoint** — `pnpm test` verde.

---

### Task 5: Worker — upload e entrega de imagens (R2)

**Files:**
- Create: `apps/worker/src/files.ts`
- Modify: `apps/worker/src/index.ts` (duas rotas novas)
- Test: `apps/worker/test/files.test.ts`

**Interfaces:**
- Consumes: `MAX_UPLOAD_BYTES`, `ALLOWED_UPLOAD_TYPES`, `ASSET_KEY_RE` (Task 1); `sha256Hex` (Task 4); `createTable` helper (Task 4).
- Produces:
  - `POST /api/tables/:id/assets` (body = bytes, `Content-Type` = tipo da imagem) → `201 { assetKey }` | 400 vazio | 404 mesa | 413 grande | 415 tipo
  - `GET /files/:assetKey` → bytes com `Content-Type` original, cache imutável, `nosniff` | 404
  - `uploadAsset(request: Request, env: Env, table: DurableObjectStub): Promise<Response>`, `serveFile(key: string, env: Env): Promise<Response>`

- [ ] **Step 1: Teste falhando**

`apps/worker/test/files.test.ts`:
```ts
import { SELF } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { createTable } from './helpers'

const PNG_1x1 = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0),
)

const upload = (tableId: string, body: BodyInit, type: string) =>
  SELF.fetch(`https://mesa.test/api/tables/${tableId}/assets`, { method: 'POST', headers: { 'Content-Type': type }, body })

describe('assets', () => {
  it('sobe PNG e serve de volta com cache imutável', async () => {
    const { tableId } = await createTable()
    const res = await upload(tableId, PNG_1x1, 'image/png')
    expect(res.status).toBe(201)
    const { assetKey } = await res.json<{ assetKey: string }>()
    expect(assetKey).toMatch(/^[a-f0-9]{64}$/)

    const file = await SELF.fetch(`https://mesa.test/files/${assetKey}`)
    expect(file.status).toBe(200)
    expect(file.headers.get('Content-Type')).toBe('image/png')
    expect(file.headers.get('Cache-Control')).toContain('immutable')
    expect(file.headers.get('X-Content-Type-Options')).toBe('nosniff')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(PNG_1x1)
  })

  it('mesmo conteúdo gera mesma chave', async () => {
    const { tableId } = await createTable()
    const a = await (await upload(tableId, PNG_1x1, 'image/png')).json<{ assetKey: string }>()
    const b = await (await upload(tableId, PNG_1x1, 'image/png')).json<{ assetKey: string }>()
    expect(a.assetKey).toBe(b.assetKey)
  })

  // Review Focus #5
  it('recusa SVG e GIF com 415', async () => {
    const { tableId } = await createTable()
    expect((await upload(tableId, '<svg/>', 'image/svg+xml')).status).toBe(415)
    expect((await upload(tableId, PNG_1x1, 'image/gif')).status).toBe(415)
  })

  // Review Focus #5
  it('recusa arquivo maior que 10 MB com 413 e não grava', async () => {
    const { tableId } = await createTable()
    const big = new Uint8Array(10 * 1024 * 1024 + 1)
    const res = await upload(tableId, big, 'image/png')
    expect(res.status).toBe(413)
  })

  it('recusa corpo vazio com 400', async () => {
    const { tableId } = await createTable()
    expect((await upload(tableId, new Uint8Array(0), 'image/png')).status).toBe(400)
  })

  it('mesa inexistente → 404', async () => {
    expect((await upload('ZZZZZZZZZZ', PNG_1x1, 'image/png')).status).toBe(404)
  })

  it('chave inválida ou ausente → 404', async () => {
    expect((await SELF.fetch('https://mesa.test/files/naoexiste')).status).toBe(404)
    expect((await SELF.fetch(`https://mesa.test/files/${'b'.repeat(64)}`)).status).toBe(404)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/worker test -- test/files.test.ts`
Expected: FAIL — upload retorna 404.

- [ ] **Step 3: Implementar**

`apps/worker/src/files.ts`:
```ts
import { ALLOWED_UPLOAD_TYPES, ASSET_KEY_RE, MAX_UPLOAD_BYTES } from '@mesa/shared'
import { sha256Hex } from './crypto'

const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

export async function uploadAsset(request: Request, env: Env, table: DurableObjectStub): Promise<Response> {
  const type = (request.headers.get('Content-Type') ?? '').split(';')[0].trim().toLowerCase()
  if (!ALLOWED_UPLOAD_TYPES.includes(type)) return json({ error: 'unsupported_type' }, 415)
  const declared = Number(request.headers.get('Content-Length') ?? '0')
  if (declared > MAX_UPLOAD_BYTES) return json({ error: 'too_large' }, 413)

  const exists = await table.fetch('https://table/exists')
  if (exists.status !== 204) return json({ error: 'table_not_found' }, 404)

  const body = await request.arrayBuffer()
  if (body.byteLength === 0) return json({ error: 'empty' }, 400)
  if (body.byteLength > MAX_UPLOAD_BYTES) return json({ error: 'too_large' }, 413)

  const assetKey = await sha256Hex(body)
  if (!(await env.FILES.head(assetKey))) {
    await env.FILES.put(assetKey, body, { httpMetadata: { contentType: type } })
  }
  return json({ assetKey }, 201)
}

export async function serveFile(key: string, env: Env): Promise<Response> {
  if (!ASSET_KEY_RE.test(key)) return new Response('not found', { status: 404 })
  const object = await env.FILES.get(key)
  if (!object) return new Response('not found', { status: 404 })
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
```

Em `apps/worker/src/index.ts`:
1. Adicionar o import no topo:
```ts
import { serveFile, uploadAsset } from './files'
```
2. Logo após o bloco `if (parts.length === 4 && parts[3] === 'ws' ...) { ... }`, ainda dentro do `if (parts[0] === 'api' ...)`, adicionar:
```ts
      if (parts.length === 4 && parts[3] === 'assets' && request.method === 'POST') {
        return uploadAsset(request, env, stub)
      }
```
3. Antes do `return json({ error: 'not_found' }, 404)` final, adicionar:
```ts
    if (parts[0] === 'files' && parts.length === 2 && request.method === 'GET') {
      return serveFile(parts[1], env)
    }
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: PASS em todos os arquivos de teste do worker.

- [ ] **Step 5: Checkpoint** — `pnpm test` verde.

---
### Task 6: Web — esqueleto, identidade, API e página inicial

**Files:**
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/index.html`
- Create: `apps/web/src/main.tsx`, `apps/web/src/App.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/src/lib/identity.ts`, `apps/web/src/lib/api.ts`
- Create: `apps/web/src/ui/HomePage.tsx`, `apps/web/src/ui/TablePage.tsx` (placeholder, substituído no Task 9)

**Interfaces:**
- Consumes: `POST /api/tables` (Task 4).
- Produces:
  - `getClientId(): string`, `getNickname(): string | null`, `setNickname(n: string): void`, `readGmSecret(tableId: string): string | undefined`, `rememberGmSecret(tableId: string, secret: string): void`
  - `createTable(name: string): Promise<{ tableId: string; gmSecret: string }>`, `uploadAsset(tableId: string, blob: Blob): Promise<string>`, `wsUrl(tableId: string): string`
  - `App` roteia `/t/:tableId` → `<TablePage tableId>`, qualquer outro caminho → `<HomePage>`

- [ ] **Step 1: Pacote e configuração**

`apps/web/package.json`:
```json
{
  "name": "@mesa/web",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc --noEmit && vite build",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  }
}
```

Run:
```bash
pnpm --filter @mesa/web add @mesa/shared@workspace:* react react-dom konva react-konva use-image zustand nanoid
pnpm --filter @mesa/web add -D vite @vitejs/plugin-react typescript vitest @types/react @types/react-dom
```

`apps/web/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "types": ["vite/client"]
  },
  "include": ["src", "test", "vite.config.ts"]
}
```

`apps/web/vite.config.ts`:
```ts
/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8787', ws: true },
      '/files': 'http://localhost:8787',
    },
  },
  test: { environment: 'node' },
})
```

`apps/web/index.html`:
```html
<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Mesa Virtual</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

`apps/web/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './styles.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

`apps/web/src/App.tsx`:
```tsx
import { HomePage } from './ui/HomePage'
import { TablePage } from './ui/TablePage'

export function App() {
  const match = /^\/t\/([A-Za-z0-9]{10})\/?$/.exec(window.location.pathname)
  return match ? <TablePage tableId={match[1]} /> : <HomePage />
}
```

`apps/web/src/styles.css`:
```css
* { box-sizing: border-box; }
html, body, #root { margin: 0; height: 100%; font-family: system-ui, sans-serif; background: #1e1f24; color: #eee; }
button, input, select { font: inherit; }
button { cursor: pointer; background: #33353d; color: #eee; border: 1px solid #4a4d57; border-radius: 6px; padding: 6px 10px; }
button[aria-pressed='true'] { background: #4363d8; border-color: #4363d8; }
input, select { background: #2a2c33; color: #eee; border: 1px solid #4a4d57; border-radius: 6px; padding: 6px 8px; }
.home { max-width: 560px; margin: 10vh auto; padding: 24px; display: grid; gap: 16px; }
.home .link-row { display: flex; gap: 8px; }
.home .link-row input { flex: 1; }
.panel { position: absolute; background: rgba(30, 31, 36, 0.92); border: 1px solid #3a3c45; border-radius: 8px; padding: 8px; z-index: 10; }
.toolbar { top: 50%; left: 12px; transform: translateY(-50%); display: grid; gap: 6px; }
.topbar { top: 12px; left: 50%; transform: translateX(-50%); display: flex; gap: 12px; align-items: center; }
.members { top: 12px; right: 12px; min-width: 160px; }
.members li { list-style: none; display: flex; align-items: center; gap: 6px; padding: 2px 0; }
.members ul { margin: 0; padding: 0; }
.dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.offline { opacity: 0.45; }
.banner { top: 60px; left: 50%; transform: translateX(-50%); background: #8a5a00; }
.toasts { bottom: 12px; left: 50%; transform: translateX(-50%); display: grid; gap: 6px; background: transparent; border: none; }
.toast { background: #3a3c45; padding: 8px 12px; border-radius: 6px; display: flex; gap: 8px; align-items: center; }
.debug { bottom: 12px; right: 12px; font-family: monospace; font-size: 12px; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0, 0, 0, 0.6); display: grid; place-items: center; z-index: 20; }
.modal { background: #26282e; padding: 24px; border-radius: 10px; display: grid; gap: 12px; min-width: 300px; }
.fullscreen-msg { display: grid; place-items: center; height: 100%; gap: 12px; }
```

- [ ] **Step 2: Identidade e API**

`apps/web/src/lib/identity.ts`:
```ts
const CLIENT_KEY = 'mesa:clientId'
const NICK_KEY = 'mesa:nickname'
const gmKey = (tableId: string) => `mesa:gm:${tableId}`

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // modo privado/armazenamento bloqueado: segue só em memória
  }
}

// crypto.randomUUID só existe em contexto seguro (https/localhost);
// acesso por IP de VPN em http cai neste fallback.
function uuidV4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const b = crypto.getRandomValues(new Uint8Array(16))
  b[6] = (b[6] & 0x0f) | 0x40
  b[8] = (b[8] & 0x3f) | 0x80
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}

let memoryClientId: string | null = null

export function getClientId(): string {
  const stored = safeGet(CLIENT_KEY)
  if (stored) return stored
  memoryClientId ??= uuidV4()
  safeSet(CLIENT_KEY, memoryClientId)
  return memoryClientId
}

export function getNickname(): string | null {
  return safeGet(NICK_KEY)
}

export function setNickname(nickname: string): void {
  safeSet(NICK_KEY, nickname)
}

export function rememberGmSecret(tableId: string, secret: string): void {
  safeSet(gmKey(tableId), secret)
}

export function readGmSecret(tableId: string): string | undefined {
  const match = /(?:^#|&)gm=([^&]+)/.exec(window.location.hash)
  if (match) {
    rememberGmSecret(tableId, match[1])
    return match[1]
  }
  return safeGet(gmKey(tableId)) ?? undefined
}
```

`apps/web/src/lib/api.ts`:
```ts
export async function createTable(name: string): Promise<{ tableId: string; gmSecret: string }> {
  const res = await fetch('/api/tables', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`create_failed_${res.status}`)
  return res.json()
}

export async function uploadAsset(tableId: string, blob: Blob): Promise<string> {
  const res = await fetch(`/api/tables/${tableId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': blob.type },
    body: blob,
  })
  if (!res.ok) throw new Error(`upload_failed_${res.status}`)
  const body = (await res.json()) as { assetKey: string }
  return body.assetKey
}

export function wsUrl(tableId: string): string {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/api/tables/${tableId}/ws`
}
```

- [ ] **Step 3: Página inicial e placeholder da mesa**

`apps/web/src/ui/HomePage.tsx`:
```tsx
import { useState } from 'react'
import { createTable } from '../lib/api'
import { rememberGmSecret } from '../lib/identity'

export function HomePage() {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ tableId: string; gmSecret: string } | null>(null)

  const origin = window.location.origin
  const playerLink = created ? `${origin}/t/${created.tableId}` : ''
  const gmLink = created ? `${playerLink}#gm=${created.gmSecret}` : ''

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const result = await createTable(name.trim() || 'Nova mesa')
      rememberGmSecret(result.tableId, result.gmSecret)
      setCreated(result)
    } catch {
      setError('Não foi possível criar a mesa. Tente de novo.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="home">
      <h1>Mesa Virtual</h1>
      {!created ? (
        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 12 }}>
          <label>
            Nome da mesa
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Campanha de sexta" style={{ width: '100%' }} />
          </label>
          <button type="submit" disabled={busy}>{busy ? 'Criando…' : 'Criar mesa'}</button>
          {error && <p role="alert">{error}</p>}
        </form>
      ) : (
        <>
          <p>Mesa criada! Guarde o link de mestre — ele não pode ser recuperado.</p>
          <LinkRow label="Link dos jogadores" value={playerLink} />
          <LinkRow label="Link do mestre (secreto)" value={gmLink} />
          <button onClick={() => window.location.assign(gmLink)}>Abrir como mestre</button>
        </>
      )}
    </main>
  )
}

function LinkRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <label>
      {label}
      <div className="link-row">
        <input readOnly value={value} onFocus={(e) => e.target.select()} />
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard?.writeText(value)
            setCopied(true)
          }}
        >
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </label>
  )
}
```

`apps/web/src/ui/TablePage.tsx` (placeholder):
```tsx
export function TablePage({ tableId }: { tableId: string }) {
  return <div className="fullscreen-msg">Mesa {tableId}</div>
}
```

- [ ] **Step 4: Verificação manual**

Run (dois terminais):
```bash
pnpm dev:worker
pnpm dev:web
```
Abrir `http://localhost:5173`, criar uma mesa.
Expected: aparecem os dois links; "Abrir como mestre" navega para `/t/<id>#gm=…` e mostra "Mesa <id>".

Run: `pnpm --filter @mesa/web build`
Expected: build sem erros de tipo, saída em `apps/web/dist`.

- [ ] **Step 5: Checkpoint** — `pnpm test` verde e build ok.

---

### Task 7: Web — throttle e `SyncClient`

**Files:**
- Create: `apps/web/src/lib/throttle.ts`, `apps/web/src/sync/SyncClient.ts`
- Test: `apps/web/test/throttle.test.ts`, `apps/web/test/sync-client.test.ts`

**Interfaces:**
- Consumes: `ClientMessage`, `HelloMessage`, `Op`, `ServerMessage` (Task 1).
- Produces:
  - `interface Throttled<A extends unknown[]> { (...args: A): void; flush(): void; cancel(): void }`
  - `throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A>` — executa na hora se o intervalo passou; senão agenda chamada final com os últimos argumentos.
  - `type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'`
  - `interface WebSocketLike { send(data: string): void; close(code?: number, reason?: string): void; onopen: ((ev: unknown) => void) | null; onmessage: ((ev: { data: unknown }) => void) | null; onclose: ((ev: { code: number }) => void) | null }`
  - `interface SyncClientOptions { url: string; hello: () => HelloMessage; onMessage: (msg: ServerMessage) => void; onStatus: (status: ConnStatus) => void; createSocket?: (url: string) => WebSocketLike }`
  - `class SyncClient` com `connect()`, `close()`, `sendOp(opId: string, op: Op)`, `send(msg: ClientMessage)` (descarta se não estiver pronto), `get ready: boolean`, `readonly stats: { sent: number; received: number }`

- [ ] **Step 1: Testes falhando**

`apps/web/test/throttle.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { throttle } from '../src/lib/throttle'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('throttle', () => {
  it('primeira chamada é imediata; seguintes viram uma chamada final com últimos args', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t(1)
    t(2)
    t(3)
    expect(fn.mock.calls).toEqual([[1]])
    vi.advanceTimersByTime(100)
    expect(fn.mock.calls).toEqual([[1], [3]])
  })

  it('flush executa pendente na hora; cancel descarta', () => {
    const fn = vi.fn()
    const t = throttle(fn, 100)
    t('a')
    t('b')
    t.flush()
    expect(fn.mock.calls).toEqual([['a'], ['b']])
    t('c')
    t.cancel()
    vi.advanceTimersByTime(200)
    expect(fn.mock.calls).toEqual([['a'], ['b']])
  })
})
```

`apps/web/test/sync-client.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Op, ServerMessage } from '@mesa/shared'
import { SyncClient, type ConnStatus, type WebSocketLike } from '../src/sync/SyncClient'

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = []
  sent: unknown[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) { this.sent.push(JSON.parse(data)) }
  close() { this.onclose?.({ code: 1000 }) }
  open() { this.onopen?.({}) }
  receive(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
  drop() { this.onclose?.({ code: 1006 }) }
}

const welcome: ServerMessage = {
  t: 'welcome',
  self: { clientId: 'c', nickname: 'Ana', color: '#000000', role: 'player', online: true },
  snapshot: { meta: { id: 'T', name: 'M' }, members: [], layers: [], objects: [], locks: [] },
}
const op: Op = { kind: 'delete', id: 'x' }

let statuses: ConnStatus[]
let received: ServerMessage[]
let client: SyncClient
const last = () => FakeSocket.all[FakeSocket.all.length - 1]

beforeEach(() => {
  vi.useFakeTimers()
  FakeSocket.all = []
  statuses = []
  received = []
  client = new SyncClient({
    url: 'ws://x',
    hello: () => ({ t: 'hello', clientId: 'c', nickname: 'Ana' }),
    onMessage: (m) => received.push(m),
    onStatus: (s) => statuses.push(s),
    createSocket: (url) => new FakeSocket(url),
  })
})
afterEach(() => vi.useRealTimers())

describe('SyncClient', () => {
  it('envia hello ao abrir e só manda ops depois do welcome', () => {
    client.connect()
    last().open()
    client.sendOp('op_1', op)
    expect(last().sent).toEqual([{ t: 'hello', clientId: 'c', nickname: 'Ana' }])
    last().receive(welcome)
    expect(last().sent).toEqual([
      { t: 'hello', clientId: 'c', nickname: 'Ana' },
      { t: 'op', opId: 'op_1', op },
    ])
    expect(statuses).toEqual(['connecting', 'open'])
    expect(received[0]).toEqual(welcome)
  })

  it('reenvia apenas ops sem ack após reconectar', () => {
    client.connect()
    last().open()
    last().receive(welcome)
    client.sendOp('op_1', op)
    client.sendOp('op_2', op)
    last().receive({ t: 'ack', opId: 'op_1', version: 0 })
    last().drop()
    vi.advanceTimersByTime(1000)
    last().open()
    last().receive(welcome)
    expect(last().sent).toEqual([
      { t: 'hello', clientId: 'c', nickname: 'Ana' },
      { t: 'op', opId: 'op_2', op },
    ])
  })

  it('backoff 1s, 2s e reinicia após welcome', () => {
    client.connect()
    last().drop()
    expect(statuses.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(999)
    expect(FakeSocket.all).toHaveLength(1)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(2)
    last().drop()
    vi.advanceTimersByTime(1999)
    expect(FakeSocket.all).toHaveLength(2)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(3)
    last().open()
    last().receive(welcome)
    last().drop()
    vi.advanceTimersByTime(1000)
    expect(FakeSocket.all).toHaveLength(4)
  })

  it('backoff limitado a 30s', () => {
    client.connect()
    for (let i = 0; i < 10; i++) {
      last().drop()
      vi.advanceTimersByTime(30_000)
    }
    const before = FakeSocket.all.length
    last().drop()
    vi.advanceTimersByTime(29_999)
    expect(FakeSocket.all).toHaveLength(before)
    vi.advanceTimersByTime(1)
    expect(FakeSocket.all).toHaveLength(before + 1)
  })

  it('error do servidor encerra sem reconectar', () => {
    client.connect()
    last().open()
    last().receive({ t: 'error', reason: 'table_not_found' })
    last().drop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(statuses.at(-1)).toBe('closed')
  })

  it('send descarta presença quando não está pronto; conta estatísticas', () => {
    client.connect()
    last().open()
    client.send({ t: 'presence', p: { kind: 'cursor', x: 1, y: 1 } })
    expect(last().sent).toHaveLength(1)
    last().receive(welcome)
    client.send({ t: 'presence', p: { kind: 'cursor', x: 1, y: 1 } })
    expect(last().sent).toHaveLength(2)
    expect(client.stats).toEqual({ sent: 2, received: 1 })
  })

  it('close() não reconecta', () => {
    client.connect()
    client.close()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(statuses.at(-1)).toBe('closed')
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/web test`
Expected: FAIL — módulos não encontrados.

- [ ] **Step 3: Implementar**

`apps/web/src/lib/throttle.ts`:
```ts
export interface Throttled<A extends unknown[]> {
  (...args: A): void
  flush(): void
  cancel(): void
}

export function throttle<A extends unknown[]>(fn: (...args: A) => void, ms: number): Throttled<A> {
  let last = -Infinity
  let timer: ReturnType<typeof setTimeout> | null = null
  let pending: A | null = null

  const invoke = () => {
    timer = null
    last = Date.now()
    const args = pending!
    pending = null
    fn(...args)
  }

  const throttled = ((...args: A) => {
    pending = args
    const wait = ms - (Date.now() - last)
    if (wait <= 0) {
      if (timer) clearTimeout(timer)
      invoke()
    } else if (!timer) {
      timer = setTimeout(invoke, wait)
    }
  }) as Throttled<A>

  throttled.flush = () => {
    if (!pending) return
    if (timer) clearTimeout(timer)
    invoke()
  }

  throttled.cancel = () => {
    if (timer) clearTimeout(timer)
    timer = null
    pending = null
  }

  return throttled
}
```

`apps/web/src/sync/SyncClient.ts`:
```ts
import type { ClientMessage, HelloMessage, Op, ServerMessage } from '@mesa/shared'

export type ConnStatus = 'connecting' | 'open' | 'reconnecting' | 'closed'

export interface WebSocketLike {
  send(data: string): void
  close(code?: number, reason?: string): void
  onopen: ((ev: unknown) => void) | null
  onmessage: ((ev: { data: unknown }) => void) | null
  onclose: ((ev: { code: number }) => void) | null
}

export interface SyncClientOptions {
  url: string
  hello: () => HelloMessage
  onMessage: (msg: ServerMessage) => void
  onStatus: (status: ConnStatus) => void
  createSocket?: (url: string) => WebSocketLike
}

const MAX_BACKOFF_MS = 30_000

export class SyncClient {
  readonly stats = { sent: 0, received: 0 }
  private ws: WebSocketLike | null = null
  private pending = new Map<string, Extract<ClientMessage, { t: 'op' }>>()
  private attempt = 0
  private timer: ReturnType<typeof setTimeout> | null = null
  private isReady = false
  private stopped = false

  constructor(private opts: SyncClientOptions) {}

  get ready(): boolean {
    return this.isReady
  }

  connect(): void {
    this.stopped = false
    this.open('connecting')
  }

  close(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    if (this.ws) this.ws.close(1000, 'bye')
    else this.opts.onStatus('closed')
  }

  sendOp(opId: string, op: Op): void {
    const msg = { t: 'op' as const, opId, op }
    this.pending.set(opId, msg)
    if (this.isReady) this.raw(msg)
  }

  send(msg: ClientMessage): void {
    if (this.isReady) this.raw(msg)
  }

  private open(status: ConnStatus): void {
    this.opts.onStatus(status)
    const create = this.opts.createSocket ?? ((url: string) => new WebSocket(url) as unknown as WebSocketLike)
    const ws = create(this.opts.url)
    this.ws = ws
    this.isReady = false
    ws.onopen = () => this.raw(this.opts.hello())
    ws.onmessage = (ev) => {
      if (typeof ev.data !== 'string') return
      this.stats.received++
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data) as ServerMessage
      } catch {
        return
      }
      this.handle(msg)
    }
    ws.onclose = () => this.handleClose()
  }

  private handle(msg: ServerMessage): void {
    if (msg.t === 'welcome') {
      this.isReady = true
      this.attempt = 0
      this.opts.onMessage(msg)
      this.opts.onStatus('open')
      for (const op of this.pending.values()) this.raw(op)
      return
    }
    if (msg.t === 'ack' || msg.t === 'reject') this.pending.delete(msg.opId)
    if (msg.t === 'error') this.stopped = true
    this.opts.onMessage(msg)
  }

  private handleClose(): void {
    this.ws = null
    this.isReady = false
    if (this.stopped) {
      this.opts.onStatus('closed')
      return
    }
    const delay = Math.min(1000 * 2 ** this.attempt, MAX_BACKOFF_MS)
    this.attempt++
    this.opts.onStatus('reconnecting')
    this.timer = setTimeout(() => {
      this.timer = null
      this.open('reconnecting')
    }, delay)
  }

  private raw(msg: ClientMessage): void {
    if (!this.ws) return
    this.ws.send(JSON.stringify(msg))
    this.stats.sent++
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

- [ ] **Step 5: Checkpoint** — `pnpm test` verde.

---

### Task 8: Web — estado da mesa (reducers puros, desfazer, store Zustand)

**Files:**
- Create: `apps/web/src/store/state.ts`, `apps/web/src/store/localOps.ts`, `apps/web/src/store/undo.ts`, `apps/web/src/store/reducers.ts`, `apps/web/src/store/tableStore.ts`, `apps/web/src/store/context.ts`
- Test: `apps/web/test/undo.test.ts`, `apps/web/test/reducers.test.ts`

**Interfaces:**
- Consumes: `SyncClient`, `ConnStatus`, `throttle` (Task 7); `getClientId`, `readGmSecret`, `wsUrl` (Task 6); tipos de `@mesa/shared`.
- Produces:
  - `type Tool = 'select' | 'hand' | 'pencil' | 'eraser'`
  - `interface Viewport { x: number; y: number; scale: number }`
  - `interface Geometry { x: number; y: number; width: number; height: number; rotation: number }`
  - `interface PendingOp { op: Op; before: TableObject | null; isUndo: boolean; inverse: Op | null }`
  - `interface Toast { id: number; text: string; action?: { label: string; run: () => void } }`
  - `interface TableState` (campos listados em `state.ts` abaixo) e `makeInitialState(): TableState`
  - `opTargetId(op: Op): string`, `applyLocalOp(objects, op, selfId): Record<string, TableObject>`
  - `inverseOf(op: Op, before: TableObject | null): Op | null`
  - `reduceServer<S extends TableState>(s: S, msg: ServerMessage, now: number): S`, `reduceStatus(s, status)`, `reduceSubmit(s, opId, op, { isUndo })`, `addToast(s, text, action?)`, `isLockedByOther(s, objectId, now): boolean`
  - `interface TableActions { connect(nickname: string): void; disconnect(): void; submit(op: Op): boolean; undo(): void; grab(id: string): void; release(id: string): void; dragPreview(id: string, g: Geometry): void; cursor(x: number, y: number): void; sendPresence(p: Presence): void; setTool(t: Tool): void; setColor(c: string): void; setStrokeWidth(w: number): void; setActiveLayer(id: string): void; select(id: string | null): void; setViewport(v: Viewport): void; toast(text: string, action?: Toast['action']): void; dismissToast(id: number): void; clearDenied(id: string): void; nextZ(layerId: string): number; canEditLayer(layerId: string): boolean; stats(): { sent: number; received: number } }`
  - `type TableStoreState = TableState & { actions: TableActions }`, `type TableStore = StoreApi<TableStoreState>`
  - `createTableStore(tableId: string, deps?: { createSocket?: SyncClientOptions['createSocket'] }): TableStore`
  - `TableStoreContext`, `useTable<T>(selector: (s: TableStoreState) => T): T`, `useTableActions(): TableActions`, `useTableStore(): TableStore`

- [ ] **Step 1: Tipos de estado e operações locais**

`apps/web/src/store/state.ts`:
```ts
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
```

`apps/web/src/store/localOps.ts`:
```ts
import type { Op, TableObject } from '@mesa/shared'

export function opTargetId(op: Op): string {
  return op.kind === 'create' ? op.object.id : op.id
}

export function applyLocalOp(objects: Record<string, TableObject>, op: Op, selfId: string): Record<string, TableObject> {
  switch (op.kind) {
    case 'create':
      return { ...objects, [op.object.id]: { ...op.object, ownerId: selfId, version: 0, updatedBy: selfId } as TableObject }
    case 'update': {
      const current = objects[op.id]
      if (!current) return objects
      return { ...objects, [op.id]: { ...current, ...op.patch, updatedBy: selfId } as TableObject }
    }
    case 'delete': {
      if (!objects[op.id]) return objects
      const { [op.id]: _removed, ...rest } = objects
      return rest
    }
  }
}
```

- [ ] **Step 2: Teste do desfazer (falhando)**

`apps/web/test/undo.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { TableObject } from '@mesa/shared'
import { inverseOf } from '../src/store/undo'

const obj: TableObject = {
  id: 't1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
  x: 1, y: 2, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'c', version: 3, updatedBy: 'c',
}

describe('inverseOf', () => {
  it('create → delete', () => {
    const { ownerId, version, updatedBy, ...object } = obj
    expect(inverseOf({ kind: 'create', object }, null)).toEqual({ kind: 'delete', id: 't1' })
  })

  it('delete → create sem campos de servidor', () => {
    const inv = inverseOf({ kind: 'delete', id: 't1' }, obj)
    expect(inv).toEqual({
      kind: 'create',
      object: { id: 't1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64), x: 1, y: 2, width: 70, height: 70, rotation: 0, zIndex: 1 },
    })
  })

  it('update → update com valores anteriores só das chaves alteradas', () => {
    expect(inverseOf({ kind: 'update', id: 't1', patch: { x: 50, rotation: 90 } }, obj)).toEqual({
      kind: 'update', id: 't1', patch: { x: 1, rotation: 0 },
    })
  })

  it('sem before não há inversa para update/delete', () => {
    expect(inverseOf({ kind: 'delete', id: 't1' }, null)).toBeNull()
    expect(inverseOf({ kind: 'update', id: 't1', patch: { x: 1 } }, null)).toBeNull()
  })
})
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `pnpm --filter @mesa/web test -- test/undo.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 4: Implementar o desfazer**

`apps/web/src/store/undo.ts`:
```ts
import type { ObjectPatch, Op, TableObject } from '@mesa/shared'

export function inverseOf(op: Op, before: TableObject | null): Op | null {
  switch (op.kind) {
    case 'create':
      return { kind: 'delete', id: op.object.id }
    case 'delete': {
      if (!before) return null
      const { ownerId: _o, version: _v, updatedBy: _u, ...object } = before
      return { kind: 'create', object }
    }
    case 'update': {
      if (!before) return null
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(op.patch)) patch[key] = (before as Record<string, unknown>)[key]
      return { kind: 'update', id: op.id, patch: patch as ObjectPatch }
    }
  }
}
```

- [ ] **Step 5: Teste dos reducers (falhando)**

`apps/web/test/reducers.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, LOCK_TTL_MS, type NewObject, type ServerMessage, type TableObject } from '@mesa/shared'
import { isLockedByOther, reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const self = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player' as const, online: true }
const newToken = (id = 't1'): NewObject => ({
  id, type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
  x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 1,
})
const stored = (id = 't1', over: Partial<TableObject> = {}): TableObject =>
  ({ ...newToken(id), ownerId: 'other', version: 1, updatedBy: 'other', ...over }) as TableObject

const welcome = (objects: TableObject[] = []): ServerMessage => ({
  t: 'welcome',
  self,
  snapshot: { meta: { id: 'T', name: 'M' }, members: [self], layers: DEFAULT_LAYERS.slice(0, 3), objects, locks: [] },
})

function joined(objects: TableObject[] = []): TableState {
  return reduceServer(makeInitialState(), welcome(objects), 0)
}

describe('welcome', () => {
  it('monta estado e marca open', () => {
    const s = joined([stored()])
    expect(s.status).toBe('open')
    expect(s.self).toEqual(self)
    expect(Object.keys(s.objects)).toEqual(['t1'])
    expect(s.layers.map((l) => l.id)).toEqual(['map', 'tokens', 'drawings'])
  })

  // Review Focus #3
  it('reaplica ops pendentes por cima do snapshot novo', () => {
    let s = joined()
    s = reduceSubmit(s, 'op_1', { kind: 'create', object: newToken('mine') }, { isUndo: false })
    s = reduceServer(s, welcome([]), 1000)
    expect(s.objects.mine).toBeDefined()
    expect(s.pending.op_1).toBeDefined()
  })

  it('camada ativa inexistente volta para tokens', () => {
    const s = reduceServer({ ...makeInitialState(), activeLayerId: 'gm' }, welcome(), 0)
    expect(s.activeLayerId).toBe('tokens')
  })
})

describe('submit / ack / reject', () => {
  it('create otimista; ack seta version e empilha inversa', () => {
    let s = reduceSubmit(joined(), 'op_1', { kind: 'create', object: newToken() }, { isUndo: false })
    expect(s.objects.t1).toMatchObject({ ownerId: 'me', version: 0 })
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 1 }, 0)
    expect(s.objects.t1.version).toBe(1)
    expect(s.pending).toEqual({})
    expect(s.undoStack).toEqual([{ kind: 'delete', id: 't1' }])
  })

  it('ack de desfazer não empilha nada', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'delete', id: 't1' }, { isUndo: true })
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 0 }, 0)
    expect(s.undoStack).toEqual([])
  })

  it('reject com current restaura estado do servidor e mostra toast', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'update', id: 't1', patch: { x: 99 } }, { isUndo: false })
    expect(s.objects.t1.x).toBe(99)
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'locked', current: stored('t1', { x: 5 }) }, 0)
    expect(s.objects.t1.x).toBe(5)
    expect(s.toasts.at(-1)?.text).toBe('Outra pessoa está mexendo nesse objeto')
  })

  it('reject com current null remove o objeto', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'update', id: 't1', patch: { x: 99 } }, { isUndo: false })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'not_found', current: null }, 0)
    expect(s.objects.t1).toBeUndefined()
  })

  it('reject de desfazer usa texto próprio', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'update', id: 't1', patch: { x: 1 } }, { isUndo: true })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'locked', current: stored() }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível desfazer')
  })

  it('reject de delete por not_found não mostra toast', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'delete', id: 't1' }, { isUndo: false })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'not_found', current: null }, 0)
    expect(s.toasts).toEqual([])
  })
})

describe('mensagens de outros', () => {
  it('upsert remoto mantém meu update pendente por cima', () => {
    let s = reduceSubmit(joined([stored()]), 'op_1', { kind: 'update', id: 't1', patch: { x: 99 } }, { isUndo: false })
    s = reduceServer(s, { t: 'op', by: 'other', op: { kind: 'upsert', object: stored('t1', { y: 40, version: 2 }) } }, 0)
    expect(s.objects.t1).toMatchObject({ x: 99, y: 40 })
  })

  it('delete remoto limpa seleção, trava e prévia', () => {
    let s = { ...joined([stored()]), selectedId: 't1' }
    s = reduceServer(s, { t: 'grabbed', objectId: 't1', clientId: 'other' }, 0)
    s = reduceServer(s, { t: 'op', by: 'other', op: { kind: 'delete', id: 't1' } }, 0)
    expect(s.objects.t1).toBeUndefined()
    expect(s.selectedId).toBeNull()
    expect(s.locks.t1).toBeUndefined()
  })

  it('presença de traço acumula pontos incrementais', () => {
    let s = joined()
    const base = { kind: 'stroke' as const, strokeId: 's1', layerId: 'drawings', color: '#ffffff', strokeWidth: 3 }
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { ...base, points: [0, 0, 1, 1] } }, 0)
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { ...base, points: [2, 2] } }, 0)
    expect(s.strokePreviews.s1.points).toEqual([0, 0, 1, 1, 2, 2])
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { kind: 'strokeEnd', strokeId: 's1' } }, 0)
    expect(s.strokePreviews.s1).toBeUndefined()
  })

  it('presença de drag cria/renova trava e prévia; trava expira', () => {
    let s = joined([stored()])
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { kind: 'drag', objectId: 't1', x: 5, y: 5, width: 70, height: 70, rotation: 0 } }, 100)
    expect(s.dragPreviews.t1).toMatchObject({ x: 5 })
    expect(isLockedByOther(s, 't1', 100)).toBe(true)
    expect(isLockedByOther(s, 't1', 100 + LOCK_TTL_MS + 1)).toBe(false)
  })

  it('memberLeft marca offline e limpa cursor e travas da pessoa', () => {
    let s = reduceServer(joined([stored()]), { t: 'memberJoined', member: { ...self, clientId: 'other', nickname: 'Bia' } }, 0)
    s = reduceServer(s, { t: 'presence', clientId: 'other', p: { kind: 'cursor', x: 1, y: 1 } }, 0)
    s = reduceServer(s, { t: 'grabbed', objectId: 't1', clientId: 'other' }, 0)
    s = reduceServer(s, { t: 'memberLeft', clientId: 'other' }, 0)
    expect(s.members.other.online).toBe(false)
    expect(s.cursors.other).toBeUndefined()
    expect(s.locks.t1).toBeUndefined()
  })

  it('grabDenied marca e grabbed próprio limpa a marca', () => {
    let s = reduceServer(joined([stored()]), { t: 'grabDenied', objectId: 't1' }, 0)
    expect(s.deniedGrabs.t1).toBe(true)
    s = reduceServer(s, { t: 'grabbed', objectId: 't1', clientId: 'me' }, 0)
    expect(s.deniedGrabs.t1).toBeUndefined()
  })

  it('error marca fatal e fecha', () => {
    const s = reduceServer(makeInitialState(), { t: 'error', reason: 'table_not_found' }, 0)
    expect(s.fatal).toBe('table_not_found')
    expect(s.status).toBe('closed')
  })
})
```

- [ ] **Step 6: Rodar e ver falhar**

Run: `pnpm --filter @mesa/web test -- test/reducers.test.ts`
Expected: FAIL — `../src/store/reducers` não existe.

- [ ] **Step 7: Implementar os reducers**

`apps/web/src/store/reducers.ts`:
```ts
import { LOCK_TTL_MS, UNDO_LIMIT, type Op, type RejectReason, type ServerMessage, type TableObject } from '@mesa/shared'
import type { ConnStatus } from '../sync/SyncClient'
import { applyLocalOp, opTargetId } from './localOps'
import { inverseOf } from './undo'
import type { PendingOp, TableState, Toast } from './state'

const REJECT_TEXT: Record<RejectReason, string> = {
  invalid: 'Ação inválida',
  not_found: 'O objeto não existe mais',
  exists: 'Esse objeto já existe',
  locked: 'Outra pessoa está mexendo nesse objeto',
  forbidden: 'Sem permissão nessa camada',
}

let toastSeq = 0

export function addToast<S extends TableState>(s: S, text: string, action?: Toast['action']): S {
  return { ...s, toasts: [...s.toasts, { id: ++toastSeq, text, action }] }
}

export function reduceStatus<S extends TableState>(s: S, status: ConnStatus): S {
  return s.status === status ? s : { ...s, status }
}

export function isLockedByOther(s: TableState, objectId: string, now: number): boolean {
  const lock = s.locks[objectId]
  return !!lock && lock.clientId !== s.self?.clientId && lock.expiresAt > now
}

function reapplyPending(
  objects: Record<string, TableObject>,
  pending: Record<string, PendingOp>,
  selfId: string,
  onlyId?: string,
): Record<string, TableObject> {
  let out = objects
  for (const p of Object.values(pending)) {
    if (onlyId === undefined || opTargetId(p.op) === onlyId) out = applyLocalOp(out, p.op, selfId)
  }
  return out
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

export function reduceSubmit<S extends TableState>(s: S, opId: string, op: Op, opts: { isUndo: boolean }): S {
  const selfId = s.self?.clientId ?? ''
  const targetId = opTargetId(op)
  const before = s.objects[targetId] ?? null
  return {
    ...s,
    objects: applyLocalOp(s.objects, op, selfId),
    pending: { ...s.pending, [opId]: { op, before, isUndo: opts.isUndo, inverse: opts.isUndo ? null : inverseOf(op, before) } },
    selectedId: op.kind === 'delete' && s.selectedId === targetId ? null : s.selectedId,
  }
}

export function reduceServer<S extends TableState>(s: S, msg: ServerMessage, now: number): S {
  const selfId = s.self?.clientId ?? ''

  switch (msg.t) {
    case 'welcome': {
      const snap = msg.snapshot
      const objects = reapplyPending(Object.fromEntries(snap.objects.map((o) => [o.id, o])), s.pending, msg.self.clientId)
      const layers = [...snap.layers].sort((a, b) => a.order - b.order)
      return {
        ...s,
        status: 'open',
        fatal: null,
        self: msg.self,
        meta: snap.meta,
        layers,
        objects,
        members: Object.fromEntries(snap.members.map((m) => [m.clientId, m])),
        locks: Object.fromEntries(snap.locks.map((l) => [l.objectId, { clientId: l.clientId, expiresAt: now + LOCK_TTL_MS }])),
        cursors: {},
        dragPreviews: {},
        strokePreviews: {},
        deniedGrabs: {},
        activeLayerId: layers.some((l) => l.id === s.activeLayerId) ? s.activeLayerId : 'tokens',
        selectedId: s.selectedId && objects[s.selectedId] ? s.selectedId : null,
      }
    }

    case 'ack': {
      const p = s.pending[msg.opId]
      if (!p) return s
      const id = opTargetId(p.op)
      const objects =
        p.op.kind !== 'delete' && s.objects[id] ? { ...s.objects, [id]: { ...s.objects[id], version: msg.version } } : s.objects
      return {
        ...s,
        pending: omit(s.pending, msg.opId),
        objects,
        undoStack: p.inverse ? [...s.undoStack, p.inverse].slice(-UNDO_LIMIT) : s.undoStack,
      }
    }

    case 'reject': {
      const p = s.pending[msg.opId]
      if (!p) return s
      const pending = omit(s.pending, msg.opId)
      const id = opTargetId(p.op)
      const base = msg.current !== undefined ? msg.current : p.before
      const objects = { ...s.objects }
      if (base) objects[id] = base
      else delete objects[id]
      const next = { ...s, pending, objects: reapplyPending(objects, pending, selfId, id) }
      if (p.op.kind === 'delete' && msg.reason === 'not_found') return next
      return addToast(next, p.isUndo ? 'Não foi possível desfazer' : REJECT_TEXT[msg.reason])
    }

    case 'op': {
      if (msg.op.kind === 'upsert') {
        const object = msg.op.object
        const objects = reapplyPending({ ...s.objects, [object.id]: object }, s.pending, selfId, object.id)
        return { ...s, objects, dragPreviews: omit(s.dragPreviews, object.id) }
      }
      const id = msg.op.id
      return {
        ...s,
        objects: omit(s.objects, id),
        dragPreviews: omit(s.dragPreviews, id),
        locks: omit(s.locks, id),
        selectedId: s.selectedId === id ? null : s.selectedId,
      }
    }

    case 'grabbed':
      return {
        ...s,
        locks: { ...s.locks, [msg.objectId]: { clientId: msg.clientId, expiresAt: now + LOCK_TTL_MS } },
        deniedGrabs: msg.clientId === selfId ? omit(s.deniedGrabs, msg.objectId) : s.deniedGrabs,
      }

    case 'grabDenied':
      return { ...s, deniedGrabs: { ...s.deniedGrabs, [msg.objectId]: true } }

    case 'released':
      return { ...s, locks: omit(s.locks, msg.objectId), dragPreviews: omit(s.dragPreviews, msg.objectId) }

    case 'presence': {
      const p = msg.p
      switch (p.kind) {
        case 'cursor':
          return { ...s, cursors: { ...s.cursors, [msg.clientId]: { x: p.x, y: p.y } } }
        case 'drag': {
          const { objectId, kind: _k, ...geometry } = p
          return {
            ...s,
            dragPreviews: { ...s.dragPreviews, [objectId]: geometry },
            locks: { ...s.locks, [objectId]: { clientId: msg.clientId, expiresAt: now + LOCK_TTL_MS } },
          }
        }
        case 'stroke': {
          const prev = s.strokePreviews[p.strokeId]
          return {
            ...s,
            strokePreviews: {
              ...s.strokePreviews,
              [p.strokeId]: {
                clientId: msg.clientId,
                layerId: p.layerId,
                color: p.color,
                strokeWidth: p.strokeWidth,
                points: prev ? [...prev.points, ...p.points] : p.points,
              },
            },
          }
        }
        case 'strokeEnd':
          return { ...s, strokePreviews: omit(s.strokePreviews, p.strokeId) }
      }
      return s
    }

    case 'memberJoined':
      return { ...s, members: { ...s.members, [msg.member.clientId]: msg.member } }

    case 'memberLeft': {
      const member = s.members[msg.clientId]
      return {
        ...s,
        members: member ? { ...s.members, [msg.clientId]: { ...member, online: false } } : s.members,
        cursors: omit(s.cursors, msg.clientId),
        locks: Object.fromEntries(Object.entries(s.locks).filter(([, l]) => l.clientId !== msg.clientId)),
        strokePreviews: Object.fromEntries(Object.entries(s.strokePreviews).filter(([, p]) => p.clientId !== msg.clientId)),
      }
    }

    case 'error':
      return { ...s, fatal: msg.reason, status: 'closed' }
  }
}
```

- [ ] **Step 8: Store Zustand e contexto React**

`apps/web/src/store/tableStore.ts`:
```ts
import { createStore, type StoreApi } from 'zustand/vanilla'
import { nanoid } from 'nanoid'
import type { Op, Presence } from '@mesa/shared'
import { SyncClient, type SyncClientOptions } from '../sync/SyncClient'
import { throttle, type Throttled } from '../lib/throttle'
import { getClientId, readGmSecret } from '../lib/identity'
import { wsUrl } from '../lib/api'
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
  stats(): { sent: number; received: number }
}

export type TableStoreState = TableState & { actions: TableActions }
export type TableStore = StoreApi<TableStoreState>

export function createTableStore(
  tableId: string,
  deps: { createSocket?: SyncClientOptions['createSocket'] } = {},
): TableStore {
  let sync: SyncClient | null = null
  const dragThrottles = new Map<string, Throttled<[Geometry]>>()

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
        // Callbacks de um cliente antigo (ex.: o close assíncrono do StrictMode)
        // são ignorados para não sobrescrever o status do cliente atual.
        const client: SyncClient = new SyncClient({
          url: wsUrl(tableId),
          hello: () => {
            const gmSecret = readGmSecret(tableId)
            return { t: 'hello', clientId: getClientId(), nickname, ...(gmSecret ? { gmSecret } : {}) }
          },
          onMessage: (msg) => {
            if (sync === client) set((s) => reduceServer(s, msg, Date.now()))
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
        submitInternal(op, true)
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
      stats: () => (sync ? { ...sync.stats } : { sent: 0, received: 0 }),
    }

    return { ...makeInitialState(), actions }
  })
}
```

`apps/web/src/store/context.ts`:
```ts
import { createContext, useContext } from 'react'
import { useStore } from 'zustand'
import type { TableActions, TableStore, TableStoreState } from './tableStore'

export const TableStoreContext = createContext<TableStore | null>(null)

export function useTableStore(): TableStore {
  const store = useContext(TableStoreContext)
  if (!store) throw new Error('TableStoreContext ausente')
  return store
}

// Selectors devem retornar valores estáveis (campos do estado), nunca arrays/objetos novos.
export function useTable<T>(selector: (s: TableStoreState) => T): T {
  return useStore(useTableStore(), selector)
}

export function useTableActions(): TableActions {
  return useTable((s) => s.actions)
}
```

- [ ] **Step 9: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS em `throttle`, `sync-client`, `undo`, `reducers`.

- [ ] **Step 10: Checkpoint** — `pnpm test` verde.

---
### Task 9: Web — página da mesa e interface ao redor do canvas

**Files:**
- Modify (substituir inteiro): `apps/web/src/ui/TablePage.tsx`
- Create: `apps/web/src/ui/NicknameModal.tsx`, `Toolbar.tsx`, `LayerSelect.tsx`, `MembersPanel.tsx`, `ConnectionBanner.tsx`, `Toasts.tsx`, `DebugPanel.tsx`, `useKeyboard.ts`
- Create: `apps/web/src/canvas/TableCanvas.tsx` (placeholder; substituído no Task 10)

**Interfaces:**
- Consumes: `createTableStore`, `TableStoreContext`, `useTable`, `useTableActions`, `useTableStore` (Task 8); `getNickname`, `setNickname` (Task 6).
- Produces:
  - `<TablePage tableId>`: pede apelido (se não houver), conecta, mostra "Mesa não encontrada" em erro fatal, expõe a store em `window.__mesa` quando a URL tem `?debug=1`.
  - Rótulos acessíveis usados no E2E: campo **"Seu apelido"**, botão **"Entrar"**, select **"Camada ativa"**, botões **"Selecionar (V)"**, **"Mão (H)"**, **"Lápis (P)"**, **"Borracha (E)"**, **"Desfazer (Ctrl+Z)"**.
  - `useKeyboard()`: V/H/P/E trocam ferramenta; Delete/Backspace apagam a seleção; Ctrl/Cmd+Z desfaz; ignora quando o foco está em input/select/textarea.

- [ ] **Step 1: Componentes**

`apps/web/src/canvas/TableCanvas.tsx` (placeholder):
```tsx
export function TableCanvas() {
  return null
}
```

`apps/web/src/ui/NicknameModal.tsx`:
```tsx
import { useState } from 'react'

export function NicknameModal({ onSubmit }: { onSubmit: (nickname: string) => void }) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onSubmit(trimmed.slice(0, 32))
        }}
      >
        <h2>Entrar na mesa</h2>
        <label>
          Seu apelido
          <input autoFocus value={value} maxLength={32} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />
        </label>
        <button type="submit" disabled={!trimmed}>Entrar</button>
      </form>
    </div>
  )
}
```

`apps/web/src/ui/Toolbar.tsx`:
```tsx
import type { Tool } from '../store/state'
import { useTable, useTableActions } from '../store/context'

const TOOLS: Array<{ tool: Tool; label: string; icon: string }> = [
  { tool: 'select', label: 'Selecionar (V)', icon: '↖' },
  { tool: 'hand', label: 'Mão (H)', icon: '✋' },
  { tool: 'pencil', label: 'Lápis (P)', icon: '✏️' },
  { tool: 'eraser', label: 'Borracha (E)', icon: '🧽' },
]

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const color = useTable((s) => s.color)
  const strokeWidth = useTable((s) => s.strokeWidth)
  const actions = useTableActions()

  return (
    <div className="panel toolbar">
      {TOOLS.map((t) => (
        <button key={t.tool} aria-label={t.label} title={t.label} aria-pressed={tool === t.tool} onClick={() => actions.setTool(t.tool)}>
          {t.icon}
        </button>
      ))}
      <input type="color" aria-label="Cor do traço" title="Cor do traço" value={color} onChange={(e) => actions.setColor(e.target.value)} />
      <input
        type="range" aria-label="Espessura do traço" title="Espessura do traço"
        min={1} max={30} value={strokeWidth}
        onChange={(e) => actions.setStrokeWidth(Number(e.target.value))}
        style={{ width: 44 }}
      />
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>↶</button>
    </div>
  )
}
```

`apps/web/src/ui/LayerSelect.tsx`:
```tsx
import { useTable, useTableActions } from '../store/context'

export function LayerSelect() {
  const layers = useTable((s) => s.layers)
  const active = useTable((s) => s.activeLayerId)
  const actions = useTableActions()
  return (
    <label>
      Camada ativa{' '}
      <select value={active} onChange={(e) => actions.setActiveLayer(e.target.value)}>
        {layers.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {l.visibility === 'gm' ? ' (só mestre)' : ''}
          </option>
        ))}
      </select>
    </label>
  )
}
```

`apps/web/src/ui/MembersPanel.tsx`:
```tsx
import { useTable } from '../store/context'

export function MembersPanel() {
  const members = useTable((s) => s.members)
  const selfId = useTable((s) => s.self?.clientId)
  const list = Object.values(members).sort(
    (a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname),
  )
  return (
    <div className="panel members">
      <strong>Na mesa</strong>
      <ul>
        {list.map((m) => (
          <li key={m.clientId} className={m.online ? '' : 'offline'}>
            <span className="dot" style={{ background: m.color }} />
            {m.nickname}
            {m.clientId === selfId ? ' (você)' : ''}
            {m.role === 'gm' ? ' · mestre' : ''}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

`apps/web/src/ui/ConnectionBanner.tsx`:
```tsx
import { useTable } from '../store/context'

export function ConnectionBanner() {
  const status = useTable((s) => s.status)
  if (status === 'connecting') return <div className="panel banner">Conectando…</div>
  if (status === 'reconnecting') return <div className="panel banner">Reconectando… (edição pausada)</div>
  return null
}
```

`apps/web/src/ui/Toasts.tsx`:
```tsx
import { useEffect } from 'react'
import type { Toast } from '../store/state'
import { useTable, useTableActions } from '../store/context'

export function Toasts() {
  const toasts = useTable((s) => s.toasts)
  return (
    <div className="panel toasts" role="status">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} />
      ))}
    </div>
  )
}

function ToastItem({ toast }: { toast: Toast }) {
  const actions = useTableActions()
  useEffect(() => {
    const id = setTimeout(() => actions.dismissToast(toast.id), toast.action ? 8000 : 4000)
    return () => clearTimeout(id)
  }, [actions, toast.id, toast.action])
  return (
    <div className="toast">
      <span>{toast.text}</span>
      {toast.action && (
        <button
          onClick={() => {
            toast.action!.run()
            actions.dismissToast(toast.id)
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  )
}
```

`apps/web/src/ui/DebugPanel.tsx`:
```tsx
import { useEffect, useState } from 'react'
import { useTableStore } from '../store/context'

export function DebugPanel() {
  const store = useTableStore()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000)
    return () => clearInterval(id)
  }, [])
  const s = store.getState()
  const stats = s.actions.stats()
  return (
    <div className="panel debug">
      msgs enviadas: {stats.sent}
      <br />
      msgs recebidas: {stats.received}
      <br />
      escritas confirmadas: {stats.writes}
      <br />
      ops pendentes: {Object.keys(s.pending).length}
      <br />
      objetos: {Object.keys(s.objects).length}
    </div>
  )
}
```

`apps/web/src/ui/useKeyboard.ts`:
```ts
import { useEffect } from 'react'
import { useTableStore } from '../store/context'

export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
}

export function useKeyboard(): void {
  const store = useTableStore()
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const { actions, selectedId } = store.getState()
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        actions.undo()
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      switch (e.key.toLowerCase()) {
        case 'v': actions.setTool('select'); break
        case 'h': actions.setTool('hand'); break
        case 'p': actions.setTool('pencil'); break
        case 'e': actions.setTool('eraser'); break
        case 'delete':
        case 'backspace':
          if (selectedId) {
            actions.submit({ kind: 'delete', id: selectedId })
            actions.select(null)
          }
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [store])
}
```

`apps/web/src/ui/TablePage.tsx` (substitui o placeholder):
```tsx
import { useEffect, useMemo, useState } from 'react'
import { TableCanvas } from '../canvas/TableCanvas'
import { getNickname, setNickname } from '../lib/identity'
import { TableStoreContext, useTable } from '../store/context'
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
      <TableCanvas />
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
```

- [ ] **Step 2: Contador de escritas na store**

O `DebugPanel` usa `stats().writes`. Em `apps/web/src/store/tableStore.ts`:
1. Na interface `TableActions`, trocar `stats(): { sent: number; received: number }` por:
```ts
  stats(): { sent: number; received: number; writes: number }
```
2. Logo após `const dragThrottles = new Map<string, Throttled<[Geometry]>>()`, adicionar:
```ts
  let writes = 0
```
3. Em `connect`, trocar o `onMessage` por:
```ts
          onMessage: (msg) => {
            if (sync !== client) return
            if (msg.t === 'ack') writes++
            set((s) => reduceServer(s, msg, Date.now()))
          },
```
4. Trocar a implementação de `stats` por:
```ts
      stats: () => ({ ...(sync ? sync.stats : { sent: 0, received: 0 }), writes }),
```

- [ ] **Step 3: Verificação**

Run: `pnpm --filter @mesa/web typecheck && pnpm --filter @mesa/web test`
Expected: sem erros; testes PASS.

Manual (com `pnpm dev:worker` e `pnpm dev:web`): criar mesa, abrir link de mestre → modal "Entrar na mesa" → digitar apelido → painel "Na mesa" mostra você com "· mestre", select de camada com 4 opções. Abrir o link de jogador em janela anônima → 3 camadas; o primeiro navegador vê o segundo membro aparecer. Parar o `dev:worker` → banner "Reconectando…"; subir de novo → banner some. Abrir `/t/ZZZZZZZZZZ` → "Mesa não encontrada".

- [ ] **Step 4: Checkpoint** — `pnpm test` verde.

---

### Task 10: Web — canvas (render, pan/zoom, seleção, arrastar, redimensionar, lápis, borracha, presença)

**Files:**
- Modify (substituir inteiro): `apps/web/src/canvas/TableCanvas.tsx`
- Create: `apps/web/src/canvas/hooks.ts`, `nodeChange.ts`, `ImageNode.tsx`, `StrokeNode.tsx`, `SelectionTransformer.tsx`, `Overlay.tsx`, `useDrawingTools.ts`

**Interfaces:**
- Consumes: `useTable`, `useTableActions`, `useTableStore`, `isLockedByOther`, `TableStore` (Task 8); `throttle` (Task 7); `simplifyPoints`, `boundsOf` (Task 2).
- Produces:
  - `geometryFromNode(node: Konva.Node): Geometry`, `commitNodeChange(store: TableStore, id: string, node: Konva.Node, kind: 'drag' | 'transform'): void`
  - `useModifierKeys(): { space: boolean; shift: boolean }`, `useWindowSize(): { width: number; height: number }`, `useNow(intervalMs: number): number`
  - `useDrawingTools(): { ownPreview: { layerId: string; points: number[]; color: string; strokeWidth: number } | null; onDown(e): void; onMove(e): void; onUp(): void }`
  - Nós Konva com `id = object.id` e `name` contendo `object` + `image`|`stroke` (a borracha depende de `name` `stroke`).
  - Canvas ocupa a janela inteira a partir de (0,0); com viewport `{x:0,y:0,scale:1}` coordenada de tela = coordenada de mundo (o E2E depende disso).

- [ ] **Step 1: Hooks utilitários e commit de alterações de nó**

`apps/web/src/canvas/hooks.ts`:
```ts
import { useEffect, useState } from 'react'
import { isTypingTarget } from '../ui/useKeyboard'

export function useModifierKeys(): { space: boolean; shift: boolean } {
  const [space, setSpace] = useState(false)
  const [shift, setShift] = useState(false)
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(true)
      if (e.code === 'Space' && !isTypingTarget(e.target)) {
        e.preventDefault()
        setSpace(true)
      }
    }
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShift(false)
      if (e.code === 'Space') setSpace(false)
    }
    const reset = () => {
      setSpace(false)
      setShift(false)
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', reset)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', reset)
    }
  }, [])
  return { space, shift }
}

export function useWindowSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: window.innerWidth, height: window.innerHeight })
  useEffect(() => {
    const onResize = () => setSize({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return size
}

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs])
  return now
}
```

`apps/web/src/canvas/nodeChange.ts`:
```ts
import type Konva from 'konva'
import type { ObjectPatch } from '@mesa/shared'
import type { Geometry } from '../store/state'
import type { TableStore } from '../store/tableStore'

export function geometryFromNode(node: Konva.Node): Geometry {
  return {
    x: node.x(),
    y: node.y(),
    width: Math.max(1, node.width() * node.scaleX()),
    height: Math.max(1, node.height() * node.scaleY()),
    rotation: node.rotation(),
  }
}

export function commitNodeChange(store: TableStore, id: string, node: Konva.Node, kind: 'drag' | 'transform'): void {
  const s = store.getState()
  const object = s.objects[id]
  if (!object) return

  const revert = () => {
    node.position({ x: object.x, y: object.y })
    node.scale({ x: 1, y: 1 })
    node.rotation(object.rotation)
    if (object.type === 'image') node.size({ width: object.width, height: object.height })
  }

  if (s.deniedGrabs[id]) {
    revert()
    s.actions.clearDenied(id)
    return
  }

  let patch: ObjectPatch
  if (kind === 'drag') {
    patch = { x: node.x(), y: node.y() }
  } else {
    const g = geometryFromNode(node)
    // Konva redimensiona via scale; normalizamos para width/height com scale 1.
    node.scale({ x: 1, y: 1 })
    node.size({ width: g.width, height: g.height })
    patch = g
  }
  if (!s.actions.submit({ kind: 'update', id, patch })) revert()
  s.actions.release(id)
}
```

- [ ] **Step 2: Nós de imagem e traço**

`apps/web/src/canvas/ImageNode.tsx`:
```tsx
import { Image as KonvaImage } from 'react-konva'
import useImage from 'use-image'
import type { ImageObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { commitNodeChange, geometryFromNode } from './nodeChange'

export function ImageNode({ object }: { object: ImageObject }) {
  const [image] = useImage(`/files/${object.assetKey}`)
  const store = useTableStore()
  const actions = useTableActions()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const g = lockedByOther && preview ? preview : object
  const interactive = tool === 'select' && !lockedByOther

  return (
    <KonvaImage
      id={object.id}
      name="object image"
      image={image}
      x={g.x}
      y={g.y}
      width={g.width}
      height={g.height}
      rotation={g.rotation}
      draggable={interactive}
      onMouseDown={() => {
        if (interactive) actions.select(object.id)
      }}
      onDragStart={() => actions.grab(object.id)}
      onDragMove={(e) => actions.dragPreview(object.id, geometryFromNode(e.target))}
      onDragEnd={(e) => commitNodeChange(store, object.id, e.target, 'drag')}
      onTransformStart={() => actions.grab(object.id)}
      onTransform={(e) => actions.dragPreview(object.id, geometryFromNode(e.target))}
      onTransformEnd={(e) => commitNodeChange(store, object.id, e.target, 'transform')}
    />
  )
}
```

`apps/web/src/canvas/StrokeNode.tsx`:
```tsx
import { Line } from 'react-konva'
import type { StrokeObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { commitNodeChange } from './nodeChange'

export function StrokeNode({ object }: { object: StrokeObject }) {
  const store = useTableStore()
  const actions = useTableActions()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const pos = lockedByOther && preview ? preview : object
  const interactive = tool === 'select' && !lockedByOther

  return (
    <Line
      id={object.id}
      name="object stroke"
      x={pos.x}
      y={pos.y}
      points={object.points}
      stroke={object.color}
      strokeWidth={object.strokeWidth}
      hitStrokeWidth={Math.max(object.strokeWidth, 12)}
      lineCap="round"
      lineJoin="round"
      draggable={interactive}
      onMouseDown={() => {
        if (interactive) actions.select(object.id)
      }}
      onDragStart={() => actions.grab(object.id)}
      onDragMove={(e) =>
        actions.dragPreview(object.id, { x: e.target.x(), y: e.target.y(), width: object.width, height: object.height, rotation: 0 })
      }
      onDragEnd={(e) => commitNodeChange(store, object.id, e.target, 'drag')}
    />
  )
}
```

- [ ] **Step 3: Transformer de seleção e overlay de presença**

`apps/web/src/canvas/SelectionTransformer.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import type Konva from 'konva'
import { Transformer } from 'react-konva'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'

export function SelectionTransformer({ keepRatio }: { keepRatio: boolean }) {
  const ref = useRef<Konva.Transformer>(null)
  const object = useTable((s) => (s.selectedId ? s.objects[s.selectedId] : undefined))
  const tool = useTable((s) => s.tool)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const lockedByOther = useTable((s) => (s.selectedId ? isLockedByOther(s, s.selectedId, Date.now()) : false))

  // Só imagens redimensionam/giram; traços apenas se movem.
  const targetId =
    object && object.type === 'image' && object.layerId === activeLayerId && tool === 'select' && !lockedByOther
      ? object.id
      : null

  useEffect(() => {
    const tr = ref.current
    if (!tr) return
    const node = targetId ? tr.getStage()?.findOne(`#${targetId}`) : undefined
    tr.nodes(node ? [node] : [])
    tr.getLayer()?.batchDraw()
  }, [targetId, object])

  return (
    <Transformer
      ref={ref}
      keepRatio={keepRatio}
      enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
      flipEnabled={false}
      boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10 ? oldBox : newBox)}
    />
  )
}
```

`apps/web/src/canvas/Overlay.tsx`:
```tsx
import { Circle, Group, Layer, Line, Rect, Text } from 'react-konva'
import { useTable } from '../store/context'
import { useNow } from './hooks'

export function Overlay() {
  const now = useNow(1000)
  const cursors = useTable((s) => s.cursors)
  const members = useTable((s) => s.members)
  const locks = useTable((s) => s.locks)
  const objects = useTable((s) => s.objects)
  const dragPreviews = useTable((s) => s.dragPreviews)
  const strokePreviews = useTable((s) => s.strokePreviews)
  const scale = useTable((s) => s.viewport.scale)
  const selfId = useTable((s) => s.self?.clientId)

  return (
    <Layer listening={false}>
      {Object.entries(strokePreviews).map(([id, p]) => (
        <Line key={id} points={p.points} stroke={p.color} strokeWidth={p.strokeWidth} lineCap="round" lineJoin="round" />
      ))}

      {Object.entries(locks).map(([objectId, lock]) => {
        if (lock.clientId === selfId || lock.expiresAt <= now) return null
        const object = objects[objectId]
        if (!object) return null
        const g = dragPreviews[objectId] ?? object
        const member = members[lock.clientId]
        const color = member?.color ?? '#ffffff'
        return (
          <Group key={objectId} x={g.x} y={g.y} rotation={object.type === 'image' ? g.rotation : 0}>
            <Rect width={g.width} height={g.height} stroke={color} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
            <Text text={member?.nickname ?? '?'} y={-16 / scale} fontSize={12 / scale} fill={color} />
          </Group>
        )
      })}

      {Object.entries(cursors).map(([clientId, c]) => {
        const member = members[clientId]
        if (!member) return null
        return (
          <Group key={clientId} x={c.x} y={c.y} scaleX={1 / scale} scaleY={1 / scale}>
            <Circle radius={5} fill={member.color} />
            <Text text={member.nickname} x={8} y={-4} fontSize={12} fill={member.color} />
          </Group>
        )
      })}
    </Layer>
  )
}
```

- [ ] **Step 4: Lápis e borracha**

`apps/web/src/canvas/useDrawingTools.ts`:
```ts
import { useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { nanoid } from 'nanoid'
import { boundsOf, simplifyPoints } from '@mesa/shared'
import { throttle } from '../lib/throttle'
import { useTableStore } from '../store/context'

interface OwnPreview {
  layerId: string
  points: number[]
  color: string
  strokeWidth: number
}

export function useDrawingTools() {
  const store = useTableStore()
  const [ownPreview, setOwnPreview] = useState<OwnPreview | null>(null)
  const current = useRef<{ strokeId: string; layerId: string; points: number[]; unsent: number[] } | null>(null)
  const erased = useRef(new Set<string>())

  // Envia só os pontos novos desde o último envio (~30/s); quem recebe concatena.
  const flushPreview = useMemo(
    () =>
      throttle(() => {
        const cur = current.current
        if (!cur || cur.unsent.length === 0) return
        const s = store.getState()
        s.actions.sendPresence({
          kind: 'stroke', strokeId: cur.strokeId, layerId: cur.layerId,
          points: cur.unsent, color: s.color, strokeWidth: s.strokeWidth,
        })
        cur.unsent = []
      }, 33),
    [store],
  )

  const eraseTarget = (target: Konva.Node) => {
    if (!target.hasName('stroke')) return
    const id = target.id()
    if (erased.current.has(id)) return
    const s = store.getState()
    const object = s.objects[id]
    if (!object || object.layerId !== s.activeLayerId) return
    erased.current.add(id)
    s.actions.submit({ kind: 'delete', id })
  }

  const onDown = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool === 'eraser') {
      erased.current.clear()
      eraseTarget(e.target)
      return
    }
    if (s.tool !== 'pencil' || e.evt.button !== 0) return
    if (s.status !== 'open' || !s.actions.canEditLayer(s.activeLayerId)) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    current.current = { strokeId: nanoid(), layerId: s.activeLayerId, points: [pos.x, pos.y], unsent: [pos.x, pos.y] }
    setOwnPreview({ layerId: s.activeLayerId, points: [pos.x, pos.y], color: s.color, strokeWidth: s.strokeWidth })
    flushPreview()
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool === 'eraser') {
      if (e.evt.buttons & 1) eraseTarget(e.target)
      return
    }
    const cur = current.current
    if (!cur) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    cur.points.push(pos.x, pos.y)
    cur.unsent.push(pos.x, pos.y)
    setOwnPreview((p) => (p ? { ...p, points: [...cur.points] } : p))
    flushPreview()
  }

  const onUp = () => {
    const cur = current.current
    if (!cur) return
    current.current = null
    flushPreview.flush()
    setOwnPreview(null)
    const s = store.getState()
    s.actions.sendPresence({ kind: 'strokeEnd', strokeId: cur.strokeId })

    let points = simplifyPoints(cur.points, 1 / s.viewport.scale)
    if (points.length < 4) points = [points[0], points[1], points[0] + 0.01, points[1]]
    if (points.length > 20000) points = simplifyPoints(points, 4 / s.viewport.scale).slice(0, 20000)
    const b = boundsOf(points)
    s.actions.submit({
      kind: 'create',
      object: {
        id: cur.strokeId,
        type: 'stroke',
        layerId: cur.layerId,
        x: b.minX,
        y: b.minY,
        width: b.width,
        height: b.height,
        rotation: 0,
        zIndex: s.actions.nextZ(cur.layerId),
        points: points.map((v, i) => (i % 2 === 0 ? v - b.minX : v - b.minY)),
        color: s.color,
        strokeWidth: s.strokeWidth,
      },
    })
  }

  return { ownPreview, onDown, onMove, onUp }
}
```

- [ ] **Step 5: Canvas principal**

`apps/web/src/canvas/TableCanvas.tsx` (substitui o placeholder):
```tsx
import { useMemo } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Layer, Line, Stage } from 'react-konva'
import type { TableObject } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { useModifierKeys, useWindowSize } from './hooks'
import { ImageNode } from './ImageNode'
import { Overlay } from './Overlay'
import { SelectionTransformer } from './SelectionTransformer'
import { StrokeNode } from './StrokeNode'
import { useDrawingTools } from './useDrawingTools'

const MIN_SCALE = 0.1
const MAX_SCALE = 8

export function TableCanvas() {
  const layers = useTable((s) => s.layers)
  const objects = useTable((s) => s.objects)
  const tool = useTable((s) => s.tool)
  const viewport = useTable((s) => s.viewport)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const actions = useTableActions()
  const { space, shift } = useModifierKeys()
  const size = useWindowSize()
  const drawing = useDrawingTools()
  const panning = tool === 'hand' || space

  const byLayer = useMemo(() => {
    const groups: Record<string, TableObject[]> = {}
    for (const o of Object.values(objects)) (groups[o.layerId] ??= []).push(o)
    for (const list of Object.values(groups)) list.sort((a, b) => a.zIndex - b.zIndex)
    return groups
  }, [objects])

  const onWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault()
    const stage = e.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    const factor = e.evt.deltaY < 0 ? 1.1 : 1 / 1.1
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, viewport.scale * factor))
    const worldX = (pointer.x - viewport.x) / viewport.scale
    const worldY = (pointer.y - viewport.y) / viewport.scale
    actions.setViewport({ scale, x: pointer.x - worldX * scale, y: pointer.y - worldY * scale })
  }

  // Mantém o viewport da store em sincronia durante o pan; senão um re-render no meio
  // do arrasto devolveria o Stage para a posição antiga.
  const onStageDrag = (e: KonvaEventObject<DragEvent>) => {
    if (e.target === e.target.getStage()) actions.setViewport({ ...viewport, x: e.target.x(), y: e.target.y() })
  }

  const cursor = panning ? 'grab' : tool === 'pencil' ? 'crosshair' : tool === 'eraser' ? 'cell' : 'default'

  return (
    <Stage
      width={size.width}
      height={size.height}
      x={viewport.x}
      y={viewport.y}
      scaleX={viewport.scale}
      scaleY={viewport.scale}
      draggable={panning}
      style={{ position: 'absolute', inset: 0, cursor }}
      onWheel={onWheel}
      onDragMove={onStageDrag}
      onDragEnd={onStageDrag}
      onMouseDown={(e) => {
        if (panning) return
        if (tool === 'select' && e.target === e.target.getStage()) actions.select(null)
        drawing.onDown(e)
      }}
      onMouseMove={(e) => {
        const pos = e.target.getStage()?.getRelativePointerPosition()
        if (pos) actions.cursor(pos.x, pos.y)
        if (!panning) drawing.onMove(e)
      }}
      onMouseUp={drawing.onUp}
      onMouseLeave={drawing.onUp}
    >
      {layers.map((layer) => {
        const active = layer.id === activeLayerId
        return (
          <Layer key={layer.id} listening={active && !panning}>
            {(byLayer[layer.id] ?? []).map((o) =>
              o.type === 'image' ? <ImageNode key={o.id} object={o} /> : <StrokeNode key={o.id} object={o} />,
            )}
            {drawing.ownPreview?.layerId === layer.id && (
              <Line
                points={drawing.ownPreview.points}
                stroke={drawing.ownPreview.color}
                strokeWidth={drawing.ownPreview.strokeWidth}
                lineCap="round"
                lineJoin="round"
                listening={false}
              />
            )}
            {active && <SelectionTransformer keepRatio={!shift} />}
          </Layer>
        )
      })}
      <Overlay />
    </Stage>
  )
}
```

- [ ] **Step 6: Verificação**

Run: `pnpm --filter @mesa/web typecheck && pnpm --filter @mesa/web test`
Expected: sem erros; testes PASS.

Manual com duas janelas (mestre + jogador anônimo), ainda sem upload — testar com desenho:
1. Jogador: camada "Desenhos", tecla `P`, desenhar → o mestre vê o traço sendo desenhado ao vivo e o traço final ao soltar.
2. Jogador: `V`, arrastar o traço → o mestre vê o movimento ao vivo com contorno tracejado na cor e apelido do jogador; tentar arrastar o mesmo traço no mestre durante o movimento não funciona.
3. `Ctrl+Z` no jogador → o movimento é desfeito nos dois; `Ctrl+Z` de novo → o traço some.
4. `E` (borracha) e passar sobre um traço com o botão pressionado → apaga.
5. Roda do mouse dá zoom no ponto do cursor; `Espaço` + arrastar e ferramenta `H` fazem pan.
6. Mover o mouse → o outro vê o cursor com o apelido.
7. Mestre: camada "Mestre", desenhar → o jogador não vê nem a prévia nem o traço.

- [ ] **Step 7: Checkpoint** — `pnpm test` verde.

---

### Task 11: Web — upload de imagens (mapa e tokens)

**Files:**
- Create: `apps/web/src/lib/image.ts`
- Modify: `apps/web/src/store/tableStore.ts` (nova ação `addImageFile`)
- Modify: `apps/web/src/ui/Toolbar.tsx` (botão e input de arquivo)
- Modify: `apps/web/src/ui/TablePage.tsx` (soltar arquivo no canvas)
- Test: `apps/web/test/image.test.ts`

**Interfaces:**
- Consumes: `uploadAsset` (Task 6); `MAX_IMAGE_SIDE`, `TOKEN_INITIAL_SIDE` (Task 1); `TableActions` (Task 8).
- Produces:
  - `fitWithin(width: number, height: number, max: number): { width: number; height: number }`
  - `initialSize(layerId: string, width: number, height: number): { width: number; height: number }` — `map` mantém tamanho; demais camadas: maior lado = 70
  - `viewportCenter(v: Viewport, screenW: number, screenH: number): { x: number; y: number }`
  - `prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }>`
  - `TableActions.addImageFile(file: Blob, at?: { x: number; y: number }): Promise<void>`
  - Input escondido com `data-testid="image-input"` (usado no E2E)

- [ ] **Step 1: Teste falhando**

`apps/web/test/image.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { fitWithin, initialSize, viewportCenter } from '../src/lib/image'

describe('fitWithin', () => {
  it('reduz mantendo proporção', () => {
    expect(fitWithin(8000, 4000, 4096)).toEqual({ width: 4096, height: 2048 })
  })
  it('não amplia imagens pequenas', () => {
    expect(fitWithin(100, 50, 4096)).toEqual({ width: 100, height: 50 })
  })
})

describe('initialSize', () => {
  it('mapa mantém tamanho original', () => {
    expect(initialSize('map', 800, 600)).toEqual({ width: 800, height: 600 })
  })
  it('token tem maior lado = 70', () => {
    expect(initialSize('tokens', 140, 70)).toEqual({ width: 70, height: 35 })
    expect(initialSize('gm', 10, 20)).toEqual({ width: 35, height: 70 })
  })
})

describe('viewportCenter', () => {
  it('converte centro da tela para mundo', () => {
    expect(viewportCenter({ x: 100, y: 50, scale: 2 }, 1000, 600)).toEqual({ x: 200, y: 125 })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/web test -- test/image.test.ts`
Expected: FAIL — módulo não encontrado.

- [ ] **Step 3: Implementar utilitários de imagem**

`apps/web/src/lib/image.ts`:
```ts
import { MAX_IMAGE_SIDE, TOKEN_INITIAL_SIDE } from '@mesa/shared'
import type { Viewport } from '../store/state'

export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const k = Math.min(1, max / Math.max(width, height))
  return { width: Math.round(width * k), height: Math.round(height * k) }
}

export function initialSize(layerId: string, width: number, height: number): { width: number; height: number } {
  if (layerId === 'map') return { width, height }
  const k = TOKEN_INITIAL_SIDE / Math.max(width, height)
  return { width: width * k, height: height * k }
}

export function viewportCenter(v: Viewport, screenW: number, screenH: number): { x: number; y: number } {
  return { x: (screenW / 2 - v.x) / v.scale, y: (screenH / 2 - v.y) / v.scale }
}

// Redimensiona e converte para WebP no navegador. Se o navegador não codificar WebP,
// toBlob devolve PNG — o servidor aceita os dois.
export async function prepareImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  const bitmap = await createImageBitmap(file)
  const { width, height } = fitWithin(bitmap.width, bitmap.height, MAX_IMAGE_SIDE)
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, width, height)
  bitmap.close()
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode_failed'))), 'image/webp', 0.85),
  )
  return { blob, width, height }
}
```

- [ ] **Step 4: Ação `addImageFile` na store**

Em `apps/web/src/store/tableStore.ts`:
1. Adicionar imports:
```ts
import { uploadAsset } from '../lib/api'
import { initialSize, prepareImage, viewportCenter } from '../lib/image'
```
(o import de `wsUrl` já existe de `'../lib/api'`; junte numa linha só: `import { uploadAsset, wsUrl } from '../lib/api'`.)
2. Na interface `TableActions`, adicionar:
```ts
  addImageFile(file: Blob, at?: { x: number; y: number }): Promise<void>
```
3. No objeto `actions`, adicionar:
```ts
      async addImageFile(file, at) {
        try {
          const prepared = await prepareImage(file)
          const assetKey = await uploadAsset(tableId, prepared.blob)
          const s = get()
          const layerId = s.activeLayerId
          const size = initialSize(layerId, prepared.width, prepared.height)
          const center = at ?? viewportCenter(s.viewport, window.innerWidth, window.innerHeight)
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
        } catch {
          set((s) =>
            addToast(s, 'Falha ao enviar a imagem', { label: 'Tentar novamente', run: () => void actions.addImageFile(file, at) }),
          )
        }
      },
```

- [ ] **Step 5: Botão na barra e soltar arquivo no canvas**

Em `apps/web/src/ui/Toolbar.tsx`:
1. Adicionar `import { useRef } from 'react'` no topo.
2. Dentro de `Toolbar`, após `const actions = useTableActions()`:
```tsx
  const fileInput = useRef<HTMLInputElement>(null)
```
3. Antes do `<input type="color" …>`, adicionar:
```tsx
      <button aria-label="Adicionar imagem" title="Adicionar imagem na camada ativa" onClick={() => fileInput.current?.click()}>
        🖼️
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        hidden
        data-testid="image-input"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void actions.addImageFile(file)
          e.target.value = ''
        }}
      />
```

Em `apps/web/src/ui/TablePage.tsx`, dentro de `TableView`:
1. Adicionar `import { useTableActions } from '../store/context'` (junte ao import existente de `../store/context`) e `const actions = useTableActions()` e `const viewport = useTable((s) => s.viewport)` logo após `const name = …`.
2. Trocar `<TableCanvas />` por:
```tsx
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
```

- [ ] **Step 6: Verificação**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

Manual (mestre + jogador):
1. Camada "Mapa" → 🖼️ → escolher um mapa grande (ex.: 6000 px) → aparece no tamanho reduzido (≤ 4096) nos dois navegadores.
2. Camada "Tokens" → arrastar um arquivo do sistema para o canvas → token de 70 px no ponto do drop.
3. Selecionar o token → alças nos cantos; redimensionar mantém proporção; com `Shift` deforma; girar pela alça de rotação → o outro vê ao vivo e o resultado final.
4. Com "Tokens" ativa, clicar no mapa não o seleciona (só objetos da camada ativa).
5. Parar o worker e tentar subir imagem → toast "Falha ao enviar a imagem" com "Tentar novamente"; subir o worker e clicar → imagem aparece.
6. Recarregar a página do jogador → tudo continua lá.

- [ ] **Step 7: Checkpoint** — `pnpm test` verde.

---

### Task 12: Testes ponta a ponta (Playwright)

**Files:**
- Create: `playwright.config.ts`, `e2e/table.spec.ts`

**Interfaces:**
- Consumes: rótulos e `data-testid` dos Tasks 9–11; `window.__mesa` com `?debug=1` (Task 9); `POST /api/tables` (Task 4).

- [ ] **Step 1: Configuração**

Run:
```bash
pnpm add -w -D @playwright/test
pnpm exec playwright install chromium
```

`playwright.config.ts`:
```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: 'http://localhost:8787', viewport: { width: 1280, height: 720 } },
  webServer: {
    command: 'pnpm build && pnpm --filter @mesa/worker exec wrangler dev --port 8787',
    url: 'http://localhost:8787',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
})
```

- [ ] **Step 2: Escrever os testes**

`e2e/table.spec.ts`:
```ts
import { expect, test, type Browser, type Page } from '@playwright/test'

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

interface Obj { id: string; type: string; layerId: string; x: number; y: number; width: number; height: number }

async function newTable(page: Page): Promise<{ tableId: string; gmSecret: string }> {
  const res = await page.request.post('/api/tables', { data: { name: 'E2E' } })
  expect(res.status()).toBe(201)
  return res.json()
}

const waitOpen = (page: Page) =>
  page.waitForFunction(() => (window as any).__mesa?.getState().status === 'open')

const objects = (page: Page): Promise<Obj[]> =>
  page.evaluate(() => Object.values((window as any).__mesa.getState().objects))

async function open(browser: Browser, path: string, nickname: string): Promise<Page> {
  const page = await (await browser.newContext()).newPage()
  await page.goto(path)
  await page.getByLabel('Seu apelido').fill(nickname)
  await page.getByRole('button', { name: 'Entrar' }).click()
  await waitOpen(page)
  return page
}

async function uploadToken(page: Page): Promise<void> {
  const loaded = page.waitForResponse((r) => r.url().includes('/files/') && r.ok())
  await page.getByTestId('image-input').setInputFiles({ name: 'token.png', mimeType: 'image/png', buffer: PNG })
  await loaded
  await page.waitForTimeout(200) // imagem desenhada → área clicável pronta
}

test('token arrastado pelo mestre se move na tela do jogador', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)

  const [token] = await objects(gm)
  const cx = token.x + token.width / 2
  const cy = token.y + token.height / 2
  await gm.mouse.move(cx, cy)
  await gm.mouse.down()
  await gm.mouse.move(cx + 100, cy + 50, { steps: 10 })
  await gm.mouse.up()

  await expect.poll(async () => Math.round((await objects(player))[0].x)).toBe(Math.round(token.x + 100))
})

test('jogador não vê a camada do mestre', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await expect(player.getByLabel('Camada ativa').locator('option')).toHaveCount(3)
  await gm.getByLabel('Camada ativa').selectOption('gm')
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.waitForTimeout(500)
  expect(await objects(player)).toHaveLength(0)
})

test('desenho aparece para o outro, persiste após recarregar e Ctrl+Z desfaz', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await player.getByLabel('Camada ativa').selectOption('drawings')
  await player.getByRole('button', { name: 'Lápis (P)' }).click()
  await player.mouse.move(300, 300)
  await player.mouse.down()
  await player.mouse.move(400, 350, { steps: 10 })
  await player.mouse.move(450, 300, { steps: 10 })
  await player.mouse.up()

  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(1)

  await player.reload()
  await waitOpen(player)
  expect((await objects(player)).filter((o) => o.type === 'stroke')).toHaveLength(1)

  // a pilha de desfazer é por sessão: desenhar de novo e desfazer
  await player.getByLabel('Camada ativa').selectOption('drawings')
  await player.getByRole('button', { name: 'Lápis (P)' }).click()
  await player.mouse.move(500, 400)
  await player.mouse.down()
  await player.mouse.move(600, 450, { steps: 5 })
  await player.mouse.up()
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(2)
  await player.keyboard.press('Control+z')
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(1)
})

test('link de mesa inexistente mostra aviso', async ({ browser }) => {
  const page = await (await browser.newContext()).newPage()
  await page.goto('/t/ZZZZZZZZZZ')
  await page.getByLabel('Seu apelido').fill('Ana')
  await page.getByRole('button', { name: 'Entrar' }).click()
  await expect(page.getByText('Mesa não encontrada.')).toBeVisible()
})
```

- [ ] **Step 3: Rodar**

Run: `pnpm e2e`
Expected: 4 testes PASS. Se um teste de arrasto falhar por a imagem ainda não estar desenhada, aumente o `waitForTimeout` de `uploadToken` — não troque a lógica do teste.

- [ ] **Step 4: Checkpoint** — `pnpm test && pnpm e2e` verdes.

---

### Task 13: Rodar em casa (VPN/túnel) e publicar na Cloudflare

**Files:**
- Create: `README.md`
- Modify: `package.json` (raiz — scripts `host` e `tunnel`)

**Interfaces:**
- Consumes: scripts `build`, `deploy` (Task 1); `wrangler.jsonc` (Task 3).
- Produces: `pnpm host` (build + servidor local persistente em :8787) e `pnpm tunnel` (Cloudflare Quick Tunnel apontando para :8787). **Modo principal escolhido pelo usuário: Quick Tunnel.**

- [ ] **Step 0: Scripts de hospedagem local**

No `package.json` da raiz, adicionar em `scripts`:
```json
    "host": "pnpm build && pnpm --filter @mesa/worker exec wrangler dev --ip 0.0.0.0 --port 8787",
    "tunnel": "cloudflared tunnel --url http://localhost:8787"
```
O `cloudflared` é instalado à parte (binário oficial da Cloudflare; no Linux: pacote `.deb`/`.rpm` ou binário do GitHub `cloudflare/cloudflared`). Não precisa de conta para Quick Tunnel.

- [ ] **Step 1: README com os modos de hospedagem**

`README.md`:
````markdown
# Mesa Virtual

Mesa colaborativa estilo Roll20: mapa, tokens, desenho e camada do mestre em tempo real.

## Desenvolvimento

```bash
pnpm install
pnpm dev:worker   # API + Durable Object + R2 locais em :8787
pnpm dev:web      # front com hot reload em :5173 (proxy para :8787)
pnpm test         # unitários + Durable Object
pnpm e2e          # ponta a ponta (sobe o servidor sozinho)
```

## Opção A — rodar na sua máquina (sem conta Cloudflare)

O `wrangler dev` simula Worker, Durable Object (SQLite) e R2 localmente e salva tudo em
`apps/worker/.wrangler/state/` — as mesas sobrevivem a reinícios. Faça backup copiando essa pasta.

```bash
pnpm host     # terminal 1: servidor local persistente
pnpm tunnel   # terminal 2: imprime o link https://….trycloudflare.com para o grupo
```

Seu computador precisa ficar ligado durante a sessão. Alternativas ao túnel: Para os jogadores alcançarem:

- **VPN (Tailscale, ZeroTier, Hamachi…)**: todos entram na mesma rede virtual e acessam
  `http://<IP-da-VPN-do-host>:8787`. Libere a porta 8787 no firewall do host.
  Confira o limite de membros do plano gratuito da VPN escolhida (são 7 pessoas contando o host;
  o Hamachi gratuito, por exemplo, costuma limitar redes a 5).
- **Cloudflare Quick Tunnel (sem VPN, sem conta)**: em outro terminal,
  `cloudflared tunnel --url http://localhost:8787` imprime um link `https://….trycloudflare.com`.
  Mande esse link para o grupo. O endereço muda a cada execução, então crie a mesa pelo link
  novo ou troque só o domínio nos links antigos (o `/t/<id>` continua valendo).

Acesso por `http://` em IP funciona; o app já trata a falta de `crypto.randomUUID` fora de HTTPS.

## Opção B — publicar na Cloudflare (grátis, sempre no ar)

```bash
pnpm --filter @mesa/worker exec wrangler login
pnpm --filter @mesa/worker exec wrangler r2 bucket create mesa-virtual-files
pnpm run deploy
```

O deploy imprime a URL `https://mesa-virtual.<sua-conta>.workers.dev`. Mesas criadas
localmente não vão para a nuvem automaticamente.

## Limites do plano gratuito

Durable Objects (SQLite): 100 mil linhas escritas/dia, 5 milhões lidas/dia, 5 GB no total.
Abra a mesa com `?debug=1` para ver mensagens e escritas da sessão.
````

- [ ] **Step 2: Verificar o modo local com Quick Tunnel**

Run (dois terminais): `pnpm host` e `pnpm tunnel`
Abrir o link `https://….trycloudflare.com` impresso em um celular fora da rede (4G), criar mesa, entrar e desenhar; abrir o mesmo link no computador e ver o desenho em tempo real.
Expected: WebSocket conecta pelo túnel (`wss://`); parar e subir o `pnpm host` de novo mantém a mesa.
Se `cloudflared` não estiver instalado, reporte ao usuário em vez de instalar por conta própria.

Também verificar por IP: de outro dispositivo da mesma rede, `http://<IP-local>:8787` funciona (sem erro de `randomUUID` no console).

- [ ] **Step 3: Publicar (quando o usuário quiser)**

Só executar com autorização explícita do usuário, porque publica na conta Cloudflare dele:
```bash
pnpm --filter @mesa/worker exec wrangler login
pnpm --filter @mesa/worker exec wrangler r2 bucket create mesa-virtual-files
pnpm run deploy
```
Expected: URL `*.workers.dev`; criar mesa, abrir em dois navegadores, subir token, mover, recarregar — tudo persiste.

- [ ] **Step 4: Checkpoint final** — `pnpm test && pnpm e2e` verdes; sessão-teste com o grupo marcada (critério de pronto do spec, seção 9).
