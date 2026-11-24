const { test } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const { montar, codigosDoTitulo } = require('../../scripts/matriz');

test('TST-02 título de teste: códigos no começo, um ou vários', () => {
  assert.deepEqual(codigosDoTitulo('REP-03 validade'), ['REP-03']);
  assert.deepEqual(codigosDoTitulo('REP-01/REP-02 prazo'), ['REP-01', 'REP-02']);
  assert.deepEqual(codigosDoTitulo('CON-01a plano'), ['CON-01a']);
  assert.deepEqual(codigosDoTitulo('sem código'), []);
});

test('TST-02 nenhum teste ou caso cita código que não existe nas regras', () => {
  assert.deepEqual(montar().erros, []);
});

test('TST-02 a matriz docs/rastreabilidade.md está em dia', () => {
  execFileSync(process.execPath, [path.join(__dirname, '..', '..', 'scripts', 'matriz.js'), '--conferir'], { stdio: 'pipe' });
});
