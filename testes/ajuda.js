/**
 * Ajuda dos testes de integração e de tela (TST-01): banco de TESTE zerado + painel numa porta livre.
 */
const { Pool } = require('pg');
require('../src/db'); // ids bigint como número (mesma regra do painel)
const { aplicar } = require('../scripts/migrar');
const { criarServidor } = require('../src/servidor');
const senha = require('../src/auth/senha');

const URL_TESTE = process.env.DATABASE_URL_TESTE;
const SEGREDO = 'segredo-de-teste-'.padEnd(48, 'x');
const SENHA = 'senha-de-teste-1';

async function prepararBanco() {
  const pool = new Pool({ connectionString: URL_TESTE, max: 5 });
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
  const c = await pool.connect();
  try { await aplicar(c); } finally { c.release(); }
  return pool;
}

async function criarUsuario(pool, { nome, email, admin = false, professor = true, telas = ['grade'] }) {
  const { rows } = await pool.query(
    'INSERT INTO usuario (nome, email, eh_admin, eh_professor, senha_hash) VALUES ($1,$2,$3,$4,$5) RETURNING id',
    [nome, email, admin, professor, senha.gerarHash(SENHA)]);
  for (const t of telas) await pool.query('INSERT INTO usuario_tela VALUES ($1,$2)', [rows[0].id, t]);
  return rows[0].id;
}

async function subirPainel(pool) {
  const srv = criarServidor({ pool, segredo: SEGREDO, log: { error: () => {} } });
  await new Promise(ok => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  return { srv, base, fechar: () => new Promise(ok => srv.close(ok)) };
}

// Formulário com campos repetidos (ex.: dias=2&dias=4), como o navegador envia.
function corpoForm(form) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(form)) for (const x of [].concat(v)) p.append(k, String(x));
  return p.toString();
}

// Cliente HTTP com cookie e Origin do próprio painel.
function cliente(base) {
  let cookie = '';
  async function req(metodo, caminho, form) {
    const r = await fetch(base + caminho, {
      method: metodo, redirect: 'manual',
      headers: { cookie, origin: base, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
      body: form ? corpoForm(form) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, local: r.headers.get('location') || '', texto: await r.text() };
  }
  return {
    get: c => req('GET', c),
    post: (c, form) => req('POST', c, form),
    entrar: email => req('POST', '/login', { email, senha: SENHA }),
    get cookie() { return cookie; },
  };
}

module.exports = { URL_TESTE, SEGREDO, SENHA, prepararBanco, criarUsuario, subirPainel, cliente };
