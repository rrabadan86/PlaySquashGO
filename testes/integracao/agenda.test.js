/**
 * Etapa 1b com banco de TESTE e Google simulado (TST-01): quadra → agenda, compartilhamento,
 * aula pelo painel → evento, cancelamento, Google fora do ar, feriados, anonimização e exportação.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URL_TESTE, prepararBanco, criarUsuario, subirPainel, cliente } = require('../ajuda');
const { criarGoogleFalso } = require('../simuladores/google-falso');
const { processarFila } = require('../../src/agenda/sincronizar');
const { carregarFeriados } = require('../../src/rotinas');
const { tx } = require('../../src/db');

const opc = { skip: URL_TESTE ? false : 'sem DATABASE_URL_TESTE' };
const silencioso = { error: () => {}, log: () => {} };
let pool, painel, admin, prof, google;
let desloc = 0; // avança o relógio da fila sem esperar de verdade
const agora = () => Date.now() + desloc;
const enviar = () => processarFila({ pool, google, agora, log: silencioso });
// Daqui a 30 dias numa terça, para os horários estarem no futuro.
function proximaTerca() {
  const d = new Date(Date.now() + 30 * 86400000);
  while (d.getUTCDay() !== 2) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
const DIA = proximaTerca();

before(async () => {
  if (!URL_TESTE) return;
  pool = await prepararBanco();
  await criarUsuario(pool, { nome: 'Guilherme', email: 'admin@teste.local', admin: true, telas: [] });
  await criarUsuario(pool, { nome: 'Francisco', email: 'prof@teste.local' });
  google = criarGoogleFalso();
  painel = await subirPainel(pool);
  admin = cliente(painel.base);
  prof = cliente(painel.base);
  await admin.entrar('admin@teste.local');
  await prof.entrar('prof@teste.local');
});
after(async () => { if (painel) await painel.fechar(); if (pool) await pool.end(); });

test('AGD-09 quadra nova vira uma agenda no Google, compartilhada só leitura com admin e professores', opc, async () => {
  await admin.post('/cadastros/quadra', { nome: 'Quadra 1' });
  await admin.post('/cadastros/tipo', { nome: 'Individual', categoria: 'individual', duracao_min: '30', alunos_por_aula: '1' });
  await admin.post('/cadastros/tipo', { nome: 'Dupla', categoria: 'dupla', duracao_min: '30', alunos_por_aula: '2' });
  const r = await enviar();
  assert.equal(r.falhas, 0);
  const q = (await pool.query(`SELECT * FROM quadra WHERE nome = 'Quadra 1'`)).rows[0];
  assert.ok(q.google_agenda_id);
  assert.deepEqual(google.acl(q.google_agenda_id), ['admin@teste.local', 'prof@teste.local']);
  assert.equal(google.agendas()[0].nome, 'Play Squash — Quadra 1');
});

test('AGD-09 professor desativado perde o acesso à agenda; novo professor ganha', opc, async () => {
  const q = (await pool.query(`SELECT google_agenda_id FROM quadra WHERE nome = 'Quadra 1'`)).rows[0].google_agenda_id;
  await admin.post('/usuarios/novo', { nome: 'Ana Prof', email: 'ana@teste.local', senha: 'senha-de-teste-1', eh_professor: '1' });
  const f = (await pool.query(`SELECT id FROM usuario WHERE email = 'prof@teste.local'`)).rows[0].id;
  await admin.post(`/usuarios/${f}`, { eh_professor: '1', telas: 'grade' }); // sem "ativo"
  await enviar();
  assert.deepEqual(google.acl(q), ['admin@teste.local', 'ana@teste.local']);
  await admin.post(`/usuarios/${f}`, { eh_professor: '1', ativo: '1', telas: 'grade' });
  await enviar();
  assert.deepEqual(google.acl(q), ['admin@teste.local', 'ana@teste.local', 'prof@teste.local']);
  // A desativação encerrou a sessão dele (PER-03): entra de novo.
  assert.equal((await prof.entrar('prof@teste.local')).status, 303);
});

test('AGD-12 admin marca aula avulsa num horário livre e ela aparece na agenda da quadra certa', opc, async () => {
  const q = (await pool.query(`SELECT id, google_agenda_id FROM quadra WHERE nome = 'Quadra 1'`)).rows[0];
  const ind = (await pool.query(`SELECT id FROM tipo_aula WHERE nome = 'Individual'`)).rows[0].id;
  const dup = (await pool.query(`SELECT id FROM tipo_aula WHERE nome = 'Dupla'`)).rows[0].id;
  const f = (await pool.query(`SELECT id FROM usuario WHERE email = 'prof@teste.local'`)).rows[0].id;
  await admin.post('/cadastros/faixa', { quadra_id: q.id, dias: '2', inicio: '17:00', fim: '19:00', professor_id: f, tipos: [ind, dup], vigente_desde: '2026-01-01' });
  const pag = await admin.get(`/aulas/nova?data=${DIA}&tipo=${ind}`);
  assert.equal((pag.texto.match(/<option value="\d+\|\d+"/g) || []).length, 4);
  const horario = pag.texto.match(/<option value="(\d+\|\d+)"/)[1];
  const r = await admin.post('/aulas', { data: DIA, tipo: ind, horario, origem: 'avulsa', nome: 'Ana Souza', telefone: '(62) 99999-0001' });
  assert.match(decodeURIComponent(r.local), /ok=Aula marcada/);
  await enviar();
  const ev = google.eventos(q.google_agenda_id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].titulo, 'Avulsa — Ana Souza');
  const aula = (await pool.query('SELECT * FROM aula ORDER BY id DESC LIMIT 1')).rows[0];
  assert.equal(aula.google_evento_id, ev[0].id);
  assert.equal(ev[0].privado.aulaId, aula.id);
  assert.match((await admin.get(`/aulas/${aula.id}`)).texto, /No Google Agenda/);
  // O histórico guarda IDs, não o nome nem o telefone (DAD-07).
  const h = (await pool.query(`SELECT depois::text d FROM historico WHERE acao = 'aula.marcada'`)).rows[0].d;
  assert.doesNotMatch(h, /Ana|99999/);
});

test('AGD-12 o mesmo horário não pode ser marcado duas vezes, e professor não marca aula', opc, async () => {
  const ind = (await pool.query(`SELECT id FROM tipo_aula WHERE nome = 'Individual'`)).rows[0].id;
  const aula = (await pool.query(`SELECT quadra_id, extract(epoch FROM lower(periodo))*1000 i FROM aula ORDER BY id DESC LIMIT 1`)).rows[0];
  const r = await admin.post('/aulas', { data: DIA, tipo: ind, horario: `${aula.quadra_id}|${Number(aula.i)}`, origem: 'avulsa', nome: 'Outro' });
  assert.match(decodeURIComponent(r.local), /erro=.*não está mais livre/);
  assert.equal((await prof.post('/aulas', { data: DIA, tipo: ind, horario: `${aula.quadra_id}|${Number(aula.i)}`, origem: 'avulsa', nome: 'X' })).status, 403);
  assert.equal((await prof.get(`/aulas/nova?data=${DIA}`)).status, 403);
});

test('AGD-09 Google fora do ar: o envio fica na fila, tenta de novo depois e chega', opc, async () => {
  const q = (await pool.query(`SELECT google_agenda_id FROM quadra WHERE nome = 'Quadra 1'`)).rows[0].google_agenda_id;
  const dup = (await pool.query(`SELECT id FROM tipo_aula WHERE nome = 'Dupla'`)).rows[0].id;
  const pag = await admin.get(`/aulas/nova?data=${DIA}&tipo=${dup}`);
  const horario = pag.texto.match(/<option value="(\d+\|\d+)"/)[1];
  await admin.post('/aulas', { data: DIA, tipo: dup, horario, origem: 'avulsa', nome: 'Carla' });
  google.falharProximas(1);
  const r1 = await enviar();
  assert.equal(r1.falhas, 1);
  const item = (await pool.query(`SELECT * FROM fila_google WHERE feito_em IS NULL`)).rows[0];
  assert.equal(item.tentativas, 1);
  assert.match(item.erro, /indisponível/);
  assert.equal((await enviar()).feitos, 0); // ainda esperando 1 min
  desloc += 2 * 60000;
  assert.equal((await enviar()).feitos, 1);
  assert.equal(google.eventos(q).length, 2);
  // Segundo aluno entra na mesma dupla: o evento é atualizado, não duplicado.
  await admin.post('/aulas', { data: DIA, tipo: dup, horario, origem: 'avulsa', nome: 'Diego' });
  await enviar();
  assert.equal(google.eventos(q).length, 2);
  assert.ok(google.eventos(q).some(e => e.titulo === 'Avulsa — Carla + Diego'));
});

test('AGD-12 cancelar aula com motivo apaga o evento do Google e libera o horário', opc, async () => {
  const q = (await pool.query(`SELECT google_agenda_id FROM quadra WHERE nome = 'Quadra 1'`)).rows[0].google_agenda_id;
  const aula = (await pool.query(`SELECT a.id FROM aula a JOIN tipo_aula t ON t.id = a.tipo_aula_id WHERE t.nome = 'Individual'`)).rows[0];
  await admin.post(`/aulas/${aula.id}/cancelar`, { motivo: 'Aluno desistiu' });
  await enviar();
  assert.equal(google.eventos(q).length, 1);
  const a = (await pool.query('SELECT situacao, google_evento_id FROM aula WHERE id = $1', [aula.id])).rows[0];
  assert.deepEqual(a, { situacao: 'cancelada', google_evento_id: null });
  const ind = (await pool.query(`SELECT id FROM tipo_aula WHERE nome = 'Individual'`)).rows[0].id;
  assert.equal(((await admin.get(`/aulas/nova?data=${DIA}&tipo=${ind}`)).texto.match(/<option value="\d+\|\d+"/g) || []).length, 3);
});

test('AGD-03 feriados nacionais entram sozinhos, sem duplicar, e o removido pelo admin não volta', opc, async () => {
  const n1 = await tx(pool, c => carregarFeriados(c, 2027));
  assert.equal(n1, 10);
  assert.equal(await tx(pool, c => carregarFeriados(c, 2027)), 0);
  await admin.post('/cadastros/feriado/cancelar', { data: '2027-11-20' });
  assert.equal(await tx(pool, c => carregarFeriados(c, 2027)), 0);
  const f = (await pool.query(`SELECT cancelado_em FROM feriado WHERE data = '2027-11-20'`)).rows[0];
  assert.ok(f.cancelado_em);
});

test('OPR-05 anonimizar apaga os dados pessoais e mantém aulas e histórico', opc, async () => {
  const c = (await pool.query(`SELECT id FROM contato WHERE nome = 'Ana Souza'`)).rows[0].id;
  assert.equal((await prof.post(`/contatos/${c}/anonimizar`, { motivo: 'x' })).status, 403);
  await admin.post(`/contatos/${c}/anonimizar`, { motivo: 'Pedido do titular' });
  const d = (await pool.query('SELECT nome, telefone, email, data_nascimento, anonimizado_em, sem_campanha FROM contato WHERE id = $1', [c])).rows[0];
  assert.equal(d.nome, null); assert.equal(d.telefone, null); assert.ok(d.anonimizado_em); assert.equal(d.sem_campanha, true);
  assert.equal((await pool.query('SELECT count(*)::int n FROM aula_participante WHERE contato_id = $1', [c])).rows[0].n, 1);
  const h = (await pool.query(`SELECT motivo, depois::text d FROM historico WHERE acao = 'contato.anonimizado'`)).rows[0];
  assert.equal(h.motivo, 'Pedido do titular');
  assert.doesNotMatch(h.d, /Ana|99999/);
  assert.match((await admin.get('/contatos')).texto, /\(anonimizado\)/);
});

test('OPR-06 exportação para Excel só para o admin e fica registrada', opc, async () => {
  const r = await fetch(painel.base + '/exportar/aulas.csv', { headers: { cookie: admin.cookie } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /playsquash-aulas-/);
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf]); // marca UTF-8 para o Excel abrir com acento
  assert.match(bytes.subarray(3).toString('utf8').split('\r\n')[0], /^id;quadra;professor;tipo;origem;situacao;dia;inicio;fim/);
  assert.equal((await prof.get('/exportar/aulas.csv')).status, 403);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM historico WHERE acao = 'dados.exportados'`)).rows[0].n, 1);
});
