/**
 * Dados de demonstração (DEP-09) no banco de TESTE.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URL_TESTE, prepararBanco } = require('../ajuda');
const { gerarDemo } = require('../../scripts/demo');
const { tx } = require('../../src/db');

const opc = { skip: URL_TESTE ? false : 'sem DATABASE_URL_TESTE' };
let pool;
before(async () => { if (URL_TESTE) pool = await prepararBanco(); });
after(async () => { if (pool) await pool.end(); });

test('DEP-09 demonstração entra em banco vazio, com nomes fictícios e e-mails .invalid, e é recusada se já houver dados', opc, async () => {
  const r = await tx(pool, c => gerarDemo(c, { senhaDemo: 'demo-senha-123', hoje: '2026-12-02' }));
  assert.ok(r.aulas > 40, `aulas: ${r.aulas}`);
  const emails = (await pool.query('SELECT email FROM usuario')).rows.map(x => x.email);
  assert.ok(emails.every(e => e.endsWith('@playsquash-demo.invalid')));
  const sobrepostas = await pool.query(`SELECT count(*)::int n FROM aula a JOIN aula b ON a.id < b.id AND a.quadra_id = b.quadra_id
    AND a.periodo && b.periodo AND a.situacao <> 'cancelada' AND b.situacao <> 'cancelada'`);
  assert.equal(sobrepostas.rows[0].n, 0);
  assert.ok((await pool.query(`SELECT count(*)::int n FROM aula WHERE origem = 'experimental'`)).rows[0].n > 0);
  const antes = (await pool.query('SELECT count(*)::int n FROM aula')).rows[0].n;
  await assert.rejects(tx(pool, c => gerarDemo(c, { senhaDemo: 'demo-senha-123' })), /banco vazio/);
  assert.equal((await pool.query('SELECT count(*)::int n FROM aula')).rows[0].n, antes);
});
