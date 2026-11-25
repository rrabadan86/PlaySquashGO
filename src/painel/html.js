/**
 * Peças de HTML do painel, no padrão visual de .claude/rules/visual.md (VIS-01..06)
 * e dos mockups de docs/design/mockups.html.
 */
const { temTela } = require('../regras/permissoes');

function esc(x) {
  return String(x == null ? '' : x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

const CSS = `
:root{--v:#00A97E;--v2:#E3F5EE;--e:#0E2620;--t:#1D2A26;--s:#64746F;--l:#E3E9E6;--f:#F5F8F7;
--exp:#F2A33A;--rep:#5B7FE0;--dup:#8E5CC8}
*{box-sizing:border-box}html,body{margin:0}
body{font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--t);background:var(--f);font-size:14px;line-height:1.45}
a{color:inherit}
.app{display:flex;min-height:100vh}
.side{width:232px;flex-shrink:0;background:var(--e);color:#cfe0d9;padding:20px 14px;font-size:13.5px}
.side .marca{color:#fff;font-weight:600;font-size:15px;margin:0 6px 22px;display:block;text-decoration:none}
.side .g{font-size:10.5px;letter-spacing:.12em;color:#6f938a;margin:14px 8px 4px;font-weight:600}
.side a.i{display:block;padding:6px 10px;border-radius:7px;text-decoration:none;color:#cfe0d9}
.side a.i.on{background:#1d4237;color:#fff;font-weight:600;box-shadow:inset 3px 0 0 var(--v)}
.main{flex:1;min-width:0;display:flex;flex-direction:column}
.top{background:#fff;border-bottom:1px solid var(--l);display:flex;align-items:center;gap:12px;padding:12px 24px;flex-wrap:wrap}
.top h1{font-size:19px;margin:0;font-weight:600;color:var(--e)}
.top .sp{flex:1}
.conteudo{padding:20px 24px;display:flex;flex-direction:column;gap:18px;min-width:0}
.card{background:#fff;border:1px solid var(--l);border-radius:12px;padding:16px 18px;min-width:0}
.card h2{margin:0 0 12px;font-size:15px;font-weight:600;color:var(--e)}
.muted{color:var(--s)}
.btn{display:inline-block;border:1px solid var(--l);background:#fff;border-radius:8px;padding:8px 13px;font:500 13px Inter,system-ui,sans-serif;color:var(--t);cursor:pointer;text-decoration:none}
.btn.p{background:var(--v);border-color:var(--v);color:#fff;font-weight:600}
.btn.r{color:#B42318;border-color:#f3c9c9}
.chip{display:inline-block;font-size:11.5px;font-weight:600;padding:2px 9px;border-radius:20px;white-space:nowrap}
.chip.ok{background:#E3F5EE;color:#047857}.chip.wait{background:#FFF3DF;color:#A35F00}.chip.no{background:#FDE8E8;color:#B42318}.chip.info{background:#E8EEFC;color:#3651A8}
.tab-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:var(--s);font-weight:500;font-size:12px;padding:7px 8px;border-bottom:1px solid var(--l)}
td{padding:8px;border-bottom:1px solid #eef2f0;vertical-align:top}
form.linha,div.linha{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
label{display:flex;flex-direction:column;gap:4px;font-size:12px;color:var(--s);font-weight:500}
input,select,textarea{border:1px solid #d5dfdb;border-radius:8px;padding:8px 10px;font:14px Inter,system-ui,sans-serif;background:#fff;color:var(--t);min-width:0}
.checks{display:flex;flex-wrap:wrap;gap:10px;font-size:13px;color:var(--t)}
.checks label{flex-direction:row;align-items:center;color:var(--t)}
.aviso{border-radius:10px;padding:10px 14px;font-size:13px}
.aviso.erro{background:#FDE8E8;color:#B42318}.aviso.ok{background:#E3F5EE;color:#047857}
.grade{display:grid;gap:0;border:1px solid var(--l);border-radius:12px;overflow:hidden;background:#fff}
.grade .h{background:#fff;padding:10px 12px;font-weight:600;color:var(--e);border-bottom:1px solid var(--l)}
.grade .h small{display:block;font-weight:400;color:var(--s)}
.grade .hora{font-size:11.5px;color:var(--s);padding:6px 8px;text-align:right;border-top:1px solid #f0f3f2}
.grade .cel{border-left:1px solid var(--l);border-top:1px solid #f0f3f2;padding:3px;min-height:40px}
.ev{border-radius:7px;padding:5px 8px;font-size:12px;border-left:4px solid;height:100%}
.ev b{display:block;font-size:12.5px;font-weight:600}
.ev.fixa{background:#E3F5EE;border-color:var(--v)}.ev.experimental{background:#FFF3DF;border-color:var(--exp)}
.ev.reposicao{background:#E8EEFC;border-color:var(--rep)}.ev.avulsa,.ev.dupla{background:#F1E9FA;border-color:var(--dup)}
.ev.livre{background:repeating-linear-gradient(135deg,#fafcfb 0 6px,#f1f5f3 6px 12px);border:1px dashed #c4d2cc;color:var(--s)}
.ev.bloq{background:#f3f4f4;border-color:#9aa6a2;color:var(--s)}
.leg{display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--s)}
.leg i{display:inline-block;width:10px;height:10px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.login{max-width:380px;margin:12vh auto;padding:0 16px}
@media (max-width:820px){
  .app{flex-direction:column}
  .side{width:auto;padding:10px 12px;display:flex;flex-wrap:wrap;gap:4px;align-items:center}
  .side .marca{margin:0 10px 0 0}.side .g{display:none}
  .side a.i{padding:5px 9px}
  .top{padding:10px 16px}.conteudo{padding:14px 16px}
}
`;

// Menu lateral só com o que o usuário pode abrir (PER-02; o servidor confere de novo, PER-03).
function menu(u, ativo) {
  const itens = [
    ['AGENDA', [['grade', '/grade', 'Grade do dia'], ['experimentais', '/experimentais', 'Experimentais'], ['cadastros', '/cadastros', 'Quadras e professores']]],
    ['ALUNOS', [['alunos', '/alunos', 'Alunos'], ['planos', '/planos', 'Planos'], ['contatos', '/contatos', 'Contatos']]],
    ['WHATSAPP', [['conversas', '/conversas', 'Conversas'], ['sofia', '/sofia', 'Sofia'], ['whatsapp', '/whatsapp', 'Conexão e mensagens']]],
    ['CONFIGURAÇÕES', [['usuarios', '/usuarios', 'Usuários'], ['historico', '/historico', 'Histórico'], ['exportar', '/exportar', 'Exportar dados']]],
  ];
  let h = '<nav class="side"><a class="marca" href="/grade">Play Squash</a>';
  const fim = `<div class="g">AJUDA</div><a class="i${ativo === 'novidades' ? ' on' : ''}" href="/novidades">Novidades</a>`;
  for (const [grupo, links] of itens) {
    const vis = links.filter(([tela]) => temTela(u, tela));
    if (!vis.length) continue;
    h += `<div class="g">${grupo}</div>`;
    for (const [tela, href, nome] of vis) h += `<a class="i${tela === ativo ? ' on' : ''}" href="${href}">${esc(nome)}</a>`;
  }
  return h + fim + '</nav>';
}

function pagina({ titulo, usuario, ativo, corpo, acoes = '', aviso = null }) {
  const av = (aviso ? `<div class="aviso ${aviso.tipo === 'erro' ? 'erro' : 'ok'}" role="status">${esc(aviso.texto)}</div>` : '')
    // OPR-04: WhatsApp fora do ar há mais de 10 min → aviso em todas as telas do admin.
    + (usuario && usuario.eh_admin && require('../whatsapp/estado').precisaAviso()
      ? '<div class="aviso erro" role="alert">O WhatsApp da Play Squash está desconectado. As mensagens estão guardadas na fila. <a href="/whatsapp">Reconectar</a></div>' : '');
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(titulo)} · Play Squash</title><style>${CSS}</style></head><body><div class="app">${menu(usuario, ativo)}
<div class="main"><div class="top"><h1>${esc(titulo)}</h1><div class="sp"></div>${acoes}
<span class="muted">${esc(usuario.nome)}</span><form method="post" action="/sair"><button class="btn">Sair</button></form></div>
<div class="conteudo">${av}${corpo}</div></div></div></body></html>`;
}

function paginaLogin({ erro = '', email = '' } = {}) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Entrar · Play Squash</title><style>${CSS}</style></head><body><div class="login"><div class="card">
<h2>Play Squash — painel</h2>${erro ? `<div class="aviso erro" role="alert">${esc(erro)}</div><br>` : ''}
<form method="post" action="/login" style="display:flex;flex-direction:column;gap:12px">
<label>E-mail<input type="email" name="email" value="${esc(email)}" required autocomplete="username"></label>
<label>Senha<input type="password" name="senha" required autocomplete="current-password"></label>
<button class="btn p">Entrar</button></form></div></div></body></html>`;
}

function paginaErro(status, texto) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${status} · Play Squash</title><style>${CSS}</style></head><body><div class="login"><div class="card">
<h2>${status === 403 ? 'Sem acesso' : 'Não encontrado'}</h2><p class="muted">${esc(texto)}</p><a class="btn" href="/grade">Voltar</a></div></div></body></html>`;
}

module.exports = { esc, CSS, pagina, paginaLogin, paginaErro };
