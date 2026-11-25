/**
 * Horários fixos dos contratos e as aulas geradas a partir deles (AGD-06, AGD-07, CON-02, CON-10).
 *
 * - opcoesFixasDoBanco: horários de um dia da semana que aceitam mais um aluno de contrato
 *   (grade + horários fixos de contratos que cruzam o período), para a tela Novo contrato.
 * - gerarAulasFixas: cria as aulas das próximas N semanas (padrão 4) de cada horário fixo,
 *   sem duplicar (a aula desmarcada ou cancelada não volta). Dupla/turma entra na mesma aula.
 *   Feriado, bloqueio ou horário já ocupado por outra aula: pula o dia e registra no histórico.
 * Roda todo dia pela rotina (src/rotinas.js) e logo depois de salvar um contrato.
 */
const { tx } = require('../db');
const { registrar } = require('../historico');
const { lerRegras } = require('../config');
const { lerFaixas } = require('./livres');
const fila = require('./fila');
const { opcoesFixas } = require('../regras/horario-fixo');
const { agora, hojeSP, somarDias, diaSemana, instanteSP } = require('../relogio');

const SISTEMA = { tipo: 'sistema', id: null };

async function opcoesFixasDoBanco(c, { diaSemana: dia, inicio, fim, tipo, ignorarContratoId = null }) {
  const regras = await lerRegras(c);
  const faixas = await lerFaixas(c);
  const fixos = (await c.query(
    `SELECT h.quadra_id, to_char(h.hora,'HH24:MI') hora, t.duracao_min, t.id tipo_id
       FROM horario_fixo h JOIN contrato ct ON ct.id = h.contrato_id JOIN plano p ON p.id = ct.plano_id JOIN tipo_aula t ON t.id = p.tipo_aula_id
      WHERE h.liberado_em IS NULL AND h.dia_semana = $1 AND ct.situacao <> 'encerrado'
        AND ct.inicio <= $3 AND ct.fim >= $2 AND ($4::bigint IS NULL OR ct.id <> $4)`, [dia, inicio, fim, ignorarContratoId])).rows
    .map(x => ({ quadraId: x.quadra_id, hora: x.hora, duracaoMin: x.duracao_min, tipoId: x.tipo_id }));
  return opcoesFixas({ diaSemana: dia, data: inicio, tipo, faixas, fixos, intervaloMin: Number(regras['grade.intervalo_min'] || 30) });
}

// Professor da faixa que cobre o horário naquela data (AGD-07: trocar o professor da faixa troca o das aulas).
async function professorDaFaixa(c, { quadraId, data, hora, duracaoMin }) {
  return (await c.query(
    `SELECT professor_id FROM grade_faixa WHERE quadra_id = $1 AND dia_semana = $2 AND cancelada_em IS NULL
        AND vigente_desde <= $3 AND (vigente_ate IS NULL OR vigente_ate >= $3)
        AND inicio <= $4::time AND fim >= ($4::time + make_interval(mins => $5)) LIMIT 1`,
    [quadraId, diaSemana(data), data, hora, duracaoMin])).rows[0]?.professor_id ?? null;
}

async function pular(c, hf, data, motivo) {
  const ja = await c.query(
    `SELECT 1 FROM historico WHERE acao = 'aula.fixa_pulada' AND entidade = 'horario_fixo' AND entidade_id = $1 AND depois->>'data' = $2 LIMIT 1`, [hf.id, data]);
  if (!ja.rowCount) await registrar(c, { ator: SISTEMA, origem: 'sistema', acao: 'aula.fixa_pulada', entidade: 'horario_fixo', entidadeId: hf.id, depois: { data, contrato: hf.contrato_id }, motivo });
}

/**
 * Gera as aulas que faltam. Devolve quantas aulas (participações) foram criadas.
 * @param {object} p
 * @param {number} [p.contratoId]  só deste contrato (logo depois de salvar)
 */
async function gerarAulasFixas({ pool, contratoId = null, log = console }) {
  const regras = await lerRegras(pool);
  const semanas = Number(regras['grade.semanas_geradas'] ?? 4);
  const hoje = hojeSP(), ate = somarDias(hoje, semanas * 7 - 1);
  const fixos = (await pool.query(
    `SELECT h.*, to_char(h.hora,'HH24:MI') hhmm, to_char(h.desde,'YYYY-MM-DD') desde_iso,
            to_char(ct.inicio,'YYYY-MM-DD') c_inicio, to_char(ct.fim,'YYYY-MM-DD') c_fim, ct.aluno_id, a.contato_id,
            t.id tipo_id, t.duracao_min, t.alunos_por_aula
       FROM horario_fixo h JOIN contrato ct ON ct.id = h.contrato_id JOIN aluno a ON a.id = ct.aluno_id
       JOIN plano p ON p.id = ct.plano_id JOIN tipo_aula t ON t.id = p.tipo_aula_id
      WHERE h.liberado_em IS NULL AND ct.situacao IN ('aguardando_aceite','ativo') AND ($1::bigint IS NULL OR ct.id = $1)
      ORDER BY h.id`, [contratoId])).rows;
  let criadas = 0;
  for (const hf of fixos) {
    try {
      criadas += await tx(pool, async c => {
        let n = 0;
        for (let d = hoje; d <= ate; d = somarDias(d, 1)) {
          if (diaSemana(d) !== hf.dia_semana || d < hf.desde_iso || d < hf.c_inicio || d > hf.c_fim) continue;
          const ini = instanteSP(d, hf.hhmm), fim = ini + hf.duracao_min * 60000;
          if (ini <= agora()) continue;
          // Já existe (mesmo desmarcada ou cancelada): não gera de novo.
          const ja = await c.query(
            `SELECT 1 FROM aula_participante p JOIN aula a ON a.id = p.aula_id
              WHERE p.contrato_id = $1 AND a.quadra_id = $2 AND lower(a.periodo) = to_timestamp($3/1000.0) LIMIT 1`, [hf.contrato_id, hf.quadra_id, ini]);
          if (ja.rowCount) continue;
          if ((await c.query('SELECT 1 FROM feriado WHERE data = $1 AND cancelado_em IS NULL', [d])).rowCount) { await pular(c, hf, d, 'feriado'); continue; }
          const bloq = await c.query(
            `SELECT 1 FROM bloqueio WHERE cancelado_em IS NULL AND (quadra_id IS NULL OR quadra_id = $1)
                AND periodo && tstzrange(to_timestamp($2/1000.0), to_timestamp($3/1000.0)) LIMIT 1`, [hf.quadra_id, ini, fim]);
          if (bloq.rowCount) { await pular(c, hf, d, 'bloqueio'); continue; }
          // Dupla/turma: entra na aula do mesmo tipo que já existe no horário, se tiver vaga.
          let aula = (await c.query(
            `SELECT a.id, (SELECT count(*)::int FROM aula_participante p WHERE p.aula_id = a.id AND p.situacao = 'ativo') n
               FROM aula a WHERE a.quadra_id = $1 AND a.tipo_aula_id = $2 AND a.situacao <> 'cancelada'
                AND a.periodo = tstzrange(to_timestamp($3/1000.0), to_timestamp($4/1000.0)) FOR UPDATE`, [hf.quadra_id, hf.tipo_id, ini, fim])).rows[0];
          if (aula && aula.n >= hf.alunos_por_aula) { await pular(c, hf, d, 'aula cheia'); continue; }
          if (!aula) {
            const prof = await professorDaFaixa(c, { quadraId: hf.quadra_id, data: d, hora: hf.hhmm, duracaoMin: hf.duracao_min });
            if (!prof) { await pular(c, hf, d, 'sem faixa na grade'); continue; }
            await c.query('SAVEPOINT nova_aula');
            try {
              aula = (await c.query(
                `INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem, horario_fixo_id)
                 VALUES ($1,$2,$3,tstzrange(to_timestamp($4/1000.0), to_timestamp($5/1000.0)),'fixa',$6) RETURNING id`,
                [hf.quadra_id, prof, hf.tipo_id, ini, fim, hf.id])).rows[0];
              await c.query('RELEASE SAVEPOINT nova_aula');
            } catch (e) {
              if (e.code !== '23P01') throw e;
              await c.query('ROLLBACK TO SAVEPOINT nova_aula');
              await pular(c, hf, d, 'horário ocupado por outra aula');
              continue;
            }
            await fila.aulaMudou(c, aula.id, 'criar');
          } else {
            await fila.aulaMudou(c, aula.id, 'atualizar');
          }
          await c.query('INSERT INTO aula_participante (aula_id, contato_id, contrato_id) VALUES ($1,$2,$3)', [aula.id, hf.contato_id, hf.contrato_id]);
          n++;
        }
        return n;
      });
    } catch (e) { log.error(`[aulas fixas] horário ${hf.id}: ${e.message}`); }
  }
  return criadas;
}

/**
 * Tira o aluno das aulas futuras de um contrato (encerramento, CON-10). Aula sem mais ninguém
 * é cancelada e sai do Google; aula com outros alunos só é atualizada.
 */
async function liberarAulasFuturas(c, { contratoId, motivo }) {
  const ps = (await c.query(
    `SELECT p.id, p.aula_id FROM aula_participante p JOIN aula a ON a.id = p.aula_id
      WHERE p.contrato_id = $1 AND p.situacao = 'ativo' AND a.situacao <> 'cancelada' AND lower(a.periodo) > to_timestamp($2/1000.0)
      FOR UPDATE OF p`, [contratoId, agora()])).rows;
  for (const p of ps) {
    await c.query(`UPDATE aula_participante SET situacao = 'desmarcado', desmarcado_em = now(), desmarcado_por_tipo = 'admin', desmarcado_motivo = $2 WHERE id = $1`, [p.id, motivo]);
    const resto = (await c.query(`SELECT count(*)::int n FROM aula_participante WHERE aula_id = $1 AND situacao = 'ativo'`, [p.aula_id])).rows[0].n;
    if (resto) await fila.aulaMudou(c, p.aula_id, 'atualizar');
    else {
      await c.query(`UPDATE aula SET situacao = 'cancelada', cancelada_motivo = $2 WHERE id = $1`, [p.aula_id, motivo]);
      await fila.aulaMudou(c, p.aula_id, 'apagar');
    }
  }
  return ps.length;
}

module.exports = { opcoesFixasDoBanco, gerarAulasFixas, liberarAulasFuturas, professorDaFaixa };
