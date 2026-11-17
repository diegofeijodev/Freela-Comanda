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

LOG=$(mktemp)
DATABASE_URL="$URL" PORT=$PORTA NODE_OPTIONS=--max-old-space-size=600 ANTHROPIC_API_KEY= \
  CERTIFICADO_SECRET=smoke-certificado-segredo-de-teste-0123456789 \
  setsid npx ts-node --transpile-only -r tsconfig-paths/register src/main.ts >"$LOG" 2>&1 &
API_PID=$!
trap 'kill -- -$API_PID 2>/dev/null || kill $API_PID 2>/dev/null || true' EXIT
for _ in $(seq 1 90); do curl -sf "localhost:$PORTA/health" >/dev/null 2>&1 && break; sleep 1; done
curl -sf "localhost:$PORTA/health" >/dev/null || { echo "API não subiu"; tail -30 "$LOG"; exit 1; }
BASE="http://localhost:$PORTA" PGDB="$DB" bash scripts/smoke.sh
