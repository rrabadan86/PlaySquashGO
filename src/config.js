/**
 * Regras configuráveis (regra_config): vale a versão mais recente já em vigor (DAD-06).
 * Mudar uma regra = inserir nova versão com data + registro no histórico (OPR-07).
 */
const { registrar } = require('./historico');

async function lerRegras(c, quando = null) {
  const { rows } = await c.query(
    `SELECT DISTINCT ON (chave) chave, valor FROM regra_config
      WHERE vigente_desde <= COALESCE($1::timestamptz, now())
      ORDER BY chave, vigente_desde DESC`, [quando]);
  return Object.fromEntries(rows.map(r => [r.chave, r.valor]));
}

async function lerRegra(c, chave, padrao = null) {
  const r = await lerRegras(c);
  return chave in r ? r[chave] : padrao;
}

async function mudarRegra(c, { chave, valor, ator, motivo = null }) {
  const antes = await lerRegra(c, chave);
  await c.query('INSERT INTO regra_config (chave, valor, alterado_por) VALUES ($1,$2,$3)', [chave, JSON.stringify(valor), ator.id ?? null]);
  await registrar(c, { ator, acao: 'regra.alterada', entidade: 'regra_config', antes: { chave, valor: antes }, depois: { chave, valor }, motivo });
}

module.exports = { lerRegras, lerRegra, mudarRegra };
