# Notas da SEFAZ, entrega 3: respostas à SEFAZ (ciência automática, confirmação, "Não reconheço", prazo de 90 dias) — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir a Etapa 2 do desenho, desligada de fábrica: com a variável e o botão ligados, o Comanda avisa a SEFAZ que cada nota nova chegou
(210210), confirma a compra quando a nota é lançada (210200), registra "Não reconheço" (210220) e "A compra não aconteceu" (210240), e avisa antes do
prazo de 90 dias.

**Architecture:**
- **Infraestrutura, `api/src/modules/sefaz/`:** assinatura XMLDSig (`assinatura-xml.ts`, interface fixa, também da NFC-e), montagem e leitura dos
  eventos (`eventos-xml.ts`), porta `SEFAZ_EVENTOS` com adaptador e falso. Reaproveita `chamarSoap12`, `confiancaSefaz`, `xml-leitura` e `SefazErro`.
- **Aplicação, `api/src/modules/notas-sefaz/`:** funções puras `respostas-plano.ts` (o que enviar e prazos) e `respostas-agenda.ts` (retorno → ação);
  `RespostasSefazService` (fila, duas transações curtas sob trava própria, rede fora delas), chamado pelo agendador de hoje; rotas na caixa.
- **"Dar entrada" não muda:** a confirmação é derivada no tique seguinte, a partir da nota lançada pela chave.
- **Web:** quadro "Respostas à SEFAZ" no painel, e na aba a faixa do prazo, as linhas do cartão, "Não reconheço…" e o diálogo Ignorar novo; regras
  puras em `web/src/lib/notas-sefaz.ts`.

**Tech Stack:** NestJS 11 + Fastify + Prisma 5/PostgreSQL (api, npm) · `node:crypto`/`node:https` · `@xmldom/xmldom` 0.9.12 (já instalado) · `xml-crypto`
6.4.0 só em devDependencies (oráculo) · Next 15 + TanStack Query + Radix (web, yarn) · jest, vitest, smoke em bash, browser-check (Playwright).

**Spec:** `docs/superpowers/specs/2026-11-16-notas-sefaz-design.md` (seção "Etapa 2", reescrita em 17/11) e `docs/superpowers/specs/2026-11-16-notas-sefaz-ux.md`
(§8; as trocas de frase da §8 valem sobre as §3/§4). Fonte das regras da SEFAZ: `docs/superpowers/specs/2026-11-17-pesquisa-ciencia-e-nfce.md`, Parte A.
Onde a UX fixa um texto, ele vale literalmente.

## Global Constraints

- **Ramo e commits:** ramo `feat/notas-sefaz`, sem trocar de ramo, um commit por tarefa, sem push e sem deploy; toda mensagem termina com
  `-m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`; `git add` só dos arquivos da tarefa.
- **NENHUMA chamada à SEFAZ, nem de homologação, em teste nenhum.** Nem handshake, nem `openssl s_client`, nem `?wsdl`.
- **Nenhum teste faz rede.** Porta falsa, servidor HTTPS local de teste em 127.0.0.1 e `page.route` no navegador.
- Só a Task 2 usa a rede, e só o registro do npm: `npm install --save-dev --save-exact xml-crypto@6.4.0`; e a Task 10 roda `npm audit --omit=dev`.
- **Chave, certificado e PEM nunca em log, resposta, erro ou arquivo de teste**; só os certificados fictícios de `api/scripts/gerar-certificados-teste.sh`.
  A assinatura usa o `KeyObject` (`cert.chavePrivada`), nunca `.export()`. O XML assinado (que traz o certificado público) fica só no banco.
- **Tudo desligado por padrão:** variável de ambiente `SEFAZ_MANIFESTACAO` (ausente ou vazia = `desligada`) **e** o botão "Ligar as respostas" na tela,
  como a busca. `ligada` só com o OK do contador e o "eu autorizo" do dono, fora deste plano.
- **O envio NUNCA entra em laço:** tentativas contadas e limitadas (3 por evento); um lote por tique; 108/109, 656, relógio e falha antes de enviar não
  viram repetição imediata (sempre `pausa_ate` no futuro).
- **Um evento é gravado como `enviando` (com o XML assinado) antes de sair.**
- **Tabela de retornos completa**, a do desenho, incluindo 128, 108/109, 575, 577/579, 250 e 252; esquema, `Id` e chave errados = definitivo (para a nota)
  ou as respostas param, nunca repetir; `cStat` de até 4 dígitos; `nProt` de 15 ou 17.
- **Esquema `envEvento`:** sem validador de XSD (ver Decisão 7); os testes conferem o XML montado contra os padrões dos esquemas do 010d v1.03
  (`leiauteEvento_v1.00.xsd`) e do pacote de 2014 (`e2102x0_v1.00.xsd`), listados no desenho.
- **Host de produção do evento `www.nfe.fazenda.gov.br`** (Let's Encrypt, cadeia até ISRG Root X1): um teste confere que a X1 está em `confiancaSefaz()`.
  `ca` continua = `tls.rootCertificates` + âncoras ICP; nenhuma variável acrescenta âncora; `rejectUnauthorized` sempre `true`.
- **XML:** `@xmldom/xmldom` 0.9.12 importado só em `api/src/modules/sefaz/xml-leitura.ts`; `xml-crypto` importado só em arquivos `__tests__`.
- **Comandos pesados** só por `scripts/run-capped.sh`, um por vez: jest, tsc e eslint 1500; smoke 1300; browser-check **3300**. jest sempre
  `npx jest --runInBand <caminhos>`; nunca `nest build` nem `next build`. 137 = estourou o teto; 75 = sem memória agora (registrar e seguir).
- **Rotas:** todas `@AdminOnly()` e listadas em `permissoes-protecao.spec.ts`; a lista da loja não muda; `:id` pelo `ParseUuidPipe`; erros
  `{ error: { code, message } }`; no web, `errMsg()`/`errCode()` e HTTP só em `web/src/lib/erp-api.ts`; erros em caixa na tela, nunca em toast.
- **Migração nova, sem mexer nas antigas:** SQL à mão no formato das existentes; ids `UUID DEFAULT gen_random_uuid()`; CHECKs nomeados
  `"<tabela>_<regra>"`; nenhuma das palavras `serial`, `identity`, `nextval` (nem dentro de outra palavra); datas `TIMESTAMPTZ(6)`, nenhuma coluna `date`.
- **Formatos:** hora `15h10`, data `15/02/2027`, sempre no fuso de Brasília; `dhEvento` com `-03:00`.
- **Constantes no código, nunca em env:** lote de 20; tique de 5 min (o de hoje); espera de 60 s do evento pedido pelo admin; 3 tentativas; pausas +60
  (fora do ar, relógio), +65 (656), +15 (sem resposta, 999); recuo 15/30/60 (falha antes de enviar); ciência até 9 dias; prazo de 90 dias; aviso no 80º
  dia; deriva de relógio 2 min; `cOrgao` 91; trava `7_011_171_202`.

## Decisões do plano (o desenho não fixa; não reabrir na implementação)

1. **Porta com eventos já assinados.** O serviço monta e assina **dentro** da T1 (assinar é local e leva milissegundos) e grava o XML assinado com
   `enviando` antes de a rede sair; a porta só embrulha e envia (`enviarLote(cert, ambiente, idLote, eventosAssinados)`).
2. **Cada evento é um documento** `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00">…</evento>` sem declaração XML; o lote os junta
   como estão. O `xmlns` repetido no `evento` não muda a C14N do `infEvento` (o namespace herdado é o mesmo).
3. **C14N restrita** (algoritmo; a assinatura não o determina): um só namespace padrão no elemento assinado e em todos os descendentes; nenhum prefixo
   em elemento ou atributo; sem comentário, sem instrução de processamento, sem `xmlns=""` (qualquer um = `AssinaturaErro`). Saída: `<nome` + `xmlns="…"`
   no elemento de topo (herdado ou próprio) e nos descendentes só se mudar + atributos em ordem de nome (código UCS) + `>` + filhos + `</nome>` (nunca
   `<x/>`); texto e CDATA escapam `&`→`&amp;`, `<`→`&lt;`, `>`→`&gt;`, `\r`→`&#xD;`; atributo escapa `&`, `<`, `"`→`&quot;`, `\t`→`&#x9;`, `\n`→`&#xA;`,
   `\r`→`&#xD;`; UTF-8.
4. **Onde entra a `Signature`:** logo depois do `</{nome}>` que fecha o elemento do `Id`; achado como o 1º `</{nome}>` depois da única ocorrência de
   `Id="{id}"`. Elemento com descendente de mesmo nome, ou `Id` ausente ou repetido = `AssinaturaErro`. `SignedInfo` no documento = a forma canônica sem
   o `xmlns` (já herdado da `Signature`).
5. **`idLote`** = milissegundos do relógio (13 dígitos); único por lote porque há um lote por tique sob a trava.
6. **Relógio:** a deriva vem da última consulta `respondida` da busca nas 24 h anteriores (`|Date.parse(dh_resp) − terminada_em|`); sem consulta, não
   confere.
7. **Sem validador de XSD:** `libxmljs2` é nativo e pesado, e `xmllint` não está na máquina nem na imagem. Os padrões ficam num teste
   (`eventos-xml.spec.ts`), com o arquivo e a versão do esquema citados em comentário.
8. **Planejador roda dentro da T1** (mesma trava), com as notas e os eventos lidos nela; o 210200 automático só nasce ali, nunca no `POST /v1/notas`.
9. **Frases:** o servidor grava em `sefaz_manifestacao.mensagem` as frases de lote (UX §8, tabela "Paradas e esperas") e em
   `sefaz_manifestacoes.mensagem` as de recusa; o cliente monta as de estado (linha da resposta, prazo, faixa, toasts).
10. **Smoke liga a variável, nunca as respostas:** sobe a API com `SEFAZ_MANIFESTACAO=ligada` (junto do `producao` de hoje) para exercitar as rotas;
    semeia `sefaz_manifestacao` com `ligada = false`; a única tentativa de ligar vem depois do DELETE do certificado. Browser-check: as duas variáveis
    vazias, tudo "ligado" por `page.route`.
11. **Certificado dos testes de assinatura:** o `CLIENTE` de `transporte-soap12.spec.ts` (fixtures `tls/cliente.key|pem`, fictícios) passa para
    `api/src/modules/sefaz/__tests__/certificado-teste.ts`, importado pelos dois.
12. **Toasts que a UX não fixa:** "Resposta cancelada." (Desfazer do diálogo, quando o evento ainda estava na fila).

## Review Focus

1. **Smoke sob `producao` com a variável ligada** (o smoke já faz `POST /v1/notas` com `origem: "sefaz"` e semeia notas da caixa): nada pode sair. Teste:
   Task 7, o smoke termina conferindo `sefaz_eventos_lotes` = 0 linhas e `sefaz_manifestacoes` igual ao semeado, sem nenhuma `enviando`; a trava do
   smoke passa a contar também `sefaz_manifestacao` ligadas.
2. **Desfazer correndo contra o tique** (8 s de toast, tique a qualquer segundo): o evento do admin espera 60 s e o `reabrir` o cancela sob a trava. Teste:
   Task 6 ("evento do admin não sai antes de 60 s") e Task 7 ("reabrir cancela o evento na fila; com o evento já `enviando`, só reabre").
3. **Duas respostas finais para a mesma chave** (duas abas; "Não reconheço" e depois "Dar entrada" pela chave): uma só fica ativa. Teste: Task 5
   (planejador não cria 210200 com final ativa), Task 7 (2º ignorar com aviso = 409 `SEFAZ_JA_RESPONDIDA`) e o smoke (o índice parcial recusa o INSERT).
4. **Justificativa digitada no celular** (aspas curvas, travessão, emoji, quebra de linha, 14 letras): nunca vira 595/225 na SEFAZ. Teste: Task 3
   (`normalizarJustificativa`), Task 7 (400 com as três frases) e Task 8 (a cópia do web igual à da API).
5. **Fronteiras de prazo no fuso de Brasília** (9 dias da ciência, 80º e 90º dia, nota autorizada perto da meia-noite): Teste: Task 5 (`prazoDaNota` e
   ciência com ±1 s) e Task 8 (`linhaPrazo` mostra `15/02/2027` para `2027-02-16T02:30:00Z`).

## Vetores de teste (fictícios)

- **Relógio:** `AGORA = 2026-11-17T17:05:00Z` = 14h05 em Brasília; `dhSefaz(AGORA) = '2026-11-17T14:05:00-03:00'`; +15 = 14h20; +60 = 15h05; +65 = 15h10.
- **CNPJ da empresa** `12345678000195` (seed e `valido.pfx`); emitentes `12ABC34501DE35` e `11222333000181`; chaves da entrega 2 (VETOR
  `35261112ABC34501DE35550010000044111000044116`, K880, K77, K120, K15).
- **Ids:** `ID210210` + VETOR + `01` (54 caracteres, casa `ID[0-9]{12}[0-9A-Z]{12}[0-9]{28}`); `ID210200`/`ID210220`/`ID210240` + chave + `01`.
- **Autorização:** `A9 = 2026-11-08T17:05:00Z` (exatos 9 dias: ciência sim) e `A9 − 1 s` (não); `A80 = AGORA − 80 dias` (aviso sim) e `+1 s` (não);
  `A90 = AGORA − 90 dias` (prazo passou) e `+1 s` (ainda não).
- **Justificativa:** "Mercadoria devolvida — “recusada” na porta’" → "Mercadoria devolvida - \"recusada\" na porta'"; "  pedido\ncancelado pelo
  fornecedor  " → "pedido cancelado pelo fornecedor"; "Pedido cancelad" (15) ok; 14 = `curta`; 256 = `longa`; "Devolvido 🍅 inteiro" = `caractere`.
- **Retornos fictícios** (fixtures, montadas no formato do `retEnvEvento_v1.00.xsd`): `ret-evento-128.xml` (VETOR 135 com `nProt` de 15 dígitos e K880
  573 sem protocolo), `ret-evento-128-17.xml` (lote 128 com dois `retEvento`: VETOR 135 com `nProt` de 17 dígitos e K77 com `cStat` de 4 dígitos, 1234), `ret-evento-108.xml`.

---

### Task 1: Variável, tabelas e modelos

**Files:**
- Create: `api/prisma/migrations/20261118120000_notas_sefaz_respostas/migration.sql`
- Modify: `api/prisma/schema.prisma`; `api/src/common/config/env.validation.ts`; `docker-compose.prod.yml` (`api.environment`); `api/.env.example`;
  `docs/deploy/.env.prod.example`; `web/scripts/browser-check.sh` (força `SEFAZ_MANIFESTACAO=`); `api/src/scripts/import-lovable/esquema.ts`
  (`TABELAS_SO_NOSSAS` + 3)
- Test: `api/src/common/config/__tests__/env.validation.spec.ts`, `api/src/scripts/import-lovable/__tests__/esquema.spec.ts`

**Interfaces:**
- Produces:
  - `Env.SEFAZ_MANIFESTACAO: 'desligada' | 'ligada'` = `z.preprocess(vazioComoAusente, z.enum(['desligada','ligada']).default('desligada'))`, e um
    `superRefine` no objeto: `ligada` com `SEFAZ_DFE_AMBIENTE = 'desligado'` → erro "SEFAZ_MANIFESTACAO=ligada exige SEFAZ_DFE_AMBIENTE homologacao ou producao.";
  - compose `SEFAZ_MANIFESTACAO: ${SEFAZ_MANIFESTACAO:-}`; nos dois `.env` de exemplo, comentado: `# SEFAZ_MANIFESTACAO=desligada (desligada | ligada; ligada só depois do OK do contador e do "eu autorizo" do dono)`;
  - modelos Prisma: `sefaz_manifestacao` (`@@id([ambiente, cnpj])` → `ambiente_cnpj`), `sefaz_eventos_lotes`, `sefaz_manifestacoes` (os índices parciais
    só no SQL; o Prisma não os declara).
- **SQL** (colunas do desenho, "Dados"; aqui o que ele não fixa):
  - `sefaz_manifestacao`: `ligada BOOLEAN NOT NULL DEFAULT false`, `situacao TEXT NOT NULL DEFAULT 'ok'` + CHECK `"sefaz_manifestacao_situacao"`,
    `falhas_seguidas INTEGER NOT NULL DEFAULT 0`, `ligada_em`, `pausa_ate`, `mensagem TEXT`; CHECKs de ambiente e CNPJ iguais aos de `sefaz_distribuicao`.
  - `sefaz_eventos_lotes`: `id_lote BIGINT NOT NULL` com CHECK `BETWEEN 1 AND 999999999999999`; `resultado` com o CHECK dos quatro de `sefaz_consultas`;
    índice (ambiente, cnpj, iniciado_em DESC).
  - `sefaz_manifestacoes`: `nota_sefaz_id UUID NOT NULL REFERENCES notas_sefaz(id)`; `lote_id UUID REFERENCES sefaz_eventos_lotes(id)`; CHECKs
    `"sefaz_manifestacoes_tp_evento"` (os 4), `"…_n_seq"` (1–2), `"…_x_just"` (`(tp_evento = '210240') = (x_just IS NOT NULL)` e
    `x_just IS NULL OR char_length(x_just) BETWEEN 15 AND 255`), `"…_origem"`, `"…_situacao"`, `"…_tentativas"` (0–3), `"…_c_stat"` (NULL ou 100–9999),
    `"…_n_prot"` (`~ '^[0-9]{15}([0-9]{2})?$'`), `"…_chave"` (a de `notas_sefaz`); `impressao_digital CHAR(64)`; `enviar_apos NOT NULL`;
    UNIQUE parcial `"sefaz_manifestacoes_evento_ativo"` (ambiente, chave, tp_evento, n_seq) `WHERE situacao <> 'cancelada'`; UNIQUE parcial
    `"sefaz_manifestacoes_uma_final"` (ambiente, chave) `WHERE tp_evento <> '210210' AND situacao IN ('na_fila','enviando','registrada','falhou')`;
    índice (ambiente, cnpj, situacao, enviar_apos).
  - Trocas de CHECK (`ALTER TABLE … DROP CONSTRAINT …, ADD CONSTRAINT …` com o mesmo nome): `sefaz_distribuicao_historico_evento` + `respostas_ligadas`,
    `respostas_desligadas`, `respostas_paradas`; `notas_sefaz_motivo` + `compra_nao_aconteceu`.

- [ ] **Step 1: testes que falham.** `env.validation.spec`: ausente e `''` → `desligada`; `ligada` com `homologacao` passa; `ligada` sem
  `SEFAZ_DFE_AMBIENTE` → erro com a frase; `sim` → erro. `esquema.spec`: as 3 tabelas em `TABELAS_SO_NOSSAS` e a migração sem as palavras proibidas.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/common/config src/scripts/import-lovable`. Esperado: FAIL.
- [ ] **Step 3:** escrever a migração, o `schema.prisma`, o env e os arquivos de configuração; `npm run prisma:generate`.
- [ ] **Step 4:** o jest do Step 2 passa; `../scripts/run-capped.sh 1500 npm run typecheck` limpo.
- [ ] **Step 5:** `git commit -m "feat(notas-sefaz): variável SEFAZ_MANIFESTACAO desligada e tabelas das respostas à SEFAZ" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 2: Assinatura XMLDSig (interface fixa) e a raiz ISRG X1

**Files:**
- Create: `api/src/modules/sefaz/assinatura-xml.ts`, `api/src/modules/sefaz/__tests__/certificado-teste.ts` (Decisão 11)
- Modify: `api/package.json` + `package-lock.json` (devDependency `xml-crypto` `6.4.0` exata); `api/src/modules/sefaz/__tests__/transporte-soap12.spec.ts`
  (importa o `CLIENTE`)
- Test: `api/src/modules/sefaz/__tests__/assinatura-xml.spec.ts`, `api/src/modules/sefaz/__tests__/confianca.spec.ts`

**Interfaces:**
- Consumes: `lerXml`, `elementos`, `NoXml` (`xml-leitura.ts`); `CertificadoEmUso`.
- Produces:
  ```ts
  export const XMLDSIG = {
    ns: 'http://www.w3.org/2000/09/xmldsig#', c14n: 'http://www.w3.org/TR/2001/REC-xml-c14n-20010315',
    enveloped: 'http://www.w3.org/2000/09/xmldsig#enveloped-signature', rsaSha1: 'http://www.w3.org/2000/09/xmldsig#rsa-sha1',
    sha1: 'http://www.w3.org/2000/09/xmldsig#sha1',
  } as const;
  export class AssinaturaErro extends Error {} // frase fixa: "O XML não pôde ser assinado." — nunca trecho do XML
  export function canonicalizar(el: NoXml): string; // C14N 2001 inclusiva, subconjunto da Decisão 3
  export function assinarXmlEnveloped(xml: string, idDoElemento: string, cert: CertificadoEmUso): string;
  ```
  `Signature` = `<Signature xmlns="…xmldsig#"><SignedInfo><CanonicalizationMethod Algorithm="{c14n}"></CanonicalizationMethod><SignatureMethod
  Algorithm="{rsaSha1}"></SignatureMethod><Reference URI="#{id}"><Transforms><Transform Algorithm="{enveloped}"></Transform><Transform
  Algorithm="{c14n}"></Transform></Transforms><DigestMethod Algorithm="{sha1}"></DigestMethod><DigestValue>{b64}</DigestValue></Reference></SignedInfo>
  <SignatureValue>{b64}</SignatureValue><KeyInfo><X509Data><X509Certificate>{cert.certificado.raw em base64}</X509Certificate></X509Data></KeyInfo></Signature>`
  (sem espaços entre as marcas). `DigestValue` = SHA-1 da C14N do elemento; `SignatureValue` = `crypto.sign('RSA-SHA1', C14N do SignedInfo, cert.chavePrivada)`.

- [ ] **Step 1:** `cd api && npm install --save-dev --save-exact xml-crypto@6.4.0` (rede: só o registro do npm). Conferir no `package.json` `"xml-crypto": "6.4.0"`
  em `devDependencies` e anotar no commit que ele traz `@xmldom/xmldom` 0.8.x só no ambiente de desenvolvimento. Num teste rápido de 5 linhas (que
  fica no spec), conferir que a 6.4.0 ainda aceita `signatureAlgorithm: XMLDSIG.rsaSha1` e `digestAlgorithm: XMLDSIG.sha1`; se recusar, parar e avisar
  o controlador.
- [ ] **Step 2: testes que falham** (`assinatura-xml.spec.ts`, com o `CLIENTE` e um `evento` de 210240 cujo `xJust` é `"Devolvido &amp; recusado &lt;na porta&gt; ção"`):
  - `xml-crypto confere a nossa`: `new SignedXml({ publicCert })` + `loadSignature(<Signature> do resultado)` + `checkSignature(resultado) === true`;
  - `igual ao xml-crypto byte a byte`: o `computeSignature` do `xml-crypto` sobre a mesma entrada (mesmos algoritmos, `location` depois do elemento)
    dá o mesmo `DigestValue` e o mesmo `SignatureValue`;
  - `adulterado não confere`: trocar uma letra do `xJust` depois de assinar → `checkSignature` falso;
  - `xmlns herdado`: `canonicalizar(infEvento)` começa com `<infEvento xmlns="http://www.portalfiscal.inf.br/nfe" Id="ID210240` e não tem `/>`;
  - `posição`: o resultado tem `</infEvento><Signature xmlns="http://www.w3.org/2000/09/xmldsig#">` e termina em `</Signature></evento>`;
  - `só a folha`: exatamente um `<X509Certificate>`, igual a `CLIENTE.certificado.raw.toString('base64')`; nenhum `KeyValue`, `X509IssuerSerial`, `X509SubjectName`;
  - `chave nunca exportada`: `jest.spyOn(CLIENTE.chavePrivada, 'export')` não é chamado;
  - `recusas`: `Id` ausente, `Id` repetido, elemento com prefixo, comentário dentro, descendente com o mesmo nome → `AssinaturaErro` cuja mensagem não
    contém `infEvento` nem `<`;
  - `confianca.spec`: `confiancaSefaz(icp)` contém um certificado com `fingerprint256 === '96:BC:EC:06:26:49:76:F3:74:60:77:9A:CF:28:C5:A7:CF:E8:A3:C0:AA:E1:1A:8F:FC:EE:05:C0:BD:DF:08:C6'` (ISRG Root X1).
- [ ] **Step 3:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/sefaz`. Esperado: FAIL nos novos.
- [ ] **Step 4:** implementar `assinatura-xml.ts` e o `certificado-teste.ts`.
- [ ] **Step 5:** o jest do Step 3 passa (todos os de `src/modules/sefaz`); typecheck limpo.
- [ ] **Step 6:** `git commit -m "feat(sefaz): assinatura XMLDSig enveloped (C14N 2001, RSA-SHA1) com xml-crypto de oráculo, e a raiz ISRG X1 fixada" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 3: Montagem e leitura dos eventos, porta, adaptador e falso

**Files:**
- Create: `api/src/modules/sefaz/eventos.port.ts`, `api/src/modules/sefaz/eventos-xml.ts`, `api/src/modules/sefaz/eventos.adapter.ts`,
  `api/src/modules/sefaz/__tests__/sefaz-eventos.falso.ts`, fixtures `ret-evento-128.xml`, `ret-evento-128-17.xml`, `ret-evento-108.xml`
- Modify: `api/src/modules/sefaz/sefaz.module.ts` (provê e exporta `SEFAZ_EVENTOS`); `api/src/modules/sefaz/sefaz-erro.ts` (`PassoLeitura` + `'retEvento'`)
- Test: `api/src/modules/sefaz/__tests__/eventos-xml.spec.ts`, `api/src/modules/sefaz/__tests__/eventos.adapter.spec.ts`

**Interfaces:**
- Consumes: `assinarXmlEnveloped` (Task 2); `chamarSoap12`/`CHAMAR_SOAP12`, `TEMPO_LIMITE_MS`, `TETO_RESPOSTA_BYTES`, `confiancaSefaz`, `lerXml`, `sefazErro`.
- Produces:
  ```ts
  // eventos.port.ts — a porta do desenho ("Montagem, assinatura e porta"), literalmente: SEFAZ_EVENTOS, TipoEvento, RetornoEvento,
  // RespostaLoteEventos, SefazEventosPort.enviarLote(cert, ambiente, idLote, eventosAssinados)
  // eventos-xml.ts
  export const URL_EVENTOS: Record<AmbienteSefaz, string>; // www (produção) e hom1 (homologação), do desenho
  export const ACTION_EVENTOS = 'http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento';
  export const C_ORGAO_AN = '91';
  export const DESC_EVENTO: Record<TipoEvento, string>; // "Confirmacao da Operacao" | "Ciencia da Operacao" | "Desconhecimento da Operacao" | "Operacao nao Realizada"
  export interface DadosEvento { ambiente: AmbienteSefaz; cnpjAutor: string; chave: string; tpEvento: TipoEvento; dhEvento: string; xJust: string | null }
  export function idDoEvento(tpEvento: TipoEvento, chave: string): string;       // "ID" + tp + chave + "01"
  export function dhSefaz(d: Date): string;                                       // Brasília, "-03:00" fixo (sem horário de verão desde 2019)
  export type Justificativa = { ok: true; texto: string } | { ok: false; erro: 'curta' | 'longa' | 'caractere' };
  export function normalizarJustificativa(t: string): Justificativa;              // ’‘→' “”→" –—→- ; espaços/quebras → 1 espaço; trim; 15–255; U+0020–U+00FF
  export function montarEvento(d: DadosEvento): string;                           // <evento …> sem Signature; valida os padrões; lança Error de frase fixa
  export function eventoAssinado(d: DadosEvento, cert: CertificadoEmUso): string; // montarEvento + assinarXmlEnveloped(…, idDoEvento(…), cert)
  export function corpoEnvEvento(idLote: bigint, eventosAssinados: string[]): string; // <nfeDadosMsg xmlns="…/NFeRecepcaoEvento4"><envEvento …><idLote>…
  export function lerRetornoEventos(corpoHttp: string): RespostaLoteEventos;      // defeito = SefazErro SEFAZ_RESPOSTA_INVALIDA com o passo
  // __tests__/sefaz-eventos.falso.ts
  export class SefazEventosFalso implements SefazEventosPort { chamadas: { ambiente; idLote; eventos: string[] }[]; proximas: (RespostaLoteEventos | SefazErro)[]; aoChamar?: () => void }
  export function retornoLote(cStat: number, retornos: Partial<RetornoEvento>[]): RespostaLoteEventos;
  ```
  `xJust` vai em `montarEvento` já normalizado; `montarEvento` recusa `xJust` fora do 210240 e o 210240 sem `xJust`. `lerRetornoEventos`: `retEnvEvento`
  por nome local; `cStat` `^[0-9]{3,4}$` (lote e evento); até 20 `retEvento`; `nProt` fora de `^[0-9]{15}([0-9]{2})?$` = `null`; `xml` = o `retEvento`
  serializado como veio (texto entre as marcas, sem NUL).

- [ ] **Step 1: testes que falham** (`eventos-xml.spec.ts`):
  - **padrões** (comentário cita `leiauteEvento_v1.00.xsd` do 010d v1.03 e `e2102x0_v1.00.xsd` de 2014), para os 4 tipos e para a chave VETOR (letras):
    `Id` casa `^ID[0-9]{12}[0-9A-Z]{12}[0-9]{28}$`; filhos de `infEvento` na ordem `cOrgao, tpAmb, CNPJ, chNFe, dhEvento, tpEvento, nSeqEvento,
    verEvento, detEvento`; `cOrgao` 91; `tpAmb` 1 em produção e 2 em homologação; `dhEvento` casa `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[-+](0\d|1[0-2]):00$`;
    `nSeqEvento` 1; `verEvento` e os dois `versao` = `1.00`; `descEvento` = `DESC_EVENTO[tp]`; `xJust` só no 210240;
  - `dhSefaz(AGORA) === '2026-11-17T14:05:00-03:00'`; `dhSefaz(new Date('2026-11-17T02:30:00Z')) === '2026-11-16T23:30:00-03:00'`;
  - `normalizarJustificativa`: os vetores do topo;
  - `corpoEnvEvento(1763399100000n, [a, b])` começa com `<nfeDadosMsg xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4"><envEvento
    xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>1763399100000</idLote>`, não tem `<?xml` nem `nfeRecepcaoEvento>` (sem
    elemento da operação); 0 e 21 eventos e `idLote` 10^15 lançam;
  - `lerRetornoEventos`: as 3 fixtures (128 com 135 + 573; 17 dígitos e o `cStat` 1234 lido como número; 108 sem `retEvento`); um lote inline com `cStat`
    `1234` lido sem erro; corpo sem `retEnvEvento` → `SEFAZ_RESPOSTA_INVALIDA`
    passo `soap`; `<!DOCTYPE` → passo `xml`; `cStat` `12345` → passo `cStat`; 21 `retEvento` → passo `retEvento`.
  - `eventos.adapter.spec.ts`: com um `chamar` falso, o pedido usa `URL_EVENTOS[ambiente]`, `ACTION_EVENTOS`, `confiancaSefaz(icp)`, `TEMPO_LIMITE_MS`,
    `TETO_RESPOSTA_BYTES` e o corpo de `corpoEnvEvento`; a resposta passa por `lerRetornoEventos`; `SefazErro` do transporte sobe igual.
- [ ] **Step 2:** `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/sefaz`. Esperado: FAIL nos novos.
- [ ] **Step 3:** implementar; o `SefazModule` provê `SefazEventosAdapter` e `{ provide: SEFAZ_EVENTOS, useExisting: SefazEventosAdapter }`.
- [ ] **Step 4:** o jest do Step 2 passa; typecheck limpo.
- [ ] **Step 5:** `git commit -m "feat(sefaz): eventos da manifestação (montagem conferida contra o esquema, leitura do retorno) e porta SEFAZ_EVENTOS" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 4: Decisão do lote (pura)

**Files:**
- Create: `api/src/modules/notas-sefaz/respostas-agenda.ts`
- Modify: `api/src/modules/notas-sefaz/frases.ts` (`FRASE_RESPOSTA`)
- Test: `api/src/modules/notas-sefaz/__tests__/respostas-agenda.spec.ts`

**Interfaces:**
- Consumes: `CodigoSefazErro` e `CodigoFault` (`sefaz-erro.ts`; o serviço passa o `fault` do `SefazErro`); `TipoEvento`; `RECUO_FALHA_MIN` e `horaSp` (entrega 2).
- Produces:
  ```ts
  export type SituacaoRespostas = 'ok' | 'parada_certificado' | 'parada_configuracao' | 'parada_656' | 'parada_relogio';
  export type EstadoEvento = 'na_fila' | 'enviando' | 'registrada' | 'recusada' | 'falhou' | 'cancelada';
  export const LOTE_MAX = 20, TENTATIVAS_MAX = 3, ESPERA_ADMIN_MS = 60_000, DERIVA_MAX_MS = 2 * 60_000;
  export const PAUSA_FORA_DO_AR_MS = 60 * 60_000, PAUSA_656_MS = 65 * 60_000, PAUSA_CURTA_MS = 15 * 60_000, PAUSA_RELOGIO_MS = 60 * 60_000;
  export type ChamadaLote =
    | { tipo: 'retorno'; cStat: number; retornos: { chave: string | null; tpEvento: string | null; nSeq: number | null; cStat: number; nProt: string | null }[] }
    | { tipo: 'erro'; code: CodigoSefazErro; enviado: boolean; httpStatus?: number; fault?: CodigoFault };
  export interface EntradaLote {
    agora: Date; eventos: { id: string; chave: string; tpEvento: TipoEvento; tentativas: number /* já com o +1 da T1 */ }[];
    falhasSeguidas: number; semRespostaSeguidas: number; vezes656Em24h: number; relogioNoLoteAnterior: boolean; chamada: ChamadaLote;
  }
  export interface DecisaoEvento { id: string; estado: EstadoEvento; gastou: boolean; cStat: number | null; protocolo: string | null; mensagem: string | null }
  export interface DecisaoLote {
    resultado: 'respondida' | 'falha_antes_de_enviar' | 'sem_resposta'; eventos: DecisaoEvento[]; situacao: SituacaoRespostas;
    mensagem: string | null; pausaAte: Date | null /* null = não muda */; falhasSeguidas: number; relogio: boolean;
  }
  export function decidirLote(e: EntradaLote): DecisaoLote;
  export function derivaRelogio(dhResp: string | null, terminadaEm: Date | null): number | null; // |diferença| em ms; ilegível = null
  ```
  `gastou = false` → o serviço desfaz o +1 da T1. Evento que volta gastando com `tentativas = 3` → `falhou`. `FRASE_RESPOSTA`: as frases de lote da UX
  §8 ("Paradas e esperas", com `{h}`/`{n}`) e as de recusa da linha da resposta (cancelada ou denegada, fora do prazo, já respondida por outro, não é
  desta empresa, chave inválida, código N), literais.

- [ ] **Step 1: testes que falham:** um `it` por linha das duas tabelas de retorno do desenho ("Lote" e "Evento"), com `AGORA`, 2 eventos (VETOR 210210,
  K880 210200, tentativas 1) e contadores em 0. Conferir em cada um: `estado` e `gastou` por evento, `situacao`, `mensagem` (frase literal com `15h05`,
  `15h10` ou `14h20`), `pausaAte` e `falhasSeguidas`. Casos de borda a mais:
  - 128 com só o retorno do VETOR → K880 volta `na_fila` gastando;
  - TEMPO enviado com K880 em `tentativas = 3` → K880 `falhou` com mensagem `null`;
  - falha antes de enviar com `falhasSeguidas` 0/1/2/5 → pausa +15/+30/+60/+60, `gastou` falso;
  - sem resposta com `semRespostaSeguidas = 2` → `parada_configuracao` + `tresIlegiveis`;
  - 577 com `relogioNoLoteAnterior` → `parada_relogio`; sem ele → pausa +60 e `relogio = true`;
  - 656 com `vezes656Em24h = 1` → `parada_656`;
  - lote 1234 (4 dígitos, desconhecido) → `parada_configuracao` com "(código 1234)"; evento 1234 → `recusada` "código 1234";
  - HTTP 500 sem `fault` e com `fault: 'Receiver'` → voltam sem gastar, pausa +60, `foraDoAr`; o mesmo com `semRespostaSeguidas = 2` → `parada_configuracao`;
  - HTTP 500 com `fault` `Sender`, `VersionMismatch`, `MustUnderstand` e `DataEncodingUnknown` → voltam sem gastar e `parada_configuracao` (`outroCodigo(500)`);
  - `derivaRelogio('2026-11-17T14:08:00-03:00', AGORA) === 180_000`; `derivaRelogio('lixo', AGORA) === null`.
- [ ] **Step 2:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas-sefaz/__tests__/respostas-agenda.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** passa; typecheck limpo.
- [ ] **Step 5:** `git commit -m "feat(notas-sefaz): decisão do lote de eventos (retorno → ação, tentativas limitadas, pausas e paradas)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 5: Planejador e prazos (puro)

**Files:**
- Create: `api/src/modules/notas-sefaz/respostas-plano.ts`
- Test: `api/src/modules/notas-sefaz/__tests__/respostas-plano.spec.ts`

**Interfaces:**
- Consumes: `SituacaoNota`, `SituacaoSefaz`, `TipoEvento`, `EstadoEvento`.
- Produces:
  ```ts
  export const CIENCIA_MAX_DIAS = 9, PRAZO_FINAL_DIAS = 90, AVISO_DIA = 80;
  export type OrigemEvento = 'ciencia_automatica' | 'dar_entrada' | 'admin';
  export interface NotaParaPlano {
    id: string; situacao: SituacaoNota; situacao_sefaz: SituacaoSefaz; tp_nf: number | null; autorizada_em: Date | null; emitida_em: Date | null;
    tem_xml_completo: boolean; lancada_pela_chave_em: Date | null; // created_at da nota lançada com a mesma chave
  }
  export interface EventoExistente { nota_sefaz_id: string; tp_evento: TipoEvento; situacao: EstadoEvento; origem: OrigemEvento; pedida_em: Date }
  export interface Prazo { prazo_final: Date | null; prazo_perto: boolean; prazo_passou: boolean } // perto = agora ≥ base + 80 d e < prazo_final
  export function prazoDaNota(n: Pick<NotaParaPlano, 'autorizada_em' | 'emitida_em'>, agora: Date): Prazo; // base = autorizada_em ?? emitida_em
  export function finalAtiva(ev: EventoExistente[]): EventoExistente | null;   // tp ≠ 210210 em na_fila|enviando|registrada|falhou
  export function respondivel(n: NotaParaPlano, ev: EventoExistente[], agora: Date): boolean;
  export function avisoDePrazo(n: NotaParaPlano, ev: EventoExistente[], agora: Date): boolean; // ciência registrada + sem final registrada + prazo_perto
  export interface Plano { criar: { nota_sefaz_id: string; tp_evento: '210200' | '210210'; origem: 'dar_entrada' | 'ciencia_automatica' }[]; cancelarCiencias: string[] }
  export function planejar(notas: NotaParaPlano[], eventos: EventoExistente[], ligadaEm: Date, agora: Date): Plano;
  export function ordemDeEnvio<T extends { tp_evento: TipoEvento; base: Date | null; pedida_em: Date }>(fila: T[]): T[]; // finais; depois ciências pela base mais antiga
  ```
  Regras: as do desenho ("Planejador"), literalmente. `eventos` de uma nota = os da mesma `nota_sefaz_id`.

- [ ] **Step 1: testes que falham:**
  - ciência: `A9` sim, `A9 − 1 s` não; `tp_nf` 0, `cancelada`, `denegada`, `ignorada`, `ja_lancada` e `tem_xml_completo` → não; ciência já `registrada`,
    `recusada` ou `falhou` → não; só `cancelada` antes → sim;
  - 210200: `ja_lancada` com `lancada_pela_chave_em ≥ ligadaEm` → `dar_entrada`; antes de `ligadaEm` → nada; `parece_lancada` → nada;
  - **Review Focus 3:** `ja_lancada` com 210220 `registrada` (admin) → nada; com 210200 `falhou` → nada (não duplica);
  - final do admin `na_fila` + ciência `na_fila` → `cancelarCiencias` com a nota;
  - **Review Focus 5:** `prazoDaNota`: `prazo_final = base + 90 d`; `A80` → perto, `A80 + 1 s` → não; `A90` → `prazo_passou`, `A90 + 1 s` → não; base nula
    → tudo nulo/falso; nada é criado para nota com `prazo_passou`;
  - `avisoDePrazo`: ciência `registrada` + `A80` → sim; com 210200 `registrada` → não; ciência só `na_fila` → não;
  - `ordemDeEnvio`: 210220 antes de ciências; ciências pela base crescente.
- [ ] **Step 2:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas-sefaz/__tests__/respostas-plano.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** passa; typecheck limpo.
- [ ] **Step 5:** `git commit -m "feat(notas-sefaz): planejador das respostas (ciência em 9 dias, confirmação de nota lançada, prazo de 90 dias)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 6: Fila, envio e agendador

**Files:**
- Create: `api/src/modules/notas-sefaz/respostas.service.ts`
- Modify: `api/src/modules/notas-sefaz/agendador.ts` (no tique, depois de `classificarPendentes`, `respostas.processar()` no seu próprio `try/catch`);
  `api/src/modules/notas-sefaz/notas-sefaz.module.ts`; `api/src/modules/notas-sefaz/__tests__/prisma-sefaz.falso.ts` (3 tabelas, os dois índices
  parciais como conferência no falso, `notas_entrada` mínimo)
- Test: `api/src/modules/notas-sefaz/__tests__/respostas.service.spec.ts`, `api/src/modules/notas-sefaz/__tests__/agendador.spec.ts`

**Interfaces:**
- Consumes: Tasks 3–5; `CERTIFICADO_DIGITAL`; `CicloSefazService.ambiente()`/`cnpjDaEmpresa()`; `NotasService.notasLancadas`; `situacaoDaNota`/`lancamentosDaNota`.
- Produces:
  ```ts
  export const CHAVE_TRAVA_SEFAZ_EVENTOS = 7_011_171_202;
  export type FimRespostas = 'feito' | 'indisponivel' | 'nao_ligadas' | 'parada' | 'pausa' | 'sem_cnpj' | 'certificado' | 'relogio' | 'ocupada' | 'vazia';
  export class RespostasSefazService {
    disponivel(): boolean; // SEFAZ_MANIFESTACAO = 'ligada' e ambiente ≠ 'desligado'
    processar(relogio?: () => Date): Promise<{ fim: FimRespostas; enviados: number }>;
    esperarTravaEventos(tx: Prisma.TransactionClient): Promise<unknown>; // pg_advisory_xact_lock(7_011_171_202), para as rotas da Task 7
  }
  ```
  Passos do desenho ("Fila e envio"): condições sem rede, nesta ordem: disponível → CNPJ → linha ligada e `ok` → `pausa_ate` → relógio → certificado
  (`emUso()` e raiz). **T1** com `pg_try_advisory_xact_lock` (quem não obtém = `ocupada`): fecha o lote aberto como `interrompida` e devolve os eventos
  dele à fila; aplica `planejar`; escolhe até 20 por `ordemDeEnvio`; assina cada um (`eventoAssinado`) e grava `enviando`, `dh_evento`, `xml_evento`,
  `impressao_digital`, `tentativas + 1` e `lote_id`; cria o lote. **Rede** fora de transação. **T2** com `pg_advisory_xact_lock`: aplica `decidirLote`
  (desfaz o +1 de quem não gastou), grava retorno e protocolo, fecha o lote; `parada` grava o histórico `respostas_paradas` com o `c_stat`. Log
  `sefaz.eventos`: lote, ambiente, `cStat`, quantidade por estado e duração; nunca XML, chave nem protocolo.
  Contexto do `decidirLote`, lido na T1 em `sefaz_eventos_lotes` do (ambiente, CNPJ): `semRespostaSeguidas` = lotes mais recentes seguidos com
  `sem_resposta`; `vezes656Em24h` = lotes com `c_stat` 656 nas 24 h; `relogioNoLoteAnterior` = o último lote fechado tem `erro_code = 'RELOGIO'` (a T2
  grava essa marca quando `relogio` é verdadeiro); `falhasSeguidas` = a de `sefaz_manifestacao`.

- [ ] **Step 1: testes que falham** (prisma falso + `SefazEventosFalso` + relógio injetado):
  - variável desligada, respostas não ligadas, `parada_*`, `pausa_ate` futura, sem CNPJ, certificado vencido → zero chamadas à porta;
  - VETOR elegível → 1 lote com 1 evento; **no momento da chamada** (`aoChamar`), o evento está `enviando`, com `xml_evento` contendo `<Signature`,
    `tentativas = 1` e o lote aberto; depois do 135 → `registrada`, `n_prot`, lote `respondida`;
  - 21 notas elegíveis → só 20 no lote; o tique seguinte leva a 21ª;
  - **Review Focus 2:** evento `admin` com `enviar_apos = AGORA + 60 s` não sai em `AGORA + 59 s` e sai em `AGORA + 60 s`;
  - 108 → evento `na_fila` com `tentativas = 0`, `pausa_ate = 15h05`, e nenhum envio em `14h10`;
  - TEMPO enviado → `na_fila`, `tentativas = 1`, `pausa_ate = 14h20`; três vezes seguidas → `falhou` e `parada_configuracao` com `tresIlegiveis`;
  - queda entre T1 e T2 (a porta lança erro não `SefazErro`) → o próximo `processar` fecha o lote como `interrompida` e devolve o evento à fila (tentativa mantida);
  - trava ocupada → `ocupada`, nenhuma chamada;
  - deriva de 3 min na última consulta da busca → `relogio`, nenhuma chamada;
  - ciência `na_fila` + final do admin → a ciência vira `cancelada` e só a final sai;
  - o `logger` nunca recebe `<`, a chave nem o `n_prot`;
  - `agendador.spec`: o tique chama `processar` depois da classificação, e um erro dele não derruba o tique nem a busca.
- [ ] **Step 2:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas-sefaz`. Esperado: FAIL nos novos.
- [ ] **Step 3:** implementar.
- [ ] **Step 4:** o jest do Step 2 passa (todos de `src/modules/notas-sefaz`); typecheck limpo.
- [ ] **Step 5:** `git commit -m "feat(notas-sefaz): fila das respostas à SEFAZ (gravado antes de sair, um lote por tique, trava própria)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 7: Rotas, caixa, permissões e smoke

**Files:**
- Modify: `api/src/modules/notas-sefaz/caixa.service.ts`, `notas-sefaz.controller.ts`, `notas-sefaz.dto.ts`, `situacao-nota.ts` (`MotivoIgnorar` +
  `compra_nao_aconteceu`); `api/src/common/__tests__/permissoes-protecao.spec.ts`; `api/scripts/smoke.sh`; `api/scripts/smoke-capped.sh`
  (`SEFAZ_MANIFESTACAO=ligada`)
- Test: `api/src/modules/notas-sefaz/__tests__/caixa.service.spec.ts`, `notas-sefaz.dto.spec.ts`, `permissoes-protecao.spec.ts`

**Interfaces:**
- Consumes: Tasks 4–6.
- Produces (a web da Task 8 copia estes tipos):
  ```ts
  export type EstadoResposta = { estado: EstadoEvento; em: string; protocolo: string | null; c_stat: number | null; mensagem: string | null };
  export type RespostaNota = {
    ciencia: EstadoResposta | null;
    final: (EstadoResposta & { tipo: 'confirmacao' | 'nao_reconheco' | 'nao_aconteceu'; origem: OrigemEvento }) | null;
    prazo_final: string | null; prazo_perto: boolean /* = avisoDePrazo */; prazo_passou: boolean; pode_responder: boolean;
  };
  // NotaSefazLinha ganha  resposta: RespostaNota | null   (null com a variável desligada)
  // SituacaoBuscaResposta (ligada) ganha
  respostas: { disponivel: boolean; ligadas: boolean; situacao: SituacaoRespostas; mensagem: string | null; pausa_ate: string | null;
    ligadas_por_nome: string | null; ligadas_em: string | null; na_fila: number; falharam: number;
    prazos_perto: { id: string; numero: string; serie: string; emitente_nome: string; prazo_final: string }[] /* a que vence primeiro antes */ };
  // DTOs
  export class ConfigurarRespostasDto { @IsBoolean() ligadas!: boolean }
  // IgnorarNotaSefazDto ganha  @IsOptional() @IsBoolean() avisar_sefaz?: boolean
  ```
  `final` e `ciencia` = o evento mais recente de cada grupo que não esteja `cancelada`.
- **Rotas novas:** `PUT /v1/notas-sefaz/respostas` e `POST /v1/notas-sefaz/:id/responder-de-novo` (estática antes das `:id`).
- **Regras do `ignorar` com `avisar_sefaz: true`**, nesta ordem (frases literais):
  1. variável desligada → 503 `SEFAZ_RESPOSTAS_DESLIGADAS` "As respostas à SEFAZ não estão ativadas neste servidor.";
  2. respostas não ligadas → 409 `SEFAZ_RESPOSTAS_NAO_LIGADAS` "As respostas à SEFAZ estão desligadas. Ligue em Configurações → Notas da SEFAZ.";
  3. motivo `outro` ou `cancelamento_conferido` → 400 `VALIDATION_ERROR` "Este motivo não avisa a SEFAZ.";
  4. nota de saída, cancelada ou denegada → 409 `SEFAZ_NAO_RESPONDIVEL` "Esta nota não aceita resposta à SEFAZ.";
  5. prazo passou → 409 `SEFAZ_PRAZO_PASSOU` "Passou o prazo de 90 dias para responder à SEFAZ sobre esta nota.";
  6. final ativa (ou o índice `sefaz_manifestacoes_uma_final` recusar) → 409 `SEFAZ_JA_RESPONDIDA` "Esta nota já tem resposta final na SEFAZ.";
  7. 210240: `normalizarJustificativa(texto)` → 400 "Conte o que houve com pelo menos 15 letras." · "Use no máximo 255 letras." · "Use só letras, números
     e pontuação comum (sem emoji).";
  - `compra_nao_aconteceu` sem `avisar_sefaz: true` → 400 "Este motivo sempre avisa a SEFAZ.";
  - mapa motivo → evento do desenho; nota ignorada + evento `admin` (`na_fila`, `enviar_apos = agora + 60 s`, autoria) na **mesma** transação, sob
    `esperarTravaEventos`; ciência `na_fila` da nota vira `cancelada`.
- **`reabrir`:** sob a trava, o evento `admin` `na_fila` da nota vira `cancelada`; `enviando`/`registrada` ficam.
- **`responder-de-novo`:** o evento `falhou` mais recente da nota → `na_fila`, `tentativas = 0`, `enviar_apos = agora`; nenhum → 409
  `SEFAZ_NADA_A_REENVIAR` "Não há resposta para enviar de novo nesta nota."
- **`PUT …/respostas`:** ligar = 503 da variável → `conferirParaLigar` (as frases da busca) → upsert `ligada = true`, `situacao = 'ok'`, `mensagem = null`,
  `falhas_seguidas = 0`, `ligada_em = agora`, autoria + histórico `respostas_ligadas`; desligar = `ligada = false` + histórico `respostas_desligadas`;
  os dois nunca mexem em `pausa_ate` nem na fila.

- [ ] **Step 1: testes que falham:**
  - `caixa.service.spec`: cada regra 1–7 com a frase; cada motivo cria o `tp_evento` certo (`nao_e_compra` só com `avisar_sefaz`); a nota e o evento
    gravam juntos (falha no INSERT do evento = nota não ignorada); **Review Focus 3**: 2º ignorar com aviso = 409 `SEFAZ_JA_RESPONDIDA`; **Review Focus 2**:
    reabrir cancela o `na_fila` e não toca o `enviando`; `responder-de-novo` zera tentativas; ligar/desligar não mudam `pausa_ate` nem eventos; ligar
    zera `falhas_seguidas`; `situacao().respostas` e `listar()[i].resposta` com os campos do tipo (prazos em ISO); variável desligada = `resposta: null`
    e `respostas.disponivel = false`; **Review Focus 4**: justificativa com aspas curvas é gravada normalizada.
  - `notas-sefaz.dto.spec`: `avisar_sefaz` não booleano → 400; `compra_nao_aconteceu` aceito; `ConfigurarRespostasDto` sem `ligadas` → 400.
  - `permissoes-protecao.spec`: as 9 rotas de `/notas-sefaz` só admin (as 7 de hoje + as 2 novas); a lista da loja igual.
- [ ] **Step 2:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/notas-sefaz src/common/__tests__/permissoes-protecao.spec.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar; o `smoke.sh` ganha o bloco "respostas à SEFAZ" (sem rede):
  - `trava_sefaz` conta também `sefaz_manifestacao` ligadas (0) antes e depois;
  - semeia por SQL `sefaz_manifestacao` (`ligada = false`) e dois eventos de uma nota semeada (210210 `registrada`; 210200 `na_fila`);
  - `GET …/situacao` tem `respostas.disponivel = true`, `ligadas = false`; a lista traz `resposta.ciencia.estado = 'registrada'`;
  - ignorar com `avisar_sefaz` → 409 `SEFAZ_RESPOSTAS_NAO_LIGADAS`; `PUT …/respostas {ligadas:true}` depois do DELETE do certificado → 503
    `CERTIFICADO_NAO_CADASTRADO`; loja → 403 nas 2 rotas novas;
  - CHECKs e índices: INSERT de `tp_evento` '110111', de 210200 com `x_just`, de `n_prot` com 16 dígitos e de uma 2ª final ativa → erro;
  - **Review Focus 1:** no fim, `select count(*) from sefaz_eventos_lotes` = 0 e `sefaz_manifestacoes` = 2 linhas, nenhuma `enviando`.
- [ ] **Step 4:** o jest do Step 2 passa; typecheck limpo; `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh` passa (anotar o total).
- [ ] **Step 5:** `git commit -m "feat(notas-sefaz): rotas das respostas (ligar, ignorar avisando a SEFAZ, desfazer, tentar de novo) e smoke sem rede" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 8: Web — regras puras, cliente da API e o quadro "Respostas à SEFAZ"

**Files:**
- Create: `web/src/components/notas-sefaz-respostas.tsx` (o quadro, dentro do `Panel` de `notas-sefaz-painel.tsx`)
- Modify: `web/src/lib/erp-api.ts` (tipos da Task 7; `configurarRespostasSefaz(ligadas)`, `responderDeNovoSefaz(id)`, `ignorarNotaSefaz(id, motivo,
  texto?, avisarSefaz?)`); `web/src/lib/notas-sefaz.ts`; `web/src/components/notas-sefaz-painel.tsx` (abertura nova da UX §8)
- Test: `web/src/lib/__tests__/notas-sefaz.test.ts`

**Interfaces:**
- Produces (`web/src/lib/notas-sefaz.ts`):
  ```ts
  export function resumoRespostas(s: SituacaoSefazLigada, agora: Date): {
    tag: { tom: TomSefaz; texto: 'Ligadas' | 'Desligadas' | 'Paradas' | 'Esperando a SEFAZ' } | null; // null = servidor sem a variável
    caixa: { tom: 'neutro' | 'warn' | 'bad'; texto: string } | null; botao: 'ligar' | 'desligar' | 'ligar_de_novo' | null; linhas: string[];
  };
  export function toastRespostasLigadas(): string;             // "Respostas ligadas. As primeiras saem em até 5 minutos."
  export function linhaPrazo(r: RespostaNota, agora: Date): { tom: 'neutro' | 'warn' | 'muted'; texto: string } | null;
  export function linhaResposta(r: RespostaNota): { icone: 'Loader2' | 'CheckCircle2' | 'Ban' | 'CircleAlert'; texto: string; tentarDeNovo: boolean } | null;
  export function faixaPrazo(p: SituacaoSefazLigada['respostas']['prazos_perto']): string | null;
  export function avisoDoMotivo(m: MotivoIgnorar, podeResponder: boolean): { linha: string | null; avisa: 'sempre' | 'opcional' | 'nunca'; botao: string };
  export function textoPorQue(ligadas: boolean): string;
  export function normalizarJustificativa(t: string): Justificativa; // CÓPIA da API (Task 3): mudar uma = mudar a outra
  // TEXTO_MOTIVO + compra_nao_aconteceu: "A compra não aconteceu (devolvi ou cancelei)"; AcaoNota + 'nao_reconheco' ("Não reconheço…"),
  // oferecida por acoesDaNota em falta_lancar e parece_lancada quando n.resposta?.pode_responder
  ```
  Todos os textos = UX §8, literais.

- [ ] **Step 1: testes que falham** (`notas-sefaz.test.ts`, com `AGORA`):
  - `resumoRespostas`: sem a variável → tag `null` e a frase "não estão ativadas neste servidor"; desligadas → "Desligadas" + linha fixa; ligadas com
    `na_fila` 3 → "3 respostas na fila"; `pausa_ate` futura → "Esperando a SEFAZ" + caixa âmbar com `mensagem`; `parada_656` → "Paradas", caixa vermelha,
    botão `ligar_de_novo`;
  - **Review Focus 5:** `linhaPrazo` com `prazo_final = 2027-02-16T02:30:00Z` → "…até 15/02/2027"; com `prazo_perto` e faltando 6 dias → "Faltam 6 dias
    para responder à SEFAZ (até …)"; no dia → "Último dia para responder à SEFAZ."; `prazo_passou` com ciência registrada e sem final → muted "Passou o
    prazo: …"; **nota sem ciência** com `pode_responder` → neutra "Responder à SEFAZ até …" (nunca âmbar); sem `pode_responder` e sem prazo passado → `null`;
  - `linhaResposta`: uma asserção por linha da tabela da UX §8 (inclui `tentarDeNovo` só em `falhou`);
  - `faixaPrazo`: 0 → `null`; 1 → a frase com "A NF 4411 de ATACADÃO S.A."; 3 → "3 notas precisam… A primeira vence em …";
  - `avisoDoMotivo`: os 5 motivos com e sem `podeResponder` (botão "Avisar a SEFAZ e ignorar" em `nao_reconheco` e `compra_nao_aconteceu`);
  - **Review Focus 4:** `normalizarJustificativa` com os vetores do topo (iguais aos da API);
  - `acoesDaNota`: `nao_reconheco` só com `pode_responder`.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/notas-sefaz.test.ts`. Esperado: FAIL.
- [ ] **Step 3:** implementar as regras, o cliente e o quadro (botão com verbo, diálogo de ligar com foco em "Agora não", Desfazer do desligar,
  Skeleton/erro como o resto do painel).
- [ ] **Step 4:** o vitest do Step 2 passa; `../scripts/run-capped.sh 1500 yarn typecheck` limpo.
- [ ] **Step 5:** `git commit -m "feat(web): regras e quadro das respostas à SEFAZ no painel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 9: Web — aba (faixa do prazo, cartão, "Não reconheço…", diálogo Ignorar) e browser-check

**Files:**
- Modify: `web/src/components/notas-sefaz-aba.tsx`, `notas-sefaz-ignorar.tsx`, `notas-sefaz-faixa.tsx` (2ª faixa, do prazo); `web/src/app/(app)/notas/page.tsx`
  (2ª linha do toast do "Dar entrada" com origem `sefaz` e respostas ligadas); `web/scripts/browser-check.mjs`
- Test: `web/scripts/browser-check.mjs` (capturas em `.cache/telas`)

**Interfaces:**
- Consumes: Task 8.
- Diálogo Ignorar: `Conteudo` recebe `respostasLigadas: boolean` e `motivoInicial?: MotivoIgnorar`; os motivos e as linhas vêm de `avisoDoMotivo`;
  `Checkbox` só em `nao_e_compra`; `Textarea` só em `compra_nao_aconteceu`, conferida por `normalizarJustificativa` antes de enviar (mesmas 3 frases, em
  caixa no diálogo); envia `avisar_sefaz` = `true` para `sempre`, o valor da caixa para `opcional`, ausente para `nunca`.

- [ ] **Step 1:** implementar a aba e o diálogo, seguindo a UX §8 (ordem dos botões no celular, `aria-live` na linha da resposta, Desfazer de 8 s,
  "É a mesma nota" com aviso, "Tentar de novo", "Por quê?" por `textoPorQue`).
- [ ] **Step 2:** `browser-check.mjs` ganha, por `page.route` (API com as duas variáveis vazias): painel com respostas desligadas, ligadas, esperando e
  paradas; diálogo de ligar (foco em "Agora não"); aba com a faixa do prazo, um cartão de cada linha de prazo e de resposta, "Não reconheço…" abrindo o
  diálogo já marcado, "A compra não aconteceu" com os 3 erros, Desfazer e "Tentar de novo"; com `respostas.disponivel = false`, nenhum desses elementos;
  360 px sem rolagem lateral e alvos ≥ 44 px; e o `psql` de hoje confere `sefaz_manifestacao` vazia no banco do navegador.
- [ ] **Step 3:** `../scripts/run-capped.sh 1500 yarn typecheck` e `… yarn lint` limpos; `../scripts/run-capped.sh 3300 bash scripts/browser-check.sh` —
  uma tentativa; 137/75 = "não rodou (memória)", registrar e seguir.
- [ ] **Step 4:** `git commit -m "feat(web): aba com prazo de 90 dias, Não reconheço e Ignorar que avisa a SEFAZ" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

### Task 10: Contrato, regras e verificação completa

**Files:**
- Modify: `docs/api-contract.md` (§16: as 2 rotas novas, `avisar_sefaz`, `compra_nao_aconteceu`, os tipos da Task 7, os códigos e as frases);
  `CLAUDE.md` (Regras rápidas, uma linha); `docs/deploy.md` (`SEFAZ_MANIFESTACAO`, roteiro e volta); `README.md` (respostas prontas e DESLIGADAS, só
  ligam depois de o contador concordar e com o "eu autorizo" do dono; roteiro curto)

- [ ] **Step 1:** escrever contrato, `deploy.md` e README.
- [ ] **Step 2:** acrescentar no `CLAUDE.md`: "Respostas à SEFAZ (`modules/sefaz/assinatura-xml.ts` = `assinarXmlEnveloped`, interface fixa também da
  NFC-e; `eventos-xml.ts` + porta `SEFAZ_EVENTOS`; `notas-sefaz/respostas-*`): `SEFAZ_MANIFESTACAO` ausente = `desligada`, e ainda precisa do botão
  "Ligar as respostas"; `ligada` só depois do OK do contador e do "eu autorizo" do dono. "Dar entrada" nunca fala com a SEFAZ (a confirmação sai do
  tique). Evento gravado `enviando` com o XML antes de sair; 3 tentativas; um lote por tique. `xml-crypto` 6.4.0 só em devDependencies e `__tests__`."
- [ ] **Step 3: verificação completa**, um comando por vez, capado, anotando os números:
  1. `cd api && ../scripts/run-capped.sh 1500 npx jest --runInBand src/common src/scripts`
  2. `… npx jest --runInBand src/modules/sefaz src/modules/notas-sefaz`
  3. `… npx jest --runInBand src/modules/notas src/modules/certificado-digital src/modules/leitura-pdf src/modules/cadastros`
  4. `… npx jest --runInBand src/modules --testPathIgnorePatterns 'modules/(sefaz|notas-sefaz|notas|certificado-digital|leitura-pdf|cadastros)/'`
  5. `… npm run typecheck`
  6. `… npm run lint`
  7. `npm audit --omit=dev` (rede, registro do npm): anotar os alertas; sem correção automática
  8. `../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh`
  9. `cd ../web && ../scripts/run-capped.sh 1500 yarn test`
  10. `… yarn typecheck`
  11. `… yarn lint`
  12. `../scripts/run-capped.sh 3300 bash scripts/browser-check.sh`: uma tentativa; 137 ou 75 = "não rodou (memória)", e a tarefa segue.
- [ ] **Step 4:** `git commit -m "docs(notas-sefaz): contrato, regras e verificação da entrega 3" -m "<números da verificação>" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`

## Auto-revisão

**Cobertura do desenho (Etapa 2):**

| Parte | Onde |
|---|---|
| Decisões do dono 1–5 (ciência automática, confirmação no lançamento, "Não reconheço", aviso, desligado + contador) | Tasks 5 e 6 (1, 2), 7 e 9 (3), 5, 8 e 9 (4), 1, 7, 8 e 10 (5) |
| Decisões do construtor 1–9 (um controle, sem fila no "Dar entrada", Ignorar ↔ eventos, 210240, Desfazer, fila própria, código desconhecido, sem XSD, prazo) | 1/7, 5/6, 7/9, 3/7, 6/7, 6, 4, 3, 5 |
| Tabela de retornos (lote e evento, 3–4 dígitos, `nProt` 15/17) | Task 4 (pura), Task 3 (leitura), Task 6 (pelo serviço) |
| Montagem e padrões do esquema; assinatura (interface fixa, oráculo, só a folha, C14N) | Tasks 3 e 2 |
| Endereços, action, SOAP 1.2 sem cabeçalho, ISRG X1 | Tasks 3 e 2 |
| Dados (3 tabelas, CHECKs, índices parciais, trocas de CHECK) | Task 1, conferidos no banco pelo smoke da Task 7 |
| Rotas, códigos, frases, permissões | Task 7 |
| Telas e textos (UX §8) | Tasks 8 e 9 |

**Tipos conferidos entre tarefas:** `TipoEvento`, `EstadoEvento`, `SituacaoRespostas`, `OrigemEvento` e `MotivoIgnorar` com os mesmos literais na API e
no web; `RespostaNota`/`EstadoResposta` (Task 7) = os do `erp-api.ts` (Task 8); `normalizarJustificativa` com os mesmos vetores nas duas pontas;
`CHAVE_TRAVA_SEFAZ_EVENTOS` ≠ `CHAVE_TRAVA_SEFAZ`; `enviarLote` igual na porta, no adaptador e no falso.

**Fora, de propósito:** retificação (2º `nSeqEvento`), `xJust` no 210220, eventos de terceiros lidos da distribuição, lote de mais de 20, NFC-e.

## Roteiro do primeiro teste real — só com o OK do contador e o "eu autorizo" do dono

Nenhum agente executa este roteiro; não é tarefa. Cada passo que fala com a SEFAZ precisa de um "eu autorizo" do dono, dado na hora e por escrito, e
o dono acompanha. Pressupõe a busca da entrega 2 já testada (o roteiro dela) e o OK do contador por escrito às perguntas abaixo.

1. **Antes, sem falar com a SEFAZ.**
   - A entrega 3 no ar com `SEFAZ_MANIFESTACAO` vazia; `select count(*) from sefaz_eventos_lotes` = 0; `pg_dump` do banco.
   - **No contêiner, sem rede** (o Node 22 da imagem, não o 20 local): `docker exec erp-freela-api node -e "<confere que tls.rootCertificates tem a ISRG
     Root X1 pela impressão digital 96:BC:EC:06:…:08:C6, gera uma chave RSA na hora e assina/verifica 'x' com RSA-SHA1>"` → as duas conferências `true`.
     Falhou a assinatura = OpenSSL da imagem recusa SHA-1: parar.
2. **Homologação (1º "eu autorizo").**
   - A caixa de homologação quase nunca tem nota (ninguém emite NF-e de teste para o CNPJ). O dono escolhe **uma** chave de nota real recente da empresa
     **ainda não lançada no Comanda** (conferir antes: `select count(*) from notas_entrada where chave = '<chave>'` = 0). Por quê: `notasLancadas` cruza
     só pela chave, sem o ambiente; uma chave já lançada vira `ja_lancada` na linha de homologação, o planejador não cria a ciência (nem a 210200) e o
     lote de 1 não sai. Pelo mesmo motivo, não lançar essa nota no Comanda enquanto o servidor estiver em homologação (nasceria uma 210200 de homologação);
     ela é semeada por SQL em `notas_sefaz` com `ambiente = 'homologacao'`, `cnpj_destinatario` = o da empresa, `situacao_sefaz = 'autorizada'`, `tp_nf = 1`,
     `autorizada_em = now() - interval '1 day'` (o planejador só manda ciência até 9 dias), emitente, número e série tirados da chave (o evento de
     homologação não vale nada na produção; nota de homologação nunca chega ao "Dar entrada").
   - `SEFAZ_MANIFESTACAO=ligada` (com `SEFAZ_DFE_AMBIENTE=homologacao`), recriar só a API (`docker compose -f docker-compose.prod.yml up -d --no-deps api`),
     "Ligar as respostas". O próximo tique manda um lote de **1** (a única elegível).
   - **Esperado:** lote 128 e evento 135 ou 136 (chave sem NF-e no AN de teste). Registrar a linha de `sefaz_eventos_lotes`, a de `sefaz_manifestacoes`
     (`c_stat`, `x_motivo`, formato do `n_prot`) e o log `sefaz.eventos`.
   - **Este passo fecha os pontos "não confirmado":** `SEFAZ_TLS` sem envio = raiz do `hom1` fora do `ca`; HTTP 500 com `Fault` = action ou corpo
     (`nfeDadosMsg` direto) recusados, conferir antes de mexer; 250 = `cOrgao` 91 recusado; 297/298 = assinatura; 225/404 = esquema; 577–579 = relógio.
   - Ainda em homologação, na mesma nota: "Não reconheço…" (esperado 135/136) e, numa 2ª chave semeada, "A compra não aconteceu" com justificativa e
     "Já lancei de outro jeito" (210200).
3. **Produção (2º "eu autorizo", depois do OK do contador).**
   - Desligar as respostas, `SEFAZ_DFE_AMBIENTE=producao` e `SEFAZ_MANIFESTACAO=ligada`, recriar só a API.
   - **Lote de 1:** antes de ligar, ignorar com "Outro motivo: teste" as notas elegíveis (até 9 dias, em "Falta lançar" ou "Parece já
     lançada") menos a escolhida; ligar; esperar o 135
     dela; só então "Voltar para a lista" das outras (elas saem no tique seguinte).
   - Registrar o emissor do certificado TLS de `www.nfe.fazenda.gov.br` no dia (Let's Encrypt, troca a cada ~90 dias).
   - Esperar o XML completo: anotar quanto tempo levou entre o 135 e o "Conferir" acender (nenhuma NT fixa; fecha o ponto aberto).
   - Dar entrada nessa nota pelo "Conferir": em até 5 min, um 210200 `dar_entrada` registrado.
   - **Vigiar por 24 h:** `select tp_evento, situacao, c_stat, count(*) from sefaz_manifestacoes group by 1,2,3` sem `falhou` nem `recusada` inesperada,
     e `select resultado, c_stat, count(*) from sefaz_eventos_lotes group by 1,2` sem 656.
4. **Volta, nesta ordem.** PRIMEIRO "Desligar as respostas" na tela; depois `SEFAZ_MANIFESTACAO` vazia no `.env` e recriar só a API; conferir que o painel
   diz "As respostas à SEFAZ não estão ativadas neste servidor."; nunca apagar `sefaz_manifestacoes` nem `sefaz_eventos_lotes`. Avisar o dono: toda nota
   com ciência registrada ainda precisa de resposta final em 90 dias (pelo portal ou religando as respostas). O aviso do prazo continua na tela com a
   variável vazia (a leitura só olha o banco), desde que `SEFAZ_DFE_AMBIENTE` siga não vazio.

## Pontos em aberto (só o dono ou o contador respondem)

1. **Contador:** pela cl. 15ª-C § 5º, a ciência obriga uma resposta final para o restaurante (a NT 2020.001 parece restringir aos obrigados)? Qual a
   multa de SP por não responder? Concorda com ciência automática + confirmação no lançamento?
2. **Contador:** ele já responde (manifesta) as notas deste CNPJ pelo sistema dele? Se sim, nosso 210200 sobre um 210220 dele vira retificação (vale o
   último): combinar quem responde.
3. **Dono:** "É a mesma nota" e "Já lancei de outro jeito" confirmam a compra sozinhos (decisão do construtor 3). Se preferir só com a caixa marcada, a
   troca é de texto e de um booleano.
4. **Dono:** notas lançadas **antes** da 1ª vez que as respostas forem ligadas não são confirmadas sozinhas (decisão do construtor 2; `ligada_em` só
   na 1ª vez, decisão do controlador na onda final). Basta?
5. **Dono:** qual chave usar no teste de homologação (passo 2 do roteiro).
