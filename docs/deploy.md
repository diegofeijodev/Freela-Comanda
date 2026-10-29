# Freela ERP — roteiro de subida (NADA disto foi feito ainda; precisa do dono)

Mesmo caminho do Praça e do Meu Funil: API + Postgres no EC2 do Freela (`ubuntu@56.124.127.54`, pasta `/opt/erp-freela`), web na Vercel
(time `freelas-projects-ccf14064`, deploy por CÓPIA sem git). Nomes sugeridos: `api-erp.freelaservicosapp.com.br` e projeto Vercel `erp-freela`.

1. **GitHub (dono):** criar o repositório (ou usar o do Lovable numa branch `stack-freela`) e `git push` via `!` (o classificador barra push).
2. **DNS (dono, Locaweb):** `A api-erp → 56.124.127.54`.
3. **API no EC2:** copiar a árvore LIMPA (`git archive master api docker-compose.prod.yml docs/deploy | ssh … 'tar x -C /opt/erp-freela'`),
   criar `/opt/erp-freela/.env` (modelo `docs/deploy/.env.prod.example`, segredos gerados no servidor com `openssl rand -hex 32`, chmod 600),
   `docker compose -f docker-compose.prod.yml up -d --build` (o contêiner roda `prisma migrate deploy` ao subir). Conferir `curl 127.0.0.1:3016/health`.
4. **nginx + HTTPS:** `docs/deploy/nginx-api-erp.conf` em `/etc/nginx/sites-available/erp-freela-api` + `certbot --nginx -d api-erp.freelaservicosapp.com.br --redirect`.
5. **Web na Vercel:** cópia de `web/` (sem `.next`/`node_modules`/`.env.local`), `NEXT_PUBLIC_API_URL=https://api-erp.freelaservicosapp.com.br`,
   `npx vercel --prod --yes --scope freelas-projects-ccf14064`. Rodar `yarn lint` ANTES (lint quebrado derruba o build da Vercel).
6. **Primeiro acesso:** abrir o web → "Primeiro acesso? Criar conta de administrador" (some depois que existe admin). Não rodar seed em produção.
7. **Dados do Lovable:** ver "Migração dos dados" no README.

Volta: `docker compose -f docker-compose.prod.yml down` (o volume `erp_freela_pgdata` fica) e apagar o vhost do nginx.
Memória no EC2: API 640 MB + Postgres 320 MB (tetos no compose).
