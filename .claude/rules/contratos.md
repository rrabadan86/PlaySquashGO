---
paths:
  - "src/contratos/**"
  - "src/regras/contrato*.js"
---

# Planos e contratos

Cada regra tem um código e fica só aqui; o resto do projeto aponta para ela. Fonte: documento interno de requisitos v2 e Termo de aprovação de escopo (24/11/2026). 
"⏳ kickoff" = depende de resposta do cliente no kickoff: **não implemente a parte pendente sem a resposta**.

- **CON-01** Plano: criado pelo admin (Novo/Duplicar) com nome, tipo, aulas/semana, vigência, valor de referência opcional, pagamento sugerido, modelo de contrato, reposições/mês, trancamento, ativo para venda. _(Etapa 4 · Painel › Planos (M7))_
- **CON-01a** Alterar plano vale só para contratos novos; plano com contratos só é desativado; mudanças auditadas. _(Etapa 4 · Painel › Planos (M7))_
- **CON-02** Contrato: aluno, plano, horário fixo, início, valor, forma de pagamento, vencimento, desconto com motivo, trancamento. _(Etapa 4 · Painel › Novo contrato (M4))_
- **CON-03** Proporcional do 1º mês calculado e exibido antes de salvar. _(Etapa 4 · Painel › Novo contrato (M4) · ⏳ kickoff: dias ou aulas)_
- **CON-04** Aluno com vários contratos ativos. _(Etapa 4 · Painel › Ficha do aluno)_
- **CON-05** Dupla: dois contratos no mesmo horário; desmarcação independente. _(Etapa 4 · Painel › Novo contrato · ⏳ kickoff: um sai ou atrasa)_
- **CON-06** Kids: modelo próprio; responsável recebe as mensagens. _(Etapa 4 · Painel › Novo contrato)_
- **CON-07** Aceite no app com data e hora; texto do contrato definido pelo admin. _(Etapa 4 · App aluno › Contratos · ⏳ kickoff: texto dos modelos)_
- **CON-08** Renovação assistida: detectar contrato anterior e pré-preencher horário e dados. _(Etapa 4 · Painel › Novo contrato (M4))_
- **CON-09** Aviso de fim de vigência ao admin e ao aluno (10 dias); sem renovação, horário liberado. _(Etapa 4 · WhatsApp / Painel)_
- **CON-10** Encerramento só pelo admin, com motivo; horário liberado na hora. _(Etapa 4 · Painel › Ficha do aluno · ⏳ kickoff: multa, devolução)_
- **CON-11** Trancamento: mínimo e saldo; aulas canceladas sem crédito; vigência estendida; volta antecipada devolve saldo. _(Etapa 4 · Painel / App aluno · ⏳ kickoff: trancamento × atraso)_
