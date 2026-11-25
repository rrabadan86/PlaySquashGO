---
paths:
  - ".github/**"
  - "scripts/**"
  - "infra/**"
  - "package.json"
---

# Publicar e atualizar

Passo a passo da VPS: `infra/README.md`. Scripts: `infra/instalar-vps.sh`, `infra/atualizar.sh`, `infra/backup.sh`, `infra/restaurar.sh`; serviços em `infra/systemd/`.

- **DEP-01** Toda mudança vai por branch de trabalho → PR para `main` → CI ✓ → squash merge (skill `subir-versao`). Nunca push direto na `main`.
- **DEP-02** Dois ambientes na VPS: **homologação** (dados de teste, porta 3001) e **produção** (porta 3000), cada um com banco, configuração (`/etc/playsquash/<ambiente>.env`) e serviço próprios. Homologação recebe a marca `estavel`; produção só recebe a versão que o dono liberou, informada por extenso (`infra/atualizar.sh producao <tag>`).
- **DEP-03** Atualizar produção fora do horário de aulas e de envios (a Sofia e os avisos param durante o reinício).
- **DEP-04** Atualizar (`infra/atualizar.sh`): instala a versão numa pasta nova, faz cópia do banco, aplica as migrações, troca a versão, reinicia e confere `/saude` por 30 s; se não responder, volta sozinho para a anterior.
- **DEP-05** Mudança que o dono ou os professores vão notar → item no topo de `NOVIDADES` em `src/painel/novidades.js` (tela "Novidades" do painel; item `para: 'admin'` não aparece para professor).
- **DEP-06** Cópia diária do banco criptografada (AES-256, chave só no servidor) às 3h30, junto com os anexos da Sofia (`SOFIA_ANEXOS_DIR`, decisão do dono 25/11/2026), enviada para fora do servidor (rclone, `BACKUP_REMOTO`), guardando 30 diárias + 12 mensais (`scripts/rotacao-backups.js`); teste de restauração automático no dia 1º de cada mês num banco separado (OPR-06).
- **DEP-09** Dados de demonstração (`scripts/demo.js`, e-mails `@playsquash-demo.invalid`, nomes fictícios) só entram em banco sem contatos nem aulas: o script recusa banco com dados. Nunca rodar na produção.
- **DEP-08** O CI move a marca `estavel` para o commit da `main` quando todos os jobs passam; é ela que a homologação baixa.
- **DEP-07** Hooks do Claude ligados em `.claude/settings.json`: `bloquear-segredos.js` (antes de commit/push) e `limpar-restos-teste.js` (fim da sessão).
