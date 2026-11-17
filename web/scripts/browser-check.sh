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
# `setsid` direto (sem subshell): o PID devolvido lidera o próprio grupo, e `kill -- -PID` derruba a árvore inteira
# (npx → node → workers do next). A varredura por porta no fim pega qualquer sobra.
limpar() {
  for p in "${PIDS[@]}"; do kill -- -"$p" 2>/dev/null || kill "$p" 2>/dev/null || true; done
  sleep 1
  for porta in 3026 3097; do
    for p in $(ss -ltnp 2>/dev/null | grep ":$porta " | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do kill "$p" 2>/dev/null || true; done
  done
}
trap limpar EXIT

cd "$API"
DATABASE_URL="$URL" PORT=3097 CORS_ORIGINS=http://localhost:3026 ANTHROPIC_API_KEY= SEFAZ_DFE_AMBIENTE= SEFAZ_MANIFESTACAO= NFCE_AMBIENTE= CERTIFICADO_SECRET=browser-certificado-segredo-de-teste-0123456789 NODE_OPTIONS=--max-old-space-size=500 \
  setsid npx ts-node --transpile-only -r tsconfig-paths/register src/main.ts >"$SHOTS/api.log" 2>&1 &
PIDS+=($!)
cd "$WEB"
NEXT_PUBLIC_API_URL=http://localhost:3097 NODE_OPTIONS=--max-old-space-size=1400 NEXT_TELEMETRY_DISABLED=1 \
  setsid npx next dev -p 3026 >"$SHOTS/web.log" 2>&1 &
PIDS+=($!)
for _ in $(seq 1 120); do curl -sf localhost:3097/health >/dev/null 2>&1 && break; sleep 1; done
for _ in $(seq 1 180); do curl -s -o /dev/null localhost:3026/auth && break; sleep 1; done
# Aquece as rotas: no `next dev` a 1ª visita compila a rota e o Fast Refresh aborta a navegação que estava em curso (o login
# parava em /auth com a sessão já gravada). Em produção tudo vem compilado e isso não acontece.
Z=00000000-0000-4000-8000-000000000000
for r in / /auth /trocar-senha /painel /vendas /fichas /fichas/$Z /inventario /inventario/$Z /estoque /objetivo /compras /compras/$Z \
  /notas /contas /caixa /dre /importar /configuracoes /usuarios; do
  curl -s -o /dev/null --max-time 180 "localhost:3026$r" || true
done
SHOTS="$SHOTS" BASE=http://localhost:3026 node "${CHECK_SCRIPT:-$WEB/scripts/browser-check.mjs}"
