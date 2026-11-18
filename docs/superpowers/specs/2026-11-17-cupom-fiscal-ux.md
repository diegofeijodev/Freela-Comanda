# Cupom fiscal (NFC-e): interface e textos

Complementa `2026-11-17-cupom-fiscal-design.md` (vale o desenho; o que a tela precisa e ele não dá está na seção 10). Usuário agora: administrador (dono/gerente), muitas vezes no celular (360 px), quase sempre sem impressora de cupom à mão. Depois (fase "trocar o caixa", marcada **Fase 2**): operador de caixa no computador do balcão, com impressora de 80 mm. A loja não vê nada: o cupom mostra preço de venda.
Componentes (todos já existem no projeto): `PageHeader`, `Panel`, `Tag` (`ok`/`warn`/`bad`/`muted`), `Button` (`h-11`, `w-full` no celular), `Input`, `Label`, `Textarea`, `Checkbox`, `RadioGroup`, `Select`, `Tabs` (gatilhos `h-11`, como na Entrada de Notas), `Sheet` (de baixo no celular, do lado no computador), `Dialog`, `AlertDialog`, `Skeleton`, `toast` (sonner). Ícones lucide sempre com texto: `Receipt` (menu), `CheckCircle2`, `CircleAlert`, `Ban`, `Loader2`, `Printer`, `QrCode`, `Share2`, `Minus`/`Plus`, `X`. Cor nunca sozinha. Erros e avisos em caixa DENTRO da tela (como no `CertificadoPanel` e no painel da SEFAZ); toast só para sucesso curto e "Desfazer". Datas `17/11/2026`, hora `14h05` (Brasília), valor `R$ 1.234,56`, quantidade `0,350`; dentro do DANFE vale o formato do Manual (`17/11/2026 14:05:31`). O tema do app é escuro: o DANFE e o QR ficam sempre num "papel" branco com texto preto.
Nada da venda vai para o navegador (carrinho, CPF, `chave_idempotencia`): a regra do CLAUDE.md só deixa a sessão e o rascunho da contagem no storage. Recarregar a página perde a venda em montagem; a seção 2.7 cobre o risco.

Jobs: (1) "Quando uma venda precisa de cupom fora do caixa de hoje (teste, ou o caixa falhou), quero montar a venda pelo cardápio e emitir sem saber código fiscal, para entregar o cupom ao cliente." (2) "Quando um cupom não sai, quero saber em uma frase o que fazer agora." (3) "Quando o contador me passa os códigos, quero cadastrar uma vez e ver o que falta para ligar."
Metas (contadas nos esboços da seção 7):
- 1 produto pago em PIX: **5 toques** + 3 letras (campo de busca, produto, PIX, Conferir e emitir, Emitir cupom).
- 2 produtos diferentes, dinheiro com troco: **7 toques** + 6 letras (busca, produto, produto, Dinheiro, atalho "R$ 60", Conferir e emitir, Emitir cupom).
- Cancelar dentro do prazo, a partir do cupom: **3 toques** (Cancelar o cupom…, motivo pronto, Cancelar o cupom).
- Saber o que fazer com um cupom que não saiu: **0 toques** (a tela do cupom diz) ou 1 a partir da faixa de pendentes.
- Tempo: até 30 s do 1º toque ao cupom na tela, com a SEFAZ respondendo normal (hipótese; medir no 1º teste pelo `nfce_envios.duracao_ms`).
- Por que não 3 toques: produto e pagamento não dá para adivinhar (forma errada = dado fiscal errado), e o passo "Conferir" protege um documento fiscal (WCAG 3.3.4: a regra de acessibilidade da web que pede conferência antes de um documento legal ou financeiro; ver seção 8). Na Fase 2 a venda vem do pedido, e a meta é outra.

## 1. Menu e quem vê
- **Menu:** `{ to: '/cupom', label: 'Cupom Fiscal', icon: Receipt, loja: false }`, logo depois de "Vendas" (o que entra de dinheiro fica junto). No celular vira a 3ª pílula da faixa do topo, visível sem rolar.
- **Quem vê:** só admin, **sempre**, mesmo com o servidor desligado: a aba Produtos e a aba de Configurações funcionam antes de ligar, e cadastrar os dados do contador é o 1º trabalho. Loja: sem item no menu; `/cupom` direto recebe 403 da API e a tela mostra o mesmo aviso das outras telas só de admin.
- **Rotas da tela:** `/cupom` (abas por `?aba=emitir|emitidos|produtos`, padrão `emitir`; `&item=<id>` abre a folha do produto; `&cupom=<id>` filtra os produtos de um cupom), `/cupom/[id]` (o cupom), `/cupom/[id]/imprimir` (DANFE, sem menu). Configurações ganha a aba **Cupom fiscal** (`/configuracoes?aba=cupom`), ao lado de Geral e Contas de despesas: é o caminho que as frases do servidor já citam ("Configurações → Cupom fiscal").
- **Cabeçalho:** `PageHeader title="Cupom Fiscal"`, sub "Próximo cupom: nº 12 (série 2)" (sem série configurada, sem sub).
- **Faixas acima das abas** (valem nas três):
  - Modo de teste (âmbar, `role="status"`, só com o servidor em homologação): "MODO DE TESTE da SEFAZ: estes cupons não valem como documento fiscal e não mexem no estoque."
  - Pendentes (seção 4.2).
- **Abas:** **Emitir** · **Emitidos · N** (N = cupons que precisam de você; some com 0) · **Produtos · N** (N = produtos com dados faltando; some com 0). `aria-label` completo ("Emitidos, 1 cupom precisa de você"; "Produtos, 12 com dados faltando"). `TabsList` em grade de 3 colunas no celular, `h-auto min-h-11 whitespace-normal`: a 360 px o texto pode quebrar em 2 linhas, nunca corta.
- **Fase 2:** o operador de caixa veria só Emitir e Emitidos (sem Produtos nem Configurações). Depende da pergunta 7 do desenho (o caixa pode ver preço de venda?).

## 2. Aba Emitir
### 2.1 O que aparece antes do carrinho
Uma caixa no alto da aba; vale só a 1ª linha que se aplicar. Carregando a situação: `Skeleton` (campo + 3 linhas). Erro ao ler: "Não consegui ver se a emissão está pronta. Toque em Tentar de novo." [Tentar de novo].

| # | Situação | Tom | Texto | Ação | Formulário |
|---|---|---|---|---|---|
| 1 | Servidor desligado (`ambiente = desligado`) | neutro | "A emissão de cupom fiscal não está ativada neste servidor. Você já pode cadastrar os dados fiscais dos produtos e da empresa; para ativar, fale com o suporte do Freela Comanda." | **Preparar os produtos** (aba Produtos) · link "Dados da empresa no cupom" (Configurações) | escondido |
| 2 | Falta configurar (`falta` não vazio) | neutro | "Para emitir, falta:" + a lista da seção 5.1, cada item com ✗/✓ (ícone + texto) e link | primário "Completar: <1º item que falta>" | escondido |
| 3 | Tudo pronto, emissão desligada | neutro | "Tudo pronto. Ligue a emissão em Configurações → Cupom fiscal." | **Ligar a emissão** (link para a aba de Configurações) | escondido |
| 4 | Parada (`parada_*`) | vermelho, `role="alert"` | a frase da parada (seção 6.1) | link para o que corrigir | visível; botão "A emissão parou" |
| 5 | Certificado com problema (vencido, ilegível, outro CNPJ) | vermelho | a frase do certificado (`MSG_USO`) | [Ir para o certificado] | visível; botão "Confira o certificado" |
| 6 | Bloqueio 656 (`bloqueado_ate` no futuro) | âmbar | "A SEFAZ bloqueou os envios deste CNPJ por excesso de recusas. O caixa da loja pode estar bloqueado também: confira se ele está emitindo. Nada sai daqui até as 15h10." | — | visível; botão "Envio volta às 15h10" |
| 7 | Muitas recusas (teto de 10 em 1 h) | âmbar | "Muitas recusas da SEFAZ na última hora. Para não bloquear o CNPJ, o envio volta às 15h10. Enquanto isso, confira os dados dos produtos." | [Ver os produtos] | visível; botão "Envio volta às 15h10" |

Nas linhas 4 a 7 o admin pode montar a venda (vai esperar 10 min, por exemplo), mas não emitir. Nas 1 a 3 não há o que montar: a tela mostra só a ação que destrava.
**"Último cupom"** (linha discreta logo abaixo das abas, só se o último cupom tem menos de 30 min): "Último cupom: nº 12 · R$ 50,00 · 14h05 · Autorizado" [Ver]. Serve para quem recarregou a página no meio do envio e não sabe se o cupom saiu.

### 2.2 Produtos: busca e carrinho
- **Campo** com rótulo visível "Buscar produto", `type="search"`, `autoComplete="off"`, `autoCorrect="off"`, `spellCheck={false}`. Busca a partir de 1 letra, sem acento e sem maiúscula ("cha" acha "Chá"), no nome do cardápio e no nome no cupom. Código de barras completo (8 a 14 números) acha pelo GTIN (Fase 2: o leitor USB digita os números + Enter e o produto entra direto).
- **Resultados embaixo do campo** (não em popover: no celular o popover espreme e esconde), até 8. A linha inteira é botão (≥ 48 px): nome · "R$ 12,00" · ícone `Plus`. Toque = entra 1 unidade (ou soma 1, se já está no cupom); a linha passa a mostrar "2 no cupom". Mais de 8: "Mais 14 produtos: continue digitando." Contagem anunciada (`aria-live="polite"`): "3 produtos encontrados."
- **Produtos que não entram** (ativos, mas sem NCM, sem perfil fiscal ou sem preço): no fim da lista, sob "Não entram no cupom:", em cinza e sem botão de adicionar: "Chopp 1 litro · Falta NCM" + link **Completar** (abre a aba Produtos com a folha do item). Nunca escondidos: sem eles o admin acha que o produto sumiu.
- **Sem resultado:** "Nenhum produto com “xyz”. Confira o nome ou veja por categoria."
- **"Ver por categoria"** (link ≥ 44 px sob o campo): mostra as categorias do cardápio como botões; tocar lista os produtos dela no lugar dos resultados.
- **Depois de adicionar:** o campo limpa e fica com o foco (já dá para digitar o próximo). Logo abaixo aparece "Acabou de entrar: Chopp 300 ml [−] 1 [+]", para somar unidades sem procurar no carrinho; a linha some ao adicionar outro produto ou ao sair do campo. Anúncio: "Chopp 300 ml: 1 no cupom. Total R$ 9,90."
- **Teclado (computador):** ↓/↑ andam nos resultados, Enter adiciona o destacado (o 1º, se nenhum), Esc limpa o campo. Dica sob o campo, só em ≥ md: "↓ ↑ escolhem · Enter adiciona · Esc limpa".
- **Carrinho** "No cupom (2 itens)". Por linha:
  - nome (quebra linha, nunca corta), "R$ 12,00 cada" e o total da linha à direita;
  - `[−] 2 [+]`, cada botão com 44 px; o número é campo `inputMode="decimal"` e aceita "0,350" (produto por quilo), até 4 casas;
  - "−" com 1 fica desabilitado: para tirar, use **Tirar** (texto, 44 px). Tirar: toast "Espetinho de carne tirado do cupom." + **Desfazer** (8 s).
  - Erro do número (no blur): "A quantidade tem de ser maior que zero."
- **Preço só leitura** (o servidor lê do cardápio; a tela nunca manda preço). Sob o título do carrinho, a linha "Preços do cardápio (Fichas Técnicas)." Se o preço mudou depois que a tela abriu (a lista se relê ao voltar para a aba), a linha do produto mostra "Preço mudou: era R$ 9,90." (âmbar) até o envio. Ver o ponto 10.1: hoje o servidor pode emitir com outro total sem avisar.
- **Produto do carrinho que deixou de poder entrar:** linha âmbar "Não entra mais no cupom: falta NCM. Tire o produto ou complete o cadastro." O botão principal vira "Confira os produtos".
- **Desconto:** link "+ Dar desconto" (44 px) abre o campo "Desconto (R$)" (`inputMode="decimal"`) e o link "Tirar desconto". Erro (no blur): "O desconto tem de ser menor que o valor dos produtos (R$ 53,70)." Só em reais, porque o desenho não tem porcentagem (decisão 9.3).
- **Totais** (alinhados à direita): "Produtos R$ 53,70" · "Desconto − R$ 3,70" (só com desconto) · **"Total R$ 50,00"** (24 px, negrito).
- **Estados:**
  - carrinho vazio: "Nenhum produto no cupom ainda. Busque acima.";
  - carregando os produtos: 3 `Skeleton`;
  - erro: "Não consegui carregar os produtos. Toque em Tentar de novo." [Tentar de novo];
  - nenhum produto pronto: "Nenhum produto está pronto para o cupom. Complete o NCM e o perfil fiscal na aba Produtos." [Ir para Produtos].

### 2.3 Pagamento
- Título "Pagamento". Seis botões de escolha (`role="radiogroup"`, `aria-label="Forma de pagamento"`; 2 colunas no celular, 3 no computador; 44 px): **Dinheiro · PIX · Débito · Crédito · Vale-refeição · Vale-alimentação** (`tPag` 01, 17, 04, 03, 11, 10). "Débito" e "Crédito" são as palavras da Conciliação de Caixa; o DANFE sai com o nome oficial. O escolhido ganha borda + `CheckCircle2` + texto, não só cor. **Nenhum vem marcado.**
- **Uma forma só, sem ser dinheiro:** linha "PIX: R$ 50,00 (o total)". Nada para digitar.
- **Dinheiro:**
  - campo "Recebido em dinheiro (R$)" (`inputMode="decimal"`); vazio = valor certo;
  - atalhos: **Valor certo** e os 2 primeiros valores diferentes entre o próximo múltiplo de 10, de 50 e de 100 acima do total (total R$ 53,70 → "R$ 60" e "R$ 100"; total R$ 47,30 → "R$ 50" e "R$ 100");
  - abaixo, em 24 px: "Troco: R$ 6,30" (`aria-live="polite"`).
- **"+ Pagar parte em outra forma"** (44 px): a forma escolhida ganha campo de valor, e abre outra linha com as 6 opções e o valor que falta já preenchido (WCAG 3.3.7). Cada linha tem **Tirar**. Abaixo das linhas: "Falta R$ 10,00" (âmbar, `CircleAlert`) ou "Pago" (`CheckCircle2`).
- **Erros** (junto do campo, no blur):
  - "No PIX, o valor não pode passar do que falta pagar (R$ 20,00). Troco só em dinheiro." (o mesmo para débito, crédito e vale, com o nome da forma);
  - "O troco (R$ 15,00) não pode passar do que foi pago em dinheiro (R$ 10,00). Diminua o valor no PIX.";
  - um valor só em dinheiro, abaixo do total: "Falta R$ 7,30. Receba o resto em outra forma ou corrija o valor."
- **Linha fixa proposta** (depende da pergunta 5 do desenho; ver decisão 9.2): "Cobre aqui só o valor do cupom. A taxa de serviço ainda não entra no cupom."

### 2.4 CPF ou CNPJ na nota
- Rótulo "CPF na nota (opcional)", `inputMode="numeric"`, máscara `000.000.000-00`, `autoComplete="off"` (o número é do cliente, não do admin).
- Link **É CNPJ?** troca para "CNPJ na nota (opcional)", com `inputMode="text"`, `autoCapitalize="characters"` e máscara `00.000.000/0000-00` aceitando letras (o CNPJ novo tem letras; o teclado só de números o quebraria). **É CPF?** volta. O que foi digitado fica, se couber.
- Ajuda: "Com CPF, o cliente também acha o cupom na Nota Fiscal Paulista."
- Validação no blur, com `cpfValido`/`cnpjValido` de `web/src/lib/fiscal.ts`:
  - "Faltam números no CPF (são 11).";
  - "Este CPF não confere. Confira os números.";
  - "Este CNPJ não confere. Confira os 14 caracteres."
- Total de R$ 10.000,00 ou mais: o rótulo vira "CPF ou CNPJ na nota (obrigatório acima de R$ 10.000,00)". Vazio: "Acima de R$ 10.000,00, o CPF ou CNPJ é obrigatório."

### 2.5 Botão fixo e "Conferir o cupom"
- **Celular:** barra fixa embaixo (`fixed inset-x-0 bottom-0`, `pb-[env(safe-area-inset-bottom)]`, como a do Inventário). À esquerda, "Total" + "R$ 50,00" (20 px, negrito) e, com dinheiro, "Troco R$ 10,00"; à direita, o botão (`h-12`).
  - A página ganha `pb-28` e `scroll-padding-bottom` da altura da barra: o campo com foco nunca fica atrás dela (WCAG 2.4.11).
  - **Computador:** o mesmo bloco no fim da coluna da direita, sem barra fixa.
- **O botão diz o que falta.** Fica `aria-disabled`, nunca `disabled` mudo; o toque leva ao lugar certo e põe o foco nele.

| Falta | Rótulo | O toque leva a |
|---|---|---|
| nenhum produto | "Adicione um produto" | campo de busca |
| produto que não entra mais | "Confira os produtos" | 1ª linha com aviso |
| forma de pagamento | "Escolha o pagamento" | Pagamento |
| valor | "Falta R$ 10,00" | linha de pagamento |
| CPF/CNPJ com erro | "Confira o CPF" / "Confira o CNPJ" | o campo |
| bloqueio ou parada | "Envio volta às 15h10" / "A emissão parou" / "Confira o certificado" | caixa do topo |
| tudo certo | **Conferir e emitir** | abre "Conferir o cupom" |

- **"Conferir o cupom"**: `Sheet` de baixo no celular (até 85% da altura, rolagem interna) e `Dialog` no computador.
  - Título "Conferir o cupom".
  - Linha do modo:
    - teste: "Cupom de teste: vai para a SEFAZ, mas não vale como documento fiscal.";
    - valendo: "Este cupom vale como documento fiscal e vai para a SEFAZ em nome da empresa."
  - Itens: "2 × Espetinho de carne … R$ 24,00" (mais de 5: os 4 primeiros + "e mais 3 produtos"); "Desconto − R$ 3,70"; **"Total R$ 50,00"**; uma linha por forma ("Dinheiro R$ 60,00 · Troco R$ 10,00"); "CPF 123.456.789-09" ou "Sem CPF na nota".
  - Botões: **Emitir cupom** (primário, `h-12`) e **Voltar e corrigir** (outline).
  - Foco: o inicial vai para o título, e o leitor de tela lê o resumo. Esc e "Voltar e corrigir" fecham e devolvem o foco ao botão da barra.
- **Enviando** (no mesmo Sheet, sem abrir outro):
  - os botões dão lugar a `Loader2` + "Enviando à SEFAZ…" e à linha "Leva alguns segundos. Não feche esta tela." (`aria-live="polite"`, `aria-busy`);
  - o Sheet não fecha até a resposta: Esc, toque fora e arrastar não fazem nada;
  - trava de toque duplo por `ref` (`semToqueDuplo`, como no painel da SEFAZ).
- **Resposta com cupom** (201 ou 200, em qualquer situação):
  - `router.push('/cupom/<id>')`: o Voltar do navegador volta à aba Emitir vazia;
  - a venda zera, e só aqui nasce uma `chave_idempotencia` nova;
  - o foco vai para o título do cupom.
- **Erro antes do envio à SEFAZ** (os 4xx da §8.4 do desenho: item indisponível, desconto, pagamento, documento, configuração, bloqueio):
  - a frase do servidor (`errMsg()`) aparece em caixa vermelha dentro do Sheet, acima dos botões, com o foco nela;
  - o primário vira **Voltar e corrigir**, e a venda continua na tela;
  - a chave continua a mesma: nenhum cupom foi criado.

### 2.6 Esboços
Os esboços estão na seção 7: E1 (montando, celular), E2 (busca digitando), E3 (Conferir, enviando e falha de rede), E4 (falta configurar) e E5 (computador).

### 2.7 "Não sei se o cupom saiu" (o nosso servidor não respondeu)
- Quando: rede do celular caiu, 502 ou 504, nenhuma resposta com cupom.
- No Sheet, caixa âmbar (`role="alert"`, foco nela): "Não consegui falar com o servidor do Freela Comanda. O cupom pode ter saído ou não." Abaixo: "Tentar de novo não emite dois cupons: se o primeiro chegou, você vê esse mesmo cupom."
- Botões: **Tentar de novo** (mesma `chave_idempotencia`, mesmo corpo) · **Ver cupons emitidos**.
- **A venda fica travada** até haver resposta: campos `aria-disabled`, mais a linha "Para mudar a venda, primeiro toque em Tentar de novo." Mudar a venda com outra chave pode gerar dois cupons para a mesma venda. E mudar a venda **com a mesma chave** faz o servidor devolver o cupom antigo calado (ver o ponto 10.2).
- **Saída sem emitir:** depende do ponto 10.2 (procurar pela chave, sem emitir).
  - Com ele: ao falhar, a tela procura sozinha **uma vez**, só no nosso servidor e nunca na SEFAZ. Se achar, abre o cupom; se não achar, destrava e diz "Nada foi emitido. Pode corrigir a venda ou emitir de novo."
  - Sem ele: só "Tentar de novo".
- **Recarregou a página:** a venda se perde (nada fica no navegador). A faixa de pendentes e a linha "Último cupom" (2.1) mostram se algo saiu.

## 3. O cupom (`/cupom/[id]`)
### 3.1 Cabeçalho e situação
- Link "← Cupons emitidos" (`no-print`). Título "Cupom nº 12"; sub "Série 2 · hoje às 14h05 · R$ 50,00 · PIX".
- Logo abaixo: a **tag** da situação (ícone + texto), a **caixa** da situação (texto + ações) e a linha da venda no estoque (3.2).
  - Caixa: `role="alert"` quando vermelha; `role="status"` nos outros casos.
  - Ao chegar do envio, o foco vai para o título.
- Em `enviando`, a tela relê o cupom a cada 5 s, até 2 min. Isso é só o nosso servidor, nunca a SEFAZ; o desenho proíbe laço só na SEFAZ.
- **As horas e os botões vêm do servidor** (ponto 10.3): `consultar_a_partir_de`, `cancelar_ate` e as ações permitidas, com a hora do servidor para acertar a contagem. Sem isso, um celular com o relógio errado habilita o botão cedo, e a SEFAZ devolve `NFCE_CONSULTA_CEDO`.
- A contagem é só local:
  - o botão "Consultar" habilita sozinho na hora marcada, mas **nunca dispara**;
  - o anúncio é só nos marcos: "Já pode consultar." e, no cancelamento, faltando 5 min e 1 min.

| Situação | Tag | Caixa (texto final) | Ações (a 1ª é a primária) |
|---|---|---|---|
| `enviando` (até 2 min) | warn, `Loader2`, "Enviando" | "Enviado à SEFAZ às 14h05. Esperando a resposta." | nenhuma |
| `sem_resposta` | warn, `CircleAlert`, "Sem resposta da SEFAZ" | "A SEFAZ não respondeu. O cupom pode ter sido autorizado. Consulte antes de qualquer outra coisa e não emita outro cupom para esta venda até lá." | **Consultar na SEFAZ** (desabilitado até a hora, com a linha "Disponível às 14h07.") + `<details>` "O cliente não pode esperar?" (abaixo) |
| `nao_enviado` | warn, `CircleAlert`, "Não saiu" | "A SEFAZ não recebeu o cupom, e nada foi registrado." + a frase da causa (6.1) | **Enviar de novo** · **Descartar…** · em "Mais opções": Conferir na SEFAZ |
| `nao_consta` | warn, `CircleAlert`, "A SEFAZ não tem este cupom" | "A SEFAZ confirmou que não tem este cupom. Envie de novo ou descarte." | **Enviar de novo** · **Descartar…** |
| `rejeitado` | bad, `CircleAlert`, "Recusado pela SEFAZ" | a frase da família (6.1) + `<details>` "Mensagem da SEFAZ (código N)" com o `xMotivo` como veio | depende da família (6.1): **Corrigir os produtos** (`/cupom?aba=produtos&cupom=<id>`) e então **Enviar de novo**; ou **Descartar…**. No 539 só **Descartar…**. Em "Mais opções": Conferir na SEFAZ (a consulta opcional da §5.1, que o passo 5 do 1º teste usa) |
| `autorizado` | ok, `CheckCircle2`, "Autorizado" | "Autorizado às 14h05 · protocolo 13526000000000012" + "Dá para cancelar até 14h34 (faltam 27 min)" | **Imprimir** · **Mostrar QR para o cliente** · **Compartilhar o link** · **Cancelar o cupom…** (outline, texto vermelho) · **Novo cupom** · em "Mais opções": Baixar o arquivo do cupom (XML) · Copiar a chave de acesso · Conferir na SEFAZ |
| `autorizado` com alerta (120) | ok + caixa âmbar | "Autorizado, com um aviso da SEFAZ: “<xMsg>”. O cupom vale. Mostre o aviso ao contador." | as do autorizado |
| `cancelando` | warn, `Loader2`, "Cancelando" | sem resposta: "O pedido de cancelamento saiu às 14h20 e a SEFAZ não respondeu." · 573: "A SEFAZ diz que já recebeu um pedido de cancelamento deste cupom." Nos dois casos, mais: "Consulte a partir das 14h22. Até lá, o cupom continua valendo e a venda continua no estoque." | **Consultar na SEFAZ** (sem imprimir) |
| `cancelado` | muted, `Ban`, "Cancelado" | "Cancelado às 14h20. Motivo: <motivo>." | **Baixar o arquivo do cupom (XML)** · **Baixar o arquivo do cancelamento (XML)** |
| `denegado` | bad, `Ban`, "Uso negado" | "A SEFAZ negou o uso do cupom (código N): <motivo>. O número foi gasto. Fale com o contador." | **Baixar o arquivo do cupom (XML)** |
| `descartado` | muted, "Descartado" | "Descartado em 17/11 às 14h30 por Diego. Motivo: <motivo>. O número 12 vai para o próximo cupom." (no 539: "O número 12 não volta a ser usado.") | **Refazer com estes itens** |

- **"Enviar de novo"** (sob o botão, a linha "Tentativa 2 de 3"): "Envia o mesmo cupom, com o mesmo número e a hora nova, relendo os dados fiscais dos produtos. Os itens, os preços e o pagamento não mudam." Para mudar a venda: Descartar e **Refazer com estes itens**.
  - Na 3ª tentativa, o botão some, e a caixa diz "Este cupom já foi enviado 3 vezes. Descarte e emita outro."
  - Com a emissão parada ou bloqueada, o botão fica `aria-disabled`, com a frase da caixa do topo.
- **"Consultar na SEFAZ"**: o botão vira "Consultando…" (`Loader2`, travado). Ao fim, a página mostra a nova situação, e o toast diz uma destas:
  - "A SEFAZ autorizou este cupom.";
  - "A SEFAZ não tem este cupom.";
  - "O cupom continua sem resposta (código N). Tente de novo às 14h09.";
  - "A SEFAZ negou o uso deste cupom." (vira `denegado`);
  - em `cancelando`: "Cancelamento registrado na SEFAZ." (vira `cancelado`) ou "O cancelamento não entrou na SEFAZ; o cupom continua valendo." (volta a `autorizado`, com "Dá para cancelar de novo até 14h34" ou, passado o prazo, a frase da 4.4);
  - erros de espera em caixa âmbar, não em toast.
- **"O cliente não pode esperar?"** (`<details>`; o texto é procedimento proposto, **à espera do contador**, decisão 9.5): "Se o cliente precisa ir, emita esta venda pelo caixa de hoje. Depois, consulte este cupom: se a SEFAZ não o tiver, descarte; se ele tiver sido autorizado, cancele-o em até 30 minutos, para a venda não ficar com dois cupons." Até a resposta, o `<details>` não aparece.
- **"Refazer com estes itens"**: abre a aba Emitir com a mesma venda (produtos, quantidades, desconto, pagamento e CPF), com os preços relidos (WCAG 3.3.7).
  - Um produto que não entra mais fica de fora, com o aviso "Chopp 1 litro ficou de fora: falta NCM."
  - Os dados passam pela memória da página (estado do roteador ou do TanStack Query), não pelo storage.
- **Mais opções** (`<details>` "Mais opções", alvo ≥ 44 px): ações raras, longe das principais.
  - "Conferir na SEFAZ" leva a "Consultar" e passa pelas mesmas travas.
  - "Copiar a chave de acesso" copia os 44 caracteres; toast "Chave copiada."
- **Em modo de teste**, sob o DANFE: "No modo de teste, a SEFAZ exige que o 1º produto saia com o texto “NOTA FISCAL EMITIDA EM AMBIENTE DE HOMOLOGACAO - SEM VALOR FISCAL” no lugar do nome. No cupom valendo, sai o nome certo." Sem essa linha, o admin acha que o cadastro está errado.
- Carregando: `Skeleton` do cabeçalho + bloco do papel. Não achou (404): "Não achei este cupom." [Ver cupons emitidos]. Erro: "Não consegui ver o cupom agora. Toque em Tentar de novo."

### 3.2 Venda no estoque (linha sob a caixa; só em autorizado e cancelado)
| Caso | Tom | Texto | Ação |
|---|---|---|---|
| lançada | neutro | "A venda baixou o estoque." | — |
| lançar falhou (`venda_erro`, autorizado) | âmbar | "A venda deste cupom não baixou o estoque: <frase>. O cupom vale; só o estoque está atrasado." | **Lançar no estoque de novo** |
| desfazer falhou (cancelado) | âmbar | "Este cupom foi cancelado, mas a venda ainda está no estoque: <frase>." | **Tirar a venda do estoque** |
| desfeita (cancelado) | neutro | "A venda saiu do estoque." | — |
| modo de teste | neutro | "Cupom de teste: não mexe no estoque." | — |
| `cupom_lanca_venda = false` | neutro | "O cupom não mexe no estoque: a importação de vendas do caixa de hoje já conta esta venda." | — |

O botão chama `POST …/lancar-venda` (não fala com a SEFAZ). Sucesso: toast "Venda lançada no estoque." / "Venda tirada do estoque." Erro: a nova frase na mesma linha. A tela precisa de um campo só, já calculado (ponto 10.8).

### 3.3 O DANFE na tela
- Só para `autorizado`. Montado do `GET …/danfe`, ou seja, só do XML guardado.
- **Dentro do bloco, nada que não esteja no XML** (ou no retorno: protocolo e aviso). Os textos fixos ficam ao pé da letra, sem "simplificar": "Documento Auxiliar da Nota Fiscal de Consumidor Eletrônica", "CONSUMIDOR NÃO IDENTIFICADO" / "CONSUMIDOR CPF: …", "EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO – SEM VALOR FISCAL", "Consulte pela Chave de Acesso em", "Protocolo de autorização:".
- Fora do bloco ficam as faixas, os botões, a contagem e o aviso do modo de teste, todos `no-print`.
- **O papel:**
  - na tela, `w-full max-w-[80mm]`, que encolhe sem rolagem lateral a 320 px (WCAG 1.4.10);
  - fundo branco, texto preto, fonte ≥ 12 px na tela, sem herdar o tema escuro;
  - QR com margem branca de 4 módulos, correção de erros M e pelo menos 25 mm (na tela, ≥ 96 px).
- **Leitor de tela:** o bloco é texto de verdade, não imagem, com `aria-label="Cupom fiscal nº 12"`. O QR tem `alt="QR Code do cupom. O link de consulta está logo abaixo."`, e o link (`urlChave`) aparece escrito.
- Esboço: E8.

### 3.4 Imprimir (`/cupom/[id]/imprimir`)
- **Abrir:** o botão "Imprimir" do cupom abre a página com `?imprimir=1`. A página chama `window.print()` **uma vez**, depois que o QR desenha.
- **Barra no alto** (`no-print`): "← Voltar ao cupom" e **Imprimir** (para imprimir de novo, ou se o navegador barrou a impressão automática).
- **Ajuda** (`no-print`): "Escolha a impressora de cupom (80 mm). Na janela de impressão, deixe as margens em “Nenhuma” e a escala em 100%. Também imprime em folha A4."
- **Impressão:** `@page { margin: 0 }` e o DANFE com 72 mm de largura útil (a impressora de 80 mm não imprime nas bordas); o papel de 80 mm se escolhe no diálogo de impressão, como a Ajuda diz (o `size: 80mm auto` do esboço não é CSS válido: decisão T16-2, desenho §12). Só o DANFE sai no papel; o menu e os botões já são `no-print`.
- **Cupom que não está autorizado:** "Este cupom não está autorizado, então não há cupom para imprimir." + [Voltar ao cupom]. Em `cancelado`: "Cupom cancelado às 14h20: não se imprime de novo."
- Título da aba do navegador: "Cupom nº 12 — imprimir".

### 3.5 Mostrar QR, compartilhar e arquivo
- **Mostrar QR para o cliente:** `Dialog` de tela cheia no celular, com o QR grande (≥ 60% da largura) em fundo branco.
  - Texto: "Peça ao cliente para apontar a câmera do celular: abre o cupom no site da SEFAZ."
  - Botão **Fechar**, com o foco nele.
- **Compartilhar o link:** `navigator.share({ title: "Cupom fiscal nº 12", text: "Seu cupom fiscal de <nome fantasia> (R$ 50,00):", url: <link do QR> })`.
  - Sem Web Share, copia o link; toast "Link do cupom copiado."
- **Arquivo do cupom (XML):** baixa `cupom-2-12.xml`. Cancelado: também `cancelamento-2-12.xml`.
- **QR e link vêm como extra, não como troca do papel:** o `tpImp` é sempre 4 nesta fase.
  - Se o contador disser que basta o QR ou o link (o admin no celular não tem impressora), a escolha "impresso ou no celular" teria de vir **antes** do envio, porque o `tpImp` vai no XML assinado. Ver o ponto 10.9.
  - Até lá, "Imprimir" é a ação primária no celular e no computador.

### 3.6 "NÃO É DOCUMENTO FISCAL" e a pré-conta
- **Fase 1:** a tela não imprime pré-conta (desenho, B.7), e "Imprimir" só existe com o cupom autorizado.
- **Página de cupom não autorizado** (ou de cupom cancelado, se alguém usar Ctrl+P): mostra "Resumo da venda" (itens, totais, pagamento, CPF), nunca um DANFE.
  - O CSS de impressão dessa página põe, em cima e embaixo, uma linha só de impressão, em negrito e no mínimo do tamanho do total: **"NÃO É DOCUMENTO FISCAL"**.
  - No cancelado: **"CUPOM CANCELADO — NÃO É DOCUMENTO FISCAL"**.
- **Fase 2, pré-conta da mesa** (texto reservado):
  - no alto, centralizado, em negrito e maior que o resto: **"NÃO É DOCUMENTO FISCAL"**;
  - depois "Conferência de conta · Mesa 4 · 14h05", os itens e "Total";
  - no pé, de novo **"NÃO É DOCUMENTO FISCAL"** + "Peça o cupom fiscal no caixa."

## 4. Emitidos e cancelamento
### 4.1 Lista
- **Filtros:**
  - "Período" (`Select` nativo, `h-11`): Hoje (padrão) · Ontem · Últimos 7 dias · Este mês · Mês passado · Escolher datas (dois campos de data);
  - situação, em botões que quebram linha (sem rolagem lateral): **Todos** · **Precisam de você (N)** · **Autorizados** · **Cancelados** · **Descartados**.
  - "Precisam de você" junta `sem_resposta`, `nao_enviado`, `nao_consta`, `rejeitado`, `cancelando` e a venda pendente no estoque (ponto 10.6).
- **Ambiente:**
  - com o servidor em teste, a lista é de cupons de teste (a faixa do modo de teste já está acima);
  - com o servidor valendo, a lista mostra só os cupons valendo, e o botão "Ver cupons de teste" troca a lista. Cada cupom de teste leva a tag muted "Teste". Ver o ponto 10.6.
- **Celular:** um cartão por cupom, e o cartão inteiro é link para `/cupom/[id]` (≥ 44 px). Dentro do cartão:
  - "Cupom nº 12" e o valor;
  - "Hoje às 14h05 · Dinheiro" (duas formas: "Dinheiro + PIX");
  - a tag da situação;
  - a próxima ação em uma linha: "Dá para cancelar até 14h34" · "Consulte a partir das 14h07" · "Envie de novo ou descarte" · "A venda não baixou o estoque".
- **Computador:** tabela com Nº · Data e hora · Valor · Pagamento · Cliente (CPF mascarado `***.456.789-**`; sem documento, "—") · Situação (tag + próxima ação) · [Ver]. Ordem: mais novo primeiro. Mesmo dado, duas apresentações (`md:hidden` / `hidden md:block`), como na aba Notas da SEFAZ.
- **Carregando:** 3 cartões `Skeleton`.
- **Erro:** "Não consegui ver os cupons agora. Toque em Tentar de novo." [Tentar de novo].
- **Vazio:**
  - hoje, sem filtro: "Nenhum cupom emitido hoje." [Emitir cupom];
  - com filtro: "Nenhum cupom com este filtro." + link "Ver todos";
  - "Precisam de você" vazio: `CheckCircle2` "Tudo certo. Nenhum cupom precisa de você."
- **Limite:** 100 por vez. Com mais, a linha "Mostrando os 100 mais novos. Escolha um período menor."

### 4.2 Faixa de pendentes (acima das abas, nas três)
Âmbar, `role="status"`, link [Ver] com 44 px:
- um sem resposta: "1 cupom ficou sem resposta da SEFAZ. Consulte antes de emitir outro para a mesma venda." [Ver o cupom];
- um recusado ou não enviado: "O cupom nº 11 não saiu. Envie de novo ou descarte." [Ver o cupom];
- venda pendente: "O cupom nº 9 está autorizado, mas a venda não baixou o estoque." [Ver o cupom];
- vários: "3 cupons precisam de você." [Ver], que abre Emitidos em "Precisam de você".

Para o link ir direto ao cupom, a situação precisa trazer o id e o tipo do 1º pendente (ponto 10.7).

### 4.3 Cancelar (`AlertDialog`, só um aberto por vez)
- **Título:** "Cancelar o cupom nº 12 na SEFAZ?"
- **Corpo:** "O cupom de R$ 50,00, das 14h05, deixa de valer e a venda sai do estoque. Depois de cancelado, não dá para desfazer."
  - Em teste, mais esta frase: "É um cupom de teste: o cancelamento também é de teste."
- **Prazo** (linha própria, com `CircleAlert` quando faltar pouco): "Dá para cancelar até 14h34 (faltam 23 minutos)."
  - O prazo é autorização + 29 min (folga do desenho), com a hora vinda do servidor.
  - A linha se atualiza a cada minuto. Faltando 5 minutos ou menos, fica âmbar: "Faltam 4 minutos para o prazo."
  - Anúncio (`aria-live="polite"`) só faltando 5 min, faltando 1 min e ao acabar. É prazo da SEFAZ, que a tela não pode estender (WCAG 2.2.1, exceção de tempo real).
- **Motivo:**
  - rótulo "Por que está cancelando? (vai para a SEFAZ)";
  - atalhos que preenchem o campo (todos com 15 letras ou mais): "Cliente desistiu da compra" · "Erro nos itens do cupom" · "Erro na forma de pagamento" · "Cupom emitido em duplicidade";
  - `Textarea` editável, com o contador "26 letras (mínimo 15, máximo 255)".
- **Erros** (caixa no diálogo, foco nela):
  - "Escreva o motivo com pelo menos 15 letras (faltam 4).";
  - "Use no máximo 255 letras.";
  - "Use só letras, números e pontuação comum (sem emoji)." (ponto 10.13).
- **Botões:**
  - **Voltar sem cancelar** (`AlertDialogCancel`, foco inicial);
  - **Cancelar o cupom** (destrutivo; fica desabilitado sem motivo válido, com a linha "Escreva o motivo.").
  - Nunca "Cancelar" sozinho: no diálogo, "Cancelar" pareceria "fechar".
- **Enviando:** "Cancelando na SEFAZ…" com `Loader2`. O diálogo fica travado: Esc e toque fora não fecham.
- **Resultado:**
  - 135: o diálogo fecha, a página mostra `cancelado`, e o toast diz "Cupom nº 12 cancelado na SEFAZ.";
  - 573 ou sem resposta: o diálogo fecha e a página mostra `cancelando`;
  - fora do prazo: caixa vermelha no diálogo, "Passaram 30 minutos da autorização (às 14h05). A SEFAZ não aceita mais cancelar este cupom. Fale com o contador.", e o botão some;
  - outro código: "A SEFAZ não aceitou o cancelamento (código N): <motivo>. O cupom continua valendo." + **Tentar de novo**.
- **O prazo acaba com o diálogo aberto:** o botão some e aparece a frase do "fora do prazo".

### 4.4 Depois dos 30 minutos
- Na tela do cupom, o botão "Cancelar o cupom…" some, e a linha vira "O prazo para cancelar terminou às 14h34."
- Abaixo, o `<details>` "E agora?": "A SEFAZ só aceita cancelar um cupom em até 30 minutos depois da autorização. Passado isso, o cupom continua valendo e a venda continua no estoque. Fale com o contador para saber como acertar."
- Na lista, a linha de próxima ação some.

### 4.5 Descartar (`AlertDialog`; só em `nao_enviado`, `nao_consta` e `rejeitado`)
- **Título:** "Descartar o cupom nº 12?"
- **Corpo:** "A SEFAZ não registrou este cupom, então não precisa cancelar. O número 12 vai para o próximo cupom." No 539: "A SEFAZ diz que outra nota já usa este número; ele não volta a ser usado."
- **Motivo** (`RadioGroup`, obrigatório, 44 px): "Vou corrigir e emitir de novo" · "A venda não aconteceu" · "Emiti por engano" · "Outro motivo". Este último abre "Escreva o motivo", obrigatório. Sem escolha, a linha "Escolha o motivo."
- **Botões:** **Manter o cupom** (foco inicial) · **Descartar o cupom**.
- **Sucesso:** toast "Cupom descartado." A página mostra a situação `descartado` com **Refazer com estes itens**.
- **Erro:** caixa no diálogo, com a frase do servidor.

### 4.6 Para o contador (XML do mês)
- **Onde:** um `Panel` "Para o contador" no fim da aba Emitidos.
- **Campos:** `Select` "Mês", com o padrão "mês passado" até o dia 10 e "este mês" depois. O botão **Baixar os cupons de outubro/2026** baixa `GET …/xml-do-mes`, do ambiente do servidor.
- **Ajuda:** "Um arquivo .zip com os cupons autorizados, com uso negado e cancelados do mês, mais a lista dos números que não foram usados. Mande ao contador todo mês."
- **Em teste:** o botão é "Baixar os cupons de teste de outubro/2026", com a linha "Cupons de teste não vão para o contador; o arquivo serve para conferir."
- **Durante:** "Preparando o arquivo…". **Erro:** em caixa no painel, com "Tentar de novo".

## 5. Configurações fiscais
Os dados ficam em dois lugares (decisão minha, porque o desenho não diz onde se editam os perfis):
- **Configurações → aba "Cupom fiscal"**: empresa, numeração, CSC, caixa de hoje e ligar/desligar. É coisa de uma vez.
- **Cupom Fiscal → aba "Produtos"**: perfis fiscais e dados de cada produto. Eles andam juntos: o perfil que falta aparece quando se cadastra o produto.

A aba de Configurações tem o título `Panel` "Cupom fiscal (NFC-e)" (a sigla aparece uma vez, para o contador), a âncora `#cupom-fiscal` e só admin. Cada quadro tem o próprio botão **Salvar …**. O "Salvar" do alto da página continua salvando só Empresa e Geral, e a aba repete isso numa linha: "Cada quadro desta aba tem o próprio botão de salvar." Sucesso: toast "Dados salvos." Erro: caixa vermelha no quadro, com a frase do servidor e o foco nela.
Formulário de uma coluna, rótulo sempre visível e ajuda curta sob o campo (`text-sm`). Validação no blur, com a mensagem junto do campo (`aria-describedby`, `aria-invalid`).
São mais de 4 campos, mas em quadros pequenos (até 6 visíveis cada): é cadastro de uma vez só, feito com o contador, e cada campo é exigido pela SEFAZ.

### 5.1 Quadro "Situação" (o 1º da aba)
- "Este servidor: modo de teste da SEFAZ" / "Este servidor: valendo" / "Este servidor: desligado". Ajuda: "Quem muda é o suporte do Freela Comanda, com a sua autorização." O ambiente não é campo de tela: é a variável `NFCE_AMBIENTE`.
- **Tag da emissão:** "Emissão ligada" (ok) · "Emissão desligada" (muted) · "Parada" (bad) · "Esperando a SEFAZ" (warn, bloqueio ou teto de recusas).
- **"Para ligar a emissão, falta:"** é a lista da `falta` (servidor), com ícone (✓ `CheckCircle2` / ✗ `CircleAlert`) + texto + link que rola até o campo e põe o foco nele (ponto 10.5):

| Item | Texto | Link |
|---|---|---|
| certificado | "Certificado digital válido, do mesmo CNPJ da empresa" | aba Geral, `#certificado-digital` |
| CNPJ | "CNPJ da empresa" | aba Geral, quadro Empresa |
| IE | "Inscrição estadual" | 5.2 |
| CRT | "Regime da empresa" | 5.2 |
| endereço | "Endereço da empresa (rua, número, bairro e CEP)" | 5.2 |
| série | "Série e próximo número do modo de teste" (ou "… valendo") | 5.3 |
| CSC | "Código de segurança (CSC) e número do código (IdCSC) do modo de teste" (ou "… valendo") | 5.3 |
| produto | "Pelo menos 1 produto pronto para o cupom" | Cupom Fiscal → Produtos |
| só valendo: teste | "Um cupom autorizado e um cancelado no modo de teste" | Cupom Fiscal → Emitir |
| só valendo: estoque | "Resposta: quem conta no estoque as vendas emitidas aqui" | 5.4 |
| só valendo: séries | "Séries do caixa de hoje (ou “nenhum outro sistema”), diferentes da série daqui" | 5.4 |

  Os itens que valem só para o valendo aparecem só com o servidor valendo. Aviso que não impede de ligar (âmbar): "2 cupons autorizados ainda não baixaram o estoque."
- **Botão com verbo, não interruptor** (mesma regra do painel da SEFAZ): **Ligar a emissão de cupons** (primário) / **Desligar a emissão** (outline) / **Ligar a emissão de novo** (depois de uma parada).
  - Com a lista incompleta, o botão fica desabilitado e a linha diz "Complete os itens acima para ligar."
  - Com o servidor desligado, não há botão; fica só a frase do servidor desligado (2.1).
  - Mudou o CNPJ ou a série, a emissão desliga sozinha, e o aviso diz: "O CNPJ ou a série mudou desde que a emissão foi ligada. Ligue de novo."
- **Ligar no modo de teste:** sem diálogo. O toast diz "Emissão ligada no modo de teste." + **Desfazer** (8 s).
- **Ligar valendo:** abre um `AlertDialog` (esboço E13).
  - Título "Ligar a emissão valendo?"
  - Corpo: "Os cupons passam a valer como documento fiscal, emitidos em nome da empresa e com o certificado digital."
  - Três confirmações obrigatórias (`Checkbox` com 44 px; o texto do desenho §7.1 virou marcação):
    1. "A série 2 não é usada pelo caixa de hoje (confirmei com quem instalou o caixa).";
    2. "O código de segurança (CSC) é um dos dois da empresa, e não apaguei (revoguei) nenhum no portal da SEFAZ.";
    3. "O contador sabe que o Freela Comanda vai emitir cupons."
  - Em negrito: "**Se a SEFAZ bloquear este sistema por excesso de recusas, o caixa da loja pode parar junto por até 1 hora.**"
  - Botões: **Agora não** (foco inicial) e **Ligar valendo**, que fica desabilitado até as três marcações, com a linha "Marque as três confirmações." Sucesso: toast "Emissão ligada valendo."
- **Desligar:** sem diálogo.
  - Em teste: toast "Emissão desligada." + **Desfazer**.
  - Valendo: só o toast, porque religar pede as três confirmações de novo.
- **Testar a conexão com a SEFAZ** (outline, 44 px; só com o servidor ligado). Respostas, na linha sob o botão (`aria-live`):
  - "A SEFAZ respondeu às 14h05: o serviço está funcionando.";
  - "Não consegui falar com a SEFAZ. Nada foi enviado.";
  - "A SEFAZ está fora do ar agora (código N).";
  - a frase do certificado.
  - Na espera, o botão fica desabilitado, com a linha "Pode testar de novo às 14h10."
- **Paradas:** a caixa vermelha (6.1) aparece também aqui, no topo do quadro, com o link que corrige.
- **Linhas de dados:**
  - "Ligada por Diego em 17/11/2026 às 10h05";
  - `<details>` "Ver histórico", com até 5 linhas: "Ligada por Diego em 17/11/2026 às 10h05" · "Parou sozinha em 17/11/2026 às 15h00: <mensagem>" · "Diego mudou a série e o código de segurança em 18/11/2026 às 09h10" (o nome do campo, nunca o valor do CSC). Ver o ponto 10.11.
- **Carregando:** 3 `Skeleton`. **Erro:** "Não consegui ver a situação do cupom fiscal agora. Toque em Tentar de novo."

### 5.2 Quadro "Empresa no cupom"
| Campo | Rótulo e entrada | Ajuda | Erro |
|---|---|---|---|
| CNPJ, razão, fantasia | só leitura | "Mudam na aba Geral, quadro Empresa." | — |
| IE | "Inscrição estadual"; `inputMode="numeric"`, máscara `000.000.000.000` | "Está no cadastro da empresa na SEFAZ; o contador sabe." | "A inscrição estadual de SP tem 12 números." |
| CRT | "Regime da empresa"; `RadioGroup` com o código no rótulo: "1 Simples Nacional" · "2 Simples Nacional, acima do sublimite" · "4 MEI" · "3 Regime normal (Lucro Presumido ou Real)" (rótulos curtos nossos; conferir o texto oficial do leiaute na implementação, porque a pesquisa só traz o 1, o 3 e o 4) | "Pergunte ao contador. O regime decide quais códigos aparecem nos perfis fiscais." | "Escolha o regime da empresa." |
| logradouro, número, complemento, bairro | "Rua", "Número", "Complemento (opcional)", "Bairro" | — | "Preencha a rua." etc. |
| CEP | "CEP"; `inputMode="numeric"`, máscara `00000-000` | — | "O CEP tem 8 números." |
| município, UF | só leitura "Valinhos, SP (código 3556206)" + link "Mudar município", que abre "Código do município (IBGE)" (7 números) e "Nome do município" | — | "O código do município tem 7 números." |
| telefone | "Telefone (opcional)"; `inputMode="tel"` | — | "Use DDD + número." |
| natureza (em "Mais opções") | "Natureza da operação"; padrão "VENDA" | "Deixe VENDA, a não ser que o contador peça outra." | "Use até 60 letras." |
| texto adicional (em "Mais opções") | "Texto no pé do cupom (opcional)"; `Textarea`, contador até 500 | "Sai no pé do cupom. Use se o contador pedir algum texto." | "Use no máximo 500 letras." |

- **Mudar o regime entre Simples e normal**, com perfis já cadastrados, abre um `AlertDialog`.
  - Título: "Mudar o regime da empresa?"
  - Corpo: "Os 3 perfis fiscais usam códigos do Simples (CSOSN). No regime normal, eles deixam de valer até você trocar por CST, e os produtos desses perfis saem do cupom até lá."
  - Botões: **Manter o regime** (foco) · **Mudar o regime**. Ver o ponto 10.12.
- Botão: **Salvar empresa no cupom**.

### 5.3 Quadro "Numeração e código de segurança"
- Dois blocos: **Modo de teste (homologação)** e **Valendo (produção)**. O do ambiente do servidor vem aberto e primeiro; o outro fica recolhido.
  - Servidor em teste, o bloco valendo diz: "Preencha quando for emitir de verdade: o valendo tem série, número e código próprios."
  - Servidor desligado: os dois abertos.

| Campo | Rótulo e entrada | Ajuda | Erro |
|---|---|---|---|
| série | "Série"; `inputMode="numeric"` | "Número de 0 a 889 que separa os cupons daqui dos do caixa de hoje. Tem de ser diferente da série do caixa de hoje (por exemplo, 2, se ele usa 1)." | "A série vai de 0 a 889." · "A série 1 é do caixa de hoje. Escolha outra." |
| série com pendentes | campo travado (`aria-disabled`) | "Há 1 cupom pendente nesta série. Resolva antes de trocar a série." [Ver o cupom] | — |
| próximo número | "Número do próximo cupom"; `inputMode="numeric"` | "Numa série nova, comece em 1. Último usado nesta série: 41." | "O próximo número tem de ser maior que 41, o último usado na série 2." |
| CSC | "Código de segurança (CSC)"; `type="password"` com olho "Mostrar código"/"Ocultar código" (`aria-pressed`, 44 px), `autoComplete="off"`, `spellCheck={false}`, `autoCapitalize="none"` | "Código que a SEFAZ dá à empresa para o QR Code do cupom (16 a 36 letras e números). Pegue no portal da NFC-e da SEFAZ-SP, em “Gerenciar Cód. Segurança”, ou com quem instalou o caixa de hoje: pode usar o mesmo código dele ou o segundo. O modo de teste tem código próprio." + em negrito "**Não apague (revogue) no portal o código que o caixa de hoje usa: ele para de emitir.**" | "O código de segurança tem de 16 a 36 letras e números." |
| CSC guardado | "Guardado: ••••1234 (por Diego em 17/11/2026)" + link **Trocar o código** (abre o campo vazio) | o valor nunca volta à tela nem ao DOM | — |
| IdCSC | "Número do código (IdCSC)"; `inputMode="numeric"` | "O número que aparece junto do código no portal (por exemplo, 000001 ou 1)." | "O número do código vai de 1 a 999999." |

- Botão por bloco: **Salvar numeração do modo de teste** / **Salvar numeração valendo**.

### 5.4 Quadro "Caixa de hoje"
- **Séries do caixa de hoje:**
  - rótulo "Séries usadas pelo caixa de hoje"; campo numérico + **Adicionar**, e a série vira botão "Série 1 ×" (`aria-label="Tirar a série 1"`);
  - ou o `Checkbox` "Nenhum outro sistema emite cupom fiscal neste CNPJ";
  - ajuda: "Pergunte a quem instalou o caixa de hoje. Com a mesma série nos dois, a SEFAZ recusa os cupons."
  - Erros: "A série vai de 0 a 889." · "Informe as séries do caixa de hoje ou marque que não há outro sistema."
- **"Quem conta no estoque as vendas emitidas aqui?"** (`RadioGroup`, sem padrão). A pergunta "Sim/Não" do desenho invertia o sentido; aqui cada opção diz quem conta:
  - "**O Freela Comanda, pelo cupom**" + "Use se a venda NÃO passa no caixa de hoje. Cada cupom autorizado baixa o estoque pela ficha técnica.";
  - "**A importação de vendas do caixa de hoje**" + "Use se a venda também fica registrada no caixa de hoje (pedido, mesa ou cozinha). O cupom não mexe no estoque."
  - Sem resposta: "Ainda sem resposta. Precisa responder antes de ligar valendo." Respondido: "Respondido por Diego em 17/11/2026 às 10h05."
- Botão: **Salvar caixa de hoje**.

### 5.5 Quadros recolhidos (`<details>`)
- **"Responsável técnico (opcional)":**
  - campos "CNPJ" (com DV), "Nome do contato", "E-mail" (`type="email"`), "Telefone";
  - ajuda: "A empresa responsável pelo sistema. Em SP não é obrigatório; deixe vazio se não souber.";
  - erros: "Preencha os quatro campos, ou deixe todos vazios." · "Este CNPJ não confere."
- **"Reforma tributária (a partir de 2027)":**
  - "Regime do IBS/CBS", `Select` com "Não informar (o caso comum)" e as opções da NT 2026.005 (definir na implementação);
  - ajuda: "Só para empresa do Simples que optou pelo regime regular do IBS/CBS. O contador informa. Guardamos agora; ainda não vai no cupom."

### 5.6 Aba Produtos: perfis fiscais
- **Onde:** um `Panel` "Perfis fiscais" no alto da aba. Vem aberto quando não há perfil, e recolhido (com o resumo "3 perfis") quando há.
- **Abertura:** "Um perfil junta os códigos de imposto que se repetem, como “Prato da casa” ou “Bebida com imposto já pago”. O contador diz quais a casa precisa (costumam ser poucos); depois você só escolhe o perfil de cada produto."
- **Linha de cada perfil:** "Prato da casa — CFOP 5.101 · CSOSN 102 · 64 produtos" + [Editar]. Desativado: tag muted "Desativado". Embaixo, **+ Novo perfil**.
- **Sem regime da empresa:** "Escolha primeiro o regime da empresa em Configurações → Cupom fiscal: ele decide os códigos dos perfis." + [Ir para Configurações]. Sem o regime, não há "+ Novo perfil".
- **Vazio:** "Nenhum perfil ainda. Peça ao contador os perfis da casa." + **+ Novo perfil**.
- **Folha do perfil** (`Sheet`; título "Novo perfil fiscal" ou "Perfil: Prato da casa"). A tela **evita a combinação errada em vez de avisar depois**: as opções que não combinam aparecem desabilitadas, com o motivo.
- Os rótulos curtos abaixo são nossos, com o código sempre na frente, para o contador reconhecer. Conferir o texto oficial na implementação (MOC e tabelas CSOSN/CST/CFOP/origem); a regra de quais valem vem do desenho §3.2.

| Campo | Rótulo e entrada | Ajuda | Erro |
|---|---|---|---|
| nome | "Nome do perfil" | "Um nome que você reconheça, como “Prato da casa”." | "Dê um nome ao perfil." · "Já existe um perfil com este nome." |
| CSOSN (regime Simples ou MEI) | "Código do imposto no Simples (CSOSN)"; `Select`: 102 Tributado pelo Simples, sem permissão de crédito · 103 Isento pela faixa de receita · 300 Imune · 400 Não tributado pelo Simples · 500 ICMS já pago antes (substituição tributária) · 900 Outros | "O contador informa." | "No Simples, escolha o CSOSN." |
| CST do ICMS (regime normal) | "Situação do ICMS (CST)"; `Select`: 00 Tributado integralmente · 20 Com redução da base · 40 Isento · 41 Não tributado · 60 ICMS já pago antes (substituição tributária) · 90 Outros | "O contador informa." | "No regime normal, escolha o CST." |
| alíquota (regime normal) | "Alíquota do ICMS (%)"; `inputMode="decimal"` | — | "Use um número de 0 a 100, com até 2 casas." |
| CFOP | "Tipo de venda (CFOP)"; `Select`: 5.101 Produção própria (feito na casa) · 5.102 Revenda (comprado pronto) · 5.103 Produção própria, vendida fora do estabelecimento · 5.104 Revenda, vendida fora do estabelecimento · 5.115 Revenda recebida em consignação · 5.405 Revenda com imposto já pago antes (substituição tributária) · 5.656 e 5.667 Combustível (raro) | com o CSOSN 500 ou o CST 60: "Com este código de imposto, o CFOP é 5.405." | "O CSOSN 500 só vale com o CFOP 5.405." (frase do desenho) |
| PIS | "CST do PIS (opcional)"; 2 números | "Deixe vazio se o contador não pedir: o cupom pode ir sem PIS e COFINS." | "Use 2 números." |
| COFINS | "CST da COFINS (opcional)"; 2 números | igual | igual |
| 2027, Simples (recolhido: "Reforma tributária (a partir de 2027) — ainda não vai no cupom") | "Atividade no Simples (cAtivSN)" (2 números) · "Alíquota efetiva do IBS (%)" · "Alíquota efetiva da CBS (%)" (até 4 casas) | "O contador informa. Guardamos agora; só vai no cupom quando a SEFAZ começar a pedir." | "Use 2 números." · "Use um número com até 4 casas." |
| 2027, regime normal | "CST do IBS/CBS" (3 números) · "Classificação do IBS/CBS (cClassTrib)" (6 números) | igual | "Use 3 números." · "Use 6 números." |

- Botão **Salvar perfil**. Sucesso: toast "Perfil salvo."
- **Desativar** (outline, texto vermelho; o perfil em uso nunca é apagado). Perfil em uso abre um `AlertDialog`:
  - corpo: "34 produtos usam este perfil e saem do cupom até você escolher outro perfil para eles.";
  - botões: **Manter ativo** (foco) · **Desativar perfil**.

### 5.7 Aba Produtos: dados de cada produto
- **Filtros:** "Buscar produto"; botões **Faltam dados (12)** (padrão quando há) · **Prontos (88)** · **Todos (100)**; `Select` "Categoria". Vindo de um cupom recusado (`&cupom=<id>`), a lista abre só com os produtos desse cupom, com a linha "Produtos do cupom nº 12" e o link "Ver todos".
- **Celular:** um cartão por produto, e o cartão inteiro abre a folha.
  - Conteúdo: nome · categoria · "R$ 12,00" · "NCM 1602.50.00 · Prato da casa".
  - Tag: "Pronto para o cupom" (ok) · "Falta NCM" · "Falta perfil fiscal" · "Sem preço de venda" · "Perfil desativado" (warn, com `CircleAlert`).
- **Computador:** tabela Produto · Categoria · Preço · NCM · Perfil · Situação · [Editar].
- **Vários de uma vez:** o botão "Escolher vários" põe uma caixa de marcar em cada linha e mostra a barra "3 escolhidos · [Aplicar perfil…] [Cancelar]".
  - "Aplicar perfil…" abre um `Dialog` com o `Select` do perfil e **Aplicar a 3 produtos**.
  - Toast: "Perfil “Prato da casa” aplicado a 3 produtos."
  - São cerca de 100 produtos para 3 a 5 perfis: sem isso, é um toque por produto (ponto 10.10).
- **Folha do produto** (`Sheet`; título "Espetinho de carne: dados do cupom"):
  - no topo, só leitura: "Preço de venda R$ 12,00 (muda na ficha técnica)". Sem preço: "Sem preço de venda: preencha na ficha técnica." [Abrir a ficha].

| Campo | Rótulo e entrada | Ajuda | Erro |
|---|---|---|---|
| NCM | "NCM"; `inputMode="numeric"`, máscara `0000.00.00` | "Código de 8 números que classifica o produto. O contador informa." | "O NCM tem 8 números." |
| perfil | "Perfil fiscal"; `Select` dos perfis ativos | "Os códigos de imposto do produto. Se nenhum serve, feche e toque em + Novo perfil, no alto desta aba." (sem abrir folha dentro de folha) | "Escolha o perfil fiscal." |
| *recolhido "Mais dados (opcional)":* CEST | "CEST"; máscara `00.000.00` | "Só para produto com imposto já pago antes (substituição tributária), como bebidas. O contador informa." | "O CEST tem 7 números." |
| GTIN | "Código de barras (GTIN)"; `inputMode="numeric"` | "Os números sob o código de barras da embalagem. Prato da casa não tem: deixe vazio." | "Este código de barras não confere. Confira os números (8, 12, 13 ou 14)." |
| origem | "Origem"; `Select`, padrão "0 Nacional" (1 Estrangeira, importação direta · 2 Estrangeira, comprada no Brasil · 3 Nacional, mais de 40% e até 70% importado · 4 Nacional, processo produtivo básico · 5 Nacional, até 40% importado · 6 e 7 Estrangeira sem similar nacional · 8 Nacional, mais de 70% importado) | "Quase sempre 0 (nacional). Mude só se o contador pedir." | — |
| descrição | "Nome no cupom" (até 120) | "Vazio = o nome do cardápio (Espetinho de carne)." | "Use até 120 letras." |
| unidade | "Unidade no cupom" (até 6) | "Vazio = a unidade de venda da ficha (UN)." | "Use até 6 letras." |

- Botão **Salvar dados do cupom**. Sucesso: toast "Dados de Espetinho de carne salvos." A folha fecha e o cartão mostra a tag nova.
- **Estados:**
  - carregando: 3 `Skeleton`;
  - erro: "Não consegui ver os produtos agora. Toque em Tentar de novo.";
  - cardápio vazio: "O cardápio não tem produtos ativos. Cadastre em Fichas Técnicas." [Ir para Fichas Técnicas];
  - "Faltam dados" vazio: `CheckCircle2` "Tudo certo: todos os produtos estão prontos para o cupom."

### 5.8 Outras telas que mudam
- **Ficha Técnica (admin):** os campos NCM, CFOP, CST e Alíquota dão lugar a uma linha só de leitura:
  - completa: "Cupom fiscal: NCM 1602.50.00 · perfil Prato da casa" + [Editar];
  - incompleta: "Cupom fiscal: faltam NCM e perfil" + [Completar].
  - O link leva a `/cupom?aba=produtos&item=<id>`.
- **Importar Dados (vendas):** caixa âmbar que não bloqueia: "Neste período, o Freela Comanda já lançou 4 cupons no estoque (R$ 210,50). Se essas vendas também estão neste arquivo, vão contar duas vezes." [Ver os cupons], que abre Emitidos no período.
- **Vendas:** as linhas do cupom aparecem com o pedido "NFC-e 2-12", como no desenho.
- **Inventário (fechar):** caixa âmbar: "2 cupons autorizados ainda não baixaram o estoque. Lance antes de fechar, para a contagem bater." [Ver os cupons].

## 6. Textos
### 6.1 Retornos da SEFAZ (tabela §5.3 do desenho → texto final na tela)
- **Padrão de "traduzida":** a frase é nossa, por família do problema, e diz o que fazer. O `xMotivo` da SEFAZ vai como veio, sem o prefixo "Rejeição:", dentro de `<details>` "Mensagem da SEFAZ (código N)": o contador e o suporte precisam dele, o dono não. O código só aparece entre parênteses no fim.
- **A família vem do servidor** (`frases.ts`), pelo código, e não da tela, por palavra (ponto 10.4).
- Nenhum código novo além dos do desenho.

| Retorno (desenho) | Tom | Texto final | Ação na tela |
|---|---|---|---|
| 100 / 150 | ok | "Autorizado às 14h05 · protocolo …" | 3.1 |
| 120 | ok + âmbar | "Autorizado, com um aviso da SEFAZ: “<xMsg>”. O cupom vale. Mostre o aviso ao contador." | 3.1 |
| denegado | bad | "A SEFAZ negou o uso do cupom (código N): <motivo>. O número foi gasto. Fale com o contador." | baixar o arquivo |
| 204 | warn | "A SEFAZ já tem este cupom. Consulte a partir das 14h07 para ver a situação." | Consultar |
| 539 | bad + parada | "A SEFAZ diz que o número 12 da série 2 já foi usado por outra nota: o caixa de hoje pode estar usando esta série. A emissão parou. Descarte este cupom e troque a série em Configurações → Cupom fiscal." | Descartar · [Trocar a série] |
| 704 | bad | "O cupom demorou para sair e a SEFAZ recusou a hora dele. Toque em Enviar de novo: a hora é refeita." | Enviar de novo |
| 108/109 | warn | "A SEFAZ está fora do ar agora (código N). Tente de novo mais tarde ou emita esta venda pelo caixa de hoje e descarte este cupom." | Enviar de novo · Descartar |
| 656 | warn | "A SEFAZ bloqueou os envios deste CNPJ por excesso de recusas. O caixa da loja pode estar bloqueado também: confira se ele está emitindo. Nada sai daqui até as 15h10." | — |
| 2º 656 em 24 h | bad + parada | "A SEFAZ bloqueou este sistema duas vezes em 24 horas. Por segurança, a emissão foi desligada. Fale com o contador e com o suporte do Freela Comanda antes de ligar de novo." | — |
| 781 | bad + parada | "A loja não está credenciada para emitir cupom fiscal neste modo (código 781). Peça ao contador para credenciar no portal da NFC-e da SEFAZ-SP." | — |
| certificado (280–286, 290–298, 213) | bad + parada | "A emissão parou: a SEFAZ recusou o certificado digital (código N). Confira o certificado em Configurações e ligue a emissão de novo." | [Ir para o certificado] |
| esquema e lote (214, 215, 225…) | bad + parada | "A emissão parou por um erro do sistema (código N). Fale com o suporte do Freela Comanda e informe este código." | — |
| QR (373, 394, 395, hash) | bad + parada | "A SEFAZ recusou o QR Code do cupom (código N). Confira o código de segurança (CSC) e o número dele (IdCSC) do modo de teste em Configurações → Cupom fiscal." (valendo: "… valendo …") | [Ir para Configurações] |
| relógio (> 2 min) | bad + parada | "A emissão parou: o relógio do servidor está diferente do da SEFAZ, e cada cupom seria recusado. Fale com o suporte do Freela Comanda." | — |
| teto de recusas | warn | "Muitas recusas da SEFAZ na última hora. Para não bloquear o CNPJ, o envio volta às 15h10. Enquanto isso, confira os dados dos produtos." | [Ver os produtos] |
| demais, família **produto** (NCM, CEST, GTIN, CFOP, CSOSN/CST, origem) | bad | "A SEFAZ recusou um dado fiscal de um produto deste cupom. Confira os produtos (ou peça ao contador) e toque em Enviar de novo." | **Corrigir os produtos** · Enviar de novo · Descartar |
| demais, família **empresa** (IE, endereço, regime) | bad | "A SEFAZ recusou um dado da empresa (inscrição estadual, endereço ou regime). Confira em Configurações → Cupom fiscal e toque em Enviar de novo." | [Ir para Configurações] · Enviar de novo (ponto 10.14) |
| demais, família **consumidor** (CPF/CNPJ) | bad | "A SEFAZ recusou o CPF ou CNPJ do cliente. Descarte este cupom e emita de novo com o documento certo, ou sem ele." | Descartar → Refazer com estes itens |
| demais, família **valores** (totais, pagamento, troco) | bad | "A SEFAZ recusou os valores do cupom. É um erro do sistema: descarte este cupom, emita de novo e avise o suporte do Freela Comanda, informando o código N." | Descartar |
| demais, sem família | bad | "A SEFAZ recusou o cupom (código N). Veja a mensagem abaixo: se ela falar de um produto, confira os produtos; se não, fale com o suporte do Freela Comanda." | Corrigir os produtos · Enviar de novo · Descartar |
| `SefazErro`, `enviado = false` | warn | "Não consegui falar com a SEFAZ. Nada foi enviado; tente de novo." | Enviar de novo |
| `SefazErro`, `enviado = true` | warn | "A SEFAZ não respondeu. O cupom pode ter sido autorizado. Consulte a partir das 14h07 e não emita outro cupom para esta venda até lá." | Consultar |
| `CertificadoErro` | bad | as frases de `MSG_USO` | [Ir para o certificado] |

### 6.2 Erros de validação (§8.4 do desenho → texto final)
| Código | Texto final na tela |
|---|---|
| `NFCE_DESLIGADA` | "A emissão de cupom fiscal não está ativada neste servidor." (+ a frase 2.1, linha 1) |
| `NFCE_EMISSAO_DESLIGADA` | igual ao desenho: "A emissão de cupons está desligada. Ligue em Configurações → Cupom fiscal." |
| `NFCE_CONFIG_INCOMPLETA` | "Falta configurar o cupom fiscal: inscrição estadual e código de segurança (CSC)." (itens com os nomes da 5.1, não os nomes de coluna) |
| `NFCE_SEM_ITENS` | igual: "Adicione pelo menos um produto." |
| `NFCE_ITEM_INDISPONIVEL` | "Chopp 1 litro não pode entrar no cupom: falta NCM." (o motivo em minúscula, com as palavras da tag) |
| `NFCE_DESCONTO_INVALIDO` | "O desconto tem de ser menor que o valor dos produtos (R$ 53,70)." |
| `NFCE_PAGAMENTO_INSUFICIENTE` | igual: "A soma dos pagamentos (R$ 40,00) é menor que o total (R$ 50,00)." |
| `NFCE_TROCO_INVALIDO` | "Troco só sai do dinheiro, e no máximo o valor recebido em dinheiro." |
| `NFCE_DOC_INVALIDO` | "Este CPF não confere. Confira os números." / "Este CNPJ não confere. Confira os 14 caracteres." (um código por tipo, ou o tipo na resposta) |
| `NFCE_DOC_OBRIGATORIO` | igual: "Acima de R$ 10.000,00, o CPF ou CNPJ do consumidor é obrigatório." |
| `NFCE_SITUACAO` | "Este cupom já foi cancelado; não dá para imprimir." (o rótulo da tag, nunca o nome interno) |
| `NFCE_CONSULTA_CEDO` | "Espere até as 14h07 para consultar: a SEFAZ bloqueia consultas repetidas." |
| `NFCE_LIMITE_ENVIOS` | igual: "Este cupom já foi enviado 3 vezes. Descarte e emita outro." |
| `NFCE_CANCELAMENTO_FORA_DO_PRAZO` | "Passaram 30 minutos da autorização (às 14h05). A SEFAZ não aceita mais cancelar este cupom. Fale com o contador." |
| `NFCE_MOTIVO` | cancelar: "Escreva o motivo com pelo menos 15 letras (no máximo 255)." · descartar: "Escolha ou escreva o motivo do descarte." |
| `NFCE_SERIE_INVALIDA` | "A série vai de 0 a 889 e não pode ser uma das séries do caixa de hoje." |
| `NFCE_SERIE_COM_PENDENTES` | "Há cupons pendentes nesta série. Resolva antes de trocar a série." |
| `NFCE_NUMERO_INVALIDO` | igual ao desenho, com "Último usado" visível no campo |
| `NFCE_CSC_INVALIDO` | dividir por campo: "O código de segurança tem de 16 a 36 letras e números." / "O número do código vai de 1 a 999999." |
| `NFCE_PERFIL_INVALIDO` | "No Simples, escolha o CSOSN." · "No regime normal, escolha o CST." · "O CSOSN 500 só vale com o CFOP 5.405." |
| `NFCE_PRODUCAO_SEM_TESTE` | "Antes de ligar valendo, emita e cancele um cupom no modo de teste." |
| `NFCE_LANCA_VENDA_PENDENTE` | "Responda quem conta no estoque as vendas emitidas aqui (quadro Caixa de hoje)." |
| `NFCE_TESTE_CEDO` | "Pode testar de novo às 14h10." |
| `NFCE_PARADA`, `NFCE_BLOQUEADA`, `NFCE_MUITAS_RECUSAS` | as frases da 6.1 |

### 6.3 Linguagem
| Usar | Evitar |
|---|---|
| "cupom", "cupom fiscal" (a sigla NFC-e só no título do quadro de Configurações) | NFC-e, modelo 65, nota (salvo "Nota Fiscal Paulista") |
| "modo de teste da SEFAZ", "valendo", "cupom de teste" | homologação, produção, tpAmb, ambiente (salvo entre parênteses no título do bloco 5.3) |
| "autorizado", "recusado pela SEFAZ", "uso negado", "sem resposta da SEFAZ", "não saiu", "descartado", "cancelado" | cStat, rejeição, denegada, `nao_enviado`, `sem_resposta`, situação |
| "enviar de novo", "consultar na SEFAZ", "conferir na SEFAZ" | reenviar, retransmitir, consulta protocolo |
| "código de segurança (CSC)", "número do código (IdCSC)", "regime da empresa", "perfil fiscal", "tipo de venda (CFOP)" | token, CRT, grupo ICMS, tributação |
| "arquivo do cupom (XML)", "chave de acesso" | nfeProc, XML assinado, chNFe, DANFE (salvo na ajuda da impressão) |
| "a venda baixou o estoque", "a venda não baixou o estoque" | T3, lançar venda, `venda_erro`, movimentação |
| "a SEFAZ bloqueou os envios por excesso de recusas", "a emissão parou" | 656, consumo indevido, `parada_*` |
| "Débito", "Crédito", "PIX", "Vale-refeição", "Vale-alimentação", "troco", "recebido" | tPag, vPag, vTroco, TEF |
| "caixa de hoje" | outro sistema, PDV, ERP |

Tratamento "você"; verbos no imperativo nos botões; ação destrutiva sempre com o objeto no botão ("Cancelar o cupom", "Descartar o cupom"), nunca "Sim/Não" nem "Cancelar" sozinho. Textos fixos do DANFE ficam como o Manual manda, mesmo com sigla ou caixa alta.

### 6.4 Trocas de texto sugeridas
| Desenho | Sugerida | Por quê |
|---|---|---|
| "Cupom fiscal · HOMOLOGAÇÃO — cupons de teste, sem valor fiscal" | faixa "MODO DE TESTE da SEFAZ: estes cupons não valem como documento fiscal e não mexem no estoque." | Jargão; igual ao modo de teste das Notas da SEFAZ; diz também do estoque |
| "Série 2 · próximo nº 12" | "Próximo cupom: nº 12 (série 2)" | Frase, não etiqueta |
| `Pagamento [Dinheiro ▾]` | 6 botões de escolha | 1 toque e opções à vista, em vez de 2 toques |
| "CPF ou CNPJ na nota (opcional)" num campo só | "CPF na nota (opcional)" + "É CNPJ?" | O teclado de números quebra o CNPJ com letras; o CPF é o caso comum |
| `[Emitir cupom]` direto | botão fixo que diz o que falta + "Conferir e emitir" → "Emitir cupom" | Documento fiscal pede conferência (WCAG 3.3.4); botão mudo não ensina |
| "✔ Autorizado · NFC-e série 2 nº 12 · protocolo … · 14:05:31" | título "Cupom nº 12", tag "Autorizado", "Autorizado às 14h05 · protocolo …" | Formato de hora do usuário; sigla fora |
| "Pode cancelar até 14:34" | "Dá para cancelar até 14h34 (faltam 23 min)" | Mostra quanto tempo resta |
| `[Ver XML]` | "Baixar o arquivo do cupom (XML)", em "Mais opções" | O dono não "vê" XML; ação rara |
| `[Cancelar]` | "Cancelar o cupom…" e, no diálogo, "Voltar sem cancelar" / "Cancelar o cupom" | "Cancelar" no diálogo parece "fechar" |
| "1 cupom sem resposta da SEFAZ: consulte antes de emitir de novo" | "1 cupom ficou sem resposta da SEFAZ. Consulte antes de emitir outro para a mesma venda." [Ver o cupom] | "Emitir de novo" confunde com "Enviar de novo"; o risco é a venda com dois cupons |
| "Venda não lançada no estoque: <frase> [Lançar de novo]" | "A venda deste cupom não baixou o estoque: <frase>. O cupom vale; só o estoque está atrasado." [Lançar no estoque de novo] | Tranquiliza sobre o cupom; o botão diz onde lança |
| "As vendas emitidas aqui também ficam registradas no outro sistema? — Não… / Sim…" | "Quem conta no estoque as vendas emitidas aqui?" + "O Freela Comanda, pelo cupom" / "A importação de vendas do caixa de hoje" | O "Sim" queria dizer "não lançar": sentido invertido |
| Texto corrido de confirmação do §7.1 | 3 caixas de marcar obrigatórias + o aviso do caixa em negrito | Parágrafo longo não é lido; marcar obriga a pensar em cada ponto |
| Interruptor "Emitir cupons" | Botão "Ligar a emissão de cupons" / "Desligar a emissão" | Mesma regra das Notas da SEFAZ (§6 de lá): interruptor que abre confirmação confunde |
| "A SEFAZ bloqueou os envios deste CNPJ por consumo indevido" | "… por excesso de recusas … confira se ele está emitindo" | "Consumo indevido" soa a culpa; diz o que conferir |
| "Avise o suporte" | "Fale com o suporte do Freela Comanda e informe este código" | "Suporte" de quem; o código ajuda |
| "Faça o credenciamento no portal da SEFAZ-SP" (781) | "Peça ao contador para credenciar no portal da NFC-e da SEFAZ-SP" | Quem faz é o contador |
| "Escreva o motivo com 15 a 255 caracteres" | "… pelo menos 15 letras (no máximo 255)" + contador | Igual às Notas da SEFAZ ("letras"); o contador mostra quanto falta |
| "CPF ou CNPJ do consumidor inválido" | "Este CPF não confere. Confira os números." | "Inválido" está na lista do que evitar |
| Etiquetas "falta NCM", "falta perfil", "sem preço de venda" | "Falta NCM", "Falta perfil fiscal", "Sem preço de venda" | Começo em maiúscula; "perfil" sozinho é vago |
| Na busca "só aparecem produtos com NCM, perfil e preço" (§2.1) | Os prontos podem ser adicionados; os outros aparecem em cinza, no fim, sob "Não entram no cupom:", com "Completar" | Produto escondido parece produto sumido; a regra do servidor não muda (só os prontos entram) |
| Ligar (§7.1), sem dizer como | Em teste: sem diálogo, toast com Desfazer. Valendo: diálogo com 3 confirmações | O teste não vale como documento e não mexe no estoque; o diálogo fica para o que tem risco |

### 6.5 Frases que as tarefas criaram (a UX não fixava)
Registradas na leva pré-final (18/11/2026), item 17. Todas seguem a §6.3; as do servidor saem de `api/src/modules/cupom-fiscal/frases.ts`
(fonte única: também as do cadastro, que vinham de `frases-cadastro.ts`), geradas pelas próprias funções com valores de exemplo.
As tabelas 6.1 e 6.2 continuam o texto final do que já estava nelas.

**Servidor**

| Onde aparece | Fonte | Texto |
|---|---|---|
| Validação do perfil | `FRASES_VALIDACAO.osDois` | "Escolha o CSOSN (Simples) ou o CST (regime normal), não os dois." |
| Validação do perfil | `FRASES_VALIDACAO.csosnSemSt` | "O CSOSN 102 só vale com o tipo de venda (CFOP) 5.101, 5.102, 5.103, 5.104 ou 5.115." |
| Validação do perfil | `FRASES_VALIDACAO.cfopFora` | "O tipo de venda (CFOP) 5.933 não entra no cupom." |
| Validação do perfil (decisão T6-2) | `FRASES_VALIDACAO.cst20` | "O CST 20 ainda não pode ser usado no Comanda. Fale com o contador." |
| Validação do perfil (decisão T5-3) | `FRASES_VALIDACAO.semAliqIcms` | "Informe a alíquota do ICMS." |
| Validação do perfil (decisão T6-3) | `FRASES_VALIDACAO.pisCofinsBarrado` | "Este CST de PIS/COFINS ainda não pode ser usado no Comanda. Fale com o contador." |
| Validação do produto | `FRASES_VALIDACAO.nomeCaractere` | "O nome no cupom não confere: a SEFAZ não aceita emoji nem símbolos." |
| Validação do produto | `FRASES_VALIDACAO.unidadeCaractere` | "A unidade no cupom não confere: a SEFAZ não aceita emoji nem símbolos." |
| Validação do perfil | `FRASES_VALIDACAO.semCfop` | "Escolha o tipo de venda (CFOP)." |
| Validação do perfil | `FRASES_VALIDACAO.semCodigo` | "Escolha o CSOSN (Simples) ou o CST (regime normal)." |
| Validação do perfil | `FRASES_VALIDACAO.csosnFora` | "O CSOSN 101 não entra no cupom." |
| Validação do perfil | `FRASES_VALIDACAO.cstFora` | "O CST 10 não entra no cupom." |
| Validação do perfil | `FRASES_VALIDACAO.cst60` | "O CST 60 só vale com o tipo de venda (CFOP) 5.405." |
| Validação do perfil | `FRASES_VALIDACAO.aliqIcms` | "A alíquota do ICMS vai de 0 a 100, com até 2 casas." |
| Validação do perfil | `FRASES_VALIDACAO.pisCst` | "O CST do PIS tem 2 números." |
| Validação do perfil | `FRASES_VALIDACAO.cofinsCst` | "O CST da COFINS tem 2 números." |
| Validação do perfil | `FRASES_VALIDACAO.cAtivSn` | "A atividade no Simples (cAtivSN) tem 2 números." |
| Validação do perfil | `FRASES_VALIDACAO.ibsSnAliq` | "A alíquota efetiva do IBS vai de 0 a 100, com até 4 casas." |
| Validação do perfil | `FRASES_VALIDACAO.cbsSnAliq` | "A alíquota efetiva da CBS vai de 0 a 100, com até 4 casas." |
| Validação do perfil | `FRASES_VALIDACAO.ibscbsCst` | "O CST do IBS/CBS tem 3 números." |
| Validação do perfil | `FRASES_VALIDACAO.ibscbsCclassTrib` | "A classificação do IBS/CBS (cClassTrib) tem 6 números." |
| Validação do produto | `FRASES_VALIDACAO.origem` | "A origem vai de 0 a 8." |
| Validação do produto | `FRASES_VALIDACAO.descricao` | "O nome no cupom tem até 120 letras." |
| Validação do produto | `FRASES_VALIDACAO.unidade` | "A unidade no cupom tem até 6 letras." |
| "Testar a conexão" | `FRASE_RETORNO.statusOutroCodigo` | "A SEFAZ não confirmou que o serviço está funcionando (código 252). Fale com o suporte do Freela Comanda e informe este código." |
| Cupom `cancelando` sem pedido nosso e clique "Consultar" sem o evento (Ruling T12 fix-1) | `FRASE_RETORNO.cancelandoSemComprovante` | "A SEFAZ informa que este cupom foi cancelado, mas não mandou o comprovante. Consulte de novo mais tarde." |
| Produto fora do cupom (motivos sem tag na UX) | `FRASE_ERRO.NFCE_ITEM_INDISPONIVEL (inativo)` | "Chopp 1 litro não pode entrar no cupom: inativo." |
| Produto fora do cupom | `FRASE_ERRO.NFCE_ITEM_INDISPONIVEL (perfil_inativo)` | "Chopp 1 litro não pode entrar no cupom: perfil desativado." |
| Produto fora do cupom | `FRASE_ERRO.NFCE_ITEM_INDISPONIVEL (perfil_fora_do_regime)` | "Chopp 1 litro não pode entrar no cupom: o perfil fiscal não vale no regime da empresa." |
| Produto fora do cupom | `FRASE_ERRO.NFCE_ITEM_INDISPONIVEL (nome_fora_do_padrao)` | "Chopp 1 litro não pode entrar no cupom: o nome no cupom tem emoji ou símbolo." |
| Ação recusada pela situação (rótulos da §6.3) | `FRASE_ERRO.NFCE_SITUACAO (exemplo)` | "Este cupom está sem resposta da SEFAZ; não dá para consultar na SEFAZ." |
| Arquivo pedido que o cupom não tem | `FRASE_ERRO.NFCE_SITUACAO (arquivo)` | "Este cupom está autorizado; não dá para baixar o arquivo do cancelamento (XML)." |
| Cupom de teste com o servidor valendo (onda final, item 6; 409 `NFCE_OUTRO_AMBIENTE`) | `FRASE_ERRO.NFCE_OUTRO_AMBIENTE (teste)` | "Este é um cupom de teste, e o Freela Comanda agora emite cupons valendo; não dá para consultar na SEFAZ." |
| Cupom valendo com o servidor no modo de teste (onda final, item 6) | `FRASE_ERRO.NFCE_OUTRO_AMBIENTE (valendo)` | "Este cupom vale como documento fiscal, e o Freela Comanda agora está no modo de teste da SEFAZ; não dá para cancelar. Fale com o suporte do Freela Comanda." |
| Item que arredonda para 0 centavo (leva pré-final, item 2) | `FRASE_ERRO.NFCE_ITEM_SEM_VALOR` | "Cada produto do cupom tem de valer pelo menos R$ 0,01. Confira a quantidade." |
| Cancelamento pedido há menos de 2 min (Ruling T9 I1) | `FRASE_ERRO.NFCE_CANCELAMENTO_CEDO` | "Espere até as 14h06 para pedir o cancelamento de novo: a SEFAZ bloqueia pedidos repetidos." |
| Cancelamento pedido 3 vezes (Ruling T9 I1) | `FRASE_ERRO.NFCE_LIMITE_CANCELAMENTOS` | "O cancelamento deste cupom já foi pedido 3 vezes. Para não bloquear o CNPJ, não sai outro pedido: fale com o contador." |
| Preço mudou entre a tela e o envio (desenho §8.4, adaptada: Ruling T11-2/3) | `FRASE_ERRO.NFCE_TOTAL_MUDOU` | "O preço de algum produto mudou. O total agora é R$ 53,70: confira antes de emitir." |
| Venda sem identificação | `FRASES_EMISSAO.chaveDaVenda` | "Esta venda chegou sem identificação. Recarregue a página e monte a venda de novo." |
| Valores fora do formato | `FRASES_EMISSAO.valorEmCentavos` | "Os valores da venda chegaram fora do formato. Recarregue a página e monte a venda de novo." |
| Total de R$ 200.000,00 em diante | `FRASES_EMISSAO.valorMaximo` | "O total do cupom tem de ser menor que R$ 200.000,00." |
| Preço negativo chegando aos totais (leva pré-final, item 2) | `FRASES_EMISSAO.precoInvalido` | "O preço de algum produto não confere. Confira o preço de venda no cardápio." |
| A venda não baixou o estoque: <frase> | `FRASES_EMISSAO.vendaErro` | "o servidor não conseguiu gravar a venda agora" |
| Arquivo do cancelamento sumido | `FRASES_LEITURA.semArquivoDoCancelamento` | "O arquivo do cancelamento deste cupom não ficou guardado. Fale com o suporte do Freela Comanda." |
| Zip do mês: linha do csv / AVISOS.txt (Ruling T13 I1) | `FRASES_LEITURA.aviso.cancelamentoIndisponivel` | "cancelado — comprovante do cancelamento indisponível, peça ao suporte" |
| Zip do mês: linha do csv / AVISOS.txt | `FRASES_LEITURA.aviso.cupomIndisponivel` | "autorizado — arquivo do cupom indisponível, peça ao suporte" |
| Zip do mês: título do AVISOS.txt | `FRASES_LEITURA.aviso.titulo` | "Cupons de 11/2026 (valendo) com arquivo faltando neste zip. Fale com o suporte do Freela Comanda antes de mandar ao contador:" |
| Zip do mês: linha do AVISOS.txt | `FRASES_LEITURA.aviso.linha` | "Série 2, nº 12: cancelado — comprovante do cancelamento indisponível, peça ao suporte." |
| Números não usados (csv) | `FRASES_LEITURA.naoUsado.semResposta` | "Enviado à SEFAZ sem resposta: só a consulta diz se o número foi usado." |
| Números não usados (csv) | `FRASES_LEITURA.naoUsado.outraNota` | "A SEFAZ diz que outra nota já usa este número (código 539)." |
| Números não usados (csv) | `FRASES_LEITURA.naoUsado.notaSemArquivo` | "A SEFAZ tem uma nota com este número, mas o arquivo dela não está no Comanda." |
| Números não usados (csv) | `FRASES_LEITURA.naoUsado.descartado` | "Descartado: a SEFAZ não registrou este número." |
| Números não usados (csv) | `FRASES_LEITURA.naoUsado.naoSaiu` | "Não saiu: a SEFAZ não recebeu este cupom (ainda pendente no Comanda)." |
| Números não usados (csv) | `FRASES_LEITURA.naoUsado.naoConsta` | "A SEFAZ confirmou que não tem este cupom (ainda pendente no Comanda)." |
| Números não usados (csv): a faixa pulada em Configurações, numa linha ("42 a 999"; onda final, item 2) | `FRASES_LEITURA.naoUsado.puladoAMao` | "pulado à mão em 17/11 por Diego" |
| Números não usados (csv) | `FRASES_LEITURA.naoUsado.recusado` | "Recusado pela SEFAZ (código 225): a SEFAZ não registrou este número (ainda pendente no Comanda)." |
| Empresa no cupom | `FRASES_CADASTRO.municipioDeSp` | "O município tem de ser de SP (código começando com 35)." |
| Empresa no cupom | `FRASES_CADASTRO.semMunicipio` | "Preencha o nome do município." |
| Empresa no cupom | `FRASES_CADASTRO.semNatOp` | "Preencha a natureza da operação (por exemplo, VENDA)." |
| Empresa no cupom (tamanho, por campo) | `FRASES_CADASTRO.campoLongo` | "A rua tem até 60 letras." |
| Empresa no cupom (emoji, por campo) | `FRASES_CADASTRO.caractere` | "O bairro não confere: a SEFAZ não aceita emoji nem símbolos." |
| Empresa no cupom | `FRASES_CADASTRO.email` | "Este e-mail não confere." |
| Caixa de hoje | `FRASES_CADASTRO.semOutroComSeries` | "Marque “nenhum outro sistema” ou informe as séries do caixa de hoje, não os dois." |
| Caixa de hoje (Ruling T10 I1) | `FRASES_CADASTRO.serieDoComanda` | "A série 2 é a do Comanda. O caixa de hoje precisa usar outra série." |
| Reforma tributária | `FRASES_CADASTRO.tpRegimeIbscbs` | "O regime do IBS/CBS não confere." |
| Numeração | `FRASES_CADASTRO.numeroForaDaFaixa` | "O número do próximo cupom vai de 1 a 999999999." |
| Código de segurança sem o segredo do servidor | `FRASES_CADASTRO.semSegredo` | "O servidor ainda não está pronto para guardar o código de segurança. Fale com o suporte do Freela Comanda." |
| Certificado | `FRASES_CADASTRO.certificadoSemCnpj` | "Preencha o CNPJ da empresa na aba Geral para conferir o certificado digital." |
| Certificado | `FRASES_CADASTRO.certificadoOutraEmpresa` | "O certificado digital é de outra empresa (outro CNPJ). Envie o certificado da empresa em Configurações." |
| Perfis | `FRASES_CADASTRO.perfilNomeLongo` | "O nome do perfil tem até 60 letras." |
| Perfis | `FRASES_CADASTRO.perfilDesativado` | "Este perfil fiscal está desativado. Escolha outro." |
| Perfil em lote | `FRASES_CADASTRO.loteTamanho` | "Escolha de 1 a 500 produtos." |
| Produto que sumiu | `FRASES_CADASTRO.produtoSumiu` | "Algum produto escolhido não existe mais. Recarregue a lista." |
| Pagamento | `FRASES_CADASTRO.tPag` | "Escolha a forma de pagamento." |
| Pagamento | `FRASES_CADASTRO.valorPagamento` | "O valor de cada pagamento tem de ser maior que zero." |

**Telas** (só no web)

| Onde aparece | Arquivo | Texto |
|---|---|---|
| Emitir: o pagamento em reais (T14) | `cupom.ts` | "Use um valor como 60,00." · "Use um valor como 3,70." |
| Emitir: a quantidade (T14) | `cupom.ts` | "Use até 4 casas depois da vírgula." · "A quantidade tem de ser maior que zero." |
| Emitir: rótulo do botão quando o pagamento tem erro (T14) | `cupom.ts` | "Confira o pagamento" |
| Emitir: os erros dos totais antes de enviar (T14 e leva pré-final, item 2) | `emitir.tsx` | "O desconto tem de ser menor que o valor dos produtos." · "A soma dos pagamentos é menor que o total." · "O total do cupom tem de ser menor que R$ 200.000,00." · "Quantidade com até 4 casas, ponto como separador e maior que zero." · "O preço de algum produto não confere. Confira o preço de venda no cardápio." · "O valor de cada pagamento tem de ser maior que zero." · "Cada produto do cupom tem de valer pelo menos R$ 0,01. Confira a quantidade." |
| Emitir: a aba não montou (T14) | `cupom/page.tsx` | "Não consegui mostrar a aba Emitir agora. Recarregue a página." |
| Cupom: copiar a chave falhou (T14) | `cupom/[id]/page.tsx` | "Não consegui copiar agora. A chave está no cupom, em "Consulte pela Chave de Acesso"." |
| Tags dos motivos que a UX 5.7 não lista (T14) | `cupom.ts` | "Produto inativo" · "Perfil não vale no regime" |
| A loja na rota do cupom (T14) | `cupom/page.tsx` | "Acesso negado." |
| Faixa de pendentes: o cancelamento sem confirmação (leva pré-final, item 13) | `cupom.ts` | "O cancelamento do cupom nº 12 ainda não foi confirmado pela SEFAZ. Consulte o cupom." |
| Faixa de pendentes: o cancelado com a venda no estoque (leva pré-final, item 13) | `cupom.ts` | "O cupom nº 9 foi cancelado, mas a venda continua no estoque." |
| Produtos (filtro) e Emitidos (período) (T15) | `produtos.tsx`, `emitidos.tsx` | "Nenhum produto com este filtro." · "Escolha as duas datas." · "A primeira data tem de ser antes da segunda." |
| Emitidos: próxima ação de casos que a UX não lista (T15) | `cupom.ts` | "Descarte este cupom" · "A venda ainda está no estoque" |
| Perfis (T15) | `perfis.tsx` | "Perfil desativado." · "Perfil ativado." · tag "Não vale no regime da empresa" |
| Configurações › Cupom fiscal (T15) | `cupom-fiscal-panel.tsx` | botões "Salvar responsável técnico" · "Salvar reforma tributária" |
| DANFE: nome da forma de pagamento (leva pré-final, item 12) | `cupom.ts` | o da "Tabela de Meios de pagamento" do Portal NF-e: "Dinheiro" · "Cartão de Crédito" · "Cartão de Débito" · "Vale Alimentação" · "Vale Refeição" · "Pagamento Instantâneo (PIX) - Dinâmico" |

## 7. Esboços (celular 360 px; computador onde indicado)
**E1. Emitir montando (celular).** A meta de 7 toques é com 1 unidade de cada: busca (1), Espetinho (2), Chopp (3), Dinheiro (4), "R$ 60" (5), Conferir e emitir (6), Emitir cupom (7, em E3). O esboço mostra 2 espetinhos e 3 chopps: cada unidade a mais é 1 toque no "+" (aqui, +3, total 10).
```
┌────────────────────────────────────┐
│ Cupom Fiscal                       │
│ Próximo cupom: nº 12 (série 2)     │
│ (!) MODO DE TESTE da SEFAZ: estes  │
│ cupons não valem como documento    │
│ fiscal e não mexem no estoque.     │
│ [ Emitir ][Emitidos][ Produtos ·  ]│
│                     [    12       ]│
│ Buscar produto                     │
│ [ (lupa)                        ]  │
│ Ver por categoria                  │
│ Acabou de entrar: Chopp 300 ml     │
│                  [ − ]  3  [ + ]   │
│ NO CUPOM (2 ITENS)                 │
│ Preços do cardápio (Fichas         │
│ Técnicas).                         │
│ Espetinho de carne       R$ 24,00  │
│ R$ 12,00 cada                      │
│ [ − ]  2  [ + ]            Tirar   │
│ Chopp 300 ml             R$ 29,70  │
│ R$ 9,90 cada                       │
│ [ − ]  3  [ + ]            Tirar   │
│ + Dar desconto                     │
│              Produtos   R$ 53,70   │
│              Total      R$ 53,70   │
│ PAGAMENTO                          │
│ [(v) Dinheiro   ] [ PIX          ] │
│ [ Débito        ] [ Crédito      ] │
│ [ Vale-refeição ] [ Vale-         ]│
│                   [ alimentação  ] │
│ Recebido em dinheiro (R$)          │
│ [ 60,00                         ]  │
│ (Valor certo) (R$ 60) (R$ 100)     │
│ Troco: R$ 6,30                     │
│ + Pagar parte em outra forma       │
│ CPF na nota (opcional)             │
│ [                               ]  │
│ É CNPJ?                            │
│ Com CPF, o cliente também acha o   │
│ cupom na Nota Fiscal Paulista.     │
├────────────────────────────────────┤
│ Total R$ 53,70  [Conferir e emitir]│
│ Troco R$ 6,30                      │
└────────────────────────────────────┘
```
**E2. Busca digitando.**
```
│ Buscar produto                     │
│ [ cho                          (x) ]│
│ 3 produtos encontrados             │
│ ┌────────────────────────────────┐ │
│ │ Chopp 300 ml     R$ 9,90   (+) │ │
│ ├────────────────────────────────┤ │
│ │ Chopp 500 ml     R$ 14,90  (+) │ │
│ │ 2 no cupom                     │ │
│ ├────────────────────────────────┤ │
│ │ Chope de vinho   R$ 16,00  (+) │ │
│ └────────────────────────────────┘ │
│ Não entram no cupom:               │
│ Chopp 1 litro · Falta NCM          │
│ Completar                          │
```
**E3. Conferir o cupom (Sheet), enviando e falha de rede.**
```
┌────────────────────────────────────┐
│ Conferir o cupom                   │
│ Cupom de teste: vai para a SEFAZ,  │
│ mas não vale como documento fiscal.│
│ 2 × Espetinho de carne   R$ 24,00  │
│ 3 × Chopp 300 ml         R$ 29,70  │
│ Total                    R$ 53,70  │
│ Dinheiro                 R$ 60,00  │
│ Troco                     R$ 6,30  │
│ Sem CPF na nota                    │
│ [         Emitir cupom           ] │
│ [       Voltar e corrigir        ] │
└────────────────────────────────────┘
 enviando:   (girando) Enviando à SEFAZ…
             Leva alguns segundos. Não feche esta tela.
 sem rede:   (!) Não consegui falar com o servidor do Freela
             Comanda. O cupom pode ter saído ou não.
             Tentar de novo não emite dois cupons: se o primeiro
             chegou, você vê esse mesmo cupom.
             [ Tentar de novo ]  [ Ver cupons emitidos ]
```
**E4. Emitir sem configuração (celular).**
```
│ [ Emitir ][ Emitidos ][ Produtos ] │
│ ┌────────────────────────────────┐ │
│ │ Para emitir, falta:            │ │
│ │ (x) Inscrição estadual         │ │
│ │     Preencher                  │ │
│ │ (x) Código de segurança (CSC)  │ │
│ │     e número do código do modo │ │
│ │     de teste       Preencher   │ │
│ │ (x) Pelo menos 1 produto pronto│ │
│ │     para o cupom  Ver produtos │ │
│ │ (v) Certificado digital válido │ │
│ └────────────────────────────────┘ │
│ [ Completar: Inscrição estadual  ] │
```
**E5. Emitir (computador, 1280 px).**
```
┌ Cupom Fiscal ── Próximo cupom: nº 12 (série 2) ──────────────────────────────────────────┐
│ (!) MODO DE TESTE da SEFAZ: estes cupons não valem como documento fiscal e não mexem…    │
│ [Emitir] [Emitidos · 1] [Produtos · 12]   Último cupom: nº 11 · R$ 19,80 · 13h50 [Ver]  │
│ ┌ Produtos ─────────────────────────────────────┐ ┌ Pagamento ────────────────────────┐ │
│ │ Buscar produto [ esp                       ]  │ │ (Dinheiro v) (PIX)    (Débito)    │ │
│ │ ↓ ↑ escolhem · Enter adiciona · Esc limpa     │ │ (Crédito) (Vale-refeição) (Vale-  │ │
│ │ > Espetinho de carne      R$ 12,00   (+)      │ │  alimentação)                     │ │
│ │   Espetinho de frango     R$ 11,00   (+)      │ │ Recebido em dinheiro [ 60,00 ]    │ │
│ │ Produto            Qtd          Unit.  Total  │ │ (Valor certo) (R$ 60) (R$ 100)    │ │
│ │ Espetinho de carne [−] 2 [+]   12,00  24,00 Tirar│ Troco R$ 6,30                     │ │
│ │ Chopp 300 ml       [−] 3 [+]    9,90  29,70 Tirar│ + Pagar parte em outra forma      │ │
│ │ + Dar desconto                                │ │ CPF na nota (opcional) [       ]  │ │
│ │                        Produtos   R$ 53,70    │ │ É CNPJ?                           │ │
│ │                        Total      R$ 53,70    │ │ Total R$ 53,70                    │ │
│ └───────────────────────────────────────────────┘ │ [      Conferir e emitir      ]   │ │
│                                                   └───────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```
**E6. Cupom autorizado (celular).**
```
┌────────────────────────────────────┐
│ ← Cupons emitidos                  │
│ Cupom nº 12                        │
│ Série 2 · hoje às 14h05 · R$ 53,70 │
│ (v) Autorizado                     │
│ Autorizado às 14h05 · protocolo    │
│ 13526000000000012                  │
│ Dá para cancelar até 14h34         │
│ (faltam 27 min)                    │
│ Cupom de teste: não mexe no        │
│ estoque.                           │
│ [ Mostrar QR para o cliente      ] │
│ [ Compartilhar o link            ] │
│ [ Cancelar o cupom…              ] │
│ > Mais opções                      │
│ ┌──────────────────────────────┐   │
│ │  (DANFE no papel branco, E8) │   │
│ └──────────────────────────────┘   │
│ No modo de teste, a SEFAZ exige    │
│ que o 1º produto saia com o texto  │
│ “NOTA FISCAL EMITIDA EM AMBIENTE   │
│ DE HOMOLOGACAO…”. Valendo, sai o   │
│ nome certo.                        │
├────────────────────────────────────┤
│ [  Imprimir  ]   [  Novo cupom  ]  │
└────────────────────────────────────┘
```
**E7. Sem resposta e recusado (celular).**
```
│ Cupom nº 11                        │     │ Cupom nº 13                        │
│ Série 2 · hoje às 13h50 · R$ 19,80 │     │ Série 2 · hoje às 14h40 · R$ 9,90  │
│ (!) Sem resposta da SEFAZ          │     │ (!) Recusado pela SEFAZ            │
│ ┌────────────────────────────────┐ │     │ ┌────────────────────────────────┐ │
│ │ A SEFAZ não respondeu. O cupom │ │     │ │ A SEFAZ recusou um dado fiscal │ │
│ │ pode ter sido autorizado.      │ │     │ │ de um produto deste cupom.     │ │
│ │ Consulte antes de qualquer     │ │     │ │ Confira os produtos (ou peça ao│ │
│ │ outra coisa e não emita outro  │ │     │ │ contador) e toque em Enviar de │ │
│ │ cupom para esta venda até lá.  │ │     │ │ novo.                          │ │
│ └────────────────────────────────┘ │     │ │ > Mensagem da SEFAZ (código N) │ │
│ [ Consultar na SEFAZ ] (travado)   │     │ └────────────────────────────────┘ │
│ Disponível às 13h52.               │     │ [ Corrigir os produtos         ]   │
│ > O cliente não pode esperar?      │     │ [ Enviar de novo               ]   │
│ RESUMO DA VENDA                    │     │ Tentativa 2 de 3                   │
│ 2 × Chopp 300 ml        R$ 19,80   │     │ [ Descartar…                   ]   │
│ PIX                     R$ 19,80   │     │ RESUMO DA VENDA …                  │
```
**E8. DANFE 80 mm (tela e papel; divisões I a IX do Manual DANFE v6.0; o leiaute exato das colunas segue o Manual na implementação).**
```
┌──────────────────────────────────────────┐
│ CHOPP E ESPETO VALINHOS LTDA             │  I
│ CNPJ 12.345.678/0001-95                  │
│ R. Exemplo, 123, Centro, Valinhos, SP    │
│ Documento Auxiliar da Nota Fiscal de     │
│ Consumidor Eletrônica                    │
│──────────────────────────────────────────│
│ Código Descrição                         │  II
│ Qtde   Un  Vl unit             Vl total  │
│ 0012   ESPETINHO DE CARNE                │
│ 2,0000 UN  12,00                  24,00  │
│ 0031   CHOPP 300 ML                      │
│ 3,0000 UN   9,90                  29,70  │
│──────────────────────────────────────────│
│ Qtde. total de itens                  2  │  III
│ Valor total R$                    53,70  │
│ Valor a pagar R$                  53,70  │
│ FORMA PAGAMENTO          VALOR PAGO R$   │
│ Dinheiro                          60,00  │
│ Troco R$                           6,30  │
│──────────────────────────────────────────│
│ Consulte pela Chave de Acesso em         │  IV
│ https://www.nfce.fazenda.sp.gov.br/      │
│ NFCeConsultaPublica                      │
│ 3526 1112 3456 7800 0195 6500 2000 0000  │
│ 1210 1234 5678                           │
│              ┌────────┐                  │  V (≥ 25 mm,
│              │   QR   │                  │   margem branca)
│              └────────┘                  │
│ CONSUMIDOR NÃO IDENTIFICADO              │  VI
│ NFC-e nº 12 Série 2 17/11/2026 14:05:31  │  VII
│ Protocolo de autorização:                │
│ 13526000000000012 17/11/2026 14:05:33    │
│ EMITIDA EM AMBIENTE DE HOMOLOGAÇÃO –     │  VIII (só teste)
│ SEM VALOR FISCAL                         │
│ <texto no pé do cupom>                   │  IX
└──────────────────────────────────────────┘
 Em teste, a descrição do 1º item sai com o texto da regra 373, não com o nome.
 Fora do papel (no-print): barra "← Voltar ao cupom · Imprimir" e a ajuda da impressora.
```
**E9. Cancelar (AlertDialog, celular).**
```
┌────────────────────────────────────┐
│ Cancelar o cupom nº 12 na SEFAZ?   │
│ O cupom de R$ 53,70, das 14h05,    │
│ deixa de valer e a venda sai do    │
│ estoque. Depois de cancelado, não  │
│ dá para desfazer.                  │
│ Dá para cancelar até 14h34         │
│ (faltam 23 minutos).               │
│ Por que está cancelando? (vai para │
│ a SEFAZ)                           │
│ (Cliente desistiu da compra)       │
│ (Erro nos itens do cupom)          │
│ (Erro na forma de pagamento)       │
│ (Cupom emitido em duplicidade)     │
│ [ Cliente desistiu da compra    ]  │
│ 26 letras (mínimo 15, máximo 255)  │
│ [      Voltar sem cancelar       ] │  <- foco inicial
│ [        Cancelar o cupom        ] │  (destrutivo)
└────────────────────────────────────┘
```
**E10. Emitidos (celular e computador).**
```
┌────────────────────────────────────┐
│ (!) 1 cupom ficou sem resposta da  │
│ SEFAZ. Consulte antes de emitir    │
│ outro para a mesma venda.          │
│ Ver o cupom                        │
│ [ Emitir ][Emitidos·1][ Produtos ] │
│ Período                            │
│ [ Hoje                        v ]  │
│ (Todos) (Precisam de você · 1)     │
│ (Autorizados) (Cancelados)         │
│ (Descartados)                      │
│ ┌────────────────────────────────┐ │
│ │ Cupom nº 12        R$ 53,70    │ │
│ │ Hoje às 14h05 · Dinheiro       │ │
│ │ (v) Autorizado                 │ │
│ │ Dá para cancelar até 14h34     │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ Cupom nº 11        R$ 19,80    │ │
│ │ Hoje às 13h50 · PIX            │ │
│ │ (!) Sem resposta da SEFAZ      │ │
│ │ Consulte a partir das 13h52    │ │
│ └────────────────────────────────┘ │
│ PARA O CONTADOR                    │
│ Mês [ Outubro/2026            v ]  │
│ [ Baixar os cupons de outubro/2026]│
└────────────────────────────────────┘

 Computador:
 Nº  │ Data e hora      │ Valor    │ Pagamento       │ Cliente          │ Situação                         │
 12  │ 17/11 14h05      │ R$ 53,70 │ Dinheiro        │ —                │ (v) Autorizado · cancelar até 14h34 │ Ver
 11  │ 17/11 13h50      │ R$ 19,80 │ PIX             │ ***.456.789-**   │ (!) Sem resposta · consultar 13h52  │ Ver
```
**E11. Produtos e folha do produto (celular).**
```
│ [ Emitir ][ Emitidos ][Produtos·12]│     ┌────────────────────────────────────┐
│ > Perfis fiscais (3 perfis)        │     │ Espetinho de carne: dados do cupom │
│ Buscar produto                     │     │ Preço de venda R$ 12,00 (muda na   │
│ [                               ]  │     │ ficha técnica)                     │
│ (Faltam dados · 12) (Prontos · 88) │     │ NCM                                │
│ (Todos · 100)                      │     │ [ 1602.50.00                    ]  │
│ Categoria [ Todas             v ]  │     │ Código de 8 números que classifica │
│ Escolher vários                    │     │ o produto. O contador informa.     │
│ ┌────────────────────────────────┐ │     │ Perfil fiscal                      │
│ │ Chopp 1 litro      R$ 32,00    │ │     │ [ Prato da casa               v ]  │
│ │ Chopp                          │ │     │ > Mais dados (opcional)            │
│ │ (!) Falta NCM                  │ │     │ [    Salvar dados do cupom      ]  │
│ └────────────────────────────────┘ │     │ [            Fechar             ]  │
│ ┌────────────────────────────────┐ │     └────────────────────────────────────┘
│ │ Espetinho de carne R$ 12,00    │ │
│ │ NCM 1602.50.00 · Prato da casa │ │
│ │ (v) Pronto para o cupom        │ │
│ └────────────────────────────────┘ │
```
**E12. Configurações → aba Cupom fiscal (celular).**
```
┌────────────────────────────────────┐
│ Configurações                      │
│ [ Geral ][ Contas de  ][ Cupom    ]│
│ [       ][ despesas   ][ fiscal   ]│
│ Cada quadro desta aba tem o próprio│
│ botão de salvar.                   │
│ CUPOM FISCAL (NFC-E)               │
│ Este servidor: modo de teste da    │
│ SEFAZ                              │
│ ( · ) Emissão desligada            │
│ Para ligar a emissão, falta:       │
│ (x) Inscrição estadual  Preencher  │
│ (v) Certificado digital válido     │
│ (v) 3 produtos prontos             │
│ [ Ligar a emissão de cupons ]      │ (desabilitado)
│ Complete os itens acima para ligar.│
│ [ Testar a conexão com a SEFAZ   ] │
│ > Ver histórico                    │
│ EMPRESA NO CUPOM                   │
│ Chopp e Espeto Valinhos Ltda       │
│ CNPJ 12.345.678/0001-95            │
│ Mudam na aba Geral, quadro Empresa.│
│ Inscrição estadual                 │
│ [                               ]  │
│ Regime da empresa                  │
│ (o) Simples Nacional               │
│ ( ) Simples Nacional, acima do     │
│     sublimite                      │
│ ( ) MEI                            │
│ ( ) Regime normal (Lucro Presumido │
│     ou Real)                       │
│ Rua / Número / Complemento /       │
│ Bairro / CEP (um campo por linha)  │
│ Valinhos, SP (código 3556206)      │
│ Mudar município                    │
│ [   Salvar empresa no cupom     ]  │
│ NUMERAÇÃO E CÓDIGO DE SEGURANÇA    │
│ Modo de teste (homologação)        │
│ Série [ 2 ]  Próximo número [ 1 ]  │
│ Código de segurança (CSC)          │
│ Guardado: ••••1234 (por Diego em   │
│ 17/11/2026)    Trocar o código     │
│ Número do código (IdCSC) [ 1 ]     │
│ [ Salvar numeração do modo de    ] │
│ [ teste                          ] │
│ > Valendo (produção)               │
│ CAIXA DE HOJE …  > Responsável     │
│ técnico …  > Reforma tributária …  │
└────────────────────────────────────┘
```
**E13. Ligar valendo (AlertDialog).**
```
┌────────────────────────────────────┐
│ Ligar a emissão valendo?           │
│ Os cupons passam a valer como      │
│ documento fiscal, emitidos em nome │
│ da empresa e com o certificado     │
│ digital.                           │
│ [ ] A série 2 não é usada pelo     │
│     caixa de hoje (confirmei com   │
│     quem instalou o caixa).        │
│ [ ] O código de segurança (CSC) é  │
│     um dos dois da empresa, e não  │
│     apaguei nenhum no portal.      │
│ [ ] O contador sabe que o Freela   │
│     Comanda vai emitir cupons.     │
│ Se a SEFAZ bloquear este sistema   │
│ por excesso de recusas, o caixa da │
│ loja pode parar junto por até 1 h. │
│ [          Agora não             ] │  <- foco inicial
│ [ Ligar valendo ] (desabilitado)   │
│ Marque as três confirmações.       │
└────────────────────────────────────┘
```
**E14. O cupom (computador): situação e ações à esquerda, papel à direita.**
```
┌ ← Cupons emitidos ───────────────────────────────────────────────────────────────────────┐
│ Cupom nº 12 · Série 2 · hoje às 14h05 · R$ 53,70 · Dinheiro                               │
│ ┌ Situação ──────────────────────────────────┐  ┌ papel branco, 80 mm ──────────────┐    │
│ │ (v) Autorizado                             │  │ CHOPP E ESPETO VALINHOS LTDA      │    │
│ │ Autorizado às 14h05 · protocolo            │  │ …                                 │    │
│ │ 13526000000000012                          │  │ (DANFE de E8)                     │    │
│ │ Dá para cancelar até 14h34 (faltam 27 min) │  │ …                                 │    │
│ │ Cupom de teste: não mexe no estoque.       │  │           ┌──────┐                │    │
│ │ [ Imprimir ]  [ Novo cupom ]               │  │           │  QR  │                │    │
│ │ [ Mostrar QR ] [ Compartilhar o link ]     │  │           └──────┘                │    │
│ │ [ Cancelar o cupom… ]                      │  │ …                                 │    │
│ │ > Mais opções                              │  └───────────────────────────────────┘    │
│ └────────────────────────────────────────────┘                                            │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```
**E15. Produtos (computador), com "Escolher vários" ligado.**
```
┌ Perfis fiscais (3) ▸ ─────────────────────────────────────────────────────────────────────┐
│ Buscar produto [            ]  (Faltam dados · 12) (Prontos · 88) (Todos · 100)  Categoria [Todas v] │
│ [x] │ Produto             │ Categoria │ Preço    │ NCM        │ Perfil         │ Situação          │        │
│ [x] │ Chopp 1 litro       │ Chopp     │ R$ 32,00 │ —          │ —              │ (!) Falta NCM     │ Editar │
│ [x] │ Porção de fritas    │ Porções   │ R$ 28,00 │ 2004.10.00 │ —              │ (!) Falta perfil  │ Editar │
│ [ ] │ Espetinho de carne  │ Espetos   │ R$ 12,00 │ 1602.50.00 │ Prato da casa  │ (v) Pronto        │ Editar │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│ 2 escolhidos   [ Aplicar perfil… ]  [ Cancelar ]                                           │
└───────────────────────────────────────────────────────────────────────────────────────────┘
 A folha do produto abre do lado direito (Sheet), com os mesmos campos de E11.
```
**Configurações no computador:** a mesma aba de E12, em uma coluna de até 720 px (como os outros painéis de Configurações). Só o bloco "Numeração e código de segurança" põe Série e Próximo número lado a lado.

## 8. Acessibilidade (WCAG 2.2 nível AA) e o que o browser-check confere
WCAG = Web Content Accessibility Guidelines, as regras de acessibilidade da web; AA é o nível que o projeto adota como piso.

| Critério | Como a tela cumpre |
|---|---|
| 1.3.1 Informação e relações | Rótulo `<Label htmlFor>` em todo campo; escolhas em `role="radiogroup"`; carrinho e lista em `<ul>`; tabela do computador com `<th>` |
| 1.4.1 Uso de cor | Toda tag, caixa e escolha tem ícone + texto; a escolha de pagamento tem borda + ícone |
| 1.4.3 / 1.4.11 Contraste | Texto 4,5:1 e bordas/ícones 3:1 sobre o tema escuro (os tons âmbar e vermelho já usados nos painéis da SEFAZ); DANFE preto no branco |
| 1.4.10 Reflow | Nada com rolagem lateral a 320 px; o papel do DANFE é `w-full max-w-[80mm]`; a tabela só aparece de md para cima |
| 2.1.1 Teclado | Busca com ↓/↑/Enter/Esc; tudo alcançável por Tab na ordem busca → resultados → carrinho → desconto → pagamento → CPF → botão |
| 2.2.1 Tempo ajustável | Os 30 min do cancelamento são prazo da SEFAZ (exceção de tempo real); a tela avisa antes, e nada se perde ao estourar |
| 2.4.3 / 2.4.11 Foco | Foco no título do cupom ao chegar; na caixa de erro quando ela aparece; `scroll-padding-bottom` para a barra fixa não cobrir o campo focado |
| 2.5.8 Tamanho do alvo | Tudo ≥ 44 px (o mínimo da norma é 24), com 8 px entre alvos; o − e o + do carrinho também |
| 3.3.1 / 3.3.3 Erros | Mensagem junto do campo (`aria-invalid`, `aria-describedby`), dizendo o que corrigir; o botão fixo diz o que falta |
| 3.3.4 Prevenção de erro (legal, financeiro) | Passo "Conferir o cupom" antes de emitir; cancelamento em até 30 min; ações destrutivas com diálogo e o foco na opção segura |
| 3.3.7 Entrada redundante | "Refazer com estes itens"; o 2º pagamento já vem com o valor que falta; o CPF fica ao trocar CPF ↔ CNPJ |
| 4.1.3 Mensagens de status | `aria-live="polite"` em "adicionado", troco, "Enviando à SEFAZ…", "Já pode consultar." e os marcos do prazo (5 min, 1 min, fim), nunca a cada segundo; erros com `role="alert"` |
| Movimento (2.2.2, nível A; o 2.3.3 é AAA e entra só como boa prática) | Nada se move sozinho além do `Loader2`, que só gira enquanto espera uma resposta e sempre com o texto ao lado ("Enviando à SEFAZ…"); com `prefers-reduced-motion`, ele fica parado e o texto continua |

Outros pontos:
- Diálogos (`AlertDialog`, Radix) prendem o foco. O foco inicial vai para "Voltar sem cancelar", "Manter o cupom", "Agora não" e "Manter o regime"; o Esc fecha, salvo durante um envio.
- O botão do olho do CSC tem `aria-pressed`.
- Os botões de quantidade levam `aria-label` com o nome do produto ("Aumentar Chopp 300 ml"); "Tirar" leva "Tirar Chopp 300 ml do cupom".

### 8.1 Browser-check com a variável vazia (o que roda de verdade)
O `browser-check.sh` força `NFCE_AMBIENTE` vazia. Por isso este roteiro só vê o servidor desligado.
1. Loja: sem "Cupom Fiscal" no menu e sem a aba "Cupom fiscal" em Configurações; `/cupom` direto mostra o aviso de tela só de admin.
2. Admin: o item vem depois de "Vendas" e aparece sem rolar a faixa do celular. A aba Emitir mostra a caixa "não está ativada neste servidor", com os dois links e sem formulário.
3. Aba Produtos: perfis e produtos podem ser editados (os cadastros funcionam desligados).
   - NCM com máscara; GTIN com o DV errado mostra o erro.
   - A folha do perfil muda entre CSOSN e CST pelo regime, e o CFOP fica filtrado pelo CSOSN 500.
   - "Escolher vários" aplica o perfil.
4. Configurações → Cupom fiscal: "Este servidor: desligado", sem botão de ligar e sem "Testar a conexão".
   - Salvar cada quadro funciona.
   - O CSC salvo aparece como "••••1234", e o valor não aparece no DOM nem na resposta (inspecionar).
5. Ficha Técnica: a linha "Cupom fiscal: …" com o link para a folha do produto.
6. Medidas: 360 px, 390 px (o tamanho do desenho) e 1280 px, nas três abas, na tela do cupom, nos diálogos e na aba de Configurações.
   - Sem rolagem lateral, alvos ≥ 44 px e texto ≥ 14 px.
   - O texto das abas quebra sem cortar.
7. Zoom de 200% (ou 640 px a 2x): sem rolagem lateral.
8. Storage: nada em `localStorage`/`sessionStorage` além de `authUser`, mesmo depois de montar uma venda.

### 8.2 Browser-check com respostas simuladas (`page.route`; nenhuma rede)
9. Pronto para emitir:
   - busca "esp" lista os produtos, e o toque adiciona e mostra "Acabou de entrar";
   - indisponível em cinza, com "Completar";
   - stepper, Tirar com Desfazer, desconto acima do valor com o erro;
   - Dinheiro com os atalhos certos para R$ 53,70 (R$ 60 e R$ 100) e o troco;
   - 2 formas com "Falta R$"; PIX acima do que falta com o erro;
   - CPF com o DV errado; "É CNPJ?" troca o `inputmode` para `text`; total ≥ R$ 10.000 pede o documento;
   - cada rótulo do botão fixo (tabela 2.5), cujo toque leva ao lugar certo.
10. Conferir: o texto muda entre teste e valendo; Emitir → Sheet travado (Esc não fecha) → `/cupom/[id]` com o foco no título; dois toques rápidos geram um POST só.
11. Falha de rede (rota abortada): o Sheet mostra a caixa âmbar e a venda trava. "Tentar de novo" manda a **mesma** `chave_idempotencia` (inspecionar o corpo), e a resposta 200 abre o cupom.
12. Cada situação da tabela 3.1, com tag, tom, texto e ações:
    - 120 com o aviso;
    - as seis linhas da venda no estoque (3.2);
    - "Consultar" travado até a hora e habilitado com o relógio simulado, anunciando "Já pode consultar." e sem fazer nenhuma chamada sozinho;
    - "Enviar de novo" com "Tentativa 2 de 3" e sumindo na 3ª;
    - no 539, só Descartar.
13. Cancelar:
    - foco em "Voltar sem cancelar"; os atalhos preenchem; menos de 15 letras mostra o erro;
    - com o relógio simulado: a linha fica âmbar a 5 min, e depois de 14h34 o botão some, com a frase;
    - o 135 leva a `cancelado`, e o 573 leva a `cancelando`.
14. Descartar: o motivo é obrigatório; o sucesso mostra "Refazer com estes itens", que preenche a aba Emitir e deixa de fora o produto que não entra mais.
15. Imprimir:
    - `window.print` é chamado uma vez (stub);
    - na impressão simulada (`emulateMedia print`), só o DANFE sai, a 80 mm, com o QR ≥ 25 mm, e o texto de homologação aparece em teste;
    - cupom cancelado ou não autorizado: nada para imprimir, e o Ctrl+P sai com "NÃO É DOCUMENTO FISCAL".
16. Emitidos:
    - filtros e "Precisam de você"; cartão → cupom; tabela no computador com o CPF mascarado;
    - faixa de pendentes nas três abas;
    - "Baixar os cupons de …" chama a rota.
17. Bloqueios na aba Emitir: 656 com a hora, muitas recusas, cada parada com o seu link, certificado vencido; o formulário aparece, mas o botão fica travado com o motivo.
18. Configurações:
    - a lista "falta" com os links que rolam e focam;
    - ligar em teste mostra o toast com Desfazer;
    - ligar valendo pede as 3 marcações, com o foco em "Agora não";
    - "Testar a conexão" mostra "Pode testar de novo às …";
    - a série fica travada com pendentes;
    - trocar o regime abre o diálogo.
19. Por teclado no computador: busca → Enter → Tab até o pagamento → Espaço → Tab até o botão → Enter → Emitir cupom, sem mouse.

## 9. Decisões em aberto (dono e contador)
1. **Contador: só o QR ou o link basta como entrega ao cliente?** No celular não há impressora.
   - Se basta, o `tpImp` precisa ser 5 nesses casos. A escolha "impresso ou no celular" iria para o "Conferir o cupom", antes do envio, e "Mostrar QR para o cliente" viraria a ação primária no celular.
   - Até a resposta, o papel é o padrão (`tpImp` 4), e o QR e o link são extras.
2. **Dono e contador: a taxa de serviço** (pergunta 5 do desenho). Se a venda do balcão cobra 10% junto, o PIX ou o cartão passa do total do cupom, e o servidor recusa (troco só em dinheiro). A linha proposta na 2.3 avisa; a resposta decide se ela fica.
3. **Dono: desconto em porcentagem** ("10%") além de reais? A tela converteria para reais antes de enviar; o desenho não muda.
4. **Dono: os atalhos do motivo de cancelamento** (4.3). Os quatro textos servem, ou há outros comuns na casa?
5. **Contador: o que fazer com o cliente esperando, se a SEFAZ não respondeu.** A proposta da 3.1 ("O cliente não pode esperar?") é um procedimento: emitir no caixa de hoje e, depois, descartar este cupom ou cancelá-lo em até 30 min. O texto só aparece com o OK do contador; até lá, a tela diz só para consultar antes de emitir outro.
6. **Dono: "Importar dados fiscais"** (fatia opcional, §3.2 do desenho). Se o contador mandar planilha, ela entra em Importar Dados e substitui boa parte do "Escolher vários" (5.7). Esta especificação não desenha essa importação; ela segue o padrão das outras importações (tudo ou nada).

## 10. Pontos para o desenho técnico
1. **O preço pode mudar entre a tela e o envio, e o troco sai errado sem aviso.**
   - A tela mostra o preço lido ao abrir, e o servidor lê de novo no envio (§3.1).
   - Se o preço subiu e o dinheiro cobre a diferença, o cupom sai autorizado com outro total e outro troco do que o caixa entregou. Só a falta de pagamento vira erro (`NFCE_PAGAMENTO_INSUFICIENTE`).
   - Pedido: o POST levar `total_esperado` (centavos). Se for diferente, 409 `NFCE_TOTAL_MUDOU` com os preços novos, antes da T1 (sem reservar número).
   - **Resposta do desenho (17/11):** Aceito: o POST leva `total_esperado_centavos` (inteiro; todo dinheiro do cupom vai em centavos no fio, desenho §8.2); diferente = 409 `NFCE_TOTAL_MUDOU` antes da T1, sem reservar número. Recusado só o corpo do 409 trazer os preços: o filtro manda só `{ code, message }`, a frase diz o produto e o preço novo, e a tela relê `GET /produtos` (desenho §8.2, §8.4, §11).
2. **Idempotência:**
   - (a) A mesma `chave_idempotencia` com outro corpo devolve o cupom antigo calado (§4.2): pedir a comparação de um resumo do corpo e 409 `NFCE_CHAVE_REUSADA` se diferir.
   - (b) Para "não sei se saiu" (2.7), uma leitura pela chave que **não** emite, por exemplo `GET /v1/cupom-fiscal/cupons?chave_idempotencia=`. Hoje a única forma de saber é reenviar, e isso emite se o 1º não chegou.
   - **Resposta do desenho (17/11):** Aceito as duas: (a) `pedido_hash` do corpo, e a mesma chave com outro corpo = 409 `NFCE_CHAVE_REUSADA`; (b) `GET /v1/cupom-fiscal/cupons?chave_idempotencia=` só lê o nosso banco, devolve `[]` ou o cupom, e funciona com o servidor desligado (desenho §8.1, §8.2).
3. **Horas e ações calculadas pelo servidor.** O `GET /cupons/:id` (e o retorno do POST) devem trazer:
   - `consultar_a_partir_de`, `cancelar_ate` e `acoes: string[]` (o que pode agora: enviar de novo, consultar, cancelar, descartar, lançar venda);
   - `envios`, para a "Tentativa 2 de 3";
   - `agora` (hora do servidor), para a contagem não depender do relógio do celular.
   - Sem isso a tela repete as regras da §4.4 e da §5.4 e erra quando o relógio do aparelho está adiantado.
   - **Resposta do desenho (17/11):** Aceito: `GET /cupons/:id` e o POST trazem `agora`, `consultar_a_partir_de`, `cancelar_ate`, `envios` e `acoes` (`enviar_de_novo`, `consultar`, `cancelar`, `descartar`, `lancar_venda`, `imprimir`), da função pura `acoesDoCupom` (desenho §8.2).
4. **Família da recusa no servidor.** `frases.ts` deveria devolver, junto da frase, `familia: 'produto' | 'empresa' | 'consumidor' | 'valores' | 'hora' | 'outra'` (por código). É ela que escolhe a ação na tela (6.1). Classificar pelo texto do `xMotivo` na tela é frágil.
   - **Resposta do desenho (17/11):** Aceito: `recusa: { codigo, familia, frase }`, com família por código em `retornos.ts`. Lista só com os códigos da pesquisa: `produto` 386 e 725; `valores` 391, 436, 610, 629, 780, 857, 869, 899 e 963; `consumidor` 786–788; `hora` 704; `empresa` ainda sem código confirmado (o 1º teste completa); fora da lista = `outra` (desenho §11).
5. **`falta: string[]` sem âncora.** Pedir `{ codigo, texto }[]` (`ie`, `crt`, `endereco`, `serie`, `csc`, `certificado`, `cnpj`, `produto_pronto`, `teste_homologacao`, `lanca_venda`, `series_outro_sistema`), para cada item levar ao campo certo (5.1).
   - **Resposta do desenho (17/11):** Aceito: `falta: { codigo, texto }[]` com os 11 códigos listados (desenho §8.2).
6. **`GET /cupons` sem filtro de ambiente nem de "precisa de você".**
   - Sem `ambiente`, os cupons de teste e os valendo se misturam em Emitidos e nos pendentes.
   - Pedir `ambiente` (padrão: o do servidor), `situacao` com lista e `atencao=true` (as situações pendentes + venda pendente no estoque, que não é situação).
   - **Resposta do desenho (17/11):** Aceito: `ambiente` (padrão: o do servidor; desligado = `producao`), `situacao=a,b` e `atencao=true` (pendentes + venda pendente) (desenho §8.2).
7. **`pendentes` da `/situacao` sem forma definida.** Para a faixa (4.2), pedir `{ total, primeiro: { id, numero, tipo } }`, sendo `tipo` sem resposta, não saiu, recusado ou venda pendente.
   - **Resposta do desenho (17/11):** Aceito: `{ total, primeiro: { id, serie, numero, tipo } | null }`; `tipo` = `sem_resposta` (inclui `enviando` vencido e `cancelando`), `nao_saiu`, `recusado` ou `venda_pendente` (desenho §8.2).
8. **Venda no estoque calculada.** Pedir um campo `venda_estoque: 'lancada' | 'pendente' | 'desfeita' | 'desfazer_pendente' | 'teste' | 'nao_lanca'` no cupom. Hoje a tela teria de combinar `venda_lancada_em`, `venda_desfeita_em`, `venda_erro`, o ambiente e `cupom_lanca_venda` (3.2).
   - **Resposta do desenho (17/11):** Aceito: `venda_estoque` calculado no servidor; para isso o cupom fotografa `lanca_venda` na T1, e mudar a resposta depois não mexe em cupons antigos (desenho §3.4, §8.1).
9. **`tpImp` fixo em 4 e quem usa está no celular sem impressora.** Ver a decisão 9.1: se a entrega só digital for aceita, o `tpImp` passa a vir da tela no POST (campo novo `entrega: 'impresso' | 'digital'`).
   - **Resposta do desenho (17/11):** Pergunta ao dono e ao contador (decisão 9.1). Até a resposta, `tpImp` 4, e o POST recusa um campo `entrega` (DTO com `forbidNonWhitelisted`).
10. **Perfil em vários produtos de uma vez.** São cerca de 100 produtos para 3 a 5 perfis. Pedir `PUT /v1/cupom-fiscal/produtos/perfil` com `{ itens: uuid[], perfil_fiscal_id }`, numa transação. Sem ela, a tela faria 100 chamadas (e esbarraria no limite de pedidos).
    - **Resposta do desenho (17/11):** Aceito: `PUT /v1/cupom-fiscal/produtos/perfil` `{ itens: uuid[] (1–500), perfil_fiscal_id }`, numa transação, declarada antes da rota `:itemCardapioId` (desenho §8.2).
11. **Histórico do ambiente sem rota.** O `nfce_ambientes_historico` existe, mas nenhuma rota o lê. Pedir as 5 últimas linhas em `GET /situacao` ou em `GET /ambientes/:ambiente` (`evento`, `campos`, `mensagem`, `feito_por_nome`, `feito_em`), como no certificado.
    - **Resposta do desenho (17/11):** Aceito: `GET /ambientes/:ambiente` traz `historico` com as 5 últimas linhas (desenho §8.2).
12. **"Pronto para o cupom" não olha o regime.**
    - O derivado é ativo + preço + NCM + perfil ativo (§8.1). Um perfil com CSOSN depois que o regime vira normal (ou o contrário) conta como pronto e só falha no envio (`NFCE_PERFIL_INVALIDO`).
    - Pedir que o perfil incompatível com o CRT conte como "perfil não vale no regime atual" e tire o produto do cupom.
    - **Resposta do desenho (17/11):** Aceito: perfil incompatível com o CRT atual = motivo `perfil_fora_do_regime`, e o produto sai do cupom (desenho §8.2).
13. **Caracteres aceitos no motivo do cancelamento** (`xJust`). O desenho só fixa 15 a 255. Definir o conjunto aceito (sem emoji nem caracteres de controle) igual no servidor e na tela, como na resposta à SEFAZ das notas.
    - **Resposta do desenho (17/11):** Aceito: a mesma `normalizarJustificativa` das respostas à SEFAZ (U+0020–U+00FF, 15–255, aspas e travessões trocados); a tela usa a cópia de `web/src/lib/notas-sefaz.ts` (desenho §8.4).
14. **"Enviar de novo" relê os dados da empresa?** O desenho diz que relê "só os códigos fiscais" dos produtos (§5.1).
    - Uma recusa por IE ou endereço seria corrigida em Configurações, mas o reenvio sairia com o dado velho.
    - Pedir que o reenvio releia também o emitente (IE, endereço, regime, natureza); senão, a frase 6.1 da família "empresa" vira "descarte e emita de novo".
    - **Resposta do desenho (17/11):** Aceito (risco real): o reenvio relê também o emitente (IE, CRT, endereço, natureza, texto adicional, responsável técnico); se o CNPJ mudou, recusa (desenho §5.1).
15. **CPF na lista.** Pedir o documento já mascarado em `GET /cupons` (`***.456.789-**`), e completo só no cupom e no DANFE. A lista é a tela mais aberta no celular.
    - **Resposta do desenho (17/11):** Aceito para CPF (`***.456.789-**` na lista; completo no cupom e no DANFE). O CNPJ vai inteiro: é de empresa (desenho §8.2).
16. **Motivo do descarte.** O desenho não fixa o tamanho ("Escreva o motivo do descarte."). A tela manda um dos 3 motivos prontos ou um texto livre: aceitar de 3 a 255 letras.
    - **Resposta do desenho (17/11):** Aceito: 3 a 255 caracteres depois de aparar (desenho §8.4).
17. **`GET /produtos` para a aba Emitir.** A busca precisa de `categoria`, `preco_venda`, `pronto` e `motivos: ('falta_ncm' | 'falta_perfil' | 'sem_preco' | 'perfil_inativo' | 'perfil_fora_do_regime')[]`. Confirmar que a mesma rota da grade serve, ou criar uma leve, só de leitura.
    - **Resposta do desenho (17/11):** Aceito: a mesma rota, `GET /v1/cupom-fiscal/produtos?prontos=true`, com `categoria`, `preco_venda`, `pronto` e `motivos` (inclui `inativo` e `perfil_fora_do_regime`) (desenho §8.2).
18. **Onde se editam os perfis.** O desenho não diz em que tela os perfis são editados. Ficou na aba Produtos do Cupom Fiscal (5.6), e Configurações tem só os dados da empresa e do ambiente. As rotas do desenho servem sem mudança.
    - **Resposta do desenho (17/11):** Aceito: perfis na aba Produtos; o desenho §2.1 foi ajustado e as rotas não mudam.
