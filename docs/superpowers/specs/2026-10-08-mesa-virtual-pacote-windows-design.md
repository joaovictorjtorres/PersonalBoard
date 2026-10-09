# Mesa Virtual — Pacote Windows portátil com atualização automática (Design)

Data: 2026-10-08
Status: aguardando revisão

## 1. Objetivo

O mestre hospeda a mesa **no próprio PC Windows**, de graça, usando o **Cloudflare Quick Tunnel**, sem instalar ferramentas de desenvolvimento.

O fluxo desejado:
1. O desenvolvimento acontece no Linux. Uma versão nova é publicada com **um comando**.
2. No Windows, o mestre dá **dois cliques em "Iniciar Mesa"**. O app se atualiza sozinho (com confirmação), sobe o servidor e o túnel e mostra o link para o grupo.
3. As mesas nunca se perdem em atualizações.

**Fora do escopo:** interface gráfica (bandeja/janela), instalador `.msi`, assinatura de código, macOS/Linux como alvo do pacote, domínio fixo.

**Pré-requisito:** o repositório `joaovictorjtorres/PersonalBoard` passa a ser **público**.

## 2. Conteúdo do pacote

- Arquivo: `MesaVirtual-vX.Y.Z-win64.zip`, anexado à Release `vX.Y.Z` do GitHub.

```
MesaVirtual\
  Iniciar Mesa.cmd          ← ponto de entrada (duplo clique)
  app\
    node\                   ← Node.js portátil win-x64 (mesma major usada no projeto)
    server\                 ← apps/worker (wrangler.jsonc, src) + web compilado em dist + node_modules de produção para win-x64 (wrangler, workerd)
    cloudflared.exe         ← binário oficial win-amd64 (versão fixada no build)
    launcher\               ← launcher.mjs e módulos
    version.txt             ← "X.Y.Z"
```

- `Iniciar Mesa.cmd` só chama `app\node\node.exe app\launcher\launcher.mjs` com o diretório do pacote. Toda a lógica fica no launcher, que é testável.
- O servidor roda com o mesmo comando do modo local: `wrangler dev --ip 127.0.0.1 --port <porta> --persist-to <dados>\state`.
  - Escuta só em `127.0.0.1`, porque o túnel conecta localmente. Nada fica exposto na rede.
  - A porta padrão é 8787. Se estiver ocupada, usa a próxima livre (até 8797).
- **Sem telemetria** do wrangler: `WRANGLER_SEND_METRICS=false`.

## 3. Dados do usuário

- Raiz: `%LOCALAPPDATA%\MesaVirtual\`
  - `state\`: as mesas (o `--persist-to` do wrangler);
  - `backups\AAAA-MM-DD_HHMMSS\`: cópias de `state\`;
  - `logs\launcher.log`: log rotativo (até 1 MB, 3 arquivos);
  - `config.json`: preferências (`{ "autoUpdate": true, "lastBackup": "<iso>" }`).
- A pasta do app nunca guarda dados. Apagar ou trocar `app\` não perde mesas.
- **Migração do Linux:** copiar a pasta `.wrangler/state` do Linux para `%LOCALAPPDATA%\MesaVirtual\state\` (documentado no README).

## 4. Fluxo do launcher

1. **Cabeçalho:** "Mesa Virtual vX.Y.Z".
2. **Atualização** (se `autoUpdate`):
   - consulta `GET https://api.github.com/repos/joaovictorjtorres/PersonalBoard/releases/latest` (sem autenticação, timeout de 5 s);
   - se `tag_name` > versão atual (semver) e existir o asset `MesaVirtual-v*-win64.zip`, pergunta: **"Versão X disponível (atual Y). Atualizar agora? [S/n]"**;
   - se sim:
     1. baixa o zip para `%TEMP%` e confere o tamanho com o do asset;
     2. faz **backup** de `state\`;
     3. extrai para `app.new\`;
     4. troca: `app\` → `app.old\` e `app.new\` → `app\`;
     5. reinicia o launcher a partir do novo `app\` (novo processo; o atual sai);
   - em falha em qualquer passo: restaura `app.old\` se a troca já tinha começado, registra no log, avisa "Não foi possível atualizar: <motivo>. Continuando na versão atual." e segue;
   - sem internet ou com erro na API: avisa em uma linha e segue;
   - na inicialização seguinte bem-sucedida, apaga `app.old\`.
3. **Backup diário:** se o último backup tem mais de 24 h, copia `state\` para `backups\<data>`. Mantém os **10** mais recentes.
4. **Servidor:** inicia o `wrangler dev`. Espera responder `GET http://127.0.0.1:<porta>/` com 200 (timeout de 60 s, tentando a cada 500 ms). Se falhar, mostra as últimas 20 linhas do log do servidor e sai com erro.
5. **Túnel:**
   - inicia `cloudflared tunnel --url http://127.0.0.1:<porta> --no-autoupdate`;
   - lê a saída até encontrar a URL `https://<algo>.trycloudflare.com` (regex), com timeout de 60 s;
   - em falha, avisa que a mesa funciona só localmente e mostra o link `http://localhost:<porta>`.
6. **Pronto:** mostra o link em destaque.
   - Copia o link para a área de transferência (`clip.exe`).
   - Abre o navegador padrão no link.
   - Mostra: "Feche esta janela (ou Ctrl+C) para desligar a mesa."
7. **Encerramento:** em Ctrl+C ou ao fechar a janela, encerra o túnel e o servidor (árvore de processos, `taskkill /T /F` no Windows). Se o servidor ou o túnel caírem sozinhos, mostra o aviso e tenta reiniciar **uma vez**.

## 5. Publicação de versões

- **No Linux:** `pnpm release X.Y.Z`. Esse script:
  1. confere que o git está limpo e na `main`;
  2. roda `pnpm typecheck` e `pnpm test`;
  3. grava a versão em `package.json` (raiz) e em `version.txt`;
  4. faz commit `release: vX.Y.Z`, cria a tag `vX.Y.Z` e faz push de commit e tag.
- **GitHub Actions** (`.github/workflows/release.yml`), disparado por tag `v*`, em `windows-latest`:
  1. checkout; Node da versão fixada; `pnpm install --frozen-lockfile`;
  2. `pnpm typecheck` e `pnpm test` (unitários; o e2e não roda no CI);
  3. build do front;
  4. monta `MesaVirtual\`:
     - baixa o Node portátil win-x64 (zip oficial, com checksum conferido);
     - baixa o `cloudflared-windows-amd64.exe` da versão fixada (checksum conferido);
     - copia o servidor com `node_modules` de produção instalado **no próprio runner Windows**, garantindo os binários win-x64 do workerd;
  5. **teste de fumaça:**
     - extrai o zip numa pasta temporária;
     - roda o launcher em modo `--smoke`, que sobe só o servidor, sem túnel e sem atualização;
     - faz `POST /api/tables` e espera 201;
     - encerra;
  6. cria a Release `vX.Y.Z` com o zip anexado e notas geradas a partir dos commits.

## 6. Interface (console)

- Textos em português, uma linha por etapa, com ✓ ou ✗.
- O link final aparece destacado: linha em branco antes e depois, maiúsculo quando possível.
- Flags do launcher, para suporte e testes:
  - `--smoke`: só servidor, sem túnel e sem atualização; sai após o teste;
  - `--no-update`: pula a verificação de atualização;
  - `--port N`: força a porta.

## 7. Erros

| Situação | Comportamento |
|---|---|
| Sem internet ao abrir | Pula a atualização com aviso; o túnel falha → mostra o link local |
| Porta 8787–8797 toda ocupada | Erro claro: "Feche outros programas usando as portas 8787–8797" |
| Download corrompido ou incompleto | Descarta o arquivo, mantém a versão atual e avisa |
| Falha ao trocar `app\` (arquivo em uso) | Restaura `app.old`, avisa e segue na versão atual |
| Servidor não sobe em 60 s | Mostra o fim do log e sai com código de erro |
| Túnel cai durante a sessão | Avisa e tenta reabrir uma vez. **O link novo será diferente:** mostra e copia de novo |
| SmartScreen bloqueia o `.cmd` | Documentado no README: "Mais informações → Executar assim mesmo" |

## 8. Testes

- **Unitários do launcher**, rodando no Linux e no CI:
  - comparação semver;
  - parse da URL do cloudflared;
  - escolha de porta livre;
  - rotação de backups (mantém 10);
  - decisão de backup diário;
  - troca de `app\` com rollback simulado (sistema de arquivos temporário);
  - parse da resposta da API de Releases (asset correto, tag inválida).
- **Teste de fumaça no CI Windows** sobre o zip montado (§5).
- O fluxo real com túnel e atualização é verificado **manualmente** na primeira versão publicada.

## 9. Documentação

O README ganha a seção **"Rodar no Windows (pacote)"**:
- download do zip na página de Releases;
- duplo clique e SmartScreen;
- onde ficam os dados;
- como migrar as mesas do Linux;
- como desligar a atualização automática (`config.json`);
- como restaurar um backup.

## 10. Critério de pronto

1. `pnpm release 0.4.0` no Linux gera, pelo CI, uma Release com o zip.
2. No Windows, extrair o zip e dar dois cliques em "Iniciar Mesa" mostra um link `trycloudflare.com` que funciona do celular no 4G.
3. Publicar a `0.4.1` e abrir o Iniciar Mesa de novo oferece a atualização. Aceitar troca a versão sem perder nenhuma mesa.
