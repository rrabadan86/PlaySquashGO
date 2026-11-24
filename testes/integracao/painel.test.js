/**
 * Painel de ponta a ponta com banco de TESTE (TST-01). Sem DATABASE_URL_TESTE, pula.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URL_TESTE, prepararBanco, criarUsuario, subirPainel, cliente } = require('../ajuda');

const opc = { skip: URL_TESTE ? false : 'sem DATABASE_URL_TESTE' };
let pool, painel, admin, prof;
// 01/12/2026 é terça-feira.
const TERCA = '2026-12-01';

before(async () => {
  if (!URL_TESTE) return;
  pool = await prepararBanco();
  await criarUsuario(pool, { nome: 'Guilherme', email: 'admin@teste.local', admin: true, professor: true, telas: [] });
  await criarUsuario(pool, { nome: 'Francisco', email: 'prof@teste.local', professor: true, telas: ['grade'] });
  painel = await subirPainel(pool);
  admin = cliente(painel.base);
  prof = cliente(painel.base);
  assert.equal((await admin.entrar('admin@teste.local')).status, 303);
  assert.equal((await prof.entrar('prof@teste.local')).status, 303);
});
after(async () => { if (painel) await painel.fechar(); if (pool) await pool.end(); });

const historico = async acao => (await pool.query('SELECT * FROM historico WHERE acao = $1 ORDER BY id', [acao])).rows;

test('PER-03 sem login a tela manda para o login e senha errada é recusada', opc, async () => {
  const anon = cliente(painel.base);
  const r = await anon.get('/grade');
  assert.equal(r.status, 302);
  assert.equal(r.local, '/login');
  assert.equal((await anon.post('/login', { email: 'admin@teste.local', senha: 'errada-123' })).status, 401);
});

test('PER-03 envio sem origem do próprio painel é recusado', opc, async () => {
  const r = await fetch(painel.base + '/cadastros/quadra', {
    method: 'POST', redirect: 'manual',
    headers: { cookie: admin.cookie, origin: 'https://outro-site.com', 'content-type': 'application/x-www-form-urlencoded' },
    body: 'nome=Invasora',
  });
  assert.equal(r.status, 403);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM quadra WHERE nome = 'Invasora'`)).rows[0].n, 0);
});

test('PER-01 administrador e professor ao mesmo tempo vê o painel completo', opc, async () => {
  for (const tela of ['/grade', '/cadastros', '/usuarios', '/historico']) assert.equal((await admin.get(tela)).status, 200, tela);
  const g = await admin.get('/grade');
  assert.match(g.texto, /Usuários/);
});

test('PER-02 professor vê só as telas liberadas; o menu não mostra o resto', opc, async () => {
  const g = await prof.get('/grade');
  assert.equal(g.status, 200);
  assert.doesNotMatch(g.texto, /href="\/usuarios"/);
  for (const tela of ['/cadastros', '/usuarios', '/historico']) assert.equal((await prof.get(tela)).status, 403, tela);
});

test('AGD-01 admin cadastra quadra, tipo de aula e faixa da grade, e a grade do dia mostra o horário livre', opc, async () => {
  assert.equal((await admin.post('/cadastros/quadra', { nome: 'Quadra 1' })).status, 303);
  assert.equal((await admin.post('/cadastros/tipo', { nome: 'Individual', categoria: 'individual', duracao_min: '30', alunos_por_aula: '1' })).status, 303);
  const q = (await pool.query(`SELECT id FROM quadra WHERE nome = 'Quadra 1'`)).rows[0].id;
  const t = (await pool.query(`SELECT id FROM tipo_aula WHERE nome = 'Individual'`)).rows[0].id;
  const f = (await pool.query(`SELECT id FROM usuario WHERE email = 'prof@teste.local'`)).rows[0].id;
  const r = await admin.post('/cadastros/faixa', { quadra_id: q, dias: ['2', '4'], inicio: '17:00', fim: '19:00', professor_id: f, tipos: t, vigente_desde: '2026-11-01' });
  assert.match(decodeURIComponent(r.local), /2 faixa\(s\) adicionada/);
  const g = await admin.get(`/grade?data=${TERCA}`);
  assert.match(g.texto, /Quadra 1/);
  assert.equal((g.texto.match(/<b>Livre<\/b>/g) || []).length, 4);
  assert.match(g.texto, /Francisco/);
});

test('AGD-02 professor não altera a grade nem com a tela de cadastros liberada (servidor recusa)', opc, async () => {
  const f = (await pool.query(`SELECT id FROM usuario WHERE email = 'prof@teste.local'`)).rows[0].id;
  await pool.query(`INSERT INTO usuario_tela VALUES ($1,'cadastros')`, [f]);
  assert.equal((await prof.get('/cadastros')).status, 200);
  assert.doesNotMatch((await prof.get('/cadastros')).texto, /action="\/cadastros\/quadra"/);
  assert.equal((await prof.post('/cadastros/quadra', { nome: 'Quadra do professor' })).status, 403);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM quadra WHERE nome = 'Quadra do professor'`)).rows[0].n, 0);
  await pool.query(`DELETE FROM usuario_tela WHERE usuario_id = $1 AND tela = 'cadastros'`, [f]);
});

test('AGD-05 professor não pode ter duas faixas no mesmo horário em quadras diferentes', opc, async () => {
  await admin.post('/cadastros/quadra', { nome: 'Quadra 2' });
  const q2 = (await pool.query(`SELECT id FROM quadra WHERE nome = 'Quadra 2'`)).rows[0].id;
  const t = (await pool.query(`SELECT id FROM tipo_aula LIMIT 1`)).rows[0].id;
  const f = (await pool.query(`SELECT id FROM usuario WHERE email = 'prof@teste.local'`)).rows[0].id;
  const r = await admin.post('/cadastros/faixa', { quadra_id: q2, dias: '2', inicio: '18:00', fim: '20:00', professor_id: f, tipos: t, vigente_desde: '2026-11-01' });
  assert.match(decodeURIComponent(r.local), /erro=.*já tem faixa/);
});

test('AGD-07 trocar o professor da faixa mantém a faixa (e os alunos) e fica no histórico', opc, async () => {
  const faixa = (await pool.query(`SELECT id FROM grade_faixa WHERE dia_semana = 2`)).rows[0].id;
  const g = (await pool.query(`SELECT id FROM usuario WHERE email = 'admin@teste.local'`)).rows[0].id;
  await admin.post(`/cadastros/faixa/${faixa}/professor`, { professor_id: g });
  const depois = (await pool.query('SELECT professor_id, quadra_id, inicio FROM grade_faixa WHERE id = $1', [faixa])).rows[0];
  assert.equal(depois.professor_id, g);
  const h = await historico('grade.professor_trocado');
  assert.equal(h.length, 1);
  assert.equal(h[0].ator_tipo, 'admin');
});

test('AGD-03 feriado tira o dia da grade e bloqueio aparece como bloqueado', opc, async () => {
  await admin.post('/cadastros/bloqueio', { de: `${TERCA}T17:00`, ate: `${TERCA}T18:00`, quadra_id: '', professor_id: '', motivo: 'Manutenção' });
  const g = await admin.get(`/grade?data=${TERCA}`);
  assert.equal((g.texto.match(/<b>Bloqueado<\/b>/g) || []).length, 2);
  await admin.post('/cadastros/feriado', { data: '2026-12-03', nome: 'Feriado de teste', abrangencia: 'municipal' });
  const qui = await admin.get('/grade?data=2026-12-03');
  assert.match(qui.texto, /Feriado de teste/);
  assert.doesNotMatch(qui.texto, /<b>Livre<\/b>/);
});

test('OPR-07 cada mudança no painel grava quem fez, quando, antes e depois', opc, async () => {
  const h = (await pool.query(`SELECT acao, ator_tipo, origem, depois FROM historico WHERE ator_tipo = 'admin' ORDER BY id`)).rows;
  const acoes = h.map(x => x.acao);
  for (const a of ['quadra.criada', 'tipo_aula.criado', 'grade.faixa_criada', 'bloqueio.criado', 'feriado.criado']) assert.ok(acoes.includes(a), a);
  assert.ok(h.every(x => x.origem === 'painel'));
  assert.equal((await admin.get('/historico')).status, 200);
});

test('PER-01 administrador não pode tirar o próprio acesso de admin', opc, async () => {
  const g = (await pool.query(`SELECT id FROM usuario WHERE email = 'admin@teste.local'`)).rows[0].id;
  const r = await admin.post(`/usuarios/${g}`, { eh_professor: '1', ativo: '1' });
  assert.match(decodeURIComponent(r.local), /erro=.*próprio acesso/);
  assert.equal((await pool.query('SELECT eh_admin FROM usuario WHERE id = $1', [g])).rows[0].eh_admin, true);
});

test('PER-03 sessão encerrada pelo admin ou usuário desativado perde o acesso na hora', opc, async () => {
  const f = (await pool.query(`SELECT id FROM usuario WHERE email = 'prof@teste.local'`)).rows[0].id;
  assert.equal((await prof.get('/grade')).status, 200);
  await admin.post(`/usuarios/${f}/encerrar-sessoes`, {});
  assert.equal((await prof.get('/grade')).status, 302);
  assert.equal((await prof.entrar('prof@teste.local')).status, 303);
  await admin.post(`/usuarios/${f}`, { eh_professor: '1', telas: 'grade' }); // sem "ativo"
  assert.equal((await prof.get('/grade')).status, 302);
  assert.equal((await prof.entrar('prof@teste.local')).status, 401);
});
