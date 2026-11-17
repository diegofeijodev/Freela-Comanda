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
- **Ligar** abre `AlertDialog` "Ligar a busca de notas?": "A busca usa o certificado digital da empresa. **Se o seu contador também baixa as notas pela SEFAZ, avise antes de ligar**: com dois sistemas buscando, a SEFAZ bloqueia os dois por 1 hora. Notas emitidas antes da primeira busca não aparecem." Botões **Ligar a busca** e **Agora não** (foco inicial). Sucesso: toast "Busca ligada. A primeira busca sai em instantes." Nenhuma caixa de "já falei com o contador" (o dono disse que não sabe; não bloquear).
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
