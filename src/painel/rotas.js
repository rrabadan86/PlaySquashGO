/**
 * Rotas do painel (etapa 1a). Toda rota confere a permissão no servidor (PER-03) e toda
 * mudança grava no histórico na mesma transação (OPR-07).
 */
const { tx } = require('../db');
const { registrar, atorDoUsuario } = require('../historico');
const { lerRegras } = require('../config');
const senha = require('../auth/senha');
const sessao = require('../auth/sessao');
const { pode, TELAS, TELAS_LIBERAVEIS, TELAS_PROFESSOR_PADRAO } = require('../regras/permissoes');
const { hojeSP, somarDias, instanteSP, diaSemana, dataSP } = require('../relogio');
const { esc, pagina, paginaLogin } = require('./html');
const fila = require('../agenda/fila');

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const CATEGORIAS = ['individual', 'dupla', 'turma', 'kids', 'experimental'];
const MIN = 60000;

class ErroUsuario extends Error {}
const falha = msg => { throw new ErroUsuario(msg); };
const hhmm = ms => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dataBR = iso => iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '';
const isoDe = d => d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10);
const inteiro = (v, nome, min, max) => {
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n) || n < min || n > max) falha(`${nome}: informe um número entre ${min} e ${max}.`);
  return n;
};
const texto = (v, nome, max = 120) => {
  const t = String(v == null ? '' : v).trim();
  if (!t) falha(`${nome}: obrigatório.`);
  if (t.length > max) falha(`${nome}: no máximo ${max} caracteres.`);
  return t;
};
const hora = (v, nome) => { const t = String(v || ''); if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)) falha(`${nome}: use HH:MM.`); return t; };
const dataIso = (v, nome) => { const t = String(v || ''); if (!/^\d{4}-\d{2}-\d{2}$/.test(t) || Number.isNaN(Date.parse(t))) falha(`${nome}: data inválida.`); return t; };
const lista = v => (v == null ? [] : Array.isArray(v) ? v : [v]);

// ───────────── Login ─────────────
const tentativas = new Map(); // ip|email → { n, desde }
function bloqueadoLogin(chave) {
  const t = tentativas.get(chave);
  return t && t.n >= 10 && Date.now() - t.desde < 15 * MIN;
}
function falhaLogin(chave) {
  const t = tentativas.get(chave);
  if (!t || Date.now() - t.desde > 15 * MIN) tentativas.set(chave, { n: 1, desde: Date.now() });
  else t.n++;
}

async function getLogin(ctx) { ctx.html(200, paginaLogin()); }

async function postLogin(ctx) {
  const email = String(ctx.corpo.email || '').trim().toLowerCase();
  const chave = `${ctx.ip}|${email}`;
  if (bloqueadoLogin(chave)) return ctx.html(429, paginaLogin({ erro: 'Muitas tentativas. Espere 15 minutos.', email }));
  const { rows } = await ctx.pool.query('SELECT id, senha_hash, ativo FROM usuario WHERE lower(email) = $1', [email]);
  const u = rows[0];
  if (!u || !u.ativo || !senha.conferir(ctx.corpo.senha || '', u.senha_hash)) {
    falhaLogin(chave);
    return ctx.html(401, paginaLogin({ erro: 'E-mail ou senha incorretos.', email }));
  }
  tentativas.delete(chave);
  const id = await tx(ctx.pool, async c => {
    const sid = await sessao.criar(c, u.id, ctx.ip);
    await registrar(c, { ator: { tipo: 'sistema', id: null }, acao: 'login', entidade: 'usuario', entidadeId: u.id });
    return sid;
  });
  ctx.redirecionar('/grade', { 'Set-Cookie': sessao.cookieDe(ctx.segredo, id, { https: ctx.https }) });
}

async function postSair(ctx) {
  if (ctx.usuario) await tx(ctx.pool, c => sessao.revogar(c, ctx.usuario.sessao_id));
  ctx.redirecionar('/login', { 'Set-Cookie': sessao.cookieSair() });
}

// ───────────── Grade do dia (M1) ─────────────
async function dadosDoDia(c, data) {
  const ini = instanteSP(data, '00:00'), fim = instanteSP(somarDias(data, 1), '00:00');
  const quadras = (await c.query('SELECT id, nome FROM quadra WHERE ativa ORDER BY id')).rows;
  const faixas = (await c.query(
    `SELECT f.id, f.quadra_id, f.dia_semana, to_char(f.inicio,'HH24:MI') inicio, to_char(f.fim,'HH24:MI') fim,
            f.professor_id, u.nome professor
       FROM grade_faixa f JOIN usuario u ON u.id = f.professor_id
      WHERE f.cancelada_em IS NULL AND f.dia_semana = $1 AND f.vigente_desde <= $2 AND (f.vigente_ate IS NULL OR f.vigente_ate >= $2)
      ORDER BY f.inicio`, [diaSemana(data), data])).rows;
  const aulas = (await c.query(
    `SELECT a.id, a.quadra_id, a.origem, a.situacao, t.categoria, t.nome tipo, u.nome professor,
            extract(epoch FROM lower(a.periodo))*1000 AS inicio, extract(epoch FROM upper(a.periodo))*1000 AS fim,
            COALESCE(string_agg(ct.nome, ' + ' ORDER BY ct.nome) FILTER (WHERE p.situacao = 'ativo'), '') alunos
       FROM aula a JOIN tipo_aula t ON t.id = a.tipo_aula_id JOIN usuario u ON u.id = a.professor_id
       LEFT JOIN aula_participante p ON p.aula_id = a.id LEFT JOIN contato ct ON ct.id = p.contato_id
      WHERE a.situacao <> 'cancelada' AND a.periodo && tstzrange(to_timestamp($1/1000.0), to_timestamp($2/1000.0))
      GROUP BY a.id, t.id, u.id`, [ini, fim])).rows.map(a => ({ ...a, inicio: Number(a.inicio), fim: Number(a.fim) }));
  const bloqueios = (await c.query(
    `SELECT b.id, b.quadra_id, b.professor_id, b.motivo,
            extract(epoch FROM lower(b.periodo))*1000 AS inicio, extract(epoch FROM upper(b.periodo))*1000 AS fim
       FROM bloqueio b WHERE b.cancelado_em IS NULL AND b.periodo && tstzrange(to_timestamp($1/1000.0), to_timestamp($2/1000.0))`, [ini, fim]))
    .rows.map(b => ({ ...b, inicio: Number(b.inicio), fim: Number(b.fim) }));
  const feriado = (await c.query('SELECT nome FROM feriado WHERE data = $1 AND cancelado_em IS NULL', [data])).rows[0];
  return { quadras, faixas, aulas, bloqueios, feriado };
}

async function getGrade(ctx) {
  if (!pode(ctx.usuario, 'grade.ver')) return ctx.proibido();
  const data = /^\d{4}-\d{2}-\d{2}$/.test(ctx.query.data || '') ? ctx.query.data : hojeSP();
  const regras = await lerRegras(ctx.pool);
  const intervalo = Number(regras['grade.intervalo_min'] || 30);
  const d = await dadosDoDia(ctx.pool, data);
  const titulo = `${DIAS[diaSemana(data)]}, ${dataBR(data)}`;
  const nav = `<a class="btn" href="/grade?data=${somarDias(data, -1)}" aria-label="Dia anterior">‹</a>
    <form method="get" action="/grade"><input type="date" name="data" value="${data}" aria-label="Data" onchange="this.form.submit()"></form>
    <a class="btn" href="/grade?data=${somarDias(data, 1)}" aria-label="Próximo dia">›</a><a class="btn" href="/grade">Hoje</a>${pode(ctx.usuario, 'aulas.criar') ? `<a class="btn p" href="/aulas/nova?data=${data}">+ Aula</a>` : ''}`;
  let corpo;
  if (!d.quadras.length) {
    corpo = `<div class="card"><h2>${esc(titulo)}</h2><p class="muted">Nenhuma quadra cadastrada. ${pode(ctx.usuario, 'cadastros.editar') ? '<a href="/cadastros">Cadastre as quadras e a grade</a>.' : 'Peça ao administrador para cadastrar.'}</p></div>`;
  } else if (d.feriado) {
    corpo = `<div class="card"><h2>${esc(titulo)}</h2><p><span class="chip info">Feriado</span> ${esc(d.feriado.nome)} — sem aulas na grade.</p></div>`;
  } else {
    corpo = `<div class="card" style="padding:0;border:none;background:none"><h2 style="margin:0 0 10px">${esc(titulo)}</h2>${montarGrade(data, d, intervalo)}</div>
      <div class="leg"><span><i style="background:var(--v)"></i>Aula fixa</span><span><i style="background:var(--dup)"></i>Avulsa / dupla</span>
      <span><i style="background:var(--exp)"></i>Experimental</span><span><i style="background:var(--rep)"></i>Reposição</span>
      <span><i style="background:#c4d2cc"></i>Livre</span><span><i style="background:#9aa6a2"></i>Bloqueado</span></div>`;
  }
  ctx.html(200, pagina({ titulo: 'Grade', usuario: ctx.usuario, ativo: 'grade', acoes: nav, corpo, aviso: ctx.aviso() }));
}

function montarGrade(data, d, intervalo) {
  if (!d.faixas.length && !d.aulas.length) return '<p class="muted">Sem horários na grade neste dia.</p>';
  const pontos = [...d.faixas.flatMap(f => [instanteSP(data, f.inicio), instanteSP(data, f.fim)]), ...d.aulas.flatMap(a => [a.inicio, a.fim])];
  const ini = Math.min(...pontos), fim = Math.max(...pontos);
  const passo = intervalo * MIN;
  const linhas = Math.ceil((fim - ini) / passo);
  const cols = d.quadras.length;
  let h = `<div class="tab-wrap"><div class="grade" style="grid-template-columns:56px repeat(${cols},minmax(150px,1fr));min-width:${56 + cols * 150}px">`;
  h += '<div class="h" style="grid-row:1;grid-column:1"></div>';
  d.quadras.forEach((q, i) => {
    const profs = [...new Set(d.faixas.filter(f => f.quadra_id === q.id).map(f => f.professor))];
    h += `<div class="h" style="grid-row:1;grid-column:${i + 2}">${esc(q.nome)}<small>${esc(profs.join(', ') || 'sem grade hoje')}</small></div>`;
  });
  for (let r = 0; r < linhas; r++) h += `<div class="hora" style="grid-row:${r + 2};grid-column:1">${hhmm(ini + r * passo)}</div>`;
  d.quadras.forEach((q, i) => {
    const col = i + 2;
    for (let r = 0; r < linhas; r++) {
      const s = ini + r * passo, e = s + passo;
      const aula = d.aulas.find(a => a.quadra_id === q.id && a.inicio < e && s < a.fim);
      if (aula) {
        if (aula.inicio >= s || r === 0) {
          const span = Math.max(1, Math.ceil((Math.min(aula.fim, fim) - Math.max(aula.inicio, s)) / passo));
          const cls = aula.origem === 'fixa' && aula.categoria === 'dupla' ? 'dupla' : aula.origem;
          const nome = { fixa: 'Aula', experimental: 'Experimental', reposicao: 'Reposição', avulsa: 'Avulsa' }[aula.origem];
          h += `<div class="cel" style="grid-row:${r + 2}/span ${span};grid-column:${col}"><a class="ev ${cls}" href="/aulas/${aula.id}" style="display:block;text-decoration:none"><b>${esc(nome)} — ${esc(aula.alunos || 'sem aluno')}${aula.situacao === 'confirmada' ? ' ✓' : ''}</b>${esc(aula.tipo)} · ${esc(aula.professor)}</a></div>`;
          r += span - 1;
        }
        continue;
      }
      const bloq = d.bloqueios.find(b => (b.quadra_id == null || b.quadra_id === q.id) && b.inicio < e && s < b.fim);
      const faixa = d.faixas.find(f => f.quadra_id === q.id && instanteSP(data, f.inicio) <= s && e <= instanteSP(data, f.fim));
      if (bloq && (faixa || bloq.quadra_id === q.id)) h += `<div class="cel" style="grid-row:${r + 2};grid-column:${col}"><div class="ev bloq"><b>Bloqueado</b>${esc(bloq.motivo)}</div></div>`;
      else if (faixa) h += `<div class="cel" style="grid-row:${r + 2};grid-column:${col}"><div class="ev livre"><b>Livre</b>${esc(faixa.professor)}</div></div>`;
      else h += `<div class="cel" style="grid-row:${r + 2};grid-column:${col}"></div>`;
    }
  });
  return h + '</div></div>';
}

// ───────────── Cadastros (AGD-01, AGD-02, AGD-03, AGD-07) ─────────────
async function getCadastros(ctx) {
  if (!pode(ctx.usuario, 'cadastros.ver')) return ctx.proibido();
  const edita = pode(ctx.usuario, 'cadastros.editar');
  const p = ctx.pool;
  const quadras = (await p.query('SELECT * FROM quadra ORDER BY id')).rows;
  const tipos = (await p.query('SELECT * FROM tipo_aula ORDER BY id')).rows;
  const profs = (await p.query('SELECT id, nome FROM usuario WHERE eh_professor AND ativo ORDER BY nome')).rows;
  const faixas = (await p.query(
    `SELECT f.*, to_char(f.inicio,'HH24:MI') hi, to_char(f.fim,'HH24:MI') hf, q.nome quadra, u.nome professor,
            COALESCE(string_agg(t.nome, ', ' ORDER BY t.id), '') tipos
       FROM grade_faixa f JOIN quadra q ON q.id = f.quadra_id JOIN usuario u ON u.id = f.professor_id
       LEFT JOIN grade_faixa_tipo ft ON ft.grade_faixa_id = f.id LEFT JOIN tipo_aula t ON t.id = ft.tipo_aula_id
      WHERE f.cancelada_em IS NULL AND (f.vigente_ate IS NULL OR f.vigente_ate >= current_date)
      GROUP BY f.id, q.id, u.nome ORDER BY q.id, f.dia_semana, f.inicio`)).rows;
  const bloqueios = (await p.query(
    `SELECT b.*, q.nome quadra, u.nome professor, lower(b.periodo) de, upper(b.periodo) ate FROM bloqueio b
       LEFT JOIN quadra q ON q.id = b.quadra_id LEFT JOIN usuario u ON u.id = b.professor_id
      WHERE b.cancelado_em IS NULL AND upper(b.periodo) >= now() ORDER BY lower(b.periodo)`)).rows;
  const feriados = (await p.query('SELECT * FROM feriado WHERE cancelado_em IS NULL AND data >= current_date ORDER BY data LIMIT 30')).rows;
  const opt = (arr, rot = x => x.nome) => arr.map(x => `<option value="${x.id}">${esc(rot(x))}</option>`).join('');
  const fmtTs = t => `${dataBR(isoDe(dataSP(new Date(t).getTime())))} ${hhmm(new Date(t).getTime())}`;
  const botao = (acao, rot, extra = '') => edita ? `<form method="post" action="${acao}" style="display:inline">${extra}<button class="btn r">${rot}</button></form>` : '';

  const g = await fila.situacao(p);
  const avisoGoogle = !ctx.googleConfigurado
    ? `<div class="aviso ok" style="background:#E8EEFC;color:#3651A8">Google Agenda ainda não configurado: as aulas ficam guardadas e vão para o Google quando a conta de serviço for ligada${g.pendentes ? ` (${g.pendentes} na fila)` : ''}.</div>`
    : g.com_erro ? `<div class="aviso erro">${g.com_erro} envio(s) ao Google Agenda com erro; o sistema tenta de novo sozinho. Último erro: ${esc(g.ultimo_erro || '')}</div>` : '';
  const corpo = `${edita ? avisoGoogle : ''}
<div class="card"><h2>Quadras</h2><div class="tab-wrap"><table><tr><th>Quadra</th><th>Situação</th><th>Agenda Google</th><th></th></tr>
${quadras.map(q => `<tr><td>${esc(q.nome)}</td><td>${q.ativa ? '<span class="chip ok">Ativa</span>' : '<span class="chip no">Inativa</span>'}</td>
<td>${q.google_agenda_id ? '<span class="chip ok">Criada</span>' : ctx.googleConfigurado ? '<span class="chip wait">Criando…</span>' : '<span class="chip info">Google não configurado</span>'}</td><td>${edita ? `<form method="post" action="/cadastros/quadra/${q.id}/ativa"><input type="hidden" name="ativa" value="${q.ativa ? '0' : '1'}"><button class="btn">${q.ativa ? 'Desativar' : 'Ativar'}</button></form>` : ''}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhuma quadra.</td></tr>'}
</table></div>${edita ? `<br><form class="linha" method="post" action="/cadastros/quadra"><label>Nova quadra<input name="nome" required maxlength="60" placeholder="Quadra 3"></label><button class="btn p">Adicionar</button></form>` : ''}</div>

<div class="card"><h2>Tipos de aula</h2><div class="tab-wrap"><table><tr><th>Tipo</th><th>Categoria</th><th>Duração</th><th>Alunos por aula</th></tr>
${tipos.map(t => `<tr><td>${esc(t.nome)}</td><td>${esc(t.categoria)}</td><td>${t.duracao_min} min</td><td>${t.alunos_por_aula}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum tipo.</td></tr>'}
</table></div>${edita ? `<br><form class="linha" method="post" action="/cadastros/tipo"><label>Nome<input name="nome" required maxlength="60"></label>
<label>Categoria<select name="categoria">${CATEGORIAS.map(c => `<option>${c}</option>`).join('')}</select></label>
<label>Duração (min)<input name="duracao_min" type="number" min="15" max="240" step="15" value="30" required></label>
<label>Alunos por aula<input name="alunos_por_aula" type="number" min="1" max="20" value="1" required></label><button class="btn p">Adicionar</button></form>` : ''}</div>

<div class="card"><h2>Grade de horários</h2><p class="muted" style="margin-top:-6px">Os alunos ficam ligados ao horário, não ao professor: trocar o professor de uma faixa mantém os alunos.</p>
<div class="tab-wrap"><table><tr><th>Quadra</th><th>Dia</th><th>Horário</th><th>Professor</th><th>Tipos</th><th>Desde</th><th></th></tr>
${faixas.map(f => `<tr><td>${esc(f.quadra)}</td><td>${DIAS[f.dia_semana]}</td><td>${f.hi}–${f.hf}</td>
<td>${edita ? `<form method="post" action="/cadastros/faixa/${f.id}/professor" class="linha"><select name="professor_id" aria-label="Professor">${profs.map(x => `<option value="${x.id}"${x.id === f.professor_id ? ' selected' : ''}>${esc(x.nome)}</option>`).join('')}</select><button class="btn">Trocar</button></form>` : esc(f.professor)}</td>
<td>${esc(f.tipos)}</td><td>${dataBR(isoDe(f.vigente_desde))}</td><td>${botao(`/cadastros/faixa/${f.id}/encerrar`, 'Encerrar')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nenhuma faixa cadastrada.</td></tr>'}
</table></div>${edita && quadras.length && profs.length && tipos.length ? `<br><form class="linha" method="post" action="/cadastros/faixa">
<label>Quadra<select name="quadra_id">${opt(quadras.filter(q => q.ativa))}</select></label>
<fieldset class="checks" style="border:none;padding:0;margin:0"><legend class="muted" style="font-size:12px">Dias</legend>${DIAS.map((dn, i) => `<label><input type="checkbox" name="dias" value="${i}"${i >= 1 && i <= 5 ? ' checked' : ''}>${dn.slice(0, 3)}</label>`).join('')}</fieldset>
<label>Início<input type="time" name="inicio" value="06:30" required></label><label>Fim<input type="time" name="fim" value="12:00" required></label>
<label>Professor<select name="professor_id">${opt(profs)}</select></label>
<fieldset class="checks" style="border:none;padding:0;margin:0"><legend class="muted" style="font-size:12px">Tipos permitidos</legend>${tipos.map(t => `<label><input type="checkbox" name="tipos" value="${t.id}" checked>${esc(t.nome)}</label>`).join('')}</fieldset>
<label>Vale a partir de<input type="date" name="vigente_desde" value="${hojeSP()}" required></label><button class="btn p">Adicionar faixa</button></form>`
    : (edita ? '<p class="muted">Para montar a grade, cadastre ao menos uma quadra, um tipo de aula e um professor (em Usuários).</p>' : '')}</div>

<div class="card"><h2>Bloqueios</h2><p class="muted" style="margin-top:-6px">Férias de professor, manutenção de quadra, evento. Quadra ou professor em branco = vale para todos.</p>
<div class="tab-wrap"><table><tr><th>De</th><th>Até</th><th>Quadra</th><th>Professor</th><th>Motivo</th><th></th></tr>
${bloqueios.map(b => `<tr><td>${fmtTs(b.de)}</td><td>${fmtTs(b.ate)}</td><td>${esc(b.quadra || 'Todas')}</td><td>${esc(b.professor || 'Todos')}</td><td>${esc(b.motivo)}</td><td>${botao(`/cadastros/bloqueio/${b.id}/cancelar`, 'Cancelar')}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum bloqueio futuro.</td></tr>'}
</table></div>${edita ? `<br><form class="linha" method="post" action="/cadastros/bloqueio">
<label>De<input type="datetime-local" name="de" required></label><label>Até<input type="datetime-local" name="ate" required></label>
<label>Quadra<select name="quadra_id"><option value="">Todas</option>${opt(quadras)}</select></label>
<label>Professor<select name="professor_id"><option value="">Todos</option>${opt(profs)}</select></label>
<label>Motivo<input name="motivo" required maxlength="120"></label><button class="btn p">Bloquear</button></form>` : ''}</div>

<div class="card"><h2>Feriados</h2><p class="muted" style="margin-top:-6px">Dia de feriado não tem horário livre na grade. Os feriados nacionais entram sozinhos; estaduais e municipais são cadastrados aqui. Feriado removido não volta.</p>
<div class="tab-wrap"><table><tr><th>Data</th><th>Feriado</th><th>Abrangência</th><th></th></tr>
${feriados.map(f => `<tr><td>${dataBR(isoDe(f.data))}</td><td>${esc(f.nome)}</td><td>${esc(f.abrangencia)}</td><td>${botao('/cadastros/feriado/cancelar', 'Remover', `<input type="hidden" name="data" value="${isoDe(f.data)}">`)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">Nenhum feriado futuro.</td></tr>'}
</table></div>${edita ? `<br><form class="linha" method="post" action="/cadastros/feriado"><label>Data<input type="date" name="data" required></label>
<label>Nome<input name="nome" required maxlength="80"></label><label>Abrangência<select name="abrangencia"><option>nacional</option><option>estadual</option><option>municipal</option></select></label><button class="btn p">Adicionar</button></form>
<br><form method="post" action="/cadastros/feriados/carregar"><button class="btn">Carregar feriados nacionais (este ano e o próximo)</button></form>` : ''}</div>`;
  ctx.html(200, pagina({ titulo: 'Quadras e professores', usuario: ctx.usuario, ativo: 'cadastros', corpo, aviso: ctx.aviso() }));
}

// Executa uma mudança de cadastro: confere permissão, roda na transação e volta para a tela.
function mudanca(acaoPermissao, destino, fn) {
  return async ctx => {
    if (!pode(ctx.usuario, acaoPermissao)) return ctx.proibido();
    try {
      const msg = await tx(ctx.pool, c => fn(ctx, c, atorDoUsuario(ctx.usuario)));
      ctx.redirecionar(`${destino}?ok=${encodeURIComponent(msg || 'Salvo.')}`);
    } catch (e) {
      if (e instanceof ErroUsuario) return ctx.redirecionar(`${destino}?erro=${encodeURIComponent(e.message)}`);
      if (e.code === '23505') return ctx.redirecionar(`${destino}?erro=${encodeURIComponent('Já existe um cadastro igual.')}`);
      throw e;
    }
  };
}

const postQuadra = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const nome = texto(ctx.corpo.nome, 'Nome da quadra', 60);
  const { rows } = await c.query('INSERT INTO quadra (nome) VALUES ($1) RETURNING *', [nome]);
  await registrar(c, { ator, acao: 'quadra.criada', entidade: 'quadra', entidadeId: rows[0].id, depois: rows[0] });
  await fila.quadraCriada(c, rows[0].id); // AGD-09: agenda da quadra no Google
  await fila.conferirCompartilhamentos(c);
  return `Quadra "${nome}" adicionada.`;
});

const postQuadraAtiva = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const id = inteiro(ctx.params.id, 'Quadra', 1, 1e12);
  const ativa = ctx.corpo.ativa === '1';
  const antes = (await c.query('SELECT * FROM quadra WHERE id = $1 FOR UPDATE', [id])).rows[0] || falha('Quadra não encontrada.');
  await c.query('UPDATE quadra SET ativa = $2 WHERE id = $1', [id, ativa]);
  await registrar(c, { ator, acao: ativa ? 'quadra.ativada' : 'quadra.desativada', entidade: 'quadra', entidadeId: id, antes: { ativa: antes.ativa }, depois: { ativa } });
  if (ativa && !antes.google_agenda_id) await fila.quadraCriada(c, id);
  await fila.conferirCompartilhamentos(c);
  return ativa ? 'Quadra ativada.' : 'Quadra desativada.';
});

const postTipo = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const nome = texto(ctx.corpo.nome, 'Nome do tipo', 60);
  const categoria = CATEGORIAS.includes(ctx.corpo.categoria) ? ctx.corpo.categoria : falha('Categoria inválida.');
  const duracao = inteiro(ctx.corpo.duracao_min, 'Duração', 15, 240);
  const alunos = inteiro(ctx.corpo.alunos_por_aula, 'Alunos por aula', 1, 20);
  const { rows } = await c.query('INSERT INTO tipo_aula (nome, categoria, duracao_min, alunos_por_aula) VALUES ($1,$2,$3,$4) RETURNING *', [nome, categoria, duracao, alunos]);
  await registrar(c, { ator, acao: 'tipo_aula.criado', entidade: 'tipo_aula', entidadeId: rows[0].id, depois: rows[0] });
  return `Tipo "${nome}" adicionado.`;
});

const postFaixa = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const quadra = inteiro(ctx.corpo.quadra_id, 'Quadra', 1, 1e12);
  const prof = inteiro(ctx.corpo.professor_id, 'Professor', 1, 1e12);
  const ini = hora(ctx.corpo.inicio, 'Início'), fim = hora(ctx.corpo.fim, 'Fim');
  if (fim <= ini) falha('O fim precisa ser depois do início.');
  const desde = dataIso(ctx.corpo.vigente_desde, 'Vale a partir de');
  const dias = [...new Set(lista(ctx.corpo.dias).map(d => inteiro(d, 'Dia', 0, 6)))];
  if (!dias.length) falha('Marque ao menos um dia.');
  const tipos = [...new Set(lista(ctx.corpo.tipos).map(t => inteiro(t, 'Tipo', 1, 1e12)))];
  if (!tipos.length) falha('Marque ao menos um tipo de aula.');
  const p = (await c.query('SELECT id FROM usuario WHERE id = $1 AND eh_professor AND ativo', [prof])).rows[0] || falha('Professor inválido.');
  for (const dia of dias) {
    // Mesma quadra e dia com horário sobreposto não pode (a grade ficaria ambígua).
    const conflito = await c.query(
      `SELECT 1 FROM grade_faixa WHERE quadra_id = $1 AND dia_semana = $2 AND cancelada_em IS NULL
          AND (vigente_ate IS NULL OR vigente_ate >= $5) AND inicio < $4::time AND $3::time < fim`, [quadra, dia, ini, fim, desde]);
    if (conflito.rowCount) falha(`Já existe faixa nessa quadra na ${DIAS[dia].toLowerCase()} que se sobrepõe a ${ini}–${fim}.`);
    // Professor não pode estar em duas quadras ao mesmo tempo (AGD-05).
    const ocupado = await c.query(
      `SELECT 1 FROM grade_faixa WHERE professor_id = $1 AND dia_semana = $2 AND cancelada_em IS NULL
          AND (vigente_ate IS NULL OR vigente_ate >= $5) AND inicio < $4::time AND $3::time < fim`, [p.id, dia, ini, fim, desde]);
    if (ocupado.rowCount) falha(`O professor já tem faixa na ${DIAS[dia].toLowerCase()} nesse horário.`);
    const { rows } = await c.query(
      'INSERT INTO grade_faixa (quadra_id, dia_semana, inicio, fim, professor_id, vigente_desde) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [quadra, dia, ini, fim, p.id, desde]);
    for (const t of tipos) await c.query('INSERT INTO grade_faixa_tipo (grade_faixa_id, tipo_aula_id) VALUES ($1,$2)', [rows[0].id, t]);
    await registrar(c, { ator, acao: 'grade.faixa_criada', entidade: 'grade_faixa', entidadeId: rows[0].id, depois: { quadra, dia, ini, fim, professor: p.id, tipos, desde } });
  }
  return `${dias.length} faixa(s) adicionada(s).`;
});

const postFaixaProfessor = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const id = inteiro(ctx.params.id, 'Faixa', 1, 1e12);
  const prof = inteiro(ctx.corpo.professor_id, 'Professor', 1, 1e12);
  const f = (await c.query('SELECT * FROM grade_faixa WHERE id = $1 FOR UPDATE', [id])).rows[0] || falha('Faixa não encontrada.');
  if (f.professor_id === prof) return 'Nada mudou.';
  (await c.query('SELECT 1 FROM usuario WHERE id = $1 AND eh_professor AND ativo', [prof])).rowCount || falha('Professor inválido.');
  const ocupado = await c.query(
    `SELECT 1 FROM grade_faixa WHERE professor_id = $1 AND dia_semana = $2 AND id <> $5 AND cancelada_em IS NULL
        AND (vigente_ate IS NULL OR vigente_ate >= current_date) AND inicio < $4 AND $3 < fim`, [prof, f.dia_semana, f.inicio, f.fim, id]);
  if (ocupado.rowCount) falha('Esse professor já tem faixa nesse horário em outra quadra.');
  // AGD-07: os alunos ficam no horário; só o professor da faixa (e das aulas futuras dela, etapa 3) muda.
  await c.query('UPDATE grade_faixa SET professor_id = $2 WHERE id = $1', [id, prof]);
  await registrar(c, { ator, acao: 'grade.professor_trocado', entidade: 'grade_faixa', entidadeId: id, antes: { professor: f.professor_id }, depois: { professor: prof } });
  return 'Professor da faixa trocado. Os alunos continuam no mesmo horário.';
});

const postFaixaEncerrar = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const id = inteiro(ctx.params.id, 'Faixa', 1, 1e12);
  const f = (await c.query('SELECT * FROM grade_faixa WHERE id = $1 FOR UPDATE', [id])).rows[0] || falha('Faixa não encontrada.');
  // Encerra a partir de hoje (não apaga, DAD-03). Faixa que ainda não começou é cancelada.
  if (isoDe(f.vigente_desde) > hojeSP()) await c.query('UPDATE grade_faixa SET cancelada_em = now() WHERE id = $1', [id]);
  else await c.query('UPDATE grade_faixa SET vigente_ate = $2 WHERE id = $1', [id, hojeSP()]);
  await registrar(c, { ator, acao: 'grade.faixa_encerrada', entidade: 'grade_faixa', entidadeId: id, antes: { vigente_ate: f.vigente_ate }, depois: { vigente_ate: hojeSP() } });
  return 'Faixa encerrada.';
});

const postBloqueio = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const de = String(ctx.corpo.de || ''), ate = String(ctx.corpo.ate || '');
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(de) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(ate)) falha('Informe início e fim do bloqueio.');
  const ini = instanteSP(de.slice(0, 10), de.slice(11)), fim = instanteSP(ate.slice(0, 10), ate.slice(11));
  if (fim <= ini) falha('O fim do bloqueio precisa ser depois do início.');
  const quadra = ctx.corpo.quadra_id ? inteiro(ctx.corpo.quadra_id, 'Quadra', 1, 1e12) : null;
  const prof = ctx.corpo.professor_id ? inteiro(ctx.corpo.professor_id, 'Professor', 1, 1e12) : null;
  const motivo = texto(ctx.corpo.motivo, 'Motivo', 120);
  const { rows } = await c.query(
    `INSERT INTO bloqueio (quadra_id, professor_id, periodo, motivo, criado_por)
     VALUES ($1,$2,tstzrange(to_timestamp($3/1000.0), to_timestamp($4/1000.0)),$5,$6) RETURNING id`, [quadra, prof, ini, fim, motivo, ctx.usuario.id]);
  // Aulas já marcadas no período: aviso aos alunos e reposição seguem AGD-08 (etapa 3; ⏳ kickoff para feriados).
  const afetadas = await c.query(
    `SELECT count(*)::int n FROM aula WHERE situacao <> 'cancelada' AND periodo && tstzrange(to_timestamp($1/1000.0), to_timestamp($2/1000.0))
        AND ($3::bigint IS NULL OR quadra_id = $3) AND ($4::bigint IS NULL OR professor_id = $4)`, [ini, fim, quadra, prof]);
  await registrar(c, { ator, acao: 'bloqueio.criado', entidade: 'bloqueio', entidadeId: rows[0].id, depois: { quadra, prof, de, ate, motivo, aulasAfetadas: afetadas.rows[0].n } });
  return afetadas.rows[0].n ? `Bloqueio criado. Atenção: ${afetadas.rows[0].n} aula(s) já marcada(s) no período.` : 'Bloqueio criado.';
});

const postBloqueioCancelar = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const id = inteiro(ctx.params.id, 'Bloqueio', 1, 1e12);
  const r = await c.query('UPDATE bloqueio SET cancelado_em = now() WHERE id = $1 AND cancelado_em IS NULL', [id]);
  if (!r.rowCount) falha('Bloqueio não encontrado.');
  await registrar(c, { ator, acao: 'bloqueio.cancelado', entidade: 'bloqueio', entidadeId: id });
  return 'Bloqueio cancelado.';
});

const postFeriado = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const data = dataIso(ctx.corpo.data, 'Data');
  const nome = texto(ctx.corpo.nome, 'Nome', 80);
  const abr = ['nacional', 'estadual', 'municipal'].includes(ctx.corpo.abrangencia) ? ctx.corpo.abrangencia : 'nacional';
  await c.query(
    `INSERT INTO feriado (data, nome, abrangencia) VALUES ($1,$2,$3)
     ON CONFLICT (data) DO UPDATE SET nome = EXCLUDED.nome, abrangencia = EXCLUDED.abrangencia, cancelado_em = NULL`, [data, nome, abr]);
  await registrar(c, { ator, acao: 'feriado.criado', entidade: 'feriado', depois: { data, nome, abr } });
  return `Feriado de ${dataBR(data)} adicionado.`;
});

const postFeriadoCancelar = mudanca('cadastros.editar', '/cadastros', async (ctx, c, ator) => {
  const data = dataIso(ctx.corpo.data, 'Data');
  const r = await c.query('UPDATE feriado SET cancelado_em = now() WHERE data = $1 AND cancelado_em IS NULL', [data]);
  if (!r.rowCount) falha('Feriado não encontrado.');
  await registrar(c, { ator, acao: 'feriado.removido', entidade: 'feriado', antes: { data } });
  return 'Feriado removido.';
});

// ───────────── Usuários (PER-01, PER-02) ─────────────
async function getUsuarios(ctx) {
  if (!pode(ctx.usuario, 'usuarios.ver')) return ctx.proibido();
  const us = (await ctx.pool.query(
    `SELECT u.*, COALESCE(array_agg(t.tela) FILTER (WHERE t.tela IS NOT NULL), '{}') telas,
            (SELECT count(*)::int FROM sessao s WHERE s.usuario_id = u.id AND s.revogada_em IS NULL AND s.criada_em > now() - interval '30 days') sessoes
       FROM usuario u LEFT JOIN usuario_tela t ON t.usuario_id = u.id GROUP BY u.id ORDER BY u.ativo DESC, u.nome`)).rows;
  const linhas = us.map(u => `<tr><td><b>${esc(u.nome)}</b><br><span class="muted">${esc(u.email)}</span></td>
<td>${u.eh_admin ? '<span class="chip info">Admin</span> ' : ''}${u.eh_professor ? '<span class="chip ok">Professor</span>' : ''}</td>
<td>${u.ativo ? 'Ativo' : '<span class="chip no">Inativo</span>'}</td><td>${u.sessoes}</td>
<td><form method="post" action="/usuarios/${u.id}" class="linha">
<div class="checks"><label><input type="checkbox" name="eh_admin" value="1"${u.eh_admin ? ' checked' : ''}>Admin</label>
<label><input type="checkbox" name="eh_professor" value="1"${u.eh_professor ? ' checked' : ''}>Professor</label>
<label><input type="checkbox" name="ativo" value="1"${u.ativo ? ' checked' : ''}>Ativo</label></div>
<div class="checks">${TELAS_LIBERAVEIS.map(t => `<label><input type="checkbox" name="telas" value="${t}"${u.telas.includes(t) ? ' checked' : ''}>${esc(TELAS[t])}</label>`).join('')}</div>
<label>Nova senha<input type="password" name="senha" minlength="${senha.MINIMO}" autocomplete="new-password" placeholder="(manter)"></label>
<button class="btn">Salvar</button></form>
${u.sessoes ? `<form method="post" action="/usuarios/${u.id}/encerrar-sessoes"><button class="btn r">Encerrar sessões</button></form>` : ''}</td></tr>`).join('');
  const corpo = `<div class="card"><h2>Usuários do painel</h2><p class="muted" style="margin-top:-6px">Administrador vê tudo. Professor vê só as telas marcadas e nunca vê valores.</p>
<div class="tab-wrap"><table><tr><th>Nome</th><th>Perfil</th><th>Situação</th><th>Sessões</th><th>Acesso</th></tr>${linhas}</table></div></div>
<div class="card"><h2>Novo usuário</h2><form class="linha" method="post" action="/usuarios/novo">
<label>Nome<input name="nome" required maxlength="80"></label><label>E-mail<input type="email" name="email" required maxlength="120"></label>
<label>WhatsApp<input name="telefone" maxlength="20" placeholder="+5562..."></label>
<label>Senha inicial<input type="password" name="senha" required minlength="${senha.MINIMO}" autocomplete="new-password"></label>
<div class="checks"><label><input type="checkbox" name="eh_admin" value="1">Admin</label><label><input type="checkbox" name="eh_professor" value="1" checked>Professor</label></div>
<button class="btn p">Criar</button></form></div>`;
  ctx.html(200, pagina({ titulo: 'Usuários', usuario: ctx.usuario, ativo: 'usuarios', corpo, aviso: ctx.aviso() }));
}

const postUsuarioNovo = mudanca('usuarios.editar', '/usuarios', async (ctx, c, ator) => {
  const nome = texto(ctx.corpo.nome, 'Nome', 80);
  const email = texto(ctx.corpo.email, 'E-mail', 120).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) falha('E-mail inválido.');
  if (!senha.senhaValida(ctx.corpo.senha)) falha(`A senha precisa de pelo menos ${senha.MINIMO} caracteres.`);
  const admin = ctx.corpo.eh_admin === '1', prof = ctx.corpo.eh_professor === '1';
  if (!admin && !prof) falha('Marque Admin ou Professor.');
  const tel = String(ctx.corpo.telefone || '').trim() || null;
  const { rows } = await c.query(
    'INSERT INTO usuario (nome, email, telefone, eh_admin, eh_professor, senha_hash) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [nome, email, tel, admin, prof, senha.gerarHash(ctx.corpo.senha)]);
  if (prof && !admin) for (const t of TELAS_PROFESSOR_PADRAO) await c.query('INSERT INTO usuario_tela VALUES ($1,$2)', [rows[0].id, t]);
  await registrar(c, { ator, acao: 'usuario.criado', entidade: 'usuario', entidadeId: rows[0].id, depois: { nome, email, admin, prof } });
  await fila.conferirCompartilhamentos(c); // AGD-09: agendas compartilhadas com quem é admin ou professor
  return `Usuário ${nome} criado.`;
});

const postUsuario = mudanca('usuarios.editar', '/usuarios', async (ctx, c, ator) => {
  const id = inteiro(ctx.params.id, 'Usuário', 1, 1e12);
  const u = (await c.query('SELECT * FROM usuario WHERE id = $1 FOR UPDATE', [id])).rows[0] || falha('Usuário não encontrado.');
  const admin = ctx.corpo.eh_admin === '1', prof = ctx.corpo.eh_professor === '1', ativo = ctx.corpo.ativo === '1';
  if (!admin && !prof) falha('Marque Admin ou Professor.');
  if (id === ctx.usuario.id && (!admin || !ativo)) falha('Você não pode tirar o próprio acesso de administrador.');
  if (u.eh_admin && (!admin || !ativo)) {
    const outros = await c.query('SELECT count(*)::int n FROM usuario WHERE eh_admin AND ativo AND id <> $1', [id]);
    if (!outros.rows[0].n) falha('Precisa haver pelo menos um administrador ativo.');
  }
  const telas = [...new Set(lista(ctx.corpo.telas).filter(t => TELAS_LIBERAVEIS.includes(t)))];
  const antesTelas = (await c.query('SELECT tela FROM usuario_tela WHERE usuario_id = $1 ORDER BY tela', [id])).rows.map(r => r.tela);
  await c.query('UPDATE usuario SET eh_admin = $2, eh_professor = $3, ativo = $4 WHERE id = $1', [id, admin, prof, ativo]);
  // usuario_tela é a lista atual de telas; o histórico guarda antes/depois (não é dado de negócio a preservar).
  await c.query('DELETE FROM usuario_tela WHERE usuario_id = $1', [id]);
  for (const t of telas) await c.query('INSERT INTO usuario_tela VALUES ($1,$2)', [id, t]);
  const novaSenha = String(ctx.corpo.senha || '');
  if (novaSenha) {
    if (!senha.senhaValida(novaSenha)) falha(`A senha precisa de pelo menos ${senha.MINIMO} caracteres.`);
    await c.query('UPDATE usuario SET senha_hash = $2 WHERE id = $1', [id, senha.gerarHash(novaSenha)]);
  }
  if (!ativo) await c.query('UPDATE sessao SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [id]);
  await registrar(c, {
    ator, acao: 'usuario.alterado', entidade: 'usuario', entidadeId: id,
    antes: { admin: u.eh_admin, prof: u.eh_professor, ativo: u.ativo, telas: antesTelas },
    depois: { admin, prof, ativo, telas: telas.sort(), senhaTrocada: !!novaSenha },
  });
  await fila.conferirCompartilhamentos(c);
  return 'Usuário atualizado.';
});

const postEncerrarSessoes = mudanca('usuarios.editar', '/usuarios', async (ctx, c, ator) => {
  const id = inteiro(ctx.params.id, 'Usuário', 1, 1e12);
  const r = await c.query('UPDATE sessao SET revogada_em = now() WHERE usuario_id = $1 AND revogada_em IS NULL', [id]);
  await registrar(c, { ator, acao: 'usuario.sessoes_encerradas', entidade: 'usuario', entidadeId: id, depois: { sessoes: r.rowCount } });
  return `${r.rowCount} sessão(ões) encerrada(s).`;
});

// ───────────── Histórico (OPR-07) ─────────────
async function getHistorico(ctx) {
  if (!pode(ctx.usuario, 'historico.ver')) return ctx.proibido();
  const ent = String(ctx.query.entidade || '').replace(/[^a-z_]/g, '');
  const rows = (await ctx.pool.query(
    `SELECT h.*, u.nome ator_nome FROM historico h LEFT JOIN usuario u ON u.id = h.ator_id AND h.ator_tipo IN ('admin','professor')
      WHERE ($1 = '' OR h.entidade = $1) ORDER BY h.id DESC LIMIT 200`, [ent])).rows;
  const ents = (await ctx.pool.query('SELECT DISTINCT entidade FROM historico ORDER BY 1')).rows.map(r => r.entidade);
  const quando = t => `${dataBR(dataSP(new Date(t).getTime()))} ${hhmm(new Date(t).getTime())}`;
  const json = v => v == null ? '' : `<code style="font-size:11.5px;white-space:pre-wrap;word-break:break-word">${esc(JSON.stringify(v))}</code>`;
  const corpo = `<div class="card"><h2>Histórico</h2><form class="linha" method="get" action="/historico"><label>Assunto<select name="entidade" onchange="this.form.submit()">
<option value="">Todos</option>${ents.map(e => `<option${e === ent ? ' selected' : ''}>${esc(e)}</option>`).join('')}</select></label></form><br>
<div class="tab-wrap"><table><tr><th>Quando</th><th>Quem</th><th>Por onde</th><th>O quê</th><th>Antes</th><th>Depois</th><th>Motivo</th></tr>
${rows.map(h => `<tr><td>${quando(h.em)}</td><td>${esc(h.ator_nome || h.ator_tipo)}</td><td>${esc(h.origem)}</td><td>${esc(h.acao)}${h.entidade_id ? ` #${h.entidade_id}` : ''}</td><td>${json(h.antes)}</td><td>${json(h.depois)}</td><td>${esc(h.motivo || '')}</td></tr>`).join('') || '<tr><td colspan="7" class="muted">Nada registrado ainda.</td></tr>'}
</table></div><p class="muted">Mostra os 200 registros mais recentes. O histórico não pode ser alterado nem apagado.</p></div>`;
  ctx.html(200, pagina({ titulo: 'Histórico', usuario: ctx.usuario, ativo: 'historico', corpo }));
}

// método, caminho (com :id), handler, precisa de login
const ROTAS = [
  ['GET', '/login', getLogin, false],
  ['POST', '/login', postLogin, false],
  ['POST', '/sair', postSair, true],
  ['GET', '/grade', getGrade, true],
  ['GET', '/cadastros', getCadastros, true],
  ['POST', '/cadastros/quadra', postQuadra, true],
  ['POST', '/cadastros/quadra/:id/ativa', postQuadraAtiva, true],
  ['POST', '/cadastros/tipo', postTipo, true],
  ['POST', '/cadastros/faixa', postFaixa, true],
  ['POST', '/cadastros/faixa/:id/professor', postFaixaProfessor, true],
  ['POST', '/cadastros/faixa/:id/encerrar', postFaixaEncerrar, true],
  ['POST', '/cadastros/bloqueio', postBloqueio, true],
  ['POST', '/cadastros/bloqueio/:id/cancelar', postBloqueioCancelar, true],
  ['POST', '/cadastros/feriado', postFeriado, true],
  ['POST', '/cadastros/feriado/cancelar', postFeriadoCancelar, true],
  ['GET', '/usuarios', getUsuarios, true],
  ['POST', '/usuarios/novo', postUsuarioNovo, true],
  ['POST', '/usuarios/:id', postUsuario, true],
  ['POST', '/usuarios/:id/encerrar-sessoes', postEncerrarSessoes, true],
  ['GET', '/historico', getHistorico, true],
];

module.exports = { ROTAS, dadosDoDia };
