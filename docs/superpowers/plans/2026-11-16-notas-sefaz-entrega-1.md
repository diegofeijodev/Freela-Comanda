# Notas da SEFAZ, entrega 1: CNPJ com letras, nota repetida e IA no XML (plano de implementação)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Esta entrega faz três coisas: CNPJ e chave de acesso passam a aceitar letras (Etapa 0); "Dar entrada" avisa antes de lançar duas vezes a mesma nota (parte A); os itens sem vínculo de um XML recebem a sugestão de insumo da IA (parte B).

**Architecture:**
- **Regras puras em dois lugares:** `api/src/common/fiscal/` (cnpj, chave de acesso, nota repetida) e uma cópia em `web/src/lib/fiscal.ts`, como já é feito com a fórmula da ficha.
- **Nota repetida:** a API devolve as notas parecidas numa consulta prévia (`GET /v1/notas/repetidas`) e confere de novo no `POST /v1/notas`, respondendo 409 `NOTA_REPETIDA` sem confirmação.
- **IA no XML:** é uma rota só de texto (`POST /v1/notas/sugerir-insumos`) que passa pela mesma porta `LEITOR_PDF`, com 0 arquivos.

**Tech Stack:** NestJS 11 + Fastify + Prisma/PostgreSQL (api, npm) · Next 15 + TanStack Query (web, yarn) · jest, vitest, smoke em bash, browser-check (Playwright).

**Spec:** `docs/superpowers/specs/2026-11-16-notas-sefaz-design.md` (seções "Etapa 0", "A", "B") e `docs/superpowers/specs/2026-11-16-notas-sefaz-ux.md` (§1, §2, §5, §6, §7). Onde a especificação de interface propõe trocar um texto (§6), vale o texto dela.

## Global Constraints

- **Ramo e commits:** ramo `feat/notas-sefaz`, um commit por tarefa, sem push e sem deploy. Toda mensagem termina com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`, passada num segundo `-m`.
- **Comandos pesados:** só por `scripts/run-capped.sh`, um de cada vez. Tetos: jest, tsc e eslint 1500; smoke 1300; browser-check 2600. O jest roda sempre como `npx jest --runInBand <caminhos>`. Nunca `nest build` nem `next build`.
- **Rede:** nenhum teste faz rede (leitor falso, `HttpIa` falso, `page.route` no navegador). Nenhuma chamada à SEFAZ. Nenhuma dependência nova.
- **Rotas novas:** todas com `@AdminOnly()` (vem do controller) e listadas em `api/src/common/__tests__/permissoes-protecao.spec.ts`. A lista do que a loja alcança não muda.
- **Erros:** sempre `{ error: { code, message } }`. No web, ler com `errMsg()`/`errCode()` de `@/lib/db`. Chamada HTTP só em `web/src/lib/erp-api.ts`.
- **Normalizar** = maiúsculas e só `[0-9A-Z]`. Nunca `\D` em CNPJ ou chave; só a linha digitável do DDA continua só com números. `fornecedor_cnpj` pode ser CPF (11), e o DV do fornecedor nunca é validado na API.
- **Frases exatas da API:**
  - 400 `CHAVE_INVALIDA`: "A chave de acesso da nota é inválida. Confira os 44 caracteres."
  - 400 `CNPJ_INVALIDO`: "CNPJ inválido. Confira os 14 caracteres (pode ter letras)."
  - 409 `DUPLICADO`: "Esta nota já foi lançada" (não muda).
  - 422 `SUGESTAO_ILEGIVEL`: "Não consegui sugerir os insumos desta nota."
- **409 `NOTA_REPETIDA`, modelo fixo:**
  - `Já existe a NF {numero}[ série {serie}] de {fornecedor_nome}, lançada em {DD/MM/AAAA}{ origem}, de R$ {0.000,00}[ (e mais 1 parecida)| (e mais N parecidas)]. Se for outra nota, confirme para lançar mesmo assim.`
  - Os dados são os da parecida mais nova (`created_at` decrescente). "lançada em" = `data_entrada`, o mesmo dia da lista "Notas lançadas", formatado pela divisão do texto `AAAA-MM-DD` (nunca por `Date`, que daria o dia anterior).
  - Origem por extenso (UX §1/§5): "por XML", "por PDF", "por foto", "pela SEFAZ".
  - Valor com `toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })` precedido de "R$ " com espaço comum. Não usar o `Intl` com `currency`, que põe U+00A0.
- **Descrições em `schemas.ts`:**
  - `chave`: "44 caracteres; as posições 7 a 18 podem ter letras (CNPJ alfanumérico)".
  - `emitente_cnpj` e `cnpj` do DDA: "CNPJ com 14 caracteres, números e letras maiúsculas, sem pontuação".
  - `linha_digitavel` continua "Só números".
- **Textos da tela, literais da especificação de interface:**
  - Faixa parecida:
    - título "Parece que esta nota já foi lançada";
    - linhas "NF 4411 · série 1 · R$ 1.234,56" e "Entrou em 03/11/2026 por foto";
    - "e mais N parecidas" (1 = "e mais 1 parecida");
    - botões "Não lançar esta nota" / "É outra nota, lançar mesmo assim".
  - Faixa depois de confirmar: "Você confirmou que esta é outra nota. Ao dar entrada, ela fica marcada como possível repetição." + link "Voltar atrás".
  - Faixa vermelha: "Esta nota já foi lançada. A chave de acesso é a mesma de NF 4411 (ATACADÃO S.A.), de 03/11/2026. Não dá para lançar duas vezes."
  - Toast: "Nota descartada. Nada foi lançado."
  - Diálogo: título "Esta nota parece já lançada". Corpo = frase + " Se for a mesma nota, o estoque e as contas a pagar ficam em dobro.". Botões "Não lançar" (foco inicial) e "Lançar mesmo assim".
  - IA:
    - título "· sugerindo insumos…";
    - na linha, "Sugerindo…";
    - espera: "Aguarde a sugestão de insumos (alguns segundos).";
    - depois da resposta: "Os insumos marcados foram sugeridos por inteligência artificial. Confira antes de dar entrada.";
    - falha: "Não consegui usar a inteligência artificial agora. As sugestões abaixo são por palavras parecidas."
  - Aviso: "CNPJ/CPF não confere".
- **Migrações:** SQL à mão, com `schema.prisma` coerente e nomes no padrão do Prisma. Nunca editar migração aplicada. Comentários sem as palavras "serial" e "identity": `esquema.spec.ts` procura essas palavras com regex que não diferencia maiúsculas.
- **Fora desta entrega:** Etapa 1 e Etapa 2, abas, "Conferir" e `origem: 'sefaz'` no DTO. A origem entra com o "Conferir" da Etapa 1; o web já sabe escrever "pela SEFAZ". Nenhum `SEFAZ_DFE_AMBIENTE`.

## Review Focus

1. **O admin muda CNPJ, número ou série depois de "É outra nota".** A confirmação cai e a faixa volta. Mudar só a formatação ("4411" → "0004411") não derruba. Testes: Task 6 (`chaveDaConsulta` no vitest; browser-check série 2 → 1).
2. **A IA devolve índices fora de ordem, repetidos, inventados (0, n+1, 1.5) ou faltando.** Cada linha recebe a sua, o primeiro índice repetido vence e o que falta vira "Cadastrar novo" com a descrição. Teste: Task 4 (`casarPorIndice` e serviço).
3. **A IA responde tarde:** depois dos 20 s, depois de Cancelar ou de outro arquivo, ou depois de o admin mexer no seletor, no nome ou no fator. Nada é sobrescrito. Teste: Task 7 (`sugerirEmLotes` com relógio falso; `aplicarSugestoes` com `tocada`/`fatorTocado`).
4. **Foto ou PDF sem CNPJ ou sem número, lançada várias vezes.** Nunca dá 409. Série só de um lado ainda avisa. Testes: Task 3 (as notas por foto do smoke, todas com número 7001 e sem CNPJ, seguem 201; caso "sem série" = 409; testes puros).
5. **CNPJ antigo inválido salvo em Configurações.** PATCH sem o campo `cnpj` continua funcionando; com o campo, 400 com a frase, e a tela mostra essa frase. Testes: Task 2 (jest `mkup_padrao` e smoke) e Task 5 (browser-check).

## Chaves de teste (DV pela regra do módulo 11)

O DV da chave é o módulo 11 dos 43 primeiros caracteres:
- pesos de 2 a 9, aplicados da direita para a esquerda;
- cada caractere vale o seu código ASCII − 48;
- resto 0 ou 1 → DV 0; senão, DV = 11 − resto.

O CNPJ alfanumérico de exemplo é `12ABC34501DE35`, o exemplo da RFB, com os dois DVs conferidos à mão:
- valores 1,2,17,18,19,3,4,5,0,1,20,21 com os pesos 5,4,3,2,9,8,7,6,5,4,3,2 → soma 459, resto 8, 1º DV 3;
- com o 3 no fim, pesos 6..2 → soma 424, resto 6, 2º DV 5.

**Vetor da chave (calculado aqui; não é o do Anexo da NT):** `35261112ABC34501DE35550010000044111000044116`. A soma dá 742, resto 5, DV 6. Partes: UF 35, AAMM 2611, emitente 12ABC34501DE35, modelo 55, série 001, número 000004411.

As chaves em uso hoje têm DV errado e passam a dar `CHAVE_INVALIDA`. A Task 2 troca todas no mesmo commit:

| Onde | Antiga | Nova |
|---|---|---|
| `smoke.sh` `CH` (e o `sed` da `NOTA2`) | `35261012345678000199550010000099991000099999` | `35261012345678000199550010000099991000099991` |
| `smoke.sh` `NOTA2` | `35261012345678000199550010000099981000099998` | `35261012345678000199550010000099981000099994` |
| `smoke.sh` 7001 | `35261012345678000199550010000070011000070011` | `35261012345678000199550010000070011000070019` |
| `smoke.sh` 7002 | `35261012345678000199550010000070021000070021` | `35261012345678000199550010000070021000070024` |
| `smoke.sh` 7003 | `35261012345678000199550010000070031000070031` | `35261012345678000199550010000070031000070030` |
| `smoke.sh` 7004 | `35261012345678000199550010000070041000070041` | `35261012345678000199550010000070041000070045` |
| `smoke.sh` 7005 | `35261012345678000199550010000070051000070051` | `35261012345678000199550010000070051000070050` |
| `smoke.sh` 7006 | `35261012345678000199550010000070061000070061` | `35261012345678000199550010000070061000070066` |
| `smoke.sh` 7008 | `35261012345678000199550010000070081000070081` | `35261012345678000199550010000070081000070087` |
| `smoke.sh` `CHF` | `35 2610 1234 5678 0001 9955 0010 0000 7001 1000 0700 11` | `35 2610 1234 5678 0001 9955 0010 0000 7001 1000 0700 19` |
| `browser-check.mjs:28`, `nfe.test.ts` (XML e expectativa) | `35261012345678000199550010000012341000012345` | `35261012345678000199550010000012341000012340` |

Só o último dígito muda. `35261012345678000199550010000099971000099997` (`NOTA3`) e `35261012345678000199550010000070071000070071` (7007) já estão certas.

**Chaves novas:**
- `35261112ABC34501DE35550010000044111000044124`, `35261112ABC34501DE35550010000044111000044132` e `35261112ABC34501DE35550010000044111000044159` (série 001; no texto abaixo, `…44124`, `…44132`, `…44159`);
- `…44117` = o vetor com o último dígito trocado (DV errado); `…0070011000070011` = a chave antiga da 7001 (DV errado);
- `35261112ABC34501DE35550020000044111000044147` (série 002);
- `35261012345678000199550010000099961000099960` (DV errado de propósito; o certo seria 5);
- `35261012345678000199550010000012341000012390` (2º XML do navegador).

---

### Task 1: `common/fiscal` com o CNPJ, a chave de acesso e o número/série (puro)

**Files:**
- Move (`git mv`, sem mudar o conteúdo): `api/src/modules/certificado-digital/cnpj.ts` → `api/src/common/fiscal/cnpj.ts`; `api/src/modules/certificado-digital/__tests__/cnpj.spec.ts` → `api/src/common/fiscal/__tests__/cnpj.spec.ts`
- Modify (só o import, para `../../common/fiscal/cnpj`): `api/src/modules/certificado-digital/conferencia.ts:3`, `mensagens.ts:2`, `certificado-digital.service.ts:8`
- Create: `api/src/common/fiscal/chave-acesso.ts`
- Test: `api/src/common/fiscal/__tests__/chave-acesso.spec.ts`

**Interfaces:**
- Produces:
  - `normalizarChave(s: string): string`.
  - `chaveValida(c: string): boolean`: formato `^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$` mais o DV acima. O DV fica numa função privada do próprio arquivo, porque o `cnpj.ts` não muda.
  - `type PartesChave = { uf: string; aamm: string; emitente: string; modelo: string; serie: string; numero: string }`.
  - `partesDaChave(c: string): PartesChave | null`: devolve `null` se a chave for inválida; série e número saem por `normalizarNumeroSerie`.
  - `normalizarNumeroSerie(s: string | null | undefined): string`: só dígitos, sem zeros à esquerda; só zeros → `'0'`; sem dígito → `''`.

- [ ] **Step 1: testes que falham** (`chave-acesso.spec.ts`)
  - `normalizarChave('35 2611 12ab c345 01de 3555 0010 0000 4411 1000 0441 16')` → o vetor.
  - `chaveValida` é verdadeira para o vetor e para `35261012345678000199550010000070011000070019`.
  - `chaveValida` é falsa para:
    - `…44117` (DV);
    - `…0070011000070011` (DV);
    - `35261112ABC34501DE35550010000A44111000044116` (letra fora de 7–18);
    - 43 caracteres;
    - `''`;
    - o vetor em minúsculas.
  - `partesDaChave(vetor)` → `{ uf: '35', aamm: '2611', emitente: '12ABC34501DE35', modelo: '55', serie: '1', numero: '4411' }`; com `…44117` → `null`.
  - `normalizarNumeroSerie`:
    - `'000.004.411'` → `'4411'`;
    - `'001'` → `'1'`;
    - `'000'` → `'0'`;
    - `'A1'` → `'1'`;
    - `''` e `null` → `''`.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/common/fiscal src/modules/certificado-digital`. Esperado: FAIL (`chave-acesso` não existe).
- [ ] **Step 3:** implementar `chave-acesso.ts` e fazer a mudança de lugar.
- [ ] **Step 4:** o comando do Step 2 passa; `../scripts/run-capped.sh 1500 npm run typecheck` sai limpo.
- [ ] **Step 5:** `git commit -m "refactor(fiscal): CNPJ vai para common/fiscal e nasce a chave de acesso com letras" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 2: Etapa 0 na API, com normalização, validação e migração dos dados

**Files:**
- Create: `api/prisma/migrations/20261116140000_cnpj_alfanumerico/migration.sql`
- Modify:
  - `api/src/modules/notas/notas.service.ts` (`lancar` :45/:51, `existe`, `vinculos`);
  - `api/src/modules/leitura-pdf/leitura-pdf.service.ts` (`chave44`, `emitente_cnpj`);
  - `api/src/modules/leitura-pdf/schemas.ts`;
  - `api/src/modules/cadastros/cadastros.service.ts` (`salvarConfig`, `criarFornecedor`);
  - `api/scripts/smoke.sh`, `web/scripts/browser-check.mjs:28`, `web/src/lib/__tests__/nfe.test.ts`.
- Test: `api/src/modules/notas/__tests__/notas.service.spec.ts` (novo), `api/src/modules/cadastros/__tests__/cadastros.service.spec.ts` (novo), `api/src/modules/leitura-pdf/__tests__/leitura-pdf.service.spec.ts`

**Interfaces:**
- Consumes: `normalizarCnpj`, `cnpjValido` e `normalizarChave`/`chaveValida` (Task 1).
- Produces:
  - **Ordem fixa em `lancar`:**
    1. parcelas;
    2. existente + novo;
    3. `chave = normalizarChave(dto.chave ?? '') || null` e, se a chave não for válida, `CHAVE_INVALIDA`;
    4. `DUPLICADO`;
    5. (Task 3) `NOTA_REPETIDA`;
    6. transação.
  - `fornecedor_cnpj = normalizarCnpj(…) || null`.
  - `salvarConfig`: só quando a chave `cnpj` vem no DTO, normaliza e, se não ficar vazio e não for `cnpjValido`, dá 400 `CNPJ_INVALIDO`.
  - `criarFornecedor`: `cnpj` normalizado `|| null`.
  - Leitura: `chave` = válida normalizada ou `null`; `emitente_cnpj` = normalizado `|| null`.
- Migração: três `UPDATE`.
  - `configuracoes.cnpj`: `upper(regexp_replace(x, '[^0-9A-Za-z]', '', 'g'))`.
  - `fornecedores.cnpj` e `notas_entrada.fornecedor_cnpj`: o mesmo dentro de `nullif(…, '')`, com `WHERE … IS NOT NULL`.
  - É idempotente; `vinculos_produto` fica de fora (desenho).

- [ ] **Step 1: testes que falham**
  - `notas.service.spec.ts`: Prisma falso em memória, como em `certificado-digital.service.spec.ts`. Guarda os argumentos de `notas_entrada.findUnique/create`, `$transaction(cb)`, `$executeRaw`, `*.createMany`, `fornecedores.findFirst` e `vinculos_produto.findMany`.
    - **DV errado:** a chave `…0070011000070011` rejeita com `{ status: 400, response: { code: 'CHAVE_INVALIDA', message: 'A chave de acesso da nota é inválida. Confira os 44 caracteres.' } }`, sem nenhuma chamada ao Prisma.
    - **Chave do vetor em minúsculas e com espaços:** `findUnique` e `create` recebem o vetor em maiúsculas.
    - **Chave `'  '`:** sem `findUnique`, e `create.data.chave === null`.
    - **Ordem:** boleto sem parcelas e chave inválida dão "Informe o vencimento de cada parcela".
    - **Chave existente:** 409 `DUPLICADO`.
    - **`fornecedor_cnpj`:**
      - `'12.abc.345/01de-35'` → `'12ABC34501DE35'`, também no `fornecedores.createMany`;
      - `'123.456.789-09'` → `'12345678909'`;
      - `''` → `null`.
    - **Consultas normalizadas:** `existe(' 35261112abc34501de35550010000044111000044116 ')` consulta o vetor; `vinculos('12.345.678/0001-99')` consulta `'12345678000199'`.
  - `cadastros.service.spec.ts`:
    - **`salvarConfig`:**
      - `{ cnpj: '12.abc.345/01de-35' }` → `update.data.cnpj === '12ABC34501DE35'`;
      - `{ cnpj: '12.345.678/0001-94' }` → 400 `CNPJ_INVALIDO` com a frase, sem `update`;
      - `{ cnpj: '  ' }` → `''`;
      - `{ mkup_padrao: 2 }` → `data` sem a chave `cnpj`.
    - **`criarFornecedor`:** com `'12.abc.345/01de-35'` → `'12ABC34501DE35'`; com `'123.456.789-09'` → `'12345678909'`; com `''` → `null`.
  - `leitura-pdf.service.spec.ts`: o teste "chave: só dígitos…" (:83–88) é trocado.
    - **Chave:**
      - `'35 2610 1234 5678 0001 9955 0010 0000 7001 1000 0700 19'` → `'35261012345678000199550010000070011000070019'`;
      - `…0070011000070011` (DV errado) → `null`;
      - vetor em minúsculas → maiúsculas;
      - 43 caracteres → `null`;
      - `null` → `null`.
    - **Teste novo, `emitente_cnpj`:** `'12.abc.345/01de-35'` → `'12ABC34501DE35'`; `''` → `null`.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas src/modules/cadastros src/modules/leitura-pdf`. Esperado: FAIL.
- [ ] **Step 3: implementar** serviços, `schemas.ts` e a migração; trocar as chaves da tabela no smoke, no browser-check e no `nfe.test.ts`.
- [ ] **Step 4: smoke**
  - **Bloco novo "CNPJ e chave com letras"**, depois da linha 245 (fim de contas/DRE/caixa, antes de `# ---------- importações`). As notas novas são `pix`, então cada uma cria uma conta paga hoje e um fornecedor; nessa posição elas não mexem nas checagens de contas e DRE (linhas 223–245). Usa um ajudante `nota_cnpj CHAVE NUMERO SERIE [confirmar]`, que monta com `jq`:
    - fornecedor "Atacadão Smoke", `fornecedor_cnpj` `"12.abc.345/01de-35"`;
    - `origem` `xml`, `pix`, `valor_total` 1234.56;
    - um item `CAIXA SMOKE` de 1234.56, sem insumo;
    - `parcelas: []`, `serie: null` quando vazia e `confirmar_repetida` só quando passado.
  - **Checagens do bloco:**
    - **DV errado:** `…99960` → 400 `CHAVE_INVALIDA` com a frase.
    - **Nota alfanumérica:** `nota_cnpj '35 2611 12ab c345 01de 3555 0010 0000 4411 1000 0441 16' 4411 1` → 201. No banco, a chave fica igual ao vetor, `fornecedor_cnpj` fica `12ABC34501DE35` e existe fornecedor com esse CNPJ.
    - **Consultas:** `GET /v1/notas/existe?chave=<vetor em minúsculas>` → `true`; `GET /v1/vinculos?cnpj=12.345.678/0001-99` → `P01`.
    - **Fornecedor:** `POST /v1/fornecedores {"nome":"Forn Letras Smoke","cnpj":"12.abc.345/01de-35"}` → `.cnpj` `12ABC34501DE35`.
    - **Migração idempotente:**
      1. `INSERT` com pontuação em `fornecedores` e `notas_entrada` (a nota sem número, para não entrar nas contas da parte A);
      2. `sql "$(cat prisma/migrations/20261116140000_cnpj_alfanumerico/migration.sql)"`;
      3. as duas linhas saem normalizadas.
  - **Bloco do certificado:**
    - **Antes de "empresa sem CNPJ: 400":** `PATCH {"cnpj":"  "}` → 200 e `.cnpj` `""`.
    - **Logo depois de "CNPJ da empresa gravado":**
      1. `.cnpj` `12345678000195`;
      2. `PATCH {"cnpj":"12.345.678/0001-94"}` → 400 `CNPJ_INVALIDO` com a frase, e o banco segue com `12345678000195`;
      3. `PATCH {"mkup_padrao":2.5}` → 200;
      4. `PATCH {"cnpj":"12.abc.345/01de-35"}` → `12ABC34501DE35`;
      5. regrava `12.345.678/0001-95`, porque o resto do bloco depende dele.
- [ ] **Step 5: rodar**
  - jest do Step 2 passa;
  - typecheck limpo;
  - `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh` sem falhas novas (falha anterior que não toca notas nem CNPJ vai anotada no commit);
  - `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/nfe.test.ts` passa.
- [ ] **Step 6:** `git commit -m "feat(fiscal): CNPJ e chave de acesso com letras (normaliza, valida o DV e migra os dados)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 3: aviso de nota repetida na API

**Files:**
- Create: `api/src/common/fiscal/nota-repetida.ts`, `api/prisma/migrations/20261116140100_nota_repetida/migration.sql`
- Modify:
  - `api/prisma/schema.prisma` (model `notas_entrada`);
  - `api/src/modules/notas/notas.service.ts`, `notas.controller.ts`, `dto/notas.dto.ts`;
  - `api/src/scripts/import-lovable/esquema.ts`, `banco.ts` (`conferirEsquemaNosso`);
  - `api/src/common/__tests__/permissoes-protecao.spec.ts`, `api/scripts/smoke.sh`.
- Test: `api/src/common/fiscal/__tests__/nota-repetida.spec.ts`, `notas.service.spec.ts`, `notas.dto.spec.ts`, `api/src/scripts/import-lovable/__tests__/esquema.spec.ts`

**Interfaces:**
- Consumes: `normalizarCnpj` e `normalizarNumeroSerie` (Task 1); a ordem do `lancar` (Task 2).
- Produces:
  - `type RefNota = { cnpj: string | null; numero: string | null; serie: string | null }` e `pareceRepetida(a: RefNota, b: RefNota): boolean`.
  - `type NotaParecida = { id: string; numero: string | null; serie: string | null; fornecedor_nome: string; data_emissao: string; data_entrada: string; valor_total: number; origem: string; created_at: string }`. As datas vêm em `AAAA-MM-DD` (`dateToString`) e `created_at` em ISO.
  - `origemPorExtenso(origem: string): string`; origem desconhecida → `` `por ${origem}` ``.
  - `fraseNotaRepetida(p: NotaParecida[]): string`, com o modelo das Global Constraints e `p[0]` sendo a mais nova.
  - `NotasService.parecidas(ref: RefNota): Promise<NotaParecida[]>`.
  - `GET /v1/notas/repetidas?cnpj=&numero=&serie=` → até 5 (o controller corta).
  - `GET /v1/notas/existe` → `{ existe: boolean; nota: NotaParecida | null }`; o `existe` antigo continua.
  - `LancarNotaDto.confirmar_repetida?: boolean` (`@IsOptional() @IsBoolean()`).
- **Decisões:**
  - **Busca:** `findMany` por `fornecedor_cnpj` normalizado (o índice novo), `orderBy created_at desc`, e filtro por `pareceRepetida` em memória, porque `numero` é gravado cru. Sem CNPJ ou sem número após normalizar, não há consulta.
  - **No `lancar`:** se houver parecidas e `confirmar_repetida !== true`, 409 `NOTA_REPETIDA` com `fraseNotaRepetida`, antes da transação. Com a confirmação, grava `repetida_de = parecidas[0]?.id ?? null`.
  - **Quem confirmou** é o `usuario_id` da própria nota; nenhuma coluna nova para isso. Sem trava, como no desenho.
- **Migração `nota_repetida`:**
  - `ALTER TABLE "notas_entrada" ADD COLUMN "repetida_de" UUID;`
  - `ALTER TABLE "notas_entrada" ADD CONSTRAINT "notas_entrada_repetida_de_fkey" FOREIGN KEY ("repetida_de") REFERENCES "notas_entrada"("id") ON DELETE SET NULL ON UPDATE CASCADE;`
  - `CREATE INDEX "notas_entrada_fornecedor_cnpj_idx" ON "notas_entrada"("fornecedor_cnpj");`
  - A migração `notas_sefaz` da Etapa 1 não recria a coluna nem o índice.
- **Schema:** `repetida_de String? @db.Uuid`; `nota_original notas_entrada? @relation("nota_repetida", fields: [repetida_de], references: [id], onDelete: SetNull)`; `repeticoes notas_entrada[] @relation("nota_repetida")`; `@@index([fornecedor_cnpj])`.
- **Importador do Lovable:**
  - `esquema.ts` ganha `COLUNAS_SO_NOSSAS: Readonly<Record<string, readonly string[]>> = { notas_entrada: ['repetida_de'] }`. São colunas nossas em tabela do Lovable: ficam nulas na carga, que só insere `colunas`.
  - `conferirEsquemaNosso` desconta essas colunas antes de comparar.

- [ ] **Step 1: testes que falham**
  - **`nota-repetida.spec.ts`, `pareceRepetida`:**
    - verdadeiro com:
      - `'000.004.411'` × `'4411'`;
      - série `'001'` × `'1'` e `'000'` × `'0'`;
      - série só de um lado (`null` × `'1'`);
      - CPF `'123.456.789-09'` × `'12345678909'`;
      - `'12.abc.345/01de-35'` × `'12ABC34501DE35'`.
    - falso com:
      - séries `'1'` × `'2'`;
      - números diferentes ou CNPJ diferente;
      - CNPJ nulo ou vazio;
      - número nulo ou `'s/n'`.
  - **`nota-repetida.spec.ts`, `fraseNotaRepetida`:**
    - **Com série:** a nota `{ numero:'4411', serie:'1', fornecedor_nome:'ATACADÃO S.A.', data_entrada:'2026-11-03', valor_total:1234.56, origem:'foto' }` dá `'Já existe a NF 4411 série 1 de ATACADÃO S.A., lançada em 03/11/2026 por foto, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim.'`.
    - **Sem série:** a mesma frase sem `' série 1'`.
    - **Mais de uma:** com 2 itens, `'… de R$ 1.234,56 (e mais 1 parecida). Se for …'`; com 3, `'(e mais 2 parecidas)'`.
    - **Origens e valor:** `'xml'` → `'por XML'`, `'pdf'` → `'por PDF'`, `'sefaz'` → `'pela SEFAZ'`; 890 → `'R$ 890,00'`.
  - **`notas.service.spec.ts`:**
    - **Sem confirmação:** 409 `{ code: 'NOTA_REPETIDA', message: <frase> }` e `$transaction` não é chamada.
    - **Com `confirmar_repetida: true`:** `create.data.repetida_de` é o id da mais nova. Sem parecida, é `null`.
    - **Sem CNPJ:** `findMany` não é chamado.
    - **Precedência:** `DUPLICADO` e `CHAVE_INVALIDA` vencem `NOTA_REPETIDA`.
    - **`parecidas`:** consulta com `where.fornecedor_cnpj === '12ABC34501DE35'` e mantém a ordem.
    - **`existe`:** devolve `nota.numero`.
  - **`notas.dto.spec.ts`:** `confirmar_repetida: true` passa; `'sim'` falha.
  - **`esquema.spec.ts`:**
    - **FKs:** são 19, e a auto-referência (`filha === mae`) não entra na checagem de ordem.
    - **Teste novo:** todo `ALTER TABLE "t" ADD COLUMN "c"` das migrações está em `COLUNAS_SO_NOSSAS[t]`.
    - **Teste novo de `conferirEsquemaNosso`** (db falso: `{ n: 0 }` para a sequence, `[]` para os gatilhos): com `notas_entrada` + `repetida_de`, não sai erro começando por "colunas de"; com uma coluna `xyz` a mais, sai.
  - **`permissoes-protecao.spec.ts`:** `GET /v1/notas/repetidas` aparece como `admin`.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/common src/modules/notas src/scripts/import-lovable`. Esperado: FAIL.
- [ ] **Step 3: implementar** e depois rodar `../scripts/run-capped.sh 1500 npm run prisma:generate`.
- [ ] **Step 4: smoke, depois do bloco da Task 2.** `HOJE_BR=$(TZ=America/Sao_Paulo date +%d/%m/%Y)`.
  - **Consulta prévia:** `GET /v1/notas/repetidas?cnpj=12.abc.345/01de-35&numero=000.004.411&serie=001` → 1 nota, com `fornecedor_nome` "Atacadão Smoke" e `origem` `xml`.
  - **Repetida sem confirmação:** `nota_cnpj …44124 000.004.411 001` → 409 `NOTA_REPETIDA` com `"Já existe a NF 4411 série 1 de Atacadão Smoke, lançada em $HOJE_BR por XML, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim."`, e nenhuma linha com essa chave.
  - **Com confirmação:** a mesma nota com `true` → 201, e `repetida_de` = id da nota do vetor.
  - **Duas parecidas:** `nota_cnpj …44132 4411 1` → `"Já existe a NF 000.004.411 série 001 de Atacadão Smoke, lançada em $HOJE_BR por XML, de R$ 1.234,56 (e mais 1 parecida). Se for outra nota, confirme para lançar mesmo assim."`.
  - **Séries:** série 2 (`…44147`) → 201 sem confirmação; série vazia (`…44159`) → 409.
  - **Loja:** `GET /v1/notas/repetidas` como loja → 403.
  - **`existe` com detalhes:** `GET /v1/notas/existe?chave=<vetor>` → `.nota.numero` `4411`.
- [ ] **Step 5:** jest do Step 2, typecheck e lint passam; smoke sem falhas novas.
- [ ] **Step 6:** `git commit -m "feat(notas): aviso de nota repetida (consulta prévia, 409 NOTA_REPETIDA e confirmação gravada)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 4: IA nos itens do XML na API

**Files:**
- Create: `api/src/modules/leitura-pdf/sugerir-insumos.dto.ts`
- Modify:
  - `api/src/modules/leitura-pdf/leitor-pdf.port.ts` (o comentário de `arquivos` passa a dizer "ou nenhum: pedido só de texto");
  - `schemas.ts`, `sugestao-insumo.ts`, `leitura-pdf.service.ts`, `leitura-pdf.controller.ts`;
  - `api/src/common/__tests__/permissoes-protecao.spec.ts`, `api/scripts/smoke.sh`.
- Test: `__tests__/leitores-imagem.spec.ts`, `sugestao-insumo.spec.ts`, `leitura-pdf.service.spec.ts`, `sugerir-insumos.dto.spec.ts` (novo)

**Interfaces:**
- Consumes: `textoCatalogo`, `limparItens`, `ItemIa` (já existem).
- Produces:
  - `class LinhaSugestaoDto { descricao: string /* 1–500 */; unidade?: string | null /* ≤ 20 */ }` e `class SugerirInsumosDto { itens: LinhaSugestaoDto[] /* 1–200 */ }`.
  - `type SugestaoItem = { item_estoque_id: string | null; novo: { nome: string; unidade: string; subgrupo: string | null } | null; fator: number }`.
  - `linhasNumeradas(itens: { descricao: string; unidade?: string | null }[]): string`, no formato `"1. PICANHA BOVINA KG (KG)\n2. SACOLA"` (índice começa em 1).
  - `type SugestaoIa = { indice: number; insumo: string | null; novo_nome: string | null; novo_unidade: string | null; novo_subgrupo: string | null; fator: number }`.
  - `casarPorIndice(resposta: unknown[], n: number): (Omit<SugestaoIa, 'indice'> | null)[]`: devolve n posições. Índice inteiro de 1 a n; repetido, o primeiro vence; fora disso, ignorado; faltando, `null`.
  - `LeituraPdfService.sugerirInsumos(itens: { descricao: string; unidade?: string | null }[]): Promise<{ itens: SugestaoItem[] }>`.
  - `POST /v1/notas/sugerir-insumos`, `@HttpCode(200)`.
  - `SCHEMA_SUGESTAO_ITENS`:
    - `{ itens: [{ indice: integer, insumo, novo_nome, novo_unidade, novo_subgrupo: string|null, fator: number }] }`;
    - com `additionalProperties: false` e tudo em `required` nos dois níveis;
    - as descrições de `insumo`, `novo_*` e `fator` são as do `SCHEMA_NOTA_SUGESTAO`.
  - `INSTRUCOES_SUGESTAO_ITENS` segue o mesmo texto do `INSTRUCOES_NOTA_SUGESTAO` para insumo, novo e fator, e acrescenta: "devolva um item por linha, com `indice` = o número da linha".
- **Decisões:**
  - **O pedido:**
    - arquivos `[]`;
    - texto `"Indique o insumo do estoque de cada linha desta nota fiscal.\n\n${textoCatalogo(...)}\n\nLinhas da nota:\n${linhasNumeradas(...)}"`;
    - insumos ativos e subgrupos carregados como no `lerNota`.
  - **A resposta:**
    - Entrada e resposta se juntam por índice num `ItemIa` com `codigo: null` e quantidade e valores 0. Faltando, `insumo` e `novo_*` ficam `null` e `fator` fica 1.
    - O resultado passa por `limparItens` e a rota devolve só `{ item_estoque_id, novo, fator }`.
    - Resposta sem `itens` em array → `LeituraPdfErro(…, 422, 'SUGESTAO_ILEGIVEL')`.
    - Os erros do leitor (503 `PDF_NAO_CONFIGURADO` e os demais) passam pelo `comoHttp`.

- [ ] **Step 1: testes que falham**
  - `leitores-imagem.spec.ts`, pedido sem arquivo:
    - `blocosClaude([])` → `[]`;
    - OpenAI: `messages[1].content` → `[{ type: 'text', text: 'extraia' }]`;
    - Gemini: `parts` → `[{ text: 'extraia' }]`.
  - `sugestao-insumo.spec.ts`:
    - `linhasNumeradas` produz exatamente a string acima.
    - **`casarPorIndice(r, 3)`:**
      - os índices `[3, 1]` caem nas posições 2 e 0, e a posição 1 fica `null`;
      - o índice 1 repetido deixa valer o primeiro;
      - os índices 0, 4 e 1.5 são ignorados.
  - `leitura-pdf.service.spec.ts`, `sugerirInsumos` com `LeitorFalso` para 3 linhas (`TOMATE ITALIANO`/`KG`, `SACOLA PLASTICA`/`un`, `FRETE`/sem unidade):
    - **O pedido:**
      - `pedidos[0].arquivos` = `[]`;
      - `schema` é `SCHEMA_SUGESTAO_ITENS`;
      - o texto contém `'- Tomate (KG)'` e `'1. TOMATE ITALIANO (KG)'`.
    - **A resposta, `[{indice:2, insumo:null, novo_nome:'Sacola plástica', novo_unidade:'un', novo_subgrupo:'hortifruti', fator:0}, {indice:1, insumo:'tomate', novo_nome:null, novo_unidade:null, novo_subgrupo:null, fator:1}]`, vira:**
      - `[{ item_estoque_id:'i1', novo:null, fator:1 }`,
      - `{ item_estoque_id:null, novo:{ nome:'Sacola plástica', unidade:'UN', subgrupo:'Hortifruti' }, fator:1 }`,
      - `{ item_estoque_id:null, novo:{ nome:'FRETE', unidade:'UN', subgrupo:null }, fator:1 }]`.
    - **Falhas:**
      - resposta `{ foo: 1 }` → `LeituraPdfErro('Não consegui sugerir os insumos desta nota.', 422, 'SUGESTAO_ILEGIVEL')`;
      - leitor que lança 503 `PDF_NAO_CONFIGURADO` → o mesmo erro.
  - `sugerir-insumos.dto.spec.ts`:
    - 1 linha passa;
    - falham: 0 linhas, 201 linhas, descrição com 501 caracteres, unidade com 21;
    - falham também, por `forbidNonWhitelisted`: `valor_total` numa linha e `chave` no topo.
  - `permissoes-protecao.spec.ts`: `POST /v1/notas/sugerir-insumos` aparece como `admin`.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/leitura-pdf src/common/__tests__/permissoes-protecao.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4: smoke**, ao lado dos testes de `ler-foto`:
  - o admin sem chave de IA recebe 503 `PDF_NAO_CONFIGURADO`;
  - a loja recebe 403;
  - `{"itens":[]}` dá 400;
  - 201 linhas (geradas por `jq`) dão 400;
  - uma linha com `valor_total` dá 400.
- [ ] **Step 5:** jest do Step 2, typecheck, lint e smoke passam.
- [ ] **Step 6:** `git commit -m "feat(leitura): sugestão de insumo por IA para os itens do XML (rota só de texto)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 5: web com CNPJ com letras e número e série separados

**Files:**
- Create: `web/src/lib/fiscal.ts`
- Modify:
  - `web/src/lib/dda.ts:31`;
  - `web/src/app/(app)/configuracoes/page.tsx:50,78`;
  - `web/src/app/(app)/notas/page.tsx:143-145`;
  - `web/scripts/browser-check.mjs`.
- Test: `web/src/lib/__tests__/fiscal.test.ts`, `web/src/lib/__tests__/dda.test.ts`

**Interfaces:**
- Produces:
  - Cópias iguais às da API, com os mesmos vetores: `normalizarCnpj`, `cnpjValido`, `normalizarChave`, `chaveValida` e `normalizarNumeroSerie`.
  - `cpfValido(c: string): boolean`.
  - `documentoConfere(s: string | null | undefined): boolean`: vazio → `true`; 14 caracteres → `cnpjValido`; 11 → `cpfValido`; outro tamanho → `false`.

- [ ] **Step 1: testes que falham**
  - `fiscal.test.ts`: os vetores da Task 1, mais:
    - `cpfValido('12345678909')` é verdadeiro e `('12345678900')` é falso;
    - `documentoConfere('12345678000199')` é falso (o XML de teste);
    - `documentoConfere('12ABC34501DE35')` e `documentoConfere(null)` são verdadeiros.
  - `dda.test.ts`: o cabeçalho "cnpj" `'12.abc.345/01de-35'` vira `'12ABC34501DE35'`, e a linha digitável continua `'12345678'`.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/fiscal.test.ts src/lib/__tests__/dda.test.ts`. Esperado: FAIL.
- [ ] **Step 3: implementar**
  - **CNPJ da nota:** usa `normalizarCnpj(v) || null`. Logo abaixo, quando `!documentoConfere(...)`, aparece `CircleAlert` + "CNPJ/CPF não confere" em `text-warning`. O aviso não bloqueia.
  - **"Número / série"** vira dois `Input`, "Número" e "Série", na mesma célula da grade. Cada um grava o seu campo, e a série vazia vira `null`. O campo único controlado engolia a barra.
  - **Configurações:** o `Input` do CNPJ perde o `inputMode`. Ao carregar, `formatarCnpj(cfg.cnpj)` (de `@/lib/certificado`).
- [ ] **Step 4: acrescentar ao `browser-check.mjs`** (só roda na Task 8)
  - **1º bloco:**
    - "CNPJ/CPF não confere" aparece, porque o CNPJ do XML de teste tem DV errado de propósito;
    - os campos mostram Número `1234` e Série `1`.
  - **Bloco do certificado, antes da linha 175:**
    1. preencher `12.abc.345/01de-35` e Salvar → "Configurações salvas" e o campo mostra `12.ABC.345/01DE-35`;
    2. preencher `12.345.678/0001-94` e Salvar → aparece "CNPJ inválido. Confira os 14 caracteres (pode ter letras).";
    3. a linha 175 segue como está.
- [ ] **Step 5:** o vitest do Step 2 passa; `yarn typecheck` e `yarn lint` saem limpos (capados, 1500).
- [ ] **Step 6:** `git commit -m "feat(web): CNPJ com letras na nota, em Configurações e no DDA; número e série separados" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 6: web com a faixa de nota repetida e o diálogo

**Files:**
- Create: `web/src/lib/nota-repetida.ts`, `web/src/components/nota-repetida-faixa.tsx`
- Modify: `web/src/lib/erp-api.ts` (bloco `// ---------- notas` e tipo `Nota`), `web/src/app/(app)/notas/page.tsx`, `web/scripts/browser-check.mjs`
- Test: `web/src/lib/__tests__/nota-repetida.test.ts`

**Interfaces:**
- Consumes: rotas da Task 3; `normalizarCnpj` e `normalizarNumeroSerie` (Task 5).
- Produces:
  - **`erp-api.ts`:**
    - `type NotaParecida`, igual à da API;
    - `Nota` ganha `serie: string | null; repetida_de: string | null`;
    - `notaPelaChave(chave: string): Promise<NotaParecida | null>`, que substitui `notaExiste`;
    - `notasRepetidas(p: { cnpj: string; numero: string; serie: string | null }): Promise<NotaParecida[]>`.
  - **`nota-repetida.ts`:**
    - `origemPorExtenso` e `fraseNotaRepetida`, iguais às da API e com os mesmos testes;
    - `fraseChaveIgual(n: NotaParecida): string`;
    - `linhaNota(n: NotaParecida): string` e `linhaEntrada(n: NotaParecida): string`;
    - `chaveDaConsulta(cnpj: string | null, numero: string | null, serie: string | null): string | null`: dá `null` sem CNPJ ou sem número; os três vão normalizados.
  - **`nota-repetida-faixa.tsx`:**
    - `type EstadoRepetida = { tipo: 'chave_igual'; nota: NotaParecida } | { tipo: 'parecida'; parecidas: NotaParecida[]; confirmada: boolean }`;
    - `NotaRepetidaFaixa(p: { estado: EstadoRepetida; focar: boolean; onNaoLancar(): void; onConfirmar(): void; onVoltarAtras(): void })`;
    - `NotaRepetidaDialogo(p: { frase: string | null; onNaoLancar(): void; onLancar(): void })`, aberto quando `frase !== null`.
- **Decisões na página:**
  - **Leitura:**
    - Depois de ler, `notaPelaChave` substitui o toast antigo.
    - Se achar a nota, a conferência abre com a faixa vermelha e "Dar entrada" desabilitado; só existe "Não lançar esta nota".
    - O estado `chaveConsulta` é gravado na leitura e no `onBlur` de CNPJ, Número e Série. Não há pedido a cada tecla.
  - **Consulta e confirmação:**
    - A consulta usa a chave `['notas-repetidas', chaveConsulta]`, com `enabled: !!chaveConsulta && !chaveIgual` e `retry: false`. Com erro, não aparece faixa.
    - `confirmadaPara: string | null` só vale quando é igual a `chaveConsulta`, e volta a `null` sempre que `chaveConsulta` muda.
  - **"Dar entrada":**
    - Faixa parecida ainda não confirmada → o diálogo abre com a `fraseNotaRepetida` local, sem chamar o servidor.
    - 409 `NOTA_REPETIDA` (`errCode`) → o diálogo abre com o `errMsg`.
    - No diálogo, "Lançar mesmo assim" confirma e reenvia com `confirmar_repetida: true`. "Não lançar" (foco inicial; Esc também) só fecha o diálogo.
  - **"Não lançar esta nota"**, na faixa, faz o mesmo que Cancelar, mostra o toast e leva o foco ao campo de arquivo (`ref`).
  - **Foco e rolagem:** a faixa (`role="alert"`, `tabIndex={-1}`) fica acima do quadro "2. Dados da nota". Recebe foco e rolagem só se `!tocou`; um `onInputCapture` no contêiner da conferência marca `tocou`.
  - **Datas e "e mais N":** a data da faixa âmbar e a da caixa vermelha são a `data_entrada` (a mesma da frase do 409). "e mais N parecidas" é um `<details>` com até 4 linhas, cada uma `linhaNota` + `linhaEntrada`; com uma parecida só, não aparece.
  - **Na lista "Notas lançadas":** `Tag` "confirmada como outra nota" quando a nota tem `repetida_de`.

- [ ] **Step 1: testes que falham** (`nota-repetida.test.ts`)
  - as frases da Task 3, literalmente;
  - `fraseChaveIgual` → `'Esta nota já foi lançada. A chave de acesso é a mesma de NF 4411 (ATACADÃO S.A.), de 03/11/2026. Não dá para lançar duas vezes.'`;
  - `linhaNota` → `'NF 4411 · série 1 · R$ 1.234,56'`; sem série → `'NF 4411 · R$ 1.234,56'`;
  - `linhaEntrada` → `'Entrou em 03/11/2026 por foto'`;
  - `chaveDaConsulta('12.abc.345/01de-35', '000.004.411', '001') === chaveDaConsulta('12ABC34501DE35', '4411', '1')`;
  - série `'2'` dá chave diferente; `(null, '1', '1')` e `('12ABC34501DE35', '', '1')` dão `null`.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/nota-repetida.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4: acrescentar ao `browser-check.mjs`** o bloco "ADMIN: nota repetida (celular 360x800)", depois do bloco da faixa do certificado. Ele usa o XML do 1º bloco e um `XML2`, igual mas com a chave `…12390`.
  - **Chave igual:**
    1. o XML gera a caixa vermelha com a data de hoje em Brasília e "Dar entrada" desabilitado;
    2. "Não lançar esta nota" mostra o toast e deixa o foco em `input[type=file]`.
  - **Nota parecida:**
    1. o `XML2` gera a faixa âmbar com foco (`document.activeElement` com `role=alert`);
    2. "Dar entrada" abre um `alertdialog` com o título exato e foco em "Não lançar"; Esc fecha;
    3. "É outra nota, lançar mesmo assim" mostra o texto de confirmação;
    4. Série `2` + blur faz a faixa sumir; Série `1` + blur traz a faixa âmbar de novo, sem confirmação;
    5. confirmar e "Dar entrada" levam ao toast "Entrada lançada no estoque" e à tag "confirmada como outra nota".
  - **Largura:** `quemPassaDaBorda(page, 360).scroll <= 360`.
  - **Console:** sem erro, filtrando "Failed to load resource".
- [ ] **Step 5:** o vitest passa; `yarn typecheck` e `yarn lint` saem limpos.
- [ ] **Step 6:** `git commit -m "feat(web): faixa de nota repetida, caixa vermelha de chave igual e diálogo no Dar entrada" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 7: web com a IA nos itens do XML

**Files:**
- Create: `web/src/lib/sugestao-ia.ts`
- Modify: `web/src/lib/erp-api.ts`, `web/src/app/(app)/notas/page.tsx`, `web/scripts/browser-check.mjs`
- Test: `web/src/lib/__tests__/sugestao-ia.test.ts`

**Interfaces:**
- Consumes: `POST /v1/notas/sugerir-insumos` (Task 4), `statusIa`, `sugerirInsumo` (`nfe.ts`) e `errCode`.
- Produces:
  - **`erp-api.ts`:**
    - `type SugestaoInsumo = { item_estoque_id: string | null; novo: { nome: string; unidade: string; subgrupo: string | null } | null; fator: number }`;
    - `sugerirInsumosItens(itens: { descricao: string; unidade: string | null }[], signal?: AbortSignal): Promise<{ itens: SugestaoInsumo[] }>`.
  - **`sugestao-ia.ts`:**
    - as constantes `PRAZO_IA_MS = 20_000` e `LOTE_IA = 200`;
    - `type ResultadoIa = { tipo: 'ia'; itens: SugestaoInsumo[] } | { tipo: 'sem_chave' } | { tipo: 'falhou' }`;
    - `sugerirEmLotes(itens, chamar: (lote, signal: AbortSignal) => Promise<{ itens: SugestaoInsumo[] }>, op: { semChave: (e: unknown) => boolean; prazoMs?: number }): Promise<ResultadoIa>`. Faz lotes em sequência, com um único prazo para todos. Ao estourar, aborta o `signal` e devolve `falhou`. Lote com tamanho de resposta diferente → `falhou`.
    - `type LinhaSugerivel = { descricao: string; item_estoque_id: string; novo: { nome: string; unidade: string; subgrupo: string } | null; sugerido: boolean; fator: string; pendenteIa: boolean; tocada: boolean; fatorTocado: boolean }`;
    - `aplicarSugestoes<L extends LinhaSugerivel>(linhas: L[], r: ResultadoIa, insumos: { id: string; nome: string }[]): L[]`.
- **Como `aplicarSugestoes` age:**
  - O k-ésimo item do resultado vai para a k-ésima linha com `pendenteIa`.
  - Toda linha pendente sai com `pendenteIa: false`.
  - Linha `tocada` não muda; com `fatorTocado`, o `fator` não muda.
  - Com `ia`, aplica `item_estoque_id` (marcando `sugerido`) ou `novo` (com `subgrupo ?? ''`). Com `sem_chave` ou `falhou`, aplica `sugerirInsumo` por palavras.
- **Decisões na página:**
  - **Só para XML** (PDF e foto já trazem a sugestão). Com chave igual (caixa vermelha, sem saída), não chama a IA nem o `statusIa`, e as linhas recebem as palavras, como hoje.
  - **Antes de chamar:** `qc.fetchQuery({ queryKey: ['ia-chave'], queryFn: statusIa })`.
    - `origem === null` → sem chamada, sugestão por palavras na hora; nada muda na tela.
    - Se o `statusIa` falhar, chama assim mesmo.
  - **Linhas sem vínculo** nascem com `pendenteIa` só quando a chamada vai acontecer (origem ≠ `null`); sem chave, recebem as palavras na hora, como hoje.
  - **Descarte:** um `ref` de geração descarta a resposta tardia. Ele avança em arquivo novo, Cancelar, "Não lançar esta nota" e no sucesso do "Dar entrada".
  - **O que marca a linha:**
    - `escolherInsumo` e `setNovo` marcam `tocada`;
    - editar o fator marca `fatorTocado`.
  - **Enquanto espera:**
    - o seletor da linha pendente fica desabilitado, com a opção "Sugerindo…" e `Loader2`;
    - o título ganha "· sugerindo insumos…" (`aria-live="polite"`);
    - "Dar entrada" fica desabilitado, com a linha de espera.
  - **Depois:**
    - com `ia`, aparece a linha da IA acima da tabela;
    - com `falhou` (inclusive pelos 20 s), aparece a linha discreta `text-muted-foreground`;
    - com `sem_chave`, nada.

- [ ] **Step 1: testes que falham** (`sugestao-ia.test.ts`, com `vi.useFakeTimers()`)
  - **Lotes:** 450 itens geram 3 chamadas, com tamanhos `[200, 200, 50]` nessa ordem, e o resultado tem 450 itens na ordem.
  - **Prazo:** `chamar` que nunca resolve, depois de `advanceTimersByTime(20_000)`, dá `{ tipo: 'falhou' }` e o `signal.aborted` fica verdadeiro.
  - **Erros:** um erro com `semChave` verdadeiro dá `sem_chave`; outro erro dá `falhou`. Lote de 3 respondido com 2 itens dá `falhou`. 0 itens dá `{ tipo: 'ia', itens: [] }` sem chamar.
  - **`aplicarSugestoes`:**
    - IA com `item_estoque_id` `'i1'` deixa a linha com `sugerido: true`;
    - IA com `novo` deixa `item_estoque_id: ''`;
    - fator 12 vira `'12'`, mas com `fatorTocado` fica o fator digitado;
    - linha `tocada` não muda;
    - `sem_chave` sugere "Picanha" para `'PICANHA BOVINA KG'`;
    - linha sem `pendenteIa` não muda.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/sugestao-ia.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4: acrescentar ao `browser-check.mjs`**
  - **1º bloco, sem chave:**
    - "Sugerindo" aparece 0 vezes;
    - "inteligência artificial agora" aparece 0 vezes;
    - "sugestão — confira" continua aparecendo 1 vez.
  - **Bloco da Task 6, no início, antes do primeiro `page.goto`:** usa `page.route`, que não é rede. Registrar antes é obrigatório: o `QueryClient` guarda `['ia-chave']` por 10 s (`staleTime`), e uma resposta real `origem: null` em cache faria o `XML2` pular a IA.
    - `**/v1/ia-chave` → `{ origem: 'configuracoes', provedor: 'anthropic', nome: 'Claude', dica: '••••1234' }`.
    - `**/v1/notas/sugerir-insumos` → espera 1500 ms e devolve `{ itens: [{ item_estoque_id: null, novo: { nome: 'Taxa de entrega', unidade: 'UN', subgrupo: null }, fator: 1 }] }`.
    - Toda resposta leva `access-control-allow-origin: http://localhost:3026` e `access-control-allow-headers: authorization, content-type`. `OPTIONS` → 204.
  - **Checagens do bloco:**
    - durante a espera, aparecem "Sugerindo…" e a linha de espera, e "Dar entrada" fica desabilitado;
    - depois, aparecem a linha da IA e "novo — confira".
- [ ] **Step 5:** o vitest passa; `yarn typecheck` e `yarn lint` saem limpos.
- [ ] **Step 6:** `git commit -m "feat(web): sugestão de insumo por IA nos itens do XML, com espera de até 20 s" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 8: contrato, regras e verificação completa

**Files:**
- Modify: `docs/api-contract.md` (§ configurações, linha ~46; § notas, linhas ~86–104) e `CLAUDE.md` (Regras rápidas, uma linha).

- [ ] **Step 1: documentar no contrato**
  - `GET /v1/notas/existe` → `{ existe, nota }`;
  - `GET /v1/notas/repetidas`;
  - `POST /v1/notas` com `confirmar_repetida`, `CHAVE_INVALIDA`, `NOTA_REPETIDA` (a frase) e `repetida_de`;
  - `POST /v1/notas/sugerir-insumos`;
  - `PATCH /v1/configuracoes` com `CNPJ_INVALIDO`;
  - a normalização de CNPJ e chave.
- [ ] **Step 2: acrescentar a linha no `CLAUDE.md`:** "CNPJ e chave: `api/src/common/fiscal` e `web/src/lib/fiscal.ts` iguais (como a ficha); normalizar = maiúsculas + `[0-9A-Z]`, nunca `\D` (só a linha digitável do DDA)".
- [ ] **Step 3: verificação completa**, um comando por vez, capado, anotando os números:
  1. `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/common src/scripts`
  2. `… npx jest --runInBand src/modules/notas src/modules/cadastros src/modules/leitura-pdf src/modules/certificado-digital`
  3. `… npx jest --runInBand src/modules --testPathIgnorePatterns 'modules/(notas|cadastros|leitura-pdf|certificado-digital)/'`
  4. `… npm run typecheck`
  5. `… npm run lint`
  6. `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh`
  7. `cd ../web && ../scripts/run-capped.sh 1500 yarn test`
  8. `… yarn typecheck`
  9. `… yarn lint`
  10. `../scripts/run-capped.sh 2600 bash scripts/browser-check.sh`: **uma tentativa só**. Saída 137 ou 75 é registrada como "não rodou (memória)", e a tarefa segue.
- [ ] **Step 4:** `git commit -m "docs(notas): contrato e regras da entrega 1 das notas da SEFAZ" -m "<números da verificação>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Auto-revisão

**Cobertura do desenho:**

| Parte | Onde |
|---|---|
| Etapa 0 (cada linha da tabela do desenho) | Task 2: `notas.service`, `existe`/`vinculos`, leitura e `schemas`, `cadastros`, migração · Task 5: `page.tsx` (CNPJ, número/série), Configurações, `dda.ts` |
| A | Task 3: regra, consulta prévia, 409, `repetida_de`, índice · Task 6: faixa e diálogo |
| B | Task 4: porta com 0 arquivos, rota, esquema, casamento por índice · Task 7: tela, 20 s, sem chave, lotes de 200 |

**Tipos conferidos entre tarefas:**
- `NotaParecida` é igual na API e no web.
- `SugestaoItem` (API) tem o mesmo formato que `SugestaoInsumo` (web).
- `normalizarNumeroSerie` é usado nas Tasks 1, 3 e 6.

## Pontos em aberto para o controlador

1. **Origem na frase do 409:** o desenho escreve "por FOTO"; a especificação de interface pede origem por extenso sem caixa alta (§1, §5 e §6, "por foto"). O plano usa "por foto". **Recomendo manter.** Se o dono preferir a caixa alta, só muda `origemPorExtenso`.
2. **Vetor do Anexo da NT Conjunta 2025.001:** não foi conferido, porque o portal recusou a leitura (redirecionamentos). O plano usa um vetor calculado à mão, com a conta escrita. **Recomendo** acrescentar o vetor do Anexo como 2º caso na Task 1 quando alguém abrir o PDF.
3. **`origem: 'sefaz'`:** o desenho lista essa origem junto das partes 0, A e B. O plano a adia para o "Conferir" da Etapa 1, porque hoje nenhuma tela a envia. **Recomendo adiar.**
4. **Só para ciência (já resolvido no plano): importador do Lovable.** `repetida_de` é a 1ª coluna nossa numa tabela do Lovable, e o plano resolve com `COLUNAS_SO_NOSSAS` (Task 3). Se o importador estiver aposentado desde a virada de 11/11, ele pode ser apagado num PR à parte.
