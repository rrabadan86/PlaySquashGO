/**
 * App do aluno (APP-01..APP-03, REP-01..REP-05, CON-07). Telas: Aulas, Reposições, Contratos,
 * Histórico. Toda ação confere no servidor se a aula/crédito/contrato é do aluno da sessão (PER-03).
 */
const { tx } = require('../db');
const { registrar } = require('../historico');
const sessao = require('./sessao');
const { paginaApp, paginaEntrar, MANIFESTO, SW, ICONES, esc } = require('./html');
const { desmarcarAula, previaDesmarcar, opcoesReposicao, usarCredito, ErroRegra, quando } = require('../agenda/reposicao');
const { agora, dataSP } = require('../relogio');

const dataBR = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const ORIGEM = { fixa: 'Aula', reposicao: 'Reposição', avulsa: 'Avulsa', experimental: 'Experimental' };
const DESMARCAVEL = new Set(['fixa', 'reposicao', 'avulsa']);
const avisoDe = ctx => ctx.aviso();
const voltarCom = (ctx, para, tipo, texto) => ctx.redirecionar(`${para}${para.includes('?') ? '&' : '?'}${tipo}=${encodeURIComponent(texto)}`);

// Envolve uma tela que precisa de sessão.
function comSessao(fn) {
  return async ctx => {
    const s = await sessao.sessaoDaReq(ctx.pool, ctx.req);
    if (!s) return ctx.redirecionar('/app/entrar');
    ctx.sessao = s;
    const ator = { tipo: 'aluno', id: s.aluno.id };
    try { return await fn(ctx, s, ator); } catch (e) {
      if (e instanceof ErroRegra) return voltarCom(ctx, ctx.voltar || '/app', 'erro', e.message);
      throw e;
    }
  };
}

// ───────────── Entrar (APP-01) ─────────────
async function getEntrar(ctx) {
  ctx.html(200, paginaEntrar({ aviso: avisoDe(ctx), corpo: `<div class="cartao"><h2>Entrar</h2><p class="leve">Digite o WhatsApp cadastrado na Play Squash. Você recebe um código lá.</p>
<form method="post" action="/app/entrar"><label for="tel">WhatsApp com DDD</label><input id="tel" name="telefone" inputmode="tel" autocomplete="tel" required placeholder="(62) 99999-9999">
<button class="btn p cheio">Receber código</button></form></div>` }));
}

async function postEntrar(ctx) {
  const r = await sessao.pedirCodigo(ctx.pool, ctx.corpo.telefone);
  if (!r.ok) return voltarCom(ctx, '/app/entrar', 'erro', r.motivo);
  ctx.redirecionar(`/app/codigo?t=${encodeURIComponent(r.telefone.slice(1))}`);
}

async function getCodigo(ctx) {
  const t = String(ctx.query.t || '').replace(/\D/g, '').slice(0, 13);
  ctx.html(200, paginaEntrar({ aviso: avisoDe(ctx), corpo: `<div class="cartao"><h2>Digite o código</h2>
<p class="leve">Se este número for de um aluno da Play Squash, o código chega no WhatsApp em instantes.</p>
<form method="post" action="/app/codigo"><input type="hidden" name="t" value="${esc(t)}"><label for="cod">Código de 6 números</label>
<input id="cod" name="codigo" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required>
<button class="btn p cheio">Entrar</button></form><p class="leve"><a href="/app/entrar">Não chegou? Pedir outro código</a></p></div>` }));
}

async function postCodigo(ctx) {
  const t = String(ctx.corpo.t || '').replace(/\D/g, '');
  const r = await sessao.entrar(ctx.pool, t, ctx.corpo.codigo, { ip: ctx.ip });
  if (r.erro) return voltarCom(ctx, `/app/codigo?t=${t}`, 'erro', r.erro);
  ctx.redirecionar('/app', { 'Set-Cookie': sessao.cookieDe(r.token, 180, ctx.https) });
}

const postSair = comSessao(async (ctx, s) => {
  await sessao.sair(ctx.pool, s);
  ctx.redirecionar('/app/entrar', { 'Set-Cookie': sessao.cookieSair() });
});

const postAluno = comSessao(async (ctx, s) => {
  await sessao.escolherAluno(ctx.pool, s, Number(ctx.corpo.aluno));
  ctx.redirecionar('/app');
});

// ───────────── Aulas (APP-03) ─────────────
const getAulas = comSessao(async (ctx, s) => {
  const aulas = (await ctx.pool.query(
    `SELECT p.id pid, a.origem, a.situacao, q.nome quadra, u.nome professor, extract(epoch FROM lower(a.periodo))*1000 i
       FROM aula_participante p JOIN aula a ON a.id = p.aula_id JOIN quadra q ON q.id = a.quadra_id JOIN usuario u ON u.id = a.professor_id
      WHERE p.contato_id = $1 AND p.situacao = 'ativo' AND a.situacao <> 'cancelada' AND upper(a.periodo) > to_timestamp($2/1000.0)
      ORDER BY lower(a.periodo) LIMIT 30`, [s.aluno.contato_id, agora()])).rows;
  const corpo = aulas.map(a => `<div class="cartao"><div class="linha"><h2>${quando(Number(a.i))}</h2><span class="chip ${a.origem === 'reposicao' ? 'in' : a.origem === 'experimental' ? 'at' : 'ok'}">${ORIGEM[a.origem]}</span></div>
<p class="leve">${esc(a.quadra)} · Professor ${esc(a.professor)}</p>
${DESMARCAVEL.has(a.origem) && Number(a.i) > agora() ? `<a class="btn r" href="/app/aulas/${a.pid}/desmarcar">Desmarcar</a>` : ''}</div>`).join('')
    || '<div class="cartao vazio">Nenhuma aula marcada nas próximas semanas.</div>';
  ctx.html(200, paginaApp({ titulo: 'Minhas aulas', sessao: s, ativo: 'aulas', corpo: corpo + `<form method="post" action="/app/sair" style="text-align:center"><button class="btn">Sair do app</button></form>`, aviso: avisoDe(ctx) }));
});

async function participacaoDoAluno(c, pid, s) {
  const p = (await c.query('SELECT id FROM aula_participante WHERE id = $1 AND contato_id = $2', [pid, s.aluno.contato_id])).rows[0];
  if (!p) throw new ErroRegra('Aula não encontrada.');
}

const getDesmarcar = comSessao(async (ctx, s) => {
  const pid = Number.parseInt(ctx.params.id, 10) || 0;
  ctx.voltar = '/app';
  await participacaoDoAluno(ctx.pool, pid, s);
  const pr = await tx(ctx.pool, c => previaDesmarcar(c, pid));
  if (!pr || pr.p.situacao !== 'ativo' || !DESMARCAVEL.has(pr.p.origem)) throw new ErroRegra('Essa aula não pode ser desmarcada.');
  const { d } = pr;
  const explica = d.geraCredito ? `<p>Você ganha um <b>crédito de reposição</b> válido até <b>${dataBR(d.validoAte)}</b>.</p>`
    : pr.p.origem === 'reposicao' && d.motivo.startsWith('reposição') ? '<p>Esta é uma reposição: desmarcar <b>não gera outro crédito</b>.</p>'
      : '<p><b>Falta menos de 3 horas</b> para a aula: ela conta como dada e <b>não gera crédito</b>.</p>';
  ctx.html(200, paginaApp({ titulo: 'Desmarcar aula', sessao: s, ativo: 'aulas', aviso: avisoDe(ctx), corpo: `<div class="cartao"><h2>${quando(Number(pr.p.ini))}</h2>${explica}
<form method="post" action="/app/aulas/${pid}/desmarcar"><button class="btn r cheio">Confirmar: desmarcar</button></form><p style="text-align:center"><a class="btn" href="/app">Voltar</a></p></div>` }));
});

const postDesmarcar = comSessao(async (ctx, s, ator) => {
  const pid = Number.parseInt(ctx.params.id, 10) || 0;
  ctx.voltar = '/app';
  await participacaoDoAluno(ctx.pool, pid, s);
  const r = await tx(ctx.pool, async c => {
    const pr = await previaDesmarcar(c, pid);
    if (!pr || !DESMARCAVEL.has(pr.p.origem)) throw new ErroRegra('Essa aula não pode ser desmarcada.');
    return desmarcarAula(c, { participanteId: pid, quem: 'aluno', ator });
  });
  voltarCom(ctx, r.geraCredito ? '/app/reposicoes' : '/app', 'ok', r.geraCredito ? `Aula desmarcada. Crédito válido até ${dataBR(r.validoAte)}.` : 'Aula desmarcada (sem crédito).');
});

// ───────────── Reposições (REP-03, REP-05) ─────────────
const getReposicoes = comSessao(async (ctx, s) => {
  const creditos = (await ctx.pool.query(
    `SELECT cr.id, to_char(cr.valido_ate,'YYYY-MM-DD') ate, extract(epoch FROM lower(a.periodo))*1000 origem_i
       FROM credito_reposicao cr JOIN aula a ON a.id = cr.aula_origem_id
      WHERE cr.aluno_id = $1 AND cr.situacao = 'aberto' AND cr.valido_ate >= $2 ORDER BY cr.valido_ate`, [s.aluno.id, dataSP(agora())])).rows;
  const corpo = creditos.map(cr => `<div class="cartao"><div class="linha"><h2>Crédito de reposição</h2><span class="chip at">até ${dataBR(cr.ate)}</span></div>
<p class="leve">Da aula de ${quando(Number(cr.origem_i))}</p><a class="btn p" href="/app/reposicoes/${cr.id}">Usar</a></div>`).join('')
    || '<div class="cartao vazio">Você não tem crédito de reposição agora.<br>Desmarcando com 3 horas ou mais de antecedência, você ganha um.</div>';
  ctx.html(200, paginaApp({ titulo: 'Reposições', sessao: s, ativo: 'reposicoes', corpo, aviso: avisoDe(ctx) }));
});

const getReposicao = comSessao(async (ctx, s) => {
  ctx.voltar = '/app/reposicoes';
  const { credito, opcoes } = await tx(ctx.pool, c => opcoesReposicao(c, { creditoId: Number.parseInt(ctx.params.id, 10) || 0, alunoId: s.aluno.id }));
  const nomes = new Map((await ctx.pool.query('SELECT id, nome FROM quadra')).rows.map(q => [q.id, q.nome]));
  const profs = new Map((await ctx.pool.query('SELECT id, nome FROM usuario')).rows.map(u => [u.id, u.nome]));
  const corpo = `<p class="leve">Horários livres de ${esc(credito.tipo)} até ${dataBR(credito.ate)}.</p>` + (opcoes.map(o => `<div class="cartao"><div class="linha"><div><h2>${quando(o.inicio)}</h2>
<p class="leve">${esc(nomes.get(o.quadraId))} · Professor ${esc(profs.get(o.professorId) || '')}</p></div>
<form method="post" action="/app/reposicoes/${credito.id}"><input type="hidden" name="horario" value="${o.quadraId}|${o.inicio}"><button class="btn p">Usar</button></form></div></div>`).join('')
    || '<div class="cartao vazio">Nenhum horário livre até o fim da validade. Fale com seu professor.</div>');
  ctx.html(200, paginaApp({ titulo: 'Escolher reposição', sessao: s, ativo: 'reposicoes', corpo, aviso: avisoDe(ctx) }));
});

const postReposicao = comSessao(async (ctx, s, ator) => {
  const cid = Number.parseInt(ctx.params.id, 10) || 0;
  ctx.voltar = `/app/reposicoes/${cid}`;
  const [q, i] = String(ctx.corpo.horario || '').split('|').map(Number);
  try {
    const r = await tx(ctx.pool, c => usarCredito(c, { creditoId: cid, alunoId: s.aluno.id, quadraId: q, inicio: i, ator }));
    voltarCom(ctx, '/app', 'ok', `Reposição marcada: ${r.quando}.`);
  } catch (e) {
    if (e.code === '23P01' || e.code === '23505') throw new ErroRegra('Esse horário acabou de ser ocupado. Escolha outro.');
    throw e;
  }
});

// ───────────── Contratos (APP-03, CON-07) ─────────────
const getContratos = comSessao(async (ctx, s) => {
  const ks = (await ctx.pool.query(
    `SELECT k.*, p.nome plano, m.texto modelo_texto FROM contrato k JOIN plano p ON p.id = k.plano_id LEFT JOIN modelo_contrato m ON m.id = k.modelo_contrato_id
      WHERE k.aluno_id = $1 ORDER BY k.situacao = 'encerrado', k.inicio DESC`, [s.aluno.id])).rows;
  const hs = ks.length ? (await ctx.pool.query(
    `SELECT h.contrato_id, h.dia_semana, to_char(h.hora,'HH24:MI') hh, q.nome quadra FROM horario_fixo h JOIN quadra q ON q.id = h.quadra_id
      WHERE h.contrato_id = ANY($1) AND h.liberado_em IS NULL ORDER BY h.dia_semana, h.hora`, [ks.map(k => k.id)])).rows : [];
  const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
  const SIT = { aguardando_aceite: ['at', 'Aguardando seu aceite'], ativo: ['ok', 'Ativo'], trancado: ['in', 'Trancado'], bloqueado: ['no', 'Bloqueado'], encerrado: ['in', 'Encerrado'] };
  const corpo = ks.map(k => {
    const [cls, rot] = SIT[k.situacao] || ['in', k.situacao];
    const valor = Number(k.valor_mensal) - Number(k.desconto_valor);
    return `<div class="cartao"><div class="linha"><h2>${esc(k.plano)}</h2><span class="chip ${cls}">${rot}</span></div>
<p class="leve">${dataBR(iso(k.inicio))} a ${dataBR(iso(k.fim))}</p>
<p>${hs.filter(h => h.contrato_id === k.id).map(h => `${DIAS[h.dia_semana]} ${h.hh} · ${esc(h.quadra)}`).join('<br>') || '<span class="leve">sem horário fixo</span>'}</p>
<p>${valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })} por mês · ${k.forma === 'avista' ? 'à vista' : `${k.parcelas}×`} · vencimento dia ${k.dia_vencimento}</p>
${k.situacao === 'aguardando_aceite' ? `${k.modelo_texto ? `<details><summary>Ler o contrato</summary><p style="white-space:pre-wrap;font-size:13px">${esc(k.modelo_texto)}</p></details>` : ''}
<form method="post" action="/app/contratos/${k.id}/aceitar"><button class="btn p cheio">Li e aceito o contrato</button></form>` : ''}
${k.aceito_em ? `<p class="leve">Aceito em ${new Date(k.aceito_em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' })}</p>` : ''}</div>`;
  }).join('') || '<div class="cartao vazio">Nenhum contrato.</div>';
  ctx.html(200, paginaApp({ titulo: 'Meus contratos', sessao: s, ativo: 'contratos', corpo, aviso: avisoDe(ctx) }));
});

// CON-07: aceite com data e hora (o texto dos modelos ⏳ kickoff; sem modelo, vale o resumo da tela).
const postAceitar = comSessao(async (ctx, s, ator) => {
  ctx.voltar = '/app/contratos';
  const kid = Number.parseInt(ctx.params.id, 10) || 0;
  await tx(ctx.pool, async c => {
    const k = (await c.query('SELECT situacao FROM contrato WHERE id = $1 AND aluno_id = $2 FOR UPDATE', [kid, s.aluno.id])).rows[0];
    if (!k) throw new ErroRegra('Contrato não encontrado.');
    if (k.situacao !== 'aguardando_aceite') throw new ErroRegra('Esse contrato já foi aceito.');
    await c.query(`UPDATE contrato SET situacao = 'ativo', aceito_em = now() WHERE id = $1`, [kid]);
    await registrar(c, { ator, origem: 'app', acao: 'contrato.aceito', entidade: 'contrato', entidadeId: kid, antes: { situacao: k.situacao }, depois: { situacao: 'ativo', sessao: s.id } });
  });
  voltarCom(ctx, '/app/contratos', 'ok', 'Contrato aceito. Obrigado!');
});

// ───────────── Histórico (APP-03) ─────────────
const getHistorico = comSessao(async (ctx, s) => {
  const aulas = (await ctx.pool.query(
    `SELECT a.origem, a.situacao, p.situacao p_sit, p.presenca, p.desmarcado_motivo, extract(epoch FROM lower(a.periodo))*1000 i, q.nome quadra
       FROM aula_participante p JOIN aula a ON a.id = p.aula_id JOIN quadra q ON q.id = a.quadra_id
      WHERE p.contato_id = $1 AND (upper(a.periodo) <= to_timestamp($2/1000.0) OR p.situacao = 'desmarcado' OR a.situacao = 'cancelada')
      ORDER BY lower(a.periodo) DESC LIMIT 60`, [s.aluno.contato_id, agora()])).rows;
  const creditos = (await ctx.pool.query(
    `SELECT situacao, to_char(valido_ate,'YYYY-MM-DD') ate FROM credito_reposicao WHERE aluno_id = $1 AND situacao <> 'aberto' ORDER BY id DESC LIMIT 20`, [s.aluno.id])).rows;
  const estado = a => a.p_sit === 'desmarcado' ? ['in', 'Desmarcada'] : a.situacao === 'cancelada' ? ['no', 'Cancelada'] : a.presenca === 'falta' ? ['no', 'Falta'] : ['ok', 'Presença'];
  const corpo = aulas.map(a => { const [cls, rot] = estado(a); return `<div class="cartao"><div class="linha"><h2>${quando(Number(a.i))}</h2><span class="chip ${cls}">${rot}</span></div>
<p class="leve">${ORIGEM[a.origem]} · ${esc(a.quadra)}${a.p_sit === 'desmarcado' && a.desmarcado_motivo ? ` · ${esc(a.desmarcado_motivo)}` : ''}</p></div>`; }).join('')
    + (creditos.length ? `<div class="cartao"><h2>Créditos anteriores</h2>${creditos.map(cr => `<p class="leve">${cr.situacao === 'usado' ? 'Usado' : 'Vencido'} · validade ${dataBR(cr.ate)}</p>`).join('')}</div>` : '')
    || '<div class="cartao vazio">Ainda não há aulas no histórico.</div>';
  ctx.html(200, paginaApp({ titulo: 'Histórico', sessao: s, ativo: 'historico', corpo, aviso: avisoDe(ctx) }));
});

// ───────────── Instalável (APP-01) ─────────────
const arquivo = (tipo, conteudo, extras = {}) => async ctx => ctx.enviar(200, tipo, conteudo, { 'Cache-Control': 'public, max-age=86400', ...extras });

module.exports = {
  ROTAS_APP: [
    ['GET', '/app', getAulas, 'app'],
    ['GET', '/app/entrar', getEntrar, 'app'],
    ['POST', '/app/entrar', postEntrar, 'app'],
    ['GET', '/app/codigo', getCodigo, 'app'],
    ['POST', '/app/codigo', postCodigo, 'app'],
    ['POST', '/app/sair', postSair, 'app'],
    ['POST', '/app/aluno', postAluno, 'app'],
    ['GET', '/app/aulas/:id/desmarcar', getDesmarcar, 'app'],
    ['POST', '/app/aulas/:id/desmarcar', postDesmarcar, 'app'],
    ['GET', '/app/reposicoes', getReposicoes, 'app'],
    ['GET', '/app/reposicoes/:id', getReposicao, 'app'],
    ['POST', '/app/reposicoes/:id', postReposicao, 'app'],
    ['GET', '/app/contratos', getContratos, 'app'],
    ['POST', '/app/contratos/:id/aceitar', postAceitar, 'app'],
    ['GET', '/app/historico', getHistorico, 'app'],
    ['GET', '/app/manifest.webmanifest', arquivo('application/manifest+json', MANIFESTO), 'app'],
    ['GET', '/app/sw.js', arquivo('text/javascript; charset=utf-8', SW, { 'Service-Worker-Allowed': '/app', 'Cache-Control': 'no-cache' }), 'app'],
    ['GET', '/app/icone-192.png', arquivo('image/png', ICONES[192]), 'app'],
    ['GET', '/app/icone-512.png', arquivo('image/png', ICONES[512]), 'app'],
  ],
};
