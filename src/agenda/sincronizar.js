/**
 * Envia a fila_google para o Google Agenda (AGD-09). Só Sistema → Google.
 *
 * - Itens da mesma aula/quadra saem na ordem em que entraram (só o mais antigo pendente de
 *   cada alvo é tentado), para nunca apagar antes de criar.
 * - Falhou: soma uma tentativa e espera 1, 5, 15, 60, 180 min e depois de 6 em 6 h. Não desiste:
 *   o painel mostra os itens com erro.
 * - Evento de quadra que ainda não tem agenda espera a agenda ser criada (sem contar como erro).
 * - Vários processos podem rodar juntos sem pegar o mesmo item (FOR UPDATE SKIP LOCKED).
 */
const { tx } = require('../db');
const { montarEvento, esperaMin } = require('./evento');
const { registrar } = require('../historico');

const SISTEMA = { tipo: 'sistema', id: null };

async function dadosDaAula(c, aulaId) {
  const { rows } = await c.query(
    `SELECT a.id, a.origem, a.situacao, a.google_evento_id, a.quadra_id, q.google_agenda_id, q.nome quadra,
            t.categoria, t.nome tipo, u.nome professor,
            extract(epoch FROM lower(a.periodo))*1000 AS inicio, extract(epoch FROM upper(a.periodo))*1000 AS fim,
            COALESCE(array_agg(COALESCE(ct.nome, 'Aluno') ORDER BY ct.nome) FILTER (WHERE p.situacao = 'ativo'), '{}') alunos
       FROM aula a JOIN quadra q ON q.id = a.quadra_id JOIN tipo_aula t ON t.id = a.tipo_aula_id
       JOIN usuario u ON u.id = a.professor_id
       LEFT JOIN aula_participante p ON p.aula_id = a.id LEFT JOIN contato ct ON ct.id = p.contato_id
      WHERE a.id = $1 GROUP BY a.id, q.id, t.id, u.id`, [aulaId]);
  const a = rows[0];
  return a && { ...a, inicio: Number(a.inicio), fim: Number(a.fim) };
}

// Executa um item. Devolve 'feito' ou 'esperar' (dependência ainda não pronta).
async function executar(c, google, item) {
  if (item.acao === 'criar_agenda') {
    const q = (await c.query('SELECT id, nome, google_agenda_id FROM quadra WHERE id = $1 FOR UPDATE', [item.quadra_id])).rows[0];
    if (q.google_agenda_id) return 'feito';
    const { id } = await google.criarAgenda(`Play Squash — ${q.nome}`);
    await c.query('UPDATE quadra SET google_agenda_id = $2 WHERE id = $1', [q.id, id]);
    await registrar(c, { ator: SISTEMA, origem: 'sistema', acao: 'google.agenda_criada', entidade: 'quadra', entidadeId: q.id, depois: { google_agenda_id: id } });
    return 'feito';
  }
  if (item.acao === 'compartilhar' || item.acao === 'descompartilhar') {
    const q = (await c.query('SELECT google_agenda_id FROM quadra WHERE id = $1', [item.quadra_id])).rows[0];
    if (!q.google_agenda_id) return 'esperar';
    if (item.acao === 'compartilhar') await google.compartilhar(q.google_agenda_id, item.email);
    else await google.descompartilhar(q.google_agenda_id, item.email);
    return 'feito';
  }
  // Eventos de aula
  const a = await dadosDaAula(c, item.aula_id);
  if (!a.google_agenda_id) return 'esperar';
  const cancelada = a.situacao === 'cancelada';
  let acao = item.acao;
  if (acao !== 'apagar' && cancelada) acao = 'apagar';
  if (acao === 'criar' && a.google_evento_id) acao = 'atualizar';
  if (acao === 'atualizar' && !a.google_evento_id) acao = 'criar';
  if (acao === 'apagar') {
    if (a.google_evento_id) await google.apagarEvento(a.google_agenda_id, a.google_evento_id);
    await c.query('UPDATE aula SET google_evento_id = NULL WHERE id = $1', [a.id]);
    return 'feito';
  }
  const ev = montarEvento(a);
  if (acao === 'criar') {
    const { id } = await google.criarEvento(a.google_agenda_id, ev);
    await c.query('UPDATE aula SET google_evento_id = $2 WHERE id = $1', [a.id, id]);
  } else {
    await google.atualizarEvento(a.google_agenda_id, a.google_evento_id, ev);
  }
  return 'feito';
}

/**
 * Processa até `limite` itens prontos. Devolve { feitos, falhas, esperando }.
 * @param {{ pool, google, agora?: () => number, limite?: number, log? }} o
 */
async function processarFila({ pool, google, agora = Date.now, limite = 50, log = console }) {
  const res = { feitos: 0, falhas: 0, esperando: 0 };
  if (!google) return res;
  for (let i = 0; i < limite; i++) {
    const continuar = await tx(pool, async c => {
      // O mais antigo pendente de cada alvo; desses, o primeiro que já pode ser tentado.
      const { rows } = await c.query(
        `SELECT f.* FROM fila_google f
          WHERE f.feito_em IS NULL AND f.proxima_tentativa <= to_timestamp($1/1000.0)
            AND NOT EXISTS (SELECT 1 FROM fila_google g WHERE g.feito_em IS NULL AND g.id < f.id
                  AND ((f.aula_id IS NOT NULL AND g.aula_id = f.aula_id)
                    OR (f.aula_id IS NULL AND g.aula_id IS NULL AND g.quadra_id = f.quadra_id AND g.acao = 'criar_agenda')))
          ORDER BY f.id LIMIT 1 FOR UPDATE SKIP LOCKED`, [agora()]);
      const item = rows[0];
      if (!item) return false;
      try {
        const r = await executar(c, google, item);
        if (r === 'feito') {
          await c.query('UPDATE fila_google SET feito_em = now(), erro = NULL WHERE id = $1', [item.id]);
          res.feitos++;
        } else {
          await c.query(`UPDATE fila_google SET proxima_tentativa = to_timestamp($2/1000.0) + interval '1 minute' WHERE id = $1`, [item.id, agora()]);
          res.esperando++;
        }
      } catch (e) {
        const t = item.tentativas + 1;
        await c.query(
          `UPDATE fila_google SET tentativas = $2, erro = $3, proxima_tentativa = to_timestamp($4/1000.0) + make_interval(mins => $5) WHERE id = $1`,
          [item.id, t, String(e.message).slice(0, 300), agora(), esperaMin(t)]);
        res.falhas++;
        log.error(`[google] item ${item.id} (${item.acao}) falhou (tentativa ${t}): ${e.message}`);
      }
      return true;
    });
    if (!continuar) break;
  }
  return res;
}

module.exports = { processarFila };
