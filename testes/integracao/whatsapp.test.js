/**
 * Fila de envio e recebimento do WhatsApp com banco de TESTE e WhatsApp simulado (TST-01).
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { URL_TESTE, prepararBanco, criarUsuario, subirPainel, cliente } = require('../ajuda');
const { criarWhatsappFalso } = require('../simuladores/whatsapp-falso');
const { enfileirar, processarUm, aConferir } = require('../../src/whatsapp/envio');
const { receberMensagem } = require('../../src/whatsapp/recebimento');
const estado = require('../../src/whatsapp/estado');
const { tx } = require('../../src/db');

const opc = { skip: URL_TESTE ? false : 'sem DATABASE_URL_TESTE' };
const silencioso = { error() {}, log() {} };
let pool, wa;
const enviar = (o = {}) => processarUm({ pool, wa, log: silencioso, aleatorio: () => 0, ...o });
const contato = async (nome, tel, tipo = 'lead') => (await pool.query(
  'INSERT INTO contato (nome, telefone, tipo) VALUES ($1,$2,$3) RETURNING id', [nome, tel, tipo])).rows[0].id;
// Zera o registro de saídas (para o intervalo mínimo entre mensagens não atrapalhar o próximo teste).
const esquecerSaidas = () => pool.query(`UPDATE mensagem SET em = em - interval '2 days' WHERE direcao = 'saida'`);

before(async () => { if (URL_TESTE) { pool = await prepararBanco(); wa = criarWhatsappFalso(); } });
after(async () => { if (pool) await pool.end(); });

test('OPR-10 mesma mensagem não entra duas vezes; enviada fica registrada', opc, async () => {
  const c = await contato('Ana', '+5562900000001');
  const a = await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'aviso', texto: 'Sua aula foi remarcada', chaveUnica: 'teste:1' }));
  const b = await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'aviso', texto: 'Sua aula foi remarcada', chaveUnica: 'teste:1' }));
  assert.ok(a); assert.equal(b, null);
  const r = await enviar();
  assert.equal(r.enviado, true);
  assert.equal(r.esperarMs, 20000);
  assert.deepEqual(wa.para('+5562900000001').map(m => m.texto), ['Sua aula foi remarcada']);
  const m = (await pool.query(`SELECT * FROM mensagem WHERE fila_envio_id = $1`, [a])).rows;
  assert.equal(m.length, 1);
  assert.equal(m[0].direcao, 'saida');
  assert.equal((await enviar()).enviado, false); // nada mais na fila (e intervalo mínimo)
  await esquecerSaidas();
});

test('OPR-10 sistema caiu no meio do envio: item fica "a conferir" e nunca é reenviado sozinho', opc, async () => {
  const c = await contato('Bruno', '+5562900000002');
  const id = await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'aviso', texto: 'Teste de queda' }));
  await pool.query(`UPDATE fila_envio SET enviando_em = now() - interval '10 minutes', tentativas = 1 WHERE id = $1`, [id]);
  wa.limpar();
  await enviar();
  assert.equal(wa.enviadas.length, 0);
  assert.deepEqual((await aConferir(pool)).map(f => f.id), [id]);
});

test('OPR-10 admin resolve o "a conferir" pela tela: confirmar registra, reenviar volta para a fila', opc, async () => {
  await pool.query(`INSERT INTO usuario (nome, email, eh_admin, eh_professor, senha_hash) VALUES ('Admin','admin-wa@teste.local',true,true,'x')`);
  const { senhaHash } = { senhaHash: require('../../src/auth/senha').gerarHash('senha-de-teste-1') };
  await pool.query(`UPDATE usuario SET senha_hash = $1 WHERE email = 'admin-wa@teste.local'`, [senhaHash]);
  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('admin-wa@teste.local');
    const [f] = await aConferir(pool);
    assert.match((await adm.get('/whatsapp')).texto, /A conferir/);
    await adm.post(`/whatsapp/fila/${f.id}/reenviar`, {});
    assert.equal((await aConferir(pool)).length, 0);
    assert.equal((await enviar()).enviado, true);
    await esquecerSaidas();
    // queda de novo e confirmação manual
    const c = await contato('Carla', '+5562900000003');
    const id = await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'aviso', texto: 'Outro teste' }));
    await pool.query(`UPDATE fila_envio SET enviando_em = now() - interval '10 minutes' WHERE id = $1`, [id]);
    await adm.post(`/whatsapp/fila/${id}/confirmar`, {});
    const m = (await pool.query('SELECT situacao FROM mensagem WHERE fila_envio_id = $1', [id])).rows[0];
    assert.equal(m.situacao, 'confirmada pelo admin');
    assert.equal((await pool.query(`SELECT count(*)::int n FROM historico WHERE acao IN ('whatsapp.envio_confirmado','whatsapp.reenvio_pedido')`)).rows[0].n, 2);
  } finally { await painel.fechar(); }
});

test('OPR-02 com o limite por hora atingido nada sai; campanha para quem está conversando é adiada e o aviso passa na frente', opc, async () => {
  await pool.query(`UPDATE regra_config SET valor = valor WHERE false`); // (nada) — usa os valores padrão
  const c = await contato('Diego', '+5562900000004');
  await pool.query(`INSERT INTO mensagem (contato_id, direcao, texto, em) SELECT $1, 'saida', 'x', now() - (g || ' minutes')::interval FROM generate_series(1, 40) g`, [c]);
  await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'aviso', texto: 'Aviso bloqueado pelo limite' }));
  const r = await enviar();
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, 'limite por hora');
  await esquecerSaidas();
  await pool.query(`UPDATE fila_envio SET cancelado_em = now() WHERE enviado_em IS NULL AND cancelado_em IS NULL`);
  // Conversando agora: campanha adiada; aviso sai.
  await pool.query(`INSERT INTO mensagem (contato_id, direcao, texto) VALUES ($1, 'entrada', 'oi')`, [c]);
  const camp = await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'campanha', texto: 'Promoção', agendadoPara: Date.now() - 1000 }));
  await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'aviso', texto: 'Aviso urgente' }));
  wa.limpar();
  const agora = () => new Date(new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' }) + 'T12:00:00-03:00').getTime() + (Date.now() % 1000);
  const r2 = await processarUm({ pool, wa, log: silencioso, agora: () => Math.max(Date.now(), agora()) });
  assert.equal(r2.enviado, true);
  assert.deepEqual(wa.enviadas.map(m => m.texto), ['Aviso urgente']);
  const f = (await pool.query('SELECT enviado_em, agendado_para > now() + interval \'10 minutes\' AS adiada FROM fila_envio WHERE id = $1', [camp])).rows[0];
  assert.equal(f.enviado_em, null);
  await esquecerSaidas();
});

test('OPR-03 quem responde SAIR sai das campanhas na hora e recebe confirmação; campanha nova não entra', opc, async () => {
  const c = await contato('Eduarda', '+5562900000005');
  const r2 = await receberMensagem(pool, { de: '5562900000005@c.us', texto: 'SAIR' });
  assert.equal(r2.acao, 'sair');
  assert.equal(r2.contatoId, c);
  assert.equal((await pool.query('SELECT sem_campanha FROM contato WHERE id = $1', [c])).rows[0].sem_campanha, true);
  assert.equal(await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'campanha', texto: 'Promo' })), null);
  const conf = (await pool.query(`SELECT texto FROM fila_envio WHERE contato_id = $1 AND tipo = 'aviso'`, [c])).rows;
  assert.equal(conf.length, 1);
  assert.match(conf[0].texto, /não vai mais receber/);
  assert.equal((await pool.query(`SELECT count(*)::int n FROM historico WHERE acao = 'contato.saiu_das_campanhas' AND entidade_id = $1`, [c])).rows[0].n, 1);
});

test('OPR-11 mensagem de conta antiga (sem o 9) cai no mesmo contato', opc, async () => {
  const c = await contato('Felipe', '+5562988880006');
  const r = await receberMensagem(pool, { de: '556288880006@c.us', texto: 'oi' });
  assert.equal(r.contatoId, c);
});

test('SOF-01 aluno ativo e responsável recebem a mensagem fixa no máximo uma vez por dia; lead vai para a Sofia', opc, async () => {
  const c = await contato('Gabriela', '+5562900000007', 'aluno');
  await pool.query(`INSERT INTO aluno (contato_id) VALUES ($1)`, [c]);
  const resp = await contato('Renata', '+5562900000008', 'responsavel');
  const kid = await contato('Laura', null, 'aluno');
  await pool.query(`INSERT INTO aluno (contato_id, responsavel_contato_id) VALUES ($1,$2)`, [kid, resp]);
  assert.equal((await receberMensagem(pool, { de: '5562900000007@c.us', texto: 'oi, quero remarcar' })).acao, 'fixa');
  assert.equal((await receberMensagem(pool, { de: '5562900000007@c.us', texto: 'alô?' })).acao, 'fixa');
  assert.equal((await pool.query(`SELECT count(*)::int n FROM fila_envio WHERE contato_id = $1 AND tipo = 'fixa'`, [c])).rows[0].n, 1);
  assert.equal((await receberMensagem(pool, { de: '5562900000008@c.us', texto: 'oi' })).acao, 'fixa');
  const novo = await receberMensagem(pool, { de: '5562977776666@c.us', texto: 'Oi, queria fazer uma aula' });
  assert.equal(novo.acao, 'sofia');
  assert.ok(novo.conversaId);
  const ct = (await pool.query('SELECT tipo, origem FROM contato WHERE id = $1', [novo.contatoId])).rows[0];
  assert.deepEqual(ct, { tipo: 'lead', origem: 'whatsapp' });
  assert.equal((await pool.query('SELECT count(*)::int n FROM mensagem WHERE contato_id = $1 AND conversa_id = $2', [novo.contatoId, novo.conversaId])).rows[0].n, 1);
});

test('SOF-09 conversa em atendimento humano não vai para a Sofia; número da equipe só é registrado', opc, async () => {
  const r = await receberMensagem(pool, { de: '5562977776666@c.us', texto: 'oi de novo' });
  await pool.query(`UPDATE conversa SET estado = 'humano' WHERE id = $1`, [r.conversaId]);
  assert.equal((await receberMensagem(pool, { de: '5562977776666@c.us', texto: 'tem alguém aí?' })).acao, 'humano');
  const prof = await criarUsuario(pool, { nome: 'Prof', email: 'prof-wa@teste.local' });
  await pool.query(`UPDATE usuario SET telefone = '+5562955554444' WHERE id = $1`, [prof]);
  assert.equal((await receberMensagem(pool, { de: '5562955554444@c.us', texto: 'bom dia' })).acao, 'equipe');
});

test('OPR-01 WhatsApp desconectado: nada é enviado e a mensagem continua na fila', opc, async () => {
  const c = await contato('Helena', '+5562900000009');
  const id = await tx(pool, k => enfileirar(k, { contatoId: c, tipo: 'aviso', texto: 'Espera conexão' }));
  wa.desconectar(); wa.limpar();
  const r = await enviar();
  assert.equal(r.motivo, 'whatsapp desconectado');
  assert.equal(wa.enviadas.length, 0);
  assert.equal((await pool.query('SELECT enviado_em, enviando_em FROM fila_envio WHERE id = $1', [id])).rows[0].enviando_em, null);
  wa.conectar();
});

test('OPR-04 painel do admin mostra o aviso quando o WhatsApp está fora do ar há mais de 10 min', opc, async () => {
  const painel = await subirPainel(pool);
  try {
    const adm = cliente(painel.base);
    await adm.entrar('admin-wa@teste.local');
    estado.mudar('desconectado');
    assert.doesNotMatch((await adm.get('/grade')).texto, /WhatsApp da Play Squash está desconectado/);
    estado._estado.desde = Date.now() - 11 * 60000;
    assert.match((await adm.get('/grade')).texto, /WhatsApp da Play Squash está desconectado/);
  } finally { estado.zerar(); await painel.fechar(); }
});
