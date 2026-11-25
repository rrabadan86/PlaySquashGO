/**
 * App do aluno com banco de TESTE e o servidor de verdade (TST-01). "Agora": terça,
 * 01/12/2026, 09:00 em Brasília (TST-06).
 */
process.env.PS_AGORA = '2026-12-01T09:00:00-03:00';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URL_TESTE, prepararBanco, criarUsuario, subirPainel, cliente } = require('../ajuda');
const { gerarAulasFixas } = require('../../src/agenda/aulas-fixas');
const { vencerCreditos } = require('../../src/agenda/reposicao');
const { tx } = require('../../src/db');

const opc = { skip: URL_TESTE ? false : 'sem DATABASE_URL_TESTE' };
const silencioso = { error() {}, log() {} };
let pool, painel, profId, q1, tIndiv, tDupla, planoIndiv, planoDupla;
const um = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const todos = async (sql, p = []) => (await pool.query(sql, p)).rows;
const txt = r => decodeURIComponent(r.local || '');

async function aluno(nome, tel, { resp = null } = {}) {
  const ct = (await um(`INSERT INTO contato (nome, telefone, tipo) VALUES ($1,$2,'aluno') RETURNING id`, [nome, tel])).id;
  return (await um('INSERT INTO aluno (contato_id, responsavel_contato_id) VALUES ($1,$2) RETURNING id', [ct, resp])).id;
}
async function contrato(alunoId, plano, horarios) {
  const k = (await um(`INSERT INTO contrato (aluno_id, plano_id, plano_retrato, regras_retrato, inicio, fim, valor_mensal, forma, parcelas, dia_vencimento)
    VALUES ($1,$2,'{}','{}','2026-12-01','2027-02-28',300,'parcelado',3,10) RETURNING id`, [alunoId, plano])).id;
  for (const [dia, hora] of horarios) await pool.query(`INSERT INTO horario_fixo (contrato_id, quadra_id, dia_semana, hora, desde) VALUES ($1,$2,$3,$4,'2026-12-01')`, [k, q1, dia, hora]);
  await gerarAulasFixas({ pool, contratoId: k, log: silencioso });
  return k;
}
// Entra no app pelo código que foi para a fila do WhatsApp.
async function entrarNoApp(tel) {
  const app = cliente(painel.base);
  const r = await app.post('/app/entrar', { telefone: tel });
  assert.match(r.local, /^\/app\/codigo\?t=/);
  const f = await um(`SELECT texto FROM fila_envio WHERE chave_unica LIKE 'app-codigo:%' ORDER BY id DESC LIMIT 1`);
  const codigo = /(\d{6})/.exec(f.texto)[1];
  const r2 = await app.post('/app/codigo', { t: tel.replace(/\D/g, ''), codigo });
  assert.equal(r2.local, '/app');
  return { app, codigo };
}
const pid = async (contatoTel, dataHora) => (await um(
  `SELECT p.id FROM aula_participante p JOIN aula a ON a.id = p.aula_id JOIN contato c ON c.id = p.contato_id
    WHERE c.telefone = $1 AND lower(a.periodo) = $2::timestamptz`, [contatoTel, dataHora])).id;

before(async () => {
  if (!URL_TESTE) return;
  pool = await prepararBanco();
  profId = await criarUsuario(pool, { nome: 'Carla', email: 'prof-app@teste.local' });
  await pool.query(`UPDATE usuario SET telefone = '+5562977770002' WHERE id = $1`, [profId]);
  q1 = (await um(`INSERT INTO quadra (nome) VALUES ('Quadra 1') RETURNING id`)).id;
  tIndiv = (await um(`INSERT INTO tipo_aula (nome, categoria, duracao_min, alunos_por_aula) VALUES ('Individual','individual',60,1) RETURNING id`)).id;
  tDupla = (await um(`INSERT INTO tipo_aula (nome, categoria, duracao_min, alunos_por_aula) VALUES ('Dupla','dupla',60,2) RETURNING id`)).id;
  for (const dia of [2, 3, 4]) {
    const f = await um(`INSERT INTO grade_faixa (quadra_id, dia_semana, inicio, fim, professor_id, vigente_desde) VALUES ($1,$2,'08:00','21:00',$3,'2026-11-01') RETURNING id`, [q1, dia, profId]);
    for (const t of [tIndiv, tDupla]) await pool.query('INSERT INTO grade_faixa_tipo VALUES ($1,$2)', [f.id, t]);
  }
  planoIndiv = (await um(`INSERT INTO plano (nome, tipo_aula_id, aulas_semana, vigencia_meses) VALUES ('Indiv',$1,1,3) RETURNING id`, [tIndiv])).id;
  planoDupla = (await um(`INSERT INTO plano (nome, tipo_aula_id, aulas_semana, vigencia_meses) VALUES ('Dupla',$1,1,3) RETURNING id`, [tDupla])).id;
  painel = await subirPainel(pool);
});
after(async () => { if (painel) await painel.fechar(); if (pool) await pool.end(); });

test('APP-01 código de uso único pelo WhatsApp: vale uma vez, vence, limita tentativas e não revela quem é aluno', opc, async () => {
  await contrato(await aluno('Lia Login', '+5562988880001'), planoIndiv, [[2, '18:00']]);
  const anon = cliente(painel.base);
  assert.equal((await anon.get('/app')).local, '/app/entrar');
  // Telefone que não é de aluno: mesma resposta, nenhum código enviado.
  const antes = (await um(`SELECT count(*)::int n FROM fila_envio WHERE chave_unica LIKE 'app-codigo:%'`)).n;
  assert.match((await anon.post('/app/entrar', { telefone: '62 98888-9999' })).local, /^\/app\/codigo/);
  assert.equal((await um(`SELECT count(*)::int n FROM fila_envio WHERE chave_unica LIKE 'app-codigo:%'`)).n, antes);
  // Aluno: entra (sem o 9 também funciona, OPR-11), e o código não vale de novo.
  const { app, codigo } = await entrarNoApp('(62) 8888-0001');
  assert.match((await app.get('/app')).texto, /Minhas aulas/);
  const outro = cliente(painel.base);
  assert.match(txt(await outro.post('/app/codigo', { t: '5562988880001', codigo })), /vencido/);
  assert.equal((await um(`SELECT codigo_hash FROM app_codigo ORDER BY id DESC LIMIT 1`)).codigo_hash.length, 64, 'só o hash fica no banco');
  // Código vencido.
  await outro.post('/app/entrar', { telefone: '62988880001' });
  await pool.query(`UPDATE app_codigo SET expira_em = now() - interval '1 minute' WHERE usado_em IS NULL`);
  const f = await um(`SELECT texto FROM fila_envio WHERE chave_unica LIKE 'app-codigo:%' ORDER BY id DESC LIMIT 1`);
  assert.match(txt(await outro.post('/app/codigo', { t: '5562988880001', codigo: /(\d{6})/.exec(f.texto)[1] })), /vencido/);
  // Tentativas: na 5ª errada, o código morre.
  await outro.post('/app/entrar', { telefone: '62988880001' });
  for (let i = 0; i < 4; i++) assert.match(txt(await outro.post('/app/codigo', { t: '5562988880001', codigo: '000000' })), /errado/);
  assert.match(txt(await outro.post('/app/codigo', { t: '5562988880001', codigo: '000000' })), /muitas vezes/);
  // Limite: 3 códigos por hora (este já é o 4º pedido).
  const n = (await um(`SELECT count(*)::int n FROM app_codigo WHERE telefone = '+5562988880001'`)).n;
  await outro.post('/app/entrar', { telefone: '62988880001' });
  assert.equal((await um(`SELECT count(*)::int n FROM app_codigo WHERE telefone = '+5562988880001'`)).n, n);
  // Sair revoga a sessão.
  await app.post('/app/sair', {});
  assert.equal((await app.get('/app')).local, '/app/entrar');
});

test('APP-02 responsável com dois filhos troca o aluno no seletor e vê as aulas de cada um', opc, async () => {
  const resp = (await um(`INSERT INTO contato (nome, telefone, tipo) VALUES ('Mãe Kids','+5562988880002','responsavel') RETURNING id`)).id;
  const a1 = await aluno('Pedro Kids', null, { resp });
  const a2 = await aluno('Lara Kids', null, { resp });
  await contrato(a1, planoIndiv, [[3, '08:00']]);
  await contrato(a2, planoIndiv, [[3, '09:00']]);
  const { app } = await entrarNoApp('62988880002');
  const t1 = (await app.get('/app')).texto;
  assert.match(t1, /Lara Kids/);
  assert.match(t1, /Pedro Kids/);
  assert.match(t1, /Olá, Lara/);
  assert.match(t1, /às 09:00/);
  assert.doesNotMatch(t1, /às 08:00/);
  await app.post('/app/aluno', { aluno: a1 });
  const t2 = (await app.get('/app')).texto;
  assert.match(t2, /Olá, Pedro/);
  assert.match(t2, /às 08:00/);
  // Aluno de outro telefone não pode ser escolhido.
  await app.post('/app/aluno', { aluno: 999999 });
  assert.match((await app.get('/app')).texto, /Olá, Pedro/);
});

test('REP-01 REP-03 REP-07 desmarcar com 3 h ou mais gera crédito até a data da aula + 7 dias e avisa o professor', opc, async () => {
  await contrato(await aluno('Rui Desmarca', '+5562988880003'), planoIndiv, [[2, '19:00']]);
  const { app } = await entrarNoApp('62988880003');
  const p = await pid('+5562988880003', '2026-12-08 19:00-03');
  assert.match((await app.get(`/app/aulas/${p}/desmarcar`)).texto, /crédito de reposição.*15\/12\/2026/);
  assert.match(txt(await app.post(`/app/aulas/${p}/desmarcar`, {})), /Crédito válido até 15\/12\/2026/);
  const cr = await um(`SELECT * FROM credito_reposicao WHERE aula_origem_id = (SELECT aula_id FROM aula_participante WHERE id = $1)`, [p]);
  assert.equal(cr.valido_ate.toISOString().slice(0, 10), '2026-12-15');
  assert.equal(cr.motivo, 'aluno');
  const aula = await um('SELECT a.* FROM aula a JOIN aula_participante p ON p.aula_id = a.id WHERE p.id = $1', [p]);
  assert.equal(aula.situacao, 'cancelada');
  assert.equal((await um(`SELECT count(*)::int n FROM fila_google WHERE aula_id = $1 AND acao = 'apagar'`, [aula.id])).n, 1);
  assert.match((await um(`SELECT texto FROM fila_envio WHERE chave_unica = $1`, [`rep-desm:${p}`])).texto, /Rui Desmarca desmarcou .*com crédito/);
  assert.equal((await um(`SELECT ator_tipo, origem FROM historico WHERE acao = 'aula.desmarcada' AND entidade_id = $1`, [aula.id])).origem, 'app');
  // Desmarcar de novo é recusado.
  assert.match(txt(await app.post(`/app/aulas/${p}/desmarcar`, {})), /já estava desmarcada/);
});

test('REP-02 desmarcar com menos de 3 h conta como dada e não gera crédito', opc, async () => {
  await contrato(await aluno('Ana Tarde', '+5562988880004'), planoIndiv, [[2, '11:00']]);
  const { app } = await entrarNoApp('62988880004');
  const p = await pid('+5562988880004', '2026-12-01 11:00-03');
  assert.match((await app.get(`/app/aulas/${p}/desmarcar`)).texto, /conta como dada/);
  assert.match(txt(await app.post(`/app/aulas/${p}/desmarcar`, {})), /sem crédito/);
  assert.equal((await um(`SELECT count(*)::int n FROM credito_reposicao WHERE aula_origem_id = (SELECT aula_id FROM aula_participante WHERE id = $1)`, [p])).n, 0);
  assert.match((await um('SELECT desmarcado_motivo FROM aula_participante WHERE id = $1', [p])).desmarcado_motivo, /conta como dada/);
});

test('REP-05 REP-04 crédito usado só em horário livre do mesmo tipo e na validade; reposição desmarcada não gera crédito', opc, async () => {
  await contrato(await aluno('Teo Repoe', '+5562988880005'), planoIndiv, [[4, '19:00']]);
  const { app } = await entrarNoApp('62988880005');
  const p = await pid('+5562988880005', '2026-12-03 19:00-03');
  await app.post(`/app/aulas/${p}/desmarcar`, {});
  const cr = await um(`SELECT id FROM credito_reposicao WHERE aluno_id = (SELECT a.id FROM aluno a JOIN contato c ON c.id = a.contato_id WHERE c.telefone = '+5562988880005')`);
  const tela = (await app.get(`/app/reposicoes/${cr.id}`)).texto;
  assert.match(tela, /Individual até 10\/12\/2026/);
  assert.doesNotMatch(tela, /11\/12/, 'nada depois da validade');
  assert.doesNotMatch(tela, /terça, 01\/12 às 1[01]:00/, 'nada dentro das 3 h de antecedência');
  assert.doesNotMatch(tela, /terça, 01\/12 às 18:00/, 'horário ocupado por aula fixa não aparece');
  // Outro aluno não usa este crédito.
  const intruso = (await entrarNoApp('62988880003')).app;
  assert.match(txt(await intruso.post(`/app/reposicoes/${cr.id}`, { horario: `${q1}|${Date.parse('2026-12-02T10:00:00-03:00')}` })), /Crédito não encontrado/);
  const r = await app.post(`/app/reposicoes/${cr.id}`, { horario: `${q1}|${Date.parse('2026-12-02T10:00:00-03:00')}` });
  assert.match(txt(r), /Reposição marcada: quarta, 02\/12 às 10:00/);
  const usado = await um('SELECT * FROM credito_reposicao WHERE id = $1', [cr.id]);
  assert.equal(usado.situacao, 'usado');
  const aula = await um('SELECT * FROM aula WHERE id = $1', [usado.usado_aula_id]);
  assert.equal(aula.origem, 'reposicao');
  assert.match((await um(`SELECT texto FROM fila_envio WHERE chave_unica = $1`, [`rep-usa:${cr.id}`])).texto, /Reposição marcada: Teo Repoe/);
  assert.match(txt(await app.post(`/app/reposicoes/${cr.id}`, { horario: `${q1}|${Date.parse('2026-12-02T11:00:00-03:00')}` })), /não está mais disponível/);
  // REP-04: desmarcar a reposição (no prazo) não gera outro crédito.
  const pr = (await um('SELECT id FROM aula_participante WHERE aula_id = $1', [aula.id])).id;
  assert.match((await app.get(`/app/aulas/${pr}/desmarcar`)).texto, /não gera outro crédito/);
  await app.post(`/app/aulas/${pr}/desmarcar`, {});
  assert.equal((await um(`SELECT count(*)::int n FROM credito_reposicao WHERE aula_origem_id = $1`, [aula.id])).n, 0);
});

test('REP-05 reposição de aluno de dupla fica para o kickoff; REP-03 crédito vencido some da tela', opc, async () => {
  await contrato(await aluno('Duda Dupla', '+5562988880006'), planoDupla, [[3, '19:00']]);
  const { app } = await entrarNoApp('62988880006');
  const p = await pid('+5562988880006', '2026-12-09 19:00-03');
  await app.post(`/app/aulas/${p}/desmarcar`, {});
  const cr = await um(`SELECT id FROM credito_reposicao WHERE aula_origem_id = (SELECT aula_id FROM aula_participante WHERE id = $1)`, [p]);
  assert.match(txt(await app.get(`/app/reposicoes/${cr.id}`)), /dupla ainda vai ser combinada/);
  // Passa a validade: a rotina marca como vencido.
  process.env.PS_AGORA = '2026-12-17T09:00:00-03:00';
  try {
    assert.ok(await tx(pool, c => vencerCreditos(c)) >= 1);
    assert.equal((await um('SELECT situacao FROM credito_reposicao WHERE id = $1', [cr.id])).situacao, 'vencido');
    assert.doesNotMatch((await app.get('/app/reposicoes')).texto, /Usar/);
    assert.match((await app.get('/app/historico')).texto, /Vencido/);
  } finally { process.env.PS_AGORA = '2026-12-01T09:00:00-03:00'; }
});

test('CON-07 APP-03 aluno vê contrato, horários e aceita com data e hora; histórico e telas do app', opc, async () => {
  const a = await aluno('Caio Aceita', '+5562988880007');
  const k = await contrato(a, planoIndiv, [[4, '08:00']]);
  const { app } = await entrarNoApp('62988880007');
  const t = (await app.get('/app/contratos')).texto;
  assert.match(t, /Aguardando seu aceite/);
  assert.match(t, /Quinta 08:00 · Quadra 1/);
  assert.match(t, /R\$\s?300,00 por mês/);
  assert.match(txt(await app.post(`/app/contratos/${k}/aceitar`, {})), /Contrato aceito/);
  const kk = await um('SELECT situacao, aceito_em FROM contrato WHERE id = $1', [k]);
  assert.equal(kk.situacao, 'ativo');
  assert.ok(kk.aceito_em);
  assert.equal((await um(`SELECT ator_tipo FROM historico WHERE acao = 'contrato.aceito' AND entidade_id = $1`, [k])).ator_tipo, 'aluno');
  assert.match(txt(await app.post(`/app/contratos/${k}/aceitar`, {})), /já foi aceito/);
  // Contrato de outro aluno: recusado.
  const outro = await contrato(await aluno('Zeca Outro', '+5562988880008'), planoIndiv, [[4, '09:00']]);
  assert.match(txt(await app.post(`/app/contratos/${outro}/aceitar`, {})), /não encontrado/);
  for (const tela of ['/app/reposicoes', '/app/historico']) assert.equal((await app.get(tela)).status, 200);
});

test('APP-01 app instalável: manifesto, service worker e ícones', opc, async () => {
  const anon = cliente(painel.base);
  const m = JSON.parse((await anon.get('/app/manifest.webmanifest')).texto);
  assert.equal(m.display, 'standalone');
  assert.equal(m.start_url, '/app');
  assert.deepEqual(m.icons.map(i => i.sizes), ['192x192', '512x512']);
  assert.match((await anon.get('/app/sw.js')).texto, /addEventListener\('fetch'/);
  const r = await fetch(painel.base + '/app/icone-512.png');
  const b = Buffer.from(await r.arrayBuffer());
  assert.equal(r.headers.get('content-type'), 'image/png');
  assert.equal(b.readUInt32BE(16), 512);
  // Admin logado no painel também abre o app (sessões separadas).
  const adm = cliente(painel.base);
  await criarUsuario(pool, { nome: 'Adm', email: 'adm-app@teste.local', admin: true });
  await adm.entrar('adm-app@teste.local');
  assert.equal((await adm.get('/app')).local, '/app/entrar');
});
