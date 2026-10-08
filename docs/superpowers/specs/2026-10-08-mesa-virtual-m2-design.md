# Mesa Virtual — M2: Camadas, Permissões, Caneta e Polimento (Design)

Data: 2026-10-08
Status: aguardando revisão
Base: M1 implementado (`docs/superpowers/specs/2026-10-08-mesa-virtual-m1-design.md`). Este documento só descreve o que muda.

## 1. Objetivos

1. O mestre gerencia camadas: adicionar, remover, renomear, ocultar e travar para jogadores, e mover objetos entre camadas.
2. Cada objeto tem **quem controla** (todos / jogadores escolhidos / só o mestre), um **título** público exibido abaixo dele e uma **anotação do mestre** que jogadores nunca recebem.
3. A caneta ganha configurações por botão direito (espessura, cor, modo apagar) e a borracha passa a **apagar só por onde passa**, respeitando quem pode apagar o quê.
4. Interface com ícones profissionais (Lucide) no lugar de emojis.
5. Robustez herdada da revisão do M1: heartbeat, `reject` para operação inválida, lista de membros sem duplicatas antigas.

**Fora do escopo do M2:** reordenar camadas por arrastar, dados, chat e turnos (M3/M4), refazer, mobile/touch, grid, névoa de guerra.

## 2. Modelo de dados

### 2.1 Camadas
Sem campos novos. Reinterpretação:
- `visibility: 'gm'` = **oculta para jogadores**; `'all'` = visível.
- `locked: true` = **travada para jogadores** (o mestre sempre edita).
- **Camada do Mestre (`id: 'gm'`) é fixa no topo:** sempre tem a maior `order`, sempre `visibility: 'gm'`, não pode ser removida, ocultada/mostrada nem reordenada (só renomeada e travada/destravada).
- Nova camada: entra **logo abaixo da camada do Mestre** (acima de todas as outras), `visibility: 'all'`, `locked: false`, nome padrão "Nova camada", `id` gerado pelo cliente (nanoid, valida com `IdSchema`). O servidor recalcula as `order` (inteiros consecutivos, Mestre por último) e envia as camadas afetadas.
- **Reordenar:** "Subir camada" / "Descer camada" (só mestre) troca a posição com a vizinha; nenhuma camada pode passar acima da do Mestre. A ordem define o empilhamento: objetos de camadas mais altas ficam sempre por cima.
- Sempre existe ao menos uma camada além da do Mestre (a última camada comum não pode ser removida).

### 2.2 Objetos
Campos novos em `TableObject` (imagens e traços):

```ts
control: { mode: 'all' | 'gm' | 'list'; clientIds: string[] }  // máx. 20 ids
title?: string                                                  // trim, 1..40; ausente = sem título
```

- Ao criar, o servidor define `control = { mode: 'list', clientIds: [autor] }` (ignora o que o cliente mandar).
- **Pode controlar** = papel `gm` **ou** `mode === 'all'` **ou** (`mode === 'list'` e `clientIds` contém o cliente). `mode: 'gm'` = só o mestre.
- Traços: `points: number[]` é substituído por `segments: number[][]`.
  - Cada pedaço tem ao menos 2 pontos (4 números), em pares x,y relativos a (x, y) do objeto.
  - Limites: até 200 pedaços e até 20 000 números somados.
  - `width`/`height` = caixa envolvente de todos os pedaços.

### 2.3 Anotação do mestre
- Tabela separada no DO: `gm_notes(object_id TEXT PRIMARY KEY, text TEXT NOT NULL)`, texto de até 2000 caracteres. Texto vazio remove a linha.
- Nunca faz parte de `TableObject`, nunca é enviada a jogadores.
- Apagar um objeto (ou a camada dele) apaga a anotação.

### 2.4 Membros
- O snapshot inclui membros online **ou** com `lastSeenAt` nos últimos 7 dias.
- Tabela `removed_members` não é necessária: `memberRemove` apaga a linha de `members`. Se a pessoa voltar, entra de novo normalmente.
- Não é possível remover um membro online.

### 2.5 Migração dos dados do M1
Na leitura dos objetos no `SqlStore`:
- traço com `points` → `segments: [points]`;
- objeto sem `control` → `{ mode: 'list', clientIds: [ownerId] }`.

A versão normalizada é gravada na próxima escrita do objeto. Nenhuma mesa existente se perde.

## 3. Protocolo

### 3.1 Novas operações (`op.kind`)
| kind | Campos | Quem |
|---|---|---|
| `layerCreate` | `layer: { id, name }` | mestre |
| `layerUpdate` | `id, patch: { name?, visibility?, locked? }` | mestre |
| `layerDelete` | `id` | mestre; recusada para `gm` ou se for a última camada comum |
| `layerMove` | `id, direction: 'up' \| 'down'` | mestre; recusada para `gm` e quando subiria acima do Mestre |
| `noteSet` | `objectId, text` | mestre |
| `memberRemove` | `clientId` | mestre; recusada se o membro estiver online |

Operações existentes:
- `update` passa a aceitar `control` (só mestre), `title` (quem controla; `null` remove) e `segments`.
- `update` com `layerId` (mover entre camadas) é **só do mestre**.
- `create` de traço passa a usar `segments`.

Todas as operações novas seguem o mesmo fluxo de `opId`, `ack`/`reject` e idempotência do M1.

### 3.2 Novas mensagens do servidor
| Mensagem | Para quem | Quando |
|---|---|---|
| `layerUpsert { layer }` | quem vê a camada | criação/edição de camada visível ao destinatário |
| `layerShown { layer, objects }` | jogadores | camada passou de oculta para visível |
| `layerHidden { id }` | jogadores | camada passou de visível para oculta |
| `layerRemoved { id }` | quem via a camada | camada removida (cliente remove os objetos dela) |
| `noteSet { objectId, text }` | mestre(s) | anotação alterada |
| `memberRemoved { clientId }` | todos | membro removido |
| `ack` / `reject` para operações novas | autor | como no M1 |

`welcome.snapshot` ganha `notes: Record<objectId, string>` **apenas para o mestre** (jogadores recebem `{}`).

### 3.3 Regras do servidor (complementam o M1)
- Toda operação de camada, `noteSet`, `memberRemove`, mudança de `control` e mudança de `layerId` exige papel `gm`. Caso contrário, `reject forbidden`.
- `update`, `delete` e `grab` exigem **poder controlar** o objeto e camada editável pelo papel.
- `layerDelete` apaga objetos e anotações da camada, solta travas deles e avisa todos.
- Esconder uma camada solta as travas de jogadores nos objetos dela.
- **Operação inválida:** se a mensagem tem `t: 'op'` e um `opId` legível, mas falha no schema, o servidor responde `reject { reason: 'invalid', current: null }`.

### 3.4 Identidade do jogador (segredo por cliente)
Como as permissões do M2 são por `clientId`, o id não pode ser falsificável:
- No primeiro `hello` de um `clientId` desconhecido, o servidor gera um `clientSecret` aleatório (32 bytes, base64url), guarda só o SHA-256 no membro e o devolve uma única vez em `welcome.clientSecret`.
- O cliente guarda o segredo no `localStorage` por mesa (`mesa:secret:<tableId>`) e o envia em todo `hello` seguinte (`clientSecret`, até 128 caracteres).
- Para um `clientId` conhecido, segredo ausente ou errado gera `error { reason: 'auth' }` e o fechamento 4401. A sessão do membro verdadeiro não é afetada. O cliente mostra "Identidade inválida — limpe os dados do site ou entre com outro navegador" e não reconecta.
- **Migração:** membros do M1 sem segredo adotam um novo no primeiro `hello` recebido (confiança no primeiro uso).

### 3.5 Heartbeat
- O DO configura `ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'))`, que responde sem acordar o DO da hibernação.
- O cliente envia o texto `ping` a cada 25 s com o socket aberto. Se nenhuma mensagem (`pong` ou qualquer outra) chegar em 10 s após um ping, fecha o socket e segue o fluxo de reconexão do M1.

## 4. Borracha "por onde passa"

### 4.1 Comportamento
- É o **modo Apagar** da caneta. A tecla `E` ativa a caneta no modo apagar; `P` ativa no modo desenhar.
- Age só na **camada ativa** e só sobre **traços**.
- **Quem apaga o quê:**
  - Jogador: só traços que **controla**.
  - Mestre com "Apagar: só os meus": só traços com `ownerId` = ele.
  - Mestre com "de todos": todos os traços da camada.
  - Traços travados por outra pessoa ficam de fora.
- **Raio:** `max(8, espessura da caneta) / 2` em pixels de tela, convertido para o mundo dividindo pelo zoom.

### 4.2 Algoritmo de corte (função pura em `packages/shared`)
`eraseSegments(segments, eraserPath, radius, strokeWidth): number[][]`
1. Reamostra cada pedaço com passo `radius / 2`, para que arestas longas também sejam cortadas no meio.
2. Remove os pontos cuja distância ao caminho da borracha (polilinha) seja `<= radius + strokeWidth / 2`.
3. Divide o que sobrou em trechos contínuos e descarta trechos com menos de 2 pontos ou comprimento `< 2`.
4. Simplifica cada trecho com a mesma simplificação RDP do M1 (tolerância `1 / zoom`).

Antes, um filtro por caixa envolvente (caminho da borracha expandido pelo raio) descarta traços distantes.

### 4.3 Fluxo
- Durante o arrasto, o resultado é calculado no máximo uma vez por quadro e mostrado **só localmente** como prévia (sobrepõe o traço original).
- Ao soltar o mouse, para cada traço alterado é enviado `update { segments, x, y, width, height }` (recalculando a caixa e os pontos relativos) ou `delete` se não sobrou nenhum pedaço.
- Envio em lote, todas as operações de uma vez.

### 4.4 Desfazer em grupo
- A pilha de desfazer passa a guardar **grupos** (`Op[]`, até 50 grupos).
- Ações comuns geram grupos de 1 operação.
- Uma passada de borracha gera um grupo com todas as operações dela.
- `Ctrl+Z` envia todas as inversas do grupo. O grupo entra na pilha quando **todas** as operações dele forem confirmadas; se alguma for recusada, as confirmadas entram mesmo assim como grupo.

## 5. Interface

### 5.1 Ícones
`lucide-react`:

| Ação | Ícone |
|---|---|
| Selecionar | `MousePointer2` |
| Mão | `Hand` |
| Caneta | `Pencil` (ou `Eraser` no modo apagar) |
| Adicionar imagem | `ImagePlus` |
| Desfazer | `Undo2` |
| Visibilidade da camada | `Eye`/`EyeOff` |
| Trava da camada | `Lock`/`LockOpen` |
| Nova camada / remover | `Plus` / `Trash2` |
| Anotação | `StickyNote` |
| Remover membro | `X` |

- Os rótulos acessíveis existentes são mantidos: "Selecionar (V)", "Mão (H)", "Lápis (P)", "Desfazer (Ctrl+Z)".
- O botão "Borracha (E)" sai; o rótulo do botão da caneta passa a ser "Lápis (P)" no modo desenhar e "Borracha (E)" no modo apagar.

### 5.2 Popover da caneta (botão direito no botão da caneta)
- Espessura: slider de 1 a 30, com prévia.
- Cor: `<input type="color">` mais 8 cores rápidas.
- Modo: Desenhar / Apagar.
- Só para o mestre, no modo Apagar: chave "Apagar: só os meus / de todos" (padrão: só os meus).
- Fecha com `Esc` ou clique fora.

Os controles de cor e espessura que hoje ficam soltos na barra saem dela.

### 5.3 Painel de camadas (canto inferior direito)
- Lista em ordem decrescente de `order`. A camada ativa fica destacada; um clique a seleciona.
- Indicadores `EyeOff` (oculta para jogadores) e `Lock` (travada).
- **Mestre:**
  - botão "Nova camada" (`Plus`);
  - botão direito na linha abre o menu **Propriedades da camada**: nome (salva no Enter ou ao sair do campo), "Oculta para jogadores", "Travada para jogadores", "Subir camada", "Descer camada" e "Remover camada" (confirmação "Remover a camada X e N objetos?"). Para a camada do Mestre só aparecem nome e "Travada para jogadores".
- A lista mostra **a camada mais alta primeiro** (Mestre no topo, Mapa embaixo) — a mesma ordem visual do empilhamento.
- **Jogador:** vê só as camadas visíveis e só escolhe a ativa.
- O select "Camada ativa" do topo é removido. O painel tem `aria-label="Camadas"` e cada linha é um botão com o nome da camada (o E2E usa isso).

### 5.4 Menu de contexto do objeto (botão direito no canvas)
O menu do navegador fica desativado sobre o canvas. O menu abre sobre o objeto e o seleciona.

| Item | Mestre | Jogador que controla |
|---|---|---|
| Título (input, salva no Enter ou ao sair do campo; vazio remove) | ✓ | ✓ |
| Permissões: rádio *Todos* / *Só o mestre* / *Jogadores escolhidos* + checkboxes com os membros | ✓ | — |
| Anotação do mestre (textarea, salva ao sair do campo) | ✓ | — |
| Mover para camada (lista de camadas) | ✓ | — |
| Apagar | ✓ | ✓ |

Jogador que não controla o objeto: o menu não abre.

### 5.5 Canvas
- **Título:** texto centralizado abaixo da caixa do objeto (sem rotação), tamanho fixo de 13 px na tela, branco com contorno escuro.
- **Camadas com `visibility: 'gm'`:** desenhadas com 50% de opacidade para o mestre.
- **Objeto com anotação:** ícone `StickyNote` pequeno no canto superior direito, só para o mestre.
- **Traços:** renderizados como um grupo de `Line` (um por pedaço), com a mesma área de clique e de arrasto do traço inteiro.

### 5.6 Membros
- O painel mostra a mesma lista do snapshot (online ou vistos em 7 dias).
- O mestre vê um `X` ("Remover da lista") ao lado de membros offline.

## 6. Erros e casos de borda

| Situação | Comportamento |
|---|---|
| Outra pessoa altera o traço durante a passada | Vale a última escrita; o corte é aplicado sobre a versão local |
| Camada fica oculta ou travada durante a passada | As operações são recusadas, a prévia some, toast "Sem permissão nessa camada" |
| Camada ativa é removida ou escondida | A ativa passa para a camada visível de maior `order` |
| Jogador perde o controle durante o arrasto | `update` recusado, o objeto volta (fluxo de `reject` do M1) |
| Objeto aberto no menu de contexto é apagado por outro | O menu fecha |
| Remover membro online | `reject forbidden` |
| Ping sem resposta por 10 s | Reconecta |
| Operação de camada recusada | Toast e reversão otimista (camadas também entram no estado otimista) |

## 7. Testes

- **Compartilhado:**
  - `eraseSegments`: corte no meio gera 2 pedaços; borracha longe não muda nada; cobertura total gera `[]`; aresta longa de 2 pontos é cortada; descarte de fragmentos minúsculos.
  - Schemas novos.
- **Worker (engine + DO com sockets reais):**
  - Modos de `control`; só o mestre muda `control`, `layerId` e anotação.
  - **Anotação nunca chega a jogador**, nem no snapshot nem em `noteSet`.
  - `layerHidden`/`layerShown` ao vivo; `layerDelete` apaga objetos e anotações; última camada não pode ser removida.
  - `memberRemove` (online recusado); filtro de 7 dias.
  - `reject invalid`; migração de traço com `points` e objeto sem `control`.
  - `pong` automático.
- **Web:**
  - Reducers das mensagens novas.
  - Desfazer em grupo.
  - Ping/timeout no `SyncClient` (com timers falsos).
- **Ponta a ponta:**
  - O mestre esconde e revela uma camada, e o jogador vê os objetos sumirem e voltarem.
  - Token "só o mestre": o arrasto do jogador não move o token na tela do mestre.
  - Uma passada de borracha no meio de uma linha resulta em 2 pedaços na tela do outro.
  - O título aparece para o jogador; a anotação não aparece no estado do jogador.
  - Os testes existentes são atualizados para o painel de camadas.

## 8. Critério de pronto do M2

Numa sessão, o mestre consegue:
- criar e remover camadas, revelar uma camada escondida no momento certo e travar o mapa;
- mover um token entre camadas;
- marcar um token como "só o mestre" e escrever uma anotação privada nele.

Os jogadores conseguem dar título aos seus tokens e apagar com a borracha só os próprios desenhos, sem nunca ver nada oculto nem as anotações.
