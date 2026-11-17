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

`GET /v1/configuracoes` (staff) · `PATCH /v1/configuracoes` (campos da tela Geral/Empresa; `cnpj` é normalizado e, se não vazio, precisa passar no dígito verificador, senão 400 `CNPJ_INVALIDO` "CNPJ inválido. Confira os 14 caracteres (pode ter letras)."; vazio é aceito e grava texto vazio) · `GET /v1/sazonalidade` · `PATCH /v1/sazonalidade/:mes { fator_pct }`
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

`GET /v1/notas?limite=30` · `GET /v1/notas/existe?chave=` → `{ existe, nota }` (`nota` = `NotaParecida` da nota com essa chave, ou `null`; a chave é normalizada antes) · `GET /v1/notas/repetidas?cnpj=&numero=&serie=` → até 5 `NotaParecida` (mais nova primeiro; `[]` sem CNPJ ou sem número após normalizar) · `GET /v1/vinculos?cnpj=` (CNPJ normalizado) · `POST /v1/notas` — UMA transação:
`{ chave?, numero?, serie?, fornecedor_nome, fornecedor_cnpj?, data_emissao?, data_entrada, valor_total, forma_pagamento, origem: xml|pdf|foto|sefaz, atualizar_preco, confirmar_repetida?,
itens[{ codigo?, descricao, unidade?, quantidade, valor_unitario, item_estoque_id?, novo_insumo?{ nome, unidade, subgrupo? }, fator? }], parcelas[{ vencimento, valor }] }` → `{ id, contas, a_vista, insumos_criados }`.
`novo_insumo` cadastra o insumo DENTRO da mesma transação (rollback junto se a nota falhar); nome já existente (sem caixa/acento) é reaproveitado (insumo inativo com esse nome é REATIVADO), e a mesma linha repetida cria um só; `insumos_criados` conta só os realmente criados. Linha com `item_estoque_id` E `novo_insumo` = 400 "Escolha um insumo existente ou cadastre um novo, não os dois"; nome repetido na corrida = 409 "Já existe um insumo com este nome". O preço do insumo recém-criado é gravado mesmo com "Atualizar preço" desmarcado (valor ÷ `fator`); `valor_unitario` ≤ 0 cria o insumo sem preço, e `fator` ≤ 0 ou inválido conta como 1. A `chave` recebida é normalizada (maiúsculas e só `[0-9A-Z]`; nunca `\D`, que apagaria as letras do CNPJ alfanumérico) antes de conferir e gravar; sem nenhum caractere = sem chave. `fornecedor_cnpj` também é normalizado ao gravar (pode ser CPF, 11 caracteres; o dígito verificador do fornecedor não é validado). Nesta ordem, antes da transação:
- chave que não tem o formato (44 caracteres, posições 7 a 18 com `[0-9A-Z]`, o resto dígitos) ou cujo dígito verificador não bate: 400 `CHAVE_INVALIDA` "A chave de acesso da nota é inválida. Confira os 44 caracteres.";
- chave já lançada: 409 `DUPLICADO` "Esta nota já foi lançada" (não muda; não há confirmação que o contorne);
- nota "parecida" (mesmo CNPJ normalizado + mesmo número sem zeros à esquerda + mesma série quando as duas têm série; `numero` e `serie` só com os dígitos) e `confirmar_repetida` diferente de `true`: 409 `NOTA_REPETIDA`, com a mensagem `Já existe a NF {numero}[ série {serie}] de {fornecedor_nome}, lançada em {DD/MM/AAAA}{ origem}, de R$ {0.000,00}[ (e mais 1 parecida)| (e mais N parecidas)]. Se for outra nota, confirme para lançar mesmo assim.` Os dados são os da parecida mais nova (`created_at` decrescente); "lançada em" = `data_entrada` (divisão do texto, sem `Date`); origem por extenso: "por XML", "por PDF", "por foto", "pela SEFAZ".
Com `confirmar_repetida: true` a nota é gravada e `notas_entrada.repetida_de` guarda o id da parecida mais nova (`NULL` quando não havia parecida; a FK é `ON DELETE SET NULL`); `GET /v1/notas` devolve essa coluna. Quem confirmou é o próprio `usuario_id` da nota. `NotaParecida` = `{ id, numero, serie, fornecedor_nome, data_emissao, data_entrada, valor_total, origem, created_at }`.
**`origem: 'sefaz'`** (nota conferida a partir da aba "Notas da SEFAZ", §16): antes da transação o servidor reconfere sozinho, sem confiar na tela. Só passa com `SEFAZ_DFE_AMBIENTE=producao`, chave presente, CNPJ da empresa válido, linha em `notas_sefaz` de produção para esse CNPJ, XML completo guardado e situação que permita conferir (nem cancelada, nem denegada, nem ignorada). Qualquer falha = 409 `SEFAZ_NAO_CONFERIVEL` "Esta nota não pode ser conferida pela SEFAZ. Dê entrada pelo arquivo ou pela foto." (também com a busca desligada ou em homologação). Nota de `origem: 'sefaz'` repetida segue as regras de `DUPLICADO`/`NOTA_REPETIDA` acima.
À vista (pix/dinheiro/débito/transferência) = 1 conta já paga; senão 1 conta por parcela ("Informe o vencimento de cada parcela"). 409 "Esta nota já foi lançada".

## §12 Leitura de PDF e de foto por IA (admin, multipart)

`POST /v1/notas/ler-foto` — 1 a 4 imagens da MESMA nota (JPEG, PNG ou WebP, ≤ 10 MB cada e, somadas, até 20 MB por requisição, o teto do nginx; o tipo vem dos primeiros bytes, não do nome). Devolve a mesma `NotaLida`
do `ler-pdf`; cada item traz, além dos campos da nota, `item_estoque_id` (insumo do estoque que a IA indicou, ou `null`), `novo` (`{ nome, unidade, subgrupo }` quando
não há insumo parecido: sugestão de cadastro; `null` quando há `item_estoque_id`) e `fator` (unidades do estoque por unidade comprada, 1 se inválido). A IA recebe a lista
de insumos ativos e de subgrupos no pedido; nome que ela inventa e não existe no estoque vira `novo`. `ler-pdf` devolve os mesmos campos extras. Erros próprios da foto:
400 "Envie até 4 fotos da mesma nota.", 400 "O arquivo não é uma imagem (JPG, PNG ou WebP).", 400 "Arquivo vazio ou grande demais (máx. 10 MB)"; sem chave de IA,
503 `PDF_NAO_CONFIGURADO` "Leitura de nota não configurada: cadastre a chave de uma IA em Configurações." (a de PDF mantém "Leitura de PDF…"); 502 `PDF_INDISPONIVEL` "Não foi possível ler a foto agora."; 422 `PDF_ILEGIVEL` "Não consegui identificar os dados desta foto.". A `chave` lida pela IA (foto e PDF) é normalizada (maiúsculas, só `[0-9A-Z]`) e só sai se tiver o formato de chave e o dígito verificador bater (senão `null`); `emitente_cnpj` sai sem o rótulo do começo (CNPJ, CPF, CNPJ/CPF), normalizado (maiúsculas, só `[0-9A-Z]`) e sai se tiver formato de CNPJ (14 posições `[0-9A-Z]`) ou de CPF (11 dígitos), mesmo com dígito verificador errado (a tela avisa "CNPJ/CPF não confere"); sem nenhum desses formatos, `null`. Rótulos reconhecidos no começo: CNPJ, CPF, CNPJ/CPF, CPF/CNPJ, CNPJ/MF, CNPJ nº/no, C.N.P.J.; `data_emissao` e `vencimento` que não sejam um dia real saem `''`. Os demais erros
(`PDF_*`, 429, 502, 422) são os abaixo. A leitura nunca grava nada: o insumo novo só nasce no `POST /v1/notas` (§11).

### Sugestão de insumo para os itens do XML

`POST /v1/notas/sugerir-insumos` `{ itens: [{ descricao (1–500), unidade? (≤ 20) }] }` (1 a 200 linhas; só descrição e unidade vão para a IA, nunca valor, CNPJ nem chave) → `{ itens: [{ item_estoque_id, novo, fator }] }`, uma entrada por linha enviada, na mesma ordem. Pela mesma porta `LEITOR_PDF`, com 0 arquivos: a IA recebe os insumos ativos e os subgrupos no pedido e devolve um `indice` (1 a N) por linha, e a API casa por esse índice (índice repetido: vale o primeiro; se qualquer índice vier fora de 1..N, inclusive 0, a API responde 422 `SUGESTAO_ILEGIVEL` "Não consegui usar a sugestão da IA para esta nota." (a tela segue por palavras), sem tentar adivinhar o deslocamento; linha que a IA não respondeu: volta como `novo` — "novo — confira" — com a descrição da linha, `item_estoque_id` null e `fator` 1). Nome que a IA inventa e não existe no estoque vira `novo` (`{ nome, unidade, subgrupo }`); `fator` inválido vira 1. Não grava nada. Erros: 503 `PDF_NAO_CONFIGURADO` sem chave de IA, os demais `PDF_*`, 429 e 502 do leitor, e 422 `SUGESTAO_ILEGIVEL` "Não consegui sugerir os insumos desta nota." quando a resposta não traz a lista de itens.

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
- Sem certificado gravado (`ausente`, ou `sem_segredo` sem linha no banco) os demais campos vêm `null`. Com certificado gravado, mesmo em `sem_segredo`, a consulta devolve titular, CNPJ, validade etc. (vêm das colunas em claro); só não dá para decifrar o material. `historico` = os últimos eventos, mais novos primeiro: `{ evento: enviado|substituido|removido, feito_por_nome, feito_em, valido_ate, cnpj, titular }` (nunca material).

`PUT /v1/certificado-digital` — JSON `{ arquivo_base64, senha }` (não é multipart; base64 de até 90.000 caracteres ≈ 64 KB; senha de 1 a 128). Confere tudo antes de guardar e só então troca o
certificado atual; falhou = nada muda. Devolve o corpo do GET. Recusas são 400 `{ error: { code, message } }` com frase fixa (nunca texto de biblioteca):

| code | Quando |
|---|---|
| `CERTIFICADO_ARQUIVO` | não parece um .pfx/.p12 |
| `CERTIFICADO_SENHA` | senha incorreta (o MAC não confere; senha com acento é tentada nas duas codificações) |
| `CERTIFICADO_FORMATO` | não abriu por outro motivo: .pfx sem bloco de MAC, .pfx com mais de 20 certificados, ou erro inesperado |
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

## §16 Notas da SEFAZ (admin, só leitura)

Busca das notas de compra emitidas contra o CNPJ da empresa (distribuição de DF-e, serviço `NFeDistribuicaoDFe`). **Só admin** (`@AdminOnly()`; a loja não alcança nenhuma rota; entradas em `permissoes-protecao.spec.ts`).
**Tudo nasce desligado:** sem `SEFAZ_DFE_AMBIENTE` (ausente ou vazia) o valor é `desligado`, nenhum timer sobe e nenhuma conexão sai. Valor fora de `desligado | homologacao | producao` derruba a subida da API (falha fechada, de propósito).
Com `desligado`, todas as rotas abaixo respondem 503 `SEFAZ_DESLIGADA` "A busca de notas na SEFAZ não está ativada neste servidor." — **exceto** `GET /situacao`, que devolve `{ ambiente: 'desligado' }` (200).
A busca só roda com `busca_ligada` (botão "Ligar a busca" em Configurações), certificado A1 válido da mesma raiz de CNPJ da empresa e respeitando a agenda de consumo (intervalos mínimos, bloqueio de 656 e reserva de 65 minutos entre consultas). O agendador tica a cada 1 minuto e consulta no máximo a cada 5. Nenhuma rota abaixo chama a SEFAZ de forma síncrona: `POST /buscar` só reserva e confere; a consulta roda em segundo plano.
Erros seguem `{ error: { code, message } }` (§1).

| Método e caminho | Corpo | Resposta |
|---|---|---|
| `GET /v1/notas-sefaz/situacao` | — | `SituacaoBuscaResposta` (200) |
| `PUT /v1/notas-sefaz/configuracao` | `{ busca_ligada: boolean }` | `SituacaoBuscaResposta` (200) |
| `POST /v1/notas-sefaz/buscar` | — | `{ iniciada: true }` (**202**) |
| `GET /v1/notas-sefaz?filtro=a_conferir\|todas&limite=` | — | `NotaSefazLinha[]` (200) |
| `GET /v1/notas-sefaz/:id/xml` | — | o `procNFe` em `text/xml; charset=utf-8` (200) |
| `POST /v1/notas-sefaz/:id/ignorar` | `{ motivo, texto? }` | `NotaSefazLinha` (200) |
| `POST /v1/notas-sefaz/:id/reabrir` | — | `NotaSefazLinha` (200) |

`:id` é UUID (outro formato = 400 do `ParseUuidPipe`).

**`SituacaoBuscaResposta`** = `{ ambiente: 'desligado' }` ou `{ ambiente: 'homologacao'|'producao', cnpj, busca_ligada, situacao: 'ok'|'parada_certificado'|'parada_configuracao'|'parada_conflito'|'parada_656', mensagem, aviso, ultima_consulta: { em, novas }|null, primeira_consulta_em, proxima_consulta_em, bloqueado_ate, em_andamento, lacunas, dias_sem_buscar, ligada_por_nome, ligada_em, outro_cnpj_ou_modo, certificado: { ok, code, mensagem, avisos[] }, contagem: { falta_lancar, parece_lancada, cancelada_depois_de_lancada }, canceladas_depois[{ id, numero, serie, emitente_nome }], historico[{ evento: 'ligada'|'desligada'|'parada_automatica', feito_por_nome, feito_em, c_stat }] }` (datas em ISO). `mensagem` e `aviso` são frases fixas em português (nunca texto vindo da SEFAZ); `lacunas` = soma das notas que a busca ainda não conseguiu trazer (intervalos de NSU não preenchidos); `em_andamento` só vale por até 2 minutos; `outro_cnpj_ou_modo` = a busca está ligada para outro CNPJ ou outro ambiente. O painel não mostra NSU. `certificado.code` é o código da recusa (`EMPRESA_SEM_CNPJ`, `CERTIFICADO_NAO_CADASTRADO`, `CERTIFICADO_VENCIDO`, `CERTIFICADO_OUTRO_CNPJ`, `CERTIFICADO_ILEGIVEL`…); `avisos` pode trazer o aviso do código 280 (certificado sem uso de autenticação de cliente).

**`PUT /configuracao`:** desligar nunca falha por certificado nem toca na agenda. Ligar confere, nesta ordem, e só então grava (com histórico): ambiente → CNPJ → certificado → raiz do CNPJ. Ligar **nunca chama a SEFAZ** e não mexe na próxima consulta nem no bloqueio. Recusas: 503 `SEFAZ_DESLIGADA`; 422 `SEFAZ_SEM_CNPJ` "Preencha o CNPJ da empresa no quadro Empresa e toque em Salvar no alto da página."; do certificado, os `CertificadoErro` (503 `CERTIFICADO_NAO_CADASTRADO` / `CERTIFICADO_ILEGIVEL`; 422 `CERTIFICADO_VENCIDO` / `CERTIFICADO_OUTRO_CNPJ`) e 422 `SEFAZ_CERTIFICADO_OUTRA_EMPRESA` "O certificado digital é de outra empresa, e a SEFAZ recusaria a busca. Confira o CNPJ da empresa ou envie o certificado certo.". Corpo inválido: 400 do DTO.

**`POST /buscar` ("Buscar agora"):** confere e reserva dentro de uma transação, responde 202 e consulta em segundo plano (acompanhe por `GET /situacao`). Recusas: as mesmas de ligar (503/422 acima) mais 409 `SEFAZ_BUSCA_DESLIGADA` "A busca na SEFAZ está desligada. Ligue em Configurações → Notas da SEFAZ."; 409 `SEFAZ_OCUPADA` "Já existe uma busca em andamento."; 409 `SEFAZ_AGUARDE` "A SEFAZ só permite nova busca a partir de {HHhMM}." (sem rede: a agenda não deixa consultar antes da hora). Toda parada automática desliga a busca (`busca_ligada` = false), então depois dela o `POST /buscar` responde `SEFAZ_BUSCA_DESLIGADA` até alguém corrigir a causa e ligar de novo.

**`GET /` (caixa):** `filtro` = `a_conferir` (padrão; `cancelada_depois_de_lancada`, `parece_lancada` e `falta_lancar`) ou `todas`; outro valor = 400 `VALIDATION_ERROR` "Filtro inválido.". `limite` padrão 100, de 1 a 500 (não numérico ou 0 = 100). Ordem: emissão decrescente, sem data no fim. Só as notas do (ambiente, CNPJ) atuais; empresa sem CNPJ = `[]`.
`NotaSefazLinha` = `{ id, chave, emitente_cnpj, emitente_nome, numero, serie, emitida_em, autorizada_em, valor_total, situacao_sefaz: 'autorizada'|'denegada'|'cancelada', cancelada_em, situacao, lancada: NotaParecida|null, parecidas: NotaParecida[], pode_conferir, nao_parece_compra, ignorada: { em, por_nome, motivo, texto }|null }`.
`situacao` (precedência da mais forte): `cancelada_depois_de_lancada` > `ignorada` > `cancelada` > `denegada` > `ja_lancada` (mesma chave) > `parece_lancada` (mesmo emitente, número e série) > `falta_lancar`. `pode_conferir` = ambiente `producao` + XML completo guardado + situação `parece_lancada` ou `falta_lancar`. `nao_parece_compra` = nota de saída (tpNF 0) ou de devolução (finNFe 4): só uma etiqueta, a nota continua na lista. `motivo` de ignorar: `lancada_de_outro_jeito | nao_e_compra | nao_reconheco | cancelamento_conferido | outro`.

**`GET /:id/xml`:** devolve o XML guardado (a única saída de XML da busca). O cabeçalho `content-type` só é posto depois de o XML existir (nunca use `@Header` de texto em rota que pode dar erro: o Fastify recusa objeto com content-type de texto e o 409/404 viraria 500). Erros: 404 `NOT_FOUND` "Não encontrado." (nota de outro ambiente/CNPJ); 409 `SEFAZ_HOMOLOGACAO` "Nota de teste (homologação) não entra no estoque."; 409 `SEFAZ_CANCELADA` "Esta nota foi cancelada pelo fornecedor e não entra no estoque."; 404 `SEFAZ_SEM_XML` "A SEFAZ ainda não liberou o XML desta nota. Dê entrada pelo arquivo ou pela foto." (só o resumo chegou). Depois de baixar o XML, a tela o lê no navegador, com o mesmo leitor do arquivo XML, e o lançamento é `POST /v1/notas` com `origem: 'sefaz'` (§11).

**`POST /:id/ignorar`:** `motivo` obrigatório (400 "Escolha o motivo."); `texto` até 300 caracteres e obrigatório com `motivo: 'outro'` (400 `VALIDATION_ERROR` "Escreva o motivo."). Grava quem e quando. 404 `NOT_FOUND` como acima. **`POST /:id/reabrir`** desfaz o "ignorar" (limpa os campos); 404 igual.

**Erros e causas dos bloqueios automáticos** (aparecem em `mensagem`/`aviso`, nunca com texto da SEFAZ): `parada_656` (a SEFAZ bloqueou duas vezes em 24 horas, ou 656 com `ultNSU` = outro sistema no mesmo CNPJ: a busca se desliga sozinha), `parada_certificado` (códigos 280–286 e 473, certificado recusado), `parada_configuracao` (593 = CNPJ diferente do certificado; 3 respostas ilegíveis seguidas; outro código que o sistema não resolve), `parada_conflito` (outro sistema, provavelmente o do contador, também busca este CNPJ). Parada = a busca fica desligada até alguém corrigir e ligar de novo (`situacao` guarda a causa até lá); o histórico guarda `parada_automatica` com o `c_stat`.
