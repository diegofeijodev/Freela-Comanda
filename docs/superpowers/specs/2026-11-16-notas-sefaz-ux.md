# Notas da SEFAZ, nota repetida e IA no XML: interface e textos

Complementa `2026-11-16-notas-sefaz-design.md` (não o contradiz; trocas de frase na seção 6). Usuário: administrador (dono/gerente), quase sempre no celular (360 px). Loja não vê nada.
Componentes: `PageHeader`, `Panel`, `Tag` (`ok`/`warn`/`bad`/`muted`), `Button` (`h-11`, `w-full` no celular), `Input`, `Label`, `Checkbox`, `AlertDialog`, `Skeleton`, `toast` (sonner). Ícones lucide com texto (`CheckCircle2`, `CircleAlert`, `Copy`, `Ban`, `EyeOff`, `Loader2`). Cor nunca sozinha. Datas `03/11/2026`, hora `14h05` (Brasília), valor `R$ 1.234,56`. Erros em caixa DENTRO da tela (não em toast), como no `CertificadoPanel`.
Jobs: (1) "Quando um fornecedor entrega, quero ver o que ainda não lancei, para não esquecer nota nem pagar em dobro." (2) "Quando carrego uma nota, quero ser avisado se ela já entrou." Meta: ver o que falta lançar em 2 toques a partir da Entrada de Notas; aceitar ou recusar uma nota repetida em 1 toque; ignorar em 3.

## 1. Aviso de nota repetida (decisão 9)
**Cedo:** logo depois de ler XML, PDF, foto ou "Conferir", a tela chama `GET /v1/notas/repetidas` e mostra a faixa abaixo, **acima do quadro "2. Dados da nota"**. Foco vai para a faixa (`role="alert"`, `tabIndex=-1`), e a página rola até ela. Chamar de novo se CNPJ, número ou série mudarem; mudou e já havia confirmado = a confirmação cai.
```
┌────────────────────────────────────┐
│ (!) Parece que esta nota já foi    │
│     lançada                        │
│ ATACADÃO S.A.                      │
│ NF 4411 · série 1 · R$ 1.234,56    │
│ Entrou em 03/11/2026 por foto      │
│ e mais 2 parecidas  [Ver]          │
│ [ Não lançar esta nota           ] │
│ [ É outra nota, lançar mesmo assim ]│
└────────────────────────────────────┘
```
- Caixa âmbar. Dados da nota mais nova; origem por extenso: "por XML", "por PDF", "por foto", "pela SEFAZ". "e mais N parecidas" abre `<details>` com até 4 linhas no mesmo formato (sem ele quando só há uma).
- **Não lançar esta nota:** descarta a leitura (igual ao Cancelar de hoje), sem confirmação (nada foi gravado), foco no campo de arquivo. Toast "Nota descartada. Nada foi lançado."
- **É outra nota, lançar mesmo assim:** não grava nada; a faixa vira neutra com `CheckCircle2`: "Você confirmou que esta é outra nota. Ao dar entrada, ela fica marcada como possível repetição." + link "Voltar atrás". "Dar entrada" segue o fluxo de hoje e envia `confirmar_repetida: true`.
- **Chave igual (já existe, sem saída):** em vez do toast de hoje, a mesma faixa em vermelho: "Esta nota já foi lançada. A chave de acesso é a mesma de NF 4411 (ATACADÃO S.A.), de 03/11/2026. Não dá para lançar duas vezes." Só o botão "Não lançar esta nota".
- **No "Dar entrada":** se a faixa existe e não foi confirmada, abre `AlertDialog` sem chamar o servidor. Se o servidor responder 409 `NOTA_REPETIDA` (dados mudaram), abre o mesmo diálogo com a frase do servidor. Título: "Esta nota parece já lançada". Corpo: frase do servidor (ou, no caso local, a mesma com os dados da faixa) + "Se for a mesma nota, o estoque e as contas a pagar ficam em dobro." Botões: **Não lançar** (foco inicial) e **Lançar mesmo assim**. Sem modal dentro de modal: o diálogo só abre com nada mais aberto.
- **Depois de confirmar:** mesmo toast de sucesso de hoje; nota gravada com `repetida_de`. Opcional: etiqueta "confirmada como outra nota" na linha de "Notas lançadas".
- **Estados:** consulta lenta = nenhuma faixa e nada trava (a conferência abre; se a resposta chegar depois, a faixa aparece e rola até ela só se o admin ainda não tocou em nada). Consulta falhou = segue sem faixa; o servidor ainda confere no "Dar entrada".

## 2. Sugestão de insumo nos itens do XML (decisão 6)
- **Marcas:** as mesmas de hoje ("sugestão — confira", "novo — confira"). Sem marca nova. Acima da tabela, uma linha: "Os insumos marcados foram sugeridos por inteligência artificial. Confira antes de dar entrada." (só se a IA respondeu).
- **Consultando:** título do quadro 3 ganha "· sugerindo insumos…" (`aria-live="polite"`); nas linhas sem vínculo, o seletor mostra "Sugerindo…" com `Loader2` e fica desabilitado só nessa linha. Quantidade, preço, fator, pagamento, a faixa de nota repetida e "Cancelar" continuam usáveis.
- **"Dar entrada" enquanto consulta:** fica desabilitado com a linha "Aguarde a sugestão de insumos (alguns segundos)." Sem isso o admin lançaria linhas "não lançar" sem perceber. Se passar de 20 s, a tela larga a IA, segue por palavras e libera o botão.
- **A IA nunca sobrescreve** linha que o admin já mexeu (seletor, "Cadastrar novo" ou nome).
- **Sem chave de IA (503):** nada na tela; segue por palavras como hoje, sem texto de erro nem toast.
- **Outro erro:** linha discreta no quadro 3 (não vermelha): "Não consegui usar a inteligência artificial agora. As sugestões abaixo são por palavras parecidas."

## 3. Caixa de entrada "Notas da SEFAZ" (etapa 1, só leitura)
**Posição: abas no alto da Entrada de Notas**, não painel acima do arquivo. Motivo: no celular a ação principal da tela é enviar a nota; a caixa em cima a empurra uns 4 telas para baixo. Abas: **[Lançar nota]** (a tela de hoje, inalterada, é a padrão) e **[Notas da SEFAZ · 3]** (3 = falta lançar + parecem lançadas). A aba só existe com o servidor ligado (`ambiente` ≠ `desligado`). A faixa vermelha de cancelamento fica **acima das abas**, visível nas duas. Usar `ui/tabs` se existir; senão botões `role="tab"`, `aria-selected`, setas do teclado, 44 px. "Conferir" e "Lançar por arquivo ou foto" levam à aba "Lançar nota".
```
┌────────────────────────────────────┐
│ (!) A NF 77 de LATICÍNIOS K, que   │
│ você já lançou, foi cancelada pelo │
│ fornecedor. Estoque e contas não   │
│ foram alterados.        [Ver]      │
├────────────────────────────────────┤
│ [Lançar nota] [Notas da SEFAZ · 3] │
│ Última busca hoje às 14h05:        │
│ 2 notas novas                      │
│ [   Buscar agora   ]               │
│ Próxima busca a partir das 15h10   │
│ ( A conferir (3) )  ( Todas )      │
│ ┌────────────────────────────────┐ │
│ │ ATACADÃO S.A.      R$ 1.234,56 │ │
│ │ NF 4411 · série 1 · 14/11      │ │
│ │ (!) Falta lançar               │ │
│ │ Só o resumo chegou. [Por quê?] │ │
│ │ [Lançar por arquivo ou foto]   │ │
│ │ [Ignorar]  [Copiar chave]      │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘
```
**Computador (md+):** tabela com colunas Fornecedor (nome e CNPJ pequeno), NF / série, Emissão, Valor, Situação (tag + explicação curta), Ações. Celular (< md): um cartão por nota, mesmos dados, sem rolagem lateral. O mesmo dado, duas apresentações (`md:hidden` / `hidden md:block`).

**Situações** (ordem do desenho; tag = ícone + texto):
| Situação | Tom/ícone | Texto da tag e da linha | Ações |
|---|---|---|---|
| Cancelada depois de lançada | bad, `CircleAlert` | "Cancelada pelo fornecedor depois de você lançar" | **Marcar como visto** (some a linha da faixa; 1 toque, toast com Desfazer) |
| Ignorada | muted, `EyeOff` | "Ignorada" + "Motivo: Não é compra · por Diego, 15/11" | **Voltar para a lista** |
| Cancelada (não lançada) | muted, `Ban` | "Cancelada pelo fornecedor. Não precisa lançar." | nenhuma (só em "Todas") |
| Recusada (denegada) | bad, `Ban` | "Recusada pela SEFAZ (denegada). Esta nota não vale." | nenhuma (só em "Todas") |
| Já lançada | ok, `CheckCircle2` | "Já lançada por XML em 03/11" | nenhuma |
| Parece já lançada | warn, `Copy` | "Parece a NF 880 que você lançou por foto em 15/11" | **É a mesma nota** (ignora com o motivo "Já lancei de outro jeito", 1 toque, Desfazer); **Lançar mesmo assim** (Conferir se houver nota completa, senão vai à aba Lançar nota) |
| Falta lançar | warn, `CircleAlert` | "Falta lançar"; etiqueta extra "Pode não ser compra" quando `nao_parece_compra` | **Conferir** (primário, só se `pode_conferir`); senão **Lançar por arquivo ou foto**; secundários **Ignorar…** e **Copiar chave** (copia os 44 caracteres; toast "Chave copiada.") |
| Só o resumo chegou | etiqueta sob "Falta lançar"/"Parece lançada", sem `pode_conferir` | "Só o resumo chegou." + [Por quê?] | sem "Conferir" |
- **"Por quê?"** (um só, no alto da lista, `<details>`, não repetido em cada cartão): "A SEFAZ entrega só o resumo da nota (fornecedor, valor e data) até a empresa confirmar que a recebeu, e este sistema ainda não faz essa confirmação. Por isso, para dar entrada, envie o XML, o PDF ou a foto. Se o seu contador ou o portal da SEFAZ já confirmou o recebimento, a nota completa pode aparecer aqui."
- **Ignorar…** abre `AlertDialog` (único): "Ignorar esta nota?" + "Ela sai da lista 'A conferir'. Nada é enviado à SEFAZ e nada é lançado." Motivo (radio, obrigatório, 44 px): "Já lancei de outro jeito" · "Não é compra" · "Não reconheço esta nota" · "Outro motivo" (abre campo "Escreva o motivo", obrigatório). Sob "Não reconheço": "Se você não conhece este fornecedor, fale com o seu contador. Aqui a nota só fica escondida." Botões: **Ignorar nota** (desabilitado até escolher; sem escolha mostra "Escolha o motivo.") e **Cancelar**. Sucesso: toast "Nota ignorada." + **Desfazer** (8 s). Erro: caixa vermelha no diálogo com a frase do servidor e "Tentar de novo".
- **Faixa de cancelamento:** uma nota: "A NF 77 de LATICÍNIOS K, que você já lançou, foi cancelada pelo fornecedor. Estoque e contas a pagar não foram alterados: ajuste à mão, se for preciso." Várias: "N notas que você já lançou foram canceladas pelo fornecedor. Estoque e contas a pagar não foram alterados: ajuste à mão, se for preciso." [Ver] abre a aba, filtro "A conferir", foco na primeira. Só avisa (decisão 7); some quando todas forem marcadas como vistas.
- **Cabeçalho:** "Última busca hoje às 14h05: 2 notas novas" (ou "nada novo"; "ontem às 09h30"; nunca buscou: "Ainda não buscou."). **Buscar agora** (outline, 44 px): normal; **buscando** = "Buscando na SEFAZ…" com `Loader2`, desabilitado, `aria-live="polite"`, relê a cada 3 s, ao fim toast "Busca feita: 2 notas novas." ou "Busca feita: nada novo."; **espera** = desabilitado (`aria-disabled`) com a linha fixa "Próxima busca a partir das 15h10. A SEFAZ não deixa buscar antes." (a hora vem de `proxima_consulta_em`/`bloqueado_ate`; o 409 `SEFAZ_AGUARDE` é só rede de segurança, mostrado em caixa âmbar, não em toast). A busca também roda sozinha.
- **Avisos fixos acima da lista** (caixas âmbar, `role="status"`): D1 / `aviso` do servidor; lacuna "Uma resposta da SEFAZ se perdeu e até N notas podem não ter chegado. Essas entram pelo arquivo ou pela foto."; modo de teste "MODO DE TESTE da SEFAZ: estas notas são de mentira e não entram no estoque." (sem "Conferir"). Erros de busca: seção 4.
- **Carregando:** 3 cartões `Skeleton`. **Erro:** "Não consegui ver as notas da SEFAZ agora. Toque em Tentar de novo." [Tentar de novo].
- **Vazio, busca ligada:** título "Nenhuma nota chegou ainda". "A SEFAZ passa a separar as notas deste CNPJ a partir da primeira busca; as emitidas antes não aparecem aqui. A busca roda sozinha, de hora em hora. Enquanto isso, lance notas pela aba Lançar nota." [Buscar agora]. **Vazio em "A conferir" com notas em "Todas":** `CheckCircle2` "Tudo certo. Nenhuma nota para conferir." + link "Ver todas".
- **Busca desligada** (interruptor): caixa neutra no alto da aba: "A busca de notas na SEFAZ está desligada. As notas já recebidas continuam na lista." [Ligar em Configurações] (link). Sem "Buscar agora". Se estiver parada por erro: a caixa de erro da seção 4 no lugar.

## 4. Painel de ativação (Configurações, abaixo do painel do certificado)
`<Panel title="Notas da SEFAZ">`, só admin e só com o servidor ligado; mesmo padrão do `CertificadoPanel` (tag de situação, caixas de aviso/erro dentro do painel, histórico em `<details>`). Âncora `#notas-sefaz`.
Abertura: "Traz para a Entrada de Notas as notas emitidas para a sua empresa, para você ver o que falta lançar e saber se um fornecedor cancelou uma nota. Só consulta: não envia nada à SEFAZ. Hoje chega o resumo da nota (fornecedor, valor e data); o arquivo completo só chega em alguns casos."
- **Controle:** botão com verbo, não interruptor (a ação pede confirmação, e interruptor que não muda sozinho confunde): **Ligar a busca** (primário) / **Desligar a busca** (outline). Tag: "Ligada" (ok), "Desligada" (muted), "Parada" (bad), "Pausada" (warn, certificado com problema).
- **Ligar** abre `AlertDialog` "Ligar a busca de notas?": "A busca usa o certificado digital da empresa. **Se o seu contador também baixa as notas pela SEFAZ, avise antes de ligar**: com dois sistemas buscando, a SEFAZ bloqueia os dois por 1 hora. Notas emitidas antes da primeira busca não aparecem." Botões **Ligar a busca** e **Agora não** (foco inicial). Sucesso: toast "Busca ligada. A primeira busca sai em até 5 minutos." quando a próxima busca permitida (o maior entre `proxima_consulta_em` e `bloqueado_ate`, devolvidos pelo `PUT`) está a 5 min ou menos; senão "Busca ligada. A próxima busca sai às 15h10." (hora de Brasília; se for outro dia, "… sai em 18/11 às 09h30."), porque religar não antecipa a agenda nem o bloqueio da SEFAZ. Nenhuma caixa de "já falei com o contador" (o dono disse que não sabe; não bloquear).
- **Desligar:** sem diálogo, toast "Busca desligada." + **Desfazer**. Linha fixa no estado desligado: "Com a busca desligada por mais de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam."
- **Dados (ligada):** "Última busca hoje às 14h05: nada novo" · "Próxima a partir das 15h10" · "N notas para conferir" [Ver as notas] · "Ligada por Diego em 16/11/2026 às 14h32". Modo de teste: "Modo de teste da SEFAZ: as notas são de mentira." (em produção, nada).
- **Sem certificado:** botão desabilitado + "Envie o certificado digital da empresa no quadro acima para ligar a busca." [Ir para o certificado]. **Vencido:** "O certificado digital venceu em 10/03/2026. Envie o renovado para a busca voltar." **Ilegível / outro CNPJ:** a frase do certificado (`MSG_USO`/`msgOutroCnpj`). **Sem CNPJ:** "Preencha o CNPJ da empresa no quadro Empresa e toque em Salvar no alto da página." **CNPJ ou modo mudou:** "O CNPJ da empresa mudou desde a última vez. Ligue a busca de novo." **Servidor desligado:** "A busca de notas na SEFAZ não está ativada neste servidor. Fale com o suporte do Freela Comanda se quiser usá-la." (sem botões).
- **Erros** (caixa vermelha = parou e desligou; âmbar = espera; todos com ícone, texto e `role="alert"`, também resumidos na aba Notas da SEFAZ com link; após corrigir, o botão passa a **Ligar a busca de novo**):
| Situação | Tom | Texto final |
|---|---|---|
| 137 / sem novidades | neutro | "Última busca 14h05: nada novo · próxima a partir das 15h10" |
| 108, 109, 5xx | âmbar | "A SEFAZ está fora do ar. Nova tentativa às 15h10." |
| Falha antes de enviar | âmbar | "Não consegui falar com a SEFAZ. Nova tentativa às 14h35." |
| 656 simples | âmbar | "A SEFAZ pediu para esperar. Próxima busca às 15h10." |
| Resposta perdida | âmbar | "Uma resposta da SEFAZ se perdeu e até N notas podem não ter chegado. Essas entram pelo arquivo ou pela foto." |
| 656 duas vezes em 24 h | vermelha | "A SEFAZ bloqueou a busca duas vezes em 24 horas. Por segurança, a busca foi desligada. Fale com o seu contador e com o suporte do Freela Comanda antes de ligar de novo." |
| Outro sistema (D2) | vermelha | "Outro sistema também está buscando as notas deste CNPJ na SEFAZ (provavelmente o do contador). Com dois sistemas, a SEFAZ bloqueia os dois por 1 hora. A busca foi desligada: fale com o contador antes de ligar de novo." |
| 280–286, 473, 403 | vermelha | "A SEFAZ recusou o certificado digital (código N). Confira o certificado digital em Configurações e ligue a busca de novo." |
| 593 | vermelha | "A SEFAZ diz que o CNPJ consultado não é da mesma empresa do certificado (código 593). Confira o CNPJ no quadro Empresa." |
| CNPJ-base ≠ certificado | vermelha | "O certificado digital é de outra empresa, e a SEFAZ recusaria a busca. Confira o CNPJ da empresa ou envie o certificado certo." |
| 3 respostas ilegíveis | vermelha | "A busca parou: a SEFAZ respondeu 3 vezes de um jeito que o sistema não entende. Fale com o suporte do Freela Comanda." |
| Outros códigos | vermelha | "A busca parou por um problema que o sistema não resolve sozinho (código N). Fale com o suporte do Freela Comanda e informe este código." |
| Sem CNPJ na empresa | vermelha | "Preencha o CNPJ da empresa no quadro Empresa e toque em Salvar no alto da página." |
| Desligada há mais de 50 dias | âmbar | "A busca está desligada há N dias. Passando de 60 dias, a SEFAZ para de guardar as notas deste CNPJ para você, e as desse período não voltam. Ligue a busca de novo." |
| Primeira busca feita | neutro | "Primeira busca feita. A SEFAZ passa a separar as notas deste CNPJ a partir de agora; as emitidas antes não aparecem aqui." |
| Indício de outro sistema (D1) | âmbar | "A SEFAZ já tinha notas separadas para este CNPJ, então algum sistema (talvez o do seu contador) usou a busca nos últimos 60 dias. Se ele ainda busca, a SEFAZ vai bloquear os dois, e a busca daqui se desliga sozinha." |
| Certificado sem uso de cliente | âmbar | "A SEFAZ pode recusar este certificado (código 280). Se a busca falhar, peça ao contador um certificado A1 de empresa novo." |
- **Carregando:** 3 `Skeleton`. **Erro ao ler:** "Não consegui ver a situação da busca agora. Toque em Tentar de novo."

## 5. Linguagem
| Usar | Evitar |
|---|---|
| "notas emitidas para a sua empresa", "Notas da SEFAZ" | DF-e, distribuição, Ambiente Nacional, destinatário |
| "só o resumo chegou", "nota completa (XML)" | resNFe, procNFe, docZip, schema |
| "nota cancelada pelo fornecedor", "recusada pela SEFAZ (denegada)" | evento, 110111, situação SEFAZ |
| "a SEFAZ pediu para esperar", "outro sistema também está buscando" | 656, NSU, ultNSU, maxNSU, lacuna, bloqueio de consumo indevido |
| "modo de teste da SEFAZ" | homologação, tpAmb, ambiente |
| "marcar como visto", "ignorar", "voltar para a lista" | ciente, ciência da operação, desconhecimento, manifestação |
| "fornecedor", "chave de acesso" (44 caracteres), "possível repetição" | emitente, chNFe, `repetida_de` |
| "a busca parou", "ligar a busca" | parada_656, parada_conflito, job, cron, polling |
Tratamento "você"; verbos no imperativo; códigos da SEFAZ só entre parênteses no fim de erros que o suporte precise ("código 593"), nunca como título.

## 6. Trocas de texto sugeridas
| Desenho atual | Sugerida | Por quê |
|---|---|---|
| Faixa âmbar + caixa "É outra nota: lançar mesmo assim" + confirmação no "Dar entrada" | Faixa com 2 botões (**Não lançar esta nota** / **É outra nota, lançar mesmo assim**); diálogo no "Dar entrada" só se não confirmou | Caixa + confirmação são dois passos para a mesma decisão, e a caixa não diz o que acontece se não marcar |
| "Caixa de entrada acima do campo de arquivo" | Aba "Notas da SEFAZ" ao lado de "Lançar nota" | Não empurra a ação principal para baixo no celular |
| "Notas da SEFAZ · última busca 14:05 (2 novas) · próxima a partir de 15:10" | "Última busca hoje às 14h05: 2 notas novas" / "Próxima busca a partir das 15h10" | Formato de hora do usuário; frase completa |
| "⚠ 1 nota lançada foi CANCELADA pelo fornecedor na SEFAZ. Confira o estoque e as contas." | Com número e fornecedor, e "Estoque e contas a pagar não foram alterados: ajuste à mão, se for preciso." | O admin precisa saber qual nota e que nada foi desfeito sozinho |
| "Parece já lançada (NF 880 por FOTO em 15/11)" | "Parece a NF 880 que você lançou por foto em 15/11" | Linguagem de conversa, sem caixa alta |
| "Falta lançar · entrada (não parece compra)" | "Falta lançar" + etiqueta "Pode não ser compra" | "Entrada" confunde com "Dar entrada" |
| `[Ciente]` | **Marcar como visto** | "Ciente" parece a "ciência da operação" da SEFAZ; aqui nada é enviado |
| `[Copiar chave]` como ação principal sem "Conferir" | **Lançar por arquivo ou foto** primário; "Copiar chave" secundário | Na etapa 1 o "Conferir" quase nunca acende: a ação real tem de estar na tela |
| "HOMOLOGAÇÃO — notas de teste, não entram no estoque" | "MODO DE TESTE da SEFAZ: estas notas são de mentira e não entram no estoque." | Jargão |
| Painel: "interruptor" | Botão **Ligar a busca** / **Desligar a busca** | Interruptor que abre confirmação confunde; botão tem verbo |
| "(CNPJ-base diferente)", "erro de configuração", "algo que o sistema não entende", "avise o suporte" | Frases da tabela da seção 4 | Jargão e "suporte" de quem; diz o próximo passo |
| "Uma resposta da SEFAZ se perdeu: N documentos não foram baixados" | "…até N notas podem não ter chegado" | "Documentos" inclui eventos; não prometer número exato |
| "Sugestão por IA indisponível agora: <frase do erro>" | Frase fixa da seção 2 | A frase do erro pode ser técnica |
| "Desligada há N dias. Com 60 dias sem buscar…" | Seção 4 | Menos telegráfico; diz o que fazer |
| "Ignorar" com os 5 motivos internos | 4 motivos na tela; `cancelamento_conferido` só pelo "Marcar como visto" | O 5º não é escolha do usuário |

## 7. O que conferir no navegador (390 e 360 px, e desktop)
1. Loja: nenhuma aba, painel nem faixa. Admin com o servidor desligado: nenhuma aba; painel só com a frase "não está ativada neste servidor".
2. 360 px: Entrada de Notas, faixa de repetida, abas, cartões, diálogos e painel de Configurações sem rolagem lateral; alvos ≥ 44 px; texto ≥ 14 px; desktop vira tabela.
3. Faixa de repetida: foco nela e leitura pelo leitor de tela; os dois botões; "Não lançar" volta ao campo de arquivo; confirmar muda o texto; mudar o número derruba a confirmação; "Dar entrada" não confirmado abre o diálogo com foco em "Não lançar"; Esc cancela.
4. XML com IA: "Sugerindo…" só nas linhas sem vínculo; edição manual não é sobrescrita; "Dar entrada" bloqueado com a linha de espera; sem chave de IA nenhum aviso.
5. Cada situação da tabela da seção 3 com ícone + texto + tom; "Cancelada depois de lançada" não some com Ignorar; "Marcar como visto" e "Ignorar" mostram Desfazer; "Voltar para a lista" em "Todas".
6. "Buscar agora": normal, buscando (desabilitado, anunciado), espera com a hora, busca desligada (sem botão). Vazio, carregando e erro da lista.
7. Painel: sem certificado, vencido, sem CNPJ, parada por erro (cada texto da seção 4 anunciado como alerta), diálogo de ligar com a frase do contador e foco em "Agora não".
8. Aba por teclado (setas, Enter); zoom 200%; nenhum dado da nota nem chave em `localStorage`/`sessionStorage`.

## 8. Respostas à SEFAZ (etapa 2, entrega 3; desligadas até o OK do contador)
Complementa a Etapa 2 do desenho (17/11). Na tela nunca aparecem "ciência", "manifestação", "desconhecimento" nem códigos de evento (§5). Tudo desta seção só existe com o servidor em `SEFAZ_MANIFESTACAO=ligada` (`respostas.disponivel`); sem ela, a tela é a da entrega 2, com uma diferença: o painel mostra a linha "não estão ativadas neste servidor", e a abertura do §4 e o "Por quê?" usam a coluna "Desligadas" abaixo (as frases antigas ficam falsas de qualquer jeito, porque o sistema agora sabe responder). **Exceção (revisão final, I3):** o que já está gravado no banco continua à vista sem a variável, só para ler — a faixa do prazo, a linha "N notas precisam de resposta até …" no painel e as linhas de prazo e de resposta de cada nota que tem resposta gravada (a obrigação dos 90 dias de uma ciência registrada não some com a variável vazia). Nenhuma ação aparece assim: nem "Não reconheço…", nem "Tentar de novo", nem a linha neutra "Responder à SEFAZ até …".

**Frases da entrega 2 que mudam** (com as respostas ligadas; desligadas, valem as novas da coluna do meio):
| Onde | Desligadas | Ligadas |
|---|---|---|
| §4 abertura, "Só consulta: não envia nada à SEFAZ. Hoje chega o resumo… só chega em alguns casos." | "A busca só consulta. O que o sistema envia à SEFAZ fica no quadro Respostas à SEFAZ, logo abaixo, e vem desligado." | "A busca só consulta. Com as respostas ligadas, a nota completa costuma chegar algumas horas depois do resumo." |
| §3 "Por quê?" ("…e este sistema ainda não faz essa confirmação…") | "A SEFAZ entrega só o resumo da nota (fornecedor, valor e data) até a empresa avisar que a recebeu, e as respostas à SEFAZ estão desligadas. Por isso, para dar entrada, envie o XML, o PDF ou a foto. Se o seu contador ou o portal da SEFAZ já avisou, a nota completa pode aparecer aqui." | "O sistema já avisou a SEFAZ que a nota chegou. A nota completa costuma aparecer aqui algumas horas depois (a SEFAZ não fixa o prazo). Se tiver pressa, lance pelo XML, pelo PDF ou pela foto." |
| §3 Ignorar: "Nada é enviado à SEFAZ e nada é lançado." | igual | "Ela sai da lista 'A conferir'. Nada é lançado." + a linha do motivo (abaixo) |
| §3 Ignorar, sob "Não reconheço": "Aqui a nota só fica escondida." | igual | texto do motivo (abaixo) |
| §5 "Evitar: ciente, ciência da operação, desconhecimento, manifestação" | igual | igual; usar "avisar a SEFAZ que a nota chegou", "confirmar a compra na SEFAZ", "não reconheço", "a compra não aconteceu", "resposta final", "prazo para responder à SEFAZ" |

**Painel (Configurações, no mesmo `Panel` "Notas da SEFAZ", abaixo da busca; subtítulo "Respostas à SEFAZ"; âncora `#respostas-sefaz`):**
- Abertura: "Com as respostas ligadas, o Freela Comanda avisa a SEFAZ, em nome da empresa e com o certificado digital: que recebeu cada nota nova (assim a nota completa chega aqui para conferir); que a compra aconteceu, quando a nota é lançada; e que a empresa não reconhece uma nota, quando você tocar em Não reconheço." Linha fixa, sempre visível, em negrito: "**Ligue só depois de o seu contador concordar.**"
- Botão com verbo (§6): **Ligar as respostas** (primário) / **Desligar as respostas** (outline). Tag: "Ligadas" (ok), "Desligadas" (muted), "Paradas" (bad), "Esperando a SEFAZ" (warn, `pausa_ate` no futuro).
- **Ligar** abre `AlertDialog` "Ligar as respostas à SEFAZ?": "O sistema vai avisar a SEFAZ, em nome da empresa, que recebeu cada nota nova de compra. Depois desse aviso, cada nota precisa de uma resposta final em até 90 dias da data dela: lançar a nota já responde que a compra aconteceu; para as outras, o sistema avisa antes do prazo. **Ligue só depois de o seu contador concordar.**" Botões **Ligar as respostas** e **Agora não** (foco inicial). Sucesso: toast "Respostas ligadas. As primeiras saem em até 5 minutos."
- **Desligar:** sem diálogo; toast "Respostas desligadas." + **Desfazer** (8 s). Linha fixa desligada: "Com as respostas desligadas, nada é enviado à SEFAZ. O que estava na fila espera até você ligar de novo."
- **Dados (ligadas):** "Ligadas por Diego em 17/11/2026 às 10h05" · "3 respostas na fila" (some com 0) · "2 notas precisam de resposta até 15/02/2027" [Ver as notas] (só com `prazo_perto` > 0) · "1 resposta não foi enviada" [Ver] (só com `falharam` > 0). A linha do prazo [Ver as notas] aparece também com as respostas desligadas (abaixo da linha fixa) e sem a variável (abaixo da frase "não estão ativadas"). Numa parada, "Ligadas por…" some (nada sai até ligar de novo); a fila, o prazo e as falhas ficam.
- **Servidor sem a variável:** "As respostas à SEFAZ não estão ativadas neste servidor. Fale com o suporte do Freela Comanda se quiser usá-las." (sem botões). Sem certificado, sem CNPJ, vencido, outro CNPJ: as mesmas frases e o mesmo botão desabilitado do §4.
- **Paradas e esperas** (vermelha = parou, com **Ligar as respostas de novo**; âmbar = espera; `role="alert"`). A parada não desliga no servidor (o quadro chega `ligadas: true` com a `situacao` parada): o botão é sempre **Ligar as respostas de novo**, nunca "Desligar", e fica desabilitado sem certificado ou sem CNPJ, como o "Ligar":
| Situação | Tom | Texto |
|---|---|---|
| 108, 109, 5xx | âmbar | "A SEFAZ está fora do ar. As respostas saem de novo às 15h10." |
| Falha antes de enviar | âmbar | "Não consegui falar com a SEFAZ. Nova tentativa às 14h20." |
| 656 | âmbar | "A SEFAZ pediu para esperar. As respostas saem de novo às 15h10." |
| Relógio (577–579 num lote) | âmbar | "O relógio do servidor está diferente do da SEFAZ. As respostas esperam até 15h05; se repetir, fale com o suporte do Freela Comanda." |
| Relógio de novo (2º lote seguido), ou diferença > 2 min na última busca, conferida antes de enviar (nada saiu) | vermelha | "As respostas pararam: o relógio do servidor está fora da hora certa. Fale com o suporte do Freela Comanda." |
| 656 duas vezes em 24 h | vermelha | "A SEFAZ bloqueou as respostas duas vezes em 24 horas. Por segurança, elas foram desligadas. Fale com o suporte do Freela Comanda antes de ligar de novo." |
| 280–286, 290–296, 213, 403 | vermelha | "A SEFAZ recusou o certificado digital (código N). Confira o certificado digital em Configurações e ligue as respostas de novo." |
| 3 remessas sem resposta legível | vermelha | "As respostas pararam: a SEFAZ respondeu 3 vezes de um jeito que o sistema não entende. Fale com o suporte do Freela Comanda." |
| Defeito nosso ou código desconhecido (lote) | vermelha | "As respostas pararam por um problema que o sistema não resolve sozinho (código N). Fale com o suporte do Freela Comanda e informe este código." |
| Nenhuma resposta da vez pôde ser assinada por causa do certificado (a chave não é RSA, ou a assinatura falhou), ou, conferido antes de enviar, o certificado não está cadastrado, venceu, está ilegível ou é de outra empresa; nada saiu | vermelha | "As respostas pararam: não foi possível assinar as respostas com o certificado digital. Confira o certificado digital em Configurações e ligue as respostas de novo." |
| Nenhuma resposta da vez pôde ser montada ou assinada por causa do próprio dado; nada saiu | vermelha | "As respostas pararam: não foi possível montar as respostas à SEFAZ. Fale com o suporte do Freela Comanda." |

As duas últimas linhas (parada pela assinatura, decidida na Tarefa 6 da entrega 3) são do construtor: revisar com a UX. Na onda final, o relógio e o certificado conferidos antes de enviar passaram a parar com as mesmas frases (sem frase nova).

**Aba "Notas da SEFAZ":**
- **Faixa do prazo** (âmbar, `role="status"`, acima das abas, abaixo da de cancelamento; só com `prazo_perto` > 0, até sem a variável): uma nota: "A NF 4411 de ATACADÃO S.A. precisa de uma resposta à SEFAZ até 15/02/2027. Lance a nota, toque em Não reconheço ou escolha um motivo em Ignorar." Com as respostas desligadas (ou sem a variável), sem a ação, que não existe: "A NF 4411 de ATACADÃO S.A. precisa de uma resposta à SEFAZ até 15/02/2027." (decisão do construtor na onda final). Várias: "N notas precisam de uma resposta à SEFAZ. A primeira vence em 15/02/2027." [Ver] abre "A conferir" com foco na primeira.
- **Prazo no cartão:** em toda nota com `pode_responder` e as respostas ligadas, a linha neutra "Responder à SEFAZ até 15/02/2027" (desligadas, ela não aparece: é a ação de responder, que não existe; decisão do construtor na onda final). Só nas notas com o aviso de chegada registrado e sem resposta final (`prazo_perto`), do 80º dia em diante, âmbar com `CircleAlert`: "Faltam 6 dias para responder à SEFAZ (até 15/02/2027)."; no último dia "Último dia para responder à SEFAZ.". Passado o prazo, nessas mesmas notas: muted "Passou o prazo: a SEFAZ considera esta compra confirmada." (sem ações de resposta).
- **Linha da resposta** (discreta, sob a situação; ícone + texto, `aria-live="polite"` quando muda):
| Estado | Texto |
|---|---|
| aviso de chegada na fila / enviando | "Avisando a SEFAZ que a nota chegou…" |
| aviso de chegada registrado | "A SEFAZ já sabe que a nota chegou (17/11)." |
| final na fila (`Loader2`) | "Resposta à SEFAZ na fila: sai em alguns minutos." |
| confirmação registrada | "Compra confirmada na SEFAZ em 17/11." |
| não reconheço registrado | "Você avisou a SEFAZ que não reconhece esta nota (17/11). Para mudar, fale com o seu contador: a SEFAZ aceita corrigir uma vez, em até 30 dias." |
| não aconteceu registrado | "Você avisou a SEFAZ que a compra não aconteceu (17/11). Para mudar, fale com o seu contador: a SEFAZ aceita corrigir uma vez, em até 30 dias." |
| recusada (cancelada/denegada) | "A SEFAZ não aceitou a resposta: a nota foi cancelada ou recusada." |
| recusada (fora do prazo) | "A SEFAZ não aceitou a resposta: passou o prazo." |
| recusada (já respondida por outro, 655) | "Esta nota já tinha resposta à SEFAZ, dada por outro sistema ou pelo portal." |
| recusada (não é desta empresa, 575) | "A SEFAZ não aceitou a resposta: a nota não é para o CNPJ da empresa." |
| recusada (chave inválida) | "A SEFAZ não aceitou a resposta: a chave de acesso não confere." |
| recusada (outro código) | "A SEFAZ não aceitou a resposta (código N). Fale com o seu contador." |
| falhou | "Não consegui enviar a resposta à SEFAZ depois de 3 tentativas." + **Tentar de novo** (outline, 44 px; sucesso: toast "Resposta de volta à fila."; com as respostas desligadas, "Resposta de volta à fila. Ela só sai quando as respostas forem ligadas.") |
- **Botão "Não reconheço…"** (secundário, `Ban`) em "Falta lançar" e "Parece já lançada" quando `pode_responder`: abre o diálogo Ignorar com "Não reconheço esta nota" já marcado. Ordem no celular: primária, **Ignorar…**, **Não reconheço…**, **Copiar chave**.
- **"É a mesma nota"** (1 toque) com as respostas ligadas e `pode_responder`: toast "Nota marcada como já lançada. A confirmação vai para a SEFAZ em alguns minutos." + **Desfazer** (8 s).
- **Diálogo Ignorar com as respostas ligadas** (motivos na ordem: "Já lancei de outro jeito" · "Não é compra" · "Não reconheço esta nota" · "A compra não aconteceu (devolvi ou cancelei)" · "Outro motivo"; o 4º só com `pode_responder`). Linha sob cada motivo, quando marcado:
  - Já lancei de outro jeito: "A SEFAZ é avisada de que a compra aconteceu, como quando você lança a nota."
  - Não é compra: `Checkbox` "Avisar a SEFAZ que a compra aconteceu" (desmarcado) + "Marque se a nota é verdadeira e só não vai para o estoque (por exemplo, um equipamento)."
  - Não reconheço: "A SEFAZ é avisada de que a empresa não reconhece esta nota. Use quando você não conhece o fornecedor ou não pediu nada a ele. Depois de enviado, não dá para desfazer aqui." Botão primário vira **Avisar a SEFAZ e ignorar**.
  - A compra não aconteceu: campo obrigatório "Conte o que houve" (`Textarea`, contador "15 a 255 letras", exemplo no rótulo de ajuda: "mercadoria devolvida na entrega, pedido cancelado") + "A SEFAZ é avisada de que a compra não aconteceu, com o seu texto. Depois de enviado, não dá para desfazer aqui." Botão **Avisar a SEFAZ e ignorar**. Erros em caixa no diálogo: "Conte o que houve com pelo menos 15 letras." · "Use no máximo 255 letras." · "Use só letras, números e pontuação comum (sem emoji)."
  - Outro motivo: "Nada é enviado à SEFAZ."
  - Sem `pode_responder` (nota de saída, cancelada, prazo passado, já respondida), o diálogo é o da entrega 2, mais a linha "Esta nota não aceita resposta à SEFAZ." quando o motivo seria um aviso.
  - Sucesso com aviso: toast "Nota ignorada. A resposta vai para a SEFAZ em alguns minutos." + **Desfazer** (8 s). Desfazer depois de a resposta sair (raro; o servidor espera 60 s): toast "A resposta já tinha ido para a SEFAZ e não dá para desfazer aqui. A nota voltou para a lista."
- **Dar entrada pela aba (Conferir)** com as respostas ligadas: o toast de sucesso de hoje ganha a 2ª linha "A confirmação da compra vai para a SEFAZ em alguns minutos."
- **Modo de teste** (homologação): as respostas vão para o ambiente de teste; o painel diz "Modo de teste da SEFAZ: as respostas valem só para notas de mentira."

**Conferir no navegador (360 px e desktop), além do §7:** painel com as respostas desligadas, ligadas, esperando e paradas; diálogo de ligar com foco em "Agora não"; faixa do prazo e as três linhas de prazo no cartão; cada linha da resposta; "Não reconheço…" abrindo o diálogo já marcado; "A compra não aconteceu" com os três erros do campo; Desfazer; "Tentar de novo"; com a variável desligada e nada gravado, nenhum elemento desta seção (com respostas gravadas, só a leitura da exceção acima).
