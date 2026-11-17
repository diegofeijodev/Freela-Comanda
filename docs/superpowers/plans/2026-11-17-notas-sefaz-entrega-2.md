# Notas da SEFAZ, entrega 2: busca só de leitura, caixa e painel de ativação (plano de implementação)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a Etapa 1 do desenho, desligada de fábrica. A API passa a buscar na SEFAZ os resumos das NF-e emitidas contra o CNPJ, respeitando as esperas da NT 2014.002 e se desligando sozinha em conflito. A Entrada de Notas ganha a aba "Notas da SEFAZ", com o que falta lançar e o aviso de nota cancelada depois de lançada. Configurações ganha o painel "Ligar a busca" / "Desligar a busca".

**Architecture:**
- **Infraestrutura, `api/src/modules/sefaz/`:** transporte SOAP 1.2 com mTLS (`node:https`), leitor de XML seguro (`@xmldom/xmldom`), porta `SEFAZ_DFE` com o adaptador da distribuição e um falso para os testes. A NFC-e e a Etapa 2 reaproveitam tudo isso.
- **Aplicação, `api/src/modules/notas-sefaz/`:**
  - funções puras: `agenda.ts` (retorno → ação), `classificacao.ts` e `situacao-nota.ts`;
  - `CicloSefazService`: duas transações curtas sob trava consultiva, com a rede fora delas;
  - `CaixaSefazService`, o agendador e o controller.
- **Web:**
  - painel em Configurações e aba ao lado de "Lançar nota", com as regras de tela num módulo puro (`web/src/lib/notas-sefaz.ts`);
  - o "Conferir" reaproveita o `carregar` de hoje, com origem `sefaz`.

**Tech Stack:** NestJS 11 + Fastify + Prisma 5/PostgreSQL (api, npm) · `node:https`/`node:tls`/`node:zlib` · `@xmldom/xmldom` 0.9.12 · Next 15 + TanStack Query + Radix (web, yarn) · jest, vitest, smoke em bash, browser-check (Playwright).

**Spec:** `docs/superpowers/specs/2026-11-16-notas-sefaz-design.md` (seções "Regras da SEFAZ…", "Etapa 1" e "Verificação") e `docs/superpowers/specs/2026-11-16-notas-sefaz-ux.md` (§3, §4, §5, §6, §7). Onde a especificação de interface troca um texto (§6) ou o detalha (§3, §4), vale o texto dela, literalmente.

## Global Constraints

- **Ramo e commits:**
  - ramo `feat/notas-sefaz`, sem trocar de ramo, um commit por tarefa, sem push e sem deploy;
  - toda mensagem termina com `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`.
- **Comandos pesados:**
  - só por `scripts/run-capped.sh`, um de cada vez, com os tetos: jest, tsc e eslint 1500; smoke 1300; browser-check 2600;
  - jest sempre `npx jest --runInBand <caminhos>`; nunca `nest build` nem `next build`;
  - 137 = estourou o teto; 75 = sem memória agora.
- **SEFAZ e rede:**
  - Nenhuma chamada à SEFAZ: nem produção, nem homologação, nem handshake, nem `openssl s_client` contra `www1`/`hom1`.
  - Nenhum teste faz rede: porta falsa, HTTPS local em 127.0.0.1 e `page.route` no navegador.
  - Só dois passos usam a rede, e só o registro do npm: `npm install --save-exact @xmldom/xmldom@0.9.12` (Task 3) e `npm audit --omit=dev` (Task 10).
- **Desligado de fábrica:**
  - `SEFAZ_DFE_AMBIENTE` ausente ou vazia = `desligado`: nenhum timer é criado e nenhuma chamada sai;
  - `busca_ligada` nasce `false`;
  - `producao` só com o "eu autorizo" do dono, fora deste plano.
- **Smoke e browser-check nunca ligam a busca de verdade:**
  - O smoke sobe a API com `SEFAZ_DFE_AMBIENTE=producao`.
  - O smoke só tenta ligar depois do `DELETE /v1/certificado-digital` e espera 503 `CERTIFICADO_NAO_CADASTRADO`. Ligar com sucesso só no jest, com a porta falsa.
  - O smoke termina conferindo que `sefaz_consultas` só tem a linha semeada.
  - O browser-check mantém a API sem `SEFAZ_DFE_AMBIENTE` (desligado). Todo estado "ligado" vem de `page.route`, inclusive o `PUT …/configuracao`.
- **Nada sensível em log, resposta ou erro:**
  - nunca chave, PEM, XML, corpo de resposta da SEFAZ ou trecho de `docZip`;
  - `SefazErro` só leva frase fixa;
  - os logs `sefaz.distribuicao` e `sefaz.caixa` levam só ids, códigos, números e duração;
  - a única saída de XML é `GET /v1/notas-sefaz/:id/xml` (o `procNFe`, ao admin).
- **TLS:**
  - `rejectUnauthorized` sempre `true`, `minVersion: 'TLSv1.2'`, `agent: false`;
  - `ca` = `tls.rootCertificates` + `CADEIA_ICP.ancoras`, nunca `PACOTE_ICP_BRASIL`;
  - nenhuma variável de ambiente acrescenta âncora; os testes passam a raiz deles pelo campo `confianca`.
- **XML:** `@xmldom/xmldom` com versão exata `0.9.12`, importado só em `api/src/modules/sefaz/xml-leitura.ts`. `<!DOCTYPE` e `<!ENTITY` são recusados antes de ler.
- **Rotas:**
  - todas com `@AdminOnly()` e listadas em `permissoes-protecao.spec.ts`; a lista da loja não muda;
  - `:id` passa pelo `ParseUuidPipe`;
  - com o servidor `desligado`, só `GET …/situacao` responde (`{ ambiente: 'desligado' }`); as demais dão 503 `SEFAZ_DESLIGADA` "A busca de notas na SEFAZ não está ativada neste servidor."
- **Erros:**
  - sempre `{ error: { code, message } }`;
  - no web, `errMsg()`/`errCode()` de `@/lib/db`, e HTTP só em `web/src/lib/erp-api.ts`;
  - erros em caixa dentro da tela, nunca em toast (UX, cabeçalho).
- **Formatos:**
  - hora `15h10` e data `03/11/2026` (ou `15/11` onde a UX usa), sempre no fuso de Brasília;
  - banco em `timestamptz`, sem coluna `date` nova (`DATE_ONLY_KEYS` não muda).
- **Constantes no código, nunca em env:**
  - espera de 65 min, tique de 5 min, 1º tique 1 min depois do boot;
  - 10 páginas por ciclo, "em andamento" vale 2 min;
  - tempo limite de 30 s, tetos de 16 MB (resposta) e 4 MB (`docZip`);
  - `cUFAutor` 35;
  - recuo de 15, 30 e 60 min depois de falha antes de enviar.
- **Migrações:**
  - SQL à mão, no formato das existentes: `CREATE TABLE "x" (\n … \n);`, uma coluna por linha;
  - ids `UUID DEFAULT gen_random_uuid()`;
  - CHECKs com nome `"<tabela>_<regra>"`;
  - nenhuma das palavras `serial`, `identity` ou `nextval`, nem dentro de outra palavra ("serializada"): o `esquema.spec.ts` procura sem diferenciar maiúsculas;
  - nunca editar migração aplicada.
- **Fora desta entrega:** Etapa 2 (sem `sefaz_manifestacoes`, sem 2º interruptor, sem evento enviado), `consNSU`, `consChNFe`, "Baixar agora", Desconhecimento e o 1º teste real (roteiro no fim, sem tarefa).

## Decisões do plano (o desenho não fixa; não reabrir na implementação)

1. **Erro da SEFAZ:**
   - `SefazErro` mora em `modules/sefaz/sefaz-erro.ts`, porque o transporte vem antes da porta e a NFC-e o usa sem a distribuição;
   - `distribuicao.port.ts` o reexporta.
2. **Travas:**
   - transação 1: `pg_try_advisory_xact_lock(7_011_171_201)`, e quem não obtém desiste;
   - transação 2 e Ligar/Desligar: `pg_advisory_xact_lock`, que espera, porque depois de a SEFAZ responder nada pode desistir;
   - constante `CHAVE_TRAVA_SEFAZ`.
3. **HTTP:**
   - 5xx = "fora do ar" (+65, consulta `respondida`, `erro_code` `SEFAZ_HTTP`, `x_motivo` `HTTP 503`);
   - 403 = `parada_certificado`;
   - outro 4xx = `parada_configuracao` com o código HTTP na frase.
4. **656 em 24 h:** conta qualquer 656 do (ambiente, CNPJ) nas 24 h anteriores, inclusive o de resposta perdida. É o lado conservador.
5. **Contexto da agenda, lido na transação 1:**
   - `primeiraConsulta` = `ultima_consulta_em IS NULL`, e só um retorno com `cStat` 137 ou 138 grava esse campo. Um 5xx, 108/109 ou 656 não grava, para não apagar o D1 nem dar lacuna indevida no D2 da 1ª consulta. É também a "última busca" da tela e a base de `dias_sem_buscar`;
   - `anteriorEnviada` = resultado da consulta mais recente que não seja `falha_antes_de_enviar`;
   - `semRespostaSeguidas` = quantas das mais recentes são `sem_resposta`, em sequência.
6. **Ciclo:**
   - `sefaz_consultas` ganha `ciclo_id uuid NOT NULL`: todas as páginas de um ciclo o compartilham;
   - "N notas novas" = linhas de `notas_sefaz` com `criada_em ≥` início do último ciclo.
7. **Campos a mais na situação** (a UX precisa; o desenho não tipou): `ultima_consulta`, `ligada_por_nome`/`ligada_em`, `outro_cnpj_ou_modo`, `canceladas_depois`, `historico` (até 5) e `certificado.code`. Tipos na Task 7.
8. **Frases:**
   - o servidor grava em `mensagem`/`aviso` as frases da UX §4 que dependem do retorno (tabela da Task 4);
   - o cliente monta as de estado (última busca, próxima, desligada há N dias, 1ª busca, CNPJ mudou, lacuna, modo de teste).
9. **Certificado:**
   - `CertificadoErro` ganha `readonly validoAte?: Date`, preenchido só no `VENCIDO`, para a frase da UX "Envie o renovado para a busca voltar";
   - erros HTTP de Ligar/Buscar levam a frase da porta (`MSG_USO`);
   - o painel usa `situacao.certificado.mensagem`, com as frases da UX.
10. **Linha da caixa sem resumo:** `procNFe` sem resumo anterior cria a linha a partir do próprio XML; cancelamento sem resumo cria a partir da chave (nome vazio, valor nulo).
11. **Cru × classificação:**
    - a transação 2 grava `tipo` a partir do atributo `schema`, que é texto;
    - `chave` e `tp_evento` do cru só se preenchem na classificação;
    - `classificarPendentes` roda em todo tique (até 200 documentos), mesmo sem consulta.
12. **Buscar agora:**
    - conferências e transação 1 são síncronas, e o resto roda em segundo plano;
    - a rota responde 202 depois da transação 1;
    - Ligar não dispara busca: o próximo tique (≤ 5 min) faz (ver Ponto em aberto 1).
13. **Fixtures:**
    - os certificados TLS saem de `gerar-certificados-teste.sh --tls <pasta>`, um modo novo que não regenera os 19 .pfx;
    - validade de 7300 dias a partir de hoje (o handshake usa o relógio de verdade).
14. **Prova no banco real:** o script `api/scripts/ciclo-sefaz-banco.ts` roda o ciclo contra o Postgres do smoke, com porta e certificado falsos, em `homologacao`. Roda antes de a API do smoke subir e apaga o que criou.
15. **Navegador:** o browser-check confere em 360 px e no desktop (a UX §7 pede 360, mais estrito que os 390 do desenho).
16. **Telas:**
    - link direto para a aba = `/notas#notas-sefaz`, lido de `window.location.hash` num `useEffect` (o repositório não usa `useSearchParams`, e sem `Suspense` ele quebraria só no `next build` da Vercel);
    - Conferir = `carregar([new File([xml], "nota-sefaz.xml", { type: "text/xml" })], "sefaz")`.
17. **Toasts que a UX não fixa:** "Nota marcada como vista." e "Nota de volta à lista.", ambos com **Desfazer** por 8 s.
18. **Caixa do certificado no painel:** sem certificado = tom neutro (é o estado inicial); vencido, ilegível ou de outro CNPJ = vermelho.

## Review Focus

1. **Desligar → Desfazer, ou "Ligar a busca de novo" depois de uma parada.** Ligar e desligar nunca mexem em `proxima_consulta_em`, `bloqueado_ate`, `ult_nsu`, `em_andamento_desde` nem `falhas_seguidas`. Se mexessem, um toque viraria 656 para todos os sistemas do CNPJ. Testes: Task 7 (`caixa.service.spec`, "desligar e ligar não antecipa") e Task 6 (buscar logo depois de religar = `SEFAZ_AGUARDE`).
2. **Busca desligada ou CNPJ trocado com uma consulta no ar.** A resposta, o `ult_nsu` e os documentos são gravados no (ambiente, CNPJ) da própria consulta, e a página seguinte não sai. Teste: Task 6 ("busca desligada durante a consulta").
3. **Smoke ou browser-check falando com a SEFAZ por acidente** (o smoke guarda `valido.pfx` com o CNPJ da empresa e o agendador acorda 1 min depois do boot). Testes:
   - Task 7: a única tentativa de ligar no smoke vem depois do DELETE do certificado; a contagem final de `sefaz_consultas` fica igual à semeada;
   - Tasks 8 e 9: a API do browser-check fica desligada, e um check por `psql` confere que `sefaz_distribuicao` está vazia no banco do navegador.
4. **Hora e "hoje" perto da meia-noite.** "Nova tentativa às 15h10" sai no fuso de Brasília, e 02h30Z vira "ontem às 23h30". Testes: Task 4 (`horaSp`) e Task 8 (`quando`).
5. **Toque duplo em "Buscar agora", duas abas ou o tique no mesmo instante.** O segundo recebe 409 `SEFAZ_OCUPADA` sem rede. Testes:
   - Task 6: trava ocupada, e `em_andamento_desde` com menos de 2 min;
   - harness `ciclo-sefaz-banco.ts`: trava presa noutra conexão.

## Vetores de teste (fictícios)

**Relógio:** `AGORA = 2026-11-17T17:05:00Z`, que é 14h05 em Brasília. A partir dele:
- +65 min = `18:10Z` = **15h10**;
- +15 = 14h20, +30 = 14h35, +60 = 15h05.

**CNPJs** (todos com DV conferido):
- empresa/destinatário: `12345678000195`, o do seed e de `valido.pfx`;
- emitentes: `12ABC34501DE35` e `11222333000181`;
- outro destinatário: `99888777000100`.

**Chaves** (DV pelo módulo 11 da entrega 1, conferido aqui):

| Nome | Chave | NF / série | Emitente |
|---|---|---|---|
| VETOR | `35261112ABC34501DE35550010000044111000044116` | 4411 / 1 | 12ABC34501DE35 |
| KPARECE | `35261112ABC34501DE35550010000044111999999993` | 4411 / 1 | 12ABC34501DE35 |
| K880 | `35261111222333000181550010000008801000000887` | 880 / 1 | 11222333000181 |
| K77 | `35261111222333000181550010000000771000000071` | 77 / 1 | 11222333000181 |
| K990 | `35261111222333000181550010000009901000000994` | 990 / 1 | 11222333000181 |
| K120 | `35261111222333000181550010000001201000000120` | 120 / 1 | 11222333000181 |
| K15 | `35261111222333000181550020000000151000000016` | 15 / 2 | 11222333000181 |

---

### Task 1: Ambiente desligado por padrão e as tabelas da SEFAZ

**Files:**
- Create: `api/prisma/migrations/20261117120000_notas_sefaz/migration.sql`
- Modify:
  - `api/prisma/schema.prisma` (6 modelos);
  - `api/src/common/config/env.validation.ts`, `docker-compose.prod.yml` (`api.environment`), `api/.env.example`, `docs/deploy/.env.prod.example`;
  - `api/src/scripts/import-lovable/esquema.ts` (`TABELAS_SO_NOSSAS`).
- Test: `api/src/common/config/__tests__/env.validation.spec.ts`, `api/src/scripts/import-lovable/__tests__/esquema.spec.ts`

**Interfaces:**
- Produces:
  - **Ambiente:**
    - `Env.SEFAZ_DFE_AMBIENTE: 'desligado' | 'homologacao' | 'producao'`, como `z.preprocess(vazioComoAusente, z.enum(['desligado','homologacao','producao']).default('desligado'))`;
    - `export type AmbienteServidor = Env['SEFAZ_DFE_AMBIENTE']`, em `env.validation.ts`.
  - **Modelos Prisma** (nomes de chave composta usados nas tarefas seguintes):
    - `sefaz_distribuicao` com `@@id([ambiente, cnpj])` → `ambiente_cnpj`;
    - `sefaz_documentos` com `@@unique([ambiente, cnpj, nsu])` → `ambiente_cnpj_nsu`;
    - `notas_sefaz` com `@@unique([ambiente, chave])` → `ambiente_chave`.
- **Colunas** (as do desenho, "Modelo de dados"; aqui só o que ele não fixa):
  - **Todas as tabelas:**
    - `ambiente TEXT NOT NULL` com CHECK `IN ('producao','homologacao')`;
    - `cnpj`/`cnpj_destinatario CHAR(14) NOT NULL` com CHECK `~ '^[0-9A-Z]{12}[0-9]{2}$'`;
    - datas `TIMESTAMPTZ(6)`, NSU `BIGINT`.
  - **`sefaz_distribuicao`:**
    - `mensagem TEXT`, `aviso TEXT`, `max_nsu BIGINT`;
    - autoria `alterada_por UUID`, `alterada_por_nome TEXT`, `alterada_em`;
    - `criada_em NOT NULL DEFAULT CURRENT_TIMESTAMP`.
  - **`sefaz_distribuicao_historico`:**
    - `id UUID`;
    - `situacao TEXT NOT NULL`, `c_stat INTEGER`, `mensagem TEXT`;
    - `feito_por UUID`, `feito_por_nome TEXT` (nulos na parada automática);
    - `feito_em NOT NULL DEFAULT CURRENT_TIMESTAMP`.
  - **`sefaz_consultas`:**
    - `id UUID`, `ciclo_id UUID NOT NULL` (Decisão 6);
    - `servico TEXT NOT NULL DEFAULT 'distNSU'` com a CHECK nomeada `"sefaz_consultas_servico"`, para a Etapa 2 trocar;
    - `ult_nsu_enviado BIGINT NOT NULL`, `iniciada_em NOT NULL`;
    - `resultado TEXT`, que fica nulo enquanto a consulta está aberta;
    - `dh_resp TEXT`: o texto como veio, para nunca falhar;
    - `documentos INTEGER`;
    - índice `(ambiente, cnpj, iniciada_em DESC)`.
  - **`sefaz_lacunas`:**
    - `nsu_de`/`nsu_ate BIGINT NOT NULL`, com CHECK `nsu_ate >= nsu_de`;
    - `consulta_id UUID NOT NULL`.
  - **`sefaz_documentos`:**
    - `consulta_id UUID NOT NULL`, `recebido_em NOT NULL DEFAULT CURRENT_TIMESTAMP`;
    - CHECK `("tipo" = 'ilegivel') = ("conteudo_bruto" IS NOT NULL)`;
    - índice `(chave)`.
  - **`notas_sefaz`:**
    - `emitente_cnpj VARCHAR(14) NOT NULL`, `emitente_nome TEXT NOT NULL DEFAULT ''`, `numero`/`serie TEXT NOT NULL`;
    - `valor_total NUMERIC(15,2)`, `tp_nf`/`fin_nfe SMALLINT`, todos anuláveis;
    - CHECKs do desenho (chave, situação, motivo, ignorada ⇔ motivo, `outro` ⇒ `length(btrim(motivo_texto)) > 0`);
    - `atualizada_em NOT NULL DEFAULT CURRENT_TIMESTAMP`.
- **FKs**, 4, no formato Prisma `ALTER TABLE … ADD CONSTRAINT "…_fkey" FOREIGN KEY … ON DELETE RESTRICT ON UPDATE CASCADE`:
  - `sefaz_lacunas.consulta_id` e `sefaz_documentos.consulta_id` → `sefaz_consultas`;
  - `notas_sefaz.resumo_id` e `notas_sefaz.documento_completo_id` → `sefaz_documentos`.
- **Importador:** `TABELAS_SO_NOSSAS` ganha as 6 tabelas.

- [ ] **Step 1: testes que falham**
  - `env.validation.spec.ts`, bloco novo "SEFAZ_DFE_AMBIENTE":
    - ausente e `''` → `'desligado'`;
    - `'producao'` e `'homologacao'` ficam como vieram;
    - `'prod'` lança `/Configuração de ambiente inválida/`.
  - `esquema.spec.ts`, teste "ordem de carga respeita toda chave estrangeira":
    - passa a esperar `toHaveLength(23)`;
    - pula (`continue`) a FK cuja `filha` está em `TABELAS_SO_NOSSAS` (a carga não toca nessas tabelas).
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/common/config src/scripts/import-lovable`. Esperado: FAIL.
- [ ] **Step 3: implementar**
  - **Variável:** `SEFAZ_DFE_AMBIENTE` em `env.validation.ts`.
  - **Compose:** `SEFAZ_DFE_AMBIENTE: ${SEFAZ_DFE_AMBIENTE:-}`.
  - **Exemplos de `.env`**, nos dois: `# SEFAZ_DFE_AMBIENTE=desligado (desligado | homologacao | producao; producao só com o "eu autorizo" do dono)`.
  - **Migração e modelos:** migração com comentário de cabeçalho (sem as palavras proibidas) e modelos com `///` explicando cada tabela.
  - **Gerar o cliente:** `../scripts/run-capped.sh 1500 npm run prisma:generate`.
- [ ] **Step 4: rodar**
  - jest do Step 2 passa e typecheck limpo;
  - `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh` aplica a migração e não tem falha nova.
- [ ] **Step 5:** `git commit -m "feat(sefaz): ambiente da busca desligado por padrão e tabelas das notas da SEFAZ" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 2: Transporte SOAP 1.2 com mTLS e a confiança

**Files:**
- Create:
  - `api/src/modules/sefaz/sefaz-erro.ts`, `transporte-soap12.ts`, `confianca.ts`;
  - `api/src/modules/sefaz/__tests__/fixtures/tls/` (8 arquivos, Step 1).
- Modify:
  - `api/scripts/gerar-certificados-teste.sh` (modo `--tls`);
  - `api/src/modules/certificado-digital/certificado-digital.module.ts` (`exports: [CERTIFICADO_DIGITAL, CADEIA_ICP]`);
  - `.gitignore` (`!api/src/modules/sefaz/__tests__/fixtures/tls/*`).
- Test: `api/src/modules/sefaz/__tests__/transporte-soap12.spec.ts`, `confianca.spec.ts`, `verificacao-tls.spec.ts`

**Interfaces:**
- Consumes: `CertificadoEmUso` e `CADEIA_ICP`/`CadeiaIcp` (`certificado-digital/`).
- Produces:
  ```ts
  // sefaz-erro.ts
  export type CodigoSefazErro = 'SEFAZ_REDE' | 'SEFAZ_TLS' | 'SEFAZ_TEMPO' | 'SEFAZ_HTTP' | 'SEFAZ_RESPOSTA_INVALIDA';
  export const MSG_SEFAZ_ERRO: Record<CodigoSefazErro, string>; // frases fixas, internas (a tela usa as da agenda)
  export class SefazErro extends Error {
    constructor(message: string, readonly code: CodigoSefazErro, readonly enviado: boolean, readonly httpStatus?: number);
  }
  export function sefazErro(code: CodigoSefazErro, enviado: boolean, httpStatus?: number): SefazErro;
  // transporte-soap12.ts
  export const TEMPO_LIMITE_MS = 30_000;
  export const TETO_RESPOSTA_BYTES = 16 * 1024 * 1024;
  export interface ChamadaSoap12 { url: string; action: string; corpo: string; certificado: CertificadoEmUso; confianca: string[]; tempoLimiteMs: number; tetoRespostaBytes: number }
  export type ChamarSoap12 = (c: ChamadaSoap12) => Promise<string>;
  export const CHAMAR_SOAP12 = Symbol('CHAMAR_SOAP12');
  export function envelopeSoap12(corpo: string): string;
  export function chamarSoap12(c: ChamadaSoap12, requisitar?: typeof https.request): Promise<string>;
  // confianca.ts
  export function confiancaSefaz(icp: CadeiaIcp): string[]; // [...tls.rootCertificates, ...icp.ancoras.map(String)]
  ```
- **`envelopeSoap12(corpo)`**, texto exato:
  `<?xml version="1.0" encoding="utf-8"?><soap12:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap12="http://www.w3.org/2003/05/soap-envelope"><soap12:Body>${corpo}</soap12:Body></soap12:Envelope>`
- **Opções do `https.request`:**
  - `method: 'POST'`, `minVersion: 'TLSv1.2'`, `rejectUnauthorized: true`, `agent: false`;
  - `ca: c.confianca`;
  - `key`: `chavePrivada.export({ type: 'pkcs8', format: 'pem' })`, só aqui;
  - `cert`: a folha e a cadeia em PEM, unidas por `\n`;
  - cabeçalhos `Content-Type: application/soap+xml; charset=utf-8; action="<action>"` e `Content-Length`.
- **Erros, decididos por três marcas** (`conectou` = TCP, `seguro` = `secureConnect`, `enviado = seguro`):
  - erro sem `conectou` → `SEFAZ_REDE`;
  - com `conectou` e sem `seguro` → `SEFAZ_TLS`;
  - prazo total (`setTimeout` → `destroy`) → `SEFAZ_TEMPO`;
  - erro depois de `seguro` → `SEFAZ_REDE` com `enviado` verdadeiro;
  - status ≠ 200 → `SEFAZ_HTTP` com `httpStatus`;
  - corpo acima do teto → `SEFAZ_RESPOSTA_INVALIDA`;
  - 200 → o corpo em UTF-8.

- [ ] **Step 1: fixtures TLS.** O `gerar-certificados-teste.sh --tls <pasta>` gera só estes arquivos, todos com `-days 7300`:
  - `ac-teste.pem`;
  - `servidor.pem`/`.key`: CN `localhost`, SAN `IP:127.0.0.1,DNS:localhost`, EKU `serverAuth`, emitidos pela `ac-teste`;
  - `cliente.pem`/`.key`: CN `cliente-teste`, EKU `clientAuth`, emitidos pela `ac-teste`;
  - `ac-estranha.pem`;
  - `servidor-estranho.pem`/`.key`: mesmo SAN, emitidos pela `ac-estranha`.

  Rodar `bash api/scripts/gerar-certificados-teste.sh --tls api/src/modules/sefaz/__tests__/fixtures/tls` (openssl local). Sem `--tls`, o script segue igual.
- [ ] **Step 2: testes que falham**
  - **Servidor de teste:** `transporte-soap12.spec.ts` sobe `https.createServer` em `127.0.0.1:0` e usa a URL `https://127.0.0.1:<porta>/ws`, com `CertificadoEmUso` montado de `cliente.pem`/`cliente.key` e `confianca: [ac-teste.pem]`.
  - **"mTLS: manda o certificado do cliente e a action no Content-Type":**
    - o servidor tem `requestCert: true`, `rejectUnauthorized: true` e `ca: [ac-teste]`;
    - o handler guarda o CN de `getPeerCertificate()`, o `content-type` e o corpo, e responde 200 `<ok/>`;
    - asserções: o resultado é `'<ok/>'`, o CN é `'cliente-teste'`, o content-type é `'application/soap+xml; charset=utf-8; action="urn:acao-teste"'` e o corpo é `envelopeSoap12('<x/>')`;
    - não há caso negativo de certificado do cliente, porque no TLS 1.3 a recusa chega depois do `secureConnect` e o `enviado` desse caso é ambíguo.
  - **"servidor fora da confiança":** com `servidor-estranho`, dá `SefazErro` `{ code: 'SEFAZ_TLS', enviado: false }`, e o handler não é chamado.
  - **"porta fechada":** dá `{ code: 'SEFAZ_REDE', enviado: false }`.
  - **"tempo esgotado depois do handshake":** o handler nunca responde e `tempoLimiteMs` é 300. Dá `{ code: 'SEFAZ_TEMPO', enviado: true }`.
  - **"HTTP 500":** dá `{ code: 'SEFAZ_HTTP', enviado: true, httpStatus: 500 }`. O corpo da resposta contém `SEGREDO-DO-CORPO`, e a `message` do erro não contém esse texto.
  - **"teto":** com teto de 1024 e resposta de 2048 bytes, dá `{ code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true }`.
  - **"opções do https.request":** com um `requisitar` falso, as opções levam:
    - `minVersion 'TLSv1.2'`, `rejectUnauthorized true`, `agent false`;
    - `ca` igual a `confianca`;
    - `key` começando com `-----BEGIN PRIVATE KEY-----`;
    - `cert` com 2 `BEGIN CERTIFICATE` quando a cadeia tem 1 certificado.
  - **`confianca.spec.ts`:**
    - o tamanho é `tls.rootCertificates.length + ANCORAS_ICP_BRASIL.length`;
    - algum PEM, lido como `X509Certificate`, tem `subject` com `Raiz Brasileira v10`;
    - nenhum PEM é igual a um de `PACOTE_ICP_BRASIL`.
  - **`verificacao-tls.spec.ts`:**
    - lê todo `.ts` de `src/modules/sefaz` e `src/modules/notas-sefaz`, fora de `__tests__`;
    - nenhum casa `/rejectUnauthorized\s*:\s*false/` nem `NODE_TLS_REJECT_UNAUTHORIZED`;
    - `transporte-soap12.ts` contém `rejectUnauthorized: true`.
- [ ] **Step 3:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/sefaz`. Esperado: FAIL.
- [ ] **Step 4:** implementar; exportar `CADEIA_ICP` do módulo do certificado.
- [ ] **Step 5:** o jest do Step 3 passa, junto com `src/modules/certificado-digital`; typecheck limpo.
- [ ] **Step 6:** `git commit -m "feat(sefaz): transporte SOAP 1.2 com certificado do cliente (mTLS) e confiança ICP-Brasil" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 3: Leitor de XML, porta e adaptador da distribuição

**Files:**
- Create:
  - `api/src/modules/sefaz/xml-leitura.ts`, `distribuicao.port.ts`, `distribuicao.adapter.ts`, `sefaz.module.ts`;
  - `api/src/modules/sefaz/__tests__/sefaz-dfe.falso.ts`, `__tests__/retorno-falso.ts`;
  - `__tests__/fixtures/`: `ret-589.xml`, `ret-137.xml`, `res-nfe.xml`, `proc-nfe.xml`, `res-evento-110111.xml`, `proc-evento-110111.xml`.
- Modify: `api/package.json`, `api/package-lock.json`
- Test: `api/src/modules/sefaz/__tests__/xml-leitura.spec.ts`, `distribuicao.adapter.spec.ts`

**Interfaces:**
- Consumes: `ChamarSoap12`, `CHAMAR_SOAP12`, `chamarSoap12`, `TEMPO_LIMITE_MS`, `TETO_RESPOSTA_BYTES`, `confiancaSefaz` e `sefazErro` (Task 2).
- Produces:
  ```ts
  // xml-leitura.ts — o único arquivo que importa '@xmldom/xmldom'
  export const TETO_XML_BYTES = 16 * 1024 * 1024;
  export const TETO_DOCZIP_BYTES = 4 * 1024 * 1024;
  export class XmlInvalido extends Error {} // mensagem fixa 'XML inválido'
  export type NoXml = Element; // tipo do xmldom, reexportado
  export function lerXml(texto: string, tetoBytes?: number): Document; // DOCTYPE/ENTITY, teto ou erro/aviso do parser → XmlInvalido
  export function elementos(raiz: Document | NoXml, nomeLocal: string): NoXml[]; // getElementsByTagNameNS('*', nomeLocal)
  export function primeiro(raiz: Document | NoXml, nomeLocal: string): NoXml | null;
  export function texto(raiz: Document | NoXml, nomeLocal: string): string | null; // textContent aparado; vazio → null
  export function descompactarDocZip(base64: string): { xml: string } | { bruto: string }; // gunzipSync com maxOutputLength = 4 MB
  // distribuicao.port.ts — o bloco do desenho, sem mudança, mais:
  export { SefazErro } from './sefaz-erro';
  // distribuicao.adapter.ts
  export const URL_DISTRIBUICAO: Record<AmbienteSefaz, string>; // as duas do desenho (www1 / hom1)
  export const ACTION_DIST_NSU = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse';
  export const C_UF_AUTOR = '35';
  export function corpoDistNsu(ambiente: AmbienteSefaz, cnpj: string, ultNsu: bigint): string;
  export function lerRetornoDistribuicao(corpoHttp: string): RespostaDistribuicao; // inválido → SefazErro SEFAZ_RESPOSTA_INVALIDA, enviado true
  @Injectable() export class SefazDfeAdapter implements SefazDfePort {
    constructor(@Inject(CADEIA_ICP) icp: CadeiaIcp, @Inject(CHAMAR_SOAP12) chamar: ChamarSoap12);
  }
  // sefaz.module.ts: imports [CertificadoDigitalModule]; providers CHAMAR_SOAP12 = (c) => chamarSoap12(c),
  //   SefazDfeAdapter e SEFAZ_DFE (useExisting); exports [SEFAZ_DFE]
  // __tests__/sefaz-dfe.falso.ts
  export class SefazDfeFalso implements SefazDfePort {
    readonly chamadas: { ambiente: AmbienteSefaz; cnpj: string; ultNsu: bigint }[];
    antesDeResponder?: () => Promise<void>; // gancho do teste "busca desligada durante a consulta"
    responder(...r: (RespostaDistribuicao | SefazErro)[]): this; // fila; vazia → rejeita Error('chamada inesperada à SEFAZ')
  }
  export function resposta(cStat: number, p?: Partial<RespostaDistribuicao>): RespostaDistribuicao; // xMotivo 'teste', dhResp fixo, NSUs null, sem documentos
  // __tests__/retorno-falso.ts
  export function docZip(xml: string): string; // gzipSync + base64
  export function retornoSoap(p: { cStat: number; xMotivo?: string; ultNsu?: bigint; maxNsu?: bigint; docs?: { nsu: bigint; schema: string; conteudo: string }[] }): string;
  ```
- **Vetor exato** de `corpoDistNsu('producao', '12345678000195', 0n)`:
  `<nfeDistDFeInteresse xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe"><nfeDadosMsg><distDFeInt xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.01"><tpAmb>1</tpAmb><cUFAutor>35</cUFAutor><CNPJ>12345678000195</CNPJ><distNSU><ultNSU>000000000000000</ultNSU></distNSU></distDFeInt></nfeDadosMsg></nfeDistDFeInteresse>`
- **Leitura do retorno:**
  - acha `retDistDFeInt` pelo nome local;
  - `cStat` inteiro obrigatório;
  - `ultNSU`/`maxNSU` viram `BigInt` ou `null`;
  - cada `docZip` passa por `descompactarDocZip`;
  - mais de 50 `docZip`, `cStat` não inteiro, falta de `retDistDFeInt` ou `XmlInvalido` → `sefazErro('SEFAZ_RESPOSTA_INVALIDA', true)`.

- [ ] **Step 1:** `cd api && npm install --save-exact @xmldom/xmldom@0.9.12`. É rede, mas só o registro do npm. Conferir no `package.json` a versão sem `^`.
- [ ] **Step 2: fixtures**, XML fictícios com o namespace `http://www.portalfiscal.inf.br/nfe`:
  - **`res-nfe.xml`:**
    - `chNFe` = VETOR, `CNPJ` 12ABC34501DE35, `xNome` "ATACADAO TESTE S.A.";
    - `dhEmi` 2026-11-14T10:00:00-03:00, `tpNF` 1, `vNF` 1234.56;
    - `dhRecbto` 2026-11-14T10:00:05-03:00, `nProt` e `cSitNFe` 1.
  - **`proc-nfe.xml`:**
    - `nfeProc` com `infNFe Id="NFe"+K880`;
    - `ide`: `natOp` VENDA, `serie` 1, `nNF` 880, `tpNF` 1, `finNFe` 1;
    - `emit`: CNPJ 11222333000181, "DISTRIB. BEBIDAS TESTE";
    - `dest`: CNPJ 12345678000195;
    - 1 `det`, `vNF` 890.00;
    - `protNFe/infProt` com `cStat` 100 e `dhRecbto`.
  - **`res-evento-110111.xml`:** `chNFe` K77, `CNPJ` 11222333000181, `tpEvento` 110111, `dhEvento` 2026-11-16T09:00:00-03:00.
  - **`proc-evento-110111.xml`:** `procEventoNFe` com `evento/infEvento` para K120, mais o `retEvento`.
  - **Retornos:**
    - `ret-589.xml`: envelope SOAP 1.2 com `cStat` 589, sem NSU;
    - `ret-137.xml`: `cStat` 137, `ultNSU` e `maxNSU` 000000000001234.
- [ ] **Step 3: testes que falham**
  - **`xml-leitura.spec.ts`:**
    - `<!DOCTYPE x>` e `<!ENTITY` dão `XmlInvalido`, inclusive em minúsculas;
    - texto acima do teto (teto 10) dá `XmlInvalido`;
    - XML quebrado dá `XmlInvalido`;
    - `texto(doc, 'chNFe')` acha com e sem prefixo de namespace;
    - `descompactarDocZip(docZip(x))` dá `{ xml: x }`;
    - base64 que não é gzip dá `{ bruto: <o próprio base64> }`;
    - gzip de 4 MB + 1 byte dá `bruto`.
  - **`distribuicao.adapter.spec.ts`:**
    - **`corpoDistNsu`:**
      - o vetor acima, exatamente;
      - homologação com `1234n` traz `<tpAmb>2</tpAmb>` e `<ultNSU>000000000001234</ultNSU>`;
      - `12ABC34501DE35` passa;
      - CNPJ `'123'`, NSU `-1n` e NSU `10n ** 15n` lançam `Error`.
    - **`lerRetornoDistribuicao`:**
      - `ret-589` → `{ cStat: 589, ultNsu: null, maxNsu: null, documentos: [] }`;
      - `ret-137` → `ultNsu 1234n` e `maxNsu 1234n`;
      - `retornoSoap({ cStat: 138, ultNsu: 1237n, maxNsu: 1240n, docs: [res-nfe@1235 'resNFe_v1.01.xsd', proc-nfe@1236 'procNFe_v4.00.xsd', res-evento@1237 'resEvento_v1.01.xsd'] })` → 3 documentos com `nsu` 1235n, 1236n e 1237n e `xml` igual ao arquivo;
      - um `docZip` que não é gzip → `{ xml: null, bruto }`.
    - **Inválidos** (todos `{ code: 'SEFAZ_RESPOSTA_INVALIDA', enviado: true }`): sem `retDistDFeInt`, com DOCTYPE, `cStat` `abc`, 51 `docZip`.
    - **Adaptador, com `chamar` falso:**
      - a chamada leva `url` = `URL_DISTRIBUICAO.homologacao`, `action` = `ACTION_DIST_NSU`, `corpo` = `corpoDistNsu(...)`, `tempoLimiteMs` 30000, `tetoRespostaBytes` 16777216 e `confianca` = `confiancaSefaz(icp)`;
      - o `SefazErro` do `chamar` passa sem mudar.
- [ ] **Step 4:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/sefaz`. Esperado: FAIL.
- [ ] **Step 5:** implementar.
- [ ] **Step 6:** o jest do Step 4 passa; typecheck e lint limpos.
- [ ] **Step 7:** `git commit -m "feat(sefaz): leitor de XML seguro, porta e adaptador da distribuição de DF-e (sem rede)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 4: Agenda da distribuição (pura)

**Files:**
- Create: `api/src/modules/notas-sefaz/agenda.ts`, `api/src/modules/notas-sefaz/frases.ts`
- Modify: `api/src/common/time/dates.ts` (`horaSp`)
- Test: `api/src/modules/notas-sefaz/__tests__/agenda.spec.ts`, `api/src/common/time/__tests__/hora-sp.spec.ts`

**Interfaces:**
- Consumes: `CodigoSefazErro` (Task 2).
- Produces:
  ```ts
  // dates.ts
  export function horaSp(d: Date): string; // "15h10" (24 h, America/Sao_Paulo)
  // agenda.ts
  export const ESPERA_MS = 65 * 60_000, TIQUE_MS = 5 * 60_000, PRIMEIRO_TIQUE_MS = 60_000;
  export const PAGINAS_POR_CICLO = 10, EM_ANDAMENTO_MAX_MS = 2 * 60_000;
  export const RECUO_FALHA_MIN = [15, 30, 60] as const;
  export type SituacaoBusca = 'ok' | 'parada_certificado' | 'parada_configuracao' | 'parada_conflito' | 'parada_656';
  export type ResultadoConsulta = 'respondida' | 'falha_antes_de_enviar' | 'sem_resposta' | 'interrompida';
  export type Chamada =
    | { tipo: 'retorno'; cStat: number; ultNsu: bigint | null; maxNsu: bigint | null; documentos: number }
    | { tipo: 'erro'; code: CodigoSefazErro; enviado: boolean; httpStatus?: number };
  export interface EstadoLinha { busca_ligada: boolean; ult_nsu: bigint; proxima_consulta_em: Date | null; bloqueado_ate: Date | null; em_andamento_desde: Date | null; falhas_seguidas: number }
  export function condicoes(l: EstadoLinha | null, agora: Date): 'ok' | 'nao_ligada' | 'ocupada' | 'aguarde'; // nessa precedência
  export function liberadaEm(l: EstadoLinha): Date | null; // o maior entre próxima e bloqueado
  export interface EntradaAgenda { agora: Date; ultNsuNosso: bigint; primeiraConsulta: boolean; anteriorEnviada: ResultadoConsulta | null;
    falhasSeguidas: number; semRespostaSeguidas: number; vezes656Em24h: number; reservaAte: Date; chamada: Chamada }
  export interface AcaoAgenda {
    resultado: Exclude<ResultadoConsulta, 'interrompida'>; ultNsu: bigint; maxNsu: bigint | null; proximaConsultaEm: Date;
    bloqueadoAte: Date | null /* null = não muda */; falhasSeguidas: number; situacao: SituacaoBusca; mensagem: string | null;
    aviso: string | null /* null = não muda */; lacuna: { nsuDe: bigint; nsuAte: bigint; causa: 'outro_sistema' | 'resposta_perdida' } | null;
    maisPaginas: boolean; alerta: string | null /* só para o log */;
  }
  export function decidir(e: EntradaAgenda): AcaoAgenda;
  // frases.ts — literais da UX §4; {h} = horaSp(...), {n} = código
  export const FRASE: {
    foraDoAr(h: string): string; semContato(h: string): string; esperar(h: string): string; bloqueouDuasVezes: string;
    conflito: string; certificadoRecusado(n: number): string; cnpj593: string; tresIlegiveis: string; outroCodigo(n: number): string; indicioD1: string;
  };
  ```
- **Textos de `FRASE`, na ordem do tipo:**
  - "A SEFAZ está fora do ar. Nova tentativa às {h}."
  - "Não consegui falar com a SEFAZ. Nova tentativa às {h}."
  - "A SEFAZ pediu para esperar. Próxima busca às {h}."
  - "A SEFAZ bloqueou a busca duas vezes em 24 horas. Por segurança, a busca foi desligada. Fale com o seu contador e com o suporte do Freela Comanda antes de ligar de novo."
  - "Outro sistema também está buscando as notas deste CNPJ na SEFAZ (provavelmente o do contador). Com dois sistemas, a SEFAZ bloqueia os dois por 1 hora. A busca foi desligada: fale com o contador antes de ligar de novo."
  - "A SEFAZ recusou o certificado digital (código {n}). Confira o certificado digital em Configurações e ligue a busca de novo."
  - "A SEFAZ diz que o CNPJ consultado não é da mesma empresa do certificado (código 593). Confira o CNPJ no quadro Empresa."
  - "A busca parou: a SEFAZ respondeu 3 vezes de um jeito que o sistema não entende. Fale com o suporte do Freela Comanda."
  - "A busca parou por um problema que o sistema não resolve sozinho (código {n}). Fale com o suporte do Freela Comanda e informe este código."
  - "A SEFAZ já tinha notas separadas para este CNPJ, então algum sistema (talvez o do seu contador) usou a busca nos últimos 60 dias. Se ele ainda busca, a SEFAZ vai bloquear os dois, e a busca daqui se desliga sozinha."

- [ ] **Step 1: testes que falham.** `agenda.spec.ts` tem um `it` por linha da tabela abaixo.
  - **Contexto comum:**
    - `agora = AGORA`, `ultNsuNosso = 100n`, `reservaAte = 18:10Z`;
    - `primeiraConsulta = false`, `anteriorEnviada = 'respondida'`;
    - contadores em 0.
  - **Legenda:**
    - "+65" = `18:10Z`;
    - "—" em "bloqueado" = `null`, e em "mensagem" = `null`;
    - `resultado` é `respondida`, salvo indicação.

| # | Chamada (e contexto diferente) | ultNsu | próxima | bloqueado | situação | mensagem | outros |
|---|---|---|---|---|---|---|---|
| 1 | retorno 138, ult 150, max 300 | 150 | `agora` | — | ok | — | `maisPaginas`, falhas 0 |
| 2 | retorno 138, ult 300, max 300 | 300 | +65 | — | ok | — | |
| 3 | retorno 137, ult 100, max 100 | 100 | +65 | — | ok | — | |
| 4 | retorno 137, ult 90 | 100 | +65 | — | ok | — | `alerta` "ultNSU devolvido menor que o nosso" |
| 5 | retorno 138, ult 40, max 40, docs 40 (`primeiraConsulta`, nosso 0) | 40 | +65 | — | ok | — | `aviso` = `indicioD1` |
| 6 | retorno 108; e retorno 109 | 100 | +65 | — | ok | `foraDoAr('15h10')` | |
| 7 | erro SEFAZ_HTTP 503, enviado | 100 | +65 | — | ok | `foraDoAr('15h10')` | |
| 8 | erro SEFAZ_REDE, não enviado (falhas antes 0 / 1 / 2 / 5) | 100 | +15 / +30 / +60 / +60 | — | ok | `semContato('14h20')` etc. | `falha_antes_de_enviar`, falhas+1 |
| 9 | erro SEFAZ_TEMPO, enviado (semResposta antes 0) | 100 | +65 | — | ok | `semContato('15h10')` | `sem_resposta`, falhas+1 |
| 10 | SEFAZ_TEMPO ou SEFAZ_RESPOSTA_INVALIDA, enviado, com semResposta antes **2** (com 0 ou 1, vale a linha 9) | 100 | +65 | — | parada_configuracao | `tresIlegiveis` | `sem_resposta` |
| 11 | retorno 656, ult 100 (656 em 24 h: 0) | 100 | +65 | +65 | ok | `esperar('15h10')` | |
| 12 | igual à 11 com 656 em 24 h: 1 | 100 | +65 | +65 | parada_656 | `bloqueouDuasVezes` | |
| 13 | retorno 656, ult 130 (anterior `sem_resposta`; e `interrompida`) | 130 | +65 | +65 | ok | — | lacuna 101–130 `resposta_perdida` |
| 14 | retorno 656, ult 130 (anterior `respondida`) — D2 | 130 | +65 | +65 | parada_conflito | `conflito` | lacuna 101–130 `outro_sistema` |
| 15 | retorno 656, ult 130 (`primeiraConsulta`, nosso 0) — D2 | 130 | +65 | +65 | parada_conflito | `conflito` | sem lacuna |
| 16 | retorno 280, 283, 286 e 473; erro SEFAZ_HTTP 403 | 100 | +65 | — | parada_certificado | `certificadoRecusado(N)` | |
| 17 | retorno 593 | 100 | +65 | — | parada_configuracao | `cnpj593` | |
| 18 | retorno 214, 215, 238, 239, 252, 402, 404, 489, 589, 999 e 123; erro SEFAZ_HTTP 415 | 100 | +65 | — | parada_configuracao | `outroCodigo(N)` | o NSU não avança |

  - **`condicoes`:**
    - `null` → `nao_ligada`; `busca_ligada false` → `nao_ligada`;
    - `em_andamento_desde` = agora − 1 min → `ocupada`;
    - agora − 3 min com a próxima já passada → `ok`;
    - próxima no futuro → `aguarde`; `bloqueado_ate` no futuro → `aguarde`.
  - **`liberadaEm`:** é o maior dos dois.
  - **`hora-sp.spec.ts`:**
    - `horaSp(new Date('2026-11-17T18:10:00Z')) === '15h10'`;
    - `'2026-11-17T02:30:00Z'` → `'23h30'`;
    - `'2026-11-17T12:05:00Z'` → `'09h05'`.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas-sefaz src/common/time`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** o jest do Step 2 passa; typecheck limpo.
- [ ] **Step 5:** `git commit -m "feat(notas-sefaz): agenda da distribuição (retorno → ação, esperas da NT, detectores de outro sistema)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 5: Classificação, situação de cada nota e notas lançadas

**Files:**
- Create: `api/src/modules/notas-sefaz/classificacao.ts`, `api/src/modules/notas-sefaz/situacao-nota.ts`
- Modify: `api/src/modules/notas/notas.service.ts` (`notasLancadas`), `api/src/modules/notas/notas.module.ts` (`exports: [NotasService]`)
- Test: `api/src/modules/notas-sefaz/__tests__/classificacao.spec.ts`, `situacao-nota.spec.ts`, `api/src/modules/notas/__tests__/notas.service.spec.ts`

**Interfaces:**
- Consumes:
  - `lerXml`, `primeiro`, `texto` e `XmlInvalido` (Task 3);
  - `normalizarChave`, `chaveValida`, `partesDaChave`, `normalizarCnpj`, `pareceRepetida` e `NotaParecida` (`common/fiscal`);
  - `AmbienteSefaz`.
- Produces:
  ```ts
  // classificacao.ts
  export type TipoDocumento = 'resNFe' | 'procNFe' | 'resEvento' | 'procEventoNFe' | 'outro' | 'ilegivel';
  export function tipoDoSchema(schema: string): Exclude<TipoDocumento, 'ilegivel'>; // o prefixo antes de "_v"
  export type SituacaoSefaz = 'autorizada' | 'denegada' | 'cancelada';
  export type DadosNota = { chave: string; emitente_cnpj: string; emitente_nome: string; numero: string; serie: string; emitida_em: Date | null;
    autorizada_em: Date | null; valor_total: string | null; tp_nf: number | null; situacao_sefaz: SituacaoSefaz };
  export type Classificacao =
    | { tipo: 'resumo'; dados: DadosNota }
    | { tipo: 'completo'; dados: DadosNota; fin_nfe: number | null; nat_op: string | null }
    | { tipo: 'nao_destinatario'; chave: string | null }
    | { tipo: 'cancelamento'; chave: string; cancelada_em: Date; emitente_cnpj: string | null }
    | { tipo: 'outro_evento'; chave: string | null; tp_evento: string | null }
    | { tipo: 'sem_uso' };
  export function classificar(doc: { tipo: TipoDocumento; xml: string | null }, cnpjDestinatario: string): Classificacao; // XML ruim ou chave inválida → lança
  export function chaveDoDocumento(c: Classificacao): { chave: string | null; tp_evento: string | null };
  export type LinhaCaixa = { ambiente: AmbienteSefaz; cnpj_destinatario: string; chave: string; emitente_cnpj: string; emitente_nome: string; numero: string;
    serie: string; emitida_em: Date | null; autorizada_em: Date | null; valor_total: string | null; tp_nf: number | null; fin_nfe: number | null;
    nat_op: string | null; situacao_sefaz: SituacaoSefaz; cancelada_em: Date | null; resumo_id: string | null; documento_completo_id: string | null };
  export function aplicarNaCaixa(atual: LinhaCaixa | null, c: Classificacao, docId: string, base: { ambiente: AmbienteSefaz; cnpj_destinatario: string }):
    { criar: LinhaCaixa } | { atualizar: Partial<LinhaCaixa> } | null;
  // situacao-nota.ts
  export type SituacaoNota = 'cancelada_depois_de_lancada' | 'ignorada' | 'cancelada' | 'denegada' | 'ja_lancada' | 'parece_lancada' | 'falta_lancar';
  export type MotivoIgnorar = 'lancada_de_outro_jeito' | 'nao_e_compra' | 'nao_reconheco' | 'cancelamento_conferido' | 'outro';
  export const MOTIVOS_IGNORAR: readonly MotivoIgnorar[];
  export const A_CONFERIR: ReadonlySet<SituacaoNota>; // as situações 1, 6 e 7
  export function situacaoDaNota(n: { situacao_sefaz: SituacaoSefaz; motivo_ignorar: MotivoIgnorar | null }, l: { lancada: boolean; parecida: boolean }): SituacaoNota;
  export function podeConferir(ambiente: AmbienteSefaz, temXml: boolean, s: SituacaoNota): boolean;
  export function naoPareceCompra(tpNf: number | null, finNfe: number | null): boolean;
  export function lancamentosDaNota(n: { chave: string; emitente_cnpj: string; numero: string; serie: string }, lancadas: NotaLancada[]):
    { lancada: NotaParecida | null; parecidas: NotaParecida[] }; // as parecidas não incluem a lançada pela chave; a mais nova vem primeiro
  // notas.service.ts
  export type NotaLancada = NotaParecida & { chave: string | null; fornecedor_cnpj: string | null };
  notasLancadas(f: { chaves: string[]; emitentes: string[] }): Promise<NotaLancada[]>;
  ```
- **Regras:**
  - **`resNFe`:**
    - número e série saem de `partesDaChave`;
    - o emitente é `CNPJ ?? CPF` normalizado;
    - `cSitNFe` 1/2/3 vira autorizada/denegada/cancelada;
    - `vNF` fica como texto.
  - **`procNFe`:**
    - destinatário `CNPJ ?? CPF` ≠ o nosso → `nao_destinatario`;
    - `cStat` do `protNFe` em 110 ou 301–306 → `denegada`; senão `autorizada`.
  - **Eventos:** `tpEvento` 110111 → `cancelamento` com `cancelada_em = dhEvento`.
  - **`aplicarNaCaixa`:**
    - nunca põe `situacao_sefaz` de volta em `autorizada` se a atual for `cancelada`;
    - o completo anexa `documento_completo_id`, `fin_nfe` e `nat_op`;
    - o cancelamento sem linha cria a linha a partir da chave, com `emitente_nome ''`, `valor_total null` e o emitente do evento, se houver (Decisão 10).
  - **Precedência de `situacaoDaNota`:**
    1. `cancelada` e (`lancada` ou `parecida`) e motivo ≠ `cancelamento_conferido`;
    2. motivo não nulo;
    3. `cancelada`;
    4. `denegada`;
    5. `lancada`;
    6. `parecida`;
    7. senão, `falta_lancar`.
  - **Etiquetas:**
    - `podeConferir` = produção e XML completo e situação `parece_lancada` ou `falta_lancar`;
    - `naoPareceCompra` = `tpNf === 0 || finNfe === 4`.
  - **`notasLancadas`:**
    - um só `findMany`, com `where: { OR: [{ chave: { in: chaves } }, { fornecedor_cnpj: { in: emitentes } }] }` e `orderBy created_at desc`;
    - com as duas listas vazias, nenhuma consulta e `[]`.

- [ ] **Step 1: testes que falham**
  - **`classificacao.spec.ts`**, com os fixtures da Task 3 e `docId 'd1'`:
    - **resNFe (`res-nfe.xml`):** cria com `chave` VETOR, `numero '4411'`, `serie '1'`, `emitente_cnpj '12ABC34501DE35'`, `emitente_nome 'ATACADAO TESTE S.A.'`, `valor_total '1234.56'`, `tp_nf 1`, `situacao_sefaz 'autorizada'` e `resumo_id 'd1'`.
    - **procNFe (`proc-nfe.xml`):**
      - sobre uma linha existente de K880, atualiza com `{ documento_completo_id: 'd1', fin_nfe: 1, nat_op: 'VENDA' }`;
      - sem linha, cria a linha com `documento_completo_id`;
      - com o `dest` trocado para 99888777000100, dá `nao_destinatario` e `aplicarNaCaixa` devolve `null`.
    - **110111:**
      - depois do resumo, atualiza com `situacao_sefaz 'cancelada'` e `cancelada_em` = `2026-11-16T12:00:00Z`;
      - sem resumo, cria a linha de K77 com `numero '77'`, `serie '1'`, `emitente_cnpj '11222333000181'` e `emitente_nome ''`;
      - `proc-evento-110111.xml` também cancela.
    - **Resumo depois do cancelamento:** a atualização não leva `situacao_sefaz 'autorizada'`.
    - **Outros documentos:**
      - evento 210210 dá `outro_evento` e nada para gravar;
      - XML com DOCTYPE lança `XmlInvalido`.
    - **`tipoDoSchema`:**
      - `'resNFe_v1.01.xsd'` → `resNFe`; `'procNFe_v4.00.xsd'` → `procNFe`;
      - `'resEvento_v1.01.xsd'` → `resEvento`; `'procEventoNFe_v1.00.xsd'` → `procEventoNFe`;
      - `'resCTe_v1.00.xsd'` → `outro`.
  - **`situacao-nota.spec.ts`:**
    - **Precedência:**
      - cancelada + lançada + `nao_e_compra` → `cancelada_depois_de_lancada`;
      - o mesmo com `cancelamento_conferido` → `ignorada`;
      - cancelada + parecida → `cancelada_depois_de_lancada`;
      - autorizada + `outro` → `ignorada`;
      - cancelada sem lançamento → `cancelada`;
      - `denegada`, `ja_lancada`, `parece_lancada` e `falta_lancar`, cada um no seu caso.
    - **`podeConferir`:**
      - verdadeiro para produção + XML + `falta_lancar`;
      - falso para homologação, sem XML ou com `ja_lancada`.
    - **`naoPareceCompra`:** `(0,1)` e `(1,4)` são verdadeiros; `(1,1)` e `(null,null)` são falsos.
    - **`lancamentosDaNota`:** VETOR contra `[a: chave VETOR, b: 4411/1 sem chave, c: 4411/2]` dá `lancada.id 'a'` e `parecidas` só com `b`.
  - **`notas.service.spec.ts`:**
    - `notasLancadas` faz um único `findMany` com o `OR` acima;
    - com `{ chaves: [], emitentes: [] }`, nenhuma chamada.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas-sefaz src/modules/notas`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** o jest do Step 2 passa; typecheck limpo.
- [ ] **Step 5:** `git commit -m "feat(notas-sefaz): classificação dos documentos e situação de cada nota (puras), notas lançadas numa consulta" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 6: Ciclo, trava e agendador

**Files:**
- Create:
  - `api/src/modules/notas-sefaz/ciclo.service.ts`, `agendador.ts`, `notas-sefaz.module.ts`;
  - `api/src/modules/notas-sefaz/__tests__/prisma-sefaz.falso.ts`;
  - `api/scripts/ciclo-sefaz-banco.ts`.
- Modify: `api/src/app.module.ts`, `api/scripts/smoke-capped.sh`
- Test: `api/src/modules/notas-sefaz/__tests__/ciclo.service.spec.ts`, `agendador.spec.ts`

**Interfaces:**
- Consumes:
  - `SEFAZ_DFE`/`SefazDfePort`/`SefazErro` (Task 3), `CERTIFICADO_DIGITAL`/`CertificadoErro`;
  - `decidir`, `condicoes`, `liberadaEm` e as constantes (Task 4);
  - `classificar`, `aplicarNaCaixa`, `chaveDoDocumento` e `tipoDoSchema` (Task 5);
  - `cnpjValido`/`normalizarCnpj`.
- Produces:
  ```ts
  export const CHAVE_TRAVA_SEFAZ = 7_011_171_201;
  export type Quem = { id: string; nome: string };
  export type FimCiclo = 'feito' | 'desligado' | 'nao_ligada' | 'sem_cnpj' | 'certificado' | 'aguarde' | 'ocupada';
  export type ResumoCiclo = { fim: FimCiclo; paginas: number };
  @Injectable() export class CicloSefazService {
    constructor(prisma: PrismaService, config: ConfigService, @Inject(CERTIFICADO_DIGITAL) certificados: CertificadoDigitalPort, @Inject(SEFAZ_DFE) sefaz: SefazDfePort);
    ambiente(): AmbienteSefaz | 'desligado';
    cnpjDaEmpresa(): Promise<string | null>;  // normalizado e válido; senão null
    ciclo(origem: 'agendada' | 'botao', quem: Quem | null, relogio?: () => Date): Promise<ResumoCiclo>;
    buscarAgora(quem: Quem, relogio?: () => Date): Promise<{ iniciada: true; ciclo: Promise<ResumoCiclo> }>; // o ciclo nunca rejeita
    classificarPendentes(limite?: number): Promise<number>; // padrão 200; devolve quantos foram processados
  }
  @Injectable() export class AgendadorSefaz implements OnApplicationBootstrap, OnModuleDestroy {
    constructor(ciclo: CicloSefazService);
    tique(): Promise<void>; // um por vez (flag); nunca lança; erro → log com a classe e o code, sem mensagem de biblioteca
  }
  // __tests__/prisma-sefaz.falso.ts
  export function montarPrismaSefaz(o?: { cnpjEmpresa?: string; travaOcupada?: boolean }): { prisma: PrismaService; t: TabelasSefaz; trava: { ocupada: boolean } };
  ```
- **Superfície do Prisma** (o falso implementa só isto, com `where` por igualdade, `in` e `gte`):
  - `configuracoes.findUnique`;
  - `sefaz_distribuicao.findUnique/upsert/update` (por `ambiente_cnpj`) e `findMany({ where: { busca_ligada: true } })`;
  - `sefaz_distribuicao_historico.create/findMany`;
  - `sefaz_consultas.create/update/updateMany/findMany` (`take` ≤ 10, `orderBy iniciada_em desc`), `count` e `findFirst`;
  - `sefaz_documentos.createMany({ skipDuplicates: true })/findMany/update/findUnique`;
  - `sefaz_lacunas.create/findMany`;
  - `notas_sefaz.findUnique` (`ambiente_chave` ou `id`), `create`, `update`, `findMany` e `count`;
  - `$transaction(cb)`, que desfaz tudo se `cb` lançar;
  - `tx.$queryRaw` (trava tentada, `[{ ok }]`) e `tx.$executeRaw` (trava que espera).
- **Ordem do `ciclo`**, sem rede e sem `emUso` antes do passo 4:
  1. ambiente;
  2. CNPJ da empresa;
  3. linha e `condicoes`;
  4. `emUso()`, e depois a raiz do CNPJ do certificado = a da empresa;
  5. páginas, até 10:
     - **T1:** trava tentada; confere de novo; fecha como `interrompida` a consulta aberta (`resultado` nulo); cria a consulta (`ciclo_id`, `ult_nsu_enviado`); grava `em_andamento_desde = agora`, `proxima_consulta_em = agora + 65 min` e `primeira_consulta_em` se vazia; lê o contexto da agenda (Decisão 5).
     - **Rede:** `SefazErro` vira `{ tipo: 'erro' }`; qualquer outro erro vira `SEFAZ_RESPOSTA_INVALIDA` enviado.
     - **T2:** trava que espera; grava os documentos (`tipo` pelo `schema`, `ilegivel` com o bruto); fecha a consulta; aplica `decidir` na linha da **própria consulta** (`ultima_consulta_em` só com `cStat` 137/138, Decisão 5; `em_andamento_desde = null`); com parada, grava `busca_ligada = false` e uma linha `parada_automatica` no histórico; grava a lacuna, se houver.
     - **Log** `sefaz.distribuicao` em JSON: `origem`, `ambiente`, `c_stat`, `documentos`, `ult_nsu`, `max_nsu` e `duracao_ms`.
     - **Depois:** `classificarPendentes()`; continua só com `maisPaginas`.
- **`buscarAgora`:**
  - **Antes de tudo, os erros:**
    - 503 `SEFAZ_DESLIGADA`;
    - 422 `SEFAZ_SEM_CNPJ` "Preencha o CNPJ da empresa no quadro Empresa e toque em Salvar no alto da página.";
    - 409 `SEFAZ_BUSCA_DESLIGADA` "A busca na SEFAZ está desligada. Ligue em Configurações → Notas da SEFAZ.";
    - 409 `SEFAZ_OCUPADA` "Já existe uma busca em andamento." (inclusive quando a trava não é obtida);
    - 409 `SEFAZ_AGUARDE` "A SEFAZ só permite nova busca a partir de {horaSp(liberadaEm)}.";
    - `CertificadoErro` vira `HttpException(err.status, { code, message })`;
    - raiz diferente vira 422 `SEFAZ_CERTIFICADO_OUTRA_EMPRESA` "O certificado digital é de outra empresa, e a SEFAZ recusaria a busca. Confira o CNPJ da empresa ou envie o certificado certo."
  - **Depois:** faz a T1 e devolve. O resto segue em segundo plano.
- **Agendador:**
  - com o ambiente `desligado`, não cria timer;
  - senão, `setTimeout(PRIMEIRO_TIQUE_MS)` e depois `setInterval(TIQUE_MS)`, ambos com `unref`;
  - `tique` = `ciclo('agendada', null)` + `classificarPendentes()`;
  - `onModuleDestroy` limpa os dois timers.

- [ ] **Step 1: testes que falham** (`ciclo.service.spec.ts`)
  - **Montagem:**
    - Prisma falso + `SefazDfeFalso`;
    - porta de certificado falsa que devolve `{ cnpj: '12345678000195', … }` (ou lança o `CertificadoErro` pedido);
    - `ConfigService` falso com `SEFAZ_DFE_AMBIENTE: 'producao'` e `relogio = () => AGORA`;
    - linha `(producao, 12345678000195)` ligada, com `ult_nsu 100n`.
  - **"138 → 137 no mesmo ciclo":**
    - respostas: 138 (ult 150, max 160, 2 documentos: `res-nfe` e `res-evento`) e depois 137 (ult 160);
    - a porta recebe `ultNsu` `[100n, 150n]`;
    - 2 consultas `respondida` com o mesmo `ciclo_id`;
    - a linha termina com `ult_nsu 160n`, `proxima_consulta_em` `18:10Z` e `em_andamento_desde null`;
    - 2 documentos processados e 2 linhas na caixa (VETOR autorizada e K77 cancelada).
  - **"10 páginas por ciclo":** 11 respostas 138 com ult < max dão 10 chamadas e `proxima_consulta_em` = `AGORA`.
  - **"queda entre as transações":**
    - **Estado semeado:** a consulta aberta (`resultado` null) e a linha com `em_andamento_desde` = AGORA − 1 min e a próxima = AGORA + 64 min.
    - **Três tentativas:**
      - em AGORA, `fim 'ocupada'`;
      - em AGORA + 30 min, `fim 'aguarde'`;
      - em AGORA + 65 min, a chamada sai.
    - **Asserções:** a porta é chamada 0, 0 e 1 vez; a consulta antiga termina `interrompida`.
  - **"656: esperar, bloquear duas vezes, resposta perdida e outro sistema"** (os casos 11–15 da agenda, pelo serviço):
    - `bloqueado_ate` é gravado;
    - o 2º 656 em 24 h deixa `busca_ligada false` e uma linha `parada_automatica` com `c_stat 656`;
    - a lacuna `resposta_perdida` é gravada sem desligar;
    - no D2, `parada_conflito` com a lacuna `outro_sistema`; na 1ª consulta, sem lacuna.
  - **"busca desligada durante a consulta"** (Review Focus 2):
    - no `antesDeResponder` da porta falsa, o teste põe `busca_ligada false` e troca `configuracoes.cnpj` para `11222333000181`;
    - a resposta 138 (ult 150, max 300) fica gravada na linha `(producao, 12345678000195)` com `ult_nsu 150n`;
    - a consulta fica `respondida`;
    - nenhuma 2ª chamada sai.
  - **"buscar agora":**
    - com a trava ocupada → 409 `SEFAZ_OCUPADA`, sem chamada;
    - com a próxima às 18:10Z → 409 `SEFAZ_AGUARDE` com `'A SEFAZ só permite nova busca a partir de 15h10.'`;
    - no caminho feliz → `{ iniciada: true }`, e o `ciclo` resolve `{ fim: 'feito', paginas: 1 }`.
  - **"nenhuma chamada quando não pode":**
    - ambiente `desligado` → `fim 'desligado'` e `buscarAgora` 503;
    - busca desligada → `fim 'nao_ligada'` e `buscarAgora` 409 `SEFAZ_BUSCA_DESLIGADA`;
    - empresa com `'00000000000000'` → `fim 'sem_cnpj'`, sem chamar `emUso`;
    - certificado ausente → `fim 'certificado'`;
    - nos quatro, a porta não é chamada.
  - **"falha antes de enviar não espera os 65 min":** `SEFAZ_TLS` não enviado deixa a próxima em AGORA + 15 min, `falhas_seguidas 1` e a consulta `falha_antes_de_enviar`.
  - **"503 e depois 138 com documentos ainda é D1"** (Decisão 5):
    - linha nova, com `ult_nsu 0n`;
    - 1º ciclo: erro `SEFAZ_HTTP` 503, enviado → `ultima_consulta_em` continua `null`;
    - 2º ciclo, em AGORA + 65 min: retorno 138 (ult 40, max 40, 40 documentos) → `aviso` = `indicioD1`, e `ultima_consulta_em` passa a ser preenchido.
  - **"classificação: um documento ruim não para os outros":**
    - o documento com DOCTYPE fica com `erro_processamento` e `processado_em null`;
    - o seguinte é processado.
  - **"log sem XML":** com um espião no `Logger`, nenhuma linha logada contém `'<resNFe'`, `'<nfeProc'` nem `'BEGIN'`.
- [ ] **Step 2: testes que falham** (`agendador.spec.ts`, `jest.useFakeTimers()`, `CicloSefazService` falso)
  - **Ambiente:**
    - `desligado` → depois de 11 min, nenhum ciclo;
    - `producao` → 1 ciclo em 1 min, 2 em 6 min e 3 em 11 min.
  - **Tique lento:** com o ciclo pendente, o intervalo seguinte não começa outro.
  - **Erros:** um ciclo que lança vira `logger.error`, e o tique seguinte roda.
  - **Destruição:** depois de `onModuleDestroy`, nenhum ciclo novo.
- [ ] **Step 3:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas-sefaz`. Esperado: FAIL.
- [ ] **Step 4: implementar**
  - **Módulo `NotasSefazModule`:** `imports: [CertificadoDigitalModule, SefazModule, NotasModule]` e `providers: [CicloSefazService, AgendadorSefaz]`.
  - **`app.module.ts`:** importa o módulo.
- [ ] **Step 5: prova no banco** (Decisão 14)
  - **Conexão:** `api/scripts/ciclo-sefaz-banco.ts` usa o `PrismaClient` do `DATABASE_URL`.
  - **Peças falsas:**
    - `CicloSefazService` com `ConfigService` falso (`homologacao`);
    - certificado falso `12345678000195`;
    - `SefazDfeFalso` respondendo `lerRetornoDistribuicao(retornoSoap({ … }))` montado com as fixtures da Task 3 (sem rede).
  - **Passos:**
    1. upsert da linha `(homologacao, 12345678000195)` ligada;
    2. ciclo com 138 (2 documentos, ult 2, max 3) e depois 137 (ult 3) → 2 consultas com o mesmo `ciclo_id`, `ult_nsu 3`, 2 documentos, a próxima em ≈ +65 min e ao menos uma linha em `notas_sefaz`;
    3. ciclo de novo → `fim 'aguarde'` e 0 chamadas;
    4. a próxima volta para o passado e uma 2ª `PrismaClient` com `connection_limit=1` segura `pg_advisory_lock(7011171201)` → `fim 'ocupada'`; depois, `pg_advisory_unlock`;
    5. `createMany` repetindo o NSU 1 com `skipDuplicates` → o total não muda.
  - **No fim:** apaga todas as linhas `homologacao` das 6 tabelas, na ordem das FKs, e imprime `ciclo-sefaz-banco: N ok`. Qualquer falha sai com 1.
  - **Execução:** no `smoke-capped.sh`, logo depois do seed e antes de subir a API: `DATABASE_URL="$URL" NODE_OPTIONS=--max-old-space-size=400 npx ts-node --transpile-only scripts/ciclo-sefaz-banco.ts`.
- [ ] **Step 6: rodar**
  - jest do Step 3 passa;
  - typecheck e lint limpos;
  - `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh` mostra `ciclo-sefaz-banco: … ok` e nenhuma falha nova.
- [ ] **Step 7:** `git commit -m "feat(notas-sefaz): ciclo da busca com trava consultiva, reserva de 65 min e agendador" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 7: Rotas da caixa e da configuração, origem `sefaz` e smoke

**Files:**
- Create: `api/src/modules/notas-sefaz/caixa.service.ts`, `notas-sefaz.controller.ts`, `notas-sefaz.dto.ts`
- Modify:
  - `notas-sefaz.module.ts`;
  - `api/src/modules/notas/dto/notas.dto.ts` (`@IsIn(['xml','pdf','foto','sefaz'])`);
  - `api/src/modules/certificado-digital/certificado-digital.port.ts` e `certificado-digital.service.ts` (`validoAte` no `VENCIDO`);
  - `api/src/common/__tests__/permissoes-protecao.spec.ts`, `api/scripts/smoke.sh`, `api/scripts/smoke-capped.sh`.
- Test:
  - `__tests__/caixa.service.spec.ts` e `__tests__/notas-sefaz.dto.spec.ts`;
  - `notas/__tests__/notas.dto.spec.ts`;
  - `certificado-digital/__tests__/certificado-digital.service.spec.ts`.

**Interfaces:**
- Consumes:
  - `CicloSefazService` (`ambiente`, `cnpjDaEmpresa`, `buscarAgora`) e `CHAVE_TRAVA_SEFAZ` (Task 6);
  - Task 5 inteira e `NotasService.notasLancadas`.
- Produces:
  ```ts
  export type SituacaoBuscaResposta = { ambiente: 'desligado' } | {
    ambiente: AmbienteSefaz; cnpj: string | null; busca_ligada: boolean; situacao: SituacaoBusca; mensagem: string | null; aviso: string | null;
    ultima_consulta: { em: string; novas: number } | null; primeira_consulta_em: string | null; proxima_consulta_em: string | null;
    bloqueado_ate: string | null; em_andamento: boolean; lacunas: number /* soma de nsu_ate − nsu_de + 1 das não preenchidas */;
    dias_sem_buscar: number | null /* dias desde ultima_consulta_em */; ligada_por_nome: string | null; ligada_em: string | null;
    outro_cnpj_ou_modo: boolean /* desligada aqui e ligada noutro (ambiente, CNPJ) */;
    certificado: { ok: boolean; code: string | null; mensagem: string | null; avisos: string[] };
    contagem: { falta_lancar: number; parece_lancada: number; cancelada_depois_de_lancada: number };
    canceladas_depois: { id: string; numero: string; serie: string; emitente_nome: string }[];
    historico: { evento: 'ligada' | 'desligada' | 'parada_automatica'; feito_por_nome: string | null; feito_em: string; c_stat: number | null }[]; // até 5
  };
  export type NotaSefazLinha = { id: string; chave: string; emitente_cnpj: string; emitente_nome: string; numero: string; serie: string;
    emitida_em: string | null; autorizada_em: string | null; valor_total: number | null; situacao_sefaz: SituacaoSefaz; cancelada_em: string | null;
    situacao: SituacaoNota; lancada: NotaParecida | null; parecidas: NotaParecida[]; pode_conferir: boolean; nao_parece_compra: boolean;
    ignorada: { em: string; por_nome: string | null; motivo: MotivoIgnorar; texto: string | null } | null };
  @Injectable() export class CaixaSefazService {
    situacao(agora?: Date): Promise<SituacaoBuscaResposta>;
    configurar(ligar: boolean, quem: Quem, agora?: Date): Promise<SituacaoBuscaResposta>;
    listar(filtro: 'a_conferir' | 'todas', limite: number): Promise<NotaSefazLinha[]>; // limite entre 1 e 500, padrão 100; emitida_em desc, nulos no fim
    xml(id: string): Promise<string>;
    ignorar(id: string, motivo: MotivoIgnorar, texto: string | null, quem: Quem, agora?: Date): Promise<NotaSefazLinha>;
    reabrir(id: string, quem: Quem): Promise<NotaSefazLinha>;
  }
  export class ConfigurarBuscaDto { @IsBoolean() busca_ligada!: boolean }
  export class IgnorarNotaSefazDto { @IsIn(MOTIVOS_IGNORAR, { message: 'Escolha o motivo.' }) motivo!: MotivoIgnorar;
    @IsOptional() @IsString() @MaxLength(300) texto?: string | null }
  // certificado-digital.port.ts: CertificadoErro ganha o 4º parâmetro opcional `readonly validoAte?: Date` (só no VENCIDO)
  ```
- **Controller** `@AdminOnly() @Controller('v1/notas-sefaz')`, nesta ordem de métodos:
  - `GET situacao`;
  - `PUT configuracao`;
  - `POST buscar` (`@HttpCode(202)`, devolve só `{ iniciada: true }`);
  - `GET ''` (`filtro`, `limite`);
  - `GET ':id/xml'` (`@Header('content-type', 'text/xml; charset=utf-8')`);
  - `POST ':id/ignorar'` e `POST ':id/reabrir'` (`@HttpCode(200)`).
- **`configurar`:**
  - tudo numa transação, com a trava que espera;
  - **Ligar:**
    - confere na ordem da `buscarAgora` (CNPJ → certificado → raiz);
    - faz o upsert com `busca_ligada true`, `situacao 'ok'`, `mensagem null` e `alterada_*`;
    - grava `ligada` no histórico.
  - **Desligar:**
    - com linha, grava `busca_ligada false`, `alterada_*` e `desligada` no histórico;
    - sem linha, não faz nada.
  - **Nunca** escreve `ult_nsu`, `proxima_consulta_em`, `bloqueado_ate`, `em_andamento_desde` nem `falhas_seguidas` (Review Focus 1).
- **`situacao.certificado.mensagem`** (frases da UX §4):
  - `CERTIFICADO_NAO_CADASTRADO` → "Envie o certificado digital da empresa no quadro acima para ligar a busca.";
  - `CERTIFICADO_VENCIDO` → "O certificado digital venceu em {dataBrSp(validoAte)}. Envie o renovado para a busca voltar.";
  - `CERTIFICADO_ILEGIVEL` e `CERTIFICADO_OUTRO_CNPJ` → a `message` do erro;
  - `EMPRESA_SEM_CNPJ`, conferido antes do `emUso` → a frase de `SEFAZ_SEM_CNPJ`;
  - **aviso**, sem bloquear: quando `certificado.keyUsage` é um array sem `'1.3.6.1.5.5.7.3.2'` → "A SEFAZ pode recusar este certificado (código 280). Se a busca falhar, peça ao contador um certificado A1 de empresa novo."
- **`xml`:**
  - ambiente `homologacao` → 409 `SEFAZ_HOMOLOGACAO` "Nota de teste (homologação) não entra no estoque.";
  - `cancelada` → 409 `SEFAZ_CANCELADA` "Esta nota foi cancelada pelo fornecedor e não entra no estoque.";
  - sem completo → 404 `SEFAZ_SEM_XML` "A SEFAZ ainda não liberou o XML desta nota. Dê entrada pelo arquivo ou pela foto.";
  - senão, o `xml` do documento completo.
- **Lista e ações:**
  - valem só para o (ambiente, CNPJ) atual; outra linha → 404 `NOT_FOUND` "Não encontrado.";
  - `outro` sem texto (após `trim`) → 400 `VALIDATION_ERROR` "Escreva o motivo.";
  - cada Ignorar e cada Reabrir loga `sefaz.caixa` com `id`, `motivo` e `usuario_id`.
- **Derivação:**
  - carrega as linhas do (ambiente, CNPJ) e chama `notasLancadas` uma vez, com as chaves e os emitentes delas;
  - aplica `lancamentosDaNota` e `situacaoDaNota`;
  - filtra por `A_CONFERIR` e corta no limite.
  - "N notas novas" segue a Decisão 6.

- [ ] **Step 1: testes que falham**
  - **`caixa.service.spec.ts`**, com o Prisma falso da Task 6 e `NotasService` falso:
    - **Servidor desligado:** `situacao()` devolve exatamente `{ ambiente: 'desligado' }`; as outras 5 operações dão 503 `SEFAZ_DESLIGADA`.
    - **Recusas ao ligar:**
      - sem CNPJ → 422 `SEFAZ_SEM_CNPJ` com a frase;
      - sem certificado → 503 `CERTIFICADO_NAO_CADASTRADO` com `MSG_USO.naoCadastrado`;
      - certificado de outra raiz → 422 `CERTIFICADO_OUTRO_CNPJ`.
    - **"ligar grava quem e quando":** `alterada_por_nome 'Ana'`, uma linha `ligada` no histórico, e a situação devolve `ligada_por_nome 'Ana'`.
    - **"desligar e ligar não antecipa a próxima busca":** com a próxima e o bloqueio às 18:10Z, o NSU 100 e falhas 2, depois de desligar e ligar os quatro campos ficam iguais.
    - **"ligar de novo depois de parada_conflito":** dá `situacao 'ok'` e `mensagem null`, e `bloqueado_ate` não muda.
    - **Situação:**
      - **certificado:**
        - um certificado com `keyUsage ['1.3.6.1.5.5.7.3.4']` dá o aviso 280;
        - vencido em 2026-03-10T15:00:00Z dá `'O certificado digital venceu em 10/03/2026. Envie o renovado para a busca voltar.'`;
      - com a linha `(producao, 11222333000181)` ligada e a empresa `12345678000195`, `outro_cnpj_ou_modo true`;
      - `contagem` e `canceladas_depois` batem com uma caixa semeada (as 5 notas do smoke abaixo).
    - **Lista:**
      - `a_conferir` traz só `cancelada_depois_de_lancada`, `parece_lancada` e `falta_lancar`, por emissão decrescente;
      - `todas` traz tudo;
      - limite 600 vira 500;
      - `pode_conferir` é falso em homologação.
    - **XML:** os três erros, cada um com a sua frase; o caminho feliz devolve o XML guardado.
    - **Ignorar:**
      - `outro` com `'  '` → 400 "Escreva o motivo.";
      - Ignorar comum numa cancelada depois de lançada mantém a situação `cancelada_depois_de_lancada`;
      - `cancelamento_conferido` a deixa `ignorada`;
      - `reabrir` limpa as 5 colunas;
      - id de outro CNPJ → 404.
  - **`notas-sefaz.dto.spec.ts`:**
    - motivo ausente dá a mensagem `'Escolha o motivo.'`;
    - `'xyz'` falha;
    - texto com 301 caracteres falha;
    - campo extra falha (`forbidNonWhitelisted`).
  - **`notas.dto.spec.ts`:** `origem 'sefaz'` passa.
  - **Certificado:** `emUso` vencido traz `validoAte` igual a `valido_ate`.
  - **`permissoes-protecao.spec.ts`:**
    - `NotasSefazController` entra em `CONTROLLERS`;
    - o teste novo "notas da SEFAZ só do admin" espera exatamente as 7 rotas, todas com marca `admin`: `GET /v1/notas-sefaz/situacao`, `PUT /v1/notas-sefaz/configuracao`, `POST /v1/notas-sefaz/buscar`, `GET /v1/notas-sefaz`, `GET /v1/notas-sefaz/:id/xml`, `POST /v1/notas-sefaz/:id/ignorar` e `POST /v1/notas-sefaz/:id/reabrir`.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas-sefaz src/modules/notas src/modules/certificado-digital src/common/__tests__/permissoes-protecao.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4: smoke**
  - **`smoke-capped.sh`:** acrescentar `SEFAZ_DFE_AMBIENTE=producao` no ambiente da API.
  - **`smoke.sh`:** bloco novo `# ---------- notas da SEFAZ (nenhuma chamada à SEFAZ: busca desligada e sem certificado)`, logo depois do último check do certificado e antes do `rm -f`. Tudo por SQL e HTTP.
  - **Loja:** `LOJA` recebe 403 nas 7 rotas; `:id` = `00000000-0000-4000-8000-000000000000`.
  - **Antes de semear:**
    - `GET situacao` (admin) → `ambiente producao`, `busca_ligada false` e `certificado.code CERTIFICADO_NAO_CADASTRADO`;
    - **a única tentativa de ligar do smoke:** `PUT configuracao {"busca_ligada":true}` → 503 `CERTIFICADO_NAO_CADASTRADO`, e o banco segue sem linha ligada;
    - `POST buscar` → 409 `SEFAZ_BUSCA_DESLIGADA`.
  - **Semear por SQL, com XML em dollar-quoting:**
    - `sefaz_distribuicao (producao, 12345678000195, busca_ligada false, ult_nsu 5, ultima_consulta_em now() - interval '1 hour')`;
    - uma `sefaz_consultas`, com o id guardado em `CONS`, `respondida`, `c_stat 138`;
    - um documento `procNFe` de K880 (NSU 1, XML fictício com `dest` 12345678000195), com `processado_em = now()`. Sem isso, o `classificarPendentes` do agendador (1 min depois do boot, e a cada 5 min) o pegaria no meio dos checks;
    - 5 notas na caixa:
      - (a) K880 `falta_lancar`, com `documento_completo_id`, `tp_nf 1`, `fin_nfe 1`;
      - (b) VETOR `cancelada` (lançada no bloco "CNPJ e chave com letras");
      - (c) KPARECE autorizada;
      - (d) K15 `denegada`;
      - (e) K120 `tp_nf 0`.
  - **Checks:**
    - **Situação:** `contagem` `{2, 1, 1}` e `canceladas_depois[0].numero` `4411`.
    - **Lista:**
      - `a_conferir` tem 4 linhas e `todas` tem 5;
      - (a) tem `pode_conferir true`; (e) tem `nao_parece_compra true`;
      - (c) tem `situacao 'parece_lancada'` e 2 parecidas: a mais nova é a `…44124` do bloco da nota repetida (`numero` gravado cru, `000.004.411`), e a outra é a do VETOR.
    - **XML:**
      - de (a) → 200, `content-type` começando por `text/xml` e o corpo com K880;
      - de (b) → 409 `SEFAZ_CANCELADA`;
      - de (d) → 404 `SEFAZ_SEM_XML`.
    - **Dar entrada pela SEFAZ:**
      - `POST /v1/notas` com `origem sefaz`, chave K880, CNPJ 11222333000181, número 880 e série 1 → 201;
      - (a) passa a `ja_lancada`, com `lancada.origem 'sefaz'`.
    - **Repetida:**
      - `POST /v1/notas` com `origem sefaz` e KPARECE (4411/1, 12ABC34501DE35) → 409 `NOTA_REPETIDA`;
      - com `confirmar_repetida true` → 201;
      - (c) vira `ja_lancada`.
    - **Ignorar e reabrir (e):**
      - sem motivo → 400;
      - `outro` sem texto → 400 com "Escreva o motivo.";
      - `nao_e_compra` → 200 `ignorada`;
      - reabrir → `falta_lancar`.
    - **Cancelada depois de lançada (b):**
      - Ignorar `nao_e_compra` → continua `cancelada_depois_de_lancada`;
      - `cancelamento_conferido` → `ignorada`, e a `contagem.cancelada_depois_de_lancada` vai a 0.
    - **Ids:** inexistente → 404; malformado → 404.
    - **Banco (`sql …; echo $?` = 1):**
      - NSU repetido em `sefaz_documentos`;
      - chave `ABC` em `notas_sefaz`;
      - `ignorada_em` sem motivo;
      - `ambiente 'teste'` em `sefaz_distribuicao`.
    - **Último check do smoke:** `select count(*) from sefaz_consultas where id <> '$CONS'` = 0.
- [ ] **Step 5:**
  - jest do Step 2 passa;
  - typecheck e lint limpos;
  - smoke sem falhas novas.
- [ ] **Step 6:** `git commit -m "feat(notas-sefaz): rotas da caixa e da configuração, origem sefaz no Dar entrada e smoke sem chamada à SEFAZ" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 8: Web: regras puras, cliente da API e painel em Configurações

**Files:**
- Create: `web/src/lib/notas-sefaz.ts`, `web/src/hooks/use-notas-sefaz.ts`, `web/src/components/notas-sefaz-painel.tsx`
- Modify: `web/src/lib/erp-api.ts`, `web/src/app/(app)/configuracoes/page.tsx`, `web/scripts/browser-check.mjs`
- Test: `web/src/lib/__tests__/notas-sefaz.test.ts`

**Interfaces:**
- Consumes: as rotas e os tipos da Task 7; `origemPorExtenso` de `@/lib/nota-repetida`; `formatarCnpj` e `dataHoraSp` de `@/lib/certificado`.
- Produces:
  ```ts
  // erp-api.ts — tipos iguais aos da API: SituacaoBuscaSefaz (= SituacaoBuscaResposta), NotaSefaz (= NotaSefazLinha), MotivoIgnorar
  export type SituacaoSefazLigada = Exclude<SituacaoBuscaSefaz, { ambiente: 'desligado' }>;
  export const situacaoSefaz: () => Promise<SituacaoBuscaSefaz>;
  export const configurarBuscaSefaz: (busca_ligada: boolean) => Promise<SituacaoBuscaSefaz>;
  export const buscarSefazAgora: () => Promise<{ iniciada: true }>;
  export const listarNotasSefaz: (filtro: 'a_conferir' | 'todas') => Promise<NotaSefaz[]>; // limite 500
  export const xmlNotaSefaz: (id: string) => Promise<string>; // api.get com responseType 'text'
  export const ignorarNotaSefaz: (id: string, motivo: MotivoIgnorar, texto?: string) => Promise<NotaSefaz>;
  export const reabrirNotaSefaz: (id: string) => Promise<NotaSefaz>;
  // a origem do lancarNota passa a aceitar 'sefaz'
  // hooks/use-notas-sefaz.ts
  export const SITUACAO_SEFAZ_KEY = ['notas-sefaz', 'situacao'] as const;
  export function useSituacaoSefaz(ativo: boolean): UseQueryResult<SituacaoBuscaSefaz>; // relê a cada 3 s enquanto em_andamento; senão staleTime 30 s
  // lib/notas-sefaz.ts (puro: o relógio vem por parâmetro)
  export function horaSp(iso: string): string; // "15h10"
  export function quando(iso: string, agora: Date): string; // "hoje às 14h05" | "ontem às 09h30" | "em 14/11 às 09h30"
  export function linhaUltimaBusca(s: SituacaoSefazLigada, agora: Date): string;
  export function linhaProxima(s: SituacaoSefazLigada): string | null; // "Próxima busca a partir das 15h10"
  export function linhaEspera(s: SituacaoSefazLigada): string; // "Próxima busca a partir das 15h10. A SEFAZ não deixa buscar antes."
  export function estadoBuscar(s: SituacaoSefazLigada, agora: Date): 'sem_botao' | 'buscando' | 'espera' | 'normal';
  export function toastBuscaFeita(novas: number): string;
  export function contagemAba(s: SituacaoSefazLigada): number; // falta_lancar + parece_lancada
  export function faixaCancelamento(c: SituacaoSefazLigada['canceladas_depois']): string | null;
  export const TEXTO_MOTIVO: Record<MotivoIgnorar, string>;
  export type TomSefaz = 'neutro' | 'ok' | 'warn' | 'bad' | 'muted';
  export type ResumoPainelSefaz = { tag: { tom: TomSefaz; texto: 'Ligada' | 'Desligada' | 'Parada' | 'Pausada' } | null; botao: 'ligar' | 'ligar_de_novo' | 'desligar' | null;
    botaoDesabilitado: boolean; caixas: { tom: 'neutro' | 'warn' | 'bad'; texto: string; irParaCertificado?: true }[]; linhas: string[] };
  export function resumoPainel(s: SituacaoBuscaSefaz, agora: Date): ResumoPainelSefaz;
  export type TagNota = { tom: TomSefaz; icone: 'CircleAlert' | 'EyeOff' | 'Ban' | 'CheckCircle2' | 'Copy'; texto: string; detalhe: string | null;
    soResumo: boolean; podeNaoSerCompra: boolean };
  export function tagDaNota(n: NotaSefaz): TagNota;
  ```
- **`resumoPainel`, regras e textos (UX §4, literais):**
  - **Servidor desligado:**
    - `tag null`, `botao null`;
    - uma caixa neutra: "A busca de notas na SEFAZ não está ativada neste servidor. Fale com o suporte do Freela Comanda se quiser usá-la."
  - **Tag:**
    - `parada_*` → Parada (bad);
    - ligada com `!certificado.ok` → Pausada (warn);
    - ligada → Ligada (ok);
    - senão → Desligada (muted).
  - **Botão:**
    - ligada → `desligar`;
    - `parada_*` → `ligar_de_novo`;
    - senão → `ligar`.
    - `botaoDesabilitado` = desligada e (`!certificado.ok` ou `cnpj === null`).
  - **Caixas, nesta ordem:**
    1. `parada_*` → bad com a `mensagem`;
    2. `ok` com `mensagem` → warn;
    3. `!certificado.ok` → a `certificado.mensagem`: neutra no `NAO_CADASTRADO` e bad nos outros (Decisão 18); `irParaCertificado` em `NAO_CADASTRADO`, `VENCIDO` e `ILEGIVEL`;
    4. `outro_cnpj_ou_modo` → warn "O CNPJ da empresa mudou desde a última vez. Ligue a busca de novo.";
    5. `lacunas > 0` → warn "Uma resposta da SEFAZ se perdeu e até N notas podem não ter chegado. Essas entram pelo arquivo ou pela foto.";
    6. `aviso` → warn;
    7. cada `certificado.avisos` → warn;
    8. desligada com `dias_sem_buscar > 50` → warn "A busca está desligada há N dias. Passando de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam. Ligue a busca de novo.";
    9. `primeira_consulta_em` nas últimas 24 h → neutra "Primeira busca feita. A SEFAZ passa a separar as notas deste CNPJ a partir de agora; as emitidas antes não aparecem aqui."
  - **Linhas com a busca ligada:**
    - "Última busca hoje às 14h05: nada novo";
    - "Próxima a partir das 15h10";
    - "N notas para conferir";
    - "Ligada por Ana em 16/11/2026 às 14h32";
    - em homologação, mais "Modo de teste da SEFAZ: as notas são de mentira.".
  - **Linha com a busca desligada:** "Com a busca desligada por mais de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam."
- **`tagDaNota`:** textos da tabela da UX §3.
  - **Já lançada:** "Já lançada por XML em 03/11" = `origemPorExtenso` + `DD/MM` da `data_entrada`, pela divisão do texto.
  - **Parece já lançada:** "Parece a NF 880 que você lançou por foto em 15/11".
  - **`detalhe` da ignorada:** "Motivo: Não é compra · por Ana, 15/11".
  - **Marcas:**
    - `soResumo` = `!pode_conferir` com situação `falta_lancar` ou `parece_lancada`;
    - `podeNaoSerCompra` = `nao_parece_compra`.
- **`TEXTO_MOTIVO`:**
  - "Já lancei de outro jeito";
  - "Não é compra";
  - "Não reconheço esta nota";
  - `outro` → "Outro motivo";
  - `cancelamento_conferido` → "Marcada como vista".
- **Painel** (`<Panel title="Notas da SEFAZ">`, âncora `id="notas-sefaz"`, padrão do `CertificadoPanel`):
  - **Conteúdo:** a abertura da UX §4, a tag, as caixas (`role="alert"` nas bad, `role="status"` nas demais), as linhas e o histórico em `<details>`.
  - **Ligar:**
    - abre o `AlertDialog` "Ligar a busca de notas?" com o texto da UX e o trecho em negrito;
    - botões "Ligar a busca" e "Agora não", com foco inicial em "Agora não";
    - o toast diz "Busca ligada. A primeira busca sai em instantes.".
  - **Desligar:** sem diálogo; toast "Busca desligada." com "Desfazer", que liga de novo.
  - **Ligar de novo:** "Ligar a busca de novo" abre o mesmo diálogo.
  - **Links:** "Ver as notas" leva a `/notas#notas-sefaz`; "Ir para o certificado" leva a `#certificado-digital`.
  - **Erros:**
    - da ação: caixa vermelha no painel, com `errMsg`;
    - carregando: 3 `Skeleton`;
    - erro ao ler: "Não consegui ver a situação da busca agora. Toque em Tentar de novo." + "Tentar de novo".
- **Configurações:** o painel entra só para admin, logo abaixo do `CertificadoPanel` e dentro de um `ErrorBoundary`. O `salvar()` também invalida `SITUACAO_SEFAZ_KEY`.

- [ ] **Step 1: testes que falham** (`notas-sefaz.test.ts`, `AGORA = new Date('2026-11-17T17:05:00Z')`)
  - **Horas:**
    - `horaSp('2026-11-17T18:10:00Z') === '15h10'`;
    - `quando` de `'2026-11-17T17:05:00Z'` → `'hoje às 14h05'`;
    - de `'2026-11-16T12:30:00Z'` → `'ontem às 09h30'`;
    - de `'2026-11-17T02:30:00Z'` → `'ontem às 23h30'`;
    - de `'2026-11-14T12:30:00Z'` → `'em 14/11 às 09h30'`.
  - **Última busca:**
    - `linhaUltimaBusca`: `'Última busca hoje às 14h05: 2 notas novas'`, `'…: 1 nota nova'`, `'…: nada novo'` e, sem consulta, `'Ainda não buscou.'`;
    - `toastBuscaFeita`: `'Busca feita: 2 notas novas.'`, `'Busca feita: 1 nota nova.'` e `'Busca feita: nada novo.'`.
  - **Botão Buscar:**
    - `estadoBuscar`: desligada → `sem_botao`; `em_andamento` → `buscando`; próxima às 18:10Z → `espera`; já liberada → `normal`;
    - `linhaEspera` usa o maior entre a próxima e o bloqueio.
  - **Faixa de cancelamento:**
    - uma nota → `'A NF 77 de LATICÍNIOS K, que você já lançou, foi cancelada pelo fornecedor. Estoque e contas a pagar não foram alterados: ajuste à mão, se for preciso.'`;
    - três → `'3 notas que você já lançou foram canceladas pelo fornecedor. Estoque e contas a pagar não foram alterados: ajuste à mão, se for preciso.'`;
    - nenhuma → `null`.
  - **`resumoPainel`**, um caso por regra acima:
    - servidor desligado;
    - ligada sem novidade;
    - `parada_conflito` → tag Parada, caixa bad com a frase de conflito e botão `ligar_de_novo`;
    - ligada com certificado vencido → Pausada;
    - sem certificado → `botaoDesabilitado`, caixa neutra e `irParaCertificado`;
    - CNPJ mudou;
    - desligada há 51 dias (sim) e há 50 (não).
  - **`tagDaNota`:** as 7 situações com os textos exatos, mais `soResumo` e `podeNaoSerCompra`.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/notas-sefaz.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4: acrescentar ao `browser-check.mjs`** o bloco "ADMIN: painel Notas da SEFAZ (celular 360x800)", depois do bloco da nota repetida (roda só na Task 10).
  - **API real, desligada:**
    - `#notas-sefaz` mostra a frase de servidor desligado;
    - nenhum botão "Ligar a busca".
  - **Montagem das rotas:**
    - `page.route('**/v1/notas-sefaz/**')` com um estado em memória, registrado antes do `goto`;
    - CORS e `OPTIONS` como na entrega 1;
    - prova de que nada ligou de verdade: no fim do bloco, `psql` no banco do navegador (`erpfreela_browser`, como já faz o bloco da faixa do certificado) dá `select count(*) from sefaz_distribuicao` = 0.
  - **Desligada com certificado:**
    - tag "Desligada";
    - "Ligar a busca" abre o `alertdialog` com o título exato, o trecho "Se o seu contador também baixa as notas pela SEFAZ, avise antes de ligar" e foco em "Agora não";
    - Esc fecha;
    - confirmar dá o toast "Busca ligada. A primeira busca sai em instantes.", a tag "Ligada" e "Ligada por".
  - **Desligar:** toast com "Desfazer".
  - **Estados simulados:**
    - `parada_conflito` → `role=alert` com a frase de conflito e o botão "Ligar a busca de novo";
    - sem certificado → botão desabilitado e a frase "Envie o certificado digital…".
  - **Medidas e captura:** `quemPassaDaBorda(page, 360).scroll <= 360`; captura `admin-notas-sefaz-painel-360.png`.
  - **Loja:** em Configurações, "Notas da SEFAZ" aparece 0 vezes.
  - **Fim do bloco:** `page.unroute`.
- [ ] **Step 5:** o vitest passa; `yarn typecheck` e `yarn lint` limpos (capados, 1500).
- [ ] **Step 6:** `git commit -m "feat(web): painel Notas da SEFAZ em Configurações (ligar e desligar a busca)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 9: Web: aba "Notas da SEFAZ" na Entrada de Notas

**Files:**
- Create: `web/src/components/notas-sefaz-aba.tsx`, `web/src/components/notas-sefaz-ignorar.tsx`, `web/src/components/notas-sefaz-faixa.tsx`
- Modify: `web/src/lib/notas-sefaz.ts` (`acoesDaNota`), `web/src/app/(app)/notas/page.tsx`, `web/scripts/browser-check.mjs`
- Test: `web/src/lib/__tests__/notas-sefaz.test.ts` (bloco novo `acoesDaNota`), `web/scripts/browser-check.mjs`

**Interfaces:**
- Consumes: tudo da Task 8; o `carregar` e o `arquivoRef` da página.
- Produces:
  ```ts
  // lib/notas-sefaz.ts (puro): a tabela "Ações por situação" abaixo, que os componentes só desenham
  export type AcaoNota = 'marcar_visto' | 'voltar_lista' | 'mesma_nota' | 'lancar_mesmo_assim' | 'conferir' | 'lancar_por_arquivo' | 'ignorar' | 'copiar_chave';
  export function acoesDaNota(n: NotaSefaz): { primaria: AcaoNota | null; secundarias: AcaoNota[] };
  NotasSefazAba(p: { situacao: SituacaoSefazLigada; focarId: string | null; onConferir(xml: string): void; onLancarPorArquivo(): void }): JSX.Element;
  NotasSefazIgnorar(p: { nota: NotaSefaz | null; onFechar(): void; onIgnorada(n: NotaSefaz): void }): JSX.Element; // aberto quando nota !== null
  FaixaCancelamentoSefaz(p: { canceladas: SituacaoSefazLigada['canceladas_depois']; onVer(): void }): JSX.Element | null;
  ```
- **Decisões na página:**
  - **Ligado ou não:**
    - `useSituacaoSefaz(true)`; `ligado` = há dados e `ambiente !== 'desligado'`;
    - sem `ligado`, a página é exatamente a de hoje, sem abas.
  - **Abas:**
    - com `ligado`, a faixa fica acima das abas;
    - `Tabs` (`@/components/ui/tabs`) controladas: `"lancar"` "Lançar nota" (padrão) e `"sefaz"` "Notas da SEFAZ" + (` · ${n}` se `contagemAba > 0`);
    - gatilhos com `h-11`;
    - `#notas-sefaz` no `useEffect` de montagem abre a aba `"sefaz"`.
  - **`carregar`:**
    - passa a `carregar(arquivos: File[], origemXml: "xml" | "sefaz" = "xml")`;
    - o tipo da origem ganha `"sefaz"`;
    - `setOrigem(fotos ? "foto" : isPdf ? "pdf" : origemXml)`.
  - **Conferir:**
    - na aba, `xmlNotaSefaz(id)`; em erro, caixa vermelha na aba com `errMsg`;
    - na página, `onConferir` = `setAba("lancar")` + `carregar([new File([xml], "nota-sefaz.xml", { type: "text/xml" })], "sefaz")`.
  - **"Lançar por arquivo ou foto":** `setAba("lancar")` e foco em `arquivoRef`.
  - **Faixa "Ver":** `setAba("sefaz")`, filtro "A conferir" e foco no cartão de `canceladas[0].id`.
- **Aba (UX §3, textos literais):**
  - **Cabeçalho:** `linhaUltimaBusca`.
  - **"Buscar agora"** (outline, 44 px):
    - `buscando`: "Buscando na SEFAZ…" com `Loader2`, desabilitado e `aria-live="polite"`;
    - `espera`: `aria-disabled` + `linhaEspera`;
    - ao terminar (`em_andamento` passa de true a false), toast `toastBuscaFeita(ultima_consulta.novas)`;
    - 409 `SEFAZ_AGUARDE` → caixa âmbar; outros erros → caixa vermelha.
  - **Filtro:** "A conferir (N)" / "Todas", dois botões com `aria-pressed`; consulta `['notas-sefaz', 'lista', filtro]`.
  - **"Por quê?":** um único `<details>` no alto, com o texto da UX §3.
  - **Avisos `role="status"`:**
    - `aviso`;
    - lacuna;
    - homologação: "MODO DE TESTE da SEFAZ: estas notas são de mentira e não entram no estoque.".
  - **Busca desligada:** caixa neutra com o texto da UX §3 e o link "Ligar em Configurações" (`/configuracoes#notas-sefaz`), sem "Buscar agora". Parada: a caixa de erro no lugar.
  - **Lista:**
    - cartões em `md:hidden`; tabela em `hidden md:block`, com as colunas Fornecedor (nome + CNPJ pequeno), NF / série, Emissão, Valor, Situação e Ações;
    - ícone + texto + tom pela `tagDaNota`.
  - **Ações por situação:**
    - **Marcar como visto:** ignora com `cancelamento_conferido`; toast "Nota marcada como vista." + Desfazer.
    - **Voltar para a lista:** reabre; toast "Nota de volta à lista.".
    - **É a mesma nota:** ignora com `lancada_de_outro_jeito`; toast "Nota ignorada." + Desfazer.
    - **Lançar mesmo assim:** Conferir se houver XML; senão, a aba Lançar nota.
    - **Conferir:** primária, só com `pode_conferir`; senão, "Lançar por arquivo ou foto" é a primária.
    - **"Ignorar…" e "Copiar chave":** `navigator.clipboard.writeText`, com o toast "Chave copiada.".
    - **Desfazer:** `duration: 8000` e chama `reabrirNotaSefaz`.
  - **Estados:**
    - carregando: 3 `Skeleton`;
    - erro: "Não consegui ver as notas da SEFAZ agora. Toque em Tentar de novo." + "Tentar de novo";
    - vazio com a busca ligada: "Nenhuma nota chegou ainda" + o texto da UX + "Buscar agora";
    - "A conferir" vazio com notas em "Todas": `CheckCircle2` "Tudo certo. Nenhuma nota para conferir." + "Ver todas".
- **Diálogo Ignorar** (`AlertDialog` único):
  - **Textos:** título "Ignorar esta nota?" e corpo "Ela sai da lista 'A conferir'. Nada é enviado à SEFAZ e nada é lançado.".
  - **Motivos:** `RadioGroup` com os 4 textos de `TEXTO_MOTIVO`, alvos de 44 px.
    - Sob "Não reconheço esta nota": a ajuda da UX.
    - "Outro motivo" abre o campo "Escreva o motivo", obrigatório.
  - **Botões:** "Ignorar nota" com `aria-disabled` até escolher (tocar sem escolha mostra "Escolha o motivo.") e "Cancelar".
  - **Sucesso:** toast "Nota ignorada." + Desfazer.
  - **Erro:** caixa vermelha no diálogo com `errMsg` + "Tentar de novo".

- [ ] **Step 1: testes que falham** (`notas-sefaz.test.ts`, bloco `acoesDaNota`, uma nota por situação):
  - `cancelada_depois_de_lancada` → `{ primaria: 'marcar_visto', secundarias: [] }`;
  - `ignorada` → `{ primaria: 'voltar_lista', secundarias: [] }`;
  - `cancelada`, `denegada` e `ja_lancada` → `{ primaria: null, secundarias: [] }`;
  - `parece_lancada` → `{ primaria: 'mesma_nota', secundarias: ['lancar_mesmo_assim'] }`, com ou sem `pode_conferir`;
  - `falta_lancar` com `pode_conferir` → `{ primaria: 'conferir', secundarias: ['ignorar', 'copiar_chave'] }`;
  - `falta_lancar` sem `pode_conferir` → `{ primaria: 'lancar_por_arquivo', secundarias: ['ignorar', 'copiar_chave'] }`.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/notas-sefaz.test.ts`. Esperado: FAIL (`acoesDaNota` não existe).
- [ ] **Step 3:** implementar `acoesDaNota`; o vitest do Step 2 passa.
- [ ] **Step 4: acrescentar ao `browser-check.mjs`** (só roda na Task 10) o bloco "ADMIN: aba Notas da SEFAZ (360x800 e 1366x900)", depois do bloco da Task 8, com o mesmo esquema de `page.route` e a mesma prova por `psql`.
  - **API real, desligada:** em `/notas`, nenhum `role=tab` com "Notas da SEFAZ" e nenhuma faixa.
  - **Rotas simuladas:**
    - **situação ligada:**
      - `contagem {1, 1, 1}`;
      - `canceladas_depois [{ numero: '77', emitente_nome: 'LATICÍNIOS K' }]`;
      - última busca hoje, próxima no passado;
    - **lista `a_conferir`, 3 linhas:**
      - K77 `cancelada_depois_de_lancada`;
      - K880 `parece_lancada`, sem XML;
      - K990 `falta_lancar` com `pode_conferir`;
    - **`todas`:** mais 4 linhas (`ja_lancada`, `cancelada`, `denegada` e `ignorada`);
    - **`/xml`:** `XML` do 1º bloco, com o `Id` trocado para `NFe`+K990 e o `<CNPJ>` do emitente trocado para 11222333000181;
    - **`ignorar`/`reabrir`:** devolvem a linha alterada;
    - **`buscar`:** 202; a situação seguinte vem com `em_andamento true` e a outra com `false`, `novas 2`.
  - **Checks:**
    - **Faixa:** a frase exata da faixa aparece na aba "Lançar nota".
    - **Abas:**
      - "Notas da SEFAZ · 2" existe, e "Lançar nota" está com `aria-selected="true"`;
      - ArrowRight no teclado seleciona a outra aba.
    - **Situações e "Por quê?":** em "Todas", cada uma das 7 situações mostra o texto da UX; "Só o resumo chegou." aparece em K880; o `<details>` "Por quê?" existe 1 vez.
    - **Ignorar:**
      - "Ignorar…" e depois "Ignorar nota" sem escolha → "Escolha o motivo.";
      - "Outro motivo" mostra "Escreva o motivo";
      - "Não é compra" + "Ignorar nota" → toast "Nota ignorada." com "Desfazer".
    - **Marcar como visto:** toast com "Desfazer".
    - **Buscar agora:** "Buscando na SEFAZ…" desabilitado e depois o toast "Busca feita: 2 notas novas.".
    - **Espera:** com a próxima no futuro, o botão fica desabilitado e aparece "Próxima busca a partir das HHhMM. A SEFAZ não deixa buscar antes.". A hora esperada vem de `Intl` com `America/Sao_Paulo` sobre o ISO simulado.
    - **Conferir K990:**
      - a aba "Lançar nota" é selecionada e o quadro "2. Dados da nota" aparece;
      - "Dar entrada" vai à API real e dá o toast "Entrada lançada no estoque";
      - "Notas lançadas" passa a ter a tag `SEFAZ`.
    - **Vazios e erro:**
      - lista `[]` → "Nenhuma nota chegou ainda";
      - lista 500 → "Não consegui ver as notas da SEFAZ agora. Toque em Tentar de novo.".
    - **Medidas:**
      - em 360: `quemPassaDaBorda <= 360`; "Buscar agora" e as abas com `boundingBox().height >= 44`;
      - em 1366: a tabela aparece, com os cabeçalhos "Fornecedor", "NF / série", "Emissão", "Valor" e "Situação".
    - **Link direto:** `goto('/notas#notas-sefaz')` abre com a aba SEFAZ selecionada.
    - **Storage:** `localStorage` só com `authUser` e `sessionStorage` vazio.
    - **Sem vazamento:** `select count(*) from sefaz_distribuicao` = 0 no `erpfreela_browser`.
    - **Console:** sem erros (filtrando "Failed to load resource", porque o 500 é simulado).
  - **Capturas:** `admin-notas-sefaz-aba-360.png` e `admin-notas-sefaz-aba-desktop.png`.
- [ ] **Step 5: implementar** os três componentes e as mudanças da página. As ações de cada linha vêm de `acoesDaNota`.
- [ ] **Step 6:** `cd web && ../scripts/run-capped.sh 1500 yarn test` passa; `yarn typecheck` e `yarn lint` limpos.
- [ ] **Step 7:** `git commit -m "feat(web): aba Notas da SEFAZ na Entrada de Notas (lista, faixa de cancelada, Ignorar e Conferir)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 10: Contrato, regras e verificação completa

**Files:**
- Modify:
  - `docs/api-contract.md`: § 11, origem `sefaz`; § 16 nova, "Notas da SEFAZ", com as 7 rotas, os tipos da Task 7, os códigos e as frases;
  - `CLAUDE.md` (Regras rápidas, uma linha);
  - `docs/deploy.md`: `SEFAZ_DFE_AMBIENTE` vem desligada, e `producao` só com o "eu autorizo" do dono.

- [ ] **Step 1:** escrever o contrato e o `deploy.md`.
- [ ] **Step 2:** acrescentar no `CLAUDE.md`:
  "Notas da SEFAZ (`modules/sefaz` = transporte mTLS, leitor de XML e porta `SEFAZ_DFE`; `modules/notas-sefaz` = agenda, ciclo e caixa; rotas `/v1/notas-sefaz`): `SEFAZ_DFE_AMBIENTE` ausente = `desligado` e nada roda; `producao` só com o "eu autorizo" do dono. Nenhum teste faz rede (porta falsa, HTTPS local, `page.route`); smoke e browser-check nunca ligam a busca com certificado; `@xmldom/xmldom` 0.9.12 só em `xml-leitura.ts`; `ca` = raízes do Node + âncoras ICP, nunca o pacote."
- [ ] **Step 3: verificação completa**, um comando por vez, capado, anotando os números:
  1. `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/common src/scripts`
  2. `… npx jest --runInBand src/modules/sefaz src/modules/notas-sefaz`
  3. `… npx jest --runInBand src/modules/notas src/modules/certificado-digital src/modules/leitura-pdf src/modules/cadastros`
  4. `… npx jest --runInBand src/modules --testPathIgnorePatterns 'modules/(sefaz|notas-sefaz|notas|certificado-digital|leitura-pdf|cadastros)/'`
  5. `… npm run typecheck`
  6. `… npm run lint`
  7. `npm audit --omit=dev` (rede, registro do npm): anotar os alertas de `@xmldom/xmldom`; sem correção automática
  8. `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh`
  9. `cd ../web && ../scripts/run-capped.sh 1500 yarn test`
  10. `… yarn typecheck`
  11. `… yarn lint`
  12. `../scripts/run-capped.sh 2600 bash scripts/browser-check.sh`: **uma tentativa só**. Saída 137 ou 75 é registrada como "não rodou (memória)", e a tarefa segue.
- [ ] **Step 4:** `git commit -m "docs(notas-sefaz): contrato, regras e verificação da entrega 2" -m "<números da verificação>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Auto-revisão

**Cobertura do desenho (Etapa 1):**

| Parte | Onde |
|---|---|
| Variável `SEFAZ_DFE_AMBIENTE`, compose, `.env.example` e padrão desligado | Task 1 |
| Modelo de dados (6 tabelas, CHECKs, UNIQUE, índices) | Task 1, com os CHECKs conferidos no banco pelo smoke da Task 7 |
| Transporte (TLS 1.2+, `rejectUnauthorized`, `agent: false`, 30 s, `enviado`, teto, `ca`) | Task 2 |
| Leitor (só xmldom, DOCTYPE, teto, nome local, gzip de 4 MB), porta, envelope, fixtures 589/137/138 e falso | Task 3 |
| Tabela "Retornos e falhas", D1, D2 e queda nossa | Task 4 (pura), Task 6 (pelo serviço) |
| Classificação e situação derivada (precedência, A conferir, `pode_conferir`, `nao_parece_compra`, faixa) | Task 5, Task 7 |
| `notasLancadas` (uma consulta; regra em `common/fiscal`) | Task 5 |
| Ciclo (condições, T1/T2, reserva de 65 min, 10 páginas, um documento por transação) e agendador (1 min/5 min, `unref`, um por vez) | Task 6 |
| Rotas, 503 desligado, 409/422/404, `origem: 'sefaz'`, permissões | Task 7 |
| Smoke do desenho (situação, caixa, XML, Já lançada, repetida, ignorar, cancelada, 409, loja, CHECKs) | Task 7 |
| Painel (UX §4) e aba, faixa, Ignorar, Conferir (UX §3); navegador (UX §7) | Tasks 8 e 9 |
| Pronto para a Etapa 2 sem retrabalho | `chamarSoap12` genérico, `SefazErro` próprio, CHECK `servico` nomeado, `ciclo_id` |

**Tipos conferidos entre tarefas:**
- `SituacaoBuscaResposta` (API) = `SituacaoBuscaSefaz` (web);
- `NotaSefazLinha` = `NotaSefaz`;
- `MotivoIgnorar`, `SituacaoNota` e `SituacaoBusca` têm os mesmos literais nas duas pontas;
- `CHAVE_TRAVA_SEFAZ` é o mesmo número no serviço e no harness;
- `ChamadaSoap12`/`ChamarSoap12` (Task 2) são os da injeção do adaptador (Task 3).

**Fora, de propósito:**
- vetor do Anexo da NT (já tratado na entrega 1);
- gráfico de consumo;
- o painel não mostra NSU (UX §5).

## Roteiro do primeiro teste real — só com o "eu autorizo" do dono

Nenhum agente executa este roteiro. Ele não é tarefa deste plano. Cada passo que fala com a SEFAZ precisa de um "eu autorizo" do dono, dado na hora e por escrito, e o dono acompanha.

1. **Antes, sem falar com a SEFAZ.**
   - **Conferir o servidor:**
     - a entrega 2 está no ar com `SEFAZ_DFE_AMBIENTE` ausente (desligado);
     - em Configurações, o certificado aparece "válido" e o CNPJ da empresa está salvo;
     - `select count(*) from sefaz_consultas` dá 0.
   - **Preparar:**
     - fazer um `pg_dump` do banco;
     - ler para o dono a frase da decisão 1: "Se o seu contador também baixa as notas pela SEFAZ, avise antes de ligar".
2. **Homologação (1º "eu autorizo").**
   - **Ligar:**
     - pôr `SEFAZ_DFE_AMBIENTE=homologacao` no `.env` do servidor e recriar só a API: `docker compose -f docker-compose.prod.yml up -d --no-deps api` (`docker restart`/`docker compose restart` não relê o `.env`);
     - "Ligar a busca" e "Buscar agora".
   - **Esperado:** 137, porque é o 1º uso.
   - **Registrar:** a linha de `sefaz_consultas` (`c_stat`, `erro_code`) e o log `sefaz.distribuicao`.
   - **Este passo fecha os pontos "não confirmado":**
     - `SEFAZ_TLS` com `enviado` falso = a raiz do emissor do `hom1` não está no `ca`: anotar o emissor e tratar num PR (pacote gerado, nunca env);
     - HTTP 415/500 ou rejeição de versão = SOAP 1.2 recusado, e entra o plano B (1.1, trocando uma função);
     - nenhum 593 = o CNPJ-base confere;
     - 280–286 ou 473 = problema no certificado.
3. **Homologação: 2º clique antes de 65 min.**
   - **Esperado:** 409 `SEFAZ_AGUARDE`, sem rede (`sefaz_consultas` não cresce).
   - **Depois dos 65 min:** o tique sozinho deve dar 137 de novo, sem 656.
4. **Produção (2º "eu autorizo").**
   - **Trocar:** desligar a busca, pôr `producao`, recriar só a API (o mesmo comando), ligar e fazer uma busca.
   - **Esperado:** 137.
   - **Respostas que pedem atenção:**
     - 138 com documentos = D1: só aviso;
     - 656 com `ultNSU` = D2: a busca se desliga e avisa, e o dono fala com o contador.
   - **Vigiar por 24 h:** `select c_stat, count(*) from sefaz_consultas where iniciada_em > now() - interval '24 hours' group by 1` não pode ter 656.
5. **Dias depois.** Uma nota que chegou como resumo e foi lançada por arquivo tem de virar "Já lançada".
6. **Volta, nesta ordem.**
   - PRIMEIRO tocar em "Desligar a busca" na tela: senão a linha fica `busca_ligada=true` e a busca recomeça sozinha no dia em que alguém puser a variável de volta.
   - Depois, `SEFAZ_DFE_AMBIENTE` vazia no `.env` e recriar só a API: `docker compose -f docker-compose.prod.yml up -d --no-deps api` (reiniciar não relê o `.env`).
   - Conferir: o painel diz "A busca de notas na SEFAZ não está ativada neste servidor." e `docker exec erp-freela-api printenv SEFAZ_DFE_AMBIENTE` sai vazio.
   - Nunca apagar linhas `sefaz_*`: elas são a prova das esperas.
   - Desligar por mais de 60 dias deixa buraco sem volta: avisar o dono.

## Pontos em aberto para o controlador

1. **"A primeira busca sai em instantes."** O desenho põe a busca no tique de 5 min, e Ligar não chama a SEFAZ (Decisão 12), então a 1ª busca pode levar até 5 min. A frase é literal da UX.
   - **Recomendo** manter o comportamento e o texto: a busca sai sozinha em minutos, e Ligar nunca provoca rede.
   - Se o dono preferir precisão, a troca é só de texto: "A primeira busca sai em até 5 minutos."
2. **Linha "CNPJ-base ≠ certificado" da UX §4.** Ela não aparece sozinha: o `emUso()` já lança `CERTIFICADO_OUTRO_CNPJ` quando a raiz difere, e o painel mostra o `msgOutroCnpj`, que é a frase "Ilegível / outro CNPJ" da própria UX. A conferência `SEFAZ_CERTIFICADO_OUTRA_EMPRESA` fica como defesa.
   - **Recomendo** manter: a frase do certificado diz os dois CNPJs e é mais útil.
3. **Frase do 409 `SEFAZ_HOMOLOGACAO`.** O desenho escreve "Nota de teste (homologação) não entra no estoque.", e a UX §5 evita "homologação". A tela nunca chega a esse erro, porque em modo de teste não há "Conferir".
   - **Recomendo** manter o texto do desenho. Se quiserem a linguagem da UX: "Nota do modo de teste da SEFAZ não entra no estoque."
