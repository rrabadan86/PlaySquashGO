const { test } = require('node:test');
const assert = require('node:assert/strict');
const { NOVIDADES, paraUsuario } = require('../../src/painel/novidades');

test('DEP-05 professor não vê as novidades só de administrador; a lista vem da mais nova para a mais velha', () => {
  const prof = paraUsuario({ eh_admin: false });
  const admin = paraUsuario({ eh_admin: true });
  assert.ok(prof.length > 0 && prof.every(n => n.para === 'todos'));
  assert.equal(admin.length, NOVIDADES.length);
  const datas = NOVIDADES.map(n => n.data);
  assert.deepEqual(datas, [...datas].sort().reverse());
  for (const n of NOVIDADES) assert.match(n.data, /^\d{4}-\d{2}-\d{2}$/);
});
