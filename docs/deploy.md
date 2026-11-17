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
3b. **Segredo do certificado (antes do primeiro envio de certificado; rodar só no dia da subida, liberado pelo dono, e nunca enquanto houver regra de não fazer deploy):**
   `bash ~/erp-deploy/segredo-certificado.sh` — acrescenta `CERTIFICADO_SECRET` (`openssl rand -hex 32`, gerado NO servidor) ao `.env` se faltar.
   Por padrão SÓ grava a variável e NÃO reinicia nada: o `up -d --build` do passo 4 recria o contêiner, e a variável chega a ele pelo `env_file: .env`
   do serviço `api` (mesmo com um compose antigo). Antes de regravar, o script faz a cópia `.env.bak-AAAAMMDD-HHMMSS` (600) no mesmo diretório, escreve
   num temporário, confere que ele tem todas as linhas do original mais a nova e só então substitui; qualquer falha interrompe antes de tocar no `.env`.
   Se já houver valor, não mexe. Opção `--reiniciar`: recria só a API (`--no-deps`) e confere o segredo carregado; NÃO usar junto de outro deploy. Pontos de atenção:
   - Sem a variável, a tela do certificado diz "O servidor ainda não está pronto…" (enviar = 503 `CERTIFICADO_SEM_SEGREDO`).
   - O segredo fica só no servidor. Faça uma cópia segura DO ARQUIVO `.env` do servidor por um meio seguro. Se o valor se perder ou mudar, o certificado guardado
     fica ilegível ("não pode ser lido") e precisa ser enviado de novo.
   - Nunca copiar dump do banco e `.env` juntos (o dump leva o certificado cifrado; o `.env` leva a chave que o abre).
4. **API:** `bash ~/erp-deploy/subir-api.sh` — backup do banco + imagem de volta (a partir da 2ª subida), cópia da árvore LIMPA do `master`,
   `docker compose -f docker-compose.prod.yml up -d --build` (o contêiner roda `prisma migrate deploy`) e espera `/health`.
5. **nginx + HTTPS:** `bash ~/erp-deploy/https-api.sh` — instala `docs/deploy/nginx-api-erp.conf` como `erp-freela-api`, `nginx -t`, reload e
   `certbot --nginx -d api.freelacomanda.com.br --redirect`.
6. **Web:** `bash ~/erp-deploy/subir-web.sh` — cópia de `web/` (sem `.next`/`node_modules`/`.env.local`), `NEXT_PUBLIC_API_URL` fixo em
   `https://api.freelacomanda.com.br`. Rodar `yarn lint` ANTES (lint quebrado derruba o build da Vercel).
7. **Primeiro acesso:** NÃO criar admin em produção antes da migração (o importador exige banco vazio). Para olhar o sistema antes da virada,
   use o ensaio da migração.
8. **Dados do Lovable e virada do `www`:** `docs/migracao-lovable.md`.

## Notas da SEFAZ (busca na distribuição de DF-e, só leitura)

Variável `SEFAZ_DFE_AMBIENTE` (declarada no `docker-compose.prod.yml` como `${SEFAZ_DFE_AMBIENTE:-}`; modelo em `api/.env.example`):

| Valor | Efeito |
|---|---|
| ausente ou vazia | `desligado` (o padrão): nenhum agendador, nenhuma conexão; as rotas dão 503 `SEFAZ_DESLIGADA` e o painel diz que a busca não está ativada |
| `homologacao` | consulta o ambiente de teste da SEFAZ (a nota de teste nunca entra no estoque) |
| `producao` | consulta a SEFAZ real |
| qualquer outro | **a API não sobe** (falha de validação do ambiente, de propósito: melhor parar do que adivinhar) |

Mesmo com a variável ligada, a busca só roda depois de alguém tocar em "Ligar a busca" em Configurações (certificado A1 válido e CNPJ da empresa salvos).
**Nunca** ligar `homologacao` ou `producao` sem o "eu autorizo" do dono, dado na hora e por escrito; o dono acompanha. Nenhum agente executa o roteiro (ele está em `README.md`, "Pendências do dono").
Roteiro: (1) conferir o servidor desligado e `select count(*) from sefaz_consultas` = 0; (2) `pg_dump` do banco; (3) perguntar ao contador se ele já baixa as notas desse CNPJ (dois sistemas no mesmo CNPJ levam a bloqueio 656 de 1 hora para os dois); (4) pôr a variável no `.env` do servidor e recriar SÓ a API (`up -d --no-deps api`; o `.env` chega pelo `env_file`); (5) ligar e buscar pela tela. Volta, nesta ordem: (1) PRIMEIRO tocar em "Desligar a busca" na tela (senão a linha fica `busca_ligada=true` e a busca volta sozinha no dia em que alguém puser a variável de novo); (2) deixar a variável vazia no `.env`; (3) recriar só a API: `docker compose -f docker-compose.prod.yml up -d --no-deps api` (`docker restart`/`docker compose restart` não relê o `.env`); (4) conferir que o painel diz "A busca de notas na SEFAZ não está ativada neste servidor." e que `docker exec erp-freela-api printenv SEFAZ_DFE_AMBIENTE` sai vazio. **Nunca apagar linhas `sefaz_*`** (são a prova das esperas) e, desligada por mais de 60 dias, a SEFAZ deixa buraco sem volta (avisar o dono).
Cuidados: nunca ligar `NODE_DEBUG=http|https|tls` na API (o Node imprime as opções do pedido); o certificado só chega à SEFAZ pela porta `CERTIFICADO_DIGITAL` e nada dele vai para log.

**Recuperar um documento descartado:** a classificação desiste de um documento depois de 3 falhas (`erro_processamento` começa com "Descartado depois de 3 tentativas"), para um defeito dele não prender a fila. O XML continua guardado (`sefaz_documentos`). Corrigida a causa (ou se foi um soluço do banco), colocar de volta na fila:
`UPDATE sefaz_documentos SET processado_em = NULL, erro_processamento = NULL WHERE erro_processamento LIKE 'Descartado%';`
(a API classifica de novo no próximo tique, em até 5 minutos).

Volta: `IMAGE_TAG=<tag> docker compose -f docker-compose.prod.yml up -d --no-build api` (imagem anterior) ou, para tirar tudo do ar,
`docker compose -f docker-compose.prod.yml down` (o volume fica: no Docker ele se chama `erp-freela_erp_freela_pgdata` — o compose prefixa o nome do projeto `erp-freela`; a chave `erp_freela_pgdata` do compose está certa) e apagar o vhost do nginx.
Memória no EC2: API 640 MB + Postgres 320 MB (tetos no compose).
