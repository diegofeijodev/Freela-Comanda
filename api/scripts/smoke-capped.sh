#!/usr/bin/env bash
# Smoke completo num banco DESCARTÁVEL (erpfreela_smoke, recriado a cada rodada) e numa API própria na 3096 — o banco de
# desenvolvimento não é tocado. Rode pelo teto de memória:  ../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh
set -euo pipefail
cd "$(dirname "$0")/.."
PG=erp-freela-postgres
DB=erpfreela_smoke
PORTA=${SMOKE_PORT:-3096}
URL="postgresql://erpfreela:erpfreela@localhost:5440/$DB?schema=public"

docker exec "$PG" psql -U erpfreela -d erpfreela -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
docker exec "$PG" psql -U erpfreela -d erpfreela -qc "CREATE DATABASE $DB" >/dev/null
DATABASE_URL="$URL" NODE_OPTIONS=--max-old-space-size=400 npx prisma migrate deploy >/dev/null
DATABASE_URL="$URL" NODE_OPTIONS=--max-old-space-size=400 npx ts-node --transpile-only prisma/seed.ts
# ciclo da busca na SEFAZ no Postgres de verdade, com porta e certificado falsos (sem rede); apaga o que criou
DATABASE_URL="$URL" NODE_OPTIONS=--max-old-space-size=400 npx ts-node --transpile-only scripts/ciclo-sefaz-banco.ts

# Barreira de rede (só do smoke): recusa conexão a qualquer host que não seja local, antes de DNS/socket. Prova abaixo.
SEM_REDE="$PWD/scripts/smoke-sem-rede.cjs"
PROVA=$(NODE_OPTIONS="--require $SEM_REDE" node -e "
const https = require('node:https'); const tls = require('node:tls'); const net = require('node:net');
const tenta = (nome, f) => { try { f(); console.log(nome + ': NÃO RECUSOU'); process.exit(1); } catch (e) { console.log(nome + ': ' + e.code); } };
tenta('https www1.nfe.fazenda.gov.br', () => https.request({ host: 'www1.nfe.fazenda.gov.br', port: 443, method: 'POST' }).end());
tenta('tls hom1.nfe.fazenda.gov.br', () => tls.connect({ host: 'hom1.nfe.fazenda.gov.br', port: 443 }));
tenta('net 8.8.8.8', () => net.connect(53, '8.8.8.8'));
const l = net.createServer().listen(0, '127.0.0.1', () => { net.connect(l.address().port, '127.0.0.1').on('connect', function () { console.log('127.0.0.1: livre'); this.destroy(); l.close(); }); });
" 2>&1) || { echo "barreira de rede do smoke NÃO funcionou:"; echo "$PROVA"; exit 1; }
echo "$PROVA"
[ "$(echo "$PROVA" | grep -c 'conexão recusada')" -eq 3 ] || { echo "barreira de rede: esperava 3 recusas"; exit 1; }
# respostas à SEFAZ no Postgres de verdade (rotas da caixa e a fila, com a porta dos eventos e o certificado fictício; sem rede, e sob a
# barreira); confere T1/T2, CHECKs, FKs e os 2 índices parciais e apaga o que criou
DATABASE_URL="$URL" NODE_OPTIONS="--max-old-space-size=400 --require $SEM_REDE" npm_config_update_notifier=false \
  npx ts-node --transpile-only scripts/respostas-sefaz-banco.ts
LOG=$(mktemp)
# npm_config_update_notifier=false: o aviso de versão do npx também roda sob a barreira e daria falso "BARROU CONEXÃO NA API"
DATABASE_URL="$URL" PORT=$PORTA NODE_OPTIONS="--max-old-space-size=600 --require $SEM_REDE" ANTHROPIC_API_KEY= npm_config_update_notifier=false \
  CERTIFICADO_SECRET=smoke-certificado-segredo-de-teste-0123456789 \
  SEFAZ_DFE_AMBIENTE=producao SEFAZ_MANIFESTACAO=ligada \
  setsid npx ts-node --transpile-only -r tsconfig-paths/register src/main.ts >"$LOG" 2>&1 &
API_PID=$!
trap 'kill -- -$API_PID 2>/dev/null || kill $API_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do curl -sf "localhost:$PORTA/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "localhost:$PORTA/health" >/dev/null || { echo "API não subiu"; tail -30 "$LOG"; exit 1; }
set +e
BASE="http://localhost:$PORTA" PGDB="$DB" bash scripts/smoke.sh
STATUS=$?
set -e
if grep -q 'smoke-sem-rede: conexão recusada' "$LOG"; then
  echo "A BARREIRA DE REDE BARROU CONEXÃO NA API DO SMOKE:"; grep 'smoke-sem-rede' "$LOG"; exit 1
fi
echo "barreira de rede: nenhuma conexão externa tentada pela API do smoke"
exit $STATUS
