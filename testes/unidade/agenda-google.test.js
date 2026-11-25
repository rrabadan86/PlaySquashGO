const { test } = require('node:test');
const assert = require('node:assert/strict');
const { criarGoogleAgenda } = require('../../src/agenda/google');
const { montarEvento, esperaMin } = require('../../src/agenda/evento');
const { feriadosNacionais, pascoa } = require('../../src/regras/feriados');
const { instanteSP } = require('../../src/relogio');
const { csv } = require('../../src/painel/rotas-aulas');

// fetch falso que registra as chamadas e responde por ordem.
function fetchFalso(respostas) {
  const chamadas = [];
  const f = async (url, o) => {
    chamadas.push({ url, metodo: o.method, corpo: o.body ? JSON.parse(o.body) : null, auth: o.headers.Authorization });
    const r = respostas.shift() || { status: 200, json: {} };
    return { ok: r.status < 400, status: r.status, statusText: 'x', json: async () => r.json };
  };
  return { f, chamadas };
}

test('AGD-09 conta de serviço: cria agenda da quadra no fuso de Brasília e compartilha só para leitura', async () => {
  const { f, chamadas } = fetchFalso([{ status: 200, json: { id: 'ag1@group' } }, { status: 200, json: {} }]);
  const g = criarGoogleAgenda({ token: async () => 'TOKEN', fetch: f });
  assert.deepEqual(await g.criarAgenda('Play Squash — Quadra 1'), { id: 'ag1@group' });
  await g.compartilhar('ag1@group', 'prof@exemplo.com');
  assert.equal(chamadas[0].corpo.timeZone, 'America/Sao_Paulo');
  assert.equal(chamadas[0].auth, 'Bearer TOKEN');
  assert.match(chamadas[1].url, /\/calendars\/ag1%40group\/acl/);
  assert.deepEqual(chamadas[1].corpo, { role: 'reader', scope: { type: 'user', value: 'prof@exemplo.com' } });
});

test('AGD-09 evento vai com horário de Brasília, cor e id da aula; apagar o que já não existe não é erro', async () => {
  const { f, chamadas } = fetchFalso([{ status: 200, json: { id: 'ev9' } }, { status: 410, json: {} }, { status: 500, json: { error: { message: 'backend' } } }]);
  const g = criarGoogleAgenda({ token: async () => 'T', fetch: f });
  const inicio = instanteSP('2026-12-01', '18:00');
  await g.criarEvento('ag1', { titulo: 'Aula — Ana', inicio, fim: inicio + 1800000, cor: 10, privado: { aulaId: 7 } });
  assert.deepEqual(chamadas[0].corpo.start, { dateTime: '2026-12-01T21:00:00.000Z', timeZone: 'America/Sao_Paulo' });
  assert.equal(chamadas[0].corpo.colorId, '10');
  assert.deepEqual(chamadas[0].corpo.extendedProperties, { private: { aulaId: '7' } });
  await g.apagarEvento('ag1', 'ev9'); // 410: já apagado
  await assert.rejects(g.apagarEvento('ag1', 'ev9'), /Google 500: backend/);
});

test('AGD-09 título padrão e cor por tipo de aula; experimental confirmada ganha ✓', () => {
  const base = { id: 3, tipo: 'Individual', professor: 'Guilherme', quadra: 'Quadra 1', inicio: 1, fim: 2 };
  assert.equal(montarEvento({ ...base, origem: 'experimental', situacao: 'confirmada', categoria: 'individual', alunos: ['Rafael Lima'] }).titulo, 'Experimental — Rafael Lima ✓');
  const d = montarEvento({ ...base, origem: 'fixa', situacao: 'marcada', categoria: 'dupla', alunos: ['Carla', 'Diego'] });
  assert.equal(d.titulo, 'Aula — Carla + Diego (dupla)');
  assert.equal(d.cor, 3);
  assert.equal(montarEvento({ ...base, origem: 'reposicao', situacao: 'marcada', categoria: 'individual', alunos: ['Júlia'] }).cor, 9);
});

test('AGD-09 nova tentativa espera cada vez mais e nunca desiste', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map(esperaMin), [1, 5, 15, 60, 180, 360, 360]);
});

test('AGD-03 feriados nacionais fixos e Sexta-feira Santa calculada pela Páscoa', () => {
  assert.equal(pascoa(2026), '2026-04-05');
  assert.equal(pascoa(2027), '2027-03-28');
  const f27 = feriadosNacionais(2027);
  assert.equal(f27.length, 10);
  assert.deepEqual(f27.find(f => f.nome === 'Sexta-feira Santa'), { data: '2027-03-26', nome: 'Sexta-feira Santa' });
  assert.ok(f27.some(f => f.data === '2027-11-20'));
  assert.ok(!f27.some(f => /Carnaval|Corpus/.test(f.nome)));
});

test('OPR-06 exportação em CSV do Excel: ";" , acento e fórmula neutralizada', () => {
  const t = csv([{ nome: 'Júlia; "Ju"', valor: 550.5, obs: '=SOMA(A1)' }]);
  assert.ok(t.startsWith('﻿'));
  assert.equal(t.trim().split('\r\n')[1], '"Júlia; ""Ju""";550,5;\'=SOMA(A1)');
});
