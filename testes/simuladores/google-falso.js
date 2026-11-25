/**
 * Google Agenda falso (TST-01, TST-08, AGD-09): mesma interface de src/agenda/google.js, em memória.
 * Só escrita (Sistema → Google); `eventos()`, `agendas()` e `acl()` existem apenas para o teste conferir.
 *
 *   const g = criarGoogleFalso();
 *   const { id: ag } = await g.criarAgenda('Quadra 1');
 *   await g.compartilhar(ag, 'prof@x.com');
 *   const { id } = await g.criarEvento(ag, { titulo, inicio, fim, cor, privado: { aulaId } });
 *   await g.atualizarEvento(ag, id, { titulo: '... ✓' });
 *   await g.apagarEvento(ag, id);
 *   g.falharProximas(2)   // simula o Google fora do ar nas próximas 2 chamadas
 */
function criarGoogleFalso() {
  const agendas = new Map(); // id → { nome, eventos: Map, acl: Set }
  let seq = 0;
  let falhas = 0;
  const ag = id => {
    if (!agendas.has(id)) agendas.set(id, { nome: id, eventos: new Map(), acl: new Set() });
    return agendas.get(id);
  };
  const talvezFalhar = () => { if (falhas > 0) { falhas--; throw new Error('Google indisponível (simulado)'); } };
  return {
    falharProximas(n) { falhas = n; },
    async criarAgenda(nome) {
      talvezFalhar();
      const id = `agenda-${++seq}@group.calendar.google.com`;
      agendas.set(id, { nome, eventos: new Map(), acl: new Set() });
      return { id };
    },
    async compartilhar(agendaId, email) { talvezFalhar(); ag(agendaId).acl.add(email.toLowerCase()); },
    async descompartilhar(agendaId, email) { talvezFalhar(); ag(agendaId).acl.delete(email.toLowerCase()); },
    async criarEvento(agendaId, ev) {
      talvezFalhar();
      const id = `ev-${++seq}`;
      ag(agendaId).eventos.set(id, { id, ...ev });
      return { id };
    },
    async atualizarEvento(agendaId, id, mudancas) {
      talvezFalhar();
      const e = ag(agendaId).eventos.get(id);
      if (!e) throw new Error(`evento ${id} não existe`);
      Object.assign(e, mudancas);
      return { id };
    },
    async apagarEvento(agendaId, id) { talvezFalhar(); ag(agendaId).eventos.delete(id); },
    eventos(agendaId) { return [...ag(agendaId).eventos.values()]; },
    acl(agendaId) { return [...ag(agendaId).acl].sort(); },
    agendas() { return [...agendas.entries()].map(([id, a]) => ({ id, nome: a.nome })); },
  };
}
module.exports = { criarGoogleFalso };
