# Mesa Virtual: seleção em área e alcance em todas as camadas (Design)

Data: 2026-10-09
Status: aguardando revisão

## 1. Objetivo

- Selecionar vários itens arrastando uma área (retângulo ou laço), cortando os traços de caneta na borda da área.
- Agir sobre a seleção: mover, apagar e, para o mestre, mudar de camada e de controle/permissões.
- Opção "Todas as camadas" no Selecionar e na borracha.

**Fora do escopo:** copiar/colar, redimensionar ou girar um grupo, Shift + clique para alternar itens, camada especial "Todos", modificador Alt.

## 2. Regras de seleção

- **Ferramenta Selecionar (V)** ganha um menu de hover (como o da caneta):
  - **Forma da seleção:** Retângulo | Laço;
  - **Todas as camadas:** liga/desliga.
  - As duas opções ficam no `localStorage` (por pessoa).
- **Alcance:** só a camada ativa, ou todas com "Todas as camadas" ligado. Nos dois casos, só itens que a pessoa pode editar (regras atuais: camada oculta ou travada para ela, controle do token, autoria dos desenhos). O resto nunca entra.
- **O que entra numa área:**
  - imagens/tokens e formas (retângulo, elipse, linha): só se estiverem **inteiros** dentro da área;
  - traços de caneta: as **partes de dentro** da área (o traço é cortado na borda).
- **O corte só acontece ao agir** (mover, apagar, mudar de camada). Enquanto só está selecionado, as partes de dentro aparecem realçadas e nada muda para ninguém.

## 3. Interação

| Gesto (com o Selecionar) | Efeito |
|---|---|
| Clique num item | seleciona só ele (com Transformer se for um item inteiro, como hoje) |
| Arrastar no vazio | desenha a área (retângulo tracejado ou contorno do laço); ao soltar, vira a seleção |
| Shift + arrastar, com seleção ativa | soma uma nova área à seleção |
| Shift + clique (sem arrastar) | ping no mapa, como hoje; não altera a seleção |
| Clique fora da seleção / Esc | desfaz a seleção, sem cortar nada |
| Arrastar um item ou parte selecionada | move o grupo; envia o lote ao soltar (com encaixe no grid se ligado) |
| Delete / Backspace | apaga a seleção |
| Botão direito na seleção | menu do grupo: "Apagar"; mestre: "Mover para camada" e, com tokens, "Controle e permissões" (aplicado a todos) |
| Ctrl+Z | desfaz a ação inteira |

- **Clique ou arrasto:** distingue-se pelo deslocamento do mouse (limiar de poucos pixels, o mesmo usado hoje para distinguir clique de arrasto).
- **Seleção múltipla:** caixa tracejada em volta de tudo, sem alças de redimensionar/girar.
- **Trocar de ferramenta ou de camada ativa** desfaz a seleção. Com "Todas as camadas" ligado, trocar de camada não desfaz.
- **Os outros jogadores** veem, enquanto alguém arrasta um grupo, um contorno tracejado da seleção se movendo com o nome de quem arrasta (presença efêmera, não salva). O resultado aparece ao soltar. O arrasto de item único continua como hoje.

**Borracha:** o menu da caneta, no modo borracha, ganha **Todas as camadas**. Ligada, a borracha passa por traços de todas as camadas editáveis. Continua valendo a opção do mestre de apagar só os próprios traços ou os de qualquer um.

## 4. Protocolo: ação `batch`

```
{ kind: 'batch', ops: Array<create | update | delete> }   // 1..200 itens
```

- **Validação:** cada sub-ação passa pelas mesmas regras de hoje (permissão por item, camada, controle, lock de outra pessoa).
- **Atomicidade:** o servidor aplica tudo numa cópia; se qualquer sub-ação falhar, rejeita o lote inteiro (com o motivo da primeira falha) e nada muda.
- **Coerência:** sub-ações contraditórias sobre o mesmo id no mesmo lote são rejeitadas (`invalid`): por exemplo, apagar e atualizar o mesmo id, criar um id que já existe, ou dois `update`s do mesmo id.
- **Idempotência:** a mesma de hoje, por opId do lote.
- **Repasse:** cada pessoa recebe só os efeitos que ela pode ver (o filtro por destinatário atual), num único envio.
- Turnos, camadas, membros e ajustes **não** entram no lote.

**Montagem do lote (no navegador de quem age):**
- **Mover:** traço cortado → `delete` do original + `create` dos pedaços (os de dentro já na posição nova); itens inteiros → `update` de posição.
- **Apagar:** traço cortado → `delete` do original + `create` só dos pedaços de fora; itens inteiros → `delete`.
- **Mover para camada:** igual a mover, trocando `layerId` em vez da posição.
- **Controle e permissões:** um `update` por token; sem corte.
- **Borracha em todas as camadas:** os cortes de todas as camadas num único lote.
- Lote com mais de 200 sub-ações → recusado no navegador com o aviso "Seleção grande demais; selecione menos itens".

**Desfazer:** o navegador guarda o lote inverso (recriar os originais, apagar os pedaços, voltar posições/camadas). Ctrl+Z envia o inverso como outro lote. Se for recusado, aparece "Não foi possível desfazer", como hoje.

**Otimismo:** o lote é aplicado na hora na tela de quem age. Se for rejeitado, tudo volta, aparece "Não foi possível mover a seleção" (ou "apagar") e a seleção é desfeita.

## 5. Geometria (packages/shared)

- `insideRect(item, rect)` e `insidePolygon(item, polygon)`: o item inteiro (caixa girada, para imagens/formas) dentro da área.
- `splitStrokeByRect(points, rect)` e `splitStrokeByPolygon(points, polygon)` → `{ inside: number[][], outside: number[][] }`, cortando os segmentos exatamente na borda.
- Laço: regra par/ímpar para dentro/fora; laço com menos de 3 pontos é ignorado.
- A borracha atual continua com o código de corte existente (`eraseSegments`).

## 6. Erros e bordas

| Situação | Comportamento |
|---|---|
| Lote recusado (lock, camada travada, controle mudou) | tela volta ao estado anterior; aviso; seleção desfeita |
| Item selecionado apagado/movido por outra pessoa | sai da seleção na hora |
| Área sem nada editável | nenhuma seleção, sem aviso |
| Mais de 200 sub-ações | recusado no navegador, com aviso |
| Laço que se cruza | regra par/ímpar |

## 7. Testes

- **Geometria:** inteiro dentro (retângulo, laço, item girado); corte de traço por retângulo e laço (atravessando, todo dentro, todo fora, laço que se cruza).
- **Servidor:** lote válido aplicado e repassado com filtro; lote com uma sub-ação proibida não muda nada; sub-ações contraditórias recusadas; limite de 200; idempotência.
- **Navegador:** montagem dos lotes (mover, apagar, mudar camada, borracha); inverso para desfazer; rejeição restaura a tela; opções no `localStorage`.
- **e2e (2 usuários):**
  - retângulo pegando um traço e um token, mover: o outro vê o traço cortado e tudo no lugar novo; Ctrl+Z desfaz tudo;
  - laço apagando parte de um traço;
  - "Todas as camadas" pegando itens de duas camadas;
  - jogador não seleciona o token de outro;
  - Shift + arrastar soma; Shift + clique pinga;
  - borracha com "Todas as camadas".
