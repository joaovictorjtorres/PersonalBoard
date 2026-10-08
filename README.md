# Mesa Virtual

Mesa colaborativa estilo Roll20: mapa, tokens, desenho e camada do mestre em tempo real.

## Desenvolvimento

```bash
pnpm install
pnpm dev:worker   # API + Durable Object + R2 locais em :8787
pnpm dev:web      # front com hot reload em :5173 (proxy para :8787)
pnpm test         # unitários + Durable Object
pnpm e2e          # ponta a ponta: sobe um wrangler dev próprio em :8788 (E2E_PORT muda a porta),
                  # com build em apps/web/dist-e2e e estado em apps/worker/.wrangler/e2e-state —
                  # não interfere num `pnpm host` rodando na 8787
```

## Opção A — rodar na sua máquina (sem conta Cloudflare)

O `wrangler dev` simula Worker, Durable Object (SQLite) e R2 localmente e salva tudo em
`apps/worker/.wrangler/state/` — as mesas sobrevivem a reinícios. Faça backup copiando essa pasta.

Instale antes o `cloudflared` (binário oficial em https://github.com/cloudflare/cloudflared/releases).
O Quick Tunnel não exige conta Cloudflare.

```bash
pnpm host     # terminal 1: servidor local persistente
pnpm tunnel   # terminal 2: imprime o link https://….trycloudflare.com para o grupo
```

O link `https://….trycloudflare.com` muda a cada execução do `pnpm tunnel`. O `/t/<id>` das mesas
continua valendo: basta trocar o domínio pelo novo.

Seu computador precisa ficar ligado durante a sessão.

Atenção: `pnpm host` e `pnpm dev:worker` usam a mesma porta 8787; não rode os dois ao mesmo tempo.

Alternativa: VPN (Tailscale, ZeroTier, Hamachi…). Todos entram na mesma rede virtual e acessam
`http://<IP-da-VPN-do-host>:8787`. Libere a porta 8787 no firewall do host e confira o limite de
membros do plano gratuito da VPN escolhida (são 7 pessoas contando o host; o Hamachi gratuito,
por exemplo, costuma limitar redes a 5).

Acesso por `http://` em IP funciona; o app já trata a falta de `crypto.randomUUID` fora de HTTPS.

## Opção B — publicar na Cloudflare (grátis, sempre no ar)

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
