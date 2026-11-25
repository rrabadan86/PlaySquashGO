# Matriz de rastreabilidade — regra → casos de teste → testes escritos

Gerada por `npm run matriz` (não edite à mão, exceto a seção "Achados"). O CI roda
`npm run matriz:conferir` e falha se esta matriz estiver velha ou se um teste citar código que não existe.

- Regras: `.claude/rules/*.md` (código `ÁREA-NN`). ⏳ = depende do kickoff.
- Casos planejados: `docs/casos-de-teste.md` (110 casos, formato Dado / Quando / Então).
- Testes escritos: títulos de teste que começam pelo código (TST-02).
- **✅** testes escritos ≥ casos planejados · **parcial** há teste, faltam casos · **❌** sem teste · **processo** regra de trabalho garantida por revisão e CI.

## Resumo

| Área | Regras | Casos planejados | Testes escritos | ✅ | parcial | ❌ | processo | ⏳ kickoff |
|---|---|---|---|---|---|---|---|---|
| Agenda, grade, Google Agenda e perfis | 15 | 21 | 37 | 12 | 0 | 3 | 0 | 3 |
| App do aluno e reposição | 11 | 12 | 8 | 4 | 0 | 7 | 0 | 2 |
| Planos e contratos | 12 | 18 | 0 | 0 | 0 | 12 | 0 | 5 |
| Dados e segredos | 10 | 0 | 3 | 3 | 0 | 0 | 7 | 0 |
| Publicar e atualizar | 9 | 2 | 7 | 3 | 0 | 0 | 6 | 0 |
| Cobrança e financeiro | 8 | 11 | 0 | 0 | 0 | 8 | 0 | 1 |
| Indicadores | 6 | 6 | 0 | 0 | 0 | 6 | 0 | 1 |
| WhatsApp, dados e operação | 11 | 13 | 22 | 10 | 0 | 1 | 0 | 0 |
| Sofia, confirmação da experimental e lista de espera | 22 | 34 | 9 | 2 | 4 | 16 | 0 | 1 |
| Testes | 8 | 0 | 8 | 3 | 0 | 0 | 5 | 0 |
| Padrão visual | 6 | 0 | 1 | 1 | 0 | 0 | 5 | 0 |
| **Total** | 118 | 117 | 94 | 38 | 4 | 53 | 23 | 13 |

Testes: 94 no total, 94 ligados a uma regra.

## Regras

### Agenda, grade, Google Agenda e perfis

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| AGD-01 ⏳ | Cadastros de quadras, professores, tipos de aula (duração, alunos por aula) e grade. | 1 | `painel.test.js` › AGD-01 admin cadastra quadra, tipo de aula e faixa da grade, e a grade do dia mostra o horário livre | ✅ |
| AGD-02 | Só administradores alteram grade, quadras, professores e bloqueios. | 1 | `painel.test.js` › AGD-02 professor não altera a grade nem com a tela de cadastros liberada (servidor recusa)<br>`permissoes.test.js` › AGD-02 só administrador altera grade e cadastros, mesmo com a tela liberada | ✅ |
| AGD-03 ⏳ | Feriados nacionais carregados automaticamente (fixos + Sexta-feira Santa; o admin pode remover um e ele não volta) + feriados e bloqueios manuais; bloqueio sobre aulas avisa alunos e aplica AGD-08. | 2 | `agenda.test.js` › AGD-03 feriados nacionais entram sozinhos, sem duplicar, e o removido pelo admin não volta<br>`painel.test.js` › AGD-03 feriado tira o dia da grade e bloqueio aparece como bloqueado<br>`agenda-google.test.js` › AGD-03 feriados nacionais fixos e Sexta-feira Santa calculada pela Páscoa | ✅ |
| AGD-04 | Aula maior que o intervalo base ocupa blocos seguidos. | 1 | `banco.test.js` › AGD-04 aula de 60 min bloqueia o meio-horário seguinte na mesma quadra<br>`disponibilidade.test.js` › AGD-04 aula de 60 min precisa de dois blocos livres seguidos e não passa do fim da faixa | ✅ |
| AGD-05 | Horário livre = existe na grade, sem bloqueio, com vaga e professor livre. | 2 | `painel.test.js` › AGD-05 professor não pode ter duas faixas no mesmo horário em quadras diferentes<br>`disponibilidade.test.js` › AGD-05 horário livre existe na grade, no dia e no tipo certos<br>`disponibilidade.test.js` › AGD-05 feriado, bloqueio e aula ocupada tiram o horário<br>`disponibilidade.test.js` › AGD-05 professor em outra quadra no mesmo horário não aparece livre<br>`disponibilidade.test.js` › AGD-05 aula de dupla com 1 aluno ainda tem 1 vaga; com 2 está cheia | ✅ |
| AGD-06 | Horário fixo semanal; aulas geradas 4 semanas à frente, renovadas semanalmente. | 1 | — | ❌ |
| AGD-07 | Contrato ligado a atividade + horário; troca de professor na grade mantém os alunos. | 1 | `painel.test.js` › AGD-07 trocar o professor da faixa mantém a faixa (e os alunos) e fica no histórico | ✅ |
| AGD-08 | Professor desmarca aula: apaga evento, avisa aluno, gera crédito se respeitar a antecedência, registra motivo. | 2 | `reposicao.test.js` › AGD-08 professor desmarca com 5 h de antecedência: aluno ganha crédito<br>`reposicao.test.js` › AGD-08 professor desmarca com 1 h: sem crédito e a aula não conta como dada para o aluno | ✅ |
| AGD-09 | Google Agenda: uma agenda por quadra criada por uma **conta de serviço** do Google (decisão do dono, 24/11/2026), compartilhada só para leitura com os administradores e professores ativos; só Sistema → Google; toda mudança passa pela fila `fila_google`, com nova tentativa se o Google falhar. | 2 | `agenda.test.js` › AGD-09 quadra nova vira uma agenda no Google, compartilhada só leitura com admin e professores<br>`agenda.test.js` › AGD-09 professor desativado perde o acesso à agenda; novo professor ganha<br>`agenda.test.js` › AGD-09 Google fora do ar: o envio fica na fila, tenta de novo depois e chega<br>`agenda-google.test.js` › AGD-09 conta de serviço: cria agenda da quadra no fuso de Brasília e compartilha só para leitura<br>`agenda-google.test.js` › AGD-09 evento vai com horário de Brasília, cor e id da aula; apagar o que já não existe não é erro<br>`agenda-google.test.js` › AGD-09 título padrão e cor por tipo de aula; experimental confirmada ganha ✓<br>`agenda-google.test.js` › AGD-09 nova tentativa espera cada vez mais e nunca desiste | ✅ |
| AGD-10 | Presença: professor marca presente/falta; sem marcação = presença; 2 semanas de faltas avisam o professor. | 2 | — | ❌ |
| AGD-11 | Resumo diário às 6h para cada professor. | 1 | — | ❌ |
| PER-01 | Administrador vê e faz tudo; vários admins; um usuário pode ser admin e professor. | 1 | `painel.test.js` › PER-01 administrador e professor ao mesmo tempo vê o painel completo<br>`painel.test.js` › PER-01 administrador não pode tirar o próprio acesso de admin<br>`permissoes.test.js` › PER-01 administrador pode todas as ações | ✅ |
| PER-02 ⏳ | Professor: vê todas as quadras, desmarca, marca presença, vê situação dos seus alunos, sem valores; telas liberadas pelo admin. | 1 | `painel.test.js` › PER-02 professor vê só as telas liberadas; o menu não mostra o resto<br>`permissoes.test.js` › PER-02 professor vê só as telas liberadas e nunca valores, usuários ou histórico | ✅ |
| PER-03 | Permissões verificadas no servidor. | 1 | `painel.test.js` › PER-03 sem login a tela manda para o login e senha errada é recusada<br>`painel.test.js` › PER-03 envio sem origem do próprio painel é recusado<br>`painel.test.js` › PER-03 sessão encerrada pelo admin ou usuário desativado perde o acesso na hora<br>`permissoes.test.js` › PER-03 sem usuário nada é permitido e ação desconhecida é erro<br>`permissoes.test.js` › PER-03 senha só como hash e cookie de sessão não pode ser forjado<br>`permissoes.test.js` › PER-03 envio de formulário só aceito vindo do próprio painel | ✅ |
| AGD-12 | Administrador cria aula avulsa ou experimental pelo painel num horário livre da grade e cancela aula com motivo; a mudança vai para o Google pela fila (AGD-09). | 2 | `agenda.test.js` › AGD-12 admin marca aula avulsa num horário livre e ela aparece na agenda da quadra certa<br>`agenda.test.js` › AGD-12 o mesmo horário não pode ser marcado duas vezes, e professor não marca aula<br>`agenda.test.js` › AGD-12 cancelar aula com motivo apaga o evento do Google e libera o horário | ✅ |

### App do aluno e reposição

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| APP-01 | PWA instalável; login por código de uso único no WhatsApp; sessão longa. | 2 | — | ❌ |
| APP-02 | Um telefone ligado a vários alunos; seletor de aluno. | 1 | — | ❌ |
| APP-03 | Telas: Minhas aulas, Reposições, Meus contratos, Histórico. | 1 | — | ❌ |
| APP-04 | Contrato em atraso bloqueado: aulas daquele contrato só leitura, com aviso e Pix. | 1 | — | ❌ |
| REP-01 | Desmarcar com antecedência ≥ parâmetro (3 h): cancela, libera vaga, gera crédito. | 1 | `reposicao.test.js` › REP-01 desmarcar com exatamente 3 h de antecedência gera crédito | ✅ |
| REP-02 | Menos que o parâmetro ou falta: conta como dada, sem crédito, sem exceção. | 1 | `reposicao.test.js` › REP-02 desmarcar com 2h59 conta como dada e não gera crédito<br>`reposicao.test.js` › REP-02 aula que já começou não gera crédito | ✅ |
| REP-03 | Validade = data da aula desmarcada + 7 dias (editável). | 1 | `reposicao.test.js` › REP-03 validade conta da data da aula desmarcada, não do dia da desmarcação<br>`reposicao.test.js` › REP-03 validade atravessa a virada do ano e respeita o dia em Brasília<br>`reposicao.test.js` › REP-03 validade editável (10 dias) | ✅ |
| REP-04 | Reposição desmarcada não gera novo crédito. | 1 | `banco.test.js` › REP-04 um só crédito por desmarcação (banco recusa o segundo)<br>`reposicao.test.js` › REP-04 desmarcar a própria reposição no prazo não gera novo crédito | ✅ |
| REP-05 ⏳ | Reposição só em horário livre do mesmo tipo do contrato. | 1 | — | ❌ |
| REP-06 ⏳ | Limite de reposições por mês. | 1 | — | ❌ |
| REP-07 | Professor avisado de cada desmarcação e reposição. | 1 | — | ❌ |

### Planos e contratos

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| CON-01 | Plano: criado pelo admin (Novo/Duplicar) com nome, tipo, aulas/semana, vigência, valor de referência opcional, pagamento sugerido, modelo de contrato, reposições/mês, trancamento, ativo para venda. | 2 | — | ❌ |
| CON-01a | Alterar plano vale só para contratos novos; plano com contratos só é desativado; mudanças auditadas. | 2 | — | ❌ |
| CON-02 | Contrato: aluno, plano, horário fixo, início, valor, forma de pagamento, vencimento, desconto com motivo, trancamento. | 2 | — | ❌ |
| CON-03 ⏳ | Proporcional do 1º mês calculado e exibido antes de salvar. | 1 | — | ❌ |
| CON-04 | Aluno com vários contratos ativos. | 1 | — | ❌ |
| CON-05 ⏳ | Dupla: dois contratos no mesmo horário; desmarcação independente. | 1 | — | ❌ |
| CON-06 | Kids: modelo próprio; responsável recebe as mensagens. | 1 | — | ❌ |
| CON-07 ⏳ | Aceite no app com data e hora; texto do contrato definido pelo admin. | 1 | — | ❌ |
| CON-08 | Renovação assistida: detectar contrato anterior e pré-preencher horário e dados. | 1 | — | ❌ |
| CON-09 | Aviso de fim de vigência ao admin e ao aluno (10 dias); sem renovação, horário liberado. | 2 | — | ❌ |
| CON-10 ⏳ | Encerramento só pelo admin, com motivo; horário liberado na hora. | 1 | — | ❌ |
| CON-11 ⏳ | Trancamento: mínimo e saldo; aulas canceladas sem crédito; vigência estendida; volta antecipada devolve saldo. | 3 | — | ❌ |

### Dados e segredos

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| DAD-01 | Nunca escrever, repetir, pedir no chat nem commitar valores do `.env` (chaves da Anthropic, Google, senha do banco). Exemplo de configuração só em `.env.example`, sem valores reais. | 0 | — | processo |
| DAD-02 | Nunca vão para o Git: `.env`, `dados/`, `backups/`, sessão do WhatsApp (`.wwebjs_auth/`, `.wwebjs_cache/`), comprovantes enviados por alunos, exportações com dados de alunos. O hook `bloquear-segredos.js` barra o commit/push que tiver isso. | 0 | — | processo |
| DAD-03 | Nada é apagado do banco: registros mudam de situação (com data e motivo). As tabelas principais têm trava contra `DELETE` (`db/migrations/0001_inicial.sql`). | 0 | `banco.test.js` › DAD-03 aula não pode ser apagada (trava vale para todas as tabelas principais) | ✅ |
| DAD-04 | A tabela `historico` só recebe inclusões: `UPDATE` e `DELETE` são barrados por trava no banco. Toda ação de usuário, Sofia ou sistema grava quem, por onde, quando, o quê, antes/depois e o motivo (OPR-07). | 0 | — | processo |
| DAD-05 | Contrato guarda um retrato do plano e das regras do momento (`plano_retrato`, `regras_retrato`): mudar plano ou regra nunca altera o passado (CON-01a). | 0 | — | processo |
| DAD-06 | Regras configuráveis mudam por nova versão com data (`regra_config`), nunca editando a versão antiga. | 0 | `banco.test.js` › DAD-06 regra configurável muda por nova versão, nunca editando a antiga | ✅ |
| DAD-07 | Anonimização (OPR-05) apaga nome, telefone, e-mail e data de nascimento do contato e marca `anonimizado_em`; IDs, aulas e parcelas continuam. Por isso o histórico guarda **IDs, não dados pessoais** (nome, telefone, e-mail) de alunos e leads. | 0 | — | processo |
| DAD-08 | Mudança de banco só por migração nova em `db/migrations/` (número seguinte), aplicada primeiro na homologação; nunca editar migração já aplicada. | 0 | `banco.test.js` › DAD-08 migrações aplicam do zero e não reaplicam | ✅ |
| DAD-10 | A chave da conta de serviço do Google fica num arquivo fora do repositório (`GOOGLE_CONTA_SERVICO_ARQUIVO`), legível só pelo usuário do sistema. | 0 | — | processo |
| DAD-09 | Dados da Play Squash (alunos, conversas, comprovantes) nunca vão para serviço de terceiros além dos combinados (Anthropic para a Sofia, Google Agenda, WhatsApp). | 0 | — | processo |

### Publicar e atualizar

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| DEP-01 | Toda mudança vai por branch de trabalho → PR para `main` → CI ✓ → squash merge (skill `subir-versao`). Nunca push direto na `main`. | 0 | — | processo |
| DEP-02 | Dois ambientes na VPS: **homologação** (dados de teste, porta 3001) e **produção** (porta 3000), cada um com banco, configuração (`/etc/playsquash/<ambiente>.env`) e serviço próprios. Homologação recebe a marca `estavel`; produção só recebe a versão que o dono liberou, informada por extenso (`infra/atualizar.sh producao <tag>`). | 0 | — | processo |
| DEP-03 | Atualizar produção fora do horário de aulas e de envios (a Sofia e os avisos param durante o reinício). | 0 | — | processo |
| DEP-04 | Atualizar (`infra/atualizar.sh`): instala a versão numa pasta nova, faz cópia do banco, aplica as migrações, troca a versão, reinicia e confere `/saude` por 30 s; se não responder, volta sozinho para a anterior. | 0 | — | processo |
| DEP-05 | Mudança que o dono ou os professores vão notar → item no topo de `NOVIDADES` em `src/painel/novidades.js` (tela "Novidades" do painel; item `para: 'admin'` não aparece para professor). | 1 | `novidades.test.js` › DEP-05 professor não vê as novidades só de administrador; a lista vem da mais nova para a mais velha | ✅ |
| DEP-06 | Cópia diária do banco criptografada (AES-256, chave só no servidor) às 3h30, enviada para fora do servidor (rclone, `BACKUP_REMOTO`), guardando 30 diárias + 12 mensais (`scripts/rotacao-backups.js`); teste de restauração automático no dia 1º de cada mês num banco separado (OPR-06). | 0 | `backup.test.js` › DEP-06 cópia do banco sai criptografada, com nome por data, e não abre sem a chave<br>`backup.test.js` › DEP-06 teste de restauração recria o banco num banco separado e confere migrações e histórico<br>`rotacao-backups.test.js` › DEP-06 guarda a última cópia de cada um dos 30 dias mais recentes<br>`rotacao-backups.test.js` › DEP-06 guarda a primeira cópia de cada um dos 12 meses mais recentes<br>`rotacao-backups.test.js` › DEP-06 cópia feita antes de atualizar vale 30 dias; arquivo estranho nunca é apagado | ✅ |
| DEP-09 | Dados de demonstração (`scripts/demo.js`, e-mails `@playsquash-demo.invalid`, nomes fictícios) só entram em banco sem contatos nem aulas: o script recusa banco com dados. Nunca rodar na produção. | 1 | `demo.test.js` › DEP-09 demonstração entra em banco vazio, com nomes fictícios e e-mails .invalid, e é recusada se já houver dados | ✅ |
| DEP-08 | O CI move a marca `estavel` para o commit da `main` quando todos os jobs passam; é ela que a homologação baixa. | 0 | — | processo |
| DEP-07 | Hooks do Claude ligados em `.claude/settings.json`: `bloquear-segredos.js` (antes de commit/push) e `limpar-restos-teste.js` (fim da sessão). | 0 | — | processo |

### Cobrança e financeiro

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| FIN-01 | Parcela com valor, vencimento, situação e comprovante. | 1 | — | ❌ |
| FIN-02 | Pix estático (BR Code) por parcela com valor e identificador. | 1 | — | ❌ |
| FIN-03 | Comprovante pelo app; baixa manual pelo admin. | 1 | — | ❌ |
| FIN-04 ⏳ | Régua D-3, D0 9h, D+2, D+5 (desmarca aulas do contrato), D+15 (libera horário); afeta só o contrato em atraso. | 3 | — | ❌ |
| FIN-05 | Volta após pagar: antes de D+15 aulas voltam; depois, volta se o horário estiver livre ou escolhe outro. | 2 | — | ❌ |
| FIN-06 | Aviso diário ao admin de parcelas vencidas sem baixa. | 1 | — | ❌ |
| FIN-07 | Caixa: recebimentos por mês e venda de material. | 1 | — | ❌ |
| FIN-08 | Relatórios por mês de competência e de recebimento. | 1 | — | ❌ |

### Indicadores

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| IND-01 | Funil com motivos de perda. | 1 | — | ❌ |
| IND-02 | Ocupação por quadra, dia e faixa. | 1 | — | ❌ |
| IND-03 | Receita prevista × recebida, atraso, ticket médio, vencimentos. | 1 | — | ❌ |
| IND-04 | Alunos ativos, novos e saídas por professor e plano. | 1 | — | ❌ |
| IND-05 | Custo da IA por mês e por matrícula. | 1 | — | ❌ |
| IND-06 ⏳ | Aulas dadas e valor a pagar por professor (valor por aula ou %). | 1 | — | ❌ |

### WhatsApp, dados e operação

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| OPR-01 | WhatsApp Web (QR) em módulo isolado, trocável pela API oficial. | 1 | `whatsapp.test.js` › OPR-01 WhatsApp desconectado: nada é enviado e a mensagem continua na fila<br>`whatsapp.test.js` › OPR-01/OPR-04 cliente real: QR, conectado, envio com o número certo, só conversas individuais e religa ao cair | ✅ |
| OPR-02 | Ritmo de envio: intervalo aleatório, limite por hora/dia, janela de campanhas, não enviar a quem está conversando. | 2 | `whatsapp.test.js` › OPR-02 com o limite por hora atingido nada sai; campanha para quem está conversando é adiada e o aviso passa na frente<br>`whatsapp.test.js` › OPR-02 limite por hora: com 40 saídas na última hora, espera a mais antiga sair da janela<br>`whatsapp.test.js` › OPR-02 campanha só na janela e nunca para quem está conversando; aviso não espera<br>`whatsapp.test.js` › OPR-02 intervalo aleatório entre mensagens fica entre o mínimo e o máximo | ✅ |
| OPR-03 | 'SAIR' remove das campanhas na hora. | 1 | `whatsapp.test.js` › OPR-03 quem responde SAIR sai das campanhas na hora e recebe confirmação; campanha nova não entra<br>`whatsapp.test.js` › OPR-03 "SAIR" e variações tiram das campanhas; frase comum não | ✅ |
| OPR-04 | Aviso ao admin quando a conexão cair. | 1 | `whatsapp.test.js` › OPR-04 painel do admin mostra o aviso quando o WhatsApp está fora do ar há mais de 10 min<br>`whatsapp.test.js` › OPR-01/OPR-04 cliente real: QR, conectado, envio com o número certo, só conversas individuais e religa ao cair<br>`whatsapp.test.js` › OPR-04 aviso ao admin só depois de 10 min fora do ar (desligado de propósito não avisa) | ✅ |
| OPR-05 | Anonimização de contato pelo admin. | 1 | `agenda.test.js` › OPR-05 anonimizar apaga os dados pessoais e mantém aulas e histórico | ✅ |
| OPR-06 | Backup diário fora do servidor; exportação Excel. | 1 | `agenda.test.js` › OPR-06 exportação para Excel só para o admin e fica registrada<br>`agenda-google.test.js` › OPR-06 exportação em CSV do Excel: ";" , acento e fórmula neutralizada | ✅ |
| OPR-07 | Auditoria de ações e de mudanças de regra (quem, quando, antes e depois). | 1 | `banco.test.js` › OPR-07 histórico só recebe inclusões: alterar e apagar são barrados<br>`painel.test.js` › OPR-07 cada mudança no painel grava quem fez, quando, antes e depois | ✅ |
| OPR-08 | Instância exclusiva em VPS Hostinger; fuso America/Sao_Paulo. | 1 | `relogio.test.js` › OPR-08 18h em Brasília continua 18h, qualquer que seja o fuso do servidor | ✅ |
| OPR-10 | Envio em duas etapas: o item é marcado "enviando" e gravado no banco **antes** de mandar e "enviado" depois; se o sistema cair no meio, o item fica "a conferir" na tela WhatsApp e **nunca é reenviado sozinho** (o admin confere no celular e escolhe). Mesma mensagem nunca entra duas vezes na fila (`chave_unica`). | 2 | `whatsapp.test.js` › OPR-10 mesma mensagem não entra duas vezes; enviada fica registrada<br>`whatsapp.test.js` › OPR-10 sistema caiu no meio do envio: item fica "a conferir" e nunca é reenviado sozinho<br>`whatsapp.test.js` › OPR-10 admin resolve o "a conferir" pela tela: confirmar registra, reenviar volta para a fila | ✅ |
| OPR-11 | Telefone guardado sempre como +55 DDD 9 número; ao receber e ao enviar, o número é procurado com e sem o 9 (contas antigas do WhatsApp). | 1 | `whatsapp.test.js` › OPR-11 mensagem de conta antiga (sem o 9) cai no mesmo contato<br>`whatsapp.test.js` › OPR-11 telefone guardado sempre com o 9 e procurado com e sem o 9 | ✅ |
| OPR-09 | Convite a ex-alunos (30/60/90 dias) e mensagem de aniversário. | 1 | — | ❌ |

### Sofia, confirmação da experimental e lista de espera

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| SOF-01 | Atender só leads novos; aluno ativo ou responsável recebe a mensagem fixa e a IA não é chamada. | 3 | `whatsapp.test.js` › SOF-01 aluno ativo e responsável recebem a mensagem fixa no máximo uma vez por dia; lead vai para a Sofia | parcial |
| SOF-02 | Qualificar: nome, já jogou squash, adulto/kids (data de nascimento), individual/dupla, dias e período. | 1 | — | ❌ |
| SOF-03 ⏳ | Quem já jogou: informar valor da experimental e chave Pix antes de marcar. | 2 | — | ❌ |
| SOF-04 | Oferecer até 3 horários livres próximos da preferência, com o professor; sem pré-reserva. | 2 | `disponibilidade.test.js` › SOF-04 antecedência mínima de 3 h tira os horários próximos | parcial |
| SOF-05 | Travar a vaga no banco ao escolher, criar aula e evento no Google; se a vaga foi tomada, oferecer outras. | 2 | `banco.test.js` › SOF-05 duas aulas ativas na mesma quadra e horário são recusadas pelo banco | parcial |
| SOF-06 | 1 experimental por participante (nome + data de nascimento); exceção liberada pelo admin. | 2 | — | ❌ |
| SOF-07 | Experimental em dupla: coletar nome e telefone do parceiro; os dois consomem a experimental; só juntos. | 1 | — | ❌ |
| SOF-08 | Remarcação pelo lead na conversa (libera o antigo, marca o novo). | 1 | — | ❌ |
| SOF-09 | Transbordo: pausa a IA no contato e notifica o admin; o admin devolve à Sofia manualmente. | 2 | `whatsapp.test.js` › SOF-09 conversa em atendimento humano não vai para a Sofia; número da equipe só é registrado | parcial |
| SOF-10 | Anexos configuráveis (imagem/PDF) enviados quando pedidos. | 1 | — | ❌ |
| SOF-11 | Lead em horário cheio entra na lista de espera. | 1 | — | ❌ |
| SOF-12 | Registrar custo da IA por conversa e por dia. | 1 | — | ❌ |
| CNF-01 | Pedido na véspera 19h, reenvio 3 h antes, cancelamento sem resposta 90 min antes (editáveis e desligáveis). | 3 | `confirmacao.test.js` › CNF-01 experimental amanhã 18h: pedido hoje 19h, reenvio 15h, cancelamento 16h30<br>`confirmacao.test.js` › CNF-01 cancelamento desligado: nada é cancelado<br>`confirmacao.test.js` › CNF-01 véspera no 1º do mês (aula em 01/01 → pedido em 31/12) | ✅ |
| CNF-02 | Classificar respostas livres em confirmou / não vai / dúvida (dúvida = transbordo). | 1 | — | ❌ |
| CNF-03 | Confirmou: status e ✓ no evento. Não vai: apaga evento, libera vaga, oferece outra data. | 1 | — | ❌ |
| CNF-04 | Marcada depois do horário do pedido de confirmação nasce confirmada, sem cancelamento automático. | 1 | `confirmacao.test.js` › CNF-04 marcada às 21h da véspera nasce confirmada, sem cancelamento automático<br>`confirmacao.test.js` › CNF-04 marcada no próprio dia nasce confirmada | ✅ |
| CNF-05 | Professor avisado em todos os desfechos. | 1 | — | ❌ |
| CNF-06 | Pós-aula: presença, contato no mesmo dia e +2 dias; sem matrícula, admin escolhe o motivo de perda. | 2 | — | ❌ |
| LES-01 | Entram leads (Sofia) e alunos com crédito de reposição (app). | 1 | — | ❌ |
| LES-02 | Vaga liberada com antecedência suficiente: avisar todos; o primeiro que confirmar leva; demais recebem 'vaga já preenchida'. | 2 | — | ❌ |
| LES-03 | Lead sai de todas as listas ao marcar experimental; aluno sai ao conseguir o horário ou quando o crédito vence. | 2 | — | ❌ |
| LES-04 | Avisos: professor recebe nome, telefone, tipo, dia, hora, quadra; a pessoa recebe os dados do professor. | 1 | — | ❌ |

### Testes

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| TST-01 | Teste nunca toca dado real: banco só por `DATABASE_URL_TESTE`; WhatsApp, IA e Google só pelos simuladores de `testes/simuladores/` (nada sai para a rede). | 0 | — | processo |
| TST-02 | Regra nova ou alterada → teste cujo título **começa pelo código** da regra (ex.: `REP-03 validade conta da data da aula`; mais de um: `REP-01/REP-02 ...`). Os casos planejados ficam em `docs/casos-de-teste.md`; `npm run matriz` atualiza a matriz. `matriz.test.js` falha se um teste cita código que não existe nas regras ou se a matriz está velha. | 0 | `matriz.test.js` › TST-02 título de teste: códigos no começo, um ou vários<br>`matriz.test.js` › TST-02 nenhum teste ou caso cita código que não existe nas regras<br>`matriz.test.js` › TST-02 a matriz docs/rastreabilidade.md está em dia | ✅ |
| TST-03 | Tela nova → entra em `TELAS` de `testes/tela/telas.test.js` (computador 1366 px e celular 390 px). O teste reprova erro de JavaScript, texto "undefined/NaN/null", código interno de regra aparecendo na tela e rolagem lateral da página (tabela larga rola dentro do cartão). | 0 | — | processo |
| TST-04 | Teste instável: achar e corrigir a causa; nunca repetir a rodada até passar nem desligar o teste. | 0 | — | processo |
| TST-05 | Bateria completa antes de cada PR, e o CI (`.github/workflows/ci.yml`) precisa ficar ✓. | 0 | — | processo |
| TST-06 | "Agora" e "hoje" vêm só de `src/relogio.js`. Em teste, fixe com `NODE_ENV=test` + `PS_AGORA` (ISO) ou passe o horário como parâmetro; fora de teste `PS_AGORA` é ignorado. Datas difíceis: 1º do mês, fim de fevereiro, 1º de janeiro, domingo, virada do dia em Brasília. | 0 | `relogio.test.js` › TST-06 PS_AGORA fixa o relógio só em teste<br>`relogio.test.js` › TST-06 datas difíceis: fim de fevereiro em ano bissexto e domingo | ✅ |
| TST-07 | Teste que cria pasta temporária usa o prefixo `ps-teste-` e apaga no fim (`finally`); restos com mais de 2 h são apagados pelo hook `limpar-restos-teste.js`. | 0 | — | processo |
| TST-08 | Simuladores (`testes/simuladores/`) seguem a mesma interface das integrações reais; integração real nova → simulador com a mesma interface e um teste do simulador. | 0 | `simuladores.test.js` › TST-08 WhatsApp falso guarda envios, entrega recebidas e avisa desconexão<br>`simuladores.test.js` › TST-08 IA falsa responde pelo roteiro e conta as chamadas<br>`simuladores.test.js` › TST-08 Google falso cria, atualiza, apaga e simula indisponibilidade | ✅ |

### Padrão visual

| Código | Regra | Casos | Testes escritos | Cobertura |
|---|---|---|---|---|
| VIS-01 | Cores (tokens): verde `#00A97E` (ação principal, item ativo), escuro `#0E2620` (menu lateral, títulos, botão selecionado), texto `#1D2A26`, texto suave `#64746F`, linha `#E3E9E6`, fundo `#F5F8F7`, fundo verde claro `#E3F5EE`. Tipos de aula: aula fixa `#00A97E`, dupla `#8E5CC8`, experimental `#F2A33A`, reposição `#5B7FE0`, livre listrado cinza. | 0 | — | processo |
| VIS-02 | Situação sempre com cor **e** texto (nunca só cor): ok `#E3F5EE`/`#047857`, atenção `#FFF3DF`/`#A35F00`, problema `#FDE8E8`/`#B42318`, informação `#E8EEFC`/`#3651A8`. | 0 | — | processo |
| VIS-03 | Fonte Inter; títulos 600; números grandes em 25 px/600; legenda 12 px suave. | 0 | — | processo |
| VIS-04 | Painel: menu lateral escuro com grupos (Sofia, Agenda, Alunos, Financeiro, Indicadores), barra superior branca com título e ações à direita, conteúdo em cartões brancos com borda `#E3E9E6` e canto 12 px. | 0 | — | processo |
| VIS-05 | App do aluno e do professor: celular primeiro (390 px), cabeçalho com saudação + título, cartões de 14 px de canto, barra de abas embaixo, botões de ação curtos ("Desmarcar", "Usar"). | 0 | — | processo |
| VIS-06 | Toda tela funciona em 1366 px e 390 px sem rolagem lateral (TST-03). | 0 | `telas.test.js` › VIS-06 telas do painel no ${tam.nome} (${tam.width} px): sem erro, sem rolagem lateral, sem "undefined" | ✅ |

## Achados

Nenhum até agora. Erro ou contradição de regra de negócio encontrado no desenvolvimento entra aqui e é mostrado ao dono.
