# Mesa Virtual

Mesa colaborativa estilo Roll20: mapa, tokens, desenho, formas, grade, régua, ping, chat com dados
e camada do mestre em tempo real.

## Na mesa

- **Grade** (só o mestre): botão "Grade" na barra: mostrar, tamanho do quadrado e encaixe de imagens.
- **Régua** (`R`): o clique fixa o início no centro do quadrado; novo clique ou `Esc` remove.
- **Ping**: Shift + clique. O mestre usa Ctrl + clique para centralizar a tela de todos.
- **Formas** (`S`): arraste; Shift força quadrado/círculo/45°; botão direito escolhe retângulo, elipse ou linha e o preenchimento.
- **Chat**: Enter envia; `/r 2d6+3`, `/r d20+5 adv`; clique no dado rola 1d20 e o botão direito abre as opções (inclusive "Só o mestre vê"). Imagens e GIFs pelo botão, colando ou arrastando.
- **Conversa privada**: botão direito num membro → "Conversa privada". Nada fica guardado no servidor; fechar a aba apaga.
- **Mestre**: botão direito num membro → "Editar apelido e cor".

## Desenvolvimento

```bash
pnpm install
pnpm dev:worker   # API + Durable Object + R2 locais em :8787
pnpm dev:web      # front com hot reload em :5173 (proxy para :8787)
pnpm test         # unitários + Durable Object
pnpm e2e          # ponta a ponta: sobe um wrangler dev próprio em :8788 (E2E_PORT muda a porta),
                  # com build em apps/web/dist-e2e e estado em apps/worker/.wrangler/e2e-state,
                  # não interfere num `pnpm local`/`pnpm host` rodando na 8787
```

## Publicar uma versão (pacote Windows)

```bash
pnpm release 0.4.0 --dry-run   # confere git (limpo, na main, em dia), typecheck e testes; não grava versão, commit nem tag (só um git fetch)
pnpm release 0.4.0             # grava a versão, commita "release: v0.4.0", cria a tag e envia
```

A tag dispara o GitHub Actions (`.github/workflows/release.yml`, em Windows): testes, build,
montagem do `MesaVirtual-v0.4.0-win64.zip` (Node 24 portátil, `cloudflared` e servidor com as
dependências de Windows), teste de fumaça no zip e criação da Release com notas automáticas.
Acompanhe em https://github.com/joaovictorjtorres/PersonalBoard/actions. O mesmo fluxo (testes,
build, pacote e fumaça, sem criar Release) roda em todo push na `main` e pelo botão "Run workflow",
para ensaiar antes de taguear.

Se o `pnpm release` falhar antes do commit, ele restaura `package.json` e `version.txt` a partir
do HEAD e nada é publicado. Se falhar na criação da tag, o commit local é mantido (os arquivos não
são restaurados) e a mensagem imprime como recuperar. Se falhar no envio, o commit e a tag ficam só
no seu computador e a mensagem traz o comando para reenviar (`git push --atomic origin main v0.4.0`)
ou desfazer. Ele
não tenta de novo sozinho: leia o erro antes de repetir.

## Rodar no Windows (pacote)

Para o mestre hospedar a mesa no próprio PC Windows, de graça, sem instalar nada.

1. Baixe o `MesaVirtual-vX.Y.Z-win64.zip` mais recente em
   https://github.com/joaovictorjtorres/PersonalBoard/releases/latest.
2. Extraia para um caminho curto, por exemplo `C:\MesaVirtual`. Caminhos longos (acima de
   260 caracteres) quebram o servidor, e a extração do Explorer falha em caminhos muito longos:
   extraia direto em `C:\MesaVirtual`. Não rode de dentro do zip.
3. Dê dois cliques em **Iniciar Mesa**. Se o Windows mostrar "O Windows protegeu o computador"
   (SmartScreen), clique em **Mais informações → Executar assim mesmo**. Se o antivírus perguntar,
   permita `app\node\node.exe`, `app\cloudflared.exe` e, durante uma atualização,
   `%TEMP%\MesaVirtual-update\node.exe`.
4. A janela verifica se há versão nova, sobe o servidor e o túnel e mostra o endereço do túnel
   `https://….trycloudflare.com` (já copiado). O navegador abre sozinho a página das suas mesas em
   `http://localhost:<porta>/`: cada mesa tem **Abrir como mestre**, **Copiar link de mestre** e
   **Copiar link de jogador** (os links já usam o túnel). Mande o link de jogador para o grupo.
5. Para desligar, feche a janela ou aperte Ctrl+C. Ctrl+C pode mostrar "Deseja finalizar o arquivo
   em lotes (S/N)?": responda S (ou simplesmente feche a janela).

Se o servidor não subir (a janela mostra o erro e as últimas linhas do log), instale o
"Microsoft Visual C++ Redistributable (x64)" da Microsoft e abra a mesa de novo.

O link muda a cada vez que a mesa é aberta; o `/t/<id>` das mesas continua valendo (basta trocar só
o domínio). Sem internet (ou se o túnel falhar), a mesa funciona só no seu PC, no endereço
`http://localhost:<porta>` com a porta mostrada na janela (8787 a 8797). Se as portas
8787 a 8797 estiverem todas ocupadas, feche o outro programa que as usa e abra de novo.

A lista de mesas só aparece no seu PC: quem abre o endereço do túnel sem o link de uma mesa vê
"Peça o link da mesa ao mestre". Numa sessão nova (o endereço do túnel muda), o jogador entra com o
mesmo apelido ou clica no próprio nome em "Já jogou aqui?" e continua dono dos próprios desenhos e
tokens. O mestre, pelo link de mestre, volta a ser o mesmo mestre. Cada mesa tem também
**Gerar novo link de jogador** e **Gerar novo link de mestre**: o link antigo para de funcionar
("Este link expirou. Peça o link novo ao mestre") e quem já está na mesa continua conectado.

Para suporte, o `Iniciar Mesa.cmd` aceita `--no-update` (pula a verificação de atualização) e
`--port N` (porta fixa); rode-o pelo prompt de comando, por exemplo `"Iniciar Mesa.cmd" --port 8790`.

**Onde ficam os dados:** em `%LOCALAPPDATA%\MesaVirtual\` (cole esse caminho na barra do Explorer):

- `state\`: as mesas;
- `backups\AAAA-MM-DD_HHMMSS\`: cópias automáticas de `state\`, uma por dia de uso e outra antes
  de cada atualização. Ficam as 10 mais recentes; pastas que você criar ali nunca são apagadas;
- `logs\launcher.log`: registro para suporte;
- `config.json`: preferências.

A pasta do pacote não guarda mesas. Pode apagá-la e extrair o zip de novo sem perder nada.

**Atualização automática:** ao abrir, se houver versão nova, a janela pergunta
`Atualizar agora? [S/n]` (Enter ou S atualiza; N adia). As mesas são copiadas para `backups\` antes
da troca. Para desligar a pergunta, edite `%LOCALAPPDATA%\MesaVirtual\config.json` e deixe
`"autoUpdate": false` (sem aspas no `false`).

**Migrar as mesas do Linux:** desligue a mesa nos dois computadores. Copie todo o conteúdo de
`apps/worker/.wrangler/state/` do Linux para `%LOCALAPPDATA%\MesaVirtual\state\` no Windows,
substituindo o que houver, e abra a mesa.

**Restaurar um backup:** desligue a mesa. Em `%LOCALAPPDATA%\MesaVirtual\`, renomeie `state` para
`state-antigo`. Copie a pasta do backup desejado (`backups\AAAA-MM-DD_HHMMSS`) para
`%LOCALAPPDATA%\MesaVirtual\` e renomeie a cópia para `state`. Abra a mesa.

## Opção A: rodar na sua máquina (sem conta Cloudflare)

O `wrangler dev` simula Worker, Durable Object (SQLite) e R2 localmente e salva tudo em
`apps/worker/.wrangler/state/`; as mesas sobrevivem a reinícios. Faça backup copiando essa pasta.

Instale antes o `cloudflared` (binário oficial em https://github.com/cloudflare/cloudflared/releases).
O Quick Tunnel não exige conta Cloudflare.

```bash
pnpm local    # terminal 1: servidor local persistente (só neste PC, em 127.0.0.1)
pnpm tunnel   # terminal 2: imprime o link https://….trycloudflare.com para o grupo
```

O link `https://….trycloudflare.com` muda a cada execução do `pnpm tunnel`. O `/t/<id>` das mesas
continua valendo: basta trocar o domínio pelo novo.

A lista de mesas fica em `http://localhost:8787/`. Sem o launcher, ela não sabe o endereço do túnel
e mostra "Túnel indisponível, só local"; para os links já saírem com o túnel, informe-o:
`curl -X POST http://localhost:8787/api/registry/tunnel -H "Content-Type: application/json" -d "{\"url\":\"https://….trycloudflare.com\"}"`.

Seu computador precisa ficar ligado durante a sessão.

Atenção: `pnpm local`, `pnpm host` e `pnpm dev:worker` usam a mesma porta 8787; não rode dois ao mesmo tempo.

Alternativa: VPN (Tailscale, ZeroTier, Hamachi…). Rode `pnpm host` (servidor aberto na rede, em
0.0.0.0) em vez de `pnpm local`. Todos entram na mesma rede virtual e acessam
`http://<IP-da-VPN-do-host>:8787`. **No modo VPN não há lista de mesas**: aberto na rede, o servidor
não consegue garantir que um pedido veio do próprio PC, então a lista (com os links de mestre) fica
desligada. A página inicial só cria mesas; guarde o link de mestre mostrado ao criar. Libere a
porta 8787 no firewall do host e confira o limite de membros do plano gratuito da VPN escolhida
(são 7 pessoas contando o host; o Hamachi gratuito, por exemplo, costuma limitar redes a 5).

Acesso por `http://` em IP funciona; o app já trata a falta de `crypto.randomUUID` fora de HTTPS.

## Opção B: publicar na Cloudflare (grátis, sempre no ar)

```bash
pnpm --filter @mesa/worker exec wrangler login
pnpm --filter @mesa/worker exec wrangler r2 bucket create mesa-virtual-files
pnpm run deploy
```

O deploy imprime a URL `https://mesa-virtual.<sua-conta>.workers.dev`. Mesas criadas
localmente não vão para a nuvem automaticamente.

Ao atualizar o servidor para uma versão nova, feche todas as abas da mesa antes e abra de novo depois.

## Limites do plano gratuito

Durable Objects (SQLite): 100 mil linhas escritas/dia, 5 milhões lidas/dia, 5 GB no total.
Abra a mesa com `?debug=1` para ver mensagens e escritas da sessão.
