/**
 * Login do app do aluno (APP-01, APP-02): código de 6 dígitos de uso único pelo WhatsApp e
 * sessão longa num cookie próprio ("ps_app"). Guardamos só o hash do código e do token.
 *
 * - Quem entra: telefone de aluno ativo ou de responsável de aluno ativo (com e sem o 9, OPR-11).
 * - Código vale N minutos (app.codigo_validade_min), uma vez só, até 5 tentativas erradas.
 * - No máximo 3 códigos por telefone por hora (protege o número de WhatsApp, OPR-02).
 * - A resposta ao pedir o código é a mesma para qualquer telefone (não revela quem é aluno).
 */
const crypto = require('crypto');
const { tx } = require('../db');
const { lerRegras } = require('../config');
const { registrar } = require('../historico');
const { enfileirar } = require('../whatsapp/envio');
const { normalizar, variantes } = require('../whatsapp/telefone');

const COOKIE = 'ps_app';
const TENTATIVAS = 5;
const POR_HORA = 3;
const hash = v => crypto.createHash('sha256').update(String(v)).digest('hex');

// Alunos ativos ligados ao telefone (o próprio ou como responsável), APP-02.
async function alunosDoTelefone(c, telefone) {
  const vs = variantes(telefone);
  if (!vs.length) return [];
  return (await c.query(
    `SELECT a.id, a.contato_id, ct.nome, (ct.telefone = ANY($1)) AS proprio
       FROM aluno a JOIN contato ct ON ct.id = a.contato_id LEFT JOIN contato r ON r.id = a.responsavel_contato_id
      WHERE a.situacao = 'ativo' AND ct.anonimizado_em IS NULL AND (ct.telefone = ANY($1) OR r.telefone = ANY($1))
      ORDER BY ct.nome`, [vs])).rows;
}

// Contato que recebe as mensagens desse telefone (aluno ou responsável).
async function contatoDoTelefone(c, telefone) {
  return (await c.query('SELECT id FROM contato WHERE telefone = ANY($1) AND anonimizado_em IS NULL ORDER BY id LIMIT 1', [variantes(telefone)])).rows[0] || null;
}

/** Pede um código. Sempre devolve { ok: true } (exceto telefone inválido), mandando o código só se for aluno. */
async function pedirCodigo(pool, telefoneDigitado, { aleatorio = () => crypto.randomInt(0, 1000000) } = {}) {
  const tel = normalizar(telefoneDigitado);
  if (!tel) return { ok: false, motivo: 'Telefone inválido: use DDD + número.' };
  return tx(pool, async c => {
    const alunos = await alunosDoTelefone(c, tel);
    if (!alunos.length) return { ok: true, telefone: tel };
    const recentes = (await c.query(`SELECT count(*)::int n FROM app_codigo WHERE telefone = $1 AND criado_em > now() - interval '1 hour'`, [tel])).rows[0].n;
    if (recentes >= POR_HORA) return { ok: true, telefone: tel, limitado: true };
    const regras = await lerRegras(c);
    const minutos = Number(regras['app.codigo_validade_min'] ?? 10);
    const codigo = String(aleatorio()).padStart(6, '0');
    const r = (await c.query(
      `INSERT INTO app_codigo (telefone, codigo_hash, expira_em) VALUES ($1,$2, now() + make_interval(mins => $3)) RETURNING id`, [tel, hash(codigo), minutos])).rows[0];
    const ct = await contatoDoTelefone(c, tel);
    const texto = String(regras['app.mensagem_codigo'] || 'Seu código da Play Squash: {codigo}').replace('{codigo}', codigo).replace('{minutos}', minutos);
    await enfileirar(c, { contatoId: ct.id, tipo: 'aviso', texto, chaveUnica: `app-codigo:${r.id}` });
    return { ok: true, telefone: tel };
  });
}

/** Confere o código e cria a sessão. Devolve { token } ou { erro }. */
async function entrar(pool, telefoneDigitado, codigoDigitado, { ip = null } = {}) {
  const tel = normalizar(telefoneDigitado);
  const codigo = String(codigoDigitado || '').replace(/\D/g, '');
  if (!tel || codigo.length !== 6) return { erro: 'Código inválido.' };
  return tx(pool, async c => {
    const k = (await c.query(
      `SELECT * FROM app_codigo WHERE telefone = $1 AND usado_em IS NULL ORDER BY id DESC LIMIT 1 FOR UPDATE`, [tel])).rows[0];
    if (!k || new Date(k.expira_em) <= new Date() || k.tentativas >= TENTATIVAS) return { erro: 'Código vencido. Peça um novo.' };
    if (k.codigo_hash !== hash(codigo)) {
      await c.query('UPDATE app_codigo SET tentativas = tentativas + 1 WHERE id = $1', [k.id]);
      return { erro: k.tentativas + 1 >= TENTATIVAS ? 'Código errado muitas vezes. Peça um novo.' : 'Código errado. Confira a mensagem no WhatsApp.' };
    }
    await c.query('UPDATE app_codigo SET usado_em = now() WHERE id = $1', [k.id]);
    const alunos = await alunosDoTelefone(c, tel);
    if (!alunos.length) return { erro: 'Este número não tem aluno ativo.' };
    const token = crypto.randomBytes(32).toString('hex');
    const s = (await c.query(
      `INSERT INTO app_sessao (telefone, token_hash, aluno_id, ip) VALUES ($1,$2,$3,$4) RETURNING id`, [tel, hash(token), alunos[0].id, ip])).rows[0];
    const ct = await contatoDoTelefone(c, tel);
    await registrar(c, { ator: { tipo: 'aluno', id: alunos[0].id }, origem: 'app', acao: 'app.entrou', entidade: 'contato', entidadeId: ct && ct.id, depois: { sessao: s.id } });
    return { token };
  });
}

function lerCookie(req) {
  const m = String(req.headers.cookie || '').split(/;\s*/).find(p => p.startsWith(COOKIE + '='));
  return m ? decodeURIComponent(m.slice(COOKIE.length + 1)) : '';
}
function cookieDe(token, dias, https) {
  return `${COOKIE}=${encodeURIComponent(token)}; Path=/app; HttpOnly; SameSite=Lax; Max-Age=${dias * 86400}${https ? '; Secure' : ''}`;
}
const cookieSair = () => `${COOKIE}=; Path=/app; HttpOnly; SameSite=Lax; Max-Age=0`;

/**
 * Sessão da requisição: { id, telefone, alunos:[...], aluno } ou null. Sessão revogada, vencida
 * ou de telefone sem aluno ativo não vale. Atualiza o aluno escolhido se ele saiu da lista.
 */
async function sessaoDaReq(pool, req) {
  const token = lerCookie(req);
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const regras = await lerRegras(pool);
  const dias = Number(regras['app.sessao_dias'] ?? 180);
  const s = (await pool.query(
    `UPDATE app_sessao SET ultimo_uso_em = now() WHERE token_hash = $1 AND revogada_em IS NULL AND ultimo_uso_em > now() - make_interval(days => $2)
     RETURNING id, telefone, aluno_id`, [hash(token), dias])).rows[0];
  if (!s) return null;
  const alunos = await alunosDoTelefone(pool, s.telefone);
  if (!alunos.length) return null;
  const aluno = alunos.find(a => a.id === s.aluno_id) || alunos[0];
  return { id: s.id, telefone: s.telefone, alunos, aluno, dias };
}

async function escolherAluno(pool, sessao, alunoId) {
  if (!sessao.alunos.some(a => a.id === alunoId)) return false;
  await pool.query('UPDATE app_sessao SET aluno_id = $2 WHERE id = $1', [sessao.id, alunoId]);
  return true;
}

async function sair(pool, sessao) {
  await pool.query('UPDATE app_sessao SET revogada_em = now() WHERE id = $1', [sessao.id]);
}

module.exports = { pedirCodigo, entrar, sessaoDaReq, escolherAluno, sair, cookieDe, cookieSair, alunosDoTelefone, TENTATIVAS };
