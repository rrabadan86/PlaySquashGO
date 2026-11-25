/**
 * Telefone brasileiro (OPR-11): o mesmo número pode chegar com ou sem o 9 do celular
 * (contas antigas do WhatsApp usam 8 dígitos). Guardamos em E.164 (+55DDNNNNNNNNN) e
 * procuramos pelas duas formas. Regra pura.
 */

// '+5562999990000' a partir de qualquer formato; null se não der para entender.
function normalizar(v) {
  let d = String(v || '').replace(/@.*$/, '').replace(/\D/g, '');
  if (!d) return null;
  if (d.length === 10 || d.length === 11) d = '55' + d; // DDD + número
  if (!d.startsWith('55') || (d.length !== 12 && d.length !== 13)) return null;
  // Celular com 8 dígitos (sem o 9): põe o 9 para guardar sempre igual.
  if (d.length === 12 && /[6-9]/.test(d[4])) d = d.slice(0, 4) + '9' + d.slice(4);
  return '+' + d;
}

// As duas formas em que o WhatsApp pode conhecer o número: com e sem o 9.
function variantes(e164) {
  const n = normalizar(e164);
  if (!n) return [];
  const d = n.slice(1);
  const v = [n];
  if (d.length === 13 && d[4] === '9') v.push('+' + d.slice(0, 4) + d.slice(5));
  return v;
}

// Id do chat no whatsapp-web.js: 5562999990000@c.us
function chatId(e164) { return String(e164).replace(/\D/g, '') + '@c.us'; }

module.exports = { normalizar, variantes, chatId };
