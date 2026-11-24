# Importar vendas de outros sistemas, controle da cana e roteiro ponta a ponta — desenho

Data: 24/11/2026 · Ramo `feat/vendas-cana` (a partir de `origin/main` b1996b8) · **Nada implementado.** Nenhum teste, build ou smoke rodou
neste desenho (máquina fraca): tudo o que está como *conferido* foi lido no código.

Pedido do Diego (card de 23/11, texto original):

> "Validar o sistema de entrada de NF com o certificado digital e testar todos modulos se estao funcionando, se estao conversando entre eles,
> coloca na parte de vendas, uma parte para importar vendas via XLM, CSV, PDF, para importar de outros sistemas
> Vamos criar uma aba com sistema de controle da cana
> REcebimento em duzias
> entrada de produção, em litros
> ai puxa as vendas e convere ele litros, considerando o rendimento do frozen
> contagem de estoque final apra apurar o rendimento da semana."

A parte do certificado está sendo tratada à parte. Este desenho cobre: **(A)** importar vendas de outros sistemas, **(B)** a aba de controle da
cana e **(C)** um roteiro de teste ponta a ponta dos módulos conversando entre si. A e B vão ao ar em momentos diferentes. B depende da
pergunta 1 (em que loja roda a cana) e das respostas sobre os números da cana.

Marcas usadas no texto:

- *conferido*: li no código ou nos desenhos do repositório em 24/11/2026;
- *minha*: decisão do construtor (dá para voltar atrás);
- *não confirmado*: sem prova; vira passo de teste com arquivo real ou pergunta ao Diego.

---

## Resumo para o Diego

**Importar vendas (em Vendas → "Importar vendas"):**

- Aceita **planilha** (CSV ou Excel de qualquer sistema), **XML** de cupom/nota fiscal (vários arquivos ou o .zip do mês) e **PDF** de relatório
  (lido pela IA que já lê as notas).
- Na planilha, o Comanda sugere qual coluna é o quê ("Descrição" = produto, "Qtde" = quantidade…). Você confere uma vez e ele lembra para aquele sistema.
- Antes de gravar, sempre aparece uma **prévia**: quantas vendas, o total em R$, o período, os produtos que ainda não estão ligados a um item do
  cardápio e o que já existia. **Nada é gravado sem você confirmar.**
- **Não conta em dobro:** o mesmo cupom (XML) nunca entra duas vezes; cupom cancelado não entra (e sai, se tinha entrado); venda já importada é
  ignorada. Se o período já tem vendas vindas de **outro** lugar (outra planilha, XML ou o cupom do próprio Comanda), a prévia avisa e você confirma.
- "Substituir" passa a apagar só as vendas **do mesmo sistema** naquele período, nunca as de outro sistema nem as do cupom.

**Controle da cana (aba nova "Cana"):**

- Três lançamentos simples: **recebi cana** (em dúzias), **produzi caldo** (em litros) e **contagem** (dúzias de cana e litros de caldo que sobraram).
- O Comanda puxa as vendas dos produtos de caldo do período, converte cada uma em litros (pelos ml de cada produto e pelo rendimento do frozen,
  que você configura) e mostra a semana com cada conta escrita por extenso. Exemplo: "Cana moída = 4 DZ (contagem de 17/11) + 12 DZ recebidas − 6 DZ (contagem de 24/11)".
- A semana vai de uma contagem até a seguinte. Se a loja lançar, ela não vê o que "deveria" ter (contagem cega, como no inventário).
- **Nenhum número vem preenchido:** ml de cada produto, rendimento do frozen e litros esperados por dúzia ficam em branco até você informar.

**Teste dos módulos conversando:** a parte C lista o que hoje já é conferido automaticamente, o que não é (Ponto e Empresas não têm nenhuma
conferência automática) e quais números do sistema **não** se falam de propósito (o faturamento do DRE vem do caixa, não das vendas).

**Antes de começar a Cana preciso da resposta 1:** a cana é vendida em Valinhos, no mesmo caixa? O Comanda hoje é de **uma loja só**. O cadastro de
Empresas não separa vendas nem estoque. Se a cana for de outra loja, as vendas dela iriam misturar no faturamento, no estoque e no CMV de Valinhos.

---

## O que o código mostra hoje (conferido)

- **Importação de vendas** (`api/src/modules/importacoes/importacoes.service.ts#vendas`, regras puras em `regras.ts#vendasDasLinhas`):
  - a tela `/importar` lê CSV (só `;`, UTF-8) ou XLSX no navegador, com colunas FIXAS (`pedido;data;hora;produto_relatorio;item_cardapio;…`);
  - manda as linhas para `POST /v1/importacoes/vendas`, que roda tudo numa transação;
  - linhas repetidas de pedido + produto + data são somadas;
  - a venda já existente é ignorada **em silêncio**: `createMany({ skipDuplicates: true })` sobre a chave única `(pedido, produto_relatorio, data)`;
  - produto novo entra em `de_para_produtos`;
  - o gatilho `vendas_baixa` dá baixa no estoque pela ficha.
- **"Substituir"** apaga **todas** as vendas do período do arquivo, menos as do cupom (`nfce_cupom_id IS NULL`). Hoje há uma fonte só e isso
  funciona. Com duas fontes, a segunda importação apagaria a primeira.
- **`vendas` não guarda de onde veio a venda:** só `importacao_id`, que pode ser nulo. `importacoes` também não tem origem (`tipo`, `arquivo`,
  `linhas`, `erros`, `usuario_id`).
- **Precedente do cupom fiscal** (`2026-11-17-cupom-fiscal-design.md` §3.3–3.4):
  - a venda é uma **projeção** do cupom autorizado (`pedido = 'NFC-e <série>-<número>'`);
  - o cancelamento **apaga** a projeção, e o histórico imutável fica no cupom;
  - a dupla contagem entre a importação e o cupom não dá para casar sozinha: a tela só avisa (`GET /v1/cupom-fiscal/vendas-no-periodo`).
- **XML da NF-e** é lido no **navegador** (`web/src/lib/nfe.ts#parseNFeXML`, decisão 7 do port). Ele lê `infNFe`, `det/prod` e `ICMSTot`. **Não lê:**
  protocolo (`protNFe/cStat`), ambiente (`tpAmb`), modelo, `tpNF`, `finNFe`, `vDesc` por item, nem eventos.
- **XML no servidor:** existe em `api/src/modules/sefaz/xml-leitura.ts`, o único lugar que importa `@xmldom/xmldom` (proteção contra XXE e teto de
  tamanho). O cancelamento (evento 110111, `retEvento` com cStat 135/136/155) já é reconhecido em `notas-sefaz/classificacao.ts#evento`.
- **Zip e limites de envio:** nenhum dos dois pacotes lê .zip. A API só **escreve** zip (`cupom-fiscal/zip.ts`, à mão). O multipart global é
  `fileSize` 10 MB e `files` 4. O corpo JSON vai até 16 MB (`main.ts`).
- **IA:** só pela porta `LEITOR_PDF` (`modules/leitura-pdf`). As rotas de leitura **nunca gravam**. Sem chave de IA, a frase é "Leitura de PDF não configurada…".
- **Uma loja por instalação:** `empresas` (migração `20261124120000_empresas`) só liga `ponto_colaboradores.empresa_id`. A principal espelha
  razão social, CNPJ e endereço em `configuracoes`. `vendas`, `itens_estoque`, `movimentacoes` e `inventarios` não têm coluna de empresa.
- **Estoque e inventário:**
  - há **um** inventário em andamento por vez (`abrir_inventario`: "Já existe um inventário em andamento"), com **todos** os insumos ativos e contagem cega;
  - `movimentacoes.tipo` aceita só `inventario_inicial, entrada_compra, baixa_venda, perda, ajuste_inventario, ajuste_manual` (sem "produção");
  - `v_cmv_periodo` = estoque inicial + `entrada_compra` − estoque final, entre dois inventários fechados.
- **Produção (dados do enunciado):** 4.474 vendas de 16/07 a 21/10/2026. Nenhum produto ou insumo com "cana", "caldo" ou "frozen".
- **Guarda do importador do Lovable** (`api/src/scripts/import-lovable/esquema.ts` + `__tests__/esquema.spec.ts`):
  - o teste acha as tabelas pela expressão `CREATE TABLE "nome" (`, **com aspas**;
  - as migrações `ponto` e `empresas` criaram tabelas **sem aspas**, e `TABELAS_SO_NOSSAS` não as lista;
  - lendo o código (não rodei), `conferirEsquemaNosso` recusaria hoje um banco migrado ("tabela … que o importador não conhece") e o teste não percebe.
    Vira a Tarefa 0.

---

## Parte A — Importar vendas de outros sistemas

### A.1 O que muda para quem usa (só admin)

1. A tela **Vendas** ganha o botão **"Importar vendas"** → `/vendas/importar`.
2. **Passo 1:** escolher **de onde vêm as vendas**. É uma lista de "sistemas de origem" ("PDV Valinhos", "iFood", "Planilha padrão do Comanda"…)
   com "+ Novo sistema". Depois, o formato: **Planilha** (CSV/XLSX), **XML** (cupons/notas, vários arquivos ou .zip) ou **PDF** (relatório, lido por IA).
3. **Planilha:** a tela mostra cada campo do Comanda com a coluna sugerida do arquivo e 3 valores de exemplo. Quem importa confirma ou troca. Com
   "Lembrar para este sistema" ligado, da próxima vez o mapeamento já vem pronto.
4. **Prévia** (sempre; nada gravado ainda):
   - números: linhas lidas, vendas válidas, já existentes (ignoradas), com problema, total em R$ e período;
   - produtos sem item do cardápio, com escolha ali mesmo;
   - avisos: período com vendas de outra fonte; "Substituir" vai apagar N vendas; arquivo já importado antes;
   - para XML, também: cupons válidos, já importados, cancelados e ignorados (por motivo).
5. **Confirmar** grava tudo numa transação e mostra o resultado, com o link "Ver vendas do período".
6. A tela **Importar Dados** continua para insumos e fichas. O botão "Vendas" de lá vira um link para a tela nova. A rota antiga da API fica,
   com o comportamento ajustado (A.3, R3).
7. O painel **"De-para do relatório de vendas"** continua em Importar Dados (é onde se corrige o de-para depois; o `browser-check.mjs` confere esse
   título lá). A prévia nova só mostra os produtos **novos** do arquivo, com a escolha do item antes de gravar (*minha*).

### A.2 Abordagens

| Abordagem | Troca | Decisão |
|---|---|---|
| **Opção 1. Estender a tela de hoje:** o navegador lê tudo e manda linhas prontas para `POST /v1/importacoes/vendas` | Pouca mudança. Mas a prévia não sabe o que já existe no banco, o que "Substituir" vai apagar nem o que veio de outra fonte. XML repetido ou cancelado depois não tem onde ser lembrado. | Descartada |
| **Opção 2. Ler no navegador, conferir no servidor sem gravar, confirmar numa transação** | Segue a decisão 7 do port (XML e planilha lidos no navegador, como a Entrada de Notas) e a regra "a leitura nunca grava". A prévia é calculada pelo **servidor**, que compara com o banco. O mesmo corpo vai duas vezes (prévia e confirmar, ~1 MB para um mês de cupons). Estado guardado só onde o pedido obriga: o mapeamento por sistema e o registro dos documentos fiscais por chave. | **Recomendada** (*minha*) |
| **Opção 3. Enviar os arquivos ao servidor, gravar um "lote em prévia" e confirmar depois** | Um leitor só (no servidor, testado no jest) e prévia que sobrevive a fechar a aba. Mas quebra "a leitura nunca grava", pede 2 tabelas de lote e limpeza de prévias abandonadas, esbarra no multipart (4 arquivos) e pede um leitor de zip no servidor. | Descartada |

**Por que o XML de venda fica no navegador** (*minha*), apesar de o servidor já ter o `xml-leitura.ts`:

- é o mesmo caminho da Entrada de Notas, que já confia no XML lido pelo navegador do admin;
- um mês de cupons tem ~1.500 arquivos: no navegador não há limite de arquivos do multipart, e o que sobe é só o resumo de cada cupom;
- o servidor confere o que importa e não confia no resto: dígito da chave; chave × CNPJ, modelo, série e número; CNPJ da loja; ambiente; repetição.

**Não confirmado:** o .zip é lido no navegador com `DecompressionStream('deflate-raw')`, sem dependência nova. Se o navegador do Diego não
tiver isso, a saída é selecionar os .xml soltos (vários de uma vez).

### A.3 Regras de duplicidade e de período

| # | Regra | Onde |
|---|---|---|
| R1 | **Venda igual.** A chave `(pedido, produto_relatorio, data)` já existe → a linha é ignorada (como hoje). A prévia **mostra** quantas e de que fonte (hoje some calado). Se a existente é de **outra** fonte: "O pedido 1001 de 20/11 já existe vindo de PDV Valinhos. Se forem vendas diferentes, defina um prefixo de pedido para este sistema." | prévia + confirmar |
| R2 | **Mesmo documento fiscal (XML).** Chave já registrada em `vendas_documentos` → o documento todo é ignorado ("já importado em dd/mm"). Chave de um cupom emitido pelo **próprio Comanda** (`nfce_cupons.chave`) → ignorado ("cupom do próprio Comanda"). Mesma chave duas vezes no mesmo envio → conta uma. | navegador (mesmo envio) + servidor |
| R3 | **"Substituir"** (só planilha e PDF; XML é sempre "acrescentar"). Apaga só as vendas **da mesma origem** no período **[menor data, maior data]** das linhas válidas do arquivo. Nunca apaga: venda do cupom (`nfce_cupom_id`), venda de XML (`documento_id`) ou venda de outra origem. A prévia mostra "Vai apagar N vendas (R$ X) de <origem> entre dd/mm e dd/mm". | confirmar |
| R4 | **As vendas que já existem (as 4.474 de produção) são da "Planilha padrão"** = origem nula. Vale para venda com `importacao_id` nulo ou cuja importação não tem `origem_id`. A rota antiga `POST /v1/importacoes/vendas` é a planilha padrão: o "Substituir" dela passa a filtrar `nfce_cupom_id IS NULL AND documento_id IS NULL AND origem nula`. Para os dados de hoje, o efeito é o mesmo de antes. Sem backfill (*minha*). | serviço + `importacoes-cupom.spec.ts` |
| R5 | **Sobreposição entre fontes.** No período do arquivo já há vendas de outra fonte (outra origem, XML ou cupom do Comanda) → aviso âmbar com a contagem e o valor de cada fonte: "Se for o mesmo caixa, vai contar em dobro." **Não barra:** o confirmar exige `confirmar_sobreposicao: true`. Sem isso, 409 `IMPORTACAO_SOBREPOSICAO`. Segue o precedente da nota repetida (avisar e confirmar) e substitui o aviso do cupom de hoje. Não há como casar sozinho a planilha do caixa com o XML do mesmo caixa: o número do pedido do PDV não aparece no cupom (cupom §3.4). | prévia + confirmar |
| R6 | **Período.** É o das linhas válidas. Data no futuro (> `todaySp()`) = linha com problema. PDF sem data por linha → quem importa informa a data (A.6). | regra pura |
| R7 | **Mesmo arquivo.** O SHA-256 do arquivo (calculado no navegador) igual ao de uma importação confirmada → aviso "Este arquivo já foi importado em dd/mm por <nome>". Não barra: R1 e R2 já impedem o dobro. | prévia |
| R8 | **Confirmar duas vezes** (duplo clique, rede caindo): `chave_idempotencia` (uuid do navegador, gerado quando a prévia aparece) é única em `importacoes`. A 2ª vez dá 409 `IMPORTACAO_JA_CONFIRMADA`, com o `importacao_id` da 1ª, e a tela recarrega o resultado. | confirmar |

**Cancelamento e a regra "cancelar reverte, não apaga":** a venda importada de XML é uma **projeção** do documento, como a do cupom (§3.3).
Cancelado o documento, as linhas de `vendas` dele são apagadas (as baixas caem em cascata). O registro imutável fica em `vendas_documentos`:
nunca é apagado, ganha `situacao = 'cancelada'`, `cancelado_em` e a importação que trouxe o cancelamento. A importação original fica em
`importacoes`. Lançar um estorno em `vendas` contaria um pedido a mais e estragaria "Pedidos" e "Ticket médio".

### A.4 XML (NFC-e modelo 65 e NF-e modelo 55 emitidas pela loja em outro sistema)

**Entrada:** vários `.xml` de uma vez ou um `.zip` (o "XML do mês" que os PDVs geram para o contador).

**Teto do zip** (*minha*): até 5.000 arquivos, 1 MB por XML descompactado e 100 MB no total. Pasta e arquivo que não é `.xml` são pulados e contados. Zip64 ou com senha = "Não consigo abrir este .zip. Exporte os XML sem senha.".

**Leitor:** `web/src/lib/nfe-vendas.ts`, novo.

- **Reaproveita** de `web/src/lib/nfe.ts` as três buscas por nome local (`all`, `one`, `txt`, hoje funções internas de `parseNFeXML`). Elas passam a
  ser exportadas, sem mudar o comportamento. A chave usa `normalizarChave`/`chaveValida` de `web/src/lib/fiscal.ts`.
- **Não reaproveita** o `parseNFeXML`, que fica igual para a Entrada de Notas. Ele lê o emitente como **fornecedor** e não olha protocolo,
  ambiente, modelo, `tpNF`, `finNFe`, CFOP nem `vDesc`. Estender a função mexeria na tela de notas por causa das vendas.

| O XML é… | O que acontece |
|---|---|
| `nfeProc` **modelo 65** (NFC-e) com `protNFe/cStat` 100 ou 150, `tpAmb` 1, `tpNF` 1, `finNFe` 1, emitente = CNPJ da loja | **venda** (um documento). A NFC-e só existe para venda a consumidor final |
| `nfeProc` **modelo 55** (NF-e) com as mesmas condições | aparece na prévia num grupo à parte, **desmarcado**, com os CFOPs dos itens. NF-e de saída da loja pode ser remessa, transferência ou bonificação, que inflariam o faturamento e dariam baixa. Só entra se quem importa marcar (*minha*). Classificar sozinho pelo CFOP fica para quando houver arquivo real (*não confirmado*) |
| `procEventoNFe` com `tpEvento` 110111 e `retEvento/cStat` 135, 136 ou 155 | **cancelamento** da chave |
| `procEventoNFe` com `tpEvento` 110112 (cancelamento por substituição, NFC-e) | **cancelamento**, *não confirmado*: conferir com XML real antes de valer |
| `NFe` sem `protNFe` (contingência ainda não autorizada, rascunho) | ignorado: "sem autorização da SEFAZ" |
| `cStat` 110 ou 301–306 no protocolo (denegada) | ignorado ("denegada"), como em `notas-sefaz/classificacao.ts` |
| `cStat` 101/151 no próprio protocolo da nota | tratado como cancelamento, *não confirmado*: não sei se algum PDV exporta assim; conferir com XML real |
| `tpAmb` 2 | ignorado: "modo de teste (homologação)" |
| emitente ≠ CNPJ da loja | ignorado: "emitida por outro CNPJ (<CNPJ>). Se for uma compra, use Entrada de Notas." CNPJ cadastrado em **Empresas** (não principal) aparece com a caixa "incluir" **desmarcada** (pergunta 12) |
| `tpNF` 0 (entrada) ou `finNFe` 4 (devolução) | ignorado, com o motivo |
| inutilização, carta de correção, outro evento, outro tipo de XML, XML inválido | ignorado, com o motivo e o nome do arquivo. **Nada some calado:** tipo desconhecido aparece na prévia |

**De cada venda saem:**

- `chave` e `modelo`;
- `serie` e `numero`, que viram o pedido: `NFC-e <série>-<número>` (ou `NF-e …`) mais o prefixo da origem, se houver. É o mesmo formato do cupom do
  Comanda (série diferente, chave diferente);
- `dhEmi` → `data` e `hora` em Brasília;
- por item: `xProd` → `produto_relatorio` (espaços colapsados), `qCom`, `vUnCom`, `vProd`, `vDesc`, `vOutro`, `vFrete`.

**Valores e agrupamento** (igual à projeção do cupom):

- `valor_total` = `vProd − vDesc`; `desconto` = `vDesc`; `taxa` = `vOutro`; `frete` = `vFrete`;
- itens repetidos do mesmo produto no mesmo cupom são somados (a mesma agregação de `vendasDasLinhas`).

**No servidor** (função pura `api/src/modules/importacoes/documentos.ts`):

- chave válida (`common/fiscal/chave-acesso#chaveValida`);
- `partesDaChave` igual a CNPJ, modelo, série e número informados;
- emitente ∈ {CNPJ de `configuracoes` (espelho da principal)} ∪ {CNPJs que quem importa marcou na prévia, só entre os de `empresas` ativas};
- `tp_amb` = 1;
- sem CNPJ da loja salvo → 400 `LOJA_SEM_CNPJ`: "Cadastre o CNPJ da empresa principal em Empresas antes de importar XML.".

**Cancelamento:** função SQL `vendas_documento_cancelar(_chave, _importacao, _quando)`, idempotente, no estilo de `nfce_desfazer_venda`.

| Situação da chave | O que a função faz |
|---|---|
| documento `autorizada` | apaga as `vendas` dele e marca `cancelada` |
| documento ainda não importado | grava o documento já `cancelada`, só com o que a chave diz, para o XML da venda que chegar depois ser ignorado |
| documento já `cancelada` | nada |
| venda e cancelamento no mesmo envio | a venda nem entra |

### A.5 Planilha / CSV de qualquer sistema

- **Leitura no navegador** (`web/src/lib/parse.ts`, que já existe, com acréscimos):
  - separador detectado pelo cabeçalho (`;`, `,` ou tabulação);
  - se o texto UTF-8 vier com `�`, ler de novo como `windows-1252` (comum em PDV brasileiro);
  - XLSX como hoje (cabeçalho em minúsculas).
- **Sugestão de mapeamento** (`web/src/lib/importar-vendas.ts#sugerirMapeamento`, pura, só na tela): sinônimos sem acento e sem caixa.

  | Campo | Sinônimos |
  |---|---|
  | pedido | pedido, nº pedido, numero, comanda, venda, cupom, documento |
  | data | data, dt, data venda, emissão, data/hora |
  | hora | hora, horário |
  | produto | produto, descrição, item, nome |
  | quantidade | qtd, qtde, quantidade, quant |
  | valor total | total, valor total, vl total, valor |
  | preço unitário | unitário, preço, vl unit |
  | desconto | desconto, desc |
  | taxa | taxa, serviço, taxa de serviço |
  | frete | frete, entrega, taxa de entrega |

- **Obrigatórios:** data, produto, quantidade e valor total. **Pedido** pode faltar: aí cada dia vira um pedido `<prefixo>DIA <aaaa-mm-dd>`, com o
  aviso "Sem número de pedido: 'Pedidos' e 'Ticket médio' contam 1 por dia". A mesma regra vale para o PDF (A.6).
  **Limite:** um 2º arquivo do mesmo sistema e do mesmo dia (ex.: almoço e jantar em relatórios separados) colide em `DIA <data>` + produto e
  aparece como "já existente". A prévia explica: "importe um relatório do dia inteiro, ou use Substituir para trocar o dia" (risco 10).
- **Aplicação no servidor** (`api/src/modules/importacoes/planilha.ts#aplicarMapeamento`, pura). O navegador manda as linhas cruas + o mapeamento;
  o servidor converte e a prévia mostra a conversão do servidor:
  - datas `dd/mm/aaaa`, `aaaa-mm-dd` e `dd/mm/aaaa hh:mm[:ss]` (a hora vai para `hora`);
  - números `1.234,56`, `1234,56` e `1234.56`: a escolha "vírgula ou ponto" fica salva na origem;
  - quantidade ≤ 0, data inválida ou produto vazio = linha com problema (fica de fora, como hoje).
- **Mapeamento lembrado:** `vendas_origens.mapeamento` (jsonb), gravado no **confirmar** quando "Lembrar" está ligado. Se uma coluna salva sumiu do
  arquivo novo, a tela marca "a coluna 'Qtde' não está neste arquivo" e pede escolha.
- A "Planilha padrão do Comanda" é uma origem embutida (origem nula, mapeamento fixo = as colunas de hoje).

### A.6 PDF de relatório de outro sistema (IA)

- **Rota** `POST /v1/importacoes/vendas/ler-pdf` (multipart, 1 PDF ≤ 10 MB): `LeituraPdfService.lerRelatorioVendas`, pela porta `LEITOR_PDF`.
  **Não grava nada.** As frases de erro são as de hoje (`MSG`): sem chave, sem crédito, ilegível…
- **Esquema estrito** (`SCHEMA_RELATORIO_VENDAS` em `leitura-pdf/schemas.ts`):
  - `sistema`, `periodo_ini`, `periodo_fim`, `total_relatorio` (todos podem ser nulos);
  - `linhas[]` com `{ pedido|null, data|null, hora|null, produto, quantidade, valor_total, desconto|null }`.
- **Instruções:** uma linha por produto (por pedido, se houver); não inventar pedido nem data (null); pular subtotal, total geral e itens
  cancelados; números com ponto.
- **Limpeza no servidor** (pura):
  - data impossível vira null;
  - quantidade ou valor que não é número = linha com problema;
  - produto vazio = linha descartada.
- **Conferência na tela** (é a regra das notas por IA: nada gravado sem conferir):
  - tabela **editável** (produto, quantidade, valor e data; excluir linha);
  - no topo, "Soma das linhas R$ X × total impresso no relatório R$ Y", em vermelho se a diferença passar de R$ 0,05.
- **Relatório sem data por linha:** quem importa escolhe "Data das vendas" (um dia). Se o relatório cobre mais de um dia, o aviso diz: "As vendas
  entram todas em dd/mm. Para ver por dia (e na semana da cana), importe um relatório por dia." (pergunta 11)
- **Depois da conferência**, as linhas seguem o mesmo caminho da planilha: prévia e confirmar, com `formato: 'pdf'`.
- **Risco:** relatório longo (centenas de linhas) pode passar do tamanho de resposta da IA. A resposta cortada vira `PDF_ILEGIVEL`, com a dica
  "Exporte por dia ou em planilha". Preferência: XML > planilha > PDF.

### A.7 Modelo de dados — migração `vendas_importacao` (só aditiva)

Escrita no **estilo do Prisma**, com aspas em `CREATE TABLE "…"` e `ALTER TABLE "…" ADD CONSTRAINT … FOREIGN KEY`, para a guarda do importador do
Lovable enxergar as tabelas.

```sql
CREATE TABLE "vendas_origens" (            -- sistema de origem; nunca apagado (ativo = false)
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "nome" TEXT NOT NULL,                    -- a API compara sem caixa e sem acento (normalizaNome) antes de gravar; o banco garante lower()
  "formato_padrao" TEXT NOT NULL CHECK ("formato_padrao" IN ('planilha','xml','pdf')),
  "mapeamento" JSONB,                      -- { pedido: "Nº Venda", data: "Data", produto: "Descrição", quantidade: "Qtde", valor_total: "Total", ... }
  "separador_decimal" TEXT NOT NULL DEFAULT 'virgula' CHECK ("separador_decimal" IN ('virgula','ponto')),
  "prefixo_pedido" TEXT NOT NULL DEFAULT '' CHECK (length("prefixo_pedido") <= 10),
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "criado_por" UUID, "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "atualizado_por" UUID, "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX "vendas_origens_nome_key" ON "vendas_origens" (lower("nome"));

CREATE TABLE "vendas_documentos" (         -- registro imutável dos cupons/notas de venda importados por XML
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "chave" VARCHAR(44) NOT NULL UNIQUE,
  "modelo" SMALLINT NOT NULL CHECK ("modelo" IN (55, 65)),
  "serie" INTEGER NOT NULL, "numero" BIGINT NOT NULL,
  "emitente_cnpj" VARCHAR(14) NOT NULL,
  "dh_emi" TIMESTAMPTZ(6),                 -- nulo quando só o cancelamento chegou
  "valor_total" DECIMAL(15,2),
  "situacao" TEXT NOT NULL CHECK ("situacao" IN ('autorizada','cancelada')),
  "importacao_id" UUID,                    -- quem trouxe a venda
  "cancelado_em" TIMESTAMPTZ(6),
  "cancelamento_importacao_id" UUID,       -- quem trouxe o cancelamento
  "criado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CHECK (("situacao" = 'cancelada') = ("cancelado_em" IS NOT NULL))
);
-- gatilho vendas_documentos_imutavel: DELETE proibido; UPDATE só autorizada → cancelada (e as colunas do cancelamento).

ALTER TABLE "vendas" ADD COLUMN "documento_id" UUID;            -- FK vendas_documentos ON DELETE RESTRICT + índice
ALTER TABLE "importacoes" ADD COLUMN "origem_id" UUID;          -- FK vendas_origens ON DELETE RESTRICT; nulo = planilha padrão
ALTER TABLE "importacoes" ADD COLUMN "formato" TEXT;            -- 'planilha' | 'xml' | 'pdf'; nulo nas antigas
ALTER TABLE "importacoes" ADD COLUMN "arquivo_sha256" CHAR(64);
ALTER TABLE "importacoes" ADD COLUMN "chave_idempotencia" UUID; -- UNIQUE (R8)
CREATE INDEX ... ON "vendas" ("importacao_id");                 -- o Substituir por origem filtra por aqui
CREATE INDEX ... ON "importacoes" ("origem_id");

CREATE FUNCTION vendas_documento_cancelar(_chave text, _importacao uuid, _quando timestamptz) RETURNS int ...  -- A.4
```

- **Sem XML guardado** (*minha*). O Comanda não é o emissor desses documentos: quem guarda é o sistema de origem e o contador. Fica a chave e os totais.
- **Dinheiro:**
  - no banco, `numeric`, como `vendas`;
  - no fio, as linhas vão com quantidade e valores como **texto decimal com ponto** (`"12.90"`), que o servidor converte para `Decimal`;
  - os totais da prévia vão em **centavos inteiros** (`*_centavos`), como `vendas-no-periodo`.
- **Importador do Lovable** (`esquema.ts`):
  - `vendas_origens` e `vendas_documentos` entram em `TABELAS_SO_NOSSAS`;
  - `vendas: ['nfce_cupom_id', 'documento_id']` e `importacoes: ['origem_id', 'formato', 'arquivo_sha256', 'chave_idempotencia']` em `COLUNAS_SO_NOSSAS`;
  - o gatilho novo entra em `GATILHOS`;
  - a contagem de FKs do `esquema.spec.ts` sobe de 32.
- **`DATE_ONLY_KEYS`:** nenhuma coluna `date` nova.

### A.8 Rotas (todas `@AdminOnly()`; a lista da loja não muda) — `docs/api-contract.md` §20

| Rota | O que faz |
|---|---|
| `GET /v1/importacoes/origens` | lista os sistemas de origem (ativos primeiro) |
| `POST /v1/importacoes/origens` | cria `{ nome, formato_padrao, separador_decimal?, prefixo_pedido? }` → 201; nome repetido → 409 `ORIGEM_REPETIDA` |
| `PUT /v1/importacoes/origens/:id` | edita nome, prefixo, separador, mapeamento, `ativo` (sem excluir) |
| `POST /v1/importacoes/vendas/ler-pdf` | lê o relatório pela IA (A.6); não grava |
| `POST /v1/importacoes/vendas/previa` | calcula a prévia (A.1 passo 4); **não grava** |
| `POST /v1/importacoes/vendas/confirmar` | mesmo corpo + `chave_idempotencia` + `confirmar_sobreposicao?` + `de_para_novos?` → uma transação |
| `POST /v1/importacoes/vendas` (já existe) | continua (smoke, compatibilidade); vira "planilha padrão"; "Substituir" com o filtro de R4. Marcado *obsoleto* no contrato |

**Corpo da prévia e do confirmar** (DTO com `whitelist` + `forbidNonWhitelisted`; tetos: 100.000 linhas cruas, 5.000 documentos, 990 itens por documento):

```ts
{
  formato: 'planilha' | 'xml' | 'pdf',
  origem_id: uuid | null,               // null = planilha padrão (só formato planilha)
  arquivo: string, arquivo_sha256?: string,
  modo: 'acrescentar' | 'substituir',   // xml: só 'acrescentar' (400 se vier 'substituir')
  // planilha
  linhas_brutas?: Record<string, string>[], mapeamento?: Mapeamento, salvar_mapeamento?: boolean,
  // pdf (já conferido na tela)
  linhas?: LinhaVendaDto[],             // { pedido|null, data|null, hora|null, produto_relatorio, quantidade, valor_total, desconto? }
  data_padrao?: 'AAAA-MM-DD',
  // xml (lido no navegador)
  documentos?: DocumentoDto[],          // { chave, modelo, serie, numero, emitente_cnpj, tp_amb, dh_emi, valor_total, itens: [...] }
  cancelamentos?: { chave, dh_evento }[],
  ignorados?: { arquivo, motivo }[],    // só para a contagem no histórico
  cnpjs_incluidos?: string[],           // CNPJs de Empresas marcados na prévia
  // só no confirmar
  chave_idempotencia?: uuid, confirmar_sobreposicao?: boolean,
  de_para_novos?: { produto_relatorio, item_cardapio_id | null }[]
}
```

**Resposta da prévia:**

```ts
{
  periodo, linhas: { lidas, validas, com_problema, ja_existentes, somadas_no_arquivo },
  valor_centavos, pedidos, itens, problemas: [{ linha, motivo }] /* até 200 */,
  amostra /* 20 linhas já convertidas */,
  documentos?: { vendas, ja_importados, do_proprio_comanda, cancelados, cancelamentos_de_importados: { vendas, valor_centavos },
                 ignorados: { [motivo]: n }, outros_cnpjs: [{ cnpj, nome_em_empresas | null, documentos }] },
  produtos_sem_de_para: [{ produto_relatorio, linhas, valor_centavos, sugestao_item_cardapio_id | null }],
  ja_existentes_de_outra_fonte: [{ fonte, linhas }],
  sobreposicao: [{ fonte, vendas, valor_centavos }],
  substituir?: { vendas, valor_centavos, ini, fim },
  arquivo_ja_importado?: { em, por, vendas }
}
```

**Resposta do confirmar:** `{ importacao_id, inseridas, ignoradas, apagadas, canceladas, documentos_novos, novos_produtos }`.

**Erros** (`{ error: { code, message } }`):

| HTTP | Código | Quando |
|---|---|---|
| 400 | `VALIDATION_ERROR` | corpo inválido |
| 400 | `MAPEAMENTO_INCOMPLETO` | "Escolha a coluna de: data, produto." |
| 400 | `IMPORTACAO_VAZIA` | "Nenhuma venda válida no arquivo." |
| 400 | `LOJA_SEM_CNPJ` | XML sem CNPJ da loja salvo (A.4) |
| 404 | `ORIGEM_NAO_ENCONTRADA` | origem inexistente |
| 409 | `IMPORTACAO_SOBREPOSICAO` | período com vendas de outra fonte, sem `confirmar_sobreposicao` |
| 409 | `IMPORTACAO_JA_CONFIRMADA` | 2º confirmar com a mesma chave; leva o `importacao_id` |
| 409 | `ORIGEM_REPETIDA` | nome de origem já usado |
| 422 | `PDF_ILEGIVEL` e os demais de `MSG` | leitura do PDF |

**Transação do confirmar** (`OPCOES_TX` de hoje: 300 s):

1. insere `importacoes` (`chave_idempotencia`; a unicidade serializa o duplo clique);
2. grava o mapeamento, se pedido;
3. `de_para_novos`, mais os produtos novos sem item;
4. XML: trava `vendas_documentos` das chaves do envio (`FOR UPDATE`), pula as já registradas e as de `nfce_cupons`, insere as novas, aplica os
   cancelamentos (`vendas_documento_cancelar`);
5. "Substituir" por origem (R3/R4);
6. insere `vendas` em lotes de 500 (o gatilho faz as baixas);
7. devolve as contagens.

**Log:** `importacao.vendas` com `importacao_id`, formato e contagens. Nunca leva conteúdo de linha.

### A.9 Tela `/vendas/importar` e estados

| Estado | O que aparece |
|---|---|
| Carregando | planilha: instantâneo; XML: "Lendo 1.234 de 1.500 arquivos…" com barra; PDF: "A IA está lendo o relatório (pode levar até 1 minuto)…" |
| Mapeamento (planilha) | campo → coluna sugerida + 3 exemplos; obrigatórios marcados; "vírgula ou ponto"; "Lembrar para <sistema>" |
| Conferência (PDF) | tabela editável + "Soma × total impresso" |
| Prévia | cartões (cada número com a conta, ex.: "Total R$ 12.345,60 = soma do valor das 2.301 vendas novas; 120 já existiam e não entram"); avisos âmbar (sobreposição, mesmo arquivo, outro CNPJ) e vermelho (Substituir); produtos sem item com seleção |
| Vazio | "Nenhuma venda válida no arquivo" + os 5 motivos mais comuns, com contagem |
| Erro | a frase do servidor (`errMsg`) |
| Sucesso | "Importadas 2.301 vendas (R$ 12.345,60) de 01/11 a 30/11 · 3 cupons cancelados retirados · 4 produtos novos sem ficha" + "Ver vendas do período" |

Outros pontos da tela:

- o botão de confirmar diz o que vai acontecer: "Importar 2.301 vendas" ou "Substituir 1.980 vendas e importar 2.301";
- com sobreposição, o botão só libera depois da caixa "São vendas diferentes (outro caixa ou canal); importar mesmo assim";
- a tela é responsiva (360 px): uma coluna e botão fixo embaixo.

### A.10 Testes da parte A (nenhum faz rede)

**jest (API):**

- `planilha.spec.ts`: datas, números pt-BR, pedido ausente, prefixo, problemas.
- `documentos.spec.ts`:
  - chave com DV errado;
  - chave × campos;
  - CNPJ fora da loja;
  - `tp_amb` 2;
  - CNPJ de Empresas só quando incluído.
- `previa.spec.ts` (pura, recebe os "fatos do banco" prontos): R1–R7, contagens e centavos.
- `importacoes-vendas.spec.ts` com Prisma falso:
  - ordem da transação;
  - Substituir por origem e legado (R3/R4);
  - idempotência (R8);
  - XML já importado, do próprio Comanda, cancelado antes e depois.
- `leitura-pdf.service.spec.ts`: o relatório com leitor falso, a limpeza, a resposta truncada.
- `permissoes-protecao.spec.ts`: as rotas novas entram como admin; `POST /v1/importacoes/vendas/ler-pdf` entra no teste de `/ler-`.
- `importacoes-cupom.spec.ts`: o `where` novo do Substituir.
- `esquema.spec.ts`: as listas novas.

**vitest (web):**

- `nfe-vendas.test.ts`, com fixtures de nfeProc 65 e 55, procEventoNFe 110111, homologação, outro CNPJ, sem protocolo e inutilização. Reaproveitar as
  fictícias de `api/src/modules/sefaz/__tests__/fixtures` (copiadas para `web/src/lib/__tests__/fixtures`).
- `zip-leitura.test.ts`: método 0 (armazenado), método 8 se o ambiente tiver `DecompressionStream`, e os tetos.
- `importar-vendas.test.ts`: sugestão de mapeamento.
- `parse.test.ts`: separador e `windows-1252`.

Smoke e navegador: ver C.3 e C.4.

---

## Parte B — Controle da cana

### B.1 O que muda para quem usa

**Aba nova "Cana"** no menu.

| Quem | O que vê |
|---|---|
| **Admin** | três abas: **Semana**, **Lançamentos**, **Configuração** |
| **Loja** (se o Diego aprovar, pergunta 5) | só **Lançar**, com três botões grandes ("Recebi cana", "Produzi caldo", "Contagem"), e **Meus lançamentos desta semana**, sem nenhuma conta |

O que cada lançamento pede:

- **Recebi cana:** data, dúzias, fornecedor (opcional), observação.
- **Produzi caldo:** data, litros de caldo e, se souber, quantas dúzias moeu.
- **Contagem:** data, dúzias de cana e litros de caldo que sobraram, e litros de frozen pronto (se houver; pergunta 7).

**Configuração:**

- litros esperados por dúzia;
- rendimento do frozen;
- os produtos do cardápio que levam caldo, cada um com **ml por unidade** e a marca **frozen**.

Tudo vem **em branco**. A tela sugere os produtos cujo nome tem "cana", "caldo", "garapa" ou "frozen", mas não preenche nada.

### B.2 Abordagens

| Abordagem | Troca | Decisão |
|---|---|---|
| **Opção 1. Reaproveitar o estoque:** "Cana (DZ)" e "Caldo (L)" viram insumos, recebimento por nota/lista, produção como movimentação nova, caldo baixado pela ficha, contagem no inventário | Um saldo só e custo no CMV. Mas: o inventário é **um por vez e com todos os insumos** (uma contagem semanal de cana obrigaria um inventário inteiro ou um "inventário parcial" novo); `movimentacoes_tipo_check` não tem produção e teria de mudar, junto com `v_saldo_teorico`, `v_cmv_periodo` e `recalcular_baixas` (risco no CMV do restaurante todo); `v_cmv_periodo` só conta `entrada_compra` como entrada, e o caldo produzido sairia com CMV errado; o rendimento do frozen ficaria escondido dentro das fichas. | Descartada |
| **Opção 2. Módulo próprio `cana`:** tabelas `cana_*`, só lê `vendas` e `itens_cardapio`, não toca em `movimentacoes`, inventário nem CMV | Risco zero no estoque e no CMV de hoje. Telas do jeito do pedido (dúzias e litros). Contagem semanal independente do inventário. Fatores à vista. Contra: a cana vive fora do estoque geral. Se ela também entrar por nota na Entrada de Notas, o custo vai para o estoque e as contas como hoje, e a dúzia é lançada de novo na aba Cana. | **Recomendada** (*minha*) |
| **Opção 3. Módulo próprio + ponte com a Entrada de Notas** (nota com o insumo "Cana" vira recebimento sozinha) | Evita lançar duas vezes, mas depende de unidade e fator da nota (FEIXE? UN?) e de a cana vir com nota | Depois, se a resposta 8 for "sim, vem com nota" |

**A conta da semana em TypeScript puro** (`api/src/modules/cana/apuracao.ts`, testada sem banco) é a **segunda exceção** à regra "regras em SQL",
depois do `ponto/calculo.ts`. Motivos:

- não há equivalente no Lovable para manter 1:1;
- a conta é só aritmética sobre números já somados;
- o teste roda sem banco na máquina fraca.

O SQL só soma (vendas por item no período, lançamentos ativos). A exceção entra no CLAUDE.md, junto da do ponto.

### B.3 As contas da semana, em linguagem simples

A **semana** vai de uma contagem até a próxima:

- lançamentos e vendas com `data > data da contagem anterior` **e** `data <= data da contagem atual` (a mesma borda de `v_cmv_periodo`);
- a primeira contagem é só o ponto de partida;
- a "semana em andamento" (da última contagem até hoje) mostra recebido, produzido e vendido, mas não perda (falta a contagem final).

| Número | Conta | De onde vem |
|---|---|---|
| Cana no início (DZ) | = dúzias da contagem anterior | contagem de dd/mm |
| Cana recebida (DZ) | = soma dos recebimentos do período | N recebimentos |
| Cana no fim (DZ) | = dúzias da contagem atual | contagem de dd/mm |
| **Cana moída (DZ)** | = início + recebida − fim | as três acima |
| Caldo produzido (L) | = soma das produções do período | N produções |
| **Litros por dúzia (real)** | = caldo produzido ÷ cana moída | — |
| Litros por dúzia (esperado) | configurado; vazio = "não informado" | Configuração |
| Diferença da moagem | = caldo produzido − cana moída × esperado (em L e em %) | — |
| **Caldo vendido (L)** | = soma, por produto, de quantidade × ml ÷ 1.000 (÷ rendimento do frozen, se o produto é frozen) | vendas do período (qualquer origem: planilha, XML, PDF, cupom), produto a produto |
| Caldo no início (L) | = litros de caldo da contagem anterior + litros de frozen ÷ rendimento do frozen | contagem de dd/mm |
| Caldo no fim (L) | idem, da contagem atual | contagem de dd/mm |
| **Perda (ou sobra) de caldo (L)** | = início + produzido − vendido − fim (positivo = sumiu; negativo = vendeu mais do que foi lançado como produzido) | as quatro acima |
| **Rendimento da semana** | = caldo vendido ÷ cana moída (litros vendidos por dúzia) | — |

**Exemplo com números INVENTADOS, só para mostrar a conta:**

| Dado | Valor |
|---|---|
| contagem de 17/11 | 4 DZ de cana e 3 L de caldo |
| recebido | 12 DZ (3 entregas) |
| produzido | 50 L |
| contagem de 24/11 | 6 DZ e 5 L |
| vendas | 100 copos de 300 ml = 30 L; 40 frozen de 400 ml = 16 L de frozen ÷ 1,25 = 12,8 L de caldo |

| Resultado | Conta |
|---|---|
| Cana moída | 4 + 12 − 6 = **10 DZ** |
| Litros por dúzia | 50 ÷ 10 = **5,0 L/DZ** (esperado: não informado) |
| Caldo vendido | 30 + 12,8 = **42,8 L** |
| Perda de caldo | 3 + 50 − 42,8 − 5 = **5,2 L** |
| Rendimento da semana | 42,8 ÷ 10 = **4,28 L vendidos por dúzia** |

**Avisos** (cada um com a frase e o link para corrigir):

- **vendas incompletas:** a última venda importada é de dd/mm, antes do fim da semana → "O caldo vendido está incompleto: as vendas só foram
  importadas até dd/mm." Sem esse aviso, uma importação atrasada pareceria perda;
- **produto de cana sem ml:** venda no período de item do cardápio cujo nome parece de cana e que não está configurado;
- **venda de cana sem item do cardápio:** `produto_relatorio` parece de cana e o de-para está pendente;
- falta o rendimento do frozen, havendo venda ou contagem de frozen (os litros de frozen não entram e o aviso diz isso);
- **cana moída negativa:** fim > início + recebido ("falta lançar recebimento ou a contagem está errada");
- produção zero com venda > 0 ("produção não lançada?").

**Precisão** (não é dinheiro):

- dúzias com 2 casas e litros com 3, no banco;
- a tela mostra 1 casa;
- as contas usam os valores do banco, sem arredondar no meio.

### B.4 Quem lança, contagem cega e datas

- **Loja lança e o admin apura** (recomendação; pergunta 5):
  - a loja alcança só `POST /v1/cana/lancamentos` e `GET /v1/cana/lancamentos/recentes` (`@Staff()`), e o GET devolve só o que ela mesma digitou;
  - a apuração, a configuração e as vendas são `@AdminOnly()`, como o teórico do inventário: quem conta não vê o que "deveria" ter;
  - a loja só lança com data de **hoje ou ontem** (*minha*); o admin lança qualquer data ≤ hoje.
- **Nada é apagado:**
  - corrigir = **anular com motivo** (admin, motivo com 3+ caracteres) e lançar de novo, com `substitui_id` (como o ponto);
  - um gatilho proíbe DELETE e qualquer UPDATE que não seja a anulação.
- **Uma contagem ativa por dia** (índice único parcial).
- **Hora da contagem** (pergunta 6): vale como **fim do dia**. A venda do próprio dia entra na semana que termina nela. Contagem feita de manhã,
  antes de abrir, deve ser lançada com a data de ontem; a tela da loja diz isso.

### B.5 Modelo de dados — migração `cana` (só aditiva, separada da de vendas, estilo Prisma com aspas)

```sql
CREATE TABLE "cana_parametros" (           -- linha única (id = 1); tudo nulo de fábrica
  "id" INTEGER PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "litros_por_duzia_esperado" DECIMAL(10,3) CHECK (> 0),
  "rendimento_frozen" DECIMAL(10,4) CHECK (> 0),   -- litros de frozen que 1 litro de caldo rende (pergunta 3)
  "atualizado_por" UUID, "atualizado_por_nome" TEXT, "atualizado_em" TIMESTAMPTZ(6)
);
INSERT INTO "cana_parametros" ("id") VALUES (1);

CREATE TABLE "cana_parametros_historico" (  -- cada PUT acrescenta uma linha (quem, quando, os dois valores)
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "litros_por_duzia_esperado" DECIMAL(10,3), "rendimento_frozen" DECIMAL(10,4),
  "alterado_por" UUID NOT NULL, "alterado_por_nome" TEXT NOT NULL, "alterado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE TABLE "cana_produtos" (              -- item do cardápio que leva caldo
  "item_cardapio_id" UUID PRIMARY KEY,      -- FK itens_cardapio ON DELETE CASCADE
  "ml_por_unidade" DECIMAL(10,2) NOT NULL CHECK ("ml_por_unidade" > 0),
  "frozen" BOOLEAN NOT NULL DEFAULT false,
  "ativo" BOOLEAN NOT NULL DEFAULT true,
  "atualizado_por" UUID, "atualizado_por_nome" TEXT, "atualizado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now()
);

CREATE TABLE "cana_lancamentos" (           -- livro só de acréscimo
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "tipo" TEXT NOT NULL CHECK ("tipo" IN ('recebimento','producao','contagem')),
  "data" DATE NOT NULL,
  "duzias" DECIMAL(10,2),                   -- recebimento (> 0), contagem (>= 0), produção (opcional: dúzias moídas)
  "litros_caldo" DECIMAL(10,3),             -- produção (> 0), contagem (>= 0)
  "litros_frozen" DECIMAL(10,3),            -- só contagem (opcional, >= 0)
  "fornecedor" TEXT, "observacao" TEXT,
  "substitui_id" UUID,                      -- FK cana_lancamentos (a anulada que este corrige)
  "lancado_por" UUID NOT NULL, "lancado_por_nome" TEXT NOT NULL, "lancado_em" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  "anulado_em" TIMESTAMPTZ(6), "anulado_por" UUID, "anulado_por_nome" TEXT, "anulado_motivo" TEXT,
  CHECK (por tipo: as colunas que valem e os sinais acima),
  CHECK (("anulado_em" IS NULL) = ("anulado_motivo" IS NULL))
);
CREATE UNIQUE INDEX "cana_uma_contagem_por_dia" ON "cana_lancamentos" ("data") WHERE "tipo" = 'contagem' AND "anulado_em" IS NULL;
CREATE INDEX ON "cana_lancamentos" ("data") WHERE "anulado_em" IS NULL;
-- gatilho cana_lancamentos_imutavel: sem DELETE; UPDATE só preenche anulado_* uma vez.
```

- **Mais tarde (Tarefa B6, opcional) — `cana_fechamentos`:**
  - colunas: contagem inicial e final, período, `resultado` jsonb (fatores e números da semana, fotografados), quem fechou e quando, reabertura com motivo;
  - "Fechar a semana" guarda a foto; mudar ml ou rendimento depois não muda a semana fechada;
  - anular um lançamento de semana fechada → 409 "Semana fechada: reabra antes".
  - Sem esta tarefa, a apuração é sempre calculada na hora, com os fatores atuais, e a tela diz isso: "calculado com a configuração de hoje".
- **Importador do Lovable:** as tabelas `cana_*` entram em `TABELAS_SO_NOSSAS` e o gatilho em `GATILHOS`.
- **`DATE_ONLY_KEYS`:** `data` já está; `periodo_ini` e `periodo_fim` entram com a B6.

### B.6 Rotas — `docs/api-contract.md` §21

| Rota | Marca | O que faz |
|---|---|---|
| `GET /v1/cana/parametros` · `PUT /v1/cana/parametros` | admin | `{ litros_por_duzia_esperado|null, rendimento_frozen|null }`; o PUT grava o histórico |
| `GET /v1/cana/produtos` | admin | itens do cardápio ativos com a configuração (ou nula) + `parece_cana` pelo nome |
| `PUT /v1/cana/produtos/:itemCardapioId` | admin | `{ ml_por_unidade, frozen, ativo }` (`ParseUuidPipe`) |
| `GET /v1/cana/lancamentos?ini=&fim=` | admin | todos, com os anulados marcados |
| `GET /v1/cana/lancamentos/recentes` | **staff** | últimos 7 dias, só tipo, data, quantidades, quem e quando; sem conta nenhuma |
| `POST /v1/cana/lancamentos` | **staff** | `{ tipo, data, duzias?, litros_caldo?, litros_frozen?, fornecedor?, observacao?, substitui_id? }`; loja: data hoje/ontem; `substitui_id` só admin |
| `POST /v1/cana/lancamentos/:id/anular` | admin | `{ motivo }`; já anulado → 409 `CANA_JA_ANULADO` |
| `GET /v1/cana/semanas` | admin | lista das semanas (pares de contagens) com os 4 números principais |
| `GET /v1/cana/semanas/atual` | admin | semana em andamento (sem perda) |
| `GET /v1/cana/semanas/:contagemFinalId` | admin | a apuração completa: cada número com os componentes (B.3), por produto, avisos e `vendas_importadas_ate` |

**Erros:**

| HTTP | Código | Quando |
|---|---|---|
| 400 | `VALIDATION_ERROR` | campos do tipo errado |
| 400 | `CANA_DATA_FORA` | "A loja lança só hoje ou ontem." / "Data no futuro." |
| 400 | `CANA_MOTIVO_OBRIGATORIO` | anular sem motivo |
| 409 | `CANA_CONTAGEM_DO_DIA` | "Já existe uma contagem em dd/mm. Anule a anterior para lançar outra." |
| 404 | `NOT_FOUND` | lançamento ou semana inexistente |

**Permissões e menu:** a lista exata da loja em `permissoes-protecao.spec.ts` ganha as 2 rotas `staff`, se a pergunta 5 for "loja lança". Se for
"só admin", as duas viram `@AdminOnly()` e a lista não muda. `MENU` ganha `{ to: '/cana', label: 'Cana', loja: <resposta 5> }`.

### B.7 Telas e estados (`web/src/app/(app)/cana`)

- **Semana** (admin):
  - escolha da semana ("17/11 → 24/11");
  - cartões em duas colunas no computador e uma no celular. Cada cartão traz o número grande e, embaixo, a conta com a origem: "= 4 DZ (contagem de
    17/11) + 12 DZ (3 recebimentos) − 6 DZ (contagem de 24/11)". Cada parcela é link para a lista de lançamentos filtrada;
  - tabela **Por produto**: produto, quantidade vendida, ml, frozen, litros;
  - avisos em faixa âmbar.
- **Lançamentos** (admin): formulário dos 3 tipos + lista com "Anular" (diálogo com motivo) e "Corrigir" (anular + novo já preenchido).
- **Configuração** (admin):
  - os dois parâmetros. Vazio = "não informado". Dica: "1 L de caldo vira quantos litros de frozen?";
  - lista de produtos com busca e o filtro "parecem de cana";
  - ml e frozen por linha;
  - um aviso antes de qualquer configuração: "Nada configurado: o caldo vendido aparece como 0".
- **Loja (celular, 360 px):** 3 botões grandes; formulário de uma tela com teclado numérico; confirmação "Lançado: 12 dúzias em 24/11"; lista do
  que ela lançou na semana.
- **Estados:**

  | Estado | Frase ou forma |
  |---|---|
  | carregando | esqueleto |
  | sem contagem | "Faça a primeira contagem: ela é o ponto de partida da primeira semana." |
  | uma contagem só | "A primeira semana fecha na próxima contagem." |
  | erro | `errMsg` |
  | sucesso | toast curto |

- **Formulários:** react-hook-form + zod (como o resto do web); estado de servidor no TanStack Query; chamadas só em `@/lib/erp-api.ts`.

### B.8 Testes da parte B (nenhum faz rede)

- **jest — `cana/__tests__/apuracao.spec.ts`:**
  - o exemplo de B.3, número a número;
  - parâmetros nulos (esperado, frozen);
  - cana moída negativa e cana moída zero (sem divisão por zero: `null` + aviso);
  - frozen sem rendimento;
  - produto sem ml;
  - vendas incompletas;
  - bordas do período (venda no dia da contagem anterior fica fora; no dia da atual, dentro).
- **jest — `cana/__tests__/cana.dto.spec.ts`:** campos por tipo.
- **jest — `permissoes-protecao.spec.ts`:** `it('a cana: a loja só lança e vê os próprios lançamentos')`.
- **jest — `esquema.spec.ts`:** as tabelas e o gatilho.
- **vitest:** os formatadores das contas (texto "= a + b − c"), se ficarem em `web/src/lib/cana.ts`. Os números vêm do servidor.
- **Smoke e navegador:** ver C.3 e C.4.

---

## Parte C — Roteiro de teste ponta a ponta (módulos conversando)

### C.1 O que conversa com o quê (conferido no código) e quem confere hoje

| Ligação | Como | Coberto hoje | Falta |
|---|---|---|---|
| Nota (XML/PDF/foto) → estoque | `lancar_nota`: `entrada_compra` = qtd × fator, custo = valor ÷ fator | smoke "entrada de nota" (fator 1) | fator > 1 (CX C/12): quantidade e custo |
| Nota → preço do insumo → custo da ficha | `atualizar_preco` muda `itens_estoque.preco_unitario`; `v_fichas_resumo` lê o preço | smoke confere o preço; não confere a ficha | custo da ficha antes × depois da nota |
| Nota → contas a pagar | parcelas; à vista nasce paga | smoke (2 parcelas, à vista paga) | — |
| Conta → DRE | liquidar com plano de contas → `GET /dre/pagos` | smoke (conta **manual**) | conta **da nota** liquidada como CMV aparecendo no DRE do mês do pagamento |
| Caixa → DRE (faturamento) | `montarDRE` soma as entradas do caixa (no navegador) | vitest `dre.test.ts`; smoke só grava e lê o caixa | — |
| Vendas → baixa de estoque | gatilho `vendas_baixa` pela ficha | smoke (baixa −0,3) | de-para tardio: mapear depois para um item **com** ficha cria a baixa (hoje o smoke só mapeia para "nenhum") |
| Baixa → saldo teórico → inventário cego → CMV | `v_saldo_teorico`, `registrar_contagem`, `fechar_inventario`, `v_cmv_periodo` | smoke (saldo = contado − vendido; CMV conta 9 linhas) | **valor** do CMV conferido à mão (entradas da nota no período × custo médio) |
| Inventário → lista de compras → recebimento → estoque | `gerar_lista_compras`, `receber_lista` | smoke | — |
| Notas da SEFAZ → "Dar entrada" → mesma `lancar_nota` | origem `sefaz` | smoke + `ciclo-sefaz-banco.ts` | — |
| Cupom do Comanda → venda → baixa; cancelamento desfaz | `nfce_lancar_venda`/`nfce_desfazer_venda` | `nfce-banco.ts` + smoke (Substituir mantém o cupom) | — |
| Empresas → `configuracoes` (espelho da principal) → SEFAZ e cupom leem o CNPJ dali | serviço de empresas | **nada** no smoke (só `normaliza-empresa.spec.ts`) | tudo (C.3) |
| Empresas → Ponto (empregador no espelho) | `ponto_colaboradores.empresa_id` | **nada** | C.3 |
| Ponto (terminal, PIN, batida, espelho, anulação) | `modules/ponto` | só `calculo.spec.ts` (e o vitest `ponto.test.ts`) | tudo no smoke (C.3) |
| Certificado → SEFAZ / cupom | porta `CERTIFICADO_DIGITAL` | jest + smoke (sem rede) | o teste real é a outra frente do card |
| Migrações → importador do Lovable | `esquema.ts` | `esquema.spec.ts` | não vê `CREATE TABLE` sem aspas; ponto e empresas fora das listas (Tarefa 0) |

### C.2 O que NÃO conversa (de propósito ou por herança) — dizer ao Diego

- **Faturamento.** "Faturamento" de **Vendas** = soma das vendas importadas. "Faturamento" do **DRE** = soma das entradas do **caixa**. São números
  diferentes; diferença normal: taxa de serviço, iFood, venda que não passou no relatório.
- **Três CMVs**, cada um com a sua conta:
  - **Vendas → "CMV teórico"** = custo da ficha de hoje × quantidade vendida;
  - **Inventário → CMV** = estoque inicial + compras − estoque final, entre dois inventários;
  - **DRE → CMV** = contas **pagas** no mês classificadas em subgrupo de CMV (regime de caixa).
- **Ponto não entra no DRE:** salário só entra como conta a pagar.
- **A Cana (B) não mexe no estoque nem no CMV:** só lê vendas.

Proposta (fora deste desenho; vira pergunta 13): uma linha "Conferência" no DRE com "Vendas importadas no mês: R$ X · Caixa: R$ Y · diferença R$ Z".

### C.3 Checagens a acrescentar ao `api/scripts/smoke.sh`

Contagem de hoje, feita por `grep` nos arquivos em 24/11 (o README ainda diz 165 e 68): ~490 `check "…"` no smoke e ~370 `check(` no browser-check.

**Cadeia de hoje (podem entrar já, sem esperar A ou B):**

- **E1.** Nota com item `CX C/12` (fator 12): `movimentacoes.quantidade` = qtd × 12 e `custo_unitario` = valor ÷ 12.
- **E2.** Ficha com o insumo da nota:
  - `GET /v1/fichas/resumo` antes e depois da nota com `atualizar_preco`;
  - `custo_ingredientes` muda pela conta (quantidade × preço novo).
- **E3.** Venda importada depois do preço novo: `baixa_venda.custo_unitario` = preço novo.
- **E4.** CMV em valor:
  - abrir, contar e fechar um inventário depois da nota;
  - `GET /v1/inventarios/cmv`: para o insumo da nota, `entradas` = qtd da nota, `custo_unit` = custo médio e `cmv_valor` = (ei + entradas − ea) × custo.
- **E5.** Conta **da nota** → `liquidar` com plano de conta de subgrupo `is_cmv` → `GET /v1/dre/pagos?mes=` traz o valor nessa classe.
- **E6.** De-para tardio:
  - importar venda com produto sem item → 0 baixas;
  - `PUT /v1/de-para` para um item **com** ficha → baixas criadas (contar `movimentacoes`).
- **E7.** Empresas (conferido em `empresas.service.ts`):
  - a 1ª empresa ativa nasce principal → `configuracoes.cnpj` e `razao_social` iguais aos dela;
  - criar a 2ª e chamar `POST /v1/empresas/:id/principal` → o espelho troca e a 1ª deixa de ser principal;
  - CNPJ repetido → 409 `DUPLICADO`; desativar ou excluir a principal → 409 `PRINCIPAL`; excluir empresa com colaborador → 409 `EM_USO`;
  - CNPJ inválido → 400 (o `CHECK` da migração e a normalização; a frase exata, *a conferir* no DTO);
  - loja → 403 em todas as rotas de `/v1/empresas`.
- **E8.** Empresas → Ponto (conferido em `ponto/espelho.service.ts`): o espelho traz a empresa do colaborador e, sem ela, a principal.
  Checar os dois casos.
- **E9.** Ponto:
  - admin libera um terminal;
  - loja **sem** `X-Ponto-Terminal` → recusada;
  - PIN errado → **400** (nunca 401);
  - marcar → a batida aparece no espelho;
  - anular sem motivo → 400; anular com motivo → anulada (não some);
  - manual com `substitui_id`;
  - a loja não alcança os cadastros do ponto.
- **E10.** Guarda do importador do Lovable: a Tarefa 0 conserta as listas e a expressão; o smoke não muda (é jest).

**Importar vendas (entram com a parte A):**

- **V1.** `previa` de planilha com mapeamento (datas `dd/mm/aaaa`, `1.234,56`) → contagens e `valor_centavos` certos; **nada gravado**
  (`count(*)` de `vendas` e `importacoes` igual antes e depois).
- **V2.** `confirmar` → vendas e baixas; o mesmo corpo de novo (mesma `chave_idempotencia`) → 409 `IMPORTACAO_JA_CONFIRMADA`, sem venda a mais.
- **V3.** Período com vendas da planilha padrão + confirmar de outra origem sem `confirmar_sobreposicao` → 409; com o campo → 201.
- **V4.** "Substituir" da origem B no período:
  - apaga só as de B;
  - as da planilha padrão, as de XML e as do cupom (o `CUP` semeado) ficam.
- **V5.** XML (documentos já lidos, montados com `jq` a partir das fixtures fictícias):
  - venda → `vendas_documentos` + vendas com `pedido = 'NFC-e s-n'`;
  - a mesma chave de novo → ignorada;
  - cancelamento → vendas e baixas somem e o documento fica `cancelada`;
  - cancelamento **antes** da venda → a venda que chega depois é ignorada;
  - chave do cupom semeado do Comanda → ignorada;
  - outro CNPJ → ignorado;
  - chave com DV errado → 400.
- **V6.** `ler-pdf` sem chave de IA → a frase de hoje; arquivo que não é PDF → 400; loja → 403 em todas as rotas novas.
- **V7.** A rota antiga `POST /v1/importacoes/vendas` "Substituir" não apaga venda de XML (`documento_id`).

**Cana (entram com a parte B):**

- **K1.** Lançamentos:
  - loja lança recebimento (hoje) → 201;
  - loja com data de 3 dias atrás → 400 `CANA_DATA_FORA`;
  - loja → 403 em parâmetros, produtos, semanas e anular.
- **K2.** Segunda contagem no mesmo dia → 409; anular a primeira (com motivo) → a segunda entra.
- **K3.** Sem DELETE nem UPDATE fora da anulação: SQL direto falha pelo gatilho.
- **K4.** Semana montada:
  - 2 contagens + recebimentos + produção + vendas importadas de 2 produtos configurados (um frozen);
  - `GET /v1/cana/semanas/:id` dá exatamente os números do exemplo de B.3;
  - com o rendimento do frozen nulo → o aviso e os litros de frozen fora.
- **K5.** Venda no dia da contagem anterior fica fora; no dia da atual, dentro.
- **K6.** A Cana não mexe no estoque: `count(*) from movimentacoes` igual antes e depois de todos os lançamentos.

### C.4 Checagens a acrescentar ao `web/scripts/browser-check.mjs`

- **Importar** (admin, 1366 e 360):
  - abrir `/vendas` → "Importar vendas";
  - planilha CSV com cabeçalho de outro sistema (vírgula e `windows-1252`) → mapeamento sugerido certo → prévia → confirmar → as vendas aparecem em `/vendas`;
  - XML (2 fixtures + 1 cancelamento) → prévia com "1 cancelado";
  - PDF sem chave → a frase;
  - com sobreposição, o botão só libera com a caixa marcada.
- **Cana:**
  - admin configura 2 produtos, lança e vê a semana com a conta escrita;
  - loja no celular: só os 3 botões, lança e **não** vê nenhum número da apuração (procurar "Perda", "vendido" e "L/DZ" na página = 0).

### C.5 Roteiro manual curto, no ar (Diego, uns 15 minutos; só depois das entregas)

1. **Vendas** do mês passado: anotar o "Faturamento". **DRE** do mesmo mês: anotar o "Faturamento bruto". A diferença é normal (C.2); anotar.
2. **Entrada de Notas:** lançar uma nota real por XML. Conferir o insumo em **Estoque & Movimentações** (entrada) e a conta em **Contas a Pagar**.
3. **Fichas:** abrir uma ficha que use esse insumo e ver o custo novo.
4. **Importar vendas:** importar o XML (ou a planilha) de **um dia** do outro sistema. Conferir a prévia contra o relatório do sistema (total do dia),
   confirmar e importar de novo o mesmo arquivo: tem de dizer "já importado / já existentes" e não somar.
5. **Cana:** fazer a contagem inicial; ao longo da semana, lançar recebimentos e produção; na contagem seguinte, abrir a semana e conferir as
   contas com o caderno da loja.
6. **Ponto e Empresas:** uma batida no terminal da loja e ver no espelho com o nome do empregador.

---

## Riscos (do mais grave ao menos grave)

1. **A cana numa loja que não é Valinhos.** Vendas, baixas, CMV teórico e o painel de Valinhos ficariam misturados. A parte B não começa sem a resposta 1.
2. **O mesmo caixa importado por dois caminhos** (planilha do PDV e XML do mesmo PDV). Conta em dobro. O R5 avisa e exige confirmação, mas
   não consegue impedir. Por isso a pergunta 10.
3. **"Substituir" apagando outra fonte** (hoje apaga tudo do período). O R3/R4 corrige, mas muda uma regra que já existe: o teste do cupom e o
   smoke "Substituir no dia do cupom" precisam continuar verdes.
4. **Cancelamento que chega semanas depois.**
   - A venda some e as baixas também: o saldo teórico muda para trás.
   - O CMV do inventário não muda (ele usa contagens).
   - A semana da cana muda, se não estiver fechada (B6).
   - A tela de resultado diz "3 cupons cancelados retirados (R$ X), de dd/mm a dd/mm".
5. **XML de outro PDV com detalhes que não conhecemos** (*não confirmado*):
   - contingência (`tpEmis` 9);
   - cancelamento por substituição (110112);
   - protocolo com `cStat` diferente;
   - zip com pastas ou com XML "de resumo".
   - Mitigação: nada some calado; todo ignorado aparece por motivo; o 1º teste é com um dia de arquivos reais (C.5 passo 4).
6. **PDF lido errado ou cortado pela IA:** conferência obrigatória, "soma × total impresso", recomendação de exportar por dia.
7. **Importação atrasada parecendo perda de caldo:** o aviso "vendas importadas até dd/mm" em toda semana.
8. **`DecompressionStream('deflate-raw')` ausente no navegador** (*não confirmado*): saída pelos .xml soltos.
9. **Prévia e confirmar com dados diferentes** (outra importação no meio). O confirmar refaz todas as conferências dentro da transação e devolve
   os números reais, que podem diferir da prévia. A tela mostra os do confirmar.
10. **Pedido sintético `DIA <data>` colidindo** (planilha ou PDF sem número de pedido): dois relatórios parciais do mesmo sistema no mesmo dia
    (almoço e jantar) dão a mesma chave; o 2º aparece como "já existente" e não entra. A prévia explica e sugere o relatório do dia inteiro ou
    "Substituir" o dia. Gerar o pedido com o hash do arquivo evitaria a colisão, mas deixaria o mesmo relatório reexportado entrar em dobro.

## Perguntas ao Diego (curtas; a minha recomendação em cada uma)

1. **A cana é vendida em Valinhos, no mesmo caixa e CNPJ, ou em outra loja?** Recomendo: se for outra loja, uma instalação própria do Comanda (hoje
   ele é de uma loja só, e Empresas não separa vendas nem estoque). Se for Valinhos, segue este desenho. **Bloqueia a Cana.**
2. **Quais produtos vendem caldo e com quantos ml cada um** (copo 300/500/700 ml, jarra 1 L, frozen…)? Recomendo: você mesmo cadastra na
   Configuração da Cana; eu não preencho nada.
3. **O que é o "rendimento do frozen"?** (a) 1 L de caldo vira X L de frozen (gelo e ar), ou (b) cada copo de frozen leva só Y ml de caldo?
   Recomendo (a): um número só para todos os frozen; o (b) já cabe no "ml por unidade" de cada produto.
4. **Quantos litros vocês esperam de uma dúzia de cana?** Recomendo deixar em branco por 2 ou 3 semanas e usar a média real que a tela mostrar.
5. **Quem lança recebimento, produção e contagem: a loja (no celular) ou só o admin?** Recomendo: a loja lança e só o admin vê a apuração
   (contagem cega, como no inventário).
6. **A contagem é feita no fechamento (fim do dia) ou na abertura?** Recomendo fim do dia; contagem da manhã é lançada com a data de ontem.
7. **Sobra frozen pronto na máquina, ou caldo congelado, de uma semana para outra?** Recomendo contar em litros, num campo separado do caldo.
8. **A cana vem com nota fiscal e entra hoje na Entrada de Notas?** Recomendo: na fase 1, a dúzia é lançada na aba Cana (sem valor); o custo e a
   ponte com a nota ficam para depois.
9. **Qual é o "outro sistema" das vendas e o que ele exporta** (XML do contador em .zip, planilha, só PDF)? Mande um arquivo de exemplo de cada.
   Recomendo nesta ordem: XML > planilha > PDF.
10. **Esse outro sistema é o mesmo caixa cujas planilhas já importamos, ou outro canal** (iFood, delivery, outra loja)? Recomendo: do mesmo
    caixa, só **uma** forma de importar por período.
11. **Relatório em PDF sem número de pedido e sem data por venda pode entrar como "1 pedido por dia"?** Recomendo sim, com aviso; melhor ainda,
    um relatório do dia inteiro (dois relatórios parciais do mesmo dia colidem, risco 10).
12. **XML emitido por outro CNPJ cadastrado em Empresas entra como venda desta loja?** Recomendo: não por padrão, e a prévia mostra com a caixa
    "incluir" desmarcada.
13. **Quer no DRE uma linha "Conferência: vendas importadas × caixa do mês"?** Recomendo sim, depois destas entregas.

---

## Plano de implementação (tarefas pequenas, em ordem)

**Regras para todas as tarefas:**

- nenhuma faz rede;
- comandos pesados só pelo `scripts/run-capped.sh` (CLAUDE.md), um por vez, numa máquina com memória livre;
- cada tarefa termina com jest/vitest dos arquivos tocados + `typecheck` + `lint` + o smoke ou browser-check indicado, e a saída colada no PR;
- commits em português com prefixo (`feat(importacoes): …`).

**Arquivos fixos que quase toda tarefa toca** (checar no fim de cada uma):

- `api/prisma/schema.prisma`;
- `api/src/scripts/import-lovable/esquema.ts` (`TABELAS_SO_NOSSAS`, `COLUNAS_SO_NOSSAS`, `GATILHOS`) e a contagem de FKs em `__tests__/esquema.spec.ts`;
- `api/src/common/http/wire.ts#DATE_ONLY_KEYS`;
- `api/src/common/__tests__/permissoes-protecao.spec.ts` (`CONTROLLERS` e listas exatas);
- `web/src/lib/erp-api.ts` (única porta HTTP do web);
- `web/src/app/(app)/layout.tsx#MENU`;
- `docs/api-contract.md` (§20 e §21);
- `CLAUDE.md` (linhas novas de regras rápidas);
- `README.md` (pendências do dono).

### Tarefa 0 (comum, antes de A e B) — guarda do importador do Lovable

| | |
|---|---|
| **Arquivos** | `api/src/scripts/import-lovable/esquema.ts`, `__tests__/esquema.spec.ts` |
| **O quê** | acrescentar `ponto_*` e `empresas` a `TABELAS_SO_NOSSAS`; `ponto_colaboradores.empresa_id` não entra em `COLUNAS_SO_NOSSAS`, porque a tabela já é só nossa; a expressão do teste passa a aceitar `CREATE TABLE nome (` sem aspas; conferir as FKs sem aspas (`REFERENCES tabela(col)`) e os gatilhos do ponto, se houver |
| **Testes** | o próprio `esquema.spec.ts` deve **falhar antes** do conserto (prova de que agora vê as tabelas) e passar depois |
| **Pronto quando** | o spec passa; `conferirEsquemaNosso` contra um banco migrado do zero (no `import-lovable-e2e.sh`, se a máquina aguentar) não acusa tabela desconhecida |

### Parte A — Importar vendas (pode ir ao ar sozinha)

**Tarefa A1. Migração `vendas_importacao` + Substituir por origem (R3/R4)**

- **Arquivos:**
  - `api/prisma/migrations/2026112xxxxxxx_vendas_importacao/migration.sql` (A.7, com aspas);
  - `schema.prisma`;
  - `esquema.ts`;
  - `importacoes.service.ts#vendas` (o `deleteMany` com o filtro de R4);
  - `__tests__/importacoes-cupom.spec.ts`.
- **Testes:**
  - `importacoes-cupom.spec.ts` (filtro novo);
  - `esquema.spec.ts`;
  - smoke: as checagens de hoje do "Substituir no dia do cupom" continuam verdes + V7.
- **Pronto quando:** a migração aplica num banco com os dados de hoje sem mudar nenhuma linha; o smoke de hoje passa.

**Tarefa A2. Regras puras da planilha e da prévia (API)**

- **Arquivos:** `api/src/modules/importacoes/planilha.ts`, `previa.ts`, `documentos.ts` (só a conferência de chave e CNPJ) e `__tests__/*.spec.ts`.
- **Testes:** A.10 (planilha, documentos, prévia) — todos sem banco.
- **Pronto quando:** cada regra R1–R7 tem pelo menos um teste com o número esperado escrito.

**Tarefa A3. Rotas de origens, prévia e confirmar (planilha e PDF já conferido)**

- **Arquivos:**
  - `importacoes.controller.ts` (rotas estáticas antes das `:id`);
  - `dto/importacoes.dto.ts`;
  - `importacoes.service.ts` (pipeline comum `aplicarVendas(tx, …)`, usado também pela rota antiga);
  - `permissoes-protecao.spec.ts`;
  - `docs/api-contract.md` §20.
- **Testes:**
  - `importacoes-vendas.spec.ts` com Prisma falso (ordem da transação, idempotência, sobreposição 409);
  - smoke V1–V4.
- **Pronto quando:** a prévia não grava (V1) e o duplo confirmar não duplica (V2).

**Tarefa A4. Tela `/vendas/importar` — planilha**

- **Arquivos:**
  - `web/src/app/(app)/vendas/importar/page.tsx`;
  - `web/src/lib/importar-vendas.ts` (sugestão de mapeamento);
  - `web/src/lib/parse.ts` (separador e `windows-1252`, **sem mudar** o padrão de hoje da tela Importar Dados);
  - `erp-api.ts`;
  - botão em `/vendas`;
  - link em `/importar`.
- **Testes:**
  - vitest `importar-vendas.test.ts`, `parse.test.ts`;
  - browser-check C.4 (planilha).
- **Pronto quando:**
  - os 4 estados aparecem (carregando, vazio, erro, sucesso);
  - no celular de 360 px, sem rolagem lateral;
  - o mapeamento lembrado volta na 2ª importação.

**Tarefa A5. XML no navegador + registro de documentos e cancelamento (API)**

- **Arquivos:**
  - `web/src/lib/nfe.ts` (só exportar as buscas `all`/`one`/`txt`; o `nfe.test.ts` de hoje continua verde);
  - `web/src/lib/nfe-vendas.ts` e `web/src/lib/zip-leitura.ts`, com as fixtures em `web/src/lib/__tests__/fixtures`;
  - o grupo "Notas fiscais (modelo 55)" desmarcado na prévia, com os CFOPs;
  - aba XML na tela;
  - `api/src/modules/importacoes/documentos.ts` (completo);
  - a função SQL `vendas_documento_cancelar` e o gatilho `vendas_documentos_imutavel` (na migração da A1 se ainda não foi ao ar; senão, migração nova).
- **Testes:**
  - vitest `nfe-vendas.test.ts`, `zip-leitura.test.ts`;
  - jest `documentos.spec.ts`;
  - smoke V5;
  - browser-check XML.
- **Pronto quando:** a tabela de A.4 está coberta linha a linha por teste; tipo desconhecido aparece na prévia como "ignorado: <motivo>".

**Tarefa A6. PDF por IA**

- **Arquivos:**
  - `leitura-pdf/schemas.ts` (`SCHEMA_RELATORIO_VENDAS`, `INSTRUCOES_RELATORIO_VENDAS`);
  - `leitura-pdf.service.ts#lerRelatorioVendas`;
  - a rota `POST /v1/importacoes/vendas/ler-pdf`, com o `LeituraPdfModule` exportando o serviço;
  - a aba PDF com a conferência editável;
  - `permissoes-protecao.spec.ts` (teste de `/ler-`).
- **Testes:**
  - jest com leitor falso (limpeza, linha sem data, resposta cortada → `PDF_ILEGIVEL`);
  - smoke V6;
  - browser-check (PDF sem chave).
- **Pronto quando:** nada é gravado pela leitura e a tela mostra "soma × total impresso".

**Tarefa A7. Documentação e pendências do dono**

- **Arquivos:** `CLAUDE.md`, `README.md` ("teste real: um dia de XML e uma planilha do outro sistema; PDF real pela IA"), `docs/api-contract.md`.
- **Testes:** nenhum (só documentação).
- **Pronto quando:** as perguntas 9–12 respondidas estão anotadas no desenho; o item da "Importar Dados" diz onde as vendas foram parar.

### Parte B — Cana (começa só depois da resposta 1; vai ao ar sozinha)

**Tarefa B1. Migração `cana`**

- **Arquivos:** `api/prisma/migrations/2026112xxxxxxx_cana/migration.sql` (B.5, com aspas, gatilho de imutável), `schema.prisma`, `esquema.ts`.
- **Testes:** `esquema.spec.ts`; smoke K3 (o banco recusa DELETE e UPDATE fora da anulação).
- **Pronto quando:** a migração aplica sem tocar em tabela existente.

**Tarefa B2. Conta da semana, pura**

- **Arquivos:** `api/src/modules/cana/apuracao.ts`, `__tests__/apuracao.spec.ts`.
- **Testes:** B.8 (o exemplo de B.3 número a número, nulos, bordas, avisos).
- **Pronto quando:** cada número devolve também os seus componentes (para a tela escrever a conta) e nenhum divide por zero.

**Tarefa B3. API da cana**

- **Arquivos:**
  - `api/src/modules/cana/{cana.module,cana.controller,cana.service}.ts` e `dto/`;
  - `app.module.ts`;
  - `permissoes-protecao.spec.ts` (`CONTROLLERS` + lista da loja, conforme a resposta 5);
  - `docs/api-contract.md` §21;
  - `CLAUDE.md` (a 2ª exceção à "regra em SQL").
- **Testes:**
  - `cana.dto.spec.ts`;
  - teste de permissão;
  - smoke K1, K2, K4, K5, K6.
- **Pronto quando:** a loja não alcança nada além das 2 rotas e a apuração de K4 bate com B.3.

**Tarefa B4. Tela `/cana`**

- **Arquivos:** `web/src/app/(app)/cana/page.tsx` (+ componentes das 3 abas e da visão da loja), `web/src/lib/cana.ts` (formatar as contas), `erp-api.ts`, `MENU`.
- **Testes:** vitest `cana.test.ts`; browser-check C.4 (cana).
- **Pronto quando:**
  - cada número na tela tem a conta e a origem embaixo;
  - a loja no celular lança em uma tela e não vê nenhum número calculado;
  - os estados "sem contagem" e "uma contagem só" aparecem.

**Tarefa B5. Documentação**

- **Arquivos:** `README.md` (pendência "primeira semana real da cana com o caderno da loja"), `CLAUDE.md` (módulo `cana`, rotas, a exceção à
  "regra em SQL", quem lança).
- **Testes:** nenhum (só documentação).
- **Pronto quando:** as respostas 1–8 estão anotadas no desenho e o README diz como conferir a primeira semana real.

**Tarefa B6. (Opcional) Fechar a semana**

- **Arquivos:** migração `cana_fechamentos`, rotas fechar/reabrir, `DATE_ONLY_KEYS` (`periodo_ini`, `periodo_fim`), a trava de anulação em semana fechada.
- **Testes:** jest do serviço; smoke (fechar → mudar o ml de um produto → a semana fechada não muda; anular dentro → 409).
- **Pronto quando:** reabrir exige motivo e guarda quem.

### Parte C — Roteiro (independe de A e B)

**Tarefa C1. Checagens E1–E9 no smoke**

- **Arquivos:** `api/scripts/smoke.sh` (blocos novos depois de "importações" e antes de "usuários"; Ponto e Empresas num bloco próprio).
- **Testes:** as checagens E1–E9 são o próprio teste; cada uma é escrita primeiro contra o código de hoje e precisa passar sem mudar código
  (se alguma falhar, é bug a abrir, não checagem a ajustar).
- **Pronto quando:** o smoke passa inteiro, pelo `smoke-capped.sh`, e o README passa a citar a contagem real de checagens.

**Tarefa C2. Linha "Conferência" no DRE** (só com o "sim" da pergunta 13)

- **Arquivos:** `web/src/app/(app)/dre/page.tsx` (a linha "Vendas importadas no mês: R$ X · Caixa: R$ Y · diferença R$ Z", lendo `GET /v1/vendas`
  do mês, que já existe), `web/src/lib/dre.ts` (a diferença, pura).
- **Testes:** vitest `dre.test.ts` (diferença com e sem vendas); browser-check (a linha aparece em `/dre`).
- **Pronto quando:** a linha diz de onde vem cada número e nada muda no cálculo do DRE.

---

## Fora do escopo

- Várias lojas na mesma instalação (vendas, estoque e inventário por empresa): é projeto próprio.
- Custo da cana e do litro de caldo; ponte automática nota → recebimento de cana (opção 3 de B.2).
- Guardar os XML importados; importar devolução (`finNFe` 4) como venda negativa.
- Foto de relatório de vendas (só PDF, por ora).
- Importar pagamentos (formas de pagamento) dos XML para o caixa: o caixa continua lançado à mão.
- Corrigir o "CMV teórico" da tela Vendas, que usa o custo de **hoje** da ficha (herança do protótipo; `recalcular_baixas` também regrava as
  baixas antigas com o preço atual). Só registrado aqui.

---

## Decisões da implementação (Tarefa 0 e Parte A, 25/11/2026)

Tomadas na implementação (ramo `feat/vendas-cana`), pelo mais seguro quando havia escolha. Cada uma dá para voltar atrás.

**Pontos da UX (seção 7 de `2026-11-24-importar-vendas-e-cana-ux.md`) que tocam a Parte A**

| Ponto | Decisão | Por quê |
|---|---|---|
| 7.1 contagens que fecham | aceito: `linhas.novas` explícito, identidade `lidas = novas + ja_existentes + com_problema + somadas_no_arquivo` no teste puro, `ja_existentes_valor_centavos` | o cartão escreve a conta |
| 7.2 exemplo e nome da fonte | aceito: `ja_existentes_de_outra_fonte[].exemplo { pedido, data }`; `fonte` = nome para a tela + `tipo` (`padrao`, `cupom`, `sistema`, `xml`) | a frase da P4 |
| 7.3 motivos com total | aceito: `motivos: [{ motivo, linhas }]` sobre todas as linhas (o tipo do motivo, sem o valor entre parênteses); `problemas` continua até 200 | P14/P15 |
| 7.4 resposta do importar | aceito: `valor_centavos`, `periodo`, `apagadas_valor_centavos`, `canceladas { documentos, linhas, valor_centavos }`, `mapeamento_salvo`, `confirmada_em` | risco 9: a tela mostra os números do confirmar |
| 7.5 409 com `importacao_id` | **R8 mudou:** a mesma chave com o mesmo corpo responde **200 com o resultado guardado** (`repetida: true`); o 409 `IMPORTACAO_JA_CONFIRMADA` fica só para a mesma chave com **outro** corpo. `importacoes` ganhou `corpo_sha256` e `resultado` (jsonb). O hash não inclui a chave nem a caixa da sobreposição. O filtro global de erro não mudou | o filtro só manda `{ code, message }`; assim o "Tentar de novo" mostra o resultado. Smoke V2 confere |
| 7.6 conta dos arquivos XML | aceito: o navegador manda `arquivos_lidos` e os `ignorados` com o nome do arquivo; o servidor confere que `arquivos_lidos = documentos + cancelamentos + ignorados` (400 se não fecha) e classifica cada arquivo em exatamente um grupo (`fechaContagemXml`); `cancelamentos_de_importados` traz `ini`/`fim`; os ignorados vêm por motivo com os nomes | "nada some calado" |
| 7.7 últimas importações | aceito: rota nova `GET /v1/importacoes/vendas/recentes` (sistema, formato, arquivo, vendas novas, quem) | a de hoje não tem sistema nem nome |
| 7.8 Vendas pela URL | aceito: `/vendas?ini=&fim=` abre como "Personalizado" | "Ver vendas do período" |
| 7.9 cabeçalho fora da 1ª linha | aceito: a 1ª linha (entre as 10 primeiras) com 3+ nomes conhecidos; `primeira_linha` vai ao servidor para as frases "Linha N". **Não feito:** a escolha "Trocar" o cabeçalho na tela | o mais comum fica coberto; trocar à mão é raro |
| 7.10 rascunho | sem storage (como a UX propôs); aviso do navegador ao sair | o CLAUDE.md só libera 3 usos |
| 7.11 parece de caldo | aceito: `parece_cana` por produto em `produtos_sem_de_para`, da função `pareceCana` (`importacoes/previa.ts`; a Parte B deve reusar) | uma lista só |
| 7.12 P6 | aceito: `ja_existentes_pedido_dia` | o aviso só aparece no caso certo |
| 7.25 prévia a cada escolha | a tela espera 500 ms e cancela o pedido anterior (`AbortController`); o throttler é 300/min | cabe |
| 7.26 XML só com cancelamentos | aceito: `IMPORTACAO_VAZIA` só no confirmar e só quando não há venda nova **nem** cancelamento a aplicar; a prévia nunca dá 400 por vazio (devolve `novas = 0` e os motivos, a tela mostra P15/P16/P18) | o cancelamento que chega semanas depois tem de entrar |
| 7.27 lista de sistemas | aceito: `GET /v1/importacoes/origens` devolve `{ origens: [... ultima_importacao_em, mapeamento], planilha_padrao: { ultima_importacao_em } }`, ativos e o último usado primeiro | a meta de 4 toques |
| 7.13–7.24 | **Parte B, não feito.** Anotados para a Cana | — |

**Outras decisões**

- **"Ações não atômicas" (editar o sistema fora do confirmar):** trocar `prefixo_pedido` de um sistema que **já tem vendas** é recusado com 409 `ORIGEM_PREFIXO_EM_USO` (a chave R1 mudaria e o mesmo arquivo entraria de novo). Nome, separador, colunas e "parar de usar" seguem livres.
- **Concorrência:** o confirmar começa com `pg_advisory_xact_lock(hashtext('importacao_vendas'))` e refaz todas as conferências dentro da transação (o `FOR UPDATE` não trava chave que ainda não existe). Desde a revisão de 24/11, a rota antiga pega a mesma trava (`TRAVA_IMPORTACAO_VENDAS`).
- **NF-e (modelo 55):** o DTO ganhou `nfe_incluidas` (chaves marcadas na prévia); sem estar na lista, a NF-e fica de fora (`documentos.nfe_fora`, com os CFOPs). Idem `cnpjs_incluidos`, que só vale para CNPJ ativo de Empresas.
- **Pedido do XML de outra empresa incluída** leva o CNPJ no fim (`NFC-e 1-12 98765432000110`): a mesma série-número de dois CNPJs não colide na chave R1. O da loja continua `NFC-e <série>-<número>` (o formato do cupom do Comanda).
- **Números da planilha:** no modo vírgula, "12.90" e "1.234" (sem vírgula) são linha com problema; no modo ponto, "12,90" e "1,234". Valor negativo também. Nada de palpite. No Excel, o leitor novo usa o valor **tipado** (data e número), não o texto formatado da célula (`raw: false` dava `m/d/yy` e `1,234.56`); a tela manda o número com o separador escolhido.
- **`preco_unitario`** da planilha sem a coluna = valor ÷ quantidade (4 casas); o da rota antiga continua 0.
- **Dinheiro:** `Prisma.Decimal` em toda conta do servidor e centavos inteiros na resposta (a rota antiga continua com `parseNum`, como hoje).
- **Onde ficou cada coisa:** o pipeline do servidor é um só (`importacoes-vendas.service.ts`), então o XML do servidor entrou junto da A3; a A5 é a leitura no navegador. A rota `POST /v1/importacoes/vendas/ler-pdf` ficou no `LeituraPdfController` (que já tem a leitura do multipart e a tradução dos erros da IA), sem exportar o serviço para outro módulo. A rota antiga **não** passou a usar o pipeline novo (só o `where` do Substituir mudou, R4): menos risco nas planilhas de hoje.
- **XML no navegador:** a NFC-e de homologação vai ao servidor com `tp_amb 2` e é ignorada lá (o servidor confere); evento 110112 e `cStat` 101/151 no protocolo valem como cancelamento (*não confirmado*, conferir com XML real).
- **Importar Dados:** o botão "Vendas" saiu (virou a linha com o link) e o aviso dos cupons de lá também (a prévia nova mostra a sobreposição com o cupom). O título "De-para do relatório de vendas" ficou (o browser-check confere) e ganhou a âncora `#ligacao-cardapio`.

**Perguntas 9–12 ao Diego (aplicada a recomendação do próprio desenho; muda sem mexer no código, salvo onde dito)**

- 9 (o que o outro sistema exporta): os três formatos estão prontos; a tela recomenda XML > planilha > PDF. Pendência do dono: mandar um arquivo real de cada (README).
- 10 (mesmo caixa ou outro canal): a prévia avisa a sobreposição e exige a caixa (R5); recomendação: do mesmo caixa, uma forma de importar por período.
- 11 (PDF sem pedido nem data por linha): entra como "1 pedido por dia" (`DIA <data>`), com a data escolhida na conferência e o aviso de vários dias.
- 12 (XML de outro CNPJ de Empresas): fica de fora por padrão; a prévia mostra com a caixa "Incluir" desmarcada (`cnpjs_incluidos`).

**Correções da revisão de código (24/11/2026, ramo `feat/vendas-cana`)**

| # | Achado | Decisão | Por quê |
|---|---|---|---|
| 1 | Cancelamento de cupom de outra Empresa ignorado | cancelamento de chave já `autorizada` em `vendas_documentos` sai **antes** do teste de emitente (qualquer emitente); cancelamento de CNPJ de Empresas que nunca entrou vai para `outros_cnpjs` (com `cancelamentos`) e só vale com o CNPJ marcado | quem aceitou o emitente foi a importação da venda; a caixa "Incluir" vale por CNPJ |
| 2 | Substituir apaga vendas de linhas com problema | **bloquear** (não excluir chaves): com linha com problema e vendas a apagar, `substituir.bloqueado` na prévia, aviso âmbar com "Só acrescentar as novas", e o confirmar dá 409 `SUBSTITUIR_COM_PROBLEMA` sem apagar nada | excluir as chaves das linhas ruins não protege a linha com data ou produto ilegível (o problema mais comum): não dá para saber qual venda ela é |
| 3 | Soma dos itens × vNF | Σ(vProd − vDesc + vOutro + vFrete + vSeg) contra `valor_total`, tolerância R$ 0,02 × nº de itens; conferido só no documento que **entraria** (depois de NF-e desmarcada, já importado e cancelado no envio); divergente = `documentos.com_problema` com o motivo e os dois valores | o servidor não confia no resumo do navegador. **Limite:** ICMS-ST e IPI (que somam no vNF da NF-e) não entram na conta; NF-e com eles fica de fora (README) |
| 4 | `documentoDaVenda` por pedido | `vendasDosNovos` recusa (400) dois documentos novos com o mesmo pedido e chaves diferentes, com os dois nomes de arquivo | a venda de um iria para o documento do outro |
| 7 | Sistema parado | 409 `ORIGEM_INATIVA` na prévia e no confirmar | "Parar de usar" tira da lista; importar por id direto não pode passar |
| 8 | P2002 do `lower(nome)` | 409 `ORIGEM_REPETIDA` ao criar e ao renomear (o `catch` fica fora do `$transaction`) | a conferência por nome não segura a corrida; o índice segura |
| 9 | Centavos | valor, desconto, taxa e frete da planilha/PDF com 2 casas (meio para cima); quantidade e preço unitário como vieram | a coluna é `numeric` sem escala: "12,345" ia para o banco com 3 casas |
| 11 | Cancelamento de cupom do próprio Comanda | não aplica; `cancelamentos_do_comanda { arquivos, ainda_autorizados }` e o aviso (âmbar com link para Cupom fiscal se algum continua autorizado aqui) | o cupom do Comanda se cancela no Comanda |
| 12 | Cancelamento de cupom cujas vendas vieram por planilha | `cancelamentos_sem_venda_xml`: cancelamentos de chave que nunca veio por XML (nem no envio) e as vendas de planilha/sistema nos dias deles (dia do evento em Brasília; sem ele, o mês da chave); o aviso é condicional ("se esses cupons são do mesmo caixa…") | o pedido do PDV não aparece no cupom: não dá para casar cupom e linha da planilha |
| 13 | Trava na rota antiga | `pg_advisory_xact_lock(hashtext('importacao_vendas'))` no início da transação de `vendas()` | as duas rotas nunca correm juntas |
| 5, 6, 10 | .zip, número ambíguo, índice fora do schema | inflate em fluxo com teto real (1 MB por arquivo, 100 MB de bytes reais no total); "1.234" na conferência do PDF = ambíguo (como na planilha); o índice anotado no CLAUDE.md e no README | — |

**Ficou de fora (anotado):** a rota antiga continua com o Substituir sem o bloqueio das linhas com problema (o `vendasDasLinhas` descarta a linha ruim calado, como sempre); ela é obsoleta e só o smoke a usa.

**Ambiente desta implementação (não muda o código):** o `node_modules` do worktree é atalho para o checkout principal, então o cliente Prisma novo foi gerado à parte (`api/.cache/prisma-client`, fora do git) e o jest/tsc/smoke usaram um `tsconfig` com `paths` para ele; o cliente compartilhado não foi tocado. O Postgres do projeto (rede `172.62.0.0/24`) estava inalcançável do host por causa do Cloudflare WARP (essa faixa é pública e vai pelo túnel); o smoke rodou numa cópia descartável apontada para um Postgres 16 na ponte padrão do Docker.

---

## Decisões da implementação — Cana e Parte C (24/11/2026, ramo `feat/cana`)

Implementado sobre `origin/main` 9ab291c, já com o **multiempresa** do Diego (PR #3), que este desenho não conhecia. Pelo mais seguro quando havia
escolha; cada uma dá para voltar atrás.

**Respostas do dono (24/11) e o que mudou no desenho**

- Pergunta 1: a cana é da **Frutá Frozen Outlet Premium Itupeva**, empresa própria no Comanda (schema `empresa_deb691b82d30`); Valinhos não vende
  cana. O risco 1 deixou de existir: com o multiempresa, cada empresa tem as suas tabelas `cana_*`, as suas vendas e a sua configuração. Nada de
  "loja" dentro das tabelas da cana.
- Pergunta 5: a loja lança (às cegas) e só o admin apura. "Loja" = colaborador com a tela **`cana`** liberada (tela nova no catálogo de módulos,
  API `MODULOS` + `web/src/lib/modulos.ts`, "Cana (lançar)" em Usuários → Liberar telas; fora do padrão de colaborador novo). Como o guard não
  olha módulos em rota `@Staff()`, as 2 rotas da loja conferem a tela no serviço (`exigirModuloCana`; 403 sem ela). As rotas de admin ficam
  `@AdminOnly()` **sem** `@Modulos` (a `cana` é tela de visão da loja, como `inventario`; teste `permissoes-protecao.spec.ts`).
- Perguntas 2, 3, 4, 6 e 7 continuam sem resposta: tudo configurável e nada preenchido. Pergunta 3 implementada como (a) "1 litro de caldo vira
  quantos litros de frozen?" (a recomendação); pergunta 6 como "fim do dia" (o texto da contagem diz para marcar Ontem quando contar de manhã);
  pergunta 7 com o campo de frozen opcional.

**Pontos da UX (seção 7) que tocam a Cana**

| Ponto | Decisão | Por quê |
|---|---|---|
| 7.13 chave de repetição | aceito: `chave_idempotencia` (uuid, única) no `POST /lancamentos`; nasce no navegador a cada abertura do formulário. A mesma chave do **mesmo usuário com os mesmos números** devolve o lançamento da 1ª vez (200, `repetido`); outra pessoa ou outros números = 409 `CANA_CHAVE_REPETIDA` | recebimento em dobro com o sinal fraco do balcão; e a chave não pode devolver a contagem de outra pessoa (quebraria a contagem cega). Com ela, a "releitura depois de 3 s" da UX saiu: tocar de novo em Lançar é seguro |
| 7.14 corrigir em duas chamadas | aceito: `POST /lancamentos/:id/corrigir` anula ("Corrigido: …") e lança o novo, do mesmo tipo, com `substitui_id`, numa transação (`SELECT … FOR UPDATE` no antigo). `substitui_id` saiu do `POST` (só o corrigir o usa) e é único | nunca fica o antigo anulado sem o novo; a contagem do mesmo dia passa pelo índice parcial na ordem certa |
| 7.15 contagem do dia | aceito: a frase de `CANA_CONTAGEM_DO_DIA` muda pelo perfil (loja: "avise o gerente"); `recentes.contagens_lancadas` traz as de hoje e ontem **sem número** e o formulário avisa antes | a loja não anula; contar à toa cansa |
| 7.16 recentes da loja | aceito: só os próprios, com `anulado`/`corrigido` sem motivo e sem o número novo; `hoje`/`ontem` do servidor; os 5 últimos fornecedores | contagem cega; relógio do celular |
| 7.17 desfazer da loja | **não feito** (anotado no README como pergunta) | muda regra: só com o "sim" do dono |
| 7.18 parcelas prontas | aceito: cada número com as parcelas (lançamentos, datas, ids das contagens, período das vendas), as dúzias anotadas nas produções e os avisos como `{ codigo, dados }` | a tela escreve a conta e o link de cada aviso |
| 7.19 casas | aceito como a UX: dúzias e litros com 1 casa na tela, "L por dúzia" com 2, porcentagem com 1; o servidor guarda e devolve com 2/3/4 casas e só arredonda na saída (Decimal por dentro) | o exemplo do desenho mostra 4,28 |
| 7.20 quem mudou | aceito: `GET /parametros` com `atualizado_por_nome`, `atualizado_em` e as 5 últimas do histórico; produtos com `atualizado_por_nome`/`atualizado_em` | auditoria |
| 7.21 média real | os 4 números da lista ficaram cana moída, produzido, vendido e perda; a sugestão "Usar 4,9" na Configuração **não foi feita** | opcional; os dados já estão na lista |
| 7.22 pergunta 3 (b) | não se aplica enquanto a resposta for (a); anotado | — |
| 7.23 rendimento da semana | como o desenho (vendido ÷ moída), com a frase explicativa sob o cartão | é o pedido do dono |
| 7.24 perda sem limite | sem cor e sem limite | parâmetro novo só com o dono |
| B6 fechar a semana | **não feito**: toda semana é calculada na hora, com a configuração de hoje (`calculada_com`), e a tela diz isso | opcional no desenho |

**Outras decisões**

- **Sem FK para `users`** em `cana_*` (quem lançou = uuid + nome fotografado): a migração roda em cada schema de empresa, e `users` só tem linhas em
  `public`. Pelo mesmo motivo, nada é qualificado com `public.` (teste em `esquema.spec.ts`).
- **Sem semente** em `cana_parametros`: a linha única nasce no primeiro "Salvar os números" (a migração só acrescenta, sem INSERT).
- `cana_parametros_historico` também é imutável (gatilho), além do livro de lançamentos.
- "Cana moída zero" ganhou o aviso próprio `cana_moida_zero` (o desenho só tinha o negativo); os cartões que dividem mostram "—".
- O web segue o padrão do repositório (`useQuery` + `useState`); o desenho pedia react-hook-form + zod, que as telas não usam. "Sair sem lançar?"
  usa o `confirm` do navegador.
- A resposta do `POST /lancamentos` para a loja é o mesmo recorte de `recentes` (sem motivo, quem anulou ou o id de quem lançou): a mesma chave
  depois de o gerente anular não devolve o motivo dele. Colaborador sem a tela `cana` que abre `/cana` pela URL vê "Esta tela não foi liberada".
- **UX que ficou de fora (dá para fazer depois, nada de regra):** as parcelas das contas como link para a lista filtrada; a tabela de lançamentos e o
  `Sheet` lateral no computador (hoje cartões em todas as larguras e o formulário no lugar da lista); a barra "Salvar os 2" na Configuração; o link
  "Ver a contagem de dd/mm" no `CANA_CONTAGEM_DO_DIA` do admin; o filtro "a semana escolhida" e "Escolher datas" no período dos Lançamentos (há
  7/30/90 dias e 1 ano); a sugestão "Média real" (7.21).

**Parte C: o que mudou das checagens de C.3 (desenho anterior ao multiempresa)**

- E1–E6 e E9 entraram como escritas, no **fim** do smoke (o 1º `POST /v1/empresas` toma o `public` e regrava `configuracoes`). Nenhuma falhou no
  código de hoje. O CMV em valor (E4) confere o `cmv_valor` da rota e as parcelas direto em `v_cmv_periodo` (a rota só devolve o valor).
- E7: `POST /v1/empresas/:id/principal` não existe mais; a principal é a dona do `public` (a 1ª cadastrada). Conferido: a 1ª fica com o `public` e
  é a principal, Configurações espelha; a 2ª nasce num schema próprio com todas as migrações; `DUPLICADO`, `PRINCIPAL` ao excluir, `EM_USO` (usuários),
  CNPJ inválido, loja 403. "Desativar a principal → 409" **saiu**: o PR #3 tirou essa regra de propósito (a frase do excluir diz "Desative-a"), mas o
  §19 do contrato ainda a cita (e cita "tornar principal") — a corrigir no contrato pelo dono do multiempresa.
- E8: no multiempresa o empregador do ponto só pode ser a empresa da requisição (`empresaExiste`); outra empresa = 404. Conferido assim, mais o
  espelho com a principal (sem empregador), com o empregador e, dentro da 2ª, com ela mesma.
- E9: `corrigir` do ponto responde 200 (`@HttpCode(200)`), não 201.
- Multiempresa: insumo, cana e colaborador do ponto criados numa empresa não aparecem na outra; cabeçalho malformado/inexistente = 403 `EMPRESA`; a
  colaboradora da 2ª fica nela mesmo mandando o cabeçalho da 1ª. K1–K4 rodam também na 2ª empresa (o cliente real da cana é um schema `empresa_*`).

**Produção (multiempresa):** o CMD do Dockerfile roda `prisma migrate deploy` (public) **e** `migrar-empresas` (cada `empresa_*`) a cada subida; a
migração `cana` chega a `empresa_deb691b82d30` sozinha no `subir-api.sh`. Conferido num banco parado na multiempresa com um schema de empresa:
as 4 tabelas, os 2 gatilhos e o índice parcial nos dois schemas. Os dois passos estão encadeados com `&&`: se um schema falhar, a API não sobe.
