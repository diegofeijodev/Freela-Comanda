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
  smoke `bash scripts/smoke-capped.sh` (banco descartável, 165 checagens: permissões admin × loja, inventário cego de ponta a ponta,
  lista de compras, nota fiscal, contas/DRE/caixa, importações, usuários, PDF sem chave).
- Web: `yarn test` (7 arquivos, as regras puras do protótipo), `yarn typecheck`, `yarn lint`,
  `bash scripts/browser-check.sh` (Playwright headless, 68 checagens: admin no desktop e loja no celular pelos formulários, nota por XML, inventário cego, caixa; capturas em `.cache/telas`).

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
  - Criar `CERTIFICADO_SECRET` (32+ caracteres aleatórios) no `.env` do servidor ANTES do primeiro envio (`bash ~/erp-deploy/segredo-certificado.sh` faz isso) e guardar esse valor em lugar seguro: se ele mudar ou se perder, o certificado guardado fica ilegível e precisa ser enviado de novo.
  - A tela do certificado e a faixa de aviso nunca foram abertas num navegador (a conferência automática não rodou por falta de memória na máquina de desenvolvimento): conferir no navegador antes de usar.
  - Abrir o painel num Chrome com a senha de login salva e ver se o campo da senha do certificado vem preenchido sozinho (se vier, avisar: há correção prevista). Nunca aceitar quando o navegador oferecer salvar a senha do certificado.
  - Nenhum e-CNPJ real foi testado (os testes usam certificados de teste fictícios): o primeiro envio do certificado verdadeiro é o teste real. Se for recusado, anotar a mensagem exata e olhar `cadeia_conferida` depois de aceito.
  - O pacote de autoridades certificadoras do ITI embutido é de 16/11/2026 e envelhece: `api/scripts/atualizar-cadeia-icp.sh` o renova.

## Migração dos dados (pendente)

As tabelas são idênticas às do Supabase do Lovable, então trazer os dados de Valinhos (insumos, fichas, inventários, vendas, contas) é cópia
linha a linha — mas precisa de uma exportação feita de dentro do Lovable (o banco de lá só abre com login), como foi feito no Meu Funil.
Enquanto isso, a tela **Importar Dados** aceita as mesmas planilhas de insumos, fichas e vendas.

## Produção

Nome do produto: **Freela Comanda** (`freelacomanda.com.br`; API `api.freelacomanda.com.br`, web na Vercel `freela-comanda`). Roteiro e estado em `docs/deploy.md` (EC2 do Freela + Vercel, mesmos passos do Praça/Meu Funil; scripts em `~/erp-deploy/`). Contrato da API: `docs/api-contract.md`.
