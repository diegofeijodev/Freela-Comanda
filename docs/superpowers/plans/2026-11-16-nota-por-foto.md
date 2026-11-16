# Nota por foto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Entrada de Notas aceita foto (1–4 imagens), a IA preenche a conferência e o insumo que faltar é cadastrado no "Dar entrada".

**Architecture:** A porta `LEITOR_PDF` passa a receber uma lista de arquivos (PDF ou imagens) e cada leitor monta o bloco do seu provedor. A leitura de nota usa um esquema estendido (insumo existente / sugestão de novo / fator), limpo no servidor. `NotasService.lancar` cria os insumos novos dentro da mesma transação.

**Tech Stack:** NestJS + Fastify + Prisma (api, npm) · Next 15 + TanStack Query (web, yarn) · jest, vitest, smoke em bash, browser-check.

**Spec:** `docs/superpowers/specs/2026-11-16-nota-por-foto-design.md`

## Global Constraints

- Ramo `feat/nota-por-foto`; um commit por tarefa; sem push, sem deploy.
- Comando pesado só por `scripts/run-capped.sh` (jest/tsc/eslint 1500; smoke 1300; browser-check 2600); um por vez; jest sempre `--runInBand <arquivos>`; nunca `nest build`/`next build`.
- Nenhum teste faz rede (leitor falso / `HTTP_IA` falso).
- Toda rota nova com `@AdminOnly()` e listada em `api/src/common/__tests__/permissoes-protecao.spec.ts`; a loja não alcança nada novo.
- Erros `{ error: { code, message } }` em pt-BR; no web ler com `errMsg()`; HTTP só em `web/src/lib/erp-api.ts`.
- Tipos de imagem: `image/jpeg`, `image/png`, `image/webp`; máx. 4 fotos; 10 MB por arquivo.
- Frases exatas: "Não consegui identificar os dados desta foto." · "O arquivo não é uma imagem (JPG, PNG ou WebP)." · "Envie até 4 fotos da mesma nota." · "Não consegui abrir esta imagem. Envie em JPG ou PNG." · "XML é lido na hora e com exatidão. PDF e foto são lidos por inteligência artificial — confira os valores." · painel "Leitura de notas por IA (PDF e foto)".

## Review Focus

1. Foto de lado/de cabeça para baixo (EXIF) → a imagem enviada sai na orientação certa (Task 4, teste de `reduzirImagem` com orientação).
2. IA devolve `insumo` que não existe ou inativo → vira "Cadastrar novo", nunca id inventado (Task 2, teste de `limparItens`).
3. Nome novo igual a insumo existente com outra caixa/acentos ("requeijão" × "REQUEIJAO") → usa o existente, não duplica (Task 3, smoke).
4. Falha no meio do "Dar entrada" (ex.: parcela sem vencimento depois de criar insumo) → nenhum insumo fica criado (Task 3, smoke).
5. Linha que não é estoque (frete, taxa) vinda como "Cadastrar novo" → dá para trocar para "— não lançar —" e nada é criado (Task 5, browser-check).

---

### Task 1: Porta e leitores aceitam imagem

**Files:**
- Modify: `api/src/modules/leitura-pdf/leitor-pdf.port.ts`, `claude-leitor-pdf.ts`, `ia/openai-leitor-pdf.ts`, `ia/gemini-leitor-pdf.ts`, `ia/ia-chave.service.ts` (teste da chave), `leitura-pdf.service.ts`
- Test: `api/src/modules/leitura-pdf/__tests__/leitores-imagem.spec.ts` (novo); ajustar `ia-chave.spec.ts` e `leitura-pdf.service.spec.ts`

**Interfaces:**
- Produces: `type MimeArquivo = 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp'`; `interface ArquivoLeitura { base64: string; mime: MimeArquivo; nome: string }`; `PedidoLeitura.arquivos: ArquivoLeitura[]` (substitui `pdfBase64`/`nomeArquivo`); `export function blocosClaude(a: ArquivoLeitura[]): unknown[]` em `claude-leitor-pdf.ts`.

- [ ] **Step 1: testes que falham** — `leitores-imagem.spec.ts`:
  - `blocosClaude([jpeg])` → `[{ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } }]`; PDF continua `{ type: 'document', … media_type: 'application/pdf', title: nome }`.
  - OpenAI com `HttpIa` falso: 2 imagens → `messages[1].content` tem 2 partes `{ type: 'image_url', image_url: { url: 'data:image/png;base64,…' } }` + a parte de texto; PDF continua parte `file`.
  - Gemini com `HttpIa` falso: imagem → `parts[0].inlineData.mimeType === 'image/webp'`.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/leitura-pdf` → falha (tipos/funcões inexistentes).
- [ ] **Step 3:** trocar o contrato da porta e adaptar os três leitores, `lerNota`/`lerDDA` (`arquivos: [{ base64, mime: 'application/pdf', nome }]`) e `IaChaveService.testar`.
- [ ] **Step 4:** mesmo comando do Step 2 → passa; `../scripts/run-capped.sh 1500 npm run typecheck` limpo.
- [ ] **Step 5:** `git commit -m "feat(leitura): porta de leitura aceita imagens (Claude, ChatGPT, Gemini)"`

### Task 2: Leitura de nota com sugestão de insumo + rota `ler-foto`

**Files:**
- Modify: `api/src/modules/leitura-pdf/schemas.ts`, `leitura-pdf.service.ts`, `leitura-pdf.controller.ts`, `leitura-pdf.module.ts` (se precisar do Prisma), `api/src/main.ts` (`files: 4`), `api/src/common/__tests__/permissoes-protecao.spec.ts`
- Create: `api/src/modules/leitura-pdf/sugestao-insumo.ts`, `api/src/common/parse/normaliza.ts`
- Test: `api/src/modules/leitura-pdf/__tests__/sugestao-insumo.spec.ts`; `leitura-pdf.service.spec.ts`

**Interfaces:**
- Consumes: `ArquivoLeitura`, `PedidoLeitura.arquivos` (Task 1).
- Produces:
  - `normalizaNome(s: string): string` (minúsculas, sem acento, espaços colapsados, trim) em `common/parse/normaliza.ts`.
  - `SCHEMA_NOTA_SUGESTAO` = `SCHEMA_NOTA` com itens acrescidos de `insumo: string|null`, `novo_nome: string|null`, `novo_unidade: string|null`, `novo_subgrupo: string|null`, `fator: number` (todos em `required`).
  - `textoCatalogo(insumos: { nome: string; unidade: string }[], subgrupos: string[]): string` e `limparItens(itens: ItemIa[], insumos: { id: string; nome: string }[], subgrupos: string[]): ItemLido[]`, com `ItemLido = ItemNota & { item_estoque_id: string | null; novo: { nome: string; unidade: string; subgrupo: string | null } | null; fator: number }`.
  - `LeituraPdfService.lerNota(arquivos: ArquivoLeitura[])` (PDF e foto; busca insumos ativos + subgrupos, usa o esquema estendido, devolve itens já limpos).
  - `POST /v1/notas/ler-foto` (multipart, 1–4 imagens) → mesma forma de resposta de `ler-pdf`.

- [ ] **Step 1: testes que falham** — `sugestao-insumo.spec.ts`:
  - `limparItens`: `insumo: 'TOMATE'` com insumo ativo "Tomate" → `item_estoque_id` dele e `novo: null`; `insumo: 'Inexistente'` → `item_estoque_id: null`, `novo.nome = novo_nome || descricao`; `novo_subgrupo` fora da lista → `null`; `fator` 0, negativo ou NaN → 1; `novo_unidade` vazio → unidade da nota em maiúsculas ou `'UN'`.
  - `normalizaNome('  Requeijão   CREMOSO ') === 'requeijao cremoso'`.
  - serviço (leitor falso): `lerNota` com 2 imagens repassa `arquivos` de tamanho 2 e pedido contendo o texto do catálogo; resposta sem `itens` → `LeituraPdfErro` 422 "Não consegui identificar os dados desta foto." quando não há PDF, e a frase atual quando é PDF.
  - `permissoes-protecao.spec.ts`: `POST /v1/notas/ler-foto` é AdminOnly.
- [ ] **Step 2:** `npx jest --runInBand src/modules/leitura-pdf src/common/__tests__/permissoes-protecao.spec.ts` (capado) → falha.
- [ ] **Step 3:** implementar. No controller, `lerImagens(req)`: `req.files()` até 4; 5º arquivo → 400 `ARQUIVO_INVALIDO` "Envie até 4 fotos da mesma nota."; tipo pelos bytes iniciais (JPEG `FF D8 FF`, PNG `89 50 4E 47`, WebP `RIFF….WEBP`), senão 400 "O arquivo não é uma imagem (JPG, PNG ou WebP)."; vazio/truncado → frase atual de 10 MB. `ler-pdf` passa a devolver itens também limpos (mesmo `lerNota`). Sem chave na rota da foto: `PDF_NAO_CONFIGURADO` com "Leitura de nota não configurada: cadastre a chave de uma IA em Configurações.".
- [ ] **Step 4:** jest do Step 2 passa; typecheck e `npm run lint` limpos.
- [ ] **Step 5:** `git commit -m "feat(notas): leitura de foto com sugestão de insumo (rota ler-foto)"`

### Task 3: "Dar entrada" cadastra o insumo novo

**Files:**
- Modify: `api/src/modules/notas/dto/notas.dto.ts`, `api/src/modules/notas/notas.service.ts`, `api/scripts/smoke.sh`
- Test: `api/src/modules/notas/__tests__/notas.dto.spec.ts` (novo) + smoke

**Interfaces:**
- Consumes: `normalizaNome` (Task 2).
- Produces: `class NovoInsumoDto { nome: string (1–200); unidade: string (1–20); subgrupo?: string | null (≤120) }`; `ItemNotaDto.novo_insumo?: NovoInsumoDto | null`; `LancarNotaDto.origem: 'xml' | 'pdf' | 'foto'`; resposta de `POST /v1/notas` ganha `insumos_criados: number`.

- [ ] **Step 1: testes que falham** — DTO: item com `novo_insumo` válido passa; `novo_insumo` sem nome falha; `origem: 'foto'` passa. Smoke (depois do bloco "entrada de nota"):
  - nota `origem: foto` com `novo_insumo { nome: 'Requeijão Smoke', unidade: 'un', subgrupo: 'Laticínios' }`, qtd 2, valor 89, fator 12 → 201, `insumos_criados` 1; no banco: unidade `UN`, `preco_unitario` ≈ 7.4167, `qtd_por_embalagem` 12, `fornecedor` = nome do fornecedor; movimentação de 24.
  - segunda nota com `novo_insumo.nome: 'REQUEIJAO SMOKE'` → `insumos_criados` 0 e `count(*)` do insumo continua 1.
  - duas linhas com o mesmo nome novo na mesma nota → 1 insumo.
  - `item_estoque_id` + `novo_insumo` na mesma linha → 400 `VALIDATION_ERROR` "Escolha um insumo existente ou cadastre um novo, não os dois".
  - nota a prazo sem parcelas e com `novo_insumo: 'Nao Deve Existir'` → 400 e `count(*)` = 0.
  - `novo_insumo` com `subgrupo` que não existe → cria com o padrão do banco (`Mercearia`).
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh` → as checagens novas falham (as 2 antigas de data em novembro, linhas ~189/197, já falhavam: não são regressão).
- [ ] **Step 3:** implementar em `lancar`, dentro da transação e antes do `createMany` dos itens: carregar `itens_estoque (id, nome, ativo)`, resolver cada `novo_insumo` por `normalizaNome` (existente → usa e reativa; senão `create` com `preco_unitario = valor_unitario / (fator || 1)`, `fornecedor`, e `qtd_por_embalagem`/`embalagem_compra` quando `fator > 1`), mapa por nome normalizado para não criar duas vezes. `P2002` no create → 409 `DUPLICADO` "Já existe um insumo com este nome".
- [ ] **Step 4:** smoke: todas as novas passam; jest do DTO passa; typecheck/lint limpos.
- [ ] **Step 5:** `git commit -m "feat(notas): dar entrada cadastra o insumo que faltar"`

### Task 4: Web — reduzir e enviar a foto

**Files:**
- Create: `web/src/lib/imagem.ts`
- Modify: `web/src/lib/erp-api.ts`, `web/src/lib/nfe.ts`
- Test: `web/src/lib/__tests__/imagem.test.ts`

**Interfaces:**
- Produces: `MAX_FOTOS = 4`; `medidasReduzidas(w: number, h: number, max = 2000): { w: number; h: number }`; `reduzirImagem(f: File): Promise<File>` (JPEG 0.85, `createImageBitmap(f, { imageOrientation: 'from-image' })`; falha ao abrir → `Error("Não consegui abrir esta imagem. Envie em JPG ou PNG.")`); `ehImagem(f: File): boolean`; `lerFotoNota<T>(fotos: File[]): Promise<T>` em `erp-api.ts` (multipart, campo `arquivo` repetido, `/v1/notas/ler-foto`); em `nfe.ts`: `ItemNota` ganha opcionais `item_estoque_id?: string | null`, `novo?: { nome: string; unidade: string; subgrupo: string | null } | null`, `fator?: number`.

- [ ] **Step 1: testes que falham** — `medidasReduzidas(4000, 3000)` → `{ w: 2000, h: 1500 }`; `(800, 600)` → igual; `(3000, 4000)` → `{ w: 1500, h: 2000 }`; `ehImagem` aceita jpeg/png/webp e recusa pdf; `reduzirImagem` com `createImageBitmap` falso que rejeita → a frase exata; com falso que resolve → chamado com `imageOrientation: 'from-image'`.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/imagem.test.ts` → falha.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** teste passa; `yarn typecheck` (capado) limpo.
- [ ] **Step 5:** `git commit -m "feat(web): redução e envio de foto da nota"`

### Task 5: Web — tela com foto e "Cadastrar novo"

**Files:**
- Modify: `web/src/app/(app)/notas/page.tsx`, `web/src/components/ia-chave-panel.tsx`, `web/scripts/browser-check.mjs`

**Interfaces:**
- Consumes: Task 4 (`reduzirImagem`, `lerFotoNota`, `ehImagem`, `MAX_FOTOS`), `listarSubgrupos`, resposta de `POST /v1/notas` com `insumos_criados`.

- [ ] **Step 1:** `Linha` ganha `novo: { nome: string; unidade: string; subgrupo: string } | null`; valor especial `"__novo__"` no select ("+ Cadastrar novo insumo"). Entrada: `accept=".xml,.pdf,image/jpeg,image/png,image/webp"` + `multiple`; vários arquivos só se todos imagem e ≤ `MAX_FOTOS` (senão toast "Envie até 4 fotos da mesma nota."). `origem` passa a `"xml" | "pdf" | "foto"`.
- [ ] **Step 2:** preenchimento por linha — foto/PDF: vínculo salvo → `item_estoque_id` da IA → `novo` da IA; XML: vínculo → `sugerirInsumo` → vazio. Escolher "+ Cadastrar novo" numa linha sem sugestão preenche `novo` com `{ nome: descricao, unidade: (unidade ?? 'UN').toUpperCase(), subgrupo: '' }`. Linha nova mostra três campos (nome, unidade, subgrupo com as opções de `listarSubgrupos`) e `<Tag tone="warn">novo — confira</Tag>`; título "· N sem insumo · M novos".
- [ ] **Step 3:** `darEntrada` manda `novo_insumo` (e `item_estoque_id: null`) nas linhas novas; toast acrescenta "· M insumo(s) cadastrado(s)" quando `insumos_criados > 0`; invalida `["insumos-ativos"]`. Textos do passo 1 e do painel de Configurações conforme Global Constraints; a lista de notas já mostra `FOTO` pela `origem`.
- [ ] **Step 4:** `browser-check.mjs`: na nota por XML existente, trocar uma linha para "+ Cadastrar novo insumo", lançar, conferir o toast e o insumo em `/estoque`; trocar outra linha de novo para "— não lançar —" e conferir que não cria. (Foto real não é exercitada: sem chave.)
- [ ] **Step 5:** `yarn typecheck`, `yarn lint`, `yarn test` (capados) limpos; `../scripts/run-capped.sh 2600 bash scripts/browser-check.sh` sem falha.
- [ ] **Step 6:** `git commit -m "feat(web): entrada de nota por foto e cadastro do insumo novo na conferência"`

### Task 6: Documentação e conferência final

**Files:** Modify: `docs/api-contract.md`, `CLAUDE.md` (linha da leitura por IA: PDF **e foto**; rota nova), `README.md` (pendência do dono: testar foto real).

- [ ] **Step 1:** documentar `POST /v1/notas/ler-foto`, `novo_insumo`, `origem: foto`, `insumos_criados`.
- [ ] **Step 2:** rodar, um por vez e capados: jest da API (arquivos tocados), `npm run typecheck`, `npm run lint`, smoke, vitest, `yarn typecheck`, `yarn lint`, browser-check. Anotar os números no commit.
- [ ] **Step 3:** `git commit -m "docs(notas): contrato e regras da nota por foto"`
