/**
 * Fila de envio do WhatsApp (OPR-02, OPR-03, OPR-10).
 *
 * - Tudo que vai para o WhatsApp entra em fila_envio (na transação da ação que gerou a mensagem).
 * - `chaveUnica` impede a mesma mensagem duas vezes (ex.: "fixa:12:2026-11-25").
 * - Envio em DUAS ETAPAS (OPR-10): grava "enviando" e confirma no banco ANTES de mandar;
 *   depois de mandar grava "enviado" e a mensagem no registro. Se o sistema cair no meio,
 *   o item fica "a conferir" e nunca é reenviado sozinho — o admin confere no celular.
 * - Ritmo e limites em src/whatsapp/ritmo.js.
 */
const { tx } = require('../db');
const { lerRegras } = require('../config');
const ritmo = require('./ritmo');
const { esperaMin } = require('../agenda/evento');

// Quem sai primeiro quando há fila: conversa e avisos antes de cobrança e campanha.
const PRIORIDADE = `CASE f.tipo WHEN 'sofia' THEN 0 WHEN 'fixa' THEN 0 WHEN 'aviso' THEN 1 WHEN 'professor' THEN 1 WHEN 'cobranca' THEN 2 ELSE 3 END`;

/**
 * Põe uma mensagem na fila. Devolve o id, ou null se não entrou (chave repetida,
 * campanha para quem pediu SAIR, contato anonimizado).
 */
async function enfileirar(c, { contatoId = null, usuarioId = null, tipo, texto, chaveUnica = null, agendadoPara = null, anexoId = null }) {
  if (!texto || !String(texto).trim()) throw new Error('mensagem vazia');
  if (contatoId) {
    const ct = (await c.query('SELECT sem_campanha, anonimizado_em FROM contato WHERE id = $1', [contatoId])).rows[0];
    if (!ct || ct.anonimizado_em) return null;
    if (tipo === 'campanha' && ct.sem_campanha) return null; // OPR-03
  }
  const r = await c.query(
    `INSERT INTO fila_envio (contato_id, usuario_id, tipo, texto, chave_unica, agendado_para, anexo_id)
     VALUES ($1,$2,$3,$4,$5,COALESCE($6::timestamptz, now()),$7) ON CONFLICT (chave_unica) DO NOTHING RETURNING id`,
    [contatoId, usuarioId, tipo, String(texto), chaveUnica, agendadoPara ? new Date(agendadoPara).toISOString() : null, anexoId]);
  return r.rows[0] ? r.rows[0].id : null;
}

/**
 * Tenta enviar UMA mensagem. Devolve { enviado, motivo, esperarMs } — o laço de envio espera
 * `esperarMs` antes da próxima (intervalo aleatório do ritmo, OPR-02).
 */
async function processarUm({ pool, wa, agora = Date.now, aleatorio = Math.random, log = console }) {
  if (!wa || !wa.conectado) return { enviado: false, motivo: 'whatsapp desconectado', esperarMs: 30000 };
  const t = agora();
  // Etapa 1: escolher, conferir ritmo e marcar "enviando" (confirma no banco antes de mandar).
  const sel = await tx(pool, async c => {
    const cfg = ritmo.deRegras(await lerRegras(c));
    const saidas = (await c.query(
      `SELECT extract(epoch FROM em)*1000 AS t FROM mensagem WHERE direcao = 'saida' AND em > to_timestamp($1/1000.0) - interval '24 hours'`, [t]))
      .rows.map(r => Number(r.t));
    const ultima = saidas.length ? Math.max(...saidas) : null;
    if (ultima && t - ultima < cfg.intervaloMinS * 1000) return { esperarMs: cfg.intervaloMinS * 1000 - (t - ultima) + 500 };
    const cand = (await c.query(
      `SELECT f.*, ct.telefone AS tel_contato, ct.sem_campanha, ct.anonimizado_em, u.telefone AS tel_usuario,
              ax.arquivo AS anexo_arquivo, ax.tipo_mime AS anexo_mime,
              (SELECT extract(epoch FROM max(m.em))*1000 FROM mensagem m WHERE m.contato_id = f.contato_id AND m.direcao = 'entrada') AS ultima_conversa
         FROM fila_envio f LEFT JOIN contato ct ON ct.id = f.contato_id LEFT JOIN usuario u ON u.id = f.usuario_id
              LEFT JOIN sofia_anexo ax ON ax.id = f.anexo_id
        WHERE f.enviado_em IS NULL AND f.cancelado_em IS NULL AND f.enviando_em IS NULL AND f.agendado_para <= to_timestamp($1/1000.0)
        ORDER BY ${PRIORIDADE}, f.agendado_para, f.id LIMIT 20 FOR UPDATE OF f SKIP LOCKED`, [t])).rows;
    for (const f of cand) {
      const cancelar = async motivo => c.query('UPDATE fila_envio SET cancelado_em = now(), cancelado_motivo = $2 WHERE id = $1', [f.id, motivo]);
      if (f.contato_id && f.anonimizado_em) { await cancelar('contato anonimizado'); continue; }
      if (f.tipo === 'campanha' && f.sem_campanha) { await cancelar('pediu para sair das campanhas'); continue; }
      const tel = f.tel_contato || f.tel_usuario;
      if (!tel) { await cancelar('sem telefone'); continue; }
      const d = ritmo.decidir({ agora: t, tipo: f.tipo, saidas, ultimaConversa: f.ultima_conversa == null ? null : Number(f.ultima_conversa) }, cfg);
      if (!d.pode) {
        if (d.motivo.startsWith('limite')) return { esperarMs: Math.max(1000, d.aPartirDe - t), motivo: d.motivo };
        await c.query('UPDATE fila_envio SET agendado_para = to_timestamp($2/1000.0) WHERE id = $1', [f.id, d.aPartirDe]);
        continue; // janela/conversa: adia este e tenta o próximo
      }
      await c.query('UPDATE fila_envio SET enviando_em = now(), tentativas = tentativas + 1 WHERE id = $1', [f.id]);
      return { item: f, tel, cfg };
    }
    return { esperarMs: 5000 };
  });
  if (!sel.item) return { enviado: false, motivo: sel.motivo || 'nada a enviar agora', esperarMs: sel.esperarMs };

  // Etapa 2: mandar.
  const { item, tel, cfg } = sel;
  let res;
  try {
    // SOF-10: anexo vai com o texto como legenda.
    res = item.anexo_id
      ? await wa.enviarArquivo(tel, { arquivo: item.anexo_arquivo, tipoMime: item.anexo_mime, legenda: item.texto })
      : await wa.enviar(tel, item.texto);
  } catch (e) {
    // Falhou antes de sair (desconectado, número sem WhatsApp…): volta para a fila com espera.
    await pool.query(
      `UPDATE fila_envio SET enviando_em = NULL, erro = $2, agendado_para = now() + make_interval(mins => $3) WHERE id = $1`,
      [item.id, String(e.message).slice(0, 300), esperaMin(item.tentativas + 1)]);
    log.error(`[whatsapp] item ${item.id} não enviado: ${e.message}`);
    return { enviado: false, motivo: e.message, esperarMs: 5000 };
  }
  // Etapa 3: registrar o envio.
  await tx(pool, async c => {
    await c.query('UPDATE fila_envio SET enviado_em = now(), erro = NULL WHERE id = $1', [item.id]);
    await c.query(
      `INSERT INTO mensagem (contato_id, usuario_id, direcao, texto, motivo, situacao, fila_envio_id)
       VALUES ($1,$2,'saida',$3,$4,'enviada',$5)`, [item.contato_id, item.usuario_id, item.anexo_id ? `[anexo] ${item.texto}` : item.texto, item.tipo, item.id]);
  });
  return { enviado: true, id: res && res.id, esperarMs: ritmo.intervalo(cfg, aleatorio) };
}

// Itens "a conferir": marcados como enviando há mais de 5 min sem confirmação (o sistema caiu no meio).
async function aConferir(c) {
  return (await c.query(
    `SELECT f.*, ct.nome, ct.telefone FROM fila_envio f LEFT JOIN contato ct ON ct.id = f.contato_id
      WHERE f.enviando_em IS NOT NULL AND f.enviado_em IS NULL AND f.cancelado_em IS NULL AND f.enviando_em < now() - interval '5 minutes'
      ORDER BY f.id`)).rows;
}

async function resumo(c) {
  return (await c.query(
    `SELECT count(*) FILTER (WHERE enviado_em IS NULL AND cancelado_em IS NULL AND enviando_em IS NULL)::int pendentes,
            count(*) FILTER (WHERE enviado_em IS NULL AND cancelado_em IS NULL AND enviando_em < now() - interval '5 minutes')::int a_conferir,
            count(*) FILTER (WHERE enviado_em >= date_trunc('day', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo')::int enviadas_hoje,
            count(*) FILTER (WHERE enviado_em IS NULL AND cancelado_em IS NULL AND erro IS NOT NULL)::int com_erro
       FROM fila_envio`)).rows[0];
}

module.exports = { enfileirar, processarUm, aConferir, resumo };
