# Certificado digital A1 em Configurações — desenho

Data: 16/11/2026 · Ramo: `feat/certificado-digital`, criado em cima de `feat/nota-por-foto` (não depende de merge no `master`; a mudança do
`cripto.ts` já parte do `ia-chave.service.ts` daquele ramo) · Direção aprovada pelo dono em 16/11/2026 (ver "Decisões do dono").

2º de quatro projetos: nota por foto → **certificado A1** → notas da SEFAZ (ciência automática) → cupom fiscal (NFC-e). Os projetos 3 e 4
consomem a porta definida aqui. Nada deles é construído agora, nem chamada à SEFAZ ("teste de conexão" no cadastro = opção do projeto 3).

## Por quê

Buscar notas na SEFAZ (TLS com certificado do cliente) e emitir NFC-e (XML assinado) exigem o A1 da empresa. Sem a tela, o arquivo iria por
SSH para o servidor e a senha para o `.env`, e só o técnico conseguiria trocar.

## O que muda para quem usa (só admin, Configurações → painel "Certificado digital (A1)", no molde do `IaChavePanel`)

1. Sem certificado: arquivo (`.pfx`/`.p12`), senha e "Enviar certificado". O servidor confere tudo antes de guardar ("Conferindo…").
2. Com certificado: titular (razão social), CNPJ, tipo (A1 ou selo eletrônico SE-S), certificadora, "válido até 10/03/2027 · vence em 114 dias",
   "cadeia ICP-Brasil conferida" (ou aviso), enviado por/em. "Substituir" reabre o formulário (o novo só troca o atual se passar em tudo);
   "Remover" pede confirmação. Qualquer admin faz as três coisas; tudo vai para o histórico.
3. Âmbar a 30 dias ou menos do vencimento. Vermelho se vencido, ilegível ou de CNPJ com outra raiz. Esses aparecem no painel e numa faixa no
   topo do app (só admin). Avisos que ficam só no painel (âmbar): CNPJ de outro estabelecimento da mesma empresa, cadeia não conferida, tipo incomum.
4. Arquivo e senha nunca voltam para a tela: o navegador lê o arquivo só no envio e limpa a senha depois. Não existe "baixar certificado".

## Metas, o que fica de fora, o que não pode acontecer

- **Metas:** qualquer admin cadastra, substitui e remove o A1 sem técnico; os projetos 3 e 4 recebem chave e certificado prontos, sem retrabalho.
- **Fora:** SEFAZ, revogação (LCR/OCSP), A3 (token/cartão), mais de um certificado, cofre externo, aviso por WhatsApp/e-mail (decidido: só tela).
- **Não pode:** .pfx, senha, chave ou PEM da chave em log, resposta, mensagem de erro, Swagger ou repositório. Nada disso em `configuracoes`
  (`GET /v1/configuracoes` é `@Staff()` e a loja lê). A loja não alcança rota nova; teste não faz rede; teste não usa certificado real.

## Abordagens consideradas

| Decisão | Opções e troca | Escolhida |
|---|---|---|
| O que guardar | (a) .pfx original + senha, cifrados: devolve o arquivo idêntico, mas guarda a senha e leva a cifra legada (e o forge) para todo uso nos projetos 3 e 4. (b) Chave PKCS#8 + certificado + cadeia em PEM, cifrados; a senha é descartada após o cadastro, 3 e 4 usam só `node:crypto`/`https` e o .pfx original fica com o dono. | **(b)** |
| Onde guardar | (A) Banco, tabela própria de uma linha, AES-256-GCM com segredo próprio: entra no backup, sobrevive a rebuild, segue o padrão da `ia_chave`. Contra: quem tem a EC2 tem o dump e o `.env`. (B) Arquivo num volume + senha no `.env`: troca só por SSH (contradiz "pela tela") e fica fora do backup. (C) Cofre externo (Secrets Manager/KMS): chave mestra fora da EC2 e auditoria da AWS. Contra: credencial IAM numa EC2 dividida com o Freela, SDK novo, custo, rede a cada uso, ninguém para operar. | **(A)**; (C) vira evolução trocando só `cifrar`/`decifrar` (envelope KMS) |
| Abrir o .pfx | O Node não extrai chave nem campos de **nenhum** PKCS#12, nem do moderno: não há API em `node:crypto`, e `tls.createSecureContext({ pfx })` só carrega para TLS. Por isso é preciso um parser. (1) node-forge, JS puro, sem build nativo (~1,7 MB): abre RC2-40, 3DES e PBES2/AES, com MAC SHA-1/SHA-256. Uso só no cadastro. (2) `--openssl-legacy-provider`: com a flag o `createSecureContext` passa a aceitar o legado, mas continua sem extrair nada, e liga algoritmos legados no processo inteiro. (3) Subprocesso `openssl pkcs12 -legacy`: a senha vai por stdin, a saída vem em texto a interpretar, o binário muda entre Ubuntu e Alpine e há risco de arquivo temporário com a chave. | **(1) node-forge `1.4.3` exato**, só para desembrulhar e ler ASN.1; a confiança fica com `node:crypto` (`checkPrivateKey`, `verify`, datas). Conferido executando: sem a flag, o Node 20.19.4 (OpenSSL 3.0.15) e o `node:22-alpine` (Node 22.23.5, OpenSSL 3.5.9) abrem o moderno e recusam o legado com `ERR_CRYPTO_UNSUPPORTED_OPERATION` ("Unsupported PKCS12 PFX data"); com a flag, os dois abrem. O forge 1.4.3 abriu os dois .pfx de teste nas duas versões. (3) só para gerar fixtures. |

**forge, versão e alertas** (conferido em 16/11 no registro do npm e nos alertas do GitHub). Versão atual: 1.4.3, de 04/11/2026. `npm audit`
dá 0 alertas na 1.4.3; na 1.4.0 e na 1.3.3 acusa alerta alto. Os alertas vieram em ondas: 11/2025 (1.3.2: ASN.1 *validator desync*
CVE-2025-12816, recursão sem limite CVE-2025-66031, truncamento de OID CVE-2025-66030), 03/2026 (1.4.0), 27/10/2026 (1.4.1, 17 alertas) e
04/11/2026 (1.4.3). Dois deles caem no nosso caminho: falsificação do MAC do PKCS#12 / PBE com zero iterações (CVE-2026-118782, alto) e
exaustão no `asn1.fromDer` com BIT STRING (CVE-2026-119191, alto). Por isso o mínimo é 1.4.1, e a versão fixada é a 1.4.3.

Os outros alertas não atingem o uso proposto, porque o forge **nunca** verifica nada. Ficam de fora: falsificação de assinatura RSA PKCS#1,
basicConstraints e nameConstraints no `verifyCertificateChain`, Ed25519, AES-GCM, TLS e `forge.http`. Regras:
- O forge vive num único adaptador (`pkcs12.adapter.ts`), que só chama `pkcs12FromAsn1`/`getBags`, `asn1.fromDer`/`toDer`/`derToOid` e, para
  devolver DER, `pki.certificateToAsn1`, `pki.privateKeyToAsn1` e `pki.wrapRsaPrivateKey`. Não chama `certificateFromAsn1`, que só aceita
  chave RSA: SAN e políticas saem do ASN.1 de `x509.raw`.
- Nada de `verify`, `verifyCertificateChain`, `pem.decode` de entrada, TLS ou http do forge.
  - *alterado na implementação em 16/11/2026: o adaptador também usa as primitivas `pkcs12.generateKey`, `md.*` (sha1/256/384/512/md5) e `util.createBuffer` para conferir o MAC do .pfx por conta própria, antes de decifrar; a lista de funções do forge permitidas inclui essas.*
- Entrada limitada a 64 KB, rota só de admin.
  - *alterado na implementação em 16/11/2026: o adaptador recusa como arquivo inválido (`CERTIFICADO_ARQUIVO`) o .pfx sem bloco de MAC e o .pfx com mais de 20 certificados; o MAC tem teto de 1.000.000 de iterações.*
- Novo alerta = subir a versão exata e rodar `npm audit` no PR.

## Como (decisões do construtor, marcadas como minhas)

**Cifra, segredo e backup**
- `cripto.ts` sai de `leitura-pdf/ia/` para `api/src/common/cripto/`, com o rótulo do HKDF como parâmetro. A IA mantém `erp-freela/ia-chave/v1`
  (a chave salva segue legível); o certificado usa `erp-freela/certificado-a1/v1`.
- Segredo **próprio** `CERTIFICADO_SECRET` (≥ 32, `openssl rand -hex 32` no servidor), **sem cair no `JWT_SECRET`**: trocar o JWT após vazamento
  - *alterado na implementação em 16/11/2026: sem `CERTIFICADO_SECRET`: enviar = 503 `CERTIFICADO_SEM_SEGREDO`, consultar = situação `sem_segredo`, e remover funciona.*
  de sessão não pode derrubar a emissão fiscal. Vai em `env.validation.ts` (opcional; ausente = `sem_segredo` e PUT 503), no compose de produção
  e no `.env.prod.example`. O dono o acrescenta ao `.env` antes de usar (script em `~/erp-deploy/` que só acrescenta se faltar).
- Segredo trocado ou perdido → o GCM não confere → `ilegivel` → enviar o .pfx de novo. O Prisma põe argumentos na mensagem de erro, por isso só
  recebe o envelope.
- Os dumps do `subir-api.sh` (`/opt/erp-freela/backups`, mesma EC2 do `.env` 600) levam envelope e metadados, inúteis fora do servidor sem o
  segredo: nunca copiar dump e `.env` juntos. Na EC2, quem tem root tem os dois (risco aceito; evolução = C).
- Remover apaga a linha, não os dumps antigos; suspeita de vazamento = revogar na certificadora. O `.gitignore` ganha `*.pfx` e `*.p12`, com a
  exceção `!api/src/modules/certificado-digital/__tests__/fixtures/*`.

**Tabelas** (migração nova)
- `certificado_digital`, uma linha (`CHECK (id = 1)`):
  - `material_cifrado text`: envelope `v1.iv.tag.ct` de `{chave_pkcs8_pem, certificado_pem, cadeia_pem[]}`; `cadeia_pem` = intermediárias do
    caminho conferido, venham do .pfx ou do pacote (sem a raiz).
  - Metadados em claro (o certificado é público; o painel os mostra sem decifrar): `titular`, `cnpj char(14) CHECK ~ '^[0-9A-Z]{12}[0-9]{2}$'`
    (aceita o CNPJ alfanumérico, em vigor desde julho/2026), `tipo` (`A1`|`SE-S`|`outro`), `politica_oid`, `emissor`, `numero_serie`,
    `impressao_digital char(64)` (SHA-256 do DER), `valido_de`/`valido_ate timestamptz` (`CHECK valido_ate > valido_de`), `cadeia_conferida boolean`,
    `enviado_em`, `enviado_por uuid`.
- `certificado_digital_historico`, append-only (o repo não tem auditoria): `evento` (`enviado|substituido|removido`), `cnpj`, `titular`,
  `numero_serie`, `impressao_digital`, `valido_ate`, `feito_por`, `feito_em`. Nunca guarda material. Gravação e histórico na mesma transação.

**Rotas** (`modules/certificado-digital`; controller `@AdminOnly()` entra no `permissoes-protecao.spec.ts`; a lista da loja não muda)
- `GET /v1/certificado-digital` → `{ situacao, titular, cnpj, cnpj_confere: 'igual'|'mesma_raiz'|'diferente'|'empresa_sem_cnpj', tipo,
  politica_oid, emissor, valido_de, valido_ate, dias_restantes, cadeia_conferida, enviado_em, enviado_por_nome }`.
- `situacao` por precedência: `sem_segredo` > `ilegivel` > `vencido` > `vencendo` (≤ 30 dias) > `valido`; sem linha = `ausente`. Ela,
  `dias_restantes` e `cnpj_confere` são calculados na leitura (`todaySp()` + CNPJ atual de `configuracoes`, que pode mudar). O GET tenta
  decifrar só para classificar `ilegivel`.
- `PUT` com JSON `{ arquivo_base64, senha }` (minha: o arquivo tem poucos KB e o DTO global valida; base64 ≤ 90.000 caracteres ≈ 64 KB, senha
  - *alterado na implementação em 16/11/2026: confirmado: o envio é JSON com o arquivo em base64 e a senha. Enviar e remover usam trava consultiva de transação; no erro inesperado o log registra só a classe do erro e os quadros da pilha.*
  1–128). Confere, guarda e devolve o corpo do GET. `DELETE` apaga a linha, grava o histórico e devolve `ausente`.

**Conferências no envio** (funções puras, `agora` injetado, na ordem da tabela de mensagens)
- **Desembrulhar:** forge abre com a senha; a chave vem de `bag.key` ou, se o forge não conhece o tipo, de `bag.asn1` (ele devolve o PKCS#8 cru),
  - *alterado na implementação em 16/11/2026: senha com caractere fora do ASCII é tentada nas duas codificações (como veio e como bytes UTF-8), sempre depois de o MAC conferir; senha só ASCII tem uma tentativa.*
  e vira `createPrivateKey({ format: 'der', type: 'pkcs8' })`. Os certificados vão em DER para `X509Certificate` (`bag.cert` reserializado, ou
  `bag.asn1` quando a chave não é RSA). Conferido nas fixtures: o SHA-256 desse DER é igual ao do `openssl x509 -fingerprint`. Se divergir com
  um certificado real, os bytes saem do `certValue` do bag. A folha é o certificado que não é AC, e `checkPrivateKey` confere o par.
- **CNPJ, nesta ordem** (conferido no DOC-ICP-04 v8.3 §7.1.2.2 e Anexo I, no DOC-ICP-04.01 v5.0, na Res. CG ICP-Brasil 211/2024 e nas PCs reais citadas em Fontes):
  1. SAN `otherName` **`2.16.76.1.3.3`**: CNPJ da PJ titular, em 14 posições, codificado como OCTET STRING ou PrintableString (aceito também
     UTF8String, por tolerância). Só zeros = não disponível (§7.1.2.2 b), e conta como ausente. O Node mostra `othername:<unsupported>` e o forge
     devolve o `otherName` cru, então a leitura é ASN.1 manual com `forge.asn1` sobre `x509.raw`. Conferido: devolve tag 4 (OCTET) e 19 (Printable).
  2. `serialNumber` (2.5.4.5) do titular: é o perfil novo do selo eletrônico (Res. 211 art. 8; Anexo I tabela 2). Nele a `2.16.76.1.3.3` só é
     obrigatória "de forma provisória, até 31/12/2028". Vale só se tiver formato de CNPJ: o de pessoa física traz CPF, com 11 posições.
  3. Final do CN casando com `:([0-9A-Z]{12}[0-9]{2})$`: perfil A1, "Nome Empresarial:CNPJ", com o nome em até 49 caracteres (PC AC IDFEDERAL A1 §7.1.4.1).
  - `2.16.76.1.3.8` não serve para o titular. Conferido: esse OID é "nome empresarial", mas os perfis de PJ (A1 e selo) não o usam; ele
    aparece nos de equipamento (OM-BR, SAT). `2.16.76.1.3.2` é o nome do **responsável** (pessoa física) e foi extinto pela Res. 211 art. 7,
    junto com o `.3.4`. Titular = CN sem o sufixo `:CNPJ` (A1) ou o CN inteiro (selo).
- **Normalização e comparação:** maiúsculas e remoção de tudo que não for `[0-9A-Z]` (nunca `\D`, que apaga as letras do CNPJ alfanumérico).
  - Formato `^[0-9A-Z]{12}[0-9]{2}$`; o DV usa módulo 11, com cada caractere valendo o código ASCII − 48 (RFB). DV inválido = sem CNPJ.
  - Raiz = 8 primeiros caracteres. Igual → aceita; mesma raiz → aceita com aviso; raiz diferente → recusa (decisão do dono).
  - Empresa sem CNPJ → recusa (minha: não preencho sozinho). `configuracoes.cnpj` é texto livre (`@MaxLength(40)`, sem máscara nem DV:
    conferido no `ConfiguracoesDto`), por isso é normalizado na comparação.
- **Validade:** `agora` dentro de `valid_from`/`valid_to` da folha (`VENCIDO` / `AINDA_NAO_VALE`).
- **Tipo** (conferido no DOC-ICP-04 v8.3 Tabela 3 e na Res. 211):
  - `2.16.76.1.2.1.n` = **A1**. A Res. 211 (art. 3) extinguiu o tipo, mas ele ainda pode ser emitido e usado na cadeia V5 até 02/03/2029
    (art. 13) e, na V10, até 31/12/2026 para aplicações específicas (art. 14).
  - `2.16.76.1.2.201.n` = **SE-S**, selo eletrônico em software, só para PJ (art. 2), que é o sucessor.
  - **Não recuso por política (minha):** grava `tipo` (`A1`|`SE-S`|`outro`) e mostra aviso âmbar quando é `outro`. Uma lista que aceitasse só
    A1 recusaria o SE-S. A3/A4 agora são só de pessoa física (sem CNPJ, então recusa) e os tipos em hardware não trazem a chave
    (`SEM_CHAVE`), o que já barra o que importa. Outro motivo: a PC SE-S do Serpro (nov/2025) traz `2.16.76.1.2.201.18` no §1.2.1, mas
    `2.16.76.1.2.202.18` (SE-H na Tabela 3) na capa e no perfil. Um certificado real pode chegar com a política "errada", e isso deve virar
    aviso, não recusa.
- **ICP e cadeia:**
  - **Âncoras:** raízes ICP-Brasil fixadas pela impressão digital SHA-256, baixadas uma a uma de `acraiz.icpbrasil.gov.br/credenciadas/RAIZ/`.
    A página do repositório da AC Raiz não traz as impressões, então esta lista é a referência. Todas as sete foram carregadas, com chave
    legível, no Node 20 e no 22:

    | Raiz | Chave | Vale até | SHA-256 |
    |---|---|---|---|
    | v4 | EC | 23/04/2035 | `F0C15AFD258FB674E7A96E1A50FF873149364B9EC70D4D93C7A9F1EB6060D020` |
    | v5 | RSA 4096 (A1 de hoje) | 02/03/2029 | `CAA53FC6091C6951887C976E378F6EF89AA6377C55D97B6475422B71ED7E9B17` |
    | v6 | Ed448 | 28/12/2038 | `3BDB9B509352F1D3D71C2BF64D9A38A4E6CEBDA27809D77F7AC476CBDE6E314A` |
    | v10 | RSA (SSL e aplicações específicas) | 01/07/2032 | `6E0BFF069A26994C15DE2C4888CC54AF84882E5495B7FBF66BE9CCFFEC7489F6` |
    | v11 | RSA (assinatura de código) | 01/07/2032 | `1406710058180FA4081AAB3F246F1702429C552A11FA3143B84C88CB3AB8E5E7` |
    | v12 | RSA (cadeia nova; tem a AC RFB v5) | 22/10/2037 | `D8478E37CE19C690CF657381E68FE600E4E1A042536830F06847E03E554C4B01` |
    | v13 | EC | 14/02/2045 | `2B07D0BC02C4A6E0478ED22D0D99E8F97E1827B269097696A7FEB6AAD30C3AC8` |

    A v7 (`5657E705…F576`, chave pós-quântica OID `1.3.6.1.4.1.44588.2.1`) fica de fora: o Node não lê a chave dela, nem na 20 nem na 22.
  - **Pacote de apoio (minha):** a "Cadeia Vigente" do ITI (`ACcompactado.zip`, 186 certificados, atualizada em 04/11/2026; SHA-512 em
    `hashsha512.txt`). Ela só ajuda a montar o caminho e não dá confiança: um certificado do pacote só vale se `verify` o levar até uma âncora.
    Conferido: 185 dos 186 fecham nas âncoras com `openssl verify`; o que sobra é a própria v7. O SHA-512 vem do mesmo servidor do zip, então
    confere o download, não a autenticidade. Apagar o pacote = comportamento "só raízes". Motivo: um .pfx sem as intermediárias só fecha se
    alguém as fornecer. O `so-certificado-final.pfx` de teste não fecha sem `-untrusted`. Não confirmei com que frequência os .pfx reais vêm
    sem a cadeia.
  - **Embutir** num módulo `.ts` gerado (`icp-brasil.gerado.ts`, com as âncoras e o pacote em strings PEM; eslint ignora). Hoje `.pem` em
    `src/` não chega ao `dist/`: o `nest-cli.json` não tem `assets` e a imagem roda `node dist/src/main` (conferido). Quem gera é
    `api/scripts/atualizar-cadeia-icp.sh`:
    1. baixa as raízes e o zip;
    2. confere o SHA-512;
    3. mantém só o que fecha nas âncoras;
    4. reescreve o módulo.

    Um teste falha se alguma âncora mudar de impressão digital.
  - **Caminho:** a partir da folha, procura o emissor **pelo nome** (`issuer === subject`) entre os certificados do .pfx e os do pacote. Vence
    qualquer candidato, de qualquer das duas fontes, que `verify(candidato.publicKey)` confirma, válido em `agora` e com `ca === true`. Repete
    até uma âncora, com no máximo 5 níveis. Não uso `checkIssued` para achar o emissor: ele também compara AKI/SKI e devolve `false` na cadeia
    adulterada (conferido), o que mandaria a fraude para o aviso em vez da recusa.
    - *alterado na implementação em 16/11/2026: a busca tem profundidade máxima de 8 níveis, não 5.*
  - **Resultado:**
    - Fecha → `cadeia_conferida = true`.
    - Recusa `CERTIFICADO_CADEIA` só quando há no **.pfx** um emissor com o mesmo nome e nenhum candidato, de nenhuma das duas fontes, confirma.
      Um candidato do pacote que falha, sozinho, não recusa ninguém, porque o pacote pode estar velho.
    - Não fecha por outro motivo (AC mais nova que o pacote, v7) → aceita com `cadeia_conferida = false` e aviso âmbar no painel. Mas só se a
      folha tiver sinal de ICP (emissor com `O=ICP-Brasil` ou política `2.16.76.1.2.*`); sem nenhum → recusa `CERTIFICADO_NAO_ICP`.
      *alterado na implementação em 16/11/2026: só assinatura que falha com chave legível é tratada como adulteração (`CERTIFICADO_CADEIA`); emissor vencido, sem marca de AC ou com chave ilegível = cadeia não conferida (aceito com aviso).*
    - Motivo do aceite com aviso: quem envia é o admin da própria empresa, a conferência que vale é a da SEFAZ (projeto 3), e recusar
      travaria o cadastro até um técnico atualizar o pacote.

Mensagens (tabela fechada: nunca texto de biblioteca, nem o `(detalhe)` que o `erroDoTeste` da IA anexa; o log leva só code + impressão digital):

| code (status) | Frase na tela |
|---|---|
| `CERTIFICADO_ARQUIVO` (400) | Este arquivo não é um certificado A1 (.pfx ou .p12). |
| `CERTIFICADO_SENHA` (400) | Senha do certificado incorreta. |
| `CERTIFICADO_FORMATO` (400) | Não consegui abrir este certificado. Exporte o .pfx de novo e tente outra vez. |
| `CERTIFICADO_SEM_CHAVE` (400) | Este arquivo não tem a chave privada. Use o A1 (.pfx exportado com a chave); certificado em token ou cartão (A3) não serve. |
| `CERTIFICADO_VENCIDO` (400) | Este certificado venceu em 10/03/2026. Envie o certificado renovado. |
| `CERTIFICADO_AINDA_NAO_VALE` (400) | Este certificado só vale a partir de 20/11/2026. |
| `CERTIFICADO_SEM_CNPJ` (400) | Este certificado não é de empresa (e-CNPJ): não encontrei CNPJ nele. |
| `EMPRESA_SEM_CNPJ` (400) | Preencha o CNPJ da empresa (painel Empresa) antes de enviar o certificado. |
| `CERTIFICADO_OUTRO_CNPJ` (400) | Este certificado é do CNPJ 99.888.777/0001-00 (OUTRA EMPRESA SA). O CNPJ da empresa é 12.345.678/0001-95. |
| `CERTIFICADO_NAO_ICP` (400) | Este certificado não é da ICP-Brasil; a SEFAZ não aceita. |
| `CERTIFICADO_CADEIA` (400) | A cadeia deste certificado não confere. Exporte o .pfx de novo ou fale com a certificadora. |
| `CERTIFICADO_SEM_SEGREDO` (503) | O servidor ainda não está pronto para guardar certificados. Avise o suporte. |

Avisos do painel (âmbar, sem bloquear):
- Mesma raiz: "Certificado de outro estabelecimento da mesma empresa (CNPJ 12.345.678/0002-76)."
- Cadeia: "Não consegui conferir a cadeia ICP-Brasil deste certificado. Ele foi guardado; a SEFAZ confere na hora de usar."
- Tipo `outro`: "Tipo de certificado incomum para nota fiscal (política 2.16.76.1.2.x). Confira com a certificadora."

**Porta para os projetos 3 e 4** (`certificado-digital.port.ts`, exportada pelo módulo; único caminho até a chave):
```ts
import type { KeyObject, X509Certificate } from 'node:crypto';

export const CERTIFICADO_DIGITAL = Symbol('CERTIFICADO_DIGITAL');
export interface CertificadoEmUso {
  chavePrivada: KeyObject;      // RSA nos A1 de hoje (tipo em asymmetricKeyType), nunca PEM solto. mTLS: chavePrivada.export({ type: 'pkcs8', format: 'pem' }) no ponto de uso
  certificado: X509Certificate; // da empresa; .toString() = PEM
  cadeia: X509Certificate[];    // intermediárias do caminho conferido (pode ser vazia)
  cnpj: string;                 // 14 caracteres, pode ter letras
  validoAte: Date;
  impressaoDigital: string;     // SHA-256 hex: o que pode ir para log/auditoria de quem assinou
}
export class CertificadoErro extends Error { // molde do LeituraPdfErro, sem `detalhe`
  constructor(message: string, readonly status: 422 | 503,
    readonly code: 'CERTIFICADO_NAO_CADASTRADO' | 'CERTIFICADO_ILEGIVEL' | 'CERTIFICADO_VENCIDO' | 'CERTIFICADO_OUTRO_CNPJ') { super(message); }
}
export interface CertificadoDigitalPort {
  /** Decifra a cada chamada (sem cache). NAO_CADASTRADO/ILEGIVEL → 503; VENCIDO/OUTRO_CNPJ → 422. */
  emUso(agora?: Date): Promise<CertificadoEmUso>;
}
```
Frases de uso:
- "Cadastre o certificado digital em Configurações."
- "O certificado salvo não pode ser lido (a chave do servidor mudou). Envie o .pfx de novo em Configurações."
- "O certificado digital venceu em DD/MM/AAAA. Envie o renovado em Configurações."
- `OUTRO_CNPJ` (só raiz diferente; mesma raiz segue valendo): a mesma frase do cadastro.

## Verificação

**Fixtures versionadas (minha)** em `api/src/modules/certificado-digital/__tests__/fixtures/`, senha `senha-de-teste`.
- Gerados uma vez por `api/scripts/gerar-certificados-teste.sh` e commitados. **Os testes nunca chamam `openssl`.** O `node:22-alpine` puro
  não tem `openssl` nem `bash` (conferido), e o script precisa dos dois e do provider legacy. Gerar a cada execução também custaria geração de
  chaves RSA a cada jest.
- Só há chaves de ACs fictícias ("TESTE NAO CONFIAVEL") e CNPJs inventados com DV válido. Nada é segredo. A `raiz-teste.pem` é injetada como
  âncora só nos testes, e o pacote de apoio de teste é a intermediária de teste.
- **Executado em 16/11** com OpenSSL 3.0.13 (Ubuntu local) e 3.5.9 (`node:22-alpine` + `apk add openssl bash`): cerca de 2 s, 15 arquivos.
  A codificação do SAN foi conferida byte a byte: `A0 10 04 0E "12345678000195"` (OCTET) e `A0 10 13 0E …` (Printable). `-legacy` gera
  `pbeWithSHA1And40BitRC2-CBC` (certificados) + `pbeWithSHA1And3-KeyTripleDES-CBC` (chave) + MAC SHA-1. Sem `-legacy` sai
  PBES2/AES-256-CBC + MAC SHA-256.
- O `x509 -days` não volta no tempo; `openssl ca -startdate/-enddate` volta, nas duas versões.
- A `raiz-teste.pem` e o `fora-da-icp.pfx` começam a valer no dia em que o script roda. O relógio injetado dos casos válidos tem de ser
  posterior a esse dia (sugestão: 2027-06-01). As folhas valem de 01/01/2026 a 01/01/2036, e a intermediária até 2040.
- Um .pfx com chave que não bate com o certificado não dá para gerar: o `pkcs12 -export` recusa ("No cert … matches private key",
  conferido). Esse caso é testado com o par PEM direto na função pura.

```bash
#!/usr/bin/env bash
# api/scripts/gerar-certificados-teste.sh <pasta>: .pfx de TESTE (ACs falsas, CNPJs fictícios com DV válido)
set -euo pipefail
mkdir -p "${1:?pasta de saída}"; OUT=$(cd "$1" && pwd)
cd "$(mktemp -d)"; mkdir db; : > db/index.txt; echo 1000 > db/serial
P=pass:senha-de-teste; A1=2.16.76.1.2.1.999; CNPJ_SAN='otherName:2.16.76.1.3.3;OCTETSTRING:'
DN="/C=BR/O=ICP-Brasil/OU=TESTE/CN=EMPRESA DE TESTE LTDA:12345678000195"
export POL=$A1 SAN="otherName:2.16.76.1.3.4;OCTETSTRING:01011980111444777350000000000000000000000000000000000SSPSP,\
otherName:2.16.76.1.3.2;OCTETSTRING:FULANO DE TAL,${CNPJ_SAN}12345678000195,otherName:2.16.76.1.3.7;OCTETSTRING:000000000000"
cat > ca.cnf <<'EOF'
[ca]
default_ca = ac
[ac]
database = db/index.txt
serial = db/serial
new_certs_dir = .
default_md = sha256
policy = livre
unique_subject = no
[livre]
countryName = optional
organizationName = optional
organizationalUnitName = optional
commonName = supplied
serialNumber = optional
[ac_teste]
basicConstraints = critical,CA:TRUE
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
[folha]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation,keyEncipherment
extendedKeyUsage = clientAuth,emailProtection
certificatePolicies = ${ENV::POL}
subjectAltName = ${ENV::SAN}
[folha_sem_san]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,nonRepudiation
extendedKeyUsage = clientAuth
certificatePolicies = ${ENV::POL}
EOF
k() { openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:2048 -out "$1.key" 2>/dev/null; }
ac() { k "$1"; openssl req -new -x509 -key "$1.key" -out "$1.pem" -days 7300 -config ca.cnf -extensions ac_teste -subj "$2"; }
# folha <nome> <DN> <seção> [início] [fim] [emissor]
folha() {
  k "$1"; openssl req -new -key "$1.key" -out "$1.csr" -subj "$2"
  openssl ca -batch -notext -config ca.cnf -cert "${6:-inter}.pem" -keyfile "${6:-inter}.key" -extensions "$3" \
    -in "$1.csr" -out "$1.pem" -startdate "${4:-20260101000000Z}" -enddate "${5:-20360101000000Z}" 2>/dev/null
}
pfx() { openssl pkcs12 -export -inkey "$1.key" -in "$1.pem" -passout $P -out "$OUT/$2" "${@:3}"; }

ac raiz "/C=BR/O=ICP-Brasil/OU=TESTE NAO CONFIAVEL/CN=AC Raiz de Teste"
k inter; openssl req -new -key inter.key -out inter.csr -subj "/C=BR/O=ICP-Brasil/OU=TESTE NAO CONFIAVEL/CN=AC Intermediaria de Teste"
openssl ca -batch -notext -config ca.cnf -cert raiz.pem -keyfile raiz.key -extensions ac_teste -in inter.csr -out inter.pem \
  -startdate 20250101000000Z -enddate 20400101000000Z 2>/dev/null
cat inter.pem raiz.pem > cadeia.pem; cp raiz.pem "$OUT/raiz-teste.pem"

folha a1 "$DN" folha
pfx a1 valido.pfx -certfile cadeia.pem                  # PBES2/AES-256-CBC, MAC SHA-256 (padrão do OpenSSL 3)
pfx a1 legado.pfx -certfile cadeia.pem -legacy          # RC2-40 nos certificados, 3DES na chave, MAC SHA-1
pfx a1 so-certificado-final.pfx                         # sem a cadeia
openssl pkcs12 -export -nokeys -in a1.pem -certfile cadeia.pem -passout $P -out "$OUT/sem-chave.p12"
folha venc "$DN" folha 20200101000000Z 20210101000000Z && pfx venc vencido.pfx -certfile cadeia.pem
folha fut "$DN" folha 20350101000000Z 20360101000000Z && pfx fut ainda-nao-vale.pfx -certfile cadeia.pem
export SAN="${CNPJ_SAN}99888777000100"
folha outro "/C=BR/O=ICP-Brasil/OU=TESTE/CN=OUTRA EMPRESA SA:99888777000100" folha && pfx outro outro-cnpj.pfx -certfile cadeia.pem
export SAN="otherName:2.16.76.1.3.3;PRINTABLESTRING:12345678000276"
folha filial "/C=BR/O=ICP-Brasil/OU=TESTE/CN=EMPRESA DE TESTE LTDA:12345678000276" folha && pfx filial mesma-raiz-filial.pfx -certfile cadeia.pem
export SAN="${CNPJ_SAN}12ABC34501DE35"
folha alfa "/C=BR/O=ICP-Brasil/OU=TESTE/CN=EMPRESA ALFA LTDA:12ABC34501DE35" folha && pfx alfa cnpj-alfanumerico.pfx -certfile cadeia.pem
export SAN="otherName:2.16.76.1.3.1;OCTETSTRING:01011980123456789090000000000000000000000000000000000SSPSP"
folha pf "/C=BR/O=ICP-Brasil/OU=TESTE/CN=FULANO DE TAL:12345678909" folha && pfx pf ecpf.pfx -certfile cadeia.pem
export POL=2.16.76.1.2.3.999 SAN="${CNPJ_SAN}12345678000195"
folha a3 "$DN" folha && pfx a3 politica-a3.pfx -certfile cadeia.pem
export POL=2.16.76.1.2.201.999
folha se "/C=BR/O=ICP-Brasil/CN=EMPRESA DE TESTE LTDA/serialNumber=12345678000195" folha_sem_san && pfx se selo-se-s.pfx -certfile cadeia.pem
export POL=$A1
ac falsa "/C=BR/O=ICP-Brasil/OU=TESTE NAO CONFIAVEL/CN=AC Intermediaria de Teste"   # mesmo nome, outra chave
folha adult "$DN" folha 20260101000000Z 20360101000000Z falsa && pfx adult cadeia-adulterada.pfx -certfile cadeia.pem
k fora; openssl req -new -x509 -key fora.key -out fora.pem -days 3650 -subj "/C=BR/O=Qualquer/CN=EMPRESA DE TESTE LTDA:12345678000195" \
  -addext "subjectAltName=${CNPJ_SAN}12345678000195"
pfx fora fora-da-icp.pfx
ls "$OUT"
```

**Testes**
- **jest:** uma linha por mensagem.
  - Abertura: o `legado` abre; o `sem-chave` dá `SEM_CHAVE`.
  - CNPJ: pelo SAN em OCTET (`valido`) e em Printable (`mesma-raiz-filial`, aceito com aviso); pelo `serialNumber` (`selo-se-s`, tipo
    `SE-S`); pelo CN (função pura); alfanumérico. SAN só com zeros conta como ausente; `ecpf` dá `SEM_CNPJ`.
  - Validade e tipo: `vencido`/`ainda-nao-vale` com o relógio injetado; `politica-a3` aceito com `tipo = 'outro'`.
  - Cadeia: `cadeia-adulterada` dá `CADEIA`; `fora-da-icp` dá `NAO_ICP`. `so-certificado-final` sai com `cadeia_conferida = false` com o
    pacote vazio e com `true` quando o pacote tem a intermediária de teste.
  - Outros: par chave/certificado; segredo trocado dá `ilegivel`; precedência de `situacao`.
- **jest (âncoras):** as impressões digitais do módulo gerado batem com a tabela acima, e todo certificado do pacote fecha numa âncora (offline).
- **jest (vazamento):** GET/PUT serializados sem `BEGIN`, `PRIVATE`, a senha nem trecho do base64. `JSON.stringify` e `util.inspect` de
  `CertificadoEmUso` sem material da chave.
- **jest (porta e permissões):** `emUso()` com cada erro; chave de IA antiga ainda decifrável depois de mover o `cripto.ts`;
  `permissoes-protecao.spec.ts` com 3 rotas `admin` e a lista da loja igual.
- **smoke:** PUT/GET/DELETE de ponta a ponta; loja = 403; histórico com 3 linhas.

**Não coberto:**
- Certificado real: nenhum e-CNPJ real foi inspecionado. Os perfis foram conferidos só nos documentos do ITI e nas PCs; o dono envia o dele
  depois de subir.
- Aceite pela SEFAZ do SE-S e da cadeia (projeto 3): não encontrei nota técnica que confirme o SE-S.
- O formato exato do `serialNumber` no SE-S real (o perfil diz só "número CNPJ").

## Decisões do dono (16/11/2026)

1. **CNPJ do certificado:** é o próprio CNPJ de Valinhos ("acho que é do CNPJ de Valinhos mesmo").
   - Igual ao de `configuracoes.cnpj` → aceita.
   - Mesma raiz (8 primeiros caracteres), outro estabelecimento → aceita com aviso na tela.
   - Raiz diferente → recusa.
   - A regra de CNPJ da distribuição de DF-e e da NFC-e fica a conferir no projeto 3.
2. **Quem pode:** qualquer admin envia, substitui e remove o certificado; o histórico registra quem fez o quê e quando.
3. **Aviso de vencimento:** só na tela (painel + faixa no topo para admin). Nada de WhatsApp/e-mail.
4. **Direção geral aprovada:**
   - chave + certificado + cadeia cifrados em tabela própria, com a senha descartada após o cadastro;
   - segredo próprio `CERTIFICADO_SECRET`;
   - node-forge só no cadastro;
   - nenhuma chamada à SEFAZ nesta etapa.
5. **Ramo:** `feat/certificado-digital`, em cima de `feat/nota-por-foto` (não depende de merge no `master`).

## Fontes

- DOC-ICP-04 v8.3 compilado (Res. 179/2020 com alterações até a Res. 215/2025): §1.1, Tabela 3 (OIDs de PC), §7.1.2.2 (otherName),
  Anexo I tabela 2 (selo eletrônico PJ) — https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais/resolucao179_doc-icp-04_compilada.pdf
- DOC-ICP-04.01 v5.0 (atribuição de OID) — https://www.gov.br/iti/pt-br/assuntos/legislacao/documentos-principais/IN2020_15_DOCICP_04.01.pdf
- Res. CG ICP-Brasil nº 211/2024 (arts. 2, 3, 7, 8, 13, 14) — https://repositorio.iti.gov.br/resolucoes/Resolucao211_pauta_modernizante.htm
- PC AC IDFEDERAL A1 v1.1 (Serpro, mar/2025; perfil e-CNPJ A1, CN "Nome Empresarial:CNPJ") — https://repositorio.serpro.gov.br/docs/pcacidfederala1.pdf
- PC AC SERPRO ACF SE-S v1.0 (nov/2025; `serialNumber = <número CNPJ>`; o OID da política aparece como 201.18 no §1.2.1 e 202.18 na capa e no perfil) — https://ccd.serpro.gov.br/serproacf/docs/pcserproacfSES.pdf
- ITI, repositório da AC Raiz — https://www.gov.br/iti/pt-br/assuntos/repositorio/repositorio-ac-raiz (arquivos em
  `https://acraiz.icpbrasil.gov.br/credenciadas/RAIZ/ICP-Brasilv{N}.crt`)
- ITI, Cadeia Vigente — https://www.gov.br/iti/pt-br/assuntos/repositorio/certificados-das-acs-da-icp-brasil-arquivo-unico-compactado
  (`https://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip` e `hashsha512.txt`)
- RFB, perguntas e respostas do CNPJ alfanumérico (formato, raiz, DV ASCII − 48, numéricos continuam válidos) —
  https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/perguntas-e-respostas/cnpj/cnpj-alfanumerico.pdf
- node-forge: alertas — https://github.com/digitalbazaar/forge/security/advisories ; versões — https://www.npmjs.com/package/node-forge
- OpenSSL: a sintaxe de `otherName` (`OCTETSTRING:`/`PRINTABLESTRING:`) e de `certificatePolicies` usada no script foi conferida por execução (3.0.13 e 3.5.9).
