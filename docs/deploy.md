# Freela Comanda (Freela ERP) — roteiro de subida

Mesmo caminho do Praça e do Meu Funil: API + Postgres no EC2 do Freela (pasta `/opt/erp-freela`), web na Vercel
(time `freelas-projects-ccf14064`, deploy por CÓPIA sem git, projeto `freela-comanda`). Domínio `freelacomanda.com.br` (DNS na Locaweb).

| Endereço | Aponta para | Quando |
|---|---|---|
| `api.freelacomanda.com.br` | `A` → IP do EC2 | antes do HTTPS da API |
| `freela-comanda.vercel.app` | Vercel (automático) | endereço provisório até a virada |
| `www.freelacomanda.com.br` + `freelacomanda.com.br` | Vercel (valores que `vercel domains add` mostrar) | **só na virada**, depois da migração dos dados — hoje o `www` ainda é o Lovable |

Os scripts ficam fora do repositório, em `~/erp-deploy/` (o dono roda cada um com `!`; o classificador barra push/scp/compose para o assistente):

1. **GitHub:** repositório `diegofeijodev/Freela-ERP` **privado**; `git push origin master:main` (o `main` de lá foi juntado com
   `--allow-unrelated-histories`, não precisa de force).
2. **DNS (Locaweb):** `A api → IP do EC2`. Conferir com `dig +short api.freelacomanda.com.br`.
3. **Servidor (uma vez):** `bash ~/erp-deploy/preparar-servidor.sh` — confere memória livre, cria `/opt/erp-freela` e o `.env` (600) com
   `POSTGRES_PASSWORD`/`JWT_SECRET` gerados NO servidor (`openssl rand -hex 32`). Nunca sobrescreve um `.env` existente.
3b. **Segredo do certificado (antes do primeiro envio de certificado; rodar só no dia da subida, liberado pelo dono, e nunca enquanto houver regra de não fazer deploy):**
   `bash ~/erp-deploy/segredo-certificado.sh` — acrescenta `CERTIFICADO_SECRET` (`openssl rand -hex 32`, gerado NO servidor) ao `.env` se faltar.
   Por padrão SÓ grava a variável e NÃO reinicia nada: o `up -d --build` do passo 4 recria o contêiner, e a variável chega a ele pelo `env_file: .env`
   do serviço `api` (mesmo com um compose antigo). Antes de regravar, o script faz a cópia `.env.bak-AAAAMMDD-HHMMSS` (600) no mesmo diretório, escreve
   num temporário, confere que ele tem todas as linhas do original mais a nova e só então substitui; qualquer falha interrompe antes de tocar no `.env`.
   Se já houver valor, não mexe. Opção `--reiniciar`: recria só a API (`--no-deps`) e confere o segredo carregado; NÃO usar junto de outro deploy. Pontos de atenção:
   - Sem a variável, a tela do certificado diz "O servidor ainda não está pronto…" (enviar = 503 `CERTIFICADO_SEM_SEGREDO`).
   - O segredo fica só no servidor. Faça uma cópia segura DO ARQUIVO `.env` do servidor por um meio seguro. Se o valor se perder ou mudar, o certificado guardado
     fica ilegível ("não pode ser lido") e precisa ser enviado de novo.
   - Nunca copiar dump do banco e `.env` juntos (o dump leva o certificado cifrado; o `.env` leva a chave que o abre).
4. **API:** `bash ~/erp-deploy/subir-api.sh` — backup do banco + imagem de volta (a partir da 2ª subida), cópia da árvore LIMPA do `master`,
   `docker compose -f docker-compose.prod.yml up -d --build` (o contêiner roda `prisma migrate deploy`) e espera `/health`.
5. **nginx + HTTPS:** `bash ~/erp-deploy/https-api.sh` — instala `docs/deploy/nginx-api-erp.conf` como `erp-freela-api`, `nginx -t`, reload e
   `certbot --nginx -d api.freelacomanda.com.br --redirect`.
6. **Web:** `bash ~/erp-deploy/subir-web.sh` — cópia de `web/` (sem `.next`/`node_modules`/`.env.local`), `NEXT_PUBLIC_API_URL` fixo em
   `https://api.freelacomanda.com.br`. Rodar `yarn lint` ANTES (lint quebrado derruba o build da Vercel).
7. **Primeiro acesso:** NÃO criar admin em produção antes da migração (o importador exige banco vazio). Para olhar o sistema antes da virada,
   use o ensaio da migração.
8. **Dados do Lovable e virada do `www`:** `docs/migracao-lovable.md`.

## Notas da SEFAZ (busca na distribuição de DF-e, só leitura)

Variável `SEFAZ_DFE_AMBIENTE` (declarada no `docker-compose.prod.yml` como `${SEFAZ_DFE_AMBIENTE:-}`; modelo em `api/.env.example`):

| Valor | Efeito |
|---|---|
| ausente ou vazia | `desligado` (o padrão): nenhum agendador, nenhuma conexão; as rotas dão 503 `SEFAZ_DESLIGADA` e o painel diz que a busca não está ativada |
| `homologacao` | consulta o ambiente de teste da SEFAZ (a nota de teste nunca entra no estoque) |
| `producao` | consulta a SEFAZ real |
| qualquer outro | **a API não sobe** (falha de validação do ambiente, de propósito: melhor parar do que adivinhar) |

Mesmo com a variável ligada, a busca só roda depois de alguém tocar em "Ligar a busca" em Configurações (certificado A1 válido e CNPJ da empresa salvos).
**Nunca** ligar `homologacao` ou `producao` sem o "eu autorizo" do dono, dado na hora e por escrito; o dono acompanha. Nenhum agente executa o roteiro (ele está em `README.md`, "Pendências do dono").
Roteiro: (1) conferir o servidor desligado e `select count(*) from sefaz_consultas` = 0; (2) `pg_dump` do banco; (3) perguntar ao contador se ele já baixa as notas desse CNPJ (dois sistemas no mesmo CNPJ levam a bloqueio 656 de 1 hora para os dois); (4) pôr a variável no `.env` do servidor e recriar SÓ a API (`up -d --no-deps api`; o `.env` chega pelo `env_file`); (5) ligar e buscar pela tela. Volta, nesta ordem: (1) PRIMEIRO tocar em "Desligar a busca" na tela (senão a linha fica `busca_ligada=true` e a busca volta sozinha no dia em que alguém puser a variável de novo); (2) deixar a variável vazia no `.env`; (3) recriar só a API: `docker compose -f docker-compose.prod.yml up -d --no-deps api` (`docker restart`/`docker compose restart` não relê o `.env`); (4) conferir que o painel diz "A busca de notas na SEFAZ não está ativada neste servidor." e que `docker exec erp-freela-api printenv SEFAZ_DFE_AMBIENTE` sai vazio. **Nunca apagar linhas `sefaz_*`** (são a prova das esperas) e, desligada por mais de 60 dias, a SEFAZ deixa buraco sem volta (avisar o dono).
Cuidados: nunca ligar `NODE_DEBUG=http|https|tls` na API (o Node imprime as opções do pedido); o certificado só chega à SEFAZ pela porta `CERTIFICADO_DIGITAL` e nada dele vai para log.

**Recuperar um documento descartado:** a classificação desiste de um documento depois de 3 falhas (`erro_processamento` começa com "Descartado depois de 3 tentativas"), para um defeito dele não prender a fila. O XML continua guardado (`sefaz_documentos`). Corrigida a causa (ou se foi um soluço do banco), colocar de volta na fila:
`UPDATE sefaz_documentos SET processado_em = NULL, erro_processamento = NULL WHERE erro_processamento LIKE 'Descartado%';`
(a API classifica de novo no próximo tique, em até 5 minutos).

Volta: `IMAGE_TAG=<tag> docker compose -f docker-compose.prod.yml up -d --no-build api` (imagem anterior) ou, para tirar tudo do ar,
`docker compose -f docker-compose.prod.yml down` (o volume fica: no Docker ele se chama `erp-freela_erp_freela_pgdata` — o compose prefixa o nome do projeto `erp-freela`; a chave `erp_freela_pgdata` do compose está certa) e apagar o vhost do nginx.
Memória no EC2: API 640 MB + Postgres 320 MB (tetos no compose).

## Respostas à SEFAZ (ciência, confirmação, "Não reconheço", "A compra não aconteceu")

Variável `SEFAZ_MANIFESTACAO` (declarada no `docker-compose.prod.yml` como `${SEFAZ_MANIFESTACAO:-}`; modelo em `api/.env.example`):

| Valor | Efeito |
|---|---|
| ausente ou vazia | `desligada` (o padrão): o agendador não toca no banco para responder, nenhum evento sai; as rotas de resposta dão 503 `SEFAZ_RESPOSTAS_DESLIGADAS` e o painel diz "As respostas à SEFAZ não estão ativadas neste servidor." O que já está gravado continua à vista (só leitura): o aviso do prazo de 90 dias (faixa da Entrada de Notas e linha do quadro) e as linhas de resposta de cada nota |
| `ligada` | exige `SEFAZ_DFE_AMBIENTE` `homologacao` ou `producao` (senão a API não sobe); **ainda precisa** do botão "Ligar as respostas" em Configurações. Os eventos usam o ambiente da busca |
| qualquer outro | a API não sobe |

**Nunca** pôr `ligada` sem o OK do contador por escrito e o "eu autorizo" do dono, dado na hora e por escrito; o dono acompanha cada passo. Nenhum agente executa o roteiro (está em `README.md`, "Pendências do dono"). "Dar entrada" nunca fala com a SEFAZ: a confirmação sai do tique. Notas com ciência registrada precisam de resposta final em 90 dias (pelo sistema ou pelo portal).

**A API roda em UMA instância.** A trava das respostas e a regra "lote aberto há até 2 minutos = outro processo no meio do envio" assumem um processo só: duas cópias da API no mesmo banco podem mandar dois lotes no mesmo intervalo. Nunca escalar o serviço `api` (`--scale`) nem subir uma 2ª API apontando para o mesmo banco (a busca da entrega 2 assume o mesmo).

Roteiro do primeiro teste real:
1. **Antes, sem falar com a SEFAZ:** entrega no ar com `SEFAZ_MANIFESTACAO` vazia; `select count(*) from sefaz_eventos_lotes` = 0; `pg_dump`. No contêiner, sem rede (Node 22 da imagem, não o 20 local): `docker exec erp-freela-api node -e "<confere que tls.rootCertificates tem a ISRG Root X1 pela impressão digital 96:BC:EC:06:…:08:C6, gera uma chave RSA na hora e assina/verifica 'x' com RSA-SHA1>"` = as duas conferências `true`. Assinatura falhou = o OpenSSL da imagem recusa SHA-1: parar.
2. **Homologação (1º "eu autorizo"):** a caixa de homologação quase nunca tem nota; o dono escolhe UMA chave de nota real recente **ainda não lançada no Comanda** (conferir antes: `select count(*) from notas_entrada where chave = '<chave>'` = 0), semeada por SQL em `notas_sefaz` com `ambiente = 'homologacao'`, `cnpj_destinatario` da empresa, `situacao_sefaz = 'autorizada'`, `tp_nf = 1`, `autorizada_em = now() - interval '1 day'`. Por quê: a conferência de "já lançada" cruza só pela chave, sem olhar o ambiente; uma chave já lançada vira "Já lançada" na linha de homologação, o sistema não manda o aviso de chegada (nem a confirmação) e o lote de 1 não sai. Pelo mesmo motivo, não lançar essa nota no Comanda enquanto o servidor estiver em homologação (nasceria uma confirmação de homologação para ela). `SEFAZ_MANIFESTACAO=ligada` com `SEFAZ_DFE_AMBIENTE=homologacao`, recriar só a API (`docker compose -f docker-compose.prod.yml up -d --no-deps api`), "Ligar as respostas"; o próximo tique manda um lote de 1. Esperado: lote 128 e evento 135 ou 136. Registrar a linha de `sefaz_eventos_lotes`, a de `sefaz_manifestacoes` (`c_stat`, `x_motivo`, formato do `n_prot`) e o log `sefaz.eventos`. Depois, na mesma nota, "Não reconheço…" e, numa 2ª chave, "A compra não aconteceu" e "Já lancei de outro jeito".
   - **O envelope SOAP SEM prefixo nunca foi à SEFAZ.** Se vier 297/298 ou erro de esquema no 1º lote, a volta conhecida é `envelope: 'prefixado'` (o que o mercado manda; uma linha em `modules/sefaz/eventos.adapter.ts`): conferir isso ANTES de qualquer outra hipótese. Anotar também se a SEFAZ confere a assinatura dentro ou fora do envelope (o teste do corpo real prova que ela confere nos dois casos com o envelope sem prefixo).
   - `retEvento` sem chave não casa com nenhum evento (as linhas de parada não se aplicam a ele): observar no 1º teste.
   - Pontos "não confirmado": `SEFAZ_TLS` sem envio = raiz do `hom1` fora do `ca`; HTTP 500 com `Fault` = action ou corpo (`nfeDadosMsg` direto) recusados; 250 = `cOrgao` 91 recusado; 297/298 = assinatura; 225/404 = esquema; 577–579 = relógio.
3. **Produção (2º "eu autorizo", depois do OK do contador):** desligar as respostas, `SEFAZ_DFE_AMBIENTE=producao` e `SEFAZ_MANIFESTACAO=ligada`, recriar só a API. Lote de 1: antes de ligar, ignorar com "Outro motivo: teste" as notas elegíveis (até 9 dias, em "Falta lançar" ou "Parece já lançada") menos a escolhida; ligar; esperar o 135; só então "Voltar para a lista" das outras. Registrar o emissor do certificado TLS de `www.nfe.fazenda.gov.br` no dia; anotar quanto tempo o XML completo levou entre o 135 e o "Conferir" acender; dar entrada nessa nota pelo "Conferir" (em até 5 min, um 210200 `dar_entrada`). Vigiar por 24 h: `select tp_evento, situacao, c_stat, count(*) from sefaz_manifestacoes group by 1,2,3` sem `falhou` nem `recusada` inesperada, e `select resultado, c_stat, count(*) from sefaz_eventos_lotes group by 1,2` sem 656.
4. **Volta, nesta ordem:** (1) PRIMEIRO "Desligar as respostas" na tela; (2) `SEFAZ_MANIFESTACAO` vazia no `.env`; (3) recriar só a API (`docker restart` não relê o `.env`); (4) conferir que o painel diz "As respostas à SEFAZ não estão ativadas neste servidor." e que `docker exec erp-freela-api printenv SEFAZ_MANIFESTACAO` sai vazio. **Nunca apagar `sefaz_manifestacoes` nem `sefaz_eventos_lotes`.** Avisar o dono: toda nota com ciência registrada ainda precisa de resposta final em 90 dias. Com a variável vazia o aviso continua (faixa âmbar na Entrada de Notas e linha "N notas precisam de resposta até…" no quadro), desde que a busca siga ativada no servidor (`SEFAZ_DFE_AMBIENTE` não vazio: sem ela a aba e o aviso somem); a resposta, então, é pelo portal ou religando as respostas.

Perguntas que só o dono ou o contador respondem (antes de ligar): (contador) pela cláusula 15ª-C § 5º, a ciência obriga uma resposta final para o restaurante, ou a NT 2020.001 restringe aos obrigados? qual a multa de SP por não responder? ele concorda com ciência automática + confirmação ao lançar? ele já responde (manifesta) as notas deste CNPJ por outro sistema? (a última resposta vale: nosso 210200 sobre um 210220 dele vira retificação; combinem quem responde); (dono) "É a mesma nota" e "Já lancei de outro jeito" confirmam a compra sozinhos (decisão provisória); notas lançadas ANTES da 1ª vez que as respostas forem ligadas ficam sem confirmação automática (decisão provisória; desligar e religar depois não muda essa data) — basta?; qual chave de nota real usar no teste de homologação.

Registro: o `api/Dockerfile` roda `npm ci` com as devDependencies (anterior a esta entrega); o `xml-crypto` 6.4.0 é devDependency, só dos testes, e por isso vai para a imagem, mas nenhum código fora de `__tests__` o importa. Cuidado: o certificado e a chave só chegam à assinatura pela porta `CERTIFICADO_DIGITAL`; nada vai para log (nunca `NODE_DEBUG=http|https|tls`).

## Cupom fiscal (NFC-e modelo 65; pronto e DESLIGADO por padrão)

Variável `NFCE_AMBIENTE` (declarada no `docker-compose.prod.yml` como `${NFCE_AMBIENTE:-}`; modelo em `api/.env.example`). É separada de `SEFAZ_DFE_AMBIENTE` e de `SEFAZ_MANIFESTACAO`:

| Valor | Efeito |
|---|---|
| ausente ou vazia | `desligado` (o padrão): emitir, reenviar, consultar, cancelar, descartar, testar a conexão e ligar respondem 503 `NFCE_DESLIGADA`; nenhuma conexão sai. Cadastro, lista, DANFE, XML e zip do mês continuam funcionando |
| `homologacao` | usa o ambiente de teste da SEFAZ (cupom sem valor fiscal; a venda nunca baixa o estoque) |
| `producao` | cupom valendo |
| qualquer outro | **a API não sobe** (falha de validação, de propósito) |

Mesmo com a variável ligada, nada é emitido até alguém tocar em "Emitir cupons" em Configurações → Cupom fiscal (cada ambiente tem o seu botão, e ele nasce desligado). **Nunca** pôr `homologacao` ou `producao` sem o "eu autorizo" do dono, dado na hora e por escrito;
nenhum agente executa o roteiro (ele está em `README.md`, "Pendências do dono").

**Subida (entrega no ar com o cupom desligado):**
- Migrações novas, aplicadas pelo `prisma migrate deploy` do contêiner: `20261119120000_nfce` (tabelas `nfce_*` e as funções de venda), `20261119120100_nfce_gatilho` (o cupom autorizado vira imutável) e `20261119120200_nfce_descartado_por` (quem descartou).
  Faça o `pg_dump` antes, como em toda subida.
- `CERTIFICADO_SECRET` é **obrigatório para salvar o CSC** (a mesma variável do certificado, passo 3b): sem ela, salvar o código de segurança dá 503 `NFCE_SEM_SEGREDO`. Se o segredo se perder ou mudar, o CSC fica ilegível e precisa ser digitado de novo.
- Conferir no ar, sem falar com a SEFAZ: Configurações → Cupom fiscal mostra "A emissão de cupom fiscal não está ativada neste servidor."; `select count(*) from nfce_cupons` = 0 e `select count(*) from nfce_envios` = 0.

**Roteiro do 1º teste em HOMOLOGAÇÃO (só com o "eu autorizo" do dono; o dono acompanha):**
1. Pré-condições: `pg_dump`; certificado A1 válido da empresa; IE, regime (CRT), endereço, série e CSC de homologação salvos; ao menos um produto com perfil fiscal e NCM; "Para ligar a emissão, falta:" vazio.
   Perguntar antes ao contador a série e o CSC do caixa de hoje (a série do Comanda não pode ser uma das do caixa).
2. `NFCE_AMBIENTE=homologacao` no `.env` do servidor e recriar só a API: `docker compose -f docker-compose.prod.yml up -d --no-deps api` (`docker restart` NÃO relê o `.env`). Ligar "Emitir cupons" em homologação, "Testar conexão" e emitir UM cupom de teste; depois cancelar o mesmo cupom (dentro de 29 min).
3. O que nunca foi conferido contra a SEFAZ-SP e precisa ser anotado nesse 1º teste (se algo diferir, parar e relatar; não consertar no servidor):
   - as URLs, as actions e os namespaces do WSDL de SP (seguem o padrão nacional, mas nunca foram conferidos);
   - se SP devolve `protNFe`/`retEvento` com prefixo de namespace (o adaptador recusa a resposta: o cupom fica `sem_resposta` e o cancelamento `cancelando`; a saída é "Consultar na SEFAZ");
   - o envelope SOAP **sem prefixo**: se vier 297/298 ou erro de esquema, a volta conhecida é `envelope: 'prefixado'` (uma linha em `modules/sefaz/nfce.adapter.ts` e em `eventos.adapter.ts`); conferir isto ANTES de outra hipótese;
   - o formato do `digVal` devolvido (a conferência com o XML assinado); se o `retEvento` traz `chNFe`; o `dhRegEvento` de um 573 real;
   - o 205 (NF-e denegada) e o código de "fora do prazo" do cancelamento (a tela só conta 29 min; o código real da SEFAZ nunca foi visto);
   - a aspa simples sem escape dentro do XML (`'` em nome de produto);
   - a URL do QR Code (as duas formas de SP, com e sem `p=`/`hash`) **e a leitura do QR pela câmera do celular**;
   - a impressão: escolher o papel de **80 mm** no diálogo da impressora (o CSS não fixa o papel; a largura útil é de 72 mm) e conferir que o DANFE sai inteiro, sem cortar o QR;
   - o 656 (consumo indevido): o adaptador respeita o bloqueio de 1 hora, e nunca há reenvio automático.
4. Produção só depois do OK do contador e de um 2º "eu autorizo": a venda emitida no Comanda precisa ter uma única origem no estoque (pergunta 1 do README); responder o quadro "Caixa de hoje" (quem conta as vendas) e emitir e cancelar um cupom de teste em homologação são pré-condições que a própria tela cobra antes de ligar valendo.

**Volta, nesta ordem:** (1) PRIMEIRO "Desligar a emissão" na tela (senão o botão fica ligado no banco e volta sozinho no dia em que a variável for posta de novo); (2) `NFCE_AMBIENTE` vazia no `.env`; (3) recriar só a API (`docker restart` não relê o `.env`);
(4) conferir que Configurações diz "A emissão de cupom fiscal não está ativada neste servidor." Nunca apagar `nfce_*`: o cupom autorizado é documento fiscal e o XML precisa ser guardado por 5 anos. Pendente na SEFAZ (`sem_resposta`, `cancelando`): consultar pela tela antes de desligar.

Registro: o `api/Dockerfile` roda `npm ci` com as devDependencies, então a imagem leva o `xml-crypto` (devDependency, só dos testes); nenhum código fora de `__tests__` o importa. Registrado, não mudado.
