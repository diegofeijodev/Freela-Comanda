# Freela ERP

Sistema de gestão de restaurante (unidade "Chopp & Espeto Valinhos"), portado do protótipo Lovable `erpfreela` para a stack do Freela:
vendas importadas do PDV/iFood, fichas técnicas com custo e preço sugerido, inventário com **contagem cega**, estoque teórico,
estoque objetivo com sazonalidade, lista de compras, entrada de NF-e (XML ou PDF por IA), contas a pagar com conciliação de DDA,
fechamento de caixa e DRE. Perfis `admin` e `loja` (a loja só conta estoque, consulta fichas sem custo e vê a lista de compras sem valores).

| Pasta | Stack | Porta |
| --- | --- | --- |
| `api/` | NestJS 11 + Fastify + Prisma 5.22 + PostgreSQL 16 (npm) | 3016 |
| `web/` | Next.js 15 + React 19 + Tailwind 4 + shadcn (yarn) | 3026 |
| Postgres | `docker compose up -d postgres` (contêiner `erp-freela-postgres`) | 5440 |

## Rodar local

```bash
docker compose up -d postgres
cd api && cp .env.example .env && npm install && npm run prisma:migrate:deploy && npm run seed && npm run start:dev
cd web && cp .env.example .env.local && yarn install && yarn dev     # http://localhost:3026
```

Contas do seed (só desenvolvimento): `admin@erpfreela.local` e `loja@erpfreela.local`, senha `erpfreela123`.
Num banco vazio, a tela de entrada oferece **"Primeiro acesso? Criar conta de administrador"** (como no protótipo).

## Verificação

Na máquina do dono, sempre pelo teto de memória (`scripts/run-capped.sh`, ver `CLAUDE.md`):

- API: `npx jest --runInBand <arquivos>` (6 suítes), `npm run typecheck`, `npx eslint "src/**/*.ts"`,
  smoke `bash scripts/smoke-capped.sh` (banco descartável, 737 checagens em 24/11: permissões admin × loja, inventário cego de ponta a ponta,
  lista de compras, nota fiscal, contas/DRE/caixa, importações, usuários, PDF sem chave, certificado, SEFAZ, cupom, importar vendas e, no fim, o
  roteiro ponta a ponta E1–E9, a Cana e o multiempresa; as 2 que falham em novembro, "DRE de novembro" e "mês de 30 dias", são antigas, de data).
- Web: `yarn test` (7 arquivos, as regras puras do protótipo), `yarn typecheck`, `yarn lint`,
  `bash scripts/browser-check.sh` (Playwright headless, 68 checagens: admin no desktop e loja no celular pelos formulários, nota por XML, inventário cego, caixa; capturas em `.cache/telas`);
  grupos à parte: `browser-check-importar-vendas.mjs` e `browser-check-cana.mjs` (39 checagens), com `CHECK_SCRIPT` e `BC_ROTAS` (CLAUDE.md).

## Diferenças em relação ao Lovable (de propósito)

- **Sem Supabase:** banco próprio com as MESMAS tabelas/colunas; as regras de negócio continuam em SQL (views/funções/gatilho do protótipo),
  só que `auth.uid()` virou parâmetro e as políticas RLS viraram marcas de permissão nas rotas da API.
- **Sem cadastro aberto nem e-mail:** o primeiro acesso cria o admin; depois só o admin cria contas. "Esqueci minha senha" = pedir ao admin, que
  redefine em Usuários; cada pessoa troca a própria senha em "Trocar senha".
- **Leitura de PDF (NF/DDA)** pela API da Anthropic (Claude, `AI_PDF_MODEL`, padrão `claude-opus-5-5`, com fallback automático do servidor se o
  modelo recusar) em vez do gateway da Lovable. Sem `ANTHROPIC_API_KEY`: "Leitura de PDF não configurada" (o XML funciona sempre).
- **Entrada de nota, importações e liquidação** viraram UMA transação cada (no protótipo eram vários inserts do navegador; uma falha no meio
  deixava nota sem conta a pagar).
- **Correções:** caixa/DRE em meses de 30 dias (o protótipo filtrava até o dia 31 e a consulta falhava); linha de venda com data inválida é
  ignorada em vez de derrubar a importação inteira; conta de nota não é excluída solta.

## Pendências do dono (conferir depois de subir)

- **Nota por foto:** a leitura de foto real pela IA não é coberta por teste (nenhum teste faz rede). Depois de subir, fotografe uma nota de verdade
  em Entrada de Notas e confira itens, insumos indicados e sugestões de insumo novo.
- Os leitores do ChatGPT e do Gemini nunca rodaram contra a API real; confira cada um com uma chave de verdade antes de depender dele.
- **Certificado digital A1 (Configurações):**
  - Criar `CERTIFICADO_SECRET` (32+ caracteres aleatórios) no `.env` do servidor ANTES do primeiro envio (`bash ~/erp-deploy/segredo-certificado.sh` faz isso) e o segredo fica só no servidor (nunca sai de lá). O que se guarda, por um meio seguro, é uma cópia do arquivo `.env` do servidor: se o valor se perder ou mudar, o certificado guardado fica ilegível e precisa ser enviado de novo.
  - A tela do certificado e a faixa de aviso nunca foram abertas num navegador (a conferência automática não rodou por falta de memória na máquina de desenvolvimento): conferir no navegador antes de usar.
  - Abrir o painel num Chrome com a senha de login salva e ver se o campo da senha do certificado vem preenchido sozinho (se vier, avisar: há correção prevista). Nunca aceitar quando o navegador oferecer salvar a senha do certificado.
  - Nenhum e-CNPJ real foi testado (os testes usam certificados de teste fictícios): o primeiro envio do certificado verdadeiro é o teste real. Se for recusado, anotar a mensagem exata e olhar `cadeia_conferida` depois de aceito.
  - O pacote de autoridades certificadoras do ITI embutido é de 16/11/2026 e envelhece: `api/scripts/atualizar-cadeia-icp.sh` o renova.

- **Notas da SEFAZ (busca automática das notas de compra):** a primeira etapa está pronta e DESLIGADA, mas **nada foi testado contra a SEFAZ** (nem homologação): os testes usam porta falsa, HTTPS local e telas simuladas. A primeira chamada real exige o "eu autorizo" do dono, dado na hora, e ninguém liga isso sozinho. Roteiro do primeiro teste real (o dono acompanha cada passo que fala com a SEFAZ):
  1. **Antes, sem falar com a SEFAZ:** conferir que a entrega está no ar com `SEFAZ_DFE_AMBIENTE` ausente (desligado); em Configurações o certificado aparece "válido" e o CNPJ da empresa está salvo; `select count(*) from sefaz_consultas` dá 0; fazer um `pg_dump`.
  2. **Pergunta ao contador (antes de ligar):** "O senhor já baixa as notas desse CNPJ pela SEFAZ (programa do contador, manifestação)?" Dois sistemas no mesmo CNPJ levam a bloqueio 656 de 1 hora para os dois.
  3. **Homologação (1º "eu autorizo"):** pôr `SEFAZ_DFE_AMBIENTE=homologacao` no `.env` do servidor e recriar só a API: `docker compose -f docker-compose.prod.yml up -d --no-deps api` (reiniciar, com `docker restart` ou `docker compose restart`, NÃO relê o `.env`); "Ligar a busca" e "Buscar agora". Esperado: 137 (primeiro uso). Registrar a linha de `sefaz_consultas` (`c_stat`, `erro_code`, `x_motivo`) e o log `sefaz.distribuicao`. Fecha os pontos "não confirmado": `SEFAZ_TLS` com `enviado` falso = a raiz do emissor da SEFAZ não está no `ca` (anotar o emissor; vira PR com o pacote regerado, nunca variável de ambiente); HTTP 415/500 ou rejeição de versão = SOAP 1.2 recusado (plano B: SOAP 1.1, trocando uma função): o `x_motivo` traz o status, o passo em que a leitura parou e o código do SOAP Fault (ex.: `HTTP 500 · passo http · Fault VersionMismatch` = versão recusada; `Fault Sender` = a SEFAZ recusou o nosso pedido, conferir antes de trocar de versão); nenhum 593 = o CNPJ-base confere; 280–286 ou 473 = problema no certificado.
  4. **Homologação, 2º clique antes de 65 minutos:** esperado 409 `SEFAZ_AGUARDE`, sem rede (`sefaz_consultas` não cresce). Depois dos 65 minutos o tique sozinho deve dar 137 de novo, sem 656.
  5. **Produção (2º "eu autorizo"):** desligar a busca, pôr `producao`, recriar só a API (o mesmo comando), ligar e fazer uma busca. Esperado 137. Atenção: 138 com documentos = aviso de que outro sistema já usava a busca (só aviso); 656 com `ultNSU` = a busca se desliga e avisa, e o dono fala com o contador. Vigiar por 24 horas: `select c_stat, count(*) from sefaz_consultas where iniciada_em > now() - interval '24 hours' group by 1` não pode ter 656.
  6. **Dias depois:** uma nota que chegou como resumo e foi lançada por arquivo tem de virar "Já lançada".
  7. **Volta, nesta ordem:** (1) PRIMEIRO tocar em "Desligar a busca" na tela (senão a busca fica ligada no banco e volta sozinha no dia em que alguém puser a variável de novo); (2) deixar `SEFAZ_DFE_AMBIENTE` vazia no `.env`; (3) recriar só a API: `docker compose -f docker-compose.prod.yml up -d --no-deps api` (reiniciar não relê o `.env`); (4) conferir que o painel diz "A busca de notas na SEFAZ não está ativada neste servidor." e que `docker exec erp-freela-api printenv SEFAZ_DFE_AMBIENTE` sai vazio. Nunca apagar linhas `sefaz_*`. Desligada por mais de 60 dias deixa buraco sem volta: avisar o dono.
  Detalhes e a recuperação de documento descartado: `docs/deploy.md`; rotas e erros: `docs/api-contract.md` §16. Na conferência do navegador (`browser-check.sh`) a busca nunca liga com certificado.

- **Respostas à SEFAZ (ciência, confirmação, "Não reconheço", "A compra não aconteceu"):** a entrega 3 está pronta e DESLIGADA (`SEFAZ_MANIFESTACAO` ausente + botão "Ligar as respostas"), e **nenhum evento foi enviado à SEFAZ** (nem homologação): os testes usam porta falsa e HTTPS local, e a assinatura foi conferida contra o `xml-crypto`. Só ligam depois de o contador concordar e com o "eu autorizo" do dono, dado na hora e por escrito. Roteiro curto (o dono acompanha cada passo; o roteiro completo, com a volta, está em `docs/deploy.md`):
  1. **Sem falar com a SEFAZ:** entrega no ar com a variável vazia; `select count(*) from sefaz_eventos_lotes` = 0; `pg_dump`; no contêiner (Node 22), conferir a raiz ISRG Root X1 em `tls.rootCertificates` e a assinatura RSA-SHA1.
  2. **Homologação (1º "eu autorizo"):** uma chave real recente **ainda não lançada no Comanda** (`select count(*) from notas_entrada where chave = '<chave>'` = 0: a conferência de "já lançada" cruza só pela chave, sem o ambiente, e uma chave já lançada não manda nada) semeada em `notas_sefaz` com `ambiente = 'homologacao'`; `SEFAZ_MANIFESTACAO=ligada`, recriar só a API, "Ligar as respostas"; esperado lote 128 e evento 135/136. **O envelope SOAP sem prefixo nunca foi à SEFAZ: 297/298 ou erro de esquema no 1º lote = volta para `envelope: 'prefixado'` antes de qualquer outra hipótese.** Anotar se a SEFAZ confere o evento dentro ou fora do envelope e como ela trata `retEvento` sem chave.
  3. **Produção (2º "eu autorizo", depois do OK do contador):** lote de 1 (ignorar as outras elegíveis com "Outro motivo: teste"), esperar o 135, conferir o 210200 ao dar entrada; vigiar 24 h `sefaz_manifestacoes` e `sefaz_eventos_lotes` (sem 656).
  4. **Volta, nesta ordem:** "Desligar as respostas" na tela, variável vazia, recriar só a API, conferir o painel; nunca apagar `sefaz_*`. Toda nota com ciência registrada ainda precisa de resposta final em 90 dias; o aviso do prazo continua na tela com a variável vazia (com a busca ativada no servidor).
  Perguntas ao contador: a ciência obriga resposta final para restaurante (cláusula 15ª-C § 5º, NT 2020.001)? multa em SP? concorda com ciência automática + confirmação ao lançar? ele já responde as notas deste CNPJ por outro sistema (a última resposta vale)? Ao dono: "É a mesma nota" e "Já lancei de outro jeito" confirmam sozinhos (provisório); notas lançadas antes da 1ª vez que as respostas forem ligadas ficam sem confirmação automática (provisório); qual chave usar na homologação. Rotas e erros: `docs/api-contract.md` §16.

- **Cupom fiscal (NFC-e):** pronto e DESLIGADO (`NFCE_AMBIENTE` ausente + "Emitir cupons" de cada ambiente desligado), e **nenhum cupom, consulta, status ou cancelamento foi enviado à SEFAZ** (nem homologação): os testes usam porta falsa e HTTPS local. A 1ª chamada real exige o "eu autorizo" do dono, na hora e por escrito; o roteiro de homologação e a volta estão em `docs/deploy.md`, rotas e erros em `docs/api-contract.md` §17.
  Perguntas ao dono e ao contador, numa lista só (as respostas entram em Configurações → Cupom fiscal; produção não liga sem a 1):
  1. A venda emitida no Comanda também é lançada no sistema do caixa de hoje? (se for, o estoque conta em dobro)
  2. Qual a série e o CSC do caixa de hoje? (o Comanda usa outra série)
  3. Regime tributário (CRT), IE, NCM, CEST, GTIN e o perfil fiscal (CFOP, CSOSN/CST, PIS/COFINS) de cada produto. O CRT 2 pede CSOSN ou CST? Por ora estão barrados o CST 20 (sem o campo de redução) e o CST de PIS/COFINS com alíquota.
  4. O que fazer com número pulado? (SP não tem inutilização; o zip do mês traz `numeros-nao-usados.csv` para o contador, inclusive a faixa pulada à mão em Configurações)
  5. A taxa de serviço entra no cupom?
  6. Quer o responsável técnico no XML (CNPJ, contato, e-mail, telefone)?
  7. O cupom pode ser só digital (QR/link), sem papel?
  8. O Pix do balcão é o código 17 (dinâmico) ou 20 (estático)? (hoje só o 17 está aceito)
  9. Reforma tributária: quais os códigos do Simples para 2027 (`cAtivSN`/`gTribSN`)? (hoje só o cadastro; nada sai no XML)
  Conferência no navegador antes de usar: abrir Cupom → Emitir com a emissão desligada e ler a faixa de aviso. A impressão do DANFE no papel de 80 mm só existe com um cupom autorizado: é passo do roteiro de homologação (`docs/deploy.md`).

- **Importar vendas de outros sistemas (Vendas → Importar vendas):** testado só com arquivos fictícios (nenhum arquivo real do outro sistema passou por aqui). Roteiro do primeiro uso real, com **um dia** de vendas:
  1. Mandar ao desenvolvedor um arquivo de exemplo de cada formato que o outro sistema exporta (o XML/.zip do contador, a planilha, o PDF do relatório) e dizer se esse sistema é o mesmo caixa das planilhas que já importamos ou outro canal (iFood, delivery, outra loja).
  2. Em Empresas, conferir que a empresa principal tem o CNPJ certo (o XML só entra se o cupom for desse CNPJ).
  3. Criar o sistema ("+ Novo sistema"), importar o arquivo de um dia e comparar o total da prévia com o total do relatório do sistema; confirmar.
  4. Importar o mesmo arquivo de novo: tem de dizer "já foi importado" / "já estão no Comanda" e não somar nada.
  5. PDF: a leitura pela IA só foi testada com leitor falso. Com a chave de IA salva, ler um relatório real de um dia e conferir linha a linha (a tela mostra "soma × total impresso").
  6. XML: o cancelamento por substituição (evento 110112), a contingência e o .zip com pastas nunca foram vistos num arquivo real; se algum cupom aparecer como "ignorado", anotar o motivo e mandar o arquivo.
  7. Se o navegador disser que não abre .zip, descompactar e escolher os .xml soltos (Ctrl+A na pasta).
  8. NF-e (modelo 55) com ICMS-ST ou IPI somados no total: a conferência "soma dos itens × total" não conhece esses impostos e põe a nota em "com problema" (fica de fora). Se aparecer, mandar o XML.

- **Controle da cana (aba Cana):** pronto, testado só com números inventados; **nada vem preenchido**. Antes do primeiro uso, na empresa
  da cana (Frutá Frozen Outlet Premium Itupeva, escolhida no seletor abaixo do logo):
  1. Usuários → no colaborador da loja, "Liberar telas" → marcar **Cana (lançar)**. Sem isso a loja nem vê a aba.
  2. Cana → Configuração: ligar "Leva caldo" em cada produto que leva caldo, com os ml de 1 unidade (no frozen, o tamanho do copo) e a marca "É frozen".
  3. Responder e informar: o que é o "rendimento do frozen" (a tela pergunta "1 litro de caldo vira quantos litros de frozen?"; se for outra coisa,
     avisar antes de usar); os litros esperados por dúzia podem ficar em branco nas 2 ou 3 primeiras semanas (a tela mostra a média real).
  4. A loja faz a 1ª contagem (fim do dia; de manhã = marcar Ontem) e, ao longo da semana, lança recebimentos e produção. Na contagem seguinte,
     abrir Cana → Semana e conferir as contas com o caderno da loja; anotar onde não bater.
  5. Ainda sem resposta (a tela já se ajusta, nada a mudar no código): sobra frozen pronto de uma semana para outra (o campo é opcional)? a loja pode
     desfazer o próprio lançamento por alguns minutos (hoje só o gerente anula)? quer um limite de perda que vire alerta?

  Para quem mexer no banco: o índice `vendas_origens_nome_key` (nome do sistema único, em `lower(nome)`) só existe na migração `20261125120000_vendas_importacao`; um `prisma migrate dev` vai propor apagá-lo. Não aceite (o mesmo vale para os índices parciais do cupom fiscal e `empresas_uma_principal`).

## Migração dos dados (pendente)

As tabelas são idênticas às do Supabase do Lovable, então trazer os dados de Valinhos (insumos, fichas, inventários, vendas, contas) é cópia
linha a linha — mas precisa de uma exportação feita de dentro do Lovable (o banco de lá só abre com login), como foi feito no Meu Funil.
Enquanto isso, a tela **Importar Dados** aceita as mesmas planilhas de insumos, fichas e vendas.

## Produção

Nome do produto: **Freela Comanda** (`freelacomanda.com.br`; API `api.freelacomanda.com.br`, web na Vercel `freela-comanda`). Roteiro e estado em `docs/deploy.md` (EC2 do Freela + Vercel, mesmos passos do Praça/Meu Funil; scripts em `~/erp-deploy/`). Contrato da API: `docs/api-contract.md`.
