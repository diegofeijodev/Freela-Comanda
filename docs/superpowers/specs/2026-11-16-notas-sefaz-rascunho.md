# Notas da SEFAZ puxadas sozinhas (Distribuição DF-e + Ciência automática) — RASCUNHO de desenho

Data: 16/11/2026 · Nada implementado; nenhuma chamada à SEFAZ (nem homologação) foi feita · Base: ramo `chore/atualizar-fastify-zod`.
3º de quatro projetos (foto → certificado A1 → **notas da SEFAZ** → NFC-e). Decisão do dono (16/11): Ciência da Operação **automática**.
Consome a porta `CERTIFICADO_DIGITAL`; deixa para a NFC-e o transporte SOAP com mTLS, a assinatura XML e o leitor de XML. Marcas: *conferido* =
li no documento citado; *minha* = decisão do construtor; *não confirmado* = sem fonte primária.

## Por quê

Hoje uma NF-e de fornecedor só entra se alguém tiver o XML, o PDF ou o papel. A SEFAZ (Ambiente Nacional) já tem todas as NF-e emitidas
contra o CNPJ, e o A1 cadastrado permite buscá-las. O Diego quer que elas apareçam sozinhas na Entrada de Notas, com os itens, para conferir.

## O que muda para quem usa (só admin)

1. Configurações → painel "Notas da SEFAZ": interruptores "Buscar notas na SEFAZ" e "Registrar a Ciência da Operação automaticamente", com o
   texto "a ciência é registrada na SEFAZ em nome da empresa"; ligar e desligar gravam quem e quando. Vêm desligados.
2. Entrada de Notas ganha, acima do campo de arquivo, a caixa de entrada:
```
Notas da SEFAZ · última busca 14:05 (nada novo) · próxima a partir de 15:06                        [Buscar agora]
Fornecedor                 Emissão  Valor (R$)  Situação
ATACADÃO S.A.              14/11      1.234,56  Pronta para conferir                                     [Conferir]
DISTRIB. BEBIDAS XYZ       15/11        890,00  Ciência registrada 15/11 10:02 · aguardando itens
FRIGORÍFICO ABC            02/11      2.100,00  Já lançada (NF 4411, por FOTO em 03/11)
CERVEJARIA K               16/11          0,00  Não parece compra: REMESSA EM COMODATO                     [Ignorar]
LATICÍNIOS K               10/11        320,00  CANCELADA pelo fornecedor depois de lançada — confira o estoque
                                                                                     [A conferir ▾ | Todas]
```
3. "Conferir" abre a **mesma** tela de conferência de hoje, preenchida pelo mesmo `parseNFeXML` do navegador, com origem `SEFAZ`. "Dar entrada"
   não muda: nada entra no estoque sem conferência. "Ignorar" pede motivo (já lancei de outro jeito / não é compra / não reconheço / outro) e
   pode ser desfeito.
4. O que esperar (fontes na próxima seção): a nota chega primeiro como resumo (fornecedor, valor, data); os itens vêm numa busca seguinte à
   ciência, **no mínimo cerca de 1 h depois**. Notas de antes da primeira busca podem não vir (regra dos 60 dias). Nota autorizada há mais de
   10 dias não aceita ciência e entra por arquivo ou foto. Cupom de mercado (NFC-e), CT-e e NFS-e não vêm por aqui: continuam por foto/arquivo.

## Metas, o que fica de fora, o que não pode acontecer

- **Metas:** toda NF-e (modelo 55) destinada ao CNPJ aparece sozinha, com os itens e insumos sugeridos; lista do que falta lançar; nenhuma
  colisão com o sistema do contador; tudo leve (uma chamada por hora, uma instância).
- **Fora:** manifestação conclusiva e Desconhecimento (perguntas 2 e 3); estorno de nota já lançada (pergunta 5); CT-e, NFS-e, NFC-e
  (projeto 4); importar vários XML de uma vez (plano B da pergunta 1); mais de um CNPJ.
- **Não pode:** consultar antes da espera da NT (o 656 bloqueia o CNPJ inteiro, inclusive para o contador); `rejectUnauthorized: false`; chave
  ou PEM em log; teste fazendo rede; a loja alcançar rota nova; ato fiscal sem registro de quem ligou o automático; vir ligado de fábrica.

## Regras da SEFAZ que amarram o desenho (conferido, salvo marca)

| Regra | Fonte |
|---|---|
| **Endereços.** Produção: `https://www1.nfe.fazenda.gov.br/NFeDistribuicaoDFe/NFeDistribuicaoDFe.asmx` (serviço 1.00) e `https://www.nfe.fazenda.gov.br/NFeRecepcaoEvento4/NFeRecepcaoEvento4.asmx` (4.00). Homologação: mesmos caminhos em `https://hom1.nfe.fazenda.gov.br/`. | Portal NF-e e Portal de Homologação, "Relação de Serviços Web", AN (lidos em 16/11/2026) |
| **Distribuição.** Método `nfeDistDFeInteresse`; `distDFeInt versao="1.01"`; `tpAmb` 1/2; `cUFAutor` opcional (0-1) — *minha:* mandamos 35 (SP), como no exemplo da NT; `CNPJ` tipo C desde 08/07/2026 (v1.40) e `chNFe` desde 01/07/2026 (NT 2026.004). O exemplo usa envelope SOAP 1.1 sem cabeçalho, com `nfeDadosMsg` no ns `…/nfe/wsdl/NFeDistribuicaoDFe`. Pedido ≤ 10 KB (214). | NT 2014.002 v1.40 §3.1, §3.9, §5; PL_NFeDistDFe_104 (`TVerDistDFe` = 1.01); NT 2026.004 v1.01 §7 |
| **Evento.** Método `nfeRecepcaoEvento`; SOAP 1.2; nos serviços 4.00 não há `nfeCabecMsg`. `envEvento versao="1.00"`, `idLote` nosso, 1–20 eventos. `infEvento Id` = "ID" + tpEvento + chave + nSeq com 2 dígitos (54); `cOrgao` = 91; `CNPJ` = destinatário; `dhEvento` com fuso `±hh:00`, sem `Z`; `nSeqEvento` = 1; `verEvento` = 1.00; `descEvento` = `Ciencia da Operacao`. CNPJ e chave tipo C desde 01/07/2026. | NT 2020.001 v1.60 §6.3.1; MOC 7.0 §4.2.2, §4.4.1, §5.8.1, §5.11; NT 2026.004 v1.01 §4; `TDateTimeUTC` (tiposBasico_v1.03) |
| **Assinatura.** XMLDSig *enveloped*, só o `X509Certificate` da folha; C14N 2001-03-15 no `CanonicalizationMethod` e nos Transforms (+ enveloped-signature); `rsa-sha1`; digest `sha1`; `Reference URI="#ID…"` do `infEvento`; `Signature` irmã de `infEvento`, dentro de `evento`. Nas NT que abri (2026.001–2026.010 e 2025.002 v1.53) nada muda isso; as republicadas em 2026 não foram abertas (ver "Não confirmado"). | MOC 7.0 (nov/2020) §4.2.4, Tabela 4-2; NT 2020.001 P91 |
| **Certificado na SEFAZ** (mais rígida que o nosso cadastro): TLS 1.2+ mútuo; clientAuth (280); OtherName `2.16.76.1.3.3` (473); LCR no certificado (286); raiz ICP (285). CNPJ-base do certificado = do consultado (593) = do autor do evento (213). | MOC 7.0 §4.2.2–4.2.3; NT 2014.002 §3.8, §3.10.2; NT 2020.001 §6.3.6 |
| **Consultas.** `distNSU`: a partir do último `ultNSU` devolvido, até 50 por lote, em ordem de NSU. `consNSU`: só NSU faltante. `consChNFe`: uma NF-e, sem eventos, sem NSU prévio desde a v1.15. Cada `docZip` vem em gzip + base64, com `NSU` e `schema` (`resNFe`, `procNFe`, `resEvento`, `procEventoNFe`). | NT 2014.002 §3.1–3.7 |
| **Consumo.** Com 137, ou com `ultNSU == maxNSU`, esperar 1 h. Consultar antes = 656, e **o CNPJ fica bloqueado 1 h** (tentar de novo zera a contagem). Fora da sequência = 656. Aplicações diferentes no mesmo CNPJ (14) têm de seguir a mesma sequência. `consNSU`/`consChNFe` ≤ 20/h. O 656 do `distNSU` devolve o `ultNSU` da última consulta do CNPJ (v1.14). A NT **não** fixa intervalo depois de 138 com `ultNSU < maxNSU`, nem limite por hora para `distNSU`. | NT 2014.002 §3.5, §3.11.4 |
| **Janela.** Documentos ficam 90 dias no AN; `ultNSU = 0` traz no máximo os últimos 3 meses. **Só há NSU para o CNPJ-base que usou `distNSU` nos últimos 60 dias:** no primeiro uso vem 137 e nada retroativo. Parar por mais de 60 dias deixa um buraco sem volta. | NT 2014.002 §3.1 A08, §3.4 a–c e Obs1–2, §3.5 |
| **Papel.** O destinatário só recebe o resumo e o cancelamento até se manifestar (ciência, confirmação ou não realizada; desconhecimento não libera). Depois, o AN gera um NSU novo com a NF-e. Transportador (X03 ou "Ator Interessado") e `autXML` recebem a NF-e inteira, salvo se forem também o destinatário. O emitente não recebe (641). | NT 2014.002 §3 (tabela e notas 1–3), §3.4, §3.11.3 passo 6 |
| **Ciência (210210).** Opcional e não conclusiva; prazo de **10 dias** da autorização (596 fora disso). Não cabe depois da conclusiva (655). NF-e cancelada/denegada = 650; repetida = 573. A conclusiva tem 90 dias (Ajuste SINIEF 14/26), "nos casos de obrigatoriedade" do Anexo II do Ajuste 07/05: combustível, álcool a granel, distribuidor/atacadista de cigarro e bebida. Restaurante não está na lista; regra própria de SP **não confirmada** (contador). | NT 2020.001 v1.60 §3 D–E, §4, §5, §6.3.8 (não li o Ajuste nem a legislação de SP) |
| **Data do evento:** ≤ processamento + 5 min (578); ≥ emissão (577) e ≥ autorização (579). | NT 2020.001 §6.3.7 |
| **O que não vem.** A NT só trata NF-e, e no `consChNFe` a chave de modelo ≠ 55 é recusada (618); daí *infiro* que NFC-e 65 e CF-e SAT ficam fora. CT-e e NFS-e têm distribuição própria (*não confirmado nesta pesquisa*). | NT 2014.002 §2, §3.10.2 H12 |
| **Chave com CNPJ alfanumérico:** `[0-9]{6}[A-Z0-9]{12}[0-9]{26}`, DV com ASCII − 48. | NT Conjunta 2025.001 v1.00 §5 |

## Abordagens e recomendação (pontos 1–8)

| Ponto | Opções e troca | Recomendação (minha) |
|---|---|---|
| 1. Agendamento | (a) **Timer na API:** `setInterval` de 5 min com `unref`, sem dependência nova; o horário da próxima consulta fica no banco, e o reinício não a antecipa. (b) **Cron do host chamando uma rota:** mais uma peça na EC2 dividida, e um segredo novo. (c) **Só botão:** perde o prazo de 10 dias da ciência. | **(a) + "Buscar agora"**, que segue o mesmo relógio e nunca fura a espera. Exclusão por `pg_try_advisory_xact_lock` em **duas transações curtas**, com o HTTP fora delas (ver Ciclo). |
| 2. SOAP, mTLS, XML | **Transporte:** `node:https` com `key`/`cert` do `emUso()`; `ca` = `tls.rootCertificates` + raízes do `icp-brasil.gerado.ts`; TLS 1.2+; 30 s; sem keep-alive; envelope por template, sem biblioteca SOAP. **Leitor:** (a) `@xmldom/xmldom` 0.9.12 (0 dependências; 15+ alertas em 2026, todos corrigidos na 0.9.12); (b) `fast-xml-parser` 5.12.1 (6 dependências, ~10 alertas em 2026); (c) regex (frágil). **Assinatura:** (a) à mão com `node:crypto` e forma canônica por construção (~100 linhas nossas); (b) `xml-crypto` 6.4.0 em produção (+3 dependências, prende o xmldom 0.8; os alertas críticos de 2024–25 são na verificação). | **xmldom 0.9.12 exato**, num adaptador só: DOCTYPE recusado antes do parse e teto de tamanho. **Assinatura à mão; `xml-crypto` só como devDependency**, de oráculo nos testes. A NFC-e reaproveita transporte, CA, assinador, serializador e leitor. |
| 3. Dados | (a) Estado por ambiente e CNPJ + log de consultas + documentos crus + caixa por chave + manifestações. (b) Só a caixa: perde reprocessamento e prova das esperas. (c) Arquivos em disco: ficam fora do backup. | **(a)** (abaixo). "Lançada" é **derivado** (junção por chave com `notas_entrada`), não gravado. |
| 4. Fluxo | (a) Caixa na Entrada de Notas → mesma tela. (b) Tela nova separada. (c) Lançar o XML sem conferir: proibido. | **(a).** Mesma chave já lançada = "Já lançada", e não manda ciência. Lançada por foto/PDF sem chave = aviso "parece já lançada" (mesmo CNPJ, valor ±1%, data ±5 dias). Não reconhece = Ignorar com motivo. Cancelada depois de lançada = faixa vermelha, sem mexer no estoque. |
| 5. Insumo dos itens | (a) IA recebe só descrição e unidade das linhas sem vínculo, mais a lista de insumos (`textoCatalogo`/`limparItens`), quando a nota é aberta. (b) Só vínculo + palavras, como hoje: custo zero, mas fraco na 1ª nota de cada fornecedor. (c) IA na hora da busca: paga até pela nota que vai ser ignorada. | **Vínculo > IA > "Cadastrar novo"** (a com b antes). Não saem CNPJ, valores nem o XML. Um pedido de texto por nota nova, cujo tamanho vem quase todo da lista de insumos: centavos (não medido). A porta `LEITOR_PDF` passa a aceitar pedido sem arquivo. |
| 6. Ciência automática | (a) Assim que o resumo chega. (b) Só para fornecedor conhecido: o desconhecido perde os 10 dias. (c) Depois de uma espera: só atrasa o XML, porque a ciência não confirma nada e o desconhecimento continua possível. | **(a)**, para resumo com `cSitNFe=1`, `tpNF=1`, autorizado há ≤ 9 dias, chave não lançada nem ignorada e sem manifestação. Lotes de até 20. **Retornos:** 573 e 655 = já manifestada (ok); 650 = cancelada; 596 = "prazo passou, envie por arquivo"; 280–298 e 213 desligam a ciência; o resto tenta até 3 vezes. |
| 7. Ambientes | `SEFAZ_DFE_AMBIENTE` = `desligado` (padrão) \| `homologacao` \| `producao`, no compose e no `.env.prod.example`, mais os dois interruptores da tela. Testes: porta `SEFAZ_DFE` com falso e respostas fictícias gravadas. | **Homologação** (hom1, certificado real) prova mTLS, cadeia, envelope e assinatura, mas **não** o ciclo resumo → ciência → XML: para isso precisaria de NF-e de teste emitida contra o CNPJ (NT 2020.001 Anexo I). **Produção** só com "eu autorizo" do dono **antes da 1ª consulta**, mesmo só de leitura, porque começa a gerar NSU e pode colidir com o contador. |
| 8. Falhas | A tabela abaixo. | Nunca consultar antes da hora. Tudo vai para o log de consultas. Frase fixa na tela, código no log. |

## Como (decisões minhas)

**Ciclo** (o timer acorda a cada 5 min e olha o banco; o botão chama o mesmo código)
1. **Condições:** ambiente ≠ `desligado`, busca ligada, `agora ≥ proxima_consulta_em` e `≥ bloqueado_ate`, `emUso()` sem erro, CNPJ de `configuracoes` válido.
2. **Transação 1, sob a trava:** relê o estado, grava a linha da consulta e empurra `proxima_consulta_em` para +65 min (pessimista). Depois, fora da transação, o `distNSU`.
3. **Transação 2, sob a trava:** grava cada `docZip` cru (base64 → `gunzip` com `maxOutputLength` 2 MB; único por ambiente + NSU), `ultNSU`/`maxNSU`, cStat e o horário certo:
   138 com `ultNSU < maxNSU` → nova página já (até 10 por ciclo); 137 ou `ultNSU == maxNSU` → +65 min. Queda entre a chamada e a transação 2 deixa o rastro e a espera.
4. **Classificação** (passo à parte, reprocessável por `processado_em`): `resNFe` cria/atualiza a nota; `procNFe` anexa o XML (destinatário ≠ CNPJ → `papel`
   transportador/terceiro, ignorada sozinha; `tpNF=0` ou `finNFe=4` → "não parece compra"); evento 110111 → `cancelada`; 110110 → guarda o texto da correção.
5. **Ciências** pendentes num lote; cada uma é gravada como "enviando" antes do envio (numa queda, o reenvio volta 573, que conta como ok).
6. **Detectores de conflito:** 1ª consulta em produção com 138 e documentos antigos = indício (não prova) de outro sistema no mesmo CNPJ-base, já que pela §3.4
   o primeiro uso daria 137 → a busca para e pede confirmação. Dois 656 em 24 h, mesmo seguindo o `ultNSU` devolvido, desligam a busca.
7. **Relógio:** `dhEvento` = relógio do servidor no fuso de São Paulo; diferença > 2 min para o `dhResp` da última resposta = nenhum evento enviado.

| Situação | Ação | O que o admin vê (faixa na caixa) |
|---|---|---|
| Certificado ausente, ilegível, vencido ou de outro CNPJ (`CertificadoErro`) | não chama; tenta no ciclo seguinte | a frase `MSG_USO` da porta do certificado |
| 280–286, 473 (transmissão) | desliga a busca | "A SEFAZ recusou o certificado (código N). Confira o certificado em Configurações." |
| 290–298, 213 (assinatura) | desliga a ciência | "A SEFAZ recusou a assinatura da ciência (código N). Avise o suporte." |
| Falha antes de enviar (DNS, conexão recusada, handshake TLS) | +15, +30, +60 min | "Não consegui falar com a SEFAZ. Nova tentativa às HH:MM." |
| Pedido enviado sem resposta (tempo esgotado, conexão caída) | mantém os +65 min da transação 1 (pode ter sido um 137) | a mesma frase |
| 108/109 | +60 min | "A SEFAZ está fora do ar. Nova tentativa às HH:MM." |
| 656 | `bloqueado_ate` +65 min; se o `ultNSU` devolvido (v1.14) for maior que o nosso, **adota o devolvido** e grava a lacuna (preenchida por `consNSU` na etapa 4; até lá, esses resumos faltam) | "A SEFAZ pediu para esperar. Próxima busca às HH:MM." |
| 589, 593, 215 ou resposta ilegível | não avança o `ultNSU`; para | "A busca parou por erro de configuração (código N). Avise o suporte." |
| 578 ou relógio desviado | não envia eventos | "O relógio do servidor está errado; a ciência está parada." |

## Modelo de dados (migração nova, pt-BR; dezenas de notas/mês → poucos MB/ano)

- **`sefaz_distribuicao`** (PK `ambiente smallint CHECK IN (1,2)` + `cnpj char(14)`): `ult_nsu bigint NOT NULL DEFAULT 0` (15 dígitos cabem), `max_nsu`;
  agenda `proxima_consulta_em`, `bloqueado_ate`, `primeira_consulta_em`; interruptores `busca_ligada`, `ciencia_automatica`, `ligada_por`, `ligada_por_nome`,
  `ligada_em`; `situacao` (ok | parada_certificado | parada_conflito | parada_config), `mensagem`.
- **`sefaz_consultas`** (só inserção; a prova de que as esperas foram respeitadas, ~9 mil linhas/ano): `servico` (distNSU | consNSU | consChNFe | evento),
  `origem` (timer | botao), `ult_nsu_enviado`, `iniciada_em`, `terminada_em`, `c_stat`, `x_motivo`, `ult_nsu`, `max_nsu`, `documentos`, `erro_code`.
- **`sefaz_documentos`** (só inserção): `nsu bigint`, `schema`, `tipo` (resNFe | procNFe | resEvento | procEventoNFe | outro), `chave varchar(44)`, `tp_evento`,
  `xml text`, `recebido_em`, `processado_em`; UNIQUE (ambiente, nsu), índice em `chave`. ~10 KB por NF-e (NT 2014.002 §3.3). Também é a guarda do XML pelo
  destinatário (Ajuste 07/05 cl. 10ª — *não conferido*).
- **`notas_sefaz`** (a caixa; `id uuid`, UNIQUE ambiente + chave): `chave CHECK ~ '^[0-9]{6}[0-9A-Z]{12}[0-9]{26}$'`, `emitente_cnpj`, `emitente_nome`,
  `emitida_em`, `autorizada_em`, `valor_total numeric(15,2)`, `tp_nf`, `nat_op`, `documento_completo_id`; `situacao_sefaz` (autorizada | cancelada | denegada);
  `papel` (destinatario | transportador | terceiro); `etapa` (resumo | ciencia_enviada | ciencia_fora_do_prazo | ciencia_recusada | completa);
  `ignorada_em`, `ignorada_por`, `motivo_ignorar` (CHECK: ignorada ⇒ motivo).
- **`sefaz_manifestacoes`** (só inserção; o registro do ato fiscal): `chave`, `tp_evento`, `n_seq`, `id_lote` (sequência), `dh_evento`; autoria `autor`
  (automatico | usuario), `usuario_id`, `ligada_por_nome`, `certificado_impressao char(64)`; retorno `situacao` (enviando | respondida), `c_stat`, `x_motivo`,
  `n_prot`, `dh_reg_evento`, `xml_enviado`, `xml_retorno`.
- **`notas_entrada.origem`** aceita `'sefaz'` (DTO `@IsIn`).
- **Pré-requisito (etapa 0), CNPJ alfanumérico:** `dto.chave?.replace(/\D/g,'')` (`notas.service.ts`), `chave44` (`leitura-pdf.service.ts`) e o campo CNPJ
  da tela apagam as letras. Trocar por maiúsculas + `[^0-9A-Z]`.

## Rotas (`modules/notas-sefaz`, todas `@AdminOnly()` no `permissoes-protecao.spec.ts`; a lista da loja não muda)

- `GET /v1/notas-sefaz?filtro=conferir|todas`: a caixa, com `lancada_em`, `lancada_origem` e `parece_lancada`.
- `GET /v1/notas-sefaz/situacao`: interruptores, última consulta, próxima, bloqueio, mensagem.
- `PUT /v1/notas-sefaz/configuracao` `{ busca_ligada, ciencia_automatica }`: grava quem e quando. Com o ambiente desligado, 503 `SEFAZ_DESLIGADA`.
- `POST /v1/notas-sefaz/buscar`: um ciclo agora; 409 `SEFAZ_AGUARDE` "A SEFAZ só permite nova busca a partir de 15:06." ou 409 `SEFAZ_OCUPADA` "Já existe uma busca em andamento."
- `GET /v1/notas-sefaz/:id/xml`: o `procNFe` em `text/xml`; 404 se só houver o resumo.
- `POST /v1/notas-sefaz/:id/ignorar` `{ motivo }` · `POST /v1/notas-sefaz/:id/reabrir`.
- `POST /v1/notas/sugerir-insumos` `{ itens: [{ descricao, unidade }] }` (≤ 200) → `ItemLido[]`. Vale também para XML enviado à mão.

## A porta da SEFAZ (`modules/sefaz/sefaz.port.ts`) e o que a NFC-e reaproveita

```ts
import type { CertificadoEmUso } from '../certificado-digital/certificado-digital.port';
export const SEFAZ_DFE = Symbol('SEFAZ_DFE');
export type AmbienteSefaz = 1 | 2; // tpAmb: 1 = produção, 2 = homologação
export type PedidoDistribuicao = { distNSU: bigint } | { consNSU: bigint } | { consChNFe: string };
export interface DocumentoDistribuido { nsu: bigint; schema: string; xml: string } // já fora do base64/gzip
export interface RespostaDistribuicao {
  cStat: number; xMotivo: string; dhResp: string; ultNsu: bigint | null; maxNsu: bigint | null; documentos: DocumentoDistribuido[]; // 0–50
}
export interface Manifestacao { chave: string; tpEvento: '210210' | '210200' | '210220' | '210240'; nSeq: 1 | 2; dhEvento: Date; xJust?: string }
export interface RetornoManifestacao {
  chave: string; cStat: number; xMotivo: string; nProt: string | null; dhRegEvento: string | null; xmlEnviado: string; xmlRetorno: string;
}
export class SefazErro extends Error { // não é HttpException (o serviço traduz); sem corpo de resposta nem material do certificado
  constructor(message: string, readonly code: 'SEFAZ_REDE' | 'SEFAZ_TLS' | 'SEFAZ_TEMPO' | 'SEFAZ_RESPOSTA_INVALIDA') { super(message); }
}
export interface SefazDfePort {
  /** Uma chamada ao NFeDistribuicaoDFe do AN. Não decide QUANDO chamar: as esperas da NT 2014.002 §3.11.4 são do serviço. */
  distribuir(cert: CertificadoEmUso, amb: AmbienteSefaz, cnpjInteressado: string, pedido: PedidoDistribuicao): Promise<RespostaDistribuicao>;
  /** Um lote (1–20) no NFeRecepcaoEvento4 do AN (cOrgao 91); cada infEvento assinado com o certificado. */
  manifestar(cert: CertificadoEmUso, amb: AmbienteSefaz, cnpjAutor: string, idLote: bigint, eventos: Manifestacao[]):
    Promise<{ cStat: number; xMotivo: string; retornos: RetornoManifestacao[] }>;
}
```

A NFC-e reaproveita `modules/sefaz/` e só acrescenta `autorizar`/`cancelar` (URLs da SEFAZ-SP): `transporte-mtls.ts` (POST SOAP + `ca` ICP), `assinatura-xml.ts`
(`assinar(elementoCanonico, id, cert)`, serve para `infNFe Id="NFe…"`), `xml-canonico.ts` (sem prefixos, comentários nem CDATA; escape do C14N; `xmlns` herdado
no elemento assinado), `xml-leitura.ts` (xmldom), a checagem de relógio e as frases 280–298.

## Verificação

- **jest, funções puras e sem rede:** próxima consulta (137, 138 com e sem resto, 656, rede, reinício); quando dar ciência (9 dias com relógio injetado,
  `cSitNFe`, `tpNF`, lançada, ignorada); classificação de `docZip` com `resNFe`/`procNFe`/`procEventoNFe` fictícios compactados no teste; cStat → ação.
- **Assinatura:** evento assinado com o `valido.pfx` fictício e conferido pelo `xml-crypto` e por um vetor fixo, inclusive com chave alfanumérica. `crypto.sign('sha1')` no `node:22-alpine` fica a provar no 1º jest.
- **Transporte:** contra um HTTPS local do próprio teste (mTLS, certificados de teste; não é rede externa); gzip estourado e DOCTYPE recusados.
- **Ciclo com a porta falsa** (jest, banco descartável): paginação 138 → 137, queda entre as duas transações (nada antes de +65 min), 656 com `ultNSU` maior
  (adota e grava lacuna), ciência com 573/596/297, detector de 138 na 1ª consulta.
- **Smoke:** semeia `notas_sefaz`/`sefaz_documentos` direto no banco, sem falso na imagem. Percorre caixa → xml → `POST /v1/notas` `origem=sefaz` → "Já lançada"; ignorar sem motivo = 400; loja = 403.
- **1º teste real** (dono presente, certificado verdadeiro): (1) homologação, `distNSU` com `ultNSU=0` → espera 137; confere TLS e cadeia do servidor, envelope,
  Content-Type e Action (pelo WSDL), e 593 não deve aparecer; (2) homologação, ciência numa chave fictícia bem formada → qualquer cStat fora de 213, 215, 225,
  280–298 prova schema e assinatura; (3) pergunta 1 respondida + "eu autorizo" → produção só com a busca, ciência desligada, 24 h vigiando 656; (4) liga a
  ciência e segue a primeira nota até o XML.

## Etapas (cada uma útil sozinha)

0. Chave e CNPJ alfanuméricos em `notas` (sem SEFAZ).
1. **Menor etapa que já dá valor: busca só de leitura, nenhum ato fiscal.** Transporte mTLS, leitor, tabelas, timer, botão e caixa com os resumos ("Falta lançar"
   / "Já lançada" / "Cancelada"), mais aviso âmbar no cadastro do certificado quando faltar clientAuth ou o SAN `2.16.76.1.3.3`. O Diego vê toda NF-e emitida
   contra o CNPJ e o que falta lançar; a etapa prova TLS e a convivência com o contador antes de qualquer ciência.
2. Ciência automática + XML completo + "Conferir" na tela de hoje (assinatura, `sefaz_manifestacoes`, origem `sefaz`).
3. IA nos itens do XML (`sugerir-insumos`).
4. Robustez: lacunas por `consNSU` (no máximo 10/h nossas), "Baixar agora" por `consChNFe`, CC-e na tela, "parece já lançada".
5. Se o dono quiser: Desconhecimento e Confirmação manuais; estorno de nota.

## Perguntas que só o dono pode responder

1. **O contador, ou outro sistema, já baixa da SEFAZ as notas deste CNPJ com o certificado?** A NT só admite uma sequência de NSU por CNPJ: dois sistemas = 656 e
   CNPJ bloqueado 1 h para os dois. Se baixa: ou o Freela Comanda vira o único (e o contador recebe os XML de nós), ou ficamos fora da SEFAZ e construímos
   "importar vários XML" com o que o contador exportar. *Recomendação:* perguntar ao contador **antes** de qualquer chamada em produção.
2. **Confirmação da Operação ao "Dar entrada"?** É a manifestação conclusiva: o fornecedor não pode mais cancelar, e ela também libera o XML de nota com mais
   de 10 dias. *Recomendação:* não, por ora (restaurante não está obrigado pela NT 2020.001 §5); confirmar com o contador.
3. **Desconhecimento da Operação (nota que ninguém pediu): botão manual já na etapa 2?** *Recomendação:* depois; até lá, "Ignorar" + avisar o contador.
4. **IA nos itens do XML com a chave cadastrada (centavos por nota nova; só as descrições saem)?** *Recomendação:* sim, só nas linhas sem vínculo.
5. **Nota cancelada pelo fornecedor depois de lançada: só avisar, ou construir o estorno (estoque + contas)?** *Recomendação:* só avisar agora.

## Riscos

- **Bloqueante para produção: o contador consumindo a mesma distribuição** (NT 2014.002 §3.11.4.1, item 2, "Atenção"). Cada colisão dá 656 e bloqueia o CNPJ
  por 1 h; podemos quebrar o sistema dele. A única prevenção é a pergunta 1; os detectores só **limitam** o dano (a 1ª consulta já mexe na sequência).
- **Regra dos 60 dias.** Notas de antes da primeira busca não vêm; busca desligada por mais de 60 dias deixa buraco sem volta.
- **Prazo de 10 dias da ciência.** API parada ou certificado vencido por dias = notas sem XML pela SEFAZ (entram por arquivo).
- **Certificado aceito no cadastro e recusado pela SEFAZ** (sem SAN CNPJ = 473; sem clientAuth = 280; sem LCR = 286). Aceite do SE-S não confirmado. Mitigação: aviso na etapa 1.
- **Ato fiscal automático em nome da empresa.** Decisão do dono em 16/11, registrada com quem ligou e desligável. RSA-SHA1 é legado: se a SEFAZ trocar, a mudança fica num lugar só.
- **Biblioteca XML com muitos alertas** (xmldom, 15+ em 2026). Mitigação: versão exata, adaptador único, DOCTYPE recusado, `npm audit` no PR.

## Não confirmado

- SOAP 1.1 ou 1.2 e `action` aceitos pela distribuição: o exemplo da NT usa 1.1; o MOC exige 1.2. Conferir no WSDL na homologação; não baixei o WSDL, para não tocar o serviço.
- AC do certificado de servidor do AN (pode exigir as raízes ICP no `ca`). Tempo entre a ciência e o NSU com a NF-e (a NT não dá prazo).
- Se reconsultar uma vez o mesmo `ultNSU` (depois de uma queda) já dá 656; se o 656 do `distNSU` e o do `consChNFe` são o mesmo contador.
- Se o cancelamento chega como `resEvento` ou `procEventoNFe` antes da manifestação (tratamos os dois); limites de tamanho e frequência do
  `NFeRecepcaoEvento4` (a NT 2020.001 não fixa); regra de manifestação de SP para restaurante.
- NT republicadas em 2026 não abertas (podem tocar assinatura/TLS): 2021.003 v1.50, 2023.003 v1.40, 2023.002 v1.02, 2014.001 v1.41, 2024.003 v1.10, 2022.002 v1.30a.
- Pacote de XSD vigente dos eventos (010d_v1.01): listado, não aberto. O de 2014 que abri ainda tem `ID[0-9]{52}` e anota `cOrgao` 90; valem a NT 2026.004 e o 91 da NT/MOC.

## Fontes

- Portal NF-e, Notas Técnicas: https://www.nfe.fazenda.gov.br/portal/listaConteudo.aspx?tipoConteudo=04BIflQt1aY=
- NT 2014.002 v1.40 (03/07/2026), Distribuição DF-e: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=uWO2d/gTuWg=
- NT 2020.001 v1.60 (23/04/2026), Manifestação do Destinatário: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=%20WTd7iuD21s=
- NT 2026.004 v1.01 (06/2026), CNPJ alfanumérico em eventos e na distribuição: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=BTZQzgsO9Ws=
- NT Conjunta 2025.001 v1.00, CNPJ alfanumérico, §5 chave: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=5ZkvIZt10mQ=
- MOC 7.0 (nov/2020), §4.2.2–4.2.4, §4.4.1, §5.8, §5.11: https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=LrBx7WT9PuA=
- Relação de Serviços Web, produção: https://www.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo= · homologação: https://hom.nfe.fazenda.gov.br/portal/webServices.aspx?tipoConteudo=OUC/YVNWZfo=
- Esquemas: PL_NFeDistDFe_104 (03/07/2026) https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=IzuP2y0G6hk= · Manifestação PL v1.01 (2014) https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=Q7x6aqhBAy4= · 010d_v1.01 (não aberto) https://www.nfe.fazenda.gov.br/portal/exibirArquivo.aspx?conteudo=FOEnx2KAsCk=
- Bibliotecas (registro npm e alertas do GitHub, 16/11): https://www.npmjs.com/package/@xmldom/xmldom · https://www.npmjs.com/package/xml-crypto · https://www.npmjs.com/package/fast-xml-parser · https://github.com/advisories?query=xmldom
- Secundárias (conflito entre sistemas no mesmo CNPJ): https://focusnfe.com.br/blog/rejeicao-656/ · https://www.projetoacbr.com.br/forum/topic/79694-consumo-indevido-em-apenas-um-cliente/
