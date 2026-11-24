---
name: subir-versao
description: Sobe uma mudança da Play Squash para a main com segurança — confere sintaxe, testes e matriz, faz commit na branch de trabalho, abre o PR, espera o CI ficar ✓ e só então faz o squash merge. Use sempre que for publicar/mesclar uma alteração.
---

# Subir versão (Play Squash)

Siga na ordem. Pare e avise o dono se algum passo falhar — nunca mescle com CI vermelho (DEP-01).

1. **Conferir localmente**
   - `node --check` em cada `.js` alterado.
   - `npm test`; se mexeu em banco, migração ou integração: `npm run test:integracao` com `DATABASE_URL_TESTE` (banco de teste).
   - `git status`: nada de `.env`, `dados/`, `backups/`, `comprovantes/`, sessão do WhatsApp (DAD-02).
2. **Matriz**: regra nova/alterada → teste com o código no título (TST-02) e `npm run matriz`.
3. **Novidades**: mudança que o dono vai notar → item em Novidades (DEP-05).
4. **Commit e push** na branch de trabalho (mensagem em português, com as linhas de atribuição pedidas pela sessão).
5. **PR** para `main`, em português: o que muda e como foi testado.
6. **Esperar o CI** (`.github/workflows/ci.yml`). ✓ → rode a skill `conferir-pr`. ✗ → leia o log, corrija na mesma branch e espere de novo.
7. **Merge** só com tudo ✓ e pedido do dono: squash.
8. **Avisar o dono** em português simples: o que mudou, o que rodar no servidor (homologação primeiro, DEP-02) e o resultado dos testes.
