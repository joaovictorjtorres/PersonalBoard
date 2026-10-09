# Mesa Virtual: seleção em área e alcance em todas as camadas (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Selecionar vários itens arrastando um retângulo ou um laço (cortando traços de caneta na borda), agir sobre a seleção (mover, apagar e, para o mestre, mudar de camada e de controle) por um lote atômico `batch`, e dar ao Selecionar e à borracha a opção "Todas as camadas".

**Architecture:** O `shared` ganha a geometria pura da seleção (`selection.ts`: item inteiro dentro de retângulo/laço, corte exato de traço) e a ação `batch` no protocolo (1..200 sub-ações `create | update | delete`, ids únicos). O `TableEngine` aplica o lote numa cópia de trabalho (`StagedObjects`) reaproveitando as mesmas regras de `create`/`change`; a primeira falha recusa tudo; o `TableDO` manda a cada pessoa um único `{ t: 'batch' }` filtrado. No navegador, o lote é otimista (estado anterior guardado para voltar tudo), o desfazer guarda o lote inverso; um módulo puro (`apps/web/src/selection/`) coleta a seleção e monta os lotes; a store guarda a seleção e as opções (`localStorage`); o canvas desenha a área, o realce, a caixa tracejada, move o grupo e abre o menu do grupo; os outros veem o contorno do arrasto por presença efêmera.

**Tech Stack:** TypeScript 7, pnpm, Zod 4, Cloudflare Workers + Durable Objects (SQLite), Vitest (shared/web 5.x; worker via `@cloudflare/vitest-pool-workers`), React 19, Konva 10 + react-konva 19, Zustand 5, nanoid, lucide-react 1.52 (`Lasso`, `SquareDashed` existem), Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-09-mesa-virtual-selecao-design.md`

**Ordem com o plano de turnos:** o plano de turnos (`docs/superpowers/specs/2026-10-09-mesa-virtual-turnos-design.md`) roda ANTES deste no mesmo branch e acrescenta ops `turns*` ao `OpSchema`, casos no `switch` do `execute` do engine, casos em `applyOptimistic`/`reduceServer`, campos no `TableState`, um botão "Turnos" na `Toolbar` e um item no `ObjectContextMenu`. Este plano se refere a trechos por símbolo (função, `case`, componente), nunca por número de linha: insira cada trecho no lugar descrito, ao lado do que o plano de turnos tiver acrescentado. Ao listar campos novos em `TableState`/`makeInitialState`, ponha-os no fim, depois dos de turnos.

**Decisões tomadas onde o spec é omisso (o executor não deve rediscutir):**
- **Coerência do lote:** qualquer id que apareça duas vezes no lote (como alvo de `create`, `update` ou `delete`) torna o lote `invalid`, tanto no schema (o DO responde `reject invalid`) quanto no engine. "Criar um id que já existe" dentro do lote cai nessa regra; um `create` de id que já existe **na mesa** continua com o motivo atual, `exists`.
- **Recusa de lote não traz `current`:** o cliente volta todos os objetos do lote para o estado de antes do envio. O `ack` de lote tem `version: 0`.
- **Pedaços de um traço cortado:** todos os pedaços de dentro viram **um** traço novo (vários segmentos) e todos os de fora viram **outro**, com o `zIndex` do original. O título fica no pedaço de fora (o que não sai do lugar); o de dentro fica sem título. Anotação do mestre de um traço cortado se perde (o original é apagado). O servidor torna quem age dono e controlador dos pedaços; quando quem age é o mestre e o original tinha outro controle, um **segundo lote** devolve o `control` original aos pedaços (o `ownerId` fica sendo o do mestre). O mesmo vale para o desfazer (já é assim hoje com `inverseGroupOf`).
- **Traço todo dentro da área** não é cortado: entra como item inteiro e se move por `update` de posição.
- **Depois de mover**, a seleção passa a ser os itens movidos (inteiros: o pedaço de dentro e os itens), para poder arrastar de novo. Depois de apagar ou mudar de camada, a seleção é desfeita. Mudar permissões mantém a seleção.
- **A caixa tracejada é a seleção:** botão esquerdo dentro dela (folga de 6 px de tela) começa o arrasto do grupo; clique dentro sem arrastar mantém a seleção; botão direito dentro abre o menu do grupo; clique fora desfaz.
- **Limiar de clique/arrasto:** 3 px de tela, o mesmo `MIN_EXTENT_PX` da ferramenta Formas (é o único limiar existente no código).
- **Shift com o Selecionar:** o ping do Shift + clique sai **ao soltar**, se o mouse não andou; Shift + arrastar soma área (sem seleção ativa, vira uma seleção nova). Ctrl/⌘ + clique continua pingando na hora (inclusive o recentralizar do mestre).
- **Travas:** o arrasto em grupo não pega travas (`grab`). Itens travados por outra pessoa no momento da seleção ficam de fora; se alguém pegar um item depois, o servidor recusa o lote (`locked`) e a tela volta.
- Ligar/desligar "Todas as camadas" no Selecionar desfaz a seleção.
- **Mover para camada** (grupo) lista todas as camadas; itens que já estão na camada de destino são pulados.
- **Controle e permissões** (grupo) vale para as imagens (tokens) inteiras da seleção; o campo mostra o controle do primeiro token.
- **Borracha "Todas as camadas":** não fica no `localStorage` (como o "De todos" do mestre); os cortes vão em lotes de até 200 sub-ações, todos num só passo de desfazer. A borracha só na camada ativa continua como hoje (`submitGroup`).
- **Contorno do arrasto para os outros:** presença `groupDrag { x, y, width, height, layerIds }` (caixa já deslocada) a cada ~33 ms e `groupDragEnd`; o DO só repassa `groupDrag` a quem enxerga **todas** as camadas dos itens; no máximo 40/s por pessoa.
- **Avisos:** "Não foi possível mover a seleção" (mover e mudar de camada), "Não foi possível apagar a seleção", "Não foi possível mudar as permissões", "Seleção grande demais; selecione menos itens"; borracha em lote recusada: "Não foi possível apagar"; desfazer recusado: "Não foi possível desfazer" (como hoje).
- **Item da seleção mudado por outra pessoa** (apagado, outra posição, tamanho, rotação, camada ou desenho) sai da seleção; mensagens que não mudam a forma (ex.: `ack`, eco igual ao que eu já tinha) não tiram.

## Global Constraints

- Texto de interface em português (pt-BR); identificadores em inglês.
- Nenhum travessão (— ou –) em texto visível ao usuário.
- Nenhum diálogo nativo do navegador (`alert`/`confirm`/`prompt`); confirmações usam `askConfirm` do app.
- Uma task = exatamente um commit, assunto `feat(selecao): <título curto>`, com o trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (use `git commit -m "<assunto>" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`). Nunca `--amend`, nunca `git push`.
- Ao fim de cada task, na raiz: `pnpm typecheck`, `pnpm test` e `pnpm e2e` verdes.
- E2E só na porta **8788** (o `playwright.config.ts` já sobe o próprio wrangler lá). Não rode `pnpm build`, `pnpm host`, `pnpm dev:*`, não mate nem reaproveite servidores na 8787 ou qualquer servidor de dev já rodando.
- Não adicione dependências nem troque versões.
- Valores do spec: lote `{ kind: 'batch', ops: Array<create | update | delete> }` com **1..200** itens (`BATCH_MAX = 200`); opções do Selecionar no `localStorage` por pessoa: **Forma da seleção: Retângulo | Laço** e **Todas as camadas**; laço com menos de 3 pontos é ignorado; laço que se cruza usa a regra **par/ímpar**; imagens/tokens e formas entram só **inteiros** (caixa girada); traços entram pelas **partes de dentro**, cortadas exatamente na borda; o corte só acontece ao agir; a borracha continua usando `eraseSegments`.

## Review Focus

1. **Soltar o grupo no mesmo lugar** (o mouse volta ao ponto de partida): nada é enviado e a seleção continua como estava → teste na Task 4 (`selection-store.test.ts`).
2. **Item da seleção apagado por outra pessoa no meio do arrasto do grupo:** ele sai da seleção na hora e soltar move só o resto, sem lote recusado → teste na Task 4.
3. **Traço em zigue-zague cortado em centenas de pedaços:** os traços novos respeitam `MAX_SEGMENTS`/`MAX_SEGMENT_NUMBERS`, para o lote nunca virar `invalid` → teste na Task 3 (`selection-plan.test.ts`).
4. **Ctrl+Z de um lote cujo item outra pessoa apagou:** o servidor recusa o desfazer inteiro; a tela volta ao estado de antes do desfazer e aparece "Não foi possível desfazer" → teste na Task 2 (`reducers-batch.test.ts`).
5. **Reconexão com um lote ainda sem resposta:** o snapshot chega, o lote pendente é reaplicado por cima (sem duplicar pedaços) e reenviado; o servidor não reaplica (mesmo `opId`) → teste na Task 2.

---

## Mapa de arquivos

```
packages/shared/src/
  selection.ts     # NOVO (T1): RotatedBox, StrokeSplit, rectPolygon, rectFromPoints, boxCorners, pointInPolygon,
                   #            insideRect, insidePolygon, splitStrokeByPolygon, splitStrokeByRect
  constants.ts     # T2: BATCH_MAX
  protocol.ts      # T2: ObjectOpSchema, BatchOpSchema, batchTargetsUnique, ServerMessage 'batch'; T6: presença groupDrag/groupDragEnd
  index.ts         # T1: export * from './selection'
packages/shared/test/selection.test.ts (NOVO, T1); protocol.test.ts (T2, T6)

apps/worker/src/engine/
  staged.ts        # NOVO (T2): ObjectTx, StagedObjects
  engine.ts        # T2: ObjectChange, efeito 'objects', create/change com tx, batch
apps/worker/src/table-do.ts  # T2: visibleChange + case 'objects'; T6: presença groupDrag
apps/worker/test/engine.test.ts, table-do.test.ts (T2, T6)

apps/web/src/
  store/localOps.ts    # T2: objectOpsOf
  store/undo.ts        # T2: batchInverse
  store/state.ts       # T2: LocalPrev 'batch', PendingOp.failText; T4: seleção e opções, NO_SELECTION; T6: groupDrags; T7: eraseAllLayers
  store/reducers.ts    # T2: lote otimista/ack/recusa/mensagem 'batch'; T4: seleção desfeita; T6: groupDrags
  store/tableStore.ts  # T2: submitBatches; T4: ações da seleção; T6: presença do arrasto; T7: setEraseAllLayers
  selection/model.ts   # NOVO (T3): tipos, collectSelection, addArea, dropFromSelection, selectionOfIds, pointInBox; T6: selectionLayerIds
  selection/plan.ts    # NOVO (T3): planMove, planDelete, planToLayer, planControl
  selection/reconcile.ts # NOVO (T4): reconcileSelection
  lib/selectPrefs.ts   # NOVO (T3): loadSelectPrefs, saveSelectPrefs
  canvas/useSelectTool.ts  # NOVO (T5)
  canvas/SelectionLayer.tsx # NOVO (T5)
  canvas/TableCanvas.tsx, ImageNode.tsx, ShapeNode.tsx, StrokeNode.tsx, ObjectDecorations.tsx (T5)
  canvas/Overlay.tsx   # T6
  canvas/eraser.ts, useDrawingTools.ts # T7
  ui/SelectPopover.tsx # NOVO (T4)
  ui/SelectionContextMenu.tsx # NOVO (T5)
  ui/Toolbar.tsx (T4), ui/useKeyboard.ts (T4), ui/ObjectContextMenu.tsx (T5), ui/TablePage.tsx (T5), ui/PenPopover.tsx (T7)
apps/web/test/ reducers-batch.test.ts, batch-actions.test.ts (T2); selection-model.test.ts, selection-plan.test.ts,
               select-prefs.test.ts (T3); selection-store.test.ts (T4, T6); group-drag.test.ts (T6); eraser.test.ts (T7)
e2e/table.spec.ts (T5, T6, T7)
```

---

### Task 1: Geometria da seleção (shared)

**Files:**
- Create: `packages/shared/src/selection.ts`
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/selection.test.ts`

**Interfaces:**
- Consumes: `Box`, `Point` de `packages/shared/src/grid.ts`.
- Produces (exportado de `@mesa/shared`):
  - `interface RotatedBox extends Box { rotation: number }` (graus, girando em torno de `(x, y)` como o Konva)
  - `interface StrokeSplit { inside: number[][]; outside: number[][] }`
  - `rectPolygon(r: Box): number[]`, `rectFromPoints(a: Point, b: Point): Box`, `boxCorners(b: RotatedBox): number[]`
  - `pointInPolygon(x: number, y: number, polygon: number[]): boolean` (par/ímpar; polígono plano `[x0, y0, ...]`)
  - `insideRect(item: RotatedBox, rect: Box): boolean`, `insidePolygon(item: RotatedBox, polygon: number[]): boolean`
  - `splitStrokeByPolygon(points: number[], polygon: number[]): StrokeSplit`, `splitStrokeByRect(points: number[], rect: Box): StrokeSplit` (pontos planos no mesmo referencial da área)

- [ ] **Step 1: Escrever o teste que falha**

Crie `packages/shared/test/selection.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  boxCorners,
  insidePolygon,
  insideRect,
  pointInPolygon,
  rectFromPoints,
  rectPolygon,
  splitStrokeByPolygon,
  splitStrokeByRect,
} from '../src'

// Laço que se cruza (gravata): triângulos da esquerda e da direita ficam dentro; os de cima e de baixo, fora.
const BOWTIE = [0, 0, 10, 10, 10, 0, 0, 10]
// "U" com o vão entre x 40..60, de y 40 até embaixo.
const U = [0, 0, 100, 0, 100, 100, 60, 100, 60, 40, 40, 40, 40, 100, 0, 100]

describe('pointInPolygon', () => {
  it('quadrado: dentro e fora', () => {
    const sq = rectPolygon({ x: 0, y: 0, width: 10, height: 10 })
    expect(pointInPolygon(5, 5, sq)).toBe(true)
    expect(pointInPolygon(15, 5, sq)).toBe(false)
  })

  it('laço que se cruza usa par/ímpar', () => {
    expect(pointInPolygon(1, 5, BOWTIE)).toBe(true)
    expect(pointInPolygon(9, 5, BOWTIE)).toBe(true)
    expect(pointInPolygon(5, 1, BOWTIE)).toBe(false)
    expect(pointInPolygon(5, 9, BOWTIE)).toBe(false)
  })

  it('menos de 3 pontos não contém nada', () => {
    expect(pointInPolygon(0, 0, [0, 0, 10, 10])).toBe(false)
  })
})

describe('rectFromPoints e boxCorners', () => {
  it('retângulo em qualquer direção do arrasto', () => {
    expect(rectFromPoints({ x: 10, y: 20 }, { x: 0, y: 5 })).toEqual({ x: 0, y: 5, width: 10, height: 15 })
  })

  it('cantos giram em torno de (x, y)', () => {
    const c = boxCorners({ x: 10, y: 10, width: 20, height: 10, rotation: 90 })
    expect(c.map((v) => Math.round(v))).toEqual([10, 10, 10, 30, 0, 30, 0, 10])
  })
})

describe('insideRect', () => {
  const area = { x: 0, y: 0, width: 100, height: 100 }

  it('inteiro dentro entra; pela metade, não', () => {
    expect(insideRect({ x: 10, y: 10, width: 20, height: 20, rotation: 0 }, area)).toBe(true)
    expect(insideRect({ x: 90, y: 10, width: 20, height: 20, rotation: 0 }, area)).toBe(false)
  })

  it('usa a caixa girada', () => {
    // girado 45°: cantos em x de 35,86 a 64,14
    const item = { x: 50, y: 0, width: 20, height: 20, rotation: 45 }
    expect(insideRect(item, { x: 30, y: 0, width: 40, height: 30 })).toBe(true)
    expect(insideRect(item, { x: 40, y: 0, width: 40, height: 30 })).toBe(false)
  })
})

describe('insidePolygon', () => {
  it('laço que cobre o item inteiro', () => {
    expect(insidePolygon({ x: 10, y: 10, width: 20, height: 20, rotation: 0 }, U)).toBe(true)
  })

  it('laço côncavo que entra na caixa sem cobrir um canto: fora', () => {
    // os 4 cantos caem nos braços do U, mas o meio da caixa fica no vão
    expect(insidePolygon({ x: 10, y: 50, width: 80, height: 20, rotation: 0 }, U)).toBe(false)
  })

  it('laço com menos de 3 pontos não pega nada', () => {
    expect(insidePolygon({ x: 1, y: 1, width: 1, height: 1, rotation: 0 }, [0, 0, 10, 10])).toBe(false)
  })
})

describe('splitStrokeByRect', () => {
  const rect = { x: 5, y: 0, width: 10, height: 10 }

  it('atravessando: corta exatamente na borda', () => {
    expect(splitStrokeByRect([0, 5, 20, 5], rect)).toEqual({
      inside: [[5, 5, 15, 5]],
      outside: [[0, 5, 5, 5], [15, 5, 20, 5]],
    })
  })

  it('todo dentro e todo fora', () => {
    expect(splitStrokeByRect([6, 5, 14, 5], rect)).toEqual({ inside: [[6, 5, 14, 5]], outside: [] })
    expect(splitStrokeByRect([0, 50, 20, 50], rect)).toEqual({ inside: [], outside: [[0, 50, 20, 50]] })
  })

  it('linha com vários pontos sai pelo lado de baixo', () => {
    expect(splitStrokeByRect([0, 5, 10, 5, 10, 15], rect)).toEqual({
      inside: [[5, 5, 10, 5, 10, 10]],
      outside: [[0, 5, 5, 5], [10, 10, 10, 15]],
    })
  })
})

describe('splitStrokeByPolygon', () => {
  it('laço que se cruza: dentro nos dois triângulos laterais, fora no meio', () => {
    expect(splitStrokeByPolygon([1, 2, 9, 2], BOWTIE)).toEqual({
      inside: [[1, 2, 2, 2], [8, 2, 9, 2]],
      outside: [[2, 2, 8, 2]],
    })
  })

  it('laço com menos de 3 pontos: tudo fora', () => {
    expect(splitStrokeByPolygon([0, 0, 10, 0], [0, 0, 5, 5])).toEqual({ inside: [], outside: [[0, 0, 10, 0]] })
  })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `pnpm --filter @mesa/shared exec vitest run test/selection.test.ts`
Expected: FAIL (`boxCorners` e demais não são exportados de `../src`).

- [ ] **Step 3: Implementar**

Crie `packages/shared/src/selection.ts`:

```ts
import type { Box, Point } from './grid'

/** Caixa de um objeto; a rotação (graus) é em torno de (x, y), como no Konva. */
export interface RotatedBox extends Box {
  rotation: number
}

/** Pedaços de um traço (pontos planos [x0, y0, ...]) dentro e fora de uma área. */
export interface StrokeSplit {
  inside: number[][]
  outside: number[][]
}

/** Retângulo como polígono plano. */
export function rectPolygon(r: Box): number[] {
  return [r.x, r.y, r.x + r.width, r.y, r.x + r.width, r.y + r.height, r.x, r.y + r.height]
}

/** Retângulo do arrasto entre dois pontos, em qualquer direção. */
export function rectFromPoints(a: Point, b: Point): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) }
}

/** Os 4 cantos da caixa girada, planos e em ordem. */
export function boxCorners(b: RotatedBox): number[] {
  const r = (b.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const out: number[] = []
  const local: Array<[number, number]> = [[0, 0], [b.width, 0], [b.width, b.height], [0, b.height]]
  for (const [px, py] of local) out.push(b.x + px * cos - py * sin, b.y + px * sin + py * cos)
  return out
}

/** Regra par/ímpar (vale para laço que se cruza); menos de 3 pontos não contém nada. */
export function pointInPolygon(x: number, y: number, polygon: number[]): boolean {
  const n = polygon.length / 2
  if (n < 3) return false
  let inside = false
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = polygon[2 * i], yi = polygon[2 * i + 1]
    const xj = polygon[2 * j], yj = polygon[2 * j + 1]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Parâmetros t (0 < t < 1) em que o segmento a→b cruza alguma aresta do polígono fechado. */
function crossings(ax: number, ay: number, bx: number, by: number, polygon: number[]): number[] {
  const out: number[] = []
  const n = polygon.length / 2
  const dx = bx - ax
  const dy = by - ay
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    const cx = polygon[2 * i], cy = polygon[2 * i + 1]
    const ex = polygon[2 * j] - cx, ey = polygon[2 * j + 1] - cy
    const den = dx * ey - dy * ex
    if (den === 0) continue // paralelos
    const t = ((cx - ax) * ey - (cy - ay) * ex) / den
    const u = ((cx - ax) * dy - (cy - ay) * dx) / den
    if (t > 0 && t < 1 && u >= 0 && u <= 1) out.push(t)
  }
  return out
}

const inRect = (x: number, y: number, r: Box) => x >= r.x && x <= r.x + r.width && y >= r.y && y <= r.y + r.height

/** O item inteiro (caixa girada) dentro do retângulo; a borda conta como dentro. */
export function insideRect(item: RotatedBox, rect: Box): boolean {
  const c = boxCorners(item)
  for (let i = 0; i < c.length; i += 2) if (!inRect(c[i], c[i + 1], rect)) return false
  return true
}

/** O item inteiro (caixa girada) dentro do laço (par/ímpar). */
export function insidePolygon(item: RotatedBox, polygon: number[]): boolean {
  if (polygon.length < 6) return false
  const c = boxCorners(item)
  for (let i = 0; i < c.length; i += 2) if (!pointInPolygon(c[i], c[i + 1], polygon)) return false
  // Laço côncavo pode entrar na caixa sem cobrir um canto: nenhuma aresta da caixa pode cruzar o laço.
  for (let i = 0; i < 8; i += 2) {
    if (crossings(c[i], c[i + 1], c[(i + 2) % 8], c[(i + 3) % 8], polygon).length > 0) return false
  }
  return true
}

/**
 * Corta o traço (pontos planos) nas arestas do polígono, exatamente no ponto de cruzamento.
 * Cada trecho é classificado pelo seu ponto do meio (par/ímpar). Laço com menos de 3 pontos: tudo fora.
 */
export function splitStrokeByPolygon(points: number[], polygon: number[]): StrokeSplit {
  const n = points.length / 2
  if (polygon.length < 6 || n < 2) return { inside: [], outside: n >= 1 ? [points.slice()] : [] }
  const inside: number[][] = []
  const outside: number[][] = []
  let run: number[] = [points[0], points[1]]
  let runInside: boolean | null = null
  const close = () => {
    if (run.length >= 4 && runInside !== null) (runInside ? inside : outside).push(run)
  }
  for (let i = 0; i < n - 1; i++) {
    const ax = points[2 * i], ay = points[2 * i + 1]
    const bx = points[2 * i + 2], by = points[2 * i + 3]
    const cuts = [0, ...[...new Set(crossings(ax, ay, bx, by, polygon))].sort((p, q) => p - q), 1]
    for (let k = 0; k < cuts.length - 1; k++) {
      const t0 = cuts[k]
      const t1 = cuts[k + 1]
      const tm = (t0 + t1) / 2
      const piece = pointInPolygon(ax + (bx - ax) * tm, ay + (by - ay) * tm, polygon)
      if (runInside === null) runInside = piece
      if (piece !== runInside) {
        close()
        run = [ax + (bx - ax) * t0, ay + (by - ay) * t0]
        runInside = piece
      }
      if (t1 === 1) run.push(bx, by)
      else run.push(ax + (bx - ax) * t1, ay + (by - ay) * t1)
    }
  }
  close()
  return { inside, outside }
}

export function splitStrokeByRect(points: number[], rect: Box): StrokeSplit {
  return splitStrokeByPolygon(points, rectPolygon(rect))
}
```

Em `packages/shared/src/index.ts`, acrescente no fim:

```ts
export * from './selection'
```

- [ ] **Step 4: Rodar e ver passar**

Run: `pnpm --filter @mesa/shared exec vitest run test/selection.test.ts`
Expected: PASS (todos os testes de `selection.test.ts`).

- [ ] **Step 5: Verificar o repositório inteiro**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde (nada mais usa o módulo ainda).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/selection.ts packages/shared/src/index.ts packages/shared/test/selection.test.ts
git commit -m "feat(selecao): geometria da seleção (item inteiro na área e corte de traço na borda)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Lote atômico `batch` (protocolo, servidor e cliente)

Protocolo, engine, DO e o lado do navegador entram juntos: incluir `batch` no `OpSchema` quebra o `switch` exaustivo de `applyOptimistic` e o `reduceServer`, então o cliente precisa tratá-lo na mesma task para o `pnpm typecheck` ficar verde.

**Files:**
- Modify: `packages/shared/src/constants.ts`, `packages/shared/src/protocol.ts`
- Create: `apps/worker/src/engine/staged.ts`
- Modify: `apps/worker/src/engine/engine.ts`, `apps/worker/src/table-do.ts`
- Modify: `apps/web/src/store/localOps.ts`, `apps/web/src/store/undo.ts`, `apps/web/src/store/state.ts`, `apps/web/src/store/reducers.ts`, `apps/web/src/store/tableStore.ts`
- Test: `packages/shared/test/protocol.test.ts`, `apps/worker/test/engine.test.ts`, `apps/worker/test/table-do.test.ts`, `apps/web/test/reducers-batch.test.ts` (novo), `apps/web/test/batch-actions.test.ts` (novo)

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces:
  - shared: `BATCH_MAX = 200`; `ObjectOpSchema`; `type ObjectOp` (agora `z.infer<typeof ObjectOpSchema>`, mesmo formato de antes); `BatchOpSchema`; `type BatchOp = { kind: 'batch'; ops: ObjectOp[] }`; `batchTargetsUnique(ops: ObjectOp[]): boolean`; `ServerMessage` ganha `{ t: 'batch'; ops: AppliedOp[]; by: string }`.
  - worker: `interface ObjectTx { get(id): TableObject | null; put(o): void; remove(id): void }`, `class StagedObjects implements ObjectTx { commit(): void }`; `export interface ObjectChange { kind: 'object'; before; after; echo?: true }`; `OpEffect` ganha `{ kind: 'objects'; changes: ObjectChange[] }`.
  - web: `objectOpsOf(op: Op): ObjectOp[]` (localOps); `batchInverse(op: BatchOp, before: Record<string, TableObject | null>, role: Role | undefined): Op[] | null` (undo); `LocalPrev` ganha `{ kind: 'batch'; before: Record<string, TableObject | null> }`; `PendingOp.failText?: string`; `reduceSubmitBatch(s, items, { isUndo, groupId, failText? })`; ação `submitBatches(batches: ObjectOp[][], failText: string): boolean`; função interna `rejectBatch` em `reducers.ts` (a Task 4 acrescenta nela o "seleção desfeita").

- [ ] **Step 1: Testes do schema (falham)**

Em `packages/shared/test/protocol.test.ts`, acrescente `BATCH_MAX` ao import de `'../src'` e, no fim do arquivo:

```ts
describe('OpSchema batch', () => {
  const del = (id: string) => ({ kind: 'delete', id })
  const parse = (ops: unknown[]) => OpSchema.safeParse({ kind: 'batch', ops }).success

  it('aceita de 1 a 200 sub-ações de objeto (create, update, delete)', () => {
    expect(parse([{ kind: 'create', object: image }, { kind: 'update', id: 'x', patch: { x: 1 } }, del('y')])).toBe(true)
    expect(parse(Array.from({ length: BATCH_MAX }, (_, i) => del(`d${i}`)))).toBe(true)
  })

  it('recusa vazio, mais de 200, lote dentro de lote e ações que não são de objeto', () => {
    expect(parse([])).toBe(false)
    expect(parse(Array.from({ length: BATCH_MAX + 1 }, (_, i) => del(`d${i}`)))).toBe(false)
    expect(parse([{ kind: 'batch', ops: [del('a')] }])).toBe(false)
    expect(parse([{ kind: 'layerCreate', layer: { id: 'l1', name: 'Nova' } }])).toBe(false)
    expect(parse([{ kind: 'settingsUpdate', patch: {} }])).toBe(false)
  })

  it('recusa o mesmo id duas vezes (contraditório)', () => {
    expect(parse([del('a'), { kind: 'update', id: 'a', patch: { x: 1 } }])).toBe(false)
    expect(parse([{ kind: 'create', object: image }, { kind: 'create', object: image }])).toBe(false)
  })
})
```

Run: `pnpm --filter @mesa/shared exec vitest run test/protocol.test.ts`
Expected: FAIL (`BATCH_MAX` não existe; `batch` não está no `OpSchema`).

- [ ] **Step 2: Implementar o protocolo**

Em `packages/shared/src/constants.ts`, no fim:

```ts

// Seleção em área
/** Máximo de sub-ações num lote (`batch`). */
export const BATCH_MAX = 200
```

Em `packages/shared/src/protocol.ts`:
1. Acrescente `BATCH_MAX` ao import de `'./constants'`.
2. Logo antes de `export const OpSchema`, defina:

```ts
const CreateOpSchema = z.object({ kind: z.literal('create'), object: NewObjectSchema })
const UpdateOpSchema = z.object({ kind: z.literal('update'), id: IdSchema, patch: ObjectPatchSchema })
const DeleteOpSchema = z.object({ kind: z.literal('delete'), id: IdSchema })

export const ObjectOpSchema = z.discriminatedUnion('kind', [CreateOpSchema, UpdateOpSchema, DeleteOpSchema])
export type ObjectOp = z.infer<typeof ObjectOpSchema>

/** Cada id aparece uma vez só no lote: criar, mexer ou apagar o mesmo id duas vezes é contraditório. */
export function batchTargetsUnique(ops: ObjectOp[]): boolean {
  const seen = new Set<string>()
  for (const op of ops) {
    const id = op.kind === 'create' ? op.object.id : op.id
    if (seen.has(id)) return false
    seen.add(id)
  }
  return true
}

/** Lote atômico de ações de objeto: o servidor aplica tudo ou nada. */
export const BatchOpSchema = z
  .object({ kind: z.literal('batch'), ops: z.array(ObjectOpSchema).min(1).max(BATCH_MAX) })
  .refine((op) => batchTargetsUnique(op.ops), 'batch touches the same id twice')
export type BatchOp = z.infer<typeof BatchOpSchema>
```

3. No `OpSchema`, troque as três primeiras entradas (`create`, `update`, `delete` escritas inline) por `CreateOpSchema, UpdateOpSchema, DeleteOpSchema,` e acrescente `BatchOpSchema,` como último item da lista (depois de `ClearObjectsOpSchema` e de qualquer op de turnos).
4. Apague a linha antiga `export type ObjectOp = Extract<Op, { kind: 'create' | 'update' | 'delete' }>` (o tipo agora vem de `ObjectOpSchema`; `isObjectOp` continua igual).
5. Na união `ServerMessage`, logo depois de `| { t: 'op'; op: AppliedOp; by: string }`:

```ts
  /** Lote aplicado (batch), já filtrado pelo que quem recebe enxerga, num envio só. */
  | { t: 'batch'; ops: AppliedOp[]; by: string }
```

Run: `pnpm --filter @mesa/shared exec vitest run test/protocol.test.ts`
Expected: PASS.

- [ ] **Step 3: Testes do engine (falham)**

Em `apps/worker/test/engine.test.ts`, acrescente `type ObjectOp` ao import de `'@mesa/shared'` e `type OpEffect` ao import de `'../src/engine/engine'`. No fim do arquivo:

```ts
describe('applyOp batch', () => {
  const batch = (...ops: ObjectOp[]): Op => ({ kind: 'batch', ops })
  const strokeObj = (id: string): NewObject =>
    ({
      id, type: 'stroke', layerId: 'tokens', x: 0, y: 0, width: 10, height: 10, rotation: 0, zIndex: 1,
      segments: [[0, 0, 10, 10]], color: '#ffffff', strokeWidth: 2,
    }) as NewObject
  const changes = (r: OpResult) => (effects(r) as Array<Extract<OpEffect, { kind: 'objects' }>>)[0].changes

  beforeEach(() => {
    engine.applyOp('A', 'player', 'op0', create(token()))
  })

  it('aplica tudo de uma vez e devolve um efeito com as mudanças, na ordem', () => {
    const r = engine.applyOp('A', 'player', 'b1', batch(
      { kind: 'update', id: 'tok1', patch: { x: 50 } },
      { kind: 'create', object: token({ id: 'tok2' }) },
    ))
    expect(r).toMatchObject({ ok: true, duplicate: false, version: 0 })
    expect(effects(r)).toEqual([{
      kind: 'objects',
      changes: [
        { kind: 'object', before: expect.objectContaining({ x: 10 }), after: expect.objectContaining({ x: 50, version: 2 }) },
        { kind: 'object', before: null, after: expect.objectContaining({ id: 'tok2', ownerId: 'A' }) },
      ],
    }])
    expect(store.getObject('tok1')?.x).toBe(50)
    expect(store.getObject('tok2')).not.toBeNull()
  })

  it('uma sub-ação proibida recusa o lote inteiro com o motivo dela, sem current, e nada muda', () => {
    engine.applyOp('G', 'gm', 'g0', create(token({ id: 'gmtok' })))
    const r = engine.applyOp('A', 'player', 'b1', batch(
      { kind: 'create', object: token({ id: 'tok2' }) },
      { kind: 'update', id: 'tok1', patch: { x: 50 } },
      { kind: 'update', id: 'gmtok', patch: { x: 1 } },
    ))
    expect(r).toEqual({ ok: false, reason: 'forbidden' })
    expect(store.getObject('tok2')).toBeNull()
    expect(store.getObject('tok1')?.x).toBe(10)
  })

  it('ids repetidos no lote são contraditórios (invalid) e nada muda', () => {
    const cases: ObjectOp[][] = [
      [{ kind: 'delete', id: 'tok1' }, { kind: 'update', id: 'tok1', patch: { x: 1 } }],
      [{ kind: 'update', id: 'tok1', patch: { x: 1 } }, { kind: 'update', id: 'tok1', patch: { y: 1 } }],
      [{ kind: 'create', object: token({ id: 'n1' }) }, { kind: 'create', object: token({ id: 'n1' }) }],
    ]
    cases.forEach((ops, i) => expect(engine.applyOp('A', 'player', `b${i}`, batch(...ops))).toEqual({ ok: false, reason: 'invalid' }))
    expect(store.getObject('tok1')?.x).toBe(10)
    expect(store.getObject('n1')).toBeNull()
  })

  it('criar um id que já existe na mesa recusa com exists', () => {
    expect(engine.applyOp('A', 'player', 'b1', batch({ kind: 'create', object: token() }))).toEqual({ ok: false, reason: 'exists' })
  })

  it('objeto travado por outra pessoa recusa o lote (locked) e nada muda', () => {
    engine.applyOp('G', 'gm', 'g1', update('tok1', { control: ALL }))
    expect(engine.grab('B', 'player', 'tok1')).toBe(true)
    const r = engine.applyOp('A', 'player', 'b1', batch({ kind: 'create', object: token({ id: 'tok2' }) }, { kind: 'delete', id: 'tok1' }))
    expect(r).toEqual({ ok: false, reason: 'locked' })
    expect(store.getObject('tok1')).not.toBeNull()
    expect(store.getObject('tok2')).toBeNull()
  })

  it('apagar no lote leva anotação e trava junto; lote recusado mantém as duas', () => {
    engine.applyOp('G', 'gm', 'n1', { kind: 'noteSet', objectId: 'tok1', text: 'segredo' })
    engine.grab('A', 'player', 'tok1')
    const refused = batch({ kind: 'delete', id: 'tok1' }, { kind: 'create', object: token({ id: 'x', layerId: 'gm' }) })
    expect(engine.applyOp('A', 'player', 'b1', refused)).toEqual({ ok: false, reason: 'forbidden' })
    expect(store.listNotes()).toEqual({ tok1: 'segredo' })
    expect(engine.activeLocks()).toEqual([{ objectId: 'tok1', clientId: 'A' }])
    expect(engine.applyOp('A', 'player', 'b2', batch({ kind: 'delete', id: 'tok1' }))).toMatchObject({ ok: true })
    expect(store.listNotes()).toEqual({})
    expect(engine.activeLocks()).toEqual([])
  })

  it('jogador não muda camada dentro do lote', () => {
    expect(engine.applyOp('A', 'player', 'b1', batch({ kind: 'update', id: 'tok1', patch: { layerId: 'drawings' } }))).toEqual({ ok: false, reason: 'forbidden' })
  })

  it('opId repetido não reaplica', () => {
    const op = batch({ kind: 'update', id: 'tok1', patch: { x: 50 } })
    engine.applyOp('A', 'player', 'b1', op)
    expect(engine.applyOp('A', 'player', 'b1', op)).toEqual({ ok: true, duplicate: true, version: 0 })
  })

  it('encaixe na grade marca eco só na imagem encaixada', () => {
    engine.applyOp('G', 'gm', 's1', { kind: 'settingsUpdate', patch: { grid: { snap: true, size: 50 } } })
    const r = engine.applyOp('A', 'player', 'b1', batch(
      { kind: 'update', id: 'tok1', patch: { x: 61, y: 20 } },
      { kind: 'create', object: strokeObj('s1') },
    ))
    const [img, line] = changes(r)
    expect(img).toMatchObject({ echo: true, after: { x: 50, y: 0 } })
    expect(line.echo).toBeUndefined()
  })
})
```

Run: `pnpm --filter @mesa/worker test`
Expected: FAIL nos testes novos de `applyOp batch` (o engine ainda não conhece `batch`); os antigos passam.

- [ ] **Step 4: Implementar a cópia de trabalho e o lote no engine**

Crie `apps/worker/src/engine/staged.ts`:

```ts
import type { TableObject } from '@mesa/shared'

/** Onde create/update/delete leem e gravam objetos. */
export interface ObjectTx {
  get(id: string): TableObject | null
  put(object: TableObject): void
  /** Apaga o objeto e o que depende dele (anotação, trava). */
  remove(id: string): void
}

/** Cópia de trabalho de um lote: nada chega ao store até `commit()`. */
export class StagedObjects implements ObjectTx {
  private changes = new Map<string, TableObject | null>()

  constructor(private base: ObjectTx) {}

  get(id: string): TableObject | null {
    return this.changes.has(id) ? (this.changes.get(id) ?? null) : this.base.get(id)
  }

  put(object: TableObject): void {
    this.changes.set(object.id, object)
  }

  remove(id: string): void {
    this.changes.set(id, null)
  }

  /** Grava tudo de uma vez (escritas síncronas no mesmo evento do DO: atômicas). */
  commit(): void {
    for (const [id, object] of this.changes) {
      if (object) this.base.put(object)
      else this.base.remove(id)
    }
    this.changes.clear()
  }
}
```

Em `apps/worker/src/engine/engine.ts`:
1. Acrescente `batchTargetsUnique` e `type BatchOp` ao import de `'@mesa/shared'`; acrescente `import { StagedObjects, type ObjectTx } from './staged'`.
2. Troque o primeiro membro de `OpEffect` pelo tipo nomeado e acrescente o efeito de lote:

```ts
/** `echo`: o servidor alterou o objeto (encaixe na grade); o autor também precisa recebê-lo. */
export interface ObjectChange {
  kind: 'object'
  before: TableObject | null
  after: TableObject | null
  echo?: true
}

/** O que mudou; o TableDO decide quem recebe o quê. */
export type OpEffect =
  | ObjectChange
  // ... (demais membros como estão)
  /** Lote (batch): as mudanças na ordem do lote; cada pessoa recebe num envio só o que enxerga. */
  | { kind: 'objects'; changes: ObjectChange[] }
```

3. Na classe `TableEngine`, logo depois do campo `locks`:

```ts
  /** Escrita direta no store; apagar leva junto a anotação e a trava. */
  private readonly direct: ObjectTx = {
    get: (id) => this.store.getObject(id),
    put: (object) => this.store.putObject(object),
    remove: (id) => {
      this.store.deleteObject(id)
      this.store.deleteNote(id)
      this.locks.delete(id)
    },
  }
```

4. Em `execute`, logo depois da linha `if (op.kind === 'clearObjects') ...`:

```ts
    if (op.kind === 'batch') return this.batch(clientId, role, op)
```

5. `create` e `change` passam a receber o `tx` (último parâmetro, padrão `this.direct`) e usá-lo no lugar do store:

```ts
  private create(clientId: string, role: Role, object: NewObject, tx: ObjectTx = this.direct): OpResult {
    if (!this.canEditLayer(role, object.layerId)) return reject('forbidden', null)
    const existing = tx.get(object.id)
    // ... (igual até montar `after`)
    tx.put(after)
    return done(1, { kind: 'object', before: null, after, ...(snap ? { echo: true as const } : {}) })
  }

  private change(clientId: string, role: Role, op: Extract<Op, { kind: 'update' | 'delete' }>, tx: ObjectTx = this.direct): OpResult {
    const before = tx.get(op.id)
    // ... (mesmas checagens)
    if (op.kind === 'delete') {
      tx.remove(op.id)
      return done(0, { kind: 'object', before, after: null })
    }
    // ... (igual até o safeParse)
    tx.put(parsed.data)
    return done(parsed.data.version, { kind: 'object', before, after: parsed.data, ...(snap ? { echo: true as const } : {}) })
  }
```

6. Depois de `clearObjects`, o método novo:

```ts
  /**
   * Lote atômico: cada sub-ação passa pelas regras de create/update/delete numa cópia de trabalho;
   * a primeira falha recusa tudo (nada muda). Id repetido no lote é contraditório → invalid.
   */
  private batch(clientId: string, role: Role, op: BatchOp): OpResult {
    if (!batchTargetsUnique(op.ops)) return rejectInvalid()
    const tx = new StagedObjects(this.direct)
    const changes: ObjectChange[] = []
    for (const sub of op.ops) {
      const r = sub.kind === 'create' ? this.create(clientId, role, sub.object, tx) : this.change(clientId, role, sub, tx)
      // `current` fala de um objeto só; o cliente volta o lote inteiro para o estado de antes.
      if (!r.ok) return { ok: false, reason: r.reason }
      if (!r.duplicate) for (const e of r.effects) if (e.kind === 'object') changes.push(e)
    }
    tx.commit()
    return done(0, { kind: 'objects', changes })
  }
```

Run: `pnpm --filter @mesa/worker test`
Expected: os testes do engine passam (inclusive os antigos de create/update/delete e travas); os novos do DO ainda não existem.

- [ ] **Step 5: Testes do DO (falham)**

No fim de `apps/worker/test/table-do.test.ts`:

```ts
describe('TableDO — lote (batch)', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })

  it('autor recebe ack; cada um recebe um envio só, com o que enxerga', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    const pub = tokenObject()
    const secret = tokenObject({ layerId: 'gm' })
    gm.send(op('b1', { kind: 'batch', ops: [{ kind: 'create', object: pub }, { kind: 'create', object: secret }] }))
    expect(await gm.waitFor('ack')).toEqual({ t: 'ack', opId: 'b1', version: 0 })
    const got = await p.waitFor('batch')
    expect(got.ops).toEqual([{ kind: 'upsert', object: expect.objectContaining({ id: pub.id }) }])
    await gm.expectNone('batch')
    await p.expectNone('op')
  })

  it('lote recusado não chega a ninguém', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    p.send(op('b1', { kind: 'batch', ops: [{ kind: 'create', object: tokenObject() }, { kind: 'create', object: tokenObject({ layerId: 'gm' }) }] }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'b1', reason: 'forbidden' })
    await gm.expectNone('batch')
    const { welcome } = await (await TestClient.connect(tableId)).hello('Bia')
    expect(welcome.snapshot.objects).toEqual([])
  })

  it('mais de 200 sub-ações ou ação que não é de objeto: reject invalid', async () => {
    const { tableId } = await createTable()
    const p = await TestClient.connect(tableId)
    await p.hello('Ana')
    const many = Array.from({ length: 201 }, (_, i) => ({ kind: 'delete', id: `d${i}` }))
    p.send(JSON.stringify({ t: 'op', opId: 'b1', op: { kind: 'batch', ops: many } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'b1', reason: 'invalid' })
    p.send(JSON.stringify({ t: 'op', opId: 'b2', op: { kind: 'batch', ops: [{ kind: 'layerCreate', layer: { id: 'l1', name: 'X' } }] } }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'b2', reason: 'invalid' })
  })

  it('encaixe: o autor recebe no lote só o que o servidor encaixou', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    gm.send(op('s1', { kind: 'settingsUpdate', patch: { grid: { snap: true } } }))
    await p.waitFor('settingsUpdated')
    const tok = tokenObject({ x: 0, y: 0 })
    p.send(op('c1', { kind: 'create', object: tok }))
    await p.waitFor('ack')
    p.send(op('b1', { kind: 'batch', ops: [{ kind: 'update', id: tok.id, patch: { x: 61 } }] }))
    expect((await p.waitFor('batch')).ops).toEqual([{ kind: 'upsert', object: expect.objectContaining({ id: tok.id, x: 70 }) }])
  })
})
```

Run: `pnpm --filter @mesa/worker test`
Expected: FAIL nos testes novos de `TableDO — lote (batch)` (`timeout esperando batch`: o DO ainda não trata o efeito `objects`).

- [ ] **Step 6: Implementar o repasse no DO**

Em `apps/worker/src/table-do.ts`, acrescente `type AppliedOp` ao import de `'@mesa/shared'`. Em `broadcastEffect`, troque o `case 'object'` e acrescente o `case 'objects'`:

```ts
      case 'object': {
        const { before, after } = effect
        // Com `echo` (encaixe na grade) o autor também recebe: o `ack` não traz a posição corrigida.
        this.broadcast(effect.echo ? null : author.sessionId, (other) => {
          const op = this.visibleChange(other, before, after)
          return op ? { t: 'op', by: author.clientId, op } : null
        })
        return
      }
      case 'objects': {
        // Um envio por pessoa com o que ela enxerga. A sessão do autor só recebe o que o servidor mudou (encaixe).
        this.broadcast(null, (other) => {
          const own = other.sessionId === author.sessionId
          const ops: AppliedOp[] = []
          for (const c of effect.changes) {
            if (own && !c.echo) continue
            const op = this.visibleChange(other, c.before, c.after)
            if (op) ops.push(op)
          }
          return ops.length > 0 ? { t: 'batch', ops, by: author.clientId } : null
        })
        return
      }
```

E um método privado novo, perto de `broadcastReleased`:

```ts
  /** Como `other` vê a mudança: upsert se enxerga o depois, delete se só enxergava o antes. */
  private visibleChange(other: Attachment, before: TableObject | null, after: TableObject | null): AppliedOp | null {
    if (after && this.engine.canSeeObject(other.role, after)) return { kind: 'upsert', object: after }
    if (before && this.engine.canSeeObject(other.role, before)) return { kind: 'delete', id: before.id }
    return null
  }
```

Run: `pnpm --filter @mesa/worker test`
Expected: PASS.

- [ ] **Step 7: Testes do cliente (falham)**

Crie `apps/web/test/reducers-batch.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ObjectOp, type TableObject } from '@mesa/shared'
import { reduceServer, reduceSubmit, reduceSubmitBatch } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const gm: Member = { ...me, clientId: 'gm1', nickname: 'Mestre', role: 'gm' }
const server = (owner: string) => ({ ownerId: owner, version: 1, updatedBy: owner, control: { mode: 'list' as const, clientIds: [owner] } })
const stroke = (id: string, owner = 'me'): TableObject =>
  ({
    id, type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 0, rotation: 0, zIndex: 1,
    segments: [[0, 0, 10, 0]], color: '#ffffff', strokeWidth: 3, ...server(owner),
  }) as TableObject
const image = (id: string, owner = 'me'): TableObject =>
  ({
    id, type: 'image', layerId: 'drawings', assetKey: 'a'.repeat(64), x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 2,
    ...server(owner),
  }) as TableObject
const piece = (id: string, x: number) => ({
  id, type: 'stroke' as const, layerId: 'drawings', x, y: 0, width: 5, height: 0, rotation: 0, zIndex: 1,
  segments: [[0, 0, 5, 0]], color: '#ffffff', strokeWidth: 3,
})

const snapshot = (objects: TableObject[], self: Member) => ({
  meta: { id: 'T', name: 'M' }, members: [self], layers: DEFAULT_LAYERS, objects, locks: [], notes: { a: 'nota' },
  settings: DEFAULT_SETTINGS, chat: [],
})
const joined = (self: Member = me, objects: TableObject[] = [stroke('a'), image('img')]): TableState =>
  reduceServer(makeInitialState(), { t: 'welcome', self, snapshot: snapshot(objects, self) }, 0)

const CUT: ObjectOp[] = [
  { kind: 'delete', id: 'a' },
  { kind: 'create', object: piece('p1', 0) },
  { kind: 'create', object: piece('p2', 20) },
  { kind: 'update', id: 'img', patch: { x: 30 } },
]
const submit = (s: TableState, ops: ObjectOp[] = CUT) =>
  reduceSubmitBatch(s, [{ opId: 'b1', op: { kind: 'batch', ops } }], { isUndo: false, groupId: 'g1', failText: 'Não foi possível mover a seleção' })
const keys = (s: TableState) => Object.keys(s.objects).sort()

describe('lote no cliente', () => {
  it('aplica na hora; o ack tira a anotação do apagado e empilha o lote inverso em ordem reversa', () => {
    let s = submit(joined())
    expect(keys(s)).toEqual(['img', 'p1', 'p2'])
    expect(s.objects.img.x).toBe(30)
    s = reduceServer(s, { t: 'ack', opId: 'b1', version: 0 }, 0)
    expect(s.pending).toEqual({})
    expect(s.notes).toEqual({})
    expect(s.undoStack).toEqual([[{
      kind: 'batch',
      ops: [
        { kind: 'update', id: 'img', patch: { x: 0 } },
        { kind: 'delete', id: 'p2' },
        { kind: 'delete', id: 'p1' },
        {
          kind: 'create',
          object: {
            id: 'a', type: 'stroke', layerId: 'drawings', x: 0, y: 0, width: 10, height: 0, rotation: 0, zIndex: 1,
            segments: [[0, 0, 10, 0]], color: '#ffffff', strokeWidth: 3,
          },
        },
      ],
    }]])
  })

  it('mestre: o desfazer devolve o controle do original num segundo lote', () => {
    let s = submit(joined(gm, [stroke('a', 'p1'), image('img', 'p1')]))
    s = reduceServer(s, { t: 'ack', opId: 'b1', version: 0 }, 0)
    const [group] = s.undoStack
    expect(group).toHaveLength(2)
    expect(group[1]).toEqual({ kind: 'batch', ops: [{ kind: 'update', id: 'a', patch: { control: { mode: 'list', clientIds: ['p1'] } } }] })
  })

  it('recusa: tudo volta, outras ops pendentes ficam por cima, aviso do lote e nenhum desfazer', () => {
    let s = reduceSubmit(joined(), 'u1', { kind: 'update', id: 'img', patch: { y: 9 } }, { isUndo: false })
    s = submit(s)
    s = reduceServer(s, { t: 'reject', opId: 'b1', reason: 'locked' }, 0)
    expect(keys(s)).toEqual(['a', 'img'])
    expect(s.objects.img).toMatchObject({ x: 0, y: 9 })
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível mover a seleção')
    expect(s.undoStack).toEqual([])
  })

  it('desfazer em lote recusado (item apagado por outra pessoa): tudo volta e avisa', () => {
    let s = reduceSubmitBatch(joined(), [{ opId: 'u1', op: { kind: 'batch', ops: CUT } }], { isUndo: true, groupId: 'g' })
    s = reduceServer(s, { t: 'reject', opId: 'u1', reason: 'not_found' }, 0)
    expect(keys(s)).toEqual(['a', 'img'])
    expect(s.objects.img.x).toBe(0)
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível desfazer')
  })

  it('lote de outra pessoa: upserts e deletes; o apagado leva anotação, trava e seleção', () => {
    let s: TableState = { ...joined(), selectedId: 'a' }
    s = reduceServer(s, { t: 'grabbed', objectId: 'a', clientId: 'bia' }, 0)
    s = reduceServer(s, { t: 'batch', by: 'bia', ops: [{ kind: 'delete', id: 'a' }, { kind: 'upsert', object: { ...image('img'), x: 99 } }] }, 0)
    expect(s.objects.a).toBeUndefined()
    expect(s.objects.img.x).toBe(99)
    expect(s.notes).toEqual({})
    expect(s.locks).toEqual({})
    expect(s.selectedId).toBeNull()
  })

  it('reconexão com lote pendente: o snapshot recebe o lote por cima, sem duplicar', () => {
    let s = submit(joined())
    s = reduceServer(s, { t: 'welcome', self: me, snapshot: snapshot([stroke('a'), image('img')], me) }, 0)
    expect(keys(s)).toEqual(['img', 'p1', 'p2'])
    expect(s.objects.img.x).toBe(30)
    expect(Object.keys(s.pending)).toEqual(['b1'])
  })
})
```

Crie `apps/web/test/batch-actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BATCH_MAX, DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ObjectOp, type ServerMessage } from '@mesa/shared'
import type { WebSocketLike } from '../src/sync/SyncClient'
import { createTableStore } from '../src/store/tableStore'

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = []
  sent: any[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) { this.sent.push(data === 'ping' ? 'ping' : JSON.parse(data)) }
  close() { this.onclose?.({ code: 1000 }) }
  receive(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const opsSent = () => FakeSocket.all[0].sent.filter((m) => typeof m === 'object' && m.t === 'op')

function connected() {
  const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
  store.getState().actions.connect('Eu')
  FakeSocket.all[0].onopen?.({})
  FakeSocket.all[0].receive({
    t: 'welcome', self: me,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  })
  return store
}

beforeEach(() => {
  FakeSocket.all = []
  const mem = new Map<string, string>()
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

const del = (n: number): ObjectOp[] => Array.from({ length: n }, (_, i) => ({ kind: 'delete', id: `d${i}` }))

describe('submitBatches', () => {
  it('envia um op batch por lote, sem lotes vazios', () => {
    const store = connected()
    expect(store.getState().actions.submitBatches([del(2), [], del(1)], 'Falhou')).toBe(true)
    expect(opsSent().map((m) => [m.op.kind, m.op.ops.length])).toEqual([['batch', 2], ['batch', 1]])
  })

  it('lote com mais de 200 sub-ações é recusado no navegador com aviso, sem enviar', () => {
    const store = connected()
    expect(store.getState().actions.submitBatches([del(BATCH_MAX + 1)], 'Falhou')).toBe(false)
    expect(opsSent()).toEqual([])
    expect(store.getState().toasts.at(-1)?.text).toBe('Seleção grande demais; selecione menos itens')
  })
})
```

Run: `pnpm --filter @mesa/web exec vitest run test/reducers-batch.test.ts test/batch-actions.test.ts`
Expected: FAIL (typecheck do vitest passa por esbuild; os testes falham em `submitBatches is not a function` e nos estados esperados).

- [ ] **Step 8: Implementar o lote no cliente**

Em `apps/web/src/store/localOps.ts`, acrescente `isObjectOp` ao import e:

```ts
/** Ops de objeto que `op` aplica localmente: ela mesma, ou as sub-ações de um lote, em ordem. */
export function objectOpsOf(op: Op): ObjectOp[] {
  if (isObjectOp(op)) return [op]
  return op.kind === 'batch' ? op.ops : []
}
```

Em `apps/web/src/store/undo.ts`, acrescente `type BatchOp`, `type ObjectOp` ao import de `'@mesa/shared'`, `import { opTargetId } from './localOps'` e:

```ts
/**
 * Lote que desfaz um lote: as inversas de cada sub-ação em ordem reversa. Quando o mestre recria
 * objetos apagados, os updates de controle vão num segundo lote (no mesmo lote seriam id repetido).
 */
export function batchInverse(op: BatchOp, before: Record<string, TableObject | null>, role: Role | undefined): Op[] | null {
  const main: ObjectOp[] = []
  const follow: ObjectOp[] = []
  for (const sub of [...op.ops].reverse()) {
    const group = inverseGroupOf(sub, before[opTargetId(sub)] ?? null, role)
    if (!group) continue
    const [inverse, ...rest] = group as ObjectOp[]
    main.push(inverse)
    follow.push(...rest)
  }
  if (main.length === 0) return null
  const out: Op[] = [{ kind: 'batch', ops: main }]
  if (follow.length > 0) out.push({ kind: 'batch', ops: follow })
  return out
}
```

Em `apps/web/src/store/state.ts`:
- No union `LocalPrev`, acrescente:

```ts
  /** Lote: cada objeto antes do lote (null = não existia), para voltar tudo se for recusado. */
  | { kind: 'batch'; before: Record<string, TableObject | null> }
```

- Em `PendingOp`, acrescente:

```ts
  /** Aviso se o servidor recusar (lotes da seleção e da borracha); senão o texto padrão do motivo. */
  failText?: string
```

Em `apps/web/src/store/reducers.ts`:
1. Imports: acrescente `type AppliedOp` ao import de `'@mesa/shared'`; troque `import { applyLocalOp, opTargetId } from './localOps'` por `import { applyLocalOp, objectOpsOf, opTargetId } from './localOps'` e `import { inverseGroupOf } from './undo'` por `import { batchInverse, inverseGroupOf } from './undo'`.
2. `reapplyPending` passa a considerar lotes:

```ts
function reapplyPending(
  objects: Record<string, TableObject>,
  pending: Record<string, PendingOp>,
  selfId: string,
  onlyId?: string,
): Record<string, TableObject> {
  let out = objects
  for (const p of Object.values(pending)) {
    for (const op of objectOpsOf(p.op)) {
      if (onlyId === undefined || opTargetId(op) === onlyId) out = applyLocalOp(out, op, selfId)
    }
  }
  return out
}
```

3. Em `applyOptimistic`, no `switch (op.kind)`, logo antes do `default:`:

```ts
    case 'batch': {
      const selfId = s.self?.clientId ?? ''
      const before: Record<string, TableObject | null> = {}
      let objects = s.objects
      for (const sub of op.ops) {
        const id = opTargetId(sub)
        if (!(id in before)) before[id] = s.objects[id] ?? null
        objects = applyLocalOp(objects, sub, selfId)
      }
      return { next: { ...s, objects }, before: null, prev: { kind: 'batch', before }, layerOrders: null }
    }
```

4. Em `revertLocal`, no `switch (prev.kind)`, acrescente (o lote é tratado em `rejectBatch`):

```ts
    case 'batch':
      return s
```

5. Antes de `reduceSubmitBatch`, a função interna e o lote recusado:

```ts
function inverseOfApplied(op: Op, applied: { before: TableObject | null; prev: LocalPrev | null }, role: Role | undefined): Op[] | null {
  if (op.kind === 'batch') return applied.prev?.kind === 'batch' ? batchInverse(op, applied.prev.before, role) : null
  return inverseGroupOf(op, applied.before, role)
}

/** Lote recusado: os objetos dele voltam ao estado de antes, com as outras ops pendentes por cima. */
function rejectBatch<S extends TableState>(s: S, opId: string, p: PendingOp, reason: RejectReason): S {
  const pending = omit(s.pending, opId)
  const before = p.prev?.kind === 'batch' ? p.prev.before : {}
  let objects = { ...s.objects }
  for (const [id, o] of Object.entries(before)) {
    if (o) objects[id] = o
    else delete objects[id]
  }
  const selfId = s.self?.clientId ?? ''
  for (const id of Object.keys(before)) objects = reapplyPending(objects, pending, selfId, id)
  const next = settleGroup({ ...s, pending, objects }, p, null)
  return addToast(next, p.isUndo ? 'Não foi possível desfazer' : (p.failText ?? rejectText(p.op, reason)))
}
```

6. `reduceSubmitBatch`: o tipo de `opts` vira `{ isUndo: boolean; groupId: string; failText?: string }`, e o objeto `pending[opId]` fica:

```ts
    pending[opId] = {
      op,
      before: applied.before,
      prev: applied.prev,
      layerOrders: applied.layerOrders,
      isUndo: opts.isUndo,
      inverse: opts.isUndo ? null : inverseOfApplied(op, applied, s.self?.role),
      group: opts.isUndo ? null : { id: opts.groupId, index },
      ...(opts.failText ? { failText: opts.failText } : {}),
    }
```

7. Em `reduceServer`, `case 'ack'`: depois do `if (isObjectOp(p.op)) { ... }`, acrescente:

```ts
      else if (p.op.kind === 'batch') {
        for (const sub of p.op.ops) if (sub.kind === 'delete') notes = omit(notes, sub.id)
      }
```

8. Em `case 'reject'`, logo depois de `if (!p) return s`:

```ts
      if (p.op.kind === 'batch') return rejectBatch(s, msg.opId, p, msg.reason)
```

9. Extraia o corpo do `case 'op'` para uma função e use-a também no lote. Antes de `reduceServer`:

```ts
/** Um upsert/delete vindo do servidor (op avulsa ou item de um lote). */
function applyServerOp<S extends TableState>(s: S, op: AppliedOp, selfId: string): S {
  if (op.kind === 'upsert') {
    const object = op.object
    const objects = reapplyPending({ ...s.objects, [object.id]: object }, s.pending, selfId, object.id)
    return { ...s, objects, dragPreviews: omit(s.dragPreviews, object.id) }
  }
  const id = op.id
  return {
    ...s,
    objects: omit(s.objects, id),
    notes: omit(s.notes, id),
    dragPreviews: omit(s.dragPreviews, id),
    locks: omit(s.locks, id),
    selectedId: s.selectedId === id ? null : s.selectedId,
  }
}
```

E no `switch (msg.t)`:

```ts
    case 'op':
      return applyServerOp(s, msg.op, selfId)

    case 'batch':
      return msg.ops.reduce((acc, op) => applyServerOp(acc, op, selfId), s)
```

Em `apps/web/src/store/tableStore.ts`:
1. Imports: acrescente `type ObjectOp` ao import de tipos de `'@mesa/shared'` e `BATCH_MAX` ao import de valores.
2. Em `TableActions`, depois de `submitGroup(ops: Op[]): boolean`:

```ts
  /**
   * Lotes atômicos (`batch`) como um só passo de desfazer. Lote com mais de 200 sub-ações é recusado
   * aqui, com aviso. `failText`: aviso se o servidor recusar.
   */
  submitBatches(batches: ObjectOp[][], failText: string): boolean
```

3. `submitMany` ganha o texto do aviso:

```ts
    const submitMany = (ops: Op[], isUndo: boolean, failText?: string): boolean => {
      // ... (igual)
      set(reduceSubmitBatch(s, items, { isUndo, groupId: `g_${nanoid()}`, ...(failText ? { failText } : {}) }))
      // ... (igual)
    }
```

4. Ação nova, depois de `submitGroup`:

```ts
      submitBatches(batches, failText) {
        const list = batches.filter((ops) => ops.length > 0)
        if (list.length === 0) return true
        if (list.some((ops) => ops.length > BATCH_MAX)) {
          set((s) => addToast(s, 'Seleção grande demais; selecione menos itens'))
          return false
        }
        return submitMany(list.map((ops): Op => ({ kind: 'batch', ops })), false, failText)
      },
```

Run: `pnpm --filter @mesa/web exec vitest run test/reducers-batch.test.ts test/batch-actions.test.ts`
Expected: PASS.

- [ ] **Step 9: Verificar o repositório inteiro**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 10: Commit**

```bash
git add packages/shared apps/worker apps/web/src/store apps/web/test/reducers-batch.test.ts apps/web/test/batch-actions.test.ts
git commit -m "feat(selecao): ação batch atômica no protocolo, no servidor e no cliente" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Modelo da seleção e montagem dos lotes (puro)

**Files:**
- Create: `apps/web/src/selection/model.ts`, `apps/web/src/selection/plan.ts`, `apps/web/src/lib/selectPrefs.ts`
- Test: `apps/web/test/selection-fixtures.ts` (apoio), `apps/web/test/selection-model.test.ts`, `apps/web/test/selection-plan.test.ts`, `apps/web/test/select-prefs.test.ts`

**Interfaces:**
- Consumes: Task 1 (`insideRect`, `insidePolygon`, `splitStrokeByRect`, `splitStrokeByPolygon`, `type StrokeSplit`); Task 2 (`type ObjectOp`); existentes: `canClearLayer`, `canControl`, `boundsOf`, `snapPatch`, `rotatedBounds` (`apps/web/src/canvas/bounds.ts`), `rebaseSegments`, `fitSegmentLimits` (`apps/web/src/canvas/eraser.ts`), `KeyValueStorage` (`apps/web/src/lib/dice-config.ts`).
- Produces (`apps/web/src/selection/model.ts`):
  - `type SelectShape = 'rect' | 'lasso'`
  - `type SelectionArea = { kind: 'rect'; rect: Box } | { kind: 'lasso'; points: number[] }`
  - `interface SelectionPart { inside: number[][]; outside: number[][] }` (coordenadas do mapa)
  - `interface Selection { areas: SelectionArea[]; whole: string[]; parts: Record<string, SelectionPart>; bounds: Box }`
  - `interface SelectContext { objects: Record<string, TableObject>; layers: Layer[]; activeLayerId: string; allLayers: boolean; selfId: string; role: Role; isLocked: (id: string) => boolean }`
  - `pointInBox(p: Point, b: Box, pad?: number): boolean`, `selectableLayerIds(ctx): Set<string>`, `worldSegments(o: StrokeObject): number[][]`, `splitByAreas(segments, areas): SelectionPart`, `selectionBounds(whole: TableObject[], parts: SelectionPart[]): Box`
  - `collectSelection(areas: SelectionArea[], ctx: SelectContext): Selection | null`
  - `addArea(current: Selection | null, area: SelectionArea, ctx: SelectContext): Selection | null`
  - `dropFromSelection(sel: Selection, ids: ReadonlySet<string>, objects: Record<string, TableObject>): Selection | null`
  - `selectionOfIds(ids: string[], objects: Record<string, TableObject>): Selection | null`
- Produces (`apps/web/src/selection/plan.ts`):
  - `interface PlanInput { selection: Selection; objects: Record<string, TableObject>; selfId: string; role: Role; newId: () => string; nextZ: (layerId: string) => number; grid: GridSettings }`
  - `interface BatchPlan { batches: ObjectOp[][]; selectAfter: string[] | null }` (`selectAfter: null` = mantém a seleção atual)
  - `planMove(input, dx, dy)`, `planDelete(input)`, `planToLayer(input, layerId)`, `planControl(input, control: Control)`, todos `: BatchPlan`
- Produces (`apps/web/src/lib/selectPrefs.ts`): `SELECT_PREFS_KEY = 'mesa:select'`, `interface SelectPrefs { selectShape: SelectShape; selectAllLayers: boolean }`, `DEFAULT_SELECT_PREFS`, `loadSelectPrefs(storage?)`, `saveSelectPrefs(prefs, storage?)`.

- [ ] **Step 1: Testes do modelo (falham)**

Crie primeiro `apps/web/test/selection-fixtures.ts` (objetos de teste usados também pelas Tasks 4 e 6; não é arquivo de teste, então não roda sozinho):

```ts
import type { TableObject } from '@mesa/shared'

export const server = (owner: string) => ({ ownerId: owner, version: 1, updatedBy: owner, control: { mode: 'list' as const, clientIds: [owner] } })

/** Traço a partir de pontos do mapa. */
export const strokeAt = (id: string, points: number[], over: Partial<TableObject> = {}): TableObject => {
  const xs = points.filter((_, i) => i % 2 === 0)
  const ys = points.filter((_, i) => i % 2 === 1)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return {
    id, type: 'stroke', layerId: 'drawings', x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation: 0, zIndex: 1,
    segments: [points.map((v, i) => v - (i % 2 === 0 ? x : y))], color: '#ffffff', strokeWidth: 2, ...server('me'), ...over,
  } as TableObject
}

/** Imagem 20 x 20 na posição dada. */
export const tokenAt = (id: string, x: number, y: number, over: Partial<TableObject> = {}): TableObject =>
  ({ id, type: 'image', layerId: 'drawings', assetKey: 'a'.repeat(64), x, y, width: 20, height: 20, rotation: 0, zIndex: 2, ...server('me'), ...over }) as TableObject
```

Depois crie `apps/web/test/selection-model.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, type TableObject } from '@mesa/shared'
import {
  addArea,
  collectSelection,
  dropFromSelection,
  pointInBox,
  selectionOfIds,
  type SelectContext,
  type SelectionArea,
} from '../src/selection/model'
import { server, strokeAt, tokenAt } from './selection-fixtures'

const rect = (x: number, y: number, width: number, height: number): SelectionArea => ({ kind: 'rect', rect: { x, y, width, height } })
const ctx = (objects: TableObject[], over: Partial<SelectContext> = {}): SelectContext => ({
  objects: Object.fromEntries(objects.map((o) => [o.id, o])),
  layers: DEFAULT_LAYERS, activeLayerId: 'drawings', allLayers: false, selfId: 'me', role: 'player', isLocked: () => false,
  ...over,
})

describe('collectSelection', () => {
  const line = strokeAt('l', [0, 50, 200, 50])
  const t1 = tokenAt('t1', 60, 40)
  const t2 = tokenAt('t2', 140, 40)

  it('retângulo: token inteiro entra, o traço é cortado na borda, token pela metade fica de fora', () => {
    const sel = collectSelection([rect(50, 0, 100, 100)], ctx([line, t1, t2]))!
    expect(sel.whole).toEqual(['t1'])
    expect(sel.parts).toEqual({ l: { inside: [[50, 50, 150, 50]], outside: [[0, 50, 50, 50], [150, 50, 200, 50]] } })
    expect(sel.bounds).toEqual({ x: 50, y: 40, width: 100, height: 20 })
  })

  it('traço todo dentro entra inteiro, sem corte', () => {
    expect(collectSelection([rect(50, 0, 100, 100)], ctx([strokeAt('s', [60, 50, 80, 50])]))).toMatchObject({ whole: ['s'], parts: {} })
  })

  it('área sem nada editável, retângulo sem altura ou laço com menos de 3 pontos: nada', () => {
    expect(collectSelection([rect(500, 500, 10, 10)], ctx([line, t1]))).toBeNull()
    expect(collectSelection([rect(0, 0, 0, 100)], ctx([line, t1]))).toBeNull()
    expect(collectSelection([{ kind: 'lasso', points: [0, 0, 300, 300] }], ctx([line, t1]))).toBeNull()
  })

  it('alcance: a camada ativa; com "Todas as camadas", as que a pessoa pode usar', () => {
    const layers = DEFAULT_LAYERS.map((l) => (l.id === 'map' ? { ...l, locked: true } : l))
    const objs = [tokenAt('a', 60, 40), tokenAt('b', 60, 40, { layerId: 'tokens' }), tokenAt('c', 60, 40, { layerId: 'map' }), tokenAt('d', 60, 40, { layerId: 'gm' })]
    const area = [rect(0, 0, 100, 100)]
    expect(collectSelection(area, ctx(objs, { layers }))?.whole).toEqual(['a'])
    expect(collectSelection(area, ctx(objs, { layers, allLayers: true }))?.whole.sort()).toEqual(['a', 'b'])
    expect(collectSelection(area, ctx(objs, { layers, allLayers: true, role: 'gm' }))?.whole.sort()).toEqual(['a', 'b', 'c', 'd'])
  })

  it('jogador não pega token de outra pessoa; item travado por outra pessoa fica de fora', () => {
    const objs = [tokenAt('mine', 60, 40), tokenAt('theirs', 60, 40, server('bia')), tokenAt('busy', 60, 40)]
    expect(collectSelection([rect(0, 0, 100, 100)], ctx(objs, { isLocked: (id) => id === 'busy' }))?.whole).toEqual(['mine'])
  })

  it('laço: item girado dentro do triângulo entra; o de fora, não', () => {
    const objs = [tokenAt('r', 40, 40, { rotation: 45 }), tokenAt('far', 150, 150)]
    expect(collectSelection([{ kind: 'lasso', points: [0, 0, 200, 0, 0, 200] }], ctx(objs))?.whole).toEqual(['r'])
  })
})

describe('addArea (Shift)', () => {
  const line = strokeAt('l', [0, 50, 300, 50])

  it('soma itens e junta os pedaços de dentro de um traço cortado pelas duas áreas', () => {
    const c = ctx([line, tokenAt('t', 210, 70)])
    const first = collectSelection([rect(50, 0, 50, 100)], c)
    const both = addArea(first, rect(200, 0, 50, 100), c)!
    expect(both.whole).toEqual(['t'])
    expect(both.parts.l).toEqual({
      inside: [[50, 50, 100, 50], [200, 50, 250, 50]],
      outside: [[0, 50, 50, 50], [100, 50, 200, 50], [250, 50, 300, 50]],
    })
    expect(both.areas).toHaveLength(2)
  })

  it('área que cobre o resto do traço o torna inteiro', () => {
    const c = ctx([line])
    const sel = addArea(collectSelection([rect(50, 0, 50, 100)], c), rect(-10, 0, 400, 100), c)!
    expect(sel.whole).toEqual(['l'])
    expect(sel.parts).toEqual({})
  })

  it('área vazia não muda a seleção; sem seleção, vira a seleção', () => {
    const c = ctx([line])
    const sel = collectSelection([rect(50, 0, 50, 100)], c)
    expect(addArea(sel, rect(900, 900, 10, 10), c)).toBe(sel)
    expect(addArea(null, rect(50, 0, 50, 100), c)).toEqual(sel)
  })
})

describe('dropFromSelection, selectionOfIds e pointInBox', () => {
  it('tira o item e recalcula a caixa; sem nada, null', () => {
    const objs = [tokenAt('a', 0, 0), tokenAt('b', 100, 0)]
    const c = ctx(objs)
    const sel = collectSelection([rect(-10, -10, 200, 100)], c)!
    expect(sel.bounds).toEqual({ x: 0, y: 0, width: 120, height: 20 })
    const kept = dropFromSelection(sel, new Set(['b']), c.objects)!
    expect(kept.whole).toEqual(['a'])
    expect(kept.bounds).toEqual({ x: 0, y: 0, width: 20, height: 20 })
    expect(dropFromSelection(kept, new Set(['a']), c.objects)).toBeNull()
  })

  it('selectionOfIds monta a seleção de itens inteiros (depois de mover)', () => {
    const objs = Object.fromEntries([tokenAt('a', 0, 0)].map((o) => [o.id, o]))
    expect(selectionOfIds(['a', 'sumiu'], objs)).toEqual({ areas: [], whole: ['a'], parts: {}, bounds: { x: 0, y: 0, width: 20, height: 20 } })
    expect(selectionOfIds([], objs)).toBeNull()
  })

  it('pointInBox com folga', () => {
    const b = { x: 0, y: 0, width: 10, height: 0 }
    expect(pointInBox({ x: 5, y: 3 }, b)).toBe(false)
    expect(pointInBox({ x: 5, y: 3 }, b, 4)).toBe(true)
  })
})
```

Run: `pnpm --filter @mesa/web exec vitest run test/selection-model.test.ts`
Expected: FAIL (`../src/selection/model` não existe).

- [ ] **Step 2: Implementar o modelo**

Crie `apps/web/src/selection/model.ts`:

```ts
import {
  boundsOf,
  canClearLayer,
  canControl,
  insidePolygon,
  insideRect,
  splitStrokeByPolygon,
  splitStrokeByRect,
  type Box,
  type Layer,
  type Point,
  type Role,
  type StrokeObject,
  type StrokeSplit,
  type TableObject,
} from '@mesa/shared'
import { rotatedBounds } from '../canvas/bounds'

export type SelectShape = 'rect' | 'lasso'

/** Área desenhada com o Selecionar, em coordenadas do mapa; o laço é um polígono plano [x0, y0, ...]. */
export type SelectionArea = { kind: 'rect'; rect: Box } | { kind: 'lasso'; points: number[] }

/** Traço cortado pela área: pedaços de dentro e de fora, em coordenadas do mapa. */
export interface SelectionPart {
  inside: number[][]
  outside: number[][]
}

export interface Selection {
  /** Áreas que formaram a seleção (para somar outra área a um traço já cortado). */
  areas: SelectionArea[]
  /** Itens inteiros: imagens, formas e traços que caíram todos dentro. */
  whole: string[]
  /** Traços cortados, por id. O corte só acontece ao agir. */
  parts: Record<string, SelectionPart>
  /** Caixa de tudo que está selecionado (coordenadas do mapa). */
  bounds: Box
}

export interface SelectContext {
  objects: Record<string, TableObject>
  layers: Layer[]
  activeLayerId: string
  allLayers: boolean
  selfId: string
  role: Role
  /** Travado por outra pessoa (sendo arrastado): fica de fora. */
  isLocked: (id: string) => boolean
}

/** Pedaço menor que isso (unidades do mapa) é poeira do corte. */
const MIN_PIECE = 0.5

export function pointInBox(p: Point, b: Box, pad = 0): boolean {
  return p.x >= b.x - pad && p.x <= b.x + b.width + pad && p.y >= b.y - pad && p.y <= b.y + b.height + pad
}

function usable(area: SelectionArea): boolean {
  return area.kind === 'rect' ? area.rect.width > 0 && area.rect.height > 0 : area.points.length >= 6
}

/** Camadas em que a seleção pega itens: a ativa (ou todas) que a pessoa vê e pode editar. */
export function selectableLayerIds(ctx: SelectContext): Set<string> {
  return new Set(
    ctx.layers.filter((l) => (ctx.allLayers || l.id === ctx.activeLayerId) && canClearLayer(l, ctx.role)).map((l) => l.id),
  )
}

export function worldSegments(o: StrokeObject): number[][] {
  return o.segments.map((seg) => seg.map((v, i) => v + (i % 2 === 0 ? o.x : o.y)))
}

function pathLength(points: number[]): number {
  let total = 0
  for (let i = 2; i < points.length; i += 2) total += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1])
  return total
}

function splitByArea(points: number[], area: SelectionArea): StrokeSplit {
  return area.kind === 'rect' ? splitStrokeByRect(points, area.rect) : splitStrokeByPolygon(points, area.points)
}

/**
 * Corta os pedaços (coordenadas do mapa) por todas as áreas: dentro de qualquer uma = dentro.
 * Só poeira de um lado: o traço conta como todo do outro lado (sem corte).
 */
export function splitByAreas(segments: number[][], areas: SelectionArea[]): SelectionPart {
  const inside: number[][] = []
  let outside = segments
  for (const area of areas) {
    const rest: number[][] = []
    for (const seg of outside) {
      const r = splitByArea(seg, area)
      inside.push(...r.inside)
      rest.push(...r.outside)
    }
    outside = rest
  }
  const solid = (list: number[][]) => list.filter((p) => pathLength(p) >= MIN_PIECE)
  if (inside.length === 0) return { inside: [], outside: segments }
  if (outside.length === 0 || solid(outside).length === 0) return { inside: segments, outside: [] }
  const keptIn = solid(inside)
  if (keptIn.length === 0) return { inside: [], outside: segments }
  return { inside: keptIn, outside: solid(outside) }
}

function itemInArea(o: TableObject, area: SelectionArea): boolean {
  const box = { x: o.x, y: o.y, width: o.width, height: o.height, rotation: o.rotation }
  return area.kind === 'rect' ? insideRect(box, area.rect) : insidePolygon(box, area.points)
}

export function selectionBounds(whole: TableObject[], parts: SelectionPart[]): Box {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const add = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
  }
  for (const o of whole) {
    const b = rotatedBounds(o)
    add(b.minX, b.minY, b.maxX, b.maxY)
  }
  for (const p of parts) {
    for (const seg of p.inside) {
      const b = boundsOf(seg)
      add(b.minX, b.minY, b.minX + b.width, b.minY + b.height)
    }
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY }
}

function build(areas: SelectionArea[], whole: TableObject[], parts: Record<string, SelectionPart>): Selection | null {
  if (whole.length === 0 && Object.keys(parts).length === 0) return null
  return { areas, whole: whole.map((o) => o.id), parts, bounds: selectionBounds(whole, Object.values(parts)) }
}

/** Seleção pelas áreas: só itens que a pessoa pode editar, na camada ativa (ou em todas). */
export function collectSelection(areas: SelectionArea[], ctx: SelectContext): Selection | null {
  const list = areas.filter(usable)
  if (list.length === 0) return null
  const layerIds = selectableLayerIds(ctx)
  const whole: TableObject[] = []
  const parts: Record<string, SelectionPart> = {}
  for (const o of Object.values(ctx.objects)) {
    if (!layerIds.has(o.layerId) || !canControl(o, ctx.selfId, ctx.role) || ctx.isLocked(o.id)) continue
    if (o.type === 'stroke') {
      const split = splitByAreas(worldSegments(o), list)
      if (split.inside.length === 0) continue
      if (split.outside.length === 0) whole.push(o)
      else parts[o.id] = split
    } else if (list.some((a) => itemInArea(o, a))) {
      whole.push(o)
    }
  }
  return build(list, whole, parts)
}

/** Shift + arrastar: soma a área. Traço cortado pelas duas é recortado pelas áreas somadas. */
export function addArea(current: Selection | null, area: SelectionArea, ctx: SelectContext): Selection | null {
  const added = collectSelection([area], ctx)
  if (!current) return added
  if (!added) return current
  const areas = [...current.areas, area]
  const wholeIds = new Set([...current.whole, ...added.whole])
  const parts: Record<string, SelectionPart> = {}
  for (const id of new Set([...Object.keys(current.parts), ...Object.keys(added.parts)])) {
    if (wholeIds.has(id)) continue
    const o = ctx.objects[id]
    if (!o || o.type !== 'stroke') continue
    if (current.parts[id] && added.parts[id]) {
      const split = splitByAreas(worldSegments(o), areas)
      if (split.outside.length === 0) wholeIds.add(id)
      else parts[id] = split
    } else {
      parts[id] = current.parts[id] ?? added.parts[id]
    }
  }
  const whole = [...wholeIds].map((id) => ctx.objects[id]).filter((o): o is TableObject => !!o)
  return build(areas, whole, parts)
}

/** Tira itens (apagados ou mudados por outra pessoa); sem nada, null. */
export function dropFromSelection(sel: Selection, ids: ReadonlySet<string>, objects: Record<string, TableObject>): Selection | null {
  const whole = sel.whole.filter((id) => !ids.has(id) && objects[id])
  const parts = Object.fromEntries(Object.entries(sel.parts).filter(([id]) => !ids.has(id) && objects[id]))
  if (whole.length === 0 && Object.keys(parts).length === 0) return null
  return { ...sel, whole, parts, bounds: selectionBounds(whole.map((id) => objects[id]), Object.values(parts)) }
}

/** Seleção de itens inteiros pelos ids (o que fica selecionado depois de mover). */
export function selectionOfIds(ids: string[], objects: Record<string, TableObject>): Selection | null {
  const whole = ids.map((id) => objects[id]).filter((o): o is TableObject => !!o)
  return build([], whole, {})
}
```

Run: `pnpm --filter @mesa/web exec vitest run test/selection-model.test.ts`
Expected: PASS.

- [ ] **Step 3: Testes dos lotes (falham)**

Crie `apps/web/test/selection-plan.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, MAX_SEGMENTS, NewObjectSchema, type NewObject, type ObjectOp, type TableObject } from '@mesa/shared'
import { collectSelection, type SelectionArea } from '../src/selection/model'
import { planControl, planDelete, planMove, planToLayer, type PlanInput } from '../src/selection/plan'
import { strokeAt, tokenAt } from './selection-fixtures'

const rect = (x: number, y: number, width: number, height: number): SelectionArea => ({ kind: 'rect', rect: { x, y, width, height } })
const byId = (objects: TableObject[]) => Object.fromEntries(objects.map((o) => [o.id, o]))

function input(objects: TableObject[], area: SelectionArea, over: Partial<PlanInput> = {}): PlanInput {
  const role = over.role ?? 'player'
  const selection = collectSelection([area], {
    objects: byId(objects), layers: DEFAULT_LAYERS, activeLayerId: 'drawings', allLayers: false,
    selfId: over.selfId ?? 'me', role, isLocked: () => false,
  })!
  let n = 0
  return {
    selection, objects: byId(objects), selfId: 'me', role, newId: () => `n${++n}`, nextZ: () => 10,
    grid: { enabled: true, size: 70, snap: false }, ...over,
  }
}

const line = strokeAt('l', [0, 50, 200, 50], { title: 'Rio' })
const t1 = tokenAt('t1', 60, 40)
const area = rect(50, 0, 100, 100)
const stroke = (o: Partial<NewObject>) => ({ type: 'stroke', rotation: 0, color: '#ffffff', strokeWidth: 2, ...o })

describe('planMove', () => {
  it('itens inteiros: update de posição; traço cortado: apaga o original e cria os pedaços (o de dentro já no lugar novo)', () => {
    const plan = planMove(input([line, t1], area), 10, 100)
    expect(plan.batches).toEqual([[
      { kind: 'update', id: 't1', patch: { x: 70, y: 140 } },
      { kind: 'delete', id: 'l' },
      { kind: 'create', object: stroke({ id: 'n1', layerId: 'drawings', x: 0, y: 50, width: 200, height: 0, zIndex: 1, segments: [[0, 0, 50, 0], [150, 0, 200, 0]], title: 'Rio' }) },
      { kind: 'create', object: stroke({ id: 'n2', layerId: 'drawings', x: 60, y: 150, width: 100, height: 0, zIndex: 1, segments: [[0, 0, 100, 0]] }) },
    ]])
    expect(plan.selectAfter).toEqual(['t1', 'n2'])
  })

  it('com encaixe ligado, imagens caem na grade', () => {
    const plan = planMove(input([t1], area, { grid: { enabled: true, size: 50, snap: true } }), 10, 100)
    expect(plan.batches[0]).toEqual([{ kind: 'update', id: 't1', patch: { x: 50, y: 150 } }])
  })

  it('mestre cortando o traço de outra pessoa: um segundo lote devolve o controle aos pedaços', () => {
    const theirs = strokeAt('l', [0, 50, 200, 50], { ownerId: 'bia', control: { mode: 'list', clientIds: ['bia'] } })
    const plan = planMove(input([theirs], area, { role: 'gm' }), 0, 10)
    expect(plan.batches[1]).toEqual([
      { kind: 'update', id: 'n1', patch: { control: { mode: 'list', clientIds: ['bia'] } } },
      { kind: 'update', id: 'n2', patch: { control: { mode: 'list', clientIds: ['bia'] } } },
    ])
  })
})

describe('planDelete', () => {
  it('apaga os inteiros; do traço cortado sobra só o pedaço de fora', () => {
    const plan = planDelete(input([line, t1], area))
    expect(plan.batches).toEqual([[
      { kind: 'delete', id: 't1' },
      { kind: 'delete', id: 'l' },
      { kind: 'create', object: stroke({ id: 'n1', layerId: 'drawings', x: 0, y: 50, width: 200, height: 0, zIndex: 1, segments: [[0, 0, 50, 0], [150, 0, 200, 0]], title: 'Rio' }) },
    ]])
    expect(plan.selectAfter).toEqual([])
  })

  it('traço em zigue-zague cortado em centenas de pedaços continua válido no schema', () => {
    const zig: number[] = []
    for (let i = 0; i <= 300; i++) zig.push(i * 2, i % 2 === 0 ? 0 : 100)
    const plan = planDelete(input([strokeAt('z', zig)], rect(-10, 40, 700, 20)))
    const created = plan.batches[0].filter((op): op is Extract<ObjectOp, { kind: 'create' }> => op.kind === 'create')
    expect(created).toHaveLength(1)
    const object = created[0].object as Extract<NewObject, { type: 'stroke' }>
    expect(object.segments.length).toBeLessThanOrEqual(MAX_SEGMENTS)
    expect(NewObjectSchema.safeParse(object).success).toBe(true)
  })
})

describe('planToLayer', () => {
  it('troca a camada no topo do destino; o pedaço de dentro vai para a camada nova, o de fora fica', () => {
    const plan = planToLayer(input([line, t1], area, { role: 'gm' }), 'tokens')
    expect(plan.batches[0]).toEqual([
      { kind: 'update', id: 't1', patch: { layerId: 'tokens', zIndex: 10 } },
      { kind: 'delete', id: 'l' },
      { kind: 'create', object: stroke({ id: 'n1', layerId: 'drawings', x: 0, y: 50, width: 200, height: 0, zIndex: 1, segments: [[0, 0, 50, 0], [150, 0, 200, 0]], title: 'Rio' }) },
      { kind: 'create', object: stroke({ id: 'n2', layerId: 'tokens', x: 50, y: 50, width: 100, height: 0, zIndex: 11, segments: [[0, 0, 100, 0]] }) },
    ])
    expect(plan.selectAfter).toEqual([])
  })

  it('itens que já estão no destino são pulados', () => {
    expect(planToLayer(input([line, t1], area, { role: 'gm' }), 'drawings').batches.flat()).toEqual([])
  })
})

describe('planControl', () => {
  it('um update por token inteiro; traços e formas ficam de fora; a seleção é mantida', () => {
    const control = { mode: 'all' as const, clientIds: [] }
    const plan = planControl(input([t1, strokeAt('s', [60, 50, 80, 50])], area, { role: 'gm' }), control)
    expect(plan).toEqual({ batches: [[{ kind: 'update', id: 't1', patch: { control } }]], selectAfter: null })
  })
})
```

Run: `pnpm --filter @mesa/web exec vitest run test/selection-plan.test.ts`
Expected: FAIL (`../src/selection/plan` não existe).

- [ ] **Step 4: Implementar a montagem dos lotes**

Crie `apps/web/src/selection/plan.ts`:

```ts
import {
  snapPatch,
  type Control,
  type GridSettings,
  type NewObject,
  type ObjectOp,
  type Role,
  type StrokeObject,
  type TableObject,
} from '@mesa/shared'
import { fitSegmentLimits, rebaseSegments } from '../canvas/eraser'
import type { Selection } from './model'

export interface PlanInput {
  selection: Selection
  objects: Record<string, TableObject>
  selfId: string
  role: Role
  newId: () => string
  /** zIndex do topo da camada (o maior + 1). */
  nextZ: (layerId: string) => number
  grid: GridSettings
}

export interface BatchPlan {
  /** O 1º é a ação; o 2º, quando existe, devolve o controle dos pedaços criados pelo mestre. */
  batches: ObjectOp[][]
  /** Ids que continuam selecionados (inteiros) depois da ação; null = mantém a seleção atual. */
  selectAfter: string[] | null
}

const shifted = (segments: number[][], dx: number, dy: number) =>
  segments.map((seg) => seg.map((v, i) => v + (i % 2 === 0 ? dx : dy)))

/** Traço novo com os pedaços (coordenadas do mapa), no formato e nos limites do schema. */
function piece(original: StrokeObject, world: number[][], over: { id: string; layerId: string; zIndex: number; title: boolean }): NewObject {
  const r = rebaseSegments(fitSegmentLimits(world, 1), 0, 0)
  return {
    id: over.id,
    type: 'stroke',
    layerId: over.layerId,
    x: r.x,
    y: r.y,
    width: r.width,
    height: r.height,
    rotation: 0,
    zIndex: over.zIndex,
    segments: r.segments,
    color: original.color,
    strokeWidth: original.strokeWidth,
    ...(over.title && original.title ? { title: original.title } : {}),
  }
}

class Builder {
  main: ObjectOp[] = []
  follow: ObjectOp[] = []
  constructor(private input: PlanInput) {}

  /** Cria um pedaço do traço e, se o mestre está cortando, devolve o controle do original a ele. */
  create(original: StrokeObject, world: number[][], over: { layerId: string; zIndex: number; title: boolean }): string {
    const id = this.input.newId()
    this.main.push({ kind: 'create', object: piece(original, world, { id, ...over }) })
    const c = original.control
    const mine = c.mode === 'list' && c.clientIds.length === 1 && c.clientIds[0] === this.input.selfId
    if (this.input.role === 'gm' && !mine) this.follow.push({ kind: 'update', id, patch: { control: c } })
    return id
  }

  done(selectAfter: string[] | null): BatchPlan {
    return { batches: this.follow.length > 0 ? [this.main, this.follow] : [this.main], selectAfter }
  }
}

function strokesCut(input: PlanInput): Array<{ o: StrokeObject; inside: number[][]; outside: number[][] }> {
  const out: Array<{ o: StrokeObject; inside: number[][]; outside: number[][] }> = []
  for (const [id, part] of Object.entries(input.selection.parts)) {
    const o = input.objects[id]
    if (o?.type === 'stroke') out.push({ o, ...part })
  }
  return out
}

function wholeObjects(input: PlanInput): TableObject[] {
  return input.selection.whole.map((id) => input.objects[id]).filter((o): o is TableObject => !!o)
}

export function planMove(input: PlanInput, dx: number, dy: number): BatchPlan {
  const b = new Builder(input)
  const keep: string[] = []
  for (const o of wholeObjects(input)) {
    let patch = { x: o.x + dx, y: o.y + dy }
    if (o.type === 'image' && input.grid.snap) patch = snapPatch(patch, input.grid.size)
    b.main.push({ kind: 'update', id: o.id, patch })
    keep.push(o.id)
  }
  for (const { o, inside, outside } of strokesCut(input)) {
    b.main.push({ kind: 'delete', id: o.id })
    if (outside.length > 0) b.create(o, outside, { layerId: o.layerId, zIndex: o.zIndex, title: true })
    keep.push(b.create(o, shifted(inside, dx, dy), { layerId: o.layerId, zIndex: o.zIndex, title: false }))
  }
  return b.done(keep)
}

export function planDelete(input: PlanInput): BatchPlan {
  const b = new Builder(input)
  for (const o of wholeObjects(input)) b.main.push({ kind: 'delete', id: o.id })
  for (const { o, outside } of strokesCut(input)) {
    b.main.push({ kind: 'delete', id: o.id })
    if (outside.length > 0) b.create(o, outside, { layerId: o.layerId, zIndex: o.zIndex, title: true })
  }
  return b.done([])
}

export function planToLayer(input: PlanInput, layerId: string): BatchPlan {
  const b = new Builder(input)
  let z = input.nextZ(layerId)
  for (const o of wholeObjects(input)) {
    if (o.layerId === layerId) continue
    b.main.push({ kind: 'update', id: o.id, patch: { layerId, zIndex: z++ } })
  }
  for (const { o, inside, outside } of strokesCut(input)) {
    if (o.layerId === layerId) continue
    b.main.push({ kind: 'delete', id: o.id })
    if (outside.length > 0) b.create(o, outside, { layerId: o.layerId, zIndex: o.zIndex, title: true })
    b.create(o, inside, { layerId, zIndex: z++, title: false })
  }
  return b.done([])
}

/** Controle e permissões: um update por token (imagem inteira); sem corte. */
export function planControl(input: PlanInput, control: Control): BatchPlan {
  const ops: ObjectOp[] = wholeObjects(input)
    .filter((o) => o.type === 'image')
    .map((o) => ({ kind: 'update', id: o.id, patch: { control } }))
  return { batches: [ops], selectAfter: null }
}
```

Run: `pnpm --filter @mesa/web exec vitest run test/selection-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Teste das opções no `localStorage` (falha)**

Crie `apps/web/test/select-prefs.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_SELECT_PREFS, SELECT_PREFS_KEY, loadSelectPrefs, saveSelectPrefs } from '../src/lib/selectPrefs'

const memory = () => {
  const mem = new Map<string, string>()
  return { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), mem }
}

describe('opções do Selecionar', () => {
  it('padrão: retângulo, só a camada ativa', () => {
    expect(loadSelectPrefs(memory())).toEqual({ selectShape: 'rect', selectAllLayers: false })
    expect(DEFAULT_SELECT_PREFS).toEqual({ selectShape: 'rect', selectAllLayers: false })
  })

  it('guarda e lê de volta', () => {
    const storage = memory()
    saveSelectPrefs({ selectShape: 'lasso', selectAllLayers: true }, storage)
    expect(JSON.parse(storage.mem.get(SELECT_PREFS_KEY)!)).toEqual({ selectShape: 'lasso', selectAllLayers: true })
    expect(loadSelectPrefs(storage)).toEqual({ selectShape: 'lasso', selectAllLayers: true })
  })

  it('conteúdo inválido ou armazenamento bloqueado: padrão', () => {
    const storage = memory()
    storage.setItem(SELECT_PREFS_KEY, '{"selectShape":"estrela","selectAllLayers":"sim"}')
    expect(loadSelectPrefs(storage)).toEqual(DEFAULT_SELECT_PREFS)
    const broken = { getItem: () => { throw new Error('bloqueado') }, setItem: () => { throw new Error('bloqueado') } }
    expect(loadSelectPrefs(broken)).toEqual(DEFAULT_SELECT_PREFS)
    expect(() => saveSelectPrefs(DEFAULT_SELECT_PREFS, broken)).not.toThrow()
    expect(loadSelectPrefs(null)).toEqual(DEFAULT_SELECT_PREFS)
  })
})
```

Run: `pnpm --filter @mesa/web exec vitest run test/select-prefs.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 6: Implementar as opções**

Crie `apps/web/src/lib/selectPrefs.ts`:

```ts
import type { SelectShape } from '../selection/model'
import type { KeyValueStorage } from './dice-config'

export const SELECT_PREFS_KEY = 'mesa:select'

/** Opções do Selecionar, por pessoa (localStorage). */
export interface SelectPrefs {
  selectShape: SelectShape
  selectAllLayers: boolean
}

export const DEFAULT_SELECT_PREFS: SelectPrefs = { selectShape: 'rect', selectAllLayers: false }

function defaultStorage(): KeyValueStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

export function loadSelectPrefs(storage: KeyValueStorage | null = defaultStorage()): SelectPrefs {
  try {
    const raw = storage?.getItem(SELECT_PREFS_KEY)
    const r = (raw ? JSON.parse(raw) : {}) as Record<string, unknown>
    return {
      selectShape: r.selectShape === 'lasso' ? 'lasso' : 'rect',
      selectAllLayers: r.selectAllLayers === true,
    }
  } catch {
    return { ...DEFAULT_SELECT_PREFS }
  }
}

export function saveSelectPrefs(prefs: SelectPrefs, storage: KeyValueStorage | null = defaultStorage()): void {
  try {
    storage?.setItem(SELECT_PREFS_KEY, JSON.stringify(prefs))
  } catch {
    // armazenamento bloqueado: a opção vale só nesta aba
  }
}
```

Run: `pnpm --filter @mesa/web exec vitest run test/select-prefs.test.ts`
Expected: PASS.

- [ ] **Step 7: Verificar o repositório inteiro**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/selection apps/web/src/lib/selectPrefs.ts apps/web/test/selection-fixtures.ts apps/web/test/selection-model.test.ts apps/web/test/selection-plan.test.ts apps/web/test/select-prefs.test.ts
git commit -m "feat(selecao): modelo da seleção em área e montagem dos lotes" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Seleção na store, teclado e menu do Selecionar

**Files:**
- Create: `apps/web/src/selection/reconcile.ts`, `apps/web/src/ui/SelectPopover.tsx`
- Modify: `apps/web/src/store/state.ts`, `apps/web/src/store/reducers.ts`, `apps/web/src/store/tableStore.ts`, `apps/web/src/ui/useKeyboard.ts`, `apps/web/src/ui/Toolbar.tsx`
- Test: `apps/web/test/selection-store.test.ts`

**Interfaces:**
- Consumes: Task 2 (`submitBatches`, `rejectBatch` em `reducers.ts`); Task 3 (`collectSelection`, `addArea`, `dropFromSelection`, `selectionOfIds`, `planMove`, `planDelete`, `planToLayer`, `planControl`, `loadSelectPrefs`, `saveSelectPrefs`, tipos).
- Produces:
  - `TableState`: `selection: Selection | null`, `selectionOffset: Point | null`, `selectionMenu: { x: number; y: number } | null`, `selectShape: SelectShape`, `selectAllLayers: boolean`; `NO_SELECTION` (em `state.ts`).
  - Ações: `selectArea(area: SelectionArea, additive: boolean)`, `clearSelection()`, `setSelectionOffset(offset: Point | null)`, `moveSelection(dx: number, dy: number)`, `deleteSelection()`, `selectionToLayer(layerId: string)`, `selectionControl(control: Control)`, `openSelectionMenu(x: number, y: number)`, `closeSelectionMenu()`, `setSelectShape(shape: SelectShape)`, `setSelectAllLayers(value: boolean)`.
  - `reconcileSelection<S extends TableState>(prev: S, next: S): S` (`selection/reconcile.ts`).
  - `SelectPopover` (`aria-label="Opções da seleção"`; botões "Retângulo" e "Laço"; caixa "Todas as camadas").

- [ ] **Step 1: Testes da store (falham)**

Crie `apps/web/test/selection-store.test.ts` (a Task 6 acrescenta casos aqui):

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ServerMessage, type TableObject } from '@mesa/shared'
import type { WebSocketLike } from '../src/sync/SyncClient'
import { createTableStore } from '../src/store/tableStore'
import type { SelectionArea } from '../src/selection/model'
import { strokeAt, tokenAt } from './selection-fixtures'

class FakeSocket implements WebSocketLike {
  static all: FakeSocket[] = []
  sent: any[] = []
  onopen: ((ev: unknown) => void) | null = null
  onmessage: ((ev: { data: unknown }) => void) | null = null
  onclose: ((ev: { code: number }) => void) | null = null
  constructor(public url: string) {
    FakeSocket.all.push(this)
  }
  send(data: string) { this.sent.push(data === 'ping' ? 'ping' : JSON.parse(data)) }
  close() { this.onclose?.({ code: 1000 }) }
  receive(msg: ServerMessage) { this.onmessage?.({ data: JSON.stringify(msg) }) }
}

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const sock = () => FakeSocket.all[FakeSocket.all.length - 1]
const opsSent = () => sock().sent.filter((m) => typeof m === 'object' && m.t === 'op')
const rect = (x: number, y: number, width: number, height: number): SelectionArea => ({ kind: 'rect', rect: { x, y, width, height } })

// Tudo na camada Tokens (a ativa depois do welcome).
const line = strokeAt('l', [0, 50, 200, 50], { layerId: 'tokens' })
const t1 = tokenAt('t1', 60, 40, { layerId: 'tokens' })

function connected(objects: TableObject[] = [line, t1]) {
  const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
  store.getState().actions.connect('Eu')
  sock().onopen?.({})
  sock().receive({
    t: 'welcome', self: me,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects, locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  })
  return store
}

beforeEach(() => {
  FakeSocket.all = []
  const mem = new Map<string, string>()
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('seleção na store', () => {
  it('mover envia um lote; a seleção vira os itens movidos (inteiros)', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    expect(store.getState().selection).toMatchObject({ whole: ['t1'], parts: { l: expect.anything() } })
    a.setSelectionOffset({ x: 10, y: 100 })
    a.moveSelection(10, 100)
    const [sent] = opsSent()
    expect(sent.op.kind).toBe('batch')
    expect(sent.op.ops).toHaveLength(4)
    const s = store.getState()
    expect(s.selectionOffset).toBeNull()
    expect(s.selection?.parts).toEqual({})
    expect(s.selection?.whole).toHaveLength(2)
    expect(s.objects.t1).toMatchObject({ x: 70, y: 140 })
  })

  it('lote recusado: tudo volta, aviso e seleção desfeita', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.moveSelection(10, 100)
    sock().receive({ t: 'reject', opId: opsSent()[0].opId, reason: 'locked' })
    const s = store.getState()
    expect(Object.keys(s.objects).sort()).toEqual(['l', 't1'])
    expect(s.objects.t1.x).toBe(60)
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível mover a seleção')
    expect(s.selection).toBeNull()
  })

  it('soltar no mesmo lugar não envia nada e mantém a seleção', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    const before = store.getState().selection
    a.setSelectionOffset({ x: 0, y: 0 })
    a.moveSelection(0, 0)
    expect(opsSent()).toEqual([])
    expect(store.getState().selection).toBe(before)
    expect(store.getState().selectionOffset).toBeNull()
  })

  it('apagar envia o lote e desfaz a seleção', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.deleteSelection()
    expect(opsSent()[0].op.ops.map((o: { kind: string }) => o.kind)).toEqual(['delete', 'delete', 'create'])
    expect(store.getState().selection).toBeNull()
  })

  it('mais de 200 sub-ações: aviso, nada enviado, seleção mantida', () => {
    const many = Array.from({ length: 201 }, (_, i) => tokenAt(`k${i}`, 60, 40, { layerId: 'tokens' }))
    const store = connected(many)
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.deleteSelection()
    expect(opsSent()).toEqual([])
    expect(store.getState().toasts.at(-1)?.text).toBe('Seleção grande demais; selecione menos itens')
    expect(store.getState().selection?.whole).toHaveLength(201)
  })

  it('trocar de ferramenta ou de camada desfaz; com "Todas as camadas", trocar de camada mantém', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setTool('select')
    expect(store.getState().selection).not.toBeNull()
    a.setTool('hand')
    expect(store.getState().selection).toBeNull()
    a.setTool('select')
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setActiveLayer('drawings')
    expect(store.getState().selection).toBeNull()
    a.setSelectAllLayers(true)
    a.setActiveLayer('tokens')
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setActiveLayer('drawings')
    expect(store.getState().selection).not.toBeNull()
    a.select('t1')
    expect(store.getState().selection).toBeNull()
  })

  it('item apagado por outra pessoa no meio do arrasto sai da seleção; soltar move só o resto', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setSelectionOffset({ x: 10, y: 100 })
    sock().receive({ t: 'op', by: 'bia', op: { kind: 'delete', id: 't1' } })
    expect(store.getState().selection?.whole).toEqual([])
    a.moveSelection(10, 100)
    expect(opsSent()[0].op.ops.map((o: { kind: string }) => o.kind)).toEqual(['delete', 'create', 'create'])
  })

  it('movido por outra pessoa sai; mensagem que não muda a forma não tira', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(-10, 0, 300, 100), false)
    expect(store.getState().selection?.whole.sort()).toEqual(['l', 't1'])
    sock().receive({ t: 'op', by: 'bia', op: { kind: 'upsert', object: { ...t1, title: 'Goblin' } } })
    expect(store.getState().selection?.whole.sort()).toEqual(['l', 't1'])
    sock().receive({ t: 'op', by: 'bia', op: { kind: 'upsert', object: { ...t1, x: 5 } } })
    expect(store.getState().selection?.whole).toEqual(['l'])
  })

  it('opções do Selecionar ficam no localStorage', () => {
    const store = connected()
    store.getState().actions.setSelectShape('lasso')
    store.getState().actions.setSelectAllLayers(true)
    const again = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
    expect(again.getState()).toMatchObject({ selectShape: 'lasso', selectAllLayers: true })
  })
})
```

Run: `pnpm --filter @mesa/web exec vitest run test/selection-store.test.ts`
Expected: FAIL (`selectArea is not a function`).

- [ ] **Step 2: Estado e reducers**

Em `apps/web/src/store/state.ts`:
1. Acrescente `import type { Selection, SelectShape } from '../selection/model'`.
2. No fim de `TableState` (depois dos campos existentes, inclusive os do plano de turnos):

```ts
  /** Seleção em área (retângulo/laço). `selectedId` continua sendo o clique num item só. */
  selection: Selection | null
  /** Arrasto do grupo em andamento (só local): deslocamento desde o início, em coordenadas do mapa. */
  selectionOffset: Point | null
  /** Menu do botão direito sobre a seleção (posição na tela). */
  selectionMenu: { x: number; y: number } | null
  /** Opções do Selecionar (guardadas no localStorage). */
  selectShape: SelectShape
  selectAllLayers: boolean
```

3. No fim do objeto de `makeInitialState()`:

```ts
    selection: null,
    selectionOffset: null,
    selectionMenu: null,
    selectShape: 'rect',
    selectAllLayers: false,
```

4. Depois de `makeInitialState`:

```ts
/** Campos que desfazem a seleção em área. */
export const NO_SELECTION: Pick<TableState, 'selection' | 'selectionOffset' | 'selectionMenu'> = {
  selection: null,
  selectionOffset: null,
  selectionMenu: null,
}
```

Em `apps/web/src/store/reducers.ts`:
1. Troque `import type { LocalPrev, PendingOp, TableState, Toast } from './state'` por `import { NO_SELECTION, type LocalPrev, type PendingOp, type TableState, type Toast } from './state'`.
2. `withActiveLayer` também desfaz a seleção (salvo com "Todas as camadas"):

```ts
function withActiveLayer<S extends TableState>(s: S, prev: Layer[]): S {
  const activeLayerId = pickActiveLayer(prev, s.layers, s.activeLayerId, s.self?.role)
  if (activeLayerId === s.activeLayerId) return s
  // A camada ativa mudou: a seleção em área só sobrevive com "Todas as camadas".
  return { ...s, activeLayerId, selectedId: null, ...(s.selectAllLayers ? {} : NO_SELECTION) }
}
```

3. Em `rejectBatch`, a última linha passa a desfazer a seleção:

```ts
  return addToast({ ...next, ...NO_SELECTION }, p.isUndo ? 'Não foi possível desfazer' : (p.failText ?? rejectText(p.op, reason)))
```

Crie `apps/web/src/selection/reconcile.ts`:

```ts
import type { TableObject } from '@mesa/shared'
import type { TableState } from '../store/state'
import { dropFromSelection } from './model'

/** Mesmo lugar, tamanho, rotação, camada e desenho: o objeto continua valendo para a seleção. */
function sameShape(a: TableObject, b: TableObject): boolean {
  if (a === b) return true
  if (a.x !== b.x || a.y !== b.y || a.width !== b.width || a.height !== b.height || a.rotation !== b.rotation || a.layerId !== b.layerId) {
    return false
  }
  return a.type !== 'stroke' || b.type !== 'stroke' || JSON.stringify(a.segments) === JSON.stringify(b.segments)
}

/** Item selecionado que outra pessoa apagou, moveu ou mudou de camada sai da seleção na hora. */
export function reconcileSelection<S extends TableState>(prev: S, next: S): S {
  const sel = next.selection
  if (!sel || next.objects === prev.objects) return next
  const gone = new Set<string>()
  for (const id of [...sel.whole, ...Object.keys(sel.parts)]) {
    const before = prev.objects[id]
    const after = next.objects[id]
    if (!before || !after || !sameShape(before, after)) gone.add(id)
  }
  if (gone.size === 0) return next
  const selection = dropFromSelection(sel, gone, next.objects)
  return selection ? { ...next, selection } : { ...next, selection: null, selectionOffset: null, selectionMenu: null }
}
```

- [ ] **Step 3: Ações da store**

Em `apps/web/src/store/tableStore.ts`:
1. Imports: acrescente `type Control` ao import de tipos de `'@mesa/shared'`; `NO_SELECTION` ao import de `'./state'`; `isLockedByOther` ao import de `'./reducers'`; e:

```ts
import { addArea, collectSelection, selectionOfIds, type SelectContext, type SelectionArea, type SelectShape } from '../selection/model'
import { planControl, planDelete, planMove, planToLayer, type PlanInput } from '../selection/plan'
import { reconcileSelection } from '../selection/reconcile'
import { loadSelectPrefs, saveSelectPrefs } from '../lib/selectPrefs'
```

2. Em `TableActions`, no fim:

```ts
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
```

3. Em `connect`, no `onMessage`, a linha `set((s) => reduceServer(s, msg, Date.now()))` vira:

```ts
            set((s) => reconcileSelection(s, reduceServer(s, msg, Date.now())))
```

4. Dentro do callback do `createStore`, antes de `const actions: TableActions = {`:

```ts
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
```

5. Ajustes nas ações existentes:

```ts
      setTool(tool) {
        if (tool !== 'ruler') actions.rulerCancel()
        const s = get()
        set({ tool, selectedId: tool === 'select' ? s.selectedId : null, ...(tool === s.tool ? {} : NO_SELECTION) })
      },
      setPen(penMode) {
        actions.rulerCancel()
        set({ tool: 'pencil', penMode, selectedId: null, ...NO_SELECTION })
      },
```

Em `setActiveLayer`, a última linha vira `set({ activeLayerId, selectedId: null, ...(s.selectAllLayers ? {} : NO_SELECTION) })`. Em `createLayer`, `set({ activeLayerId: id, selectedId: null })` vira `set({ activeLayerId: id, selectedId: null, ...(get().selectAllLayers ? {} : NO_SELECTION) })`. Em `setShapeKind`, acrescente `...NO_SELECTION` ao `set`. `select` e `openObjectMenu`:

```ts
      // Clique num item (ou no vazio) desfaz a seleção em área.
      select: (selectedId) => set({ selectedId, ...NO_SELECTION }),
```

e em `openObjectMenu`: `set({ objectMenu: { objectId, x, y }, selectedId: objectId, ...NO_SELECTION })`.

6. Ações novas (no fim do objeto `actions`):

```ts
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
```

7. O estado inicial lê as opções: `return { ...makeInitialState(), actions }` vira:

```ts
    return { ...makeInitialState(), ...loadSelectPrefs(), actions }
```

Run: `pnpm --filter @mesa/web exec vitest run test/selection-store.test.ts`
Expected: PASS.

- [ ] **Step 4: Teclado e menu do Selecionar**

Em `apps/web/src/ui/useKeyboard.ts`, dentro de `onKey`:

```ts
      const { actions, selectedId, selection } = store.getState()
      // ...
        case 'escape':
          actions.rulerCancel()
          actions.clearSelection()
          break
        case 'delete':
        case 'backspace':
          if (selection) actions.deleteSelection()
          else if (selectedId) {
            actions.submit({ kind: 'delete', id: selectedId })
            actions.select(null)
          }
          break
```

Crie `apps/web/src/ui/SelectPopover.tsx`:

```tsx
import { useRef } from 'react'
import { Lasso, SquareDashed } from 'lucide-react'
import { useTable, useTableActions } from '../store/context'
import { useDismiss } from './useDismiss'
import type { HoverMenuBinding } from './useHoverMenu'

export function SelectPopover({ onClose, hover }: { onClose: () => void; hover?: HoverMenuBinding }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose, hover?.anchor)
  const shape = useTable((s) => s.selectShape)
  const allLayers = useTable((s) => s.selectAllLayers)
  const actions = useTableActions()

  return (
    <div ref={ref} className="panel popover pen-popover" role="dialog" aria-label="Opções da seleção">
      <div className="field">
        <span>Forma da seleção</span>
        <div className="row">
          <button aria-pressed={shape === 'rect'} onClick={() => actions.setSelectShape('rect')}>
            <SquareDashed size={16} aria-hidden /> Retângulo
          </button>
          <button aria-pressed={shape === 'lasso'} onClick={() => actions.setSelectShape('lasso')}>
            <Lasso size={16} aria-hidden /> Laço
          </button>
        </div>
      </div>
      <label>
        <input type="checkbox" checked={allLayers} onChange={(e) => actions.setSelectAllLayers(e.target.checked)} /> Todas as camadas
      </label>
      <small>Arraste no vazio para selecionar; Shift soma outra área.</small>
    </div>
  )
}
```

Em `apps/web/src/ui/Toolbar.tsx`:
1. `import { SelectPopover } from './SelectPopover'`.
2. `useHoverMenus<'pen' | 'shape' | 'grid'>()` vira `useHoverMenus<'select' | 'pen' | 'shape' | 'grid'>()`; o parâmetro de `openOnContextMenu` vira `(id: 'select' | 'pen' | 'shape' | 'grid')`.
3. Junto dos outros anchors: `const selectAnchor = useRef<HTMLDivElement>(null)` e `const selectHover = useMemo<HoverMenuBinding>(() => ({ anchor: selectAnchor }), [])`.
4. O botão "Selecionar (V)" passa a ficar num anchor com o popover:

```tsx
      <div className="pen-anchor" ref={selectAnchor} {...menus.trigger('select')}>
        <button
          aria-label="Selecionar (V)"
          title="Selecionar (V): passe o mouse para a forma da seleção e o alcance"
          aria-pressed={tool === 'select'}
          aria-haspopup="dialog"
          aria-expanded={menus.open === 'select'}
          onClick={() => actions.setTool('select')}
          onContextMenu={openOnContextMenu('select')}
        >
          <MousePointer2 size={ICON} aria-hidden />
        </button>
        {menus.open === 'select' && (
          <div className="popover-bridge">
            <SelectPopover onClose={menus.close} hover={selectHover} />
          </div>
        )}
      </div>
```

- [ ] **Step 5: Verificar o repositório inteiro**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde (o canvas ainda não usa a seleção; os e2e antigos não mudam).

- [ ] **Step 6: Commit**

```bash
git add apps/web/src apps/web/test/selection-store.test.ts
git commit -m "feat(selecao): seleção na store, Esc/Delete e menu do Selecionar" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Canvas: área, realce, arrasto do grupo e menu do grupo

**Files:**
- Create: `apps/web/src/canvas/useSelectTool.ts`, `apps/web/src/canvas/SelectionLayer.tsx`, `apps/web/src/ui/SelectionContextMenu.tsx`
- Modify: `apps/web/src/canvas/TableCanvas.tsx`, `apps/web/src/canvas/ImageNode.tsx`, `apps/web/src/canvas/ShapeNode.tsx`, `apps/web/src/canvas/StrokeNode.tsx`, `apps/web/src/canvas/ObjectDecorations.tsx`, `apps/web/src/ui/ObjectContextMenu.tsx`, `apps/web/src/ui/TablePage.tsx`
- Test: `e2e/table.spec.ts`

**Interfaces:**
- Consumes: Task 1 (`rectFromPoints`); Task 3 (`pointInBox`, `type SelectionArea`, `worldSegments` não é preciso); Task 4 (ações `selectArea`, `select`, `ping`, `setSelectionOffset`, `moveSelection`, `deleteSelection`, `selectionToLayer`, `selectionControl`, `openSelectionMenu`, `closeSelectionMenu`; estado `selection`, `selectionOffset`, `selectionMenu`, `selectShape`).
- Produces: `useSelectTool(): { area: SelectionArea | null; onDown(e): boolean; onMove(e): void; onUp(): void }`; `CLICK_SLOP_PX = 3`; `GRAB_PAD_PX = 6`; `SelectionLayer`; `SelectionContextMenu` (`aria-label="Menu da seleção"`); `PermissionsField` exportado de `ObjectContextMenu.tsx` com prop opcional `legend`.

- [ ] **Step 1: Testes e2e (falham)**

Em `e2e/table.spec.ts`, depois de `addStroke`/`objectIds`/`confirmDialog` (perto do fim dos helpers), acrescente os helpers:

```ts
/** Traço criado pela store a partir de pontos do mapa (com o zoom inicial, mapa = tela). */
async function addStrokeAt(page: Page, id: string, layerId: string, points: number[]): Promise<void> {
  const xs = points.filter((_, i) => i % 2 === 0)
  const ys = points.filter((_, i) => i % 2 === 1)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  const object = {
    id, type: 'stroke', layerId, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y, rotation: 0, zIndex: 1,
    segments: [points.map((v, i) => v - (i % 2 === 0 ? x : y))], color: '#ffffff', strokeWidth: 4,
  }
  await page.evaluate((o) => (window as any).__mesa.getState().actions.submit({ kind: 'create', object: o }), object)
  await page.waitForFunction(() => Object.keys((window as any).__mesa.getState().pending).length === 0)
}

/** Clica no Selecionar e afasta o mouse (o menu abre ao passar o mouse e fecha ao sair). */
async function pickSelect(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Selecionar (V)' }).click()
  await page.mouse.move(900, 600)
  await expect(page.getByRole('dialog', { name: 'Opções da seleção' })).toHaveCount(0)
}

async function selectOptions(page: Page, opts: { shape?: 'Retângulo' | 'Laço'; allLayers?: boolean }): Promise<void> {
  await page.getByRole('button', { name: 'Selecionar (V)' }).hover()
  const pop = page.getByRole('dialog', { name: 'Opções da seleção' })
  await expect(pop).toBeVisible()
  if (opts.shape) await pop.getByRole('button', { name: opts.shape }).click()
  if (opts.allLayers !== undefined) await pop.getByLabel('Todas as camadas').setChecked(opts.allLayers)
  await page.mouse.move(900, 600)
  await expect(pop).toHaveCount(0)
}

/** Arrasta pelos pontos (retângulo: início e fim; laço: o contorno). */
async function dragPath(page: Page, points: Array<[number, number]>, opts: { shift?: boolean } = {}): Promise<void> {
  if (opts.shift) await page.keyboard.down('Shift')
  await page.mouse.move(points[0][0], points[0][1])
  await page.mouse.down()
  for (const [x, y] of points.slice(1)) await page.mouse.move(x, y, { steps: 5 })
  await page.mouse.up()
  if (opts.shift) await page.keyboard.up('Shift')
}

const selectionOf = (page: Page) =>
  page.evaluate(() => {
    const sel = (window as any).__mesa.getState().selection
    return sel ? { whole: [...sel.whole].sort(), parts: Object.keys(sel.parts).sort() } : null
  })

const settled = (page: Page) =>
  page.waitForFunction(() => {
    const s = (window as any).__mesa.getState()
    return Object.keys(s.pending).length === 0 && s.undoStack.length > 0
  })
```

E os testes, no fim do arquivo:

```ts
test('seleção em retângulo corta o traço e move junto com o token; o outro vê; Ctrl+Z desfaz tudo', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(ana) // camada Tokens, centro da tela: x 605..675, y 325..395
  await addStrokeAt(ana, 'risco', 'tokens', [450, 300, 850, 300])
  await expect.poll(async () => (await objects(gm)).length).toBe(2)
  const [token] = (await objects(ana)).filter((o) => o.type === 'image')

  await pickSelect(ana)
  await dragPath(ana, [[550, 250], [720, 420]])
  expect(await selectionOf(ana)).toEqual({ whole: [token.id], parts: ['risco'] })

  await dragPath(ana, [[640, 360], [640, 510]]) // arrasta pelo token: move o grupo 150 px para baixo
  await expect.poll(async () => (await objects(gm)).filter((o) => o.type === 'stroke').length).toBe(2)
  const strokes = (await objects(gm)).filter((o) => o.type === 'stroke')
  const moved = strokes.find((o) => Math.round(o.y) === 450)!
  expect([Math.round(moved.x), Math.round(moved.width)]).toEqual([550, 170])
  expect(strokes.find((o) => Math.round(o.y) === 300)!.segments).toHaveLength(2)
  await expect.poll(async () => Math.round((await objects(gm)).find((o) => o.id === token.id)!.y)).toBe(Math.round(token.y + 150))

  await settled(ana)
  await ana.keyboard.press('Control+z')
  await expect.poll(() => objectIds(gm)).toEqual([token.id, 'risco'].sort())
  expect(Math.round((await objects(gm)).find((o) => o.id === token.id)!.y)).toBe(Math.round(token.y))
})

test('seleção em laço apaga só a parte de dentro do traço (Delete)', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await selectLayer(gm, 'Desenhos')
  await addStrokeAt(gm, 'linha', 'drawings', [300, 300, 700, 300])
  await expect.poll(async () => (await objects(ana)).length).toBe(1)
  await pickSelect(gm)
  await selectOptions(gm, { shape: 'Laço' })
  await dragPath(gm, [[450, 250], [550, 250], [550, 350], [450, 350], [452, 252]])
  expect(await selectionOf(gm)).toEqual({ whole: [], parts: ['linha'] })

  await gm.keyboard.press('Delete')
  await expect.poll(async () => (await objects(ana)).map((o) => [o.id === 'linha', o.segments?.length])).toEqual([[false, 2]])
})

test('seleção em todas as camadas: o mestre leva itens de duas camadas para o Mapa pelo menu do grupo', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await addStrokeAt(gm, 'a', 'drawings', [300, 300, 400, 300])
  await addStrokeAt(gm, 'b', 'tokens', [300, 350, 400, 350])
  await pickSelect(gm)
  await selectOptions(gm, { allLayers: true })
  await dragPath(gm, [[250, 250], [450, 400]])
  expect(await selectionOf(gm)).toEqual({ whole: ['a', 'b'], parts: [] })

  await gm.mouse.click(350, 325, { button: 'right' })
  const menu = gm.getByRole('dialog', { name: 'Menu da seleção' })
  await expect(menu).toContainText('2 itens selecionados')
  await menu.getByRole('button', { name: 'Mover para camada' }).click()
  await menu.getByRole('group', { name: 'Camadas de destino' }).getByRole('button', { name: 'Mapa', exact: true }).click()
  await expect.poll(async () => (await objects(ana)).map((o) => o.layerId)).toEqual(['map', 'map'])
})

test('seleção: jogador não pega o token do mestre', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await uploadToken(gm)
  await expect.poll(async () => (await objects(ana)).length).toBe(1)
  const [token] = await objects(gm)
  await pickSelect(ana)
  await dragPath(ana, [[550, 250], [720, 420]])
  expect(await selectionOf(ana)).toBeNull()
  await dragPath(ana, [[640, 360], [640, 500]])
  await ana.waitForTimeout(300)
  expect(Math.round((await objects(gm))[0].y)).toBe(Math.round(token.y))
})

test('seleção: Shift + arrastar soma; Shift + clique pinga sem mexer na seleção; Esc desfaz', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await addStrokeAt(ana, 'a', 'tokens', [300, 300, 400, 300])
  await addStrokeAt(ana, 'b', 'tokens', [300, 500, 400, 500])
  await pickSelect(ana)
  await dragPath(ana, [[250, 250], [450, 350]])
  expect(await selectionOf(ana)).toEqual({ whole: ['a'], parts: [] })
  await dragPath(ana, [[250, 450], [450, 550]], { shift: true })
  expect(await selectionOf(ana)).toEqual({ whole: ['a', 'b'], parts: [] })

  await ana.keyboard.down('Shift')
  await ana.mouse.click(600, 620)
  await ana.keyboard.up('Shift')
  await expect.poll(() => gm.evaluate(() => (window as any).__mesa.getState().pings.length)).toBe(1)
  expect(await selectionOf(ana)).toEqual({ whole: ['a', 'b'], parts: [] })

  await ana.keyboard.press('Escape')
  expect(await selectionOf(ana)).toBeNull()
})
```

Run: `pnpm e2e -g "seleção"`
Expected: FAIL (arrastar no vazio ainda não seleciona: `selectionOf` devolve `null`).

- [ ] **Step 2: Gesto do Selecionar**

Crie `apps/web/src/canvas/useSelectTool.ts`:

```ts
import { useRef, useState } from 'react'
import type { KonvaEventObject } from 'konva/lib/Node'
import { rectFromPoints, type Point } from '@mesa/shared'
import { useTableStore } from '../store/context'
import { pointInBox, type SelectionArea } from '../selection/model'

/** Abaixo disso (px de tela) o gesto é clique, não arrasto (o mesmo limiar da ferramenta Formas). */
export const CLICK_SLOP_PX = 3
/** Folga (px de tela) em volta da caixa da seleção para pegar o grupo. */
export const GRAB_PAD_PX = 6

type Gesture =
  | { kind: 'area'; additive: boolean; start: Point; end: Point; screen: Point; points: number[]; moved: boolean }
  | { kind: 'group'; start: Point; screen: Point; moved: boolean }

export function useSelectTool() {
  const store = useTableStore()
  const [area, setArea] = useState<SelectionArea | null>(null)
  const gesture = useRef<Gesture | null>(null)

  const areaOf = (g: Extract<Gesture, { kind: 'area' }>): SelectionArea =>
    store.getState().selectShape === 'lasso' ? { kind: 'lasso', points: [...g.points] } : { kind: 'rect', rect: rectFromPoints(g.start, g.end) }

  /** true = o gesto é da seleção (o resto do mousedown do Stage não roda). */
  const onDown = (e: KonvaEventObject<MouseEvent>): boolean => {
    const s = store.getState()
    if (s.tool !== 'select' || e.evt.button !== 0 || e.evt.ctrlKey || e.evt.metaKey) return false
    const stage = e.target.getStage()
    const pos = stage?.getRelativePointerPosition()
    if (!pos) return false
    const screen = { x: e.evt.clientX, y: e.evt.clientY }
    // A caixa tracejada é a seleção: apertar dentro dela pega o grupo.
    if (!e.evt.shiftKey && s.selection && pointInBox(pos, s.selection.bounds, GRAB_PAD_PX / s.viewport.scale)) {
      gesture.current = { kind: 'group', start: pos, screen, moved: false }
      return true
    }
    // Sem Shift, clicar num item é do próprio item (seleciona só ele).
    if (!e.evt.shiftKey && e.target !== stage) return false
    gesture.current = { kind: 'area', additive: e.evt.shiftKey, start: pos, end: pos, screen, points: [pos.x, pos.y], moved: false }
    return true
  }

  const onMove = (e: KonvaEventObject<MouseEvent>) => {
    const g = gesture.current
    if (!g) return
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (!pos) return
    if (!g.moved && Math.hypot(e.evt.clientX - g.screen.x, e.evt.clientY - g.screen.y) < CLICK_SLOP_PX) return
    g.moved = true
    if (g.kind === 'group') {
      store.getState().actions.setSelectionOffset({ x: pos.x - g.start.x, y: pos.y - g.start.y })
      return
    }
    g.end = pos
    g.points.push(pos.x, pos.y)
    setArea(areaOf(g))
  }

  const onUp = () => {
    const g = gesture.current
    if (!g) return
    gesture.current = null
    const { actions, selectionOffset } = store.getState()
    if (g.kind === 'group') {
      if (g.moved && selectionOffset) actions.moveSelection(selectionOffset.x, selectionOffset.y)
      else actions.setSelectionOffset(null)
      return
    }
    setArea(null)
    if (!g.moved) {
      // Shift + clique: ping, sem mexer na seleção. Clique simples no vazio: desfaz a seleção.
      if (g.additive) actions.ping(g.start, false)
      else actions.select(null)
      return
    }
    actions.selectArea(areaOf(g), g.additive)
  }

  return { area, onDown, onMove, onUp }
}
```

- [ ] **Step 3: Camada de realce**

Crie `apps/web/src/canvas/SelectionLayer.tsx`:

```tsx
import { Fragment } from 'react'
import { Group, Layer, Line, Rect } from 'react-konva'
import { useTable } from '../store/context'
import type { SelectionArea } from '../selection/model'
import { rotatedBounds } from './bounds'

const HIGHLIGHT = '#4dabf7'
const AREA_FILL = 'rgba(77, 171, 247, 0.08)'

/** Realce das partes de dentro, caixa tracejada do grupo (segue o arrasto) e a área sendo desenhada. */
export function SelectionLayer({ area }: { area: SelectionArea | null }) {
  const selection = useTable((s) => s.selection)
  const offset = useTable((s) => s.selectionOffset)
  const objects = useTable((s) => s.objects)
  const scale = useTable((s) => s.viewport.scale)
  const k = 1 / scale

  return (
    <Layer listening={false}>
      {selection && (
        <Group x={offset?.x ?? 0} y={offset?.y ?? 0}>
          {Object.entries(selection.parts).map(([id, part]) => {
            const o = objects[id]
            if (!o || o.type !== 'stroke') return null
            return part.inside.map((points, i) => (
              <Fragment key={`${id}_${i}`}>
                <Line points={points} stroke={HIGHLIGHT} strokeWidth={o.strokeWidth + 6 * k} opacity={0.45} lineCap="round" lineJoin="round" />
                <Line points={points} stroke={o.color} strokeWidth={o.strokeWidth} lineCap="round" lineJoin="round" />
              </Fragment>
            ))
          })}
          {selection.whole.map((id) => {
            const o = objects[id]
            if (!o) return null
            const b = rotatedBounds(o)
            return <Rect key={id} x={b.minX} y={b.minY} width={b.maxX - b.minX} height={b.maxY - b.minY} stroke={HIGHLIGHT} strokeWidth={1.5 * k} opacity={0.8} />
          })}
          <Rect
            name="selection-box"
            x={selection.bounds.x}
            y={selection.bounds.y}
            width={selection.bounds.width}
            height={selection.bounds.height}
            stroke={HIGHLIGHT}
            strokeWidth={1.5 * k}
            dash={[6 * k, 4 * k]}
          />
        </Group>
      )}
      {area?.kind === 'rect' && (
        <Rect name="selection-area" {...area.rect} stroke={HIGHLIGHT} strokeWidth={1.5 * k} dash={[6 * k, 4 * k]} fill={AREA_FILL} />
      )}
      {area?.kind === 'lasso' && (
        <Line name="selection-area" points={area.points} closed stroke={HIGHLIGHT} strokeWidth={1.5 * k} dash={[6 * k, 4 * k]} fill={AREA_FILL} />
      )}
    </Layer>
  )
}
```

- [ ] **Step 4: Ligar no canvas**

Em `apps/web/src/canvas/TableCanvas.tsx`:
1. Imports: `import { pointInBox } from '../selection/model'`, `import { SelectionLayer } from './SelectionLayer'`, `import { GRAB_PAD_PX, useSelectTool } from './useSelectTool'`.
2. Junto de `const shapes = useShapeTool()`: `const select = useSelectTool()`.
3. Em `onContextMenu`, depois do `if (panning || ...) return`:

```ts
    const sel = store.getState().selection
    const pos = e.target.getStage()?.getRelativePointerPosition()
    if (tool === 'select' && sel && pos && pointInBox(pos, sel.bounds, GRAB_PAD_PX / viewport.scale)) {
      actions.openSelectionMenu(e.evt.clientX, e.evt.clientY)
      return
    }
```

4. `finishGesture` chama também `select.onUp()` (antes de `drawing.onUp()`).
5. O `onMouseDown` do `Stage` fica:

```tsx
      onMouseDown={(e) => {
        const pos = e.target.getStage()?.getRelativePointerPosition()
        // Com o Selecionar, Shift é da seleção (Shift + arrastar soma área); o ping do Shift + clique sai ao soltar.
        const selectShift = tool === 'select' && !panning && e.evt.shiftKey && !e.evt.ctrlKey && !e.evt.metaKey
        // Shift/Ctrl + clique: ping em qualquer ferramenta (inclusive Mão e Espaço), sem selecionar, desenhar nem medir.
        if (pos && e.evt.button === 0 && isPingClick(e.evt) && !selectShift) {
          actions.ping(pos, e.evt.ctrlKey || e.evt.metaKey)
          return
        }
        if (panning) return
        if (tool === 'ruler') {
          if (pos && e.evt.button === 0) actions.rulerClick(pos)
          if (pos && e.evt.button === 2) actions.rulerBend(pos)
          return
        }
        if (select.onDown(e)) return
        drawing.onDown(e)
        shapes.onDown(e)
      }}
```

(a linha antiga `if (tool === 'select' && e.target === e.target.getStage()) actions.select(null)` sai: o clique no vazio agora desfaz a seleção ao soltar, em `useSelectTool`).
6. No `onMouseMove`, dentro de `if (!panning) { ... }`, chame `select.onMove(e)` antes de `drawing.onMove(e)`.
7. Antes de `<Overlay />`: `<SelectionLayer area={select.area} />`.

- [ ] **Step 5: Nós seguem o grupo e saem do clique individual**

Em `ImageNode.tsx`, `ShapeNode.tsx` e `StrokeNode.tsx`, depois de `const layerEditable = ...`:

```ts
  // Na seleção em área, o item se move com o grupo (não sozinho) e não é selecionado pelo clique.
  const grouped = useTable((s) => !!s.selection && (s.selection.whole.includes(object.id) || object.id in s.selection.parts))
  const groupOffset = useTable((s) => (s.selectionOffset && s.selection?.whole.includes(object.id) ? s.selectionOffset : null))
```

Em `ImageNode` e `StrokeNode`, `interactive` ganha `&& !grouped`; em `ShapeNode`, `interactive` ganha `&& !grouped` (mantendo `!preview`). As posições passam a somar o deslocamento: `ImageNode` `x={g.x + (groupOffset?.x ?? 0)}` e `y={g.y + (groupOffset?.y ?? 0)}`; `ShapeNode`, em `common`, `x: g.x + (groupOffset?.x ?? 0)` e `y: g.y + (groupOffset?.y ?? 0)` (para `preview` o seletor devolve `null`, porque o id `shape-preview` nunca está na seleção); `StrokeNode` `x={pos.x + (groupOffset?.x ?? 0)}` e `y={pos.y + (groupOffset?.y ?? 0)}`.

Em `StrokeNode`, durante o arrasto do grupo o traço cortado mostra só os pedaços de fora (os de dentro andam na `SelectionLayer`):

```ts
  const draggedPart = useTable((s) => (s.selectionOffset ? s.selection?.parts[object.id] : undefined))
  // Prévia local da borracha sobrepõe o traço original; [] = apagado por inteiro.
  const shown =
    segments ??
    (draggedPart ? draggedPart.outside.map((seg) => seg.map((v, i) => v - (i % 2 === 0 ? object.x : object.y))) : object.segments)
```

(substitui a linha `const shown = segments ?? object.segments`).

Em `ObjectDecorations.tsx`, título e ícone seguem o grupo:

```ts
  const groupOffset = useTable((s) => (s.selectionOffset && s.selection?.whole.includes(object.id) ? s.selectionOffset : null))
  // ...
  const base = own ?? (lockedByOther && preview ? preview : object)
  const g = groupOffset ? { ...base, x: base.x + groupOffset.x, y: base.y + groupOffset.y } : base
```

(substitui `const g = own ?? (lockedByOther && preview ? preview : object)`; o seletor fica antes do `if (!object.title && !showNote) return null`).

- [ ] **Step 6: Menu do grupo**

Em `apps/web/src/ui/ObjectContextMenu.tsx`, exporte `PermissionsField` e dê a ele a legenda opcional:

```tsx
export function PermissionsField({
  objectId,
  control,
  onChange,
  legend = 'Permissões',
}: {
  objectId: string
  control: Control
  onChange: (control: Control) => void
  legend?: string
}) {
  // ... (igual)
      <legend>{legend}</legend>
```

Crie `apps/web/src/ui/SelectionContextMenu.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Layers, Trash2 } from 'lucide-react'
import type { ImageObject } from '@mesa/shared'
import { useTable, useTableActions } from '../store/context'
import { plural } from './confirm'
import { PermissionsField } from './ObjectContextMenu'
import { floatingStyle, useDismiss } from './useDismiss'

export function SelectionContextMenu() {
  const menu = useTable((s) => s.selectionMenu)
  const hasSelection = useTable((s) => !!s.selection)
  const actions = useTableActions()

  // Seleção desfeita com o menu aberto: o menu fecha.
  useEffect(() => {
    if (menu && !hasSelection) actions.closeSelectionMenu()
  }, [menu, hasSelection, actions])

  if (!menu || !hasSelection) return null
  return <SelectionMenuBody x={menu.x} y={menu.y} onClose={actions.closeSelectionMenu} />
}

function SelectionMenuBody({ x, y, onClose }: { x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(ref, onClose)
  const [layersOpen, setLayersOpen] = useState(false)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const selection = useTable((s) => s.selection)
  const objects = useTable((s) => s.objects)
  const layers = useTable((s) => s.layers)
  const actions = useTableActions()
  if (!selection) return null
  const count = selection.whole.length + Object.keys(selection.parts).length
  const tokens = selection.whole.map((id) => objects[id]).filter((o): o is ImageObject => o?.type === 'image')

  return (
    <div ref={ref} className="panel popover floating context-menu" role="dialog" aria-label="Menu da seleção" style={floatingStyle(x, y, 260)}>
      <small>{plural(count, 'item selecionado', 'itens selecionados')}</small>
      {isGm && (
        <div className="field">
          <button aria-expanded={layersOpen} onClick={() => setLayersOpen((v) => !v)}>
            <Layers size={16} aria-hidden /> Mover para camada <ChevronRight size={14} aria-hidden />
          </button>
          {layersOpen && (
            <div className="submenu" role="group" aria-label="Camadas de destino">
              {[...layers].reverse().map((layer) => (
                <button
                  key={layer.id}
                  onClick={() => {
                    actions.selectionToLayer(layer.id)
                    onClose()
                  }}
                >
                  {layer.name}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {isGm && tokens.length > 0 && (
        <PermissionsField
          objectId="selection"
          legend="Controle e permissões"
          control={tokens[0].control}
          onChange={(control) => actions.selectionControl(control)}
        />
      )}
      <button
        className="danger"
        onClick={() => {
          actions.deleteSelection()
          onClose()
        }}
      >
        <Trash2 size={16} aria-hidden /> Apagar
      </button>
    </div>
  )
}
```

Em `apps/web/src/ui/TablePage.tsx`: `import { SelectionContextMenu } from './SelectionContextMenu'` e, logo depois de `<ObjectContextMenu />`, `<SelectionContextMenu />`.

- [ ] **Step 7: Rodar os e2e da seleção**

Run: `pnpm e2e -g "seleção"`
Expected: PASS (5 testes).

- [ ] **Step 8: Verificar o repositório inteiro**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde (inclusive "token arrastado pelo mestre", ping com Ctrl e os testes de borracha e formas).

- [ ] **Step 9: Commit**

```bash
git add apps/web/src e2e/table.spec.ts
git commit -m "feat(selecao): área, realce, arrasto do grupo e menu da seleção no canvas" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Contorno do arrasto em grupo para os outros (presença)

**Files:**
- Modify: `packages/shared/src/protocol.ts`, `apps/worker/src/table-do.ts`, `apps/web/src/store/state.ts`, `apps/web/src/store/reducers.ts`, `apps/web/src/store/tableStore.ts`, `apps/web/src/selection/model.ts`, `apps/web/src/canvas/Overlay.tsx`
- Test: `packages/shared/test/protocol.test.ts`, `apps/worker/test/table-do.test.ts`, `apps/web/test/group-drag.test.ts` (novo), `apps/web/test/selection-store.test.ts`, `e2e/table.spec.ts`

**Interfaces:**
- Consumes: Task 4 (`setSelectionOffset`, `selection`, `selectionOffset`); Task 5 (o gesto chama `setSelectionOffset` a cada movimento).
- Produces: presença `{ kind: 'groupDrag'; x; y; width; height; layerIds: string[] }` e `{ kind: 'groupDragEnd' }`; `TableState.groupDrags: Record<string, Box>` (por clientId); `selectionLayerIds(sel: Selection, objects): string[]` em `selection/model.ts`.

- [ ] **Step 1: Testes (falham)**

Em `packages/shared/test/protocol.test.ts`, no fim:

```ts
describe('presença do arrasto em grupo', () => {
  const ok = (p: unknown) => ClientMessageSchema.safeParse({ t: 'presence', p }).success
  it('caixa com as camadas dos itens; fim sem dados', () => {
    expect(ok({ kind: 'groupDrag', x: 1, y: 2, width: 3, height: 4, layerIds: ['tokens'] })).toBe(true)
    expect(ok({ kind: 'groupDragEnd' })).toBe(true)
    expect(ok({ kind: 'groupDrag', x: 1, y: 2, width: 3, height: 4, layerIds: [] })).toBe(false)
    expect(ok({ kind: 'groupDrag', x: 1, y: 2, width: -3, height: 4, layerIds: ['tokens'] })).toBe(false)
  })
})
```

No fim de `apps/worker/test/table-do.test.ts`:

```ts
describe('TableDO — arrasto em grupo (presença)', () => {
  it('contorno vai só a quem vê todas as camadas dos itens; o fim vai a todos os outros', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    const box = { x: 10, y: 20, width: 30, height: 40 }
    gm.send({ t: 'presence', p: { kind: 'groupDrag', ...box, layerIds: ['tokens', 'gm'] } })
    await p.expectNone('presence')
    gm.send({ t: 'presence', p: { kind: 'groupDrag', ...box, layerIds: ['tokens'] } })
    expect((await p.waitFor('presence')).p).toEqual({ kind: 'groupDrag', ...box, layerIds: ['tokens'] })
    gm.send({ t: 'presence', p: { kind: 'groupDragEnd' } })
    expect((await p.waitFor('presence', (m) => m.p.kind === 'groupDragEnd')).p).toEqual({ kind: 'groupDragEnd' })
    await gm.expectNone('presence')
  })
})
```

Crie `apps/web/test/group-drag.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ServerMessage } from '@mesa/shared'
import { reduceServer } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Eu', color: '#e6194b', role: 'player', online: true }
const joined = (): TableState =>
  reduceServer(makeInitialState(), {
    t: 'welcome', self: me,
    snapshot: { meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS, objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  }, 0)
const drag = (clientId: string): ServerMessage => ({
  t: 'presence', clientId, p: { kind: 'groupDrag', x: 1, y: 2, width: 3, height: 4, layerIds: ['tokens'] },
})

describe('contorno do arrasto em grupo', () => {
  it('chega com a caixa; some no fim, quando a pessoa sai e quando o lote dela chega', () => {
    let s = reduceServer(joined(), drag('bia'), 0)
    expect(s.groupDrags).toEqual({ bia: { x: 1, y: 2, width: 3, height: 4 } })
    s = reduceServer(s, { t: 'presence', clientId: 'bia', p: { kind: 'groupDragEnd' } }, 0)
    expect(s.groupDrags).toEqual({})
    s = reduceServer(s, drag('bia'), 0)
    s = reduceServer(s, { t: 'memberLeft', clientId: 'bia' }, 0)
    expect(s.groupDrags).toEqual({})
    s = reduceServer(s, drag('bia'), 0)
    s = reduceServer(s, { t: 'batch', by: 'bia', ops: [] }, 0)
    expect(s.groupDrags).toEqual({})
  })
})
```

Em `apps/web/test/selection-store.test.ts`, dentro do `describe`:

```ts
  it('arrastar o grupo manda a caixa deslocada e as camadas; soltar manda o fim', () => {
    const store = connected()
    const a = store.getState().actions
    a.selectArea(rect(50, 0, 100, 100), false)
    a.setSelectionOffset({ x: 10, y: 100 })
    const presence = () => sock().sent.filter((m) => typeof m === 'object' && m.t === 'presence').map((m) => m.p)
    expect(presence()).toEqual([{ kind: 'groupDrag', x: 60, y: 140, width: 100, height: 20, layerIds: ['tokens'] }])
    a.moveSelection(10, 100)
    expect(presence().at(-1)).toEqual({ kind: 'groupDragEnd' })
  })
```

No fim de `e2e/table.spec.ts`:

```ts
test('seleção: quem assiste vê o contorno do grupo sendo arrastado, com o nome de quem arrasta', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const groupDrags = () => ana.evaluate(() => Object.keys((window as any).__mesa.getState().groupDrags).length)

  await addStrokeAt(gm, 'a', 'tokens', [300, 300, 400, 300])
  await addStrokeAt(gm, 'b', 'tokens', [300, 350, 400, 350])
  await pickSelect(gm)
  await dragPath(gm, [[250, 250], [450, 400]])
  await gm.mouse.move(350, 325)
  await gm.mouse.down()
  await gm.mouse.move(350, 425, { steps: 10 })
  await expect.poll(groupDrags).toBe(1)
  await gm.mouse.up()
  await expect.poll(groupDrags).toBe(0)
  await expect.poll(async () => (await objects(ana)).map((o) => Math.round(o.y)).sort()).toEqual([400, 450])
})
```

Run: `pnpm --filter @mesa/shared exec vitest run test/protocol.test.ts && pnpm --filter @mesa/web exec vitest run test/group-drag.test.ts test/selection-store.test.ts`
Expected: FAIL (`groupDrag` não está no `PresenceSchema`; `groupDrags` não existe).

- [ ] **Step 2: Protocolo e DO**

Em `packages/shared/src/protocol.ts`, no `PresenceSchema`, antes do `ping`:

```ts
  /** Contorno da seleção arrastada (caixa já deslocada) e as camadas dos itens, para o filtro de quem vê. */
  z.object({
    kind: z.literal('groupDrag'),
    x: z.number(),
    y: z.number(),
    width: z.number().nonnegative(),
    height: z.number().nonnegative(),
    layerIds: z.array(IdSchema).min(1).max(64),
  }),
  z.object({ kind: z.literal('groupDragEnd') }),
```

Em `apps/worker/src/table-do.ts`, junto dos outros limitadores: `private groupDragLimiter = new RateLimiter(RULER_RATE_PER_SEC, 1000)`. Em `onPresence`, no `switch (p.kind)`:

```ts
      case 'groupDrag':
        // Cada mensagem traz a caixa inteira: descartar excesso não perde estado.
        if (!this.groupDragLimiter.allow(att.clientId)) return
        this.broadcast(att.sessionId, (other) => (p.layerIds.every((id) => this.engine.canSeeLayer(other.role, id)) ? out : null))
        return
      case 'groupDragEnd':
        this.broadcast(att.sessionId, () => out)
        return
```

Run: `pnpm --filter @mesa/shared exec vitest run test/protocol.test.ts && pnpm --filter @mesa/worker test`
Expected: PASS.

- [ ] **Step 3: Cliente**

Em `apps/web/src/store/state.ts`: no fim de `TableState`, `/** Contornos de arrasto em grupo das outras pessoas, por clientId. */ groupDrags: Record<string, Box>` (acrescente `type Box` ao import de `'@mesa/shared'`); no fim de `makeInitialState()`, `groupDrags: {},`.

Em `apps/web/src/store/reducers.ts`:
- `case 'welcome'`: no objeto `base`, junto de `rulers: {}`, acrescente `groupDrags: {},`.
- `case 'batch'` vira:

```ts
    case 'batch': {
      const out = msg.ops.reduce((acc, op) => applyServerOp(acc, op, selfId), s)
      return { ...out, groupDrags: omit(out.groupDrags, msg.by) }
    }
```

- No `switch (p.kind)` de `case 'presence'`:

```ts
        case 'groupDrag': {
          const { kind: _k, layerIds: _l, ...box } = p
          return { ...s, groupDrags: { ...s.groupDrags, [msg.clientId]: box } }
        }
        case 'groupDragEnd':
          return { ...s, groupDrags: omit(s.groupDrags, msg.clientId) }
```

- Em `case 'memberLeft'` e `case 'memberRemoved'`, acrescente `groupDrags: omit(s.groupDrags, msg.clientId),`.

Em `apps/web/src/selection/model.ts`, no fim:

```ts
/** Camadas dos itens selecionados (o servidor só mostra o contorno a quem vê todas). */
export function selectionLayerIds(sel: Selection, objects: Record<string, TableObject>): string[] {
  const ids = new Set<string>()
  for (const id of [...sel.whole, ...Object.keys(sel.parts)]) {
    const o = objects[id]
    if (o) ids.add(o.layerId)
  }
  return [...ids]
}
```

Em `apps/web/src/store/tableStore.ts`:
1. Acrescente `type Box` ao import de tipos de `'@mesa/shared'` e `selectionLayerIds` ao import de `'../selection/model'`.
2. Em `createTableStore`, junto de `let authRetried = false` (escopo de fora, onde `sync` vive):

```ts
  let groupDragLive = false
  const groupDragThrottle = throttle((box: Box, layerIds: string[]) => {
    sync?.send({ t: 'presence', p: { kind: 'groupDrag', ...box, layerIds } })
  }, 33)
  /** Os outros param de ver o contorno (soltou, cancelou, a seleção sumiu ou o lote foi recusado). */
  const endGroupDrag = () => {
    if (!groupDragLive) return
    groupDragLive = false
    groupDragThrottle.cancel()
    sync?.send({ t: 'presence', p: { kind: 'groupDragEnd' } })
  }
```

3. `return createStore<TableStoreState>()((set, get) => { ... })` vira `const store = createStore<TableStoreState>()((set, get) => { ... })`, seguido de:

```ts
  // Qualquer caminho que zere o deslocamento (soltar, Esc, trocar de ferramenta, recusa) encerra o contorno.
  store.subscribe((s, prev) => {
    if (prev.selectionOffset && !s.selectionOffset) endGroupDrag()
  })
  return store
```

4. `setSelectionOffset` passa a mandar a caixa deslocada:

```ts
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
```

Em `apps/web/src/canvas/Overlay.tsx`: `const groupDrags = useTable((s) => s.groupDrags)` e, logo depois do bloco das travas (`Object.entries(locks)...`):

```tsx
      {Object.entries(groupDrags).map(([clientId, b]) => {
        if (clientId === selfId) return null
        const member = members[clientId]
        const color = member?.color ?? '#ffffff'
        return (
          <Group key={`group_${clientId}`} name="group-drag" x={b.x} y={b.y}>
            <Rect width={b.width} height={b.height} stroke={color} strokeWidth={2 / scale} dash={[6 / scale, 4 / scale]} />
            <Text text={member?.nickname ?? '?'} y={-16 / scale} fontSize={12 / scale} fill={color} />
          </Group>
        )
      })}
```

- [ ] **Step 4: Rodar os testes da task**

Run: `pnpm --filter @mesa/web exec vitest run test/group-drag.test.ts test/selection-store.test.ts && pnpm e2e -g "contorno do grupo"`
Expected: PASS.

- [ ] **Step 5: Verificar o repositório inteiro**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add packages/shared apps/worker apps/web/src apps/web/test e2e/table.spec.ts
git commit -m "feat(selecao): contorno do arrasto em grupo para os outros jogadores" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Borracha em todas as camadas

**Files:**
- Modify: `apps/web/src/canvas/eraser.ts`, `apps/web/src/canvas/useDrawingTools.ts`, `apps/web/src/store/state.ts`, `apps/web/src/store/tableStore.ts`, `apps/web/src/ui/PenPopover.tsx`
- Test: `apps/web/test/eraser.test.ts`, `e2e/table.spec.ts`

**Interfaces:**
- Consumes: Task 2 (`submitBatches`, `BATCH_MAX`, `type ObjectOp`); existentes `canUseLayer` (reducers), `planErase`.
- Produces: `EraseInput.layerIds?: ReadonlySet<string>`; `planErase(...)` devolve `{ previews; ops: ObjectOp[] }`; `chunk<T>(list: T[], size: number): T[][]` em `eraser.ts`; `TableState.eraseAllLayers: boolean`; ação `setEraseAllLayers(value: boolean)`; caixa "Todas as camadas" no menu da caneta em modo borracha.

- [ ] **Step 1: Testes (falham)**

Em `apps/web/test/eraser.test.ts`, acrescente `chunk` ao import de `'../src/canvas/eraser'` e, no fim:

```ts
describe('borracha em todas as camadas', () => {
  const other = stroke({ id: 's2', layerId: 'tokens' })

  it('sem layerIds só corta a camada ativa; com layerIds, todas as da lista', () => {
    expect(planErase(input({ objects: [stroke(), other] })).ops.map((o) => (o.kind === 'create' ? '' : o.id))).toEqual(['s1'])
    const all = planErase(input({ objects: [stroke(), other], layerIds: new Set(['drawings', 'tokens']) }))
    expect(all.ops.map((o) => (o.kind === 'create' ? '' : o.id))).toEqual(['s1', 's2'])
    expect(Object.keys(all.previews)).toEqual(['s1', 's2'])
  })

  it('camada fora da lista (travada ou oculta para a pessoa) fica de fora', () => {
    const locked = stroke({ id: 's3', layerId: 'map' })
    const all = planErase(input({ objects: [stroke(), locked], layerIds: new Set(['drawings']) }))
    expect(all.ops.map((o) => (o.kind === 'create' ? '' : o.id))).toEqual(['s1'])
  })

  it('chunk divide em lotes de até N', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 2)).toEqual([])
  })
})
```

No fim de `e2e/table.spec.ts`:

```ts
test('borracha em todas as camadas corta traços de duas camadas numa passada', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const ana = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  await addStrokeAt(ana, 'a', 'drawings', [300, 300, 600, 300])
  await addStrokeAt(ana, 'b', 'tokens', [300, 330, 600, 330])
  await expect.poll(async () => (await objects(gm)).length).toBe(2)

  await ana.keyboard.press('e')
  await ana.getByRole('button', { name: 'Borracha (E)' }).hover()
  const pop = ana.getByRole('dialog', { name: 'Opções da caneta' })
  await pop.getByLabel('Todas as camadas').check()
  await ana.mouse.move(900, 600)
  await expect(pop).toHaveCount(0)

  await ana.mouse.move(450, 250)
  await ana.mouse.down()
  await ana.mouse.move(450, 380, { steps: 10 })
  await ana.mouse.up()
  await expect.poll(async () => (await objects(gm)).map((o) => `${o.id}:${o.segments?.length}`).sort()).toEqual(['a:2', 'b:2'])
})
```

Run: `pnpm --filter @mesa/web exec vitest run test/eraser.test.ts`
Expected: FAIL (`chunk` não existe; `layerIds` ignorado).

- [ ] **Step 2: Implementar**

Em `apps/web/src/canvas/eraser.ts`:
1. No import de `'@mesa/shared'`, troque `type Op` por `type ObjectOp`.
2. Em `EraseInput`, depois de `layerId: string`:

```ts
  /** "Todas as camadas": as camadas em que a pessoa pode apagar; ausente = só `layerId`. */
  layerIds?: ReadonlySet<string>
```

3. `planErase` passa a devolver `{ previews: Record<string, number[][]>; ops: ObjectOp[] }` (troque `const ops: Op[] = []` por `const ops: ObjectOp[] = []`) e o filtro de camada vira:

```ts
  const inScope = (layerId: string) => (input.layerIds ? input.layerIds.has(layerId) : layerId === input.layerId)
  // ...
    if (o.type !== 'stroke' || !inScope(o.layerId)) continue
```

4. No fim do arquivo:

```ts
/** Divide em listas de até `size` itens (lotes da borracha em todas as camadas). */
export function chunk<T>(list: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size))
  return out
}
```

Em `apps/web/src/store/state.ts`: no fim de `TableState`, `/** Borracha passa por traços de todas as camadas editáveis (não fica no localStorage). */ eraseAllLayers: boolean`; no fim de `makeInitialState()`, `eraseAllLayers: false,`.

Em `apps/web/src/store/tableStore.ts`: em `TableActions`, depois de `setEraseAll(value: boolean): void`, `setEraseAllLayers(value: boolean): void`; e a ação `setEraseAllLayers: (eraseAllLayers) => set({ eraseAllLayers }),` depois de `setEraseAll`.

Em `apps/web/src/canvas/useDrawingTools.ts`:
1. Imports: `import { BATCH_MAX, MAX_SEGMENT_NUMBERS, boundsOf, simplifyPoints } from '@mesa/shared'`, `import { canUseLayer, isLockedByOther } from '../store/reducers'`, `import { chunk, planErase } from './eraser'`.
2. `const erasing = useRef<{ layerId: string; layerIds: ReadonlySet<string> | null; path: number[] } | null>(null)`.
3. Em `plan()`, passe `layerIds: cur.layerIds ?? undefined` para `planErase`.
4. `finishErase`:

```ts
  const finishErase = () => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    const { ops } = plan()
    const allLayers = !!erasing.current?.layerIds
    erasing.current = null
    setErasePreview({})
    if (ops.length === 0) return
    const { actions } = store.getState()
    // Todas as camadas: os cortes vão em lote (até 200 por lote), num só passo de desfazer.
    if (allLayers) actions.submitBatches(chunk(ops, BATCH_MAX), 'Não foi possível apagar')
    else actions.submitGroup(ops)
  }
```

5. Em `onDown`, no ramo `if (s.penMode === 'erase')`:

```ts
      const layerIds = s.eraseAllLayers ? new Set(s.layers.filter((l) => canUseLayer(l, s.self?.role)).map((l) => l.id)) : null
      erasing.current = { layerId: s.activeLayerId, layerIds, path: [pos.x, pos.y] }
```

Em `apps/web/src/ui/PenPopover.tsx`: `const eraseAllLayers = useTable((s) => s.eraseAllLayers)` e, logo depois do campo "Modo" (antes do bloco `isGm && penMode === 'erase'`):

```tsx
      {penMode === 'erase' && (
        <div className="field">
          <span>Alcance</span>
          <label>
            <input type="checkbox" checked={eraseAllLayers} onChange={(e) => actions.setEraseAllLayers(e.target.checked)} /> Todas as camadas
          </label>
        </div>
      )}
```

- [ ] **Step 3: Rodar os testes da task**

Run: `pnpm --filter @mesa/web exec vitest run test/eraser.test.ts && pnpm e2e -g "borracha"`
Expected: PASS (inclusive "passada de borracha no meio de uma linha deixa 2 pedaços").

- [ ] **Step 4: Verificar o repositório inteiro**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src apps/web/test/eraser.test.ts e2e/table.spec.ts
git commit -m "feat(selecao): borracha em todas as camadas" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review (feito)

- **Cobertura do spec:** §2 menu do Selecionar e `localStorage` (T3 prefs, T4 popover), alcance e permissões (T3 `collectSelection`), inteiro vs. partes (T1, T3), corte só ao agir (T3 plan, T5 realce sem envio). §3 clique em item (T4 `select`, T5 nós), arrastar no vazio (T5), Shift soma (T3 `addArea`, T5), Shift + clique pinga (T5), clique fora/Esc (T4/T5), arrastar o grupo com encaixe (T3 `planMove`, T5), Delete (T4), menu do grupo (T5), Ctrl+Z (T2), limiar (T5), caixa sem alças (T5 `SelectionLayer`), trocar ferramenta/camada (T4), contorno para os outros (T6), borracha (T7). §4 lote: validação, atomicidade, coerência, idempotência, repasse filtrado num envio (T2); montagem (T3); 200 no navegador (T2 `submitBatches`); desfazer inverso (T2); otimismo e recusa com seleção desfeita (T2, T4). §5 geometria (T1). §6 bordas: recusa (T2/T4), item mudado por outra pessoa (T4 `reconcileSelection`), área vazia (T3), >200 (T2/T4), laço que se cruza (T1). §7 testes: geometria (T1), servidor (T2), navegador (T2–T4, T7), e2e (T5–T7).
- **Placeholders:** nenhum "TBD"/"semelhante à task N"; todo passo de código tem o código.
- **Tipos:** `ObjectOp`, `BatchOp`, `SelectionArea`, `Selection`, `SelectionPart`, `PlanInput`, `BatchPlan`, `NO_SELECTION`, `submitBatches(batches, failText)`, `selectionLayerIds`, `groupDrags` usados com os mesmos nomes e assinaturas em todas as tasks.
- **Review Focus:** os 5 itens têm teste na task dona (T4: mesmo lugar e item apagado no arrasto; T3: zigue-zague; T2: desfazer recusado e reconexão).
