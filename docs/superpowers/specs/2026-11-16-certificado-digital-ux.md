# Certificado digital (A1): interface e textos

Complementa `2026-11-16-certificado-digital-design.md` (não o contradiz). Usuário: admin, quase sempre no celular (360 px). Loja não vê nada.
Job: "Quando o contador me passa o certificado, quero enviá-lo sem ajuda técnica e saber se está valendo." Meta: enviar em 3 toques + senha; saber a situação sem abrir nada (a faixa).
Componentes: `Panel`, `Tag` (`ok`/`warn`/`bad`), `Button`, `Input`, `Label`, `AlertDialog` (ui/alert-dialog, no lugar do `confirm()` do painel de IA: lá o texto do navegador não diz a consequência). Ícones lucide como no `IaChavePanel` (`CheckCircle2` ok, `CircleAlert` âmbar/vermelho). Cor sempre com ícone + texto. Painel `<Panel title="Certificado digital (A1)">`, logo abaixo do painel de IA, só `me.perfil === "admin"`. Obs.: o "Salvar" do topo da tela salva só Empresa/Geral; o painel tem botões próprios e a ajuda diz isso.

## 1. Estados do painel
Texto de abertura (sempre): "É o arquivo digital da empresa que assina notas e fala com a SEFAZ. Ainda não usamos para nada, mas guardar agora deixa tudo pronto para buscar notas na SEFAZ e emitir cupom fiscal (recursos que virão; sem data)."

**Carregando:** 3 linhas de `Skeleton`. **Erro ao carregar:** "Não consegui ver o certificado agora. Toque em Tentar de novo." [Tentar de novo].

**A. Sem certificado** (`ausente`): faixa neutra "Nenhum certificado guardado" + formulário.
```
Certificado digital (A1)
Nenhum certificado guardado
Arquivo do certificado (.pfx ou .p12)
[ Escolher arquivo            ]
Senha do certificado
[ ••••••••••            (olho)]
A senha é usada só para conferir. Não
fica guardada.
[ Conferir e guardar certificado ]
```
Rótulos: "Arquivo do certificado (.pfx ou .p12)"; botão do arquivo "Escolher arquivo", depois mostra o nome ("empresa.pfx · 4 KB") + "Trocar arquivo". Ajuda do arquivo: "Pergunte ao seu contador por 'certificado A1 com a senha'." Ajuda da senha: "É a senha que veio com o arquivo. Não guardamos a senha." Primário: **Conferir e guardar certificado**.

**B. Enviando/conferindo:** campos desabilitados, botão "Conferindo…" com spinner, abaixo: "Conferindo o certificado. Leva alguns segundos." (`aria-live="polite"`). Sem barra de progresso (arquivo pequeno).
Sucesso: toast "Certificado guardado." e o painel vira o estado D (ou F se houver aviso). Senha e arquivo são limpos.

**C. Erro de validação:** a mensagem do servidor aparece em caixa vermelha DENTRO do painel, acima do botão, com ícone e `role="alert"` (toast sozinho some em segundos e no celular fica fora da tela). Ela fica até a próxima tentativa. Não vai em toast. O foco vai para a caixa de erro. Campos: o arquivo escolhido permanece; **a senha só é limpa quando o erro é senha incorreta ou arquivo trocado**, e então o foco vai para o campo de senha (mensagem "Senha do certificado incorreta. Digite de novo."). Nos outros erros a senha permanece (a pessoa deve poder trocar de arquivo sem redigitar). Sucesso sempre limpa. Erro de rede: "Não consegui falar com o servidor. Confira a internet e toque em Conferir e guardar certificado de novo. Seus dados continuam aqui."; 503 `SEM_SEGREDO`: ver trocas.

**D. Válido:** `Tag ok` "Válido" + ícone.
```
(v) Válido            [Substituir]
Empresa de Teste Ltda
CNPJ 12.345.678/0001-95
Certificado A1 · emitido por AC X
Vale até 10/03/2027 (faltam 114 dias)
Cadeia ICP-Brasil conferida
Enviado por Diego em 16/11/2026 às 14h32
[Substituir certificado] [Remover]
```
"Substituir certificado" = secundário (outline); "Remover" = outline com texto vermelho, lado a lado em ≥ 360 px, empilhados abaixo de 340. Sem botão de baixar.

**E/F. Com aviso** (`Tag warn`, ícone `CircleAlert`; o certificado continua guardado e valendo; avisos empilhados em linhas âmbar sob os dados):
- Vence em ≤ 30 dias: Tag "Vence em 12 dias" (hoje: "Vence hoje"; 1: "Vence amanhã"); linha: "Vence em 10/03/2027. Peça o novo certificado ao seu contador e envie aqui antes dessa data." Botão primário passa a ser **Enviar certificado renovado** (abre o estado substituindo).
- Outro estabelecimento: "Este certificado é do CNPJ 12.345.678/0002-76, outro estabelecimento da mesma empresa. Foi aceito. Se a SEFAZ recusar, envie o certificado do CNPJ 12.345.678/0001-95."
- Cadeia não conferida: "Guardado, mas não consegui conferir a emissora do certificado. Isso não impede de guardar; a SEFAZ confere na hora de usar." (A linha "Cadeia ICP-Brasil conferida" some.)
- Tipo diferente de A1: "Este certificado não é do tipo A1 comum (é o tipo X). Pode servir para nota fiscal, mas confirme com a certificadora." Para `SE-S` (válido): mostrar "Selo eletrônico (SE-S)" no tipo, sem aviso.

**G. Com problema** (`Tag bad`, caixa vermelha, ícone; Substituir vira primário):
- Vencido: "Este certificado venceu em 10/03/2026. Envie o certificado renovado para voltar a usar." [Enviar certificado renovado] [Remover].
- Ilegível: "O certificado guardado não pode mais ser lido (a chave de segurança do servidor mudou). Envie o arquivo de novo." [Enviar o certificado de novo] [Remover]. Sem dados do titular (o servidor os tem; mostrar titular/CNPJ cinza para a pessoa saber qual arquivo procurar).
- CNPJ não bate (a empresa mudou o CNPJ depois): "Este certificado é do CNPJ X, mas a empresa agora está com o CNPJ Y. Corrija o CNPJ da empresa ou envie o certificado certo."
- Sem segredo no servidor: "O servidor ainda não está pronto para guardar certificados. Avise o suporte." Formulário desabilitado.

**H. Substituindo:** o mesmo formulário do A abre embutido, acima dos dados atuais, com título "Novo certificado" e a linha fixa: "O certificado atual (Empresa..., vale até 10/03/2027) continua valendo até o novo passar na conferência." Botão **Conferir e trocar certificado** + link "Cancelar" (limpa arquivo/senha). Se falhar: erro como em C e o atual segue intacto (dizer: "O certificado atual não foi alterado.", acrescentado pelo cliente ao erro). Sucesso: toast "Certificado trocado."

**I. Remover:** `AlertDialog`. Título "Remover o certificado digital?". Corpo: "Vamos apagar o certificado de Empresa de Teste Ltda (CNPJ 12.345.678/0001-95) do sistema. Hoje nada depende dele. Quando existirem 'buscar notas na SEFAZ' e 'emitir cupom fiscal' (ainda não existem, sem data), eles não vão funcionar até você enviar um certificado de novo. Para enviar de novo você precisa do arquivo .pfx e da senha; o sistema não devolve o arquivo. A remoção fica registrada com seu nome." Botões: "Manter certificado" (padrão, foco inicial) e "Remover certificado" (destrutivo). Sucesso: toast "Certificado removido." e volta ao estado A.

## 2. Faixa no topo do app (só admin)
Em `(app)/layout.tsx`, dentro de `<main>`, acima de `{children}` (no celular rola com a página, não sticky, para não comer tela; o cabeçalho de menu já é sticky). Dados: a mesma consulta `["certificado"]` do painel (`staleTime` 5 min), só quando `me.perfil === "admin"`; enquanto carrega ou em erro de rede, nada aparece (a faixa nunca bloqueia nem mostra erro próprio). É um link inteiro (`<Link>` com ≥ 44 px de altura) para `/configuracoes` (o painel está na aba Geral; rolar até ele com `#certificado-digital`).

| Situação | Tom | Texto | Dispensar |
|---|---|---|---|
| Vence em 8 a 30 dias | warn | "O certificado digital vence em N dias (10/03/2027). Envie o renovado em Configurações." | sim |
| Vence em 0 a 7 dias | warn forte | "O certificado digital vence em N dias (hoje / amanhã). Envie o renovado em Configurações." | não |
| Vencido | bad | "O certificado digital venceu em 10/03/2026. Envie o renovado em Configurações." | não |
| Ilegível | bad | "O certificado digital guardado não pode mais ser lido. Envie o arquivo de novo em Configurações." | não |
| CNPJ diferente (raiz) | bad | "O certificado digital não é do CNPJ da empresa. Confira em Configurações." | não |

Ícone `CircleAlert` + texto + "Ver" com seta; `role="status"`. Sem faixa para "ausente" (ainda não há recurso que dependa do certificado; seria ruído) nem para avisos só do painel (outro estabelecimento, cadeia, tipo). Dispensar (X, 44 px, `aria-label="Esconder aviso"`): sem storage, só estado em memória (esconde até recarregar a página/novo login). Aceitável, porque só é dispensável a 30 a 8 dias. Se o dono quiser lembrar por dias, a alternativa sem storage é guardar no servidor (campo `aviso_adiado_ate` por admin): não recomendo agora.

## 3. Regras de formulário
- `<input type="file" accept=".pfx,.p12,application/x-pkcs12">` (extensão primeiro: alguns Android ignoram o MIME). Escondido atrás de `<Button>` "Escolher arquivo"; rótulo associado, alvo ≥ 44 px. Validar no cliente antes de ler: extensão e tamanho > 64 KB ("Este arquivo é grande demais para ser um certificado A1 (máximo 64 KB).").
- Senha: `type="password"`, `autoComplete="new-password"` (o `off` é ignorado pelos gerenciadores), `name` sem "password" no id do arquivo, `spellCheck={false}`, `autoCapitalize="none"`, `autoCorrect="off"`; botão olho "Mostrar senha"/"Ocultar senha" (`aria-pressed`, 44 px). Limite 128 caracteres.
- Botão primário `disabled` até haver arquivo E senha; ao lado, linha de ajuda explica o que falta: "Escolha o arquivo e digite a senha." (substituída por nada quando completo). Durante o envio: campos e botão desabilitados, spinner + "Conferindo…", Cancelar oculto.
- Leitor de tela: região `aria-live="polite"` fixa no painel para "Conferindo o certificado…" e para o sucesso; erro em `role="alert"` com foco programático. Cada campo com `<Label htmlFor>`. Foco após sucesso: no título do painel; após remover: no botão "Escolher arquivo".
- Layout: 1 coluna, botões `w-full` no celular, `h-11` (≥ 44 px, mais que o `h-9` padrão do projeto), espaço ≥ 8 px entre os alvos; texto ≥ 14 px (ajudas `text-sm`, não `text-xs`).
- Após o envio o navegador descarta o arquivo da memória; nada vai para storage.

## 4. Linguagem
Usar: "certificado digital", "arquivo do certificado", "senha do certificado", "válido até", "vence em", "empresa", "contador", "certificadora" (quem emitiu), "guardar", "conferir", "enviar", "substituir", "remover", "SEFAZ" (já usado no produto), "cupom fiscal".
Evitar: PFX/PKCS#12 (só na extensão ".pfx/.p12"), chave privada, cadeia, ICP-Brasil sem explicação, token, AC, OID, política, SAN, e-CNPJ (usar "certificado de empresa"), A3 (explicar como "em token ou cartão"), "falha", "inválido", "upload", "cifrado".
"Cadeia ICP-Brasil não conferida" em uma frase: "Não consegui conferir se a certificadora que emitiu o certificado é reconhecida; ele foi guardado e a SEFAZ confere na hora de usar."
"A1" explicar uma vez: "certificado A1 = o arquivo que fica no computador (não o de cartão ou token)".

## 5. Histórico
Dentro do painel, sob os dados, `<details>` "Ver histórico" (recolhido), até 5 linhas mais recentes, sem paginação; sem tela nova. Linha: "Enviado por Diego em 16/11/2026 às 14h32" / "Substituído por Ana em 20/11/2026 às 09h10 (vale até 10/03/2028)" / "Removido por Diego em 02/12/2026 às 17h05". Cada linha com o CNPJ e o titular só quando mudam. Sem certificado: o histórico continua visível (a última linha é a remoção). A linha de cima do estado D ("Enviado por…") repete a mais recente: é a única que fica à vista. Pede ao desenho técnico: o GET devolver `historico: [{evento, feito_por_nome, feito_em, valido_ate}]` (máx. 5).

## 6. Trocas de texto sugeridas
| Atual | Sugerida | Por quê |
|---|---|---|
| `CERTIFICADO_ARQUIVO`: "Este arquivo não é um certificado A1 (.pfx ou .p12)." | "Este arquivo não parece um certificado digital. Escolha o arquivo .pfx ou .p12 que o contador enviou." | Diz o que fazer. |
| `CERTIFICADO_FORMATO`: "Não consegui abrir… Exporte o .pfx de novo" | "Não consegui abrir este certificado. Peça ao contador para gerar o arquivo de novo." | "Exportar" é jargão; o dono não exporta. |
| `CERTIFICADO_SEM_CHAVE`: "Este arquivo não tem a chave privada. Use o A1 (.pfx exportado com a chave); … token ou cartão (A3)…" | "Este arquivo não serve: falta a parte secreta do certificado. Peça ao contador o certificado A1 (arquivo), não o de cartão ou token." | Sem "chave privada/A3". |
| `CERTIFICADO_SEM_CNPJ`: "…(e-CNPJ): não encontrei CNPJ nele." | "Este certificado não é de empresa: não encontrei um CNPJ nele. Peça o certificado da empresa, não o seu pessoal." | Distingue pessoal x empresa. |
| `EMPRESA_SEM_CNPJ`: "Preencha o CNPJ da empresa (painel Empresa) antes…" | "Preencha o CNPJ da empresa no quadro Empresa, toque em Salvar (no alto da página) e envie o certificado de novo." | O CNPJ comparado é o salvo; sem tocar Salvar o erro repete. |
| `CERTIFICADO_NAO_ICP`: "…não é da ICP-Brasil; a SEFAZ não aceita." | "Este certificado não foi emitido por uma certificadora brasileira credenciada; a SEFAZ não aceita. Peça outro ao contador." | Sem sigla; diz o próximo passo. |
| `CERTIFICADO_CADEIA`: "A cadeia deste certificado não confere. Exporte…" | "Este certificado parece alterado ou incompleto. Peça ao contador ou à certificadora um arquivo novo." | Sem "cadeia/exportar". |
| `CERTIFICADO_SEM_SEGREDO` (503): "Avise o suporte." | "O servidor ainda não está pronto para guardar certificados. Fale com o suporte do Freela Comanda." | "Suporte" de quem? |
| `CERTIFICADO_SENHA` | manter + "Digite de novo." | Ação. |
| Aviso de tipo: "(política 2.16.76.1.2.x)… Confira com a certificadora." | trocar pelo texto do estado E/F (sem o OID). | OID é ruído. |
| Aviso de cadeia: "Não consegui conferir a cadeia…" | texto do estado F. | Sem "cadeia". |
| Porta, frases de uso | fora desta tela (projetos 3 e 4). | |

## 7. O que conferir no navegador (360 px e desktop)
1. Como loja: nenhum painel nem faixa; como admin: painel abaixo do de IA.
2. Sem certificado: botão desabilitado; só habilita com arquivo e senha; o seletor do Android lista .pfx/.p12.
3. Erro de senha: caixa vermelha dentro do painel, senha vazia, foco nela, arquivo mantido. Outro erro: senha mantida.
4. Durante o envio nada clicável, "Conferindo…" visível; ao fim, a senha some e o painel mostra os dados.
5. Dados (titular, CNPJ máscara 00.000.000/0000-00, "Vale até 10/03/2027 (faltam 114 dias)", enviado por/em no horário de Brasília) sem cortar em 360 px; sem scroll horizontal.
6. Cada estado da seção 1 (A a I) com ícone + texto + tom; vencendo ≤ 30 dias → faixa; ≥ 31 dias → sem faixa; ≤ 7 → sem X.
7. Faixa leva a Configurações e ao painel; "Esconder aviso" some até recarregar; nada no storage do navegador além da sessão (inspecionar).
8. Remover: diálogo com foco em "Manter certificado"; Esc cancela; remover volta ao estado A e a faixa some.
9. Substituir com arquivo errado: o atual continua mostrado e válido.
10. Zoom 200% e leitor de tela: erro anunciado, olho com estado falado, alvos ≥ 44 px, fonte ≥ 14 px; resposta/DOM sem a senha nem o arquivo.
