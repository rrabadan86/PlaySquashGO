/**
 * Tela WhatsApp do painel (OPR-01..04, OPR-10): conexão (QR), fila, itens "a conferir",
 * ritmo e registro de mensagens. Só administrador.
 */
const { tx } = require('../db');
const { registrar, atorDoUsuario } = require('../historico');
const { lerRegras } = require('../config');
const { pode } = require('../regras/permissoes');
const estado = require('../whatsapp/estado');
const { aConferir, resumo } = require('../whatsapp/envio');
const { deRegras } = require('../whatsapp/ritmo');
const { esc, pagina } = require('./html');

const quando = t => new Date(t).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const SIT = {
  conectado: ['ok', 'Conectado'], aguardando_qr: ['wait', 'Aguardando leitura do QR'], iniciando: ['info', 'Iniciando…'],
  desconectado: ['no', 'Desconectado'], desligado: ['info', 'Desligado neste servidor'],
};

async function getWhatsapp(ctx) {
  if (!pode(ctx.usuario, 'whatsapp.ver')) return ctx.proibido();
  const e = estado.ler();
  const [cls, rot] = SIT[e.situacao] || ['info', e.situacao];
  const r = await resumo(ctx.pool);
  const conferir = await aConferir(ctx.pool);
  const cfg = deRegras(await lerRegras(ctx.pool));
  const msgs = (await ctx.pool.query(
    `SELECT m.*, c.nome, c.telefone, u.nome usuario FROM mensagem m LEFT JOIN contato c ON c.id = m.contato_id LEFT JOIN usuario u ON u.id = m.usuario_id
      ORDER BY m.em DESC, m.id DESC LIMIT 50`)).rows;
  const corpo = `<div class="card"><h2>Conexão</h2>
<p><span class="chip ${cls}">${esc(rot)}</span> ${e.numero ? `<b>${esc(e.numero)}</b>` : ''} <span class="muted">desde ${quando(e.desde)}</span></p>
${e.situacao === 'aguardando_qr' && e.qr ? `<p>No celular da Play Squash: WhatsApp → Aparelhos conectados → Conectar aparelho, e aponte para o QR:</p><img src="${e.qr}" alt="QR do WhatsApp" width="240" height="240" style="border:1px solid var(--l);border-radius:8px">` : ''}
${e.situacao === 'desligado' ? '<p class="muted">O envio está desligado neste servidor (WHATSAPP_LIGADO). As mensagens ficam guardadas na fila.</p>' : ''}</div>
<div class="card"><h2>Fila de envio</h2><div class="checks">
<span class="chip info">${r.pendentes} na fila</span><span class="chip ok">${r.enviadas_hoje} enviadas hoje</span>
${r.com_erro ? `<span class="chip wait">${r.com_erro} com erro (tentando de novo)</span>` : ''}${r.a_conferir ? `<span class="chip no">${r.a_conferir} a conferir</span>` : ''}</div>
<p class="muted">Ritmo: uma mensagem a cada ${cfg.intervaloMinS}–${cfg.intervaloMaxS} s, até ${cfg.limiteHora} por hora e ${cfg.limiteDia} por dia; campanhas só das ${esc(cfg.campanhaJanela.replace('-', ' às '))} e nunca para quem conversou nos últimos ${cfg.conversandoMin} min.</p></div>
${conferir.length ? `<div class="card"><h2>A conferir</h2><p class="muted" style="margin-top:-6px">O sistema caiu enquanto mandava estas mensagens: não dá para saber se saíram. Confira no celular e escolha — o sistema nunca reenvia sozinho.</p>
<div class="tab-wrap"><table><tr><th>Quando</th><th>Para</th><th>Mensagem</th><th></th></tr>${conferir.map(f => `<tr><td>${quando(f.enviando_em)}</td><td>${esc(f.nome || f.telefone || 'equipe')}</td><td>${esc(String(f.texto).slice(0, 140))}</td>
<td><form method="post" action="/whatsapp/fila/${f.id}/confirmar" style="display:inline"><button class="btn">Saiu, confirmar</button></form>
<form method="post" action="/whatsapp/fila/${f.id}/reenviar" style="display:inline"><button class="btn r">Não saiu, reenviar</button></form></td></tr>`).join('')}</table></div></div>` : ''}
<div class="card"><h2>Registro de mensagens</h2><div class="tab-wrap"><table><tr><th>Quando</th><th></th><th>Contato</th><th>Tipo</th><th>Mensagem</th></tr>
${msgs.map(m => `<tr><td>${quando(m.em)}</td><td>${m.direcao === 'entrada' ? '<span class="chip info">recebida</span>' : '<span class="chip ok">enviada</span>'}</td>
<td>${esc(m.nome || m.usuario || m.telefone || '(anonimizado)')}</td><td>${esc(m.motivo || '')}</td><td>${esc(String(m.texto || '').slice(0, 160))}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Nenhuma mensagem ainda.</td></tr>'}
</table></div><p class="muted">Mostra as 50 mais recentes.</p></div>`;
  ctx.html(200, pagina({ titulo: 'WhatsApp', usuario: ctx.usuario, ativo: 'whatsapp', corpo, aviso: ctx.aviso() }));
}

function acaoFila(acao) {
  return async ctx => {
    if (!pode(ctx.usuario, 'whatsapp.editar')) return ctx.proibido();
    const id = Number.parseInt(ctx.params.id, 10) || 0;
    const msg = await tx(ctx.pool, async c => {
      const f = (await c.query(
        `SELECT * FROM fila_envio WHERE id = $1 AND enviando_em IS NOT NULL AND enviado_em IS NULL AND cancelado_em IS NULL FOR UPDATE`, [id])).rows[0];
      if (!f) return null;
      const ator = atorDoUsuario(ctx.usuario);
      if (acao === 'confirmar') {
        await c.query('UPDATE fila_envio SET enviado_em = enviando_em WHERE id = $1', [id]);
        await c.query(`INSERT INTO mensagem (contato_id, usuario_id, direcao, texto, motivo, situacao, fila_envio_id, em)
          VALUES ($1,$2,'saida',$3,$4,'confirmada pelo admin',$5,$6)`, [f.contato_id, f.usuario_id, f.texto, f.tipo, id, f.enviando_em]);
        await registrar(c, { ator, acao: 'whatsapp.envio_confirmado', entidade: 'fila_envio', entidadeId: id });
        return 'Marcado como enviado.';
      }
      await c.query('UPDATE fila_envio SET enviando_em = NULL, agendado_para = now() WHERE id = $1', [id]);
      await registrar(c, { ator, acao: 'whatsapp.reenvio_pedido', entidade: 'fila_envio', entidadeId: id });
      return 'Voltou para a fila e será enviada de novo.';
    });
    ctx.redirecionar(`/whatsapp?${msg ? 'ok' : 'erro'}=${encodeURIComponent(msg || 'Item não está mais a conferir.')}`);
  };
}

module.exports = {
  ROTAS_WHATSAPP: [
    ['GET', '/whatsapp', getWhatsapp, true],
    ['POST', '/whatsapp/fila/:id/confirmar', acaoFila('confirmar'), true],
    ['POST', '/whatsapp/fila/:id/reenviar', acaoFila('reenviar'), true],
  ],
};
