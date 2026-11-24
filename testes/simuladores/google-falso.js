/**
 * Google Agenda falso (TST-01, TST-08, AGD-09): uma agenda por quadra, em memória.
 * Só escrita (Sistema → Google); `eventos(agendaId)` existe apenas para o teste conferir.
 *
 *   const g = criarGoogleFalso();
 *   const { id } = await g.criarEvento('quadra-1', { titulo, inicio, fim, cor, privado: { aulaId } });
 *   await g.atualizarEvento('quadra-1', id, { titulo: '... ✓' });
 *   await g.apagarEvento('quadra-1', id);
 *   g.falharProximas(2)   // simula o Google fora do ar nas próximas 2 chamadas
 */
function criarGoogleFalso() {
  const agendas = new Map();
  let seq = 0;
  let falhas = 0;
  const ag = id => { if (!agendas.has(id)) agendas.set(id, new Map()); return agendas.get(id); };
  const talvezFalhar = () => { if (falhas > 0) { falhas--; throw new Error('Google indisponível (simulado)'); } };
  return {
    falharProximas(n) { falhas = n; },
    async criarEvento(agendaId, ev) {
      talvezFalhar();
      const id = `ev-${++seq}`;
      ag(agendaId).set(id, { id, ...ev });
      return { id };
    },
    async atualizarEvento(agendaId, id, mudancas) {
      talvezFalhar();
      const e = ag(agendaId).get(id);
      if (!e) throw new Error(`evento ${id} não existe`);
      Object.assign(e, mudancas);
      return { id };
    },
    async apagarEvento(agendaId, id) {
      talvezFalhar();
      ag(agendaId).delete(id);
    },
    eventos(agendaId) { return [...ag(agendaId).values()]; },
  };
}
module.exports = { criarGoogleFalso };
