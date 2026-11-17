# Cupom fiscal (NFC-e modelo 65) no Freela Comanda — desenho

Data: 17/11/2026 · Ramo `feat/notas-sefaz` · Nada implementado. Nenhuma chamada à SEFAZ, nem em homologação nem pelo `?wsdl`.

É o 4º de quatro projetos: foto → certificado A1 → notas da SEFAZ → **NFC-e**.

- **Base factual:** `2026-11-17-pesquisa-ciencia-e-nfce.md`, Parte B, citada aqui como "B.n".
- **Reaproveita de `modules/sefaz`:** o transporte SOAP 1.2 com mTLS (`chamarSoap12`), o leitor de XML (`xml-leitura.ts`), o `SefazErro` com a marca `enviado` e a confiança (`confiancaSefaz`).
- **Reaproveita da entrega 3:** a assinatura, com interface fixa: `assinarXmlEnveloped(xml, idDoElemento, cert)`.
- **Certificado:** chega só pela porta `CERTIFICADO_DIGITAL` (`emUso()`).

Marcas usadas no texto:

- *conferido*: li na pesquisa [P] ou no esquema 010h v1.03, que a pesquisa baixou e eu abri em 17/11/2026;
- *minha*: decisão do construtor;
- *não confirmado*: sem fonte primária; vira passo do 1º teste ou pergunta.

## Resumo

- **Abordagem:** emissor próprio dentro da API.
  - Um módulo novo, `cupom-fiscal`, e uma porta nova, `SEFAZ_NFCE`, em `modules/sefaz`.
  - Autorização síncrona, uma nota por envio, QR Code v2 com CSC.
  - DANFE de 80 mm impresso pelo navegador; cancelamento em até 30 minutos.
- **Tela simples agora:**
  - Quem usa e o quê: só admin, só venda presencial, itens do cardápio (fichas), CPF ou CNPJ opcional, dinheiro, cartão, PIX ou vale.
  - Fica de fora: contingência off-line, mesas, taxa de serviço e entrega.
- **Já fica pronta a base de um emissor de caixa:**
  - série própria por ambiente e número reservado antes da rede;
  - número reaproveitado só com prova de que a SEFAZ não o tem;
  - travas contra o bloqueio 656;
  - cupom imutável depois de autorizado;
  - venda lançada no estoque uma única vez, pelo cupom autorizado.
- **Tudo desligado de fábrica:**
  - `NFCE_AMBIENTE` ausente = desligado;
  - produção só com o "eu autorizo" do dono, e só depois de autorizar e cancelar um cupom em homologação.

## Decisões do dono

| Data | Decisão | Onde entra |
|---|---|---|
| 16/11/2026 | "Faz uma tela simples por enquanto": sem virar o caixa agora | §2 |
| 16/11/2026 | "Deixe isso tudo configurável lá no Comanda": regime tributário, IE, CSC e IdCSC, códigos fiscais por item (NCM, CFOP, CSOSN/CST, PIS/COFINS), série e número inicial | §3.2, §7 |
| 17/11/2026 | O "Emitir cupom" é a base para o Comanda **trocar o sistema do caixa** da loja (hoje outro sistema emite NFC-e no mesmo CNPJ): numeração, contingência, cancelamento, impressão, desempenho e convivência | §2, §4, §5 |

## O que as normas e o esquema amarram

### Da pesquisa, Parte B

| Fato | Consequência no desenho | Fonte |
|---|---|---|
| SAT vedado em SP desde 01/01/2026; NFC-e obrigatória no varejo | O cupom é NFC-e 65 | B.1 |
| Credenciamento é do estabelecimento, não do software; sem ele, 781 | Se o caixa de hoje já emite, o CNPJ está credenciado em produção | B.1 |
| CSC é da empresa: no máximo 2 válidos; para o 3º é preciso revogar um | Usar o mesmo CSC do outro sistema ou o 2º; **nunca** revogar o dele | B.1 |
| Síncrono, lote com 1 nota, `indSinc=1` | Uma nota por envio; o `NFeRetAutorizacao4` não é usado | B.2 |
| `dhEmi` com mais de 5 min de atraso = 704 | Reenvio sempre remonta o XML com hora nova | B.3 |
| Série do aplicativo do contribuinte: 000–889; numeração por estabelecimento e série | Série própria basta para não colidir número | B.3, B.6 |
| Sem inutilização em SP desde 01/11/2026; número pulado fica pulado; a cl. 11ª §5 presume que o buraco é contingência não transmitida | Não implementar inutilização; evitar buracos | B.6 |
| Mais de 30 rejeições iguais = 656 por até 1 h "para todas as requisições"; a SEFAZ pode identificar pelo `emit/CNPJ` | Um laço nosso pode parar também o caixa da loja | B.6 |
| 120 = autorizado com alerta; SP usa `nProt` de 17 dígitos desde 05/10/2026 | 120 conta como autorizado; `nProt` como texto | B.2 |
| Cancelamento 110111, 30 min, `xJust` de 15 a 255; `cOrgao` 35 é inferência | §5.4 | B.6 |
| QR v2 com CSC vale; aceitação do v3 em SP não confirmada | v2 agora | B.5 |
| Contingência off-line autorizada em SP, com regras de numeração, prazo e impressão | Fase 2 (§5.5) | B.5 |
| IBS/CBS não exigido em produção em 2026; Simples só em 2027; NT 2026.005 cria `cAtivSN` e `gTribSN` | Campos no cadastro agora, XML depois (§6) | B.4 |
| Entrega = operação não presencial, que exige CPF/CNPJ, endereço e (talvez) transportador | Só `indPres=1` agora | B.3 |
| Papel não fiscal ao consumidor tem de dizer "NÃO É DOCUMENTO FISCAL" | A tela simples não imprime pré-conta | B.7 |
| Em homologação, o `xProd` do 1º item é um texto fixo (373) | Montagem troca o texto só em homologação | B.3 |

### Dos esquemas (conferido em 17/11/2026: `leiauteNFe_v4.00.xsd` do 010h v1.03; `leiauteConsSitNFe_v4.00.xsd` e `tiposBasico_v4.00.xsd` do 010d v1.03)

- **Ordem do `TNFe`:** `infNFe`, depois `infNFeSupl` (0..1), depois `ds:Signature`.
- **`qrCode` v2 on-line:** `…?p=<chave>|2|<tpAmb 1-2>|<IdCSC: 0 ou sem zeros à esquerda, até 6 dígitos>|<40 hex>`. A 35ª posição da chave (`tpEmis`) é 1, 3 ou 4.
- **`qrCode` v2 off-line:**
  - a chave tem 9 na 35ª posição;
  - os campos são o dia, `vNF`, `digVal` em **56** hex, IdCSC e hash;
  - logo o `digVal` é o hexadecimal dos 28 caracteres base64, não dos 20 bytes.
- **`protNFe/infProt`:** traz `nProt` (até 17), `digVal`, `cStat`, `xMotivo` e o grupo opcional `cMsg`/`xMsg`.
- **`retEnviNFe`:** o retorno abre uma escolha cujo 1º ramo é `infRec`. O ramo do `protNFe` (resposta síncrona) é o **esperado**, mas não estava no trecho lido.
- **`dest`:** `xNome` opcional e `indIEDest` obrigatório.
- **`card/tpIntegra`:** 1 ou 2.
- **`cNF`:** `[0-9]{8}`.
- **Consulta:** o `consSitNFe` tem `tpAmb`, `xServ` e `chNFe`; o `retConsSitNFe` traz `protNFe` e `procEventoNFe`.

## 1. Abordagens

| | **A. Emissor próprio na API** (recomendada) | B. API de emissão de terceiros (Focus NFe, NFe.io, PlugNotas e afins) | C. Emissor instalado na loja (ACBr Monitor ou agente próprio) |
|---|---|---|---|
| Como funciona | A API monta, assina e envia com o transporte, o leitor e a assinatura que já existem | A API manda os dados ao provedor, que monta, assina, envia e guarda | Um programa no computador da loja fala com a SEFAZ; a API pede a ele |
| Internet da loja caiu | Sem cupom: o navegador não chega à API | Sem cupom | Emite em contingência no balcão |
| Servidor da API fora | Sem cupom | Sem cupom | Emite, se a venda também for local |
| Onde fica o certificado A1 | No nosso banco, cifrado (já é assim) | Com o provedor | Na máquina da loja: mais um lugar para vazar |
| Custo | Nosso tempo; sem mensalidade | Mensalidade e preço por nota (não pesquisados) | Instalação e suporte na loja |
| Numeração e travas do 656 | Nossas, com as regras deste desenho | Do provedor | Nossas, em duas pontas |
| O que aproveita | Transporte mTLS, leitor, certificado, assinatura | Pouco | Pouco |
| Esforço até a tela simples | Médio | Baixo | Alto |

**Recomendação (minha): A agora.**

- **O que A troca:** nada emite com a internet da loja ou o servidor fora.
- **Na tela simples isso não pesa**, porque o caixa de hoje continua emitindo.
- **Na fase "trocar o caixa"**, é a decisão que falta antes de qualquer código:
  - A + internet de reserva na loja (4G) + servidor mais confiável; ou
  - A + um componente local só para a contingência.
  - A contingência off-line (`tpEmis=9`) só cobre a **SEFAZ** fora, não a loja sem rede.
- **B** é o plano de saída se o 1º teste em homologação travar por muito tempo.
- **C** só vale se a loja não puder ter internet de reserva.

## 2. Tela simples agora; caminho para "trocar o caixa"

### 2.1 O que a tela simples faz

O menu ganha "Cupom Fiscal" (`loja: false`), com três abas: **Emitir**, **Emitidos** e **Produtos**.

- Configurações ganha o painel "Cupom fiscal (NFC-e)" (§7).
- A Ficha Técnica perde os campos soltos NCM/CFOP/CST/Alíquota (§3.2).
- As telas passam pelo `ux-designer` antes de implementar (regra do dono para mudança grande), como em `notas-sefaz-ux.md`.

**Aba Emitir:**

```
Cupom fiscal · HOMOLOGAÇÃO — cupons de teste, sem valor fiscal                Série 2 · próximo nº 12
[Emitir] [Emitidos] [Produtos]

Produto [Espetinho de carne ▾]  Qtd [2]  [Adicionar]     (só aparecem produtos com NCM, perfil e preço)
Item                          Qtd      Unit. (R$)   Total (R$)
Espetinho de carne            2          12,00        24,00     [Tirar]
Chopp 300 ml                  3           9,90        29,70     [Tirar]
                                         Produtos     53,70
                                         Desconto   [  3,70 ]
                                         Total        50,00
Pagamento [Dinheiro ▾] [ 60,00 ]  [+ outra forma]              Troco 10,00
CPF ou CNPJ na nota (opcional) [                ]
                                                                  [Emitir cupom]
```

Depois do envio, o quadro mostra o resultado e as ações daquela situação (§5.1):

```
✔ Autorizado · NFC-e série 2 nº 12 · protocolo 13526000000000012 · 14:05:31
Pode cancelar até 14:34                         [Imprimir] [Ver XML] [Cancelar] [Novo cupom]
```

**Aba Emitidos:**

- Lista por data, com filtro por situação.
- Faixa âmbar se houver cupom pendente: "1 cupom sem resposta da SEFAZ: consulte antes de emitir de novo".

**Aba Produtos:**

- Grade dos itens ativos do cardápio, com NCM, CEST, GTIN, origem e perfil.
- Etiquetas: "falta NCM", "falta perfil" e "sem preço de venda".

### 2.2 O que fica para a fase "trocar o caixa"

| Item | Por que não agora | O que já fica pronto |
|---|---|---|
| Operador de caixa emitindo | A regra do projeto é "a loja nunca vê preço" (pergunta 7) | Rotas com marca própria; muda só a marca |
| Mesas, comandas, pedido aberto; pré-conta com "NÃO É DOCUMENTO FISCAL" | É outro módulo (pedidos) | O serviço de emissão recebe uma entrada neutra (§2.3); o pedido só monta essa entrada |
| Contingência off-line (`tpEmis=9`) e cancelamento por substituição (110112) | §5.5 | Colunas `tp_emis`, `dh_cont`, `x_just`, `dig_val`; numeração com prova; formato off-line do QR conferido no esquema |
| Retransmissão agendada | Só existe com a contingência | O diário `nfce_envios` |
| Taxa de serviço (CFOP 5.949 com CSOSN 900, B.8) | Pergunta 5; o valor é % do total, não é item do cardápio | Migração aditiva: linha de cupom de outro tipo |
| Entrega e iFood (`indPres=4`: destinatário, endereço, transportador; intermediador) | Rejeições 786–788 e grupo `infIntermed` (B.3) | `dest` já montado para CPF/CNPJ |
| TEF integrado (`tpIntegra=1`, credenciadora, `cAut`) | Integração com a maquininha | `card` já sai com `tpIntegra=2` |
| Impressão sem diálogo (Chrome em modo quiosque ou agente ESC/POS) e gaveta | Depende do equipamento da loja | DANFE de 80 mm |
| DANFE por e-mail ou WhatsApp; `tpImp=5` | Infra de envio e concordância do consumidor (B.7) | DANFE em JSON |
| Cupons somados na Conciliação de Caixa | Hoje o caixa é digitado | `nfce_cupom_pagamentos` por `tPag` |
| Parar de importar as vendas do outro sistema | Só quando ele sair | `vendas.nfce_cupom_id` e `cupom_lanca_venda` |
| IBS/CBS no XML | §6 | Campos no cadastro |
| QR v3, sem CSC | Aceitação em SP não confirmada | Função do QR isolada |
| Desempenho | Ok para dezenas de cupons por dia | Ver o item seguinte |

**Desempenho na fase 2:** o transporte abre um aperto de mão TLS por chamada (`agent: false`), e o `emUso()` decifra o certificado a cada chamada.

- Para dezenas de cupons por dia, isso basta.
- O caixa cheio pede um agente com conexão mantida e um cache curto do certificado em uso.
- `nfce_envios.duracao_ms` mede desde o 1º cupom.

### 2.3 O caminho de uma fase para a outra, sem refazer

- **Um único serviço de emissão,** `emitir(venda: VendaParaCupom)`.
  - Entrada: `{ chave_idempotencia, itens: [{ item_cardapio_id, quantidade }], desconto_centavos, pagamentos: [{ t_pag, valor_centavos }], consumidor_doc }`.
  - A tela simples monta essa entrada à mão; o pedido de mesa da fase 2 monta do pedido.
  - Numeração, montagem, envio, retornos, venda e DANFE não mudam.
- **Situações do cupom (§5.1):** já são as do caixa, menos `contingencia`, que entra por migração aditiva (o CHECK cresce).

## 3. Itens, códigos fiscais, vendas e baixa de estoque

### 3.1 De onde vêm os itens

- **Origem:** do cardápio, `itens_cardapio` (as fichas técnicas). Não há "produto de venda" novo. *minha*
  - O cardápio já é o catálogo do que se vende.
  - Bebida e chope também são itens com ficha: os subgrupos "Chopp" e "Bebidas" são "Produtos de venda".
- **O que pode entrar no cupom:** item `ativo`, com `preco_venda` > 0 e com cadastro fiscal completo (NCM válido e perfil ativo).
- **Preço:** `itens_cardapio.preco_venda`, lido no servidor e arredondado a 2 casas (metade para cima). *minha*
  - A tela nunca manda preço: valor calculado é do servidor.
- **Desconto:** um valor em R$ sobre o total, que o servidor rateia entre os itens. *minha*
  - O rateio é proporcional ao valor de cada item; os centavos que sobram vão para os maiores.
  - Sem acréscimo.
- **Fotografia:** cada linha do cupom grava código, descrição, unidade, quantidade, preço e todos os códigos fiscais do momento.
  - Mudar o cardápio ou o perfil depois não muda o cupom.
  - O item pode ser desativado ou apagado pela importação de fichas: a linha guarda `item_cardapio_id` com `ON DELETE SET NULL`.
- **No XML:**
  - `cProd` = `itens_cardapio.codigo` ou, sem código, o id (36 caracteres, limite 60);
  - `xProd` = `descricao_cupom` ou o nome (até 120);
  - `uCom`/`uTrib` = unidade fiscal (padrão `unidade_venda`, até 6);
  - `cEAN`/`cEANTrib` = GTIN ou "SEM GTIN" (B.3);
  - `qCom` com 4 casas; `vUnCom` com 2.

### 3.2 Códigos fiscais: perfil fiscal + dados do item

**Problema:** são cerca de 100 itens, mas 3 a 5 combinações de imposto (prato da casa, revenda, bebida com ST). Digitar CSOSN, CFOP e PIS/COFINS item a item multiplica erro, e cada erro vira rejeição na SEFAZ.

**Divisão (minha):**

- **Perfil fiscal** (`nfce_perfis_fiscais`), que o contador define uma vez:
  - CFOP;
  - CSOSN (Simples) ou CST e alíquota do ICMS (Regime Normal);
  - CST de PIS e de COFINS; vazio = grupo omitido, o que a NFC-e permite (B.3);
  - campos do IBS/CBS (§6).
- **Dados do item** (`nfce_itens`, 1 para 1 com `itens_cardapio`): NCM, CEST, GTIN, origem (0–8, padrão 0), descrição no cupom, unidade e perfil.
- Item que foge do perfil ganha um perfil novo; não há código fiscal sobrescrito item a item.

**Validação do perfil** (regras da pesquisa, B.8):

| Regra | Valores |
|---|---|
| CRT 1, 2 ou 4 exige CSOSN | 102, 103, 300, 400, 500 ou 900 |
| CRT 3 exige CST | 00, 20, 40, 41, 60 ou 90 |
| CFOP aceito agora | 5101, 5102, 5103, 5104, 5115, 5405, 5656 e 5667. Ficam fora: 5933 (só com ISSQN) e 5949 (gorjeta, fase 2) |
| CSOSN 102, 103, 300, 400 ou 900 | Só com 5101, 5102, 5103, 5104 ou 5115 |
| CSOSN 500 | Só com 5405 (ou 5656/5667) |
| CST 60 | Só com 5405 |

Qual grupo `ICMSSN…`/`ICMS…` do esquema recebe cada código: conferir no esquema na implementação.

**Os campos antigos `itens_cardapio.ncm/cfop/cst/aliquota`** (texto livre do protótipo, editado na Ficha) deixam de ser fonte. *minha*

- A migração copia para `nfce_itens`, sem perfil, o NCM que tiver 8 dígitos.
- As colunas ficam no banco por causa do 1:1 com o protótipo, com `COMMENT … 'DEPRECATED: dados do cupom em nfce_itens'`, como `configuracoes.nome_unidade`.
- A Ficha troca os 4 campos por uma linha só de leitura, "Cupom fiscal: NCM … · perfil … [Editar]", que leva à aba Produtos.
- Assim não há duas fontes.

**Fatia opcional "Importar dados fiscais":** os dados chegam provavelmente numa planilha do contador.

- Entra em Importar Dados, com as colunas `item_cardapio`, `ncm`, `cest`, `gtin`, `origem` e `perfil`.
- Segue o mesmo caminho das outras importações, tudo ou nada.

### 3.3 Vendas e baixa: o cupom autorizado lança a venda uma vez

**Hoje (conferido no código):**

- `vendas` vem só da importação do relatório do outro sistema (`importacoes.service.ts#vendas`), com chave única `(pedido, produto_relatorio, data)`.
- O gatilho `vendas_baixa` cria as `movimentacoes` `baixa_venda` pela ficha.
- `recalcular_baixas()` apaga e recria as baixas a partir de todas as vendas.
- "Substituir" apaga **todas** as vendas do período do arquivo.
- `mapear` reaponta o `item_cardapio_id` de todas as vendas com o mesmo `produto_relatorio`.
- Vendas e Painel contam pedidos por `pedido` distinto.

**Desenho (minha):**

**Coluna nova `vendas.nfce_cupom_id uuid NULL REFERENCES nfce_cupons(id) ON DELETE RESTRICT`**, com índice. Entra em `COLUNAS_SO_NOSSAS` do importador do Lovable (como `repetida_de`); as tabelas `nfce_*` entram em `TABELAS_SO_NOSSAS`. Sem isso, a conferência de esquema do importador falha.

**Função SQL `nfce_lancar_venda(_cupom uuid)`** (regra em SQL, como `lancar_nota`):

- **Quando roda:** numa transação **própria (T3), depois** da T2 que grava a autorização, só em produção **e** com `cupom_lanca_venda = true`.
  - A venda nunca desfaz a autorização: a T2 não pode falhar depois de a SEFAZ responder, como na busca de notas.
  - Se a T3 falhar, o cupom continua `autorizado`, com `venda_lancada_em` nulo e o erro em `venda_erro`.
  - A tela mostra "Venda não lançada no estoque: <frase> [Lançar de novo]", e o botão chama `POST /v1/cupom-fiscal/cupons/:id/lancar-venda`.
  - Ligar a emissão em produção e o fechamento do inventário avisam se houver cupom com venda pendente.
- **Idempotente:** se o cupom já tiver venda, não faz nada.
- **Quando recusa** (`raise exception`): cupom que não é de produção ou que não está autorizado.
- **O que grava:** uma linha por item do cardápio. Agrupa por (`item_cardapio_id`, `nome_cardapio`), somando as linhas repetidas do mesmo item.
  - `nome_cardapio` é o `itens_cardapio.nome` fotografado na linha do cupom.
  - Como o nome é UNIQUE no cardápio, dois itens do mesmo cupom nunca têm o mesmo nome, e a chave única `(pedido, produto_relatorio, data)` não colide.
  - A descrição do cupom (`descricao_cupom`) pode repetir entre itens, por isso não serve de chave.
- **Os campos de cada linha:**
  - `pedido` = `NFC-e <série>-<número>`;
  - `produto_relatorio` = `nome_cardapio`;
  - `item_cardapio_id`;
  - `data`/`hora` = `dhEmi` em Brasília;
  - `preco_unitario` e `quantidade`;
  - `desconto` = rateio;
  - `valor_total` = líquido;
  - `taxa` = `frete` = 0;
  - `importacao_id` nulo.
- **Baixa:** o gatilho que já existe faz a baixa, sem mudança.

**Cancelamento:** depois da T2 que grava o 135, uma T3 chama `nfce_desfazer_venda(_cupom)`, que **apaga** as linhas de `vendas` do cupom; as `movimentacoes` caem em cascata, como no protótipo.

- É idempotente.
- Se falhar, vale o mesmo marcador e o mesmo botão do lançamento ("Venda do cupom cancelado ainda no estoque").

- **Por que apagar e não lançar estorno:**
  - em `vendas`, o estorno contaria como pedido a mais e estragaria "Pedidos" e "Ticket médio";
  - aqui `vendas` é uma projeção, que o "Substituir" e o `recalcular_baixas` já refazem.
- **Onde fica o histórico imutável:** no cupom. `nfce_cupons` nunca é apagado, e o cancelamento é um evento em `nfce_envios` que aponta o original.

**Homologação nunca lança venda:** a função recusa.

**Mudanças no código que já existe:**

- `importacoes.service.ts#vendas`, modo "Substituir": o `deleteMany` passa a filtrar `nfce_cupom_id: null`;
- `importacoes.service.ts#mapear`: o `updateMany` também filtra `nfce_cupom_id: null` (a venda do cupom já nasce com o item certo);
- `recalcular_baixas()`: não muda, porque as vendas do cupom têm `item_cardapio_id` e são refeitas como as outras.

### 3.4 Não contar duas vezes enquanto o outro sistema ainda é o caixa

**A regra fiscal ajuda:** uma venda tem **um** cupom.

- Se a venda passou no caixa de hoje, ele emitiu NFC-e, e emitir outra aqui seria documento em dobro.
- Logo, a venda emitida no Comanda não deveria estar no relatório do outro sistema.

**O que escapa:**

- o outro sistema registra o pedido (mesa, cozinha) sem emitir;
- ou o Comanda é usado de reserva quando o outro falha.

Nesses casos, a venda chega duas vezes: pela importação e pelo cupom. Não dá para casar as duas sozinhas, porque o número do pedido do outro sistema não aparece no cupom.

**Mitigações (minha):**

1. **`cupom_lanca_venda` sem valor de fábrica** (nulo = não respondido).
   - Ligar a emissão em produção exige responder: "As vendas emitidas aqui também ficam registradas no outro sistema? — **Não**: lançar no estoque pelo cupom / **Sim**: não lançar (a importação já conta)".
   - Grava quem respondeu e quando. É a pergunta 1 (§9.2).
2. **Aviso na importação.** Ao ler um arquivo de vendas, a tela chama `GET /v1/cupom-fiscal/vendas-no-periodo?ini=&fim=`. Se houver cupons lançados no período, mostra:
   - "Neste período o Comanda já lançou N cupons (R$ X). Se essas vendas também estão neste arquivo, vão contar duas vezes no estoque."
   - O aviso não bloqueia.
3. **Na tela Vendas,** as linhas do cupom aparecem com o pedido "NFC-e 2-12", fáceis de achar.

**Quando o Comanda virar o caixa,** a importação do outro sistema para. O iFood, se ainda vier por relatório, também precisa de NFC-e própria (fase 2).

## 4. Numeração

### 4.1 Série, número inicial e chave

**Série e número:**

- `nfce_ambientes` tem uma linha por ambiente, com `serie` (0–889, B.3) e `proximo_numero` (1 a 999.999.999).
- Homologação e produção têm série, número e CSC próprios.

**Série em produção:** tem de ser diferente das "séries usadas pelo outro sistema" informadas no emitente. *minha*

- Ligar exige informar ao menos uma série ou marcar "nenhum outro sistema emite NFC-e neste CNPJ".
- Sugestão para o dono: uma série que o caixa de hoje não usa, por exemplo 2 se ele usa 1.

**Número inicial (o admin digita):**

- Não pode ser menor ou igual ao maior número já usado na série: autorizado, cancelado, denegado ou pendente.
- Trocar a série só é permitido sem cupom pendente (`enviando`, `sem_resposta`, `nao_enviado`, `nao_consta`, `rejeitado`).
- A série nova começa no número que o admin informar.

**Chave:** `cUF` 35 + AAMM do `dhEmi` + CNPJ (pode ter letras) + 65 + série (3) + número (9) + `tpEmis` + `cNF` + DV.

- O DV sai de `common/fiscal/chave-acesso.ts`, que ganha `montarChave` (hoje o `dvChave` é interno).
- O `cNF` são 8 dígitos de `crypto.randomInt`, diferentes do número. *minha*: "diferente do número" é boa prática, não regra conferida (B.3).
- O `cNF` é gerado uma vez por cupom e mantido nos reenvios do mesmo número.

### 4.2 Reserva antes do envio: T1 → rede → T2

Segue o padrão de `notas-sefaz/ciclo.service.ts`: transações curtas e a rede fora delas.

1. **Antes de abrir transação:** `emUso()` (decifra o certificado) e leitura do cadastro fiscal.
2. **T1**, curta:
   - `SELECT … FROM nfce_ambientes WHERE ambiente = $1 FOR UPDATE`: serializa a numeração e as travas do 656.
   - Confere de novo: emissão ligada, sem parada, `bloqueado_ate` vencido, teto de recusas (§4.4).
   - **Idempotência:** se já existe cupom com a mesma `chave_idempotencia`, devolve esse cupom e não envia nada. Duplo clique ou tentativa repetida pelo navegador não reservam dois números.
   - **Número:** o menor número livre com prova (§4.3) ou, se não houver, `proximo_numero` (e soma 1).
   - Monta e assina o XML (§5.2).
   - Grava o cupom (`enviando`), os itens, os pagamentos e a linha aberta de `nfce_envios` com o XML assinado e o `id_lote`.
   - Commit. A partir daqui o número está preso a este cupom.
3. **Rede**, fora de transação: `autorizar(…)` com 20 s de prazo. *minha*; o transporte aceita o prazo por chamada.
4. **T2:**
   - fecha a linha do envio;
   - aplica a tabela de retornos (§5.3) ao cupom e ao ambiente;
   - commit.
   - Só grava texto e números já lidos, para não falhar depois de a SEFAZ responder.
5. **T3**, só se autorizado: lança a venda (§3.3). Se falhar, a autorização fica intacta e o cupom ganha o marcador de venda pendente.

**Se a T2 falhar ou o processo morrer:** o cupom fica `enviando`, com o envio aberto.

- Na leitura, `enviando` há mais de 2 minutos vale como **sem resposta** (derivado, como o `em_andamento_desde` da busca).
- A única saída é a consulta pela chave.

### 4.3 Reaproveitamento e "número pulado"

**SP não tem inutilização:** a NT 2023.002 desliga o serviço de SP em 11/11/2026 (B.6). O sistema não implementa inutilização, e um teste procura `NFeInutilizacao4` em `api/src` e falha se achar. *minha*

**Regra: um número só volta a ser usado com prova de que a SEFAZ não o tem.**

| O que aconteceu | A SEFAZ tem o número? | Número |
|---|---|---|
| Falha antes de enviar (`SefazErro` com `enviado = false`: DNS, conexão, TLS) | Não, com certeza | Livre |
| Serviço parado (108/109) ou rejeição do lote inteiro (esquema, certificado…) | Não: o lote não foi processado | Livre |
| Rejeição da nota (`protNFe` com código de rejeição) | Não: rejeição não registra a nota | Livre |
| Enviado sem resposta (`enviado = true`: prazo, queda, HTTP ≠ 200, resposta ilegível) | Talvez | **Preso**: só a consulta decide |
| Consulta: "não consta" | Não | Livre |
| Consulta ou envio: autorizada, cancelada ou denegada | Sim | Usado para sempre; cancelar não libera |
| 539, número usado por outra chave (§5.3) | Sim, por outra nota | **Bloqueado** (`numero_reaproveitavel = false`) |

**Como o número livre volta a ser usado:**

- "Descartar" exige motivo e só aparece nas situações com número livre.
- O número descartado vai para o próximo cupom: a T1 escolhe o menor número de cupom `descartado` e reaproveitável que não esteja em uso por outro cupom da série, antes de somar 1.
- O índice único parcial `(ambiente, serie, numero) WHERE situacao <> 'descartado'` impede dois cupons vivos com o mesmo número.
- O número reaproveitado leva `cNF` e chave novos. Isso é seguro porque a SEFAZ não registrou o anterior.

**Quando sobra um buraco:**

- número preso para sempre (consulta que nunca responde);
- número bloqueado pelo 539;
- descartados de uma série abandonada.

Nesses casos, o número aparece em `numeros-nao-usados.csv` na exportação do mês para o contador (§7.4), com série, número e motivo. Se isso basta diante da presunção da cl. 11ª §5 é a pergunta 4.

### 4.4 Nunca disparar o 656

O 656 pode parar também o caixa da loja por até 1 hora (B.6). Todas as regras abaixo moram no servidor e são conferidas na T1, sob a trava do ambiente.

1. **Nenhum laço automático.** A tela simples não tem timer: toda chamada à SEFAZ nasce de um clique (Emitir, Enviar de novo, Consultar, Cancelar, Testar conexão).
2. **Consultar antes de reenviar.** Depois de um envio sem resposta, só a consulta pela chave, e as esperas são minhas:
   - a consulta só a partir de 2 min depois do envio, para não pegar a nota ainda em processamento;
   - para a mesma chave, uma a cada 2 min;
   - no máximo 20 consultas por hora no ambiente.
3. **Até 3 envios de autorização por cupom;** depois, só Descartar. *minha*
4. **Teto de recusas:** 10 respostas de rejeição, somadas entre todos os serviços NFC-e, em 60 minutos param todos os envios do ambiente até a mais antiga sair da janela. O limite da SEFAZ é de mais de 30 iguais. *minha*
5. **Erro "nosso" para na 1ª vez:** esquema, assinatura, certificado, CSC/QR, credenciamento e relógio.
   - A situação do ambiente vira `parada_*`, e nada sai até o admin religar.
   - Repetir seria justamente a série de rejeições iguais que gera o 656.
6. **Se vier 656, em qualquer serviço:**
   - `bloqueado_ate` = agora + 65 min, e nenhuma chamada NFC-e de nenhum tipo até lá;
   - o 2º 656 em 24 h vira `parada_656`, que desliga a emissão.
7. **Status do serviço só no botão "Testar conexão",** no máximo uma vez a cada 5 min; nunca antes de cada nota.
8. **Relógio:** cada resposta traz `dhRecbto`. Se a hora do servidor diferir em mais de 2 min, o ambiente vai para `parada_configuracao`, porque relógio errado gera 704 em série. *minha*

## 5. Autorização, retornos, cancelamento, contingência, DANFE e QR

### 5.1 Situações do cupom

| Situação | Quer dizer | Número | Ações na tela |
|---|---|---|---|
| `enviando` | T1 gravada, à espera da SEFAZ (mais de 2 min = sem resposta) | preso | — |
| `nao_enviado` | A SEFAZ não recebeu: falha antes de enviar, 108/109, rejeição do lote | livre | Enviar de novo · Descartar · Consultar (opcional) |
| `sem_resposta` | Enviado, sem resposta | preso | Consultar na SEFAZ (a partir de HH:MM) |
| `nao_consta` | A consulta diz que a SEFAZ não tem a nota | livre | Enviar de novo · Descartar |
| `rejeitado` | A SEFAZ recusou a nota (código e motivo) | livre (bloqueado no 539) | Enviar de novo · Descartar · Consultar (opcional) |
| `autorizado` | 100, 150 ou 120 | usado | Imprimir · XML · Cancelar (até HH:MM) · Consultar |
| `cancelando` | Cancelamento enviado sem resposta, ou 573 (duplicidade do evento) | usado | Consultar. Sem imprimir; a venda fica até a resposta |
| `denegado` | Uso denegado | usado | XML |
| `cancelado` | 110111 registrado | usado | XML da nota e do cancelamento |
| `descartado` | Abandonado com prova; número reaproveitado depois | — | — |

**"Consultar":**

- É obrigatória em `sem_resposta` e `cancelando`.
- É opcional em `nao_enviado`, `rejeitado` e `autorizado`: serve para confirmar o código de "não consta" (1º teste) ou conferir um cupom.
- Passa sempre pelas mesmas travas (§4.4, regra 2) e nunca dispara reenvio sozinha.
- Em `cancelando`:
  - a consulta com `procEventoNFe` de cancelamento leva a `cancelado` e desfaz a venda;
  - sem evento, o cupom volta a `autorizado`; se ainda estiver nos 29 min, dá para cancelar de novo, e, se não, a frase do prazo vale.

**"Enviar de novo":**

- remonta o XML com `dhEmi` novo (sem 704), o mesmo número e o mesmo `cNF`; a chave só muda se o mês virou;
- relê do cadastro só os códigos fiscais;
- mantém itens, quantidades, preços e pagamentos.

**Imutável:** com o cupom em `autorizado`, `denegado` ou `cancelado`, um gatilho no banco recusa mudança nas colunas fiscais, nos itens e nos pagamentos.

- A única passagem é `autorizado → cancelado`, com os campos do cancelamento.
- DELETE é sempre recusado.

**Qual XML foi autorizado:** o `protNFe` traz `digVal`. A autorização vale para a tentativa cujo `DigestValue` é igual, o que cobre a resposta que chega pela consulta depois de dois envios. *minha*

### 5.2 Montagem e envio

Valores do XML (detalhe em B.3):

| Grupo | O que vai |
|---|---|
| `ide` | `cUF` 35 · `cNF` · `natOp` configurável (padrão "VENDA") · `mod` 65 · `serie` · `nNF` · `dhEmi` com o fuso de Brasília (calculado, não fixo) · sem `dhSaiEnt` · `tpNF` 1 · `idDest` 1 · `cMunFG` do emitente (Valinhos 3556206) · `tpImp` 4 · `tpEmis` 1 · `cDV` · `tpAmb` · `finNFe` 1 · `indFinal` 1 · `indPres` 1 · sem `indIntermed` (só exigido com `indPres` 2, 3, 4 ou 9) · `procEmi` 0 · `verProc` "FreelaComanda <versão>" (até 20) |
| `emit` | `CNPJ`, razão social e nome fantasia de `configuracoes`; `enderEmit`, `IE` e `CRT` de `nfce_emitente` (§7); sem `IEST` |
| `dest` | Só com documento: `CPF` ou `CNPJ` + `indIEDest` 9. Sem nome e sem endereço (`xNome` é opcional, conferido) |
| `det/prod` | §3.1 · `vProd` = q × `vUnCom` arredondado a 2 casas · `indTot` 1 · `vDesc` do rateio · em homologação, `xProd` do item 1 = "NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL" (373) |
| `det/imposto` | ICMS pelo grupo do CSOSN ou do CST, com `orig` · PIS/COFINS só se o perfil tiver CST · nada de IPI, II, PIS-ST, COFINS-ST, partilha (B.3) · sem `IBSCBS` (§6) |
| `total/ICMSTot` | Todos os campos, zeros quando não houver · `vNF` = `vProd` − `vDesc` · sem `vTotTrib` (pergunta 3) |
| `transp` | `modFrete` 9 |
| `pag` | `detPag` por forma, `tPag` 01, 03, 04, 10, 11 ou 17 · `card` com `tpIntegra` 2 só em 03, 04 e 17 (*minha*; se SP exige o grupo: *não confirmado*, B.3) · `vTroco` = soma paga − `vNF`, só com dinheiro e até o valor pago em dinheiro (*minha*) · sem 90, 14 e 99 |
| `infAdic/infCpl` | Texto padrão configurável, opcional |
| `infRespTec` | Só se configurado (pergunta 6); sem CSRT |

**Ordem da montagem** (conferida no 010h: `infNFe`, `infNFeSupl`, `Signature`):

1. Monta `<NFe xmlns="http://www.portalfiscal.inf.br/nfe"><infNFe Id="NFe<chave>" versao="4.00">…</infNFe></NFe>` como documento próprio. O `xmlns` fica no `NFe` para a canonicalização ser a mesma depois, dentro do lote.
2. Assina: `assinarXmlEnveloped(xml, 'NFe' + chave, cert)`.
3. Calcula o QR e insere `<infNFeSupl>` logo antes de `<Signature`.
   - O QR v2 on-line não depende da assinatura; o off-line da fase 2 usa o `digVal` dela, por isso a ordem é assinar antes.
   - A assinatura cobre só o `infNFe`, então o `infNFeSupl` fora dela não a quebra.
   - **Premissa sobre a função fixa:** ela devolve a `Signature` como irmã do elemento assinado, no fim do pai, como o MOC pede. Se a entrega 3 não fizer assim, isso vira uma pergunta para a entrega 3; esta interface não muda.
4. Embrulha em `<enviNFe versao="4.00"><idLote>…</idLote><indSinc>1</indSinc><NFe…/></enviNFe>`.
   - `idLote` = sequência do banco, até 15 dígitos.
   - Antes de enviar, confere o teto de 500 KB (rejeição 214).
5. Ao autorizar, guarda o `nfeProc` (a `NFe` enviada, byte a byte, mais o `protNFe` como veio) em `nfce_cupons.xml_autorizado`. É o XML de guarda.

**Validação antes de enviar.** O `api/package.json` não tem validador de XSD, e não entra dependência nova em produção. *minha*

- **No domínio**, tudo o que vira rejeição conhecida:
  - formatos: NCM com 8 dígitos, CEST com 7, GTIN com DV (8, 12, 13 ou 14), CPF/CNPJ com DV, combinação CFOP × CSOSN, série e número;
  - somas: itens, desconto, pagamentos e troco;
  - limites: até 990 itens; `vNF` > 0 e abaixo de R$ 200.000,00 (B.3); textos no tamanho do esquema e sem caractere de controle.
- **Nos testes:** o `xmllint --schema` do sistema, quando estiver instalado, valida o XML montado contra o `leiauteNFe_v4.00.xsd` do 010h guardado em `__tests__/fixtures/xsd/`. É um oráculo opcional, como o `xml-crypto` da assinatura.
- **Em produção:** rejeição de esquema é defeito nosso e para a emissão já na 1ª (§4.4).

**Números no XML:** o domínio trabalha em inteiros (centavos e décimos de milésimo, com `bigint`) e formata texto: `vProd` "24.00", `qCom` "2.0000", `vUnCom` "12.00". Nunca `number` com casas.

### 5.3 Retornos da autorização e da consulta

**Endereços e SOAP:**

- **Autorização:** `NFeAutorizacao4` em `https://nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx`; homologação em `https://homologacao.nfce.fazenda.sp.gov.br/ws/NFeAutorizacao4.asmx` (conferido, B.2).
- **Action e `nfeDadosMsg`:** action `http://www.portalfiscal.inf.br/nfe/wsdl/NFeAutorizacao4/nfeAutorizacaoLote` e `nfeDadosMsg` com o namespace do WSDL, pelo padrão nacional da NT 2016.002.
  - *Não conferido no WSDL de SP* (abrir o `?wsdl` é chamar o serviço): é passo 1 do teste.
  - O mesmo vale para `NFeConsultaProtocolo4/nfeConsultaNF`, `NFeRecepcaoEvento4/nfeRecepcaoEvento` e `NFeStatusServico4/nfeStatusServicoNF`.

**Autorização:**

| Retorno | Fonte | Cupom | Ambiente | Frase |
|---|---|---|---|---|
| Lote processado, com `protNFe` (esperado 104) | *não confirmado*: o código não está na pesquisa, e o ramo `protNFe` do `retEnviNFe` é esperado (§ esquemas) | segue o `protNFe` | — | — |
| 100 autorizado | *não confirmado na pesquisa*; o 1º teste confirma | `autorizado` + venda | — | "Autorizado · NFC-e série S nº N" |
| 150 autorizado fora de prazo | B.5 | `autorizado` + venda | — | idem |
| 120 autorizado com alerta | B.2 | `autorizado` + venda; guarda `cMsg`/`xMsg` | — | Faixa âmbar: "Autorizado com alerta da SEFAZ: <xMsg>" |
| Uso denegado (esperados 110, 301 e 302) | *não confirmado* | `denegado`; número usado; sem venda | — | "A SEFAZ negou o uso do cupom (código N): <motivo>. O número foi consumido. Fale com o contador." |
| 204, duplicidade com a mesma chave | *inferência*, B.6 | `sem_resposta` (a consulta traz o protocolo) | — | "A SEFAZ já tem este cupom. Consulte para ver a situação." |
| 539, mesmo número com outra chave | *inferência*, B.6 | `rejeitado`, número bloqueado; só Descartar | `parada_serie_em_uso` | "A SEFAZ diz que o número N da série S já foi usado por outra nota: outro sistema pode estar usando esta série. A emissão parou; troque a série em Configurações." |
| 704, `dhEmi` atrasado | B.3 | `rejeitado` | conta no teto; o relógio é conferido | "A hora do cupom ficou atrasada. Envie de novo (a hora é refeita)." |
| 108/109, serviço parado | A.4 (eventos); *não confirmado* para a autorização | `nao_enviado` | — | "A SEFAZ está fora do ar (código N). Tente mais tarde; o número continua o mesmo." |
| 656 | B.6 | `nao_enviado` | §4.4, regra 6 | "A SEFAZ bloqueou os envios deste CNPJ por consumo indevido. O caixa da loja pode estar bloqueado também. Nada será enviado até HH:MM." |
| 781, emissor não habilitado | B.1 | `nao_enviado` | `parada_configuracao` | "Esta loja não está credenciada para emitir NFC-e neste ambiente (código 781). Faça o credenciamento no portal da SEFAZ-SP." |
| 280–286, 290–298, 213 (certificado e assinatura) | A.4, por semelhança | `nao_enviado` | `parada_certificado` | "A SEFAZ recusou o certificado digital ou a assinatura (código N). A emissão parou; confira o certificado em Configurações." |
| 214, 215, 225, 402, 404, 516, 517, 587, 588 (esquema e lote) | A.4, por semelhança | `nao_enviado` | `parada_configuracao` | "A emissão parou por um erro do sistema (código N). Avise o suporte." |
| 373, 394, 395 e o código de hash do QR inválido | B.3, B.5; o código do hash é *não confirmado* | `rejeitado` | `parada_configuracao` | "A SEFAZ recusou o QR Code (código N). Confira o CSC e o IdCSC deste ambiente em Configurações." |
| Demais rejeições da nota (NCM, CFOP, CSOSN, totais…) | — | `rejeitado` | conta no teto | "A SEFAZ recusou o cupom (código N): <xMotivo>. Corrija em Cupom fiscal → Produtos e envie de novo." |
| `SefazErro` com `enviado = false` | código do transporte | `nao_enviado` | — | "Não consegui falar com a SEFAZ. Nada foi enviado; tente de novo." |
| `SefazErro` com `enviado = true` (prazo, queda, HTTP, resposta ilegível) | código do transporte | `sem_resposta` | — | "A SEFAZ não respondeu. O cupom pode ter sido autorizado: consulte a partir de HH:MM antes de qualquer outra coisa." |
| `CertificadoErro` | porta do certificado | não chama | — | As frases de `MSG_USO` |

**O `xMotivo` na frase** (minha; diferente da busca, que usa só frases fixas): aqui o motivo é o que o admin precisa para corrigir o cadastro.

- Vem de um campo do XML de retorno, nunca do corpo bruto.
- É cortado em 255 caracteres e passa só como texto.

**Consulta** (`NFeConsultaProtocolo4`; `consSitNFe versao="4.00"` com `tpAmb`, `xServ` "CONSULTAR" e `chNFe`):

| Resposta | Cupom |
|---|---|
| `protNFe` autorizado | `autorizado` + venda; a tentativa é casada pelo `digVal` |
| `procEventoNFe` de cancelamento | `cancelado` |
| Denegada | `denegado` |
| "Não consta na base" (esperado 217; *não confirmado*) | `nao_consta` |
| 656, 108/109, certificado | As regras da tabela acima |
| Outro código | Continua `sem_resposta`, com o código na frase |

### 5.4 Cancelamento

- **Destino:** evento 110111 enviado ao `NFeRecepcaoEvento4` **da NFC-e de SP** (URLs em B.2).
- **Assinatura:** `assinarXmlEnveloped(xml, 'ID110111' + chave + '01', cert)` sobre o `infEvento`.
- **Leiaute:** `envEvento versao="1.00"`, `idLote` e um evento.
  - `infEvento`: `cOrgao` 35 (*inferência*, B.6), `tpAmb`, `CNPJ`, `chNFe`, `dhEvento` com o fuso de Brasília, `tpEvento` 110111, `nSeqEvento` 1, `verEvento` 1.00.
  - `detEvento versao="1.00"`: `descEvento` "Cancelamento", `nProt` e `xJust`.
- **Prazo:** 30 min da autorização, contados do `dhRecbto` do protocolo (B.6).
  - O botão e o servidor aceitam até autorização + 29 min (1 min de folga para relógio e rede). *minha*
  - Depois disso, 409 `NFCE_CANCELAMENTO_FORA_DO_PRAZO`.
  - A tela mostra "Pode cancelar até HH:MM".
- **Motivo:** obrigatório, de 15 a 255 caracteres; vai no `xJust` e no cupom.
- **Envio:** o mesmo T1 → rede → T2, com `servico = 'cancelamento'`.
- **Retornos:**

  | Retorno | Fonte | O que acontece |
  |---|---|---|
  | Lote 128 | conferido para eventos, A.4 | Lê o `retEvento` |
  | 135 | A.4 | `cancelado` e desfaz a venda na mesma T2 (o 136 da manifestação não se aplica aqui, *não confirmado*) |
  | 573 | A.4 | `cancelando`: o cancelamento pode já ter entrado; a consulta decide |
  | Enviado sem resposta (`enviado = true`) | código do transporte | `cancelando`: a consulta decide, a partir de 2 min |
  | Fora de prazo | código *não confirmado* | Continua `autorizado`, com a frase do prazo |
  | 656, certificado, esquema | — | Continua `autorizado`; regras da §4.4 |
  | Falha antes de enviar, ou outro código | — | Continua `autorizado`, com o código na frase |

- **Guarda:** o `procEventoNFe` (evento + retorno) fica em `nfce_envios`.
- **Validação local:** contra o `tiposBasico_v1.03` (`TProt` com 15 ou 17), não contra o pacote de 2018 (B.6).
- **Cancelamento por substituição (110112):** fase 2, junto com a contingência.

### 5.5 Contingência off-line: fase 2 (decisão do construtor)

**Por que esperar:**

- **A tela simples não é o caixa.** Com a SEFAZ fora, a venda sai pelo caixa de hoje. Sem contingência, nenhum cupom fica "emitido e não transmitido".
- **A contingência traz um pacote de obrigações** que só faz sentido com operação diária, e cada uma, feita pela metade, é risco fiscal (B.5, B.6):
  - impressão obrigatória e uma via guardada na loja;
  - transmissão até o 1º dia útil seguinte (150 depois de 24 h);
  - nota rejeitada depois regerada com o mesmo número;
  - cancelamento por substituição (110112, até 168 h) da nota normal que sair autorizada depois;
  - pular um número ao entrar em contingência;
  - retransmissão agendada.
- **Ela não resolve o caso mais comum numa loja:** a internet da loja caída (§1).

**O que já fica pronto agora:**

- as colunas `tp_emis`, `dh_cont`, `x_just` e `dig_val` em `nfce_cupons`;
- a numeração com prova;
- o diário `nfce_envios`;
- o formato off-line do QR, conferido no esquema (`digVal` = 56 hex dos 28 caracteres base64), anotado junto da função do QR.

**O que acontece agora quando a SEFAZ não responde:**

- O cupom fica `sem_resposta` até a consulta.
- Se a consulta disser "não consta" e os 5 min do `dhEmi` já tiverem passado, "Enviar de novo" remonta com hora nova, sem 704.
- Se a SEFAZ continuar fora, o cupom espera com o número preso, e a venda sai pelo caixa de hoje. O admin descarta depois que a consulta disser "não consta".
- Não é beco sem saída; é espera.

### 5.6 QR Code v2 e DANFE NFC-e

**QR Code** (B.5; formato conferido no esquema):

- `qrCode` = `<URL>?p=<chave>|2|<tpAmb>|<IdCSC sem zeros à esquerda>|<hash>`.
- `hash` = SHA-1 em hexadecimal de `"<chave>|2|<tpAmb>|<IdCSC>" + CSC`, com o CSC colado sem `|`.
- **URLs de SP**, constantes no código:

  | | Produção | Homologação |
  |---|---|---|
  | QR (forma longa) | `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx` | `https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica/Paginas/ConsultaQRCode.aspx` |
  | `urlChave` | `https://www.nfce.fazenda.sp.gov.br/NFCeConsultaPublica` | `https://www.homologacao.nfce.fazenda.sp.gov.br/NFCeConsultaPublica` |

  A forma curta do QR (`/qrcode`) só se a 395 recusar a longa no teste.
- **CSC:** decifrado só na montagem; nunca em resposta, log, erro ou XML guardado (o QR leva só o hash).
- **QR v3:** só depois de confirmar em homologação que SP aceita.

**DANFE** (B.7):

- **Dados:** `GET /v1/cupom-fiscal/cupons/:id/danfe` devolve JSON montado **só do `nfeProc` guardado**: divisões I a IX, mais `nProt`, `cMsg` e `xMsg` do retorno. Nada vem das tabelas, porque "nada pode ser impresso que não esteja no XML".
- **Página de impressão** `/cupom/[id]/imprimir`:
  - sem o menu (`no-print` já existe), com `@page { size: 80mm auto; margin: 2mm }` e botão "Imprimir" (`window.print()`);
  - serve em qualquer impressora térmica instalada no computador, e em A4.
- **Desenho do QR no navegador:** por uma dependência pequena e sem dependências próprias (por exemplo `qrcode-generator`).
  - Versão exata conferida no registro do npm no dia; importada num arquivo só (`web/src/lib/qrcode.ts`).
  - Correção de erros nível M, pelo menos 25 mm.
  - Justificativa: o QR é obrigatório (394), e escrever o codificador à mão (Reed-Solomon e máscaras) é onde se erra.
- **Textos fixos:**
  - homologação: "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL" na divisão VIII;
  - consumidor: "CONSUMIDOR CPF: …" ou "CONSUMIDOR NÃO IDENTIFICADO".
- **Digital, agora:** na tela do cupom, "Copiar chave e link de consulta" e "Baixar XML".
  - Com CPF informado, o consumidor também acha a nota na Nota Fiscal Paulista (B.7).
  - `tpImp` = 4 sempre nesta fase.
- **Cancelado:** a tela mostra "CANCELADO às HH:MM"; o DANFE não é reimpresso.

## 6. IBS/CBS e Simples Nacional

**Situação** (B.4):

- Em 2026 a SEFAZ não rejeita NFC-e sem `IBSCBS`; para o Simples (CRT 1), o tributo começa em 2027.
- A NT 2026.005 define:
  - `cAtivSN` por item;
  - para quem não está no regime regular, o grupo `gTribSN` (`gIBSSN`/`gCBSSN`, com alíquota efetiva e valor);
  - nesse caso, sem `gIBSCBS` e sem `tpRegimeIBSCBS`.

**Agora (minha):** o cadastro guarda os campos e valida só o formato; o XML **não** leva nada disso.

- **Perfil fiscal:**
  - `c_ativ_sn` (2 dígitos);
  - `ibs_sn_aliq` e `cbs_sn_aliq` (alíquotas efetivas, `numeric(7,4)`);
  - para CRT 3: `ibscbs_cst` (3) e `ibscbs_cclass_trib` (6).
- **Emitente:** `tp_regime_ibscbs`, só para Simples no regime regular; vazio no caso provável.
- O contador preenche tudo de uma vez, junto com o resto.

**Fatia "IBS/CBS no XML", antes de 01/01/2027:**

- reler a NT 2026.005 e o cronograma (conflito 16/11 × 14/12/2026);
- testar em homologação;
- só então montar o grupo.

Se a alíquota efetiva do Simples for da empresa, e não do perfil, os dois campos mudam de tabela numa migração pequena.

## 7. Configurações

### 7.1 Ambiente do servidor e interruptor

**`NFCE_AMBIENTE`** = `desligado` (padrão) | `homologacao` | `producao`.

- **Separada de `SEFAZ_DFE_AMBIENTE`:** dá para testar o cupom em homologação com a busca já em produção.
- **Onde entra:**
  - zod em `env.validation.ts` (valor desconhecido derruba a subida);
  - `docker-compose.prod.yml` com `${NFCE_AMBIENTE:-}`;
  - `api/.env.example`;
  - `web/scripts/browser-check.sh` força a variável vazia;
  - o smoke usa `homologacao`, atrás da barreira `api/scripts/smoke-sem-rede.cjs`.
- **Mudar a variável** = recriar só a API, porque o `restart` não relê o `.env` (docs/deploy.md).

**Com `desligado`:**

- continuam funcionando os cadastros (emitente, perfis, produtos, série, CSC) e a leitura dos cupons já emitidos, porque os dados chegam antes da subida;
- emitir, consultar, cancelar, testar e ligar respondem 503 `NFCE_DESLIGADA`.

**Interruptor "Emitir cupons":** um por ambiente, desligado de fábrica.

- Ligar grava quem e quando, em `nfce_ambientes` e no histórico.
- Vale para o trio (ambiente, CNPJ, série): mudou o CNPJ da empresa ou a série, ele desliga sozinho.

**Ligar em homologação pede:**

- certificado em uso válido e com o mesmo CNPJ-base da empresa;
- CNPJ da empresa, IE, CRT e endereço;
- série, CSC e IdCSC do ambiente;
- pelo menos 1 produto pronto.

**Ligar em produção pede, além disso:**

- pelo menos 1 cupom autorizado **e** 1 cancelado em homologação com este CNPJ (o CNPJ sai da chave, posições 7 a 20; o cupom não tem coluna de CNPJ);
- `cupom_lanca_venda` respondido (§3.4);
- as séries do outro sistema (ou "nenhum") e uma série diferente delas;
- a confirmação deste texto: "O cupom é emitido em nome da empresa, com o certificado digital, e vale como documento fiscal. Confirme: (1) a série S não é usada pelo outro sistema de caixa; (2) o CSC cadastrado é um dos dois da empresa e nenhum foi revogado; (3) o contador sabe que este sistema vai emitir. Se a SEFAZ bloquear este sistema por excesso de recusas, o caixa da loja pode parar junto por até 1 hora.";
- fora do sistema, o "eu autorizo" do dono para pôr `producao` no `.env`.

### 7.2 Tudo o que é configurável

| Campo | Onde | Validação |
|---|---|---|
| CNPJ, razão social, nome fantasia | `configuracoes` (já existem; a NFC-e só lê) | CNPJ com DV (etapa 0) |
| IE | `nfce_emitente` | Obrigatória; só dígitos (12 em SP) |
| CRT | `nfce_emitente` | 1, 2, 3 ou 4; decide CSOSN × CST |
| Endereço: logradouro, número, complemento, bairro, CEP, código e nome do município, UF, telefone | `nfce_emitente` | CEP 8 dígitos; município 7 dígitos (padrão 3556206, Valinhos); UF SP. O `configuracoes.endereco` em texto livre fica como está |
| Natureza da operação | `nfce_emitente` | 1 a 60 caracteres; padrão "VENDA" |
| Texto adicional do cupom | `nfce_emitente` | Até 500 caracteres (*minha*) |
| Responsável técnico (CNPJ, contato, e-mail, telefone) | `nfce_emitente` | Tudo ou nada; CNPJ com DV; vazio = grupo omitido |
| Séries do outro sistema, ou "nenhum" | `nfce_emitente` | Lista de 0 a 889; barra a série igual |
| Lançar as vendas no estoque | `nfce_emitente` | Sim ou não, sem padrão (§3.4) |
| Regime IBS/CBS | `nfce_emitente` | §6 |
| Série e próximo número | `nfce_ambientes` | §4.1 |
| CSC | `nfce_ambientes`, cifrado | 16 a 36 letras e números (B.1); só escrita; a tela mostra "••••1234" |
| IdCSC | `nfce_ambientes` | 1 a 999999 |
| Emissão ligada | `nfce_ambientes` | §7.1 |
| Perfis fiscais | `nfce_perfis_fiscais` | §3.2; perfil em uso só é desativado, nunca apagado |
| Dados fiscais do item | `nfce_itens` | NCM 8 dígitos; CEST 7; GTIN com DV; origem 0–8; descrição até 120; unidade até 6 |

**Constantes do código, não configuráveis:** vêm das normas ou são margens de segurança.

- URLs de SP;
- prazos de 20 s, 2 min, 29 min e 65 min;
- os tetos da §4.4;
- o limite de R$ 10.000,00 para consumidor não identificado;
- `tpImp` 4, `indPres` 1 e `modFrete` 9.

### 7.3 Quem pode

- **Fase 1: só admin,** em todas as rotas novas (`@AdminOnly()`).
  - Todas entram no `permissoes-protecao.spec.ts`, e a lista da loja não muda.
  - O cupom mostra o preço de venda, e a regra do projeto é que a loja nunca vê preço (o `loja_fichas()` nem traz `preco_venda`).
- **Fase 2:** emitir no balcão exige uma decisão do dono (pergunta 7).
  - Ou um perfil novo, "caixa", que vê o preço de venda e nunca custo, teórico ou financeiro.
  - Ou mudar a regra.
  - Qualquer das duas muda o CLAUDE.md e o teste de permissões.
- **Fora de `configuracoes`:** o CSC e os dados fiscais não entram em `configuracoes`, porque `GET /v1/configuracoes` é `@Staff()` e devolve a linha inteira para a loja.

### 7.4 Exportação para o contador

`GET /v1/cupom-fiscal/xml-do-mes?mes=AAAA-MM&ambiente=producao` devolve um `.zip` com:

- o `nfeProc` de cada cupom autorizado ou denegado;
- o `procEventoNFe` de cada cancelamento;
- `numeros-nao-usados.csv` (§4.3).

O zip é sem compressão, escrito à mão com `zlib.crc32` (Node 20.15+ e 22.2+), sem dependência. *minha*

Entra já na fase 1, porque o 1º cupom real de produção tem de chegar ao contador.

## 8. Modelo de dados, rotas, porta e erros

### 8.1 Tabelas (migração `nfce`)

**Regras gerais:**

- Datas em `timestamptz`; nenhuma coluna `date` nova, então o `DATE_ONLY_KEYS` não muda.
- Dinheiro em `numeric(15,2)` e quantidade em `numeric(15,4)`; no domínio, sempre inteiros.
- `n_prot` é texto, porque 17 dígitos passam de 2^53 e o interceptor converte `bigint` em número.
- `c_stat` é inteiro de até 4 dígitos; `c_nf` é texto de 8.
- Todas as tabelas `nfce_*` entram em `TABELAS_SO_NOSSAS`.

**`nfce_emitente`** (uma linha, `id = 1`):

- `ie`, `crt smallint CHECK IN (1,2,3,4)`;
- endereço: `logradouro`, `numero`, `complemento`, `bairro`, `cep char(8)`, `cod_municipio char(7) DEFAULT '3556206'`, `municipio DEFAULT 'Valinhos'`, `uf char(2) DEFAULT 'SP'`, `telefone`;
- `nat_op DEFAULT 'VENDA'`, `inf_cpl`;
- responsável técnico: `resp_tec_cnpj`, `resp_tec_contato`, `resp_tec_email`, `resp_tec_fone`;
- outro sistema: `series_outro_sistema smallint[]`, `sem_outro_sistema boolean`;
- `cupom_lanca_venda boolean` (nulo = não respondido), com `…_por`, `…_por_nome` e `…_em`;
- `tp_regime_ibscbs`;
- `atualizado_por`, `atualizado_por_nome`, `atualizado_em`.

**`nfce_ambientes`** (PK `ambiente CHECK IN ('homologacao','producao')`); é a linha travada com `FOR UPDATE` na T1:

- emissão: `emissao_ligada boolean NOT NULL DEFAULT false`, `ligada_cnpj char(14)`, `ligada_serie smallint`;
- numeração: `serie smallint CHECK 0–889`, `proximo_numero bigint CHECK 1–999999999`;
- CSC:
  - `csc_cifrado text`: AES-256-GCM com `CERTIFICADO_SECRET` e rótulo próprio `nfce-csc`, como a chave de IA e o certificado; sem o segredo, o recurso fica desligado;
  - `csc_dica char(4)`, `id_csc int CHECK 1–999999`;
- estado: `situacao CHECK IN ('ok','parada_656','parada_certificado','parada_configuracao','parada_serie_em_uso')`, `mensagem`, `bloqueado_ate`, `ultimo_656_em`, `ultimo_status_em`;
- autoria: `alterada_por`, `alterada_por_nome`, `alterada_em`.

**`nfce_ambientes_historico`** (só inserção):

- `ambiente`, `evento CHECK IN ('ligada','desligada','parada_automatica','configuracao')`;
- `campos text[]`: nomes dos campos mudados, nunca o valor do CSC;
- `situacao`, `c_stat`, `mensagem`;
- `feito_por`, `feito_por_nome`, `feito_em`.

**`nfce_perfis_fiscais`:**

- `id uuid`, `nome UNIQUE`;
- ICMS: `cfop char(4)`, `csosn char(3)`, `cst_icms char(2)`, `aliq_icms numeric(5,2)`;
- `pis_cst char(2)`, `cofins_cst char(2)`;
- IBS/CBS: `c_ativ_sn char(2)`, `ibs_sn_aliq numeric(7,4)`, `cbs_sn_aliq numeric(7,4)`, `ibscbs_cst char(3)`, `ibscbs_cclass_trib char(6)`;
- `ativo` e autoria.
- CHECKs: `csosn` ou `cst_icms`, nunca os dois; formatos.
- As combinações CFOP × CSOSN e CRT × grupo ficam no domínio, porque dependem do CRT do emitente.

**`nfce_itens`** (PK `item_cardapio_id`, FK para `itens_cardapio ON DELETE CASCADE`):

- `perfil_fiscal_id` FK `ON DELETE RESTRICT`; nulo = incompleto;
- `ncm char(8) CHECK ~ '^[0-9]{8}$'`; nulo = incompleto;
- `cest char(7)`, `gtin varchar(14)` (nulo = "SEM GTIN");
- `origem smallint NOT NULL DEFAULT 0 CHECK 0–8`;
- `descricao_cupom varchar(120)`, `unidade varchar(6)`;
- autoria.
- "Pronto para o cupom" é derivado: item ativo + preço > 0 + NCM + perfil ativo.

**`nfce_cupons`** (uma linha por cupom; a única tabela com estado):

- **identificação:** `id uuid`, `ambiente`, `serie`, `numero bigint`, `chave varchar(44)` (CHECK do formato), `c_nf char(8)`, `tp_emis smallint NOT NULL DEFAULT 1`, `dh_cont`, `x_just` (os dois últimos só na fase 2), `dh_emi`;
- **estado:**
  - `situacao CHECK IN ('enviando','nao_enviado','sem_resposta','nao_consta','rejeitado','autorizado','cancelando','denegado','cancelado','descartado')`;
  - `numero_reaproveitavel boolean NOT NULL DEFAULT true`: falso no 539;
  - `envios smallint NOT NULL DEFAULT 0 CHECK ≤ 3`;
- **idempotência:** `chave_idempotencia uuid NOT NULL UNIQUE`;
- **consumidor:** `consumidor_doc varchar(14)` (CPF ou CNPJ, pode ter letras);
- **valores:** `valor_produtos`, `valor_desconto`, `valor_total`, `valor_troco`, com CHECK ≥ 0 e `valor_total = valor_produtos − valor_desconto`;
- **autorização:** `autorizada_em` (`dhRecbto`), `n_prot varchar(17)`, `c_stat`, `x_motivo`, `alerta_c_msg`, `alerta_x_msg`, `dig_val`, `xml_autorizado text` (o `nfeProc`);
- **cancelamento:** `cancelado_em`, `cancelamento_motivo`, `cancelamento_n_prot`, `cancelamento_pedido_em` (quando o evento foi enviado, para a situação `cancelando`);
- **venda no estoque:** `venda_lancada_em`, `venda_desfeita_em`, `venda_erro` (§3.3; nulo/preenchido = marcador de venda pendente);
- **descarte:** `descartado_em`, `descarte_motivo`;
- **autoria:** `emitido_por`, `emitido_por_nome`, `criado_em`, `atualizado_em`;
- **índices:**
  - únicos parciais `(ambiente, serie, numero) WHERE situacao <> 'descartado'` e `(chave) WHERE situacao <> 'descartado'`;
  - `(ambiente, criado_em DESC)`;
  - parcial nas situações pendentes;
- **gatilho `nfce_cupons_imutavel`** (§5.1): com `OLD.situacao IN ('autorizado','cancelando','denegado','cancelado')`, recusa mudar `numero`, `serie`, `chave`, os valores, `xml_autorizado` e `n_prot`.
  - Só deixa passar `autorizado ↔ cancelando`, `cancelando → cancelado` e `autorizado → cancelado`, com os campos do cancelamento, além dos campos da venda no estoque.
  - DELETE é sempre recusado.

**`nfce_cupom_itens`:**

- `cupom_id` FK `ON DELETE RESTRICT`, `n_item smallint` (1–990), `item_cardapio_id` FK `ON DELETE SET NULL`;
- a fotografia: `nome_cardapio` (o `itens_cardapio.nome` do momento, usado na venda, §3.3), `c_prod`, `x_prod`, `ncm`, `cest`, `gtin`, `origem`, `unidade`, `cfop`, `csosn`, `cst_icms`, `aliq_icms`, `pis_cst`, `cofins_cst`, os campos do IBS/CBS e `perfil_nome`;
- `quantidade numeric(15,4) CHECK > 0`, `valor_unitario`, `valor_bruto`, `valor_desconto`;
- UNIQUE (`cupom_id`, `n_item`).
- Gatilho: só muda com o cupom fora de `autorizado`, `denegado` e `cancelado`.

**`nfce_cupom_pagamentos`:**

- `cupom_id`, `ordem`;
- `t_pag char(2) CHECK IN ('01','03','04','10','11','17')`;
- `valor numeric(15,2) CHECK > 0`, `tp_integra smallint`;
- mesmo gatilho dos itens.

**`nfce_envios`** (só inserção, mais o fechamento da própria linha, como `sefaz_consultas`). É o diário que prova as travas do 656 e guarda os eventos:

- `id uuid`, `ambiente`, `cupom_id` (nulo no `status`);
- `servico CHECK IN ('autorizacao','consulta','cancelamento','status')`, `tentativa smallint`, `id_lote bigint` (sequência `nfce_id_lote_seq`);
- `iniciada_em`, `terminada_em`, `resultado CHECK IN ('respondida','falha_antes_de_enviar','sem_resposta','interrompida')`;
- retorno: `c_stat_lote`, `c_stat`, `x_motivo`, `n_prot varchar(17)`, `dh_recbto text`, `dig_val`;
- `rejeicao boolean` (conta no teto), `erro_code`, `duracao_ms`;
- `xml_enviado text` (assinado; nunca contém o CSC), `xml_retorno text` (o conteúdo do `nfeResultMsg`);
- `iniciada_por`, `iniciada_por_nome`, `certificado_impressao char(64)`;
- índices `(ambiente, iniciada_em DESC)` e `(cupom_id)`.
- **Volume** (conta, não medição): 30 cupons por dia ≈ 11 mil envios por ano; a ~10 KB de XML por envio, ≈ 110 MB por ano.

**Mudanças em tabelas que já existem:**

- `vendas.nfce_cupom_id` (§3.3);
- em `itens_cardapio`, `COMMENT` de obsoleto em `ncm`, `cfop`, `cst` e `aliquota`.

**Funções SQL:** `nfce_lancar_venda(_cupom)` e `nfce_desfazer_venda(_cupom)` (§3.3).

### 8.2 Rotas

**Regras gerais:**

- Todas `@AdminOnly()` e no `permissoes-protecao.spec.ts`.
- Rotas estáticas antes das `:id`; `:id` passa pelo `ParseUuidPipe`.
- `:ambiente` só aceita `homologacao` ou `producao` (senão 404).

**Leitura e cadastro** (funcionam com o servidor `desligado`):

- `GET /v1/cupom-fiscal/situacao` → `{ ambiente, emissao_ligada, situacao, mensagem, bloqueado_ate, serie, proximo_numero, falta: string[], certificado: { ok, mensagem }, pendentes }`.
- `GET | PUT /v1/cupom-fiscal/emitente`.
- `GET | PUT /v1/cupom-fiscal/ambientes/:ambiente`: `serie`, `proximo_numero`, `id_csc` e `csc?` (só escrita; a resposta traz `csc_dica`).
- `GET | POST /v1/cupom-fiscal/perfis` e `PATCH /v1/cupom-fiscal/perfis/:id`.
- `GET /v1/cupom-fiscal/produtos`, `PUT /v1/cupom-fiscal/produtos/:itemCardapioId` e `POST /v1/cupom-fiscal/produtos/importar` (fatia opcional).
- `GET /v1/cupom-fiscal/vendas-no-periodo?ini=&fim=`.
- `GET /v1/cupom-fiscal/xml-do-mes?mes=&ambiente=`.
- `GET /v1/cupom-fiscal/cupons?ini=&fim=&situacao=&limite=` (padrão 100, máximo 500).
- `GET /v1/cupom-fiscal/cupons/:id`: com o resumo dos envios, sem XML.
- `GET /v1/cupom-fiscal/cupons/:id/danfe`.
- `GET /v1/cupom-fiscal/cupons/:id/xml?tipo=nota|cancelamento`: `text/xml`, com o cabeçalho posto por `res.header` depois das checagens, nunca `@Header` (regra do CLAUDE.md).

**Falam com a SEFAZ ou mudam a emissão** (503 `NFCE_DESLIGADA` com o servidor desligado):

- `PUT /v1/cupom-fiscal/ambientes/:ambiente/emissao` com `{ ligada, confirmado? }`; só para o ambiente do servidor.
- `POST /v1/cupom-fiscal/testar-conexao`.
- `POST /v1/cupom-fiscal/cupons`:
  - corpo `{ chave_idempotencia, itens: [{ item_cardapio_id, quantidade }], desconto?, pagamentos: [{ t_pag, valor }], consumidor_doc? }`;
  - responde 201 com o cupom em qualquer situação final desta tentativa: autorizado, rejeitado, sem resposta etc.;
  - a mesma chave responde 200 com o mesmo cupom, sem novo envio;
  - os erros HTTP (§8.4) são só da validação antes de enviar.
- `POST /v1/cupom-fiscal/cupons/:id/consultar`, `…/reenviar`, `…/descartar` com `{ motivo }` e `…/cancelar` com `{ motivo }`.
- `POST /v1/cupom-fiscal/cupons/:id/lancar-venda`: refaz a T3 (lançar ou desfazer a venda, conforme a situação). Não fala com a SEFAZ, então funciona também com o servidor desligado.

### 8.3 Porta e adaptador

```ts
// modules/sefaz/nfce.port.ts — infraestrutura; não decide QUANDO chamar (as travas são do cupom-fiscal)
export const SEFAZ_NFCE = Symbol('SEFAZ_NFCE');
export interface ProtocoloNfce {
  cStat: number; xMotivo: string; chave: string; dhRecbto: string; nProt: string | null; digVal: string | null;
  cMsg: string | null; xMsg: string | null; xml: string; // protNFe serializado, como veio
}
export interface RespostaAutorizacao { cStatLote: number; xMotivoLote: string; dhRecbto: string | null; protocolo: ProtocoloNfce | null; xmlRetorno: string }
export interface RespostaConsulta {
  cStat: number; xMotivo: string; protocolo: ProtocoloNfce | null;
  cancelamento: { cStat: number; nProt: string | null; xml: string } | null; xmlRetorno: string;
}
export interface RespostaEvento { cStatLote: number; xMotivoLote: string; cStat: number | null; xMotivo: string | null; nProt: string | null; dhRegEvento: string | null; xmlRetorno: string }
export interface RespostaStatus { cStat: number; xMotivo: string; dhRecbto: string | null; tMed: number | null }
export interface SefazNfcePort {
  autorizar(cert: CertificadoEmUso, ambiente: AmbienteSefaz, enviNFe: string): Promise<RespostaAutorizacao>;
  consultar(cert: CertificadoEmUso, ambiente: AmbienteSefaz, chave: string): Promise<RespostaConsulta>;
  registrarEvento(cert: CertificadoEmUso, ambiente: AmbienteSefaz, envEvento: string): Promise<RespostaEvento>;
  status(cert: CertificadoEmUso, ambiente: AmbienteSefaz): Promise<RespostaStatus>;
}
```

**Adaptador** `modules/sefaz/nfce.adapter.ts`:

- conhece as URLs de SP, as actions e o `nfeDadosMsg`;
- chama `chamarSoap12` com 20 s de prazo e teto de resposta de 2 MB (*minha*: as respostas da NFC-e são pequenas);
- lê as respostas com `xml-leitura.ts`;
- lança `SefazErro` como hoje: o `enviado` decide entre número livre e número preso;
- tem uma porta falsa para os testes.

**Aplicação** `modules/cupom-fiscal/`:

| Arquivo | Papel |
|---|---|
| `totais.ts` | Puro: centavos, rateio, troco |
| `montagem-xml.ts` | Puro: entrada → `NFe` sem assinatura |
| `evento-cancelamento.ts` | Puro: monta o evento 110111 |
| `qrcode-nfce.ts` | Puro: URL e hash do QR |
| `retornos.ts` | Puro: resposta → ação (tabela da §5.3) |
| `situacao-cupom.ts` | Transições permitidas e ações de cada situação |
| `validacao-fiscal.ts` | Perfil, item e cupom |
| `emissao.service.ts` | T1, rede, T2 |
| `cancelamento.service.ts` | Cancelamento |
| `cadastro.service.ts` | Emitente, ambientes, perfis, produtos |
| `xml-do-mes.ts` | Exportação para o contador |
| `frases.ts` | Frases da tela |
| `cupom-fiscal.controller.ts` e `cupom-fiscal.dto.ts` | Rotas e corpos |

- **Dependências do módulo:** importa a assinatura e a porta de `modules/sefaz`; recebe o certificado pela porta `CERTIFICADO_DIGITAL`.

**Peças compartilhadas e log:**

- **`common/fiscal`** ganha `montarChave`, `cpfValido` e `gtinValido`, repetidos iguais em `web/src/lib/fiscal.ts`.
- **Web:**
  - `web/src/lib/cupom.ts` repete `totais.ts`, com a mesma regra da ficha: manter os dois iguais;
  - as chamadas HTTP ficam em `@/lib/erp-api.ts`.
- **Log estruturado `nfce.envio`:**
  - grava ambiente, serviço, série, número, `cStat`, resultado, duração e tentativa;
  - nunca grava XML, CSC, CPF ou material do certificado.

### 8.4 Erros

Formato `{ error: { code, message } }`, com a frase pt-BR em `message`.

| Código | Status | Frase |
|---|---|---|
| `NFCE_DESLIGADA` | 503 | "A emissão de cupom fiscal não está ativada neste servidor." |
| `NFCE_EMISSAO_DESLIGADA` | 409 | "A emissão de cupons está desligada. Ligue em Configurações → Cupom fiscal." |
| `NFCE_CONFIG_INCOMPLETA` | 422 | "Falta configurar o cupom fiscal: <lista>." |
| `NFCE_PARADA` | 409 | A frase da parada, por exemplo: "A emissão parou: a SEFAZ recusou o certificado digital (código N). Confira o certificado e ligue de novo." |
| `NFCE_BLOQUEADA` | 409 | "A SEFAZ bloqueou os envios deste CNPJ por consumo indevido. O caixa da loja pode estar bloqueado também. Nada será enviado até HH:MM." |
| `NFCE_MUITAS_RECUSAS` | 409 | "Muitas recusas da SEFAZ na última hora. Confira o cadastro fiscal; o envio volta às HH:MM." |
| `NFCE_SEM_ITENS` | 400 | "Adicione pelo menos um produto." |
| `NFCE_ITEM_INDISPONIVEL` | 422 | "<Produto> não pode entrar no cupom: <falta NCM \| falta perfil fiscal \| sem preço de venda \| inativo>." |
| `NFCE_DESCONTO_INVALIDO` | 422 | "O desconto tem de ser menor que o valor dos produtos." |
| `NFCE_PAGAMENTO_INSUFICIENTE` | 422 | "A soma dos pagamentos (R$ X) é menor que o total (R$ Y)." |
| `NFCE_TROCO_INVALIDO` | 422 | "Troco só em dinheiro, e no máximo o valor pago em dinheiro." |
| `NFCE_DOC_INVALIDO` | 400 | "CPF ou CNPJ do consumidor inválido. Confira os números." |
| `NFCE_DOC_OBRIGATORIO` | 422 | "Acima de R$ 10.000,00, o CPF ou CNPJ do consumidor é obrigatório." |
| `NFCE_SITUACAO` | 409 | "Este cupom está <situação>; não dá para <ação>." |
| `NFCE_CONSULTA_CEDO` | 409 | "Espere até HH:MM para consultar (a SEFAZ bloqueia consultas repetidas)." |
| `NFCE_LIMITE_ENVIOS` | 409 | "Este cupom já foi enviado 3 vezes. Descarte e emita outro." |
| `NFCE_CANCELAMENTO_FORA_DO_PRAZO` | 409 | "Passaram 30 minutos da autorização (às HH:MM). A SEFAZ não aceita mais o cancelamento deste cupom; fale com o contador." |
| `NFCE_MOTIVO` | 400 | "Escreva o motivo com 15 a 255 caracteres." (no descarte: "Escreva o motivo do descarte.") |
| `NFCE_SERIE_INVALIDA` | 422 | "A série vai de 0 a 889 e não pode ser uma das séries do outro sistema." |
| `NFCE_SERIE_COM_PENDENTES` | 409 | "Há cupons pendentes nesta série. Resolva-os antes de trocar a série." |
| `NFCE_NUMERO_INVALIDO` | 422 | "O próximo número tem de ser maior que N, o último já usado na série S." |
| `NFCE_CSC_INVALIDO` | 422 | "O CSC tem de 16 a 36 letras e números; o IdCSC, de 1 a 6 dígitos." |
| `NFCE_PERFIL_INVALIDO` | 422 | Por exemplo: "Com o Simples Nacional (CRT 1), o perfil precisa do CSOSN." / "O CSOSN 500 só vale com o CFOP 5.405." |
| `NFCE_PRODUCAO_SEM_TESTE` | 422 | "Antes de ligar em produção, autorize e cancele um cupom em homologação." |
| `NFCE_LANCA_VENDA_PENDENTE` | 422 | "Responda se as vendas emitidas aqui também ficam registradas no outro sistema." |
| `NFCE_TESTE_CEDO` | 409 | "Espere até HH:MM para testar a conexão de novo." |
| `CERTIFICADO_*` | 503/422 | As frases de `CertificadoErro` (`MSG_USO`) |

## 9. Riscos, perguntas e 1º teste

### 9.1 Riscos (do mais grave ao menos grave)

1. **Convivência com o caixa de hoje.**
   - O risco: série repetida (539), CSC revogado sem querer (o outro sistema para de emitir) e 656 que para os dois.
   - Mitigação: série diferente obrigatória, a frase do CSC, o 539 parando a emissão e as travas da §4.4.
2. **Venda em dobro, no estoque e nos relatórios, ou NFC-e em dobro para a mesma venda.**
   - Mitigação: `cupom_lanca_venda` respondido antes de produção, o aviso na importação e a regra "uma venda, um sistema".
3. **Guarda dos XML.**
   - O risco: o emitente é obrigado a guardar os XML, e eles ficam num banco só, no mesmo servidor da API (a EC2 única, a mesma do Freela). Pelo `docs/deploy.md`, a cópia do banco é feita na subida da API; não achei cópia diária nem fora do servidor.
   - Mitigação, antes do 1º cupom de produção: cópia diária para fora da EC2 (decisão do dono) e a exportação mensal ao contador.
4. **Emissor na nuvem.**
   - O risco: loja sem internet ou servidor fora = sem cupom.
   - Hoje não pesa. Na fase 2 é a decisão principal (§1).
5. **Fatos não confirmados (§9.4).**
   - O risco: errar um deles dá rejeição já no 1º envio.
   - Mitigação: a regra "erro nosso para na 1ª vez" impede a repetição, e cada fato tem um passo no teste.
6. **Assinatura (entrega 3).**
   - O risco: canonicalização errada gera 297/298 em toda nota.
   - Mitigação: oráculo nos testes e parada na 1ª.
7. **Prazo do cancelamento depende do relógio.**
   - Mitigação: 1 min de folga e a conferência do relógio a cada resposta (§4.4, regra 8).
8. **Cadastro fiscal errado (NCM, CSOSN).**
   - Mitigação: validação local, perfis, teto de recusas e a grade conferida pelo contador antes de produção.
9. **Buracos na numeração sem inutilização** (presunção da cl. 11ª §5).
   - Mitigação: reaproveitamento com prova e a lista para o contador.
10. **IBS/CBS em 2027 com cronograma incerto.**
    - Mitigação: campos guardados agora e uma fatia própria antes de 01/01/2027.

### 9.2 Perguntas que só o dono ou o contador respondem (a mais importante primeiro)

1. **Dono:** uma venda emitida no Comanda também fica registrada no outro sistema (pedido, mesa, cozinha)?
   - Decide `cupom_lanca_venda`.
   - Enquanto não houver resposta, a produção não liga, e homologação nunca lança venda.
2. **Dono, com o fornecedor do caixa:** qual sistema emite NFC-e hoje, em qual série, se usa contingência off-line e com qual IdCSC.
   - Vamos usar o mesmo CSC ou o 2º? Nunca gerar um 3º.
3. **Contador:**
   - regime (CRT) e IE;
   - os perfis: CFOP, CSOSN ou CST, PIS/COFINS;
   - por produto: NCM, CEST e GTIN;
   - para 2027: `cAtivSN` e alíquotas efetivas do IBS/CBS;
   - se o cupom deve trazer o valor aproximado dos tributos (Lei 12.741).
4. **Contador:** sem inutilização em SP, basta registrar os números não usados e mandar a lista com os XML do mês? Em que formato ele quer os XML?
5. **Dono e contador:** a taxa de serviço (10%) entra no cupom? Como o caixa de hoje faz (CFOP 5.949 com CSOSN 900?)
   - É fase 2, mas muda o total do cupom.
6. **Dono:** quem é o responsável técnico do `infRespTec` (CNPJ, contato, e-mail, telefone)?
7. **Dono, para a fase 2:**
   - o operador de caixa pode ver o preço de venda? Isso muda a regra "a loja nunca vê preço";
   - o que fazer quando a internet da loja cair?

### 9.3 Roteiro do 1º teste em homologação

**Como o teste roda:**

- Com o dono presente, o certificado verdadeiro, no servidor.
- Cada passo só com o "eu autorizo" dele.
- Cada passo é uma chamada; nada se repete sem entender o código que voltou.

**Passos:**

0. **Antes de falar com a SEFAZ:**
   - certificado "válido" e do mesmo CNPJ;
   - CSC e IdCSC **de homologação** gerados no portal da SEFAZ-SP, em "Gerenciar Cód. Segurança" (B.1);
   - cadastro completo, com 2 produtos: um prato com o perfil do contador e uma bebida com ST;
   - `pg_dump` do banco;
   - `NFCE_AMBIENTE=homologacao` e recriar só a API.
1. **"Testar conexão"** (status do serviço). Esperado: serviço em operação (código não tabulado na pesquisa). Este passo fecha:
   - o emissor do certificado TLS de `homologacao.nfce.fazenda.sp.gov.br` (registrar);
   - se o SOAP 1.2 é aceito (Fault `VersionMismatch` = plano B, SOAP 1.1);
   - a action e o namespace;
   - o certificado aceito (nenhum 280–286).
2. **Cupom 1:** prato, dinheiro com troco, sem CPF. Esperado: autorizado.
   - Este passo fecha:
     - 781 (credenciamento em homologação) e 373;
     - QR e `urlChave` (394, 395 e o código do hash);
     - `nProt` de 17 dígitos guardado como texto;
     - o código do lote síncrono.
   - Imprimir em 80 mm e ler o QR no celular: tem de abrir a consulta de homologação.
3. **Cupom 2:** bebida com ST (CSOSN 500 / CFOP 5.405), com CPF, pago em débito + PIX (`card` com `tpIntegra=2`).
   - Fecha o grupo do CSOSN 500, o `card` e o `tPag` 17.
4. **Cancelar o cupom 1** dentro dos 30 min. Esperado: lote 128 + 135.
   - Fecha o `cOrgao` 35 e o leiaute do evento.
5. **Uma rejeição só, de propósito** (longe do limite de 30): um produto de teste com NCM de formato válido mas inexistente.
   - Esperado: `rejeitado`.
   - Depois, "Consultar" esse cupom (consulta opcional em `rejeitado`, §5.1). Esperado: "não consta", o que confirma o código.
   - "Descartar"; o cupom seguinte tem de reaproveitar o número.
6. **Consultar o cupom 2.** Esperado: autorizado, com o protocolo casado pelo `digVal`.
7. **Exportar o XML do mês** (homologação) e abrir os arquivos.

**Produção** (outro dia, outro "eu autorizo"):

- CSC de produção, série combinada e `cupom_lanca_venda` respondido; ligar a emissão.
- Um cupom real, de valor baixo, de uma venda que **não** passou no outro sistema.
- Conferir na consulta pública e, com CPF, na Nota Fiscal Paulista.
- Vigiar por 24 h: nenhum 656, e o caixa de hoje emitindo normalmente.
- O contador recebe o XML.

### 9.4 Não confirmado (cada item vira passo do teste ou pergunta)

- **Códigos de retorno:**
  - lote síncrono (esperado 104), 100, os códigos de denegação, 204 e 539 (inferência);
  - "não consta" (esperado 217) e o código do hash do QR que não confere;
  - o código do cancelamento fora de prazo.
- **Leiaute:**
  - `cOrgao` 35 no cancelamento;
  - se SP exige `card` e `infRespTec`;
  - `tPag` do PIX (17 × 20) e se o 99 ainda é rejeitado;
  - campos de ST retido no CSOSN 500 e o grupo do esquema para cada CSOSN/CST.
- **Transporte:** action e namespace dos WSDL de SP; TLS dos hosts de SP; SOAP 1.2 em SP.
- **QR:** se SP aceita o v3; qual URL de QR a 395 espera.
- **Normas e prazos:**
  - limite de SP para consumidor não identificado;
  - NT 2026.005 em produção em 16/11 ou em 14/12/2026;
  - a presunção da cl. 11ª §5 (pergunta para o contador).

## 10. Testes

**Regras:**

- **Nenhum teste chama a SEFAZ**, nem em homologação, nem faz rede.
  - A porta `SEFAZ_NFCE` é falsa nos testes de aplicação.
  - O adaptador é testado com respostas fictícias, escritas à mão a partir dos esquemas, em `__tests__/fixtures/nfce/`.
  - O transporte já tem o HTTPS local do próprio teste.
- **Certificados só fictícios**, dos de `__tests__/fixtures` (`api/scripts/gerar-certificados-teste.sh`); CSC também fictício.
- **Execução:** jest por `scripts/run-capped.sh 1500` com `npx jest --runInBand <arquivos>`; smoke com 1300; browser-check com 3300; um por vez.

**jest:**

- **`common/fiscal`:** `montarChave` (DV, CNPJ com letras), CPF, GTIN.
- **Totais:**
  - arredondamento metade para cima;
  - rateio com soma exata;
  - troco e limites;
  - a mesma tabela de casos roda no web (vitest) contra `web/src/lib/cupom.ts`.
- **Montagem:**
  - XML igual a um arquivo-modelo, nas variações: homologação e produção, Simples e Normal, com e sem CPF, com desconto;
  - ordem `infNFe` / `infNFeSupl` / `Signature`;
  - números sempre como texto;
  - texto 373 só em homologação;
  - `xmllint` opcional contra o 010h.
- **Assinatura sobre a `NFe`:** verificada pelo oráculo da entrega 3; o `infNFeSupl` inserido depois não a quebra.
- **QR v2:**
  - vetor do Manual DANFE v6.0 (§4.3, exemplo das p. 26–27);
  - IdCSC sem zeros à esquerda;
  - casa com o padrão do esquema.
- **`retornos.ts`:** cada linha da §5.3, inclusive 120 (alerta), 539 (número bloqueado), 656 (65 min; o 2º em 24 h), 704 e `enviado` falso × verdadeiro.
- **Situações:**
  - transições permitidas e proibidas;
  - reenvio mantém número e `cNF`;
  - limite de 3 envios;
  - descartar só com número livre;
  - cancelamento sem resposta ou 573 → `cancelando`, e a consulta leva a `cancelado` ou de volta a `autorizado`;
  - falha da T3 (venda) não muda a situação `autorizado` e deixa o marcador de venda pendente.
- **Travas do 656, com relógio injetado:**
  - 10 recusas por hora;
  - consulta só depois de 2 min;
  - status uma vez a cada 5 min;
  - durante o bloqueio, a porta falsa não é chamada;
  - relógio com diferença de mais de 2 min para a emissão.
- **Cancelamento:** limite de 29 min com relógio injetado; motivo de 15 a 255.
- **Idempotência:** a mesma chave não chama a porta de novo.
- **Segredos:** nenhuma resposta, erro ou log traz o CSC, o XML ou o CPF (o teste procura o CSC fictício em tudo o que sai).
- **Proibições no código:** nenhum `NFeInutilizacao4` em `api/src`; nenhum `rejectUnauthorized: false` (o teste já existe).
- **Permissões:** no `permissoes-protecao.spec.ts`, as rotas novas são só de admin e a lista da loja fica igual.

**Smoke** (banco descartável, `NFCE_AMBIENTE=homologacao`, sem certificado, atrás de `smoke-sem-rede.cjs`):

- cadastros e validações;
- emitir dá `CERTIFICADO_NAO_CADASTRADO` antes de qualquer rede;
- com cupons semeados por SQL:
  - duas T1 ao mesmo tempo pegam números diferentes;
  - o número descartado é reaproveitado;
  - o índice único parcial funciona;
  - o gatilho de imutável recusa UPDATE e DELETE;
- `nfce_lancar_venda`: vendas somadas por item, baixa feita pelo gatilho, idempotente; dois itens com a mesma `descricao_cupom` no mesmo cupom não colidem;
- `nfce_desfazer_venda`: apaga as vendas do cupom;
- em homologação, a função de lançar recusa;
- "Substituir" e `mapear` não tocam as vendas do cupom; `recalcular_baixas` as mantém;
- DANFE e XML de um cupom autorizado semeado;
- loja recebe 403 em todas as rotas novas.

**Navegador** (`web/scripts/browser-check.sh`, com a variável vazia):

- Emitir, Emitidos e Produtos em 390 px e no desktop;
- prévia de impressão do DANFE em 80 mm (captura).

## Fora do escopo

- **Inutilização:** SP não tem mais.
- **EPEC:** só quando a própria SEFAZ ativa (B.2).
- **NF-e 55 no lugar da NFC-e** para quem aproveita crédito de ICMS: raro em restaurante (B.1).
- **Devolução e troca.**
- **Outros CNPJs ou lojas.**
- **Tudo da §2.2.**

## Fontes

- **Pesquisa:** `docs/superpowers/specs/2026-11-17-pesquisa-ciencia-e-nfce.md`, Parte B, com os links das normas, manuais e páginas da SEFAZ-SP.
- **Esquemas abertos em 17/11/2026:** pacote 010h v1.03 (`NFe/leiauteNFe_v4.00.xsd`) e 010d v1.03 (`NFe/leiauteConsSitNFe_v4.00.xsd`), baixados pela pesquisa (links lá).
- **Desenho anterior:** `docs/superpowers/specs/2026-11-16-notas-sefaz-design.md`, para transporte, variáveis e riscos.
- **Código lido:**
  - `api/prisma/schema.prisma`;
  - as migrações `regras` (`vendas_baixa`, `recalcular_baixas`, `v_cmv_periodo`) e `notas_sefaz`;
  - `modules/importacoes`, `modules/cardapio`, `modules/vendas`, `modules/caixa` e `modules/cadastros`;
  - `modules/sefaz` e `modules/certificado-digital/certificado-digital.port.ts`;
  - `common/fiscal/chave-acesso.ts`, `common/cripto/cripto.ts` e `common/config/env.validation.ts`;
  - `scripts/import-lovable/esquema.ts`;
  - no web: `(app)/layout.tsx`, a Ficha e as Vendas.
