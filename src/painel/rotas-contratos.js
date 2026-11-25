/**
 * Planos, alunos e contratos básicos (etapa 3, antecipado da etapa 4 com o ok do dono em 25/11/2026):
 * CON-01/CON-01a planos · CON-02/CON-04/CON-06/CON-08 contrato com horário fixo · CON-10 encerramento
 * · AGD-06 aulas fixas geradas. Cobrança (Pix, régua, bloqueio) fica na etapa 4.
 * ⏳ kickoff (não feito aqui): proporcional do 1º mês (CON-03), regras da dupla (CON-05), texto do
 * aceite (CON-07), multa/devolução no encerramento (CON-10), trancamento × atraso (CON-11).
 * Só administrador (PER-02/PER-03: valores); histórico só com IDs (DAD-07); retrato do plano e das
 * regras no contrato (DAD-05).
 */
const { tx } = require('../db');
const { registrar, atorDoUsuario } = require('../historico');
const { lerRegras } = require('../config');
const { pode } = require('../regras/permissoes');
const { fimVigencia } = require('../regras/horario-fixo');
const { opcoesFixasDoBanco, gerarAulasFixas, liberarAulasFuturas } = require('../agenda/aulas-fixas');
const { normalizar } = require('../whatsapp/telefone');
const { dataValida } = require('../sofia/texto');
const { hojeSP, dataSP, somarDias } = require('../relogio');
const { esc, pagina } = require('./html');

const DIAS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
class ErroUsuario extends Error {}
const falha = msg => { throw new ErroUsuario(msg); };
const id = v => { const n = Number.parseInt(v, 10); if (!Number.isFinite(n) || n < 1) falha('Registro inválido.'); return n; };
const inteiro = (v, nome, min, max) => { const n = Number(String(v ?? '').trim()); if (!Number.isInteger(n) || n < min || n > max) falha(`${nome}: de ${min} a ${max}.`); return n; };
const dinheiro = (v, nome, obrigatorio = true) => {
  const t = String(v ?? '').trim().replace(/[R$\s]/g, '');
  if (!t) { if (obrigatorio) falha(`${nome}: informe o valor.`); return null; }
  const n = Number(t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t);
  if (!Number.isFinite(n) || n < 0 || n > 100000) falha(`${nome}: valor inválido.`);
  return Math.round(n * 100) / 100;
};
const reais = v => (v == null ? '—' : Number(v).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }));
const dataBR = iso => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '—');
const iso = d => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d || '').slice(0, 10));
const hhmm = ms => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const SIT = { aguardando_aceite: ['wait', 'Aguardando aceite'], ativo: ['ok', 'Ativo'], trancado: ['info', 'Trancado'], bloqueado: ['no', 'Bloqueado'], encerrado: ['info', 'Encerrado'] };

function mudanca(permissao, destino, fn) {
  return async ctx => {
    if (!pode(ctx.usuario, permissao)) return ctx.proibido();
    const voltar = typeof destino === 'function' ? destino(ctx) : destino;
    try {
      const r = await tx(ctx.pool, c => fn(ctx, c, atorDoUsuario(ctx.usuario)));
      if (r && r.depois) await r.depois();
      const alvo = (r && r.destino) || voltar;
      ctx.redirecionar(`${alvo}${alvo.includes('?') ? '&' : '?'}ok=${encodeURIComponent((r && r.msg) || r || 'Salvo.')}`);
    } catch (e) {
      const msg = e instanceof ErroUsuario ? e.message : e.code === '23505' ? 'Já existe um cadastro igual.' : null;
      if (!msg) throw e;
      ctx.redirecionar(`${voltar}${voltar.includes('?') ? '&' : '?'}erro=${encodeURIComponent(msg)}`);
    }
  };
}

// ───────────── Planos (CON-01, CON-01a) ─────────────
const CAMPOS_PLANO = ['nome', 'tipo_aula_id', 'aulas_semana', 'vigencia_meses', 'valor_referencia', 'parcelas_max', 'reposicoes_mes', 'tranc_permite', 'tranc_dias', 'tranc_minimo', 'tranc_aluno', 'ativo_venda'];

function lerPlano(corpo) {
  const p = {
    nome: String(corpo.nome || '').trim().slice(0, 80) || falha('Informe o nome do plano.'),
    tipo_aula_id: id(corpo.tipo_aula_id),
    aulas_semana: inteiro(corpo.aulas_semana, 'Aulas por semana', 1, 7),
    vigencia_meses: inteiro(corpo.vigencia_meses, 'Vigência (meses)', 1, 12),
    valor_referencia: dinheiro(corpo.valor_referencia, 'Valor de referência', false),
    parcelas_max: inteiro(corpo.parcelas_max || 1, 'Parcelas', 1, 12),
    reposicoes_mes: String(corpo.reposicoes_mes || '').trim() === '' ? null : inteiro(corpo.reposicoes_mes, 'Reposições por mês', 0, 31),
    tranc_permite: corpo.tranc_permite === '1',
    tranc_dias: inteiro(corpo.tranc_dias || 0, 'Dias de trancamento', 0, 365),
    tranc_minimo: inteiro(corpo.tranc_minimo || 7, 'Mínimo de dias por trancamento', 1, 365),
    tranc_aluno: corpo.tranc_aluno === '1',
    ativo_venda: corpo.ativo_venda !== '0',
  };
  if (p.parcelas_max > p.vigencia_meses) falha('As parcelas não podem passar do número de meses da vigência.');
  return p;
}

async function getPlanos(ctx) {
  if (!pode(ctx.usuario, 'planos.ver')) return ctx.proibido();
  const tipos = (await ctx.pool.query('SELECT id, nome FROM tipo_aula WHERE categoria <> \'experimental\' ORDER BY id')).rows;
  const planos = (await ctx.pool.query(
    `SELECT p.*, t.nome tipo, (SELECT count(*)::int FROM contrato c WHERE c.plano_id = p.id AND c.situacao <> 'encerrado') ativos
       FROM plano p JOIN tipo_aula t ON t.id = p.tipo_aula_id ORDER BY p.ativo_venda DESC, p.nome`)).rows;
  const ed = planos.find(p => p.id === Number(ctx.query.editar)) || null;
  const v = (k, padrao = '') => esc(ed ? (ed[k] ?? '') : padrao);
  const editar = pode(ctx.usuario, 'planos.editar');
  const form = `<form method="post" action="${ed ? `/planos/${ed.id}` : '/planos'}">
<div class="linha"><label>Nome<input name="nome" required maxlength="80" value="${v('nome')}" placeholder="Individual 2x por semana"></label>
<label>Tipo de aula<select name="tipo_aula_id">${tipos.map(t => `<option value="${t.id}"${ed && ed.tipo_aula_id === t.id ? ' selected' : ''}>${esc(t.nome)}</option>`).join('')}</select></label>
<label>Aulas por semana<input type="number" name="aulas_semana" min="1" max="7" required value="${v('aulas_semana', '1')}"></label>
<label>Vigência (meses)<input type="number" name="vigencia_meses" min="1" max="12" required value="${v('vigencia_meses', '1')}"></label></div>
<div class="linha"><label>Valor de referência (R$)<input name="valor_referencia" inputmode="decimal" value="${ed && ed.valor_referencia != null ? esc(String(ed.valor_referencia).replace('.', ',')) : ''}" placeholder="opcional"></label>
<label>Parcelas (máximo)<input type="number" name="parcelas_max" min="1" max="12" value="${v('parcelas_max', '1')}"></label>
<label>Reposições por mês<input type="number" name="reposicoes_mes" min="0" max="31" value="${v('reposicoes_mes')}" placeholder="regra geral"></label></div>
<div class="linha"><label>Permite trancamento<select name="tranc_permite"><option value="0">Não</option><option value="1"${ed && ed.tranc_permite ? ' selected' : ''}>Sim</option></select></label>
<label>Dias de trancamento<input type="number" name="tranc_dias" min="0" max="365" value="${v('tranc_dias', '0')}"></label>
<label>Mínimo por vez (dias)<input type="number" name="tranc_minimo" min="1" max="365" value="${v('tranc_minimo', '7')}"></label>
<label>Aluno pede pelo app<select name="tranc_aluno"><option value="0">Não</option><option value="1"${ed && ed.tranc_aluno ? ' selected' : ''}>Sim</option></select></label>
<label>À venda<select name="ativo_venda"><option value="1">Sim</option><option value="0"${ed && !ed.ativo_venda ? ' selected' : ''}>Não</option></select></label></div>
${ed && ed.ativos ? `<p class="muted">Este plano tem ${ed.ativos} contrato(s): a mudança vale só para contratos novos.</p>` : ''}
<button class="btn p">${ed ? 'Salvar plano' : 'Criar plano'}</button>${ed ? ' <a class="btn" href="/planos">Cancelar</a>' : ''}</form>`;
  const corpo = `<div class="card"><h2>Planos</h2><div class="tab-wrap"><table><tr><th>Plano</th><th>Aulas</th><th>Vigência</th><th>Referência</th><th>Contratos</th><th></th></tr>
${planos.map(p => `<tr><td>${esc(p.nome)}${p.ativo_venda ? '' : ' <span class="chip info">fora de venda</span>'}<br><span class="muted">${esc(p.tipo)}</span></td>
<td>${p.aulas_semana}× por semana</td><td>${p.vigencia_meses} ${p.vigencia_meses === 1 ? 'mês' : 'meses'}</td><td>${reais(p.valor_referencia)}</td><td>${p.ativos}</td>
<td>${editar ? `<div class="linha"><a class="btn" href="/planos?editar=${p.id}">Editar</a><form method="post" action="/planos/${p.id}/duplicar"><button class="btn">Duplicar</button></form></div>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nenhum plano ainda.</td></tr>'}
</table></div></div>
${editar ? `<div class="card"><h2>${ed ? `Editar: ${esc(ed.nome)}` : 'Novo plano'}</h2>${tipos.length ? form : '<p class="muted">Cadastre um tipo de aula em "Quadras e professores" primeiro.</p>'}</div>` : ''}`;
  ctx.html(200, pagina({ titulo: 'Planos', usuario: ctx.usuario, ativo: 'planos', corpo, aviso: ctx.aviso() }));
}

const postPlano = mudanca('planos.editar', '/planos', async (ctx, c, ator) => {
  const p = lerPlano(ctx.corpo);
  (await c.query(`SELECT 1 FROM tipo_aula WHERE id = $1 AND categoria <> 'experimental'`, [p.tipo_aula_id])).rowCount || falha('Tipo de aula inválido.');
  const r = (await c.query(`INSERT INTO plano (${CAMPOS_PLANO.join(',')}) VALUES (${CAMPOS_PLANO.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, CAMPOS_PLANO.map(k => p[k]))).rows[0];
  await registrar(c, { ator, acao: 'plano.criado', entidade: 'plano', entidadeId: r.id, depois: p });
  return 'Plano criado.';
});

const postPlanoEditar = mudanca('planos.editar', ctx => `/planos?editar=${encodeURIComponent(ctx.params.id)}`, async (ctx, c, ator) => {
  const pid = id(ctx.params.id);
  const antes = (await c.query('SELECT * FROM plano WHERE id = $1 FOR UPDATE', [pid])).rows[0] || falha('Plano não encontrado.');
  const p = lerPlano(ctx.corpo);
  // CON-01a: contratos guardam o retrato do plano; mudar aqui vale só para contratos novos.
  await c.query(`UPDATE plano SET ${CAMPOS_PLANO.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [pid, ...CAMPOS_PLANO.map(k => p[k])]);
  await registrar(c, { ator, acao: 'plano.alterado', entidade: 'plano', entidadeId: pid, antes: Object.fromEntries(CAMPOS_PLANO.map(k => [k, antes[k]])), depois: p });
  return { msg: 'Plano salvo. Contratos já feitos não mudam.', destino: '/planos' };
});

const postPlanoDuplicar = mudanca('planos.editar', '/planos', async (ctx, c, ator) => {
  const o = (await c.query('SELECT * FROM plano WHERE id = $1', [id(ctx.params.id)])).rows[0] || falha('Plano não encontrado.');
  const novo = { ...o, nome: `${o.nome} (cópia)`.slice(0, 80), ativo_venda: false };
  const r = (await c.query(`INSERT INTO plano (${CAMPOS_PLANO.join(',')}) VALUES (${CAMPOS_PLANO.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id`, CAMPOS_PLANO.map(k => novo[k]))).rows[0];
  await registrar(c, { ator, acao: 'plano.duplicado', entidade: 'plano', entidadeId: r.id, depois: { de: o.id } });
  return { msg: 'Plano duplicado (fora de venda até você salvar).', destino: `/planos?editar=${r.id}` };
});

// ───────────── Alunos ─────────────
async function getAlunos(ctx) {
  if (!pode(ctx.usuario, 'alunos.ver')) return ctx.proibido();
  const busca = String(ctx.query.busca || '').trim().slice(0, 60);
  const rows = (await ctx.pool.query(
    `SELECT a.id, a.situacao, c.nome, c.telefone, c.anonimizado_em, r.nome resp_nome,
            (SELECT count(*)::int FROM contrato k WHERE k.aluno_id = a.id AND k.situacao <> 'encerrado') contratos
       FROM aluno a JOIN contato c ON c.id = a.contato_id LEFT JOIN contato r ON r.id = a.responsavel_contato_id
      WHERE ($1 = '' OR c.nome ILIKE '%' || $1 || '%' OR c.telefone LIKE '%' || regexp_replace($1,'\\D','','g') || '%')
      ORDER BY a.situacao, c.nome NULLS LAST LIMIT 300`, [busca])).rows;
  const editar = pode(ctx.usuario, 'alunos.editar');
  const corpo = `<div class="card"><h2>Alunos</h2><form class="linha" method="get" action="/alunos"><label>Buscar<input name="busca" value="${esc(busca)}" placeholder="nome ou telefone"></label><button class="btn">Buscar</button></form><br>
<div class="tab-wrap"><table><tr><th>Aluno</th><th>WhatsApp</th><th>Situação</th><th>Contratos</th><th></th></tr>
${rows.map(a => `<tr><td>${a.anonimizado_em ? '<span class="muted">(anonimizado)</span>' : esc(a.nome || '—')}${a.resp_nome ? `<br><span class="muted">resp.: ${esc(a.resp_nome)}</span>` : ''}</td>
<td>${esc(a.telefone || '—')}</td><td><span class="chip ${a.situacao === 'ativo' ? 'ok' : 'info'}">${a.situacao === 'ativo' ? 'Ativo' : 'Inativo'}</span></td><td>${a.contratos}</td>
<td><a class="btn" href="/alunos/${a.id}">Abrir</a></td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhum aluno.</td></tr>'}
</table></div></div>
${editar ? `<div class="card"><h2>Novo aluno</h2><form method="post" action="/alunos">
<div class="linha"><label>Nome<input name="nome" required maxlength="80"></label><label>Nascimento<input type="date" name="nascimento"></label>
<label>WhatsApp do aluno<input name="telefone" maxlength="20" placeholder="(62) 99999-9999"></label></div>
<p class="muted">Kids: preencha o responsável — ele recebe as mensagens e entra no app.</p>
<div class="linha"><label>Nome do responsável<input name="resp_nome" maxlength="80"></label><label>WhatsApp do responsável<input name="resp_telefone" maxlength="20"></label></div>
<button class="btn p">Cadastrar aluno</button></form></div>` : ''}`;
  ctx.html(200, pagina({ titulo: 'Alunos', usuario: ctx.usuario, ativo: 'alunos', corpo, aviso: ctx.aviso() }));
}

// Contato pelo telefone (lead vira aluno/responsável) ou novo.
async function contatoPorTelefone(c, { nome, telefone, tipo, nascimento = null }) {
  if (telefone) {
    const ex = (await c.query('SELECT * FROM contato WHERE telefone = $1 FOR UPDATE', [telefone])).rows[0];
    if (ex) {
      await c.query(`UPDATE contato SET nome = COALESCE(nome, $2), data_nascimento = COALESCE(data_nascimento, $3),
                       tipo = CASE WHEN tipo IN ('lead','ex_aluno') THEN $4 ELSE tipo END WHERE id = $1`, [ex.id, nome, nascimento, tipo]);
      return ex.id;
    }
  }
  return (await c.query(`INSERT INTO contato (nome, telefone, data_nascimento, tipo, origem) VALUES ($1,$2,$3,$4,'painel') RETURNING id`, [nome, telefone, nascimento, tipo])).rows[0].id;
}

const postAluno = mudanca('alunos.editar', '/alunos', async (ctx, c, ator) => {
  const nome = String(ctx.corpo.nome || '').trim().slice(0, 80) || falha('Informe o nome do aluno.');
  const nascimento = ctx.corpo.nascimento ? (dataValida(ctx.corpo.nascimento) || falha('Nascimento inválido.')) : null;
  const tel = ctx.corpo.telefone ? (normalizar(ctx.corpo.telefone) || falha('WhatsApp do aluno inválido: use DDD + número.')) : null;
  const respNome = String(ctx.corpo.resp_nome || '').trim().slice(0, 80);
  const respTel = ctx.corpo.resp_telefone ? (normalizar(ctx.corpo.resp_telefone) || falha('WhatsApp do responsável inválido.')) : null;
  if (respTel && !respNome) falha('Informe o nome do responsável.');
  if (!tel && !respTel) falha('Informe o WhatsApp do aluno ou do responsável (é por ele que o app e os avisos funcionam).');
  const contatoId = await contatoPorTelefone(c, { nome, telefone: tel, tipo: 'aluno', nascimento });
  const respId = respTel ? await contatoPorTelefone(c, { nome: respNome, telefone: respTel, tipo: 'responsavel' }) : null;
  if ((await c.query('SELECT 1 FROM aluno WHERE contato_id = $1', [contatoId])).rowCount) falha('Esse contato já é aluno.');
  const a = (await c.query('INSERT INTO aluno (contato_id, responsavel_contato_id) VALUES ($1,$2) RETURNING id', [contatoId, respId])).rows[0];
  await registrar(c, { ator, acao: 'aluno.criado', entidade: 'aluno', entidadeId: a.id, depois: { contato: contatoId, responsavel: respId } });
  return { msg: 'Aluno cadastrado. Agora faça o contrato.', destino: `/alunos/${a.id}` };
});

async function getAluno(ctx) {
  if (!pode(ctx.usuario, 'alunos.ver')) return ctx.proibido();
  const a = (await ctx.pool.query(
    `SELECT a.*, c.nome, c.telefone, to_char(c.data_nascimento,'YYYY-MM-DD') nasc, c.anonimizado_em, r.nome resp_nome, r.telefone resp_tel
       FROM aluno a JOIN contato c ON c.id = a.contato_id LEFT JOIN contato r ON r.id = a.responsavel_contato_id WHERE a.id = $1`,
    [Number.parseInt(ctx.params.id, 10) || 0])).rows[0];
  if (!a) return ctx.html(404, pagina({ titulo: 'Aluno', usuario: ctx.usuario, ativo: 'alunos', corpo: '<div class="card"><p>Aluno não encontrado.</p></div>' }));
  const contratos = (await ctx.pool.query(
    `SELECT k.*, p.nome plano FROM contrato k JOIN plano p ON p.id = k.plano_id WHERE k.aluno_id = $1 ORDER BY k.situacao = 'encerrado', k.inicio DESC`, [a.id])).rows;
  const horarios = contratos.length ? (await ctx.pool.query(
    `SELECT h.*, to_char(h.hora,'HH24:MI') hhmm, q.nome quadra FROM horario_fixo h JOIN quadra q ON q.id = h.quadra_id WHERE h.contrato_id = ANY($1) ORDER BY h.dia_semana, h.hora`,
    [contratos.map(k => k.id)])).rows : [];
  const aulas = (await ctx.pool.query(
    `SELECT a.id, a.origem, a.situacao, p.situacao p_sit, extract(epoch FROM lower(a.periodo))*1000 i, q.nome quadra
       FROM aula_participante p JOIN aula a ON a.id = p.aula_id JOIN quadra q ON q.id = a.quadra_id
      WHERE p.contato_id = $1 AND lower(a.periodo) > now() - interval '1 day' ORDER BY lower(a.periodo) LIMIT 12`, [a.contato_id])).rows;
  const editar = pode(ctx.usuario, 'contratos.editar');
  const corpo = `<div class="card"><h2>${a.anonimizado_em ? '(anonimizado)' : esc(a.nome || '—')}</h2>
<p>${a.telefone ? `WhatsApp ${esc(a.telefone)} · ` : ''}${a.nasc ? `Nascimento ${dataBR(a.nasc)} · ` : ''}<span class="chip ${a.situacao === 'ativo' ? 'ok' : 'info'}">${a.situacao === 'ativo' ? 'Ativo' : 'Inativo'}</span></p>
${a.resp_nome ? `<p>Responsável: ${esc(a.resp_nome)} ${esc(a.resp_tel || '')}</p>` : ''}
${editar && !a.anonimizado_em ? `<a class="btn p" href="/contratos/novo?aluno=${a.id}">Novo contrato</a>` : ''}</div>
<div class="card"><h2>Contratos</h2>${contratos.map(k => {
    const [cls, rot] = SIT[k.situacao] || ['info', k.situacao];
    const hs = horarios.filter(h => h.contrato_id === k.id);
    return `<div style="border-top:1px solid var(--l);padding:10px 0"><div class="linha" style="justify-content:space-between"><b>${esc(k.plano)}</b><span class="chip ${cls}">${rot}</span></div>
<p>${dataBR(iso(k.inicio))} a ${dataBR(iso(k.fim))} · ${reais(k.valor_mensal)}/mês${Number(k.desconto_valor) ? ` (desconto ${reais(k.desconto_valor)}: ${esc(k.desconto_motivo)})` : ''} · ${k.forma === 'avista' ? 'à vista' : `${k.parcelas}×`} · vence dia ${k.dia_vencimento}</p>
<p>${hs.map(h => `${DIAS[h.dia_semana]} ${h.hhmm} · ${esc(h.quadra)}${h.liberado_em ? ' <span class="muted">(liberado)</span>' : ''}`).join('<br>') || '<span class="muted">sem horário</span>'}</p>
${k.situacao === 'encerrado' ? `<p class="muted">Encerrado: ${esc(k.encerrado_motivo || '')}</p>` : editar ? `<form class="linha" method="post" action="/contratos/${k.id}/encerrar" onsubmit="return confirm('Encerrar o contrato? O horário fica livre e as próximas aulas saem da grade.')">
<label>Motivo do encerramento<input name="motivo" required maxlength="120"></label><button class="btn r">Encerrar contrato</button></form>` : ''}</div>`;
  }).join('') || '<p class="muted">Sem contrato.</p>'}</div>
<div class="card"><h2>Próximas aulas</h2><ul>${aulas.map(x => `<li><a href="/aulas/${x.id}">${dataBR(dataSP(Number(x.i)))} ${hhmm(Number(x.i))}</a> · ${esc(x.quadra)}${x.situacao === 'cancelada' ? ' <span class="chip no">cancelada</span>' : x.p_sit === 'desmarcado' ? ' <span class="chip info">desmarcada</span>' : ''}</li>`).join('') || '<li class="muted">Nenhuma aula marcada.</li>'}</ul></div>
<a class="btn" href="/alunos">Voltar</a>`;
  ctx.html(200, pagina({ titulo: 'Aluno', usuario: ctx.usuario, ativo: 'alunos', corpo, aviso: ctx.aviso() }));
}

// ───────────── Novo contrato (CON-02, CON-04, CON-08) ─────────────
async function getContratoNovo(ctx) {
  if (!pode(ctx.usuario, 'contratos.editar')) return ctx.proibido();
  const a = (await ctx.pool.query(
    `SELECT a.id, c.nome FROM aluno a JOIN contato c ON c.id = a.contato_id WHERE a.id = $1 AND c.anonimizado_em IS NULL`, [Number(ctx.query.aluno) || 0])).rows[0];
  if (!a) return ctx.redirecionar('/alunos?erro=' + encodeURIComponent('Escolha o aluno primeiro.'));
  const planos = (await ctx.pool.query(`SELECT p.*, t.nome tipo, t.duracao_min, t.alunos_por_aula FROM plano p JOIN tipo_aula t ON t.id = p.tipo_aula_id WHERE p.ativo_venda ORDER BY p.nome`)).rows;
  // CON-08: contrato anterior do aluno pré-preenche plano, valor e horários.
  const anterior = (await ctx.pool.query(
    `SELECT k.* FROM contrato k WHERE k.aluno_id = $1 ORDER BY k.fim DESC LIMIT 1`, [a.id])).rows[0];
  const antHor = anterior ? (await ctx.pool.query(`SELECT quadra_id, dia_semana, to_char(hora,'HH24:MI') hhmm FROM horario_fixo WHERE contrato_id = $1`, [anterior.id])).rows : [];
  const plano = planos.find(p => p.id === Number(ctx.query.plano)) || (anterior && planos.find(p => p.id === anterior.plano_id)) || planos[0];
  const inicioPadrao = anterior && iso(anterior.fim) >= hojeSP() ? somarDias(iso(anterior.fim), 1) : hojeSP();
  const inicio = dataValida(ctx.query.inicio) || inicioPadrao;
  let opcoes = [];
  if (plano) {
    const fim = fimVigencia(inicio, plano.vigencia_meses);
    const tipo = { id: plano.tipo_aula_id, duracaoMin: plano.duracao_min, alunosPorAula: plano.alunos_por_aula };
    for (let dia = 0; dia < 7; dia++) {
      for (const o of await opcoesFixasDoBanco(ctx.pool, { diaSemana: dia, inicio, fim, tipo })) opcoes.push({ ...o, dia });
    }
  }
  const quadras = new Map((await ctx.pool.query('SELECT id, nome FROM quadra')).rows.map(q => [q.id, q.nome]));
  const profs = new Map((await ctx.pool.query('SELECT id, nome FROM usuario')).rows.map(u => [u.id, u.nome]));
  const marcado = o => antHor.some(h => h.quadra_id === o.quadraId && h.dia_semana === o.dia && h.hhmm === o.hora);
  const valorPadrao = anterior ? anterior.valor_mensal : plano && plano.valor_referencia;
  const corpo = `<div class="card"><h2>Novo contrato · ${esc(a.nome)}</h2>${anterior ? `<p class="muted">Renovação: plano, valor e horários do contrato anterior (até ${dataBR(iso(anterior.fim))}) já vêm marcados.</p>` : ''}
${!planos.length ? '<p class="muted">Cadastre um plano à venda primeiro (Planos).</p>' : `<form class="linha" method="get" action="/contratos/novo"><input type="hidden" name="aluno" value="${a.id}">
<label>Plano<select name="plano">${planos.map(p => `<option value="${p.id}"${plano && p.id === plano.id ? ' selected' : ''}>${esc(p.nome)}</option>`).join('')}</select></label>
<label>Início<input type="date" name="inicio" value="${inicio}" required></label><button class="btn">Ver horários</button></form>`}</div>
${plano ? `<div class="card"><h2>${esc(plano.nome)}: escolha ${plano.aulas_semana} horário(s) por semana</h2>
<form method="post" action="/contratos"><input type="hidden" name="aluno_id" value="${a.id}"><input type="hidden" name="plano_id" value="${plano.id}"><input type="hidden" name="inicio" value="${inicio}">
<p class="muted">Vigência: ${dataBR(inicio)} a ${dataBR(fimVigencia(inicio, plano.vigencia_meses))}. Só aparecem horários com vaga em todas as semanas.</p>
${[0, 1, 2, 3, 4, 5, 6].map(d => {
    const os = opcoes.filter(o => o.dia === d);
    return os.length ? `<p style="margin:12px 0 4px"><b>${DIAS[d]}</b></p><div class="checks">${os.map(o => `<label><input type="checkbox" name="horarios" value="${o.quadraId}|${d}|${o.hora}"${marcado(o) ? ' checked' : ''}>${o.hora} · ${esc(quadras.get(o.quadraId))} · ${esc(profs.get(o.professorId) || '')}${o.vagas < plano.alunos_por_aula ? ` (${o.vagas} vaga)` : ''}</label>`).join('')}</div>` : '';
  }).join('') || '<p class="muted">Nenhum horário com vaga para esse tipo de aula.</p>'}
<div class="linha"><label>Valor mensal (R$)<input name="valor_mensal" inputmode="decimal" required value="${valorPadrao != null ? esc(String(valorPadrao).replace('.', ',')) : ''}"></label>
<label>Desconto (R$)<input name="desconto_valor" inputmode="decimal" value="0"></label><label>Motivo do desconto<input name="desconto_motivo" maxlength="120"></label></div>
<div class="linha"><label>Pagamento<select name="forma"><option value="parcelado">Parcelado (mensal)</option><option value="avista"${anterior && anterior.forma === 'avista' ? ' selected' : ''}>À vista</option></select></label>
<label>Parcelas<input type="number" name="parcelas" min="1" max="${plano.parcelas_max}" value="${anterior ? Math.min(anterior.parcelas, plano.parcelas_max) : plano.parcelas_max}"></label>
<label>Vencimento (dia)<input type="number" name="dia_vencimento" min="1" max="31" value="${anterior ? anterior.dia_vencimento : 10}"></label></div>
<p class="muted">A cobrança por Pix entra na etapa 4; por enquanto o contrato guarda os valores e gera as aulas.</p>
<button class="btn p">Salvar contrato</button></form></div>` : ''}`;
  ctx.html(200, pagina({ titulo: 'Novo contrato', usuario: ctx.usuario, ativo: 'alunos', corpo, aviso: ctx.aviso() }));
}

const postContrato = mudanca('contratos.editar', ctx => `/contratos/novo?aluno=${encodeURIComponent(ctx.corpo.aluno_id || '')}&plano=${encodeURIComponent(ctx.corpo.plano_id || '')}&inicio=${encodeURIComponent(ctx.corpo.inicio || '')}`, async (ctx, c, ator) => {
  const aluno = (await c.query(
    `SELECT a.id, a.situacao FROM aluno a JOIN contato ct ON ct.id = a.contato_id WHERE a.id = $1 AND ct.anonimizado_em IS NULL FOR UPDATE OF a`, [id(ctx.corpo.aluno_id)])).rows[0] || falha('Aluno não encontrado.');
  const plano = (await c.query(`SELECT p.*, t.duracao_min, t.alunos_por_aula FROM plano p JOIN tipo_aula t ON t.id = p.tipo_aula_id WHERE p.id = $1 AND p.ativo_venda`, [id(ctx.corpo.plano_id)])).rows[0] || falha('Plano inválido ou fora de venda.');
  const inicio = dataValida(ctx.corpo.inicio) || falha('Data de início inválida.');
  if (inicio < somarDias(hojeSP(), -31)) falha('O início não pode ser mais de um mês no passado.');
  const fim = fimVigencia(inicio, plano.vigencia_meses);
  const horarios = [...new Set([].concat(ctx.corpo.horarios || []))].map(h => {
    const [q, d, hr] = String(h).split('|');
    return { quadraId: id(q), dia: inteiro(d, 'Dia', 0, 6), hora: /^\d{2}:\d{2}$/.test(hr) ? hr : falha('Horário inválido.') };
  });
  if (horarios.length !== plano.aulas_semana) falha(`Escolha exatamente ${plano.aulas_semana} horário(s) por semana.`);
  if (new Set(horarios.map(h => h.dia)).size !== horarios.length) falha('Escolha horários em dias diferentes.');
  // Trava os horários fixos (dois contratos ao mesmo tempo não pegam a mesma vaga).
  await c.query('LOCK TABLE horario_fixo IN SHARE ROW EXCLUSIVE MODE');
  const tipo = { id: plano.tipo_aula_id, duracaoMin: plano.duracao_min, alunosPorAula: plano.alunos_por_aula };
  for (const h of horarios) {
    const ok = (await opcoesFixasDoBanco(c, { diaSemana: h.dia, inicio, fim, tipo })).some(o => o.quadraId === h.quadraId && o.hora === h.hora);
    if (!ok) falha(`${DIAS[h.dia]} ${h.hora} não tem mais vaga. Escolha outro horário.`);
  }
  const valor = dinheiro(ctx.corpo.valor_mensal, 'Valor mensal');
  const desconto = dinheiro(ctx.corpo.desconto_valor || '0', 'Desconto');
  const descontoMotivo = String(ctx.corpo.desconto_motivo || '').trim().slice(0, 120) || null;
  if (desconto > 0 && !descontoMotivo) falha('Informe o motivo do desconto.');
  if (desconto > valor) falha('O desconto não pode ser maior que o valor.');
  const forma = ctx.corpo.forma === 'avista' ? 'avista' : 'parcelado';
  const parcelas = forma === 'avista' ? 1 : inteiro(ctx.corpo.parcelas, 'Parcelas', 1, plano.parcelas_max);
  const diaVenc = inteiro(ctx.corpo.dia_vencimento, 'Dia do vencimento', 1, 31);
  const anterior = (await c.query(`SELECT id FROM contrato WHERE aluno_id = $1 ORDER BY fim DESC LIMIT 1`, [aluno.id])).rows[0];
  const regras = await lerRegras(c);
  const retrato = Object.fromEntries(['nome', 'tipo_aula_id', 'aulas_semana', 'vigencia_meses', 'valor_referencia', 'parcelas_max', 'reposicoes_mes', 'tranc_permite', 'tranc_dias', 'tranc_minimo', 'tranc_aluno'].map(k => [k, plano[k]]));
  const k = (await c.query(
    `INSERT INTO contrato (aluno_id, plano_id, plano_retrato, regras_retrato, modelo_contrato_id, inicio, fim, valor_mensal, desconto_valor, desconto_motivo,
       forma, parcelas, dia_vencimento, tranc_permite, tranc_dias, tranc_minimo, tranc_aluno, renovacao_de_id, criado_por)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
    [aluno.id, plano.id, JSON.stringify(retrato), JSON.stringify(regras), plano.modelo_contrato_id, inicio, fim, valor, desconto, descontoMotivo,
      forma, parcelas, diaVenc, plano.tranc_permite, plano.tranc_dias, plano.tranc_minimo, plano.tranc_aluno, anterior ? anterior.id : null, ctx.usuario.id])).rows[0];
  for (const h of horarios) {
    await c.query('INSERT INTO horario_fixo (contrato_id, quadra_id, dia_semana, hora, desde) VALUES ($1,$2,$3,$4,$5)', [k.id, h.quadraId, h.dia, h.hora, inicio]);
  }
  if (aluno.situacao !== 'ativo') await c.query(`UPDATE aluno SET situacao = 'ativo' WHERE id = $1`, [aluno.id]);
  await c.query(`UPDATE contato SET tipo = 'aluno' WHERE id = (SELECT contato_id FROM aluno WHERE id = $1) AND tipo IN ('lead','ex_aluno')`, [aluno.id]);
  await registrar(c, {
    ator, acao: 'contrato.criado', entidade: 'contrato', entidadeId: k.id,
    depois: { aluno: aluno.id, plano: plano.id, inicio, fim, valor_mensal: valor, desconto, forma, parcelas, dia_vencimento: diaVenc, horarios, renovacao_de: anterior ? anterior.id : null },
  });
  // As aulas são geradas logo depois de gravar o contrato (fora desta transação).
  return { msg: 'Contrato salvo. As aulas das próximas semanas já estão na grade.', destino: `/alunos/${aluno.id}`, depois: () => gerarAulasFixas({ pool: ctx.pool, contratoId: k.id }) };
});

// ───────────── Encerramento (CON-10; multa e devolução ⏳ kickoff) ─────────────
const postEncerrar = mudanca('contratos.editar', ctx => `/contratos/${encodeURIComponent(ctx.params.id)}/voltar`, async (ctx, c, ator) => {
  const kid = id(ctx.params.id);
  const motivo = String(ctx.corpo.motivo || '').trim().slice(0, 120) || falha('Informe o motivo do encerramento.');
  const k = (await c.query('SELECT * FROM contrato WHERE id = $1 FOR UPDATE', [kid])).rows[0] || falha('Contrato não encontrado.');
  if (k.situacao === 'encerrado') falha('O contrato já estava encerrado.');
  await c.query(`UPDATE contrato SET situacao = 'encerrado', encerrado_em = now(), encerrado_motivo = $2 WHERE id = $1`, [kid, motivo]);
  await c.query(`UPDATE horario_fixo SET liberado_em = now(), liberado_motivo = $2 WHERE contrato_id = $1 AND liberado_em IS NULL`, [kid, 'contrato encerrado']);
  const aulas = await liberarAulasFuturas(c, { contratoId: kid, motivo: 'contrato encerrado' });
  const outros = (await c.query(`SELECT count(*)::int n FROM contrato WHERE aluno_id = $1 AND situacao <> 'encerrado'`, [k.aluno_id])).rows[0].n;
  if (!outros) await c.query(`UPDATE aluno SET situacao = 'inativo' WHERE id = $1`, [k.aluno_id]);
  await registrar(c, { ator, acao: 'contrato.encerrado', entidade: 'contrato', entidadeId: kid, antes: { situacao: k.situacao }, depois: { situacao: 'encerrado', aulas_liberadas: aulas }, motivo });
  return { msg: `Contrato encerrado. Horário livre e ${aulas} aula(s) futura(s) liberada(s).`, destino: `/alunos/${k.aluno_id}` };
});

async function getContratoVoltar(ctx) {
  const k = (await ctx.pool.query('SELECT aluno_id FROM contrato WHERE id = $1', [Number.parseInt(ctx.params.id, 10) || 0])).rows[0];
  const q = new URLSearchParams(ctx.query).toString();
  ctx.redirecionar(k ? `/alunos/${k.aluno_id}${q ? `?${q}` : ''}` : '/alunos');
}

module.exports = {
  ROTAS_CONTRATOS: [
    ['GET', '/planos', getPlanos, true],
    ['POST', '/planos', postPlano, true],
    ['POST', '/planos/:id', postPlanoEditar, true],
    ['POST', '/planos/:id/duplicar', postPlanoDuplicar, true],
    ['GET', '/alunos', getAlunos, true],
    ['POST', '/alunos', postAluno, true],
    ['GET', '/alunos/:id', getAluno, true],
    ['GET', '/contratos/novo', getContratoNovo, true],
    ['POST', '/contratos', postContrato, true],
    ['POST', '/contratos/:id/encerrar', postEncerrar, true],
    ['GET', '/contratos/:id/voltar', getContratoVoltar, true],
  ],
};
