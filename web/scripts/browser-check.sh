#!/usr/bin/env bash
# Conferência no navegador: banco DESCARTÁVEL (erpfreela_browser) + API na 3097 + `next dev` na 3026 + Playwright headless.
# Rode pelo teto:  ../scripts/run-capped.sh 2600 bash scripts/browser-check.sh     (em web/)
set -euo pipefail
WEB=$(cd "$(dirname "$0")/.." && pwd)
API="$WEB/../api"
PG=erp-freela-postgres
DB=erpfreela_browser
URL="postgresql://erpfreela:erpfreela@localhost:5440/$DB?schema=public"
SHOTS=${SHOTS:-$WEB/../.cache/telas}
mkdir -p "$SHOTS"

if ss -ltn | grep -q ':3026 '; then echo "a porta 3026 está ocupada (outro next dev?)"; exit 1; fi
docker exec "$PG" psql -U erpfreela -d erpfreela -qc "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null 2>&1
docker exec "$PG" psql -U erpfreela -d erpfreela -qc "CREATE DATABASE $DB" >/dev/null
(cd "$API" && DATABASE_URL="$URL" NODE_OPTIONS=--max-old-space-size=400 npx prisma migrate deploy >/dev/null)
(cd "$API" && DATABASE_URL="$URL" NODE_OPTIONS=--max-old-space-size=400 npx ts-node --transpile-only prisma/seed.ts)

PIDS=()
limpar() { for p in "${PIDS[@]}"; do kill -- -"$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done; }
trap limpar EXIT

(cd "$API" && DATABASE_URL="$URL" PORT=3097 CORS_ORIGINS=http://localhost:3026 ANTHROPIC_API_KEY= NODE_OPTIONS=--max-old-space-size=500 \
  setsid npx ts-node --transpile-only -r tsconfig-paths/register src/main.ts >"$SHOTS/api.log" 2>&1) &
PIDS+=($!)
(cd "$WEB" && NEXT_PUBLIC_API_URL=http://localhost:3097 NODE_OPTIONS=--max-old-space-size=1400 NEXT_TELEMETRY_DISABLED=1 \
  setsid npx next dev -p 3026 >"$SHOTS/web.log" 2>&1) &
PIDS+=($!)
for _ in $(seq 1 120); do curl -sf localhost:3097/health >/dev/null 2>&1 && break; sleep 1; done
for _ in $(seq 1 180); do curl -s -o /dev/null localhost:3026/auth && break; sleep 1; done
SHOTS="$SHOTS" BASE=http://localhost:3026 node "$WEB/scripts/browser-check.mjs"
