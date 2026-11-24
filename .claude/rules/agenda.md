---
paths:
  - "src/agenda/**"
  - "src/regras/disponibilidade.js"
  - "src/painel/**"
  - "db/migrations/**"
---

# Agenda, grade, Google Agenda e perfis

Cada regra tem um código e fica só aqui; o resto do projeto aponta para ela. Fonte: documento interno de requisitos v2 e Termo de aprovação de escopo (24/11/2026). 
"⏳ kickoff" = depende de resposta do cliente no kickoff: **não implemente a parte pendente sem a resposta**.

- **AGD-01** Cadastros de quadras, professores, tipos de aula (duração, alunos por aula) e grade. _(Etapa 1 · Painel › Quadras e professores · ⏳ kickoff: capacidade por tipo)_
- **AGD-02** Só administradores alteram grade, quadras, professores e bloqueios. _(Etapa 1 · Painel › Grade (M1))_
- **AGD-03** Feriados nacionais carregados automaticamente (fixos + Sexta-feira Santa; o admin pode remover um e ele não volta) + feriados e bloqueios manuais; bloqueio sobre aulas avisa alunos e aplica AGD-08. _(Etapa 1 · Painel › Grade · ⏳ kickoff: quais feriados, reposição)_
- **AGD-04** Aula maior que o intervalo base ocupa blocos seguidos. _(Etapa 1 · Painel › Grade (M1))_
- **AGD-05** Horário livre = existe na grade, sem bloqueio, com vaga e professor livre. _(Etapa 1 · —)_
- **AGD-06** Horário fixo semanal; aulas geradas 4 semanas à frente, renovadas semanalmente. _(Etapa 3 · Painel › Grade)_
- **AGD-07** Contrato ligado a atividade + horário; troca de professor na grade mantém os alunos. _(Etapa 1 · Painel › Grade)_
- **AGD-08** Professor desmarca aula: apaga evento, avisa aluno, gera crédito se respeitar a antecedência, registra motivo. _(Etapa 3 · App professor (M6))_
- **AGD-09** Google Agenda: uma agenda por quadra criada por uma **conta de serviço** do Google (decisão do dono, 24/11/2026), compartilhada só para leitura com os administradores e professores ativos; só Sistema → Google; toda mudança passa pela fila `fila_google`, com nova tentativa se o Google falhar. _(Etapa 1 · Google Agenda)_
- **AGD-10** Presença: professor marca presente/falta; sem marcação = presença; 2 semanas de faltas avisam o professor. _(Etapa 3 · App professor (M6))_
- **AGD-11** Resumo diário às 6h para cada professor. _(Etapa 3 · WhatsApp professor (M2))_
- **PER-01** Administrador vê e faz tudo; vários admins; um usuário pode ser admin e professor. _(Etapa 1 · Painel › Usuários)_
- **PER-02** Professor: vê todas as quadras, desmarca, marca presença, vê situação dos seus alunos, sem valores; telas liberadas pelo admin. _(Etapa 1 · App professor (M6) · ⏳ kickoff: quem são 'alunos do professor')_
- **PER-03** Permissões verificadas no servidor. _(Etapa 1 · —)_
- **AGD-12** Administrador cria aula avulsa ou experimental pelo painel num horário livre da grade e cancela aula com motivo; a mudança vai para o Google pela fila (AGD-09). _(Etapa 1 · Painel › Grade (M1))_
