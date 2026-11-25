/**
 * Feriados nacionais (AGD-03): os fixos da lei federal + Sexta-feira Santa (data móvel).
 * Carnaval e Corpus Christi são ponto facultativo, não feriado nacional: ficam de fora.
 * Estaduais e municipais são cadastrados à mão (⏳ kickoff: quais valem para a Play Squash).
 */
const { somarDias } = require('../relogio');

const FIXOS = [
  ['01-01', 'Confraternização Universal'],
  ['04-21', 'Tiradentes'],
  ['05-01', 'Dia do Trabalho'],
  ['09-07', 'Independência do Brasil'],
  ['10-12', 'Nossa Senhora Aparecida'],
  ['11-02', 'Finados'],
  ['11-15', 'Proclamação da República'],
  ['11-20', 'Dia Nacional de Zumbi e da Consciência Negra'],
  ['12-25', 'Natal'],
];

// Domingo de Páscoa (algoritmo de Meeus/Jones/Butcher, calendário gregoriano).
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function feriadosNacionais(ano) {
  return [
    ...FIXOS.map(([md, nome]) => ({ data: `${ano}-${md}`, nome })),
    { data: somarDias(pascoa(ano), -2), nome: 'Sexta-feira Santa' },
  ].sort((x, y) => x.data.localeCompare(y.data));
}

module.exports = { pascoa, feriadosNacionais };
