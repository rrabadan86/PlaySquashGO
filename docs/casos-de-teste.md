# Casos de teste planejados

Catálogo dos casos de teste de cada regra (formato Dado / Quando / Então). Ao escrever o teste, o título começa pelo código da regra (TST-02); a matriz (`docs/rastreabilidade.md`) conta os casos planejados aqui contra os testes escritos.

Tipos: **Unitário** (regra pura, sem banco), **Integração** (banco de teste e simuladores de WhatsApp, IA e Google), **Tela** (navegador, computador 1366 px e celular 390 px).

| Caso | Regra | Tipo | Cenário |
|---|---|---|---|
| CT-001 | SOF-01 | Integração | Dado um telefone de aluno ativo, quando ele manda mensagem, então recebe a mensagem fixa e nenhuma chamada à IA é feita. |
| CT-002 | SOF-01 | Integração | Dado o telefone do responsável de um aluno kids ativo, quando ele manda mensagem, então recebe a mensagem fixa. |
| CT-003 | SOF-01 | Integração | Dado um telefone desconhecido, quando ele manda mensagem, então o contato é criado como lead e a Sofia responde. |
| CT-004 | SOF-02 | Integração | Dada uma conversa nova (IA simulada), quando a qualificação termina, então nome, já jogou, data de nascimento, tipo e preferência ficam gravados no lead. |
| CT-005 | SOF-03 | Integração | Dado um lead que já jogou, quando pede horário, então a resposta contém o valor da experimental e a chave Pix antes das opções. |
| CT-006 | SOF-03 | Integração | Dado um lead que nunca jogou, quando pede horário, então a experimental é marcada como gratuita. |
| CT-007 | SOF-04 | Unitário | Dada uma grade com 5 horários livres e preferência 'fim de tarde', quando calcula as opções, então retorna no máximo 3, ordenadas pela proximidade da preferência. |
| CT-008 | SOF-04 | Unitário | Dado um horário dentro da antecedência mínima (3 h), quando calcula as opções, então ele não é oferecido. |
| CT-009 | SOF-05 | Integração | Dados dois leads escolhendo a mesma vaga ao mesmo tempo, quando as duas reservas são gravadas, então só uma é aceita e a outra recebe novas opções. |
| CT-010 | SOF-05 | Integração | Dada uma reserva aceita, quando o Google está fora do ar, então a aula fica gravada e o evento entra na fila de nova tentativa. |
| CT-011 | SOF-06 | Unitário | Dado um participante (nome + data de nascimento) que já fez experimental, quando pede outra, então é recusado, salvo exceção liberada pelo admin. |
| CT-012 | SOF-06 | Unitário | Dado um responsável com dois filhos, quando marca uma experimental para cada, então as duas são aceitas. |
| CT-013 | SOF-07 | Integração | Dada uma experimental em dupla, quando é marcada, então os dois participantes ficam com a experimental consumida e a vaga de dupla ocupada. |
| CT-014 | SOF-08 | Integração | Dada uma experimental marcada, quando o lead pede outro horário, então a vaga antiga é liberada e o evento antigo sai do Google. |
| CT-015 | SOF-09 | Integração | Dado um pedido para falar com humano, quando a Sofia classifica, então a IA é pausada no contato e o admin é notificado. |
| CT-016 | SOF-09 | Tela | Dada uma conversa pausada, quando o admin clica em 'devolver à Sofia', então as próximas mensagens voltam a ser respondidas pela IA. |
| CT-017 | SOF-10 | Tela | Dado um anexo cadastrado, quando o lead pede a tabela de preços, então o arquivo é enviado. |
| CT-018 | SOF-11 | Integração | Dado um horário cheio pedido pelo lead, quando não há vaga, então o lead entra na lista de espera daquele horário. |
| CT-019 | SOF-12 | Integração | Dada uma conversa com 3 respostas da IA, quando termina o dia, então o custo do dia é a soma dos tokens registrados. |
| CT-020 | CNF-01 | Unitário | Dada uma experimental amanhã às 18h, quando o agendador roda, então o pedido sai hoje às 19h, o reenvio às 15h e o cancelamento às 16h30. |
| CT-021 | CNF-01 | Integração | Dada uma experimental sem resposta, quando chegam 90 min antes, então ela é cancelada, a vaga liberada e o lead avisado. |
| CT-022 | CNF-01 | Unitário | Dada a regra de cancelamento desligada, quando chegam 90 min antes, então nada é cancelado. |
| CT-023 | CNF-02 | Integração | Dadas as respostas 'sim', 'tô indo', '👍', 'não vou conseguir' e 'qual o endereço?', quando classificadas, então resultam em confirmou, confirmou, confirmou, não vai e dúvida. |
| CT-024 | CNF-03 | Integração | Dada uma confirmação, quando gravada, então o status muda e o título do evento no Google ganha ✓. |
| CT-025 | CNF-04 | Unitário | Dada uma experimental marcada às 21h da véspera, quando é criada, então nasce confirmada e sem cancelamento automático. |
| CT-026 | CNF-05 | Integração | Dados os três desfechos, quando cada um acontece, então o professor da aula recebe a mensagem correspondente. |
| CT-027 | CNF-06 | Integração | Dada uma experimental com 'compareceu', quando passa o dia sem matrícula, então a Sofia envia o contato no mesmo dia e outro 2 dias depois. |
| CT-028 | CNF-06 | Tela | Dado um lead sem matrícula, quando o admin escolhe o motivo de perda, então ele aparece no funil. |
| CT-029 | LES-01 | Tela | Dado um aluno com crédito, quando o horário está lotado, então o botão 'Lista de espera' o inclui na lista. |
| CT-030 | LES-02 | Integração | Dados 3 interessados na lista, quando a vaga é liberada, então os 3 são avisados; o primeiro a confirmar leva e os outros recebem 'vaga já preenchida'. |
| CT-031 | LES-02 | Unitário | Dada uma vaga liberada a 2 h da aula com antecedência mínima de 3 h, quando avaliada, então não é oferecida. |
| CT-032 | LES-03 | Unitário | Dado um lead em duas listas, quando marca uma experimental, então sai das duas. |
| CT-033 | LES-03 | Unitário | Dado um aluno na lista, quando o crédito vence, então sai da lista. |
| CT-034 | LES-04 | Integração | Dada uma vaga preenchida pela lista, quando confirmada, então professor e pessoa recebem as mensagens com os dados um do outro. |
| CT-035 | AGD-01 | Tela | Dado o admin, quando cadastra quadra, professor, tipo de aula e faixa da grade, então a faixa aparece na grade e na disponibilidade. |
| CT-036 | AGD-02 | Integração | Dado um professor sem perfil admin, quando tenta alterar a grade pela API, então recebe acesso negado. |
| CT-037 | AGD-03 | Integração | Dado um feriado nacional, quando a grade é montada, então o dia não tem horários livres. |
| CT-038 | AGD-03 | Integração | Dado um bloqueio sobre 4 aulas marcadas, quando é salvo, então os 4 alunos são avisados e as aulas seguem AGD-08. |
| CT-039 | AGD-04 | Unitário | Dada uma aula de 60 min com intervalo de 30 min, quando reservada às 17h30, então ocupa 17h30 e 18h na mesma quadra. |
| CT-040 | AGD-05 | Unitário | Dado um horário na grade com professor em outra quadra no mesmo horário, quando calculado, então não está livre. |
| CT-041 | AGD-05 | Unitário | Dado um horário de dupla com 1 aluno e capacidade 2, quando calculado para dupla, então tem vaga. |
| CT-042 | AGD-06 | Integração | Dado um contrato com ter e qui 18h, quando o gerador semanal roda, então existem aulas e eventos para as próximas 4 semanas, sem duplicar. |
| CT-043 | AGD-07 | Integração | Dada a troca do professor de uma faixa, quando salva, então os alunos fixos continuam e os eventos futuros mostram o novo professor. |
| CT-044 | AGD-08 | Integração | Dado um professor que desmarca com 5 h de antecedência, quando confirma, então o evento sai do Google, o aluno é avisado e ganha crédito. |
| CT-045 | AGD-08 | Unitário | Dado um professor que desmarca com 1 h de antecedência, quando confirma, então não há crédito (regra de antecedência). |
| CT-046 | AGD-09 | Integração | Dada uma aula criada, alterada e cancelada, quando sincronizada, então o evento no Google é criado, atualizado e apagado, com os IDs nas propriedades privadas. |
| CT-047 | AGD-09 | Integração | Dado um evento editado direto no Google, quando o sistema roda, então nada é lido de volta (sincronismo só de ida). |
| CT-048 | AGD-10 | Unitário | Dada uma aula sem marcação, quando o dia termina, então ela conta como presença. |
| CT-049 | AGD-10 | Integração | Dado um aluno com faltas em 2 semanas seguidas, quando marcada a segunda, então o professor é avisado. |
| CT-050 | AGD-11 | Integração | Dado o agendador às 6h, quando roda, então cada professor recebe o resumo só com as aulas dele. |
| CT-051 | PER-01 | Tela | Dado um usuário admin e professor, quando entra, então vê o painel completo e as próprias aulas. |
| CT-052 | PER-02 | Tela | Dado um professor, quando abre a ficha de um aluno, então vê 'em dia' ou 'pendente' e nenhum valor em R$. |
| CT-053 | PER-03 | Integração | Dado um professor, quando chama a API de caixa diretamente, então recebe acesso negado. |
| CT-054 | APP-01 | Integração | Dado um código enviado, quando usado duas vezes ou após expirar, então o login é recusado. |
| CT-055 | APP-01 | Tela | Dado o celular, quando abre o link, então o app pode ser instalado na tela inicial e o login por código funciona. |
| CT-056 | APP-02 | Tela | Dado um responsável com dois alunos, quando troca o aluno no seletor, então as aulas mostradas mudam. |
| CT-057 | APP-03 | Tela | Dado um aluno com aulas, créditos, contrato e histórico, quando navega pelas 4 abas, então cada uma mostra os dados certos. |
| CT-058 | APP-04 | Tela | Dado um contrato bloqueado, quando o aluno abre as aulas dele, então não há botões de ação e aparece o Pix. |
| CT-059 | REP-01 | Unitário | Dada uma aula às 18h, quando desmarcada às 15h (3 h), então gera crédito. |
| CT-060 | REP-02 | Unitário | Dada uma aula às 18h, quando desmarcada às 15h01, então não gera crédito e conta como dada. |
| CT-061 | REP-03 | Unitário | Dada a aula do dia 10 desmarcada no dia 1, quando calcula a validade, então o crédito vale até o dia 17. |
| CT-062 | REP-04 | Unitário | Dada uma reposição marcada, quando o aluno a desmarca com antecedência, então nenhum crédito novo é criado. |
| CT-063 | REP-05 | Unitário | Dado um crédito de aluno individual, quando lista horários, então só aparecem horários livres de aula individual dentro da validade. |
| CT-064 | REP-06 | Unitário | Dado o limite de 2 reposições no mês já usado, quando tenta a terceira, então é recusada. |
| CT-065 | REP-07 | Integração | Dada uma desmarcação ou reposição, quando gravada, então o professor da aula recebe aviso. |
| CT-066 | CON-01 | Tela | Dado o admin, quando cria um plano (tipo, aulas/semana, vigência, regras) e salva, então ele aparece na lista e no novo contrato. |
| CT-067 | CON-01 | Tela | Dado um plano, quando o admin clica em Duplicar, então abre um plano novo já preenchido. |
| CT-068 | CON-01a | Integração | Dado um plano com contratos, quando o valor de referência muda, então os contratos existentes não mudam. |
| CT-069 | CON-01a | Integração | Dado um plano com contratos, quando o admin tenta apagar, então só é possível desativar. |
| CT-070 | CON-02 | Tela | Dado o formulário de contrato completo, quando salva, então o contrato, o horário fixo e as parcelas são criados. |
| CT-071 | CON-02 | Unitário | Dado um parcelamento em 4x numa vigência de 3 meses, quando valida, então é recusado. |
| CT-072 | CON-03 | Unitário | Dado plano 2x R$ 550 iniciando em 19/11/2026, quando calcula o proporcional, então R$ 220,00 (dias) ou R$ 206,25 (aulas), conforme a regra definida. |
| CT-073 | CON-04 | Integração | Dado um aluno com contrato individual ativo, quando ganha um contrato de dupla, então os dois ficam ativos com horários e parcelas próprios. |
| CT-074 | CON-05 | Integração | Dada uma dupla, quando um aluno desmarca, então a aula do outro continua. |
| CT-075 | CON-06 | Integração | Dado um contrato kids, quando sai qualquer mensagem, então ela vai para o telefone do responsável. |
| CT-076 | CON-07 | Tela | Dado um contrato enviado, quando o aluno toca em 'Aceito', então data e hora do aceite ficam gravadas. |
| CT-077 | CON-08 | Tela | Dado um aluno com contrato vencendo, quando o admin cria um contrato novo, então aparece a pergunta de renovação e o horário vem preenchido. |
| CT-078 | CON-09 | Integração | Dado um contrato terminando em 10 dias, quando o agendador roda, então admin e aluno são avisados. |
| CT-079 | CON-09 | Integração | Dado um contrato terminado sem renovação, quando passa a data, então o horário fixo é liberado e o aluno fica inativo (se não tiver outro contrato). |
| CT-080 | CON-10 | Tela | Dado o admin, quando encerra um contrato com motivo, então o horário é liberado na hora e o histórico registra quem, quando e o motivo. |
| CT-081 | CON-11 | Unitário | Dado um saldo de 7 dias e mínimo de 7, quando o pedido é de 5 dias, então é recusado; de 7, aceito; de 8, recusado. |
| CT-082 | CON-11 | Integração | Dado um trancamento de 10 dias, quando aprovado, então as aulas do período saem do Google sem crédito e a vigência aumenta 10 dias. |
| CT-083 | CON-11 | Integração | Dado um trancamento encerrado antes, quando o admin confirma, então os dias não usados voltam ao saldo. |
| CT-084 | FIN-01 | Unitário | Dada uma parcela, quando passa por a vencer → aguardando conferência → paga, então cada mudança fica registrada e não há retorno indevido. |
| CT-085 | FIN-02 | Unitário | Dada a chave, nome, cidade, valor R$ 420,00 e identificador, quando gera o BR Code, então o código passa na validação do CRC e contém os campos certos. |
| CT-086 | FIN-03 | Tela | Dado um comprovante enviado, quando o admin dá baixa, então a parcela fica paga e o aluno sai da pendência. |
| CT-087 | FIN-04 | Unitário | Dada uma parcela vencida há 5 dias, quando a régua roda, então as aulas futuras daquele contrato são desmarcadas e as dos outros contratos não. |
| CT-088 | FIN-04 | Unitário | Dada a etapa D+2 desligada, quando a régua roda no D+2, então nada é enviado. |
| CT-089 | FIN-04 | Integração | Dada uma parcela vencida há 15 dias, quando a régua roda, então o horário fixo fica disponível para nova matrícula. |
| CT-090 | FIN-05 | Integração | Dado um aluno bloqueado no D+8, quando o admin dá baixa, então as aulas do horário fixo voltam sozinhas. |
| CT-091 | FIN-05 | Integração | Dado um aluno que paga no D+20 com o horário já ocupado, quando a baixa é dada, então ele recebe o link para escolher outro horário. |
| CT-092 | FIN-06 | Integração | Dadas 3 parcelas vencidas sem baixa, quando o agendador diário roda, então o admin recebe a lista. |
| CT-093 | FIN-07 | Tela | Dada uma venda de grip lançada, quando consulta o caixa do mês e a ficha do aluno, então a venda aparece nos dois. |
| CT-094 | FIN-08 | Unitário | Dada uma parcela de competência novembro paga em dezembro, quando gera os relatórios, então aparece em novembro por competência e em dezembro por recebimento. |
| CT-095 | IND-01 | Unitário | Dados 52 leads, 34 marcadas, 28 confirmadas, 25 compareceram e 12 matrículas, quando calcula o funil, então as taxas são 65%, 82%, 89% e 48%. |
| CT-096 | IND-02 | Unitário | Dada uma faixa com 10 horários e 7 ocupados, quando calcula, então a ocupação é 70%. |
| CT-097 | IND-03 | Unitário | Dadas parcelas previstas e baixadas no mês, quando calcula, então previsto, recebido, em atraso e ticket médio batem com a soma manual. |
| CT-098 | IND-04 | Unitário | Dado o mês com 5 matrículas e 2 encerramentos, quando calcula, então novos = 5 e saídas = 2, por professor e plano. |
| CT-099 | IND-05 | Unitário | Dados o custo da IA do mês e 12 matrículas, quando calcula, então o custo por matrícula é o custo ÷ 12. |
| CT-100 | IND-06 | Unitário | Dado um professor com 40 aulas dadas e R$ 30 por aula, quando fecha o mês, então o valor é R$ 1.200; com percentual, aplica sobre a receita definida. |
| CT-101 | OPR-01 | Integração | Dado o módulo de WhatsApp simulado, quando o sistema envia e recebe, então nenhuma outra parte do código depende da biblioteca de WhatsApp. |
| CT-102 | OPR-02 | Unitário | Dado o limite de 30 mensagens por hora, quando 40 são enfileiradas, então 30 saem na hora e 10 na hora seguinte, com intervalo aleatório. |
| CT-103 | OPR-02 | Unitário | Dado um contato que conversou nos últimos 30 min, quando sai uma campanha, então ele é pulado. |
| CT-104 | OPR-03 | Integração | Dado um contato que responde 'SAIR', quando a próxima campanha sai, então ele não recebe; avisos de aula e cobrança continuam. |
| CT-105 | OPR-04 | Integração | Dada a sessão do WhatsApp desconectada, quando detectada, então o admin é avisado (e-mail ou notificação no painel). |
| CT-106 | OPR-05 | Tela | Dado um contato, quando o admin anonimiza, então nome, telefone e e-mail somem e o histórico financeiro continua com o ID. |
| CT-107 | OPR-06 | Integração | Dado o backup diário, quando restaurado numa base limpa, então os dados batem com a produção do dia. |
| CT-108 | OPR-07 | Integração | Dada a mudança de uma regra de 3 h para 4 h, quando salva, então a auditoria guarda quem, quando, 3 h e 4 h. |
| CT-109 | OPR-08 | Unitário | Dada uma aula às 18h de Brasília, quando gravada e lida, então o horário não muda com o fuso do servidor. |
| CT-110 | OPR-09 | Integração | Dado um ex-aluno inativo há 30 dias, quando o agendador roda, então recebe o convite com os horários livres do momento. |
| CT-111 | AGD-12 | Integração | Dado um horário livre na grade, quando o admin marca uma aula avulsa pelo painel, então ela é gravada e o evento aparece na agenda da quadra certa no Google. |
| CT-112 | AGD-12 | Integração | Dada uma aula marcada, quando o admin cancela com motivo, então o evento sai do Google, o horário volta a ficar livre e o histórico guarda o motivo. |
| CT-113 | DEP-09 | Integração | Dado um banco vazio, quando a demonstração é gerada, então há professores, quadras, grade e aulas fictícias; quando rodada de novo, é recusada sem mexer no banco. |
| CT-114 | DEP-05 | Unidade | Dado um professor, quando abre Novidades, então não vê os itens só de administrador. |
| CT-115 | OPR-10 | Integração | Dado um item marcado como enviando há 10 min sem confirmação (o sistema caiu), quando o envio roda, então ele não é reenviado e aparece "a conferir" para o admin. |
| CT-116 | OPR-10 | Integração | Dado um item a conferir, quando o admin confirma ou pede reenvio na tela WhatsApp, então a mensagem é registrada ou volta para a fila, com histórico. |
| CT-117 | OPR-11 | Unidade | Dado um número com ou sem o 9, quando normalizado, então fica com o 9 e é procurado pelas duas formas. |
| CT-118 | SOF-06 | Integração | Dado um responsável, quando marca pela conversa uma experimental para cada filho, então as duas são aceitas e a remarcação pede qual aula trocar. |
| CT-119 | SOF-09 | Integração | Dada a IA fora do ar, quando o lead escreve, então nada é respondido e os administradores recebem um aviso por dia por conversa. |
| CT-120 | SOF-10 | Integração | Dado um arquivo que não é JPG, PNG nem PDF, quando o admin tenta cadastrar como anexo, então é recusado. |
| CT-121 | CNF-01 | Integração | Dado o pedido de confirmação desligado, quando chega a hora do cancelamento, então a aula não é cancelada (só cancela quem foi perguntado). |
| CT-122 | CNF-06 | Integração | Dado um lead que faltou à experimental, quando chega o contato pós-aula, então recebe o convite para remarcar e não recebe o contato de +2 dias. |
| CT-123 | LES-02 | Integração | Dados dois leads avisados da mesma vaga, quando o primeiro marca, então o segundo recebe "vaga já preenchida" e continua na lista. |
| CT-124 | CON-02 | Integração | Dado um plano de 2 aulas por semana, quando o admin escolhe 1 horário ou dá desconto sem motivo, então o contrato é recusado com a explicação. |
| CT-125 | AGD-05 | Integração | Dado um horário fixo individual já contratado, quando outro aluno tenta o mesmo horário, então ele não aparece e o salvamento é recusado; na dupla, os dois contratos dividem a mesma aula. |
| CT-126 | AGD-07 | Integração | Dada uma faixa com aulas futuras, quando o admin troca o professor, então as aulas futuras daquela faixa passam para o novo professor e vão para o Google. |
| CT-127 | CON-10 | Integração | Dado um contrato encerrado, quando o admin abre um novo contrato para outro aluno, então o horário liberado aparece de novo. |
