# Importar vendas e controle da cana: interface e textos

Complementa `2026-11-24-importar-vendas-e-cana-design.md` (partes A e B). Vale o desenho: nenhuma regra de negócio muda aqui. O que a tela
precisa e o desenho não dá está na seção 7 ("Pontos para o arquiteto"). Nada foi rodado (máquina com pouca memória): tudo o que está aqui foi
lido no código e nos desenhos em 24/11/2026. Contraste e tamanhos ficam **a medir** no browser-check.

**Quem usa:**

- **Importar vendas:** só o admin (Diego ou gerente), no computador (relatório do mês, .zip do contador) e às vezes no celular (relatório de um dia).
- **Cana, Semana e Configuração:** só o admin, no computador ou no celular.
- **Cana, Lançar:** a equipe da loja, no celular (360 px), em pé no balcão, mão molhada ou com luva, com pressa, perto da moenda. Se o Diego
  responder "só o admin lança" (pergunta 5 do desenho), a visão da loja não existe e o admin lança pela aba Lançamentos.

**Componentes** (todos já existem): `PageHeader`, `Panel`, `Stat`, `Empty`, `Tag` (`ok`/`warn`/`bad`/`muted`/`gold`), `Button` (`h-11`, `w-full`
no celular), `Input`, `Label`, `Textarea`, `Checkbox`, `RadioGroup`, `Switch`, `Select` nativo `h-11` (o `<select>` do navegador, que no celular
abre a roda do sistema), `Tabs` (gatilhos `h-11`, como na Entrada de Notas), `Sheet`, `Dialog`, `AlertDialog`, `Skeleton`, `Progress`, `toast`
(sonner). Ícones lucide sempre com texto ao lado: `Upload`, `FileSpreadsheet`, `FileCode2`, `FileText`, `CheckCircle2`, `CircleAlert`,
`TriangleAlert`, `Ban`, `Loader2`, `Minus`/`Plus`, `X`, `CupSoda` (menu da Cana), `Truck` (recebi), `GlassWater` (produzi), `ClipboardCheck`
(contagem). Cor nunca sozinha.

**Convenções da casa** (as mesmas do cupom fiscal e das notas):

- erros e avisos em caixa **dentro** da tela; toast só para sucesso curto e "Desfazer";
- erro do servidor sempre por `errMsg()`;
- datas `24/11/2026` (nas listas, `24/11` e "hoje"/"ontem"), hora `14h05`, dinheiro `R$ 1.234,56`;
- não usar `h-8` nem tabela com rolagem lateral no celular: de `md` para baixo, cartões (`md:hidden` / `hidden md:block`), como na aba Notas da SEFAZ;
- nada desta tela vai para o storage do navegador (o CLAUDE.md só libera a sessão, o rascunho da contagem do inventário e o terminal do ponto).

**Jobs** (o que a pessoa quer fazer, na linguagem dela):

1. **Importar.** "Quando fecho o dia ou o mês no sistema do caixa, quero trazer as vendas para o Comanda sem montar planilha no formato dele,
   para o estoque, o CMV e a cana baterem, sem contar nada em dobro."
2. **Lançar (loja).** "Quando chega cana, quando moo, ou quando fecho a loja, quero anotar o número no celular em segundos, sem fazer conta."
3. **Apurar (admin).** "No começo da semana, quero ver quanto caldo a cana rendeu e quanto sumiu, com a conta aberta, para saber se o problema
   está na moagem, na venda ou no lançamento."

**Metas** (contadas nos esboços das seções 2.9 e 3.7):

| Tarefa | Toques | Tempo (hipótese, medir no 1º uso) |
|---|---|---|
| Importar a planilha de um sistema já usado (colunas lembradas, sem aviso) | **4**: Importar vendas · Escolher o arquivo · o arquivo no seletor · Importar 2.301 vendas | até 1 min |
| Importar o .zip de XML do mês | **4** (o mesmo caminho; a leitura anda sozinha) | até 3 min (leitura de ~1.500 arquivos) |
| Primeira importação de um sistema novo (planilha) | **8** + o nome (o foco já abre no campo Nome): Importar vendas · + Novo sistema · tipo de arquivo de sempre · Criar o sistema · Escolher a planilha · o arquivo · Ver a prévia · Importar | até 4 min |
| Período com vendas de outro lugar | **+1** (a caixa "São vendas diferentes…") | — |
| Substituir | **+2** (a escolha "Trocar…" e o diálogo) | — |
| Loja: lançar cana recebida | **3** + os números: Cana · Recebi cana · Lançar 12 dúzias recebidas hoje | até 20 s |
| Loja: contagem | **4** + os números: Cana · Contagem do que sobrou · 2º campo · Lançar a contagem | até 40 s |
| Admin: ver a última semana fechada | **1** (Cana; a aba Semana abre na última semana fechada) | 0 s de busca |

Por que não menos: a prévia é obrigatória ("nada gravado sem conferir"), e cada número da cana precisa ser digitado por alguém que contou.

---

## 1. Menu, rotas e quem vê

- **Vendas** (`/vendas`, só admin) ganha, no `PageHeader`, o botão primário **Importar vendas** (`Upload` + texto), antes de "Exportar CSV".
  - Vazio de hoje ("Sem vendas no período.") passa a: "Nenhuma venda neste período. Traga as vendas do seu sistema de caixa." + [Importar vendas].
  - A faixa âmbar "N lançamentos sem ficha técnica…" ganha o link **Ligar ao cardápio** (`/importar#ligacao-cardapio`).
- **Importar vendas:** `/vendas/importar`, só admin. Não entra no menu: é um passo de Vendas. Link "← Vendas" no alto. Loja: a rota direto
  recebe 403 da API e mostra o mesmo aviso das outras telas só de admin.
- **Importar Dados** (`/importar`): o botão "Vendas" sai do quadro "1. Tipo de arquivo" e vira uma linha logo abaixo dele:
  "Vendas agora se importam em **Vendas → Importar vendas**: planilha de qualquer sistema, XML de cupons ou PDF de relatório." [Ir para Importar vendas].
  O quadro "De-para do relatório de vendas" continua lá (o browser-check confere esse título; ver troca de texto sugerida na 4.3).
- **Cana:** `{ to: '/cana', label: 'Cana', icon: CupSoda, loja: <resposta 5> }`, logo depois de "Inventário" (é contagem e estoque, para a
  loja; perto do que ela já usa). No celular, a faixa de pílulas do topo já mostra os itens da loja; com "Cana" ali, ela aparece sem rolar
  (a loja tem hoje 5 itens).
  - Admin: `/cana?aba=semana|lancamentos|configuracao` (padrão `semana`). `&semana=<id da contagem final>` abre uma semana;
    `&ini=&fim=&tipo=` filtra os lançamentos.
  - Loja: `/cana` mostra só a visão de lançar; `?lancar=recebimento|producao|contagem` abre o formulário (o Voltar do navegador volta aos 3 botões).

---

## 2. Parte A: Importar vendas (`/vendas/importar`)

### 2.1 Forma geral

- Uma página só, em **3 passos**, sem trocar de rota (o arquivo e as escolhas vivem na memória da página):
  1. **Arquivo:** de qual sistema, que tipo, qual arquivo.
  2. **Colunas** (planilha), **Lendo os arquivos** (XML) ou **Conferir a leitura** (PDF).
  3. **Conferir e importar** (a prévia do servidor e o botão que grava).
- No alto, sob o título: "Passo 2 de 3 · Colunas" + barra `Progress` com `aria-label="Passo 2 de 3"`. Cada passo tem "← Voltar" (44 px), que
  volta sem perder o que foi escolhido.
- `PageHeader title="Importar vendas"`, sub: "Traga as vendas de outro sistema. Nada é gravado antes de você conferir."
- **Saída sem importar:** com arquivo escolhido e ainda não importado, fechar ou recarregar a aba pede confirmação do navegador
  (`beforeunload`). O texto do navegador é fixo; a tela mostra, sob o botão fixo, a linha "Nada foi gravado ainda. Se sair, o arquivo e as
  escolhas se perdem." Ver o ponto 7.10 (não há onde guardar rascunho).
- **Celular:** uma coluna; a ação do passo fica numa barra fixa embaixo (`fixed inset-x-0 bottom-0`, `pb-[env(safe-area-inset-bottom)]`,
  como a do Inventário), com a página em `pb-28` e `scroll-padding-bottom` da altura da barra (o campo com foco nunca fica atrás dela).
  **Computador:** o mesmo botão no fim do conteúdo, sem barra fixa; a prévia em 2 colunas (números à esquerda, avisos e produtos à direita).

### 2.2 Passo 1: Arquivo

**"De qual sistema vêm as vendas?"** (`role="radiogroup"`). Um cartão por sistema (a linha inteira é o alvo, ≥ 56 px):

- linha 1: nome do sistema ("PDV Valinhos");
- linha 2, em cinza: o tipo de arquivo de sempre e a memória: "Planilha · colunas lembradas · última importação em 20/11";
  sem colunas lembradas: "Planilha · colunas ainda não escolhidas"; XML: "XML · última importação em 03/11"; nunca usado: "ainda não usado";
- marcado: borda + `CheckCircle2` + texto, não só cor.

Ordem: o último usado primeiro, **já marcado**; depois os outros ativos, pelo nome; por último **Planilha padrão do Comanda**, com a linha
"as colunas de sempre: pedido;data;hora;produto_relatorio;…". Sistemas parados não aparecem (ficam em "Editar sistemas").

Sob a lista, dois links de 44 px: **+ Novo sistema** e **Editar sistemas**.

**+ Novo sistema** abre um bloco no lugar dos links (não é modal):

| Campo | Rótulo e ajuda | Erro (no blur ou no Criar) |
|---|---|---|
| Nome | "Como você chama esse sistema?" · ajuda: "Ex.: PDV do balcão, iFood, Sistema da loja 2." | vazio: "Dê um nome ao sistema." · 409 `ORIGEM_REPETIDA`: "Já existe um sistema chamado “PDV Valinhos”. Escolha ele na lista ou use outro nome." |
| Tipo de arquivo de sempre | "Que arquivo esse sistema exporta?" · Planilha (CSV ou Excel) · XML (cupons) · PDF (relatório) · nenhum vem marcado | "Escolha o tipo de arquivo." |
| Letras antes do pedido (opcional, em `<details>` "Mais opções") | "Use se este sistema pode ter o mesmo número de pedido que outro. Ex.: IF- faz o pedido 1001 virar IF-1001." · até 10 letras | "Use até 10 letras." |

Botões: **Criar o sistema** (primário) · **Cancelar** (texto). Criado: o sistema entra na lista já marcado, e o foco vai para "Que tipo de
arquivo?". Toast: "Sistema “iFood” criado."

**Editar sistemas** abre um `Sheet` (de baixo no celular, do lado no computador) com a lista, e cada sistema com: Nome · Letras antes do pedido ·
"Os números vêm com vírgula ou ponto?" · **Parar de usar este sistema** / **Voltar a usar** (os sistemas nunca são apagados). Ajuda, ao parar:
"As vendas que vieram dele continuam. Ele só sai da lista." Salvar: toast "Sistema salvo."
Estados do `Sheet`: carregando = 3 `Skeleton`; erro ao carregar = "Não consegui ver os sistemas agora." [Tentar de novo]; erro ao salvar =
caixa vermelha acima do botão com a frase do servidor (ex.: `ORIGEM_REPETIDA`), o que foi digitado fica, e o `Sheet` não fecha.

**"Que tipo de arquivo?"** (`role="radiogroup"`; 3 cartões em coluna no celular, em linha no computador; já vem marcado o tipo de sempre do sistema):

- **Planilha**: "CSV ou Excel, de qualquer sistema";
- **XML**: "cupons fiscais: vários arquivos ou o .zip do mês";
- **PDF**: "relatório impresso do sistema, lido pela inteligência artificial (IA)".

Ajuda fixa sob os cartões: "Prefira o XML: é exato e o Comanda reconhece cupom repetido ou cancelado. A planilha vem em seguida. O PDF é lido
pela IA e você confere linha a linha." Com a **Planilha padrão do Comanda**, só "Planilha" fica disponível (as outras duas em cinza, com a
frase "A planilha padrão só aceita planilha.").

**Arquivo.** O botão do arquivo é a ação do passo (na barra fixa do celular):

| Tipo | Rótulo do botão | `accept` | Ajuda sob o botão |
|---|---|---|---|
| Planilha | **Escolher a planilha** | `.csv,.xlsx,.xls,.txt` | "CSV separado por ponto e vírgula, vírgula ou tabulação, ou Excel." |
| XML | **Escolher os arquivos XML ou o .zip** | `.xml,.zip,text/xml,application/zip` (`multiple`) | "Pode escolher vários .xml de uma vez, ou o .zip que o sistema gera para o contador." |
| PDF | **Escolher o PDF** | `.pdf,application/pdf` | "Um PDF de até 10 MB. Relatório de um dia lê melhor do que o do mês." |

Escolher o arquivo **já começa** a leitura e leva ao passo 2 (como na Entrada de Notas). Por isso a ajuda sob o botão termina sempre com
"Ao escolher, o Comanda já lê o arquivo e mostra o próximo passo." (WCAG 3.2.2, seção 5). Planilha com colunas lembradas e todas presentes, ou
Planilha padrão: pula o passo 2 e vai direto à prévia; o passo 2 fica disponível pelo link "Ver as colunas" no passo 3.

**Erros de leitura do arquivo** (caixa vermelha sob o botão, `role="alert"`, foco nela; o botão continua para escolher outro):

| Caso | Texto |
|---|---|
| Planilha vazia ou só cabeçalho | "Esta planilha não tem linhas de venda. Confira se exportou o período certo." |
| Arquivo que não é do tipo escolhido | "Este arquivo não é uma planilha (CSV ou Excel). Escolha outro arquivo ou troque o tipo acima." (o mesmo com XML e PDF) |
| .zip com senha ou que o leitor não abre | "Não consigo abrir este .zip. Exporte os XML sem senha, ou descompacte e escolha os .xml soltos." |
| Navegador sem leitor de .zip | "Este navegador não abre .zip. Descompacte o arquivo no computador e escolha os .xml (dá para marcar todos de uma vez com Ctrl+A na pasta)." |
| .zip acima do teto | "Este .zip passa do limite (5.000 arquivos ou 100 MB). Exporte um mês de cada vez, ou menos." |
| PDF acima de 10 MB | "O PDF tem 14 MB, e o limite é 10 MB. Exporte um período menor." |

**Últimas importações de vendas** (`Panel` no fim do passo 1; 5 linhas; cartão no celular, tabela no computador):
"20/11 às 18h10 · PDV Valinhos · planilha · vendas-novembro.csv · 2.301 vendas novas · por Diego". Serve para responder "já importei isso?"
sem abrir Vendas. Vazio: "Nenhuma importação de vendas ainda." Ver o ponto 7.7.

### 2.3 Passo 2: Colunas (planilha)

Título do passo: "Qual coluna do arquivo é o quê?". Sub: "vendas-novembro.csv · 2.540 linhas · O Comanda sugeriu as colunas pelos nomes. Confira."

**Um bloco por informação do Comanda.** No celular, um cartão por campo; no computador, uma tabela (Informação · Coluna do arquivo · Exemplos do arquivo).

| Informação | Obrigatória? | Ajuda curta (sob o rótulo) |
|---|---|---|
| Data | sim | "Se a data vier com a hora (24/11/2026 14:30), a hora é aproveitada." |
| Produto | sim | "O nome do produto como está no relatório." |
| Quantidade | sim | — |
| Valor total | sim | "O valor da linha (quantidade × preço, já com desconto), não o total do pedido." |
| Pedido | recomendada | "Número do pedido, comanda ou cupom. Sem ele, cada dia vira um pedido só." |
| Hora | não | — |
| Preço unitário · Desconto · Taxa de serviço · Taxa de entrega | não | ficam em `<details>` "Outras colunas (opcional)", que abre sozinho se o Comanda sugeriu alguma |

Cada bloco:

- rótulo visível ("Produto", com "obrigatória" em texto, não só asterisco);
- `<select>` nativo `h-11` com `aria-label="Coluna do arquivo para Produto"`: as colunas do arquivo, na ordem do arquivo; nos opcionais, a
  1ª opção é "— o arquivo não tem —";
- sugerida pelo Comanda: `Tag gold` "sugerida", até a pessoa mexer;
- "Exemplos: Caldo 300 ml · Pastel de carne · Caldo 500 ml" (as 3 primeiras linhas não vazias daquela coluna, como estão no arquivo);
- coluna já usada em outro campo: a opção aparece como "Total (já usada em Valor total)"; escolher assim mesmo é permitido, com a linha
  âmbar "A mesma coluna está em Valor total e Preço unitário. Confira.";
- coluna lembrada que sumiu do arquivo novo: âmbar `CircleAlert`, "A coluna “Qtde” não está neste arquivo. Escolha outra." e o select vazio.

**"Como os valores estão escritos?"** (`role="radiogroup"`; já vem marcado o que está salvo no sistema, ou o que o Comanda deduziu do
arquivo): **Com vírgula: 1.234,56** · **Com ponto: 1,234.56**. Sob as opções, o exemplo do próprio arquivo: "No arquivo: 12,90 · 1.250,00".

**Lembrar** (`Checkbox`, já marcado): "Lembrar estas colunas para PDV Valinhos". Ajuda: "Na próxima importação deste sistema, a prévia abre direto."
Na Planilha padrão do Comanda o passo 2 não aparece.

**Sem pedido** (a coluna Pedido em "— o arquivo não tem —"): caixa neutra fixa sob o bloco "Pedido": "Sem número de pedido, cada dia vira um
pedido só. Em Vendas, “Pedidos” e “Ticket médio” vão contar 1 por dia para este sistema."

**Botão do passo:** **Ver a prévia**. Fica `aria-disabled` (nunca `disabled` mudo) quando falta coluna obrigatória e diz o que falta:
"Escolha a coluna de: Data, Produto". O toque leva ao 1º campo que falta e põe o foco nele. 400 `MAPEAMENTO_INCOMPLETO` do servidor
aparece na mesma caixa, com a frase do servidor.

### 2.4 Passo 2: Lendo os arquivos (XML)

Sem nada para escolher: a tela só mostra o andamento e segue sozinha para a prévia.

- "Lendo 1.234 de 1.515 arquivos…" + `Progress` (`aria-valuenow`), anúncio `aria-live="polite"` só a cada 25% ("Metade dos arquivos lida.").
- Sob a barra: "A leitura acontece neste aparelho. Não feche a tela."
- Botão **Parar a leitura** (outline, 44 px): volta ao passo 1 sem nada lido.
- Acabou: "Conferindo com as vendas que já estão no Comanda…" (`Loader2` + texto) e a prévia aparece.
- Arquivo do .zip que não é .xml, pasta, ou XML ilegível: não para a leitura; entra na contagem de "ignorados" da prévia, com o motivo e o
  nome do arquivo.
- Sem CNPJ da loja salvo (400 `LOJA_SEM_CNPJ`): caixa vermelha no lugar da prévia: "Cadastre o CNPJ da empresa principal em Empresas antes
  de importar XML." [Ir para Empresas]. A frase do servidor já diz o que fazer; o botão leva lá.

### 2.5 Passo 2: Conferir a leitura (PDF)

**Lendo:** `Loader2` + "A IA está lendo o relatório (pode levar até 1 minuto)…" e, sob ela, "Você confere tudo antes de importar."
Sem botão de cancelar (a chamada não para no meio); o botão "← Voltar" fica desabilitado com o texto "Aguarde a leitura".

**Erros da leitura** (caixa vermelha, frase do servidor via `errMsg()` + o que fazer):

| Código | O que a tela mostra |
|---|---|
| sem chave de IA | a frase do servidor ("Leitura de PDF não configurada…") + "Use a planilha ou o XML do sistema." [Trocar para planilha] |
| sem crédito, IA fora | a frase do servidor + [Tentar de novo] [Trocar para planilha] |
| `PDF_ILEGIVEL` (inclui a resposta cortada) | a frase do servidor + "Relatório grande? Exporte um dia por vez, ou exporte em planilha." [Escolher outro PDF] |
| não é PDF | "Este arquivo não é um PDF. Escolha o relatório em PDF." |

**Conferência** (título "Confira o que a IA leu"):

- Caixa neutra no alto: "A IA pode errar. Compare com o relatório: produto, quantidade e valor de cada linha."
- O que a IA achou no cabeçalho, em uma linha (só o que veio): "Relatório do sistema “PDV X”, de 17/11 a 23/11."
- **Soma × total impresso** (logo abaixo, `aria-live="polite"`, recalcula a cada edição):
  - bate (diferença ≤ R$ 0,05): `CheckCircle2` "Soma das 84 linhas: R$ 1.234,50 · Total impresso no relatório: R$ 1.234,50. Batem.";
  - não bate: vermelho, `CircleAlert`, "Soma das 84 linhas: R$ 1.222,20 · Total impresso no relatório: R$ 1.234,50. Diferença de R$ 12,30:
    falta alguma linha ou algum valor saiu errado.";
  - sem total no relatório: neutro, "O relatório não mostra um total (ou a IA não achou). Confira linha a linha. Soma das 84 linhas: R$ 1.222,20."
  - A diferença **não barra** a importação (a regra do desenho só pede o aviso); o botão do passo ganha a frase "A soma não bate com o
    relatório" acima dele, para ninguém passar sem ver.
- **Data das vendas** (só se alguma linha veio sem data): campo de data obrigatório, rótulo "Data das vendas sem data (o relatório não traz
  por linha)". Nada vem preenchido. Se o relatório cobre mais de um dia (período lido com dias diferentes), âmbar: "As vendas entram todas
  em 23/11. Para ver por dia (e na semana da cana), importe um relatório por dia."
- **Linhas** (no celular, um cartão por linha; no computador, tabela com campos `h-11`):
  - Produto (texto, linha inteira) · Quantidade (`inputMode="decimal"`) · Valor (R$, `inputMode="decimal"`) · Data (só nas linhas que vieram com data);
  - linha que a IA não conseguiu ler inteira: borda âmbar + "Falta a quantidade. Digite ou tire a linha." (o mesmo para valor);
  - **Tirar esta linha** (texto, 44 px, `aria-label="Tirar a linha Caldo 300 ml"`): toast "Linha tirada." + **Desfazer** (8 s);
  - + **Acrescentar uma linha** no fim (a IA pulou uma): linha vazia com o foco no Produto.
- Erros no blur: "Digite a quantidade (maior que zero).", "Digite o valor (R$).", "Digite o nome do produto."
- **Botão do passo:** **Ver a prévia**. `aria-disabled` com o que falta: "Escolha a data das vendas" · "Corrija 2 linhas" (o toque leva à 1ª).

### 2.6 Passo 3: Conferir e importar (a prévia)

Título "Confira antes de importar". Sub: "PDV Valinhos · planilha · vendas-novembro.csv · **nada foi gravado ainda**".
Link "Ver as colunas" (planilha) ou "Ver a leitura" (PDF) volta ao passo 2.

**Carregando:** 4 `Skeleton` de cartão + "Conferindo com as vendas que já estão no Comanda…". **Erro:** caixa vermelha com a frase do
servidor + [Tentar de novo] + "← Voltar". A prévia **se refaz sozinha** (com a mesma tela, só os números piscando para `Skeleton`) quando a
pessoa muda o modo, marca um CNPJ ou uma nota fiscal (NF-e), ou salva letras antes do pedido.

**Ordem no celular** (de cima para baixo): (1) avisos que pedem decisão; (2) os números; (3) produtos ainda não ligados ao cardápio;
(4) o que fazer com as vendas que já existem (modo); (5) linhas com problema e amostra (recolhidas); (6) botão fixo.
**Computador:** números à esquerda; avisos, produtos e modo à direita; o botão no fim da coluna da direita.

#### 2.6.1 Os números (cada um com a conta e de onde veio)

Planilha e PDF (cartões `Stat`; a conta em `text-sm`, nunca em tooltip):

| Cartão | Número grande | Conta e origem (texto exato) |
|---|---|---|
| Vendas novas | 2.301 linhas | "= 2.540 linhas lidas − 120 que já estão no Comanda − 87 com problema − 32 somadas a outra linha igual do arquivo" |
| Total das vendas novas | R$ 12.345,60 | "= soma do valor das 2.301 linhas novas. As 120 que já existiam (R$ 640,00) não entram. Confira com o total do relatório do seu sistema para o mesmo período." |
| Período | 01/11 a 23/11 | "= a primeira e a última data das linhas válidas do arquivo (23 dias)" |
| Pedidos e itens | 1.120 pedidos · 3.402 itens | "Pedidos = números de pedido diferentes; itens = soma das quantidades." Sem coluna de pedido: "1 pedido por dia (o arquivo não tem número de pedido)." |

XML (no lugar do primeiro cartão; os outros três iguais):

| Cartão | Número grande | Conta e origem |
|---|---|---|
| Cupons de venda novos | 1.480 cupons | "= 1.515 arquivos lidos − 12 já importados antes − 3 emitidos pelo próprio Comanda − 3 cancelados (a venda e o cancelamento vieram juntos) − 5 arquivos de cancelamento − 9 ignorados − 3 notas fiscais (NF-e) fora da importação" |
| Cancelamentos de cupons já importados | 2 cupons | "Cancelados depois de importados: saem das vendas 3 linhas (R$ 87,50)." (só aparece se houver) |

#### 2.6.2 Avisos e estados da prévia (todos os casos)

Cada aviso é uma caixa com ícone + título curto em negrito + texto + ação. Tom: âmbar (`TriangleAlert`, `role="status"`) quando informa ou
pede uma marcação; vermelho (`CircleAlert`, `role="alert"`) quando algo vai ser apagado. Os avisos que pedem decisão vêm primeiro.

| # | Caso (regra do desenho) | Tom | Texto exato | Ação |
|---|---|---|---|---|
| P1 | Período com vendas de outro lugar (R5) | âmbar | **"Pode contar em dobro."** "De 01/11 a 23/11 já há vendas vindas de outro lugar: Planilha padrão do Comanda: 1.230 vendas, R$ 34.500,00 · Cupons do próprio Comanda: 12 vendas, R$ 450,00. Se for o mesmo caixa, estas vendas vão entrar duas vezes (no faturamento, no estoque e na cana)." | `Checkbox` obrigatória: "São vendas diferentes (outro caixa ou canal, como iFood); importar mesmo assim" · link "Ver as vendas do período" (abre `/vendas?ini=&fim=` em nova aba) |
| P2 | Substituir escolhido (R3) | vermelho | **"Vai apagar vendas."** "Vai apagar 1.980 vendas (R$ 30.100,00) de PDV Valinhos entre 01/11 e 23/11 e pôr as do arquivo no lugar. As vendas de outros sistemas, de XML e dos cupons do Comanda não são tocadas." | o botão final muda (2.7) e pede o diálogo |
| P3 | Arquivo já importado antes (R7) | âmbar | **"Este arquivo já foi importado."** "Em 20/11 por Diego (2.301 vendas). As vendas repetidas não entram de novo: só as novas." | nenhuma (não barra) |
| P4 | Linhas que já existem vindas de outro sistema (R1) | âmbar | **"120 linhas já estão no Comanda e não entram."** "100 deste mesmo sistema (importadas antes) e 20 vindas de PDV Centro. Exemplo: o pedido 1001 de 20/11 já existe vindo de PDV Centro. Se forem vendas diferentes, defina letras antes do pedido para este sistema." | [Definir letras antes do pedido] (abre o sistema em "Editar sistemas"; ao salvar, a prévia se refaz) |
| P5 | Linhas que já existem, todas do mesmo sistema | neutro | "120 linhas já estão no Comanda (importadas antes deste mesmo sistema) e não entram de novo." | — |
| P6 | Sem número de pedido e linhas "já existentes" no mesmo dia (risco 10) | âmbar | **"Parte do dia já foi importada."** "Sem número de pedido, cada dia vira um pedido só, e um 2º relatório do mesmo dia (ex.: almoço e jantar) aparece como já existente. Importe um relatório do dia inteiro, ou escolha Substituir para trocar o dia." | [Trocar as vendas deste sistema no período] (marca o modo Substituir) |
| P7 | Cupom cancelado neste envio (XML) | neutro | "3 cupons foram cancelados (a venda e o cancelamento vieram juntos): não entram." | — |
| P8 | Cancelamento de cupom importado antes (XML) | âmbar | **"Cupons cancelados depois de importados."** "2 cupons importados antes foram cancelados: ao importar, saem das vendas 3 linhas (R$ 87,50), de 05/11 a 12/11, e a baixa delas no estoque é desfeita." | — (entra no que o botão faz) |
| P9 | XML já importado antes (R2) | neutro | "12 cupons já foram importados antes: ficam como estão." | — |
| P10 | XML de cupom emitido pelo próprio Comanda (R2) | neutro | "3 cupons foram emitidos aqui no Comanda: já estão nas vendas e não entram de novo." | — |
| P11 | XML ignorados (A.4) | neutro, recolhido | "9 arquivos ignorados" (`<details>`), e dentro, um por motivo com a contagem: "4 · modo de teste da SEFAZ (não valem como venda)" · "2 · sem autorização da SEFAZ" · "1 · emitido por outro CNPJ (12.345.678/0001-90). Se for uma compra, use Entrada de Notas." · "2 · não é cupom de venda (outro tipo de arquivo)" · "inutilização", "denegado", "entrada", "devolução", "carta de correção" com a mesma forma. Cada motivo abre a lista dos nomes dos arquivos. | — |
| P12 | XML de outro CNPJ que está em Empresas (pergunta 12) | âmbar | **"Cupons de outra empresa sua."** "8 cupons foram emitidos por Cana Express Ltda (98.765.432/0001-10), cadastrada em Empresas. Eles só entram se forem vendas desta loja." | `Checkbox` desmarcada por CNPJ: "Incluir os 8 cupons de Cana Express Ltda" |
| P13 | Notas fiscais (NF-e, modelo 55) de saída | âmbar | **"3 notas fiscais (NF-e) ficaram de fora."** "Nota fiscal de saída pode ser venda, mas também remessa, transferência ou bonificação, que não são venda. Marque só as que são venda." | uma `Checkbox` desmarcada por nota: "NF-e 1-345 · 20/11 · R$ 1.200,00 · tipo de operação (CFOP): 5102" (com a explicação fixa: "CFOP é o código do tipo de operação. Pergunte ao contador quais códigos da sua loja são venda." Uma lista de códigos "de venda" só entra com o OK do contador: seção 6) |
| P14 | Linhas com problema | âmbar, recolhido | "87 linhas com problema ficam de fora" (`<details>`): "Linha 15: data inválida (31/02/2026)" · "Linha 40: quantidade zero" · "Linha 41: data no futuro (28/11/2026)". Até 200; acima: "e mais 12 linhas". | [Voltar às colunas] (planilha) / [Voltar à leitura] (PDF) |
| P15 | Nenhuma linha válida (`IMPORTACAO_VAZIA` ou válidas = 0) | vermelho | **"Nenhuma venda válida no arquivo."** + os 5 motivos mais comuns, com a contagem: "2.500 · data inválida" · "40 · quantidade vazia"… + "Quase sempre é a coluna errada: confira Data e Quantidade." | [Voltar às colunas] (primário); sem botão de importar |
| P18 | Só cancelamentos (XML): nenhum cupom novo, mas há cancelamento de cupom importado antes (risco 4) | âmbar | **"Nenhum cupom novo, só cancelamentos."** "2 cupons importados antes foram cancelados: ao confirmar, saem das vendas 3 linhas (R$ 87,50), de 05/11 a 12/11, e a baixa delas no estoque é desfeita." | botão **Tirar 2 cupons cancelados** (2.7; ponto 7.26) |
| P16 | Tudo já existe (novas = 0, sem problema e sem cancelamento a aplicar) | neutro, `CheckCircle2` | **"Nada novo para importar."** "As 2.301 vendas deste arquivo já estão no Comanda (importadas em 20/11)." | [Ver vendas do período] (primário); sem botão de importar |
| P17 | Venda com data no futuro (R6) | entra em P14 | "Linha 41: data no futuro (28/11/2026). Confira a coluna Data." | — |

#### 2.6.3 Produtos ainda não ligados ao cardápio

Título: "4 produtos novos, ainda não ligados ao cardápio". Ajuda: "Ligar ao cardápio faz a venda baixar o estoque pela ficha técnica e entrar
na conta da Cana (se o item levar caldo). Dá para ligar depois em Importar Dados."

Por produto (cartão no celular; linha de tabela no computador):

- nome como está no arquivo ("CALDO CANA 500ML"), e "12 linhas · R$ 340,00 no arquivo";
- `<select>` nativo `h-11`, rótulo "Item do cardápio": 1ª opção "Não ligar agora (não baixa estoque)", depois a sugestão (se houver), depois o
  cardápio em ordem alfabética. A sugestão vem **marcada**, com `Tag warn` "sugestão, confira";
- nome que parece de caldo ("cana", "caldo", "garapa", "frozen") e ficou em "Não ligar agora": linha âmbar "Parece produto de caldo: sem ligar
  ao cardápio, não entra na conta da Cana."

Sem produtos novos: o bloco não aparece. Mais de 10: os 10 com mais valor e "Ver os outros 14" (abre o resto no mesmo bloco).

#### 2.6.4 O que fazer com as vendas que já existem (só planilha e PDF)

`role="radiogroup"`, título "Vendas deste sistema que já estão no período":

- **Só acrescentar as novas** (marcado) · "As que já existem ficam como estão. É o mais seguro."
- **Trocar as vendas deste sistema no período (Substituir)** · "Apaga as vendas de PDV Valinhos entre a primeira e a última data do arquivo
  e importa as do arquivo. Use quando corrigiu o relatório no sistema."

XML: o bloco não aparece; no lugar, a linha "Com XML, cupom repetido nunca entra duas vezes e cupom cancelado sai sozinho: não há Substituir."
Na Planilha padrão do Comanda, o texto de "Trocar" diz "Apaga as vendas da planilha padrão…" (R4).

### 2.7 Importar (o botão, o diálogo, a espera e o resultado)

**O botão diz o que vai acontecer** (barra fixa no celular, com o resumo à esquerda: "2.301 vendas · R$ 12.345,60"):

| Situação | Rótulo | O toque |
|---|---|---|
| tudo certo | **Importar 2.301 vendas** | importa |
| com cancelamentos de importados | **Importar 1.480 cupons e tirar 2 cancelados** | importa |
| só cancelamentos (P18) | **Tirar 2 cupons cancelados** | aplica os cancelamentos |
| Substituir | **Substituir 1.980 vendas e importar 2.301** (estilo destrutivo) | abre o diálogo |
| P1 sem a caixa marcada | "Marque a caixa do aviso" (`aria-disabled`) | rola até a caixa e põe o foco nela |
| P15 / P16 | (sem botão de importar) | — |
| prévia desatualizada (mudou algo e a nova prévia ainda não voltou) | "Atualizando a prévia…" (`aria-disabled`) | nada |

**Diálogo do Substituir** (`AlertDialog`, foco inicial em "Voltar sem apagar"):

- Título: "Apagar 1.980 vendas de PDV Valinhos?"
- Texto: "As vendas de PDV Valinhos de 01/11 a 23/11 (R$ 30.100,00) saem, com as baixas de estoque delas, e entram as 2.301 do arquivo
  (R$ 12.345,60). Vendas de outros sistemas, de XML e dos cupons do Comanda ficam."
- Botões: **Voltar sem apagar** · **Apagar e importar** (destrutivo).

**Importando:** o botão vira `Loader2` + "Importando 2.301 vendas…" (`aria-busy`), a tela inteira fica só leitura e aparece a linha
"Pode levar até 1 minuto. Não feche a tela." Trava de toque duplo por `ref` (como "Dar entrada"). A `chave_idempotencia` nasce quando a
prévia aparece e só é trocada se a prévia for refeita.

**Falhas no importar:**

| Caso | O que a tela faz |
|---|---|
| sem resposta do servidor (rede, 502, 504) | caixa âmbar, foco nela: "Não consegui falar com o servidor. As vendas podem ter sido importadas ou não. Tentar de novo não importa em dobro." [Tentar de novo] (mesma chave e mesmo corpo) · [Ver vendas do período] |
| 409 `IMPORTACAO_JA_CONFIRMADA` (2º toque, ou "Tentar de novo" depois de uma ida que deu certo) | trata como sucesso: mostra o resultado da 1ª (ponto 7.5) com a linha "Esta importação já tinha sido feita às 18h10." |
| 409 `IMPORTACAO_SOBREPOSICAO` (entrou venda de outro lugar entre a prévia e o importar) | refaz a prévia sozinha e mostra no alto: "Entraram vendas de outro lugar neste período desde a prévia. Confira o aviso e marque a caixa." |
| outro 4xx | caixa vermelha com a frase do servidor; a prévia continua na tela |

**Resultado** (substitui a prévia; foco no título; `role="status"`). Os números são os da **resposta do importar**, não os da prévia (risco 9):

```text
(v) Vendas importadas
2.301 vendas novas (R$ 12.345,60), de 01/11 a 23/11, de PDV Valinhos.
· 120 já existiam e foram ignoradas.
· 1.980 vendas antigas de PDV Valinhos apagadas (Substituir).      (só se houve)
· 2 cupons cancelados retirados (3 linhas, R$ 87,50).               (só se houve)
· 4 produtos novos sem ligação ao cardápio: não baixam estoque.     [Ligar agora]
· Colunas lembradas para PDV Valinhos.                              (só se marcou)
[ Ver vendas do período ]   Importar outro arquivo
```

- Números diferentes da prévia: âmbar sob o título, "Os números mudaram desde a prévia (outra importação no meio): entraram 2.290, não 2.301."
- **Ver vendas do período** abre `/vendas?ini=2026-11-01&fim=2026-11-23` (ponto 7.8). **Ligar agora** abre `/importar#ligacao-cardapio`.
- **Importar outro arquivo** volta ao passo 1 com o mesmo sistema marcado.
- Toast curto ao mesmo tempo (para quem rolou a tela): "2.301 vendas importadas."

### 2.8 Estados da tela (resumo)

| Estado | Onde | Forma |
|---|---|---|
| Carregando a lista de sistemas | passo 1 | 3 `Skeleton` de cartão |
| Erro ao carregar os sistemas | passo 1 | "Não consegui ver os sistemas agora. Toque em Tentar de novo." [Tentar de novo]; o tipo "Planilha padrão" continua disponível |
| Nenhum sistema criado | passo 1 | a lista mostra só "Planilha padrão do Comanda" + a frase "Vai importar de outro sistema? Crie ele uma vez: o Comanda lembra as colunas." [+ Novo sistema] |
| Lendo | passo 2 | planilha: instantâneo (sem tela); XML: barra com "Lendo 1.234 de 1.515 arquivos…"; PDF: "A IA está lendo o relatório (pode levar até 1 minuto)…" |
| Conferindo | passo 3 | `Skeleton` + "Conferindo com as vendas que já estão no Comanda…" |
| Vazio | passo 3 | P15 ou P16 |
| Erro | qualquer | caixa com a frase do servidor + o que fazer + [Tentar de novo] |
| Sucesso | resultado | 2.7 |

### 2.9 Esboços da parte A (celular 360 px; computador onde indicado)

**A1. Passo 1, sistema já usado (celular).** Toques da meta de 4: Importar vendas (em Vendas) · Escolher a planilha · o arquivo no seletor ·
(prévia abre sozinha, A5) · Importar 2.301 vendas.

```text
┌────────────────────────────────────┐
│ ← Vendas                           │
│ Importar vendas                    │
│ Traga as vendas de outro sistema.  │
│ Nada é gravado antes de você       │
│ conferir.                          │
│ Passo 1 de 3 · Arquivo             │
│ ████████░░░░░░░░░░░░░░░░░░░░░░░    │
│ DE QUAL SISTEMA VÊM AS VENDAS?     │
│ ┌────────────────────────────────┐ │
│ │ (v) PDV Valinhos               │ │
│ │ Planilha · colunas lembradas · │ │
│ │ última importação em 20/11     │ │
│ ├────────────────────────────────┤ │
│ │ ( ) iFood                      │ │
│ │ PDF · última importação 03/11  │ │
│ ├────────────────────────────────┤ │
│ │ ( ) Planilha padrão do Comanda │ │
│ │ as colunas de sempre           │ │
│ └────────────────────────────────┘ │
│ + Novo sistema    Editar sistemas  │
│ QUE TIPO DE ARQUIVO?               │
│ ┌────────────────────────────────┐ │
│ │ (v) Planilha                   │ │
│ │ CSV ou Excel, de qualquer      │ │
│ │ sistema                        │ │
│ ├────────────────────────────────┤ │
│ │ ( ) XML                        │ │
│ │ cupons: vários ou o .zip do mês│ │
│ ├────────────────────────────────┤ │
│ │ ( ) PDF                        │ │
│ │ relatório, lido pela IA        │ │
│ └────────────────────────────────┘ │
│ Prefira o XML: é exato e reconhece │
│ cupom repetido ou cancelado.       │
│ ÚLTIMAS IMPORTAÇÕES DE VENDAS      │
│ 20/11 18h10 · PDV Valinhos ·       │
│ planilha · 2.301 novas · Diego     │
├────────────────────────────────────┤
│ CSV (; , ou tab) ou Excel          │
│ [     Escolher a planilha        ] │
└────────────────────────────────────┘
```

**A2. Passo 2, Colunas (celular).** Um cartão por informação; obrigatória em texto.

```text
┌────────────────────────────────────┐
│ ← Voltar   Passo 2 de 3 · Colunas  │
│ Qual coluna do arquivo é o quê?    │
│ vendas-novembro.csv · 2.540 linhas │
│ O Comanda sugeriu pelos nomes.     │
│ Confira.                           │
│ ┌────────────────────────────────┐ │
│ │ Data · obrigatória   [sugerida]│ │
│ │ [ Data/Hora                 ▾ ]│ │
│ │ Exemplos: 01/11/2026 11:32 ·   │ │
│ │ 01/11/2026 11:40 · 01/11/2026  │ │
│ │ A hora é aproveitada.          │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ Produto · obrigatória          │ │
│ │ [ Descrição                 ▾ ]│ │
│ │ Exemplos: Caldo 300 ml ·       │ │
│ │ Pastel de carne · Caldo 500 ml │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ Quantidade · obrigatória       │ │
│ │ (!) A coluna “Qtde” não está   │ │
│ │ neste arquivo. Escolha outra.  │ │
│ │ [ — escolha —               ▾ ]│ │
│ └────────────────────────────────┘ │
│ … Valor total, Pedido, Hora …      │
│ ▸ Outras colunas (opcional)        │
│ COMO OS VALORES ESTÃO ESCRITOS?    │
│ (v) Com vírgula: 1.234,56          │
│ ( ) Com ponto: 1,234.56            │
│ No arquivo: 12,90 · 1.250,00       │
│ [x] Lembrar estas colunas para     │
│     PDV Valinhos                   │
├────────────────────────────────────┤
│ [ Escolha a coluna de: Quantidade ]│
└────────────────────────────────────┘
```

**A3. Passo 2, Colunas (computador, 1280 px).**

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Voltar    Passo 2 de 3 · Colunas                                               │
│ Qual coluna do arquivo é o quê?   vendas-novembro.csv · 2.540 linhas             │
├──────────────────────┬───────────────────────────┬───────────────────────────────┤
│ Informação           │ Coluna do arquivo         │ Exemplos do arquivo           │
├──────────────────────┼───────────────────────────┼───────────────────────────────┤
│ Data (obrigatória)   │ [ Data/Hora           ▾ ] │ 01/11/2026 11:32 · 01/11 …    │
│ Produto (obrigatória)│ [ Descrição           ▾ ] │ Caldo 300 ml · Pastel de …    │
│ Quantidade (obrig.)  │ [ Qtde                ▾ ] │ 1 · 2 · 1                     │
│ Valor total (obrig.) │ [ Vl. Total           ▾ ] │ 12,90 · 25,80 · 9,00          │
│ Pedido (recomendada) │ [ Nº Venda            ▾ ] │ 1001 · 1001 · 1002            │
│ Hora                 │ [ — o arquivo não tem — ] │ (a hora vem na coluna Data)   │
├──────────────────────┴───────────────────────────┴───────────────────────────────┤
│ ▸ Outras colunas (opcional): preço unitário, desconto, taxa de serviço, entrega  │
│ Como os valores estão escritos?  (v) Com vírgula: 1.234,56   ( ) Com ponto        │
│ [x] Lembrar estas colunas para PDV Valinhos                       [ Ver a prévia ]│
└──────────────────────────────────────────────────────────────────────────────────┘
```

**A4. Passo 2, PDF: conferir a leitura (celular).**

```text
┌────────────────────────────────────┐
│ ← Voltar  Passo 2 de 3 · Conferir  │
│ Confira o que a IA leu             │
│ A IA pode errar. Compare com o     │
│ relatório: produto, quantidade e   │
│ valor de cada linha.               │
│ Relatório do “PDV X”, 23/11.       │
│ ┌────────────────────────────────┐ │
│ │ (!) Soma das 84 linhas:        │ │
│ │ R$ 1.222,20 · Total impresso:  │ │
│ │ R$ 1.234,50. Diferença de      │ │
│ │ R$ 12,30: falta alguma linha   │ │
│ │ ou algum valor saiu errado.    │ │
│ └────────────────────────────────┘ │
│ Data das vendas sem data           │
│ [ dd/mm/aaaa                    ]  │
│ ┌────────────────────────────────┐ │
│ │ Produto                        │ │
│ │ [ Caldo de cana 300 ml       ] │ │
│ │ Quantidade      Valor (R$)     │ │
│ │ [ 38         ]  [ 266,00     ] │ │
│ │                Tirar esta linha│ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ Produto                        │ │
│ │ [ Frozen 400 ml              ] │ │
│ │ Quantidade      Valor (R$)     │ │
│ │ [            ]  [ 180,00     ] │ │
│ │ (!) Falta a quantidade. Digite │ │
│ │ ou tire a linha.               │ │
│ │                Tirar esta linha│ │
│ └────────────────────────────────┘ │
│ + Acrescentar uma linha            │
├────────────────────────────────────┤
│ A soma não bate com o relatório    │
│ [ Escolha a data das vendas      ] │
└────────────────────────────────────┘
```

**A5. Passo 3, prévia da planilha com venda de outro lugar e produto novo (celular).** Toques: marcar a caixa (+1) · Importar.

```text
┌────────────────────────────────────┐
│ ← Voltar   Passo 3 de 3 · Conferir │
│ Confira antes de importar          │
│ PDV Valinhos · planilha ·          │
│ vendas-novembro.csv · nada foi     │
│ gravado ainda · Ver as colunas     │
│ ┌────────────────────────────────┐ │
│ │ /!\ Pode contar em dobro.      │ │
│ │ De 01/11 a 23/11 já há vendas  │ │
│ │ de outro lugar:                │ │
│ │ · Planilha padrão do Comanda:  │ │
│ │   1.230 vendas, R$ 34.500,00   │ │
│ │ · Cupons do próprio Comanda:   │ │
│ │   12 vendas, R$ 450,00         │ │
│ │ Se for o mesmo caixa, estas    │ │
│ │ vendas vão entrar duas vezes.  │ │
│ │ [ ] São vendas diferentes      │ │
│ │     (outro caixa ou canal);    │ │
│ │     importar mesmo assim       │ │
│ │ Ver as vendas do período       │ │
│ └────────────────────────────────┘ │
│ VENDAS NOVAS                       │
│ 2.301 linhas                       │
│ = 2.540 lidas − 120 que já estão   │
│ no Comanda − 87 com problema − 32  │
│ somadas a outra linha igual        │
│ TOTAL DAS VENDAS NOVAS             │
│ R$ 12.345,60                       │
│ = soma das 2.301 linhas novas. As  │
│ 120 que já existiam (R$ 640,00)    │
│ não entram. Confira com o total do │
│ seu sistema no mesmo período.      │
│ PERÍODO  01/11 a 23/11             │
│ = primeira e última data válidas   │
│ 4 PRODUTOS NOVOS, AINDA NÃO        │
│ LIGADOS AO CARDÁPIO                │
│ CALDO CANA 500ML                   │
│ 12 linhas · R$ 340,00              │
│ Item do cardápio                   │
│ [ Caldo de cana 500 ml        ▾ ]  │
│ [sugestão, confira]                │
│ VENDAS DESTE SISTEMA NO PERÍODO    │
│ (v) Só acrescentar as novas        │
│ ( ) Trocar as vendas deste sistema │
│     no período (Substituir)        │
│ ▸ 87 linhas com problema ficam de  │
│   fora                             │
│ ▸ Ver 20 linhas como vão entrar    │
├────────────────────────────────────┤
│ 2.301 vendas · R$ 12.345,60        │
│ [   Marque a caixa do aviso      ] │
└────────────────────────────────────┘
```

**A6. Passo 3, prévia do XML (celular, só o que muda).**

```text
│ CUPONS DE VENDA NOVOS              │
│ 1.480 cupons                       │
│ = 1.515 arquivos lidos − 12 já     │
│ importados − 3 do próprio Comanda  │
│ − 3 cancelados − 5 de cancelamento │
│ − 9 ignorados − 3 notas fiscais    │
│ ┌────────────────────────────────┐ │
│ │ /!\ Cupons cancelados depois   │ │
│ │ de importados. 2 cupons saem   │ │
│ │ das vendas: 3 linhas,          │ │
│ │ R$ 87,50, de 05/11 a 12/11.    │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ /!\ 3 notas fiscais (NF-e)     │ │
│ │ ficaram de fora. Pode ser      │ │
│ │ venda, remessa, transferência  │ │
│ │ ou bonificação. Marque só as   │ │
│ │ que são venda.                 │ │
│ │ [ ] NF-e 1-345 · 20/11 ·       │ │
│ │     R$ 1.200,00 · CFOP 5102    │ │
│ │ [ ] NF-e 1-346 · 21/11 ·       │ │
│ │     R$ 300,00 · CFOP 5152      │ │
│ │ CFOP é o código do tipo de     │ │
│ │ operação. Na dúvida, pergunte  │ │
│ │ ao contador.                   │ │
│ └────────────────────────────────┘ │
│ ▸ 9 arquivos ignorados             │
│ Com XML, cupom repetido nunca entra│
│ duas vezes e cancelado sai sozinho.│
├────────────────────────────────────┤
│ 1.480 cupons · R$ 45.678,90        │
│ [Importar 1.480 cupons e tirar 2 ] │
│ [cancelados                      ] │
└────────────────────────────────────┘
```

**A7. Passo 3, prévia no computador (1280 px).**

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Voltar   Passo 3 de 3 · Conferir      PDV Valinhos · planilha · nada gravado    │
├────────────────────────────────────────┬─────────────────────────────────────────┤
│ VENDAS NOVAS          TOTAL            │ /!\ Pode contar em dobro. (P1)          │
│ 2.301 linhas          R$ 12.345,60     │ [ ] São vendas diferentes…              │
│ = 2.540 − 120 − 87    = soma das 2.301 │                                         │
│   − 32                  linhas novas…  │ 4 produtos novos, ainda não ligados     │
│ PERÍODO               PEDIDOS E ITENS  │ CALDO CANA 500ML  12 lin. R$ 340,00     │
│ 01/11 a 23/11         1.120 · 3.402    │   [ Caldo de cana 500 ml ▾ ] sugestão  │
│                                        │ PASTEL QJ         …                     │
│ ▸ 87 linhas com problema               │ Vendas deste sistema no período         │
│ ▸ Ver 20 linhas como vão entrar        │ (v) Só acrescentar  ( ) Substituir      │
│                                        │               [ Marque a caixa do aviso]│
└────────────────────────────────────────┴─────────────────────────────────────────┘
```

**A8. Resultado (celular).** Ver o texto na 2.7.

**A9. Computador (≥ `md`), tela a tela.** O que não tem esboço próprio acima segue esta tabela; nada muda de texto, só de lugar.

| Tela | Como fica no computador |
|---|---|
| Passo 1 | 2 colunas: à esquerda "De qual sistema…" (cartões); à direita "Que tipo de arquivo?" (3 cartões em linha) e o botão do arquivo logo abaixo, sem barra fixa. "Últimas importações de vendas" embaixo, em tabela de largura inteira (Data e hora · Sistema · Tipo · Arquivo · Vendas novas · Quem) |
| Novo sistema / Editar sistemas | o bloco do novo sistema abre sob a lista, com os 3 campos em linha; "Editar sistemas" é `Sheet` do lado direito (`sm:max-w-md`) |
| Lendo os XML | `Panel` centralizado (`max-w-xl`) com a barra, a frase e "Parar a leitura" |
| Conferir a leitura (PDF) | esboço A10 |
| Prévia | esboço A7 |
| Diálogo do Substituir | `AlertDialog` centralizado (`max-w-md`), botões lado a lado, "Voltar sem apagar" à esquerda |
| Resultado | `Panel` de `max-w-2xl` com o texto da 2.7 e os dois botões lado a lado |

**A10. Passo 2, PDF: conferir a leitura (computador).**

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ ← Voltar   Passo 2 de 3 · Conferir a leitura          Relatório do “PDV X”, 23/11 │
│ A IA pode errar. Compare com o relatório: produto, quantidade e valor de cada     │
│ linha.                                                                           │
│ (!) Soma das 84 linhas: R$ 1.222,20 · Total impresso: R$ 1.234,50 · Diferença de │
│     R$ 12,30: falta alguma linha ou algum valor saiu errado.                     │
│ Data das vendas sem data [ dd/mm/aaaa ]                                          │
├────┬──────────────────────────────┬────────────┬──────────────┬──────────────────┤
│ Nº │ Produto                      │ Quantidade │ Valor (R$)   │                  │
├────┼──────────────────────────────┼────────────┼──────────────┼──────────────────┤
│ 1  │ [ Caldo de cana 300 ml     ] │ [ 38     ] │ [ 266,00   ] │ Tirar esta linha │
│ 2  │ [ Frozen 400 ml            ] │ [        ] │ [ 180,00   ] │ Tirar esta linha │
│    │ (!) Falta a quantidade. Digite ou tire a linha.                             │
├────┴──────────────────────────────┴────────────┴──────────────┴──────────────────┤
│ + Acrescentar uma linha                     A soma não bate com o relatório      │
│                                                       [ Escolha a data das vendas]│
└──────────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Parte B: Controle da cana (`/cana`)

### 3.1 Quem vê o quê (contagem cega)

| O que está na tela | Admin | Loja (só se a pergunta 5 for "a loja lança") |
|---|---|---|
| Item "Cana" no menu | sim | sim |
| Os 3 lançamentos | sim, com qualquer data até hoje | sim, só **Hoje** ou **Ontem** |
| Lista de lançamentos | todos, com quem lançou, os anulados e as correções | só os que **ela** lançou, dos últimos 7 dias |
| Anular e corrigir | sim | não ("Errou um número? Avise o gerente: só ele corrige.") |
| Semana (as contas) | sim | **nunca** |
| Configuração (ml, frozen, esperado) | sim | **nunca** |

- **Contagem cega:** a loja não vê nada calculado: nem o que deveria ter sobrado, nem o caldo vendido, nem a contagem de outra pessoa. Vê só
  o que ela mesma digitou. Por isso a tela da loja **não usa** as palavras "perda", "vendido", "rendimento", "esperado", "sumiu" nem "L/DZ"
  (nem em ajuda, toast ou `aria-label`); o browser-check procura essas palavras (5.2).
- Se a resposta 5 for "só o admin lança": a loja não tem o item no menu; `/cana` direto mostra o aviso de tela só de admin; o admin lança
  pela aba Lançamentos (3.5), com o mesmo formulário.

### 3.2 Loja: a tela de lançar (celular 360 px)

- `PageHeader title="Cana"`, sub "Anote o que chegou, o que produziu e o que sobrou."
- **Três botões grandes** (a linha inteira, `min-h-[72px]`, 12 px entre eles, ícone à esquerda, título 18 px em negrito e uma linha de ajuda de 14 px):
  1. **Recebi cana** · "Chegou cana do fornecedor (em dúzias)"
  2. **Produzi caldo** · "Moeu cana e tirou caldo (em litros)"
  3. **Contagem do que sobrou** · "No fim do dia: cana e caldo que sobraram"
- **Seus lançamentos dos últimos 7 dias** (`<ul>`; o mais novo em cima). Por linha: ícone do tipo + "Recebi cana · 12 dúzias" e, embaixo,
  "hoje (24/11) · lançado às 14h05". Anulado: a quantidade riscada **e** a `Tag muted` "Anulado pelo gerente" (ponto 7.16). Corrigido:
  `Tag muted` "Corrigido pelo gerente". **Sem o motivo e sem o número novo:** o motivo é texto livre do gerente e pode trazer informação da
  conta da semana, e o número corrigido de uma contagem é justamente o que a contagem cega esconde.
  - Vazio: "Você ainda não lançou nada nos últimos 7 dias."
  - Carregando: 3 linhas `Skeleton`.
  - Erro: "Não consegui mostrar seus lançamentos agora. Lançar continua funcionando." [Tentar de novo]
- Pé da tela, em cinza: "Errou um número? Avise o gerente: só ele corrige."

### 3.3 Os três formulários (os mesmos para loja e admin)

**Comum aos três:**

- Abre no lugar dos botões (`?lancar=recebimento|producao|contagem`), com "← Voltar" e o título com o ícone do tipo. O Voltar do navegador
  volta aos 3 botões. Com algo digitado, "← Voltar" pergunta: "Sair sem lançar? O que você digitou se perde." [Continuar lançando] [Sair].
- **"Quando?"** (`role="radiogroup"`, 2 botões lado a lado, 48 px): **Hoje · 24/11** (marcado) e **Ontem · 23/11**. As datas vêm do
  servidor, não do relógio do celular (ponto 7.16). Admin: mais um botão **Outra data**, que abre um campo de data (máximo: hoje).
  A loja nunca vê campo de data: assim o erro `CANA_DATA_FORA` não acontece por digitação.
- **Campos de número:** rótulo em cima, `inputMode="decimal"`, `h-12`, texto 20 px, alinhado à direita, com a unidade escrita fora do
  campo ("dúzias", "litros"). Aceita "12", "12,5" e "0,5". Ao abrir o formulário, o foco vai para o 1º número (o teclado numérico já abre).
  "Enter" no último campo lança.
- **Dúzias** têm `[−]` e `[+]` de 48 px dos lados (passo 1; `aria-label="Menos uma dúzia"` / `"Mais uma dúzia"`). Litros não têm (quase
  sempre têm vírgula).
- **Erros** (no blur e no Lançar, junto do campo, `aria-describedby`): "Digite quantas dúzias chegaram." · "Use só números (ex.: 12 ou 12,5)."
  · "O número tem de ser maior que zero." (na contagem: "Não pode ser negativo. Não sobrou? Digite 0.").
- **O botão** (barra fixa embaixo) **diz o que vai ser gravado**: é a conferência (a loja não pode desfazer; ver o ponto 7.17). Sem o número:
  "Digite as dúzias" (`aria-disabled`; o toque põe o foco no campo).
- **Lançando:** `Loader2` + "Lançando…", trava de toque duplo.
- **Deu certo:** volta aos 3 botões com uma caixa verde no alto (`CheckCircle2`, `role="status"`, foco nela): "Lançado: 12 dúzias de cana
  recebidas em 24/11 (hoje), às 14h05." O lançamento novo aparece em cima da lista, marcado "agora". Sem toast (a caixa basta; dois avisos
  iguais confundem). A caixa some ao abrir outro formulário.
- **Falhas:**

  | Caso | Texto (caixa vermelha acima do botão; o que foi digitado fica) |
  |---|---|
  | sem resposta do servidor | **antes de pedir de novo**, a tela relê "Seus lançamentos" uma vez (sozinha, 3 s depois). Se o lançamento está lá (mesmo tipo, data e número, lançado por ela nos últimos 2 minutos), mostra a caixa verde "Lançado: …" como se tivesse dado certo. Se não está, ou a releitura também falha: "Não consegui lançar. Confira a internet e toque de novo em Lançar. O que você digitou continua aqui." Isso evita o recebimento em dobro com o que existe hoje; a solução certa é o ponto 7.13 (chave de repetição), e com ela a releitura sai |
  | `CANA_DATA_FORA` (virou o dia com a tela aberta) | "Virou o dia: agora hoje é 25/11. Escolha de novo: Hoje ou Ontem." (os botões de data se atualizam) |
  | `CANA_CONTAGEM_DO_DIA`, loja | "Já existe uma contagem em 24/11. Se ela está errada, avise o gerente: só ele corrige." (a frase do servidor manda anular, e a loja não pode: ponto 7.15) |
  | `CANA_CONTAGEM_DO_DIA`, admin | a frase do servidor + [Ver a contagem de 24/11] (abre Lançamentos filtrado, onde estão Anular e Corrigir) |
  | outro erro | a frase do servidor (`errMsg()`) |

**Recebi cana:**

| Campo | Rótulo e ajuda | Obrigatório |
|---|---|---|
| Quando? | Hoje · Ontem (admin: + Outra data) | sim (já marcado) |
| Dúzias | "Quantas dúzias chegaram?" · "Meia dúzia = 0,5." | sim, > 0 |
| Fornecedor | "Fornecedor (opcional)" · lista dos já usados (`<datalist>`), `autoComplete="off"` | não |
| Observação | link "+ Observação" abre um `Textarea` de 200 letras | não |

Botão: **Lançar 12 dúzias recebidas hoje** ("…recebidas ontem", "…recebidas em 20/11").

**Produzi caldo:**

| Campo | Rótulo e ajuda | Obrigatório |
|---|---|---|
| Quando? | Hoje · Ontem | sim |
| Litros | "Quantos litros de caldo saíram?" · "Meio litro = 0,5." | sim, > 0 |
| Dúzias moídas | "Quantas dúzias moeu? (opcional)" · "Se souber." | não |
| Observação | "+ Observação" | não |

Botão: **Lançar 25 litros produzidos hoje**.

**Contagem do que sobrou:**

- Caixa neutra no alto (depende da pergunta 6; texto da recomendação "fim do dia"): "Conte no fim do dia, depois de fechar. Se contar de
  manhã, antes de abrir, marque **Ontem**." Se a resposta for "na abertura", a caixa diz: "Conte de manhã, antes de abrir, e marque **Ontem**."
- Se a contagem do dia escolhido já foi lançada (por qualquer pessoa; ponto 7.15): caixa âmbar no lugar dos campos: "A contagem de hoje já
  foi lançada por Ana às 22h10. Se ela está errada, avise o gerente." O botão Ontem continua disponível.
- **Nenhum número de referência aparece:** nem a contagem anterior, nem o que entrou na semana.

| Campo | Rótulo e ajuda | Obrigatório |
|---|---|---|
| Quando? | Hoje · Ontem | sim |
| Dúzias de cana | "Dúzias de cana que sobraram" · "Não sobrou? Digite 0." | sim, ≥ 0 |
| Litros de caldo | "Litros de caldo que sobraram" · "Todo o caldo já pronto." (texto a confirmar com o Diego) | sim, ≥ 0 |
| Litros de frozen | "Litros de frozen pronto (se tiver)" · "Deixe em branco se não tiver." (só aparece se a pergunta 7 for "sobra frozen") | não |

Botão: **Lançar a contagem de hoje**. Acima dele, na barra fixa, o resumo do que vai ser gravado, para conferir antes do toque: "6 dúzias ·
5 litros de caldo" (com frozen digitado: "· 2 litros de frozen").

### 3.4 Admin: aba Semana

- `PageHeader title="Cana"`, sub "Rendimento e perda de caldo, de uma contagem até a seguinte." Abas: **Semana** · **Lançamentos** ·
  **Configuração** (`TabsList` em grade de 3 no celular, `h-auto min-h-11 whitespace-normal`).
- **Escolher a semana:** `<select>` nativo `h-11`, rótulo "Semana". Opções, da mais nova para a mais antiga:
  "Em andamento: desde a contagem de 24/11" · "18/11 a 24/11 (contagens de 17/11 e 24/11)" · "11/11 a 17/11 (contagens de 10/11 e 17/11)"…
  Abre na **última semana fechada** (a pergunta de segunda-feira é "como foi a semana?"). Ao lado, **← Anterior** e **Seguinte →**
  (44 px; `aria-label="Semana anterior: 11/11 a 17/11"`).
- **Cabeçalho da semana:** "Semana de 18/11 a 24/11" e, embaixo: "Da contagem de 17/11 (fim do dia) até a contagem de 24/11 (fim do dia).
  Entram os lançamentos e as vendas de 18/11 a 24/11." e "Calculada agora, com a configuração de hoje." (até existir a B6; depois:
  "Semana fechada por Diego em 25/11: os números não mudam.").
  As "semanas" vão de contagem a contagem: se a loja contou em dias irregulares, o título mostra os dias de verdade ("18/11 a 26/11 (9 dias)").

**Avisos** (faixa âmbar, `TriangleAlert`, um por linha, cada um com o link que resolve; vêm antes dos números):

| Aviso (B.3) | Texto exato | Link |
|---|---|---|
| vendas incompletas | "O caldo vendido está incompleto: as vendas só foram importadas até 21/11, e a semana vai até 24/11. Importe as vendas de 22/11 a 24/11 antes de olhar a perda." | [Importar vendas] |
| produto de caldo sem ml | "3 produtos que parecem de caldo foram vendidos e não estão configurados: Caldo 1 L, Frozen 700 ml, Garapa jarra. As vendas deles não entram no caldo vendido." | [Configurar os produtos] |
| venda de caldo sem item do cardápio | "Há vendas com nome de caldo que não estão ligadas ao cardápio: “CALDO CANA 500” (8 vendas). Elas não entram na conta." | [Ligar ao cardápio] |
| falta o rendimento do frozen | "Falta o rendimento do frozen. Os 40 frozen vendidos e os 2 L de frozen das contagens não entram nas contas." | [Informar o rendimento] |
| cana moída negativa | "A cana moída deu negativa (−2 dúzias): a contagem de 24/11 tem mais cana do que a de 17/11 mais o que foi recebido. Falta lançar um recebimento ou a contagem está errada." | [Ver os lançamentos da semana] |
| produção zero com venda | "Nenhuma produção lançada na semana, mas saíram 42,8 L de caldo em vendas. Falta lançar a produção?" | [Lançar produção] |

**Os números** (cartões: 2 colunas no computador, 1 no celular; número grande em 28 px; a conta embaixo, por extenso, em 14 px, nunca
escondida em tooltip). Exemplo de B.3 (números inventados):

| Ordem | Cartão | Número grande | A conta (texto exato) |
|---|---|---|---|
| 1 | **Rendimento da semana** | 4,28 L vendidos por dúzia | "= 42,8 L de caldo vendido ÷ 10 dúzias de cana moída" |
| 2 | **Perda de caldo** | 5,2 L | "= 3 L no início (contagem de 17/11) + 50 L produzidos − 42,8 L vendidos − 5 L no fim (contagem de 24/11). Positivo = caldo que sumiu." |
| 3 | **Cana moída** | 10 dúzias | "= 4 dúzias que sobraram (contagem de 17/11) + 12 dúzias recebidas (3 entregas, de 18/11 a 24/11) − 6 dúzias que sobraram (contagem de 24/11)" |
| 4 | **Caldo por dúzia na moagem** | 5,00 L por dúzia | "= 50 L produzidos ÷ 10 dúzias moídas" e, na 2ª linha: "Esperado: 5,50 L por dúzia → diferença: 50 − 10 × 5,5 = −5 L (−9,1% do esperado)". Sem o esperado: "Esperado: não informado." [Informar] |
| 5 | **Caldo produzido** | 50 L | "= soma de 6 produções, de 18/11 a 24/11" |
| 6 | **Caldo vendido** | 42,8 L | "= 30 L em copos + 12,8 L em frozen (ver Por produto) · vendas de 18/11 a 24/11, venham de onde vierem (planilha, XML, PDF ou cupom do Comanda) · vendas importadas até 24/11" |

- **No celular, uma parcela por linha** ("= 4 dúzias…", "+ 12 dúzias…", "− 6 dúzias…"): lê melhor e cada link ganha a própria linha.
- **Sob o Rendimento da semana**, em cinza: "Inclui o caldo que sumiu e a diferença entre o caldo do início e o do fim. Para a moagem em si,
  veja Caldo por dúzia na moagem." (ponto 7.23).
- **Cada parcela é link** (sublinhada, alvo ≥ 44 px de altura na linha): "12 dúzias recebidas" → Lançamentos de 18/11 a 24/11 só de
  recebimentos; "contagem de 17/11" → aquela contagem; "6 produções" → as produções; "42,8 L vendidos" → a tabela Por produto, logo abaixo.
- **Perda negativa:** o título do cartão vira **Sobra de caldo**, o número fica positivo ("2,1 L") e a linha extra diz: "Saiu mais caldo
  em vendas do que o lançado como produzido. Falta lançar produção?" Nenhuma cor de "bom" ou "ruim" na perda (o desenho não tem limite).
- **Não dá para calcular** (cana moída zero ou negativa): os cartões 1 e 4 mostram "—" e "Não dá para calcular: a cana moída deu zero ou
  negativa (ver o aviso acima)."
- **Caldo no início e no fim** (dentro do cartão 2, em `<details>` "Ver o caldo no início e no fim"):
  "No início: 3 L = 3 L de caldo + 0 L de frozen ÷ 1,25 (contagem de 17/11)" · "No fim: 5 L = 5 L de caldo + 0 L de frozen ÷ 1,25
  (contagem de 24/11)". Sem frozen contado, só "3 L de caldo (contagem de 17/11)".
- **Dúzias anotadas na produção** (proposta, ponto 7.18): no cartão 3, se as produções trouxerem dúzias: "Nas produções, a loja anotou
  9,5 dúzias moídas (4 de 6 produções)." Ajuda a achar contagem errada.
- Pé dos cartões: "Contas com todas as casas; o número arredondado pode diferir 0,1 da soma das parcelas."

**Por produto** (título "Caldo vendido por produto"). No computador, tabela; no celular, um cartão por produto.

| Produto | Vendidos | ml em 1 unidade | Tipo | Litros de caldo (a conta) |
|---|---|---|---|---|
| Caldo de cana 300 ml | 100 | 300 ml | caldo | "100 × 300 ml = 30 L" |
| Frozen 400 ml | 40 | 400 ml | frozen | "40 × 400 ml = 16 L de frozen ÷ 1,25 = 12,8 L de caldo" |
| **Total** | | | | **42,8 L** |

Embaixo, "Não entram na conta:" com as linhas dos avisos ("Caldo 1 L (jarra) · 12 vendidos · sem ml configurado" [Configurar];
"“CALDO CANA 500” · 8 vendas · não ligado ao cardápio" [Ligar ao cardápio]). Sem venda de caldo no período: "Nenhuma venda de produto
configurado entre 18/11 e 24/11."

**Semana em andamento** (da última contagem até hoje): título "Em andamento: desde a contagem de 24/11"; caixa neutra "A perda e o
rendimento aparecem quando a loja lançar a próxima contagem." Cartões: **Cana no início** (6 dúzias, contagem de 24/11) · **Cana recebida**
(= soma de N recebimentos, de 25/11 até hoje) · **Caldo produzido** · **Caldo vendido até agora** (com "vendas importadas até 24/11").
Mesmos avisos que se aplicam.

**Estados da aba Semana:**

| Estado | O que aparece |
|---|---|
| Carregando | 6 cartões `Skeleton` no formato dos cartões |
| Nada ainda (sem contagem) | lista "Para ver a primeira semana:" com ✓/✗ em texto e ícone: (1) "Configure os produtos que levam caldo" [Configurar] · (2) "Informe o rendimento do frozen (se vende frozen)" [Informar] · (3) "Faça a primeira contagem: ela é o ponto de partida da primeira semana." [Lançar a contagem] · (4) "Na contagem seguinte, a primeira semana fecha." |
| Uma contagem só | "A primeira semana fecha na próxima contagem. Ponto de partida: contagem de 24/11 (6 dúzias e 5 L de caldo)." + a visão "Em andamento" |
| Nada configurado, com contagens | aviso âmbar no alto: "Nada configurado: o caldo vendido aparece como 0." [Configurar os produtos] |
| Erro | "Não consegui calcular a semana agora. Toque em Tentar de novo." + a frase do servidor em cinza + [Tentar de novo] |

### 3.5 Admin: aba Lançamentos

- **Novo lançamento:** os 3 botões (em linha no computador, `h-12`; empilhados no celular), que abrem os formulários da 3.3 com
  **Outra data**. Ao lançar, a lista se relê e a semana também.
- **Filtros:** "Período" (`<select>` `h-11`: a semana escolhida na aba Semana · Em andamento · Últimos 30 dias · Escolher datas) · tipo
  em botões que quebram linha: **Todos** · **Recebimentos** · **Produções** · **Contagens** · `Switch` "Mostrar anulados" (ligado).
- **Resumo do filtro** no alto da lista: "18/11 a 24/11: 3 recebimentos = 12 dúzias · 6 produções = 50 L · 1 contagem (sem contar 1 lançamento anulado)".
  A contagem que abre a semana (17/11) fica fora do filtro, pela mesma borda da conta: o link "contagem de 17/11" da Semana abre a lista no dia dela.
- **Cada lançamento** (cartão no celular; tabela no computador: Data · Tipo · Quantidade · Fornecedor ou observação · Lançado por · Situação · Ações):
  - "Recebi cana · 12 dúzias" · "24/11 (hoje) · por Ana às 14h05" · "Fornecedor: Sítio Boa Vista";
  - ações em texto, 44 px: **Corrigir** · **Anular…** (`aria-label="Anular Recebi cana de 24/11, 12 dúzias"`);
  - anulado: a quantidade riscada **e** `Tag muted` "Anulado", com "por Diego em 24/11 às 16h00: lançado em dobro"; sem ações;
  - correção: `Tag muted` "Corrige o lançamento de 24/11 (12 dúzias)".
- **Vazio:** "Nenhum lançamento neste período." [Lançar]. **Carregando:** 4 `Skeleton`. **Erro:** "Não consegui ver os lançamentos agora." [Tentar de novo].

**Anular** (`AlertDialog`; foco inicial em "Voltar sem anular"):

- Título: "Anular este lançamento?"
- Texto: "Recebi cana · 12 dúzias · 24/11 · lançado por Ana às 14h05. Ele continua na lista, marcado como anulado, e sai das contas da semana."
- "Motivo (obrigatório)" + atalhos que preenchem (botões de 44 px): **Lançado em dobro** · **Número errado** · **Data errada**.
  Erro: "Escreva o motivo (pelo menos 3 letras)."
- Botões: **Voltar sem anular** · **Anular o lançamento** (destrutivo).
- Sucesso: toast "Lançamento anulado." 409 `CANA_JA_ANULADO`: "Este lançamento já foi anulado (por Diego, às 16h00)." e a lista se relê.

**Corrigir** (abre o formulário do tipo, já preenchido):

- Título: "Corrigir: Recebi cana de 24/11 (12 dúzias, por Ana)".
- Os campos com os valores antigos; mais o "Motivo da correção (obrigatório)", com os mesmos atalhos.
- Botão: **Anular o antigo e lançar 10 dúzias**. Sucesso: toast "Corrigido: 12 → 10 dúzias." (ponto 7.14: hoje isso são duas chamadas).
- Semana fechada (só com a B6): caixa "Esta semana foi fechada em 25/11. Para corrigir, reabra a semana." [Reabrir a semana…].

### 3.6 Admin: aba Configuração

**Quadro "Números da cana"** (`Panel`):

- Antes de qualquer configuração, no alto da aba: "Nada configurado: o caldo vendido aparece como 0. Comece pelos produtos que levam caldo, abaixo."
- **Litros de caldo esperados por dúzia** (opcional): campo `inputMode="decimal"` com "L por dúzia" fora do campo; vazio mostra "não informado".
  Ajuda: "Quanto caldo vocês esperam tirar de uma dúzia. Pode deixar em branco nas primeiras semanas e usar a média real que aparecer."
  Com 2 ou mais semanas fechadas (proposta, ponto 7.21): "Média real: 4,9 L por dúzia = 149 L produzidos ÷ 30,5 dúzias moídas, nas
  semanas de 04/11 a 24/11." [Usar 4,9]
- **Rendimento do frozen** (depende da pergunta 3):
  - resposta (a), a recomendada: rótulo "1 litro de caldo vira quantos litros de frozen?", "L de frozen" fora do campo. Ajuda: "Ex.: se
    1 L de caldo vira 1,25 L de frozen, digite 1,25. Serve para trazer o frozen vendido e o contado de volta para litros de caldo.";
  - resposta (b): o campo não existe; a ajuda vai para o ml de cada produto frozen (abaixo).
- Erro: "Use um número maior que zero (ex.: 5,5)." Vazio é permitido.
- Botão **Salvar os números**. Sob ele: "Muda as contas de todas as semanas: elas são calculadas na hora, com a configuração de hoje."
  (sai com a B6). Toast: "Números da cana salvos."
- Linha de histórico: "Última mudança: Diego, 24/11 às 10h05." + `<details>` "Ver as mudanças" (as 5 últimas: quem, quando, de → para;
  ponto 7.20).

**Quadro "Produtos que levam caldo"**:

- Campo "Buscar no cardápio" (`type="search"`, a partir de 1 letra, sem acento e sem maiúscula).
- Filtro (botões): **Parecem de caldo (5)** (aberto assim enquanto nada está configurado) · **Configurados (3)** (aberto assim depois) ·
  **Todos (120)**.
- **Por produto** (cartão no celular; no computador, tabela: Produto · Leva caldo · ml · Frozen · Conta de 1 venda · Salvar):
  - nome e categoria; `Tag gold` "parece de caldo" quando o servidor marca `parece_cana`;
  - `Switch` **Leva caldo** (`aria-label="Caldo de cana 300 ml leva caldo"`);
  - ligado: o campo de ml (`inputMode="decimal"`, "ml" fora do campo) e a `Checkbox` **É frozen**. O rótulo do ml muda com a checkbox
    (resposta (a) da pergunta 3): "ml de caldo em 1 unidade" (caldo) ou "ml de frozen em 1 unidade (o tamanho do copo)" (frozen). Na
    resposta (b): sempre "ml de caldo em 1 unidade", com a ajuda "No frozen, só o caldo que vai no copo.";
  - **a conta de 1 venda**, ao vivo: "Cada venda conta 0,3 L de caldo." · "Cada venda conta 0,4 L de frozen ÷ 1,25 = 0,32 L de caldo." ·
    sem rendimento: "Falta o rendimento do frozen: este produto ainda não entra na conta.";
  - botão **Salvar** só aparece com mudança (`aria-label="Salvar Caldo de cana 300 ml"`); toast "Caldo de cana 300 ml salvo: 300 ml de
    caldo por unidade." Desligar e salvar: "Caldo de cana 300 ml não entra mais na conta da cana.";
  - erro: "Digite os ml (maior que zero)."
- Mudou mais de um produto sem salvar: barra fixa embaixo (celular) "2 produtos mudados" [Salvar os 2].
- Vazios: busca sem resultado: "Nenhum produto do cardápio com “xyz”."; nenhum parece de caldo: "Nenhum produto do cardápio tem cana, caldo,
  garapa ou frozen no nome. Abra Todos e ligue os que levam caldo."
- **Nada vem preenchido** (regra do desenho): nenhum ml, nenhuma marca de frozen, nenhum switch ligado.

**Estados da aba Configuração:**

| Estado | O que aparece |
|---|---|
| Carregando | os 2 campos em `Skeleton` + 5 cartões de produto em `Skeleton` |
| Erro ao carregar os números | no quadro: "Não consegui ver os números da cana agora." [Tentar de novo]; o quadro de produtos continua |
| Erro ao carregar os produtos | no quadro: "Não consegui ver o cardápio agora." [Tentar de novo] |
| Erro ao salvar (números ou um produto) | caixa vermelha junto do botão Salvar daquele quadro ou cartão, com a frase do servidor; o que foi digitado fica; o botão volta a "Salvar" |
| Salvando | o botão vira `Loader2` + "Salvando…", travado |
| Cardápio sem produtos ativos | "O cardápio não tem produtos ativos. Cadastre os produtos em Fichas Técnicas." [Ir para Fichas Técnicas] |

### 3.7 Esboços da parte B

**B1. Loja, a tela de lançar (celular 360 px).** Toques da meta de 3 para o recebimento: Cana (menu) · Recebi cana · (12 no teclado) · Lançar.

```text
┌────────────────────────────────────┐
│ Cana                               │
│ Anote o que chegou, o que produziu │
│ e o que sobrou.                    │
│ ┌────────────────────────────────┐ │
│ │ [caminhão]  Recebi cana        │ │
│ │ Chegou cana do fornecedor      │ │
│ │ (em dúzias)                    │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ [copo]  Produzi caldo          │ │
│ │ Moeu cana e tirou caldo        │ │
│ │ (em litros)                    │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ [prancheta]  Contagem do que   │ │
│ │ sobrou                         │ │
│ │ No fim do dia: cana e caldo    │ │
│ │ que sobraram                   │ │
│ └────────────────────────────────┘ │
│ SEUS LANÇAMENTOS DOS ÚLTIMOS 7 DIAS│
│ Recebi cana · 12 dúzias            │
│ hoje (24/11) · lançado às 14h05    │
│ Produzi caldo · 25 litros          │
│ ontem (23/11) · lançado às 18h40   │
│ Recebi cana · ~~8 dúzias~~         │
│ [Anulado pelo gerente]             │
│ Errou um número? Avise o gerente:  │
│ só ele corrige.                    │
└────────────────────────────────────┘
```

**B2. Loja, Recebi cana (celular).**

```text
┌────────────────────────────────────┐
│ ← Voltar                           │
│ [caminhão] Recebi cana             │
│ Quando?                            │
│ [(v) Hoje · 24/11][ Ontem · 23/11 ]│
│ Quantas dúzias chegaram?           │
│ [ − ]  [          12 ]  [ + ]      │
│               dúzias               │
│ Meia dúzia = 0,5.                  │
│ Fornecedor (opcional)              │
│ [                               ]  │
│ + Observação                       │
│                                    │
│ ┌──── teclado numérico ──────────┐ │
├────────────────────────────────────┤
│ [Lançar 12 dúzias recebidas hoje ] │
└────────────────────────────────────┘
```

**B3. Loja, Contagem do que sobrou (celular).** Toques da meta de 4: Cana · Contagem do que sobrou · (6) · 2º campo · (5) · Lançar.

```text
┌────────────────────────────────────┐
│ ← Voltar                           │
│ [prancheta] Contagem do que sobrou │
│ ┌────────────────────────────────┐ │
│ │ Conte no fim do dia, depois de │ │
│ │ fechar. Se contar de manhã,    │ │
│ │ antes de abrir, marque Ontem.  │ │
│ └────────────────────────────────┘ │
│ Quando?                            │
│ [(v) Hoje · 24/11][ Ontem · 23/11 ]│
│ Dúzias de cana que sobraram        │
│ [ − ]  [           6 ]  [ + ]      │
│ Não sobrou? Digite 0.              │
│ Litros de caldo que sobraram       │
│ [                    5 ]  litros   │
│ Todo o caldo já pronto.            │
│ Litros de frozen pronto (se tiver) │
│ [                      ]  litros   │
│ Deixe em branco se não tiver.      │
├────────────────────────────────────┤
│ 6 dúzias · 5 litros de caldo       │
│ [  Lançar a contagem de hoje     ] │
└────────────────────────────────────┘
```

**B4. Loja, depois de lançar.**

```text
┌────────────────────────────────────┐
│ Cana                               │
│ ┌────────────────────────────────┐ │
│ │ (v) Lançado: 12 dúzias de cana │ │
│ │ recebidas em 24/11 (hoje), às  │ │
│ │ 14h05.                         │ │
│ └────────────────────────────────┘ │
│ [ Recebi cana                    ] │
│ [ Produzi caldo                  ] │
│ [ Contagem do que sobrou         ] │
│ SEUS LANÇAMENTOS DOS ÚLTIMOS 7 DIAS│
│ Recebi cana · 12 dúzias    [agora] │
│ hoje (24/11) · lançado às 14h05    │
└────────────────────────────────────┘
```

**B5. Admin, Semana (celular).**

```text
┌────────────────────────────────────┐
│ Cana                               │
│ Rendimento e perda de caldo, de    │
│ uma contagem até a seguinte.       │
│ [ Semana ][Lançamentos][Configura-]│
│                        [  ção    ] │
│ Semana                             │
│ [ 18/11 a 24/11 (contagens de  ▾ ] │
│ [← Anterior]        [Seguinte →]   │
│ Semana de 18/11 a 24/11            │
│ Da contagem de 17/11 (fim do dia)  │
│ até a de 24/11 (fim do dia). Entram│
│ lançamentos e vendas de 18/11 a    │
│ 24/11. Calculada agora, com a      │
│ configuração de hoje.              │
│ ┌────────────────────────────────┐ │
│ │ /!\ O caldo vendido está       │ │
│ │ incompleto: as vendas só foram │ │
│ │ importadas até 21/11 …         │ │
│ │ Importar vendas                │ │
│ └────────────────────────────────┘ │
│ RENDIMENTO DA SEMANA               │
│ 4,28 L vendidos por dúzia          │
│ = 42,8 L de caldo vendido          │
│ ÷ 10 dúzias de cana moída          │
│ Inclui o caldo que sumiu e a       │
│ diferença do caldo do início e do  │
│ fim. Para a moagem, veja Caldo por │
│ dúzia na moagem.                   │
│ PERDA DE CALDO                     │
│ 5,2 L                              │
│ = 3 L no início (contagem de 17/11)│
│ + 50 L produzidos                  │
│ − 42,8 L vendidos                  │
│ − 5 L no fim (contagem de 24/11)   │
│ Positivo = caldo que sumiu.        │
│ ▸ Ver o caldo no início e no fim   │
│ CANA MOÍDA                         │
│ 10 dúzias                          │
│ = 4 dúzias que sobraram (contagem  │
│   de 17/11)                        │
│ + 12 dúzias recebidas (3 entregas, │
│   18/11 a 24/11)                   │
│ − 6 dúzias que sobraram (contagem  │
│   de 24/11)                        │
│ … Caldo por dúzia na moagem,       │
│ Caldo produzido, Caldo vendido …   │
│ CALDO VENDIDO POR PRODUTO          │
│ Caldo de cana 300 ml               │
│ 100 × 300 ml = 30 L                │
│ Frozen 400 ml                      │
│ 40 × 400 ml = 16 L de frozen       │
│ ÷ 1,25 = 12,8 L de caldo           │
│ Total: 42,8 L                      │
└────────────────────────────────────┘
```

**B6. Admin, Semana (computador, 1280 px).**

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Cana                                     [ Semana | Lançamentos | Configuração ] │
│ Semana [ 18/11 a 24/11 (contagens de 17/11 e 24/11) ▾ ]  [← Anterior][Seguinte →]│
│ Da contagem de 17/11 (fim do dia) até a de 24/11. Entram lançamentos e vendas de │
│ 18/11 a 24/11. Calculada agora, com a configuração de hoje.                      │
│ /!\ O caldo vendido está incompleto: vendas importadas até 21/11. Importar vendas│
├────────────────────────────────────────┬─────────────────────────────────────────┤
│ RENDIMENTO DA SEMANA                   │ PERDA DE CALDO                          │
│ 4,28 L vendidos por dúzia              │ 5,2 L                                   │
│ = 42,8 L vendido ÷ 10 dúzias moídas    │ = 3 L (contagem de 17/11) + 50 L        │
│                                        │ produzidos − 42,8 L vendidos − 5 L      │
│                                        │ (contagem de 24/11)                     │
├────────────────────────────────────────┼─────────────────────────────────────────┤
│ CANA MOÍDA  10 dúzias                  │ CALDO POR DÚZIA NA MOAGEM  5,00 L       │
│ = 4 (contagem de 17/11) + 12 recebidas │ = 50 L ÷ 10 dúzias · Esperado: não      │
│ (3 entregas) − 6 (contagem de 24/11)   │ informado. Informar                     │
├────────────────────────────────────────┼─────────────────────────────────────────┤
│ CALDO PRODUZIDO  50 L                  │ CALDO VENDIDO  42,8 L                   │
│ = 6 produções, 18/11 a 24/11           │ = 30 L copos + 12,8 L frozen · todas as │
│                                        │ origens · importadas até 21/11 (!)      │
├────────────────────────────────────────┴─────────────────────────────────────────┤
│ CALDO VENDIDO POR PRODUTO                                                        │
│ Produto               Vendidos  ml     Tipo    Litros de caldo                   │
│ Caldo de cana 300 ml  100       300    caldo   100 × 300 ml = 30 L               │
│ Frozen 400 ml         40        400    frozen  40 × 400 ml = 16 L ÷ 1,25 = 12,8 L│
│ Total                                          42,8 L                            │
│ Não entram: Caldo 1 L (jarra) · 12 vendidos · sem ml. Configurar                 │
└──────────────────────────────────────────────────────────────────────────────────┘
```

**B7. Admin, Lançamentos com o diálogo de anular (celular).**

```text
┌────────────────────────────────────┐
│ [Novo: Recebi cana               ] │
│ [Novo: Produzi caldo             ] │
│ [Novo: Contagem                  ] │
│ Período [ 18/11 a 24/11        ▾ ] │
│ [Todos][Recebimentos][Produções]   │
│ [Contagens]   Mostrar anulados (o) │
│ 18/11 a 24/11: 3 recebimentos = 12 │
│ dúzias · 6 produções = 50 L ·      │
│ 1 contagem (sem 1 anulado)         │
│ ┌────────────────────────────────┐ │
│ │ Recebi cana · 12 dúzias        │ │
│ │ 24/11 (hoje) · Ana · 14h05     │ │
│ │ Fornecedor: Sítio Boa Vista    │ │
│ │ Corrigir        Anular…        │ │
│ └────────────────────────────────┘ │
│ ┌─ Anular este lançamento? ──────┐ │
│ │ Recebi cana · 12 dúzias · 24/11│ │
│ │ · lançado por Ana às 14h05. Ele│ │
│ │ continua na lista, marcado     │ │
│ │ como anulado, e sai das contas │ │
│ │ da semana.                     │ │
│ │ Motivo (obrigatório)           │ │
│ │ [Lançado em dobro][Número err.]│ │
│ │ [Data errada]                  │ │
│ │ [                            ] │ │
│ │ [     Voltar sem anular      ] │ │
│ │ [    Anular o lançamento     ] │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

**B8. Admin, Configuração (celular).**

```text
┌────────────────────────────────────┐
│ /!\ Nada configurado: o caldo      │
│ vendido aparece como 0. Comece     │
│ pelos produtos que levam caldo.    │
│ NÚMEROS DA CANA                    │
│ Litros de caldo esperados por dúzia│
│ [                 ]  L por dúzia   │
│ não informado                      │
│ 1 litro de caldo vira quantos      │
│ litros de frozen?                  │
│ [                 ]  L de frozen   │
│ Ex.: se 1 L de caldo vira 1,25 L   │
│ de frozen, digite 1,25.            │
│ [      Salvar os números         ] │
│ PRODUTOS QUE LEVAM CALDO           │
│ Buscar no cardápio                 │
│ [                               ]  │
│ [Parecem de caldo (5)][Configura-] │
│ [dos (0)][Todos (120)]             │
│ ┌────────────────────────────────┐ │
│ │ Caldo de cana 300 ml           │ │
│ │ Bebidas  [parece de caldo]     │ │
│ │ Leva caldo                (o)  │ │
│ │ ml de caldo em 1 unidade       │ │
│ │ [          300 ]  ml           │ │
│ │ [ ] É frozen                   │ │
│ │ Cada venda conta 0,3 L de      │ │
│ │ caldo.                         │ │
│ │ [ Salvar                     ] │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```

**B9. Computador (≥ `md`), tela a tela.**

| Tela | Como fica no computador |
|---|---|
| Loja: lançar e os 3 formulários | a mesma coluna do celular, centralizada (`max-w-md`); o botão fica no fim do formulário, sem barra fixa (a loja quase sempre está no celular; no computador da loja, a mesma tela serve) |
| Semana | esboço B6 |
| Lançamentos | os 3 botões de "Novo" em linha no alto; filtros numa linha só; tabela Data · Tipo · Quantidade · Fornecedor ou observação · Lançado por · Situação · Ações (Corrigir · Anular…); o formulário abre num `Sheet` do lado direito, para a lista continuar à vista |
| Diálogo de anular | `AlertDialog` centralizado (`max-w-md`), atalhos do motivo em linha, botões lado a lado com "Voltar sem anular" à esquerda |
| Configuração | 2 colunas: "Números da cana" à esquerda (1/3); "Produtos que levam caldo" à direita (2/3), em tabela Produto · Leva caldo · ml · Frozen · Conta de 1 venda · Salvar, com a busca e o filtro no alto |

```text
┌──────────────────────────────────────────────────────────────────────────────────┐
│ Cana                                     [ Semana | Lançamentos | Configuração ] │
├──────────────────────────┬───────────────────────────────────────────────────────┤
│ NÚMEROS DA CANA          │ PRODUTOS QUE LEVAM CALDO                              │
│ Litros de caldo          │ Buscar [            ]  [Parecem de caldo (5)]         │
│ esperados por dúzia      │                        [Configurados (2)] [Todos]     │
│ [      ] L por dúzia     │ Produto           Leva  ml       Frozen  1 venda      │
│ não informado            │ Caldo 300 ml       (o)  [300 ]   [ ]     0,3 L        │
│ 1 litro de caldo vira    │ Frozen 400 ml      (o)  [400 ]   [x]     0,4 L ÷ 1,25 │
│ quantos litros de frozen?│                                          = 0,32 L     │
│ [ 1,25 ] L de frozen     │                                        [ Salvar ]     │
│ [ Salvar os números ]    │ Garapa jarra       ( )                                │
│ Última mudança: Diego,   │                                                       │
│ 24/11 às 10h05           │                                                       │
└──────────────────────────┴───────────────────────────────────────────────────────┘
```

---

## 4. Linguagem e formatos

### 4.1 Vocabulário (termo do sistema → o que a tela diz)

| No código / no desenho | Na tela |
|---|---|
| origem, `vendas_origens` | **sistema** ("De qual sistema vêm as vendas?") |
| `prefixo_pedido` | "letras antes do pedido" |
| `separador_decimal` | "Como os valores estão escritos? Com vírgula / Com ponto" |
| mapeamento | "colunas" ("Qual coluna do arquivo é o quê?", "colunas lembradas") |
| prévia | "Confira antes de importar" (a palavra "prévia" só neste documento e no botão "Ver a prévia") |
| de-para, `produto_relatorio`, `item_cardapio` | "ligar ao cardápio", "nome no relatório", "item do cardápio" |
| sobreposição (R5) | "vendas vindas de outro lugar no mesmo período", "pode contar em dobro" |
| `modo: acrescentar / substituir` | "Só acrescentar as novas" / "Trocar as vendas deste sistema no período (Substituir)" |
| NFC-e / NF-e | "cupom fiscal" / "nota fiscal (NF-e)" |
| `tpAmb` 2, homologação | "modo de teste da SEFAZ" |
| `protNFe` ausente | "sem autorização da SEFAZ" |
| CFOP | "tipo de operação (CFOP)", sempre com a explicação curta |
| emitente | "emitido por" |
| `chave_idempotencia`, `importacao_id`, `documento_id`, códigos de erro | nunca aparecem |
| apuração | "a conta da semana" |
| `cana_lancamentos.tipo`: `recebimento` / `producao` / `contagem` | "Recebi cana" / "Produzi caldo" / "Contagem do que sobrou" |
| DZ | "dúzias" (nunca "DZ" na tela) |
| L/DZ | "L por dúzia" (admin); na loja, nada |
| anular | "Anular" (a mesma palavra do Ponto), sempre com "continua na lista, marcado como anulado" |
| `litros_por_duzia_esperado` | "Litros de caldo esperados por dúzia" |
| `rendimento_frozen` | "1 litro de caldo vira quantos litros de frozen?" (pergunta 3, resposta a) |
| `parece_cana` | "parece de caldo" |

Regras: "você"; verbos no imperativo nos botões; nada em inglês; sem ponto de exclamação; erro diz o que aconteceu e o que fazer.

### 4.2 Formatos

- **Dinheiro:** `R$ 12.345,60` (os centavos do fio viram reais na tela).
- **Dúzias e litros:** até 1 casa, sem ",0" ("12 dúzias", "12,5 dúzias", "42,8 L"); singular abaixo de 2 ("1 dúzia", "1,5 dúzia", "0,5 litro").
  Na Semana, "L"; na loja, "litros" por extenso.
- **L por dúzia:** 2 casas ("4,28 L por dúzia"), como no exemplo do desenho (ponto 7.19).
- **Porcentagem:** 1 casa ("−9,1%").
- **Datas:** "24/11" nas listas e contas, "hoje (24/11)" e "ontem (23/11)" nas listas da loja; ano só quando não é o atual.
- **Hora:** "14h05".
- **Quantidade vendida:** inteiro quando inteiro ("100"); com casas quando o produto é por quilo ("0,350").

### 4.3 Trocas de texto sugeridas em telas que já existem

| Tela | Hoje | Sugerido | Cuidado |
|---|---|---|---|
| Importar Dados | "De-para do relatório de vendas · N pendentes" | "Ligação dos produtos com o cardápio · N sem ligação" | o `browser-check.mjs` confere o título de hoje: trocar os dois juntos, ou deixar o título e só pôr o `id="ligacao-cardapio"` (o link "Ligar ao cardápio" precisa da âncora de qualquer jeito) |
| Importar Dados | `Tag` "sem ficha" no de-para | "sem ligação" | — |
| Importar Dados | o botão "Vendas" no tipo de arquivo | a linha com o link para Vendas → Importar vendas (seção 1) | — |
| Vendas | "Sem vendas no período." | "Nenhuma venda neste período. Traga as vendas do seu sistema de caixa." [Importar vendas] | — |
| Servidor | `IMPORTACAO_VAZIA`: "Nenhuma venda válida no arquivo." | "Nenhuma venda válida no arquivo. Confira as colunas de Data e Quantidade." | — |
| Servidor | `IMPORTACAO_SOBREPOSICAO` (frase não fixada) | "Neste período já há vendas vindas de outro lugar. Confira o aviso e marque a caixa para importar." | — |
| Servidor | `IMPORTACAO_JA_CONFIRMADA` (frase não fixada) | "Esta importação já foi feita." | ver o ponto 7.5 |
| Servidor | `ORIGEM_REPETIDA` (frase não fixada) | "Já existe um sistema chamado “PDV Valinhos”. Escolha ele na lista ou use outro nome." | — |
| Servidor | `CANA_CONTAGEM_DO_DIA`: "Já existe uma contagem em dd/mm. Anule a anterior para lançar outra." | admin: igual; loja: "Já existe uma contagem em dd/mm. Se ela está errada, avise o gerente: só ele corrige." | ponto 7.15 |
| Servidor | `CANA_MOTIVO_OBRIGATORIO` (frase não fixada) | "Escreva o motivo (pelo menos 3 letras)." | — |
| Servidor | `CANA_JA_ANULADO` (frase não fixada) | "Este lançamento já foi anulado." | — |

---

## 5. Acessibilidade (WCAG 2.2 nível AA) e o que o browser-check confere

WCAG = Web Content Accessibility Guidelines, as regras de acessibilidade da web; AA é o piso do projeto.

| Critério | Como as telas cumprem |
|---|---|
| 1.3.1 Informação e relações | `<Label htmlFor>` em todo campo, inclusive os de cada linha do PDF (`aria-label` com o nº da linha: "Quantidade da linha 2, Frozen 400 ml"); escolhas de sistema, tipo, modo e data em `role="radiogroup"`; listas em `<ul>`; tabelas do computador com `<th scope>`; cada cartão da Semana é um `<section>` com `<h3>` |
| 1.4.1 Uso de cor | toda caixa tem ícone + título em texto; anulado = riscado **e** tag; marcado = borda + `CheckCircle2` + texto; perda sem cor de julgamento |
| 1.4.3 / 1.4.11 Contraste | reusar os pares que o projeto já usa (âmbar `border-amber-500/40 bg-amber-500/10` com texto padrão, como na Importar Dados; vermelho `bg-destructive/10` com `text-destructive`). **A medir** no browser-check sobre o tema escuro: texto 4,5:1, ícone e borda 3:1. A conta dos cartões em `text-muted-foreground` a 14 px precisa passar 4,5:1; se não passar, vai em texto padrão |
| 1.4.4 / 1.4.10 Tamanho e reflow | nada com rolagem lateral a 320 px e com zoom de 200%; de `md` para baixo, cartões no lugar de tabelas (colunas, conferência do PDF, produtos novos, Por produto, lançamentos, produtos da Configuração) |
| 1.4.12 Espaçamento | as contas por extenso quebram linha; nada com altura fixa |
| 2.1.1 Teclado | tudo por Tab, na ordem visual; radiogroups com setas; "Enter" no último campo da cana lança |
| 2.4.3 Ordem do foco | ao trocar de passo, o foco vai para o título do passo; ao aparecer erro, para a caixa; ao lançar, para a caixa verde; ao abrir diálogo, para a opção segura |
| 2.4.6 Títulos e rótulos | cada passo e cada aba com `<h2>`; botões dizem a ação e o número ("Importar 2.301 vendas") |
| 2.4.11 Foco não escondido | `scroll-padding-bottom` da altura da barra fixa: o campo focado nunca fica atrás dela, nem com o teclado do celular aberto |
| 2.5.8 Tamanho do alvo | tudo ≥ 44 px (a norma pede 24), 8 px entre alvos; os 3 botões da loja com 72 px de altura (mão molhada, luva); `[−]` `[+]` com 48 px; links das parcelas da conta: no celular, uma parcela por linha, cada uma com 44 px |
| 3.2.2 Mudança ao escolher | escolher o arquivo já lê e muda de passo: a ajuda sob o botão avisa antes ("Ao escolher, o Comanda já lê o arquivo e mostra o próximo passo."). Mudar o modo ou marcar uma caixa refaz a prévia **sem** mudar de lugar, com o anúncio "Prévia atualizada." |
| 3.3.1 / 3.3.3 Erros | junto do campo (`aria-invalid`, `aria-describedby`), dizendo o que fazer; botões `aria-disabled` dizem o que falta e levam ao campo |
| 3.3.4 Prevenção de erro (dados) | nada é gravado sem a prévia; Substituir com diálogo e foco em "Voltar sem apagar"; anular com motivo; o botão da cana diz o número e a data antes do toque |
| 3.3.7 Entrada redundante | colunas lembradas por sistema; último sistema já marcado; Corrigir abre preenchido; voltar um passo não perde nada |
| 4.1.2 Nome, papel, valor | `Switch` "Leva caldo" e checkboxes com o nome do produto no `aria-label`; barra de leitura com `aria-valuenow` |
| 4.1.3 Mensagens de status | `aria-live="polite"`: andamento do XML a cada 25%, "Conferindo…", "Prévia atualizada.", soma × total do PDF, "Lançado: …"; erros com `role="alert"` |
| Movimento | só o `Loader2`, sempre com texto ao lado; com `prefers-reduced-motion`, parado; o destaque "agora" do lançamento novo não pisca |

Outros pontos:

- `lang="pt-BR"` já vale no layout; números lidos pelo leitor de tela como estão ("4,28 litros vendidos por dúzia": o `aria-label` do
  número grande escreve a unidade por extenso).
- Diálogos (`AlertDialog`, Radix) prendem o foco; Esc fecha, menos durante "Importando…".

### 5.1 Contexto físico da loja

- Luz forte do balcão e tela molhada: botões grandes, texto base 16 px (20 px nos campos de número), nada que dependa de cor clara sobre clara.
- Pressa: o formulário abre com o teclado numérico; um número por campo; o botão fixo na zona do polegar.
- Erro de digitação é o maior risco (12 vira 120): o botão repete o número ("Lançar 120 dúzias recebidas hoje") e a lista mostra o que foi
  lançado. Ver o ponto 7.17 (desfazer).

### 5.2 O que o browser-check confere (C.4 do desenho, com os textos desta especificação)

**Importar vendas** (admin, 1366 e 360 px; nenhuma rede; IA desligada):

1. `/vendas` → botão "Importar vendas" → `/vendas/importar` com "Passo 1 de 3".
2. Planilha com cabeçalho de outro sistema (vírgula como separador e `windows-1252`): o passo 2 mostra as colunas sugeridas certas
   (Data, Produto, Quantidade, Valor total) e os exemplos com acento certo.
3. Coluna obrigatória vazia: o botão diz "Escolha a coluna de: Quantidade" e o toque põe o foco no campo.
4. Prévia: os cartões trazem a conta ("= … linhas lidas − …"); `count(*)` de `vendas` igual antes e depois (nada gravado).
5. Com venda de outro lugar no período: o botão diz "Marque a caixa do aviso" e só importa com a caixa marcada.
6. Substituir: o diálogo abre com o foco em "Voltar sem apagar".
7. Importar → o resultado com os números da resposta → "Ver vendas do período" abre `/vendas` no período.
8. O mesmo arquivo de novo: P3 ("já foi importado") e P16 ("Nada novo para importar").
9. XML (2 fixtures + 1 cancelamento): prévia com "1 cancelado" e o grupo de ignorados com o motivo.
10. PDF sem chave de IA: a frase do servidor + "Use a planilha ou o XML do sistema."
11. 360 px: sem rolagem lateral em nenhum passo; barra fixa não cobre o campo focado; alvos ≥ 44 px.
12. Storage: nada em `localStorage`/`sessionStorage` além de `authUser`, mesmo no meio da importação.

**Cana:**

13. Admin: configura 2 produtos (um frozen), salva o rendimento, lança 2 contagens + recebimento + produção, e a Semana mostra os cartões
    com a conta por extenso e o Por produto.
14. Sem contagem: a lista "Para ver a primeira semana:"; com uma contagem: "A primeira semana fecha na próxima contagem."
15. Loja no celular (360 px): só os 3 botões e "Seus lançamentos dos últimos 7 dias"; sem abas; lança um recebimento com Hoje e vê
    "Lançado: …". A página da loja (texto visível **e** `aria-label`) tem 0 ocorrências de "Perda", "perda", "vendido", "L/DZ",
    "rendimento", "esperado" e "sumiu".
16. Loja: nenhum campo de data (só Hoje e Ontem); `/cana?aba=semana` direto continua mostrando só a visão de lançar.
17. Anular: diálogo com o foco em "Voltar sem anular"; motivo com menos de 3 letras mostra o erro; anulado aparece riscado e com a tag.

---

## 6. Decisões em aberto (para o Diego)

As telas acima têm uma variante para cada resposta; nenhuma resposta foi assumida.

| Pergunta do desenho | O que muda na tela |
|---|---|
| 1. A cana é vendida em Valinhos, no mesmo caixa? | se não for, a parte B não começa; nada a desenhar |
| 3. O que é o "rendimento do frozen"? | (a) o campo "1 litro de caldo vira quantos litros de frozen?" + ml de frozen por produto; (b) sem o campo, e o ml do frozen é só o caldo do copo (3.6). Na (b), ver o ponto 7.22 sobre o frozen contado |
| 5. Quem lança: a loja ou só o admin? | loja: a visão de lançar (3.2); só admin: sem item no menu da loja |
| 6. A contagem é no fechamento ou na abertura? | o texto da caixa do formulário de contagem (3.3) |
| 7. Sobra frozen pronto de uma semana para outra? | o campo "Litros de frozen pronto (se tiver)" aparece ou não |
| 11. PDF sem pedido e sem data por venda entra como "1 pedido por dia"? | sim (a recomendação): o campo "Data das vendas sem data" e o aviso "As vendas entram todas em dd/mm" (2.5), e a caixa "Sem número de pedido…" na prévia; não: o PDF sem data por linha para na conferência com "Este relatório não traz a data de cada venda. Exporte um relatório por dia, ou use a planilha." e sem botão de prévia |
| 12. XML de outro CNPJ de Empresas entra como venda desta loja? | a caixa "Incluir os N cupons de …" (P12) aparece desmarcada, ou o grupo vira só "ignorado" |

Para o contador:

- Quais tipos de operação (CFOP) das notas fiscais (NF-e) de saída da loja são venda? Até a resposta, a P13 mostra o código sem dizer se é
  venda, e as notas vêm desmarcadas. Com a resposta, a tela pode escrever "costuma ser venda" ao lado dos códigos que ele indicar (continua
  desmarcado; quem importa decide).

Textos para o Diego confirmar:

- Ajuda do caldo na contagem: "Todo o caldo já pronto." (inclui o da máquina? o da geladeira?).
- Atalhos do motivo de anular: "Lançado em dobro", "Número errado", "Data errada". Servem?
- A aba Semana abrir na **última semana fechada** (e não na em andamento).
- Nome no menu: "Cana" (curto para a faixa do celular) ou "Controle da cana".

---

## 7. Pontos para o arquiteto

Itens que a tela precisa e o desenho ainda não dá, ou regras que a tela fez aparecer. Nenhum muda regra de negócio sem a resposta do desenho.

**Importar vendas**

1. **As contagens da prévia precisam fechar.** A resposta traz `lidas, validas, com_problema, ja_existentes, somadas_no_arquivo`, mas não
   `novas`, e não diz como elas se somam. O cartão "Vendas novas" escreve "= lidas − já existentes − com problema − somadas". Pedido:
   `linhas.novas` explícito e a identidade garantida no teste puro (`lidas = novas + ja_existentes + com_problema + somadas_no_arquivo`).
   Mais `ja_existentes_valor_centavos`, para "As 120 que já existiam (R$ 640,00) não entram".
2. **R1 sem o exemplo.** `ja_existentes_de_outra_fonte: [{ fonte, linhas }]` não traz o pedido e a data da frase "O pedido 1001 de 20/11
   já existe vindo de PDV Centro". Pedido: `exemplo: { pedido, data }` por fonte. E, em `ja_existentes_de_outra_fonte` e `sobreposicao`,
   `fonte` como **nome para a tela** ("Planilha padrão do Comanda", "Cupons do próprio Comanda", "XML de PDV Valinhos", "PDV Centro"),
   com um `tipo` à parte se a tela precisar escolher ícone.
3. **Motivos com contagem total.** `problemas` vem até 200 linhas; o vazio (P15) pede "os 5 motivos mais comuns, com contagem", e a P14
   pede "e mais N". Pedido: `motivos: [{ motivo, linhas }]` com o total de cada motivo (todas as linhas, não só as 200).
4. **A resposta do importar não traz o que a tela mostra.** `{ importacao_id, inseridas, ignoradas, apagadas, canceladas, documentos_novos,
   novos_produtos }` não tem valor nem período, e o risco 9 manda mostrar os números do importar, não os da prévia. Pedido: `valor_centavos`,
   `periodo { ini, fim }`, `apagadas_valor_centavos`, `canceladas { documentos, linhas, valor_centavos }` e `mapeamento_salvo: boolean`.
5. **409 `IMPORTACAO_JA_CONFIRMADA` "com o `importacao_id`".** O filtro global só manda `{ code, message }` (foi assim que o cupom resolveu,
   §10 da UX do cupom). Pedido: a mesma `chave_idempotencia` com o mesmo corpo responde **200 com o resultado guardado da 1ª vez** (como o
   cupom), e o 409 fica só para a mesma chave com outro corpo. Para isso, `importacoes` guarda as contagens do resultado. Sem isso, a tela
   não tem como mostrar o resultado depois de um "Tentar de novo".
6. **XML: a conta dos arquivos.** O cartão "Cupons de venda novos" escreve "= arquivos lidos − já importados − do próprio Comanda −
   cancelados − arquivos de cancelamento − ignorados − NF-e fora". Metade disso é contada no navegador (arquivos, ignorados no navegador,
   NF-e desmarcadas) e metade no servidor. Pedido: definir quem conta o quê e devolver na prévia um bloco que feche
   (`arquivos_lidos` mandado pelo navegador e conferido). Também: `cancelamentos_de_importados` com `ini` e `fim` (as datas das vendas que
   saem, P8), e os **nomes dos arquivos** por motivo de ignorado (a regra "nada some calado" pede o nome; hoje `ignorados` é só contagem).
7. **Últimas importações de vendas.** A lista do passo 1 pede, por importação: data e hora, nome do sistema, formato, arquivo, vendas novas
   e nome de quem importou. A rota `importacoes recentes` de hoje não tem sistema, formato nem nome.
8. **Vendas abrir no período pela URL.** "Ver vendas do período" e "Ver as vendas do período" levam a `/vendas?ini=&fim=`. Hoje a tela
   de Vendas guarda o período só no estado (abre sempre em "Últimos 30 dias"). Pedido: ler `ini`/`fim` da URL como "Personalizado".
   (Filtrar Vendas por sistema fica para depois.)
9. **Cabeçalho fora da 1ª linha.** Muitos PDVs exportam 2 a 5 linhas de título ("Relatório de vendas — Loja X — 01/11 a 23/11") antes do
   cabeçalho. A sugestão de colunas olha só a 1ª linha e não acharia nada. Pedido: achar o cabeçalho na 1ª linha (entre as 10 primeiras)
   que tenha ao menos 3 nomes conhecidos (os sinônimos da A.5), e a tela mostrar "Cabeçalho na linha 4" com a escolha "Trocar". Sem isso,
   a 1ª importação real pode empacar no passo 2.
10. **Rascunho.** O CLAUDE.md só deixa 3 usos do storage do navegador. Esta tela **não** guarda nada: recarregar perde o arquivo, as colunas
    escolhidas e as edições do PDF, com o aviso do navegador (2.1). A memória das colunas por sistema (no servidor) já cobre o caso mais comum.
    Se o arquiteto preferir guardar a conferência do PDF, é um 4º uso de storage e precisa entrar no CLAUDE.md.
11. **"Parece de caldo" em dois lugares.** A prévia (2.6.3) e a Configuração da Cana (3.6) usam a mesma lista de palavras (cana, caldo,
    garapa, frozen). O servidor já tem `parece_cana` para os itens do cardápio; a prévia precisa do mesmo para o **nome no relatório**.
    Pedido: um `parece_cana` por produto em `produtos_sem_de_para`, da mesma função, em vez de a tela repetir a lista.
12. **P6 precisa saber quando o "já existente" é do pedido "DIA".** Para mostrar "Parte do dia já foi importada" (risco 10) só quando é
    esse caso, a prévia precisa dizer `ja_existentes_pedido_dia: n` (as já existentes cujo pedido é o sintético `DIA <data>`).

**Cana**

13. **`POST /v1/cana/lancamentos` sem chave de repetição.** O celular da loja perde sinal no balcão; "tocar de novo em Lançar" depois de uma
    ida que chegou lança **dois recebimentos** (a contagem é protegida pelo índice do dia; recebimento e produção, não). Pedido:
    `chave_idempotencia` (uuid do navegador, nascido ao abrir o formulário), única em `cana_lancamentos`; a 2ª vez devolve 200 com o
    lançamento da 1ª.
14. **Corrigir em duas chamadas.** "Anular + lançar com `substitui_id`" são duas chamadas. Se a 2ª falhar, o lançamento antigo fica anulado
    e o novo não existe (a semana muda sem ninguém ver). E, para a contagem, a ordem é obrigatória (o índice do dia não deixa lançar a nova
    antes de anular a velha). Pedido: `POST /v1/cana/lancamentos/:id/corrigir` `{ motivo, novo }` numa transação (anula e lança), ou o
    `POST` com `substitui_id` + `motivo_anulacao` fazendo as duas coisas.
15. **Contagem do dia: a frase e o aviso antes.** (a) A frase de `CANA_CONTAGEM_DO_DIA` manda anular, e a loja não anula: a mensagem da
    loja precisa ser outra (4.3). (b) A loja só vê os próprios lançamentos, então não sabe que a colega já contou. Pedido: `GET recentes`
    trazer `contagens_lancadas: [{ data, por_nome, em }]` de hoje e ontem, **sem números** (não quebra a contagem cega), para o formulário
    avisar antes de a pessoa contar à toa.
16. **`GET /v1/cana/lancamentos/recentes` para a loja.** Pedido: (a) só as marcas `anulado: boolean` e `corrigido: boolean`, **sem** o
    motivo (texto livre do gerente, que pode trazer a conta da semana) e **sem** a quantidade nova (numa contagem, é o que a contagem cega
    esconde), para a loja ver que o gerente mexeu; (b) `hoje` e `ontem` do servidor (`todaySp()`), para os botões de data não
    dependerem do relógio do celular (perto da meia-noite, o celular pode estar adiantado e o servidor recusar com `CANA_DATA_FORA`);
    (c) os últimos fornecedores usados (até 5 nomes), para a lista do campo Fornecedor.
17. **Desfazer da loja** (regra; pergunta ao Diego). Hoje a loja não corrige nada: um "120" no lugar de "12" fica até o gerente ver.
    Proposta: a loja pode anular o **próprio** lançamento por 10 minutos (motivo automático "desfeito por quem lançou"), com o toast
    "Lançado: 120 dúzias. [Desfazer]". Não quebra a contagem cega e segue "nada é apagado". Sem a resposta, a tela fica como está (3.3).
18. **A semana precisa trazer cada parcela pronta para a tela.** Para escrever "12 dúzias recebidas (3 entregas, de 18/11 a 24/11)" e
    fazer cada parcela virar link, cada número de `GET /v1/cana/semanas/:id` precisa de: valor, quantidade de lançamentos, datas, o `id` da
    contagem (início e fim) e o período das vendas (`vendas_ini`, `vendas_fim`). Também: a soma das dúzias anotadas nas produções e quantas
    produções as trouxeram (cartão 3; só exibição, não entra em conta nenhuma); e os avisos como `{ codigo, dados }` (produtos, datas,
    contagens), para a tela montar a frase e o link de cada um.
19. **Casas decimais.** B.3 diz "a tela mostra 1 casa", e o exemplo do próprio desenho mostra "4,28 L vendidos por dúzia". A tela usa 2 casas
    em "L por dúzia" (entre 4,2 e 4,3 há 2% de diferença) e 1 casa em dúzias e litros. Confirmar. Com 1 casa nas parcelas, a soma escrita pode
    diferir 0,1 do resultado: a tela diz isso no pé dos cartões.
20. **Configuração: quem mudou e quando.** `GET /v1/cana/parametros` devolve só os dois números. A tela mostra "Última mudança: Diego, 24/11
    às 10h05" e as 5 últimas mudanças (o `cana_parametros_historico` já existe; falta a rota). O mesmo para `GET /v1/cana/produtos`
    (`atualizado_por_nome`, `atualizado_em`).
21. **"Média real" na Configuração** (opcional). Para a sugestão "Média real: 4,9 L por dúzia = 149 L ÷ 30,5 dúzias, semanas de 04/11 a
    24/11", a lista `GET /v1/cana/semanas` precisa trazer, por semana, caldo produzido e cana moída (o desenho diz "os 4 números principais"
    sem dizer quais). Pedido: fixar os 4 como cana moída, caldo produzido, caldo vendido e perda; a média é a conta das somas, na tela.
22. **Pergunta 3, resposta (b), e o frozen contado.** Na (b) não existe rendimento do frozen, e a fórmula "caldo no início = caldo + frozen ÷
    rendimento" fica sem divisor: os litros de frozen contados não teriam como virar caldo. Se a resposta for (b), a contagem de frozen
    precisa de outra unidade (copos? litros de caldo já misturado?) ou sai do formulário.
23. **"Rendimento da semana" mistura perda e estoque.** Caldo vendido ÷ cana moída cai quando sobra mais caldo no fim (estoque, não perda).
    A tela explica sob o cartão: "Inclui o caldo que sumiu e a diferença entre o caldo do início e o do fim. Para a moagem em si, veja Caldo
    por dúzia na moagem." Confirmar que é essa a conta que o Diego quer como "rendimento da semana" (o pedido dele: "apurar o rendimento da semana").
24. **Perda sem limite.** Sem um limite ("até 2 L por semana é normal"), a tela não pinta a perda de vermelho nem de verde. Se o Diego quiser
    um alerta, é um parâmetro novo em `cana_parametros`.
25. **Refazer a prévia a cada escolha.** Mudar o modo, marcar um CNPJ ou uma NF-e refaz a prévia com o corpo inteiro (~1 MB no XML do mês).
    A tela espera 500 ms depois da última mudança e cancela o pedido anterior. Confirmar que o servidor aguenta (teto de pedidos por minuto
    do throttler).
26. **XML só com cancelamentos.** Um .zip que só traz cancelamentos de cupons já importados (risco 4: o cancelamento que chega semanas
    depois) tem 0 vendas novas. Se o servidor responder `IMPORTACAO_VAZIA` nesse caso, o cancelamento nunca é aplicado. Pedido: a prévia e o
    importar aceitam envio sem venda nova quando há `cancelamentos` a aplicar (ou documentos cancelados a registrar), e só dão
    `IMPORTACAO_VAZIA` quando não há nem venda nem cancelamento. A tela tem o estado P18 e o botão "Tirar 2 cupons cancelados".
27. **A lista de sistemas não traz o que o passo 1 mostra.** "Último usado, já marcado", "última importação em 20/11" e "colunas lembradas"
    (a meta de 4 toques depende de o sistema já vir marcado) pedem, em `GET /v1/importacoes/origens`, por sistema: `ultima_importacao_em` e
    `tem_mapeamento` (ou o próprio `mapeamento`, que a tela já usa no passo 2), com a lista ordenada pela última importação. A "Planilha
    padrão do Comanda" também precisa da data da última importação (as de `origem_id` nulo).
