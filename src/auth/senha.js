/**
 * Senha do painel: só o hash scrypt é guardado (DAD-01). Formato: scrypt$<sal>$<hash>.
 */
const crypto = require('crypto');

const MINIMO = 8;

function senhaValida(s) { return typeof s === 'string' && s.length >= MINIMO; }

function gerarHash(senha) {
  if (!senhaValida(senha)) throw new Error(`a senha precisa de pelo menos ${MINIMO} caracteres`);
  const sal = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(senha, sal, 64).toString('hex');
  return `scrypt$${sal}$${h}`;
}

function conferir(senha, armazenado) {
  const [alg, sal, h] = String(armazenado || '').split('$');
  if (alg !== 'scrypt' || !sal || !h) return false;
  const calc = crypto.scryptSync(String(senha), sal, 64);
  const esperado = Buffer.from(h, 'hex');
  return esperado.length === calc.length && crypto.timingSafeEqual(calc, esperado);
}

module.exports = { MINIMO, senhaValida, gerarHash, conferir };
