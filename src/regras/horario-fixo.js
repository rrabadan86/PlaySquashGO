/**
 * Horário fixo semanal (AGD-06, AGD-05, CON-02): quais horários de um dia da semana podem
 * receber mais um aluno de contrato. Regra pura, sem banco.
 *
 * Um horário serve quando: existe na grade (faixa vigente na data, tipo permitido), não cruza
 * com horário fixo de OUTRO tipo na mesma quadra e, no mesmo tipo e mesma hora, ainda tem vaga
 * (alunos por aula). Horário fixo do mesmo tipo em hora diferente que se sobrepõe também bloqueia.
 */
const min = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + m; };
const hhmm = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/**
 * @param {object} p
 * @param {number} p.diaSemana          0 = domingo
 * @param {string} p.data               'AAAA-MM-DD' de referência para a vigência da faixa (início do contrato)
 * @param {object} p.tipo               { id, duracaoMin, alunosPorAula }
 * @param {Array}  p.faixas             [{ quadraId, professorId, diaSemana, inicio, fim, tipos, vigenteDesde, vigenteAte }]
 * @param {Array}  [p.fixos]            horários fixos já ocupados nesse dia da semana, com contrato
 *                                      que cruza o período: [{ quadraId, hora:'HH:MM', duracaoMin, tipoId }]
 * @param {number} [p.intervaloMin=30]
 * @returns {Array<{ quadraId, professorId, hora:string, vagas:number }>}
 */
function opcoesFixas({ diaSemana, data, tipo, faixas, fixos = [], intervaloMin = 30 }) {
  const saida = [];
  for (const f of faixas) {
    if (f.diaSemana !== diaSemana) continue;
    if (f.vigenteDesde && data < f.vigenteDesde) continue;
    if (f.vigenteAte && data > f.vigenteAte) continue;
    if (Array.isArray(f.tipos) && !f.tipos.includes(tipo.id)) continue;
    for (let s = min(f.inicio); s + tipo.duracaoMin <= min(f.fim); s += intervaloMin) {
      const e = s + tipo.duracaoMin;
      const cruzam = fixos.filter(x => x.quadraId === f.quadraId && min(x.hora) < e && s < min(x.hora) + x.duracaoMin);
      if (cruzam.some(x => x.tipoId !== tipo.id || min(x.hora) !== s)) continue;
      const vagas = tipo.alunosPorAula - cruzam.length;
      if (vagas > 0) saida.push({ quadraId: f.quadraId, professorId: f.professorId, hora: hhmm(s), vagas });
    }
  }
  return saida.sort((a, b) => a.hora.localeCompare(b.hora) || a.quadraId - b.quadraId);
}

// Fim do contrato: véspera do mesmo dia N meses depois ('AAAA-MM-DD').
// 10/01 + 1 mês → 09/02; 31/01 + 1 mês → 28/02 (fevereiro não tem 31: fica o último dia do mês).
function fimVigencia(inicio, meses) {
  const [a, m, d] = inicio.split('-').map(Number);
  const mesAlvo = new Date(Date.UTC(a, m - 1 + meses, 1));
  const ultimo = new Date(Date.UTC(mesAlvo.getUTCFullYear(), mesAlvo.getUTCMonth() + 1, 0)).getUTCDate();
  const dt = d > ultimo
    ? new Date(Date.UTC(mesAlvo.getUTCFullYear(), mesAlvo.getUTCMonth(), ultimo))
    : new Date(Date.UTC(mesAlvo.getUTCFullYear(), mesAlvo.getUTCMonth(), d - 1));
  return dt.toISOString().slice(0, 10);
}

module.exports = { opcoesFixas, fimVigencia };
