/**
 * relogio.js — o "agora" e o "hoje" do sistema, no horário de Brasília. Fonte única (TST-06, OPR-08).
 *
 * Em teste (NODE_ENV=test) dá para FIXAR o agora com PS_AGORA (data/hora ISO, ex.:
 * "2026-12-01T08:30:00-03:00"). Fora de teste PS_AGORA é ignorado.
 *
 * Brasília não tem horário de verão desde 2019: o deslocamento é sempre -03:00.
 */
const TZ = 'America/Sao_Paulo';
const OFFSET = '-03:00';
const DIA_MS = 86400000;

function agora() {
  if (process.env.NODE_ENV === 'test' && process.env.PS_AGORA) {
    const t = Date.parse(process.env.PS_AGORA);
    if (Number.isFinite(t)) return t;
  }
  return Date.now();
}

// 'AAAA-MM-DD' da data em Brasília de um instante (ms).
function dataSP(ms = agora()) {
  return new Date(ms).toLocaleDateString('en-CA', { timeZone: TZ });
}

// 'AAAA-MM-DD' de hoje em Brasília; desloc = dias a somar (1 = amanhã).
function hojeSP(desloc = 0) {
  return somarDias(dataSP(agora()), desloc);
}

// Soma dias a uma data 'AAAA-MM-DD' (calendário, sem fuso).
function somarDias(iso, dias) {
  const d = new Date(String(iso) + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

// Instante (ms) de uma data 'AAAA-MM-DD' + hora 'HH:MM' em Brasília.
function instanteSP(iso, hhmm = '00:00') {
  return Date.parse(`${iso}T${hhmm}:00${OFFSET}`);
}

// Dia da semana (0 = domingo) de uma data 'AAAA-MM-DD'.
function diaSemana(iso) {
  return new Date(String(iso) + 'T12:00:00Z').getUTCDay();
}

module.exports = { TZ, OFFSET, DIA_MS, agora, dataSP, hojeSP, somarDias, instanteSP, diaSemana };
