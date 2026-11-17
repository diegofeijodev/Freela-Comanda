#!/usr/bin/env bash
# Smoke da API contra um banco recém-semeado (use scripts/smoke-capped.sh — ele cria o banco descartável e sobe a API).
# Cobre: permissões admin × loja (o papel das políticas RLS), as funções de regra (inventário cego, fechamento, lista de
# compras, recebimento, entrada de nota), contas/caixa/DRE, importações, usuários e a leitura de PDF sem chave.
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
rm -f "$PDF" "$TXT" "$JPG" "$OUT"

echo "smoke: $ok ok, $falhas falha(s)"
[ "$falhas" -eq 0 ]
