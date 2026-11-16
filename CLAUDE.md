# CLAUDE.md — Freela ERP

Projeto independente dentro do workspace Freela (repo git próprio, branch `master`; remote `origin` = github.com/diegofeijodev/Freela-ERP, branch `main`).
Nome do produto nas telas: **Freela Comanda** (domínio `freelacomanda.com.br`); nomes internos continuam `erp-freela`. Subida: `docs/deploy.md`. Port do app Lovable "Freela ERP"
(`erpfreela.zip`, TanStack Start + Supabase) para a stack do Freela: `api/` NestJS + Prisma + PostgreSQL, `web/` Next.js.
Especificação: `docs/superpowers/specs/2026-10-28-erp-freela-port-design.md`; progresso: `docs/superpowers/plans/2026-10-28-erp-freela-progresso.md`;
contrato: `docs/api-contract.md`. Protótipo de referência em `.prototype/` (gitignored, **só leitura**).

## Regras rápidas

- `api/` usa **npm**; `web/` usa **yarn**. Não misturar.
- Portas: API **3016**, web **3026**, Postgres **5440** (`docker compose up -d postgres` na raiz; contêiner `erp-freela-postgres`, user/senha/banco
  `erpfreela`, subrede `172.62.0.0/24`). 3000/5432 são do Freela; 3010–3015/3020–3025/5434–5439 dos outros ports. Smoke usa 3096, browser-check 3097.
- **Banco 1:1 com o Supabase do protótipo**: mesmos nomes de tabela/coluna (pt-BR, snake_case). O fio também é snake_case; o interceptor
  global `common/http/wire.ts` converte `numeric`→number, `date`→"AAAA-MM-DD", `time`→"HH:MM:SS". Coluna `date` nova = acrescentar o nome em `DATE_ONLY_KEYS`.
- **Regras de negócio ficam em SQL** (como no protótipo): views `v_fichas_resumo`, `v_saldo_teorico`, `v_consumo_semanal`, `v_cmv_periodo`;
  funções `saldo_item`, `estoque_objetivo`, `abrir_inventario`, `registrar_contagem`, `fechar_inventario`, `gerar_lista_compras`, `receber_lista`,
  `lancar_nota`, `recalcular_baixas`, `loja_*`; gatilho `vendas_baixa`. Mudou regra? Nova migração com `CREATE OR REPLACE`. A fórmula da ficha existe
  também em `web/src/lib/ficha.ts` — manter as duas iguais.
- **Permissão = marca em toda rota** (`@AdminOnly()` / `@Staff()` / `@Public()`), substituindo as políticas RLS. Rota sem marca = 403, e o teste
  `api/src/common/__tests__/permissoes-protecao.spec.ts` lista exatamente o que a loja alcança. A loja NUNCA pode ver teórico, custo, preço ou financeiro.
- Erros sempre `{ error: { code, message } }`, com a mesma mensagem pt-BR do protótipo. `raise exception` das funções vira 400 `REGRA` com o texto.
  No web, ler com `errMsg()` (`@/lib/db`) — nunca `error.message` do axios.
- Id da URL passa por `ParseUuidPipe` (malformado = 404). DTO com `whitelist + forbidNonWhitelisted`; rotas estáticas antes das `:id`.
- "Hoje" no servidor = `todaySp()`; o banco roda com `timezone = America/Sao_Paulo` (migração `regras`).
- Leitura de PDF e de foto (1–4 imagens) por IA só pela porta `LEITOR_PDF` (`modules/leitura-pdf`; rotas `notas/ler-pdf` e `notas/ler-foto`): nenhum teste faz rede; sem chave de IA = "Leitura de PDF/nota não configurada".
  A leitura nunca grava: insumo novo só nasce dentro da transação do "Dar entrada" (`POST /v1/notas`, `novo_insumo`).
- Certificado digital A1 (`api/src/modules/certificado-digital`, rotas `/v1/certificado-digital`): **nada de .pfx, senha, chave ou PEM vai para log, resposta ou erro** (só frases fixas e a impressão digital).
  Projetos futuros (SEFAZ, NFC-e) só chegam à chave pela porta `CERTIFICADO_DIGITAL` (`emUso()`); node-forge 1.4.3 só em `pkcs12.adapter.ts`; segredo `CERTIFICADO_SECRET` (sem fallback no `JWT_SECRET`).
  Os .pfx de `__tests__/fixtures/` são versionados e fictícios (`api/scripts/gerar-certificados-teste.sh`; pacote ICP: `api/scripts/atualizar-cadeia-icp.sh`); nenhum teste usa certificado real nem faz rede.
- Web: storage do navegador só em `modules/auth/infrastructure/auth.storage.ts` (sessão `authUser`) e `modules/inventario/infrastructure/rascunho.storage.ts`
  (rascunho da contagem). Telas são `'use client'`; `@/lib/erp-api.ts` é o único lugar com chamadas HTTP.

## Regras de baixo consumo (máquina do dono: 7,6 GB, outros projetos rodando)

1. **Nunca** `nest build` / `next build` numa tarefa comum.
2. Todo comando pesado vai por `scripts/run-capped.sh <teto-MB> <cmd>` (cgroup com `MemoryMax` + lock `.cache/heavy.lock`):
   jest/tsc/eslint 1500; smoke `api/scripts/smoke-capped.sh` 1300; browser-check `web/scripts/browser-check.sh` 2600. 137 = estourou o teto; 75 = sem memória agora.
3. jest sempre `npx jest --runInBand <arquivos>` (o `jest.config.js` tem `maxWorkers: 1`), nunca uma pasta inteira sem `--runInBand`.
4. Só UM de {jest, tsc, API, next dev, browser-check} por vez. Mate processos pelo PID (`ss -ltnp | grep :PORTA`), nunca `pkill -f`.

## Comandos

```bash
docker compose up -d postgres                # na raiz
# api/
npm run start:dev | start:smoke | typecheck | lint | test | seed
npm run prisma:migrate:deploy | prisma:generate
../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh        # smoke em banco descartável
# web/
yarn dev | typecheck | lint | test
../scripts/run-capped.sh 2600 bash scripts/browser-check.sh       # navegador headless, capturas em .cache/telas
```

Seed de dev: `admin@erpfreela.local` / `erpfreela123` (admin) e `loja@erpfreela.local` / `erpfreela123` (loja).
