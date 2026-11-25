/**
 * Planos, alunos, contratos e aulas fixas com banco de TESTE e painel (TST-01).
 * "Agora": terça, 01/12/2026, 09:00 em Brasília (TST-06).
 */
process.env.PS_AGORA = '2026-12-01T09:00:00-03:00';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URL_TESTE, prepararBanco, criarUsuario, subirPainel, cliente } = require('../ajuda');
const { gerarAulasFixas } = require('../../src/agenda/aulas-fixas');

const opc = { skip: URL_TESTE ? false : 'sem DATABASE_URL_TESTE' };
const silencioso = { error() {}, log() {} };
let pool, painel, adm, profId, prof2Id, q1, tIndiv, tDupla;
const um = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const todos = async (sql, p = []) => (await pool.query(sql, p)).rows;
const ok = r => decodeURIComponent(r.local || '');

async function novoAluno(nome, tel) {
  const r = await adm.post('/alunos', { nome, telefone: tel, nascimento: '1990-01-01' });
  return Number(/\/alunos\/(\d+)/.exec(r.local)[1]);
}
async function novoPlano(nome, tipo, aulasSemana = 1, extra = {}) {
  await adm.post('/planos', { nome, tipo_aula_id: tipo, aulas_semana: aulasSemana, vigencia_meses: 3, valor_referencia: '300,00', parcelas_max: 3, ...extra });
  return (await um('SELECT id FROM plano WHERE nome = $1', [nome])).id;
}
const contratar = (aluno, plano, horarios, extra = {}) => adm.post('/contratos', {
  aluno_id: aluno, plano_id: plano, inicio: '2026-12-01', horarios, valor_mensal: '300,00', desconto_valor: '0', forma: 'parcelado', parcelas: 3, dia_vencimento: 10, ...extra,
});
const aulasDoContrato = k => todos(
  `SELECT a.*, p.situacao p_sit, to_char(lower(a.periodo) AT TIME ZONE 'America/Sao_Paulo','YYYY-MM-DD HH24:MI') quando
     FROM aula_participante p JOIN aula a ON a.id = p.aula_id WHERE p.contrato_id = $1 ORDER BY lower(a.periodo)`, [k]);

before(async () => {
  if (!URL_TESTE) return;
  pool = await prepararBanco();
  await criarUsuario(pool, { nome: 'Guilherme', email: 'adm-ct@teste.local', admin: true });
  profId = await criarUsuario(pool, { nome: 'Carla', email: 'prof-ct@teste.local' });
  prof2Id = await criarUsuario(pool, { nome: 'Diego', email: 'prof2-ct@teste.local' });
  q1 = (await um(`INSERT INTO quadra (nome) VALUES ('Quadra 1') RETURNING id`)).id;
  tIndiv = (await um(`INSERT INTO tipo_aula (nome, categoria, duracao_min, alunos_por_aula) VALUES ('Individual','individual',60,1) RETURNING id`)).id;
  tDupla = (await um(`INSERT INTO tipo_aula (nome, categoria, duracao_min, alunos_por_aula) VALUES ('Dupla','dupla',60,2) RETURNING id`)).id;
  for (const dia of [2, 3, 4]) {
    const f = await um(`INSERT INTO grade_faixa (quadra_id, dia_semana, inicio, fim, professor_id, vigente_desde) VALUES ($1,$2,'18:00','21:00',$3,'2026-11-01') RETURNING id`, [q1, dia, profId]);
    for (const t of [tIndiv, tDupla]) await pool.query('INSERT INTO grade_faixa_tipo VALUES ($1,$2)', [f.id, t]);
  }
  await pool.query(`INSERT INTO feriado (data, nome) VALUES ('2026-12-24', 'Véspera de teste')`); // quinta
  painel = await subirPainel(pool);
  adm = cliente(painel.base);
  await adm.entrar('adm-ct@teste.local');
});
after(async () => { if (painel) await painel.fechar(); if (pool) await pool.end(); });

test('CON-01 CON-01a plano criado, editado e duplicado; contrato guarda o retrato do plano', opc, async () => {
  const p = await novoPlano('Individual 1x', tIndiv);
  const a = await novoAluno('Ana Retrato', '62911110001');
  assert.match(ok(await contratar(a, p, [`${q1}|2|18:00`])), /Contrato salvo/);
  const r = await adm.post(`/planos/${p}`, { nome: 'Individual 1x', tipo_aula_id: tIndiv, aulas_semana: 1, vigencia_meses: 6, valor_referencia: '350', parcelas_max: 6 });
  assert.match(ok(r), /Contratos já feitos não mudam/);
  const k = await um('SELECT * FROM contrato WHERE plano_id = $1', [p]);
  assert.equal(k.plano_retrato.vigencia_meses, 3, 'DAD-05: retrato não muda');
  assert.equal(k.plano_retrato.valor_referencia, '300.00');
  assert.ok(k.regras_retrato['marcar.antecedencia_min.reposicao'] != null);
  const h = await um(`SELECT * FROM historico WHERE acao = 'plano.alterado' AND entidade_id = $1`, [p]);
  assert.equal(h.antes.vigencia_meses, 3);
  assert.equal(h.depois.vigencia_meses, 6);
  const d = await adm.post(`/planos/${p}/duplicar`, {});
  assert.match(ok(d), /duplicado/);
  assert.equal((await um(`SELECT ativo_venda FROM plano WHERE nome = 'Individual 1x (cópia)'`)).ativo_venda, false);
});

test('CON-02 AGD-06 contrato gera 4 semanas de aulas fixas sem duplicar, pula feriado e manda para o Google', opc, async () => {
  const p = await novoPlano('Individual 2x', tIndiv, 2);
  const a = await novoAluno('Bruno Fixo', '62911110002');
  assert.match(ok(await contratar(a, p, [`${q1}|2|19:00`])), /exatamente 2/);
  assert.match(ok(await contratar(a, p, [`${q1}|2|19:00`, `${q1}|4|19:00`], { desconto_valor: '20' })), /motivo do desconto/);
  assert.match(ok(await contratar(a, p, [`${q1}|2|19:00`, `${q1}|4|19:00`], { desconto_valor: '20', desconto_motivo: 'irmão' })), /Contrato salvo/);
  const k = await um('SELECT * FROM contrato WHERE aluno_id = (SELECT id FROM aluno WHERE id = $1)', [a]);
  assert.equal(k.situacao, 'aguardando_aceite');
  assert.equal(k.fim.toISOString().slice(0, 10), '2027-02-28');
  const aulas = await aulasDoContrato(k.id);
  // 01/12 a 28/12: terças 01,08,15,22 e quintas 03,10,17,(24 feriado).
  assert.deepEqual(aulas.map(x => x.quando), ['2026-12-01 19:00', '2026-12-03 19:00', '2026-12-08 19:00', '2026-12-10 19:00', '2026-12-15 19:00', '2026-12-17 19:00', '2026-12-22 19:00']);
  assert.ok(aulas.every(x => x.origem === 'fixa' && x.professor_id === profId));
  assert.equal((await um(`SELECT count(*)::int n FROM fila_google WHERE acao = 'criar' AND aula_id = ANY($1)`, [aulas.map(x => x.id)])).n, 7);
  assert.equal((await um(`SELECT count(*)::int n FROM historico WHERE acao = 'aula.fixa_pulada' AND depois->>'data' = '2026-12-24'`)).n, 1);
  assert.equal(await gerarAulasFixas({ pool, log: silencioso }), 0, 'rodar de novo não duplica');
  assert.equal((await um(`SELECT situacao FROM aluno WHERE id = $1`, [a])).situacao, 'ativo');
  assert.equal((await um(`SELECT tipo FROM contato WHERE telefone = '+5562911110002'`)).tipo, 'aluno');
  // Uma semana depois, a rotina estende até a 4ª semana seguinte.
  process.env.PS_AGORA = '2026-12-08T09:00:00-03:00';
  try {
    await gerarAulasFixas({ pool, log: silencioso });
    assert.deepEqual((await aulasDoContrato(k.id)).slice(-2).map(x => x.quando), ['2026-12-29 19:00', '2026-12-31 19:00']);
  } finally { process.env.PS_AGORA = '2026-12-01T09:00:00-03:00'; }
});

test('AGD-05 CON-04 horário fixo individual não aceita segundo aluno; dupla junta dois contratos na mesma aula', opc, async () => {
  const pI = await novoPlano('Individual 1x B', tIndiv);
  const pD = await novoPlano('Dupla 1x', tDupla);
  const c1 = await novoAluno('Caio Um', '62911110003');
  const c2 = await novoAluno('Caio Dois', '62911110004');
  // 20:00 de terça: individual pega, o segundo é recusado.
  assert.match(ok(await contratar(c1, pI, [`${q1}|2|20:00`])), /Contrato salvo/);
  assert.match(ok(await contratar(c2, pI, [`${q1}|2|20:00`])), /não tem mais vaga/);
  // Tela de novo contrato não oferece o horário ocupado.
  const t = (await adm.get(`/contratos/novo?aluno=${c2}&plano=${pI}&inicio=2026-12-01`)).texto;
  assert.doesNotMatch(t, new RegExp(`value="${q1}\\|2\\|20:00"`));
  // Dupla na quinta 20:00: dois contratos, uma aula com dois alunos.
  assert.match(ok(await contratar(c1, pD, [`${q1}|4|20:00`])), /Contrato salvo/);
  assert.match((await adm.get(`/contratos/novo?aluno=${c2}&plano=${pD}&inicio=2026-12-01`)).texto, /20:00 · Quadra 1 · Carla \(1 vaga\)/);
  assert.match(ok(await contratar(c2, pD, [`${q1}|4|20:00`])), /Contrato salvo/);
  const aula = await um(`SELECT a.id, count(p.*)::int n FROM aula a JOIN aula_participante p ON p.aula_id = a.id
    WHERE a.quadra_id = $1 AND lower(a.periodo) = '2026-12-03 20:00-03' GROUP BY a.id`, [q1]);
  assert.equal(aula.n, 2);
  assert.equal((await um('SELECT count(*)::int n FROM contrato WHERE aluno_id = $1', [c1])).n, 2, 'CON-04: vários contratos');
});

test('CON-08 renovação: novo contrato traz plano, valor e horários do anterior', opc, async () => {
  const p = await novoPlano('Individual 1x R', tIndiv);
  const a = await novoAluno('Rita Renova', '62911110005');
  await contratar(a, p, [`${q1}|4|18:00`], { valor_mensal: '280,00', dia_vencimento: 15 });
  const k = await um('SELECT * FROM contrato WHERE aluno_id = $1', [a]);
  const t = (await adm.get(`/contratos/novo?aluno=${a}`)).texto;
  assert.match(t, /Renovação/);
  assert.match(t, new RegExp(`value="${q1}\\|4\\|18:00" checked`), 'horário anterior marcado (o novo começa depois do fim do anterior)');
  assert.match(t, /name="inicio" value="2027-03-01"/);
  assert.match(t, /value="280,00"/);
  assert.match(t, /name="dia_vencimento" min="1" max="31" value="15"/);
  const r = await adm.post('/contratos', { aluno_id: a, plano_id: p, inicio: '2027-03-01', horarios: [`${q1}|4|18:00`], valor_mensal: '290', desconto_valor: '0', forma: 'parcelado', parcelas: 3, dia_vencimento: 15 });
  assert.match(ok(r), /Contrato salvo/);
  assert.equal((await um('SELECT renovacao_de_id FROM contrato WHERE aluno_id = $1 AND id <> $2', [a, k.id])).renovacao_de_id, k.id);
});

test('CON-10 encerramento libera o horário na hora e tira o aluno das próximas aulas', opc, async () => {
  const p = await novoPlano('Individual 1x E', tIndiv);
  const a = await novoAluno('Edu Encerra', '62911110006');
  await contratar(a, p, [`${q1}|3|18:30`]);
  const k = await um('SELECT id FROM contrato WHERE aluno_id = $1', [a]);
  const antes = await aulasDoContrato(k.id);
  assert.equal(antes.length, 4);
  assert.match(ok(await adm.post(`/contratos/${k.id}/encerrar`, {})), /motivo/);
  assert.match(ok(await adm.post(`/contratos/${k.id}/encerrar`, { motivo: 'mudou de cidade' })), /Contrato encerrado/);
  const depois = await aulasDoContrato(k.id);
  assert.ok(depois.every(x => x.situacao === 'cancelada' && x.p_sit === 'desmarcado'));
  assert.equal((await um(`SELECT count(*)::int n FROM fila_google WHERE acao = 'apagar' AND aula_id = ANY($1)`, [depois.map(x => x.id)])).n, 4);
  assert.ok((await um('SELECT liberado_em FROM horario_fixo WHERE contrato_id = $1', [k.id])).liberado_em);
  assert.equal((await um('SELECT situacao FROM aluno WHERE id = $1', [a])).situacao, 'inativo');
  assert.equal((await um(`SELECT motivo FROM historico WHERE acao = 'contrato.encerrado' AND entidade_id = $1`, [k.id])).motivo, 'mudou de cidade');
  // O horário volta a aparecer para outro aluno.
  const b = await novoAluno('Bia Pega', '62911110007');
  assert.match(ok(await contratar(b, p, [`${q1}|3|18:30`])), /Contrato salvo/);
});

test('AGD-07 trocar o professor da faixa troca o das aulas futuras; os alunos ficam', opc, async () => {
  const f = await um(`SELECT id FROM grade_faixa WHERE quadra_id = $1 AND dia_semana = 4`, [q1]);
  const r = await adm.post(`/cadastros/faixa/${f.id}/professor`, { professor_id: prof2Id });
  assert.match(ok(r), /Professor da faixa trocado \(\d+ aula/);
  const quintas = await todos(`SELECT professor_id FROM aula WHERE quadra_id = $1 AND situacao <> 'cancelada'
    AND extract(dow FROM lower(periodo) AT TIME ZONE 'America/Sao_Paulo') = 4 AND lower(periodo) > now()`, [q1]);
  assert.ok(quintas.length > 0);
  assert.ok(quintas.every(x => x.professor_id === prof2Id));
  const tercas = await todos(`SELECT DISTINCT professor_id FROM aula WHERE quadra_id = $1 AND extract(dow FROM lower(periodo) AT TIME ZONE 'America/Sao_Paulo') = 2`, [q1]);
  assert.deepEqual(tercas.map(x => x.professor_id), [profId]);
});

test('PER-02 PER-03 professor não vê planos, alunos nem contratos (valores)', opc, async () => {
  const prof = cliente(painel.base);
  await prof.entrar('prof-ct@teste.local');
  for (const url of ['/planos', '/alunos', '/contratos/novo?aluno=1']) assert.equal((await prof.get(url)).status, 403, url);
  assert.equal((await prof.post('/contratos', { aluno_id: 1 })).status, 403);
  assert.equal((await prof.post('/planos', { nome: 'x' })).status, 403);
});
