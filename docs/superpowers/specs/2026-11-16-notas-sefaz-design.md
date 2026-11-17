# Notas da SEFAZ (Distribuição DF-e, só leitura), nota repetida, IA no XML e CNPJ com letras — desenho

Data: 16/11/2026, Etapa 2 reescrita em 17/11/2026 · Ramo `feat/notas-sefaz` · Entregas 1 (etapa 0, A, B) e 2 (etapa 1) prontas no ramo; a Etapa 2
vira a entrega 3 (plano `docs/superpowers/plans/2026-11-17-notas-sefaz-entrega-3.md`). Nenhuma chamada à SEFAZ (nem homologação) e nenhum handshake com
os servidores dela até o 1º teste real. 3º de quatro projetos: foto → certificado A1 → **notas da SEFAZ** → NFC-e. Consome a porta
`CERTIFICADO_DIGITAL` e deixa para a NFC-e o transporte SOAP 1.2 com mTLS, o leitor de XML e a assinatura XMLDSig (`modules/sefaz/assinatura-xml.ts`).
Marcas: *conferido* = li no documento citado; *minha* = decisão do construtor; *não confirmado* = sem fonte primária, vira risco do 1º teste real.
Na Etapa 2 valem também as marcas da pesquisa de 17/11: [P] fonte primária, [S] secundária, [N] não encontrado.

## Por quê

Hoje uma NF-e de fornecedor só entra no sistema se alguém tiver o XML, o PDF ou o papel. O Ambiente Nacional (AN) da SEFAZ já tem todas as NF-e emitidas
contra o CNPJ, e o A1 cadastrado permite buscá-las. O dono quer que elas apareçam sozinhas na Entrada de Notas, saber o que falta lançar e ser avisado de
cancelamentos. Esta entrega também fecha três buracos que a busca deixa à mostra: CNPJ com letras, a mesma nota lançada duas vezes por caminhos diferentes
e o XML sem a ajuda da IA para escolher o insumo.

## Decisões do dono (16/11/2026, por escrito)

| # | Pergunta | Decisão | Onde entra |
|---|---|---|---|
| 1 | O contador já consome a distribuição de DF-e deste CNPJ? | "Não sei, provavelmente não." Não bloqueia. | Detectores D1/D2 (etapa 1) e a frase na ativação: "Se o seu contador também baixa as notas pela SEFAZ, avise antes de ligar". |
| 2 | Construir agora? | Sim. | Escopo. |
| 3 | 1ª etapa só de leitura, sem ciência? | Sim. A ciência automática vai para a etapa 2. | Etapa 2. |
| 4 | Confirmar a operação na SEFAZ ao "Dar entrada"? | Não. **Substituída em 17/11** (decisão 2 de 17/11: confirma sozinho). | Etapa 2. |
| 5 | Botão "Desconhecimento da operação"? | Depois. **Substituída em 17/11** (decisão 3 de 17/11: botão "Não reconheço"). | Etapa 2. |
| 6 | IA sugerindo o insumo dos itens do XML? | Sim, também no XML enviado à mão. | Parte B. |
| 7 | Nota cancelada pelo fornecedor depois de lançada? | Só avisar. | Etapa 1: faixa e linha vermelhas; estoque e contas intocados. |
| 8 | Corrigir antes o CNPJ com letras? | Sim, como etapa 0. | Etapa 0. |
| 9 | Mesma nota lançada por caminhos diferentes? | Mesmo CNPJ do fornecedor + mesmo número (+ série, se houver) = avisar e o admin confirma, sem barrar. Vale para XML, PDF, foto e SEFAZ. | Parte A. |

## Escopo

- **Esta entrega, nesta ordem** (cada parte já serve sozinha): **Etapa 0** (CNPJ e chave com letras) → **A** (aviso de nota repetida) → **B** (IA nos itens
  do XML) → **Etapa 1** (busca na SEFAZ só de leitura, caixa de entrada e aviso de cancelamento). A etapa 1 vem **desligada** de duas formas: variável de
  ambiente e interruptor na tela. A 1ª consulta em produção só com o "eu autorizo" do dono.
- **Etapa 2 (desenho abaixo, entrega 3, desligada):** respostas à SEFAZ: ciência automática (e, com ela, o XML completo de rotina), confirmação ao dar
  entrada, "Não reconheço", "A compra não aconteceu" e o aviso do prazo de 90 dias.
- **Depois (sem desenho):** lacunas de NSU por `consNSU`; "Baixar agora" por `consChNFe`; carta de correção na tela; retificar uma resposta final;
  importar vários XML de uma vez; mais de um CNPJ; CT-e/NFS-e. NFC-e é o projeto 4.
- **Fora por decisão:** estorno de nota cancelada (7).
- **Não pode:** consultar antes da espera da NT (o 656 bloqueia o CNPJ para **todos** os sistemas, inclusive o do contador) · `rejectUnauthorized: false` ·
  chave, PEM ou XML em log · teste com rede · loja alcançar rota nova · vir ligado de fábrica · nota de homologação chegar ao "Dar entrada" · evento
  enviado à SEFAZ com as respostas desligadas, ou antes do OK do contador e do "eu autorizo" do dono.

## O que muda para quem usa (só admin)

1. **Configurações → painel "Notas da SEFAZ"**: mostra o ambiente do servidor (homologação ou produção) e o interruptor "Buscar notas na SEFAZ", que vem
   desligado. Para ligar, o admin confirma este texto: "A busca usa o certificado digital da empresa. **Se o seu contador também baixa as notas pela SEFAZ,
   avise antes de ligar**: com dois sistemas buscando, a SEFAZ bloqueia os dois por 1 hora. Notas emitidas antes da primeira busca não aparecem."
   Ligar e desligar gravam quem e quando. Mudou o CNPJ da empresa ou o ambiente do servidor? É preciso ligar de novo. Com o servidor em `desligado`,
   o painel diz "A busca de notas na SEFAZ não está ativada neste servidor." e a caixa não aparece.
2. **Entrada de Notas ganha a caixa de entrada**, acima do campo de arquivo:
```
Notas da SEFAZ · última busca 14:05 (2 novas) · próxima a partir de 15:10                                   [Buscar agora]
⚠ 1 nota lançada foi CANCELADA pelo fornecedor na SEFAZ. Confira o estoque e as contas.
Fornecedor              NF / série  Emissão  Valor (R$)  Situação
ATACADÃO S.A.           4411 / 1    14/11      1.234,56  Falta lançar                                     [Copiar chave] [Ignorar]
DISTRIB. BEBIDAS XYZ    880 / 2     15/11        890,00  Parece já lançada (NF 880 por FOTO em 15/11)     [Ver] [Ignorar]
FRIGORÍFICO ABC         120 / 1     02/11      2.100,00  Já lançada (por XML em 03/11)
LATICÍNIOS K            77 / 1      10/11        320,00  CANCELADA pelo fornecedor depois de lançada      [Ciente]
CERVEJARIA K            15 / 1      16/11          0,00  Falta lançar · entrada (não parece compra)       [Conferir] [Ignorar]
                                                                                              [A conferir ▾ | Todas]
```
   "Conferir" só aparece quando a SEFAZ já liberou o XML completo (ver "O que a etapa 1 mostra"). Ele abre a **mesma** tela de conferência de hoje, lida
   pelo mesmo `parseNFeXML`, com origem `sefaz`; nada entra no estoque sem o "Dar entrada". "Ignorar" pede motivo e pode ser desfeito. Em homologação
   aparece a faixa "HOMOLOGAÇÃO — notas de teste, não entram no estoque" e não há "Conferir".
3. **Nota repetida, em qualquer origem:** logo depois de ler o arquivo, o quadro "2. Dados da nota" mostra uma faixa âmbar, por exemplo "Parece que esta
   nota já foi lançada: NF 4411 série 1 · ATACADÃO · R$ 1.234,56 · lançada em 03/11/2026 por FOTO", com a caixa "É outra nota: lançar mesmo assim".
   Sem marcar a caixa, "Dar entrada" pede confirmação.
4. **XML com IA:** as linhas sem vínculo salvo recebem a sugestão da IA ("sugestão — confira" / "novo — confira"), como já acontece com foto e PDF. Sem
   chave de IA, tudo segue como hoje.
5. **Respostas à SEFAZ (etapa 2, entrega 3, desligadas):** no mesmo painel, "Ligar as respostas" (só depois de o contador concordar). Ligadas, o
   Comanda avisa a SEFAZ que recebeu cada nota nova (e a nota completa passa a chegar), confirma a compra quando a nota é lançada, e a aba ganha "Não
   reconheço…", o motivo "A compra não aconteceu" e o aviso do prazo de 90 dias. Textos na UX §8.

## Regras da SEFAZ que amarram o desenho (conferido, salvo marca)

| Regra | Fonte |
|---|---|
| **Endereços da distribuição.** Produção: `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`. Homologação: `https://hom1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx`. Serviço 1.00. As cópias do WSDL ainda trazem `hom.` em homologação; vale o portal. | Portal NF-e e Portal de Homologação, "Relação de Serviços Web", AN (lidos em 16/11/2026) |
| **SOAP.** O WSDL declara as ligações `…Soap` (1.1) e `…Soap12` (1.2), ambas com `soapAction="http://www.portalfiscal.inf.br/nfe/wsdl/NFeDistribuicaoDFe/nfeDistDFeInteresse"`, `document/literal`, **sem cabeçalho**. Os exemplos da NT usam 1.1; o MOC fixa 1.2 nos serviços 4.00. *Minha:* **1.2**, com `Content-Type: application/soap+xml; charset=utf-8; action="…/nfeDistDFeInteresse"`, o mesmo que a NFC-e vai usar. Plano B: 1.1 (`text/xml` + cabeçalho `SOAPAction`), trocando uma função só. | Cópias públicas do WSDL (secundárias): produção em akretion/nfelib e JuniorPolegato/pole, idênticas byte a byte (`cmp`); homologação muda só o endereço. Não é o arquivo do portal. NT 2014.002 v1.40 §5; MOC 7.0, padrão de mensagens |
| **Pedido.** `nfeDistDFeInteresse` > `nfeDadosMsg` > `distDFeInt versao="1.01"` (ns `http://www.portalfiscal.inf.br/nfe`); `tpAmb` 1/2; `cUFAutor` opcional (0-1; *minha:* 35, a UF da unidade); `CNPJ` tipo C desde 08/07/2026; `distNSU/ultNSU` com 15 dígitos. Prefixo de namespace na área de dados = rejeição 404. | NT 2014.002 v1.40 §3.1, §4, §5 e histórico v1.40; PL_NFeDistDFe_104 |
| **Retorno.** `retDistDFeInt` traz `cStat`, `xMotivo`, `dhResp`, `ultNSU`, `maxNSU` e até 50 `docZip` (gzip + base64), cada um com os atributos `NSU` e `schema` (`resNFe`, `procNFe`, `resEvento`, `procEventoNFe`). NF-e média ≈ 10 KB. | NT 2014.002 §3.2, §3.3 |
| **Consumo.** Depois de 137, ou com `ultNSU == maxNSU`, esperar 1 h. Consultar antes = 656, e o CNPJ fica bloqueado 1 h; tentar de novo nesse intervalo zera a contagem. A consulta parte sempre do `ultNSU` devolvido na anterior; fora da sequência = 656. Aplicações diferentes no mesmo CNPJ seguem a mesma sequência. No `distNSU`, o 656 devolve o `ultNSU` da última consulta do CNPJ (v1.14). A NT pune "sucessivas tentativas de busca de registros já disponibilizados", mas não diz se **uma** repetição já conta, nem fixa intervalo depois de 138 com `ultNSU < maxNSU`. | NT 2014.002 §3.5, §3.11.4 |
| **Janela.** O AN guarda os documentos por 90 dias; `ultNSU = 0` traz no máximo os últimos 3 meses. Só há NSU para o CNPJ-base que usou `distNSU` nos últimos 60 dias: no 1º uso vem 137 e nada retroativo. Parar por mais de 60 dias deixa um buraco sem volta. | NT 2014.002 §3.1 A08, §3.4 a–c, Obs1–2 |
| **Papel do destinatário.** Antes de se manifestar (ciência, confirmação ou operação não realizada), ele recebe **só o resumo (`resNFe`) e o cancelamento**. A NF-e inteira, a carta de correção e os demais eventos chegam depois da manifestação, feita por qualquer sistema ou pelo portal, sempre com o certificado. | NT 2014.002 §3, tabela e nota 1 |
| **Resumo.** O `resNFe` traz `chNFe`, `CNPJ` ou `CPF` do emitente, `xNome`, `IE`, `dhEmi`, `tpNF`, `vNF`, `digVal`, `dhRecbto`, `nProt` e `cSitNFe` (1 autorizada, 2 denegada, 3 cancelada). **Não traz número nem série**: os dois saem da chave (série nas posições 23–25, número nas 26–34). O `resEvento` traz `CNPJ`/`CPF` do emitente, `chNFe`, `tpEvento`, `nSeqEvento`, `xEvento`, `dhEvento`, `dhRecbto` e `nProt`. | NT 2014.002 §3.11.1 (C03–C14), §3.11.2 (D04–D12) |
| **Chave com CNPJ alfanumérico.** Formato `[0-9]{6}[A-Z0-9]{12}[0-9]{26}`, com letras nas posições 7–18. O DV segue o cálculo do CNPJ, com o valor de cada caractere = ASCII − 48. Na distribuição, `chNFe` e `CNPJ` são do tipo C. | NT Conjunta 2025.001 v1.00 §5; NT 2026.004 v1.01 §7 |
| **Certificado.** Exige TLS 1.2+ mútuo. Rejeições de transmissor: inválido, vencido, cadeia, revogado, fora da ICP ou LCR (280–286); sem CNPJ (473). O CNPJ-base do certificado tem de ser o do CNPJ consultado (593). | NT 2014.002 §4; MOC 7.0 §4.2.2–4.2.3 |
| **Servidor TLS do AN.** Pelo log público de certificados (CT), `www1` e `hom1` mudaram de emissor: ICP-Brasil (AC do SERPRO SSL, Raiz v10) até 04/2025; Sectigo de 04/2025 a 04/2026; "AC SERPRO AR46 OV TLS CA 2025" desde 04/2026. A ligação desta última com a GlobalSign sai das URLs de OCSP e CPS da folha (globalsign.com); a raiz "R46" é inferida pelo nome. A folha mais nova de `www1` no CT venceu em 29/10/2026 e, em 16/11, não há substituta no CT. *Minha:* `ca` = raízes do Node + âncoras ICP-Brasil. No Node 20.19.4 local, `tls.rootCertificates` tem GlobalSign Root R46, USERTrust RSA e Sectigo R46; na imagem `node:22-alpine` não conferi. A Raiz v10 está no `icp-brasil.gerado.ts`. | crt.sh (16/11/2026); conferido executando o Node 20.19.4 e lendo o pacote do repo |
| **O que não vem.** A NT só trata de NF-e, e no `consChNFe` recusa chave de modelo ≠ 55 (618). Daí *infiro* que NFC-e (65) e SAT ficam fora. CT-e e NFS-e têm distribuição própria (*não confirmado*). | NT 2014.002 §2, §4 |

## Etapa 0 — CNPJ e chave com letras (decisão 8)

Um normalizador por conceito, em `api/src/common/fiscal/`. O `cnpj.ts` sai de `certificado-digital/` sem mudar; os imports se ajustam. O
`chave-acesso.ts` é novo: `normalizarChave`, `chaveValida` (formato + DV) e `partesDaChave` (UF, AAMM, emitente, modelo, série, número). No web,
`web/src/lib/fiscal.ts` repete os normalizadores; as duas cópias ficam iguais, como a fórmula da ficha. Normalizar = maiúsculas e só `[0-9A-Z]`.

| Ponto | Hoje | Passa a |
|---|---|---|
| `notas.service.ts:45`, chave do "Dar entrada" | `\D` | `normalizarChave`; vazia = `null`; formato ou DV inválido → 400 `CHAVE_INVALIDA` "A chave de acesso da nota é inválida. Confira os 44 caracteres." |
| `notas.service.ts:51`, `fornecedor_cnpj` | `\D` | `normalizarCnpj`. Pode ser CPF (11), porque o `parseNFeXML` lê `CNPJ ?? CPF`. Não valida DV (a IA erra); a tela avisa |
| `GET /v1/notas/existe?chave=`, `GET /v1/vinculos?cnpj=` | cru | os mesmos normalizadores do `lancar` |
| `leitura-pdf.service.ts:22`, `chave44` | `\D` + 44 | `normalizarChave` + `chaveValida` (com DV), senão `null`. Chave mal lida vira `null`, e a repetição cai na parte A |
| `leitura-pdf.service.ts`, `emitente_cnpj` | sem tratamento | `normalizarCnpj` |
| `schemas.ts`: `chave`, `emitente_cnpj`, `cnpj` do DDA | "Só números" | "44 caracteres; as posições 7 a 18 podem ter letras (CNPJ alfanumérico)" / "CNPJ com 14 caracteres, números e letras maiúsculas, sem pontuação" |
| `cadastros`, `PATCH /v1/configuracoes` `cnpj` | grava o que foi digitado | normaliza; se vier preenchido e inválido → 400 `CNPJ_INVALIDO` "CNPJ inválido. Confira os 14 caracteres (pode ter letras)." |
| `cadastros`, fornecedor `cnpj` | grava como veio | normaliza (pode ser CPF; não valida) |
| `web …/notas/page.tsx:144`, CNPJ | `\D` | maiúsculas + `[^0-9A-Z]`; aviso âmbar "CNPJ/CPF não confere" quando o DV falha (não bloqueia) |
| `web …/notas/page.tsx:145`, "Número / série" | grava só o número | grava número e série (a série passa a contar na parte A) |
| `web …/configuracoes/page.tsx:78` | `inputMode="numeric"` | sem `inputMode` (o teclado precisa de letras); exibe com `formatarCnpj` |
| `web/src/lib/dda.ts:31`, CNPJ do beneficiário | `\D` | `normalizarCnpj` |
| `web/src/lib/dda.ts:34`, linha digitável | `\D` | **não muda**: boleto é só número |

Migração `cnpj_alfanumerico`: aplica `upper(regexp_replace(x, '[^0-9A-Za-z]', '', 'g'))` em `configuracoes.cnpj`, `fornecedores.cnpj` e
`notas_entrada.fornecedor_cnpj`. `vinculos_produto` fica de fora: sempre recebeu o CNPJ já sem pontuação, via `lancar_nota`, e tem UNIQUE.

## A — Aviso de nota repetida (decisão 9)

**Regra** (pura, `common/fiscal/nota-repetida.ts`):
- **Chave igual** continua bloqueada como hoje: índice único + 409 `DUPLICADO` "Esta nota já foi lançada".
- **Parece repetida**: mesmo emitente (`normalizarCnpj`, CNPJ ou CPF) **e** mesmo número **e**, quando as duas notas têm série, mesma série.
  - Número: só dígitos, sem zeros à esquerda ("000.004.411" = "4411").
  - Série: só dígitos, sem zeros à esquerda; "000" vira "0" ("001" = "1").
- Sem emitente ou sem número (foto ilegível): não confere.
- Nota da SEFAZ: número e série saem da chave; o emitente sai do `resNFe`.

**Onde é conferida:**
1. **Consulta prévia** `GET /v1/notas/repetidas?cnpj=&numero=&serie=`. Devolve até 5 notas `{ id, numero, serie, fornecedor_nome, data_emissao,
   data_entrada, valor_total, origem, created_at }`, da mais nova para a mais velha. A tela chama logo após ler o arquivo (XML, PDF, foto ou "Conferir")
   e de novo se o admin mudar CNPJ, número ou série.
2. **Servidor**, em `POST /v1/notas`, antes da transação. Achou alguma e `confirmar_repetida !== true` → 409 `NOTA_REPETIDA` "Já existe a NF 4411 série 1
   de ATACADÃO S.A., lançada em 03/11/2026 por FOTO, de R$ 1.234,56. Se for outra nota, confirme para lançar mesmo assim." Se houver mais de uma, a
   frase ganha "(e mais N parecidas)". Com `confirmar_repetida: true`, grava `notas_entrada.repetida_de` com o id da mais nova, como rastro da
   confirmação. Não há trava: duas abas ao mesmo tempo podem escapar do aviso, e isso é aceito, porque a decisão é avisar, não barrar.
3. **Caixa da SEFAZ:** a situação "Parece já lançada" é derivada pela mesma regra.

**Os dados vão na frase.** O `HttpExceptionFilter` só envia `{ error: { code, message } }` e descarta o resto. *Minha:* não mexer no contrato; a
estrutura vem da consulta prévia. Se o 409 chegar mesmo assim (os dados mudaram depois da consulta), a tela abre um diálogo com a frase do servidor, e
"Lançar mesmo assim" reenvia com `confirmar_repetida: true`. Índice novo: `notas_entrada (fornecedor_cnpj)`.

## B — IA nos itens do XML (decisão 6)

- **Rota:** `POST /v1/notas/sugerir-insumos`, no módulo `leitura-pdf`, `@AdminOnly()`, JSON.
  - Entrada: `{ itens: [{ descricao (≤ 500), unidade? (≤ 20) }] }`, de 1 a 200 linhas.
  - Saída: `{ itens: [{ item_estoque_id, novo: { nome, unidade, subgrupo } | null, fator }] }`, com a mesma ordem e o mesmo tamanho da entrada.
- **Serviço:**
  - Carrega os insumos ativos e os subgrupos, como o `lerNota`.
  - Monta `textoCatalogo` + as linhas numeradas.
  - Usa o esquema novo `SCHEMA_SUGESTAO_ITENS`: `indice`, `insumo`, `novo_nome`, `novo_unidade`, `novo_subgrupo`, `fator`, com `additionalProperties: false`
    e todos obrigatórios (modo estrito da OpenAI).
  - Casa a resposta por `indice` e limpa com o `limparItens` de `sugestao-insumo.ts`. Índice faltando vira "Cadastrar novo" com a descrição da linha.
- **Porta:** `PedidoLeitura.arquivos` passa a aceitar 0 arquivos (pedido só de texto). Conferido no código: Claude (`blocosClaude`), OpenAI e Gemini
  espalham a lista antes do texto, então `[]` manda só o texto.
- **Quando chamar:** ao carregar um XML (à mão ou por "Conferir"), depois dos vínculos salvos e só com as linhas sem vínculo.
  - Nenhuma linha sem vínculo = nenhuma chamada.
  - Prioridade: vínculo > IA > palavras (`sugerirInsumo`).
  - A tela espera mostrando "Sugerindo insumos…", como no PDF.
  - Mais de 200 linhas: pedidos de 200 em sequência.
- **Sem chave de IA** (503 `PDF_NAO_CONFIGURADO`): segue por palavras, como hoje, sem aviso. **Qualquer outro erro:** segue por palavras e mostra no
  quadro 3 a linha discreta "Sugestão por IA indisponível agora: <frase do erro>." Nunca bloqueia o XML.
- **O que sai para a IA:** só descrição e unidade das linhas, mais a lista de insumos e subgrupos. CNPJ, valores, chave e o XML não saem.
- **Custo** (conta, não medição):
  - entrada ≈ 300 + 10·N + 15·L tokens; saída ≈ 40·L;
  - N = insumos ativos; L = linhas sem vínculo; ~10 tokens por linha "- Nome (UN)" da lista; ~300 de instruções;
  - com N = 300 e L = 30: ≈ 3.750 tokens de entrada e ≈ 1.200 de saída por nota de fornecedor novo;
  - multiplicado pelo preço por token do modelo cadastrado (tabela do provedor, não conferida aqui), fica na ordem de centavos;
  - fornecedor com tudo vinculado custa zero.

## Etapa 1 — Notas da SEFAZ, só leitura

### O que a etapa 1 mostra, e o que fica para a etapa 2

- **Sempre:** o resumo de toda NF-e modelo 55 emitida contra o CNPJ depois da 1ª busca: fornecedor, CNPJ/CPF, número e série (da chave), emissão, valor,
  autorização e situação. E o **cancelamento**, mesmo de nota anterior à 1ª busca, desde que o cancelamento venha depois dela.
- **Às vezes:** o XML completo e, com ele, o "Conferir". Só quando o destinatário já se manifestou por outro meio, por exemplo o contador dando ciência pelo
  sistema dele ou alguém pelo portal com o certificado. Sem isso a NT entrega só o resumo, então na etapa 1 o "Conferir" **raramente acende**.
- **Nunca nesta etapa:** XML de nota sem manifestação; carta de correção; NFC-e; CT-e; notas anteriores à 1ª busca.
- **"Falta lançar"** se resolve como hoje, por arquivo ou foto. Lançada a nota, a linha vira "Já lançada" sozinha, pela chave ou pela regra A. "Copiar
  chave" ajuda a pedir o XML ao fornecedor ou ao contador. Na etapa 2, a ciência faz o XML chegar de rotina, ~1 h ou mais depois do resumo.

### Abordagens e recomendação

| Ponto | Opções e troca | Recomendação |
|---|---|---|
| Agendamento | (a) Timer na API (`setInterval` de 5 min com `unref`, sem dependência nova); o horário da próxima consulta fica no banco, e reiniciar não a antecipa. (b) Cron do host chamando uma rota: mais uma peça na EC2 dividida, mais um segredo. (c) Só botão: a lista deixa de chegar sozinha. | **(a) + "Buscar agora"** no mesmo relógio, sem nunca furar a espera |
| Exclusão | (a) Trava consultiva `pg_try_advisory_xact_lock(CHAVE_TRAVA_SEFAZ)` em duas transações curtas, com o HTTP fora delas e uma reserva de 65 min gravada antes da rede; é o padrão do `CHAVE_TRAVA_CERTIFICADO`. (b) `SELECT … FOR UPDATE` na linha de estado: equivalente, mas espera em vez de desistir. (c) Nada, confiando numa instância só. | **(a)**. Trava não obtida = tique pulado ou `SEFAZ_OCUPADA` |
| Transporte | (a) `node:https` + envelope por modelo de texto. (b) Biblioteca SOAP: mais dependências e WSDL lido em tempo de execução. | **(a)**; a NFC-e reaproveita |
| Leitor de XML | (a) `@xmldom/xmldom` 0.9.12: sem dependências, de 21/08/2026, a mais nova no registro do npm em 16/11. (b) `fast-xml-parser`. (c) Regex: frágil. | **(a)** com versão exata, num adaptador só, recusando DOCTYPE e com teto de tamanho |
| Dados | (a) Estado + consultas + documentos crus + caixa. (b) Só a caixa: perde o reprocessamento e a prova das esperas. (c) Arquivos em disco: fora do backup. | **(a)**. "Lançada" é **derivado**, nunca gravado |
| Fluxo | (a) Caixa na Entrada de Notas + a mesma conferência de hoje. (b) Tela separada. (c) Lançar sem conferir: proibido. | **(a)** |

### Ciclo

O timer acorda a cada 5 min e olha o banco; "Buscar agora" chama o mesmo código.

1. **Condições:**
   - ambiente ≠ `desligado` e busca ligada para (ambiente, CNPJ da empresa);
   - `agora ≥ proxima_consulta_em` e `agora ≥ bloqueado_ate`;
   - `em_andamento_desde` vazio ou com mais de 2 min;
   - `emUso()` sem erro;
   - CNPJ da empresa válido e com o mesmo CNPJ-base do certificado.
2. **Transação 1, sob a trava:** confere tudo de novo; fecha como `interrompida` a consulta anterior que ficou aberta; cria a linha em `sefaz_consultas`;
   grava `em_andamento_desde = agora` e `proxima_consulta_em = agora + 65 min` (reserva pessimista).
3. **Fora de transação:** `distribuirPorNsu(…)`.
4. **Transação 2, sob a trava:**
   - grava cada `docZip` cru, com `ON CONFLICT (ambiente, cnpj, nsu) DO NOTHING`;
   - fecha a consulta;
   - aplica a tabela de retornos (`ult_nsu`, `max_nsu`, agenda, situação) e limpa `em_andamento_desde`;
   - só grava texto e números, sem interpretar XML, para nunca falhar depois de a SEFAZ responder.
5. **Classificação:** processa os documentos com `processado_em` vazio, um por transação. Se um falhar, o erro vai para `erro_processamento` e para o
   log, e ele é tentado de novo no tique seguinte.
6. **Mais páginas:** com 138 e `ultNSU < maxNSU`, volta ao passo 2 na hora, até 10 páginas por ciclo. Passadas as 10, `proxima_consulta_em = agora` e o
   próximo tique continua.

### Detectores de outro sistema (decisão 1)

- **D1 — indício.** A 1ª consulta do (ambiente, CNPJ), com `ultNSU = 0`, devolve 138 com documentos. Pela §3.4, o 1º uso daria 137. Logo, alguém usou a
  distribuição deste CNPJ-base nos últimos 60 dias. **Não para.** Mostra o aviso âmbar: "A SEFAZ já tinha notas separadas para este CNPJ: algum
  sistema buscou notas dele nos últimos 60 dias. Se for o do contador e ele ainda busca, a SEFAZ vai bloquear os dois; nesse caso a busca daqui se
  desliga sozinha e avisa."
- **D2 — conflito.** Vem 656 com `ultNSU` devolvido maior que o nosso, e a consulta anterior foi respondida e gravada (ou esta é a 1ª consulta). Ou
  seja, alguém avançou a sequência. O sistema adota o valor devolvido, grava a lacuna `outro_sistema` (exceto na 1ª consulta) e **desliga a busca**
  (`parada_conflito`). Custo: 1 h de bloqueio para os dois sistemas, que não dá para evitar sem perguntar antes.
- **Queda nossa, não D2.** Se a consulta anterior ficou `sem_resposta` ou `interrompida`, o mesmo 656 pode ser apenas a resposta que se perdeu. O sistema
  adota o valor, grava a lacuna `resposta_perdida` e **não desliga**. Se for mesmo outro sistema, o próximo 656 cai em D2.

### Classificação (pura, `notas-sefaz/classificacao.ts`)

- **`resNFe`:** cria ou atualiza a caixa com emitente (CNPJ ou CPF), nome, `dhEmi`, `dhRecbto`, `vNF`, `tpNF`, `cSitNFe`, e número e série tirados da chave.
  Nunca devolve uma `cancelada` para `autorizada`.
- **`procNFe`:**
  - destinatário (CNPJ ou CPF) diferente do nosso → só o cru, com "não é destinatário";
  - senão → anexa `documento_completo_id`, `finNFe` e `natOp`.
- **`resEvento`/`procEventoNFe` com `tpEvento` 110111:** `situacao_sefaz = cancelada` e `cancelada_em`. Sem resumo anterior, cria a linha a partir do
  evento e da chave. Os demais eventos ficam só como cru.
- **`docZip` que não descompacta ou passa de 4 MB:** documento `ilegivel` com o base64. O NSU avança assim mesmo.

### Situação de cada nota (derivada na leitura, nunca gravada)

Precedência, da mais forte para a mais fraca:

1. `cancelada_depois_de_lancada`: cancelada e lançada (pela chave ou pela regra A). Só some com "Ciente", que é Ignorar com o motivo
   `cancelamento_conferido`. **Qualquer outro "Ignorar" não esconde o cancelamento.**
2. `ignorada`.
3. `cancelada`.
4. `denegada`.
5. `ja_lancada`: chave igual.
6. `parece_lancada`: regra A.
7. `falta_lancar`.

- **"A conferir"** mostra 1, 6 e 7. **"Todas"** mostra tudo.
- **`pode_conferir`** = produção + XML completo + situação 6 ou 7.
- **`nao_parece_compra`** = `tpNF = 0` ou `finNFe = 4`. É só uma etiqueta.
- **Faixa:** "N nota(s) lançada(s) foram CANCELADAS pelo fornecedor na SEFAZ. Confira o estoque e as contas." Conta as linhas na situação 1.
- **Onde mora a leitura:** o módulo `notas` exporta `notasLancadas({ chaves, emitentes })`, uma consulta só. A regra fica em `common/fiscal`.

### Retornos e falhas → ação → o que o admin vê

As frases são fixas. O código de retorno vai para o log e para `sefaz_consultas`.

| Situação | Ação | Frase na caixa / no painel |
|---|---|---|
| `CertificadoErro` (ausente, ilegível, vencido, de outro CNPJ) | não chama; tenta no tique seguinte | a frase de `MSG_USO` / `msgOutroCnpj` |
| CNPJ da empresa vazio ou inválido | não chama | "Preencha o CNPJ da empresa em Configurações." |
| CNPJ-base do certificado ≠ o da empresa | não chama | "O certificado digital é de outra empresa (CNPJ-base diferente). A SEFAZ recusaria a busca." |
| 138 com `ultNSU < maxNSU` | adota o `ultNSU`; busca a página seguinte na hora | — |
| 137, ou 138 com `ultNSU == maxNSU` | adota o `ultNSU`; próxima em +65 min (devolvido menor que o nosso: mantém o nosso e registra no log) | "Última busca HH:MM (N novas / nada novo) · próxima a partir de HH:MM" |
| 108, 109, ou HTTP 5xx sem SOAP | +65 min | "A SEFAZ está fora do ar. Nova tentativa às HH:MM." |
| Falha antes de enviar (DNS, conexão recusada, handshake TLS, servidor não confiável) | +15, +30 e depois +60 min (`falhas_seguidas`) | "Não consegui falar com a SEFAZ. Nova tentativa às HH:MM." |
| Enviado sem resposta (tempo esgotado, conexão caída, resposta ilegível ou acima do teto) | mantém os +65 da transação 1 (pode ter sido 137); consulta `sem_resposta`; na 3ª seguida, `parada_configuracao` | a mesma frase / "A busca parou: a SEFAZ respondeu algo que o sistema não entende, 3 vezes seguidas. Avise o suporte." |
| 656 sem `ultNSU` maior | `bloqueado_ate` +65; o 2º em 24 h desliga (`parada_656`) | "A SEFAZ pediu para esperar. Próxima busca às HH:MM." / "A SEFAZ bloqueou a busca duas vezes em 24 horas. A busca foi desligada; avise o suporte." |
| 656 com `ultNSU` maior, logo depois de consulta sem resposta | adota; lacuna `resposta_perdida`; +65 | "Uma resposta da SEFAZ se perdeu: N documentos não foram baixados. As notas desse intervalo entram por arquivo ou foto." |
| 656 com `ultNSU` maior, depois de consulta respondida **ou na 1ª consulta** (D2) | adota; lacuna `outro_sistema` (nenhuma na 1ª); desliga (`parada_conflito`) | "Outro sistema também está buscando as notas deste CNPJ na SEFAZ (provavelmente o do contador). Com dois sistemas, a SEFAZ bloqueia os dois por 1 hora. A busca foi desligada: fale com o contador antes de ligar de novo." |
| 280–286, 473, HTTP 403 | desliga (`parada_certificado`) | "A SEFAZ recusou o certificado digital (código N). Confira o certificado em Configurações e ligue a busca de novo." |
| 593 | desliga (`parada_configuracao`) | "A SEFAZ diz que o CNPJ consultado não é da mesma empresa do certificado (código 593). Confira o CNPJ em Configurações." |
| 214, 215, 238, 239, 252, 402, 404, 489, 589, 999, outros | não avança; desliga (`parada_configuracao`) | "A busca parou por um erro de configuração (código N). Avise o suporte." |

**Outras frases:**
- Busca desligada há mais de 50 dias: "A busca está desligada há N dias. Com 60 dias sem buscar, a SEFAZ para de separar as notas deste CNPJ, e as do
  intervalo não voltam."
- Certificado sem `clientAuth` em `x509.keyUsage` (aviso, não bloqueia): "O certificado não indica uso para autenticação de cliente; a SEFAZ pode recusá-lo
  (código 280)."
- Depois da 1ª busca: "Primeira busca feita. A SEFAZ passa a separar as notas deste CNPJ a partir de agora; as emitidas antes não aparecem aqui."

### Modelo de dados

Migração `notas_sefaz`. Nomes em pt-BR, snake_case. Datas em `timestamptz`; nenhuma coluna `date` nova, então o `DATE_ONLY_KEYS` não muda.

**`sefaz_distribuicao`** — uma linha por (ambiente, CNPJ):
- PK: `ambiente text CHECK IN ('producao','homologacao')` + `cnpj char(14) CHECK ~ '^[0-9A-Z]{12}[0-9]{2}$'`.
- `busca_ligada boolean NOT NULL DEFAULT false`.
- `situacao text NOT NULL DEFAULT 'ok' CHECK IN ('ok','parada_certificado','parada_configuracao','parada_conflito','parada_656')`, `mensagem`, `aviso`.
- `ult_nsu bigint NOT NULL DEFAULT 0 CHECK ≥ 0`, `max_nsu bigint`.
- Agenda: `primeira_consulta_em`, `ultima_consulta_em`, `proxima_consulta_em`, `bloqueado_ate`, `em_andamento_desde`, `falhas_seguidas int NOT NULL DEFAULT 0`.
- Autoria: `alterada_por uuid`, `alterada_por_nome`, `alterada_em`, `criada_em`.
- CNPJ ou ambiente novo = linha nova, desligada.

**`sefaz_distribuicao_historico`** (só inserção): `ambiente`, `cnpj`, `evento CHECK IN ('ligada','desligada','parada_automatica')`, `situacao`, `c_stat`,
`mensagem`, `feito_por`, `feito_por_nome`, `feito_em`.

**`sefaz_consultas`** — só inserção, mais o fechamento da própria linha; é a prova de que as esperas foram respeitadas:
- `ambiente`, `cnpj`, `servico CHECK IN ('distNSU')` (cresce nas etapas futuras), `origem CHECK IN ('agendada','botao')`, `iniciada_por`, `iniciada_por_nome`.
- `ult_nsu_enviado`, `iniciada_em`, `terminada_em`.
- `resultado CHECK IN ('respondida','falha_antes_de_enviar','sem_resposta','interrompida')`.
- `c_stat`, `x_motivo`, `dh_resp`, `ult_nsu`, `max_nsu`, `documentos`, `erro_code`.
- Volume: parada, faz 24 h ÷ 65 min ≈ 22 consultas por dia, ≈ 8 mil por ano.

**`sefaz_lacunas`**: `ambiente`, `cnpj`, `nsu_de`, `nsu_ate`, `causa CHECK IN ('outro_sistema','resposta_perdida')`, `consulta_id`, `detectada_em`,
`preenchida_em` (fica para a etapa do `consNSU`).

**`sefaz_documentos`** — só inserção; é também a guarda do XML:
- `ambiente`, `cnpj`, `nsu bigint`, `schema`.
- `tipo CHECK IN ('resNFe','procNFe','resEvento','procEventoNFe','outro','ilegivel')`.
- `chave varchar(44)`, `tp_evento varchar(6)`, `xml text`, `conteudo_bruto` (só em `ilegivel`), `consulta_id`.
- `recebido_em`, `processado_em`, `erro_processamento`.
- UNIQUE (`ambiente`, `cnpj`, `nsu`); índice em `chave`.
- Volume, supondo 60 notas por mês: 720 resumos por ano, menos de 1 MB. A etapa 2 soma 720 × ~10 KB (NT §3.3) ≈ 7 MB por ano.

**`notas_sefaz`** — a caixa; `id uuid`; UNIQUE (`ambiente`, `chave`):
- `cnpj_destinatario char(14)`.
- `chave varchar(44) CHECK ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'`.
- `emitente_cnpj varchar(14)` (CNPJ ou CPF), `emitente_nome`.
- `numero` e `serie`, `text NOT NULL`, tirados da chave e sem zeros à esquerda.
- `emitida_em`, `autorizada_em`, `valor_total numeric(15,2)`, `tp_nf smallint`, `fin_nfe smallint`, `nat_op`.
- `situacao_sefaz CHECK IN ('autorizada','denegada','cancelada')`, `cancelada_em`.
- `resumo_id` e `documento_completo_id`, ambos FK para `sefaz_documentos`.
- Ignorar: `ignorada_em`, `ignorada_por`, `ignorada_por_nome`, `motivo_ignorar CHECK IN ('lancada_de_outro_jeito','nao_e_compra','nao_reconheco',
  'cancelamento_conferido','outro')`, `motivo_texto`.
  - CHECK: ignorada ⇔ motivo.
  - CHECK: `outro` ⇒ texto preenchido.
  - Essas colunas guardam a última ação. Cada "Ignorar" e "Reabrir" também vai para o log estruturado.
- `criada_em`, `atualizada_em`.
- Índices: (`ambiente`, `emitida_em DESC`) e (`emitente_cnpj`, `numero`).

**`notas_entrada`**: coluna nova `repetida_de uuid REFERENCES notas_entrada(id) ON DELETE SET NULL` e índice em `fornecedor_cnpj`. A origem `'sefaz'`
entra no `@IsIn` do DTO; o banco não tem CHECK de origem.

**No fio:** o interceptor já converte `bigint` em número. Um NSU de 15 dígitos é menor que 2^53 e chega exato à tela.

### Rotas

Todas com `@AdminOnly()`, todas no `permissoes-protecao.spec.ts`; a lista da loja não muda. Rotas estáticas antes das `:id`; `:id` passa pelo
`ParseUuidPipe`. A lista e as ações valem sempre para o ambiente e o CNPJ atuais. Com o servidor em `desligado`, só a situação responde (com
`{ ambiente: 'desligado' }`); todas as outras dão 503 `SEFAZ_DESLIGADA` "A busca de notas na SEFAZ não está ativada neste servidor."

- **`GET /v1/notas-sefaz/situacao`** → `{ ambiente, cnpj, busca_ligada, situacao, mensagem, aviso, ultima_consulta, proxima_consulta_em, bloqueado_ate,
  em_andamento, lacunas, dias_sem_buscar, certificado: { ok, mensagem, avisos }, contagem: { falta_lancar, parece_lancada, cancelada_depois_de_lancada } }`.
- **`PUT /v1/notas-sefaz/configuracao`** `{ busca_ligada }` → a situação. Grava quem fez e uma linha no histórico.
  - Erros: 422 `SEFAZ_SEM_CNPJ`, `SEFAZ_CERTIFICADO_OUTRA_EMPRESA` ou os códigos do certificado (frases da tabela acima).
- **`POST /v1/notas-sefaz/buscar`** → 202 `{ iniciada: true }`; a tela relê a situação a cada 3 s enquanto houver busca em andamento.
  - 409 `SEFAZ_AGUARDE` "A SEFAZ só permite nova busca a partir de 15:10."
  - 409 `SEFAZ_OCUPADA` "Já existe uma busca em andamento."
  - 409 `SEFAZ_BUSCA_DESLIGADA` "A busca na SEFAZ está desligada. Ligue em Configurações → Notas da SEFAZ."
- **`GET /v1/notas-sefaz?filtro=a_conferir|todas&limite=`** (padrão 100, máximo 500, por emissão decrescente). Cada linha traz a situação derivada,
  `lancada`, `parecidas`, `pode_conferir`, `nao_parece_compra` e `ignorada`.
- **`GET /v1/notas-sefaz/:id/xml`** → o `procNFe` em `text/xml`.
  - 404 `SEFAZ_SEM_XML` "A SEFAZ ainda não liberou o XML desta nota. Dê entrada pelo arquivo ou pela foto."
  - 409 `SEFAZ_HOMOLOGACAO` "Nota de teste (homologação) não entra no estoque."
  - 409 `SEFAZ_CANCELADA` "Esta nota foi cancelada pelo fornecedor e não entra no estoque."
- **`POST /v1/notas-sefaz/:id/ignorar`** `{ motivo, texto? }` → 400 sem motivo, ou com `outro` sem texto.
- **`POST /v1/notas-sefaz/:id/reabrir`**.
- **Partes 0, A e B:** `GET /v1/notas/repetidas`; `POST /v1/notas` com `confirmar_repetida?` e `origem: 'sefaz'`; `POST /v1/notas/sugerir-insumos`.

### A porta, o transporte e o que a NFC-e reaproveita

```ts
// modules/sefaz/transporte-soap12.ts — sem regra de negócio; a NFC-e reusa com outra URL e outra action
export interface ChamadaSoap12 {
  url: string; action: string;      // a action vai no Content-Type (SOAP 1.2)
  corpo: string;                    // o conteúdo do <soap12:Body>, já serializado, sem prefixo de namespace (rejeição 404)
  certificado: CertificadoEmUso;    // key = chavePrivada.export({ type: 'pkcs8', format: 'pem' }) só no ponto de uso; cert = folha + cadeia
  confianca: string[];              // PEM: tls.rootCertificates + âncoras ICP-Brasil (CADEIA_ICP, exportado pelo módulo do certificado)
  tempoLimiteMs: number;            // 30_000
  tetoRespostaBytes: number;        // 16 MB
}
export function chamarSoap12(c: ChamadaSoap12): Promise<string>; // corpo da resposta HTTP 200, ou lança SefazErro

// modules/sefaz/distribuicao.port.ts
export const SEFAZ_DFE = Symbol('SEFAZ_DFE');
export type AmbienteSefaz = 'producao' | 'homologacao';            // tpAmb 1 | 2
export interface DocumentoDistribuido { nsu: bigint; schema: string; xml: string | null; bruto: string | null } // bruto só se não descompactou
export interface RespostaDistribuicao {
  cStat: number; xMotivo: string; dhResp: string; ultNsu: bigint | null; maxNsu: bigint | null; documentos: DocumentoDistribuido[]; // 0–50
}
export class SefazErro extends Error {    // não é HttpException; mensagem = frase fixa, sem corpo de resposta nem material do certificado
  constructor(message: string, readonly code: 'SEFAZ_REDE' | 'SEFAZ_TLS' | 'SEFAZ_TEMPO' | 'SEFAZ_HTTP' | 'SEFAZ_RESPOSTA_INVALIDA',
              readonly enviado: boolean, readonly httpStatus?: number) { super(message); }
}
export interface SefazDfePort {
  /** Uma chamada `distNSU` ao AN. Não decide QUANDO chamar: as esperas da NT 2014.002 §3.11.4 são do serviço. */
  distribuirPorNsu(cert: CertificadoEmUso, ambiente: AmbienteSefaz, cnpj: string, ultNsu: bigint): Promise<RespostaDistribuicao>;
}
```

**Transporte:**
- TLS 1.2 ou superior; `rejectUnauthorized` sempre ligado (um teste procura `false` em `modules/sefaz`); `agent: false`; 30 s de tempo limite.
- Só HTTP 200 vale. O Fault do SOAP 1.2 vem como 500 e vira `SEFAZ_HTTP` com `enviado`.
- `enviado` é falso quando o erro acontece antes do `secureConnect` e verdadeiro depois.

**Leitor:** `xml-leitura.ts` é o único arquivo que importa `@xmldom/xmldom` (0.9.12 exato).
- Recusa `<!DOCTYPE` e `<!ENTITY` antes de ler; tem teto de tamanho.
- Busca os elementos pelo nome local.
- O `docZip` passa por `gunzipSync` com `maxOutputLength` de 4 MB.

**Módulos:**
- `modules/sefaz/`, infraestrutura: `transporte-soap12.ts`, `xml-leitura.ts`, `distribuicao.port.ts`, `distribuicao.adapter.ts` (envelope, leitura,
  `docZip`) e o falso dos testes.
- `modules/notas-sefaz/`, aplicação: `agenda.ts` (puro: retorno → ação), `classificacao.ts`, `situacao-nota.ts`, o serviço do ciclo e da caixa, o
  agendador e o controller.
- A NFC-e reaproveita transporte, confiança, leitor e as frases 280–286. Acrescenta só autorizar/cancelar, nas URLs da SEFAZ-SP, e a assinatura da
  etapa 2, que também serve para `infNFe`.

**Agendador:** `OnApplicationBootstrap`/`OnModuleDestroy`; só existe com ambiente ≠ `desligado`.
- 1º tique 1 min depois do boot; depois, a cada 5 min (`unref`).
- Um tique por vez no processo, além da trava no banco.
- Erro vai para o log e nunca derruba a API.
- Log estruturado: `sefaz.distribuicao`, com origem, ambiente, `cStat`, documentos, `ultNSU`, `maxNSU` e duração. Nunca o XML.

### Variáveis de ambiente

- **`SEFAZ_DFE_AMBIENTE`** = `desligado` (padrão) | `homologacao` | `producao`.
  - Validada pelo zod em `env.validation.ts`.
  - No `docker-compose.prod.yml` entra como `${SEFAZ_DFE_AMBIENTE:-}`; o padrão vem do zod.
  - Documentada no `api/.env.example`.
  - Só vira `producao` com o "eu autorizo" do dono.
- **O resto são constantes no código**, porque vêm da NT e não devem ser ajustadas em produção: espera de 65 min (1 h da NT + 5 min de folga), tique de
  5 min, 10 páginas por ciclo, tempo limite de 30 s, tetos de 16 MB e 4 MB, `cUFAutor` 35.

## Etapa 2 — Respostas à SEFAZ: ciência automática, confirmação, "Não reconheço" e prazo de 90 dias (entrega 3, desligada)

Reescrita em 17/11/2026 com as decisões do dono do mesmo dia e a pesquisa `2026-11-17-pesquisa-ciencia-e-nfce.md` (Parte A). Nada é enviado à SEFAZ
até o 1º teste real (roteiro no fim do plano da entrega 3). Na tela, "manifestação" vira **"respostas à SEFAZ"** (UX §8).

### Decisões do dono (17/11/2026, por escrito; substituem as 4 e 5 de 16/11)

| # | Decisão | Onde entra |
|---|---|---|
| 1 | Ciência da Operação (210210) **automática**. | Planejador: nota nova, autorizada, de compra, até 9 dias. |
| 2 | Ao dar entrada numa nota vinda da SEFAZ, o Comanda registra a **Confirmação da Operação (210200)** sozinho. | Planejador: nota da caixa lançada pela chave. |
| 3 | Botão **"Não reconheço"** na aba (Desconhecimento da Operação, 210220). | Cartão da nota e diálogo "Ignorar". |
| 4 | **Aviso antes dos 90 dias** para as notas com ciência que sobrarem sem resposta final. | Faixa, cartão e painel. |
| 5 | Tudo nasce **desligado** e só liga depois de o contador concordar; a tela e o README dizem isso. | Variável + botão; textos da UX §8; README. |

### Por que a ciência pede o resto (conferido na pesquisa, A.2 e A.5)

- Ciência: até **10 dias** da autorização (596 fora do prazo) [P: Ajuste SINIEF 07/05, cl. 15ª-C § 4º; NT 2020.001 §4].
- Registrada a ciência, **fica obrigatória** uma resposta final (210200, 210220 ou 210240) [P: cl. 15ª-C § 5º]. A NT 2020.001 §3.D acrescenta "nos casos de
  obrigatoriedade"; o conflito das duas leituras é do contador.
- Resposta final: até **90 dias da autorização** desde 01/06/2026 [P: Ajuste 14/26; NT 2020.001 v1.60 §3.D]. Passados 90 dias sem resposta, vale como
  Confirmação [P: § 6º], com ou sem ciência.
- Cada resposta final pode ser registrada até 2 vezes (`nSeqEvento` até 2), vale a última, até 30 dias da 1ª [P: Ajuste 43/23; NT 2020.001 §3.E e regra
  H02]. A ciência só tem `nSeqEvento` 1 e é recusada depois de uma resposta final (655, H06).
- Só a Confirmação impede o fornecedor de cancelar a nota [P: NT 2020.001 §3.A].

### Decisões do construtor (*minha*)

1. **Um controle só, "Responder à SEFAZ"**, por (ambiente, CNPJ), cobre as quatro decisões. Motivo: o OK do contador é um só, e duas chaves dobram os
   estados da tela e dos testes. Se o contador aceitar só uma parte, separar é uma coluna a mais.
   - Variável nova `SEFAZ_MANIFESTACAO` = `desligada` (padrão; ausente ou vazia) | `ligada`. `ligada` com `SEFAZ_DFE_AMBIENTE` em `desligado` derruba a
     subida (contradição de configuração, como valor desconhecido). Os eventos usam o **mesmo ambiente** da busca.
   - Ligar pede as mesmas conferências de "Ligar a busca" (ambiente, CNPJ, certificado da mesma raiz), mas **não** pede a busca ligada. Busca desligada
     ou parada não para a fila: a ciência só acontece para notas da caixa, e uma resposta final já pedida tem de sair.
   - CNPJ ou ambiente novo = linha nova, desligada (como a busca). Desligar não apaga a fila: o que estava "na fila" espera.
2. **"Dar entrada" nunca fala com a SEFAZ nem escreve na fila.** O lançamento continua local e na transação de hoje. A Confirmação é **derivada** pelo
   planejador no tique seguinte (≤ 5 min): nota da caixa com chave igual a uma nota lançada **depois** de ligar as respostas, por qualquer caminho (Conferir,
   XML, PDF ou foto). Assim a SEFAZ nunca impede um lançamento, a falha vira nova tentativa limitada, e não há dependência circular entre `notas` e
   `notas-sefaz`. Nota lançada antes de ligar não é confirmada sozinha.
3. **"Ignorar" e os eventos** (só com as respostas ligadas e a nota "respondível", ver o planejador):

   | Motivo (tela) | Evento | Como |
   |---|---|---|
   | "Já lancei de outro jeito" (e o toque "É a mesma nota") | 210200 | Sempre: é o mesmo caso do "Dar entrada" (decisão 2). |
   | "Não é compra" | 210200 opcional | Caixa "Avisar a SEFAZ que a compra aconteceu", desmarcada (1 toque): compra real que não vai para o estoque. |
   | "Não reconheço esta nota" (e o botão "Não reconheço…") | 210220 | Sempre, com o texto do que acontece e o botão "Avisar a SEFAZ e ignorar". Sem `xJust`. |
   | "A compra não aconteceu" (motivo novo `compra_nao_aconteceu`) | 210240 | Justificativa obrigatória, 15 a 255 caracteres. |
   | "Outro motivo" | nenhum | Como hoje. |

   Com as respostas desligadas, o "Ignorar" é exatamente o da entrega 2 e "A compra não aconteceu" não aparece.
4. **210240 entra.** O aviso dos 90 dias empurra o admin a fechar cada nota com ciência, e cada caso precisa de uma saída verdadeira. O caso comum de
   restaurante, "conheço o fornecedor, mas recusei a entrega ou o pedido foi cancelado e ele não cancelou a nota", não tem saída honesta só com 210200 e
   210220: "Não reconheço" seria falso, e o silêncio vira Confirmação (§ 6º). Custo pequeno: a mesma porta, um `xJust` e um campo no diálogo.
5. **Desfazer e reabrir.** Evento pedido pelo admin espera **60 s** na fila (`enviar_apos`), então o "Desfazer" de 8 s sempre o encontra "na fila" e o
   cancela. "Voltar para a lista" também cancela um evento ainda na fila. Depois de sair, não há volta aqui: "Voltar para a lista" só mostra a nota de
   novo, com a resposta registrada. **Nada de retificação nesta entrega:** `nSeqEvento` é sempre 1; registrada uma resposta final (nossa), o Comanda não
   manda outra para a mesma chave, nem a Confirmação automática de um "Dar entrada" posterior. A tela diz "para mudar, fale com o contador (a SEFAZ aceita
   corrigir uma vez, em até 30 dias)".
6. **Fila própria.** Uma remessa (lote) de até 20 eventos por tique de 5 min, sob a trava `CHAVE_TRAVA_SEFAZ_EVENTOS = 7_011_171_202`, com o diário em
   `sefaz_eventos_lotes` (nunca em `sefaz_consultas`, cuja agenda conta toda linha do (ambiente, CNPJ)). Volume: 60 notas por mês ≈ 120 eventos.
7. **Código desconhecido nunca repete:** no evento = recusa definitiva daquela nota; no lote = as respostas param (desligam).
8. **Sem validador de XSD obrigatório.** `libxmljs2` é nativo e pesado; `xmllint` não está instalado nesta máquina (conferido em 17/11) e não é garantido
   na imagem. Os testes conferem o XML montado contra os padrões copiados dos esquemas (lista em "Montagem"). O desenho do cupom usa o `xmllint` como
   oráculo opcional, quando instalado; aqui não.
9. **Prazo e aviso:** prazo final = `autorizada_em` (ou `emitida_em`, se faltar) + 90 dias; a data aparece em **toda nota respondível** (o silêncio vira
   Confirmação com ou sem ciência); o aviso (âmbar no cartão, faixa e painel) só a partir do 80º dia (faltam 10 ou menos) e só para as notas com
   **ciência nossa registrada** e sem resposta final registrada (decisão 4); passado o prazo, a nota mostra "a SEFAZ considera a compra confirmada" e não aceita
   mais resposta (o servidor recusa com `SEFAZ_PRAZO_PASSOU`).

### Planejador (puro, `notas-sefaz/respostas-plano.ts`)

Roda no tique, depois da busca e da classificação, com as respostas ligadas. Para cada nota da caixa do (ambiente, CNPJ):

- **"Respondível"** = `situacao_sefaz = autorizada` · `tp_nf = 1` · dentro do prazo final · sem resposta final ativa (na fila, enviando, registrada ou
  falhou). Nota de saída (`tp_nf = 0`), cancelada ou denegada nunca recebe evento.
- **210210 (ciência):** respondível · `agora − autorizada_em ≤ 9 dias` · situação `falta_lancar` ou `parece_lancada` (não ignorada) · sem XML completo
  (`documento_completo_id` nulo: se já chegou, alguém já respondeu) · nenhuma ciência nossa (de qualquer situação, menos `cancelada`).
- **210200 automático (`dar_entrada`):** respondível · lançada pela **chave** (`ja_lancada`) · `notas_entrada.created_at ≥ ligada_em` das respostas.
- Resposta final pedida para uma nota com ciência ainda **na fila** = a ciência é cancelada (seria 655 depois).
- Saída: os eventos a criar, a ordem de envio (finais primeiro; depois ciências pela autorização mais antiga, que vence antes) e, por nota, o
  `prazo_final`, `prazo_perto` (≥ 80º dia) e `prazo_passou`.

### Fila e envio (`notas-sefaz/respostas.service.ts`)

1. **Condições** (sem rede): ambiente ≠ `desligado` · `SEFAZ_MANIFESTACAO=ligada` · respostas ligadas e `situacao = ok` · `agora ≥ pausa_ate` ·
   `emUso()` sem erro e da mesma raiz do CNPJ · relógio: se a última consulta respondida da busca (24 h) mostra `|dhResp − terminada_em| > 2 min`, não
   envia (margem nossa; a SEFAZ tolera 5 min).
2. **T1, sob a trava:** fecha como `interrompida` o lote que ficou aberto e devolve os eventos dele à fila; aplica o planejador (insere os automáticos);
   escolhe até 20 eventos `na_fila` com `enviar_apos ≤ agora`; para cada um, gera `dh_evento` e o XML **assinado** e grava `enviando` + o XML +
   `tentativas + 1` **antes** de a rede sair; cria a linha do lote com `id_lote` = milissegundos do relógio (13 dígitos).
3. **Fora de transação:** `SefazEventosPort.enviarLote(…)`.
4. **T2, sob a trava:** aplica `decidirLote` (puro, `notas-sefaz/respostas-agenda.ts`) a cada evento e ao lote; grava `c_stat`, `x_motivo`, `n_prot`,
   `dh_reg_evento` e o `retEvento` de cada um; fecha o lote.
5. **Nunca em laço:** um lote por tique; nenhuma repetição imediata; cada evento tem no máximo **3 tentativas** que contam (enviado e sem resposta útil, ou
   999); 108/109, 656, relógio e falha antes de enviar não gastam tentativa, mas sempre põem `pausa_ate` no futuro; três lotes seguidos sem resposta
   legível = as respostas param. "Tentar de novo" (evento `falhou`) é ação do admin e zera as tentativas daquele evento.

### Retornos → ação → o que o admin vê

`cStat` com 3 ou 4 dígitos (`^[0-9]{3,4}$`); `nProt` com 15 ou 17 (`^[0-9]{15}([0-9]{2})?$`; outro formato = sem protocolo + alerta no log) [P: NT
2025.002 §5.1; `tiposBasico_v1.03.xsd`]. O `retEvento` casa com o evento por (`chNFe`, `tpEvento`, `nSeqEvento`); evento nosso sem `retEvento` num 128
volta à fila e gasta tentativa. Frases exatas na UX §8.

**Lote (`retEnvEvento` e transporte):**

| Situação | Ação |
|---|---|
| 128 | lê cada `retEvento` |
| 108, 109 | todos voltam à fila sem gastar tentativa; `pausa_ate` +60 min; "fora do ar" |
| HTTP 5xx sem SOAP Fault, ou com Fault `Receiver` | como 108/109, mas conta na sequência de lotes sem resposta útil (o 3º seguido para, `parada_configuracao`) |
| HTTP 5xx com Fault `Sender`, `VersionMismatch`, `MustUnderstand` ou `DataEncodingUnknown` | a SEFAZ recusou o nosso pedido (action ou corpo): voltam sem gastar; param (`parada_configuracao`) |
| 656 (*precaução*: a NT 2020.001 não lista para eventos) | voltam sem gastar; `pausa_ate` +65; o 2º em 24 h para (`parada_656`) |
| falha antes de enviar (DNS, TLS, recusa) | voltam sem gastar; recuo 15, 30 e 60 min (`falhas_seguidas`) |
| enviado sem resposta útil (tempo, queda, ilegível, teto) | voltam **gastando** tentativa (o reenvio de um registrado volta 573); `pausa_ate` +15; o 3º lote seguido assim para (`parada_configuracao`) |
| 280–286, HTTP 403 | voltam sem gastar; param (`parada_certificado`) |
| 214, 225, 252, 402, 404, 516, 517, 587, 588 | defeito nosso: voltam sem gastar; param (`parada_configuracao`) |
| 999 | voltam gastando; `pausa_ate` +15 |
| outro código ou outro HTTP 4xx | param (`parada_configuracao`), com o código na frase |

**Evento (`retEvento/infEvento`):**

| Código | Estado do evento | Efeito |
|---|---|---|
| 135, 136 | `registrada` | 136 = nota ainda não vinculada no AN; o XML completo pode demorar mais |
| 573 | `registrada` | duplicidade = o mesmo evento já existia (reenvio depois de queda); pode vir sem protocolo |
| 655 (só ciência) | `recusada` | já existe resposta final de outro sistema ou do portal; nenhuma ciência e nenhum aviso de prazo para a nota |
| 650, 651 | `recusada` | nota cancelada ou denegada |
| 596 | `recusada` | fora do prazo |
| 575 | `recusada` | a nota não é para este CNPJ |
| 236, 496, 614–619 | `recusada` | chave inválida |
| 577, 578, 579 | volta à fila sem gastar | relógio; `pausa_ate` +60; o 2º lote seguido com relógio para (`parada_relogio`) |
| 250 | volta sem gastar; param (`parada_configuracao`) | `cOrgao` 91 recusado: rever (pesquisa A.1) |
| 213, 290–296 | volta sem gastar; param (`parada_certificado`) | certificado da assinatura |
| 252, 489, 490, 491–493, 572, 594, 595, 297, 298 | volta sem gastar; param (`parada_configuracao`) | defeito nosso (Id, esquema, assinatura, ambiente) |
| 999 | volta gastando | até 3; depois `falhou` |
| outro | `recusada` | "código N"; não repete |

### Montagem, assinatura e porta (`modules/sefaz/`)

- **Endereços** [P: Relação de Serviços Web, 17/11]: produção `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx`; homologação
  `https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx`.
- **SOAP 1.2 sem cabeçalho** [P: MOC 7.0 §4.2; NT 2016.002 §1.1–2.4]. O `soap12:Body` leva **direto** `<nfeDadosMsg
  xmlns="http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4">` (sem o elemento da operação que a distribuição usa); action
  `http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento`; resposta em `nfeResultMsg` [S: cópia pública do WSDL do SVRS,
  `akretion/nfelib`, `nfe/wsdl/v4_0/recepcaoevento4.wsdl`, lida em 17/11; conferir no 1º teste]. O `chamarSoap12` da entrega 2 ganhou a opção
  `envelope: 'sem_prefixo'`, usada só pelos eventos: `<Envelope xmlns="http://www.w3.org/2003/05/soap-envelope"><Body>`, sem nenhum prefixo em
  escopo. Por quê: a C14N inclusiva leva ao elemento assinado os `xmlns:*` declarados nos ancestrais; com o envelope da distribuição
  (`xmlns:soap12`, `xsi`, `xsd`), quem confere a assinatura no documento recebido calcularia outro digest. Provado no teste do corpo real
  (`eventos.adapter.spec.ts`, os bytes que o transporte de verdade manda): com o envelope prefixado nenhuma das assinaturas confere; sem
  prefixo, todas conferem no documento inteiro e em cada evento sozinho. Sem a opção, a distribuição manda os bytes de sempre. O 1º teste
  real confere se o AN aceita esse envelope.
- **Evento** (um documento por evento, depois juntados no lote): `<evento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><infEvento
  Id="ID{tpEvento}{chave}01">` com, nesta ordem, `cOrgao` 91, `tpAmb` 1/2, `CNPJ` do destinatário, `chNFe`, `dhEvento`, `tpEvento`, `nSeqEvento` 1,
  `verEvento` 1.00 e `detEvento versao="1.00"` com `descEvento` e, só no 210240, `xJust`. `Signature` logo depois de `</infEvento>`, dentro de `evento`.
  Lote: `<envEvento xmlns="http://www.portalfiscal.inf.br/nfe" versao="1.00"><idLote>…</idLote>` + 1 a 20 `evento`.
- **Padrões conferidos nos testes** [P: `leiauteEvento_v1.00.xsd` do 010d v1.03; `e210200`/`e210210`/`e210220`/`e210240_v1.00.xsd` do pacote de 2014]:
  - `Id` `ID[0-9]{12}[0-9A-Z]{12}[0-9]{28}`; `chNFe` `[0-9]{6}[0-9A-Z]{12}[0-9]{26}`; `CNPJ` `[0-9A-Z]{12}[0-9]{2}`; `idLote` `[0-9]{1,15}`; até 20 eventos;
  - `dhEvento` `AAAA-MM-DDThh:mm:ss-03:00` (fuso obrigatório, minutos `00`, sem `Z`); `tpEvento` `[0-9]{6}`; `nSeqEvento` `[1-9][0-9]?`;
  - `descEvento` exatamente "Confirmacao da Operacao", "Ciencia da Operacao", "Desconhecimento da Operacao" ou "Operacao nao Realizada";
  - `xJust` de 15 a 255 caracteres, só U+0020–U+00FF, sem espaço nas pontas (`[!-ÿ]{1}[ -ÿ]{0,}[!-ÿ]{1}`). Aspas e travessões do teclado do celular
    viram `'`, `"` e `-`; espaços repetidos e quebras de linha viram um espaço; sobrou caractere fora da faixa = 400 com frase.
- **Assinatura — interface FIXA** (a NFC-e usa igual), em `modules/sefaz/assinatura-xml.ts`:
  ```ts
  export function assinarXmlEnveloped(xml: string, idDoElemento: string, cert: CertificadoEmUso): string;
  ```
  - XMLDSig *enveloped* [P: MOC 7.0 §4.2.4; `xmldsig-core-schema_v1.01.xsd`, algoritmos `fixed`]: C14N `http://www.w3.org/TR/2001/REC-xml-c14n-20010315` +
    `enveloped-signature`; `rsa-sha1` com digest `sha1`; `Reference URI="#{Id}"`; `KeyInfo/X509Data/X509Certificate` **só da folha** (DER em base64);
    nada de `KeyValue`, `X509IssuerSerial` ou `X509SubjectName`; `Signature xmlns="http://www.w3.org/2000/09/xmldsig#"` sem prefixo, irmã do elemento.
  - Feita com `node:crypto` (`crypto.sign('RSA-SHA1', …, cert.chavePrivada)`, a chave como `KeyObject`, nunca exportada) e o leitor de `xml-leitura.ts`.
    C14N restrita ao que NF-e e eventos usam: um namespace padrão, sem prefixos, sem comentários nem instruções de processamento no elemento
    (outra coisa = erro de frase fixa). O elemento leva o `xmlns` herdado do pai, como manda a C14N inclusiva.
  - `xml-crypto` **6.4.0** (publicada em 14/10/2026), versão exata, só como devDependency e só nos testes, de oráculo nos dois sentidos. Traz
    `@xmldom/xmldom` 0.8.x como dependência dela, só no ambiente de desenvolvimento.
  - SHA-256: nenhum cronograma encontrado [N]; trocar = mudar as duas URIs e o nome do hash.
- **Porta** (`modules/sefaz/eventos.port.ts`), separada; a distribuição não muda:
  ```ts
  export const SEFAZ_EVENTOS = Symbol('SEFAZ_EVENTOS');
  export type TipoEvento = '210200' | '210210' | '210220' | '210240';
  export interface RetornoEvento { chave: string | null; tpEvento: string | null; nSeq: number | null; cStat: number; xMotivo: string;
    nProt: string | null; dhRegEvento: string | null; xml: string }
  export interface RespostaLoteEventos { cStat: number; xMotivo: string; retornos: RetornoEvento[] } // 0–20 retornos
  export interface SefazEventosPort {
    /** Um `nfeRecepcaoEvento` ao AN com 1–20 eventos JÁ assinados (gravados antes). Lança SefazErro. Não decide quando enviar. */
    enviarLote(cert: CertificadoEmUso, ambiente: AmbienteSefaz, idLote: bigint, eventosAssinados: string[]): Promise<RespostaLoteEventos>;
  }
  ```
- **Confiança:** o host de produção do evento é `www`, não o `www1` da distribuição: Let's Encrypt, cadeia até **ISRG Root X1**, que troca a folha a
  cada ~90 dias [P: crt.sh e aperto de mão do portal, pesquisa A.3]. Conferido em 17/11 no Node 20.19.4 local: `tls.rootCertificates` tem ISRG Root X1
  (SHA-256 `96:BC:EC:06:…:08:C6`, vale até 2035) e não tem `Root YR`. Como o `ca` = raízes do Node + ICP, um teste fixa a X1 pela impressão digital; no
  Node 22 da imagem, o 1º teste real confere de novo.

### Dados (migração `notas_sefaz_respostas`, nova; as antigas não mudam)

- **`sefaz_manifestacao`** (uma linha por ambiente + CNPJ, nasce desligada): `ligada bool`, `situacao CHECK IN ('ok','parada_certificado',
  'parada_configuracao','parada_656','parada_relogio')`, `mensagem`, `pausa_ate`, `falhas_seguidas`, `ligada_em` (base do 210200 automático), autoria
  (`alterada_por`, `alterada_por_nome`, `alterada_em`), `criada_em`.
- **`sefaz_distribuicao_historico.evento`** passa a aceitar também `respostas_ligadas`, `respostas_desligadas` e `respostas_paradas` (troca do CHECK).
- **`sefaz_eventos_lotes`** (diário, só inserção mais o fechamento): `ambiente`, `cnpj`, `id_lote`, `iniciado_em`, `terminado_em`, `resultado` (os quatro
  da consulta), `c_stat`, `x_motivo`, `eventos`, `erro_code`.
- **`sefaz_manifestacoes`** (uma linha por evento; a situação muda, o resto não): `nota_sefaz_id`, `ambiente`, `cnpj`, `chave`, `tp_evento`,
  `n_seq` (1–2; esta entrega só usa 1), `x_just` (só e sempre no 210240, 15–255), `origem CHECK IN ('ciencia_automatica','dar_entrada','admin')`,
  `pedida_por`, `pedida_por_nome`, `pedida_em`, `enviar_apos`, `situacao CHECK IN ('na_fila','enviando','registrada','recusada','falhou','cancelada')`,
  `tentativas` (0–3), `lote_id`, `dh_evento`, `c_stat` (100–9999), `x_motivo`, `n_prot` (15 ou 17 dígitos), `dh_reg_evento`, `xml_evento` (o assinado),
  `xml_retorno`, `impressao_digital` (do certificado que assinou), `criada_em`, `atualizada_em`.
  - Únicos parciais: (ambiente, chave, tp_evento, n_seq) fora de `cancelada`; e **uma resposta final ativa por chave**: (ambiente, chave) com `tp_evento <>
    '210210'` e situação em `na_fila`, `enviando`, `registrada` ou `falhou`. Duas abas ou um "Dar entrada" depois de um "Não reconheço" esbarram aqui.
  - `xml_evento` traz o certificado público da folha: fica no banco, nunca em log nem em resposta da API.
- **`notas_sefaz.motivo_ignorar`** aceita também `compra_nao_aconteceu` (troca do CHECK).

### Rotas (todas `@AdminOnly()`; a lista da loja não muda)

- `GET /v1/notas-sefaz/situacao` ganha `respostas`: `{ disponivel, ligadas, situacao, mensagem, pausa_ate, ligadas_por_nome, ligadas_em, na_fila,
  falharam, prazos_perto }` (`prazos_perto` = as notas no aviso, a que vence primeiro antes, como `canceladas_depois`).
- `PUT /v1/notas-sefaz/respostas` `{ ligadas }` → a situação. 503 `SEFAZ_RESPOSTAS_DESLIGADAS` com a variável desligada; 422 como em "Ligar a busca".
  Ligar zera `falhas_seguidas` e grava `ligada_em`; ligar e desligar nunca mexem em `pausa_ate` nem na fila.
- `GET /v1/notas-sefaz` → cada linha ganha `resposta: { ciencia, final, prazo_final, prazo_perto, prazo_passou, pode_responder }`.
- `POST /v1/notas-sefaz/:id/ignorar` ganha `avisar_sefaz?: boolean` e o motivo `compra_nao_aconteceu` (texto = justificativa). Nota e evento na mesma
  transação. Erros: 409 `SEFAZ_RESPOSTAS_NAO_LIGADAS`, `SEFAZ_JA_RESPONDIDA`, `SEFAZ_PRAZO_PASSOU`, `SEFAZ_NAO_RESPONDIVEL`; 400 da justificativa.
- `POST /v1/notas-sefaz/:id/reabrir` cancela o evento pedido pelo admin que ainda está na fila.
- `POST /v1/notas-sefaz/:id/responder-de-novo` → o evento `falhou` da nota volta à fila com 0 tentativas.

### Verificação da etapa 2 (detalhe no plano da entrega 3)

jest sem rede: assinatura contra o `xml-crypto` (verifica a nossa; a nossa `SignatureValue` é igual à dele, byte a byte), montagem contra os padrões dos
esquemas, leitura dos retornos (fixtures fictícias 128/135/573/108), cada linha das duas tabelas acima, planejador com relógio injetado (9 dias, 90 dias,
80º dia, ligada depois do lançamento), fila com porta falsa (gravado `enviando` antes da porta, queda entre T1 e T2, Desfazer, duas finais), rotas e
permissões. Smoke com `SEFAZ_MANIFESTACAO=ligada` e sem certificado: nenhuma linha de lote nem de evento além das semeadas. Browser-check com as duas
variáveis vazias e tudo "ligado" por `page.route`.

## Verificação

### jest

Sem rede, por `scripts/run-capped.sh 1500` com `npx jest --runInBand <arquivos>`. Prisma falso em memória, como em `certificado-digital.service.spec.ts`.

- **`common/fiscal`:**
  - chave com letras: formato, DV e o vetor do Anexo da NT Conjunta;
  - partes da chave e normalizadores;
  - regra A: zeros à esquerda, série só de um lado, CPF, sem CNPJ.
- **Leitura:** chave com DV errado → `null`; emitente normalizado.
- **Notas:**
  - `CHAVE_INVALIDA`;
  - `DUPLICADO` igual a hoje;
  - 409 `NOTA_REPETIDA`, e o `confirmar_repetida` grava `repetida_de`;
  - Configurações recusa CNPJ inválido.
- **`sugerir-insumos`, com `LEITOR_PDF` falso:**
  - o pedido sai sem arquivo, sem CNPJ, valores ou chave;
  - a resposta casa por índice; índice faltando vira "Cadastrar novo";
  - sem chave de IA, 503.
- **`agenda.ts`, com relógio injetado:** cada linha da tabela de retornos, D1, D2 (inclusive na 1ª consulta), resposta perdida e dois 656.
- **Classificação**, com `docZip` fictícios gerados no teste (gzip + base64):
  - `resNFe`;
  - `procNFe` de destinatário e de não destinatário;
  - 110111 antes e depois do resumo;
  - chave alfanumérica;
  - gzip acima do teto e DOCTYPE.
- **Adaptador:**
  - envelope igual a um vetor fixo: `soap12`, sem prefixo no `distDFeInt`, `ultNSU` com 15 dígitos, `Content-Type` com a action;
  - respostas da NT §6 (589, 137, 138) em `fixtures`.
- **Transporte**, contra um HTTPS local do próprio teste (127.0.0.1, sem rede externa; certificados fictícios de servidor e cliente acrescentados ao
  `gerar-certificados-teste.sh`):
  - mTLS exigido;
  - servidor fora da confiança recusado;
  - tempo esgotado;
  - `enviado` certo;
  - teto de resposta.
- **Ciclo, com porta falsa:**
  - 138 → 137;
  - queda entre as transações: nada antes de +65 min;
  - os três casos de 656;
  - botão com a trava ocupada → `SEFAZ_OCUPADA`;
  - ambiente ou busca desligada → nenhuma chamada à porta.
- **`permissoes-protecao.spec.ts`:** rotas novas só para admin; a lista da loja igual.

### Smoke

`api/scripts/smoke-capped.sh`, banco descartável, com `SEFAZ_DFE_AMBIENTE=producao` no ambiente da API do smoke.

Duas barreiras impedem qualquer chamada à SEFAZ: a busca semeada desligada e o banco sem certificado. Semeia `sefaz_distribuicao`, `notas_sefaz` e
`sefaz_documentos` direto por SQL e percorre:

- situação, caixa e XML;
- `POST /v1/notas` com origem `sefaz` → "Já lançada";
- repetida: 409 → confirmar → 201;
- ignorar sem motivo = 400, e reabrir;
- "cancelada depois de lançada", que não some com Ignorar comum;
- "Buscar agora" com a busca desligada = 409;
- loja = 403 em todas as rotas novas;
- os CHECKs e o UNIQUE de NSU no banco.

O 409 `SEFAZ_HOMOLOGACAO` e o 503 `SEFAZ_DESLIGADA` ficam no jest.

### Navegador

`web/scripts/browser-check.sh`: caixa e painel em 390 px e no desktop.

### 1º teste real

Com o dono presente, o certificado verdadeiro e no servidor. Cada passo só com o "eu autorizo" dele.

0. **Antes:** certificado conferido, CNPJ salvo e a frase da decisão 1 lida para o dono.
1. **Homologação.** `SEFAZ_DFE_AMBIENTE=homologacao`, ligar, "Buscar agora". Esperado: 137 (1º uso). Este passo fecha os pontos abertos:
   - registrar o emissor do certificado TLS do `hom1`;
   - ver se o SOAP 1.2 foi aceito (erro de versão ou de envelope = plano B, 1.1);
   - nenhum 593 confirma o CNPJ-base;
   - 280–286 ou 473 = problema no certificado.
2. **Homologação, 2º clique antes de 65 min.** Esperado: 409 `SEFAZ_AGUARDE`, sem rede. Depois dos 65 min, o tique sozinho; esperado 137 de novo, sem 656.
3. **Produção.** `producao`, ligar, uma busca. Esperado: 137.
   - 138 com documentos = D1.
   - 656 com `ultNSU` = D2: desliga e avisa.
   - Vigiar `sefaz_consultas` por 24 h: nenhum 656.
4. **Dias depois.** Uma nota que chegou como resumo e foi lançada por arquivo tem de virar "Já lançada".

## Riscos

- **Outro sistema na mesma sequência.** A decisão 1 não bloqueia a ativação. O D2 desliga a busca no 1º 656 com `ultNSU` maior, mas esse 656 já custou
  1 h de bloqueio aos dois sistemas. Talvez a 1ª consulta (`ultNSU = 0`) já dê 656 (*não confirmado*).
- **Resposta perdida vira lacuna.** Sem `consNSU` na etapa 1, os resumos do intervalo não aparecem. As notas entram por arquivo ou foto, e a tela diz
  quantas faltaram.
- **Regra dos 60 dias.** Notas de antes da 1ª busca não vêm, e mais de 60 dias desligado deixa um buraco sem volta. Mitigação: aviso a partir de 50 dias.
- **Etapa 1 com pouco XML.** O valor está na lista do que falta lançar e no aviso de cancelamento; o "Conferir" de rotina depende da etapa 2.
- **Certificado que nosso cadastro aceita e a SEFAZ recusa:** sem SAN CNPJ = 473, sem clientAuth = 280, sem LCR = 286. Mitigação: aviso de `clientAuth`
  e o passo 1.
- **Emissor do certificado TLS do AN.** Mudou três vezes em dois anos, e o último de `www1` no CT venceu em 29/10/2026. Mitigação: `ca` com as duas
  famílias de raízes. Uma falha aqui aparece como "Não consegui falar com a SEFAZ" e não consome a sequência (`enviado` falso).
- **SOAP 1.2** escolhido a partir de cópias de terceiros do WSDL. Plano B: 1.1.
- **xmldom com muitos alertas em 2026.** Mitigação: versão exata, adaptador único, DOCTYPE recusado e `npm audit` no PR.
- **Nota repetida:**
  - falso positivo (mesmo número em séries diferentes, quando um lado não tem série) → só aviso;
  - falso negativo (foto sem CNPJ ou sem número) → não confere.
- **IA:** sugestão errada aparece sempre como "sugestão — confira". Cada nota de fornecedor novo custa uma chamada.
- **CNPJ em Configurações agora validado.** Pode recusar um valor antigo digitado errado. É de propósito: a SEFAZ usa esse CNPJ.
- **Etapa 2 — a ciência cria dever.** Cada ciência pede uma resposta final em 90 dias (cl. 15ª-C § 5º). Mitigação: tudo desligado até o OK do contador,
  confirmação automática no lançamento, aviso a partir do 80º dia, e as três saídas (confirmar, não reconheço, não aconteceu).
- **Etapa 2 — silêncio vira Confirmação** (§ 6º), inclusive de nota que a empresa não reconhece. Mitigação: "Não reconheço" na aba e o aviso do prazo.
- **Etapa 2 — outro sistema também responde** (contador ou portal). Nosso 210200 sobre um 210220 dele vira retificação e passa a valer o nosso (vale o
  último). Só sabemos do que nós enviamos; 655 e 573 cobrem parte. Mitigação: a pergunta ao contador antes de ligar.
- **Etapa 2 — host do evento com Let's Encrypt** (troca de folha a cada ~90 dias; cadeia por ISRG Root X1). Mitigação: X1 fixada por teste; uma troca de
  raiz aparece como "não consegui falar com a SEFAZ" e não gasta tentativa.
- **Etapa 2 — assinatura escrita à mão.** Dois códigos que concordam (o nosso e o `xml-crypto`) ainda podem errar juntos o perfil da SEFAZ. Mitigação:
  vetores do esquema nos testes e o 1º evento real em homologação, com lote de 1.
- **Etapa 2 — SHA-1.** A SEFAZ ainda exige; nenhum cronograma de SHA-256 encontrado [N]. Mitigação: o 1º teste real confere a assinatura SHA-1 no Node 22
  da imagem.

## Não confirmado (passo do 1º teste real ou pesquisa antes da etapa 2)

- Se **uma** repetição do mesmo `ultNSU` depois de uma queda já dá 656. A NT fala em "sucessivas tentativas"; o desenho cobre as duas leituras.
- Se `distNSU` com `ultNSU = 0` dá 656 quando outro sistema já consome.
- Quem emite hoje o certificado TLS de `www1`/`hom1`, e se a raiz dele está no Node 22 da imagem. Passo 1.
- Se o endpoint aceita SOAP 1.2, como diz o WSDL, e se exige `cUFAutor`. Passo 1.
- Se o cancelamento sem manifestação chega como `resEvento` ou `procEventoNFe`. Tratamos os dois.
- Que NFC-e, SAT, CT-e e NFS-e ficam fora: é inferência.
- Para a etapa 2 (pesquisa de 17/11 fechou as NT republicadas, o pacote 010d, os limites e o leiaute):
  - o prazo entre a ciência e o NSU com a NF-e completa (nenhuma NT fixa; relatos de segundos a dias) [N];
  - se `cOrgao` 91 é aceito sem 250 (texto da NT ambíguo) e a action/namespace exatos do WSDL do AN (cópia do SVRS) [S]: 1º teste, homologação;
  - se o `NFeRecepcaoEvento4` devolve 656 por consumo (tratado por precaução) [N];
  - quem emite o certificado TLS de `www.nfe.fazenda.gov.br` no dia, e se a X1 está no Node 22 da imagem: 1º teste;
  - cronograma de SHA-256 [N];
  - a leitura do contador sobre o § 5º ("ciência obriga resposta final"), a multa de SP por não responder, e se o contador já responde por este CNPJ;
  - se trocar de resposta final (210220 → 210200) exige `nSeqEvento` 2 ou aceita 1 (esta entrega não retifica).

## Fontes

- Portal NF-e, Notas Técnicas: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY=
- NT 2014.002 v1.40 (03/07/2026), Distribuição DF-e: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=uWO2d/gTuWg=
- NT 2020.001 v1.60 (23/04/2026), Manifestação do Destinatário: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=%20WTd7iuD21s=
- NT 2026.004 v1.01, CNPJ alfanumérico em eventos e distribuição: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=BTZQzgsO9Ws=
- NT Conjunta 2025.001 v1.00, CNPJ alfanumérico, §5 chave e DV: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=5ZkvIZt10mQ=
- MOC 7.0 (nov/2020): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LrBx7WT9PuA=
- Relação de Serviços Web: produção https://www.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo= · homologação https://hom.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo=
- Esquemas: PL_NFeDistDFe_104 https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=IzuP2y0G6hk= · 010d_v1.01 (não aberto) https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=FOEnx2KAsCk=
- WSDL da distribuição, cópias públicas (secundárias; ramo padrão `master` conferido): https://github.com/akretion/nfelib/blob/master/nfelib/nfe/wsdl/v4_0/nfedistribuicaodfe.wsdl · https://github.com/JuniorPolegato/pole/tree/master/NFe/wsdl/AN
- Certificados TLS do AN no CT (16/11/2026): https://crt.sh/?q=www1.nfe.fazenda.gov.br · https://crt.sh/?q=hom1.nfe.fazenda.gov.br · folha mais nova de `www1`: https://crt.sh/?id=25624206118
- Biblioteca XML (registro npm, 16/11): https://www.npmjs.com/package/@xmldom/xmldom · alertas: https://github.com/advisories?query=xmldom
- Etapa 2: pesquisa `docs/superpowers/specs/2026-11-17-pesquisa-ciencia-e-nfce.md`, Parte A (NT 2020.001 v1.60 §3–§7; Ajuste SINIEF 07/05 cl. 15ª-C;
  Ajustes 14/26 e 43/23; esquemas 010d v1.03 e "Evento Manifesta Destinatário v1.01", com os links) · WSDL do evento, cópia pública do SVRS (secundária):
  https://github.com/akretion/nfelib/blob/master/nfelib/nfe/wsdl/v4_0/recepcaoevento4.wsdl · `xml-crypto` (registro npm, 17/11):
  https://www.npmjs.com/package/xml-crypto
- Secundárias sobre dois sistemas no mesmo CNPJ: https://focusnfe.com.br/blog/rejeicao-656/ · https://www.projetoacbr.com.br/forum/topic/79694-consumo-indevido-em-apenas-um-cliente/
