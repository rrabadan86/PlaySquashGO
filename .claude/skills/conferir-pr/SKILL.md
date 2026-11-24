---
name: conferir-pr
description: Confere um PR da Play Squash antes do merge — arquivos (nada de dado ou segredo), testes das regras mexidas, matriz, regras da área e CI — e devolve uma lista ✓/✗ em português. Use depois do push e antes de mesclar.
---

# Conferir PR (Play Squash)

Só confere e relata — **não mescla**.

1. **Arquivos**: `git fetch origin main && git diff --name-only origin/main...HEAD`. ✗ se houver `.env`, `dados/`, `backups/`, `comprovantes/`, `exportacoes/`, sessão do WhatsApp ou cópia do banco (DAD-02).
2. **Testes**: `npm test` e, se mexeu em `db/` ou integrações, `npm run test:integracao`.
3. **Matriz**: `npm run matriz:conferir` sem erro. Regra nova/alterada tem teste com o código no título (TST-02). Erro de regra de negócio achado no caminho → "Achados" da matriz e mostrar ao dono, sem corrigir sozinho.
4. **Regras da área**: releia os arquivos de `.claude/rules/` cujos `paths:` batem com os arquivos do PR. Atenção: DAD-03/DAD-04 (nada apagado, histórico só inclui), AGD-09 (só Sistema → Google), PER-03 (permissão no servidor), regras ⏳ kickoff (não implementar sem resposta).
5. **Migração**: mudou banco → migração nova numerada, nenhuma migração antiga editada (DAD-08).
6. **CI**: todos os jobs ✓.
7. **Relatório ao dono**, uma linha por item: `✓/✗ Arquivos · ✓/✗ Testes · ✓/✗ Matriz · ✓/✗ Regras da área · ✓/✗ Migração · ✓/✗ CI`.
