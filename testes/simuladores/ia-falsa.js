/**
 * IA falsa da Sofia (TST-01, TST-08): responde por roteiro, sem chamar a Anthropic.
 * Mesma interface de src/sofia/ia.js. O roteiro é uma lista de respostas (na ordem) ou uma
 * função (pedido) → resposta. Cada resposta pode pedir ferramentas e trazer tokens (SOF-12).
 *
 *   const ia = criarIaFalsa([
 *     { ferramentas: [{ nome: 'ver_horarios', entrada: { pessoas: 1 } }] },  // pede ferramenta
 *     p => `Tenho estes: ${ultimoResultado(p)}`,                              // lê o resultado
 *     { texto: 'ok', tokensEntrada: 100, tokensSaida: 20 },
 *   ]);
 *   ia.chamadas      // quantas vezes foi chamada
 *   ia.historico     // os pedidos recebidos
 */
function criarIaFalsa(roteiro = []) {
  let i = 0, seq = 0;
  const historico = [];
  return {
    get chamadas() { return historico.length; },
    historico,
    async responder(pedido) {
      historico.push(pedido);
      let r = typeof roteiro === 'function' ? roteiro(pedido) : roteiro[i++];
      if (typeof r === 'function') r = r(pedido);
      if (r instanceof Error) throw r;
      if (r === undefined) throw new Error('IA falsa: roteiro acabou');
      if (typeof r === 'string') r = { texto: r };
      const chamadas = (r.ferramentas || []).map(f => ({ id: `ferr-${++seq}`, nome: f.nome, entrada: f.entrada || {} }));
      return {
        texto: '', tokensEntrada: 0, tokensSaida: 0, cacheLeitura: 0, cacheEscrita: 0, modelo: pedido && pedido.modelo,
        ...r, chamadas, parada: r.parada || (chamadas.length ? 'tool_use' : 'end_turn'),
      };
    },
  };
}

// Resultado (já em objeto) da última ferramenta que a Sofia devolveu à IA.
function ultimoResultado(pedido) {
  const m = [...pedido.mensagens].reverse().find(x => x.papel === 'ferramenta');
  if (!m) return null;
  const r = m.resultados[m.resultados.length - 1];
  try { return { ...JSON.parse(r.conteudo), erro: r.erro }; } catch { return { mensagem: r.conteudo, erro: r.erro }; }
}

module.exports = { criarIaFalsa, ultimoResultado };
