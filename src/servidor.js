/**
 * Servidor do painel (Node http puro, HTML montado no servidor — mesmo modelo da SlimFit).
 *
 * - Toda rota com login confere a sessão no servidor (PER-03); a permissão de cada tela
 *   é conferida dentro da rota (src/regras/permissoes.js).
 * - POST só é aceito se Origin/Referer for o próprio painel (proteção contra envio de outro site).
 * - Corpo de formulário limitado a 100 KB.
 */
const http = require('http');
const { URL } = require('url');
const sessao = require('./auth/sessao');
const { ROTAS } = require('./painel/rotas');
const { ROTAS_AULAS } = require('./painel/rotas-aulas');
const { paginaErro } = require('./painel/html');

const LIMITE = 100 * 1024;

function compilar(rotas) {
  return rotas.map(([metodo, caminho, fn, login]) => {
    const nomes = [];
    const re = new RegExp('^' + caminho.replace(/:(\w+)/g, (_, n) => { nomes.push(n); return '([^/]+)'; }) + '$');
    return { metodo, re, nomes, fn, login };
  });
}

function lerCorpo(req) {
  return new Promise((ok, erro) => {
    let tam = 0; const partes = [];
    req.on('data', d => { tam += d.length; if (tam > LIMITE) { erro(Object.assign(new Error('corpo grande demais'), { status: 413 })); req.destroy(); } else partes.push(d); });
    req.on('end', () => {
      const txt = Buffer.concat(partes).toString('utf8');
      const corpo = {};
      for (const [k, v] of new URLSearchParams(txt)) {
        if (k in corpo) corpo[k] = [].concat(corpo[k], v); else corpo[k] = v;
      }
      ok(corpo);
    });
    req.on('error', erro);
  });
}

function mesmaOrigem(req) {
  const host = String(req.headers.host || '');
  const fonte = req.headers.origin || req.headers.referer || '';
  try { return !!fonte && new URL(fonte).host === host; } catch (_) { return false; }
}

function criarServidor({ pool, segredo, googleConfigurado = false, log = console }) {
  if (!segredo || segredo.length < 32) throw new Error('PAINEL_SEGREDO precisa de pelo menos 32 caracteres.');
  const rotas = compilar([...ROTAS, ...ROTAS_AULAS]);

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    const https = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim() === 'https';
    const enviar = (status, tipo, corpo, extras = {}) => {
      res.writeHead(status, {
        'Content-Type': tipo, 'Cache-Control': 'no-store', 'X-Frame-Options': 'DENY',
        'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'same-origin', ...extras,
      });
      res.end(corpo);
    };
    try {
      if (url.pathname === '/saude') return enviar(200, 'text/plain; charset=utf-8', 'ok');
      if (url.pathname === '/' && req.method === 'GET') { res.writeHead(302, { Location: '/grade' }); return res.end(); }

      let rota = null, params = {};
      for (const r of rotas) {
        const m = r.re.exec(url.pathname);
        if (m && r.metodo === req.method) { rota = r; r.nomes.forEach((n, i) => { params[n] = decodeURIComponent(m[i + 1]); }); break; }
      }
      if (!rota) return enviar(404, 'text/html; charset=utf-8', paginaErro(404, 'Página não encontrada.'));
      if (req.method === 'POST' && !mesmaOrigem(req)) return enviar(403, 'text/html; charset=utf-8', paginaErro(403, 'Envio recusado (origem desconhecida).'));

      const usuario = await sessao.usuarioDaReq(pool, segredo, req);
      if (rota.login && !usuario) {
        if (req.method === 'GET') { res.writeHead(302, { Location: '/login' }); return res.end(); }
        return enviar(401, 'text/html; charset=utf-8', paginaErro(403, 'Entre de novo no painel.'));
      }
      if (!rota.login && usuario && req.method === 'GET') { res.writeHead(302, { Location: '/grade' }); return res.end(); }

      const corpo = req.method === 'POST' ? await lerCorpo(req) : {};
      const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
      const ctx = {
        pool, segredo, usuario, corpo, params, https, ip, googleConfigurado, res,
        query: Object.fromEntries(url.searchParams),
        html: (status, h) => enviar(status, 'text/html; charset=utf-8', h),
        redirecionar: (loc, extras = {}) => { res.writeHead(303, { Location: loc, 'Cache-Control': 'no-store', ...extras }); res.end(); },
        proibido: () => enviar(403, 'text/html; charset=utf-8', paginaErro(403, 'Seu perfil não tem acesso a esta tela. Fale com o administrador.')),
        aviso: () => url.searchParams.get('erro') ? { tipo: 'erro', texto: url.searchParams.get('erro') }
          : url.searchParams.get('ok') ? { tipo: 'ok', texto: url.searchParams.get('ok') } : null,
      };
      await rota.fn(ctx);
    } catch (e) {
      if (e.status === 413) return enviar(413, 'text/plain; charset=utf-8', 'Envio grande demais.');
      log.error(`[painel] ${req.method} ${url.pathname}: ${e.stack || e.message}`);
      if (!res.headersSent) enviar(500, 'text/html; charset=utf-8', paginaErro(500, 'Algo deu errado. Tente de novo; se continuar, avise o suporte.'));
    }
  });
}

module.exports = { criarServidor, mesmaOrigem };
