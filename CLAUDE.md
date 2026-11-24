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
- Leitura de PDF e de foto (1–4 imagens) por IA só pela porta `LEITOR_PDF` (`modules/leitura-pdf`; rotas `notas/ler-pdf`, `notas/ler-foto` e `notas/sugerir-insumos`, esta só de texto: só descrição e unidade saem para a IA): nenhum teste faz rede; sem chave de IA = "Leitura de PDF/nota não configurada".
  A leitura nunca grava: insumo novo só nasce dentro da transação do "Dar entrada" (`POST /v1/notas`, `novo_insumo`).
- Certificado digital A1 (`api/src/modules/certificado-digital`, rotas `/v1/certificado-digital`): **nada de .pfx, senha, chave ou PEM vai para log, resposta ou erro** (só frases fixas e a impressão digital).
  Projetos futuros (SEFAZ, NFC-e) só chegam à chave pela porta `CERTIFICADO_DIGITAL` (`emUso()`); node-forge 1.4.3 só em `pkcs12.adapter.ts`; segredo `CERTIFICADO_SECRET` (sem fallback no `JWT_SECRET`).
  Os .pfx de `__tests__/fixtures/` são versionados e fictícios (`api/scripts/gerar-certificados-teste.sh`; pacote ICP: `api/scripts/atualizar-cadeia-icp.sh`); nenhum teste usa certificado real nem faz rede.
- Notas da SEFAZ (`api/src/modules/sefaz` = transporte SOAP 1.2 com mTLS, leitor de XML e porta `SEFAZ_DFE`; `modules/notas-sefaz` = agenda, ciclo, caixa e rotas `/v1/notas-sefaz`; aba "Notas da SEFAZ" na Entrada de Notas e painel em Configurações): tudo DESLIGADO por padrão: `SEFAZ_DFE_AMBIENTE` ausente/vazia = `desligado` (nada roda, nenhuma conexão) e a busca ainda precisa do botão "Ligar a busca" na tela; `producao` só com o "eu autorizo" do dono (valor desconhecido derruba a subida, de propósito). Nenhum teste faz rede (porta falsa, HTTPS local, `page.route`); o smoke tem a barreira `api/scripts/smoke-sem-rede.cjs` e o `browser-check.sh` força a variável vazia. `@xmldom/xmldom` 0.9.12 só em `xml-leitura.ts`; `ca` = raízes do Node + âncoras ICP, nunca o pacote.
  Nunca `@Header` de texto em rota que pode dar erro (o Fastify recusa objeto com content-type de texto e o 409/404 vira 500: ponha o cabeçalho depois, com `res.header`). Nunca `NODE_DEBUG=http|https|tls` em produção (imprime as opções do pedido).
- Respostas à SEFAZ (`modules/sefaz/assinatura-xml.ts` = `assinarXmlEnveloped`, interface fixa também da NFC-e; `eventos-xml.ts` + porta `SEFAZ_EVENTOS`; `notas-sefaz/respostas-*`): `SEFAZ_MANIFESTACAO` ausente = `desligada`, e ainda precisa do botão "Ligar as respostas"; `ligada` só depois do OK do contador e do "eu autorizo" do dono. "Dar entrada" nunca fala com a SEFAZ (a confirmação sai do tique). Evento gravado `enviando` com o XML antes de sair; 3 tentativas; um lote por tique. `xml-crypto` 6.4.0 só em devDependencies e `__tests__`.
- Cupom fiscal (NFC-e modelo 65; `api/src/modules/cupom-fiscal` + porta `SEFAZ_NFCE` em `modules/sefaz/nfce.*`; rotas `/v1/cupom-fiscal` em `docs/api-contract.md` §17; telas em `web/src/app/(app)/cupom` e Configurações → Cupom fiscal): pronto e DESLIGADO em duas chaves: `NFCE_AMBIENTE` ausente/vazia = `desligado` (emitir, enviar de novo, consultar, cancelar, descartar, testar e ligar/desligar dão 503 `NFCE_DESLIGADA`, nenhuma conexão sai; cupom do outro ambiente = 409 `NFCE_OUTRO_AMBIENTE`) e "Emitir cupons" de cada ambiente nasce `false`.
  `homologacao`/`producao` só com o "eu autorizo" do dono, na hora e por escrito; nenhum teste nem agente fala com a SEFAZ (nem homologação). NUNCA reenvio automático: só o clique em "Enviar de novo" (até 3 envios; o mesmo número); "enviado sem resposta" só consulta, nunca reenvia. O envelope SOAP vai com `envelope: 'sem_prefixo'` (nunca conferido na SEFAZ-SP; a volta conhecida é `prefixado`).
  Todo texto que vai ao XML passa por `textoFiscal` (`api/src/common/fiscal/texto-fiscal.ts`). Dinheiro no fio em centavos inteiros (`*_centavos`); o CSC só entra e só fica cifrado (`CERTIFICADO_SECRET`; a resposta traz `csc_dica`); CPF completo só no detalhe/DANFE (a lista mascara); chave, CSC e PEM nunca em log, resposta ou erro.
  `api/src/modules/cupom-fiscal/totais.ts` e `web/src/lib/cupom.ts` existem em cópia (como `ficha.ts` e `fiscal.ts`) — mudar um = mudar o outro. Não mexer em `sefaz/eventos*.ts`, `assinatura-xml.ts` e `transporte-soap12.ts` por causa do cupom (só importar).
- Frases da nota repetida: `api/src/common/fiscal/nota-repetida.ts` e `web/src/lib/nota-repetida.ts` existem em cópia — mudar uma = mudar a outra.
- CNPJ e chave: `api/src/common/fiscal` e `web/src/lib/fiscal.ts` iguais (como a ficha); normalizar = maiúsculas + `[0-9A-Z]`, nunca `\D` (só a linha digitável do DDA).
- Ponto (`api/src/modules/ponto`, rotas `/v1/ponto` em `docs/api-contract.md` §18, tela `web/src/app/(app)/ponto`): a loja só alcança as 4 rotas do terminal,
  e elas exigem o cabeçalho `X-Ponto-Terminal` de um terminal ativo (liberado pelo admin no próprio computador da loja; banco guarda só o SHA-256) + PIN do colaborador.
  Erro de PIN é 400 (nunca 401, que derruba a sessão). Batida nunca é apagada: corrigir = anular com motivo + manual com `substitui_id`. A hora da batida é a do servidor.
  Exceção à "regra em SQL": o cálculo (horas, atraso, extras 50/100, noturno, abono) é a função pura `modules/ponto/calculo.ts` (testes em `__tests__/calculo.spec.ts`).
- Empresas (`api/src/modules/empresas`, rotas `/v1/empresas` em `docs/api-contract.md` §19, tela `web/src/app/(app)/empresas`, só admin): no máximo uma `principal`,
  que espelha razão social, fantasia, CNPJ e endereço em `configuracoes` (o resto do sistema continua lendo de lá; com principal, Configurações mostra esses campos só para leitura).
- Importar vendas de outros sistemas (`api/src/modules/importacoes/{planilha,documentos,previa,fatos-vendas}.ts` + `importacoes-vendas.service.ts`, rotas `/v1/importacoes/origens` e `/v1/importacoes/vendas/{previa,confirmar,recentes,ler-pdf}` em `docs/api-contract.md` §20, tela `web/src/app/(app)/vendas/importar`, só admin): o navegador lê o arquivo (planilha, XML/.zip, PDF já conferido) e o servidor converte e confere; **a prévia nunca grava**. O confirmar (e a rota antiga) é uma transação com `pg_advisory_xact_lock` (`TRAVA_IMPORTACAO_VENDAS`); a mesma `chave_idempotencia` com o mesmo corpo devolve o resultado guardado (200, `repetida`), com outro corpo 409. Substituir com linha com problema e vendas a apagar = 409 `SUBSTITUIR_COM_PROBLEMA` (nada apagado); XML cuja soma dos itens não bate com o vNF fica de fora ("com problema").
  "Substituir" apaga só a **mesma fonte** (planilha padrão = sem cupom, sem XML e sem sistema; sistema = `importacoes.origem_id`); nunca o cupom nem o XML. A venda de XML é projeção de `vendas_documentos` (imutável, gatilho): cancelar = `vendas_documento_cancelar` (apaga as vendas, marca `cancelada`). Dinheiro: Decimal no servidor, centavos nas respostas; número ambíguo da planilha ("12.90" no modo vírgula) é linha com problema, nunca palpite. A rota antiga `POST /v1/importacoes/vendas` é a planilha padrão (obsoleta, fica pelo smoke).
  O índice único `vendas_origens_nome_key` (em `lower(nome)`) **só existe na migração** `20261125120000_vendas_importacao` (o Prisma não escreve índice de expressão): um `prisma migrate dev` vai querer apagá-lo. Não aceite; é ele que segura o nome repetido na corrida (P2002 → 409 `ORIGEM_REPETIDA`). Os parciais do cupom (`nfce_cupons_numero_vivo`, `nfce_cupons_chave_viva`, `nfce_cupons_pendentes`) e `empresas_uma_principal` estão na mesma situação.
- Web: storage do navegador só em `modules/auth/infrastructure/auth.storage.ts` (sessão `authUser`), `modules/inventario/infrastructure/rascunho.storage.ts`
  (rascunho da contagem) e `modules/ponto/infrastructure/terminal.storage.ts` (token do terminal de ponto). Telas são `'use client'`; `@/lib/erp-api.ts` é o único lugar com chamadas HTTP.

## Regras de baixo consumo (máquina do dono: 7,6 GB, outros projetos rodando)

1. **Nunca** `nest build` / `next build` numa tarefa comum.
2. Todo comando pesado vai por `scripts/run-capped.sh <teto-MB> <cmd>` (cgroup com `MemoryMax` + lock `.cache/heavy.lock`):
   jest/tsc/eslint 1500; smoke `api/scripts/smoke-capped.sh` 1300; browser-check `web/scripts/browser-check.sh` 3300 (desde 17/11 ele morre com 2600; precisa de ~3 GB livres). 137 = estourou o teto; 75 = sem memória agora.
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
../scripts/run-capped.sh 3300 bash scripts/browser-check.sh       # navegador headless, capturas em .cache/telas
CHECK_SCRIPT=scripts/browser-check-importar-vendas.mjs ../scripts/run-capped.sh 2400 bash scripts/browser-check.sh   # só o grupo Importar vendas
```

Seed de dev: `admin@erpfreela.local` / `erpfreela123` (admin) e `loja@erpfreela.local` / `erpfreela123` (loja).
