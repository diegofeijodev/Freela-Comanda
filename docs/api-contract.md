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
`{ chave?, numero?, serie?, fornecedor_nome, fornecedor_cnpj?, data_emissao?, data_entrada, valor_total, forma_pagamento, origem: xml|pdf|foto, atualizar_preco,
itens[{ codigo?, descricao, unidade?, quantidade, valor_unitario, item_estoque_id?, novo_insumo?{ nome, unidade, subgrupo? }, fator? }], parcelas[{ vencimento, valor }] }` → `{ id, contas, a_vista, insumos_criados }`.
`novo_insumo` cadastra o insumo DENTRO da mesma transação (rollback junto se a nota falhar); nome já existente (sem caixa/acento) é reaproveitado (insumo inativo com esse nome é REATIVADO), e a mesma linha repetida cria um só; `insumos_criados` conta só os realmente criados. Linha com `item_estoque_id` E `novo_insumo` = 400 "Escolha um insumo existente ou cadastre um novo, não os dois"; nome repetido na corrida = 409 "Já existe um insumo com este nome". O preço do insumo recém-criado é gravado mesmo com "Atualizar preço" desmarcado (valor ÷ `fator`); `valor_unitario` ≤ 0 cria o insumo sem preço, e `fator` ≤ 0 ou inválido conta como 1. A `chave` recebida é reduzida a dígitos antes de conferir duplicidade e gravar (sem nenhum dígito = sem chave).
À vista (pix/dinheiro/débito/transferência) = 1 conta já paga; senão 1 conta por parcela ("Informe o vencimento de cada parcela"). 409 "Esta nota já foi lançada".

## §12 Leitura de PDF e de foto por IA (admin, multipart)

`POST /v1/notas/ler-foto` — 1 a 4 imagens da MESMA nota (JPEG, PNG ou WebP, ≤ 10 MB cada e, somadas, até 20 MB por requisição, o teto do nginx; o tipo vem dos primeiros bytes, não do nome). Devolve a mesma `NotaLida`
do `ler-pdf`; cada item traz, além dos campos da nota, `item_estoque_id` (insumo do estoque que a IA indicou, ou `null`), `novo` (`{ nome, unidade, subgrupo }` quando
não há insumo parecido: sugestão de cadastro; `null` quando há `item_estoque_id`) e `fator` (unidades do estoque por unidade comprada, 1 se inválido). A IA recebe a lista
de insumos ativos e de subgrupos no pedido; nome que ela inventa e não existe no estoque vira `novo`. `ler-pdf` devolve os mesmos campos extras. Erros próprios da foto:
400 "Envie até 4 fotos da mesma nota.", 400 "O arquivo não é uma imagem (JPG, PNG ou WebP).", 400 "Arquivo vazio ou grande demais (máx. 10 MB)"; sem chave de IA,
503 `PDF_NAO_CONFIGURADO` "Leitura de nota não configurada: cadastre a chave de uma IA em Configurações." (a de PDF mantém "Leitura de PDF…"); 502 `PDF_INDISPONIVEL` "Não foi possível ler a foto agora."; 422 `PDF_ILEGIVEL` "Não consegui identificar os dados desta foto.". A `chave` lida pela IA (foto e PDF) é reduzida a dígitos e só sai com exatamente 44 (senão `null`; o dígito verificador não é conferido); `data_emissao` e `vencimento` que não sejam um dia real saem `''`. Os demais erros
(`PDF_*`, 429, 502, 422) são os abaixo. A leitura nunca grava nada: o insumo novo só nasce no `POST /v1/notas` (§11).

### PDF (1 arquivo ≤ 10 MB)

`POST /v1/notas/ler-pdf` → a mesma `NotaLida` do leitor de XML · `POST /v1/dda/ler-pdf` → `BoletoDDA[]`. Erros: 400 "Arquivo vazio ou grande demais (máx. 10 MB)",
400 "O arquivo não é um PDF.", 503 `PDF_NAO_CONFIGURADO` "Leitura de PDF não configurada: cadastre a chave de uma IA em Configurações.",
503 `PDF_CHAVE_RECUSADA` / `PDF_SEM_CREDITO` / `PDF_MODELO` / `PDF_CHAVE_ILEGIVEL` (frases em `leitor-pdf.port.ts`), 429 "Muitas leituras seguidas, tente de novo
em instantes.", 502 "Não foi possível ler o PDF agora.", 422 "Não consegui identificar os dados deste PDF.".

**Qual IA lê:** a chave cadastrada em Configurações (tabela `ia_chave`, uma linha, cifrada AES-256-GCM com chave HKDF de `IA_CHAVES_SECRET` ou, sem
ela, do `JWT_SECRET`); sem chave salva, a `ANTHROPIC_API_KEY` do servidor. Modelos: `AI_PDF_MODEL` (Claude, padrão `claude-opus-5-5`),
`AI_PDF_MODEL_OPENAI` (padrão `gpt-5-mini`), `AI_PDF_MODEL_GEMINI` (padrão `gemini-flash-latest`).

`GET /v1/ia-chave` (admin) → `{ origem: 'configuracoes'|'servidor'|null, provedor: 'anthropic'|'openai'|'gemini'|null, nome, dica: '••••1234'|null,
modelo, atualizado_em }` — a chave nunca volta. `PUT /v1/ia-chave` (admin) `{ provedor, chave }` → testa lendo um PDF de 1 página com esquema (mesmo
código das notas) e só grava se der certo; senão 400 `CHAVE_IA_INVALIDA` com o motivo ("A IA recusou esta chave…", sem créditos, modelo). Devolve o
status. `DELETE /v1/ia-chave` (admin) → status (volta para a chave do servidor, se houver).

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

## §15 Certificado digital A1 (admin)

Só admin (`@AdminOnly()`): **a loja não alcança nenhuma destas rotas** (nem a lista da loja em `permissoes-protecao.spec.ts` mudou). Nenhuma chama a SEFAZ.
O arquivo `.pfx` e a senha entram só no `PUT` e **nunca** voltam, nem em log, erro ou Swagger; o servidor guarda chave PKCS#8, certificado e cadeia
cifrados (AES-256-GCM, segredo `CERTIFICADO_SECRET`) e descarta o `.pfx` e a senha. Não existe rota para baixar o certificado.

`GET /v1/certificado-digital` → `{ situacao, titular, cnpj, cnpj_confere, tipo, politica_oid, emissor, valido_de, valido_ate, dias_restantes, cadeia_conferida, enviado_em, enviado_por_nome, historico[] }`.
- `situacao`, por precedência: `sem_segredo` (servidor sem `CERTIFICADO_SECRET`) > `ausente` (sem certificado) > `ilegivel` (não decifra: segredo trocado ou perdido) > `vencido` > `vencendo` (30 dias ou menos) > `valido`.
  `dias_restantes`, `situacao` e `cnpj_confere` (`igual | mesma_raiz | diferente | empresa_sem_cnpj`) são calculados na leitura, com o CNPJ atual de Configurações. `tipo`: `A1 | SE-S | outro`.
- `ausente` e `sem_segredo` trazem os demais campos `null`. `historico` = os últimos eventos, mais novos primeiro: `{ evento: enviado|substituido|removido, feito_por_nome, feito_em, valido_ate, cnpj, titular }` (nunca material).

`PUT /v1/certificado-digital` — JSON `{ arquivo_base64, senha }` (não é multipart; base64 de até 90.000 caracteres ≈ 64 KB; senha de 1 a 128). Confere tudo antes de guardar e só então troca o
certificado atual; falhou = nada muda. Devolve o corpo do GET. Recusas são 400 `{ error: { code, message } }` com frase fixa (nunca texto de biblioteca):

| code | Quando |
|---|---|
| `CERTIFICADO_ARQUIVO` | não parece um .pfx/.p12 (ou .pfx sem bloco de MAC, ou com mais de 20 certificados) |
| `CERTIFICADO_SENHA` | senha incorreta (o MAC não confere; senha com acento é tentada nas duas codificações) |
| `CERTIFICADO_FORMATO` | não abriu por outro motivo (inclui erro inesperado) |
| `CERTIFICADO_SEM_CHAVE` | sem chave privada (A3, token) |
| `CERTIFICADO_VENCIDO` / `CERTIFICADO_AINDA_NAO_VALE` | fora da validade |
| `CERTIFICADO_SEM_CNPJ` | não é de empresa (sem CNPJ) |
| `EMPRESA_SEM_CNPJ` | falta o CNPJ em Configurações → Empresa |
| `CERTIFICADO_OUTRO_CNPJ` | raiz do CNPJ diferente da empresa (mesma raiz, outro estabelecimento, passa com aviso) |
| `CERTIFICADO_NAO_ICP` | sem sinal de ICP-Brasil |
| `CERTIFICADO_CADEIA` | assinatura da cadeia falha com chave legível (adulterado) |

Cadeia: emissor vencido, sem marca de AC ou com chave ilegível = cadeia **não conferida**: aceito, `cadeia_conferida = false` e aviso no painel. Corpo de validação do DTO: 400 com a frase do campo.
503 `CERTIFICADO_SEM_SEGREDO` "O servidor ainda não está pronto para guardar certificados. Fale com o suporte do Freela Comanda." quando falta `CERTIFICADO_SECRET`.
Enviar e remover usam trava consultiva de transação (dois admins ao mesmo tempo não se atropelam) e gravam o histórico na mesma transação.

`DELETE /v1/certificado-digital` → apaga o certificado, grava `removido` no histórico e devolve o corpo do GET (`ausente`). Funciona mesmo sem `CERTIFICADO_SECRET`; sem certificado, não faz nada.

**Porta interna** (sem rota): `CERTIFICADO_DIGITAL` (`certificado-digital.port.ts`), `emUso()` devolve `{ chavePrivada (KeyObject), certificado, cadeia, cnpj, validoAte, impressaoDigital }`,
decifrando a cada chamada. Erros `CertificadoErro`: 503 `CERTIFICADO_NAO_CADASTRADO` / `CERTIFICADO_ILEGIVEL`; 422 `CERTIFICADO_VENCIDO` / `CERTIFICADO_OUTRO_CNPJ`. É o único caminho até a chave, para SEFAZ e NFC-e.
