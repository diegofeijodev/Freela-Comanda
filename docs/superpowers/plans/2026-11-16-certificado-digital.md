# Certificado digital A1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Qualquer admin envia, confere, guarda cifrado, substitui e remove o certificado A1 da empresa em Configurações, vê os avisos de vencimento (painel e faixa no topo) e os projetos 3 e 4 recebem chave e certificado prontos por uma porta interna.

**Architecture:** Módulo novo `api/src/modules/certificado-digital`. Um adaptador (`pkcs12.adapter.ts`, o único que usa node-forge) desembrulha o .pfx. As conferências são funções puras com `agora` injetado: CNPJ, validade, tipo e cadeia ICP-Brasil. A confiança fica com `node:crypto`. Chave, certificado e cadeia são guardados num envelope AES-256-GCM (cifra movida para `common/cripto`, rótulo próprio, segredo `CERTIFICADO_SECRET`) numa tabela de uma linha, com histórico append-only gravado na mesma transação. No web, a consulta `["certificado"]` alimenta o painel de Configurações e a faixa do layout. As regras de tela ficam num módulo puro testado com vitest.

**Tech Stack:** NestJS 11 + Fastify + Prisma 5 (api, npm) · node-forge 1.4.3 (só cadastro) · Next 15 + TanStack Query + Radix AlertDialog (web, yarn) · jest, vitest, smoke em bash, browser-check (Playwright).

**Spec:** `docs/superpowers/specs/2026-11-16-certificado-digital-design.md` (autoridade técnica) + `docs/superpowers/specs/2026-11-16-certificado-digital-ux.md` (telas e textos). Onde divergem, valem as "Decisões do plano" abaixo.

## Global Constraints

- Ramo `feat/certificado-digital`, sem trocar de ramo; um commit por tarefa; sem push e sem deploy.
- Comando pesado só por `scripts/run-capped.sh`, um por vez: jest/tsc/eslint 1500; smoke 1300; browser-check 2600. jest sempre `npx jest --runInBand <arquivos>`. Nunca `nest build`/`next build`. 137 = estourou o teto; 75 = sem memória agora.
- Nenhum teste faz rede, chama `openssl` ou usa certificado real. Rede só em três passos: `npm install` (T2), `atualizar-cadeia-icp.sh` (T3) e `npm audit` (T8).
- **Nunca** em log, resposta, mensagem de erro, Swagger, `configuracoes` ou repositório: o .pfx, a senha, a chave, o PEM da chave ou qualquer trecho do base64 enviado. O log do módulo leva só o `code` e a impressão digital. O Prisma só recebe o envelope cifrado. Nenhum `catch` repassa `e.message` de biblioteca: erro inesperado no PUT vira `CERTIFICADO_FORMATO`.
- Toda rota nova com `@AdminOnly()` e listada em `api/src/common/__tests__/permissoes-protecao.spec.ts`; a lista da loja não muda.
- Erros `{ error: { code, message } }`. No web, ler com `errMsg()`/`errCode()` de `@/lib/db`. HTTP só em `web/src/lib/erp-api.ts`. Nada vai para o storage do navegador.
- `node-forge` **exatamente** `1.4.3` (`--save-exact`), importado só em `pkcs12.adapter.ts`. Usar só `asn1.fromDer/toDer/derToOid`, `pkcs12.pkcs12FromAsn1` + `getBags`, `pki.certificateToAsn1/privateKeyToAsn1/wrapRsaPrivateKey`. Proibido: `verify`, `verifyCertificateChain`, `certificateFromAsn1`, `pem.decode` de entrada, TLS e http do forge.
- Âncoras ICP-Brasil só vêm de `icp-brasil.gerado.ts`. Nenhuma variável de ambiente ou flag acrescenta âncora em runtime; a `raiz-teste.pem` só entra no jest.
- Datas e horas sempre em `America/Sao_Paulo`. `dias_restantes` = dias civis de SP entre hoje e o dia de `valido_ate`; "vencido" é decidido pelo instante (`agora >= valido_ate`).
- Rótulos do HKDF: `erp-freela/ia-chave/v1` (IA, não muda) e `erp-freela/certificado-a1/v1`. Fixtures: senha `senha-de-teste`; relógio dos casos válidos `new Date('2027-06-01T12:00:00Z')`.
- Frases do servidor (cadastro): os `code` são os do desenho, com as trocas da UX §6 já aplicadas. Valem literalmente:

| code (status) | message |
|---|---|
| `CERTIFICADO_ARQUIVO` (400) | Este arquivo não parece um certificado digital. Escolha o arquivo .pfx ou .p12 que o contador enviou. |
| `CERTIFICADO_SENHA` (400) | Senha do certificado incorreta. Digite de novo. |
| `CERTIFICADO_FORMATO` (400) | Não consegui abrir este certificado. Peça ao contador para gerar o arquivo de novo. |
| `CERTIFICADO_SEM_CHAVE` (400) | Este arquivo não serve: falta a parte secreta do certificado. Peça ao contador o certificado A1 (arquivo), não o de cartão ou token. |
| `CERTIFICADO_VENCIDO` (400) | Este certificado venceu em {DD/MM/AAAA}. Envie o certificado renovado. |
| `CERTIFICADO_AINDA_NAO_VALE` (400) | Este certificado só vale a partir de {DD/MM/AAAA}. |
| `CERTIFICADO_SEM_CNPJ` (400) | Este certificado não é de empresa: não encontrei um CNPJ nele. Peça o certificado da empresa, não o seu pessoal. |
| `EMPRESA_SEM_CNPJ` (400) | Preencha o CNPJ da empresa no quadro Empresa, toque em Salvar (no alto da página) e envie o certificado de novo. |
| `CERTIFICADO_OUTRO_CNPJ` (400) | Este certificado é do CNPJ {99.888.777/0001-00} ({OUTRA EMPRESA SA}). O CNPJ da empresa é {12.345.678/0001-95}. |
| `CERTIFICADO_NAO_ICP` (400) | Este certificado não foi emitido por uma certificadora brasileira credenciada; a SEFAZ não aceita. Peça outro ao contador. |
| `CERTIFICADO_CADEIA` (400) | Este certificado parece alterado ou incompleto. Peça ao contador ou à certificadora um arquivo novo. |
| `CERTIFICADO_SEM_SEGREDO` (503) | O servidor ainda não está pronto para guardar certificados. Fale com o suporte do Freela Comanda. |

- Frases da porta (desenho, literais): "Cadastre o certificado digital em Configurações." · "O certificado salvo não pode ser lido (a chave do servidor mudou). Envie o .pfx de novo em Configurações." · "O certificado digital venceu em DD/MM/AAAA. Envie o renovado em Configurações." · `OUTRO_CNPJ` = a frase do cadastro.
- Textos de tela: os da UX (§1, §2, §3, §5) literalmente. Os avisos âmbar e vermelhos do painel e da faixa são montados pelo **cliente** a partir de `situacao`, `cnpj_confere`, `cadeia_conferida`, `tipo` e `dias_restantes`.

## Decisões do plano (o desenho não fixa; não reabrir na implementação)

- **Autor:** `enviado_por_nome` e `feito_por_nome` são gravados como fotografia do nome do usuário. Motivo: a exclusão de usuário é física e as tabelas não têm FK, igual à `ia_chave`. Por isso `esquema.spec.ts` continua com 18 FKs.
- **Sem segredo:** tem precedência sobre tudo. Sem segredo, com ou sem linha, a `situacao` é `sem_segredo` e o formulário fica desabilitado. Se `CERTIFICADO_SECRET` existir com menos de 32 caracteres, a API não sobe (mesmo padrão do `IA_CHAVES_SECRET`).
- **Histórico:** o GET devolve `historico` com até 5 itens, do mais novo para o mais velho: `{ evento, feito_por_nome, feito_em, valido_ate, cnpj, titular }`.
- **Envio e remoção:** PUT sobre linha existente, legível ou não, grava `substituido`. DELETE sem linha devolve 200 com `ausente` e não grava histórico. O histórico é append-only pelo código, sem gatilho (o `esquema.spec.ts` exige todo gatilho em `GATILHOS` do importador).
- **Arquivo grande:** base64 com mais de 90.000 caracteres dá 400 `VALIDATION_ERROR` com "Este arquivo é grande demais para ser um certificado A1 (máximo 64 KB)." O `flattenErrors` prefixa o campo; o web confere antes de enviar.
- **CNPJ da empresa inválido** (formato ou DV) conta como `empresa_sem_cnpj`. É o caso do seed `00.000.000/0001-00`.
- **Senha no formulário:** só o erro `CERTIFICADO_SENHA` limpa a senha (além do sucesso e do "Cancelar"); escolher outro arquivo **mantém** a senha. A UX §1 C diz as duas coisas; vale "trocar de arquivo sem redigitar".
- **Folha** = o certificado do .pfx cuja chave pública casa com a chave (`checkPrivateKey`); se nenhum casa, `CERTIFICADO_FORMATO`. Ver o Ponto em aberto 1.
- **Cadeia:** um certificado nunca é candidato a emissor de si mesmo, e um autoassinado que não é âncora encerra a busca como `nao_fechou`. Quando a cadeia não fecha, `cadeia_pem` guarda as AC do .pfx, sem a folha e sem os autoassinados. O pacote gerado não repete as âncoras.
- **Formatos:** impressão digital = SHA-256 do DER em hex maiúsculo, sem `:`. Tipos do forge: um `.d.ts` local mínimo, sem `@types/node-forge`, porque a superfície tipada é exatamente a permitida.

## Review Focus

1. **Senha errada repetida e senha com acento.** A cada erro, a senha some, o arquivo fica e nada é gravado. `açaí-de-teste` abre no formato legado e no moderno. Testes: T2 (`senha-acentuada*.pfx`), T4 ("senha errada 2×") e T6 (browser-check com 2 erros).
2. **.pfx sem as intermediárias.** É aceito; fecha com o pacote e, sem ele, sai `cadeia_conferida=false` com aviso, sem recusa. Teste: T3 (`so-certificado-final` com pacote vazio e com a intermediária).
3. **Segredo do servidor trocado depois.** O GET dá `ilegivel` e mantém titular e CNPJ, `emUso` dá 503 e reenviar troca (`substituido`). Testes: T4 ("segredo trocado") e T5.
4. **Vence hoje/amanhã no fuso de Brasília** (instantes perto de 03:00Z). Valem o dia civil de SP e a data de SP nas mensagens; `dataBR` (dia UTC) não serve. Testes: T3 (`vencido.pfx` → "31/12/2020"), T4 (`diasRestantes`), T6 (`dataSp`) e T7 (faixa "vence amanhã").
5. **Substituição que falha.** Com arquivo ou senha errados, ou erro no meio da gravação, o atual fica intacto e não ganha linha no histórico. Testes: T4 (serviço + smoke com `outro-cnpj.pfx`) e T6 (browser-check "O certificado atual não foi alterado.").

---

### Task 1: Cifra compartilhada, tabelas e segredo

**Files:**
- Create: `api/src/common/cripto/cripto.ts`, `api/src/common/cripto/__tests__/cripto.spec.ts`, `api/src/common/config/__tests__/env.validation.spec.ts`, `api/prisma/migrations/20261116120000_certificado_digital/migration.sql`
- Delete: `api/src/modules/leitura-pdf/ia/cripto.ts`
- Modify: `api/src/modules/leitura-pdf/ia/ia-chave.service.ts`, `api/src/modules/leitura-pdf/__tests__/ia-chave.spec.ts` (imports e `ROTULO_IA_CHAVE` como 3º argumento de `cifrar`/`decifrar`), `api/prisma/schema.prisma`, `api/src/scripts/import-lovable/esquema.ts` (`TABELAS_SO_NOSSAS`), `api/src/common/config/env.validation.ts`, `docker-compose.prod.yml`, `api/.env.example`, `docs/deploy/.env.prod.example`, `.gitignore`

**Interfaces:**
- Produces: `cifrar(texto: string, segredo: string, rotulo: string): string` e `decifrar(blob: string, segredo: string, rotulo: string): string | null` em `common/cripto/cripto.ts` (envelope `v1.iv.tag.ct` inalterado). Em `ia-chave.service.ts`: `export const ROTULO_IA_CHAVE = 'erp-freela/ia-chave/v1'` e `export const dicaDa`, que muda de arquivo. Modelos Prisma `certificado_digital` e `certificado_digital_historico`. `Env.CERTIFICADO_SECRET?: string`.

- [ ] **Step 1: vetor fixo antes de mover** — com o código **atual**: `cd api && ../scripts/run-capped.sh 1500 npx ts-node --transpile-only -e "const {cifrar}=require('./src/modules/leitura-pdf/ia/cripto'); console.log(cifrar('sk-proj-vetor-fixo-1234567890abcd','segredo-de-teste-com-mais-de-16'))"`. Cole a saída no teste como `ENVELOPE_IA_ANTIGO`.
- [ ] **Step 2: testes que falham**
  - `cripto.spec.ts`:
    - `decifrar(ENVELOPE_IA_ANTIGO, 'segredo-de-teste-com-mais-de-16', 'erp-freela/ia-chave/v1') === 'sk-proj-vetor-fixo-1234567890abcd'`;
    - ida e volta com `'erp-freela/certificado-a1/v1'`;
    - o mesmo envelope com o outro rótulo dá `null`, e segredo errado também.
  - `env.validation.spec.ts` (`validateEnv` com `DATABASE_URL` e `JWT_SECRET` válidos):
    - sem a variável ou `''` → `CERTIFICADO_SECRET === undefined`;
    - 31 caracteres → lança `/Configuração de ambiente inválida/`;
    - `'a'.repeat(64)` → mantém.
- [ ] **Step 3:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/common/cripto src/common/config` → falha.
- [ ] **Step 4: implementar**
  - Mover a cifra e trocar a constante `ROTULO` pelo parâmetro. O `chaveDe` continua recusando segredo com menos de 16 caracteres.
  - `env.validation.ts`: `CERTIFICADO_SECRET: z.preprocess(vazioComoAusente, z.string().min(32).optional())`.
  - Compose (`api.environment`): `CERTIFICADO_SECRET: ${CERTIFICADO_SECRET:-}`.
  - Nos dois `.env*example`: linha comentada `# CERTIFICADO_SECRET= (openssl rand -hex 32 NO servidor; sem ela o certificado digital fica desligado)`.
  - `.gitignore`: `*.pfx`, `*.p12`, `!api/src/modules/certificado-digital/__tests__/fixtures/*`.
  - Migração no formato da `ia_chave`: `CREATE TABLE "x" (\n … \n);`, uma coluna por linha e sem FK.
  - `certificado_digital`:
    - colunas: `id INTEGER NOT NULL DEFAULT 1`, `material_cifrado TEXT NOT NULL`, `titular TEXT NOT NULL`, `cnpj CHAR(14) NOT NULL`, `tipo TEXT NOT NULL`, `politica_oid TEXT`, `emissor TEXT NOT NULL`, `numero_serie TEXT NOT NULL`, `impressao_digital CHAR(64) NOT NULL`, `valido_de TIMESTAMPTZ(6) NOT NULL`, `valido_ate TIMESTAMPTZ(6) NOT NULL`, `cadeia_conferida BOOLEAN NOT NULL`, `enviado_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP`, `enviado_por UUID`, `enviado_por_nome TEXT NOT NULL`;
    - constraints: PK `id`, `CHECK (id = 1)`, `CHECK (cnpj ~ '^[0-9A-Z]{12}[0-9]{2}$')`, `CHECK (tipo IN ('A1','SE-S','outro'))`, `CHECK (valido_ate > valido_de)`.
  - `certificado_digital_historico`:
    - colunas: `id UUID NOT NULL DEFAULT gen_random_uuid()`, `evento TEXT NOT NULL`, `cnpj CHAR(14) NOT NULL`, `titular TEXT NOT NULL`, `numero_serie TEXT NOT NULL`, `impressao_digital CHAR(64) NOT NULL`, `valido_ate TIMESTAMPTZ(6) NOT NULL`, `feito_por UUID`, `feito_por_nome TEXT NOT NULL`, `feito_em TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP`;
    - constraints: PK, `CHECK (evento IN ('enviado','substituido','removido'))`;
    - índice `("feito_em" DESC)`.
  - Modelos Prisma com `///` explicando o conteúdo; `cnpj String @db.Char(14)`.
  - `TABELAS_SO_NOSSAS` passa a ter as 2 tabelas.
  - Depois: `../scripts/run-capped.sh 1500 npx prisma generate`.
- [ ] **Step 5:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/common/cripto src/common/config src/modules/leitura-pdf/__tests__/ia-chave.spec.ts src/scripts/import-lovable/__tests__/esquema.spec.ts` → passa. `npm run typecheck` (capado) limpo.
- [ ] **Step 6:** `git commit -m "feat(certificado): cifra compartilhada, tabelas do certificado e segredo próprio"`

### Task 2: Abrir o .pfx e ler os campos (forge, fixtures, CNPJ)

**Files:**
- Create: `api/scripts/gerar-certificados-teste.sh`, `api/src/modules/certificado-digital/{node-forge.d.ts,mensagens.ts,cnpj.ts,pkcs12.adapter.ts}`, `api/src/modules/certificado-digital/__tests__/{cnpj.spec.ts,pkcs12.spec.ts}`, `api/src/modules/certificado-digital/__tests__/fixtures/` (17 arquivos)
- Modify: `api/package.json`, `api/package-lock.json`, `api/src/common/time/dates.ts` (`dataBrSp`)

**Interfaces:**
- Produces:
  - `dates.ts`: `dataBrSp(d: Date): string` (`DD/MM/AAAA` em SP, via `todaySp`); as mensagens com data usam esta função.
  - `mensagens.ts`:
    - `type CodigoRecusa` = os 11 `code` 400 da tabela;
    - `class CertificadoRecusado extends Error { constructor(readonly code: CodigoRecusa, message: string) }`;
    - `MSG_CERTIFICADO: Record<'arquivo'|'senha'|'formato'|'semChave'|'semCnpj'|'empresaSemCnpj'|'naoIcp'|'cadeia'|'semSegredo', string>`;
    - `msgVencido(d: Date)`, `msgAindaNaoVale(d: Date)`, `msgOutroCnpj(cnpjCert: string, titular: string, cnpjEmpresa: string)`, todas `: string`.
  - `cnpj.ts`:
    - `normalizarCnpj(s: string): string` (maiúsculas, remove o que não é `[0-9A-Z]`);
    - `cnpjValido(c: string): boolean` (formato, DV módulo 11 com ASCII − 48; só zeros = falso);
    - `cnpjDoCn(cn: string): string | null`, `titularDoCn(cn: string): string`;
    - `escolherCnpj(c: { san: string | null; serialNumber: string | null; cn: string | null }): string | null` (SAN → serialNumber → CN, cada um normalizado e validado);
    - `compararCnpj(doCertificado: string, daEmpresa: string): 'igual' | 'mesma_raiz' | 'diferente' | 'empresa_sem_cnpj'`;
    - `formatarCnpj(c: string): string` (`XX.XXX.XXX/XXXX-XX`).
  - `pkcs12.adapter.ts`:
    - `interface PfxAberto { chave: KeyObject; certificados: X509Certificate[] }`;
    - `abrirPfx(arquivo: Buffer, senha: string): PfxAberto`. Lança `CertificadoRecusado` com: DER/PFX ilegível → `ARQUIVO`; MAC → `SENHA`; sem bag de chave → `SEM_CHAVE`; qualquer outro erro → `FORMATO`;
    - `interface CamposX509 { cnSujeito: string | null; serialNumberSujeito: string | null; cnEmissor: string | null; orgEmissor: string | null; cnpjSan: string | null; politicas: string[] }`;
    - `lerCamposX509(der: Buffer): CamposX509` (ASN.1 de `x509.raw`; o SAN lido é o otherName `2.16.76.1.3.3` em OCTET, Printable ou UTF8).

- [ ] **Step 1: dependência e fixtures**
  - `cd api && ../scripts/run-capped.sh 1500 npm install --save-exact node-forge@1.4.3`, depois conferir `"node-forge": "1.4.3"` no `package.json`.
  - Criar `gerar-certificados-teste.sh` copiando **literalmente** as linhas 231–315 do desenho e acrescentando, antes do `ls "$OUT"`:
    ```bash
    openssl pkcs12 -export -inkey a1.key -in a1.pem -certfile cadeia.pem -passout 'pass:açaí-de-teste' -out "$OUT/senha-acentuada.pfx"
    openssl pkcs12 -export -inkey a1.key -in a1.pem -certfile cadeia.pem -passout 'pass:açaí-de-teste' -legacy -out "$OUT/senha-acentuada-legado.pfx"
    ```
  - Rodar uma vez: `bash api/scripts/gerar-certificados-teste.sh api/src/modules/certificado-digital/__tests__/fixtures` → 17 arquivos. Conferir com `git status` que os .pfx aparecem (a exceção do `.gitignore` funcionou).
- [ ] **Step 2: testes que falham** (helper `fx(nome)` lê a fixture; `INTER` = certificado CA:TRUE com CN `AC Intermediaria de Teste` tirado de `abrirPfx(fx('valido.pfx'))`).
  - `cnpj.spec.ts`:
    - normalização e formatação: `normalizarCnpj('12.abc.345/01de-35') === '12ABC34501DE35'`; `formatarCnpj('12ABC34501DE35') === '12.ABC.345/01DE-35'`;
    - `cnpjValido`: verdadeiro para `12345678000195`, `12345678000276`, `99888777000100` e `12ABC34501DE35`; falso para `12345678000194`, `00000000000000` e `1234567800019`;
    - CN: `cnpjDoCn('EMPRESA DE TESTE LTDA:12345678000195') === '12345678000195'`; `cnpjDoCn('FULANO DE TAL:12345678909') === null`; `titularDoCn` dos dois casos (com e sem `:CNPJ`);
    - `escolherCnpj`: SAN só com zeros cai para o CN; SAN válido vence o CN; `serialNumber` de 11 dígitos é ignorado; tudo nulo dá `null`;
    - `compararCnpj('12345678000195', x)`: com `x` = `'12.345.678/0001-95'` → `igual`; `'12.345.678/0002-76'` → `mesma_raiz`; `'99.888.777/0001-00'` → `diferente`; `''` e `'00.000.000/0001-00'` → `empresa_sem_cnpj`.
  - `pkcs12.spec.ts`:
    - abertura: `valido` → `chave.asymmetricKeyType === 'rsa'` e 3 certificados; `legado` abre com a folha de mesmo SHA-256;
    - `senha-acentuada.pfx` e `senha-acentuada-legado.pfx` abrem com `'açaí-de-teste'`;
    - senha `'errada'` em `valido` e em `legado` → `{ code: 'CERTIFICADO_SENHA' }`, e `String(e)` não contém `errada`;
    - `sem-chave.p12` → `CERTIFICADO_SEM_CHAVE`; `Buffer.from('%PDF-1.4 x')` e `raiz-teste.pem` → `CERTIFICADO_ARQUIVO`;
    - campos da folha do `valido`: `{ cnpjSan: '12345678000195', cnSujeito: 'EMPRESA DE TESTE LTDA:12345678000195', orgEmissor: 'ICP-Brasil', cnEmissor: 'AC Intermediaria de Teste', politicas: ['2.16.76.1.2.1.999'], serialNumberSujeito: null }`;
    - `mesma-raiz-filial` (PrintableString) → `cnpjSan '12345678000276'`; `selo-se-s` → `cnpjSan null`, `serialNumberSujeito '12345678000195'`, `politicas ['2.16.76.1.2.201.999']`;
    - reserialização byte a byte: a raiz tirada do `valido.pfx` tem a mesma `fingerprint256` que `new X509Certificate(raiz-teste.pem)`, lida sem forge; `folha.verify(INTER.publicKey)` e `INTER.verify(raiz.publicKey)` são verdadeiros;
    - `dataBrSp(new Date('2027-03-10T02:59:59Z')) === '09/03/2027'`;
    - **fitness:** varrendo `src/**/*.ts` fora de `__tests__`, só `modules/certificado-digital/pkcs12.adapter.ts` contém `from 'node-forge'`.
- [ ] **Step 3:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/certificado-digital` → falha.
- [ ] **Step 4: implementar**
  - `node-forge.d.ts` com `declare module 'node-forge'` tipando só as funções permitidas.
  - Desembrulhar como diz o desenho (seção "Desembrulhar"): `bag.key` ou `bag.asn1` → PKCS#8 DER → `createPrivateKey`; certificados por `bag.cert` reserializado ou `bag.asn1`.
  - Todo erro do forge é capturado dentro de `abrirPfx`.
  - **Se `senha-acentuada.pfx` (PBES2) não abrir com o forge 1.4.3: PARE e reporte (Ponto em aberto 2). Não improvise.**
- [ ] **Step 5:** mesmo comando do Step 3 → passa; `npm run typecheck` e `npm run lint` (capados) limpos.
- [ ] **Step 6:** `git commit -m "feat(certificado): abertura do .pfx, leitura dos campos e CNPJ (fixtures de teste)"`

### Task 3: Conferência completa e cadeia ICP-Brasil

**Files:**
- Create: `api/scripts/atualizar-cadeia-icp.sh`, `api/src/modules/certificado-digital/{cadeia.ts,conferencia.ts,icp-brasil.gerado.ts}`, `__tests__/{conferencia.spec.ts,icp-brasil.spec.ts}`
- Modify: `api/eslint.config.mjs` (ignora `**/icp-brasil.gerado.ts`)

**Interfaces:**
- Consumes: T2 inteira (inclusive `dataBrSp`).
- Produces:
  - `cadeia.ts`:
    - `export const CADEIA_ICP = Symbol('CADEIA_ICP')`; `interface CadeiaIcp { ancoras: X509Certificate[]; pacote: X509Certificate[] }`; `carregarCadeiaIcp(): CadeiaIcp`, que lê o módulo gerado;
    - `impressaoDigital(c: X509Certificate): string`;
    - `type ResultadoCadeia = { situacao: 'conferida'; intermediarias: X509Certificate[] } | { situacao: 'adulterada' } | { situacao: 'nao_fechou' }`;
    - `montarCadeia(folha: X509Certificate, doPfx: X509Certificate[], icp: CadeiaIcp, agora: Date): ResultadoCadeia`.
  - `conferencia.ts`:
    - `escolherFolha(chave: KeyObject, certificados: X509Certificate[]): X509Certificate` (nenhuma casa → `FORMATO`);
    - `tipoDaPolitica(politicas: string[]): { tipo: 'A1' | 'SE-S' | 'outro'; politicaOid: string | null }`;
    - `interface CertificadoConferido { chave: KeyObject; folha: X509Certificate; cadeia: X509Certificate[]; titular: string; cnpj: string; cnpjConfere: 'igual' | 'mesma_raiz'; tipo: 'A1' | 'SE-S' | 'outro'; politicaOid: string | null; emissor: string; numeroSerie: string; impressaoDigital: string; validoDe: Date; validoAte: Date; cadeiaConferida: boolean }`;
    - `conferirCertificado(e: { arquivo: Buffer; senha: string; cnpjEmpresa: string; agora: Date; icp: CadeiaIcp }): CertificadoConferido`. Ordem da tabela: abrir → folha → validade → CNPJ → cadeia.
  - O módulo gerado exporta `ANCORAS_ICP_BRASIL: readonly string[]`, `PACOTE_ICP_BRASIL: readonly string[]` e `PACOTE_GERADO_EM: string` (`AAAA-MM-DD`).

- [ ] **Step 1: gerar as âncoras** — `atualizar-cadeia-icp.sh` (usa `curl`, `unzip` e `openssl`; segue os 4 passos do desenho):
  1. Baixa `ICP-Brasilv{4,5,6,10,11,12,13}.crt` de `https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/`, em DER ou PEM. **Aborta** se alguma impressão SHA-256 diferir da tabela do desenho. A v7 fica fora.
  2. Baixa `ACcompactado.zip` + `hashsha512.txt` e confere o SHA-512.
  3. Mantém só os certificados que passam em `openssl verify -CAfile <âncoras> -untrusted <todos>` e que não são âncora.
  4. Escreve o módulo com os PEM ordenados pela impressão digital e o cabeçalho `// gerado por api/scripts/atualizar-cadeia-icp.sh — não editar`.

  Rodar uma vez (rede). Se não houver rede, a tarefa fica **BLOCKED**.
- [ ] **Step 2: testes que falham**
  - `icp-brasil.spec.ts`:
    - as impressões das âncoras, ordenadas, são exatamente as 7 da tabela do desenho;
    - `PACOTE_ICP_BRASIL.length > 150`;
    - todo certificado do pacote dá `montarCadeia(c, [], carregarCadeiaIcp(), new Date(PACOTE_GERADO_EM + 'T12:00:00Z')).situacao === 'conferida'`.
  - `conferencia.spec.ts`. Padrões: `agora` = 2027-06-01; `icp = { ancoras: [raiz-teste], pacote: [] }`; `cnpjEmpresa '12.345.678/0001-95'`.
    - **`valido`** → `{ cnpj: '12345678000195', cnpjConfere: 'igual', tipo: 'A1', politicaOid: '2.16.76.1.2.1.999', titular: 'EMPRESA DE TESTE LTDA', emissor: 'AC Intermediaria de Teste', cadeiaConferida: true }`, `cadeia` = [INTER], `validoAte` = `new Date('2036-01-01T00:00:00Z')`, `impressaoDigital` casa com `/^[0-9A-F]{64}$/`. O `legado` dá a mesma impressão.
    - **CNPJ:**
      - `mesma-raiz-filial` → `mesma_raiz`;
      - `selo-se-s` → `tipo 'SE-S'`, cnpj vindo do `serialNumber`;
      - `cnpj-alfanumerico` com `cnpjEmpresa '12.ABC.345/01DE-35'` → `igual`;
      - `ecpf` → `SEM_CNPJ`;
      - `cnpjEmpresa` `''` ou `'00.000.000/0001-00'` → `EMPRESA_SEM_CNPJ`;
      - `outro-cnpj` → mensagem exata `'Este certificado é do CNPJ 99.888.777/0001-00 (OUTRA EMPRESA SA). O CNPJ da empresa é 12.345.678/0001-95.'`.
    - **Validade:** `vencido` → `'Este certificado venceu em 31/12/2020. Envie o certificado renovado.'`; `ainda-nao-vale` → `'Este certificado só vale a partir de 31/12/2034.'`. São datas de SP: 00:00Z cai no dia anterior.
    - **Tipo:** `politica-a3` aceito com `tipo 'outro'` e `politicaOid '2.16.76.1.2.3.999'`.
    - **Cadeia e ICP:**
      - `cadeia-adulterada` → `CADEIA`, também com `pacote: [INTER]`;
      - `fora-da-icp` → `NAO_ICP` (autoassinado CA:TRUE);
      - `so-certificado-final` → com pacote `[]`: `cadeiaConferida false` e `cadeia []`; com `[INTER]`: `true` e `[INTER]`;
      - `valido` com `{ ancoras: [], pacote: [] }` → aceito com `cadeiaConferida false` e `cadeia` = [INTER].
    - **Par trocado:** `escolherFolha(chave de outro-cnpj.pfx, certificados de valido.pfx)` → `CERTIFICADO_FORMATO`.
- [ ] **Step 3:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/certificado-digital` → falha.
- [ ] **Step 4: implementar**
  - `montarCadeia`: busca pelo nome (`issuer === subject`) entre o .pfx, o pacote e as âncoras. Um candidato vale com `verify(candidato.publicKey)`, válido em `agora` e `ca === true`. No máximo 5 níveis; nunca usa `checkIssued`.
  - `adulterada` = há no .pfx um emissor com o mesmo nome e nenhum candidato confirma.
  - Sinal de ICP = `orgEmissor === 'ICP-Brasil'` ou alguma política começando com `2.16.76.1.2.`.
  - `tipoDaPolitica`: `2.16.76.1.2.1.` → A1; `2.16.76.1.2.201.` → SE-S; senão `outro`, com a primeira política `2.16.76.1.2.*` (ou a primeira política, ou `null`).
- [ ] **Step 5:** comando do Step 3 → passa; typecheck e lint (capados) limpos.
- [ ] **Step 6:** `git commit -m "feat(certificado): conferência de validade, CNPJ, tipo e cadeia ICP-Brasil"`

### Task 4: Serviço, rotas, histórico, permissão e smoke

**Files:**
- Create: `api/src/modules/certificado-digital/{situacao.ts,certificado-digital.service.ts,certificado-digital.controller.ts,certificado-digital.dto.ts,certificado-digital.module.ts}`, `__tests__/{situacao.spec.ts,certificado-digital.service.spec.ts,certificado-digital.dto.spec.ts}`
- Modify: `api/src/app.module.ts`, `api/src/common/__tests__/permissoes-protecao.spec.ts`, `api/scripts/smoke.sh`, `api/scripts/smoke-capped.sh`

**Interfaces:**
- Consumes: `cifrar`/`decifrar` (T1), `conferirCertificado`, `CADEIA_ICP`, `carregarCadeiaIcp` (T3), `compararCnpj` (T2).
- Produces:
  - `situacao.ts`:
    - `type Situacao = 'ausente' | 'sem_segredo' | 'ilegivel' | 'vencido' | 'vencendo' | 'valido'`;
    - `situacaoDe(e: { temLinha: boolean; temSegredo: boolean; legivel: boolean; validoAte: Date | null; agora: Date }): Situacao`;
    - `diasRestantes(validoAte: Date, agora: Date): number`;
    - `interface ItemHistorico { evento: 'enviado' | 'substituido' | 'removido'; feito_por_nome: string; feito_em: Date; valido_ate: Date; cnpj: string; titular: string }`;
    - `interface CertificadoStatus { situacao: Situacao; titular: string | null; cnpj: string | null; cnpj_confere: 'igual' | 'mesma_raiz' | 'diferente' | 'empresa_sem_cnpj' | null; tipo: 'A1' | 'SE-S' | 'outro' | null; politica_oid: string | null; emissor: string | null; valido_de: Date | null; valido_ate: Date | null; dias_restantes: number | null; cadeia_conferida: boolean | null; enviado_em: Date | null; enviado_por_nome: string | null; historico: ItemHistorico[] }`.
  - `export const ROTULO_CERTIFICADO = 'erp-freela/certificado-a1/v1'`.
  - `CertificadoDigitalService(prisma: PrismaService, config: ConfigService, @Inject(CADEIA_ICP) icp: CadeiaIcp)` com `status(agora?: Date)`, `enviar(arquivoBase64: string, senha: string, quem: { id: string; nome: string }, agora?: Date)` e `remover(quem: { id: string; nome: string }, agora?: Date)`, todos `: Promise<CertificadoStatus>`.
  - `EnviarCertificadoDto { arquivo_base64: string (1–90000); senha: string (1–128) }`.
  - Rotas `GET`, `PUT` e `DELETE /v1/certificado-digital` (`@AdminOnly()`).
  - Material cifrado = `JSON.stringify({ chave_pkcs8_pem, certificado_pem, cadeia_pem: string[] })`.

- [ ] **Step 1: anotar a linha de base** — `cd api && ../scripts/run-capped.sh 1300 bash scripts/smoke-capped.sh` e registrar "smoke: N ok, M falha(s)" (falhas antigas não contam como regressão).
- [ ] **Step 2: testes que falham**
  - `situacao.spec.ts`:
    - precedência: sem segredo → `sem_segredo`, com ou sem linha; sem linha e com segredo → `ausente`; ilegível vence vencido; vencido vence vencendo;
    - `diasRestantes(new Date('2027-03-10T02:59:59Z'), new Date('2027-03-09T03:00:00Z')) === 0` (o mesmo dia 09/03 em SP); com validade `2027-03-10T03:00:00Z` → `1`.
  - `certificado-digital.service.spec.ts`. Prisma falso no molde do `montar` do `ia-chave.spec.ts`, com `$transaction(cb)` que passa um `tx` gravador. `icp` = raiz-teste; `quem` = `{ id: 'u1', nome: 'Ana' }`; `agora` = 2027-06-01; `configuracoes.cnpj` = `'12.345.678/0001-95'`. Casos:
    - **Sem segredo:** `status` → `sem_segredo`; `enviar` → 503 `{ code: 'CERTIFICADO_SEM_SEGREDO' }` e nada gravado.
    - **Enviar o `valido`:**
      - resposta: `situacao 'valido'`, `cadeia_conferida true`, `enviado_por_nome 'Ana'`, `historico[0]` = `{ evento: 'enviado', feito_por_nome: 'Ana' }`;
      - na linha: `material_cifrado` sem `BEGIN`, e `decifrar(…, ROTULO_CERTIFICADO)` dá um JSON com `cadeia_pem.length === 1`;
      - as escritas passam só pelo `tx`: `certificado_digital.upsert` do topo nunca é chamado.
    - **Vazamento:** o `JSON.stringify` das respostas do GET, do PUT e de cada corpo de recusa não contém `BEGIN`, `PRIVATE`, `senha-de-teste`, `errada` nem `base64.slice(100, 140)`. Com `jest.spyOn(Logger.prototype, 'log'|'warn'|'error')`, nenhuma mensagem contém a senha nem `BEGIN`, e o log de sucesso traz a impressão digital.
    - **Erro inesperado:** `jest.spyOn(adapter, 'abrirPfx')` lançando `new Error('falhou com senha-de-teste')` → 400 `CERTIFICADO_FORMATO`, e nenhum log contém `senha-de-teste`.
    - **Senha errada 2×:** os dois envios dão 400 `CERTIFICADO_SENHA`; linha `null` e histórico `[]`.
    - **Substituição:**
      - `valido` → `mesma-raiz-filial` dá `cnpj_confere 'mesma_raiz'` e histórico `[substituido, enviado]`;
      - em seguida `outro-cnpj` → 400, e a linha mantém a impressão da filial com histórico de 2 itens;
      - `historico.create` do `tx` lançando → `enviar` rejeita.
    - **Segredo trocado:** um serviço com outro segredo sobre a mesma linha → `ilegivel` com `titular` e `cnpj` preenchidos; reenviar o `valido` → `historico[0].evento 'substituido'`.
    - **CNPJ da empresa muda depois:** com `configuracoes.cnpj` = `'99.888.777/0001-00'` → `cnpj_confere 'diferente'` e `situacao 'valido'`.
    - **Vencimento:** `agora` `2035-12-31T02:59:59Z` → `vencendo` com `dias_restantes 1`; `2035-12-31T03:00:00Z` → `vencendo` com 0; `2036-01-01T00:00:00Z` → `vencido`.
    - **Remover:** com linha → `ausente` e `historico[0].evento 'removido'`; de novo → `ausente`, com o histórico do mesmo tamanho.
    - **Limite do histórico:** depois de 6 envios, `historico.length === 5`, do mais novo para o mais velho.
  - `certificado-digital.dto.spec.ts`:
    - 90.001 caracteres → a frase dos 64 KB;
    - senha `''` → "Digite a senha do certificado.";
    - 129 caracteres → "A senha do certificado tem no máximo 128 caracteres.";
    - arquivo `''` → "Escolha o arquivo do certificado.".
  - `permissoes-protecao.spec.ts`: entra `CertificadoDigitalController` e o caso `'o certificado digital é só do admin'` com GET, PUT e DELETE `/v1/certificado-digital` → `admin`.
  - `smoke.sh`, bloco `# ---------- certificado digital`:
    - Preparação: `FIX=src/modules/certificado-digital/__tests__/fixtures`, e `CERTIFICADO_SECRET=smoke-certificado-segredo-de-teste-0123456789` exportado no `smoke-capped.sh`.
    - Loja: 403 em GET, PUT e DELETE.
    - Primeiros envios (CNPJ do seed): GET admin → `ausente` e `historico` vazio; PUT do `valido` → `EMPRESA_SEM_CNPJ` com a frase.
    - PATCH da empresa para `cnpj 12.345.678/0001-95`.
    - Senha errada → 400 `CERTIFICADO_SENHA`, e `count(*)` da tabela = 0.
    - PUT do `valido`:
      - 200, `situacao valido`, `cnpj_confere igual`, `tipo A1`;
      - `cadeia_conferida false` (âncoras reais; fica assim de propósito);
      - corpo sem `BEGIN` nem `senha-de-teste`, e `material_cifrado NOT LIKE '%BEGIN%'`.
    - Substituições:
      - `mesma-raiz-filial` → `mesma_raiz`;
      - `outro-cnpj` → a frase exata, e o GET continua com `12345678000276`;
      - arquivo de texto → `CERTIFICADO_ARQUIVO`.
    - Remoção: DELETE → `ausente`, com 3 linhas no histórico (`removido` primeiro); DELETE de novo → continuam 3.
    - Loja: `GET /v1/configuracoes` sem `BEGIN`.
- [ ] **Step 3:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/certificado-digital src/common/__tests__/permissoes-protecao.spec.ts` → falha.
- [ ] **Step 4: implementar**
  - O PUT segue nesta ordem: segredo → decodificar → `conferirCertificado` → envelope → `$transaction`. Na transação: ler a linha anterior, `upsert`, e `historico.create` com `antes ? 'substituido' : 'enviado'`.
  - `CertificadoRecusado` vira `BadRequestException({ code, message })`, com log `certificado recusado: <code>`; qualquer outro erro vira `CERTIFICADO_FORMATO`.
  - O GET decifra só para classificar.
  - Módulo: `{ provide: CADEIA_ICP, useFactory: carregarCadeiaIcp }`.
- [ ] **Step 5:** o jest do Step 3 passa; typecheck e lint limpos. O smoke (capado) não ganha falha nova em relação ao Step 1, e todas as checagens novas passam.
- [ ] **Step 6:** `git commit -m "feat(certificado): rotas de cadastro, substituição e remoção com histórico"`

### Task 5: Porta para os projetos 3 e 4

**Files:**
- Create: `api/src/modules/certificado-digital/certificado-digital.port.ts`, `__tests__/certificado-digital.port.spec.ts`
- Modify: `certificado-digital.service.ts` (`implements CertificadoDigitalPort`), `certificado-digital.module.ts` (`{ provide: CERTIFICADO_DIGITAL, useExisting: CertificadoDigitalService }`, `exports: [CERTIFICADO_DIGITAL]`)

**Interfaces:**
- Produces: o código do bloco "Porta para os projetos 3 e 4" do desenho, **literal**: `CERTIFICADO_DIGITAL`, `CertificadoEmUso`, `CertificadoErro` e `CertificadoDigitalPort.emUso(agora?: Date)`. As frases de uso ficam em `MSG_USO`, no mesmo arquivo.
- Regras: sem linha → `CERTIFICADO_NAO_CADASTRADO` (503); linha sem segredo ou ilegível → `CERTIFICADO_ILEGIVEL` (503); vencido → `CERTIFICADO_VENCIDO` (422); `cnpj_confere === 'diferente'` → `CERTIFICADO_OUTRO_CNPJ` (422); `mesma_raiz` e `empresa_sem_cnpj` passam. Decifra a cada chamada, sem cache.

- [ ] **Step 1: testes que falham** (`port.spec.ts`, mesmo Prisma falso da T4):
  - **Erros:**
    - sem linha → `{ status: 503, code: 'CERTIFICADO_NAO_CADASTRADO', message: 'Cadastre o certificado digital em Configurações.' }`;
    - segredo trocado → `CERTIFICADO_ILEGIVEL` com a frase do desenho;
    - `emUso(new Date('2036-06-01T12:00:00Z'))` → 422 com `'O certificado digital venceu em 31/12/2035. Envie o renovado em Configurações.'`;
    - empresa mudou para `99.888.777/0001-00` → 422 `CERTIFICADO_OUTRO_CNPJ`.
  - **Passam:** CNPJ da filial (mesma raiz) passa.
  - **Certificado em uso:**
    - `chavePrivada.asymmetricKeyType === 'rsa'`, `cnpj === '12345678000195'` e `impressaoDigital` igual à da linha;
    - assinatura `sign('sha256', Buffer.from('x'), chavePrivada)` confere com `verify(…, certificado.publicKey, …)`.
  - **Vazamento:** `JSON.stringify(emUso)` e `util.inspect(emUso, { depth: 5 })` sem `PRIVATE`.
- [ ] **Step 2:** `../scripts/run-capped.sh 1500 npx jest --runInBand src/modules/certificado-digital/__tests__/certificado-digital.port.spec.ts` → falha.
- [ ] **Step 3:** implementar `emUso`, que reusa a classificação de `situacao.ts`.
- [ ] **Step 4:** Step 2 passa; typecheck e lint limpos.
- [ ] **Step 5:** `git commit -m "feat(certificado): porta CERTIFICADO_DIGITAL para SEFAZ e NFC-e"`

### Task 6: Web — cliente, regras de tela e painel

**Files:**
- Create: `web/src/lib/certificado.ts`, `web/src/lib/__tests__/certificado.test.ts`, `web/src/hooks/use-certificado.ts`, `web/src/components/certificado-panel.tsx`
- Modify: `web/src/lib/erp-api.ts`, `web/src/modules/shared/infrastructure/http.ts`, `web/src/lib/db.ts`, `web/src/app/(app)/configuracoes/page.tsx`, `web/scripts/browser-check.mjs`, `web/scripts/browser-check.sh`

**Interfaces:**
- Consumes: o contrato do GET da T4. Datas chegam como string ISO.
- Produces:
  - `erp-api.ts`:
    - tipos `SituacaoCertificado`, `ItemHistoricoCertificado` e `CertificadoStatus` (espelho de T4);
    - `statusCertificado()`, `enviarCertificado(arquivo_base64: string, senha: string)` e `removerCertificado()`, todos `Promise<CertificadoStatus>`.
  - `http.ts`: `errCode(error: unknown): string | null`. Devolve o `error.response.data.error.code`, ou `'SEM_CONEXAO'` se for erro do axios sem `response`; o `db.ts` reexporta.
  - `hooks/use-certificado.ts`: `useCertificado(ativo: boolean)` = `useQuery({ queryKey: ['certificado'], queryFn: statusCertificado, staleTime: 5 * 60_000, enabled: ativo })`.
  - `lib/certificado.ts` (puro):
    - formatação: `formatarCnpj(c: string): string`, `dataSp(iso: string): string` (`DD/MM/AAAA`, SP), `dataHoraSp(iso: string): string` ("16/11/2026 às 14h32"), `rotuloVencimento(dias: number): string` ("Vence hoje" | "Vence amanhã" | "Vence em N dias");
    - arquivo: `validarArquivoCertificado(f: { name: string; size: number }): string | null` e `arquivoParaBase64(f: File): Promise<string>`;
    - tipo: `nomeDoTipo(politicaOid: string | null): string | null`, com `2.16.76.1.2.{2,3,4}.*` → A2/A3/A4 e `.202.*` → SE-H;
    - `resumoDoCertificado(c: CertificadoStatus, cnpjEmpresaSalvo: string): { tom: 'neutro' | 'ok' | 'warn' | 'bad'; etiqueta: string; problema: string | null; avisos: string[]; acao: 'enviar' | 'substituir' | 'renovar' | 'enviar_de_novo' | null }`;
    - `linhasDoHistorico(h: ItemHistoricoCertificado[]): string[]`.
  - `CertificadoPanel()`, dentro de `<div id="certificado-digital" tabIndex={-1}>`. Ids `certificado-arquivo` e `certificado-senha`.

- [ ] **Step 1: testes que falham** (`certificado.test.ts`):
  - **Datas:** `dataSp('2027-03-10T02:59:59.000Z') === '09/03/2027'`; `dataHoraSp('2026-11-16T17:32:00.000Z') === '16/11/2026 às 14h32'`.
  - **CNPJ e arquivo:**
    - `formatarCnpj('12ABC34501DE35') === '12.ABC.345/01DE-35'`;
    - `validarArquivoCertificado`: `a.PFX` de 4 KB → `null`; `a.pdf` → a frase do `CERTIFICADO_ARQUIVO`; `a.p12` com 65.537 bytes → "Este arquivo é grande demais para ser um certificado A1 (máximo 64 KB).";
    - `arquivoParaBase64(new File([new Uint8Array([0x30, 0x82, 0xff])], 'a.pfx')) === 'MIL/'`.
  - **`resumoDoCertificado`:**
    - `ausente` → `neutro`, "Nenhum certificado guardado", `acao 'enviar'`;
    - válido sem aviso → `ok` "Válido", `acao 'substituir'`;
    - vencendo com 12 dias → `warn` "Vence em 12 dias", aviso "Vence em DD/MM/AAAA. Peça o novo certificado…" e `acao 'renovar'`; com 1 dia → "Vence amanhã"; com 0 → "Vence hoje";
    - `mesma_raiz` → `warn` "Válido, com aviso" e aviso com os dois CNPJs mascarados (UX §1 E/F);
    - `cadeia_conferida false` → `warn` "Válido, com aviso" e o aviso da cadeia (UX §1 F);
    - `tipo 'outro'` com `2.16.76.1.2.3.999` → aviso com "(é o tipo A3)"; `SE-S` → sem aviso;
    - vencido → `bad` "Vencido", problema "Este certificado venceu em … para voltar a usar.";
    - `ilegivel` → `bad` "Não pode ser lido", `acao 'enviar_de_novo'`;
    - `diferente` → `bad` "CNPJ não confere", problema "Este certificado é do CNPJ X, mas a empresa agora está com o CNPJ Y. Corrija…" (o Y vem de `cnpjEmpresaSalvo`);
    - `sem_segredo` → `bad` "Servidor não pronto", `acao null` e problema `'O servidor ainda não está pronto para guardar certificados. Fale com o suporte do Freela Comanda.'` (o texto da UX §6 vence o "Avise o suporte." do §1 G);
    - `empresa_sem_cnpj` → aviso "A empresa está sem CNPJ salvo em Configurações. Preencha o CNPJ no quadro Empresa e toque em Salvar.".
  - **`linhasDoHistorico`:** "Enviado por Ana em 16/11/2026 às 14h32" e "Substituído por Ana em … (vale até DD/MM/AAAA)". O titular e o CNPJ só aparecem quando mudam em relação ao item mais velho seguinte, e sempre no mais velho.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/certificado.test.ts` → falha.
- [ ] **Step 3: implementar**
  - O painel segue a UX §1, §3 e §5 literalmente e renderiza a partir de `resumoDoCertificado`.
  - Onde a UX traz duas versões, valem: ajuda da senha "É a senha que veio com o arquivo. Não guardamos a senha." (linha "Rótulos" do §1 A, não o desenho da tela); ajuda do arquivo "Pergunte ao seu contador por 'certificado A1 com a senha'.".
  - Ajuda fixa sobre o CNPJ salvo: "O certificado é conferido com o CNPJ já salvo no quadro Empresa. Mudou o CNPJ? Toque em Salvar no alto da página antes de enviar. Este quadro tem botões próprios: o Salvar não envia o certificado."
  - O erro do servidor aparece numa caixa `role="alert"` que recebe o foco. Só `CERTIFICADO_SENHA` limpa a senha (e o foco vai para ela); trocar de arquivo mantém a senha. `SEM_CONEXAO` mostra a frase de rede da UX §1 C. Na substituição, o cliente acrescenta " O certificado atual não foi alterado.".
  - No sucesso: limpar arquivo e senha, `setQueryData(['certificado'], resposta)` e focar o wrapper.
  - Remover usa `AlertDialog` (UX §1 I) com foco inicial em "Manter certificado".
  - Em `configuracoes/page.tsx`: `{me?.perfil === "admin" && <CertificadoPanel />}` logo abaixo do `IaChavePanel`; o `salvar()` passa a chamar `queryClient.invalidateQueries({ queryKey: ['certificado'] })`.
- [ ] **Step 4: browser-check** (seção nova, admin em 360×800).
  - Preparação:
    - o `browser-check.sh` exporta `CERTIFICADO_SECRET=browser-certificado-segredo-de-teste-0123456789` e `PGDB=erpfreela_browser`;
    - fixture `../api/src/modules/certificado-digital/__tests__/fixtures/valido.pfx`;
    - salvar o CNPJ `12.345.678/0001-95` pelo quadro Empresa + "Salvar".
  - Envio:
    - o botão "Conferir e guardar certificado" fica desabilitado até haver arquivo e senha;
    - senha `errada` **2 vezes** → alerta "Senha do certificado incorreta. Digite de novo.", `#certificado-senha` vazio e com foco, nome do arquivo visível;
    - `senha-de-teste` → toast "Certificado guardado.", "CNPJ 12.345.678/0001-95", o aviso da cadeia, HTML sem `senha-de-teste` e `scrollWidth <= 360`;
    - "Ver histórico" mostra "Enviado por".
  - Substituição com `outro-cnpj.pfx` → alerta com "O certificado atual não foi alterado." e o CNPJ antigo ainda visível; depois "Cancelar".
  - Remoção: foco em "Manter certificado"; Esc fecha; "Remover certificado" → toast "Certificado removido." e "Nenhum certificado guardado".
  - Storage: `localStorage` só com `authUser` e `sessionStorage` vazio.
  - Captura `admin-certificado-360.png`.
- [ ] **Step 5:** `yarn test`, `yarn typecheck` e `yarn lint` (capados) limpos; `../scripts/run-capped.sh 2600 bash scripts/browser-check.sh` sem falha (regra de memória da T8).
- [ ] **Step 6:** `git commit -m "feat(web): painel do certificado digital em Configurações"`

### Task 7: Faixa no topo do app

**Files:**
- Create: `web/src/components/certificado-faixa.tsx`
- Modify: `web/src/lib/certificado.ts`, `web/src/lib/__tests__/certificado.test.ts`, `web/src/app/(app)/layout.tsx`, `web/scripts/browser-check.mjs`

**Interfaces:**
- Consumes: `useCertificado`, `dataSp` e `CertificadoStatus` (T6).
- Produces:
  - `faixaDoCertificado(c: CertificadoStatus | undefined): { tom: 'warn' | 'warn_forte' | 'bad'; texto: string; dispensavel: boolean } | null`. Precedência: ilegível > vencido > CNPJ `diferente` > vence em 0–7 > vence em 8–30. Os textos são os da UX §2: 0 dias = "vence hoje (DD/MM/AAAA)"; 1 = "vence amanhã (DD/MM/AAAA)".
  - `CertificadoFaixa()` em `(app)/layout.tsx`, dentro de `<main>` e acima de `{children}`; consulta só com `me.perfil === 'admin'`.

- [ ] **Step 1: testes que falham**:
  - `faixaDoCertificado` sem faixa: `dias_restantes 31` → `null`; `ausente`, `sem_segredo`, `mesma_raiz` e cadeia não conferida → `null`.
  - Vence em 8–30: `20` → `warn`, dispensável, "O certificado digital vence em 20 dias (DD/MM/AAAA). Envie o renovado em Configurações.".
  - Vence em 0–7: `7` → `warn_forte`, não dispensável; `1` → texto com "vence amanhã ("; `0` → texto com "vence hoje (".
  - Vermelhas, nenhuma dispensável: vencido → `bad` com "venceu em"; `ilegivel` → `bad`; `diferente` com 20 dias → `bad`, com o texto do CNPJ.
- [ ] **Step 2:** `cd web && ../scripts/run-capped.sh 1500 yarn test src/lib/__tests__/certificado.test.ts` → falha.
- [ ] **Step 3: implementar**
  - A faixa é um `<Link href="/configuracoes#certificado-digital">` com ≥ 44 px, `role="status"`, `CircleAlert`, o texto e "Ver →".
  - O X (44 px, `aria-label="Esconder aviso"`) aparece só se `dispensavel`. Ao tocar, esconde por `useState` (vale até recarregar a página).
  - Enquanto carrega, ou com erro, nada aparece.
  - PUT e DELETE já atualizam `['certificado']` (T6).
- [ ] **Step 4: browser-check**
  - Admin:
    - reenviar `valido.pfx`;
    - `execFileSync('docker', ['exec', 'erp-freela-postgres', 'psql', '-U', 'erpfreela', '-d', PGDB, '-c', "update certificado_digital set valido_ate = now() + interval '20 days'"])`, depois `reload` em `/painel` → faixa `/vence em \d+ dias/`;
    - "Esconder aviso" some e continua sumida ao ir a `/vendas` **clicando no link do menu** (navegação do cliente; nunca `page.goto`/`abrir()`, que recarregam e zeram o `useState`). Um `reload` traz a faixa de volta. Se falhar, não "conserte" pondo o dispensar em storage: é proibido;
    - `interval '3 days'` → faixa sem "Esconder aviso"; o clique leva a `/configuracoes#certificado-digital`.
  - Loja: em `/painel`, nenhum request a `/v1/certificado-digital` (`page.on('request')`) e nenhuma faixa.
- [ ] **Step 5:** os testes do Step 2 passam; `yarn typecheck`, `yarn lint` e browser-check (regra de memória da T8).
- [ ] **Step 6:** `git commit -m "feat(web): faixa de vencimento do certificado no topo (admin)"`

### Task 8: Documentação, deploy e conferência final

**Files:** Modify: `docs/api-contract.md`, `docs/deploy.md`, `CLAUDE.md`, `README.md`. Create, **fora do repositório** e sem commit: `~/erp-deploy/segredo-certificado.sh`.

- [ ] **Step 1: documentar**
  - `api-contract.md`: as 3 rotas, o corpo do GET (com `historico`), a tabela de erros e a regra "a loja não alcança".
  - `deploy.md`: novo passo antes da API, `bash ~/erp-deploy/segredo-certificado.sh`, que precisa ter rodado **antes do primeiro envio**. Explicar:
    - sem a variável, a tela diz "O servidor ainda não está pronto…";
    - trocar ou perder o segredo deixa o certificado ilegível e obriga a enviar de novo;
    - nunca copiar dump e `.env` juntos;
    - o compose tem que estar atualizado no servidor.
  - `CLAUDE.md`: uma linha nas Regras rápidas — porta `CERTIFICADO_DIGITAL`, forge 1.4.3 só no adaptador, `CERTIFICADO_SECRET`, os dois scripts e as fixtures.
  - `README.md`: pendência do dono — enviar o A1 real depois de subir e olhar `cadeia_conferida`.
- [ ] **Step 2: script do servidor** — no molde de `~/erp-deploy/chave-ia.sh`, sem pedir nada.
  - Por ssh: se o `.env` não tiver `CERTIFICADO_SECRET=` com valor, acrescenta `CERTIFICADO_SECRET=$(openssl rand -hex 32)` com `umask 077`, mantendo dono e permissão 600; se já tiver, não mexe.
  - Depois: `docker compose -f docker-compose.prod.yml up -d --no-build api </dev/null`, espera o `/health` e confere `docker exec erp-freela-api sh -c '[ ${#CERTIFICADO_SECRET} -ge 32 ]'`.
  - **O segredo nunca sai do servidor.**
- [ ] **Step 3: conferência completa**, um comando por vez e capados:
  - api: `npx jest --runInBand src/modules/certificado-digital src/common src/modules/leitura-pdf src/scripts/import-lovable`, `npm run typecheck`, `npm run lint`, smoke e `npm audit --omit=dev` (nenhum alerta para `node-forge`);
  - web: `yarn test`, `yarn typecheck`, `yarn lint` e browser-check.

  Observação: o browser-check precisa de ~2,6 GB livres; tente UMA vez; se sair 137 ou 75, não insista, não mate processo nenhum e registre 'browser-check não rodou: sem memória'.

  Anotar os números (testes, smoke ok/falhas) no commit.
- [ ] **Step 4:** `git commit -m "docs(certificado): contrato, subida com CERTIFICADO_SECRET e regras do certificado A1"`

---

## Pontos em aberto para o controlador

1. **Folha de `fora-da-icp.pfx`.** Conferido com OpenSSL 3.0.13: `req -x509` marca o autoassinado `CA:TRUE`, então a regra do desenho ("a folha é o que não é AC") não acha folha nesse caso, e o desenho espera `NAO_ICP`. O plano usa "folha = o certificado que casa com a chave" e fixa `NAO_ICP` no teste (T3). **Recomendo aceitar:** é equivalente nos .pfx reais e mais robusto.
2. **Senha com acento no .pfx moderno.** Conferi o código do forge 1.4.3: o PBES2 (`pbkdf2.js`) usa a senha como bytes latin1, e o OpenSSL usa UTF-8. O MAC e o legado (`charCodeAt`, UCS-2) ficam corretos. Então `açaí-de-teste` provavelmente falha no `senha-acentuada.pfx`, e a T2 manda parar se falhar.
   - **Recomendo:** no adaptador, só quando a senha tiver caractere fora do ASCII e o erro não for o do MAC, uma 2ª tentativa sem o `macData` (já conferido com a senha original) e com `forge.util.encodeUtf8(senha)`.
   - **Alternativa:** recusar com uma frase própria ("senha com acento não é aceita; peça ao contador para gerar com senha sem acento").
3. **Textos que a UX não traz** (estão no plano, T6 e T7):
   - etiquetas dos estados G: "Vencido", "Não pode ser lido", "CNPJ não confere" e "Servidor não pronto";
   - "Válido, com aviso" para avisos que não são de vencimento;
   - o aviso de `empresa_sem_cnpj` com certificado guardado;
   - a ajuda do CNPJ salvo;
   - o nome do tipo (A2/A3/A4/SE-H; sem nome conhecido, a frase sai sem "(é o tipo X)").

   **Recomendo** passar ao `ux-designer` só para revisão de redação; não bloqueia a implementação.
