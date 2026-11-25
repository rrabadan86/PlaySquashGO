/**
 * Depois de marcada a experimental: confirmação (CNF-01..05), pós-aula (CNF-06) e lista de
 * espera quando a vaga abre (LES-02..04). As mensagens vão para quem marcou (o lead da conversa);
 * o professor é avisado em todos os desfechos (CNF-05). Textos editáveis em regra_config.
 *
 * Rotinas (rodam a cada minuto em src/rotinas.js): processarConfirmacoes, processarPosAula.
 * Ações (Sofia e painel): registrarResposta, vagaLiberada, vagaPreenchida.
 */
const { tx } = require('../db');
const { registrar } = require('../historico');
const { lerRegras } = require('../config');
const fila = require('../agenda/fila');
const { enfileirar } = require('../whatsapp/envio');
const { agendaConfirmacao } = require('../regras/confirmacao');
const { agora, dataSP, diaSemana, instanteSP, somarDias } = require('../relogio');
const { DIAS } = require('./texto');

const SISTEMA = { tipo: 'sistema', id: null };

const hhmm = ms => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
function quando(ms, ref = agora()) {
  const d = dataSP(ms);
  const rel = d === dataSP(ref) ? 'hoje' : d === somarDias(dataSP(ref), 1) ? 'amanhã' : `${DIAS[diaSemana(d)]}, ${d.split('-').reverse().join('/').slice(0, 5)}`;
  return `${rel} às ${hhmm(ms)}`;
}
// "{nome}" etc. no texto do modelo; o que não tiver valor fica vazio.
const preencher = (modelo, v) => String(modelo || '').replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? '')).replace(/\s+([,.!?])/g, '$1').trim();
const primeiroNome = n => String(n || '').trim().split(/\s+/)[0] || '';

async function dadosAula(c, aulaId, trava = false) {
  const a = (await c.query(
    `SELECT a.*, extract(epoch FROM lower(a.periodo))*1000 AS ini, extract(epoch FROM upper(a.periodo))*1000 AS fim,
            q.nome quadra, u.nome professor, ct.nome lead_nome, ct.anonimizado_em lead_anon
       FROM aula a JOIN quadra q ON q.id = a.quadra_id JOIN usuario u ON u.id = a.professor_id
       LEFT JOIN contato ct ON ct.id = a.marcada_por_contato_id
      WHERE a.id = $1 ${trava ? 'FOR UPDATE OF a' : ''}`, [aulaId])).rows[0];
  if (!a) return null;
  a.ini = Number(a.ini); a.fim = Number(a.fim);
  a.participantes = (await c.query(
    `SELECT p.contato_id, p.presenca, ct.nome FROM aula_participante p JOIN contato ct ON ct.id = p.contato_id
      WHERE p.aula_id = $1 AND p.situacao = 'ativo' ORDER BY p.id`, [aulaId])).rows;
  return a;
}

const varsAula = a => ({
  nome: primeiroNome(a.lead_nome), quando: quando(a.ini), quadra: a.quadra, professor: a.professor,
  alunos: a.participantes.map(p => p.nome).join(' e '),
});

async function avisarLead(c, a, regra, chave, regras) {
  if (!a.marcada_por_contato_id || a.lead_anon) return null;
  return enfileirar(c, { contatoId: a.marcada_por_contato_id, tipo: 'aviso', texto: preencher(regras[regra], varsAula(a)), chaveUnica: chave });
}
async function avisarProfessor(c, a, texto, chave) {
  return enfileirar(c, { usuarioId: a.professor_id, tipo: 'professor', texto, chaveUnica: chave });
}

// ───────────── LES-02: vaga aberta e vaga preenchida ─────────────
/**
 * Um horário de experimental ficou livre: avisa todos da lista daquele horário (com antecedência
 * suficiente). Quem marcar primeiro leva (a trava do banco decide); os outros recebem
 * "vaga já preenchida" (vagaPreenchida).
 */
async function vagaLiberada(c, { quadraId, inicio }) {
  const regras = await lerRegras(c);
  const antecedencia = Number(regras['marcar.antecedencia_min.lista_espera'] ?? 180);
  if (inicio - agora() < antecedencia * 60000) return 0;
  const lista = (await c.query(
    `SELECT l.id, l.contato_id, ct.nome FROM lista_espera l JOIN contato ct ON ct.id = l.contato_id
      WHERE l.tipo = 'experimental' AND l.saiu_em IS NULL AND l.inicio = to_timestamp($1/1000.0)
        AND (l.quadra_id IS NULL OR l.quadra_id = $2) AND ct.anonimizado_em IS NULL ORDER BY l.entrou_em`, [inicio, quadraId])).rows;
  for (const l of lista) {
    await c.query('UPDATE lista_espera SET avisado_em = now(), preenchida_em = NULL WHERE id = $1', [l.id]);
    await enfileirar(c, {
      contatoId: l.contato_id, tipo: 'aviso', chaveUnica: `les-vaga:${l.id}:${inicio}:${Date.now()}`,
      texto: preencher(regras['lista_espera.mensagem_vaga'], { nome: primeiroNome(l.nome), quando: quando(inicio) }),
    });
    await registrar(c, { ator: SISTEMA, origem: 'sistema', acao: 'lista_espera.avisado', entidade: 'lista_espera', entidadeId: l.id, depois: { inicio: new Date(inicio).toISOString() } });
  }
  return lista.length;
}

// Alguém marcou no horário: quem foi avisado da vaga e não marcou recebe "vaga já preenchida".
async function vagaPreenchida(c, { inicio, marcouContatoIds }) {
  const regras = await lerRegras(c);
  const avisados = (await c.query(
    `SELECT l.id, l.contato_id, ct.nome FROM lista_espera l JOIN contato ct ON ct.id = l.contato_id
      WHERE l.tipo = 'experimental' AND l.saiu_em IS NULL AND l.avisado_em IS NOT NULL AND l.preenchida_em IS NULL
        AND l.inicio = to_timestamp($1/1000.0) AND NOT (l.contato_id = ANY($2))`, [inicio, marcouContatoIds])).rows;
  for (const l of avisados) {
    await c.query('UPDATE lista_espera SET preenchida_em = now() WHERE id = $1', [l.id]);
    await enfileirar(c, {
      contatoId: l.contato_id, tipo: 'aviso', chaveUnica: `les-preenchida:${l.id}:${inicio}:${Date.now()}`,
      texto: preencher(regras['lista_espera.mensagem_preenchida'], { nome: primeiroNome(l.nome), quando: quando(inicio) }),
    });
  }
  return avisados.length;
}

// ───────────── CNF-02/03/05: resposta do lead ─────────────
/**
 * Registra a resposta ao pedido de confirmação. 'confirmou': aula confirmada e ✓ no Google.
 * 'nao_vai': aula cancelada, evento apagado, vaga liberada (lista de espera). Professor avisado.
 */
async function registrarResposta(c, { aulaId, resposta, ator, origem = 'whatsapp' }) {
  if (!['confirmou', 'nao_vai'].includes(resposta)) throw new Error('resposta inválida');
  const a = await dadosAula(c, aulaId, true);
  if (!a || a.origem !== 'experimental') return { ok: false, motivo: 'Aula experimental não encontrada.' };
  if (a.situacao === 'cancelada') return { ok: false, motivo: 'Essa aula já estava cancelada.' };
  if (a.fim <= agora()) return { ok: false, motivo: 'Essa aula já passou.' };
  const alunos = a.participantes.map(p => p.nome).join(' e ');
  if (resposta === 'confirmou') {
    if (a.situacao === 'confirmada' && a.conf_resposta === 'confirmou') return { ok: true, ja_estava: true };
    await c.query(`UPDATE aula SET situacao = 'confirmada', conf_resposta = 'confirmou', conf_resposta_em = now() WHERE id = $1`, [aulaId]);
    await c.query(`UPDATE aula_participante SET confirmacao = 'confirmou' WHERE aula_id = $1 AND situacao = 'ativo'`, [aulaId]);
    await fila.aulaMudou(c, aulaId, 'atualizar');
    await avisarProfessor(c, a, `Experimental confirmada: ${alunos}, ${quando(a.ini)}, ${a.quadra}.`, `cnf-prof-ok:${aulaId}`);
  } else {
    await c.query(`UPDATE aula SET situacao = 'cancelada', cancelada_motivo = 'lead avisou que não vai', conf_resposta = 'nao_vai', conf_resposta_em = now() WHERE id = $1`, [aulaId]);
    await c.query(`UPDATE aula_participante SET confirmacao = 'nao_vai' WHERE aula_id = $1 AND situacao = 'ativo'`, [aulaId]);
    await fila.aulaMudou(c, aulaId, 'apagar');
    await avisarProfessor(c, a, `Experimental cancelada: ${alunos} avisou que não vai ${quando(a.ini)}. O horário ficou livre.`, `cnf-prof-nao:${aulaId}`);
    await vagaLiberada(c, { quadraId: a.quadra_id, inicio: a.ini });
  }
  await registrar(c, { ator, origem, acao: `aula.${resposta === 'confirmou' ? 'confirmada' : 'cancelada_pelo_lead'}`, entidade: 'aula', entidadeId: aulaId, antes: { situacao: a.situacao }, depois: { situacao: resposta === 'confirmou' ? 'confirmada' : 'cancelada', resposta } });
  return { ok: true, resposta };
}

// ───────────── CNF-01/04: pedido, reenvio e cancelamento sem resposta ─────────────
function cfgConfirmacao(r) {
  return {
    pedidoHora: String(r['confirmacao.pedido_hora'] || '19:00'),
    reenvioMin: Number(r['confirmacao.reenvio_min'] ?? 180),
    cancelamentoMin: Number(r['confirmacao.cancelamento_min'] ?? 90),
    pedidoLigado: r['confirmacao.pedido_ligado'] !== false,
    reenvioLigado: r['confirmacao.reenvio_ligado'] !== false,
    cancelamentoLigado: r['confirmacao.cancelamento_ligado'] !== false,
  };
}

async function processarConfirmacoes({ pool, log = console }) {
  const t = agora();
  const ids = (await pool.query(
    `SELECT id FROM aula WHERE origem = 'experimental' AND situacao = 'marcada' AND conf_resposta IS NULL
        AND marcada_por_contato_id IS NOT NULL AND lower(periodo) > to_timestamp($1/1000.0) ORDER BY lower(periodo)`, [t])).rows.map(r => r.id);
  let feitos = 0;
  for (const id of ids) {
    try {
      feitos += await tx(pool, async c => {
        const regras = await lerRegras(c);
        const a = await dadosAula(c, id, true);
        if (!a || a.situacao !== 'marcada' || a.conf_resposta) return 0;
        const ag = agendaConfirmacao({ inicioAula: a.ini, marcadaEm: new Date(a.criado_em).getTime() }, cfgConfirmacao(regras));
        if (ag.nasceConfirmada) return 0;
        const perguntou = a.conf_pedido_em || a.conf_reenvio_em;
        // Cancelamento só para quem foi perguntado e não respondeu (CNF-01).
        if (ag.cancelamento != null && t >= ag.cancelamento && perguntou) {
          await c.query(`UPDATE aula SET situacao = 'cancelada', cancelada_motivo = 'sem confirmação', conf_resposta = 'sem_resposta', conf_resposta_em = now() WHERE id = $1`, [id]);
          await c.query(`UPDATE aula_participante SET confirmacao = 'sem_resposta' WHERE aula_id = $1 AND situacao = 'ativo'`, [id]);
          await fila.aulaMudou(c, id, 'apagar');
          await avisarLead(c, a, 'confirmacao.mensagem_cancelada', `cnf-cancelada:${id}`, regras);
          await avisarProfessor(c, a, `Experimental cancelada sem confirmação: ${a.participantes.map(p => p.nome).join(' e ')}, ${quando(a.ini)}. O horário ficou livre.`, `cnf-prof-sem:${id}`);
          await registrar(c, { ator: SISTEMA, origem: 'sistema', acao: 'aula.cancelada_sem_confirmacao', entidade: 'aula', entidadeId: id, antes: { situacao: 'marcada' }, depois: { situacao: 'cancelada' }, motivo: 'sem confirmação' });
          await vagaLiberada(c, { quadraId: a.quadra_id, inicio: a.ini });
          return 1;
        }
        if (ag.reenvio != null && t >= ag.reenvio && !a.conf_reenvio_em && (!ag.cancelamento || t < ag.cancelamento)) {
          await c.query('UPDATE aula SET conf_reenvio_em = now() WHERE id = $1', [id]);
          await avisarLead(c, a, 'confirmacao.mensagem_reenvio', `cnf-reenvio:${id}`, regras);
          return 1;
        }
        if (ag.pedido != null && t >= ag.pedido && !a.conf_pedido_em && !a.conf_reenvio_em && (ag.reenvio == null || t < ag.reenvio)) {
          await c.query('UPDATE aula SET conf_pedido_em = now() WHERE id = $1', [id]);
          await avisarLead(c, a, 'confirmacao.mensagem_pedido', `cnf-pedido:${id}`, regras);
          return 1;
        }
        return 0;
      });
    } catch (e) { log.error(`[confirmacao] aula ${id}: ${e.message}`); }
  }
  return feitos;
}

// ───────────── CNF-06: pós-aula ─────────────
async function processarPosAula({ pool, log = console }) {
  const t = agora();
  const regras = await lerRegras(pool);
  const contatoMin = Number(regras['pos_aula.contato_min'] ?? 60);
  const hora2d = String(regras['pos_aula.hora_2d'] || '10:00');
  const aulas = (await pool.query(
    `SELECT a.id FROM aula a WHERE a.origem = 'experimental' AND a.situacao <> 'cancelada' AND a.marcada_por_contato_id IS NOT NULL
        AND upper(a.periodo) <= to_timestamp($1/1000.0) AND upper(a.periodo) > to_timestamp($1/1000.0) - interval '4 days'
        AND (a.pos_dia_em IS NULL OR a.pos_2d_em IS NULL)`, [t])).rows.map(r => r.id);
  let feitos = 0;
  for (const id of aulas) {
    try {
      feitos += await tx(pool, async c => {
        const a = await dadosAula(c, id, true);
        // Já tem resultado (matriculou ou perdido) para todos: não incomoda mais.
        const semResultado = (await c.query(
          `SELECT count(*)::int n FROM aula_participante p LEFT JOIN lead_resultado r ON r.contato_id = p.contato_id
            WHERE p.aula_id = $1 AND p.situacao = 'ativo' AND r.contato_id IS NULL`, [id])).rows[0].n;
        if (!semResultado) return 0;
        const faltou = a.participantes.length && a.participantes.every(p => p.presenca === 'falta');
        const fimDia = instanteSP(dataSP(a.fim), '21:00');
        if (!a.pos_dia_em && t >= a.fim + contatoMin * 60000) {
          await c.query('UPDATE aula SET pos_dia_em = now() WHERE id = $1', [id]);
          // Mesmo dia: só até 21h; passou disso, fica para o contato de +2 dias.
          if (t < fimDia) {
            await avisarLead(c, a, faltou ? 'pos_aula.mensagem_falta' : 'pos_aula.mensagem_dia', `pos-dia:${id}`, regras);
            return 1;
          }
          return 0;
        }
        const em2d = instanteSP(somarDias(dataSP(a.fim), 2), hora2d);
        if (!a.pos_2d_em && t >= em2d) {
          await c.query('UPDATE aula SET pos_2d_em = now() WHERE id = $1', [id]);
          if (faltou) return 0; // quem faltou já recebeu o convite para remarcar
          await avisarLead(c, a, 'pos_aula.mensagem_2d', `pos-2d:${id}`, regras);
          return 1;
        }
        return 0;
      });
    } catch (e) { log.error(`[pos-aula] aula ${id}: ${e.message}`); }
  }
  return feitos;
}

module.exports = { registrarResposta, vagaLiberada, vagaPreenchida, processarConfirmacoes, processarPosAula, preencher, quando, cfgConfirmacao };
