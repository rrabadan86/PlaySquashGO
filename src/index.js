#!/usr/bin/env node
/**
 * Sobe o painel.  DATABASE_URL=... PAINEL_SEGREDO=... PORTA=3000 node src/index.js
 */
const { criarPool } = require('./db');
const { aplicar } = require('../scripts/migrar');
const { criarServidor } = require('./servidor');

async function main() {
  const pool = criarPool();
  const c = await pool.connect();
  try { const a = await aplicar(c); if (a.length) console.log(`Migrações aplicadas: ${a.join(', ')}`); } finally { c.release(); }
  const porta = Number(process.env.PORTA || 3000);
  criarServidor({ pool, segredo: process.env.PAINEL_SEGREDO || '' }).listen(porta, () => console.log(`Painel em http://localhost:${porta}`));
}

main().catch(e => { console.error(e.message); process.exit(1); });
