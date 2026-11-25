/**
 * Horários livres de um dia lidos do banco (grade, aulas, bloqueios, feriados) e passados
 * para a regra pura (src/regras/disponibilidade.js, AGD-05). Usado pelo painel (AGD-12) e
 * pela Sofia (SOF-04, SOF-05).
 */
const { lerRegras } = require('../config');
const { horariosLivres } = require('../regras/disponibilidade');
const { instanteSP, agora } = require('../relogio');

// Faixas da grade (não canceladas, quadra ativa), no formato da regra pura.
async function lerFaixas(c) {
  return (await c.query(
    `SELECT f.quadra_id, f.professor_id, f.dia_semana, to_char(f.inicio,'HH24:MI') inicio, to_char(f.fim,'HH24:MI') fim,
            to_char(f.vigente_desde,'YYYY-MM-DD') vigente_desde, to_char(f.vigente_ate,'YYYY-MM-DD') vigente_ate,
            array_agg(ft.tipo_aula_id) tipos
       FROM grade_faixa f JOIN grade_faixa_tipo ft ON ft.grade_faixa_id = f.id JOIN quadra q ON q.id = f.quadra_id
      WHERE f.cancelada_em IS NULL AND q.ativa GROUP BY f.id`)).rows
    .map(f => ({ quadraId: f.quadra_id, professorId: f.professor_id, diaSemana: f.dia_semana, inicio: f.inicio, fim: f.fim, vigenteDesde: f.vigente_desde, vigenteAte: f.vigente_ate, tipos: f.tipos }));
}

async function livresDoDia(c, data, tipo, { antecedenciaMin = 0 } = {}) {
  const regras = await lerRegras(c);
  const faixas = await lerFaixas(c);
  const ini = instanteSP(data, '00:00'), fim = ini + 86400000;
  const aulas = (await c.query(
    `SELECT a.quadra_id, a.professor_id, a.tipo_aula_id, extract(epoch FROM lower(a.periodo))*1000 i, extract(epoch FROM upper(a.periodo))*1000 f,
            (SELECT count(*)::int FROM aula_participante p WHERE p.aula_id = a.id AND p.situacao = 'ativo') n
       FROM aula a WHERE a.situacao <> 'cancelada' AND a.periodo && tstzrange(to_timestamp($1/1000.0), to_timestamp($2/1000.0))`, [ini, fim])).rows
    .map(a => ({ quadraId: a.quadra_id, professorId: a.professor_id, tipoId: a.tipo_aula_id, inicio: Number(a.i), fim: Number(a.f), participantes: a.n }));
  const bloqueios = (await c.query(
    `SELECT quadra_id, professor_id, extract(epoch FROM lower(periodo))*1000 i, extract(epoch FROM upper(periodo))*1000 f
       FROM bloqueio WHERE cancelado_em IS NULL AND periodo && tstzrange(to_timestamp($1/1000.0), to_timestamp($2/1000.0))`, [ini, fim])).rows
    .map(b => ({ quadraId: b.quadra_id, professorId: b.professor_id, inicio: Number(b.i), fim: Number(b.f) }));
  const feriados = (await c.query('SELECT to_char(data,\'YYYY-MM-DD\') d FROM feriado WHERE cancelado_em IS NULL AND data = $1', [data])).rows.map(r => r.d);
  return horariosLivres({
    data, tipo, faixas, aulas, bloqueios, feriados,
    intervaloMin: Number(regras['grade.intervalo_min'] || 30), agora: agora(), antecedenciaMin,
  });
}

module.exports = { livresDoDia, lerFaixas };
