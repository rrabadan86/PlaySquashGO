/**
 * Sessão do painel: cookie "ps_sessao" = <id>.<assinatura HMAC>. O id fica na tabela sessao;
 * sair ou o admin encerrar marca revogada_em (nunca apaga, DAD-03). Cookie HttpOnly, SameSite=Lax.
 */
const crypto = require('crypto');

const COOKIE = 'ps_sessao';
const DURACAO_DIAS = 30;

function assinar(segredo, id) { return crypto.createHmac('sha256', segredo).update(id).digest('hex'); }

function lerCookie(req, nome) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(p => p.startsWith(nome + '='));
  return m ? decodeURIComponent(m.slice(nome.length + 1)) : '';
}

function idDoCookie(segredo, valor) {
  const i = String(valor).lastIndexOf('.');
  if (i <= 0) return null;
  const id = valor.slice(0, i), sig = valor.slice(i + 1);
  const esperado = assinar(segredo, id);
  if (sig.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(esperado))) return null;
  return id;
}

function cookieDe(segredo, id, { https = false } = {}) {
  const v = `${id}.${assinar(segredo, id)}`;
  return `${COOKIE}=${encodeURIComponent(v)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${DURACAO_DIAS * 86400}${https ? '; Secure' : ''}`;
}
function cookieSair() { return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`; }

async function criar(c, usuarioId, ip) {
  const id = crypto.randomBytes(24).toString('hex');
  await c.query('INSERT INTO sessao (id, usuario_id, ip) VALUES ($1,$2,$3)', [id, usuarioId, ip || null]);
  return id;
}

// Usuário da requisição, ou null. Sessão revogada, vencida ou de usuário inativo não vale.
async function usuarioDaReq(pool, segredo, req) {
  const id = idDoCookie(segredo, lerCookie(req, COOKIE));
  if (!id) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.nome, u.email, u.eh_admin, u.eh_professor, s.id AS sessao_id,
            COALESCE(array_agg(t.tela) FILTER (WHERE t.tela IS NOT NULL), '{}') AS telas
       FROM sessao s JOIN usuario u ON u.id = s.usuario_id
       LEFT JOIN usuario_tela t ON t.usuario_id = u.id
      WHERE s.id = $1 AND s.revogada_em IS NULL AND u.ativo
        AND s.criada_em > now() - make_interval(days => $2)
      GROUP BY u.id, s.id`, [id, DURACAO_DIAS]);
  if (!rows[0]) return null;
  pool.query(`UPDATE sessao SET ultimo_uso = now() WHERE id = $1 AND ultimo_uso < now() - interval '1 minute'`, [id]).catch(() => {});
  return rows[0];
}

async function revogar(c, sessaoId) {
  await c.query('UPDATE sessao SET revogada_em = now() WHERE id = $1 AND revogada_em IS NULL', [sessaoId]);
}

module.exports = { COOKIE, lerCookie, idDoCookie, cookieDe, cookieSair, criar, usuarioDaReq, revogar };
