/**
 * Horário fixo semanal e vigência do contrato (regras puras).
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { opcoesFixas, fimVigencia } = require('../../src/regras/horario-fixo');

const faixa = { quadraId: 1, professorId: 7, diaSemana: 2, inicio: '18:00', fim: '20:00', tipos: [10, 11], vigenteDesde: '2026-11-01', vigenteAte: null };
const individual = { id: 10, duracaoMin: 60, alunosPorAula: 1 };
const dupla = { id: 11, duracaoMin: 60, alunosPorAula: 2 };

test('AGD-06 AGD-05 horários fixos livres respeitam grade, vaga e aulas de outro tipo', () => {
  const base = { diaSemana: 2, data: '2026-12-01', faixas: [faixa] };
  assert.deepEqual(opcoesFixas({ ...base, tipo: individual }).map(o => o.hora), ['18:00', '18:30', '19:00']);
  // Individual às 18:00 ocupa 18:00–19:00: 18:00 e 18:30 saem.
  const fixos = [{ quadraId: 1, hora: '18:00', duracaoMin: 60, tipoId: 10 }];
  assert.deepEqual(opcoesFixas({ ...base, tipo: individual, fixos }).map(o => o.hora), ['19:00']);
  // Dupla: um aluno às 19:00 deixa 1 vaga às 19:00; a individual das 18:00 bloqueia a dupla 18:00/18:30.
  const fixos2 = [...fixos, { quadraId: 1, hora: '19:00', duracaoMin: 60, tipoId: 11 }];
  assert.deepEqual(opcoesFixas({ ...base, tipo: dupla, fixos: fixos2 }).map(o => [o.hora, o.vagas]), [['19:00', 1]]);
  // Outro dia da semana, faixa vencida ou tipo não permitido: nada.
  assert.equal(opcoesFixas({ ...base, diaSemana: 3, tipo: individual }).length, 0);
  assert.equal(opcoesFixas({ ...base, data: '2026-10-01', tipo: individual }).length, 0);
  assert.equal(opcoesFixas({ ...base, tipo: { id: 99, duracaoMin: 60, alunosPorAula: 1 } }).length, 0);
});

test('CON-02 fim da vigência: véspera do mesmo dia N meses depois', () => {
  assert.equal(fimVigencia('2026-01-10', 1), '2026-02-09');
  assert.equal(fimVigencia('2026-01-31', 1), '2026-02-28');
  assert.equal(fimVigencia('2028-01-31', 1), '2028-02-29');
  assert.equal(fimVigencia('2026-12-01', 1), '2026-12-31');
  assert.equal(fimVigencia('2026-11-15', 3), '2027-02-14');
  assert.equal(fimVigencia('2026-01-01', 12), '2026-12-31');
});
