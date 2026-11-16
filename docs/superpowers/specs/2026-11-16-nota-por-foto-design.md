# Entrada de nota por foto, com cadastro do insumo que faltar

Data: 16/11/2026 · Ramo: `feat/nota-por-foto` · Pedido do Diego (repassado pelo Denner), aprovado pelo Denner em 16/11.

É o 1º de quatro projetos pedidos juntos. Os outros três têm desenho próprio, nesta ordem:
certificado digital A1 na tela → notas da SEFAZ puxadas sozinhas (ciência da operação **automática**, decidido em 16/11) →
cupom fiscal (NFC-e; proposta em aberto: tela simples "Emitir cupom", sem virar caixa; depende de dados do contador).

## Por quê

Hoje a Entrada de Notas só aceita XML ou PDF, e quem lança escolhe o insumo de cada linha à mão. Nota em papel (cupom de mercado,
DANFE impresso) precisa ser digitada. O Diego quer fotografar a nota e conferir, em vez de digitar — inclusive quando o produto
ainda não existe no estoque.

## O que muda para quem usa

1. O campo de arquivo da Entrada de Notas aceita **foto** (JPG, PNG, WebP; no celular abre a câmera), até **4 fotos da mesma nota**.
2. A IA cadastrada em Configurações lê a foto e preenche a **mesma tela de conferência** de hoje.
3. A IA recebe a lista de insumos ativos e diz qual é cada produto. Sem insumo correspondente, a linha vem como
   **"Cadastrar novo"**, com nome, unidade, subgrupo e fator sugeridos — tudo editável.
4. "Dar entrada" cria os insumos novos com o preço da nota, lança no estoque, gera as contas e guarda o vínculo, **numa transação só**.
5. "Cadastrar novo" também vale para PDF (mesma leitura por IA) e para XML (sem IA: nome = descrição da nota, unidade da nota).

```
Produto na nota        Qtd  Preço   Insumo do estoque             Fator
TOMATE ITAL KG         10   6,90    Tomate                        1
REQUEIJAO CX C/12      2    89,00   + Cadastrar novo: Requeijão   12      [novo — confira]
                                      unidade UN · subgrupo Laticínios
```

## Metas, o que fica de fora, o que não pode acontecer

- **Metas:** foto vira nota conferível em uma leitura; produto novo é cadastrado sem sair da tela; nada entra no estoque sem conferência.
- **Fora (por ora):** foto enviada pelo perfil loja (quem tira é o admin — decidido); IA escolhendo insumo em nota XML (volta no projeto
  das notas da SEFAZ, que chegam em XML); guardar a imagem da nota (XML e PDF também não são guardados hoje); várias notas num envio.
- **Não pode:** dar entrada sem conferência; insumo duplicado (mesmo nome com outra caixa/acentuação); a loja alcançar rota nova;
  teste fazendo rede.

## Abordagens consideradas

| Abordagem | Troca | Decisão |
|---|---|---|
| A. Foto → IA → tela de conferência; insumo novo criado no "Dar entrada" | Um clique a mais de conferência; nenhum cadastro errado silencioso | **Escolhida** (Denner, 16/11) |
| B. Foto → IA → entra direto no estoque e cadastra sozinho | Zero clique; erro de leitura vira insumo duplicado e contamina ficha, CMV e inventário | Descartada |
| C. Embrulhar a foto num PDF no navegador e reusar a leitura de PDF | Nenhuma mudança nos leitores; gambiarra, e não resolve o cadastro | Descartada |

## Como (decisões do construtor, marcadas como minhas)

**Leitura (API, `modules/leitura-pdf`)**
- A porta `LEITOR_PDF` passa a receber `arquivos: { base64, mime, nome }[]` (1 PDF **ou** 1–4 imagens) no lugar de `pdfBase64`/`nomeArquivo`.
  Cada leitor monta o bloco do seu provedor: Claude `image` (base64), OpenAI `image_url` (data URL), Gemini `inlineData` com o mime da imagem.
- Rota nova `POST /v1/notas/ler-foto` (`@AdminOnly`), multipart com 1–4 imagens; tipo conferido pelos bytes iniciais (JPEG/PNG/WebP);
  10 MB por arquivo. O registro global do multipart sobe de `files: 1` para `files: 4`; as rotas de PDF continuam lendo um arquivo só.
- Leitura de nota (foto **e** PDF) usa um esquema estendido: cada item ganha `insumo` (nome exato de um insumo da lista, ou nulo),
  `novo_nome`, `novo_unidade`, `novo_subgrupo` (um da lista, ou nulo) e `fator`. A lista de insumos ativos (nome + unidade) e a de
  subgrupos vão no texto do pedido.
- O servidor não confia na IA: `insumo` que não bate com um insumo ativo (comparação sem caixa/acentos) vira nulo; `novo_subgrupo` fora da
  lista vira nulo; `fator` ≤ 0 ou ausente vira 1. A resposta para a tela leva, por item, `item_estoque_id` (ou nulo) e `novo: { nome, unidade, subgrupo }`.
- Mensagens da foto: "Não consegui identificar os dados desta foto."; "O arquivo não é uma imagem (JPG, PNG ou WebP)."; "Envie até 4 fotos da mesma nota.".
  Sem chave de IA: a mesma frase de hoje, trocando "PDF" por "nota" só na rota da foto.

**Dar entrada (API, `modules/notas`)**
- `ItemNotaDto` ganha `novo_insumo?: { nome, unidade, subgrupo? }`, que não pode vir junto com `item_estoque_id` (400).
- Dentro da transação, antes de gravar os itens: para cada nome novo (sem caixa/acentos, espaços colapsados) — se já existe insumo com
  esse nome, usa o existente (e reativa se estava inativo); senão cria `itens_estoque` com `unidade` em maiúsculas, `subgrupo` válido ou o
  padrão do banco, `preco_unitario = valor_unitario / fator`, `fornecedor = nome do fornecedor` e, se `fator > 1`,
  `qtd_por_embalagem = fator` e `embalagem_compra = unidade da nota`. Duas linhas com o mesmo nome novo = um insumo.
- O preço do insumo novo é gravado mesmo com "Atualizar preço de compra" desmarcado (ele nasce sem preço).
- `origem` aceita `'foto'`. Resposta ganha `insumos_criados`.

**Tela (web, `/notas`)**
- Entrada de arquivo: `.xml`, `.pdf` e imagens; vários arquivos só se todos forem imagem (máx. 4).
- Antes de enviar, cada foto é reduzida no navegador (maior lado 2000 px, JPEG) respeitando a orientação; imagem que o navegador não
  abre (ex.: HEIC fora do Safari) → "Não consegui abrir esta imagem. Envie em JPG ou PNG.".
- Ordem de preenchimento por linha: vínculo salvo do fornecedor → insumo indicado pela IA → "Cadastrar novo" (sugestão da IA).
  No XML continua: vínculo → sugestão por palavras → "— não lançar —", com "Cadastrar novo" disponível na lista.
- Linha "Cadastrar novo" mostra nome, unidade e subgrupo (lista de `/v1/subgrupos`) editáveis e a marca "novo — confira".
  Título dos itens: "· N sem insumo · M novos". Aviso depois de lançar inclui "M insumo(s) cadastrado(s)".
- Textos: "XML é lido na hora e com exatidão. PDF e foto são lidos por inteligência artificial — confira os valores.";
  Configurações: painel passa a "Leitura de notas por IA (PDF e foto)". Lista de notas mostra a marca `FOTO`.

## Verificação

- jest: corpo enviado por cada leitor com imagem (HTTP falso), limpeza da resposta da IA, validação do DTO, rota nova na lista de proteção.
- smoke (`api/scripts/smoke.sh`): `ler-foto` sem chave, com arquivo que não é imagem, com 5 arquivos, loja = 403; nota com `novo_insumo`
  cria o insumo com preço, não duplica nome com outra caixa, duas linhas com o mesmo nome = 1 insumo, falha desfaz tudo.
- vitest + browser-check: redução da imagem, escolha "Cadastrar novo", lançamento.
- **Não coberto por teste:** leitura de foto real pela IA (nenhum teste faz rede; não há chave local). Fica para o dono, depois de subir:
  fotografar uma nota de verdade. Os leitores OpenAI e Gemini nunca rodaram contra a API real.
