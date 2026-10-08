# Mesa Virtual — M3: Grid, Régua, Ping, Formas, Chat e Dados (Design)

Data: 2026-10-08
Status: aguardando revisão
Base: M2 implementado (`docs/superpowers/specs/2026-10-08-mesa-virtual-m2-design.md`). Este documento só descreve o que muda.

## 1. Objetivos

1. **Grid** sobre o mapa, configurado pelo mestre (ligar/desligar, tamanho do quadrado, encaixe de tokens).
2. **Régua** ao vivo, com a distância real em quadrados e o nome de quem mede, visível para todos.
3. **Ping** no mapa (Shift + clique). Com Ctrl + clique, o mestre também **centraliza a tela de todos** no ponto.
4. **Formas:** retângulo, elipse e linha reta.
5. **Chat da mesa** com histórico, **imagens/GIFs** e **dados** rolados no servidor: clique rápido em 1d20, modal com dado, quantidade, bônus, vantagem/desvantagem e rolagem secreta.
6. **Conversas privadas** entre duas pessoas, abertas pelo botão direito num membro, em abas do chat, **sem armazenamento**.
7. O **mestre edita apelido e cor** de qualquer membro.

**Fora do escopo:** controle de turnos (marco seguinte), formas de área de magia, polígonos e setas, reações e emojis, apagar mensagens, som.

## 2. Configurações da mesa (grid)

```ts
interface TableSettings {
  grid: { enabled: boolean; size: number; snap: boolean }
}
```

- `size` é o tamanho do quadrado em pixels do mapa (inteiro, 10–500).
- Padrão: `{ enabled: false, size: 70, snap: false }`.
- Fica guardado no DO (linha única em `settings`, JSON) e entra no snapshot como `snapshot.settings`.
- Operação **só do mestre:** `settingsUpdate { patch: { grid?: Partial<Grid> } }`. Todos recebem `settingsUpdated { settings }`.

### Encaixe (snap)
- Vale só para **imagens** (mapa e tokens); traços e formas não encaixam.
- Com `snap: true`, todo `create` e todo `update` que mude `x`, `y`, `width` ou `height` de uma imagem é arredondado **no servidor** antes de salvar:
  - `x`, `y` → múltiplo de `size` mais próximo;
  - `width`, `height` → múltiplo de `size`, mínimo `size`.
- A rotação não é alterada.
- O cliente aplica a mesma função (`snapToGrid` em `packages/shared`) na prévia ao soltar.
- Mudar `size` ou ligar o encaixe **não** move objetos existentes.

### Desenho do grid
- Fica entre a camada `map` e a camada imediatamente acima dela.
- Linhas de 1 px na tela (espessura constante em qualquer zoom), cor branca com 25% de opacidade.
- Desenhadas só na área visível.
- Visível para todos quando `enabled`.

## 3. Régua

- Ferramenta **Régua** (ícone `Ruler`, tecla `R`).
- **Clique:** fixa o início no **centro do quadrado** clicado (com o grid desligado, o quadrado é calculado pelo `size` configurado). A linha passa a seguir o cursor.
- **Novo clique ou `Esc`:** remove a régua.
- Cada pessoa tem no máximo uma régua.
- **Distância:** `hypot(dx, dy) / size`, com uma casa decimal e vírgula decimal ("4,2 q"). Função pura `rulerDistance` em `packages/shared`.
- **Visual:** linha tracejada na cor do membro, com o rótulo **"Apelido · 4,2 q"** junto à ponta.
- **Efêmera:** presença `ruler { from: {x,y}, to: {x,y} }` com throttle de ~33 ms e `rulerEnd`. O servidor retransmite para todos os outros. Ao desconectar, a régua some para os outros.

## 4. Ping

- **Shift + clique** (qualquer ferramenta, sem criar nem selecionar nada) envia a presença `ping { x, y, recenter: false }`.
- **Ctrl + clique do mestre** envia `recenter: true`.
  - O servidor só mantém `recenter: true` se o remetente é GM; de jogador vira `false`.
  - Quem recebe com `recenter: true` desliza a câmera (≈400 ms) para centralizar o ponto, mantendo o zoom atual.
- **Visual:** anel na cor do membro que se expande e some em ~2 s, com o apelido ao lado. Também aparece para quem pingou.
- **Limite:** 3 pings por segundo por pessoa; os excedentes são descartados no servidor.

## 5. Formas

- Novo tipo de objeto `shape`:

```ts
interface ShapeObject extends BaseObject {   // herda control, title, layerId, x, y, width, height, rotation, zIndex...
  type: 'shape'
  kind: 'rect' | 'ellipse' | 'line'
  stroke: string          // #rrggbb
  strokeWidth: number     // 1..30
  fill: { color: string; opacity: number } | null   // só para rect/ellipse; opacity 0..1
  points?: [number, number, number, number]          // só para line, relativos a (x, y)
}
```

- **Ferramenta Formas** (ícone `Shapes`, tecla `S`): arrastar cria a forma na camada ativa.
  - Shift força quadrado ou círculo, e linhas em múltiplos de 45°.
  - Contorno e espessura vêm da caneta.
- **Botão direito na ferramenta** abre um popover com o tipo (Retângulo `Square`, Elipse `Circle`, Linha `Minus`) e o preenchimento: ligar/desligar, cor e opacidade (padrão: desligado, cor do contorno, 30%).
- **Comportamento de objeto comum (M2):** controle, título, menu de contexto, mover para camada, travas, desfazer, permissões de camada.
- **Retângulo e elipse** usam o Transformer (redimensionar e girar). **Linha** só se move.
- A borracha não age sobre formas.
- O encaixe no grid não se aplica.

## 6. Chat da mesa e dados

### 6.1 Entradas
```ts
type ChatEntry =
  | { id; at; authorId; kind: 'message'; text }                    // texto puro, 1..500
  | { id; at; authorId; kind: 'image'; assetKey; width; height }   // imagem/GIF
  | { id; at; authorId; kind: 'roll'; request: RollRequest; result: RollResult; secret: boolean }
```

- `id` é gerado pelo servidor; `at` é o timestamp do servidor.
- Ficam guardadas as **últimas 200** entradas da mesa (tabela `chat` no DO); as mais antigas são apagadas.
- **Visibilidade:**
  - `roll` com `secret: true` → só o autor e os mestres;
  - o resto → todos.
- O snapshot inclui `chat` filtrado pelo destinatário.

### 6.2 Dados
```ts
interface RollRequest { die: 4|6|8|10|12|20|100; count: number; bonus: number; mode: 'normal'|'advantage'|'disadvantage' }
interface RollResult  { rolls: number[]; kept: number[]; total: number }
```

- **Limites:** `count` de 1 a 50; `bonus` inteiro de −100 a +100; `advantage`/`disadvantage` só com `count === 1`, e então rola 2 dados e mantém o maior/menor.
- **Rolagem no servidor**, com `crypto.getRandomValues` e rejeição para evitar viés de módulo. O gerador é injetável no engine para testes.
- **Mensagens do cliente:**
  - `chatSend { channel: 'table', text }`;
  - `chatImage { channel, assetKey, width, height }`;
  - `roll { channel, request, secret }`.
- **Parser** em `packages/shared` (`parseCommand`):
  - `/r NdM`, `/r NdM+B`, `/r NdM-B`, `/r dM` (N=1);
  - sufixos opcionais `adv` ou `dis`;
  - fórmula inválida → toast "Fórmula inválida — ex.: /r 2d6+3" e nada é enviado.

### 6.3 Imagens e GIFs no chat
- Enviadas pelo botão `ImagePlus` do campo de mensagem, por **colar** (Ctrl+V) ou **arrastar** um arquivo para o painel do chat.
- **Upload pelo endpoint existente** (`/api/tables/:id/assets`), que passa a aceitar também `image/gif`.
  - **GIFs são enviados sem conversão**, para manter a animação.
  - PNG, JPEG e WebP seguem o redimensionamento do M1 (máx. 4096 px, WebP 0,85).
  - Limite de 10 MB mantido.
- Exibição: miniatura com no máximo 240×240 px na tela; o clique abre a imagem em tamanho real num overlay (`Esc` fecha).

### 6.4 Interface do chat
- **Painel à direita**, entre o painel de membros e o de camadas, recolhível (botão `MessageSquare`).
- **Abas:** "Mesa" mais uma aba por conversa privada aberta. Cada aba tem contador de não lidas.
- **Cada entrada** mostra o apelido na cor do membro, a hora (HH:MM) e o conteúdo.
  - **Texto:** renderizado sempre como texto, nunca como HTML.
  - **Rolagem:** "Ana rolou **1d20+5** (vantagem): [17, ~~8~~] + 5 = **22**". Os dados descartados aparecem riscados. No d20, 20 natural fica verde e 1 natural fica vermelho.
  - **Rolagem secreta:** fundo escuro, com o rótulo "(só mestre)".
- **Campo de mensagem:** Enter envia. Ao lado ficam os botões `ImagePlus` e **dado** (`Dices`).
- **Dado:**
  - Clique rola 1d20 no canal da aba ativa.
  - Botão direito abre o **modal do dado**:
    - botões d4–d100;
    - quantidade 1–50 (com − e +);
    - bônus;
    - Normal / Vantagem / Desvantagem (habilitado só com quantidade 1);
    - "Só o mestre vê" (só na aba Mesa);
    - botão **Rolar**.
  - O modal lembra a última configuração (`localStorage`) e fecha com `Esc` ou clique fora.
- **Limite de envio:** 5 itens (mensagens, imagens, rolagens) por segundo por pessoa, somados entre canais. O excesso é recusado com o toast "Devagar…".

## 7. Conversas privadas

- **Abertura:** botão direito num membro na lista → **"Conversa privada"** (não aparece para si mesmo). Abre ou foca a aba com o apelido da pessoa.
- **Sem armazenamento:** o servidor só **retransmite**.
  - Mensagem `chatSend { channel: { dm: clientId }, text }` (e o equivalente para imagem e rolagem).
  - O servidor entrega `chat { channel: { dm: <outro> }, entry }` **somente** às sessões do remetente e do destinatário.
  - O mestre **não** vê conversas privadas das quais não participa.
- **Destinatário offline:** recusa `not_found` e o toast "Fulano está offline".
- **Mensagem recebida** sem a aba aberta: a aba é criada (sem tirar o foco da aba atual) e o contador de não lidas aumenta.
- **Histórico só no cliente** e só enquanto a aba estiver aberta. **Fechar a aba (`X`) apaga o histórico**, e recarregar a página também.
- **Rolagens na aba privada** aparecem para as duas pessoas. "Só o mestre vê" não existe nessa aba.

## 8. Mestre edita apelido e cor

- Botão direito num membro → **"Editar apelido e cor"** (só para o mestre): campo de apelido (1–32, trim) e seletor de cor (`#rrggbb`).
- Operação **só do mestre:** `memberUpdate { clientId, patch: { nickname?, color? } }`.
- O servidor grava e marca `nicknameSetByGm` / `colorSetByGm` no membro. Todos recebem `memberUpdated { member }`.
- **No `hello`:**
  - se `nicknameSetByGm`, o apelido enviado pelo cliente é ignorado e mantém-se o do mestre;
  - se `colorSetByGm`, a cor não é reatribuída, mesmo se repetir a de outro membro.
- A mudança reflete na lista, nos cursores, réguas, pings, travas e no chat (o chat mostra o apelido **atual**).
- O próprio membro não edita o apelido depois de entrar, como no M2.

## 9. Protocolo (resumo)

| Cliente → servidor | Quem | Observação |
|---|---|---|
| `op settingsUpdate` | mestre | `ack`/`reject` como as demais ops |
| `op memberUpdate` | mestre | idem |
| `op create/update` de `shape` | regras de objeto do M2 | — |
| `chatSend`, `chatImage`, `roll` | todos | com `reqId` para `chatAck`/`chatReject { reqId, reason }` |
| `presence ruler`, `presence rulerEnd`, `presence ping` | todos | efêmero |

| Servidor → cliente | Para quem |
|---|---|
| `settingsUpdated { settings }` | todos |
| `memberUpdated { member }` | todos |
| `chat { channel, entry }` | conforme §6.1 (mesa) / §7 (privada) |
| `chatAck { reqId }` / `chatReject { reqId, reason }` | autor |
| `presence ruler/rulerEnd/ping` | todos os outros (o ping também para o autor) |

- `welcome.snapshot` ganha `settings` e `chat` (só canal da mesa, filtrado).
- `chatReject.reason` pode ser `invalid`, `not_found` (destinatário offline/inexistente) ou `rate_limited`.

## 10. Erros e casos de borda

| Situação | Comportamento |
|---|---|
| Rolagem ou mensagem inválida | `chatReject invalid`, com toast ou erro no modal |
| `/r` mal formado | Toast "Fórmula inválida — ex.: /r 2d6+3", nada enviado |
| Excesso de envios | `chatReject rate_limited`, toast "Devagar…" |
| Conversa privada com pessoa offline | `chatReject not_found`, toast "Fulano está offline" |
| Upload de imagem no chat falha | Toast "Falha ao enviar a imagem" com "Tentar novamente" |
| Jogador manda ping com recenter | Vira ping normal no servidor |
| Grid alterado com objetos fora da grade | Nada é movido |
| Reconexão | Snapshot traz `settings` e chat da mesa; réguas, pings e conversas privadas em andamento se perdem |
| Membro editado pelo mestre reconecta com outro apelido | Mantém o apelido do mestre |

## 11. Testes

- **Compartilhado:**
  - `snapToGrid`, `rulerDistance`, `parseCommand`;
  - schemas novos (limites de dados, chat, forma, configurações).
- **Servidor:**
  - Rolagem determinística com gerador injetado: normal, vantagem, desvantagem, bônus e limites.
  - Rolagem secreta e conversa privada **não chegam a terceiros**: privada não chega nem ao mestre não participante; secreta chega ao mestre e não aos jogadores.
  - Histórico limitado a 200 entradas e filtrado no snapshot.
  - Rate limit.
  - `settingsUpdate` e `memberUpdate` só pelo mestre; apelido e cor do mestre preservados no `hello`.
  - Encaixe aplicado a imagens ao criar e mover, e não a traços e formas.
  - Ping com recenter de jogador rebaixado.
  - GIF aceito no upload.
- **Front:**
  - Reducers de chat (abas, não lidas, fechar aba apaga), configurações, régua, ping e `memberUpdated`.
  - Modal lembra a configuração.
- **Ponta a ponta:**
  - Clique no dado mostra 1d20 no outro cliente.
  - Rolagem secreta invisível ao jogador.
  - Conversa privada: entregue só ao destinatário; o mestre não participante não recebe; fechar a aba apaga.
  - Imagem no chat aparece no outro cliente.
  - Mestre liga grid e encaixe → token solto cai alinhado.
  - Régua com nome e distância visível ao outro.
  - Retângulo, elipse e linha visíveis ao outro.
  - Ctrl + clique do mestre move a câmera do jogador.
  - Mestre renomeia jogador → nome muda na tela do jogador e persiste após recarregar.

## 12. Critério de pronto do M3

Numa sessão, o mestre configura o grid e o encaixe, mede distâncias com a régua, pinga e centraliza todos num ponto, e desenha formas. Os jogadores conversam e rolam dados no chat (inclusive com vantagem/desvantagem), enviam imagens e GIFs e trocam mensagens privadas. O mestre faz rolagens secretas e ajusta apelidos e cores do grupo.
