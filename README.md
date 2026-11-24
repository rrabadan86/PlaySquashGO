# Play Squash — Agenda de Squash

Agenda das quadras, atendimento pela Sofia no WhatsApp, app do aluno e do professor, contratos e
cobrança por Pix da Play Squash.

## Situação
**Fase 0 — estrutura.** Ainda não há telas nem integrações: este repositório tem as regras com
código, o catálogo de casos de teste, a matriz de rastreabilidade, o modelo do banco (primeira
migração), as regras puras de reposição e confirmação com seus testes, os simuladores e o CI.

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
DATABASE_URL=postgres://... npm run migrar                  # aplica as migrações
```

Leia `CLAUDE.md` para a organização do projeto e as regras de trabalho.
