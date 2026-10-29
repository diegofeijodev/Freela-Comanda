# Freela ERP — port do Lovable para a stack do Freela (28/10/2026)

Origem: `~/Downloads/erpfreela.zip` (Lovable, TanStack Start + Supabase + Drizzle), cópia só-leitura em `.prototype/`.
Pedido do Denner (28/10, noite): "faça todos aqueles trâmites de tirar esse projeto do modelo Lovable, igual ao meu funil, praça etc."
O dono estava dormindo e pediu para seguir sozinho — as decisões abaixo foram tomadas sem perguntar e estão marcadas
**(reversível)** quando dá para voltar atrás sem migração de dados.

## O que o sistema é

ERP de UMA unidade de restaurante ("Chopp & Espeto Valinhos"): vendas importadas do PDV/iFood, fichas técnicas com custo e
preço sugerido, inventário com contagem CEGA (a loja nunca vê o estoque teórico), estoque teórico por movimentações, estoque
objetivo com sazonalidade, lista de compras gerada no fechamento do inventário, entrada de NF-e (XML exato / PDF por IA),
contas a pagar com conciliação de DDA, fechamento de caixa e DRE mensal. Dois perfis: `admin` e `loja`.

## Stack (igual aos outros ports)

| Parte | Escolha |
| --- | --- |
| `api/` | NestJS 11 + Fastify + Prisma 5.22 + PostgreSQL 16 (npm) |
| `web/` | Next.js 15 (App Router) + React 19 + Tailwind 4 + kit shadcn do protótipo (yarn) |
| Portas | API **3016**, web **3026**, Postgres **5440** (`erp-freela-postgres`, subrede `172.62.0.0/24`) |
| Auth | JWT próprio HS256 + bcrypt (tabela `users`), guard global, `@Public()` é exceção |

## Decisões

1. **Banco 1:1 com o Supabase.** Tabelas e colunas com os MESMOS nomes (snake_case, pt-BR); o wire também é snake_case. Isso
   deixa a migração de dados do Lovable (fase 2) virar "copiar linha por linha".
2. **Regras de negócio continuam em SQL** (é a regra de arquitetura do próprio protótipo — "a UI só chama as funções"):
   views `v_fichas_resumo`, `v_saldo_teorico`, `v_consumo_semanal`, `v_cmv_periodo`; funções `saldo_item`, `estoque_objetivo`,
   `abrir_inventario`, `registrar_contagem`, `fechar_inventario`, `gerar_lista_compras`, `receber_lista`, `lancar_nota`,
   `recalcular_baixas`; gatilho `vendas_baixa`. Mudança única: `auth.uid()` virou parâmetro `_usuario uuid` e as checagens
   `is_admin()/is_staff()` saíram do SQL — quem barra é a API (`@AdminOnly()` / `@Staff()`), antes de chamar a função.
   Os textos de `raise exception` voltam ao web como `{ error: { code: 'REGRA', message } }` (HTTP 400), iguais aos do Lovable.
3. **RLS → guards.** Cada rota tem marca de permissão; um teste percorre todas as rotas e falha se alguma de escrita ficar sem
   marca. A loja só alcança: configurações (leitura), subgrupos (leitura), inventários (lista/abrir quando `loja_pode_abrir`/
   itens cegos/registrar contagem), listas de compra (lista + itens sem preço) e fichas sem custo (`loja_fichas`).
4. **Contas.** Sem cadastro aberto: enquanto não existe admin, a tela de entrada oferece "Primeiro acesso? Criar conta de
   administrador" (igual ao protótipo); depois disso só o admin cria contas. **(reversível)**
5. **Sem e-mail transacional** (o Supabase mandava o link de "esqueci a senha"): "Esqueci minha senha" vira o aviso "peça ao
   administrador"; o admin redefine a senha em Usuários e cada pessoa troca a própria em `/trocar-senha`. **(reversível)**
6. **Leitura de PDF por IA** (NF e DDA): o protótipo usava o gateway da Lovable. Aqui: API da Anthropic (Claude, entrada de
   PDF nativa + saída em JSON pelo mesmo esquema do protótipo), atrás de uma porta injetável (`AI_PDF_READER`) — nenhum teste
   faz rede. Sem `ANTHROPIC_API_KEY` a resposta é a mesma do protótipo: "Leitura de PDF não configurada". Upload multipart
   de até 10 MB (o próprio protótipo dizia "máx. 10 MB"). **(reversível)**
7. **XML da NF-e, planilhas (xlsx/csv), CSV de saída, impressão e `prompt/confirm`** continuam no navegador, como no protótipo.
   Importações, entrada de nota, liquidação e de-para viraram UMA chamada transacional na API cada (no protótipo eram vários
   `insert` soltos do navegador — uma falha no meio deixava nota sem conta a pagar).
8. **Datas "só dia" em Brasília.** O banco recebe `ALTER DATABASE … SET timezone = 'America/Sao_Paulo'` (o `current_date` das
   views/funções passa a ser o de Brasília) e a API/web usam `todaySp()`.
9. **Rascunho da contagem** continua no `localStorage` do aparelho (chave `freela-rascunho-<inventário>`), num arquivo de
   storage próprio liberado no lint.
10. **Tema/design idênticos** (preto #111 + dourado, Fraunces + Manrope via `next/font`), mesmas rotas (`/painel`, `/fichas/[id]`,
    `/inventario/[id]`, `/compras/[id]` …), mesmos textos.

## Correções silenciosas (bugs do protótipo que o port não copia)

- Caixa/DRE filtravam o mês com `<= 'AAAA-MM-31'` — em meses de 30 dias (e fevereiro) o Postgres recusa a data e a tela quebra.
  A API recebe `mes=AAAA-MM` e calcula o último dia.
- Entrada de nota em vários passos soltos → uma transação (ver 7).

## Fora do escopo desta leva (pendências do dono)

- **Migração dos dados do Lovable** (fichas, insumos, inventários, vendas de Valinhos): precisa de uma exportação feita de dentro
  do Lovable (como no Meu Funil, 06/10). Como as tabelas são iguais, o importador é direto. Até lá, a tela Importar Dados aceita
  as mesmas planilhas de insumos/fichas/vendas.
- GitHub (repo/branch `stack-freela`), deploy (EC2 + Vercel), DNS, chave da Anthropic.
