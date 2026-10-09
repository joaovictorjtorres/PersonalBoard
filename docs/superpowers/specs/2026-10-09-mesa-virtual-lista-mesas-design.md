# Mesa Virtual: lista de mesas e vínculo entre sessões (Design)

Data: 2026-10-09
Status: aguardando revisão

## 1. Objetivo

- Ao abrir o programa, o mestre vê as mesas que já criou, com link de mestre e de jogador de cada uma, e tudo da última sessão salvo (chat da mesa, camadas, turnos, desenhos, tokens).
- Jogadores e mestre continuam donos dos próprios desenhos e tokens entre sessões, mesmo com o endereço do túnel mudando a cada sessão.

**Já existe:** cada mesa guarda no servidor camadas, objetos, notas do mestre, ajustes e as últimas mensagens do chat da mesa; turnos entram pela spec de turnos. Conversas privadas continuam **não** sendo guardadas.

**Fora do escopo:** mesas criadas antes desta versão, duplicar mesa, senha de acesso, acesso à lista de fora do PC, aprovação do mestre para recuperar jogador.

## 2. Índice de mesas (servidor)

- Um Durable Object único `RegistryDO` (nome fixo), com SQLite, guarda uma linha por mesa:
  - `id`, `name`, `createdAt`, `lastActivityAt`, `players` (membros jogadores conhecidos);
  - `gmSecret` (texto), gravado ao criar a mesa.
- Criar mesa: registra no índice na mesma chamada.
- O TableDO informa ao índice, de forma barata (no máximo uma vez por minuto por mesa): última atividade e número de jogadores.
- **Mesas antigas** (criadas antes desta versão) são ignoradas: não aparecem na lista e não há migração (decisão do usuário: tudo ainda é teste).
- Apagar mesa: remove do índice e apaga todo o armazenamento do TableDO (`deleteAll`) e os arquivos enviados que só ela usa.

## 3. Acesso só local

- As rotas do índice (`/api/registry/*`) e a página inicial com a lista só respondem a pedidos **locais**.
- **Local** = chegou direto no servidor pelo PC, e não pelo túnel. Pedidos do túnel trazem cabeçalhos e `Host` da Cloudflare (`*.trycloudflare.com`, `cf-ray`, `cf-connecting-ip`). O plano deve **verificar empiricamente** (cloudflared e wrangler/miniflare reais) quais sinais distinguem as duas origens sem falso positivo, e implementar a regra mais estrita que funcione: por exemplo, `Host` igual a `localhost:<porta>` ou `127.0.0.1:<porta>` **e** ausência de `cf-ray`.
- Pedido não local para `/api/registry/*` → `404`. Para `/`, a página mostra só "Peça o link da mesa ao mestre" (sem lista e sem criar mesa). `POST /api/tables` também passa a ser só local.
- As rotas da mesa (`/t/:id`, WebSocket, `/files/*`, upload) continuam funcionando pelo túnel como hoje.

## 4. Endereço do túnel

- O launcher, ao obter a URL do túnel, informa ao servidor: `POST /api/registry/tunnel { url }` (local). Ao perder o túnel, informa `{ url: null }`.
- O servidor guarda a URL só em memória do `RegistryDO` (não precisa sobreviver a reinício: o launcher informa de novo).
- A página monta os links com essa URL; sem túnel, usa a origem local e mostra "Túnel indisponível, só local".

## 5. Página inicial (local)

- Topo: link do túnel atual com "Copiar", ou o aviso sem túnel.
- Lista (mais recente primeiro): card por mesa com nome, criação, última atividade, jogadores, e os botões:
  - **Abrir como mestre** (abre `/t/<id>#gm=<segredo>` na origem local, para o mestre jogar no próprio PC);
  - **Copiar link de mestre** e **Copiar link de jogador** (com a URL do túnel);
  - **Renomear** (edição no card);
  - **Apagar** (modal de confirmação do app: "Apagar a mesa <nome>? Desenhos, tokens, chat e turnos serão perdidos.").
- "Nova mesa" no fim (nome + criar), como hoje.
- Textos em pt-BR, sem travessões, sem diálogos nativos.

## 6. Launcher (pacote Windows)

- Abre o navegador em `http://localhost:<porta>/` (não mais no link do túnel).
- Continua mostrando e copiando o link do túnel na janela.
- Informa a URL do túnel ao servidor (§4), inclusive quando o túnel é reaberto com link novo.

## 7. Vínculo entre sessões

**Jogador (pelo apelido):**
- Ao entrar com um apelido igual (ignorando maiúsculas/minúsculas e espaços nas pontas) ao de um **jogador fora da mesa**, o servidor liga o novo cliente a esse membro: ele assume o `clientId` antigo (com autoria, controle de tokens, cor e apelido). O cliente guarda o novo segredo no navegador.
- Apelido de alguém **online**: entrada recusada com "Esse apelido está em uso na mesa agora".
- Apelido do **mestre**: nunca recupera por apelido.
- A tela de entrada mostra "Já jogou aqui? Clique no seu nome", com os jogadores fora da mesa (vistos nos últimos 7 dias, como a lista de membros).
- Risco aceito: um jogador pode entrar como outro que esteja fora da mesa.

**Mestre (pelo segredo):** quem entra com o segredo de mestre é ligado automaticamente ao membro mestre existente (mesmo `clientId`), recuperando a autoria dos próprios desenhos.

**Detalhe técnico:** o protocolo atual de identidade (`clientSecret` com hash salvo, `hello v:2`) ganha a operação de "assumir" um membro; o plano define o formato a partir do código real, mantendo a regra de que um segredo nunca é exposto a outros clientes.

## 8. Erros e bordas

| Situação | Comportamento |
|---|---|
| Pedido do túnel à lista ou para criar mesa | 404 / página "Peça o link ao mestre" |
| Apagar mesa aberta por jogadores | jogadores conectados recebem "A mesa foi apagada" e voltam à página inicial |
| Apelido de jogador online | recusado com mensagem |
| Launcher sem túnel | links locais e aviso |

## 9. Testes

- **worker:** regra de acesso local (com e sem cabeçalhos do túnel, `Host` diferente); criar/listar/renomear/apagar; atualização de atividade com limite de frequência; URL do túnel; recuperação por apelido (fora, online recusado, maiúsculas/espaços, mestre não recupera) e do mestre por segredo; apagar mesa derruba conexões.
- **launcher:** abre `localhost`; informa a URL do túnel (inclusive ao reabrir).
- **web:** página local (cards, links com a URL do túnel, modal de apagar); página remota sem lista; tela de entrada com "Já jogou aqui?".
- **e2e:** criar duas mesas e vê-las na lista; renomear e apagar; jogador entra, desenha, sai; com navegador limpo, entra com o mesmo apelido e recupera o controle; mestre com navegador limpo pelo link de mestre recupera a autoria; pedido com cabeçalho do túnel não vê a lista.
