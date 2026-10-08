# Mesa Virtual — M1: Mesa Compartilhada (Design)

Data: 2026-10-08
Status: aguardando revisão

## 1. Contexto e objetivos

Sistema web estilo Roll20: várias pessoas acessam a mesma tela online, desenham juntas e movem os itens umas das outras em tempo real.

**Objetivos (em ordem de prioridade):**
1. Uso real com o grupo de RPG (~6 pessoas por mesa).
2. Aprendizado de colaboração em tempo real (protocolo de sincronização escrito à mão).
3. Possível produto no futuro — a arquitetura não deve impedir crescimento.

**Restrições:**
- Hospedagem gratuita, sem VPS própria nem servidor da empresa.
- TypeScript ponta a ponta.
- Salas persistentes, sem login: acesso por link + apelido; mestre identificado por link secreto.

### Roadmap de marcos

| Marco | Escopo | Spec |
|---|---|---|
| **M1 — Mesa compartilhada** | Sala por link, upload/redimensionamento de mapa, tokens (mover/redimensionar/girar), desenho livre, cursores, camadas fixas, desfazer próprio | **este documento** |
| M2 — Camadas + Mestre | Gestão de camadas (criar/renomear/travar/visibilidade), papéis e permissões geridas pelo mestre | futura |
| M3 — Dados + Chat | Rolagem de dados (`2d6+3`) com resultado no chat; chat da mesa | futura |
| M4 — Controle de turnos | Modal de iniciativa/ordem de turnos controlado pelo mestre | futura |

O M1 já modela camadas, papéis (`gm`/`player`) e `ownerId` nos objetos para que M2–M4 não exijam migração estrutural.

## 2. Arquitetura

**Plataforma:** Cloudflare (plano Free).
- **Cloudflare Pages** — front-end estático.
- **Cloudflare Worker** — API HTTP e roteamento de WebSocket.
- **Durable Object `Table`** — uma instância por mesa; mantém os WebSockets, é a autoridade do estado e persiste em SQLite embutido.
- **R2** — armazenamento das imagens (mapas e tokens).

```
Navegador (x6)  ──HTTPS──▶  Worker  ──▶  R2 (imagens)
      │                       │
      └──────WebSocket────────┴──▶  Durable Object "Table" (1 por mesa)
                                      - WebSockets (Hibernation API)
                                      - validação e permissões
                                      - SQLite (estado da mesa)
```

### Repositório (monorepo, pnpm workspaces)
- `apps/web` — React + Vite + TypeScript, react-konva, Zustand.
- `apps/worker` — Worker + Durable Object `Table`.
- `packages/shared` — tipos e protocolo de mensagens (schemas Zod), importados por front e back.

### Endpoints do Worker
| Método | Rota | Função |
|---|---|---|
| POST | `/api/tables` | Cria mesa. Body: `{ name }`. Retorna `{ tableId, gmSecret }` |
| GET | `/api/tables/:id/ws` | Upgrade para WebSocket, encaminhado ao DO via `idFromName(tableId)` |
| POST | `/api/tables/:id/assets` | Upload de imagem → R2. Retorna `{ assetKey, width, height }` |
| GET | `/assets/:key` | Serve imagem do R2 com cache longo (chave imutável) |

### Identidade e acesso
- `tableId`: identificador público aleatório (ex.: 10 caracteres base62).
- `gmSecret`: segredo aleatório de 32 bytes; o DO armazena apenas o hash SHA-256.
- Links: jogadores `/t/{tableId}`; mestre `/t/{tableId}#gm={gmSecret}` (fragmento não vai para logs nem requisições HTTP).
- O cliente gera um `clientId` (UUID) e guarda no `localStorage` junto do apelido; recarregar a página mantém a identidade.
- No `hello`, se `gmSecret` bater com o hash, o membro recebe `role: 'gm'`; caso contrário `'player'`.
- Upload de assets exige `tableId` existente (o Worker consulta o DO) — evita uso do R2 por terceiros sem mesa.

### Princípio central
**O servidor é a autoridade.** O cliente aplica ações de forma otimista; o DO valida, aplica, persiste e retransmite, ou rejeita e o cliente reverte.

## 3. Modelo de dados

Persistido no SQLite do Durable Object:

```ts
type Role = 'gm' | 'player'

interface TableMeta { id: string; name: string; gmSecretHash: string; createdAt: number }

interface Member { clientId: string; nickname: string; color: string; role: Role; lastSeenAt: number }

interface Layer {
  id: string
  name: string
  order: number
  visibility: 'all' | 'gm'
  locked: boolean
}

interface BaseObject {
  id: string
  layerId: string
  type: 'image' | 'stroke'
  x: number; y: number
  width: number; height: number
  rotation: number
  zIndex: number
  ownerId?: string      // clientId do dono (usado em M2)
  version: number       // incrementado pelo servidor a cada update
  updatedBy: string     // clientId
}

interface ImageObject extends BaseObject { type: 'image'; assetKey: string }
interface StrokeObject extends BaseObject {
  type: 'stroke'
  points: number[]      // [x0,y0,x1,y1,...] relativos a (x,y)
  color: string
  strokeWidth: number
}
```

**Tabelas SQLite:** `meta`, `members`, `layers`, `objects(id, layer_id, type, data JSON, version)`.

**Camadas fixas do M1** (criadas junto com a mesa):

| id | nome | order | visibility |
|---|---|---|---|
| `map` | Mapa | 0 | all |
| `tokens` | Tokens | 1 | all |
| `drawings` | Desenhos | 2 | all |
| `gm` | Mestre | 3 | gm |

Mapa e token são o mesmo tipo (`image`); só a camada difere.

**Cor do membro:** atribuída pelo servidor a partir de uma paleta fixa de 12 cores, a primeira não usada por membros conectados.

## 4. Protocolo de sincronização

Todas as mensagens são JSON validadas por Zod (`packages/shared/protocol.ts`), nos dois lados.

### Cliente → servidor
| Mensagem | Campos | Observação |
|---|---|---|
| `hello` | `clientId, nickname, gmSecret?` | Primeira mensagem obrigatória |
| `op` | `opId, kind: 'create'\|'update'\|'delete', object \| {id, patch} \| {id}` | Altera estado persistido |
| `grab` | `objectId` | Pede trava para arrastar/transformar |
| `release` | `objectId` | Libera a trava |
| `presence` | `cursor{x,y}` \| `dragPreview{objectId,x,y,w,h,rotation}` \| `strokePreview{strokeId,points,color,strokeWidth}` \| `strokePreviewEnd{strokeId}` | Efêmero, não persistido |

### Servidor → cliente
| Mensagem | Campos |
|---|---|
| `welcome` | `self: Member, snapshot: { meta, members, layers, objects }` |
| `ack` | `opId, version` |
| `reject` | `opId, reason, current?` (estado atual do objeto, se existir) |
| `op` | operação aplicada por outro membro (com `version`, `updatedBy`) |
| `grabbed` / `released` | `objectId, clientId` |
| `presence` | `clientId, ...payload` |
| `memberJoined` / `memberLeft` | `member` / `clientId` |
| `error` | `reason` (ex.: mesa inexistente) |

### Regras do servidor
- Ignora qualquer mensagem antes de `hello`; valida todas com Zod; mensagens inválidas são descartadas e logadas.
- **Filtro da camada do Mestre:** objetos em camadas com `visibility: 'gm'` nunca são enviados a jogadores (nem no snapshot, nem em `op`, `presence` ou `grabbed`). Jogadores não podem criar/alterar objetos nessas camadas.
- **Travas:** `grab` é aceito se o objeto não estiver travado por outro. Enquanto travado, `update`/`delete`/`grab` de outros membros são rejeitados (`reason: 'locked'`). A trava expira após 10 s sem `dragPreview` do dono, ou na desconexão do dono.
- **Concorrência:** fora as travas, vale a ordem de chegada ao servidor (last-write-wins por objeto); `version` é incrementado a cada update.
- **Idempotência:** o DO guarda os últimos 200 `opId` por cliente; um `opId` repetido recebe o mesmo `ack` sem reaplicar.
- **Permissões M1:** qualquer membro pode criar/mover/apagar objetos nas camadas `all`; somente o GM opera na camada `gm`. Permissões finas ficam para o M2.

### Fluxos
- **Arrastar token:** `grab` → `presence.dragPreview` (throttle ~30/s) → ao soltar `op update` + `release`. Só o `update` é persistido.
- **Desenhar:** `presence.strokePreview` com pontos incrementais (~30/s) → ao soltar, pontos simplificados (Ramer–Douglas–Peucker, tolerância ~1px na escala atual) e `op create` de um `stroke`; `strokePreviewEnd` remove a prévia nos outros.
- **Cursor:** `presence.cursor` ~15/s, apenas quando muda.

## 5. Front-end

### Organização
- `sync/` — cliente WebSocket: conexão, reconexão, throttle, fila de ops pendentes, mapeamento `ack`/`reject`. Única camada que fala com a rede.
- `store/` — Zustand: `objects`, `layers`, `members`, `presence`, `self`, `activeLayerId`, `tool`, `undoStack`. Ações da UI chamam o store, que chama o sync.
- `canvas/` — `Stage` react-konva; um `<Layer>` Konva por camada + um layer de overlay (cursores, prévias, seleção, indicadores de trava); componentes por tipo de objeto e por ferramenta.
- `ui/` — tela inicial (criar mesa, exibir links), modal de apelido, toolbar, lista de membros, toasts, indicador de conexão.

### Interações
| Ferramenta | Atalho | Comportamento |
|---|---|---|
| Selecionar/Mover | `V` | Seleciona objetos **da camada ativa**; arrasta; Konva Transformer para redimensionar e girar. Imagens mantêm proporção por padrão (`Shift` libera) |
| Mão | `H` / segurar `Espaço` | Pan da visão |
| Zoom | roda do mouse | Zoom centrado no cursor, limites 10%–800% |
| Lápis | `P` | Desenho livre; cor e espessura na toolbar |
| Borracha | `E` | Apaga o traço inteiro tocado (camada ativa) |
| Imagem | botão / soltar arquivo | Upload; cria `image` na camada ativa, no centro da visão (ou no ponto do drop) |
| Apagar | `Delete` | Remove a seleção |
| Desfazer | `Ctrl+Z` | Desfaz as últimas ações do próprio usuário |

- O seletor de camada ativa mostra a camada `Mestre` apenas para o GM.
- Objetos travados por outro membro exibem borda na cor e o apelido de quem está movendo, e não podem ser selecionados.
- A lista de membros mostra apelido, cor, papel e status (conectado/desconectado).

### Desfazer
- Cada operação **própria** confirmada gera uma operação inversa na `undoStack` (máx. 50): `create`↔`delete`, `update` → `update` com os valores anteriores.
- `Ctrl+Z` envia a inversa como operação normal. Se o objeto foi alterado/apagado por outra pessoa e o servidor rejeitar, a entrada é descartada com toast "Não foi possível desfazer".
- Sem refazer (`Ctrl+Y`) no M1.

### Upload
- O cliente redimensiona para no máx. 4096 px no maior lado e converte para WebP (qualidade ~0.85) via canvas.
- O Worker aceita `image/webp`, `image/png`, `image/jpeg` até 10 MB; chave R2 = SHA-256 do conteúdo (deduplicação).
- Tamanho inicial no canvas: dimensões originais para a camada `map`; maior lado = 70 px para tokens (redimensionável depois).

## 6. Erros e reconexão

| Situação | Comportamento |
|---|---|
| Conexão cai | Reconexão com backoff 1s, 2s, 4s… até 30s; banner "Reconectando…"; edição bloqueada enquanto desconectado |
| Reconectou | Novo `welcome` com snapshot substitui o estado local; ops pendentes sem `ack` são reenviadas (idempotência por `opId`) |
| `reject` | Reverte o efeito otimista (usa `current` se vier) e mostra toast curto |
| Dono da trava desconecta | DO libera a trava e envia `released` |
| Upload falha | Nada é criado no canvas; toast com "Tentar novamente" |
| Mensagem inválida | Servidor descarta e loga; não derruba a conexão |
| Mesa inexistente | `error` → tela "Mesa não encontrada" com botão para criar nova |

## 7. Limites do plano gratuito

Referência (docs Cloudflare, out/2026): Durable Objects SQLite no plano Free — 100 mil linhas escritas/dia, 5 milhões de linhas lidas/dia, 5 GB de armazenamento total na conta. Workers Free — 100 mil requisições/dia. R2 Free — 10 GB.

Mitigações:
- Persistência só em operações concluídas (soltar token, terminar traço).
- Mensagens efêmeras com throttle e envio só quando há mudança.
- WebSocket Hibernation API: mesa parada não consome.
- Simplificação de traços antes de persistir.
- Contador de mensagens/escritas por sessão exposto em modo desenvolvimento (`?debug=1`) para medir o consumo real na primeira sessão do grupo.

## 8. Testes

| Nível | Cobertura | Ferramenta |
|---|---|---|
| Unidade | Schemas do protocolo; aplicar/rejeitar ops; travas e expiração; idempotência; RDP; geração de inversas do desfazer | Vitest |
| Durable Object | Múltiplos sockets numa mesa: snapshot, broadcast, filtro da camada GM para jogadores, trava concorrente, liberação na desconexão, reconexão | Vitest + `@cloudflare/vitest-pool-workers` |
| E2E | Dois navegadores: criar mesa, entrar, mover token e ver no outro, desenhar, jogador não vê camada GM, recarregar e manter estado | Playwright |
| Manual | Sessão-teste com o grupo | — |

## 9. Critério de pronto do M1

O grupo consegue: criar uma mesa, compartilhar o link, cada pessoa entrar com apelido, subir mapa e tokens, mover/redimensionar/girar e desenhar juntos vendo os cursores uns dos outros, usar a camada do Mestre sem que jogadores a vejam, fechar tudo e reabrir dias depois com a mesa intacta.

## 10. Fora do escopo do M1

Contas/login; gestão de camadas e permissões finas (M2); dados e chat (M3); turnos (M4); grid/snap; névoa de guerra; formas geométricas e texto; refazer; mobile/touch otimizado; exclusão de assets órfãos no R2.
