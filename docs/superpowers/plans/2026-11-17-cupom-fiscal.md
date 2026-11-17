# Cupom fiscal (NFC-e modelo 65), tela simples — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O admin emite, consulta, cancela e imprime NFC-e (modelo 65) pelo Comanda. Tudo vem desligado de fábrica, e a numeração, as travas do 656 e a venda no estoque já ficam prontas para a fase "trocar o caixa".

**Architecture:**
- **Infraestrutura, `api/src/modules/sefaz/`:** porta `SEFAZ_NFCE`, com adaptador e falso, sobre o `chamarSoap12` que já existe (`envelope: 'sem_prefixo'`); a assinatura é a de `assinatura-xml.ts`.
- **Aplicação, `api/src/modules/cupom-fiscal/`:**
  - funções puras: `totais`, `validacao-fiscal`, `montagem-xml`, `qrcode-nfce`, `evento-cancelamento`, `retornos`, `travas`, `situacao-cupom`, `danfe` e `zip`;
  - quatro serviços: cadastro, emissão (T1 → rede → T2 → T3), cancelamento e leitura;
  - rotas `/v1/cupom-fiscal/*`, todas de admin.
- **Banco:** migração `nfce`, com as tabelas, os gatilhos de imutável e as funções SQL `nfce_lancar_venda` e `nfce_desfazer_venda`; mais a coluna `vendas.nfce_cupom_id`.
- **Web:** menu "Cupom Fiscal" (abas Emitir, Emitidos e Produtos), página do cupom, DANFE de 80 mm e painel em Configurações. As regras puras ficam em `web/src/lib/cupom.ts`.

**Tech Stack:** NestJS 11 + Fastify + Prisma 5/PostgreSQL (api, npm) · `node:crypto`, `node:zlib` · `@xmldom/xmldom` 0.9.12 (já instalado) · `xml-crypto` 6.4.0 (já em devDependencies, só oráculo) · Next 15 + TanStack Query + Radix (web, yarn) · `qrcode-generator` (nova, só no web) · jest, vitest, smoke em bash, browser-check (Playwright).

**Spec:** `docs/superpowers/specs/2026-11-17-cupom-fiscal-design.md` (vale em conflito; §11 = respostas à UX) e `docs/superpowers/specs/2026-11-17-cupom-fiscal-ux.md` (telas e textos; onde a UX fixa um texto, ele vale literalmente). Fatos da SEFAZ: `docs/superpowers/specs/2026-11-17-pesquisa-ciencia-e-nfce.md`, Parte B.

## Global Constraints

- **Ramo e commits:**
  - ramo `feat/cupom-fiscal`, criado na Task 1;
  - um commit por tarefa, com `git add` só dos arquivos da tarefa;
  - mensagem terminando em `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`;
  - sem push e sem deploy.
- **Arquivos da entrega 3:** não alterar `api/src/modules/sefaz/eventos*.ts`, `assinatura-xml.ts` nem `transporte-soap12.ts`; só importar deles.
- **NENHUMA chamada à SEFAZ, nem de homologação, em teste nenhum:** nem handshake, nem `?wsdl`, nem `openssl s_client`.
- **Nenhum teste faz rede:** porta falsa (`SefazNfceFalso`) e `page.route` no navegador.
- **Certificados só fictícios** (`api/scripts/gerar-certificados-teste.sh`, carregados por `api/src/modules/sefaz/__tests__/certificado-teste.ts`). CSC de teste: `CSC_TESTE = 'CSCTESTE0123456789ABCDEF'` (24 caracteres), IdCSC 1.
- **Tudo desligado por padrão, com duas travas:**
  - `NFCE_AMBIENTE` ausente ou vazia = `desligado`;
  - o interruptor "Emitir cupons" de cada ambiente nasce `false`;
  - `producao` só com o "eu autorizo" do dono, fora deste plano.
- **Nunca reenvio automático.** Toda chamada à SEFAZ nasce de um clique, sob as travas da §4.4 do desenho:
  - 10 recusas e 20 consultas por hora no ambiente;
  - consulta só 2 min depois do envio, e no máximo uma a cada 2 min por chave;
  - status uma vez a cada 5 min;
  - 656 = nenhuma chamada por 65 min; o 2º 656 em 24 h = `parada_656`;
  - 3 envios por cupom.
- **A loja não alcança rota nova:** todas as rotas são `@AdminOnly()`, e a lista da loja em `api/src/common/__tests__/permissoes-protecao.spec.ts` não muda.
- **O que nunca vai para log, resposta ou erro:** CSC, chave privada, PEM e CPF completo. O XML só sai pela rota própria.
  - O CSC é cifrado com `cifrar(…, CERTIFICADO_SECRET, 'nfce-csc')` de `common/cripto/cripto.ts`, e só os 4 últimos caracteres voltam (`csc_dica`).
- **Dinheiro e números:**
  - centavos em `bigint` no domínio; `numeric(15,2)` no banco;
  - no XML, texto formatado a partir de inteiros, nunca `number` com casas;
  - `n_prot` como texto (até 17 dígitos); `c_stat` de até 4 dígitos.
- **Assinatura e envio:**
  - assinar só por `assinarXmlEnveloped`;
  - enviar sempre com `envelope: 'sem_prefixo'`;
  - todo texto livre passa por `textoFiscal()` antes de assinar (U+0085, U+2028 e U+2029 viram espaço).
- **Sem dependência nova na API.** No web, só `qrcode-generator`, com versão exata (`yarn add --exact`), importada em um arquivo só.
- **Erros:** `{ error: { code, message } }`; no web, ler com `errMsg()`.
- **Frases (fonte única):**
  - o servidor manda o texto final das tabelas **6.1 e 6.2 da UX**, literalmente, com hora no formato `14h05` (Brasília);
  - a §5.3 e a §8.4 do desenho dão só o código e o status;
  - frase que a UX não fixa segue a UX §6.3: "não confere" em vez de "inválido", "modo de teste" e "valendo", "caixa de hoje".
- **Dinheiro no fio:**
  - nas rotas do cupom, centavos inteiros (JSON `number`), com o sufixo `_centavos`, nos dois sentidos (desenho §8.2);
  - o serviço nunca devolve `Decimal` de dinheiro;
  - o DANFE devolve os valores como texto do XML ("24.00");
  - na tela, centavos viram `bigint` com `BigInt(n)`.
- **Comandos pesados:**
  - sempre por `scripts/run-capped.sh`, com tetos jest/tsc/eslint 1500, smoke 1300 e browser-check 3300;
  - um por vez; jest sempre `npx jest --runInBand <arquivos>`;
  - nunca `nest build` nem `next build`.

## Review Focus

1. **Quantidade "0,350", "0", "-1" ou "1.23456".** O servidor recusa com frase (400 `VALIDATION_ERROR`, "Quantidade com até 4 casas, ponto como separador e maior que zero."), e a tela converte a vírgula antes de enviar. Testes nas Tasks 4 e 11.
2. **Preço do cardápio com 3 casas ("12.345").**
   - O servidor arredonda uma vez só (metade para cima): `GET /produtos` devolve `preco_venda_centavos = 1235`.
   - A tela soma esses centavos com a mesma `calcularTotais`, e o `total_esperado_centavos` bate.
   - Testes nas Tasks 4, 10 e 11.
3. **Nome de produto com `&`, `<`, aspas, emoji ou U+2028.** O XML sai escapado, U+2028 vira espaço, a assinatura passa e o DANFE mostra o nome legível. Testes nas Tasks 6 e 13.
4. **Virada do mês entre o envio e o reenvio (31/01 23:58 → 01/02 00:03).** Mesmo número e mesmo `cNF`, chave com o AAMM novo, sem 539. Teste na Task 11.
5. **Produto desativado ou perfil trocado entre a tela e o envio.** Erro 422 `NFCE_ITEM_INDISPONIVEL` antes da T1: nenhum número reservado e a porta não é chamada. Teste na Task 11.

---

### Task 1: Ramo e linha de base

**Files:** nenhum arquivo do projeto.

- [ ] **Step 1:** conferir que a entrega 3 fechou.
  - A última tarefa de `docs/superpowers/plans/2026-11-17-notas-sefaz-entrega-3.md` está commitada.
  - `git status --short api/src/modules/sefaz` sai vazio.
  - Se ainda houver arquivo modificado ali, PARAR e avisar o coordenador.
- [ ] **Step 2:** `git switch -c feat/cupom-fiscal feat/notas-sefaz`.
- [ ] **Step 3:** linha de base.
  - Rodar `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/sefaz src/common`.
  - Esperado: PASS. O que já falhava fica anotado no commit da Task 17, sem ser corrigido aqui.
- [ ] **Step 4:** `ls api/prisma/migrations | tail -2`.
  - O nome da migração do cupom é `20261119120000_nfce`.
  - Se a última for igual ou maior, usar o dia seguinte e substituir o nome em todo o plano.

### Task 2: Peças fiscais comuns (chave, CPF, GTIN, texto)

**Files:**
- Modify: `api/src/common/fiscal/chave-acesso.ts`
- Create: `api/src/common/fiscal/documentos.ts`
- Create: `api/src/common/fiscal/texto-fiscal.ts`
- Modify: `web/src/lib/fiscal.ts` (acrescenta `gtinValido` e `mascararCpf`; o `cpfValido` já existe)
- Test: `api/src/common/fiscal/__tests__/nfce-comum.spec.ts`
- Test: `web/src/lib/__tests__/fiscal.spec.ts`

**Interfaces:**
- Produces:
  - `montarChaveNfce(p: { aamm: string; cnpj: string; serie: number; numero: number; tpEmis: 1 | 9; cNF: string }): string` (UF 35, modelo 65, DV pelo `dvChave` que já existe);
  - `cpfValido(c: string): boolean`;
  - `mascararCpf(c: string): string`;
  - `gtinValido(g: string): boolean` (8, 12, 13 ou 14 dígitos, DV módulo 10);
  - `textoFiscal(s: string, max: number): string`.

- [ ] **Step 1: testes**

```ts
const c = montarChaveNfce({ aamm: '2611', cnpj: '12ABC34501DE35', serie: 2, numero: 12, tpEmis: 1, cNF: '40213377' });
expect(chaveValida(c)).toBe(true);
expect(partesDaChave(c)).toMatchObject({ uf: '35', aamm: '2611', modelo: '65', serie: '2', numero: '12' });
expect(c.slice(34, 35)).toBe('1'); expect(c.slice(35, 43)).toBe('40213377');
expect(cpfValido('52998224725')).toBe(true); expect(cpfValido('52998224726')).toBe(false); expect(cpfValido('11111111111')).toBe(false);
expect(mascararCpf('52998224725')).toBe('***.982.247-**');
expect(gtinValido('7891000315507')).toBe(true); expect(gtinValido('7891000315508')).toBe(false);
expect(textoFiscal('Chopp 300\u0085ml\u0007  ', 120)).toBe('Chopp 300 ml');
expect(textoFiscal('a'.repeat(130), 120)).toHaveLength(120);
```
  - O web repete `gtinValido` e `mascararCpf`, com os mesmos vetores.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/common/fiscal/__tests__/nfce-comum.spec.ts`. Esperado: FAIL (função não existe).
- [ ] **Step 3:** implementar.
  - `textoFiscal`: troca `[\u0085  ]` por espaço, tira `[\u0000-\u001F\u007F]`, junta espaços, apara e corta em `max` caracteres (`Array.from`).
- [ ] **Step 4:** rodar o jest acima e `cd web && ../scripts/run-capped.sh 1500 yarn vitest run src/lib/__tests__/fiscal.spec.ts`. Esperado: PASS.
- [ ] **Step 5:** commit `feat(fiscal): chave da NFC-e, CPF, GTIN e texto fiscal (U+2028 vira espaço)`.

### Task 3: Migração `nfce`, Prisma, importador e `NFCE_AMBIENTE`

**Files:**
- Create: `api/prisma/migrations/20261119120000_nfce/migration.sql`
- Modify: `api/prisma/schema.prisma` (9 modelos novos + `vendas.nfce_cupom_id`)
- Modify: `api/src/scripts/import-lovable/esquema.ts`:
  - `TABELAS_SO_NOSSAS` += `nfce_emitente`, `nfce_ambientes`, `nfce_ambientes_historico`, `nfce_perfis_fiscais`, `nfce_itens`, `nfce_cupons`, `nfce_cupom_itens`, `nfce_cupom_pagamentos`, `nfce_envios`;
  - `COLUNAS_SO_NOSSAS.vendas = ['nfce_cupom_id']`.
- Modify: `api/src/common/config/env.validation.ts`, `docker-compose.prod.yml` (`NFCE_AMBIENTE: ${NFCE_AMBIENTE:-}`), `api/.env.example`, `web/scripts/browser-check.sh` (`NFCE_AMBIENTE=`) e `api/scripts/smoke-capped.sh` (`NFCE_AMBIENTE=homologacao` na API do smoke + chamada do script novo).
- Create: `api/scripts/nfce-banco.ts`, que segue o molde de `ciclo-sefaz-banco.ts`: só roda no banco `erpfreela_smoke` e apaga o que criou.
- Test: `api/src/common/config/__tests__/env-nfce.spec.ts`

**Interfaces:**
- Produces:
  - tabelas e colunas exatamente as da §8.1 do desenho (com `pedido_hash`, `lanca_venda`, `nome_cardapio`, `venda_*`, `cancelamento_pedido_em`, `numero_reaproveitavel`);
  - sequência `nfce_id_lote_seq`;
  - linhas semeadas: `nfce_emitente` com `id = 1`, e `nfce_ambientes` para `homologacao` e `producao`, com `serie` nula, `proximo_numero = 1` e `emissao_ligada = false`;
  - SQL `nfce_lancar_venda(_cupom uuid) RETURNS int` e `nfce_desfazer_venda(_cupom uuid) RETURNS int` (quantas linhas);
  - gatilhos `nfce_cupons_imutavel` e `nfce_filhos_imutaveis`;
  - `Env['NFCE_AMBIENTE']: 'desligado' | 'homologacao' | 'producao'`.
- Comentários de obsoleto (`COMMENT ON COLUMN itens_cardapio.ncm|cfop|cst|aliquota IS 'DEPRECATED: dados do cupom em nfce_itens'`).
- A migração copia para `nfce_itens` o `ncm` que casa com `^[0-9]{8}$`.

- [ ] **Step 1: testes**
  - jest: `validateEnv({...base})` dá `NFCE_AMBIENTE` = `'desligado'`, e com `''` também; `'teste'` lança erro.
  - `nfce-banco.ts`: cada checagem conta um "ok" e falha com `process.exit(1)`.
    - Estrutura:
      - série 890 e `proximo_numero` 0 são recusados;
      - dois cupons vivos com o mesmo (ambiente, série, número) dão violação única, e um `descartado` + um vivo passam.
    - Gatilhos:
      - `UPDATE nfce_cupons SET valor_total = 1` num `autorizado` lança erro;
      - `DELETE` lança erro;
      - `autorizado → cancelando → cancelado` passa;
      - item novo em cupom autorizado lança erro.
    - Funções da venda:
      - cupom de produção `autorizado` com `lanca_venda`, com 2 linhas do mesmo item, gera 1 linha em `vendas` (quantidade somada, `pedido = 'NFC-e 2-12'`) e as `movimentacoes` `baixa_venda`;
      - a 2ª chamada devolve 0;
      - cupom de homologação lança erro;
      - `nfce_desfazer_venda` apaga a venda e as movimentações.
- [ ] **Step 2:** rodar o jest do env. Esperado: FAIL.
- [ ] **Step 3:** escrever a migração (CHECKs, índices e gatilhos da §8.1), o `schema.prisma`, o env e os arquivos de subida; depois `cd api && npm run prisma:generate`.
- [ ] **Step 4:** jest PASS; `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/scripts/import-lovable` PASS; `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh` mostra os "ok" do `nfce-banco.ts` e termina sem erro.
- [ ] **Step 5:** commit `feat(nfce): migração, gatilhos de imutável, venda pela função SQL e NFCE_AMBIENTE desligada`.

### Task 4: Totais em centavos (api e web)

**Files:**
- Create: `api/src/modules/cupom-fiscal/totais.ts`
- Create: `web/src/lib/cupom.ts` (cópia de `totais.ts`; mudar um = mudar o outro)
- Test: `api/src/modules/cupom-fiscal/__tests__/totais.spec.ts`
- Test: `web/src/lib/__tests__/cupom.spec.ts` (os mesmos casos)

**Interfaces:**
- Produces:
  - `type TPag = '01' | '03' | '04' | '10' | '11' | '17'`;
  - `quantidadeValida(q: string): boolean` (`^\d{1,7}(\.\d{1,4})?$` e > 0);
  - `precoCentavos(preco: string): bigint` (metade para cima);
  - `valorItemCentavos(q: string, preco: bigint): bigint`;
  - `ratearDesconto(valores: bigint[], desconto: bigint): bigint[]` (piso proporcional; a sobra vai, de 1 em 1 centavo, para os maiores valores);
  - `calcularTotais(itens: { quantidade: string; precoCentavos: bigint }[], desconto: bigint, pagamentos: { tPag: TPag; valor: bigint }[]): Totais | { erro: ErroTotais }`;
  - `Totais = { produtos: bigint; desconto: bigint; total: bigint; troco: bigint; itens: { bruto: bigint; desconto: bigint }[] }`;
  - `ErroTotais = 'SEM_ITENS' | 'DESCONTO_INVALIDO' | 'PAGAMENTO_INSUFICIENTE' | 'TROCO_INVALIDO' | 'VALOR_MAXIMO'`;
  - `decimal2(c: bigint): string` e `decimal4(q: string): string`.

- [ ] **Step 1: testes**

```ts
expect(quantidadeValida('0,350')).toBe(false); expect(quantidadeValida('0')).toBe(false);
expect(quantidadeValida('1.23456')).toBe(false); expect(quantidadeValida('0.350')).toBe(true);
expect(precoCentavos('12.345')).toBe(1235n); expect(precoCentavos('9.9')).toBe(990n);
expect(valorItemCentavos('0.3335', 1000n)).toBe(334n);
expect(ratearDesconto([2400n, 2970n], 370n)).toEqual([165n, 205n]);
const t = calcularTotais([{ quantidade: '2', precoCentavos: 1200n }, { quantidade: '3', precoCentavos: 990n }], 370n, [{ tPag: '01', valor: 6000n }]);
expect(t).toMatchObject({ produtos: 5370n, total: 5000n, troco: 1000n });
expect(calcularTotais(i, 0n, [{ tPag: '17', valor: 6000n }])).toEqual({ erro: 'TROCO_INVALIDO' });
expect(calcularTotais(i, 0n, [{ tPag: '01', valor: 1000n }, { tPag: '17', valor: 5500n }])).toEqual({ erro: 'TROCO_INVALIDO' });
expect(calcularTotais(i, 5370n, p)).toEqual({ erro: 'DESCONTO_INVALIDO' });
expect(calcularTotais([{ quantidade: '1', precoCentavos: 20_000_000n }], 0n, p)).toEqual({ erro: 'VALOR_MAXIMO' });
expect(decimal2(2400n)).toBe('24.00'); expect(decimal4('2')).toBe('2.0000');
```
- [ ] **Step 2:** jest e vitest (comandos da Task 2, com estes arquivos). Esperado: FAIL.
- [ ] **Step 3:** implementar em `bigint`.
  - As checagens seguem esta ordem: `SEM_ITENS`, `DESCONTO_INVALIDO` (desconto ≥ produtos), `VALOR_MAXIMO` (`total ≥ 20_000_000n`, R$ 200.000,00), `PAGAMENTO_INSUFICIENTE` e `TROCO_INVALIDO`.
  - O troco é válido só se `troco ≤ soma paga em '01'`.
- [ ] **Step 4:** os dois PASS.
- [ ] **Step 5:** commit `feat(cupom-fiscal): totais, rateio do desconto e troco em centavos (api e web iguais)`.

### Task 5: Validação fiscal (perfil, regime, produto pronto)

**Files:**
- Create: `api/src/modules/cupom-fiscal/validacao-fiscal.ts`
- Test: `api/src/modules/cupom-fiscal/__tests__/validacao-fiscal.spec.ts`

**Interfaces:**
- Produces:
  - `type Crt = 1 | 2 | 3 | 4`;
  - `interface PerfilFiscal { cfop: string; csosn: string | null; cst_icms: string | null; aliq_icms: string | null; pis_cst: string | null; cofins_cst: string | null; c_ativ_sn: string | null; ibs_sn_aliq: string | null; cbs_sn_aliq: string | null; ibscbs_cst: string | null; ibscbs_cclass_trib: string | null; ativo: boolean }`;
  - `erroDoPerfil(p: PerfilFiscal, crt: Crt | null): string | null`: com `crt` nulo (regime ainda não cadastrado), aceita CSOSN ou CST;
  - `perfilValeNoRegime(p: PerfilFiscal, crt: Crt): boolean`;
  - `type MotivoProduto = 'falta_ncm' | 'falta_perfil' | 'sem_preco' | 'inativo' | 'perfil_inativo' | 'perfil_fora_do_regime'`;
  - `motivosDoProduto(i: { ativo: boolean; preco_venda: string | null; ncm: string | null; perfil: PerfilFiscal | null }, crt: Crt | null): MotivoProduto[]`;
  - `erroDoItemFiscal(i: { ncm?: string | null; cest?: string | null; gtin?: string | null; origem?: number; descricao_cupom?: string | null; unidade?: string | null }): string | null`.

- [ ] **Step 1: testes**
  - As três primeiras frases são as da UX §6.2, literais.
  - As outras são novas, no estilo da UX §6.3; ao fechar a tarefa, entram em `frases.ts`.

```ts
expect(erroDoPerfil({ ...p, csosn: '500', cfop: '5102' }, 1)).toBe('O CSOSN 500 só vale com o CFOP 5.405.');
expect(erroDoPerfil({ ...p, csosn: null, cst_icms: '00' }, 1)).toBe('No Simples, escolha o CSOSN.');
expect(erroDoPerfil({ ...p, csosn: '102', cst_icms: null }, 3)).toBe('No regime normal, escolha o CST.');
expect(erroDoPerfil({ ...p, csosn: '102', cfop: '5405' }, 1)).toBe('O CSOSN 102 só vale com o tipo de venda (CFOP) 5.101, 5.102, 5.103, 5.104 ou 5.115.');
expect(erroDoPerfil({ ...p, csosn: '102', cst_icms: '00' }, null)).toBe('Escolha o CSOSN (Simples) ou o CST (regime normal), não os dois.');
expect(erroDoPerfil({ ...p, cfop: '5933' }, 1)).toBe('O tipo de venda (CFOP) 5.933 não entra no cupom.');
expect(perfilValeNoRegime({ ...p, csosn: '102' }, 3)).toBe(false);
expect(motivosDoProduto({ ativo: true, preco_venda: null, ncm: '2106909', perfil: null }, 1)).toEqual(['falta_ncm', 'falta_perfil', 'sem_preco']);
expect(motivosDoProduto({ ativo: true, preco_venda: '9.90', ncm: '22030000', perfil: { ...p, csosn: '102' } }, 3)).toEqual(['perfil_fora_do_regime']);
expect(erroDoItemFiscal({ gtin: '7891000315508' })).toBe('Este GTIN não confere. Confira os números ou deixe em branco (produto sem código de barras).');
```
- [ ] **Step 2:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/cupom-fiscal/__tests__/validacao-fiscal.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar com as listas da §3.2 do desenho:
  - CSOSN {102, 103, 300, 400, 500, 900}; CST {00, 20, 40, 41, 60, 90};
  - CFOP {5101, 5102, 5103, 5104, 5115, 5405, 5656, 5667};
  - formatos: NCM `^\d{8}$`, CEST `^\d{7}$`, origem 0–8, descrição até 120, unidade até 6;
  - `c_ativ_sn` `^\d{2}$`, `ibscbs_cst` `^\d{3}$`, `ibscbs_cclass_trib` `^\d{6}$`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(cupom-fiscal): regras do perfil fiscal, regime e produto pronto`.

### Task 6: QR Code v2 e montagem do XML da NFC-e

**Files:**
- Create: `api/src/modules/cupom-fiscal/qrcode-nfce.ts`
- Create: `api/src/modules/cupom-fiscal/montagem-xml.ts`
- Create: `api/src/modules/cupom-fiscal/__tests__/fixtures/nfe-homologacao-simples.xml` (modelo, sem assinatura)
- Test: `api/src/modules/cupom-fiscal/__tests__/montagem-xml.spec.ts`

**Interfaces:**
- Consumes: Task 2 e Task 4; `assinarXmlEnveloped`; `envelopeSoap12SemPrefixo`.
- Produces:
  - `URL_QR: Record<AmbienteSefaz, string>` e `URL_CHAVE: Record<AmbienteSefaz, string>`, com os valores da §5.6 do desenho;
  - `qrCodeV2(p: { chave: string; tpAmb: 1 | 2; idCsc: number; csc: string }): string`: hash SHA-1 em hex **maiúsculo** (*minha*; o padrão do esquema aceita os dois);
  - `interface DadosNfce { tpAmb: 1 | 2; chave: string; cNF: string; serie: number; numero: number; dhEmi: Date; natOp: string; emitente: EmitenteXml; consumidorDoc: string | null; itens: ItemXml[]; totais: Totais; pagamentos: { tPag: TPag; valor: bigint }[]; infCpl: string | null; respTec: RespTecXml | null }`;
  - `montarNfe(d: DadosNfce): string`: documento próprio `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe…" versao="4.00">`, sem assinatura;
  - `inserirSupl(nfeAssinada: string, qrCode: string, urlChave: string): string`;
  - `corpoEnviNfe(idLote: bigint, nfe: string): string`;
  - `montarNfeProc(nfe: string, protNFe: string): string`;
  - `VER_PROC = 'FreelaComanda 1.0'` e `XPROD_HOMOLOGACAO = 'NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL'`;
  - grupo do ICMS por código: 102/103/300/400 → `ICMSSN102`; 500 → `ICMSSN500`; 900 → `ICMSSN900`; CST 00 → `ICMS00`; 20 → `ICMS20`; 40/41 → `ICMS40`; 60 → `ICMS60`; 90 → `ICMS90`. Conferir no XSD 010h, se baixado.

- [ ] **Step 1: testes**
  - `montarNfe(dadosHomologacao)` é igual à fixture.
  - Valores e grupos:
    - `xProd` do item 1 = `XPROD_HOMOLOGACAO`;
    - `<vProd>24.00</vProd>` e `<qCom>2.0000</qCom>`;
    - `dhEmi` termina em `-03:00`;
    - sem `dhSaiEnt`, `IEST`, `IBSCBS` e `vTotTrib`;
    - `card` só em 03, 04 e 17, com `<tpIntegra>2</tpIntegra>`.
  - Texto: nome `Chopp & "Lager" <300> ml` sai escapado, com espaço no lugar do U+2028.
  - QR:
    - `qrCodeV2` casa com o padrão v2 on-line do esquema (`\?p=…\|2\|[1-2]\|(0|[1-9]([0-9]{1,5})?)\|[A-F0-9]{40}`);
    - o hash é igual a `createHash('sha1').update(chave + '|2|2|1' + CSC_TESTE).digest('hex').toUpperCase()`;
    - IdCSC `000001` vira `1`.
    - Esse teste repete a fórmula: ele prova a montagem da URL, não a fórmula. O oráculo externo do hash é o passo 2 do 1º teste em homologação (código do hash do QR).
    - Se o Manual DANFE v6.0 for baixado de novo (link na pesquisa), transcrever o exemplo das p. 26–27 como mais um vetor.
  - Montagem completa: depois de `assinarXmlEnveloped(nfe, 'NFe' + chave, cert)` + `inserirSupl`, a ordem dos filhos de `NFe` é `infNFe`, `infNFeSupl`, `Signature`.
  - **Oráculo:** o `xml-crypto` confere a assinatura do `infNFe` dentro de `envelopeSoap12SemPrefixo(corpoEnviNfe(1n, nfeCompleta))`, o envelope inteiro.
  - Opcional: se `xmllint` existir e `__tests__/fixtures/xsd/leiauteNFe_v4.00.xsd` estiver presente, `xmllint --schema` aceita a NFe. Para isso, baixar o 010h v1.03 (link na pesquisa). Essa rede acontece fora do teste, como o `yarn add` da Task 14; nenhum teste usa rede.
- [ ] **Step 2:** jest do arquivo. Esperado: FAIL.
- [ ] **Step 3:** implementar.
  - Os valores fixos do `ide`, `emit`, `dest`, `det`, `total`, `transp`, `pag`, `infAdic` e `infRespTec` saem da tabela da §5.2 do desenho.
  - Todo texto passa por `textoFiscal` e depois pelo escape de `& < > "`.
- [ ] **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(cupom-fiscal): XML da NFC-e, QR v2 e infNFeSupl depois da assinatura (conferida no envelope real)`.

### Task 7: Evento de cancelamento (110111)

**Files:**
- Create: `api/src/modules/cupom-fiscal/evento-cancelamento.ts`
- Test: `api/src/modules/cupom-fiscal/__tests__/evento-cancelamento.spec.ts`

**Interfaces:**
- Consumes: `dhSefaz` e `normalizarJustificativa`, importados de `api/src/modules/sefaz/eventos-xml.ts` (só leitura).
- Produces:
  - `idCancelamento(chave: string): string` = `'ID110111' + chave + '01'`;
  - `montarCancelamento(d: { tpAmb: 1 | 2; cnpj: string; chave: string; nProt: string; xJust: string; dhEvento: Date }): string`: lança erro se `normalizarJustificativa(xJust)` não for `ok` com o mesmo texto;
  - `corpoEnvEventoCancelamento(idLote: bigint, eventoAssinado: string): string`.

- [ ] **Step 1: testes**
  - Filhos de `infEvento` na ordem: `cOrgao`(35), `tpAmb`, `CNPJ`, `chNFe`, `dhEvento`, `tpEvento`(110111), `nSeqEvento`(1), `verEvento`(1.00), `detEvento`.
  - `detEvento`: `descEvento` = `Cancelamento`, com `nProt` de 17 dígitos intacto.
  - `xJust` com 14 caracteres lança erro.
  - O `xml-crypto` confere a assinatura do `infEvento` no envelope `sem_prefixo` inteiro.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(cupom-fiscal): evento de cancelamento da NFC-e (cOrgao 35, assinatura conferida no envelope)`.

### Task 8: Porta `SEFAZ_NFCE`, adaptador e falso

**Files:**
- Create: `api/src/modules/sefaz/nfce.port.ts` (tipos da §8.3 do desenho, literalmente)
- Create: `api/src/modules/sefaz/nfce.adapter.ts`
- Create: `api/src/modules/sefaz/__tests__/sefaz-nfce.falso.ts`
- Create: `api/src/modules/sefaz/__tests__/fixtures/nfce/` com: `ret-autorizacao-100.xml`, `ret-autorizacao-120.xml`, `ret-autorizacao-386.xml`, `ret-lote-225.xml`, `ret-consulta-100.xml`, `ret-consulta-217.xml`, `ret-consulta-cancelada.xml`, `ret-evento-135.xml`, `ret-evento-573.xml`, `ret-status-107.xml`. São escritas à mão a partir dos esquemas, marcadas "fictícias" num comentário, com `nProt` de 17 dígitos.
- Modify: `api/src/modules/sefaz/sefaz.module.ts` (provider e export `SEFAZ_NFCE`)
- Test: `api/src/modules/sefaz/__tests__/nfce.adapter.spec.ts`

**Interfaces:**
- Produces:
  - `SEFAZ_NFCE`, `SefazNfcePort`, `ProtocoloNfce`, `RespostaAutorizacao`, `RespostaConsulta`, `RespostaEvento` e `RespostaStatus` (desenho §8.3);
  - `URL_NFCE: Record<'autorizacao' | 'consulta' | 'evento' | 'status', Record<AmbienteSefaz, string>>` (pesquisa B.2);
  - `ACTION_NFCE`, com os 4 valores `http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote`, `…/NFeConsultaProtocolo4/nfeConsultaNF`, `…/NFeRecepcaoEvento4/nfeRecepcaoEvento` e `…/NFeStatusServico4/nfeStatusServicoNF`;
  - as funções de leitura `lerRetornoAutorizacao`, `lerRetornoConsulta`, `lerRetornoEvento` e `lerRetornoStatus`, cada uma `(corpoHttp: string) => Resposta…`;
  - `SefazNfceFalso`, com `respostas: (Resposta… | SefazErro)[]` em fila e `chamadas: { servico; ambiente; corpo }[]`.

- [ ] **Step 1: testes**
  - Com `CHAMAR_SOAP12` falso, cada método chama a URL e a action do ambiente com `envelope: 'sem_prefixo'`, `tempoLimiteMs: 20_000` e `tetoRespostaBytes: 2 * 1024 * 1024`.
  - Corpos enviados:
    - consulta: `<consSitNFe versao="4.00"><tpAmb>2</tpAmb><xServ>CONSULTAR</xServ><chNFe>…`;
    - status: `<consStatServ versao="4.00"><tpAmb>2</tpAmb><cUF>35</cUF><xServ>STATUS</xServ>`.
  - Leitura das fixtures:
    - `nProt` volta como string de 17 dígitos;
    - o 120 traz `cMsg` e `xMsg`;
    - `cStat` de 4 dígitos é aceito;
    - `protocolo.xml` começa em `<protNFe` e é igual ao trecho do retorno.
  - `SefazErro` do transporte passa sem ser trocado; resposta sem `retEnviNFe` vira `SEFAZ_RESPOSTA_INVALIDA` (`passo: 'soap'`).
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS, mais os specs que já existem em `src/modules/sefaz`.
- [ ] **Step 5:** commit `feat(sefaz): porta SEFAZ_NFCE (autorização síncrona, consulta, evento e status) com envelope sem prefixo`.

### Task 9: Retornos, travas e situações (regras puras)

**Files:**
- Create: `api/src/modules/cupom-fiscal/retornos.ts`, `travas.ts`, `situacao-cupom.ts` e `frases.ts`
- Test: `api/src/modules/cupom-fiscal/__tests__/retornos.spec.ts`, `travas.spec.ts` e `situacao-cupom.spec.ts`

**Interfaces** (atualizadas na rodada de decisões T9-1 a T9-4; são as assinaturas do código):
- **Tipos:**
  - `SituacaoCupom` (os 10 valores do CHECK);
  - `SituacaoAmbiente = 'ok' | 'parada_656' | 'parada_certificado' | 'parada_configuracao' | 'parada_serie_em_uso'`;
  - `Familia = 'produto' | 'empresa' | 'consumidor' | 'valores' | 'hora' | 'outra'`;
  - `AcaoCupom = 'enviar_de_novo' | 'consultar' | 'cancelar' | 'descartar' | 'lancar_venda' | 'imprimir'`;
  - `VendaEstoque = 'lancada' | 'pendente' | 'desfeita' | 'desfazer_pendente' | 'teste' | 'nao_lanca'`;
  - `TipoPendente = 'sem_resposta' | 'nao_saiu' | 'recusado' | 'venda_pendente'`.
- **`retornos.ts`:**
  - `interface Recusa { codigo: number; familia: Familia; frase: string; x_motivo: string }` (`x_motivo` sem o prefixo "Rejeição:", cortado em 255);
  - `interface AcaoRetorno { cupom: SituacaoCupom; rejeicao: boolean; numeroReaproveitavel?: false; ambiente?: SituacaoAmbiente; bloquear656?: true; bloqueadoAte?: Date; alerta?: { c_msg: string | null; x_msg: string | null }; recusa: Recusa | null }`;
  - `interface ContextoRetorno { ambiente: AmbienteSefaz; serie: number; numero: number; agora: Date; enviadoEm: Date; ultimo656: Date | null }` (as frases do 539, do QR, do 204 e do 656 precisam dele; com 656, `bloqueadoAte` já vem de `depoisDo656(ultimo656, agora)` e o 2º em 24 h traz `ambiente: 'parada_656'`);
  - `acaoAutorizacao(r: RespostaAutorizacao | SefazErro, ctx: ContextoRetorno): AcaoRetorno`;
  - `acaoConsulta(r: RespostaConsulta | SefazErro, atual: SituacaoCupom, ctx: ContextoRetorno): AcaoRetorno`;
  - `acaoCancelamento(r: RespostaEvento | SefazErro, ctx: ContextoRetorno): AcaoRetorno`;
  - `interface AcaoStatus { emOperacao: boolean; rejeicao: boolean; ambiente?: SituacaoAmbiente; bloquear656?: true; bloqueadoAte?: Date; codigo: number | null; frase: string }`;
  - `acaoStatus(r: RespostaStatus | SefazErro, ctx: Pick<ContextoRetorno, 'agora' | 'ultimo656'>): AcaoStatus` ("Testar a conexão": 656, paradas e rejeições contam como nos outros serviços);
  - `mensagemDoAmbiente(a: AcaoRetorno): string | null` (a `mensagem` do ambiente: 2º 656, outra parada ou o bloqueio com a hora; com 656 no lote e `protNFe` na mesma resposta, a `recusa` é a do cupom);
  - `familiaDoCodigo(c: number): Familia` (lista da §11 do desenho);
  - `motivoSefaz(x: string | null | undefined): string`;
  - `relogioDiverge(dhRecbto: string, agora: Date): boolean` (mais de 120 s; o serviço aplica, com o `dhRecbto` do lote, do status ou o `dhRegEvento`, nunca o `protocolo.dhRecbto` de uma consulta).
  - Regras: autorizado ou denegado sem `protNFe` ou sem `nProt` válido, lote aceito sem `protNFe`, outro 1xx e o 999 = `sem_resposta`; `rejeicao` = código ≥ 200, menos 301 e 302; 656 no lote conta mesmo com `protNFe` (o cupom segue o `protNFe`); 373 (nome do 1º item em homologação) = `rejeitado` + `parada_configuracao` com a frase de erro do sistema (não é QR).
- **`travas.ts`:**
  - constantes `TETO_RECUSAS_HORA = 10`, `TETO_CONSULTAS_HORA = 20`, `ESPERA_CONSULTA_MS = 120_000`, `STATUS_CADA_MS = 300_000`, `BLOQUEIO_656_MS = 65 * 60_000`, `MAX_ENVIOS = 3`, `MAX_CANCELAMENTOS = 3`, `ESPERA_CANCELAMENTO_MS = 120_000`;
  - `podeChamar(e: EstadoTravas, servico: 'autorizacao' | 'consulta' | 'evento' | 'status', agora: Date): { ok: true } | { ok: false; code: 'NFCE_BLOQUEADA' | 'NFCE_MUITAS_RECUSAS' | 'NFCE_PARADA' | 'NFCE_CONSULTA_CEDO' | 'NFCE_TESTE_CEDO' | 'NFCE_CANCELAMENTO_CEDO' | 'NFCE_LIMITE_CANCELAMENTOS'; ate: Date | null }`;
    - emissão e status: qualquer parada → bloqueio do 656 → teto de 10 recusas por hora → espera do status (5 min);
    - consulta e evento (T9-2, T9-2b): só `parada_656` e `parada_certificado` → bloqueio do 656 → limites próprios. Consulta: 2 min do envio, 2 min da última consulta da chave, 20 por hora = `NFCE_CONSULTA_CEDO`. Evento: no máximo 3 pedidos por cupom (`NFCE_LIMITE_CANCELAMENTOS`, sem hora) e 2 min entre eles (`NFCE_CANCELAMENTO_CEDO`); as rejeições dele contam no teto, mas o teto não o barra; o prazo de 30 min é conferido pelo serviço;
  - `EstadoTravas = { situacao: SituacaoAmbiente; bloqueado_ate: Date | null; recusas: Date[]; consultas: Date[]; ultimo_status_em: Date | null; enviadoEm?: Date | null; ultimaConsultaDaChave?: Date | null; cancelamentosDoCupom?: number; ultimoCancelamentoDoCupom?: Date | null }` (`enviadoEm` = `inicioDaEspera(cupom)`; os dois últimos, do diário `nfce_envios` do cupom, serviço `cancelamento`);
  - `depoisDo656(ultimo656: Date | null, agora: Date): { bloqueado_ate: Date; parada: boolean }`.
- **`situacao-cupom.ts`:**
  - `PRAZO_CANCELAR_MS = 29 * 60_000`;
  - `CupomParaAcoes = { situacao; ambiente; envios; numero_reaproveitavel; autorizada_em; cancelamento_pedido_em; lanca_venda; venda_lancada_em; venda_desfeita_em; enviadoEm; ultimaConsultaDaChave }` (os dois últimos, do diário `nfce_envios`);
  - `situacaoEfetiva(c, agora): SituacaoCupom` (`enviando` a partir de 2 min = `sem_resposta`);
  - `inicioDaEspera(c): Date | null` (em `cancelando`, o pedido de cancelamento; nas outras, o último envio);
  - `acoesDoCupom(c: CupomParaAcoes, agora: Date): { acoes: AcaoCupom[]; consultar_a_partir_de: Date | null; cancelar_ate: Date | null }`;
  - `vendaEstoque(c): VendaEstoque | null`;
  - `tipoPendente(c, agora): TipoPendente | null`.
- **`frases.ts`:**
  - `FRASES_VALIDACAO` (veio de `validacao-fiscal.ts`), `FRASE_RETORNO` (UX 6.1, a do cancelamento recusado da UX 4.3 e as do "Testar a conexão" da UX 5.1), `FRASE_ERRO` (UX 6.2, pela chave do código) e `reais(c: bigint)`;
  - o texto final das tabelas 6.1 e 6.2 da UX, literal, com hora `14h05`, e a versão "modo de teste" ou "valendo" onde a UX dá as duas;
  - o `xMotivo` vai à parte (`recusa.x_motivo`, sem o prefixo "Rejeição:", cortado em 255), para o `<details>` da tela;
  - teste: a frase do 539 com a série 2 e o número 12 é igual à da UX 6.1, letra por letra.

- [ ] **Step 1: testes** (tabela; uma linha `it.each` por linha da §5.3)
  - Autorização:
    - 100, 150 e 120 → `autorizado`; o 120 leva a recusa nula e o alerta passa adiante;
    - 110, 301 e 302 → `denegado`;
    - 204 → `sem_resposta`;
    - 539 → `rejeitado`, com `numeroReaproveitavel: false` e `parada_serie_em_uso`;
    - 704 → `rejeitado`, família `hora`;
    - 108/109 → `nao_enviado`, sem rejeição;
    - 656 → `bloquear656`;
    - 781 → `parada_configuracao`;
    - 285 → `parada_certificado`;
    - 225 → `parada_configuracao`;
    - 386 → `rejeitado`, família `produto`;
    - `SefazErro` com `enviado: false` → `nao_enviado`; com `enviado: true` → `sem_resposta`.
  - Consulta:
    - 217 → `nao_consta`;
    - `procEventoNFe` de cancelamento com `atual = 'cancelando'` → `cancelado`;
    - sem evento, em `cancelando` → `autorizado`.
  - Cancelamento: 135 → `cancelado`; 573 → `cancelando`; `SefazErro` com envio → `cancelando`.
  - Travas:
    - 10 recusas há 59 min → `NFCE_MUITAS_RECUSAS`, com `ate` = a mais antiga + 60 min;
    - consulta 119 s depois do envio → `NFCE_CONSULTA_CEDO`;
    - status 4 min depois do último → `NFCE_TESTE_CEDO`;
    - `bloqueado_ate` no futuro → `NFCE_BLOQUEADA` para os 4 serviços;
    - 2º 656 em 24 h → `parada: true`.
  - Situações:
    - `acoesDoCupom` de um `autorizado` às 14:05:31 → `cancelar_ate` 14:34:31; às 14:34:32, sem `cancelar`;
    - `rejeitado` com `envios = 3` → só `descartar` e `consultar`;
    - `numero_reaproveitavel = false` → `descartar`, sem `enviar_de_novo`;
    - `vendaEstoque` cobre os 6 valores.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(cupom-fiscal): retornos da SEFAZ, travas contra o 656 e ações do cupom (regras puras)`.

### Task 10: Cadastro — serviço, rotas e permissões

**Files:**
- Create: `api/src/modules/cupom-fiscal/csc.ts`, `cadastro.service.ts`, `cupom-fiscal.dto.ts`, `cupom-fiscal.controller.ts` e `cupom-fiscal.module.ts`
- Create: `api/src/modules/cupom-fiscal/__tests__/prisma-cupom.falso.ts`, no molde de `notas-sefaz/__tests__/prisma-sefaz.falso.ts`
- Modify: `api/src/app.module.ts` e `api/src/common/__tests__/permissoes-protecao.spec.ts`
- Test: `api/src/modules/cupom-fiscal/__tests__/cadastro.service.spec.ts`

**Interfaces:**
- Consumes: Tasks 3, 5 e 9.
- **`csc.ts`:** `cifrarCsc(csc: string, segredo: string): string` e `decifrarCsc(blob: string, segredo: string): string | null`, com o rótulo `'nfce-csc'`.
- **`CupomCadastroService`:**
  - `situacao(agora: Date)`;
  - `emitente()` e `salvarEmitente(dto, autor)`;
  - `ambiente(a)` e `salvarAmbiente(a, dto, autor)`;
  - `perfis()`, `criarPerfil(dto, autor)` e `atualizarPerfil(id, dto, autor)`;
  - `produtos(prontos: boolean)`, `salvarProduto(itemId, dto, autor)` e `perfilEmLote(dto, autor)`.
  - Os formatos de resposta são os da §8.2 do desenho (`falta`, `pendentes`, `historico`, `motivos`).
  - Em `produtos`, o preço sai como `preco_venda_centavos: number | null`, de `precoCentavos()` (Task 4); nunca `Decimal`.
- **`Autor = { id: string; nome: string }`.**
- **Rotas desta tarefa:** `situacao`, `emitente`, `ambientes/:ambiente`, `perfis`, `produtos`, `produtos/perfil` e `produtos/:itemCardapioId`.
  - Funcionam com o servidor desligado.
  - `:ambiente` fora de `homologacao|producao` = 404.
  - `produtos/perfil` vem declarada antes de `produtos/:itemCardapioId`.

- [ ] **Step 1: testes**
  - CSC:
    - `JSON.stringify` de todas as respostas não contém `CSC_TESTE`;
    - `csc_dica` = os 4 últimos caracteres;
    - o histórico grava `campos: ['csc']`, sem o valor.
  - Série e número:
    - série 890, ou igual a uma de `series_outro_sistema` → 422 `NFCE_SERIE_INVALIDA`;
    - `proximo_numero` ≤ maior número usado → 422 `NFCE_NUMERO_INVALIDO`;
    - trocar a série com cupom `rejeitado` → 409 `NFCE_SERIE_COM_PENDENTES`.
  - Perfis em lote: 501 itens → 400; 3 itens → 1 transação e 3 linhas.
  - Produtos: um item com `preco_venda` "12.345" → `preco_venda_centavos: 1235`.
  - `situacao().falta` sem nada cadastrado traz os códigos `ie`, `crt`, `endereco`, `serie`, `csc`, `certificado`, `cnpj` e `produto_pronto`.
  - Permissões: as rotas novas aparecem só para admin, e a lista "a loja alcança exatamente estas rotas" fica igual.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS com `permissoes-protecao.spec.ts`.
- [ ] **Step 5:** commit `feat(cupom-fiscal): cadastro (empresa, ambientes com CSC cifrado, perfis, produtos e perfil em lote)`.

### Task 11: Emissão (T1 → rede → T2 → T3), reenvio, consulta, descarte e venda

**Files:**
- Create: `api/src/modules/cupom-fiscal/emissao.service.ts`
- Modify: `cupom-fiscal.controller.ts`, `cupom-fiscal.dto.ts` e `api/scripts/nfce-banco.ts`
- Test: `api/src/modules/cupom-fiscal/__tests__/emissao.service.spec.ts`

**Interfaces:**
- Consumes: Tasks 2 a 10; `CERTIFICADO_DIGITAL.emUso()`.
- **`VendaParaCupom`** = `{ chave_idempotencia: string; itens: { item_cardapio_id: string; quantidade: string }[]; desconto_centavos: number; pagamentos: { t_pag: TPag; valor_centavos: number }[]; consumidor_doc: string | null; total_esperado_centavos: number }`. No DTO, os inteiros têm `@IsInt() @Min(0)`; no serviço, viram `bigint`.
- **`pedidoHash(v: VendaParaCupom): string`:** SHA-256 hex do JSON de `{ itens, desconto_centavos, pagamentos, consumidor_doc }`, na ordem enviada.
- **`CupomEmissaoService`**, com `agora?: Date` injetável em todos os métodos:
  - `emitir(v: VendaParaCupom, autor: Autor): Promise<{ status: 200 | 201; cupom: CupomDetalhe }>`;
  - `reenviar(id, autor)`, `consultar(id, autor)`, `descartar(id, motivo, autor)`, `lancarVenda(id)`, `testarConexao(autor)` e `ligarEmissao(a, ligada, confirmado, autor)`.
  - `CupomDetalhe` tem o formato da §8.2 (`acoes`, `recusa`, `venda_estoque`, `agora`).
- **T1:** `SELECT … FROM nfce_ambientes WHERE ambiente = $1 FOR UPDATE`. O número é o menor `descartado` com `numero_reaproveitavel` que não está em uso por outro cupom da série; senão, `proximo_numero`.
- **Rotas desta tarefa:**
  - `POST cupons`, `cupons/:id/reenviar|consultar|descartar|lancar-venda`, `testar-conexao` e `PUT ambientes/:ambiente/emissao`;
  - com o servidor desligado, 503 `NFCE_DESLIGADA`; a exceção é `lancar-venda`.

- [ ] **Step 1: testes** (Prisma falso + `SefazNfceFalso` + certificado fictício)
  - Autorização:
    - fixture 100 → `autorizado`;
    - `xml_autorizado` começa com `<nfeProc` e contém a `NFe` enviada byte a byte;
    - em produção com `lanca_venda`, a T3 chama `nfce_lancar_venda` uma vez; em homologação, nunca.
  - Validação antes da T1 (em todos, a porta não é chamada e nenhum cupom é criado):
    - `total_esperado_centavos` = 4999 com total 5000 → 409 `NFCE_TOTAL_MUDOU`;
    - preço "12.345" no cardápio + `total_esperado_centavos` = 1235 → aceito;
    - produto desativado entre a tela e o envio → 422 `NFCE_ITEM_INDISPONIVEL`;
    - quantidade `'0,350'` → 400 `VALIDATION_ERROR`.
  - Idempotência:
    - mesma chave, mesmo corpo → 200, mesmo id, 1 chamada à porta;
    - mesma chave, outro corpo → 409 `NFCE_CHAVE_REUSADA`.
  - Número livre e reenvio:
    - `SefazErro` com `enviado: false` → `nao_enviado`;
    - `reenviar` mantém `numero` e `c_nf` e gera `dhEmi` novo;
    - com o relógio de 31/01 23:58 → 01/02 00:03, a chave tem o AAMM novo.
  - Sem resposta, consulta e descarte:
    - `SefazErro` com `enviado: true` → `sem_resposta`;
    - `consultar` aos 60 s → 409 `NFCE_CONSULTA_CEDO`;
    - aos 121 s, com a fixture 217 → `nao_consta`;
    - `descartar` com o motivo `'ab'` → 400 `NFCE_MOTIVO`; com `'Venda desfeita'` → `descartado`;
    - o próximo `emitir` reaproveita o número.
  - Série em uso: 539 → próximo `emitir` = 409 `NFCE_PARADA`, e `descartar` não libera o número.
  - 656:
    - depois dele, nenhuma chamada à porta por 65 min (relógio +64 min → `NFCE_BLOQUEADA`);
    - o 2º em 24 h → `parada_656`.
  - Travas: depois de 10 recusas (fixture 386), o 11º `emitir` = 409 `NFCE_MUITAS_RECUSAS`; e o 4º envio do mesmo cupom = 409 `NFCE_LIMITE_ENVIOS`.
  - Relógio: `dhRecbto` 3 min longe de `agora` → `parada_configuracao`.
  - Venda: a T3 lança erro → o cupom continua `autorizado` com `venda_erro`, e `lancarVenda` refaz.
  - Ligar a emissão:
    - em produção, sem homologação autorizada e cancelada → 422 `NFCE_PRODUCAO_SEM_TESTE`;
    - com `cupom_lanca_venda` nulo → 422 `NFCE_LANCA_VENDA_PENDENTE`.
  - `nfce-banco.ts`: dois `emitir` em paralelo, com a porta falsa, contra o Postgres do smoke → números N e N+1, sem violação.
- [ ] **Step 2:** FAIL. **Step 3:** implementar (§4.2 a §4.4 e §5.1 a §5.3 do desenho; `emUso()` antes da T1, rede fora de transação). **Step 4:** PASS + smoke (`nfce-banco.ts` ok).
- [ ] **Step 5:** commit `feat(cupom-fiscal): emissão com número reservado antes da rede, reenvio sob consulta e venda separada da autorização`.

### Task 12: Cancelamento

**Files:**
- Create: `api/src/modules/cupom-fiscal/cancelamento.service.ts`
- Modify: `cupom-fiscal.controller.ts` (`POST cupons/:id/cancelar`)
- Test: `api/src/modules/cupom-fiscal/__tests__/cancelamento.service.spec.ts`

**Interfaces:**
- Consumes: Tasks 7, 8, 9 e 11 (T1/T2/T3 e travas iguais).
- Produces: `CupomCancelamentoService.cancelar(id: string, motivo: string, autor: Autor, agora?: Date): Promise<CupomDetalhe>`.

- [ ] **Step 1: testes**
  - Prazo, com a autorização às 14:05:31:
    - às 14:34:30 → envia;
    - às 14:34:32 → 409 `NFCE_CANCELAMENTO_FORA_DO_PRAZO`, sem chamar a porta.
  - Motivo: 14 caracteres ou emoji → 400 `NFCE_MOTIVO`.
  - Respostas:
    - 135 → `cancelado`, `cancelamento_n_prot` gravado e `nfce_desfazer_venda` chamada na T3;
    - 573 ou envio sem resposta → `cancelando`, e `consultar` resolve (Task 11).
  - Situação: `cancelar` em `rejeitado` → 409 `NFCE_SITUACAO`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS.
- [ ] **Step 5:** commit `feat(cupom-fiscal): cancelamento em até 29 min, com "cancelando" até a SEFAZ confirmar`.

### Task 13: Leitura (lista, cupom, DANFE, XML, mês) e importações protegidas

**Files:**
- Create: `api/src/modules/cupom-fiscal/leitura.service.ts`, `danfe.ts` e `zip.ts`
- Modify: `cupom-fiscal.controller.ts` e `api/src/modules/importacoes/importacoes.service.ts` (Substituir e `mapear` com `nfce_cupom_id: null`)
- Test: `api/src/modules/cupom-fiscal/__tests__/leitura.spec.ts`
- Test: `api/src/modules/importacoes/__tests__/importacoes-cupom.spec.ts`

**Interfaces:**
- Produces:
  - `danfeDoNfeProc(xml: string): Danfe`, com as divisões I a IX da §5.6 do desenho, mais `nProt`, `dhRecbto`, `cMsg`, `xMsg`, `qrCode`, `urlChave` e `homologacao`;
  - `zipSemCompressao(arquivos: { nome: string; dados: Buffer }[]): Buffer` (método 0, CRC por `zlib.crc32`);
  - `CupomLeituraService`:
    - `listar(f: { ambiente?; ini?; fim?; situacao?: SituacaoCupom[]; atencao?: boolean; chave_idempotencia?: string; limite?: number })`;
    - `detalhe(id, agora)`, `danfe(id)` e `xml(id, tipo: 'nota' | 'cancelamento')`;
    - `xmlDoMes(mes: string, ambiente)` e `vendasNoPeriodo(ini, fim): Promise<{ quantidade: number; valor_centavos: number }>`;
    - nas linhas e no detalhe, todo dinheiro em `*_centavos: number` (Global Constraints).
- **Rotas desta tarefa:**
  - `GET cupons` (filtros da §8.2), `cupons/:id`, `cupons/:id/danfe`, `cupons/:id/xml`, `xml-do-mes` e `vendas-no-periodo`;
  - todas funcionam com o servidor desligado;
  - o XML sai como `text/xml` com `res.header` depois das checagens, nunca `@Header`.

- [ ] **Step 1: testes**
  - DANFE:
    - `danfeDoNfeProc(fixture)` traz os dados do XML;
    - mudar a linha da tabela depois não muda o DANFE (lido só do `xml_autorizado`);
    - nome com `&` e `<` volta legível.
  - Lista:
    - o CPF vem `***.982.247-**` e o CNPJ inteiro;
    - `chave_idempotencia` desconhecida → `[]`, sem chamada à porta;
    - `atencao=true` inclui `autorizado` com `venda_erro`;
    - sem `ambiente`, com o servidor desligado → `producao`.
  - Zip: o teste lê os cabeçalhos locais, confere `crc32` e nomes `NFCe-<chave>.xml`, `NFCe-<chave>-cancelamento.xml` e `numeros-nao-usados.csv`.
  - Importações:
    - "Substituir" chama `vendas.deleteMany` com `nfce_cupom_id: null`;
    - `mapear` chama `updateMany` com `nfce_cupom_id: null`.
- [ ] **Step 2:** FAIL. **Step 3:** implementar. **Step 4:** PASS com `src/modules/importacoes`.
- [ ] **Step 5:** commit `feat(cupom-fiscal): lista, DANFE do XML guardado, XML do mês para o contador e importação que não apaga venda de cupom`.

### Task 14: Web — Emitir, página do cupom, DANFE e diálogos

**Files:**
- Modify: `web/src/lib/erp-api.ts` (uma função por rota das Tasks 10 a 13) e `web/src/lib/cupom.ts`
- Create: `web/src/lib/qrcode.ts` (único import de `qrcode-generator`)
- Create:
  - `web/src/app/(app)/cupom/page.tsx` (abas Emitir, Emitidos e Produtos);
  - `web/src/app/(app)/cupom/[id]/page.tsx` e `web/src/app/(app)/cupom/[id]/imprimir/page.tsx`;
  - `web/src/components/cupom/emitir.tsx`, `conferir-sheet.tsx`, `danfe.tsx`, `cancelar-dialog.tsx` e `descartar-dialog.tsx`.
- Test: `web/src/lib/__tests__/cupom.spec.ts` (acrescenta as funções da tela)

**Interfaces:**
- Consumes: as respostas da §8.2 do desenho.
- Produces:
  - `atalhosDinheiro(total: bigint): bigint[]`;
  - `rotuloBotaoEmitir(e: EstadoEmitir): { rotulo: string; alvo: 'busca' | 'produtos' | 'pagamento' | 'documento' | 'topo' | 'conferir' }`;
  - `quantidadeDaTela(s: string): string` (vírgula → ponto);
  - `qrSvg(texto: string): string` (nível M).
- Textos, foco, `aria-*` e fluxos (2.5, 2.7, 3.1 a 3.5, 4.3 a 4.5): os da UX, literalmente.
- O "não sei se saiu" chama `GET cupons?chave_idempotencia=` **uma vez**.
- `total_esperado_centavos` = `calcularTotais` (Task 4) sobre os `preco_venda_centavos` recebidos; a tela não arredonda preço.
- Nada da venda vai para o storage.

- [ ] **Step 1: testes**

```ts
expect(atalhosDinheiro(5370n)).toEqual([6000n, 10000n]); expect(atalhosDinheiro(4730n)).toEqual([5000n, 10000n]);
expect(quantidadeDaTela('0,350')).toBe('0.350');
expect(rotuloBotaoEmitir({ ...vazio })).toEqual({ rotulo: 'Adicione um produto', alvo: 'busca' });
expect(rotuloBotaoEmitir({ ...pronto, falta: 1000n })).toEqual({ rotulo: 'Falta R$ 10,00', alvo: 'pagamento' });
expect(qrSvg('https://x/?p=1')).toMatch(/^<svg/);
```
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn vitest run src/lib/__tests__/cupom.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** `yarn add --exact qrcode-generator@<versão mais nova do registro no dia>`; implementar as funções e as telas.
- [ ] **Step 4:** vitest PASS; `../scripts/run-capped.sh 1500 yarn typecheck` e `yarn lint` sem erro novo.
- [ ] **Step 5:** commit `feat(web): emitir cupom, conferir, página do cupom, DANFE 80 mm e cancelar/descartar`.

### Task 15: Web — Emitidos, Produtos, Configurações, menu, Ficha e Importar

**Files:**
- Create: `web/src/components/cupom/emitidos.tsx`, `faixa-pendentes.tsx`, `produtos.tsx`, `perfis.tsx` e `web/src/components/cupom-fiscal-panel.tsx`
- Modify:
  - `web/src/app/(app)/layout.tsx` (MENU: `{ to: '/cupom', label: 'Cupom Fiscal', icon: Receipt, loja: false }`);
  - `web/src/app/(app)/configuracoes/page.tsx` (painel);
  - `web/src/app/(app)/fichas/[id]/page.tsx` (sai NCM/CFOP/CST/Alíquota e entra a linha só de leitura com "Editar");
  - `web/src/app/(app)/importar/page.tsx` (aviso de `vendas-no-periodo`).
- Test: `web/src/lib/__tests__/cupom.spec.ts`

**Interfaces:**
- Produces:
  - `textoPendentes(p: { total: number; primeiro: { serie: number; numero: number; tipo: TipoPendente } | null }): string | null`;
  - `textoAvisoImportacao(r: { quantidade: number; valor_centavos: number }): string | null`, com o texto da UX 5.8;
  - `ordenarFalta(f: { codigo: string; texto: string }[]): typeof f` (ordem da UX 5.1).

- [ ] **Step 1: testes**
  - `textoPendentes({ total: 0, primeiro: null })` → `null`.
  - `textoAvisoImportacao({ quantidade: 4, valor_centavos: 21050 })` → "Neste período, o Freela Comanda já lançou 4 cupons no estoque (R$ 210,50). Se essas vendas também estão neste arquivo, vão contar duas vezes."
- [ ] **Step 2:** FAIL. **Step 3:** implementar as telas pelas seções 4, 5 e 7 da UX. **Step 4:** vitest PASS, typecheck e lint.
- [ ] **Step 5:** commit `feat(web): emitidos e pendentes, produtos e perfis fiscais, painel do cupom em Configurações, ficha e aviso na importação`.

### Task 16: Smoke HTTP e browser-check

**Files:**
- Modify: `api/scripts/smoke.sh` (seção `# ---------- cupom fiscal`), `web/scripts/browser-check.mjs`

**Interfaces:**
- Consumes: tudo acima.
- O smoke roda com `NFCE_AMBIENTE=homologacao` e sem certificado; o browser-check, com a variável vazia.

- [ ] **Step 1: escrever as checagens**
  - Smoke:
    - a loja leva 403 em toda rota `/v1/cupom-fiscal/*`;
    - fluxo de cadastro: emitente → ambiente com CSC (a resposta não traz o CSC) → perfil → produto → `GET produtos?prontos=true`;
    - `POST cupons` → 409 `NFCE_EMISSAO_DESLIGADA`;
    - `PUT ambientes/homologacao/emissao {ligada:true}` → 503 `CERTIFICADO_NAO_CADASTRADO`, sem conexão (`smoke-sem-rede.cjs` continua barrando);
    - cupom autorizado semeado por SQL: `GET cupons/:id`, `danfe`, `xml` (`text/xml`) e `xml-do-mes` (`PK\x03\x04` no início);
    - importação "Substituir" no período do cupom semeado mantém a venda dele.
  - browser-check:
    - com a variável vazia (UX 8.1): menu "Cupom Fiscal" só para admin e o aviso "não ativada";
    - com `page.route` (UX 8.2): Emitir em 390 px e no desktop, Conferir, autorizado, "não sei se saiu" e a prévia de impressão do DANFE em 80 mm (captura).
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh` → termina com "SMOKE OK" (ou a linha final de sucesso de hoje). Depois, sozinho: `cd web && ../scripts/run-capped.sh 3300 bash scripts/browser-check.sh` → sem falha; capturas em `.cache/telas`.
- [ ] **Step 3:** commit `test(cupom-fiscal): smoke das rotas e do banco, browser-check das telas e do DANFE 80 mm`.

### Task 17: Contrato, regras e verificação completa

**Files:**
- Modify:
  - `docs/api-contract.md` (seção "Cupom fiscal": rotas, corpos e códigos de erro da §8.2 e §8.4);
  - `CLAUDE.md` (uma regra: `NFCE_AMBIENTE` desligada por padrão; porta `SEFAZ_NFCE`; nunca reenvio automático; `envelope: 'sem_prefixo'`; `textoFiscal`; `web/src/lib/cupom.ts` igual a `totais.ts`);
  - `docs/deploy.md` (variável e a "Volta": desligar pela tela antes de esvaziar a variável).

- [ ] **Step 1:** escrever os três documentos.
- [ ] **Step 2:** verificação, um comando por vez:
  - `cd api`:
    - `../scripts/run-capped.sh 1500 npx jest --runInBand src/common src/scripts`;
    - `… src/modules/sefaz`;
    - `… src/modules/cupom-fiscal`;
    - `… src/modules/importacoes src/modules/notas-sefaz src/modules/notas src/modules/cardapio`;
    - `../scripts/run-capped.sh 1500 npm run typecheck`;
    - `../scripts/run-capped.sh 1500 npm run lint`;
    - `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh`.
  - `cd web`:
    - `../scripts/run-capped.sh 1500 yarn test`;
    - `../scripts/run-capped.sh 1500 yarn typecheck`;
    - `../scripts/run-capped.sh 1500 yarn lint`;
    - `../scripts/run-capped.sh 3300 bash scripts/browser-check.sh`.
  - Esperado: tudo PASS, menos o que a Task 1 anotou como já quebrado.
- [ ] **Step 3:** conferências finais.
  - `grep -rn "NFeInutilizacao4\|rejectUnauthorized: false" api/src` → nada.
  - `grep -rn "CSCTESTE" api/src --include=*.ts | grep -v __tests__` → nada.
- [ ] **Step 4:** commit `docs(cupom-fiscal): contrato, regras do CLAUDE.md e subida`, com a saída da verificação resumida no corpo.

---

## Auto-revisão (17/11/2026)

- **Cobertura do desenho:**

  | Seção do desenho | Tasks |
  |---|---|
  | §3.1–3.2 itens e perfis | 5, 10 |
  | §3.3–3.4 venda e importação | 3, 11, 13, 15 |
  | §4.1–4.3 numeração | 3, 11 |
  | §4.4 656 | 9, 11 |
  | §5.1 situações | 9 |
  | §5.2 XML, envelope e `textoFiscal` | 2, 6 |
  | §5.3 retornos | 9 |
  | §5.4 cancelamento | 7, 12 |
  | §5.6 QR e DANFE | 6, 13, 14 |
  | §6 IBS/CBS (só cadastro) | 3, 5 |
  | §7 configurações | 3, 10, 11, 15 |
  | §7.4 XML do mês | 13 |
  | §8 dados, rotas e erros | 3, 10–13 |
  | §10 testes | todas |
  | §11 respostas à UX | 10, 11, 13, 14 |

  - Fica fora de propósito: a fatia opcional "Importar dados fiscais" (UX 9.6, decisão do dono) e a fase 2 inteira.
- **Varredura dos passos:** os corpos de função ficam com o implementador. Só o rateio, o arredondamento e a ordem dos filhos do XML estão fixados, porque os testes não os determinam sozinhos.
- **Tipos:**
  - `TPag`, `SituacaoCupom`, `AcaoCupom`, `VendaEstoque`, `TipoPendente` e `Familia` são definidos nas Tasks 4 e 9 e usados com os mesmos nomes nas Tasks 11 a 15;
  - `CupomDetalhe` é o formato da §8.2, o mesmo em `detalhe` e no POST;
  - `Autor` é definido na Task 10.
- **Review Focus:** as 5 linhas têm teste nas Tasks 2, 4, 6, 11 e 13.
- **Proporção:** o plano tem bem menos linhas que o desenho e quase nenhum corpo de função.
