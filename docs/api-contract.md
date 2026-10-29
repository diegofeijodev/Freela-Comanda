# Freela ERP — contrato da API

Base: `http://localhost:3016` (dev). Tudo JSON snake_case, nomes iguais às colunas do banco. `numeric` = number, `date` = `"AAAA-MM-DD"`,
`time` = `"HH:MM:SS"`, timestamp = ISO. Autenticação `Authorization: Bearer <access_token>` (JWT HS256, 12 h).

## §1 Erros

Sempre `{ "error": { "code": string, "message": string } }`.

| HTTP | code | quando |
| --- | --- | --- |
| 400 | `VALIDATION_ERROR` | corpo/consulta inválidos (mensagem "campo: problema") |
| 400 | `REGRA` | `raise exception` de uma função de regra — texto do protótipo ("Já existe um inventário em andamento", "Há itens sem quantidade final", "Inventário já fechado", "Periodicidade inválida", "Quantidade inválida") |
| 401 | `UNAUTHORIZED` / `INVALID_CREDENTIALS` | sem token, token inválido/expirado, conta excluída / login errado ("E-mail ou senha incorretos") |
| 403 | `FORBIDDEN` | perfil sem permissão ("Acesso negado") |
| 404 | `NOT_FOUND` | id inexistente ou malformado |
| 409 | `DUPLICADO` / `EM_USO` | unique (nome repetido, nota já lançada) / chave estrangeira ("Item em uso por fichas técnicas. Desative-o.") |
| 422/429/502/503 | `PDF_*` | leitura de PDF (§12) |

## §2 Permissões

Marca por rota: **pública**, **staff** (admin ou loja) ou **admin**. A lista de rotas da loja é fixa e testada
(`permissoes-protecao.spec.ts`): `GET /v1/auth/me`, `POST /v1/auth/trocar-senha`, `GET /v1/configuracoes`, `GET /v1/subgrupos`,
`GET /v1/fichas/loja`, `GET /v1/inventarios`, `GET /v1/inventarios/atual`, `POST /v1/inventarios` (só com `loja_pode_abrir`),
`GET /v1/inventarios/:id`, `GET /v1/inventarios/:id/contagem`, `POST /v1/inventario-itens/:id/contagem`, `GET /v1/listas-compra`,
`GET /v1/listas-compra/:id`, `GET /v1/listas-compra/:id/itens` (projeção sem valores para a loja). Todo o resto é admin.

## §3 Auth (`/v1/auth`)

| Rota | Corpo / resposta |
| --- | --- |
| `POST /login` (pública, 20/min) | `{ email, senha }` → `{ access_token, user: { id, email, nome, perfil } }` |
| `GET /existe-admin` (pública) | `{ existe }` — a tela mostra "Primeiro acesso?" quando `false` |
| `POST /primeiro-acesso` (pública, 5/min) | `{ nome, email, senha≥6 }` → sessão do novo **admin**; 403 "Novos usuários são cadastrados pelo administrador." se já existe admin |
| `GET /me` | `{ user }` (perfil relido do banco) |
| `POST /trocar-senha` | `{ senha_atual, senha_nova≥6 }` → `{ ok }`; 400 `WRONG_PASSWORD` |

## §4 Usuários (`/v1/usuarios`, admin)

`GET` lista `{ id, nome, email, perfil, created_at }` por nome · `POST { nome, email, senha≥6, perfil }` → `{ id }` (409 e-mail repetido;
"Dados inválidos") · `PATCH /:id/perfil { perfil }` (400 no próprio) · `PUT /:id/senha { senha }` (substitui o "esqueci a senha" por e-mail)
· `DELETE /:id` (400 "Você não pode excluir a si mesmo").

## §5 Cadastros

`GET /v1/configuracoes` (staff) · `PATCH /v1/configuracoes` (campos da tela Geral/Empresa) · `GET /v1/sazonalidade` · `PATCH /v1/sazonalidade/:mes { fator_pct }`
· `GET /v1/subgrupos` (staff) · `POST /v1/subgrupos { nome, grupo, ordem? }` · `DELETE /v1/subgrupos/:id` · `GET|POST /v1/fornecedores`, `DELETE /v1/fornecedores/:id`
· `GET /v1/plano-contas?ativo=true` · `POST /v1/plano-contas { grupo, subgrupo?, conta }` · `POST /v1/plano-contas/lote { linhas[] }` · `DELETE /v1/plano-contas/:id`
(FK das contas pagas é SET NULL, como no protótipo) · `GET /v1/centros-custo?ativo=true` · `POST { nome }` · `DELETE /:id` · `GET /v1/dre-subgrupos`
· `POST /v1/dre-subgrupos { nome (vira MAIÚSCULAS), sigla?, meta_pct?, ordem? }` · `PATCH /v1/dre-subgrupos/:id { meta_pct }`.

## §6 Estoque (admin)

`GET /v1/itens-estoque?ativo=true&ordem=nome|subgrupo` · `POST { nome }` · `PATCH /:id` (qualquer coluna editável; `unidade` vira maiúscula)
· `DELETE /:id` (409 "Item em uso por fichas técnicas. Desative-o.") · `GET /v1/estoque/saldos` (`v_saldo_teorico`) · `GET /v1/estoque/consumo-semanal`
· `GET /v1/estoque/objetivo?mes=1..12` (`estoque_objetivo`) · `GET /v1/movimentacoes?item_estoque_id=` (data desc) ·
`POST /v1/movimentacoes { item_estoque_id, tipo: perda|ajuste_manual, data, quantidade, observacao? }` (perda sempre negativa; custo do cadastro).

## §7 Fichas técnicas

`GET /v1/fichas/resumo?ativos=true` (`v_fichas_resumo`; `ativos` = catálogo) · `GET /v1/fichas/loja` (staff, sem custos) · `GET /v1/itens-cardapio`
· `GET|PATCH|DELETE /v1/itens-cardapio/:id` · `POST /v1/itens-cardapio { nome }` → `{ id }` · `POST /v1/itens-cardapio/:id/duplicar` → `{ id }` ("(cópia)")
· `GET|POST /v1/itens-cardapio/:id/ingredientes` (com `itens_estoque { nome, unidade, preco_unitario }`) · `PATCH|DELETE /v1/ficha-ingredientes/:id`.

## §8 Vendas (admin)

`GET /v1/vendas?ini=AAAA-MM-DD&fim=AAAA-MM-DD` → `pedido, data, hora, produto_relatorio, item_cardapio_id, quantidade, valor_total, preco_unitario` por data.

## §9 Inventário

`GET /v1/inventarios` (staff, data desc) · `GET /v1/inventarios/atual` (staff) → `{ inventario | null }` · `POST /v1/inventarios { data, periodicidade: diario|semanal|mensal }`
(staff; loja só com `loja_pode_abrir`) → `{ id }` · `GET /v1/inventarios/:id` (staff) · `GET /v1/inventarios/:id/contagem` (staff, `loja_itens_inventario`:
SEM teórico) · `POST /v1/inventario-itens/:id/contagem { quantidade≥0 }` (staff) → `{ resultado: ok|recontar }` · `GET /v1/inventarios/:id/itens` (admin,
com teórico e contagens) · `PATCH /v1/inventario-itens/:id/final { final, justificativa }` · `POST /v1/inventarios/:id/fechar` → `{ lista_id }`
· `GET /v1/inventarios/historico` · `GET /v1/inventarios/cmv` (`v_cmv_periodo`).

## §10 Listas de compra

`GET /v1/listas-compra` (staff) · `GET /v1/listas-compra/:id` (staff) · `GET /v1/listas-compra/:id/itens` (staff; admin = linha inteira, loja = `loja_lista_itens`)
· `POST /v1/listas-compra/gerar` → `{ id }` · `POST /v1/listas-compra/:id/itens { descricao, quantidade }` (avulso; só lista `gerada`)
· `POST /v1/listas-compra/:id/enviada` · `POST /v1/listas-compra/:id/receber { atualizar_preco }` · `PATCH /v1/listas-compra-itens/:id { embalagens?, qtd_recebida?, preco_pago? }`
· `DELETE /v1/listas-compra-itens/:id`.

## §11 Notas de entrada (admin)

`GET /v1/notas?limite=30` · `GET /v1/notas/existe?chave=` → `{ existe }` · `GET /v1/vinculos?cnpj=` · `POST /v1/notas` — UMA transação:
`{ chave?, numero?, serie?, fornecedor_nome, fornecedor_cnpj?, data_emissao?, data_entrada, valor_total, forma_pagamento, origem: xml|pdf, atualizar_preco,
itens[{ codigo?, descricao, unidade?, quantidade, valor_unitario, item_estoque_id?, fator? }], parcelas[{ vencimento, valor }] }` → `{ id, contas, a_vista }`.
À vista (pix/dinheiro/débito/transferência) = 1 conta já paga; senão 1 conta por parcela ("Informe o vencimento de cada parcela"). 409 "Esta nota já foi lançada".

## §12 Leitura de PDF por IA (admin, multipart, 1 arquivo ≤ 10 MB)

`POST /v1/notas/ler-pdf` → a mesma `NotaLida` do leitor de XML · `POST /v1/dda/ler-pdf` → `BoletoDDA[]`. Erros: 400 "Arquivo vazio ou grande demais (máx. 10 MB)",
400 "O arquivo não é um PDF.", 503 "Leitura de PDF não configurada", 429 "Muitas leituras seguidas, tente de novo em instantes.", 502 "Não foi possível
ler o PDF agora.", 422 "Não consegui identificar os dados deste PDF.".

## §13 Contas a pagar, DRE e caixa (admin)

`GET /v1/contas-pagar` · `POST /v1/contas-pagar { descricao, valor, vencimento, fornecedor_nome?, forma_pagamento?, categoria?, linha_digitavel?, origem_dda? }`
· `POST /v1/contas-pagar/liquidar { ids[], pago_em, plano_conta_id, centro_custo_id }` → `{ liquidadas }` · `POST /v1/contas-pagar/:id/reabrir`
· `DELETE /v1/contas-pagar/:id` (409 se for de nota) · `GET /v1/dre/pagos?mes=AAAA-MM` · `GET /v1/caixa?mes=AAAA-MM` (sem `mes` = todos)
· `PUT /v1/caixa { data, dinheiro, debito, credito, pix, ifood, delivery_proprio, cartao_alimentacao, sangria, sangria_cofre }` (substitui o dia) · `DELETE /v1/caixa/:id`.

## §14 Importações (admin)

`GET /v1/importacoes?limite=10` · `POST /v1/importacoes/{insumos|fichas|vendas} { arquivo?, modo: acrescentar|substituir, linhas: Record<string,string>[], erros? }`
— uma transação com as regras da tela do protótipo (insumos: upsert pelo nome; fichas: upsert do cabeçalho, troca dos ingredientes, `recalcular_baixas`;
vendas: de-para novo, soma de linhas repetidas, "Substituir" apaga o período, repetidas ignoradas, linha com data inválida fica de fora)
· `GET /v1/de-para` · `PUT /v1/de-para { produto_relatorio, item_cardapio_id|null }` → `{ vendas }` (o gatilho refaz as baixas).
