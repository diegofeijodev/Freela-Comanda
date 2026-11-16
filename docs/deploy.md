# Freela Comanda (Freela ERP) — roteiro de subida

Mesmo caminho do Praça e do Meu Funil: API + Postgres no EC2 do Freela (pasta `/opt/erp-freela`), web na Vercel
(time `freelas-projects-ccf14064`, deploy por CÓPIA sem git, projeto `freela-comanda`). Domínio `freelacomanda.com.br` (DNS na Locaweb).

| Endereço | Aponta para | Quando |
|---|---|---|
| `api.freelacomanda.com.br` | `A` → IP do EC2 | antes do HTTPS da API |
| `freela-comanda.vercel.app` | Vercel (automático) | endereço provisório até a virada |
| `www.freelacomanda.com.br` + `freelacomanda.com.br` | Vercel (valores que `vercel domains add` mostrar) | **só na virada**, depois da migração dos dados — hoje o `www` ainda é o Lovable |

Os scripts ficam fora do repositório, em `~/erp-deploy/` (o dono roda cada um com `!`; o classificador barra push/scp/compose para o assistente):

1. **GitHub:** repositório `diegofeijodev/Freela-ERP` **privado**; `git push origin master:main` (o `main` de lá foi juntado com
   `--allow-unrelated-histories`, não precisa de force).
2. **DNS (Locaweb):** `A api → IP do EC2`. Conferir com `dig +short api.freelacomanda.com.br`.
3. **Servidor (uma vez):** `bash ~/erp-deploy/preparar-servidor.sh` — confere memória livre, cria `/opt/erp-freela` e o `.env` (600) com
   `POSTGRES_PASSWORD`/`JWT_SECRET` gerados NO servidor (`openssl rand -hex 32`). Nunca sobrescreve um `.env` existente.
3b. **Segredo do certificado (antes da API e ANTES do primeiro envio de certificado):** `bash ~/erp-deploy/segredo-certificado.sh` — acrescenta `CERTIFICADO_SECRET`
   (`openssl rand -hex 32`, gerado NO servidor, nunca sai dele) ao `.env` se faltar e recria a API sem build. Se já houver valor, não mexe. Pontos de atenção:
   - Sem a variável, a tela do certificado diz "O servidor ainda não está pronto…" (enviar = 503 `CERTIFICADO_SEM_SEGREDO`).
   - **Guarde esse valor em lugar seguro.** Trocar ou perder o segredo deixa o certificado guardado ilegível ("não pode ser lido") e obriga a enviar o .pfx de novo.
   - Nunca copiar dump do banco e `.env` juntos (o dump leva o certificado cifrado; o `.env` leva a chave que o abre).
   - O `docker-compose.prod.yml` do servidor precisa estar atualizado (declara `CERTIFICADO_SECRET`); sem isso a variável do `.env` não chega ao contêiner.
4. **API:** `bash ~/erp-deploy/subir-api.sh` — backup do banco + imagem de volta (a partir da 2ª subida), cópia da árvore LIMPA do `master`,
   `docker compose -f docker-compose.prod.yml up -d --build` (o contêiner roda `prisma migrate deploy`) e espera `/health`.
5. **nginx + HTTPS:** `bash ~/erp-deploy/https-api.sh` — instala `docs/deploy/nginx-api-erp.conf` como `erp-freela-api`, `nginx -t`, reload e
   `certbot --nginx -d api.freelacomanda.com.br --redirect`.
6. **Web:** `bash ~/erp-deploy/subir-web.sh` — cópia de `web/` (sem `.next`/`node_modules`/`.env.local`), `NEXT_PUBLIC_API_URL` fixo em
   `https://api.freelacomanda.com.br`. Rodar `yarn lint` ANTES (lint quebrado derruba o build da Vercel).
7. **Primeiro acesso:** NÃO criar admin em produção antes da migração (o importador exige banco vazio). Para olhar o sistema antes da virada,
   use o ensaio da migração.
8. **Dados do Lovable e virada do `www`:** `docs/migracao-lovable.md`.

Volta: `IMAGE_TAG=<tag> docker compose -f docker-compose.prod.yml up -d --no-build api` (imagem anterior) ou, para tirar tudo do ar,
`docker compose -f docker-compose.prod.yml down` (o volume fica: no Docker ele se chama `erp-freela_erp_freela_pgdata` — o compose prefixa o nome do projeto `erp-freela`; a chave `erp_freela_pgdata` do compose está certa) e apagar o vhost do nginx.
Memória no EC2: API 640 MB + Postgres 320 MB (tetos no compose).
