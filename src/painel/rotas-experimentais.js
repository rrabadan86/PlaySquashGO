/**
 * Tela Experimentais (CNF-03, CNF-06): próximas e recentes, com a confirmação, a presença e o
 * resultado do lead (matriculou ou perdido, com o motivo escolhido pelo admin). Só administrador
 * (PER-03); histórico na mesma transação, só com IDs (DAD-07).
 */
const { tx } = require('../db');
const { registrar, atorDoUsuario } = require('../historico');
const { pode } = require('../regras/permissoes');
const { registrarResposta } = require('../sofia/confirmacao');
const { agora } = require('../relogio');
const { esc, pagina } = require('./html');

const MOTIVOS_PERDA = ['Preço', 'Horário não serviu', 'Distância', 'Não gostou da aula', 'Não respondeu', 'Outro'];

class ErroUsuario extends Error {}
const falha = msg => { throw new ErroUsuario(msg); };
const id = v => { const n = Number.parseInt(v, 10); if (!Number.isFinite(n) || n < 1) falha('Registro inválido.'); return n; };
const quando = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

function mudanca(permissao, fn) {
  return async ctx => {
    if (!pode(ctx.usuario, permissao)) return ctx.proibido();
    const voltar = `/experimentais${ctx.corpo.filtro === 'passadas' ? '?filtro=passadas' : ''}`;
    try {
      const msg = await tx(ctx.pool, c => fn(ctx, c, atorDoUsuario(ctx.usuario)));
      ctx.redirecionar(`${voltar}${voltar.includes('?') ? '&' : '?'}ok=${encodeURIComponent(msg)}`);
    } catch (e) {
      if (!(e instanceof ErroUsuario)) throw e;
      ctx.redirecionar(`${voltar}${voltar.includes('?') ? '&' : '?'}erro=${encodeURIComponent(e.message)}`);
    }
  };
}

function chipSituacao(a, t) {
  if (a.situacao === 'cancelada') return `<span class="chip no">Cancelada${a.cancelada_motivo ? ` · ${esc(a.cancelada_motivo)}` : ''}</span>`;
  if (Number(a.fim) <= t) return '<span class="chip info">Já aconteceu</span>';
  if (a.situacao === 'confirmada') return '<span class="chip ok">Confirmada</span>';
  if (a.conf_pedido_em || a.conf_reenvio_em) return '<span class="chip wait">Aguardando confirmação</span>';
  return '<span class="chip info">Marcada</span>';
}

async function getExperimentais(ctx) {
  if (!pode(ctx.usuario, 'experimentais.ver')) return ctx.proibido();
  const passadas = ctx.query.filtro === 'passadas';
  const t = agora();
  const aulas = (await ctx.pool.query(
    `SELECT a.*, extract(epoch FROM lower(a.periodo))*1000 ini, extract(epoch FROM upper(a.periodo))*1000 fim, q.nome quadra, u.nome professor,
            v.id conversa_id
       FROM aula a JOIN quadra q ON q.id = a.quadra_id JOIN usuario u ON u.id = a.professor_id
       LEFT JOIN LATERAL (SELECT id FROM conversa WHERE contato_id = a.marcada_por_contato_id ORDER BY id DESC LIMIT 1) v ON true
      WHERE a.origem = 'experimental' AND ${passadas
    ? `upper(a.periodo) <= to_timestamp($1/1000.0) AND upper(a.periodo) > to_timestamp($1/1000.0) - interval '30 days' ORDER BY lower(a.periodo) DESC`
    : `upper(a.periodo) > to_timestamp($1/1000.0) ORDER BY lower(a.periodo)`} LIMIT 200`, [t])).rows;
  const part = aulas.length ? (await ctx.pool.query(
    `SELECT p.id, p.aula_id, p.contato_id, p.presenca, p.confirmacao, ct.nome, ct.telefone, ct.anonimizado_em, r.resultado, r.motivo_perda
       FROM aula_participante p JOIN contato ct ON ct.id = p.contato_id LEFT JOIN lead_resultado r ON r.contato_id = p.contato_id
      WHERE p.aula_id = ANY($1) AND p.situacao = 'ativo' ORDER BY p.id`, [aulas.map(a => a.id)])).rows : [];
  const editar = pode(ctx.usuario, 'experimentais.editar');
  const filtroCampo = `<input type="hidden" name="filtro" value="${passadas ? 'passadas' : ''}">`;
  const linhaAluno = (a, p) => {
    const nome = p.anonimizado_em ? '<span class="muted">(anonimizado)</span>' : `${esc(p.nome || '—')}${p.telefone ? `<br><span class="muted">${esc(p.telefone)}</span>` : ''}`;
    const aconteceu = Number(a.fim) <= t && a.situacao !== 'cancelada';
    const presenca = !aconteceu ? '' : editar
      ? `<form class="linha" method="post" action="/experimentais/participante/${p.id}/presenca">${filtroCampo}
<select name="presenca" aria-label="Presença"><option value="presente"${p.presenca !== 'falta' ? ' selected' : ''}>Veio</option><option value="falta"${p.presenca === 'falta' ? ' selected' : ''}>Faltou</option></select><button class="btn">Salvar</button></form>`
      : (p.presenca === 'falta' ? 'Faltou' : 'Veio');
    const resultado = p.resultado === 'matriculou' ? '<span class="chip ok">Matriculou</span>'
      : p.resultado === 'perdido' ? `<span class="chip no">Perdido · ${esc(p.motivo_perda || '')}</span>` : '<span class="muted">sem resultado</span>';
    const formRes = aconteceu && editar && !p.anonimizado_em ? `<form class="linha" method="post" action="/experimentais/contato/${p.contato_id}/resultado">${filtroCampo}
<select name="resultado" aria-label="Resultado"><option value="matriculou"${p.resultado === 'perdido' ? '' : ' selected'}>Matriculou</option><option value="perdido"${p.resultado === 'perdido' ? ' selected' : ''}>Perdido</option></select>
<select name="motivo" aria-label="Motivo da perda"><option value="">Motivo (se perdido)</option>${MOTIVOS_PERDA.map(m => `<option${p.motivo_perda === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select>
<button class="btn">Salvar</button></form>` : '';
    return `<div style="margin:4px 0">${nome}${aconteceu ? `<div class="linha" style="margin-top:4px">${presenca}</div><div style="margin-top:4px">${resultado}</div>${formRes}` : ''}</div>`;
  };
  const corpo = `<div class="card"><h2>Aulas experimentais</h2>
<div class="checks"><a class="chip ${passadas ? 'info' : 'ok'}" href="/experimentais">Próximas</a><a class="chip ${passadas ? 'ok' : 'info'}" href="/experimentais?filtro=passadas">Últimos 30 dias</a></div>
${aulas.map(a => `<div style="border-top:1px solid var(--l);padding:12px 0">
<div class="linha" style="justify-content:space-between;align-items:flex-start">
<div><b>${quando(Number(a.ini))}</b><br><span class="muted">${esc(a.quadra)} · ${esc(a.professor)}</span></div>
<div>${chipSituacao(a, t)}</div></div>
<div style="margin-top:6px">${part.filter(p => p.aula_id === a.id).map(p => linhaAluno(a, p)).join('') || '<span class="muted">—</span>'}</div>
<div class="linha" style="margin-top:6px"><a class="btn" href="/aulas/${a.id}">Aula</a>${a.conversa_id ? `<a class="btn" href="/conversas/${a.conversa_id}">Conversa</a>` : ''}
${editar && a.situacao === 'marcada' && Number(a.ini) > t ? `<form method="post" action="/experimentais/${a.id}/resposta" class="linha">${filtroCampo}
<button class="btn" name="resposta" value="confirmou">Confirmou</button><button class="btn r" name="resposta" value="nao_vai">Não vai</button></form>` : ''}</div></div>`).join('')
  || `<p class="muted">${passadas ? 'Nenhuma experimental nos últimos 30 dias.' : 'Nenhuma experimental marcada.'}</p>`}
<p class="muted">A confirmação é pedida na véspera pelo WhatsApp; quando a pessoa responde para você em vez da Sofia, registre aqui. Depois da aula, marque quem veio e o resultado.</p></div>`;
  ctx.html(200, pagina({ titulo: 'Experimentais', usuario: ctx.usuario, ativo: 'experimentais', corpo, aviso: ctx.aviso() }));
}

const postResposta = mudanca('experimentais.editar', async (ctx, c, ator) => {
  const resposta = ['confirmou', 'nao_vai'].includes(ctx.corpo.resposta) ? ctx.corpo.resposta : falha('Resposta inválida.');
  const r = await registrarResposta(c, { aulaId: id(ctx.params.id), resposta, ator, origem: 'painel' });
  if (!r.ok) falha(r.motivo);
  return resposta === 'confirmou' ? 'Experimental confirmada.' : 'Experimental cancelada; o horário ficou livre.';
});

const postPresenca = mudanca('experimentais.editar', async (ctx, c, ator) => {
  const presenca = ['presente', 'falta'].includes(ctx.corpo.presenca) ? ctx.corpo.presenca : falha('Presença inválida.');
  const p = (await c.query(
    `SELECT p.id, p.presenca, p.aula_id, extract(epoch FROM upper(a.periodo))*1000 fim FROM aula_participante p JOIN aula a ON a.id = p.aula_id
      WHERE p.id = $1 AND a.origem = 'experimental' FOR UPDATE OF p`, [id(ctx.params.id)])).rows[0] || falha('Participante não encontrado.');
  if (Number(p.fim) > agora()) falha('A aula ainda não aconteceu.');
  if (p.presenca === presenca) return 'Nada mudou.';
  await c.query('UPDATE aula_participante SET presenca = $2 WHERE id = $1', [p.id, presenca]);
  await registrar(c, { ator, acao: 'aula.presenca', entidade: 'aula', entidadeId: p.aula_id, antes: { participante: p.id, presenca: p.presenca }, depois: { participante: p.id, presenca } });
  return 'Presença salva.';
});

const postResultado = mudanca('experimentais.editar', async (ctx, c, ator) => {
  const contatoId = id(ctx.params.id);
  const resultado = ['matriculou', 'perdido'].includes(ctx.corpo.resultado) ? ctx.corpo.resultado : falha('Resultado inválido.');
  const motivo = resultado === 'perdido' ? (MOTIVOS_PERDA.includes(ctx.corpo.motivo) ? ctx.corpo.motivo : falha('Escolha o motivo da perda.')) : null;
  const fez = (await c.query(
    `SELECT 1 FROM aula_participante p JOIN aula a ON a.id = p.aula_id WHERE p.contato_id = $1 AND a.origem = 'experimental' AND p.situacao = 'ativo' LIMIT 1`, [contatoId])).rowCount;
  if (!fez) falha('Esse contato não tem aula experimental.');
  const antes = (await c.query('SELECT resultado, motivo_perda FROM lead_resultado WHERE contato_id = $1 FOR UPDATE', [contatoId])).rows[0] || null;
  await c.query(
    `INSERT INTO lead_resultado (contato_id, resultado, motivo_perda, registrado_por) VALUES ($1,$2,$3,$4)
     ON CONFLICT (contato_id) DO UPDATE SET resultado = EXCLUDED.resultado, motivo_perda = EXCLUDED.motivo_perda, registrado_por = EXCLUDED.registrado_por, em = now()`,
    [contatoId, resultado, motivo, ctx.usuario.id]);
  await registrar(c, { ator, acao: 'lead.resultado', entidade: 'contato', entidadeId: contatoId, antes, depois: { resultado, motivo_perda: motivo } });
  return resultado === 'matriculou' ? 'Matrícula registrada. 🎉' : 'Resultado salvo.';
});

module.exports = {
  ROTAS_EXPERIMENTAIS: [
    ['GET', '/experimentais', getExperimentais, true],
    ['POST', '/experimentais/:id/resposta', postResposta, true],
    ['POST', '/experimentais/participante/:id/presenca', postPresenca, true],
    ['POST', '/experimentais/contato/:id/resultado', postResultado, true],
  ],
  MOTIVOS_PERDA,
};
