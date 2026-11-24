const { test } = require('node:test');
const assert = require('node:assert/strict');
const { agendaConfirmacao } = require('../../src/regras/confirmacao');
const { instanteSP } = require('../../src/relogio');

test('CNF-01 experimental amanhã 18h: pedido hoje 19h, reenvio 15h, cancelamento 16h30', () => {
  const r = agendaConfirmacao({ inicioAula: instanteSP('2026-12-02', '18:00'), marcadaEm: instanteSP('2026-12-01', '10:00') });
  assert.equal(r.nasceConfirmada, false);
  assert.equal(r.pedido, instanteSP('2026-12-01', '19:00'));
  assert.equal(r.reenvio, instanteSP('2026-12-02', '15:00'));
  assert.equal(r.cancelamento, instanteSP('2026-12-02', '16:30'));
});

test('CNF-01 cancelamento desligado: nada é cancelado', () => {
  const r = agendaConfirmacao({ inicioAula: instanteSP('2026-12-02', '18:00'), marcadaEm: instanteSP('2026-11-30', '10:00') }, { cancelamentoLigado: false });
  assert.equal(r.cancelamento, null);
  assert.notEqual(r.pedido, null);
});

test('CNF-01 véspera no 1º do mês (aula em 01/01 → pedido em 31/12)', () => {
  const r = agendaConfirmacao({ inicioAula: instanteSP('2027-01-01', '09:00'), marcadaEm: instanteSP('2026-12-20', '10:00') });
  assert.equal(r.pedido, instanteSP('2026-12-31', '19:00'));
});

test('CNF-04 marcada às 21h da véspera nasce confirmada, sem cancelamento automático', () => {
  const r = agendaConfirmacao({ inicioAula: instanteSP('2026-12-02', '18:00'), marcadaEm: instanteSP('2026-12-01', '21:00') });
  assert.deepEqual(r, { nasceConfirmada: true, pedido: null, reenvio: null, cancelamento: null });
});

test('CNF-04 marcada no próprio dia nasce confirmada', () => {
  const r = agendaConfirmacao({ inicioAula: instanteSP('2026-12-02', '18:00'), marcadaEm: instanteSP('2026-12-02', '09:00') });
  assert.equal(r.nasceConfirmada, true);
});
