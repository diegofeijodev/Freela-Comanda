# Pesquisa: Ciência da Operação (evento 210210) e NFC-e em SP — 17/11/2026

Pesquisa só de leitura em fontes públicas (Portal NF-e, CONFAZ, SEFAZ-SP, ENCAT). Nenhum serviço web da SEFAZ foi chamado (nem `?wsdl`).
Complementa `2026-11-16-notas-sefaz-design.md`. Marcas usadas:

- **[P]** conferido na fonte primária (NT, esquema XSD, Ajuste SINIEF, portaria, página oficial da SEFAZ-SP ou do Portal NF-e), com seção/página.
- **[S]** fonte secundária (fórum, blog, fornecedor, cópia de terceiros).
- **[N]** não encontrado / não confirmado.
- **IMPACTO** = muda o desenho existente.

Os PDFs e esquemas foram baixados em 17/11/2026 e lidos com `pdftotext`. As páginas citadas são as do rodapé de cada PDF ("Página x / y").

---

## Parte A — Ciência da Operação (210210) pelo `NFeRecepcaoEvento4` do Ambiente Nacional

### A.0 O que muda no desenho da etapa 2 (resumo)

1. **IMPACTO — a ciência cria uma obrigação.** Registrar a Ciência obriga a registrar depois uma manifestação conclusiva (Confirmação,
   Desconhecimento ou Operação não Realizada) em até 90 dias da autorização. Ligar a ciência automática "para todas as notas" sem um caminho
   para a conclusiva é um risco legal. Ver A.5.
2. **IMPACTO — tabela de retornos incompleta.** Faltam 128 (lote processado), 108/109 (serviço parado), 575 (autor não é o destinatário),
   577/579 (data do evento menor que emissão/autorização), 252, 250, e as rejeições de esquema/Id/chave, que são **definitivas** (não adianta
   tentar 3 vezes). `cStat` pode ter **4 dígitos** e `nProt` **15 ou 17**. (A SEFAZ tolera 5 min no relógio; os 2 min do desenho são uma
   margem nossa, mais rígida, e podem ficar.) Ver A.4.
3. **IMPACTO — validar contra o esquema certo.** O pacote antigo da manifestação (2014) só aceita `Id` numérico (`ID[0-9]{52}`). O
   `envEvento` genérico do pacote 010d (v1.03, 10/07/2026) já aceita CNPJ com letras. Ver A.1.
4. **IMPACTO — o servidor de produção do evento não é o da distribuição.** Produção do evento = `www.nfe.fazenda.gov.br` (Let's Encrypt,
   cadeia até ISRG Root X1); a distribuição usa `www1`. O `ca` do desenho (raízes do Node + ICP) cobre, mas o "passo 3" do 1º teste real
   precisa registrar o emissor deste outro host. Ver A.3.
5. Confirmado sem mudança: SOAP 1.2 sem `nfeCabecMsg`; `envEvento versao="1.00"`; até 20 eventos por lote; `dhEvento` com `-03:00` e sem `Z`;
   assinatura RSA-SHA1 + digest SHA-1 + C14N 2001; prazo da ciência 10 dias. `cOrgao` 91 continua o valor a usar, mas o texto da NT é
   ambíguo (A.1).
6. Sem resposta na fonte primária: o tempo entre a ciência e o NSU novo com o XML completo (A.6).

### A.1 Leiaute do `envEvento` / `infEvento` para o 210210

**O que as NT republicadas em 2026 mudam para o 210210: nada no leiaute.** Conferido em cada uma:

| NT (versão, publicação) | Assunto | Efeito no 210210 | Fonte |
|---|---|---|---|
| 2020.001 v1.60 (23/04/2026) | Manifestação do destinatário | Só muda o **prazo da conclusiva**: 180 → **90 dias** (Ajuste SINIEF 14/26). Teste 15/05/2026, produção **01/06/2026**. Leiaute igual. | [P] NT 2020.001 v1.60, §1 (p. 3), §2 (p. 4), §3.D–E (p. 5) |
| 2021.003 v1.50 (25/09/2026) | GTIN | Nenhum. Amplia o grupo de NCM que valida GTIN (Grupo V, construção civil): teste 01/04/2027, produção 01/09/2027. | [P] §1.6 (p. 5) e cronograma (p. 3) |
| 2023.003 v1.40 (25/09/2026) | CFOP na NFC-e | Nenhum para eventos. Interessa à NFC-e (Parte B). | [P] p. 3–7 |
| 2023.002 v1.02 (27/10/2026) | Fim da autorização assíncrona e da inutilização em AC, BA e SP | Nenhum para eventos. Interessa muito à NFC-e (Parte B). | [P] p. 4–6 |
| 2014.001 v1.41 (04/08/2026) | EPEC (110140) | Nenhum. `tpAutor`, `verAplic` e `cOrgaoAutor` são campos **do `detEvento` do EPEC** (P20–P22), não da manifestação. v1.40/1.41: EPEC vedado a contribuintes do PR e da PB (produção 05/10/2026). | [P] histórico p. 2–4; regras P20-10 e P21-10 p. 11 |
| 2024.003 v1.10 (11/05/2026) | Produtos agropecuários (guias) | Nenhum. | [P] p. 3–4 |
| 2022.002 v1.30a (26/03/2026) | Equiparação à exportação | Nenhum. | [P] p. 3 |
| 2026.004 v1.01 (08/06/2026) | CNPJ alfanumérico nos esquemas | `CNPJ` do autor e `chNFe` passam a tipo C (letras). Teste até 15/06/2026, **produção 01/07/2026**. | [P] §4 (p. 10), cronograma (p. 3) |
| 2026.001 v1.02b (31/07/2026) | PAA (provedor de assinatura) | Cria o grupo **opcional** `infPAA` no `infEvento` (só para quem usa PAA). Não usar. | [P] esquema `leiauteEvento_v1.00.xsd` do 010d v1.03 (`infPAA minOccurs="0"`) |

**Leiaute da entrada (NT 2020.001 v1.60, §6.3.1, p. 10–11) [P]:**

- `envEvento` (raiz) `versao="1.00"` → `idLote` (1–15 dígitos, controle nosso, o serviço não usa) → `evento` (**1 a 20**) `versao="1.00"`.
- `infEvento Id` = `"ID"` + `tpEvento` + chave + `nSeqEvento` (2 dígitos). Ordem dos filhos (esquema genérico): `cOrgao`, `tpAmb`, `CNPJ` ou
  `CPF`, `chNFe`, `dhEvento`, `tpEvento`, `nSeqEvento`, `verEvento`, `detEvento`, [`infPAA` opcional].
- `cOrgao` = **91** (Ambiente Nacional). `tpAmb` 1/2. `CNPJ` = do **autor** (o destinatário). `tpEvento` = 210210. `nSeqEvento` = 1
  ("Informar o valor 1 para este evento", P15). `verEvento` = 1.00.
- `detEvento versao="1.00"` → `descEvento` = `Ciencia da Operacao` (sem acento, valor único no `e210210_v1.00.xsd`). Sem `xJust`.
- `Signature` irmã de `infEvento`, dentro de `evento` (P91, "aplicada no elemento infEvento").
- **Não há** `cOrgaoAutor`, `tpAutor` nem `verAplic` na entrada do 210210 [P: NT 2020.001 §6.3.1; esquema `leiauteEvento_v1.00.xsd` do 010d v1.03].
  No retorno, `cOrgaoAutor` é opcional e "não é preenchido no evento de manifestação" (R22, p. 12).

**Esquemas — qual usar para validar [P]:**

- Pacote **010d_v1.01** (08/06/2026) = três zips (`PL_010d_NT2026.004`, `PL_Evento`, `CadConsultaCadastro`). Já está **superado** pelo
  **010d_v1.03** (10/07/2026). Entre os dois, os `.xsd` de evento são iguais; muda só um comentário do `tiposBasico_v1.03.xsd`
  (`diff` feito em 17/11/2026). O pacote mais novo da lista é o **010h_v1.03** (13/11/2026, NT 2026.005/006/008), que **não** traz evento
  genérico novo.
- No `envEvento` genérico (010d v1.03, `Evento/leiauteEvento_v1.00.xsd`):
  - `Id`: `ID[0-9]{12}[0-9A-Z]{12}[0-9]{28}` (aceita CNPJ com letras na chave);
  - `chNFe` (`TChNFe`): `[0-9]{6}[0-9A-Z]{12}[0-9]{26}`;
  - `CNPJ` (`TCnpjOpc`): `[0-9]{0}|[0-9A-Z]{12}[0-9]{2}`;
  - `evento maxOccurs="20"`; `versao` do lote e do evento = `1\.00`; `cOrgao` aceita 91 (`TCOrgaoIBGE`).
- O pacote específico "Evento Manifesta Destinatário v1.01" (30/05/2014) ainda é o único com o `e210210_v1.00.xsd`, mas o
  `leiauteConfRecebto_v1.00.xsd` dele tem `Id` = `ID[0-9]{52}` (só números).
- **IMPACTO:** se o projeto validar o XML antes de enviar (teste ou oráculo), usar o `envEvento`/`leiauteEvento` **genérico do 010d v1.03**
  para o envelope e o `e210210_v1.00.xsd` de 2014 **só para o `detEvento`**. Validar o envelope inteiro com o pacote de 2014 recusaria chave
  com letras.

**`dhEvento` [P]:** tipo `TDateTimeUTC`, padrão `...T hh:mm:ss` seguido de `[-+](0[0-9]|10|11):00` ou `+12:00`. Ou seja, **fuso obrigatório,
minutos do fuso sempre `00`, sem `Z`** (ex.: `2026-11-17T10:15:00-03:00`). O desenho está certo. [P: `tiposBasico_v1.03.xsd` do 010d v1.03]

**`cOrgao` — ambiguidade registrada:** o texto da NT 2020.001 (P08, p. 11) diz "91 - Ambiente Nacional" e, na mesma célula, "Informar o
código da UF para este evento". A anotação do esquema diz "utilizar 90 para identificar o Ambiente Nacional" (texto genérico copiado). Os
exemplos de terceiros usam 91 [S: fórum ACBr, link nas Fontes]. **Manter 91.** Se o passo de homologação devolver **250** ("UF diverge da UF
autorizadora", regra P08-10), é o sinal para rever.

**CNPJ alfanumérico [P]:** produção desde 01/07/2026 (NT 2026.004 v1.01, cronograma p. 3; §4 p. 10). `CNPJ` do autor e `chNFe` são tipo C.

**Limites:**

- Até **20 eventos** por lote [P: NT 2020.001 P04 (p. 10) e §6.3.3 (p. 13); esquema `maxOccurs="20"`]. O desenho usa 20: ok.
- Tamanho: a NT 2020.001 só cita a rejeição **214** ("Tamanho da mensagem excedeu o limite estabelecido", §6.3.5, p. 13). O número
  **500 KB** está no MOC 7.0 Anexo I, regra B01 do serviço de autorização [P: Anexo I, regra B01]. Para o evento é *inferência* (as regras
  de validação inicial são "idênticas aos demais Web Services"). 20 ciências assinadas ficam muito abaixo disso.

### A.2 Prazos

- **Ciência: até 10 dias** contados da autorização da NF-e [P: Ajuste SINIEF 07/05, cl. 15ª-C, § 4º; NT 2020.001 §4, tabela (p. 5)].
  Fora do prazo = **596** ("Evento apresentado fora do prazo"). O desenho usa 9 dias: ok.
- **Conclusiva: até 90 dias** da autorização desde **01/06/2026** (antes eram 180) [P: Ajuste SINIEF 14/26, cl. 1ª, II, efeitos a partir do 1º dia
  do 2º mês após a publicação no DOU de 09/04/2026 = 01/06/2026; Ajuste 07/05 cl. 15ª-C caput; NT 2020.001 v1.60 §3.D (p. 5)].
- **Retificação:** cada evento conclusivo pode ser registrado até **2 vezes**, vale o último; a retificação cabe em até 30 dias da 1ª
  manifestação [P: Ajuste 07/05 cl. 15ª-C §§ 2º–3º, redação do Ajuste SINIEF 43/23, efeitos 01/08/2024; NT 2020.001 §3.E]. A ciência continua
  com `nSeqEvento` = 1 (regra H02, p. 16).
- **Silêncio:** passados 90 dias sem conclusiva, considera-se ocorrida a operação, "com os mesmos efeitos que o registro Confirmação da
  Operação" [P: Ajuste 07/05 cl. 15ª-C § 6º, redação do Ajuste 14/26, efeitos 01/06/2026].
- **Ciência depois da conclusiva** é rejeitada (**655**) [P: NT 2020.001 regra H06 (p. 16)]. Após a confirmação, o emitente não pode mais cancelar a
  NF-e [P: NT 2020.001 §3.A (p. 4)].

### A.3 Assinatura, transporte e endereços

**Assinatura — continua SHA-1 [P]:**

- MOC 7.0 §4.2.4, Tabela 4-2 (p. 53–54): XMLDSig *enveloped*; `EndCertOnly` (só o certificado do usuário final); RSA
  `http://www.w3.org/2000/09/xmldsig#rsa-sha1`; digest `http://www.w3.org/2000/09/xmldsig#sha1`; transformações *enveloped-signature* e
  C14N `http://www.w3.org/TR/2001/REC-xml-c14n-20010315`. Não incluir `X509SubjectName`, `X509IssuerSerial`, `X509IssuerName`,
  `X509SerialNumber`, `X509SKI`; evitar `KeyValue`/`RSAKeyValue`.
- O `xmldsig-core-schema_v1.01.xsd` dos pacotes **010d v1.03 (10/07/2026)** e **010h v1.03 (13/11/2026)** tem esses três algoritmos como
  `fixed` (`CanonicalizationMethod`, `SignatureMethod`, `DigestMethod`) e as transformações limitadas a *enveloped-signature* e C14N.
  Os dois arquivos são idênticos (`diff`).
- Até a NT 2026.001 (PAA, 2026) usa "RSA SHA1" na `PAASignature` [P: NT 2026.001 v1.02b, p. 6, 11 e 15].
- **Migração para SHA-256: não encontrada** [N]. Procurei na lista de NT vigentes (17/11/2026), nas Informes Técnicos de 2025–2026
  (2026.001, 2026.002, 2026.003, 2025.002 v1.71, 2025.004 v1.20, 2024.001 v2.40, 2023.002 v2.10) e na web. "Não encontrado" não é o mesmo
  que "não existe": vale olhar de novo antes de construir.

**Endereços [P: Portal NF-e, "Relação de Serviços Web", produção e homologação, lidos em 17/11/2026]:**

| Ambiente | `RecepcaoEvento` 4.00 do AN |
|---|---|
| Produção | `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` |
| Homologação | `https://hom1.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` |

O desenho está certo nos dois.

**SOAP [P]:** "padrão SOAP versão 1.2", Document/Literal, TLS 1.2 com autenticação mútua [MOC 7.0 §4.2 (p. 52) e Tabela 4-3 (p. 55)].
**Sem `nfeCabecMsg`** desde o leiaute 4.00: "será eliminado o uso de variáveis no SOAP Header ... para todos os Web Services", incluindo
"RecepcaoEvento – Manifestação do Destinatário" [NT 2016.002 v1.61 §1.1 e §2.2 (p. 15–16)]. Nome do serviço `NFeRecepcaoEvento4`, método
`nfeRecepcaoEvento`, parâmetro de entrada `<nfeDadosMsg>` e de saída `<nfeResultMsg>` [NT 2016.002 §2.3–2.4 (p. 16–17)]. A *action* exata e
o namespace do WSDL **não foram abertos** (abrir `?wsdl` seria chamar o serviço); seguir o mesmo padrão do desenho
(`http://www.portalfiscal.inf.br/nfe/wsdl/NFeRecepcaoEvento4/nfeRecepcaoEvento`) e conferir numa cópia pública do WSDL [N/S].

**IMPACTO — TLS do host de produção do evento.** `www.nfe.fazenda.gov.br` é outro host, diferente do `www1` da distribuição:

- No log CT, os certificados de `www.nfe.fazenda.gov.br` são **Let's Encrypt** desde pelo menos 07/2024. O mais novo foi emitido por `YR1`
  e vale de 24/08 a 22/11/2026 [P: crt.sh, consultado em 17/11/2026].
- O aperto de mão TLS com a página do portal (mesmo host e porta; não é chamada a serviço) apresentou a cadeia
  `YR2` → `ISRG Root YR` → **cruzada por `ISRG Root X1`**, "Verify return code: 0" [P: `openssl s_client` em 17/11/2026].
- O Node 20.19.4 local tem `ISRG Root X1` e `X2`, **não** tem `Root YR`. Funciona enquanto o servidor mandar a cruzada.
- O `ca` do desenho (raízes do Node + âncoras ICP) cobre esse caso. O 1º teste em homologação usa `hom1` (mesma família da distribuição).
  A produção usa `www`, então o "passo 3" do 1º teste real precisa registrar o emissor deste host e saber que ele **troca a cada ~90 dias**.

### A.4 Códigos de retorno

`cStat` do lote vem em `retEnvEvento`; o de cada evento vem em `retEvento/infEvento`.

- **Formato:** desde a NT 2025.002, `cStat` pode ter **3 ou 4 dígitos** (`TStat` = `[0-9]{3,4}`). `nProt` pode ter **15 ou 17** dígitos
  (`TProt`) [P: NT 2025.002 v1.53 §5.1 (p. 11); `tiposBasico_v1.03.xsd` do 010d v1.03]. Segundo a NT, por ora só a SEFAZ-SP usa 17 posições,
  e só na NFC-e (produção 05/10/2026, segundo o portal da SEFAZ-SP).
- **IMPACTO:** guardar `n_prot` como texto de até 17 dígitos e `c_stat` aceitar 4 dígitos.

Tabela conferida na NT 2020.001 v1.60 (§6.3.4–6.3.9 e §7, p. 13–17), salvo marca. "Lote" = cStat do `retEnvEvento`.

| Código | Nível | Significado | Tratamento sugerido |
|---|---|---|---|
| **128** | lote | Lote de evento processado | Ler cada `retEvento`. **IMPACTO:** faltava. |
| 135 | evento | Registrado e vinculado à NF-e | Registrado |
| 136 | evento | Registrado, **não** vinculado (NF-e ainda não existe no AN) | Registrado; o XML pode demorar mais |
| 573 | evento | Duplicidade de evento (`tpEvento`+chave+`nSeq`) | Já manifestada: ok (cobre o reenvio após queda) |
| 655 | evento | Ciência depois da conclusiva (H06) | Ok: já existe conclusiva. O XML completo só é liberado se ela foi Confirmação ou Operação não Realizada; se foi **Desconhecimento**, não (NT 2020.001 §3 A–D) |
| 650 | evento | Ciência de NF-e cancelada ou denegada (H04) | Nota cancelada |
| 596 | evento | Fora do prazo (H03) | "Prazo da ciência passou" |
| 575 | evento | Autor do evento diverge do destinatário (2P21-10) | **IMPACTO:** faltava. Definitivo para a nota (não é nossa). |
| 578 | evento | Data do evento maior que a do processamento; a SEFAZ tolera 5 min (P13-10) | Não reenviar até acertar o relógio. Os 2 min do desenho são margem nossa: ok. |
| 577 / 579 | evento | Data do evento menor que a emissão / a autorização (tolerância 5 min) | **IMPACTO:** faltava. Mesmo tratamento do 578 (relógio). |
| 572 | evento | `Id` ≠ "ID"+tpEvento+chave+nSeq | Defeito nosso: desligar |
| 236, 614–619, 496 | evento | Chave inválida (DV, UF, ano, mês, CNPJ, modelo, número, tpEmis) | Definitivo para a nota |
| 489 / 490 | evento | CNPJ/CPF do autor inválido | Defeito nosso: desligar |
| 594 | evento | `nSeqEvento` maior que o permitido (H02) | Defeito nosso: desligar |
| 491 / 492 / 493 | evento | `tpEvento` / `verEvento` inválido / falha no esquema específico | Defeito nosso: desligar |
| 250 | evento | UF (`cOrgao`) diverge da autorizadora | Rever `cOrgao` (ver A.1) |
| 252 | evento | `tpAmb` diverge do ambiente do serviço | Defeito de configuração: desligar |
| 658 | evento | UF do destinatário diverge (H07) | Não se aplica ao AN (diz a própria regra) |
| 280–286 | lote | Certificado de transmissão (inválido, validade, sem CNPJ, cadeia, revogado, fora da ICP, LCR) | Desligar e avisar |
| 290–296 | evento | Certificado de assinatura (idem) | Desligar e avisar |
| 213 | evento | CNPJ-base do autor ≠ CNPJ-base do certificado | Desligar |
| 227 | evento | CPF do emitente ≠ CPF do certificado | Não se aplica (autor CNPJ) |
| 297 / 298 | evento | Assinatura difere do calculado / do padrão | Defeito nosso: desligar |
| 108 / 109 | lote | Serviço paralisado (curto prazo / sem previsão) | **IMPACTO:** esperar; **não** contar como tentativa |
| 214 | lote | Mensagem grande demais | Defeito nosso |
| 225, 402, 404, 516, 517, 587, 588 | lote | Esquema do lote, codificação ≠ UTF-8, prefixo de namespace, raiz, versão, namespace, caracteres de edição | Defeito nosso: desligar (não "3 tentativas") |
| 999 | lote/evento | Erro não catalogado | Até 3 tentativas |

**IMPACTO no desenho:** a linha "os demais → até 3 tentativas" deve virar "108/109/999 e falhas de rede → nova tentativa; esquema, Id, chave,
certificado e assinatura → desligar e avisar; 575, 596, 650 e os de chave → encerrar só aquela nota".

### A.5 É obrigatório manifestar? Há risco em registrar só a Ciência?

**Quem é obrigado (lista fixa) [P: Ajuste SINIEF 07/05, Anexo II; NT 2020.001 §5 (p. 5–6)]:**

- destinatário de NF-e com grupo de combustíveis (distribuidoras e postos);
- álcool não combustível a granel;
- **distribuidor ou atacadista** que recebe cigarros, bebidas alcoólicas (inclusive cerveja e chope), refrigerantes e água mineral.

Restaurante não está na lista. Mas a cl. 15ª-B § 2º permite que cada UF exija de outros contribuintes. Em SP:

- A norma estadual da NF-e hoje é a **Portaria SRE 80/2025** (DOE 17/11/2025), que **revogou a Portaria CAT 162/08** (art. 17).
- O art. 13 da SRE 80/2025 só manda o destinatário verificar a assinatura e a autorização da NF-e. Não há anexo de manifestação obrigatória
  [P: legislacao.fazenda.sp.gov.br, Portaria SRE 80/2025, lida em 17/11/2026].
- A CAT 162/08 revogada (art. 30, II, e Anexo III) só obrigava a mesma lista do Anexo II nacional (combustíveis, álcool, distribuidor/
  atacadista de cigarro e bebida).
- **Não encontrei norma de SP que obrigue restaurante a manifestar** [N para "não existe"; P para o que foi lido]. Confirmar com o contador.

**IMPACTO — a ciência puxa a conclusiva:**

- O Ajuste 07/05, cl. 15ª-C § 5º, diz: "No caso de registro do evento Ciência da Emissão, **fica obrigatório** o registro, pelo destinatário, de
  um dos eventos do caput desta cláusula" (Confirmação, Desconhecimento ou Operação não Realizada), no prazo de 90 dias [P: texto
  consolidado do CONFAZ, lido em 17/11/2026].
- A NT 2020.001 §3.D (p. 5) repete isso, mas acrescenta "nos casos de obrigatoriedade previstos no Ajuste SINIEF 07/05". O texto do Ajuste é
  incondicional; o da NT parece restringir.
- **Conflito entre as duas leituras: não resolvo; é do contador.**

**Riscos de registrar só a Ciência, automaticamente, para todas as notas:**

1. Pela leitura literal do § 5º, cada ciência cria o dever de uma conclusiva em 90 dias. Sem a conclusiva, o descumprimento é de obrigação
   acessória. A multa estadual específica (RICMS-SP) **não foi pesquisada** [N].
2. O § 6º faz o silêncio virar **Confirmação** em 90 dias, com ou sem ciência. Uma nota **que o restaurante não reconhece** (fraude, erro do
   fornecedor) fica "confirmada" se ninguém registrar o Desconhecimento ou a Operação não Realizada a tempo.
3. A ciência sozinha não impede o fornecedor de cancelar; só a Confirmação impede (NT 2020.001 §3.A).

**Sugestão para o desenho (decisão do dono e do contador):** manter o interruptor desligado por padrão e, se ligar:

- mostrar a cada nota "prazo da manifestação final: dd/mm" (autorização + 90 dias);
- avisar a partir de 80 dias;
- prever na etapa 3 os botões "Confirmar" (210200), "Não reconheço" (210220) e "Operação não realizada" (210240, com justificativa de 15
  a 255 caracteres).

A mesma porta `SefazEventosPort` serve: muda só `tpEvento`, `descEvento` e `xJust`.

### A.6 Quanto tempo entre a ciência e o XML completo?

- **Nenhuma NT fixa esse prazo** [N]. A NT 2020.001 diz só que o registro "disponibiliza ao destinatário da NF-e todos os documentos fiscais
  previstos no item 3 da NT 2014.002" (§3.A, C e D). A NT 2014.002 v1.40 também não traz prazo (já lida no desenho).
- Relatos de terceiros falam em segundos, minutos, horas e às vezes dias. O `procNFe` chega num **NSU novo**, e a consulta por chave logo
  depois da ciência pode trazer só o resumo [S: fórum ACBr; documentação nfe.io; links nas Fontes].
- O desenho já trata isso ("num prazo que a NT não fixa"). Mantém.

---

## Parte B — NFC-e (modelo 65) emitida pelo ERP em SP

### B.0 O que mais pesa para o desenho da tela "Emitir cupom"

1. **IMPACTO — quem "emite cupom" hoje na loja usa NFC-e (ou NF-e).** Em SP o SAT (CF-e) está **proibido desde 01/01/2026**. Antes de ligar
   a nossa emissão, descobrir qual sistema emite hoje, em qual **série** e com qual **CSC**, para não colidir número nem revogar o CSC dele.
   Ver B.1 e B.6.
2. **IMPACTO — autorização síncrona, 1 nota por lote, e prazo de 5 minutos.** NFC-e em SP só por método síncrono (`indSinc=1`, lote com 1
   NFC-e). `dhEmi` não pode ter mais de **5 minutos** de atraso em relação à recepção (704). Ver B.2 e B.3.
3. **IMPACTO — não existe mais inutilização em SP** desde **01/11/2026** (Ajuste SINIEF 38/26). Número pulado fica pulado. Mas há conflito de
   datas e uma regra antiga sobre "buraco = contingência não transmitida" que o contador precisa olhar. Ver B.6.
4. **IMPACTO — QR Code v3 elimina o CSC na emissão normal** (só chave|3|tpAmb). Em contingência, o v3 pede uma assinatura RSA-SHA1 dos
   parâmetros com o mesmo certificado A1. Se SP aceitar v3 (a confirmar em homologação), o ERP não precisa guardar CSC. O v2 com CSC é o plano
   seguro. Ver B.5.
5. **IMPACTO — IBS/CBS: dispensável hoje, necessário em 2027.** A regra que rejeita nota sem o grupo IBSCBS (UB12-10) é "implementação
   futura" em produção, e para CRT 1/2/4 a tributação só começa em 2027. Mas a tela de cupom vai rodar em 2027, e a NT 2026.005 já define
   o que o Simples manda: `cAtivSN` por item e, sem regime regular, o grupo `gTribSN` dentro de `IBSCBS`. **O desenho precisa prever esses
   campos desde a v1** (por produto, escolhidos pelo contador). Falta saber quando a validação começa. Há conflito na data de produção do
   esquema da NT 2026.005: 16/11/2026 pela NT, "adiada para 14/12" segundo o portal da SEFAZ-SP. Ver B.4.
6. **IMPACTO — delivery é "operação não presencial".** Desde 03/08/2026 a NFC-e de operação não presencial exige identificar o comprador
   (CPF/CNPJ) **e o endereço**. Com entrega (`indPres=4`), a SEFAZ rejeita sem destinatário, sem endereço e sem transportador. Ver B.3.
7. **IMPACTO — "pré-conta" da mesa.** Todo papel não fiscal entregue ao consumidor (conta de conferência, pedido) tem de trazer
   "NÃO É DOCUMENTO FISCAL" (desde 01/02/2025). Ver B.7.

### B.1 Situação em SP em 2026 (SAT, obrigatoriedade, credenciamento, CSC)

- **SAT extinto [P]:** Portaria CAT 147/12, art. 34-D: "A emissão do Cupom Fiscal Eletrônico - CF-e-SAT ... fica **vedada a partir de 1º de
  janeiro de 2026**". O artigo foi acrescentado pela Portaria SRE 79/24, de 31/10/2024 (DOE 01/11/2024). A SRE 79/24 também criou o art. 34-C,
  que proíbe ativar novos SAT. Segundo fontes secundárias, o 34-C foi revogado pela Portaria SRE 92/2024 [S].
- **NFC-e obrigatória [P]:** o portal da SEFAZ-SP diz: "A emissão de NFC-e passa a ser obrigatória a partir de 01/01/2026 para todo o varejo
  paulista, em substituição ao CF-e-SAT (mod 59), Nota Fiscal de Venda ao Consumidor (mod 02) e Nota Fiscal de Venda a Consumidor online
  (mod 56)" [portal.fazenda.sp.gov.br/servicos/nfce, lido em 17/11/2026].
- **Alternativa NF-e [P]:** a Portaria SRE 40/2024, art. 1º-A (incluído pela SRE 53/26, efeitos desde 05/10/2026), manda emitir NF-e 55 no
  lugar da NFC-e na hipótese do **Ajuste SINIEF 23/26**: venda a consumidor final, pessoa física ou jurídica, que permita ao comprador
  **aproveitar crédito de ICMS**. Nesse caso pode usar o "DANFE Simplificado Tipo 2". Para restaurante é raro; fica registrado.
- **Norma vigente da NFC-e em SP [P]:** Portaria SRE 40/2024 (DOE 10/07/2024; alterada pelas SRE 81/25 e SRE 53/26; texto atualizado em
  04/11/2026), que revogou a Portaria CAT 12/15.
- **Credenciamento [P]:** prévio e **por estabelecimento** (art. 2º): sistema em `http://nfce.fazenda.sp.gov.br/NFCePortal/`, opção
  "Credenciamento". O estabelecimento fica credenciado a partir da habilitação no ambiente de produção (art. 2º § 3º). Sem credenciamento, a
  SEFAZ rejeita com **781** ("Emissor não habilitado") [P: NT 2023.002 v1.02, regra 1C17-38]. Se outro sistema já emite NFC-e na loja, o
  estabelecimento **já está credenciado** (credenciamento é do CNPJ, não do software).
- **CSC e IdCSC:**
  - [P: portal SEFAZ-SP] "Após o credenciamento, ... é necessário obter o código de segurança através do menu **Gerenciar Cód Segurança**".
  - A página do contribuinte apontada pelo ENCAT para SP é `https://www.nfce.fazenda.sp.gov.br/NFCeSiteContribuinte/` [S/ENCAT].
  - Regras do CSC [P: Manual DANFE NFC-e e QR Code v6.0, §4.6–4.6.1, p. 31–32]:
    - 16 a 36 caracteres alfanuméricos;
    - IdCSC = sequencial de até 6 dígitos, por CNPJ-base;
    - no máximo **2 CSC válidos** por empresa na UF; para pedir um 3º, é preciso revogar um dos dois;
    - homologação usa CSC próprio.
  - **IMPACTO:** o CSC é da empresa (CNPJ-base), não do software. Se o outro sistema já usa um CSC, o ERP pode usar o mesmo ou o segundo.
    **Nunca revogar** o CSC do outro sistema.

### B.2 Serviços web da NFC-e em SP

Fonte: [P] página "WebServices" do portal da SEFAZ-SP (lida em 17/11/2026), igual à lista do ENCAT.

| Serviço (versão 4.00) | Produção | Homologação |
|---|---|---|
| NFeAutorizacao4 | `https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx` | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx` |
| NFeRetAutorizacao4 | `https://nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx` | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRetAutorizacao4.asmx` |
| NFeConsultaProtocolo4 | `https://nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx` | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeConsultaProtocolo4.asmx` |
| NFeRecepcaoEvento4 (cancelamento) | `https://nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx` | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeRecepcaoEvento4.asmx` |
| NFeStatusServico4 | `https://nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx` | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeStatusServico4.asmx` |
| NFeInutilizacao4 | `https://nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx` (ver B.6: não se aplica mais em SP) | `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeInutilizacao4.asmx` |
| EPEC (só quando a SEFAZ ativa) | `https://nfce.epec.fazenda.sp.gov.br/EPECws/RecepcaoEPEC.asmx` | `https://homologacao.nfce.epec.fazenda.sp.gov.br/EPECws/RecepcaoEPEC.asmx` |

Observações:

- **Os hosts da NFC-e de SP são outros.** `nfce.fazenda.sp.gov.br` ≠ `nfe.fazenda.sp.gov.br` (NF-e) ≠ AN. O emissor do certificado TLS desses
  hosts **não foi conferido** [N]. O transporte do desenho (raízes do Node + ICP) precisa de um "passo 1" próprio em homologação.
- **Síncrono [P]:** o portal da SEFAZ-SP diz "O ambiente de autorização da NFC-e está apto a autorizar através do método síncrono".
  - NFC-e: lote só com 1 nota (126) desde 04/09/2023 [NT 2023.002 v1.02, §3.1].
  - Pedido assíncrono (`indSinc=0`) para lote de 1 nota é rejeitado com 452 desde 13/10/2025 [NT 2025.001 v1.03, GAP03a-3].
  - A NT 2023.002 v1.02 elimina toda autorização assíncrona: regra GAP03a-6 (129), teste até 01/02/2027, **produção 05/04/2027**.
  - **Usar sempre `indSinc=1`**; o `NFeRetAutorizacao4` não é necessário.
- **SOAP 1.2, sem `nfeCabecMsg`** (mesmas fontes de A.3). Método `nfeAutorizacaoLote`, entrada `nfeDadosMsg`, saída `nfeResultMsg`
  [NT 2016.002 §2.3–2.4]. Mensagem até **500 KB** (214) [MOC Anexo I, B01].
- **Contingência EPEC em SP [P]:** página "Contingência" da SEFAZ-SP: "Em produção, a contingência EPEC só será ativada pela SEFAZ nas
  situações de indisponibilidade do ambiente normal de autorização". A contingência do dia a dia é a **off-line** (B.5).
- **Novo retorno 120 [P]:** "Autorizado o uso da NF-e, com alerta" (NT 2026.002 v1.11, §2.1; produção 05/10/2026). Hoje só na NFC-e,
  quando o destinatário identificado por CNPJ está irregular. **IMPACTO:** tratar 120 como autorizada e mostrar o alerta
  (`cMsg`/`xMsg`).
- **Protocolo de 17 dígitos [P]:** a SEFAZ-SP passou a usar `nProt` com 17 posições na NFC-e em **05/10/2026** (portal SEFAZ-SP;
  NT 2025.002 §5.1).

### B.3 Leiaute 4.00 mínimo para venda de restaurante sem identificar o consumidor

Base: esquema `leiauteNFe_v4.00.xsd` do pacote **010h v1.03** (13/11/2026) e regras do modelo 65 no MOC 7.0 Anexo I, com as alterações da
NT 2026.002 [P]. "Obrig." = obrigatório no esquema ou em regra de rejeição.

**`ide`:**

| Campo | Valor | Fonte/regra |
|---|---|---|
| `cUF` | 35 | |
| `cNF` | 8 dígitos gerados pelo emitente | Ajuste 19/16 cl. 4ª III. "Aleatório e diferente do número" é boa prática, não regra conferida aqui |
| `natOp` | ex. "VENDA" | |
| `mod` | 65 | |
| `serie` | faixa do aplicativo do contribuinte: **000–889** | NT 2023.002 v1.02 §4.1 |
| `nNF` | sequencial por estabelecimento e série | Ajuste 19/16 cl. 4ª II |
| `dhEmi` | com fuso (`-03:00`) | Atraso > 5 min na emissão normal = **704** (B09-40) |
| `dhSaiEnt` | **não informar** | 705 (B10-10) |
| `tpNF` | 1 | 706 |
| `idDest` | 1 | |
| `cMunFG` | Valinhos = **3556206** | IBGE, conferido na API do IBGE |
| `tpImp` | 4 (DANFE NFC-e) ou 5 (só eletrônico) | 709 (B21-10) |
| `tpEmis` | 1, ou 9 em contingência | |
| `cDV` | DV da chave | |
| `tpAmb` | 1 ou 2 | |
| `finNFe` | 1 | 715 (B25-20) |
| `indFinal` | 1 | 716 (B25a-10) |
| `indPres` | 1 = presencial; 4 = não presencial com entrega; 5 = presencial fora do estabelecimento | 717 (B25b-20, redação NT 2026.002) |
| `indIntermed` | obrigatório quando `indPres` = 2, 3, 4 ou 9 (0 = sem intermediador; 1 = com, e então o grupo `infIntermed`) | 434/435 (B25c-10/20) |
| `procEmi` | 0 | 957 (B26-50) |
| `verProc` | versão do ERP | |
| `dhCont` + `xJust` | **só em contingência** (`tpEmis=9`) | |

Campos novos opcionais da RTC (`cMunFGIBS`, `cIndOp`, `gCompraGov`): não usar agora.

**`emit`:** `CNPJ`, `xNome`, `enderEmit` (`xLgr`, `nro`, `xBairro`, `cMun`, `xMun`, `UF`, `CEP`), `IE`, `CRT` (1 se for Simples). Não pode ter
`IEST` (718). `tpRegimeIBSCBS` não informar (B.4).

**`dest`:** opcional (0..1). Obrigatório quando:

- valor ≥ R$ 10.000,00, ou outro limite da UF [P: Ajuste 19/16 cl. 4ª VII a; NT 2026.002, W16-40, produção 15/06/2026, "será criada tabela
  com os limites por UF"]. O limite de SP **não foi encontrado** [N];
- o consumidor pede (cl. 4ª VII b);
- **operação não presencial**, com endereço: Ajuste 19/16 cl. 4ª VII c, redação do **Ajuste SINIEF 9/26, efeitos 03/08/2026** (antes era só
  "entrega em domicílio"). Com `indPres=4`, a SEFAZ rejeita:
  - sem identificação: **787** (E01-20);
  - sem endereço: **788** (E05-20);
  - sem `transporta`: **786** (X03-20, MOC Anexo I de 2020). A NT 2026.002 reescreveu as regras de transporte da NFC-e e não cita a X03-20;
    **se ela ainda vale: não confirmado** [N].

**`det` (cada item) — `prod`:**

- `cProd`, `xProd`.
- `NCM` (8 dígitos) [cl. 4ª V].
- `cEAN` e `cEANTrib` = **"SEM GTIN"** para prato sem código de barras. Bebida com código de barras = o GTIN, validado no CCG
  [NT 2021.003 v1.50; Ajuste 19/16 cl. 4ª VI].
- `CEST` quando a mercadoria está na lista de ST (cl. 4ª VIII).
- `CFOP` (B.8), `uCom`, `qCom`, `vUnCom`, `vProd`, `uTrib`, `qTrib`, `vUnTrib`.
- `vDesc`/`vOutro` por item quando houver; `indTot` = 1.
- Em homologação, o `xProd` do **1º item** tem de ser "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" (**373**, I04-10).

**`det` — `imposto`:**

- `ICMS` com o grupo do CSOSN (Simples) ou do CST (Normal).
- **PIS e COFINS são opcionais na NFC-e**: no esquema são `minOccurs=0`, e as regras que exigem os grupos (Q01-20 e S01-20) só valem para o
  modelo 55.
- `IBSCBS` opcional hoje (B.4).
- Proibidos na NFC-e:
  - IPI (742), II (743), PIS-ST (746), COFINS-ST (749);
  - ICMS de partilha (741), ICMSUFDest (807), repasse de ST (740).

**`total/ICMSTot`:** todos os campos `vBC` … `vNF` são obrigatórios no esquema (zeros quando não houver).

- `vNF` = `vProd` − `vDesc` − `vICMSDeson` + `vST` + `vFCPST` + `vFrete` + `vSeg` + `vOutro` + `vII` + `vIPI` + `vIPIDevol` + `vServ`,
  com tolerância de R$ 0,50 (W16-10, 610, nota *3; MOC Anexo I de 2020).
- `vTotTrib` é opcional (Lei 12.741, informativo).

**`transp`:** `modFrete` = **9** (sem frete) na venda presencial. Frete sem ser entrega = **753** (X02-10).

**`pag`:**

- `detPag` (1 a 100), cada um com `tPag` e `vPag`. `tPag` mais comuns [MOC Anexo I, YA02]: 01 dinheiro, 03 crédito, 04 débito, 10 vale
  alimentação, 11 vale refeição, 17 PIX.
- A NT 2023.004 passou os códigos para uma "Tabela de códigos dos meios de pagamento" do portal; a NT 2025.001 cita **91** = pagamento
  posterior. A lista atualizada **não foi aberta** [N].
- Proibidos na NFC-e: 90 "sem pagamento" (899) e 14 duplicata (857).
- O código 99 "outros" era rejeitado na NFC-e (YA02-50, 436, MOC Anexo I de 2020). Depois disso, a NT 2023.004 criou o campo `xPag` para
  descrever o meio quando ele "for informado como 99-outros". **Se a 436 ainda vale na NFC-e: não confirmado** [N]. Evitar o 99.
- `vTroco` quando a soma paga passa do total; tem de valer `vPag` − `vNF` (869, YA09-10).
- Grupo `card` (`tpIntegra` 1 ou 2; com TEF integrado, `CNPJ` da credenciadora e `cAut`) para 03/04/17: regra YA04-10 (391), "opcional a
  critério da UF". **Não confirmado se SP exige** [N]. `card` em meio que não é cartão/PIX = 963 (YA04-20).
- Sem `cobr` (760).

**`infAdic`:** opcional. `infCpl` vai para a Divisão IX do DANFE.

**`infRespTec`:**

- Opcional no esquema (0..1). A rejeição 972 (ZD01-10) é "implementação a critério da UF"; a NT 2018.005 lista as UF que a ativaram: AM,
  MS, PE, PR, SC e TO, desde 03/06/2019 [P: NT 2018.005 v1.52, §1.5 e regra ZD01-10].
- **SP não está na lista** e não achei norma de SP que exija. **Sugestão:** preencher sempre, porque não tem custo. `idCSRT`/`hashCSRT`
  continuam "implementação futura" para SP.

**`infNFeSupl`** (fora da assinatura): `qrCode` e `urlChave` obrigatórios (**394** sem QR) — ver B.5.

**Arredondamento [P: MOC Anexo I, nota (*4)]:** `vProd` = `qCom × vUnCom` arredondado a 2 casas, com tolerância de **R$ 0,01**
(I11-10/629, facultativa). Totais = soma dos itens (W07-10, W10-10 etc.).

**Outros limites [P]:** valor máximo padrão da NFC-e = R$ 200.000,00 (W16-30, 780).

### B.4 Reforma tributária (IBS/CBS) na NFC-e em 2026

- **NT 2025.002 v1.53** (30/10/2026), cronograma (p. 4–7) [P]:
  - o esquema com o grupo IBSCBS está em produção desde 06/10/2025;
  - para **CRT 3 (Regime Normal)** em produção: "Preenchimento dos campos IBS/CBS **não será exigido por regra de validação**, porém permanece
    obrigatório conforme a legislação vigente". Valor jurídico desde 01/01/2026. Em homologação é obrigatório desde 01/07/2026;
  - a rejeição **1115** "Grupo IBSCBS não informado" (UB12-10) vale "em homologação para NFe com data de emissão ≥ 01/07/2026 e emitente com
    **CRT 3**" e é "**implementação futura para produção**" (p. 40).
- **Simples Nacional [P]:** a mesma NT (p. 7) diz: "As orientações para CRT=1-Simples Nacional, CRT=2 ..., CRT=4-MEI ... serão publicadas
  em NT futura, tendo em vista que a tributação do IBS/CBS/IS para estes contribuintes ocorre **somente a partir de 2027**, conforme disposto no
  Art. 348 da LC 214/25."
- **NT 2026.005 v1.00** (30/10/2026, "Simples Nacional") [P]:
  - cria `tpRegimeIBSCBS` (C21a), `cAtivSN` (I17d, por item: 01 revenda/industrializado, 02 demais bens sem ICMS, 90 não tributável …) e o
    grupo `gTribSN` (`gIBSSN`/`gCBSSN`);
  - cria também o evento do fisco 412140;
  - tabela de preenchimento (§2.3, p. 5–6): Simples **sem** regime regular do IBS/CBS (CRT 1, o caso provável) informa `cAtivSN` por item e o
    grupo `gTribSN` (`gIBSSN` + `gCBSSN`, com alíquota efetiva e valor), e **não** informa `gIBSCBS` nem `tpRegimeIBSCBS`;
  - **conflito de datas:** o cronograma da NT diz teste até 26/10/2026 e **produção 16/11/2026**. O portal da SEFAZ-SP lista "NF-e NT
    2026.005 v1.00 – Simples Nacional" entre as NT cuja produção foi **prorrogada de 16/11 para 14/12/2026**. A frase "schemas e regras em
    14/12" do mesmo aviso fala de BP-e, CT-e e NFCom. **Não está claro se o esquema da NF-e/NFC-e já está em produção** [N];
  - a única regra nova é a soma dos totais (W59h–W59j). Não há regra que rejeite nota do Simples **sem** esses campos.
- **Resposta à pergunta:** em 17/11/2026, a SEFAZ **não rejeita** NFC-e sem IBSCBS em produção, para nenhum regime. Para o Simples, o grupo
  não é devido em 2026.
- **IMPACTO:**
  - na 1ª versão, não mandar IBSCBS nem os campos da NT 2026.005, até confirmar em homologação que o esquema os aceita;
  - mas o **cadastro de produto e o modelo de dados precisam desde já** de `cAtivSN`, CST/`cClassTrib` do IBS/CBS e as alíquotas efetivas
    do Simples (o contador escolhe), porque a tela vai emitir em 2027;
  - rever a NT e o cronograma antes de 01/01/2027.

### B.5 QR Code, `urlChave` e contingência off-line

**Versões aceitas [P: NT 2025.001 v1.03; Manual DANFE NFC-e e QR Code v6.0, mar/2025]:**

- **v2 (com CSC)** continua válida para CNPJ.
- **v3 (sem CSC)** é opcional para CNPJ ("é opção da empresa adotar esse novo leiaute") e obrigatória para produtor rural pessoa física.
  Produção até 01/09/2025.
- A NT 2025.001 v1.01 diz que removeu a regra ZX02-220 "considerando que todas as UF irão disponibilizar o layout do qrCode v3", mas o corpo
  da NT ainda lista a regra.
- **Aceitação do v3 pela SEFAZ-SP: não confirmada** [N]. O portal da SEFAZ-SP ainda manda obter o CSC. **Plano:** v2 com CSC como base;
  testar v3 em homologação; se passar, o v3 dispensa guardar CSC.

**Montagem (v2) [P: Manual v6.0 §4.3, p. 20–27]:**

- **On-line:** `URL?p=<chave>|2|<tpAmb>|<IdCSC sem zeros à esquerda>|<hash>`.
  - `hash` = SHA-1 em **hexadecimal** (40 caracteres) de `"<chave>|2|<tpAmb>|<IdCSC>" + CSC` (o CSC é concatenado direto, sem `|`).
- **Off-line (`tpEmis=9`):**
  `URL?p=<chave>|2|<tpAmb>|<dia de dhEmi, 2 dígitos>|<vNF com ponto>|<digVal em HEX>|<IdCSC>|<hash>`.
  - `digVal` = `DigestValue` da assinatura da própria NFC-e, convertido de base64 para hexadecimal.
  - `hash` = SHA-1 hex de `"<parâmetros 1–7 com |>" + CSC`.
  - O manual traz um exemplo completo (p. 26–27) que serve de vetor de teste.
- QR com correção de erros nível **M**, UTF-8, mínimo **25 × 25 mm** (§3.4, §4.5).

**Montagem (v3) [P: Manual v6.0 §4.4]:**

- **On-line:** `URL?p=<chave>|3|<tpAmb>`.
- **Off-line:** `URL?p=<chave>|3|<tpAmb>|<dia>|<vNF>|<tp_idDest 1/2/3 ou vazio>|<idDest ou vazio>|<assinatura>`.
  - `assinatura` = RSA-SHA1 em base64 dos parâmetros 1–7 (com os `|`), "com o mesmo certificado digital que assina a NFC-e".
  - Rejeições: 445 (assinatura na emissão normal), 474 (falta assinatura em contingência), 583 (assinatura não confere).

**URLs de SP [P: página WebServices da SEFAZ-SP; ENCAT]:**

| | Produção | Homologação |
|---|---|---|
| QR Code (`qrCode`) | `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx` (alternativa curta: `https://www.nfce.fazenda.sp.gov.br/qrcode`) | `https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx` |
| Consulta por chave (`urlChave`) | `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica` (ou `/consulta`) | `https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica` |

URL do QR diferente da esperada = **395** (ZX02-20; maiúsculas/minúsculas não contam). Qual das duas formas a SEFAZ-SP espera na
validação: as duas aparecem na página oficial; usar a longa e confirmar em homologação.

**Contingência off-line [P: Ajuste 19/16 cl. 11ª; Manual da Contingência Off-line v2.0; Manual DANFE v6.0 §3.1.8]:**

- **Autorizada em SP** desde a Portaria SRE 40/2024 (10/07/2024), segundo a página "Contingência" da SEFAZ-SP.
- `tpEmis=9`, com `dhCont` e `xJust` preenchidos (não vão impressos). Não precisa de série especial.
- **Atraso [P: NT 2026.002 v1.11, B09-40, p. 8]:**
  - na emissão normal, `dhEmi` mais de 5 min antes da recepção = **704**;
  - "a critério da UF", a NFC-e de contingência (`tpEmis` 4 ou 9) com data muito atrasada pode ser aceita; se transmitida **depois de 24 h**,
    volta **150** "autorização fora de prazo".
  - **IMPACTO:** a NFC-e normal sem resposta não pode simplesmente ser reenviada minutos depois. Primeiro consultar pela chave
    (`NFeConsultaProtocolo4`) e, se for o caso, passar para contingência com **outro número**.
- **Transmitir "até o primeiro dia útil subsequente" à emissão** (cl. 11ª § 1º II a).
- **Numeração:**
  - é proibido reaproveitar em contingência um número já transmitido como normal (cl. 11ª § 2º I);
  - o manual recomenda **pular um número** ao entrar em contingência;
  - se a nota "normal" que ficou sem resposta depois sair autorizada, ela tem de ser **cancelada** (cl. 12ª I; cl. 15ª-A: até **168 h**,
    referenciando a nota de contingência).
- **Rejeitada depois:** gerar de novo com o **mesmo número e série**, corrigindo só o que não muda imposto, remetente/destinatário ou data
  (cl. 11ª § 1º III).
- **Chave:** a mesma chave e o mesmo `cNF` no reenvio (Manual off-line, §2).
- **DANFE:**
  - imprimir "EMITIDA EM CONTINGÊNCIA / Pendente de autorização" em dois lugares, sem protocolo;
  - uma via (ou o XML guardado com termo no livro modelo 6) fica no estabelecimento até a autorização (cl. 11ª § 3º; Manual DANFE §3.1.8).
- **Presunção:** buraco na numeração sem inutilização, constatado a partir do dia 11 do mês seguinte, "refere-se a documentos emitidos em
  contingência e não transmitidos" (cl. 11ª § 5º, redação do Ajuste SINIEF 26/19). Ver B.6.

### B.6 Cancelamento, substituição, inutilização e numeração com outro sistema

- **Cancelamento [P]:**
  - evento **110111**, `descEvento` "Cancelamento", `nProt`, `xJust` (15 a 255 caracteres);
  - enviado ao `NFeRecepcaoEvento4` **da NFC-e de SP**. `cOrgao` 35 é *inferência* (código da UF autorizadora, como no cancelamento da
    NF-e); confirmar em homologação;
  - prazo nacional de **30 minutos** desde a autorização, "desde que não tenha havido a saída da mercadoria" (Ajuste 19/16 cl. 15ª, redação
    do Ajuste SINIEF 7/18, efeitos 01/10/2018; a UF pode reduzir);
  - a Portaria SRE 40/2024 **não fixa** outro prazo; para a NF-e 55, a SRE 80/2025 aceita cancelamento até 480 h, mas isso não vale para a
    NFC-e;
  - cancelamento fora do prazo ("extemporâneo"): o quadro do ENCAT diz "Não adota" para SP [S: ENCAT, página de 2017];
  - **IMPACTO:** a tela deve mostrar "pode cancelar até hh:mm" (autorização + 30 min) e bloquear depois.
- **Esquema do cancelamento [P]:** o `e110111_v1.00.xsd` (pacote de 2018) usa um `tiposBasico` com `TProt` = **15 dígitos**, mas SP já
  devolve protocolo de **17**. **IMPACTO:** para validar localmente, usar o `tiposBasico_v1.03.xsd` do 010d v1.03 (`[0-9]{15}|[0-9]{17}`).
- **Cancelamento por substituição [P/S]:**
  - evento **110112** (`e110112_v1.00.xsd`: `cOrgaoAutor`, `tpAutor`=1, `verAplic`, `nProt`, `xJust`, `chNFeRef`), para cancelar a nota
    "normal" que saiu autorizada depois da de contingência, até 168 h (cl. 15ª-A);
  - SP habilitou o 110112? Um fornecedor diz que **sim**: as pendências da SEFAZ-SP "foram solucionadas por completo na data do dia
    26/08/2024, com a implementação do cancelamento por substituição" (prazo de 168 h) [S: Inventti, 27/08/2024]. **Não confirmado em fonte
    primária** [N].
- **Inutilização — conflito de datas, não resolvo:**
  - Ajuste SINIEF 38/26 (DOU 14/09/2026): a inutilização "não se aplica aos Estados do Acre, Bahia e São Paulo" (cl. 16ª § 6º), efeitos
    **01/11/2026** [P];
  - portal da SEFAZ-SP: "a partir de 1º de novembro de 2026 ... deixa de ser aplicável"; "Na hipótese de ocorrer salto na numeração, **não
    deverá** ser efetuado pedido de inutilização"; "manter a numeração efetivamente utilizada ... inclusive a eventual quebra de sequência";
    "os serviços ... permanecerão disponíveis ... **até março de 2027**" [P];
  - NT 2023.002 v1.02: o serviço de inutilização de SP deixa de existir em **11/11/2026** (homologação e produção), com HTTP 404 ou rejeição
    **998** "Serviço Desativado" [P];
  - **IMPACTO:** o ERP **não implementa inutilização**. Número pulado fica registrado como "não usado" no ERP, para a escrituração.
- **Conflito para o contador:**
  - a cl. 11ª § 5º do Ajuste 19/16, que presume que o buraco é contingência não transmitida, **continua no texto**; o Ajuste 38/26 só mexeu
    na cl. 16ª;
  - com a inutilização dispensada em SP, como provar que um número pulado não é nota emitida? Leitura conservadora: evitar buracos
    (reservar o número só no envio e reaproveitar o número de nota **rejeitada**, que não foi autorizada).
- **Outro sistema emitindo NFC-e no mesmo CNPJ [P + inferência]:**
  - a numeração é "sequencial de 1 a 999.999.999, **por estabelecimento e por série**" (cl. 4ª II);
  - a nota é identificada por "CPF ou CNPJ do emitente, número, série e tipo de emissão" (cl. 5ª § 3º II);
  - **portanto, série própria basta para não colidir número** (ex.: se o outro usa série 1, o ERP usa série 2; faixa permitida 000–889);
  - mesmo número + série já usado pelo outro = rejeição de duplicidade (204/539) [inferência a partir do MOC];
  - **não basta** para:
    - CSC (B.1: no máximo 2 por empresa, não revogar o do outro);
    - bloqueio por consumo indevido: mais de 30 rejeições iguais deixam o serviço de autorização devolvendo **656** por até 1 h "para todas
      as requisições", e a SEFAZ pode identificar o contribuinte por "CNPJ do certificado + IP" **ou pelo `emit/CNPJ`**. Nesse segundo caso,
      um laço de reenvio do ERP bloqueia também o outro sistema. Depois de 50 bloqueios, pode ser permanente [P: MOC 7.0 Anexo I §4.3.1,
      p. 140; critérios "parametrizáveis por ambiente"]. **IMPACTO:** nunca reenviar sozinho uma NFC-e rejeitada;
    - escrituração: o contador precisa receber os XML dos dois sistemas;
  - também é preciso saber se o outro sistema usa contingência off-line, porque ela consome números da mesma série dele (não da nossa).

### B.7 DANFE NFC-e (papel, tela, e-mail/link)

**Leiaute [P: Manual DANFE NFC-e e QR Code v6.0, §2–3]:**

- Papel com largura mínima de **56 mm** (80 mm serve), legível por 6 meses, margens laterais de 2 mm; A4 também é permitido; **proibido**
  imprimir em ECF (§3.3; Ajuste 19/16 cl. 10ª § 2º I).
- Divisões:
  - I cabeçalho: CNPJ, razão social, endereço, "Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica";
  - II itens: código, descrição, qtde, un, valor unitário, valor total; pode ser omitida no DANFE resumido;
  - III totais: qtde de itens, valor total, acréscimos/desconto, valor a pagar, forma de pagamento, valor pago, troco;
  - IV "Consulte pela Chave de Acesso em" + `urlChave` + chave em 11 blocos de 4;
  - V QR Code (≥ 25 mm);
  - VI consumidor: "CONSUMIDOR CPF: …" ou "**CONSUMIDOR NÃO IDENTIFICADO**"; com entrega, o nome e o endereço são obrigatórios;
  - VII número, série, emissão (hora local), "Protocolo de autorização:" + `nProt` + data/hora local (sem protocolo em contingência);
  - VIII mensagem fiscal: em homologação, "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL"; em contingência, o aviso de B.5;
  - IX `infCpl`.
- Nada pode ser impresso que não esteja no XML, exceto os dados do retorno (`nProt`, `cMsg`, `xMsg`) (§2).
- Mensagens institucionais só **depois** da Divisão IX (§3.1.9).

**Só digital em SP? Sim, se o consumidor concordar [P: Portaria SRE 40/2024, art. 5º § 1º; Ajuste 19/16 cl. 10ª § 3º]:**

- A impressão pode ser substituída "pelo envio em formato eletrônico ou pelo envio da chave de acesso".
- Ou pela consulta na **Nota Fiscal Paulista**, desde que: o consumidor informe CPF/CNPJ; a NFC-e não seja de contingência; e, se ele pedir,
  o ERP envie o DANFE ou a chave.
- Também pode imprimir o DANFE **resumido** (sem itens), se o consumidor concordar.
- No XML, `tpImp=5` quando a mensagem eletrônica for a única forma (NT 2026.002, campo B21).
- **Na contingência:**
  - a dispensa de papel pela consulta na **Nota Fiscal Paulista** não vale (art. 5º § 2º, 2) [P];
  - uma via do DANFE (ou o XML guardado, com termo no livro modelo 6) tem de ficar no estabelecimento até a autorização (cl. 11ª § 3º;
    Manual DANFE §3.1.8) [P];
  - o Manual da Contingência Off-line v2.0 (2016, §3) diz que, na contingência 9, "é obrigatória a impressão do Detalhe da Venda e do
    DANFE NFC-e" [P, documento antigo];
  - se o **envio eletrônico** (alínea "a") também fica vedado na contingência: **não confirmado** [N]. Leitura conservadora: imprimir a via
    do consumidor.

**Pré-conta [P]:** "A expressão 'NÃO É DOCUMENTO FISCAL' ou expressão similar deve constar, de forma destacada e legível, nos documentos não
fiscais relacionados à NFC-e entregues ao consumidor final" (Ajuste 19/16 cl. 10ª § 4º, Ajuste SINIEF 32/24, efeitos 01/02/2025).

### B.8 Códigos típicos de restaurante no Simples Nacional (só para o contador confirmar; não é recomendação)

| Situação | O que as regras da NFC-e permitem | Fonte [P] |
|---|---|---|
| CRT | 1 = Simples Nacional | leiaute `emit/CRT` |
| CSOSN aceitos na NFC-e | 102, 103, 300, 400, 500, 900 (103 e 400 podem ser barrados por UF, regra N12a-30) | MOC Anexo I, N12a-20/N12a-30 |
| Prato/porção produzido na casa, ou revenda sem ST | CSOSN **102** (ou 103/300/400/900) só com CFOP **5.101** (produção própria), **5.102** (revenda), 5.103, 5.104 ou 5.115 | N12a-40 (386) |
| Mercadoria com ICMS-ST já retido (ex.: refrigerante, cerveja, água, conforme a lista de ST) | CSOSN **500** só com CFOP **5.405** (ou 5.656/5.667, combustível) | N12a-44 (386) |
| Gorjeta/taxa de serviço em SP | CFOP **5.949** com **CSOSN 900** (ou CST 40 no Regime Normal) "para registro de gorjeta". A mesma combinação vale no AM; RS e ES permitem 5.949 com CSOSN 900 ou **CST 90** (RS: meios de pagamento; ES: gorjeta) | NT 2023.003 v1.40, §2.1.1–2.1.2 e I08-150 (p. 5–6). Para SP, a v1.20 traz duas datas: no resumo (p. 4), teste 30/09/2024 e produção 07/10/2024; no cronograma (p. 3), 14/10/2024 e 21/10/2024 |
| CFOP aceitos na NFC-e | 5.101, 5.102, 5.103, 5.104, 5.115, 5.405, 5.656, 5.667, 5.933 (5.933 só com ISSQN) | I08-150 (725) |
| PIS/COFINS | Grupos **opcionais** na NFC-e. Se informados, o CST é do contador (o esquema aceita, entre outros, 49 e 99; o uso de cada um no Simples e o tratamento de bebida com PIS/COFINS monofásico **não foram pesquisados**) | esquema 010h (`PIS`/`COFINS` `minOccurs=0`; enumeração de `PISOutr`); Q01-20/S01-20 só no modelo 55 |
| NCM/CEST | NCM obrigatório por item; CEST quando a mercadoria está na lista de ST | Ajuste 19/16 cl. 4ª V e VIII |
| Regime Normal (se o contador disser que não é Simples) | CST 00, 20, 40, 41, 60 (60 só com 5.405), 90 | N12-30, N12-40, N12-44 |

---

## Não confirmado (fazer no 1º teste em homologação ou perguntar ao contador)

- **Parte A:**
  - se `cOrgao` = 91 é aceito sem 250 (esperado; a NT tem texto ambíguo);
  - a *action*/namespace exatos do WSDL do `NFeRecepcaoEvento4` (não abri `?wsdl`);
  - o prazo entre a ciência e o NSU com o XML completo;
  - se existe cronograma para SHA-256 (não encontrei);
  - a leitura do contador sobre a cl. 15ª-C § 5º ("ciência obriga conclusiva") e a multa de SP por não manifestar.
- **Parte B:**
  - se SP aceita QR Code v3 na NFC-e;
  - qual das duas URLs de QR de SP a validação 395 espera;
  - limite de SP para consumidor não identificado (tabela por UF da NT 2026.002);
  - se SP exige o grupo `card` (YA04-10) e o `infRespTec` (ZD01-10);
  - se SP aceita o cancelamento por substituição 110112 (só fonte secundária diz que sim);
  - emissor do certificado TLS de `nfce.fazenda.sp.gov.br` e `homologacao.nfce.fazenda.sp.gov.br`;
  - a tabela atual de `tPag` (códigos 20/21/22/91) e se o 99 ainda é rejeitado (436);
  - se a X03-20 (786, entrega sem transportador) ainda vale;
  - se o esquema da NT 2026.005 (Simples) entrou em produção em 16/11 ou entra em 14/12/2026;
  - `cOrgao` do cancelamento (35, inferência) e se o envio só eletrônico do DANFE é permitido em contingência;
  - as três datas da inutilização em SP e a presunção da cl. 11ª § 5º;
  - qual sistema e qual série emitem NFC-e hoje na loja.
- **Planilha de regras por UF do ENCAT** (`regra_validacao_geral-20241007-BA-SP.xlsx`): o link devolveu uma página HTML, não a planilha.
  **Não abriu.**

---

## Fontes

Todas lidas em 17/11/2026. Links do Portal NF-e com `conteudo` codificado (`+` = `%2B`), na forma que de fato abriu.

**Portal Nacional da NF-e (primárias)**

- Lista de NT vigentes: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY%3D
- NT 2020.001 v1.60 (23/04/2026), manifestação: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=%2BWTd7iuD21s%3D
- NT 2021.003 v1.50 (25/09/2026), GTIN: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=ENot2yWE72Q%3D
- NT 2023.003 v1.40 (25/09/2026), CFOP NFC-e: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=JSxhEY85vRU%3D
- NT 2023.002 v1.02 (27/10/2026), fim do assíncrono e da inutilização: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=DCFRgnlk4g8%3D
- NT 2014.001 v1.41 (04/08/2026), EPEC: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=9hgG%2B%2BcH8gA%3D
- NT 2024.003 v1.10 (11/05/2026): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=iamjHzm%2B4%2FI%3D
- NT 2022.002 v1.30a (26/03/2026): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=NpWPjigODyU%3D
- NT 2026.004 v1.01 (08/06/2026), CNPJ alfanumérico: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=BTZQzgsO9Ws%3D
- NT 2026.001 v1.02b (31/07/2026), PAA: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=AlgHfV6gpAU%3D
- NT 2025.002 v1.53 (30/10/2026), RTC: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=BMcHSMEoepU%3D
- NT 2026.005 v1.00 (30/10/2026), Simples na RTC: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=HInG7WD5Sj8%3D
- NT 2026.002 v1.11 (01/10/2026), DANFE Simplificado Tipo 2, alerta 120, indPres: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=m8aACnFLK%2FY%3D
- NT 2025.001 v1.03 (29/09/2025), QR Code v3: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=NvuzQGYd6E8%3D
- NT 2016.002 v1.61, leiaute 4.00 / fim do `nfeCabecMsg`: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=9bznzUXCXr0%3D
- NT 2018.005 v1.52, `infRespTec`: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=vZguLua3oPM%3D
- NT 2023.004 v1.20, pagamentos: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=hoSIJ5lGBNc%3D
- MOC 7.0 (Visão Geral): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LrBx7WT9PuA%3D
- MOC 7.0 Anexo I (leiaute e regras): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=J%2BI%2Bv4eN00E%3D
- Manual DANFE NFC-e e QR Code v6.0 (mar/2025): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=k%2FIuuaW4YiY%3D
- Manual da Contingência Off-line NFC-e v2.0: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=tG8%2BfKpcfbM%3D
- Lista de Manuais: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=ndIjl%2BiEFdE%3D
- Informes Técnicos (lista): https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=hXzemuyNHW4%3D
- Relação de Serviços Web, produção: https://www.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo= · homologação: https://hom.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo=
- Esquemas (lista): https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=BMPFMBoln3w%3D
  - 010d_v1.01 (08/06/2026): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=FOEnx2KAsCk%3D
  - 010d_v1.03 (10/07/2026): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=%2BpBOYTXBtbk%3D
  - 010h_v1.03 (13/11/2026): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=YhWikFoTxUo%3D
  - Evento Manifesta Destinatário v1.01 (2014): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=Q7x6aqhBAy4%3D
  - Evento Cancelamento (2018): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=0Yynu2Ck%2BbM%3D
  - Evento Cancelamento por Substituição (2018): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=6UBZKIOo6qU%3D
  - Eventos RTC (NT 2025.002 v1.40, 27/07/2026): https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=kp0SXLu%2BZdI%3D

**CONFAZ (primárias, texto consolidado)**

- Ajuste SINIEF 07/05 (cl. 15ª-A a 15ª-C, Anexo II): https://www.confaz.fazenda.gov.br/legislacao/ajustes/2005/AJ007_05
- Ajuste SINIEF 14/26 (prazo 90 dias): https://www.confaz.fazenda.gov.br/legislacao/ajustes/2026/AJ014_26
- Ajuste SINIEF 19/16 (NFC-e; cl. 4ª, 10ª, 11ª, 15ª, 15ª-A, 16ª): https://www.confaz.fazenda.gov.br/legislacao/ajustes/2016/AJ_019_16
- Ajuste SINIEF 23/26 (NF-e no lugar da NFC-e com crédito de ICMS): https://www.confaz.fazenda.gov.br/legislacao/ajustes/2026/AJ023_26
- Ajuste SINIEF 38/26 (NFC-e: inutilização não se aplica a AC, BA, SP): https://www.confaz.fazenda.gov.br/legislacao/ajustes/2026/AJ038_26
- Ajuste SINIEF 40/26 (NF-e: idem): https://www.confaz.fazenda.gov.br/legislacao/ajustes/2026/AJ040_26

**SEFAZ-SP (primárias)**

- Portal NFC-e (avisos: obrigatoriedade 01/01/2026, inutilização, protocolo 17, CSC, adiamento de NT): https://portal.fazenda.sp.gov.br/servicos/nfce
- WebServices NFC-e e URLs de QR/consulta: https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/WebServices.aspx
- Contingência (off-line e EPEC): https://portal.fazenda.sp.gov.br/servicos/nfce/Paginas/Conting%C3%AAncia.aspx
- Portaria SRE 40/2024 (NFC-e em SP): https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-40-de-2024.aspx
- Portaria SRE 79/2024 (fim do SAT) e Portaria CAT 147/12 art. 34-D: https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-79-de-2024.aspx · https://legislacao.fazenda.sp.gov.br/Paginas/pcat1472012.aspx
- Portaria SRE 80/2025 (NF-e em SP; revogou a CAT 162/08): https://legislacao.fazenda.sp.gov.br/Paginas/Portaria-SRE-80-de-2025.aspx
- Portaria CAT 162/08 (revogada; histórico do art. 30 e Anexo III): https://legislacao.fazenda.sp.gov.br/Paginas/pcat1622008.aspx

**ENCAT / Portal NFC-e (oficial dos estados; o certificado TLS do site vem sem a intermediária, então foi baixada a intermediária Sectigo
OV R36 indicada no próprio certificado, sem desligar a verificação)**

- URLs de QR por UF: https://nfce.encat.org/desenvolvedor/qrcode/
- URLs de consulta por chave: https://nfce.encat.org/consumidor/consulte-sua-nota/
- Webservices produção/homologação: https://nfce.encat.org/desenvolvedor/webservices-p/ · https://nfce.encat.org/desenvolvedor/webservices-h/
- CSC (link de SP): https://nfce.encat.org/empresario/csc/
- Cancelamento e credenciamento (2017): https://nfce.encat.org/cancelamento-e-credenciamento/
- Planilha de regras por UF (não abriu, veio HTML): https://nfce.encat.org/wp-content/uploads/2024/10/regra_validacao_geral-20241007-BA-SP.xlsx

**Outras**

- Log CT de `www.nfe.fazenda.gov.br`: https://crt.sh/?q=www.nfe.fazenda.gov.br · folha mais nova: https://crt.sh/?id=29518064688 · intermediária
  `YR1`: http://yr1.i.lencr.org/
- IBGE, Valinhos 3556206: https://servicodados.ibge.gov.br/api/v1/localidades/municipios/3556206

**Secundárias [S]**

- Exemplos de `envEvento` 210210 com `cOrgao` 91 (fórum ACBr): https://www.projetoacbr.com.br/forum/topic/54173-manifesta%C3%A7%C3%A3o-do-destinat%C3%A1rio-corg%C3%A3o-91/ · https://www.projetoacbr.com.br/forum/topic/60397-erro-para-dar-ci%C3%AAncia-da-opera%C3%A7%C3%A3o-da-nfe/
- Tempo até o XML completo após a ciência: https://www.projetoacbr.com.br/forum/topic/59934-download-xml/ · https://www.projetoacbr.com.br/forum/topic/36459-distribuicaodfe-n%C3%A3o-baixa-xml-completo/ · https://nfe.io/docs/distribuicao-fluxos-de-processamento/index.md
- Fim do SAT em SP e revogação do art. 34-C: https://blog.tecnospeed.com.br/sefaz-sp-portaria-sre/ · https://online.crcsp.org.br/portal/noticias/noticia.asp?c=10087
- Cancelamento por substituição implementado pela SEFAZ-SP em 26/08/2024 (Inventti, 27/08/2024): https://inventti.com.br/?p=21127
- Página do ENCAT sobre a rejeição 656 (só traz contatos por UF, sem regra): https://nfce.encat.org/desenvolvedor/consumo-indevido-rejeicao-656/
