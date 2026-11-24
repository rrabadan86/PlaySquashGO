---
paths:
  - "src/sofia/**"
  - "src/regras/confirmacao.js"
  - "src/regras/lista-espera.js"
  - "testes/**/sofia*"
  - "testes/**/confirmacao*"
---

# Sofia, confirmação da experimental e lista de espera

Cada regra tem um código e fica só aqui; o resto do projeto aponta para ela. Fonte: documento interno de requisitos v2 e Termo de aprovação de escopo (24/11/2026). 
"⏳ kickoff" = depende de resposta do cliente no kickoff: **não implemente a parte pendente sem a resposta**.

- **SOF-01** Atender só leads novos; aluno ativo ou responsável recebe a mensagem fixa e a IA não é chamada. _(Etapa 2 · WhatsApp (M2))_
- **SOF-02** Qualificar: nome, já jogou squash, adulto/kids (data de nascimento), individual/dupla, dias e período. _(Etapa 2 · WhatsApp (M2))_
- **SOF-03** Quem já jogou: informar valor da experimental e chave Pix antes de marcar. _(Etapa 2 · WhatsApp · ⏳ kickoff: pagamento antes da reserva?)_
- **SOF-04** Oferecer até 3 horários livres próximos da preferência, com o professor; sem pré-reserva. _(Etapa 2 · WhatsApp (M2))_
- **SOF-05** Travar a vaga no banco ao escolher, criar aula e evento no Google; se a vaga foi tomada, oferecer outras. _(Etapa 2 · WhatsApp / Google)_
- **SOF-06** 1 experimental por participante (nome + data de nascimento); exceção liberada pelo admin. _(Etapa 2 · WhatsApp / Painel › Contatos)_
- **SOF-07** Experimental em dupla: coletar nome e telefone do parceiro; os dois consomem a experimental; só juntos. _(Etapa 2 · WhatsApp)_
- **SOF-08** Remarcação pelo lead na conversa (libera o antigo, marca o novo). _(Etapa 2 · WhatsApp)_
- **SOF-09** Transbordo: pausa a IA no contato e notifica o admin; o admin devolve à Sofia manualmente. _(Etapa 2 · Painel › Conversas)_
- **SOF-10** Anexos configuráveis (imagem/PDF) enviados quando pedidos. _(Etapa 2 · Painel › Sofia › Configuração)_
- **SOF-11** Lead em horário cheio entra na lista de espera. _(Etapa 2 · WhatsApp)_
- **SOF-12** Registrar custo da IA por conversa e por dia. _(Etapa 2 · Painel › Custo IA)_
- **CNF-01** Pedido na véspera 19h, reenvio 3 h antes, cancelamento sem resposta 90 min antes (editáveis e desligáveis). _(Etapa 2 · WhatsApp)_
- **CNF-02** Classificar respostas livres em confirmou / não vai / dúvida (dúvida = transbordo). _(Etapa 2 · WhatsApp)_
- **CNF-03** Confirmou: status e ✓ no evento. Não vai: apaga evento, libera vaga, oferece outra data. _(Etapa 2 · Painel › Experimentais (M1))_
- **CNF-04** Marcada depois do horário do pedido de confirmação nasce confirmada, sem cancelamento automático. _(Etapa 2 · —)_
- **CNF-05** Professor avisado em todos os desfechos. _(Etapa 2 · WhatsApp professor (M2))_
- **CNF-06** Pós-aula: presença, contato no mesmo dia e +2 dias; sem matrícula, admin escolhe o motivo de perda. _(Etapa 2 · Painel › Experimentais)_
- **LES-01** Entram leads (Sofia) e alunos com crédito de reposição (app). _(Etapa 2 · WhatsApp / App aluno (M3))_
- **LES-02** Vaga liberada com antecedência suficiente: avisar todos; o primeiro que confirmar leva; demais recebem 'vaga já preenchida'. _(Etapa 2 · WhatsApp / App aluno)_
- **LES-03** Lead sai de todas as listas ao marcar experimental; aluno sai ao conseguir o horário ou quando o crédito vence. _(Etapa 2 · —)_
- **LES-04** Avisos: professor recebe nome, telefone, tipo, dia, hora, quadra; a pessoa recebe os dados do professor. _(Etapa 2 · WhatsApp (M2))_
