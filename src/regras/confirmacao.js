/**
 * Agenda da confirmação da aula experimental (regra pura, sem banco).
 * CNF-01 e CNF-04 em .claude/rules/sofia.md.
 */
const { dataSP, somarDias, instanteSP } = require('../relogio');

const PADRAO = {
  pedidoHora: '19:00',   // CNF-01: pedido na véspera às 19h
  reenvioMin: 180,       // CNF-01: reenvio 3 h antes
  cancelamentoMin: 90,   // CNF-01: cancela sem resposta 90 min antes
  pedidoLigado: true,
  reenvioLigado: true,
  cancelamentoLigado: true,
};

/**
 * Calcula quando pedir confirmação, reenviar e cancelar.
 * @param {object} p
 * @param {number} p.inicioAula  instante (ms) do início da experimental
 * @param {number} p.marcadaEm   instante (ms) em que foi marcada
 * @param {object} [cfg]
 * @returns {{ nasceConfirmada: boolean, pedido: number|null, reenvio: number|null, cancelamento: number|null }}
 */
function agendaConfirmacao({ inicioAula, marcadaEm }, cfg = {}) {
  const c = { ...PADRAO, ...cfg };
  const vespera = somarDias(dataSP(inicioAula), -1);
  const pedido = instanteSP(vespera, c.pedidoHora);

  // CNF-04: marcada depois do horário do pedido → nasce confirmada, sem cancelamento automático.
  if (marcadaEm >= pedido) {
    return { nasceConfirmada: true, pedido: null, reenvio: null, cancelamento: null };
  }
  return {
    nasceConfirmada: false,
    pedido: c.pedidoLigado ? pedido : null,
    reenvio: c.reenvioLigado ? inicioAula - c.reenvioMin * 60000 : null,
    cancelamento: c.cancelamentoLigado ? inicioAula - c.cancelamentoMin * 60000 : null,
  };
}

module.exports = { PADRAO, agendaConfirmacao };
