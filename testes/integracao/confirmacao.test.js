/**
 * Confirmação da experimental, pós-aula e lista de espera, com banco de TESTE, IA falsa e
 * WhatsApp falso (TST-01, TST-08). O "agora" é movido com PS_AGORA (TST-06).
 */
process.env.PS_AGORA = '2026-12-01T09:00:00-03:00';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URL_TESTE, prepararBanco, criarUsuario, subirPainel, cliente } = require('../ajuda');
const { criarIaFalsa, ultimoResultado } = require('../simuladores/ia-falsa');
const { receberMensagem } = require('../../src/whatsapp/recebimento');
const { atender } = require('../../src/sofia/sofia');
const { processarConfirmacoes, processarPosAula } = require('../../src/sofia/confirmacao');
const { agora, instanteSP, dataSP, somarDias } = require('../../src/relogio');

const opc = { skip: URL_TESTE ? false : 'sem DATABASE_URL_TESTE' };
const silencioso = { error() {}, log() {} };
let pool, profId, quadraId, tipoId;
let seq = 500;
const novoTel = () => `+55629777${String(seq++).padStart(5, '0')}`;
const um = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const todos = async (sql, p = []) => (await pool.query(sql, p)).rows;
const em = ms => { process.env.PS_AGORA = new Date(ms).toISOString(); };
const SP = (d, h) => instanteSP(d, h);

async function falar(tel, texto, roteiro) {
  const r = await receberMensagem(pool, { de: tel, texto, em: agora() });
  return atender({ pool, ia: criarIaFalsa(roteiro), conversaId: r.conversaId, log: silencioso });
}
// Marca a experimental pela Sofia no primeiro horário que bate com a preferência.
async function marcar(tel, nome, ver) {
  await falar(tel, 'oi', [
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1, ...ver } }] },
    p => ({ ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo, participantes: [{ nome, data_nascimento: '1990-01-01', eh_quem_conversa: true }] } }] }),
    'Marcado!',
  ]);
  const ct = await um('SELECT id FROM contato WHERE telefone = $1', [tel]);
  const a = await um(`SELECT *, extract(epoch FROM lower(periodo))*1000 ini, extract(epoch FROM upper(periodo))*1000 fim FROM aula
    WHERE marcada_por_contato_id = $1 ORDER BY id DESC LIMIT 1`, [ct.id]);
  return { ...a, ini: Number(a.ini), fim: Number(a.fim), contatoId: ct.id };
}
const filaDe = (contatoId, prefixo) => todos(`SELECT * FROM fila_envio WHERE contato_id = $1 AND chave_unica LIKE $2 ORDER BY id`, [contatoId, `${prefixo}%`]);
const filaProf = prefixo => todos(`SELECT * FROM fila_envio WHERE usuario_id = $1 AND chave_unica LIKE $2 ORDER BY id`, [profId, `${prefixo}%`]);
const rodar = () => processarConfirmacoes({ pool, log: silencioso });

before(async () => {
  if (!URL_TESTE) return;
  pool = await prepararBanco();
  await criarUsuario(pool, { nome: 'Guilherme', email: 'adm-cnf@teste.local', admin: true });
  profId = await criarUsuario(pool, { nome: 'Carla', email: 'prof-cnf@teste.local' });
  await pool.query(`UPDATE usuario SET telefone = '+5562977770002' WHERE id = $1`, [profId]);
  quadraId = (await um(`INSERT INTO quadra (nome) VALUES ('Quadra 1') RETURNING id`)).id;
  tipoId = (await um(`INSERT INTO tipo_aula (nome, categoria, duracao_min, alunos_por_aula) VALUES ('Experimental','experimental',60,1) RETURNING id`)).id;
  for (const dia of [1, 2, 3, 4, 5]) {
    for (const [ini, fim] of [['08:00', '12:00'], ['18:00', '21:00']]) {
      const f = await um(`INSERT INTO grade_faixa (quadra_id, dia_semana, inicio, fim, professor_id, vigente_desde) VALUES ($1,$2,$3,$4,$5,'2026-11-01') RETURNING id`, [quadraId, dia, ini, fim, profId]);
      await pool.query('INSERT INTO grade_faixa_tipo VALUES ($1,$2)', [f.id, tipoId]);
    }
  }
});
after(async () => { if (pool) await pool.end(); });

test('CNF-01 CNF-05 pedido na véspera, reenvio 3 h antes e cancelamento sem resposta 90 min antes', opc, async () => {
  em(SP('2026-12-01', '09:00'));
  const a = await marcar(novoTel(), 'Sem Resposta', { periodo: 'manha', a_partir_de: '2026-12-02' });
  const vespera = somarDias(dataSP(a.ini), -1);
  em(SP(vespera, '18:59')); await rodar();
  assert.equal((await filaDe(a.contatoId, 'cnf-')).length, 0);
  em(SP(vespera, '19:00')); await rodar(); await rodar();
  const pedidos = await filaDe(a.contatoId, 'cnf-pedido');
  assert.equal(pedidos.length, 1, 'pedido uma vez só');
  assert.match(pedidos[0].texto, /^Oi, Sem! .*aula experimental .*amanhã às 08:00.*Quadra 1.*Carla/);
  em(a.ini - 180 * 60000); await rodar();
  assert.equal((await filaDe(a.contatoId, 'cnf-reenvio')).length, 1);
  assert.match((await filaDe(a.contatoId, 'cnf-reenvio'))[0].texto, /hoje às 08:00/);
  em(a.ini - 91 * 60000); await rodar();
  assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [a.id])).situacao, 'marcada');
  em(a.ini - 90 * 60000); await rodar();
  const depois = await um('SELECT * FROM aula WHERE id = $1', [a.id]);
  assert.equal(depois.situacao, 'cancelada');
  assert.equal(depois.conf_resposta, 'sem_resposta');
  assert.equal((await um(`SELECT confirmacao FROM aula_participante WHERE aula_id = $1`, [a.id])).confirmacao, 'sem_resposta');
  assert.equal((await um(`SELECT count(*)::int n FROM fila_google WHERE aula_id = $1 AND acao = 'apagar'`, [a.id])).n, 1);
  assert.equal((await filaDe(a.contatoId, 'cnf-cancelada')).length, 1);
  assert.match((await filaProf(`cnf-prof-sem:${a.id}`))[0].texto, /cancelada sem confirmação: Sem Resposta/);
});

test('CNF-02 CNF-03 CNF-05 lead confirma pela conversa: aula confirmada, ✓ no Google, professor avisado, sem reenvio', opc, async () => {
  em(SP('2026-12-01', '09:00'));
  const tel = novoTel();
  const a = await marcar(tel, 'Vai Mesmo', { periodo: 'manha', a_partir_de: '2026-12-03' });
  em(SP(somarDias(dataSP(a.ini), -1), '19:30')); await rodar();
  let ctxIa, res;
  await falar(tel, 'sim, vou!', [
    p => { ctxIa = p.sistemaDoMomento; return { ferramentas: [{ nome: 'registrar_confirmacao', entrada: { aula_id: a.id, resposta: 'confirmou' } }] }; },
    p => { res = ultimoResultado(p); return 'Oba, te esperamos!'; },
  ]);
  assert.match(ctxIa, new RegExp(`aula_id ${a.id}: .*AGUARDANDO CONFIRMAÇÃO`));
  assert.equal(res.confirmada, true);
  const depois = await um('SELECT * FROM aula WHERE id = $1', [a.id]);
  assert.equal(depois.situacao, 'confirmada');
  assert.equal(depois.conf_resposta, 'confirmou');
  assert.equal((await um(`SELECT count(*)::int n FROM fila_google WHERE aula_id = $1 AND acao = 'atualizar'`, [a.id])).n, 1, 'evento ganha o ✓');
  assert.match((await filaProf(`cnf-prof-ok:${a.id}`))[0].texto, /Experimental confirmada: Vai Mesmo/);
  em(a.ini - 120 * 60000); await rodar();
  assert.equal((await filaDe(a.contatoId, 'cnf-reenvio')).length, 0);
  assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [a.id])).situacao, 'confirmada');
  // Outro lead não confirma aula que não é dele.
  let alheio;
  await falar(novoTel(), 'confirmo', [
    { ferramentas: [{ nome: 'registrar_confirmacao', entrada: { aula_id: a.id, resposta: 'nao_vai' } }] },
    p => { alheio = ultimoResultado(p); return '…'; },
  ]);
  assert.equal(alheio.erro, true);
  assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [a.id])).situacao, 'confirmada');
});

test('CNF-03 LES-02 LES-03 "não vai" libera a vaga: a lista é avisada, o primeiro que marca leva e o outro recebe "preenchida"', opc, async () => {
  em(SP('2026-12-01', '09:00'));
  const telB = novoTel();
  const a = await marcar(telB, 'Bia Desiste', { periodo: 'noite', a_partir_de: '2026-12-04' });
  const dia = dataSP(a.ini), hora = new Date(a.ini).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const telC = novoTel(), telD = novoTel();
  for (const t of [telC, telD]) {
    await falar(t, `quero ${dia} ${hora}`, [{ ferramentas: [{ nome: 'entrar_lista_espera', entrada: { data: dia, hora } }] }, 'Você está na lista.']);
  }
  em(SP(somarDias(dia, -1), '19:00')); await rodar();
  let res;
  await falar(telB, 'não vou conseguir', [
    { ferramentas: [{ nome: 'registrar_confirmacao', entrada: { aula_id: a.id, resposta: 'nao_vai' } }] },
    p => { res = ultimoResultado(p); return 'Tudo bem! Quer outra data?'; },
  ]);
  assert.equal(res.cancelada, true);
  assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [a.id])).situacao, 'cancelada');
  assert.match((await filaProf(`cnf-prof-nao:${a.id}`))[0].texto, /avisou que não vai/);
  const c = await um('SELECT id FROM contato WHERE telefone = $1', [telC]);
  const d = await um('SELECT id FROM contato WHERE telefone = $1', [telD]);
  assert.equal((await filaDe(c.id, 'les-vaga')).length, 1);
  assert.equal((await filaDe(d.id, 'les-vaga')).length, 1);
  // C responde primeiro e marca: a Sofia vê no contexto a vaga avisada.
  let ctxIa;
  await falar(telC, 'quero!', [
    p => { ctxIa = p.sistemaDoMomento; return { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1, periodo: 'noite', a_partir_de: dia } }] }; },
    p => ({ ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo, participantes: [{ nome: 'Caio Rapido', data_nascimento: '1991-01-01', eh_quem_conversa: true }] } }] }),
    'Marcado!',
  ]);
  assert.match(ctxIa, /Avisamos este lead que abriu vaga/);
  const nova = await um(`SELECT extract(epoch FROM lower(periodo))*1000 ini FROM aula WHERE marcada_por_contato_id = $1 AND situacao <> 'cancelada'`, [c.id]);
  assert.equal(Number(nova.ini), a.ini, 'C ficou com a vaga liberada');
  assert.ok((await um(`SELECT saiu_em FROM lista_espera WHERE contato_id = $1`, [c.id])).saiu_em, 'LES-03: C sai da lista');
  const pre = await filaDe(d.id, 'les-preenchida');
  assert.equal(pre.length, 1);
  assert.match(pre[0].texto, /já foi preenchida/);
  const ld = await um('SELECT saiu_em, preenchida_em FROM lista_espera WHERE contato_id = $1', [d.id]);
  assert.equal(ld.saiu_em, null, 'D continua na lista');
  assert.ok(ld.preenchida_em);
});

test('CNF-04 marcada depois das 19h da véspera nasce confirmada e não recebe pedido nem cancelamento', opc, async () => {
  em(SP('2026-12-01', '20:00'));
  const a = await marcar(novoTel(), 'Ultima Hora', { periodo: 'manha', a_partir_de: '2026-12-02' });
  assert.equal(dataSP(a.ini), '2026-12-02');
  assert.equal(a.situacao, 'confirmada');
  em(a.ini - 100 * 60000); await rodar();
  em(a.ini - 60 * 60000); await rodar();
  assert.equal((await filaDe(a.contatoId, 'cnf-')).length, 0);
  assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [a.id])).situacao, 'confirmada');
});

test('CNF-01 pedido desligado: sem pedido não há cancelamento automático', opc, async () => {
  await pool.query(`INSERT INTO regra_config (chave, valor) VALUES ('confirmacao.pedido_ligado','false'), ('confirmacao.reenvio_ligado','false')`);
  try {
    em(SP('2026-12-01', '09:00'));
    const a = await marcar(novoTel(), 'Sem Pedido', { periodo: 'manha', a_partir_de: '2026-12-07' });
    em(SP(somarDias(dataSP(a.ini), -1), '19:00')); await rodar();
    em(a.ini - 60 * 60000); await rodar();
    assert.equal((await filaDe(a.contatoId, 'cnf-')).length, 0);
    assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [a.id])).situacao, 'marcada');
  } finally {
    await pool.query(`INSERT INTO regra_config (chave, valor) VALUES ('confirmacao.pedido_ligado','true'), ('confirmacao.reenvio_ligado','true')`);
  }
});

test('CNF-06 pós-aula: contato no mesmo dia e +2 dias; quem faltou recebe convite para remarcar; resultado encerra os contatos', opc, async () => {
  em(SP('2026-12-01', '09:00'));
  const a1 = await marcar(novoTel(), 'Veio Sim', { periodo: 'manha', a_partir_de: '2026-12-08' });
  const a2 = await marcar(novoTel(), 'Faltou Hoje', { periodo: 'manha', a_partir_de: '2026-12-08' });
  const a3 = await marcar(novoTel(), 'Ja Matriculou', { periodo: 'manha', a_partir_de: '2026-12-08' });
  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('adm-cnf@teste.local');
    // Antes da aula, presença é recusada.
    const p2 = await um('SELECT id FROM aula_participante WHERE aula_id = $1', [a2.id]);
    em(a2.ini - 60000);
    assert.match(decodeURIComponent((await adm.post(`/experimentais/participante/${p2.id}/presenca`, { presenca: 'falta' })).local), /ainda não aconteceu/);
    const fim = Math.max(a1.fim, a2.fim, a3.fim);
    em(fim + 5 * 60000);
    await adm.post(`/experimentais/participante/${p2.id}/presenca`, { presenca: 'falta' });
    assert.match(decodeURIComponent((await adm.post(`/experimentais/contato/${a3.contatoId}/resultado`, { resultado: 'perdido', motivo: '' })).local), /motivo da perda/);
    await adm.post(`/experimentais/contato/${a3.contatoId}/resultado`, { resultado: 'matriculou' });
    const tela = (await adm.get('/experimentais?filtro=passadas')).texto;
    assert.match(tela, /Faltou Hoje/);
    assert.match(tela, /Matriculou/);
    // PER-03: professor não abre.
    const prof = cliente(painel.base);
    await prof.entrar('prof-cnf@teste.local');
    assert.equal((await prof.get('/experimentais')).status, 403);
    assert.equal((await prof.post(`/experimentais/contato/${a1.contatoId}/resultado`, { resultado: 'matriculou' })).status, 403);
  } finally { await painel.fechar(); }
  em(fim2(a1, a2, a3) + 61 * 60000);
  await processarPosAula({ pool, log: silencioso }); await processarPosAula({ pool, log: silencioso });
  assert.match((await filaDe(a1.contatoId, 'pos-dia'))[0].texto, /que você veio hoje/);
  assert.match((await filaDe(a2.contatoId, 'pos-dia'))[0].texto, /Sentimos sua falta/);
  assert.equal((await filaDe(a3.contatoId, 'pos-')).length, 0, 'já matriculou: não recebe');
  em(SP(somarDias(dataSP(a1.fim), 2), '09:59')); await processarPosAula({ pool, log: silencioso });
  assert.equal((await filaDe(a1.contatoId, 'pos-2d')).length, 0);
  em(SP(somarDias(dataSP(a1.fim), 2), '10:00')); await processarPosAula({ pool, log: silencioso });
  assert.equal((await filaDe(a1.contatoId, 'pos-2d')).length, 1);
  assert.equal((await filaDe(a2.contatoId, 'pos-2d')).length, 0, 'quem faltou já recebeu o convite');
  const h = await um(`SELECT * FROM historico WHERE acao = 'lead.resultado' AND entidade_id = $1`, [a3.contatoId]);
  assert.equal(h.depois.resultado, 'matriculou');
});
const fim2 = (...as) => Math.max(...as.map(a => a.fim));

test('CNF-01 CNF-03 painel: admin registra resposta e muda horários e textos da confirmação com versão', opc, async () => {
  em(SP('2026-12-01', '09:00'));
  const a = await marcar(novoTel(), 'Ligou Pro Admin', { periodo: 'noite', a_partir_de: '2026-12-09' });
  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('adm-cnf@teste.local');
    assert.match((await adm.get('/experimentais')).texto, /Ligou Pro Admin/);
    await adm.post(`/experimentais/${a.id}/resposta`, { resposta: 'confirmou' });
    assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [a.id])).situacao, 'confirmada');
    assert.equal((await um(`SELECT origem FROM historico WHERE acao = 'aula.confirmada' AND entidade_id = $1`, [a.id])).origem, 'painel');
    const form = {
      pedido_hora: '18:30', pedido_ligado: '1', reenvio_min: '240', reenvio_ligado: '1', cancelamento_min: '300', cancelamento_ligado: '1',
      contato_min: '30', hora_2d: '11:00', motivo: 'teste',
    };
    for (const k of ['confirmacao.mensagem_pedido', 'confirmacao.mensagem_reenvio', 'confirmacao.mensagem_cancelada', 'pos_aula.mensagem_dia',
      'pos_aula.mensagem_falta', 'pos_aula.mensagem_2d', 'lista_espera.mensagem_vaga', 'lista_espera.mensagem_preenchida']) form[k] = `Texto ${k} {nome}`;
    assert.match(decodeURIComponent((await adm.post('/sofia/confirmacao', form)).local), /mais perto da aula/);
    form.cancelamento_min = '60';
    assert.match(decodeURIComponent((await adm.post('/sofia/confirmacao', form)).local), /salvos/);
    assert.match((await adm.get('/sofia')).texto, /value="18:30"/);
    const v = await um(`SELECT count(*)::int n FROM regra_config WHERE chave = 'confirmacao.pedido_hora'`);
    assert.equal(v.n, 2, 'DAD-06: nova versão, a antiga continua');
  } finally { await painel.fechar(); }
});
