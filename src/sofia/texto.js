/**
 * Pequenas regras puras da Sofia.
 */

// SOF-06: chave do participante = nome sem acento, minúsculo, espaços simples.
function chaveNome(nome) {
  return String(nome || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
}

// 'AAAA-MM-DD' válido (e data real) ou null. Aceita também DD/MM/AAAA.
function dataValida(v) {
  let s = String(v || '').trim();
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) s = `${br[3]}-${br[2]}-${br[1]}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const d = new Date(`${s}T12:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null;
}

// Idade em anos completos numa data 'AAAA-MM-DD'.
function idade(nascimento, hoje) {
  const [a, m, d] = nascimento.split('-').map(Number);
  const [ha, hm, hd] = hoje.split('-').map(Number);
  return ha - a - (hm < m || (hm === m && hd < d) ? 1 : 0);
}

// Período do dia de um horário 'HH:MM' (SOF-02: dias e período preferidos).
function periodo(hhmm) {
  const h = Number(String(hhmm).slice(0, 2));
  return h < 12 ? 'manha' : h < 18 ? 'tarde' : 'noite';
}

const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

module.exports = { chaveNome, dataValida, idade, periodo, DIAS };
