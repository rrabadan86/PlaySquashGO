const { test } = require('node:test');
const assert = require('node:assert/strict');
const { horariosLivres } = require('../../src/regras/disponibilidade');
const { instanteSP } = require('../../src/relogio');

// 01/12/2026 é terça (dia 2).
const DATA = '2026-12-01';
const IND = { id: 1, duracaoMin: 30, alunosPorAula: 1 };
const DUP = { id: 2, duracaoMin: 30, alunosPorAula: 2 };
const H60 = { id: 3, duracaoMin: 60, alunosPorAula: 1 };
const faixa = (o = {}) => ({ quadraId: 1, professorId: 10, diaSemana: 2, inicio: '17:00', fim: '19:00', tipos: [1, 2, 3], ...o });
const t = h => instanteSP(DATA, h);
const horas = r => r.map(x => new Date(x.inicio).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' }));

test('AGD-05 horário livre existe na grade, no dia e no tipo certos', () => {
  assert.deepEqual(horas(horariosLivres({ data: DATA, tipo: IND, faixas: [faixa()] })), ['17:00', '17:30', '18:00', '18:30']);
  assert.equal(horariosLivres({ data: '2026-12-02', tipo: IND, faixas: [faixa()] }).length, 0); // quarta
  assert.equal(horariosLivres({ data: DATA, tipo: IND, faixas: [faixa({ tipos: [2] })] }).length, 0);
  assert.equal(horariosLivres({ data: DATA, tipo: IND, faixas: [faixa({ vigenteDesde: '2026-12-08' })] }).length, 0);
});

test('AGD-05 feriado, bloqueio e aula ocupada tiram o horário', () => {
  assert.equal(horariosLivres({ data: DATA, tipo: IND, faixas: [faixa()], feriados: [DATA] }).length, 0);
  const comBloq = horariosLivres({ data: DATA, tipo: IND, faixas: [faixa()], bloqueios: [{ quadraId: null, professorId: 10, inicio: t('17:00'), fim: t('18:00') }] });
  assert.deepEqual(horas(comBloq), ['18:00', '18:30']);
  const comAula = horariosLivres({ data: DATA, tipo: IND, faixas: [faixa()], aulas: [{ quadraId: 1, professorId: 10, tipoId: 1, inicio: t('17:30'), fim: t('18:00'), participantes: 1 }] });
  assert.deepEqual(horas(comAula), ['17:00', '18:00', '18:30']);
});

test('AGD-05 professor em outra quadra no mesmo horário não aparece livre', () => {
  const r = horariosLivres({
    data: DATA, tipo: IND, faixas: [faixa()],
    aulas: [{ quadraId: 2, professorId: 10, tipoId: 1, inicio: t('18:00'), fim: t('18:30'), participantes: 1 }],
  });
  assert.deepEqual(horas(r), ['17:00', '17:30', '18:30']);
});

test('AGD-05 aula de dupla com 1 aluno ainda tem 1 vaga; com 2 está cheia', () => {
  const aula = n => [{ quadraId: 1, professorId: 10, tipoId: 2, inicio: t('17:00'), fim: t('17:30'), participantes: n }];
  const com1 = horariosLivres({ data: DATA, tipo: DUP, faixas: [faixa()], aulas: aula(1) });
  assert.equal(com1.find(x => x.inicio === t('17:00')).vagas, 1);
  const com2 = horariosLivres({ data: DATA, tipo: DUP, faixas: [faixa()], aulas: aula(2) });
  assert.equal(com2.find(x => x.inicio === t('17:00')), undefined);
  // aula individual nunca entra numa dupla existente
  assert.equal(horariosLivres({ data: DATA, tipo: IND, faixas: [faixa()], aulas: aula(1) }).find(x => x.inicio === t('17:00')), undefined);
});

test('AGD-04 aula de 60 min precisa de dois blocos livres seguidos e não passa do fim da faixa', () => {
  assert.deepEqual(horas(horariosLivres({ data: DATA, tipo: H60, faixas: [faixa()] })), ['17:00', '17:30', '18:00']);
  const r = horariosLivres({ data: DATA, tipo: H60, faixas: [faixa()], aulas: [{ quadraId: 1, professorId: 10, tipoId: 1, inicio: t('18:00'), fim: t('18:30'), participantes: 1 }] });
  assert.deepEqual(horas(r), ['17:00']);
});

test('SOF-04 antecedência mínima de 3 h tira os horários próximos', () => {
  const r = horariosLivres({ data: DATA, tipo: IND, faixas: [faixa()], agora: t('14:30'), antecedenciaMin: 180 });
  assert.deepEqual(horas(r), ['17:30', '18:00', '18:30']);
});
