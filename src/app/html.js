/**
 * Visual do app do aluno (VIS-05): celular primeiro (390 px), cabeçalho com saudação + título,
 * cartões de 14 px de canto, barra de abas embaixo, botões de ação curtos. Instalável (APP-01):
 * manifesto, service worker e ícones gerados aqui.
 */
const zlib = require('zlib');
const { esc } = require('../painel/html');

const CSS = `
:root{--v:#00A97E;--v2:#E3F5EE;--e:#0E2620;--t:#1D2A26;--s:#64746F;--l:#E3E9E6;--f:#F5F8F7;
--ok:#047857;--okf:#E3F5EE;--at:#A35F00;--atf:#FFF3DF;--no:#B42318;--nof:#FDE8E8;--in:#3651A8;--inf:#E8EEFC}
*{box-sizing:border-box}
body{margin:0;font-family:Inter,system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--t);background:var(--f);font-size:15px;line-height:1.45}
.topo{background:var(--e);color:#fff;padding:18px 16px 22px}
.topo .oi{font-size:13px;color:#b9d3ca;margin:0}
.topo h1{font-size:21px;margin:2px 0 0;font-weight:600}
.topo form{margin-top:10px}
.topo select{background:#1d4237;color:#fff;border:0;border-radius:10px;padding:8px 10px;font:14px inherit;max-width:100%}
main{padding:14px 16px 96px;max-width:640px;margin:0 auto}
.cartao{background:#fff;border:1px solid var(--l);border-radius:14px;padding:14px;margin-bottom:12px;min-width:0}
.cartao h2{font-size:15px;margin:0 0 4px;font-weight:600}
.leve{color:var(--s);font-size:13px}
.linha{display:flex;gap:8px;align-items:center;justify-content:space-between;flex-wrap:wrap}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}
.chip.ok{background:var(--okf);color:var(--ok)}.chip.at{background:var(--atf);color:var(--at)}
.chip.no{background:var(--nof);color:var(--no)}.chip.in{background:var(--inf);color:var(--in)}
.btn{display:inline-block;border:1px solid var(--l);background:#fff;color:var(--t);border-radius:10px;padding:9px 14px;font:600 14px Inter,system-ui,sans-serif;text-decoration:none;cursor:pointer}
.btn.p{background:var(--v);border-color:var(--v);color:#fff}.btn.r{color:var(--no);border-color:#f3c4c0}
.btn.cheio{width:100%;text-align:center}
input{width:100%;border:1px solid #d5dfdb;border-radius:10px;padding:12px;font:18px Inter,system-ui,sans-serif;margin:6px 0 12px}
label{font-size:13px;color:var(--s);font-weight:500}
.aviso{border-radius:12px;padding:10px 12px;margin-bottom:12px;font-size:14px}
.aviso.ok{background:var(--okf);color:var(--ok)}.aviso.erro{background:var(--nof);color:var(--no)}
nav.abas{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--l);display:flex;padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
nav.abas a{flex:1;text-align:center;font-size:12px;color:var(--s);text-decoration:none;padding:6px 2px;border-radius:10px}
nav.abas a b{display:block;font-size:18px;line-height:1.2}
nav.abas a.on{color:var(--v);font-weight:600;background:var(--v2)}
.vazio{text-align:center;color:var(--s);padding:24px 8px}
`;

const ABAS = [['aulas', '/app', '📅', 'Aulas'], ['reposicoes', '/app/reposicoes', '🔁', 'Reposições'], ['contratos', '/app/contratos', '📄', 'Contratos'], ['historico', '/app/historico', '🕘', 'Histórico']];

function cabecalhoHtml(titulo) {
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#0E2620"><link rel="manifest" href="/app/manifest.webmanifest"><link rel="apple-touch-icon" href="/app/icone-192.png">
<title>${esc(titulo)} · Play Squash</title><style>${CSS}</style></head>`;
}
const registrarSw = `<script>if('serviceWorker' in navigator)navigator.serviceWorker.register('/app/sw.js',{scope:'/app'}).catch(function(){});</script>`;

function paginaApp({ titulo, sessao, ativo, corpo, aviso = null }) {
  const nome = sessao ? String(sessao.aluno.nome || '').split(/\s+/)[0] : '';
  const seletor = sessao && sessao.alunos.length > 1
    ? `<form method="post" action="/app/aluno"><select name="aluno" aria-label="Aluno" onchange="this.form.submit()">${sessao.alunos.map(a => `<option value="${a.id}"${a.id === sessao.aluno.id ? ' selected' : ''}>${esc(a.nome)}</option>`).join('')}</select><noscript><button class="btn">Trocar</button></noscript></form>` : '';
  return `${cabecalhoHtml(titulo)}<body><header class="topo"><p class="oi">Olá, ${esc(nome)} 👋</p><h1>${esc(titulo)}</h1>${seletor}</header>
<main>${aviso ? `<div class="aviso ${aviso.tipo === 'erro' ? 'erro' : 'ok'}" role="status">${esc(aviso.texto)}</div>` : ''}${corpo}</main>
<nav class="abas">${ABAS.map(([k, href, ic, rot]) => `<a href="${href}" class="${k === ativo ? 'on' : ''}"><b aria-hidden="true">${ic}</b>${rot}</a>`).join('')}</nav>${registrarSw}</body></html>`;
}

function paginaEntrar({ corpo, aviso = null }) {
  return `${cabecalhoHtml('Entrar')}<body><header class="topo"><p class="oi">Play Squash</p><h1>App do aluno</h1></header>
<main>${aviso ? `<div class="aviso ${aviso.tipo === 'erro' ? 'erro' : 'ok'}" role="status">${esc(aviso.texto)}</div>` : ''}${corpo}</main>${registrarSw}</body></html>`;
}

const MANIFESTO = JSON.stringify({
  name: 'Play Squash', short_name: 'Play Squash', start_url: '/app', scope: '/app', display: 'standalone',
  background_color: '#F5F8F7', theme_color: '#0E2620', lang: 'pt-BR',
  icons: [{ src: '/app/icone-192.png', sizes: '192x192', type: 'image/png' }, { src: '/app/icone-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }],
});

// Service worker mínimo: deixa o app instalável e mostra um aviso quando estiver sem internet.
const SW = `self.addEventListener('install',e=>self.skipWaiting());
self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));
self.addEventListener('fetch',e=>{if(e.request.mode!=='navigate')return;
e.respondWith(fetch(e.request).catch(()=>new Response('<meta name=viewport content="width=device-width"><p style="font-family:sans-serif;padding:24px">Sem internet agora. Tente de novo em instantes.</p>',{headers:{'Content-Type':'text/html; charset=utf-8'}})));});`;

// Ícone: fundo verde-escuro com uma bola verde (PNG gerado na hora, sem arquivo no repositório).
function png(tam) {
  const linhas = [];
  const r = tam * 0.3, cx = tam / 2, cy = tam / 2;
  for (let y = 0; y < tam; y++) {
    const l = Buffer.alloc(1 + tam * 3);
    for (let x = 0; x < tam; x++) {
      const dentro = (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
      const [R, G, B] = dentro ? [0x00, 0xa9, 0x7e] : [0x0e, 0x26, 0x20];
      l[1 + x * 3] = R; l[2 + x * 3] = G; l[3 + x * 3] = B;
    }
    linhas.push(l);
  }
  const crcTab = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = b => { let c = 0xffffffff; for (const x of b) c = crcTab[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const bloco = (tipo, dados) => { const t = Buffer.from(tipo); const len = Buffer.alloc(4); len.writeUInt32BE(dados.length); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(Buffer.concat([t, dados]))); return Buffer.concat([len, t, dados, cr]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(tam, 0); ihdr.writeUInt32BE(tam, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), bloco('IHDR', ihdr), bloco('IDAT', zlib.deflateSync(Buffer.concat(linhas))), bloco('IEND', Buffer.alloc(0))]);
}
const ICONES = { 192: png(192), 512: png(512) };

module.exports = { paginaApp, paginaEntrar, MANIFESTO, SW, ICONES, esc };
