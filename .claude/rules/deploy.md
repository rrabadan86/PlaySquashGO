---
paths:
  - ".github/**"
  - "scripts/**"
  - "package.json"
---

# Publicar e atualizar

- **DEP-01** Toda mudança vai por branch de trabalho → PR para `main` → CI ✓ → squash merge (skill `subir-versao`). Nunca push direto na `main`.
- **DEP-02** Dois ambientes na VPS: **homologação** (dados de teste) e **produção**. Produção só recebe versão testada na homologação e liberada pelo dono.
- **DEP-03** Atualizar produção fora do horário de aulas e de envios (a Sofia e os avisos param durante o reinício).
- **DEP-04** Migração de banco roda antes de subir o código novo, com cópia do banco feita antes.
- **DEP-05** Mudança que o dono ou os professores vão notar → item em "Novidades" (página de novidades do painel, a criar na etapa 1).
- **DEP-06** Cópia diária do banco criptografada fora do servidor (30 diárias + 12 mensais) e teste de restauração uma vez por mês (OPR-06).
- **DEP-07** Hooks do Claude ligados em `.claude/settings.json`: `bloquear-segredos.js` (antes de commit/push) e `limpar-restos-teste.js` (fim da sessão).
