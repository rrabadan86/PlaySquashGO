const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarWhatsappFalso } = require('../simuladores/whatsapp-falso');
const { criarIaFalsa } = require('../simuladores/ia-falsa');
const { criarGoogleFalso } = require('../simuladores/google-falso');

test('TST-08 WhatsApp falso guarda envios, entrega recebidas e avisa desconexão', async () => {
  const wa = criarWhatsappFalso();
  const eventos = [];
  wa.aoReceber(e => eventos.push(e));
  await wa.enviar('+5562900000001', 'Olá');
  wa.receber('+5562900000001', 'sim');
  assert.equal(wa.para('+5562900000001').length, 1);
  assert.deepEqual(eventos[0], { tipo: 'mensagem', de: '+5562900000001', texto: 'sim' });
  wa.desconectar();
  await assert.rejects(wa.enviar('+5562900000001', 'x'), /desconectado/);
  assert.equal(eventos[1].tipo, 'desconectado');
});

test('TST-08 IA falsa responde pelo roteiro e conta as chamadas', async () => {
  const ia = criarIaFalsa(['Oi! Qual seu nome?', { texto: 'ok', tokensEntrada: 100, tokensSaida: 20 }]);
  assert.equal((await ia.responder([])).texto, 'Oi! Qual seu nome?');
  assert.equal((await ia.responder([])).tokensSaida, 20);
  assert.equal(ia.chamadas, 2);
  await assert.rejects(ia.responder([]), /roteiro acabou/);
});

test('TST-08 Google falso cria, atualiza, apaga e simula indisponibilidade', async () => {
  const g = criarGoogleFalso();
  const { id } = await g.criarEvento('quadra-1', { titulo: 'Experimental — Rafael' });
  await g.atualizarEvento('quadra-1', id, { titulo: 'Experimental — Rafael ✓' });
  assert.equal(g.eventos('quadra-1')[0].titulo, 'Experimental — Rafael ✓');
  g.falharProximas(1);
  await assert.rejects(g.apagarEvento('quadra-1', id), /indisponível/);
  await g.apagarEvento('quadra-1', id);
  assert.equal(g.eventos('quadra-1').length, 0);
});
