/**
 * Regras puras de desmarcação e crédito de reposição (sem banco).
 * REP-01, REP-02, REP-03, REP-04 em .claude/rules/app.md; AGD-08 em agenda.md.
 *
 * Os parâmetros vêm da configuração (regra_config); os valores abaixo são os iniciais.
 */
const { dataSP, somarDias } = require('../relogio');

const PADRAO = {
  antecedenciaMin: 180, // REP-01: desmarcar com 3 h ou mais gera crédito
  validadeDias: 7,      // REP-03: validade contada da data da aula desmarcada
};

/**
 * Decide o que acontece ao desmarcar uma aula.
 * @param {object} p
 * @param {number} p.inicioAula      instante (ms) do início da aula
 * @param {number} p.desmarcadoEm    instante (ms) da desmarcação
 * @param {string} p.origemAula      'fixa' | 'experimental' | 'reposicao' | 'avulsa'
 * @param {'aluno'|'professor'|'escola'} [p.quem]
 * @param {object} [cfg]
 * @returns {{ geraCredito: boolean, contaComoDada: boolean, validoAte: string|null, motivo: string }}
 */
function desmarcar({ inicioAula, desmarcadoEm, origemAula, quem = 'aluno' }, cfg = {}) {
  const { antecedenciaMin, validadeDias } = { ...PADRAO, ...cfg };
  const antecedencia = inicioAula - desmarcadoEm;
  if (antecedencia <= 0) {
    return { geraCredito: false, contaComoDada: true, validoAte: null, motivo: 'aula já começou' };
  }
  const noPrazo = antecedencia >= antecedenciaMin * 60000;
  if (!noPrazo) {
    // REP-02: menos que a antecedência = conta como dada, sem crédito, sem exceção.
    return { geraCredito: false, contaComoDada: quem === 'aluno', validoAte: null, motivo: 'fora do prazo' };
  }
  if (origemAula === 'reposicao') {
    // REP-04: desmarcar a própria reposição não gera outro crédito.
    return { geraCredito: false, contaComoDada: false, validoAte: null, motivo: 'reposição não gera novo crédito' };
  }
  return {
    geraCredito: true,
    contaComoDada: false,
    validoAte: validadeCredito(inicioAula, validadeDias),
    motivo: quem === 'aluno' ? 'desmarcada pelo aluno no prazo' : 'desmarcada pela escola no prazo',
  };
}

// REP-03: último dia válido = data da aula desmarcada (em Brasília) + validadeDias.
function validadeCredito(inicioAula, validadeDias = PADRAO.validadeDias) {
  return somarDias(dataSP(inicioAula), validadeDias);
}

// O crédito ainda vale numa data 'AAAA-MM-DD'?
function creditoValido(validoAte, dataISO) {
  return String(dataISO) <= String(validoAte);
}

module.exports = { PADRAO, desmarcar, validadeCredito, creditoValido };
