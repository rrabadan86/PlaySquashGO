/**
 * Partes puras da Sofia e a ligação com a Anthropic usando um cliente falso (TST-01: nada sai para a rede).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { custoUSD } = require('../../src/sofia/custo');
const { chaveNome, dataValida, idade, periodo } = require('../../src/sofia/texto');
const { criarIaAnthropic, paraApi } = require('../../src/sofia/ia');
const { criarIaFalsa, ultimoResultado } = require('../simuladores/ia-falsa');
const { criarWhatsappFalso } = require('../simuladores/whatsapp-falso');
const { DEFINICOES } = require('../../src/sofia/ferramentas');

test('SOF-12 custo da IA por modelo, com cache de leitura e escrita', () => {
  assert.equal(custoUSD({ modelo: 'claude-opus-5-5', tokensEntrada: 1e6, tokensSaida: 1e6 }), 24);
  assert.equal(custoUSD({ modelo: 'claude-opus-5-5', cacheLeitura: 1e6 }), 0.2);
  assert.equal(custoUSD({ modelo: 'claude-opus-5-5', cacheEscrita: 1e6 }), 5);
  assert.equal(custoUSD({ modelo: 'claude-sonnet-5-5', tokensEntrada: 1e6, tokensSaida: 1e6 }), 12);
  assert.equal(custoUSD({ modelo: 'modelo-novo', tokensEntrada: 1e6 }), 4, 'modelo desconhecido usa o preço do Opus 5.5');
});

test('SOF-06 participante identificado por nome sem acento, caixa e espaços', () => {
  assert.equal(chaveNome('  João   da SILVA '), 'joao da silva');
  assert.equal(chaveNome('Maria-Clara D\'Ávila'), chaveNome('maria clara d avila'));
  assert.equal(dataValida('03/03/2000'), '2000-03-03');
  assert.equal(dataValida('2000-02-30'), null);
  assert.equal(dataValida('ontem'), null);
  assert.equal(idade('2016-12-02', '2026-12-01'), 9);
  assert.equal(idade('2016-12-01', '2026-12-01'), 10);
});

test('SOF-04 período do dia da preferência do lead', () => {
  assert.deepEqual(['08:00', '11:59', '12:00', '17:30', '18:00', '21:00'].map(periodo), ['manha', 'manha', 'tarde', 'tarde', 'noite', 'noite']);
});

test('SOF-02 ferramentas da Sofia têm esquema fechado e nomes únicos', () => {
  const nomes = DEFINICOES.map(d => d.name);
  assert.equal(new Set(nomes).size, nomes.length);
  for (const d of DEFINICOES) {
    assert.equal(d.input_schema.type, 'object', d.name);
    assert.equal(d.input_schema.additionalProperties, false, d.name);
    assert.ok(d.description.length > 20, d.name);
  }
});

test('SOF-09 ligação com a Anthropic: pede fallback, guarda o cache e entende ferramentas e recusa', async () => {
  const pedidos = [];
  const respostas = [
    { stop_reason: 'tool_use', model: 'claude-opus-5-5', content: [{ type: 'thinking', thinking: '' }, { type: 'tool_use', id: 't1', name: 'ver_horarios', input: { pessoas: 1 } }], usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } },
    { stop_reason: 'refusal', model: 'claude-opus-4-8', content: [{ type: 'text', text: 'parcial' }], usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  const cliente = { beta: { messages: { create: async p => { pedidos.push(p); return respostas.shift(); } } } };
  const ia = criarIaAnthropic({ cliente });
  const base = { modelo: 'claude-opus-5-5', sistemaFixo: 'FIXO', sistemaDoMomento: 'AGORA', ferramentas: DEFINICOES };
  const r = await ia.responder({ ...base, mensagens: [{ papel: 'usuario', texto: 'oi' }] });
  assert.deepEqual(r.chamadas, [{ id: 't1', nome: 'ver_horarios', entrada: { pessoas: 1 } }]);
  assert.equal(r.cacheLeitura, 100);
  const p = pedidos[0];
  assert.equal(p.fallbacks, 'default');
  assert.deepEqual(p.betas, ['server-side-fallback-2026-07-01']);
  assert.equal(p.system[0].text, 'FIXO');
  assert.deepEqual(p.system[0].cache_control, { type: 'ephemeral' });
  assert.equal(p.system[1].text, 'AGORA');
  assert.equal(p.thinking, undefined, 'Opus 5.5: pensamento sempre ligado, não se manda "thinking"');
  // Volta com o resultado da ferramenta: o conteúdo bruto (com o bloco de pensamento) vai inteiro.
  const r2 = await ia.responder({ ...base, mensagens: [{ papel: 'usuario', texto: 'oi' }, { papel: 'assistente', bruto: r.bruto }, { papel: 'ferramenta', resultados: [{ id: 't1', conteudo: '{}', erro: false }] }] });
  assert.deepEqual(pedidos[1].messages[1], { role: 'assistant', content: r.bruto });
  assert.deepEqual(pedidos[1].messages[2].content, [{ type: 'tool_result', tool_use_id: 't1', content: '{}', is_error: false }]);
  assert.equal(r2.parada, 'refusal');
  assert.equal(r2.texto, '', 'texto de resposta recusada não vai para o lead');
  assert.equal(r2.modelo, 'claude-opus-4-8', 'custo pelo modelo que respondeu');
  assert.deepEqual(paraApi([{ papel: 'assistente', texto: 'oi' }]), [{ role: 'assistant', content: 'oi' }]);
});

test('TST-08 IA falsa pede ferramentas e lê o resultado; WhatsApp falso manda arquivo', async () => {
  const ia = criarIaFalsa([
    { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1 } }] },
    p => `achei ${ultimoResultado(p).horarios.length}`,
  ]);
  const r1 = await ia.responder({ mensagens: [] });
  assert.equal(r1.parada, 'tool_use');
  assert.equal(r1.chamadas[0].nome, 'ver_horarios');
  const r2 = await ia.responder({ mensagens: [{ papel: 'ferramenta', resultados: [{ id: r1.chamadas[0].id, conteudo: '{"horarios":[1,2]}', erro: false }] }] });
  assert.equal(r2.texto, 'achei 2');
  const wa = criarWhatsappFalso();
  await wa.enviarArquivo('+5562900000001', { arquivo: '/x.pdf', tipoMime: 'application/pdf', legenda: 'Tabela' });
  assert.deepEqual(wa.para('+5562900000001').map(m => [m.arquivo, m.texto]), [['/x.pdf', 'Tabela']]);
  wa.desconectar();
  await assert.rejects(wa.enviarArquivo('+5562900000001', { arquivo: '/x.pdf' }), /desconectado/);
});
