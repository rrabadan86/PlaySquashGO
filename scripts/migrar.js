#!/usr/bin/env node
/**
 * Aplica as migrações de db/migrations/ em ordem, uma vez cada (DAD-08).
 *
 *   DATABASE_URL=postgres://... node scripts/migrar.js
 *
 * Também é usado pelos testes de integração (aplicar(cliente)).
 */
const fs = require('fs');
const path = require('path');

const PASTA = path.join(__dirname, '..', 'db', 'migrations');

function migracoes() {
  return fs.readdirSync(PASTA).filter(f => /^\d{4}_.+\.sql$/.test(f)).sort();
}

async function aplicar(cliente) {
  await cliente.query(`CREATE TABLE IF NOT EXISTS schema_migracao (
    nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
  const { rows } = await cliente.query('SELECT nome FROM schema_migracao');
  const feitas = new Set(rows.map(r => r.nome));
  const aplicadas = [];
  for (const nome of migracoes()) {
    if (feitas.has(nome)) continue;
    const sql = fs.readFileSync(path.join(PASTA, nome), 'utf8');
    await cliente.query('BEGIN');
    try {
      await cliente.query(sql);
      await cliente.query('INSERT INTO schema_migracao (nome) VALUES ($1)', [nome]);
      await cliente.query('COMMIT');
      aplicadas.push(nome);
    } catch (e) {
      await cliente.query('ROLLBACK');
      throw new Error(`migração ${nome} falhou: ${e.message}`);
    }
  }
  return aplicadas;
}

if (require.main === module) {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error('Defina DATABASE_URL.'); process.exit(1); }
  const { Client } = require('pg');
  const c = new Client({ connectionString: url });
  c.connect()
    .then(() => aplicar(c))
    .then(a => console.log(a.length ? `Aplicadas: ${a.join(', ')}` : 'Nada a aplicar.'))
    .catch(e => { console.error(e.message); process.exitCode = 1; })
    .finally(() => c.end());
}

module.exports = { aplicar, migracoes };
