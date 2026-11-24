---
paths:
  - "src/financeiro/**"
  - "src/regras/cobranca*.js"
  - "src/regras/pix.js"
---

# Cobrança e financeiro

Cada regra tem um código e fica só aqui; o resto do projeto aponta para ela. Fonte: documento interno de requisitos v2 e Termo de aprovação de escopo (24/11/2026). 
"⏳ kickoff" = depende de resposta do cliente no kickoff: **não implemente a parte pendente sem a resposta**.

- **FIN-01** Parcela com valor, vencimento, situação e comprovante. _(Etapa 4 · Painel › Cobranças)_
- **FIN-02** Pix estático (BR Code) por parcela com valor e identificador. _(Etapa 4 · App aluno › Contratos (M3))_
- **FIN-03** Comprovante pelo app; baixa manual pelo admin. _(Etapa 4 · Painel › Cobranças)_
- **FIN-04** Régua D-3, D0 9h, D+2, D+5 (desmarca aulas do contrato), D+15 (libera horário); afeta só o contrato em atraso. _(Etapa 4 · WhatsApp / App aluno · ⏳ kickoff: multa e juros, parcelas futuras)_
- **FIN-05** Volta após pagar: antes de D+15 aulas voltam; depois, volta se o horário estiver livre ou escolhe outro. _(Etapa 4 · App aluno)_
- **FIN-06** Aviso diário ao admin de parcelas vencidas sem baixa. _(Etapa 4 · WhatsApp admin / Painel (M1))_
- **FIN-07** Caixa: recebimentos por mês e venda de material. _(Etapa 4 · Painel › Caixa)_
- **FIN-08** Relatórios por mês de competência e de recebimento. _(Etapa 4 · Painel › Caixa)_
