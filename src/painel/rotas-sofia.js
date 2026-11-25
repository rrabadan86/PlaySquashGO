/**
 * Telas da Sofia no painel (só administrador, PER-03):
 * - Conversas (SOF-09): lista, mensagens, assumir/devolver à Sofia, responder à mão,
 *   liberar nova experimental (exceção da SOF-06).
 * - Sofia (SOF-10, SOF-12): ligar/desligar, modelo, instruções da Play Squash, anexos e custo da IA.
 * Histórico na mesma transação (OPR-07), sem dados pessoais (DAD-07).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { tx } = require('../db');
const { registrar, atorDoUsuario } = require('../historico');
const { lerRegras, mudarRegra } = require('../config');
const { pode } = require('../regras/permissoes');
const { enfileirar } = require('../whatsapp/envio');
const { chaveNome, dataValida } = require('../sofia/texto');
const { PRECOS } = require('../sofia/custo');
const { esc, pagina } = require('./html');

class ErroUsuario extends Error {}
const falha = msg => { throw new ErroUsuario(msg); };
const id = v => { const n = Number.parseInt(v, 10); if (!Number.isFinite(n) || n < 1) falha('Registro inválido.'); return n; };
const quando = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const usd = v => `US$ ${Number(v || 0).toFixed(2)}`;
const simNao = v => `<option value="1"${v === false ? '' : ' selected'}>Sim</option><option value="0"${v === false ? ' selected' : ''}>Não</option>`;
const TEXTOS_CONFIRMACAO = [
  ['confirmacao.mensagem_pedido', 'Pedido de confirmação'],
  ['confirmacao.mensagem_reenvio', 'Reenvio do pedido'],
  ['confirmacao.mensagem_cancelada', 'Aviso de aula cancelada sem resposta'],
  ['pos_aula.mensagem_dia', 'Pós-aula (mesmo dia)'],
  ['pos_aula.mensagem_falta', 'Pós-aula de quem faltou'],
  ['pos_aula.mensagem_2d', 'Pós-aula (2 dias depois)'],
  ['lista_espera.mensagem_vaga', 'Lista de espera: abriu vaga'],
  ['lista_espera.mensagem_preenchida', 'Lista de espera: vaga já preenchida'],
];
const pastaAnexos = () => process.env.SOFIA_ANEXOS_DIR || path.join(os.homedir(), '.playsquash-anexos');

// Tipos aceitos nos anexos, conferidos pelo começo do arquivo (não só pelo nome).
const TIPOS_ANEXO = {
  'image/jpeg': { ext: '.jpg', assinatura: b => b[0] === 0xff && b[1] === 0xd8 },
  'image/png': { ext: '.png', assinatura: b => b.slice(0, 4).toString('hex') === '89504e47' },
  'application/pdf': { ext: '.pdf', assinatura: b => b.slice(0, 4).toString() === '%PDF' },
};

function mudanca(permissao, destino, fn) {
  return async ctx => {
    if (!pode(ctx.usuario, permissao)) return ctx.proibido();
    const voltar = typeof destino === 'function' ? destino(ctx) : destino;
    try {
      const msg = await tx(ctx.pool, c => fn(ctx, c, atorDoUsuario(ctx.usuario)));
      ctx.redirecionar(`${voltar}${voltar.includes('?') ? '&' : '?'}ok=${encodeURIComponent(msg || 'Salvo.')}`);
    } catch (e) {
      if (!(e instanceof ErroUsuario)) throw e;
      ctx.redirecionar(`${voltar}${voltar.includes('?') ? '&' : '?'}erro=${encodeURIComponent(e.message)}`);
    }
  };
}

// ───────────── Conversas (SOF-09) ─────────────
async function getConversas(ctx) {
  if (!pode(ctx.usuario, 'conversas.ver')) return ctx.proibido();
  const filtro = ctx.query.filtro === 'humano' ? 'humano' : '';
  const rows = (await ctx.pool.query(
    `SELECT v.*, c.nome, c.telefone, c.anonimizado_em,
            (SELECT max(m.em) FROM mensagem m WHERE m.contato_id = v.contato_id) ultima,
            (SELECT texto FROM mensagem m WHERE m.contato_id = v.contato_id ORDER BY m.em DESC, m.id DESC LIMIT 1) ultimo_texto,
            EXISTS (SELECT 1 FROM aula a WHERE a.marcada_por_contato_id = v.contato_id AND a.origem = 'experimental' AND a.situacao <> 'cancelada') marcou
       FROM conversa v JOIN contato c ON c.id = v.contato_id
      WHERE ($1 = '' OR v.estado = $1)
      ORDER BY (v.estado = 'humano') DESC, ultima DESC NULLS LAST LIMIT 200`, [filtro])).rows;
  const humanos = (await ctx.pool.query(`SELECT count(*)::int n FROM conversa WHERE estado = 'humano'`)).rows[0].n;
  const corpo = `<div class="card"><h2>Conversas da Sofia</h2>
<div class="checks"><a class="chip ${filtro ? 'info' : 'ok'}" href="/conversas">Todas</a><a class="chip ${humanos ? 'no' : 'info'}" href="/conversas?filtro=humano">Aguardando a equipe: ${humanos}</a></div>
<div class="tab-wrap"><table><tr><th>Contato</th><th>Situação</th><th>Última mensagem</th><th></th></tr>
${rows.map(v => `<tr><td>${v.anonimizado_em ? '<span class="muted">(anonimizado)</span>' : `${esc(v.nome || '—')}<br><span class="muted">${esc(v.telefone || '')}</span>`}</td>
<td>${v.estado === 'humano' ? '<span class="chip no">Com a equipe</span>' : '<span class="chip ok">Sofia</span>'}${v.marcou ? ' <span class="chip info">Experimental marcada</span>' : ''}</td>
<td>${v.ultima ? `${quando(v.ultima)}<br><span class="muted">${esc(String(v.ultimo_texto || '').slice(0, 80))}</span>` : '—'}</td>
<td><a class="btn" href="/conversas/${v.id}">Abrir</a></td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhuma conversa.</td></tr>'}
</table></div></div>`;
  ctx.html(200, pagina({ titulo: 'Conversas', usuario: ctx.usuario, ativo: 'conversas', corpo, aviso: ctx.aviso() }));
}

async function getConversa(ctx) {
  if (!pode(ctx.usuario, 'conversas.ver')) return ctx.proibido();
  const v = (await ctx.pool.query(
    `SELECT v.*, c.nome, c.telefone, c.ja_jogou, c.anonimizado_em FROM conversa v JOIN contato c ON c.id = v.contato_id WHERE v.id = $1`,
    [Number.parseInt(ctx.params.id, 10) || 0])).rows[0];
  if (!v) return ctx.html(404, pagina({ titulo: 'Conversa', usuario: ctx.usuario, ativo: 'conversas', corpo: '<div class="card"><p>Conversa não encontrada.</p></div>' }));
  const msgs = (await ctx.pool.query(
    `SELECT m.*, f.tipo AS tipo_fila FROM mensagem m LEFT JOIN fila_envio f ON f.id = m.fila_envio_id
      WHERE m.contato_id = $1 ORDER BY m.em DESC, m.id DESC LIMIT 100`, [v.contato_id])).rows.reverse();
  const naFila = (await ctx.pool.query(
    `SELECT texto FROM fila_envio WHERE contato_id = $1 AND enviado_em IS NULL AND cancelado_em IS NULL ORDER BY id`, [v.contato_id])).rows;
  const custo = (await ctx.pool.query(`SELECT COALESCE(sum(custo_usd),0) t, count(*)::int n FROM custo_ia WHERE conversa_id = $1`, [v.id])).rows[0];
  const aulas = (await ctx.pool.query(
    `SELECT a.id, a.situacao, extract(epoch FROM lower(a.periodo))*1000 i FROM aula a
      WHERE a.marcada_por_contato_id = $1 AND a.origem = 'experimental' ORDER BY lower(a.periodo) DESC`, [v.contato_id])).rows;
  const bolha = m => `<div style="margin:6px 0;display:flex;justify-content:${m.direcao === 'entrada' ? 'flex-start' : 'flex-end'}">
<div style="max-width:78%;padding:8px 10px;border-radius:10px;background:${m.direcao === 'entrada' ? 'var(--f)' : 'var(--v2)'};white-space:pre-wrap;overflow-wrap:anywhere">${esc(m.texto || '')}
<div class="muted" style="font-size:12px;margin-top:2px">${quando(m.em)}${m.direcao === 'saida' ? ` · ${esc({ sofia: 'Sofia', aviso: 'equipe', fixa: 'mensagem fixa' }[m.motivo] || m.motivo || '')}` : ''}</div></div></div>`;
  const editar = pode(ctx.usuario, 'conversas.editar') && !v.anonimizado_em;
  const corpo = `<div class="card"><h2>${v.anonimizado_em ? '(anonimizado)' : esc(v.nome || 'Lead sem nome')} <span class="muted">${esc(v.telefone || '')}</span></h2>
<p>${v.estado === 'humano' ? `<span class="chip no">Com a equipe</span> <span class="muted">desde ${v.humano_desde ? quando(v.humano_desde) : '—'}${v.humano_motivo ? ` · ${esc(v.humano_motivo)}` : ''}</span>` : '<span class="chip ok">Sofia respondendo</span>'}
${v.ja_jogou != null ? `<span class="chip info">${v.ja_jogou ? 'Já jogou squash' : 'Nunca jogou'}</span>` : ''}
<span class="chip info">Custo da IA: ${usd(custo.t)} (${custo.n} chamadas)</span></p>
${aulas.length ? `<p>Experimentais: ${aulas.map(a => `<a href="/aulas/${a.id}">${quando(Number(a.i))}</a>${a.situacao === 'cancelada' ? ' (cancelada)' : ''}`).join(' · ')}</p>` : ''}
${editar ? `<div class="linha">${v.estado === 'humano'
    ? `<form method="post" action="/conversas/${v.id}/devolver"><button class="btn p">Devolver à Sofia</button></form>`
    : `<form method="post" action="/conversas/${v.id}/assumir"><button class="btn">Assumir (pausar a Sofia)</button></form>`}</div>` : ''}</div>
<div class="card"><h2>Mensagens</h2>${msgs.map(bolha).join('') || '<p class="muted">Sem mensagens.</p>'}
${naFila.length ? `<p class="muted">Na fila para sair: ${naFila.map(f => esc(String(f.texto).slice(0, 60))).join(' · ')}</p>` : ''}
${editar ? `<form class="linha" method="post" action="/conversas/${v.id}/responder"><label style="flex:1">Responder como equipe<input name="texto" required maxlength="1000"></label><button class="btn p">Enviar</button></form>
<p class="muted">Responder pausa a Sofia nesta conversa. Para ela voltar, use "Devolver à Sofia".</p>` : ''}</div>
${editar ? `<div class="card"><h2>Liberar nova aula experimental</h2><p class="muted" style="margin-top:-6px">Cada pessoa faz uma experimental (nome + data de nascimento). Aqui você libera mais uma para alguém que já fez.</p>
<form class="linha" method="post" action="/conversas/${v.id}/liberar"><label>Nome do participante<input name="nome" required maxlength="80"></label>
<label>Nascimento<input type="date" name="nascimento" required></label><label>Motivo<input name="motivo" required maxlength="120"></label><button class="btn">Liberar</button></form></div>` : ''}
<a class="btn" href="/conversas">Voltar</a>`;
  ctx.html(200, pagina({ titulo: 'Conversa', usuario: ctx.usuario, ativo: 'conversas', corpo, aviso: ctx.aviso() }));
}

const voltarConversa = ctx => `/conversas/${encodeURIComponent(ctx.params.id)}`;

async function mudarEstado(c, conversaId, estado, ator, motivo) {
  const v = (await c.query('SELECT estado FROM conversa WHERE id = $1 FOR UPDATE', [conversaId])).rows[0] || falha('Conversa não encontrada.');
  if (v.estado === estado) return false;
  await c.query(
    `UPDATE conversa SET estado = $2, humano_desde = CASE WHEN $2 = 'humano' THEN now() ELSE NULL END,
            humano_motivo = CASE WHEN $2 = 'humano' THEN $3 ELSE NULL END WHERE id = $1`, [conversaId, estado, motivo]);
  await registrar(c, { ator, acao: estado === 'humano' ? 'conversa.assumida' : 'conversa.devolvida_sofia', entidade: 'conversa', entidadeId: conversaId, antes: { estado: v.estado }, depois: { estado }, motivo });
  return true;
}

const postAssumir = mudanca('conversas.editar', voltarConversa, async (ctx, c, ator) => {
  await mudarEstado(c, id(ctx.params.id), 'humano', ator, 'assumida pela equipe');
  return 'A Sofia está pausada nesta conversa.';
});

const postDevolver = mudanca('conversas.editar', voltarConversa, async (ctx, c, ator) => {
  await mudarEstado(c, id(ctx.params.id), 'sofia', ator, 'devolvida à Sofia');
  return 'A Sofia volta a responder na próxima mensagem do lead.';
});

const postResponder = mudanca('conversas.editar', voltarConversa, async (ctx, c, ator) => {
  const conversaId = id(ctx.params.id);
  const texto = String(ctx.corpo.texto || '').trim() || falha('Escreva a mensagem.');
  const v = (await c.query('SELECT contato_id FROM conversa WHERE id = $1', [conversaId])).rows[0] || falha('Conversa não encontrada.');
  await mudarEstado(c, conversaId, 'humano', ator, 'equipe respondeu');
  const f = await enfileirar(c, { contatoId: v.contato_id, tipo: 'aviso', texto: texto.slice(0, 1000) });
  if (!f) falha('Não dá para mandar mensagem a este contato.');
  await registrar(c, { ator, acao: 'conversa.resposta_equipe', entidade: 'conversa', entidadeId: conversaId, depois: { fila_envio: f } });
  return 'Mensagem na fila de envio.';
});

const postLiberar = mudanca('conversas.editar', voltarConversa, async (ctx, c, ator) => {
  const nome = String(ctx.corpo.nome || '').trim() || falha('Informe o nome.');
  const nascimento = dataValida(ctx.corpo.nascimento) || falha('Data de nascimento inválida.');
  const motivo = String(ctx.corpo.motivo || '').trim() || falha('Informe o motivo.');
  const r = (await c.query(
    `INSERT INTO experimental_liberacao (nome_chave, data_nascimento, liberado_por, motivo) VALUES ($1,$2,$3,$4) RETURNING id`,
    [chaveNome(nome), nascimento, ctx.usuario.id, motivo.slice(0, 120)])).rows[0];
  // DAD-07: o histórico guarda só o id da liberação (o nome fica na tabela da liberação, como chave).
  await registrar(c, { ator, acao: 'experimental.liberada', entidade: 'experimental_liberacao', entidadeId: r.id, depois: { conversa: id(ctx.params.id) }, motivo: motivo.slice(0, 120) });
  return 'Nova experimental liberada. A Sofia já pode marcar.';
});

// ───────────── Sofia: configuração, anexos e custo (SOF-10, SOF-12) ─────────────
async function getSofia(ctx) {
  if (!pode(ctx.usuario, 'sofia.ver')) return ctx.proibido();
  const r = await lerRegras(ctx.pool);
  const anexos = (await ctx.pool.query('SELECT * FROM sofia_anexo ORDER BY ativo DESC, id')).rows;
  const dias = (await ctx.pool.query(
    `SELECT to_char(date_trunc('day', em AT TIME ZONE 'America/Sao_Paulo'),'DD/MM') dia, sum(custo_usd) t, count(DISTINCT conversa_id)::int conversas, count(*)::int chamadas
       FROM custo_ia WHERE em > now() - interval '30 days' GROUP BY 1, date_trunc('day', em AT TIME ZONE 'America/Sao_Paulo') ORDER BY date_trunc('day', em AT TIME ZONE 'America/Sao_Paulo') DESC`)).rows;
  const mes = (await ctx.pool.query(
    `SELECT COALESCE(sum(custo_usd),0) t FROM custo_ia WHERE em >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`)).rows[0].t;
  const topo = (await ctx.pool.query(
    `SELECT v.id, c.nome, c.anonimizado_em, sum(x.custo_usd) t FROM custo_ia x JOIN conversa v ON v.id = x.conversa_id JOIN contato c ON c.id = v.contato_id
      WHERE x.em > now() - interval '30 days' GROUP BY v.id, c.nome, c.anonimizado_em ORDER BY t DESC LIMIT 10`)).rows;
  const editar = pode(ctx.usuario, 'sofia.editar');
  const modelo = String(r['sofia.modelo'] || 'claude-opus-5-5');
  const corpo = `<div class="card"><h2>Sofia</h2>
<p>${r['sofia.ligada'] === false ? '<span class="chip no">Desligada: leads ficam sem resposta automática</span>' : '<span class="chip ok">Ligada</span>'}
${process.env.ANTHROPIC_API_KEY ? '' : ' <span class="chip wait">Chave da Anthropic não configurada neste servidor</span>'}</p>
${editar ? `<form method="post" action="/sofia/config">
<div class="linha"><label>Situação<select name="ligada"><option value="1"${r['sofia.ligada'] === false ? '' : ' selected'}>Ligada</option><option value="0"${r['sofia.ligada'] === false ? ' selected' : ''}>Desligada</option></select></label>
<label>Modelo<select name="modelo">${Object.keys(PRECOS).map(m => `<option${m === modelo ? ' selected' : ''}>${esc(m)}</option>`).join('')}</select></label>
<label>Juntar mensagens seguidas (segundos)<input type="number" name="agrupar" min="0" max="60" value="${Number(r['sofia.agrupar_s'] ?? 8)}"></label></div>
<label>Informações da Play Squash para a Sofia (endereço, o que levar, valores se quiser que ela informe…)<textarea name="instrucoes" rows="8" maxlength="6000" style="width:100%">${esc(String(r['sofia.instrucoes'] || ''))}</textarea></label>
<p class="muted">A Sofia só fala de valores e planos se estiverem aqui. O resto das regras (qualificação, horários, uma experimental por pessoa) já vem do sistema.</p>
<label>Motivo da mudança<input name="motivo" maxlength="120" placeholder="opcional"></label> <button class="btn p">Salvar</button></form>` : ''}</div>
<div class="card"><h2>Confirmação e pós-aula da experimental</h2>
${editar ? `<form method="post" action="/sofia/confirmacao">
<div class="linha"><label>Pedido na véspera às<input type="time" name="pedido_hora" value="${esc(String(r['confirmacao.pedido_hora'] || '19:00'))}" required></label>
<label>Ligado<select name="pedido_ligado">${simNao(r['confirmacao.pedido_ligado'])}</select></label></div>
<div class="linha"><label>Reenviar (minutos antes da aula)<input type="number" name="reenvio_min" min="30" max="720" value="${Number(r['confirmacao.reenvio_min'] ?? 180)}"></label>
<label>Ligado<select name="reenvio_ligado">${simNao(r['confirmacao.reenvio_ligado'])}</select></label></div>
<div class="linha"><label>Cancelar sem resposta (minutos antes)<input type="number" name="cancelamento_min" min="15" max="600" value="${Number(r['confirmacao.cancelamento_min'] ?? 90)}"></label>
<label>Ligado<select name="cancelamento_ligado">${simNao(r['confirmacao.cancelamento_ligado'])}</select></label></div>
<div class="linha"><label>Contato pós-aula (minutos depois do fim)<input type="number" name="contato_min" min="0" max="600" value="${Number(r['pos_aula.contato_min'] ?? 60)}"></label>
<label>Segundo contato, 2 dias depois, às<input type="time" name="hora_2d" value="${esc(String(r['pos_aula.hora_2d'] || '10:00'))}" required></label></div>
${TEXTOS_CONFIRMACAO.map(([chave, rot]) => `<label>${esc(rot)}<textarea name="${chave}" rows="2" maxlength="600" style="width:100%">${esc(String(r[chave] || ''))}</textarea></label>`).join('')}
<p class="muted">Nos textos, {nome}, {quando}, {quadra} e {professor} são trocados pelos dados da aula.</p>
<label>Motivo da mudança<input name="motivo" maxlength="120" placeholder="opcional"></label> <button class="btn p">Salvar</button></form>` : ''}</div>
<div class="card"><h2>Anexos</h2><p class="muted" style="margin-top:-6px">Imagens (JPG/PNG) ou PDF que a Sofia manda quando o lead pede.</p>
<div class="tab-wrap"><table><tr><th>Nome</th><th>Quando mandar</th><th>Tipo</th><th></th></tr>
${anexos.map(a => `<tr><td>${esc(a.nome)}</td><td>${esc(a.descricao)}</td><td>${a.tipo_mime === 'application/pdf' ? 'PDF' : 'Imagem'}</td><td>${a.ativo ? (editar ? `<form method="post" action="/sofia/anexos/${a.id}/desativar"><button class="btn r">Tirar</button></form>` : '') : '<span class="muted">tirado</span>'}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum anexo.</td></tr>'}
</table></div>
${editar ? `<form class="linha" method="post" action="/sofia/anexos" enctype="multipart/form-data">
<label>Nome<input name="nome" required maxlength="60" placeholder="Fotos da quadra"></label>
<label>Quando mandar<input name="descricao" required maxlength="160" placeholder="quando pedirem para ver a escola"></label>
<label>Arquivo (até 5 MB)<input type="file" name="arquivo" accept="image/jpeg,image/png,application/pdf" required></label><button class="btn">Adicionar</button></form>` : ''}</div>
<div class="card"><h2>Custo da IA</h2><p><span class="chip info">Este mês: ${usd(mes)}</span></p>
<div class="tab-wrap"><table><tr><th>Dia</th><th>Conversas</th><th>Chamadas</th><th>Custo</th></tr>
${dias.map(d => `<tr><td>${d.dia}</td><td>${d.conversas}</td><td>${d.chamadas}</td><td>${usd(d.t)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Sem uso nos últimos 30 dias.</td></tr>'}</table></div>
${topo.length ? `<h2>Conversas que mais custaram (30 dias)</h2><ul>${topo.map(t => `<li><a href="/conversas/${t.id}">${t.anonimizado_em ? '(anonimizado)' : esc(t.nome || 'Lead sem nome')}</a> · ${usd(t.t)}</li>`).join('')}</ul>` : ''}</div>`;
  ctx.html(200, pagina({ titulo: 'Sofia', usuario: ctx.usuario, ativo: 'sofia', corpo, aviso: ctx.aviso() }));
}

const postSofiaConfig = mudanca('sofia.editar', '/sofia', async (ctx, c, ator) => {
  const r = await lerRegras(c);
  const motivo = String(ctx.corpo.motivo || '').trim().slice(0, 120) || null;
  const novo = {
    'sofia.ligada': ctx.corpo.ligada !== '0',
    'sofia.modelo': PRECOS[ctx.corpo.modelo] ? ctx.corpo.modelo : falha('Modelo inválido.'),
    'sofia.agrupar_s': (() => { const n = Number(ctx.corpo.agrupar); if (!Number.isInteger(n) || n < 0 || n > 60) falha('Tempo para juntar mensagens: de 0 a 60 segundos.'); return n; })(),
    'sofia.instrucoes': String(ctx.corpo.instrucoes || '').replace(/\r\n/g, '\n').trim().slice(0, 6000),
  };
  let n = 0;
  for (const [chave, valor] of Object.entries(novo)) {
    if (JSON.stringify(r[chave]) === JSON.stringify(valor)) continue;
    await mudarRegra(c, { chave, valor, ator, motivo }); // DAD-06: nova versão, com histórico
    n++;
  }
  return n ? 'Configuração da Sofia salva.' : 'Nada mudou.';
});

const postConfirmacao = mudanca('sofia.editar', '/sofia', async (ctx, c, ator) => {
  const r = await lerRegras(c);
  const motivo = String(ctx.corpo.motivo || '').trim().slice(0, 120) || null;
  const hora = v => (/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v || '')) ? String(v) : falha('Horário inválido.'));
  const num = (v, min, max, rot) => { const n = Number(v); if (!Number.isInteger(n) || n < min || n > max) falha(`${rot}: de ${min} a ${max}.`); return n; };
  const novo = {
    'confirmacao.pedido_hora': hora(ctx.corpo.pedido_hora),
    'confirmacao.pedido_ligado': ctx.corpo.pedido_ligado !== '0',
    'confirmacao.reenvio_min': num(ctx.corpo.reenvio_min, 30, 720, 'Reenvio'),
    'confirmacao.reenvio_ligado': ctx.corpo.reenvio_ligado !== '0',
    'confirmacao.cancelamento_min': num(ctx.corpo.cancelamento_min, 15, 600, 'Cancelamento'),
    'confirmacao.cancelamento_ligado': ctx.corpo.cancelamento_ligado !== '0',
    'pos_aula.contato_min': num(ctx.corpo.contato_min, 0, 600, 'Contato pós-aula'),
    'pos_aula.hora_2d': hora(ctx.corpo.hora_2d),
  };
  if (novo['confirmacao.cancelamento_min'] >= novo['confirmacao.reenvio_min']) falha('O cancelamento tem que ser mais perto da aula que o reenvio.');
  for (const [chave, rot] of TEXTOS_CONFIRMACAO) novo[chave] = String(ctx.corpo[chave] || '').replace(/\r\n/g, '\n').trim().slice(0, 600) || falha(`Escreva o texto: ${rot}.`);
  let n = 0;
  for (const [chave, valor] of Object.entries(novo)) {
    if (JSON.stringify(r[chave]) === JSON.stringify(valor)) continue;
    await mudarRegra(c, { chave, valor, ator, motivo }); // DAD-06
    n++;
  }
  return n ? 'Confirmação e pós-aula salvos.' : 'Nada mudou.';
});

const postAnexo = mudanca('sofia.editar', '/sofia', async (ctx, c, ator) => {
  const nome = String(ctx.corpo.nome || '').trim().slice(0, 60) || falha('Informe o nome do anexo.');
  const descricao = String(ctx.corpo.descricao || '').trim().slice(0, 160) || falha('Diga quando a Sofia deve mandar.');
  const arq = (ctx.corpo._arquivos || []).find(a => a.campo === 'arquivo') || falha('Escolha o arquivo.');
  const tipo = TIPOS_ANEXO[arq.tipo];
  if (!tipo || !tipo.assinatura(arq.dados)) falha('Use imagem JPG/PNG ou PDF.');
  const pasta = pastaAnexos();
  fs.mkdirSync(pasta, { recursive: true, mode: 0o700 });
  const caminho = path.join(pasta, crypto.randomBytes(12).toString('hex') + tipo.ext);
  fs.writeFileSync(caminho, arq.dados, { mode: 0o600 });
  const a = (await c.query(
    'INSERT INTO sofia_anexo (nome, descricao, arquivo, tipo_mime) VALUES ($1,$2,$3,$4) RETURNING id', [nome, descricao, caminho, arq.tipo])).rows[0];
  await registrar(c, { ator, acao: 'sofia.anexo_criado', entidade: 'sofia_anexo', entidadeId: a.id, depois: { nome, tipo: arq.tipo, tamanho: arq.dados.length } });
  return 'Anexo adicionado.';
});

const postAnexoDesativar = mudanca('sofia.editar', '/sofia', async (ctx, c, ator) => {
  const r = await c.query('UPDATE sofia_anexo SET ativo = false WHERE id = $1 AND ativo', [id(ctx.params.id)]);
  if (!r.rowCount) falha('Anexo não encontrado.');
  await registrar(c, { ator, acao: 'sofia.anexo_tirado', entidade: 'sofia_anexo', entidadeId: id(ctx.params.id), antes: { ativo: true }, depois: { ativo: false } });
  return 'Anexo tirado. A Sofia não manda mais.';
});

module.exports = {
  ROTAS_SOFIA: [
    ['GET', '/conversas', getConversas, true],
    ['GET', '/conversas/:id', getConversa, true],
    ['POST', '/conversas/:id/assumir', postAssumir, true],
    ['POST', '/conversas/:id/devolver', postDevolver, true],
    ['POST', '/conversas/:id/responder', postResponder, true],
    ['POST', '/conversas/:id/liberar', postLiberar, true],
    ['GET', '/sofia', getSofia, true],
    ['POST', '/sofia/config', postSofiaConfig, true],
    ['POST', '/sofia/confirmacao', postConfirmacao, true],
    ['POST', '/sofia/anexos', postAnexo, true],
    ['POST', '/sofia/anexos/:id/desativar', postAnexoDesativar, true],
  ],
  TIPOS_ANEXO,
};
