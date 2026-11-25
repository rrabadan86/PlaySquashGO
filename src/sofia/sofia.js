/**
 * A Sofia responde o lead (SOF-01..SOF-12). Chamada quando receberMensagem devolve 'sofia'.
 *
 * - Espera alguns segundos (sofia.agrupar_s) para juntar mensagens seguidas do lead numa resposta.
 * - Nunca responde em dobro: a resposta entra na fila com a chave "sofia:<conversa>:<última mensagem>".
 * - Conversa em atendimento humano (SOF-09) ou Sofia desligada: não responde.
 * - A IA pode usar as ferramentas (src/sofia/ferramentas.js) várias vezes antes de responder.
 * - Custo de cada chamada à IA vai para custo_ia (SOF-12).
 * - IA fora do ar: avisa os administradores (uma vez por conversa por dia) e não responde nada.
 */
const fs = require('fs');
const path = require('path');
const { tx } = require('../db');
const { lerRegras } = require('../config');
const { enfileirar } = require('../whatsapp/envio');
const { agora, dataSP, diaSemana } = require('../relogio');
const { custoUSD } = require('./custo');
const { DEFINICOES, executar, avisarAdmins } = require('./ferramentas');
const { DIAS } = require('./texto');

const PROMPT_PADRAO = fs.readFileSync(path.join(__dirname, 'prompt-padrao.txt'), 'utf8');
const MAX_VOLTAS = 8;      // chamadas à IA por resposta (ferramentas incluídas)
const HISTORICO = 40;      // mensagens da conversa enviadas à IA
const AVISO_EQUIPE = 'Vou chamar alguém da nossa equipe para continuar com você por aqui. 🙂';

function sistemaFixo(regras) {
  const extra = String(regras['sofia.instrucoes'] || '').trim();
  return PROMPT_PADRAO + (extra ? `\n\nINFORMAÇÕES DA PLAY SQUASH (escritas pela equipe)\n${extra}` : '');
}

async function sistemaDoMomento(c, contato) {
  const t = agora();
  const d = dataSP(t);
  const hora = new Date(t).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
  const anexos = (await c.query('SELECT id, nome, descricao FROM sofia_anexo WHERE ativo ORDER BY id')).rows;
  const exps = (await c.query(
    `SELECT a.id, a.situacao, a.conf_pedido_em, a.conf_reenvio_em, a.conf_resposta, extract(epoch FROM lower(a.periodo))*1000 i,
            (SELECT string_agg(ct.nome, ' e ' ORDER BY p.id) FROM aula_participante p JOIN contato ct ON ct.id = p.contato_id
              WHERE p.aula_id = a.id AND p.situacao = 'ativo') nomes
       FROM aula a WHERE a.marcada_por_contato_id = $1 AND a.origem = 'experimental'
        AND a.situacao <> 'cancelada' AND upper(a.periodo) > now() ORDER BY lower(a.periodo)`, [contato.id])).rows;
  const vagas = (await c.query(
    `SELECT extract(epoch FROM inicio)*1000 i FROM lista_espera WHERE contato_id = $1 AND tipo = 'experimental' AND saiu_em IS NULL
        AND avisado_em IS NOT NULL AND preenchida_em IS NULL AND inicio > now() ORDER BY inicio`, [contato.id])).rows;
  const fmt = ms => new Date(ms).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'long', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  return [
    `Agora: ${DIAS[diaSemana(d)]}, ${d.split('-').reverse().join('/')} às ${hora} (horário de Brasília).`,
    `Lead: nome ${contato.nome ? `"${contato.nome}"` : 'ainda não informado'}; já jogou squash: ${contato.ja_jogou == null ? 'não informado' : contato.ja_jogou ? 'sim' : 'não'}.`,
    exps.length ? `Experimentais marcadas por este lead (para trocar, use remarcar_experimental):\n${exps.map(x => `- aula_id ${x.id}: ${fmt(Number(x.i))} — ${x.nomes || ''}${x.situacao === 'confirmada' ? ' (confirmada)' : (x.conf_pedido_em || x.conf_reenvio_em) ? ' (AGUARDANDO CONFIRMAÇÃO: pedimos para o lead confirmar)' : ''}`).join('\n')}` : 'Este lead ainda não tem aula experimental marcada.',
    ...(vagas.length ? [`Avisamos este lead que abriu vaga (lista de espera) em: ${vagas.map(v => fmt(Number(v.i))).join('; ')}. Se ele quiser, chame ver_horarios com a_partir_de nessa data e marque; se a vaga já tiver sido ocupada, explique e ofereça outras.`] : []),
    anexos.length ? `Anexos disponíveis:\n${anexos.map(a => `- id ${a.id}: ${a.nome} — ${a.descricao}`).join('\n')}` : 'Não há anexos cadastrados.',
  ].join('\n');
}

// Histórico do WhatsApp no formato neutro; começa sempre por mensagem do lead.
async function historico(c, contatoId) {
  const rows = (await c.query(
    `SELECT direcao, texto FROM (SELECT id, direcao, texto, em FROM mensagem WHERE contato_id = $1 AND texto IS NOT NULL AND texto <> ''
      ORDER BY em DESC, id DESC LIMIT $2) x ORDER BY em, id`, [contatoId, HISTORICO])).rows;
  const msgs = rows.map(r => ({ papel: r.direcao === 'entrada' ? 'usuario' : 'assistente', texto: r.texto }));
  while (msgs.length && msgs[0].papel !== 'usuario') msgs.shift();
  return msgs;
}

async function registrarCusto(pool, conversaId, r) {
  const entrada = (r.tokensEntrada || 0) + (r.cacheLeitura || 0) + (r.cacheEscrita || 0);
  await pool.query(
    'INSERT INTO custo_ia (conversa_id, modelo, tokens_entrada, tokens_saida, custo_usd) VALUES ($1,$2,$3,$4,$5)',
    [conversaId, r.modelo || 'desconhecido', entrada, r.tokensSaida || 0,
      custoUSD({ modelo: r.modelo, tokensEntrada: r.tokensEntrada, tokensSaida: r.tokensSaida, cacheLeitura: r.cacheLeitura, cacheEscrita: r.cacheEscrita })]);
}

/**
 * Responde a conversa agora (se ainda houver mensagem do lead sem resposta).
 * @returns {Promise<{respondeu:boolean, motivo?:string, texto?:string}>}
 */
async function atender({ pool, ia, conversaId, log = console }) {
  const base = await tx(pool, async c => {
    const regras = await lerRegras(c);
    const conv = (await c.query('SELECT * FROM conversa WHERE id = $1', [conversaId])).rows[0];
    if (!conv) return { parar: 'conversa não encontrada' };
    if (regras['sofia.ligada'] === false) return { parar: 'Sofia desligada' };
    if (conv.estado !== 'sofia') return { parar: 'em atendimento humano' };
    const contato = (await c.query('SELECT * FROM contato WHERE id = $1', [conv.contato_id])).rows[0];
    if (!contato || contato.anonimizado_em) return { parar: 'contato anonimizado' };
    const ultima = (await c.query(`SELECT id FROM mensagem WHERE contato_id = $1 AND direcao = 'entrada' ORDER BY em DESC, id DESC LIMIT 1`, [contato.id])).rows[0];
    if (!ultima) return { parar: 'sem mensagem do lead' };
    const chave = `sofia:${conversaId}:${ultima.id}`;
    if ((await c.query('SELECT 1 FROM fila_envio WHERE chave_unica = $1', [chave])).rowCount) return { parar: 'já respondida' };
    return {
      regras, contato, chave, mensagemId: ultima.id,
      sistemaFixo: sistemaFixo(regras), sistemaDoMomento: await sistemaDoMomento(c, contato),
      mensagens: await historico(c, contato.id),
    };
  });
  if (base.parar) return { respondeu: false, motivo: base.parar };

  const ctx = { pool, contatoId: base.contato.id, conversaId, mensagemId: base.mensagemId };
  const modelo = String(base.regras['sofia.modelo'] || 'claude-opus-5-5');
  const mensagens = [...base.mensagens];
  let texto = '';
  try {
    for (let volta = 0; volta < MAX_VOLTAS; volta++) {
      const r = await ia.responder({ modelo, sistemaFixo: base.sistemaFixo, sistemaDoMomento: base.sistemaDoMomento, mensagens, ferramentas: DEFINICOES });
      await registrarCusto(pool, conversaId, { modelo, ...r });
      if (r.parada === 'refusal') {
        await executar(ctx, 'chamar_humano', { motivo: 'a IA não quis responder esta mensagem' });
        texto = AVISO_EQUIPE;
        break;
      }
      const chamadas = r.chamadas || [];
      if (!chamadas.length) { texto = String(r.texto || '').trim(); break; }
      mensagens.push({ papel: 'assistente', bruto: r.bruto, texto: r.texto, chamadas });
      const resultados = [];
      for (const ch of chamadas) resultados.push({ id: ch.id, ...(await executar(ctx, ch.nome, ch.entrada)) });
      mensagens.push({ papel: 'ferramenta', resultados });
      if (volta === MAX_VOLTAS - 1) {
        await executar(ctx, 'chamar_humano', { motivo: 'a Sofia não conseguiu concluir a resposta' });
        texto = AVISO_EQUIPE;
      }
    }
  } catch (e) {
    log.error(`[sofia] conversa ${conversaId}: ${e.message}`);
    await tx(pool, c => avisarAdmins(c, {
      chave: `ia-falha:${conversaId}:${dataSP(agora())}`,
      texto: 'A Sofia não conseguiu responder um lead (a IA não respondeu). Veja a conversa no painel: Conversas.',
    }));
    return { respondeu: false, motivo: 'erro da IA' };
  }
  if (!texto) return { respondeu: false, motivo: 'IA não mandou texto' };
  const id = await tx(pool, c => enfileirar(c, { contatoId: ctx.contatoId, tipo: 'sofia', texto, chaveUnica: base.chave }));
  return { respondeu: !!id, texto };
}

/**
 * Agenda as respostas: junta mensagens seguidas (espera `agruparMs` sem mensagem nova) e
 * nunca roda duas vezes ao mesmo tempo na mesma conversa.
 */
function criarSofia({ pool, ia, agruparMs = null, log = console }) {
  const timers = new Map(), rodando = new Set(), denovo = new Set();
  async function rodar(conversaId) {
    if (rodando.has(conversaId)) { denovo.add(conversaId); return; }
    rodando.add(conversaId);
    try { await atender({ pool, ia, conversaId, log }); } catch (e) { log.error(`[sofia] ${e.message}`); }
    rodando.delete(conversaId);
    if (denovo.delete(conversaId)) await rodar(conversaId);
  }
  return {
    async aoLead(r) {
      let ms = agruparMs;
      if (ms == null) { const regras = await lerRegras(pool); ms = Number(regras['sofia.agrupar_s'] ?? 8) * 1000; }
      clearTimeout(timers.get(r.conversaId));
      timers.set(r.conversaId, setTimeout(() => { timers.delete(r.conversaId); rodar(r.conversaId); }, ms));
    },
    parar() { for (const t of timers.values()) clearTimeout(t); timers.clear(); },
  };
}

module.exports = { atender, criarSofia, PROMPT_PADRAO };
