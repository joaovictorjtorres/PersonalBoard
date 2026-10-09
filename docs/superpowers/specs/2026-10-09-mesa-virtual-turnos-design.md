# Mesa Virtual: controle de turnos (Design)

Data: 2026-10-09
Status: aguardando revisão

## 1. Objetivo

Dar ao mestre uma ordem de turnos (iniciativa) que todos veem, ligada opcionalmente aos tokens do mapa.

- Entradas livres; também podem ser criadas pelo botão direito num token.
- Duas fases: **preparação** (adicionar participantes e rolar 1d20 de iniciativa) e **combate** (passar turnos).
- Só o mestre opera; todos veem.
- Quando chega a vez de uma entrada ligada a um token, o token é destacado no mapa.

**Fora do escopo:** bônus de iniciativa, entradas ocultas, histórico das rolagens no chat, efeitos/condições com duração, temporizador de turno.

## 2. Estado (servidor, salvo com a mesa)

Um estado por mesa, guardado no SQLite do Durable Object, como as camadas e os ajustes.

```
Turns {
  open: boolean            // janela aberta para todos (espelhada)
  phase: 'prep' | 'combat'
  round: number            // >= 1; só tem sentido no combate
  currentId: Id | null     // entrada da vez; null na preparação
  entries: TurnEntry[]     // em ordem
}
TurnEntry {
  id: Id
  name: string             // 1..32 caracteres, sem espaços nas pontas
  tokenId: Id | null       // objeto (imagem) ligado
  initiative: number | null // inteiro -99..999
}
```

- Máximo de **50** entradas.
- Mesa sem estado salvo: `{ open: false, phase: 'prep', round: 1, currentId: null, entries: [] }`.

## 3. Ações

Todas são só do mestre; vindas de jogador são rejeitadas (`forbidden`). Todas passam pelo protocolo de ops existente (opId, idempotência, ack/reject).

| Ação | Fase | Efeito |
|---|---|---|
| `turnsOpen { open }` | qualquer | abre/fecha a janela para todos |
| `turnAdd { entry: {id, name, tokenId?} }` | qualquer | adiciona no fim da lista |
| `turnDuplicate { id, newId }` | qualquer | copia logo abaixo da original: nome com sufixo " 2", " 3"... (próximo número livre), mesmo `tokenId`, `initiative: null` |
| `turnUpdate { id, patch: {name?, initiative?} }` | qualquer | edita; **não reordena** |
| `turnRemove { id }` | qualquer | remove; se era a da vez, a vez passa para a seguinte (ou a primeira, sem mudar a rodada); se a lista ficar vazia no combate, volta à preparação |
| `turnMove { id, index }` | qualquer | move para a posição `index` |
| `turnsRoll { all }` | preparação | o servidor rola 1d20 (sorteio imparcial já usado nos dados) para cada entrada sem iniciativa (`all: false`) ou para todas (`all: true`), depois ordena do maior para o menor com ordenação **estável** (empate mantém a ordem atual) |
| `turnsStart` | preparação, ≥1 entrada | `phase: 'combat'`, `round: 1`, vez = primeira entrada, abre a janela |
| `turnNext` / `turnPrev` | combate | avança/volta; passar da última para a primeira soma 1 à rodada; voltar da primeira para a última subtrai 1 (mínimo 1) |
| `turnsEnd { keep }` | combate | `keep: false` limpa as entradas; `keep: true` mantém as entradas com `initiative: null`; ambos voltam à preparação, `round: 1`, `currentId: null` |

Regras extras:
- Ação incompatível com a fase, id inexistente ou dados inválidos → rejeitada (`invalid`).
- Token ligado apagado: a entrada continua; só perde o destaque e a miniatura.
- O cliente aplica as ações do mestre de forma otimista, como as outras; `turnsRoll` espera o servidor (o resultado vem dele). Duplicar, adicionar e mover geram ids no cliente.
- Ações de turno **não entram** na pilha de desfazer (Ctrl+Z).
- Todos recebem o estado completo ao entrar/reconectar (welcome) e cada mudança por broadcast. Não há filtragem por destinatário: tudo é visível para todos (a exceção é o destaque no mapa, que só aparece para quem enxerga o token; ver §4).

## 4. Interface

**Barra de ferramentas (só mestre):** botão "Turnos" (ícone de espadas cruzadas, lucide `Swords`). Alterna `turnsOpen`.

**Janela flutuante** (para todos quando `open`):
- Aparece no topo, centralizada, ~320 px de largura; arrastável pelo cabeçalho.
- Cada pessoa move e minimiza a própria cópia; posição e estado minimizado ficam no `localStorage` (por mesa).
- Cabeçalho: "Turnos" e, no combate, "Rodada N". Botões: minimizar (todos), fechar (só mestre; fecha para todos).
- Minimizada: faixa "Rodada N · Vez de: <nome>" (na preparação: "Turnos · preparação"); clique reabre.
- Sem barra de rolagem horizontal; a lista rola na vertical com o estilo do app.

**Card de entrada:**
- Alça de arrastar (só mestre) · miniatura do token ligado (se existir) · nome · iniciativa em destaque ("?" sem valor; o app não usa travessões).
- Card da vez: borda/fundo realçados; a lista rola até ele quando a vez muda.
- Mestre, ao passar o mouse: duplicar, remover. Clicar no nome ou no número edita no próprio card (Enter/blur salva, Esc cancela).
- Passar o mouse num card ligado destaca o token no mapa na tela de quem passou o mouse. Clicar na miniatura centraliza a própria câmera no token.

**Rodapé (só mestre):**
- Preparação: campo de nome + "Adicionar", "Rolar iniciativa" (só quem está sem valor), "Rolar de novo para todos", "Iniciar combate" (desativado sem entradas).
- Combate: "Turno anterior", "Próximo turno", campo + "Adicionar", "Encerrar". "Encerrar" abre o modal de confirmação do app com "Encerrar e limpar", "Encerrar e manter participantes" e "Cancelar".

**Mapa:**
- Botão direito num token (mestre): "Adicionar à ordem de turnos". Nome = título do token ou "Token". Se a janela estiver fechada, abre.
- Token da vez: anel colorido pulsante em volta dele, para todos que enxergam o token; acompanha o token durante o arrasto.

**Jogadores:** mesma janela, sem alças, botões de edição e rodapé.

## 5. Erros e bordas

| Situação | Comportamento |
|---|---|
| Jogador envia ação de turno | rejeitada; nada muda |
| Dois "Próximo" rápidos | dois avanços, na ordem de chegada |
| Ação fora da fase | rejeitada; o botão já aparece desativado |
| Nome vazio | não envia; volta o nome anterior |
| Iniciativa fora de -99..999 ou não inteira | recusada no campo |
| 51ª entrada | rejeitada; "Adicionar" e "Duplicar" desativados no limite |
| Mesa antiga sem turnos | estado padrão (§2) |

## 6. Testes

- **shared:** schemas das ações (limites de nome, iniciativa, 50 entradas).
- **engine (worker):** cada ação e permissão; rolagem estável (empates); só-sem-valor vs todos; virada de rodada nos dois sentidos; remover a entrada da vez; lista vazia no combate; token apagado; `turnsEnd` com `keep` true/false; idempotência.
- **Durable Object:** quem entra recebe o estado; jogador rejeitado; estado sobrevive a reinício.
- **web:** reducers das ações; sufixo do duplicar; posição/minimizado no `localStorage`.
- **e2e (2 usuários):** mestre adiciona pelo botão direito do token, duplica, rola e inicia; o jogador vê a janela abrir, o card da vez e o anel no token; "Próximo" avança nos dois; "Encerrar e manter participantes" deixa a lista com iniciativas zeradas; o jogador não vê os controles.
