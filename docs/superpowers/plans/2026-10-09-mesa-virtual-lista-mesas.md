# Mesa Virtual: lista de mesas, vínculo entre sessões, excluir jogador e novos links (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O mestre abre o programa e vê, só no próprio PC, as mesas que criou (com links de mestre e de jogador montados com o túnel atual, renomear, apagar, gerar novos links); jogadores e mestre continuam donos das próprias coisas entre sessões; o mestre pode excluir jogadores.

**Architecture:** Um Durable Object novo, `RegistryDO` (nome fixo `registry`, SQLite), guarda uma linha por mesa e, só em memória, o endereço do túnel. As rotas `/api/registry/*` e `POST /api/tables` só respondem a pedidos **locais** (`isLocalRequest`: Host de loopback e nenhum cabeçalho da borda da Cloudflare). O `TableDO` ganha métodos RPC (renomear, apagar, chaves de arquivo, trocar chave/segredo) e avisa o índice da atividade. O `hello` ganha "assumir membro" (apelido de jogador fora da mesa ou segredo de mestre) e a exigência da chave de jogador (`#j=`). A página `/` (servida como asset estático) consulta `GET /api/registry/tables`: 200 mostra a lista; 404 mostra "Peça o link da mesa ao mestre". O launcher abre `http://localhost:<porta>/` e informa o túnel com `POST /api/registry/tunnel`.

**Tech Stack:** TypeScript 7, pnpm, Node 24, Zod 4, Cloudflare Workers + Durable Objects (SQLite, RPC), Wrangler 4.148 (`wrangler dev --persist-to`, nunca deploy), Vitest (shared/web 5.x; worker via `@cloudflare/vitest-pool-workers` 0.23; launcher 5.x), React 19, Zustand 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-09-mesa-virtual-lista-mesas-design.md` (inclui §7a e §7b do commit 80ae021). Este plano roda **depois** dos planos de turnos (`docs/superpowers/plans/2026-10-09-mesa-virtual-turnos.md`) e da seleção (`docs/superpowers/plans/2026-10-09-mesa-virtual-selecao.md`) no mesmo branch. Referências ao código são por símbolo (função, método, `case`), não por número de linha: os planos anteriores mudam as linhas. Se um trecho citado como "antes" tiver ganhado linhas dos planos anteriores, preserve-as.

**Evidência para a regra "só local" (verificada neste PC, wrangler 4.148, scratch na porta 8799):**
- Pedido direto (`curl http://127.0.0.1:8799/x`): o Worker vê `host: 127.0.0.1:8799`, `request.url = http://127.0.0.1:8799/x` e **um único cabeçalho extra, `cf-connecting-ip: 127.0.0.1`, que o próprio wrangler/miniflare põe**. Não há `cf-ray`, `cf-visitor`, `cdn-loop`, `cf-ipcountry`.
- `Host: localhost:5173` (o proxy do Vite, `changeOrigin` desligado) chega como `request.url = http://localhost:5173/...`: o `hostname` do `request.url` vem do `Host`.
- Pedido simulando o túnel (`Host: abc-def.trycloudflare.com`, `cf-ray`, `cf-connecting-ip: 200.1.2.3`): o miniflare **mantém** o `cf-connecting-ip` recebido (não sobrescreve com 127.0.0.1) e o `request.url` vira `http://abc-def.trycloudflare.com/...`.
- `cloudflared` não está instalado aqui. Pelo funcionamento documentado do Quick Tunnel: a borda da Cloudflare recebe o pedido pelo nome `*.trycloudflare.com` (o cliente não escolhe outro `Host`, a borda roteia por ele), sobrescreve `cf-connecting-ip` com o IP real e acrescenta `cf-ray`, `cf-visitor`, `cf-ipcountry`, `cdn-loop: cloudflare`, `x-forwarded-for/proto`; o `cloudflared` repassa ao `http://127.0.0.1:<porta>` mantendo o `Host` público (só troca com `--http-host-header`, que o launcher não usa) e acrescenta `cf-warp-tag-id`. Logo, pelo túnel, **três sinais independentes** falham na regra (Host, `cf-ray`, IP), e nenhum deles pode ser removido pelo visitante.
- O launcher sobe o wrangler com `--ip 127.0.0.1`: ninguém da rede chega direto na porta; só processos do próprio PC (e o `cloudflared`, que traz os cabeçalhos da borda).
- Também verificado no scratch: em DO SQLite, `ctx.storage.deleteAll()` apaga as tabelas (`no such table` logo depois); é preciso recriar o esquema (o plano recria o `SqlStore`).
- **Decisão:** não há token de administrador do launcher. Os sinais acima bastam e um token quebraria `pnpm dev`, `pnpm host` e o E2E.

**Decisões tomadas onde o spec é omisso (o executor não deve rediscutir):**
- `isLocalRequest(request)`: `new URL(request.url).hostname` em `{localhost, 127.0.0.1, [::1]}` (qualquer porta) **e** nenhum de `cf-ray`, `cf-visitor`, `cf-ipcountry`, `cdn-loop`, `cf-warp-tag-id` **e** `cf-connecting-ip` ausente ou `127.0.0.1`/`::1`. Pedido não local em `/api/registry/*` ou `POST /api/tables` → `404 {"error":"not_found"}`.
- A página `/` é asset estático (o Worker não roda nela: `run_worker_first` só cobre `/api/*` e `/files/*`); quem decide "local ou não" é a resposta de `GET /api/registry/tables` (404 = de fora).
- Rotas do índice (todas locais): `GET /api/registry/tables` → `{ tables, tunnelUrl }`; `POST /api/registry/tunnel { url }` → 204; `PATCH /api/registry/tables/:id { name }` → 204; `DELETE /api/registry/tables/:id` → 204; `POST /api/registry/tables/:id/player-link` e `/gm-link` → 204. Corpo inválido → 400; mesa fora do índice → 404.
- `RegistryTable = { id, name, createdAt, lastActivityAt, players, gmSecret, playerKey }`; `playerKey: string | null` (coluna criada já na Task 1, sempre `null` até a Task 9). Lista ordenada por `lastActivityAt` desc (desempate: mais nova primeiro).
- `players` = número de membros com papel jogador conhecidos pela mesa. O `TableDO` avisa (`touchTable`) no máximo uma vez a cada 60 s **ou** na hora em que esse número muda (no `hello`, numa op aplicada e numa mensagem de chat). Controle só em memória (`ActivityReporter`).
- Endereço do túnel: aceita `null` ou origem `https://host[:porta]` sem caminho (`TunnelUrlSchema`). Fica só em memória do `RegistryDO`; o launcher repete o aviso a cada 30 s enquanto houver túnel e na hora em que o túnel muda, cai ou o servidor reinicia (cobre o despejo do DO ocioso e o reinício do wrangler).
- Página local recarrega a lista a cada 10 s com a aba visível (pega o túnel informado depois que o navegador abriu).
- "Abrir como mestre" é um link **relativo** (`/t/<id>#gm=<segredo>`, a origem local atual). "Copiar link de mestre/jogador" usa o túnel; sem túnel, a origem local.
- Apagar mesa: `TableDO.deleteTable()` manda `{ t: 'error', reason: 'table_deleted' }` e fecha os sockets (4410) antes do `deleteAll`; depois o índice apaga a linha e o R2 apaga as chaves da mesa que **nenhuma outra mesa do índice** usa (objetos `image` e imagens do chat). Mesas antigas, fora do índice, não contam.
- Tela da mesa apagada: "A mesa foi apagada", link "Voltar à página inicial" e ida automática para `/` em 3 s.
- Renomear avisa quem está na mesa com `{ t: 'tableRenamed', name }`.
- Vínculo: só para `hello` com `v: 2` e `clientId` **desconhecido** na mesa. Mestre (segredo válido) → assume o membro mestre mais recente (mesmo online). Jogador → apelido igual (ignora maiúsculas/minúsculas e espaços nas pontas, `normalizeNickname`) ao de alguém **online** → `{ t: 'error', reason: 'nickname_taken' }` e fecha (4409); igual ao de um **jogador** fora da mesa (sem limite de idade; o mais recente se houver vários) → assume esse membro; igual só ao do mestre → entra como jogador novo. Ao assumir, um `clientSecret` novo é emitido (o do navegador antigo deixa de valer).
- O navegador guarda o `clientId` assumido **por mesa** (`mesa:clientId:<tableId>`); o `mesa:clientId` global continua para as outras mesas.
- "Já jogou aqui?": `GET /api/tables/:id/members` (funciona pelo túnel) → `{ players: [{ nickname, color }] }`, jogadores fora da mesa vistos nos últimos 7 dias, mais recentes primeiro; nunca leva `clientId`. A partir da Task 9 exige a chave de jogador no cabeçalho `X-Mesa-Key` (403 sem ela); o cliente usa o 403 para mostrar "Este link expirou..." antes de pedir o apelido. Com segredo de mestre guardado, o cliente não consulta a lista.
- Botões de "Já jogou aqui?" têm como nome acessível só o apelido (nada de "Entrar como...", para não colidir com o botão "Entrar").
- Excluir jogador: a op `memberRemove` ganha `deleteItems: boolean` (obrigatório) e passa a valer online. Alvo mestre → `forbidden`. Apagar: todos os objetos com `ownerId` dele, em todas as camadas, com as anotações. Manter: objetos dele ficam com `ownerId: ORPHAN_OWNER_ID` (`'orphan'`, nunca um uuid válido de `hello`) e `control: { mode: 'gm', clientIds: [] }`; nos objetos de outros, ele sai da lista de controle (lista vazia com modo `list` vira modo `gm`). As travas dele são soltas. As atualizações vão a todos, inclusive ao mestre que pediu (`echo`). O excluído online recebe `{ t: 'error', reason: 'removed' }` e é fechado (4403): "Você foi removido da mesa".
- Modal de excluir: `askChoice` (vem do plano de turnos): título `Excluir <nome> da mesa?`, botões "Cancelar", "Excluir e apagar as coisas dele" (alternativa, vermelho) e "Excluir e manter as coisas" (principal, recebe o foco: o caminho menos destrutivo). O X dos offline continua com o nome acessível `Remover <nome> da lista` e abre o mesmo modal. "Excluir jogador" fica no menu do membro, na tela de "Editar apelido e cor", só para o mestre e só em alvo jogador.
- Chave de jogador: `randomSecret()` gerada ao criar; hash no `TableDO` (tabela `player_key`), texto no índice. Mesa sem hash guardado (antiga) não exige chave. O `hello` com segredo de mestre válido não precisa de chave; sem ele, chave errada ou ausente → `{ t: 'error', reason: 'link_expired' }` e fecha (4403), inclusive para quem volta com `clientSecret` guardado. Quem está conectado não é derrubado ao gerar link novo.
- O cliente lê `#gm=` e `#j=` numa passada só (`captureLinkSecrets`), guarda por mesa (`mesa:gm:<id>`, `mesa:key:<id>`) e limpa o fragmento.
- Modais de gerar link: `askConfirm` com título "Gerar novo link de jogador" / "Gerar novo link de mestre", texto "O link de jogador atual vai parar de funcionar. Quem já está na mesa continua conectado." / "O link de mestre atual vai parar de funcionar. Quem já está na mesa continua conectado.", botão "Gerar novo link".
- O estado do E2E (`apps/worker/.wrangler/e2e-state`) persiste entre execuções: o índice acumula mesas de execuções anteriores. Testes E2E da lista sempre localizam cards por nomes únicos (`Date.now()`) e nunca contam a lista inteira.

## Global Constraints

- **Texto da interface em pt-BR**; identificadores em inglês. Textos do spec copiados literalmente: "Peça o link da mesa ao mestre", "Túnel indisponível, só local", "Abrir como mestre", "Copiar link de mestre", "Copiar link de jogador", "Renomear", "Apagar", "Apagar a mesa <nome>? Desenhos, tokens, chat e turnos serão perdidos.", "A mesa foi apagada", "Esse apelido está em uso na mesa agora", "Já jogou aqui? Clique no seu nome", "Excluir jogador", "Excluir <nome> da mesa?", "Excluir e apagar as coisas dele", "Excluir e manter as coisas", "Cancelar", "Você foi removido da mesa", "Gerar novo link de jogador", "Gerar novo link de mestre", "Este link expirou. Peça o link novo ao mestre".
- **Nenhum travessão (`—` U+2014, `–` U+2013) em texto visível** (rótulos, títulos, `aria-label`, `title`, avisos, toasts, mensagens do launcher, README).
- **Nenhum diálogo nativo do navegador** (`window.confirm/alert/prompt`): use `askConfirm`/`askChoice` de `apps/web/src/ui/confirm.ts` (há teste que varre `apps/web/src`).
- **Sem custo e sem deploy:** tudo roda em `wrangler dev --persist-to`; não use `wrangler deploy`, não crie recursos na Cloudflare. Adicionar a classe `RegistryDO` exige a migração `{ "tag": "v2", "new_sqlite_classes": ["RegistryDO"] }`.
- **Git:** branch atual. **Exatamente um commit por task**, com `git commit -m "<assunto>" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`. **Nunca `git push`**, nunca `--amend`.
- **Ao fim de cada task, na raiz:** `pnpm typecheck`, `pnpm test` e `pnpm e2e` verdes.
- **E2E só na porta 8788** (`pnpm e2e` sobe o próprio wrangler). Nunca rode `pnpm build`, `pnpm host`, `pnpm dev:*`, nunca mexa nos servidores das portas 8787 e 5173 nem em `apps/worker/.wrangler/state`.
- Não adicione dependências nem troque versões.
- Mesas criadas antes desta versão são ignoradas: não aparecem na lista, não há migração.

## Review Focus

1. **Mestre usando o Vite (`http://localhost:5173`) ou `http://[::1]:8787`:** precisa contar como local; um Host parecido (`localhost.evil.com`) não → teste na Task 1 (`isLocalRequest`).
2. **Mesa apagada enquanto alguém reconecta:** a reconexão recebe "mesa não encontrada", nunca uma mesa vazia recriada → teste na Task 2.
3. **Mestre abre o link de mestre num segundo navegador com o primeiro aberto:** fica uma linha só de mestre na lista de membros → teste na Task 4.
4. **O wrangler cai e o launcher o reinicia com o túnel no ar:** a página volta a mostrar o link do túnel (o índice perdeu a memória) → teste na Task 7.
5. **Mestre exclui um jogador que está segurando um token:** a trava é solta para todos e o token passa a ser só do mestre → teste na Task 8.

---

## Mapa de arquivos

```
packages/shared/src/registry.ts      # NOVO (T1): TABLE_NAME_MAX, TableNameSchema, TunnelUrlSchema, TunnelReportSchema,
                                     #   ACTIVITY_REPORT_MS, RegistryTable, RegistryView; T4: KnownPlayer, normalizeNickname
packages/shared/src/index.ts         # T1: export * from './registry'
packages/shared/src/protocol.ts      # T2: ServerErrorReason, tableRenamed; T4/T8/T9: motivos novos; T8: memberRemove.deleteItems; T9: hello.playerKey
packages/shared/src/model.ts         # T8: ORPHAN_OWNER_ID
packages/shared/test/registry.test.ts  # NOVO (T1, T4)

apps/worker/wrangler.jsonc           # T1: REGISTRY + migração v2
apps/worker/worker-configuration.d.ts  # T1: regenerado (wrangler types)
apps/worker/src/local.ts             # NOVO (T1): isLocalRequest
apps/worker/src/registry-do.ts       # NOVO (T1): RegistryDO, registryStub; T10: setPlayerKey, setGmSecret
apps/worker/src/registry-api.ts      # NOVO (T1): handleRegistry; T2: renomear/apagar; T10: novos links
apps/worker/src/activity.ts          # NOVO (T3): ActivityReporter
apps/worker/src/index.ts             # T1, T4 (/members), T9 (chave ao criar)
apps/worker/src/table-do.ts          # T2, T3, T4, T8, T9, T10
apps/worker/src/engine/{store,sql-store,memory-store}.ts  # T2 renameTable; T9 player key; T10 gm secret
apps/worker/src/engine/engine.ts     # T4 matchNickname/gmMember/knownPlayers; T8 memberRemove
apps/worker/test/helpers.ts          # T1 (LOCAL), T9 (chave automática)
apps/worker/test/registry.test.ts    # NOVO (T1, T2, T3, T10)
apps/worker/test/activity.test.ts    # NOVO (T3)
apps/worker/test/{table-do,engine,sql-store,store-contract}.ts  # T2, T4, T8, T9

apps/web/src/lib/registry.ts         # NOVO (T6): loadRegistry, renameTable, deleteTable, tableLinks, ...; T10 rotateLink
apps/web/src/lib/api.ts              # T5: fetchKnownPlayers; T9: chave
apps/web/src/lib/identity.ts         # T5: id por mesa; T9: captureLinkSecrets, readPlayerKey
apps/web/src/store/{state,reducers,tableStore}.ts  # T2, T5, T8, T9
apps/web/src/ui/HomePage.tsx         # T6 (reescrito), T10
apps/web/src/ui/HomeView.tsx         # NOVO (T6), T10
apps/web/src/ui/TablePage.tsx        # T2, T5, T8, T9
apps/web/src/ui/NicknameModal.tsx    # T5
apps/web/src/ui/{MembersPanel,MemberMenu,memberMenuOptions}.tsx/ts  # T8
apps/web/src/ui/removeMember.ts      # NOVO (T8)
apps/web/src/styles.css              # T5, T6
apps/web/test/*.test.ts(x)           # T2, T5, T6, T8, T9, T10

apps/launcher/src/registry.mjs       # NOVO (T7): reportTunnel, repeatEvery
apps/launcher/src/main.mjs, messages.mjs  # T7
apps/launcher/test/{registry,main,readme}.test.mjs  # T7
README.md                            # T7, T10

e2e/table.spec.ts                    # T5, T6, T8, T9, T10
```

---

### Task 1: Índice de mesas e acesso só local

**Files:**
- Create: `packages/shared/src/registry.ts`, `packages/shared/test/registry.test.ts`
- Modify: `packages/shared/src/index.ts`
- Create: `apps/worker/src/local.ts`, `apps/worker/src/registry-do.ts`, `apps/worker/src/registry-api.ts`, `apps/worker/test/registry.test.ts`
- Modify: `apps/worker/src/index.ts`, `apps/worker/wrangler.jsonc`, `apps/worker/worker-configuration.d.ts` (regenerado), `apps/worker/test/helpers.ts`, `apps/worker/test/table-do.test.ts`

**Interfaces:**
- Consumes: `randomId`, `randomSecret`, `sha256Hex` (`apps/worker/src/crypto.ts`); `TABLE_ID_RE` (shared).
- Produces:
  - shared: `TABLE_NAME_MAX = 60`; `TableNameSchema`; `TunnelUrlSchema`; `TunnelReportSchema` (`{ url: string | null }`); `ACTIVITY_REPORT_MS = 60_000`; `interface RegistryTable { id: string; name: string; createdAt: number; lastActivityAt: number; players: number; gmSecret: string; playerKey: string | null }`; `interface RegistryView { tables: RegistryTable[]; tunnelUrl: string | null }`.
  - worker: `isLocalRequest(request: Request): boolean`; `REGISTRY_NAME = 'registry'`; `registryStub(env: Env)`; `class RegistryDO` com RPC `register(entry: { id: string; name: string; gmSecret: string; playerKey: string | null }, now?: number): void`, `listTables(): RegistryTable[]`, `findTable(id: string): RegistryTable | null`, `renameTable(id: string, name: string): boolean`, `removeTable(id: string): boolean`, `touchTable(id: string, activity: { at: number; players: number }): void`, `setTunnel(url: string | null): void`, `getTunnel(): string | null`; `handleRegistry(request: Request, env: Env, rest: string[]): Promise<Response>`; binding `env.REGISTRY`.
  - tests: `LOCAL = 'http://localhost'` exportado de `apps/worker/test/helpers.ts`; `createTable()` passa a criar por `LOCAL`.

- [ ] **Step 1: Write the failing tests (shared)**

Crie `packages/shared/test/registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { TableNameSchema, TunnelReportSchema } from '../src/registry'

describe('registro de mesas', () => {
  it('TableNameSchema corta espaços nas pontas e recusa vazio ou mais de 60', () => {
    expect(TableNameSchema.parse('  Campanha  ')).toBe('Campanha')
    expect(TableNameSchema.safeParse('   ').success).toBe(false)
    expect(TableNameSchema.safeParse('x'.repeat(61)).success).toBe(false)
    expect(TableNameSchema.safeParse('x'.repeat(60)).success).toBe(true)
  })

  it('TunnelReportSchema aceita origem https ou null; recusa caminho, http, javascript: e corpo sem url', () => {
    expect(TunnelReportSchema.parse({ url: 'https://abc-def.trycloudflare.com' })).toEqual({ url: 'https://abc-def.trycloudflare.com' })
    expect(TunnelReportSchema.parse({ url: null })).toEqual({ url: null })
    for (const bad of [
      { url: 'https://abc.trycloudflare.com/t/x' },
      { url: 'http://abc.trycloudflare.com' },
      { url: 'javascript:alert(1)' },
      { url: 'https://a"b.com' },
      {},
      { url: null, extra: 1 },
    ]) {
      expect(TunnelReportSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @mesa/shared test test/registry.test.ts`
Expected: FAIL (`Cannot find module '../src/registry'` / falha ao resolver).

- [ ] **Step 3: Implement shared**

Crie `packages/shared/src/registry.ts`:

```ts
import { z } from 'zod'

export const TABLE_NAME_MAX = 60

/** Nome de mesa: sem espaços nas pontas, 1 a 60 caracteres. */
export const TableNameSchema = z.string().trim().min(1).max(TABLE_NAME_MAX)

/** Origem https sem caminho (o launcher manda a do Quick Tunnel). */
export const TunnelUrlSchema = z.string().max(200).regex(/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/)

export const TunnelReportSchema = z.strictObject({ url: TunnelUrlSchema.nullable() })

/** O TableDO avisa o índice no máximo uma vez por este intervalo (ou na hora, se o número de jogadores mudar). */
export const ACTIVITY_REPORT_MS = 60_000

export interface RegistryTable {
  id: string
  name: string
  createdAt: number
  lastActivityAt: number
  /** Membros com papel jogador conhecidos pela mesa. */
  players: number
  gmSecret: string
  /** Chave do link de jogador (`#j=`); null em mesas sem chave. */
  playerKey: string | null
}

export interface RegistryView {
  tables: RegistryTable[]
  /** Endereço do túnel informado pelo launcher; null = sem túnel (só local). */
  tunnelUrl: string | null
}
```

Em `packages/shared/src/index.ts` acrescente no fim:

```ts
export * from './registry'
```

Run: `pnpm --filter @mesa/shared test test/registry.test.ts`
Expected: PASS.

- [ ] **Step 4: Write the failing tests (worker)**

Em `apps/worker/test/helpers.ts`:
1. Troque `const BASE = 'https://mesa.test'` por:

```ts
/** Origem local: as rotas do índice e o POST /api/tables só respondem a pedidos locais. */
export const LOCAL = 'http://localhost'
const BASE = LOCAL
```

(`createTable` e `TestClient.connect` já usam `BASE`.)

Em `apps/worker/test/table-do.test.ts`, no teste `'POST /api/tables recusa id malformado em rotas e cria com nome padrão'`, troque a linha

```ts
    const res = await SELF.fetch('https://mesa.test/api/tables', { method: 'POST' })
```

por

```ts
    expect((await SELF.fetch('https://mesa.test/api/tables', { method: 'POST' })).status).toBe(404) // não local
    const res = await SELF.fetch('http://localhost/api/tables', { method: 'POST' })
```

Crie `apps/worker/test/registry.test.ts`:

```ts
import { exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { RegistryView } from '@mesa/shared'
import { isLocalRequest } from '../src/local'
import { LOCAL, createTable } from './helpers'

const SELF = exports.default
const TUNNEL_HEADERS = { 'cf-ray': '8f00000000000000-GRU', 'cf-connecting-ip': '200.100.50.25' }
const req = (url: string, headers: Record<string, string> = {}) => new Request(url, { headers })

export async function registryView(): Promise<RegistryView> {
  const res = await SELF.fetch(`${LOCAL}/api/registry/tables`)
  expect(res.status).toBe(200)
  return res.json<RegistryView>()
}

const postTunnel = (body: string) =>
  SELF.fetch(`${LOCAL}/api/registry/tunnel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })

describe('isLocalRequest', () => {
  // Review Focus #1
  it('local: localhost, 127.0.0.1 e [::1] em qualquer porta (inclui o proxy do Vite), com cf-connecting-ip de loopback ou sem ele', () => {
    for (const url of ['http://localhost:8787/api/registry/tables', 'http://127.0.0.1:8790/', 'http://[::1]:8787/', 'http://localhost:5173/api/x']) {
      expect(isLocalRequest(req(url, { 'cf-connecting-ip': '127.0.0.1' })), url).toBe(true)
    }
    expect(isLocalRequest(req('http://localhost/'))).toBe(true)
    expect(isLocalRequest(req('http://localhost/', { 'cf-connecting-ip': '::1' }))).toBe(true)
  })

  it('não local: Host da Cloudflare, qualquer cabeçalho da borda, IP de fora, IP da rede ou Host parecido', () => {
    expect(isLocalRequest(req('https://abc-def.trycloudflare.com/', TUNNEL_HEADERS))).toBe(false)
    expect(isLocalRequest(req('https://abc-def.trycloudflare.com/'))).toBe(false)
    for (const h of ['cf-ray', 'cf-visitor', 'cf-ipcountry', 'cdn-loop', 'cf-warp-tag-id']) {
      expect(isLocalRequest(req('http://localhost:8787/', { [h]: 'x' })), h).toBe(false)
    }
    expect(isLocalRequest(req('http://localhost:8787/', { 'cf-connecting-ip': '200.100.50.25' }))).toBe(false)
    expect(isLocalRequest(req('http://192.168.0.10:8787/'))).toBe(false)
    expect(isLocalRequest(req('http://localhost.evil.com/'))).toBe(false)
  })
})

describe('índice de mesas', () => {
  it('pedido de fora não vê o índice, não informa túnel e não cria mesa: 404', async () => {
    expect((await SELF.fetch('https://abc-def.trycloudflare.com/api/registry/tables', { headers: TUNNEL_HEADERS })).status).toBe(404)
    expect((await SELF.fetch(`${LOCAL}/api/registry/tables`, { headers: { 'cf-ray': 'x' } })).status).toBe(404)
    expect((await SELF.fetch('https://mesa.test/api/tables', { method: 'POST' })).status).toBe(404)
    expect((await SELF.fetch(`${LOCAL}/api/tables`, { method: 'POST', headers: TUNNEL_HEADERS })).status).toBe(404)
    expect(
      (await SELF.fetch('https://abc-def.trycloudflare.com/api/registry/tunnel', { method: 'POST', headers: TUNNEL_HEADERS, body: '{"url":null}' })).status,
    ).toBe(404)
  })

  it('criar registra a mesa; a lista traz nome, datas, jogadores e o segredo do mestre, mais recente primeiro', async () => {
    const a = await createTable('Primeira')
    const b = await createTable('Segunda')
    const { tables } = await registryView()
    const ia = tables.findIndex((t) => t.id === a.tableId)
    const ib = tables.findIndex((t) => t.id === b.tableId)
    expect(ia).toBeGreaterThanOrEqual(0)
    expect(ib).toBeGreaterThanOrEqual(0)
    expect(ib).toBeLessThan(ia)
    expect(tables[ia]).toMatchObject({ name: 'Primeira', players: 0, gmSecret: a.gmSecret })
    expect(tables[ia].lastActivityAt).toBe(tables[ia].createdAt)
  })

  it('túnel: guarda a origem informada, recusa endereço inválido sem perder a atual e volta a null', async () => {
    expect((await postTunnel(JSON.stringify({ url: 'https://abc-def.trycloudflare.com' }))).status).toBe(204)
    expect((await registryView()).tunnelUrl).toBe('https://abc-def.trycloudflare.com')
    for (const bad of ['{"url":"javascript:alert(1)"}', '{"url":"https://abc.trycloudflare.com/t/x"}', '{}', 'lixo']) {
      expect((await postTunnel(bad)).status, bad).toBe(400)
    }
    expect((await registryView()).tunnelUrl).toBe('https://abc-def.trycloudflare.com')
    expect((await postTunnel('{"url":null}')).status).toBe(204)
    expect((await registryView()).tunnelUrl).toBeNull()
  })
})
```

- [ ] **Step 5: Run to verify it fails**

Run: `pnpm --filter @mesa/worker test test/registry.test.ts`
Expected: FAIL (`../src/local` não existe).

- [ ] **Step 6: Implement the worker**

Crie `apps/worker/src/local.ts`:

```ts
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const LOOPBACK_IPS = new Set(['127.0.0.1', '::1'])
/** Cabeçalhos que só a borda da Cloudflare (e o cloudflared) põem; o wrangler local não cria nenhum deles. */
const EDGE_HEADERS = ['cf-ray', 'cf-visitor', 'cf-ipcountry', 'cdn-loop', 'cf-warp-tag-id']

/**
 * Pedido feito no próprio PC, direto no servidor (não pelo túnel). O wrangler local põe
 * `cf-connecting-ip: 127.0.0.1` e mantém o que vier de fora; o hostname de `request.url` vem do Host.
 */
export function isLocalRequest(request: Request): boolean {
  if (!LOOPBACK_HOSTS.has(new URL(request.url).hostname)) return false
  if (EDGE_HEADERS.some((h) => request.headers.has(h))) return false
  const ip = request.headers.get('cf-connecting-ip')
  return ip === null || LOOPBACK_IPS.has(ip)
}
```

Crie `apps/worker/src/registry-do.ts`:

```ts
import { DurableObject } from 'cloudflare:workers'
import type { RegistryTable } from '@mesa/shared'

/** Um índice só para o servidor todo. */
export const REGISTRY_NAME = 'registry'

export function registryStub(env: Env) {
  return env.REGISTRY.get(env.REGISTRY.idFromName(REGISTRY_NAME))
}

type Row = {
  id: string
  name: string
  created_at: number
  last_activity_at: number
  players: number
  gm_secret: string
  player_key: string | null
}

const toTable = (r: Row): RegistryTable => ({
  id: r.id,
  name: r.name,
  createdAt: r.created_at,
  lastActivityAt: r.last_activity_at,
  players: r.players,
  gmSecret: r.gm_secret,
  playerKey: r.player_key,
})

/** Índice das mesas criadas por este servidor (mesas antigas, de antes do índice, não entram). */
export class RegistryDO extends DurableObject<Env> {
  /** Endereço do túnel: só em memória; o launcher reenvia a cada 30 s e quando muda. */
  private tunnelUrl: string | null = null

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec(
      'CREATE TABLE IF NOT EXISTS tables (id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at INTEGER NOT NULL, ' +
        'last_activity_at INTEGER NOT NULL, players INTEGER NOT NULL DEFAULT 0, gm_secret TEXT NOT NULL, player_key TEXT)',
    )
  }

  register(entry: { id: string; name: string; gmSecret: string; playerKey: string | null }, now = Date.now()): void {
    this.ctx.storage.sql.exec(
      'INSERT INTO tables (id, name, created_at, last_activity_at, players, gm_secret, player_key) VALUES (?, ?, ?, ?, 0, ?, ?)',
      entry.id, entry.name, now, now, entry.gmSecret, entry.playerKey,
    )
  }

  listTables(): RegistryTable[] {
    return this.ctx.storage.sql.exec<Row>('SELECT * FROM tables ORDER BY last_activity_at DESC, rowid DESC').toArray().map(toTable)
  }

  findTable(id: string): RegistryTable | null {
    const row = this.ctx.storage.sql.exec<Row>('SELECT * FROM tables WHERE id = ?', id).toArray()[0]
    return row ? toTable(row) : null
  }

  renameTable(id: string, name: string): boolean {
    return this.ctx.storage.sql.exec('UPDATE tables SET name = ? WHERE id = ? RETURNING id', name, id).toArray().length > 0
  }

  removeTable(id: string): boolean {
    return this.ctx.storage.sql.exec('DELETE FROM tables WHERE id = ? RETURNING id', id).toArray().length > 0
  }

  /** Mesa fora do índice (antiga): não afeta nada. */
  touchTable(id: string, activity: { at: number; players: number }): void {
    this.ctx.storage.sql.exec(
      'UPDATE tables SET last_activity_at = MAX(last_activity_at, ?), players = ? WHERE id = ?',
      activity.at, activity.players, id,
    )
  }

  setTunnel(url: string | null): void {
    this.tunnelUrl = url
  }

  getTunnel(): string | null {
    return this.tunnelUrl
  }
}
```

Crie `apps/worker/src/registry-api.ts`:

```ts
import { TunnelReportSchema, type RegistryView } from '@mesa/shared'
import { registryStub } from './registry-do'

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
export const notFound = () => json({ error: 'not_found' }, 404)
const noContent = () => new Response(null, { status: 204 })
const invalid = () => json({ error: 'invalid' }, 400)

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json()
  } catch {
    return null
  }
}

/** Rotas /api/registry/* (o chamador já garantiu que o pedido é local). `rest` = partes depois de "registry". */
export async function handleRegistry(request: Request, env: Env, rest: string[]): Promise<Response> {
  const registry = registryStub(env)
  if (rest.length === 1 && rest[0] === 'tables' && request.method === 'GET') {
    const [tables, tunnelUrl] = await Promise.all([registry.listTables(), registry.getTunnel()])
    const view: RegistryView = { tables, tunnelUrl }
    return json(view)
  }
  if (rest.length === 1 && rest[0] === 'tunnel' && request.method === 'POST') {
    const parsed = TunnelReportSchema.safeParse(await readJson(request))
    if (!parsed.success) return invalid()
    await registry.setTunnel(parsed.data.url)
    return noContent()
  }
  return notFound()
}
```

Substitua `apps/worker/src/index.ts` inteiro por:

```ts
import { TABLE_ID_RE, TABLE_NAME_MAX } from '@mesa/shared'
import { randomId, randomSecret, sha256Hex } from './crypto'
import { serveFile, uploadAsset } from './files'
import { isLocalRequest } from './local'
import { handleRegistry, json, notFound } from './registry-api'
import { registryStub } from './registry-do'

export { TableDO } from './table-do'
export { RegistryDO } from './registry-do'

async function createTable(request: Request, env: Env): Promise<Response> {
  let name = 'Nova mesa'
  try {
    const body = await request.json<{ name?: unknown }>()
    if (typeof body.name === 'string' && body.name.trim()) name = body.name.trim().slice(0, TABLE_NAME_MAX)
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
    if (res.status === 201) {
      await registryStub(env).register({ id: tableId, name, gmSecret, playerKey: null })
      return json({ tableId, gmSecret }, 201)
    }
  }
  return json({ error: 'could_not_create' }, 500)
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url)
    const parts = url.pathname.split('/').filter(Boolean)

    // Índice e criação: só do próprio PC (nunca pelo túnel).
    if (parts[0] === 'api' && parts[1] === 'registry') {
      return isLocalRequest(request) ? handleRegistry(request, env, parts.slice(2)) : notFound()
    }

    if (parts[0] === 'api' && parts[1] === 'tables') {
      if (parts.length === 2 && request.method === 'POST') return isLocalRequest(request) ? createTable(request, env) : notFound()
      const tableId = parts[2]
      if (!tableId || !TABLE_ID_RE.test(tableId)) return json({ error: 'invalid_table' }, 400)
      const stub = env.TABLES.get(env.TABLES.idFromName(tableId))
      if (parts.length === 4 && parts[3] === 'ws' && request.method === 'GET') {
        return stub.fetch(new Request('https://table/ws', request))
      }
      if (parts.length === 4 && parts[3] === 'assets' && request.method === 'POST') {
        return uploadAsset(request, env, stub)
      }
    }

    if (parts[0] === 'files' && parts.length === 2 && request.method === 'GET') {
      return serveFile(parts[1], env)
    }

    return notFound()
  },
} satisfies ExportedHandler<Env>
```

Em `apps/worker/wrangler.jsonc`, troque `durable_objects` e `migrations` por:

```jsonc
  "durable_objects": {
    "bindings": [
      { "name": "TABLES", "class_name": "TableDO" },
      { "name": "REGISTRY", "class_name": "RegistryDO" }
    ]
  },
  "migrations": [
    { "tag": "v1", "new_sqlite_classes": ["TableDO"] },
    { "tag": "v2", "new_sqlite_classes": ["RegistryDO"] }
  ],
```

Regenere os tipos (gera `REGISTRY: DurableObjectNamespace<import("./src/index").RegistryDO>`; não acessa a rede):

Run: `pnpm --filter @mesa/worker types`
Expected: `worker-configuration.d.ts` atualizado com `REGISTRY` e `durableNamespaces: "TableDO" | "RegistryDO"`.

- [ ] **Step 7: Run tests**

Run: `pnpm --filter @mesa/worker test`
Expected: PASS (inclui `registry.test.ts` e o teste de POST atualizado). O `apps/launcher/test/win-package.test.mjs` compara `durable_objects`/`migrations` do pacote com o do repositório e continua passando: rode `pnpm --filter ./apps/launcher test` para conferir.

- [ ] **Step 8: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: tudo verde (o E2E cria mesas por `http://localhost:8788`, que é local).

```bash
git add packages/shared/src/registry.ts packages/shared/src/index.ts packages/shared/test/registry.test.ts \
  apps/worker/src/local.ts apps/worker/src/registry-do.ts apps/worker/src/registry-api.ts apps/worker/src/index.ts \
  apps/worker/wrangler.jsonc apps/worker/worker-configuration.d.ts apps/worker/test/helpers.ts \
  apps/worker/test/table-do.test.ts apps/worker/test/registry.test.ts
git commit -m "feat(índice): RegistryDO com mesas e túnel; índice e criação só pelo próprio PC" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Renomear e apagar mesa

**Files:**
- Modify: `packages/shared/src/protocol.ts`
- Modify: `apps/worker/src/engine/store.ts`, `sql-store.ts`, `memory-store.ts`, `apps/worker/test/store-contract.ts`
- Modify: `apps/worker/src/table-do.ts`, `apps/worker/src/registry-api.ts`, `apps/worker/test/registry.test.ts`
- Modify: `apps/web/src/store/state.ts`, `apps/web/src/store/reducers.ts`, `apps/web/src/ui/TablePage.tsx`
- Create: `apps/web/test/reducers-registry.test.ts`

**Interfaces:**
- Consumes (Task 1): `registryStub`, `RegistryDO.findTable/renameTable/removeTable/listTables`, `handleRegistry`, `json`, `notFound`, `TableNameSchema`, `LOCAL`, `registryView()` (exportado de `registry.test.ts`).
- Produces:
  - shared: `type ServerErrorReason = 'table_not_found' | 'auth' | 'table_deleted'`; `ServerMessage` `{ t: 'error'; reason: ServerErrorReason }` e `{ t: 'tableRenamed'; name: string }`.
  - worker: `TableStore.renameTable(name: string): void`; RPC do `TableDO`: `renameTable(name: string): boolean`, `listAssetKeys(): string[]`, `deleteTable(): Promise<string[]>`; rotas `PATCH`/`DELETE /api/registry/tables/:id`.
  - web: `TableState.fatal: ServerErrorReason | null`; `FatalMessage` e `DeletedNotice` em `TablePage.tsx`.

- [ ] **Step 1: Write the failing tests**

Em `apps/worker/test/store-contract.ts`, no fim de `checkStoreContract` (antes do `}` final), acrescente:

```ts
  store.renameTable('Outra mesa')
  expect(store.getMeta()?.name).toBe('Outra mesa')
```

Em `apps/worker/test/registry.test.ts`:
1. Troque os imports por:

```ts
import { env, exports } from 'cloudflare:workers'
import { describe, expect, it } from 'vitest'
import type { RegistryView } from '@mesa/shared'
import { isLocalRequest } from '../src/local'
import { LOCAL, TestClient, createTable, tokenObject } from './helpers'
```

2. Acrescente no fim:

```ts
const patchName = (id: string, body: string, headers: Record<string, string> = {}) =>
  SELF.fetch(`${LOCAL}/api/registry/tables/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json', ...headers }, body })
const deleteTable = (id: string) => SELF.fetch(`${LOCAL}/api/registry/tables/${id}`, { method: 'DELETE' })

async function uploadRandom(tableId: string): Promise<string> {
  const res = await SELF.fetch(`${LOCAL}/api/tables/${tableId}/assets`, {
    method: 'POST',
    headers: { 'Content-Type': 'image/png' },
    body: crypto.getRandomValues(new Uint8Array(64)),
  })
  expect(res.status).toBe(201)
  return (await res.json<{ assetKey: string }>()).assetKey
}

describe('renomear e apagar mesa', () => {
  it('renomear: nome novo no índice, aviso para quem está na mesa e no snapshot de quem entra depois', async () => {
    const { tableId } = await createTable('Antigo')
    const p = await TestClient.connect(tableId)
    await p.hello('Ana')
    expect((await patchName(tableId, JSON.stringify({ name: '  Nova  ' }))).status).toBe(204)
    expect((await registryView()).tables.find((t) => t.id === tableId)?.name).toBe('Nova')
    expect(await p.waitFor('tableRenamed')).toEqual({ t: 'tableRenamed', name: 'Nova' })
    const late = await TestClient.connect(tableId)
    expect((await late.hello('Bia')).welcome.snapshot.meta.name).toBe('Nova')
  })

  it('renomear: só espaços, mais de 60, corpo inválido → 400 sem mudar; mesa fora do índice → 404; pelo túnel → 404', async () => {
    const { tableId } = await createTable('Fica')
    for (const body of ['{"name":"   "}', JSON.stringify({ name: 'x'.repeat(61) }), '{}', 'lixo']) {
      expect((await patchName(tableId, body)).status, body).toBe(400)
    }
    expect((await registryView()).tables.find((t) => t.id === tableId)?.name).toBe('Fica')
    expect((await patchName('ZZZZZZZZZZ', '{"name":"x"}')).status).toBe(404)
    expect((await patchName(tableId, '{"name":"x"}', { 'cf-ray': 'x' })).status).toBe(404)
  })

  // Review Focus #2
  it('apagar: quem está na mesa recebe table_deleted; some do índice; reconexão vê mesa não encontrada; arquivo só dela sai do R2, compartilhado fica', async () => {
    const a = await createTable('Apagar')
    const b = await createTable('Fica')
    const pa = await TestClient.connect(a.tableId)
    await pa.hello('Ana')
    const pb = await TestClient.connect(b.tableId)
    await pb.hello('Bia')
    const onlyA = await uploadRandom(a.tableId)
    const shared = await uploadRandom(a.tableId)
    pa.send({ t: 'op', opId: 'a1', op: { kind: 'create', object: tokenObject({ assetKey: onlyA }) } })
    pa.send({ t: 'op', opId: 'a2', op: { kind: 'create', object: tokenObject({ assetKey: shared }) } })
    pb.send({ t: 'op', opId: 'b1', op: { kind: 'create', object: tokenObject({ assetKey: shared }) } })
    await pa.waitFor('ack', (m) => m.opId === 'a2')
    await pb.waitFor('ack', (m) => m.opId === 'b1')

    expect((await deleteTable(a.tableId)).status).toBe(204)
    expect(await pa.waitFor('error')).toEqual({ t: 'error', reason: 'table_deleted' })
    expect((await registryView()).tables.some((t) => t.id === a.tableId)).toBe(false)
    expect(await env.FILES.head(onlyA)).toBeNull()
    expect(await env.FILES.head(shared)).not.toBeNull()

    const again = await TestClient.connect(a.tableId)
    expect(await again.waitFor('error')).toEqual({ t: 'error', reason: 'table_not_found' })
    expect((await deleteTable(a.tableId)).status).toBe(404)
  })
})
```

Crie `apps/web/test/reducers-registry.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member } from '@mesa/shared'
import { reduceServer } from '../src/store/reducers'
import { makeInitialState } from '../src/store/state'

const me: Member = { clientId: 'me', nickname: 'Ana', color: '#e6194b', role: 'player', online: true }
const joined = () =>
  reduceServer(
    makeInitialState(),
    {
      t: 'welcome',
      self: me,
      snapshot: { meta: { id: 'T', name: 'Antigo' }, members: [me], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
    },
    0,
  )

describe('mesa renomeada e apagada', () => {
  it('tableRenamed troca o nome mostrado', () => {
    expect(reduceServer(joined(), { t: 'tableRenamed', name: 'Nova' }, 0).meta?.name).toBe('Nova')
  })

  it('error table_deleted vira fatal e fecha', () => {
    const s = reduceServer(joined(), { t: 'error', reason: 'table_deleted' }, 0)
    expect(s.fatal).toBe('table_deleted')
    expect(s.status).toBe('closed')
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mesa/worker test test/registry.test.ts test/sql-store.test.ts`
Expected: FAIL (`store.renameTable is not a function`; PATCH/DELETE → 404).
Run: `pnpm --filter @mesa/web test test/reducers-registry.test.ts`
Expected: FAIL (tipo/caso inexistente; o nome continua "Antigo").

- [ ] **Step 3: Implement shared**

Em `packages/shared/src/protocol.ts`, logo antes de `export type ServerMessage =`, acrescente:

```ts
/** Motivos de `error` (o servidor fecha a conexão logo depois). */
export type ServerErrorReason = 'table_not_found' | 'auth' | 'table_deleted'
```

e, em `ServerMessage`, troque `| { t: 'error'; reason: 'table_not_found' | 'auth' }` por:

```ts
  | { t: 'error'; reason: ServerErrorReason }
  /** O mestre renomeou a mesa na página local. */
  | { t: 'tableRenamed'; name: string }
```

- [ ] **Step 4: Implement the store**

Em `apps/worker/src/engine/store.ts`, na interface `TableStore`, depois de `initTable(...)`:

```ts
  renameTable(name: string): void
```

Em `apps/worker/src/engine/sql-store.ts`, depois do método `initTable`:

```ts
  renameTable(name: string): void {
    this.sql.exec('UPDATE meta SET name = ?', name)
  }
```

Em `apps/worker/src/engine/memory-store.ts`, depois do método `initTable`:

```ts
  renameTable(name: string): void {
    if (this.meta) this.meta = { ...this.meta, name }
  }
```

- [ ] **Step 5: Implement the TableDO**

Em `apps/worker/src/table-do.ts`, acrescente estes métodos públicos logo depois do método `fetch`:

```ts
  /** RPC do índice: troca o nome e avisa quem está na mesa. */
  renameTable(name: string): boolean {
    if (!this.store.getMeta()) return false
    this.store.renameTable(name)
    this.broadcast(null, () => ({ t: 'tableRenamed', name }))
    return true
  }

  /** Chaves dos arquivos que a mesa usa: imagens no mapa e no chat da mesa. */
  listAssetKeys(): string[] {
    const keys = new Set<string>()
    for (const o of this.store.listObjects()) if (o.type === 'image') keys.add(o.assetKey)
    for (const e of this.store.listChat()) if (e.kind === 'image') keys.add(e.assetKey)
    return [...keys]
  }

  /**
   * RPC do índice: avisa e fecha as conexões, apaga todo o armazenamento e devolve as chaves dos arquivos
   * que a mesa usava (quem chamou decide o que sai do R2).
   */
  async deleteTable(): Promise<string[]> {
    const keys = this.listAssetKeys()
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: 'error', reason: 'table_deleted' })
      ws.serializeAttachment(null) // o webSocketClose não mexe em nada desta mesa
      try {
        ws.close(4410, 'table_deleted')
      } catch {
        // já fechado
      }
    }
    await this.ctx.storage.deleteAll()
    // deleteAll apaga também as tabelas SQLite: recria o esquema vazio (getMeta() → null = mesa não encontrada).
    this.store = new SqlStore(this.ctx.storage.sql)
    this.engine = new TableEngine(this.store)
    this.strokeLayers.clear()
    return keys
  }
```

Se os planos anteriores tiverem acrescentado outros campos em memória por mesa no `TableDO`, zere-os também aqui.

- [ ] **Step 6: Implement the routes**

Em `apps/worker/src/registry-api.ts`:
1. Troque o import de `@mesa/shared` por:

```ts
import { TABLE_ID_RE, TableNameSchema, TunnelReportSchema, type RegistryView } from '@mesa/shared'
```

2. Em `handleRegistry`, antes do `return notFound()` final:

```ts
  if (rest.length === 2 && rest[0] === 'tables' && TABLE_ID_RE.test(rest[1])) {
    const id = rest[1]
    if (request.method === 'PATCH') return renameTable(env, id, await readJson(request))
    if (request.method === 'DELETE') return deleteTable(env, id)
  }
```

3. No fim do arquivo:

```ts
const tableStub = (env: Env, id: string) => env.TABLES.get(env.TABLES.idFromName(id))

async function renameTable(env: Env, id: string, body: unknown): Promise<Response> {
  const parsed = TableNameSchema.safeParse((body as { name?: unknown } | null)?.name)
  if (!parsed.success) return invalid()
  if (!(await registryStub(env).renameTable(id, parsed.data))) return notFound()
  await tableStub(env, id).renameTable(parsed.data)
  return noContent()
}

async function deleteTable(env: Env, id: string): Promise<Response> {
  const registry = registryStub(env)
  if (!(await registry.findTable(id))) return notFound()
  const keys = await tableStub(env, id).deleteTable()
  await registry.removeTable(id)
  await pruneFiles(env, keys)
  return noContent()
}

/** Apaga do R2 os arquivos que nenhuma outra mesa do índice usa (mesas antigas, fora do índice, não contam). */
async function pruneFiles(env: Env, keys: string[]): Promise<void> {
  if (keys.length === 0) return
  const used = new Set<string>()
  for (const t of await registryStub(env).listTables()) {
    for (const key of await tableStub(env, t.id).listAssetKeys()) used.add(key)
  }
  const orphans = keys.filter((k) => !used.has(k))
  if (orphans.length > 0) await env.FILES.delete(orphans)
}
```

Run: `pnpm --filter @mesa/worker test`
Expected: PASS.

- [ ] **Step 7: Implement the web**

Em `apps/web/src/store/state.ts`: importe `type ServerErrorReason` de `@mesa/shared` (junte ao import existente) e troque `fatal: 'table_not_found' | 'auth' | null` por `fatal: ServerErrorReason | null`.

Em `apps/web/src/store/reducers.ts`, em `reduceServer`, logo depois do `case 'error': ...`, acrescente:

```ts
    case 'tableRenamed':
      return s.meta ? { ...s, meta: { ...s.meta, name: msg.name } } : s
```

Em `apps/web/src/ui/TablePage.tsx`:
1. Acrescente ao import de `react` o `useEffect` (se faltar) e acrescente `import type { ServerErrorReason } from '@mesa/shared'`.
2. Em `TableView`, troque o bloco inteiro `if (fatal) { return ( <div className="fullscreen-msg"> ... ) }` por:

```tsx
  if (fatal) return <FatalMessage reason={fatal} />
```

3. No fim do arquivo:

```tsx
function FatalMessage({ reason }: { reason: ServerErrorReason }) {
  if (reason === 'table_deleted') return <DeletedNotice />
  return (
    <div className="fullscreen-msg">
      <div>
        {reason === 'auth' ? (
          <p>Identidade inválida nesta mesa. Peça ao mestre para remover você da lista de membros e recarregue a página.</p>
        ) : (
          <>
            <p>Mesa não encontrada.</p>
            <a href="/" style={{ color: '#9db4ff' }}>Voltar à página inicial</a>
          </>
        )}
      </div>
    </div>
  )
}

const DELETED_REDIRECT_MS = 3_000

/** A mesa foi apagada pelo mestre: avisa e volta sozinho para a página inicial. */
function DeletedNotice() {
  useEffect(() => {
    const timer = setTimeout(() => window.location.assign('/'), DELETED_REDIRECT_MS)
    return () => clearTimeout(timer)
  }, [])
  return (
    <div className="fullscreen-msg">
      <div>
        <p>A mesa foi apagada</p>
        <a href="/" style={{ color: '#9db4ff' }}>Voltar à página inicial</a>
      </div>
    </div>
  )
}
```

Run: `pnpm --filter @mesa/web test test/reducers-registry.test.ts`
Expected: PASS.

- [ ] **Step 8: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: verde (o E2E `'link de mesa inexistente mostra aviso'` continua vendo "Mesa não encontrada.").

```bash
git add packages/shared/src/protocol.ts apps/worker/src apps/worker/test apps/web/src/store/state.ts \
  apps/web/src/store/reducers.ts apps/web/src/ui/TablePage.tsx apps/web/test/reducers-registry.test.ts
git commit -m "feat(índice): renomear e apagar mesa (avisa quem está na mesa e limpa arquivos)" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Atividade das mesas no índice

**Files:**
- Create: `apps/worker/src/activity.ts`, `apps/worker/test/activity.test.ts`
- Modify: `apps/worker/src/table-do.ts`, `apps/worker/test/registry.test.ts`

**Interfaces:**
- Consumes: `ACTIVITY_REPORT_MS` (shared, Task 1); `registryStub(env).touchTable(id, { at, players })` (Task 1); `registryView()` (Task 1).
- Produces: `class ActivityReporter { constructor(intervalMs: number); shouldReport(now: number, players: number): boolean }`; `TableDO.reportActivity()` (privado) chamado no `hello`, em op aplicada e no chat.

- [ ] **Step 1: Write the failing tests**

Crie `apps/worker/test/activity.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { ActivityReporter } from '../src/activity'

describe('ActivityReporter', () => {
  it('primeira vez avisa; depois no máximo uma vez por intervalo; mudança no número de jogadores avisa na hora', () => {
    const r = new ActivityReporter(60_000)
    expect(r.shouldReport(0, 0)).toBe(true)
    expect(r.shouldReport(30_000, 0)).toBe(false)
    expect(r.shouldReport(30_000, 1)).toBe(true)
    expect(r.shouldReport(89_999, 1)).toBe(false)
    expect(r.shouldReport(90_000, 1)).toBe(true)
  })
})
```

Em `apps/worker/test/registry.test.ts`, acrescente no fim:

```ts
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function waitEntry(id: string, pred: (t: RegistryView['tables'][number]) => boolean) {
  for (let i = 0; i < 100; i++) {
    const entry = (await registryView()).tables.find((t) => t.id === id)
    if (entry && pred(entry)) return entry
    await sleep(20)
  }
  throw new Error('o índice não foi atualizado')
}

describe('atividade no índice', () => {
  it('jogador entrando atualiza jogadores e última atividade; o mestre não conta como jogador', async () => {
    const { tableId, gmSecret } = await createTable('Atividade')
    const created = (await registryView()).tables.find((t) => t.id === tableId)!
    const gm = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const p = await TestClient.connect(tableId)
    await p.hello('Ana')
    const entry = await waitEntry(tableId, (t) => t.players === 1)
    expect(entry.lastActivityAt).toBeGreaterThanOrEqual(created.lastActivityAt)
  })

  it('mesa fora do índice (antiga) continua fora da lista mesmo com atividade', async () => {
    const id = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
    const stub = env.TABLES.get(env.TABLES.idFromName(id))
    expect((await stub.fetch('https://table/init', { method: 'POST', body: JSON.stringify({ id, name: 'Antiga', gmSecretHash: 'h' }) })).status).toBe(201)
    const c = await TestClient.connect(id)
    await c.hello('Ana')
    await sleep(100)
    expect((await registryView()).tables.some((t) => t.id === id)).toBe(false)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mesa/worker test test/activity.test.ts test/registry.test.ts`
Expected: FAIL (`../src/activity` não existe; o índice fica com `players: 0`).

- [ ] **Step 3: Implement**

Crie `apps/worker/src/activity.ts`:

```ts
/**
 * Quando o TableDO avisa o índice: no máximo uma vez por intervalo, ou já quando muda o número de
 * jogadores. Só em memória (se o DO hibernar, o próximo evento avisa de novo).
 */
export class ActivityReporter {
  private lastAt = Number.NEGATIVE_INFINITY
  private lastPlayers = -1

  constructor(private intervalMs: number) {}

  shouldReport(now: number, players: number): boolean {
    if (players === this.lastPlayers && now - this.lastAt < this.intervalMs) return false
    this.lastAt = now
    this.lastPlayers = players
    return true
  }
}
```

Em `apps/worker/src/table-do.ts`:
1. Imports: acrescente `ACTIVITY_REPORT_MS` ao import de `@mesa/shared`, e:

```ts
import { ActivityReporter } from './activity'
import { registryStub } from './registry-do'
```

2. Campo, junto dos limitadores:

```ts
  private activity = new ActivityReporter(ACTIVITY_REPORT_MS)
```

3. Método privado (perto de `onDisconnect`):

```ts
  /** Avisa o índice (última atividade e jogadores); mesas fora do índice são ignoradas por ele. */
  private reportActivity(): void {
    const meta = this.store.getMeta()
    if (!meta) return
    const now = Date.now()
    const players = this.store.listMembers().filter((m) => m.role === 'player').length
    if (!this.activity.shouldReport(now, players)) return
    this.ctx.waitUntil(registryStub(this.env).touchTable(meta.id, { at: now, players }).catch(() => {}))
  }
```

4. Chamadas:
   - em `onHello`, como última linha (depois do `this.broadcast(att.sessionId, () => ({ t: 'memberJoined', member }))`): `this.reportActivity()`;
   - em `onOp`, como última linha (depois do laço `for (const effect of res.effects) ...`): `this.reportActivity()`;
   - em `onChat`, logo depois de `this.send(ws, { t: 'chatAck', reqId: msg.reqId })`: `this.reportActivity()`.
5. Em `deleteTable`, junto da recriação do `store`/`engine`: `this.activity = new ActivityReporter(ACTIVITY_REPORT_MS)`.

- [ ] **Step 4: Run tests**

Run: `pnpm --filter @mesa/worker test`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add apps/worker/src/activity.ts apps/worker/src/table-do.ts apps/worker/test/activity.test.ts apps/worker/test/registry.test.ts
git commit -m "feat(índice): mesa informa atividade e jogadores no máximo uma vez por minuto" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Vínculo entre sessões no servidor

**Files:**
- Modify: `packages/shared/src/registry.ts`, `packages/shared/src/protocol.ts`, `packages/shared/test/registry.test.ts`
- Modify: `apps/worker/src/engine/engine.ts`, `apps/worker/src/table-do.ts`, `apps/worker/src/index.ts`
- Modify: `apps/worker/test/engine.test.ts`, `apps/worker/test/table-do.test.ts`

**Interfaces:**
- Consumes: `MEMBER_RECENT_MS` (shared); `StoredMember`, `TableEngine` (worker).
- Produces:
  - shared: `normalizeNickname(nickname: string): string`; `interface KnownPlayer { nickname: string; color: string }`; `ServerErrorReason` ganha `'nickname_taken'`.
  - engine: `type NicknameMatch = { kind: 'none' } | { kind: 'taken' } | { kind: 'adopt'; clientId: string }`; `matchNickname(nickname: string, online: Set<string>): NicknameMatch`; `gmMember(): StoredMember | null`; `knownPlayers(online: Set<string>): KnownPlayer[]`.
  - rota `GET /api/tables/:id/members` → `{ players: KnownPlayer[] }` (pelo túnel também).
  - `welcome.self.clientId` pode ser diferente do `clientId` do `hello` (membro assumido).

- [ ] **Step 1: Write the failing tests**

Em `packages/shared/test/registry.test.ts`, troque o import por `import { TableNameSchema, TunnelReportSchema, normalizeNickname } from '../src/registry'` e acrescente:

```ts
describe('normalizeNickname', () => {
  it('ignora maiúsculas/minúsculas e espaços nas pontas', () => {
    expect(normalizeNickname('  ANA ')).toBe(normalizeNickname('ana'))
    expect(normalizeNickname('Ana Paula')).not.toBe(normalizeNickname('AnaPaula'))
    expect(normalizeNickname('ÉRICO')).toBe('érico')
  })
})
```

Em `apps/worker/test/engine.test.ts`, acrescente no fim:

```ts
describe('vínculo entre sessões', () => {
  const join = (clientId: string, nickname: string, role: 'gm' | 'player' = 'player') =>
    engine.join({ clientId, nickname, role }, new Set())

  it('matchNickname: online recusa; jogador fora assume o mais recente; mestre nunca é assumido por apelido', () => {
    join('A', 'Ana')
    clock = 5_000
    join('B', 'ana')
    join('G', 'Mestre', 'gm')
    expect(engine.matchNickname('  ANA ', new Set())).toEqual({ kind: 'adopt', clientId: 'B' })
    expect(engine.matchNickname('Ana', new Set(['A']))).toEqual({ kind: 'taken' })
    expect(engine.matchNickname('mestre', new Set())).toEqual({ kind: 'none' })
    expect(engine.matchNickname('Mestre', new Set(['G']))).toEqual({ kind: 'taken' })
    expect(engine.matchNickname('Caio', new Set())).toEqual({ kind: 'none' })
  })

  it('gmMember devolve o mestre visto por último', () => {
    expect(engine.gmMember()).toBeNull()
    join('G1', 'Mestre', 'gm')
    clock = 9_000
    join('G2', 'Mestre 2', 'gm')
    expect(engine.gmMember()?.clientId).toBe('G2')
  })

  it('knownPlayers: só jogadores fora da mesa vistos nos últimos 7 dias, mais recentes primeiro, sem clientId', () => {
    join('OLD', 'Velho')
    clock = 1_000 + MEMBER_RECENT_MS + 1
    join('A', 'Ana')
    clock += 10
    join('B', 'Bia')
    join('C', 'Caio')
    join('G', 'Mestre', 'gm')
    const list = engine.knownPlayers(new Set(['C']))
    expect(list.map((p) => p.nickname)).toEqual(['Bia', 'Ana'])
    expect(Object.keys(list[0]).sort()).toEqual(['color', 'nickname'])
  })
})
```

Em `apps/worker/test/table-do.test.ts`:
1. Troque a linha de import de helpers por `import { LOCAL, TestClient, createTable, tokenObject } from './helpers'`.
2. No teste `'estado persiste após todos saírem'`, troque `const { welcome } = await again.hello('Ana')` por `const { welcome } = await again.hello('Bia')` (o fechamento de `a` pode ainda não ter chegado ao servidor; com o mesmo apelido a entrada seria recusada por apelido em uso; o teste é sobre o estado).
3. Acrescente no fim:

```ts
describe('TableDO — vínculo entre sessões', () => {
  it('navegador limpo com o mesmo apelido (maiúsculas/espaços) assume o jogador fora da mesa: mesmo id e cor, segredo novo, controle do token', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const a = await TestClient.connect(tableId)
    const { clientId: anaId, welcome: w1 } = await a.hello('Ana')
    const tok = tokenObject()
    a.send({ t: 'op', opId: 'op_1', op: { kind: 'create', object: tok } })
    await a.waitFor('ack')
    a.close()
    await gm.waitFor('memberLeft', (m) => m.clientId === anaId)

    const back = await TestClient.connect(tableId)
    const { clientId: freshId, welcome } = await back.hello('  ANA ')
    expect(freshId).not.toBe(anaId)
    expect(welcome.self.clientId).toBe(anaId)
    expect(welcome.self.color).toBe(w1.self.color)
    expect(welcome.clientSecret).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(welcome.clientSecret).not.toBe(w1.clientSecret)
    expect(welcome.snapshot.members.filter((m) => m.role === 'player')).toHaveLength(1)
    back.send({ t: 'op', opId: 'op_2', op: { kind: 'update', id: tok.id, patch: { x: 99 } } })
    expect(await back.waitFor('ack')).toMatchObject({ opId: 'op_2' })

    // o segredo do navegador antigo deixa de valer; o novo reconecta
    const old = await TestClient.connect(tableId)
    old.send({ t: 'hello', v: 2, clientId: anaId, nickname: 'Ana', clientSecret: w1.clientSecret })
    expect(await old.waitFor('error')).toEqual({ t: 'error', reason: 'auth' })
    const tab2 = await TestClient.connect(tableId)
    const { welcome: w3 } = await tab2.hello('Ana', { clientId: anaId, clientSecret: welcome.clientSecret })
    expect(w3.self.clientId).toBe(anaId)
  })

  it('apelido de alguém online (jogador ou mestre) é recusado com nickname_taken; quem está online não é afetado', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const a = await TestClient.connect(tableId)
    await a.hello('Ana')
    for (const nickname of ['ana', ' MESTRE ']) {
      const intruder = await TestClient.connect(tableId)
      intruder.send({ t: 'hello', v: 2, clientId: crypto.randomUUID(), nickname })
      expect(await intruder.waitFor('error')).toEqual({ t: 'error', reason: 'nickname_taken' })
    }
    await a.expectNone('memberJoined')
  })

  it('apelido do mestre fora da mesa não assume o mestre: entra como jogador novo', async () => {
    const { tableId, gmSecret } = await createTable()
    const watcher = await TestClient.connect(tableId)
    await watcher.hello('Bia')
    const gm = await TestClient.connect(tableId)
    const { clientId: gmId } = await gm.hello('Mestre', { gmSecret })
    gm.close()
    await watcher.waitFor('memberLeft', (m) => m.clientId === gmId)
    const p = await TestClient.connect(tableId)
    const { clientId, welcome } = await p.hello('Mestre')
    expect(welcome.self).toMatchObject({ clientId, role: 'player' })
    expect(clientId).not.toBe(gmId)
  })

  // Review Focus #3
  it('mestre com navegador limpo pelo link de mestre volta a ser o mesmo membro, mesmo com o primeiro online: uma linha só de mestre', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm1 = await TestClient.connect(tableId)
    const { clientId: gmId } = await gm1.hello('Mestre', { gmSecret })
    const gm2 = await TestClient.connect(tableId)
    const { clientId: fresh, welcome } = await gm2.hello('Mestre', { gmSecret })
    expect(fresh).not.toBe(gmId)
    expect(welcome.self).toMatchObject({ clientId: gmId, role: 'gm' })
    expect(welcome.clientSecret).toBeDefined()
    expect(welcome.snapshot.members.filter((m) => m.role === 'gm')).toHaveLength(1)
  })

  it('GET /api/tables/:id/members (também pelo túnel): só jogadores fora da mesa, sem clientId; mesa inexistente → vazio', async () => {
    const { tableId, gmSecret } = await createTable()
    const gm = await TestClient.connect(tableId)
    await gm.hello('Mestre', { gmSecret })
    const a = await TestClient.connect(tableId)
    const { clientId: aId } = await a.hello('Ana')
    const b = await TestClient.connect(tableId)
    await b.hello('Bia')
    a.close()
    await gm.waitFor('memberLeft', (m) => m.clientId === aId)
    const res = await SELF.fetch(`https://abc-def.trycloudflare.com/api/tables/${tableId}/members`, {
      headers: { 'cf-ray': 'x', 'cf-connecting-ip': '200.100.50.25' },
    })
    expect(res.status).toBe(200)
    const body = await res.json<{ players: { nickname: string; color: string }[] }>()
    expect(body.players.map((p) => p.nickname)).toEqual(['Ana'])
    expect(JSON.stringify(body)).not.toContain(aId)
    const none = await SELF.fetch(`${LOCAL}/api/tables/ZZZZZZZZZZ/members`)
    expect(await none.json()).toEqual({ players: [] })
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mesa/shared test test/registry.test.ts && pnpm --filter @mesa/worker test test/engine.test.ts test/table-do.test.ts`
Expected: FAIL (`normalizeNickname`/`matchNickname` não existem; `welcome.self.clientId` igual ao novo; `/members` → 404).

- [ ] **Step 3: Implement shared**

Em `packages/shared/src/registry.ts`, no fim:

```ts
/** Jogador fora da mesa visto nos últimos 7 dias ("Já jogou aqui?"). Nunca leva clientId nem segredo. */
export interface KnownPlayer {
  nickname: string
  color: string
}

/** Comparação de apelidos: ignora maiúsculas/minúsculas e espaços nas pontas. */
export function normalizeNickname(nickname: string): string {
  return nickname.trim().toLocaleLowerCase('pt-BR')
}
```

Em `packages/shared/src/protocol.ts`, `ServerErrorReason` vira:

```ts
export type ServerErrorReason = 'table_not_found' | 'auth' | 'table_deleted' | 'nickname_taken'
```

- [ ] **Step 4: Implement the engine**

Em `apps/worker/src/engine/engine.ts`:
1. Ao import de `@mesa/shared` acrescente `normalizeNickname` e `type KnownPlayer`.
2. Depois de `export type OpResult = ...`:

```ts
/** Resultado do apelido de quem entra com clientId desconhecido. */
export type NicknameMatch = { kind: 'none' } | { kind: 'taken' } | { kind: 'adopt'; clientId: string }
```

3. Métodos públicos da classe, logo depois de `touchMember`:

```ts
  /**
   * Apelido de alguém online: recusado. De jogador fora da mesa: assume esse membro (o visto por último,
   * se houver vários). O mestre nunca é assumido por apelido.
   */
  matchNickname(nickname: string, online: Set<string>): NicknameMatch {
    const key = normalizeNickname(nickname)
    const same = this.store.listMembers().filter((m) => normalizeNickname(m.nickname) === key)
    if (same.some((m) => online.has(m.clientId))) return { kind: 'taken' }
    const player = same.filter((m) => m.role === 'player').sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0]
    return player ? { kind: 'adopt', clientId: player.clientId } : { kind: 'none' }
  }

  /** Membro mestre visto por último (o link de mestre num navegador novo volta a ser ele). */
  gmMember(): StoredMember | null {
    return this.store.listMembers().filter((m) => m.role === 'gm').sort((a, b) => b.lastSeenAt - a.lastSeenAt)[0] ?? null
  }

  /** "Já jogou aqui?": jogadores fora da mesa vistos nos últimos 7 dias, mais recentes primeiro. */
  knownPlayers(online: Set<string>): KnownPlayer[] {
    const now = this.now()
    return this.store
      .listMembers()
      .filter((m) => m.role === 'player' && !online.has(m.clientId) && now - m.lastSeenAt <= MEMBER_RECENT_MS)
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .map((m) => ({ nickname: m.nickname, color: m.color }))
  }
```

- [ ] **Step 5: Implement the TableDO and the route**

Em `apps/worker/src/table-do.ts`, troque o método `onHello` inteiro (e o comentário acima dele) por:

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

    const online = this.onlineClientIds()
    // Cliente M1 (sem v:2) não guarda segredo: admitido sem emitir hash, para não se trancar fora.
    const m2 = msg.v === 2
    let clientId = msg.clientId
    const existing = this.store.getMember(clientId)
    let adopted = false
    // Navegador novo (clientId desconhecido): o mestre volta a ser o membro mestre; o jogador assume
    // quem tem o mesmo apelido e está fora da mesa; apelido de alguém online é recusado.
    if (!existing && m2) {
      let targetId: string | null = null
      if (role === 'gm') {
        targetId = this.engine.gmMember()?.clientId ?? null
      } else {
        const match = this.engine.matchNickname(msg.nickname, online)
        if (match.kind === 'taken') {
          this.send(ws, { t: 'error', reason: 'nickname_taken' })
          ws.close(4409, 'nickname_taken')
          return
        }
        if (match.kind === 'adopt') targetId = match.clientId
      }
      if (targetId) {
        clientId = targetId
        adopted = true
      }
    }

    let issued: string | undefined
    if (adopted) {
      issued = candidate // segredo novo para este navegador; o do navegador antigo deixa de valer
    } else if (existing?.secretHash) {
      const ok = providedHash !== null && safeEqual(providedHash, existing.secretHash)
      if (!ok) {
        if (role !== 'gm') {
          this.send(ws, { t: 'error', reason: 'auth' })
          ws.close(4401, 'auth')
          return
        }
        // O link do mestre já prova a identidade de mestre: recupera e rotaciona o segredo.
        if (m2) issued = candidate
      }
    } else if (m2) {
      issued = candidate // membro novo ou do M1 sem hash: trust-on-first-use
    }

    const member = this.engine.join(
      { clientId, nickname: msg.nickname, role, ...(issued ? { secretHash: candidateHash } : {}) },
      online,
    )
    const att: Attachment = { sessionId: crypto.randomUUID(), clientId, role }
    ws.serializeAttachment(att)
    online.add(clientId)
    this.send(ws, {
      t: 'welcome',
      self: member,
      snapshot: this.engine.snapshot(role, online, clientId),
      ...(issued ? { clientSecret: issued } : {}),
    })
    this.broadcast(att.sessionId, () => ({ t: 'memberJoined', member }))
    this.reportActivity()
  }
```

No método `fetch` do `TableDO`, antes do `return new Response('not found', { status: 404 })` final:

```ts
    if (url.pathname === '/members' && request.method === 'GET') {
      if (!this.store.getMeta()) return Response.json({ players: [] })
      return Response.json({ players: this.engine.knownPlayers(this.onlineClientIds()) })
    }
```

Em `apps/worker/src/index.ts`, dentro do bloco `if (parts[0] === 'api' && parts[1] === 'tables')`, depois do `if` do `assets`:

```ts
      if (parts.length === 4 && parts[3] === 'members' && request.method === 'GET') {
        return stub.fetch(new Request('https://table/members', request))
      }
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/worker test`
Expected: PASS. Se algum teste de outro plano abrir **dois clientes novos online ao mesmo tempo com o mesmo apelido de jogador**, troque o apelido do segundo (ex.: `'Ana 2'`): a recusa é a regra nova do spec (§7).

- [ ] **Step 7: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add packages/shared apps/worker/src apps/worker/test
git commit -m "feat(identidade): navegador novo assume o membro pelo apelido ou pelo link de mestre" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Vínculo entre sessões no cliente ("Já jogou aqui?")

**Files:**
- Modify: `apps/web/src/lib/identity.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/store/tableStore.ts`
- Modify: `apps/web/src/ui/NicknameModal.tsx`, `apps/web/src/ui/TablePage.tsx`, `apps/web/src/styles.css`
- Create: `apps/web/test/identity-adopt.test.ts`, `apps/web/test/nickname-modal.test.tsx`
- Modify: `e2e/table.spec.ts`

**Interfaces:**
- Consumes (Task 4): `KnownPlayer`; `GET /api/tables/:id/members`; `welcome.self.clientId` do membro assumido; `error` `nickname_taken`.
- Produces: `getTableClientId(tableId: string): string`; `rememberTableClientId(tableId: string, clientId: string): void`; `fetchKnownPlayers(tableId: string): Promise<KnownPlayer[]>`; `NICKNAME_TAKEN = 'Esse apelido está em uso na mesa agora'`; `NicknameModal` com props `{ onSubmit; knownPlayers?: KnownPlayer[]; error?: string | null }`; `actions.connect` zera `fatal`; E2E: `playerPath(t: { tableId: string; playerKey?: string }): string` e `selfId(page: Page): Promise<string>`.

- [ ] **Step 1: Write the failing tests**

Crie `apps/web/test/identity-adopt.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_LAYERS, DEFAULT_SETTINGS, type Member, type ServerMessage } from '@mesa/shared'
import type { WebSocketLike } from '../src/sync/SyncClient'
import { createTableStore } from '../src/store/tableStore'
import { getClientId, getTableClientId } from '../src/lib/identity'

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

const old: Member = { clientId: 'old-id', nickname: 'Ana', color: '#e6194b', role: 'player', online: true }
const welcome = (self: Member, clientSecret?: string): ServerMessage => ({
  t: 'welcome',
  self,
  snapshot: { meta: { id: 'T', name: 'M' }, members: [self], layers: DEFAULT_LAYERS.slice(0, 3), objects: [], locks: [], notes: {}, settings: DEFAULT_SETTINGS, chat: [] },
  ...(clientSecret ? { clientSecret } : {}),
})
const hello = (i: number) => FakeSocket.all[i].sent.find((m) => m.t === 'hello')

let mem: Map<string, string>
beforeEach(() => {
  FakeSocket.all = []
  mem = new Map()
  vi.stubGlobal('window', { location: { protocol: 'http:', host: 'localhost' } })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('membro assumido', () => {
  it('welcome com outro clientId: grava id e segredo desta mesa; a próxima conexão usa os dois; outras mesas seguem com o id global', () => {
    const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
    store.getState().actions.connect('Ana')
    FakeSocket.all[0].onopen?.({})
    expect(hello(0).clientId).toBe(getClientId())
    FakeSocket.all[0].receive(welcome(old, 's'.repeat(43)))
    expect(store.getState().self?.clientId).toBe('old-id')
    expect(mem.get('mesa:clientId:T')).toBe('old-id')

    store.getState().actions.connect('Ana')
    FakeSocket.all[1].onopen?.({})
    expect(hello(1)).toMatchObject({ clientId: 'old-id', clientSecret: 's'.repeat(43) })
    expect(getTableClientId('U')).toBe(getClientId())
  })

  it('nickname_taken vira fatal; um novo connect limpa o fatal antes de tentar de novo', () => {
    const store = createTableStore('T', { createSocket: (url) => new FakeSocket(url) })
    store.getState().actions.connect('Ana')
    FakeSocket.all[0].onopen?.({})
    FakeSocket.all[0].receive({ t: 'error', reason: 'nickname_taken' })
    expect(store.getState().fatal).toBe('nickname_taken')
    store.getState().actions.connect('Bia')
    expect(store.getState().fatal).toBeNull()
  })
})
```

Crie `apps/web/test/nickname-modal.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NICKNAME_TAKEN, NicknameModal } from '../src/ui/NicknameModal'

const render = (props: Partial<Parameters<typeof NicknameModal>[0]> = {}) =>
  renderToStaticMarkup(<NicknameModal onSubmit={() => {}} {...props} />).replace(/<!-- -->/g, '')

describe('NicknameModal', () => {
  it('com jogadores conhecidos: "Já jogou aqui? Clique no seu nome" e um botão por nome (texto escapado)', () => {
    const html = render({ knownPlayers: [{ nickname: 'Ana', color: '#e6194b' }, { nickname: '<b>Bia</b>', color: '#3cb44b' }] })
    expect(html).toContain('Já jogou aqui? Clique no seu nome')
    expect(html).toContain('>Ana</button>')
    expect(html).toContain('&lt;b&gt;Bia&lt;/b&gt;')
    expect(html).not.toContain('<b>Bia')
  })

  it('sem jogadores conhecidos não mostra a seção; erro aparece como alerta; sem travessões', () => {
    const html = render({ error: NICKNAME_TAKEN })
    expect(html).not.toContain('Já jogou aqui?')
    expect(html).toContain('role="alert"')
    expect(html).toContain('Esse apelido está em uso na mesa agora')
    expect(html).toContain('Seu apelido')
    expect(html).not.toMatch(/[–—]/)
  })
})
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mesa/web test test/identity-adopt.test.ts test/nickname-modal.test.tsx`
Expected: FAIL (`getTableClientId`/`NICKNAME_TAKEN` não existem).

- [ ] **Step 3: Implement identity and store**

Em `apps/web/src/lib/identity.ts`, depois de `getClientId`:

```ts
const tableClientKey = (tableId: string) => `mesa:clientId:${tableId}`
// fallback em memória quando o localStorage está bloqueado
const memoryTableClient = new Map<string, string>()

/** Id do membro nesta mesa: o assumido (apelido ou link de mestre) ou, sem ele, o id global do navegador. */
export function getTableClientId(tableId: string): string {
  return memoryTableClient.get(tableId) ?? safeGet(tableClientKey(tableId)) ?? getClientId()
}

export function rememberTableClientId(tableId: string, clientId: string): void {
  memoryTableClient.set(tableId, clientId)
  safeSet(tableClientKey(tableId), clientId)
}
```

Em `apps/web/src/store/tableStore.ts`:
1. Troque o import de identity por:

```ts
import {
  getTableClientId, readClientSecret, readGmSecret, rememberClientSecret, rememberTableClientId, shouldRetryAuth,
} from '../lib/identity'
```

2. Em `actions.connect`, troque o começo até o fim do `onMessage` (o trecho de `sync?.close()` até antes de `onStatus:`) por:

```ts
        sync?.close()
        set({ fatal: null })
        let sentSecret: string | undefined
        let sentClientId = ''
        // Callbacks de um cliente antigo (ex.: o close assíncrono do StrictMode)
        // são ignorados para não sobrescrever o status do cliente atual.
        const client: SyncClient = new SyncClient({
          url: wsUrl(tableId),
          hello: () => {
            const gmSecret = readGmSecret(tableId)
            sentSecret = readClientSecret(tableId)
            sentClientId = getTableClientId(tableId)
            return {
              t: 'hello',
              v: 2,
              clientId: sentClientId,
              nickname,
              ...(gmSecret ? { gmSecret } : {}),
              ...(sentSecret ? { clientSecret: sentSecret } : {}),
            }
          },
          onMessage: (msg) => {
            if (sync !== client) return
            if (msg.t === 'ack') writes++
            if (msg.t === 'welcome') {
              // Navegador novo que assumiu um membro (apelido ou link de mestre): guarda o id dele para esta mesa.
              if (msg.self.clientId !== sentClientId) rememberTableClientId(tableId, msg.self.clientId)
              if (msg.clientSecret) rememberClientSecret(tableId, msg.clientSecret)
            }
            if (msg.t === 'error' && msg.reason === 'auth' && shouldRetryAuth(sentSecret, readClientSecret(tableId), authRetried)) {
              authRetried = true
              actions.connect(nickname)
              return
            }
            set((s) => reduceServer(s, msg, Date.now()))
          },
```

(Se um plano anterior tiver acrescentado linhas dentro desse trecho, mantenha-as.)

Em `apps/web/src/lib/api.ts`, acrescente:

```ts
import type { KnownPlayer } from '@mesa/shared'

/** "Já jogou aqui?": jogadores fora da mesa; qualquer falha vira lista vazia. */
export async function fetchKnownPlayers(tableId: string): Promise<KnownPlayer[]> {
  try {
    const res = await fetch(`/api/tables/${tableId}/members`)
    if (!res.ok) return []
    const body = (await res.json()) as { players?: unknown }
    return Array.isArray(body.players) ? (body.players as KnownPlayer[]) : []
  } catch {
    return []
  }
}
```

(o `import type` vai para o topo do arquivo.)

- [ ] **Step 4: Implement the modal and the page**

Substitua `apps/web/src/ui/NicknameModal.tsx` por:

```tsx
import { useState } from 'react'
import type { KnownPlayer } from '@mesa/shared'

export const NICKNAME_TAKEN = 'Esse apelido está em uso na mesa agora'

export function NicknameModal({
  onSubmit,
  knownPlayers = [],
  error = null,
}: {
  onSubmit: (nickname: string) => void
  knownPlayers?: KnownPlayer[]
  error?: string | null
}) {
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
        {knownPlayers.length > 0 && (
          <div className="known-players">
            <p>Já jogou aqui? Clique no seu nome</p>
            <div className="known-list">
              {knownPlayers.map((p, i) => (
                <button key={`${p.nickname}-${i}`} type="button" onClick={() => onSubmit(p.nickname)}>
                  <span className="dot" style={{ background: p.color }} aria-hidden="true" />
                  {p.nickname}
                </button>
              ))}
            </div>
          </div>
        )}
        <label>
          Seu apelido
          <input autoFocus value={value} maxLength={32} onChange={(e) => setValue(e.target.value)} style={{ width: '100%' }} />
        </label>
        {error && <p role="alert" className="form-error">{error}</p>}
        <button type="submit" disabled={!trimmed}>Entrar</button>
      </form>
    </div>
  )
}
```

Em `apps/web/src/ui/TablePage.tsx`:
1. Imports: acrescente `import { useStore } from 'zustand'`, `import { fetchKnownPlayers } from '../lib/api'`, `type KnownPlayer` ao import de `@mesa/shared`, e troque `import { NicknameModal } from './NicknameModal'` por `import { NICKNAME_TAKEN, NicknameModal } from './NicknameModal'`.
2. Substitua a função `TablePage` inteira por:

```tsx
export function TablePage({ tableId }: { tableId: string }) {
  const store = useMemo(() => createTableStore(tableId), [tableId])
  const [nickname, setNick] = useState<string | null>(() => getNickname())
  const [nickError, setNickError] = useState<string | null>(null)
  const [known, setKnown] = useState<KnownPlayer[]>([])
  const fatal = useStore(store, (s) => s.fatal)

  useEffect(() => {
    if (debug) (window as unknown as { __mesa?: typeof store }).__mesa = store
  }, [store])

  useEffect(() => {
    if (!nickname) return
    store.getState().actions.connect(nickname)
    return () => store.getState().actions.disconnect()
  }, [store, nickname])

  // Apelido de alguém online: volta para a tela de entrada com o aviso.
  useEffect(() => {
    if (fatal !== 'nickname_taken') return
    setNickError(NICKNAME_TAKEN)
    setNick(null)
  }, [fatal])

  useEffect(() => {
    if (nickname) return
    let alive = true
    void fetchKnownPlayers(tableId).then((players) => {
      if (alive) setKnown(players)
    })
    return () => {
      alive = false
    }
  }, [tableId, nickname])

  return (
    <TableStoreContext.Provider value={store}>
      {nickname ? (
        <TableView />
      ) : (
        <NicknameModal
          knownPlayers={known}
          error={nickError}
          onSubmit={(n) => {
            setNickname(n)
            setNickError(null)
            setNick(n)
          }}
        />
      )}
    </TableStoreContext.Provider>
  )
}
```

3. Em `FatalMessage` (Task 2), primeira linha da função: `if (reason === 'nickname_taken') return null`.

Em `apps/web/src/styles.css`, no fim:

```css
.known-players p { margin: 0 0 6px; }
.known-list { display: flex; flex-wrap: wrap; gap: 6px; }
.form-error { color: #f88; margin: 0; }
```

Run: `pnpm --filter @mesa/web test`
Expected: PASS.

- [ ] **Step 5: Write the E2E tests**

Em `e2e/table.spec.ts`:
1. Troque a assinatura de `newTable` por `async function newTable(page: Page): Promise<{ tableId: string; gmSecret: string; playerKey?: string }>`.
2. Depois de `waitOpen`, acrescente:

```ts
/** Caminho do jogador; a partir da chave de jogador (#j=), leva a chave da mesa. */
const playerPath = (t: { tableId: string; playerKey?: string }) =>
  `/t/${t.tableId}?debug=1${t.playerKey ? `#j=${t.playerKey}` : ''}`

const selfId = (page: Page): Promise<string> => page.evaluate(() => (window as any).__mesa.getState().self.clientId)
```

3. No fim do arquivo:

```ts
// ---------------------------------------------------------------- vínculo entre sessões

test('jogador volta com navegador limpo pelo "Já jogou aqui?": mesmo membro e controle do próprio token', async ({ browser, page }) => {
  const t = await newTable(page)
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  const player = await open(browser, playerPath(t), 'Ana')
  const anaId = await selfId(player)
  await uploadToken(player)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await player.context().close()
  await expect
    .poll(() => gm.evaluate((id) => (window as any).__mesa.getState().members[id]?.online, anaId))
    .toBe(false)

  const back = await (await browser.newContext()).newPage()
  await back.goto(playerPath(t))
  await expect(back.getByText('Já jogou aqui? Clique no seu nome')).toBeVisible()
  await back.getByRole('button', { name: 'Ana', exact: true }).click()
  await waitOpen(back)
  expect(await selfId(back)).toBe(anaId)
  const [token] = await objects(back)
  await dragObject(back, token, 100, 50)
  await expect.poll(async () => Math.round((await objects(gm))[0].x)).toBe(Math.round(token.x + 100))
})

test('mestre com navegador limpo pelo link de mestre recupera a autoria', async ({ browser, page }) => {
  const t = await newTable(page)
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  const gmId = await selfId(gm)
  await uploadToken(gm)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await gm.context().close()
  const again = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  expect(await selfId(again)).toBe(gmId)
  const owner = await again.evaluate(() => (Object.values((window as any).__mesa.getState().objects)[0] as any).ownerId)
  expect(owner).toBe(gmId)
})
```

- [ ] **Step 6: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`
Expected: verde, incluindo os dois testes novos.

```bash
git add apps/web/src apps/web/test/identity-adopt.test.ts apps/web/test/nickname-modal.test.tsx e2e/table.spec.ts
git commit -m "feat(entrada): \"Já jogou aqui?\" e id do membro por mesa no navegador" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Página inicial local

**Files:**
- Create: `apps/web/src/lib/registry.ts`, `apps/web/src/ui/HomeView.tsx`, `apps/web/test/home.test.tsx`
- Modify: `apps/web/src/ui/HomePage.tsx` (reescrito), `apps/web/src/styles.css`, `e2e/table.spec.ts`

**Interfaces:**
- Consumes (Tasks 1, 2): rotas do índice; `RegistryTable`, `RegistryView`, `TABLE_NAME_MAX`; `askConfirm`, `ConfirmOptions` (`apps/web/src/ui/confirm.ts`); `createTable` (`lib/api.ts`); E2E `playerPath`, `open`, `waitOpen`, `newTable` (Task 5).
- Produces:
  - `lib/registry.ts`: `type RegistryLoad = { kind: 'local'; view: RegistryView } | { kind: 'remote' } | { kind: 'error' }`; `loadRegistry(): Promise<RegistryLoad>`; `renameTable(id: string, name: string): Promise<boolean>`; `deleteTable(id: string): Promise<boolean>`; `interface TableLinks { player: string; gm: string; openAsGm: string }`; `tableLinks(localOrigin: string, tunnelUrl: string | null, table: Pick<RegistryTable, 'id' | 'gmSecret' | 'playerKey'>): TableLinks`; `playersLabel(n: number): string`; `formatWhen(ms: number): string`; `deleteConfirmOptions(name: string): ConfirmOptions`; `copyText(text: string): Promise<boolean>`.
  - `HomeView.tsx`: `interface HomeActions { create(name: string): Promise<boolean>; rename(id: string, name: string): Promise<boolean>; remove(table: RegistryTable): Promise<void>; retry(): void }`; `HomeView({ load, origin, actions, notice })`; `TableCard`; `CopyButton({ text, label })`.
  - E2E: `tableCard(page, name)`.

- [ ] **Step 1: Write the failing tests**

Crie `apps/web/test/home.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RegistryTable } from '@mesa/shared'
import { deleteConfirmOptions, formatWhen, playersLabel, tableLinks, type RegistryLoad } from '../src/lib/registry'
import { HomeView, type HomeActions } from '../src/ui/HomeView'

const table: RegistryTable = {
  id: 'AbCdEfGhIj', name: 'Campanha <b>', createdAt: Date.UTC(2026, 9, 1, 12), lastActivityAt: Date.UTC(2026, 9, 8, 12),
  players: 2, gmSecret: 'segredo', playerKey: null,
}
const actions: HomeActions = { create: async () => true, rename: async () => true, remove: async () => {}, retry: () => {} }
const render = (load: RegistryLoad | null) =>
  renderToStaticMarkup(<HomeView load={load} origin="http://localhost:8787" actions={actions} notice={null} />).replace(/<!-- -->/g, '')

describe('HomeView', () => {
  it('local com túnel: link do túnel, card com nome escapado, jogadores e todos os botões', () => {
    const html = render({ kind: 'local', view: { tables: [table], tunnelUrl: 'https://abc-def.trycloudflare.com' } })
    expect(html).toContain('https://abc-def.trycloudflare.com')
    expect(html).toContain('Campanha &lt;b&gt;')
    expect(html).not.toContain('Campanha <b>')
    expect(html).toContain('2 jogadores')
    for (const label of ['Abrir como mestre', 'Copiar link de mestre', 'Copiar link de jogador', 'Renomear', 'Apagar', 'Criar mesa', 'Nome da mesa']) {
      expect(html, label).toContain(label)
    }
    expect(html).toContain('href="/t/AbCdEfGhIj#gm=segredo"')
  })

  it('local sem túnel: "Túnel indisponível, só local"; lista vazia convida a criar', () => {
    const html = render({ kind: 'local', view: { tables: [], tunnelUrl: null } })
    expect(html).toContain('Túnel indisponível, só local')
    expect(html).toContain('Nenhuma mesa ainda')
  })

  it('remoto: só "Peça o link da mesa ao mestre", sem lista e sem criar mesa', () => {
    const html = render({ kind: 'remote' })
    expect(html).toContain('Peça o link da mesa ao mestre')
    expect(html).not.toContain('Criar mesa')
    expect(html).not.toContain('Abrir como mestre')
  })

  it('erro mostra "Tentar de novo"; nenhum estado tem travessão', () => {
    expect(render({ kind: 'error' })).toContain('Tentar de novo')
    for (const load of [null, { kind: 'remote' }, { kind: 'error' }, { kind: 'local', view: { tables: [table], tunnelUrl: null } }] as const) {
      expect(render(load as RegistryLoad | null)).not.toMatch(/[–—]/)
    }
  })
})

describe('helpers da página inicial', () => {
  it('tableLinks: com túnel usa o túnel; sem túnel usa a origem local; "Abrir como mestre" é relativo; chave de jogador vai no #j=', () => {
    expect(tableLinks('http://localhost:8787', 'https://t.trycloudflare.com', table)).toEqual({
      player: 'https://t.trycloudflare.com/t/AbCdEfGhIj',
      gm: 'https://t.trycloudflare.com/t/AbCdEfGhIj#gm=segredo',
      openAsGm: '/t/AbCdEfGhIj#gm=segredo',
    })
    expect(tableLinks('http://localhost:8787', null, { ...table, playerKey: 'k1' }).player).toBe('http://localhost:8787/t/AbCdEfGhIj#j=k1')
  })

  it('playersLabel, formatWhen e texto do aviso de apagar', () => {
    expect([0, 1, 3].map(playersLabel)).toEqual(['Nenhum jogador', '1 jogador', '3 jogadores'])
    expect(formatWhen(Date.UTC(2026, 9, 8, 12))).toContain('2026')
    expect(deleteConfirmOptions('Sexta')).toEqual({
      title: 'Apagar mesa',
      message: 'Apagar a mesa Sexta? Desenhos, tokens, chat e turnos serão perdidos.',
      confirmLabel: 'Apagar',
      danger: true,
    })
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @mesa/web test test/home.test.tsx`
Expected: FAIL (módulos inexistentes).

- [ ] **Step 3: Implement `lib/registry.ts`**

```ts
import type { RegistryTable, RegistryView } from '@mesa/shared'
import type { ConfirmOptions } from '../ui/confirm'

export type RegistryLoad = { kind: 'local'; view: RegistryView } | { kind: 'remote' } | { kind: 'error' }

/** 404 = pedido de fora do PC (túnel): a página não mostra lista nem criação. */
export async function loadRegistry(): Promise<RegistryLoad> {
  try {
    const res = await fetch('/api/registry/tables')
    if (res.status === 404) return { kind: 'remote' }
    if (!res.ok) return { kind: 'error' }
    return { kind: 'local', view: (await res.json()) as RegistryView }
  } catch {
    return { kind: 'error' }
  }
}

export async function renameTable(id: string, name: string): Promise<boolean> {
  try {
    const res = await fetch(`/api/registry/tables/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function deleteTable(id: string): Promise<boolean> {
  try {
    return (await fetch(`/api/registry/tables/${id}`, { method: 'DELETE' })).ok
  } catch {
    return false
  }
}

export interface TableLinks {
  player: string
  gm: string
  openAsGm: string
}

/** Links para mandar usam o túnel (sem túnel, a origem local); "Abrir como mestre" fica na origem local. */
export function tableLinks(
  localOrigin: string,
  tunnelUrl: string | null,
  table: Pick<RegistryTable, 'id' | 'gmSecret' | 'playerKey'>,
): TableLinks {
  const share = tunnelUrl ?? localOrigin
  return {
    player: `${share}/t/${table.id}${table.playerKey ? `#j=${table.playerKey}` : ''}`,
    gm: `${share}/t/${table.id}#gm=${table.gmSecret}`,
    openAsGm: `/t/${table.id}#gm=${table.gmSecret}`,
  }
}

export function playersLabel(n: number): string {
  if (n === 0) return 'Nenhum jogador'
  return n === 1 ? '1 jogador' : `${n} jogadores`
}

const WHEN = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function formatWhen(ms: number): string {
  return WHEN.format(ms)
}

export function deleteConfirmOptions(name: string): ConfirmOptions {
  return {
    title: 'Apagar mesa',
    message: `Apagar a mesa ${name}? Desenhos, tokens, chat e turnos serão perdidos.`,
    confirmLabel: 'Apagar',
    danger: true,
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}
```

(Se `ConfirmOptions` ganhou campos no plano de turnos, o objeto acima continua válido: os campos novos são opcionais.)

- [ ] **Step 4: Implement `HomeView.tsx` and `HomePage.tsx`**

Crie `apps/web/src/ui/HomeView.tsx`:

```tsx
import { useEffect, useState } from 'react'
import { TABLE_NAME_MAX, type RegistryTable } from '@mesa/shared'
import { copyText, formatWhen, playersLabel, tableLinks, type RegistryLoad, type TableLinks } from '../lib/registry'

export interface HomeActions {
  create(name: string): Promise<boolean>
  rename(id: string, name: string): Promise<boolean>
  remove(table: RegistryTable): Promise<void>
  retry(): void
}

export function HomeView({
  load,
  origin,
  actions,
  notice,
}: {
  load: RegistryLoad | null
  origin: string
  actions: HomeActions
  notice: string | null
}) {
  if (!load) {
    return (
      <main className="home">
        <h1>Mesa Virtual</h1>
      </main>
    )
  }
  if (load.kind === 'remote') {
    return (
      <main className="home">
        <h1>Mesa Virtual</h1>
        <p>Peça o link da mesa ao mestre</p>
      </main>
    )
  }
  if (load.kind === 'error') {
    return (
      <main className="home">
        <h1>Mesa Virtual</h1>
        <p role="alert">Não foi possível carregar as mesas.</p>
        <button type="button" onClick={actions.retry}>Tentar de novo</button>
      </main>
    )
  }
  const { tables, tunnelUrl } = load.view
  return (
    <main className="home">
      <h1>Mesa Virtual</h1>
      <TunnelBox tunnelUrl={tunnelUrl} />
      {notice && <p role="alert" className="form-error">{notice}</p>}
      <section aria-label="Suas mesas" className="home-section">
        <h2>Suas mesas</h2>
        {tables.length === 0 ? (
          <p className="muted">Nenhuma mesa ainda. Crie a primeira abaixo.</p>
        ) : (
          <ul className="table-list">
            {tables.map((t) => (
              <TableCard key={t.id} table={t} links={tableLinks(origin, tunnelUrl, t)} actions={actions} />
            ))}
          </ul>
        )}
      </section>
      <NewTableForm onCreate={actions.create} />
    </main>
  )
}

function TunnelBox({ tunnelUrl }: { tunnelUrl: string | null }) {
  if (!tunnelUrl) return <p className="tunnel-box tunnel-off">Túnel indisponível, só local</p>
  return (
    <div className="tunnel-box">
      <span>Link do túnel:</span>
      <code>{tunnelUrl}</code>
      <CopyButton text={tunnelUrl} label="Copiar" />
    </div>
  )
}

/** Copia; sem área de transferência, mostra o texto selecionado para Ctrl+C. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (state !== 'copied') return
    const timer = setTimeout(() => setState('idle'), 2_000)
    return () => clearTimeout(timer)
  }, [state])
  return (
    <>
      <button type="button" onClick={async () => setState((await copyText(text)) ? 'copied' : 'failed')}>
        {state === 'copied' ? 'Copiado' : label}
      </button>
      {state === 'failed' && (
        <input className="copy-fallback" readOnly value={text} aria-label="Copie com Ctrl+C" autoFocus onFocus={(e) => e.target.select()} />
      )}
    </>
  )
}

export function TableCard({ table, links, actions }: { table: RegistryTable; links: TableLinks; actions: HomeActions }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(table.name)
  const [busy, setBusy] = useState(false)

  async function save() {
    const name = draft.trim()
    if (!name || name === table.name) {
      setEditing(false)
      return
    }
    setBusy(true)
    const ok = await actions.rename(table.id, name)
    setBusy(false)
    if (ok) setEditing(false)
  }

  return (
    <li className="table-card">
      <h3>{table.name}</h3>
      <p className="table-meta">
        Criada em {formatWhen(table.createdAt)} · Última atividade em {formatWhen(table.lastActivityAt)} · {playersLabel(table.players)}
      </p>
      {editing && (
        <form
          className="rename-row"
          onSubmit={(e) => {
            e.preventDefault()
            void save()
          }}
        >
          <input
            aria-label="Novo nome"
            value={draft}
            maxLength={TABLE_NAME_MAX}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setEditing(false)
            }}
          />
          <button type="submit" className="primary" disabled={busy || !draft.trim()}>Salvar</button>
          <button type="button" onClick={() => setEditing(false)}>Cancelar</button>
        </form>
      )}
      <div className="table-actions">
        <a className="button primary" href={links.openAsGm}>Abrir como mestre</a>
        <CopyButton text={links.gm} label="Copiar link de mestre" />
        <CopyButton text={links.player} label="Copiar link de jogador" />
        <button
          type="button"
          onClick={() => {
            setDraft(table.name)
            setEditing(true)
          }}
        >
          Renomear
        </button>
        <button type="button" className="danger" onClick={() => void actions.remove(table)}>Apagar</button>
      </div>
    </li>
  )
}

function NewTableForm({ onCreate }: { onCreate: (name: string) => Promise<boolean> }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <form
      className="new-table"
      onSubmit={async (e) => {
        e.preventDefault()
        setBusy(true)
        const ok = await onCreate(name)
        setBusy(false)
        if (ok) setName('')
      }}
    >
      <h2>Nova mesa</h2>
      <label>
        Nome da mesa
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={TABLE_NAME_MAX} placeholder="Campanha de sexta" />
      </label>
      <button type="submit" className="primary" disabled={busy}>{busy ? 'Criando…' : 'Criar mesa'}</button>
    </form>
  )
}
```

Substitua `apps/web/src/ui/HomePage.tsx` por:

```tsx
import { useCallback, useEffect, useState } from 'react'
import { createTable } from '../lib/api'
import { deleteConfirmOptions, deleteTable, loadRegistry, renameTable, type RegistryLoad } from '../lib/registry'
import { askConfirm } from './confirm'
import { HomeView, type HomeActions } from './HomeView'

const REFRESH_MS = 10_000

export function HomePage() {
  const [load, setLoad] = useState<RegistryLoad | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const refresh = useCallback(async () => setLoad(await loadRegistry()), [])

  useEffect(() => {
    void refresh()
    // O launcher informa o túnel depois que o navegador abriu: a lista se atualiza sozinha (só com a aba visível).
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, REFRESH_MS)
    return () => clearInterval(timer)
  }, [refresh])

  const actions: HomeActions = {
    async create(name) {
      setNotice(null)
      try {
        await createTable(name.trim() || 'Nova mesa')
        await refresh()
        return true
      } catch {
        setNotice('Não foi possível criar a mesa. Tente de novo.')
        return false
      }
    },
    async rename(id, name) {
      setNotice(null)
      const ok = await renameTable(id, name)
      if (!ok) setNotice('Não foi possível renomear a mesa. Tente de novo.')
      await refresh()
      return ok
    },
    async remove(table) {
      if (!(await askConfirm(deleteConfirmOptions(table.name)))) return
      setNotice(null)
      if (!(await deleteTable(table.id))) setNotice('Não foi possível apagar a mesa. Tente de novo.')
      await refresh()
    },
    retry: () => void refresh(),
  }

  return <HomeView load={load} origin={window.location.origin} actions={actions} notice={notice} />
}
```

Em `apps/web/src/styles.css`, troque as três linhas `.home { ... }`, `.home .link-row { ... }`, `.home .link-row input { ... }` por:

```css
.home { max-width: 760px; margin: 6vh auto; padding: 24px 16px; display: grid; gap: 16px; }
.home h2 { margin: 0; font-size: 1.1rem; }
.home-section { display: grid; gap: 10px; }
.tunnel-box { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0; padding: 10px 12px; background: #26282e; border: 1px solid #3a3c45; border-radius: 8px; }
.tunnel-box code { overflow-wrap: anywhere; }
.tunnel-off { color: #f0c36a; }
.table-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; }
.table-card { background: #26282e; border: 1px solid #3a3c45; border-radius: 8px; padding: 12px; display: grid; gap: 8px; }
.table-card h3 { margin: 0; font-size: 1rem; overflow-wrap: anywhere; }
.table-meta { margin: 0; font-size: 0.85rem; color: #aab; }
.table-actions, .rename-row { display: flex; flex-wrap: wrap; gap: 6px; }
.rename-row input { flex: 1; min-width: 160px; }
a.button { display: inline-flex; align-items: center; padding: 6px 10px; border-radius: 6px; border: 1px solid #4a4d57; background: #33353d; color: #eee; text-decoration: none; }
a.button.primary { background: #4363d8; border-color: #4363d8; color: #fff; }
.copy-fallback { flex-basis: 100%; }
.new-table { display: grid; gap: 10px; }
.new-table input { width: 100%; }
.muted { color: #aab; margin: 0; }
```

Run: `pnpm --filter @mesa/web test`
Expected: PASS (inclui `confirm.test.ts`, que varre `src` atrás de diálogos nativos).

- [ ] **Step 5: Write the E2E tests**

Em `e2e/table.spec.ts`, no fim:

```ts
// ---------------------------------------------------------------- página inicial local

const tableCard = (page: Page, name: string) =>
  page.locator('.table-card').filter({ has: page.getByRole('heading', { name, exact: true }) })

test('lista local: criar duas mesas pela página, mais recente primeiro; renomear persiste', async ({ page }) => {
  const stamp = Date.now()
  const [a, b, c] = [`Lista A ${stamp}`, `Lista B ${stamp}`, `Lista C ${stamp}`]
  await page.goto('/')
  for (const name of [a, b]) {
    await page.getByLabel('Nome da mesa').fill(name)
    await page.getByRole('button', { name: 'Criar mesa' }).click()
    await expect(tableCard(page, name)).toBeVisible()
  }
  const names = await page.locator('.table-card h3').allTextContents()
  expect(names.indexOf(b)).toBeLessThan(names.indexOf(a))

  const card = tableCard(page, a)
  await card.getByRole('button', { name: 'Renomear' }).click()
  await card.getByLabel('Novo nome').fill(c)
  await card.getByRole('button', { name: 'Salvar' }).click()
  await expect(tableCard(page, c)).toBeVisible()
  await page.reload()
  await expect(tableCard(page, c)).toBeVisible()
  await expect(tableCard(page, a)).toHaveCount(0)
})

test('apagar pelo aviso do app: some da lista; o jogador conectado vê "A mesa foi apagada" e volta ao início', async ({ browser, page }) => {
  const name = `Apagar ${Date.now()}`
  const res = await page.request.post('/api/tables', { data: { name } })
  const t = await res.json()
  const player = await open(browser, playerPath(t), 'Ana')
  await page.goto('/')
  const card = tableCard(page, name)
  await card.getByRole('button', { name: 'Apagar' }).click()
  const dialog = page.getByRole('alertdialog')
  await expect(dialog).toContainText(`Apagar a mesa ${name}? Desenhos, tokens, chat e turnos serão perdidos.`)
  await dialog.getByRole('button', { name: 'Apagar' }).click()
  await expect(card).toHaveCount(0)
  await expect(player.getByText('A mesa foi apagada')).toBeVisible()
  await expect(player).toHaveURL(/\/$/, { timeout: 10_000 })
})

test('links das mesas usam o túnel informado; sem túnel, aviso e links locais', async ({ page }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  const name = `Túnel ${Date.now()}`
  const t = await (await page.request.post('/api/tables', { data: { name } })).json()
  const tunnel = 'https://e2e-teste.trycloudflare.com'
  const key = t.playerKey ? `#j=${t.playerKey}` : ''
  expect((await page.request.post('/api/registry/tunnel', { data: { url: tunnel } })).status()).toBe(204)
  try {
    await page.goto('/')
    await expect(page.getByText(tunnel)).toBeVisible()
    const card = tableCard(page, name)
    await card.getByRole('button', { name: 'Copiar link de jogador' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${tunnel}/t/${t.tableId}${key}`)
    await card.getByRole('button', { name: 'Copiar link de mestre' }).click()
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`${tunnel}/t/${t.tableId}#gm=${t.gmSecret}`)
    await expect(card.getByRole('link', { name: 'Abrir como mestre' })).toHaveAttribute('href', `/t/${t.tableId}#gm=${t.gmSecret}`)
  } finally {
    await page.request.post('/api/registry/tunnel', { data: { url: null } })
  }
  await page.reload()
  await expect(page.getByText('Túnel indisponível, só local')).toBeVisible()
})

test('pedido pelo túnel (cabeçalhos da Cloudflare) não vê a lista nem cria mesa; o link da mesa funciona', async ({ browser, page }) => {
  const edge = { 'cf-ray': '8f00000000000000-GRU', 'cf-connecting-ip': '200.100.50.25' }
  expect((await page.request.get('/api/registry/tables', { headers: edge })).status()).toBe(404)
  expect((await page.request.post('/api/tables', { headers: edge, data: { name: 'x' } })).status()).toBe(404)
  const t = await newTable(page)
  const remote = await (await browser.newContext({ extraHTTPHeaders: edge })).newPage()
  await remote.goto('/')
  await expect(remote.getByText('Peça o link da mesa ao mestre')).toBeVisible()
  await expect(remote.getByRole('button', { name: 'Criar mesa' })).toHaveCount(0)
  await remote.goto(playerPath(t))
  await remote.getByLabel('Seu apelido').fill('Remota')
  await remote.getByRole('button', { name: 'Entrar' }).click()
  await waitOpen(remote)
})
```

- [ ] **Step 6: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add apps/web/src/lib/registry.ts apps/web/src/ui/HomeView.tsx apps/web/src/ui/HomePage.tsx apps/web/src/styles.css \
  apps/web/test/home.test.tsx e2e/table.spec.ts
git commit -m "feat(início): lista local de mesas com links do túnel, renomear e apagar" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Launcher abre a lista local e informa o túnel

**Files:**
- Create: `apps/launcher/src/registry.mjs`, `apps/launcher/test/registry.test.mjs`
- Modify: `apps/launcher/src/main.mjs` (`createSession`), `apps/launcher/src/messages.mjs`, `apps/launcher/test/main.test.mjs`, `apps/launcher/test/readme.test.mjs`, `README.md`

**Interfaces:**
- Consumes (Task 1): `POST /api/registry/tunnel { url }` (local; 204).
- Produces: `TUNNEL_REPORT_INTERVAL_MS = 30_000`; `reportTunnel(deps, port, url): Promise<boolean>` (nunca lança); `repeatEvery(deps, ms, fn): () => void` (usa `deps.setTimer`, de disparo único). No `createSession`: `setTunnelLink(link)`; o navegador abre `http://localhost:<porta>/`.

- [ ] **Step 1: Write the failing tests**

Crie `apps/launcher/test/registry.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { TUNNEL_REPORT_INTERVAL_MS, repeatEvery, reportTunnel } from '../src/registry.mjs'

describe('reportTunnel', () => {
  it('POST local com o endereço; 204 = aceito; servidor fora do ar não lança', async () => {
    const calls = []
    const deps = { fetch: async (url, init) => { calls.push({ url, init }); return new Response(null, { status: 204 }) } }
    expect(await reportTunnel(deps, 8790, 'https://abc.trycloudflare.com')).toBe(true)
    expect(calls[0].url).toBe('http://127.0.0.1:8790/api/registry/tunnel')
    expect(calls[0].init.method).toBe('POST')
    expect(JSON.parse(calls[0].init.body)).toEqual({ url: 'https://abc.trycloudflare.com' })
    expect(await reportTunnel({ fetch: async () => { throw new TypeError('fetch failed') } }, 8790, null)).toBe(false)
  })
})

describe('repeatEvery', () => {
  it('repete a cada intervalo até parar', () => {
    const timers = []
    const deps = { setTimer: (fn, ms) => { const t = { fn, ms, cancelled: false }; timers.push(t); return () => { t.cancelled = true } } }
    let n = 0
    const stop = repeatEvery(deps, TUNNEL_REPORT_INTERVAL_MS, () => n++)
    expect(timers).toHaveLength(1)
    expect(timers[0].ms).toBe(30_000)
    timers[0].fn()
    timers[1].fn()
    expect(n).toBe(2)
    stop()
    expect(timers[2].cancelled).toBe(true)
    timers[2].fn()
    expect(n).toBe(2)
  })
})
```

Em `apps/launcher/test/main.test.mjs`:
1. Depois de `const taskkills = ...`:

```js
const tunnelReports = (h) =>
  h.fetches.filter((f) => f.url === 'http://127.0.0.1:8787/api/registry/tunnel' && f.method === 'POST').map((f) => JSON.parse(f.body).url)
```

2. No teste `'sobe servidor e túnel, copia e abre o link e desliga no Ctrl+C'`, troque o nome para `'sobe servidor e túnel, copia o link, informa o túnel, abre a lista local e desliga no Ctrl+C'` e troque

```js
    expect(h.browser).toHaveLength(1)
    expect(h.browser[0]).toContain('https://mesa-1.trycloudflare.com')
```

por

```js
    // o navegador abre a lista local de mesas, não o túnel
    expect(h.browser).toHaveLength(1)
    expect(h.browser[0]).toContain('"http://localhost:8787/"')
    expect(tunnelReports(h)).toEqual(['https://mesa-1.trycloudflare.com'])
```

3. No teste `'túnel sem URL em 60 s → link local copiado e aberto'`, depois de `expect(h.browser[0]).toContain('http://localhost:8787')`: `expect(tunnelReports(h)).toEqual([])`.
4. No teste `'túnel cai: reabre uma vez com link novo copiado (sem reabrir o navegador); cai de novo → link local'`, antes de `h.signal()`:

```js
    expect(tunnelReports(h)).toEqual(['https://mesa-1.trycloudflare.com', null, 'https://mesa-2.trycloudflare.com', null])
```

5. No teste `'link velho: túnel morre durante a espera → só o link do túnel novo é mostrado e copiado'`, troque `expect(h.browser).toHaveLength(0)` por:

```js
    expect(h.browser).toHaveLength(1)
    expect(h.browser[0]).toContain('"http://localhost:8787/"')
    expect(tunnelReports(h)).toEqual(['https://mesa-1.trycloudflare.com', null, 'https://mesa-2.trycloudflare.com'])
```

6. Dentro de `describe('run: quedas e encerramento', ...)`, acrescente:

```js
  // Review Focus #4
  it('servidor cai e volta: informa de novo o túnel atual (o índice guarda o endereço só em memória)', async () => {
    const { h, root } = setup()
    const result = (await startServing(h, root)).result
    expect(tunnelReports(h)).toEqual(['https://mesa-1.trycloudflare.com'])
    h.children.server[0].exit(1)
    await until(() => tunnelReports(h).length === 2, 'novo aviso do túnel')
    expect(tunnelReports(h)).toEqual(['https://mesa-1.trycloudflare.com', 'https://mesa-1.trycloudflare.com'])
    h.signal()
    expect(await result).toBe(0)
  })
```

Em `apps/launcher/test/readme.test.mjs`, acrescente à lista de textos: `'Peça o link da mesa ao mestre'`, `'Já jogou aqui?'` e `'http://localhost:<porta>/'`.

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter ./apps/launcher test`
Expected: FAIL (`../src/registry.mjs` não existe; navegador abre o túnel; README sem os textos).

- [ ] **Step 3: Implement**

Crie `apps/launcher/src/registry.mjs`:

```js
export const TUNNEL_REPORT_INTERVAL_MS = 30_000

/** Informa ao servidor local o endereço do túnel (null = sem túnel). Nunca lança; true = servidor aceitou. */
export async function reportTunnel(deps, port, url) {
  try {
    const res = await deps.fetch(`http://127.0.0.1:${port}/api/registry/tunnel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(5_000),
    })
    await res.body?.cancel?.()
    return res.status === 204
  } catch {
    return false
  }
}

/** Chama `fn` a cada `ms` (deps.setTimer é de disparo único). Devolve a função que para. */
export function repeatEvery(deps, ms, fn) {
  let stopped = false
  let cancel = () => {}
  const schedule = () => {
    cancel = deps.setTimer(() => {
      if (stopped) return
      fn()
      schedule()
    }, ms)
  }
  schedule()
  return () => {
    stopped = true
    cancel()
  }
}
```

Em `apps/launcher/src/main.mjs`:
1. Import: `import { TUNNEL_REPORT_INTERVAL_MS, repeatEvery, reportTunnel } from './registry.mjs'`.
2. Em `createSession`, junto das variáveis (`let shuttingDown = false` etc.):

```js
  /** @type {string | null} */
  let tunnelLink = null
  let stopReporting = () => {}

  /** O servidor guarda o endereço do túnel só em memória: avisa na hora e repete a cada 30 s enquanto houver túnel. */
  function setTunnelLink(link) {
    tunnelLink = link
    log.write(`túnel informado ao servidor: ${link ?? 'nenhum'}`)
    void reportTunnel(deps, port, link)
    stopReporting()
    stopReporting = link
      ? repeatEvery(deps, TUNNEL_REPORT_INTERVAL_MS, () => { void reportTunnel(deps, port, tunnelLink) })
      : () => {}
  }
```

3. `announce`: troque a assinatura `async function announce(link, { browser, remote = false, proc = null })` por `async function announce(link, { remote = false, proc = null })` e apague a linha `if (browser) openBrowser(deps, link)`.
4. `shutdown`: logo depois de `shuttingDown = true`, acrescente `stopReporting()`.
5. `watchServer`: troque `if (await bootServer()) {\n        watchServer(server)` por:

```js
      if (await bootServer()) {
        // servidor novo = índice novo, sem o endereço do túnel
        if (tunnelLink) void reportTunnel(deps, port, tunnelLink)
        watchServer(server)
```

6. `watchTunnel`: logo depois de `log.write(\`túnel saiu sozinho (código ${code})\`)`, acrescente `setTunnelLink(null)`; troque `await announce(localUrl, { browser: false })` (as duas ocorrências) por `await announce(localUrl, {})`; e troque

```js
      if (link) {
        await announce(link, { browser: false, remote: true, proc: tunnel })
```

por

```js
      if (link) {
        setTunnelLink(link)
        await announce(link, { remote: true, proc: tunnel })
```

7. `serve`: troque o trecho de `const link = await openTunnel()` até `deps.print(MSG.closeHint)` por:

```js
    const link = await openTunnel()
    if (shuttingDown) return done
    if (link) {
      setTunnelLink(link)
      watchTunnel(tunnel)
    } else {
      deps.print(MSG.tunnelFailed)
    }
    await announce(link ?? localUrl, { remote: link !== null, proc: link ? tunnel : null })
    // A página local tem a lista de mesas com os links (que já usam o túnel).
    if (!shuttingDown) openBrowser(deps, `${localUrl}/`)
    deps.print(MSG.closeHint)
```

Em `apps/launcher/src/messages.mjs`, troque `linkTitle` por:

```js
  linkTitle: 'ENDEREÇO DO TÚNEL (os links de cada mesa estão na página que abriu no navegador):',
```

Em `README.md`, seção `## Rodar no Windows (pacote)`:
1. Troque o item 4 inteiro por:

```markdown
4. A janela verifica se há versão nova, sobe o servidor e o túnel e mostra o endereço do túnel
   `https://….trycloudflare.com` (já copiado). O navegador abre sozinho a página das suas mesas em
   `http://localhost:<porta>/`: cada mesa tem **Abrir como mestre**, **Copiar link de mestre** e
   **Copiar link de jogador** (os links já usam o túnel). Mande o link de jogador para o grupo.
```

2. Depois do parágrafo que começa com "O link muda a cada vez que a mesa é aberta" (não altere esse parágrafo), acrescente:

```markdown
A lista de mesas só aparece no seu PC: quem abre o endereço do túnel sem o link de uma mesa vê
"Peça o link da mesa ao mestre". Numa sessão nova (o endereço do túnel muda), o jogador entra com o
mesmo apelido ou clica no próprio nome em "Já jogou aqui?" e continua dono dos próprios desenhos e
tokens. O mestre, pelo link de mestre, volta a ser o mesmo mestre.
```

3. Na seção `## Opção A`, depois do parágrafo "O link `https://….trycloudflare.com` muda a cada execução...", acrescente:

```markdown
A lista de mesas fica em `http://localhost:8787/`. Sem o launcher, ela não sabe o endereço do túnel
e mostra "Túnel indisponível, só local"; para os links já saírem com o túnel, informe-o:
`curl -X POST http://localhost:8787/api/registry/tunnel -H "Content-Type: application/json" -d "{\"url\":\"https://….trycloudflare.com\"}"`.
```

- [ ] **Step 4: Run tests**

Run: `pnpm --filter ./apps/launcher test`
Expected: PASS.

- [ ] **Step 5: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add apps/launcher/src/registry.mjs apps/launcher/src/main.mjs apps/launcher/src/messages.mjs \
  apps/launcher/test/registry.test.mjs apps/launcher/test/main.test.mjs apps/launcher/test/readme.test.mjs README.md
git commit -m "feat(launcher): abre a lista local de mesas e informa o túnel ao servidor" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Excluir jogador

**Files:**
- Modify: `packages/shared/src/model.ts`, `packages/shared/src/protocol.ts`, `packages/shared/test/protocol.test.ts`
- Modify: `apps/worker/src/engine/engine.ts`, `apps/worker/src/table-do.ts`, `apps/worker/test/engine.test.ts`, `apps/worker/test/table-do.test.ts`
- Create: `apps/web/src/ui/removeMember.ts`, `apps/web/test/remove-member.test.ts`
- Modify: `apps/web/src/store/reducers.ts`, `apps/web/src/ui/memberMenuOptions.ts`, `apps/web/src/ui/MemberMenu.tsx`, `apps/web/src/ui/MembersPanel.tsx`, `apps/web/src/ui/TablePage.tsx`, `apps/web/test/member-menu.test.ts`, `apps/web/test/reducers-layers.test.ts`
- Modify: `e2e/table.spec.ts`

**Interfaces:**
- Consumes: `askChoice(options: ConfirmOptions): Promise<'confirm' | 'alternative' | 'cancel'>` com `ConfirmOptions.alternativeLabel?: string`, `alternativeDanger?: boolean` (plano de turnos, `apps/web/src/ui/confirm.ts`); `OpEffect` `object` com `echo`, `released`, `objectsRemoved`, `memberRemoved`; `engine.releaseAll(clientId)`.
- Produces:
  - shared: `ORPHAN_OWNER_ID = 'orphan'`; op `{ kind: 'memberRemove'; clientId: string; deleteItems: boolean }`; `ServerErrorReason` ganha `'removed'`.
  - web: `removeMemberChoice(nickname: string): ConfirmOptions`; `confirmRemoveMember(member: Pick<Member, 'clientId' | 'nickname'>, submit: (op: Op) => boolean): Promise<void>`; `memberMenuOptions(targetId, selfId, isGm, targetRole: Role)` → `{ dm, edit, clear, remove }`.

- [ ] **Step 1: Write the failing tests**

Em `packages/shared/test/protocol.test.ts`, na lista de ops válidas, troque `{ kind: 'memberRemove', clientId: '3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192' }` por `{ kind: 'memberRemove', clientId: '3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192', deleteItems: false }` e acrescente um teste no mesmo `describe`:

```ts
  it('memberRemove exige a escolha deleteItems', () => {
    expect(OpSchema.safeParse({ kind: 'memberRemove', clientId: 'a' }).success).toBe(false)
    expect(OpSchema.safeParse({ kind: 'memberRemove', clientId: 'a', deleteItems: true }).success).toBe(true)
  })
```

Em `apps/worker/test/engine.test.ts`:
1. Acrescente `ORPHAN_OWNER_ID` ao import de `@mesa/shared`.
2. Substitua o teste `'memberRemove: recusa online, remove offline, e quem volta reaparece'` por:

```ts
  it('memberRemove: só o mestre; nunca sobre mestre; online ou offline; quem volta é pessoa nova', () => {
    engine.join({ clientId: 'G', nickname: 'Mestre', role: 'gm' }, new Set())
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    const remove = (clientId: string): Op => ({ kind: 'memberRemove', clientId, deleteItems: false })
    expect(engine.applyOp('B', 'player', 'p1', remove('A'), new Set())).toMatchObject({ ok: false, reason: 'forbidden' })
    expect(engine.applyOp('G', 'gm', 'g0', remove('G'), new Set(['G']))).toMatchObject({ ok: false, reason: 'forbidden' })
    const r = engine.applyOp('G', 'gm', 'g1', remove('A'), new Set(['A', 'G']))
    expect(effects(r)).toEqual([{ kind: 'memberRemoved', clientId: 'A' }])
    expect(engine.snapshot('gm', new Set()).members.map((m) => m.clientId)).toEqual(['G'])
    expect(engine.applyOp('G', 'gm', 'g2', remove('A'), new Set())).toMatchObject({ ok: false, reason: 'not_found' })
  })

  it('memberRemove mantendo: itens dele sem autor e só do mestre; ele sai da lista de controle dos outros; trava solta', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    engine.applyOp('A', 'player', 'a1', create(token({ id: 'mine' })))
    engine.applyOp('G', 'gm', 'g1', create(token({ id: 'shared' })))
    engine.applyOp('G', 'gm', 'g2', update('shared', { control: { mode: 'list', clientIds: ['A', 'B'] } }))
    engine.applyOp('G', 'gm', 'g3', create(token({ id: 'onlyA' })))
    engine.applyOp('G', 'gm', 'g4', update('onlyA', { control: { mode: 'list', clientIds: ['A'] } }))
    expect(engine.grab('A', 'player', 'mine')).toBe(true)

    const r = engine.applyOp('G', 'gm', 'g5', { kind: 'memberRemove', clientId: 'A', deleteItems: false }, new Set(['G']))
    expect(store.getObject('mine')).toMatchObject({ ownerId: ORPHAN_OWNER_ID, control: { mode: 'gm', clientIds: [] } })
    expect(store.getObject('shared')?.control).toEqual({ mode: 'list', clientIds: ['B'] })
    expect(store.getObject('onlyA')?.control).toEqual({ mode: 'gm', clientIds: [] })
    expect(effects(r)).toContainEqual({ kind: 'released', objectId: 'mine', clientId: 'A' })
    expect(effects(r).filter((e) => e.kind === 'object').every((e) => e.kind === 'object' && e.echo)).toBe(true)
    // ninguém além do mestre mexe no que ficou órfão
    expect(engine.applyOp('A', 'player', 'a2', update('mine', { x: 5 }))).toMatchObject({ ok: false })
    expect(engine.applyOp('G', 'gm', 'g6', update('mine', { x: 5 }))).toMatchObject({ ok: true })
  })

  it('memberRemove apagando: objetos criados por ele saem de todas as camadas, com anotações', () => {
    engine.join({ clientId: 'A', nickname: 'Ana', role: 'player' }, new Set())
    engine.applyOp('A', 'player', 'a1', create(token({ id: 't1' })))
    engine.applyOp('A', 'player', 'a2', create(token({ id: 't2', layerId: 'drawings' })))
    engine.applyOp('G', 'gm', 'g1', create(token({ id: 'gmTok' })))
    engine.applyOp('G', 'gm', 'g2', { kind: 'noteSet', objectId: 't1', text: 'nota' })
    const r = engine.applyOp('G', 'gm', 'g3', { kind: 'memberRemove', clientId: 'A', deleteItems: true }, new Set(['G']))
    expect(store.getObject('t1')).toBeNull()
    expect(store.getObject('t2')).toBeNull()
    expect(store.getObject('gmTok')).not.toBeNull()
    expect(store.listNotes()).toEqual({})
    const removed = effects(r).find((e) => e.kind === 'objectsRemoved')
    expect(removed && removed.kind === 'objectsRemoved' && removed.objects.map((o) => o.id).sort()).toEqual(['t1', 't2'])
  })
```

(Se `engine.grab` tiver outra assinatura depois dos planos anteriores, use a atual; a ideia é o jogador A segurar `mine`.)

Em `apps/worker/test/table-do.test.ts`, substitua o teste `'memberRemove: online recusado; offline removido e avisado'` por:

```ts
  // Review Focus #5
  it('memberRemove: jogador online segurando um token é desconectado com "removed"; trava solta; token só do mestre para todos', async () => {
    const { tableId, gm, p, playerId } = await table()
    const other = await TestClient.connect(tableId)
    await other.hello('Bia')
    const tok = tokenObject()
    p.send(op('p1', { kind: 'create', object: tok }))
    await p.waitFor('ack')
    p.send({ t: 'grab', objectId: tok.id })
    await gm.waitFor('grabbed')
    gm.send(op('g1', { kind: 'memberRemove', clientId: playerId, deleteItems: false }))
    await gm.waitFor('ack', (m) => m.opId === 'g1')
    expect(await p.waitFor('error')).toEqual({ t: 'error', reason: 'removed' })
    expect(await other.waitFor('memberRemoved')).toEqual({ t: 'memberRemoved', clientId: playerId })
    expect(await other.waitFor('released')).toEqual({ t: 'released', objectId: tok.id, clientId: playerId })
    const upd = await gm.waitFor('op', (m) => m.op.kind === 'upsert' && m.op.object.id === tok.id)
    expect(upd.op.kind === 'upsert' && upd.op.object.control).toEqual({ mode: 'gm', clientIds: [] })
    const late = await TestClient.connect(tableId)
    const { welcome } = await late.hello('Caio')
    expect(welcome.snapshot.members.map((m) => m.clientId)).not.toContain(playerId)
  })

  it('memberRemove sobre o mestre é recusado', async () => {
    const { tableId, gmSecret, gm } = await table()
    const gm2 = await TestClient.connect(tableId)
    const { welcome } = await gm2.hello('Mestre', { gmSecret })
    gm.send(op('g1', { kind: 'memberRemove', clientId: welcome.self.clientId, deleteItems: true }))
    expect(await gm.waitFor('reject', (m) => m.opId === 'g1')).toMatchObject({ reason: 'forbidden' })
  })
```

Crie `apps/web/test/remove-member.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import type { Op } from '@mesa/shared'
import { confirmStore, settleConfirm } from '../src/ui/confirm'
import { confirmRemoveMember, removeMemberChoice } from '../src/ui/removeMember'

describe('excluir jogador', () => {
  it('texto e botões do aviso', () => {
    expect(removeMemberChoice('Ana')).toEqual({
      title: 'Excluir Ana da mesa?',
      message: 'Escolha o que acontece com os desenhos e tokens criados por Ana.',
      confirmLabel: 'Excluir e manter as coisas',
      alternativeLabel: 'Excluir e apagar as coisas dele',
      alternativeDanger: true,
    })
  })

  it('manter → deleteItems false; apagar → true; cancelar não envia', async () => {
    const sent: Op[] = []
    const submit = (op: Op) => (sent.push(op), true)
    const ana = { clientId: 'a', nickname: 'Ana' }
    let p = confirmRemoveMember(ana, submit)
    settleConfirm(true)
    await p
    p = confirmRemoveMember(ana, submit)
    settleConfirm('alternative')
    await p
    p = confirmRemoveMember(ana, submit)
    settleConfirm(false)
    await p
    expect(sent).toEqual([
      { kind: 'memberRemove', clientId: 'a', deleteItems: false },
      { kind: 'memberRemove', clientId: 'a', deleteItems: true },
    ])
    expect(confirmStore.getState().request).toBeNull()
  })
})
```

Em `apps/web/test/member-menu.test.ts`, troque o corpo do teste por:

```ts
    expect(memberMenuOptions('b', 'a', false, 'player')).toEqual({ dm: true, edit: false, clear: false, remove: false })
    expect(memberMenuOptions('a', 'a', false, 'player')).toEqual({ dm: false, edit: false, clear: false, remove: false })
    expect(memberMenuOptions('b', 'g', true, 'player')).toEqual({ dm: true, edit: true, clear: true, remove: true })
    expect(memberMenuOptions('g', 'g', true, 'gm')).toEqual({ dm: false, edit: true, clear: true, remove: false })
    expect(memberMenuOptions('g2', 'g', true, 'gm')).toEqual({ dm: true, edit: true, clear: true, remove: false })
```

Em `apps/web/test/reducers-layers.test.ts`: nas chamadas `{ kind: 'memberRemove', clientId: 'p1' }` acrescente `deleteItems: false`, e no teste `'memberRemove recusado devolve o membro e explica'` troque o texto esperado `'Não dá para remover quem está online'` por `'O mestre não pode ser excluído'`.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/worker test test/engine.test.ts test/table-do.test.ts && pnpm --filter @mesa/web test`
Expected: FAIL (schema sem `deleteItems`; engine recusa online; módulos web inexistentes).

- [ ] **Step 3: Implement shared**

Em `packages/shared/src/model.ts`, logo antes de `export function canControl`:

```ts
/** Autor dos itens de um jogador excluído com "manter as coisas" (nunca é um clientId válido de hello). */
export const ORPHAN_OWNER_ID = 'orphan'
```

Em `packages/shared/src/protocol.ts`, troque a op `memberRemove` do `OpSchema` por:

```ts
  /** Excluir jogador (só o mestre, nunca sobre um mestre): apaga ou mantém (órfãos, só do mestre) os itens dele. */
  z.object({ kind: z.literal('memberRemove'), clientId: z.string().min(1).max(64), deleteItems: z.boolean() }),
```

e `ServerErrorReason` vira:

```ts
export type ServerErrorReason = 'table_not_found' | 'auth' | 'table_deleted' | 'nickname_taken' | 'removed'
```

- [ ] **Step 4: Implement the engine and the TableDO**

Em `apps/worker/src/engine/engine.ts`:
1. Ao import de `@mesa/shared` acrescente `ORPHAN_OWNER_ID` e `type Control`.
2. No `switch` de ops do mestre, troque `case 'memberRemove': return this.memberRemove(op.clientId, online)` por `case 'memberRemove': return this.memberRemove(op.clientId, op.deleteItems)`.
3. Substitua o método `memberRemove` por:

```ts
  /**
   * Excluir jogador (online ou offline). Apagar: some tudo o que ele criou, em todas as camadas.
   * Manter: o que ele criou fica sem autor e só do mestre; nos itens de outros, ele sai da lista de controle.
   */
  private memberRemove(clientId: string, deleteItems: boolean): OpResult {
    const member = this.store.getMember(clientId)
    if (!member) return reject('not_found', null)
    if (member.role === 'gm') return reject('forbidden', null)
    this.store.deleteMember(clientId)
    const effects: OpEffect[] = [{ kind: 'memberRemoved', clientId }]
    for (const objectId of this.releaseAll(clientId)) effects.push({ kind: 'released', objectId, clientId })
    const removed: TableObject[] = []
    for (const o of this.store.listObjects()) {
      const owned = o.ownerId === clientId
      if (owned && deleteItems) {
        this.store.deleteObject(o.id)
        this.store.deleteNote(o.id)
        this.locks.delete(o.id)
        removed.push(o)
        continue
      }
      const listed = o.control.clientIds.includes(clientId)
      if (!owned && !listed) continue
      const clientIds = o.control.clientIds.filter((id) => id !== clientId)
      const control: Control =
        owned || (o.control.mode === 'list' && clientIds.length === 0) ? { mode: 'gm', clientIds: [] } : { ...o.control, clientIds }
      const after = { ...o, ...(owned ? { ownerId: ORPHAN_OWNER_ID } : {}), control, version: o.version + 1 } as TableObject
      this.store.putObject(after)
      // `echo`: o mestre que pediu também recebe (ele não aplicou isto de forma otimista).
      effects.push({ kind: 'object', before: o, after, echo: true })
    }
    if (removed.length > 0) effects.push({ kind: 'objectsRemoved', objects: removed })
    return done(0, ...effects)
  }
```

(Se o parâmetro `online` de `execute` ficar sem uso por causa disso, mantenha-o: outras ops ainda o usam.)

Em `apps/worker/src/table-do.ts`, em `broadcastEffect`, troque o `case 'memberRemoved':` por:

```ts
      case 'memberRemoved':
        this.kick(effect.clientId)
        this.broadcast(author.sessionId, () => ({ t: 'memberRemoved', clientId: effect.clientId }))
        return
```

e acrescente o método privado (perto de `onDisconnect`):

```ts
  /** Jogador excluído: avisa e fecha todas as conexões dele (o close não mexe em mais nada). */
  private kick(clientId: string): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (this.attachment(ws)?.clientId !== clientId) continue
      this.send(ws, { t: 'error', reason: 'removed' })
      ws.serializeAttachment(null)
      try {
        ws.close(4403, 'removed')
      } catch {
        // já fechado
      }
    }
  }
```

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/worker test`
Expected: PASS.

- [ ] **Step 5: Implement the web**

Crie `apps/web/src/ui/removeMember.ts`:

```ts
import type { Member, Op } from '@mesa/shared'
import { askChoice, type ConfirmOptions } from './confirm'

export function removeMemberChoice(nickname: string): ConfirmOptions {
  return {
    title: `Excluir ${nickname} da mesa?`,
    message: `Escolha o que acontece com os desenhos e tokens criados por ${nickname}.`,
    confirmLabel: 'Excluir e manter as coisas',
    alternativeLabel: 'Excluir e apagar as coisas dele',
    alternativeDanger: true,
  }
}

/** Aviso do app com três botões; Cancelar não envia nada. */
export async function confirmRemoveMember(member: Pick<Member, 'clientId' | 'nickname'>, submit: (op: Op) => boolean): Promise<void> {
  const answer = await askChoice(removeMemberChoice(member.nickname))
  if (answer === 'cancel') return
  submit({ kind: 'memberRemove', clientId: member.clientId, deleteItems: answer === 'alternative' })
}
```

Em `apps/web/src/ui/memberMenuOptions.ts`, troque `memberMenuOptions` (e o comentário acima) por:

```ts
/**
 * "Conversa privada" não aparece para si mesmo; "Editar apelido e cor" e "Apagar desenhos de…" são só
 * do mestre (inclusive sobre si mesmo); "Excluir jogador" é só do mestre e nunca sobre um mestre.
 */
export function memberMenuOptions(
  targetId: string,
  selfId: string | undefined,
  isGm: boolean,
  targetRole: Role,
): { dm: boolean; edit: boolean; clear: boolean; remove: boolean } {
  return { dm: targetId !== selfId, edit: isGm, clear: isGm, remove: isGm && targetRole !== 'gm' }
}
```

e troque o import do topo por `import type { Member, MemberPatch, Role } from '@mesa/shared'`.

Em `apps/web/src/ui/MemberMenu.tsx`:
1. Imports: acrescente `UserX` ao import de `lucide-react` e `import { confirmRemoveMember } from './removeMember'`.
2. Troque `const options = memberMenuOptions(member.clientId, selfId, isGm)` por `const options = memberMenuOptions(member.clientId, selfId, isGm, member.role)`.
3. Dentro do `<form>` de edição (o de `options.edit && editing`), depois do botão `Salvar`:

```tsx
          {options.remove && (
            <button
              type="button"
              className="danger-solid"
              onClick={() => {
                // Fecha o menu antes do aviso (o clique no aviso não pode contar como "fora" do menu).
                onClose()
                void confirmRemoveMember(member, actions.submit)
              }}
            >
              <UserX size={16} aria-hidden /> Excluir jogador
            </button>
          )}
```

Em `apps/web/src/ui/MembersPanel.tsx`:
1. Import: `import { confirmRemoveMember } from './removeMember'`.
2. Troque `const options = memberMenuOptions(m.clientId, selfId, isGm)` por `const options = memberMenuOptions(m.clientId, selfId, isGm, m.role)`.
3. Troque a condição do X `{isGm && !m.online && m.clientId !== selfId && (` por `{options.remove && !m.online && (` e o `onClick` dele por `onClick={() => void confirmRemoveMember(m, actions.submit)}`.

Em `apps/web/src/store/reducers.ts`, na função de texto de rejeição, troque `if (op.kind === 'memberRemove') return 'Não dá para remover quem está online'` por `if (op.kind === 'memberRemove') return 'O mestre não pode ser excluído'`.

Em `apps/web/src/ui/TablePage.tsx`, em `FatalMessage`, depois da linha do `nickname_taken`:

```tsx
  if (reason === 'removed') {
    return (
      <div className="fullscreen-msg">
        <div>
          <p>Você foi removido da mesa</p>
        </div>
      </div>
    )
  }
```

Run: `pnpm --filter @mesa/web test`
Expected: PASS.

- [ ] **Step 6: E2E**

Em `e2e/table.spec.ts`:
1. No teste `'mestre remove da lista um membro offline'`, troque `await remove.click()` por:

```ts
  await remove.click()
  const dialog = gm.getByRole('alertdialog')
  await expect(dialog).toContainText('Excluir Ana da mesa?')
  await dialog.getByRole('button', { name: 'Excluir e manter as coisas' }).click()
```

e a linha `await expect(gm.getByRole('button', { name: 'Remover Ana da lista' })).toHaveCount(0) // online: sem X` continua (o X só aparece para offline).
2. No fim do arquivo:

```ts
// ---------------------------------------------------------------- excluir jogador

async function removeFromMenu(gm: Page, name: string, choice: 'Excluir e manter as coisas' | 'Excluir e apagar as coisas dele') {
  const menu = await memberMenu(gm, name)
  await menu.getByRole('button', { name: 'Editar apelido e cor' }).click()
  await menu.getByRole('button', { name: 'Excluir jogador' }).click()
  const dialog = gm.getByRole('alertdialog')
  await expect(dialog).toContainText(`Excluir ${name} da mesa?`)
  await dialog.getByRole('button', { name: choice }).click()
}

test('excluir jogador online mantendo as coisas: ele é desconectado; o token fica só do mestre', async ({ browser, page }) => {
  const t = await newTable(page)
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  const player = await open(browser, playerPath(t), 'Ana')
  await uploadToken(player)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await removeFromMenu(gm, 'Ana', 'Excluir e manter as coisas')
  await expect(player.getByText('Você foi removido da mesa')).toBeVisible()
  await expect(memberRow(gm, 'Ana')).toHaveCount(0)
  await expect.poll(async () => (await objects(gm))[0].control).toEqual({ mode: 'gm', clientIds: [] })

  // quem volta com o mesmo apelido é pessoa nova e não move o token; o mestre move
  const back = await open(browser, playerPath(t), 'Ana')
  const [token] = await objects(back)
  await dragObject(back, token, 100, 50)
  await back.waitForTimeout(500)
  expect(Math.round((await objects(gm))[0].x)).toBe(Math.round(token.x))
  await dragObject(gm, token, 100, 50)
  await expect.poll(async () => Math.round((await objects(back))[0].x)).toBe(Math.round(token.x + 100))
})

test('excluir jogador apagando as coisas: o token dele some para todos', async ({ browser, page }) => {
  const t = await newTable(page)
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  const player = await open(browser, playerPath(t), 'Ana')
  await uploadToken(player)
  await expect.poll(async () => (await objects(gm)).length).toBe(1)
  await removeFromMenu(gm, 'Ana', 'Excluir e apagar as coisas dele')
  await expect.poll(async () => (await objects(gm)).length).toBe(0)
})
```

(`memberRow`, `memberMenu`, `dragObject`, `uploadToken` já existem no arquivo; se `memberMenu` exigir que o membro esteja visível no painel, ele está, pois a Ana está online.)

- [ ] **Step 7: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add packages/shared apps/worker/src apps/worker/test apps/web/src apps/web/test e2e/table.spec.ts
git commit -m "feat(membros): mestre exclui jogador online ou offline, apagando ou mantendo as coisas dele" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Chave de jogador obrigatória para entrar

**Files:**
- Modify: `packages/shared/src/protocol.ts`, `packages/shared/test/protocol.test.ts`
- Modify: `apps/worker/src/engine/store.ts`, `sql-store.ts`, `memory-store.ts`, `apps/worker/test/store-contract.ts`
- Modify: `apps/worker/src/table-do.ts`, `apps/worker/src/index.ts`
- Modify: `apps/worker/test/helpers.ts`, `apps/worker/test/table-do.test.ts`, `apps/worker/test/registry.test.ts`
- Modify: `apps/web/src/lib/identity.ts`, `apps/web/src/lib/api.ts`, `apps/web/src/store/tableStore.ts`, `apps/web/src/ui/TablePage.tsx`
- Create: `apps/web/test/link-secrets.test.ts`
- Modify: `e2e/table.spec.ts`

**Interfaces:**
- Consumes: `RegistryDO.register({..., playerKey })` (Task 1, até aqui sempre `null`); `fetchKnownPlayers` (Task 5).
- Produces:
  - shared: hello `playerKey?: string`; `ServerErrorReason` ganha `'link_expired'`.
  - worker: `TableStore.getPlayerKeyHash(): string | null`, `setPlayerKeyHash(hash: string): void`; `/init` aceita `playerKeyHash`; `POST /api/tables` → `{ tableId, gmSecret, playerKey }`; `/members` exige `X-Mesa-Key` (403).
  - tests: `createTable()` devolve `playerKey`; `playerKeyOf(tableId: string): string | undefined`; `TestClient.hello` manda a chave da mesa automaticamente (`opts.playerKey`: string para outra, `null` para nenhuma).
  - web: `readPlayerKey(tableId: string): string | undefined`; `fetchKnownPlayers(tableId: string, playerKey: string | undefined): Promise<KnownPlayer[] | 'expired'>`; `LINK_EXPIRED = 'Este link expirou. Peça o link novo ao mestre'` em `TablePage.tsx`.

- [ ] **Step 1: Update the worker test helpers (base for the new rule)**

Em `apps/worker/test/helpers.ts`:
1. Depois de `const BASE = LOCAL`:

```ts
const playerKeys = new Map<string, string>()
/** Chave de jogador da mesa criada por createTable (para mandar hello cru nos testes). */
export const playerKeyOf = (tableId: string) => playerKeys.get(tableId)
```

2. `createTable` passa a ser:

```ts
export async function createTable(name = 'Teste'): Promise<{ tableId: string; gmSecret: string; playerKey: string }> {
  const res = await SELF.fetch(`${BASE}/api/tables`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  expect(res.status).toBe(201)
  const body = await res.json<{ tableId: string; gmSecret: string; playerKey: string }>()
  playerKeys.set(body.tableId, body.playerKey)
  return body
}
```

3. Em `TestClient`: o construtor passa a ser `private constructor(private ws: WebSocket, private tableId: string)`; em `connect`, `return new TestClient(ws, tableId)`; e `hello` vira:

```ts
  async hello(
    nickname: string,
    opts: { clientId?: string; gmSecret?: string; clientSecret?: string; v?: number | null; playerKey?: string | null } = {},
  ) {
    const clientId = opts.clientId ?? crypto.randomUUID()
    const playerKey = opts.playerKey === undefined ? playerKeys.get(this.tableId) : (opts.playerKey ?? undefined)
    this.send({
      t: 'hello',
      clientId,
      nickname,
      ...(opts.v === null ? {} : { v: opts.v ?? 2 }),
      ...(opts.gmSecret ? { gmSecret: opts.gmSecret } : {}),
      ...(opts.clientSecret ? { clientSecret: opts.clientSecret } : {}),
      ...(playerKey ? { playerKey } : {}),
    })
    const welcome = await this.waitFor('welcome')
    return { clientId, welcome }
  }
```

Em `apps/worker/test/table-do.test.ts`: acrescente `playerKeyOf` ao import de helpers e, em **todo** `send({ t: 'hello', ... })` cru (objeto literal) feito numa mesa criada por `createTable`, acrescente `playerKey: playerKeyOf(tableId)` (ex.: `noSecret.send({ t: 'hello', clientId, nickname: 'Falsa', playerKey: playerKeyOf(tableId) })`). Liste-os com `grep -n "t: 'hello'" apps/worker/test/table-do.test.ts` e confira que só ficam sem chave: o `JSON.stringify({ t: 'hello', ... nickname: '   ' })` (inválido de propósito) e os testes novos abaixo.

- [ ] **Step 2: Write the failing tests**

Em `apps/worker/test/store-contract.ts`, no fim de `checkStoreContract`:

```ts
  expect(store.getPlayerKeyHash()).toBeNull()
  store.setPlayerKeyHash('k1')
  store.setPlayerKeyHash('k2')
  expect(store.getPlayerKeyHash()).toBe('k2')
```

Em `apps/worker/test/table-do.test.ts`, no fim:

```ts
describe('TableDO — chave de jogador', () => {
  it('sem chave ou com chave errada → link_expired; com a chave entra; o mestre entra só com o segredo', async () => {
    const { tableId, gmSecret } = await createTable()
    for (const key of [null, 'chave-errada']) {
      const c = await TestClient.connect(tableId)
      c.send({ t: 'hello', v: 2, clientId: crypto.randomUUID(), nickname: 'Ana', ...(key ? { playerKey: key } : {}) })
      expect(await c.waitFor('error')).toEqual({ t: 'error', reason: 'link_expired' })
    }
    const ok = await TestClient.connect(tableId)
    expect((await ok.hello('Ana')).welcome.self.role).toBe('player')
    const gm = await TestClient.connect(tableId)
    expect((await gm.hello('Mestre', { gmSecret, playerKey: null })).welcome.self.role).toBe('gm')
  })

  it('quem volta com o segredo guardado também precisa da chave', async () => {
    const { tableId } = await createTable()
    const a = await TestClient.connect(tableId)
    const { clientId, welcome } = await a.hello('Ana')
    const tab2 = await TestClient.connect(tableId)
    tab2.send({ t: 'hello', v: 2, clientId, nickname: 'Ana', clientSecret: welcome.clientSecret })
    expect(await tab2.waitFor('error')).toEqual({ t: 'error', reason: 'link_expired' })
  })

  it('/members exige X-Mesa-Key: sem ela 403, com ela a lista', async () => {
    const { tableId, playerKey } = await createTable()
    expect((await SELF.fetch(`${LOCAL}/api/tables/${tableId}/members`)).status).toBe(403)
    const res = await SELF.fetch(`${LOCAL}/api/tables/${tableId}/members`, { headers: { 'X-Mesa-Key': playerKey } })
    expect(await res.json()).toEqual({ players: [] })
  })
})
```

Em `apps/worker/test/registry.test.ts`, no teste `'criar registra a mesa; ...'`, troque o `toMatchObject` por:

```ts
    expect(tables[ia]).toMatchObject({ name: 'Primeira', players: 0, gmSecret: a.gmSecret, playerKey: a.playerKey })
```

Crie `apps/web/test/link-secrets.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.resetModules()
})

function stub(hash: string) {
  const mem = new Map<string, string>()
  const replaced: string[] = []
  vi.stubGlobal('window', { location: { hash, pathname: '/t/T', search: '?debug=1' } })
  vi.stubGlobal('history', { replaceState: (_s: unknown, _t: string, url: string) => replaced.push(url) })
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  })
  return { mem, replaced }
}

describe('segredos do link', () => {
  it('#j= é guardado por mesa e o fragmento sai da barra; segunda leitura vem do armazenamento', async () => {
    const { mem, replaced } = stub('#j=chave1')
    const { readPlayerKey, readGmSecret } = await import('../src/lib/identity')
    expect(readPlayerKey('T')).toBe('chave1')
    expect(readGmSecret('T')).toBeUndefined()
    expect(mem.get('mesa:key:T')).toBe('chave1')
    expect(replaced).toEqual(['/t/T?debug=1'])
    expect(readPlayerKey('T')).toBe('chave1')
  })

  it('#gm= continua funcionando depois de ler a chave (uma passada só lê os dois)', async () => {
    stub('#gm=segredo')
    const { readPlayerKey, readGmSecret } = await import('../src/lib/identity')
    expect(readPlayerKey('T')).toBeUndefined()
    expect(readGmSecret('T')).toBe('segredo')
  })
})
```

- [ ] **Step 3: Run to verify they fail**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/web test test/link-secrets.test.ts`
Expected: FAIL (sem `getPlayerKeyHash`, hello sem chave entra, `/members` → 200, `readPlayerKey` inexistente).

- [ ] **Step 4: Implement shared and worker**

Em `packages/shared/src/protocol.ts`: no `HelloSchema`, depois de `clientSecret`:

```ts
  /** Chave do link de jogador (`#j=`); quem tem o segredo de mestre não precisa. */
  playerKey: z.string().max(128).optional(),
```

e `ServerErrorReason` vira `'table_not_found' | 'auth' | 'table_deleted' | 'nickname_taken' | 'removed' | 'link_expired'`. Em `packages/shared/test/protocol.test.ts`, acrescente:

```ts
  it('hello aceita playerKey opcional', () => {
    const base = { t: 'hello', clientId: '3f1c2b9e-8a4d-4c1e-9b7a-2d5e6f708192', nickname: 'Ana', v: 2 }
    expect(ClientMessageSchema.safeParse({ ...base, playerKey: 'k' }).success).toBe(true)
    expect(ClientMessageSchema.safeParse({ ...base, playerKey: 'k'.repeat(129) }).success).toBe(false)
  })
```

(importe `ClientMessageSchema` se o arquivo ainda não importa.)

Em `apps/worker/src/engine/store.ts`, na interface:

```ts
  /** Hash da chave do link de jogador; null = mesa sem chave (antiga): entrada livre. */
  getPlayerKeyHash(): string | null
  setPlayerKeyHash(hash: string): void
```

Em `sql-store.ts`: no construtor, `sql.exec('CREATE TABLE IF NOT EXISTS player_key (id INTEGER PRIMARY KEY CHECK (id = 1), hash TEXT NOT NULL)')`, e os métodos:

```ts
  getPlayerKeyHash(): string | null {
    return this.sql.exec<{ hash: string }>('SELECT hash FROM player_key WHERE id = 1').toArray()[0]?.hash ?? null
  }

  setPlayerKeyHash(hash: string): void {
    this.sql.exec('INSERT OR REPLACE INTO player_key (id, hash) VALUES (1, ?)', hash)
  }
```

Em `memory-store.ts`: campo `private playerKeyHash: string | null = null` e:

```ts
  getPlayerKeyHash(): string | null {
    return this.playerKeyHash
  }

  setPlayerKeyHash(hash: string): void {
    this.playerKeyHash = hash
  }
```

Em `apps/worker/src/table-do.ts`:
1. Em `fetch`, no bloco `/init`, troque o corpo por:

```ts
      if (this.store.getMeta()) return new Response('exists', { status: 409 })
      const body = await request.json<{ id: string; name: string; gmSecretHash: string; playerKeyHash?: string }>()
      this.store.initTable({ id: body.id, name: body.name, gmSecretHash: body.gmSecretHash, createdAt: Date.now() }, DEFAULT_LAYERS)
      if (body.playerKeyHash) this.store.setPlayerKeyHash(body.playerKeyHash)
      return new Response(null, { status: 201 })
```

2. Troque o bloco `/members` (Task 4) por:

```ts
    if (url.pathname === '/members' && request.method === 'GET') {
      if (!this.store.getMeta()) return Response.json({ players: [] })
      const keyHash = this.store.getPlayerKeyHash()
      const key = request.headers.get('x-mesa-key')
      if (keyHash && !(key && safeEqual(await sha256Hex(key), keyHash))) return new Response('link expirado', { status: 403 })
      return Response.json({ players: this.engine.knownPlayers(this.onlineClientIds()) })
    }
```

3. Em `onHello`, junto dos awaits do começo (depois de `const providedHash = ...`):

```ts
    const providedKeyHash = msg.playerKey ? await sha256Hex(msg.playerKey) : null
```

e logo depois de `const online = this.onlineClientIds()`:

```ts
    // Link de jogador: quem não tem o segredo de mestre precisa da chave atual (mesa antiga, sem chave: livre).
    const keyHash = this.store.getPlayerKeyHash()
    if (role !== 'gm' && keyHash && !(providedKeyHash && safeEqual(providedKeyHash, keyHash))) {
      this.send(ws, { t: 'error', reason: 'link_expired' })
      ws.close(4403, 'link_expired')
      return
    }
```

Em `apps/worker/src/index.ts`, em `createTable`, dentro do laço:

```ts
    const tableId = randomId(10)
    const gmSecret = randomSecret()
    const playerKey = randomSecret()
    const stub = env.TABLES.get(env.TABLES.idFromName(tableId))
    const res = await stub.fetch('https://table/init', {
      method: 'POST',
      body: JSON.stringify({ id: tableId, name, gmSecretHash: await sha256Hex(gmSecret), playerKeyHash: await sha256Hex(playerKey) }),
    })
    if (res.status === 201) {
      await registryStub(env).register({ id: tableId, name, gmSecret, playerKey })
      return json({ tableId, gmSecret, playerKey }, 201)
    }
```

Run: `pnpm --filter @mesa/shared test && pnpm --filter @mesa/worker test`
Expected: PASS (o teste da Task 3 com mesa antiga criada por `/init` sem chave continua entrando).

- [ ] **Step 5: Implement the web**

Em `apps/web/src/lib/identity.ts`, troque a função `readGmSecret` (e o comentário `// fallback em memória quando o localStorage está bloqueado (o hash já foi removido)` com o `memoryGm` logo acima dela) por:

```ts
// fallback em memória quando o localStorage está bloqueado (o fragmento já foi removido)
const memoryGm = new Map<string, string>()
const keyKey = (tableId: string) => `mesa:key:${tableId}`
const memoryKeys = new Map<string, string>()

/** Lê `#gm=` e `#j=` numa passada, guarda por mesa e tira o fragmento da barra (histórico, prints, compartilhamento). */
function captureLinkSecrets(tableId: string): void {
  const hash = typeof window === 'undefined' ? '' : (window.location.hash ?? '')
  const gm = /(?:^#|&)gm=([^&]+)/.exec(hash)?.[1]
  const key = /(?:^#|&)j=([^&]+)/.exec(hash)?.[1]
  if (!gm && !key) return
  if (gm) {
    rememberGmSecret(tableId, gm)
    memoryGm.set(tableId, gm)
  }
  if (key) {
    memoryKeys.set(tableId, key)
    safeSet(keyKey(tableId), key)
  }
  try {
    history.replaceState(null, '', window.location.pathname + window.location.search)
  } catch {
    // ignora
  }
}

export function readGmSecret(tableId: string): string | undefined {
  captureLinkSecrets(tableId)
  return memoryGm.get(tableId) ?? safeGet(gmKey(tableId)) ?? undefined
}

/** Chave do link de jogador desta mesa (do link aberto agora ou guardada de antes). */
export function readPlayerKey(tableId: string): string | undefined {
  captureLinkSecrets(tableId)
  return memoryKeys.get(tableId) ?? safeGet(keyKey(tableId)) ?? undefined
}
```

Em `apps/web/src/lib/api.ts`, troque `fetchKnownPlayers` por:

```ts
/** "Já jogou aqui?": jogadores fora da mesa; 'expired' = chave de jogador inválida; outra falha vira lista vazia. */
export async function fetchKnownPlayers(tableId: string, playerKey: string | undefined): Promise<KnownPlayer[] | 'expired'> {
  try {
    const res = await fetch(`/api/tables/${tableId}/members`, { headers: playerKey ? { 'X-Mesa-Key': playerKey } : {} })
    if (res.status === 403) return 'expired'
    if (!res.ok) return []
    const body = (await res.json()) as { players?: unknown }
    return Array.isArray(body.players) ? (body.players as KnownPlayer[]) : []
  } catch {
    return []
  }
}
```

Em `apps/web/src/store/tableStore.ts`: acrescente `readPlayerKey` ao import de identity e, no objeto devolvido por `hello: () => { ... }`, depois de `...(sentSecret ? { clientSecret: sentSecret } : {}),`:

```ts
              ...(playerKey ? { playerKey } : {}),
```

com `const playerKey = readPlayerKey(tableId)` logo depois de `const gmSecret = readGmSecret(tableId)`.

Em `apps/web/src/ui/TablePage.tsx`:
1. Acrescente `readGmSecret, readPlayerKey` ao import de `../lib/identity`.
2. Depois das constantes do topo: `export const LINK_EXPIRED = 'Este link expirou. Peça o link novo ao mestre'`.
3. Em `TablePage`, acrescente o estado `const [expired, setExpired] = useState(false)` e troque o efeito da lista conhecida por:

```tsx
  useEffect(() => {
    if (nickname) return
    // Com o segredo de mestre não há lista (o mestre volta sozinho) e quem decide é o hello.
    if (readGmSecret(tableId)) return
    let alive = true
    void fetchKnownPlayers(tableId, readPlayerKey(tableId)).then((players) => {
      if (!alive) return
      if (players === 'expired') setExpired(true)
      else setKnown(players)
    })
    return () => {
      alive = false
    }
  }, [tableId, nickname])
```

4. No `return` de `TablePage`, troque `{nickname ? (` por `{expired ? (\n        <ExpiredNotice />\n      ) : nickname ? (`.
5. Em `FatalMessage`, depois da linha do `removed`: `if (reason === 'link_expired') return <ExpiredNotice />`.
6. No fim do arquivo:

```tsx
function ExpiredNotice() {
  return (
    <div className="fullscreen-msg">
      <div>
        <p>{LINK_EXPIRED}</p>
      </div>
    </div>
  )
}
```

Run: `pnpm --filter @mesa/web test`
Expected: PASS.

- [ ] **Step 6: Update the E2E**

Em `e2e/table.spec.ts`, troque o tipo de retorno de `newTable` para `Promise<{ tableId: string; gmSecret: string; playerKey: string }>` e faça os caminhos de jogador levarem a chave:

```bash
perl -0pi -e 's/const \{ tableId, gmSecret \} = await newTable\(page\)/const { tableId, gmSecret, playerKey } = await newTable(page)/g; s/const \{ tableId \} = await newTable\(page\)/const { tableId, playerKey } = await newTable(page)/g; s{`/t/\$\{tableId\}\?debug=1`}{`/t/\${tableId}?debug=1#j=\${playerKey}`}g' e2e/table.spec.ts
grep -n '?debug=1`' e2e/table.spec.ts
```

Expected: o `grep` não acha nada (os caminhos de mestre, `#gm=`, não mudam; os testes novos já usam `playerPath(t)`). Se algum teste de outro plano montar o caminho de jogador de outro jeito, acrescente `#j=${playerKey}` nele também. Se o `perl` deixar algum `playerKey` sem uso num teste que só abre o mestre, troque de volta para `const { tableId, gmSecret } = ...` nesse teste.

Acrescente no fim:

```ts
test('link de jogador sem a chave: "Este link expirou. Peça o link novo ao mestre" antes de pedir o apelido', async ({ browser, page }) => {
  const t = await newTable(page)
  const stray = await (await browser.newContext()).newPage()
  await stray.goto(`/t/${t.tableId}`)
  await expect(stray.getByText('Este link expirou. Peça o link novo ao mestre')).toBeVisible()
  await expect(stray.getByLabel('Seu apelido')).toHaveCount(0)
})
```

- [ ] **Step 7: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add packages/shared apps/worker/src apps/worker/test apps/web/src apps/web/test/link-secrets.test.ts e2e/table.spec.ts
git commit -m "feat(links): link de jogador com chave; sem a chave atual, link expirado" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: Gerar novos links (expirar os antigos)

**Files:**
- Modify: `apps/worker/src/engine/store.ts`, `sql-store.ts`, `memory-store.ts`, `apps/worker/test/store-contract.ts`
- Modify: `apps/worker/src/table-do.ts`, `apps/worker/src/registry-do.ts`, `apps/worker/src/registry-api.ts`, `apps/worker/test/registry.test.ts`
- Modify: `apps/web/src/lib/registry.ts`, `apps/web/src/ui/HomeView.tsx`, `apps/web/src/ui/HomePage.tsx`, `apps/web/test/home.test.tsx`
- Modify: `e2e/table.spec.ts`, `README.md`

**Interfaces:**
- Consumes (Tasks 1, 6, 9): `registryStub`, `handleRegistry`, `HomeActions`, `TableCard`, `setPlayerKeyHash`, `link_expired`, `randomSecret`, `sha256Hex`.
- Produces:
  - worker: `TableStore.setGmSecretHash(hash: string): void`; RPC `TableDO.setPlayerKeyHash(hash: string): boolean`, `TableDO.setGmSecretHash(hash: string): boolean`; `RegistryDO.setPlayerKey(id, key): boolean`, `RegistryDO.setGmSecret(id, secret): boolean`; rotas `POST /api/registry/tables/:id/player-link` e `/gm-link` → 204.
  - web: `type LinkKind = 'player' | 'gm'`; `rotateLink(id: string, kind: LinkKind): Promise<boolean>`; `rotateConfirmOptions(kind: LinkKind): ConfirmOptions`; `HomeActions.rotate(table: RegistryTable, kind: LinkKind): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

Em `apps/worker/test/store-contract.ts`, no fim de `checkStoreContract`:

```ts
  store.setGmSecretHash('novo')
  expect(store.getMeta()?.gmSecretHash).toBe('novo')
```

Em `apps/worker/test/registry.test.ts`, no fim:

```ts
const rotate = (id: string, kind: 'player-link' | 'gm-link', headers: Record<string, string> = {}) =>
  SELF.fetch(`${LOCAL}/api/registry/tables/${id}/${kind}`, { method: 'POST', headers })

describe('gerar novos links', () => {
  it('link de jogador novo: quem está conectado continua; a chave antiga expira (inclusive com segredo guardado); a nova entra', async () => {
    const { tableId, playerKey: oldKey } = await createTable('Links')
    const p = await TestClient.connect(tableId)
    const { clientId, welcome } = await p.hello('Ana')
    expect((await rotate(tableId, 'player-link')).status).toBe(204)
    const newKey = (await registryView()).tables.find((t) => t.id === tableId)!.playerKey!
    expect(newKey).not.toBe(oldKey)

    p.send({ t: 'op', opId: 'still', op: { kind: 'create', object: tokenObject() } })
    expect(await p.waitFor('ack')).toMatchObject({ opId: 'still' })

    const stale = await TestClient.connect(tableId)
    stale.send({ t: 'hello', v: 2, clientId: crypto.randomUUID(), nickname: 'Bia', playerKey: oldKey })
    expect(await stale.waitFor('error')).toEqual({ t: 'error', reason: 'link_expired' })
    const back = await TestClient.connect(tableId)
    back.send({ t: 'hello', v: 2, clientId, nickname: 'Ana', clientSecret: welcome.clientSecret, playerKey: oldKey })
    expect(await back.waitFor('error')).toEqual({ t: 'error', reason: 'link_expired' })
    const fresh = await TestClient.connect(tableId)
    expect((await fresh.hello('Bia', { playerKey: newKey })).welcome.self.role).toBe('player')
  })

  it('link de mestre novo: o segredo antigo deixa de dar mestre; o novo dá e volta a ser o mesmo membro', async () => {
    const { tableId, gmSecret: oldSecret } = await createTable('Mestre novo')
    const gm = await TestClient.connect(tableId)
    const { welcome: w1 } = await gm.hello('Mestre', { gmSecret: oldSecret })
    expect((await rotate(tableId, 'gm-link')).status).toBe(204)
    const newSecret = (await registryView()).tables.find((t) => t.id === tableId)!.gmSecret
    expect(newSecret).not.toBe(oldSecret)

    const stale = await TestClient.connect(tableId)
    stale.send({ t: 'hello', v: 2, clientId: crypto.randomUUID(), nickname: 'X', gmSecret: oldSecret })
    expect(await stale.waitFor('error')).toEqual({ t: 'error', reason: 'link_expired' })
    const again = await TestClient.connect(tableId)
    const { welcome } = await again.hello('Mestre', { gmSecret: newSecret, playerKey: null })
    expect(welcome.self).toMatchObject({ role: 'gm', clientId: w1.self.clientId })
  })

  it('gerar link: mesa fora do índice → 404; pelo túnel → 404', async () => {
    expect((await rotate('ZZZZZZZZZZ', 'player-link')).status).toBe(404)
    const { tableId } = await createTable()
    expect((await rotate(tableId, 'gm-link', { 'cf-ray': 'x' })).status).toBe(404)
  })
})
```

Em `apps/web/test/home.test.tsx`:
1. No teste `'local com túnel: ...'`, acrescente `'Gerar novo link de jogador'` e `'Gerar novo link de mestre'` à lista de rótulos, e acrescente `rotate: async () => {}` ao objeto `actions` do topo.
2. Troque o import de `../src/lib/registry` para incluir `rotateConfirmOptions` e acrescente ao `describe('helpers da página inicial')`:

```ts
  it('textos dos avisos de gerar novo link', () => {
    expect(rotateConfirmOptions('player')).toEqual({
      title: 'Gerar novo link de jogador',
      message: 'O link de jogador atual vai parar de funcionar. Quem já está na mesa continua conectado.',
      confirmLabel: 'Gerar novo link',
    })
    expect(rotateConfirmOptions('gm')).toEqual({
      title: 'Gerar novo link de mestre',
      message: 'O link de mestre atual vai parar de funcionar. Quem já está na mesa continua conectado.',
      confirmLabel: 'Gerar novo link',
    })
  })
```

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @mesa/worker test && pnpm --filter @mesa/web test test/home.test.tsx`
Expected: FAIL (`setGmSecretHash` inexistente; rotas → 404; botões e helper inexistentes).

- [ ] **Step 3: Implement the worker**

Store (`store.ts`, interface): `setGmSecretHash(hash: string): void`. `sql-store.ts`:

```ts
  setGmSecretHash(hash: string): void {
    this.sql.exec('UPDATE meta SET gm_secret_hash = ?', hash)
  }
```

`memory-store.ts`:

```ts
  setGmSecretHash(hash: string): void {
    if (this.meta) this.meta = { ...this.meta, gmSecretHash: hash }
  }
```

Em `apps/worker/src/table-do.ts`, junto dos outros métodos RPC:

```ts
  /** RPC do índice: chave nova do link de jogador; quem está conectado continua. */
  setPlayerKeyHash(hash: string): boolean {
    if (!this.store.getMeta()) return false
    this.store.setPlayerKeyHash(hash)
    return true
  }

  /** RPC do índice: segredo novo do link de mestre; quem está conectado continua. */
  setGmSecretHash(hash: string): boolean {
    if (!this.store.getMeta()) return false
    this.store.setGmSecretHash(hash)
    return true
  }
```

Em `apps/worker/src/registry-do.ts`, na classe:

```ts
  setPlayerKey(id: string, key: string): boolean {
    return this.ctx.storage.sql.exec('UPDATE tables SET player_key = ? WHERE id = ? RETURNING id', key, id).toArray().length > 0
  }

  setGmSecret(id: string, secret: string): boolean {
    return this.ctx.storage.sql.exec('UPDATE tables SET gm_secret = ? WHERE id = ? RETURNING id', secret, id).toArray().length > 0
  }
```

Em `apps/worker/src/registry-api.ts`:
1. Import: `import { randomSecret, sha256Hex } from './crypto'`.
2. Em `handleRegistry`, antes do `return notFound()` final:

```ts
  if (rest.length === 3 && rest[0] === 'tables' && TABLE_ID_RE.test(rest[1]) && request.method === 'POST') {
    if (rest[2] === 'player-link') return rotateLink(env, rest[1], 'player')
    if (rest[2] === 'gm-link') return rotateLink(env, rest[1], 'gm')
  }
```

3. No fim do arquivo:

```ts
/** Link novo (chave de jogador ou segredo de mestre): o antigo para de funcionar; conectados continuam. */
async function rotateLink(env: Env, id: string, kind: 'player' | 'gm'): Promise<Response> {
  const registry = registryStub(env)
  if (!(await registry.findTable(id))) return notFound()
  const secret = randomSecret()
  const hash = await sha256Hex(secret)
  const table = tableStub(env, id)
  // TableDO primeiro: se falhar no meio, o índice ainda mostra o link que funciona.
  if (kind === 'player') {
    if (!(await table.setPlayerKeyHash(hash))) return notFound()
    await registry.setPlayerKey(id, secret)
  } else {
    if (!(await table.setGmSecretHash(hash))) return notFound()
    await registry.setGmSecret(id, secret)
  }
  return noContent()
}
```

Run: `pnpm --filter @mesa/worker test`
Expected: PASS.

- [ ] **Step 4: Implement the web**

Em `apps/web/src/lib/registry.ts`, no fim:

```ts
export type LinkKind = 'player' | 'gm'

export async function rotateLink(id: string, kind: LinkKind): Promise<boolean> {
  try {
    return (await fetch(`/api/registry/tables/${id}/${kind === 'player' ? 'player-link' : 'gm-link'}`, { method: 'POST' })).ok
  } catch {
    return false
  }
}

export function rotateConfirmOptions(kind: LinkKind): ConfirmOptions {
  const who = kind === 'player' ? 'jogador' : 'mestre'
  return {
    title: `Gerar novo link de ${who}`,
    message: `O link de ${who} atual vai parar de funcionar. Quem já está na mesa continua conectado.`,
    confirmLabel: 'Gerar novo link',
  }
}
```

Em `apps/web/src/ui/HomeView.tsx`:
1. Import: acrescente `type LinkKind` ao import de `../lib/registry`.
2. Em `HomeActions`, acrescente `rotate(table: RegistryTable, kind: LinkKind): Promise<void>`.
3. Em `TableCard`, dentro de `<div className="table-actions">`, antes do botão `Renomear`:

```tsx
        <button type="button" onClick={() => void actions.rotate(table, 'player')}>Gerar novo link de jogador</button>
        <button type="button" onClick={() => void actions.rotate(table, 'gm')}>Gerar novo link de mestre</button>
```

Em `apps/web/src/ui/HomePage.tsx`:
1. Acrescente `rotateConfirmOptions, rotateLink` ao import de `../lib/registry`.
2. Em `actions`, depois de `remove`:

```ts
    async rotate(table, kind) {
      if (!(await askConfirm(rotateConfirmOptions(kind)))) return
      setNotice(null)
      if (!(await rotateLink(table.id, kind))) setNotice('Não foi possível gerar o link novo. Tente de novo.')
      await refresh()
    },
```

Run: `pnpm --filter @mesa/web test`
Expected: PASS.

- [ ] **Step 5: E2E**

Em `e2e/table.spec.ts`, no fim:

```ts
// ---------------------------------------------------------------- gerar novos links

async function rotateFromCard(page: Page, name: string, label: 'Gerar novo link de jogador' | 'Gerar novo link de mestre') {
  await page.goto('/')
  await tableCard(page, name).getByRole('button', { name: label }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: 'Gerar novo link' }).click()
}

const registryEntry = async (page: Page, id: string) =>
  ((await (await page.request.get('/api/registry/tables')).json()).tables as any[]).find((t) => t.id === id)

test('novo link de jogador: o antigo expira com a mensagem, o novo funciona, quem está conectado continua', async ({ browser, page }) => {
  const name = `Link jogador ${Date.now()}`
  const t = await (await page.request.post('/api/tables', { data: { name } })).json()
  const player = await open(browser, playerPath(t), 'Ana')
  await rotateFromCard(page, name, 'Gerar novo link de jogador')
  await expect.poll(async () => (await registryEntry(page, t.tableId)).playerKey).not.toBe(t.playerKey)
  const fresh = await registryEntry(page, t.tableId)

  const stale = await (await browser.newContext()).newPage()
  await stale.goto(playerPath(t))
  await expect(stale.getByText('Este link expirou. Peça o link novo ao mestre')).toBeVisible()
  await open(browser, playerPath({ tableId: t.tableId, playerKey: fresh.playerKey }), 'Bia')
  expect(await player.evaluate(() => (window as any).__mesa.getState().status)).toBe('open')
})

test('novo link de mestre: o antigo expira, "Abrir como mestre" usa o novo e entra como mestre', async ({ browser, page }) => {
  const name = `Link mestre ${Date.now()}`
  const t = await (await page.request.post('/api/tables', { data: { name } })).json()
  const gm = await open(browser, `/t/${t.tableId}?debug=1#gm=${t.gmSecret}`, 'Mestre')
  await rotateFromCard(page, name, 'Gerar novo link de mestre')
  await expect.poll(async () => (await registryEntry(page, t.tableId)).gmSecret).not.toBe(t.gmSecret)
  const { gmSecret } = await registryEntry(page, t.tableId)
  await page.reload()
  await expect(tableCard(page, name).getByRole('link', { name: 'Abrir como mestre' })).toHaveAttribute('href', `/t/${t.tableId}#gm=${gmSecret}`)

  const stale = await (await browser.newContext()).newPage()
  await stale.goto(`/t/${t.tableId}?debug=1#gm=${t.gmSecret}`)
  await stale.getByLabel('Seu apelido').fill('Mestre')
  await stale.getByRole('button', { name: 'Entrar' }).click()
  await expect(stale.getByText('Este link expirou. Peça o link novo ao mestre')).toBeVisible()

  const again = await open(browser, `/t/${t.tableId}?debug=1#gm=${gmSecret}`, 'Mestre')
  expect(await again.evaluate(() => (window as any).__mesa.getState().self.role)).toBe('gm')
  expect(await gm.evaluate(() => (window as any).__mesa.getState().status)).toBe('open')
})
```

Em `README.md`, no parágrafo novo da Task 7 sobre a lista de mesas, acrescente ao fim: ` Cada mesa tem também **Gerar novo link de jogador** e **Gerar novo link de mestre**: o link antigo para de funcionar ("Este link expirou. Peça o link novo ao mestre") e quem já está na mesa continua conectado.`

- [ ] **Step 6: Gates and commit**

Run: `pnpm typecheck && pnpm test && pnpm e2e`

```bash
git add apps/worker/src apps/worker/test apps/web/src apps/web/test/home.test.tsx e2e/table.spec.ts README.md
git commit -m "feat(links): gerar novo link de jogador e de mestre na lista de mesas" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Self-review

**Cobertura do spec:**
- §2 índice (campos, registrar ao criar, atividade limitada, mesas antigas fora, apagar com `deleteAll` e arquivos) → Tasks 1, 2, 3.
- §3 só local (`/api/registry/*` 404, `/` com "Peça o link...", `POST /api/tables` local, rotas da mesa pelo túnel) → Tasks 1, 4 (members pelo túnel), 6 (E2E remoto).
- §4 túnel (POST local, `null` ao perder, só em memória, links com túnel, aviso sem túnel) → Tasks 1, 6, 7.
- §5 página (topo com Copiar, cards ordenados, Abrir como mestre local, Copiar links, Renomear no card, Apagar com modal do app, Nova mesa) → Task 6.
- §6 launcher (abre localhost, continua mostrando/copiando o túnel, informa inclusive ao reabrir) → Task 7.
- §7 vínculo (apelido de jogador fora, online recusado, mestre não por apelido, "Já jogou aqui?" 7 dias, mestre por segredo, segredo nunca exposto) → Tasks 4, 5.
- §7a excluir jogador (menu e X, modal com três escolhas, online/offline, manter = órfão só do mestre, apagar, excluído online desconectado, sem banimento, op com `deleteItems`, nunca sobre mestre) → Task 8.
- §7b novos links (`#j=`, hash no DO e texto no índice, fragmento limpo, dois botões com modal, regra de entrada inclusive com segredo guardado e por apelido, conectados ficam, mensagem de expirado, chave guardada no navegador) → Tasks 9, 10.
- §8 bordas → Tasks 1, 2, 4, 6, 7, 8, 9, 10. §9 testes → todos os itens têm teste nas tasks indicadas.

**Placeholders:** nenhum "TBD"/"implementar depois"; todo passo de código traz o código.

**Consistência de tipos:** `RegistryTable.playerKey` existe desde a Task 1 (null até a Task 9) e é usado por `tableLinks` (Task 6); `ServerErrorReason` cresce em ordem (T2 `table_deleted`, T4 `nickname_taken`, T8 `removed`, T9 `link_expired`) e o `FatalMessage` trata cada um na task que o cria; `fetchKnownPlayers` muda de assinatura na Task 9 e o único chamador (`TablePage`) é ajustado na mesma task; `memberMenuOptions` ganha `targetRole` na Task 8 junto dos dois chamadores e do teste; `HomeActions.rotate` entra na Task 10 junto do objeto de teste.

**Review Focus:** os cinco itens têm teste na task dona (1, 2, 4, 7, 8).
