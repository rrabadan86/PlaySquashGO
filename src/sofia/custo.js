/**
 * Custo da IA (SOF-12): dólares por milhão de tokens, por modelo. Regra pura.
 * Leitura de cache custa 1/20 da entrada (preço de tabela); escrita de cache, 1,25×.
 * Modelo fora da tabela usa o preço do Opus 5.5 (o mais provável) e o custo fica marcado.
 */
const PRECOS = {
  'claude-opus-5-5': { entrada: 4, saida: 20, cacheLeitura: 0.20 },
  'claude-sonnet-5-5': { entrada: 2, saida: 10, cacheLeitura: 0.10 },
  'claude-haiku-5-5': { entrada: 0.10, saida: 0.50, cacheLeitura: 0.01 },
  'claude-opus-4-8': { entrada: 5, saida: 25, cacheLeitura: 0.50 },
};

function custoUSD({ modelo, tokensEntrada = 0, tokensSaida = 0, cacheLeitura = 0, cacheEscrita = 0 }) {
  const p = PRECOS[modelo] || PRECOS['claude-opus-5-5'];
  const usd = (tokensEntrada * p.entrada + cacheEscrita * p.entrada * 1.25 + cacheLeitura * p.cacheLeitura + tokensSaida * p.saida) / 1e6;
  return Math.round(usd * 1e6) / 1e6;
}

module.exports = { PRECOS, custoUSD };
