/**
 * Conexão com o PostgreSQL. Uma transação por ação que muda dados: o que muda e o
 * registro no histórico entram juntos ou não entram (DAD-04, OPR-07).
 */
const { Pool, types } = require('pg');

// bigint (ids, contagens) como número: os ids da Play Squash cabem com folga em Number.
types.setTypeParser(20, v => (v == null ? v : Number(v)));

function criarPool(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('Defina DATABASE_URL.');
  return new Pool({ connectionString: url, max: 10 });
}

async function tx(pool, fn) {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}

module.exports = { criarPool, tx };
