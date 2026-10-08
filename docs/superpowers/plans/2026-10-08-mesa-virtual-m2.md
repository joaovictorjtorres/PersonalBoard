# Mesa Virtual — M2: Camadas, Permissões, Caneta e Polimento — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao mestre controle de camadas (criar, renomear, ocultar, travar, reordenar, remover, mover objetos entre elas), permissões por objeto (com `clientId` não falsificável), título público e anotação privada, caneta configurável com borracha "por onde passa", ícones Lucide, heartbeat, `reject invalid` e lista de membros limpa — sem perder nenhuma mesa do M1.

**Architecture:** O pacote `shared` ganha os novos schemas (controle, título, `segments`, operações de camada/anotação/membro), as funções puras de ordem de camadas e o algoritmo `eraseSegments`. No Worker, o `TableEngine` passa a devolver uma lista de **efeitos** (`OpEffect[]`) por operação e o `TableDO` traduz cada efeito nas mensagens certas para cada destinatário (mestre × jogador); o `SqlStore` normaliza objetos do M1 na leitura e guarda anotações em `gm_notes`. No front, os reducers puros tratam as mensagens novas, aplicam operações de camada/anotação/membro de forma otimista (com reversão) e a pilha de desfazer passa a guardar grupos; a UI ganha painel de camadas, popover da caneta e menu de contexto do objeto.

**Tech Stack:** TypeScript 7, pnpm 12 (corepack), Node 24, Zod 4, Cloudflare Workers + Durable Objects (SQLite) + R2, Wrangler 4.148 (`compatibility_date` 2026-08-22), Vitest (shared 5.x, web 5.0.3, worker 4.1 via `@cloudflare/vitest-pool-workers` 0.23 plugin `cloudflareTest()`), React 19, Vite 8, Konva 10.7.1 + react-konva 19.3, Zustand 5, nanoid, **lucide-react (novo)**, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-08-mesa-virtual-m2-design.md` (base: `docs/superpowers/specs/2026-10-08-mesa-virtual-m1-design.md`)

**Adição pedida depois de uma revisão de segurança (já incorporada ao spec, seção 3.4):** como as permissões do M2 são por `clientId`, o `clientId` deixa de ser falsificável — segredo por cliente (`clientSecret`) emitido no primeiro `hello`, guardado só como hash no servidor e exigido nos `hello` seguintes (Task 4).

**Decisões tomadas onde o spec é omisso (o executor não deve rediscutir):**
- `eraseSegments` ganha um 5º parâmetro opcional `tolerance = 1` (o spec pede RDP com `1 / zoom`, que a assinatura de 4 parâmetros não carrega). Pedaços que a borracha não tocou são devolvidos sem reamostrar; se nada foi tocado, a função devolve **a mesma referência** de `segments` (é assim que o chamador sabe que nada mudou).
- `create` ignora `control` (o `NewObjectSchema` nem aceita o campo). Desfazer um `delete` recria o objeto com título, mas com `control` = lista do autor do desfazer.
- **Desfazer cobre só operações de objeto** (`create`/`update`/`delete`), como no M1. Operações de camada, anotação e membro não entram na pilha.
- Qualquer `update` de jogador que contenha a chave `layerId` ou `control` é `reject forbidden` (mesmo que o valor seja igual ao atual).
- `layerMove` também é recusado (`forbidden`) quando a camada já é a mais baixa e a direção é `down`. `layerDelete` recusado para `gm` ou para a última camada comum usa `forbidden`; o front mostra textos próprios para esses casos.
- Nome de camada: `trim`, 1..40 caracteres (`LAYER_NAME_MAX`). Nome vazio no campo não é enviado; o campo volta ao nome atual.
- O ícone de anotação no canvas é um glifo "nota adesiva" desenhado com formas Konva (componentes React do Lucide não renderizam dentro do canvas).
- O menu de contexto abre só sobre objetos da **camada ativa** (as outras camadas não escutam eventos, como no M1). Para mover um token da camada Mestre, o mestre ativa "Mestre" no painel.
- "Mover para camada" envia `update { layerId, zIndex }` (o objeto vai para o topo da camada de destino); `x`, `y`, `width`, `height` e `rotation` não mudam.
- Para o mestre, a camada ativa só muda quando some da lista (removida); esconder não a remove para ele. O fallback é a camada com `visibility: 'all'` de maior `order` (se não houver, a de maior `order`).
- Toasts com o mesmo texto não se acumulam (uma passada de borracha recusada mostra um toast só).
- O nó do traço vira um `Group` de `Line`s; jogador que não controla o objeto não consegue selecioná-lo nem arrastá-lo (o nó deixa de ser `draggable`).

## Global Constraints

- **Sem git** (escolha do usuário): os passos de commit viram **"Checkpoint: rode `<suíte>`, tem que ficar verde"**. Não crie repositório.
- **Não mexa no servidor do usuário:** pode haver um `pnpm host` (wrangler dev em `:8787`, assets de `apps/web/dist`, estado em `apps/worker/.wrangler/state`) rodando. **Nunca** rode `pnpm build`, `pnpm host`, `pnpm dev:*`, nunca mate processos na `:8787` e nunca apague `apps/web/dist` ou `apps/worker/.wrangler/state`. Para checar o bundle use `pnpm build:e2e` (gera `apps/web/dist-e2e`, criado na Task 10). O E2E sobe o próprio servidor em `E2E_PORT` (padrão **8788**, inspector em `E2E_PORT + 1000`) com `--persist-to .wrangler/e2e-state`.
- Toolchain instalada (não troque versões): pnpm 12, Node 24, TypeScript 7, zod 4, wrangler 4.148, Konva 10.7.1, react-konva 19.3, zustand 5, Playwright 1.63. Testes do worker importam `import { exports } from 'cloudflare:workers'` e usam `const SELF = exports.default` (não `SELF` de `cloudflare:test`). O `Transformer` do Konva continua com `keepRatio shiftBehavior="inverted"`.
- Nova dependência: **`lucide-react`** em `apps/web` (Task 10).
- APIs Cloudflare conferidas em `apps/worker/worker-configuration.d.ts`: `ctx.setWebSocketAutoResponse(maybeReqResp?: WebSocketRequestResponsePair): void` e `new WebSocketRequestResponsePair(request: string, response: string)` existem com esses nomes. `runInDurableObject(stub, (instance, state) => …)` vem de `cloudflare:test`; `env` vem de `cloudflare:workers`.
- Valores copiados do spec:
  - `control: { mode: 'all' | 'gm' | 'list'; clientIds: string[] }`, **máx. 20** ids. Ao criar, o servidor define `{ mode: 'list', clientIds: [autor] }`.
  - **Pode controlar** = papel `gm` **ou** `mode === 'all'` **ou** (`mode === 'list'` e `clientIds` contém o cliente). `mode: 'gm'` = só o mestre.
  - `title`: trim, **1..40**; ausente = sem título; `update` com `title: null` remove.
  - Traço: `segments: number[][]`; cada pedaço com ao menos **2 pontos (4 números)**; até **200** pedaços e até **20 000** números somados; `width`/`height` = caixa de todos os pedaços.
  - Anotação: tabela `gm_notes(object_id TEXT PRIMARY KEY, text TEXT NOT NULL)`, texto até **2000** caracteres; texto vazio remove a linha; nunca vai a jogadores.
  - Membros: snapshot inclui online **ou** `lastSeenAt` nos últimos **7 dias**. `memberRemove` apaga a linha; recusado (`forbidden`) se o membro estiver online.
  - Camadas: `visibility: 'gm'` = oculta para jogadores; `locked: true` = travada para jogadores. **Camada `gm` fixa no topo** (maior `order`, sempre `visibility: 'gm'`, não pode ser removida, ocultada/mostrada nem reordenada; só renomear e travar/destravar). Nova camada entra **logo abaixo da do Mestre**, `visibility: 'all'`, `locked: false`, nome padrão **"Nova camada"**, `id` do cliente (nanoid, `IdSchema`); o servidor renumera `order` em inteiros consecutivos (Mestre por último) e envia as camadas afetadas. "Subir/Descer camada" troca com a vizinha; nada passa acima do Mestre. Sempre existe ao menos uma camada comum.
  - Heartbeat: o DO responde `'ping'` com `'pong'` via auto-response; o cliente manda `ping` a cada **25 s** com o socket aberto e, sem nenhuma mensagem em **10 s** após um ping, fecha e reconecta (fluxo do M1).
  - Borracha: modo Apagar da caneta (`E` ativa apagar, `P` ativa desenhar); só **camada ativa**, só **traços**; jogador apaga só o que controla; mestre "Apagar: só os meus" (padrão) = `ownerId` dele, "de todos" = todos; traços travados por outra pessoa ficam de fora. **Raio = `max(8, espessura) / 2` px de tela ÷ zoom.** Reamostragem com passo `radius / 2`; remove pontos com distância ao caminho `<= radius + strokeWidth / 2`; descarta trechos com menos de 2 pontos ou comprimento `< 2`; RDP com tolerância `1 / zoom`; filtro prévio por caixa envolvente. Prévia local no máximo uma vez por quadro; ao soltar, envio em lote (`update { segments, x, y, width, height }` ou `delete`).
  - Desfazer: pilha de **grupos** (`Op[]`), até **50** grupos; o grupo entra quando todas as ops forem confirmadas; recusadas ficam de fora, as confirmadas entram.
  - Caneta: espessura **1 a 30**, `<input type="color">` + **8** cores rápidas, Desenhar/Apagar; chave do mestre "Apagar: só os meus / de todos". Fecha com `Esc` ou clique fora.
  - Canvas: título centralizado abaixo da caixa (sem rotação), **13 px** de tela, branco com contorno escuro; camadas `visibility: 'gm'` com **50%** de opacidade para o mestre; ícone de anotação no canto superior direito só para o mestre.
  - Rótulos acessíveis mantidos: "Selecionar (V)", "Mão (H)", "Lápis (P)", "Desfazer (Ctrl+Z)"; o botão da caneta vira "Borracha (E)" no modo apagar; o painel de camadas tem `aria-label="Camadas"` e cada linha é um botão com o nome da camada; o painel lista a camada mais alta primeiro.
  - Toast de borracha/camada recusada: **"Sem permissão nessa camada"**.
- **Identidade (adição de segurança, Task 4):** no primeiro `hello` de um `clientId` desconhecido o servidor gera `clientSecret` aleatório (32 bytes base64url, `randomSecret()`), grava só o SHA-256 hex na linha do membro (`secretHash`) e o devolve uma vez em `welcome.clientSecret`. O cliente guarda em `localStorage` na chave `mesa:secret:<tableId>` (fallback em memória, como o segredo do mestre) e envia `clientSecret` (máx. 128) em todo `hello`. Para `clientId` conhecido com hash, segredo ausente/errado (comparação `safeEqual` dos hashes) → `{ t: 'error', reason: 'auth' }` e fechamento `4401`; o cliente mostra **"Identidade inválida — limpe os dados do site ou entre com outro navegador"** e não reconecta. Membros do M1 sem hash: o primeiro `hello` que chegar adota um segredo novo (*trust-on-first-use*).
- Texto de interface em português; identificadores de código em inglês.

## Review Focus

1. **Passada de borracha que geraria mais de 200 pedaços ou mais de 20 000 números** (rabisco denso apagado em zigue-zague): o traço continua apagável — ficam os 200 maiores pedaços e a simplificação aperta até caber; nunca vira `reject invalid` → teste na Task 13.
2. **Nome de camada ou título só com espaços, ou com 41+ caracteres**: o schema recusa; o servidor nunca grava nome/título vazio → testes nas Tasks 1 (título) e 3 (nome de camada).
3. **Primeira entrada na mesa em duas abas ao mesmo tempo**: a aba que chega depois é recusada (`auth`) porque a outra já adotou um segredo; ela não pode ficar presa em "Identidade inválida" — se o armazenamento passou a ter um segredo diferente do enviado, reconecta uma vez → teste na Task 4.
4. **Desfazer em grupo com várias ops recusadas** (ex.: outra pessoa apagou os traços): as confirmadas valem e aparece **um** toast "Não foi possível desfazer", não um por op → teste na Task 9.
5. **`layerShown` repetido ou com objeto já presente** (mestre alterna ocultar/mostrar rápido): sem objetos duplicados e com minhas ops pendentes reaplicadas por cima → teste na Task 9.

---

## Mapa de arquivos

```
package.json                                  # + script build:e2e (Task 10)
playwright.config.ts                          # porta/estado/assets próprios do E2E (Task 10)
e2e/table.spec.ts                             # testes atualizados + novos (Tasks 10–14)
README.md                                     # seção E2E (Task 14)

packages/shared/src/
  constants.ts      # + limites do M2, GM_LAYER_ID, DEFAULT_LAYER_NAME, heartbeat
  model.ts          # ControlSchema, TitleSchema, segments, mergePatch, canControl
  geometry.ts       # + eraseSegments, pathTouchesBox
  layers.ts         # NOVO: sortLayers, insertLayer, moveLayer, changedLayers
  protocol.ts       # ops/mensagens novas, Snapshot.notes, isObjectOp, readOpId, hello.clientSecret
  index.ts          # + layers
packages/shared/test/
  model.test.ts     # NOVO
  geometry.test.ts  # + eraseSegments/pathTouchesBox
  layers.test.ts    # NOVO
  protocol.test.ts  # + ops novas

apps/worker/src/
  engine/migrate.ts     # NOVO: normalizeObject (M1 → M2)
  engine/store.ts       # + putLayer, deleteLayer, deleteMember, notas, StoredMember.secretHash
  engine/memory-store.ts
  engine/sql-store.ts   # gm_notes, migração na leitura
  engine/engine.ts      # efeitos, controle, camadas, notas, membros
  table-do.ts           # clientSecret no hello, broadcast por efeito, reject invalid, auto-response
apps/worker/test/
  helpers.ts            # + raw/waitForRaw
  store-contract.ts     # NOVO
  sql-store.test.ts     # NOVO
  engine.test.ts        # reescrito
  table-do.test.ts      # + M2

apps/web/src/
  lib/identity.ts             # clientSecret por mesa + shouldRetryAuth
  sync/SyncClient.ts          # heartbeat
  store/state.ts              # notes, grupos de desfazer, penMode, objectMenu
  store/localOps.ts
  store/undo.ts
  store/reducers.ts           # mensagens novas, camadas otimistas, grupos
  store/tableStore.ts         # submitGroup, setPen, createLayer, menu do objeto
  canvas/bounds.ts            # NOVO: rotatedBounds
  canvas/eraser.ts            # NOVO: erasableBy, planErase, rebaseSegments, fitSegmentLimits
  canvas/ObjectDecorations.tsx# NOVO: título + glifo de anotação
  canvas/StrokeNode.tsx       # Group de Lines
  canvas/ImageNode.tsx
  canvas/SelectionTransformer.tsx
  canvas/TableCanvas.tsx
  canvas/useDrawingTools.ts   # borracha
  ui/useDismiss.ts            # NOVO: Esc/clique fora + floatingStyle
  ui/Toolbar.tsx              # Lucide
  ui/PenPopover.tsx           # NOVO
  ui/LayersPanel.tsx          # NOVO
  ui/LayerMenu.tsx            # NOVO
  ui/ObjectContextMenu.tsx    # NOVO
  ui/MembersPanel.tsx
  ui/TablePage.tsx
  ui/useKeyboard.ts
  ui/LayerSelect.tsx          # REMOVIDO (Task 11)
  styles.css
apps/web/test/
  sync-client.test.ts, reducers.test.ts, undo.test.ts (atualizados)
  identity.test.ts (NOVO)
  reducers-layers.test.ts, undo-groups.test.ts, bounds.test.ts, eraser.test.ts (NOVOS)
```

Comandos de verificação usados nas tasks:
- Shared: `pnpm --filter @mesa/shared test` e `pnpm --filter @mesa/shared typecheck`
- Worker: `pnpm --filter @mesa/worker test` e `pnpm --filter @mesa/worker typecheck`
- Web: `pnpm --filter @mesa/web test` e `pnpm --filter @mesa/web typecheck`
- Tudo: `pnpm typecheck && pnpm test`
- E2E (a partir da Task 10): `pnpm e2e` (ver Global Constraints sobre portas)

---

### Task 1: Shared — objetos com controle, título e pedaços (+ migração do M1 e consumidores)

Muda o formato de `TableObject` e adapta, na mesma task, tudo que lê esse formato: a migração na leitura do `SqlStore`, o `create`/`update` do engine e o front (traço com `segments`, `inverseOf`, `applyLocalOp`). As regras de permissão em si chegam na Task 6.

**Files:**
- Modify: `packages/shared/src/constants.ts` (arquivo inteiro)
- Modify: `packages/shared/src/model.ts` (arquivo inteiro)
- Create: `packages/shared/test/model.test.ts`
- Modify: `packages/shared/test/protocol.test.ts:39-43,65-70`
- Create: `apps/worker/src/engine/migrate.ts`
- Modify: `apps/worker/src/engine/sql-store.ts:1-2,46-53`
- Modify: `apps/worker/src/engine/engine.ts:1-14,105-137`
- Create: `apps/worker/test/sql-store.test.ts`
- Modify: `apps/web/src/store/localOps.ts` (arquivo inteiro)
- Modify: `apps/web/src/store/undo.ts` (arquivo inteiro)
- Modify: `apps/web/src/canvas/StrokeNode.tsx` (arquivo inteiro)
- Modify: `apps/web/src/canvas/useDrawingTools.ts:5,38-40,90-110`
- Modify: `apps/web/test/undo.test.ts`, `apps/web/test/reducers.test.ts:11-12`

**Interfaces:**
- Consumes: nada novo.
- Produces (em `@mesa/shared`):
  - constantes `GM_LAYER_ID = 'gm'`, `DEFAULT_LAYER_NAME = 'Nova camada'`, `MAX_CONTROL_IDS = 20`, `TITLE_MAX = 40`, `NOTE_MAX = 2000`, `LAYER_NAME_MAX = 40`, `MAX_SEGMENTS = 200`, `MAX_SEGMENT_NUMBERS = 20_000`, `MEMBER_RECENT_MS = 604_800_000`, `HEARTBEAT_INTERVAL_MS = 25_000`, `HEARTBEAT_TIMEOUT_MS = 10_000`, `ERASER_MIN_SIZE = 8`
  - `ControlSchema`, `type Control = { mode: 'all' | 'gm' | 'list'; clientIds: string[] }`
  - `TitleSchema` (string trim 1..40)
  - `TableObject` agora tem `control: Control` e `title?: string`; `StrokeObject` tem `segments: number[][]` (sem `points`)
  - `NewObject` tem `title?: string` (sem `control`)
  - `ObjectPatch` aceita `control?: Control`, `title?: string | null`, `segments?: number[][]` (sem `points`)
  - `mergePatch(before: TableObject, patch: ObjectPatch): TableObject` — espalha o patch e remove `title` quando `null` (não valida)
  - `canControl(object: Pick<TableObject, 'control'>, clientId: string, role: Role): boolean`
- Produces (worker): `normalizeObject(raw: Record<string, unknown>): TableObject` em `apps/worker/src/engine/migrate.ts`
- Produces (web): `StrokeNode({ object })` renderiza um `Group` (`id = object.id`, `name = "object stroke"`) com uma `Line` por pedaço.

- [ ] **Step 1: Escrever os testes do modelo (falham)**

Crie `packages/shared/test/model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NewObjectSchema, ObjectPatchSchema, TableObjectSchema, canControl, mergePatch, type TableObject } from '../src'

const stroke = {
  id: 's1', type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1,
  segments: [[0, 0, 10, 10]], color: '#ffffff', strokeWidth: 3,
}
const server = { ownerId: 'A', version: 1, updatedBy: 'A', control: { mode: 'list', clientIds: ['A'] } }
const stored = (over: Record<string, unknown> = {}) => ({ ...stroke, ...server, ...over }) as TableObject

describe('segments', () => {
  it('aceita vários pedaços', () => {
    expect(NewObjectSchema.safeParse({ ...stroke, segments: [[0, 0, 1, 1], [5, 5, 6, 6, 7, 7]] }).success).toBe(true)
  })

  it('recusa pedaço com 1 ponto, quantidade ímpar ou lista vazia', () => {
    expect(NewObjectSchema.safeParse({ ...stroke, segments: [[0, 0]] }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...stroke, segments: [[0, 0, 1, 1, 2]] }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...stroke, segments: [] }).success).toBe(false)
  })

  it('aceita 200 pedaços e recusa 201', () => {
    const many = (n: number) => Array.from({ length: n }, () => [0, 0, 1, 1])
    expect(NewObjectSchema.safeParse({ ...stroke, segments: many(200) }).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...stroke, segments: many(201) }).success).toBe(false)
  })

  it('aceita 20 000 números somados e recusa mais', () => {
    const ok = [new Array(10_000).fill(0), new Array(10_000).fill(0)]
    const tooMany = [new Array(10_000).fill(0), new Array(10_002).fill(0)]
    expect(NewObjectSchema.safeParse({ ...stroke, segments: ok }).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...stroke, segments: tooMany }).success).toBe(false)
  })

  it('traço no formato do M1 (points) não é um TableObject válido', () => {
    const { segments: _s, ...rest } = stored()
    expect(TableObjectSchema.safeParse({ ...rest, points: [0, 0, 1, 1] }).success).toBe(false)
  })
})

describe('control e title', () => {
  it('NewObject descarta control enviado pelo cliente', () => {
    const parsed = NewObjectSchema.parse({ ...stroke, control: { mode: 'all', clientIds: [] } })
    expect(parsed).not.toHaveProperty('control')
  })

  it('TableObject exige control', () => {
    const { control: _c, ...noControl } = stored()
    expect(TableObjectSchema.safeParse(noControl).success).toBe(false)
    expect(TableObjectSchema.safeParse(stored()).success).toBe(true)
  })

  it('patch aceita control, title (aparado), null e segments', () => {
    expect(ObjectPatchSchema.parse({ control: { mode: 'gm', clientIds: [] }, title: '  Goblin  ', segments: [[0, 0, 1, 1]] })).toEqual({
      control: { mode: 'gm', clientIds: [] },
      title: 'Goblin',
      segments: [[0, 0, 1, 1]],
    })
    expect(ObjectPatchSchema.parse({ title: null })).toEqual({ title: null })
  })

  // Review Focus #2
  it('recusa título só com espaços ou com mais de 40 caracteres', () => {
    expect(ObjectPatchSchema.safeParse({ title: '   ' }).success).toBe(false)
    expect(ObjectPatchSchema.safeParse({ title: 'x'.repeat(41) }).success).toBe(false)
    expect(ObjectPatchSchema.safeParse({ title: 'x'.repeat(40) }).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...stroke, title: '   ' }).success).toBe(false)
  })

  it('recusa control com mais de 20 ids ou modo desconhecido', () => {
    const ids = Array.from({ length: 21 }, (_, i) => `c${i}`)
    expect(ObjectPatchSchema.safeParse({ control: { mode: 'list', clientIds: ids } }).success).toBe(false)
    expect(ObjectPatchSchema.safeParse({ control: { mode: 'list', clientIds: ids.slice(0, 20) } }).success).toBe(true)
    expect(ObjectPatchSchema.safeParse({ control: { mode: 'todos', clientIds: [] } }).success).toBe(false)
  })

  it('patch não aceita mais points', () => {
    expect(ObjectPatchSchema.safeParse({ points: [0, 0, 1, 1] }).success).toBe(false)
  })
})

describe('mergePatch', () => {
  it('aplica campos e remove title com null', () => {
    const withTitle = stored({ title: 'Orc' })
    expect(mergePatch(withTitle, { x: 5 })).toMatchObject({ x: 5, title: 'Orc' })
    expect(mergePatch(withTitle, { title: null })).not.toHaveProperty('title')
    expect(withTitle.title).toBe('Orc')
  })
})

describe('canControl', () => {
  const obj = (mode: 'all' | 'gm' | 'list', clientIds: string[] = []) => ({ control: { mode, clientIds } })
  it('mestre sempre controla', () => {
    expect(canControl(obj('gm'), 'G', 'gm')).toBe(true)
    expect(canControl(obj('list', ['A']), 'G', 'gm')).toBe(true)
  })
  it('jogador: all sim, gm não, list só se estiver na lista', () => {
    expect(canControl(obj('all'), 'B', 'player')).toBe(true)
    expect(canControl(obj('gm', ['B']), 'B', 'player')).toBe(false)
    expect(canControl(obj('list', ['A', 'B']), 'B', 'player')).toBe(true)
    expect(canControl(obj('list', ['A']), 'B', 'player')).toBe(false)
  })
})
```

Em `packages/shared/test/protocol.test.ts`, troque o teste do traço ímpar (linhas 39-43) por:

```ts
  it('recusa traço com quantidade ímpar de coordenadas', () => {
    const stroke = { ...image, type: 'stroke', segments: [[0, 0, 1, 0, 2]], color: '#000000', strokeWidth: 3 }
    delete (stroke as Record<string, unknown>).assetKey
    expect(OpSchema.safeParse({ kind: 'create', object: stroke }).success).toBe(false)
  })
```

e o teste de `TableObjectSchema` (linhas 65-70) por:

```ts
describe('TableObjectSchema', () => {
  it('exige campos de servidor', () => {
    const control = { mode: 'list', clientIds: ['c'] }
    expect(TableObjectSchema.safeParse(image).success).toBe(false)
    expect(TableObjectSchema.safeParse({ ...image, ownerId: 'c', version: 1, updatedBy: 'c', control }).success).toBe(true)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/shared test`
Expected: FAIL — `canControl`/`mergePatch` não exportados e `segments` desconhecido.

- [ ] **Step 3: Implementar constantes e modelo**

Substitua `packages/shared/src/constants.ts` por:

```ts
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
```

Substitua `packages/shared/src/model.ts` por:

```ts
import { z } from 'zod'
import { MAX_CONTROL_IDS, MAX_SEGMENTS, MAX_SEGMENT_NUMBERS, TITLE_MAX } from './constants'

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
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const strokeWidth = z.number().min(1).max(100)

const segment = z
  .array(z.number())
  .min(4)
  .refine((p) => p.length % 2 === 0, 'segment must be x,y pairs')
const segments = z
  .array(segment)
  .min(1)
  .max(MAX_SEGMENTS)
  .refine((list) => list.reduce((n, s) => n + s.length, 0) <= MAX_SEGMENT_NUMBERS, 'too many points')

export const ControlSchema = z.strictObject({
  mode: z.enum(['all', 'gm', 'list']),
  clientIds: z.array(z.string().min(1).max(64)).max(MAX_CONTROL_IDS),
})
export type Control = z.infer<typeof ControlSchema>

export const TitleSchema = z.string().trim().min(1).max(TITLE_MAX)

const objectBase = {
  id: IdSchema,
  layerId: IdSchema,
  x: coord,
  y: coord,
  width: size,
  height: size,
  rotation: coord,
  zIndex: coord,
  title: TitleSchema.optional(),
}

const serverFields = {
  ownerId: z.string(),
  version: z.number().int().nonnegative(),
  updatedBy: z.string(),
  control: ControlSchema,
}

const imageFields = {
  type: z.literal('image'),
  assetKey: z.string().regex(/^[a-f0-9]{64}$/),
}

const strokeFields = {
  type: z.literal('stroke'),
  segments,
  color,
  strokeWidth,
}

// Sem `control`: o servidor define o controle na criação (campo enviado é descartado).
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
    segments,
    color,
    strokeWidth,
    control: ControlSchema,
    title: TitleSchema.nullable(),
  })
  .partial()
export type ObjectPatch = z.infer<typeof ObjectPatchSchema>

/** Aplica o patch sem validar; `title: null` remove o título. */
export function mergePatch(before: TableObject, patch: ObjectPatch): TableObject {
  const merged: Record<string, unknown> = { ...before, ...patch }
  if (merged.title === null) delete merged.title
  return merged as TableObject
}

export function canControl(object: Pick<TableObject, 'control'>, clientId: string, role: Role): boolean {
  if (role === 'gm') return true
  const { mode, clientIds } = object.control
  return mode === 'all' || (mode === 'list' && clientIds.includes(clientId))
}
```

- [ ] **Step 4: Rodar os testes do shared**

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Teste da migração no worker (falha)**

Crie `apps/worker/test/sql-store.test.ts`:

```ts
import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import { TableObjectSchema } from '@mesa/shared'
import { normalizeObject } from '../src/engine/migrate'
import { SqlStore } from '../src/engine/sql-store'

const freshStub = () => env.TABLES.get(env.TABLES.idFromName(`store-${crypto.randomUUID()}`))

const m1Stroke = {
  id: 'old_stroke', type: 'stroke', layerId: 'drawings', x: 5, y: 6, width: 10, height: 0, rotation: 0, zIndex: 1,
  points: [0, 0, 10, 0], color: '#ffffff', strokeWidth: 3, ownerId: 'A', version: 2, updatedBy: 'A',
}
const m1Image = {
  id: 'old_image', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64), x: 0, y: 0, width: 70, height: 70,
  rotation: 0, zIndex: 1, ownerId: 'B', version: 1, updatedBy: 'B',
}

describe('SqlStore — migração do M1', () => {
  it('traço com points vira segments e objeto sem control ganha a lista do dono', async () => {
    await runInDurableObject(freshStub(), (_instance, state) => {
      const store = new SqlStore(state.storage.sql)
      for (const o of [m1Stroke, m1Image]) {
        state.storage.sql.exec(
          'INSERT INTO objects (id, layer_id, type, data, version) VALUES (?, ?, ?, ?, ?)',
          o.id, o.layerId, o.type, JSON.stringify(o), o.version,
        )
      }
      const stroke = store.getObject('old_stroke')
      expect(stroke).toMatchObject({ segments: [[0, 0, 10, 0]], control: { mode: 'list', clientIds: ['A'] } })
      expect(stroke).not.toHaveProperty('points')
      expect(store.getObject('old_image')?.control).toEqual({ mode: 'list', clientIds: ['B'] })
      const all = store.listObjects()
      expect(all).toHaveLength(2)
      for (const o of all) expect(TableObjectSchema.safeParse(o).success).toBe(true)
    })
  })

  it('ponto único do M1 vira pedaço válido; objeto já no formato novo não muda', () => {
    const single = normalizeObject({ ...m1Stroke, points: [3, 4] })
    expect(single).toMatchObject({ segments: [[3, 4, 3.01, 4]] })
    const current = { ...m1Image, control: { mode: 'all', clientIds: [] } }
    expect(normalizeObject(current)).toEqual(current)
  })
})
```

Run: `pnpm --filter @mesa/worker test -- sql-store`
Expected: FAIL — `../src/engine/migrate` não existe.

- [ ] **Step 6: Implementar a migração e adaptar store/engine**

Crie `apps/worker/src/engine/migrate.ts`:

```ts
import type { TableObject } from '@mesa/shared'

// Objetos gravados pelo M1: traço com `points` e nenhum `control`.
// A versão normalizada é gravada na próxima escrita do objeto.
export function normalizeObject(raw: Record<string, unknown>): TableObject {
  const o: Record<string, unknown> = { ...raw }
  if (o.type === 'stroke' && !Array.isArray(o.segments)) {
    let points = Array.isArray(o.points) ? (o.points as number[]) : []
    if (points.length === 2) points = [points[0], points[1], points[0] + 0.01, points[1]]
    o.segments = [points]
  }
  delete o.points
  if (!o.control) o.control = { mode: 'list', clientIds: [o.ownerId] }
  return o as unknown as TableObject
}
```

Em `apps/worker/src/engine/sql-store.ts`, adicione o import (depois da linha 2):

```ts
import { normalizeObject } from './migrate'
```

e troque os métodos `getObject` e `listObjects` por:

```ts
  getObject(id: string): TableObject | null {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM objects WHERE id = ?', id).toArray()[0]
    return row ? normalizeObject(JSON.parse(row.data)) : null
  }

  listObjects(): TableObject[] {
    return this.sql.exec<{ data: string }>('SELECT data FROM objects').toArray().map((r) => normalizeObject(JSON.parse(r.data)))
  }
```

Em `apps/worker/src/engine/engine.ts`, acrescente `mergePatch` ao import de `@mesa/shared` (linhas 1-13):

```ts
import {
  LOCK_TTL_MS,
  MEMBER_COLORS,
  TableObjectSchema,
  mergePatch,
  type Layer,
  type LockInfo,
  type Member,
  type Op,
  type RejectReason,
  type Role,
  type Snapshot,
  type TableObject,
} from '@mesa/shared'
```

No `execute`, troque a linha `const after = { ...object, ownerId: clientId, version: 1, updatedBy: clientId } as TableObject` por:

```ts
      const after = {
        ...object,
        control: { mode: 'list', clientIds: [clientId] },
        ownerId: clientId,
        version: 1,
        updatedBy: clientId,
      } as TableObject
```

e a chamada `TableObjectSchema.safeParse({ ...before, ...op.patch, … })` do `update` por:

```ts
    const parsed = TableObjectSchema.safeParse({
      ...mergePatch(before, op.patch),
      version: before.version + 1,
      updatedBy: clientId,
    })
```

- [ ] **Step 7: Rodar a suíte do worker**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: PASS (inclui os testes do M1).

- [ ] **Step 8: Adaptar o front ao formato novo**

Substitua `apps/web/src/store/localOps.ts` por:

```ts
import { mergePatch, type Op, type TableObject } from '@mesa/shared'

export function opTargetId(op: Op): string {
  return op.kind === 'create' ? op.object.id : op.id
}

export function applyLocalOp(objects: Record<string, TableObject>, op: Op, selfId: string): Record<string, TableObject> {
  switch (op.kind) {
    case 'create':
      return {
        ...objects,
        [op.object.id]: {
          ...op.object,
          control: { mode: 'list', clientIds: [selfId] },
          ownerId: selfId,
          version: 0,
          updatedBy: selfId,
        } as TableObject,
      }
    case 'update': {
      const current = objects[op.id]
      if (!current) return objects
      return { ...objects, [op.id]: { ...mergePatch(current, op.patch), updatedBy: selfId } as TableObject }
    }
    case 'delete': {
      if (!objects[op.id]) return objects
      const { [op.id]: _removed, ...rest } = objects
      return rest
    }
  }
}
```

Substitua `apps/web/src/store/undo.ts` por:

```ts
import type { ObjectPatch, Op, TableObject } from '@mesa/shared'

export function inverseOf(op: Op, before: TableObject | null): Op | null {
  switch (op.kind) {
    case 'create':
      return { kind: 'delete', id: op.object.id }
    case 'delete': {
      if (!before) return null
      // control é do servidor: a recriação volta com o autor do desfazer como controlador
      const { ownerId: _o, version: _v, updatedBy: _u, control: _c, ...object } = before
      return { kind: 'create', object }
    }
    case 'update': {
      if (!before) return null
      const patch: Record<string, unknown> = {}
      for (const key of Object.keys(op.patch)) {
        const value = (before as Record<string, unknown>)[key]
        // título ausente antes → desfazer remove o título
        patch[key] = value === undefined && key === 'title' ? null : value
      }
      return { kind: 'update', id: op.id, patch: patch as ObjectPatch }
    }
  }
}
```

Substitua `apps/web/src/canvas/StrokeNode.tsx` por:

```tsx
import { Group, Line } from 'react-konva'
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

  // Um Group com uma Line por pedaço: clique e arrasto valem para o traço inteiro.
  return (
    <Group
      id={object.id}
      name="object stroke"
      x={pos.x}
      y={pos.y}
      draggable={interactive}
      onMouseDown={() => {
        if (interactive) actions.select(object.id)
      }}
      onDragStart={() => actions.grab(object.id)}
      onDragMove={(e) =>
        actions.dragPreview(object.id, { x: e.target.x(), y: e.target.y(), width: object.width, height: object.height, rotation: 0 })
      }
      onDragEnd={(e) => commitNodeChange(store, object.id, e.target, 'drag')}
    >
      {object.segments.map((points, i) => (
        <Line
          key={i}
          points={points}
          stroke={object.color}
          strokeWidth={object.strokeWidth}
          hitStrokeWidth={Math.max(object.strokeWidth, 12)}
          lineCap="round"
          lineJoin="round"
        />
      ))}
    </Group>
  )
}
```

Em `apps/web/src/canvas/useDrawingTools.ts`, troque o import da linha 5 por:

```ts
import { MAX_SEGMENT_NUMBERS, boundsOf, simplifyPoints } from '@mesa/shared'
```

e o trecho de `onUp` das linhas 90-110 (de `let points = ...` até o fim do `submit`) por:

```ts
    let points = simplifyPoints(cur.points, 1 / s.viewport.scale)
    if (points.length < 4) points = [points[0], points[1], points[0] + 0.01, points[1]]
    if (points.length > MAX_SEGMENT_NUMBERS) {
      points = simplifyPoints(points, 4 / s.viewport.scale).slice(0, MAX_SEGMENT_NUMBERS)
    }
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
        segments: [points.map((v, i) => (i % 2 === 0 ? v - b.minX : v - b.minY))],
        color: s.color,
        strokeWidth: s.strokeWidth,
      },
    })
```

Ainda em `useDrawingTools.ts`, o clique da borracha antiga agora acerta uma `Line` dentro do `Group`; troque o começo de `eraseTarget` (linhas 38-40) por:

```ts
  const eraseTarget = (target: Konva.Node) => {
    const node = target.findAncestor('.stroke', true)
    if (!node) return
    const id = node.id()
```

(o resto da função continua igual; ela é substituída na Task 10).

Atualize os testes do front. Em `apps/web/test/undo.test.ts`, troque o objeto `obj` (linhas 5-9) por:

```ts
const obj: TableObject = {
  id: 't1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
  x: 1, y: 2, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'c', version: 3, updatedBy: 'c', control: { mode: 'list', clientIds: ['c'] },
}
```

troque o teste `'create → delete'` (linhas 12-15) por:

```ts
  it('create → delete', () => {
    const { ownerId, version, updatedBy, control, ...object } = obj
    expect(inverseOf({ kind: 'create', object }, null)).toEqual({ kind: 'delete', id: 't1' })
  })
```

e acrescente antes do último `})` do arquivo:

```ts
  it('update de title sem título anterior desfaz com null; com título volta o antigo', () => {
    expect(inverseOf({ kind: 'update', id: 't1', patch: { title: 'Orc' } }, obj)).toEqual({ kind: 'update', id: 't1', patch: { title: null } })
    expect(inverseOf({ kind: 'update', id: 't1', patch: { title: null } }, { ...obj, title: 'Orc' })).toEqual({
      kind: 'update', id: 't1', patch: { title: 'Orc' },
    })
  })
```

Em `apps/web/test/reducers.test.ts`, troque `stored` (linhas 11-12) por:

```ts
const stored = (id = 't1', over: Partial<TableObject> = {}): TableObject =>
  ({ ...newToken(id), ownerId: 'other', version: 1, updatedBy: 'other', control: { mode: 'list', clientIds: ['other'] }, ...over }) as TableObject
```

- [ ] **Step 9: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde (shared, worker e web).

---

### Task 2: Shared — `eraseSegments` e `pathTouchesBox`

**Files:**
- Modify: `packages/shared/src/geometry.ts` (acrescentar no fim)
- Modify: `packages/shared/test/geometry.test.ts` (acrescentar no fim; atualizar import)

**Interfaces:**
- Consumes: `simplifyPoints`, `boundsOf` (já existem em `geometry.ts`).
- Produces:
  - `eraseSegments(segments: number[][], eraserPath: number[], radius: number, strokeWidth: number, tolerance?: number): number[][]` — coordenadas de `segments` e `eraserPath` no mesmo referencial; devolve **a mesma referência** `segments` se nenhum ponto foi apagado; pedaços não tocados são reaproveitados por referência.
  - `pathTouchesBox(path: number[], reach: number, box: { x: number; y: number; width: number; height: number }): boolean`

- [ ] **Step 1: Escrever os testes (falham)**

Em `packages/shared/test/geometry.test.ts`, troque o import por:

```ts
import { boundsOf, eraseSegments, pathTouchesBox, simplifyPoints } from '../src'
```

e acrescente no fim:

```ts
describe('eraseSegments', () => {
  it('corte no meio gera 2 pedaços', () => {
    // raio 5 + metade da espessura 1 = 6; passo de reamostragem 2.5
    expect(eraseSegments([[0, 0, 100, 0]], [50, -20, 50, 20], 5, 2)).toEqual([
      [0, 0, 42.5, 0],
      [57.5, 0, 100, 0],
    ])
  })

  it('borracha longe não muda nada (mesma referência)', () => {
    const segments = [[0, 0, 100, 0]]
    expect(eraseSegments(segments, [50, 100, 60, 100], 5, 2)).toBe(segments)
  })

  it('cobertura total gera []', () => {
    expect(eraseSegments([[0, 0, 10, 0]], [-5, 0, 15, 0], 5, 0)).toEqual([])
  })

  it('aresta longa de 2 pontos é cortada no meio por um toque só', () => {
    expect(eraseSegments([[0, 0, 1000, 0]], [500, 0], 4, 0)).toEqual([
      [0, 0, 494, 0],
      [506, 0, 1000, 0],
    ])
  })

  it('descarta fragmentos com menos de 2 pontos ou comprimento < 2', () => {
    // alcance 3, passo 1: sobra [0..1] (comprimento 1) à esquerda e [9..20] à direita
    expect(eraseSegments([[0, 0, 20, 0]], [5, 0], 2, 2)).toEqual([[9, 0, 20, 0]])
  })

  it('pedaço não tocado é mantido por referência', () => {
    const segments = [[0, 0, 100, 0], [0, 50, 100, 50]]
    const out = eraseSegments(segments, [50, -10, 50, 10], 5, 2)
    expect(out).toHaveLength(3)
    expect(out[2]).toBe(segments[1])
  })

  it('simplifica os trechos com a tolerância recebida', () => {
    const wavy = [0, 0, 10, 0.4, 20, 0, 30, 0.4, 40, 0, 100, 0]
    const out = eraseSegments([wavy], [100, -10, 100, 10], 2, 0, 1)
    expect(out).toEqual([[0, 0, 97, 0]])
  })
})

describe('pathTouchesBox', () => {
  const box = { x: 100, y: 100, width: 50, height: 10 }
  it('detecta caminho dentro ou encostando pelo alcance', () => {
    expect(pathTouchesBox([120, 50, 120, 200], 0, box)).toBe(true)
    expect(pathTouchesBox([90, 105], 10, box)).toBe(true)
  })
  it('descarta caminho distante', () => {
    expect(pathTouchesBox([0, 0, 50, 50], 5, box)).toBe(false)
    expect(pathTouchesBox([], 5, box)).toBe(false)
  })
})
```

> Conferência dos números: no primeiro teste o passo é 2.5 (aresta de 100 → 40 partes), apagam-se x ∈ {45, 47.5, 50, 52.5, 55}; no teste "simplifica" o raio 2 dá passo 1 e alcance 2, a aresta 40→100 vira 60 partes inteiras, apagam-se x ≥ 98 e a onda de 0 a 97 (desvio 0.4 < tolerância 1) vira `[0, 0, 97, 0]`.

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/shared test -- geometry`
Expected: FAIL — `eraseSegments` não exportado.

- [ ] **Step 3: Implementar**

Acrescente no fim de `packages/shared/src/geometry.ts`:

```ts
/**
 * Apaga dos pedaços tudo que estiver a até `radius + strokeWidth / 2` do caminho da borracha.
 * `segments` e `eraserPath` precisam estar no mesmo referencial. Devolve a MESMA referência
 * de `segments` quando nada foi apagado; pedaços não tocados são reaproveitados.
 */
export function eraseSegments(
  segments: number[][],
  eraserPath: number[],
  radius: number,
  strokeWidth: number,
  tolerance = 1,
): number[][] {
  if (eraserPath.length < 2) return segments
  const reach = radius + strokeWidth / 2
  const reach2 = reach * reach
  const step = Math.max(radius / 2, 0.01)
  const out: number[][] = []
  let changed = false

  for (const segment of segments) {
    const pts = resample(segment, step)
    const n = pts.length / 2
    const keep: boolean[] = []
    let removed = 0
    for (let i = 0; i < n; i++) {
      const hit = distanceToPath2(pts[2 * i], pts[2 * i + 1], eraserPath) <= reach2
      keep.push(!hit)
      if (hit) removed++
    }
    if (removed === 0) {
      out.push(segment)
      continue
    }
    changed = true
    let run: number[] = []
    const flush = () => {
      if (run.length >= 4 && pathLength(run) >= 2) out.push(simplifyPoints(run, tolerance))
      run = []
    }
    for (let i = 0; i < n; i++) {
      if (keep[i]) run.push(pts[2 * i], pts[2 * i + 1])
      else flush()
    }
    flush()
  }
  return changed ? out : segments
}

/** Caixa do caminho expandida por `reach` encosta na caixa do objeto? */
export function pathTouchesBox(
  path: number[],
  reach: number,
  box: { x: number; y: number; width: number; height: number },
): boolean {
  if (path.length < 2) return false
  const b = boundsOf(path)
  return (
    b.minX - reach <= box.x + box.width &&
    b.minX + b.width + reach >= box.x &&
    b.minY - reach <= box.y + box.height &&
    b.minY + b.height + reach >= box.y
  )
}

// Insere pontos a cada `step` em toda aresta, para que arestas longas também sejam cortadas no meio.
function resample(points: number[], step: number): number[] {
  const n = points.length / 2
  const out: number[] = []
  for (let i = 0; i < n - 1; i++) {
    const ax = points[2 * i], ay = points[2 * i + 1]
    const bx = points[2 * i + 2], by = points[2 * i + 3]
    const parts = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step))
    for (let k = 0; k < parts; k++) out.push(ax + ((bx - ax) * k) / parts, ay + ((by - ay) * k) / parts)
  }
  out.push(points[2 * (n - 1)], points[2 * (n - 1) + 1])
  return out
}

function distanceToPath2(px: number, py: number, path: number[]): number {
  if (path.length === 2) return (px - path[0]) ** 2 + (py - path[1]) ** 2
  let best = Infinity
  for (let i = 0; i + 3 < path.length; i += 2) {
    best = Math.min(best, pointSegmentDistance2(px, py, path[i], path[i + 1], path[i + 2], path[i + 3]))
  }
  return best
}

function pointSegmentDistance2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  let t = len2 === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  const cx = ax + t * dx - px
  const cy = ay + t * dy - py
  return cx * cx + cy * cy
}

function pathLength(points: number[]): number {
  let total = 0
  for (let i = 2; i < points.length; i += 2) total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1])
  return total
}
```

- [ ] **Step 4: Rodar os testes**

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Checkpoint**

Run: `pnpm --filter @mesa/shared test`
Expected: verde.

---

### Task 3: Shared — ordem das camadas e protocolo do M2 (+ adaptações de compilação)

Acrescenta as funções puras de ordem de camadas (usadas pelo engine e pelo estado otimista do front) e todas as operações/mensagens novas. Para manter `pnpm typecheck` verde, worker e web ganham adaptações mínimas e explícitas que as Tasks 6 e 9 substituem.

**Files:**
- Create: `packages/shared/src/layers.ts`
- Modify: `packages/shared/src/protocol.ts` (arquivo inteiro)
- Modify: `packages/shared/src/index.ts`
- Create: `packages/shared/test/layers.test.ts`
- Modify: `packages/shared/test/protocol.test.ts` (acrescentar no fim; atualizar import)
- Modify: `apps/worker/src/engine/engine.ts` (`execute` e `snapshot`)
- Modify: `apps/web/src/store/localOps.ts`, `apps/web/src/store/undo.ts`, `apps/web/src/store/reducers.ts:194-196`
- Modify: `apps/web/test/reducers.test.ts:17`, `apps/web/test/sync-client.test.ts:24`

**Interfaces:**
- Consumes: `GM_LAYER_ID`, `LAYER_NAME_MAX`, `NOTE_MAX` (Task 1), `Layer`.
- Produces (em `@mesa/shared`):
  - `sortLayers(layers: Layer[]): Layer[]` — cópia em ordem crescente de `order`, com `gm` sempre por último
  - `insertLayer(layers: Layer[], input: { id: string; name: string }): Layer[]` — nova camada logo abaixo do Mestre, `visibility: 'all'`, `locked: false`, `order` renumerado 0..n−1
  - `moveLayer(layers: Layer[], id: string, direction: 'up' | 'down'): Layer[] | null` — `null` se `id` for `gm`, não existir, ou se a troca sairia dos limites (acima do Mestre / abaixo do fundo)
  - `changedLayers(before: Layer[], after: Layer[]): Array<{ before: Layer | null; after: Layer }>`
  - `LayerNameSchema`, `LayerPatchSchema`, `type LayerPatch = { name?: string; visibility?: 'all' | 'gm'; locked?: boolean }`
  - `Op` ganha `layerCreate { layer: { id, name } }`, `layerUpdate { id, patch: LayerPatch }`, `layerDelete { id }`, `layerMove { id, direction: 'up' | 'down' }`, `noteSet { objectId, text }`, `memberRemove { clientId }`
  - `type ObjectOp = Extract<Op, { kind: 'create' | 'update' | 'delete' }>`; `isObjectOp(op: Op): op is ObjectOp`
  - `Snapshot.notes: Record<string, string>`
  - `ServerMessage` ganha `layerUpsert { layer }`, `layerShown { layer, objects }`, `layerHidden { id }`, `layerRemoved { id }`, `noteSet { objectId, text }`, `memberRemoved { clientId }`
  - `readOpId(json: unknown): string | null` — `opId` de uma mensagem `{ t: 'op', opId }` legível (string 1..64), senão `null`

- [ ] **Step 1: Testes de camadas e protocolo (falham)**

Crie `packages/shared/test/layers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, changedLayers, insertLayer, moveLayer, sortLayers, type Layer } from '../src'

const summary = (layers: Layer[]) => layers.map((l) => `${l.id}:${l.order}`)

describe('sortLayers', () => {
  it('ordena por order e mantém o Mestre por último mesmo com order baixa', () => {
    const broken = [{ ...DEFAULT_LAYERS[3], order: 0 }, { ...DEFAULT_LAYERS[1] }, { ...DEFAULT_LAYERS[0], order: 5 }]
    expect(sortLayers(broken).map((l) => l.id)).toEqual(['tokens', 'map', 'gm'])
  })
})

describe('insertLayer', () => {
  it('nova camada entra logo abaixo do Mestre e as orders são renumeradas', () => {
    const out = insertLayer(DEFAULT_LAYERS, { id: 'nova', name: 'Nova camada' })
    expect(summary(out)).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
    expect(out.find((l) => l.id === 'nova')).toEqual({ id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false })
  })

  it('não altera o array recebido', () => {
    const copy = structuredClone(DEFAULT_LAYERS)
    insertLayer(copy, { id: 'nova', name: 'X' })
    expect(copy).toEqual(DEFAULT_LAYERS)
  })
})

describe('moveLayer', () => {
  it('sobe e desce trocando com a vizinha', () => {
    expect(summary(moveLayer(DEFAULT_LAYERS, 'map', 'up')!)).toEqual(['tokens:0', 'map:1', 'drawings:2', 'gm:3'])
    expect(summary(moveLayer(DEFAULT_LAYERS, 'drawings', 'down')!)).toEqual(['map:0', 'drawings:1', 'tokens:2', 'gm:3'])
  })

  it('nada passa acima do Mestre, nada desce abaixo do fundo e o Mestre não se move', () => {
    expect(moveLayer(DEFAULT_LAYERS, 'drawings', 'up')).toBeNull()
    expect(moveLayer(DEFAULT_LAYERS, 'map', 'down')).toBeNull()
    expect(moveLayer(DEFAULT_LAYERS, 'gm', 'down')).toBeNull()
    expect(moveLayer(DEFAULT_LAYERS, 'nope', 'up')).toBeNull()
  })
})

describe('changedLayers', () => {
  it('lista só as camadas novas ou alteradas', () => {
    const after = insertLayer(DEFAULT_LAYERS, { id: 'nova', name: 'Nova camada' })
    expect(changedLayers(DEFAULT_LAYERS, after).map((c) => [c.before?.id ?? null, c.after.id])).toEqual([
      [null, 'nova'],
      ['gm', 'gm'],
    ])
  })
})
```

Em `packages/shared/test/protocol.test.ts`, troque o import (linha 2) por:

```ts
import { ClientMessageSchema, ObjectPatchSchema, OpSchema, TableObjectSchema, isObjectOp, readOpId } from '../src'
```

e acrescente no fim:

```ts
describe('operações do M2', () => {
  it('aceita as operações novas', () => {
    const ops = [
      { kind: 'layerCreate', layer: { id: 'nova_1', name: 'Nova camada' } },
      { kind: 'layerUpdate', id: 'map', patch: { name: 'Masmorra', visibility: 'gm', locked: true } },
      { kind: 'layerDelete', id: 'map' },
      { kind: 'layerMove', id: 'map', direction: 'up' },
      { kind: 'noteSet', objectId: 'tok1', text: 'tem 3 PV' },
      { kind: 'memberRemove', clientId: '3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192' },
    ]
    for (const op of ops) expect(OpSchema.safeParse(op).success, op.kind).toBe(true)
  })

  // Review Focus #2
  it('recusa nome de camada só com espaços ou com mais de 40 caracteres', () => {
    expect(OpSchema.safeParse({ kind: 'layerCreate', layer: { id: 'n', name: '   ' } }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'layerUpdate', id: 'map', patch: { name: 'x'.repeat(41) } }).success).toBe(false)
    expect(OpSchema.parse({ kind: 'layerUpdate', id: 'map', patch: { name: '  Cripta ' } })).toEqual({
      kind: 'layerUpdate', id: 'map', patch: { name: 'Cripta' },
    })
  })

  it('layerUpdate recusa campos fora do patch (ex.: order)', () => {
    expect(OpSchema.safeParse({ kind: 'layerUpdate', id: 'map', patch: { order: 9 } }).success).toBe(false)
  })

  it('layerMove só aceita up/down e noteSet limita 2000 caracteres', () => {
    expect(OpSchema.safeParse({ kind: 'layerMove', id: 'map', direction: 'top' }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'noteSet', objectId: 'tok1', text: 'x'.repeat(2001) }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'noteSet', objectId: 'tok1', text: '' }).success).toBe(true)
  })

  it('isObjectOp separa operações de objeto', () => {
    expect(isObjectOp({ kind: 'delete', id: 'x' })).toBe(true)
    expect(isObjectOp({ kind: 'layerDelete', id: 'x' })).toBe(false)
  })
})

describe('readOpId', () => {
  it('lê opId de op mal formada', () => {
    expect(readOpId({ t: 'op', opId: 'op_1', op: { kind: '???' } })).toBe('op_1')
  })
  it('ignora o que não é op ou não tem opId legível', () => {
    expect(readOpId({ t: 'grab', opId: 'op_1' })).toBeNull()
    expect(readOpId({ t: 'op', opId: 42 })).toBeNull()
    expect(readOpId({ t: 'op', opId: 'x'.repeat(65) })).toBeNull()
    expect(readOpId('op')).toBeNull()
    expect(readOpId(null)).toBeNull()
  })
})
```

Run: `pnpm --filter @mesa/shared test`
Expected: FAIL — `insertLayer`, `isObjectOp`, `readOpId` não existem.

- [ ] **Step 2: Implementar `layers.ts`**

Crie `packages/shared/src/layers.ts`:

```ts
import { GM_LAYER_ID } from './constants'
import type { Layer } from './model'

const isGm = (l: Layer) => l.id === GM_LAYER_ID

/** Cópia ordenada por `order` crescente; a camada do Mestre fica sempre por último (no topo). */
export function sortLayers(layers: Layer[]): Layer[] {
  return [...layers].sort((a, b) => Number(isGm(a)) - Number(isGm(b)) || a.order - b.order)
}

function renumber(layers: Layer[]): Layer[] {
  return layers.map((l, i) => (l.order === i ? l : { ...l, order: i }))
}

/** Nova camada logo abaixo do Mestre (acima de todas as outras); orders viram 0..n-1. */
export function insertLayer(layers: Layer[], input: { id: string; name: string }): Layer[] {
  const sorted = sortLayers(layers)
  const common = sorted.filter((l) => !isGm(l))
  const gm = sorted.filter(isGm)
  const created: Layer = { id: input.id, name: input.name, order: 0, visibility: 'all', locked: false }
  return renumber([...common, created, ...gm])
}

/** Troca com a vizinha; `null` quando não é permitido (Mestre, inexistente ou fora dos limites). */
export function moveLayer(layers: Layer[], id: string, direction: 'up' | 'down'): Layer[] | null {
  if (id === GM_LAYER_ID) return null
  const sorted = sortLayers(layers)
  const common = sorted.filter((l) => !isGm(l))
  const gm = sorted.filter(isGm)
  const i = common.findIndex((l) => l.id === id)
  const j = direction === 'up' ? i + 1 : i - 1
  if (i === -1 || j < 0 || j >= common.length) return null
  ;[common[i], common[j]] = [common[j], common[i]]
  return renumber([...common, ...gm])
}

export function changedLayers(before: Layer[], after: Layer[]): Array<{ before: Layer | null; after: Layer }> {
  const previous = new Map(before.map((l) => [l.id, l]))
  return after
    .filter((l) => {
      const p = previous.get(l.id)
      return !p || p.order !== l.order || p.name !== l.name || p.visibility !== l.visibility || p.locked !== l.locked
    })
    .map((l) => ({ before: previous.get(l.id) ?? null, after: l }))
}
```

Troque `packages/shared/src/index.ts` por:

```ts
export * from './model'
export * from './protocol'
export * from './constants'
export * from './geometry'
export * from './layers'
```

- [ ] **Step 3: Implementar o protocolo**

Substitua `packages/shared/src/protocol.ts` por:

```ts
import { z } from 'zod'
import { LAYER_NAME_MAX, NOTE_MAX } from './constants'
import {
  IdSchema,
  NewObjectSchema,
  ObjectPatchSchema,
  type Layer,
  type Member,
  type TableMetaPublic,
  type TableObject,
} from './model'

export const LayerNameSchema = z.string().trim().min(1).max(LAYER_NAME_MAX)

export const LayerPatchSchema = z
  .strictObject({
    name: LayerNameSchema,
    visibility: z.enum(['all', 'gm']),
    locked: z.boolean(),
  })
  .partial()
export type LayerPatch = z.infer<typeof LayerPatchSchema>

export const OpSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('create'), object: NewObjectSchema }),
  z.object({ kind: z.literal('update'), id: IdSchema, patch: ObjectPatchSchema }),
  z.object({ kind: z.literal('delete'), id: IdSchema }),
  z.object({ kind: z.literal('layerCreate'), layer: z.object({ id: IdSchema, name: LayerNameSchema }) }),
  z.object({ kind: z.literal('layerUpdate'), id: IdSchema, patch: LayerPatchSchema }),
  z.object({ kind: z.literal('layerDelete'), id: IdSchema }),
  z.object({ kind: z.literal('layerMove'), id: IdSchema, direction: z.enum(['up', 'down']) }),
  z.object({ kind: z.literal('noteSet'), objectId: IdSchema, text: z.string().max(NOTE_MAX) }),
  z.object({ kind: z.literal('memberRemove'), clientId: z.string().min(1).max(64) }),
])
export type Op = z.infer<typeof OpSchema>
export type ObjectOp = Extract<Op, { kind: 'create' | 'update' | 'delete' }>

export function isObjectOp(op: Op): op is ObjectOp {
  return op.kind === 'create' || op.kind === 'update' || op.kind === 'delete'
}

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

/** `opId` de uma mensagem `{ t: 'op' }` que falhou no schema, para responder `reject invalid`. */
export function readOpId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const { t, opId } = json as { t?: unknown; opId?: unknown }
  return t === 'op' && typeof opId === 'string' && opId.length >= 1 && opId.length <= 64 ? opId : null
}

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
  /** Só o mestre recebe anotações; jogadores recebem `{}`. */
  notes: Record<string, string>
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
  | { t: 'layerUpsert'; layer: Layer }
  | { t: 'layerShown'; layer: Layer; objects: TableObject[] }
  | { t: 'layerHidden'; id: string }
  | { t: 'layerRemoved'; id: string }
  | { t: 'noteSet'; objectId: string; text: string }
  | { t: 'memberRemoved'; clientId: string }
  | { t: 'error'; reason: 'table_not_found' }
```

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/shared typecheck`
Expected: PASS.

- [ ] **Step 4: Adaptações de compilação no worker (substituídas na Task 6)**

Em `apps/worker/src/engine/engine.ts`, logo depois do bloco `if (op.kind === 'create') { … }` dentro de `execute`, acrescente:

```ts
    // Operações de camada/anotação/membro chegam na Task 6.
    if (op.kind !== 'update' && op.kind !== 'delete') return reject('invalid', null)
```

e no objeto devolvido por `snapshot`, depois de `locks: …`, acrescente a propriedade:

```ts
      notes: {},
```

Run: `pnpm --filter @mesa/worker typecheck && pnpm --filter @mesa/worker test`
Expected: PASS.

- [ ] **Step 5: Adaptações de compilação no web (substituídas na Task 9)**

Em `apps/web/src/store/localOps.ts`, troque `opTargetId` por:

```ts
export function opTargetId(op: Op): string {
  if (op.kind === 'create') return op.object.id
  return op.kind === 'update' || op.kind === 'delete' ? op.id : ''
}
```

e acrescente, como último `case` do `switch` de `applyLocalOp`:

```ts
    default:
      return objects
```

Em `apps/web/src/store/undo.ts`, acrescente como último `case` do `switch`:

```ts
    default:
      return null
```

Em `apps/web/src/store/reducers.ts`, acrescente, depois do `case 'error'` (linhas 194-195), dentro do `switch`:

```ts
    default:
      return s
```

Nos testes, inclua `notes: {}` nos snapshots de exemplo:
- `apps/web/test/reducers.test.ts` linha 17: `snapshot: { meta: { id: 'T', name: 'M' }, members: [self], layers: DEFAULT_LAYERS.slice(0, 3), objects, locks: [], notes: {} },`
- `apps/web/test/sync-client.test.ts` linha 24: `snapshot: { meta: { id: 'T', name: 'M' }, members: [], layers: [], objects: [], locks: [], notes: {} },`

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

---

### Task 4: Identidade — segredo do cliente (`clientSecret`) contra `clientId` falsificado

Adição pedida depois de uma revisão de segurança (não está no spec): como as permissões do M2 são por `clientId`, o `clientId` não pode ser falsificável. Vem cedo porque muda `HelloSchema` e `welcome`; as Tasks 6 e 7 reescrevem `engine.ts` e `table-do.ts` por inteiro e **mantêm** o que esta task introduz.

**Files:**
- Modify: `packages/shared/src/protocol.ts` (`HelloSchema`, `welcome`, `error`)
- Modify: `packages/shared/test/protocol.test.ts` (acrescentar)
- Modify: `apps/worker/src/engine/store.ts:10-16` (`StoredMember.secretHash`)
- Modify: `apps/worker/src/engine/engine.ts` (`join`)
- Modify: `apps/worker/src/table-do.ts:1-11,102-114` (imports e `onHello`)
- Modify: `apps/worker/test/helpers.ts:52-57` (`hello` aceita `clientSecret`)
- Modify: `apps/worker/test/table-do.test.ts` (teste das duas abas + testes novos)
- Modify: `apps/web/src/lib/identity.ts` (acrescentar no fim)
- Modify: `apps/web/src/store/tableStore.ts` (`connect`)
- Modify: `apps/web/src/store/state.ts:32` (`fatal`)
- Modify: `apps/web/src/ui/TablePage.tsx:54-63` (mensagem)
- Create: `apps/web/test/identity.test.ts`
- Modify: `apps/web/test/sync-client.test.ts`, `apps/web/test/reducers.test.ts` (acrescentar)

**Interfaces:**
- Consumes: `randomSecret()`, `sha256Hex()`, `safeEqual()` de `apps/worker/src/crypto.ts` (já existem; `randomSecret` gera 32 bytes base64url).
- Produces:
  - `HelloMessage.clientSecret?: string` (máx. 128)
  - `ServerMessage` `welcome` ganha `clientSecret?: string` (só quando o servidor emite um segredo novo); `error.reason: 'table_not_found' | 'auth'`
  - `StoredMember.secretHash?: string` (SHA-256 hex; nunca sai do servidor)
  - `TableEngine.join(input: { clientId: string; nickname: string; role: Role; secretHash?: string }, online: Set<string>): Member` — sem `secretHash` no input, mantém o que já estava gravado
  - Fechamento `4401 'auth'` depois de `{ t: 'error', reason: 'auth' }`
  - Web: `readClientSecret(tableId: string): string | undefined`, `rememberClientSecret(tableId: string, secret: string): void` (chave `mesa:secret:<tableId>`, fallback em memória), `shouldRetryAuth(sentSecret: string | undefined, storedSecret: string | undefined, alreadyRetried: boolean): boolean`
  - `TableState.fatal: 'table_not_found' | 'auth' | null`
  - Teste: `TestClient.hello(nickname, { clientId?, gmSecret?, clientSecret? })`

Regras (servidor, em `onHello`; todos os `await` acontecem **antes** de ler o membro, para que ler-decidir-gravar seja atômico no DO):
1. Calcula `providedHash = sha256Hex(clientSecret)` (se veio) e um candidato `candidate = randomSecret()` com seu hash.
2. Membro conhecido **com** `secretHash`: exige `safeEqual(providedHash, secretHash)`; senão envia `{ t: 'error', reason: 'auth' }`, fecha com `4401` e não toca em nada (o membro real e as sessões dele seguem intactos).
3. Membro desconhecido, ou membro do M1 sem `secretHash` (*trust-on-first-use*): adota o candidato, grava só o hash e devolve o segredo **uma vez** em `welcome.clientSecret`.

Cliente: guarda o segredo por mesa e o envia em todo `hello`. Ao receber `error auth`, se o armazenamento passou a ter um segredo diferente do que foi enviado (outra aba entrou primeiro), reconecta **uma** vez; senão mostra "Identidade inválida — limpe os dados do site ou entre com outro navegador" e não reconecta (o `SyncClient` já para de reconectar em qualquer `error`).

- [ ] **Step 1: Protocolo (teste falha)**

Acrescente no fim de `packages/shared/test/protocol.test.ts`:

```ts
describe('hello com clientSecret', () => {
  it('aceita segredo opcional até 128 caracteres', () => {
    const base = { t: 'hello', clientId: uuid, nickname: 'Ana' }
    expect(ClientMessageSchema.safeParse({ ...base, clientSecret: 'a'.repeat(43) }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ ...base, clientSecret: 'a'.repeat(129) }).success).toBe(false)
  })
})
```

Run: `pnpm --filter @mesa/shared test -- protocol`
Expected: FAIL (o campo é descartado/ não validado: o caso de 129 caracteres passa).

Em `packages/shared/src/protocol.ts`, troque `HelloSchema` por:

```ts
const HelloSchema = z.object({
  t: z.literal('hello'),
  clientId: z.uuid(),
  nickname: z.string().trim().min(1).max(32),
  gmSecret: z.string().max(128).optional(),
  clientSecret: z.string().max(128).optional(),
})
```

e, em `ServerMessage`, troque as linhas de `welcome` e `error` por:

```ts
  | { t: 'welcome'; self: Member; snapshot: Snapshot; clientSecret?: string }
```

```ts
  | { t: 'error'; reason: 'table_not_found' | 'auth' }
```

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/shared typecheck`
Expected: PASS.

- [ ] **Step 2: Testes do worker (falham)**

Em `apps/worker/test/helpers.ts`, troque `hello` (linhas 52-57) por:

```ts
  async hello(nickname: string, opts: { clientId?: string; gmSecret?: string; clientSecret?: string } = {}) {
    const clientId = opts.clientId ?? crypto.randomUUID()
    this.send({
      t: 'hello',
      clientId,
      nickname,
      ...(opts.gmSecret ? { gmSecret: opts.gmSecret } : {}),
      ...(opts.clientSecret ? { clientSecret: opts.clientSecret } : {}),
    })
    const welcome = await this.waitFor('welcome')
    return { clientId, welcome }
  }
```

Em `apps/worker/test/table-do.test.ts`, no teste `'mesma pessoa em duas abas: …'`, troque as duas primeiras chamadas de `hello` por:

```ts
    const { clientId, welcome } = await tab1.hello('Ana')
    await tab2.hello('Ana', { clientId, clientSecret: welcome.clientSecret })
```

Acrescente aos imports do arquivo:

```ts
import { env } from 'cloudflare:workers'
import { runInDurableObject } from 'cloudflare:test'
import { SqlStore } from '../src/engine/sql-store'
```

e acrescente no fim do arquivo:

```ts
describe('TableDO — identidade (clientSecret)', () => {
  it('primeiro hello recebe um segredo; hello falsificado é recusado sem atrapalhar o dono; segredo certo reconecta', async () => {
    const { tableId } = await createTable()
    const real = await TestClient.connect(tableId)
    const { clientId, welcome } = await real.hello('Ana')
    expect(welcome.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)

    const noSecret = await TestClient.connect(tableId)
    noSecret.send({ t: 'hello', clientId, nickname: 'Falsa' })
    expect(await noSecret.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })

    const wrongSecret = await TestClient.connect(tableId)
    wrongSecret.send({ t: 'hello', clientId, nickname: 'Falsa', clientSecret: 'b'.repeat(43) })
    expect(await wrongSecret.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })
    await wrongSecret.expectNone('welcome')

    await real.expectNone('memberJoined')
    await real.expectNone('memberLeft')
    real.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: tokenObject() } })
    expect(await real.waitFor('ack')).toMatchObject({ opId: 'op_1' })

    const tab2 = await TestClient.connect(tableId)
    const { welcome: again } = await tab2.hello('Ana', { clientId, clientSecret: welcome.clientSecret })
    expect(again.self.clientId).toBe(clientId)
    expect(again.clientSecret).toBeUndefined()
    expect(again.snapshot.members.find((m) => m.clientId === clientId)?.nickname).toBe('Ana')
  })

  it('membro do M1 sem hash adota o primeiro segredo que chegar (trust-on-first-use)', async () => {
    const { tableId } = await createTable()
    const clientId = crypto.randomUUID()
    await runInDurableObject(env.TABLES.get(env.TABLES.idFromName(tableId)), (_instance, state) => {
      new SqlStore(state.storage.sql).upsertMember({ clientId, nickname: 'Ana', color: '#e6194b', role: 'player', lastSeenAt: Date.now() })
    })
    const first = await TestClient.connect(tableId)
    const { welcome } = await first.hello('Ana', { clientId })
    expect(welcome.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    first.close()

    const intruder = await TestClient.connect(tableId)
    intruder.send({ t: 'hello', clientId, nickname: 'Ana' })
    expect(await intruder.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })
  })
})
```

Run: `pnpm --filter @mesa/worker test -- table-do`
Expected: FAIL (`welcome` sem `clientSecret`, hello falsificado aceito).

- [ ] **Step 3: Implementar no worker**

Em `apps/worker/src/engine/store.ts`, troque `StoredMember` (linhas 10-16) por:

```ts
export interface StoredMember {
  clientId: string
  nickname: string
  color: string
  role: Role
  lastSeenAt: number
  /** SHA-256 hex do clientSecret; ausente em membros gravados pelo M1. */
  secretHash?: string
}
```

Em `apps/worker/src/engine/engine.ts`, troque o método `join` por:

```ts
  join(input: { clientId: string; nickname: string; role: Role; secretHash?: string }, online: Set<string>): Member {
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
    const secretHash = input.secretHash ?? existing?.secretHash
    const stored: StoredMember = {
      clientId: input.clientId,
      nickname: input.nickname,
      role: input.role,
      color,
      lastSeenAt: this.now(),
      ...(secretHash ? { secretHash } : {}),
    }
    this.store.upsertMember(stored)
    return { clientId: input.clientId, nickname: input.nickname, color, role: input.role, online: true }
  }
```

Em `apps/worker/src/table-do.ts`, troque o import de `./crypto` por:

```ts
import { randomSecret, safeEqual, sha256Hex } from './crypto'
```

e troque `onHello` por:

```ts
  private async onHello(ws: WebSocket, msg: Msg<'hello'>): Promise<void> {
    const meta = this.store.getMeta()
    if (!meta) return
    let role: Role = 'player'
    if (msg.gmSecret && safeEqual(await sha256Hex(msg.gmSecret), meta.gmSecretHash)) role = 'gm'
    // Todos os awaits antes de ler o membro: ler-decidir-gravar fica atômico no DO.
    const providedHash = msg.clientSecret ? await sha256Hex(msg.clientSecret) : null
    const candidate = randomSecret()
    const candidateHash = await sha256Hex(candidate)

    const existing = this.store.getMember(msg.clientId)
    let issued: string | undefined
    if (existing?.secretHash) {
      if (!providedHash || !safeEqual(providedHash, existing.secretHash)) {
        this.send(ws, { t: 'error', reason: 'auth' })
        ws.close(4401, 'auth')
        return
      }
    } else {
      issued = candidate // membro novo ou do M1 sem hash: trust-on-first-use
    }

    const online = this.onlineClientIds()
    const member = this.engine.join(
      { clientId: msg.clientId, nickname: msg.nickname, role, ...(issued ? { secretHash: candidateHash } : {}) },
      online,
    )
    const att: Attachment = { sessionId: crypto.randomUUID(), clientId: msg.clientId, role }
    ws.serializeAttachment(att)
    online.add(msg.clientId)
    this.send(ws, {
      t: 'welcome',
      self: member,
      snapshot: this.engine.snapshot(role, online),
      ...(issued ? { clientSecret: issued } : {}),
    })
    this.broadcast(att.sessionId, () => ({ t: 'memberJoined', member }))
  }
```

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: PASS.

- [ ] **Step 4: Testes do web (falham)**

Crie `apps/web/test/identity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { shouldRetryAuth } from '../src/lib/identity'

describe('shouldRetryAuth', () => {
  // Review Focus #3
  it('tenta de novo uma vez quando outra aba gravou um segredo diferente do enviado', () => {
    expect(shouldRetryAuth(undefined, 'novo', false)).toBe(true)
    expect(shouldRetryAuth('velho', 'novo', false)).toBe(true)
  })

  it('não tenta de novo se já tentou, se nada mudou ou se não há segredo guardado', () => {
    expect(shouldRetryAuth(undefined, 'novo', true)).toBe(false)
    expect(shouldRetryAuth('igual', 'igual', false)).toBe(false)
    expect(shouldRetryAuth('velho', undefined, false)).toBe(false)
  })
})
```

Acrescente ao `describe('SyncClient', …)` de `apps/web/test/sync-client.test.ts`:

```ts
  it('error auth encerra sem reconectar', () => {
    client.connect()
    last().open()
    last().receive({ t: 'error', reason: 'auth' })
    last().drop()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(statuses.at(-1)).toBe('closed')
    expect(received).toEqual([{ t: 'error', reason: 'auth' }])
  })
```

Acrescente ao `describe('mensagens de outros', …)` de `apps/web/test/reducers.test.ts`:

```ts
  it('error auth marca fatal auth e fecha', () => {
    const s = reduceServer(joined(), { t: 'error', reason: 'auth' }, 0)
    expect(s.fatal).toBe('auth')
    expect(s.status).toBe('closed')
  })
```

Run: `pnpm --filter @mesa/web test`
Expected: FAIL (`shouldRetryAuth` não existe).

- [ ] **Step 5: Implementar no web**

Acrescente no fim de `apps/web/src/lib/identity.ts`:

```ts
const secretKey = (tableId: string) => `mesa:secret:${tableId}`
// fallback em memória quando o localStorage está bloqueado
const memorySecrets = new Map<string, string>()

export function readClientSecret(tableId: string): string | undefined {
  return safeGet(secretKey(tableId)) ?? memorySecrets.get(tableId)
}

export function rememberClientSecret(tableId: string, secret: string): void {
  memorySecrets.set(tableId, secret)
  safeSet(secretKey(tableId), secret)
}

/**
 * Duas abas entrando pela primeira vez ao mesmo tempo: a segunda é recusada porque a
 * primeira já adotou um segredo. Se o armazenamento passou a ter um segredo diferente
 * do que esta aba enviou, vale tentar de novo — uma vez só.
 */
export function shouldRetryAuth(sentSecret: string | undefined, storedSecret: string | undefined, alreadyRetried: boolean): boolean {
  return !alreadyRetried && !!storedSecret && storedSecret !== sentSecret
}
```

Em `apps/web/src/store/state.ts`, troque a linha `fatal: 'table_not_found' | null` por:

```ts
  fatal: 'table_not_found' | 'auth' | null
```

Em `apps/web/src/store/tableStore.ts`:
- troque o import de `../lib/identity` por:

```ts
import { getClientId, readClientSecret, readGmSecret, rememberClientSecret, shouldRetryAuth } from '../lib/identity'
```

- logo depois de `let writes = 0`, acrescente:

```ts
  let authRetried = false
```

- troque o começo de `connect` (de `connect(nickname) {` até o fim do `onMessage`) por:

```ts
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
```

(o `onStatus`, `createSocket` e o resto de `connect` continuam iguais).

Em `apps/web/src/ui/TablePage.tsx`, troque o bloco `if (fatal) { … }` (linhas 54-63) por:

```tsx
  if (fatal) {
    return (
      <div className="fullscreen-msg">
        <div>
          {fatal === 'auth' ? (
            <p>Identidade inválida — limpe os dados do site ou entre com outro navegador</p>
          ) : (
            <>
              <p>Mesa não encontrada.</p>
              <a href="/" style={{ color: '#9db4ff' }}>Criar uma nova mesa</a>
            </>
          )}
        </div>
      </div>
    )
  }
```

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test`
Expected: verde.

---

### Task 5: Worker — store: camadas, anotações e remoção de membros

**Files:**
- Modify: `apps/worker/src/engine/store.ts` (interface `TableStore`)
- Modify: `apps/worker/src/engine/memory-store.ts` (arquivo inteiro)
- Modify: `apps/worker/src/engine/sql-store.ts` (construtor + métodos novos)
- Create: `apps/worker/test/store-contract.ts`
- Modify: `apps/worker/test/sql-store.test.ts` (acrescentar no fim)

**Interfaces:**
- Consumes: `normalizeObject` (Task 1).
- Produces (`TableStore`):
  - `putLayer(layer: Layer): void` (insere ou substitui)
  - `deleteLayer(id: string): void`
  - `deleteMember(clientId: string): void`
  - `listNotes(): Record<string, string>`
  - `setNote(objectId: string, text: string): void` (texto `''` apaga a linha)
  - `deleteNote(objectId: string): void`
  - `checkStoreContract(store: TableStore): void` em `apps/worker/test/store-contract.ts`

- [ ] **Step 1: Contrato do store (falha)**

Crie `apps/worker/test/store-contract.ts`:

```ts
import { expect } from 'vitest'
import { DEFAULT_LAYERS } from '@mesa/shared'
import type { TableStore } from '../src/engine/store'

/** Verificações síncronas válidas para qualquer TableStore recém-criado. */
export function checkStoreContract(store: TableStore): void {
  store.initTable({ id: 'T', name: 'Mesa', gmSecretHash: 'h', createdAt: 0 }, DEFAULT_LAYERS)

  store.putLayer({ id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false })
  store.putLayer({ ...DEFAULT_LAYERS[3], order: 4 })
  expect(store.getLayers().map((l) => `${l.id}:${l.order}`)).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
  store.putLayer({ id: 'nova', name: 'Renomeada', order: 3, visibility: 'gm', locked: true })
  expect(store.getLayers().find((l) => l.id === 'nova')).toEqual({ id: 'nova', name: 'Renomeada', order: 3, visibility: 'gm', locked: true })
  store.deleteLayer('nova')
  expect(store.getLayers().map((l) => l.id)).toEqual(['map', 'tokens', 'drawings', 'gm'])

  store.setNote('o1', 'segredo')
  store.setNote('o2', 'outra')
  store.setNote('o2', 'outra editada')
  expect(store.listNotes()).toEqual({ o1: 'segredo', o2: 'outra editada' })
  store.setNote('o1', '')
  store.deleteNote('o2')
  expect(store.listNotes()).toEqual({})

  store.upsertMember({ clientId: 'A', nickname: 'Ana', color: '#e6194b', role: 'player', lastSeenAt: 1 })
  store.deleteMember('A')
  expect(store.getMember('A')).toBeNull()
  expect(store.listMembers()).toEqual([])
}
```

Acrescente no fim de `apps/worker/test/sql-store.test.ts` (e adicione `import { MemoryStore } from '../src/engine/memory-store'` e `import { checkStoreContract } from './store-contract'` aos imports):

```ts
describe('contrato do TableStore', () => {
  it('MemoryStore', () => {
    checkStoreContract(new MemoryStore())
  })

  it('SqlStore', async () => {
    await runInDurableObject(freshStub(), (_instance, state) => {
      checkStoreContract(new SqlStore(state.storage.sql))
    })
  })
})
```

Run: `pnpm --filter @mesa/worker test -- sql-store`
Expected: FAIL — `putLayer is not a function`.

- [ ] **Step 2: Implementar**

Em `apps/worker/src/engine/store.ts`, troque a interface `TableStore` por (o `StoredMember` com `secretHash` da Task 4 continua acima dela):

```ts
export interface TableStore {
  getMeta(): TableMeta | null
  initTable(meta: TableMeta, layers: Layer[]): void
  getLayers(): Layer[]
  putLayer(layer: Layer): void
  deleteLayer(id: string): void
  getMember(clientId: string): StoredMember | null
  upsertMember(member: StoredMember): void
  deleteMember(clientId: string): void
  listMembers(): StoredMember[]
  getObject(id: string): TableObject | null
  listObjects(): TableObject[]
  putObject(object: TableObject): void
  deleteObject(id: string): void
  listNotes(): Record<string, string>
  /** Texto vazio apaga a anotação. */
  setNote(objectId: string, text: string): void
  deleteNote(objectId: string): void
  getAppliedOp(clientId: string, opId: string): number | null
  recordAppliedOp(clientId: string, opId: string, version: number): void
}
```

Substitua `apps/worker/src/engine/memory-store.ts` por:

```ts
import { APPLIED_OPS_KEEP, type Layer, type TableObject } from '@mesa/shared'
import type { StoredMember, TableMeta, TableStore } from './store'

export class MemoryStore implements TableStore {
  private meta: TableMeta | null = null
  private layers: Layer[] = []
  private members = new Map<string, StoredMember>()
  private objects = new Map<string, TableObject>()
  private notes = new Map<string, string>()
  private applied = new Map<string, number>()
  private appliedOrder = new Map<string, string[]>()

  getMeta() { return this.meta }

  initTable(meta: TableMeta, layers: Layer[]) {
    this.meta = meta
    this.layers = layers.map((l) => ({ ...l }))
  }

  getLayers() { return [...this.layers].sort((a, b) => a.order - b.order) }
  putLayer(layer: Layer) { this.layers = [...this.layers.filter((l) => l.id !== layer.id), { ...layer }] }
  deleteLayer(id: string) { this.layers = this.layers.filter((l) => l.id !== id) }
  getMember(clientId: string) { return this.members.get(clientId) ?? null }
  upsertMember(member: StoredMember) { this.members.set(member.clientId, { ...member }) }
  deleteMember(clientId: string) { this.members.delete(clientId) }
  listMembers() { return [...this.members.values()] }
  getObject(id: string) { return this.objects.get(id) ?? null }
  listObjects() { return [...this.objects.values()] }
  putObject(object: TableObject) { this.objects.set(object.id, object) }
  deleteObject(id: string) { this.objects.delete(id) }
  listNotes() { return Object.fromEntries(this.notes) }

  setNote(objectId: string, text: string) {
    if (text === '') this.notes.delete(objectId)
    else this.notes.set(objectId, text)
  }

  deleteNote(objectId: string) { this.notes.delete(objectId) }

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

Em `apps/worker/src/engine/sql-store.ts`, acrescente no construtor (depois da criação de `applied_ops`):

```ts
    sql.exec('CREATE TABLE IF NOT EXISTS gm_notes (object_id TEXT PRIMARY KEY, text TEXT NOT NULL)')
```

e acrescente os métodos na classe (antes de `getAppliedOp`):

```ts
  putLayer(layer: Layer): void {
    this.sql.exec('INSERT OR REPLACE INTO layers (id, data) VALUES (?, ?)', layer.id, JSON.stringify(layer))
  }

  deleteLayer(id: string): void {
    this.sql.exec('DELETE FROM layers WHERE id = ?', id)
  }

  deleteMember(clientId: string): void {
    this.sql.exec('DELETE FROM members WHERE client_id = ?', clientId)
  }

  listNotes(): Record<string, string> {
    const rows = this.sql.exec<{ object_id: string; text: string }>('SELECT object_id, text FROM gm_notes').toArray()
    return Object.fromEntries(rows.map((r) => [r.object_id, r.text]))
  }

  setNote(objectId: string, text: string): void {
    if (text === '') this.deleteNote(objectId)
    else this.sql.exec('INSERT OR REPLACE INTO gm_notes (object_id, text) VALUES (?, ?)', objectId, text)
  }

  deleteNote(objectId: string): void {
    this.sql.exec('DELETE FROM gm_notes WHERE object_id = ?', objectId)
  }
```

- [ ] **Step 3: Checkpoint**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: verde.

---

### Task 6: Worker — `TableEngine`: controle, camadas, anotações e membros

O engine passa a devolver `effects: OpEffect[]` em vez de `before/after`. O `TableDO` é ajustado no mínimo para compilar (traduz só o efeito de objeto, como antes); a difusão completa vem na Task 7.

**Files:**
- Modify: `apps/worker/src/engine/engine.ts` (arquivo inteiro)
- Modify: `apps/worker/src/table-do.ts` (método `onOp`)
- Modify: `apps/worker/test/engine.test.ts` (arquivo inteiro)
- Modify: `apps/worker/test/table-do.test.ts` (teste `'trava: segundo grab é negado; …'`)

**Interfaces:**
- Consumes: `canControl`, `mergePatch`, `insertLayer`, `moveLayer`, `changedLayers`, `GM_LAYER_ID`, `MEMBER_RECENT_MS`, `LayerPatch`, `NewObject` (Tasks 1–3); `TableStore` com os métodos da Task 5.
- Produces:
  - `type LayerChange = { before: Layer | null; after: Layer }`
  - `type OpEffect = { kind: 'object'; before: TableObject | null; after: TableObject | null } | { kind: 'layers'; changes: LayerChange[] } | { kind: 'layerRemoved'; layer: Layer } | { kind: 'note'; objectId: string; text: string } | { kind: 'memberRemoved'; clientId: string } | { kind: 'released'; objectId: string; clientId: string }`
  - `type OpResult = { ok: true; duplicate: true; version: number } | { ok: true; duplicate: false; version: number; effects: OpEffect[] } | { ok: false; reason: RejectReason; current: TableObject | null }`
  - `TableEngine.applyOp(clientId: string, role: Role, opId: string, op: Op, online?: Set<string>): OpResult` (`online` padrão = conjunto vazio; usado por `memberRemove`)
  - `TableEngine.canEditObject(clientId: string, role: Role, object: TableObject): boolean`
  - `TableEngine.grab(clientId, role, objectId)` agora exige poder controlar
  - `TableEngine.snapshot(role, online)` filtra membros (online ou vistos em 7 dias) e devolve `notes` só para `gm`
  - Versão no `ack` de operações que não são de objeto: `0`

- [ ] **Step 1: Reescrever os testes do engine (falham)**

Substitua `apps/worker/test/engine.test.ts` por:

```ts
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, LOCK_TTL_MS, MEMBER_RECENT_MS, type NewObject, type ObjectPatch, type Op } from '@mesa/shared'
import { MemoryStore } from '../src/engine/memory-store'
import { TableEngine, type OpResult } from '../src/engine/engine'

let clock = 1_000
let store: MemoryStore
let engine: TableEngine

const token = (over: Partial<NewObject> = {}): NewObject =>
  ({
    id: 'tok1', type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64),
    x: 10, y: 20, width: 70, height: 70, rotation: 0, zIndex: 1, ...over,
  }) as NewObject

const create = (o: NewObject): Op => ({ kind: 'create', object: o })
const update = (id: string, patch: ObjectPatch): Op => ({ kind: 'update', id, patch })
const effects = (r: OpResult) => (r.ok && !r.duplicate ? r.effects : [])
const order = () => store.getLayers().map((l) => `${l.id}:${l.order}`)
const ALL = { mode: 'all' as const, clientIds: [] }

beforeEach(() => {
  clock = 1_000
  store = new MemoryStore()
  store.initTable({ id: 'T', name: 'Mesa', gmSecretHash: 'h', createdAt: 0 }, DEFAULT_LAYERS)
  engine = new TableEngine(store, () => clock)
})

describe('applyOp create', () => {
  it('cria com version 1, dono = autor e controle só do autor', () => {
    const r = engine.applyOp('A', 'player', 'op1', create(token()))
    expect(r).toMatchObject({ ok: true, duplicate: false, version: 1 })
    expect(store.getObject('tok1')).toMatchObject({ ownerId: 'A', updatedBy: 'A', version: 1, control: { mode: 'list', clientIds: ['A'] } })
  })

  it('ignora control enviado pelo cliente', () => {
    engine.applyOp('A', 'player', 'op1', create({ ...token(), control: ALL } as NewObject))
    expect(store.getObject('tok1')?.control).toEqual({ mode: 'list', clientIds: ['A'] })
  })

  it('opId repetido não reaplica', () => {
    engine.applyOp('A', 'player', 'op1', create(token()))
    expect(engine.applyOp('A', 'player', 'op1', create(token()))).toEqual({ ok: true, duplicate: true, version: 1 })
  })

  it('id existente é rejeitado com exists', () => {
    engine.applyOp('A', 'player', 'op1', create(token()))
    expect(engine.applyOp('B', 'player', 'op2', create(token()))).toMatchObject({ ok: false, reason: 'exists' })
  })

  it('jogador não cria na camada do mestre; mestre cria; camada inexistente é forbidden', () => {
    expect(engine.applyOp('A', 'player', 'op1', create(token({ layerId: 'gm' })))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'op2', create(token({ layerId: 'gm' })))).toMatchObject({ ok: true })
    expect(engine.applyOp('A', 'player', 'op3', create(token({ id: 'x', layerId: 'nope' })))).toMatchObject({ ok: false, reason: 'forbidden' })
  })
})

describe('applyOp update/delete', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('mescla patch, incrementa version e devolve o efeito de objeto', () => {
    const r = engine.applyOp('A', 'player', 'op1', update('tok1', { x: 99 }))
    expect(r).toMatchObject({ ok: true, version: 2 })
    expect(effects(r)).toEqual([
      { kind: 'object', before: expect.objectContaining({ x: 10 }), after: expect.objectContaining({ x: 99, version: 2 }) },
    ])
    expect(store.getObject('tok1')).toMatchObject({ x: 99, y: 20, version: 2, updatedBy: 'A', ownerId: 'A' })
  })

  it('patch de campo de outro tipo é descartado sem corromper', () => {
    engine.applyOp('A', 'player', 'op1', update('tok1', { color: '#ffffff' }))
    expect(store.getObject('tok1')).not.toHaveProperty('color')
  })

  it('objeto inexistente → not_found', () => {
    expect(engine.applyOp('A', 'player', 'op1', update('zzz', { x: 1 }))).toMatchObject({ ok: false, reason: 'not_found', current: null })
  })

  it('jogador não enxerga objeto da camada do mestre (not_found)', () => {
    engine.applyOp('G', 'gm', 'opg', create(token({ id: 'secret', layerId: 'gm' })))
    expect(engine.applyOp('A', 'player', 'op1', update('secret', { x: 1 }))).toMatchObject({ ok: false, reason: 'not_found', current: null })
  })

  it('delete remove e devolve o efeito com before', () => {
    const r = engine.applyOp('A', 'player', 'op1', { kind: 'delete', id: 'tok1' })
    expect(effects(r)).toEqual([{ kind: 'object', before: expect.objectContaining({ id: 'tok1' }), after: null }])
    expect(store.getObject('tok1')).toBeNull()
  })

  it('title: define, remove com null', () => {
    engine.applyOp('A', 'player', 'op1', update('tok1', { title: 'Goblin' }))
    expect(store.getObject('tok1')?.title).toBe('Goblin')
    engine.applyOp('A', 'player', 'op2', update('tok1', { title: null }))
    expect(store.getObject('tok1')).not.toHaveProperty('title')
  })
})

describe('controle', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('lista: quem não está nela recebe forbidden com o estado atual e não pega a trava', () => {
    expect(engine.applyOp('B', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: false, reason: 'forbidden', current: { id: 'tok1', x: 10 } })
    expect(engine.applyOp('B', 'player', 'op2', { kind: 'delete', id: 'tok1' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.grab('B', 'player', 'tok1')).toBe(false)
  })

  it('modo all: qualquer jogador controla', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { control: ALL }))
    expect(engine.applyOp('B', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
    expect(engine.grab('B', 'player', 'tok1')).toBe(true)
  })

  it('modo gm: nem o autor controla; o mestre sim', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { control: { mode: 'gm', clientIds: ['A'] } }))
    expect(engine.applyOp('A', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.grab('A', 'player', 'tok1')).toBe(false)
    expect(engine.applyOp('G', 'gm', 'g2', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
  })

  it('lista com outro jogador incluído', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { control: { mode: 'list', clientIds: ['A', 'B'] } }))
    expect(engine.applyOp('B', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
  })

  it('só o mestre muda control', () => {
    expect(engine.applyOp('A', 'player', 'op1', update('tok1', { control: ALL }))).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('jogador que controla não muda layerId, nem para a mesma camada', () => {
    expect(engine.applyOp('A', 'player', 'op1', update('tok1', { layerId: 'drawings' }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('A', 'player', 'op2', update('tok1', { layerId: 'tokens' }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(store.getObject('tok1')?.layerId).toBe('tokens')
  })

  it('mestre move entre camadas mantendo posição e tamanho', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { layerId: 'gm', zIndex: 5 }))
    expect(store.getObject('tok1')).toMatchObject({ layerId: 'gm', x: 10, y: 20, width: 70, height: 70, zIndex: 5 })
    expect(engine.applyOp('G', 'gm', 'g2', update('tok1', { layerId: 'nope' }))).toMatchObject({ ok: false, reason: 'forbidden' })
  })

  it('camada travada: jogador que controla não edita; mestre edita', () => {
    engine.applyOp('G', 'gm', 'g1', { kind: 'layerUpdate', id: 'tokens', patch: { locked: true } })
    expect(engine.applyOp('A', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g2', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
  })
})

describe('travas', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
    engine.applyOp('G', 'gm', 'g0', update('tok1', { control: ALL }))
  })

  it('outro cliente não altera objeto travado', () => {
    expect(engine.grab('A', 'player', 'tok1')).toBe(true)
    expect(engine.grab('B', 'player', 'tok1')).toBe(false)
    expect(engine.applyOp('B', 'player', 'op1', update('tok1', { x: 1 }))).toMatchObject({ ok: false, reason: 'locked' })
    expect(engine.applyOp('A', 'player', 'op2', update('tok1', { x: 1 }))).toMatchObject({ ok: true })
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

  it('esconder a camada solta as travas de jogadores, não as do mestre', () => {
    engine.applyOp('G', 'gm', 'g1', create(token({ id: 'tok2' })))
    engine.grab('A', 'player', 'tok1')
    engine.grab('G', 'gm', 'tok2')
    const r = engine.applyOp('G', 'gm', 'g2', { kind: 'layerUpdate', id: 'tokens', patch: { visibility: 'gm' } })
    expect(effects(r)).toContainEqual({ kind: 'released', objectId: 'tok1', clientId: 'A' })
    expect(engine.activeLocks()).toEqual([{ objectId: 'tok2', clientId: 'G' }])
  })
})

describe('camadas', () => {
  it('jogador não mexe em camadas', () => {
    const ops: Op[] = [
      { kind: 'layerCreate', layer: { id: 'n', name: 'N' } },
      { kind: 'layerUpdate', id: 'map', patch: { name: 'X' } },
      { kind: 'layerDelete', id: 'map' },
      { kind: 'layerMove', id: 'map', direction: 'up' },
    ]
    ops.forEach((op, i) => expect(engine.applyOp('A', 'player', `p${i}`, op)).toMatchObject({ ok: false, reason: 'forbidden', current: null }))
  })

  it('layerCreate entra logo abaixo do Mestre e devolve as camadas afetadas', () => {
    const r = engine.applyOp('G', 'gm', 'g1', { kind: 'layerCreate', layer: { id: 'nova', name: 'Nova camada' } })
    expect(r).toMatchObject({ ok: true, version: 0 })
    expect(order()).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
    expect(effects(r)).toEqual([
      {
        kind: 'layers',
        changes: [
          { before: null, after: { id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false } },
          { before: expect.objectContaining({ id: 'gm', order: 3 }), after: expect.objectContaining({ id: 'gm', order: 4 }) },
        ],
      },
    ])
    expect(engine.applyOp('G', 'gm', 'g2', { kind: 'layerCreate', layer: { id: 'nova', name: 'Outra' } })).toMatchObject({ ok: false, reason: 'exists' })
  })

  it('layerUpdate renomeia e trava; a camada do Mestre não pode ser mostrada', () => {
    engine.applyOp('G', 'gm', 'g1', { kind: 'layerUpdate', id: 'gm', patch: { name: 'Segredos', locked: true } })
    expect(store.getLayers().find((l) => l.id === 'gm')).toMatchObject({ name: 'Segredos', locked: true, visibility: 'gm' })
    expect(engine.applyOp('G', 'gm', 'g2', { kind: 'layerUpdate', id: 'gm', patch: { visibility: 'all' } })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g3', { kind: 'layerUpdate', id: 'nope', patch: { name: 'X' } })).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('layerMove troca com a vizinha; não passa do Mestre, não desce do fundo e o Mestre não se move', () => {
    expect(engine.applyOp('G', 'gm', 'g1', { kind: 'layerMove', id: 'map', direction: 'up' })).toMatchObject({ ok: true })
    expect(order()).toEqual(['tokens:0', 'map:1', 'drawings:2', 'gm:3'])
    expect(engine.applyOp('G', 'gm', 'g2', { kind: 'layerMove', id: 'drawings', direction: 'up' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g3', { kind: 'layerMove', id: 'tokens', direction: 'down' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g4', { kind: 'layerMove', id: 'gm', direction: 'down' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g5', { kind: 'layerMove', id: 'nope', direction: 'up' })).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('layerDelete apaga objetos, anotações e travas da camada', () => {
    engine.applyOp('A', 'player', 'p1', create(token({ id: 'd1', layerId: 'drawings' })))
    engine.applyOp('G', 'gm', 'g1', { kind: 'noteSet', objectId: 'd1', text: 'nota' })
    engine.grab('A', 'player', 'd1')
    const r = engine.applyOp('G', 'gm', 'g2', { kind: 'layerDelete', id: 'drawings' })
    expect(effects(r)).toEqual([{ kind: 'layerRemoved', layer: expect.objectContaining({ id: 'drawings' }) }])
    expect(store.getObject('d1')).toBeNull()
    expect(store.listNotes()).toEqual({})
    expect(engine.activeLocks()).toEqual([])
    expect(store.getLayers().map((l) => l.id)).toEqual(['map', 'tokens', 'gm'])
  })

  it('layerDelete recusa o Mestre e a última camada comum', () => {
    expect(engine.applyOp('G', 'gm', 'g1', { kind: 'layerDelete', id: 'gm' })).toMatchObject({ ok: false, reason: 'forbidden' })
    engine.applyOp('G', 'gm', 'g2', { kind: 'layerDelete', id: 'map' })
    engine.applyOp('G', 'gm', 'g3', { kind: 'layerDelete', id: 'tokens' })
    expect(engine.applyOp('G', 'gm', 'g4', { kind: 'layerDelete', id: 'drawings' })).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(store.getLayers().map((l) => l.id)).toEqual(['drawings', 'gm'])
  })
})

describe('anotações', () => {
  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('só o mestre escreve; snapshot entrega só ao mestre; texto vazio remove', () => {
    expect(engine.applyOp('A', 'player', 'p1', { kind: 'noteSet', objectId: 'tok1', text: 'x' })).toMatchObject({ ok: false, reason: 'forbidden' })
    const r = engine.applyOp('G', 'gm', 'g1', { kind: 'noteSet', objectId: 'tok1', text: 'tem 3 PV' })
    expect(effects(r)).toEqual([{ kind: 'note', objectId: 'tok1', text: 'tem 3 PV' }])
    expect(engine.snapshot('gm', new Set()).notes).toEqual({ tok1: 'tem 3 PV' })
    expect(engine.snapshot('player', new Set()).notes).toEqual({})
    engine.applyOp('G', 'gm', 'g2', { kind: 'noteSet', objectId: 'tok1', text: '   ' })
    expect(engine.snapshot('gm', new Set()).notes).toEqual({})
  })

  it('apagar o objeto apaga a anotação; objeto inexistente é not_found', () => {
    engine.applyOp('G', 'gm', 'g1', { kind: 'noteSet', objectId: 'tok1', text: 'nota' })
    engine.applyOp('A', 'player', 'p1', { kind: 'delete', id: 'tok1' })
    expect(store.listNotes()).toEqual({})
    expect(engine.applyOp('G', 'gm', 'g2', { kind: 'noteSet', objectId: 'tok1', text: 'x' })).toMatchObject({ ok: false, reason: 'not_found' })
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

  it('lista só quem está online ou foi visto nos últimos 7 dias', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    engine.join({ clientId: 'B', nickname: 'Bia', role: 'player' }, new Set())
    clock += MEMBER_RECENT_MS
    engine.touchMember('B')
    clock += 1
    expect(engine.snapshot('player', new Set()).members.map((m) => m.clientId)).toEqual(['B'])
    expect(engine.snapshot('player', new Set(['A'])).members.map((m) => m.clientId).sort()).toEqual(['A', 'B'])
  })

  it('join mantém o hash do segredo quando não recebe outro e não o expõe no snapshot', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player', secretHash: 'h1' }, new Set())
    engine.join({ clientId: 'A', nickname: 'Ana 2', role: 'player' }, new Set())
    expect(store.getMember('A')).toMatchObject({ nickname: 'Ana 2', secretHash: 'h1' })
    expect(engine.snapshot('gm', new Set(['A'])).members[0]).not.toHaveProperty('secretHash')
  })

  it('memberRemove: recusa online, remove offline, e quem volta reaparece', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    const remove: Op = { kind: 'memberRemove', clientId: 'A' }
    expect(engine.applyOp('G', 'gm', 'g1', remove, new Set(['A', 'G']))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('B', 'player', 'p1', remove, new Set())).toMatchObject({ ok: false, reason: 'forbidden' })
    const r = engine.applyOp('G', 'gm', 'g2', remove, new Set(['G']))
    expect(effects(r)).toEqual([{ kind: 'memberRemoved', clientId: 'A' }])
    expect(engine.snapshot('gm', new Set()).members).toEqual([])
    expect(engine.applyOp('G', 'gm', 'g3', remove, new Set())).toMatchObject({ ok: false, reason: 'not_found' })
    const back = engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    expect(back.online).toBe(true)
    expect(engine.snapshot('gm', new Set(['A'])).members.map((m) => m.clientId)).toEqual(['A'])
  })
})
```

Run: `pnpm --filter @mesa/worker test -- engine`
Expected: FAIL (efeitos, controle e operações de camada ainda não existem).

- [ ] **Step 2: Reescrever o engine**

Substitua `apps/worker/src/engine/engine.ts` por:

```ts
import {
  GM_LAYER_ID,
  LOCK_TTL_MS,
  MEMBER_COLORS,
  MEMBER_RECENT_MS,
  TableObjectSchema,
  canControl,
  changedLayers,
  insertLayer,
  mergePatch,
  moveLayer,
  type Layer,
  type LayerPatch,
  type LockInfo,
  type Member,
  type NewObject,
  type Op,
  type RejectReason,
  type Role,
  type Snapshot,
  type TableObject,
} from '@mesa/shared'
import type { StoredMember, TableStore } from './store'

export type LayerChange = { before: Layer | null; after: Layer }

/** O que mudou; o TableDO decide quem recebe o quê. */
export type OpEffect =
  | { kind: 'object'; before: TableObject | null; after: TableObject | null }
  | { kind: 'layers'; changes: LayerChange[] }
  | { kind: 'layerRemoved'; layer: Layer }
  | { kind: 'note'; objectId: string; text: string }
  | { kind: 'memberRemoved'; clientId: string }
  | { kind: 'released'; objectId: string; clientId: string }

export type OpResult =
  | { ok: true; duplicate: true; version: number }
  | { ok: true; duplicate: false; version: number; effects: OpEffect[] }
  | { ok: false; reason: RejectReason; current: TableObject | null }

interface Lock {
  clientId: string
  role: Role
  expiresAt: number
}

const reject = (reason: RejectReason, current: TableObject | null): OpResult => ({ ok: false, reason, current })
const done = (version: number, ...effects: OpEffect[]): OpResult => ({ ok: true, duplicate: false, version, effects })

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

  canEditObject(clientId: string, role: Role, object: TableObject): boolean {
    return this.canEditLayer(role, object.layerId) && canControl(object, clientId, role)
  }

  join(input: { clientId: string; nickname: string; role: Role; secretHash?: string }, online: Set<string>): Member {
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
    const secretHash = input.secretHash ?? existing?.secretHash
    const stored: StoredMember = {
      clientId: input.clientId,
      nickname: input.nickname,
      role: input.role,
      color,
      lastSeenAt: this.now(),
      ...(secretHash ? { secretHash } : {}),
    }
    this.store.upsertMember(stored)
    return { clientId: input.clientId, nickname: input.nickname, color, role: input.role, online: true }
  }

  touchMember(clientId: string): void {
    const m = this.store.getMember(clientId)
    if (m) this.store.upsertMember({ ...m, lastSeenAt: this.now() })
  }

  snapshot(role: Role, online: Set<string>): Snapshot {
    const meta = this.store.getMeta()!
    const now = this.now()
    return {
      meta: { id: meta.id, name: meta.name },
      members: this.store
        .listMembers()
        .filter((m) => online.has(m.clientId) || now - m.lastSeenAt <= MEMBER_RECENT_MS)
        .map((m) => ({
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
      notes: role === 'gm' ? this.store.listNotes() : {},
    }
  }

  applyOp(clientId: string, role: Role, opId: string, op: Op, online: Set<string> = new Set()): OpResult {
    const duplicate = this.store.getAppliedOp(clientId, opId)
    if (duplicate !== null) return { ok: true, duplicate: true, version: duplicate }
    const result = this.execute(clientId, role, op, online)
    if (result.ok) this.store.recordAppliedOp(clientId, opId, result.version)
    return result
  }

  private execute(clientId: string, role: Role, op: Op, online: Set<string>): OpResult {
    if (op.kind === 'create') return this.create(clientId, role, op.object)
    if (op.kind === 'update' || op.kind === 'delete') return this.change(clientId, role, op)
    // Camadas, anotações e membros: só o mestre.
    if (role !== 'gm') return reject('forbidden', null)
    switch (op.kind) {
      case 'layerCreate': return this.layerCreate(op.layer)
      case 'layerUpdate': return this.layerUpdate(op.id, op.patch)
      case 'layerDelete': return this.layerDelete(op.id)
      case 'layerMove': return this.layerMove(op.id, op.direction)
      case 'noteSet': return this.noteSet(op.objectId, op.text)
      case 'memberRemove': return this.memberRemove(op.clientId, online)
    }
  }

  private create(clientId: string, role: Role, object: NewObject): OpResult {
    if (!this.canEditLayer(role, object.layerId)) return reject('forbidden', null)
    const existing = this.store.getObject(object.id)
    if (existing) return reject('exists', this.canSeeObject(role, existing) ? existing : null)
    const after = {
      ...object,
      control: { mode: 'list', clientIds: [clientId] },
      ownerId: clientId,
      version: 1,
      updatedBy: clientId,
    } as TableObject
    this.store.putObject(after)
    return done(1, { kind: 'object', before: null, after })
  }

  private change(clientId: string, role: Role, op: Extract<Op, { kind: 'update' | 'delete' }>): OpResult {
    const before = this.store.getObject(op.id)
    if (!before || !this.canSeeObject(role, before)) return reject('not_found', null)
    if (!this.canEditObject(clientId, role, before)) return reject('forbidden', before)
    if (this.lockHeldByOther(op.id, clientId)) return reject('locked', before)

    if (op.kind === 'delete') {
      this.store.deleteObject(op.id)
      this.store.deleteNote(op.id)
      this.locks.delete(op.id)
      return done(0, { kind: 'object', before, after: null })
    }

    const { patch } = op
    // Mudar controle ou camada é só do mestre — mesmo que o valor seja o atual.
    if ((patch.control !== undefined || patch.layerId !== undefined) && role !== 'gm') return reject('forbidden', before)
    if (patch.layerId !== undefined && !this.canEditLayer(role, patch.layerId)) return reject('forbidden', before)
    const parsed = TableObjectSchema.safeParse({
      ...mergePatch(before, patch),
      version: before.version + 1,
      updatedBy: clientId,
    })
    if (!parsed.success) return reject('invalid', before)
    this.store.putObject(parsed.data)
    return done(parsed.data.version, { kind: 'object', before, after: parsed.data })
  }

  private saveLayers(before: Layer[], after: Layer[], extra: OpEffect[] = []): OpResult {
    const changes = changedLayers(before, after)
    for (const change of changes) this.store.putLayer(change.after)
    return done(0, { kind: 'layers', changes }, ...extra)
  }

  private layerCreate(input: { id: string; name: string }): OpResult {
    const layers = this.store.getLayers()
    if (layers.some((l) => l.id === input.id)) return reject('exists', null)
    return this.saveLayers(layers, insertLayer(layers, input))
  }

  private layerUpdate(id: string, patch: LayerPatch): OpResult {
    const layers = this.store.getLayers()
    const before = layers.find((l) => l.id === id)
    if (!before) return reject('not_found', null)
    if (id === GM_LAYER_ID && patch.visibility !== undefined) return reject('forbidden', null)
    const after: Layer = { ...before, ...patch }
    const released = before.visibility === 'all' && after.visibility === 'gm' ? this.releasePlayerLocks(id) : []
    return this.saveLayers(layers, layers.map((l) => (l.id === id ? after : l)), released)
  }

  private layerDelete(id: string): OpResult {
    const layers = this.store.getLayers()
    const layer = layers.find((l) => l.id === id)
    if (!layer) return reject('not_found', null)
    const common = layers.filter((l) => l.id !== GM_LAYER_ID)
    if (id === GM_LAYER_ID || common.length <= 1) return reject('forbidden', null)
    for (const o of this.store.listObjects()) {
      if (o.layerId !== id) continue
      this.store.deleteObject(o.id)
      this.store.deleteNote(o.id)
      this.locks.delete(o.id)
    }
    this.store.deleteLayer(id)
    return done(0, { kind: 'layerRemoved', layer })
  }

  private layerMove(id: string, direction: 'up' | 'down'): OpResult {
    const layers = this.store.getLayers()
    if (!layers.some((l) => l.id === id)) return reject('not_found', null)
    const after = moveLayer(layers, id, direction)
    if (!after) return reject('forbidden', null)
    return this.saveLayers(layers, after)
  }

  private noteSet(objectId: string, text: string): OpResult {
    if (!this.store.getObject(objectId)) return reject('not_found', null)
    const value = text.trim() === '' ? '' : text
    this.store.setNote(objectId, value)
    return done(0, { kind: 'note', objectId, text: value })
  }

  private memberRemove(clientId: string, online: Set<string>): OpResult {
    if (online.has(clientId)) return reject('forbidden', null)
    if (!this.store.getMember(clientId)) return reject('not_found', null)
    this.store.deleteMember(clientId)
    return done(0, { kind: 'memberRemoved', clientId })
  }

  private releasePlayerLocks(layerId: string): OpEffect[] {
    const out: OpEffect[] = []
    for (const [objectId, lock] of this.locks) {
      if (lock.role === 'gm' || this.store.getObject(objectId)?.layerId !== layerId) continue
      this.locks.delete(objectId)
      out.push({ kind: 'released', objectId, clientId: lock.clientId })
    }
    return out
  }

  grab(clientId: string, role: Role, objectId: string): boolean {
    const object = this.store.getObject(objectId)
    if (!object || !this.canSeeObject(role, object) || !this.canEditObject(clientId, role, object)) return false
    if (this.lockHeldByOther(objectId, clientId)) return false
    this.locks.set(objectId, { clientId, role, expiresAt: this.now() + LOCK_TTL_MS })
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

- [ ] **Step 3: Ajuste mínimo no `TableDO` para compilar**

Em `apps/worker/src/table-do.ts`, troque o método `onOp` por (a Task 7 substitui por difusão completa):

```ts
  private onOp(ws: WebSocket, att: Attachment, msg: Msg<'op'>): void {
    const res = this.engine.applyOp(att.clientId, att.role, msg.opId, msg.op, this.onlineClientIds())
    if (!res.ok) {
      this.send(ws, { t: 'reject', opId: msg.opId, reason: res.reason, current: res.current })
      return
    }
    this.send(ws, { t: 'ack', opId: msg.opId, version: res.version })
    if (res.duplicate) return
    for (const effect of res.effects) {
      if (effect.kind !== 'object') continue
      const { before, after } = effect
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
  }
```

- [ ] **Step 4: Atualizar o teste de trava do DO**

Com controle, Bia não controla o token da Ana (o `reject` seria `forbidden`, não `locked`). Em `apps/worker/test/table-do.test.ts`, troque o teste `'trava: segundo grab é negado; desconexão do dono libera e avisa saída'` por:

```ts
  it('trava: segundo grab é negado; desconexão do dono libera e avisa saída', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const { clientId: aId } = await a.hello('Ana')
    await b.hello('Bia')
    const obj = tokenObject()
    gm.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: obj } })
    await gm.waitFor('ack')
    gm.send({ t: 'op', opId: 'op_2', op: { kind: 'update', id: obj.id, patch: { control: { mode: 'all', clientIds: [] } } } })
    await gm.waitFor('ack')
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
```

- [ ] **Step 5: Checkpoint**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: verde.

---

### Task 7: Worker — `TableDO`: difusão por efeito, `reject invalid` e heartbeat

**Files:**
- Modify: `apps/worker/src/table-do.ts` (arquivo inteiro)
- Modify: `apps/worker/test/helpers.ts:30-46` (mensagens não-JSON)
- Modify: `apps/worker/test/table-do.test.ts` (acrescentar `describe` no fim)

**Interfaces:**
- Consumes: `OpEffect`, `LayerChange`, `applyOp(…, online)` (Task 6); `readOpId` (Task 3).
- Produces (mensagens do servidor):
  - efeito `layers` → para cada mudança: mestre recebe `layerUpsert`; jogador recebe `layerUpsert` (visível antes e depois, ou nova e visível), `layerShown { layer, objects }` (oculta → visível), `layerHidden { id }` (visível → oculta) ou nada
  - efeito `layerRemoved` → `layerRemoved { id }` para mestres e, se a camada era visível, jogadores
  - efeito `note` → `noteSet` só para mestres
  - efeito `memberRemoved` → `memberRemoved` para todos
  - efeito `released` → `released` para quem vê o objeto (inclui o autor)
  - a sessão autora recebe só `ack`/`reject` (como no M1), exceto `released`
  - `reject { reason: 'invalid', current: null }` para `{ t: 'op', opId }` que falha no schema, só depois do `hello`
  - auto-resposta `'ping'` → `'pong'`
- Produces (testes): `TestClient.raw: string[]` e `TestClient.waitForRaw(text: string): Promise<void>`

- [ ] **Step 1: Ajustar o helper de testes**

Em `apps/worker/test/helpers.ts`, troque o início da classe `TestClient` (linhas 30-38) por:

```ts
export class TestClient {
  readonly messages: ServerMessage[] = []
  /** Mensagens que não são JSON (ex.: 'pong'). */
  readonly raw: string[] = []
  private consumed = new Set<number>()

  private constructor(private ws: WebSocket) {
    ws.addEventListener('message', (e) => {
      const data = e.data as string
      try {
        this.messages.push(JSON.parse(data) as ServerMessage)
      } catch {
        this.raw.push(data)
      }
    })
  }
```

e acrescente, logo antes de `close(): void {`:

```ts
  async waitForRaw(text: string): Promise<void> {
    for (let i = 0; i < 200; i++) {
      if (this.raw.includes(text)) return
      await sleep(10)
    }
    throw new Error(`timeout esperando ${text}`)
  }

```

- [ ] **Step 2: Testes do DO (falham)**

Acrescente `import type { Op } from '@mesa/shared'` aos imports de `apps/worker/test/table-do.test.ts` e, no fim do arquivo:

```ts
describe('TableDO — M2', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })

  async function table() {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const { clientId: playerId } = await p.hello('Ana')
    return { tableId, gmSecret, gm, p, playerId }
  }

  it('responde pong ao ping sem passar pelo handler', async () => {
    const { tableId } = await createTable()
    const c = await TestClient.connect(tableId)
    c.send('ping')
    await c.waitForRaw('pong')
  })

  it('op com opId legível e schema inválido recebe reject invalid (só depois do hello)', async () => {
    const { tableId } = await createTable()
    const c = await TestClient.connect(tableId)
    const bad = JSON.stringify({ t: 'op', opId: 'op_bad', op: { kind: 'create', object: { ...tokenObject(), x: 'x' } } })
    c.send(bad)
    await c.expectNone('reject')
    await c.hello('Ana')
    c.send(bad)
    expect(await c.waitFor('reject')).toEqual({ t: 'reject', opId: 'op_bad', reason: 'invalid', current: null })
  })

  it('anotação nunca chega ao jogador: nem ao vivo nem no snapshot', async () => {
    const { tableId, gmSecret, gm, p } = await table()
    const gm2 = await TestClient.connect(tableId)
    await gm2.hello('Mestre 2', { gmSecret })
    const obj = tokenObject()
    gm.send(op('op_1', { kind: 'create', object: obj }))
    await gm.waitFor('ack')
    gm.send(op('op_2', { kind: 'noteSet', objectId: obj.id, text: 'segredo do mestre' }))
    await gm.waitFor('ack')
    expect(await gm2.waitFor('noteSet')).toEqual({ t: 'noteSet', objectId: obj.id, text: 'segredo do mestre' })
    await p.expectNone('noteSet')
    expect(JSON.stringify(p.messages)).not.toContain('segredo')
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Bia')).welcome.snapshot.notes).toEqual({})
    const gm3 = await TestClient.connect(tableId)
    expect((await gm3.hello('Mestre', { gmSecret })).welcome.snapshot.notes).toEqual({ [obj.id]: 'segredo do mestre' })
  })

  it('esconder e mostrar camada ao vivo: layerHidden e layerShown com os objetos', async () => {
    const { gm, p } = await table()
    const obj = tokenObject()
    gm.send(op('op_1', { kind: 'create', object: obj }))
    await p.waitFor('op')
    gm.send(op('op_2', { kind: 'layerUpdate', id: 'tokens', patch: { visibility: 'gm' } }))
    expect(await p.waitFor('layerHidden')).toEqual({ t: 'layerHidden', id: 'tokens' })
    gm.send(op('op_3', { kind: 'layerUpdate', id: 'tokens', patch: { visibility: 'all' } }))
    const shown = await p.waitFor('layerShown')
    expect(shown.layer).toMatchObject({ id: 'tokens', visibility: 'all' })
    expect(shown.objects.map((o) => o.id)).toEqual([obj.id])
  })

  it('esconder a camada solta a trava do jogador e avisa o mestre', async () => {
    const { gm, p, playerId } = await table()
    const obj = tokenObject()
    p.send(op('op_1', { kind: 'create', object: obj }))
    await p.waitFor('ack')
    p.send({ t: 'grab', objectId: obj.id })
    await gm.waitFor('grabbed')
    gm.send(op('op_2', { kind: 'layerUpdate', id: 'tokens', patch: { visibility: 'gm' } }))
    expect(await gm.waitFor('released')).toEqual({ t: 'released', objectId: obj.id, clientId: playerId })
  })

  it('layerCreate entra abaixo do Mestre; jogador não recebe a camada do Mestre', async () => {
    const { tableId, gmSecret, gm, p } = await table()
    gm.send(op('op_1', { kind: 'layerCreate', layer: { id: 'nova', name: 'Nova camada' } }))
    await gm.waitFor('ack')
    expect((await p.waitFor('layerUpsert')).layer).toEqual({ id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false })
    await p.expectNone('layerUpsert', (m) => m.layer.id === 'gm')
    const gm2 = await TestClient.connect(tableId)
    const { welcome } = await gm2.hello('Mestre', { gmSecret })
    expect(welcome.snapshot.layers.map((l) => `${l.id}:${l.order}`)).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
  })

  it('layerMove: limites recusados; troca válida chega ao jogador', async () => {
    const { gm, p } = await table()
    gm.send(op('op_1', { kind: 'layerMove', id: 'drawings', direction: 'up' }))
    expect(await gm.waitFor('reject')).toMatchObject({ opId: 'op_1', reason: 'forbidden' })
    gm.send(op('op_2', { kind: 'layerMove', id: 'gm', direction: 'down' }))
    expect(await gm.waitFor('reject')).toMatchObject({ opId: 'op_2', reason: 'forbidden' })
    gm.send(op('op_3', { kind: 'layerMove', id: 'map', direction: 'up' }))
    await gm.waitFor('ack')
    expect((await p.waitFor('layerUpsert', (m) => m.layer.id === 'map')).layer.order).toBe(1)
    expect((await p.waitFor('layerUpsert', (m) => m.layer.id === 'tokens')).layer.order).toBe(0)
  })

  it('layerDelete apaga objetos e anotações; Mestre e última camada comum não saem', async () => {
    const { tableId, gmSecret, gm, p } = await table()
    const obj = tokenObject({ layerId: 'drawings' })
    gm.send(op('op_1', { kind: 'create', object: obj }))
    gm.send(op('op_2', { kind: 'noteSet', objectId: obj.id, text: 'nota' }))
    gm.send(op('op_3', { kind: 'layerDelete', id: 'drawings' }))
    expect(await p.waitFor('layerRemoved')).toEqual({ t: 'layerRemoved', id: 'drawings' })
    gm.send(op('op_4', { kind: 'layerDelete', id: 'gm' }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'op_4')).toMatchObject({ reason: 'forbidden' })
    gm.send(op('op_5', { kind: 'layerDelete', id: 'map' }))
    await gm.waitFor('ack', (m) => m.opId === 'op_5')
    gm.send(op('op_6', { kind: 'layerDelete', id: 'tokens' }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'op_6')).toMatchObject({ reason: 'forbidden' })
    const gm2 = await TestClient.connect(tableId)
    const { welcome } = await gm2.hello('Mestre', { gmSecret })
    expect(welcome.snapshot.layers.map((l) => l.id)).toEqual(['tokens', 'gm'])
    expect(welcome.snapshot.objects).toEqual([])
    expect(welcome.snapshot.notes).toEqual({})
  })

  it('memberRemove: online recusado; offline removido e avisado', async () => {
    const { tableId, gm, p, playerId } = await table()
    const other = await TestClient.connect(tableId)
    await other.hello('Bia')
    gm.send(op('op_1', { kind: 'memberRemove', clientId: playerId }))
    expect(await gm.waitFor('reject')).toMatchObject({ opId: 'op_1', reason: 'forbidden' })
    p.close()
    await gm.waitFor('memberLeft')
    gm.send(op('op_2', { kind: 'memberRemove', clientId: playerId }))
    await gm.waitFor('ack', (m) => m.opId === 'op_2')
    expect(await other.waitFor('memberRemoved')).toEqual({ t: 'memberRemoved', clientId: playerId })
    const late = await TestClient.connect(tableId)
    const { welcome } = await late.hello('Caio')
    expect(welcome.snapshot.members.map((m) => m.clientId)).not.toContain(playerId)
  })

  it('jogador que controla o token não muda layerId nem control', async () => {
    const { p } = await table()
    const obj = tokenObject()
    p.send(op('op_1', { kind: 'create', object: obj }))
    await p.waitFor('ack')
    p.send(op('op_2', { kind: 'update', id: obj.id, patch: { layerId: 'drawings' } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_2', reason: 'forbidden', current: { id: obj.id, layerId: 'tokens' } })
    p.send(op('op_3', { kind: 'update', id: obj.id, patch: { control: { mode: 'all', clientIds: [] } } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_3', reason: 'forbidden' })
  })

  it('token "só o mestre": jogador não pega nem altera', async () => {
    const { gm, p } = await table()
    const obj = tokenObject()
    p.send(op('op_1', { kind: 'create', object: obj }))
    await p.waitFor('ack')
    gm.send(op('op_2', { kind: 'update', id: obj.id, patch: { control: { mode: 'gm', clientIds: [] } } }))
    expect((await p.waitFor('op')).op).toMatchObject({ kind: 'upsert', object: { control: { mode: 'gm' } } })
    p.send({ t: 'grab', objectId: obj.id })
    expect(await p.waitFor('grabDenied')).toEqual({ t: 'grabDenied', objectId: obj.id })
    p.send(op('op_3', { kind: 'update', id: obj.id, patch: { x: 999 } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_3', reason: 'forbidden' })
  })
})
```

Run: `pnpm --filter @mesa/worker test -- table-do`
Expected: FAIL (sem `pong`, sem `reject invalid`, sem mensagens de camada/anotação/membro).

- [ ] **Step 3: Reescrever o `TableDO`**

Substitua `apps/worker/src/table-do.ts` por:

```ts
import { DurableObject } from 'cloudflare:workers'
import {
  ClientMessageSchema,
  DEFAULT_LAYERS,
  readOpId,
  type ClientMessage,
  type Role,
  type ServerMessage,
  type TableObject,
} from '@mesa/shared'
import { TableEngine, type LayerChange, type OpEffect } from './engine/engine'
import { SqlStore } from './engine/sql-store'
import { randomSecret, safeEqual, sha256Hex } from './crypto'

interface Attachment {
  sessionId: string
  clientId: string
  role: Role
}

type Msg<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>

export class TableDO extends DurableObject<Env> {
  private store: SqlStore
  private engine: TableEngine
  private strokeLayers = new Map<string, string>()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new SqlStore(ctx.storage.sql)
    this.engine = new TableEngine(this.store)
    // Heartbeat: responde sem acordar o DO da hibernação.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))
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
    const att = this.attachment(ws)
    const parsed = ClientMessageSchema.safeParse(json)
    if (!parsed.success) {
      const opId = readOpId(json)
      if (opId && att) this.send(ws, { t: 'reject', opId, reason: 'invalid', current: null })
      else console.warn('mensagem inválida', parsed.error.issues[0]?.message)
      return
    }
    const msg = parsed.data
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

  // Regras do clientSecret: Task 4 (inalteradas aqui).
  private async onHello(ws: WebSocket, msg: Msg<'hello'>): Promise<void> {
    const meta = this.store.getMeta()
    if (!meta) return
    let role: Role = 'player'
    if (msg.gmSecret && safeEqual(await sha256Hex(msg.gmSecret), meta.gmSecretHash)) role = 'gm'
    // Todos os awaits antes de ler o membro: ler-decidir-gravar fica atômico no DO.
    const providedHash = msg.clientSecret ? await sha256Hex(msg.clientSecret) : null
    const candidate = randomSecret()
    const candidateHash = await sha256Hex(candidate)

    const existing = this.store.getMember(msg.clientId)
    let issued: string | undefined
    if (existing?.secretHash) {
      if (!providedHash || !safeEqual(providedHash, existing.secretHash)) {
        this.send(ws, { t: 'error', reason: 'auth' })
        ws.close(4401, 'auth')
        return
      }
    } else {
      issued = candidate // membro novo ou do M1 sem hash: trust-on-first-use
    }

    const online = this.onlineClientIds()
    const member = this.engine.join(
      { clientId: msg.clientId, nickname: msg.nickname, role, ...(issued ? { secretHash: candidateHash } : {}) },
      online,
    )
    const att: Attachment = { sessionId: crypto.randomUUID(), clientId: msg.clientId, role }
    ws.serializeAttachment(att)
    online.add(msg.clientId)
    this.send(ws, {
      t: 'welcome',
      self: member,
      snapshot: this.engine.snapshot(role, online),
      ...(issued ? { clientSecret: issued } : {}),
    })
    this.broadcast(att.sessionId, () => ({ t: 'memberJoined', member }))
  }

  private onOp(ws: WebSocket, att: Attachment, msg: Msg<'op'>): void {
    const res = this.engine.applyOp(att.clientId, att.role, msg.opId, msg.op, this.onlineClientIds())
    if (!res.ok) {
      this.send(ws, { t: 'reject', opId: msg.opId, reason: res.reason, current: res.current })
      return
    }
    this.send(ws, { t: 'ack', opId: msg.opId, version: res.version })
    if (res.duplicate) return
    for (const effect of res.effects) this.broadcastEffect(att, effect)
  }

  private broadcastEffect(author: Attachment, effect: OpEffect): void {
    switch (effect.kind) {
      case 'object': {
        const { before, after } = effect
        this.broadcast(author.sessionId, (other) => {
          if (after && this.engine.canSeeObject(other.role, after)) {
            return { t: 'op', by: author.clientId, op: { kind: 'upsert', object: after } }
          }
          if (before && this.engine.canSeeObject(other.role, before)) {
            return { t: 'op', by: author.clientId, op: { kind: 'delete', id: before.id } }
          }
          return null
        })
        return
      }
      case 'layers':
        for (const change of effect.changes) this.broadcastLayerChange(author.sessionId, change)
        return
      case 'layerRemoved': {
        const { layer } = effect
        this.broadcast(author.sessionId, (other) =>
          other.role === 'gm' || layer.visibility === 'all' ? { t: 'layerRemoved', id: layer.id } : null,
        )
        return
      }
      case 'note':
        this.broadcast(author.sessionId, (other) =>
          other.role === 'gm' ? { t: 'noteSet', objectId: effect.objectId, text: effect.text } : null,
        )
        return
      case 'memberRemoved':
        this.broadcast(author.sessionId, () => ({ t: 'memberRemoved', clientId: effect.clientId }))
        return
      case 'released':
        this.broadcastReleased(effect.objectId, effect.clientId)
        return
    }
  }

  // Jogadores só enxergam camadas com visibility 'all'; o mestre recebe tudo.
  private broadcastLayerChange(excludeSessionId: string, { before, after }: LayerChange): void {
    const wasVisible = before?.visibility === 'all'
    const isVisible = after.visibility === 'all'
    let shownObjects: TableObject[] | null = null
    this.broadcast(excludeSessionId, (other) => {
      if (other.role === 'gm') return { t: 'layerUpsert', layer: after }
      if (isVisible && (wasVisible || before === null)) return { t: 'layerUpsert', layer: after }
      if (isVisible) {
        shownObjects ??= this.store.listObjects().filter((o) => o.layerId === after.id)
        return { t: 'layerShown', layer: after, objects: shownObjects }
      }
      if (wasVisible) return { t: 'layerHidden', id: after.id }
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
        this.broadcast(att.sessionId, () => out)
        return
      case 'strokeEnd': {
        const layerId = this.strokeLayers.get(p.strokeId)
        this.strokeLayers.delete(p.strokeId)
        this.broadcast(att.sessionId, (other) =>
          (layerId ? this.engine.canSeeLayer(other.role, layerId) : other.role === 'gm') ? out : null,
        )
        return
      }
      case 'drag': {
        if (!this.engine.touchLock(att.clientId, p.objectId)) return
        const object = this.store.getObject(p.objectId)
        if (!object) return
        this.broadcast(att.sessionId, (other) => (this.engine.canSeeObject(other.role, object) ? out : null))
        return
      }
      case 'stroke':
        if (!this.engine.canEditLayer(att.role, p.layerId)) return
        this.strokeLayers.set(p.strokeId, p.layerId)
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

- [ ] **Step 4: Checkpoint**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: verde (testes do M1 e do M2).

---

### Task 8: Web — heartbeat no `SyncClient`

**Files:**
- Modify: `apps/web/src/sync/SyncClient.ts` (arquivo inteiro)
- Modify: `apps/web/test/sync-client.test.ts`

**Interfaces:**
- Consumes: `HEARTBEAT_INTERVAL_MS`, `HEARTBEAT_TIMEOUT_MS` (Task 1).
- Produces: comportamento — depois do `onopen`, envia o texto cru `'ping'` a cada 25 s; qualquer mensagem recebida (inclusive `'pong'`) cancela a espera; sem mensagem em 10 s depois de um ping, solta o socket e entra no fluxo de reconexão (`onStatus('reconnecting')`, backoff do M1). `'ping'`/`'pong'` não contam em `stats`. API pública inalterada.

- [ ] **Step 1: Testes (falham)**

Em `apps/web/test/sync-client.test.ts`:

1. Troque o método `send` da `FakeSocket` (linha 14) por:

```ts
  send(data: string) { this.sent.push(data === 'ping' ? 'ping' : JSON.parse(data)) }
```

2. Acrescente, depois do método `receive` (linha 17):

```ts
  receiveRaw(data: string) { this.onmessage?.({ data }) }
```

3. No teste `'close() then connect(): old socket onclose does not affect the new connection'`, troque `vi.advanceTimersByTime(60_000)` por `vi.advanceTimersByTime(5_000)` (com heartbeat, 60 s sem `pong` derrubariam o socket novo — o teste só quer provar que o socket velho não agenda reconexão, e o backoff máximo após um único fechamento é 1 s).

4. Acrescente no fim do arquivo:

```ts
describe('SyncClient heartbeat', () => {
  const opened = () => {
    client.connect()
    last().open()
    last().receive(welcome)
  }
  const pings = () => last().sent.filter((m) => m === 'ping').length

  it('envia ping a cada 25 s com o socket aberto, sem contar nas estatísticas', () => {
    opened()
    vi.advanceTimersByTime(24_999)
    expect(pings()).toBe(0)
    vi.advanceTimersByTime(1)
    expect(pings()).toBe(1)
    last().receiveRaw('pong')
    vi.advanceTimersByTime(25_000)
    expect(pings()).toBe(2)
    expect(client.stats).toEqual({ sent: 1, received: 1 })
  })

  it('pong dentro de 10 s mantém a conexão', () => {
    opened()
    vi.advanceTimersByTime(25_000)
    vi.advanceTimersByTime(9_000)
    last().receiveRaw('pong')
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.all).toHaveLength(1)
    expect(statuses.at(-1)).toBe('open')
  })

  it('qualquer mensagem conta como resposta', () => {
    opened()
    vi.advanceTimersByTime(25_000)
    last().receive({ t: 'memberLeft', clientId: 'x' })
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.all).toHaveLength(1)
  })

  it('sem resposta em 10 s fecha e reconecta', () => {
    opened()
    vi.advanceTimersByTime(25_000)
    vi.advanceTimersByTime(9_999)
    expect(statuses.at(-1)).toBe('open')
    vi.advanceTimersByTime(1)
    expect(statuses.at(-1)).toBe('reconnecting')
    vi.advanceTimersByTime(1_000)
    expect(FakeSocket.all).toHaveLength(2)
  })

  it('não envia ping antes de abrir nem depois de close()', () => {
    client.connect()
    vi.advanceTimersByTime(60_000)
    expect(FakeSocket.all[0].sent).toEqual([])
    last().open()
    client.close()
    vi.advanceTimersByTime(60_000)
    expect(last().sent.filter((m) => m === 'ping')).toEqual([])
  })
})
```

> No último teste, o primeiro socket nunca abre, então nunca manda ping; depois de `close()` nenhum timer de heartbeat pode sobrar.

Run: `pnpm --filter @mesa/web test -- sync-client`
Expected: FAIL nos testes de heartbeat.

- [ ] **Step 2: Implementar**

Substitua `apps/web/src/sync/SyncClient.ts` por:

```ts
import {
  HEARTBEAT_INTERVAL_MS,
  HEARTBEAT_TIMEOUT_MS,
  type ClientMessage,
  type HelloMessage,
  type Op,
  type ServerMessage,
} from '@mesa/shared'

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
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private pongTimer: ReturnType<typeof setTimeout> | null = null
  private isReady = false
  private stopped = false

  constructor(private opts: SyncClientOptions) {}

  get ready(): boolean {
    return this.isReady
  }

  connect(): void {
    this.stopped = false
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.detachSocket(1000, 'replaced')
    this.open('connecting')
  }

  close(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.detachSocket(1000, 'bye')
    this.opts.onStatus('closed')
  }

  /** Drops the current socket: stale callbacks are ignored once it is detached. */
  private detachSocket(code: number, reason: string): void {
    this.stopHeartbeat()
    const ws = this.ws
    this.ws = null
    this.isReady = false
    if (ws) ws.close(code, reason)
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
    ws.onopen = () => {
      if (this.ws !== ws) return
      this.startHeartbeat(ws)
      this.raw(this.opts.hello())
    }
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return
      this.clearPongTimer()
      if (typeof ev.data !== 'string' || ev.data === 'pong') return
      this.stats.received++
      let msg: ServerMessage
      try {
        msg = JSON.parse(ev.data) as ServerMessage
      } catch {
        return
      }
      this.handle(msg)
    }
    ws.onclose = () => {
      if (this.ws !== ws) return
      this.handleClose()
    }
  }

  private startHeartbeat(ws: WebSocketLike): void {
    this.stopHeartbeat()
    this.heartbeat = setInterval(() => {
      if (this.ws !== ws) return
      try {
        ws.send('ping')
      } catch {
        // socket fechando; o onclose cuida
      }
      if (!this.pongTimer) this.pongTimer = setTimeout(() => this.onHeartbeatTimeout(ws), HEARTBEAT_TIMEOUT_MS)
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    this.clearPongTimer()
  }

  private clearPongTimer(): void {
    if (this.pongTimer) clearTimeout(this.pongTimer)
    this.pongTimer = null
  }

  // Conexão "zumbi": não espera o close do navegador (pode demorar minutos) — solta e reconecta já.
  private onHeartbeatTimeout(ws: WebSocketLike): void {
    this.pongTimer = null
    if (this.ws !== ws) return
    this.stopHeartbeat()
    this.ws = null
    try {
      ws.close(4000, 'heartbeat_timeout')
    } catch {
      // ignora
    }
    this.handleClose()
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
    this.stopHeartbeat()
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

- [ ] **Step 3: Checkpoint**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: verde.

---

### Task 9: Web — estado: mensagens novas, camadas otimistas, anotações e desfazer em grupo

**Files:**
- Modify: `apps/web/src/store/state.ts` (arquivo inteiro)
- Modify: `apps/web/src/store/localOps.ts` (arquivo inteiro)
- Modify: `apps/web/src/store/reducers.ts` (arquivo inteiro)
- Modify: `apps/web/src/store/tableStore.ts` (import de `./reducers`, `TableActions`, `submitInternal`, `submit`/`undo`)
- Modify: `apps/web/test/reducers.test.ts` (teste `'create otimista; ack seta version e empilha inversa'`)
- Create: `apps/web/test/reducers-layers.test.ts`
- Create: `apps/web/test/undo-groups.test.ts`

**Interfaces:**
- Consumes: `isObjectOp`, `ObjectOp`, `insertLayer`, `moveLayer`, `sortLayers`, `mergePatch` (Tasks 1–3); `inverseOf` (Task 1).
- Produces:
  - `TableState` ganha `notes: Record<string, string>`, `undoStack: Op[][]`, `undoGroups: Record<string, UndoGroup>`
  - `type LocalPrev`, `interface UndoGroup { inverses: Array<Op | null>; settled: number }`, `PendingOp` ganha `group: { id: string; index: number } | null` e `prev: LocalPrev | null`
  - `opTargetId(op: ObjectOp): string`
  - `reduceSubmitBatch<S extends TableState>(s: S, items: Array<{ opId: string; op: Op }>, opts: { isUndo: boolean; groupId: string }): S`
  - `reduceSubmit<S extends TableState>(s: S, opId: string, op: Op, opts: { isUndo: boolean }): S` (grupo de 1)
  - `applyLayerOp(layers: Layer[], op: Op): Layer[]`
  - `topLayerId(layers: Layer[]): string` — camada `visibility: 'all'` de maior `order` (senão a de maior `order`)
  - `rejectText(op: Op, reason: RejectReason): string`
  - `addToast` não duplica toast sem ação com o mesmo texto
  - `TableActions.submitGroup(ops: Op[]): boolean`; `undo()` envia o grupo inteiro

- [ ] **Step 1: Testes (falham)**

Em `apps/web/test/reducers.test.ts`, no teste `'create otimista; ack seta version e empilha inversa'`, troque a linha `expect(s.undoStack).toEqual([{ kind: 'delete', id: 't1' }])` por:

```ts
    expect(s.undoStack).toEqual([[{ kind: 'delete', id: 't1' }]])
```

Crie `apps/web/test/reducers-layers.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, type Layer, type Member, type ServerMessage, type TableObject } from '@mesa/shared'
import { reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const gm: Member = { clientId: 'gm1', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const player: Member = { clientId: 'p1', nickname: 'Ana', color: '#3cb44b', role: 'player', online: true }

const token = (id: string, layerId = 'tokens'): TableObject => ({
  id, type: 'image', layerId, assetKey: 'a'.repeat(64), x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'gm1', version: 1, updatedBy: 'gm1', control: { mode: 'list', clientIds: ['gm1'] },
})

function joined(self: Member, layers: Layer[], objects: TableObject[] = [], notes: Record<string, string> = {}): TableState {
  const welcome: ServerMessage = {
    t: 'welcome',
    self,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [self, player], layers, objects, locks: [], notes },
  }
  return reduceServer(makeInitialState(), welcome, 0)
}
const ids = (s: TableState) => s.layers.map((l) => l.id)
const PUBLIC = DEFAULT_LAYERS.slice(0, 3)

describe('mensagens de camada', () => {
  it('layerUpsert com order nova reordena a lista', () => {
    let s = joined(player, PUBLIC)
    s = reduceServer(s, { t: 'layerUpsert', layer: { ...DEFAULT_LAYERS[0], order: 1 } }, 0)
    s = reduceServer(s, { t: 'layerUpsert', layer: { ...DEFAULT_LAYERS[1], order: 0 } }, 0)
    expect(ids(s)).toEqual(['tokens', 'map', 'drawings'])
  })

  it('layerUpsert de camada nova entra na posição da order', () => {
    let s = joined(player, PUBLIC)
    s = reduceServer(s, { t: 'layerUpsert', layer: { id: 'nova', name: 'Nova camada', order: 3, visibility: 'all', locked: false } }, 0)
    expect(ids(s)).toEqual(['map', 'tokens', 'drawings', 'nova'])
  })

  it('layerHidden remove camada, objetos, seleção e muda a ativa para a visível mais alta', () => {
    let s = { ...joined(player, PUBLIC, [token('t1')]), selectedId: 't1', activeLayerId: 'tokens' }
    s = reduceServer(s, { t: 'layerHidden', id: 'tokens' }, 0)
    expect(ids(s)).toEqual(['map', 'drawings'])
    expect(s.objects).toEqual({})
    expect(s.selectedId).toBeNull()
    expect(s.activeLayerId).toBe('drawings')
  })

  // Review Focus #5
  it('layerShown repetido devolve camada e objetos sem duplicar e mantém minha op pendente por cima', () => {
    let s = joined(player, PUBLIC, [token('t1')])
    s = reduceServer(s, { t: 'layerHidden', id: 'tokens' }, 0)
    const shown: ServerMessage = { t: 'layerShown', layer: DEFAULT_LAYERS[1], objects: [token('t1')] }
    s = reduceServer(s, shown, 0)
    s = reduceSubmit(s, 'op_1', { kind: 'update', id: 't1', patch: { x: 50 } }, { isUndo: false })
    s = reduceServer(s, shown, 0)
    expect(ids(s)).toEqual(['map', 'tokens', 'drawings'])
    expect(Object.keys(s.objects)).toEqual(['t1'])
    expect(s.objects.t1.x).toBe(50)
  })

  it('layerRemoved apaga objetos e anotações da camada', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1'), token('m1', 'map')], { t1: 'nota', m1: 'outra' })
    s = reduceServer(s, { t: 'layerRemoved', id: 'tokens' }, 0)
    expect(Object.keys(s.objects)).toEqual(['m1'])
    expect(s.notes).toEqual({ m1: 'outra' })
  })

  it('noteSet grava e texto vazio remove; delete remoto também remove', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1')])
    s = reduceServer(s, { t: 'noteSet', objectId: 't1', text: 'tem 3 PV' }, 0)
    expect(s.notes).toEqual({ t1: 'tem 3 PV' })
    s = reduceServer(s, { t: 'noteSet', objectId: 't1', text: '' }, 0)
    expect(s.notes).toEqual({})
    s = reduceServer(s, { t: 'noteSet', objectId: 't1', text: 'de novo' }, 0)
    s = reduceServer(s, { t: 'op', by: 'x', op: { kind: 'delete', id: 't1' } }, 0)
    expect(s.notes).toEqual({})
  })

  it('welcome guarda as anotações do snapshot', () => {
    expect(joined(gm, DEFAULT_LAYERS, [token('t1')], { t1: 'nota' }).notes).toEqual({ t1: 'nota' })
  })

  it('memberRemoved tira o membro e o cursor', () => {
    let s = joined(gm, DEFAULT_LAYERS)
    s = reduceServer(s, { t: 'presence', clientId: 'p1', p: { kind: 'cursor', x: 1, y: 1 } }, 0)
    s = reduceServer(s, { t: 'memberRemoved', clientId: 'p1' }, 0)
    expect(s.members.p1).toBeUndefined()
    expect(s.cursors.p1).toBeUndefined()
  })
})

describe('operações otimistas do mestre', () => {
  it('layerCreate entra abaixo do Mestre na hora', () => {
    const s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerCreate', layer: { id: 'nova', name: 'Nova camada' } }, { isUndo: false })
    expect(s.layers.map((l) => `${l.id}:${l.order}`)).toEqual(['map:0', 'tokens:1', 'drawings:2', 'nova:3', 'gm:4'])
  })

  it('reject de layerUpdate volta ao estado anterior com toast', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerUpdate', id: 'map', patch: { locked: true } }, { isUndo: false })
    expect(s.layers[0].locked).toBe(true)
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden', current: null }, 0)
    expect(s.layers[0].locked).toBe(false)
    expect(s.toasts.at(-1)?.text).toBe('Sem permissão nessa camada')
  })

  it('reject de uma op de camada não desfaz outra pendente feita depois', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerUpdate', id: 'map', patch: { name: 'A' } }, { isUndo: false })
    s = reduceSubmit(s, 'op_2', { kind: 'layerMove', id: 'drawings', direction: 'down' }, { isUndo: false })
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'invalid', current: null }, 0)
    expect(s.layers.map((l) => `${l.id}:${l.name}`)).toEqual(['map:Mapa', 'drawings:Desenhos', 'tokens:Tokens', 'gm:Mestre'])
  })

  it('layerDelete some na hora e o reject devolve camada, objetos e anotações', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1')], { t1: 'nota' })
    s = { ...s, activeLayerId: 'tokens' }
    s = reduceSubmit(s, 'op_1', { kind: 'layerDelete', id: 'tokens' }, { isUndo: false })
    expect(ids(s)).toEqual(['map', 'drawings', 'gm'])
    expect(s.objects).toEqual({})
    expect(s.activeLayerId).toBe('drawings')
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden', current: null }, 0)
    expect(ids(s)).toEqual(['map', 'tokens', 'drawings', 'gm'])
    expect(Object.keys(s.objects)).toEqual(['t1'])
    expect(s.notes).toEqual({ t1: 'nota' })
    expect(s.toasts.at(-1)?.text).toBe('Essa camada não pode ser removida')
  })

  it('noteSet otimista e reject devolve o texto anterior', () => {
    let s = joined(gm, DEFAULT_LAYERS, [token('t1')], { t1: 'antiga' })
    s = reduceSubmit(s, 'op_1', { kind: 'noteSet', objectId: 't1', text: 'nova' }, { isUndo: false })
    expect(s.notes.t1).toBe('nova')
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'not_found', current: null }, 0)
    expect(s.notes.t1).toBe('antiga')
  })

  it('memberRemove recusado devolve o membro e explica', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'memberRemove', clientId: 'p1' }, { isUndo: false })
    expect(s.members.p1).toBeUndefined()
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden', current: null }, 0)
    expect(s.members.p1).toEqual(player)
    expect(s.toasts.at(-1)?.text).toBe('Não dá para remover quem está online')
  })

  it('ops de camada não entram na pilha de desfazer', () => {
    let s = reduceSubmit(joined(gm, DEFAULT_LAYERS), 'op_1', { kind: 'layerUpdate', id: 'map', patch: { name: 'A' } }, { isUndo: false })
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 0 }, 0)
    expect(s.undoStack).toEqual([])
    expect(s.undoGroups).toEqual({})
  })
})
```

Crie `apps/web/test/undo-groups.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, type Member, type TableObject } from '@mesa/shared'
import { addToast, reduceServer, reduceSubmit, reduceSubmitBatch } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const stroke = (id: string): TableObject => ({
  id, type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 0, rotation: 0, zIndex: 1,
  segments: [[0, 0, 10, 0]], color: '#ffffff', strokeWidth: 3,
  ownerId: 'me', version: 1, updatedBy: 'me', control: { mode: 'list', clientIds: ['me'] },
})

function joined(): TableState {
  return reduceServer(
    makeInitialState(),
    {
      t: 'welcome',
      self: me,
      snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects: [stroke('a'), stroke('b')], locks: [], notes: {} },
    },
    0,
  )
}

const batch = (s: TableState) =>
  reduceSubmitBatch(
    s,
    [
      { opId: 'op_a', op: { kind: 'update', id: 'a', patch: { x: 5 } } },
      { opId: 'op_b', op: { kind: 'delete', id: 'b' } },
    ],
    { isUndo: false, groupId: 'g1' },
  )

describe('desfazer em grupo', () => {
  it('o lote vira um grupo quando todas as ops são confirmadas, com inversas em ordem reversa', () => {
    let s = batch(joined())
    expect(s.objects.a.x).toBe(5)
    expect(s.objects.b).toBeUndefined()
    s = reduceServer(s, { t: 'ack', opId: 'op_a', version: 2 }, 0)
    expect(s.undoStack).toEqual([])
    s = reduceServer(s, { t: 'ack', opId: 'op_b', version: 0 }, 0)
    expect(s.undoStack).toEqual([
      [
        { kind: 'create', object: expect.objectContaining({ id: 'b', segments: [[0, 0, 10, 0]] }) },
        { kind: 'update', id: 'a', patch: { x: 0 } },
      ],
    ])
    expect(s.undoGroups).toEqual({})
  })

  it('op recusada no lote: as confirmadas entram mesmo assim', () => {
    let s = batch(joined())
    s = reduceServer(s, { t: 'reject', opId: 'op_b', reason: 'locked', current: stroke('b') }, 0)
    s = reduceServer(s, { t: 'ack', opId: 'op_a', version: 2 }, 0)
    expect(s.undoStack).toEqual([[{ kind: 'update', id: 'a', patch: { x: 0 } }]])
    expect(s.objects.b).toBeDefined()
  })

  it('lote todo recusado não empilha grupo vazio', () => {
    let s = batch(joined())
    s = reduceServer(s, { t: 'reject', opId: 'op_a', reason: 'locked', current: stroke('a') }, 0)
    s = reduceServer(s, { t: 'reject', opId: 'op_b', reason: 'locked', current: stroke('b') }, 0)
    expect(s.undoStack).toEqual([])
  })

  it('ops de desfazer não criam grupo', () => {
    const s = reduceSubmitBatch(joined(), [{ opId: 'op_u', op: { kind: 'delete', id: 'a' } }], { isUndo: true, groupId: 'gu' })
    expect(s.undoGroups).toEqual({})
    expect(reduceServer(s, { t: 'ack', opId: 'op_u', version: 0 }, 0).undoStack).toEqual([])
  })

  it('guarda no máximo 50 grupos', () => {
    let s = joined()
    for (let i = 0; i < 51; i++) {
      s = reduceSubmit(s, `op_${i}`, { kind: 'update', id: 'a', patch: { x: i } }, { isUndo: false })
      s = reduceServer(s, { t: 'ack', opId: `op_${i}`, version: i + 2 }, 0)
    }
    expect(s.undoStack).toHaveLength(50)
    expect(s.undoStack.at(-1)).toEqual([{ kind: 'update', id: 'a', patch: { x: 49 } }])
  })

  // Review Focus #4
  it('desfazer com várias ops recusadas mostra um único toast', () => {
    let s = reduceSubmitBatch(
      joined(),
      [
        { opId: 'op_1', op: { kind: 'delete', id: 'a' } },
        { opId: 'op_2', op: { kind: 'update', id: 'b', patch: { x: 9 } } },
        { opId: 'op_3', op: { kind: 'update', id: 'a', patch: { y: 9 } } },
      ],
      { isUndo: true, groupId: 'gu' },
    )
    s = reduceServer(s, { t: 'reject', opId: 'op_2', reason: 'locked', current: stroke('b') }, 0)
    s = reduceServer(s, { t: 'reject', opId: 'op_3', reason: 'not_found', current: null }, 0)
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 0 }, 0)
    expect(s.toasts.map((t) => t.text)).toEqual(['Não foi possível desfazer'])
  })

  it('addToast não repete texto igual sem ação', () => {
    let s = addToast(joined(), 'Sem permissão nessa camada')
    s = addToast(s, 'Sem permissão nessa camada')
    expect(s.toasts).toHaveLength(1)
  })
})
```

Run: `pnpm --filter @mesa/web test`
Expected: FAIL (`reduceSubmitBatch` não existe, mensagens novas ignoradas, pilha sem grupos).

- [ ] **Step 2: Estado**

Substitua `apps/web/src/store/state.ts` por:

```ts
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
```

Substitua `apps/web/src/store/localOps.ts` por:

```ts
import { mergePatch, type ObjectOp, type Op, type TableObject } from '@mesa/shared'

export function opTargetId(op: ObjectOp): string {
  return op.kind === 'create' ? op.object.id : op.id
}

/** Aplica localmente só operações de objeto; as demais são tratadas nos reducers. */
export function applyLocalOp(objects: Record<string, TableObject>, op: Op, selfId: string): Record<string, TableObject> {
  switch (op.kind) {
    case 'create':
      return {
        ...objects,
        [op.object.id]: {
          ...op.object,
          control: { mode: 'list', clientIds: [selfId] },
          ownerId: selfId,
          version: 0,
          updatedBy: selfId,
        } as TableObject,
      }
    case 'update': {
      const current = objects[op.id]
      if (!current) return objects
      return { ...objects, [op.id]: { ...mergePatch(current, op.patch), updatedBy: selfId } as TableObject }
    }
    case 'delete': {
      if (!objects[op.id]) return objects
      const { [op.id]: _removed, ...rest } = objects
      return rest
    }
    default:
      return objects
  }
}
```

- [ ] **Step 3: Reducers**

Substitua `apps/web/src/store/reducers.ts` por:

```ts
import {
  LOCK_TTL_MS,
  UNDO_LIMIT,
  insertLayer,
  isObjectOp,
  moveLayer,
  sortLayers,
  type Layer,
  type Op,
  type RejectReason,
  type ServerMessage,
  type TableObject,
} from '@mesa/shared'
import type { ConnStatus } from '../sync/SyncClient'
import { applyLocalOp, opTargetId } from './localOps'
import { inverseOf } from './undo'
import type { LocalPrev, PendingOp, TableState, Toast } from './state'

const REJECT_TEXT: Record<RejectReason, string> = {
  invalid: 'Ação inválida',
  not_found: 'O objeto não existe mais',
  exists: 'Esse objeto já existe',
  locked: 'Outra pessoa está mexendo nesse objeto',
  forbidden: 'Sem permissão nessa camada',
}

export function rejectText(op: Op, reason: RejectReason): string {
  if (reason === 'forbidden') {
    if (op.kind === 'memberRemove') return 'Não dá para remover quem está online'
    if (op.kind === 'layerDelete') return 'Essa camada não pode ser removida'
    if (op.kind === 'layerMove') return 'A camada não pode ir para lá'
  }
  return REJECT_TEXT[reason]
}

let toastSeq = 0

export function addToast<S extends TableState>(s: S, text: string, action?: Toast['action']): S {
  // um lote recusado (ex.: borracha) não empilha o mesmo aviso várias vezes
  if (!action && s.toasts.some((t) => t.text === text && !t.action)) return s
  return { ...s, toasts: [...s.toasts, { id: ++toastSeq, text, action }] }
}

export function reduceStatus<S extends TableState>(s: S, status: ConnStatus): S {
  return s.status === status ? s : { ...s, status }
}

export function isLockedByOther(s: TableState, objectId: string, now: number): boolean {
  const lock = s.locks[objectId]
  return !!lock && lock.clientId !== s.self?.clientId && lock.expiresAt > now
}

function omit<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

function reapplyPending(
  objects: Record<string, TableObject>,
  pending: Record<string, PendingOp>,
  selfId: string,
  onlyId?: string,
): Record<string, TableObject> {
  let out = objects
  for (const p of Object.values(pending)) {
    if (!isObjectOp(p.op)) continue
    if (onlyId === undefined || opTargetId(p.op) === onlyId) out = applyLocalOp(out, p.op, selfId)
  }
  return out
}

export function applyLayerOp(layers: Layer[], op: Op): Layer[] {
  switch (op.kind) {
    case 'layerCreate':
      return layers.some((l) => l.id === op.layer.id) ? layers : insertLayer(layers, op.layer)
    case 'layerUpdate':
      return layers.map((l) => (l.id === op.id ? { ...l, ...op.patch } : l))
    case 'layerDelete':
      return layers.filter((l) => l.id !== op.id)
    case 'layerMove':
      return moveLayer(layers, op.id, op.direction) ?? layers
    default:
      return layers
  }
}

function setNote(notes: Record<string, string>, objectId: string, text: string): Record<string, string> {
  return text === '' ? omit(notes, objectId) : { ...notes, [objectId]: text }
}

function upsertLayer(layers: Layer[], layer: Layer): Layer[] {
  return sortLayers([...layers.filter((l) => l.id !== layer.id), layer])
}

/** Camada visível (para jogadores) de maior order; senão a de maior order. */
export function topLayerId(layers: Layer[]): string {
  const sorted = sortLayers(layers)
  const visible = sorted.filter((l) => l.visibility === 'all')
  return (visible.at(-1) ?? sorted.at(-1))?.id ?? ''
}

function withActiveLayer<S extends TableState>(s: S): S {
  return s.layers.some((l) => l.id === s.activeLayerId) ? s : { ...s, activeLayerId: topLayerId(s.layers), selectedId: null }
}

function withoutLayer<S extends TableState>(s: S, layerId: string): S {
  const gone = new Set(Object.values(s.objects).filter((o) => o.layerId === layerId).map((o) => o.id))
  const keep = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([id]) => !gone.has(id)))
  return withActiveLayer({
    ...s,
    layers: s.layers.filter((l) => l.id !== layerId),
    objects: keep(s.objects),
    notes: keep(s.notes),
    locks: keep(s.locks),
    dragPreviews: keep(s.dragPreviews),
    deniedGrabs: keep(s.deniedGrabs),
    strokePreviews: Object.fromEntries(Object.entries(s.strokePreviews).filter(([, p]) => p.layerId !== layerId)),
    selectedId: s.selectedId && gone.has(s.selectedId) ? null : s.selectedId,
  })
}

function applyOptimistic<S extends TableState>(s: S, op: Op): { next: S; before: TableObject | null; prev: LocalPrev | null } {
  if (isObjectOp(op)) {
    const targetId = opTargetId(op)
    return {
      next: {
        ...s,
        objects: applyLocalOp(s.objects, op, s.self?.clientId ?? ''),
        selectedId: op.kind === 'delete' && s.selectedId === targetId ? null : s.selectedId,
      },
      before: s.objects[targetId] ?? null,
      prev: null,
    }
  }
  switch (op.kind) {
    case 'layerCreate':
    case 'layerUpdate':
    case 'layerMove':
      return {
        next: withActiveLayer({ ...s, layers: applyLayerOp(s.layers, op) }),
        before: null,
        prev: { kind: 'layers', layers: s.layers, objects: [], notes: {} },
      }
    case 'layerDelete': {
      const objects = Object.values(s.objects).filter((o) => o.layerId === op.id)
      const notes = Object.fromEntries(objects.filter((o) => s.notes[o.id] !== undefined).map((o) => [o.id, s.notes[o.id]]))
      return { next: withoutLayer(s, op.id), before: null, prev: { kind: 'layers', layers: s.layers, objects, notes } }
    }
    case 'noteSet':
      return {
        next: { ...s, notes: setNote(s.notes, op.objectId, op.text.trim() === '' ? '' : op.text) },
        before: null,
        prev: { kind: 'note', objectId: op.objectId, text: s.notes[op.objectId] ?? null },
      }
    case 'memberRemove':
      return {
        next: { ...s, members: omit(s.members, op.clientId) },
        before: null,
        prev: { kind: 'member', member: s.members[op.clientId] ?? null },
      }
  }
}

// Volta ao estado de antes da op recusada e reaplica as ops de camada enviadas depois dela.
function revertLocal<S extends TableState>(s: S, p: PendingOp, opId: string): S {
  const prev = p.prev
  if (!prev) return s
  switch (prev.kind) {
    case 'layers': {
      let layers = prev.layers
      let after = false
      for (const [id, other] of Object.entries(s.pending)) {
        if (id === opId) after = true
        else if (after) layers = applyLayerOp(layers, other.op)
      }
      const objects = { ...s.objects }
      for (const o of prev.objects) objects[o.id] = o
      return withActiveLayer({ ...s, layers, objects, notes: { ...s.notes, ...prev.notes } })
    }
    case 'note':
      return { ...s, notes: setNote(s.notes, prev.objectId, prev.text ?? '') }
    case 'member':
      return prev.member ? { ...s, members: { ...s.members, [prev.member.clientId]: prev.member } } : s
  }
}

function settleGroup<S extends TableState>(s: S, p: PendingOp, inverse: Op | null): S {
  if (!p.group) return s
  const group = s.undoGroups[p.group.id]
  if (!group) return s
  const inverses = [...group.inverses]
  inverses[p.group.index] = inverse
  const settled = group.settled + 1
  if (settled < inverses.length) return { ...s, undoGroups: { ...s.undoGroups, [p.group.id]: { inverses, settled } } }
  const ops = inverses.filter((op): op is Op => op !== null).reverse()
  return {
    ...s,
    undoGroups: omit(s.undoGroups, p.group.id),
    undoStack: ops.length > 0 ? [...s.undoStack, ops].slice(-UNDO_LIMIT) : s.undoStack,
  }
}

export function reduceSubmitBatch<S extends TableState>(
  s: S,
  items: Array<{ opId: string; op: Op }>,
  opts: { isUndo: boolean; groupId: string },
): S {
  let next = s
  const pending = { ...s.pending }
  items.forEach(({ opId, op }, index) => {
    const applied = applyOptimistic(next, op)
    next = applied.next
    pending[opId] = {
      op,
      before: applied.before,
      prev: applied.prev,
      isUndo: opts.isUndo,
      inverse: opts.isUndo ? null : inverseOf(op, applied.before),
      group: opts.isUndo ? null : { id: opts.groupId, index },
    }
  })
  const undoGroups =
    opts.isUndo || items.length === 0
      ? next.undoGroups
      : { ...next.undoGroups, [opts.groupId]: { inverses: items.map(() => null), settled: 0 } }
  return { ...next, pending, undoGroups }
}

export function reduceSubmit<S extends TableState>(s: S, opId: string, op: Op, opts: { isUndo: boolean }): S {
  return reduceSubmitBatch(s, [{ opId, op }], { isUndo: opts.isUndo, groupId: opId })
}

export function reduceServer<S extends TableState>(s: S, msg: ServerMessage, now: number): S {
  const selfId = s.self?.clientId ?? ''

  switch (msg.t) {
    case 'welcome': {
      const snap = msg.snapshot
      const objects = reapplyPending(Object.fromEntries(snap.objects.map((o) => [o.id, o])), s.pending, msg.self.clientId)
      const layers = sortLayers(snap.layers)
      const activeLayerId = layers.some((l) => l.id === s.activeLayerId)
        ? s.activeLayerId
        : layers.some((l) => l.id === 'tokens')
          ? 'tokens'
          : topLayerId(layers)
      return {
        ...s,
        status: 'open',
        fatal: null,
        self: msg.self,
        meta: snap.meta,
        layers,
        objects,
        notes: snap.notes,
        members: Object.fromEntries(snap.members.map((m) => [m.clientId, m])),
        locks: Object.fromEntries(snap.locks.map((l) => [l.objectId, { clientId: l.clientId, expiresAt: now + LOCK_TTL_MS }])),
        cursors: {},
        dragPreviews: {},
        strokePreviews: {},
        deniedGrabs: {},
        activeLayerId,
        selectedId: s.selectedId && objects[s.selectedId] ? s.selectedId : null,
      }
    }

    case 'ack': {
      const p = s.pending[msg.opId]
      if (!p) return s
      let objects = s.objects
      let notes = s.notes
      if (isObjectOp(p.op)) {
        const id = opTargetId(p.op)
        if (p.op.kind === 'delete') notes = omit(notes, id)
        else if (objects[id]) objects = { ...objects, [id]: { ...objects[id], version: msg.version } }
      }
      return settleGroup({ ...s, pending: omit(s.pending, msg.opId), objects, notes }, p, p.inverse)
    }

    case 'reject': {
      const p = s.pending[msg.opId]
      if (!p) return s
      const pending = omit(s.pending, msg.opId)
      let next: S
      if (isObjectOp(p.op)) {
        const id = opTargetId(p.op)
        const base = msg.current !== undefined ? msg.current : p.before
        const objects = { ...s.objects }
        if (base) objects[id] = base
        else delete objects[id]
        next = { ...s, pending, objects: reapplyPending(objects, pending, selfId, id) }
      } else {
        next = { ...revertLocal(s, p, msg.opId), pending }
      }
      next = settleGroup(next, p, null)
      if (p.op.kind === 'delete' && msg.reason === 'not_found') return next
      return addToast(next, p.isUndo ? 'Não foi possível desfazer' : rejectText(p.op, msg.reason))
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
        notes: omit(s.notes, id),
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

    case 'memberRemoved':
      return { ...s, members: omit(s.members, msg.clientId), cursors: omit(s.cursors, msg.clientId) }

    case 'layerUpsert':
      return withActiveLayer({ ...s, layers: upsertLayer(s.layers, msg.layer) })

    case 'layerShown': {
      const objects = { ...s.objects }
      for (const o of msg.objects) objects[o.id] = o
      return { ...s, layers: upsertLayer(s.layers, msg.layer), objects: reapplyPending(objects, s.pending, selfId) }
    }

    case 'layerHidden':
    case 'layerRemoved':
      return withoutLayer(s, msg.id)

    case 'noteSet':
      return { ...s, notes: setNote(s.notes, msg.objectId, msg.text) }

    case 'error':
      return { ...s, fatal: msg.reason, status: 'closed' }
  }
}
```

> `undo.ts` não muda nesta task: o `default: return null` da Task 3 já faz as ops novas não terem inversa.

- [ ] **Step 4: Store — lote e desfazer em grupo**

Em `apps/web/src/store/tableStore.ts`:

1. Troque o import de `./reducers` por:

```ts
import { addToast, reduceServer, reduceStatus, reduceSubmitBatch } from './reducers'
```

2. Na interface `TableActions`, depois de `submit(op: Op): boolean`, acrescente:

```ts
  submitGroup(ops: Op[]): boolean
```

3. Troque a função `submitInternal` inteira por:

```ts
    const submitMany = (ops: Op[], isUndo: boolean): boolean => {
      if (ops.length === 0) return true
      const s = get()
      if (s.status !== 'open' || !sync) {
        set(addToast(s, 'Sem conexão — aguarde reconectar'))
        return false
      }
      const items = ops.map((op) => ({ opId: `op_${nanoid()}`, op }))
      set(reduceSubmitBatch(s, items, { isUndo, groupId: `g_${nanoid()}` }))
      for (const { opId, op } of items) sync.sendOp(opId, op)
      return true
    }
```

4. Troque as entradas `submit` e `undo` do objeto `actions` por:

```ts
      submit: (op) => submitMany([op], false),
      submitGroup: (ops) => submitMany(ops, false),
      undo() {
        const s = get()
        const group = s.undoStack[s.undoStack.length - 1]
        if (!group) return
        set({ undoStack: s.undoStack.slice(0, -1) })
        // offline/sem sync: submitMany recusa — devolve o grupo à pilha para não perdê-lo
        if (!submitMany(group, true)) set((st) => ({ undoStack: [...st.undoStack, group] }))
      },
```

- [ ] **Step 5: Checkpoint**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: verde (testes antigos + `reducers-layers` + `undo-groups`).

---

### Task 10: Web — ícones Lucide, barra de ferramentas e popover da caneta (+ E2E isolado)

**Files:**
- Modify: `package.json` (raiz, arquivo inteiro)
- Modify: `playwright.config.ts` (arquivo inteiro)
- Modify: `apps/web/package.json` (via `pnpm add`)
- Modify: `apps/web/src/store/state.ts` (`Tool`, `PenMode`, `penMode`, `eraseAll`)
- Modify: `apps/web/src/store/tableStore.ts` (`setPen`, `setEraseAll`)
- Modify: `apps/web/src/canvas/useDrawingTools.ts` (arquivo inteiro — tira a borracha antiga)
- Modify: `apps/web/src/canvas/TableCanvas.tsx:19-20,53`
- Modify: `apps/web/src/ui/useKeyboard.ts:24-25`
- Create: `apps/web/src/ui/useDismiss.ts`
- Create: `apps/web/src/ui/PenPopover.tsx`
- Modify: `apps/web/src/ui/Toolbar.tsx` (arquivo inteiro)
- Modify: `apps/web/src/styles.css` (acrescentar no fim)
- Modify: `e2e/table.spec.ts` (acrescentar teste)

**Interfaces:**
- Consumes: estado e ações da Task 9.
- Produces:
  - `type Tool = 'select' | 'hand' | 'pencil'`; `type PenMode = 'draw' | 'erase'`; `TableState.penMode: PenMode` (padrão `'draw'`), `TableState.eraseAll: boolean` (padrão `false`)
  - `TableActions.setPen(mode: PenMode): void` (ativa a caneta no modo; limpa seleção), `TableActions.setEraseAll(value: boolean): void`
  - `useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void): void` — fecha com `Esc` ou `mousedown` fora; antes de fechar, tira o foco de um campo dentro do popover (dispara `onBlur`, que salva)
  - `floatingStyle(x: number, y: number, width: number): CSSProperties` — posição `fixed` presa à janela
  - `PEN_COLORS: string[]` (8 cores) em `apps/web/src/ui/PenPopover.tsx`
  - E2E: `pnpm e2e` sobe `wrangler dev` em `E2E_PORT` (padrão 8788) com assets de `apps/web/dist-e2e` e estado em `apps/worker/.wrangler/e2e-state`; script raiz `build:e2e`
  - Durante esta task e as 11–12, o modo Apagar ainda não apaga (a borracha nova chega na Task 13)

- [ ] **Step 1: E2E isolado do servidor do usuário**

Substitua `package.json` (raiz) por:

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
    "build:e2e": "pnpm --filter @mesa/web exec vite build --outDir dist-e2e --emptyOutDir",
    "e2e": "playwright test",
    "deploy": "pnpm build && pnpm --filter @mesa/worker run deploy",
    "host": "pnpm build && pnpm --filter @mesa/worker exec wrangler dev --ip 0.0.0.0 --port 8787",
    "tunnel": "cloudflared tunnel --url http://localhost:8787"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "typescript": "^7.0.2"
  }
}
```

Substitua `playwright.config.ts` por:

```ts
import { defineConfig } from '@playwright/test'

// O E2E sobe o próprio servidor: porta própria (padrão 8788), build próprio (apps/web/dist-e2e)
// e estado próprio (apps/worker/.wrangler/e2e-state). Nunca reaproveita nem mexe no `pnpm host`
// do usuário (porta 8787, apps/web/dist, apps/worker/.wrangler/state).
const PORT = Number(process.env.E2E_PORT ?? 8788)

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: { baseURL: `http://localhost:${PORT}`, viewport: { width: 1280, height: 720 } },
  webServer: {
    command:
      `pnpm build:e2e && pnpm --filter @mesa/worker exec wrangler dev --port ${PORT} --inspector-port ${PORT + 1000} ` +
      '--assets ../web/dist-e2e --persist-to .wrangler/e2e-state',
    url: `http://localhost:${PORT}`,
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
```

> `wrangler dev --assets <dir>` só troca o diretório: `not_found_handling` e `run_worker_first` continuam vindo do `wrangler.jsonc` (conferido em `resolveAssetOptions` do wrangler 4.148). `reuseExistingServer: false` garante que um servidor velho nunca seja usado.

Antes de rodar qualquer E2E (nesta e nas próximas tasks):

```bash
ss -ltn | grep -E ':(8787|8788|9788)\b' || true
```

- Se `:8787` aparecer, é o servidor do usuário: **não mexa**.
- Se `:8788` ou `:9788` estiverem ocupadas, rode com outra porta: `E2E_PORT=8790 pnpm e2e`.
- Nunca rode `pkill`/`kill` em processos que você não iniciou.

- [ ] **Step 2: Rodar o E2E atual na infraestrutura nova**

Run: `pnpm e2e`
Expected: os 4 testes do M1 passam (nada da UI mudou ainda). Se algum falhar, é problema da infraestrutura nova (porta/assets) — corrija antes de seguir.

- [ ] **Step 3: Teste E2E do popover (falha)**

Acrescente no fim de `e2e/table.spec.ts`:

```ts
test('botão direito na caneta abre opções; modo Apagar vira Borracha (E)', async ({ browser, page }) => {
  const { tableId } = await newTable(page)
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await player.getByRole('button', { name: 'Lápis (P)' }).click({ button: 'right' })
  const pop = player.getByRole('dialog', { name: 'Opções da caneta' })
  await expect(pop).toBeVisible()
  await pop.getByLabel('Espessura do traço').fill('12')
  await pop.getByRole('button', { name: 'Cor #4363d8' }).click()
  await pop.getByRole('button', { name: 'Apagar' }).click()
  await expect(player.getByRole('button', { name: 'Borracha (E)' })).toHaveAttribute('aria-pressed', 'true')
  await expect(pop.getByText('Só os meus')).toHaveCount(0) // a chave é só do mestre

  await player.keyboard.press('Escape')
  await expect(pop).toHaveCount(0)
  await player.keyboard.press('p')
  await expect(player.getByRole('button', { name: 'Lápis (P)' })).toHaveAttribute('aria-pressed', 'true')
  await player.keyboard.press('e')
  await expect(player.getByRole('button', { name: 'Borracha (E)' })).toBeVisible()

  const s = await player.evaluate(() => {
    const st = (window as any).__mesa.getState()
    return { strokeWidth: st.strokeWidth, color: st.color }
  })
  expect(s).toEqual({ strokeWidth: 12, color: '#4363d8' })
})
```

Run: `pnpm e2e -g "botão direito na caneta"`
Expected: FAIL (não há popover).

- [ ] **Step 4: Instalar o Lucide**

Run: `pnpm --filter @mesa/web add lucide-react`
Expected: `apps/web/package.json` ganha `lucide-react` em `dependencies` (anote a versão instalada; não troque depois).

- [ ] **Step 5: Estado e ações da caneta**

Em `apps/web/src/store/state.ts`, troque a linha do `Tool` por:

```ts
export type Tool = 'select' | 'hand' | 'pencil'
export type PenMode = 'draw' | 'erase'
```

acrescente em `TableState`, depois de `strokeWidth: number`:

```ts
  penMode: PenMode
  /** Mestre no modo apagar: false = só os meus traços; true = de todos. */
  eraseAll: boolean
```

e em `makeInitialState()`, depois de `strokeWidth: 4,`:

```ts
    penMode: 'draw',
    eraseAll: false,
```

Em `apps/web/src/store/tableStore.ts`:
- no import de `./state`, acrescente `type PenMode`;
- na interface `TableActions`, depois de `setTool(tool: Tool): void`, acrescente:

```ts
  setPen(mode: PenMode): void
  setEraseAll(value: boolean): void
```

- no objeto `actions`, depois de `setTool: …,`, acrescente:

```ts
      setPen: (penMode) => set({ tool: 'pencil', penMode, selectedId: null }),
      setEraseAll: (eraseAll) => set({ eraseAll }),
```

Em `apps/web/src/ui/useKeyboard.ts`, troque as linhas 24-25 (`case 'p'` e `case 'e'`) por:

```ts
        case 'p': actions.setPen('draw'); break
        case 'e': actions.setPen('erase'); break
```

Substitua `apps/web/src/canvas/useDrawingTools.ts` por (só desenho; a borracha nova chega na Task 13):

```ts
import { useMemo, useRef, useState } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { nanoid } from 'nanoid'
import { MAX_SEGMENT_NUMBERS, boundsOf, simplifyPoints } from '@mesa/shared'
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

  const onDown = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool !== 'pencil' || s.penMode !== 'draw' || e.evt.button !== 0) return
    if (s.status !== 'open' || !s.actions.canEditLayer(s.activeLayerId)) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    current.current = { strokeId: nanoid(), layerId: s.activeLayerId, points: [pos.x, pos.y], unsent: [pos.x, pos.y] }
    setOwnPreview({ layerId: s.activeLayerId, points: [pos.x, pos.y], color: s.color, strokeWidth: s.strokeWidth })
    flushPreview()
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
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
    if (points.length > MAX_SEGMENT_NUMBERS) {
      points = simplifyPoints(points, 4 / s.viewport.scale).slice(0, MAX_SEGMENT_NUMBERS)
    }
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
        segments: [points.map((v, i) => (i % 2 === 0 ? v - b.minX : v - b.minY))],
        color: s.color,
        strokeWidth: s.strokeWidth,
      },
    })
  }

  return { ownPreview, onDown, onMove, onUp }
}
```

Em `apps/web/src/canvas/TableCanvas.tsx`, depois da linha `const tool = useTable((s) => s.tool)` acrescente:

```ts
  const penMode = useTable((s) => s.penMode)
```

e troque a linha `const cursor = …` por:

```ts
  const cursor = panning ? 'grab' : tool === 'pencil' ? (penMode === 'erase' ? 'cell' : 'crosshair') : 'default'
```

- [ ] **Step 6: `useDismiss`, popover e barra**

Crie `apps/web/src/ui/useDismiss.ts`:

```ts
import { useEffect, type CSSProperties, type RefObject } from 'react'

/**
 * Fecha um popover com Esc ou clique fora. Antes de fechar, tira o foco de um campo
 * dentro dele: o onBlur do campo dispara e salva o que foi digitado.
 */
export function useDismiss(ref: RefObject<HTMLElement | null>, onClose: () => void): void {
  useEffect(() => {
    const commit = () => {
      const active = document.activeElement
      if (active instanceof HTMLElement && ref.current?.contains(active)) active.blur()
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      commit()
      onClose()
    }
    const onDown = (e: MouseEvent) => {
      if (!ref.current || ref.current.contains(e.target as Node)) return
      commit()
      onClose()
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onDown)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onDown)
    }
  }, [ref, onClose])
}

/** Posição fixa perto do clique, sem sair da janela. */
export function floatingStyle(x: number, y: number, width: number): CSSProperties {
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - 240)),
    width,
  }
}
```

Crie `apps/web/src/ui/PenPopover.tsx`:

```tsx
import { useRef } from 'react'
import { Eraser, Pencil } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'

export const PEN_COLORS = ['#e6194b', '#f58231', '#ffe119', '#3cb44b', '#4363d8', '#911eb4', '#ffffff', '#000000']

export function PenPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const color = useTable((s) => s.color)
  const strokeWidth = useTable((s) => s.strokeWidth)
  const penMode = useTable((s) => s.penMode)
  const eraseAll = useTable((s) => s.eraseAll)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()

  return (
    <div ref={ref} className="panel popover pen-popover" role="dialog" aria-label="Opções da caneta">
      <div className="field">
        <span>Espessura</span>
        <div className="row">
          <input
            type="range"
            aria-label="Espessura do traço"
            min={1}
            max={30}
            value={strokeWidth}
            onChange={(e) => actions.setStrokeWidth(Number(e.target.value))}
          />
          <span className="width-preview" style={{ width: strokeWidth, height: strokeWidth, background: color }} />
        </div>
      </div>

      <div className="field">
        <span>Cor</span>
        <div className="row">
          <input type="color" aria-label="Cor do traço" value={color} onChange={(e) => actions.setColor(e.target.value)} />
          {PEN_COLORS.map((c) => (
            <button
              key={c}
              className="swatch"
              aria-label={`Cor ${c}`}
              aria-pressed={color === c}
              style={{ background: c }}
              onClick={() => actions.setColor(c)}
            />
          ))}
        </div>
      </div>

      <div className="field">
        <span>Modo</span>
        <div className="row">
          <button aria-pressed={penMode === 'draw'} onClick={() => actions.setPen('draw')}>
            <Pencil size={16} aria-hidden /> Desenhar
          </button>
          <button aria-pressed={penMode === 'erase'} onClick={() => actions.setPen('erase')}>
            <Eraser size={16} aria-hidden /> Apagar
          </button>
        </div>
      </div>

      {isGm && penMode === 'erase' && (
        <div className="field" role="radiogroup" aria-label="Apagar">
          <span>Apagar</span>
          <label>
            <input type="radio" name="erase-scope" checked={!eraseAll} onChange={() => actions.setEraseAll(false)} /> Só os meus
          </label>
          <label>
            <input type="radio" name="erase-scope" checked={eraseAll} onChange={() => actions.setEraseAll(true)} /> De todos
          </label>
        </div>
      )}
    </div>
  )
}
```

Substitua `apps/web/src/ui/Toolbar.tsx` por:

```tsx
import { useCallback, useRef, useState } from 'react'
import { Eraser, Hand, ImagePlus, MousePointer2, Pencil, Undo2 } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { PenPopover } from './PenPopover'

const ICON = 18

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const actions = useTableActions()
  const fileInput = useRef<HTMLInputElement>(null)
  const [penMenu, setPenMenu] = useState(false)
  const closePenMenu = useCallback(() => setPenMenu(false), [])
  const penLabel = penMode === 'erase' ? 'Borracha (E)' : 'Lápis (P)'

  return (
    <div className="panel toolbar">
      <button aria-label="Selecionar (V)" title="Selecionar (V)" aria-pressed={tool === 'select'} onClick={() => actions.setTool('select')}>
        <MousePointer2 size={ICON} aria-hidden />
      </button>
      <button aria-label="Mão (H)" title="Mão (H)" aria-pressed={tool === 'hand'} onClick={() => actions.setTool('hand')}>
        <Hand size={ICON} aria-hidden />
      </button>
      <div className="pen-anchor">
        <button
          aria-label={penLabel}
          title={`${penLabel} — botão direito: opções`}
          aria-pressed={tool === 'pencil'}
          aria-haspopup="dialog"
          aria-expanded={penMenu}
          onClick={() => actions.setPen(penMode)}
          onContextMenu={(e) => {
            e.preventDefault()
            setPenMenu(true)
          }}
        >
          {penMode === 'erase' ? <Eraser size={ICON} aria-hidden /> : <Pencil size={ICON} aria-hidden />}
        </button>
        {penMenu && <PenPopover onClose={closePenMenu} />}
      </div>
      <button aria-label="Adicionar imagem" title="Adicionar imagem na camada ativa" onClick={() => fileInput.current?.click()}>
        <ImagePlus size={ICON} aria-hidden />
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
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>
        <Undo2 size={ICON} aria-hidden />
      </button>
    </div>
  )
}
```

Acrescente no fim de `apps/web/src/styles.css`:

```css
/* M2 — ícones, popovers e formulários */
button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
button:disabled { opacity: 0.45; cursor: default; }
.toolbar > button, .toolbar > .pen-anchor > button { width: 36px; height: 36px; padding: 0; }
.pen-anchor { position: relative; }
.popover { display: grid; gap: 10px; z-index: 30; font-size: 13px; }
.pen-popover { position: absolute; left: calc(100% + 12px); top: 0; width: 240px; }
.floating { position: fixed; }
.field { display: grid; gap: 4px; border: none; margin: 0; padding: 0; }
.field legend { padding: 0; margin-bottom: 4px; }
.field label, .popover > label { display: flex; align-items: center; gap: 6px; }
.row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
.swatch { width: 20px; height: 20px; padding: 0; border-radius: 50%; }
.swatch[aria-pressed='true'] { outline: 2px solid #fff; outline-offset: 1px; }
.width-preview { display: inline-block; border-radius: 50%; max-width: 30px; max-height: 30px; }
.icon-button { padding: 4px; }
.danger { border-color: #a33; color: #f88; }
textarea { font: inherit; background: #2a2c33; color: #eee; border: 1px solid #4a4d57; border-radius: 6px; padding: 6px 8px; resize: vertical; }
```

- [ ] **Step 7: Rodar unitários, typecheck e E2E**

Run: `pnpm --filter @mesa/web typecheck && pnpm --filter @mesa/web test`
Expected: PASS.

Run (conferindo as portas como no Step 1): `pnpm e2e`
Expected: os 4 testes do M1 + o teste do popover passam.

- [ ] **Step 8: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: verde.

---

### Task 11: Web — painel de camadas e propriedades da camada

**Files:**
- Create: `apps/web/src/ui/LayersPanel.tsx`
- Create: `apps/web/src/ui/LayerMenu.tsx`
- Delete: `apps/web/src/ui/LayerSelect.tsx`
- Modify: `apps/web/src/ui/TablePage.tsx` (import do `LayerSelect` e bloco `.topbar`)
- Modify: `apps/web/src/store/tableStore.ts` (`createLayer`)
- Modify: `apps/web/src/styles.css` (`.debug` + painel)
- Modify: `e2e/table.spec.ts` (helpers, 2 testes do M1 e 2 testes novos)

**Interfaces:**
- Consumes: `sortLayers`, `GM_LAYER_ID`, `LAYER_NAME_MAX`, `DEFAULT_LAYER_NAME`, `LayerPatch` (Tasks 1/3); `useDismiss`, `floatingStyle` (Task 10); reducers otimistas (Task 9).
- Produces:
  - `TableActions.createLayer(): void` — envia `layerCreate` com `nanoid()` e nome "Nova camada" e torna a nova camada ativa
  - `<LayersPanel />`: `<section aria-label="Camadas">`; linhas `button.layer-row` com `aria-label` = nome, `aria-pressed` = ativa, em ordem da mais alta para a mais baixa; botão `+` com `aria-label="Nova camada"` (só mestre)
  - `<LayerMenu layerId x y onClose />`: `role="dialog"`, `aria-label="Propriedades da camada"`; campos "Nome", "Oculta para jogadores", "Travada para jogadores", botões "Subir camada", "Descer camada", "Remover camada" (para `gm`: só nome e trava)
  - Helpers E2E: `layersPanel(page)`, `layerRow(page, name)`, `selectLayer(page, name)`, `openLayerMenu(page, name)`

- [ ] **Step 1: Atualizar os E2E (falham)**

Em `e2e/table.spec.ts`, acrescente depois de `uploadToken`:

```ts
const layersPanel = (page: Page) => page.getByRole('region', { name: 'Camadas' })

const layerRow = (page: Page, name: string) =>
  layersPanel(page).locator('.layer-row').filter({ hasText: new RegExp(`^${name}$`) })

async function selectLayer(page: Page, name: string): Promise<void> {
  await layerRow(page, name).click()
}

async function openLayerMenu(page: Page, name: string) {
  await layerRow(page, name).click({ button: 'right' })
  const menu = page.getByRole('dialog', { name: 'Propriedades da camada' })
  await expect(menu).toBeVisible()
  return menu
}
```

Troque o teste `'jogador não vê a camada do mestre'` por:

```ts
test('jogador não vê a camada do mestre', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await expect(layersPanel(gm).locator('.layer-row')).toHaveText(['Mestre', 'Desenhos', 'Tokens', 'Mapa'])
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Tokens', 'Mapa'])
  await selectLayer(gm, 'Mestre')
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.waitForTimeout(500)
  expect(await objects(player)).toHaveLength(0)
})
```

No teste `'desenho aparece para o outro, …'`, troque as duas linhas `await player.getByLabel('Camada ativa').selectOption('drawings')` por:

```ts
  await selectLayer(player, 'Desenhos')
```

Acrescente no fim do arquivo:

```ts
test('mestre esconde e revela uma camada; jogador vê os objetos sumirem e voltarem', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)

  const menu = await openLayerMenu(gm, 'Tokens')
  await menu.getByLabel('Oculta para jogadores').check()
  await expect.poll(async () => (await objects(player)).length).toBe(0)
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Mapa'])

  await menu.getByLabel('Oculta para jogadores').uncheck()
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Tokens', 'Mapa'])
})

test('nova camada entra abaixo do Mestre; subir/descer respeita os limites', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await layersPanel(gm).getByRole('button', { name: 'Nova camada', exact: true }).first().click()
  await expect(layersPanel(gm).locator('.layer-row')).toHaveText(['Mestre', 'Nova camada', 'Desenhos', 'Tokens', 'Mapa'])
  await expect(layerRow(gm, 'Nova camada')).toHaveAttribute('aria-pressed', 'true')
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Nova camada', 'Desenhos', 'Tokens', 'Mapa'])

  const menu = await openLayerMenu(gm, 'Nova camada')
  await expect(menu.getByRole('button', { name: 'Subir camada' })).toBeDisabled()
  await menu.getByRole('button', { name: 'Descer camada' }).click()
  await expect(layersPanel(player).locator('.layer-row')).toHaveText(['Desenhos', 'Nova camada', 'Tokens', 'Mapa'])
  await menu.getByLabel('Nome').fill('Masmorra')
  await menu.getByLabel('Nome').press('Enter')
  await expect(layerRow(player, 'Masmorra')).toBeVisible()
  await gm.keyboard.press('Escape')
  await expect(menu).toHaveCount(0)

  const gmMenu = await openLayerMenu(gm, 'Mestre')
  await expect(gmMenu.getByLabel('Travada para jogadores')).toBeVisible()
  await expect(gmMenu.getByLabel('Oculta para jogadores')).toHaveCount(0)
  await expect(gmMenu.getByRole('button', { name: 'Remover camada' })).toHaveCount(0)
  await expect(gmMenu.getByRole('button', { name: 'Subir camada' })).toHaveCount(0)
})
```

> O `.first()` no botão "Nova camada" evita ambiguidade depois que existir uma linha com o mesmo nome (o clique acontece antes, mas mantém o seletor estável).

Run: `pnpm e2e` (portas conferidas como na Task 10)
Expected: FAIL nos testes que usam o painel.

- [ ] **Step 2: Ação `createLayer`**

Em `apps/web/src/store/tableStore.ts`:
- acrescente ao topo a linha `import { DEFAULT_LAYER_NAME } from '@mesa/shared'` (o import existente de `@mesa/shared` é `import type` e continua como está);
- na interface `TableActions`, depois de `setActiveLayer(id: string): void`:

```ts
  createLayer(): void
```

- no objeto `actions`, depois de `setActiveLayer: …,`:

```ts
      createLayer() {
        const id = nanoid()
        if (actions.submit({ kind: 'layerCreate', layer: { id, name: DEFAULT_LAYER_NAME } })) {
          set({ activeLayerId: id, selectedId: null })
        }
      },
```

- [ ] **Step 3: Painel e menu**

Crie `apps/web/src/ui/LayersPanel.tsx`:

```tsx
import { useCallback, useState } from 'react'
import { EyeOff, Lock, Plus } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { LayerMenu } from './LayerMenu'

export function LayersPanel() {
  const layers = useTable((s) => s.layers)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const [menu, setMenu] = useState<{ layerId: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // state.layers está em ordem crescente; o painel mostra a mais alta primeiro (Mestre no topo).
  const rows = [...layers].reverse()

  return (
    <section className="panel layers" aria-label="Camadas">
      <header>
        <strong>Camadas</strong>
        {isGm && (
          <button className="icon-button" aria-label="Nova camada" title="Nova camada" onClick={() => actions.createLayer()}>
            <Plus size={16} aria-hidden />
          </button>
        )}
      </header>
      <ul>
        {rows.map((layer) => (
          <li key={layer.id}>
            <button
              className="layer-row"
              aria-label={layer.name}
              aria-pressed={layer.id === activeLayerId}
              onClick={() => actions.setActiveLayer(layer.id)}
              onContextMenu={(e) => {
                e.preventDefault()
                if (isGm) setMenu({ layerId: layer.id, x: e.clientX, y: e.clientY })
              }}
            >
              <span className="layer-name">{layer.name}</span>
              <span className="layer-flags">
                {layer.visibility === 'gm' && (
                  <span title="Oculta para jogadores">
                    <EyeOff size={14} aria-hidden />
                  </span>
                )}
                {layer.locked && (
                  <span title="Travada para jogadores">
                    <Lock size={14} aria-hidden />
                  </span>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {menu && <LayerMenu layerId={menu.layerId} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </section>
  )
}
```

Crie `apps/web/src/ui/LayerMenu.tsx`:

```tsx
import { useEffect, useRef } from 'react'
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, LockOpen, Trash2 } from 'lucide-react'
import { GM_LAYER_ID, LAYER_NAME_MAX, sortLayers, type LayerPatch } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { floatingStyle, useDismiss } from './useDismiss'

interface Props {
  layerId: string
  x: number
  y: number
  onClose: () => void
}

export function LayerMenu({ layerId, x, y, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const layers = useTable((s) => s.layers)
  const objects = useTable((s) => s.objects)
  const actions = useTableActions()
  const layer = layers.find((l) => l.id === layerId)

  // Camada removida (por outra aba do mestre, por exemplo): o menu fecha.
  useEffect(() => {
    if (!layer) onClose()
  }, [layer, onClose])
  if (!layer) return null

  const isGmLayer = layer.id === GM_LAYER_ID
  const common = sortLayers(layers).filter((l) => l.id !== GM_LAYER_ID)
  const index = common.findIndex((l) => l.id === layerId)
  const count = Object.values(objects).filter((o) => o.layerId === layerId).length
  const update = (patch: LayerPatch) => actions.submit({ kind: 'layerUpdate', id: layerId, patch })

  return (
    <div
      ref={ref}
      className="panel popover floating"
      role="dialog"
      aria-label="Propriedades da camada"
      style={floatingStyle(x, y, 240)}
    >
      <label className="field">
        Nome
        <input
          key={layer.id}
          defaultValue={layer.name}
          maxLength={LAYER_NAME_MAX}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => {
            const name = e.currentTarget.value.trim().slice(0, LAYER_NAME_MAX)
            if (!name) {
              e.currentTarget.value = layer.name // vazio não é enviado
              return
            }
            if (name !== layer.name) update({ name })
          }}
        />
      </label>

      {!isGmLayer && (
        <label>
          <input
            type="checkbox"
            checked={layer.visibility === 'gm'}
            onChange={(e) => update({ visibility: e.target.checked ? 'gm' : 'all' })}
          />
          {layer.visibility === 'gm' ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
          Oculta para jogadores
        </label>
      )}

      <label>
        <input type="checkbox" checked={layer.locked} onChange={(e) => update({ locked: e.target.checked })} />
        {layer.locked ? <Lock size={14} aria-hidden /> : <LockOpen size={14} aria-hidden />}
        Travada para jogadores
      </label>

      {!isGmLayer && (
        <>
          <button
            disabled={index >= common.length - 1}
            onClick={() => actions.submit({ kind: 'layerMove', id: layerId, direction: 'up' })}
          >
            <ArrowUp size={16} aria-hidden /> Subir camada
          </button>
          <button disabled={index <= 0} onClick={() => actions.submit({ kind: 'layerMove', id: layerId, direction: 'down' })}>
            <ArrowDown size={16} aria-hidden /> Descer camada
          </button>
          <button
            className="danger"
            disabled={common.length <= 1}
            onClick={() => {
              if (!window.confirm(`Remover a camada ${layer.name} e ${count} objetos?`)) return
              actions.submit({ kind: 'layerDelete', id: layerId })
              onClose()
            }}
          >
            <Trash2 size={16} aria-hidden /> Remover camada
          </button>
        </>
      )}
    </div>
  )
}
```

Apague `apps/web/src/ui/LayerSelect.tsx`.

Em `apps/web/src/ui/TablePage.tsx`, troque o import de `./LayerSelect` por:

```ts
import { LayersPanel } from './LayersPanel'
```

e o bloco `<div className="panel topbar">…</div>` (que hoje contém `<LayerSelect />`) por:

```tsx
      <div className="panel topbar">
        <strong>{name ?? '…'}</strong>
      </div>
      <LayersPanel />
```

Em `apps/web/src/styles.css`, troque a regra `.debug` por:

```css
.debug { bottom: 12px; left: 12px; font-family: monospace; font-size: 12px; }
```

e acrescente no fim:

```css
.layers { bottom: 12px; right: 12px; width: 220px; display: grid; gap: 6px; }
.layers header { display: flex; align-items: center; justify-content: space-between; }
.layers ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: 40vh; overflow: auto; }
.layer-row { width: 100%; justify-content: space-between; }
.layer-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.layer-flags { display: inline-flex; gap: 4px; opacity: 0.8; }
```

- [ ] **Step 4: Rodar**

Run: `pnpm --filter @mesa/web typecheck && pnpm --filter @mesa/web test`
Expected: PASS.

Run: `pnpm e2e`
Expected: todos passam (M1 atualizados + popover + camadas).

- [ ] **Step 5: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: verde.

---

### Task 12: Web — menu de contexto do objeto, título, anotação, permissões e "Mover para camada"

**Files:**
- Create: `apps/web/src/canvas/bounds.ts`
- Create: `apps/web/test/bounds.test.ts`
- Create: `apps/web/src/canvas/ObjectDecorations.tsx`
- Create: `apps/web/src/ui/ObjectContextMenu.tsx`
- Modify: `apps/web/src/store/state.ts` (`ObjectMenu`, `objectMenu`)
- Modify: `apps/web/src/store/tableStore.ts` (`openObjectMenu`, `closeObjectMenu`, `moveObjectToLayer`)
- Modify: `apps/web/src/canvas/ImageNode.tsx` (arquivo inteiro)
- Modify: `apps/web/src/canvas/StrokeNode.tsx` (arquivo inteiro)
- Modify: `apps/web/src/canvas/SelectionTransformer.tsx:1-18`
- Modify: `apps/web/src/canvas/TableCanvas.tsx` (arquivo inteiro)
- Modify: `apps/web/src/ui/TablePage.tsx` (montar o menu)
- Modify: `apps/web/src/styles.css` (acrescentar no fim)
- Modify: `e2e/table.spec.ts` (`Obj`, helpers e 3 testes novos)

**Interfaces:**
- Consumes: `canControl`, `TITLE_MAX`, `NOTE_MAX`, `MAX_CONTROL_IDS`, `Control`, `ObjectPatch` (Task 1); `useDismiss`, `floatingStyle` (Task 10); `nextZ`, `submit` (existentes).
- Produces:
  - `interface ObjectMenu { objectId: string; x: number; y: number }`; `TableState.objectMenu: ObjectMenu | null`
  - `TableActions.openObjectMenu(objectId: string, x: number, y: number): void` — só abre (e seleciona) se o objeto existe e `canControl` para mim; `closeObjectMenu(): void`; `moveObjectToLayer(objectId: string, layerId: string): void` — envia `update { layerId, zIndex: nextZ(layerId) }` (posição/tamanho não mudam) e limpa a seleção
  - `rotatedBounds(g: Geometry): { minX: number; minY: number; maxX: number; maxY: number }`
  - `<ObjectDecorations object />` (título + glifo de anotação, `listening={false}`)
  - `<ObjectContextMenu />`: `role="dialog"`, `aria-label="Menu do objeto"`; campos "Título", rádios "Todos" / "Só o mestre" / "Jogadores escolhidos", checkboxes com apelidos, "Anotação do mestre", botão "Mover para camada" que abre a lista de camadas (todas menos a atual, da mais alta para a mais baixa), botão "Apagar"
  - Nós do canvas só são selecionáveis/arrastáveis por quem pode controlar o objeto
  - Helpers E2E: `openObjectMenu(page, obj)`, `dragObject(page, obj, dx, dy)`

- [ ] **Step 1: Teste de `rotatedBounds` (falha)**

Crie `apps/web/test/bounds.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { rotatedBounds } from '../src/canvas/bounds'

describe('rotatedBounds', () => {
  it('sem rotação é a própria caixa', () => {
    expect(rotatedBounds({ x: 10, y: 20, width: 70, height: 30, rotation: 0 })).toEqual({ minX: 10, minY: 20, maxX: 80, maxY: 50 })
  })

  it('90° gira em torno do canto (x, y), como o Konva', () => {
    const b = rotatedBounds({ x: 0, y: 0, width: 10, height: 20, rotation: 90 })
    expect(b.minX).toBeCloseTo(-20)
    expect(b.maxX).toBeCloseTo(0)
    expect(b.minY).toBeCloseTo(0)
    expect(b.maxY).toBeCloseTo(10)
  })
})
```

Run: `pnpm --filter @mesa/web test -- bounds`
Expected: FAIL — módulo não existe.

- [ ] **Step 2: Implementar `bounds.ts`**

Crie `apps/web/src/canvas/bounds.ts`:

```ts
import type { Geometry } from '../store/state'

/** Caixa alinhada aos eixos de um retângulo girado em torno de (x, y) — a origem de rotação do Konva. */
export function rotatedBounds(g: Geometry): { minX: number; minY: number; maxX: number; maxY: number } {
  const r = (g.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const corners: Array<[number, number]> = [[0, 0], [g.width, 0], [0, g.height], [g.width, g.height]]
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const [px, py] of corners) {
    const x = g.x + px * cos - py * sin
    const y = g.y + px * sin + py * cos
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minY = Math.min(minY, y)
    maxY = Math.max(maxY, y)
  }
  return { minX, minY, maxX, maxY }
}
```

Run: `pnpm --filter @mesa/web test -- bounds`
Expected: PASS.

- [ ] **Step 3: E2E do menu (falham)**

Em `e2e/table.spec.ts`, troque a interface `Obj` por:

```ts
interface Obj {
  id: string
  type: string
  layerId: string
  x: number
  y: number
  width: number
  height: number
  title?: string
  segments?: number[][]
  control: { mode: string; clientIds: string[] }
}
```

acrescente depois de `openLayerMenu`:

```ts
async function openObjectMenu(page: Page, obj: Obj) {
  await page.mouse.click(obj.x + obj.width / 2, obj.y + obj.height / 2, { button: 'right' })
  const menu = page.getByRole('dialog', { name: 'Menu do objeto' })
  await expect(menu).toBeVisible()
  return menu
}

async function dragObject(page: Page, obj: Obj, dx: number, dy: number): Promise<void> {
  const cx = obj.x + obj.width / 2
  const cy = obj.y + obj.height / 2
  await page.mouse.move(cx, cy)
  await page.mouse.down()
  await page.mouse.move(cx + dx, cy + dy, { steps: 10 })
  await page.mouse.up()
}
```

e acrescente no fim:

```ts
test('título aparece para o jogador; anotação do mestre não chega a ele', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [token] = await objects(gm)

  const menu = await openObjectMenu(gm, token)
  await menu.getByLabel('Título').fill('Goblin')
  await menu.getByLabel('Título').press('Enter')
  await menu.getByLabel('Anotação do mestre').fill('tem 3 PV')
  await menu.getByLabel('Anotação do mestre').blur()

  await expect.poll(async () => (await objects(player))[0].title).toBe('Goblin')
  await expect.poll(() => gm.evaluate(() => (window as any).__mesa.getState().notes)).toEqual({ [token.id]: 'tem 3 PV' })
  await player.waitForTimeout(500)
  const playerState = await player.evaluate(() => {
    const s = (window as any).__mesa.getState()
    return JSON.stringify({ objects: s.objects, notes: s.notes })
  })
  expect(playerState).not.toContain('tem 3 PV')
})

test('mestre move token da camada Mestre para Tokens; jogador passa a vê-lo no mesmo lugar', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await selectLayer(gm, 'Mestre')
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.waitForTimeout(500)
  expect(await objects(player)).toHaveLength(0)

  const [token] = await objects(gm)
  const menu = await openObjectMenu(gm, token)
  await menu.getByRole('button', { name: 'Mover para camada' }).click()
  await expect(menu.getByRole('button', { name: 'Mestre', exact: true })).toHaveCount(0) // a atual não aparece
  await menu.getByRole('button', { name: 'Tokens', exact: true }).click()
  await expect(menu).toHaveCount(0)

  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [seen] = await objects(player)
  expect(seen).toMatchObject({ id: token.id, layerId: 'tokens', x: token.x, y: token.y, width: token.width, height: token.height })
})

test('token "só o mestre": o arrasto do jogador não move o token na tela do mestre', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [token] = await objects(gm)

  // Primeiro libera para todos e confirma que o arrasto do jogador funciona…
  let menu = await openObjectMenu(gm, token)
  await menu.getByLabel('Todos').check()
  await gm.keyboard.press('Escape')
  await expect.poll(async () => (await objects(player))[0].control.mode).toBe('all')
  await dragObject(player, token, 100, 0)
  await expect.poll(async () => Math.round((await objects(gm))[0].x)).toBe(Math.round(token.x + 100))

  // …depois restringe ao mestre: o arrasto do jogador não tem efeito.
  const [moved] = await objects(gm)
  menu = await openObjectMenu(gm, moved)
  await menu.getByLabel('Só o mestre').check()
  await gm.keyboard.press('Escape')
  await expect.poll(async () => (await objects(player))[0].control.mode).toBe('gm')
  await dragObject(player, moved, 0, 120)
  await player.waitForTimeout(500)
  expect(Math.round((await objects(gm))[0].y)).toBe(Math.round(moved.y))
  expect(Math.round((await objects(player))[0].y)).toBe(Math.round(moved.y))
})
```

Run: `pnpm e2e -g "título|Mover|só o mestre"` (portas conferidas como na Task 10)
Expected: FAIL (o menu não existe).

- [ ] **Step 4: Estado e ações**

Em `apps/web/src/store/state.ts`, acrescente depois de `interface StrokePreview { … }`:

```ts
export interface ObjectMenu {
  objectId: string
  /** Posição do clique na tela (clientX/clientY). */
  x: number
  y: number
}
```

em `TableState`, depois de `selectedId: string | null`:

```ts
  objectMenu: ObjectMenu | null
```

e em `makeInitialState()`, depois de `selectedId: null,`:

```ts
    objectMenu: null,
```

Em `apps/web/src/store/tableStore.ts`:
- troque a linha `import { DEFAULT_LAYER_NAME } from '@mesa/shared'` por `import { DEFAULT_LAYER_NAME, canControl } from '@mesa/shared'`;
- na interface `TableActions`, depois de `select(id: string | null): void`:

```ts
  openObjectMenu(objectId: string, x: number, y: number): void
  closeObjectMenu(): void
  moveObjectToLayer(objectId: string, layerId: string): void
```

- no objeto `actions`, depois de `select: …,`:

```ts
      openObjectMenu(objectId, x, y) {
        const s = get()
        const object = s.objects[objectId]
        // Jogador que não controla o objeto: o menu não abre.
        if (!object || !s.self || !canControl(object, s.self.clientId, s.self.role)) return
        set({ objectMenu: { objectId, x, y }, selectedId: objectId })
      },
      closeObjectMenu: () => set({ objectMenu: null }),
      moveObjectToLayer(objectId, layerId) {
        // Só layerId e zIndex (topo da camada de destino): posição e tamanho ficam iguais.
        actions.submit({ kind: 'update', id: objectId, patch: { layerId, zIndex: actions.nextZ(layerId) } })
        set({ selectedId: null })
      },
```

- [ ] **Step 5: Nós do canvas respeitam o controle**

Substitua `apps/web/src/canvas/ImageNode.tsx` por:

```tsx
import { Image as KonvaImage } from 'react-konva'
import useImage from 'use-image'
import { canControl, type ImageObject } from '@mesa/shared'
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
  const mayControl = useTable((s) => !!s.self && canControl(object, s.self.clientId, s.self.role))
  const g = lockedByOther && preview ? preview : object
  const interactive = tool === 'select' && !lockedByOther && mayControl

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

Substitua `apps/web/src/canvas/StrokeNode.tsx` por:

```tsx
import { Group, Line } from 'react-konva'
import { canControl, type StrokeObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { commitNodeChange } from './nodeChange'

export function StrokeNode({ object }: { object: StrokeObject }) {
  const store = useTableStore()
  const actions = useTableActions()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const mayControl = useTable((s) => !!s.self && canControl(object, s.self.clientId, s.self.role))
  const pos = lockedByOther && preview ? preview : object
  const interactive = tool === 'select' && !lockedByOther && mayControl

  // Um Group com uma Line por pedaço: clique e arrasto valem para o traço inteiro.
  return (
    <Group
      id={object.id}
      name="object stroke"
      x={pos.x}
      y={pos.y}
      draggable={interactive}
      onMouseDown={() => {
        if (interactive) actions.select(object.id)
      }}
      onDragStart={() => actions.grab(object.id)}
      onDragMove={(e) =>
        actions.dragPreview(object.id, { x: e.target.x(), y: e.target.y(), width: object.width, height: object.height, rotation: 0 })
      }
      onDragEnd={(e) => commitNodeChange(store, object.id, e.target, 'drag')}
    >
      {object.segments.map((points, i) => (
        <Line
          key={i}
          points={points}
          stroke={object.color}
          strokeWidth={object.strokeWidth}
          hitStrokeWidth={Math.max(object.strokeWidth, 12)}
          lineCap="round"
          lineJoin="round"
        />
      ))}
    </Group>
  )
}
```

Em `apps/web/src/canvas/SelectionTransformer.tsx`, troque as linhas 1-18 (imports até o fim do cálculo de `targetId`) por:

```tsx
import { useEffect, useRef } from 'react'
import type Konva from 'konva'
import { Transformer } from 'react-konva'
import { canControl } from '@mesa/shared'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'

export function SelectionTransformer() {
  const ref = useRef<Konva.Transformer>(null)
  const object = useTable((s) => (s.selectedId ? s.objects[s.selectedId] : undefined))
  const tool = useTable((s) => s.tool)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const lockedByOther = useTable((s) => (s.selectedId ? isLockedByOther(s, s.selectedId, Date.now()) : false))
  const mayControl = useTable((s) => {
    const o = s.selectedId ? s.objects[s.selectedId] : undefined
    return !!o && !!s.self && canControl(o, s.self.clientId, s.self.role)
  })

  // Só imagens redimensionam/giram; traços apenas se movem.
  const targetId =
    object && object.type === 'image' && object.layerId === activeLayerId && tool === 'select' && !lockedByOther && mayControl
      ? object.id
      : null
```

(o restante do arquivo — `useEffect` e o `<Transformer keepRatio shiftBehavior="inverted" …>` — não muda).

- [ ] **Step 6: Título e glifo de anotação**

Crie `apps/web/src/canvas/ObjectDecorations.tsx`:

```tsx
import { Group, Line, Rect, Text } from 'react-konva'
import type { TableObject } from '@mesa/shared'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { rotatedBounds } from './bounds'

const TITLE_FONT_PX = 13
const TITLE_BOX_PX = 320
const NOTE_ICON_PX = 14

/** Título (todos) e glifo de "nota adesiva" (só mestre), com tamanho fixo na tela. */
export function ObjectDecorations({ object }: { object: TableObject }) {
  const scale = useTable((s) => s.viewport.scale)
  const showNote = useTable((s) => s.self?.role === 'gm' && !!s.notes[object.id])
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  if (!object.title && !showNote) return null

  const g = lockedByOther && preview ? preview : object
  const box = rotatedBounds(g)
  const k = 1 / scale

  return (
    <Group listening={false}>
      {object.title && (
        <Text
          text={object.title}
          x={(box.minX + box.maxX) / 2 - (TITLE_BOX_PX * k) / 2}
          y={box.maxY + 4 * k}
          width={TITLE_BOX_PX * k}
          align="center"
          wrap="none"
          ellipsis
          fontSize={TITLE_FONT_PX * k}
          fill="#ffffff"
          stroke="#111111"
          strokeWidth={3 * k}
          fillAfterStrokeEnabled
        />
      )}
      {showNote && (
        <Group x={box.maxX - (NOTE_ICON_PX * k) / 2} y={box.minY - (NOTE_ICON_PX * k) / 2} scaleX={k} scaleY={k}>
          <Rect width={NOTE_ICON_PX} height={NOTE_ICON_PX} cornerRadius={2} fill="#ffd43b" stroke="#5c4500" strokeWidth={1} />
          <Line points={[4, 5, 10, 5]} stroke="#5c4500" strokeWidth={1} />
          <Line points={[4, 8, 10, 8]} stroke="#5c4500" strokeWidth={1} />
        </Group>
      )}
    </Group>
  )
}
```

- [ ] **Step 7: Canvas — menu de contexto, opacidade e decorações**

Substitua `apps/web/src/canvas/TableCanvas.tsx` por:

```tsx
import { useMemo } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Layer, Line, Stage } from 'react-konva'
import type { TableObject } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { useModifierKeys, useWindowSize } from './hooks'
import { ImageNode } from './ImageNode'
import { ObjectDecorations } from './ObjectDecorations'
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
  const penMode = useTable((s) => s.penMode)
  const viewport = useTable((s) => s.viewport)
  const activeLayerId = useTable((s) => s.activeLayerId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const { space } = useModifierKeys()
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

  // O menu do navegador fica desativado sobre o canvas; sobre um objeto, abre o nosso.
  const onContextMenu = (e: KonvaEventObject<PointerEvent>) => {
    e.evt.preventDefault()
    if (panning) return
    const node = e.target.findAncestor('.object', true)
    if (node) actions.openObjectMenu(node.id(), e.evt.clientX, e.evt.clientY)
  }

  const cursor = panning ? 'grab' : tool === 'pencil' ? (penMode === 'erase' ? 'cell' : 'crosshair') : 'default'

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
      onContextMenu={onContextMenu}
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
        const list = byLayer[layer.id] ?? []
        return (
          <Layer key={layer.id} listening={active && !panning} opacity={isGm && layer.visibility === 'gm' ? 0.5 : 1}>
            {list.map((o) =>
              o.type === 'image' ? <ImageNode key={o.id} object={o} /> : <StrokeNode key={o.id} object={o} />,
            )}
            {list.map((o) => (
              <ObjectDecorations key={`deco_${o.id}`} object={o} />
            ))}
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
            {active && <SelectionTransformer />}
          </Layer>
        )
      })}
      <Overlay />
    </Stage>
  )
}
```

- [ ] **Step 8: Menu de contexto**

Crie `apps/web/src/ui/ObjectContextMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Layers, StickyNote, Trash2 } from 'lucide-react'
import {
  MAX_CONTROL_IDS,
  NOTE_MAX,
  TITLE_MAX,
  canControl,
  type Control,
  type ObjectPatch,
  type TableObject,
} from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { floatingStyle, useDismiss } from './useDismiss'

const MODES: Array<{ mode: Control['mode']; label: string }> = [
  { mode: 'all', label: 'Todos' },
  { mode: 'gm', label: 'Só o mestre' },
  { mode: 'list', label: 'Jogadores escolhidos' },
]

export function ObjectContextMenu() {
  const menu = useTable((s) => s.objectMenu)
  const object = useTable((s) => (s.objectMenu ? s.objects[s.objectMenu.objectId] : undefined))
  const allowed = useTable((s) => {
    const o = s.objectMenu ? s.objects[s.objectMenu.objectId] : undefined
    return !!o && !!s.self && canControl(o, s.self.clientId, s.self.role)
  })
  const actions = useTableActions()

  // Objeto apagado (ou controle perdido) com o menu aberto: o menu fecha.
  useEffect(() => {
    if (menu && (!object || !allowed)) actions.closeObjectMenu()
  }, [menu, object, allowed, actions])

  if (!menu || !object || !allowed) return null
  return <ObjectMenuBody key={object.id} object={object} x={menu.x} y={menu.y} onClose={actions.closeObjectMenu} />
}

function ObjectMenuBody({ object, x, y, onClose }: { object: TableObject; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const update = (patch: ObjectPatch) => actions.submit({ kind: 'update', id: object.id, patch })

  return (
    <div
      ref={ref}
      className="panel popover floating context-menu"
      role="dialog"
      aria-label="Menu do objeto"
      style={floatingStyle(x, y, 260)}
    >
      <TitleField title={object.title} onSave={(title) => update({ title })} />
      {isGm && <PermissionsField objectId={object.id} control={object.control} onChange={(control) => update({ control })} />}
      {isGm && <NoteField objectId={object.id} />}
      {isGm && <MoveToLayer object={object} onMoved={onClose} />}
      <button
        className="danger"
        onClick={() => {
          actions.submit({ kind: 'delete', id: object.id })
          onClose()
        }}
      >
        <Trash2 size={16} aria-hidden /> Apagar
      </button>
    </div>
  )
}

function TitleField({ title, onSave }: { title: string | undefined; onSave: (title: string | null) => void }) {
  const current = title ?? ''
  return (
    <label className="field">
      Título
      <input
        defaultValue={current}
        maxLength={TITLE_MAX}
        placeholder="Sem título"
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
        }}
        onBlur={(e) => {
          const value = e.currentTarget.value.trim().slice(0, TITLE_MAX)
          if (value === current) return
          onSave(value === '' ? null : value) // vazio remove o título
        }}
      />
    </label>
  )
}

function PermissionsField({
  objectId,
  control,
  onChange,
}: {
  objectId: string
  control: Control
  onChange: (control: Control) => void
}) {
  const members = useTable((s) => s.members)
  const players = Object.values(members)
    .filter((m) => m.role === 'player')
    .sort((a, b) => a.nickname.localeCompare(b.nickname))
  const toggle = (clientId: string) => {
    const clientIds = control.clientIds.includes(clientId)
      ? control.clientIds.filter((id) => id !== clientId)
      : [...control.clientIds, clientId].slice(-MAX_CONTROL_IDS)
    onChange({ mode: 'list', clientIds })
  }

  return (
    <fieldset className="field">
      <legend>Permissões</legend>
      {MODES.map((m) => (
        <label key={m.mode}>
          <input
            type="radio"
            name={`control-${objectId}`}
            checked={control.mode === m.mode}
            onChange={() => onChange({ mode: m.mode, clientIds: control.clientIds })}
          />
          {m.label}
        </label>
      ))}
      {players.map((p) => (
        <label key={p.clientId} className="indent">
          <input
            type="checkbox"
            disabled={control.mode !== 'list'}
            checked={control.clientIds.includes(p.clientId)}
            onChange={() => toggle(p.clientId)}
          />
          {p.nickname}
        </label>
      ))}
      {players.length === 0 && <small>Nenhum jogador na lista</small>}
    </fieldset>
  )
}

function NoteField({ objectId }: { objectId: string }) {
  const current = useTable((s) => s.notes[objectId] ?? '')
  const actions = useTableActions()
  return (
    <label className="field">
      <span className="row">
        <StickyNote size={14} aria-hidden /> Anotação do mestre
      </span>
      <textarea
        defaultValue={current}
        maxLength={NOTE_MAX}
        rows={3}
        onBlur={(e) => {
          const text = e.currentTarget.value
          if (text !== current) actions.submit({ kind: 'noteSet', objectId, text })
        }}
      />
    </label>
  )
}

function MoveToLayer({ object, onMoved }: { object: TableObject; onMoved: () => void }) {
  const [open, setOpen] = useState(false)
  const layers = useTable((s) => s.layers)
  const actions = useTableActions()
  // da mais alta para a mais baixa, sem a camada atual
  const targets = [...layers].reverse().filter((l) => l.id !== object.layerId)

  return (
    <div className="field">
      <button aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Layers size={16} aria-hidden /> Mover para camada <ChevronRight size={14} aria-hidden />
      </button>
      {open && (
        <div className="submenu" role="group" aria-label="Camadas de destino">
          {targets.map((layer) => (
            <button
              key={layer.id}
              onClick={() => {
                actions.moveObjectToLayer(object.id, layer.id)
                onMoved()
              }}
            >
              {layer.name}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
```

Em `apps/web/src/ui/TablePage.tsx`, acrescente o import:

```ts
import { ObjectContextMenu } from './ObjectContextMenu'
```

e, logo depois de `<LayersPanel />`, acrescente:

```tsx
      <ObjectContextMenu />
```

Acrescente no fim de `apps/web/src/styles.css`:

```css
.context-menu { max-height: calc(100vh - 24px); overflow: auto; }
.submenu { display: grid; gap: 4px; padding-left: 12px; margin-top: 4px; }
.indent { padding-left: 18px; }
```

- [ ] **Step 9: Rodar**

Run: `pnpm --filter @mesa/web typecheck && pnpm --filter @mesa/web test`
Expected: PASS.

Run: `pnpm e2e`
Expected: todos passam, incluindo os 3 novos.

- [ ] **Step 10: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: verde.

---

### Task 13: Web — borracha "por onde passa"

**Files:**
- Create: `apps/web/src/canvas/eraser.ts`
- Create: `apps/web/test/eraser.test.ts`
- Modify: `apps/web/src/canvas/useDrawingTools.ts` (arquivo inteiro)
- Modify: `apps/web/src/canvas/StrokeNode.tsx` (prop `segments`)
- Modify: `apps/web/src/canvas/TableCanvas.tsx` (passa a prévia ao `StrokeNode`)
- Modify: `e2e/table.spec.ts` (teste novo)

**Interfaces:**
- Consumes: `eraseSegments`, `pathTouchesBox`, `simplifyPoints`, `boundsOf`, `canControl`, `ERASER_MIN_SIZE`, `MAX_SEGMENTS`, `MAX_SEGMENT_NUMBERS` (Tasks 1–2); `submitGroup` (Task 9); `penMode`, `eraseAll` (Task 10); `isLockedByOther` (existente).
- Produces:
  - `erasableBy(object: TableObject, selfId: string, role: Role, eraseAll: boolean): boolean`
  - `eraserRadius(penWidth: number, scale: number): number` = `max(8, penWidth) / 2 / scale`
  - `rebaseSegments(segments: number[][], originX: number, originY: number): { segments: number[][]; x: number; y: number; width: number; height: number }`
  - `fitSegmentLimits(segments: number[][], tolerance: number): number[][]` — no máx. 200 pedaços (fica com os de mais pontos, na ordem original) e 20 000 números (dobra a tolerância do RDP até caber)
  - `interface EraseInput { objects: TableObject[]; layerId: string; path: number[]; selfId: string; role: Role; eraseAll: boolean; penWidth: number; scale: number; isLocked: (id: string) => boolean }`
  - `planErase(input: EraseInput): { previews: Record<string, number[][]>; ops: Op[] }` — `path` em coordenadas do mundo
  - `useDrawingTools()` devolve também `erasePreview: Record<string, number[][]>`
  - `StrokeNode({ object, segments? })` — `segments` substitui os do objeto (prévia local); `[]` não desenha nada

- [ ] **Step 1: Testes puros (falham)**

Crie `apps/web/test/eraser.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { MAX_SEGMENTS, MAX_SEGMENT_NUMBERS, type TableObject } from '@mesa/shared'
import { erasableBy, eraserRadius, fitSegmentLimits, planErase, rebaseSegments, type EraseInput } from '../src/canvas/eraser'

const stroke = (over: Partial<TableObject> = {}): TableObject =>
  ({
    id: 's1', type: 'stroke', layerId: 'drawings', x: 100, y: 100, width: 100, height: 0, rotation: 0, zIndex: 1,
    segments: [[0, 0, 100, 0]], color: '#ffffff', strokeWidth: 2,
    ownerId: 'me', version: 1, updatedBy: 'me', control: { mode: 'list', clientIds: ['me'] },
    ...over,
  }) as TableObject

const input = (over: Partial<EraseInput> = {}): EraseInput => ({
  objects: [stroke()],
  layerId: 'drawings',
  path: [150, 80, 150, 120],
  selfId: 'me',
  role: 'player',
  eraseAll: false,
  penWidth: 4,
  scale: 1,
  isLocked: () => false,
  ...over,
})

describe('eraserRadius', () => {
  it('max(8, espessura) / 2 em pixels de tela, dividido pelo zoom', () => {
    expect(eraserRadius(4, 1)).toBe(4)
    expect(eraserRadius(20, 1)).toBe(10)
    expect(eraserRadius(4, 2)).toBe(2)
  })
})

describe('erasableBy', () => {
  it('jogador apaga só traços que controla; nunca imagens', () => {
    expect(erasableBy(stroke(), 'me', 'player', false)).toBe(true)
    expect(erasableBy(stroke({ control: { mode: 'list', clientIds: ['other'] } }), 'me', 'player', false)).toBe(false)
    expect(erasableBy(stroke({ control: { mode: 'all', clientIds: [] } }), 'me', 'player', false)).toBe(true)
    const image = { ...stroke(), type: 'image', assetKey: 'a'.repeat(64) } as unknown as TableObject
    expect(erasableBy(image, 'me', 'player', false)).toBe(false)
  })

  it('mestre: "só os meus" usa ownerId; "de todos" apaga qualquer traço', () => {
    const others = stroke({ ownerId: 'p1' })
    expect(erasableBy(others, 'gm1', 'gm', false)).toBe(false)
    expect(erasableBy(stroke({ ownerId: 'gm1' }), 'gm1', 'gm', false)).toBe(true)
    expect(erasableBy(others, 'gm1', 'gm', true)).toBe(true)
  })
})

describe('rebaseSegments', () => {
  it('recalcula caixa e pontos relativos', () => {
    expect(rebaseSegments([[0, 0, 44, 0], [56, 0, 100, 10]], 100, 100)).toEqual({
      segments: [[0, 0, 44, 0], [56, 0, 100, 10]],
      x: 100, y: 100, width: 100, height: 10,
    })
    expect(rebaseSegments([[10, 5, 20, 5]], 100, 100)).toEqual({ segments: [[0, 0, 10, 0]], x: 110, y: 105, width: 10, height: 0 })
  })
})

describe('planErase', () => {
  it('passada no meio gera update com 2 pedaços e caixa recalculada', () => {
    // raio 4 + metade da espessura 1 = 5; passo 2 → some x ∈ [46, 54]
    const plan = planErase(input())
    expect(plan.ops).toEqual([
      { kind: 'update', id: 's1', patch: { segments: [[0, 0, 44, 0], [56, 0, 100, 0]], x: 100, y: 100, width: 100, height: 0 } },
    ])
    expect(plan.previews.s1).toEqual([[0, 0, 44, 0], [56, 0, 100, 0]])
  })

  it('cobrindo tudo vira delete com prévia vazia', () => {
    const plan = planErase(input({ path: [90, 100, 210, 100] }))
    expect(plan.ops).toEqual([{ kind: 'delete', id: 's1' }])
    expect(plan.previews.s1).toEqual([])
  })

  it('ignora traço travado por outra pessoa, de outra camada, que não controla ou longe', () => {
    expect(planErase(input({ isLocked: () => true })).ops).toEqual([])
    expect(planErase(input({ layerId: 'tokens' })).ops).toEqual([])
    expect(planErase(input({ objects: [stroke({ control: { mode: 'gm', clientIds: [] } })] })).ops).toEqual([])
    expect(planErase(input({ path: [500, 500, 600, 600] }))).toEqual({ previews: {}, ops: [] })
  })
})

// Review Focus #1
describe('fitSegmentLimits', () => {
  it('fica com os 200 pedaços de mais pontos, na ordem original', () => {
    const short = Array.from({ length: 200 }, (_, i) => [i, 0, i, 1])
    const long = Array.from({ length: 50 }, (_, i) => [i, 5, i, 6, i + 0.5, 7])
    const mixed = [...long.slice(0, 25), ...short, ...long.slice(25)]
    const out = fitSegmentLimits(mixed, 1)
    expect(out).toHaveLength(MAX_SEGMENTS)
    expect(out.filter((s) => s.length === 6)).toHaveLength(50)
    expect(out[0]).toBe(mixed[0])
  })

  it('simplifica mais forte até caber em 20 000 números', () => {
    const zigzag: number[] = []
    for (let i = 0; i < 12_500; i++) zigzag.push(i, i % 2) // 25 000 números, desvio 1
    const out = fitSegmentLimits([zigzag], 0.5)
    expect(out.reduce((n, s) => n + s.length, 0)).toBeLessThanOrEqual(MAX_SEGMENT_NUMBERS)
    expect(out[0].slice(0, 2)).toEqual([0, 0])
  })

  it('não mexe no que já cabe', () => {
    const ok = [[0, 0, 1, 1]]
    expect(fitSegmentLimits(ok, 1)).toBe(ok)
  })
})
```

Run: `pnpm --filter @mesa/web test -- eraser`
Expected: FAIL — módulo não existe.

- [ ] **Step 2: Implementar `eraser.ts`**

Crie `apps/web/src/canvas/eraser.ts`:

```ts
import {
  ERASER_MIN_SIZE,
  MAX_SEGMENTS,
  MAX_SEGMENT_NUMBERS,
  boundsOf,
  canControl,
  eraseSegments,
  pathTouchesBox,
  simplifyPoints,
  type Op,
  type Role,
  type TableObject,
} from '@mesa/shared'

/** Quem apaga o quê (spec §4.1). Travas e camada são checadas em planErase. */
export function erasableBy(object: TableObject, selfId: string, role: Role, eraseAll: boolean): boolean {
  if (object.type !== 'stroke') return false
  if (role === 'gm') return eraseAll || object.ownerId === selfId
  return canControl(object, selfId, role)
}

/** Raio em unidades do mundo: max(8, espessura) / 2 pixels de tela, dividido pelo zoom. */
export function eraserRadius(penWidth: number, scale: number): number {
  return Math.max(ERASER_MIN_SIZE, penWidth) / 2 / scale
}

export function rebaseSegments(
  segments: number[][],
  originX: number,
  originY: number,
): { segments: number[][]; x: number; y: number; width: number; height: number } {
  const world = segments.map((seg) => seg.map((v, i) => v + (i % 2 === 0 ? originX : originY)))
  const b = boundsOf(world.flat())
  return {
    segments: world.map((seg) => seg.map((v, i) => v - (i % 2 === 0 ? b.minX : b.minY))),
    x: b.minX,
    y: b.minY,
    width: b.width,
    height: b.height,
  }
}

/** Garante os limites do schema (200 pedaços, 20 000 números) para o update nunca virar `invalid`. */
export function fitSegmentLimits(segments: number[][], tolerance: number): number[][] {
  let out = segments
  if (out.length > MAX_SEGMENTS) {
    const keep = new Set(
      out
        .map((s, i) => [s.length, i] as const)
        .sort((a, b) => b[0] - a[0] || a[1] - b[1])
        .slice(0, MAX_SEGMENTS)
        .map(([, i]) => i),
    )
    out = out.filter((_, i) => keep.has(i))
  }
  let tol = tolerance
  while (out.reduce((n, s) => n + s.length, 0) > MAX_SEGMENT_NUMBERS) {
    tol *= 2
    out = out.map((s) => simplifyPoints(s, tol))
  }
  return out
}

export interface EraseInput {
  objects: TableObject[]
  layerId: string
  /** Caminho da borracha em coordenadas do mundo. */
  path: number[]
  selfId: string
  role: Role
  eraseAll: boolean
  penWidth: number
  scale: number
  isLocked: (id: string) => boolean
}

export function planErase(input: EraseInput): { previews: Record<string, number[][]>; ops: Op[] } {
  const radius = eraserRadius(input.penWidth, input.scale)
  const tolerance = 1 / input.scale
  const previews: Record<string, number[][]> = {}
  const ops: Op[] = []
  for (const o of input.objects) {
    if (o.type !== 'stroke' || o.layerId !== input.layerId) continue
    if (!erasableBy(o, input.selfId, input.role, input.eraseAll) || input.isLocked(o.id)) continue
    if (!pathTouchesBox(input.path, radius + o.strokeWidth / 2, o)) continue
    const local = input.path.map((v, i) => v - (i % 2 === 0 ? o.x : o.y))
    const cut = eraseSegments(o.segments, local, radius, o.strokeWidth, tolerance)
    if (cut === o.segments) continue
    const result = fitSegmentLimits(cut, tolerance)
    previews[o.id] = result
    ops.push(result.length === 0 ? { kind: 'delete', id: o.id } : { kind: 'update', id: o.id, patch: rebaseSegments(result, o.x, o.y) })
  }
  return { previews, ops }
}
```

Run: `pnpm --filter @mesa/web test -- eraser`
Expected: PASS.

- [ ] **Step 3: E2E da borracha (falha)**

Acrescente no fim de `e2e/table.spec.ts`:

```ts
test('passada de borracha no meio de uma linha deixa 2 pedaços na tela do outro', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await selectLayer(player, 'Desenhos')
  await player.getByRole('button', { name: 'Lápis (P)' }).click()
  await player.mouse.move(300, 300)
  await player.mouse.down()
  await player.mouse.move(600, 300, { steps: 10 })
  await player.mouse.up()
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(1)

  await player.keyboard.press('e')
  await expect(player.getByRole('button', { name: 'Borracha (E)' })).toBeVisible()
  await player.mouse.move(450, 250)
  await player.mouse.down()
  await player.mouse.move(450, 350, { steps: 10 })
  await player.mouse.up()

  await expect.poll(async () => (await objects(gm)).find((o) => o.type === 'stroke')?.segments?.length).toBe(2)
})
```

Run: `pnpm e2e -g "borracha"` (portas conferidas como na Task 10)
Expected: FAIL (o modo apagar não faz nada).

- [ ] **Step 4: Integrar no canvas**

Substitua `apps/web/src/canvas/useDrawingTools.ts` por:

```ts
import { useEffect, useMemo, useRef, useState } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { nanoid } from 'nanoid'
import { MAX_SEGMENT_NUMBERS, boundsOf, simplifyPoints } from '@mesa/shared'
import { throttle } from '../lib/throttle'
import { useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { planErase } from './eraser'

interface OwnPreview {
  layerId: string
  points: number[]
  color: string
  strokeWidth: number
}

export function useDrawingTools() {
  const store = useTableStore()
  const [ownPreview, setOwnPreview] = useState<OwnPreview | null>(null)
  const [erasePreview, setErasePreview] = useState<Record<string, number[][]>>({})
  const current = useRef<{ strokeId: string; layerId: string; points: number[]; unsent: number[] } | null>(null)
  const erasing = useRef<{ layerId: string; path: number[] } | null>(null)
  const frame = useRef<number | null>(null)

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

  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  // Corte sempre sobre a versão local atual dos traços (vale a última escrita).
  const plan = () => {
    const cur = erasing.current
    const s = store.getState()
    if (!cur || !s.self) return { previews: {}, ops: [] }
    const now = Date.now()
    return planErase({
      objects: Object.values(s.objects),
      layerId: cur.layerId,
      path: cur.path,
      selfId: s.self.clientId,
      role: s.self.role,
      eraseAll: s.eraseAll,
      penWidth: s.strokeWidth,
      scale: s.viewport.scale,
      isLocked: (id) => isLockedByOther(s, id, now),
    })
  }

  // Prévia local no máximo uma vez por quadro.
  const scheduleErasePreview = () => {
    if (frame.current !== null) return
    frame.current = requestAnimationFrame(() => {
      frame.current = null
      if (erasing.current) setErasePreview(plan().previews)
    })
  }

  const finishErase = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const { ops } = plan()
    erasing.current = null
    setErasePreview({})
    // Lote único: vira um só grupo de desfazer.
    if (ops.length > 0) store.getState().actions.submitGroup(ops)
  }

  const onDown = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool !== 'pencil' || e.evt.button !== 0) return
    if (s.status !== 'open' || !s.actions.canEditLayer(s.activeLayerId)) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    if (s.penMode === 'erase') {
      erasing.current = { layerId: s.activeLayerId, path: [pos.x, pos.y] }
      scheduleErasePreview()
      return
    }
    current.current = { strokeId: nanoid(), layerId: s.activeLayerId, points: [pos.x, pos.y], unsent: [pos.x, pos.y] }
    setOwnPreview({ layerId: s.activeLayerId, points: [pos.x, pos.y], color: s.color, strokeWidth: s.strokeWidth })
    flushPreview()
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    const er = erasing.current
    if (er) {
      er.path.push(pos.x, pos.y)
      scheduleErasePreview()
      return
    }
    const cur = current.current
    if (!cur) return
    cur.points.push(pos.x, pos.y)
    cur.unsent.push(pos.x, pos.y)
    setOwnPreview((p) => (p ? { ...p, points: [...cur.points] } : p))
    flushPreview()
  }

  const onUp = () => {
    if (erasing.current) {
      finishErase()
      return
    }
    const cur = current.current
    if (!cur) return
    current.current = null
    flushPreview.flush()
    setOwnPreview(null)
    const s = store.getState()
    s.actions.sendPresence({ kind: 'strokeEnd', strokeId: cur.strokeId })

    let points = simplifyPoints(cur.points, 1 / s.viewport.scale)
    if (points.length < 4) points = [points[0], points[1], points[0] + 0.01, points[1]]
    if (points.length > MAX_SEGMENT_NUMBERS) {
      points = simplifyPoints(points, 4 / s.viewport.scale).slice(0, MAX_SEGMENT_NUMBERS)
    }
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
        segments: [points.map((v, i) => (i % 2 === 0 ? v - b.minX : v - b.minY))],
        color: s.color,
        strokeWidth: s.strokeWidth,
      },
    })
  }

  return { ownPreview, erasePreview, onDown, onMove, onUp }
}
```

Em `apps/web/src/canvas/StrokeNode.tsx`:
- troque a assinatura por:

```tsx
export function StrokeNode({ object, segments }: { object: StrokeObject; segments?: number[][] }) {
```

- logo antes do `return (`, acrescente:

```tsx
  // Prévia local da borracha sobrepõe o traço original; [] = apagado por inteiro.
  const shown = segments ?? object.segments
  if (shown.length === 0) return null
```

- troque `{object.segments.map((points, i) => (` por `{shown.map((points, i) => (`.

Em `apps/web/src/canvas/TableCanvas.tsx`, troque a renderização dos nós:

```tsx
            {list.map((o) =>
              o.type === 'image' ? <ImageNode key={o.id} object={o} /> : <StrokeNode key={o.id} object={o} />,
            )}
```

por:

```tsx
            {list.map((o) =>
              o.type === 'image' ? (
                <ImageNode key={o.id} object={o} />
              ) : (
                <StrokeNode key={o.id} object={o} segments={drawing.erasePreview[o.id]} />
              ),
            )}
```

- [ ] **Step 5: Rodar**

Run: `pnpm --filter @mesa/web typecheck && pnpm --filter @mesa/web test`
Expected: PASS.

Run: `pnpm e2e`
Expected: todos passam, incluindo a borracha.

- [ ] **Step 6: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: verde.

---

### Task 14: Web — painel de membros, README e verificação final

**Files:**
- Modify: `apps/web/src/ui/MembersPanel.tsx` (arquivo inteiro)
- Modify: `README.md` (seção de desenvolvimento)
- Modify: `e2e/table.spec.ts` (teste novo)

**Interfaces:**
- Consumes: `memberRemove` otimista e `memberRemoved` (Task 9); snapshot filtrado em 7 dias (Task 6).
- Produces: mestre vê, ao lado de cada membro offline (que não seja ele), um botão `X` com `title="Remover da lista"` e `aria-label="Remover <apelido> da lista"`.

- [ ] **Step 1: E2E (falha)**

Acrescente no fim de `e2e/table.spec.ts`:

```ts
test('mestre remove da lista um membro offline', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const anaRow = gm.locator('.members li', { hasText: 'Ana' })

  await expect(anaRow).toBeVisible()
  await expect(gm.getByRole('button', { name: 'Remover Ana da lista' })).toHaveCount(0) // online: sem X
  await player.context().close()

  const remove = gm.getByRole('button', { name: 'Remover Ana da lista' })
  await expect(remove).toBeVisible()
  await remove.click()
  await expect(anaRow).toHaveCount(0)

  await gm.reload()
  await waitOpen(gm)
  await expect(gm.locator('.members li', { hasText: 'Mestre' })).toBeVisible()
  await expect(anaRow).toHaveCount(0)
})
```

Run: `pnpm e2e -g "remove da lista"` (portas conferidas como na Task 10)
Expected: FAIL (não há botão).

- [ ] **Step 2: Implementar**

Substitua `apps/web/src/ui/MembersPanel.tsx` por:

```tsx
import { X } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'

export function MembersPanel() {
  const members = useTable((s) => s.members)
  const selfId = useTable((s) => s.self?.clientId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  // O servidor já filtra: online ou vistos nos últimos 7 dias.
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
            {isGm && !m.online && m.clientId !== selfId && (
              <button
                className="icon-button"
                aria-label={`Remover ${m.nickname} da lista`}
                title="Remover da lista"
                onClick={() => actions.submit({ kind: 'memberRemove', clientId: m.clientId })}
              >
                <X size={14} aria-hidden />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
```

Em `README.md`, troque a linha `pnpm e2e          # ponta a ponta (sobe o servidor sozinho)` por:

```bash
pnpm e2e          # ponta a ponta: sobe um wrangler dev próprio em :8788 (E2E_PORT muda a porta),
                  # com build em apps/web/dist-e2e e estado em apps/worker/.wrangler/e2e-state —
                  # não interfere num `pnpm host` rodando na 8787
```

- [ ] **Step 3: Verificação final**

Run: `pnpm typecheck && pnpm test`
Expected: verde em shared, worker e web.

Run (portas conferidas como na Task 10): `pnpm e2e`
Expected: todos os testes passam — os 4 do M1 atualizados e os novos (popover da caneta, esconder/revelar camada, nova camada/subir/descer, título/anotação, mover para camada, token só do mestre, borracha, remover membro).

- [ ] **Step 4: Checkpoint**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: verde. Não rode `pnpm build`/`pnpm host`: o `apps/web/dist` do usuário só é atualizado quando ele mesmo rodar `pnpm host`.
