# Mesa Virtual — M3: Grid, Régua, Ping, Formas, Chat e Dados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar à mesa grade configurável com encaixe de imagens, régua ao vivo, ping (com centralização da câmera pelo mestre), formas (retângulo, elipse, linha), chat da mesa com imagens/GIFs e dados rolados no servidor, conversas privadas sem armazenamento e edição de apelido/cor pelo mestre.

**Architecture:** O pacote `shared` ganha módulos puros e schemas (`settings`, `grid`, `dice`, `command`, `chat`) e o protocolo do M3 (ops `settingsUpdate`/`memberUpdate`, objeto `shape`, mensagens de chat, presença de régua/ping). No Worker, o `SqlStore` guarda `settings` (linha única) e `chat` (últimas 200); o `TableEngine` aplica configurações, edição de membro, encaixe de imagens, cria entradas de chat e rola os dados com gerador injetável; o `TableDO` roteia o chat por destinatário (rolagem secreta, conversa privada só retransmitida), aplica os limites de envio e de ping e aceita GIF no upload. No front, reducers puros tratam configurações, membros, régua, ping e chat (abas, não lidas); o canvas desenha grade, régua, pings e formas; a coluna da direita ganha o painel de chat com modal de dados, imagens e abas privadas, e a lista de membros ganha menu de contexto.

**Tech Stack:** TypeScript 7, pnpm 12, Node 24, Zod 4, Cloudflare Workers + Durable Objects (SQLite) + R2, Wrangler 4.148 (`compatibility_date` 2026-08-22), Vitest (shared/web 5.x; worker 4.1 via `@cloudflare/vitest-pool-workers` 0.23 com o plugin `cloudflareTest()`), React 19, Vite 8, Konva 10.7.1 + react-konva 19.3, Zustand 5, nanoid, lucide-react 1.52, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-08-mesa-virtual-m3-design.md` (base: M2 implementado em `main` @ 667fe85; o código atual vale mais que planos antigos).

**Decisões tomadas onde o spec é omisso (o executor não deve rediscutir):**
- **Encaixe em `update`:** só os campos de geometria presentes no patch são arredondados (arrasto → `x`,`y`; transformação → `x`,`y`,`width`,`height`); `create` arredonda os quatro. Quando o servidor encaixa, o efeito leva `echo: true` e o `TableDO` manda o `op upsert` **também ao autor** (o `ack` só traz a versão; sem o eco o autor ficaria com a posição não encaixada). O cliente aplica o mesmo `snapPatch`/`snapToGrid` antes de enviar, para o objeto já cair no lugar.
- `settingsUpdated` e `memberUpdated` vão para **todas** as sessões, inclusive a do autor. `chat` (mesa) também vai ao autor; o cliente só mostra entradas que chegam por `chat` — o `chatAck` apenas limpa o pedido pendente.
- **Ping:** Shift + botão esquerdo (ou Ctrl/⌘ + botão esquerdo) no `mousedown` = ping em qualquer ferramenta, e esse clique não seleciona, não desenha e não mede. Para quadrado/círculo/45° com a ferramenta Formas, aperte Shift **depois** de começar a arrastar. Ctrl+clique de jogador também envia `recenter: true`; o servidor rebaixa (spec §10). O meu próprio ping com `recenter` não move a minha câmera.
- **Grade:** fica logo acima da camada de id `map`; se o mestre removeu essa camada, fica abaixo de todas. Não é desenhada quando o quadrado ocuparia menos de **4 px** na tela (evita pintar a tela inteira em zoom mínimo).
- O mestre configura a grade por um botão **"Grade"** (ícone `Grid3x3`) na barra de ferramentas, visível só para ele, que abre um popover com "Mostrar grade", "Tamanho do quadrado (px)" e "Encaixar imagens na grade".
- **Conversa privada:** `roll` com `secret: true` num canal privado é recusado pelo schema (`chatReject invalid`); mensagem privada para si mesmo é `invalid`. Rolagem secreta (só na aba Mesa) está disponível também para jogadores (vê o autor e os mestres).
- **Reconexão:** abas privadas e o histórico delas **continuam** no cliente (só fechar a aba ou recarregar apaga); pedidos de chat sem resposta são esquecidos; réguas e pings dos outros são limpos.
- Não lidas contam quando a aba não é a ativa **ou** o painel está recolhido; mensagens minhas nunca contam. O histórico da mesa no cliente também é limitado a 200; o das abas privadas não tem limite.
- Autor que não está mais na lista de membros (removido ou visto há mais de 7 dias) aparece como **"Alguém"**.
- O modal do dado salva a configuração em `localStorage` (`mesa:dice`) ao clicar **Rolar**.
- Menu de contexto do membro: **"Conversa privada"** (não aparece para si mesmo) e **"Editar apelido e cor"** (só mestre; vale também para o próprio mestre). Sem nenhuma opção, o menu não abre.
- Limites de envio em memória no DO, por `clientId`, janela deslizante de 1 s; tentativas recusadas não contam; pings excedentes são descartados em silêncio.
- A régua de outra aba minha (mesmo `clientId`) não é desenhada; a minha é desenhada a partir do estado local.
- Imagem do chat: `width`/`height` inteiros de 1 a 16 384; o servidor não confere se o arquivo existe no R2.
- `ChatEntry` é só tipo TypeScript (o servidor monta as entradas); os schemas Zod do chat validam apenas o que o cliente envia.

## Global Constraints

- **Git:** repositório no branch `main`. Cada task termina com **exatamente um** commit `feat(m3): Task N — <título>` com o trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (use `git commit -m "<assunto>" -m "Co-Authored-By: …"`). Nunca `git push`, nunca `--amend`.
- **Ao fim de cada task:** `pnpm typecheck && pnpm test` verde (a Task 13 também `pnpm e2e`).
- **Não mexa no servidor do usuário:** há um wrangler do usuário em `:8787` (worktree de rascunho). Nunca rode `pnpm build`, `pnpm host`, `pnpm dev:*`; nunca mate processos na `:8787`. O E2E é isolado: `pnpm e2e` sobe o próprio wrangler na porta **8788** (inspector 9788), com build em `apps/web/dist-e2e` e estado em `apps/worker/.wrangler/e2e-state`, `reuseExistingServer: false`. Para conferir o bundle use `pnpm build:e2e`.
- Toolchain instalada (não troque versões nem adicione dependências): pnpm 12, Node 24, TS 7, zod 4, vitest, wrangler 4.148 (compat 2026-08-22), `@cloudflare/vitest-pool-workers` 0.23 (`cloudflareTest()`; testes usam `import { exports } from 'cloudflare:workers'` e `const SELF = exports.default`), konva 10.7.1, react-konva 19.3, zustand 5, lucide-react 1.52, Playwright 1.63.
- Padrões do M2 a reutilizar: efeitos do engine + `broadcastEffect` por destinatário no `table-do.ts`; `canControl`/`canEditObject`; `reject`/`readOpId`; `hello` com `v: 2` + `clientSecret` + rotação pelo `gmSecret`; `confirmedLayers` recalculadas; desfazer em grupo (`submitGroup`); `useDismiss`/`floatingStyle`; barra Lucide; `PenPopover`; `ObjectContextMenu`; `MembersPanel`; `LayersPanel`; `prepareImage`/`uploadAsset`; `SqlStore` + `MemoryStore` + teste de contrato; `throttle`.
- Texto de interface em português; identificadores em inglês. Texto do chat **sempre** como nó de texto React (nunca `dangerouslySetInnerHTML`).
- Valores do spec (copiados):
  - `TableSettings = { grid: { enabled: boolean; size: number; snap: boolean } }`; `size` inteiro **10–500** px do mapa; padrão **`{ enabled: false, size: 70, snap: false }`**; guardado numa linha única `settings` (JSON); `snapshot.settings`; op **só do mestre** `settingsUpdate { patch: { grid?: Partial<Grid> } }`; todos recebem `settingsUpdated { settings }`.
  - Encaixe só para **imagens**; `x`,`y` → múltiplo de `size` mais próximo; `width`,`height` → múltiplo de `size`, **mínimo `size`**; rotação intacta; mudar `size`/ligar encaixe **não move** objetos existentes.
  - Grade: entre a camada `map` e a de cima; linhas de **1 px** de tela, **branco 25%**; só área visível; visível para todos quando `enabled`.
  - Régua: ferramenta `Ruler`, tecla **`R`**; clique fixa o início no **centro do quadrado** (com grade desligada usa o `size` configurado); novo clique ou **`Esc`** remove; no máximo uma por pessoa; distância `hypot(dx, dy) / size` com **uma casa e vírgula** ("4,2 q"); linha tracejada na cor do membro com rótulo **"Apelido · 4,2 q"** junto à ponta; presença `ruler { from, to }` com throttle **~33 ms** e `rulerEnd`; servidor retransmite aos outros; some ao desconectar.
  - Ping: **Shift + clique** → `ping { x, y, recenter: false }`; **Ctrl + clique do mestre** → `recenter: true` (de jogador vira `false` no servidor); quem recebe `recenter` desliza a câmera **≈400 ms** mantendo o zoom; anel na cor do membro que se expande e some em **~2 s** com o apelido; aparece também para quem pingou; **3 pings/s** por pessoa.
  - Formas: `type: 'shape'`, `kind: 'rect' | 'ellipse' | 'line'`, `stroke` `#rrggbb`, `strokeWidth` **1..30**, `fill: { color; opacity 0..1 } | null` (só rect/ellipse), `points?: [x1, y1, x2, y2]` relativos a `(x, y)` (só line). Ferramenta `Shapes`, tecla **`S`**; Shift força quadrado/círculo e linhas a **45°**; contorno/espessura vêm da caneta; botão direito na ferramenta abre popover com Retângulo `Square`, Elipse `Circle`, Linha `Minus` e preenchimento (padrão **desligado, cor do contorno, 30%**). Comportamento de objeto do M2; rect/ellipse usam o Transformer, linha só se move; borracha não age; encaixe não se aplica.
  - Chat: `ChatEntry` `message` (texto puro **1..500**) | `image` (`assetKey`, `width`, `height`) | `roll` (`request`, `result`, `secret`); `id` e `at` do servidor; **últimas 200** na tabela `chat`; `roll` secreta → só autor e mestres; snapshot inclui `chat` filtrado pelo destinatário.
  - Dados: `RollRequest { die: 4|6|8|10|12|20|100; count 1..50; bonus inteiro −100..+100; mode 'normal'|'advantage'|'disadvantage' }`, `RollResult { rolls; kept; total }`; vantagem/desvantagem só com `count === 1` (rola 2, mantém maior/menor); `crypto.getRandomValues` com rejeição contra viés de módulo; gerador injetável no engine.
  - Mensagens do cliente: `chatSend { channel, text }`, `chatImage { channel, assetKey, width, height }`, `roll { channel, request, secret }`, todas com `reqId` → `chatAck { reqId }` / `chatReject { reqId, reason: 'invalid' | 'not_found' | 'rate_limited' }`.
  - `parseCommand`: `/r NdM`, `/r NdM+B`, `/r NdM-B`, `/r dM` (N=1), sufixos `adv`/`dis`; inválido → toast **"Fórmula inválida — ex.: /r 2d6+3"** e nada é enviado.
  - Imagens no chat: botão `ImagePlus`, colar (Ctrl+V) ou arrastar para o painel; upload em `/api/tables/:id/assets` aceitando também **`image/gif`**, GIF **sem conversão**; PNG/JPEG/WebP seguem o M1 (máx. 4096 px, WebP 0,85); limite **10 MB**; miniatura até **240×240** px; clique abre overlay em tamanho real, `Esc` fecha. Falha → toast **"Falha ao enviar a imagem"** com **"Tentar novamente"**.
  - Painel do chat à direita, **entre membros e camadas**, recolhível (`MessageSquare`); abas "Mesa" + uma por conversa privada, cada uma com contador de não lidas; cada entrada com apelido na cor do membro, hora **HH:MM** e conteúdo; rolagem **"Ana rolou 1d20+5 (vantagem): [17, ~~8~~] + 5 = 22"** com descartados riscados, no d20 **20 natural verde e 1 natural vermelho**; secreta com fundo escuro e **"(só mestre)"**; Enter envia; botões `ImagePlus` e `Dices`; clique no dado rola **1d20** no canal da aba ativa; botão direito abre o modal (d4–d100, quantidade 1–50 com − e +, bônus, Normal/Vantagem/Desvantagem só com quantidade 1, "Só o mestre vê" só na aba Mesa, **Rolar**), que lembra a configuração (`localStorage`) e fecha com `Esc`/clique fora.
  - Limite de envio: **5 itens/s por pessoa somando canais**; excesso → toast **"Devagar…"**.
  - Privadas: `chatSend { channel: { dm: clientId }, text }` (idem imagem/rolagem); servidor entrega `chat { channel: { dm: <outro> }, entry }` **só** às sessões do remetente e do destinatário; mestre não participante não vê; destinatário offline → `not_found` e toast **"Fulano está offline"**; recebida sem aba → aba criada sem tirar o foco + não lidas; histórico só no cliente; fechar (`X`) ou recarregar apaga.
  - Edição pelo mestre: apelido **1–32 (trim)**, cor `#rrggbb`; `memberUpdate { clientId, patch: { nickname?, color? } }` só do mestre; grava `nicknameSetByGm`/`colorSetByGm`; todos recebem `memberUpdated { member }`; no `hello`, apelido marcado é mantido e cor marcada não é reatribuída (mesmo repetida).

## Review Focus

1. **Texto ou apelido com HTML** (`<img src=x onerror=…>`, `<b>`): aparece literalmente como texto no chat, nunca vira elemento → teste na Task 11 (`chat-entry.test.tsx`).
2. **Rajada mista em menos de 1 s** (3 mensagens na mesa + 2 privadas + 1 rolagem): os 5 primeiros são confirmados e o 6º recebe `rate_limited` ("Devagar…"), porque o limite soma os canais → teste na Task 5.
3. **Remetente com duas abas abertas** manda mensagem privada: ela aparece nas duas abas dele e nas do destinatário, e em mais ninguém → teste na Task 5.
4. **Tamanho da grade digitado fora do intervalo, decimal ou vazio** (`9`, `501`, `12.5`, ``): o campo volta ao valor atual e nada é enviado; se chegar ao servidor, `reject invalid` → testes nas Tasks 1 (schema) e 8 (`parseGridSize`).
5. **Colar ou arrastar no chat algo que não é imagem aceita** (texto, PDF, SVG): é ignorado, sem upload nem toast de erro → teste na Task 11 (`pickImageFile`).

---

## Mapa de arquivos

```
packages/shared/src/
  constants.ts   # + constantes do M3; ALLOWED_UPLOAD_TYPES + image/gif (Task 5)
  model.ts       # ColorSchema exportado (T1); objeto 'shape' (T3)
  settings.ts    # NOVO (T1): TableSettings, DEFAULT_SETTINGS, SettingsPatchSchema, mergeSettings, parseSettings
  grid.ts        # NOVO (T1): Point, Box, snapToGrid, snapPatch, cellCenter, rulerDistance, formatDistance
  dice.ts        # NOVO (T1): DIE_SIDES, RollRequestSchema, uniformInt, rollDice, formatRollFormula
  command.ts     # NOVO (T1): parseCommand
  chat.ts        # NOVO (T1): ChatChannelSchema, ChatTextSchema, ChatImageSideSchema, ChatEntry, ChatRejectReason
  protocol.ts    # T3: ops/mensagens/presença do M3, MemberPatchSchema, readChatReqId, Snapshot.settings/chat
  index.ts
packages/shared/test/  settings, grid, dice, command, chat (NOVOS); model, protocol (+M3)

apps/worker/src/
  crypto.ts              # + randomUint32 (T4)
  rate-limit.ts          # NOVO (T5)
  engine/store.ts        # + settings, chat, flags do membro (T2)
  engine/memory-store.ts # T2
  engine/sql-store.ts    # tabelas settings e chat (T2)
  engine/engine.ts       # T3 (adaptação), T4 (M3 completo)
  table-do.ts            # T4 (efeitos novos/eco), T5 (chat, presença, limites)
apps/worker/test/  store-contract, sql-store, engine, table-do, files, rate-limit (NOVO)

apps/web/src/
  store/state.ts        # T6 (settings, régua, ping, formas), T7 (chat)
  store/reducers.ts     # T3 (adaptação), T6, T7
  store/chat.ts         # NOVO (T7): abas, não lidas, textos de recusa
  store/tableStore.ts   # T6, T7, T8
  lib/dice-config.ts    # NOVO (T7)
  lib/image.ts          # + prepareChatImage (T7)
  canvas/grid.ts, GridLayer.tsx            # NOVOS (T8)
  canvas/camera.ts, ping.ts, ruler.ts      # NOVOS (T9)
  canvas/shapes.ts, ShapeNode.tsx, useShapeTool.ts  # NOVOS (T10)
  canvas/TableCanvas.tsx  # T3, T8, T9, T10
  canvas/Overlay.tsx      # T9, T10
  canvas/nodeChange.ts    # T8, T10
  canvas/SelectionTransformer.tsx # T10
  canvas/ImageNode.tsx, StrokeNode.tsx, hooks.ts  # T9
  ui/GridPopover.tsx (T8), ui/ShapePopover.tsx (T10)
  ui/chat/format.ts, ChatEntryView.tsx, ChatPanel.tsx, DiceModal.tsx, ImageLightbox.tsx  # NOVOS (T11)
  ui/memberMenu.ts, ui/MemberMenu.tsx      # NOVOS (T12)
  ui/Toolbar.tsx (T8, T9, T10), ui/useKeyboard.ts (T9, T10), ui/MembersPanel.tsx (T12), ui/TablePage.tsx (T11)
  styles.css (T11)
apps/web/test/  reducers-m3, chat, dice-config, grid, camera, shapes, chat-format, chat-entry (.tsx), member-menu (NOVOS);
                reducers, reducers-layers, undo-groups, sync-client (snapshots, T3)
e2e/table.spec.ts  # + testes do M3 (T13)
README.md          # T13
```

Comandos de verificação usados nas tasks:
- Shared: `pnpm --filter @mesa/shared test` e `pnpm --filter @mesa/shared typecheck`
- Worker: `pnpm --filter @mesa/worker test` e `pnpm --filter @mesa/worker typecheck`
- Web: `pnpm --filter @mesa/web test` e `pnpm --filter @mesa/web typecheck`
- Tudo: `pnpm typecheck && pnpm test`
- E2E: `pnpm e2e`

---

### Task 1: Shared — configurações, grade, régua, dados, comando `/r` e tipos do chat

Só módulos novos e puros: nenhum union existente muda, então worker e web continuam compilando sem ajustes.

**Files:**
- Modify: `packages/shared/src/constants.ts` (acrescentar bloco no fim)
- Modify: `packages/shared/src/model.ts:30` (exportar `ColorSchema`)
- Create: `packages/shared/src/settings.ts`, `packages/shared/src/grid.ts`, `packages/shared/src/dice.ts`, `packages/shared/src/command.ts`, `packages/shared/src/chat.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/settings.test.ts`, `grid.test.ts`, `dice.test.ts`, `command.test.ts`, `chat.test.ts` (todos NOVOS)

**Interfaces:**
- Consumes: nada novo.
- Produces (em `@mesa/shared`):
  - Constantes: `GRID_MIN = 10`, `GRID_MAX = 500`, `DEFAULT_GRID_SIZE = 70`, `SHAPE_STROKE_MAX = 30`, `CHAT_TEXT_MAX = 500`, `CHAT_HISTORY_LIMIT = 200`, `CHAT_IMAGE_MAX_SIDE = 16_384`, `CHAT_THUMB_MAX = 240`, `CHAT_RATE_PER_SEC = 5`, `PING_RATE_PER_SEC = 3`, `PING_DURATION_MS = 2000`, `CAMERA_GLIDE_MS = 400`, `RULER_THROTTLE_MS = 33`, `DICE_MAX_COUNT = 50`, `DICE_MAX_BONUS = 100`
  - `ColorSchema` (`#rrggbb`)
  - `GridSchema`, `type GridSettings = { enabled: boolean; size: number; snap: boolean }`, `TableSettingsSchema`, `type TableSettings = { grid: GridSettings }`, `SettingsPatchSchema`, `type SettingsPatch = { grid?: Partial<GridSettings> }`, `DEFAULT_SETTINGS`, `mergeSettings(current: TableSettings, patch: SettingsPatch): TableSettings`, `parseSettings(raw: unknown): TableSettings`
  - `interface Point { x: number; y: number }`, `interface Box { x; y; width; height }`, `snapToGrid(box: Box, size: number): Box`, `snapPatch<T extends Partial<Box>>(patch: T, size: number): T`, `cellCenter(p: Point, size: number): Point`, `rulerDistance(from: Point, to: Point, size: number): number` (já arredondada a 1 casa), `formatDistance(squares: number): string` (`"4,2 q"`)
  - `DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const`, `type DieSides`, `RollModeSchema`, `type RollMode`, `RollRequestSchema`, `type RollRequest`, `interface RollResult { rolls: number[]; kept: number[]; total: number }`, `uniformInt(n: number, nextUint32: () => number): number`, `rollDice(request: RollRequest, nextUint32: () => number): RollResult`, `formatRollFormula(r: Pick<RollRequest, 'die' | 'count' | 'bonus'>): string`
  - `type ParsedCommand = { kind: 'roll'; request: RollRequest } | { kind: 'invalid' }`, `parseCommand(input: string): ParsedCommand | null` (`null` = texto comum)
  - `ChatChannelSchema`, `type ChatChannel = 'table' | { dm: string }`, `ChatTextSchema`, `ChatImageSideSchema`, `type ChatEntry`, `type ChatRejectReason = 'invalid' | 'not_found' | 'rate_limited'`

- [ ] **Step 1: Testes (falham)**

Crie `packages/shared/test/settings.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, SettingsPatchSchema, TableSettingsSchema, mergeSettings, parseSettings } from '../src'

describe('configurações da mesa', () => {
  it('padrão: grade desligada, 70 px, sem encaixe', () => {
    expect(DEFAULT_SETTINGS).toEqual({ grid: { enabled: false, size: 70, snap: false } })
  })

  it('patch parcial mescla só o que veio', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { grid: { snap: true } })).toEqual({ grid: { enabled: false, size: 70, snap: true } })
    expect(mergeSettings(DEFAULT_SETTINGS, {})).toEqual(DEFAULT_SETTINGS)
  })

  // Review Focus #4
  it('tamanho inteiro de 10 a 500', () => {
    expect(SettingsPatchSchema.safeParse({ grid: { size: 10 } }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ grid: { size: 500 } }).success).toBe(true)
    expect(SettingsPatchSchema.safeParse({ grid: { size: 9 } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ grid: { size: 501 } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ grid: { size: 12.5 } }).success).toBe(false)
  })

  it('recusa campos desconhecidos', () => {
    expect(SettingsPatchSchema.safeParse({ grid: { color: '#ffffff' } }).success).toBe(false)
    expect(SettingsPatchSchema.safeParse({ theme: 'dark' }).success).toBe(false)
  })

  it('parseSettings completa o que falta e descarta lixo', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings({ grid: { enabled: true } })).toEqual({ grid: { enabled: true, size: 70, snap: false } })
    expect(parseSettings({ grid: { size: 3 } })).toEqual(DEFAULT_SETTINGS)
    expect(TableSettingsSchema.safeParse(parseSettings('x')).success).toBe(true)
    expect(parseSettings(null)).not.toBe(DEFAULT_SETTINGS)
  })
})
```

Crie `packages/shared/test/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { cellCenter, formatDistance, rulerDistance, snapPatch, snapToGrid } from '../src'

describe('snapToGrid', () => {
  it('posição vai ao múltiplo mais próximo; lado ao múltiplo, com mínimo de um quadrado', () => {
    expect(snapToGrid({ x: 34, y: 36, width: 110, height: 20 }, 70)).toEqual({ x: 0, y: 70, width: 140, height: 70 })
  })

  it('coordenadas negativas sem gerar -0', () => {
    expect(snapToGrid({ x: -20, y: -50, width: 70, height: 70 }, 70)).toEqual({ x: 0, y: -70, width: 70, height: 70 })
    expect(Object.is(snapToGrid({ x: -20, y: 0, width: 70, height: 70 }, 70).x, 0)).toBe(true)
  })
})

describe('snapPatch', () => {
  it('só mexe nos campos de geometria presentes e preserva os outros', () => {
    expect(snapPatch({ x: 101, rotation: 15 }, 50)).toEqual({ x: 100, rotation: 15 })
    expect(snapPatch({ width: 10 }, 50)).toEqual({ width: 50 })
    expect(snapPatch({}, 50)).toEqual({})
  })
})

describe('régua', () => {
  it('cellCenter devolve o centro do quadrado clicado', () => {
    expect(cellCenter({ x: 75, y: 10 }, 70)).toEqual({ x: 105, y: 35 })
    expect(cellCenter({ x: -1, y: 0 }, 70)).toEqual({ x: -35, y: 35 })
  })

  it('rulerDistance = hypot / size com uma casa', () => {
    expect(rulerDistance({ x: 0, y: 0 }, { x: 210, y: 280 }, 70)).toBe(5)
    expect(rulerDistance({ x: 0, y: 0 }, { x: 100, y: 0 }, 70)).toBe(1.4)
    expect(rulerDistance({ x: 385, y: 315 }, { x: 700, y: 300 }, 70)).toBe(4.5)
  })

  it('formatDistance usa vírgula decimal e "q"', () => {
    expect(formatDistance(4.2)).toBe('4,2 q')
    expect(formatDistance(5)).toBe('5,0 q')
    expect(formatDistance(0)).toBe('0,0 q')
  })
})
```

Crie `packages/shared/test/dice.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RollRequestSchema, formatRollFormula, rollDice, uniformInt } from '../src'

const seq = (...values: number[]) => {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('gerador esgotado')
    return values[i++]
  }
}
const ok = { die: 20, count: 1, bonus: 0, mode: 'normal' }

describe('RollRequestSchema', () => {
  it('aceita d4..d100 e recusa outros dados', () => {
    for (const die of [4, 6, 8, 10, 12, 20, 100]) expect(RollRequestSchema.safeParse({ ...ok, die }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, die: 7 }).success).toBe(false)
  })

  it('quantidade de 1 a 50 e bônus inteiro de -100 a +100', () => {
    expect(RollRequestSchema.safeParse({ ...ok, count: 50 }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, count: 0 }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, count: 51 }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, count: 1.5 }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, bonus: 100 }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, bonus: -100 }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, bonus: 101 }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, bonus: 1.5 }).success).toBe(false)
  })

  it('vantagem e desvantagem só com quantidade 1', () => {
    expect(RollRequestSchema.safeParse({ ...ok, mode: 'advantage' }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, mode: 'disadvantage' }).success).toBe(true)
    expect(RollRequestSchema.safeParse({ ...ok, count: 2, mode: 'advantage' }).success).toBe(false)
    expect(RollRequestSchema.safeParse({ ...ok, mode: 'sorte' }).success).toBe(false)
  })

  it('recusa campos extras', () => {
    expect(RollRequestSchema.safeParse({ ...ok, sides: 3 }).success).toBe(false)
  })
})

describe('uniformInt', () => {
  it('descarta a sobra do módulo (2^32 % 6 = 4: 4294967292..4294967295 são descartados)', () => {
    expect(uniformInt(6, seq(4294967295, 4294967292, 7))).toBe(1)
  })

  it('aceita o maior valor abaixo da sobra', () => {
    expect(uniformInt(6, seq(4294967291))).toBe(5)
  })
})

describe('rollDice', () => {
  it('normal: soma todos os dados e o bônus', () => {
    expect(rollDice({ die: 6, count: 3, bonus: 2, mode: 'normal' }, seq(0, 1, 5))).toEqual({ rolls: [1, 2, 6], kept: [1, 2, 6], total: 11 })
  })

  it('vantagem: rola 2 e mantém o maior', () => {
    expect(rollDice({ die: 20, count: 1, bonus: 5, mode: 'advantage' }, seq(16, 7))).toEqual({ rolls: [17, 8], kept: [17], total: 22 })
  })

  it('desvantagem: rola 2 e mantém o menor', () => {
    expect(rollDice({ die: 20, count: 1, bonus: -1, mode: 'disadvantage' }, seq(16, 7))).toEqual({ rolls: [17, 8], kept: [8], total: 7 })
  })

  it('d100 vai de 1 a 100', () => {
    expect(rollDice({ die: 100, count: 2, bonus: 0, mode: 'normal' }, seq(0, 99))).toEqual({ rolls: [1, 100], kept: [1, 100], total: 101 })
  })
})

describe('formatRollFormula', () => {
  it('NdM com bônus positivo, negativo ou ausente', () => {
    expect(formatRollFormula({ die: 20, count: 1, bonus: 5 })).toBe('1d20+5')
    expect(formatRollFormula({ die: 6, count: 2, bonus: -3 })).toBe('2d6-3')
    expect(formatRollFormula({ die: 8, count: 4, bonus: 0 })).toBe('4d8')
  })
})
```

Crie `packages/shared/test/command.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseCommand } from '../src'

describe('parseCommand', () => {
  it('texto comum não é comando', () => {
    expect(parseCommand('oi pessoal')).toBeNull()
    expect(parseCommand('/me acena')).toBeNull()
    expect(parseCommand('/rolar')).toBeNull()
  })

  it('/r NdM, NdM+B, NdM-B e dM', () => {
    expect(parseCommand('/r 2d6')).toEqual({ kind: 'roll', request: { die: 6, count: 2, bonus: 0, mode: 'normal' } })
    expect(parseCommand('/r 1d20+5')).toEqual({ kind: 'roll', request: { die: 20, count: 1, bonus: 5, mode: 'normal' } })
    expect(parseCommand('/r 3d8 - 2')).toEqual({ kind: 'roll', request: { die: 8, count: 3, bonus: -2, mode: 'normal' } })
    expect(parseCommand('  /R d20  ')).toEqual({ kind: 'roll', request: { die: 20, count: 1, bonus: 0, mode: 'normal' } })
  })

  it('sufixos adv e dis', () => {
    expect(parseCommand('/r d20+3 adv')).toEqual({ kind: 'roll', request: { die: 20, count: 1, bonus: 3, mode: 'advantage' } })
    expect(parseCommand('/r 1d20 dis')).toEqual({ kind: 'roll', request: { die: 20, count: 1, bonus: 0, mode: 'disadvantage' } })
  })

  it('fórmula inválida', () => {
    for (const bad of ['/r', '/r 2d7', '/r 0d6', '/r 51d6', '/r d20+101', '/r 2d20 adv', '/r abc', '/r 1d20 vantagem']) {
      expect(parseCommand(bad), bad).toEqual({ kind: 'invalid' })
    }
  })
})
```

Crie `packages/shared/test/chat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ChatChannelSchema, ChatImageSideSchema, ChatTextSchema } from '../src'

describe('chat', () => {
  it('canal: mesa ou conversa privada', () => {
    expect(ChatChannelSchema.safeParse('table').success).toBe(true)
    expect(ChatChannelSchema.safeParse({ dm: 'abc' }).success).toBe(true)
    expect(ChatChannelSchema.safeParse({ dm: '' }).success).toBe(false)
    expect(ChatChannelSchema.safeParse({ dm: 'abc', extra: 1 }).success).toBe(false)
    expect(ChatChannelSchema.safeParse('gm').success).toBe(false)
  })

  it('texto aparado, de 1 a 500', () => {
    expect(ChatTextSchema.parse('  oi  ')).toBe('oi')
    expect(ChatTextSchema.safeParse('   ').success).toBe(false)
    expect(ChatTextSchema.safeParse('x'.repeat(500)).success).toBe(true)
    expect(ChatTextSchema.safeParse('x'.repeat(501)).success).toBe(false)
  })

  it('lado da imagem: inteiro de 1 a 16384', () => {
    expect(ChatImageSideSchema.safeParse(1).success).toBe(true)
    expect(ChatImageSideSchema.safeParse(16_384).success).toBe(true)
    expect(ChatImageSideSchema.safeParse(0).success).toBe(false)
    expect(ChatImageSideSchema.safeParse(1.5).success).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/shared test`
Expected: FAIL — `DEFAULT_SETTINGS`, `snapToGrid`, `RollRequestSchema`, `parseCommand`, `ChatChannelSchema` não existem.

- [ ] **Step 3: Constantes e `ColorSchema`**

Acrescente no fim de `packages/shared/src/constants.ts`:

```ts

// M3
export const GRID_MIN = 10
export const GRID_MAX = 500
export const DEFAULT_GRID_SIZE = 70
export const SHAPE_STROKE_MAX = 30
export const CHAT_TEXT_MAX = 500
export const CHAT_HISTORY_LIMIT = 200
export const CHAT_IMAGE_MAX_SIDE = 16_384
export const CHAT_THUMB_MAX = 240
export const CHAT_RATE_PER_SEC = 5
export const PING_RATE_PER_SEC = 3
export const PING_DURATION_MS = 2000
export const CAMERA_GLIDE_MS = 400
export const RULER_THROTTLE_MS = 33
export const DICE_MAX_COUNT = 50
export const DICE_MAX_BONUS = 100
```

Em `packages/shared/src/model.ts`, troque a linha

```ts
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/)
```

por

```ts
export const ColorSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/)
const color = ColorSchema
```

- [ ] **Step 4: `settings.ts`**

Crie `packages/shared/src/settings.ts`:

```ts
import { z } from 'zod'
import { DEFAULT_GRID_SIZE, GRID_MAX, GRID_MIN } from './constants'

export const GridSchema = z.strictObject({
  enabled: z.boolean(),
  size: z.number().int().min(GRID_MIN).max(GRID_MAX),
  snap: z.boolean(),
})
export type GridSettings = z.infer<typeof GridSchema>

export const TableSettingsSchema = z.strictObject({ grid: GridSchema })
export type TableSettings = z.infer<typeof TableSettingsSchema>

export const SettingsPatchSchema = z.strictObject({ grid: GridSchema.partial() }).partial()
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>

export const DEFAULT_SETTINGS: TableSettings = { grid: { enabled: false, size: DEFAULT_GRID_SIZE, snap: false } }

export function mergeSettings(current: TableSettings, patch: SettingsPatch): TableSettings {
  return { ...current, grid: { ...current.grid, ...patch.grid } }
}

/** Lê o JSON guardado; campos ausentes voltam ao padrão e conteúdo inválido vira o padrão inteiro. */
export function parseSettings(raw: unknown): TableSettings {
  const stored = (typeof raw === 'object' && raw !== null ? raw : {}) as { grid?: unknown }
  const grid = typeof stored.grid === 'object' && stored.grid !== null ? stored.grid : {}
  const parsed = TableSettingsSchema.safeParse({ grid: { ...DEFAULT_SETTINGS.grid, ...grid } })
  return parsed.success ? parsed.data : { grid: { ...DEFAULT_SETTINGS.grid } }
}
```

- [ ] **Step 5: `grid.ts`**

Crie `packages/shared/src/grid.ts`:

```ts
export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

// `+ 0` transforma -0 em 0 (Math.round(-0.3) === -0).
const snap = (value: number, size: number) => Math.round(value / size) * size + 0
const snapSide = (value: number, size: number) => Math.max(size, snap(value, size))

/** x/y no múltiplo de `size` mais próximo; largura/altura no múltiplo mais próximo, mínimo `size`. */
export function snapToGrid(box: Box, size: number): Box {
  return { x: snap(box.x, size), y: snap(box.y, size), width: snapSide(box.width, size), height: snapSide(box.height, size) }
}

/** Encaixa só os campos de geometria presentes; os outros (ex.: rotation) passam intactos. */
export function snapPatch<T extends Partial<Box>>(patch: T, size: number): T {
  const out: Partial<Box> = {}
  if (patch.x !== undefined) out.x = snap(patch.x, size)
  if (patch.y !== undefined) out.y = snap(patch.y, size)
  if (patch.width !== undefined) out.width = snapSide(patch.width, size)
  if (patch.height !== undefined) out.height = snapSide(patch.height, size)
  return { ...patch, ...out }
}

export function cellCenter(p: Point, size: number): Point {
  return { x: (Math.floor(p.x / size) + 0.5) * size, y: (Math.floor(p.y / size) + 0.5) * size }
}

/** Distância em quadrados, com uma casa decimal. */
export function rulerDistance(from: Point, to: Point, size: number): number {
  return Math.round((Math.hypot(to.x - from.x, to.y - from.y) / size) * 10) / 10
}

export function formatDistance(squares: number): string {
  return `${squares.toFixed(1).replace('.', ',')} q`
}
```

- [ ] **Step 6: `dice.ts`**

Crie `packages/shared/src/dice.ts`:

```ts
import { z } from 'zod'
import { DICE_MAX_BONUS, DICE_MAX_COUNT } from './constants'

export const DIE_SIDES = [4, 6, 8, 10, 12, 20, 100] as const
export type DieSides = (typeof DIE_SIDES)[number]

export const RollModeSchema = z.enum(['normal', 'advantage', 'disadvantage'])
export type RollMode = z.infer<typeof RollModeSchema>

export const RollRequestSchema = z
  .strictObject({
    die: z.literal(DIE_SIDES),
    count: z.number().int().min(1).max(DICE_MAX_COUNT),
    bonus: z.number().int().min(-DICE_MAX_BONUS).max(DICE_MAX_BONUS),
    mode: RollModeSchema,
  })
  .refine((r) => r.mode === 'normal' || r.count === 1, 'advantage/disadvantage only with count 1')
export type RollRequest = z.infer<typeof RollRequestSchema>

export interface RollResult {
  rolls: number[]
  kept: number[]
  total: number
}

const RANGE = 2 ** 32

/** Inteiro uniforme em [0, n) a partir de uint32; descarta a sobra para não enviesar o módulo. */
export function uniformInt(n: number, nextUint32: () => number): number {
  const limit = RANGE - (RANGE % n)
  for (;;) {
    const x = nextUint32()
    if (x < limit) return x % n
  }
}

export function rollDice(request: RollRequest, nextUint32: () => number): RollResult {
  const n = request.mode === 'normal' ? request.count : 2
  const rolls = Array.from({ length: n }, () => uniformInt(request.die, nextUint32) + 1)
  const kept =
    request.mode === 'advantage' ? [Math.max(...rolls)] : request.mode === 'disadvantage' ? [Math.min(...rolls)] : [...rolls]
  return { rolls, kept, total: kept.reduce((sum, v) => sum + v, 0) + request.bonus }
}

export function formatRollFormula(r: Pick<RollRequest, 'die' | 'count' | 'bonus'>): string {
  const bonus = r.bonus > 0 ? `+${r.bonus}` : r.bonus < 0 ? `${r.bonus}` : ''
  return `${r.count}d${r.die}${bonus}`
}
```

- [ ] **Step 7: `command.ts`**

Crie `packages/shared/src/command.ts`:

```ts
import { RollRequestSchema, type RollRequest } from './dice'

export type ParsedCommand = { kind: 'roll'; request: RollRequest } | { kind: 'invalid' }

const ROLL_RE = /^\/r\s+(\d*)d(\d+)(?:\s*([+-])\s*(\d+))?(?:\s+(adv|dis))?$/i

/** `null` = texto comum; `/r …` vira rolagem ou `invalid`. */
export function parseCommand(input: string): ParsedCommand | null {
  const text = input.trim()
  if (!/^\/r(\s|$)/i.test(text)) return null
  const match = ROLL_RE.exec(text)
  if (!match) return { kind: 'invalid' }
  const [, count, die, sign, bonus, suffix] = match
  const mode = suffix === undefined ? 'normal' : suffix.toLowerCase() === 'adv' ? 'advantage' : 'disadvantage'
  const parsed = RollRequestSchema.safeParse({
    die: Number(die),
    count: count === '' ? 1 : Number(count),
    bonus: bonus === undefined ? 0 : sign === '-' ? -Number(bonus) : Number(bonus),
    mode,
  })
  return parsed.success ? { kind: 'roll', request: parsed.data } : { kind: 'invalid' }
}
```

- [ ] **Step 8: `chat.ts` e `index.ts`**

Crie `packages/shared/src/chat.ts`:

```ts
import { z } from 'zod'
import { CHAT_IMAGE_MAX_SIDE, CHAT_TEXT_MAX } from './constants'
import type { RollRequest, RollResult } from './dice'

export const ChatChannelSchema = z.union([z.literal('table'), z.strictObject({ dm: z.string().min(1).max(64) })])
export type ChatChannel = z.infer<typeof ChatChannelSchema>

export const ChatTextSchema = z.string().trim().min(1).max(CHAT_TEXT_MAX)
export const ChatImageSideSchema = z.number().int().min(1).max(CHAT_IMAGE_MAX_SIDE)

interface ChatBase {
  /** Gerado pelo servidor. */
  id: string
  /** Timestamp do servidor (ms). */
  at: number
  authorId: string
}

export type ChatEntry =
  | (ChatBase & { kind: 'message'; text: string })
  | (ChatBase & { kind: 'image'; assetKey: string; width: number; height: number })
  | (ChatBase & { kind: 'roll'; request: RollRequest; result: RollResult; secret: boolean })

export type ChatRejectReason = 'invalid' | 'not_found' | 'rate_limited'
```

Troque `packages/shared/src/index.ts` por:

```ts
export * from './model'
export * from './protocol'
export * from './constants'
export * from './geometry'
export * from './layers'
export * from './settings'
export * from './grid'
export * from './dice'
export * from './command'
export * from './chat'
```

- [ ] **Step 9: Rodar e ver passar**

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/shared typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde (nada fora do `shared` mudou).

- [ ] **Step 10: Commit**

```bash
git add packages/shared/src packages/shared/test
git commit -m "feat(m3): Task 1 — configurações, grade, régua, dados, /r e tipos do chat" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Worker — store: configurações, histórico do chat e marcas do membro

**Files:**
- Modify: `apps/worker/src/engine/store.ts`
- Modify: `apps/worker/src/engine/memory-store.ts`
- Modify: `apps/worker/src/engine/sql-store.ts`
- Test: `apps/worker/test/store-contract.ts` (acrescentar no fim da função), `apps/worker/test/sql-store.test.ts` (novo `it`)

**Interfaces:**
- Consumes (Task 1): `TableSettings`, `DEFAULT_SETTINGS`, `parseSettings`, `ChatEntry`, `CHAT_HISTORY_LIMIT`.
- Produces:
  - `StoredMember` ganha `nicknameSetByGm?: boolean` e `colorSetByGm?: boolean`
  - `TableStore.getSettings(): TableSettings` (padrão quando não há linha; sempre uma cópia)
  - `TableStore.putSettings(settings: TableSettings): void`
  - `TableStore.appendChat(entry: ChatEntry): void` (mantém só as últimas `CHAT_HISTORY_LIMIT`)
  - `TableStore.listChat(): ChatEntry[]` (mais antiga primeiro)
  - SQL: `settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)`, `chat (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)`

- [ ] **Step 1: Testes (falham)**

Em `apps/worker/test/store-contract.ts`, troque o import do shared por

```ts
import { CHAT_HISTORY_LIMIT, DEFAULT_LAYERS, DEFAULT_SETTINGS } from '@mesa/shared'
```

e acrescente no fim do corpo de `checkStoreContract` (depois de `expect(store.listMembers()).toEqual([])`):

```ts

  // M3 — configurações
  expect(store.getSettings()).toEqual(DEFAULT_SETTINGS)
  store.putSettings({ grid: { enabled: true, size: 50, snap: true } })
  expect(store.getSettings()).toEqual({ grid: { enabled: true, size: 50, snap: true } })
  store.getSettings().grid.size = 999 // o retorno é cópia: mexer nele não altera o guardado
  expect(store.getSettings().grid.size).toBe(50)

  // M3 — chat: só as últimas 200, da mais antiga para a mais nova
  expect(store.listChat()).toEqual([])
  for (let i = 0; i < CHAT_HISTORY_LIMIT + 5; i++) {
    store.appendChat({ id: `m${i}`, at: i, authorId: 'A', kind: 'message', text: `t${i}` })
  }
  const chat = store.listChat()
  expect(chat).toHaveLength(CHAT_HISTORY_LIMIT)
  expect(chat[0]).toEqual({ id: 'm5', at: 5, authorId: 'A', kind: 'message', text: 't5' })
  expect(chat.at(-1)?.id).toBe('m204')

  // M3 — marcas do mestre no membro
  store.upsertMember({ clientId: 'B', nickname: 'Bia', color: '#3cb44b', role: 'player', lastSeenAt: 1, nicknameSetByGm: true, colorSetByGm: true })
  expect(store.getMember('B')).toMatchObject({ nicknameSetByGm: true, colorSetByGm: true })
```

Em `apps/worker/test/sql-store.test.ts`, acrescente dentro do `describe('SqlStore — migração do M1', …)`, depois do último `it`:

```ts

  it('configurações gravadas com JSON parcial voltam completas', async () => {
    await runInDurableObject(freshStub(), (_instance, state) => {
      const store = new SqlStore(state.storage.sql)
      state.storage.sql.exec('INSERT INTO settings (id, data) VALUES (1, ?)', JSON.stringify({ grid: { enabled: true } }))
      expect(store.getSettings()).toEqual({ grid: { enabled: true, size: 70, snap: false } })
    })
  })
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/worker test -- sql-store`
Expected: FAIL — `store.getSettings is not a function` / tabela `settings` inexistente.

- [ ] **Step 3: Interface do store**

Em `apps/worker/src/engine/store.ts`, troque a primeira linha por

```ts
import type { ChatEntry, Layer, Role, TableObject, TableSettings } from '@mesa/shared'
```

acrescente ao fim da interface `StoredMember` (depois de `secretHash?: string`):

```ts
  /** M3: o mestre definiu o apelido; o `hello` não o sobrescreve. */
  nicknameSetByGm?: boolean
  /** M3: o mestre definiu a cor; o `hello` não a reatribui. */
  colorSetByGm?: boolean
```

e acrescente ao fim da interface `TableStore` (depois de `recordAppliedOp`):

```ts
  /** Padrão quando nunca foi gravado; sempre devolve uma cópia. */
  getSettings(): TableSettings
  putSettings(settings: TableSettings): void
  /** Guarda a entrada e apaga as mais antigas além de CHAT_HISTORY_LIMIT. */
  appendChat(entry: ChatEntry): void
  /** Da mais antiga para a mais nova. */
  listChat(): ChatEntry[]
```

- [ ] **Step 4: `MemoryStore`**

Em `apps/worker/src/engine/memory-store.ts`, troque a primeira linha por

```ts
import {
  APPLIED_OPS_KEEP,
  CHAT_HISTORY_LIMIT,
  DEFAULT_SETTINGS,
  type ChatEntry,
  type Layer,
  type TableObject,
  type TableSettings,
} from '@mesa/shared'
```

acrescente aos campos privados (depois de `private appliedOrder = …`):

```ts
  private settings: TableSettings = structuredClone(DEFAULT_SETTINGS)
  private chat: ChatEntry[] = []
```

e acrescente antes do `}` final da classe:

```ts

  getSettings() { return structuredClone(this.settings) }
  putSettings(settings: TableSettings) { this.settings = structuredClone(settings) }
  appendChat(entry: ChatEntry) { this.chat = [...this.chat, entry].slice(-CHAT_HISTORY_LIMIT) }
  listChat() { return [...this.chat] }
```

- [ ] **Step 5: `SqlStore`**

Em `apps/worker/src/engine/sql-store.ts`, troque a primeira linha por

```ts
import {
  APPLIED_OPS_KEEP,
  CHAT_HISTORY_LIMIT,
  parseSettings,
  type ChatEntry,
  type Layer,
  type TableObject,
  type TableSettings,
} from '@mesa/shared'
```

acrescente no construtor, depois do `CREATE TABLE IF NOT EXISTS gm_notes …`:

```ts
    sql.exec('CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)')
    sql.exec('CREATE TABLE IF NOT EXISTS chat (seq INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL)')
```

e acrescente antes do `}` final da classe:

```ts

  getSettings(): TableSettings {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM settings WHERE id = 1').toArray()[0]
    return parseSettings(row ? JSON.parse(row.data) : null)
  }

  putSettings(settings: TableSettings): void {
    this.sql.exec('INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)', JSON.stringify(settings))
  }

  appendChat(entry: ChatEntry): void {
    this.sql.exec('INSERT INTO chat (data) VALUES (?)', JSON.stringify(entry))
    this.sql.exec(
      'DELETE FROM chat WHERE seq <= (SELECT seq FROM chat ORDER BY seq DESC LIMIT 1 OFFSET ?)',
      CHAT_HISTORY_LIMIT,
    )
  }

  listChat(): ChatEntry[] {
    return this.sql
      .exec<{ data: string }>('SELECT data FROM chat ORDER BY seq')
      .toArray()
      .map((r) => JSON.parse(r.data) as ChatEntry)
  }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/engine/store.ts apps/worker/src/engine/memory-store.ts apps/worker/src/engine/sql-store.ts apps/worker/test/store-contract.ts apps/worker/test/sql-store.test.ts
git commit -m "feat(m3): Task 2 — store: configurações, histórico do chat e marcas do membro" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Shared — formas no modelo e protocolo do M3 (+ adaptações de compilação)

Acrescenta o objeto `shape` e todas as operações/mensagens novas. Para manter `pnpm typecheck` verde, worker e web ganham adaptações mínimas e explícitas que as Tasks 4, 6, 7 e 10 substituem.

**Files:**
- Modify: `packages/shared/src/model.ts` (campos de forma, unions, tipos)
- Modify: `packages/shared/src/protocol.ts` (arquivo inteiro)
- Test: `packages/shared/test/model.test.ts`, `packages/shared/test/protocol.test.ts` (acrescentar no fim)
- Modify: `apps/worker/src/engine/engine.ts` (`execute` e `snapshot`)
- Modify: `apps/web/src/store/reducers.ts` (`applyOptimistic`, `reduceServer`), `apps/web/src/canvas/TableCanvas.tsx:98-103`
- Modify: `apps/web/test/reducers.test.ts:2,17`, `apps/web/test/sync-client.test.ts:2,25`, `apps/web/test/reducers-layers.test.ts:2,18,166,203`, `apps/web/test/undo-groups.test.ts:2,19`

**Interfaces:**
- Consumes (Task 1): `ColorSchema`, `SHAPE_STROKE_MAX`, `SettingsPatchSchema`, `TableSettings`, `RollRequestSchema`, `ChatChannelSchema`, `ChatTextSchema`, `ChatImageSideSchema`, `ChatChannel`, `ChatEntry`, `ChatRejectReason`, `ASSET_KEY_RE`; (Task 2) `TableStore.getSettings()`.
- Produces (em `@mesa/shared`):
  - `NewObjectSchema`/`TableObjectSchema` aceitam `{ type: 'shape'; kind: 'rect' | 'ellipse' | 'line'; stroke; strokeWidth 1..30; fill: { color; opacity 0..1 } | null; points?: [number, number, number, number] }` — linha exige `points` e `fill: null`; rect/ellipse proíbem `points`
  - `type ShapeObject = Extract<TableObject, { type: 'shape' }>`, `type ShapeKind = ShapeObject['kind']`
  - `NicknameSchema` (trim 1..32), `MemberPatchSchema`, `type MemberPatch = { nickname?: string; color?: string }` (ao menos um campo)
  - `Op` ganha `settingsUpdate { patch: SettingsPatch }` e `memberUpdate { clientId, patch: MemberPatch }`
  - `Presence` ganha `ruler { from: Point; to: Point }`, `rulerEnd {}`, `ping { x, y, recenter: boolean }`
  - `ClientMessage` ganha `chatSend { reqId, channel, text }`, `chatImage { reqId, channel, assetKey, width, height }`, `roll { reqId, channel, request, secret }` (`secret: true` só com `channel: 'table'`); `type ChatMessage = Extract<ClientMessage, { t: 'chatSend' | 'chatImage' | 'roll' }>`
  - `readChatReqId(json: unknown): string | null`
  - `Snapshot.settings: TableSettings`, `Snapshot.chat: ChatEntry[]`
  - `ServerMessage` ganha `settingsUpdated { settings }`, `memberUpdated { member }`, `chat { channel, entry }`, `chatAck { reqId }`, `chatReject { reqId, reason: ChatRejectReason }`

- [ ] **Step 1: Testes (falham)**

Acrescente no fim de `packages/shared/test/model.test.ts`:

```ts

describe('formas (M3)', () => {
  const shape = {
    id: 'sh1', type: 'shape', layerId: 'drawings', x: 0, y: 0, width: 100, height: 50, rotation: 0, zIndex: 1,
    kind: 'rect', stroke: '#ffffff', strokeWidth: 3, fill: null,
  }
  const line = { ...shape, kind: 'line', points: [0, 0, 100, 50] }

  it('retângulo e elipse, com ou sem preenchimento', () => {
    expect(NewObjectSchema.safeParse(shape).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...shape, kind: 'ellipse', fill: { color: '#ff0000', opacity: 0.3 } }).success).toBe(true)
  })

  it('linha exige points e não tem preenchimento; rect/ellipse não têm points', () => {
    expect(NewObjectSchema.safeParse(line).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...line, points: undefined }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...line, fill: { color: '#ff0000', opacity: 0.3 } }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...line, points: [0, 0, 1] }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, points: [0, 0, 1, 1] }).success).toBe(false)
  })

  it('limites: espessura 1..30, opacidade 0..1, cor #rrggbb e tipo conhecido', () => {
    expect(NewObjectSchema.safeParse({ ...shape, strokeWidth: 30 }).success).toBe(true)
    expect(NewObjectSchema.safeParse({ ...shape, strokeWidth: 31 }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, strokeWidth: 0 }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, fill: { color: '#ff0000', opacity: 1.1 } }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, stroke: 'white' }).success).toBe(false)
    expect(NewObjectSchema.safeParse({ ...shape, kind: 'polygon' }).success).toBe(false)
  })

  it('forma gravada exige campos de servidor; imagens e traços do M2 continuam válidos sem migração', () => {
    expect(TableObjectSchema.safeParse({ ...shape, ...server }).success).toBe(true)
    expect(TableObjectSchema.safeParse(shape).success).toBe(false)
    expect(TableObjectSchema.safeParse(stored()).success).toBe(true)
  })
})
```

Em `packages/shared/test/protocol.test.ts`, troque o import por

```ts
import { ClientMessageSchema, ObjectPatchSchema, OpSchema, TableObjectSchema, isObjectOp, readChatReqId, readOpId } from '../src'
```

e acrescente no fim:

```ts

describe('protocolo do M3', () => {
  const d20 = { die: 20, count: 1, bonus: 0, mode: 'normal' }

  it('settingsUpdate valida a grade', () => {
    expect(OpSchema.safeParse({ kind: 'settingsUpdate', patch: { grid: { enabled: true, size: 50 } } }).success).toBe(true)
    expect(OpSchema.safeParse({ kind: 'settingsUpdate', patch: { grid: { size: 5 } } }).success).toBe(false)
  })

  it('memberUpdate: apelido aparado 1..32, cor #rrggbb, ao menos um campo, nada além disso', () => {
    expect(OpSchema.parse({ kind: 'memberUpdate', clientId: 'c', patch: { nickname: '  Bia  ' } })).toEqual({
      kind: 'memberUpdate', clientId: 'c', patch: { nickname: 'Bia' },
    })
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { color: '#123456' } }).success).toBe(true)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: {} }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { nickname: '   ' } }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { nickname: 'x'.repeat(33) } }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { color: 'red' } }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberUpdate', clientId: 'c', patch: { role: 'gm' } }).success).toBe(false)
  })

  it('chatSend apara o texto e limita 500; aceita conversa privada', () => {
    expect(ClientMessageSchema.parse({ t: 'chatSend', reqId: 'c1', channel: 'table', text: '  oi  ' })).toEqual({
      t: 'chatSend', reqId: 'c1', channel: 'table', text: 'oi',
    })
    expect(ClientMessageSchema.safeParse({ t: 'chatSend', reqId: 'c1', channel: 'table', text: 'x'.repeat(501) }).success).toBe(false)
    expect(ClientMessageSchema.safeParse({ t: 'chatSend', reqId: 'c1', channel: { dm: 'abc' }, text: 'oi' }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'chatSend', reqId: '', channel: 'table', text: 'oi' }).success).toBe(false)
  })

  it('roll: pedido validado; secreta só na mesa', () => {
    expect(ClientMessageSchema.safeParse({ t: 'roll', reqId: 'r1', channel: 'table', request: d20, secret: true }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'roll', reqId: 'r1', channel: { dm: 'abc' }, request: d20, secret: false }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'roll', reqId: 'r1', channel: { dm: 'abc' }, request: d20, secret: true }).success).toBe(false)
    expect(ClientMessageSchema.safeParse({ t: 'roll', reqId: 'r1', channel: 'table', request: { ...d20, count: 51 }, secret: false }).success).toBe(false)
  })

  it('chatImage exige assetKey e lados inteiros', () => {
    const img = { t: 'chatImage', reqId: 'i1', channel: 'table', assetKey: 'a'.repeat(64), width: 300, height: 200 }
    expect(ClientMessageSchema.safeParse(img).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ ...img, assetKey: 'x' }).success).toBe(false)
    expect(ClientMessageSchema.safeParse({ ...img, width: 0 }).success).toBe(false)
  })

  it('presença de régua e ping', () => {
    expect(ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'ruler', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } } }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'rulerEnd' } }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'ping', x: 1, y: 2, recenter: true } }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ t: 'presence', p: { kind: 'ping', x: 1, y: 2 } }).success).toBe(false)
  })

  it('readChatReqId lê o reqId de mensagens de chat mal formadas', () => {
    expect(readChatReqId({ t: 'chatSend', reqId: 'c1', text: 5 })).toBe('c1')
    expect(readChatReqId({ t: 'roll', reqId: 'r1' })).toBe('r1')
    expect(readChatReqId({ t: 'op', reqId: 'c1' })).toBeNull()
    expect(readChatReqId({ t: 'chatImage', reqId: 'x'.repeat(65) })).toBeNull()
    expect(readChatReqId(null)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/shared test`
Expected: FAIL — formas recusadas pelo union e `readChatReqId` não existe.

- [ ] **Step 3: Formas no modelo**

Em `packages/shared/src/model.ts`:

Troque a linha de import das constantes por

```ts
import { MAX_CONTROL_IDS, MAX_SEGMENTS, MAX_SEGMENT_NUMBERS, SHAPE_STROKE_MAX, TITLE_MAX } from './constants'
```

Logo depois do bloco `const strokeFields = { … }`, acrescente:

```ts

const shapeFields = {
  type: z.literal('shape'),
  kind: z.enum(['rect', 'ellipse', 'line']),
  stroke: color,
  strokeWidth: z.number().min(1).max(SHAPE_STROKE_MAX),
  fill: z.strictObject({ color, opacity: z.number().min(0).max(1) }).nullable(),
  /** Só linha: [x1, y1, x2, y2] relativos a (x, y). */
  points: z.tuple([coord, coord, coord, coord]).optional(),
}

// Linha: com points e sem preenchimento. Retângulo/elipse: sem points.
const shapeIsConsistent = (o: { kind: string; fill: unknown; points?: unknown }) =>
  o.kind === 'line' ? o.points !== undefined && o.fill === null : o.points === undefined
```

Troque os dois unions e os tipos derivados por:

```ts
// Sem `control`: o servidor define o controle na criação (campo enviado é descartado).
export const NewObjectSchema = z.discriminatedUnion('type', [
  z.object({ ...objectBase, ...imageFields }),
  z.object({ ...objectBase, ...strokeFields }),
  z.object({ ...objectBase, ...shapeFields }).refine(shapeIsConsistent, 'shape fields do not match kind'),
])
export type NewObject = z.infer<typeof NewObjectSchema>

export const TableObjectSchema = z.discriminatedUnion('type', [
  z.object({ ...objectBase, ...serverFields, ...imageFields }),
  z.object({ ...objectBase, ...serverFields, ...strokeFields }),
  z.object({ ...objectBase, ...serverFields, ...shapeFields }).refine(shapeIsConsistent, 'shape fields do not match kind'),
])
export type TableObject = z.infer<typeof TableObjectSchema>
export type ImageObject = Extract<TableObject, { type: 'image' }>
export type StrokeObject = Extract<TableObject, { type: 'stroke' }>
export type ShapeObject = Extract<TableObject, { type: 'shape' }>
export type ShapeKind = ShapeObject['kind']
```

`ObjectPatchSchema` não muda: forma se move/redimensiona com `x`, `y`, `width`, `height`, `rotation` (um `strokeWidth` acima de 30 numa forma vira `invalid` no `TableObjectSchema`).

- [ ] **Step 4: Protocolo**

Troque `packages/shared/src/protocol.ts` inteiro por:

```ts
import { z } from 'zod'
import { ASSET_KEY_RE, LAYER_NAME_MAX, NOTE_MAX } from './constants'
import {
  ChatChannelSchema,
  ChatImageSideSchema,
  ChatTextSchema,
  type ChatChannel,
  type ChatEntry,
  type ChatRejectReason,
} from './chat'
import { RollRequestSchema } from './dice'
import {
  ColorSchema,
  IdSchema,
  NewObjectSchema,
  ObjectPatchSchema,
  type Layer,
  type Member,
  type TableMetaPublic,
  type TableObject,
} from './model'
import { SettingsPatchSchema, type TableSettings } from './settings'

export const LayerNameSchema = z.string().trim().min(1).max(LAYER_NAME_MAX)

export const LayerPatchSchema = z
  .strictObject({
    name: LayerNameSchema,
    visibility: z.enum(['all', 'gm']),
    locked: z.boolean(),
  })
  .partial()
export type LayerPatch = z.infer<typeof LayerPatchSchema>

export const NicknameSchema = z.string().trim().min(1).max(32)

export const MemberPatchSchema = z
  .strictObject({ nickname: NicknameSchema, color: ColorSchema })
  .partial()
  .refine((p) => p.nickname !== undefined || p.color !== undefined, 'empty member patch')
export type MemberPatch = z.infer<typeof MemberPatchSchema>

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
  z.object({ kind: z.literal('settingsUpdate'), patch: SettingsPatchSchema }),
  z.object({ kind: z.literal('memberUpdate'), clientId: z.string().min(1).max(64), patch: MemberPatchSchema }),
])
export type Op = z.infer<typeof OpSchema>
export type ObjectOp = Extract<Op, { kind: 'create' | 'update' | 'delete' }>

export function isObjectOp(op: Op): op is ObjectOp {
  return op.kind === 'create' || op.kind === 'update' || op.kind === 'delete'
}

const PointSchema = z.object({ x: z.number(), y: z.number() })

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
  z.object({ kind: z.literal('ruler'), from: PointSchema, to: PointSchema }),
  z.object({ kind: z.literal('rulerEnd') }),
  z.object({ kind: z.literal('ping'), x: z.number(), y: z.number(), recenter: z.boolean() }),
])
export type Presence = z.infer<typeof PresenceSchema>

const HelloSchema = z.object({
  t: z.literal('hello'),
  clientId: z.uuid(),
  nickname: NicknameSchema,
  gmSecret: z.string().max(128).optional(),
  clientSecret: z.string().max(128).optional(),
  /** Versão do protocolo do cliente; 2 = guarda clientSecret (M2). */
  v: z.number().int().optional(),
})
export type HelloMessage = z.infer<typeof HelloSchema>

const ReqIdSchema = z.string().min(1).max(64)

export const ClientMessageSchema = z.discriminatedUnion('t', [
  HelloSchema,
  z.object({ t: z.literal('op'), opId: z.string().min(1).max(64), op: OpSchema }),
  z.object({ t: z.literal('grab'), objectId: IdSchema }),
  z.object({ t: z.literal('release'), objectId: IdSchema }),
  z.object({ t: z.literal('presence'), p: PresenceSchema }),
  z.object({ t: z.literal('chatSend'), reqId: ReqIdSchema, channel: ChatChannelSchema, text: ChatTextSchema }),
  z.object({
    t: z.literal('chatImage'),
    reqId: ReqIdSchema,
    channel: ChatChannelSchema,
    assetKey: z.string().regex(ASSET_KEY_RE),
    width: ChatImageSideSchema,
    height: ChatImageSideSchema,
  }),
  z
    .object({ t: z.literal('roll'), reqId: ReqIdSchema, channel: ChatChannelSchema, request: RollRequestSchema, secret: z.boolean() })
    .refine((m) => !m.secret || m.channel === 'table', 'secret roll only on the table channel'),
])
export type ClientMessage = z.infer<typeof ClientMessageSchema>
export type ChatMessage = Extract<ClientMessage, { t: 'chatSend' | 'chatImage' | 'roll' }>

/** `opId` de uma mensagem `{ t: 'op' }` que falhou no schema, para responder `reject invalid`. */
export function readOpId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const { t, opId } = json as { t?: unknown; opId?: unknown }
  return t === 'op' && typeof opId === 'string' && opId.length >= 1 && opId.length <= 64 ? opId : null
}

const CHAT_MESSAGE_TYPES: ReadonlySet<unknown> = new Set(['chatSend', 'chatImage', 'roll'])

/** `reqId` de uma mensagem de chat que falhou no schema, para responder `chatReject invalid`. */
export function readChatReqId(json: unknown): string | null {
  if (typeof json !== 'object' || json === null) return null
  const { t, reqId } = json as { t?: unknown; reqId?: unknown }
  return CHAT_MESSAGE_TYPES.has(t) && typeof reqId === 'string' && reqId.length >= 1 && reqId.length <= 64 ? reqId : null
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
  settings: TableSettings
  /** Só o canal da mesa, já filtrado para quem recebe (rolagem secreta: autor e mestres). */
  chat: ChatEntry[]
}

export type ServerMessage =
  | { t: 'welcome'; self: Member; snapshot: Snapshot; clientSecret?: string }
  | { t: 'ack'; opId: string; version: number }
  | { t: 'reject'; opId: string; reason: RejectReason; current?: TableObject | null }
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
  | { t: 'settingsUpdated'; settings: TableSettings }
  | { t: 'memberUpdated'; member: Member }
  /** Na conversa privada, `channel.dm` é sempre a OUTRA pessoa do ponto de vista de quem recebe. */
  | { t: 'chat'; channel: ChatChannel; entry: ChatEntry }
  | { t: 'chatAck'; reqId: string }
  | { t: 'chatReject'; reqId: string; reason: ChatRejectReason }
  | { t: 'error'; reason: 'table_not_found' | 'auth' }
```

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/shared typecheck`
Expected: PASS.

- [ ] **Step 5: Adaptações de compilação no worker (substituídas na Task 4)**

Em `apps/worker/src/engine/engine.ts`, dentro do `switch (op.kind)` de `execute`, depois de `case 'memberRemove': return this.memberRemove(op.clientId, online)`, acrescente:

```ts
      // Implementados na Task 4.
      case 'settingsUpdate':
      case 'memberUpdate':
        return rejectInvalid()
```

e no objeto devolvido por `snapshot`, depois de `notes: …`, acrescente:

```ts
      settings: this.store.getSettings(),
      chat: [],
```

Run: `pnpm --filter @mesa/worker typecheck && pnpm --filter @mesa/worker test`
Expected: PASS.

- [ ] **Step 6: Adaptações de compilação no web (substituídas nas Tasks 6, 7 e 10)**

Em `apps/web/src/store/reducers.ts`, no `switch (op.kind)` de `applyOptimistic`, depois do `case 'memberRemove': return { … }`, acrescente:

```ts
    default:
      // settingsUpdate e memberUpdate ganham efeito otimista na Task 6.
      return { next: s, before: null, prev: null, layerOrders: null }
```

e no `switch (msg.t)` de `reduceServer`, depois do `case 'error': …`, acrescente:

```ts
    default:
      // Configurações e membros: Task 6; chat: Task 7.
      return s
```

Em `apps/web/src/canvas/TableCanvas.tsx`, troque o bloco

```tsx
            {list.map((o) =>
              o.type === 'image' ? (
                <ImageNode key={o.id} object={o} />
              ) : (
                <StrokeNode key={o.id} object={o} segments={drawing.erasePreview[o.id]} />
              ),
            )}
```

por

```tsx
            {list.map((o) =>
              o.type === 'image' ? (
                <ImageNode key={o.id} object={o} />
              ) : o.type === 'stroke' ? (
                <StrokeNode key={o.id} object={o} segments={drawing.erasePreview[o.id]} />
              ) : null,
            )}
```

Snapshots de exemplo nos testes do web (o `Snapshot` agora exige `settings` e `chat`):

- `apps/web/test/reducers.test.ts` linha 2: `import { DEFAULT_LAYERS, DEFAULT_SETTINGS, LOCK_TTL_MS, type NewObject, type ServerMessage, type TableObject } from '@mesa/shared'`; linha 17: `  snapshot: { meta: { id: 'T', name: 'M' }, members: [self], layers: DEFAULT_LAYERS.slice(0, 3), objects, locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },`
- `apps/web/test/sync-client.test.ts` linha 2: `import { DEFAULT_SETTINGS, type Op, type ServerMessage } from '@mesa/shared'`; linha 25: `  snapshot: { meta: { id: 'T', name: 'M' }, members: [], layers: [], objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },`
- `apps/web/test/reducers-layers.test.ts` linha 2: `import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Layer, type Member, type ServerMessage, type TableObject } from '@mesa/shared'`; linha 18: `    snapshot: { meta: { id: 'T', name: 'M' }, members: [self, player], layers, objects, locks: [], notes, settings: DEFAULT_SETTINGS, chat: [] },`; linha 166: `      { t: 'welcome', self: gm, snapshot: { meta: { id: 'T', name: 'M' }, members: [gm, player], layers: DEFAULT_LAYERS, objects: [token('t1')], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] } },`; linha 203: `    snapshot: { meta: { id: 'T', name: 'M' }, members: [gm, player], layers, objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },`
- `apps/web/test/undo-groups.test.ts` linha 2: `import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type TableObject } from '@mesa/shared'`; linha 19: `      snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects: [stroke('a'), stroke('b')], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },`

(Confira cada linha pelo conteúdo, não só pelo número: é o único literal `snapshot: {` de cada lugar citado.)

Run: `pnpm --filter @mesa/web typecheck && pnpm --filter @mesa/web test`
Expected: PASS.

- [ ] **Step 7: Checkpoint geral**

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add packages/shared apps/worker/src/engine/engine.ts apps/web/src/store/reducers.ts apps/web/src/canvas/TableCanvas.tsx apps/web/test
git commit -m "feat(m3): Task 3 — formas no modelo e protocolo do M3" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Worker — engine do M3 (configurações, membro, encaixe, formas, chat e dados) e difusão dos efeitos novos

**Files:**
- Modify: `apps/worker/src/crypto.ts` (acrescentar `randomUint32`)
- Modify: `apps/worker/src/engine/engine.ts` (arquivo inteiro)
- Modify: `apps/worker/src/table-do.ts` (`onHello` e `broadcastEffect`)
- Test: `apps/worker/test/engine.test.ts` (acrescentar no fim), `apps/worker/test/table-do.test.ts` (acrescentar no fim)

**Interfaces:**
- Consumes: (Task 1) `mergeSettings`, `snapToGrid`, `snapPatch`, `rollDice`, `RollRequest`, `ChatEntry`, `TableSettings`; (Task 2) `getSettings/putSettings/appendChat/listChat`, flags do `StoredMember`; (Task 3) `Op` com `settingsUpdate`/`memberUpdate`, `MemberPatch`, `SettingsPatch`, `Snapshot.settings/chat`, objeto `shape`.
- Produces:
  - `randomUint32(): number` em `apps/worker/src/crypto.ts`
  - `new TableEngine(store, now = Date.now, rng: () => number = randomUint32)`
  - `OpEffect` ganha `{ kind: 'settings'; settings: TableSettings }`, `{ kind: 'memberUpdated'; member: Member }` e o efeito de objeto ganha `echo?: true` (servidor encaixou → o autor também recebe o `op upsert`)
  - `type ChatBody = { kind: 'message'; text } | { kind: 'image'; assetKey; width; height } | { kind: 'roll'; request: RollRequest; secret: boolean }`
  - `engine.chatEntry(authorId: string, body: ChatBody): ChatEntry` (gera `id`, `at` e, na rolagem, o resultado)
  - `engine.appendTableChat(entry: ChatEntry): void`
  - `engine.canSeeChat(viewerId: string, role: Role, entry: ChatEntry): boolean`
  - `engine.snapshot(role: Role, online: Set<string>, viewerId = ''): Snapshot` (chat filtrado por `canSeeChat`)
  - DO: `settingsUpdated`/`memberUpdated` para todas as sessões; `op` com eco para o autor quando `echo`

- [ ] **Step 1: Testes do engine (falham)**

Acrescente no fim de `apps/worker/test/engine.test.ts` (o import do shared já traz `NewObject` e `Op`):

```ts

const rect = (over: Record<string, unknown> = {}): NewObject =>
  ({
    id: 'r1', type: 'shape', kind: 'rect', layerId: 'drawings', x: 0, y: 0, width: 100, height: 40, rotation: 0, zIndex: 1,
    stroke: '#ffffff', strokeWidth: 3, fill: null, ...over,
  }) as NewObject

describe('M3 — configurações', () => {
  it('só o mestre muda; o patch é mesclado e vira efeito; snapshot traz o resultado', () => {
    expect(engine.applyOp('A', 'player', 'p1', { kind: 'settingsUpdate', patch: { grid: { enabled: true } } })).toMatchObject({
      ok: false, reason: 'forbidden',
    })
    const r = engine.applyOp('G', 'gm', 'g1', { kind: 'settingsUpdate', patch: { grid: { enabled: true, size: 50 } } })
    expect(effects(r)).toEqual([{ kind: 'settings', settings: { grid: { enabled: true, size: 50, snap: false } } }])
    expect(engine.snapshot('player', new Set()).settings).toEqual({ grid: { enabled: true, size: 50, snap: false } })
  })
})

describe('M3 — encaixe na grade', () => {
  const snapOn = () => engine.applyOp('G', 'gm', `gs${clock}`, { kind: 'settingsUpdate', patch: { grid: { snap: true, size: 50 } } })

  it('create de imagem encaixa e pede eco ao autor; traço e forma não encaixam', () => {
    snapOn()
    const r = engine.applyOp('A', 'player', 'op1', create(token({ x: 26, y: 74, width: 70, height: 20 })))
    expect(store.getObject('tok1')).toMatchObject({ x: 50, y: 50, width: 50, height: 50 })
    expect(effects(r)[0]).toMatchObject({ kind: 'object', echo: true })
    const stroke = {
      id: 's1', type: 'stroke', layerId: 'drawings', x: 26, y: 74, width: 10, height: 10, rotation: 0, zIndex: 1,
      segments: [[0, 0, 10, 10]], color: '#ffffff', strokeWidth: 3,
    } as NewObject
    const rs = engine.applyOp('A', 'player', 'op2', create(stroke))
    expect(store.getObject('s1')).toMatchObject({ x: 26, y: 74 })
    expect(effects(rs)[0]).not.toHaveProperty('echo')
    engine.applyOp('A', 'player', 'op3', create(rect({ x: 26, y: 74 })))
    expect(store.getObject('r1')).toMatchObject({ x: 26, y: 74, width: 100, height: 40 })
  })

  it('update de imagem encaixa só os campos enviados e não mexe na rotação', () => {
    engine.applyOp('A', 'player', 'op0', create(token({ x: 13, y: 13 })))
    snapOn()
    engine.applyOp('A', 'player', 'op1', update('tok1', { x: 76, rotation: 33 }))
    expect(store.getObject('tok1')).toMatchObject({ x: 100, y: 13, width: 70, height: 70, rotation: 33 })
  })

  it('update de imagem sem geometria (ex.: título) não encaixa nem pede eco', () => {
    engine.applyOp('A', 'player', 'op0', create(token({ x: 13, y: 13 })))
    snapOn()
    const r = engine.applyOp('A', 'player', 'op1', update('tok1', { title: 'Orc' }))
    expect(store.getObject('tok1')).toMatchObject({ x: 13, y: 13, title: 'Orc' })
    expect(effects(r)[0]).not.toHaveProperty('echo')
  })

  it('ligar o encaixe ou mudar o tamanho não move objetos existentes', () => {
    engine.applyOp('A', 'player', 'op0', create(token({ x: 13, y: 13 })))
    snapOn()
    engine.applyOp('G', 'gm', 'g2', { kind: 'settingsUpdate', patch: { grid: { size: 30 } } })
    expect(store.getObject('tok1')).toMatchObject({ x: 13, y: 13 })
  })
})

describe('M3 — formas', () => {
  it('seguem as regras de objeto: o dono move e redimensiona, outro jogador não', () => {
    engine.applyOp('A', 'player', 'op1', create(rect()))
    expect(engine.applyOp('B', 'player', 'op2', update('r1', { x: 5 }))).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('A', 'player', 'op3', update('r1', { x: 5, width: 300, rotation: 45 }))).toMatchObject({ ok: true })
    expect(store.getObject('r1')).toMatchObject({ type: 'shape', kind: 'rect', x: 5, width: 300, rotation: 45, stroke: '#ffffff' })
  })

  it('espessura acima de 30 vira invalid', () => {
    engine.applyOp('A', 'player', 'op1', create(rect()))
    expect(engine.applyOp('A', 'player', 'op2', update('r1', { strokeWidth: 31 }))).toEqual({ ok: false, reason: 'invalid' })
  })

  it('linha é criada com points relativos', () => {
    engine.applyOp('A', 'player', 'op1', create(rect({ id: 'l1', kind: 'line', points: [0, 40, 100, 0] })))
    expect(store.getObject('l1')).toMatchObject({ kind: 'line', points: [0, 40, 100, 0], fill: null })
  })
})

describe('M3 — memberUpdate', () => {
  it('só o mestre; inexistente é not_found; grava, marca e devolve o membro', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    const op: Op = { kind: 'memberUpdate', clientId: 'A', patch: { nickname: 'Aninha', color: '#123456' } }
    expect(engine.applyOp('B', 'player', 'p1', op)).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g0', { kind: 'memberUpdate', clientId: 'Z', patch: { nickname: 'X' } })).toMatchObject({ ok: false, reason: 'not_found' })
    const r = engine.applyOp('G', 'gm', 'g1', op, new Set(['A']))
    expect(effects(r)).toEqual([
      { kind: 'memberUpdated', member: { clientId: 'A', nickname: 'Aninha', color: '#123456', role: 'player', online: true } },
    ])
    expect(store.getMember('A')).toMatchObject({ nickname: 'Aninha', color: '#123456', nicknameSetByGm: true, colorSetByGm: true })
  })

  it('patch só de cor não marca o apelido', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    engine.applyOp('G', 'gm', 'g1', { kind: 'memberUpdate', clientId: 'A', patch: { color: '#123456' } })
    expect(store.getMember('A')).toMatchObject({ nickname: 'Ana', color: '#123456', colorSetByGm: true })
    expect(store.getMember('A')?.nicknameSetByGm).toBeUndefined()
  })

  it('join mantém apelido e cor definidos pelo mestre, mesmo com a cor repetida', () => {
    engine.join({ clientId: 'G', nickname: 'Mestre', role: 'gm' }, new Set())
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set(['G']))
    const gmColor = store.getMember('G')!.color
    engine.applyOp('G', 'gm', 'g1', { kind: 'memberUpdate', clientId: 'A', patch: { nickname: 'Aninha', color: gmColor } })
    const back = engine.join({ clientId: 'A', nickname: 'Outro nome', role: 'player' }, new Set(['G']))
    expect(back).toMatchObject({ nickname: 'Aninha', color: gmColor })
    expect(store.getMember('A')).toMatchObject({ nicknameSetByGm: true, colorSetByGm: true })
  })
})

describe('M3 — chat e dados', () => {
  const seq = (...values: number[]) => {
    let i = 0
    return () => values[i++]
  }

  it('rolagem usa o gerador injetado: normal com bônus, vantagem e desvantagem', () => {
    const e = new TableEngine(store, () => clock, seq(0, 1, 5, 16, 7, 16, 7))
    expect(e.chatEntry('A', { kind: 'roll', request: { die: 6, count: 3, bonus: 2, mode: 'normal' }, secret: false })).toMatchObject({
      kind: 'roll', authorId: 'A', at: clock, secret: false, result: { rolls: [1, 2, 6], kept: [1, 2, 6], total: 11 },
    })
    expect(e.chatEntry('A', { kind: 'roll', request: { die: 20, count: 1, bonus: 5, mode: 'advantage' }, secret: true })).toMatchObject({
      secret: true, result: { rolls: [17, 8], kept: [17], total: 22 },
    })
    expect(e.chatEntry('A', { kind: 'roll', request: { die: 20, count: 1, bonus: 0, mode: 'disadvantage' }, secret: false })).toMatchObject({
      result: { rolls: [17, 8], kept: [8], total: 8 },
    })
  })

  it('mensagem e imagem ganham id e hora do servidor', () => {
    const m = engine.chatEntry('A', { kind: 'message', text: 'oi' })
    expect(m).toMatchObject({ kind: 'message', text: 'oi', authorId: 'A', at: clock })
    expect(m.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(engine.chatEntry('A', { kind: 'image', assetKey: 'a'.repeat(64), width: 10, height: 20 })).toMatchObject({
      kind: 'image', width: 10, height: 20,
    })
  })

  it('histórico guarda as últimas 200 e o snapshot esconde a rolagem secreta de terceiros', () => {
    for (let i = 0; i < 205; i++) engine.appendTableChat(engine.chatEntry('A', { kind: 'message', text: `m${i}` }))
    engine.appendTableChat(engine.chatEntry('B', { kind: 'roll', request: { die: 20, count: 1, bonus: 0, mode: 'normal' }, secret: true }))
    const forC = engine.snapshot('player', new Set(), 'C').chat
    expect(forC).toHaveLength(199)
    expect(forC[0]).toMatchObject({ kind: 'message', text: 'm6' })
    expect(engine.snapshot('player', new Set(), 'B').chat).toHaveLength(200)
    expect(engine.snapshot('gm', new Set(), 'G').chat.at(-1)).toMatchObject({ kind: 'roll', secret: true })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/worker test -- engine`
Expected: FAIL — `settingsUpdate` recusado como `invalid`, `chatEntry` inexistente, encaixe não aplicado.

- [ ] **Step 3: `randomUint32`**

Acrescente no fim de `apps/worker/src/crypto.ts`:

```ts

/** uint32 aleatório para os dados (o engine aplica a rejeição contra viés de módulo). */
export function randomUint32(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0]
}
```

- [ ] **Step 4: Engine completo**

Troque `apps/worker/src/engine/engine.ts` inteiro por:

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
  mergeSettings,
  moveLayer,
  rollDice,
  snapPatch,
  snapToGrid,
  type ChatEntry,
  type Layer,
  type LayerPatch,
  type LockInfo,
  type Member,
  type MemberPatch,
  type NewObject,
  type ObjectPatch,
  type Op,
  type RejectReason,
  type Role,
  type RollRequest,
  type SettingsPatch,
  type Snapshot,
  type TableObject,
  type TableSettings,
} from '@mesa/shared'
import { randomUint32 } from '../crypto'
import type { StoredMember, TableStore } from './store'

export type LayerChange = { before: Layer | null; after: Layer }

/** O que mudou; o TableDO decide quem recebe o quê. */
export type OpEffect =
  /** `echo`: o servidor alterou o objeto (encaixe na grade); o autor também precisa recebê-lo. */
  | { kind: 'object'; before: TableObject | null; after: TableObject | null; echo?: true }
  | { kind: 'layers'; changes: LayerChange[] }
  | { kind: 'layerRemoved'; layer: Layer }
  | { kind: 'note'; objectId: string; text: string }
  | { kind: 'memberRemoved'; clientId: string }
  | { kind: 'released'; objectId: string; clientId: string }
  | { kind: 'settings'; settings: TableSettings }
  | { kind: 'memberUpdated'; member: Member }

export type OpResult =
  | { ok: true; duplicate: true; version: number }
  | { ok: true; duplicate: false; version: number; effects: OpEffect[] }
  | { ok: false; reason: RejectReason; current?: TableObject | null }

/** Conteúdo de uma entrada do chat antes de o servidor dar id, hora e (na rolagem) o resultado. */
export type ChatBody =
  | { kind: 'message'; text: string }
  | { kind: 'image'; assetKey: string; width: number; height: number }
  | { kind: 'roll'; request: RollRequest; secret: boolean }

interface Lock {
  clientId: string
  role: Role
  expiresAt: number
}

const reject = (reason: RejectReason, current: TableObject | null): OpResult => ({ ok: false, reason, current })
// 'invalid' omite `current`: o cliente reverte para o `before` da operação pendente.
const rejectInvalid = (): OpResult => ({ ok: false, reason: 'invalid' })
const done = (version: number, ...effects: OpEffect[]): OpResult => ({ ok: true, duplicate: false, version, effects })

const toMember = (m: StoredMember, online: boolean): Member => ({
  clientId: m.clientId,
  nickname: m.nickname,
  color: m.color,
  role: m.role,
  online,
})

const touchesGeometry = (p: ObjectPatch) =>
  p.x !== undefined || p.y !== undefined || p.width !== undefined || p.height !== undefined

export class TableEngine {
  // Travas ficam só em memória: se o DO hibernar, elas somem — aceitável, pois expiram em 10 s.
  private locks = new Map<string, Lock>()

  constructor(
    private store: TableStore,
    private now: () => number = Date.now,
    /** Gerador de uint32 dos dados; injetável nos testes. */
    private rng: () => number = randomUint32,
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

  /** Rolagem secreta: só o autor e os mestres. O resto: todos. */
  canSeeChat(viewerId: string, role: Role, entry: ChatEntry): boolean {
    return entry.kind !== 'roll' || !entry.secret || role === 'gm' || entry.authorId === viewerId
  }

  join(input: { clientId: string; nickname: string; role: Role; secretHash?: string }, online: Set<string>): Member {
    const existing = this.store.getMember(input.clientId)
    const usedByOthers = new Set(
      this.store
        .listMembers()
        .filter((m) => m.clientId !== input.clientId && online.has(m.clientId))
        .map((m) => m.color),
    )
    // Cor escolhida pelo mestre nunca é reatribuída, mesmo repetida.
    const color =
      existing && (existing.colorSetByGm || !usedByOthers.has(existing.color))
        ? existing.color
        : (MEMBER_COLORS.find((c) => !usedByOthers.has(c)) ?? MEMBER_COLORS[usedByOthers.size % MEMBER_COLORS.length])
    // Apelido definido pelo mestre vence o enviado no hello.
    const nickname = existing?.nicknameSetByGm ? existing.nickname : input.nickname
    const secretHash = input.secretHash ?? existing?.secretHash
    const stored: StoredMember = {
      clientId: input.clientId,
      nickname,
      role: input.role,
      color,
      lastSeenAt: this.now(),
      ...(secretHash ? { secretHash } : {}),
      ...(existing?.nicknameSetByGm ? { nicknameSetByGm: true } : {}),
      ...(existing?.colorSetByGm ? { colorSetByGm: true } : {}),
    }
    this.store.upsertMember(stored)
    return toMember(stored, true)
  }

  touchMember(clientId: string): void {
    const m = this.store.getMember(clientId)
    if (m) this.store.upsertMember({ ...m, lastSeenAt: this.now() })
  }

  snapshot(role: Role, online: Set<string>, viewerId = ''): Snapshot {
    const meta = this.store.getMeta()!
    const now = this.now()
    return {
      meta: { id: meta.id, name: meta.name },
      members: this.store
        .listMembers()
        .filter((m) => online.has(m.clientId) || now - m.lastSeenAt <= MEMBER_RECENT_MS)
        .map((m) => toMember(m, online.has(m.clientId))),
      layers: this.store.getLayers().filter((l) => this.canSeeLayer(role, l.id)),
      objects: this.store.listObjects().filter((o) => this.canSeeObject(role, o)),
      locks: this.activeLocks().filter((l) => {
        const o = this.store.getObject(l.objectId)
        return !!o && this.canSeeObject(role, o)
      }),
      notes: role === 'gm' ? this.store.listNotes() : {},
      settings: this.store.getSettings(),
      chat: this.store.listChat().filter((e) => this.canSeeChat(viewerId, role, e)),
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
    // Camadas, anotações, membros e configurações: só o mestre.
    if (role !== 'gm') return reject('forbidden', null)
    switch (op.kind) {
      case 'layerCreate': return this.layerCreate(op.layer)
      case 'layerUpdate': return this.layerUpdate(op.id, op.patch)
      case 'layerDelete': return this.layerDelete(op.id)
      case 'layerMove': return this.layerMove(op.id, op.direction)
      case 'noteSet': return this.noteSet(op.objectId, op.text)
      case 'memberRemove': return this.memberRemove(op.clientId, online)
      case 'settingsUpdate': return this.settingsUpdate(op.patch)
      case 'memberUpdate': return this.memberUpdate(op.clientId, op.patch, online)
    }
  }

  private create(clientId: string, role: Role, object: NewObject): OpResult {
    if (!this.canEditLayer(role, object.layerId)) return reject('forbidden', null)
    const existing = this.store.getObject(object.id)
    if (existing) return reject('exists', this.canSeeObject(role, existing) ? existing : null)
    // Encaixe só para imagens (mapa e tokens); traços e formas ficam onde foram soltos.
    const grid = this.store.getSettings().grid
    const snap = object.type === 'image' && grid.snap
    const placed = snap ? { ...object, ...snapToGrid(object, grid.size) } : object
    const after = {
      ...placed,
      control: { mode: 'list', clientIds: [clientId] },
      ownerId: clientId,
      version: 1,
      updatedBy: clientId,
    } as TableObject
    this.store.putObject(after)
    return done(1, { kind: 'object', before: null, after, ...(snap ? { echo: true as const } : {}) })
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
    const grid = this.store.getSettings().grid
    const snap = before.type === 'image' && grid.snap && touchesGeometry(patch)
    const parsed = TableObjectSchema.safeParse({
      ...mergePatch(before, snap ? snapPatch(patch, grid.size) : patch),
      version: before.version + 1,
      updatedBy: clientId,
    })
    if (!parsed.success) return rejectInvalid()
    this.store.putObject(parsed.data)
    return done(parsed.data.version, { kind: 'object', before, after: parsed.data, ...(snap ? { echo: true as const } : {}) })
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
    const hidden = before.visibility === 'all' && after.visibility === 'gm'
    const locked = !before.locked && after.locked
    const released = hidden || locked ? this.releasePlayerLocks(id) : []
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

  // Mudar o tamanho ou ligar o encaixe não move objetos existentes.
  private settingsUpdate(patch: SettingsPatch): OpResult {
    const settings = mergeSettings(this.store.getSettings(), patch)
    this.store.putSettings(settings)
    return done(0, { kind: 'settings', settings })
  }

  private memberUpdate(clientId: string, patch: MemberPatch, online: Set<string>): OpResult {
    const member = this.store.getMember(clientId)
    if (!member) return reject('not_found', null)
    const updated: StoredMember = {
      ...member,
      ...(patch.nickname !== undefined ? { nickname: patch.nickname, nicknameSetByGm: true } : {}),
      ...(patch.color !== undefined ? { color: patch.color, colorSetByGm: true } : {}),
    }
    this.store.upsertMember(updated)
    return done(0, { kind: 'memberUpdated', member: toMember(updated, online.has(clientId)) })
  }

  chatEntry(authorId: string, body: ChatBody): ChatEntry {
    const base = { id: crypto.randomUUID(), at: this.now(), authorId }
    switch (body.kind) {
      case 'message':
        return { ...base, kind: 'message', text: body.text }
      case 'image':
        return { ...base, kind: 'image', assetKey: body.assetKey, width: body.width, height: body.height }
      case 'roll':
        return { ...base, kind: 'roll', request: body.request, result: rollDice(body.request, this.rng), secret: body.secret }
    }
  }

  /** Só o canal da mesa é guardado; conversas privadas nunca passam por aqui. */
  appendTableChat(entry: ChatEntry): void {
    this.store.appendChat(entry)
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
    const object = this.store.getObject(objectId)
    if (!object || !this.canSeeObject(lock.role, object) || !this.canEditObject(clientId, lock.role, object)) {
      this.locks.delete(objectId)
      return false
    }
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

Run: `pnpm --filter @mesa/worker test -- engine && pnpm --filter @mesa/worker typecheck`
Expected: PASS (inclusive os testes do M2, que continuam iguais).

- [ ] **Step 5: Testes do DO (falham)**

Em `apps/worker/test/table-do.test.ts`, troque o import do shared por

```ts
import type { NewObject, Op } from '@mesa/shared'
```

e acrescente no fim do arquivo:

```ts

describe('TableDO — M3: configurações, membros e encaixe', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })

  async function table() {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    const { welcome: gmWelcome } = await gm.hello('Mestre', { gmSecret })
    const { clientId: playerId, welcome } = await p.hello('Ana')
    return { tableId, gmSecret, gm, p, playerId, playerSecret: welcome.clientSecret, gmColor: gmWelcome.self.color }
  }

  it('settingsUpdate: jogador recusado; mestre muda e todos recebem; snapshot traz as configurações', async () => {
    const { tableId, gm, p } = await table()
    p.send(op('op_p', { kind: 'settingsUpdate', patch: { grid: { enabled: true } } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_p', reason: 'forbidden' })
    gm.send(op('op_g', { kind: 'settingsUpdate', patch: { grid: { enabled: true, size: 50 } } }))
    await gm.waitFor('ack', (m) => m.opId === 'op_g')
    const expected = { grid: { enabled: true, size: 50, snap: false } }
    expect(await p.waitFor('settingsUpdated')).toEqual({ t: 'settingsUpdated', settings: expected })
    expect(await gm.waitFor('settingsUpdated')).toEqual({ t: 'settingsUpdated', settings: expected })
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Bia')).welcome.snapshot.settings).toEqual(expected)
  })

  it('memberUpdate: só o mestre; todos recebem; o hello seguinte não sobrescreve apelido nem cor', async () => {
    const { tableId, gm, p, playerId, playerSecret, gmColor } = await table()
    p.send(op('op_p', { kind: 'memberUpdate', clientId: playerId, patch: { nickname: 'Hacker' } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'op_p', reason: 'forbidden' })
    gm.send(op('op_g', { kind: 'memberUpdate', clientId: playerId, patch: { nickname: 'Aninha', color: gmColor } }))
    expect((await p.waitFor('memberUpdated')).member).toMatchObject({ clientId: playerId, nickname: 'Aninha', color: gmColor, online: true })
    expect((await gm.waitFor('memberUpdated')).member).toMatchObject({ nickname: 'Aninha' })
    p.close()
    await gm.waitFor('memberLeft')
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Ana de novo', { clientId: playerId, clientSecret: playerSecret })
    expect(welcome.self).toMatchObject({ nickname: 'Aninha', color: gmColor })
    expect((await gm.waitFor('memberJoined', (m) => m.member.clientId === playerId && m.member.nickname === 'Aninha')).member.color).toBe(gmColor)
  })

  it('encaixe: o autor também recebe o objeto encaixado; traço não encaixa nem ecoa', async () => {
    const { gm, p } = await table()
    gm.send(op('op_s', { kind: 'settingsUpdate', patch: { grid: { snap: true, size: 50 } } }))
    await p.waitFor('settingsUpdated')
    const obj = tokenObject({ x: 26, y: 74 })
    p.send(op('op_1', { kind: 'create', object: obj }))
    expect(await p.waitFor('ack', (m) => m.opId === 'op_1')).toMatchObject({ version: 1 })
    expect((await p.waitFor('op')).op).toMatchObject({ kind: 'upsert', object: { id: obj.id, x: 50, y: 50, width: 50, height: 50 } })
    expect((await gm.waitFor('op')).op).toMatchObject({ kind: 'upsert', object: { id: obj.id, x: 50, y: 50 } })
    const stroke: NewObject = {
      id: 'st1', type: 'stroke', layerId: 'drawings', x: 26, y: 74, width: 10, height: 10, rotation: 0, zIndex: 1,
      segments: [[0, 0, 10, 10]], color: '#ffffff', strokeWidth: 3,
    }
    p.send(op('op_2', { kind: 'create', object: stroke }))
    const seen = await gm.waitFor('op', (m) => m.op.kind === 'upsert' && m.op.object.id === 'st1')
    expect(seen.op).toMatchObject({ object: { x: 26, y: 74 } })
    await p.expectNone('op', (m) => m.op.kind === 'upsert' && m.op.object.id === 'st1')
  })
})
```

Run: `pnpm --filter @mesa/worker test -- table-do`
Expected: FAIL — ninguém recebe `settingsUpdated`/`memberUpdated` e o autor não recebe o eco.

- [ ] **Step 6: Difusão no `TableDO`**

Em `apps/worker/src/table-do.ts`:

Em `onHello`, troque `snapshot: this.engine.snapshot(role, online),` por

```ts
      snapshot: this.engine.snapshot(role, online, msg.clientId),
```

Em `broadcastEffect`, troque o `case 'object': { … }` inteiro por

```ts
      case 'object': {
        const { before, after } = effect
        // Com `echo` (encaixe na grade) o autor também recebe: o `ack` não traz a posição corrigida.
        this.broadcast(effect.echo ? null : author.sessionId, (other) => {
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
```

e acrescente, depois do `case 'released': … return`:

```ts
      case 'settings':
        this.broadcast(null, () => ({ t: 'settingsUpdated', settings: effect.settings }))
        return
      case 'memberUpdated':
        this.broadcast(null, () => ({ t: 'memberUpdated', member: effect.member }))
        return
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add apps/worker/src/crypto.ts apps/worker/src/engine/engine.ts apps/worker/src/table-do.ts apps/worker/test/engine.test.ts apps/worker/test/table-do.test.ts
git commit -m "feat(m3): Task 4 — engine do M3 e difusão de configurações, membros e encaixe" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Worker — chat no `TableDO`: mesa, rolagem secreta, conversa privada, limites, régua, ping e GIF

**Files:**
- Create: `apps/worker/src/rate-limit.ts`
- Modify: `apps/worker/src/table-do.ts` (imports, campos, `webSocketMessage`, novo `onChat`, `onPresence`)
- Modify: `packages/shared/src/constants.ts` (`ALLOWED_UPLOAD_TYPES`)
- Test: `apps/worker/test/rate-limit.test.ts` (NOVO), `apps/worker/test/table-do.test.ts` (acrescentar no fim), `apps/worker/test/files.test.ts` (trocar um teste e acrescentar outro)

**Interfaces:**
- Consumes: (Task 1) `CHAT_RATE_PER_SEC`, `PING_RATE_PER_SEC`, `ChatRejectReason`; (Task 3) `ChatMessage`, `readChatReqId`, presença `ruler`/`rulerEnd`/`ping`; (Task 4) `engine.chatEntry`, `engine.appendTableChat`, `engine.canSeeChat`, `ChatBody`.
- Produces:
  - `class RateLimiter { constructor(limit: number, windowMs: number, now?: () => number); allow(key: string): boolean }` — janela deslizante; tentativa recusada não conta
  - Comportamento do DO: `chatAck` ao remetente; `chat { channel: 'table' }` para todos que `canSeeChat` (inclusive o autor) e grava; `chat { channel: { dm: <outro> } }` só às sessões do remetente e do destinatário, sem gravar; `chatReject` `invalid` (schema, privada para si mesmo), `not_found` (destinatário offline), `rate_limited` (mais de 5/s somando canais)
  - Presença: `ruler`/`rulerEnd` para os outros; `ping` para todos (inclusive o autor), `recenter` só de mestre, máx. 3/s por pessoa
  - `ALLOWED_UPLOAD_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif']`

- [ ] **Step 1: Teste do `RateLimiter` (falha)**

Crie `apps/worker/test/rate-limit.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { RateLimiter } from '../src/rate-limit'

describe('RateLimiter', () => {
  it('permite N por janela, por chave, e libera quando a janela passa', () => {
    let t = 0
    const limiter = new RateLimiter(3, 1000, () => t)
    expect([limiter.allow('a'), limiter.allow('a'), limiter.allow('a'), limiter.allow('a')]).toEqual([true, true, true, false])
    expect(limiter.allow('b')).toBe(true)
    t = 999
    expect(limiter.allow('a')).toBe(false)
    t = 1000
    expect(limiter.allow('a')).toBe(true)
  })

  it('tentativas recusadas não contam', () => {
    let t = 0
    const limiter = new RateLimiter(1, 1000, () => t)
    expect(limiter.allow('a')).toBe(true)
    t = 500
    expect(limiter.allow('a')).toBe(false)
    t = 1000
    expect(limiter.allow('a')).toBe(true)
  })
})
```

Run: `pnpm --filter @mesa/worker test -- rate-limit`
Expected: FAIL — módulo inexistente.

- [ ] **Step 2: `RateLimiter`**

Crie `apps/worker/src/rate-limit.ts`:

```ts
/** Janela deslizante por chave, só em memória (zera se o DO hibernar). Tentativas recusadas não contam. */
export class RateLimiter {
  private hits = new Map<string, number[]>()

  constructor(
    private limit: number,
    private windowMs: number,
    private now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const t = this.now()
    const recent = (this.hits.get(key) ?? []).filter((h) => t - h < this.windowMs)
    const allowed = recent.length < this.limit
    if (allowed) recent.push(t)
    if (recent.length === 0) this.hits.delete(key)
    else this.hits.set(key, recent)
    return allowed
  }
}
```

Run: `pnpm --filter @mesa/worker test -- rate-limit`
Expected: PASS.

- [ ] **Step 3: Testes do chat, presença e GIF (falham)**

Acrescente no fim de `apps/worker/test/table-do.test.ts`:

```ts

describe('TableDO — M3: chat, dados e presença', () => {
  const d20 = { die: 20, count: 1, bonus: 0, mode: 'normal' } as const

  async function trio() {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const a = await TestClient.connect(tableId)
    const b = await TestClient.connect(tableId)
    const { clientId: gmId } = await gm.hello('Mestre', { gmSecret })
    const { clientId: aId, welcome } = await a.hello('Ana')
    const { clientId: bId } = await b.hello('Bia')
    return { tableId, gmSecret, gm, a, b, gmId, aId, bId, aSecret: welcome.clientSecret }
  }

  it('mensagem da mesa: ack para o autor e chat para todos, inclusive ele', async () => {
    const { gm, a, b, aId } = await trio()
    a.send({ t: 'chatSend', reqId: 'c1', channel: 'table', text: 'olá' })
    expect(await a.waitFor('chatAck')).toEqual({ t: 'chatAck', reqId: 'c1' })
    for (const c of [gm, a, b]) {
      expect(await c.waitFor('chat')).toMatchObject({ channel: 'table', entry: { kind: 'message', text: 'olá', authorId: aId } })
    }
  })

  it('rolagem secreta chega ao autor e ao mestre, nunca a outro jogador; snapshot idem', async () => {
    const { tableId, gmSecret, gm, a, b } = await trio()
    a.send({ t: 'roll', reqId: 'r1', channel: 'table', request: d20, secret: true })
    expect((await a.waitFor('chat')).entry).toMatchObject({ kind: 'roll', secret: true })
    expect((await gm.waitFor('chat')).entry).toMatchObject({ kind: 'roll', secret: true })
    await b.expectNone('chat')
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Caio')).welcome.snapshot.chat).toEqual([])
    const gm2 = await TestClient.connect(tableId)
    expect((await gm2.hello('Mestre 2', { gmSecret })).welcome.snapshot.chat).toHaveLength(1)
  })

  it('rolagem com vantagem: dois dados de 1 a 20, mantém o maior, soma o bônus', async () => {
    const { a, b } = await trio()
    a.send({ t: 'roll', reqId: 'r1', channel: 'table', request: { die: 20, count: 1, bonus: 3, mode: 'advantage' }, secret: false })
    const { entry } = await b.waitFor('chat')
    if (entry.kind !== 'roll') throw new Error('esperava rolagem')
    expect(entry.result.rolls).toHaveLength(2)
    for (const v of entry.result.rolls) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(20)
    }
    expect(entry.result.kept).toEqual([Math.max(...entry.result.rolls)])
    expect(entry.result.total).toBe(entry.result.kept[0] + 3)
  })

  // Review Focus #3
  it('conversa privada: só as sessões do remetente (todas as abas) e do destinatário; mestre não recebe; nada é guardado', async () => {
    const { tableId, gmSecret, gm, a, b, aId, bId, aSecret } = await trio()
    const a2 = await TestClient.connect(tableId)
    await a2.hello('Ana', { clientId: aId, clientSecret: aSecret })
    a.send({ t: 'chatSend', reqId: 'd1', channel: { dm: bId }, text: 'segredo' })
    expect(await a.waitFor('chatAck')).toEqual({ t: 'chatAck', reqId: 'd1' })
    expect(await a.waitFor('chat')).toMatchObject({ channel: { dm: bId }, entry: { text: 'segredo', authorId: aId } })
    expect(await a2.waitFor('chat')).toMatchObject({ channel: { dm: bId }, entry: { text: 'segredo' } })
    expect(await b.waitFor('chat')).toMatchObject({ channel: { dm: aId }, entry: { text: 'segredo' } })
    await gm.expectNone('chat')
    expect(JSON.stringify(gm.messages)).not.toContain('segredo')
    const gm2 = await TestClient.connect(tableId)
    expect((await gm2.hello('Mestre 2', { gmSecret })).welcome.snapshot.chat).toEqual([])
  })

  it('privada: destinatário offline → not_found; para si mesmo → invalid; rolagem secreta na privada → invalid', async () => {
    const { a, b, aId, bId } = await trio()
    b.close()
    await a.waitFor('memberLeft')
    a.send({ t: 'chatSend', reqId: 'd1', channel: { dm: bId }, text: 'oi' })
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'd1', reason: 'not_found' })
    a.send({ t: 'chatSend', reqId: 'd2', channel: { dm: aId }, text: 'oi' })
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'd2', reason: 'invalid' })
    a.send({ t: 'roll', reqId: 'd3', channel: { dm: bId }, request: d20, secret: true })
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'd3', reason: 'invalid' })
  })

  it('texto acima de 500 caracteres recebe chatReject invalid', async () => {
    const { a } = await trio()
    a.send(JSON.stringify({ t: 'chatSend', reqId: 'c9', channel: 'table', text: 'x'.repeat(501) }))
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'c9', reason: 'invalid' })
  })

  // Review Focus #2
  it('limite de 5 envios por segundo por pessoa, somando mesa, privada e rolagem', async () => {
    const { a, bId } = await trio()
    for (let i = 0; i < 3; i++) a.send({ t: 'chatSend', reqId: `t${i}`, channel: 'table', text: `m${i}` })
    for (let i = 0; i < 2; i++) a.send({ t: 'chatSend', reqId: `d${i}`, channel: { dm: bId }, text: `p${i}` })
    a.send({ t: 'roll', reqId: 'x', channel: 'table', request: d20, secret: false })
    expect(await a.waitFor('chatReject')).toEqual({ t: 'chatReject', reqId: 'x', reason: 'rate_limited' })
    for (const reqId of ['t0', 't1', 't2', 'd0', 'd1']) await a.waitFor('chatAck', (m) => m.reqId === reqId)
  })

  it('régua vai só para os outros; ping vai para todos; recenter de jogador vira false', async () => {
    const { gm, a, b, gmId, aId } = await trio()
    a.send({ t: 'presence', p: { kind: 'ruler', from: { x: 35, y: 35 }, to: { x: 200, y: 35 } } })
    expect(await b.waitFor('presence')).toEqual({
      t: 'presence', clientId: aId, p: { kind: 'ruler', from: { x: 35, y: 35 }, to: { x: 200, y: 35 } },
    })
    a.send({ t: 'presence', p: { kind: 'rulerEnd' } })
    expect((await b.waitFor('presence')).p).toEqual({ kind: 'rulerEnd' })
    await a.expectNone('presence')
    a.send({ t: 'presence', p: { kind: 'ping', x: 1, y: 2, recenter: true } })
    expect((await b.waitFor('presence')).p).toEqual({ kind: 'ping', x: 1, y: 2, recenter: false })
    expect((await a.waitFor('presence')).p).toEqual({ kind: 'ping', x: 1, y: 2, recenter: false })
    gm.send({ t: 'presence', p: { kind: 'ping', x: 5, y: 6, recenter: true } })
    expect(await b.waitFor('presence', (m) => m.clientId === gmId)).toMatchObject({ p: { kind: 'ping', recenter: true } })
  })

  it('ping: no máximo 3 por segundo por pessoa', async () => {
    const { a, b } = await trio()
    for (let i = 0; i < 5; i++) a.send({ t: 'presence', p: { kind: 'ping', x: i, y: 0, recenter: false } })
    await b.waitFor('presence', (m) => m.p.kind === 'ping' && m.p.x === 2)
    await b.expectNone('presence', (m) => m.p.kind === 'ping' && m.p.x >= 3)
  })
})
```

Em `apps/worker/test/files.test.ts`, troque o teste `recusa SVG e GIF com 415` (junto com o comentário `// Review Focus #5` do M2 logo acima dele) por:

```ts
  it('recusa SVG com 415', async () => {
    const { tableId } = await createTable()
    expect((await upload(tableId, '<svg/>', 'image/svg+xml')).status).toBe(415)
  })

  it('aceita GIF sem conversão e serve como image/gif', async () => {
    const { tableId } = await createTable()
    const res = await upload(tableId, GIF_1x1, 'image/gif')
    expect(res.status).toBe(201)
    const { assetKey } = await res.json<{ assetKey: string }>()
    const file = await SELF.fetch(`https://mesa.test/files/${assetKey}`)
    expect(file.headers.get('Content-Type')).toBe('image/gif')
    expect(new Uint8Array(await file.arrayBuffer())).toEqual(GIF_1x1)
  })
```

e acrescente, logo depois da constante `PNG_1x1`:

```ts

const GIF_1x1 = Uint8Array.from(atob('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'), (c) => c.charCodeAt(0))
```

Run: `pnpm --filter @mesa/worker test`
Expected: FAIL — o DO ignora `chatSend`/`roll`/`chatImage`, não retransmite régua/ping e o upload de GIF dá 415.

- [ ] **Step 4: GIF no upload**

Em `packages/shared/src/constants.ts`, troque a linha de `ALLOWED_UPLOAD_TYPES` por:

```ts
export const ALLOWED_UPLOAD_TYPES = ['image/webp', 'image/png', 'image/jpeg', 'image/gif']
```

(O `uploadAsset` do worker já grava o `Content-Type` recebido; GIF passa sem conversão.)

- [ ] **Step 5: Chat e presença no `TableDO`**

Em `apps/worker/src/table-do.ts`:

Troque o bloco de imports do topo (até `import { randomSecret, … } from './crypto'`) por:

```ts
import { DurableObject } from 'cloudflare:workers'
import {
  CHAT_RATE_PER_SEC,
  ClientMessageSchema,
  DEFAULT_LAYERS,
  PING_RATE_PER_SEC,
  readChatReqId,
  readOpId,
  type ChatMessage,
  type ChatRejectReason,
  type ClientMessage,
  type Role,
  type ServerMessage,
  type TableObject,
} from '@mesa/shared'
import { TableEngine, type ChatBody, type LayerChange, type OpEffect } from './engine/engine'
import { SqlStore } from './engine/sql-store'
import { randomSecret, safeEqual, sha256Hex } from './crypto'
import { RateLimiter } from './rate-limit'
```

Logo depois de `type Msg<T extends ClientMessage['t']> = Extract<ClientMessage, { t: T }>`, acrescente:

```ts

function chatBody(msg: ChatMessage): ChatBody {
  switch (msg.t) {
    case 'chatSend':
      return { kind: 'message', text: msg.text }
    case 'chatImage':
      return { kind: 'image', assetKey: msg.assetKey, width: msg.width, height: msg.height }
    case 'roll':
      return { kind: 'roll', request: msg.request, secret: msg.secret }
  }
}
```

Nos campos da classe, depois de `private strokeLayers = new Map<string, string>()`, acrescente:

```ts
  // Limites por pessoa (clientId), só em memória.
  private chatLimiter = new RateLimiter(CHAT_RATE_PER_SEC, 1000)
  private pingLimiter = new RateLimiter(PING_RATE_PER_SEC, 1000)
```

Em `webSocketMessage`, troque o bloco `if (!parsed.success) { … }` por:

```ts
    if (!parsed.success) {
      const opId = readOpId(json)
      const reqId = readChatReqId(json)
      if (opId && att) this.send(ws, { t: 'reject', opId, reason: 'invalid' })
      else if (reqId && att) this.send(ws, { t: 'chatReject', reqId, reason: 'invalid' })
      else console.warn('mensagem inválida', parsed.error.issues[0]?.message)
      return
    }
```

e no `switch (msg.t)` do fim do método acrescente:

```ts
      case 'chatSend':
      case 'chatImage':
      case 'roll':
        return this.onChat(ws, att, msg)
```

Logo antes de `private onPresence(`, acrescente:

```ts
  private onChat(ws: WebSocket, att: Attachment, msg: ChatMessage): void {
    const fail = (reason: ChatRejectReason) => this.send(ws, { t: 'chatReject', reqId: msg.reqId, reason })
    const dm = msg.channel === 'table' ? null : msg.channel.dm
    if (dm === att.clientId) return fail('invalid')
    if (!this.chatLimiter.allow(att.clientId)) return fail('rate_limited')
    if (dm !== null && !this.onlineClientIds().has(dm)) return fail('not_found')

    const entry = this.engine.chatEntry(att.clientId, chatBody(msg))
    this.send(ws, { t: 'chatAck', reqId: msg.reqId })
    if (dm === null) {
      this.engine.appendTableChat(entry)
      this.broadcast(null, (other) =>
        this.engine.canSeeChat(other.clientId, other.role, entry) ? { t: 'chat', channel: 'table', entry } : null,
      )
      return
    }
    // Conversa privada: só retransmite, nunca grava; `dm` aponta sempre para a outra pessoa.
    this.broadcast(null, (other) => {
      if (other.clientId === att.clientId) return { t: 'chat', channel: { dm }, entry }
      if (other.clientId === dm) return { t: 'chat', channel: { dm: att.clientId }, entry }
      return null
    })
  }

```

Em `onPresence`, acrescente estes `case` dentro do `switch (p.kind)`, depois do `case 'stroke': … return`:

```ts
      case 'ruler':
      case 'rulerEnd':
        this.broadcast(att.sessionId, () => out)
        return
      case 'ping': {
        if (!this.pingLimiter.allow(att.clientId)) return
        // Só o mestre centraliza a tela dos outros; de jogador vira ping comum.
        const ping: ServerMessage = { t: 'presence', clientId: att.clientId, p: { ...p, recenter: p.recenter && att.role === 'gm' } }
        this.broadcast(null, () => ping)
        return
      }
```

- [ ] **Step 6: Rodar e ver passar**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/worker typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/rate-limit.ts apps/worker/src/table-do.ts packages/shared/src/constants.ts apps/worker/test/rate-limit.test.ts apps/worker/test/table-do.test.ts apps/worker/test/files.test.ts
git commit -m "feat(m3): Task 5 — chat, dados, conversa privada, limites, régua, ping e GIF no servidor" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Web — estado: configurações, membros, régua, ping e opções de forma

**Files:**
- Modify: `apps/web/src/store/state.ts` (arquivo inteiro)
- Modify: `apps/web/src/store/reducers.ts` (imports, `rejectText`, `withMember`, `applyOptimistic`, `revertLocal`, `reduceServer`)
- Modify: `apps/web/src/store/tableStore.ts` (imports, throttle da régua, ações novas, `setTool`/`setPen`)
- Test: `apps/web/test/reducers-m3.test.ts` (NOVO)

**Interfaces:**
- Consumes: (Task 1) `DEFAULT_SETTINGS`, `mergeSettings`, `cellCenter`, `Point`, `TableSettings`, `SettingsPatch`, `PING_DURATION_MS`, `RULER_THROTTLE_MS`; (Task 3) `ShapeKind`, `MemberPatch`, ops/mensagens/presença do M3.
- Produces:
  - `Tool = 'select' | 'hand' | 'pencil' | 'ruler' | 'shape'`
  - `interface Ruler { from: Point; to: Point }`, `interface Ping { id: number; clientId: string; x: number; y: number; at: number }`, `interface ShapeFill { enabled: boolean; color: string | null; opacity: number }` (`color: null` = cor do contorno)
  - `LocalPrev` ganha `{ kind: 'settings'; settings: TableSettings }`
  - `TableState` ganha `settings`, `rulers: Record<string, Ruler>` (dos outros), `ownRuler: Ruler | null`, `pings: Ping[]`, `cameraTarget: { x: number; y: number; seq: number } | null`, `shapeKind: ShapeKind` (padrão `'rect'`), `shapeFill: ShapeFill` (padrão `{ enabled: false, color: null, opacity: 0.3 }`)
  - `TableActions` ganha `updateSettings(patch: SettingsPatch): void`, `updateMember(clientId: string, patch: MemberPatch): void`, `setShapeKind(kind: ShapeKind): void` (também ativa a ferramenta Formas), `setShapeFill(patch: Partial<ShapeFill>): void`, `rulerClick(p: Point): void`, `rulerMove(p: Point): void`, `rulerCancel(): void`, `ping(p: Point, recenter: boolean): void`
  - Textos: recusa `forbidden` de `settingsUpdate`/`memberUpdate` → **"Só o mestre pode fazer isso"**; `not_found` de `memberUpdate` → **"Essa pessoa não está mais na lista"**

- [ ] **Step 1: Testes (falham)**

Crie `apps/web/test/reducers-m3.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, PING_DURATION_MS, type Member, type Presence, type ServerMessage, type Snapshot } from '@mesa/shared'
import { reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const gm: Member = { clientId: 'gm1', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const ana: Member = { clientId: 'p1', nickname: 'Ana', color: '#3cb44b', role: 'player', online: true }

const welcome = (self: Member, over: Partial<Snapshot> = {}): ServerMessage => ({
  t: 'welcome',
  self,
  snapshot: {
    meta: { id: 'T', name: 'M' }, members: [gm, ana], layers: DEFAULT_LAYERS, objects: [], locks: [], notes: {},
    settings: DEFAULT_SETTINGS, chat: [], ...over,
  },
})
const joined = (self: Member, over: Partial<Snapshot> = {}): TableState => reduceServer(makeInitialState(), welcome(self, over), 0)
const presence = (s: TableState, clientId: string, p: Presence, now = 0) => reduceServer(s, { t: 'presence', clientId, p }, now)
const grid = { enabled: true, size: 50, snap: true }

describe('configurações', () => {
  it('welcome traz as configurações da mesa', () => {
    expect(joined(ana, { settings: { grid } }).settings).toEqual({ grid })
  })

  it('settingsUpdate é otimista e volta atrás se recusado, com aviso', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'settingsUpdate', patch: { grid: { enabled: true } } }, { isUndo: false })
    expect(s.settings.grid.enabled).toBe(true)
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'forbidden' }, 0)
    expect(s.settings).toEqual(DEFAULT_SETTINGS)
    expect(s.toasts.at(-1)?.text).toBe('Só o mestre pode fazer isso')
  })

  it('settingsUpdated substitui as configurações; a op não entra no desfazer', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'settingsUpdate', patch: { grid: { enabled: true } } }, { isUndo: false })
    s = reduceServer(s, { t: 'ack', opId: 'op_1', version: 0 }, 0)
    expect(s.undoStack).toEqual([])
    s = reduceServer(s, { t: 'settingsUpdated', settings: { grid } }, 0)
    expect(s.settings).toEqual({ grid })
  })

  it('settingsUpdate pendente volta por cima de um welcome novo', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'settingsUpdate', patch: { grid: { snap: true } } }, { isUndo: false })
    s = reduceServer(s, welcome(gm), 0)
    expect(s.settings.grid.snap).toBe(true)
  })
})

describe('membros', () => {
  it('memberUpdated muda a lista e, se for eu, o self', () => {
    const s = reduceServer(joined(ana), { t: 'memberUpdated', member: { ...ana, nickname: 'Aninha', color: '#123456' } }, 0)
    expect(s.members.p1).toMatchObject({ nickname: 'Aninha', color: '#123456' })
    expect(s.self).toMatchObject({ clientId: 'p1', nickname: 'Aninha', color: '#123456', role: 'player' })
  })

  it('memberUpdated de outra pessoa não mexe no self', () => {
    const s = reduceServer(joined(gm), { t: 'memberUpdated', member: { ...ana, nickname: 'Aninha' } }, 0)
    expect(s.self?.nickname).toBe('Mestre')
    expect(s.members.p1.nickname).toBe('Aninha')
  })

  it('memberUpdate do mestre é otimista e volta atrás no reject', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'memberUpdate', clientId: 'p1', patch: { nickname: 'Aninha' } }, { isUndo: false })
    expect(s.members.p1.nickname).toBe('Aninha')
    s = reduceServer(s, { t: 'reject', opId: 'op_1', reason: 'not_found' }, 0)
    expect(s.members.p1.nickname).toBe('Ana')
    expect(s.toasts.at(-1)?.text).toBe('Essa pessoa não está mais na lista')
  })

  it('memberUpdate pendente volta por cima de um welcome novo', () => {
    let s = reduceSubmit(joined(gm), 'op_1', { kind: 'memberUpdate', clientId: 'p1', patch: { color: '#123456' } }, { isUndo: false })
    s = reduceServer(s, welcome(gm), 0)
    expect(s.members.p1.color).toBe('#123456')
  })
})

describe('régua', () => {
  const ruler: Presence = { kind: 'ruler', from: { x: 35, y: 35 }, to: { x: 100, y: 35 } }

  it('guarda uma régua por pessoa; rulerEnd remove', () => {
    let s = presence(joined(gm), 'p1', ruler)
    expect(s.rulers).toEqual({ p1: { from: { x: 35, y: 35 }, to: { x: 100, y: 35 } } })
    s = presence(s, 'p1', { kind: 'ruler', from: { x: 35, y: 35 }, to: { x: 200, y: 35 } })
    expect(s.rulers.p1.to).toEqual({ x: 200, y: 35 })
    s = presence(s, 'p1', { kind: 'rulerEnd' })
    expect(s.rulers).toEqual({})
  })

  it('memberLeft e memberRemoved removem a régua da pessoa', () => {
    let s = reduceServer(presence(joined(gm), 'p1', ruler), { t: 'memberLeft', clientId: 'p1' }, 0)
    expect(s.rulers).toEqual({})
    s = reduceServer(presence(s, 'p1', ruler), { t: 'memberRemoved', clientId: 'p1' }, 0)
    expect(s.rulers).toEqual({})
  })

  it('welcome (reconexão) limpa réguas, pings e pedido de câmera', () => {
    let s = presence(joined(ana), 'gm1', ruler)
    s = presence(s, 'gm1', { kind: 'ping', x: 1, y: 2, recenter: true }, 10)
    s = reduceServer(s, welcome(ana), 20)
    expect(s.rulers).toEqual({})
    expect(s.pings).toEqual([])
    expect(s.cameraTarget).toBeNull()
  })
})

describe('ping', () => {
  it('ping de outra pessoa com recenter pede a câmera; o meu e o comum não', () => {
    let s = presence(joined(ana), 'gm1', { kind: 'ping', x: 10, y: 20, recenter: true }, 1000)
    expect(s.pings).toMatchObject([{ clientId: 'gm1', x: 10, y: 20, at: 1000 }])
    expect(s.cameraTarget).toMatchObject({ x: 10, y: 20, seq: 1 })
    s = presence(s, 'p1', { kind: 'ping', x: 1, y: 1, recenter: true }, 1100)
    expect(s.cameraTarget?.seq).toBe(1)
    s = presence(s, 'gm1', { kind: 'ping', x: 3, y: 3, recenter: false }, 1200)
    expect(s.cameraTarget?.seq).toBe(1)
    expect(s.pings).toHaveLength(3)
  })

  it('pings com mais de 2 s saem da lista quando chega outro', () => {
    let s = presence(joined(ana), 'gm1', { kind: 'ping', x: 1, y: 1, recenter: false }, 0)
    s = presence(s, 'gm1', { kind: 'ping', x: 2, y: 2, recenter: false }, PING_DURATION_MS + 1)
    expect(s.pings.map((p) => p.x)).toEqual([2])
  })
})
```

Run: `pnpm --filter @mesa/web test -- reducers-m3`
Expected: FAIL — `settings`, `rulers` e `pings` não existem no estado.

- [ ] **Step 2: Estado**

Troque `apps/web/src/store/state.ts` inteiro por:

```ts
import {
  DEFAULT_SETTINGS,
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
  from: Point
  to: Point
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
  }
}
```

- [ ] **Step 3: Reducers**

Em `apps/web/src/store/reducers.ts`:

(a) Troque o import do `@mesa/shared` do topo por:

```ts
import {
  LOCK_TTL_MS,
  PING_DURATION_MS,
  UNDO_LIMIT,
  insertLayer,
  isObjectOp,
  mergeSettings,
  moveLayer,
  sortLayers,
  type Layer,
  type Member,
  type Op,
  type RejectReason,
  type ServerMessage,
  type TableObject,
} from '@mesa/shared'
```

(b) Troque a função `rejectText` inteira por:

```ts
export function rejectText(op: Op, reason: RejectReason, layerGone = false): string {
  if (op.kind === 'settingsUpdate' || op.kind === 'memberUpdate') {
    if (reason === 'forbidden') return 'Só o mestre pode fazer isso'
    if (reason === 'not_found') return 'Essa pessoa não está mais na lista'
  }
  // a camada sumiu no meio da ação: o servidor responde not_found, mas o que vale para o usuário é a permissão
  if (reason === 'not_found' && layerGone) return REJECT_TEXT.forbidden
  if (reason === 'forbidden') {
    if (op.kind === 'memberRemove') return 'Não dá para remover quem está online'
    if (op.kind === 'layerDelete') return 'Essa camada não pode ser removida'
    if (op.kind === 'layerMove') return 'A camada não pode ir para lá'
  }
  return REJECT_TEXT[reason]
}
```

(c) Troque `let toastSeq = 0` por:

```ts
let toastSeq = 0
let pingSeq = 0
```

(d) Logo depois da função `setNote`, acrescente:

```ts

/** Atualiza o membro na lista e, se for eu, o apelido e a cor do `self`. */
function withMember<S extends TableState>(s: S, member: Member): S {
  const self = s.self && s.self.clientId === member.clientId ? { ...s.self, nickname: member.nickname, color: member.color } : s.self
  return { ...s, self, members: { ...s.members, [member.clientId]: member } }
}
```

(e) Em `applyOptimistic`, troque o `default:` da Task 3 (o comentário e o `return { next: s, before: null, prev: null, layerOrders: null }`) por:

```ts
    case 'settingsUpdate':
      return {
        next: { ...s, settings: mergeSettings(s.settings, op.patch) },
        before: null,
        prev: { kind: 'settings', settings: s.settings },
        layerOrders: null,
      }
    case 'memberUpdate': {
      const member = s.members[op.clientId]
      return {
        next: member ? withMember(s, { ...member, ...op.patch }) : s,
        before: null,
        prev: { kind: 'member', member: member ?? null },
        layerOrders: null,
      }
    }
```

(f) Em `revertLocal`, troque

```ts
    case 'member':
      return prev.member ? { ...s, members: { ...s.members, [prev.member.clientId]: prev.member } } : s
```

por

```ts
    case 'member':
      return prev.member ? withMember(s, prev.member) : s
    case 'settings':
      return { ...s, settings: prev.settings }
```

(g) No `case 'welcome'` de `reduceServer`, acrescente ao objeto `base`, logo depois de `deniedGrabs: {},`:

```ts
        settings: snap.settings,
        rulers: {},
        pings: [],
        cameraTarget: null,
```

e, no `switch (p.op.kind)` do laço que reaplica pendentes, depois do `case 'memberRemove': … break`:

```ts
          case 'settingsUpdate':
            out = { ...out, settings: mergeSettings(out.settings, p.op.patch) }
            break
          case 'memberUpdate': {
            const member = out.members[p.op.clientId]
            if (member) out = withMember(out, { ...member, ...p.op.patch })
            break
          }
```

(h) No `case 'presence'`, dentro do `switch (p.kind)`, depois do `case 'strokeEnd': …`, acrescente:

```ts
        case 'ruler':
          return { ...s, rulers: { ...s.rulers, [msg.clientId]: { from: p.from, to: p.to } } }
        case 'rulerEnd':
          return { ...s, rulers: omit(s.rulers, msg.clientId) }
        case 'ping': {
          const pings = [
            ...s.pings.filter((old) => now - old.at < PING_DURATION_MS),
            { id: ++pingSeq, clientId: msg.clientId, x: p.x, y: p.y, at: now },
          ]
          // Só centraliza com pedido de outra pessoa (o servidor só deixa o mestre pedir).
          const recenter = p.recenter && msg.clientId !== selfId
          return {
            ...s,
            pings,
            cameraTarget: recenter ? { x: p.x, y: p.y, seq: (s.cameraTarget?.seq ?? 0) + 1 } : s.cameraTarget,
          }
        }
```

(i) No `case 'memberLeft'`, acrescente ao objeto devolvido a linha `rulers: omit(s.rulers, msg.clientId),`; troque o `case 'memberRemoved'` por:

```ts
    case 'memberRemoved':
      return {
        ...s,
        members: omit(s.members, msg.clientId),
        cursors: omit(s.cursors, msg.clientId),
        rulers: omit(s.rulers, msg.clientId),
      }
```

(j) Logo antes do `default:` (o da Task 3, no fim do `switch` de `reduceServer`), acrescente:

```ts
    case 'settingsUpdated':
      return { ...s, settings: msg.settings }

    case 'memberUpdated':
      return withMember(s, msg.member)
```

e troque o comentário desse `default:` por `// chat: Task 7.`

- [ ] **Step 4: Ações na store**

Em `apps/web/src/store/tableStore.ts`:

Troque as linhas de import de `@mesa/shared` e de `./state` por:

```ts
import type { MemberPatch, Op, Point, Presence, SettingsPatch, ShapeKind } from '@mesa/shared'
import { DEFAULT_LAYER_NAME, RULER_THROTTLE_MS, canControl, cellCenter } from '@mesa/shared'
```

e

```ts
import {
  makeInitialState,
  type Geometry,
  type PenMode,
  type Ruler,
  type ShapeFill,
  type TableState,
  type Toast,
  type Tool,
  type Viewport,
} from './state'
```

Na interface `TableActions`, acrescente antes do `}`:

```ts
  updateSettings(patch: SettingsPatch): void
  updateMember(clientId: string, patch: MemberPatch): void
  /** Escolhe o tipo e ativa a ferramenta Formas. */
  setShapeKind(kind: ShapeKind): void
  setShapeFill(patch: Partial<ShapeFill>): void
  /** Sem régua: começa no centro do quadrado clicado. Com régua: remove. */
  rulerClick(p: Point): void
  rulerMove(p: Point): void
  rulerCancel(): void
  ping(p: Point, recenter: boolean): void
```

Logo depois do `const cursorThrottle = throttle(…, 66)`, acrescente:

```ts

    const rulerThrottle = throttle((ruler: Ruler) => {
      sync?.send({ t: 'presence', p: { kind: 'ruler', from: ruler.from, to: ruler.to } })
    }, RULER_THROTTLE_MS)
```

Troque as linhas de `setTool` e `setPen` por:

```ts
      setTool(tool) {
        if (tool !== 'ruler') actions.rulerCancel()
        set({ tool, selectedId: tool === 'select' ? get().selectedId : null })
      },
      setPen(penMode) {
        actions.rulerCancel()
        set({ tool: 'pencil', penMode, selectedId: null })
      },
```

e acrescente, antes do `async addImageFile(file, at) {`:

```ts
      updateSettings(patch) {
        actions.submit({ kind: 'settingsUpdate', patch })
      },
      updateMember(clientId, patch) {
        actions.submit({ kind: 'memberUpdate', clientId, patch })
      },
      setShapeKind(shapeKind) {
        actions.rulerCancel()
        set({ tool: 'shape', shapeKind, selectedId: null })
      },
      setShapeFill: (patch) => set((s) => ({ shapeFill: { ...s.shapeFill, ...patch } })),
      rulerClick(p) {
        const s = get()
        if (s.ownRuler) {
          actions.rulerCancel()
          return
        }
        // Com a grade desligada o quadrado usa o tamanho configurado do mesmo jeito.
        const ruler: Ruler = { from: cellCenter(p, s.settings.grid.size), to: p }
        set({ ownRuler: ruler })
        rulerThrottle(ruler)
      },
      rulerMove(p) {
        const current = get().ownRuler
        if (!current) return
        const ruler: Ruler = { from: current.from, to: p }
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
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/store/state.ts apps/web/src/store/reducers.ts apps/web/src/store/tableStore.ts apps/web/test/reducers-m3.test.ts
git commit -m "feat(m3): Task 6 — estado de configurações, membros, régua, ping e formas" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Web — estado do chat: abas, não lidas, envio, rolagens, imagens e configuração do dado

**Files:**
- Modify: `apps/web/src/store/state.ts` (campos do chat)
- Create: `apps/web/src/store/chat.ts`
- Modify: `apps/web/src/store/reducers.ts` (welcome + casos `chat`/`chatAck`/`chatReject`; sai o `default`)
- Modify: `apps/web/src/store/tableStore.ts` (ações do chat)
- Create: `apps/web/src/lib/dice-config.ts`
- Modify: `apps/web/src/lib/image.ts` (acrescentar `prepareChatImage`)
- Test: `apps/web/test/chat.test.ts`, `apps/web/test/dice-config.test.ts` (NOVOS)

**Interfaces:**
- Consumes: (Task 1) `ChatChannel`, `ChatEntry`, `ChatRejectReason`, `CHAT_HISTORY_LIMIT`, `CHAT_TEXT_MAX`, `parseCommand`, `RollRequest`, `RollRequestSchema`, `DIE_SIDES`, `DieSides`, `RollMode`, `DICE_MAX_COUNT`, `DICE_MAX_BONUS`; (Task 3) mensagens `chat`/`chatAck`/`chatReject`, `ClientMessage`.
- Produces:
  - `TableState` ganha `chatTable: ChatEntry[]`, `chatDms: Record<string, ChatEntry[]>`, `chatTabs: string[]` (abas privadas abertas, por `clientId`, em ordem de abertura), `chatActive: ChatTab` (padrão `'table'`), `chatUnread: Record<ChatTab, number>` (ausente = 0), `chatOpen: boolean` (padrão `true`), `chatPending: Record<string, ChatChannel>` (por `reqId`)
  - Em `store/chat.ts`: `type ChatTab = string` (`'table'` ou `clientId`), `tabOf(channel): ChatTab`, `channelOf(tab): ChatChannel`, `reduceChatEntry(s, channel, entry)`, `openDmTab(s, clientId)`, `closeDmTab(s, clientId)`, `selectChatTab(s, tab)`, `setChatOpen(s, open)`, `chatRejectText(reason, channel | undefined, members): string`
  - `TableActions` ganha `sendChatText(text: string): boolean` (true = enviado; false = vazio, fórmula inválida ou sem conexão), `sendRoll(request: RollRequest, secret: boolean): boolean`, `sendChatImage(file: Blob): Promise<void>`, `openDm(clientId: string): void`, `closeDm(clientId: string): void`, `selectChatTab(tab: ChatTab): void`, `setChatOpen(open: boolean): void`
  - Em `lib/dice-config.ts`: `interface DiceConfig { die: DieSides; count: number; bonus: number; mode: RollMode; secret: boolean }`, `DEFAULT_DICE_CONFIG`, `DICE_CONFIG_KEY = 'mesa:dice'`, `type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>`, `normalizeDiceConfig(raw: unknown): DiceConfig`, `loadDiceConfig(storage?: KeyValueStorage | null): DiceConfig`, `saveDiceConfig(config: DiceConfig, storage?: KeyValueStorage | null): void`, `toRollRequest(config: DiceConfig): RollRequest`
  - `prepareChatImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }>` (GIF passa sem conversão)
  - Textos: `"Fórmula inválida — ex.: /r 2d6+3"`, `"Devagar…"`, `"<Apelido> está offline"`, `"Mensagem inválida"`

- [ ] **Step 1: Testes (falham)**

Crie `apps/web/test/chat.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type ChatEntry, type Member, type ServerMessage } from '@mesa/shared'
import { closeDmTab, openDmTab, selectChatTab, setChatOpen } from '../src/store/chat'
import { reduceServer } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const bia: Member = { clientId: 'bia', nickname: 'Bia', color: '#3cb44b', role: 'player', online: true }
const msg = (id: string, authorId = 'bia'): ChatEntry => ({ id, at: 0, authorId, kind: 'message', text: id })
const welcome = (chat: ChatEntry[] = []): ServerMessage => ({
  t: 'welcome',
  self: me,
  snapshot: { meta: { id: 'T', name: 'M' }, members: [me, bia], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat },
})
const joined = (chat: ChatEntry[] = []): TableState => reduceServer(makeInitialState(), welcome(chat), 0)
const receive = (s: TableState, channel: 'table' | { dm: string }, entry: ChatEntry) => reduceServer(s, { t: 'chat', channel, entry }, 0)
const ids = (list: ChatEntry[] | undefined) => (list ?? []).map((e) => e.id)

describe('chat da mesa', () => {
  it('welcome carrega o histórico já filtrado pelo servidor; aba Mesa ativa e painel aberto', () => {
    const s = joined([msg('a'), msg('b')])
    expect(ids(s.chatTable)).toEqual(['a', 'b'])
    expect(s.chatActive).toBe('table')
    expect(s.chatOpen).toBe(true)
  })

  it('não lidas só contam com a aba fora de vista e nunca para mensagens minhas', () => {
    let s = receive(joined(), 'table', msg('m1'))
    expect(ids(s.chatTable)).toEqual(['m1'])
    expect(s.chatUnread.table).toBeUndefined()
    s = setChatOpen(s, false)
    s = receive(s, 'table', msg('m2'))
    s = receive(s, 'table', msg('m3', 'me'))
    expect(s.chatUnread.table).toBe(1)
    s = setChatOpen(s, true)
    expect(s.chatUnread.table).toBeUndefined()
  })

  it('guarda no máximo 200 entradas', () => {
    let s = joined()
    for (let i = 0; i < 205; i++) s = receive(s, 'table', msg(`m${i}`))
    expect(s.chatTable).toHaveLength(200)
    expect(s.chatTable[0].id).toBe('m5')
  })

  it('chatReject mostra o aviso certo e esquece o pedido; chatAck só esquece', () => {
    let s: TableState = { ...joined(), chatPending: { r1: { dm: 'bia' }, r2: 'table', r3: 'table', r4: 'table' } }
    s = reduceServer(s, { t: 'chatReject', reqId: 'r1', reason: 'not_found' }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Bia está offline')
    s = reduceServer(s, { t: 'chatReject', reqId: 'r2', reason: 'rate_limited' }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Devagar…')
    s = reduceServer(s, { t: 'chatReject', reqId: 'r3', reason: 'invalid' }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Mensagem inválida')
    s = reduceServer(s, { t: 'chatAck', reqId: 'r4' }, 0)
    expect(s.chatPending).toEqual({})
  })
})

describe('conversas privadas', () => {
  it('mensagem recebida sem aba cria a aba sem tirar o foco e conta não lida', () => {
    const s = receive(joined(), { dm: 'bia' }, msg('d1'))
    expect(s.chatTabs).toEqual(['bia'])
    expect(s.chatActive).toBe('table')
    expect(s.chatUnread.bia).toBe(1)
    expect(ids(s.chatDms.bia)).toEqual(['d1'])
  })

  it('abrir a aba foca, abre o painel e zera as não lidas', () => {
    let s = setChatOpen(receive(joined(), { dm: 'bia' }, msg('d1')), false)
    s = openDmTab(s, 'bia')
    expect(s.chatActive).toBe('bia')
    expect(s.chatOpen).toBe(true)
    expect(s.chatUnread.bia).toBeUndefined()
    expect(s.chatTabs).toEqual(['bia'])
  })

  it('selecionar aba zera as não lidas dela', () => {
    let s = receive(joined(), { dm: 'bia' }, msg('d1'))
    s = selectChatTab(s, 'bia')
    expect(s.chatActive).toBe('bia')
    expect(s.chatUnread.bia).toBeUndefined()
  })

  it('fechar a aba apaga o histórico e volta para Mesa; reabrir começa vazia', () => {
    let s = openDmTab(receive(joined(), { dm: 'bia' }, msg('d1')), 'bia')
    s = closeDmTab(s, 'bia')
    expect(s.chatTabs).toEqual([])
    expect(s.chatDms).toEqual({})
    expect(s.chatActive).toBe('table')
    s = openDmTab(s, 'bia')
    expect(ids(s.chatDms.bia)).toEqual([])
  })

  it('reconexão mantém as abas privadas e o histórico local; pedidos pendentes são esquecidos', () => {
    let s: TableState = { ...receive(joined(), { dm: 'bia' }, msg('d1')), chatPending: { r1: 'table' } }
    s = reduceServer(s, welcome([msg('t1')]), 0)
    expect(s.chatTabs).toEqual(['bia'])
    expect(ids(s.chatDms.bia)).toEqual(['d1'])
    expect(ids(s.chatTable)).toEqual(['t1'])
    expect(s.chatPending).toEqual({})
  })
})
```

Crie `apps/web/test/dice-config.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_DICE_CONFIG,
  DICE_CONFIG_KEY,
  loadDiceConfig,
  normalizeDiceConfig,
  saveDiceConfig,
  toRollRequest,
  type KeyValueStorage,
} from '../src/lib/dice-config'

class FakeStorage implements KeyValueStorage {
  data = new Map<string, string>()
  getItem(key: string) { return this.data.get(key) ?? null }
  setItem(key: string, value: string) { this.data.set(key, value) }
}

describe('configuração do dado', () => {
  it('sem nada guardado: 1d20 normal, sem bônus, não secreta', () => {
    expect(loadDiceConfig(new FakeStorage())).toEqual({ die: 20, count: 1, bonus: 0, mode: 'normal', secret: false })
    expect(DEFAULT_DICE_CONFIG).toEqual({ die: 20, count: 1, bonus: 0, mode: 'normal', secret: false })
  })

  it('lembra a última configuração', () => {
    const storage = new FakeStorage()
    saveDiceConfig({ die: 6, count: 3, bonus: -2, mode: 'normal', secret: true }, storage)
    expect(loadDiceConfig(storage)).toEqual({ die: 6, count: 3, bonus: -2, mode: 'normal', secret: true })
    saveDiceConfig({ die: 20, count: 1, bonus: 5, mode: 'advantage', secret: false }, storage)
    expect(loadDiceConfig(storage)).toEqual({ die: 20, count: 1, bonus: 5, mode: 'advantage', secret: false })
  })

  it('valores guardados inválidos são corrigidos; JSON quebrado volta ao padrão', () => {
    const storage = new FakeStorage()
    storage.setItem(DICE_CONFIG_KEY, JSON.stringify({ die: 7, count: 99, bonus: -500, mode: 'advantage', secret: 'sim' }))
    expect(loadDiceConfig(storage)).toEqual({ die: 20, count: 50, bonus: -100, mode: 'normal', secret: false })
    storage.setItem(DICE_CONFIG_KEY, '{x')
    expect(loadDiceConfig(storage)).toEqual(DEFAULT_DICE_CONFIG)
  })

  it('normalizeDiceConfig: quantidade > 1 volta para normal; números fora do limite são presos', () => {
    expect(normalizeDiceConfig({ die: 8, count: 2, bonus: 3.7, mode: 'disadvantage', secret: true })).toEqual({
      die: 8, count: 2, bonus: 3, mode: 'normal', secret: true,
    })
    expect(normalizeDiceConfig({ count: 0, bonus: Number.NaN })).toEqual({ ...DEFAULT_DICE_CONFIG, count: 1, bonus: 0 })
  })

  it('armazenamento indisponível não quebra', () => {
    expect(loadDiceConfig(null)).toEqual(DEFAULT_DICE_CONFIG)
    expect(() => saveDiceConfig(DEFAULT_DICE_CONFIG, null)).not.toThrow()
  })

  it('toRollRequest tira o campo secret', () => {
    expect(toRollRequest({ die: 12, count: 1, bonus: 1, mode: 'advantage', secret: true })).toEqual({ die: 12, count: 1, bonus: 1, mode: 'advantage' })
  })
})
```

Run: `pnpm --filter @mesa/web test -- chat dice-config`
Expected: FAIL — `store/chat` e `lib/dice-config` não existem.

- [ ] **Step 2: Campos do chat no estado**

Em `apps/web/src/store/state.ts`:

Acrescente `type ChatChannel,` e `type ChatEntry,` ao import do `@mesa/shared` (em ordem alfabética, depois de `DEFAULT_SETTINGS,`).

Acrescente ao fim da interface `TableState` (depois de `shapeFill: ShapeFill`):

```ts
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
```

e ao fim do objeto de `makeInitialState` (depois de `shapeFill: …`):

```ts
    chatTable: [],
    chatDms: {},
    chatTabs: [],
    chatActive: 'table',
    chatUnread: {},
    chatOpen: true,
    chatPending: {},
```

- [ ] **Step 3: `store/chat.ts`**

Crie `apps/web/src/store/chat.ts`:

```ts
import { CHAT_HISTORY_LIMIT, type ChatChannel, type ChatEntry, type ChatRejectReason, type Member } from '@mesa/shared'
import type { TableState } from './state'

/** 'table' ou o clientId da outra pessoa da conversa privada. */
export type ChatTab = string

export function tabOf(channel: ChatChannel): ChatTab {
  return channel === 'table' ? 'table' : channel.dm
}

export function channelOf(tab: ChatTab): ChatChannel {
  return tab === 'table' ? 'table' : { dm: tab }
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  if (!(key in record)) return record
  const { [key]: _removed, ...rest } = record
  return rest
}

/** Entrada nova: mesa (até 200) ou conversa privada (cria a aba sem tirar o foco). */
export function reduceChatEntry<S extends TableState>(s: S, channel: ChatChannel, entry: ChatEntry): S {
  const tab = tabOf(channel)
  const unseen = entry.authorId !== s.self?.clientId && (!s.chatOpen || s.chatActive !== tab)
  const chatUnread = unseen ? { ...s.chatUnread, [tab]: (s.chatUnread[tab] ?? 0) + 1 } : s.chatUnread
  if (tab === 'table') return { ...s, chatTable: [...s.chatTable, entry].slice(-CHAT_HISTORY_LIMIT), chatUnread }
  return {
    ...s,
    chatTabs: s.chatTabs.includes(tab) ? s.chatTabs : [...s.chatTabs, tab],
    chatDms: { ...s.chatDms, [tab]: [...(s.chatDms[tab] ?? []), entry] },
    chatUnread,
  }
}

export function openDmTab<S extends TableState>(s: S, clientId: string): S {
  return {
    ...s,
    chatOpen: true,
    chatActive: clientId,
    chatTabs: s.chatTabs.includes(clientId) ? s.chatTabs : [...s.chatTabs, clientId],
    chatUnread: without(s.chatUnread, clientId),
  }
}

/** Fechar a aba apaga o histórico dela (não há cópia no servidor). */
export function closeDmTab<S extends TableState>(s: S, clientId: string): S {
  return {
    ...s,
    chatTabs: s.chatTabs.filter((t) => t !== clientId),
    chatDms: without(s.chatDms, clientId),
    chatUnread: without(s.chatUnread, clientId),
    chatActive: s.chatActive === clientId ? 'table' : s.chatActive,
  }
}

export function selectChatTab<S extends TableState>(s: S, tab: ChatTab): S {
  return { ...s, chatActive: tab, chatUnread: without(s.chatUnread, tab) }
}

export function setChatOpen<S extends TableState>(s: S, open: boolean): S {
  return { ...s, chatOpen: open, chatUnread: open ? without(s.chatUnread, s.chatActive) : s.chatUnread }
}

export function chatRejectText(reason: ChatRejectReason, channel: ChatChannel | undefined, members: Record<string, Member>): string {
  if (reason === 'rate_limited') return 'Devagar…'
  if (reason === 'not_found') {
    const id = channel && channel !== 'table' ? channel.dm : null
    return `${(id && members[id]?.nickname) || 'A pessoa'} está offline`
  }
  return 'Mensagem inválida'
}
```

- [ ] **Step 4: Reducers do chat**

Em `apps/web/src/store/reducers.ts`:

Acrescente o import:

```ts
import { chatRejectText, reduceChatEntry } from './chat'
```

No objeto `base` do `case 'welcome'`, depois de `cameraTarget: null,`, acrescente:

```ts
        chatTable: snap.chat,
        chatUnread: omit(s.chatUnread, 'table'),
        // Pedidos sem resposta se perdem na reconexão; abas privadas e o histórico delas ficam.
        chatPending: {},
```

Troque o `default:` do fim do `switch` de `reduceServer` (com o comentário `// chat: Task 7.` e o `return s`) por:

```ts
    case 'chat':
      return reduceChatEntry(s, msg.channel, msg.entry)

    case 'chatAck':
      return { ...s, chatPending: omit(s.chatPending, msg.reqId) }

    case 'chatReject': {
      const channel = s.chatPending[msg.reqId]
      return addToast({ ...s, chatPending: omit(s.chatPending, msg.reqId) }, chatRejectText(msg.reason, channel, s.members))
    }
```

(Sem `default`: o `switch` volta a cobrir todas as mensagens do servidor e o TypeScript avisa se faltar alguma.)

- [ ] **Step 5: Configuração do dado e imagem do chat**

Crie `apps/web/src/lib/dice-config.ts`:

```ts
import { DICE_MAX_BONUS, DICE_MAX_COUNT, DIE_SIDES, type DieSides, type RollMode, type RollRequest } from '@mesa/shared'

export interface DiceConfig {
  die: DieSides
  count: number
  bonus: number
  mode: RollMode
  secret: boolean
}

export type KeyValueStorage = Pick<Storage, 'getItem' | 'setItem'>

export const DICE_CONFIG_KEY = 'mesa:dice'
export const DEFAULT_DICE_CONFIG: DiceConfig = { die: 20, count: 1, bonus: 0, mode: 'normal', secret: false }

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.trunc(value))) : fallback
}

/** Sempre devolve uma configuração válida para o RollRequestSchema. */
export function normalizeDiceConfig(raw: unknown): DiceConfig {
  const r = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const die = DIE_SIDES.find((d) => d === r.die) ?? DEFAULT_DICE_CONFIG.die
  const count = clampInt(r.count, 1, DICE_MAX_COUNT, 1)
  const bonus = clampInt(r.bonus, -DICE_MAX_BONUS, DICE_MAX_BONUS, 0)
  const mode: RollMode = count === 1 && (r.mode === 'advantage' || r.mode === 'disadvantage') ? r.mode : 'normal'
  return { die, count, bonus, mode, secret: r.secret === true }
}

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadDiceConfig(storage: KeyValueStorage | null = defaultStorage()): DiceConfig {
  try {
    const raw = storage?.getItem(DICE_CONFIG_KEY)
    return raw ? normalizeDiceConfig(JSON.parse(raw)) : { ...DEFAULT_DICE_CONFIG }
  } catch {
    return { ...DEFAULT_DICE_CONFIG }
  }
}

export function saveDiceConfig(config: DiceConfig, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(DICE_CONFIG_KEY, JSON.stringify(normalizeDiceConfig(config)))
  } catch {
    // armazenamento bloqueado: a configuração vale só até fechar o modal
  }
}

export function toRollRequest(config: DiceConfig): RollRequest {
  return { die: config.die, count: config.count, bonus: config.bonus, mode: config.mode }
}
```

Acrescente no fim de `apps/web/src/lib/image.ts`:

```ts

/** Imagem do chat: GIF vai sem conversão (mantém a animação); PNG/JPEG/WebP seguem o M1. */
export async function prepareChatImage(file: Blob): Promise<{ blob: Blob; width: number; height: number }> {
  if (file.type !== 'image/gif') return prepareImage(file)
  const bitmap = await createImageBitmap(file)
  const size = { width: bitmap.width, height: bitmap.height }
  bitmap.close()
  return { blob: file, ...size }
}
```

- [ ] **Step 6: Ações do chat na store**

Em `apps/web/src/store/tableStore.ts`:

Troque os imports do `@mesa/shared`, de `../lib/image` e de `./reducers` por:

```ts
import type { ChatChannel, ClientMessage, MemberPatch, Op, Point, Presence, RollRequest, SettingsPatch, ShapeKind } from '@mesa/shared'
import { CHAT_TEXT_MAX, DEFAULT_LAYER_NAME, RULER_THROTTLE_MS, canControl, cellCenter, parseCommand } from '@mesa/shared'
```

```ts
import { initialSize, prepareChatImage, prepareImage, uploadErrorText, viewportCenter } from '../lib/image'
```

```ts
import { addToast, reduceServer, reduceStatus, reduceSubmitBatch } from './reducers'
import { channelOf, closeDmTab, openDmTab, selectChatTab, setChatOpen, type ChatTab } from './chat'
```

Na interface `TableActions`, acrescente antes do `}`:

```ts
  /** true = enviado (o campo pode ser limpo); false = vazio, fórmula inválida ou sem conexão. */
  sendChatText(text: string): boolean
  sendRoll(request: RollRequest, secret: boolean): boolean
  sendChatImage(file: Blob): Promise<void>
  openDm(clientId: string): void
  closeDm(clientId: string): void
  selectChatTab(tab: ChatTab): void
  setChatOpen(open: boolean): void
```

Logo depois da função `submitMany` (antes de `const actions: TableActions = {`), acrescente:

```ts

    // Mensagens de chat não entram na fila de reenvio: sem conexão, avisa e não envia.
    const sendChat = (channel: ChatChannel, build: (reqId: string) => ClientMessage): boolean => {
      const s = get()
      if (s.status !== 'open' || !sync) {
        set(addToast(s, 'Sem conexão — aguarde reconectar'))
        return false
      }
      const reqId = `c_${nanoid()}`
      set({ chatPending: { ...s.chatPending, [reqId]: channel } })
      sync.send(build(reqId))
      return true
    }
```

e acrescente, antes do `async addImageFile(file, at) {`:

```ts
      sendChatText(text) {
        const trimmed = text.trim()
        if (!trimmed) return false
        const command = parseCommand(trimmed)
        if (command?.kind === 'invalid') {
          set((s) => addToast(s, 'Fórmula inválida — ex.: /r 2d6+3'))
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
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/store apps/web/src/lib/dice-config.ts apps/web/src/lib/image.ts apps/web/test/chat.test.ts apps/web/test/dice-config.test.ts
git commit -m "feat(m3): Task 7 — estado do chat, envio, rolagens, imagens e configuração do dado" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Web — grade no canvas, popover "Grade" do mestre e encaixe na prévia

**Files:**
- Create: `apps/web/src/canvas/grid.ts`, `apps/web/src/canvas/GridLayer.tsx`, `apps/web/src/ui/GridPopover.tsx`
- Modify: `apps/web/src/canvas/TableCanvas.tsx` (arquivo inteiro), `apps/web/src/canvas/nodeChange.ts` (arquivo inteiro), `apps/web/src/ui/Toolbar.tsx` (arquivo inteiro)
- Modify: `apps/web/src/store/tableStore.ts` (`addImageFile` encaixa ao criar)
- Test: `apps/web/test/grid.test.ts` (NOVO)

**Interfaces:**
- Consumes: (Task 1) `GRID_MIN`, `GRID_MAX`, `snapPatch`, `snapToGrid`; (Task 6) `state.settings`, `actions.updateSettings`.
- Produces:
  - `MIN_CELL_PX = 4`; `interface GridLines { xs: number[]; ys: number[]; minX: number; maxX: number; minY: number; maxY: number }`; `visibleGridLines(v: Viewport, screenW: number, screenH: number, size: number): GridLines | null` (null quando o quadrado teria menos de 4 px na tela)
  - `parseGridSize(text: string): number | null` (inteiro 10..500)
  - `<GridLayer />` (Konva `Layer` sem eventos; nada quando `grid.enabled` é falso)
  - `<GridPopover onClose />` — `role="dialog"`, `aria-label="Grade"`, campos "Mostrar grade", "Tamanho do quadrado (px)", "Encaixar imagens na grade"
  - Botão da barra `aria-label="Grade"` (só mestre)

- [ ] **Step 1: Testes (falham)**

Crie `apps/web/test/grid.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { parseGridSize, visibleGridLines } from '../src/canvas/grid'

describe('visibleGridLines', () => {
  it('linhas só na área visível, sem zoom', () => {
    expect(visibleGridLines({ x: 0, y: 0, scale: 1 }, 200, 100, 70)).toEqual({
      xs: [0, 70, 140], ys: [0, 70], minX: 0, maxX: 200, minY: 0, maxY: 100,
    })
  })

  it('com pan e zoom, em coordenadas do mapa e sem -0', () => {
    const lines = visibleGridLines({ x: -100, y: 50, scale: 2 }, 200, 100, 70)
    expect(lines).toEqual({ xs: [70, 140], ys: [0], minX: 50, maxX: 150, minY: -25, maxY: 25 })
    expect(Object.is(lines!.ys[0], 0)).toBe(true)
  })

  it('não desenha quando o quadrado teria menos de 4 px na tela', () => {
    expect(visibleGridLines({ x: 0, y: 0, scale: 0.1 }, 1000, 1000, 30)).toBeNull()
    expect(visibleGridLines({ x: 0, y: 0, scale: 0.1 }, 1000, 1000, 40)).not.toBeNull()
  })
})

describe('parseGridSize', () => {
  it('aceita inteiros de 10 a 500 (com espaços em volta)', () => {
    expect(parseGridSize('70')).toBe(70)
    expect(parseGridSize(' 10 ')).toBe(10)
    expect(parseGridSize('500')).toBe(500)
  })

  // Review Focus #4
  it('recusa fora do intervalo, decimal, vazio e texto', () => {
    for (const bad of ['9', '501', '12.5', '', '   ', 'abc', '-70']) expect(parseGridSize(bad), bad).toBeNull()
  })
})
```

Run: `pnpm --filter @mesa/web test -- grid`
Expected: FAIL — módulo inexistente.

- [ ] **Step 2: Funções da grade**

Crie `apps/web/src/canvas/grid.ts`:

```ts
import { GRID_MAX, GRID_MIN } from '@mesa/shared'
import type { Viewport } from '../store/state'

/** Abaixo disso (em px de tela) a grade viraria uma mancha: não desenha. */
export const MIN_CELL_PX = 4

export interface GridLines {
  xs: number[]
  ys: number[]
  minX: number
  maxX: number
  minY: number
  maxY: number
}

/** Linhas da grade que caem na área visível, em coordenadas do mapa. */
export function visibleGridLines(v: Viewport, screenW: number, screenH: number, size: number): GridLines | null {
  if (size * v.scale < MIN_CELL_PX) return null
  const minX = -v.x / v.scale
  const maxX = (screenW - v.x) / v.scale
  const minY = -v.y / v.scale
  const maxY = (screenH - v.y) / v.scale
  const xs: number[] = []
  const ys: number[] = []
  // `+ 0` evita -0 quando o início cai em zero vindo de um negativo.
  for (let x = Math.ceil(minX / size) * size + 0; x <= maxX; x += size) xs.push(x)
  for (let y = Math.ceil(minY / size) * size + 0; y <= maxY; y += size) ys.push(y)
  return { xs, ys, minX, maxX, minY, maxY }
}

/** Valor digitado no campo de tamanho; null = inválido (o campo volta ao valor atual). */
export function parseGridSize(text: string): number | null {
  const trimmed = text.trim()
  if (trimmed === '') return null
  const value = Number(trimmed)
  return Number.isInteger(value) && value >= GRID_MIN && value <= GRID_MAX ? value : null
}
```

Run: `pnpm --filter @mesa/web test -- grid`
Expected: PASS.

- [ ] **Step 3: Camada da grade**

Crie `apps/web/src/canvas/GridLayer.tsx`:

```tsx
import { Layer, Shape } from 'react-konva'
import { useTable } from '../store/context'
import { visibleGridLines } from './grid'
import { useWindowSize } from './hooks'

/** Linhas de 1 px de tela (strokeScaleEnabled=false), branco 25%, só na área visível. */
export function GridLayer() {
  const grid = useTable((s) => s.settings.grid)
  const viewport = useTable((s) => s.viewport)
  const screen = useWindowSize()
  if (!grid.enabled) return null
  const lines = visibleGridLines(viewport, screen.width, screen.height, grid.size)
  if (!lines) return null
  return (
    <Layer listening={false}>
      <Shape
        stroke="rgba(255, 255, 255, 0.25)"
        strokeWidth={1}
        strokeScaleEnabled={false}
        sceneFunc={(ctx, shape) => {
          ctx.beginPath()
          for (const x of lines.xs) {
            ctx.moveTo(x, lines.minY)
            ctx.lineTo(x, lines.maxY)
          }
          for (const y of lines.ys) {
            ctx.moveTo(lines.minX, y)
            ctx.lineTo(lines.maxX, y)
          }
          ctx.strokeShape(shape)
        }}
      />
    </Layer>
  )
}
```

- [ ] **Step 4: Grade entre o mapa e a camada de cima**

Troque `apps/web/src/canvas/TableCanvas.tsx` inteiro por:

```tsx
import { Fragment, useMemo } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Layer, Line, Stage } from 'react-konva'
import type { TableObject } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { GridLayer } from './GridLayer'
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
  // A grade fica logo acima da camada "map"; sem ela (removida pelo mestre), abaixo de tudo.
  const hasMapLayer = layers.some((l) => l.id === 'map')

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
      {!hasMapLayer && <GridLayer />}
      {layers.map((layer) => {
        const active = layer.id === activeLayerId
        const list = byLayer[layer.id] ?? []
        return (
          <Fragment key={layer.id}>
            <Layer listening={active && !panning} opacity={isGm && layer.visibility === 'gm' ? 0.5 : 1}>
              {list.map((o) =>
                o.type === 'image' ? (
                  <ImageNode key={o.id} object={o} />
                ) : o.type === 'stroke' ? (
                  <StrokeNode key={o.id} object={o} segments={drawing.erasePreview[o.id]} />
                ) : null,
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
            {layer.id === 'map' && <GridLayer />}
          </Fragment>
        )
      })}
      <Overlay />
    </Stage>
  )
}
```

- [ ] **Step 5: Encaixe na prévia ao soltar**

Troque `apps/web/src/canvas/nodeChange.ts` inteiro por:

```ts
import type Konva from 'konva'
import { snapPatch, type ObjectPatch } from '@mesa/shared'
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

  // Encaixe: a mesma conta do servidor, para a imagem já cair no lugar certo.
  const grid = s.settings.grid
  if (object.type === 'image' && grid.snap) {
    patch = snapPatch(patch, grid.size)
    node.position({ x: patch.x ?? node.x(), y: patch.y ?? node.y() })
    if (kind === 'transform') node.size({ width: patch.width ?? node.width(), height: patch.height ?? node.height() })
  }

  if (!s.actions.submit({ kind: 'update', id, patch })) revert()
  s.actions.release(id)
}
```

Em `apps/web/src/store/tableStore.ts`, troque o import do `@mesa/shared` (valores) por

```ts
import { CHAT_TEXT_MAX, DEFAULT_LAYER_NAME, RULER_THROTTLE_MS, canControl, cellCenter, parseCommand, snapToGrid } from '@mesa/shared'
```

e, dentro de `addImageFile`, troque o bloco do `try` a partir de `const size = initialSize(…)` até o fim do `actions.submit({ … })` por:

```ts
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
```

- [ ] **Step 6: Popover "Grade" e botão na barra**

Crie `apps/web/src/ui/GridPopover.tsx`:

```tsx
import { useRef } from 'react'
import { GRID_MAX, GRID_MIN } from '@mesa/shared'
import { parseGridSize } from '../canvas/grid'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'

export function GridPopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const grid = useTable((s) => s.settings.grid)
  const actions = useTableActions()

  return (
    <div ref={ref} className="panel popover pen-popover" role="dialog" aria-label="Grade">
      <label>
        <input
          type="checkbox"
          checked={grid.enabled}
          onChange={(e) => actions.updateSettings({ grid: { enabled: e.target.checked } })}
        />
        Mostrar grade
      </label>
      <label className="field">
        Tamanho do quadrado (px)
        <input
          key={grid.size}
          type="number"
          min={GRID_MIN}
          max={GRID_MAX}
          step={1}
          defaultValue={grid.size}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => {
            const size = parseGridSize(e.currentTarget.value)
            if (size === null) {
              e.currentTarget.value = String(grid.size) // inválido não é enviado
              return
            }
            if (size !== grid.size) actions.updateSettings({ grid: { size } })
          }}
        />
      </label>
      <label>
        <input
          type="checkbox"
          checked={grid.snap}
          onChange={(e) => actions.updateSettings({ grid: { snap: e.target.checked } })}
        />
        Encaixar imagens na grade
      </label>
    </div>
  )
}
```

Troque `apps/web/src/ui/Toolbar.tsx` inteiro por:

```tsx
import { useCallback, useRef, useState } from 'react'
import { Eraser, Grid3x3, Hand, ImagePlus, MousePointer2, Pencil, Undo2 } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { GridPopover } from './GridPopover'
import { PenPopover } from './PenPopover'

const ICON = 18

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const fileInput = useRef<HTMLInputElement>(null)
  const [penMenu, setPenMenu] = useState(false)
  const [gridMenu, setGridMenu] = useState(false)
  const closePenMenu = useCallback(() => setPenMenu(false), [])
  const closeGridMenu = useCallback(() => setGridMenu(false), [])
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
      {isGm && (
        <div className="pen-anchor">
          <button
            aria-label="Grade"
            title="Grade (só o mestre)"
            aria-haspopup="dialog"
            aria-expanded={gridMenu}
            onClick={() => setGridMenu(true)}
          >
            <Grid3x3 size={ICON} aria-hidden />
          </button>
          {gridMenu && <GridPopover onClose={closeGridMenu} />}
        </div>
      )}
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>
        <Undo2 size={ICON} aria-hidden />
      </button>
    </div>
  )
}
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

Run: `pnpm build:e2e`
Expected: build sem erros (confere o bundle sem tocar em `apps/web/dist`).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/canvas/grid.ts apps/web/src/canvas/GridLayer.tsx apps/web/src/canvas/TableCanvas.tsx apps/web/src/canvas/nodeChange.ts apps/web/src/ui/GridPopover.tsx apps/web/src/ui/Toolbar.tsx apps/web/src/store/tableStore.ts apps/web/test/grid.test.ts
git commit -m "feat(m3): Task 8 — grade no canvas, popover do mestre e encaixe na prévia" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Web — régua, ping e câmera no canvas

**Files:**
- Create: `apps/web/src/canvas/camera.ts`, `apps/web/src/canvas/ping.ts`, `apps/web/src/canvas/ruler.ts`
- Modify: `apps/web/src/canvas/hooks.ts` (acrescentar `useFrameClock`)
- Modify: `apps/web/src/canvas/Overlay.tsx` (arquivo inteiro), `apps/web/src/canvas/TableCanvas.tsx` (arquivo inteiro), `apps/web/src/ui/Toolbar.tsx` (arquivo inteiro)
- Modify: `apps/web/src/canvas/ImageNode.tsx:31-33`, `apps/web/src/canvas/StrokeNode.tsx:30-32` (`onMouseDown`), `apps/web/src/ui/useKeyboard.ts` (teclas `R` e `Esc`)
- Test: `apps/web/test/camera.test.ts` (NOVO)

**Interfaces:**
- Consumes: (Task 1) `CAMERA_GLIDE_MS`, `PING_DURATION_MS`, `rulerDistance`, `formatDistance`, `Point`; (Task 6) `state.rulers`, `state.ownRuler`, `state.pings`, `state.cameraTarget`, `actions.rulerClick/rulerMove/rulerCancel/ping`, `Ruler`.
- Produces:
  - `centerOn(v: Viewport, p: Point, screenW: number, screenH: number): Viewport` (mantém o zoom)
  - `glideStep(from: Viewport, to: Viewport, t: number): Viewport` (ease-in-out, `t` de 0 a 1)
  - `isPingClick(evt: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean`
  - `pingRing(ageMs: number): { radius: number; opacity: number } | null` (null depois de 2 s)
  - `rulerLabel(nickname: string, ruler: Ruler, size: number): string` (`"Ana · 4,2 q"`)
  - `useFrameClock(active: boolean): number`
  - Rótulo da régua no Konva com `name="ruler-label"`; em `?debug=1` o `Stage` fica em `window.__stage` (usado pelo E2E)
  - Botão `aria-label="Régua (R)"`; teclas `R` (régua) e `Esc` (remove a régua)

- [ ] **Step 1: Testes (falham)**

Crie `apps/web/test/camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { centerOn, glideStep } from '../src/canvas/camera'
import { isPingClick, pingRing } from '../src/canvas/ping'
import { rulerLabel } from '../src/canvas/ruler'

describe('câmera', () => {
  it('centerOn põe o ponto no meio da tela mantendo o zoom', () => {
    expect(centerOn({ x: 0, y: 0, scale: 2 }, { x: 100, y: 50 }, 1280, 720)).toEqual({ x: 440, y: 260, scale: 2 })
  })

  it('glideStep vai de um viewport ao outro com aceleração suave', () => {
    const from = { x: 0, y: 0, scale: 1 }
    const to = { x: 100, y: -40, scale: 1 }
    expect(glideStep(from, to, 0)).toEqual(from)
    expect(glideStep(from, to, 0.5)).toEqual({ x: 50, y: -20, scale: 1 })
    expect(glideStep(from, to, 1)).toEqual(to)
    expect(glideStep(from, to, 2)).toEqual(to)
    expect(glideStep(from, to, 0.25).x).toBeLessThan(25)
  })
})

describe('ping', () => {
  it('Shift, Ctrl ou ⌘ no clique viram ping', () => {
    expect(isPingClick({ shiftKey: true, ctrlKey: false, metaKey: false })).toBe(true)
    expect(isPingClick({ shiftKey: false, ctrlKey: true, metaKey: false })).toBe(true)
    expect(isPingClick({ shiftKey: false, ctrlKey: false, metaKey: true })).toBe(true)
    expect(isPingClick({ shiftKey: false, ctrlKey: false, metaKey: false })).toBe(false)
  })

  it('anel cresce e some em 2 s', () => {
    expect(pingRing(0)).toEqual({ radius: 6, opacity: 1 })
    expect(pingRing(-5)).toEqual({ radius: 6, opacity: 1 })
    expect(pingRing(1000)).toEqual({ radius: 23, opacity: 0.5 })
    expect(pingRing(2000)).toBeNull()
  })
})

describe('régua', () => {
  it('rótulo "Apelido · N,N q"', () => {
    expect(rulerLabel('Ana', { from: { x: 35, y: 35 }, to: { x: 329, y: 35 } }, 70)).toBe('Ana · 4,2 q')
    expect(rulerLabel('Bia', { from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }, 70)).toBe('Bia · 0,0 q')
  })
})
```

Run: `pnpm --filter @mesa/web test -- camera`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 2: Funções puras**

Crie `apps/web/src/canvas/camera.ts`:

```ts
import type { Point } from '@mesa/shared'
import type { Viewport } from '../store/state'

/** Viewport que centraliza `p` (coordenadas do mapa) na tela, mantendo o zoom atual. */
export function centerOn(v: Viewport, p: Point, screenW: number, screenH: number): Viewport {
  return { x: screenW / 2 - p.x * v.scale, y: screenH / 2 - p.y * v.scale, scale: v.scale }
}

const easeInOut = (t: number) => (t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2)

export function glideStep(from: Viewport, to: Viewport, t: number): Viewport {
  const k = easeInOut(Math.min(1, Math.max(0, t)))
  return { x: from.x + (to.x - from.x) * k, y: from.y + (to.y - from.y) * k, scale: to.scale }
}
```

Crie `apps/web/src/canvas/ping.ts`:

```ts
import { PING_DURATION_MS } from '@mesa/shared'

/** Shift + clique = ping; Ctrl/⌘ + clique = ping pedindo para centralizar (o servidor só aceita do mestre). */
export function isPingClick(evt: { shiftKey: boolean; ctrlKey: boolean; metaKey: boolean }): boolean {
  return evt.shiftKey || evt.ctrlKey || evt.metaKey
}

/** Anel que cresce de 6 a 40 px de tela e some ao longo de 2 s; null quando acabou. */
export function pingRing(ageMs: number): { radius: number; opacity: number } | null {
  if (ageMs >= PING_DURATION_MS) return null
  const t = Math.max(0, ageMs) / PING_DURATION_MS
  return { radius: 6 + 34 * t, opacity: 1 - t }
}
```

Crie `apps/web/src/canvas/ruler.ts`:

```ts
import { formatDistance, rulerDistance } from '@mesa/shared'
import type { Ruler } from '../store/state'

export function rulerLabel(nickname: string, ruler: Ruler, size: number): string {
  return `${nickname} · ${formatDistance(rulerDistance(ruler.from, ruler.to, size))}`
}
```

Acrescente no fim de `apps/web/src/canvas/hooks.ts`:

```ts

/** Date.now() a cada quadro enquanto `active`; parado quando não há animação. */
export function useFrameClock(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    let frame = requestAnimationFrame(function tick() {
      setNow(Date.now())
      frame = requestAnimationFrame(tick)
    })
    return () => cancelAnimationFrame(frame)
  }, [active])
  return now
}
```

Run: `pnpm --filter @mesa/web test -- camera`
Expected: PASS.

- [ ] **Step 3: Réguas e pings no Overlay**

Troque `apps/web/src/canvas/Overlay.tsx` inteiro por:

```tsx
import { Circle, Group, Layer, Line, Rect, Text } from 'react-konva'
import { PING_DURATION_MS, type Member } from '@mesa/shared'
import { useTable } from '../store/context'
import type { Ruler } from '../store/state'
import { useFrameClock, useNow } from './hooks'
import { pingRing } from './ping'
import { rulerLabel } from './ruler'

export function Overlay() {
  const now = useNow(1000)
  const cursors = useTable((s) => s.cursors)
  const members = useTable((s) => s.members)
  const locks = useTable((s) => s.locks)
  const objects = useTable((s) => s.objects)
  const dragPreviews = useTable((s) => s.dragPreviews)
  const strokePreviews = useTable((s) => s.strokePreviews)
  const scale = useTable((s) => s.viewport.scale)
  const self = useTable((s) => s.self)
  const rulers = useTable((s) => s.rulers)
  const ownRuler = useTable((s) => s.ownRuler)
  const gridSize = useTable((s) => s.settings.grid.size)
  const selfId = self?.clientId

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

      {/* Réguas dos outros (a de outra aba minha não aparece) e a minha, desenhada do estado local. */}
      {Object.entries(rulers).map(([clientId, ruler]) =>
        clientId === selfId ? null : (
          <RulerMark key={clientId} ruler={ruler} member={members[clientId]} size={gridSize} scale={scale} />
        ),
      )}
      {ownRuler && self && <RulerMark ruler={ownRuler} member={self} size={gridSize} scale={scale} />}

      <Pings members={members} scale={scale} />
    </Layer>
  )
}

function RulerMark({
  ruler,
  member,
  size,
  scale,
}: {
  ruler: Ruler
  member: Pick<Member, 'nickname' | 'color'> | undefined
  size: number
  scale: number
}) {
  const color = member?.color ?? '#ffffff'
  const k = 1 / scale
  return (
    <Group>
      <Line
        points={[ruler.from.x, ruler.from.y, ruler.to.x, ruler.to.y]}
        stroke={color}
        strokeWidth={2 * k}
        dash={[8 * k, 6 * k]}
        lineCap="round"
      />
      <Circle x={ruler.from.x} y={ruler.from.y} radius={3 * k} fill={color} />
      <Text
        name="ruler-label"
        text={rulerLabel(member?.nickname ?? '?', ruler, size)}
        x={ruler.to.x + 12 * k}
        y={ruler.to.y + 12 * k}
        fontSize={13 * k}
        fill={color}
        stroke="#111111"
        strokeWidth={3 * k}
        fillAfterStrokeEnabled
      />
    </Group>
  )
}

function Pings({ members, scale }: { members: Record<string, Member>; scale: number }) {
  const pings = useTable((s) => s.pings)
  const last = pings[pings.length - 1]
  const now = useFrameClock(!!last && Date.now() - last.at < PING_DURATION_MS)
  return (
    <>
      {pings.map((p) => {
        const ring = pingRing(now - p.at)
        if (!ring) return null
        const member = members[p.clientId]
        const color = member?.color ?? '#ffffff'
        return (
          <Group key={p.id} x={p.x} y={p.y} scaleX={1 / scale} scaleY={1 / scale} opacity={ring.opacity}>
            <Circle radius={ring.radius} stroke={color} strokeWidth={3} />
            <Circle radius={4} fill={color} />
            <Text text={member?.nickname ?? '?'} x={ring.radius + 6} y={-6} fontSize={12} fill={color} />
          </Group>
        )
      })}
    </>
  )
}
```

- [ ] **Step 4: Clique de ping não seleciona objeto**

Em `apps/web/src/canvas/ImageNode.tsx`, acrescente o import `import { isPingClick } from './ping'` e troque

```tsx
      onMouseDown={() => {
        if (interactive) actions.select(object.id)
      }}
```

por

```tsx
      onMouseDown={(e) => {
        if (interactive && !isPingClick(e.evt)) actions.select(object.id)
      }}
```

Faça a mesma troca (e o mesmo import) em `apps/web/src/canvas/StrokeNode.tsx`.

- [ ] **Step 5: Canvas: régua, ping, câmera e `__stage`**

Troque `apps/web/src/canvas/TableCanvas.tsx` inteiro por:

```tsx
import { Fragment, useEffect, useMemo, useRef } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Layer, Line, Stage } from 'react-konva'
import { CAMERA_GLIDE_MS, type TableObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { centerOn, glideStep } from './camera'
import { GridLayer } from './GridLayer'
import { useModifierKeys, useWindowSize } from './hooks'
import { ImageNode } from './ImageNode'
import { ObjectDecorations } from './ObjectDecorations'
import { Overlay } from './Overlay'
import { isPingClick } from './ping'
import { SelectionTransformer } from './SelectionTransformer'
import { StrokeNode } from './StrokeNode'
import { useDrawingTools } from './useDrawingTools'

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const debug = new URLSearchParams(window.location.search).has('debug')

/** Desliza a câmera (≈400 ms) até centralizar o ponto pedido pelo mestre, mantendo o zoom. */
function useCameraGlide(): void {
  const store = useTableStore()
  const target = useTable((s) => s.cameraTarget)
  useEffect(() => {
    if (!target) return
    const from = store.getState().viewport
    const to = centerOn(from, target, window.innerWidth, window.innerHeight)
    const start = performance.now()
    let frame = requestAnimationFrame(function step(time) {
      const t = Math.min(1, (time - start) / CAMERA_GLIDE_MS)
      store.getState().actions.setViewport(glideStep(from, to, t))
      if (t < 1) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [store, target])
}

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
  const stageRef = useRef<Konva.Stage>(null)
  const panning = tool === 'hand' || space
  // A grade fica logo acima da camada "map"; sem ela (removida pelo mestre), abaixo de tudo.
  const hasMapLayer = layers.some((l) => l.id === 'map')
  useCameraGlide()

  useEffect(() => {
    if (debug) (window as unknown as { __stage?: Konva.Stage | null }).__stage = stageRef.current
  }, [])

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

  const cursor = panning
    ? 'grab'
    : tool === 'pencil'
      ? penMode === 'erase'
        ? 'cell'
        : 'crosshair'
      : tool === 'ruler'
        ? 'crosshair'
        : 'default'

  return (
    <Stage
      ref={stageRef}
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
        const pos = e.target.getStage()?.getRelativePointerPosition()
        // Shift/Ctrl + clique: ping em qualquer ferramenta, sem selecionar, desenhar nem medir.
        if (pos && e.evt.button === 0 && isPingClick(e.evt)) {
          actions.ping(pos, e.evt.ctrlKey || e.evt.metaKey)
          return
        }
        if (tool === 'ruler') {
          if (pos && e.evt.button === 0) actions.rulerClick(pos)
          return
        }
        if (tool === 'select' && e.target === e.target.getStage()) actions.select(null)
        drawing.onDown(e)
      }}
      onMouseMove={(e) => {
        const pos = e.target.getStage()?.getRelativePointerPosition()
        if (pos) {
          actions.cursor(pos.x, pos.y)
          actions.rulerMove(pos)
        }
        if (!panning) drawing.onMove(e)
      }}
      onMouseUp={drawing.onUp}
      onMouseLeave={drawing.onUp}
    >
      {!hasMapLayer && <GridLayer />}
      {layers.map((layer) => {
        const active = layer.id === activeLayerId
        const list = byLayer[layer.id] ?? []
        return (
          <Fragment key={layer.id}>
            <Layer listening={active && !panning} opacity={isGm && layer.visibility === 'gm' ? 0.5 : 1}>
              {list.map((o) =>
                o.type === 'image' ? (
                  <ImageNode key={o.id} object={o} />
                ) : o.type === 'stroke' ? (
                  <StrokeNode key={o.id} object={o} segments={drawing.erasePreview[o.id]} />
                ) : null,
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
            {layer.id === 'map' && <GridLayer />}
          </Fragment>
        )
      })}
      <Overlay />
    </Stage>
  )
}
```

- [ ] **Step 6: Botão e teclas da régua**

Troque `apps/web/src/ui/Toolbar.tsx` inteiro por:

```tsx
import { useCallback, useRef, useState } from 'react'
import { Eraser, Grid3x3, Hand, ImagePlus, MousePointer2, Pencil, Ruler, Undo2 } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { GridPopover } from './GridPopover'
import { PenPopover } from './PenPopover'

const ICON = 18

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const fileInput = useRef<HTMLInputElement>(null)
  const [penMenu, setPenMenu] = useState(false)
  const [gridMenu, setGridMenu] = useState(false)
  const closePenMenu = useCallback(() => setPenMenu(false), [])
  const closeGridMenu = useCallback(() => setGridMenu(false), [])
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
      <button
        aria-label="Régua (R)"
        title="Régua (R) — clique fixa o início; novo clique ou Esc remove"
        aria-pressed={tool === 'ruler'}
        onClick={() => actions.setTool('ruler')}
      >
        <Ruler size={ICON} aria-hidden />
      </button>
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
      {isGm && (
        <div className="pen-anchor">
          <button
            aria-label="Grade"
            title="Grade (só o mestre)"
            aria-haspopup="dialog"
            aria-expanded={gridMenu}
            onClick={() => setGridMenu(true)}
          >
            <Grid3x3 size={ICON} aria-hidden />
          </button>
          {gridMenu && <GridPopover onClose={closeGridMenu} />}
        </div>
      )}
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>
        <Undo2 size={ICON} aria-hidden />
      </button>
    </div>
  )
}
```

Em `apps/web/src/ui/useKeyboard.ts`, no `switch (e.key.toLowerCase())`, acrescente depois de `case 'e': actions.setPen('erase'); break`:

```ts
        case 'r': actions.setTool('ruler'); break
        case 'escape': actions.rulerCancel(); break
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test && pnpm build:e2e`
Expected: tudo verde e build sem erros.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/canvas apps/web/src/ui/Toolbar.tsx apps/web/src/ui/useKeyboard.ts apps/web/test/camera.test.ts
git commit -m "feat(m3): Task 9 — régua, ping e câmera no canvas" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Web — formas: ferramenta, popover, desenho, nó no canvas e Transformer

**Files:**
- Create: `apps/web/src/canvas/shapes.ts`, `apps/web/src/canvas/ShapeNode.tsx`, `apps/web/src/canvas/useShapeTool.ts`, `apps/web/src/ui/ShapePopover.tsx`
- Modify: `apps/web/src/canvas/TableCanvas.tsx` (arquivo inteiro), `apps/web/src/canvas/SelectionTransformer.tsx` (arquivo inteiro), `apps/web/src/ui/Toolbar.tsx` (arquivo inteiro)
- Modify: `apps/web/src/canvas/nodeChange.ts` (`revert`), `apps/web/src/canvas/Overlay.tsx` (rotação da moldura de trava), `apps/web/src/ui/useKeyboard.ts` (tecla `S`)
- Test: `apps/web/test/shapes.test.ts` (NOVO)

**Interfaces:**
- Consumes: (Task 3) `ShapeObject`, `ShapeKind`, `NewObject`; (Task 6) `state.shapeKind`, `state.shapeFill`, `ShapeFill`, `actions.setShapeKind`, `actions.setShapeFill`; (Task 9) `isPingClick`; M2: `commitNodeChange`, `geometryFromNode`, `isLockedByOther`, `actions.grab/release/dragPreview/select/submit/nextZ/canEditLayer`.
- Produces:
  - `interface ShapeGeometry { x: number; y: number; width: number; height: number; points?: [number, number, number, number] }`
  - `shapeFromDrag(kind: ShapeKind, start: Point, end: Point, shift: boolean): ShapeGeometry` (Shift: quadrado/círculo; linha em múltiplos de 45°)
  - `shapeFillFor(kind: ShapeKind, fill: ShapeFill, stroke: string): { color: string; opacity: number } | null`
  - `hexToRgba(hex: string, opacity: number): string`
  - `newShapeObject(input: { id: string; layerId: string; zIndex: number; kind: ShapeKind; geometry: ShapeGeometry; stroke: string; strokeWidth: number; fill: ShapeFill }): NewObject`
  - `useShapeTool(): { preview: { layerId: string; object: ShapeObject } | null; onDown; onMove; onUp }`
  - `<ShapeNode object preview? />` (nó com `name="object shape"`)
  - `<ShapePopover onClose />` — `role="dialog"`, `aria-label="Opções das formas"`, botões "Retângulo", "Elipse", "Linha", checkbox "Preencher", campos "Cor do preenchimento" e "Opacidade do preenchimento"
  - Botão da barra `aria-label="Formas (S)"`; tecla `S`

- [ ] **Step 1: Testes (falham)**

Crie `apps/web/test/shapes.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { NewObjectSchema } from '@mesa/shared'
import { hexToRgba, newShapeObject, shapeFillFor, shapeFromDrag } from '../src/canvas/shapes'

const noFill = { enabled: false, color: null, opacity: 0.3 }

describe('shapeFromDrag', () => {
  it('retângulo/elipse: caixa normalizada em qualquer direção', () => {
    expect(shapeFromDrag('rect', { x: 10, y: 10 }, { x: 50, y: 30 }, false)).toEqual({ x: 10, y: 10, width: 40, height: 20 })
    expect(shapeFromDrag('ellipse', { x: 50, y: 30 }, { x: 10, y: 10 }, false)).toEqual({ x: 10, y: 10, width: 40, height: 20 })
  })

  it('Shift força quadrado/círculo pelo maior lado, respeitando a direção', () => {
    expect(shapeFromDrag('rect', { x: 10, y: 10 }, { x: 50, y: 30 }, true)).toEqual({ x: 10, y: 10, width: 40, height: 40 })
    expect(shapeFromDrag('ellipse', { x: 50, y: 50 }, { x: 40, y: 10 }, true)).toEqual({ x: 10, y: 10, width: 40, height: 40 })
  })

  it('linha: caixa + pontos relativos a (x, y)', () => {
    expect(shapeFromDrag('line', { x: 10, y: 10 }, { x: 50, y: 30 }, false)).toEqual({
      x: 10, y: 10, width: 40, height: 20, points: [0, 0, 40, 20],
    })
    expect(shapeFromDrag('line', { x: 50, y: 10 }, { x: 10, y: 30 }, false)).toEqual({
      x: 10, y: 10, width: 40, height: 20, points: [40, 0, 0, 20],
    })
  })

  it('linha com Shift fica em múltiplos de 45°, com o mesmo comprimento', () => {
    expect(shapeFromDrag('line', { x: 0, y: 0 }, { x: 100, y: 10 }, true)).toEqual({
      x: 0, y: 0, width: 100.499, height: 0, points: [0, 0, 100.499, 0],
    })
    expect(shapeFromDrag('line', { x: 0, y: 0 }, { x: 30, y: -28 }, true)).toEqual({
      x: 0, y: -29.017, width: 29.017, height: 29.017, points: [0, 29.017, 29.017, 0],
    })
    expect(shapeFromDrag('line', { x: 10, y: 10 }, { x: 12, y: 80 }, true)).toEqual({
      x: 10, y: 10, width: 0, height: 70.029, points: [0, 0, 0, 70.029],
    })
  })
})

describe('preenchimento', () => {
  it('desligado = null; ligado sem cor usa a do contorno; linha nunca tem', () => {
    expect(shapeFillFor('rect', noFill, '#ff0000')).toBeNull()
    expect(shapeFillFor('rect', { enabled: true, color: null, opacity: 0.3 }, '#ff0000')).toEqual({ color: '#ff0000', opacity: 0.3 })
    expect(shapeFillFor('ellipse', { enabled: true, color: '#00ff00', opacity: 1 }, '#ff0000')).toEqual({ color: '#00ff00', opacity: 1 })
    expect(shapeFillFor('line', { enabled: true, color: '#00ff00', opacity: 1 }, '#ff0000')).toBeNull()
  })

  it('hexToRgba', () => {
    expect(hexToRgba('#ff8000', 0.3)).toBe('rgba(255, 128, 0, 0.3)')
  })
})

describe('newShapeObject', () => {
  it('gera objetos válidos para o schema', () => {
    const base = { id: 's1', layerId: 'drawings', zIndex: 3, stroke: '#ffffff', strokeWidth: 4, fill: { enabled: true, color: null, opacity: 0.3 } }
    const rect = newShapeObject({ ...base, kind: 'rect', geometry: { x: 1, y: 2, width: 30, height: 40 } })
    expect(rect).toEqual({
      id: 's1', type: 'shape', kind: 'rect', layerId: 'drawings', x: 1, y: 2, width: 30, height: 40, rotation: 0, zIndex: 3,
      stroke: '#ffffff', strokeWidth: 4, fill: { color: '#ffffff', opacity: 0.3 },
    })
    expect(NewObjectSchema.safeParse(rect).success).toBe(true)
    const line = newShapeObject({ ...base, kind: 'line', geometry: { x: 0, y: 0, width: 10, height: 0, points: [0, 0, 10, 0] } })
    expect(line).toMatchObject({ kind: 'line', fill: null, points: [0, 0, 10, 0] })
    expect(NewObjectSchema.safeParse(line).success).toBe(true)
  })
})
```

Run: `pnpm --filter @mesa/web test -- shapes`
Expected: FAIL — módulo inexistente.

- [ ] **Step 2: Funções das formas**

Crie `apps/web/src/canvas/shapes.ts`:

```ts
import type { NewObject, Point, ShapeKind } from '@mesa/shared'
import type { ShapeFill } from '../store/state'

export interface ShapeGeometry {
  x: number
  y: number
  width: number
  height: number
  /** Só linha: [x1, y1, x2, y2] relativos a (x, y). */
  points?: [number, number, number, number]
}

// 3 casas bastam e evitam lixo de ponto flutuante (ex.: cos(90°) ≈ 6e-17); `+ 0` tira o -0.
const round = (v: number) => Math.round(v * 1000) / 1000 + 0

/** Geometria da forma arrastada de `start` até `end`. Shift: quadrado/círculo, ou linha a 45°. */
export function shapeFromDrag(kind: ShapeKind, start: Point, end: Point, shift: boolean): ShapeGeometry {
  const dx = end.x - start.x
  const dy = end.y - start.y
  let ex = end.x
  let ey = end.y
  if (shift && kind === 'line') {
    const length = Math.hypot(dx, dy)
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
    ex = round(start.x + length * Math.cos(angle))
    ey = round(start.y + length * Math.sin(angle))
  } else if (shift) {
    const side = Math.max(Math.abs(dx), Math.abs(dy))
    ex = start.x + (dx < 0 ? -side : side)
    ey = start.y + (dy < 0 ? -side : side)
  }
  const x = Math.min(start.x, ex)
  const y = Math.min(start.y, ey)
  const box = { x, y, width: Math.abs(ex - start.x), height: Math.abs(ey - start.y) }
  if (kind !== 'line') return box
  return { ...box, points: [start.x - x, start.y - y, ex - x, ey - y] }
}

export function shapeFillFor(kind: ShapeKind, fill: ShapeFill, stroke: string): { color: string; opacity: number } | null {
  if (kind === 'line' || !fill.enabled) return null
  return { color: fill.color ?? stroke, opacity: fill.opacity }
}

export function hexToRgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity})`
}

export function newShapeObject(input: {
  id: string
  layerId: string
  zIndex: number
  kind: ShapeKind
  geometry: ShapeGeometry
  stroke: string
  strokeWidth: number
  fill: ShapeFill
}): NewObject {
  const { points, ...box } = input.geometry
  return {
    id: input.id,
    type: 'shape',
    kind: input.kind,
    layerId: input.layerId,
    ...box,
    rotation: 0,
    zIndex: input.zIndex,
    stroke: input.stroke,
    strokeWidth: input.strokeWidth,
    fill: shapeFillFor(input.kind, input.fill, input.stroke),
    ...(input.kind === 'line' && points ? { points } : {}),
  } as NewObject
}
```

Run: `pnpm --filter @mesa/web test -- shapes`
Expected: PASS.

- [ ] **Step 3: Nó da forma**

Crie `apps/web/src/canvas/ShapeNode.tsx`:

```tsx
import type { Context } from 'konva/lib/Context'
import type { KonvaEventObject } from 'konva/lib/Node'
import type { Shape as KonvaShape } from 'konva/lib/Shape'
import { Line, Rect, Shape } from 'react-konva'
import { canControl, type ShapeObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { commitNodeChange, geometryFromNode } from './nodeChange'
import { isPingClick } from './ping'
import { hexToRgba } from './shapes'

function drawEllipse(ctx: Context, shape: KonvaShape): void {
  const w = shape.width()
  const h = shape.height()
  ctx.beginPath()
  ctx.ellipse(w / 2, h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
  ctx.closePath()
  ctx.fillStrokeShape(shape)
}

/** Retângulo e elipse redimensionam/giram pelo Transformer; a linha só se move. */
export function ShapeNode({ object, preview = false }: { object: ShapeObject; preview?: boolean }) {
  const store = useTableStore()
  const actions = useTableActions()
  const tool = useTable((s) => s.tool)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const dragPreview = useTable((s) => s.dragPreviews[object.id])
  const mayControl = useTable((s) => !!s.self && canControl(object, s.self.clientId, s.self.role))
  const layerEditable = useTable(() => actions.canEditLayer(object.layerId))
  const g = lockedByOther && dragPreview ? dragPreview : object
  const interactive = !preview && tool === 'select' && !lockedByOther && mayControl && layerEditable

  const common = {
    id: preview ? undefined : object.id,
    name: preview ? undefined : 'object shape',
    x: g.x,
    y: g.y,
    stroke: object.stroke,
    strokeWidth: object.strokeWidth,
    hitStrokeWidth: Math.max(object.strokeWidth, 12),
    listening: !preview,
    draggable: interactive,
    onMouseDown: (e: KonvaEventObject<MouseEvent>) => {
      if (interactive && !isPingClick(e.evt)) actions.select(object.id)
    },
    onDragStart: () => actions.grab(object.id),
    onDragEnd: (e: KonvaEventObject<DragEvent>) => commitNodeChange(store, object.id, e.target, 'drag'),
  }

  if (object.kind === 'line') {
    return (
      <Line
        {...common}
        points={object.points ?? [0, 0, object.width, object.height]}
        lineCap="round"
        onDragMove={(e) =>
          actions.dragPreview(object.id, { x: e.target.x(), y: e.target.y(), width: object.width, height: object.height, rotation: 0 })
        }
      />
    )
  }

  const sized = {
    ...common,
    width: g.width,
    height: g.height,
    rotation: g.rotation,
    fill: object.fill ? hexToRgba(object.fill.color, object.fill.opacity) : undefined,
    onDragMove: (e: KonvaEventObject<DragEvent>) => actions.dragPreview(object.id, geometryFromNode(e.target)),
    onTransformStart: () => actions.grab(object.id),
    onTransform: (e: KonvaEventObject<Event>) => actions.dragPreview(object.id, geometryFromNode(e.target)),
    onTransformEnd: (e: KonvaEventObject<Event>) => commitNodeChange(store, object.id, e.target, 'transform'),
  }
  return object.kind === 'rect' ? <Rect {...sized} /> : <Shape {...sized} sceneFunc={drawEllipse} />
}
```

Em `apps/web/src/canvas/nodeChange.ts`, troque a linha do `revert`

```ts
    if (object.type === 'image') node.size({ width: object.width, height: object.height })
```

por

```ts
    if (object.type === 'image' || (object.type === 'shape' && object.kind !== 'line')) {
      node.size({ width: object.width, height: object.height })
    }
```

Em `apps/web/src/canvas/Overlay.tsx`, troque `rotation={object.type === 'image' ? g.rotation : 0}` por `rotation={object.type === 'stroke' ? 0 : g.rotation}`.

- [ ] **Step 4: Transformer para retângulo e elipse**

Troque `apps/web/src/canvas/SelectionTransformer.tsx` inteiro por:

```tsx
import { useEffect, useRef } from 'react'
import type Konva from 'konva'
import { Transformer } from 'react-konva'
import { canControl } from '@mesa/shared'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'

const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right']
const ALL_ANCHORS = [...CORNERS, 'top-center', 'bottom-center', 'middle-left', 'middle-right']

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

  // Imagens, retângulos e elipses redimensionam/giram; traços e linhas apenas se movem.
  const resizable = !!object && (object.type === 'image' || (object.type === 'shape' && object.kind !== 'line'))
  const targetId =
    object && resizable && object.layerId === activeLayerId && tool === 'select' && !lockedByOther && mayControl ? object.id : null
  const isImage = object?.type === 'image'

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
      keepRatio={isImage}
      shiftBehavior="inverted"
      enabledAnchors={isImage ? CORNERS : ALL_ANCHORS}
      flipEnabled={false}
      boundBoxFunc={(oldBox, newBox) => (Math.abs(newBox.width) < 10 || Math.abs(newBox.height) < 10 ? oldBox : newBox)}
    />
  )
}
```

- [ ] **Step 5: Ferramenta de arrastar**

Crie `apps/web/src/canvas/useShapeTool.ts`:

```ts
import { useRef, useState } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { nanoid } from 'nanoid'
import type { Point, ShapeKind, ShapeObject } from '@mesa/shared'
import { useTableStore } from '../store/context'
import { newShapeObject, shapeFromDrag, type ShapeGeometry } from './shapes'

/** Arrasto menor que isso (px de tela) não cria forma. */
const MIN_EXTENT_PX = 3

interface Drag {
  layerId: string
  kind: ShapeKind
  start: Point
  geometry: ShapeGeometry
}

export function useShapeTool() {
  const store = useTableStore()
  const [preview, setPreview] = useState<{ layerId: string; object: ShapeObject } | null>(null)
  const drag = useRef<Drag | null>(null)

  const build = (d: Drag, id: string, zIndex: number) => {
    const s = store.getState()
    return newShapeObject({
      id, layerId: d.layerId, zIndex, kind: d.kind, geometry: d.geometry, stroke: s.color, strokeWidth: s.strokeWidth, fill: s.shapeFill,
    })
  }

  const showPreview = (d: Drag) => {
    const draft = { ...build(d, 'shape-preview', 0), ownerId: '', version: 0, updatedBy: '', control: { mode: 'all', clientIds: [] } }
    setPreview({ layerId: d.layerId, object: draft as unknown as ShapeObject })
  }

  const onDown = (e: KonvaEventObject<MouseEvent>) => {
    const s = store.getState()
    if (s.tool !== 'shape' || e.evt.button !== 0) return
    if (s.status !== 'open' || !s.actions.canEditLayer(s.activeLayerId)) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    drag.current = { layerId: s.activeLayerId, kind: s.shapeKind, start: pos, geometry: shapeFromDrag(s.shapeKind, pos, pos, false) }
    showPreview(drag.current)
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
    const d = drag.current
    if (!d) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    // Shift lido a cada movimento: apertar depois de começar o arrasto força quadrado/círculo/45°.
    d.geometry = shapeFromDrag(d.kind, d.start, pos, e.evt.shiftKey)
    showPreview(d)
  }

  const onUp = () => {
    const d = drag.current
    if (!d) return
    drag.current = null
    setPreview(null)
    const s = store.getState()
    if (Math.max(d.geometry.width, d.geometry.height) * s.viewport.scale < MIN_EXTENT_PX) return
    s.actions.submit({ kind: 'create', object: build(d, nanoid(), s.actions.nextZ(d.layerId)) })
  }

  return { preview, onDown, onMove, onUp }
}
```

- [ ] **Step 6: Canvas com formas**

Troque `apps/web/src/canvas/TableCanvas.tsx` inteiro por:

```tsx
import { Fragment, useEffect, useMemo, useRef } from 'react'
import type Konva from 'konva'
import type { KonvaEventObject } from 'konva/lib/Node'
import { Layer, Line, Stage } from 'react-konva'
import { CAMERA_GLIDE_MS, type TableObject } from '@mesa/shared'
import { useTable, useTableActions, useTableStore } from '../store/context'
import { centerOn, glideStep } from './camera'
import { GridLayer } from './GridLayer'
import { useModifierKeys, useWindowSize } from './hooks'
import { ImageNode } from './ImageNode'
import { ObjectDecorations } from './ObjectDecorations'
import { Overlay } from './Overlay'
import { isPingClick } from './ping'
import { SelectionTransformer } from './SelectionTransformer'
import { ShapeNode } from './ShapeNode'
import { StrokeNode } from './StrokeNode'
import { useDrawingTools } from './useDrawingTools'
import { useShapeTool } from './useShapeTool'

const MIN_SCALE = 0.1
const MAX_SCALE = 8
const debug = new URLSearchParams(window.location.search).has('debug')

/** Desliza a câmera (≈400 ms) até centralizar o ponto pedido pelo mestre, mantendo o zoom. */
function useCameraGlide(): void {
  const store = useTableStore()
  const target = useTable((s) => s.cameraTarget)
  useEffect(() => {
    if (!target) return
    const from = store.getState().viewport
    const to = centerOn(from, target, window.innerWidth, window.innerHeight)
    const start = performance.now()
    let frame = requestAnimationFrame(function step(time) {
      const t = Math.min(1, (time - start) / CAMERA_GLIDE_MS)
      store.getState().actions.setViewport(glideStep(from, to, t))
      if (t < 1) frame = requestAnimationFrame(step)
    })
    return () => cancelAnimationFrame(frame)
  }, [store, target])
}

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
  const shapes = useShapeTool()
  const stageRef = useRef<Konva.Stage>(null)
  const panning = tool === 'hand' || space
  // A grade fica logo acima da camada "map"; sem ela (removida pelo mestre), abaixo de tudo.
  const hasMapLayer = layers.some((l) => l.id === 'map')
  useCameraGlide()

  useEffect(() => {
    if (debug) (window as unknown as { __stage?: Konva.Stage | null }).__stage = stageRef.current
  }, [])

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

  const finishGesture = () => {
    drawing.onUp()
    shapes.onUp()
  }

  const cursor = panning
    ? 'grab'
    : tool === 'pencil'
      ? penMode === 'erase'
        ? 'cell'
        : 'crosshair'
      : tool === 'ruler' || tool === 'shape'
        ? 'crosshair'
        : 'default'

  return (
    <Stage
      ref={stageRef}
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
        const pos = e.target.getStage()?.getRelativePointerPosition()
        // Shift/Ctrl + clique: ping em qualquer ferramenta, sem selecionar, desenhar nem medir.
        if (pos && e.evt.button === 0 && isPingClick(e.evt)) {
          actions.ping(pos, e.evt.ctrlKey || e.evt.metaKey)
          return
        }
        if (tool === 'ruler') {
          if (pos && e.evt.button === 0) actions.rulerClick(pos)
          return
        }
        if (tool === 'select' && e.target === e.target.getStage()) actions.select(null)
        drawing.onDown(e)
        shapes.onDown(e)
      }}
      onMouseMove={(e) => {
        const pos = e.target.getStage()?.getRelativePointerPosition()
        if (pos) {
          actions.cursor(pos.x, pos.y)
          actions.rulerMove(pos)
        }
        if (!panning) {
          drawing.onMove(e)
          shapes.onMove(e)
        }
      }}
      onMouseUp={finishGesture}
      onMouseLeave={finishGesture}
    >
      {!hasMapLayer && <GridLayer />}
      {layers.map((layer) => {
        const active = layer.id === activeLayerId
        const list = byLayer[layer.id] ?? []
        return (
          <Fragment key={layer.id}>
            <Layer listening={active && !panning} opacity={isGm && layer.visibility === 'gm' ? 0.5 : 1}>
              {list.map((o) =>
                o.type === 'image' ? (
                  <ImageNode key={o.id} object={o} />
                ) : o.type === 'stroke' ? (
                  <StrokeNode key={o.id} object={o} segments={drawing.erasePreview[o.id]} />
                ) : (
                  <ShapeNode key={o.id} object={o} />
                ),
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
              {shapes.preview?.layerId === layer.id && <ShapeNode object={shapes.preview.object} preview />}
              {active && <SelectionTransformer />}
            </Layer>
            {layer.id === 'map' && <GridLayer />}
          </Fragment>
        )
      })}
      <Overlay />
    </Stage>
  )
}
```

- [ ] **Step 7: Popover e botão das formas**

Crie `apps/web/src/ui/ShapePopover.tsx`:

```tsx
import { useRef } from 'react'
import { Circle, Minus, Square } from 'lucide-react'
import type { ShapeKind } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'

const KINDS: Array<{ kind: ShapeKind; label: string; Icon: typeof Square }> = [
  { kind: 'rect', label: 'Retângulo', Icon: Square },
  { kind: 'ellipse', label: 'Elipse', Icon: Circle },
  { kind: 'line', label: 'Linha', Icon: Minus },
]

export function ShapePopover({ onClose }: { onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const kind = useTable((s) => s.shapeKind)
  const fill = useTable((s) => s.shapeFill)
  const strokeColor = useTable((s) => s.color)
  const actions = useTableActions()
  const fillDisabled = kind === 'line'
  const percent = Math.round(fill.opacity * 100)

  return (
    <div ref={ref} className="panel popover pen-popover" role="dialog" aria-label="Opções das formas">
      <div className="field">
        <span>Tipo</span>
        <div className="row">
          {KINDS.map(({ kind: k, label, Icon }) => (
            <button key={k} aria-pressed={kind === k} onClick={() => actions.setShapeKind(k)}>
              <Icon size={16} aria-hidden /> {label}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Preenchimento</span>
        <label>
          <input
            type="checkbox"
            checked={fill.enabled && !fillDisabled}
            disabled={fillDisabled}
            onChange={(e) => actions.setShapeFill({ enabled: e.target.checked })}
          />
          Preencher
        </label>
        <div className="row">
          <input
            type="color"
            aria-label="Cor do preenchimento"
            value={fill.color ?? strokeColor}
            disabled={fillDisabled || !fill.enabled}
            onChange={(e) => actions.setShapeFill({ color: e.target.value })}
          />
          <input
            type="range"
            aria-label="Opacidade do preenchimento"
            min={0}
            max={100}
            value={percent}
            disabled={fillDisabled || !fill.enabled}
            onChange={(e) => actions.setShapeFill({ opacity: Number(e.target.value) / 100 })}
          />
          <span>{percent}%</span>
        </div>
      </div>
      <small>Contorno e espessura vêm da caneta.</small>
    </div>
  )
}
```

Troque `apps/web/src/ui/Toolbar.tsx` inteiro por:

```tsx
import { useCallback, useRef, useState } from 'react'
import { Eraser, Grid3x3, Hand, ImagePlus, MousePointer2, Pencil, Ruler, Shapes, Undo2 } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { GridPopover } from './GridPopover'
import { PenPopover } from './PenPopover'
import { ShapePopover } from './ShapePopover'

const ICON = 18

export function Toolbar() {
  const tool = useTable((s) => s.tool)
  const penMode = useTable((s) => s.penMode)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const fileInput = useRef<HTMLInputElement>(null)
  const [penMenu, setPenMenu] = useState(false)
  const [shapeMenu, setShapeMenu] = useState(false)
  const [gridMenu, setGridMenu] = useState(false)
  const closePenMenu = useCallback(() => setPenMenu(false), [])
  const closeShapeMenu = useCallback(() => setShapeMenu(false), [])
  const closeGridMenu = useCallback(() => setGridMenu(false), [])
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
      <div className="pen-anchor">
        <button
          aria-label="Formas (S)"
          title="Formas (S) — botão direito: tipo e preenchimento"
          aria-pressed={tool === 'shape'}
          aria-haspopup="dialog"
          aria-expanded={shapeMenu}
          onClick={() => actions.setTool('shape')}
          onContextMenu={(e) => {
            e.preventDefault()
            setShapeMenu(true)
          }}
        >
          <Shapes size={ICON} aria-hidden />
        </button>
        {shapeMenu && <ShapePopover onClose={closeShapeMenu} />}
      </div>
      <button
        aria-label="Régua (R)"
        title="Régua (R) — clique fixa o início; novo clique ou Esc remove"
        aria-pressed={tool === 'ruler'}
        onClick={() => actions.setTool('ruler')}
      >
        <Ruler size={ICON} aria-hidden />
      </button>
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
      {isGm && (
        <div className="pen-anchor">
          <button
            aria-label="Grade"
            title="Grade (só o mestre)"
            aria-haspopup="dialog"
            aria-expanded={gridMenu}
            onClick={() => setGridMenu(true)}
          >
            <Grid3x3 size={ICON} aria-hidden />
          </button>
          {gridMenu && <GridPopover onClose={closeGridMenu} />}
        </div>
      )}
      <button aria-label="Desfazer (Ctrl+Z)" title="Desfazer (Ctrl+Z)" onClick={() => actions.undo()}>
        <Undo2 size={ICON} aria-hidden />
      </button>
    </div>
  )
}
```

Em `apps/web/src/ui/useKeyboard.ts`, depois de `case 'r': actions.setTool('ruler'); break`, acrescente:

```ts
        case 's': actions.setTool('shape'); break
```

- [ ] **Step 8: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test && pnpm build:e2e`
Expected: tudo verde e build sem erros.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/canvas apps/web/src/ui/ShapePopover.tsx apps/web/src/ui/Toolbar.tsx apps/web/src/ui/useKeyboard.ts apps/web/test/shapes.test.ts
git commit -m "feat(m3): Task 10 — formas: ferramenta, popover, desenho e transformação" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Web — painel do chat, modal do dado e imagens/GIFs

**Files:**
- Create: `apps/web/src/ui/chat/format.ts`, `apps/web/src/ui/chat/ChatEntryView.tsx`, `apps/web/src/ui/chat/ChatPanel.tsx`, `apps/web/src/ui/chat/DiceModal.tsx`, `apps/web/src/ui/chat/ImageLightbox.tsx`
- Modify: `apps/web/src/ui/TablePage.tsx` (coluna da direita), `apps/web/src/styles.css` (acrescentar bloco no fim)
- Test: `apps/web/test/chat-format.test.ts`, `apps/web/test/chat-entry.test.tsx` (NOVOS)

**Interfaces:**
- Consumes: (Task 1) `formatRollFormula`, `DIE_SIDES`, `DICE_MAX_COUNT`, `DICE_MAX_BONUS`, `CHAT_TEXT_MAX`, `CHAT_THUMB_MAX`, `ChatEntry`, `RollRequest`, `RollResult`, `RollMode`; (Task 5) `ALLOWED_UPLOAD_TYPES` com GIF; (Task 7) `state.chatTable/chatDms/chatTabs/chatActive/chatUnread/chatOpen`, `actions.sendChatText/sendRoll/sendChatImage/selectChatTab/closeDm/setChatOpen`, `ChatTab`, `loadDiceConfig/saveDiceConfig/normalizeDiceConfig/toRollRequest/DiceConfig`; M2 `fitWithin`, `useDismiss`, `floatingStyle`.
- Produces:
  - Em `ui/chat/format.ts`: `interface DiePart { value: number; kept: boolean; tone: 'crit' | 'fumble' | null }`, `rollParts(request: Pick<RollRequest, 'die'>, result: Pick<RollResult, 'rolls' | 'kept'>): DiePart[]`, `modeLabel(mode: RollMode): string`, `bonusLabel(bonus: number): string`, `formatTime(at: number): string` (`HH:MM`), `thumbSize(width: number, height: number): { width: number; height: number }` (máx. 240), `pickImageFile<T extends { type: string }>(files: ArrayLike<T> | null | undefined): T | null`
  - `interface ChatAuthor { nickname: string; color: string }`, `<ChatEntryView entry author onOpenImage />` (só texto; autor desconhecido = "Alguém")
  - `<ChatPanel />` — `section[aria-label="Chat"]`; botão "Recolher chat"/"Abrir chat"; `tablist` "Conversas" com abas `role="tab"` ("Mesa" e apelidos), botão `Fechar conversa com <apelido>`; lista `.chat-list` de `li.chat-entry`; campo `aria-label="Mensagem"`; botões "Enviar imagem" e "Rolar 1d20 (botão direito: mais opções)"; `input[data-testid="chat-image-input"]`
  - `<DiceModal x y onClose />` — `role="dialog"`, `aria-label="Rolar dados"`, botões `d4`..`d100`, "Menos um dado"/"Mais um dado", campos "Quantidade" e "Bônus", rádios "Normal"/"Vantagem"/"Desvantagem", checkbox "Só o mestre vê" (só na aba Mesa), botão "Rolar"
  - `<ImageLightbox assetKey onClose />` — `role="dialog"`, `aria-label="Imagem em tamanho real"`, em portal no `body`
  - Layout: `div.right-column` com `MembersPanel`, `ChatPanel`, `LayersPanel` (de cima para baixo)

- [ ] **Step 1: Testes (falham)**

Crie `apps/web/test/chat-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { bonusLabel, formatTime, modeLabel, pickImageFile, rollParts, thumbSize } from '../src/ui/chat/format'

describe('rollParts', () => {
  it('vantagem: o dado descartado fica marcado', () => {
    expect(rollParts({ die: 20 }, { rolls: [17, 8], kept: [17] })).toEqual([
      { value: 17, kept: true, tone: null },
      { value: 8, kept: false, tone: null },
    ])
  })

  it('valores iguais: só um é mantido', () => {
    expect(rollParts({ die: 20 }, { rolls: [5, 5], kept: [5] }).map((d) => d.kept)).toEqual([true, false])
  })

  it('no d20, 20 natural é verde (crit) e 1 natural é vermelho (fumble); nos outros dados não', () => {
    expect(rollParts({ die: 20 }, { rolls: [20, 1], kept: [20] }).map((d) => d.tone)).toEqual(['crit', 'fumble'])
    expect(rollParts({ die: 6 }, { rolls: [6, 1], kept: [6, 1] }).map((d) => d.tone)).toEqual([null, null])
  })
})

describe('rótulos', () => {
  it('modo, bônus e hora', () => {
    expect(modeLabel('normal')).toBe('')
    expect(modeLabel('advantage')).toBe(' (vantagem)')
    expect(modeLabel('disadvantage')).toBe(' (desvantagem)')
    expect(bonusLabel(5)).toBe(' + 5')
    expect(bonusLabel(-3)).toBe(' - 3')
    expect(bonusLabel(0)).toBe('')
    expect(formatTime(new Date(2026, 0, 2, 9, 5).getTime())).toBe('09:05')
    expect(formatTime(new Date(2026, 0, 2, 23, 59).getTime())).toBe('23:59')
  })

  it('miniatura até 240 px sem ampliar imagem pequena', () => {
    expect(thumbSize(1000, 500)).toEqual({ width: 240, height: 120 })
    expect(thumbSize(100, 50)).toEqual({ width: 100, height: 50 })
  })
})

describe('pickImageFile', () => {
  // Review Focus #5
  it('ignora o que não é imagem aceita (texto, PDF, SVG)', () => {
    expect(pickImageFile([{ type: 'text/plain' }, { type: 'application/pdf' }, { type: 'image/svg+xml' }])).toBeNull()
    expect(pickImageFile(null)).toBeNull()
    expect(pickImageFile([])).toBeNull()
  })

  it('pega a primeira imagem aceita, inclusive GIF', () => {
    const gif = { type: 'image/gif', name: 'a.gif' }
    expect(pickImageFile([{ type: 'text/plain' }, gif, { type: 'image/png' }])).toBe(gif)
  })
})
```

Crie `apps/web/test/chat-entry.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { ChatEntry } from '@mesa/shared'
import { ChatEntryView, type ChatAuthor } from '../src/ui/chat/ChatEntryView'

const ana: ChatAuthor = { nickname: 'Ana', color: '#3cb44b' }
const render = (entry: ChatEntry, author: ChatAuthor | null = ana) =>
  renderToStaticMarkup(<ChatEntryView entry={entry} author={author} onOpenImage={() => {}} />).replace(/<!-- -->/g, '')

describe('ChatEntryView', () => {
  // Review Focus #1
  it('texto e apelido com HTML aparecem como texto, nunca como marcação', () => {
    const html = render(
      { id: 'm1', at: 0, authorId: 'a', kind: 'message', text: '<img src=x onerror=alert(1)><b>oi</b>' },
      { nickname: '<i>Ana</i>', color: '#ff0000' },
    )
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&lt;b&gt;oi&lt;/b&gt;')
    expect(html).toContain('&lt;i&gt;Ana&lt;/i&gt;')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('<b>')
    expect(html).not.toContain('<i>')
  })

  it('rolagem: fórmula, modo, descartado riscado, bônus e total', () => {
    const html = render({
      id: 'r1', at: 0, authorId: 'a', kind: 'roll', secret: false,
      request: { die: 20, count: 1, bonus: 5, mode: 'advantage' },
      result: { rolls: [17, 8], kept: [17], total: 22 },
    })
    expect(html).toMatch(/Ana<\/strong> rolou <strong>1d20\+5<\/strong> \(vantagem\): \[/)
    expect(html).toContain('<s><span>8</span></s>')
    expect(html).toContain('] + 5 = <strong>22</strong>')
    expect(html).not.toContain('(só mestre)')
  })

  it('rolagem secreta tem o rótulo (só mestre); 20 natural ganha a classe crit', () => {
    const html = render({
      id: 'r2', at: 0, authorId: 'a', kind: 'roll', secret: true,
      request: { die: 20, count: 1, bonus: 0, mode: 'normal' },
      result: { rolls: [20], kept: [20], total: 20 },
    })
    expect(html).toContain('chat-entry roll secret')
    expect(html).toContain('(só mestre)')
    expect(html).toContain('<span class="crit">20</span>')
  })

  it('imagem vira miniatura clicável; autor desconhecido aparece como "Alguém"', () => {
    const html = render({ id: 'i1', at: 0, authorId: 'x', kind: 'image', assetKey: 'a'.repeat(64), width: 1000, height: 500 }, null)
    expect(html).toContain(`src="/files/${'a'.repeat(64)}"`)
    expect(html).toContain('width="240"')
    expect(html).toContain('Alguém')
  })
})
```

Run: `pnpm --filter @mesa/web test -- chat-format chat-entry`
Expected: FAIL — módulos inexistentes.

- [ ] **Step 2: Formatação**

Crie `apps/web/src/ui/chat/format.ts`:

```ts
import { ALLOWED_UPLOAD_TYPES, CHAT_THUMB_MAX, type RollMode, type RollRequest, type RollResult } from '@mesa/shared'
import { fitWithin } from '../../lib/image'

export interface DiePart {
  value: number
  /** false = descartado (vantagem/desvantagem): aparece riscado. */
  kept: boolean
  /** Só no d20: 20 natural = 'crit' (verde), 1 natural = 'fumble' (vermelho). */
  tone: 'crit' | 'fumble' | null
}

export function rollParts(request: Pick<RollRequest, 'die'>, result: Pick<RollResult, 'rolls' | 'kept'>): DiePart[] {
  const remaining = [...result.kept]
  return result.rolls.map((value) => {
    const i = remaining.indexOf(value)
    if (i !== -1) remaining.splice(i, 1)
    const tone = request.die !== 20 ? null : value === 20 ? 'crit' : value === 1 ? 'fumble' : null
    return { value, kept: i !== -1, tone }
  })
}

export function modeLabel(mode: RollMode): string {
  return mode === 'advantage' ? ' (vantagem)' : mode === 'disadvantage' ? ' (desvantagem)' : ''
}

export function bonusLabel(bonus: number): string {
  return bonus > 0 ? ` + ${bonus}` : bonus < 0 ? ` - ${-bonus}` : ''
}

export function formatTime(at: number): string {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function thumbSize(width: number, height: number): { width: number; height: number } {
  return fitWithin(width, height, CHAT_THUMB_MAX)
}

/** Primeiro arquivo de imagem aceito pelo upload (PNG, JPEG, WebP ou GIF); o resto é ignorado. */
export function pickImageFile<T extends { type: string }>(files: ArrayLike<T> | null | undefined): T | null {
  return Array.from(files ?? []).find((f) => ALLOWED_UPLOAD_TYPES.includes(f.type)) ?? null
}
```

- [ ] **Step 3: Entrada do chat**

Crie `apps/web/src/ui/chat/ChatEntryView.tsx`:

```tsx
import { Fragment } from 'react'
import { formatRollFormula, type ChatEntry } from '@mesa/shared'
import { bonusLabel, formatTime, modeLabel, rollParts, thumbSize } from './format'

export interface ChatAuthor {
  nickname: string
  color: string
}

const UNKNOWN: ChatAuthor = { nickname: 'Alguém', color: '#9aa0aa' }

/** Tudo vira nó de texto do React: nada que chega pelo chat é interpretado como HTML. */
export function ChatEntryView({
  entry,
  author,
  onOpenImage,
}: {
  entry: ChatEntry
  author: ChatAuthor | null
  onOpenImage: (assetKey: string) => void
}) {
  const { nickname, color } = author ?? UNKNOWN
  const name = <strong style={{ color }}>{nickname}</strong>
  const time = <time dateTime={new Date(entry.at).toISOString()}>{formatTime(entry.at)}</time>

  if (entry.kind === 'roll') {
    const { request, result } = entry
    return (
      <li className={entry.secret ? 'chat-entry roll secret' : 'chat-entry roll'}>
        {name} rolou <strong>{formatRollFormula(request)}</strong>{modeLabel(request.mode)}: [
        {rollParts(request, result).map((d, i) => {
          const value = <span className={d.tone ?? undefined}>{d.value}</span>
          return (
            <Fragment key={i}>
              {i > 0 && ', '}
              {d.kept ? value : <s>{value}</s>}
            </Fragment>
          )
        })}
        ]{bonusLabel(request.bonus)} = <strong>{result.total}</strong>
        {entry.secret && <span className="secret-label"> (só mestre)</span>} {time}
      </li>
    )
  }

  if (entry.kind === 'image') {
    const { assetKey } = entry
    return (
      <li className="chat-entry">
        <div>
          {name} {time}
        </div>
        <button type="button" className="chat-thumb" aria-label={`Abrir imagem enviada por ${nickname}`} onClick={() => onOpenImage(assetKey)}>
          <img src={`/files/${assetKey}`} alt={`Imagem enviada por ${nickname}`} {...thumbSize(entry.width, entry.height)} />
        </button>
      </li>
    )
  }

  return (
    <li className="chat-entry">
      <div>
        {name} {time}
      </div>
      <p className="chat-text">{entry.text}</p>
    </li>
  )
}
```

Run: `pnpm --filter @mesa/web test -- chat-format chat-entry`
Expected: PASS.

- [ ] **Step 4: Modal do dado e overlay da imagem**

Crie `apps/web/src/ui/chat/DiceModal.tsx`:

```tsx
import { useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import { DICE_MAX_BONUS, DICE_MAX_COUNT, DIE_SIDES, type RollMode } from '@mesa/shared'
import { loadDiceConfig, normalizeDiceConfig, saveDiceConfig, toRollRequest, type DiceConfig } from '../../lib/dice-config'
import { useTable, useTableActions } from '../../store/context'
import { floatingStyle, useDismiss } from '../useDismiss'

const MODES: Array<{ mode: RollMode; label: string }> = [
  { mode: 'normal', label: 'Normal' },
  { mode: 'advantage', label: 'Vantagem' },
  { mode: 'disadvantage', label: 'Desvantagem' },
]

export function DiceModal({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const onTable = useTable((s) => s.chatActive === 'table')
  const actions = useTableActions()
  // Lembra a última configuração usada (salva ao rolar).
  const [config, setConfig] = useState<DiceConfig>(() => loadDiceConfig())
  const update = (patch: Partial<DiceConfig>) => setConfig((c) => normalizeDiceConfig({ ...c, ...patch }))

  const roll = () => {
    saveDiceConfig(config)
    actions.sendRoll(toRollRequest(config), onTable && config.secret)
    onClose()
  }

  return (
    <div
      ref={ref}
      className="panel popover floating dice-modal"
      role="dialog"
      aria-label="Rolar dados"
      style={floatingStyle(x - 300, y - 360, 280)}
    >
      <div className="field">
        <span>Dado</span>
        <div className="row">
          {DIE_SIDES.map((die) => (
            <button key={die} aria-pressed={config.die === die} onClick={() => update({ die })}>
              d{die}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <span>Quantidade</span>
        <div className="row">
          <button aria-label="Menos um dado" disabled={config.count <= 1} onClick={() => update({ count: config.count - 1 })}>
            <Minus size={14} aria-hidden />
          </button>
          <input
            key={`count-${config.count}`}
            type="number"
            aria-label="Quantidade"
            min={1}
            max={DICE_MAX_COUNT}
            defaultValue={config.count}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
            }}
            onBlur={(e) => update({ count: e.currentTarget.valueAsNumber })}
          />
          <button
            aria-label="Mais um dado"
            disabled={config.count >= DICE_MAX_COUNT}
            onClick={() => update({ count: config.count + 1 })}
          >
            <Plus size={14} aria-hidden />
          </button>
        </div>
      </div>

      <label className="field">
        Bônus
        <input
          key={`bonus-${config.bonus}`}
          type="number"
          min={-DICE_MAX_BONUS}
          max={DICE_MAX_BONUS}
          step={1}
          defaultValue={config.bonus}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
          }}
          onBlur={(e) => update({ bonus: e.currentTarget.valueAsNumber })}
        />
      </label>

      <div className="field" role="radiogroup" aria-label="Modo">
        {MODES.map((m) => (
          <label key={m.mode}>
            <input
              type="radio"
              name="dice-mode"
              checked={config.mode === m.mode}
              disabled={m.mode !== 'normal' && config.count !== 1}
              onChange={() => update({ mode: m.mode })}
            />
            {m.label}
          </label>
        ))}
      </div>

      {onTable && (
        <label>
          <input type="checkbox" checked={config.secret} onChange={(e) => update({ secret: e.target.checked })} />
          Só o mestre vê
        </label>
      )}

      <button onClick={roll}>Rolar</button>
    </div>
  )
}
```

Crie `apps/web/src/ui/chat/ImageLightbox.tsx`:

```tsx
import { useRef } from 'react'
import { createPortal } from 'react-dom'
import { useDismiss } from '../useDismiss'

/** Imagem do chat em tamanho real; Esc ou clique fora da imagem fecha. */
export function ImageLightbox({ assetKey, onClose }: { assetKey: string; onClose: () => void }) {
  const ref = useRef<HTMLImageElement>(null)
  useDismiss(ref, onClose)
  return createPortal(
    <div className="modal-backdrop lightbox" role="dialog" aria-label="Imagem em tamanho real">
      <img ref={ref} src={`/files/${assetKey}`} alt="Imagem do chat em tamanho real" />
    </div>,
    document.body,
  )
}
```

- [ ] **Step 5: Painel do chat**

Crie `apps/web/src/ui/chat/ChatPanel.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from 'react'
import { Dices, ImagePlus, MessageSquare, X } from 'lucide-react'
import { CHAT_TEXT_MAX, type ChatEntry, type RollRequest } from '@mesa/shared'
import type { ChatTab } from '../../store/chat'
import { useTable, useTableActions } from '../../store/context'
import { ChatEntryView } from './ChatEntryView'
import { DiceModal } from './DiceModal'
import { ImageLightbox } from './ImageLightbox'
import { pickImageFile } from './format'

const EMPTY: ChatEntry[] = []
const D20: RollRequest = { die: 20, count: 1, bonus: 0, mode: 'normal' }

export function ChatPanel() {
  const open = useTable((s) => s.chatOpen)
  const active = useTable((s) => s.chatActive)
  const tabs = useTable((s) => s.chatTabs)
  const unread = useTable((s) => s.chatUnread)
  const members = useTable((s) => s.members)
  const entries = useTable((s) => (s.chatActive === 'table' ? s.chatTable : (s.chatDms[s.chatActive] ?? EMPTY)))
  const actions = useTableActions()
  const [text, setText] = useState('')
  const [dice, setDice] = useState<{ x: number; y: number } | null>(null)
  const [lightbox, setLightbox] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLOListElement>(null)
  const closeDice = useCallback(() => setDice(null), [])
  const closeLightbox = useCallback(() => setLightbox(null), [])
  const totalUnread = Object.values(unread).reduce((sum, n) => sum + n, 0)
  const tabName = (tab: ChatTab) => (tab === 'table' ? 'Mesa' : (members[tab]?.nickname ?? 'Conversa'))

  // Sempre mostra o fim da conversa.
  useEffect(() => {
    const list = listRef.current
    if (list) list.scrollTop = list.scrollHeight
  }, [entries, active, open])

  const sendImage = (file: Blob | null) => {
    if (file) void actions.sendChatImage(file)
  }

  return (
    <section
      className={open ? 'panel chat open' : 'panel chat'}
      aria-label="Chat"
      onPaste={(e) => {
        const file = pickImageFile(e.clipboardData.files)
        if (!file) return // texto colado segue para o campo normalmente
        e.preventDefault()
        sendImage(file)
      }}
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        e.stopPropagation()
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        sendImage(pickImageFile(e.dataTransfer.files))
      }}
    >
      <header className="chat-header">
        <button
          className="icon-button"
          aria-label={open ? 'Recolher chat' : 'Abrir chat'}
          aria-expanded={open}
          title="Chat"
          onClick={() => actions.setChatOpen(!open)}
        >
          <MessageSquare size={16} aria-hidden /> Chat
          {!open && totalUnread > 0 && <span className="badge">{totalUnread}</span>}
        </button>
      </header>

      {open && (
        <>
          <div className="chat-tabs" role="tablist" aria-label="Conversas">
            {['table', ...tabs].map((tab) => {
              const count = unread[tab] ?? 0
              return (
                <div key={tab} className="chat-tab">
                  <button role="tab" aria-selected={active === tab} onClick={() => actions.selectChatTab(tab)}>
                    {tabName(tab)}
                    {count > 0 && (
                      <span className="badge" aria-label={`${count} não lidas`}>
                        {count}
                      </span>
                    )}
                  </button>
                  {tab !== 'table' && (
                    <button
                      className="icon-button"
                      aria-label={`Fechar conversa com ${tabName(tab)}`}
                      title="Fechar (apaga a conversa)"
                      onClick={() => actions.closeDm(tab)}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <ol ref={listRef} className="chat-list" aria-label={`Mensagens — ${tabName(active)}`}>
            {entries.map((entry) => (
              <ChatEntryView key={entry.id} entry={entry} author={members[entry.authorId] ?? null} onOpenImage={setLightbox} />
            ))}
          </ol>

          <form
            className="chat-input"
            onSubmit={(e) => {
              e.preventDefault()
              if (actions.sendChatText(text)) setText('')
            }}
          >
            <input
              aria-label="Mensagem"
              value={text}
              maxLength={CHAT_TEXT_MAX}
              placeholder="Mensagem ou /r 1d20+3"
              onChange={(e) => setText(e.target.value)}
            />
            <button type="button" className="icon-button" aria-label="Enviar imagem" title="Enviar imagem ou GIF" onClick={() => fileInput.current?.click()}>
              <ImagePlus size={16} aria-hidden />
            </button>
            <button
              type="button"
              className="icon-button"
              aria-label="Rolar 1d20 (botão direito: mais opções)"
              title="Rolar 1d20 — botão direito: mais opções"
              onClick={() => actions.sendRoll(D20, false)}
              onContextMenu={(e) => {
                e.preventDefault()
                setDice({ x: e.clientX, y: e.clientY })
              }}
            >
              <Dices size={16} aria-hidden />
            </button>
            <input
              ref={fileInput}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              hidden
              data-testid="chat-image-input"
              onChange={(e) => {
                sendImage(pickImageFile(e.target.files))
                e.target.value = ''
              }}
            />
          </form>
        </>
      )}

      {dice && <DiceModal x={dice.x} y={dice.y} onClose={closeDice} />}
      {lightbox && <ImageLightbox assetKey={lightbox} onClose={closeLightbox} />}
    </section>
  )
}
```

- [ ] **Step 6: Coluna da direita e estilos**

Em `apps/web/src/ui/TablePage.tsx`, acrescente o import

```tsx
import { ChatPanel } from './chat/ChatPanel'
```

e troque as linhas

```tsx
      <LayersPanel />
      <ObjectContextMenu />
      <MembersPanel />
```

por

```tsx
      <div className="right-column">
        <MembersPanel />
        <ChatPanel />
        <LayersPanel />
      </div>
      <ObjectContextMenu />
```

Acrescente no fim de `apps/web/src/styles.css`:

```css

/* M3 — coluna da direita (membros, chat, camadas), chat, dados e imagens */
.right-column { position: absolute; top: 12px; right: 12px; bottom: 12px; width: 300px; display: flex; flex-direction: column; gap: 8px; z-index: 10; pointer-events: none; }
.right-column > * { pointer-events: auto; }
.right-column > .panel { position: static; }
.right-column > .members { max-height: 25vh; overflow: auto; }
.right-column > .layers { width: auto; margin-top: auto; }
.chat { display: flex; flex-direction: column; gap: 6px; min-height: 0; }
.chat.open { flex: 1 1 auto; }
.chat-header { display: flex; align-items: center; justify-content: space-between; }
.chat-tabs { display: flex; gap: 4px; flex-wrap: wrap; }
.chat-tab { display: inline-flex; align-items: center; gap: 2px; }
.chat-tab button[role='tab'] { padding: 4px 8px; }
.chat-tab button[aria-selected='true'] { background: #4363d8; border-color: #4363d8; }
.badge { background: #e6194b; color: #fff; border-radius: 9px; padding: 0 6px; font-size: 11px; line-height: 18px; min-width: 18px; text-align: center; }
.chat-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1 1 auto; min-height: 60px; display: grid; gap: 6px; align-content: start; font-size: 13px; }
.chat-entry { padding: 4px 6px; border-radius: 6px; overflow-wrap: anywhere; }
.chat-entry time { opacity: 0.6; font-size: 11px; margin-left: 4px; }
.chat-text { margin: 2px 0 0; white-space: pre-wrap; }
.chat-entry.secret { background: #111216; border: 1px dashed #4a4d57; }
.secret-label { opacity: 0.75; font-style: italic; }
.chat-entry .crit { color: #3cb44b; font-weight: 700; }
.chat-entry .fumble { color: #ff5c5c; font-weight: 700; }
.chat-entry s { opacity: 0.55; }
.chat-thumb { padding: 0; background: none; border: none; margin-top: 4px; }
.chat-thumb img { max-width: 240px; max-height: 240px; object-fit: contain; border-radius: 4px; display: block; }
.chat-input { display: flex; gap: 4px; }
.chat-input input { flex: 1; min-width: 0; }
.dice-modal .row button { padding: 4px 6px; }
.dice-modal input[type='number'] { width: 72px; }
.lightbox img { max-width: 92vw; max-height: 92vh; object-fit: contain; }
```

- [ ] **Step 7: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test && pnpm build:e2e`
Expected: tudo verde e build sem erros.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/ui/chat apps/web/src/ui/TablePage.tsx apps/web/src/styles.css apps/web/test/chat-format.test.ts apps/web/test/chat-entry.test.tsx
git commit -m "feat(m3): Task 11 — painel do chat, modal do dado e imagens/GIFs" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: Web — menu do membro: conversa privada e edição de apelido/cor pelo mestre

**Files:**
- Create: `apps/web/src/ui/memberMenu.ts`, `apps/web/src/ui/MemberMenu.tsx`
- Modify: `apps/web/src/ui/MembersPanel.tsx` (arquivo inteiro)
- Test: `apps/web/test/member-menu.test.ts` (NOVO)

**Interfaces:**
- Consumes: (Task 3) `MemberPatch` (apelido 1..32); (Task 6) `actions.updateMember`; (Task 7) `actions.openDm`; M2 `useDismiss`, `floatingStyle`.
- Produces:
  - `memberMenuOptions(targetId: string, selfId: string | undefined, isGm: boolean): { dm: boolean; edit: boolean }`
  - `memberPatch(member: Pick<Member, 'nickname' | 'color'>, nickname: string, color: string): MemberPatch | null` (só o que mudou; apelido aparado e cortado em 32; vazio ou cor inválida são ignorados)
  - `<MemberMenu member x y onClose />` — `role="dialog"`, `aria-label="Ações para <apelido>"`, botões "Conversa privada" e "Editar apelido e cor"; formulário com "Apelido", "Cor" e "Salvar"
  - Botão direito numa linha de `.members li` abre o menu (só se houver alguma opção)

- [ ] **Step 1: Testes (falham)**

Crie `apps/web/test/member-menu.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { memberMenuOptions, memberPatch } from '../src/ui/memberMenu'

describe('memberMenuOptions', () => {
  it('conversa privada com qualquer outro; edição só para o mestre (inclusive de si mesmo)', () => {
    expect(memberMenuOptions('b', 'a', false)).toEqual({ dm: true, edit: false })
    expect(memberMenuOptions('a', 'a', false)).toEqual({ dm: false, edit: false })
    expect(memberMenuOptions('b', 'g', true)).toEqual({ dm: true, edit: true })
    expect(memberMenuOptions('g', 'g', true)).toEqual({ dm: false, edit: true })
  })
})

describe('memberPatch', () => {
  const ana = { nickname: 'Ana', color: '#3cb44b' }

  it('só manda o que mudou, com o apelido aparado', () => {
    expect(memberPatch(ana, '  Aninha  ', '#3cb44b')).toEqual({ nickname: 'Aninha' })
    expect(memberPatch(ana, 'Ana', '#123456')).toEqual({ color: '#123456' })
    expect(memberPatch(ana, 'Bia', '#123456')).toEqual({ nickname: 'Bia', color: '#123456' })
  })

  it('nada mudou, apelido vazio ou cor inválida: nada a enviar', () => {
    expect(memberPatch(ana, 'Ana', '#3CB44B')).toBeNull()
    expect(memberPatch(ana, '   ', '#3cb44b')).toBeNull()
    expect(memberPatch(ana, 'Ana', 'red')).toBeNull()
  })

  it('apelido maior que 32 é cortado', () => {
    expect(memberPatch(ana, 'x'.repeat(40), '#3cb44b')).toEqual({ nickname: 'x'.repeat(32) })
  })
})
```

Run: `pnpm --filter @mesa/web test -- member-menu`
Expected: FAIL — módulo inexistente.

- [ ] **Step 2: Regras do menu**

Crie `apps/web/src/ui/memberMenu.ts`:

```ts
import type { Member, MemberPatch } from '@mesa/shared'

const NICKNAME_MAX = 32
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

/** "Conversa privada" não aparece para si mesmo; "Editar apelido e cor" é só do mestre. */
export function memberMenuOptions(targetId: string, selfId: string | undefined, isGm: boolean): { dm: boolean; edit: boolean } {
  return { dm: targetId !== selfId, edit: isGm }
}

/** Patch só com o que mudou; null quando não há nada válido a enviar. */
export function memberPatch(member: Pick<Member, 'nickname' | 'color'>, nickname: string, color: string): MemberPatch | null {
  const patch: MemberPatch = {}
  const name = nickname.trim().slice(0, NICKNAME_MAX)
  if (name && name !== member.nickname) patch.nickname = name
  if (COLOR_RE.test(color) && color.toLowerCase() !== member.color.toLowerCase()) patch.color = color.toLowerCase()
  return patch.nickname !== undefined || patch.color !== undefined ? patch : null
}
```

Run: `pnpm --filter @mesa/web test -- member-menu`
Expected: PASS.

- [ ] **Step 3: Menu do membro**

Crie `apps/web/src/ui/MemberMenu.tsx`:

```tsx
import { useRef, useState } from 'react'
import { MessageCircle, UserPen } from 'lucide-react'
import type { Member } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { memberMenuOptions, memberPatch } from './memberMenu'
import { floatingStyle, useDismiss } from './useDismiss'

export function MemberMenu({ member, x, y, onClose }: { member: Member; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const selfId = useTable((s) => s.self?.clientId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const [editing, setEditing] = useState(false)
  const [nickname, setNickname] = useState(member.nickname)
  const [color, setColor] = useState(member.color)
  const options = memberMenuOptions(member.clientId, selfId, isGm)

  return (
    <div
      ref={ref}
      className="panel popover floating"
      role="dialog"
      aria-label={`Ações para ${member.nickname}`}
      style={floatingStyle(x - 260, y, 240)}
    >
      {options.dm && (
        <button
          onClick={() => {
            actions.openDm(member.clientId)
            onClose()
          }}
        >
          <MessageCircle size={16} aria-hidden /> Conversa privada
        </button>
      )}
      {options.edit && !editing && (
        <button onClick={() => setEditing(true)}>
          <UserPen size={16} aria-hidden /> Editar apelido e cor
        </button>
      )}
      {options.edit && editing && (
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault()
            const patch = memberPatch(member, nickname, color)
            if (patch) actions.updateMember(member.clientId, patch)
            onClose()
          }}
        >
          <label className="field">
            Apelido
            <input autoFocus value={nickname} maxLength={32} onChange={(e) => setNickname(e.target.value)} />
          </label>
          <label>
            Cor
            <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
          </label>
          <button type="submit" disabled={!nickname.trim()}>
            Salvar
          </button>
        </form>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Botão direito na lista de membros**

Troque `apps/web/src/ui/MembersPanel.tsx` inteiro por:

```tsx
import { useCallback, useState } from 'react'
import { X } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { MemberMenu } from './MemberMenu'
import { memberMenuOptions } from './memberMenu'

export function MembersPanel() {
  const members = useTable((s) => s.members)
  const selfId = useTable((s) => s.self?.clientId)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const [menu, setMenu] = useState<{ clientId: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // O servidor já filtra: online ou vistos nos últimos 7 dias.
  const list = Object.values(members).sort(
    (a, b) => Number(b.online) - Number(a.online) || a.nickname.localeCompare(b.nickname),
  )
  const menuMember = menu ? members[menu.clientId] : undefined

  return (
    <div className="panel members">
      <strong>Na mesa</strong>
      <ul>
        {list.map((m) => (
          <li
            key={m.clientId}
            className={m.online ? '' : 'offline'}
            title="Botão direito: conversa privada"
            onContextMenu={(e) => {
              e.preventDefault()
              const options = memberMenuOptions(m.clientId, selfId, isGm)
              if (options.dm || options.edit) setMenu({ clientId: m.clientId, x: e.clientX, y: e.clientY })
            }}
          >
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
      {menu && menuMember && (
        <MemberMenu key={menu.clientId} member={menuMember} x={menu.x} y={menu.y} onClose={closeMenu} />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `pnpm --filter @mesa/web test && pnpm --filter @mesa/web typecheck`
Expected: PASS.

Run: `pnpm typecheck && pnpm test && pnpm build:e2e`
Expected: tudo verde e build sem erros.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/memberMenu.ts apps/web/src/ui/MemberMenu.tsx apps/web/src/ui/MembersPanel.tsx apps/web/test/member-menu.test.ts
git commit -m "feat(m3): Task 12 — menu do membro: conversa privada e edição pelo mestre" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: Ponta a ponta do M3, README e verificação final

**Files:**
- Modify: `e2e/table.spec.ts` (acrescentar no fim)
- Modify: `README.md` (linha 3 e nova seção "Na mesa")

**Interfaces:**
- Consumes: tudo das Tasks 1–12; em `?debug=1`, `window.__mesa` (store) e `window.__stage` (Stage do Konva, Task 9). Rótulos: "Rolar 1d20 (botão direito: mais opções)", diálogo "Rolar dados" com "Só o mestre vê" e "Rolar"; `section[aria-label="Chat"] .chat-entry`; abas `role="tab"`; "Fechar conversa com <apelido>"; diálogo "Ações para <apelido>" com "Conversa privada", "Editar apelido e cor", "Apelido", "Salvar"; botão "Grade" e diálogo "Grade" com "Mostrar grade"/"Encaixar imagens na grade"; botões "Régua (R)" e "Formas (S)"; diálogo "Opções das formas" com "Retângulo"/"Elipse"/"Linha"; `input[data-testid="chat-image-input"]`; Konva `.ruler-label`.
- Produces: 9 testes E2E do spec §11.

- [ ] **Step 1: Testes E2E**

Acrescente no fim de `e2e/table.spec.ts`:

```ts

// ---------------------------------------------------------------- M3

const chatEntries = (page: Page) => page.locator('section[aria-label="Chat"] .chat-entry')

const memberRow = (page: Page, name: string) =>
  page.locator('.members li').filter({ hasText: new RegExp(`^\\s*${name}(?![\\p{L}\\d])`, 'u') })

const chatState = (page: Page): Promise<string> =>
  page.evaluate(() => {
    const s = (window as any).__mesa.getState()
    return JSON.stringify({ table: s.chatTable, dms: s.chatDms, tabs: s.chatTabs })
  })

async function memberMenu(page: Page, name: string) {
  await memberRow(page, name).click({ button: 'right' })
  const menu = page.getByRole('dialog', { name: `Ações para ${name}` })
  await expect(menu).toBeVisible()
  return menu
}

async function dragOnCanvas(page: Page, from: [number, number], to: [number, number]): Promise<void> {
  await page.mouse.move(from[0], from[1])
  await page.mouse.down()
  await page.mouse.move(to[0], to[1], { steps: 8 })
  await page.mouse.up()
}

const DICE_BUTTON = 'Rolar 1d20 (botão direito: mais opções)'

test('clique no dado rola 1d20 e aparece no chat do outro', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await player.getByRole('button', { name: DICE_BUTTON }).click()
  await expect(chatEntries(gm)).toHaveCount(1)
  await expect(chatEntries(gm).first()).toContainText('Ana rolou 1d20: [')
  await expect(chatEntries(player)).toHaveCount(1)
})

test('rolagem secreta do mestre não aparece para o jogador', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await gm.getByRole('button', { name: DICE_BUTTON }).click({ button: 'right' })
  const modal = gm.getByRole('dialog', { name: 'Rolar dados' })
  await expect(modal).toBeVisible()
  await modal.getByRole('button', { name: 'd6', exact: true }).click()
  await modal.getByLabel('Só o mestre vê').check()
  await modal.getByRole('button', { name: 'Rolar', exact: true }).click()
  await expect(modal).toHaveCount(0)

  await expect(chatEntries(gm)).toHaveCount(1)
  await expect(chatEntries(gm).first()).toContainText('rolou 1d6')
  await expect(chatEntries(gm).first()).toContainText('(só mestre)')
  await player.waitForTimeout(500)
  await expect(chatEntries(player)).toHaveCount(0)
  expect(await chatState(player)).not.toContain('"secret":true')
})

test('conversa privada chega só ao destinatário; o mestre não recebe; fechar a aba apaga', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const bia = await open(browser, `/t/${tableId}?debug=1`, 'Bia')

  await expect(memberRow(ana, 'Bia')).toBeVisible()
  await (await memberMenu(ana, 'Bia')).getByRole('button', { name: 'Conversa privada' }).click()
  await expect(ana.getByRole('tab', { name: /^Bia/ })).toHaveAttribute('aria-selected', 'true')
  await ana.getByLabel('Mensagem', { exact: true }).fill('segredo entre nós')
  await ana.getByLabel('Mensagem', { exact: true }).press('Enter')
  await expect(chatEntries(ana).last()).toContainText('segredo entre nós')

  // Bia: a aba aparece sem tirar o foco da Mesa, com contador de não lidas.
  const tabAna = bia.getByRole('tab', { name: /^Ana/ })
  await expect(tabAna).toBeVisible()
  await expect(tabAna).toHaveAttribute('aria-selected', 'false')
  await expect(tabAna.locator('.badge')).toHaveText('1')
  await expect(bia.getByRole('tab', { name: /^Mesa/ })).toHaveAttribute('aria-selected', 'true')
  await tabAna.click()
  await expect(chatEntries(bia).last()).toContainText('segredo entre nós')

  // O mestre não participa: nada chega a ele.
  await gm.waitForTimeout(500)
  await expect(gm.getByRole('tab')).toHaveCount(1)
  expect(await chatState(gm)).not.toContain('segredo')

  // Fechar a aba apaga o histórico; reabrir começa vazia.
  await bia.getByRole('button', { name: 'Fechar conversa com Ana' }).click()
  await expect(tabAna).toHaveCount(0)
  expect(await chatState(bia)).not.toContain('segredo')
  await (await memberMenu(bia, 'Ana')).getByRole('button', { name: 'Conversa privada' }).click()
  await expect(bia.getByRole('tab', { name: /^Ana/ })).toHaveAttribute('aria-selected', 'true')
  await expect(chatEntries(bia)).toHaveCount(0)
})

test('imagem enviada no chat aparece no outro cliente', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  const uploaded = player.waitForResponse((r) => r.url().includes('/assets') && r.status() === 201)
  await player.getByTestId('chat-image-input').setInputFiles({ name: 'foto.png', mimeType: 'image/png', buffer: PNG })
  await uploaded
  const img = chatEntries(gm).locator('img')
  await expect(img).toHaveCount(1)
  await expect(img).toHaveAttribute('src', /^\/files\/[a-f0-9]{64}$/)
})

test('mestre liga grade e encaixe: token solto cai alinhado na tela do jogador', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await gm.getByRole('button', { name: 'Grade', exact: true }).click()
  const pop = gm.getByRole('dialog', { name: 'Grade' })
  await pop.getByLabel('Mostrar grade').check()
  await pop.getByLabel('Encaixar imagens na grade').check()
  await gm.keyboard.press('Escape')
  await expect
    .poll(() => player.evaluate(() => (window as any).__mesa.getState().settings.grid))
    .toEqual({ enabled: true, size: 70, snap: true })

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [token] = await objects(gm)
  // centro da tela (640, 360) − 35 → (605, 325) → encaixado em (630, 350)
  expect(token).toMatchObject({ x: 630, y: 350, width: 70, height: 70 })

  await dragObject(gm, token, 100, 50)
  await expect
    .poll(async () => {
      const [o] = await objects(player)
      return [o.x, o.y]
    })
    .toEqual([700, 420])
})

test('régua do mestre aparece para o jogador com nome e distância', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const labels = () => player.evaluate(() => (window as any).__stage.find('.ruler-label').map((n: any) => n.text()))

  await gm.getByRole('button', { name: 'Régua (R)' }).click()
  await gm.mouse.click(400, 300) // início no centro do quadrado (385, 315)
  await gm.mouse.move(700, 300, { steps: 10 })
  await expect.poll(labels).toEqual(['Mestre · 4,5 q'])

  await gm.keyboard.press('Escape')
  await expect.poll(labels).toEqual([])
})

test('retângulo, elipse e linha aparecem para o outro', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  const drawShape = async (label: string, from: [number, number], to: [number, number]) => {
    await gm.getByRole('button', { name: 'Formas (S)' }).click({ button: 'right' })
    const pop = gm.getByRole('dialog', { name: 'Opções das formas' })
    await pop.getByRole('button', { name: label }).click()
    await gm.keyboard.press('Escape')
    await expect(pop).toHaveCount(0)
    await dragOnCanvas(gm, from, to)
  }
  await drawShape('Retângulo', [200, 450], [300, 520])
  await drawShape('Elipse', [350, 450], [450, 520])
  await drawShape('Linha', [500, 450], [600, 520])

  await expect
    .poll(async () =>
      (await objects(player))
        .filter((o) => o.type === 'shape')
        .map((o) => (o as Obj & { kind: string }).kind)
        .sort(),
    )
    .toEqual(['ellipse', 'line', 'rect'])
})

test('Ctrl + clique do mestre centraliza a câmera do jogador', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await gm.keyboard.down('Control')
  await gm.mouse.click(900, 500)
  await gm.keyboard.up('Control')

  // tela 1280×720: o ponto (900, 500) vai para o centro (640, 360), zoom mantido
  await expect
    .poll(() =>
      player.evaluate(() => {
        const v = (window as any).__mesa.getState().viewport
        return [Math.round(v.x), Math.round(v.y), v.scale]
      }),
    )
    .toEqual([-260, -140, 1])
  expect(await gm.evaluate(() => (window as any).__mesa.getState().viewport)).toEqual({ x: 0, y: 0, scale: 1 })
})

test('mestre renomeia o jogador: muda na tela dele e persiste ao recarregar', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  const menu = await memberMenu(gm, 'Ana')
  await menu.getByRole('button', { name: 'Editar apelido e cor' }).click()
  await menu.getByLabel('Apelido').fill('Aninha')
  await menu.getByRole('button', { name: 'Salvar' }).click()
  await expect(menu).toHaveCount(0)
  await expect(memberRow(player, 'Aninha')).toContainText('(você)')

  await player.reload()
  await waitOpen(player)
  await expect(memberRow(player, 'Aninha')).toContainText('(você)')
  await expect(memberRow(gm, 'Aninha')).toBeVisible()
})
```

- [ ] **Step 2: Rodar o E2E**

Run: `pnpm e2e`
Expected: PASS em todos (os do M2 e os 9 novos). O Playwright sobe o próprio wrangler na 8788 com `apps/web/dist-e2e` e `.wrangler/e2e-state`; não toque na 8787.

Se um teste novo falhar, investigue a causa (não aumente timeouts às cegas): confira primeiro os rótulos acessíveis listados em **Interfaces** e o estado via `window.__mesa.getState()`.

- [ ] **Step 3: README**

Em `README.md`, troque a linha 3

```markdown
Mesa colaborativa estilo Roll20: mapa, tokens, desenho e camada do mestre em tempo real.
```

por

```markdown
Mesa colaborativa estilo Roll20: mapa, tokens, desenho, formas, grade, régua, ping, chat com dados
e camada do mestre em tempo real.

## Na mesa

- **Grade** (só o mestre): botão "Grade" na barra — mostrar, tamanho do quadrado e encaixe de imagens.
- **Régua** (`R`): o clique fixa o início no centro do quadrado; novo clique ou `Esc` remove.
- **Ping**: Shift + clique. O mestre usa Ctrl + clique para centralizar a tela de todos.
- **Formas** (`S`): arraste; Shift força quadrado/círculo/45°; botão direito escolhe retângulo, elipse ou linha e o preenchimento.
- **Chat**: Enter envia; `/r 2d6+3`, `/r d20+5 adv`; clique no dado rola 1d20 e o botão direito abre as opções (inclusive "Só o mestre vê"). Imagens e GIFs pelo botão, colando ou arrastando.
- **Conversa privada**: botão direito num membro → "Conversa privada". Nada fica guardado no servidor; fechar a aba apaga.
- **Mestre**: botão direito num membro → "Editar apelido e cor".
```

- [ ] **Step 4: Verificação final**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add e2e/table.spec.ts README.md
git commit -m "feat(m3): Task 13 — ponta a ponta do M3, README e verificação final" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
