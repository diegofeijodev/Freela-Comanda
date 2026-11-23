# Freela ERP — plano e progresso (retomada)

Spec: `docs/superpowers/specs/2026-10-28-erp-freela-port-design.md`. Um commit por etapa; se a sessão cair, retome pela
primeira caixa vazia. Verificação SEMPRE por `scripts/run-capped.sh` (máquina de 7,6 GB).

- [x] 1. Esqueleto: repo, `.prototype/`, docker-compose, CLAUDE.md, spec, este arquivo
- [x] 2. API base: package.json, configs, common (env, filtro, guards, wire, datas), Prisma schema + migração SQL, seed
- [x] 3. `npm install` (capped) + `prisma migrate dev` no Postgres local
- [x] 4. API módulos: auth/usuarios, configuracoes, cadastros (subgrupos, fornecedores, plano de contas, centros, DRE),
      itens de estoque/movimentações, cardápio/fichas, vendas, inventários, listas de compra, notas/vínculos, contas a pagar,
      caixa, importações/de-para, leitura de PDF
- [x] 5. Testes jest (regras puras + proteção de rotas) e smoke (curl contra a API + banco local)
- [x] 6. Web base: package.json, configs, kit ui, globals.css, http/auth, layout (app)
- [x] 7. Web telas (1:1 com o protótipo)
- [x] 8. `yarn install` (capped), vitest, typecheck, lint
- [x] 9. Conferência no navegador (headless, um grupo por vez)
- [x] 10. Docs finais (README, api-contract, deploy), docker-compose.prod.yml, Dockerfile, memória

## Estado
- 28/10 ~22h40: API completa. Smoke `api/scripts/smoke-capped.sh` = 165/0 (banco descartável `erpfreela_smoke`, API na 3096);
  jest 6 suítes/25; `tsc --noEmit` limpo. Próximo: web.
- 28/10 ~22h50: web completo (16 telas + entrada/troca de senha). vitest 7/31, tsc e eslint limpos (web e API). Próximo: navegador.
- 28/10 ~23h: browser-check 68/0 (admin desktop + loja celular, nota por XML, inventário cego, caixa; sem erro de console). Docs e roteiro de deploy prontos. Falta só o que depende do dono (README, 'Pendências').
- 23/11: aba **Ponto** (migração `20261123120000_ponto`, módulo `api/src/modules/ponto`, tela `/ponto`): terminal só no computador liberado
  (token + PIN), batidas com justificativa de atraso/saída antecipada/falta, cadastro de colaboradores, escalas, folgas/feriados, ajustes e
  correções auditadas, cálculo (extras 50/100, noturno, abono) e exportação Excel/PDF. jest 66/2059, vitest 16/298, tsc e eslint limpos;
  conferido no navegador (loja bloqueada sem liberação, liberação, PIN, batida, justificativa, espelho, ajuste, Excel e PDF).
- 23/11: cadastro de **Empresas** (migração `20261124120000_empresas`, módulo `api/src/modules/empresas`, tela `/empresas`, admin): dados completos
  (CNPJ, inscrições, regime, endereço com IBGE, contatos, responsável, contador); a principal espelha em `configuracoes`; colaborador do ponto ganha
  empresa empregadora (sai no PDF/Excel). jest 67/2064, vitest 16/298, tsc e eslint limpos; conferido no navegador.
