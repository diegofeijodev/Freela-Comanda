# Migração dos dados do Lovable (Freela ERP) para o Freela Comanda — roteiro

Função SQL só-leitura **restrita ao administrador e sem senhas** no Supabase do Lovable → o dono entra como admin do Lovable na máquina
dele (`login.mjs`, JWT que vale ~1 h) → o JWT vai por stdin ao servidor → `pull.mjs` no EC2 grava UM arquivo JSON → importador
compilado na imagem da API → **ensaio** num banco de estágio → **virada** → `definir-senha` do admin → senhas novas dos demais pela
tela → limpeza no Lovable. O Lovable **nunca é escrito** (só ganha e depois perde a função). Não há arquivos/Storage.

> v1 (token + hash de senha) foi recusada pelo Lovable em 11/11: não exporta dado privado nem hash protegido só por token.
> v2 = `public.is_admin()` + nenhuma senha exportada; por isso **ninguém mantém a senha do Lovable** — todo mundo ganha senha nova.

Peças (todas em `api/`):

| Arquivo | O quê |
|---|---|
| `scripts/lovable-export/export_erpfreela.sql` | `public.export_erpfreela(p_action, p_name, p_limit, p_offset)`: SECURITY DEFINER, STABLE; exige `public.is_admin()` (erro 42501); EXECUTE só para `authenticated`; resumo, páginas das tabelas, contas SEM senha e views; todo número como texto exato |
| `scripts/lovable-export/prompt-exportacao.md` / `prompt-limpeza.md` / `limpeza_erpfreela.sql` | textos colados no chat do Lovable (`node scripts/lovable-export/render-prompts.mjs [--only exportacao\|limpeza]`) |
| `scripts/lovable-export/login.mjs` | **máquina do dono**: pede e-mail e senha do admin do Lovable (senha sem eco; nada por argumento/variável) e imprime SÓ o `access_token` |
| `scripts/lovable-export/pull.mjs` | no EC2: `--jwt-file`; `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` só do ambiente; grava `<arquivo>.json` (600); 401/403/vencido = "entre de novo"; sai 1 se alguma contagem não bater ou se a base mudou durante o pull |
| `src/scripts/import-lovable/` → `dist/src/scripts/import-lovable/main.js` | importador (`--file`, `--expect-db`, `--dry-run`, `--verify`, `--pular-sem-papel`, `--ignorar-tabela <nome>`) |
| `src/scripts/definir-senha/` → `dist/src/scripts/definir-senha/main.js` | `--expect-db <banco> --email <e-mail>`, senha nova pelo STDIN (mesmas regras e bcrypt da tela) |
| `scripts/import-lovable-e2e.sh` | teste local com Lovable falso (função SQL real, JWT, anon/loja/admin) — `../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh` |

## O que o importador garante

- **Travas antes de gravar** (qualquer uma = sai 1, nada gravado): banco conectado ≠ `--expect-db`; nosso banco diferente do que
  `esquema.ts` descreve (tabelas, colunas, gatilho desconhecido, sequence); formato ≠ `erpfreela-export/2`; tabela fora das 23 +
  `profiles` + `user_roles`; coluna/tipo/nulabilidade diferente (vem do `information_schema` do Lovable, vale até para tabela vazia);
  chave desconhecida ou faltando em qualquer linha (inclusive qualquer campo de senha); linhas ≠ resumo; pendência nas contas; banco com
  qualquer dado além dos seeds.
- **Uma transação**: `LOCK TABLE` em tudo → confere vazio (contas 0, 20 tabelas 0, `configuracoes`/`sazonalidade`/`subgrupos` iguais aos
  seeds da migração `regras`) → apaga os 3 seeds → desliga `vendas_baixa_trg` → 23 tabelas em ordem de chave estrangeira com as FKs
  LIGADAS → contas → religa o gatilho → **verifica dentro da transação** (diferença = desfaz tudo). `--dry-run` faz isso e desfaz no fim.
- **Gatilho**: só `vendas_baixa_trg` (todos os das migrações estão em `GATILHOS`); desligado na carga porque as baixas das vendas já vêm
  prontas em `movimentacoes` (ligado, dobrariam). Sem sequences/identity: nada de `setval`.
- **Contas** (`auth.users` + `profiles` + `user_roles` → `users`, MESMO id; o pull traz só id, e-mail, criação, dia do último acesso e situação):
  - **senha: TODAS entram com o hash bcrypt de uma senha aleatória que ninguém conhece** (o relatório avisa). Ninguém entra até receber
    senha nova: o admin pelo `definir-senha` (dono, no terminal), os demais pelo admin em Usuários → botão "Redefinir senha" (a tela já tem; pede a senha nova, mín. 6);
  - e-mail em minúsculas; dois iguais depois disso = aborta;
  - ficam de fora sozinhas (não entravam no Lovable): apagada, banida, anônima, e-mail nunca confirmado. "Não confirmada = não entrava"
    é inferência (confirmação de e-mail ligada no Supabase): conta de fora com último acesso recente contradiz isso — avisar;
  - papel: admin ou loja; quem tem os dois vira admin; **sem papel = aborta**, salvo `--pular-sem-papel` (fica de fora; no Lovable não via nada);
  - tabela que o Lovable ganhou depois do port (o sistema novo não tem) **aborta**, salvo `--ignorar-tabela <nome>` (só vale para tabela que não é nossa; o relatório diz quantas linhas ficaram de fora e elas continuam no arquivo exportado). 11/11: `lojas` (1 linha, nome da unidade, criada no Lovable às 17h48 BRT) + coluna `profiles.loja_id`, deixadas de fora — o sistema novo tem uma unidade só (`configuracoes.nome_unidade`);
  - **nenhuma conta ADMIN importada = aborta SEMPRE** (com um admin no banco, o "Primeiro acesso" fica fechado);
  - o relatório lista toda conta que entra (id, perfil, e-mail mascarado, criação, último acesso) e as de fora com o motivo: no Lovable
    qualquer cadastro pela API pública ganhava `loja` — conta estranha = parar e removê-la no Lovable.
- **`--verify`** (e a verificação dentro da carga), cada número com o que é, a conta e de onde veio: (1) arquivo × banco linha a linha
  (`EXCEPT ALL` tipado, 23 tabelas + contas, senha fora da comparação); (2) `count(*)` e `sum()` de cada coluna numérica calculados NO
  SUPABASE na hora do pull × os nossos (decimais exatos) e movimentações por tipo; (3) as 4 views, resultado do Lovable × o nosso pela
  chave (6ª casa) — `v_consumo_semanal` só se pull e verificação forem na mesma semana (senão aviso); (4) gatilho ligado.
  Avisos: linhas que apontam para conta que não veio (histórico fica, sem nome). Continua ok depois do `definir-senha`.

## Pré-requisitos

1. Branch no `master` e a API no ar com ele (`subir-api.sh`, `REF=master`): importador, `definir-senha` e `pull.mjs` entram na imagem.
2. **Nada** de "Primeiro acesso" em produção antes da virada (o importador recusa banco com conta).
3. O dono precisa de um login de **administrador do Lovable** que funcione (e-mail + senha).
4. Arquivo do pull lido inteiro pelo contêiner (teto 640 MB, heap 448 MB): até ~40 MB tudo bem; maior, `-e NODE_OPTIONS=--max-old-space-size=560`.

Atalhos (no servidor, `cd /opt/erp-freela`, `set -euo pipefail`; nos scripts reais o `run` leva também `-T`, porque o ssh não tem terminal):

```bash
DC="docker compose -f docker-compose.prod.yml"; RUN="$DC run --rm --no-deps"
EXP=/opt/erp-freela/lovable-export          # pasta 700 do ubuntu: JWT (600), exportações (600) e relatórios (600)
PW=$(grep '^POSTGRES_PASSWORD=' .env | cut -d= -f2-)
URL_DB() { echo "postgresql://erpfreela:$PW@erp-freela-postgres:5432/$1?schema=public"; }
imp() { # imp <banco> <arquivo.json> [opções…]
  local db=$1 f=$2; shift 2
  $RUN -e DATABASE_URL="$(URL_DB "$db")" -v "$EXP:/import:ro" api node dist/src/scripts/import-lovable/main.js --file "/import/$f" --expect-db "$db" "$@"
}
```

## Scripts em `~/erp-deploy/` (o dono roda cada um com `!`)

### 1. `migracao-prompt.sh` — uma vez
`node api/scripts/lovable-export/render-prompts.mjs --only exportacao` (local) e mostra o texto. O dono cola no chat do Lovable e
**aprova a migration**. Não precisa publicar o app.

### 2. `migracao-login.sh` — antes de cada pull (o JWT vale ~1 h)
- Local: `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` com `unzip -p ~/Downloads/erpfreela.zip .env` (sem gravar em arquivo) e
  `JWT=$(SUPABASE_URL=… SUPABASE_PUBLISHABLE_KEY=… node api/scripts/lovable-export/login.mjs)` — pede e-mail e senha do admin do Lovable
  no terminal (senha sem eco). Saiu ≠ 0 = login recusado, parar.
- Manda por **stdin** (nunca argumento): `printf '%s\n' "$JWT" | ssh … 'install -d -m 700 /opt/erp-freela/lovable-export; umask 077; cat > /opt/erp-freela/lovable-export/jwt'`.
- Pode emendar direto no pull (script 3).

### 3. `migracao-pull.sh` — gera `$EXP/<AAAAMMDD-HHMM>.json`
- Local: as mesmas `SUPABASE_URL`/`SUPABASE_PUBLISHABLE_KEY` do zip, passadas ao servidor no ambiente do `ssh … bash -s`.
- No servidor: `STAMP=$(date +%Y%m%d-%H%M)`;
  `$RUN -T --user "$(id -u):$(id -g)" -e SUPABASE_URL="$SUPABASE_URL" -e SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY" -v "$EXP:/out" api node scripts/lovable-export/pull.mjs --jwt-file /out/jwt --out /out/$STAMP.json`
  (primeiro com `--check-only`; depois o pull). Imprime o `STAMP` e o tamanho. "entre de novo" = rodar o script 2 e repetir.
  Outra saída 1 = rodar de novo. No fim, `rm -f $EXP/jwt` (o JWT dá acesso de admin ao Lovable até vencer).
- Na primeira vez, se acusar **diferença de esquema** (o Lovable pode ter mudado depois do zip de 28/10), parar e trazer a saída.

### 4. `migracao-ensaio.sh <STAMP>` — banco `erpfreela_stage` no mesmo Postgres
- `docker exec erp-freela-postgres psql -U erpfreela -d postgres -c 'DROP DATABASE IF EXISTS erpfreela_stage WITH (FORCE)' -c 'CREATE DATABASE erpfreela_stage'`
- `$RUN -T -e DATABASE_URL="$(URL_DB erpfreela_stage)" api npx prisma migrate deploy`
- `umask 077`; `imp erpfreela_stage $STAMP.json --dry-run | tee $EXP/$STAMP-ensaio-dry-run.txt`, a carga `| tee …-ensaio-carga.txt`,
  `--verify | tee …-ensaio-verify.txt` (`set -o pipefail`; parar no primeiro que sair 1; as mesmas opções nas três).
- Revisar com o dono: contas (estranhos?), contas de fora, avisos, linhas DIFERENTE (zero).
- Ensaiar também a senha do admin pelo MESMO caminho da virada (script 6 com `--expect-db erpfreela_stage`): prova o JS compilado do
  `definir-senha` e que a senha chega pelo stdin do `ssh` → `docker compose run -T` (stdin vazio = senha recusada, nada muda).
- `--apagar`: `DROP DATABASE erpfreela_stage WITH (FORCE)`.

### 5. `migracao-virada.sh <STAMP> --confirmo` — com o Lovable congelado
O script exige `--confirmo`, religa a API mesmo se algo falhar (o banco fica como estava) e **não** recria o banco sozinho: se o importador
recusar por banco não vazio, ele para e o passo 4 abaixo é feito à mão, depois de conferir o que há no banco.
1. O dono avisa a equipe e para de usar o Lovable (inclusive `*.lovable.app`); o que for lançado lá depois do pull se perde.
2. Login (script 2) e pull novo (script 3) → `STAMP` novo.
3. `$DC stop api`.
4. Banco com conta/dado: `docker exec erp-freela-postgres psql -U erpfreela -d postgres -c 'DROP DATABASE erpfreela WITH (FORCE)' -c 'CREATE DATABASE erpfreela'`
   e `$RUN -T api npx prisma migrate deploy`.
5. `imp erpfreela $STAMP.json --dry-run`, carga, `--verify`, cada um com `tee $EXP/$STAMP-virada-<etapa>.txt`. **Parar** em qualquer saída 1.
6. Backup: `docker exec erp-freela-postgres pg_dump -U erpfreela -d erpfreela -Fc > backups/pos-migracao-$STAMP.dump` (600).
7. `$DC up -d api` e `curl -fsS http://127.0.0.1:3016/health`.

### 6. `migracao-senha-admin.sh <e-mail>` — logo depois da virada
- Local: `read -rs` da senha nova duas vezes (confere se são iguais), sem eco.
- Manda por **stdin**: `printf '%s\n' "$SENHA" | ssh … "cd /opt/erp-freela && docker compose -f docker-compose.prod.yml run --rm --no-deps -T api node dist/src/scripts/definir-senha/main.js --expect-db erpfreela --email $EMAIL"`.
  Saída esperada: `senha definida para xx***@dominio`. Mesmas regras da tela (6 a 72 caracteres).
- O dono entra em `https://freela-comanda.vercel.app` com essa senha, confere fichas, estoque, inventários e contas, e em **Usuários →
  "Redefinir senha"** define a de cada pessoa (e avisa cada uma).

### 7. Domínio
- Local: `vercel domains add www.freelacomanda.com.br freela-comanda --scope freelas-projects-ccf14064` e o mesmo para `freelacomanda.com.br`
  (conferir a sintaxe com `vercel domains add --help`); anotar os registros que o Vercel mostrar.
- Locaweb: **anotar** os valores atuais (volta) e apagar `www A 185.158.133.1` e `TXT _lovable.www`; criar os registros do Vercel.
  `dig +short www.freelacomanda.com.br`. `CORS_ORIGINS` do `.env` já tem os dois domínios.

### 8. Limpeza (depois da conferência final)
- `render-prompts.mjs --only limpeza` → o dono cola no Lovable e aprova (apaga `export_erpfreela(text, text, integer, integer)`, só isso).
- Servidor: relatórios em `~/relatorios-migracao/` (600) e `rm -rf $EXP`.

## Plano de volta

O Lovable não foi escrito. Volta = DNS: `www A 185.158.133.1` e o `TXT _lovable.www` anotado; tirar os domínios do projeto na Vercel.
O banco novo, se precisar, é recriado vazio (virada, passo 4). Se a limpeza já rodou, o Lovable segue funcionando sem a função.
