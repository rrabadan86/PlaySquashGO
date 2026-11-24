# Play Squash — Agenda de Squash

Agenda das quadras, atendimento pela Sofia no WhatsApp, app do aluno e do professor, contratos e
cobrança por Pix da Play Squash.

## Situação
**Etapa 1 — base.** Login com perfis (administrador e professor), grade do dia, cadastros de
quadras, tipos de aula, grade de horários, bloqueios e feriados (nacionais automáticos), aula
avulsa ou experimental marcada e cancelada pelo painel, espelho no Google Agenda por conta de
serviço (uma agenda por quadra, com fila e nova tentativa), contatos com anonimização,
exportação para Excel e histórico de tudo o que muda.

Etapas seguintes (proposta de 24/11/2026): 1. Base · 2. Sofia · 3. Alunos e app · 4. Financeiro e indicadores.

## Requisitos
- Node.js 22
- PostgreSQL 16 (só para os testes de integração e, depois, para rodar o sistema)

## Comandos
```bash
npm install
npm test                      # testes de unidade
npm run matriz                # reescreve docs/rastreabilidade.md
npm run matriz:conferir       # confere se a matriz está em dia (usado no CI)
DATABASE_URL_TESTE=postgres://... npm run test:integracao   # banco de TESTE (é apagado e recriado)
DATABASE_URL_TESTE=postgres://... npm run test:telas        # telas no computador e no celular (Playwright)
DATABASE_URL=postgres://... npm run migrar                  # aplica as migrações

# Primeiro acesso: criar o administrador (a senha vai pela variável, nunca na linha de comando)
DATABASE_URL=postgres://... SENHA_NOVA='...' npm run criar-usuario -- --nome "Guilherme" --email email@exemplo.com --admin --professor
# Subir o painel (PAINEL_SEGREDO: texto aleatório com 32+ caracteres, guardado só no .env)
DATABASE_URL=postgres://... PAINEL_SEGREDO=... PORTA=3000 npm run iniciar
```

Leia `CLAUDE.md` para a organização do projeto e as regras de trabalho.
