# Mesa Virtual: controle de turnos (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar ao mestre uma ordem de turnos (iniciativa) salva com a mesa, vista por todos numa janela flutuante, operada só por ele, com entradas livres ou ligadas a tokens e anel pulsante no token da vez.

**Architecture:** O `shared` ganha `turns.ts`: modelo (`Turns`, `TurnEntry`), schemas das 11 ações e a função pura `applyTurnOp` (mesmas regras no servidor e na aplicação otimista do cliente). O protocolo junta as ações ao `OpSchema` (protocolo de ops existente: opId, idempotência, ack/reject), o `Snapshot` ganha `turns` e o servidor difunde `turnsUpdated { turns }` (estado completo) a todos. No Worker, o `TableStore` guarda os turnos numa linha única (`turns`), o `TableEngine` aplica as ações (só mestre; a rolagem usa o `uniformInt` dos dados) e o `TableDO` difunde. No cliente, `confirmedTurns` (servidor) + ops de turno pendentes = `turns` (como as camadas); a UI é uma janela própria (`ui/turns/`), um botão na barra, uma opção no menu do token e uma camada Konva com o anel.

**Tech Stack:** TypeScript 7, pnpm 12, Node 24, Zod 4, Cloudflare Workers + Durable Objects (SQLite), Wrangler 4.148, Vitest (shared/web 5.x; worker via `@cloudflare/vitest-pool-workers`), React 19, Vite 8, Konva 10.7 + react-konva 19.3, Zustand 5, nanoid, lucide-react 1.52, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-09-mesa-virtual-turnos-design.md` (o código atual em `main` vale mais que planos antigos).

**Decisões tomadas onde o spec é omisso (o executor não deve rediscutir):**
- `turnAdd` com `tokenId` só é aceito se o id for de um objeto **imagem existente** (senão `invalid`). Depois de ligado, apagar o token não mexe na entrada.
- `turnUpdate.patch.initiative` aceita `null` (limpa para "?"). No card, apagar o número e salvar limpa; texto inválido (não inteiro, fora de -99..999) deixa o campo marcado (`aria-invalid`) e não salva.
- **Duplicar:** a base é o nome sem um sufixo final " N" (`"Goblin 2"` → base `"Goblin"`); procura o primeiro `"base N"` livre a partir de 2; se passar de 32 caracteres, a base é cortada para o sufixo caber.
- `turnMove.index` precisa ser `< entries.length` (posição final do item na lista).
- `turnsRoll` sem ninguém para rolar (lista vazia ou, com `all: false`, ninguém sem valor) é `invalid`; os botões já aparecem desativados nesses casos.
- `turnPrev` na primeira entrada da rodada 1 vai para a última e a rodada continua 1.
- Ao ficar vazia no combate, a lista volta à preparação (`round: 1`, `currentId: null`) e `open` não muda.
- `Snapshot.turns` é **opcional no tipo** (o engine sempre preenche; o cliente cai no padrão sem ele). Isso evita reescrever as dezenas de fixtures de `welcome` nos testes e conflitos com o plano da seleção.
- O aviso "Encerrar" usa o modal do app com um terceiro botão (nova função `askChoice` em `ui/confirm.ts`; `askConfirm` continua booleano). Ordem dos botões: "Cancelar", "Encerrar e limpar" (vermelho), "Encerrar e manter participantes" (principal, recebe o foco: Enter mantém, o caminho menos destrutivo).
- Destaque ao passar o mouse num card ligado: elipse **tracejada azul** (`#9db4ff`, estática, só na tela de quem passa o mouse); anel da vez: elipse **dourada** (`#ffd43b`) pulsante, para todos que têm o token no estado (quem não enxerga a camada não recebe o objeto, então não vê o anel).
- Botões do card com nome acessível: `"Duplicar <nome>"`, `"Remover <nome>"`, `"Centralizar em <nome>"` (miniatura), `"Arrastar para reordenar"` (alça). Remover não pede confirmação (o spec não pede).
- "Adicionar à ordem de turnos" só aparece para o mestre e só em objeto `image`; com 50 entradas fica desativado (e a ação avisa "A ordem de turnos está cheia (máximo 50)").
- Preferências da janela por pessoa e por mesa em `localStorage`, chave `mesa:turns:<tableId>`, JSON `{ x, y, minimized }` (`x`/`y` `null` = posição padrão: centralizada, `top: 56px`, abaixo do nome da mesa).
- Janela: `z-index: 15` (acima dos painéis, abaixo de popovers e modais).
- A lógica nova fica em arquivos novos (`shared/src/turns.ts`, `web/src/store/turns.ts`, `web/src/ui/turns/*`, `web/src/canvas/TurnHighlights.tsx`, `web/src/canvas/turnRing.ts`); nos arquivos quentes (`protocol.ts`, `engine.ts`, `reducers.ts`, `table-do.ts`, `TableCanvas.tsx`) só entram ganchos curtos. O plano da seleção em área roda **depois** deste no mesmo branch: as ações de turno ficam no **fim** da lista do `OpSchema` e o gancho do engine fica logo após a checagem de mestre; o `batch` da seleção não deve aceitar ações de turno.

## Global Constraints

- **Texto da interface em pt-BR**; identificadores em inglês.
- **Nenhum travessão (`—` U+2014, `–` U+2013) em texto visível** (rótulos, títulos, `aria-label`, `title`, avisos, toasts). Use ":", ",", "·" ou ponto.
- **Nenhum diálogo nativo do navegador** (`window.confirm/alert/prompt`): confirmações pelo `askConfirm`/`askChoice` de `apps/web/src/ui/confirm.ts` (já há teste que varre `apps/web/src`).
- **Sem barras de rolagem nos modais e na janela de turnos**, exceto a rolagem **vertical** da lista de cards (com o estilo de rolagem do app); nunca rolagem horizontal.
- **Git:** branch atual (`main`). **Exatamente um commit por task**, mensagem com o trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (use `git commit -m "<assunto>" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`). **Nunca `git push`**, nunca `--amend`.
- **Ao fim de cada task, na raiz:** `pnpm typecheck`, `pnpm test` e `pnpm e2e` verdes.
- **E2E só na porta 8788:** `pnpm e2e` sobe o próprio wrangler (porta 8788, inspector 9788, build em `apps/web/dist-e2e`, estado em `apps/worker/.wrangler/e2e-state`). Nunca rode `pnpm build`, `pnpm host`, `pnpm dev:*`, nem mate processos na 8787 (servidor do usuário).
- Não adicione dependências nem troque versões.
- Valores do spec (copiados):
  - `Turns { open: boolean; phase: 'prep' | 'combat'; round: number (>= 1); currentId: Id | null; entries: TurnEntry[] }`; `TurnEntry { id: Id; name: string (1..32, sem espaços nas pontas); tokenId: Id | null; initiative: number | null (inteiro -99..999) }`; máximo **50** entradas; padrão `{ open: false, phase: 'prep', round: 1, currentId: null, entries: [] }`.
  - Ações (todas só do mestre; jogador → `forbidden`; fase errada, id inexistente ou dado inválido → `invalid`): `turnsOpen { open }`, `turnAdd { entry: { id, name, tokenId? } }`, `turnDuplicate { id, newId }`, `turnUpdate { id, patch: { name?, initiative? } }` (não reordena), `turnRemove { id }`, `turnMove { id, index }`, `turnsRoll { all }` (preparação; 1d20 imparcial; ordena do maior para o menor, estável), `turnsStart` (preparação, >= 1 entrada; combate, rodada 1, vez da primeira, abre a janela), `turnNext`/`turnPrev` (combate; virada soma/subtrai 1 na rodada, mínimo 1), `turnsEnd { keep }` (combate; `keep: false` limpa, `keep: true` zera iniciativas; preparação, rodada 1, sem vez).
  - Ações de turno **não entram** no desfazer (Ctrl+Z). Otimistas no cliente, exceto `turnsRoll` (espera o servidor). Ids gerados no cliente (adicionar, duplicar).
  - Interface: botão "Turnos" (lucide `Swords`) só do mestre; janela no topo, centralizada, ~320 px, arrastável pelo cabeçalho; minimizada: "Rodada N · Vez de: <nome>" (preparação: "Turnos · preparação"); "?" sem iniciativa; rodapé do mestre na preparação: campo + "Adicionar", "Rolar iniciativa", "Rolar de novo para todos", "Iniciar combate"; no combate: "Turno anterior", "Próximo turno", campo + "Adicionar", "Encerrar" → "Encerrar e limpar", "Encerrar e manter participantes", "Cancelar"; menu do token: "Adicionar à ordem de turnos" (nome = título do token ou "Token"; abre a janela se fechada).

## Review Focus

1. **Mestre clica "Próximo turno" duas vezes antes das respostas chegarem:** a vez avança duas casas e não pisca para trás quando o `ack`/`turnsUpdated` da primeira chegam → teste na Task 4 (`reducers-turns.test.ts`, "dois Próximo rápidos").
2. **Token da vez é apagado no meio do combate:** a entrada continua (sem miniatura) e o anel some, sem erro → testes nas Tasks 2 (engine) e 4 (`currentTurnToken`).
3. **Reconexão com ação de turno pendente que o servidor já aplicou (ack perdido):** a entrada não aparece duplicada depois do `welcome` → teste na Task 4.
4. **Duplicar uma entrada com nome de 32 caracteres:** o nome gerado cabe em 32 e o servidor aceita → teste na Task 1.
5. **Token na camada do Mestre ligado à ordem:** o jogador vê o nome na lista, mas sem miniatura nem anel → teste na Task 4 (`currentTurnToken` sem o objeto no estado do jogador).

---

## Mapa de arquivos

```
packages/shared/src/
  constants.ts   # + TURNS_MAX, TURN_NAME_MAX, INITIATIVE_MIN, INITIATIVE_MAX (T1)
  turns.ts       # NOVO (T1): schemas, tipos, DEFAULT_TURNS, defaultTurns, parseTurns, duplicateName, sortByInitiative, applyTurnOp, TURN_OP_KINDS
  protocol.ts    # T2: ações no OpSchema, isTurnOp, Snapshot.turns?, ServerMessage turnsUpdated
  index.ts       # T1: export * from './turns'
packages/shared/test/turns.test.ts        # NOVO (T1)
packages/shared/test/protocol.test.ts     # T2

apps/worker/src/engine/store.ts           # T2: getTurns/putTurns
apps/worker/src/engine/sql-store.ts       # T2: tabela turns
apps/worker/src/engine/memory-store.ts    # T2
apps/worker/src/engine/engine.ts          # T2: efeito 'turns', turnOp, snapshot.turns
apps/worker/src/table-do.ts               # T3: difusão turnsUpdated
apps/worker/test/{engine,sql-store,table-do}.test.ts, store-contract.ts

apps/web/src/store/state.ts               # T4: turns, confirmedTurns, turnHover
apps/web/src/store/turns.ts               # NOVO (T4): replayTurns, recomputeTurns, ackTurnOp, currentTurnToken, turnNameFor
apps/web/src/store/reducers.ts            # T2 (ganchos mínimos), T4 (lógica)
apps/web/src/store/tableStore.ts          # T4: addTokenToTurns, setTurnHover, focusObject
apps/web/src/ui/confirm.ts, ConfirmModal.tsx   # T5: askChoice (terceiro botão)
apps/web/src/ui/turns/format.ts           # NOVO (T5)
apps/web/src/ui/turns/windowPrefs.ts      # NOVO (T5)
apps/web/src/ui/turns/TurnsWindow.tsx     # NOVO (T5)
apps/web/src/ui/turns/TurnCard.tsx        # NOVO (T5)
apps/web/src/ui/Toolbar.tsx, TablePage.tsx, styles.css   # T5
apps/web/src/ui/ObjectContextMenu.tsx     # T6
apps/web/src/canvas/turnRing.ts           # NOVO (T6)
apps/web/src/canvas/TurnHighlights.tsx    # NOVO (T6)
apps/web/src/canvas/TableCanvas.tsx       # T6: <TurnHighlights />
apps/web/test/{reducers-turns,turns-actions,turns-format,turns-prefs,turn-ring}.test.ts, confirm.test.ts

e2e/table.spec.ts                         # T7
```

---

### Task 1: Shared: modelo, ações e regras dos turnos

**Files:**
- Create: `packages/shared/src/turns.ts`
- Modify: `packages/shared/src/constants.ts` (fim do arquivo)
- Modify: `packages/shared/src/index.ts`
- Test: `packages/shared/test/turns.test.ts`

**Interfaces:**
- Consumes: `IdSchema` (`model.ts`).
- Produces (exportados por `@mesa/shared`):
  - constantes `TURNS_MAX = 50`, `TURN_NAME_MAX = 32`, `INITIATIVE_MIN = -99`, `INITIATIVE_MAX = 999`;
  - `TurnNameSchema`, `InitiativeSchema`, `TurnEntrySchema`, `TurnsSchema`; tipos `TurnEntry`, `Turns`, `TurnPhase`;
  - schemas das ações: `TurnsOpenOpSchema`, `TurnAddOpSchema`, `TurnDuplicateOpSchema`, `TurnUpdateOpSchema`, `TurnRemoveOpSchema`, `TurnMoveOpSchema`, `TurnsRollOpSchema`, `TurnsStartOpSchema`, `TurnNextOpSchema`, `TurnPrevOpSchema`, `TurnsEndOpSchema`; tipo `TurnOp` (união dos 11); `TURN_OP_KINDS: ReadonlySet<string>`;
  - `DEFAULT_TURNS: Turns`, `defaultTurns(): Turns` (cópia nova), `parseTurns(raw: unknown): Turns`;
  - `duplicateName(entries: TurnEntry[], name: string): string`;
  - `sortByInitiative(entries: TurnEntry[]): TurnEntry[]` (decrescente, estável, `null` por último);
  - `applyTurnOp(turns: Turns, op: TurnOp, d20?: () => number): Turns | null` (`null` = ação inválida; sem `d20`, `turnsRoll` válido devolve `turns` sem mudar).

- [ ] **Step 1: Write the failing test**

Crie `packages/shared/test/turns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_TURNS,
  INITIATIVE_MAX,
  INITIATIVE_MIN,
  InitiativeSchema,
  TURNS_MAX,
  TURN_NAME_MAX,
  TurnAddOpSchema,
  TurnMoveOpSchema,
  TurnNameSchema,
  TurnUpdateOpSchema,
  TurnsSchema,
  applyTurnOp,
  duplicateName,
  parseTurns,
  sortByInitiative,
  type TurnEntry,
  type Turns,
} from '../src'

const entry = (id: string, name = id, initiative: number | null = null, tokenId: string | null = null): TurnEntry => ({
  id, name, tokenId, initiative,
})
const prep = (...entries: TurnEntry[]): Turns => ({ ...DEFAULT_TURNS, entries })
const combat = (currentId: string, round: number, ...entries: TurnEntry[]): Turns => ({
  open: true, phase: 'combat', round, currentId, entries,
})
const ids = (t: Turns | null) => t?.entries.map((e) => e.id)
const seq = (...values: number[]) => {
  let i = 0
  return () => values[i++]
}

describe('schemas dos turnos', () => {
  it('nome: apara as pontas, de 1 a 32 caracteres', () => {
    expect(TurnNameSchema.parse('  Goblin  ')).toBe('Goblin')
    expect(TurnNameSchema.safeParse('   ').success).toBe(false)
    expect(TurnNameSchema.safeParse('x'.repeat(TURN_NAME_MAX)).success).toBe(true)
    expect(TurnNameSchema.safeParse('x'.repeat(TURN_NAME_MAX + 1)).success).toBe(false)
  })

  it('iniciativa: inteiro de -99 a 999', () => {
    for (const ok of [INITIATIVE_MIN, 0, INITIATIVE_MAX]) expect(InitiativeSchema.safeParse(ok).success).toBe(true)
    for (const bad of [INITIATIVE_MIN - 1, INITIATIVE_MAX + 1, 1.5, Number.NaN]) expect(InitiativeSchema.safeParse(bad).success).toBe(false)
  })

  it('ações: turnAdd apara o nome e recusa campo extra; turnUpdate vazio ou fora do limite é recusado; null limpa', () => {
    expect(TurnAddOpSchema.parse({ kind: 'turnAdd', entry: { id: 'a', name: ' Ana ' } })).toEqual({
      kind: 'turnAdd', entry: { id: 'a', name: 'Ana' },
    })
    expect(TurnAddOpSchema.safeParse({ kind: 'turnAdd', entry: { id: 'a', name: 'Ana', extra: 1 } }).success).toBe(false)
    expect(TurnUpdateOpSchema.safeParse({ kind: 'turnUpdate', id: 'a', patch: {} }).success).toBe(false)
    expect(TurnUpdateOpSchema.safeParse({ kind: 'turnUpdate', id: 'a', patch: { initiative: 1000 } }).success).toBe(false)
    expect(TurnUpdateOpSchema.safeParse({ kind: 'turnUpdate', id: 'a', patch: { initiative: null } }).success).toBe(true)
    expect(TurnMoveOpSchema.safeParse({ kind: 'turnMove', id: 'a', index: -1 }).success).toBe(false)
  })

  it('estado: no máximo 50 entradas', () => {
    const many = Array.from({ length: TURNS_MAX + 1 }, (_, i) => entry(`e${i}`))
    expect(TurnsSchema.safeParse(prep(...many.slice(0, TURNS_MAX))).success).toBe(true)
    expect(TurnsSchema.safeParse(prep(...many)).success).toBe(false)
  })

  it('parseTurns: ausente, corrompido ou incoerente vira o padrão', () => {
    expect(parseTurns(null)).toEqual(DEFAULT_TURNS)
    expect(parseTurns({ open: 'sim' })).toEqual(DEFAULT_TURNS)
    expect(parseTurns(combat('zz', 1, entry('a')))).toEqual(DEFAULT_TURNS)
    expect(parseTurns(prep(entry('a'), entry('a')))).toEqual(DEFAULT_TURNS)
    const ok = combat('a', 2, entry('a', 'Ana', 12))
    expect(parseTurns(ok)).toEqual(ok)
  })
})

describe('duplicateName', () => {
  it('próximo número livre, a partir do nome sem o sufixo', () => {
    expect(duplicateName([entry('a', 'Goblin')], 'Goblin')).toBe('Goblin 2')
    expect(duplicateName([entry('a', 'Goblin'), entry('b', 'Goblin 2')], 'Goblin')).toBe('Goblin 3')
    expect(duplicateName([entry('a', 'Goblin'), entry('b', 'Goblin 2')], 'Goblin 2')).toBe('Goblin 3')
    expect(duplicateName([entry('a', 'Goblin'), entry('c', 'Goblin 3')], 'Goblin')).toBe('Goblin 2')
  })

  // Review Focus #4
  it('nome de 32 caracteres: corta a base para o sufixo caber', () => {
    const long = 'x'.repeat(TURN_NAME_MAX)
    const name = duplicateName([entry('a', long)], long)
    expect(name).toBe(`${'x'.repeat(TURN_NAME_MAX - 2)} 2`)
    expect(TurnNameSchema.safeParse(name).success).toBe(true)
  })
})

describe('sortByInitiative', () => {
  it('do maior para o menor; empate mantém a ordem; sem valor vai para o fim', () => {
    const sorted = sortByInitiative([entry('a', 'a', 5), entry('b', 'b', null), entry('c', 'c', 9), entry('d', 'd', 5)])
    expect(sorted.map((e) => e.id)).toEqual(['c', 'a', 'd', 'b'])
  })
})

describe('applyTurnOp', () => {
  it('turnsOpen abre e fecha em qualquer fase', () => {
    expect(applyTurnOp(DEFAULT_TURNS, { kind: 'turnsOpen', open: true })?.open).toBe(true)
    expect(applyTurnOp(combat('a', 3, entry('a')), { kind: 'turnsOpen', open: false })).toEqual({ ...combat('a', 3, entry('a')), open: false })
  })

  it('turnAdd: no fim, sem iniciativa; id repetido ou 51ª entrada → null', () => {
    const t = applyTurnOp(prep(entry('a')), { kind: 'turnAdd', entry: { id: 'b', name: 'Orc', tokenId: 't1' } })
    expect(t?.entries).toEqual([entry('a'), entry('b', 'Orc', null, 't1')])
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnAdd', entry: { id: 'a', name: 'X' } })).toBeNull()
    const full = prep(...Array.from({ length: TURNS_MAX }, (_, i) => entry(`e${i}`)))
    expect(applyTurnOp(full, { kind: 'turnAdd', entry: { id: 'z', name: 'Z' } })).toBeNull()
  })

  it('turnDuplicate: logo abaixo, mesmo token, sem iniciativa; no limite ou newId repetido → null', () => {
    const t = prep(entry('a', 'Orc', 15, 't1'), entry('b', 'Ana'))
    expect(applyTurnOp(t, { kind: 'turnDuplicate', id: 'a', newId: 'c' })?.entries).toEqual([
      entry('a', 'Orc', 15, 't1'), entry('c', 'Orc 2', null, 't1'), entry('b', 'Ana'),
    ])
    expect(applyTurnOp(t, { kind: 'turnDuplicate', id: 'a', newId: 'b' })).toBeNull()
    expect(applyTurnOp(t, { kind: 'turnDuplicate', id: 'zz', newId: 'c' })).toBeNull()
    const full = prep(...Array.from({ length: TURNS_MAX }, (_, i) => entry(`e${i}`)))
    expect(applyTurnOp(full, { kind: 'turnDuplicate', id: 'e0', newId: 'z' })).toBeNull()
  })

  it('turnUpdate edita sem reordenar; null limpa a iniciativa; id inexistente → null', () => {
    const t = prep(entry('a', 'a', 3), entry('b', 'b', 10))
    expect(ids(applyTurnOp(t, { kind: 'turnUpdate', id: 'a', patch: { initiative: 20 } }))).toEqual(['a', 'b'])
    expect(applyTurnOp(t, { kind: 'turnUpdate', id: 'a', patch: { name: 'Ana', initiative: null } })?.entries[0]).toEqual(entry('a', 'Ana'))
    expect(applyTurnOp(t, { kind: 'turnUpdate', id: 'zz', patch: { name: 'X' } })).toBeNull()
  })

  it('turnMove move para a posição; índice fora da lista → null', () => {
    const t = prep(entry('a'), entry('b'), entry('c'))
    expect(ids(applyTurnOp(t, { kind: 'turnMove', id: 'a', index: 2 }))).toEqual(['b', 'c', 'a'])
    expect(ids(applyTurnOp(t, { kind: 'turnMove', id: 'c', index: 0 }))).toEqual(['c', 'a', 'b'])
    expect(applyTurnOp(t, { kind: 'turnMove', id: 'a', index: 3 })).toBeNull()
  })

  it('turnsRoll: só quem está sem valor, ou todos; ordena do maior para o menor com empate estável', () => {
    const t = prep(entry('a'), entry('b', 'b', 12), entry('c'), entry('d'))
    // a=12, c=5, d=12 → a(12) b(12) d(12) c(5)
    expect(applyTurnOp(t, { kind: 'turnsRoll', all: false }, seq(12, 5, 12))?.entries.map((e) => `${e.id}:${e.initiative}`)).toEqual([
      'a:12', 'b:12', 'd:12', 'c:5',
    ])
    expect(ids(applyTurnOp(t, { kind: 'turnsRoll', all: true }, seq(1, 2, 3, 4)))).toEqual(['d', 'c', 'b', 'a'])
  })

  it('turnsRoll sem d20 (cliente) não muda nada; no combate, vazio ou sem quem rolar → null', () => {
    const t = prep(entry('a'))
    expect(applyTurnOp(t, { kind: 'turnsRoll', all: false })).toBe(t)
    expect(applyTurnOp(DEFAULT_TURNS, { kind: 'turnsRoll', all: true }, seq(1))).toBeNull()
    expect(applyTurnOp(prep(entry('a', 'a', 3)), { kind: 'turnsRoll', all: false }, seq(1))).toBeNull()
    expect(applyTurnOp(combat('a', 1, entry('a')), { kind: 'turnsRoll', all: true }, seq(1))).toBeNull()
  })

  it('turnsStart: combate, rodada 1, vez da primeira e abre a janela; sem entradas ou já no combate → null', () => {
    expect(applyTurnOp(prep(entry('a'), entry('b')), { kind: 'turnsStart' })).toEqual(combat('a', 1, entry('a'), entry('b')))
    expect(applyTurnOp(DEFAULT_TURNS, { kind: 'turnsStart' })).toBeNull()
    expect(applyTurnOp(combat('a', 1, entry('a')), { kind: 'turnsStart' })).toBeNull()
  })

  it('turnNext/turnPrev: viram a rodada nos dois sentidos, mínimo 1; na preparação → null', () => {
    const t = combat('a', 1, entry('a'), entry('b'))
    const n1 = applyTurnOp(t, { kind: 'turnNext' })!
    expect([n1.currentId, n1.round]).toEqual(['b', 1])
    const n2 = applyTurnOp(n1, { kind: 'turnNext' })!
    expect([n2.currentId, n2.round]).toEqual(['a', 2])
    const p1 = applyTurnOp(n2, { kind: 'turnPrev' })!
    expect([p1.currentId, p1.round]).toEqual(['b', 1])
    const p0 = applyTurnOp(t, { kind: 'turnPrev' })!
    expect([p0.currentId, p0.round]).toEqual(['b', 1])
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnNext' })).toBeNull()
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnPrev' })).toBeNull()
  })

  it('turnRemove: a da vez passa para a seguinte, ou a primeira sem mudar a rodada; vazia no combate volta à preparação', () => {
    const t = combat('b', 4, entry('a'), entry('b'), entry('c'))
    expect(applyTurnOp(t, { kind: 'turnRemove', id: 'b' })).toMatchObject({ currentId: 'c', round: 4 })
    expect(applyTurnOp({ ...t, currentId: 'c' }, { kind: 'turnRemove', id: 'c' })).toMatchObject({ currentId: 'a', round: 4 })
    expect(applyTurnOp(t, { kind: 'turnRemove', id: 'a' })).toMatchObject({ currentId: 'b' })
    expect(applyTurnOp(combat('a', 3, entry('a')), { kind: 'turnRemove', id: 'a' })).toEqual({ ...DEFAULT_TURNS, open: true })
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnRemove', id: 'a' })).toEqual(DEFAULT_TURNS)
    expect(applyTurnOp(t, { kind: 'turnRemove', id: 'zz' })).toBeNull()
  })

  it('turnsEnd: keep zera as iniciativas; sem keep limpa; ambos voltam à preparação; na preparação → null', () => {
    const t = combat('b', 3, entry('a', 'a', 15, 't1'), entry('b', 'b', 7))
    expect(applyTurnOp(t, { kind: 'turnsEnd', keep: true })).toEqual({
      open: true, phase: 'prep', round: 1, currentId: null, entries: [entry('a', 'a', null, 't1'), entry('b')],
    })
    expect(applyTurnOp(t, { kind: 'turnsEnd', keep: false })).toEqual({ ...DEFAULT_TURNS, open: true })
    expect(applyTurnOp(prep(entry('a')), { kind: 'turnsEnd', keep: true })).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mesa/shared exec vitest run test/turns.test.ts`
Expected: FAIL (`TurnNameSchema`/`applyTurnOp` etc. não exportados).

- [ ] **Step 3: Write minimal implementation**

No fim de `packages/shared/src/constants.ts`:

```ts

// Turnos
export const TURNS_MAX = 50
export const TURN_NAME_MAX = 32
export const INITIATIVE_MIN = -99
export const INITIATIVE_MAX = 999
```

Crie `packages/shared/src/turns.ts`:

```ts
import { z } from 'zod'
import { INITIATIVE_MAX, INITIATIVE_MIN, TURNS_MAX, TURN_NAME_MAX } from './constants'
import { IdSchema } from './model'

export const TurnNameSchema = z.string().trim().min(1).max(TURN_NAME_MAX)
export const InitiativeSchema = z.number().int().min(INITIATIVE_MIN).max(INITIATIVE_MAX)

export const TurnEntrySchema = z.strictObject({
  id: IdSchema,
  name: TurnNameSchema,
  tokenId: IdSchema.nullable(),
  initiative: InitiativeSchema.nullable(),
})
export type TurnEntry = z.infer<typeof TurnEntrySchema>

export const TurnsSchema = z.strictObject({
  open: z.boolean(),
  phase: z.enum(['prep', 'combat']),
  round: z.number().int().min(1),
  currentId: IdSchema.nullable(),
  entries: z.array(TurnEntrySchema).max(TURNS_MAX),
})
export type Turns = z.infer<typeof TurnsSchema>
export type TurnPhase = Turns['phase']

/** Mesa sem estado salvo. Não altere: use `defaultTurns()` para uma cópia. */
export const DEFAULT_TURNS: Turns = { open: false, phase: 'prep', round: 1, currentId: null, entries: [] }

export function defaultTurns(): Turns {
  return { ...DEFAULT_TURNS, entries: [] }
}

function isConsistent(t: Turns): boolean {
  const ids = new Set(t.entries.map((e) => e.id))
  if (ids.size !== t.entries.length) return false
  return t.phase === 'prep' ? t.currentId === null : t.currentId !== null && ids.has(t.currentId)
}

/** Lê o JSON guardado; ausente, inválido ou incoerente vira o padrão. */
export function parseTurns(raw: unknown): Turns {
  const parsed = TurnsSchema.safeParse(raw)
  return parsed.success && isConsistent(parsed.data) ? parsed.data : defaultTurns()
}

// ---- Ações (todas só do mestre; entram no OpSchema do protocolo)

export const TurnsOpenOpSchema = z.object({ kind: z.literal('turnsOpen'), open: z.boolean() })
export const TurnAddOpSchema = z.object({
  kind: z.literal('turnAdd'),
  entry: z.strictObject({ id: IdSchema, name: TurnNameSchema, tokenId: IdSchema.nullable().optional() }),
})
export const TurnDuplicateOpSchema = z.object({ kind: z.literal('turnDuplicate'), id: IdSchema, newId: IdSchema })
export const TurnUpdateOpSchema = z.object({
  kind: z.literal('turnUpdate'),
  id: IdSchema,
  patch: z
    .strictObject({ name: TurnNameSchema, initiative: InitiativeSchema.nullable() })
    .partial()
    .refine((p) => p.name !== undefined || p.initiative !== undefined, 'empty turn patch'),
})
export const TurnRemoveOpSchema = z.object({ kind: z.literal('turnRemove'), id: IdSchema })
export const TurnMoveOpSchema = z.object({
  kind: z.literal('turnMove'),
  id: IdSchema,
  index: z.number().int().min(0).max(TURNS_MAX - 1),
})
export const TurnsRollOpSchema = z.object({ kind: z.literal('turnsRoll'), all: z.boolean() })
export const TurnsStartOpSchema = z.object({ kind: z.literal('turnsStart') })
export const TurnNextOpSchema = z.object({ kind: z.literal('turnNext') })
export const TurnPrevOpSchema = z.object({ kind: z.literal('turnPrev') })
export const TurnsEndOpSchema = z.object({ kind: z.literal('turnsEnd'), keep: z.boolean() })

export type TurnOp =
  | z.infer<typeof TurnsOpenOpSchema>
  | z.infer<typeof TurnAddOpSchema>
  | z.infer<typeof TurnDuplicateOpSchema>
  | z.infer<typeof TurnUpdateOpSchema>
  | z.infer<typeof TurnRemoveOpSchema>
  | z.infer<typeof TurnMoveOpSchema>
  | z.infer<typeof TurnsRollOpSchema>
  | z.infer<typeof TurnsStartOpSchema>
  | z.infer<typeof TurnNextOpSchema>
  | z.infer<typeof TurnPrevOpSchema>
  | z.infer<typeof TurnsEndOpSchema>

export const TURN_OP_KINDS: ReadonlySet<string> = new Set<TurnOp['kind']>([
  'turnsOpen', 'turnAdd', 'turnDuplicate', 'turnUpdate', 'turnRemove', 'turnMove',
  'turnsRoll', 'turnsStart', 'turnNext', 'turnPrev', 'turnsEnd',
])

// ---- Regras (as mesmas no servidor e na aplicação otimista do cliente)

/** "Goblin" → "Goblin 2"; "Goblin 2" → "Goblin 3" (próximo número livre). Corta a base para caber em 32. */
export function duplicateName(entries: TurnEntry[], name: string): string {
  const base = name.replace(/ \d+$/, '') || name
  const taken = new Set(entries.map((e) => e.name))
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`
    const candidate = `${base.slice(0, TURN_NAME_MAX - suffix.length).trimEnd()}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
}

/** Do maior para o menor; empate mantém a ordem atual; sem iniciativa vai para o fim. */
export function sortByInitiative(entries: TurnEntry[]): TurnEntry[] {
  const rank = (e: TurnEntry) => e.initiative ?? Number.NEGATIVE_INFINITY
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(b.e) - rank(a.e) || a.i - b.i)
    .map((x) => x.e)
}

const indexOf = (turns: Turns, id: string) => turns.entries.findIndex((e) => e.id === id)

/**
 * Aplica uma ação de turno; `null` = inválida (fase errada, id inexistente, limite).
 * `d20` só existe no servidor: sem ele, um `turnsRoll` válido devolve `turns` sem mudar (o cliente espera o resultado).
 */
export function applyTurnOp(turns: Turns, op: TurnOp, d20?: () => number): Turns | null {
  const { entries } = turns
  switch (op.kind) {
    case 'turnsOpen':
      return { ...turns, open: op.open }
    case 'turnAdd': {
      if (entries.length >= TURNS_MAX || indexOf(turns, op.entry.id) !== -1) return null
      const added: TurnEntry = { id: op.entry.id, name: op.entry.name, tokenId: op.entry.tokenId ?? null, initiative: null }
      return { ...turns, entries: [...entries, added] }
    }
    case 'turnDuplicate': {
      const i = indexOf(turns, op.id)
      if (i === -1 || entries.length >= TURNS_MAX || indexOf(turns, op.newId) !== -1) return null
      const copy: TurnEntry = { id: op.newId, name: duplicateName(entries, entries[i].name), tokenId: entries[i].tokenId, initiative: null }
      return { ...turns, entries: [...entries.slice(0, i + 1), copy, ...entries.slice(i + 1)] }
    }
    case 'turnUpdate': {
      const i = indexOf(turns, op.id)
      if (i === -1) return null
      const updated: TurnEntry = {
        ...entries[i],
        ...(op.patch.name !== undefined ? { name: op.patch.name } : {}),
        ...(op.patch.initiative !== undefined ? { initiative: op.patch.initiative } : {}),
      }
      return { ...turns, entries: entries.map((e, j) => (j === i ? updated : e)) }
    }
    case 'turnRemove': {
      const i = indexOf(turns, op.id)
      if (i === -1) return null
      const rest = entries.filter((_, j) => j !== i)
      if (turns.phase === 'combat' && rest.length === 0) return { ...turns, phase: 'prep', round: 1, currentId: null, entries: [] }
      const currentId = turns.currentId === op.id ? (rest[i] ?? rest[0]).id : turns.currentId
      return { ...turns, entries: rest, currentId }
    }
    case 'turnMove': {
      const i = indexOf(turns, op.id)
      if (i === -1 || op.index >= entries.length) return null
      const rest = entries.filter((_, j) => j !== i)
      rest.splice(op.index, 0, entries[i])
      return { ...turns, entries: rest }
    }
    case 'turnsRoll': {
      if (turns.phase !== 'prep') return null
      const rolls = (e: TurnEntry) => op.all || e.initiative === null
      if (!entries.some(rolls)) return null
      if (!d20) return turns
      const rolled = entries.map((e) => (rolls(e) ? { ...e, initiative: d20() } : e))
      return { ...turns, entries: sortByInitiative(rolled) }
    }
    case 'turnsStart':
      if (turns.phase !== 'prep' || entries.length === 0) return null
      return { ...turns, open: true, phase: 'combat', round: 1, currentId: entries[0].id }
    case 'turnNext':
    case 'turnPrev': {
      if (turns.phase !== 'combat') return null
      const i = entries.findIndex((e) => e.id === turns.currentId)
      if (i === -1) return null
      if (op.kind === 'turnNext') {
        const wraps = i === entries.length - 1
        return { ...turns, currentId: entries[wraps ? 0 : i + 1].id, round: wraps ? turns.round + 1 : turns.round }
      }
      const wraps = i === 0
      return {
        ...turns,
        currentId: entries[wraps ? entries.length - 1 : i - 1].id,
        round: wraps ? Math.max(1, turns.round - 1) : turns.round,
      }
    }
    case 'turnsEnd':
      if (turns.phase !== 'combat') return null
      return {
        ...turns,
        phase: 'prep',
        round: 1,
        currentId: null,
        entries: op.keep ? entries.map((e) => ({ ...e, initiative: null })) : [],
      }
  }
}
```

Em `packages/shared/src/index.ts`, acrescente no fim:

```ts
export * from './turns'
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mesa/shared exec vitest run test/turns.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação completa na raiz**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde (nada fora do shared mudou).

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/turns.ts packages/shared/src/constants.ts packages/shared/src/index.ts packages/shared/test/turns.test.ts
git commit -m "feat(turnos): modelo, ações e regras da ordem de turnos no shared" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Protocolo, armazenamento e regras no engine

**Files:**
- Modify: `packages/shared/src/protocol.ts` (imports, `OpSchema`, `isTurnOp`, `Snapshot`, `ServerMessage`)
- Modify: `apps/worker/src/engine/store.ts`, `apps/worker/src/engine/sql-store.ts`, `apps/worker/src/engine/memory-store.ts`
- Modify: `apps/worker/src/engine/engine.ts`
- Modify: `apps/web/src/store/reducers.ts` (ganchos mínimos de compilação, trocados na Task 4)
- Test: `packages/shared/test/protocol.test.ts`, `apps/worker/test/store-contract.ts`, `apps/worker/test/sql-store.test.ts`, `apps/worker/test/engine.test.ts`

**Interfaces:**
- Consumes (Task 1): `TurnOp`, `Turns`, os 11 schemas de ação, `TURN_OP_KINDS`, `applyTurnOp`, `parseTurns`, `defaultTurns`, `DEFAULT_TURNS`; `uniformInt` (`dice.ts`).
- Produces:
  - `isTurnOp(op: Op): op is TurnOp` (`@mesa/shared`);
  - `Snapshot.turns?: Turns` (o engine sempre preenche);
  - `ServerMessage` `{ t: 'turnsUpdated'; turns: Turns }`;
  - `TableStore.getTurns(): Turns` (cópia; padrão se nunca gravado) e `TableStore.putTurns(turns: Turns): void`;
  - `OpEffect` `{ kind: 'turns'; turns: Turns }` (estado completo depois da ação).

- [ ] **Step 1: Write the failing tests**

Em `packages/shared/test/protocol.test.ts`, troque o import da linha 2 por:

```ts
import { ClientMessageSchema, ObjectPatchSchema, OpSchema, RULER_MAX_POINTS, TableObjectSchema, isObjectOp, isTurnOp, readChatReqId, readOpId } from '../src'
```

e acrescente no fim do arquivo:

```ts
describe('ações de turno no protocolo', () => {
  it('OpSchema aceita as ações de turno e isTurnOp as reconhece', () => {
    const ops = [
      { kind: 'turnsOpen', open: true },
      { kind: 'turnAdd', entry: { id: 'a', name: 'Ana', tokenId: 'tok1' } },
      { kind: 'turnDuplicate', id: 'a', newId: 'b' },
      { kind: 'turnUpdate', id: 'a', patch: { initiative: 12 } },
      { kind: 'turnRemove', id: 'a' },
      { kind: 'turnMove', id: 'a', index: 0 },
      { kind: 'turnsRoll', all: false },
      { kind: 'turnsStart' },
      { kind: 'turnNext' },
      { kind: 'turnPrev' },
      { kind: 'turnsEnd', keep: true },
    ]
    for (const op of ops) {
      const parsed = OpSchema.parse(op)
      expect(isTurnOp(parsed)).toBe(true)
      expect(isObjectOp(parsed)).toBe(false)
    }
    expect(isTurnOp(OpSchema.parse({ kind: 'delete', id: 'x' }))).toBe(false)
  })

  it('op de turno inválida no envelope é recusada (iniciativa fora do limite, nome vazio)', () => {
    const bad = [
      { kind: 'turnUpdate', id: 'a', patch: { initiative: 1000 } },
      { kind: 'turnAdd', entry: { id: 'a', name: '   ' } },
    ]
    for (const op of bad) expect(ClientMessageSchema.safeParse({ t: 'op', opId: 'op_1', op }).success).toBe(false)
  })
})
```

Em `apps/worker/test/store-contract.ts`, troque o import de `@mesa/shared` por:

```ts
import { CHAT_HISTORY_LIMIT, DEFAULT_LAYERS, DEFAULT_SETTINGS, DEFAULT_TURNS, type Turns } from '@mesa/shared'
```

e acrescente antes do `}` final de `checkStoreContract`:

```ts

  // Turnos: padrão, gravação inteira e retorno em cópia
  expect(store.getTurns()).toEqual(DEFAULT_TURNS)
  const turns: Turns = {
    open: true, phase: 'combat', round: 3, currentId: 'b',
    entries: [
      { id: 'a', name: 'Ana', tokenId: null, initiative: 12 },
      { id: 'b', name: 'Goblin', tokenId: 'tok1', initiative: 7 },
    ],
  }
  store.putTurns(turns)
  expect(store.getTurns()).toEqual(turns)
  store.getTurns().entries.pop()
  expect(store.getTurns().entries).toHaveLength(2)
```

Em `apps/worker/test/sql-store.test.ts`, troque o import de `@mesa/shared` por:

```ts
import { DEFAULT_TURNS, TableObjectSchema, type Turns } from '@mesa/shared'
```

e acrescente dentro do `describe('SqlStore — migração do M1', ...)`, depois do último `it`:

```ts
  it('turnos sobrevivem ao reinício (novo SqlStore na mesma base); JSON inválido vira o padrão', async () => {
    const stub = freshStub()
    const turns: Turns = {
      open: true, phase: 'combat', round: 2, currentId: 'a',
      entries: [{ id: 'a', name: 'Ana', tokenId: null, initiative: 7 }],
    }
    await runInDurableObject(stub, (_instance, state) => {
      new SqlStore(state.storage.sql).putTurns(turns)
    })
    await runInDurableObject(stub, (_instance, state) => {
      expect(new SqlStore(state.storage.sql).getTurns()).toEqual(turns)
    })
    await runInDurableObject(stub, (_instance, state) => {
      state.storage.sql.exec('INSERT OR REPLACE INTO turns (id, data) VALUES (1, ?)', JSON.stringify({ open: 'sim' }))
      expect(new SqlStore(state.storage.sql).getTurns()).toEqual(DEFAULT_TURNS)
    })
  })
```

Em `apps/worker/test/engine.test.ts`, troque a linha 2 por:

```ts
import { DEFAULT_LAYERS, DEFAULT_TURNS, LOCK_TTL_MS, MEMBER_RECENT_MS, TURNS_MAX, type NewObject, type ObjectPatch, type Op } from '@mesa/shared'
```

e acrescente no fim do arquivo:

```ts
describe('turnos', () => {
  const add = (id: string, name = id, tokenId?: string): Op => ({ kind: 'turnAdd', entry: { id, name, ...(tokenId ? { tokenId } : {}) } })
  const gmOp = (e: TableEngine, opId: string, op: Op) => e.applyOp('G', 'gm', opId, op)
  const turns = () => store.getTurns()
  const seq = (...values: number[]) => {
    let i = 0
    return () => values[i++]
  }
  const ALL_TURN_OPS: Op[] = [
    { kind: 'turnsOpen', open: true },
    add('x'),
    { kind: 'turnDuplicate', id: 'a', newId: 'b' },
    { kind: 'turnUpdate', id: 'a', patch: { name: 'X' } },
    { kind: 'turnRemove', id: 'a' },
    { kind: 'turnMove', id: 'a', index: 0 },
    { kind: 'turnsRoll', all: true },
    { kind: 'turnsStart' },
    { kind: 'turnNext' },
    { kind: 'turnPrev' },
    { kind: 'turnsEnd', keep: true },
  ]

  it('jogador: todas as ações de turno recusadas com forbidden e nada muda', () => {
    gmOp(engine, 'g0', add('a'))
    const before = turns()
    ALL_TURN_OPS.forEach((op, i) => {
      expect(engine.applyOp('A', 'player', `p${i}`, op)).toMatchObject({ ok: false, reason: 'forbidden' })
    })
    expect(turns()).toEqual(before)
  })

  it('mestre: efeito com o estado completo, gravado e entregue no snapshot de todos', () => {
    expect(engine.snapshot('player', new Set()).turns).toEqual(DEFAULT_TURNS)
    const r = gmOp(engine, 'g1', add('a', 'Ana'))
    const expected = { ...DEFAULT_TURNS, entries: [{ id: 'a', name: 'Ana', tokenId: null, initiative: null }] }
    expect(r).toMatchObject({ ok: true, duplicate: false, version: 0 })
    expect(effects(r)).toEqual([{ kind: 'turns', turns: expected }])
    expect(turns()).toEqual(expected)
    expect(engine.snapshot('player', new Set()).turns).toEqual(expected)
  })

  it('turnAdd ligado: só imagem existente; forma ou id inexistente → invalid', () => {
    gmOp(engine, 'c1', create(token()))
    gmOp(engine, 'c2', create(rect()))
    expect(gmOp(engine, 'g1', add('a', 'Token', 'tok1'))).toMatchObject({ ok: true })
    expect(gmOp(engine, 'g2', add('b', 'Forma', 'r1'))).toMatchObject({ ok: false, reason: 'invalid' })
    expect(gmOp(engine, 'g3', add('c', 'Sumiu', 'nope'))).toMatchObject({ ok: false, reason: 'invalid' })
    expect(turns().entries.map((e) => e.id)).toEqual(['a'])
  })

  it('rolagem com o d20 do gerador injetado: só sem valor, depois todos; empate mantém a ordem', () => {
    // uniformInt(20, rng) = x % 20 para x pequeno; +1 → 11 vira 12, 4 vira 5
    const e = new TableEngine(store, () => clock, seq(11, 4, 11, 0, 1, 2, 3))
    for (const id of ['a', 'b', 'c', 'd']) gmOp(e, `add_${id}`, add(id))
    gmOp(e, 'u1', { kind: 'turnUpdate', id: 'b', patch: { initiative: 12 } })
    gmOp(e, 'r1', { kind: 'turnsRoll', all: false })
    expect(turns().entries.map((x) => `${x.id}:${x.initiative}`)).toEqual(['a:12', 'b:12', 'd:12', 'c:5'])
    gmOp(e, 'r2', { kind: 'turnsRoll', all: true })
    // ordem antes da rolagem: a, b, d, c → 1, 2, 3, 4
    expect(turns().entries.map((x) => `${x.id}:${x.initiative}`)).toEqual(['c:4', 'd:3', 'b:2', 'a:1'])
  })

  it('fase errada, id inexistente, id repetido ou lista cheia → invalid, sem mudar nada', () => {
    expect(gmOp(engine, 'n1', { kind: 'turnNext' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(gmOp(engine, 's1', { kind: 'turnsStart' })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(gmOp(engine, 'x1', { kind: 'turnRemove', id: 'zz' })).toMatchObject({ ok: false, reason: 'invalid' })
    for (let i = 0; i < TURNS_MAX; i++) gmOp(engine, `a${i}`, add(`e${i}`))
    expect(gmOp(engine, 'same', add('e0'))).toMatchObject({ ok: false, reason: 'invalid' })
    expect(gmOp(engine, 'full', add('extra'))).toMatchObject({ ok: false, reason: 'invalid' })
    expect(gmOp(engine, 'dup', { kind: 'turnDuplicate', id: 'e0', newId: 'extra' })).toMatchObject({ ok: false, reason: 'invalid' })
    gmOp(engine, 'start', { kind: 'turnsStart' })
    expect(gmOp(engine, 'roll', { kind: 'turnsRoll', all: true })).toMatchObject({ ok: false, reason: 'invalid' })
    expect(turns().entries).toHaveLength(TURNS_MAX)
  })

  it('combate: rodada vira nos dois sentidos; remover a da vez; lista vazia volta à preparação', () => {
    for (const id of ['a', 'b', 'c']) gmOp(engine, `add_${id}`, add(id))
    gmOp(engine, 's', { kind: 'turnsStart' })
    expect(turns()).toMatchObject({ open: true, phase: 'combat', round: 1, currentId: 'a' })
    gmOp(engine, 'p1', { kind: 'turnPrev' })
    expect(turns()).toMatchObject({ round: 1, currentId: 'c' })
    gmOp(engine, 'n1', { kind: 'turnNext' })
    expect(turns()).toMatchObject({ round: 2, currentId: 'a' })
    gmOp(engine, 'p2', { kind: 'turnPrev' })
    expect(turns()).toMatchObject({ round: 1, currentId: 'c' })
    gmOp(engine, 'x1', { kind: 'turnRemove', id: 'c' }) // era a da vez e a última: vez passa à primeira, rodada igual
    expect(turns()).toMatchObject({ round: 1, currentId: 'a' })
    gmOp(engine, 'x2', { kind: 'turnRemove', id: 'a' })
    expect(turns()).toMatchObject({ currentId: 'b' })
    gmOp(engine, 'x3', { kind: 'turnRemove', id: 'b' })
    expect(turns()).toEqual({ ...DEFAULT_TURNS, open: true })
  })

  // Review Focus #2
  it('token apagado: a entrada continua com o tokenId', () => {
    gmOp(engine, 'c1', create(token()))
    gmOp(engine, 'g1', add('a', 'Token', 'tok1'))
    gmOp(engine, 'g2', { kind: 'turnsStart' })
    gmOp(engine, 'd1', { kind: 'delete', id: 'tok1' })
    expect(turns()).toMatchObject({ phase: 'combat', currentId: 'a', entries: [{ id: 'a', name: 'Token', tokenId: 'tok1', initiative: null }] })
  })

  it('turnsEnd: keep zera as iniciativas; sem keep limpa; ambos voltam à preparação', () => {
    for (const id of ['a', 'b']) gmOp(engine, `add_${id}`, add(id))
    gmOp(engine, 'u', { kind: 'turnUpdate', id: 'a', patch: { initiative: 9 } })
    gmOp(engine, 's1', { kind: 'turnsStart' })
    gmOp(engine, 'n1', { kind: 'turnNext' })
    gmOp(engine, 'e1', { kind: 'turnsEnd', keep: true })
    expect(turns()).toEqual({
      open: true, phase: 'prep', round: 1, currentId: null,
      entries: [{ id: 'a', name: 'a', tokenId: null, initiative: null }, { id: 'b', name: 'b', tokenId: null, initiative: null }],
    })
    gmOp(engine, 's2', { kind: 'turnsStart' })
    gmOp(engine, 'e2', { kind: 'turnsEnd', keep: false })
    expect(turns()).toEqual({ ...DEFAULT_TURNS, open: true })
  })

  it('opId repetido não reaplica: turnNext repetido avança uma vez só', () => {
    for (const id of ['a', 'b', 'c']) gmOp(engine, `add_${id}`, add(id))
    gmOp(engine, 's', { kind: 'turnsStart' })
    expect(gmOp(engine, 'n1', { kind: 'turnNext' })).toMatchObject({ ok: true, duplicate: false })
    expect(gmOp(engine, 'n1', { kind: 'turnNext' })).toEqual({ ok: true, duplicate: true, version: 0 })
    expect(turns().currentId).toBe('b')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mesa/shared exec vitest run test/protocol.test.ts`
Expected: FAIL (`isTurnOp` não exportado / `OpSchema` recusa `turnsOpen`).

Run: `pnpm --filter @mesa/worker test test/engine.test.ts test/sql-store.test.ts`
Expected: FAIL (`getTurns`/`putTurns` não existem; efeito `turns` ausente).

- [ ] **Step 3: Protocolo**

Em `packages/shared/src/protocol.ts`, acrescente depois do import de `./settings`:

```ts
import {
  TURN_OP_KINDS,
  TurnAddOpSchema,
  TurnDuplicateOpSchema,
  TurnMoveOpSchema,
  TurnNextOpSchema,
  TurnPrevOpSchema,
  TurnRemoveOpSchema,
  TurnUpdateOpSchema,
  TurnsEndOpSchema,
  TurnsOpenOpSchema,
  TurnsRollOpSchema,
  TurnsStartOpSchema,
  type TurnOp,
  type Turns,
} from './turns'
```

No `OpSchema`, depois de `ClearObjectsOpSchema,` (ações de turno sempre no **fim** da lista):

```ts
  ClearObjectsOpSchema,
  // Turnos (só o mestre): ver turns.ts
  TurnsOpenOpSchema,
  TurnAddOpSchema,
  TurnDuplicateOpSchema,
  TurnUpdateOpSchema,
  TurnRemoveOpSchema,
  TurnMoveOpSchema,
  TurnsRollOpSchema,
  TurnsStartOpSchema,
  TurnNextOpSchema,
  TurnPrevOpSchema,
  TurnsEndOpSchema,
])
```

Depois de `isObjectOp`:

```ts
export function isTurnOp(op: Op): op is TurnOp {
  return TURN_OP_KINDS.has(op.kind)
}
```

Na interface `Snapshot`, depois de `chat: ChatEntry[]`:

```ts
  /** Ordem de turnos, igual para todos. O servidor sempre envia; ausente = padrão (fixtures antigas). */
  turns?: Turns
```

Na união `ServerMessage`, depois da linha de `memberUpdated`:

```ts
  /** Estado completo dos turnos depois de cada ação; vai a todos, inclusive ao autor. */
  | { t: 'turnsUpdated'; turns: Turns }
```

- [ ] **Step 4: Armazenamento**

Em `apps/worker/src/engine/store.ts`, troque o import por:

```ts
import type { ChatEntry, Layer, Role, TableObject, TableSettings, Turns } from '@mesa/shared'
```

e acrescente no fim da interface `TableStore`:

```ts
  /** Padrão (DEFAULT_TURNS) quando nunca foi gravado; sempre devolve uma cópia. */
  getTurns(): Turns
  putTurns(turns: Turns): void
```

Em `apps/worker/src/engine/sql-store.ts`: no import de `@mesa/shared` acrescente `parseTurns` e `type Turns`; no construtor, depois da linha da tabela `chat`:

```ts
    sql.exec('CREATE TABLE IF NOT EXISTS turns (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)')
```

e no fim da classe:

```ts
  getTurns(): Turns {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM turns WHERE id = 1').toArray()[0]
    return parseTurns(row ? JSON.parse(row.data) : null)
  }

  putTurns(turns: Turns): void {
    this.sql.exec('INSERT OR REPLACE INTO turns (id, data) VALUES (1, ?)', JSON.stringify(turns))
  }
```

Em `apps/worker/src/engine/memory-store.ts`: no import acrescente `defaultTurns` e `type Turns`; campo depois de `chat`:

```ts
  private turns: Turns = defaultTurns()
```

e no fim da classe:

```ts
  getTurns() { return structuredClone(this.turns) }
  putTurns(turns: Turns) { this.turns = structuredClone(turns) }
```

- [ ] **Step 5: Engine**

Em `apps/worker/src/engine/engine.ts`:

1. No import de `@mesa/shared`, acrescente `applyTurnOp`, `isTurnOp`, `uniformInt`, `type TurnOp`, `type Turns`.
2. Na união `OpEffect`, depois de `objectsRemoved`:

```ts
  /** Estado completo dos turnos; todos recebem (não há filtro por destinatário). */
  | { kind: 'turns'; turns: Turns }
```

3. Em `snapshot(...)`, depois da linha `chat: ...`:

```ts
      turns: this.store.getTurns(),
```

4. Em `execute(...)`, logo depois de `if (role !== 'gm') return reject('forbidden', null)`:

```ts
    if (isTurnOp(op)) return this.turnOp(op)
```

5. Novo método, depois de `memberUpdate`:

```ts
  /** Turnos: regras puras do shared; a rolagem usa o mesmo sorteio imparcial dos dados. */
  private turnOp(op: TurnOp): OpResult {
    if (op.kind === 'turnAdd' && op.entry.tokenId) {
      const linked = this.store.getObject(op.entry.tokenId)
      if (!linked || linked.type !== 'image') return rejectInvalid()
    }
    const after = applyTurnOp(this.store.getTurns(), op, () => uniformInt(20, this.rng) + 1)
    if (!after) return rejectInvalid()
    this.store.putTurns(after)
    return done(0, { kind: 'turns', turns: after })
  }
```

- [ ] **Step 6: Ganchos mínimos no cliente (compilação)**

O `OpSchema` e o `ServerMessage` cresceram; o `applyOptimistic` tem `default: never` e o `reduceServer` precisa de um `case` por mensagem. Em `apps/web/src/store/reducers.ts`:

1. No import de `@mesa/shared`, acrescente `isTurnOp`.
2. Em `applyOptimistic`, logo antes de `switch (op.kind) {`:

```ts
  if (isTurnOp(op)) return { next: s, before: null, prev: null, layerOrders: null }
```

3. Em `reduceServer`, logo depois de `case 'memberUpdated': return withMember(s, msg.member)`:

```ts
    case 'turnsUpdated':
      return s
```

(A Task 4 troca os dois ganchos pela lógica real.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @mesa/shared exec vitest run test/protocol.test.ts`
Expected: PASS.

Run: `pnpm --filter @mesa/worker test test/engine.test.ts test/sql-store.test.ts`
Expected: PASS (inclui o contrato do store para MemoryStore e SqlStore).

- [ ] **Step 8: Verificação completa na raiz**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 9: Commit**

```bash
git add packages/shared/src/protocol.ts packages/shared/test/protocol.test.ts apps/worker/src/engine apps/worker/test/store-contract.ts apps/worker/test/sql-store.test.ts apps/worker/test/engine.test.ts apps/web/src/store/reducers.ts
git commit -m "feat(turnos): ações de turno no protocolo, no engine e no armazenamento" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: TableDO: welcome, difusão e persistência

**Files:**
- Modify: `apps/worker/src/table-do.ts` (`broadcastEffect`)
- Test: `apps/worker/test/table-do.test.ts`

**Interfaces:**
- Consumes (Task 2): `OpEffect` `{ kind: 'turns'; turns }`; `ServerMessage` `turnsUpdated`; `snapshot.turns`.
- Produces: todas as sessões (inclusive a do autor) recebem `{ t: 'turnsUpdated', turns }` depois do `ack` de cada ação de turno aplicada; `welcome.snapshot.turns` para quem entra.

- [ ] **Step 1: Write the failing test**

Em `apps/worker/test/table-do.test.ts`, troque `import type { NewObject, Op } from '@mesa/shared'` por:

```ts
import { DEFAULT_TURNS, type NewObject, type Op } from '@mesa/shared'
```

e acrescente no fim do arquivo:

```ts
describe('TableDO — turnos', () => {
  const op = (opId: string, o: Op) => ({ t: 'op' as const, opId, op: o })

  async function table() {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    const p = await TestClient.connect(tableId)
    const { welcome } = await gm.hello('Mestre', { gmSecret })
    await p.hello('Ana')
    return { tableId, gm, p, gmWelcome: welcome }
  }

  it('jogador recusado; mestre muda e todos, inclusive ele, recebem turnsUpdated; quem entra depois recebe no welcome', async () => {
    const { tableId, gm, p, gmWelcome } = await table()
    expect(gmWelcome.snapshot.turns).toEqual(DEFAULT_TURNS)
    p.send(op('p1', { kind: 'turnsOpen', open: true }))
    expect(await p.waitFor('reject')).toMatchObject({ opId: 'p1', reason: 'forbidden' })
    await gm.expectNone('turnsUpdated')

    gm.send(op('g1', { kind: 'turnAdd', entry: { id: 'a', name: 'Ana' } }))
    await gm.waitFor('ack', (m) => m.opId === 'g1')
    const expected = { ...DEFAULT_TURNS, entries: [{ id: 'a', name: 'Ana', tokenId: null, initiative: null }] }
    expect(await p.waitFor('turnsUpdated')).toEqual({ t: 'turnsUpdated', turns: expected })
    expect(await gm.waitFor('turnsUpdated')).toEqual({ t: 'turnsUpdated', turns: expected })
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Bia')).welcome.snapshot.turns).toEqual(expected)
  })

  it('rolagem no servidor: iniciativas de 1 a 20 em ordem decrescente; opId repetido não rola de novo', async () => {
    const { gm, p } = await table()
    for (const id of ['a', 'b', 'c', 'd', 'e']) gm.send(op(`add_${id}`, { kind: 'turnAdd', entry: { id, name: id.toUpperCase() } }))
    await gm.waitFor('ack', (m) => m.opId === 'add_e')
    gm.send(op('r1', { kind: 'turnsRoll', all: true }))
    const rolled = await p.waitFor('turnsUpdated', (m) => m.turns.entries.every((e) => e.initiative !== null))
    const values = rolled.turns.entries.map((e) => e.initiative as number)
    for (const v of values) {
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(20)
    }
    expect([...values].sort((x, y) => y - x)).toEqual(values)
    await gm.waitFor('ack', (m) => m.opId === 'r1')
    gm.send(op('r1', { kind: 'turnsRoll', all: true }))
    await gm.waitFor('ack', (m) => m.opId === 'r1')
    await p.expectNone('turnsUpdated', (m) => m.turns.entries.every((e) => e.initiative !== null))
  })

  it('fora da fase ou dado inválido: reject invalid e ninguém recebe turnsUpdated', async () => {
    const { gm, p } = await table()
    gm.send(op('n1', { kind: 'turnNext' }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'n1')).toMatchObject({ reason: 'invalid' })
    gm.send(JSON.stringify({ t: 'op', opId: 'u1', op: { kind: 'turnUpdate', id: 'a', patch: { initiative: 1000 } } }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'u1')).toMatchObject({ reason: 'invalid' })
    await p.expectNone('turnsUpdated')
  })

  it('estado dos turnos persiste após todos saírem', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    gm.send(op('g1', { kind: 'turnAdd', entry: { id: 'a', name: 'Ana' } }))
    gm.send(op('g2', { kind: 'turnsStart' }))
    await gm.waitFor('ack', (m) => m.opId === 'g2')
    gm.close()
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Ana')
    expect(welcome.snapshot.turns).toMatchObject({ open: true, phase: 'combat', round: 1, currentId: 'a' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mesa/worker test test/table-do.test.ts`
Expected: FAIL nos testes de turnos (timeout esperando `turnsUpdated`).

- [ ] **Step 3: Write minimal implementation**

Em `apps/worker/src/table-do.ts`, no `switch (effect.kind)` de `broadcastEffect`, depois do `case 'memberUpdated'`:

```ts
      case 'turns':
        // Tudo nos turnos é visível para todos; o autor também recebe (o ack não traz a rolagem).
        this.broadcast(null, () => ({ t: 'turnsUpdated', turns: effect.turns }))
        return
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mesa/worker test test/table-do.test.ts`
Expected: PASS.

- [ ] **Step 5: Verificação completa na raiz**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/worker/src/table-do.ts apps/worker/test/table-do.test.ts
git commit -m "feat(turnos): TableDO entrega os turnos no welcome e difunde as mudanças" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Web: estado otimista dos turnos e ações da store

**Files:**
- Create: `apps/web/src/store/turns.ts`
- Modify: `apps/web/src/store/state.ts`
- Modify: `apps/web/src/store/reducers.ts` (troca os ganchos da Task 2)
- Modify: `apps/web/src/store/tableStore.ts`
- Test: `apps/web/test/reducers-turns.test.ts`, `apps/web/test/turns-actions.test.ts`

**Interfaces:**
- Consumes: `applyTurnOp`, `isTurnOp`, `defaultTurns`, `TURNS_MAX`, `TURN_NAME_MAX`, `Turns` (`@mesa/shared`); `rotatedBounds` (`canvas/bounds.ts`).
- Produces:
  - `TableState.turns: Turns` (confirmados + pendentes), `TableState.confirmedTurns: Turns`, `TableState.turnHover: string | null` (tokenId do card sob o mouse, só local);
  - `apps/web/src/store/turns.ts`: `replayTurns(confirmed, pending)`, `recomputeTurns<S>(s, pending?)`, `ackTurnOp(confirmed, op)`, `currentTurnToken(s: Pick<TableState, 'turns' | 'objects'>): ImageObject | null`, `turnNameFor(title: string | undefined): string`;
  - `TableActions.addTokenToTurns(objectId: string): void`, `TableActions.setTurnHover(tokenId: string | null): void`, `TableActions.focusObject(objectId: string): void`;
  - toasts: recusa de ação de turno → `forbidden`: "Só o mestre pode fazer isso"; outros: "Não foi possível mudar a ordem de turnos"; lista cheia: "A ordem de turnos está cheia (máximo 50)".

- [ ] **Step 1: Write the failing tests**

Crie `apps/web/test/reducers-turns.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_LAYERS,
  DEFAULT_SETTINGS,
  DEFAULT_TURNS,
  type Member,
  type Op,
  type ServerMessage,
  type Snapshot,
  type TableObject,
  type TurnEntry,
  type Turns,
} from '@mesa/shared'
import { reduceServer, reduceSubmit } from '../src/store/reducers'
import { makeInitialState, type TableState } from '../src/store/state'
import { currentTurnToken, turnNameFor } from '../src/store/turns'

const gm: Member = { clientId: 'gm1', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const ana: Member = { clientId: 'p1', nickname: 'Ana', color: '#3cb44b', role: 'player', online: true }

const token = (id: string): TableObject => ({
  id, type: 'image', layerId: 'tokens', assetKey: 'a'.repeat(64), x: 0, y: 0, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'gm1', version: 1, updatedBy: 'gm1', control: { mode: 'list', clientIds: ['gm1'] },
})
const entry = (id: string, name = id, tokenId: string | null = null, initiative: number | null = null): TurnEntry => ({
  id, name, tokenId, initiative,
})
const combat = (currentId: string, ...entries: TurnEntry[]): Turns => ({ open: true, phase: 'combat', round: 1, currentId, entries })
const welcome = (self: Member, over: Partial<Snapshot> = {}): ServerMessage => ({
  t: 'welcome',
  self,
  snapshot: {
    meta: { id: 'T', name: 'M' }, members: [gm, ana], layers: DEFAULT_LAYERS, objects: [], locks: [], notes: {},
    settings: DEFAULT_SETTINGS, chat: [], ...over,
  },
})
const joined = (self: Member, over: Partial<Snapshot> = {}) => reduceServer(makeInitialState(), welcome(self, over), 0)
const submit = (s: TableState, opId: string, op: Op) => reduceSubmit(s, opId, op, { isUndo: false })
const ack = (s: TableState, opId: string) => reduceServer(s, { t: 'ack', opId, version: 0 }, 0)
const updated = (s: TableState, turns: Turns) => reduceServer(s, { t: 'turnsUpdated', turns }, 0)
const names = (s: TableState) => s.turns.entries.map((e) => e.name)

describe('turnos no cliente', () => {
  it('welcome traz os turnos; snapshot sem turnos vira o padrão', () => {
    const turns = combat('a', entry('a', 'Ana'))
    expect(joined(ana, { turns }).turns).toEqual(turns)
    expect(joined(ana).turns).toEqual(DEFAULT_TURNS)
  })

  it('ações do mestre são otimistas; ack e turnsUpdated mantêm; nada entra no desfazer', () => {
    let s = submit(joined(gm), 'o1', { kind: 'turnAdd', entry: { id: 'a', name: 'Goblin' } })
    s = submit(s, 'o2', { kind: 'turnDuplicate', id: 'a', newId: 'b' })
    expect(names(s)).toEqual(['Goblin', 'Goblin 2'])
    s = ack(s, 'o1')
    expect(names(s)).toEqual(['Goblin', 'Goblin 2'])
    s = updated(s, { ...DEFAULT_TURNS, entries: [entry('a', 'Goblin')] })
    expect(names(s)).toEqual(['Goblin', 'Goblin 2']) // o2 ainda pendente, por cima
    s = ack(s, 'o2')
    s = updated(s, { ...DEFAULT_TURNS, entries: [entry('a', 'Goblin'), entry('b', 'Goblin 2')] })
    expect(names(s)).toEqual(['Goblin', 'Goblin 2'])
    expect(s.undoStack).toEqual([])
    expect(s.pending).toEqual({})
  })

  it('recusa volta ao estado do servidor, com aviso', () => {
    let s = submit(joined(gm), 'o1', { kind: 'turnsOpen', open: true })
    expect(s.turns.open).toBe(true)
    s = reduceServer(s, { t: 'reject', opId: 'o1', reason: 'forbidden' }, 0)
    expect(s.turns).toEqual(DEFAULT_TURNS)
    expect(s.toasts.at(-1)?.text).toBe('Só o mestre pode fazer isso')
    s = submit(s, 'o2', { kind: 'turnNext' })
    s = reduceServer(s, { t: 'reject', opId: 'o2', reason: 'invalid' }, 0)
    expect(s.toasts.at(-1)?.text).toBe('Não foi possível mudar a ordem de turnos')
  })

  it('rolagem espera o servidor', () => {
    let s = joined(gm, { turns: { ...DEFAULT_TURNS, entries: [entry('a'), entry('b')] } })
    s = submit(s, 'r1', { kind: 'turnsRoll', all: false })
    expect(s.turns.entries.map((e) => e.initiative)).toEqual([null, null])
    s = ack(s, 'r1')
    s = updated(s, { ...DEFAULT_TURNS, entries: [entry('b', 'b', null, 15), entry('a', 'a', null, 3)] })
    expect(s.turns.entries.map((e) => e.id)).toEqual(['b', 'a'])
  })

  // Review Focus #1
  it('dois "Próximo" rápidos: avança duas casas, sem voltar enquanto as respostas chegam', () => {
    const base = combat('a', entry('a'), entry('b'), entry('c'))
    let s = joined(gm, { turns: base })
    s = submit(s, 'n1', { kind: 'turnNext' })
    s = submit(s, 'n2', { kind: 'turnNext' })
    expect(s.turns.currentId).toBe('c')
    s = ack(s, 'n1')
    expect(s.turns.currentId).toBe('c')
    s = updated(s, { ...base, currentId: 'b' })
    expect(s.turns.currentId).toBe('c')
    s = ack(s, 'n2')
    s = updated(s, { ...base, currentId: 'c' })
    expect(s.turns).toMatchObject({ currentId: 'c', round: 1 })
  })

  // Review Focus #3
  it('op pendente volta por cima de um welcome novo, sem duplicar se o servidor já a aplicou', () => {
    let s = submit(joined(gm), 'o1', { kind: 'turnAdd', entry: { id: 'a', name: 'Ana' } })
    s = reduceServer(s, welcome(gm), 0)
    expect(names(s)).toEqual(['Ana'])
    s = reduceServer(s, welcome(gm, { turns: { ...DEFAULT_TURNS, entries: [entry('a', 'Ana')] } }), 0)
    expect(names(s)).toEqual(['Ana'])
  })

  // Review Focus #2
  it('token apagado: a entrada continua e o anel some', () => {
    let s = joined(gm, { objects: [token('t1')], turns: combat('a', entry('a', 'Token', 't1')) })
    expect(currentTurnToken(s)?.id).toBe('t1')
    s = reduceServer(s, { t: 'op', by: 'gm1', op: { kind: 'delete', id: 't1' } }, 0)
    expect(s.turns.entries).toEqual([entry('a', 'Token', 't1')])
    expect(currentTurnToken(s)).toBeNull()
  })

  // Review Focus #5
  it('anel só no combate e só para quem tem o token no estado (camada oculta: sem anel)', () => {
    const turns = combat('a', entry('a', 'Token', 't1'))
    expect(currentTurnToken(joined(gm, { objects: [token('t1')], turns: { ...turns, phase: 'prep', currentId: null } }))).toBeNull()
    const player = joined(ana, { turns }) // o objeto está na camada do mestre: o jogador não o recebe
    expect(names(player)).toEqual(['Token'])
    expect(currentTurnToken(player)).toBeNull()
  })

  it('nome do token na ordem: título (até 32 caracteres) ou "Token"', () => {
    expect(turnNameFor(undefined)).toBe('Token')
    expect(turnNameFor('Orc chefe')).toBe('Orc chefe')
    expect(turnNameFor('x'.repeat(40))).toBe('x'.repeat(32))
  })
})
```

Crie `apps/web/test/turns-actions.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, DEFAULT_TURNS, TURNS_MAX, type Member, type ServerMessage, type TableObject, type Turns } from '@mesa/shared'
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

const me: Member = { clientId: 'me', nickname: 'Mestre', color: '#e6194b', role: 'gm', online: true }
const base = {
  type: 'image' as const, layerId: 'tokens', assetKey: 'a'.repeat(64), x: 100, y: 200, width: 70, height: 70, rotation: 0, zIndex: 1,
  ownerId: 'me', version: 1, updatedBy: 'me', control: { mode: 'list' as const, clientIds: ['me'] },
}
const orc = { ...base, id: 't1', title: 'Orc' } as TableObject
const untitled = { ...base, id: 't2' } as TableObject

function connected(turns: Turns = DEFAULT_TURNS) {
  const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
  store.getState().actions.connect('Mestre')
  FakeSocket.all[0].onopen?.({})
  FakeSocket.all[0].receive({
    t: 'welcome',
    self: me,
    snapshot: {
      meta: { id: 'T', name: 'M' }, members: [me], layers: DEFAULT_LAYERS, objects: [orc, untitled], locks: [], notes: {},
      settings: DEFAULT_SETTINGS, chat: [], turns,
    },
  })
  return store
}

const opsSent = () => FakeSocket.all[0].sent.filter((m) => typeof m === 'object' && m.t === 'op').map((m) => m.op)

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

describe('ações de turno da store', () => {
  it('adicionar token com a janela fechada: turnAdd com o título e turnsOpen; aparece na hora', () => {
    const store = connected()
    store.getState().actions.addTokenToTurns('t1')
    expect(opsSent()).toEqual([
      { kind: 'turnAdd', entry: { id: expect.any(String), name: 'Orc', tokenId: 't1' } },
      { kind: 'turnsOpen', open: true },
    ])
    expect(store.getState().turns).toMatchObject({ open: true, entries: [{ name: 'Orc', tokenId: 't1', initiative: null }] })
  })

  it('janela já aberta: só o turnAdd; token sem título vira "Token"', () => {
    const store = connected({ ...DEFAULT_TURNS, open: true })
    store.getState().actions.addTokenToTurns('t2')
    expect(opsSent()).toEqual([{ kind: 'turnAdd', entry: { id: expect.any(String), name: 'Token', tokenId: 't2' } }])
  })

  it('ordem cheia: avisa e não envia', () => {
    const entries = Array.from({ length: TURNS_MAX }, (_, i) => ({ id: `e${i}`, name: `E${i}`, tokenId: null, initiative: null }))
    const store = connected({ ...DEFAULT_TURNS, open: true, entries })
    store.getState().actions.addTokenToTurns('t1')
    expect(opsSent()).toEqual([])
    expect(store.getState().toasts.at(-1)?.text).toBe('A ordem de turnos está cheia (máximo 50)')
  })

  it('focusObject pede à câmera o centro do token; setTurnHover guarda o token destacado', () => {
    const store = connected()
    store.getState().actions.focusObject('t1')
    expect(store.getState().cameraTarget).toMatchObject({ x: 135, y: 235 })
    store.getState().actions.setTurnHover('t1')
    expect(store.getState().turnHover).toBe('t1')
    store.getState().actions.setTurnHover(null)
    expect(store.getState().turnHover).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mesa/web test test/reducers-turns.test.ts test/turns-actions.test.ts`
Expected: FAIL (`../src/store/turns` não existe; `turns` ausente do estado).

- [ ] **Step 3: Estado**

Em `apps/web/src/store/state.ts`: no import de `@mesa/shared` acrescente `defaultTurns` e `type Turns`. Na interface `TableState`, depois de `chatPending`:

```ts
  /** Ordem de turnos na tela: confirmados pelo servidor + ações de turno pendentes (como as camadas). */
  turns: Turns
  /** Último estado de turnos recebido do servidor. */
  confirmedTurns: Turns
  /** Token do card sob o mouse na janela de turnos (destaque só na minha tela). */
  turnHover: string | null
```

e em `makeInitialState()`, depois de `chatPending: {},`:

```ts
    turns: defaultTurns(),
    confirmedTurns: defaultTurns(),
    turnHover: null,
```

- [ ] **Step 4: Módulo de turnos do cliente**

Crie `apps/web/src/store/turns.ts`:

```ts
import { TURN_NAME_MAX, applyTurnOp, isTurnOp, type ImageObject, type Op, type TableObject, type Turns } from '@mesa/shared'
import type { PendingOp, TableState } from './state'

/** Confirmados + ações de turno pendentes, na ordem de envio. A rolagem não muda nada aqui: espera o servidor. */
export function replayTurns(confirmed: Turns, pending: Record<string, PendingOp>): Turns {
  let turns = confirmed
  for (const p of Object.values(pending)) if (isTurnOp(p.op)) turns = applyTurnOp(turns, p.op) ?? turns
  return turns
}

export function recomputeTurns<S extends TableState>(s: S, pending: Record<string, PendingOp> = s.pending): S {
  const turns = replayTurns(s.confirmedTurns, pending)
  return turns === s.turns ? s : { ...s, turns }
}

/** No ack, a ação passa a valer na base confirmada; o turnsUpdated que chega logo depois traz o mesmo estado. */
export function ackTurnOp(confirmed: Turns, op: Op): Turns {
  return isTurnOp(op) ? (applyTurnOp(confirmed, op) ?? confirmed) : confirmed
}

/** Token da vez para o anel: só no combate e só se eu tenho o objeto (imagem) no estado. */
export function currentTurnToken(s: Pick<TableState, 'turns' | 'objects'>): ImageObject | null {
  if (s.turns.phase !== 'combat') return null
  const entry = s.turns.entries.find((e) => e.id === s.turns.currentId)
  const object: TableObject | undefined = entry?.tokenId ? s.objects[entry.tokenId] : undefined
  return object?.type === 'image' ? object : null
}

/** Nome da entrada criada pelo token: o título (cortado em 32) ou "Token". */
export function turnNameFor(title: string | undefined): string {
  return (title ?? '').trim().slice(0, TURN_NAME_MAX).trim() || 'Token'
}
```

- [ ] **Step 5: Reducers**

Em `apps/web/src/store/reducers.ts`:

1. Acrescente o import:

```ts
import { ackTurnOp, recomputeTurns } from './turns'
```

e, no import de `@mesa/shared`, acrescente `applyTurnOp` e `defaultTurns` (o `isTurnOp` já veio na Task 2).

2. Em `rejectText`, como primeira linha do corpo:

```ts
  if (isTurnOp(op)) return reason === 'forbidden' ? 'Só o mestre pode fazer isso' : 'Não foi possível mudar a ordem de turnos'
```

3. Em `applyOptimistic`, troque o gancho da Task 2

```ts
  if (isTurnOp(op)) return { next: s, before: null, prev: null, layerOrders: null }
```

por:

```ts
  // Turnos: a reversão é recalcular a partir de confirmedTurns (não há `prev`).
  if (isTurnOp(op)) return { next: { ...s, turns: applyTurnOp(s.turns, op) ?? s.turns }, before: null, prev: null, layerOrders: null }
```

4. No `case 'welcome'`, dentro de `const base: S = { ... }`, depois de `chatPending: {},`:

```ts
        confirmedTurns: snap.turns ?? defaultTurns(),
```

e troque o `return out` final desse `case` por:

```ts
      return recomputeTurns(out, s.pending)
```

5. No `case 'ack'`, depois da linha `if (isLayerOp(p.op)) acked = ...`:

```ts
      if (isTurnOp(p.op)) acked = recomputeTurns({ ...acked, confirmedTurns: ackTurnOp(s.confirmedTurns, p.op) })
```

6. No `case 'reject'`, troque

```ts
        next = recomputeLayers({ ...revertLocal(s, p), pending }, pending)
```

por:

```ts
        next = recomputeTurns(recomputeLayers({ ...revertLocal(s, p), pending }, pending), pending)
```

7. Troque o gancho da Task 2

```ts
    case 'turnsUpdated':
      return s
```

por:

```ts
    case 'turnsUpdated':
      return recomputeTurns({ ...s, confirmedTurns: msg.turns })
```

(Ações de turno já ficam fora do desfazer: `inverseOf` devolve `null` para elas e `settleGroup` não empilha grupo vazio. O teste "nada entra no desfazer" garante isso.)

- [ ] **Step 6: Ações da store**

Em `apps/web/src/store/tableStore.ts`:

1. Imports: no import de valores de `@mesa/shared` acrescente `TURNS_MAX`; acrescente

```ts
import { rotatedBounds } from '../canvas/bounds'
import { turnNameFor } from './turns'
```

2. Na interface `TableActions`, depois de `setChatOpen(open: boolean): void`:

```ts
  /** Mestre: põe o token (imagem) no fim da ordem de turnos e abre a janela se estiver fechada. */
  addTokenToTurns(objectId: string): void
  /** Token destacado no mapa enquanto o mouse está sobre o card dele (só na minha tela). */
  setTurnHover(tokenId: string | null): void
  /** Desliza a minha câmera até o centro do objeto, mantendo o zoom. */
  focusObject(objectId: string): void
```

3. No objeto `actions`, depois de `setChatOpen: ...`:

```ts
      addTokenToTurns(objectId) {
        const s = get()
        const object = s.objects[objectId]
        if (!object || object.type !== 'image') return
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
        const object = get().objects[objectId]
        if (!object) return
        const b = rotatedBounds(object)
        set((s) => ({
          cameraTarget: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2, seq: (s.cameraTarget?.seq ?? 0) + 1 },
        }))
      },
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `pnpm --filter @mesa/web test test/reducers-turns.test.ts test/turns-actions.test.ts`
Expected: PASS.

- [ ] **Step 8: Verificação completa na raiz**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/store apps/web/test/reducers-turns.test.ts apps/web/test/turns-actions.test.ts
git commit -m "feat(turnos): estado otimista dos turnos no cliente" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Web: janela de turnos, botão na barra e aviso com três escolhas

**Files:**
- Create: `apps/web/src/ui/turns/format.ts`
- Create: `apps/web/src/ui/turns/windowPrefs.ts`
- Create: `apps/web/src/ui/turns/TurnCard.tsx`
- Create: `apps/web/src/ui/turns/TurnsWindow.tsx`
- Modify: `apps/web/src/ui/confirm.ts`, `apps/web/src/ui/ConfirmModal.tsx`
- Modify: `apps/web/src/ui/Toolbar.tsx`, `apps/web/src/ui/TablePage.tsx`, `apps/web/src/styles.css`
- Test: `apps/web/test/turns-format.test.ts`, `apps/web/test/turns-prefs.test.ts`, `apps/web/test/confirm.test.ts`

**Interfaces:**
- Consumes (Task 4): `turns`, `turnHover`, `actions.setTurnHover`, `actions.focusObject`, `actions.submit`; (Task 1) `TURNS_MAX`, `TURN_NAME_MAX`, `INITIATIVE_MIN`, `INITIATIVE_MAX`, `Turns`, `TurnEntry`.
- Produces:
  - `askChoice(options: ConfirmOptions): Promise<ConfirmAnswer>` com `ConfirmAnswer = 'confirm' | 'alternative' | 'cancel'`; `ConfirmOptions.alternativeLabel?: string`, `ConfirmOptions.alternativeDanger?: boolean`; `settleConfirm(answer: boolean | 'alternative')`;
  - `initiativeLabel(v: number | null): string`, `parseInitiativeInput(text: string): number | null | undefined` (`undefined` = recusado), `turnsSummary(turns: Turns): string`;
  - `TurnsWindowPrefs { x: number | null; y: number | null; minimized: boolean }`, `readTurnsPrefs(tableId)`, `writeTurnsPrefs(tableId, prefs)`, `defaultPosition(viewportWidth)`, `clampPosition(p, size, viewport)`, `TURNS_WINDOW_WIDTH = 320`, `TURNS_WINDOW_TOP = 56`;
  - DOM usado pela Task 7: `section[aria-label="Turnos"]` (região), `.turn-card` (`aria-current="true"` na vez), `.turn-name`, `.turn-init`, `.turn-handle`, rótulos "Nome do participante", "Iniciativa de <nome>", botões "Minimizar", "Fechar para todos", "Duplicar <nome>", "Remover <nome>", "Centralizar em <nome>", "Adicionar", "Rolar iniciativa", "Rolar de novo para todos", "Iniciar combate", "Turno anterior", "Próximo turno", "Encerrar"; botão da barra "Turnos" (`aria-pressed`).

- [ ] **Step 1: Write the failing tests**

Crie `apps/web/test/turns-format.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_TURNS, type Turns } from '@mesa/shared'
import { initiativeLabel, parseInitiativeInput, turnsSummary } from '../src/ui/turns/format'

describe('formatação dos turnos', () => {
  it('iniciativa sem valor aparece como "?"', () => {
    expect(initiativeLabel(null)).toBe('?')
    expect(initiativeLabel(-5)).toBe('-5')
    expect(initiativeLabel(17)).toBe('17')
  })

  it('campo de iniciativa: vazio limpa; inteiro de -99 a 999 vale; o resto é recusado', () => {
    expect(parseInitiativeInput('')).toBeNull()
    expect(parseInitiativeInput('   ')).toBeNull()
    expect(parseInitiativeInput(' 12 ')).toBe(12)
    expect(parseInitiativeInput('-99')).toBe(-99)
    expect(parseInitiativeInput('−5')).toBe(-5) // sinal de menos tipográfico
    expect(parseInitiativeInput('999')).toBe(999)
    for (const bad of ['1000', '-100', '1.5', 'abc', '1e2', '+5', '--1']) expect(parseInitiativeInput(bad)).toBeUndefined()
  })

  it('resumo da janela minimizada', () => {
    expect(turnsSummary(DEFAULT_TURNS)).toBe('Turnos · preparação')
    const turns: Turns = {
      open: true, phase: 'combat', round: 3, currentId: 'b',
      entries: [{ id: 'a', name: 'Ana', tokenId: null, initiative: 9 }, { id: 'b', name: 'Goblin', tokenId: null, initiative: 4 }],
    }
    expect(turnsSummary(turns)).toBe('Rodada 3 · Vez de: Goblin')
  })
})

describe('textos da janela de turnos sem travessões', () => {
  const sources = import.meta.glob<string>('../src/ui/turns/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true })

  it('nenhum — ou – nos arquivos da janela de turnos', () => {
    expect(Object.keys(sources).length).toBeGreaterThanOrEqual(4)
    const offenders = Object.entries(sources).filter(([, text]) => /[–—]/.test(text)).map(([path]) => path)
    expect(offenders).toEqual([])
  })
})
```

Crie `apps/web/test/turns-prefs.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { clampPosition, defaultPosition, readTurnsPrefs, writeTurnsPrefs } from '../src/ui/turns/windowPrefs'

let mem: Map<string, string>

beforeEach(() => {
  mem = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('preferências da janela de turnos', () => {
  it('sem nada guardado: posição padrão (centralizada no topo) e aberta', () => {
    expect(readTurnsPrefs('T')).toEqual({ x: null, y: null, minimized: false })
    expect(defaultPosition(1280)).toEqual({ x: 480, y: 56 })
    expect(defaultPosition(200)).toEqual({ x: 8, y: 56 })
  })

  it('guarda posição e minimizado por mesa', () => {
    writeTurnsPrefs('T', { x: 10, y: 20, minimized: true })
    expect(mem.get('mesa:turns:T')).toBe(JSON.stringify({ x: 10, y: 20, minimized: true }))
    expect(readTurnsPrefs('T')).toEqual({ x: 10, y: 20, minimized: true })
    expect(readTurnsPrefs('U')).toEqual({ x: null, y: null, minimized: false })
  })

  it('conteúdo corrompido ou armazenamento bloqueado: padrão, sem erro', () => {
    mem.set('mesa:turns:T', '{x')
    expect(readTurnsPrefs('T')).toEqual({ x: null, y: null, minimized: false })
    mem.set('mesa:turns:T', JSON.stringify({ x: 'a', y: Infinity, minimized: 'sim' }))
    expect(readTurnsPrefs('T')).toEqual({ x: null, y: null, minimized: false })
    vi.stubGlobal('localStorage', {
      getItem: () => { throw new Error('bloqueado') },
      setItem: () => { throw new Error('bloqueado') },
    })
    expect(readTurnsPrefs('T')).toEqual({ x: null, y: null, minimized: false })
    expect(() => writeTurnsPrefs('T', { x: 1, y: 2, minimized: false })).not.toThrow()
  })

  it('clampPosition mantém o cabeçalho dentro da tela', () => {
    const viewport = { width: 1000, height: 600 }
    const size = { width: 320, height: 40 }
    expect(clampPosition({ x: -50, y: -10 }, size, viewport)).toEqual({ x: 0, y: 0 })
    expect(clampPosition({ x: 900, y: 700 }, size, viewport)).toEqual({ x: 680, y: 560 })
    expect(clampPosition({ x: 100, y: 100 }, size, viewport)).toEqual({ x: 100, y: 100 })
  })
})
```

Em `apps/web/test/confirm.test.ts`, troque o import por:

```ts
import { askChoice, askConfirm, confirmKeyAction, confirmStore, plural, settleConfirm } from '../src/ui/confirm'
```

e acrescente depois do `describe('askConfirm', ...)`:

```ts
describe('askChoice', () => {
  it('três respostas: confirmar, alternativa e cancelar', async () => {
    const a = askChoice({ title: 'Encerrar', message: 'm', confirmLabel: 'Manter', alternativeLabel: 'Limpar', alternativeDanger: true })
    expect(confirmStore.getState().request).toMatchObject({ alternativeLabel: 'Limpar', alternativeDanger: true })
    settleConfirm('alternative')
    await expect(a).resolves.toBe('alternative')
    const b = askChoice({ title: 'E', message: 'm', alternativeLabel: 'L' })
    settleConfirm(true)
    await expect(b).resolves.toBe('confirm')
    const c = askChoice({ title: 'E', message: 'm', alternativeLabel: 'L' })
    settleConfirm(false)
    await expect(c).resolves.toBe('cancel')
  })

  it('askConfirm continua booleano; um pedido novo cancela o anterior', async () => {
    const a = askConfirm({ title: 'A', message: 'a' })
    settleConfirm('alternative')
    await expect(a).resolves.toBe(false)
    const first = askChoice({ title: 'A', message: 'a', alternativeLabel: 'L' })
    const second = askConfirm({ title: 'B', message: 'b' })
    await expect(first).resolves.toBe('cancel')
    settleConfirm(true)
    await expect(second).resolves.toBe(true)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @mesa/web test test/turns-format.test.ts test/turns-prefs.test.ts test/confirm.test.ts`
Expected: FAIL (módulos `ui/turns/*` e `askChoice` não existem).

- [ ] **Step 3: Aviso com três escolhas**

Substitua em `apps/web/src/ui/confirm.ts` o trecho de `ConfirmOptions` até `settleConfirm` (inclusive) por:

```ts
export interface ConfirmOptions {
  title: string
  message: string
  /** Texto do botão de confirmar; padrão "Confirmar". */
  confirmLabel?: string
  /** Ação destrutiva: o botão de confirmar fica vermelho. */
  danger?: boolean
  /** Terceiro botão, entre Cancelar e Confirmar (resposta 'alternative' no askChoice). */
  alternativeLabel?: string
  /** O botão alternativo é destrutivo (vermelho). */
  alternativeDanger?: boolean
}

export type ConfirmAnswer = 'confirm' | 'alternative' | 'cancel'

export interface ConfirmRequest extends ConfirmOptions {
  id: number
  resolve: (answer: ConfirmAnswer) => void
}

let seq = 0

/** Um pedido por vez; o modal (ConfirmHost) lê daqui. Substitui os diálogos nativos do navegador. */
export const confirmStore = createStore<{ request: ConfirmRequest | null }>(() => ({ request: null }))

/** Aviso com até três botões; resolve 'cancel' em Cancelar/Esc/clique fora. */
export function askChoice(options: ConfirmOptions): Promise<ConfirmAnswer> {
  return new Promise((resolve) => {
    // um aviso novo cancela o anterior (não ficam promessas penduradas)
    confirmStore.getState().request?.resolve('cancel')
    confirmStore.setState({ request: { ...options, id: ++seq, resolve } })
  })
}

/** Abre o aviso de confirmação do app; resolve true em Confirmar, false em Cancelar/Esc/clique fora. */
export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return askChoice(options).then((answer) => answer === 'confirm')
}

export function settleConfirm(answer: boolean | 'alternative'): void {
  const request = confirmStore.getState().request
  if (!request) return
  confirmStore.setState({ request: null })
  request.resolve(answer === 'alternative' ? 'alternative' : answer ? 'confirm' : 'cancel')
}
```

Em `apps/web/src/ui/ConfirmModal.tsx`, no componente `ConfirmModal`:

1. Depois de `const confirmRef = ...`:

```ts
  const altRef = useRef<HTMLButtonElement>(null)
```

2. Troque o bloco `if (e.key === 'Tab') { ... }` por:

```ts
      if (e.key === 'Tab') {
        // foco preso entre os botões do aviso
        e.preventDefault()
        const order = [cancelRef.current, altRef.current, confirmRef.current].filter((b): b is HTMLButtonElement => !!b)
        const i = order.indexOf(document.activeElement as HTMLButtonElement)
        order[(i + (e.shiftKey ? order.length - 1 : 1)) % order.length]?.focus()
        return
      }
      if (e.key === 'Enter' && altRef.current && document.activeElement === altRef.current) {
        e.preventDefault()
        settleConfirm('alternative')
        return
      }
```

3. Entre o botão "Cancelar" e o de confirmar:

```tsx
            {request.alternativeLabel && (
              <button
                ref={altRef}
                type="button"
                className={request.alternativeDanger ? 'danger-solid' : undefined}
                onClick={() => settleConfirm('alternative')}
              >
                {request.alternativeLabel}
              </button>
            )}
```

- [ ] **Step 4: Formatação e preferências**

Crie `apps/web/src/ui/turns/format.ts`:

```ts
import { INITIATIVE_MAX, INITIATIVE_MIN, type Turns } from '@mesa/shared'

/** "?" sem valor (o app não usa travessões). */
export function initiativeLabel(value: number | null): string {
  return value === null ? '?' : String(value)
}

/** Vazio = limpar (null); inteiro de -99 a 999 = valor; qualquer outra coisa = recusado (undefined). */
export function parseInitiativeInput(text: string): number | null | undefined {
  const t = text.trim().replace('−', '-')
  if (t === '') return null
  if (!/^-?\d{1,3}$/.test(t)) return undefined
  const n = Number(t)
  return n >= INITIATIVE_MIN && n <= INITIATIVE_MAX ? n : undefined
}

/** Texto da janela minimizada. */
export function turnsSummary(turns: Turns): string {
  if (turns.phase === 'prep') return 'Turnos · preparação'
  const current = turns.entries.find((e) => e.id === turns.currentId)
  return `Rodada ${turns.round} · Vez de: ${current?.name ?? '?'}`
}
```

Crie `apps/web/src/ui/turns/windowPrefs.ts`:

```ts
export interface TurnsWindowPrefs {
  /** null = posição padrão (centralizada no topo). */
  x: number | null
  y: number | null
  minimized: boolean
}

export const TURNS_WINDOW_WIDTH = 320
/** Abaixo da faixa com o nome da mesa. */
export const TURNS_WINDOW_TOP = 56

const key = (tableId: string) => `mesa:turns:${tableId}`
const defaults = (): TurnsWindowPrefs => ({ x: null, y: null, minimized: false })
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/** Posição e minimizado da MINHA janela nesta mesa; armazenamento bloqueado ou corrompido = padrão. */
export function readTurnsPrefs(tableId: string): TurnsWindowPrefs {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(key(tableId)) ?? 'null')
    if (typeof raw !== 'object' || raw === null) return defaults()
    const r = raw as Record<string, unknown>
    return { x: finite(r.x), y: finite(r.y), minimized: r.minimized === true }
  } catch {
    return defaults()
  }
}

export function writeTurnsPrefs(tableId: string, prefs: TurnsWindowPrefs): void {
  try {
    localStorage.setItem(key(tableId), JSON.stringify(prefs))
  } catch {
    // modo privado/armazenamento bloqueado: vale só nesta sessão
  }
}

export function defaultPosition(viewportWidth: number): { x: number; y: number } {
  return { x: Math.max(8, Math.round((viewportWidth - TURNS_WINDOW_WIDTH) / 2)), y: TURNS_WINDOW_TOP }
}

/** Mantém `size` (largura da janela, altura do cabeçalho) dentro da tela. */
export function clampPosition(
  p: { x: number; y: number },
  size: { width: number; height: number },
  viewport: { width: number; height: number },
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(0, p.x), Math.max(0, viewport.width - size.width)),
    y: Math.min(Math.max(0, p.y), Math.max(0, viewport.height - size.height)),
  }
}
```

- [ ] **Step 5: Run the pure tests**

Run: `pnpm --filter @mesa/web test test/turns-prefs.test.ts test/confirm.test.ts`
Expected: PASS. (`turns-format.test.ts` só passa depois do Step 7, quando a pasta tiver os 4 arquivos.)

- [ ] **Step 6: Card**

Crie `apps/web/src/ui/turns/TurnCard.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react'
import { Copy, GripVertical, Trash2 } from 'lucide-react'
import { nanoid } from 'nanoid'
import { TURN_NAME_MAX, type TurnEntry } from '@mesa/shared'
import { useTable, useTableActions } from '../../store/context'
import { initiativeLabel, parseInitiativeInput } from './format'

/** Tipo do arrasto entre cards (não se mistura com arquivos soltos na mesa). */
const TURN_DRAG_TYPE = 'application/x-mesa-turn'

interface TurnCardProps {
  entry: TurnEntry
  index: number
  current: boolean
  isGm: boolean
  /** 50 entradas: duplicar desativado. */
  full: boolean
}

export function TurnCard({ entry, index, current, isGm, full }: TurnCardProps) {
  const actions = useTableActions()
  // Miniatura só se eu tenho o token (imagem) no estado: apagado ou em camada oculta, sem miniatura.
  const assetKey = useTable((s) => {
    const o = entry.tokenId ? s.objects[entry.tokenId] : undefined
    return o?.type === 'image' ? o.assetKey : null
  })
  const [editing, setEditing] = useState<'name' | 'initiative' | null>(null)
  const [dropTarget, setDropTarget] = useState(false)
  const ref = useRef<HTMLLIElement>(null)

  // A lista rola até o card da vez quando a vez muda.
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: 'nearest' })
  }, [current])

  return (
    <li
      ref={ref}
      className={`turn-card${current ? ' current' : ''}${dropTarget ? ' drop-target' : ''}`}
      aria-current={current ? 'true' : undefined}
      onPointerEnter={() => actions.setTurnHover(entry.tokenId)}
      onPointerLeave={() => actions.setTurnHover(null)}
      onDragOver={(e) => {
        if (!isGm || !e.dataTransfer.types.includes(TURN_DRAG_TYPE)) return
        e.preventDefault()
        setDropTarget(true)
      }}
      onDragLeave={() => setDropTarget(false)}
      onDrop={(e) => {
        if (!isGm) return
        e.preventDefault()
        setDropTarget(false)
        const id = e.dataTransfer.getData(TURN_DRAG_TYPE)
        if (id && id !== entry.id) actions.submit({ kind: 'turnMove', id, index })
      }}
    >
      {isGm && (
        <span
          className="turn-handle"
          draggable
          role="img"
          aria-label="Arrastar para reordenar"
          title="Arrastar para reordenar"
          onDragStart={(e) => {
            e.dataTransfer.setData(TURN_DRAG_TYPE, entry.id)
            e.dataTransfer.effectAllowed = 'move'
          }}
        >
          <GripVertical size={14} aria-hidden />
        </span>
      )}
      {assetKey && entry.tokenId && (
        <button
          type="button"
          className="turn-thumb"
          aria-label={`Centralizar em ${entry.name}`}
          title="Centralizar no token"
          onClick={() => entry.tokenId && actions.focusObject(entry.tokenId)}
        >
          <img src={`/files/${assetKey}`} alt="" />
        </button>
      )}
      {editing === 'name' ? (
        <NameField entry={entry} onDone={() => setEditing(null)} />
      ) : (
        <span
          className={`turn-name${isGm ? ' editable' : ''}`}
          title={isGm ? 'Clique para editar o nome' : entry.name}
          onClick={isGm ? () => setEditing('name') : undefined}
        >
          {entry.name}
        </span>
      )}
      {isGm && (
        <span className="turn-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`Duplicar ${entry.name}`}
            title={full ? 'A ordem de turnos está cheia' : 'Duplicar'}
            disabled={full}
            onClick={() => actions.submit({ kind: 'turnDuplicate', id: entry.id, newId: nanoid() })}
          >
            <Copy size={14} aria-hidden />
          </button>
          <button
            type="button"
            className="icon-button danger"
            aria-label={`Remover ${entry.name}`}
            title="Remover"
            onClick={() => actions.submit({ kind: 'turnRemove', id: entry.id })}
          >
            <Trash2 size={14} aria-hidden />
          </button>
        </span>
      )}
      {editing === 'initiative' ? (
        <InitiativeField entry={entry} onDone={() => setEditing(null)} />
      ) : (
        <span
          className={`turn-init${isGm ? ' editable' : ''}`}
          title={isGm ? 'Clique para editar a iniciativa' : 'Iniciativa'}
          onClick={isGm ? () => setEditing('initiative') : undefined}
        >
          {initiativeLabel(entry.initiative)}
        </span>
      )}
    </li>
  )
}

/** Enter ou sair do campo salva; Esc cancela; vazio volta ao nome anterior. */
function NameField({ entry, onDone }: { entry: TurnEntry; onDone: () => void }) {
  const actions = useTableActions()
  const cancelled = useRef(false)
  return (
    <input
      className="turn-name-input"
      aria-label={`Nome de ${entry.name}`}
      autoFocus
      defaultValue={entry.name}
      maxLength={TURN_NAME_MAX}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
      }}
      onBlur={(e) => {
        const name = e.currentTarget.value.trim()
        if (!cancelled.current && name !== '' && name !== entry.name) {
          actions.submit({ kind: 'turnUpdate', id: entry.id, patch: { name } })
        }
        onDone()
      }}
    />
  )
}

/** Inteiro de -99 a 999 (vazio limpa); valor recusado fica marcado e não é salvo. */
function InitiativeField({ entry, onDone }: { entry: TurnEntry; onDone: () => void }) {
  const actions = useTableActions()
  const cancelled = useRef(false)
  const [text, setText] = useState(entry.initiative === null ? '' : String(entry.initiative))
  const parsed = parseInitiativeInput(text)
  const invalid = parsed === undefined
  return (
    <input
      className="turn-init-input"
      aria-label={`Iniciativa de ${entry.name}`}
      autoFocus
      inputMode="numeric"
      value={text}
      aria-invalid={invalid || undefined}
      onChange={(e) => setText(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          cancelled.current = true
          e.currentTarget.blur()
        }
        if (e.key === 'Enter' && !invalid) e.currentTarget.blur()
      }}
      onBlur={() => {
        if (!cancelled.current && parsed !== undefined && parsed !== entry.initiative) {
          actions.submit({ kind: 'turnUpdate', id: entry.id, patch: { initiative: parsed } })
        }
        onDone()
      }}
    />
  )
}
```

- [ ] **Step 7: Janela**

Crie `apps/web/src/ui/turns/TurnsWindow.tsx`:

```tsx
import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { Minus, X } from 'lucide-react'
import { nanoid } from 'nanoid'
import { TURNS_MAX, TURN_NAME_MAX, type Turns } from '@mesa/shared'
import { useTable, useTableActions } from '../../store/context'
import { askChoice } from '../confirm'
import { turnsSummary } from './format'
import { TurnCard } from './TurnCard'
import {
  TURNS_WINDOW_WIDTH,
  clampPosition,
  defaultPosition,
  readTurnsPrefs,
  writeTurnsPrefs,
  type TurnsWindowPrefs,
} from './windowPrefs'

/** O cabeçalho fica sempre alcançável na tela. */
const HEADER_HEIGHT = 40
/** A partir deste deslocamento (px) o gesto no cabeçalho é arrasto, não clique. */
const DRAG_THRESHOLD = 4

/** Janela da ordem de turnos: aparece para todos quando o mestre abre. */
export function TurnsWindow() {
  const open = useTable((s) => s.turns.open)
  const tableId = useTable((s) => s.meta?.id)
  if (!open || !tableId) return null
  return <TurnsWindowBody key={tableId} tableId={tableId} />
}

interface Gesture {
  startX: number
  startY: number
  offsetX: number
  offsetY: number
  moved: boolean
}

function TurnsWindowBody({ tableId }: { tableId: string }) {
  const turns = useTable((s) => s.turns)
  const isGm = useTable((s) => s.self?.role === 'gm')
  const actions = useTableActions()
  const [prefs, setPrefs] = useState<TurnsWindowPrefs>(() => readTurnsPrefs(tableId))
  const gesture = useRef<Gesture | null>(null)

  // Fechou a janela com o mouse sobre um card: o destaque no mapa não fica preso.
  useEffect(() => () => actions.setTurnHover(null), [actions])

  const viewport = { width: window.innerWidth, height: window.innerHeight }
  const stored = prefs.x !== null && prefs.y !== null ? { x: prefs.x, y: prefs.y } : defaultPosition(viewport.width)
  const pos = clampPosition(stored, { width: Math.min(TURNS_WINDOW_WIDTH, viewport.width), height: HEADER_HEIGHT }, viewport)

  const save = (next: TurnsWindowPrefs) => {
    setPrefs(next)
    writeTurnsPrefs(tableId, next)
  }

  const header = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return
      gesture.current = { startX: e.clientX, startY: e.clientY, offsetX: e.clientX - pos.x, offsetY: e.clientY - pos.y, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const g = gesture.current
      if (!g) return
      if (!g.moved && Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD) return
      g.moved = true
      setPrefs((p) => ({ ...p, x: e.clientX - g.offsetX, y: e.clientY - g.offsetY }))
    },
    onPointerUp() {
      const g = gesture.current
      gesture.current = null
      if (!g) return
      if (g.moved) save({ ...prefs, x: pos.x, y: pos.y })
      else if (prefs.minimized) save({ ...prefs, minimized: false }) // clique na faixa reabre
    },
    onPointerCancel() {
      gesture.current = null
    },
  }

  const style = { left: pos.x, top: pos.y }

  if (prefs.minimized) {
    return (
      <section className="panel turns-window minimized" aria-label="Turnos" style={style}>
        <header
          className="turns-header"
          role="button"
          tabIndex={0}
          title="Clique para abrir; arraste para mover"
          {...header}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' && e.key !== ' ') return
            e.preventDefault()
            save({ ...prefs, minimized: false })
          }}
        >
          <span className="turns-summary">{turnsSummary(turns)}</span>
        </header>
      </section>
    )
  }

  return (
    <section className="panel turns-window" aria-label="Turnos" style={style}>
      <header className="turns-header" title="Arraste para mover" {...header}>
        <strong>Turnos</strong>
        {turns.phase === 'combat' && <span className="turns-round">Rodada {turns.round}</span>}
        <span className="turns-header-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Minimizar"
            title="Minimizar"
            onClick={() => save({ ...prefs, minimized: true })}
          >
            <Minus size={16} aria-hidden />
          </button>
          {isGm && (
            <button
              type="button"
              className="icon-button"
              aria-label="Fechar para todos"
              title="Fechar para todos"
              onClick={() => actions.submit({ kind: 'turnsOpen', open: false })}
            >
              <X size={16} aria-hidden />
            </button>
          )}
        </span>
      </header>
      {turns.entries.length === 0 ? (
        <p className="turns-empty">
          {isGm ? 'Adicione participantes aqui embaixo ou pelo botão direito num token.' : 'Nenhum participante ainda.'}
        </p>
      ) : (
        <ol className="turns-list" onPointerLeave={() => actions.setTurnHover(null)}>
          {turns.entries.map((entry, index) => (
            <TurnCard
              key={entry.id}
              entry={entry}
              index={index}
              current={entry.id === turns.currentId}
              isGm={isGm}
              full={turns.entries.length >= TURNS_MAX}
            />
          ))}
        </ol>
      )}
      {isGm && <TurnsFooter turns={turns} />}
    </section>
  )
}

function TurnsFooter({ turns }: { turns: Turns }) {
  const actions = useTableActions()
  const [name, setName] = useState('')
  const full = turns.entries.length >= TURNS_MAX
  const empty = turns.entries.length === 0
  const missing = turns.entries.some((e) => e.initiative === null)

  const add = () => {
    const trimmed = name.trim().slice(0, TURN_NAME_MAX)
    if (!trimmed || full) return
    if (actions.submit({ kind: 'turnAdd', entry: { id: nanoid(), name: trimmed } })) setName('')
  }

  const end = async () => {
    const answer = await askChoice({
      title: 'Encerrar combate',
      message: 'Voltar à preparação. Manter os participantes zera as iniciativas; limpar tira todos da lista.',
      confirmLabel: 'Encerrar e manter participantes',
      alternativeLabel: 'Encerrar e limpar',
      alternativeDanger: true,
    })
    if (answer === 'confirm') actions.submit({ kind: 'turnsEnd', keep: true })
    if (answer === 'alternative') actions.submit({ kind: 'turnsEnd', keep: false })
  }

  const addForm = (
    <form
      className="turns-add"
      onSubmit={(e) => {
        e.preventDefault()
        add()
      }}
    >
      <input
        aria-label="Nome do participante"
        placeholder="Nome"
        maxLength={TURN_NAME_MAX}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <button type="submit" disabled={full || name.trim() === ''} title={full ? 'A ordem de turnos está cheia' : undefined}>
        Adicionar
      </button>
    </form>
  )

  if (turns.phase === 'prep') {
    return (
      <footer className="turns-footer">
        {addForm}
        <div className="turns-buttons">
          <button type="button" disabled={!missing} onClick={() => actions.submit({ kind: 'turnsRoll', all: false })}>
            Rolar iniciativa
          </button>
          <button type="button" disabled={empty} onClick={() => actions.submit({ kind: 'turnsRoll', all: true })}>
            Rolar de novo para todos
          </button>
          <button type="button" className="primary" disabled={empty} onClick={() => actions.submit({ kind: 'turnsStart' })}>
            Iniciar combate
          </button>
        </div>
      </footer>
    )
  }

  return (
    <footer className="turns-footer">
      <div className="turns-buttons">
        <button type="button" onClick={() => actions.submit({ kind: 'turnPrev' })}>
          Turno anterior
        </button>
        <button type="button" className="primary" onClick={() => actions.submit({ kind: 'turnNext' })}>
          Próximo turno
        </button>
      </div>
      {addForm}
      <div className="turns-buttons">
        <button type="button" className="danger" onClick={() => void end()}>
          Encerrar
        </button>
      </div>
    </footer>
  )
}
```

- [ ] **Step 8: Barra, página e estilos**

Em `apps/web/src/ui/Toolbar.tsx`:
1. No import de `lucide-react`, acrescente `Swords`.
2. Depois de `const isGm = ...`:

```ts
  const turnsOpen = useTable((s) => s.turns.open)
```

3. Logo depois do bloco `{isGm && ( <div className="pen-anchor" ref={gridAnchor} ...> ... </div> )}` e antes do botão de desfazer:

```tsx
      {isGm && (
        <button
          aria-label="Turnos"
          title="Turnos: abre ou fecha a ordem de turnos para todos"
          aria-pressed={turnsOpen}
          onClick={() => actions.submit({ kind: 'turnsOpen', open: !turnsOpen })}
        >
          <Swords size={ICON} aria-hidden />
        </button>
      )}
```

Em `apps/web/src/ui/TablePage.tsx`: acrescente `import { TurnsWindow } from './turns/TurnsWindow'` e, em `TableView`, logo depois do `<div className="panel topbar">...</div>`:

```tsx
      <TurnsWindow />
```

Em `apps/web/src/styles.css`:
1. Na regra `.modal-actions { display: flex; justify-content: flex-end; gap: 8px; }`, acrescente `flex-wrap: wrap;` (três botões cabem sem rolagem horizontal):

```css
.modal-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 8px; }
```

2. Na regra das barras de rolagem em hover, acrescente `.turns-list:hover` ao seletor:

```css
.chat-list:hover, .members:hover, .layers ul:hover, .popover:hover, .context-menu:hover, .modal:hover, .turns-list:hover { scrollbar-color: #6a6e7a rgba(0, 0, 0, 0.18); }
```

3. No fim do arquivo:

```css

/* Janela de turnos: só a lista rola, e só na vertical */
.turns-window { width: 320px; max-width: calc(100vw - 16px); display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; z-index: 15; font-size: 13px; overflow: hidden; box-sizing: border-box; }
.turns-window * { box-sizing: border-box; }
.turns-header { display: flex; align-items: center; gap: 8px; min-width: 0; cursor: move; user-select: none; touch-action: none; }
.turns-round { color: #ffd43b; font-weight: 600; }
.turns-header-actions { margin-left: auto; display: inline-flex; gap: 4px; }
.turns-window.minimized .turns-header { cursor: pointer; }
.turns-summary { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.turns-empty { margin: 0; color: #9aa0aa; }
.turns-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 4px; max-height: min(50vh, 420px); overflow-x: hidden; overflow-y: auto; }
.turn-card { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 4px 6px; border: 1px solid #3a3c45; border-radius: 6px; background: #26282e; }
.turn-card.current { border-color: #ffd43b; background: #3a3217; }
.turn-card.drop-target { box-shadow: inset 0 2px 0 #9db4ff; }
.turn-handle { display: inline-flex; flex: 0 0 auto; color: #9aa0aa; cursor: grab; }
.turn-thumb { flex: 0 0 auto; width: 28px; height: 28px; padding: 0; overflow: hidden; border-radius: 4px; }
.turn-thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.turn-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.turn-name.editable, .turn-init.editable { cursor: text; }
.turn-name-input { flex: 1 1 auto; min-width: 0; padding: 2px 6px; }
.turn-actions { display: inline-flex; flex: 0 0 auto; gap: 2px; opacity: 0; pointer-events: none; transition: opacity 0.1s; }
.turn-card:hover .turn-actions, .turn-card:focus-within .turn-actions { opacity: 1; pointer-events: auto; }
.turn-init { flex: 0 0 auto; min-width: 36px; text-align: center; font-size: 16px; font-weight: 700; color: #fff; }
.turn-init-input { flex: 0 0 56px; width: 56px; padding: 2px 4px; text-align: center; }
.turn-init-input[aria-invalid='true'] { border-color: #a33; }
.turns-footer { display: grid; gap: 6px; }
.turns-add { display: flex; gap: 4px; min-width: 0; }
.turns-add input { flex: 1 1 auto; min-width: 0; }
.turns-buttons { display: flex; flex-wrap: wrap; gap: 4px; }
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `pnpm --filter @mesa/web test test/turns-format.test.ts test/turns-prefs.test.ts test/confirm.test.ts`
Expected: PASS (inclui o teste "sem diálogos do navegador" e o de travessões da pasta `ui/turns`).

- [ ] **Step 10: Verificação completa na raiz**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde (os e2e existentes do aviso de confirmação continuam passando com dois botões).

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/ui apps/web/src/styles.css apps/web/test/turns-format.test.ts apps/web/test/turns-prefs.test.ts apps/web/test/confirm.test.ts
git commit -m "feat(turnos): janela de turnos, botão na barra e aviso com três escolhas" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Web: token na ordem pelo botão direito e anel da vez no mapa

**Files:**
- Create: `apps/web/src/canvas/turnRing.ts`
- Create: `apps/web/src/canvas/TurnHighlights.tsx`
- Modify: `apps/web/src/canvas/TableCanvas.tsx`
- Modify: `apps/web/src/ui/ObjectContextMenu.tsx`
- Test: `apps/web/test/turn-ring.test.ts`

**Interfaces:**
- Consumes (Task 4): `currentTurnToken`, `turnHover`, `actions.addTokenToTurns`; `rotatedBounds`, `useFrameClock`, `isLockedByOther`.
- Produces:
  - `turnRing(b: { minX; minY; maxX; maxY }, scale: number): { x; y; radiusX; radiusY }` (elipse em volta da caixa, folga de 6 px de tela);
  - `turnRingPulse(ms: number): { grow: number; opacity: number }` (período `TURN_RING_PERIOD_MS = 1200`; `grow` 0..6 px de tela, `opacity` 1..0.5);
  - nós Konva `name="turn-ring"` (vez) e `name="turn-hover"` (card sob o mouse), usados pelo e2e via `window.__stage.find('.turn-ring')`;
  - botão "Adicionar à ordem de turnos" no menu do objeto (mestre, objeto imagem).

- [ ] **Step 1: Write the failing test**

Crie `apps/web/test/turn-ring.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TURN_RING_PERIOD_MS, turnRing, turnRingPulse } from '../src/canvas/turnRing'

describe('anel da vez', () => {
  it('elipse no centro da caixa, com folga de 6 px de tela', () => {
    const box = { minX: 100, minY: 200, maxX: 170, maxY: 240 }
    expect(turnRing(box, 1)).toEqual({ x: 135, y: 220, radiusX: 41, radiusY: 26 })
    expect(turnRing(box, 2)).toEqual({ x: 135, y: 220, radiusX: 38, radiusY: 23 })
  })

  it('pulso: cresce até 6 px e volta; a opacidade cai junto', () => {
    expect(turnRingPulse(0)).toEqual({ grow: 3, opacity: 0.75 })
    const peak = turnRingPulse(TURN_RING_PERIOD_MS / 4)
    expect(peak.grow).toBeCloseTo(6)
    expect(peak.opacity).toBeCloseTo(0.5)
    const low = turnRingPulse((TURN_RING_PERIOD_MS * 3) / 4)
    expect(low.grow).toBeCloseTo(0)
    expect(low.opacity).toBeCloseTo(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @mesa/web test test/turn-ring.test.ts`
Expected: FAIL (módulo não existe).

- [ ] **Step 3: Geometria e pulso**

Crie `apps/web/src/canvas/turnRing.ts`:

```ts
export const TURN_RING_PERIOD_MS = 1200
/** Folga entre a caixa do token e o anel, em px de tela. */
const RING_PAD_PX = 6
/** Quanto o anel cresce no pico do pulso, em px de tela. */
const RING_GROW_PX = 6

/** Elipse em volta da caixa (já girada) do token, em coordenadas do mapa. */
export function turnRing(
  b: { minX: number; minY: number; maxX: number; maxY: number },
  scale: number,
): { x: number; y: number; radiusX: number; radiusY: number } {
  const pad = RING_PAD_PX / scale
  return {
    x: (b.minX + b.maxX) / 2,
    y: (b.minY + b.maxY) / 2,
    radiusX: (b.maxX - b.minX) / 2 + pad,
    radiusY: (b.maxY - b.minY) / 2 + pad,
  }
}

/** Pulso contínuo do anel da vez: `grow` em px de tela; mais aberto = mais transparente. */
export function turnRingPulse(ms: number): { grow: number; opacity: number } {
  const t = (Math.sin((ms / TURN_RING_PERIOD_MS) * 2 * Math.PI) + 1) / 2
  return { grow: RING_GROW_PX * t, opacity: 1 - 0.5 * t }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @mesa/web test test/turn-ring.test.ts`
Expected: PASS.

- [ ] **Step 5: Camada do anel**

Crie `apps/web/src/canvas/TurnHighlights.tsx`:

```tsx
import { Ellipse, Layer } from 'react-konva'
import type { ImageObject } from '@mesa/shared'
import { useTable } from '../store/context'
import { isLockedByOther } from '../store/reducers'
import { currentTurnToken } from '../store/turns'
import { rotatedBounds } from './bounds'
import { useFrameClock } from './hooks'
import { turnRing, turnRingPulse } from './turnRing'

const CURRENT_COLOR = '#ffd43b'
const HOVER_COLOR = '#9db4ff'

/**
 * Anel da vez (pulsante, para todos que têm o token no estado) e destaque do card sob o mouse
 * (tracejado, só na minha tela). Fica acima de todas as camadas e não recebe cliques.
 */
export function TurnHighlights() {
  const current = useTable(currentTurnToken)
  const hovered = useTable((s) => {
    const o = s.turnHover ? s.objects[s.turnHover] : undefined
    return o?.type === 'image' ? o : null
  })
  if (!current && !hovered) return null
  return (
    <Layer listening={false}>
      {hovered && hovered.id !== current?.id && <TokenRing object={hovered} pulse={false} />}
      {current && <TokenRing object={current} pulse />}
    </Layer>
  )
}

function TokenRing({ object, pulse }: { object: ImageObject; pulse: boolean }) {
  const scale = useTable((s) => s.viewport.scale)
  const lockedByOther = useTable((s) => isLockedByOther(s, object.id, Date.now()))
  const preview = useTable((s) => s.dragPreviews[object.id])
  const own = useTable((s) => s.ownDragPreviews[object.id])
  const now = useFrameClock(pulse)
  // Mesma regra do título (ObjectDecorations): acompanha o meu arrasto e o de quem trava o token.
  const g = own ?? (lockedByOther && preview ? preview : object)
  const ring = turnRing(rotatedBounds(g), scale)
  const { grow, opacity } = pulse ? turnRingPulse(now) : { grow: 0, opacity: 0.9 }
  return (
    <Ellipse
      name={pulse ? 'turn-ring' : 'turn-hover'}
      x={ring.x}
      y={ring.y}
      radiusX={ring.radiusX + grow / scale}
      radiusY={ring.radiusY + grow / scale}
      stroke={pulse ? CURRENT_COLOR : HOVER_COLOR}
      strokeWidth={(pulse ? 4 : 2) / scale}
      dash={pulse ? undefined : [8 / scale, 5 / scale]}
      opacity={opacity}
    />
  )
}
```

Em `apps/web/src/canvas/TableCanvas.tsx`: acrescente `import { TurnHighlights } from './TurnHighlights'` e, no JSX do `Stage`, logo antes de `<Overlay />`:

```tsx
      <TurnHighlights />
```

- [ ] **Step 6: Menu do token**

Em `apps/web/src/ui/ObjectContextMenu.tsx`:
1. No import de `lucide-react`, acrescente `Swords`; no import de `@mesa/shared`, acrescente `TURNS_MAX`.
2. Em `ObjectMenuBody`, logo antes de `{layerEditable && (` (botão Apagar):

```tsx
      {isGm && object.type === 'image' && <AddToTurns objectId={object.id} onDone={onClose} />}
```

3. Novo componente no fim do arquivo:

```tsx
function AddToTurns({ objectId, onDone }: { objectId: string; onDone: () => void }) {
  const full = useTable((s) => s.turns.entries.length >= TURNS_MAX)
  const actions = useTableActions()
  return (
    <button
      disabled={full}
      title={full ? 'A ordem de turnos está cheia (máximo 50)' : undefined}
      onClick={() => {
        actions.addTokenToTurns(objectId)
        onDone()
      }}
    >
      <Swords size={16} aria-hidden /> Adicionar à ordem de turnos
    </button>
  )
}
```

- [ ] **Step 7: Verificação completa na raiz**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde (o e2e "modais e menus cabem na janela 1280x720 sem rolagem" continua passando com o botão novo no menu do objeto).

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/canvas/turnRing.ts apps/web/src/canvas/TurnHighlights.tsx apps/web/src/canvas/TableCanvas.tsx apps/web/src/ui/ObjectContextMenu.tsx apps/web/test/turn-ring.test.ts
git commit -m "feat(turnos): token na ordem pelo botão direito e anel da vez no mapa" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: E2E com mestre e jogador

**Files:**
- Modify: `e2e/table.spec.ts` (fim do arquivo)

**Interfaces:**
- Consumes: helpers existentes do arquivo (`newTable`, `open`, `waitOpen`, `objects`, `uploadToken`, `openObjectMenu`, `trackNativeDialogs`, `confirmDialog`); DOM e nomes da Task 5; nó Konva `.turn-ring` da Task 6; `window.__mesa` e `window.__stage` (com `?debug=1`).
- Produces: dois testes e2e de turnos.

- [ ] **Step 1: Write the tests**

Acrescente no fim de `e2e/table.spec.ts`:

```ts
// ── Turnos ──────────────────────────────────────────────────────────────────

const turnsWindow = (page: Page) => page.getByRole('region', { name: 'Turnos' })
const turnCards = (page: Page) => turnsWindow(page).locator('.turn-card')
const turnNames = (page: Page) => turnsWindow(page).locator('.turn-name')
const turnInits = (page: Page) => turnsWindow(page).locator('.turn-init')
const turnsState = (page: Page) => page.evaluate(() => (window as any).__mesa.getState().turns)
const ringCount = (page: Page): Promise<number> => page.evaluate(() => (window as any).__stage.find('.turn-ring').length)

test('turnos: mestre monta pelo token, duplica, rola e inicia; jogador acompanha a vez e o anel; encerrar mantendo participantes', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')
  const dialogs = trackNativeDialogs(gm, player)

  await uploadToken(gm)
  await expect.poll(async () => (await objects(player)).length).toBe(1)
  const [token] = await objects(gm)

  // jogador não tem o botão da barra; ninguém vê a janela ainda
  await expect(player.getByRole('button', { name: 'Turnos', exact: true })).toHaveCount(0)
  await expect(turnsWindow(player)).toHaveCount(0)

  // botão direito no token: adicionar abre a janela para todos
  const menu = await openObjectMenu(gm, token)
  await menu.getByRole('button', { name: 'Adicionar à ordem de turnos' }).click()
  await expect(turnsWindow(player)).toBeVisible()
  await expect(turnNames(player)).toHaveText(['Token'])
  await expect(turnInits(player)).toHaveText(['?'])

  // duplicar (o botão aparece com o mouse sobre o card) e um participante livre
  const first = turnCards(gm).first()
  await first.hover()
  await first.getByRole('button', { name: 'Duplicar Token', exact: true }).click()
  await turnsWindow(gm).getByLabel('Nome do participante').fill('Goblin')
  await turnsWindow(gm).getByRole('button', { name: 'Adicionar', exact: true }).click()
  await expect(turnNames(player)).toHaveText(['Token', 'Token 2', 'Goblin'])

  // iniciativa digitada no card: fora do limite é recusada; -99 deixa o Goblin por último depois da rolagem
  await turnCards(gm).nth(2).locator('.turn-init').click()
  const initField = turnsWindow(gm).getByLabel('Iniciativa de Goblin')
  await initField.fill('1000')
  await expect(initField).toHaveAttribute('aria-invalid', 'true')
  await initField.fill('-99')
  await initField.press('Enter')
  await expect(turnInits(player)).toHaveText(['?', '?', '-99'])

  // rolar só quem está sem valor
  await turnsWindow(gm).getByRole('button', { name: 'Rolar iniciativa', exact: true }).click()
  await expect.poll(async () => (await turnsState(player)).entries.every((e: any) => e.initiative !== null)).toBe(true)
  await expect(turnNames(player).last()).toHaveText('Goblin')
  const rolled: number[] = (await turnsState(player)).entries.slice(0, 2).map((e: any) => e.initiative)
  for (const v of rolled) {
    expect(v).toBeGreaterThanOrEqual(1)
    expect(v).toBeLessThanOrEqual(20)
  }
  expect(rolled[0]).toBeGreaterThanOrEqual(rolled[1])

  // iniciar: o jogador vê a rodada, o card da vez e o anel no token
  await turnsWindow(gm).getByRole('button', { name: 'Iniciar combate', exact: true }).click()
  await expect(turnsWindow(player)).toContainText('Rodada 1')
  await expect(turnCards(player).nth(0)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => ringCount(player)).toBe(1)

  // "Próximo" avança nos dois; o Goblin não tem token (sem anel); a virada soma a rodada
  const next = turnsWindow(gm).getByRole('button', { name: 'Próximo turno', exact: true })
  await next.click()
  await expect(turnCards(player).nth(1)).toHaveAttribute('aria-current', 'true')
  await expect(turnCards(gm).nth(1)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => ringCount(player)).toBe(1)
  await next.click()
  await expect(turnCards(player).nth(2)).toHaveAttribute('aria-current', 'true')
  await expect.poll(() => ringCount(player)).toBe(0)
  await next.click()
  await expect(turnsWindow(player)).toContainText('Rodada 2')
  await expect(turnCards(player).nth(0)).toHaveAttribute('aria-current', 'true')

  // jogador: sem controles, sem alças; a miniatura centraliza a própria câmera
  for (const name of ['Adicionar', 'Próximo turno', 'Turno anterior', 'Encerrar', 'Fechar para todos']) {
    await expect(turnsWindow(player).getByRole('button', { name, exact: true })).toHaveCount(0)
  }
  await expect(turnsWindow(player).locator('.turn-handle')).toHaveCount(0)
  await turnCards(player).first().hover()
  await expect(turnsWindow(player).getByRole('button', { name: /^(Duplicar|Remover) / })).toHaveCount(0)
  await turnCards(player).first().getByRole('button', { name: 'Centralizar em Token', exact: true }).click()
  await expect
    .poll(() => player.evaluate(() => Math.round((window as any).__mesa.getState().viewport.x)))
    .toBe(Math.round(640 - (token.x + token.width / 2)))

  // sem rolagem horizontal na janela
  expect(await turnsWindow(player).evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true)

  // encerrar mantendo os participantes, pelo aviso do app
  await turnsWindow(gm).getByRole('button', { name: 'Encerrar', exact: true }).click()
  const dialog = confirmDialog(gm)
  await expect(dialog.getByRole('button')).toHaveText(['Cancelar', 'Encerrar e limpar', 'Encerrar e manter participantes'])
  await dialog.getByRole('button', { name: 'Encerrar e manter participantes' }).click()
  await expect(turnInits(player)).toHaveText(['?', '?', '?'])
  await expect(turnNames(player)).toHaveText(['Token', 'Token 2', 'Goblin'])
  await expect(turnsWindow(player)).not.toContainText('Rodada')
  await expect(turnsWindow(gm).getByRole('button', { name: 'Iniciar combate', exact: true })).toBeVisible()
  expect(dialogs).toEqual([])
})

test('turnos: cada um minimiza a própria janela (lembrada ao recarregar); o mestre fecha para todos', async ({ browser, page }) => {
  const { tableId, gmSecret } = await newTable(page)
  const gm = await open(browser, `/t/${tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  const player = await open(browser, `/t/${tableId}?debug=1`, 'Ana')

  const toolbarButton = gm.getByRole('button', { name: 'Turnos', exact: true })
  await toolbarButton.click()
  await expect(toolbarButton).toHaveAttribute('aria-pressed', 'true')
  await expect(turnsWindow(player)).toBeVisible()
  await expect(turnsWindow(player)).toContainText('Nenhum participante ainda.')
  await expect(turnsWindow(gm).getByRole('button', { name: 'Iniciar combate', exact: true })).toBeDisabled()

  await turnsWindow(gm).getByLabel('Nome do participante').fill('Ana')
  await turnsWindow(gm).getByLabel('Nome do participante').press('Enter')
  await turnsWindow(gm).getByRole('button', { name: 'Iniciar combate', exact: true }).click()
  await expect(turnsWindow(player)).toContainText('Rodada 1')

  // minimizar é só da minha janela, e é lembrado ao recarregar
  await turnsWindow(player).getByRole('button', { name: 'Minimizar' }).click()
  await expect(turnsWindow(player)).toHaveText('Rodada 1 · Vez de: Ana')
  await expect(turnCards(gm)).toHaveCount(1)
  await player.reload()
  await waitOpen(player)
  await expect(turnsWindow(player)).toHaveText('Rodada 1 · Vez de: Ana')
  await turnsWindow(player).getByRole('button', { name: 'Rodada 1 · Vez de: Ana' }).click()
  await expect(turnCards(player)).toHaveCount(1)

  // fechar é do mestre e vale para todos
  await turnsWindow(gm).getByRole('button', { name: 'Fechar para todos' }).click()
  await expect(turnsWindow(player)).toHaveCount(0)
  await expect(turnsWindow(gm)).toHaveCount(0)
  await expect(toolbarButton).toHaveAttribute('aria-pressed', 'false')
})
```

- [ ] **Step 2: Run the new tests**

Run: `pnpm e2e -g "turnos"`
Expected: 2 passed. Se algum falhar, diagnostique pela causa (superpowers:systematic-debugging); não afrouxe as asserções do spec.

- [ ] **Step 3: Verificação completa na raiz**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde.

- [ ] **Step 4: Commit**

```bash
git add e2e/table.spec.ts
git commit -m "test(turnos): e2e do controle de turnos com mestre e jogador" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-Review

**1. Cobertura do spec:**
- §2 estado/limites/padrão → Task 1 (`TurnsSchema`, `DEFAULT_TURNS`, `parseTurns`), Task 2 (tabela `turns`, contrato), Task 3 (welcome).
- §3 ações e regras (fase, duplicar com sufixo, não reordenar, remover a da vez, lista vazia, rolagem estável, start, next/prev, end keep) → Task 1 (puras), Task 2 (engine, permissão, d20 imparcial, token ligado), Task 3 (difusão).
- §3 extras: `invalid`, token apagado, otimismo exceto rolagem, ids no cliente, fora do Ctrl+Z, welcome + broadcast sem filtro → Tasks 2, 3, 4.
- §4 barra (Swords), janela (topo, 320 px, arrastável, minimizar por pessoa em `localStorage`, fechar do mestre, minimizada com resumo, rolagem só vertical), card (alça, miniatura, nome, "?", vez realçada e rolada até ela, duplicar/remover no hover, edição inline com Enter/blur/Esc, hover destaca o token, miniatura centraliza), rodapé (preparação/combate, "Encerrar" com 3 escolhas) → Task 5; mapa (menu do token, anel pulsante que acompanha o arrasto, só para quem enxerga) → Task 6; jogadores sem controles → Tasks 5 e 7.
- §5 bordas: jogador rejeitado (T2/T3), dois "Próximo" (T2 idempotência, T4 Review Focus #1), fora da fase com botão desativado (T1/T2, T5), nome vazio (T5 `NameField`, botão desativado), iniciativa recusada no campo (T5 + e2e), 51ª entrada com botões desativados (T1/T2, T5 `full`, T6 menu), mesa antiga (T2 `parseTurns`/SqlStore).
- §6 testes: shared (T1), engine (T2), DO (T3), web reducers/sufixo/prefs (T4/T5), e2e 2 usuários (T7).

**2. Placeholders:** nenhum "TBD"/"TODO"; os ganchos da Task 2 em `reducers.ts` têm o código exato e a troca exata na Task 4.

**3. Consistência de tipos/nomes:** `applyTurnOp(turns, op, d20?)`, `isTurnOp(op): op is TurnOp`, `getTurns/putTurns`, efeito `{ kind: 'turns'; turns }`, mensagem `turnsUpdated`, `confirmedTurns`/`turns`/`turnHover`, `recomputeTurns`/`ackTurnOp`/`currentTurnToken`/`turnNameFor`, `addTokenToTurns`/`setTurnHover`/`focusObject`, `askChoice`/`ConfirmAnswer`/`alternativeLabel`/`alternativeDanger`, `readTurnsPrefs`/`writeTurnsPrefs`/`defaultPosition`/`clampPosition`, `turnRing`/`turnRingPulse`/`TURN_RING_PERIOD_MS`, nó `.turn-ring`: usados igual em todas as tasks.

**4. Review Focus:** os cinco itens têm teste na task dona (T4 #1, T2+T4 #2, T4 #3, T1 #4, T4 #5).
