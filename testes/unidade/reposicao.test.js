const { test } = require('node:test');
const assert = require('node:assert/strict');
const { desmarcar, validadeCredito, creditoValido } = require('../../src/regras/reposicao');
const { instanteSP } = require('../../src/relogio');

const aula18h = instanteSP('2026-12-10', '18:00');

test('REP-01 desmarcar com exatamente 3 h de antecedência gera crédito', () => {
  const r = desmarcar({ inicioAula: aula18h, desmarcadoEm: instanteSP('2026-12-10', '15:00'), origemAula: 'fixa' });
  assert.equal(r.geraCredito, true);
  assert.equal(r.contaComoDada, false);
});

test('REP-02 desmarcar com 2h59 conta como dada e não gera crédito', () => {
  const r = desmarcar({ inicioAula: aula18h, desmarcadoEm: instanteSP('2026-12-10', '15:01'), origemAula: 'fixa' });
  assert.equal(r.geraCredito, false);
  assert.equal(r.contaComoDada, true);
});

test('REP-02 aula que já começou não gera crédito', () => {
  const r = desmarcar({ inicioAula: aula18h, desmarcadoEm: aula18h + 60000, origemAula: 'fixa' });
  assert.equal(r.geraCredito, false);
});

test('REP-03 validade conta da data da aula desmarcada, não do dia da desmarcação', () => {
  const r = desmarcar({ inicioAula: aula18h, desmarcadoEm: instanteSP('2026-12-01', '09:00'), origemAula: 'fixa' });
  assert.equal(r.validoAte, '2026-12-17');
});

test('REP-03 validade atravessa a virada do ano e respeita o dia em Brasília', () => {
  assert.equal(validadeCredito(instanteSP('2026-12-28', '21:30')), '2027-01-04');
  // 23h30 em Brasília já é dia seguinte em UTC: vale a data de Brasília
  assert.equal(validadeCredito(instanteSP('2027-02-27', '23:30')), '2027-03-06');
  assert.equal(creditoValido('2027-01-04', '2027-01-04'), true);
  assert.equal(creditoValido('2027-01-04', '2027-01-05'), false);
});

test('REP-03 validade editável (10 dias)', () => {
  const r = desmarcar({ inicioAula: aula18h, desmarcadoEm: instanteSP('2026-12-09', '10:00'), origemAula: 'fixa' }, { validadeDias: 10 });
  assert.equal(r.validoAte, '2026-12-20');
});

test('REP-04 desmarcar a própria reposição no prazo não gera novo crédito', () => {
  const r = desmarcar({ inicioAula: aula18h, desmarcadoEm: instanteSP('2026-12-09', '10:00'), origemAula: 'reposicao' });
  assert.equal(r.geraCredito, false);
  assert.equal(r.contaComoDada, false);
});

test('AGD-08 professor desmarca com 5 h de antecedência: aluno ganha crédito', () => {
  const r = desmarcar({ inicioAula: aula18h, desmarcadoEm: instanteSP('2026-12-10', '13:00'), origemAula: 'fixa', quem: 'professor' });
  assert.equal(r.geraCredito, true);
});

test('AGD-08 professor desmarca com 1 h: sem crédito e a aula não conta como dada para o aluno', () => {
  const r = desmarcar({ inicioAula: aula18h, desmarcadoEm: instanteSP('2026-12-10', '17:00'), origemAula: 'fixa', quem: 'professor' });
  assert.equal(r.geraCredito, false);
  assert.equal(r.contaComoDada, false);
});
