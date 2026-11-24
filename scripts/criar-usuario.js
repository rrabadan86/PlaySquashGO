#!/usr/bin/env node
/**
 * Cria o primeiro administrador (ou outro usuário) direto no banco. A senha vem da variável
 * SENHA_NOVA, para não ficar no histórico do terminal nem no Git (DAD-01).
 *
 *   DATABASE_URL=... SENHA_NOVA='...' node scripts/criar-usuario.js --nome "Guilherme" --email g@exemplo.com --admin --professor
 */
const { criarPool, tx } = require('../src/db');
const { aplicar } = require('./migrar');
const senha = require('../src/auth/senha');
const { registrar } = require('../src/historico');

function arg(nome) { const i = process.argv.indexOf(`--${nome}`); return i > 0 ? process.argv[i + 1] : undefined; }
const flag = nome => process.argv.includes(`--${nome}`);

async function main() {
  const nome = arg('nome'), email = String(arg('email') || '').toLowerCase();
  const admin = flag('admin'), prof = flag('professor');
  if (!nome || !email || (!admin && !prof)) throw new Error('Use: --nome "Nome" --email e@x.com [--admin] [--professor]');
  if (!senha.senhaValida(process.env.SENHA_NOVA)) throw new Error(`Defina SENHA_NOVA com pelo menos ${senha.MINIMO} caracteres.`);
  const pool = criarPool();
  try {
    const c0 = await pool.connect(); try { await aplicar(c0); } finally { c0.release(); }
    const id = await tx(pool, async c => {
      const { rows } = await c.query(
        'INSERT INTO usuario (nome, email, eh_admin, eh_professor, senha_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [nome, email, admin, prof, senha.gerarHash(process.env.SENHA_NOVA)]);
      if (prof && !admin) await c.query(`INSERT INTO usuario_tela VALUES ($1,'grade')`, [rows[0].id]);
      await registrar(c, { ator: { tipo: 'sistema', id: null }, origem: 'sistema', acao: 'usuario.criado', entidade: 'usuario', entidadeId: rows[0].id, depois: { nome, email, admin, prof }, motivo: 'criado pelo terminal' });
      return rows[0].id;
    });
    console.log(`Usuário ${nome} criado (id ${id}).`);
  } finally { await pool.end(); }
}

main().catch(e => { console.error(e.message); process.exit(1); });
