const { test } = require('node:test');
const assert = require('node:assert/strict');
const relogio = require('../../src/relogio');

test('OPR-08 18h em Brasília continua 18h, qualquer que seja o fuso do servidor', () => {
  const t = relogio.instanteSP('2026-12-01', '18:00');
  assert.equal(new Date(t).toISOString(), '2026-12-01T21:00:00.000Z');
  assert.equal(relogio.dataSP(t), '2026-12-01');
});

test('TST-06 PS_AGORA fixa o relógio só em teste', () => {
  const antes = { e: process.env.NODE_ENV, a: process.env.PS_AGORA };
  try {
    process.env.NODE_ENV = 'test';
    process.env.PS_AGORA = '2027-02-28T23:30:00-03:00';
    assert.equal(relogio.hojeSP(), '2027-02-28');
    assert.equal(relogio.hojeSP(1), '2027-03-01');
    process.env.NODE_ENV = 'production';
    assert.notEqual(relogio.agora(), Date.parse('2027-02-28T23:30:00-03:00'));
  } finally {
    process.env.NODE_ENV = antes.e; process.env.PS_AGORA = antes.a;
    if (antes.a === undefined) delete process.env.PS_AGORA;
  }
});

test('TST-06 datas difíceis: fim de fevereiro em ano bissexto e domingo', () => {
  assert.equal(relogio.somarDias('2028-02-28', 1), '2028-02-29');
  assert.equal(relogio.somarDias('2027-02-28', 1), '2027-03-01');
  assert.equal(relogio.diaSemana('2026-11-29'), 0);
});
