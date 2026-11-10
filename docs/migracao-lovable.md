# Migração dos dados do Lovable (Freela ERP) para o Freela Comanda — roteiro

Mesmo padrão do Meu Funil (`meu-funil/docs/migracao-lovable.md`): função SQL só-leitura com token no Supabase do Lovable → `pull.mjs`
no EC2 grava UM arquivo JSON → importador compilado na imagem da API → **ensaio** num banco de estágio → **virada** → limpeza no Lovable.
O Lovable **nunca é escrito** (só ganha e depois perde a função de exportação). Não há arquivos/Storage para copiar.

Peças (todas em `api/`):

| Arquivo | O quê |
|---|---|
| `scripts/lovable-export/export_erpfreela.sql` | função `public.export_erpfreela` (SECURITY DEFINER, STABLE, token por SHA-256): resumo, páginas das tabelas, contas e views; todo número como texto exato |
| `scripts/lovable-export/prompt-exportacao.md` / `prompt-limpeza.md` / `limpeza_erpfreela.sql` | textos colados no chat do Lovable (montados por `render-prompts.mjs --hash <sha256>`; o token nunca entra no prompt) |
| `scripts/lovable-export/pull.mjs` | Node puro; `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` **só por variável de ambiente**; grava `<arquivo>.json` (600) e sai 1 se alguma contagem não bater ou se a base mudou durante o pull |
| `src/scripts/import-lovable/` → `dist/src/scripts/import-lovable/main.js` | importador (`--file`, `--expect-db`, `--dry-run`, `--verify`, `--importar-sem-senha`, `--pular-sem-papel`) |
| `scripts/import-lovable-e2e.sh` | teste ponta a ponta local (Lovable falso com a função SQL real) — `../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh` |

## O que o importador garante

- **Travas antes de gravar** (qualquer uma = sai 1, nada gravado): banco conectado ≠ `--expect-db`; nosso banco diferente do que
  `esquema.ts` descreve (tabelas, colunas, gatilho desconhecido, sequence); exportação com tabela fora das 23 + `profiles` + `user_roles`,
  coluna/tipo/nulabilidade diferente da nossa (inclusive em tabela vazia — vem do `information_schema` do Lovable), chave desconhecida
  ou faltando em qualquer linha, linhas ≠ resumo; pendência nas contas (abaixo); banco com qualquer dado além dos seeds.
- **Uma transação**: `LOCK TABLE` em tudo → confere vazio (contas 0, 20 tabelas 0, e `configuracoes`/`sazonalidade`/`subgrupos` iguais aos
  seeds da migração `regras`) → apaga os 3 seeds → desliga `vendas_baixa_trg` → carrega as 23 tabelas em ordem de chave estrangeira com
  as FKs LIGADAS (lista explícita de colunas, valores só como parâmetro) → contas → religa o gatilho → **verifica dentro da transação**; se a
  verificação achar diferença, desfaz tudo. `--dry-run` faz exatamente isso e desfaz no fim.
- **Gatilhos** (todos os das migrações, em `GATILHOS`): só `vendas_baixa_trg`. Desligado na carga porque as baixas das vendas já vêm prontas
  em `movimentacoes` (ligado, cada venda importada geraria a baixa de novo — o dobro). Sem sequences/identity: nada de `setval`.
- **Contas** (`auth.users` + `profiles` + `user_roles` → `users`, MESMO id; o pull só traz id, e-mail, hash, data de criação, dia do último
  acesso e situação):
  - senha: o hash bcrypt do GoTrue vai como está — a pessoa entra com a senha que já usa (provado no teste com hash do pgcrypto e o
    `AuthService.login` de verdade);
  - e-mail em minúsculas; dois iguais depois disso = aborta;
  - **ficam de fora sozinhas** (não entravam no Lovable): apagada, banida, anônima, e-mail nunca confirmado;
  - papel: admin ou loja; quem tem os dois vira admin; **sem papel = aborta**, salvo `--pular-sem-papel` (no Lovable ela entrava e não via nada,
    então fica de fora);
  - **sem senha bcrypt** (só login social, hash vazio ou outro formato) **= aborta**, salvo `--importar-sem-senha`: entra com uma senha
    aleatória que ninguém conhece e o admin define uma nova em Usuários → Redefinir senha;
  - **nenhum admin com senha de verdade = aborta SEMPRE** (o "Primeiro acesso" ficaria aberto para qualquer um criar um admin);
  - o relatório lista toda conta que entra (id, perfil, e-mail mascarado, criação, último acesso) e as que ficam de fora com o motivo:
    no Lovable qualquer cadastro pela API pública ganhava `loja` — conta estranha = parar e removê-la no Lovable. "Não confirmada = não
    entrava" é inferência (confirmação de e-mail ligada no Supabase): conta de fora com último acesso recente contradiz isso — avisar.
- **`--verify`** (e a verificação dentro da carga), cada número com o que é, a conta e de onde veio: (1) arquivo × banco linha a linha
  (`EXCEPT ALL` tipado nos dois sentidos, 23 tabelas + contas); (2) `count(*)` e `sum()` de cada coluna numérica calculados NO SUPABASE na
  hora do pull × os nossos (decimais exatos), e movimentações por tipo; (3) views `v_saldo_teorico`, `v_fichas_resumo`, `v_cmv_periodo`,
  `v_consumo_semanal`: resultado exportado do Lovable × o nosso, linha a linha pela chave (números até a 6ª casa) — a de consumo depende da
  semana de "hoje" e só é comparada se o pull e a verificação forem na mesma semana (aviso, não erro); (4) gatilho ligado. Avisos: linhas
  que apontam para conta que não veio (histórico fica, sem nome).

## Pré-requisitos

1. Este branch no `master` e a API no ar com ele (`bash ~/erp-deploy/subir-api.sh` sobe `REF=master`): o importador e o `pull.mjs` entram na imagem.
2. **Nada** de "Primeiro acesso" em produção antes da virada (o importador recusa banco com conta). Se alguém criou: ver Virada, passo 4.
3. Memória/disco no EC2 conferidos pelo script (como no `subir-api.sh`). O arquivo do pull é lido inteiro pela memória do contêiner
   (teto 640 MB, heap 448 MB): até ~40 MB tudo bem; maior que isso, rodar o importador com `-e NODE_OPTIONS=--max-old-space-size=560`.

Atalhos usados nos scripts (no servidor, `cd /opt/erp-freela`, `set -euo pipefail`):

```bash
DC="docker compose -f docker-compose.prod.yml"; RUN="$DC run --rm --no-deps"
EXP=/opt/erp-freela/lovable-export          # pasta 700 do ubuntu: token, exportações (600) e relatórios (600)
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
URL_DB() { echo "postgresql://erpfreela:$PW@erp-freela-postgres:5432/$1?schema=public"; }
imp() { # imp <banco> <arquivo.json> [opções…] — importador dentro da imagem da API, exportação montada só-leitura
  local db=$1 f=$2; shift 2
  $RUN -e DATABASE_URL="$(URL_DB "$db")" -v "$EXP:/import:ro" api node dist/src/scripts/import-lovable/main.js --file "/import/$f" --expect-db "$db" "$@"
}
```

## Scripts em `~/erp-deploy/` (o dono roda cada um com `!`)

### 1. `migracao-token.sh` — uma vez
- No servidor: `install -d -m 700 $EXP`; se não existir, `umask 077; openssl rand -hex 32 | tr -d '\n' > $EXP/token`; imprime só o
  `sha256sum < $EXP/token` (o hash não é segredo; o token nunca sai do servidor).
- Local: `node api/scripts/lovable-export/render-prompts.mjs --hash <hash> --only exportacao` e mostra o prompt.
- O dono cola o prompt no chat do Lovable e **aprova a migration**. Não precisa publicar o app.

### 2. `migracao-pull.sh` — gera `$EXP/<AAAAMMDD-HHMM>.json`
- Local: lê `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY` com `unzip -p ~/Downloads/erpfreela.zip .env` (sem gravar em arquivo; são públicos,
  mas não vão para o git) e passa ao servidor no ambiente do `ssh … bash -s`.
- No servidor: `STAMP=$(date +%Y%m%d-%H%M)`;
  `$RUN --user "$(id -u):$(id -g)" -e SUPABASE_URL="$SUPABASE_URL" -e SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY" -v "$EXP:/out" api node scripts/lovable-export/pull.mjs --token-file /out/token --out /out/$STAMP.json`
  (primeiro com `--check-only` para ver tabelas/linhas; depois o pull de verdade). Imprime o `STAMP` e o tamanho. Sai 1 = rodar de novo.
- Na primeira vez, se o pull/importador acusar **diferença de esquema** (o Lovable pode ter mudado depois do zip de 28/10), parar e trazer
  a saída: precisa de migração nova aqui antes de seguir.

### 3. `migracao-ensaio.sh <STAMP>` — banco `erpfreela_stage` no mesmo Postgres
- `docker exec erp-freela-postgres psql -U erpfreela -d postgres -c 'DROP DATABASE IF EXISTS erpfreela_stage WITH (FORCE)' -c 'CREATE DATABASE erpfreela_stage'`
- `$RUN -e DATABASE_URL="$(URL_DB erpfreela_stage)" api npx prisma migrate deploy`
- `umask 077`; `imp erpfreela_stage $STAMP.json --dry-run | tee $EXP/$STAMP-ensaio-dry-run.txt`, depois sem opção (carga)
  `| tee $EXP/$STAMP-ensaio-carga.txt`, depois `--verify | tee $EXP/$STAMP-ensaio-verify.txt` (com `set -o pipefail`; parar no primeiro
  que sair 1). Repassar as mesmas opções de contas (`--pular-sem-papel`/`--importar-sem-senha`) às três chamadas, se o dono decidir usá-las.
- Revisar com o dono: lista de contas (estranhos?), contas de fora, avisos, e as linhas DIFERENTE (devem ser zero).
- Opcional: subir uma API temporária apontando para o stage para olhar as telas — não é necessário; o login pode ser provado depois.
- `migracao-ensaio.sh --apagar`: `DROP DATABASE erpfreela_stage WITH (FORCE)`.

### 4. `migracao-virada.sh <STAMP>` — com o Lovable congelado
1. O dono avisa a equipe e para de usar o Lovable (inclusive o endereço `*.lovable.app`); tudo o que for lançado lá depois do pull se perde.
2. Pull novo (script 2) → `STAMP` novo.
3. `$DC stop api` (ninguém usa o sistema novo durante a carga; o importador ainda trava as tabelas).
4. Se o banco `erpfreela` já tiver conta/dado (alguém fez "Primeiro acesso"): o importador recusa. Recriar vazio:
   `docker exec erp-freela-postgres psql -U erpfreela -d postgres -c 'DROP DATABASE erpfreela WITH (FORCE)' -c 'CREATE DATABASE erpfreela'`
   e `$RUN api npx prisma migrate deploy`.
5. `imp erpfreela $STAMP.json --dry-run`, depois a carga, depois `--verify`, cada um com `tee $EXP/$STAMP-virada-<etapa>.txt`.
   **Parar** se qualquer um sair 1 (a carga só grava com a verificação ok; o `--verify` de fora confirma o que ficou gravado).
6. Backup logo depois: `docker exec erp-freela-postgres pg_dump -U erpfreela -d erpfreela -Fc > backups/pos-migracao-$STAMP.dump` (600).
7. `$DC up -d api` e esperar `curl -fsS http://127.0.0.1:3016/health`.
8. O dono entra em `https://freela-comanda.vercel.app` com o e-mail e a senha que usava no Lovable e confere fichas, estoque, inventários e contas.

### 5. Domínio (depois do passo 8 da virada)
- Local, pelo dono: `vercel domains add www.freelacomanda.com.br freela-comanda --scope freelas-projects-ccf14064` e o mesmo para
  `freelacomanda.com.br`; anotar os registros que o Vercel mostrar.
- Locaweb (dono/Diego): **anotar** os valores atuais (para a volta) e então apagar `www A 185.158.133.1` e `TXT _lovable.www` (do Lovable; só
  saem agora); criar os registros que o Vercel pediu para `www` e para o domínio sem www. Conferir com `dig +short www.freelacomanda.com.br`.
- `CORS_ORIGINS` do `/opt/erp-freela/.env` já tem `https://www.freelacomanda.com.br` e `https://freelacomanda.com.br` (criado pelo
  `preparar-servidor.sh`); se alguém mudou, corrigir e `$DC up -d api`.

### 6. Limpeza (depois da conferência final do dono)
- `render-prompts.mjs --hash <hash> --only limpeza` → o dono cola no Lovable e aprova (apaga `export_erpfreela`, só isso).
- No servidor: guardar os relatórios em `~/relatorios-migracao/` (600) e `rm -rf $EXP` (token e exportações com hash de senha).

## Plano de volta

O Lovable não foi escrito. Volta = DNS: `www A 185.158.133.1` e o `TXT _lovable.www` anotado, e tirar os domínios do projeto na Vercel.
O banco novo, se precisar, é recriado vazio (Virada, passo 4). Se a limpeza (passo 6) já rodou, o Lovable continua funcionando: só perdeu a
função de exportação.
