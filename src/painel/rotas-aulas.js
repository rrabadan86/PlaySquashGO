/**
 * Rotas da etapa 1b: criar e cancelar aula pelo painel (AGD-12), contatos com anonimização
 * (OPR-05), exportação (OPR-06) e carga dos feriados nacionais (AGD-03).
 * Mesmas regras do resto do painel: permissão no servidor (PER-03) e histórico na mesma
 * transação (OPR-07), sem dados pessoais no histórico (DAD-07).
 */
const { tx } = require('../db');
const { registrar, atorDoUsuario } = require('../historico');
const { pode } = require('../regras/permissoes');
const { livresDoDia } = require('../agenda/livres');
const { hojeSP, dataSP } = require('../relogio');
const fila = require('../agenda/fila');
const { carregarFeriados } = require('../rotinas');
const { esc, pagina } = require('./html');

class ErroUsuario extends Error {}
const falha = msg => { throw new ErroUsuario(msg); };
const hhmm = ms => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dataBR = iso => String(iso || '').slice(0, 10).split('-').reverse().join('/');
const id = v => { const n = Number.parseInt(v, 10); if (!Number.isFinite(n) || n < 1) falha('Registro inválido.'); return n; };
const telefoneE164 = v => {
  const d = String(v || '').replace(/\D/g, '');
  if (!d) return null;
  const n = d.startsWith('55') ? d : '55' + d;
  if (n.length < 12 || n.length > 13) falha('Telefone inválido: use DDD + número.');
  return '+' + n;
};

function mudanca(permissao, destino, fn) {
  return async ctx => {
    if (!pode(ctx.usuario, permissao)) return ctx.proibido();
    const voltar = typeof destino === 'function' ? destino(ctx) : destino;
    try {
      const r = await tx(ctx.pool, c => fn(ctx, c, atorDoUsuario(ctx.usuario)));
      const alvo = (r && r.destino) || voltar;
      ctx.redirecionar(`${alvo}${alvo.includes('?') ? '&' : '?'}ok=${encodeURIComponent((r && r.msg) || r || 'Salvo.')}`);
    } catch (e) {
      const msg = e instanceof ErroUsuario ? e.message
        : e.code === '23P01' ? 'Esse horário acabou de ser ocupado na quadra. Escolha outro.'
          : e.code === '23505' ? 'Já existe um cadastro igual.' : null;
      if (!msg) throw e;
      ctx.redirecionar(`${voltar}${voltar.includes('?') ? '&' : '?'}erro=${encodeURIComponent(msg)}`);
    }
  };
}

// ───────────── Nova aula (AGD-12) ─────────────
async function getAulaNova(ctx) {
  if (!pode(ctx.usuario, 'aulas.criar')) return ctx.proibido();
  const data = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.data || '') ? ctx.query.data : hojeSP();
  const tipos = (await ctx.pool.query('SELECT id, nome, duracao_min, alunos_por_aula FROM tipo_aula ORDER BY id')).rows;
  const tipoId = Number(ctx.query.tipo) || (tipos[0] && tipos[0].id);
  const tipo = tipos.find(t => t.id === tipoId);
  const quadras = new Map((await ctx.pool.query('SELECT id, nome FROM quadra')).rows.map(q => [q.id, q.nome]));
  const profs = new Map((await ctx.pool.query('SELECT id, nome FROM usuario')).rows.map(u => [u.id, u.nome]));
  let livres = [];
  if (tipo) livres = await livresDoDia(ctx.pool, data, { id: tipo.id, duracaoMin: tipo.duracao_min, alunosPorAula: tipo.alunos_por_aula });
  const opcoes = livres.map(l => `<option value="${l.quadraId}|${l.inicio}">${hhmm(l.inicio)} · ${esc(quadras.get(l.quadraId))} · ${esc(profs.get(l.professorId))}${l.vagas < (tipo ? tipo.alunos_por_aula : 1) ? ` (${l.vagas} vaga)` : ''}</option>`).join('');
  const corpo = `<div class="card"><h2>Escolha o dia e o tipo</h2><form class="linha" method="get" action="/aulas/nova">
<label>Dia<input type="date" name="data" value="${data}" required></label>
<label>Tipo de aula<select name="tipo">${tipos.map(t => `<option value="${t.id}"${t.id === tipoId ? ' selected' : ''}>${esc(t.nome)} (${t.duracao_min} min)</option>`).join('')}</select></label>
<button class="btn">Ver horários livres</button></form></div>
<div class="card"><h2>Horários livres em ${dataBR(data)}</h2>${!tipo ? '<p class="muted">Cadastre um tipo de aula primeiro.</p>' : !livres.length ? '<p class="muted">Nenhum horário livre neste dia para esse tipo de aula (grade, feriado, bloqueio ou horário já passou).</p>'
    : `<form class="linha" method="post" action="/aulas"><input type="hidden" name="data" value="${data}"><input type="hidden" name="tipo" value="${tipo.id}">
<label>Horário<select name="horario" required>${opcoes}</select></label>
<label>Aula<select name="origem"><option value="avulsa">Avulsa</option><option value="experimental">Experimental</option></select></label>
<label>Nome do aluno<input name="nome" required maxlength="80"></label>
<label>WhatsApp<input name="telefone" maxlength="20" placeholder="(62) 99999-9999"></label>
<button class="btn p">Marcar aula</button></form>`}</div>`;
  ctx.html(200, pagina({ titulo: 'Nova aula', usuario: ctx.usuario, ativo: 'grade', corpo, aviso: ctx.aviso() }));
}

const postAula = mudanca('aulas.criar', ctx => `/aulas/nova?data=${encodeURIComponent(ctx.corpo.data || '')}&tipo=${encodeURIComponent(ctx.corpo.tipo || '')}`, async (ctx, c, ator) => {
  const data = String(ctx.corpo.data || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) falha('Dia inválido.');
  const tipo = (await c.query('SELECT * FROM tipo_aula WHERE id = $1', [id(ctx.corpo.tipo)])).rows[0] || falha('Tipo de aula inválido.');
  const [quadraTxt, inicioTxt] = String(ctx.corpo.horario || '').split('|');
  const quadraId = id(quadraTxt), inicio = Number(inicioTxt);
  const origem = ['avulsa', 'experimental'].includes(ctx.corpo.origem) ? ctx.corpo.origem : falha('Escolha avulsa ou experimental.');
  const nome = String(ctx.corpo.nome || '').trim() || falha('Informe o nome do aluno.');
  if (nome.length > 80) falha('Nome longo demais.');
  const tel = telefoneE164(ctx.corpo.telefone);
  // Confere de novo no servidor que o horário está livre (AGD-05); o banco ainda recusa sobreposição (SOF-05).
  const livre = (await livresDoDia(c, data, { id: tipo.id, duracaoMin: tipo.duracao_min, alunosPorAula: tipo.alunos_por_aula }))
    .find(l => l.quadraId === quadraId && l.inicio === inicio);
  if (!livre) falha('Esse horário não está mais livre. Escolha outro.');
  let contato = tel && (await c.query('SELECT id FROM contato WHERE telefone = $1', [tel])).rows[0];
  if (!contato) contato = (await c.query(`INSERT INTO contato (nome, telefone, tipo, origem) VALUES ($1,$2,'lead','painel') RETURNING id`, [nome, tel])).rows[0];
  const fim = inicio + tipo.duracao_min * 60000;
  // Dupla/turma com vaga: entra na aula que já existe; senão, cria a aula.
  let aula = (await c.query(
    `SELECT id FROM aula WHERE quadra_id = $1 AND tipo_aula_id = $2 AND situacao <> 'cancelada'
        AND periodo = tstzrange(to_timestamp($3/1000.0), to_timestamp($4/1000.0)) FOR UPDATE`, [quadraId, tipo.id, inicio, fim])).rows[0];
  if (!aula) {
    aula = (await c.query(
      `INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem)
       VALUES ($1,$2,$3,tstzrange(to_timestamp($4/1000.0), to_timestamp($5/1000.0)),$6) RETURNING id`,
      [quadraId, livre.professorId, tipo.id, inicio, fim, origem])).rows[0];
    await fila.aulaMudou(c, aula.id, 'criar');
  } else {
    await fila.aulaMudou(c, aula.id, 'atualizar');
  }
  await c.query('INSERT INTO aula_participante (aula_id, contato_id) VALUES ($1,$2)', [aula.id, contato.id]);
  await registrar(c, { ator, acao: 'aula.marcada', entidade: 'aula', entidadeId: aula.id, depois: { quadra: quadraId, inicio: new Date(inicio).toISOString(), tipo: tipo.id, origem, contato: contato.id } });
  return { msg: `Aula marcada: ${dataBR(data)} às ${hhmm(inicio)}.`, destino: `/grade?data=${data}` };
});

async function getAula(ctx) {
  if (!pode(ctx.usuario, 'grade.ver')) return ctx.proibido();
  const a = (await ctx.pool.query(
    `SELECT a.*, q.nome quadra, t.nome tipo, u.nome professor, extract(epoch FROM lower(a.periodo))*1000 inicio,
            extract(epoch FROM upper(a.periodo))*1000 fim
       FROM aula a JOIN quadra q ON q.id = a.quadra_id JOIN tipo_aula t ON t.id = a.tipo_aula_id JOIN usuario u ON u.id = a.professor_id
      WHERE a.id = $1`, [Number.parseInt(ctx.params.id, 10) || 0])).rows[0];
  if (!a) return ctx.html(404, pagina({ titulo: 'Aula', usuario: ctx.usuario, ativo: 'grade', corpo: '<div class="card"><p>Aula não encontrada.</p></div>' }));
  const alunos = (await ctx.pool.query(
    `SELECT COALESCE(c.nome,'(anonimizado)') nome, p.situacao FROM aula_participante p JOIN contato c ON c.id = p.contato_id WHERE p.aula_id = $1 ORDER BY c.nome`, [a.id])).rows;
  const g = await fila.situacao(ctx.pool);
  const sync = a.situacao === 'cancelada' ? '' : a.google_evento_id ? '<span class="chip ok">No Google Agenda</span>'
    : ctx.googleConfigurado ? '<span class="chip wait">Indo para o Google Agenda</span>' : '<span class="chip info">Google Agenda ainda não configurado</span>';
  const data = dataSP(Number(a.inicio));
  const corpo = `<div class="card"><h2>${esc(a.tipo)} · ${dataBR(data)} às ${hhmm(Number(a.inicio))}–${hhmm(Number(a.fim))}</h2>
<p>${esc(a.quadra)} · Professor ${esc(a.professor)} · ${esc({ fixa: 'aula fixa', experimental: 'experimental', reposicao: 'reposição', avulsa: 'avulsa' }[a.origem])}</p>
<p>${a.situacao === 'cancelada' ? `<span class="chip no">Cancelada</span> ${esc(a.cancelada_motivo || '')}` : '<span class="chip ok">Marcada</span>'} ${sync}</p>
<h2>Alunos</h2><ul>${alunos.map(x => `<li>${esc(x.nome)}${x.situacao === 'desmarcado' ? ' <span class="chip no">desmarcado</span>' : ''}</li>`).join('') || '<li class="muted">Sem aluno.</li>'}</ul>
${a.situacao !== 'cancelada' && pode(ctx.usuario, 'aulas.cancelar') ? `<form class="linha" method="post" action="/aulas/${a.id}/cancelar">
<label>Motivo do cancelamento<input name="motivo" required maxlength="120"></label><button class="btn r">Cancelar aula</button></form>` : ''}
${g.com_erro ? `<p class="muted">Há ${g.com_erro} envio(s) ao Google com erro; o sistema tenta de novo sozinho.</p>` : ''}</div>
<a class="btn" href="/grade?data=${data}">Voltar para a grade</a>`;
  ctx.html(200, pagina({ titulo: 'Aula', usuario: ctx.usuario, ativo: 'grade', corpo, aviso: ctx.aviso() }));
}

const postAulaCancelar = mudanca('aulas.cancelar', ctx => `/aulas/${encodeURIComponent(ctx.params.id)}`, async (ctx, c, ator) => {
  const aulaId = id(ctx.params.id);
  const motivo = String(ctx.corpo.motivo || '').trim() || falha('Informe o motivo.');
  const a = (await c.query('SELECT situacao FROM aula WHERE id = $1 FOR UPDATE', [aulaId])).rows[0] || falha('Aula não encontrada.');
  if (a.situacao === 'cancelada') falha('A aula já estava cancelada.');
  await c.query(`UPDATE aula SET situacao = 'cancelada', cancelada_motivo = $2 WHERE id = $1`, [aulaId, motivo.slice(0, 120)]);
  await fila.aulaMudou(c, aulaId, 'apagar');
  // Aviso aos alunos e crédito de reposição entram com o WhatsApp e o app (etapas 2 e 3, AGD-08).
  await registrar(c, { ator, acao: 'aula.cancelada', entidade: 'aula', entidadeId: aulaId, antes: { situacao: a.situacao }, depois: { situacao: 'cancelada' }, motivo });
  return 'Aula cancelada. O horário voltou a ficar livre.';
});

// ───────────── Contatos e anonimização (OPR-05) ─────────────
async function getContatos(ctx) {
  if (!pode(ctx.usuario, 'contatos.ver')) return ctx.proibido();
  const busca = String(ctx.query.busca || '').trim().slice(0, 60);
  const rows = (await ctx.pool.query(
    `SELECT c.*, (SELECT count(*)::int FROM aula_participante p WHERE p.contato_id = c.id) aulas FROM contato c
      WHERE ($1 = '' OR c.nome ILIKE '%' || $1 || '%' OR c.telefone LIKE '%' || regexp_replace($1,'\\D','','g') || '%')
      ORDER BY c.anonimizado_em NULLS FIRST, c.nome NULLS LAST LIMIT 200`, [busca])).rows;
  const corpo = `<div class="card"><h2>Contatos</h2><form class="linha" method="get" action="/contatos"><label>Buscar<input name="busca" value="${esc(busca)}" placeholder="nome ou telefone"></label><button class="btn">Buscar</button></form><br>
<div class="tab-wrap"><table><tr><th>Nome</th><th>WhatsApp</th><th>Tipo</th><th>Aulas</th><th></th></tr>
${rows.map(c => `<tr><td>${c.anonimizado_em ? '<span class="muted">(anonimizado)</span>' : esc(c.nome || '—')}</td><td>${esc(c.telefone || '—')}</td><td>${esc(c.tipo)}</td><td>${c.aulas}</td>
<td>${c.anonimizado_em ? `<span class="muted">em ${dataBR(dataSP(new Date(c.anonimizado_em).getTime()))}</span>` : pode(ctx.usuario, 'contatos.anonimizar') ? `<form method="post" action="/contatos/${c.id}/anonimizar" class="linha" onsubmit="return confirm('Apagar nome, telefone, e-mail e nascimento deste contato? Não dá para desfazer.')">
<input name="motivo" required maxlength="120" placeholder="Motivo (ex.: pedido do titular)" aria-label="Motivo"><button class="btn r">Anonimizar</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum contato.</td></tr>'}
</table></div><p class="muted">Anonimizar apaga os dados pessoais e mantém aulas, pagamentos e histórico (sem nome).</p></div>`;
  ctx.html(200, pagina({ titulo: 'Contatos', usuario: ctx.usuario, ativo: 'contatos', corpo, aviso: ctx.aviso() }));
}

const postAnonimizar = mudanca('contatos.anonimizar', '/contatos', async (ctx, c, ator) => {
  const cid = id(ctx.params.id);
  const motivo = String(ctx.corpo.motivo || '').trim() || falha('Informe o motivo.');
  const r = await c.query(
    `UPDATE contato SET nome = NULL, telefone = NULL, email = NULL, data_nascimento = NULL, sem_campanha = true, anonimizado_em = now()
      WHERE id = $1 AND anonimizado_em IS NULL`, [cid]);
  if (!r.rowCount) falha('Contato não encontrado ou já anonimizado.');
  // DAD-07: o histórico não guarda os dados apagados, só quais campos foram apagados.
  await registrar(c, { ator, acao: 'contato.anonimizado', entidade: 'contato', entidadeId: cid, depois: { campos: ['nome', 'telefone', 'email', 'data_nascimento'] }, motivo: motivo.slice(0, 120) });
  return 'Contato anonimizado.';
});

// ───────────── Exportação (OPR-06) ─────────────
const EXPORTS = {
  contatos: { nome: 'Contatos', sql: `SELECT id, tipo, nome, telefone, email, to_char(data_nascimento,'DD/MM/YYYY') nascimento, origem, sem_campanha, to_char(criado_em AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') criado_em, to_char(anonimizado_em AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY') anonimizado_em FROM contato ORDER BY id` },
  aulas: { nome: 'Aulas', sql: `SELECT a.id, q.nome quadra, u.nome professor, t.nome tipo, a.origem, a.situacao, to_char(lower(a.periodo) AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY') dia, to_char(lower(a.periodo) AT TIME ZONE 'America/Sao_Paulo','HH24:MI') inicio, to_char(upper(a.periodo) AT TIME ZONE 'America/Sao_Paulo','HH24:MI') fim, a.cancelada_motivo FROM aula a JOIN quadra q ON q.id = a.quadra_id JOIN usuario u ON u.id = a.professor_id JOIN tipo_aula t ON t.id = a.tipo_aula_id ORDER BY lower(a.periodo)` },
  contratos: { nome: 'Contratos', sql: `SELECT c.id, c.aluno_id, p.nome plano, to_char(c.inicio,'DD/MM/YYYY') inicio, to_char(c.fim,'DD/MM/YYYY') fim, c.valor_mensal, c.desconto_valor, c.desconto_motivo, c.forma, c.parcelas, c.situacao FROM contrato c JOIN plano p ON p.id = c.plano_id ORDER BY c.id` },
  parcelas: { nome: 'Pagamentos', sql: `SELECT id, contrato_id, numero, to_char(competencia,'MM/YYYY') competencia, to_char(vencimento,'DD/MM/YYYY') vencimento, valor, situacao, to_char(pago_em,'DD/MM/YYYY') pago_em FROM parcela ORDER BY id` },
  historico: { nome: 'Histórico', sql: `SELECT id, to_char(em AT TIME ZONE 'America/Sao_Paulo','DD/MM/YYYY HH24:MI') em, ator_tipo, ator_id, origem, acao, entidade, entidade_id, antes::text, depois::text, motivo FROM historico ORDER BY id` },
};

// CSV no padrão do Excel em português: separador ";" e marca UTF-8 no começo.
function csv(rows) {
  if (!rows.length) return '﻿';
  const cols = Object.keys(rows[0]);
  const cel = v => {
    if (v == null) return '';
    let s = typeof v === 'number' ? String(v).replace('.', ',') : String(v);
    if (/^[=+\-@]/.test(s)) s = "'" + s; // evita fórmula no Excel
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [cols.join(';'), ...rows.map(r => cols.map(c => cel(r[c])).join(';'))].join('\r\n') + '\r\n';
}

async function getExportar(ctx) {
  if (!pode(ctx.usuario, 'exportar')) return ctx.proibido();
  const corpo = `<div class="card"><h2>Exportar dados</h2><p class="muted" style="margin-top:-6px">Arquivos que abrem no Excel. Contêm dados pessoais: guarde com cuidado e não envie por WhatsApp.</p>
<div class="checks">${Object.entries(EXPORTS).map(([k, e]) => `<a class="btn" href="/exportar/${k}.csv">${esc(e.nome)}</a>`).join(' ')}</div></div>`;
  ctx.html(200, pagina({ titulo: 'Exportar dados', usuario: ctx.usuario, ativo: 'exportar', corpo }));
}

async function getExportarArquivo(ctx) {
  if (!pode(ctx.usuario, 'exportar')) return ctx.proibido();
  const e = EXPORTS[ctx.params.tabela];
  if (!e) return ctx.html(404, pagina({ titulo: 'Exportar dados', usuario: ctx.usuario, ativo: 'exportar', corpo: '<div class="card">Arquivo não encontrado.</div>' }));
  const { rows } = await ctx.pool.query(e.sql);
  await tx(ctx.pool, c => registrar(c, { ator: atorDoUsuario(ctx.usuario), acao: 'dados.exportados', entidade: 'exportacao', depois: { tabela: ctx.params.tabela, linhas: rows.length } }));
  ctx.res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8', 'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="playsquash-${ctx.params.tabela}-${hojeSP()}.csv"`,
  });
  ctx.res.end(csv(rows));
}

// ───────────── Feriados nacionais (AGD-03) ─────────────
const postFeriadosCarregar = mudanca('cadastros.editar', '/cadastros', async (ctx, c) => {
  const ano = Number(hojeSP().slice(0, 4));
  const n = (await carregarFeriados(c, ano)) + (await carregarFeriados(c, ano + 1));
  return n ? `${n} feriado(s) nacional(is) carregado(s).` : 'Os feriados nacionais já estavam carregados.';
});

const ROTAS_AULAS = [
  ['GET', '/aulas/nova', getAulaNova, true],
  ['POST', '/aulas', postAula, true],
  ['GET', '/aulas/:id', getAula, true],
  ['POST', '/aulas/:id/cancelar', postAulaCancelar, true],
  ['GET', '/contatos', getContatos, true],
  ['POST', '/contatos/:id/anonimizar', postAnonimizar, true],
  ['GET', '/exportar', getExportar, true],
  ['GET', '/exportar/:tabela.csv', getExportarArquivo, true],
  ['POST', '/cadastros/feriados/carregar', postFeriadosCarregar, true],
];

module.exports = { ROTAS_AULAS, csv, livresDoDia };
