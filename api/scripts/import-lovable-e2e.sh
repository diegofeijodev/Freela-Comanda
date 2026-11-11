#!/usr/bin/env bash
# Ponta a ponta da migração do Lovable em bancos LOCAIS descartáveis — nunca toca o banco de desenvolvimento nem a rede:
#   "Lovable falso" (erpfreela_e2e_lovable) = nossas migrações + seed + fixture-lovable.sql (auth.users, is_admin()) + a função
#   export_erpfreela DE VERDADE → fake-lovable.mjs (login por senha → JWT; RPC como anon/authenticated) → login.mjs → pull.mjs → JSON
#   → importador (ts-node) no destino (erpfreela_e2e_destino, recém-migrado) → definir-senha → AuthService.login.
# Rode pelo teto de memória, de api/:  ../scripts/run-capped.sh 1500 bash scripts/import-lovable-e2e.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[ "${ERP_CAPPED:-}" = 1 ] || { echo "rode pelo scripts/run-capped.sh (ver CLAUDE.md)"; exit 1; }
C=erp-freela-postgres
ORIG=erpfreela_e2e_lovable
DEST=erpfreela_e2e_destino
url() { echo "postgresql://erpfreela:erpfreela@localhost:5440/$1?schema=public"; }
TMP="$(mktemp -d)"; FAKE=""; ROLES_CRIADOS=""
export FAKE_JWT_SECRET="segredo-jwt-e2e-$RANDOM$RANDOM"
OK=0; FAIL=0
check() { if [[ "$2" == "$3" ]]; then OK=$((OK+1)); echo "  ✓ $1"; else FAIL=$((FAIL+1)); echo "  ✗ $1 — esperado [$2], veio [$3]"; fi; }
psqlc() { docker exec -i $C psql -U erpfreela -d "$1" -v ON_ERROR_STOP=1 -Atqc "$2"; }
admin() { docker exec $C psql -U erpfreela -d postgres -qc "$1" >/dev/null; }
limpar() {
  [[ -n "$FAKE" ]] && { kill -- "-$FAKE" 2>/dev/null || kill "$FAKE" 2>/dev/null || true; }
  sleep 0.5
  admin "DROP DATABASE IF EXISTS $ORIG WITH (FORCE)" || true
  admin "DROP DATABASE IF EXISTS $DEST WITH (FORCE)" || true
  for r in $ROLES_CRIADOS; do admin "DROP ROLE IF EXISTS $r" || true; done
  rm -rf "$TMP"
}
trap limpar EXIT
export NODE_OPTIONS=--max-old-space-size=500
ADM=aaaaaaaa-0000-4000-8000-000000000001; LOJA=aaaaaaaa-0000-4000-8000-000000000002
imp() { # imp <saída> <args…> — importador contra o destino (EXP troca o arquivo)
  local out="$1"; shift
  DATABASE_URL="$(url $DEST)" npx ts-node --transpile-only src/scripts/import-lovable/main.ts --file "${EXP:-$TMP/exp/x.json}" "$@" >"$out" 2>&1
}
senha() { # senha <saída> <senha-no-stdin> <args…> — CLI definir-senha contra o destino
  local out="$1" s="$2"; shift 2
  printf '%s\n' "$s" | DATABASE_URL="$(url $DEST)" npx ts-node --transpile-only src/scripts/definir-senha/main.ts "$@" >"$out" 2>&1
}
entrar() { DATABASE_URL="$(url $DEST)" npx ts-node --transpile-only scripts/import-lovable-login.ts "$@" 2>&1 | sed 's/.*→ //' | paste -sd,; }
mexe() { node -e "const fs=require('fs');const e=JSON.parse(fs.readFileSync('$TMP/exp/x.json'));$1;fs.writeFileSync('$2',JSON.stringify(e))"; }

echo "== preparo"
for r in anon authenticated; do
  if [[ -z "$(psqlc postgres "SELECT 1 FROM pg_roles WHERE rolname = '$r'")" ]]; then admin "CREATE ROLE $r NOLOGIN"; ROLES_CRIADOS="$ROLES_CRIADOS $r"; fi
done
for db in $ORIG $DEST; do admin "DROP DATABASE IF EXISTS $db WITH (FORCE)"; admin "CREATE DATABASE $db"; done
for db in $ORIG $DEST; do DATABASE_URL="$(url $db)" npx prisma migrate deploy >"$TMP/migr-$db.log" 2>&1 || { tail -20 "$TMP/migr-$db.log"; exit 1; }; done
DATABASE_URL="$(url $ORIG)" npx ts-node --transpile-only prisma/seed.ts >"$TMP/seed.log" 2>&1 || { cat "$TMP/seed.log"; exit 1; }
docker exec -i $C psql -U erpfreela -d $ORIG -q <scripts/lovable-export/fixture-lovable.sql >"$TMP/fixture.log" 2>&1 || { cat "$TMP/fixture.log"; exit 1; }
docker exec -i $C psql -U erpfreela -d $ORIG -v ON_ERROR_STOP=1 -q <scripts/lovable-export/export_erpfreela.sql >/dev/null
F="public.export_erpfreela(text,text,integer,integer)"
check "EXECUTE só para authenticated (anon e PUBLIC revogados); nenhum grant nas tabelas" "f,t,f" \
  "$(psqlc $ORIG "SELECT has_function_privilege('anon', '$F', 'EXECUTE')"),$(psqlc $ORIG "SELECT has_function_privilege('authenticated', '$F', 'EXECUTE')"),$(psqlc $ORIG "SELECT has_table_privilege('authenticated', 'public.vendas', 'SELECT')")"

echo "== prompts"
node scripts/lovable-export/render-prompts.mjs >"$TMP/prompts"
check "prompt: SQL inteiro com is_admin(), limpeza com a assinatura nova, sem token nem marcador" "1,1,1,0,0" \
  "$(grep -c 'CREATE OR REPLACE FUNCTION public.export_erpfreela' "$TMP/prompts"),$(grep -c 'IF NOT coalesce(public.is_admin(), false) THEN' "$TMP/prompts"),$(grep -c 'DROP FUNCTION IF EXISTS public.export_erpfreela(text, text, integer, integer);' "$TMP/prompts"),$(grep -ci 'token' "$TMP/prompts"),$(grep -c '__[A-Z_]*__' "$TMP/prompts")"

echo "== login e pull (Lovable falso)"
DATABASE_URL="$(url $ORIG)" setsid node scripts/lovable-export/fake-lovable.mjs --port-file "$TMP/porta" >"$TMP/fake.log" 2>&1 & FAKE=$!
for _ in $(seq 1 100); do [[ -s "$TMP/porta" ]] && break; sleep 0.1; done
P=$(cat "$TMP/porta"); BASE="http://127.0.0.1:$P"; KEY=sb_publishable_e2e
login() { SUPABASE_URL="$BASE" SUPABASE_PUBLISHABLE_KEY="$KEY" node scripts/lovable-export/login.mjs "$@"; }
pull() { PULL_PAGINA=50 SUPABASE_URL="$BASE" SUPABASE_PUBLISHABLE_KEY="$KEY" node scripts/lovable-export/pull.mjs "$@"; }
rpc() { curl -s -o /dev/null -w '%{http_code}' -H "apikey: $KEY" ${1:+-H "Authorization: Bearer $1"} -H 'content-type: application/json' -d '{"p_action":"resumo"}' "$BASE/rest/v1/rpc/export_erpfreela"; }
printf 'Dono.Teste@exemplo.com\nSenha-Admin 1\n' | login >"$TMP/jwt-admin" 2>"$TMP/l1" && r=0 || { r=$?; cat "$TMP/l1"; }
check "login.mjs do admin: só o JWT no stdout (1 linha, 3 partes)" "0,1,3" "$r,$(wc -l <"$TMP/jwt-admin"),$(tr '.' '\n' <"$TMP/jwt-admin" | grep -c .)"
printf 'loja@exemplo.com\nSenha-Loja 2\n' | login >"$TMP/jwt-loja" 2>/dev/null
printf 'Dono.Teste@exemplo.com\nSenhaErrada-123\n' | login >"$TMP/jwt-ruim" 2>"$TMP/l2" && r=0 || r=$?
check "senha errada: recusa, stdout vazio, a senha não aparece no erro" "1,0,0,1" "$r,$(wc -c <"$TMP/jwt-ruim"),$(grep -c 'SenhaErrada-123' "$TMP/l2"),$(grep -c 'login recusado' "$TMP/l2")"
login --senha x </dev/null >/dev/null 2>"$TMP/l3" && r=0 || r=$?
check "login.mjs não aceita senha por argumento" "1,1" "$r,$(grep -c 'não aceita argumentos' "$TMP/l3")"
check "função: anon 401, loja 403, admin 200" "401,403,200" "$(rpc),$(rpc "$(cat "$TMP/jwt-loja")"),$(rpc "$(cat "$TMP/jwt-admin")")"
node scripts/lovable-export/pull.mjs --jwt-file "$TMP/jwt-admin" --out "$TMP/x.json" >"$TMP/p0" 2>&1 && r=0 || r=$?
check "pull sem SUPABASE_URL/chave no ambiente: recusa" "1,1" "$r,$(grep -c 'defina SUPABASE_URL' "$TMP/p0")"
pull --jwt-file "$TMP/jwt-loja" --out "$TMP/loja.json" >"$TMP/p1" 2>&1 && r=0 || r=$?
check "pull com login de loja: recusa (403) pedindo para entrar de novo, nada gravado" "1,1,1,0" \
  "$r,$(grep -c 'HTTP 403' "$TMP/p1"),$(grep -c 'Entre de novo' "$TMP/p1"),$(ls "$TMP"/loja.json* 2>/dev/null | wc -l)"
node -e "const c=require('crypto');const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');const h=b({alg:'HS256',typ:'JWT'}),p=b({sub:'$ADM',role:'authenticated',exp:Math.floor(Date.now()/1000)-60});console.log(h+'.'+p+'.'+c.createHmac('sha256',process.env.FAKE_JWT_SECRET).update(h+'.'+p).digest('base64url'))" >"$TMP/jwt-vencido"
pull --jwt-file "$TMP/jwt-vencido" --out "$TMP/v.json" >"$TMP/p2" 2>&1 && r=0 || r=$?
check "pull com login vencido: recusa antes de chamar" "1,1" "$r,$(grep -c 'o login venceu' "$TMP/p2")"
node -e "const b=o=>Buffer.from(JSON.stringify(o)).toString('base64url');console.log(b({alg:'HS256'})+'.'+b({sub:'$ADM',exp:Math.floor(Date.now()/1000)+3600})+'.assinatura-falsa')" >"$TMP/jwt-falso"
pull --jwt-file "$TMP/jwt-falso" --out "$TMP/f.json" >"$TMP/p3" 2>&1 && r=0 || r=$?
check "pull com JWT de assinatura falsa: 401 e 'entre de novo'" "1,1,1" "$r,$(grep -c 'HTTP 401' "$TMP/p3"),$(grep -c 'Entre de novo' "$TMP/p3")"
pull --jwt-file "$TMP/jwt-admin" --out "$TMP/exp/x.json" >"$TMP/p4" 2>&1 && r=0 || { r=$?; cat "$TMP/p4"; }
check "pull do admin completo e conferido, arquivo 600, formato 2" "0,1,600,erpfreela-export/2" \
  "$r,$(grep -c 'exportação completa e conferida' "$TMP/p4"),$(stat -c %a "$TMP/exp/x.json"),$(node -e "console.log(require('$TMP/exp/x.json').formato)")"
check "export SEM nenhum campo nem valor de senha" "0,0,0" \
  "$(grep -c 'encrypted_password' "$TMP/exp/x.json"),$(grep -c 'password' "$TMP/exp/x.json"),$(grep -c '\$2a\$' "$TMP/exp/x.json")"
check "conta exportada só com as colunas mínimas" "anonima,apagada,banida,confirmada,created_at,email,id,ultimo_acesso" \
  "$(node -e "const e=require('$TMP/exp/x.json');console.log(Object.keys(e.usuarios[0]).sort().join(','))")"
check "25 tabelas no resumo, 4 contas, decimal longo como texto, várias páginas" "25,4,21.9666666666666667,t" \
  "$(node -e "const e=require('$TMP/exp/x.json');const m=e.tabelas.movimentacoes.find(x=>x.custo_unitario&&x.custo_unitario.startsWith('21.9'));console.log([Object.keys(e.resumo.tabelas).length,e.usuarios.length,m.custo_unitario,e.tabelas.movimentacoes.length>200?'t':'f'].join(','))")"

echo "== travas do importador"
imp "$TMP/i1" --expect-db outro_banco --dry-run && r=0 || r=$?
check "banco com nome errado é recusado" "1,1" "$r,$(grep -c 'não "outro_banco"' "$TMP/i1")"
mexe "e.tabelas.vendas[0].cupom='X'" "$TMP/ruim1.json"
EXP="$TMP/ruim1.json" imp "$TMP/i2" --expect-db $DEST --dry-run && r=0 || r=$?
check "chave desconhecida numa linha é recusada" "1,1" "$r,$(grep -c 'vendas, linha 1: chave(s) desconhecida(s) cupom' "$TMP/i2")"
mexe "e.tabelas.user_roles=e.tabelas.user_roles.filter(r=>!(r.user_id==='$ADM'&&r.role==='admin'));e.resumo.tabelas.user_roles.linhas=e.tabelas.user_roles.length" "$TMP/ruim2.json"
EXP="$TMP/ruim2.json" imp "$TMP/i3" --expect-db $DEST --dry-run --pular-sem-papel && r=0 || r=$?
check "nenhum admin importado: recusa sempre" "1,1" "$r,$(grep -c 'nenhuma conta de ADMINISTRADOR' "$TMP/i3")"
mexe "e.tabelas.user_roles=e.tabelas.user_roles.filter(r=>r.user_id!=='$LOJA');e.resumo.tabelas.user_roles.linhas=e.tabelas.user_roles.length" "$TMP/ruim3.json"
EXP="$TMP/ruim3.json" imp "$TMP/i4" --expect-db $DEST --dry-run && r=0 || r=$?
check "conta sem papel: recusa pedindo --pular-sem-papel" "1,1" "$r,$(grep -c -- '--pular-sem-papel' "$TMP/i4")"
EXP="$TMP/ruim3.json" imp "$TMP/i5" --expect-db $DEST --dry-run --pular-sem-papel && r=0 || { r=$?; tail -30 "$TMP/i5"; }
check "com --pular-sem-papel o ensaio passa e a conta fica de fora" "0,1" "$r,$(grep -c "fora  $LOJA .*sem papel" "$TMP/i5")"
imp "$TMP/i5b" --expect-db $DEST --dry-run --importar-sem-senha && r=0 || r=$?
check "--importar-sem-senha não existe mais" "1,1" "$r,$(grep -c 'opção desconhecida: --importar-sem-senha' "$TMP/i5b")"

echo "== ensaio (dry-run)"
imp "$TMP/i6" --expect-db $DEST --dry-run && r=0 || { r=$?; cat "$TMP/i6"; }
check "ensaio ok e NADA gravado (contas 0, vendas 0, seeds intactos)" "0,1,0,0,10" \
  "$r,$(grep -c 'RESULTADO: ensaio OK' "$TMP/i6"),$(psqlc $DEST 'SELECT count(*) FROM users'),$(psqlc $DEST 'SELECT count(*) FROM vendas'),$(psqlc $DEST 'SELECT count(*) FROM subgrupos')"
check "relatório: 2 entram, 2 de fora, aviso das senhas, e-mails mascarados" "1,1,1,1,0" \
  "$(grep -c '4 no Lovable → 2 entram (1 admin, 1 loja), 2 ficam de fora' "$TMP/i6"),$(grep -c 'e-mail nunca confirmado' "$TMP/i6"),$(grep -c 'apagada no Lovable' "$TMP/i6"),$(grep -c 'TODAS as contas entram com uma senha aleatória' "$TMP/i6"),$(grep -ci 'dono.teste@exemplo' "$TMP/i6")"

echo "== carga"
imp "$TMP/i7" --expect-db $DEST && r=0 || { r=$?; cat "$TMP/i7"; }
check "carga gravada com verificação ok" "0,1,1" "$r,$(grep -c 'RESULTADO: carga GRAVADA' "$TMP/i7"),$(grep -c 'verificação: ok' "$TMP/i7")"
TABS="configuracoes sazonalidade subgrupos fornecedores itens_estoque itens_cardapio ficha_ingredientes de_para_produtos importacoes vendas movimentacoes inventarios inventario_itens listas_compra listas_compra_itens notas_entrada notas_entrada_itens vinculos_produto plano_contas centros_custo contas_pagar dre_subgrupos caixa_fechamentos"
iguais=0; difs=""
for t in $TABS; do
  h1=$(psqlc $ORIG "SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.$t x")
  h2=$(psqlc $DEST "SELECT md5(coalesce(string_agg(x::text, '|' ORDER BY x::text), '')) FROM public.$t x")
  [[ "$h1" == "$h2" ]] && iguais=$((iguais+1)) || difs="$difs $t"
done
check "as 23 tabelas idênticas à origem, linha a linha (md5)$difs" "23" "$iguais"
check "baixas NÃO dobraram: movimentações e baixa_venda iguais à origem" \
  "$(psqlc $ORIG "SELECT count(*) || '/' || count(*) FILTER (WHERE tipo='baixa_venda') FROM movimentacoes")" \
  "$(psqlc $DEST "SELECT count(*) || '/' || count(*) FILTER (WHERE tipo='baixa_venda') FROM movimentacoes")"
check "seeds trocados pelos do Lovable (mesmos ids dos subgrupos, configurações e sazonalidade)" \
  "$(psqlc $ORIG "SELECT string_agg(id::text, ',' ORDER BY id) FROM subgrupos"),3.25,12.5" \
  "$(psqlc $DEST "SELECT string_agg(id::text, ',' ORDER BY id) FROM subgrupos"),$(psqlc $DEST 'SELECT mkup_padrao FROM configuracoes'),$(psqlc $DEST 'SELECT fator_pct FROM sazonalidade WHERE mes=7')"
check "contas: mesmo id, e-mail em minúsculas, perfis, hash bcrypt (aleatório)" "$ADM|dono.teste@exemplo.com|admin|Dono Teste|true;$LOJA|loja@exemplo.com|loja|loja|true" \
  "$(psqlc $DEST "SELECT string_agg(id || '|' || email || '|' || perfil || '|' || nome || '|' || (password_hash ~ '^\\\$2[aby]\\\$10\\\$'), ';' ORDER BY id) FROM users")"
check "antes do definir-senha ninguém entra (nem com a senha do Lovable)" "recusado,recusado" "$(entrar dono.teste@exemplo.com 'Senha-Admin 1' loja@exemplo.com 'Senha-Loja 2')"
check "gatilho vendas_baixa_trg religado" "O" "$(psqlc $DEST "SELECT tgenabled FROM pg_trigger WHERE tgname='vendas_baixa_trg'")"
check "aviso da movimentação de conta excluída" "1" "$(grep -c 'movimentacoes.usuario_id: 1 linha(s) apontam para conta que não veio' "$TMP/i7")"

echo "== definir-senha do admin"
senha "$TMP/s1" 'Nova-Senha 9' --expect-db outro_banco --email dono.teste@exemplo.com && r=0 || r=$?
check "banco errado recusado" "1,1" "$r,$(grep -c 'não "outro_banco"' "$TMP/s1")"
senha "$TMP/s2" 'Nova-Senha 9' --expect-db $DEST --email ninguem@exemplo.com && r=0 || r=$?
check "e-mail inexistente recusado" "1,1" "$r,$(grep -c 'não existe conta com o e-mail ni\*\*\*@exemplo.com' "$TMP/s2")"
senha "$TMP/s3" '12345' --expect-db $DEST --email dono.teste@exemplo.com && r=0 || r=$?
check "senha curta recusada (regra da tela)" "1,1" "$r,$(grep -c 'pelo menos 6 caracteres' "$TMP/s3")"
senha "$TMP/s4" 'Nova-Senha 9' --expect-db $DEST --email dono.teste@exemplo.com --senha x && r=0 || r=$?
check "senha por argumento recusada" "1,1" "$r,$(grep -c 'argumento não aceito' "$TMP/s4")"
senha "$TMP/s5" 'Nova-Senha 9' --expect-db $DEST --email DONO.Teste@exemplo.com && r=0 || { r=$?; cat "$TMP/s5"; }
check "senha definida (só a linha com e-mail mascarado)" "0,senha definida para do***@exemplo.com" "$r,$(cat "$TMP/s5")"
check "login real (AuthService.login): admin entra com a senha nova; loja continua travada" "ok admin,recusado,recusado" \
  "$(entrar DONO.TESTE@exemplo.com 'Nova-Senha 9' dono.teste@exemplo.com 'Senha-Admin 1' loja@exemplo.com 'Senha-Loja 2')"

echo "== depois da carga"
imp "$TMP/i8" --expect-db $DEST && r=0 || r=$?
check "segunda carga recusada (banco não vazio)" "1,1" "$r,$(grep -c 'não está vazio' "$TMP/i8")"
imp "$TMP/i9" --expect-db $DEST --verify && r=0 || { r=$?; cat "$TMP/i9"; }
check "--verify limpo (depois do definir-senha), com as 4 views comparadas" "0,1,4" \
  "$r,$(grep -c 'verificação: ok' "$TMP/i9"),$(grep -cE '^  ok +v_(saldo_teorico|fichas_resumo|cmv_periodo|consumo_semanal) ' "$TMP/i9")"
check "v_cmv_periodo tem linhas para comparar" "t" "$(psqlc $DEST 'SELECT count(*) > 0 FROM v_cmv_periodo')"
V=$(psqlc $DEST "SELECT id FROM vendas ORDER BY id LIMIT 1")
psqlc $DEST "UPDATE vendas SET valor_total = valor_total + 0.01 WHERE id = '$V'" >/dev/null
imp "$TMP/i10" --expect-db $DEST --verify && r=0 || r=$?
check "--verify acusa um centavo a mais numa venda" "1,1,1" "$r,$(grep -c 'DIFERENTE vendas: 1 linha(s) do arquivo' "$TMP/i10"),$(grep -c 'DIFERENTE soma de vendas.valor_total' "$TMP/i10")"
N0=$(psqlc $DEST "SELECT count(*) FROM movimentacoes")
psqlc $DEST "INSERT INTO vendas (pedido, data, produto_relatorio, item_cardapio_id, quantidade, valor_total) SELECT 'E2E', current_date, 'X', id, 1, 10 FROM itens_cardapio WHERE nome = 'Espeto de Picanha'" >/dev/null
check "venda nova depois da carga gera baixa (gatilho funcionando)" "2" "$(( $(psqlc $DEST 'SELECT count(*) FROM movimentacoes') - N0 ))"

echo "== limpeza no Lovable"
docker exec -i $C psql -U erpfreela -d $ORIG -v ON_ERROR_STOP=1 -q <scripts/lovable-export/limpeza_erpfreela.sql
check "função apagada pelo SQL do prompt de limpeza" "0" "$(psqlc $ORIG "SELECT count(*) FROM pg_proc WHERE proname = 'export_erpfreela'")"
pull --jwt-file "$TMP/jwt-admin" --out "$TMP/depois.json" >"$TMP/p5" 2>&1 && r=0 || r=$?
check "pull depois da limpeza falha" "1" "$r"

echo; echo "$OK ok, $FAIL falha(s)"
[[ $FAIL -eq 0 ]]
