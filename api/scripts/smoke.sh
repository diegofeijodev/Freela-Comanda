#!/usr/bin/env bash
# Smoke da API contra um banco recém-semeado (use scripts/smoke-capped.sh — ele cria o banco descartável e sobe a API).
# Cobre: permissões admin × loja (o papel das políticas RLS), as funções de regra (inventário cego, fechamento, lista de
# compras, recebimento, entrada de nota), contas/caixa/DRE, importações, usuários e a leitura de PDF sem chave. No fim: o roteiro
# ponta a ponta (E1–E9: nota → estoque → ficha → venda/baixa → CMV → DRE; ponto; empresas), a Cana (K1–K6) e o multiempresa.
set -uo pipefail
BASE=${BASE:-http://localhost:3096}
PGDB=${PGDB:-erpfreela_smoke}
OUT=$(mktemp)
ok=0
falhas=0

req() { # req MÉTODO CAMINHO TOKEN [CORPO_JSON] → $CODE e $BODY
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$1" "$BASE$2")
  [ -n "${3:-}" ] && args+=(-H "authorization: Bearer $3")
  [ -n "${4:-}" ] && args+=(-H 'content-type: application/json' -d "$4")
  CODE=$(curl "${args[@]}")
  BODY=$(cat "$OUT")
}
check() { # check DESCRIÇÃO ESPERADO OBTIDO
  if [ "$2" == "$3" ]; then ok=$((ok + 1)); else falhas=$((falhas + 1)); echo "FALHOU: $1 — esperado [$2], veio [$3] ${BODY:0:300}"; fi
}
j() { echo "$BODY" | jq -r "$1"; }
sql() { docker exec erp-freela-postgres psql -U erpfreela -d "$PGDB" -tAc "$1"; }
HOJE=$(TZ=America/Sao_Paulo date +%F)

# ---------- auth
req GET /health; check "health" 200 "$CODE"
req GET /v1/auth/existe-admin; check "existe-admin" true "$(j .existe)"
req POST /v1/auth/primeiro-acesso "" '{"nome":"X","email":"x@x.com","senha":"123456"}'
check "primeiro acesso com admin existente" 403 "$CODE"
check "mensagem do primeiro acesso" "Novos usuários são cadastrados pelo administrador." "$(j .error.message)"
req POST /v1/auth/login "" '{"email":"admin@erpfreela.local","senha":"errada"}'
check "senha errada" 401 "$CODE"; check "mensagem senha errada" "E-mail ou senha incorretos" "$(j .error.message)"
req POST /v1/auth/login "" '{"email":"ADMIN@erpfreela.local","senha":"erpfreela123"}'
check "login admin (e-mail sem caixa)" 200 "$CODE"; ADM=$(j .access_token); check "perfil admin" admin "$(j .user.perfil)"
req POST /v1/auth/login "" '{"email":"loja@erpfreela.local","senha":"erpfreela123"}'
LOJA=$(j .access_token); check "perfil loja" loja "$(j .user.perfil)"
req GET /v1/auth/me; check "me sem token" 401 "$CODE"
req GET /v1/auth/me "$LOJA"; check "me loja" loja "$(j .user.perfil)"
req GET /v1/auth/me "token-invalido"; check "token inválido" 401 "$CODE"

# ---------- loja: o que NÃO alcança (RLS admin-only no protótipo)
for r in /v1/estoque/saldos /v1/fichas/resumo "/v1/vendas?ini=$HOJE&fim=$HOJE" /v1/usuarios /v1/itens-estoque /v1/contas-pagar \
  /v1/caixa /v1/sazonalidade /v1/fornecedores /v1/inventarios/historico /v1/inventarios/cmv /v1/notas /v1/importacoes /v1/de-para \
  /v1/plano-contas /v1/dre-subgrupos "/v1/dre/pagos?mes=2026-10" /v1/itens-cardapio "/v1/estoque/objetivo?mes=1"; do
  req GET "$r" "$LOJA"; check "loja barrada em GET $r" 403 "$CODE"
done
req PATCH /v1/configuracoes "$LOJA" '{"mkup_padrao":9}'; check "loja não edita config" 403 "$CODE"
req POST /v1/listas-compra/gerar "$LOJA"; check "loja não gera lista" 403 "$CODE"
# ---------- loja: o que alcança (is_staff)
req GET /v1/configuracoes "$LOJA"; check "loja lê config" 200 "$CODE"; check "config id 1" 1 "$(j .id)"
req GET /v1/subgrupos "$LOJA"; check "loja lê subgrupos" 10 "$(j length)"
req GET /v1/fichas/loja "$LOJA"; check "loja lê fichas sem custo" 200 "$CODE"
check "fichas da loja sem preço/custo" false "$(echo "$BODY" | jq '[.[] | has("preco_venda") or has("custo_total")] | any')"
check "ingredientes da ficha da loja" true "$(echo "$BODY" | jq '.[0].ingredientes | length > 0')"
req GET /v1/inventarios "$LOJA"; check "loja lê inventários" 200 "$CODE"
req GET /v1/listas-compra "$LOJA"; check "loja lê listas" 200 "$CODE"

# ---------- uuid malformado / inexistente
req GET /v1/inventarios/nao-e-uuid "$ADM"; check "uuid malformado = 404" 404 "$CODE"
req GET /v1/inventarios/00000000-0000-4000-8000-000000000000 "$ADM"; check "inventário inexistente = 404" 404 "$CODE"

# ---------- inventário inicial (contagem cega)
req POST /v1/inventarios "$LOJA" "{\"data\":\"$HOJE\",\"periodicidade\":\"semanal\"}"
check "loja não abre sem loja_pode_abrir" 403 "$CODE"
req POST /v1/inventarios "$ADM" "{\"data\":\"$HOJE\",\"periodicidade\":\"anual\"}"; check "periodicidade inválida" 400 "$CODE"
D1=$(TZ=America/Sao_Paulo date -d '-14 days' +%F)
req POST /v1/inventarios "$ADM" "{\"data\":\"$D1\",\"periodicidade\":\"semanal\"}"; check "admin abre inventário" 201 "$CODE"; INV1=$(j .id)
req POST /v1/inventarios "$ADM" "{\"data\":\"$HOJE\",\"periodicidade\":\"semanal\"}"
check "segundo em andamento recusado" 400 "$CODE"; check "mensagem em andamento" "Já existe um inventário em andamento" "$(j .error.message)"
req GET /v1/inventarios/atual "$LOJA"; check "atual = inicial" true "$(j .inventario.inicial)"
req GET "/v1/inventarios/$INV1/contagem" "$LOJA"; check "itens para contar" 9 "$(j length)"
check "contagem sem teórico" false "$(echo "$BODY" | jq '[.[] | has("teorico_snapshot") or has("final")] | any')"
for id in $(echo "$BODY" | jq -r '.[].id'); do
  req POST "/v1/inventario-itens/$id/contagem" "$LOJA" '{"quantidade":10}'
  [ "$(j .resultado)" == ok ] || check "contagem inicial ok" ok "$(j .resultado)"
done
check "contagem inicial registrada" 200 "$CODE"
req POST "/v1/inventario-itens/$id/contagem" "$LOJA" '{"quantidade":-1}'; check "quantidade negativa" 400 "$CODE"
req GET "/v1/inventarios/$INV1" "$ADM"; check "inicial aguardando aprovação" aguardando_aprovacao "$(j .status)"
req POST "/v1/inventarios/$INV1/fechar" "$LOJA"; check "loja não fecha" 403 "$CODE"
req POST "/v1/inventarios/$INV1/fechar" "$ADM"; check "fecha inicial" 200 "$CODE"; L1=$(j .lista_id)
req POST "/v1/inventarios/$INV1/fechar" "$ADM"; check "fechar de novo" "Inventário já fechado" "$(j .error.message)"
check "movimentações inventario_inicial" 9 "$(sql "select count(*) from movimentacoes where tipo='inventario_inicial'")"
req GET "/v1/listas-compra/$L1" "$LOJA"; check "lista do fechamento" gerada "$(j .status)"
req GET "/v1/listas-compra/$L1/itens" "$LOJA"; check "itens da lista (loja) sem preço" false "$(echo "$BODY" | jq '[.[] | has("preco_unitario") or has("objetivo")] | any')"
req GET "/v1/listas-compra/$L1/itens" "$ADM"; check "itens da lista (admin) com objetivo" true "$(echo "$BODY" | jq 'length == 0 or (.[0] | has("objetivo"))')"

# ---------- segundo inventário: diferença → recontar → diferença confirmada; final manual; CMV
req PATCH /v1/configuracoes "$ADM" '{"loja_pode_abrir":true}'; check "liga loja_pode_abrir" true "$(j .loja_pode_abrir)"
D2=$(TZ=America/Sao_Paulo date -d '-7 days' +%F)
req POST /v1/inventarios "$LOJA" "{\"data\":\"$D2\",\"periodicidade\":\"semanal\"}"; check "loja abre com a chave ligada" 201 "$CODE"; INV2=$(j .id)
req GET "/v1/inventarios/$INV2/itens" "$ADM"; check "admin vê teórico" true "$(echo "$BODY" | jq '.[0] | has("teorico_snapshot")')"
PICANHA=$(echo "$BODY" | jq -r '.[] | select(.itens_estoque.nome=="Picanha") | .id')
# 99 kg nunca cabe na tolerância do teórico (que aqui é negativo: vendas depois do inventário inicial).
req POST "/v1/inventario-itens/$PICANHA/contagem" "$LOJA" '{"quantidade":99}'; check "diferença pede recontagem" recontar "$(j .resultado)"
req POST "/v1/inventario-itens/$PICANHA/contagem" "$LOJA" '{"quantidade":99}'; check "2ª contagem ainda recontar" recontar "$(j .resultado)"
req POST "/v1/inventario-itens/$PICANHA/contagem" "$LOJA" '{"quantidade":99}'; check "3ª contagem confirma" ok "$(j .resultado)"
check "status diferença confirmada" diferenca_confirmada "$(sql "select status from inventario_itens where id='$PICANHA'")"
req GET "/v1/inventarios/$INV2/contagem" "$LOJA"; GELO=$(echo "$BODY" | jq -r '.[] | select(.nome=="Gelo") | .id')
req PATCH "/v1/inventario-itens/$GELO/final" "$ADM" '{"final":3,"justificativa":""}'; check "final exige justificativa" 400 "$CODE"
req PATCH "/v1/inventario-itens/$GELO/final" "$ADM" '{"final":3,"justificativa":"conferido no freezer"}'; check "final manual" diferenca_confirmada "$(j .status)"
req POST "/v1/inventarios/$INV2/fechar" "$ADM"; check "fechar com itens pendentes" "Há itens sem quantidade final" "$(j .error.message)"
req GET "/v1/inventarios/$INV2/contagem" "$LOJA"
for id in $(echo "$BODY" | jq -r '.[] | select(.situacao!="contado") | .id'); do
  req POST "/v1/inventario-itens/$id/contagem" "$LOJA" '{"quantidade":4}'
  [ "$(j .resultado)" == recontar ] && req POST "/v1/inventario-itens/$id/contagem" "$LOJA" '{"quantidade":4}' && \
    [ "$(j .resultado)" == recontar ] && req POST "/v1/inventario-itens/$id/contagem" "$LOJA" '{"quantidade":4}'
done
req GET "/v1/inventarios/$INV2" "$ADM"; check "2º aguardando aprovação" aguardando_aprovacao "$(j .status)"
req POST "/v1/inventarios/$INV2/fechar" "$ADM"; check "fecha 2º" 200 "$CODE"; L2=$(j .lista_id)
check "ajustes de inventário" 9 "$(sql "select count(*) from movimentacoes where tipo='ajuste_inventario'")"
req GET /v1/inventarios/cmv "$ADM"; check "CMV do período" 9 "$(j length)"
req GET /v1/inventarios/historico "$ADM"; check "histórico de perdas" 9 "$(j length)"
req GET /v1/estoque/saldos "$ADM"; check "saldos" 9 "$(j length)"
PIC_ID=$(sql "select item_estoque_id from inventario_itens where id='$PICANHA'")
check "saldo parte do último inventário" "$D2" "$(echo "$BODY" | jq -r --arg id "$PIC_ID" '.[] | select(.item_estoque_id==$id) | .data_ultimo_inventario')"
VENDIDO=$(sql "select coalesce(-sum(quantidade),0)::float from movimentacoes where item_estoque_id='$PIC_ID' and tipo='baixa_venda' and data > '$D2'")
check "saldo = contado − vendido depois" "$(echo "99 - $VENDIDO" | bc)" "$(echo "$BODY" | jq -r --arg id "$PIC_ID" '.[] | select(.item_estoque_id==$id) | .saldo')"

# ---------- lista de compras: avulso, enviada, recebimento
req POST "/v1/listas-compra/$L2/itens" "$ADM" '{"descricao":"Carvão 5kg","quantidade":3}'; check "item avulso" Avulso "$(j .fornecedor)"; AV=$(j .id)
req PATCH "/v1/listas-compra-itens/$AV" "$ADM" '{"embalagens":4}'; check "edita embalagens" 4 "$(j .embalagens)"
req POST "/v1/listas-compra/$L2/enviada" "$ADM"; check "marca enviada" enviada "$(j .status)"
req POST "/v1/listas-compra/$L2/itens" "$ADM" '{"descricao":"x","quantidade":1}'; check "avulso em lista enviada" 400 "$CODE"
req GET "/v1/listas-compra/$L2/itens" "$ADM"
REC=$(echo "$BODY" | jq -r '[.[] | select(.item_estoque_id != null)][0].id')
if [ -n "$REC" ] && [ "$REC" != null ]; then
  req PATCH "/v1/listas-compra-itens/$REC" "$ADM" '{"qtd_recebida":2,"preco_pago":11.5}'; check "recebido parcial" 2 "$(j .qtd_recebida)"
  req POST "/v1/listas-compra/$L2/receber" "$ADM" '{"atualizar_preco":true}'; check "recebimento parcial" recebida_parcial "$(j .status)"
  check "entrada de compra" 1 "$(sql "select count(*) from movimentacoes where tipo='entrada_compra' and referencia='lista $L2'")"
fi
req POST /v1/listas-compra/gerar "$ADM"; check "gerar lista agora" 201 "$CODE"

# ---------- cardápio / fichas
req POST /v1/itens-cardapio "$ADM" '{"nome":"Smoke Burger"}'; check "nova ficha" 201 "$CODE"; FB=$(j .id)
req POST /v1/itens-cardapio "$ADM" '{"nome":"Smoke Burger"}'; check "ficha duplicada" 409 "$CODE"
req GET /v1/itens-estoque "$ADM"; ALC=$(echo "$BODY" | jq -r '.[] | select(.nome=="Alcatra") | .id')
req POST "/v1/itens-cardapio/$FB/ingredientes" "$ADM" "{\"item_estoque_id\":\"$ALC\",\"quantidade\":0.15}"; check "ingrediente" KG "$(j .unidade)"; ING=$(j .id)
req PATCH "/v1/ficha-ingredientes/$ING" "$ADM" '{"quantidade":0.2,"rendimento":1}'; check "edita ingrediente" 0.2 "$(j .quantidade)"
req PATCH "/v1/itens-cardapio/$FB" "$ADM" '{"preco_venda":29.9,"categoria":"Burgers","mkup":2.5}'; check "salva ficha" 29.9 "$(j .preco_venda)"
req POST "/v1/itens-cardapio/$FB/duplicar" "$ADM"; check "duplica ficha" 201 "$CODE"; FC=$(j .id)
req GET "/v1/itens-cardapio/$FC/ingredientes" "$ADM"; check "cópia com ingredientes" 1 "$(j length)"
req GET "/v1/itens-cardapio/$FC" "$ADM"; check "nome da cópia" "Smoke Burger (cópia)" "$(j .nome)"
req GET "/v1/fichas/resumo?ativos=true" "$ADM"; check "resumo inclui ficha nova" true "$(echo "$BODY" | jq --arg id "$FB" 'any(.[]; .id==$id)')"
req PATCH "/v1/itens-cardapio/$FC" "$ADM" '{"ativo":false}'
req GET "/v1/fichas/resumo?ativos=true" "$ADM"; check "inativa sai do catálogo" false "$(echo "$BODY" | jq --arg id "$FC" 'any(.[]; .id==$id)')"
req DELETE "/v1/itens-cardapio/$FC" "$ADM"; check "exclui ficha" 200 "$CODE"
req DELETE "/v1/itens-estoque/$ALC" "$ADM"; check "insumo em ficha não exclui" "Item em uso por fichas técnicas. Desative-o." "$(j .error.message)"

# ---------- estoque objetivo / movimentações
req POST /v1/itens-estoque "$ADM" '{"nome":"Smoke Sal Grosso"}'; check "novo insumo" Mercearia "$(j .subgrupo)"; SAL=$(j .id)
req PATCH "/v1/itens-estoque/$SAL" "$ADM" '{"unidade":"kg","preco_unitario":4.5,"usar_manual":true,"consumo_semanal_manual":2}'
check "unidade em maiúsculas" KG "$(j .unidade)"
req GET "/v1/estoque/objetivo?mes=12" "$ADM"
check "objetivo dezembro (2 × 1,5 × 1,2)" 3.6 "$(echo "$BODY" | jq --arg id "$SAL" '.[] | select(.item_estoque_id==$id) | .objetivo')"
req GET "/v1/estoque/objetivo?mes=13" "$ADM"; check "mês inválido" 400 "$CODE"
req POST /v1/movimentacoes "$ADM" "{\"item_estoque_id\":\"$SAL\",\"tipo\":\"perda\",\"data\":\"$HOJE\",\"quantidade\":3}"
check "perda vira negativa" -3 "$(j .quantidade)"
req POST /v1/movimentacoes "$ADM" "{\"item_estoque_id\":\"$SAL\",\"tipo\":\"baixa_venda\",\"data\":\"$HOJE\",\"quantidade\":3}"; check "tipo manual inválido" 400 "$CODE"
req GET "/v1/movimentacoes?item_estoque_id=$SAL" "$ADM"; check "movimentação listada" 1 "$(j length)"
req DELETE "/v1/itens-estoque/$SAL" "$ADM"; check "exclui insumo livre" 200 "$CODE"
req PATCH /v1/sazonalidade/11 "$ADM" '{"fator_pct":25}'; check "sazonalidade" 25 "$(j .fator_pct)"

# ---------- entrada de nota
CH="35261012345678000199550010000099991000099991"
req GET "/v1/notas/existe?chave=$CH" "$ADM"; check "nota nova" false "$(j .existe)"
NOTA="{\"chave\":\"$CH\",\"numero\":\"9999\",\"serie\":\"1\",\"fornecedor_nome\":\"Frigorífico Smoke\",\"fornecedor_cnpj\":\"12.345.678/0001-99\",\"data_emissao\":\"$HOJE\",\"data_entrada\":\"$HOJE\",\"valor_total\":691.95,\"forma_pagamento\":\"boleto\",\"origem\":\"xml\",\"atualizar_preco\":true,\"itens\":[{\"codigo\":\"P01\",\"descricao\":\"PICANHA BOVINA KG\",\"unidade\":\"KG\",\"quantidade\":10.5,\"valor_unitario\":65.9,\"item_estoque_id\":\"$(sql "select id from itens_estoque where nome='Picanha'")\",\"fator\":1},{\"codigo\":\"P02\",\"descricao\":\"SACOLA\",\"unidade\":\"UN\",\"quantidade\":1,\"valor_unitario\":0,\"item_estoque_id\":null}],\"parcelas\":[{\"vencimento\":\"2026-11-20\",\"valor\":345.98},{\"vencimento\":\"2026-12-20\",\"valor\":345.97}]}"
req POST /v1/notas "$ADM" "$NOTA"; check "dá entrada na nota" 201 "$CODE"; check "duas parcelas" 2 "$(j .contas)"
req POST /v1/notas "$ADM" "$NOTA"; check "nota repetida" "Esta nota já foi lançada" "$(j .error.message)"
check "entrada no estoque" 10.5 "$(sql "select quantidade::float from movimentacoes where referencia like 'NF 9999%'")"
check "preço atualizado" 65.9 "$(sql "select preco_unitario::float from itens_estoque where nome='Picanha'")"
req GET /v1/vinculos?cnpj=12345678000199 "$ADM"; check "vínculo salvo" P01 "$(j '.[0].codigo_fornecedor')"
check "fornecedor criado pelo CNPJ" 1 "$(sql "select count(*) from fornecedores where cnpj='12345678000199'")"
NOTA2=$(echo "$NOTA" | sed "s/$CH/35261012345678000199550010000099981000099994/; s/\"boleto\"/\"pix\"/; s/\"9999\"/\"9998\"/")
req POST /v1/notas "$ADM" "$NOTA2"; check "nota à vista" true "$(j .a_vista)"
check "conta à vista já paga" paga "$(sql "select status from contas_pagar where descricao like 'NF 9998%'")"
NOTA3=$(echo "$NOTA" | sed "s/$CH/35261012345678000199550010000099971000099997/; s/\"parcelas\":\[.*\]}/\"parcelas\":[]}/")
req POST /v1/notas "$ADM" "$NOTA3"; check "boleto sem parcelas" "Informe o vencimento de cada parcela" "$(j .error.message)"
req GET /v1/notas "$ADM"; check "notas lançadas" 2 "$(j length)"

# nota por foto: "Dar entrada" cadastra o insumo que faltar
nota_foto() { # $1=chave $2=itens(json) $3=forma $4=parcelas(json)
  jq -nc --arg ch "$1" --argjson it "$2" --arg fp "${3:-pix}" --argjson pa "${4:-[]}" --arg d "$HOJE" \
    '{chave:$ch,numero:"7001",fornecedor_nome:"Laticínios Smoke",data_entrada:$d,valor_total:178,forma_pagamento:$fp,origem:"foto",atualizar_preco:false,itens:$it,parcelas:$pa}'
}
NI='[{"descricao":"REQUEIJAO CX","unidade":"CX","quantidade":2,"valor_unitario":89,"fator":12,"novo_insumo":{"nome":"Requeijão Smoke","unidade":"un","subgrupo":"frios, laticinios e ovos"}}]'
req POST /v1/notas "$ADM" "$(nota_foto 35261012345678000199550010000070011000070019 "$NI")"; check "nota por foto" 201 "$CODE"; check "insumo criado" 1 "$(j .insumos_criados)"
check "insumo novo: unidade em maiúsculas" UN "$(sql "select unidade from itens_estoque where nome='Requeijão Smoke'")"
check "insumo novo: preço por unidade" 7.4167 "$(sql "select round(preco_unitario,4)::float from itens_estoque where nome='Requeijão Smoke'")"
check "insumo novo: unidades por embalagem" 12 "$(sql "select qtd_por_embalagem::int from itens_estoque where nome='Requeijão Smoke'")"
check "insumo novo: fornecedor" "Laticínios Smoke" "$(sql "select fornecedor from itens_estoque where nome='Requeijão Smoke'")"
check "insumo novo: subgrupo (nome gravado como na tabela)" "Frios, Laticínios e Ovos" "$(sql "select subgrupo from itens_estoque where nome='Requeijão Smoke'")"
check "insumo novo: entrada no estoque" 24 "$(sql "select m.quantidade::float from movimentacoes m join itens_estoque i on i.id=m.item_estoque_id where i.nome='Requeijão Smoke'")"
NI2='[{"descricao":"REQUEIJAO CX","unidade":"CX","quantidade":1,"valor_unitario":89,"fator":12,"novo_insumo":{"nome":"REQUEIJAO SMOKE","unidade":"un"}}]'
req POST /v1/notas "$ADM" "$(nota_foto 35261012345678000199550010000070021000070024 "$NI2")"; check "insumo repetido pelo nome (outra caixa)" 0 "$(j .insumos_criados)"
check "insumo não duplicou" 1 "$(sql "select count(*) from itens_estoque where lower(nome)='requeijão smoke'")"
NI3='[{"descricao":"A","quantidade":1,"valor_unitario":5,"novo_insumo":{"nome":"Nata Smoke","unidade":"kg"}},{"descricao":"B","quantidade":1,"valor_unitario":5,"novo_insumo":{"nome":"  NATA  smoke ","unidade":"kg"}}]'
req POST /v1/notas "$ADM" "$(nota_foto 35261012345678000199550010000070031000070030 "$NI3")"; check "mesmo nome em duas linhas" 1 "$(j .insumos_criados)"
check "mesmo nome em duas linhas: 1 insumo" 1 "$(sql "select count(*) from itens_estoque where nome ilike 'nata%smoke%'")"
NI4=$(echo "$NI" | jq -c ".[0].item_estoque_id=\"$(sql "select id from itens_estoque where nome='Picanha'")\"")
req POST /v1/notas "$ADM" "$(nota_foto 35261012345678000199550010000070041000070045 "$NI4")"; check "existente + novo na mesma linha" 400 "$CODE"
check "existente + novo: mensagem" "Escolha um insumo existente ou cadastre um novo, não os dois" "$(j .error.message)"
NI5='[{"descricao":"Z","quantidade":1,"valor_unitario":5,"novo_insumo":{"nome":"Nao Deve Existir","unidade":"un"}}]'
req POST /v1/notas "$ADM" "$(nota_foto 35261012345678000199550010000070051000070050 "$NI5" boleto)"; check "a prazo sem parcelas" 400 "$CODE"
check "nada criado se a nota falha" 0 "$(sql "select count(*) from itens_estoque where nome='Nao Deve Existir'")"
NI7='[{"descricao":"R1","quantidade":1,"valor_unitario":5,"novo_insumo":{"nome":"Rollback Smoke","unidade":"un"}},{"descricao":"R2","quantidade":1,"valor_unitario":5,"item_estoque_id":"00000000-0000-4000-8000-000000000000"}]'
req POST /v1/notas "$ADM" "$(nota_foto 35261012345678000199550010000070071000070071 "$NI7")"; echo "rollback: HTTP $CODE $(j .error.code)"
check "falha dentro da transação não é 201" 1 "$([ "$CODE" != 201 ] && echo 1 || echo 0)"
check "rollback desfaz o insumo novo" 0 "$(sql "select count(*) from itens_estoque where nome='Rollback Smoke'")"
check "rollback não deixa nota gravada" 0 "$(sql "select count(*) from notas_entrada where chave='35261012345678000199550010000070071000070071'")"
NI6='[{"descricao":"Y","quantidade":1,"valor_unitario":5,"novo_insumo":{"nome":"Smoke Sem Grupo","unidade":"un","subgrupo":"Grupo Inventado"}}]'
req POST /v1/notas "$ADM" "$(nota_foto 35261012345678000199550010000070061000070066 "$NI6")"; check "subgrupo inexistente: nota" 201 "$CODE"
check "subgrupo inexistente cai no padrão" Mercearia "$(sql "select subgrupo from itens_estoque where nome='Smoke Sem Grupo'")"
# chave formatada com espaços = a mesma nota já lançada (só dígitos)
CHF="35 2610 1234 5678 0001 9955 0010 0000 7001 1000 0700 19"
req POST /v1/notas "$ADM" "$(nota_foto "$CHF" "$NI")"; check "chave com espaços: nota repetida" "Esta nota já foi lançada" "$(j .error.message)"
# valor zero no insumo novo: cria sem preço
NI8='[{"descricao":"BRINDE","quantidade":1,"valor_unitario":0,"fator":0,"novo_insumo":{"nome":"Brinde Smoke","unidade":"un"}}]'
req POST /v1/notas "$ADM" "$(nota_foto 35261012345678000199550010000070081000070087 "$NI8")"; check "insumo novo com valor zero" 201 "$CODE"
check "insumo novo com valor zero: sem preço" 1 "$(sql "select count(*) from itens_estoque where nome='Brinde Smoke' and preco_unitario is null")"

# ---------- contas a pagar / DRE / caixa
req GET /v1/plano-contas?ativo=true "$ADM"; PL=$(echo "$BODY" | jq -r '.[] | select(.conta=="ALUGUEL") | .id')
req GET /v1/centros-custo?ativo=true "$ADM"; CC=$(j '.[0].id')
req POST /v1/contas-pagar "$ADM" "{\"descricao\":\"Smoke conta\",\"valor\":100,\"vencimento\":\"$HOJE\"}"; check "conta manual" aberta "$(j .status)"; C1=$(j .id)
req POST /v1/contas-pagar "$ADM" "{\"descricao\":\"\",\"valor\":100,\"vencimento\":\"$HOJE\"}"; check "conta sem descrição" 400 "$CODE"
req POST /v1/contas-pagar/liquidar "$ADM" "{\"ids\":[\"$C1\"],\"pago_em\":\"2026-11-03\",\"plano_conta_id\":\"$PL\",\"centro_custo_id\":\"$CC\"}"
check "liquidar" 1 "$(j .liquidadas)"
req GET "/v1/dre/pagos?mes=2026-11" "$ADM"; check "pago entra no DRE de novembro (30 dias)" 100 "$(j '.[0].valor_pago')"
req POST "/v1/contas-pagar/$C1/reabrir" "$ADM"; check "reabrir" aberta "$(j .status)"; check "reabrir limpa classe" null "$(j .plano_conta_id)"
req DELETE "/v1/contas-pagar/$C1" "$ADM"; check "exclui conta manual" 200 "$CODE"
CN=$(sql "select id from contas_pagar where nota_id is not null limit 1")
req DELETE "/v1/contas-pagar/$CN" "$ADM"; check "conta de nota não exclui" 409 "$CODE"
CX='{"data":"2026-11-30","dinheiro":100,"debito":200,"credito":300,"pix":50,"ifood":0,"delivery_proprio":0,"cartao_alimentacao":0,"sangria":20,"sangria_cofre":10}'
req PUT /v1/caixa "$ADM" "$CX"; check "caixa do dia 30/11" 200 "$CODE"
req PUT /v1/caixa "$ADM" "${CX/\"dinheiro\":100/\"dinheiro\":150}"; check "mesmo dia substitui" 150 "$(j .dinheiro)"
req GET "/v1/caixa?mes=2026-11" "$ADM"; check "mês de 30 dias" 1 "$(j length)"; CXID=$(j '.[0].id')
req GET "/v1/caixa?mes=2026-02" "$ADM"; check "fevereiro" 200 "$CODE"
req GET "/v1/caixa?mes=2026-13" "$ADM"; check "mês inválido" 400 "$CODE"
req DELETE "/v1/caixa/$CXID" "$ADM"; check "exclui caixa" 200 "$CODE"
req POST /v1/dre-subgrupos "$ADM" '{"nome":"despesas com marketing","sigla":"MKT","meta_pct":3}'; check "subgrupo DRE em maiúsculas" "DESPESAS COM MARKETING" "$(j .nome)"
req PATCH "/v1/dre-subgrupos/$(j .id)" "$ADM" '{"meta_pct":4.5}'; check "meta do subgrupo" 4.5 "$(j .meta_pct)"
req POST /v1/plano-contas/lote "$ADM" '{"linhas":[{"grupo":"DRE","subgrupo":"DESPESAS COM MARKETING","conta":"INSTAGRAM"},{"grupo":"DRE","conta":"OUTROS"}]}'
check "importa plano de contas" 2 "$(j .importadas)"

# ---------- CNPJ e chave com letras
nota_cnpj() { # $1=chave $2=número $3=série $4=confirmar (opcional)
  jq -nc --arg ch "$1" --arg n "$2" --arg s "$3" --arg c "${4:-}" --arg d "$HOJE" \
    '{chave:$ch,numero:$n,serie:(if $s=="" then null else $s end),fornecedor_nome:"Atacadão Smoke",fornecedor_cnpj:"12.abc.345/01de-35",data_entrada:$d,valor_total:1234.56,forma_pagamento:"pix",origem:"xml",atualizar_preco:false,itens:[{descricao:"CAIXA SMOKE",unidade:"UN",quantidade:1,valor_unitario:1234.56}],parcelas:[]} + (if $c=="" then {} else {confirmar_repetida:true} end)'
}
VETOR=35261112ABC34501DE35550010000044111000044116
req POST /v1/notas "$ADM" "$(nota_cnpj 35261112ABC34501DE35550010000044111000044111 4411 1)"; check "chave com DV errado: 400" 400 "$CODE"
check "chave com DV errado: code" CHAVE_INVALIDA "$(j .error.code)"
check "chave com DV errado: frase" "A chave de acesso da nota é inválida. Confira os 44 caracteres." "$(j .error.message)"
req POST /v1/notas "$ADM" "$(nota_cnpj '35 2611 12ab c345 01de 3555 0010 0000 4411 1000 0441 16' 4411 1)"; check "nota alfanumérica: 201" 201 "$CODE"
check "nota alfanumérica: chave igual ao vetor" "$VETOR" "$(sql "select chave from notas_entrada where numero='4411'")"
check "nota alfanumérica: CNPJ do fornecedor" 12ABC34501DE35 "$(sql "select fornecedor_cnpj from notas_entrada where numero='4411'")"
check "nota alfanumérica: fornecedor criado" 1 "$(sql "select count(*) from fornecedores where cnpj='12ABC34501DE35'")"
req GET "/v1/notas/existe?chave=$(echo "$VETOR" | tr 'A-Z' 'a-z')" "$ADM"; check "existe com a chave em minúsculas" true "$(j .existe)"
req GET "/v1/vinculos?cnpj=12.345.678/0001-99" "$ADM"; check "vínculos com o CNPJ pontuado" P01 "$(j '.[0].codigo_fornecedor')"
req POST /v1/fornecedores "$ADM" '{"nome":"Forn Letras Smoke","cnpj":"12.abc.345/01de-35"}'; check "fornecedor com letras" 12ABC34501DE35 "$(j .cnpj)"
sql "insert into fornecedores (nome, cnpj) values ('Forn Migra Smoke', '98.abc.765/43de-21')" >/dev/null
sql "insert into notas_entrada (fornecedor_nome, fornecedor_cnpj) values ('Forn Migra Smoke', '98.765.432/0001-10')" >/dev/null
sql "$(cat prisma/migrations/20261116140000_cnpj_alfanumerico/migration.sql)" >/dev/null
check "migração: fornecedor normalizado" 98ABC76543DE21 "$(sql "select cnpj from fornecedores where nome='Forn Migra Smoke'")"
check "migração: nota normalizada" 98765432000110 "$(sql "select fornecedor_cnpj from notas_entrada where fornecedor_nome='Forn Migra Smoke'")"
sql "$(cat prisma/migrations/20261116140000_cnpj_alfanumerico/migration.sql)" >/dev/null
check "migração idempotente: fornecedor" 98ABC76543DE21 "$(sql "select cnpj from fornecedores where nome='Forn Migra Smoke'")"
check "migração idempotente: nota" 98765432000110 "$(sql "select fornecedor_cnpj from notas_entrada where fornecedor_nome='Forn Migra Smoke'")"
# migração dos dados antigos (vínculos e chaves do Lovable) com proteção contra colisão
MIG2=prisma/migrations/20261116140200_cnpj_chave_antigos/migration.sql
PIC=$(sql "select id from itens_estoque where nome='Picanha'")
CLIMPA=35261188ABC22233CC55001000005511100005511599
CALVO=35261199ABC22233CC55001000005511100005511599
sql "insert into vinculos_produto (fornecedor_cnpj, codigo_fornecedor, item_estoque_id) values ('12.111.222/0001-33','V1','$PIC'),('12.222.333/0001-44','C1','$PIC'),('12222333000144','C1','$PIC'),('55.666.777/0001-88','D1','$PIC'),('55666777000188 ','D1','$PIC')" >/dev/null
sql "insert into notas_entrada (fornecedor_nome, chave) values ('Chave Suja Smoke','35 2611 99ab c222 33cc 55001000005511100005511599'),('Chave Limpa Smoke','$CLIMPA'),('Chave Colide Smoke','35-2611-88ab-c222-33cc-55001000005511100005511599'),('Chave Curta Smoke','abc-123')" >/dev/null
estado_mig2() { sql "select (select count(*) from vinculos_produto where fornecedor_cnpj='12111222000133' and codigo_fornecedor='V1'), (select count(*) from vinculos_produto where fornecedor_cnpj='12.111.222/0001-33'), (select count(*) from vinculos_produto where fornecedor_cnpj='12.222.333/0001-44'), (select count(*) from vinculos_produto where fornecedor_cnpj='12222333000144'), (select count(*) from vinculos_produto where fornecedor_cnpj='55666777000188' and codigo_fornecedor='D1'), (select count(*) from vinculos_produto where codigo_fornecedor='D1'), (select chave from notas_entrada where fornecedor_nome='Chave Suja Smoke'), (select chave from notas_entrada where fornecedor_nome='Chave Colide Smoke'), (select chave from notas_entrada where fornecedor_nome='Chave Curta Smoke')"; }
sql "$(cat $MIG2)" >/dev/null
ESPERADO="1|0|1|1|1|2|$CALVO|35-2611-88ab-c222-33cc-55001000005511100005511599|abc-123"
check "migração dos antigos: vínculo pontuado, colisões e chaves" "$ESPERADO" "$(estado_mig2)"
sql "$(cat $MIG2)" >/dev/null
check "migração dos antigos: idempotente" "$ESPERADO" "$(estado_mig2)"

# ---------- nota repetida (mesmo CNPJ + mesmo número; a nota de 4411 acima é o vetor)
HOJE_BR=$(TZ=America/Sao_Paulo date +%d/%m/%Y)
K1=35261112ABC34501DE35550010000044111000044124
K2=35261112ABC34501DE35550010000044111000044132
K3=35261112ABC34501DE35550010000044111000044140
K4=35261112ABC34501DE35550010000044111000044159
req GET "/v1/notas/repetidas?cnpj=12.abc.345/01de-35&numero=000.004.411&serie=001" "$ADM"
check "consulta prévia: 200" 200 "$CODE"; check "consulta prévia: 1 nota" 1 "$(j 'length')"
check "consulta prévia: fornecedor" "Atacadão Smoke" "$(j '.[0].fornecedor_nome')"; check "consulta prévia: origem" xml "$(j '.[0].origem')"
req POST /v1/notas "$ADM" "$(nota_cnpj $K1 000.004.411 001)"; check "repetida sem confirmação: 409" 409 "$CODE"
check "repetida sem confirmação: code" NOTA_REPETIDA "$(j .error.code)"
check "repetida sem confirmação: frase" "Já existe a NF 4411 série 1 de Atacadão Smoke, lançada em $HOJE_BR por XML, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim." "$(j .error.message)"
check "repetida sem confirmação: nada gravado" 0 "$(sql "select count(*) from notas_entrada where chave='$K1'")"
req POST /v1/notas "$ADM" "$(nota_cnpj $K1 000.004.411 001 true)"; check "repetida confirmada: 201" 201 "$CODE"
check "repetida confirmada: repetida_de é a nota do vetor" "$(sql "select id from notas_entrada where chave='$VETOR'")" "$(sql "select repetida_de from notas_entrada where chave='$K1'")"
req POST /v1/notas "$ADM" "$(nota_cnpj $K2 4411 1)"; check "duas parecidas: 409" 409 "$CODE"
check "duas parecidas: frase" "Já existe a NF 000.004.411 série 001 de Atacadão Smoke, lançada em $HOJE_BR por XML, de R$ 1.234,56 (e mais 1 parecida). Se for outra nota, confirme para lançar mesmo assim." "$(j .error.message)"
req POST /v1/notas "$ADM" "$(nota_cnpj $K3 4411 2)"; check "série 2: 201 sem confirmar" 201 "$CODE"
req POST /v1/notas "$ADM" "$(nota_cnpj $K4 4411 '')"; check "série vazia: 409" 409 "$CODE"
req GET "/v1/notas/repetidas?cnpj=12ABC34501DE35&numero=4411" "$LOJA"; check "repetidas como loja: 403" 403 "$CODE"
req GET "/v1/notas/existe?chave=$VETOR" "$ADM"; check "existe com detalhes: número" 4411 "$(j .nota.numero)"

# ---------- importações
req POST /v1/importacoes/insumos "$ADM" '{"arquivo":"insumos.csv","modo":"acrescentar","linhas":[{"codigo":"S01","nome":"Smoke Cebola","unidade":"kg","preco_unitario":"4,50","consumo_semanal_base":"1,5"}]}'
check "importa insumo" 1 "$(j .importados)"
check "insumo com consumo manual" t "$(sql "select usar_manual from itens_estoque where nome='Smoke Cebola'")"
req POST /v1/importacoes/fichas "$ADM" '{"arquivo":"fichas.csv","modo":"acrescentar","linhas":[{"item_cardapio":"Smoke Espeto","categoria":"Chopp","preco_venda":"12","insumo":"smoke cebola","quantidade":"0,1","observacao":"rend. 2"},{"item_cardapio":"Smoke Espeto","insumo":"Inexistente","quantidade":"1"}]}'
check "importa ficha" 1 "$(j .ingredientes)"
check "grupo Bebidas pela categoria" Bebidas "$(sql "select grupo from itens_cardapio where nome='Smoke Espeto'")"
check "rendimento da observação" 2 "$(sql "select rendimento::int from ficha_ingredientes fi join itens_cardapio ic on ic.id=fi.item_cardapio_id where ic.nome='Smoke Espeto'")"
VEND='{"arquivo":"vendas.csv","modo":"acrescentar","linhas":[{"pedido":"S1","data":"2026-10-20","hora":"19:30","produto_relatorio":"SMOKE ESPETO","item_cardapio":"smoke espeto","quantidade":"2","valor_total":"24,00"},{"pedido":"S1","data":"2026-10-20","produto_relatorio":"SMOKE ESPETO","quantidade":"1","valor_total":"12"},{"pedido":"S2","data":"20/10/2026","produto_relatorio":"SMOKE ESPETO","quantidade":"1","valor_total":"12"}]}'
req POST /v1/importacoes/vendas "$ADM" "$VEND"; check "vendas agregadas" 1 "$(j .inseridas)"
check "soma das linhas repetidas" 3 "$(sql "select quantidade::int from vendas where pedido='S1'")"
check "hora gravada" 19:30:00 "$(sql "select hora from vendas where pedido='S1'")"
check "baixa pela ficha" "-0.3" "$(sql "select sum(m.quantidade)::float from movimentacoes m join vendas v on v.id=m.venda_id where v.pedido='S1'")"
req POST /v1/importacoes/vendas "$ADM" "$VEND"; check "venda repetida ignorada" 1 "$(j .ignoradas)"
req GET /v1/de-para "$ADM"; check "de-para do produto novo" true "$(echo "$BODY" | jq 'any(.[]; .produto_relatorio=="SMOKE ESPETO" and .item_cardapio_id!=null)')"
req PUT /v1/de-para "$ADM" '{"produto_relatorio":"TAXA DE ROLHA","item_cardapio_id":null}'; check "mapear de-para" 200 "$CODE"
req GET /v1/importacoes "$ADM"; check "histórico de importações" 4 "$(j length)"

# ---------- usuários
req POST /v1/usuarios "$ADM" '{"nome":"Smoke","email":"smoke@x.com","senha":"123456","perfil":"loja"}'; check "cria usuário" 201 "$CODE"; U=$(j .id)
req POST /v1/usuarios "$ADM" '{"nome":"Smoke","email":"SMOKE@x.com","senha":"123456","perfil":"loja"}'; check "e-mail repetido" 409 "$CODE"
req POST /v1/usuarios "$ADM" '{"nome":"S","email":"s@x.com","senha":"123","perfil":"loja"}'; check "senha curta" "Dados inválidos" "$(j .error.message | cut -d' ' -f2-)"
req PATCH "/v1/usuarios/$U/perfil" "$ADM" '{"perfil":"admin"}'; check "troca perfil" admin "$(j .perfil)"
ME=$(sql "select id from users where email='admin@erpfreela.local'")
req PATCH "/v1/usuarios/$ME/perfil" "$ADM" '{"perfil":"loja"}'; check "não troca o próprio perfil" 400 "$CODE"
req DELETE "/v1/usuarios/$ME" "$ADM"; check "não exclui a si mesmo" "Você não pode excluir a si mesmo" "$(j .error.message)"
req PUT "/v1/usuarios/$U/senha" "$ADM" '{"senha":"nova123"}'; check "redefine senha" 200 "$CODE"
req POST /v1/auth/login "" '{"email":"smoke@x.com","senha":"nova123"}'; check "entra com a senha nova" 200 "$CODE"; TU=$(j .access_token)
req POST /v1/auth/trocar-senha "$TU" '{"senha_atual":"errada","senha_nova":"outra123"}'; check "troca própria senha errada" 400 "$CODE"
req POST /v1/auth/trocar-senha "$TU" '{"senha_atual":"nova123","senha_nova":"outra123"}'; check "troca própria senha" 200 "$CODE"
req DELETE "/v1/usuarios/$U" "$ADM"; check "exclui usuário" 200 "$CODE"
req GET /v1/auth/me "$TU"; check "token de conta excluída morre" 401 "$CODE"

# ---------- leitura de PDF sem chave
PDF=$(mktemp --suffix=.pdf); printf '%%PDF-1.4\n%%fim\n' > "$PDF"; TXT=$(mktemp --suffix=.pdf); echo oi > "$TXT"
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $ADM" -F "arquivo=@$PDF;type=application/pdf" "$BASE/v1/notas/ler-pdf"); BODY=$(cat "$OUT")
check "PDF sem chave" "Leitura de PDF não configurada: cadastre a chave de uma IA em Configurações." "$(j .error.message)"
# chave de IA pela tela (Configurações): só admin; sem chave = desligada; recusa provedor/chave inválidos SEM chamar a IA
req GET /v1/ia-chave "$ADM"; check "status da IA sem chave" 200 "$CODE"; check "IA desligada" null "$(j .origem)"
req GET /v1/ia-chave "$LOJA"; check "loja não vê a chave de IA" 403 "$CODE"
req PUT /v1/ia-chave "$LOJA" '{"provedor":"openai","chave":"sk-proj-abcdefghijklmnopqrstuvwxyz"}'; check "loja não salva chave de IA" 403 "$CODE"
req PUT /v1/ia-chave "$ADM" '{"provedor":"outra","chave":"sk-proj-abcdefghijklmnopqrstuvwxyz"}'; check "IA desconhecida" 400 "$CODE"
req PUT /v1/ia-chave "$ADM" '{"provedor":"openai","chave":"curta"}'; check "chave curta recusada" 400 "$CODE"
check "nada gravado" 0 "$(sql "select count(*) from ia_chave")"
req DELETE /v1/ia-chave "$ADM"; check "remover sem chave" 200 "$CODE"
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $ADM" -F "arquivo=@$TXT" "$BASE/v1/dda/ler-pdf"); BODY=$(cat "$OUT")
check "arquivo que não é PDF" "O arquivo não é um PDF." "$(j .error.message)"
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $LOJA" -F "arquivo=@$PDF" "$BASE/v1/notas/ler-pdf"); check "loja não lê PDF" 403 "$CODE"
# foto da nota: JPEG mínimo válido (só importa o começo FF D8 FF)
JPG=$(mktemp --suffix=.jpg); printf '\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9' > "$JPG"
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $ADM" -F "arquivo=@$JPG;type=image/jpeg" "$BASE/v1/notas/ler-foto"); BODY=$(cat "$OUT")
check "foto sem chave" "Leitura de nota não configurada: cadastre a chave de uma IA em Configurações." "$(j .error.message)"; check "foto sem chave: 503" 503 "$CODE"
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $ADM" -F "arquivo=@$TXT" "$BASE/v1/notas/ler-foto"); BODY=$(cat "$OUT")
check "arquivo que não é imagem" "O arquivo não é uma imagem (JPG, PNG ou WebP)." "$(j .error.message)"
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $ADM" -F "a=@$JPG" -F "b=@$JPG" -F "c=@$JPG" -F "d=@$JPG" -F "e=@$JPG" "$BASE/v1/notas/ler-foto"); BODY=$(cat "$OUT")
check "cinco fotos" "Envie até 4 fotos da mesma nota." "$(j .error.message)"; check "cinco fotos: 400" 400 "$CODE"
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $LOJA" -F "arquivo=@$JPG" "$BASE/v1/notas/ler-foto"); check "loja não lê foto" 403 "$CODE"
# sugestão de insumo por IA para os itens do XML (só texto)
req POST /v1/notas/sugerir-insumos "$ADM" '{"itens":[{"descricao":"TOMATE ITALIANO","unidade":"KG"}]}'; check "sugerir insumos sem chave" PDF_NAO_CONFIGURADO "$(j .error.code)"; check "sugerir insumos sem chave: 503" 503 "$CODE"
req POST /v1/notas/sugerir-insumos "$LOJA" '{"itens":[{"descricao":"TOMATE"}]}'; check "loja não pede sugestão de insumo" 403 "$CODE"
req POST /v1/notas/sugerir-insumos "$ADM" '{"itens":[]}'; check "sugerir insumos sem linhas: 400" 400 "$CODE"
req POST /v1/notas/sugerir-insumos "$ADM" "$(jq -nc '{itens: [range(201) | {descricao: "X"}]}')"; check "sugerir insumos com 201 linhas: 400" 400 "$CODE"
req POST /v1/notas/sugerir-insumos "$ADM" '{"itens":[{"descricao":"X","valor_total":10}]}'; check "sugerir insumos com campo a mais: 400" 400 "$CODE"
# ---------- certificado digital (A1): só admin; .pfx de TESTE do repositório (senha senha-de-teste); nada sensível volta nem é gravado em claro
FIX=src/modules/certificado-digital/__tests__/fixtures
cert() { # cert ARQUIVO SENHA → corpo JSON do PUT
  jq -n --arg a "$(base64 -w0 "$FIX/$1")" --arg s "$2" '{arquivo_base64:$a,senha:$s}'
}
VALIDO=$(cert valido.pfx senha-de-teste)
req GET /v1/certificado-digital "$LOJA"; check "loja não vê o certificado" 403 "$CODE"
req PUT /v1/certificado-digital "$LOJA" "$VALIDO"; check "loja não envia certificado" 403 "$CODE"
req DELETE /v1/certificado-digital "$LOJA"; check "loja não remove certificado" 403 "$CODE"
req GET /v1/certificado-digital "$ADM"; check "certificado: status" 200 "$CODE"
check "certificado ausente" ausente "$(j .situacao)"; check "histórico vazio" 0 "$(j '.historico | length')"
req PATCH /v1/configuracoes "$ADM" '{"cnpj":"  "}'; check "CNPJ em branco é aceito" 200 "$CODE"; check "CNPJ em branco: vazio" "" "$(j .cnpj)"
req PUT /v1/certificado-digital "$ADM" "$VALIDO"; check "empresa sem CNPJ: 400" 400 "$CODE"
check "empresa sem CNPJ: code" EMPRESA_SEM_CNPJ "$(j .error.code)"
check "empresa sem CNPJ: frase" "Preencha o CNPJ da empresa no quadro Empresa, toque em Salvar (no alto da página) e envie o certificado de novo." "$(j .error.message)"
req PATCH /v1/configuracoes "$ADM" '{"cnpj":"12.345.678/0001-95"}'; check "CNPJ da empresa gravado" 200 "$CODE"
check "CNPJ da empresa normalizado" 12345678000195 "$(j .cnpj)"
req PATCH /v1/configuracoes "$ADM" '{"cnpj":"12.345.678/0001-94"}'; check "CNPJ com DV errado: 400" 400 "$CODE"
check "CNPJ com DV errado: code" CNPJ_INVALIDO "$(j .error.code)"
check "CNPJ com DV errado: frase" "CNPJ inválido. Confira os 14 caracteres (pode ter letras)." "$(j .error.message)"
check "CNPJ com DV errado: banco intacto" 12345678000195 "$(sql "select cnpj from configuracoes where id=1")"
req PATCH /v1/configuracoes "$ADM" '{"mkup_padrao":2.5}'; check "salvar sem o CNPJ: 200" 200 "$CODE"
req PATCH /v1/configuracoes "$ADM" '{"cnpj":"12.abc.345/01de-35"}'; check "CNPJ com letras" 12ABC34501DE35 "$(j .cnpj)"
req PATCH /v1/configuracoes "$ADM" '{"cnpj":"12.345.678/0001-95"}'
req PUT /v1/certificado-digital "$ADM" "$(cert valido.pfx errada)"; check "senha errada: 400" 400 "$CODE"
check "senha errada: code" CERTIFICADO_SENHA "$(j .error.code)"
check "senha errada: nada gravado" 0 "$(sql "select count(*) from certificado_digital")"
req PUT /v1/certificado-digital "$ADM" "$VALIDO"; check "certificado válido: 200" 200 "$CODE"
check "válido: situação" valido "$(j .situacao)"; check "válido: CNPJ confere" igual "$(j .cnpj_confere)"; check "válido: tipo" A1 "$(j .tipo)"
check "válido: cadeia não conferida (âncoras reais)" false "$(j .cadeia_conferida)"
check "válido: resposta sem chave" false "$(echo "$BODY" | grep -c -e BEGIN -e senha-de-teste -e PRIVATE | jq '. > 0')"
check "válido: material cifrado" 0 "$(sql "select count(*) from certificado_digital where material_cifrado like '%BEGIN%'")"
req GET /v1/certificado-digital "$ADM"; check "GET sem material" false "$(echo "$BODY" | grep -c -e BEGIN -e material -e chave | jq '. > 0')"
check "GET: histórico do envio" enviado "$(j '.historico[0].evento')"
req PUT /v1/certificado-digital "$ADM" "$(cert mesma-raiz-filial.pfx senha-de-teste)"; check "filial da mesma raiz: 200" 200 "$CODE"
check "filial: mesma raiz" mesma_raiz "$(j .cnpj_confere)"
req PUT /v1/certificado-digital "$ADM" "$(cert outro-cnpj.pfx senha-de-teste)"; check "outro CNPJ: 400" 400 "$CODE"
check "outro CNPJ: frase" "Este certificado é do CNPJ 99.888.777/0001-00 (OUTRA EMPRESA SA). O CNPJ da empresa é 12.345.678/0001-95." "$(j .error.message)"
req GET /v1/certificado-digital "$ADM"; check "troca recusada: segue a filial" 12345678000276 "$(j .cnpj)"
TXTB64=$(printf 'isto não é um certificado' | base64 -w0)
req PUT /v1/certificado-digital "$ADM" "{\"arquivo_base64\":\"$TXTB64\",\"senha\":\"x\"}"; check "arquivo de texto: 400" 400 "$CODE"
check "arquivo de texto: code" CERTIFICADO_ARQUIVO "$(j .error.code)"
req DELETE /v1/certificado-digital "$ADM"; check "remover certificado" 200 "$CODE"
check "removido: dados do certificado que estava em uso (a filial)" 12345678000276 "$(j '.historico[0].cnpj')"
check "removido: situação" ausente "$(j .situacao)"; check "removido: histórico" 3 "$(j '.historico | length')"
check "removido: 1º evento" removido "$(j '.historico[0].evento')"
req DELETE /v1/certificado-digital "$ADM"; check "remover de novo" 200 "$CODE"; check "histórico não cresce" 3 "$(j '.historico | length')"
check "histórico no banco" 3 "$(sql "select count(*) from certificado_digital_historico")"
check "uma única linha removido (duplo toque não duplica)" 1 "$(sql "select count(*) from certificado_digital_historico where evento='removido'")"
check "removido grava a filial" 12345678000276 "$(sql "select cnpj from certificado_digital_historico where evento='removido'")"
req GET /v1/configuracoes "$LOJA"; check "loja lê config sem certificado" 0 "$(echo "$BODY" | grep -c BEGIN)"
# ---------- notas da SEFAZ (nenhuma chamada à SEFAZ: busca desligada e sem certificado)
# Barreiras: a linha semeada tem busca_ligada=false (o agendador, 1 min depois do boot, para em "não ligada" antes de qualquer rede),
# o certificado acabou de ser removido (a única tentativa de ligar dá 503 e não grava nada) e o último check confere que
# sefaz_consultas só tem a linha semeada (a consulta é gravada ANTES de qualquer pergunta sair).
SZ=/v1/notas-sefaz
ZERO=00000000-0000-4000-8000-000000000000
# Trava de segurança: se o certificado ainda existir, ou houver busca ou respostas ligadas, o smoke PARA aqui (exit 1), antes de
# qualquer passo que possa ligar a busca, iniciar uma consulta ou mandar uma resposta. (O smoke não usa `set -e`: sem isto, um check
# falho seguiria adiante.) A API do smoke sobe com SEFAZ_MANIFESTACAO=ligada; as respostas nunca são ligadas aqui.
trava_sefaz() { # trava_sefaz MOMENTO
  local certs ligadas respostas
  certs=$(sql "select count(*) from certificado_digital") || certs=erro
  ligadas=$(sql "select count(*) from sefaz_distribuicao where busca_ligada") || ligadas=erro
  respostas=$(sql "select count(*) from sefaz_manifestacao where ligada") || respostas=erro
  if [ "$certs" != 0 ] || [ "$ligadas" != 0 ] || [ "$respostas" != 0 ]; then
    echo "TRAVA DO SMOKE ($1): certificado_digital=$certs, buscas ligadas=$ligadas, respostas ligadas=$respostas. Nada deve existir aqui; smoke interrompido antes de tocar na SEFAZ."
    exit 1
  fi
}
trava_sefaz "antes do bloco da SEFAZ"
for r in "GET $SZ/situacao" "GET $SZ" "GET $SZ/$ZERO/xml" "POST $SZ/buscar" "POST $SZ/$ZERO/reabrir" "POST $SZ/$ZERO/responder-de-novo"; do
  req "${r%% *}" "${r#* }" "$LOJA"; check "loja barrada em $r" 403 "$CODE"
done
req PUT $SZ/configuracao "$LOJA" '{"busca_ligada":false}'; check "loja barrada em PUT $SZ/configuracao" 403 "$CODE"
req PUT $SZ/respostas "$LOJA" '{"ligadas":false}'; check "loja barrada em PUT $SZ/respostas" 403 "$CODE"
req POST "$SZ/$ZERO/ignorar" "$LOJA" '{"motivo":"nao_e_compra"}'; check "loja barrada em POST $SZ/:id/ignorar" 403 "$CODE"
req GET $SZ/situacao; check "notas da SEFAZ sem token" 401 "$CODE"

req GET $SZ/situacao "$ADM"; check "situação: 200" 200 "$CODE"
check "situação: ambiente" producao "$(j .ambiente)"; check "situação: busca desligada" false "$(j .busca_ligada)"
check "situação: sem certificado" CERTIFICADO_NAO_CADASTRADO "$(j .certificado.code)"
check "situação: frase sem certificado" "Envie o certificado digital da empresa no quadro acima para ligar a busca." "$(j .certificado.mensagem)"
req PUT $SZ/configuracao "$ADM" '{"busca_ligada":true}'; check "ligar sem certificado: 503" 503 "$CODE"
[ "$CODE" == 503 ] || { echo "TRAVA DO SMOKE: ligar sem certificado não deu 503 (veio $CODE); smoke interrompido antes do POST buscar."; exit 1; }
trava_sefaz "depois do PUT de ligar"
check "ligar sem certificado: code" CERTIFICADO_NAO_CADASTRADO "$(j .error.code)"
check "ligar sem certificado: nada ligado" 0 "$(sql "select count(*) from sefaz_distribuicao where busca_ligada")"
check "ligar sem certificado: nada gravado" 0 "$(sql "select count(*) from sefaz_distribuicao")"
req PUT $SZ/configuracao "$ADM" '{"busca_ligada":"sim"}'; check "ligar com valor que não é booleano: 400" 400 "$CODE"
trava_sefaz "antes do POST buscar"
req POST $SZ/buscar "$ADM"; check "buscar com a busca desligada: 409" 409 "$CODE"
check "buscar com a busca desligada: code" SEFAZ_BUSCA_DESLIGADA "$(j .error.code)"
check "buscar com a busca desligada: frase" "A busca na SEFAZ está desligada. Ligue em Configurações → Notas da SEFAZ." "$(j .error.message)"

# semeadura por SQL (ids fixos; XML fictício em dollar-quoting); o procNFe já nasce processado para o agendador não pegá-lo
CONS=00000000-0000-4000-8000-0000000000c1
DOC1=00000000-0000-4000-8000-0000000000d1; DOC2=00000000-0000-4000-8000-0000000000d2
NA=00000000-0000-4000-8000-0000000000a1; NB=00000000-0000-4000-8000-0000000000a2; NC=00000000-0000-4000-8000-0000000000a3
ND=00000000-0000-4000-8000-0000000000a4; NE=00000000-0000-4000-8000-0000000000a5
K880=35261111222333000181550010000008801000000887
KPARECE=35261112ABC34501DE35550010000044111999999993
K15=35261111222333000181550020000000151000000016
K120=35261111222333000181550010000001201000000120
docker exec -i erp-freela-postgres psql -U erpfreela -d "$PGDB" -v ON_ERROR_STOP=1 -q >/dev/null <<'SQL'
insert into sefaz_distribuicao (ambiente, cnpj, busca_ligada, ult_nsu, ultima_consulta_em)
  values ('producao', '12345678000195', false, 5, now() - interval '1 hour');
insert into sefaz_consultas (id, ciclo_id, ambiente, cnpj, origem, ult_nsu_enviado, iniciada_em, terminada_em, resultado, c_stat)
  values ('00000000-0000-4000-8000-0000000000c1', gen_random_uuid(), 'producao', '12345678000195', 'agendada', 0, now() - interval '1 hour', now() - interval '1 hour', 'respondida', 138);
insert into sefaz_documentos (id, ambiente, cnpj, nsu, schema, tipo, chave, xml, consulta_id, processado_em) values
  ('00000000-0000-4000-8000-0000000000d1', 'producao', '12345678000195', 1, 'procNFe_v4.00.xsd', 'procNFe', '35261111222333000181550010000008801000000887',
   $x$<nfeProc><NFe><infNFe Id="NFe35261111222333000181550010000008801000000887"><dest><CNPJ>12345678000195</CNPJ></dest></infNFe></NFe></nfeProc>$x$,
   '00000000-0000-4000-8000-0000000000c1', now()),
  ('00000000-0000-4000-8000-0000000000d2', 'producao', '12345678000195', 2, 'procNFe_v4.00.xsd', 'procNFe', '35261112ABC34501DE35550010000044111999999993',
   $x$<nfeProc><NFe><infNFe Id="NFe35261112ABC34501DE35550010000044111999999993"><dest><CNPJ>12345678000195</CNPJ></dest></infNFe></NFe></nfeProc>$x$,
   '00000000-0000-4000-8000-0000000000c1', now());
insert into notas_sefaz (id, ambiente, cnpj_destinatario, chave, emitente_cnpj, emitente_nome, numero, serie, emitida_em, valor_total, tp_nf, fin_nfe, situacao_sefaz, cancelada_em, documento_completo_id) values
  ('00000000-0000-4000-8000-0000000000a1', 'producao', '12345678000195', '35261111222333000181550010000008801000000887', '11222333000181', 'Frigorífico Smoke', '880', '1', now() - interval '10 days', 123.45, 1, 1, 'autorizada', null, '00000000-0000-4000-8000-0000000000d1'),
  ('00000000-0000-4000-8000-0000000000a2', 'producao', '12345678000195', '35261112ABC34501DE35550010000044111000044116', '12ABC34501DE35', 'Atacadão Smoke', '4411', '1', now() - interval '9 days', 1234.56, 1, 1, 'cancelada', now() - interval '8 days', null),
  ('00000000-0000-4000-8000-0000000000a3', 'producao', '12345678000195', '35261112ABC34501DE35550010000044111999999993', '12ABC34501DE35', 'Atacadão Smoke', '4411', '1', now() - interval '5 days', 1234.56, 1, 1, 'autorizada', null, '00000000-0000-4000-8000-0000000000d2'),
  ('00000000-0000-4000-8000-0000000000a4', 'producao', '12345678000195', '35261111222333000181550020000000151000000016', '11222333000181', 'Frigorífico Smoke', '15', '2', null, null, 1, 1, 'denegada', null, null),
  ('00000000-0000-4000-8000-0000000000a5', 'producao', '12345678000195', '35261111222333000181550010000001201000000120', '11222333000181', 'Frigorífico Smoke', '120', '1', now() - interval '11 days', 50, 0, 1, 'autorizada', null, null);
SQL
check "semeadura da caixa" 5 "$(sql "select count(*) from notas_sefaz")"

req GET $SZ/situacao "$ADM"
check "caixa: contagem falta lançar" 2 "$(j .contagem.falta_lancar)"; check "caixa: contagem parece lançada" 1 "$(j .contagem.parece_lancada)"
check "caixa: contagem cancelada depois de lançada" 1 "$(j .contagem.cancelada_depois_de_lancada)"
check "caixa: nota cancelada depois de lançada" 4411 "$(j '.canceladas_depois[0].numero')"
check "situação: ainda desligada" false "$(j .busca_ligada)"
check "situação: notas novas desde a última consulta" 5 "$(j '.ultima_consulta.novas')"
req GET $SZ "$ADM"; check "a conferir: 200" 200 "$CODE"; check "a conferir: 4 linhas" 4 "$(j length)"
check "a conferir: a mais recente é a que parece lançada" "$KPARECE" "$(j '.[0].chave')"
req GET "$SZ?filtro=todas" "$ADM"; check "todas: 5 linhas" 5 "$(j length)"
check "todas: sem emissão no fim" "$K15" "$(j '.[4].chave')"
req GET "$SZ?filtro=abc" "$ADM"; check "filtro inválido: 400" 400 "$CODE"
req GET "$SZ?filtro=todas&limite=2" "$ADM"; check "limite 2" 2 "$(j length)"
req GET "$SZ?filtro=todas&limite=9999" "$ADM"; check "limite acima do teto não dá erro" 5 "$(j length)"
req GET "$SZ?filtro=todas" "$ADM"
LINHA() { echo "$BODY" | jq -r --arg c "$1" ".[] | select(.chave==\$c) | $2"; }
check "(a) falta lançar" falta_lancar "$(LINHA $K880 .situacao)"; check "(a) pode conferir" true "$(LINHA $K880 .pode_conferir)"
check "(a) valor" 123.45 "$(LINHA $K880 .valor_total)"
check "(e) não parece compra" true "$(LINHA $K120 .nao_parece_compra)"; check "(e) sem XML não confere" false "$(LINHA $K120 .pode_conferir)"
check "(c) parece lançada" parece_lancada "$(LINHA $KPARECE .situacao)"; check "(c) duas parecidas" 2 "$(LINHA $KPARECE '.parecidas | length')"
check "(c) a mais nova é a repetida confirmada" 000.004.411 "$(LINHA $KPARECE '.parecidas[0].numero')"
check "(c) a outra é a do vetor" 4411 "$(LINHA $KPARECE '.parecidas[1].numero')"
check "(b) cancelada depois de lançada" cancelada_depois_de_lancada "$(LINHA $VETOR .situacao)"
check "(b) lançada pela chave" xml "$(LINHA $VETOR .lancada.origem)"
check "(d) denegada" denegada "$(LINHA $K15 .situacao)"

# XML: só o de uma nota liberada
curl -s -o "$OUT" -D "$OUT.h" "$BASE$SZ/$NA/xml" -H "authorization: Bearer $ADM"; BODY=$(cat "$OUT")
check "XML de (a): 200" "HTTP/1.1 200 OK" "$(head -1 "$OUT.h" | tr -d '\r')"
check "XML de (a): content-type" text/xml "$(grep -i '^content-type:' "$OUT.h" | tr -d '\r' | cut -d' ' -f2 | cut -c1-8)"
check "XML de (a): corpo" 1 "$(echo "$BODY" | grep -c "$K880")"
rm -f "$OUT.h"
req GET "$SZ/$NB/xml" "$ADM"; check "XML de (b) cancelada: 409" 409 "$CODE"; check "XML de (b): code" SEFAZ_CANCELADA "$(j .error.code)"
req GET "$SZ/$ND/xml" "$ADM"; check "XML de (d) sem XML: 404" 404 "$CODE"; check "XML de (d): code" SEFAZ_SEM_XML "$(j .error.code)"
req GET "$SZ/$ZERO/xml" "$ADM"; check "XML de id inexistente: 404" 404 "$CODE"
req GET "$SZ/nao-e-uuid/xml" "$ADM"; check "XML de id malformado: 404" 404 "$CODE"

# Dar entrada pela SEFAZ
nota_sefaz() { # $1=chave $2=número $3=série $4=confirmar (opcional)
  jq -nc --arg ch "$1" --arg n "$2" --arg s "$3" --arg c "${4:-}" --arg d "$HOJE" \
    '{chave:$ch,numero:$n,serie:$s,fornecedor_nome:"Atacadão Smoke",fornecedor_cnpj:"12ABC34501DE35",data_entrada:$d,valor_total:10,forma_pagamento:"pix",origem:"sefaz",atualizar_preco:false,itens:[{descricao:"ITEM SEFAZ",unidade:"UN",quantidade:1,valor_unitario:10}],parcelas:[]} + (if $c=="" then {} else {confirmar_repetida:true} end)'
}
req POST /v1/notas "$ADM" "$(jq -nc --arg d "$HOJE" '{chave:"35261111222333000181550010000008801000000887",numero:"880",serie:"1",fornecedor_nome:"Frigorífico Smoke",fornecedor_cnpj:"11222333000181",data_entrada:$d,valor_total:10,forma_pagamento:"pix",origem:"sefaz",atualizar_preco:false,itens:[{descricao:"ITEM SEFAZ",unidade:"UN",quantidade:1,valor_unitario:10}],parcelas:[]}')"
check "dar entrada pela SEFAZ: 201" 201 "$CODE"
req GET "$SZ?filtro=todas" "$ADM"
check "(a) já lançada" ja_lancada "$(LINHA $K880 .situacao)"; check "(a) lançada pela SEFAZ" sefaz "$(LINHA $K880 .lancada.origem)"
req POST /v1/notas "$ADM" "$(nota_sefaz $KPARECE 4411 1)"; check "repetida pela SEFAZ: 409" 409 "$CODE"; check "repetida pela SEFAZ: code" NOTA_REPETIDA "$(j .error.code)"
req POST /v1/notas "$ADM" "$(nota_sefaz $KPARECE 4411 1 true)"; check "repetida pela SEFAZ confirmada: 201" 201 "$CODE"
req GET "$SZ?filtro=todas" "$ADM"; check "(c) já lançada" ja_lancada "$(LINHA $KPARECE .situacao)"
# o servidor confere (não só a tela): nota cancelada, sem XML e fora da caixa não entram por origem sefaz
req POST /v1/notas "$ADM" "$(nota_sefaz $VETOR 4411 1)"; check "origem sefaz de nota já lançada: 409" 409 "$CODE"
req POST /v1/notas "$ADM" "$(nota_sefaz $K15 15 2)"; check "origem sefaz de nota denegada: 409" 409 "$CODE"
check "origem sefaz de nota denegada: code" SEFAZ_NAO_CONFERIVEL "$(j .error.code)"
req POST /v1/notas "$ADM" "$(nota_sefaz 35261111222333000181550010000000771000000071 77 1)"; check "origem sefaz de nota fora da caixa: 409" 409 "$CODE"

# Ignorar e reabrir (e)
req POST "$SZ/$NE/ignorar" "$ADM" '{}'; check "ignorar sem motivo: 400" 400 "$CODE"
req POST "$SZ/$NE/ignorar" "$ADM" '{"motivo":"xyz"}'; check "ignorar com motivo fora da lista: 400" 400 "$CODE"
req POST "$SZ/$NE/ignorar" "$ADM" '{"motivo":"outro"}'; check "ignorar 'outro' sem texto: 400" 400 "$CODE"
check "ignorar 'outro' sem texto: frase" "Escreva o motivo." "$(j .error.message)"
req POST "$SZ/$NE/ignorar" "$ADM" '{"motivo":"outro","texto":"   "}'; check "ignorar 'outro' com espaços: 400" 400 "$CODE"
check "nada gravado nas recusas" 0 "$(sql "select count(*) from notas_sefaz where ignorada_em is not null")"
req POST "$SZ/$NE/ignorar" "$ADM" '{"motivo":"nao_e_compra"}'; check "ignorar (e): 200" 200 "$CODE"; check "(e) ignorada" ignorada "$(j .situacao)"
check "(e) ignorada: quem" "Admin Demo" "$(j .ignorada.por_nome)"
req GET "$SZ" "$ADM"; check "(e) sai de a conferir" 0 "$(echo "$BODY" | jq --arg c "$K120" '[.[] | select(.chave==$c)] | length')"
req POST "$SZ/$NE/reabrir" "$ADM"; check "reabrir (e): 200" 200 "$CODE"; check "(e) volta a falta lançar" falta_lancar "$(j .situacao)"
check "reabrir limpa as colunas" 0 "$(sql "select count(*) from notas_sefaz where ignorada_em is not null or ignorada_por is not null or ignorada_por_nome is not null or motivo_ignorar is not null or motivo_texto is not null")"
req POST "$SZ/$ZERO/ignorar" "$ADM" '{"motivo":"nao_e_compra"}'; check "ignorar id inexistente: 404" 404 "$CODE"
req POST "$SZ/nao-e-uuid/ignorar" "$ADM" '{"motivo":"nao_e_compra"}'; check "ignorar id malformado: 404" 404 "$CODE"
req POST "$SZ/$ZERO/reabrir" "$ADM"; check "reabrir id inexistente: 404" 404 "$CODE"
req POST "$SZ/nao-e-uuid/reabrir" "$ADM"; check "reabrir id malformado: 404" 404 "$CODE"

# cancelada depois de lançada (b): Ignorar comum não esconde; "Ciente" (cancelamento_conferido) esconde
req POST "$SZ/$NB/ignorar" "$ADM" '{"motivo":"nao_e_compra"}'; check "ignorar (b) comum: 200" 200 "$CODE"
check "(b) segue cancelada depois de lançada" cancelada_depois_de_lancada "$(j .situacao)"
req POST "$SZ/$NB/ignorar" "$ADM" '{"motivo":"cancelamento_conferido"}'; check "(b) Ciente: 200" 200 "$CODE"; check "(b) ignorada" ignorada "$(j .situacao)"
req GET $SZ/situacao "$ADM"; check "faixa some depois do Ciente" 0 "$(j .contagem.cancelada_depois_de_lancada)"

# ---------- respostas à SEFAZ (sem rede: a API tem SEFAZ_MANIFESTACAO=ligada, mas as respostas semeadas estão DESLIGADAS e o certificado
# foi removido; a única tentativa de ligar dá 503). Dois eventos semeados na nota (c), que já foi lançada: ciência registrada e a
# confirmação do "Dar entrada" na fila (o tique para em "não ligadas" antes de qualquer rede).
trava_sefaz "antes do bloco das respostas"
EV1=00000000-0000-4000-8000-0000000000e1; EV2=00000000-0000-4000-8000-0000000000e2
docker exec -i erp-freela-postgres psql -U erpfreela -d "$PGDB" -v ON_ERROR_STOP=1 -q >/dev/null <<'SQL'
insert into sefaz_manifestacao (ambiente, cnpj, ligada) values ('producao', '12345678000195', false);
insert into sefaz_manifestacoes (id, nota_sefaz_id, ambiente, cnpj, chave, tp_evento, origem, pedida_em, enviar_apos, situacao, tentativas, c_stat, n_prot) values
  ('00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000a3', 'producao', '12345678000195', '35261112ABC34501DE35550010000044111999999993',
   '210210', 'ciencia_automatica', now() - interval '4 days', now() - interval '4 days', 'registrada', 1, 135, '135260000000001'),
  ('00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000a3', 'producao', '12345678000195', '35261112ABC34501DE35550010000044111999999993',
   '210200', 'dar_entrada', now(), now(), 'na_fila', 0, null, null);
SQL
check "semeadura das respostas" 2 "$(sql "select count(*) from sefaz_manifestacoes")"
req GET $SZ/situacao "$ADM"
check "respostas: disponíveis no servidor" true "$(j .respostas.disponivel)"; check "respostas: desligadas" false "$(j .respostas.ligadas)"
check "respostas: 1 na fila" 1 "$(j .respostas.na_fila)"; check "respostas: nenhuma falhou" 0 "$(j .respostas.falharam)"
req GET "$SZ?filtro=todas" "$ADM"
check "(c) ciência registrada" registrada "$(LINHA $KPARECE .resposta.ciencia.estado)"
check "(c) ciência: protocolo" 135260000000001 "$(LINHA $KPARECE .resposta.ciencia.protocolo)"
check "(c) confirmação na fila" "confirmacao na_fila dar_entrada" "$(LINHA $KPARECE '[.resposta.final.tipo, .resposta.final.estado, .resposta.final.origem] | join(" ")')"
check "(c) já respondida" false "$(LINHA $KPARECE .resposta.pode_responder)"
check "(a) sem resposta" null "$(LINHA $K880 .resposta.ciencia)"; check "(a) prazo em ISO" true "$(LINHA $K880 '.resposta.prazo_final | test("^[0-9]{4}-[0-9]{2}-[0-9]{2}T")')"
req POST "$SZ/$NA/ignorar" "$ADM" '{"motivo":"nao_reconheco","avisar_sefaz":true}'; check "ignorar avisando com as respostas desligadas: 409" 409 "$CODE"
check "ignorar avisando: code" SEFAZ_RESPOSTAS_NAO_LIGADAS "$(j .error.code)"
check "ignorar avisando: frase" "As respostas à SEFAZ estão desligadas. Ligue em Configurações → Notas da SEFAZ." "$(j .error.message)"
req POST "$SZ/$NA/ignorar" "$ADM" '{"motivo":"nao_reconheco","avisar_sefaz":"sim"}'; check "avisar_sefaz que não é booleano: 400" 400 "$CODE"
req POST "$SZ/$NA/ignorar" "$ADM" '{"motivo":"compra_nao_aconteceu","texto":"Pedido cancelado pelo fornecedor"}'
check "a compra não aconteceu sem avisar: 400" 400 "$CODE"; check "a compra não aconteceu sem avisar: frase" "Este motivo sempre avisa a SEFAZ." "$(j .error.message)"
check "nada ignorado nas recusas das respostas" 0 "$(sql "select count(*) from notas_sefaz where id = '$NA' and ignorada_em is not null")"
req POST "$SZ/$NC/responder-de-novo" "$ADM"; check "tentar de novo sem falha: 409" 409 "$CODE"; check "tentar de novo: code" SEFAZ_NADA_A_REENVIAR "$(j .error.code)"
req POST "$SZ/$ZERO/responder-de-novo" "$ADM"; check "tentar de novo id inexistente: 404" 404 "$CODE"
req POST "$SZ/nao-e-uuid/responder-de-novo" "$ADM"; check "tentar de novo id malformado: 404" 404 "$CODE"
req PUT $SZ/respostas "$ADM" '{"ligadas":"sim"}'; check "ligar as respostas com valor que não é booleano: 400" 400 "$CODE"
req PUT $SZ/respostas "$ADM" '{}'; check "ligar as respostas sem o campo: 400" 400 "$CODE"
req PUT $SZ/respostas "$ADM" '{"ligadas":false}'; check "desligar as respostas: 200" 200 "$CODE"; check "desligar: segue desligada" false "$(j .respostas.ligadas)"
check "desligar: histórico respostas_desligadas" 1 "$(sql "select count(*) from sefaz_distribuicao_historico where evento = 'respostas_desligadas'")"
check "desligar: o histórico da busca não mostra as respostas" 0 "$(j '.historico | length')"
trava_sefaz "antes do PUT de ligar as respostas"
req PUT $SZ/respostas "$ADM" '{"ligadas":true}'; check "ligar as respostas sem certificado: 503" 503 "$CODE"
[ "$CODE" == 503 ] || { echo "TRAVA DO SMOKE: ligar as respostas sem certificado não deu 503 (veio $CODE); smoke interrompido."; exit 1; }
trava_sefaz "depois do PUT de ligar as respostas"
check "ligar as respostas sem certificado: code" CERTIFICADO_NAO_CADASTRADO "$(j .error.code)"
check "ligar as respostas sem certificado: nada ligado" 0 "$(sql "select count(*) from sefaz_manifestacao where ligada")"
# o banco recusa evento fora do padrão e uma 2ª resposta final ativa
EVSQL="insert into sefaz_manifestacoes (nota_sefaz_id, ambiente, cnpj, chave, origem, enviar_apos, tp_evento"
sql "$EVSQL) values ('$NC','producao','12345678000195','$KPARECE','admin',now(),'110111')" >/dev/null 2>&1; check "banco: tp_evento 110111" 1 "$?"
sql "$EVSQL, x_just) values ('$NA','producao','12345678000195','$K880','admin',now(),'210200','Pedido cancelado pelo fornecedor')" >/dev/null 2>&1; check "banco: 210200 com x_just" 1 "$?"
sql "$EVSQL, n_prot) values ('$NA','producao','12345678000195','$K880','admin',now(),'210220','1352600000000011')" >/dev/null 2>&1; check "banco: n_prot de 16 dígitos" 1 "$?"
sql "$EVSQL) values ('$NC','producao','12345678000195','$KPARECE','admin',now(),'210220')" >/dev/null 2>&1; check "banco: 2ª resposta final ativa" 1 "$?"

# o banco recusa o que a regra proíbe
sql "insert into sefaz_documentos (ambiente, cnpj, nsu, schema, tipo, consulta_id) values ('producao','12345678000195',1,'x','outro','$CONS')" >/dev/null 2>&1; check "banco: NSU repetido" 1 "$?"
sql "insert into notas_sefaz (ambiente, cnpj_destinatario, chave, emitente_cnpj, numero, serie, situacao_sefaz) values ('producao','12345678000195','ABC','11222333000181','1','1','autorizada')" >/dev/null 2>&1; check "banco: chave ABC" 1 "$?"
sql "update notas_sefaz set ignorada_em = now() where id = '$NE'" >/dev/null 2>&1; check "banco: ignorada sem motivo" 1 "$?"
sql "update notas_sefaz set ignorada_em = now(), motivo_ignorar = 'outro' where id = '$NE'" >/dev/null 2>&1; check "banco: 'outro' sem texto" 1 "$?"
sql "insert into sefaz_distribuicao (ambiente, cnpj) values ('teste','12345678000195')" >/dev/null 2>&1; check "banco: ambiente 'teste'" 1 "$?"

# último check: nenhuma consulta nova, a busca continuou desligada, nenhum lote de respostas e só os 2 eventos semeados, nenhum
# `enviando` (nada saiu para a SEFAZ)
check "SEFAZ: só a consulta semeada" 0 "$(sql "select count(*) from sefaz_consultas where id <> '$CONS'")"
check "SEFAZ: nenhuma busca ligada" 0 "$(sql "select count(*) from sefaz_distribuicao where busca_ligada")"
check "SEFAZ: respostas desligadas" 0 "$(sql "select count(*) from sefaz_manifestacao where ligada")"
check "SEFAZ: nenhum lote de respostas" 0 "$(sql "select count(*) from sefaz_eventos_lotes")"
check "SEFAZ: só os 2 eventos semeados" 2 "$(sql "select count(*) from sefaz_manifestacoes")"
check "SEFAZ: nenhum evento enviando" 0 "$(sql "select count(*) from sefaz_manifestacoes where situacao = 'enviando'")"
check "SEFAZ: eventos como semeados" "$EV1 registrada|$EV2 na_fila" "$(sql "select string_agg(id || ' ' || situacao, '|' order by id) from sefaz_manifestacoes")"

# ---------- cupom fiscal (NFC-e). A API do smoke roda com NFCE_AMBIENTE=homologacao, SEM certificado e com a porta de VERDADE da SEFAZ
# (a porta falsa é só do scripts/nfce-banco.ts, que já roda antes: emitir → autorizado → venda lançada uma vez, cancelar → venda desfeita
# uma vez, 409 NFCE_TOTAL_MUDOU, 422 NFCE_ITEM_INDISPONIVEL e 503 sem certificado sem reservar número). Por isso, aqui a emissão NUNCA liga
# (nem por SQL) e nenhuma rota que fala com a SEFAZ é chamada como admin (testar-conexao, reenviar, consultar, cancelar): só o cadastro, a
# leitura de um cupom autorizado semeado por SQL e as recusas que vêm antes de qualquer rede. A barreira smoke-sem-rede.cjs segue valendo.
CF=/v1/cupom-fiscal
CSC=CSCTESTE0123456789ABCDEF
# Trava: certificado guardado, emissão ligada ou qualquer envio à SEFAZ = o smoke PARA aqui (exit 1), antes de seguir.
trava_nfce() { # trava_nfce MOMENTO
  local certs ligadas envios
  certs=$(sql "select count(*) from certificado_digital") || certs=erro
  ligadas=$(sql "select count(*) from nfce_ambientes where emissao_ligada") || ligadas=erro
  envios=$(sql "select count(*) from nfce_envios") || envios=erro
  if [ "$certs" != 0 ] || [ "$ligadas" != 0 ] || [ "$envios" != 0 ]; then
    echo "TRAVA DO SMOKE ($1): certificado_digital=$certs, emissões ligadas=$ligadas, envios=$envios. Nada disso deve existir aqui; smoke interrompido."
    exit 1
  fi
}
trava_nfce "antes do bloco do cupom fiscal"
# a loja não alcança nenhuma rota do cupom (o guarda vem antes do corpo e do id: nada roda)
for r in "GET $CF/situacao" "GET $CF/emitente" "PUT $CF/emitente" "GET $CF/ambientes/homologacao" "PUT $CF/ambientes/homologacao" \
  "PUT $CF/ambientes/homologacao/emissao" "POST $CF/testar-conexao" "GET $CF/vendas-no-periodo?ini=$HOJE&fim=$HOJE" \
  "GET $CF/xml-do-mes?mes=2026-11" "GET $CF/cupons" "POST $CF/cupons" "GET $CF/cupons/$ZERO" "GET $CF/cupons/$ZERO/danfe" \
  "GET $CF/cupons/$ZERO/xml" "POST $CF/cupons/$ZERO/reenviar" "POST $CF/cupons/$ZERO/consultar" "POST $CF/cupons/$ZERO/cancelar" \
  "POST $CF/cupons/$ZERO/descartar" "POST $CF/cupons/$ZERO/lancar-venda" "GET $CF/perfis" "POST $CF/perfis" "PATCH $CF/perfis/$ZERO" \
  "GET $CF/produtos" "PUT $CF/produtos/perfil" "PUT $CF/produtos/$ZERO"; do
  req "${r%% *}" "${r#* }" "$LOJA"; check "loja barrada em $r" 403 "$CODE"
done
req GET $CF/situacao; check "cupom fiscal sem token" 401 "$CODE"
trava_nfce "depois da loja"

# cadastro: empresa → numeração e CSC do modo de teste (o CSC só entra) → perfil → produto → a busca dos prontos
ESPETO=$(sql "select id from itens_cardapio where nome='Smoke Espeto'")
PICANHA=$(sql "select id from itens_cardapio where nome='Espeto de Picanha'")
req PUT $CF/emitente "$ADM" '{"ie":"123456789012","crt":1,"logradouro":"Rua das Flores","numero":"100","bairro":"Centro","cep":"13270000"}'
check "cupom: empresa no cupom: 200" 200 "$CODE"; check "cupom: regime gravado" 1 "$(j .crt)"; check "cupom: IE gravada" 123456789012 "$(j .ie)"
req PUT $CF/ambientes/homologacao "$ADM" "{\"serie\":5,\"proximo_numero\":1,\"id_csc\":1,\"csc\":\"$CSC\"}"
check "cupom: numeração e CSC do modo de teste: 200" 200 "$CODE"; check "cupom: série" 5 "$(j .serie)"
check "cupom: só a dica do CSC volta" CDEF "$(j .csc_dica)"; check "cupom: a resposta não traz o CSC" 0 "$(echo "$BODY" | grep -c "$CSC")"
req GET $CF/ambientes/homologacao "$ADM"; check "cupom: GET do ambiente sem o CSC" 0 "$(echo "$BODY" | grep -c "$CSC")"
check "cupom: GET do ambiente com a dica" CDEF "$(j .csc_dica)"
check "cupom: CSC cifrado no banco" 0 "$(sql "select count(*) from nfce_ambientes where csc_cifrado like '%$CSC%' or csc_cifrado like '%0123456789AB%'")"
req POST $CF/perfis "$ADM" '{"nome":"Smoke Revenda","cfop":"5102","csosn":"102"}'; check "cupom: perfil fiscal: 201" 201 "$CODE"; PERFIL=$(j .id)
req PUT "$CF/produtos/$ESPETO" "$ADM" "{\"ncm\":\"2203.00.00\",\"perfil_fiscal_id\":\"$PERFIL\"}"
check "cupom: dados do produto: 200" 200 "$CODE"; check "cupom: produto pronto" true "$(j .pronto)"; check "cupom: NCM sem a máscara" 22030000 "$(j .ncm)"
req GET "$CF/produtos?prontos=true" "$ADM"; check "cupom: prontos: 200" 200 "$CODE"
check "cupom: prontos traz o produto" 1 "$(echo "$BODY" | jq --arg id "$ESPETO" '[.[] | select(.item_cardapio_id==$id)] | length')"
check "cupom: prontos: preço em centavos" 1200 "$(echo "$BODY" | jq --arg id "$ESPETO" '.[] | select(.item_cardapio_id==$id) | .preco_venda_centavos')"
check "cupom: prontos: só os prontos" true "$(echo "$BODY" | jq 'length > 0 and all(.[]; .pronto)')"
req GET "$CF/produtos?prontos=false" "$ADM"; check "cupom: faltando não traz o pronto" 0 "$(echo "$BODY" | jq --arg id "$ESPETO" '[.[] | select(.item_cardapio_id==$id)] | length')"
req GET "$CF/produtos?prontos=talvez" "$ADM"; check "cupom: filtro de prontos inválido: 400" 400 "$CODE"

# ligar sem certificado: recusa antes de qualquer rede (o certificado é o único item que falta) e nada liga
req GET $CF/situacao "$ADM"; check "cupom: situação: modo de teste" homologacao "$(j .ambiente)"; check "cupom: situação: desligada" false "$(j .emissao_ligada)"
check "cupom: situação: só falta o certificado" '["certificado"]' "$(echo "$BODY" | jq -c '[.falta[].codigo]')"
trava_nfce "antes do PUT de ligar a emissão"
req PUT $CF/ambientes/homologacao/emissao "$ADM" '{"ligada":true}'
case "$CODE" in 2*) echo "TRAVA DO SMOKE: ligar a emissão sem certificado deu $CODE; smoke interrompido."; exit 1 ;; esac
trava_nfce "depois do PUT de ligar a emissão"
check "cupom: ligar sem certificado: 422" 422 "$CODE"; check "cupom: ligar sem certificado: code" NFCE_CONFIG_INCOMPLETA "$(j .error.code)"
check "cupom: ligar sem certificado: frase" "Falta configurar o cupom fiscal: certificado digital válido, do mesmo CNPJ da empresa." "$(j .error.message)"
req PUT $CF/ambientes/producao/emissao "$ADM" '{"ligada":true,"confirmado":true}'; check "cupom: ligar o ambiente que não é o do servidor: 404" 404 "$CODE"
trava_nfce "depois do PUT do outro ambiente"
req PUT $CF/ambientes/homologacao/emissao "$ADM" '{"ligada":"sim"}'; check "cupom: ligar com valor que não é booleano: 400" 400 "$CODE"

# emitir com a emissão desligada: 409 antes de qualquer rede; corpo fora do DTO = 400; nada é gravado
emitir_corpo() { # $1=quantidade
  jq -nc --arg id "$ESPETO" --arg k "$(cat /proc/sys/kernel/random/uuid)" --arg q "$1" \
    '{chave_idempotencia:$k,itens:[{item_cardapio_id:$id,quantidade:$q}],pagamentos:[{t_pag:"01",valor_centavos:1200}],total_esperado_centavos:1200}'
}
req POST $CF/cupons "$ADM" "$(emitir_corpo 1)"; check "cupom: emitir desligado: 409" 409 "$CODE"
check "cupom: emitir desligado: code" NFCE_EMISSAO_DESLIGADA "$(j .error.code)"
req POST $CF/cupons "$ADM" "$(emitir_corpo '0,350')"; check "cupom: quantidade com vírgula: 400" 400 "$CODE"
# a frase literal no fio, sem o caminho do campo na frente ("itens.0.quantidade: …"; leva pré-final, item 8: quem responde é o serviço)
check "cupom: quantidade com vírgula: frase" "Quantidade com até 4 casas, ponto como separador e maior que zero." "$(j .error.message)"
req POST $CF/cupons "$ADM" "$(emitir_corpo 1 | jq -c '. + {entrega:true}')"; check "cupom: campo a mais no corpo: 400" 400 "$CODE"
check "cupom: emitir desligado: nenhum cupom gravado" 0 "$(sql "select count(*) from nfce_cupons")"
trava_nfce "depois do emitir"

# um cupom AUTORIZADO semeado por SQL (valendo, para a venda entrar no estoque): o nfeProc é a NFC-e fictícia dos testes
# (cupom-fiscal/__tests__/fixtures) + o protNFe fictício da autorização (sefaz/__tests__/fixtures/nfce), com tpAmb 1
CUP=00000000-0000-4000-8000-0000000000f1
CH=35261112345678000195650010000000121402133776
FXN=src/modules/cupom-fiscal/__tests__/fixtures/nfe-homologacao-simples.xml
FXP=src/modules/sefaz/__tests__/fixtures/nfce/ret-autorizacao-100.xml
NFEPROC="<nfeProc xmlns=\"http://www.portalfiscal.inf.br/nfe\" versao=\"4.00\">$(cat "$FXN")$(sed -n '/<protNFe/,/<\/protNFe>/p' "$FXP")</nfeProc>"
NFEPROC=${NFEPROC//<tpAmb>2<\/tpAmb>/<tpAmb>1<\/tpAmb>}
sql "insert into vendas (pedido, data, produto_relatorio, quantidade) values ('SMOKE-VELHA', '2026-11-17', 'SMOKE ESPETO', 1)" >/dev/null
docker exec -i erp-freela-postgres psql -U erpfreela -d "$PGDB" -v ON_ERROR_STOP=1 -q -v cup="$CUP" -v ch="$CH" -v espeto="$ESPETO" \
  -v picanha="$PICANHA" -v xml="$NFEPROC" >/dev/null <<'SQL'
insert into nfce_cupons (id, ambiente, serie, numero, chave, c_nf, dh_emi, situacao, envios, chave_idempotencia, pedido_hash, lanca_venda,
                         consumidor_doc, valor_produtos, valor_desconto, valor_total, valor_troco, emitido_por_nome)
  values (:'cup', 'producao', 1, 12, :'ch', '40213377', '2026-11-17T14:30:00-03:00', 'enviando', 1, gen_random_uuid(), repeat('ab', 32),
          true, '52998224725', 33.90, 1.90, 32.00, 10.00, 'Smoke');
insert into nfce_cupom_itens (cupom_id, n_item, item_cardapio_id, nome_cardapio, c_prod, x_prod, ncm, origem, unidade, cfop, csosn,
                              perfil_nome, quantidade, valor_unitario, valor_bruto, valor_desconto) values
  (:'cup', 1, :'espeto', 'Smoke Espeto', 'PRATO-01', 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL', '21069090', 0,
   'UN', '5102', '102', 'Smoke Revenda', 2, 12.00, 24.00, 1.35),
  (:'cup', 2, :'picanha', 'Espeto de Picanha', 'CHOPP-300', 'Chopp & "Lager" <300> ml', '22030000', 0, 'UN', '5405', '500',
   'Smoke Revenda', 1, 9.90, 9.90, 0.55);
insert into nfce_cupom_pagamentos (cupom_id, ordem, t_pag, valor, tp_integra) values (:'cup', 1, '01', 30.00, null), (:'cup', 2, '03', 12.00, 2);
update nfce_cupons set situacao = 'autorizado', autorizada_em = '2026-11-17T14:30:02-03:00', c_stat = 100, x_motivo = 'Autorizado o uso da NF-e',
       n_prot = '13526000000012345', dig_val = 'q2bBTSHNkQhO2Vb5w8Cqv6eVZaE=', xml_autorizado = :'xml' where id = :'cup';
select nfce_lancar_venda(:'cup');
SQL
check "cupom semeado: autorizado" autorizado "$(sql "select situacao from nfce_cupons where id='$CUP'")"
check "cupom semeado: a venda entrou (uma por item)" 2 "$(sql "select count(*) from vendas where nfce_cupom_id='$CUP'")"
req GET "$CF/cupons?ambiente=producao" "$ADM"; check "cupom: lista valendo: 1" 1 "$(j length)"
check "cupom: lista: CPF mascarado" "***.982.247-**" "$(j '.[0].consumidor_doc')"; check "cupom: lista: total em centavos" 3200 "$(j '.[0].valor_total_centavos')"
check "cupom: lista: sem itens nem XML" false "$(echo "$BODY" | jq '.[0] | has("itens") or has("xml_autorizado")')"
req GET "$CF/cupons" "$ADM"; check "cupom: lista sem ambiente = a do servidor (modo de teste): vazia" 0 "$(j length)"
req GET "$CF/cupons?ambiente=producao&situacao=xyz" "$ADM"; check "cupom: lista com filtro inválido: 400" 400 "$CODE"
req GET "$CF/cupons/$CUP" "$ADM"; check "cupom: GET do cupom: 200" 200 "$CODE"
check "cupom: GET: autorizado, nº 12, R$ 32,00, 2 itens" "autorizado 12 3200 2" "$(j '[.situacao, .numero, .valor_total_centavos, (.itens | length)] | join(" ")')"
check "cupom: GET: a venda no estoque" lancada "$(j .venda_estoque)"; check "cupom: GET: sem o XML" false "$(echo "$BODY" | jq 'has("xml_autorizado")')"
req GET "$CF/cupons/$ZERO" "$ADM"; check "cupom inexistente: 404" 404 "$CODE"
req GET "$CF/cupons/nao-e-uuid" "$ADM"; check "cupom com id malformado: 404" 404 "$CODE"
req GET "$CF/cupons/$CUP/danfe" "$ADM"; check "DANFE: 200" 200 "$CODE"
check "DANFE: chave, número, série e valor a pagar" "$CH 12 1 32.00" "$(j '[.chave, .ide.nNF, .ide.serie, .total.vNF] | join(" ")')"
check "DANFE: 2 itens, o nome com & e < legível" 'Chopp & "Lager" <300> ml' "$(j '.det[1].xProd')"
check "DANFE: valendo, protocolo e pagamentos" "false 13526000000012345 2 10.00" "$(j '[.homologacao, .nProt, (.pag.detPag | length), .pag.vTroco] | map(tostring) | join(" ")')"
req GET "$CF/cupons/$ZERO/danfe" "$ADM"; check "DANFE de cupom inexistente: 404" 404 "$CODE"

# XML e zip do mês pelo HTTP de verdade: cabeçalhos depois das checagens; os erros seguem em JSON
baixar() { # baixar CAMINHO → $CODE, $CT (content-type), $CD (content-disposition), arquivo em "$OUT"
  CODE=$(curl -s -o "$OUT" -D "$OUT.h" -w '%{http_code}' -H "authorization: Bearer $ADM" "$BASE$1")
  CT=$(grep -i '^content-type:' "$OUT.h" | tr -d '\r' | cut -d' ' -f2-); CD=$(grep -i '^content-disposition:' "$OUT.h" | tr -d '\r' | cut -d' ' -f2-)
  BODY=$(head -c 2000 "$OUT" | tr -d '\0')
}
# o nfeProc que foi gravado, em arquivo: a comparação é byte a byte (`cmp`), sem o `$(…)` que comeria as quebras de linha do fim
printf '%s' "$NFEPROC" > "$OUT.nfeproc"
baixar "$CF/cupons/$CUP/xml"; check "XML do cupom: 200" 200 "$CODE"; check "XML do cupom: content-type" "text/xml; charset=utf-8" "$CT"
check "XML do cupom: nome do arquivo" 'attachment; filename="cupom-1-12.xml"' "$CD"
check "XML do cupom: o nfeProc guardado, byte a byte (cmp)" 0 "$(cmp -s "$OUT" "$OUT.nfeproc"; echo $?)"
baixar "$CF/cupons/$CUP/xml?tipo=abc"; check "XML com tipo inválido: 400" 400 "$CODE"; check "XML com tipo inválido: JSON" application/json "${CT%%;*}"
baixar "$CF/cupons/$CUP/xml?tipo=cancelamento"
check "XML do cancelamento de um autorizado: 409 NFCE_SITUACAO em JSON" "409 application/json NFCE_SITUACAO" "$CODE ${CT%%;*} $(j .error.code)"
baixar "$CF/cupons/$ZERO/xml"; check "XML de cupom inexistente: 404 em JSON" "404 application/json" "$CODE ${CT%%;*}"
baixar "$CF/xml-do-mes?mes=2026-11&ambiente=producao"; check "zip do mês: 200" 200 "$CODE"; check "zip do mês: content-type" application/zip "$CT"
check "zip do mês: nome do arquivo" true "$(echo "$CD" | grep -q '^attachment; filename=".*\.zip"$' && echo true || echo false)"
check "zip do mês: começa com PK\\x03\\x04" 504b0304 "$(head -c 4 "$OUT" | xxd -p)"
cp "$OUT" "$OUT.zip"
check "zip do mês: unzip -t" 0 "$(unzip -tq "$OUT.zip" >/dev/null 2>&1; echo $?)"
check "zip do mês: o cupom e a lista dos números" "NFCe-$CH.xml numeros-nao-usados.csv" "$(unzip -Z1 "$OUT.zip" | sort | tr '\n' ' ' | sed 's/ $//')"
unzip -p "$OUT.zip" "NFCe-$CH.xml" > "$OUT.nfce"
check "zip do mês: o XML do cupom como foi guardado, byte a byte (cmp)" 0 "$(cmp -s "$OUT.nfce" "$OUT.nfeproc"; echo $?)"
check "zip do mês: o CPF não está no csv" 0 "$(unzip -p "$OUT.zip" numeros-nao-usados.csv | grep -c 52998224725)"
rm -f "$OUT.zip" "$OUT.h" "$OUT.nfce" "$OUT.nfeproc"
baixar "$CF/xml-do-mes?mes=2026-13"; check "zip com mês inválido: 400 em JSON" "400 application/json" "$CODE ${CT%%;*}"
baixar "$CF/xml-do-mes?mes=2026-11&ambiente=teste"; check "zip com ambiente inválido: 400 em JSON" "400 application/json" "$CODE ${CT%%;*}"
rm -f "$OUT.h"

# a importação de vendas "Substituir" no dia do cupom apaga a venda importada e mantém a do cupom; o de-para também não a toca
req GET "$CF/vendas-no-periodo?ini=2026-11-17&fim=2026-11-17" "$ADM"; check "cupom: aviso da importação" "1 3200" "$(j '[.quantidade, .valor_centavos] | map(tostring) | join(" ")')"
req POST /v1/importacoes/vendas "$ADM" '{"arquivo":"vendas-17-11.csv","modo":"substituir","linhas":[{"pedido":"SUBST1","data":"2026-11-17","produto_relatorio":"SMOKE ESPETO","quantidade":"1","valor_total":"12"}]}'
check "Substituir no dia do cupom: 201" 201 "$CODE"; check "Substituir: a venda importada do dia saiu" 0 "$(sql "select count(*) from vendas where pedido='SMOKE-VELHA'")"
check "Substituir: a venda do arquivo entrou" 1 "$(sql "select count(*) from vendas where pedido='SUBST1'")"
check "Substituir: as vendas do cupom ficaram" "2 NFC-e 1-12" "$(sql "select count(*) || ' ' || min(pedido) from vendas where nfce_cupom_id='$CUP'")"
# o nome da venda do cupom no de-para (como se um relatório trouxesse o mesmo nome) e "mapear" para nenhum item: só as importadas mudam
sql "insert into de_para_produtos (produto_relatorio, item_cardapio_id) values ('Smoke Espeto', '$ESPETO')" >/dev/null
req PUT /v1/de-para "$ADM" '{"produto_relatorio":"Smoke Espeto","item_cardapio_id":null}'; check "de-para do nome do cupom: 200" 200 "$CODE"
check "de-para não tira o item da venda do cupom" "$ESPETO" "$(sql "select item_cardapio_id from vendas where nfce_cupom_id='$CUP' and produto_relatorio='Smoke Espeto'")"

# último check do cupom: nada saiu para a SEFAZ e nada ligou; só o cupom semeado existe
trava_nfce "no fim do bloco do cupom fiscal"
check "cupom: nenhum envio à SEFAZ" 0 "$(sql "select count(*) from nfce_envios")"
check "cupom: nenhuma emissão ligada" 0 "$(sql "select count(*) from nfce_ambientes where emissao_ligada")"
check "cupom: só o cupom semeado" "$CUP autorizado" "$(sql "select string_agg(id || ' ' || situacao, '|') from nfce_cupons")"
check "cupom: nenhum cupom enviando" 0 "$(sql "select count(*) from nfce_cupons where situacao = 'enviando'")"
if [ -n "${API_LOG:-}" ]; then
  check "cupom: o CSC não aparece no log da API" 0 "$(grep -c "$CSC" "$API_LOG")"
  check "cupom: o CPF do consumidor não aparece no log da API" 0 "$(grep -c 52998224725 "$API_LOG")"
fi
# ---------- importar vendas de outros sistemas (desenho 24/11, Parte A; contrato §20): V1–V7. Nenhuma rede (a IA está sem chave).
IV=/v1/importacoes
SHA_A=$(printf 'a%.0s' $(seq 1 64))
# V6 (parte): a loja não alcança nenhuma rota nova
for r in "GET $IV/origens" "GET $IV/vendas/recentes"; do req ${r% *} "${r#* }" "$LOJA"; check "importar vendas: loja barrada em $r" 403 "$CODE"; done
for r in "POST $IV/origens" "POST $IV/vendas/previa" "POST $IV/vendas/confirmar" "PUT $IV/origens/$ZERO"; do
  req ${r% *} "${r#* }" "$LOJA" '{}'; check "importar vendas: loja barrada em $r" 403 "$CODE"
done
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $LOJA" -F "arquivo=@$PDF;type=application/pdf" "$BASE$IV/vendas/ler-pdf"); check "importar vendas: loja barrada no ler-pdf" 403 "$CODE"
# sistemas de origem
req POST $IV/origens "$ADM" '{"nome":"Smoke PDV","formato_padrao":"planilha"}'; check "origem: 201" 201 "$CODE"; ORIG_A=$(j .id)
req POST $IV/origens "$ADM" '{"nome":"smoke  pdv","formato_padrao":"xml"}'; check "origem: nome repetido sem caixa: 409 ORIGEM_REPETIDA" "409 ORIGEM_REPETIDA" "$CODE $(j .error.code)"
req POST $IV/origens "$ADM" '{"nome":"Smoke iFood","formato_padrao":"planilha","prefixo_pedido":"IF-"}'; ORIG_B=$(j .id)
req POST $IV/origens "$ADM" '{"nome":"Smoke XML","formato_padrao":"xml"}'; ORIG_X=$(j .id)
req PUT "$IV/origens/nao-e-uuid" "$ADM" '{"ativo":false}'; check "origem com id malformado: 404" 404 "$CODE"
req GET $IV/origens "$ADM"; check "origens: as 3 criadas" 3 "$(j '.origens | length')"

# V1: prévia de planilha de outro sistema (data com hora, 1.234,56, linha repetida, linha com problema): nada gravado
PLAN_A="{\"formato\":\"planilha\",\"origem_id\":\"$ORIG_A\",\"arquivo\":\"pdv-setembro.csv\",\"arquivo_sha256\":\"$SHA_A\",\"modo\":\"acrescentar\",\"separador_decimal\":\"virgula\",\"salvar_mapeamento\":true,\"mapeamento\":{\"pedido\":\"Nº\",\"data\":\"Data\",\"produto\":\"Descrição\",\"quantidade\":\"Qtde\",\"valor_total\":\"Total\"},\"linhas_brutas\":[{\"Nº\":\"P1\",\"Data\":\"10/09/2026 19:30\",\"Descrição\":\"SMOKE ESPETO\",\"Qtde\":\"2\",\"Total\":\"1.234,56\"},{\"Nº\":\"P1\",\"Data\":\"10/09/2026\",\"Descrição\":\"SMOKE ESPETO\",\"Qtde\":\"1\",\"Total\":\"10,00\"},{\"Nº\":\"P2\",\"Data\":\"11/09/2026\",\"Descrição\":\"SMOKE CALDO NOVO\",\"Qtde\":\"1\",\"Total\":\"8,50\"},{\"Nº\":\"P3\",\"Data\":\"31/02/2026\",\"Descrição\":\"X\",\"Qtde\":\"1\",\"Total\":\"1\"}]}"
ANTES="$(sql "select (select count(*) from vendas) || ' ' || (select count(*) from importacoes)")"
req POST $IV/vendas/previa "$ADM" "$PLAN_A"; check "V1 prévia: 200" 200 "$CODE"
check "V1 prévia: lidas/válidas/problema/já existentes/somadas/novas" "4 3 1 0 1 2" "$(j '.linhas | [.lidas, .validas, .com_problema, .ja_existentes, .somadas_no_arquivo, .novas] | map(tostring) | join(" ")')"
check "V1 prévia: total em centavos (1.234,56 + 10,00 + 8,50)" 125306 "$(j .valor_centavos)"
check "V1 prévia: período" "2026-09-10 2026-09-11" "$(j '.periodo | .ini + " " + .fim')"
check "V1 prévia: o problema com a linha do arquivo" "5 data inválida (31/02/2026)" "$(j '.problemas[0] | (.linha|tostring) + " " + .motivo')"
check "V1 prévia: produto novo sem de-para" "SMOKE CALDO NOVO" "$(j '[.produtos_sem_de_para[].produto_relatorio] | join(",")')"
check "V1 prévia: nada gravado (vendas e importações iguais)" "$ANTES" "$(sql "select (select count(*) from vendas) || ' ' || (select count(*) from importacoes)")"
req POST $IV/vendas/previa "$ADM" "$(echo "$PLAN_A" | jq -c '.mapeamento = {"data":"Data","produto":"Descrição"}')"
check "V1 prévia: mapeamento incompleto" "400 MAPEAMENTO_INCOMPLETO Escolha a coluna de: quantidade, valor total." "$CODE $(j .error.code) $(j .error.message)"

# V2: confirmar → vendas e baixas; o mesmo corpo de novo → 200 com o resultado guardado, sem venda a mais; outro corpo → 409
CONF_A=$(echo "$PLAN_A" | jq -c '. + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0a1"}')
req POST $IV/vendas/confirmar "$ADM" "$CONF_A"; check "V2 confirmar: 201" 201 "$CODE"
check "V2 confirmar: inseridas, valor, novos produtos, colunas lembradas" "2 125306 1 true" "$(j '[.inseridas, .valor_centavos, .novos_produtos, .mapeamento_salvo] | map(tostring) | join(" ")')"
IMP_A=$(j .importacao_id)
check "V2: as 2 vendas com a importação e o pedido do arquivo" "P1 3 1244.56|P2 1 8.5" "$(sql "select string_agg(pedido || ' ' || quantidade::float || ' ' || valor_total::float, '|' order by pedido) from vendas where importacao_id='$IMP_A'")"
check "V2: a hora da data entrou" "19:30:00" "$(sql "select hora from vendas where importacao_id='$IMP_A' and pedido='P1'")"
check "V2: a baixa pela ficha (SMOKE ESPETO → Smoke Espeto)" t "$(sql "select count(*) > 0 from movimentacoes m join vendas v on v.id = m.venda_id where v.importacao_id='$IMP_A' and v.pedido='P1'")"
DEPOIS=$(sql "select count(*) from vendas")
req POST $IV/vendas/confirmar "$ADM" "$CONF_A"; check "V2 de novo, mesmo corpo: 200 repetida" "200 true" "$CODE $(j .repetida)"
check "V2 de novo: o resultado da 1ª vez" "$IMP_A" "$(j .importacao_id)"
check "V2 de novo: nenhuma venda a mais" "$DEPOIS" "$(sql "select count(*) from vendas")"
req POST $IV/vendas/confirmar "$ADM" "$(echo "$CONF_A" | jq -c '.arquivo = "outro.csv"')"; check "V2 mesma chave, outro corpo: 409" "409 IMPORTACAO_JA_CONFIRMADA" "$CODE $(j .error.code)"
req POST $IV/vendas/previa "$ADM" "$PLAN_A"; check "V2 prévia de novo: já existentes e arquivo já importado" "2 0 true" "$(j '[.linhas.ja_existentes, .linhas.novas, (.arquivo_ja_importado != null)] | map(tostring) | join(" ")')"
req GET $IV/origens "$ADM"; check "V2: colunas lembradas no sistema" "Nº" "$(echo "$BODY" | jq -r --arg o "$ORIG_A" '.origens[] | select(.id == $o) | .mapeamento.pedido')"
req PUT "$IV/origens/$ORIG_A" "$ADM" '{"prefixo_pedido":"X-"}'; check "trocar as letras de sistema com vendas: 409" "409 ORIGEM_PREFIXO_EM_USO" "$CODE $(j .error.code)"
req GET $IV/vendas/recentes "$ADM"; check "recentes: a importação do sistema, com o nome" "Smoke PDV 2" "$(j '.[0] | .origem_nome + " " + (.inseridas|tostring)')"

# V3: em 17/11 já há vendas da planilha padrão (SUBST1) e do cupom do Comanda; outro sistema sem a caixa → 409; com a caixa → 201
PLAN_B="{\"formato\":\"planilha\",\"origem_id\":\"$ORIG_B\",\"arquivo\":\"ifood-17-11.csv\",\"modo\":\"acrescentar\",\"mapeamento\":{\"pedido\":\"pedido\",\"data\":\"data\",\"produto\":\"produto\",\"quantidade\":\"qtd\",\"valor_total\":\"total\"},\"linhas_brutas\":[{\"pedido\":\"1\",\"data\":\"17/11/2026\",\"produto\":\"SMOKE ESPETO\",\"qtd\":\"1\",\"total\":\"15,00\"}]}"
req POST $IV/vendas/previa "$ADM" "$PLAN_B"
check "V3 prévia: sobreposição com a planilha padrão e o cupom" "Cupons do próprio Comanda,Planilha padrão do Comanda" "$(j '[.sobreposicao[].fonte] | sort | join(",")')"
req POST $IV/vendas/confirmar "$ADM" "$(echo "$PLAN_B" | jq -c '. + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0b1"}')"
check "V3 sem a caixa: 409 IMPORTACAO_SOBREPOSICAO" "409 IMPORTACAO_SOBREPOSICAO" "$CODE $(j .error.code)"
req POST $IV/vendas/confirmar "$ADM" "$(echo "$PLAN_B" | jq -c '. + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0b1", confirmar_sobreposicao:true}')"
check "V3 com a caixa: 201, 1 venda com as letras do sistema" "201 1 1" "$CODE $(j .inseridas) $(sql "select count(*) from vendas where pedido='IF-1'")"

# V5: XML (o resumo que o navegador manda, montado aqui): venda, repetida, do próprio Comanda, outro CNPJ, cancelamento depois e antes
LOJA_CNPJ=$(sql "select cnpj from configuracoes where id=1")
chave_dv() { node -e 'const b=process.argv[1];let s=0,p=2;for(let i=b.length-1;i>=0;i--){s+=(b.charCodeAt(i)-48)*p;p=p===9?2:p+1}const r=s%11;process.stdout.write(b+(r<2?0:11-r))' "$1"; }
K501=$(chave_dv "352611${LOJA_CNPJ}65002000000501112345678"); K502=$(chave_dv "352611${LOJA_CNPJ}65002000000502112345678")
K503=$(chave_dv "3526111122233300018165002000000503112345678"); K504=$(chave_dv "352611${LOJA_CNPJ}65002000000504112345678")
doc() { # doc CHAVE CNPJ NUMERO QTD VPROD
  echo "{\"arquivo\":\"NFCe-$3.xml\",\"chave\":\"$1\",\"modelo\":65,\"serie\":2,\"numero\":$3,\"emitente_cnpj\":\"$2\",\"tp_amb\":1,\"dh_emi\":\"2026-11-17T12:00:00-03:00\",\"valor_total\":\"$5\",\"itens\":[{\"produto\":\"SMOKE ESPETO\",\"quantidade\":\"$4\",\"valor_unitario\":\"12.00\",\"valor_bruto\":\"$5\",\"desconto\":\"0\",\"outros\":\"0\",\"frete\":\"0\",\"cfop\":\"5102\"}]}"
}
CUPOM_DOC="{\"arquivo\":\"cupom-comanda.xml\",\"chave\":\"$CH\",\"modelo\":65,\"serie\":1,\"numero\":12,\"emitente_cnpj\":\"12345678000195\",\"tp_amb\":1,\"dh_emi\":\"2026-11-17T14:30:00-03:00\",\"valor_total\":\"32.00\",\"itens\":[{\"produto\":\"Smoke Espeto\",\"quantidade\":\"2\",\"valor_unitario\":\"12.00\",\"valor_bruto\":\"24.00\",\"desconto\":\"1.35\",\"outros\":\"0\",\"frete\":\"0\",\"cfop\":\"5102\"}]}"
xml_corpo() { # xml_corpo '[docs]' '[cancelamentos]' '[ignorados]'
  echo "{\"formato\":\"xml\",\"origem_id\":\"$ORIG_X\",\"arquivo\":\"xml-novembro.zip\",\"modo\":\"acrescentar\",\"arquivos_lidos\":$(( $(echo "$1" | jq length) + $(echo "$2" | jq length) + $(echo "$3" | jq length) )),\"documentos\":$1,\"cancelamentos\":$2,\"ignorados\":$3}"
}
DOCS="[$(doc "$K501" "$LOJA_CNPJ" 501 1 12.00),$(doc "$K502" "$LOJA_CNPJ" 502 2 24.00),$CUPOM_DOC,$(doc "$K503" 11222333000181 503 1 12.00)]"
XML1=$(xml_corpo "$DOCS" '[]' '[{"arquivo":"inut.xml","motivo":"inutilização de numeração"}]')
sql "update configuracoes set cnpj = '' where id = 1" >/dev/null
req POST $IV/vendas/previa "$ADM" "$XML1"; check "V5 sem CNPJ da loja: 400 LOJA_SEM_CNPJ" "400 LOJA_SEM_CNPJ" "$CODE $(j .error.code)"
sql "update configuracoes set cnpj = '$LOJA_CNPJ' where id = 1" >/dev/null
req POST $IV/vendas/previa "$ADM" "$XML1"; check "V5 prévia: 200" 200 "$CODE"
check "V5 prévia: lidos/novos/do Comanda/ignorados" "5 2 1 2" "$(j '.documentos | [.arquivos_lidos, .vendas_novas, .do_proprio_comanda, ([.ignorados[].arquivos | length] | add)] | map(tostring) | join(" ")')"
check "V5 prévia: o outro CNPJ com o motivo" true "$(j '[.documentos.ignorados[].motivo] | any(startswith("emitido por outro CNPJ (11.222.333/0001-81)"))')"
req POST $IV/vendas/confirmar "$ADM" "$(echo "$XML1" | jq -c '. + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0c1", confirmar_sobreposicao:true}')"
check "V5 confirmar: 201, 2 documentos e 2 vendas" "201 2 2" "$CODE $(j .documentos_novos) $(j .inseridas)"
check "V5: as vendas com o pedido do documento e o documento ligado" "NFC-e 2-501|NFC-e 2-502" "$(sql "select string_agg(v.pedido, '|' order by v.pedido) from vendas v join vendas_documentos d on d.id = v.documento_id")"
check "V5: o cupom do próprio Comanda não entrou de novo" "2" "$(sql "select count(*) from vendas where pedido = 'NFC-e 1-12'")"
req POST $IV/vendas/previa "$ADM" "$XML1"; check "V5 a mesma chave de novo: já importados" "2 0" "$(j '.documentos | [.ja_importados, .vendas_novas] | map(tostring) | join(" ")')"
req POST $IV/vendas/confirmar "$ADM" "$(echo "$XML1" | jq -c '. + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0c2", confirmar_sobreposicao:true}')"
check "V5 de novo: nada novo = 400 IMPORTACAO_VAZIA" "400 IMPORTACAO_VAZIA" "$CODE $(j .error.code)"
BAIXAS_502=$(sql "select count(*) from movimentacoes m join vendas v on v.id = m.venda_id where v.pedido = 'NFC-e 2-502'")
check "V5: a venda do 502 deu baixa" t "$( [ "$BAIXAS_502" -gt 0 ] && echo t || echo f)"
CANC="[{\"arquivo\":\"canc-502.xml\",\"chave\":\"$K502\",\"dh_evento\":\"2026-11-18T10:00:00-03:00\"}]"
XML2=$(xml_corpo '[]' "$CANC" '[]')
req POST $IV/vendas/previa "$ADM" "$XML2"; check "V5 cancelamento depois: a prévia diz o que sai" "1 1 2400" "$(j '.documentos.cancelamentos_de_importados | [.documentos, .linhas, .valor_centavos] | map(tostring) | join(" ")')"
MOV0=$(sql "select count(*) from movimentacoes")
req POST $IV/vendas/confirmar "$ADM" "$(echo "$XML2" | jq -c '. + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0c3"}')"
check "V5 cancelamento: 201, 1 documento e 1 linha retirados" "201 1 1" "$CODE $(j .canceladas.documentos) $(j .canceladas.linhas)"
check "V5 cancelamento: a venda saiu e as baixas dela também" "0 $((MOV0 - BAIXAS_502))" "$(sql "select count(*) from vendas where pedido = 'NFC-e 2-502'") $(sql "select count(*) from movimentacoes")"
check "V5 cancelamento: o documento fica, cancelado" cancelada "$(sql "select situacao from vendas_documentos where chave = '$K502'")"
req POST $IV/vendas/confirmar "$ADM" "$(xml_corpo '[]' "[{\"arquivo\":\"canc-504.xml\",\"chave\":\"$K504\",\"dh_evento\":null}]" '[]' | jq -c '. + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0c4"}')"
check "V5 cancelamento antes da venda: registra o documento cancelado" "201 cancelada" "$CODE $(sql "select situacao from vendas_documentos where chave = '$K504'")"
req POST $IV/vendas/previa "$ADM" "$(xml_corpo "[$(doc "$K504" "$LOJA_CNPJ" 504 1 12.00)]" '[]' '[]')"
check "V5 a venda que chega depois do cancelamento é ignorada" "1 0" "$(j '.documentos | [.ja_cancelados, .vendas_novas] | map(tostring) | join(" ")')"
TORTA="${K501:0:43}$(( (${K501:43:1} + 1) % 10 ))"
req POST $IV/vendas/previa "$ADM" "$(xml_corpo "[$(doc "$TORTA" "$LOJA_CNPJ" 501 1 12.00)]" '[]' '[]')"; check "V5 chave com DV errado: 400" "400 VALIDATION_ERROR" "$CODE $(j .error.code)"
check "V5: o banco recusa apagar documento" 1 "$(docker exec erp-freela-postgres psql -U erpfreela -d "$PGDB" -tAc "delete from vendas_documentos where chave = '$K501'" >/dev/null 2>&1; echo $?)"
check "V5: o documento continua lá" 1 "$(sql "select count(*) from vendas_documentos where chave = '$K501'")"

# V4: Substituir do sistema B em 17/11 apaga só as dele; a planilha padrão (SUBST1), o XML (501) e o cupom ficam
req POST $IV/vendas/confirmar "$ADM" "$(echo "$PLAN_B" | jq -c '.modo = "substituir" | .linhas_brutas[0].pedido = "2" | . + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0b2", confirmar_sobreposicao:true}')"
check "V4 Substituir do sistema: 201, apagou 1, entrou 1" "201 1 1" "$CODE $(j .apagadas) $(j .inseridas)"
check "V4: a do sistema saiu e a nova entrou" "0 1" "$(sql "select count(*) from vendas where pedido='IF-1'") $(sql "select count(*) from vendas where pedido='IF-2'")"
check "V4: planilha padrão, XML e cupom ficaram" "1 1 2" "$(sql "select count(*) from vendas where pedido='SUBST1'") $(sql "select count(*) from vendas where pedido='NFC-e 2-501'") $(sql "select count(*) from vendas where nfce_cupom_id='$CUP'")"

# V4b (revisão 24/11): Substituir com linha com problema e vendas a apagar → prévia bloqueada e 409, nada apagado
V4B=$(echo "$PLAN_B" | jq -c '.modo = "substituir" | .linhas_brutas[0].pedido = "3" | .linhas_brutas += [{"pedido":"4","data":"31/02/2026","produto":"X","qtd":"1","total":"1"}]')
req POST $IV/vendas/previa "$ADM" "$V4B"; check "V4b prévia: Substituir bloqueado" "true 1" "$(j '.substituir.bloqueado') $(j '.substituir.vendas')"
req POST $IV/vendas/confirmar "$ADM" "$(echo "$V4B" | jq -c '. + {chave_idempotencia:"00000000-0000-4000-8000-00000000c0b3", confirmar_sobreposicao:true}')"
check "V4b confirmar: 409 SUBSTITUIR_COM_PROBLEMA, a venda do sistema ficou" "409 SUBSTITUIR_COM_PROBLEMA 1 0" "$CODE $(j .error.code) $(sql "select count(*) from vendas where pedido='IF-2'") $(sql "select count(*) from vendas where pedido='IF-3'")"
# sistema parado não importa
req POST $IV/origens "$ADM" '{"nome":"Smoke Parado","formato_padrao":"planilha"}'; ORIG_P=$(j .id)
req PUT "$IV/origens/$ORIG_P" "$ADM" '{"ativo":false}'
req POST $IV/vendas/previa "$ADM" "$(echo "$PLAN_B" | jq -c --arg o "$ORIG_P" '.origem_id = $o')"; check "sistema parado: 409 ORIGEM_INATIVA" "409 ORIGEM_INATIVA" "$CODE $(j .error.code)"
# XML cuja soma dos itens não bate com o total: fica de fora como "com problema"
K505=$(chave_dv "352611${LOJA_CNPJ}65002000000505112345678")
req POST $IV/vendas/previa "$ADM" "$(xml_corpo "[$(doc "$K505" "$LOJA_CNPJ" 505 1 12.00 | jq -c '.valor_total = "99.00"')]" '[]' '[]')"
check "V5b XML soma × vNF: com problema, nada novo" "1 0 a soma dos itens (R\$ 12,00) não bate com o total do cupom (R\$ 99,00)" "$(j '.documentos.com_problema | length') $(j .documentos.vendas_novas) $(j '.documentos.com_problema[0].motivo')"

# V7: o Substituir da rota antiga (planilha padrão) não apaga venda de XML nem de outro sistema
req POST $IV/vendas "$ADM" '{"arquivo":"vendas-17-11.csv","modo":"substituir","linhas":[{"pedido":"SUBST2","data":"2026-11-17","produto_relatorio":"SMOKE ESPETO","quantidade":"1","valor_total":"12"}]}'
check "V7 rota antiga Substituir: 201" 201 "$CODE"
check "V7: a da planilha padrão saiu; XML, sistema e cupom ficaram" "0 1 1 1 2" "$(sql "select count(*) from vendas where pedido='SUBST1'") $(sql "select count(*) from vendas where pedido='SUBST2'") $(sql "select count(*) from vendas where pedido='NFC-e 2-501'") $(sql "select count(*) from vendas where pedido='IF-2'") $(sql "select count(*) from vendas where nfce_cupom_id='$CUP'")"

# V6: o relatório em PDF sem chave de IA e um arquivo que não é PDF
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $ADM" -F "arquivo=@$PDF;type=application/pdf" "$BASE$IV/vendas/ler-pdf"); BODY=$(cat "$OUT")
check "V6 relatório em PDF sem chave de IA: a frase de hoje" "Leitura de PDF não configurada: cadastre a chave de uma IA em Configurações." "$(j .error.message)"
CODE=$(curl -s -o "$OUT" -w '%{http_code}' -H "authorization: Bearer $ADM" -F "arquivo=@$TXT" "$BASE$IV/vendas/ler-pdf"); BODY=$(cat "$OUT")
check "V6 arquivo que não é PDF: 400" "400 O arquivo não é um PDF." "$CODE $(j .error.message)"

# ========== Roteiro ponta a ponta (desenho 2026-11-24, Parte C) e Cana (Parte B). Ficam no FIM de propósito: o 1º POST /v1/empresas
# toma o `public` e regrava configuracoes (CNPJ), que os blocos de certificado, SEFAZ, cupom e V usam. Nomes e datas próprios.
dias() { TZ=America/Sao_Paulo date -d "$1 days" +%F; }
br() { echo "${1:8:2}/${1:5:2}"; }
sql_falha() { docker exec erp-freela-postgres psql -U erpfreela -d "$PGDB" -tAc "$1" >/dev/null 2>&1; echo $?; }
reqE() { # reqE EMPRESA_ID MÉTODO CAMINHO TOKEN [CORPO_JSON] — com o cabeçalho X-Empresa-Id (o seletor do master)
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$2" "$BASE$3" -H "x-empresa-id: $1")
  [ -n "${4:-}" ] && args+=(-H "authorization: Bearer $4")
  [ -n "${5:-}" ] && args+=(-H 'content-type: application/json' -d "$5")
  CODE=$(curl "${args[@]}")
  BODY=$(cat "$OUT")
}
MES=${HOJE:0:7}

# ---------- E1–E6: nota (CX C/12) → estoque → preço → ficha → venda/baixa → de-para tardio → inventário/CMV → conta da nota no DRE
req POST /v1/itens-estoque "$ADM" '{"nome":"Smoke E Copo"}'; EI=$(j .id)
req PATCH "/v1/itens-estoque/$EI" "$ADM" '{"unidade":"un","preco_unitario":1.5}'; check "E: insumo novo a R\$ 1,50" 1.5 "$(j .preco_unitario)"
req POST /v1/itens-cardapio "$ADM" '{"nome":"Smoke E Prato"}'; EP=$(j .id)
req POST "/v1/itens-cardapio/$EP/ingredientes" "$ADM" "{\"item_estoque_id\":\"$EI\",\"quantidade\":0.5}"; check "E: ficha com o insumo" 201 "$CODE"
ficha_e() { req GET /v1/fichas/resumo "$ADM"; echo "$BODY" | jq -r --arg id "$EP" '.[] | select(.id==$id) | .custo_ingredientes'; }
check "E2: custo da ficha antes da nota = 0,5 × 1,50" 0.75 "$(ficha_e)"
nota_e() { # nota_e CHAVE NÚMERO ITENS(json) FORMA PARCELAS(json)
  jq -nc --arg ch "$1" --arg n "$2" --argjson it "$3" --arg fp "$4" --argjson pa "$5" --arg d "$HOJE" \
    '{chave:$ch,numero:$n,serie:"1",fornecedor_nome:"Distribuidora E Smoke",fornecedor_cnpj:"12.345.678/0001-99",data_emissao:$d,data_entrada:$d,
      valor_total:([$it[] | .quantidade * .valor_unitario] | add),forma_pagamento:$fp,origem:"xml",atualizar_preco:true,itens:$it,parcelas:$pa}'
}
EK1=$(chave_dv "3526111234567800019955001000008801100008801")
req POST /v1/notas "$ADM" "$(nota_e "$EK1" 8801 "[{\"codigo\":\"E01\",\"descricao\":\"COPO CX C/12\",\"unidade\":\"CX\",\"quantidade\":2,\"valor_unitario\":24,\"item_estoque_id\":\"$EI\",\"fator\":12}]" boleto "[{\"vencimento\":\"$(dias 30)\",\"valor\":48}]")"
check "E1: nota com CX C/12 (a prazo, 1 parcela)" "201 1" "$CODE $(j .contas)"; EN1=$(j .id)
check "E1: entrada = 2 CX × 12 = 24 un, custo = R\$ 24 ÷ 12 = R\$ 2,00" "24 2" "$(sql "select quantidade::float || ' ' || custo_unitario::float from movimentacoes where item_estoque_id='$EI' and tipo='entrada_compra'")"
check "E1: preço do insumo por unidade (não por caixa)" 2 "$(sql "select preco_unitario::float from itens_estoque where id='$EI'")"
check "E2: custo da ficha depois da nota = 0,5 × 2,00" 1 "$(ficha_e)"
req POST /v1/importacoes/vendas "$ADM" "{\"arquivo\":\"e3.csv\",\"modo\":\"acrescentar\",\"linhas\":[{\"pedido\":\"E3-1\",\"data\":\"$HOJE\",\"produto_relatorio\":\"SMOKE E PRATO\",\"item_cardapio\":\"smoke e prato\",\"quantidade\":\"2\",\"valor_total\":\"30\"}]}"
check "E3: venda importada" 1 "$(j .inseridas)"
check "E3: baixa = −2 × 0,5 un, ao preço novo (R\$ 2,00)" "-1 2" "$(sql "select m.quantidade::float || ' ' || m.custo_unitario::float from movimentacoes m join vendas v on v.id=m.venda_id where v.pedido='E3-1'")"
req POST /v1/importacoes/vendas "$ADM" "{\"arquivo\":\"e6.csv\",\"modo\":\"acrescentar\",\"linhas\":[{\"pedido\":\"E6-1\",\"data\":\"$HOJE\",\"produto_relatorio\":\"SMOKE E TARDIO\",\"quantidade\":\"4\",\"valor_total\":\"60\"}]}"
check "E6: venda sem item do cardápio entra sem baixa" "1 0" "$(j .inseridas) $(sql "select count(*) from movimentacoes m join vendas v on v.id=m.venda_id where v.pedido='E6-1'")"
req PUT /v1/de-para "$ADM" "{\"produto_relatorio\":\"SMOKE E TARDIO\",\"item_cardapio_id\":\"$EP\"}"; check "E6: de-para tardio religa a venda" 1 "$(j .vendas)"
check "E6: a baixa nasce pela ficha (−4 × 0,5)" -2 "$(sql "select sum(m.quantidade)::float from movimentacoes m join vendas v on v.id=m.venda_id where v.pedido='E6-1'")"
EK2=$(chave_dv "3526111234567800019955001000008802100008802")
req POST /v1/notas "$ADM" "$(nota_e "$EK2" 8802 "[{\"codigo\":\"E02\",\"descricao\":\"COPO UN\",\"unidade\":\"UN\",\"quantidade\":12,\"valor_unitario\":2.5,\"item_estoque_id\":\"$EI\",\"fator\":1}]" pix '[]')"
check "E4: 2ª nota (12 un a R\$ 2,50, à vista)" "201 true" "$CODE $(j .a_vista)"
req POST /v1/inventarios "$ADM" "{\"data\":\"$HOJE\",\"periodicidade\":\"semanal\"}"; check "E4: abre o inventário de hoje" 201 "$CODE"; INV3=$(j .id)
req GET "/v1/inventarios/$INV3/contagem" "$LOJA"; LST=$BODY
check "E4: o insumo novo está na contagem (cega)" true "$(echo "$LST" | jq 'any(.[]; .nome=="Smoke E Copo") and ([.[] | has("teorico_snapshot")] | any | not)')"
for id in $(echo "$LST" | jq -r '.[].id'); do
  q=4; [ "$(echo "$LST" | jq -r --arg id "$id" '.[] | select(.id==$id) | .nome')" == "Smoke E Copo" ] && q=30
  for _ in 1 2 3; do req POST "/v1/inventario-itens/$id/contagem" "$LOJA" "{\"quantidade\":$q}"; [ "$(j .resultado)" == recontar ] || break; done
done
req POST "/v1/inventarios/$INV3/fechar" "$ADM"; check "E4: fecha o inventário de hoje" 200 "$CODE"
req GET /v1/inventarios/cmv "$ADM"
check "E4: CMV do copo = (0 + 36 − 30) × R\$ 2,1667 = R\$ 13,00" 13 "$(echo "$BODY" | jq --arg inv "$INV3" --arg it "$EI" '.[] | select(.inventario_id==$inv and .item_estoque_id==$it) | (.cmv_valor*100|round/100)')"
check "E4: as parcelas: entradas 24 + 12, consumo 0 + 36 − 30 = 6, custo médio (24 × 2 + 12 × 2,50) ÷ 36" "36 6 2.1667" \
  "$(sql "select entradas::float || ' ' || consumo_qtd::float || ' ' || round(custo_unit,4)::float from v_cmv_periodo where inventario_id='$INV3' and item_estoque_id='$EI'")"
PL_CMV=$(sql "select p.id from plano_contas p join dre_subgrupos s on s.nome = p.subgrupo where s.is_cmv and p.conta = 'COMPRA DE CARNES'")
CC_E=$(sql "select id from centros_custo order by nome limit 1")
CE=$(sql "select id from contas_pagar where nota_id='$EN1'")
req POST /v1/contas-pagar/liquidar "$ADM" "{\"ids\":[\"$CE\"],\"pago_em\":\"$HOJE\",\"plano_conta_id\":\"$PL_CMV\",\"centro_custo_id\":\"$CC_E\"}"; check "E5: liquida a conta da nota" 1 "$(j .liquidadas)"
req GET "/v1/dre/pagos?mes=$MES" "$ADM"
check "E5: a conta da nota entra nas despesas do mês do pagamento, numa classe de CMV" 48 "$(echo "$BODY" | jq --arg p "$PL_CMV" '[.[] | select(.plano_conta_id==$p) | .valor_pago] | add')"

# ---------- Cana (desenho Parte B, contrato §22): K1–K6 no public
CANA=/v1/cana
MOV0=$(sql "select count(*) from movimentacoes")
LOJA_ID=$(sql "select id from users where email='loja@erpfreela.local'")
req POST $CANA/lancamentos "$LOJA" "{\"tipo\":\"recebimento\",\"data\":\"$HOJE\",\"duzias\":12}"; check "K1: colaborador sem a tela Cana não lança: 403" 403 "$CODE"
req GET $CANA/lancamentos/recentes "$LOJA"; check "K1: nem vê os próprios: 403" 403 "$CODE"
req PATCH "/v1/usuarios/$LOJA_ID/modulos" "$ADM" '{"modulos":["painel","fichas","inventario","compras","ponto","cana"]}'
check "K1: o admin libera a tela Cana" true "$(echo "$BODY" | jq '.modulos | index("cana") != null')"
K_CH=00000000-0000-4000-8000-00000000ca01
K_REC="{\"tipo\":\"recebimento\",\"data\":\"$HOJE\",\"duzias\":12,\"fornecedor\":\" Sítio  Boa Vista \",\"chave_idempotencia\":\"$K_CH\"}"
req POST $CANA/lancamentos "$LOJA" "$K_REC"
check "K1: a loja lança o recebimento de hoje" "201 12 Sítio Boa Vista false" "$CODE $(j .duzias) $(j .fornecedor) $(j .repetido)"; KL1=$(j .id)
check "K1 (7.16): a resposta do lançar, para a loja, é o recorte de recentes" '["anulado","corrigido","data","duzias","fornecedor","id","lancado_em","litros_caldo","litros_frozen","observacao","repetido","tipo"]' "$(echo "$BODY" | jq -c keys)"
req POST $CANA/lancamentos "$LOJA" "$K_REC"
check "K1 (7.13): a mesma chave de novo = 200 com o da 1ª vez, sem lançar outro" "200 $KL1 true 1" "$CODE $(j .id) $(j .repetido) $(sql "select count(*) from cana_lancamentos where chave_idempotencia='$K_CH'")"
req POST $CANA/lancamentos "$LOJA" "{\"tipo\":\"recebimento\",\"data\":\"$HOJE\",\"duzias\":120,\"chave_idempotencia\":\"$K_CH\"}"
check "K1 (7.13): a mesma chave com outro número: 409" "409 CANA_CHAVE_REPETIDA" "$CODE $(j .error.code)"
req POST $CANA/lancamentos "$ADM" "$K_REC"; check "K1 (7.13): a chave de outra pessoa não devolve o lançamento dela: 409" 409 "$CODE"
K_CH2=00000000-0000-4000-8000-00000000ca02
K_REC2="{\"tipo\":\"recebimento\",\"data\":\"$HOJE\",\"duzias\":1,\"chave_idempotencia\":\"$K_CH2\"}"
req POST $CANA/lancamentos "$LOJA" "$K_REC2"; KL2=$(j .id)
req POST "$CANA/lancamentos/$KL2/anular" "$ADM" '{"motivo":"Segredo do gerente"}'
req POST $CANA/lancamentos "$LOJA" "$K_REC2"
check "K1 (7.13/7.16): a mesma chave depois de o gerente anular: 200 e anulado, sem o motivo nem quem anulou" "200 $KL2 true false" \
  "$CODE $(j .id) $(j .anulado) $(echo "$BODY" | jq 'has("anulado_motivo") or has("anulado_por_nome") or has("lancado_por") or (tostring | test("Segredo"))')"
req POST $CANA/lancamentos "$LOJA" "{\"tipo\":\"recebimento\",\"data\":\"$(dias -3)\",\"duzias\":5}"
check "K1: a loja com data de 3 dias atrás: 400 CANA_DATA_FORA" "400 CANA_DATA_FORA A loja lança só hoje ou ontem." "$CODE $(j .error.code) $(j .error.message)"
req POST $CANA/lancamentos "$ADM" "{\"tipo\":\"recebimento\",\"data\":\"$(dias 1)\",\"duzias\":5}"; check "K1: data no futuro (admin): 400" "400 Data no futuro." "$CODE $(j .error.message)"
req POST $CANA/lancamentos "$LOJA" "{\"tipo\":\"producao\",\"data\":\"$HOJE\",\"litros_caldo\":0}"
check "K1: produção sem litros: 400 com a frase" "400 Digite quantos litros de caldo saíram (maior que zero)." "$CODE $(j .error.message)"
for r in parametros produtos "lancamentos?ini=$HOJE&fim=$HOJE" semanas semanas/atual; do req GET "$CANA/$r" "$LOJA"; check "K1: loja barrada em GET $CANA/$r" 403 "$CODE"; done
for r in "PUT parametros" "PUT produtos/$KL1" "POST lancamentos/$KL1/anular" "POST lancamentos/$KL1/corrigir"; do
  req "${r%% *}" "$CANA/${r#* }" "$LOJA" '{}'; check "K1: loja barrada em ${r%% *} $CANA/${r#* }" 403 "$CODE"
done
req GET $CANA/parametros "$ADM"; check "K4: nada vem preenchido" "null null 0" "$(j .litros_por_duzia_esperado) $(j .rendimento_frozen) $(j '.historico|length')"
req POST /v1/itens-cardapio "$ADM" '{"nome":"Caldo de cana 300 ml"}'; KC=$(j .id)
req POST /v1/itens-cardapio "$ADM" '{"nome":"Frozen de cana 400 ml"}'; KF=$(j .id)
req POST /v1/itens-cardapio "$ADM" '{"nome":"Garapa jarra"}'
req GET $CANA/produtos "$ADM"
check "K4: os produtos com nome de caldo são sugeridos, nenhum configurado" "true false 0" \
  "$(echo "$BODY" | jq --arg c "$KC" '.[] | select(.item_cardapio_id==$c) | .parece_cana') $(echo "$BODY" | jq --arg p "$EP" '.[] | select(.item_cardapio_id==$p) | .parece_cana') $(echo "$BODY" | jq '[.[] | select(.config != null)] | length')"
req PUT "$CANA/produtos/$KC" "$ADM" '{"ml_por_unidade":300,"frozen":false,"ativo":true}'; check "K4: configura o caldo de 300 ml" "300 Admin Demo" "$(j .ml_por_unidade) $(j .atualizado_por_nome)"
req PUT "$CANA/produtos/$KF" "$ADM" '{"ml_por_unidade":400,"frozen":true,"ativo":true}'; check "K4: configura o frozen de 400 ml" true "$(j .frozen)"
req PUT "$CANA/produtos/$KC" "$ADM" '{"ml_por_unidade":0,"frozen":false,"ativo":true}'; check "K4: ml zero: 400" 400 "$CODE"
req PUT "$CANA/produtos/00000000-0000-4000-8000-000000000000" "$ADM" '{"ml_por_unidade":300,"frozen":false,"ativo":true}'; check "K4: produto inexistente: 404" 404 "$CODE"
req PUT $CANA/parametros "$ADM" '{"litros_por_duzia_esperado":5.5,"rendimento_frozen":1.25}'
check "K4: salva os números, com quem e o histórico" "5.5 1.25 Admin Demo 1" "$(j .litros_por_duzia_esperado) $(j .rendimento_frozen) $(j .atualizado_por_nome) $(j '.historico|length')"
C1=$(dias -8); C2=$(dias -1)
lanca() { req POST $CANA/lancamentos "$ADM" "$1"; }
lanca "{\"tipo\":\"contagem\",\"data\":\"$C1\",\"duzias\":4,\"litros_caldo\":3}"; check "K4: contagem de partida (admin, 8 dias atrás)" 201 "$CODE"; KC1=$(j .id)
lanca "{\"tipo\":\"recebimento\",\"data\":\"$(dias -7)\",\"duzias\":4}"
lanca "{\"tipo\":\"recebimento\",\"data\":\"$(dias -5)\",\"duzias\":4}"
lanca "{\"tipo\":\"recebimento\",\"data\":\"$(dias -3)\",\"duzias\":40}"; KERR=$(j .id)
lanca "{\"tipo\":\"recebimento\",\"data\":\"$C1\",\"duzias\":100}"
lanca "{\"tipo\":\"producao\",\"data\":\"$(dias -6)\",\"litros_caldo\":25,\"duzias\":5}"
lanca "{\"tipo\":\"producao\",\"data\":\"$(dias -2)\",\"litros_caldo\":25}"; check "K4: produção" 201 "$CODE"
lanca "{\"tipo\":\"contagem\",\"data\":\"$C2\",\"duzias\":60,\"litros_caldo\":5}"; KERR2=$(j .id)
lanca "{\"tipo\":\"contagem\",\"data\":\"$C2\",\"duzias\":6,\"litros_caldo\":5}"
check "K2: 2ª contagem no mesmo dia (admin): 409 com a frase" "409 CANA_CONTAGEM_DO_DIA Já existe uma contagem em $(br "$C2"). Anule a anterior para lançar outra." "$CODE $(j .error.code) $(j .error.message)"
req POST $CANA/lancamentos "$LOJA" "{\"tipo\":\"contagem\",\"data\":\"$C2\",\"duzias\":6,\"litros_caldo\":5}"
check "K2: a mesma coisa pela loja: a frase da loja (7.15)" "409 Já existe uma contagem em $(br "$C2"). Se ela está errada, avise o gerente: só ele corrige." "$CODE $(j .error.message)"
req POST "$CANA/lancamentos/$KERR2/anular" "$ADM" '{"motivo":" ab "}'; check "K2: anular sem motivo: 400" "400 CANA_MOTIVO_OBRIGATORIO Escreva o motivo (pelo menos 3 letras)." "$CODE $(j .error.code) $(j .error.message)"
req POST "$CANA/lancamentos/$KERR2/anular" "$ADM" '{"motivo":"Número errado"}'; check "K2: anula com motivo (fica no livro)" "200 Número errado Admin Demo" "$CODE $(j .anulado_motivo) $(j .anulado_por_nome)"
req POST "$CANA/lancamentos/$KERR2/anular" "$ADM" '{"motivo":"de novo"}'; check "K2: já anulado: 409" "409 CANA_JA_ANULADO" "$CODE $(j .error.code)"
lanca "{\"tipo\":\"contagem\",\"data\":\"$C2\",\"duzias\":6,\"litros_caldo\":5}"; check "K2: com a anterior anulada, a contagem entra" 201 "$CODE"; KC2=$(j .id)
req POST "$CANA/lancamentos/$KERR/corrigir" "$ADM" "{\"motivo\":\"Número errado\",\"data\":\"$(dias -3)\",\"duzias\":0}"
check "K2 (7.14): corrigir com número inválido: 400 e o antigo continua valendo" "400 0" "$CODE $(sql "select count(*) from cana_lancamentos where id='$KERR' and anulado_em is not null")"
req POST "$CANA/lancamentos/$KERR/corrigir" "$ADM" "{\"motivo\":\"Número errado\",\"data\":\"$(dias -3)\",\"duzias\":4}"
check "K2 (7.14): corrigir anula o antigo e lança o novo com substitui_id, numa transação" "201 $KERR 4 Corrigido: Número errado" "$CODE $(j .substitui_id) $(j .duzias) $(sql "select anulado_motivo from cana_lancamentos where id='$KERR'")"
req POST "$CANA/lancamentos/$KERR/corrigir" "$ADM" "{\"motivo\":\"de novo\",\"data\":\"$(dias -3)\",\"duzias\":4}"; check "K2: corrigir o já corrigido: 409" 409 "$CODE"
check "K3: o banco recusa apagar lançamento" 1 "$(sql_falha "delete from cana_lancamentos where id='$KC1'")"
check "K3: o banco recusa mudar o número" 1 "$(sql_falha "update cana_lancamentos set duzias = 5 where id='$KC1'")"
check "K3: o banco recusa desfazer a anulação" 1 "$(sql_falha "update cana_lancamentos set anulado_em = null, anulado_por = null, anulado_por_nome = null, anulado_motivo = null where id='$KERR2'")"
check "K3: o banco recusa mudar o histórico dos números" 1 "$(sql_falha "delete from cana_parametros_historico")"
req POST /v1/importacoes/vendas "$ADM" "{\"arquivo\":\"cana.csv\",\"modo\":\"acrescentar\",\"linhas\":[
{\"pedido\":\"K-1\",\"data\":\"$(dias -5)\",\"produto_relatorio\":\"CALDO DE CANA 300\",\"item_cardapio\":\"caldo de cana 300 ml\",\"quantidade\":\"60\",\"valor_total\":\"600\"},
{\"pedido\":\"K-2\",\"data\":\"$C2\",\"produto_relatorio\":\"CALDO DE CANA 300\",\"item_cardapio\":\"caldo de cana 300 ml\",\"quantidade\":\"40\",\"valor_total\":\"400\"},
{\"pedido\":\"K-3\",\"data\":\"$(dias -4)\",\"produto_relatorio\":\"FROZEN 400\",\"item_cardapio\":\"frozen de cana 400 ml\",\"quantidade\":\"40\",\"valor_total\":\"800\"},
{\"pedido\":\"K-4\",\"data\":\"$C1\",\"produto_relatorio\":\"CALDO DE CANA 300\",\"item_cardapio\":\"caldo de cana 300 ml\",\"quantidade\":\"1000\",\"valor_total\":\"10000\"},
{\"pedido\":\"K-5\",\"data\":\"$(dias -4)\",\"produto_relatorio\":\"GARAPA JARRA\",\"item_cardapio\":\"garapa jarra\",\"quantidade\":\"12\",\"valor_total\":\"120\"},
{\"pedido\":\"K-6\",\"data\":\"$(dias -4)\",\"produto_relatorio\":\"CALDO CANA 500\",\"quantidade\":\"8\",\"valor_total\":\"80\"}]}"
check "K4: as vendas da semana entram pela importação (qualquer origem serve)" 6 "$(j .inseridas)"
req GET $CANA/semanas "$ADM"
check "K4: uma semana fechada, da contagem de partida até a de ontem" "2 1 $KC1 $KC2" "$(j .contagens) $(j '.semanas|length') $(j '.semanas[0].contagem_inicial.id') $(j '.semanas[0].contagem_final.id')"
check "K4: os 4 números da lista (cana moída, produzido, vendido, perda)" "10 50 42.8 5.2" "$(j '.semanas[0].cana_moida') $(j '.semanas[0].caldo_produzido') $(j '.semanas[0].caldo_vendido') $(j '.semanas[0].perda')"
req GET "$CANA/semanas/$KC2" "$ADM"
check "K4: cana moída = 4 + 12 (3 recebimentos) − 6 = 10 dúzias" "4 12 3 6 10" "$(j .cana.inicio) $(j .cana.recebida.duzias) $(j .cana.recebida.lancamentos) $(j .cana.fim) $(j .cana.moida)"
check "K4: caldo vendido = 30 L em copos + 16 L de frozen ÷ 1,25 = 42,8; perda = 3 + 50 − 42,8 − 5 = 5,2" "50 30 12.8 42.8 3 5 5.2" \
  "$(j .caldo.produzido.litros) $(j .caldo.vendido.em_copos) $(j .caldo.vendido.em_frozen) $(j .caldo.vendido.litros) $(j .caldo.inicio.litros) $(j .caldo.fim.litros) $(j .caldo.perda)"
check "K4: 5 L por dúzia (esperado 5,5 → −5 L, −9,09%); rendimento 42,8 ÷ 10 = 4,28" "5 5.5 -5 -9.09 4.28" \
  "$(j .moagem.litros_por_duzia) $(j .moagem.esperado) $(j .moagem.diferenca_litros) $(j .moagem.diferenca_pct) $(j .rendimento.litros_vendidos_por_duzia)"
check "K5: venda e recebimento no dia da contagem anterior ficam fora; venda no dia da contagem atual, dentro" "100 $(dias -7) $(dias -3)" \
  "$(echo "$BODY" | jq --arg c "$KC" '.por_produto[] | select(.item_cardapio_id==$c) | .quantidade') $(j .cana.recebida.ini) $(j .cana.recebida.fim)"
check "K4: avisos: a garapa vendida sem ml e o CALDO CANA 500 sem item do cardápio" "Garapa jarra|CALDO CANA 500" \
  "$(j '.avisos[] | select(.codigo=="produto_sem_ml") | .dados.produtos[0].nome')|$(j '.avisos[] | select(.codigo=="venda_sem_cardapio") | .dados.produtos[0].produto_relatorio')"
check "K4: calculada com a configuração de hoje" configuracao_de_hoje "$(j .calculada_com)"
req PUT $CANA/parametros "$ADM" '{"litros_por_duzia_esperado":5.5,"rendimento_frozen":null}'
req GET "$CANA/semanas/$KC2" "$ADM"; check "K4: sem o rendimento do frozen, os 40 frozen ficam fora, com o aviso" "30 40" "$(j .caldo.vendido.litros) $(j '.avisos[] | select(.codigo=="frozen_sem_rendimento") | .dados.vendidos')"
req PUT $CANA/parametros "$ADM" '{"litros_por_duzia_esperado":5.5,"rendimento_frozen":1.25}'; check "K4: cada Salvar entra no histórico" 3 "$(j '.historico|length')"
req GET "$CANA/semanas/$KC1" "$ADM"; check "K4: a contagem de partida não fecha semana: 404" 404 "$CODE"
req GET "$CANA/semanas/atual" "$ADM"
check "K4: em andamento desde a de ontem: o recebimento da loja de hoje, sem perda nem cana moída" "true $KC2 12 null null" \
  "$(j .apuracao.em_andamento) $(j .apuracao.contagem_inicial.id) $(j .apuracao.cana.recebida.duzias) $(j .apuracao.caldo.perda) $(j .apuracao.cana.moida)"
req GET "$CANA/lancamentos?ini=$C1&fim=$HOJE" "$ADM"
check "K: a lista do admin traz tudo, com os 3 anulados e a correção" "12 3 $KERR" \
  "$(j length) $(echo "$BODY" | jq '[.[] | select(.anulado_em != null)] | length') $(echo "$BODY" | jq -r '.[] | select(.substitui_id != null) | .substitui_id')"
req GET $CANA/lancamentos/recentes "$LOJA"
check "K (7.16): a loja vê só o que ela lançou (o anulado marcado), com hoje e ontem do servidor" "$HOJE $C2 2 false false true" \
  "$(j .hoje) $(j .ontem) $(j '.lancamentos|length') $(echo "$BODY" | jq -r --arg a "$KL1" --arg b "$KL2" '[(.lancamentos[] | select(.id==$a) | .anulado, .corrigido), (.lancamentos[] | select(.id==$b) | .anulado)] | join(" ")')"
check "K (7.15): as contagens de hoje e ontem aparecem sem número nenhum" '[{"data":"'"$C2"'","keys":["data","em","por_nome"]}]' \
  "$(echo "$BODY" | jq -c '[.contagens_lancadas[] | {data, keys: keys}]')"
check "K (7.16): nenhuma conta, motivo ou id de quem lançou na resposta da loja" false "$(echo "$BODY" | jq '[.. | objects | has("anulado_motivo") or has("perda") or has("moida") or has("lancado_por") or has("duzias_esperadas")] | any')"
check "K (7.16): os fornecedores já usados" '["Sítio Boa Vista"]' "$(echo "$BODY" | jq -c .fornecedores)"
check "K6: a Cana não mexe no estoque (movimentações iguais)" "$MOV0" "$(sql "select count(*) from movimentacoes")"

# ---------- E9: Ponto (terminal liberado + PIN; batida nunca some)
req POST /v1/ponto/terminais "$LOJA" '{"nome":"x"}'; check "E9: a loja não libera terminal" 403 "$CODE"
req GET /v1/ponto/colaboradores "$LOJA"; check "E9: a loja não alcança os cadastros do ponto" 403 "$CODE"
req POST /v1/ponto/colaboradores "$ADM" '{"nome":"Smoke Sem Empregador","pin":"1234"}'; check "E9: cadastra o colaborador (sem devolver o PIN)" "201 false" "$CODE $(echo "$BODY" | jq 'has("pin_hash") or has("pin")')"; P1=$(j .id)
req POST /v1/ponto/terminais "$ADM" '{"nome":"Caixa Smoke"}'; check "E9: o admin libera o terminal (o token só agora)" "201 true" "$CODE $(echo "$BODY" | jq '(.token|length) > 20')"; TT=$(j .token)
check "E9: o banco guarda só o hash do token" 0 "$(sql "select count(*) from ponto_terminais where token_hash='$TT'")"
req GET /v1/ponto/terminal "$LOJA"; check "E9: a loja sem o cabeçalho do terminal: 403" "403 TERMINAL_NAO_AUTORIZADO" "$CODE $(j .error.code)"
reqT() { # reqT MÉTODO CAMINHO [CORPO] — a loja no computador liberado
  local args=(-s -o "$OUT" -w '%{http_code}' -X "$1" "$BASE$2" -H "authorization: Bearer $LOJA" -H "x-ponto-terminal: $TT")
  [ -n "${3:-}" ] && args+=(-H 'content-type: application/json' -d "$3")
  CODE=$(curl "${args[@]}")
  BODY=$(cat "$OUT")
}
reqT GET /v1/ponto/terminal; check "E9: com o terminal, a loja vê os colaboradores ativos" true "$(echo "$BODY" | jq --arg id "$P1" 'any(.colaboradores[]; .id==$id)')"
reqT POST /v1/ponto/terminal/identificar "{\"colaborador_id\":\"$P1\",\"pin\":\"9999\"}"; check "E9: PIN errado: 400 (nunca 401)" "400 PIN_INCORRETO" "$CODE $(j .error.code)"
reqT POST /v1/ponto/terminal/marcar "{\"colaborador_id\":\"$P1\",\"pin\":\"1234\",\"tipo\":\"entrada\"}"; check "E9: marca a entrada" "201 entrada $HOJE" "$CODE $(j .marcacao.tipo) $(j .marcacao.data)"; PM=$(j .marcacao.id)
req GET "/v1/ponto/espelho/$P1?mes=$MES" "$ADM"; check "E9: a batida aparece no espelho" 1 "$(echo "$BODY" | jq --arg d "$HOJE" '[.dias[] | select(.data==$d) | .marcacoes[]] | length')"
req POST "/v1/ponto/marcacoes/$PM/anular" "$ADM" '{"motivo":""}'; check "E9: anular sem motivo: 400" 400 "$CODE"
req POST "/v1/ponto/marcacoes/$PM/corrigir" "$ADM" '{"hora":"00:01","tipo":"entrada","motivo":"Bateu atrasado"}'
check "E9: corrigir = anula a original e lança a manual com substitui_id" "200 $PM manual" "$CODE $(j .substitui_id) $(j .origem)"; PM2=$(j .id)
req POST "/v1/ponto/marcacoes/$PM2/anular" "$ADM" '{"motivo":"Lançada por engano"}'; check "E9: anula com motivo" "true Lançada por engano" "$(j .anulada) $(j .anulada_motivo)"
req POST "/v1/ponto/marcacoes/$PM2/anular" "$ADM" '{"motivo":"de novo"}'; check "E9: já anulada: 409" "409 ANULADA" "$CODE $(j .error.code)"
req GET "/v1/ponto/marcacoes?colaborador_id=$P1&mes=$MES" "$ADM"; check "E9: nada some: as 2 batidas continuam no livro, anuladas" "2 2" "$(j length) $(echo "$BODY" | jq '[.[] | select(.anulada)] | length')"

# ---------- E7: Empresas (só master; §19/§21) e o multiempresa: dado de uma empresa não aparece na outra
EMP=/v1/empresas
req GET $EMP "$LOJA"; check "E7: a loja não alcança Empresas (GET)" 403 "$CODE"
req POST $EMP "$LOJA" '{"razao_social":"X","cnpj":"11222333000181"}'; check "E7: a loja não alcança Empresas (POST)" 403 "$CODE"
req POST $EMP "$ADM" '{"razao_social":"Smoke Valinhos Ltda","cnpj":"11.222.333/0001-80"}'; check "E7: CNPJ com dígito errado: 400" 400 "$CODE"
req POST $EMP "$ADM" '{"razao_social":"Smoke Valinhos Ltda","nome_fantasia":"Smoke Valinhos","cnpj":"11.222.333/0001-81"}'
check "E7: a 1ª empresa fica com os dados que já existiam (public) e é a principal" "201 public true" "$CODE $(j .schema_banco) $(j .principal)"; EA=$(j .id)
check "E7: Configurações espelha a principal" "11222333000181 Smoke Valinhos Ltda" "$(sql "select cnpj || ' ' || razao_social from configuracoes where id=1")"
check "E7: os usuários comuns de antes passam a ser da principal" "$EA" "$(sql "select empresa_id from users where id='$LOJA_ID'")"
req POST $EMP "$ADM" '{"razao_social":"Outra","cnpj":"11222333000181"}'; check "E7: CNPJ repetido: 409 DUPLICADO" "409 DUPLICADO" "$CODE $(j .error.code)"
req POST $EMP "$ADM" '{"razao_social":"Smoke Itupeva Ltda","nome_fantasia":"Smoke Itupeva","cnpj":"11.444.777/0001-61"}'; EB=$(j .id); SB=$(j .schema_banco)
check "E7: a 2ª nasce num schema próprio, com todas as migrações (a cana inclusive)" "201 false empresa_ 4" \
  "$CODE $(j .principal) ${SB:0:8} $(sql "select count(*) from information_schema.tables where table_schema='$SB' and table_name like 'cana_%'")"
check "E7: o espelho de Configurações da 2ª fica no schema dela; o public continua com a 1ª" "11444777000161 11222333000181" "$(sql "select cnpj from $SB.configuracoes") $(sql "select cnpj from configuracoes")"
req DELETE "$EMP/$EA" "$ADM"; check "E7: excluir a principal: 409 PRINCIPAL" "409 PRINCIPAL" "$CODE $(j .error.code)"
reqE "$EB" GET /v1/itens-estoque "$ADM"; check "ME: a 2ª começa sem insumos (nada do public)" "200 0" "$CODE $(j length)"
reqE "$EB" POST /v1/itens-estoque "$ADM" '{"nome":"Smoke Só Itupeva"}'; check "ME: insumo criado na 2ª" 201 "$CODE"
check "ME: o insumo da 2ª fica só no schema dela" "0 1" "$(sql "select count(*) from itens_estoque where nome='Smoke Só Itupeva'") $(sql "select count(*) from $SB.itens_estoque where nome='Smoke Só Itupeva'")"
req GET /v1/itens-estoque "$ADM"; check "ME: o master sem o cabeçalho vê a principal" "false true" "$(echo "$BODY" | jq 'any(.[]; .nome=="Smoke Só Itupeva")') $(echo "$BODY" | jq 'any(.[]; .nome=="Smoke E Copo")')"
reqE nao-e-uuid GET /v1/itens-estoque "$ADM"; check "ME: cabeçalho malformado: 403 EMPRESA" "403 EMPRESA" "$CODE $(j .error.code)"
reqE 00000000-0000-4000-8000-000000000000 GET /v1/itens-estoque "$ADM"; check "ME: empresa inexistente: 403 EMPRESA" "403 EMPRESA" "$CODE $(j .error.code)"
reqE "$EB" GET $CANA/parametros "$ADM"; check "ME: a configuração da cana é por empresa (a 2ª nasce em branco)" "null null" "$(j .litros_por_duzia_esperado) $(j .rendimento_frozen)"
reqE "$EB" POST /v1/usuarios "$ADM" '{"nome":"Caixa Itupeva","email":"caixa-itupeva@smoke.local","senha":"123456","perfil":"loja","modulos":["cana"]}'
check "ME: o master cria a colaboradora na 2ª, presa a ela" "201 $EB" "$CODE $(sql "select empresa_id from users where email='caixa-itupeva@smoke.local'")"
req POST /v1/auth/login "" '{"email":"caixa-itupeva@smoke.local","senha":"123456"}'; LB=$(j .access_token)
req GET /v1/auth/me "$LB"; check "ME: o /me da colaboradora traz a 2ª" "$EB loja" "$(j .empresa.id) $(j .user.perfil)"
PUB_CANA=$(sql "select count(*) from cana_lancamentos")
reqE "$EA" POST $CANA/lancamentos "$LB" "{\"tipo\":\"contagem\",\"data\":\"$HOJE\",\"duzias\":2,\"litros_caldo\":1}"
check "ME: a colaboradora da 2ª lança a contagem; o cabeçalho da 1ª é ignorado e vai para a 2ª" "201 1 $PUB_CANA" \
  "$CODE $(sql "select count(*) from $SB.cana_lancamentos") $(sql "select count(*) from cana_lancamentos")"
reqE "$EA" POST $CANA/lancamentos "$LB" "{\"tipo\":\"contagem\",\"data\":\"$HOJE\",\"duzias\":3,\"litros_caldo\":1}"; check "K2 na 2ª: a contagem do dia já existe: 409" "409 CANA_CONTAGEM_DO_DIA" "$CODE $(j .error.code)"
req GET $CANA/semanas/atual "$LB"; check "ME: a colaboradora não vê a conta da semana" 403 "$CODE"
req GET $CANA/lancamentos/recentes "$LB"; check "ME: a colaboradora vê o que lançou na 2ª" "1 contagem" "$(j '.lancamentos|length') $(j '.lancamentos[0].tipo')"
reqE "$EB" POST $CANA/lancamentos "$ADM" "{\"tipo\":\"contagem\",\"data\":\"$(dias -2)\",\"duzias\":5,\"litros_caldo\":2}"; check "K4 na 2ª: contagem de partida" 201 "$CODE"
reqE "$EB" POST $CANA/lancamentos "$ADM" "{\"tipo\":\"recebimento\",\"data\":\"$(dias -1)\",\"duzias\":3}"
reqE "$EB" POST $CANA/lancamentos "$ADM" "{\"tipo\":\"producao\",\"data\":\"$(dias -1)\",\"litros_caldo\":10}"
reqE "$EB" POST $CANA/lancamentos "$ADM" "{\"tipo\":\"recebimento\",\"data\":\"$(dias -1)\",\"duzias\":30}"; KB_ERR=$(j .id)
reqE "$EB" POST "$CANA/lancamentos/$KB_ERR/corrigir" "$ADM" "{\"motivo\":\"Número errado\",\"data\":\"$(dias -1)\",\"duzias\":3}"
check "K2 na 2ª: corrigir anula e lança numa transação, no schema da empresa" "201 $KB_ERR" "$CODE $(j .substitui_id)"; KB_NOVO=$(j .id)
reqE "$EB" POST "$CANA/lancamentos/$KB_NOVO/anular" "$ADM" '{"motivo":"Lançado em dobro"}'; check "K2 na 2ª: anular (o trinco da linha no schema da empresa)" "200 Lançado em dobro" "$CODE $(j .anulado_motivo)"
check "K2 na 2ª: os 2 anulados ficam no livro da 2ª; nada no public" "2 0" "$(sql "select count(*) from $SB.cana_lancamentos where anulado_em is not null") $(sql "select count(*) from cana_lancamentos where id in ('$KB_ERR','$KB_NOVO')")"
reqE "$EB" GET $CANA/semanas "$ADM"
check "K4 na 2ª: só as contagens dela; cana moída 5 + 3 − 2 = 6, produzido 10, vendido 0, perda 2 + 10 − 0 − 1 = 11" "2 1 6 10 0 11" \
  "$(j .contagens) $(j '.semanas|length') $(j '.semanas[0].cana_moida') $(j '.semanas[0].caldo_produzido') $(j '.semanas[0].caldo_vendido') $(j '.semanas[0].perda')"
check "K3 na 2ª: o banco recusa apagar lançamento" 1 "$(sql_falha "delete from $SB.cana_lancamentos")"
check "ME: nada da cana da 2ª no public (e vice-versa)" "$PUB_CANA 6" "$(sql "select count(*) from cana_lancamentos") $(sql "select count(*) from $SB.cana_lancamentos")"
req DELETE "$EMP/$EB" "$ADM"; check "E7: excluir empresa com usuários: 409 EM_USO" "409 EM_USO" "$CODE $(j .error.code)"

# ---------- E8: Empresas → Ponto (o empregador no espelho: a do colaborador; sem ela, a principal)
req GET "/v1/ponto/espelho/$P1?mes=$MES" "$ADM"; check "E8: sem empregador, o espelho traz a principal" "Smoke Valinhos Ltda|11.222.333/0001-81" "$(j .empresa.razao_social)|$(j .empresa.cnpj)"
req POST /v1/ponto/colaboradores "$ADM" "{\"nome\":\"Smoke De Itupeva\",\"pin\":\"1234\",\"empresa_id\":\"$EB\"}"
check "E8: multiempresa: o empregador é a empresa da requisição (outra empresa = 404)" "404 Empresa não encontrada" "$CODE $(j .error.message)"
req POST /v1/ponto/colaboradores "$ADM" "{\"nome\":\"Smoke De Valinhos\",\"pin\":\"1234\",\"empresa_id\":\"$EA\"}"; P2=$(j .id)
req GET "/v1/ponto/espelho/$P2?mes=$MES" "$ADM"; check "E8: com empregador, o espelho traz a empresa dele" "Smoke Valinhos Ltda|11.222.333/0001-81" "$(j .empresa.razao_social)|$(j .empresa.cnpj)"
reqE "$EB" POST /v1/ponto/colaboradores "$ADM" '{"nome":"Smoke Na Itupeva","pin":"1234"}'; P3=$(j .id)
reqE "$EB" GET "/v1/ponto/espelho/$P3?mes=$MES" "$ADM"; check "E8: dentro da 2ª, o espelho traz a própria 2ª" "Smoke Itupeva Ltda" "$(j .empresa.razao_social)"
check "E8: o colaborador da 2ª não aparece no public" 0 "$(sql "select count(*) from ponto_colaboradores where nome='Smoke Na Itupeva'")"

rm -f "$PDF" "$TXT" "$JPG" "$OUT"

echo "smoke: $ok ok, $falhas falha(s)"
[ "$falhas" -eq 0 ]
