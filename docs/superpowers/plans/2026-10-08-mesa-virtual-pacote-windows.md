# Mesa Virtual — Pacote Windows portátil com atualização automática — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Gerar, a partir de `pnpm release X.Y.Z` no Linux, uma Release no GitHub com `MesaVirtual-vX.Y.Z-win64.zip`. No Windows, dois cliques em "Iniciar Mesa" atualizam o app (com confirmação), fazem backup das mesas, sobem o `wrangler dev` e o Cloudflare Quick Tunnel e entregam o link para o grupo.

**Architecture:** Um launcher em ESM puro (`apps/launcher/src/*.mjs`, sem build) roda no Node portátil do pacote. Os módulos puros (semver, escolha do asset, URL do túnel, portas, backups, troca de `app\`) e a orquestração recebem todos os efeitos colaterais por um objeto `deps` (fs, spawn, fetch, relógio, plataforma, console), então tudo é testado com vitest no Linux. Um script Node (`scripts/build-win-package.mjs`) roda no runner `windows-latest`. Ele pré-empacota o Worker com `wrangler deploy --dry-run`, instala o `wrangler` de produção com `npm` no próprio Windows (para vir o `workerd.exe`), baixa Node e cloudflared com versões e SHA-256 fixados, e monta o zip. O workflow de tag `v*` faz um teste de fumaça (`--smoke`) no zip extraído e publica a Release. A atualização acontece em duas fases (o launcher prepara `app.new\` e sai com 75; o `.cmd` roda a troca a partir de `%TEMP%`), porque o Windows não deixa renomear `app\` com o `node.exe` dela em execução.

**Tech Stack:** Node 24 (portátil 24.12.0 no pacote), ESM `.mjs` só com módulos `node:`, vitest 5 (`@mesa/launcher`), pnpm 12, TypeScript 7 (resto do monorepo), wrangler 4.148.0 / workerd 1.20261006.1, cloudflared 2026.10.0, GitHub Actions (`windows-latest`, `pnpm/action-setup@v4`, `actions/setup-node@v4`, `gh`), PowerShell 7, `tar.exe` do Windows e `7z`.

**Spec:** `docs/superpowers/specs/2026-10-08-mesa-virtual-pacote-windows-design.md` (base: `main` @ 19c5e23; o repositório `joaovictorjtorres/PersonalBoard` já é público, conferido pela API).

**Decisões tomadas onde o spec é omisso (o executor não deve rediscutir):**
- **Launcher sem build:** ESM puro `.mjs`, executado direto pelo `node.exe` portátil. Sem passo de compilação, o que roda no Windows é o mesmo arquivo testado. O pacote `@mesa/launcher` **não tem `typecheck`** (checar JS com TS 7 exigiria `@types/node`, que é dependência nova). A correção vem dos testes. O `pnpm -r --if-present typecheck` simplesmente o pula.
- **Onde moram os testes de build/release:** em `apps/launcher/test/` também (`win-package.test.mjs`, `workflow.test.mjs`, `release-lib.test.mjs`), importando `scripts/…` por caminho relativo. O `pnpm test` da raiz já roda `pnpm -r`, e não é preciso criar outro pacote de workspace.
- **Servidor dentro do pacote (verificado nos `node_modules`):**
  - O Worker é **pré-empacotado** com `pnpm --filter @mesa/worker exec wrangler deploy --dry-run --outdir <dir>`. Rodado aqui, isso gera `index.js` (≈840 KB) + `index.js.map`, com zod e `@mesa/shared` embutidos e `cloudflare:workers` externo. Assim some a dependência `workspace:*`.
  - `app\server\` contém:
    - um `package.json` próprio que depende **só** de `wrangler` na versão exata instalada (`apps/worker/node_modules/wrangler/package.json` → 4.148.0);
    - um `wrangler.jsonc` derivado do original (`main: "worker/index.js"`, `assets.directory: "web"`, sem `$schema`);
    - `web\`, cópia de `apps/web/dist`.
  - A instalação é `npm install --omit=dev` **no runner Windows**. O motivo: `wrangler@4.148.0` depende de `workerd@1.20261006.1`, que resolve o binário por `optionalDependencies` (`"win32 x64 LE": "@cloudflare/workerd-windows-64"` em `node_modules/workerd/lib/main.js`). Só uma instalação feita no Windows traz o `workerd.exe`. O script confere `node_modules/@cloudflare/workerd-windows-64/bin/workerd.exe` e se recusa a rodar fora do Windows.
- **Como o wrangler roda:** `<node.exe portátil> app\server\node_modules\wrangler\bin\wrangler.js dev --ip 127.0.0.1 --port <p> --persist-to <dados>\state [--inspector-port <i>]`, com `cwd` = `app\server`. Não passa por shims `.cmd`. A porta de inspeção é a primeira livre em 9229–9239 (diferente da porta do servidor); se nenhuma estiver livre, a flag é omitida.
- **Atualização em duas fases:**
  1. O launcher baixa o zip para `%TEMP%`, confere o tamanho, faz backup, extrai para `app.new.tmp\` e move `MesaVirtual\app` para `app.new\`.
  2. Em seguida copia o próprio `node.exe` e a pasta `launcher\` para `%TEMP%\MesaVirtual-update\` e sai com **75**.
  3. O `Iniciar Mesa.cmd` roda `%TEMP%\MesaVirtual-update\node.exe …\launcher\launcher.mjs --root "%~dp0." --apply-update`. Esse processo troca `app\`→`app.old\` e `app.new\`→`app\`, com 5 tentativas a cada 500 ms por causa de antivírus e rollback se falhar. Depois o `.cmd` volta ao início e abre o launcher novo.
  - Se a troca falhar, o erro é gravado em `<dados>\update-failed.txt`. O launcher seguinte mostra "Não foi possível atualizar: <motivo>. Continuando na versão atual." e não consulta o GitHub nessa abertura.
  - Se `app\` sumir e existir `app.old\`, o `.cmd` renomeia `app.old` de volta antes de rodar.
  - O **contrato do `.cmd` é congelado**: código 75, pasta `MesaVirtual-update`, `--apply-update`, `--root "%~dp0."`. Versões novas só trocam `app\`.
- **Limpeza:** `app.old\` é apagada depois que o servidor responde, porque aí a inicialização foi bem-sucedida. `app.new\` e `app.new.tmp\` que sobraram de uma tentativa interrompida são apagadas no início.
- **Asset aceito:** exatamente `MesaVirtual-v<versão da tag>-win64.zip`, com `size` > 0. Tags fora de `X.Y.Z`/`vX.Y.Z` (ex.: `v0.5.0-beta`) são ignoradas, e 404 da API (nenhuma Release ainda) conta como "versão mais recente".
- **Resposta `[S/n]`:** Enter, `s`, `sim`, `y` ou `yes` contam como sim; qualquer outra coisa é não. Sem TTY (CI), a resposta é "n".
- **Conferência do download:**
  - O tamanho tem que ser igual ao `size` do asset (spec).
  - Depois de extrair, `MesaVirtual\app\version.txt` tem que ser igual à versão, e `launcher\launcher.mjs` e `node\node.exe` têm que existir.
  - Em qualquer falha, apagam-se o zip, `app.new.tmp\` e `app.new\`.
- **Extração no Windows:** `%SystemRoot%\System32\tar.exe -xf` (é o bsdtar, que lê zip). Se falhar (ex.: caminho com acentos), cai para `powershell.exe -NoProfile -NonInteractive -Command Expand-Archive`. No CI, o zip é montado com `7z`, que já vem no `windows-latest`.
- **Backups:**
  - O backup antes da atualização usa a mesma rotina do diário e conta para os 10.
  - Se `state\` não existir ou estiver vazio, não há o que copiar e `lastBackup` não muda.
  - Nome: `AAAA-MM-DD_HHMMSS` em hora local. Colisão no mesmo segundo vira `-2`, `-3`… A cópia vai para `.<nome>.partial` e é renomeada no fim.
  - A rotação só considera pastas com esse padrão. Pastas e arquivos do usuário ficam intactos.
- **Log:**
  - Um arquivo só, `logs\launcher.log`, com prefixos `[servidor]` e `[túnel]`. A rotação acontece durante a escrita (`launcher.log` → `launcher.1.log` → `launcher.2.log`, até 1 MB cada).
  - As últimas 20 linhas do servidor ficam em memória para o erro de 60 s.
  - `WRANGLER_LOG_PATH=<dados>\logs\wrangler`.
- **`config.json`:**
  - Só `"autoUpdate": false` (booleano) desliga a atualização. Outro tipo gera aviso e vale `true`.
  - JSON inválido gera aviso e usa o padrão, e o arquivo **não é sobrescrito**, para o usuário poder corrigir. Chaves desconhecidas são preservadas.
- **`MESA_DATA_DIR`:** variável de ambiente que troca a pasta de dados. Usada pelo teste de fumaça do CI e pelos testes.
- **Porta livre:** ninguém aceita conexão em `127.0.0.1:<p>` **e** dá para escutar em `127.0.0.1:<p>`. Não escuta em `0.0.0.0`, para não acionar o firewall do Windows.
- **Encerramento e reinício:**
  - Ctrl+C também chega ao wrangler e ao cloudflared, porque estão no mesmo console. Quando um filho sai, o launcher espera **1 s** antes de decidir reiniciar. Se o encerramento começou nesse intervalo, não reinicia.
  - Cada componente reinicia **uma** vez por sessão. Se o servidor cair de novo, o launcher encerra com código 1. Se o túnel cair de novo, mostra e copia o link local e segue.
- **Link destacado:**
  - O título "LINK DA MESA — mande para o grupo:" fica em linha própria, com linha em branco antes e depois. A URL é mostrada como veio (minúsculas): é ela que o usuário copia.
  - O navegador abre só na primeira vez. Um link novo do túnel é mostrado e copiado de novo.
- **Códigos de saída:** 0 normal, 1 erro, 2 argumento inválido, 75 atualização preparada. O `.cmd` pausa quando o código é diferente de 0 e de 75, para a janela não sumir. O `.cmd` só tem ASCII, por causa da codificação do console.
- **Pins:**
  - Node portátil **24.12.0**, a mesma versão do desenvolvimento (`node --version`). SHA-256 de `node-v24.12.0-win-x64.zip` = `9c125f61ae947b52e779095830f9cac267846a043ef7192183c84016aaad2812`, tirado de `https://nodejs.org/dist/v24.12.0/SHASUMS256.txt`.
  - cloudflared **2026.10.0**. SHA-256 de `cloudflared-windows-amd64.exe` = `86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c`, tirado do campo `digest` do asset na API do GitHub.
  - Os dois ficam gravados em `scripts/win-package/lib.mjs`, e o CI usa `node-version: 24.12.0`.
- **Versão:**
  - `version.txt` na raiz e `"version"` no `package.json` raiz, começando em `0.3.0`. O build copia para `app\version.txt`, e a tag tem que bater com `version.txt` (o CI confere).
  - `pnpm release X.Y.Z [--dry-run]` roda o script, sem colisão com comandos do pnpm 12 (conferido). O commit `release: vX.Y.Z` não leva trailer, porque quem publica é o usuário. O push é `git push --atomic origin main vX.Y.Z`.
- **Teste de fumaça no CI:** zip extraído numa pasta **com espaço**, `--smoke --port 18787`, `MESA_DATA_DIR` temporário.

## Global Constraints

- **Git:**
  - Repositório no branch `main`. Cada task termina com **exatamente um** commit `feat(win): Task N — <título>` com o trailer `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>` (use `git commit -m "<assunto>" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"`).
  - Nunca `git push`, nunca `--amend`, nunca criar tags.
  - **Única exceção:** a Task 10. Ela é executada **pelo controlador, depois da revisão final**, roda `pnpm release 0.4.0` (commit `release: v0.4.0` + tag + push) e é o passo de publicação autorizado pelo usuário.
- **Ao fim de cada task:** `pnpm typecheck && pnpm test` verde.
- **Não mexa no servidor do usuário:** há um wrangler do usuário em `:8787` (rodando de `/tmp/.../scratchpad/live`).
  - Nunca rode `pnpm host`, `pnpm dev:*`, `pnpm build`, `pnpm tunnel`, o launcher contra o app real (nem com `--smoke`) ou o `cloudflared`.
  - Nunca mate processos.
  - Nenhum teste escuta a 8787: portas são injetadas, e o único teste real de porta usa a porta 0.
  - Se precisar do bundle do front, use `pnpm build:e2e`.
- **Toolchain:** pnpm 12, Node 24, TypeScript 7, vitest, wrangler 4.148 (`compatibility_date` 2026-08-22), workerd 1.20261006.1. Não troque versões.
  - Única dependência nova no monorepo: `vitest` `^5.0.3` (já está no store) como devDependency de `@mesa/launcher`.
  - O launcher não tem dependências de runtime: só módulos `node:`.
- **Launcher:** só ESM `.mjs`, imports `node:`, sem build. **Todo** efeito colateral passa por `deps` (fs, spawn, fetch, relógio, timers, plataforma, env, console, sinais), para rodar no Linux com fakes.
- **Interface:** textos do console em português, uma linha por etapa, com `✓` (ok), `✗` (falha) ou `…` (em andamento). Identificadores em inglês.
- **Windows:**
  - `taskkill /PID <pid> /T /F` para matar a árvore de processos.
  - `clip.exe` para a área de transferência.
  - `cmd.exe /d /s /c "start "" "<url>""` para abrir o navegador, só com URL validada por regex.
  - Caminhos sempre como argumentos separados de `spawn`, nunca concatenados numa linha de comando.
  - `"Iniciar Mesa.cmd"` com CRLF (`.gitattributes` + conversão no build).
- **Valores do spec (copiados):**
  - Asset `MesaVirtual-vX.Y.Z-win64.zip`.
  - Pacote: `MesaVirtual\Iniciar Mesa.cmd` e `MesaVirtual\app\{node\,server\,cloudflared.exe,launcher\,version.txt}`.
  - Dados em `%LOCALAPPDATA%\MesaVirtual\`, com `state\`, `backups\AAAA-MM-DD_HHMMSS\`, `logs\launcher.log` (até 1 MB, 3 arquivos) e `config.json` (`{ "autoUpdate": true, "lastBackup": "<iso>" }`).
  - API `GET https://api.github.com/repos/joaovictorjtorres/PersonalBoard/releases/latest`, sem autenticação, timeout de 5 s.
  - Prompt **"Versão X disponível (atual Y). Atualizar agora? [S/n]"** e aviso **"Não foi possível atualizar: <motivo>. Continuando na versão atual."**
  - Backup se o último tem mais de 24 h; mantém os **10** mais recentes.
  - Portas 8787 a 8797. Com todas ocupadas, a mensagem é **"Feche outros programas usando as portas 8787–8797"**.
  - Servidor: `wrangler dev --ip 127.0.0.1 --port <porta> --persist-to <dados>\state` com `WRANGLER_SEND_METRICS=false`. Está pronto quando `GET http://127.0.0.1:<porta>/` responde 200: timeout de 60 s, tentando a cada 500 ms. Se falhar, mostra as últimas 20 linhas do log e sai com erro.
  - Túnel: `cloudflared tunnel --url http://127.0.0.1:<porta> --no-autoupdate`. URL `https://<algo>.trycloudflare.com`, timeout de 60 s. Em falha, cai para `http://localhost:<porta>`.
  - Pronto: `clip.exe`, navegador padrão e **"Feche esta janela (ou Ctrl+C) para desligar a mesa."**
  - Encerramento: `taskkill /T /F`. Se um componente cair sozinho, mostra aviso e tenta reiniciar **uma vez**.
  - Flags: `--smoke` (só servidor, sem túnel e sem atualização; sai após o teste), `--no-update`, `--port N`.
  - `pnpm release X.Y.Z`: git limpo e na `main`, `pnpm typecheck` + `pnpm test`, versão em `package.json` e `version.txt`, commit `release: vX.Y.Z`, tag `vX.Y.Z`, push.
  - Workflow `.github/workflows/release.yml`: disparado por tag `v*` em `windows-latest`, checksums conferidos, fumaça com `POST /api/tables` → 201, Release com o zip e notas geradas a partir dos commits.

## Review Focus

1. **Ctrl+C ou fechar a janela:** wrangler e cloudflared recebem o mesmo sinal e podem sair **antes** de o launcher saber do encerramento. O esperado é desligar limpo (código 0), sem "Tentando reiniciar…" e sem processos novos → teste na Task 5 (`Ctrl+C mata os filhos antes do sinal`).
2. **cloudflared imprime `https://api.trycloudflare.com/…`** numa linha de erro, antes da URL real ou no lugar dela. Isso nunca pode virar o link da mesa → testes na Task 1 (`findTunnelUrl`) e na Task 5 (harness emite a linha de API antes da URL).
3. **Pacote e dados em caminho com espaços e acentos** (`C:\Users\João Silva\Downloads\Mesa Virtual\`). Troca de `app\`, backup, argumentos do wrangler e do PowerShell devem funcionar, com o caminho como um argumento só → testes nas Tasks 2 (`swapApp`), 3 (`serverCommand`, `extractZip` com apóstrofo) e 5 (harness em pasta `mesa launcher ção …`), mais o CI extraindo numa pasta com espaço (Task 7).
4. **`config.json` editado à mão errado** (JSON quebrado, `"autoUpdate": "false"` como texto). O esperado: aviso de uma linha, a mesa abre, e o arquivo quebrado não é apagado nem sobrescrito → teste na Task 2 (`config.test.mjs`).
5. **Pasta `backups\` com coisas do usuário** (`minha-copia\`, `leia.txt`, um `.partial` que sobrou). A rotação apaga só backups automáticos antigos e mantém os 10 mais recentes → teste na Task 2 (`backup.test.mjs`).

---

## Mapa de arquivos

```
apps/launcher/                       # NOVO pacote de workspace @mesa/launcher (T1)
  package.json                       # scripts.test = vitest run; devDeps vitest
  vitest.config.mjs
  src/                               # copiado inteiro para MesaVirtual\app\launcher\
    messages.mjs   (T1) MSG: todos os textos do console
    semver.mjs     (T1) parseVersion, normalizeVersion, compareVersions, isNewer, readVersion
    release.mjs    (T1) REPO, LATEST_URL, assetName, pickUpdate
    tunnel-url.mjs (T1) findTunnelUrl
    ports.mjs      (T1) PORT_*, INSPECTOR_*, pickPort, isPortFree
    args.mjs       (T1) ArgError, parseArgs
    config.mjs     (T2) DEFAULT_CONFIG, dataPaths, readConfig, writeConfig
    log.mjs        (T2) createLogger (rotativo), rotateLogs, rotatedName, createTail
    backup.mjs     (T2) backupDue, backupName, backupsToDelete, makeBackup, backupNow
    swap.mjs       (T2) UPDATE_EXIT_CODE, appPaths, renameWithRetry, swapApp, removeLeftovers, removeOldApp
    processes.mjs  (T3) pipeLines, launch, runCommand, killTree, waitForServer, serverCommand, serverEnv,
                        tunnelCommand, copyToClipboard, openBrowser, extractZip, stripAnsi
    update.mjs     (T4) fetchLatestRelease, downloadAsset, stageUpdate, stageSwapper, checkForUpdate,
                        applyUpdate, consumeUpdateFailure, STAGING_DIR_NAME
    main.mjs       (T5) run(deps, opts) — orquestração
    deps.mjs       (T5) createRealDeps(launcherDir)
    launcher.mjs   (T5) ponto de entrada
  test/
    semver|release|tunnel-url|ports|args.test.mjs   (T1)
    config|log|backup|swap.test.mjs                 (T2)
    harness.mjs + processes.test.mjs                (T3)
    update.test.mjs                                 (T4)
    main.test.mjs + entry.test.mjs                  (T5)
    win-package.test.mjs                            (T6)
    workflow.test.mjs                               (T7)
    release-lib.test.mjs                            (T8)
scripts/
  win/Iniciar Mesa.cmd               (T6) ponto de entrada no Windows (CRLF)
  win-package/lib.mjs                (T6) PINS, sha256File, assertSha256, stripJsonComments,
                                          serverWranglerConfig, serverPackageJson, toCrlf
  build-win-package.mjs              (T6) monta dist-win/MesaVirtual + zip (só Windows)
  release-lib.mjs                    (T8) parseReleaseVersion, gitProblems, setPackageVersion
  release.mjs                        (T8) pnpm release X.Y.Z [--dry-run]
.github/workflows/release.yml        (T7)
version.txt                          (T6) "0.3.0"
package.json                         (T6 version + win:package; T8 release)
.gitattributes                       (T6) *.cmd text eol=crlf
.gitignore                           (T6) + dist-win/
README.md                            (T9) seção "Rodar no Windows (pacote)"
```

**Tipos compartilhados (JSDoc; valem para todas as tasks):**

```js
/**
 * @typedef {object} Deps
 * @property {typeof import('node:fs')} fs
 * @property {typeof import('node:child_process').spawn} spawn
 * @property {typeof fetch} fetch
 * @property {() => number} now                      relógio em ms
 * @property {(ms: number) => Promise<void>} sleep
 * @property {(ms: number) => void} sleepSync        usado por renameWithRetry
 * @property {(fn: () => void, ms: number) => () => void} setTimer   devolve o cancelador
 * @property {string} platform                       'win32' | 'linux' | 'darwin'
 * @property {Record<string, string | undefined>} env
 * @property {string} homedir
 * @property {string} tmpdir                         %TEMP% no Windows
 * @property {string} execPath                       node.exe em execução
 * @property {string} launcherDir                    pasta de launcher.mjs
 * @property {(port: number) => Promise<boolean>} isPortFree
 * @property {(question: string) => Promise<string>} ask
 * @property {(line: string) => void} print
 * @property {(handler: () => void) => void} onExitSignal
 *
 * @typedef {{ dataDir: string, stateDir: string, backupsDir: string, logsDir: string,
 *   logFile: string, configFile: string, updateFailedFile: string }} DataPaths
 * @typedef {{ autoUpdate: boolean, lastBackup: string | null, [key: string]: unknown }} Config
 * @typedef {{ write(text: string): void }} Logger
 * @typedef {{ root: string, paths: DataPaths, version: string, config: Config,
 *   configWritable: boolean, log: Logger }} Ctx
 * @typedef {{ version: string, url: string, size: number, name: string }} UpdateAsset
 * @typedef {{ child: import('node:child_process').ChildProcess, exited: Promise<number | null>,
 *   isAlive(): boolean }} ManagedProcess
 * @typedef {{ smoke: boolean, noUpdate: boolean, applyUpdate: boolean,
 *   port: number | undefined, root: string | undefined }} LauncherOptions
 */
```

---
### Task 1: Launcher — pacote e módulos puros (semver, asset, URL do túnel, portas, argumentos, textos)

**Files:**
- Create: `apps/launcher/package.json`, `apps/launcher/vitest.config.mjs`
- Create: `apps/launcher/src/messages.mjs`, `apps/launcher/src/semver.mjs`, `apps/launcher/src/release.mjs`, `apps/launcher/src/tunnel-url.mjs`, `apps/launcher/src/ports.mjs`, `apps/launcher/src/args.mjs`
- Test: `apps/launcher/test/semver.test.mjs`, `apps/launcher/test/release.test.mjs`, `apps/launcher/test/tunnel-url.test.mjs`, `apps/launcher/test/ports.test.mjs`, `apps/launcher/test/args.test.mjs`
- Modify: `pnpm-lock.yaml` (gerado por `pnpm install`)

**Interfaces:**
- Consumes: nada.
- Produces:
  - `MSG` (objeto com todos os textos; ver código) em `messages.mjs`.
  - `parseVersion(text: unknown): [number, number, number] | null`, `normalizeVersion(text: unknown): string | null`, `compareVersions(a: string, b: string): -1 | 0 | 1` (lança em versão inválida), `isNewer(candidate: unknown, current: unknown): boolean`, `readVersion(fs, file: string): string` (`'0.0.0'` se ausente/inválido).
  - `REPO = 'joaovictorjtorres/PersonalBoard'`, `LATEST_URL`, `assetName(version: string): string`, `pickUpdate(release: unknown, currentVersion: string): UpdateAsset | null`.
  - `findTunnelUrl(text: string): string | null`.
  - `PORT_FIRST = 8787`, `PORT_LAST = 8797`, `INSPECTOR_FIRST = 9229`, `INSPECTOR_LAST = 9239`, `pickPort(isFree: (p: number) => Promise<boolean>, { forced?: number, first?: number, last?: number }): Promise<number | null>`, `isPortFree(port: number, host?: string): Promise<boolean>`.
  - `ArgError`, `parseArgs(argv: string[]): LauncherOptions`.

- [ ] **Step 1: Criar o pacote `@mesa/launcher`**

`apps/launcher/package.json`:

```json
{
  "name": "@mesa/launcher",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run"
  },
  "devDependencies": {
    "vitest": "^5.0.3"
  }
}
```

`apps/launcher/vitest.config.mjs`:

```js
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: { include: ['test/**/*.test.mjs'] },
})
```

Run: `pnpm install`
Expected: termina sem erro; `pnpm-lock.yaml` ganha o importer `apps/launcher`.

- [ ] **Step 2: Escrever os testes que falham**

`apps/launcher/test/semver.test.mjs`:

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { compareVersions, isNewer, normalizeVersion, parseVersion, readVersion } from '../src/semver.mjs'

describe('semver', () => {
  it('compara numericamente, não como texto', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBe(1)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
    expect(compareVersions('v0.4.0', '0.4.1')).toBe(-1)
    expect(() => compareVersions('x', '1.0.0')).toThrow('versão inválida')
  })

  it('isNewer só aceita versões X.Y.Z válidas', () => {
    expect(isNewer('v0.5.0', '0.4.0')).toBe(true)
    expect(isNewer('0.4.0', '0.4.0')).toBe(false)
    expect(isNewer('0.3.9', '0.4.0')).toBe(false)
    expect(isNewer('v0.5.0-beta', '0.4.0')).toBe(false)
    expect(isNewer('latest', '0.4.0')).toBe(false)
    expect(isNewer(undefined, '0.4.0')).toBe(false)
    expect(isNewer('0.5.0', 'lixo')).toBe(false)
  })

  it('parseVersion e normalizeVersion', () => {
    expect(parseVersion(' v1.2.3\n')).toEqual([1, 2, 3])
    expect(parseVersion('1.2')).toBeNull()
    expect(parseVersion(42)).toBeNull()
    expect(normalizeVersion('v01.2.3')).toBe('1.2.3')
    expect(normalizeVersion('1.2.3.4')).toBeNull()
  })

  it('readVersion lê version.txt e usa 0.0.0 se faltar ou for inválido', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-semver-'))
    const file = path.join(dir, 'version.txt')
    expect(readVersion(fs, file)).toBe('0.0.0')
    fs.writeFileSync(file, '0.4.0\r\n')
    expect(readVersion(fs, file)).toBe('0.4.0')
    fs.writeFileSync(file, 'lixo')
    expect(readVersion(fs, file)).toBe('0.0.0')
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
```

`apps/launcher/test/release.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { LATEST_URL, assetName, pickUpdate } from '../src/release.mjs'

const asset = (version, extra = {}) => ({
  name: `MesaVirtual-v${version}-win64.zip`,
  size: 1234,
  browser_download_url: `https://github.com/joaovictorjtorres/PersonalBoard/releases/download/v${version}/MesaVirtual-v${version}-win64.zip`,
  ...extra,
})

describe('release', () => {
  it('URL da API e nome do asset', () => {
    expect(LATEST_URL).toBe('https://api.github.com/repos/joaovictorjtorres/PersonalBoard/releases/latest')
    expect(assetName('0.4.0')).toBe('MesaVirtual-v0.4.0-win64.zip')
  })

  it('escolhe o zip da versão nova', () => {
    const release = { tag_name: 'v0.5.0', assets: [{ name: 'Source code.zip', size: 9 }, asset('0.5.0')] }
    expect(pickUpdate(release, '0.4.0')).toEqual({
      version: '0.5.0',
      url: asset('0.5.0').browser_download_url,
      size: 1234,
      name: 'MesaVirtual-v0.5.0-win64.zip',
    })
  })

  it('nada a fazer quando a versão é igual ou mais velha', () => {
    expect(pickUpdate({ tag_name: 'v0.4.0', assets: [asset('0.4.0')] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.3.0', assets: [asset('0.3.0')] }, '0.4.0')).toBeNull()
  })

  it('tag inválida, sem asset ou asset de outra versão → null', () => {
    expect(pickUpdate({ tag_name: 'latest', assets: [asset('0.5.0')] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0-beta', assets: [asset('0.5.0')] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0', assets: [] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0' }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.1', assets: [asset('0.5.0')] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0', assets: [asset('0.5.0', { size: 0 })] }, '0.4.0')).toBeNull()
    expect(pickUpdate({ tag_name: 'v0.5.0', assets: [asset('0.5.0', { browser_download_url: 7 })] }, '0.4.0')).toBeNull()
    expect(pickUpdate(null, '0.4.0')).toBeNull()
    expect(pickUpdate('texto', '0.4.0')).toBeNull()
  })
})
```

`apps/launcher/test/tunnel-url.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { findTunnelUrl } from '../src/tunnel-url.mjs'

describe('findTunnelUrl', () => {
  it('acha a URL na caixa que o cloudflared imprime', () => {
    const line = '2026-10-08T12:00:00Z INF |  https://brave-otter-quiet.trycloudflare.com                              |'
    expect(findTunnelUrl(line)).toBe('https://brave-otter-quiet.trycloudflare.com')
  })

  it('ignora o endereço da API do trycloudflare (linha de erro)', () => {
    expect(findTunnelUrl('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": EOF')).toBeNull()
    expect(
      findTunnelUrl('Post "https://api.trycloudflare.com/tunnel" … depois https://ok-tunnel.trycloudflare.com'),
    ).toBe('https://ok-tunnel.trycloudflare.com')
  })

  it('normaliza para minúsculas e ignora outros domínios', () => {
    expect(findTunnelUrl('HTTPS://ABC-Def.TryCloudflare.com')).toBe('https://abc-def.trycloudflare.com')
    expect(findTunnelUrl('Requesting new quick Tunnel on trycloudflare.com...')).toBeNull()
    expect(findTunnelUrl('https://evil.trycloudflare.com.example.org')).toBeNull()
    expect(findTunnelUrl('')).toBeNull()
  })
})
```

`apps/launcher/test/ports.test.mjs`:

```js
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { PORT_FIRST, PORT_LAST, isPortFree, pickPort } from '../src/ports.mjs'

const freeOnly = (...ports) => async (p) => ports.includes(p)

describe('pickPort', () => {
  it('usa 8787 quando está livre', async () => {
    expect(await pickPort(freeOnly(8787, 8788))).toBe(8787)
  })

  it('pula as ocupadas e para em 8797', async () => {
    const asked = []
    const isFree = async (p) => { asked.push(p); return p === 8790 }
    expect(await pickPort(isFree)).toBe(8790)
    expect(asked).toEqual([8787, 8788, 8789, 8790])
    expect(await pickPort(freeOnly(8798))).toBeNull()
    expect([PORT_FIRST, PORT_LAST]).toEqual([8787, 8797])
  })

  it('--port força a porta: livre → ela; ocupada → null', async () => {
    expect(await pickPort(freeOnly(9000), { forced: 9000 })).toBe(9000)
    expect(await pickPort(freeOnly(8787), { forced: 9000 })).toBeNull()
  })

  it('isPortFree enxerga uma porta em uso de verdade (porta efêmera, nunca 8787)', async () => {
    const server = net.createServer()
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address()
    expect(await isPortFree(port)).toBe(false)
    await new Promise((resolve) => server.close(resolve))
    expect(await isPortFree(port)).toBe(true)
  })
})
```

`apps/launcher/test/args.test.mjs`:

```js
import { describe, expect, it } from 'vitest'
import { ArgError, parseArgs } from '../src/args.mjs'

describe('parseArgs', () => {
  it('padrões', () => {
    expect(parseArgs([])).toEqual({ smoke: false, noUpdate: false, applyUpdate: false, port: undefined, root: undefined })
  })

  it('flags e valores (separados ou com =)', () => {
    expect(parseArgs(['--smoke', '--port', '18787', '--root', 'C:\\Mesa Virtual\\.'])).toEqual({
      smoke: true, noUpdate: false, applyUpdate: false, port: 18787, root: 'C:\\Mesa Virtual\\.',
    })
    expect(parseArgs(['--no-update', '--port=8790', '--apply-update'])).toMatchObject({
      noUpdate: true, port: 8790, applyUpdate: true,
    })
  })

  it('erros claros', () => {
    expect(() => parseArgs(['--port'])).toThrow(ArgError)
    expect(() => parseArgs(['--port', 'abc'])).toThrow('porta inválida: abc')
    expect(() => parseArgs(['--port', '70000'])).toThrow('porta inválida')
    expect(() => parseArgs(['--root'])).toThrow('--root precisa de um valor')
    expect(() => parseArgs(['--turbo'])).toThrow('opção desconhecida: --turbo')
  })
})
```

- [ ] **Step 3: Rodar os testes e ver falhar**

Run: `pnpm --filter @mesa/launcher test`
Expected: FAIL — `Failed to load url ../src/semver.mjs` (e equivalentes para os outros módulos).

- [ ] **Step 4: Implementar os módulos**

`apps/launcher/src/messages.mjs`:

```js
// Todos os textos do console. Uma linha por etapa: ✓ ok, ✗ falha, … em andamento.
export const MSG = {
  header: (version) => `Mesa Virtual v${version}`,
  configWarning: (text) => `✗ config.json: ${text}.`,
  updateSkippedFlag: '… Verificação de atualização pulada (--no-update).',
  updateDisabled: '… Atualização automática desligada (config.json).',
  updateCheckFailed: (reason) => `✗ Não foi possível verificar atualizações (${reason}). Seguindo assim mesmo.`,
  upToDate: '✓ Você está na versão mais recente.',
  updateAvailable: (latest, current) => `Versão ${latest} disponível (atual ${current}). Atualizar agora? [S/n] `,
  updateDeclined: '… Atualização adiada. Seguindo na versão atual.',
  updateDownloading: (version, mb) => `… Baixando a versão ${version} (${mb} MB)…`,
  updateReady: (version) => `✓ Versão ${version} baixada. Reiniciando para instalar…`,
  updateApplied: '✓ Atualização instalada.',
  updateFailed: (reason) => `✗ Não foi possível atualizar: ${reason}. Continuando na versão atual.`,
  backupDone: (name) => `✓ Backup das mesas: backups\\${name}`,
  backupFailed: (reason) => `✗ Não foi possível fazer o backup das mesas (${reason}). Seguindo assim mesmo.`,
  portsBusy: '✗ Feche outros programas usando as portas 8787–8797 e abra a mesa de novo.',
  portBusy: (port) => `✗ A porta ${port} está ocupada.`,
  serverStarting: (port) => `… Iniciando o servidor (porta ${port})…`,
  serverReady: '✓ Servidor no ar.',
  serverFailed: '✗ O servidor não respondeu em 60 s. Últimas linhas do log:',
  serverCrashed: '✗ O servidor parou. Tentando reiniciar…',
  serverGaveUp: '✗ O servidor parou de novo. Desligando a mesa.',
  tunnelStarting: '… Abrindo o túnel da Cloudflare…',
  tunnelReady: '✓ Túnel aberto.',
  tunnelFailed: '✗ Não foi possível abrir o túnel. A mesa funciona só neste computador.',
  tunnelCrashed: '✗ O túnel caiu. Reabrindo… (o link vai mudar)',
  tunnelGaveUp: '✗ O túnel caiu de novo. A mesa continua só neste computador.',
  linkTitle: 'LINK DA MESA — mande para o grupo:',
  copied: '✓ Link copiado para a área de transferência.',
  closeHint: 'Feche esta janela (ou Ctrl+C) para desligar a mesa.',
  shuttingDown: '… Desligando a mesa…',
  bye: '✓ Mesa desligada.',
  smokeOk: '✓ Teste de fumaça: mesa criada (201).',
  smokeFailed: (reason) => `✗ Teste de fumaça falhou: ${reason}`,
}
```

`apps/launcher/src/semver.mjs`:

```js
const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)$/

/** @param {unknown} text @returns {[number, number, number] | null} */
export function parseVersion(text) {
  if (typeof text !== 'string') return null
  const match = VERSION_RE.exec(text.trim())
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

/** @param {unknown} text @returns {string | null} "X.Y.Z" sem "v" */
export function normalizeVersion(text) {
  const parts = parseVersion(text)
  return parts ? parts.join('.') : null
}

/** @param {string} a @param {string} b @returns {-1 | 0 | 1} */
export function compareVersions(a, b) {
  const pa = parseVersion(a)
  const pb = parseVersion(b)
  if (!pa || !pb) throw new Error(`versão inválida: ${pa ? b : a}`)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1
  }
  return 0
}

/** @param {unknown} candidate @param {unknown} current */
export function isNewer(candidate, current) {
  if (!parseVersion(candidate) || !parseVersion(current)) return false
  return compareVersions(/** @type {string} */ (candidate), /** @type {string} */ (current)) > 0
}

/** Lê version.txt; ausente ou inválido → '0.0.0'. */
export function readVersion(fs, file) {
  try {
    return normalizeVersion(fs.readFileSync(file, 'utf8')) ?? '0.0.0'
  } catch {
    return '0.0.0'
  }
}
```

`apps/launcher/src/release.mjs`:

```js
import { isNewer, normalizeVersion } from './semver.mjs'

export const REPO = 'joaovictorjtorres/PersonalBoard'
export const LATEST_URL = `https://api.github.com/repos/${REPO}/releases/latest`

/** @param {string} version "X.Y.Z" */
export function assetName(version) {
  return `MesaVirtual-v${version}-win64.zip`
}

/**
 * Resposta de GET /releases/latest → asset da atualização, ou null se não há o que fazer.
 * @param {unknown} release
 * @param {string} currentVersion
 * @returns {import('./main.mjs').UpdateAsset | null}
 */
export function pickUpdate(release, currentVersion) {
  if (!release || typeof release !== 'object') return null
  const version = normalizeVersion(/** @type {any} */ (release).tag_name)
  if (!version || !isNewer(version, currentVersion)) return null
  const assets = /** @type {any} */ (release).assets
  if (!Array.isArray(assets)) return null
  const name = assetName(version)
  const asset = assets.find((a) => a && a.name === name)
  if (!asset) return null
  if (typeof asset.browser_download_url !== 'string') return null
  if (!Number.isInteger(asset.size) || asset.size <= 0) return null
  return { version, url: asset.browser_download_url, size: asset.size, name }
}
```

`apps/launcher/src/tunnel-url.mjs`:

```js
const TUNNEL_URL_RE = /https:\/\/([a-z0-9-]+)\.trycloudflare\.com(?![a-z0-9.-])/gi

/** Primeira URL de Quick Tunnel no texto, ignorando api.trycloudflare.com. */
export function findTunnelUrl(text) {
  for (const match of String(text).matchAll(TUNNEL_URL_RE)) {
    const sub = match[1].toLowerCase()
    if (sub === 'api') continue
    return `https://${sub}.trycloudflare.com`
  }
  return null
}
```

`apps/launcher/src/ports.mjs`:

```js
import net from 'node:net'

export const PORT_FIRST = 8787
export const PORT_LAST = 8797
export const INSPECTOR_FIRST = 9229
export const INSPECTOR_LAST = 9239

/**
 * @param {(port: number) => Promise<boolean>} isFree
 * @param {{ forced?: number, first?: number, last?: number }} [options]
 * @returns {Promise<number | null>}
 */
export async function pickPort(isFree, { forced, first = PORT_FIRST, last = PORT_LAST } = {}) {
  if (forced !== undefined) return (await isFree(forced)) ? forced : null
  for (let port = first; port <= last; port++) {
    if (await isFree(port)) return port
  }
  return null
}

/** Livre = ninguém aceita conexão em host:port E dá para escutar em host:port. */
export function isPortFree(port, host = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host })
    let settled = false
    const tryListen = () => {
      if (settled) return
      settled = true
      socket.destroy()
      const server = net.createServer()
      server.once('error', () => resolve(false))
      server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)))
    }
    socket.setTimeout(500)
    socket.once('connect', () => {
      settled = true
      socket.destroy()
      resolve(false)
    })
    socket.once('error', tryListen)
    socket.once('timeout', tryListen)
  })
}
```

`apps/launcher/src/args.mjs`:

```js
export class ArgError extends Error {}

/** @param {string[]} argv @returns {import('./main.mjs').LauncherOptions} */
export function parseArgs(argv) {
  const opts = { smoke: false, noUpdate: false, applyUpdate: false, port: undefined, root: undefined }
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i]
    const eq = raw.startsWith('--') ? raw.indexOf('=') : -1
    const flag = eq > 0 ? raw.slice(0, eq) : raw
    const inline = eq > 0 ? raw.slice(eq + 1) : undefined
    switch (flag) {
      case '--smoke':
        opts.smoke = true
        break
      case '--no-update':
        opts.noUpdate = true
        break
      case '--apply-update':
        opts.applyUpdate = true
        break
      case '--port':
      case '--root': {
        const value = inline ?? argv[++i]
        if (value === undefined || value === '') throw new ArgError(`${flag} precisa de um valor`)
        if (flag === '--root') {
          opts.root = value
          break
        }
        const port = Number(value)
        if (!Number.isInteger(port) || port < 1 || port > 65535) throw new ArgError(`porta inválida: ${value}`)
        opts.port = port
        break
      }
      default:
        throw new ArgError(`opção desconhecida: ${raw}`)
    }
  }
  return opts
}
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @mesa/launcher test`
Expected: PASS (5 arquivos).

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/launcher pnpm-lock.yaml
git commit -m "feat(win): Task 1 — launcher: pacote e módulos puros" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Launcher — dados do usuário (config, log rotativo, backups, troca de `app\`)

**Files:**
- Create: `apps/launcher/src/config.mjs`, `apps/launcher/src/log.mjs`, `apps/launcher/src/backup.mjs`, `apps/launcher/src/swap.mjs`
- Test: `apps/launcher/test/config.test.mjs`, `apps/launcher/test/log.test.mjs`, `apps/launcher/test/backup.test.mjs`, `apps/launcher/test/swap.test.mjs`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces:
  - `DEFAULT_CONFIG`, `dataPaths(env, homedir): DataPaths`, `readConfig(fs, file): { config: Config, warnings: string[], writable: boolean }`, `writeConfig(fs, file, config): void` (escrita atômica via `.tmp`).
  - `LOG_MAX_BYTES = 1048576`, `LOG_FILES = 3`, `rotatedName(file, index): string`, `rotateLogs(fs, file, maxFiles?)`, `createLogger(fs, file, { maxBytes?, maxFiles?, now? }): Logger`, `createTail(max): { push(line: string): void, lines(): string[] }`.
  - `KEEP_BACKUPS = 10`, `BACKUP_INTERVAL_MS`, `backupDue(lastBackupIso: unknown, nowMs: number): boolean`, `backupName(date: Date): string`, `backupsToDelete(names: string[], keep?): string[]`, `makeBackup(fs, { stateDir, backupsDir, date, keep? }): string | null`, `backupNow(deps, ctx): string | null` (atualiza `ctx.config.lastBackup` e grava se `ctx.configWritable`).
  - `UPDATE_EXIT_CODE = 75`, `appPaths(root): { app, appNew, appNewTmp, appOld }`, `renameWithRetry(fs, from, to, { attempts?, delayMs?, sleepSync? })`, `swapApp(fs, root, retryOptions?)` (lança `Error` com motivo em português), `removeLeftovers(fs, root)`, `removeOldApp(fs, root): boolean`.

- [ ] **Step 1: Escrever os testes que falham**

`apps/launcher/test/config.test.mjs`:

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_CONFIG, dataPaths, readConfig, writeConfig } from '../src/config.mjs'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa config ç ')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('dataPaths', () => {
  it('usa %LOCALAPPDATA%\\MesaVirtual', () => {
    const p = dataPaths({ LOCALAPPDATA: path.join(dir, 'Local') }, '/home/x')
    expect(p.dataDir).toBe(path.join(dir, 'Local', 'MesaVirtual'))
    expect(p.stateDir).toBe(path.join(p.dataDir, 'state'))
    expect(p.backupsDir).toBe(path.join(p.dataDir, 'backups'))
    expect(p.logFile).toBe(path.join(p.dataDir, 'logs', 'launcher.log'))
    expect(p.configFile).toBe(path.join(p.dataDir, 'config.json'))
    expect(p.updateFailedFile).toBe(path.join(p.dataDir, 'update-failed.txt'))
  })

  it('sem LOCALAPPDATA cai em <home>/AppData/Local; MESA_DATA_DIR tem prioridade', () => {
    expect(dataPaths({}, dir).dataDir).toBe(path.join(dir, 'AppData', 'Local', 'MesaVirtual'))
    expect(dataPaths({ MESA_DATA_DIR: path.join(dir, 'dados') }, '/x').dataDir).toBe(path.join(dir, 'dados'))
  })
})

describe('readConfig / writeConfig', () => {
  const file = () => path.join(dir, 'config.json')

  it('arquivo ausente → padrão, sem aviso, pode gravar', () => {
    expect(readConfig(fs, file())).toEqual({ config: { ...DEFAULT_CONFIG }, warnings: [], writable: true })
    expect(DEFAULT_CONFIG).toEqual({ autoUpdate: true, lastBackup: null })
  })

  it('lê autoUpdate false e lastBackup, preservando chaves desconhecidas na gravação', () => {
    fs.writeFileSync(file(), JSON.stringify({ autoUpdate: false, lastBackup: '2026-10-08T12:00:00.000Z', tema: 'escuro' }))
    const { config, warnings } = readConfig(fs, file())
    expect(warnings).toEqual([])
    expect(config).toMatchObject({ autoUpdate: false, lastBackup: '2026-10-08T12:00:00.000Z', tema: 'escuro' })
    writeConfig(fs, file(), { ...config, lastBackup: '2026-10-09T00:00:00.000Z' })
    expect(JSON.parse(fs.readFileSync(file(), 'utf8'))).toEqual({
      autoUpdate: false, lastBackup: '2026-10-09T00:00:00.000Z', tema: 'escuro',
    })
    expect(fs.existsSync(`${file()}.tmp`)).toBe(false)
  })

  it('Review Focus 4: JSON quebrado → aviso, padrão e não sobrescreve', () => {
    fs.writeFileSync(file(), '{ "autoUpdate": false, }}')
    const result = readConfig(fs, file())
    expect(result.config).toEqual({ ...DEFAULT_CONFIG })
    expect(result.writable).toBe(false)
    expect(result.warnings).toEqual(['arquivo inválido; usando o padrão (o arquivo não foi alterado)'])
  })

  it('Review Focus 4: "autoUpdate": "false" (texto) → aviso e true; lastBackup inválido → null', () => {
    fs.writeFileSync(file(), JSON.stringify({ autoUpdate: 'false', lastBackup: 'ontem' }))
    const result = readConfig(fs, file())
    expect(result.config.autoUpdate).toBe(true)
    expect(result.config.lastBackup).toBeNull()
    expect(result.writable).toBe(true)
    expect(result.warnings).toEqual(['"autoUpdate" deve ser true ou false (sem aspas); usando true'])
  })

  it('JSON que não é objeto → aviso e não sobrescreve', () => {
    fs.writeFileSync(file(), '[1,2]')
    expect(readConfig(fs, file())).toMatchObject({ writable: false, warnings: [expect.stringContaining('inválido')] })
  })
})
```

`apps/launcher/test/log.test.mjs`:

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOG_FILES, LOG_MAX_BYTES, createLogger, createTail, rotatedName } from '../src/log.mjs'

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-log-')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('log rotativo', () => {
  it('limites do spec', () => {
    expect(LOG_MAX_BYTES).toBe(1024 * 1024)
    expect(LOG_FILES).toBe(3)
    expect(rotatedName('/x/launcher.log', 0)).toBe('/x/launcher.log')
    expect(rotatedName('/x/launcher.log', 2)).toBe('/x/launcher.2.log')
  })

  it('gira ao passar do tamanho e guarda no máximo 3 arquivos', () => {
    const file = path.join(dir, 'logs', 'launcher.log')
    const log = createLogger(fs, file, { maxBytes: 100, now: () => Date.parse('2026-10-08T12:00:00Z') })
    for (let i = 0; i < 20; i++) log.write(`linha ${String(i).padStart(2, '0')}`)
    expect(fs.existsSync(file)).toBe(true)
    expect(fs.existsSync(rotatedName(file, 1))).toBe(true)
    expect(fs.existsSync(rotatedName(file, 2))).toBe(true)
    expect(fs.existsSync(rotatedName(file, 3))).toBe(false)
    for (const i of [0, 1, 2]) expect(fs.statSync(rotatedName(file, i)).size).toBeLessThanOrEqual(100)
    expect(fs.readFileSync(file, 'utf8')).toContain('2026-10-08T12:00:00.000Z linha 19')
  })

  it('continua do tamanho que o arquivo já tinha', () => {
    const file = path.join(dir, 'launcher.log')
    fs.writeFileSync(file, 'x'.repeat(95))
    createLogger(fs, file, { maxBytes: 100 }).write('nova')
    expect(fs.readFileSync(rotatedName(file, 1), 'utf8')).toBe('x'.repeat(95))
  })

  it('createTail guarda só as últimas N linhas', () => {
    const tail = createTail(3)
    for (const l of ['a', 'b', 'c', 'd']) tail.push(l)
    expect(tail.lines()).toEqual(['b', 'c', 'd'])
  })
})
```

`apps/launcher/test/backup.test.mjs`:

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { KEEP_BACKUPS, backupDue, backupName, backupNow, backupsToDelete, makeBackup } from '../src/backup.mjs'

const HOUR = 60 * 60 * 1000
const NOW = Date.parse('2026-10-08T12:00:00Z')

let dir
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa backup João ')) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

function makeState() {
  const stateDir = path.join(dir, 'state')
  fs.mkdirSync(path.join(stateDir, 'v3', 'do'), { recursive: true })
  fs.writeFileSync(path.join(stateDir, 'v3', 'do', 'mesa.sqlite'), 'dados')
  return stateDir
}

describe('backupDue', () => {
  it('decide o backup diário', () => {
    expect(backupDue(null, NOW)).toBe(true)
    expect(backupDue('lixo', NOW)).toBe(true)
    expect(backupDue(new Date(NOW - 23 * HOUR).toISOString(), NOW)).toBe(false)
    expect(backupDue(new Date(NOW - 25 * HOUR).toISOString(), NOW)).toBe(true)
    expect(backupDue(new Date(NOW + 2 * HOUR).toISOString(), NOW)).toBe(true) // relógio voltou
  })
})

describe('backupName / backupsToDelete', () => {
  it('nome em hora local AAAA-MM-DD_HHMMSS', () => {
    expect(backupName(new Date(2026, 9, 8, 7, 5, 9))).toBe('2026-10-08_070509')
  })

  it('apaga só os automáticos mais antigos além de 10', () => {
    const names = Array.from({ length: 12 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}_120000`)
    expect(KEEP_BACKUPS).toBe(10)
    expect(backupsToDelete([...names, 'minha-copia', 'leia.txt'])).toEqual(['2026-09-01_120000', '2026-09-02_120000'])
    expect(backupsToDelete(['2026-09-01_120000-10', '2026-09-01_120000-2', '2026-09-01_120000'], 1)).toEqual([
      '2026-09-01_120000', '2026-09-01_120000-2',
    ])
  })
})

describe('makeBackup', () => {
  it('copia state\\ para backups\\<nome> (conteúdo aninhado)', () => {
    const stateDir = makeState()
    const backupsDir = path.join(dir, 'backups')
    const name = makeBackup(fs, { stateDir, backupsDir, date: new Date(2026, 9, 8, 12, 0, 0) })
    expect(name).toBe('2026-10-08_120000')
    expect(fs.readFileSync(path.join(backupsDir, name, 'v3', 'do', 'mesa.sqlite'), 'utf8')).toBe('dados')
    expect(fs.readdirSync(backupsDir)).toEqual([name])
  })

  it('state ausente ou vazio → null, nada criado', () => {
    const backupsDir = path.join(dir, 'backups')
    expect(makeBackup(fs, { stateDir: path.join(dir, 'state'), backupsDir, date: new Date() })).toBeNull()
    fs.mkdirSync(path.join(dir, 'state'))
    expect(makeBackup(fs, { stateDir: path.join(dir, 'state'), backupsDir, date: new Date() })).toBeNull()
    expect(fs.existsSync(backupsDir)).toBe(false)
  })

  it('mesmo segundo → sufixo -2', () => {
    const stateDir = makeState()
    const backupsDir = path.join(dir, 'backups')
    const date = new Date(2026, 9, 8, 12, 0, 0)
    makeBackup(fs, { stateDir, backupsDir, date })
    expect(makeBackup(fs, { stateDir, backupsDir, date })).toBe('2026-10-08_120000-2')
  })

  it('Review Focus 5: mantém 10 automáticos e nunca apaga coisas do usuário', () => {
    const stateDir = makeState()
    const backupsDir = path.join(dir, 'backups')
    for (let i = 1; i <= 11; i++) fs.mkdirSync(path.join(backupsDir, `2026-09-${String(i).padStart(2, '0')}_120000`), { recursive: true })
    fs.mkdirSync(path.join(backupsDir, 'minha-copia'))
    fs.writeFileSync(path.join(backupsDir, 'leia.txt'), 'oi')
    fs.mkdirSync(path.join(backupsDir, '.2026-09-30_120000.partial'))
    const name = makeBackup(fs, { stateDir, backupsDir, date: new Date(2026, 9, 8, 12, 0, 0) })
    const left = fs.readdirSync(backupsDir).sort()
    expect(left.filter((n) => /^\d{4}-/.test(n))).toHaveLength(10)
    expect(left).toContain(name)
    expect(left).not.toContain('2026-09-01_120000')
    expect(left).not.toContain('2026-09-02_120000')
    expect(left).toContain('minha-copia')
    expect(left).toContain('leia.txt')
    expect(left.some((n) => n.endsWith('.partial'))).toBe(false)
  })
})

describe('backupNow', () => {
  it('atualiza lastBackup e grava o config só quando pode', () => {
    makeState()
    const configFile = path.join(dir, 'config.json')
    const ctx = {
      paths: { stateDir: path.join(dir, 'state'), backupsDir: path.join(dir, 'backups'), configFile },
      config: { autoUpdate: true, lastBackup: null },
      configWritable: true,
    }
    const deps = { fs, now: () => NOW }
    expect(backupNow(deps, ctx)).toMatch(/^\d{4}-\d{2}-\d{2}_\d{6}$/)
    expect(ctx.config.lastBackup).toBe(new Date(NOW).toISOString())
    expect(JSON.parse(fs.readFileSync(configFile, 'utf8')).lastBackup).toBe(new Date(NOW).toISOString())

    fs.rmSync(configFile)
    ctx.configWritable = false
    expect(backupNow(deps, ctx)).not.toBeNull()
    expect(fs.existsSync(configFile)).toBe(false)
  })
})
```

`apps/launcher/test/swap.test.mjs`:

```js
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { UPDATE_EXIT_CODE, appPaths, removeLeftovers, removeOldApp, renameWithRetry, swapApp } from '../src/swap.mjs'

let base
let root
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa swap '))
  root = path.join(base, 'Downloads do João Silva', 'Mesa Virtual')
  writeApp(path.join(root, 'app'), '0.4.0')
  writeApp(path.join(root, 'app.new'), '0.5.0')
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

function writeApp(dir, version) {
  fs.mkdirSync(path.join(dir, 'launcher'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'version.txt'), version)
  fs.writeFileSync(path.join(dir, 'launcher', 'launcher.mjs'), '//')
}
const versionOf = (dir) => fs.readFileSync(path.join(dir, 'version.txt'), 'utf8')
const noSleep = { sleepSync: () => {} }

/** fs que falha no rename de número `failOn` (1 = app→app.old, 2 = app.new→app). */
function flakyFs(failOn, times = Infinity) {
  let calls = 0
  let failures = 0
  return {
    ...fs,
    renameSync(from, to) {
      calls++
      if (calls >= failOn && failures < times) {
        failures++
        throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
      }
      return fs.renameSync(from, to)
    },
  }
}

describe('swapApp', () => {
  it('troca app → app.old e app.new → app (caminho com espaços e acentos)', () => {
    expect(UPDATE_EXIT_CODE).toBe(75)
    const p = appPaths(root)
    swapApp(fs, root, noSleep)
    expect(versionOf(p.app)).toBe('0.5.0')
    expect(versionOf(p.appOld)).toBe('0.4.0')
    expect(fs.existsSync(p.appNew)).toBe(false)
  })

  it('app.old antigo é substituído', () => {
    writeApp(path.join(root, 'app.old'), '0.3.0')
    swapApp(fs, root, noSleep)
    expect(versionOf(appPaths(root).appOld)).toBe('0.4.0')
  })

  it('falha no segundo rename → restaura app e avisa "arquivo em uso"', () => {
    const p = appPaths(root)
    const flaky = flakyFs(2, 5) // app→app.old ok; app.new→app falha 5x; restauração ok
    expect(() => swapApp(flaky, root, noSleep)).toThrow('arquivo em uso ao trocar a pasta app')
    expect(versionOf(p.app)).toBe('0.4.0')
    expect(fs.existsSync(p.appOld)).toBe(false)
    expect(versionOf(p.appNew)).toBe('0.5.0')
  })

  it('falha no primeiro rename → nada muda', () => {
    expect(() => swapApp(flakyFs(1), root, noSleep)).toThrow('EBUSY')
    expect(versionOf(appPaths(root).app)).toBe('0.4.0')
  })

  it('restauração também falha → mensagem aponta app.old', () => {
    expect(() => swapApp(flakyFs(2), root, noSleep)).toThrow('a versão anterior está em app.old')
  })

  it('app.new incompleto → recusa sem tocar em nada', () => {
    fs.rmSync(path.join(root, 'app.new', 'launcher'), { recursive: true })
    expect(() => swapApp(fs, root, noSleep)).toThrow('a versão nova está incompleta')
    expect(versionOf(appPaths(root).app)).toBe('0.4.0')
  })
})

describe('renameWithRetry', () => {
  it('tenta de novo após falha temporária (antivírus)', () => {
    const waits = []
    const from = path.join(base, 'a')
    fs.mkdirSync(from)
    renameWithRetry(flakyFs(1, 2), from, path.join(base, 'b'), { attempts: 5, delayMs: 500, sleepSync: (ms) => waits.push(ms) })
    expect(fs.existsSync(path.join(base, 'b'))).toBe(true)
    expect(waits).toEqual([500, 500])
  })
})

describe('limpeza', () => {
  it('removeLeftovers apaga app.new e app.new.tmp; removeOldApp apaga app.old', () => {
    const p = appPaths(root)
    fs.mkdirSync(p.appNewTmp)
    removeLeftovers(fs, root)
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(fs.existsSync(p.appNewTmp)).toBe(false)
    expect(removeOldApp(fs, root)).toBe(false)
    writeApp(p.appOld, '0.3.0')
    expect(removeOldApp(fs, root)).toBe(true)
    expect(fs.existsSync(p.appOld)).toBe(false)
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @mesa/launcher test`
Expected: FAIL — `Failed to load url ../src/config.mjs` (e `log`, `backup`, `swap`).

- [ ] **Step 3: Implementar os módulos**

`apps/launcher/src/config.mjs`:

```js
import path from 'node:path'

export const DEFAULT_CONFIG = Object.freeze({ autoUpdate: true, lastBackup: null })

/** @returns {import('./main.mjs').DataPaths} */
export function dataPaths(env, homedir) {
  const localAppData = env.LOCALAPPDATA || path.join(homedir, 'AppData', 'Local')
  const dataDir = env.MESA_DATA_DIR ? path.resolve(env.MESA_DATA_DIR) : path.join(localAppData, 'MesaVirtual')
  return {
    dataDir,
    stateDir: path.join(dataDir, 'state'),
    backupsDir: path.join(dataDir, 'backups'),
    logsDir: path.join(dataDir, 'logs'),
    logFile: path.join(dataDir, 'logs', 'launcher.log'),
    configFile: path.join(dataDir, 'config.json'),
    updateFailedFile: path.join(dataDir, 'update-failed.txt'),
  }
}

const INVALID_FILE = 'arquivo inválido; usando o padrão (o arquivo não foi alterado)'

/** @returns {{ config: import('./main.mjs').Config, warnings: string[], writable: boolean }} */
export function readConfig(fs, file) {
  let raw
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch {
    return { config: { ...DEFAULT_CONFIG }, warnings: [], writable: true }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { config: { ...DEFAULT_CONFIG }, warnings: [INVALID_FILE], writable: false }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: { ...DEFAULT_CONFIG }, warnings: [INVALID_FILE], writable: false }
  }
  const warnings = []
  const config = { ...parsed, autoUpdate: true, lastBackup: null }
  if (typeof parsed.autoUpdate === 'boolean') config.autoUpdate = parsed.autoUpdate
  else if (parsed.autoUpdate !== undefined) warnings.push('"autoUpdate" deve ser true ou false (sem aspas); usando true')
  if (typeof parsed.lastBackup === 'string' && !Number.isNaN(Date.parse(parsed.lastBackup))) {
    config.lastBackup = parsed.lastBackup
  }
  return { config, warnings, writable: true }
}

export function writeConfig(fs, file, config) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(config, null, 2)}\n`)
  fs.renameSync(tmp, file)
}
```

`apps/launcher/src/log.mjs`:

```js
import path from 'node:path'

export const LOG_MAX_BYTES = 1024 * 1024
export const LOG_FILES = 3

/** launcher.log (0), launcher.1.log (1), launcher.2.log (2)… */
export function rotatedName(file, index) {
  if (index === 0) return file
  const ext = path.extname(file)
  return `${file.slice(0, file.length - ext.length)}.${index}${ext}`
}

export function rotateLogs(fs, file, maxFiles = LOG_FILES) {
  fs.rmSync(rotatedName(file, maxFiles - 1), { force: true })
  for (let i = maxFiles - 2; i >= 0; i--) {
    const from = rotatedName(file, i)
    if (fs.existsSync(from)) fs.renameSync(from, rotatedName(file, i + 1))
  }
}

/** @returns {import('./main.mjs').Logger} — nunca lança: log não pode derrubar o launcher. */
export function createLogger(fs, file, { maxBytes = LOG_MAX_BYTES, maxFiles = LOG_FILES, now = () => Date.now() } = {}) {
  let size = 0
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    size = fs.existsSync(file) ? fs.statSync(file).size : 0
  } catch {
    // sem pasta de log: write() vai falhar em silêncio
  }
  return {
    write(text) {
      const line = `${new Date(now()).toISOString()} ${text}\n`
      const bytes = Buffer.byteLength(line)
      try {
        if (size > 0 && size + bytes > maxBytes) {
          rotateLogs(fs, file, maxFiles)
          size = 0
        }
        fs.appendFileSync(file, line)
        size += bytes
      } catch {
        // ignora
      }
    },
  }
}

export function createTail(max) {
  const lines = []
  return {
    push(line) {
      lines.push(line)
      if (lines.length > max) lines.shift()
    },
    lines: () => [...lines],
  }
}
```

`apps/launcher/src/backup.mjs`:

```js
import path from 'node:path'
import { writeConfig } from './config.mjs'

export const KEEP_BACKUPS = 10
export const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000
const BACKUP_NAME_RE = /^(\d{4}-\d{2}-\d{2}_\d{6})(?:-(\d+))?$/

export function backupDue(lastBackupIso, nowMs) {
  if (typeof lastBackupIso !== 'string') return true
  const last = Date.parse(lastBackupIso)
  if (Number.isNaN(last) || last > nowMs) return true
  return nowMs - last > BACKUP_INTERVAL_MS
}

const pad = (n) => String(n).padStart(2, '0')

/** Hora local: AAAA-MM-DD_HHMMSS */
export function backupName(date) {
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
    `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  )
}

function compareBackupNames(a, b) {
  const ma = BACKUP_NAME_RE.exec(a)
  const mb = BACKUP_NAME_RE.exec(b)
  if (ma[1] !== mb[1]) return ma[1] < mb[1] ? -1 : 1
  return Number(ma[2] ?? 1) - Number(mb[2] ?? 1)
}

/** Só pastas com o padrão automático contam; o resto (do usuário) nunca é apagado. */
export function backupsToDelete(names, keep = KEEP_BACKUPS) {
  const managed = names.filter((n) => BACKUP_NAME_RE.test(n)).sort(compareBackupNames)
  return managed.slice(0, Math.max(0, managed.length - keep))
}

/** Copia state\ para backups\<nome>. Devolve o nome, ou null se não havia o que copiar. */
export function makeBackup(fs, { stateDir, backupsDir, date, keep = KEEP_BACKUPS }) {
  if (!fs.existsSync(stateDir) || fs.readdirSync(stateDir).length === 0) return null
  fs.mkdirSync(backupsDir, { recursive: true })
  for (const entry of fs.readdirSync(backupsDir)) {
    if (entry.startsWith('.') && entry.endsWith('.partial')) {
      fs.rmSync(path.join(backupsDir, entry), { recursive: true, force: true })
    }
  }
  const base = backupName(date)
  let name = base
  for (let i = 2; fs.existsSync(path.join(backupsDir, name)); i++) name = `${base}-${i}`
  const partial = path.join(backupsDir, `.${name}.partial`)
  fs.cpSync(stateDir, partial, { recursive: true })
  fs.renameSync(partial, path.join(backupsDir, name))
  for (const old of backupsToDelete(fs.readdirSync(backupsDir), keep)) {
    fs.rmSync(path.join(backupsDir, old), { recursive: true, force: true })
  }
  return name
}

/** Backup agora + atualiza config.lastBackup. Lança se a cópia falhar. */
export function backupNow(deps, ctx) {
  const date = new Date(deps.now())
  const name = makeBackup(deps.fs, { stateDir: ctx.paths.stateDir, backupsDir: ctx.paths.backupsDir, date })
  if (!name) return null
  ctx.config.lastBackup = date.toISOString()
  if (ctx.configWritable) writeConfig(deps.fs, ctx.paths.configFile, ctx.config)
  return name
}
```

`apps/launcher/src/swap.mjs`:

```js
import path from 'node:path'

/** Código de saída que pede ao "Iniciar Mesa.cmd" para aplicar a atualização. Contrato congelado. */
export const UPDATE_EXIT_CODE = 75

export function appPaths(root) {
  return {
    app: path.join(root, 'app'),
    appNew: path.join(root, 'app.new'),
    appNewTmp: path.join(root, 'app.new.tmp'),
    appOld: path.join(root, 'app.old'),
  }
}

function defaultSleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

/** rename com novas tentativas (antivírus/indexador seguram arquivos por instantes no Windows). */
export function renameWithRetry(fs, from, to, { attempts = 5, delayMs = 500, sleepSync = defaultSleepSync } = {}) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to)
      return
    } catch (err) {
      if (attempt >= attempts) throw err
      sleepSync(delayMs)
    }
  }
}

/** app\ → app.old\, app.new\ → app\. Em falha restaura app\ e lança com o motivo. */
export function swapApp(fs, root, retryOptions = {}) {
  const p = appPaths(root)
  if (!fs.existsSync(path.join(p.appNew, 'launcher', 'launcher.mjs'))) {
    throw new Error('a versão nova está incompleta')
  }
  fs.rmSync(p.appOld, { recursive: true, force: true })
  renameWithRetry(fs, p.app, p.appOld, retryOptions)
  try {
    renameWithRetry(fs, p.appNew, p.app, retryOptions)
  } catch (err) {
    try {
      renameWithRetry(fs, p.appOld, p.app, retryOptions)
    } catch {
      throw new Error(`falha ao trocar a pasta app e ao restaurar a anterior (${err.message}); a versão anterior está em app.old`)
    }
    throw new Error(`arquivo em uso ao trocar a pasta app (${err.message})`)
  }
}

/** Sobras de uma atualização interrompida. */
export function removeLeftovers(fs, root) {
  const p = appPaths(root)
  fs.rmSync(p.appNewTmp, { recursive: true, force: true })
  fs.rmSync(p.appNew, { recursive: true, force: true })
}

/** Apaga app.old\ (chamado depois que o servidor respondeu). true se havia o que apagar. */
export function removeOldApp(fs, root) {
  const { appOld } = appPaths(root)
  if (!fs.existsSync(appOld)) return false
  try {
    fs.rmSync(appOld, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `pnpm --filter @mesa/launcher test`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add apps/launcher/src/config.mjs apps/launcher/src/log.mjs apps/launcher/src/backup.mjs apps/launcher/src/swap.mjs apps/launcher/test/config.test.mjs apps/launcher/test/log.test.mjs apps/launcher/test/backup.test.mjs apps/launcher/test/swap.test.mjs
git commit -m "feat(win): Task 2 — launcher: config, log rotativo, backups e troca de app" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 3: Launcher — processos (spawn, árvore de processos, prontidão, área de transferência, navegador, unzip) + harness de testes

**Files:**
- Create: `apps/launcher/src/processes.mjs`
- Create: `apps/launcher/test/harness.mjs` (infraestrutura de teste compartilhada pelas Tasks 3–5)
- Test: `apps/launcher/test/processes.test.mjs`

**Interfaces:**
- Consumes: nada das tasks anteriores.
- Produces:
  - `stripAnsi(text): string`
  - `pipeLines(stream, onLine: (line: string) => void): void` — divide em linhas (`\n`/`\r\n`), tira ANSI, ignora linhas vazias, emite o resto no `end`.
  - `launch(deps, command, args, options, onLine): ManagedProcess` — `stdio: ['ignore','pipe','pipe']`, `windowsHide: true`.
  - `runCommand(deps, command, args, options?): Promise<{ code: number, output: string }>` (`code -1` em erro de spawn).
  - `killTree(deps, proc: ManagedProcess | null, timeoutMs = 5000): Promise<void>` — win32: `taskkill /PID <pid> /T /F`; outros: `child.kill('SIGTERM')`; resolve quando o processo sai ou no timeout.
  - `waitForServer(deps, url, { timeoutMs = 60000, intervalMs = 500, isAlive }): Promise<boolean>`.
  - `serverCommand({ execPath, serverDir, port, inspectorPort?, stateDir }): { command, args }`, `serverEnv(env, logsDir): object`, `tunnelCommand({ cloudflaredPath, port }): { command, args }`.
  - `copyToClipboard(deps, text): Promise<boolean>` (só win32), `openBrowser(deps, url): boolean`, `extractZip(deps, zipFile, destDir): Promise<void>` (lança `não foi possível extrair o zip (…)`).
  - `test/harness.mjs`: `T0`, `makeTmp()`, `writeFakeApp(appDir, version)`, `makePackage(base, version?) → root`, `releaseFixture(version?, size?)`, `fakeChild(pid)`, `until(predicate, label?)`, `createHarness(options) → h` (com `h.deps`, `h.output`, `h.spawns`, `h.fetches`, `h.clipboard`, `h.browser`, `h.children.server|tunnel`, `h.signal()`, `h.text()`).

- [ ] **Step 1: Escrever o harness de testes**

`apps/launcher/test/harness.mjs`:

```js
// Fakes para testar o launcher no Linux: processos, fetch, relógio, console e sinais.
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'

export const T0 = Date.parse('2026-10-08T12:00:00.000Z')

/** Pasta temporária com espaço e acento no nome (Review Focus 3). */
export function makeTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mesa launcher ção '))
}

export function writeFakeApp(appDir, version) {
  fs.mkdirSync(path.join(appDir, 'launcher'), { recursive: true })
  fs.mkdirSync(path.join(appDir, 'node'), { recursive: true })
  fs.mkdirSync(path.join(appDir, 'server'), { recursive: true })
  fs.writeFileSync(path.join(appDir, 'version.txt'), `${version}\n`)
  fs.writeFileSync(path.join(appDir, 'launcher', 'launcher.mjs'), `// launcher ${version}\n`)
  fs.writeFileSync(path.join(appDir, 'node', 'node.exe'), 'node falso')
}

/** <base>/MesaVirtual/app (versão dada), <base>/tmp e <base>/node-atual.exe. Devolve a raiz do pacote. */
export function makePackage(base, version = '0.4.0') {
  const root = path.join(base, 'MesaVirtual')
  writeFakeApp(path.join(root, 'app'), version)
  fs.mkdirSync(path.join(base, 'tmp'), { recursive: true })
  fs.writeFileSync(path.join(base, 'node-atual.exe'), 'node em execução')
  return root
}

export function releaseFixture(version = '0.5.0', size = 3) {
  const name = `MesaVirtual-v${version}-win64.zip`
  return {
    tag_name: `v${version}`,
    assets: [
      {
        name,
        size,
        browser_download_url: `https://github.com/joaovictorjtorres/PersonalBoard/releases/download/v${version}/${name}`,
      },
    ],
  }
}

export function fakeChild(pid) {
  const child = new EventEmitter()
  child.pid = pid
  child.stdout = new PassThrough()
  child.stderr = new PassThrough()
  child.stdin = new PassThrough()
  child.exited = false
  child.killedWith = undefined
  child.exit = (code = 0) => {
    if (child.exited) return
    child.exited = true
    child.stdout.end()
    child.stderr.end()
    setImmediate(() => child.emit('exit', code))
  }
  child.kill = (signal = 'SIGTERM') => {
    child.killedWith = signal
    child.exit(null)
    return true
  }
  child.unref = () => {}
  return child
}

export async function until(predicate, label = 'condição') {
  for (let i = 0; i < 5000; i++) {
    if (predicate()) return
    await new Promise((resolve) => setImmediate(resolve))
  }
  throw new Error(`tempo esgotado esperando ${label}`)
}

/**
 * @param {object} o
 * @param {string} o.base            pasta temporária (makeTmp)
 * @param {string} [o.dataDir]       vira MESA_DATA_DIR
 * @param {string} [o.platform]      'win32' (padrão) | 'linux'
 * @param {number} [o.now]           relógio inicial (T0)
 * @param {'ready'|'never'|((n: number) => 'ready'|'never')} [o.server]
 * @param {'url'|'silent'|'exit'|((n: number) => 'url'|'silent'|'exit')} [o.tunnel]
 * @param {object|Error|null} [o.release]  resposta da API (null = 404; Error = falha de rede)
 * @param {string} [o.answer]        resposta ao [S/n]
 * @param {number[]|null} [o.freePorts]    null = todas livres
 * @param {boolean} [o.timersFireImmediately]  setTimer dispara no próximo tick (timeout do túnel)
 * @param {number} [o.tableStatus]   status do POST /api/tables
 * @param {Buffer} [o.download]      corpo do download do asset
 * @param {string} [o.extractVersion]  versão que o "zip" extraído contém
 * @param {boolean} [o.extractOk]    false = tar.exe e PowerShell falham
 */
export function createHarness(o) {
  const {
    base, dataDir = path.join(base, 'dados'), platform = 'win32', now: start = T0, server = 'ready', tunnel = 'url',
    release = null, answer = 's', freePorts = null, timersFireImmediately = false, tableStatus = 201,
    download = Buffer.from('zip'), extractVersion = '0.5.0', extractOk = true,
  } = o
  let now = start
  let nextPid = 1000
  const byPid = new Map()
  const h = {
    output: [], spawns: [], fetches: [], clipboard: [], browser: [], signalHandlers: [],
    children: { server: [], tunnel: [] },
  }
  const pick = (mode, n) => (typeof mode === 'function' ? mode(n) : mode)

  const spawn = (command, args = [], options = {}) => {
    const child = fakeChild(++nextPid)
    byPid.set(child.pid, child)
    h.spawns.push({ command, args, options, pid: child.pid })
    const name = path.win32.basename(command).toLowerCase()
    if (String(args[0] ?? '').endsWith('wrangler.js')) {
      h.children.server.push(child)
      child.mode = pick(server, h.children.server.length)
      if (child.mode === 'never') {
        for (let i = 1; i <= 25; i++) child.stdout.write(`linha ${i}\n`)
      } else {
        child.stdout.write('\x1b[32m⎔ Starting local server...\x1b[0m\n')
      }
    } else if (name === 'cloudflared.exe') {
      h.children.tunnel.push(child)
      const n = h.children.tunnel.length
      const mode = pick(tunnel, n)
      child.stderr.write('INF Requesting new quick Tunnel on trycloudflare.com...\n')
      child.stderr.write('ERR failed to request quick Tunnel: Post "https://api.trycloudflare.com/tunnel": EOF\n')
      if (mode === 'url') child.stderr.write(`INF |  https://mesa-${n}.trycloudflare.com  |\n`)
      if (mode === 'exit') child.exit(1)
    } else if (name === 'taskkill') {
      byPid.get(Number(args[1]))?.exit(1)
      child.exit(0)
    } else if (name === 'clip.exe') {
      let text = ''
      child.stdin.on('data', (d) => { text += d })
      child.stdin.on('finish', () => { h.clipboard.push(text); child.exit(0) })
    } else if (name === 'cmd.exe') {
      h.browser.push(args.at(-1))
      child.exit(0)
    } else if (name === 'tar.exe') {
      if (extractOk) writeFakeApp(path.join(args[3], 'MesaVirtual', 'app'), extractVersion)
      if (!extractOk) child.stderr.write('tar.exe: erro de leitura\n')
      child.exit(extractOk ? 0 : 1)
    } else if (name === 'powershell.exe') {
      child.stderr.write('Expand-Archive: falhou\n')
      child.exit(1)
    } else if (name === 'exit0.exe') {
      child.stdout.write('feito\n')
      child.exit(0)
    }
    // qualquer outro comando fica "rodando" até exit()/kill()
    return child
  }

  const fetch = async (input, init = {}) => {
    const url = String(input)
    h.fetches.push({ url, method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body })
    if (url.startsWith('https://api.github.com/')) {
      if (release instanceof Error) throw release
      if (release === null) return new Response('{"message":"Not Found"}', { status: 404 })
      return Response.json(release)
    }
    if (url.startsWith('https://github.com/')) return new Response(download)
    if (url.endsWith('/api/tables')) return new Response('{"tableId":"abc"}', { status: tableStatus })
    const srv = h.children.server.at(-1)
    if (srv && !srv.exited && srv.mode === 'ready') return new Response('<!doctype html>', { status: 200 })
    throw new TypeError('fetch failed')
  }

  h.deps = {
    fs,
    spawn,
    fetch,
    now: () => now,
    sleep: async (ms) => {
      now += ms
      await new Promise((resolve) => setImmediate(resolve))
    },
    sleepSync: () => {},
    setTimer: (fn) => {
      if (!timersFireImmediately) return () => {}
      const t = setImmediate(fn)
      return () => clearImmediate(t)
    },
    platform,
    env: { MESA_DATA_DIR: dataDir, SystemRoot: 'C:\\Windows', PATH: '/usr/bin' },
    homedir: base,
    tmpdir: path.join(base, 'tmp'),
    execPath: path.join(base, 'node-atual.exe'),
    launcherDir: path.join(base, 'MesaVirtual', 'app', 'launcher'),
    isPortFree: async (p) => (freePorts ? freePorts.includes(p) : true),
    ask: async (question) => {
      h.output.push(question)
      return answer
    },
    print: (line) => { h.output.push(line) },
    onExitSignal: (handler) => { h.signalHandlers.push(handler) },
  }
  h.signal = () => { for (const handler of h.signalHandlers) handler() }
  h.text = () => h.output.join('\n')
  h.advance = (ms) => { now += ms }
  return h
}
```

- [ ] **Step 2: Escrever os testes que falham**

`apps/launcher/test/processes.test.mjs`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  copyToClipboard, extractZip, killTree, launch, openBrowser, pipeLines, runCommand,
  serverCommand, serverEnv, tunnelCommand, waitForServer,
} from '../src/processes.mjs'
import { createHarness, makeTmp } from './harness.mjs'

let base
beforeEach(() => { base = makeTmp() })
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

describe('pipeLines', () => {
  it('junta pedaços, aceita CRLF, tira ANSI e emite a sobra no fim', async () => {
    const stream = new PassThrough()
    const lines = []
    pipeLines(stream, (l) => lines.push(l))
    stream.write('linha 1\r\nlin')
    stream.write('ha 2\n\x1b[32mverde\x1b[0m\n\n   \n')
    stream.end('sem fim')
    await new Promise((resolve) => stream.on('end', resolve))
    expect(lines).toEqual(['linha 1', 'linha 2', 'verde', 'sem fim'])
  })
})

describe('launch / killTree', () => {
  it('acompanha vida e saída do processo e repassa as linhas', async () => {
    const h = createHarness({ base })
    const lines = []
    const proc = launch(h.deps, '/bin/algo', ['x'], { cwd: base }, (l) => lines.push(l))
    expect(h.spawns[0].options).toMatchObject({ cwd: base, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    proc.child.stderr.write('oi\n')
    expect(proc.isAlive()).toBe(true)
    proc.child.exit(3)
    expect(await proc.exited).toBe(3)
    expect(proc.isAlive()).toBe(false)
    expect(lines).toEqual(['oi'])
  })

  it('erro de spawn (exe ausente) vira linha e exited null', async () => {
    const h = createHarness({ base })
    const lines = []
    const proc = launch(h.deps, 'C:\\x\\outro.exe', [], {}, (l) => lines.push(l))
    proc.child.emit('error', new Error('spawn ENOENT'))
    expect(await proc.exited).toBeNull()
    expect(lines).toEqual(['falha ao iniciar outro.exe: spawn ENOENT'])
  })

  it('win32: taskkill /PID <pid> /T /F e espera o processo sair', async () => {
    const h = createHarness({ base })
    const proc = launch(h.deps, 'C:\\app\\node\\node.exe', ['wrangler.js'], {}, () => {})
    await killTree(h.deps, proc)
    expect(h.spawns.at(-1)).toMatchObject({ command: 'taskkill', args: ['/PID', String(proc.child.pid), '/T', '/F'] })
    expect(proc.isAlive()).toBe(false)
  })

  it('linux: SIGTERM; processo já morto ou null → nada', async () => {
    const h = createHarness({ base, platform: 'linux' })
    const proc = launch(h.deps, '/bin/algo', [], {}, () => {})
    await killTree(h.deps, proc)
    expect(proc.child.killedWith).toBe('SIGTERM')
    const count = h.spawns.length
    await killTree(h.deps, proc)
    await killTree(h.deps, null)
    expect(h.spawns).toHaveLength(count)
  })
})

describe('waitForServer', () => {
  it('tenta a cada 500 ms até o 200', async () => {
    const h = createHarness({ base })
    let calls = 0
    h.deps.fetch = async () => {
      calls++
      if (calls < 3) throw new TypeError('fetch failed')
      return new Response('ok', { status: 200 })
    }
    expect(await waitForServer(h.deps, 'http://127.0.0.1:8787/')).toBe(true)
    expect(calls).toBe(3)
    expect(h.deps.now()).toBe(Date.parse('2026-10-08T12:00:01.000Z'))
  })

  it('desiste em 60 s', async () => {
    const h = createHarness({ base })
    let calls = 0
    h.deps.fetch = async () => { calls++; return new Response('x', { status: 503 }) }
    const start = h.deps.now()
    expect(await waitForServer(h.deps, 'http://127.0.0.1:8787/')).toBe(false)
    expect(h.deps.now() - start).toBe(60_000)
    expect(calls).toBe(120)
  })

  it('processo morreu → false sem esperar', async () => {
    const h = createHarness({ base })
    expect(await waitForServer(h.deps, 'http://127.0.0.1:8787/', { isAlive: () => false })).toBe(false)
    expect(h.deps.now()).toBe(Date.parse('2026-10-08T12:00:00.000Z'))
  })
})

describe('comandos', () => {
  it('Review Focus 3: wrangler dev com caminhos com espaço/acento como argumentos inteiros', () => {
    const serverDir = path.join('C:', 'Users', 'João Silva', 'Mesa Virtual', 'app', 'server')
    const stateDir = path.join('C:', 'Users', 'João Silva', 'AppData', 'Local', 'MesaVirtual', 'state')
    const { command, args } = serverCommand({ execPath: 'node.exe', serverDir, port: 8788, inspectorPort: 9230, stateDir })
    expect(command).toBe('node.exe')
    expect(args).toEqual([
      path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
      'dev', '--ip', '127.0.0.1', '--port', '8788', '--persist-to', stateDir, '--inspector-port', '9230',
    ])
    expect(serverCommand({ execPath: 'n', serverDir, port: 8787, stateDir }).args).not.toContain('--inspector-port')
  })

  it('ambiente do servidor sem telemetria e com log na pasta de dados', () => {
    const env = serverEnv({ PATH: 'x' }, path.join('d', 'logs'))
    expect(env).toMatchObject({ PATH: 'x', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join('d', 'logs', 'wrangler') })
  })

  it('túnel', () => {
    expect(tunnelCommand({ cloudflaredPath: 'cf.exe', port: 8790 })).toEqual({
      command: 'cf.exe', args: ['tunnel', '--url', 'http://127.0.0.1:8790', '--no-autoupdate'],
    })
  })
})

describe('área de transferência e navegador', () => {
  it('win32 copia com clip.exe', async () => {
    const h = createHarness({ base })
    expect(await copyToClipboard(h.deps, 'https://a.trycloudflare.com')).toBe(true)
    expect(h.clipboard).toEqual(['https://a.trycloudflare.com'])
  })

  it('fora do Windows não copia', async () => {
    const h = createHarness({ base, platform: 'linux' })
    expect(await copyToClipboard(h.deps, 'x')).toBe(false)
    expect(h.spawns).toHaveLength(0)
  })

  it('win32 abre com start "" e recusa URL estranha', () => {
    const h = createHarness({ base })
    expect(openBrowser(h.deps, 'https://a-b.trycloudflare.com')).toBe(true)
    expect(h.spawns[0]).toMatchObject({
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', '"start "" "https://a-b.trycloudflare.com""'],
      options: { windowsVerbatimArguments: true, detached: true, stdio: 'ignore' },
    })
    expect(openBrowser(h.deps, 'http://localhost:8787')).toBe(true)
    expect(openBrowser(h.deps, 'https://x.com/&calc')).toBe(false)
    expect(openBrowser(h.deps, 'https://x.com" & calc')).toBe(false)
    expect(h.spawns).toHaveLength(2)
  })
})

describe('extractZip / runCommand', () => {
  it('win32 usa %SystemRoot%\\System32\\tar.exe', async () => {
    const h = createHarness({ base })
    const dest = path.join(base, 'app.new.tmp')
    await extractZip(h.deps, path.join(base, 'a.zip'), dest)
    expect(h.spawns[0].command).toBe('C:\\Windows\\System32\\tar.exe')
    expect(h.spawns[0].args).toEqual(['-xf', path.join(base, 'a.zip'), '-C', dest])
    expect(fs.existsSync(path.join(dest, 'MesaVirtual', 'app', 'version.txt'))).toBe(true)
  })

  it("Review Focus 3: cai para Expand-Archive com aspas simples escapadas (D'Ávila) e lança se falhar", async () => {
    const h = createHarness({ base, extractOk: false })
    const zip = "C:\\Users\\D'Ávila\\AppData\\Local\\Temp\\a b.zip"
    await expect(extractZip(h.deps, zip, path.join(base, 'dest'))).rejects.toThrow('não foi possível extrair o zip')
    expect(h.spawns[1].command).toBe('powershell.exe')
    expect(h.spawns[1].args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-Command'])
    expect(h.spawns[1].args[3]).toBe(
      `Expand-Archive -LiteralPath 'C:\\Users\\D''Ávila\\AppData\\Local\\Temp\\a b.zip' -DestinationPath '${path.join(base, 'dest').replaceAll("'", "''")}' -Force`,
    )
  })

  it('runCommand: código e saída; -1 em erro de spawn', async () => {
    const h = createHarness({ base })
    expect(await runCommand(h.deps, 'exit0.exe', [])).toEqual({ code: 0, output: 'feito\n' })
    h.deps.spawn = () => { throw new Error('ENOENT') }
    expect(await runCommand(h.deps, 'exit0.exe', [])).toEqual({ code: -1, output: 'ENOENT' })
  })
})
```

- [ ] **Step 3: Rodar os testes e ver falhar**

Run: `pnpm --filter @mesa/launcher test -- processes`
Expected: FAIL — `Failed to load url ../src/processes.mjs`.

- [ ] **Step 4: Implementar `processes.mjs`**

`apps/launcher/src/processes.mjs`:

```js
import path from 'node:path'

const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]/g
const SAFE_URL_RE = /^https?:\/\/[A-Za-z0-9.-]+(:\d+)?\/?$/

export function stripAnsi(text) {
  return text.replace(ANSI_RE, '')
}

/** Lê um stream em linhas; ignora linhas vazias; emite a sobra no fim. */
export function pipeLines(stream, onLine) {
  if (!stream) return
  stream.setEncoding('utf8')
  let carry = ''
  const emit = (raw) => {
    const line = stripAnsi(raw).trimEnd()
    if (line.trim()) onLine(line)
  }
  stream.on('data', (chunk) => {
    const parts = (carry + chunk).split(/\r?\n/)
    carry = parts.pop() ?? ''
    parts.forEach(emit)
  })
  stream.on('end', () => {
    emit(carry)
    carry = ''
  })
}

/** @returns {import('./main.mjs').ManagedProcess} */
export function launch(deps, command, args, options, onLine) {
  const child = deps.spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  let alive = true
  const exited = new Promise((resolve) => {
    child.once('exit', (code) => {
      alive = false
      resolve(code ?? null)
    })
    child.once('error', (err) => {
      alive = false
      onLine(`falha ao iniciar ${path.win32.basename(command)}: ${err.message}`)
      resolve(null)
    })
  })
  pipeLines(child.stdout, onLine)
  pipeLines(child.stderr, onLine)
  return { child, exited, isAlive: () => alive }
}

/** Roda até o fim e devolve código + últimos 4 KB de saída. */
export function runCommand(deps, command, args, options = {}) {
  return new Promise((resolve) => {
    let child
    try {
      child = deps.spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    } catch (err) {
      resolve({ code: -1, output: err.message })
      return
    }
    let output = ''
    const collect = (chunk) => { output = (output + chunk).slice(-4096) }
    child.stdout?.on('data', collect)
    child.stderr?.on('data', collect)
    child.once('error', (err) => resolve({ code: -1, output: `${output}${err.message}` }))
    child.once('exit', (code) => resolve({ code: code ?? -1, output }))
  })
}

/** Mata o processo e seus filhos (wrangler → workerd). Resolve quando sai ou após timeoutMs. */
export function killTree(deps, proc, timeoutMs = 5_000) {
  if (!proc || !proc.isAlive()) return Promise.resolve()
  return new Promise((resolve) => {
    let done = false
    let cancel = () => {}
    const finish = () => {
      if (done) return
      done = true
      cancel()
      resolve()
    }
    proc.exited.then(finish)
    cancel = deps.setTimer(finish, timeoutMs)
    if (deps.platform === 'win32') {
      const killer = deps.spawn('taskkill', ['/PID', String(proc.child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true })
      killer.on('error', () => proc.child.kill())
    } else {
      proc.child.kill('SIGTERM')
    }
  })
}

/** GET url até 200, a cada intervalMs, por até timeoutMs. false se o processo morrer. */
export async function waitForServer(deps, url, { timeoutMs = 60_000, intervalMs = 500, isAlive = () => true } = {}) {
  const deadline = deps.now() + timeoutMs
  while (deps.now() < deadline) {
    if (!isAlive()) return false
    try {
      const res = await deps.fetch(url, { signal: AbortSignal.timeout(2_000) })
      await res.body?.cancel?.()
      if (res.status === 200) return true
    } catch {
      // ainda subindo
    }
    await deps.sleep(intervalMs)
  }
  return false
}

export function serverCommand({ execPath, serverDir, port, inspectorPort, stateDir }) {
  const args = [
    path.join(serverDir, 'node_modules', 'wrangler', 'bin', 'wrangler.js'),
    'dev', '--ip', '127.0.0.1', '--port', String(port), '--persist-to', stateDir,
  ]
  if (inspectorPort !== undefined) args.push('--inspector-port', String(inspectorPort))
  return { command: execPath, args }
}

export function serverEnv(env, logsDir) {
  return {
    ...env,
    WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_PATH: path.join(logsDir, 'wrangler'),
    NO_COLOR: '1',
    FORCE_COLOR: '0',
  }
}

export function tunnelCommand({ cloudflaredPath, port }) {
  return { command: cloudflaredPath, args: ['tunnel', '--url', `http://127.0.0.1:${port}`, '--no-autoupdate'] }
}

export function copyToClipboard(deps, text) {
  if (deps.platform !== 'win32') return Promise.resolve(false)
  return new Promise((resolve) => {
    let child
    try {
      child = deps.spawn('clip.exe', [], { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true })
    } catch {
      resolve(false)
      return
    }
    child.once('error', () => resolve(false))
    child.once('exit', (code) => resolve(code === 0))
    child.stdin.on('error', () => {})
    child.stdin.end(text)
  })
}

/** Abre o navegador padrão. Só aceita URL simples (sem caracteres que o cmd interpretaria). */
export function openBrowser(deps, url) {
  if (!SAFE_URL_RE.test(url)) return false
  let child
  try {
    if (deps.platform === 'win32') {
      child = deps.spawn('cmd.exe', ['/d', '/s', '/c', `"start "" "${url}""`], {
        stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true, detached: true,
      })
    } else {
      child = deps.spawn(deps.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore', detached: true })
    }
  } catch {
    return false
  }
  child.on('error', () => {})
  child.unref?.()
  return true
}

const psQuote = (text) => `'${text.replaceAll("'", "''")}'`

/** Extrai um zip: tar.exe do Windows (rápido) com fallback para Expand-Archive; fora do Windows, unzip. */
export async function extractZip(deps, zipFile, destDir) {
  deps.fs.mkdirSync(destDir, { recursive: true })
  if (deps.platform === 'win32') {
    const systemRoot = deps.env.SystemRoot || deps.env.SYSTEMROOT || 'C:\\Windows'
    const tar = path.win32.join(systemRoot, 'System32', 'tar.exe')
    const first = await runCommand(deps, tar, ['-xf', zipFile, '-C', destDir])
    if (first.code === 0) return
    const ps = await runCommand(deps, 'powershell.exe', [
      '-NoProfile', '-NonInteractive', '-Command',
      `Expand-Archive -LiteralPath ${psQuote(zipFile)} -DestinationPath ${psQuote(destDir)} -Force`,
    ])
    if (ps.code === 0) return
    throw new Error(`não foi possível extrair o zip (${(ps.output || first.output).trim().slice(-200)})`)
  }
  const result = await runCommand(deps, 'unzip', ['-q', '-o', zipFile, '-d', destDir])
  if (result.code !== 0) throw new Error(`não foi possível extrair o zip (${result.output.trim().slice(-200)})`)
}
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @mesa/launcher test`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/launcher/src/processes.mjs apps/launcher/test/harness.mjs apps/launcher/test/processes.test.mjs
git commit -m "feat(win): Task 3 — launcher: processos, área de transferência, navegador e unzip" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 4: Launcher — atualização (consulta, download conferido, preparação de `app.new\`, troca a partir do `%TEMP%`)

**Files:**
- Create: `apps/launcher/src/update.mjs`
- Test: `apps/launcher/test/update.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1: `LATEST_URL`, `pickUpdate(release, currentVersion)`, `readVersion(fs, file)`, `MSG`.
  - Task 2: `backupNow(deps, ctx)`, `appPaths(root)`, `swapApp(fs, root, retryOptions)`.
  - Task 3: `extractZip(deps, zipFile, destDir)`, harness.
- Produces:
  - `STAGING_DIR_NAME = 'MesaVirtual-update'` (contrato com o `.cmd`), `API_TIMEOUT_MS = 5000`.
  - `fetchLatestRelease(deps, timeoutMs?): Promise<object | null>` (404 → null; outro erro HTTP lança `GitHub respondeu <status>`).
  - `describeError(err, timeoutText?): string` (`TimeoutError`/`AbortError` → `timeoutText`, `TypeError` → `'sem conexão'`, senão `err.message`).
  - `downloadAsset(deps, asset, destFile): Promise<void>` (lança `download incompleto (<n> de <size> bytes)`; nunca deixa arquivo parcial).
  - `stagingDir(deps): string`, `stageSwapper(deps): string`, `stageUpdate(deps, ctx: Ctx, asset: UpdateAsset): Promise<boolean>`.
  - `checkForUpdate(deps, ctx: Ctx): Promise<boolean>` — `true` = atualização preparada (o chamador sai com 75).
  - `applyUpdate(deps, root, paths: DataPaths, log: Logger): number` (sempre 0; falha → `paths.updateFailedFile`).
  - `consumeUpdateFailure(fs, paths): string | null`.

- [ ] **Step 1: Escrever os testes que falham**

`apps/launcher/test/update.test.mjs`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { dataPaths } from '../src/config.mjs'
import { MSG } from '../src/messages.mjs'
import { appPaths } from '../src/swap.mjs'
import {
  STAGING_DIR_NAME, applyUpdate, checkForUpdate, consumeUpdateFailure, fetchLatestRelease,
} from '../src/update.mjs'
import { createHarness, makePackage, makeTmp, releaseFixture, writeFakeApp } from './harness.mjs'

let base
let root
beforeEach(() => {
  base = makeTmp()
  root = makePackage(base, '0.4.0')
})
afterEach(() => fs.rmSync(base, { recursive: true, force: true }))

function setup(options = {}) {
  const h = createHarness({ base, ...options })
  const paths = dataPaths(h.deps.env, h.deps.homedir)
  fs.mkdirSync(paths.stateDir, { recursive: true })
  fs.writeFileSync(path.join(paths.stateDir, 'mesa.sqlite'), 'dados')
  const logged = []
  const ctx = {
    root, paths, version: '0.4.0',
    config: { autoUpdate: true, lastBackup: null }, configWritable: true,
    log: { write: (text) => logged.push(text) },
  }
  return { h, paths, ctx, logged, p: appPaths(root) }
}
const versionOf = (dir) => fs.readFileSync(path.join(dir, 'version.txt'), 'utf8').trim()

describe('fetchLatestRelease', () => {
  it('404 (nenhuma Release) → null; erro HTTP → lança; manda User-Agent', async () => {
    const { h } = setup({ release: null })
    expect(await fetchLatestRelease(h.deps)).toBeNull()
    expect(h.fetches[0]).toMatchObject({
      url: 'https://api.github.com/repos/joaovictorjtorres/PersonalBoard/releases/latest',
      headers: { 'User-Agent': 'MesaVirtual-launcher' },
    })
    h.deps.fetch = async () => new Response('x', { status: 500 })
    await expect(fetchLatestRelease(h.deps)).rejects.toThrow('GitHub respondeu 500')
  })
})

describe('checkForUpdate', () => {
  it('sem internet: avisa em uma linha e não pergunta', async () => {
    const { h, ctx } = setup({ release: new TypeError('fetch failed') })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output).toEqual([MSG.updateCheckFailed('sem conexão')])
  })

  it('API não responde em 5 s', async () => {
    const { h, ctx } = setup({ release: Object.assign(new Error('aborted'), { name: 'TimeoutError' }) })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output).toEqual([MSG.updateCheckFailed('sem resposta em 5 s')])
  })

  it('já está na mais recente', async () => {
    const { h, ctx } = setup({ release: releaseFixture('0.4.0') })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output).toEqual([MSG.upToDate])
  })

  it('recusa ("n"): não baixa nada', async () => {
    const { h, ctx, p } = setup({ release: releaseFixture('0.5.0'), answer: 'n' })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output).toEqual([MSG.updateAvailable('0.5.0', '0.4.0'), MSG.updateDeclined])
    expect(h.fetches.some((f) => f.url.startsWith('https://github.com/'))).toBe(false)
    expect(fs.existsSync(p.appNew)).toBe(false)
  })

  it('aceita (Enter): baixa, faz backup, prepara app.new e o trocador no %TEMP%', async () => {
    const { h, ctx, paths, p } = setup({ release: releaseFixture('0.5.0'), answer: '' })
    expect(await checkForUpdate(h.deps, ctx)).toBe(true)
    expect(versionOf(p.appNew)).toBe('0.5.0')
    expect(versionOf(p.app)).toBe('0.4.0')
    expect(fs.existsSync(p.appNewTmp)).toBe(false)
    expect(fs.existsSync(path.join(h.deps.tmpdir, 'MesaVirtual-v0.5.0-win64.zip'))).toBe(false)
    const staging = path.join(h.deps.tmpdir, STAGING_DIR_NAME)
    expect(fs.readFileSync(path.join(staging, 'node.exe'), 'utf8')).toBe('node em execução')
    expect(fs.existsSync(path.join(staging, 'launcher', 'launcher.mjs'))).toBe(true)
    const backups = fs.readdirSync(paths.backupsDir)
    expect(backups).toHaveLength(1)
    expect(ctx.config.lastBackup).toBe(new Date(h.deps.now()).toISOString())
    expect(JSON.parse(fs.readFileSync(paths.configFile, 'utf8')).lastBackup).toBe(ctx.config.lastBackup)
    expect(h.output).toEqual([
      MSG.updateAvailable('0.5.0', '0.4.0'),
      MSG.updateDownloading('0.5.0', 1),
      MSG.backupDone(backups[0]),
      MSG.updateReady('0.5.0'),
    ])
  })

  it('"sim" e "S" também aceitam', async () => {
    for (const answer of ['sim', 'S']) {
      const { h, ctx } = setup({ release: releaseFixture('0.5.0'), answer })
      expect(await checkForUpdate(h.deps, ctx)).toBe(true)
    }
  })

  it('download incompleto: descarta, mantém a versão atual e avisa', async () => {
    const { h, ctx, paths, p, logged } = setup({ release: releaseFixture('0.5.0', 3), answer: 's', download: Buffer.from('zi') })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output.at(-1)).toBe(MSG.updateFailed('download incompleto (2 de 3 bytes)'))
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(fs.existsSync(path.join(h.deps.tmpdir, 'MesaVirtual-v0.5.0-win64.zip'))).toBe(false)
    expect(fs.existsSync(paths.backupsDir)).toBe(false)
    expect(versionOf(p.app)).toBe('0.4.0')
    expect(logged.some((l) => l.includes('download incompleto'))).toBe(true)
  })

  it('zip com conteúdo inesperado (versão diferente): limpa tudo', async () => {
    const { h, ctx, p } = setup({ release: releaseFixture('0.5.0'), answer: 's', extractVersion: '0.4.9' })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output.at(-1)).toBe(MSG.updateFailed('o pacote baixado não tem o conteúdo esperado'))
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(fs.existsSync(p.appNewTmp)).toBe(false)
    expect(fs.existsSync(path.join(h.deps.tmpdir, STAGING_DIR_NAME))).toBe(false)
  })

  it('falha ao extrair: avisa e segue', async () => {
    const { h, ctx } = setup({ release: releaseFixture('0.5.0'), answer: 's', extractOk: false })
    expect(await checkForUpdate(h.deps, ctx)).toBe(false)
    expect(h.output.at(-1)).toMatch(/^✗ Não foi possível atualizar: não foi possível extrair o zip/)
  })
})

describe('applyUpdate / consumeUpdateFailure', () => {
  it('troca app e mostra "Atualização instalada"', () => {
    const { h, paths, p } = setup()
    writeFakeApp(p.appNew, '0.5.0')
    expect(applyUpdate(h.deps, root, paths, { write() {} })).toBe(0)
    expect(versionOf(p.app)).toBe('0.5.0')
    expect(versionOf(p.appOld)).toBe('0.4.0')
    expect(h.output).toEqual([MSG.updateApplied])
  })

  it('arquivo em uso: restaura, apaga app.new e deixa o recado para a próxima abertura', () => {
    const { h, paths, p } = setup()
    writeFakeApp(p.appNew, '0.5.0')
    const busy = {
      ...fs,
      renameSync(from, to) {
        if (from === p.appNew) throw Object.assign(new Error('EBUSY: resource busy or locked'), { code: 'EBUSY' })
        return fs.renameSync(from, to)
      },
    }
    expect(applyUpdate({ ...h.deps, fs: busy }, root, paths, { write() {} })).toBe(0)
    expect(versionOf(p.app)).toBe('0.4.0')
    expect(fs.existsSync(p.appNew)).toBe(false)
    expect(h.output.at(-1)).toMatch(/^✗ Não foi possível atualizar: arquivo em uso ao trocar a pasta app/)
    const reason = consumeUpdateFailure(fs, paths)
    expect(reason).toMatch(/^arquivo em uso ao trocar a pasta app/)
    expect(fs.existsSync(paths.updateFailedFile)).toBe(false)
    expect(consumeUpdateFailure(fs, paths)).toBeNull()
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @mesa/launcher test -- update`
Expected: FAIL — `Failed to load url ../src/update.mjs`.

- [ ] **Step 3: Implementar `update.mjs`**

`apps/launcher/src/update.mjs`:

```js
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { backupNow } from './backup.mjs'
import { MSG } from './messages.mjs'
import { extractZip } from './processes.mjs'
import { LATEST_URL, pickUpdate } from './release.mjs'
import { readVersion } from './semver.mjs'
import { appPaths, swapApp } from './swap.mjs'

/** Pasta em %TEMP% de onde o "Iniciar Mesa.cmd" roda a troca. Contrato congelado. */
export const STAGING_DIR_NAME = 'MesaVirtual-update'
export const API_TIMEOUT_MS = 5_000
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000
const USER_AGENT = 'MesaVirtual-launcher'
const YES = new Set(['', 's', 'sim', 'y', 'yes'])

export async function fetchLatestRelease(deps, timeoutMs = API_TIMEOUT_MS) {
  const res = await deps.fetch(LATEST_URL, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(timeoutMs),
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub respondeu ${res.status}`)
  return await res.json()
}

export function describeError(err, timeoutText = 'sem resposta em 5 s') {
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return timeoutText
  if (err instanceof TypeError) return 'sem conexão'
  return err?.message ?? String(err)
}

export async function downloadAsset(deps, asset, destFile) {
  const { fs } = deps
  fs.rmSync(destFile, { force: true })
  try {
    const res = await deps.fetch(asset.url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    })
    if (!res.ok || !res.body) throw new Error(`o download respondeu ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(destFile))
    const size = fs.statSync(destFile).size
    if (size !== asset.size) throw new Error(`download incompleto (${size} de ${asset.size} bytes)`)
  } catch (err) {
    fs.rmSync(destFile, { force: true })
    throw err
  }
}

export function stagingDir(deps) {
  return path.join(deps.tmpdir, STAGING_DIR_NAME)
}

/** Copia o node.exe em execução e a pasta launcher\ atual para %TEMP%\MesaVirtual-update\. */
export function stageSwapper(deps) {
  const { fs } = deps
  const dir = stagingDir(deps)
  fs.rmSync(dir, { recursive: true, force: true })
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(deps.execPath, path.join(dir, 'node.exe'))
  fs.cpSync(deps.launcherDir, path.join(dir, 'launcher'), { recursive: true })
  return dir
}

/** Baixa, faz backup, extrai e prepara app.new\ + trocador. true = pronto para sair com 75. */
export async function stageUpdate(deps, ctx, asset) {
  const { fs } = deps
  const p = appPaths(ctx.root)
  const zipFile = path.join(deps.tmpdir, asset.name)
  try {
    deps.print(MSG.updateDownloading(asset.version, Math.max(1, Math.round(asset.size / 1_048_576))))
    await downloadAsset(deps, asset, zipFile)
    const backup = backupNow(deps, ctx)
    if (backup) deps.print(MSG.backupDone(backup))
    fs.rmSync(p.appNewTmp, { recursive: true, force: true })
    fs.rmSync(p.appNew, { recursive: true, force: true })
    await extractZip(deps, zipFile, p.appNewTmp)
    const extracted = path.join(p.appNewTmp, 'MesaVirtual', 'app')
    const complete =
      readVersion(fs, path.join(extracted, 'version.txt')) === asset.version &&
      fs.existsSync(path.join(extracted, 'launcher', 'launcher.mjs')) &&
      fs.existsSync(path.join(extracted, 'node', 'node.exe'))
    if (!complete) throw new Error('o pacote baixado não tem o conteúdo esperado')
    fs.renameSync(extracted, p.appNew)
    fs.rmSync(p.appNewTmp, { recursive: true, force: true })
    stageSwapper(deps)
    fs.rmSync(zipFile, { force: true })
    ctx.log.write(`atualização ${asset.version} preparada`)
    deps.print(MSG.updateReady(asset.version))
    return true
  } catch (err) {
    for (const leftover of [p.appNewTmp, p.appNew, zipFile]) {
      try {
        fs.rmSync(leftover, { recursive: true, force: true })
      } catch {
        // ignora
      }
    }
    ctx.log.write(`falha na atualização: ${err?.stack ?? err}`)
    deps.print(MSG.updateFailed(describeError(err, 'o download demorou demais')))
    return false
  }
}

/** Consulta a Release mais recente e, se o usuário aceitar, prepara a atualização. */
export async function checkForUpdate(deps, ctx) {
  let release
  try {
    release = await fetchLatestRelease(deps)
  } catch (err) {
    ctx.log.write(`verificação de atualização falhou: ${err?.stack ?? err}`)
    deps.print(MSG.updateCheckFailed(describeError(err)))
    return false
  }
  const asset = pickUpdate(release, ctx.version)
  if (!asset) {
    deps.print(MSG.upToDate)
    return false
  }
  const answer = String(await deps.ask(MSG.updateAvailable(asset.version, ctx.version))).trim().toLowerCase()
  if (!YES.has(answer)) {
    deps.print(MSG.updateDeclined)
    return false
  }
  return stageUpdate(deps, ctx, asset)
}

/** Modo --apply-update (rodando de %TEMP%): troca app\ por app.new\. Sempre devolve 0. */
export function applyUpdate(deps, root, paths, log) {
  const { fs } = deps
  try {
    swapApp(fs, root, { sleepSync: deps.sleepSync })
    log.write('atualização aplicada')
    deps.print(MSG.updateApplied)
  } catch (err) {
    log.write(`falha ao aplicar a atualização: ${err?.stack ?? err}`)
    try {
      fs.rmSync(appPaths(root).appNew, { recursive: true, force: true })
    } catch {
      // ignora
    }
    try {
      fs.mkdirSync(paths.dataDir, { recursive: true })
      fs.writeFileSync(paths.updateFailedFile, err.message)
    } catch {
      // ignora
    }
    deps.print(MSG.updateFailed(err.message))
  }
  return 0
}

/** Lê e apaga o recado deixado por uma troca que falhou. */
export function consumeUpdateFailure(fs, paths) {
  if (!fs.existsSync(paths.updateFailedFile)) return null
  let reason = 'erro desconhecido'
  try {
    reason = fs.readFileSync(paths.updateFailedFile, 'utf8').trim() || reason
    fs.rmSync(paths.updateFailedFile, { force: true })
  } catch {
    // ignora
  }
  return reason
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `pnpm --filter @mesa/launcher test`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add apps/launcher/src/update.mjs apps/launcher/test/update.test.mjs
git commit -m "feat(win): Task 4 — launcher: atualização com backup, troca e rollback" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 5: Launcher — orquestração (`run`), dependências reais e ponto de entrada

**Files:**
- Create: `apps/launcher/src/main.mjs`, `apps/launcher/src/deps.mjs`, `apps/launcher/src/launcher.mjs`
- Test: `apps/launcher/test/main.test.mjs`, `apps/launcher/test/entry.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1: `MSG`, `readVersion`, `findTunnelUrl`, `pickPort`, `INSPECTOR_FIRST`, `INSPECTOR_LAST`, `isPortFree`, `parseArgs`.
  - Task 2: `dataPaths`, `readConfig`, `createLogger`, `createTail`, `backupDue`, `backupNow`, `UPDATE_EXIT_CODE`, `appPaths`, `removeLeftovers`, `removeOldApp`.
  - Task 3: `launch`, `killTree`, `waitForServer`, `serverCommand`, `serverEnv`, `tunnelCommand`, `copyToClipboard`, `openBrowser`, harness.
  - Task 4: `checkForUpdate`, `applyUpdate`, `consumeUpdateFailure`.
- Produces:
  - `run(deps: Deps, opts: LauncherOptions): Promise<number>` — 0 ok, 1 erro, 75 atualização preparada.
  - `TUNNEL_TIMEOUT_MS = 60000`, `EXIT_GRACE_MS = 1000`.
  - `createRealDeps(launcherDir: string): Deps`.
  - `apps/launcher/src/launcher.mjs`: executável `node launcher.mjs [--root <pasta>] [--smoke] [--no-update] [--port N] [--apply-update]`. A Task 6 (build/`.cmd`) e a Task 7 (smoke no CI) chamam assim.

- [ ] **Step 1: Escrever os testes que falham**

`apps/launcher/test/main.test.mjs`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { run } from '../src/main.mjs'
import { MSG } from '../src/messages.mjs'
import { T0, createHarness, makePackage, makeTmp, releaseFixture, until, writeFakeApp } from './harness.mjs'

let base
afterEach(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true })
  base = undefined
})

function setup(options = {}) {
  base = makeTmp()
  const root = makePackage(base, '0.4.0')
  const dataDir = path.join(base, 'Dados do João')
  const h = createHarness({ base, dataDir, ...options })
  return { h, root, dataDir }
}

async function startServing(h, root, opts = { noUpdate: true }) {
  const result = run(h.deps, { root, ...opts })
  await until(() => h.output.includes(MSG.closeHint) || h.output.includes(MSG.portsBusy), 'mesa pronta')
  return result
}

const taskkills = (h) => h.spawns.filter((s) => s.command === 'taskkill').map((s) => s.args[1])

describe('run: caminho feliz', () => {
  it('sobe servidor e túnel, copia e abre o link e desliga no Ctrl+C', async () => {
    const { h, root, dataDir } = setup()
    const result = await startServing(h, root)
    expect(h.output[0]).toBe('Mesa Virtual v0.4.0')
    expect(h.output).toContain(MSG.updateSkippedFlag)
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)

    const server = h.spawns.find((s) => String(s.args[0]).endsWith('wrangler.js'))
    expect(server.command).toBe(h.deps.execPath)
    expect(server.args.slice(1)).toEqual([
      'dev', '--ip', '127.0.0.1', '--port', '8787', '--persist-to', path.join(dataDir, 'state'), '--inspector-port', '9229',
    ])
    expect(server.options.cwd).toBe(path.join(root, 'app', 'server'))
    expect(server.options.env.WRANGLER_SEND_METRICS).toBe('false')

    const tunnel = h.spawns.find((s) => s.command.endsWith('cloudflared.exe'))
    expect(tunnel.command).toBe(path.join(root, 'app', 'cloudflared.exe'))
    expect(tunnel.args).toEqual(['tunnel', '--url', 'http://127.0.0.1:8787', '--no-autoupdate'])

    // Review Focus 2: a linha de erro com api.trycloudflare.com veio antes e foi ignorada
    expect(h.clipboard).toEqual(['https://mesa-1.trycloudflare.com'])
    expect(h.browser).toHaveLength(1)
    expect(h.browser[0]).toContain('https://mesa-1.trycloudflare.com')
    const at = h.output.indexOf('    https://mesa-1.trycloudflare.com')
    expect(h.output.slice(at - 2, at + 2)).toEqual(['', MSG.linkTitle, '    https://mesa-1.trycloudflare.com', ''])
    expect(h.output).toContain(MSG.copied)

    h.signal()
    expect(await result).toBe(0)
    expect(taskkills(h)).toEqual([String(h.children.tunnel[0].pid), String(h.children.server[0].pid)])
    expect(h.output.slice(-2)).toEqual([MSG.shuttingDown, MSG.bye])
    expect(fs.readFileSync(path.join(dataDir, 'logs', 'launcher.log'), 'utf8')).toContain('[túnel] INF |  https://mesa-1.trycloudflare.com  |')
  })

  it('usa a próxima porta livre para o servidor e para a inspeção', async () => {
    const { h, root } = setup({ freePorts: [8790, 9231] })
    const result = await startServing(h, root)
    const server = h.spawns.find((s) => String(s.args[0]).endsWith('wrangler.js'))
    expect(server.args).toEqual(expect.arrayContaining(['--port', '8790', '--inspector-port', '9231']))
    expect(h.fetches.some((f) => f.url === 'http://127.0.0.1:8790/')).toBe(true)
    h.signal()
    expect(await result).toBe(0)
  })
})

describe('run: erros', () => {
  it('portas 8787–8797 ocupadas → mensagem clara e código 1', async () => {
    const { h, root } = setup({ freePorts: [] })
    expect(await run(h.deps, { root, noUpdate: true })).toBe(1)
    expect(h.output.at(-1)).toBe(MSG.portsBusy)
    expect(h.output.at(-1)).toContain('Feche outros programas usando as portas 8787–8797')
    expect(h.children.server).toHaveLength(0)
  })

  it('--port ocupada → código 1', async () => {
    const { h, root } = setup({ freePorts: [8787] })
    expect(await run(h.deps, { root, noUpdate: true, port: 9000 })).toBe(1)
    expect(h.output.at(-1)).toBe(MSG.portBusy(9000))
  })

  it('servidor não responde em 60 s → últimas 20 linhas do log e código 1', async () => {
    const { h, root } = setup({ server: 'never' })
    expect(await run(h.deps, { root, noUpdate: true })).toBe(1)
    expect(h.output).toContain(MSG.serverFailed)
    expect(h.output).toContain('    linha 25')
    expect(h.output).toContain('    linha 6')
    expect(h.output).not.toContain('    linha 5')
    expect(taskkills(h)).toEqual([String(h.children.server[0].pid)])
    expect(h.children.tunnel).toHaveLength(0)
  })

  it('túnel sem URL em 60 s → link local copiado e aberto', async () => {
    const { h, root } = setup({ tunnel: 'silent', timersFireImmediately: true })
    const result = await startServing(h, root)
    expect(h.output).toContain(MSG.tunnelFailed)
    expect(h.clipboard).toEqual(['http://localhost:8787'])
    expect(h.browser[0]).toContain('http://localhost:8787')
    expect(taskkills(h)).toContain(String(h.children.tunnel[0].pid))
    h.signal()
    expect(await result).toBe(0)
  })

  it('cloudflared.exe ausente (erro de spawn) → link local', async () => {
    const { h, root } = setup({ tunnel: 'silent' })
    const result = run(h.deps, { root, noUpdate: true })
    await until(() => h.children.tunnel.length === 1)
    h.children.tunnel[0].emit('error', new Error('spawn ENOENT'))
    await until(() => h.output.includes(MSG.closeHint))
    expect(h.output).toContain(MSG.tunnelFailed)
    expect(h.clipboard).toEqual(['http://localhost:8787'])
    h.signal()
    expect(await result).toBe(0)
  })
})

describe('run: quedas e encerramento', () => {
  it('servidor cai: reinicia uma vez; cai de novo → desliga com código 1', async () => {
    const { h, root } = setup()
    const result = await startServing(h, root)
    h.children.server[0].exit(1)
    await until(() => h.output.filter((l) => l === MSG.serverReady).length === 2, 'reinício')
    expect(h.output.filter((l) => l === MSG.serverCrashed)).toHaveLength(1)
    h.children.server[1].exit(1)
    expect(await result).toBe(1)
    expect(h.output).toContain(MSG.serverGaveUp)
    expect(h.children.server).toHaveLength(2)
  })

  it('túnel cai: reabre uma vez com link novo copiado (sem reabrir o navegador); cai de novo → link local', async () => {
    const { h, root } = setup()
    const result = await startServing(h, root)
    h.children.tunnel[0].exit(1)
    await until(() => h.clipboard.length === 2, 'link novo')
    expect(h.output).toContain(MSG.tunnelCrashed)
    expect(h.clipboard[1]).toBe('https://mesa-2.trycloudflare.com')
    h.children.tunnel[1].exit(1)
    await until(() => h.clipboard.length === 3, 'link local')
    expect(h.output).toContain(MSG.tunnelGaveUp)
    expect(h.clipboard[2]).toBe('http://localhost:8787')
    expect(h.browser).toHaveLength(1)
    expect(h.children.tunnel).toHaveLength(2)
    h.signal()
    expect(await result).toBe(0)
  })

  it('Review Focus 1: Ctrl+C mata os filhos antes do sinal → não reinicia, sai com 0', async () => {
    const { h, root } = setup()
    const result = await startServing(h, root)
    let release = () => {}
    const gate = new Promise((resolve) => { release = resolve })
    let slept = false
    h.deps.sleep = async () => { slept = true; await gate }
    h.children.server[0].exit(1)
    h.children.tunnel[0].exit(1)
    await until(() => slept, 'espera de 1 s após a queda')
    h.signal()
    release()
    expect(await result).toBe(0)
    expect(h.children.server).toHaveLength(1)
    expect(h.children.tunnel).toHaveLength(1)
    expect(h.text()).not.toContain('Tentando reiniciar')
    expect(h.text()).not.toContain('Reabrindo')
  })
})

describe('run: dados, atualização e limpeza', () => {
  it('backup diário: faz na primeira abertura, não repete em 1 h, repete depois de 24 h', async () => {
    const { h, root, dataDir } = setup()
    fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'state', 'mesa.sqlite'), 'dados')
    const backups = () => fs.readdirSync(path.join(dataDir, 'backups'))

    let result = await startServing(h, root)
    expect(backups()).toHaveLength(1)
    expect(h.output).toContain(MSG.backupDone(backups()[0]))
    expect(JSON.parse(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).lastBackup).toBe(new Date(T0).toISOString())
    h.signal()
    await result

    const later = createHarness({ base, dataDir, now: T0 + 60 * 60 * 1000 })
    result = await startServing(later, root)
    expect(backups()).toHaveLength(1)
    later.signal()
    await result

    const nextDay = createHarness({ base, dataDir, now: T0 + 25 * 60 * 60 * 1000 })
    result = await startServing(nextDay, root)
    expect(backups()).toHaveLength(2)
    nextDay.signal()
    await result
  })

  it('Review Focus 4: config.json quebrado → aviso, a mesa abre e o arquivo fica intacto', async () => {
    const { h, root, dataDir } = setup()
    fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'state', 'mesa.sqlite'), 'dados')
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{ "autoUpdate": false, ')
    const result = await startServing(h, root, {})
    expect(h.output).toContain(MSG.configWarning('arquivo inválido; usando o padrão (o arquivo não foi alterado)'))
    expect(fs.readFileSync(path.join(dataDir, 'config.json'), 'utf8')).toBe('{ "autoUpdate": false, ')
    h.signal()
    expect(await result).toBe(0)
  })

  it('apaga app.old depois que o servidor responde e app.new interrompido no início', async () => {
    const { h, root } = setup()
    writeFakeApp(path.join(root, 'app.old'), '0.3.0')
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    const result = await startServing(h, root)
    expect(fs.existsSync(path.join(root, 'app.old'))).toBe(false)
    expect(fs.existsSync(path.join(root, 'app.new'))).toBe(false)
    h.signal()
    await result
  })

  it('troca que falhou antes: avisa, apaga o recado e não consulta o GitHub', async () => {
    const { h, root, dataDir } = setup({ release: releaseFixture('0.5.0') })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'update-failed.txt'), 'arquivo em uso ao trocar a pasta app (EBUSY)')
    const result = await startServing(h, root, {})
    expect(h.output).toContain(MSG.updateFailed('arquivo em uso ao trocar a pasta app (EBUSY)'))
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)
    expect(fs.existsSync(path.join(dataDir, 'update-failed.txt'))).toBe(false)
    h.signal()
    await result
  })

  it('"autoUpdate": false → não consulta o GitHub', async () => {
    const { h, root, dataDir } = setup({ release: releaseFixture('0.5.0') })
    fs.mkdirSync(dataDir, { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'config.json'), '{"autoUpdate": false}')
    const result = await startServing(h, root, {})
    expect(h.output).toContain(MSG.updateDisabled)
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)
    h.signal()
    await result
  })

  it('erro na API do GitHub → uma linha de aviso e a mesa abre', async () => {
    const { h, root } = setup({ release: new TypeError('fetch failed') })
    const result = await startServing(h, root, {})
    expect(h.output).toContain(MSG.updateCheckFailed('sem conexão'))
    expect(h.output).toContain(MSG.closeHint)
    h.signal()
    expect(await result).toBe(0)
  })

  it('recusa a atualização → a mesa abre na versão atual', async () => {
    const { h, root } = setup({ release: releaseFixture('0.5.0'), answer: 'n' })
    const result = await startServing(h, root, {})
    expect(h.output).toContain('Versão 0.5.0 disponível (atual 0.4.0). Atualizar agora? [S/n] ')
    expect(h.output).toContain(MSG.updateDeclined)
    h.signal()
    expect(await result).toBe(0)
  })

  it('aceita a atualização → sai com 75 sem subir o servidor', async () => {
    const { h, root } = setup({ release: releaseFixture('0.5.0'), answer: '' })
    expect(await run(h.deps, { root })).toBe(75)
    expect(fs.readFileSync(path.join(root, 'app.new', 'version.txt'), 'utf8').trim()).toBe('0.5.0')
    expect(h.children.server).toHaveLength(0)
  })

  it('--apply-update troca app e não mostra cabeçalho', async () => {
    const { h, root } = setup()
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    expect(await run(h.deps, { root, applyUpdate: true })).toBe(0)
    expect(fs.readFileSync(path.join(root, 'app', 'version.txt'), 'utf8').trim()).toBe('0.5.0')
    expect(h.output).toEqual([MSG.updateApplied])
  })
})

describe('run --smoke', () => {
  it('só servidor: POST /api/tables → 201, desliga e sai com 0', async () => {
    const { h, root, dataDir } = setup({ release: releaseFixture('0.5.0') })
    fs.mkdirSync(path.join(dataDir, 'state'), { recursive: true })
    fs.writeFileSync(path.join(dataDir, 'state', 'mesa.sqlite'), 'dados')
    expect(await run(h.deps, { root, smoke: true, port: 18787 })).toBe(0)
    const post = h.fetches.find((f) => f.method === 'POST')
    expect(post.url).toBe('http://127.0.0.1:18787/api/tables')
    expect(JSON.parse(post.body)).toEqual({ name: 'Teste de fumaça' })
    expect(h.fetches.some((f) => f.url.startsWith('https://api.github.com/'))).toBe(false)
    expect(h.children.tunnel).toHaveLength(0)
    expect(h.clipboard).toHaveLength(0)
    expect(h.browser).toHaveLength(0)
    expect(fs.existsSync(path.join(dataDir, 'backups'))).toBe(false)
    expect(taskkills(h)).toEqual([String(h.children.server[0].pid)])
    expect(h.output).toContain(MSG.smokeOk)
  })

  it('status diferente de 201 → código 1', async () => {
    const { h, root } = setup({ tableStatus: 500 })
    expect(await run(h.deps, { root, smoke: true, port: 18787 })).toBe(1)
    expect(h.output).toContain(MSG.smokeFailed('POST /api/tables respondeu 500'))
  })
})
```

`apps/launcher/test/entry.test.mjs`:

```js
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { makePackage, makeTmp, writeFakeApp } from './harness.mjs'

const launcher = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'launcher.mjs')
let base
afterEach(() => {
  if (base) fs.rmSync(base, { recursive: true, force: true })
  base = undefined
})

describe('launcher.mjs (processo Node real, sem servidor)', () => {
  it('argumento inválido → código 2 e mensagem', () => {
    const r = spawnSync(process.execPath, [launcher, '--turbo'], { encoding: 'utf8' })
    expect(r.status).toBe(2)
    expect(r.stderr).toContain('✗ opção desconhecida: --turbo')
  })

  it('--apply-update troca app\\ e sai com 0', () => {
    base = makeTmp()
    const root = makePackage(base, '0.4.0')
    writeFakeApp(path.join(root, 'app.new'), '0.5.0')
    const dataDir = path.join(base, 'dados')
    const r = spawnSync(process.execPath, [launcher, '--root', root, '--apply-update'], {
      encoding: 'utf8',
      env: { ...process.env, MESA_DATA_DIR: dataDir },
    })
    expect(r.status).toBe(0)
    expect(r.stdout).toContain('✓ Atualização instalada.')
    expect(fs.readFileSync(path.join(root, 'app', 'version.txt'), 'utf8').trim()).toBe('0.5.0')
    expect(fs.readFileSync(path.join(root, 'app.old', 'version.txt'), 'utf8').trim()).toBe('0.4.0')
    expect(fs.readFileSync(path.join(dataDir, 'logs', 'launcher.log'), 'utf8')).toContain('atualização aplicada')
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @mesa/launcher test -- main entry`
Expected: FAIL — `Failed to load url ../src/main.mjs`; o teste de entrada falha com `Cannot find module …/launcher.mjs`.

- [ ] **Step 3: Implementar `main.mjs`**

`apps/launcher/src/main.mjs`:

```js
import path from 'node:path'
import { backupDue, backupNow } from './backup.mjs'
import { dataPaths, readConfig } from './config.mjs'
import { createLogger, createTail } from './log.mjs'
import { MSG } from './messages.mjs'
import { INSPECTOR_FIRST, INSPECTOR_LAST, pickPort } from './ports.mjs'
import {
  copyToClipboard, killTree, launch, openBrowser, serverCommand, serverEnv, tunnelCommand, waitForServer,
} from './processes.mjs'
import { readVersion } from './semver.mjs'
import { UPDATE_EXIT_CODE, appPaths, removeLeftovers, removeOldApp } from './swap.mjs'
import { findTunnelUrl } from './tunnel-url.mjs'
import { applyUpdate, checkForUpdate, consumeUpdateFailure } from './update.mjs'

/**
 * @typedef {object} Deps
 * @property {typeof import('node:fs')} fs
 * @property {typeof import('node:child_process').spawn} spawn
 * @property {typeof fetch} fetch
 * @property {() => number} now
 * @property {(ms: number) => Promise<void>} sleep
 * @property {(ms: number) => void} sleepSync
 * @property {(fn: () => void, ms: number) => () => void} setTimer
 * @property {string} platform
 * @property {Record<string, string | undefined>} env
 * @property {string} homedir
 * @property {string} tmpdir
 * @property {string} execPath
 * @property {string} launcherDir
 * @property {(port: number) => Promise<boolean>} isPortFree
 * @property {(question: string) => Promise<string>} ask
 * @property {(line: string) => void} print
 * @property {(handler: () => void) => void} onExitSignal
 *
 * @typedef {{ dataDir: string, stateDir: string, backupsDir: string, logsDir: string,
 *   logFile: string, configFile: string, updateFailedFile: string }} DataPaths
 * @typedef {{ autoUpdate: boolean, lastBackup: string | null, [key: string]: unknown }} Config
 * @typedef {{ write(text: string): void }} Logger
 * @typedef {{ root: string, paths: DataPaths, version: string, config: Config,
 *   configWritable: boolean, log: Logger }} Ctx
 * @typedef {{ version: string, url: string, size: number, name: string }} UpdateAsset
 * @typedef {{ child: import('node:child_process').ChildProcess, exited: Promise<number | null>,
 *   isAlive(): boolean }} ManagedProcess
 * @typedef {{ smoke: boolean, noUpdate: boolean, applyUpdate: boolean,
 *   port: number | undefined, root: string | undefined }} LauncherOptions
 */

export const TUNNEL_TIMEOUT_MS = 60_000
export const EXIT_GRACE_MS = 1_000

/** @param {Deps} deps @param {LauncherOptions} opts @returns {Promise<number>} */
export async function run(deps, opts) {
  const { fs } = deps
  const root = path.resolve(opts.root ?? path.join(deps.launcherDir, '..', '..'))
  const paths = dataPaths(deps.env, deps.homedir)
  fs.mkdirSync(paths.stateDir, { recursive: true })
  const log = createLogger(fs, paths.logFile, { now: deps.now })
  if (opts.applyUpdate) return applyUpdate(deps, root, paths, log)

  const { app } = appPaths(root)
  const version = readVersion(fs, path.join(app, 'version.txt'))
  deps.print(MSG.header(version))
  log.write(`início v${version} ${JSON.stringify(opts)}`)
  removeLeftovers(fs, root)

  const { config, warnings, writable } = readConfig(fs, paths.configFile)
  for (const warning of warnings) deps.print(MSG.configWarning(warning))
  /** @type {Ctx} */
  const ctx = { root, paths, version, config, configWritable: writable, log }

  if (!opts.smoke) {
    const failure = consumeUpdateFailure(fs, paths)
    if (failure) deps.print(MSG.updateFailed(failure))
    else if (opts.noUpdate) deps.print(MSG.updateSkippedFlag)
    else if (!config.autoUpdate) deps.print(MSG.updateDisabled)
    else if (await checkForUpdate(deps, ctx)) return UPDATE_EXIT_CODE
    dailyBackup(deps, ctx)
  }

  const port = await pickPort(deps.isPortFree, { forced: opts.port })
  if (port === null) {
    deps.print(opts.port === undefined ? MSG.portsBusy : MSG.portBusy(opts.port))
    return 1
  }
  const inspectorPort = await pickPort((p) => (p === port ? Promise.resolve(false) : deps.isPortFree(p)), {
    first: INSPECTOR_FIRST,
    last: INSPECTOR_LAST,
  })
  const session = createSession(deps, ctx, { app, port, inspectorPort: inspectorPort ?? undefined })
  return opts.smoke ? session.smoke() : session.serve()
}

function dailyBackup(deps, ctx) {
  if (!backupDue(ctx.config.lastBackup, deps.now())) return
  try {
    const name = backupNow(deps, ctx)
    if (name) deps.print(MSG.backupDone(name))
  } catch (err) {
    ctx.log.write(`backup falhou: ${err?.stack ?? err}`)
    deps.print(MSG.backupFailed(err?.message ?? String(err)))
  }
}

function createSession(deps, ctx, { app, port, inspectorPort }) {
  const { log } = ctx
  const serverDir = path.join(app, 'server')
  const localUrl = `http://localhost:${port}`
  const tail = createTail(20)
  /** @type {ManagedProcess | null} */
  let server = null
  /** @type {ManagedProcess | null} */
  let tunnel = null
  let shuttingDown = false
  let serverRestarted = false
  let tunnelRestarted = false
  let finish = (_code) => {}
  const done = new Promise((resolve) => { finish = resolve })

  async function bootServer() {
    deps.print(MSG.serverStarting(port))
    const { command, args } = serverCommand({
      execPath: deps.execPath, serverDir, port, inspectorPort, stateDir: ctx.paths.stateDir,
    })
    const proc = launch(deps, command, args, { cwd: serverDir, env: serverEnv(deps.env, ctx.paths.logsDir) }, (line) => {
      tail.push(line)
      log.write(`[servidor] ${line}`)
    })
    server = proc
    const ok = await waitForServer(deps, `http://127.0.0.1:${port}/`, { isAlive: proc.isAlive })
    if (ok) {
      deps.print(MSG.serverReady)
      return true
    }
    if (shuttingDown) return false
    deps.print(MSG.serverFailed)
    for (const line of tail.lines()) deps.print(`    ${line}`)
    await killTree(deps, proc)
    return false
  }

  async function openTunnel() {
    deps.print(MSG.tunnelStarting)
    const { command, args } = tunnelCommand({ cloudflaredPath: path.join(app, 'cloudflared.exe'), port })
    let resolveUrl = (_url) => {}
    const urlPromise = new Promise((resolve) => { resolveUrl = resolve })
    const proc = launch(deps, command, args, { cwd: app, env: deps.env }, (line) => {
      log.write(`[túnel] ${line}`)
      const found = findTunnelUrl(line)
      if (found) resolveUrl(found)
    })
    tunnel = proc
    proc.exited.then(() => resolveUrl(null))
    const cancel = deps.setTimer(() => resolveUrl(null), TUNNEL_TIMEOUT_MS)
    const link = await urlPromise
    cancel()
    if (link) {
      deps.print(MSG.tunnelReady)
      return link
    }
    await killTree(deps, proc)
    return null
  }

  async function announce(link, { browser }) {
    deps.print('')
    deps.print(MSG.linkTitle)
    deps.print(`    ${link}`)
    deps.print('')
    log.write(`link: ${link}`)
    if (await copyToClipboard(deps, link)) deps.print(MSG.copied)
    if (browser) openBrowser(deps, link)
  }

  async function shutdown(code) {
    if (shuttingDown) return
    shuttingDown = true
    deps.print(MSG.shuttingDown)
    await killTree(deps, tunnel)
    await killTree(deps, server)
    log.write(`fim (código ${code})`)
    deps.print(MSG.bye)
    finish(code)
  }

  function watchServer(proc) {
    proc.exited.then(async (code) => {
      if (shuttingDown || proc !== server) return
      log.write(`servidor saiu sozinho (código ${code})`)
      await deps.sleep(EXIT_GRACE_MS)
      if (shuttingDown) return
      if (serverRestarted) {
        deps.print(MSG.serverGaveUp)
        await shutdown(1)
        return
      }
      serverRestarted = true
      deps.print(MSG.serverCrashed)
      if (await bootServer()) {
        watchServer(server)
      } else if (!shuttingDown) {
        deps.print(MSG.serverGaveUp)
        await shutdown(1)
      }
    })
  }

  function watchTunnel(proc) {
    proc.exited.then(async (code) => {
      if (shuttingDown || proc !== tunnel) return
      log.write(`túnel saiu sozinho (código ${code})`)
      await deps.sleep(EXIT_GRACE_MS)
      if (shuttingDown) return
      if (tunnelRestarted) {
        deps.print(MSG.tunnelGaveUp)
        await announce(localUrl, { browser: false })
        return
      }
      tunnelRestarted = true
      deps.print(MSG.tunnelCrashed)
      const link = await openTunnel()
      if (shuttingDown) return
      if (link) {
        await announce(link, { browser: false })
        watchTunnel(tunnel)
      } else {
        deps.print(MSG.tunnelGaveUp)
        await announce(localUrl, { browser: false })
      }
    })
  }

  async function serve() {
    deps.onExitSignal(() => { void shutdown(0) })
    const ok = await bootServer()
    if (shuttingDown) return done
    if (!ok) return 1
    if (removeOldApp(deps.fs, ctx.root)) log.write('versão anterior (app.old) removida')
    watchServer(server)
    const link = await openTunnel()
    if (shuttingDown) return done
    if (link) watchTunnel(tunnel)
    else deps.print(MSG.tunnelFailed)
    await announce(link ?? localUrl, { browser: true })
    deps.print(MSG.closeHint)
    return done
  }

  async function smoke() {
    const ok = await bootServer()
    if (!ok) return 1
    let code = 1
    try {
      const res = await deps.fetch(`http://127.0.0.1:${port}/api/tables`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Teste de fumaça' }),
        signal: AbortSignal.timeout(10_000),
      })
      if (res.status === 201) {
        deps.print(MSG.smokeOk)
        code = 0
      } else {
        deps.print(MSG.smokeFailed(`POST /api/tables respondeu ${res.status}`))
      }
    } catch (err) {
      deps.print(MSG.smokeFailed(err?.message ?? String(err)))
    }
    shuttingDown = true
    await killTree(deps, server)
    log.write(`fumaça: código ${code}`)
    return code
  }

  return { serve, smoke }
}
```

- [ ] **Step 4: Implementar `deps.mjs` e `launcher.mjs`**

`apps/launcher/src/deps.mjs`:

```js
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import readline from 'node:readline/promises'
import { isPortFree } from './ports.mjs'

async function ask(question) {
  if (!process.stdin.isTTY) {
    process.stdout.write(`${question}n (sem teclado)\n`)
    return 'n'
  }
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => {
    rl.close()
    process.exit(130)
  })
  try {
    return await rl.question(question)
  } finally {
    rl.close()
  }
}

/** @returns {import('./main.mjs').Deps} */
export function createRealDeps(launcherDir) {
  return {
    fs,
    spawn,
    fetch: (input, init) => globalThis.fetch(input, init),
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    sleepSync: (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
    setTimer: (fn, ms) => {
      const timer = setTimeout(fn, ms)
      return () => clearTimeout(timer)
    },
    platform: process.platform,
    env: process.env,
    homedir: os.homedir(),
    tmpdir: os.tmpdir(),
    execPath: process.execPath,
    launcherDir,
    isPortFree,
    ask,
    print: (line) => { process.stdout.write(`${line}\n`) },
    // SIGHUP = fechar a janela do console no Windows; SIGBREAK = Ctrl+Break.
    onExitSignal: (handler) => {
      for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGBREAK']) process.on(signal, handler)
    },
  }
}
```

`apps/launcher/src/launcher.mjs`:

```js
// Mesa Virtual — launcher do pacote Windows. Chamado pelo "Iniciar Mesa.cmd":
//   app\node\node.exe app\launcher\launcher.mjs --root "<pasta do pacote>" [--smoke] [--no-update] [--port N]
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ArgError, parseArgs } from './args.mjs'
import { createRealDeps } from './deps.mjs'
import { run } from './main.mjs'

const launcherDir = path.dirname(fileURLToPath(import.meta.url))

/** Sai com o código sem cortar o console (no Windows a escrita no TTY é assíncrona). */
function exitWith(code) {
  process.exitCode = code
  setTimeout(() => process.exit(code), 1_000).unref()
}

let opts
try {
  opts = parseArgs(process.argv.slice(2))
} catch (err) {
  process.stderr.write(`✗ ${err instanceof ArgError ? err.message : String(err)}\n`)
  process.exit(2)
}

run(createRealDeps(launcherDir), opts).then(exitWith, (err) => {
  process.stderr.write(`✗ Erro inesperado: ${err?.stack ?? err}\n`)
  exitWith(1)
})
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `pnpm --filter @mesa/launcher test`
Expected: PASS (todos os arquivos, inclusive `main` e `entry`).

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 6: Commit**

```bash
git add apps/launcher/src/main.mjs apps/launcher/src/deps.mjs apps/launcher/src/launcher.mjs apps/launcher/test/main.test.mjs apps/launcher/test/entry.test.mjs
git commit -m "feat(win): Task 5 — launcher: orquestração, encerramento e ponto de entrada" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 6: Montagem do pacote (script de build, `Iniciar Mesa.cmd`, versão)

**Files:**
- Create: `scripts/win-package/lib.mjs`, `scripts/build-win-package.mjs`, `scripts/win/Iniciar Mesa.cmd`, `version.txt`, `.gitattributes`
- Modify: `package.json` (raiz: `"version": "0.3.0"` + script `win:package`), `.gitignore` (+ `dist-win/`)
- Test: `apps/launcher/test/win-package.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1: `assetName(version)` (re-exportado por `lib.mjs`).
  - Task 2: `UPDATE_EXIT_CODE`.
  - Task 4: `STAGING_DIR_NAME`.
  - Task 5: linha de comando do `launcher.mjs` (`--root`, `--apply-update`).
- Produces:
  - `PINS.node = { version: '24.12.0', url, file, dir, sha256 }` e `PINS.cloudflared = { version: '2026.10.0', url, file, sha256 }`.
  - `sha256File(file): Promise<string>`, `assertSha256(actual, expected, label): void`.
  - `stripJsonComments(text): string`, `serverWranglerConfig(sourceText): object`, `serverPackageJson(wranglerVersion): object`, `toCrlf(text): string`, `assetName`.
  - `pnpm win:package` → `dist-win/MesaVirtual/…` + `dist-win/MesaVirtual-vX.Y.Z-win64.zip` (só no Windows, depois de `pnpm build`). A Task 7 usa.
  - `version.txt` (`0.3.0`), usado pelas Tasks 7 e 8.

- [ ] **Step 1: Escrever os testes que falham**

`apps/launcher/test/win-package.test.mjs`:

```js
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import {
  PINS, assertSha256, assetName, serverPackageJson, serverWranglerConfig, sha256File, stripJsonComments, toCrlf,
} from '../../../scripts/win-package/lib.mjs'
import { UPDATE_EXIT_CODE } from '../src/swap.mjs'
import { STAGING_DIR_NAME } from '../src/update.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const read = (...p) => fs.readFileSync(path.join(repo, ...p), 'utf8')

describe('pins', () => {
  it('Node portátil na mesma major do projeto; versões nas URLs; SHA-256 em hex', () => {
    expect(PINS.node.version.split('.')[0]).toBe(process.versions.node.split('.')[0])
    expect(PINS.node.url).toBe(`https://nodejs.org/dist/v${PINS.node.version}/node-v${PINS.node.version}-win-x64.zip`)
    expect(PINS.node.dir).toBe(`node-v${PINS.node.version}-win-x64`)
    expect(PINS.cloudflared.url).toBe(
      `https://github.com/cloudflare/cloudflared/releases/download/${PINS.cloudflared.version}/cloudflared-windows-amd64.exe`,
    )
    for (const pin of [PINS.node, PINS.cloudflared]) expect(pin.sha256).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('checksum', () => {
  it('sha256File + assertSha256', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mesa-sha-'))
    const file = path.join(dir, 'abc.txt')
    fs.writeFileSync(file, 'abc')
    const digest = await sha256File(file)
    expect(digest).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(() => assertSha256(digest, digest.toUpperCase(), 'abc.txt')).not.toThrow()
    expect(() => assertSha256(digest, '0'.repeat(64), 'abc.txt')).toThrow(
      `checksum de abc.txt não confere: esperado ${'0'.repeat(64)}, obtido ${digest}`,
    )
    fs.rmSync(dir, { recursive: true, force: true })
  })
})

describe('configuração do servidor no pacote', () => {
  it('stripJsonComments tira comentários e vírgulas sobrando, mas preserva "//" dentro de strings', () => {
    const text = '{\n  // comentário\n  "url": "https://x//y", /* bloco */ "a": [1, 2,],\n}'
    expect(JSON.parse(stripJsonComments(text))).toEqual({ url: 'https://x//y', a: [1, 2] })
  })

  it('wrangler.jsonc do pacote aponta para o bundle e para web/, mantendo bindings', () => {
    const source = JSON.parse(stripJsonComments(read('apps', 'worker', 'wrangler.jsonc')))
    const cfg = serverWranglerConfig(read('apps', 'worker', 'wrangler.jsonc'))
    expect(cfg.$schema).toBeUndefined()
    expect(cfg.main).toBe('worker/index.js')
    expect(cfg.assets).toEqual({ ...source.assets, directory: 'web' })
    expect(cfg.durable_objects).toEqual(source.durable_objects)
    expect(cfg.migrations).toEqual(source.migrations)
    expect(cfg.r2_buckets).toEqual(source.r2_buckets)
    expect(cfg.compatibility_date).toBe(source.compatibility_date)
  })

  it('package.json do servidor depende só do wrangler na versão exata instalada', () => {
    const installed = JSON.parse(read('apps', 'worker', 'node_modules', 'wrangler', 'package.json')).version
    expect(installed).toMatch(/^4\.148\./)
    expect(serverPackageJson(installed)).toEqual({
      name: 'mesa-virtual-server', version: '0.0.0', private: true, type: 'module', dependencies: { wrangler: installed },
    })
  })
})

describe('Iniciar Mesa.cmd (contrato congelado com o launcher)', () => {
  const cmd = read('scripts', 'win', 'Iniciar Mesa.cmd')

  it('só ASCII e CRLF depois de toCrlf', () => {
    expect(cmd).toMatch(/^[\x00-\x7F]*$/)
    expect(toCrlf('a\nb\r\nc\n')).toBe('a\r\nb\r\nc\r\n')
    expect(toCrlf(cmd).split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
  })

  it('roda o launcher com --root e aplica a atualização pelo %TEMP% no código 75', () => {
    expect(cmd).toContain('"app\\node\\node.exe" "app\\launcher\\launcher.mjs" --root "%~dp0." %*')
    expect(cmd).toContain(`if "%CODE%"=="${UPDATE_EXIT_CODE}" (`)
    expect(cmd).toContain(
      `"%TEMP%\\${STAGING_DIR_NAME}\\node.exe" "%TEMP%\\${STAGING_DIR_NAME}\\launcher\\launcher.mjs" --root "%~dp0." --apply-update`,
    )
    expect(cmd).toContain('if not exist "app\\node\\node.exe" if exist "app.old\\node\\node.exe" ren "app.old" "app"')
    expect(cmd).toContain('pause')
  })
})

describe('versão e build', () => {
  it('version.txt = "version" do package.json raiz; nome do zip', () => {
    const version = read('version.txt').trim()
    expect(version).toMatch(/^\d+\.\d+\.\d+$/)
    expect(JSON.parse(read('package.json')).version).toBe(version)
    expect(assetName(version)).toBe(`MesaVirtual-v${version}-win64.zip`)
  })

  it.skipIf(process.platform === 'win32')('fora do Windows o build recusa com mensagem clara', () => {
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'build-win-package.mjs')], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('monte o pacote no Windows')
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @mesa/launcher test -- win-package`
Expected: FAIL — `Failed to load url ../../../scripts/win-package/lib.mjs`.

- [ ] **Step 3: Criar `lib.mjs`**

`scripts/win-package/lib.mjs`:

```js
import crypto from 'node:crypto'
import fs from 'node:fs'

export { assetName } from '../../apps/launcher/src/release.mjs'

// Versões e SHA-256 fixados. Node: https://nodejs.org/dist/v24.12.0/SHASUMS256.txt
// cloudflared: campo "digest" do asset em https://api.github.com/repos/cloudflare/cloudflared/releases/tags/2026.10.0
export const PINS = {
  node: {
    version: '24.12.0',
    url: 'https://nodejs.org/dist/v24.12.0/node-v24.12.0-win-x64.zip',
    file: 'node-v24.12.0-win-x64.zip',
    dir: 'node-v24.12.0-win-x64',
    sha256: '9c125f61ae947b52e779095830f9cac267846a043ef7192183c84016aaad2812',
  },
  cloudflared: {
    version: '2026.10.0',
    url: 'https://github.com/cloudflare/cloudflared/releases/download/2026.10.0/cloudflared-windows-amd64.exe',
    file: 'cloudflared-windows-amd64.exe',
    sha256: '86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c',
  },
}

export function sha256File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256')
    fs.createReadStream(file)
      .on('error', reject)
      .on('data', (chunk) => hash.update(chunk))
      .on('end', () => resolve(hash.digest('hex')))
  })
}

export function assertSha256(actual, expected, label) {
  if (actual.toLowerCase() !== expected.toLowerCase()) {
    throw new Error(`checksum de ${label} não confere: esperado ${expected}, obtido ${actual}`)
  }
}

/** JSONC → JSON: tira // e /* */ fora de strings e vírgulas antes de } ou ]. */
export function stripJsonComments(text) {
  let out = ''
  let inString = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    const next = text[i + 1]
    if (inString) {
      out += c
      if (c === '\\') {
        out += next ?? ''
        i++
      } else if (c === '"') {
        inString = false
      }
      continue
    }
    if (c === '"') {
      inString = true
      out += c
    } else if (c === '/' && next === '/') {
      while (i < text.length && text[i] !== '\n') i++
      out += '\n'
    } else if (c === '/' && next === '*') {
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++
      i++
    } else {
      out += c
    }
  }
  return out.replace(/,(\s*[}\]])/g, '$1')
}

/** wrangler.jsonc do pacote: Worker pré-empacotado em worker/index.js e front em web/. */
export function serverWranglerConfig(sourceText) {
  const config = JSON.parse(stripJsonComments(sourceText))
  delete config.$schema
  config.main = 'worker/index.js'
  config.assets = { ...config.assets, directory: 'web' }
  return config
}

export function serverPackageJson(wranglerVersion) {
  return {
    name: 'mesa-virtual-server',
    version: '0.0.0',
    private: true,
    type: 'module',
    dependencies: { wrangler: wranglerVersion },
  }
}

export function toCrlf(text) {
  return text.replace(/\r?\n/g, '\r\n')
}
```

- [ ] **Step 4: Criar o `Iniciar Mesa.cmd`**

`scripts/win/Iniciar Mesa.cmd` (só ASCII; o build converte para CRLF e o `.gitattributes` também):

```bat
@echo off
setlocal
title Mesa Virtual
cd /d "%~dp0"

:run
if not exist "app\node\node.exe" if exist "app.old\node\node.exe" ren "app.old" "app"
"app\node\node.exe" "app\launcher\launcher.mjs" --root "%~dp0." %*
set "CODE=%ERRORLEVEL%"

if "%CODE%"=="75" (
  "%TEMP%\MesaVirtual-update\node.exe" "%TEMP%\MesaVirtual-update\launcher\launcher.mjs" --root "%~dp0." --apply-update
  goto run
)

if not "%CODE%"=="0" (
  echo.
  echo A mesa foi encerrada com erro ^(codigo %CODE%^).
  echo Registro: "%LOCALAPPDATA%\MesaVirtual\logs\launcher.log"
  pause
)
endlocal & exit /b %CODE%
```

`.gitattributes`:

```
*.cmd text eol=crlf
```

- [ ] **Step 5: Criar o script de build**

`scripts/build-win-package.mjs`:

```js
#!/usr/bin/env node
// Monta dist-win/MesaVirtual e dist-win/MesaVirtual-vX.Y.Z-win64.zip.
// Só roda no Windows (CI windows-latest): o node_modules do servidor precisa do workerd win-x64,
// que o npm só instala na plataforma certa. Pré-requisito: `pnpm build` (apps/web/dist).
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { fileURLToPath } from 'node:url'
import {
  PINS, assertSha256, assetName, serverPackageJson, serverWranglerConfig, sha256File, toCrlf,
} from './win-package/lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const out = path.join(repo, 'dist-win')

function sh(command, cwd = repo) {
  console.log(`> ${command}`)
  const result = spawnSync(command, {
    cwd, shell: true, stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  if (result.status !== 0) throw new Error(`comando falhou (${result.status}): ${command}`)
}

async function downloadVerified(pin, dir) {
  const file = path.join(dir, pin.file)
  console.log(`> baixando ${pin.url}`)
  const res = await fetch(pin.url, { headers: { 'User-Agent': 'mesa-virtual-build' } })
  if (!res.ok || !res.body) throw new Error(`download falhou (${res.status}): ${pin.url}`)
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(file))
  assertSha256(await sha256File(file), pin.sha256, pin.file)
  console.log(`✓ SHA-256 de ${pin.file} confere`)
  return file
}

async function main() {
  if (process.platform !== 'win32') {
    throw new Error('monte o pacote no Windows (o CI usa windows-latest): o servidor precisa do workerd win-x64')
  }
  const version = fs.readFileSync(path.join(repo, 'version.txt'), 'utf8').trim()
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error(`version.txt inválido: "${version}"`)
  const webDist = path.join(repo, 'apps', 'web', 'dist')
  if (!fs.existsSync(path.join(webDist, 'index.html'))) throw new Error('apps/web/dist não existe: rode `pnpm build` antes')

  fs.rmSync(out, { recursive: true, force: true })
  const pkg = path.join(out, 'MesaVirtual')
  const app = path.join(pkg, 'app')
  const server = path.join(app, 'server')
  const downloads = path.join(out, 'downloads')
  const bundle = path.join(out, 'worker-bundle')
  fs.mkdirSync(server, { recursive: true })
  fs.mkdirSync(downloads, { recursive: true })

  // 1. Worker pré-empacotado (zod e @mesa/shared embutidos; cloudflare:workers externo)
  sh(`pnpm --filter @mesa/worker exec wrangler deploy --dry-run --outdir "${bundle}"`)
  fs.mkdirSync(path.join(server, 'worker'))
  for (const f of ['index.js', 'index.js.map']) fs.copyFileSync(path.join(bundle, f), path.join(server, 'worker', f))

  // 2. Front compilado
  fs.cpSync(webDist, path.join(server, 'web'), { recursive: true })

  // 3. package.json + wrangler.jsonc do servidor
  const wranglerPkg = path.join(repo, 'apps', 'worker', 'node_modules', 'wrangler', 'package.json')
  const wranglerVersion = JSON.parse(fs.readFileSync(wranglerPkg, 'utf8')).version
  fs.writeFileSync(path.join(server, 'package.json'), `${JSON.stringify(serverPackageJson(wranglerVersion), null, 2)}\n`)
  const sourceConfig = fs.readFileSync(path.join(repo, 'apps', 'worker', 'wrangler.jsonc'), 'utf8')
  fs.writeFileSync(path.join(server, 'wrangler.jsonc'), `${JSON.stringify(serverWranglerConfig(sourceConfig), null, 2)}\n`)

  // 4. Dependências de produção instaladas NESTE Windows (traz @cloudflare/workerd-windows-64)
  sh('npm install --omit=dev --no-audit --no-fund --loglevel=error', server)
  const workerdExe = path.join(server, 'node_modules', '@cloudflare', 'workerd-windows-64', 'bin', 'workerd.exe')
  if (!fs.existsSync(workerdExe)) throw new Error(`workerd win-x64 ausente: ${workerdExe}`)

  // 5. Node portátil (só node.exe + LICENSE)
  const nodeZip = await downloadVerified(PINS.node, downloads)
  const tar = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe')
  execFileSync(tar, ['-xf', nodeZip, '-C', downloads], { stdio: 'inherit' })
  fs.mkdirSync(path.join(app, 'node'))
  for (const f of ['node.exe', 'LICENSE']) {
    fs.copyFileSync(path.join(downloads, PINS.node.dir, f), path.join(app, 'node', f))
  }

  // 6. cloudflared
  fs.copyFileSync(await downloadVerified(PINS.cloudflared, downloads), path.join(app, 'cloudflared.exe'))

  // 7. launcher (src inteiro, sem testes)
  const launcherSrc = path.join(repo, 'apps', 'launcher', 'src')
  fs.mkdirSync(path.join(app, 'launcher'))
  for (const f of fs.readdirSync(launcherSrc)) {
    if (f.endsWith('.mjs')) fs.copyFileSync(path.join(launcherSrc, f), path.join(app, 'launcher', f))
  }

  // 8. Versão + ponto de entrada (CRLF)
  fs.writeFileSync(path.join(app, 'version.txt'), `${version}\n`)
  const cmd = fs.readFileSync(path.join(repo, 'scripts', 'win', 'Iniciar Mesa.cmd'), 'utf8')
  fs.writeFileSync(path.join(pkg, 'Iniciar Mesa.cmd'), toCrlf(cmd))

  // 9. Zip (7z vem no windows-latest)
  const zip = path.join(out, assetName(version))
  execFileSync('7z', ['a', '-tzip', '-mx=5', zip, 'MesaVirtual'], { cwd: out, stdio: 'inherit' })
  console.log(`✓ ${zip} (${(fs.statSync(zip).size / 1_048_576).toFixed(1)} MB)`)
}

main().catch((err) => {
  console.error(`✗ ${err.message}`)
  process.exit(1)
})
```

- [ ] **Step 6: Versão, scripts e ignore**

`version.txt`:

```
0.3.0
```

`package.json` (raiz), conteúdo completo:

```json
{
  "name": "mesa-virtual",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "dev:worker": "pnpm --filter @mesa/worker dev",
    "dev:web": "pnpm --filter @mesa/web dev",
    "build": "pnpm --filter @mesa/web build",
    "build:e2e": "pnpm --filter @mesa/web exec vite build --outDir dist-e2e --emptyOutDir",
    "e2e": "playwright test",
    "deploy": "pnpm build && pnpm --filter @mesa/worker run deploy",
    "host": "pnpm build && pnpm --filter @mesa/worker exec wrangler dev --ip 0.0.0.0 --port 8787",
    "tunnel": "cloudflared tunnel --url http://localhost:8787",
    "win:package": "node scripts/build-win-package.mjs"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "typescript": "^7.0.2"
  }
}
```

`.gitignore`: acrescente ao final a linha:

```
dist-win/
```

- [ ] **Step 7: Rodar os testes e ver passar**

Run: `pnpm --filter @mesa/launcher test`
Expected: PASS (no Linux, o teste "fora do Windows o build recusa" roda e passa).

Run: `git check-attr eol -- "scripts/win/Iniciar Mesa.cmd"`
Expected: `scripts/win/Iniciar Mesa.cmd: eol: crlf`

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 8: Commit**

```bash
git add scripts/win-package/lib.mjs scripts/build-win-package.mjs "scripts/win/Iniciar Mesa.cmd" version.txt .gitattributes package.json .gitignore apps/launcher/test/win-package.test.mjs
git commit -m "feat(win): Task 6 — montagem do pacote e Iniciar Mesa.cmd" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---
### Task 7: Workflow de Release no GitHub Actions (Windows, fumaça, Release)

**Files:**
- Create: `.github/workflows/release.yml`
- Test: `apps/launcher/test/workflow.test.mjs`

**Interfaces:**
- Consumes:
  - Task 5: `launcher.mjs --root <pacote> --smoke --port 18787` com `MESA_DATA_DIR`.
  - Task 6: `pnpm win:package` (→ `dist-win\MesaVirtual-v<versão>-win64.zip`), `version.txt`, `PINS.node.version`, `assetName`.
- Produces: em cada tag `vX.Y.Z` enviada, uma Release `vX.Y.Z` com `MesaVirtual-vX.Y.Z-win64.zip` e notas geradas a partir dos commits. A Task 10 dispara.

- [ ] **Step 1: Escrever o teste que falha**

`apps/launcher/test/workflow.test.mjs`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PINS, assetName } from '../../../scripts/win-package/lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const workflowFile = path.join(repo, '.github', 'workflows', 'release.yml')

describe('release.yml', () => {
  it('existe e segue o spec (tag v*, windows-latest, contents: write)', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    expect(yml).toMatch(/on:\s*\n\s*push:\s*\n\s*tags:\s*\['v\*'\]/)
    expect(yml).toMatch(/runs-on:\s*windows-latest/)
    expect(yml).toMatch(/permissions:\s*\n\s*contents:\s*write/)
  })

  it('Node do CI = Node portátil do pacote; pnpm 12; lockfile congelado', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    expect(yml).toContain(`node-version: ${PINS.node.version}`)
    expect(yml).toMatch(/version:\s*12\.\d+\.\d+/)
    expect(yml).toContain('pnpm install --frozen-lockfile')
  })

  it('confere a tag, testa, monta, faz a fumaça no zip extraído e publica', () => {
    const yml = fs.readFileSync(workflowFile, 'utf8')
    const order = [
      'version.txt', 'pnpm typecheck', 'pnpm test', 'pnpm build', 'pnpm win:package',
      '--smoke --port 18787', 'gh release create',
    ].map((s) => yml.indexOf(s))
    expect(order.every((i) => i >= 0)).toBe(true)
    expect([...order].sort((a, b) => a - b)).toEqual(order)
    expect(yml).toContain(`dist-win\\${assetName('$env:VERSION')}`)
    expect(yml).toContain('MESA_DATA_DIR')
    expect(yml).toContain('--generate-notes')
    expect(yml).toContain('GH_TOKEN: ${{ github.token }}')
    expect(yml).not.toContain('pnpm e2e')
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @mesa/launcher test -- workflow`
Expected: FAIL — `ENOENT: no such file or directory, open '…/.github/workflows/release.yml'`.

- [ ] **Step 3: Escrever o workflow**

`.github/workflows/release.yml`:

```yaml
name: Release (pacote Windows)

on:
  push:
    tags: ['v*']

permissions:
  contents: write

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  windows-package:
    runs-on: windows-latest
    timeout-minutes: 40
    defaults:
      run:
        shell: pwsh
    steps:
      - uses: actions/checkout@v4

      - name: Tag confere com version.txt
        run: |
          $version = (Get-Content version.txt -Raw).Trim()
          if ("v$version" -ne $env:GITHUB_REF_NAME) { throw "Tag $env:GITHUB_REF_NAME diferente de version.txt ($version)" }
          "VERSION=$version" | Out-File -FilePath $env:GITHUB_ENV -Append -Encoding utf8

      - uses: pnpm/action-setup@v4
        with:
          version: 12.10.1

      - uses: actions/setup-node@v4
        with:
          node-version: 24.12.0
          cache: pnpm

      - name: Instalar dependências
        run: pnpm install --frozen-lockfile

      - name: Typecheck
        run: pnpm typecheck

      - name: Testes unitários (o e2e não roda no CI)
        run: pnpm test

      - name: Build do front
        run: pnpm build

      - name: Montar o pacote (Node e cloudflared com SHA-256 conferido)
        run: pnpm win:package

      - name: Teste de fumaça no zip extraído
        run: |
          $zip = "dist-win\MesaVirtual-v$env:VERSION-win64.zip"
          $dir = Join-Path $env:RUNNER_TEMP 'fumaca com espaco'
          New-Item -ItemType Directory -Force -Path $dir | Out-Null
          & "$env:SystemRoot\System32\tar.exe" -xf $zip -C $dir
          if ($LASTEXITCODE -ne 0) { throw 'falha ao extrair o zip' }
          $env:MESA_DATA_DIR = Join-Path $env:RUNNER_TEMP 'dados da fumaca'
          $pkg = Join-Path $dir 'MesaVirtual'
          & "$pkg\app\node\node.exe" "$pkg\app\launcher\launcher.mjs" --root $pkg --smoke --port 18787
          if ($LASTEXITCODE -ne 0) { throw "teste de fumaça falhou (código $LASTEXITCODE)" }

      - name: Criar a Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: >-
          gh release create $env:GITHUB_REF_NAME
          "dist-win\MesaVirtual-v$env:VERSION-win64.zip"
          --title "Mesa Virtual $env:GITHUB_REF_NAME"
          --generate-notes
          --verify-tag
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `pnpm --filter @mesa/launcher test -- workflow`
Expected: PASS.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 5: Commit** (sem push: o workflow só roda quando a Task 10 enviar a tag)

```bash
git add .github/workflows/release.yml apps/launcher/test/workflow.test.mjs
git commit -m "feat(win): Task 7 — workflow de Release com teste de fumaça" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: `pnpm release X.Y.Z`

**Files:**
- Create: `scripts/release-lib.mjs`, `scripts/release.mjs`
- Modify: `package.json` (raiz: script `release`)
- Test: `apps/launcher/test/release-lib.test.mjs`

**Interfaces:**
- Consumes:
  - Task 1: `compareVersions`, `readVersion`.
  - Task 6: `version.txt` e `"version"` no `package.json` raiz.
- Produces:
  - `parseReleaseVersion(input: unknown, currentVersion: string): string` (lança o uso, ou `a versão X precisa ser maior que a atual (Y)`).
  - `gitProblems({ status: string, branch: string, behind: number, tagExists: boolean }): string[]`.
  - `setPackageVersion(packageJsonText: string, version: string): string` (`"version"` logo depois de `"name"`, 2 espaços, `\n` final).
  - `pnpm release X.Y.Z [--dry-run]`, usado na Task 10.

- [ ] **Step 1: Escrever os testes que falham**

`apps/launcher/test/release-lib.test.mjs`:

```js
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { gitProblems, parseReleaseVersion, setPackageVersion } from '../../../scripts/release-lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')

describe('parseReleaseVersion', () => {
  it('aceita X.Y.Z maior que a atual', () => {
    expect(parseReleaseVersion('0.4.0', '0.3.0')).toBe('0.4.0')
    expect(parseReleaseVersion('0.10.0', '0.9.0')).toBe('0.10.0')
  })

  it('formato errado → mensagem de uso', () => {
    for (const input of [undefined, '', 'v0.4.0', '0.4', '0.4.0-beta']) {
      expect(() => parseReleaseVersion(input, '0.3.0')).toThrow('uso: pnpm release X.Y.Z')
    }
  })

  it('igual ou menor → recusa', () => {
    expect(() => parseReleaseVersion('0.3.0', '0.3.0')).toThrow('a versão 0.3.0 precisa ser maior que a atual (0.3.0)')
    expect(() => parseReleaseVersion('0.2.9', '0.3.0')).toThrow('precisa ser maior')
  })
})

describe('gitProblems', () => {
  it('main limpa e em dia → nenhum problema', () => {
    expect(gitProblems({ status: '', branch: 'main', behind: 0, tagExists: false })).toEqual([])
  })

  it('lista cada problema', () => {
    expect(gitProblems({ status: ' M README.md\n', branch: 'feature', behind: 2, tagExists: true })).toEqual([
      'há alterações não commitadas (git status não está limpo)',
      'você está no branch "feature"; publique a partir da main',
      'a main local está 2 commit(s) atrás de origin/main; rode git pull',
      'a tag já existe',
    ])
  })
})

describe('setPackageVersion', () => {
  it('insere "version" logo depois de "name" e preserva o resto', () => {
    const text = '{\n  "name": "x",\n  "private": true,\n  "scripts": { "a": "b" }\n}\n'
    const next = setPackageVersion(text, '0.4.0')
    expect(Object.keys(JSON.parse(next))).toEqual(['name', 'version', 'private', 'scripts'])
    expect(JSON.parse(next)).toEqual({ name: 'x', version: '0.4.0', private: true, scripts: { a: 'b' } })
    expect(next.endsWith('}\n')).toBe(true)
    expect(next).toContain('\n  "version": "0.4.0",\n')
  })

  it('substitui a versão existente do package.json real', () => {
    const real = fs.readFileSync(path.join(repo, 'package.json'), 'utf8')
    const next = JSON.parse(setPackageVersion(real, '9.9.9'))
    expect(next.version).toBe('9.9.9')
    expect(next.scripts).toEqual(JSON.parse(real).scripts)
  })
})

describe('scripts/release.mjs', () => {
  it('sem versão → código 1 e uso, antes de qualquer comando git', () => {
    const r = spawnSync(process.execPath, [path.join(repo, 'scripts', 'release.mjs')], { encoding: 'utf8' })
    expect(r.status).toBe(1)
    expect(r.stderr).toContain('✗ uso: pnpm release X.Y.Z')
  })

  it('package.json tem o script release', () => {
    expect(JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8')).scripts.release).toBe('node scripts/release.mjs')
  })
})
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `pnpm --filter @mesa/launcher test -- release-lib`
Expected: FAIL — `Failed to load url ../../../scripts/release-lib.mjs`.

- [ ] **Step 3: Implementar**

`scripts/release-lib.mjs`:

```js
import { compareVersions } from '../apps/launcher/src/semver.mjs'

const USAGE = 'uso: pnpm release X.Y.Z [--dry-run]  (ex.: pnpm release 0.4.0)'

export function parseReleaseVersion(input, currentVersion) {
  if (typeof input !== 'string' || !/^\d+\.\d+\.\d+$/.test(input)) throw new Error(USAGE)
  if (compareVersions(input, currentVersion) <= 0) {
    throw new Error(`a versão ${input} precisa ser maior que a atual (${currentVersion})`)
  }
  return input
}

export function gitProblems({ status, branch, behind, tagExists }) {
  const problems = []
  if (status.trim()) problems.push('há alterações não commitadas (git status não está limpo)')
  if (branch !== 'main') problems.push(`você está no branch "${branch}"; publique a partir da main`)
  if (behind > 0) problems.push(`a main local está ${behind} commit(s) atrás de origin/main; rode git pull`)
  if (tagExists) problems.push('a tag já existe')
  return problems
}

export function setPackageVersion(packageJsonText, version) {
  const { name, version: _previous, ...rest } = JSON.parse(packageJsonText)
  const next = name === undefined ? { version, ...rest } : { name, version, ...rest }
  return `${JSON.stringify(next, null, 2)}\n`
}
```

`scripts/release.mjs`:

```js
#!/usr/bin/env node
// pnpm release X.Y.Z [--dry-run]
// Confere git e testes, grava a versão (package.json + version.txt), commita "release: vX.Y.Z",
// cria a tag e envia commit + tag juntos. O GitHub Actions monta o pacote e cria a Release.
import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { readVersion } from '../apps/launcher/src/semver.mjs'
import { gitProblems, parseReleaseVersion, setPackageVersion } from './release-lib.mjs'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const dryRun = args.includes('--dry-run')
const input = args.find((a) => !a.startsWith('--'))

const git = (...gitArgs) => execFileSync('git', gitArgs, { cwd: repo, encoding: 'utf8' }).trim()

function sh(command) {
  console.log(`> ${command}`)
  const result = spawnSync(command, { cwd: repo, shell: true, stdio: 'inherit' })
  if (result.status !== 0) throw new Error(`falhou: ${command}`)
}

function main() {
  const versionFile = path.join(repo, 'version.txt')
  const version = parseReleaseVersion(input, readVersion(fs, versionFile))
  const tag = `v${version}`

  git('fetch', 'origin', 'main', '--tags')
  const problems = gitProblems({
    status: git('status', '--porcelain'),
    branch: git('rev-parse', '--abbrev-ref', 'HEAD'),
    behind: Number(git('rev-list', '--count', 'HEAD..origin/main')),
    tagExists: git('tag', '--list', tag) !== '',
  })
  if (problems.length) throw new Error(`não dá para publicar ${tag}:\n  - ${problems.join('\n  - ')}`)

  sh('pnpm typecheck')
  sh('pnpm test')
  if (dryRun) {
    console.log(`✓ Simulação de ${tag} ok: nada foi gravado nem enviado.`)
    return
  }

  const packageFile = path.join(repo, 'package.json')
  fs.writeFileSync(packageFile, setPackageVersion(fs.readFileSync(packageFile, 'utf8'), version))
  fs.writeFileSync(versionFile, `${version}\n`)
  git('add', 'package.json', 'version.txt')
  git('commit', '-m', `release: ${tag}`)
  git('tag', '-a', tag, '-m', `Mesa Virtual ${tag}`)
  git('push', '--atomic', 'origin', 'main', tag)
  console.log(`✓ ${tag} enviada. O GitHub Actions monta o pacote e cria a Release:`)
  console.log('  https://github.com/joaovictorjtorres/PersonalBoard/actions')
}

try {
  main()
} catch (err) {
  console.error(`✗ ${err.message}`)
  process.exit(1)
}
```

`package.json` (raiz), conteúdo completo:

```json
{
  "name": "mesa-virtual",
  "version": "0.3.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "pnpm -r --if-present test",
    "typecheck": "pnpm -r --if-present typecheck",
    "dev:worker": "pnpm --filter @mesa/worker dev",
    "dev:web": "pnpm --filter @mesa/web dev",
    "build": "pnpm --filter @mesa/web build",
    "build:e2e": "pnpm --filter @mesa/web exec vite build --outDir dist-e2e --emptyOutDir",
    "e2e": "playwright test",
    "deploy": "pnpm build && pnpm --filter @mesa/worker run deploy",
    "host": "pnpm build && pnpm --filter @mesa/worker exec wrangler dev --ip 0.0.0.0 --port 8787",
    "tunnel": "cloudflared tunnel --url http://localhost:8787",
    "win:package": "node scripts/build-win-package.mjs",
    "release": "node scripts/release.mjs"
  },
  "devDependencies": {
    "@playwright/test": "^1.63.0",
    "typescript": "^7.0.2"
  }
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `pnpm --filter @mesa/launcher test -- release-lib`
Expected: PASS.

Run: `pnpm release`
Expected: `✗ uso: pnpm release X.Y.Z [--dry-run]  (ex.: pnpm release 0.4.0)` e código 1. Não rode com versão: o push é só na Task 10.

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

- [ ] **Step 5: Commit**

```bash
git add scripts/release-lib.mjs scripts/release.mjs package.json apps/launcher/test/release-lib.test.mjs
git commit -m "feat(win): Task 8 — pnpm release" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: README — "Rodar no Windows (pacote)" e "Publicar uma versão"

**Files:**
- Modify: `README.md` (nova seção logo antes de `## Opção A — rodar na sua máquina (sem conta Cloudflare)`; nova seção `## Publicar uma versão (pacote Windows)` logo depois de `## Desenvolvimento`)
- Test: `apps/launcher/test/readme.test.mjs`

**Interfaces:**
- Consumes:
  - Task 2: pasta de dados, `config.json`, backups.
  - Task 6: nome do zip e "Iniciar Mesa".
  - Task 8: `pnpm release`.
- Produces: documentação (§9 do spec).

- [ ] **Step 1: Escrever o teste que falha**

`apps/launcher/test/readme.test.mjs`:

```js
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const readme = fs.readFileSync(path.join(repo, 'README.md'), 'utf8')

describe('README', () => {
  it('cobre o §9 do spec', () => {
    for (const text of [
      '## Rodar no Windows (pacote)',
      'https://github.com/joaovictorjtorres/PersonalBoard/releases/latest',
      'MesaVirtual-vX.Y.Z-win64.zip',
      'Mais informações → Executar assim mesmo',
      '%LOCALAPPDATA%\\MesaVirtual\\',
      '"autoUpdate": false',
      'apps/worker/.wrangler/state/',
      'backups\\AAAA-MM-DD_HHMMSS',
      '## Publicar uma versão (pacote Windows)',
      'pnpm release 0.4.0',
    ]) {
      expect(readme).toContain(text)
    }
  })
})
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `pnpm --filter @mesa/launcher test -- readme`
Expected: FAIL — `expected '# Mesa Virtual…' to contain '## Rodar no Windows (pacote)'`.

- [ ] **Step 3: Escrever as seções**

Em `README.md`, insira **logo depois** do bloco `## Desenvolvimento` (depois do bloco de código que termina com `# não interfere num \`pnpm host\` rodando na 8787`):

````markdown
## Publicar uma versão (pacote Windows)

```bash
pnpm release 0.4.0 --dry-run   # confere git (limpo, na main, em dia), typecheck e testes; não grava nada
pnpm release 0.4.0             # grava a versão, commita "release: v0.4.0", cria a tag e envia
```

A tag dispara o GitHub Actions (`.github/workflows/release.yml`, em Windows): testes, build,
montagem do `MesaVirtual-v0.4.0-win64.zip` (Node 24 portátil, `cloudflared` e servidor com as
dependências de Windows), teste de fumaça no zip e criação da Release com notas automáticas.
Acompanhe em https://github.com/joaovictorjtorres/PersonalBoard/actions.
````

E insira **logo antes** de `## Opção A — rodar na sua máquina (sem conta Cloudflare)`:

````markdown
## Rodar no Windows (pacote)

Para o mestre hospedar a mesa no próprio PC Windows, de graça, sem instalar nada.

1. Baixe o `MesaVirtual-vX.Y.Z-win64.zip` mais recente em
   https://github.com/joaovictorjtorres/PersonalBoard/releases/latest.
2. Extraia para uma pasta sua (ex.: `Documentos\MesaVirtual`). Não rode de dentro do zip.
3. Dê dois cliques em **Iniciar Mesa**. Se o Windows mostrar "O Windows protegeu o computador"
   (SmartScreen), clique em **Mais informações → Executar assim mesmo**. Se o antivírus perguntar,
   permita o `node.exe` e o `cloudflared.exe` da pasta `app`.
4. A janela verifica se há versão nova, sobe o servidor e o túnel e mostra o link
   `https://….trycloudflare.com`. Ele já vai copiado e o navegador abre sozinho. Mande para o grupo.
5. Para desligar, feche a janela ou aperte Ctrl+C. Se aparecer "Deseja finalizar o arquivo em
   lotes (S/N)?", responda S.

O link muda a cada vez que a mesa é aberta; o `/t/<id>` das mesas continua valendo. Sem internet
(ou se o túnel falhar), a mesa funciona só no seu PC em `http://localhost:8787`. Se as portas
8787–8797 estiverem todas ocupadas, feche o outro programa que as usa e abra de novo.

**Onde ficam os dados:** em `%LOCALAPPDATA%\MesaVirtual\` (cole esse caminho na barra do Explorer):

- `state\`: as mesas;
- `backups\AAAA-MM-DD_HHMMSS\`: cópias automáticas de `state\`, uma por dia de uso e outra antes
  de cada atualização. Ficam as 10 mais recentes; pastas que você criar ali nunca são apagadas;
- `logs\launcher.log`: registro para suporte;
- `config.json`: preferências.

A pasta do pacote não guarda mesas. Pode apagá-la e extrair o zip de novo sem perder nada.

**Atualização automática:** ao abrir, se houver versão nova, a janela pergunta
`Atualizar agora? [S/n]`. As mesas são copiadas para `backups\` antes da troca. Para desligar a
pergunta, edite `%LOCALAPPDATA%\MesaVirtual\config.json` e deixe `"autoUpdate": false` (sem aspas
no `false`).

**Migrar as mesas do Linux:** desligue a mesa nos dois computadores. Copie todo o conteúdo de
`apps/worker/.wrangler/state/` do Linux para `%LOCALAPPDATA%\MesaVirtual\state\` no Windows,
substituindo o que houver, e abra a mesa.

**Restaurar um backup:** desligue a mesa. Em `%LOCALAPPDATA%\MesaVirtual\`, renomeie `state` para
`state-antigo`. Copie a pasta do backup desejado (`backups\AAAA-MM-DD_HHMMSS`) para
`%LOCALAPPDATA%\MesaVirtual\` e renomeie a cópia para `state`. Abra a mesa.
````

- [ ] **Step 4: Rodar os testes e a verificação completa**

Run: `pnpm --filter @mesa/launcher test`
Expected: PASS (todos os arquivos).

Run: `pnpm typecheck && pnpm test`
Expected: tudo verde.

Run: `git status --short`
Expected: só `README.md` e `apps/launcher/test/readme.test.mjs`.

- [ ] **Step 5: Commit**

```bash
git add README.md apps/launcher/test/readme.test.mjs
git commit -m "feat(win): Task 9 — README do pacote Windows e da publicação" -m "Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10 (controlador, depois da revisão final): primeira publicação e verificação manual

> **Não é task de implementador.** Quem executa é o controlador, só depois de a revisão final do branch aprovar as Tasks 1–9. É o único passo do plano que faz `git push` (o usuário autorizou a publicação por `pnpm release`). Não gera commit `feat(win)`: o commit é o `release: v0.4.0` do próprio script, sem trailer.

**Files:** nenhum editado à mão (`package.json` e `version.txt` mudam pelo script).

**Interfaces:**
- Consumes: Tasks 6–8 (`pnpm release`, workflow, pacote).
- Produces: Release `v0.4.0` no GitHub com `MesaVirtual-v0.4.0-win64.zip` (critério de pronto §10.1).

- [ ] **Step 1: Simulação**

Run: `pnpm release 0.4.0 --dry-run`
Expected: `✓ Simulação de v0.4.0 ok: nada foi gravado nem enviado.` Se aparecer `não dá para publicar`, resolva o item listado (commit pendente, branch, `git pull`) e repita.

- [ ] **Step 2: Publicar** (push autorizado)

Run: `pnpm release 0.4.0`
Expected: commit `release: v0.4.0`, tag `v0.4.0` e `✓ v0.4.0 enviada.`

- [ ] **Step 3: Acompanhar o CI**

Run: `gh run watch --repo joaovictorjtorres/PersonalBoard --exit-status $(gh run list --repo joaovictorjtorres/PersonalBoard --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')`
Expected: o job `windows-package` termina com sucesso, e o passo "Teste de fumaça no zip extraído" mostra `✓ Teste de fumaça: mesa criada (201).`

Se falhar, veja o log com `gh run view --log-failed`:

| Erro no log | O que fazer |
|---|---|
| `checksum … não confere` | Confira o pin em `scripts/win-package/lib.mjs` contra a fonte oficial. |
| `workerd win-x64 ausente` | Confira a saída do `npm install`. |
| `O servidor não respondeu em 60 s` | As linhas do wrangler aparecem logo abaixo. |

Para corrigir:
1. Corrija com um commit `fix(win): …` (com o trailer).
2. Apague a tag (`git push origin :refs/tags/v0.4.0` e `git tag -d v0.4.0`).
3. Publique `0.4.1` com `pnpm release 0.4.1`. Nunca reaproveite a tag.

- [ ] **Step 4: Conferir a Release**

Run: `gh release view v0.4.0 --repo joaovictorjtorres/PersonalBoard --json assets --jq '.assets[].name'`
Expected: `MesaVirtual-v0.4.0-win64.zip`

- [ ] **Step 5: Verificação manual no Windows** (critério §10.2, feita pelo usuário; o controlador só repassa o roteiro)

1. Baixar o zip da Release, extrair numa pasta com espaço no nome e dar dois cliques em **Iniciar Mesa**.
2. Esperado:
   - aparece `Mesa Virtual v0.4.0` e `✓ Você está na versão mais recente.`;
   - `✓ Servidor no ar.` e `✓ Túnel aberto.`;
   - link `https://….trycloudflare.com` destacado, copiado e aberto no navegador.
3. Abrir o link no celular pelo 4G, criar uma mesa e mexer num token.
4. Fechar a janela. Conferir no Gerenciador de Tarefas que não sobrou `workerd.exe`, `cloudflared.exe` nem `node.exe`.

- [ ] **Step 6: Verificação da atualização** (critério §10.3)

1. No Linux: `pnpm release 0.4.1`. Aguardar o CI como no Step 3.
2. No Windows, abrir o **Iniciar Mesa** da 0.4.0. O esperado:
   - aparece `Versão 0.4.1 disponível (atual 0.4.0). Atualizar agora? [S/n]`;
   - com Enter: download, `✓ Backup das mesas: …`, `✓ Versão 0.4.1 baixada. Reiniciando para instalar…`, `✓ Atualização instalada.`, depois `Mesa Virtual v0.4.1`;
   - a mesa criada no Step 5 continua lá;
   - `app.old` some da pasta do pacote depois que o servidor sobe.
