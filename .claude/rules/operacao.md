---
paths:
  - "src/whatsapp/**"
  - "src/historico.js"
  - "src/relogio.js"
  - "scripts/**"
---

# WhatsApp, dados e operação

Cada regra tem um código e fica só aqui; o resto do projeto aponta para ela. Fonte: documento interno de requisitos v2 e Termo de aprovação de escopo (24/11/2026). 
"⏳ kickoff" = depende de resposta do cliente no kickoff: **não implemente a parte pendente sem a resposta**.

- **OPR-01** WhatsApp Web (QR) em módulo isolado, trocável pela API oficial. _(Etapa 2 · Painel › WhatsApp)_
- **OPR-02** Ritmo de envio: intervalo aleatório, limite por hora/dia, janela de campanhas, não enviar a quem está conversando. _(Etapa 2 · Painel › WhatsApp)_
- **OPR-03** 'SAIR' remove das campanhas na hora. _(Etapa 2 · WhatsApp)_
- **OPR-04** Aviso ao admin quando a conexão cair. _(Etapa 2 · WhatsApp admin)_
- **OPR-05** Anonimização de contato pelo admin. _(Etapa 1 · Painel › Contatos)_
- **OPR-06** Backup diário fora do servidor; exportação Excel. _(Etapa 1 · Painel › Configurações)_
- **OPR-07** Auditoria de ações e de mudanças de regra (quem, quando, antes e depois). _(Etapa 1 · Painel › Configurações)_
- **OPR-08** Instância exclusiva em VPS Hostinger; fuso America/Sao_Paulo. _(Etapa 1 · —)_
- **OPR-10** Envio em duas etapas: o item é marcado "enviando" e gravado no banco **antes** de mandar e "enviado" depois; se o sistema cair no meio, o item fica "a conferir" na tela WhatsApp e **nunca é reenviado sozinho** (o admin confere no celular e escolhe). Mesma mensagem nunca entra duas vezes na fila (`chave_unica`). _(Etapa 2 · Painel › WhatsApp)_
- **OPR-11** Telefone guardado sempre como +55 DDD 9 número; ao receber e ao enviar, o número é procurado com e sem o 9 (contas antigas do WhatsApp). _(Etapa 2 · —)_
- **OPR-09** Convite a ex-alunos (30/60/90 dias) e mensagem de aniversário. _(Etapa 4 · WhatsApp)_
