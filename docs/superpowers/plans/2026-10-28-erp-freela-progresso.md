# Freela ERP — plano e progresso (retomada)

Spec: `docs/superpowers/specs/2026-10-28-erp-freela-port-design.md`. Um commit por etapa; se a sessão cair, retome pela
primeira caixa vazia. Verificação SEMPRE por `scripts/run-capped.sh` (máquina de 7,6 GB).

- [ ] 1. Esqueleto: repo, `.prototype/`, docker-compose, CLAUDE.md, spec, este arquivo
- [ ] 2. API base: package.json, configs, common (env, filtro, guards, wire, datas), Prisma schema + migração SQL, seed
- [ ] 3. `npm install` (capped) + `prisma migrate dev` no Postgres local
- [ ] 4. API módulos: auth/usuarios, configuracoes, cadastros (subgrupos, fornecedores, plano de contas, centros, DRE),
      itens de estoque/movimentações, cardápio/fichas, vendas, inventários, listas de compra, notas/vínculos, contas a pagar,
      caixa, importações/de-para, leitura de PDF
- [ ] 5. Testes jest (regras puras + proteção de rotas) e smoke (curl contra a API + banco local)
- [ ] 6. Web base: package.json, configs, kit ui, globals.css, http/auth, layout (app)
- [ ] 7. Web telas (1:1 com o protótipo)
- [ ] 8. `yarn install` (capped), vitest, typecheck, lint
- [ ] 9. Conferência no navegador (headless, um grupo por vez)
- [ ] 10. Docs finais (README, api-contract, deploy), docker-compose.prod.yml, Dockerfile, memória
