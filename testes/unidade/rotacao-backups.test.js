const { test } = require('node:test');
const assert = require('node:assert/strict');
const { paraApagar } = require('../../scripts/rotacao-backups');

const nome = (dia, hora = '033000', motivo = '') => `producao-${dia}_${hora}${motivo ? '-' + motivo : ''}.dump.gpg`;
const somar = (iso, d) => { const x = new Date(iso + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + d); return x.toISOString().slice(0, 10); };

test('DEP-06 guarda a última cópia de cada um dos 30 dias mais recentes', () => {
  const hoje = '2027-06-15';
  const nomes = [];
  for (let i = 0; i < 40; i++) nomes.push(nome(somar(hoje, -i)));
  nomes.push(nome(hoje, '010000')); // duas no mesmo dia: fica a mais recente
  const apagar = paraApagar(nomes, hoje);
  assert.ok(apagar.includes(nome(hoje, '010000')));
  assert.ok(!apagar.includes(nome(hoje)));
  assert.ok(!apagar.includes(nome(somar(hoje, -29))));
  assert.ok(apagar.includes(nome(somar(hoje, -30))));
  assert.ok(apagar.includes(nome(somar(hoje, -38))));
  assert.ok(!apagar.includes(nome(somar(hoje, -39))), 'a primeira do mês fica pela regra mensal');
});

test('DEP-06 guarda a primeira cópia de cada um dos 12 meses mais recentes', () => {
  const hoje = '2027-06-15';
  const nomes = [];
  for (let m = 0; m < 15; m++) {
    const d = new Date(Date.UTC(2027, 5 - m, 1));
    const ini = d.toISOString().slice(0, 10);
    nomes.push(nome(ini), nome(somar(ini, 10)));
  }
  const apagar = paraApagar(nomes, hoje);
  assert.ok(!apagar.includes(nome('2026-07-01')), '12º mês fica');
  assert.ok(apagar.includes(nome('2026-06-01')), '13º mês sai');
  assert.ok(apagar.includes(nome('2027-01-11')), 'segunda do mês antigo sai');
  assert.ok(!apagar.includes(nome('2027-06-01')));
});

test('DEP-06 cópia feita antes de atualizar vale 30 dias; arquivo estranho nunca é apagado', () => {
  const hoje = '2027-06-15';
  const apagar = paraApagar([nome('2027-06-01', '220000', 'antes-de-atualizar'), nome('2027-04-01', '220000', 'antes-de-atualizar'), 'leia-me.txt'], hoje);
  assert.deepEqual(apagar, [nome('2027-04-01', '220000', 'antes-de-atualizar')]);
});
