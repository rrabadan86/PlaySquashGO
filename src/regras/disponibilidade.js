/**
 * Horários livres de um dia (regra pura, sem banco). AGD-05 e AGD-04 em .claude/rules/agenda.md.
 *
 * Um horário está livre quando: existe na grade (faixa vigente no dia, tipo permitido),
 * não é feriado, não tem bloqueio, tem vaga e o professor não está em outra quadra no mesmo
 * horário. Aula maior que o intervalo ocupa blocos seguidos (AGD-04). A antecedência mínima
 * de marcação é aplicada aqui (SOF-04, LES-02).
 */
const { diaSemana, instanteSP } = require('../relogio');

const MIN = 60000;
const sobrepoe = (a1, a2, b1, b2) => a1 < b2 && b1 < a2;

/**
 * @param {object} p
 * @param {string} p.data                 'AAAA-MM-DD'
 * @param {object} p.tipo                 { id, duracaoMin, alunosPorAula }
 * @param {Array}  p.faixas               [{ quadraId, professorId, diaSemana, inicio:'HH:MM', fim:'HH:MM', tipos:[id], vigenteDesde, vigenteAte }]
 * @param {Array}  [p.aulas]              aulas ativas do dia: [{ quadraId, professorId, tipoId, inicio(ms), fim(ms), participantes }]
 * @param {Array}  [p.bloqueios]          [{ quadraId|null, professorId|null, inicio(ms), fim(ms) }]
 * @param {Array}  [p.feriados]           ['AAAA-MM-DD']
 * @param {number} [p.intervaloMin=30]
 * @param {number} [p.agora]              instante (ms) para a antecedência mínima
 * @param {number} [p.antecedenciaMin=0]
 * @returns {Array<{quadraId, professorId, inicio:number, fim:number, vagas:number}>}
 */
function horariosLivres({ data, tipo, faixas, aulas = [], bloqueios = [], feriados = [], intervaloMin = 30, agora = null, antecedenciaMin = 0 }) {
  if (feriados.includes(data)) return [];
  const dow = diaSemana(data);
  const dur = tipo.duracaoMin * MIN;
  const livres = [];
  for (const f of faixas) {
    if (f.diaSemana !== dow) continue;
    if (f.vigenteDesde && data < f.vigenteDesde) continue;
    if (f.vigenteAte && data > f.vigenteAte) continue;
    if (Array.isArray(f.tipos) && !f.tipos.includes(tipo.id)) continue;
    const ini = instanteSP(data, f.inicio), fimFaixa = instanteSP(data, f.fim);
    for (let s = ini; s + dur <= fimFaixa; s += intervaloMin * MIN) {
      const e = s + dur;
      if (agora != null && s - agora < antecedenciaMin * MIN) continue;
      const bloqueado = bloqueios.some(b => sobrepoe(s, e, b.inicio, b.fim)
        && (b.quadraId == null || b.quadraId === f.quadraId)
        && (b.professorId == null || b.professorId === f.professorId));
      if (bloqueado) continue;
      const naQuadra = aulas.filter(a => a.quadraId === f.quadraId && sobrepoe(s, e, a.inicio, a.fim));
      let vagas = tipo.alunosPorAula;
      if (naQuadra.length) {
        // Só dá para entrar numa aula igual (mesmo tipo e mesmo horário) que ainda tenha vaga.
        const igual = naQuadra.length === 1 && naQuadra[0].tipoId === tipo.id && naQuadra[0].inicio === s && naQuadra[0].fim === e;
        if (!igual) continue;
        vagas = tipo.alunosPorAula - (naQuadra[0].participantes || 0);
        if (vagas <= 0) continue;
      }
      const profOcupado = aulas.some(a => a.professorId === f.professorId && a.quadraId !== f.quadraId && sobrepoe(s, e, a.inicio, a.fim));
      if (profOcupado) continue;
      livres.push({ quadraId: f.quadraId, professorId: f.professorId, inicio: s, fim: e, vagas });
    }
  }
  return livres.sort((a, b) => a.inicio - b.inicio || a.quadraId - b.quadraId);
}

module.exports = { horariosLivres };
