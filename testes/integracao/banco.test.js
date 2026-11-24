/**
 * Integração com PostgreSQL de TESTE (TST-01): o esquema é apagado e recriado.
 * Sem DATABASE_URL_TESTE os testes são pulados.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { aplicar } = require('../../scripts/migrar');

const URL = process.env.DATABASE_URL_TESTE;
const opc = { skip: URL ? false : 'sem DATABASE_URL_TESTE' };
let db;

before(async () => {
  if (!URL) return;
  const { Client } = require('pg');
  db = new Client({ connectionString: URL });
  await db.connect();
  await db.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  await aplicar(db);
});
after(async () => { if (db) await db.end(); });

async function base() {
  const u = await db.query(`INSERT INTO usuario (nome, email, eh_admin, eh_professor) VALUES ('Prof', $1, true, true) RETURNING id`, [`p${Date.now()}${Math.random()}@teste`]);
  const q = await db.query(`INSERT INTO quadra (nome) VALUES ('Quadra 1') RETURNING id`);
  const t = await db.query(`INSERT INTO tipo_aula (nome, categoria) VALUES ('Individual','individual') RETURNING id`);
  return { prof: u.rows[0].id, quadra: q.rows[0].id, tipo: t.rows[0].id };
}

test('DAD-08 migrações aplicam do zero e não reaplicam', opc, async () => {
  assert.deepEqual(await aplicar(db), []);
  const r = await db.query(`SELECT valor FROM regra_config WHERE chave = 'reposicao.validade_dias'`);
  assert.equal(r.rows[0].valor, 7);
});

test('SOF-05 duas aulas ativas na mesma quadra e horário são recusadas pelo banco', opc, async () => {
  const b = await base();
  const ins = `INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem)
               VALUES ($1,$2,$3,tstzrange('2026-12-01 18:00-03','2026-12-01 18:30-03'),'experimental') RETURNING id`;
  const a1 = await db.query(ins, [b.quadra, b.prof, b.tipo]);
  await assert.rejects(db.query(ins, [b.quadra, b.prof, b.tipo]), /conflicting key|exclusion/);
  // cancelada libera o horário
  await db.query(`UPDATE aula SET situacao = 'cancelada', cancelada_motivo = 'não vai' WHERE id = $1`, [a1.rows[0].id]);
  await db.query(ins, [b.quadra, b.prof, b.tipo]);
});

test('AGD-04 aula de 60 min bloqueia o meio-horário seguinte na mesma quadra', opc, async () => {
  const b = await base();
  await db.query(`INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem)
                  VALUES ($1,$2,$3,tstzrange('2026-12-02 17:30-03','2026-12-02 18:30-03'),'fixa')`, [b.quadra, b.prof, b.tipo]);
  await assert.rejects(db.query(`INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem)
                  VALUES ($1,$2,$3,tstzrange('2026-12-02 18:00-03','2026-12-02 18:30-03'),'reposicao')`, [b.quadra, b.prof, b.tipo]), /conflicting key|exclusion/);
});

test('OPR-07 histórico só recebe inclusões: alterar e apagar são barrados', opc, async () => {
  const h = await db.query(`INSERT INTO historico (ator_tipo, origem, acao, entidade, entidade_id, antes, depois, motivo)
    VALUES ('admin','painel','regra.alterada','regra_config',NULL,'{"valor":180}','{"valor":240}','teste') RETURNING id`);
  await assert.rejects(db.query(`UPDATE historico SET motivo = 'x' WHERE id = $1`, [h.rows[0].id]), /DAD-04/);
  await assert.rejects(db.query(`DELETE FROM historico WHERE id = $1`, [h.rows[0].id]), /DAD-04/);
  await assert.rejects(db.query(`TRUNCATE historico`), /DAD-04/);
});

test('DAD-03 aula não pode ser apagada (trava vale para todas as tabelas principais)', opc, async () => {
  const b = await base();
  const a = await db.query(`INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem)
    VALUES ($1,$2,$3,tstzrange('2026-12-03 07:00-03','2026-12-03 07:30-03'),'avulsa') RETURNING id`, [b.quadra, b.prof, b.tipo]);
  await assert.rejects(db.query(`DELETE FROM aula WHERE id = $1`, [a.rows[0].id]), /DAD-03/);
});

test('DAD-06 regra configurável muda por nova versão, nunca editando a antiga', opc, async () => {
  await assert.rejects(db.query(`UPDATE regra_config SET valor = '240' WHERE chave = 'reposicao.antecedencia_min'`), /DAD-04/);
  await db.query(`INSERT INTO regra_config (chave, valor, vigente_desde) VALUES ('reposicao.antecedencia_min','240', now() + interval '1 second')`);
  const r = await db.query(`SELECT count(*)::int n FROM regra_config WHERE chave = 'reposicao.antecedencia_min'`);
  assert.equal(r.rows[0].n, 2);
});

test('REP-04 um só crédito por desmarcação (banco recusa o segundo)', opc, async () => {
  const b = await base();
  const c = await db.query(`INSERT INTO contato (nome, telefone, tipo) VALUES ('Aluno', $1, 'aluno') RETURNING id`, [`+55629${Date.now() % 100000000}`]);
  const al = await db.query(`INSERT INTO aluno (contato_id) VALUES ($1) RETURNING id`, [c.rows[0].id]);
  const a = await db.query(`INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem)
    VALUES ($1,$2,$3,tstzrange('2026-12-04 07:00-03','2026-12-04 07:30-03'),'fixa') RETURNING id`, [b.quadra, b.prof, b.tipo]);
  const ins = `INSERT INTO credito_reposicao (aluno_id, aula_origem_id, motivo, valido_ate) VALUES ($1,$2,'aluno','2026-12-11')`;
  await db.query(ins, [al.rows[0].id, a.rows[0].id]);
  await assert.rejects(db.query(ins, [al.rows[0].id, a.rows[0].id]), /duplicate key/);
});
