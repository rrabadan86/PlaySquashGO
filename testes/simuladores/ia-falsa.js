/**
 * IA falsa da Sofia (TST-01, TST-08): responde por roteiro, sem chamar a Anthropic.
 * O roteiro é uma lista de respostas (na ordem) ou uma função (mensagens) → resposta.
 * Cada resposta pode trazer tokens para testar o custo (SOF-12).
 *
 *   const ia = criarIaFalsa(['Oi! Qual seu nome?', { texto: 'ok', tokensEntrada: 100, tokensSaida: 20 }]);
 *   await ia.responder([{ papel: 'usuario', texto: 'oi' }]);   // → { texto, tokensEntrada, tokensSaida }
 *   ia.chamadas                                                 // quantas vezes foi chamada
 */
function criarIaFalsa(roteiro = []) {
  let i = 0;
  const historico = [];
  return {
    get chamadas() { return historico.length; },
    historico,
    async responder(mensagens) {
      historico.push(mensagens);
      let r = typeof roteiro === 'function' ? roteiro(mensagens) : roteiro[i++];
      if (r === undefined) throw new Error('IA falsa: roteiro acabou');
      if (typeof r === 'string') r = { texto: r };
      return { tokensEntrada: 0, tokensSaida: 0, ...r };
    },
  };
}
module.exports = { criarIaFalsa };
