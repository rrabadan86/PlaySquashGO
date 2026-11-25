/**
 * Sofia com banco de TESTE, IA falsa e WhatsApp falso (TST-01, TST-08): nada sai para a rede.
 * "Agora" fixo: terça, 01/12/2026, 09:00 em Brasília (TST-06).
 */
process.env.PS_AGORA = '2026-12-01T09:00:00-03:00';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL_TESTE, SENHA, prepararBanco, criarUsuario, subirPainel, cliente } = require('../ajuda');
const { criarIaFalsa, ultimoResultado } = require('../simuladores/ia-falsa');
const { criarWhatsappFalso } = require('../simuladores/whatsapp-falso');
const { receberMensagem } = require('../../src/whatsapp/recebimento');
const { processarUm } = require('../../src/whatsapp/envio');
const { atender, criarSofia } = require('../../src/sofia/sofia');
const { agora } = require('../../src/relogio');

const opc = { skip: URL_TESTE ? false : 'sem DATABASE_URL_TESTE' };
const silencioso = { error() {}, log() {} };
let pool, profId, adminId, tipoId, quadraId;
let seqTel = 100;
const novoTel = () => `+55629888${String(seqTel++).padStart(5, '0')}`;

// Lead manda uma mensagem e a Sofia responde (sem esperar o agrupamento).
async function falar(tel, texto, ia) {
  const r = await receberMensagem(pool, { de: tel, texto, em: agora() });
  if (r.acao !== 'sofia') return { r };
  return { r, s: await atender({ pool, ia, conversaId: r.conversaId, log: silencioso }) };
}
const um = async (sql, p = []) => (await pool.query(sql, p)).rows[0];
const todos = async (sql, p = []) => (await pool.query(sql, p)).rows;

// Roteiro comum: ver horários e marcar o primeiro oferecido.
const verEMarcar = (participantes, ver = { pessoas: participantes.length, periodo: 'manha' }) => [
  { ferramentas: [{ nome: 'ver_horarios', entrada: ver }] },
  p => ({ ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo, participantes } }] }),
  p => ({ texto: ultimoResultado(p).ok ? `Marcado: ${ultimoResultado(p).quando}` : `Erro: ${ultimoResultado(p).mensagem}` }),
];

before(async () => {
  if (!URL_TESTE) return;
  pool = await prepararBanco();
  adminId = await criarUsuario(pool, { nome: 'Guilherme', email: 'adm-sofia@teste.local', admin: true });
  profId = await criarUsuario(pool, { nome: 'Carla', email: 'prof-sofia@teste.local' });
  await pool.query(`UPDATE usuario SET telefone = '+5562977770001' WHERE id = $1`, [adminId]);
  await pool.query(`UPDATE usuario SET telefone = '+5562977770002' WHERE id = $1`, [profId]);
  quadraId = (await um(`INSERT INTO quadra (nome) VALUES ('Quadra 1') RETURNING id`)).id;
  tipoId = (await um(`INSERT INTO tipo_aula (nome, categoria, duracao_min, alunos_por_aula) VALUES ('Experimental','experimental',60,2) RETURNING id`)).id;
  for (const dia of [2, 3]) {
    for (const [ini, fim] of [['08:00', '12:00'], ['18:00', '21:00']]) {
      const f = await um(`INSERT INTO grade_faixa (quadra_id, dia_semana, inicio, fim, professor_id, vigente_desde) VALUES ($1,$2,$3,$4,$5,'2026-11-01') RETURNING id`, [quadraId, dia, ini, fim, profId]);
      await pool.query('INSERT INTO grade_faixa_tipo VALUES ($1,$2)', [f.id, tipoId]);
    }
  }
});
after(async () => { if (pool) await pool.end(); });

test('SOF-02 SOF-04 SOF-05 conversa completa: qualifica, oferece até 3 horários e marca a experimental', opc, async () => {
  const tel = novoTel();
  let ofertas = null;
  const ia = criarIaFalsa([
    { ferramentas: [{ nome: 'salvar_dados', entrada: { nome: 'Marina', ja_jogou: false } }] },
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1, periodo: 'manha' } }] },
    p => { ofertas = ultimoResultado(p).horarios; return 'Tenho estes horários…'; },
  ]);
  const { s } = await falar(tel, 'Oi, quero fazer uma aula experimental', ia);
  assert.equal(s.respondeu, true);
  assert.equal(ofertas.length, 3, 'SOF-04: até 3 horários');
  assert.ok(ofertas.every(o => o.professor === 'Carla'), 'SOF-04: com o professor');
  assert.equal(new Set(ofertas.map(o => o.quando.split(' às ')[0])).size, 3, 'espalhados em dias diferentes');
  const inicios = ofertas.map(o => Number(o.codigo.split('-')[1]));
  assert.ok(inicios.every(i => i - agora() >= 180 * 60000), 'antecedência mínima de 3 h');
  assert.equal((await um('SELECT count(*)::int n FROM aula')).n, 0, 'SOF-04: oferecer não reserva');
  const ct = await um('SELECT * FROM contato WHERE telefone = $1', [tel]);
  assert.equal(ct.nome, 'Marina');
  assert.equal(ct.ja_jogou, false);

  const ia2 = criarIaFalsa([
    { ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo: ofertas[0].codigo, participantes: [{ nome: 'Marina Souza', data_nascimento: '1990-05-10', eh_quem_conversa: true }] } }] },
    p => `Marcado ${ultimoResultado(p).quando} com ${ultimoResultado(p).professor}`,
  ]);
  const { s: s2 } = await falar(tel, 'Quero o primeiro', ia2);
  assert.match(s2.texto, /Marcado .* com Carla/);
  const aula = await um(`SELECT * FROM aula WHERE marcada_por_contato_id = $1`, [ct.id]);
  assert.equal(aula.origem, 'experimental');
  assert.equal(aula.situacao, 'marcada');
  const part = await todos('SELECT p.*, c.nome, to_char(c.data_nascimento,\'YYYY-MM-DD\') nasc FROM aula_participante p JOIN contato c ON c.id = p.contato_id WHERE aula_id = $1', [aula.id]);
  assert.deepEqual(part.map(p => [p.contato_id, p.nome, p.nasc]), [[ct.id, 'Marina Souza', '1990-05-10']]);
  assert.equal((await um(`SELECT count(*)::int n FROM fila_google WHERE aula_id = $1 AND acao = 'criar'`, [aula.id])).n, 1, 'SOF-05: evento no Google pela fila');
  const prof = await um(`SELECT * FROM fila_envio WHERE usuario_id = $1 AND chave_unica = $2`, [profId, `prof-exp:${aula.id}`]);
  assert.match(prof.texto, /Nova aula experimental/);
  assert.match(prof.texto, /Marina Souza/);
  const hist = await um(`SELECT * FROM historico WHERE acao = 'aula.marcada' AND entidade_id = $1`, [aula.id]);
  assert.equal(hist.ator_tipo, 'sofia');
  assert.doesNotMatch(JSON.stringify(hist.depois), /Marina/, 'DAD-07: histórico sem nome');
});

test('SOF-05 vaga tomada entre a oferta e a escolha: não marca e a Sofia oferece outras', opc, async () => {
  const tel = novoTel();
  let codigo;
  const ia = criarIaFalsa([
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1, periodo: 'noite' } }] },
    p => { codigo = ultimoResultado(p).horarios[0].codigo; return 'Opções…'; },
  ]);
  await falar(tel, 'oi', ia);
  // Outra pessoa ocupa a quadra nesse horário (aula avulsa de outro tipo).
  const outro = (await um(`INSERT INTO tipo_aula (nome, categoria, duracao_min) VALUES ('Individual','individual',60) RETURNING id`)).id;
  const ini = Number(codigo.split('-')[1]);
  await pool.query(`INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem) VALUES ($1,$2,$3,tstzrange(to_timestamp($4/1000.0), to_timestamp($5/1000.0)),'avulsa')`, [quadraId, profId, outro, ini, ini + 3600000]);
  let erro, novas;
  const ia2 = criarIaFalsa([
    { ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo, participantes: [{ nome: 'Rui', data_nascimento: '1985-01-01', eh_quem_conversa: true }] } }] },
    p => { erro = ultimoResultado(p); return { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1, periodo: 'noite' } }] }; },
    p => { novas = ultimoResultado(p).horarios; return 'Esse foi ocupado, tenho estes…'; },
  ]);
  await falar(tel, 'o primeiro', ia2);
  assert.equal(erro.erro, true);
  assert.match(erro.mensagem, /não está mais livre|ocupado/);
  assert.ok(!novas.some(h => h.codigo === codigo), 'o horário tomado não volta a ser oferecido');
  const ct = await um('SELECT id FROM contato WHERE telefone = $1', [tel]);
  assert.equal((await um('SELECT count(*)::int n FROM aula WHERE marcada_por_contato_id = $1', [ct.id])).n, 0);
});

test('SOF-06 uma experimental por participante (nome sem acento + nascimento); admin libera exceção', opc, async () => {
  const p1 = [{ nome: 'João da Silva', data_nascimento: '2000-03-03', eh_quem_conversa: true }];
  await falar(novoTel(), 'oi', criarIaFalsa(verEMarcar(p1)));
  // Outro número, mesma pessoa escrita diferente.
  const tel = novoTel();
  let res;
  const ia = criarIaFalsa([
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1 } }] },
    p => ({ ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo, participantes: [{ nome: 'joao  DA silva', data_nascimento: '03/03/2000', eh_quem_conversa: true }] } }] }),
    p => { res = ultimoResultado(p); return 'Você já fez a experimental.'; },
  ]);
  await falar(tel, 'oi', ia);
  assert.equal(res.erro, true);
  assert.match(res.mensagem, /já fez a aula experimental/);

  // Admin libera pelo painel (Conversas › Liberar nova experimental).
  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('adm-sofia@teste.local');
    const conv = await um('SELECT v.id FROM conversa v JOIN contato c ON c.id = v.contato_id WHERE c.telefone = $1', [tel]);
    const r = await adm.post(`/conversas/${conv.id}/liberar`, { nome: 'João da Silva', nascimento: '2000-03-03', motivo: 'faltou por doença' });
    assert.match(decodeURIComponent(r.local), /liberada/);
  } finally { await painel.fechar(); }
  let ok;
  const ia2 = criarIaFalsa([
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1 } }] },
    p => ({ ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo, participantes: [{ nome: 'Joao da Silva', data_nascimento: '2000-03-03', eh_quem_conversa: true }] } }] }),
    p => { ok = ultimoResultado(p); return 'Marcado!'; },
  ]);
  await falar(tel, 'e agora?', ia2);
  assert.equal(ok.ok, true);
  const lib = await um('SELECT * FROM experimental_liberacao ORDER BY id DESC LIMIT 1');
  assert.ok(lib.usada_aula_id, 'a liberação é usada uma vez só');
  assert.equal((await um(`SELECT count(*)::int n FROM historico WHERE acao = 'experimental.liberada'`)).n, 1);
});

test('DAD-07 OPR-05 anonimizar o contato apaga também o nome e o nascimento da liberação de experimental', opc, async () => {
  const tel = novoTel();
  await falar(tel, 'oi', criarIaFalsa(verEMarcar([{ nome: 'Íris Apagar', data_nascimento: '1970-10-10', eh_quem_conversa: true }])));
  const ct = await um('SELECT id FROM contato WHERE telefone = $1', [tel]);
  const conv = await um('SELECT id FROM conversa WHERE contato_id = $1', [ct.id]);
  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('adm-sofia@teste.local');
    await adm.post(`/conversas/${conv.id}/liberar`, { nome: 'Iris Apagar', nascimento: '1970-10-10', motivo: 'teste' });
    await adm.post(`/conversas/${conv.id}/liberar`, { nome: 'Outra Pessoa', nascimento: '1970-10-10', motivo: 'teste' });
    const r = await adm.post(`/contatos/${ct.id}/anonimizar`, { motivo: 'pedido do titular' });
    assert.match(decodeURIComponent(r.local), /anonimizado/);
  } finally { await painel.fechar(); }
  const libs = await todos(`SELECT nome_chave, data_nascimento, anonimizado_em FROM experimental_liberacao WHERE motivo = 'teste' ORDER BY id`);
  assert.equal(libs[0].nome_chave, null);
  assert.equal(libs[0].data_nascimento, null);
  assert.ok(libs[0].anonimizado_em);
  assert.equal(libs[1].nome_chave, 'outra pessoa', 'liberação de outra pessoa não muda');
  const h = await um(`SELECT depois FROM historico WHERE acao = 'contato.anonimizado' AND entidade_id = $1`, [ct.id]);
  assert.equal(h.depois.liberacoes_experimental, 1);
  assert.doesNotMatch(JSON.stringify(h.depois), /iris/i);
});

test('SOF-07 experimental em dupla: parceiro precisa de telefone; os dois entram na mesma aula', opc, async () => {
  const tel = novoTel();
  let semTel;
  const ia = criarIaFalsa([
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 2 } }] },
    p => ({ ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo, participantes: [
      { nome: 'Ana Dupla', data_nascimento: '1995-07-07', eh_quem_conversa: true }, { nome: 'Beto Dupla', data_nascimento: '1994-08-08', eh_quem_conversa: false }] } }] }),
    p => { semTel = ultimoResultado(p); return 'Qual o WhatsApp do Beto?'; },
  ]);
  await falar(tel, 'quero em dupla', ia);
  assert.equal(semTel.erro, true);
  assert.match(semTel.mensagem, /WhatsApp de Beto/);
  const parceiro = novoTel();
  await falar(tel, `o dele é ${parceiro}`, criarIaFalsa(verEMarcar([
    { nome: 'Ana Dupla', data_nascimento: '1995-07-07', eh_quem_conversa: true },
    { nome: 'Beto Dupla', data_nascimento: '1994-08-08', eh_quem_conversa: false, telefone: parceiro.slice(3) },
  ])));
  const ct = await um('SELECT id FROM contato WHERE telefone = $1', [tel]);
  const aula = await um('SELECT * FROM aula WHERE marcada_por_contato_id = $1', [ct.id]);
  const part = await todos('SELECT c.nome, c.telefone FROM aula_participante p JOIN contato c ON c.id = p.contato_id WHERE p.aula_id = $1 ORDER BY p.id', [aula.id]);
  assert.deepEqual(part, [{ nome: 'Ana Dupla', telefone: tel }, { nome: 'Beto Dupla', telefone: parceiro }]);
});

test('SOF-06 SOF-08 responsável marca uma experimental para cada filho e remarca a do filho certo', opc, async () => {
  const tel = novoTel();
  const filho = (nome, nasc) => [{ nome, data_nascimento: nasc, eh_quem_conversa: false }];
  await falar(tel, 'quero para o Pedro', criarIaFalsa(verEMarcar(filho('Pedro Kids', '2016-01-01'), { pessoas: 1, periodo: 'manha' })));
  await falar(tel, 'e para a Lara', criarIaFalsa(verEMarcar(filho('Lara Kids', '2018-06-06'), { pessoas: 1, periodo: 'noite' })));
  const ct = await um('SELECT id FROM contato WHERE telefone = $1', [tel]);
  const aulas = await todos(`SELECT a.id, (SELECT c.nome FROM aula_participante p JOIN contato c ON c.id = p.contato_id WHERE p.aula_id = a.id) nome
    FROM aula a WHERE marcada_por_contato_id = $1 AND situacao <> 'cancelada' ORDER BY a.id`, [ct.id]);
  assert.deepEqual(aulas.map(a => a.nome), ['Pedro Kids', 'Lara Kids']);
  const kids = await todos('SELECT telefone FROM contato WHERE nome IN ($1,$2)', ['Pedro Kids', 'Lara Kids']);
  assert.ok(kids.every(k => k.telefone === null), 'criança sem telefone; a conversa segue com o responsável');
  let ambiguo, ctxIa, res;
  await falar(tel, 'troca o horário da Lara', criarIaFalsa([
    p => { ctxIa = p.sistemaDoMomento; return { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1, periodo: 'noite', a_partir_de: '2026-12-08' } }] }; },
    p => ({ ferramentas: [{ nome: 'remarcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo } }] }),
    p => { ambiguo = ultimoResultado(p); return { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1, periodo: 'noite', a_partir_de: '2026-12-08' } }] }; },
    p => ({ ferramentas: [{ nome: 'remarcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo, aula_id: aulas[1].id } }] }),
    p => { res = ultimoResultado(p); return 'Remarcado!'; },
  ]));
  assert.match(ctxIa, new RegExp(`aula_id ${aulas[1].id}: .*Lara Kids`));
  assert.match(ambiguo.mensagem, /informe aula_id/);
  assert.equal(res.ok, true);
  assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [aulas[0].id])).situacao, 'marcada', 'a do Pedro não muda');
  assert.equal((await um('SELECT situacao FROM aula WHERE id = $1', [aulas[1].id])).situacao, 'cancelada');
});

test('SOF-08 remarcação: libera o horário antigo e marca o novo, avisando o professor', opc, async () => {
  const tel = novoTel();
  await falar(tel, 'oi', criarIaFalsa(verEMarcar([{ nome: 'Clara Remarca', data_nascimento: '1988-02-02', eh_quem_conversa: true }])));
  const ct = await um('SELECT id FROM contato WHERE telefone = $1', [tel]);
  const velha = await um(`SELECT * FROM aula WHERE marcada_por_contato_id = $1 AND situacao <> 'cancelada'`, [ct.id]);
  let res;
  await falar(tel, 'preciso trocar para a noite', criarIaFalsa([
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1, periodo: 'noite' } }] },
    p => ({ ferramentas: [{ nome: 'remarcar_experimental', entrada: { codigo: ultimoResultado(p).horarios[0].codigo } }] }),
    p => { res = ultimoResultado(p); return 'Remarcado!'; },
  ]));
  assert.equal(res.ok, true);
  assert.equal((await um('SELECT situacao, cancelada_motivo FROM aula WHERE id = $1', [velha.id])).situacao, 'cancelada');
  assert.equal((await um(`SELECT count(*)::int n FROM fila_google WHERE aula_id = $1 AND acao = 'apagar'`, [velha.id])).n, 1);
  const nova = await um(`SELECT * FROM aula WHERE marcada_por_contato_id = $1 AND situacao <> 'cancelada'`, [ct.id]);
  assert.notEqual(nova.id, velha.id);
  const p = await todos('SELECT contato_id FROM aula_participante WHERE aula_id = $1', [nova.id]);
  assert.deepEqual(p.map(x => x.contato_id), [ct.id]);
  assert.match((await um('SELECT texto FROM fila_envio WHERE chave_unica = $1', [`prof-exp:${nova.id}`])).texto, /não vem mais/);
  // Marcar de novo a mesma pessoa (em vez de remarcar) é recusado (SOF-06).
  let dup;
  await falar(tel, 'quero outra', criarIaFalsa([
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1 } }] },
    p2 => ({ ferramentas: [{ nome: 'marcar_experimental', entrada: { codigo: ultimoResultado(p2).horarios[0].codigo, participantes: [{ nome: 'Clara Remarca', data_nascimento: '1988-02-02', eh_quem_conversa: true }] } }] }),
    p2 => { dup = ultimoResultado(p2); return '…'; },
  ]));
  assert.match(dup.mensagem, /já tem ou já fez.*remarcar_experimental/);
});

test('SOF-09 transbordo: pausa a Sofia, avisa o admin; o admin devolve pelo painel', opc, async () => {
  const tel = novoTel();
  await falar(tel, 'quero falar com uma pessoa', criarIaFalsa([
    { ferramentas: [{ nome: 'chamar_humano', entrada: { motivo: 'pediu atendente' } }] },
    'Vou chamar alguém da equipe.',
  ]));
  const conv = await um('SELECT v.* FROM conversa v JOIN contato c ON c.id = v.contato_id WHERE c.telefone = $1', [tel]);
  assert.equal(conv.estado, 'humano');
  assert.equal(conv.humano_motivo, 'pediu atendente');
  const aviso = await um(`SELECT * FROM fila_envio WHERE usuario_id = $1 AND chave_unica LIKE $2`, [adminId, `humano:${conv.id}:%`]);
  assert.match(aviso.texto, /pediu atendente/);
  // Nova mensagem do lead: a IA não é chamada.
  const ia = criarIaFalsa([]);
  const { r } = await falar(tel, 'alô?', ia);
  assert.equal(r.acao, 'humano');
  assert.equal(ia.chamadas, 0);

  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('adm-sofia@teste.local');
    assert.match((await adm.get('/conversas?filtro=humano')).texto, /Com a equipe/);
    assert.match((await adm.get(`/conversas/${conv.id}`)).texto, /alô\?/);
    await adm.post(`/conversas/${conv.id}/responder`, { texto: 'Oi! Aqui é o Guilherme.' });
    assert.equal((await um(`SELECT count(*)::int n FROM fila_envio WHERE contato_id = $1 AND tipo = 'aviso' AND texto LIKE 'Oi! Aqui%'`, [conv.contato_id])).n, 1);
    await adm.post(`/conversas/${conv.id}/devolver`, {});
    assert.equal((await um('SELECT estado FROM conversa WHERE id = $1', [conv.id])).estado, 'sofia');
    assert.equal((await um(`SELECT count(*)::int n FROM historico WHERE entidade = 'conversa' AND entidade_id = $1 AND acao = 'conversa.devolvida_sofia'`, [conv.id])).n, 1);
    // PER-03: professor não abre as conversas.
    const prof = cliente(painel.base);
    await prof.entrar('prof-sofia@teste.local');
    assert.equal((await prof.get('/conversas')).status, 403);
    assert.equal((await prof.post(`/conversas/${conv.id}/assumir`, {})).status, 403);
    assert.equal((await prof.get('/sofia')).status, 403);
  } finally { await painel.fechar(); }
  const { s } = await falar(tel, 'voltei', criarIaFalsa(['Oi de novo!']));
  assert.equal(s.respondeu, true);
});

test('SOF-11 LES-03 lead entra na lista de espera e sai dela ao marcar a experimental', opc, async () => {
  const tel = novoTel();
  await falar(tel, 'queria quarta 8h mas está cheio', criarIaFalsa([
    { ferramentas: [{ nome: 'entrar_lista_espera', entrada: { data: '2026-12-02', hora: '08:00' } }] },
    'Pronto, você está na lista de espera.',
  ]));
  const ct = await um('SELECT id FROM contato WHERE telefone = $1', [tel]);
  const le = await um(`SELECT * FROM lista_espera WHERE contato_id = $1`, [ct.id]);
  assert.equal(le.tipo, 'experimental');
  assert.equal(le.saiu_em, null);
  await falar(tel, 'pode ser outro', criarIaFalsa(verEMarcar([{ nome: 'Lia Espera', data_nascimento: '1992-04-04', eh_quem_conversa: true }])));
  const depois = await um('SELECT * FROM lista_espera WHERE id = $1', [le.id]);
  assert.ok(depois.saiu_em);
  assert.equal(depois.motivo_saida, 'marcou experimental');
});

test('SOF-12 custo da IA registrado por chamada, com tokens e valor', opc, async () => {
  const tel = novoTel();
  await falar(tel, 'oi', criarIaFalsa([
    { ferramentas: [{ nome: 'salvar_dados', entrada: { nome: 'Teo' } }], tokensEntrada: 1000, tokensSaida: 100, cacheLeitura: 2000 },
    { texto: 'Prazer, Teo!', tokensEntrada: 500, tokensSaida: 50 },
  ]));
  const conv = await um('SELECT v.id FROM conversa v JOIN contato c ON c.id = v.contato_id WHERE c.telefone = $1', [tel]);
  const custos = await todos('SELECT * FROM custo_ia WHERE conversa_id = $1 ORDER BY id', [conv.id]);
  assert.equal(custos.length, 2);
  assert.equal(custos[0].modelo, 'claude-opus-5-5');
  assert.equal(custos[0].tokens_entrada, 3000);
  // Opus 5.5: entrada 4, saída 20, cache 0,20 por milhão.
  assert.equal(Number(custos[0].custo_usd), (1000 * 4 + 2000 * 0.2 + 100 * 20) / 1e6);
  assert.equal(Number(custos[1].custo_usd), (500 * 4 + 50 * 20) / 1e6);
});

test('OPR-02 SOF-01 nunca responde em dobro e junta mensagens seguidas numa resposta', opc, async () => {
  const tel = novoTel();
  const ia = criarIaFalsa(['Oi! Qual seu nome?']);
  const { r } = await falar(tel, 'oi', ia);
  const s2 = await atender({ pool, ia, conversaId: r.conversaId, log: silencioso });
  assert.equal(s2.respondeu, false);
  assert.equal(s2.motivo, 'já respondida');
  assert.equal(ia.chamadas, 1);
  // Três mensagens seguidas → uma chamada à IA.
  const ia2 = criarIaFalsa(['Entendi tudo!']);
  const sofia = criarSofia({ pool, ia: ia2, agruparMs: 50, log: silencioso });
  for (const t of ['tenho', 'uma', 'dúvida']) {
    const x = await receberMensagem(pool, { de: tel, texto: t, em: agora() });
    await sofia.aoLead(x);
  }
  await new Promise(ok => setTimeout(ok, 300));
  assert.equal(ia2.chamadas, 1);
  const ult = ia2.historico[0].mensagens.slice(-3).map(m => m.texto);
  assert.deepEqual(ult, ['tenho', 'uma', 'dúvida']);
  // Aluno ativo (SOF-01): mensagem fixa, IA não é chamada.
  const telAluno = novoTel();
  const c = await um(`INSERT INTO contato (nome, telefone, tipo) VALUES ('Aluno', $1, 'aluno') RETURNING id`, [telAluno]);
  await pool.query(`INSERT INTO aluno (contato_id) VALUES ($1)`, [c.id]);
  const ia3 = criarIaFalsa([]);
  const { r: r3 } = await falar(telAluno, 'oi', ia3);
  assert.equal(r3.acao, 'fixa');
  assert.equal(ia3.chamadas, 0);
});

test('SOF-09 IA fora do ar ou recusando: não responde besteira e avisa a equipe', opc, async () => {
  const tel = novoTel();
  const { s } = await falar(tel, 'oi', criarIaFalsa([new Error('overloaded')]));
  assert.equal(s.respondeu, false);
  const conv = await um('SELECT v.id FROM conversa v JOIN contato c ON c.id = v.contato_id WHERE c.telefone = $1', [tel]);
  assert.equal((await um(`SELECT count(*)::int n FROM fila_envio WHERE chave_unica LIKE $1`, [`ia-falha:${conv.id}:%`])).n, 1);
  assert.equal((await um(`SELECT count(*)::int n FROM fila_envio WHERE contato_id = (SELECT contato_id FROM conversa WHERE id = $1)`, [conv.id])).n, 0);
  // Recusa: passa para a equipe e avisa o lead.
  const { s: s2 } = await falar(tel, 'oi de novo', criarIaFalsa([{ parada: 'refusal' }]));
  assert.equal(s2.respondeu, true);
  assert.match(s2.texto, /equipe/);
  assert.equal((await um('SELECT estado FROM conversa WHERE id = $1', [conv.id])).estado, 'humano');
});

test('SOF-10 admin cadastra anexo no painel e a Sofia manda o arquivo quando pedem', opc, async () => {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-teste-anexos-'));
  process.env.SOFIA_ANEXOS_DIR = pasta;
  try {
  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('adm-sofia@teste.local');
    const enviar = async (nomeArq, tipo, dados) => {
      const fd = new FormData();
      fd.append('nome', 'Fotos da quadra'); fd.append('descricao', 'quando pedirem para ver a escola');
      fd.append('arquivo', new Blob([dados], { type: tipo }), nomeArq);
      const r = await fetch(painel.base + '/sofia/anexos', { method: 'POST', body: fd, redirect: 'manual', headers: { cookie: adm.cookie, origin: painel.base } });
      return decodeURIComponent(r.headers.get('location') || '');
    };
    assert.match(await enviar('virus.png', 'image/png', Buffer.from('MZ não é imagem')), /JPG\/PNG ou PDF/);
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(64, 1)]);
    assert.match(await enviar('quadra.png', 'image/png', png), /Anexo adicionado/);
    assert.match((await adm.get('/sofia')).texto, /Fotos da quadra/);
  } finally { await painel.fechar(); }
  const a = await um('SELECT * FROM sofia_anexo WHERE ativo ORDER BY id DESC LIMIT 1');
  assert.ok(a.arquivo.startsWith(pasta));
  assert.deepEqual(fs.readFileSync(a.arquivo).slice(0, 4).toString('hex'), '89504e47');
  const tel = novoTel();
  let pedido;
  await falar(tel, 'tem foto da quadra?', criarIaFalsa([
    p => { pedido = p; return { ferramentas: [{ nome: 'enviar_anexo', entrada: { anexo_id: a.id } }] }; },
    'Mandei as fotos!',
  ]));
  assert.match(pedido.sistemaDoMomento, /id \d+: Fotos da quadra/);
  // O laço de envio manda o arquivo pelo WhatsApp.
  const wa = criarWhatsappFalso();
  await pool.query(`UPDATE mensagem SET em = em - interval '2 days' WHERE direcao = 'saida'`);
  await pool.query(`UPDATE fila_envio SET agendado_para = now() + interval '1 day' WHERE enviado_em IS NULL AND anexo_id IS NULL`);
  const r = await processarUm({ pool, wa, log: silencioso, aleatorio: () => 0 });
  assert.equal(r.enviado, true);
  assert.equal(wa.enviadas[0].arquivo, a.arquivo);
  assert.equal(wa.enviadas[0].para, tel);
  } finally { fs.rmSync(pasta, { recursive: true, force: true }); delete process.env.SOFIA_ANEXOS_DIR; }
});

test('SOF-10 SOF-12 tela Sofia: admin muda instruções com versão e vê o custo', opc, async () => {
  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('adm-sofia@teste.local');
    const r = await adm.post('/sofia/config', { ligada: '1', modelo: 'claude-opus-5-5', agrupar: '5', instrucoes: 'Rua das Quadras, 10. Traga tênis de sola clara.', motivo: 'endereço' });
    assert.match(decodeURIComponent(r.local), /salva/);
    const t = (await adm.get('/sofia')).texto;
    assert.match(t, /Rua das Quadras/);
    assert.match(t, /Este mês: US\$/);
    assert.equal((await um(`SELECT count(*)::int n FROM historico WHERE acao = 'regra.alterada' AND depois->>'chave' = 'sofia.instrucoes'`)).n, 1);
  } finally { await painel.fechar(); }
  let pedido;
  await falar(novoTel(), 'onde fica?', criarIaFalsa([p => { pedido = p; return 'Rua das Quadras, 10.'; }]));
  assert.match(pedido.sistemaFixo, /INFORMAÇÕES DA PLAY SQUASH[\s\S]*Rua das Quadras/);
  // Desligada: não responde.
  await pool.query(`INSERT INTO regra_config (chave, valor) VALUES ('sofia.ligada', 'false')`);
  const ia = criarIaFalsa([]);
  const { s } = await falar(novoTel(), 'oi', ia);
  assert.equal(s.motivo, 'Sofia desligada');
  assert.equal(ia.chamadas, 0);
});

void SENHA;
