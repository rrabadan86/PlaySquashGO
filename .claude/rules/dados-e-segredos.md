---
paths:
  - ".env*"
  - ".gitignore"
  - "db/**"
  - "src/historico.js"
---

# Dados e segredos

- **DAD-01** Nunca escrever, repetir, pedir no chat nem commitar valores do `.env` (chaves da Anthropic, Google, senha do banco). Exemplo de configuração só em `.env.example`, sem valores reais.
- **DAD-02** Nunca vão para o Git: `.env`, `dados/`, `backups/`, sessão do WhatsApp (`.wwebjs_auth/`, `.wwebjs_cache/`), comprovantes enviados por alunos, exportações com dados de alunos. O hook `bloquear-segredos.js` barra o commit/push que tiver isso.
- **DAD-03** Nada é apagado do banco: registros mudam de situação (com data e motivo). As tabelas principais têm trava contra `DELETE` (`db/migrations/0001_inicial.sql`).
- **DAD-04** A tabela `historico` só recebe inclusões: `UPDATE` e `DELETE` são barrados por trava no banco. Toda ação de usuário, Sofia ou sistema grava quem, por onde, quando, o quê, antes/depois e o motivo (OPR-07).
- **DAD-05** Contrato guarda um retrato do plano e das regras do momento (`plano_retrato`, `regras_retrato`): mudar plano ou regra nunca altera o passado (CON-01a).
- **DAD-06** Regras configuráveis mudam por nova versão com data (`regra_config`), nunca editando a versão antiga.
- **DAD-07** Anonimização (OPR-05) apaga nome, telefone, e-mail e data de nascimento do contato e marca `anonimizado_em`; IDs, aulas e parcelas continuam.
- **DAD-08** Mudança de banco só por migração nova em `db/migrations/` (número seguinte), aplicada primeiro na homologação; nunca editar migração já aplicada.
- **DAD-09** Dados da Play Squash (alunos, conversas, comprovantes) nunca vão para serviço de terceiros além dos combinados (Anthropic para a Sofia, Google Agenda, WhatsApp).
