const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { normalizar, variantes, chatId } = require('../../src/whatsapp/telefone');
const ritmo = require('../../src/whatsapp/ritmo');
const estado = require('../../src/whatsapp/estado');
const { criarClienteWhatsapp } = require('../../src/whatsapp/cliente');
const { instanteSP } = require('../../src/relogio');

test('OPR-11 telefone guardado sempre com o 9 e procurado com e sem o 9', () => {
  assert.equal(normalizar('(62) 99999-0001'), '+5562999990001');
  assert.equal(normalizar('556299990001@c.us'), '+5562999990001'); // conta antiga, sem o 9
  assert.equal(normalizar('+55 62 3333-4444'), '+556233334444'); // fixo não ganha 9
  assert.equal(normalizar('123'), null);
  assert.deepEqual(variantes('+5562999990001'), ['+5562999990001', '+556299990001']);
  assert.deepEqual(variantes('+556233334444'), ['+556233334444']);
  assert.equal(chatId('+5562999990001'), '5562999990001@c.us');
});

const t0 = instanteSP('2026-12-01', '10:00');
const MIN = 60000;

test('OPR-02 limite por hora: com 40 saídas na última hora, espera a mais antiga sair da janela', () => {
  const saidas = Array.from({ length: 40 }, (_, i) => t0 - (59 - i) * MIN);
  const d = ritmo.decidir({ agora: t0, tipo: 'aviso', saidas });
  assert.equal(d.pode, false);
  assert.equal(d.motivo, 'limite por hora');
  assert.equal(d.aPartirDe, saidas[0] + 60 * MIN);
  assert.equal(ritmo.decidir({ agora: t0, tipo: 'aviso', saidas: saidas.slice(1) }).pode, true);
});

test('OPR-02 campanha só na janela e nunca para quem está conversando; aviso não espera', () => {
  const cedo = instanteSP('2026-12-01', '07:00');
  assert.deepEqual(ritmo.decidir({ agora: cedo, tipo: 'campanha', saidas: [] }), { pode: false, motivo: 'fora da janela de campanhas', aPartirDe: instanteSP('2026-12-01', '08:00') });
  assert.equal(ritmo.decidir({ agora: cedo, tipo: 'aviso', saidas: [] }).pode, true);
  const tarde = instanteSP('2026-12-01', '21:00');
  assert.equal(ritmo.decidir({ agora: tarde, tipo: 'campanha', saidas: [] }).aPartirDe, instanteSP('2026-12-02', '08:00'));
  const conversa = ritmo.decidir({ agora: t0, tipo: 'campanha', saidas: [], ultimaConversa: t0 - 10 * MIN });
  assert.deepEqual(conversa, { pode: false, motivo: 'contato conversando', aPartirDe: t0 + 20 * MIN });
});

test('OPR-02 intervalo aleatório entre mensagens fica entre o mínimo e o máximo', () => {
  assert.equal(ritmo.intervalo(ritmo.PADRAO, () => 0), 20000);
  assert.equal(ritmo.intervalo(ritmo.PADRAO, () => 1), 60000);
  const v = ritmo.intervalo(ritmo.PADRAO);
  assert.ok(v >= 20000 && v <= 60000);
});

test('OPR-03 "SAIR" e variações tiram das campanhas; frase comum não', () => {
  for (const t of ['SAIR', 'sair', ' Parar ', 'stop', 'não quero mais receber mensagens']) assert.equal(ritmo.pedeSair(t), true, t);
  for (const t of ['quero sair mais cedo amanhã', 'oi', '']) assert.equal(ritmo.pedeSair(t), false, t);
});

// whatsapp-web.js falso: Client emite eventos; getNumberId só conhece a forma sem o 9.
function libFalsa() {
  const enviadas = [];
  class Client extends EventEmitter {
    constructor(opcoes) { super(); this.opcoes = opcoes; this.info = { wid: { user: '5562988887777' } }; Client.ultimo = this; }
    async initialize() {}
    async destroy() {}
    async getNumberId(n) { return n === '556299990001' ? { _serialized: n + '@c.us' } : null; }
    async sendMessage(id, texto) { enviadas.push({ id, texto }); return { id: { _serialized: 'msg1' } }; }
  }
  class LocalAuth { constructor(o) { this.o = o; } }
  return { lib: { Client, LocalAuth }, enviadas, Client };
}

test('OPR-01/OPR-04 cliente real: QR, conectado, envio com o número certo, só conversas individuais e religa ao cair', async () => {
  const { lib, enviadas, Client } = libFalsa();
  const recebidas = [];
  const wa = criarClienteWhatsapp({ lib, sessaoDir: '/tmp/ps-teste-sessao', religarMs: 10, log: { log() {}, error() {} } });
  wa.aoReceber(e => recebidas.push(e));
  await wa.iniciar();
  const c = Client.ultimo;
  assert.equal(c.opcoes.authStrategy.o.dataPath, '/tmp/ps-teste-sessao');
  await assert.rejects(wa.enviar('+5562999990001', 'oi'), /desconectado/);
  c.emit('qr', 'codigo-qr');
  await new Promise(r => setTimeout(r, 50));
  assert.equal(estado.ler().situacao, 'aguardando_qr');
  assert.match(estado.ler().qr || '', /^data:image\/png;base64,/);
  c.emit('ready');
  assert.equal(wa.conectado, true);
  assert.equal(estado.ler().numero, '+5562988887777');
  assert.deepEqual(await wa.enviar('+5562999990001', 'Olá'), { id: 'msg1' });
  assert.deepEqual(enviadas, [{ id: '556299990001@c.us', texto: 'Olá' }]); // achou a forma sem o 9
  await assert.rejects(wa.enviar('+5562911112222', 'x'), /sem WhatsApp/);
  c.emit('message', { from: '5562999990001@c.us', body: 'oi', fromMe: false, timestamp: 1 });
  c.emit('message', { from: '120363@g.us', body: 'grupo', fromMe: false });
  c.emit('message', { from: '5562999990001@c.us', body: 'eu mesmo', fromMe: true });
  assert.deepEqual(recebidas.filter(e => e.tipo === 'mensagem').map(e => e.texto), ['oi']);
  c.emit('disconnected', 'LOGOUT');
  assert.equal(wa.conectado, false);
  assert.equal(estado.ler().situacao, 'desconectado');
  await new Promise(r => setTimeout(r, 50));
  assert.notEqual(Client.ultimo, c, 'criou um cliente novo para religar');
  await wa.parar();
  assert.equal(estado.ler().situacao, 'desligado');
});

test('OPR-04 aviso ao admin só depois de 10 min fora do ar (desligado de propósito não avisa)', () => {
  estado.mudar('desconectado');
  assert.equal(estado.precisaAviso(Date.now()), false);
  assert.equal(estado.precisaAviso(Date.now() + 11 * MIN), true);
  estado.mudar('desligado');
  assert.equal(estado.precisaAviso(Date.now() + 60 * MIN), false);
  estado.zerar();
});
