/**
 * Desmarcar aula e usar crédito de reposição, no banco (REP-01..REP-05, REP-07). A decisão
 * (crédito ou não, validade) é a regra pura de src/regras/reposicao.js.
 * REP-05 ⏳ kickoff: reposição de aluno de dupla fica bloqueada até a resposta do cliente.
 * REP-06 ⏳ kickoff: limite de reposições por mês não é aplicado até a resposta do cliente.
 */
const { registrar } = require('../historico');
const { lerRegras } = require('../config');
const fila = require('./fila');
const { livresDoDia } = require('./livres');
const { enfileirar } = require('../whatsapp/envio');
const { desmarcar } = require('../regras/reposicao');
const { vagaLiberada } = require('../sofia/confirmacao');
const { agora, hojeSP, somarDias, dataSP, diaSemana } = require('../relogio');

class ErroRegra extends Error {}
const recusar = msg => { throw new ErroRegra(msg); };
const DIAS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const hhmm = ms => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const quando = ms => { const d = dataSP(ms); return `${DIAS[diaSemana(d)]}, ${d.split('-').reverse().join('/').slice(0, 5)} às ${hhmm(ms)}`; };

const cfgReposicao = r => ({
  antecedenciaMin: Number(r['reposicao.antecedencia_min'] ?? 180),
  validadeDias: Number(r['reposicao.validade_dias'] ?? 7),
});

async function participacao(c, participanteId) {
  return (await c.query(
    `SELECT p.*, a.origem, a.situacao a_sit, a.quadra_id, a.professor_id, a.tipo_aula_id,
            extract(epoch FROM lower(a.periodo))*1000 ini, ct.nome, al.id aluno_id, t.categoria
       FROM aula_participante p JOIN aula a ON a.id = p.aula_id JOIN contato ct ON ct.id = p.contato_id
       JOIN tipo_aula t ON t.id = a.tipo_aula_id
       LEFT JOIN aluno al ON al.contato_id = p.contato_id
      WHERE p.id = $1 FOR UPDATE OF p, a`, [participanteId])).rows[0] || null;
}

/** O que acontece se desmarcar agora (para a tela de confirmação). */
async function previaDesmarcar(c, participanteId) {
  const p = await participacao(c, participanteId);
  if (!p) return null;
  const regras = await lerRegras(c);
  return { p, d: desmarcar({ inicioAula: Number(p.ini), desmarcadoEm: agora(), origemAula: p.origem, quem: 'aluno' }, cfgReposicao(regras)) };
}

/**
 * Desmarca a participação (REP-01/02/04, AGD-08). quem: 'aluno' (app) | 'professor' | 'escola'.
 * Devolve { geraCredito, validoAte, contaComoDada, creditoId }.
 */
async function desmarcarAula(c, { participanteId, quem = 'aluno', ator, origem = 'app', motivoTexto = null }) {
  const p = await participacao(c, participanteId) || recusar('Aula não encontrada.');
  if (p.situacao !== 'ativo' || p.a_sit === 'cancelada') recusar('Essa aula já estava desmarcada.');
  const ini = Number(p.ini);
  if (ini <= agora()) recusar('A aula já começou: não dá mais para desmarcar.');
  const regras = await lerRegras(c);
  const d = desmarcar({ inicioAula: ini, desmarcadoEm: agora(), origemAula: p.origem, quem: quem === 'aluno' ? 'aluno' : 'escola' }, cfgReposicao(regras));
  const motivo = motivoTexto || d.motivo;
  await c.query(
    `UPDATE aula_participante SET situacao = 'desmarcado', desmarcado_em = now(), desmarcado_por_tipo = $2, desmarcado_motivo = $3 WHERE id = $1`,
    [p.id, quem, d.contaComoDada ? `${motivo} (conta como dada)` : motivo]);
  let creditoId = null;
  if (d.geraCredito && p.aluno_id && p.origem !== 'experimental') {
    creditoId = (await c.query(
      `INSERT INTO credito_reposicao (aluno_id, contrato_id, aula_origem_id, motivo, valido_ate) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (aula_origem_id, aluno_id) DO NOTHING RETURNING id`,
      [p.aluno_id, p.contrato_id, p.aula_id, quem === 'aluno' ? 'aluno' : 'escola', d.validoAte])).rows[0]?.id ?? null;
  }
  // Aula sem mais ninguém: cancelada, sai do Google e a vaga vai para a lista de espera.
  const resto = (await c.query(`SELECT count(*)::int n FROM aula_participante WHERE aula_id = $1 AND situacao = 'ativo'`, [p.aula_id])).rows[0].n;
  if (resto) await fila.aulaMudou(c, p.aula_id, 'atualizar');
  else {
    await c.query(`UPDATE aula SET situacao = 'cancelada', cancelada_motivo = $2 WHERE id = $1`, [p.aula_id, `desmarcada (${quem})`]);
    await fila.aulaMudou(c, p.aula_id, 'apagar');
    await vagaLiberada(c, { quadraId: p.quadra_id, inicio: ini });
  }
  // REP-07: professor avisado de cada desmarcação.
  if (quem === 'aluno') {
    await enfileirar(c, {
      usuarioId: p.professor_id, tipo: 'professor', chaveUnica: `rep-desm:${p.id}`,
      texto: `${p.nome} desmarcou a aula de ${quando(ini)}${d.geraCredito ? ' (com crédito de reposição)' : ' (fora do prazo: conta como dada)'}.`,
    });
  }
  await registrar(c, {
    ator, origem, acao: 'aula.desmarcada', entidade: 'aula', entidadeId: p.aula_id,
    antes: { participante: p.id, situacao: 'ativo' }, depois: { participante: p.id, situacao: 'desmarcado', credito: creditoId, conta_como_dada: d.contaComoDada },
    motivo,
  });
  return { geraCredito: !!creditoId, validoAte: creditoId ? d.validoAte : null, contaComoDada: d.contaComoDada, creditoId };
}

async function creditoDoAluno(c, creditoId, alunoId, trava = false) {
  return (await c.query(
    `SELECT cr.*, to_char(cr.valido_ate,'YYYY-MM-DD') ate, k.plano_id, p.tipo_aula_id, t.duracao_min, t.alunos_por_aula, t.categoria, t.nome tipo, al.contato_id
       FROM credito_reposicao cr JOIN aluno al ON al.id = cr.aluno_id
       LEFT JOIN contrato k ON k.id = cr.contrato_id LEFT JOIN plano p ON p.id = k.plano_id LEFT JOIN tipo_aula t ON t.id = p.tipo_aula_id
      WHERE cr.id = $1 AND cr.aluno_id = $2 ${trava ? 'FOR UPDATE OF cr' : ''}`, [creditoId, alunoId])).rows[0] || null;
}

/** Horários para usar o crédito: livres, do mesmo tipo do contrato, dentro da validade (REP-05). */
async function opcoesReposicao(c, { creditoId, alunoId }) {
  const cr = await creditoDoAluno(c, creditoId, alunoId) || recusar('Crédito não encontrado.');
  if (cr.situacao !== 'aberto' || cr.ate < hojeSP()) recusar('Esse crédito não está mais disponível.');
  if (!cr.tipo_aula_id) recusar('Crédito sem contrato: fale com a Play Squash.');
  if (cr.categoria === 'dupla') recusar('A reposição de aula em dupla ainda vai ser combinada com a Play Squash. Fale com seu professor.'); // REP-05 ⏳ kickoff
  const regras = await lerRegras(c);
  const antecedenciaMin = Number(regras['reposicao.antecedencia_min'] ?? 180);
  const tipo = { id: cr.tipo_aula_id, duracaoMin: cr.duracao_min, alunosPorAula: cr.alunos_por_aula };
  const saida = [];
  for (let d = hojeSP(); d <= cr.ate; d = somarDias(d, 1)) {
    for (const l of await livresDoDia(c, d, tipo, { antecedenciaMin })) saida.push({ ...l, dia: d });
  }
  // Não oferece horário em que o aluno já tem aula.
  const minhas = (await c.query(
    `SELECT extract(epoch FROM lower(a.periodo))*1000 i, extract(epoch FROM upper(a.periodo))*1000 f FROM aula_participante p JOIN aula a ON a.id = p.aula_id
      WHERE p.contato_id = $1 AND p.situacao = 'ativo' AND a.situacao <> 'cancelada' AND upper(a.periodo) > now()`, [cr.contato_id])).rows;
  return { credito: cr, opcoes: saida.filter(o => !minhas.some(m => Number(m.i) < o.fim && o.inicio < Number(m.f))) };
}

/** Usa o crédito no horário escolhido: entra na aula do mesmo tipo com vaga ou cria a reposição. */
async function usarCredito(c, { creditoId, alunoId, quadraId, inicio, ator }) {
  await creditoDoAluno(c, creditoId, alunoId, true);
  const { credito: cr, opcoes } = await opcoesReposicao(c, { creditoId, alunoId });
  const o = opcoes.find(x => x.quadraId === quadraId && x.inicio === inicio) || recusar('Esse horário não está mais livre. Escolha outro.');
  const fim = inicio + cr.duracao_min * 60000;
  let aula = (await c.query(
    `SELECT id FROM aula WHERE quadra_id = $1 AND tipo_aula_id = $2 AND situacao <> 'cancelada'
        AND periodo = tstzrange(to_timestamp($3/1000.0), to_timestamp($4/1000.0)) FOR UPDATE`, [quadraId, cr.tipo_aula_id, inicio, fim])).rows[0];
  if (!aula) {
    aula = (await c.query(
      `INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem) VALUES ($1,$2,$3,tstzrange(to_timestamp($4/1000.0), to_timestamp($5/1000.0)),'reposicao') RETURNING id`,
      [quadraId, o.professorId, cr.tipo_aula_id, inicio, fim])).rows[0];
    await fila.aulaMudou(c, aula.id, 'criar');
  } else await fila.aulaMudou(c, aula.id, 'atualizar');
  await c.query('INSERT INTO aula_participante (aula_id, contato_id, contrato_id) VALUES ($1,$2,$3)', [aula.id, cr.contato_id, cr.contrato_id]);
  await c.query(`UPDATE credito_reposicao SET situacao = 'usado', usado_aula_id = $2 WHERE id = $1`, [cr.id, aula.id]);
  const nome = (await c.query('SELECT nome FROM contato WHERE id = $1', [cr.contato_id])).rows[0].nome;
  await enfileirar(c, { usuarioId: o.professorId, tipo: 'professor', chaveUnica: `rep-usa:${cr.id}`, texto: `Reposição marcada: ${nome}, ${quando(inicio)}.` }); // REP-07
  await registrar(c, { ator, origem: 'app', acao: 'reposicao.marcada', entidade: 'aula', entidadeId: aula.id, depois: { credito: cr.id, aluno: alunoId, inicio: new Date(inicio).toISOString() } });
  return { aulaId: aula.id, quando: quando(inicio) };
}

// Créditos que passaram da validade viram "vencido" (rotina diária).
async function vencerCreditos(c) {
  return (await c.query(`UPDATE credito_reposicao SET situacao = 'vencido' WHERE situacao = 'aberto' AND valido_ate < $1 RETURNING id`, [hojeSP()])).rowCount;
}

module.exports = { desmarcarAula, previaDesmarcar, opcoesReposicao, usarCredito, vencerCreditos, ErroRegra, quando };
