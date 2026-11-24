---
paths:
  - "src/app/**"
  - "src/regras/reposicao.js"
---

# App do aluno e reposição

Cada regra tem um código e fica só aqui; o resto do projeto aponta para ela. Fonte: documento interno de requisitos v2 e Termo de aprovação de escopo (24/11/2026). 
"⏳ kickoff" = depende de resposta do cliente no kickoff: **não implemente a parte pendente sem a resposta**.

- **APP-01** PWA instalável; login por código de uso único no WhatsApp; sessão longa. _(Etapa 3 · App aluno › Login)_
- **APP-02** Um telefone ligado a vários alunos; seletor de aluno. _(Etapa 3 · App aluno (M3))_
- **APP-03** Telas: Minhas aulas, Reposições, Meus contratos, Histórico. _(Etapa 3 · App aluno (M3))_
- **APP-04** Contrato em atraso bloqueado: aulas daquele contrato só leitura, com aviso e Pix. _(Etapa 4 · App aluno › Contratos)_
- **REP-01** Desmarcar com antecedência ≥ parâmetro (3 h): cancela, libera vaga, gera crédito. _(Etapa 3 · App aluno (M3))_
- **REP-02** Menos que o parâmetro ou falta: conta como dada, sem crédito, sem exceção. _(Etapa 3 · App aluno)_
- **REP-03** Validade = data da aula desmarcada + 7 dias (editável). _(Etapa 3 · App aluno › Reposições (M3))_
- **REP-04** Reposição desmarcada não gera novo crédito. _(Etapa 3 · App aluno)_
- **REP-05** Reposição só em horário livre do mesmo tipo do contrato. _(Etapa 3 · App aluno › Reposições · ⏳ kickoff: aluno de dupla)_
- **REP-06** Limite de reposições por mês. _(Etapa 3 · — · ⏳ kickoff: quantidade e tipo de mês)_
- **REP-07** Professor avisado de cada desmarcação e reposição. _(Etapa 3 · WhatsApp professor)_
