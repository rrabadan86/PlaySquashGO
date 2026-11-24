---
paths:
  - "testes/**"
  - "docs/rastreabilidade.md"
  - "docs/casos-de-teste.md"
  - "scripts/matriz.js"
---

# Testes

Comandos:
- Unidade: `npm test` (= `node --test testes/unidade/`)
- Integração (banco de teste): `npm run test:integracao` — precisa de `DATABASE_URL_TESTE` apontando para um PostgreSQL **de teste** (o teste apaga e recria o esquema). Sem a variável, os testes de integração são pulados.
- Telas: `npm run test:telas` — Playwright no computador (1366 px) e no celular (390 px); precisa de `DATABASE_URL_TESTE`. Prints na pasta temporária `ps-telas-...`.
- Matriz: `npm run matriz` (reescreve `docs/rastreabilidade.md`); `npm run matriz:conferir` (só confere; o CI usa esta).

- **TST-01** Teste nunca toca dado real: banco só por `DATABASE_URL_TESTE`; WhatsApp, IA e Google só pelos simuladores de `testes/simuladores/` (nada sai para a rede).
- **TST-02** Regra nova ou alterada → teste cujo título **começa pelo código** da regra (ex.: `REP-03 validade conta da data da aula`; mais de um: `REP-01/REP-02 ...`). Os casos planejados ficam em `docs/casos-de-teste.md`; `npm run matriz` atualiza a matriz. `matriz.test.js` falha se um teste cita código que não existe nas regras ou se a matriz está velha.
- **TST-03** Tela nova → entra em `TELAS` de `testes/tela/telas.test.js` (computador 1366 px e celular 390 px). O teste reprova erro de JavaScript, texto "undefined/NaN/null", código interno de regra aparecendo na tela e rolagem lateral da página (tabela larga rola dentro do cartão).
- **TST-04** Teste instável: achar e corrigir a causa; nunca repetir a rodada até passar nem desligar o teste.
- **TST-05** Bateria completa antes de cada PR, e o CI (`.github/workflows/ci.yml`) precisa ficar ✓.
- **TST-06** "Agora" e "hoje" vêm só de `src/relogio.js`. Em teste, fixe com `NODE_ENV=test` + `PS_AGORA` (ISO) ou passe o horário como parâmetro; fora de teste `PS_AGORA` é ignorado. Datas difíceis: 1º do mês, fim de fevereiro, 1º de janeiro, domingo, virada do dia em Brasília.
- **TST-07** Teste que cria pasta temporária usa o prefixo `ps-teste-` e apaga no fim (`finally`); restos com mais de 2 h são apagados pelo hook `limpar-restos-teste.js`.
- **TST-08** Simuladores (`testes/simuladores/`) seguem a mesma interface das integrações reais; integração real nova → simulador com a mesma interface e um teste do simulador.
