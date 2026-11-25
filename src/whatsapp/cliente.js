/**
 * Cliente real do WhatsApp (OPR-01): whatsapp-web.js pelo QR, isolado neste arquivo — o resto
 * do sistema só conhece a interface (a mesma do simulador testes/simuladores/whatsapp-falso.js):
 *   iniciar(), enviar(telefoneE164, texto) → { id }, enviarArquivo(telefoneE164, { arquivo, tipoMime, legenda }) → { id },
 *   aoReceber(fn), conectado, parar()
 * Trocar pela API oficial da Meta no futuro = outro arquivo com a mesma interface.
 *
 * Aprendizados trazidos da SlimFit (wa-client.js):
 * - Sessão salva em pasta ESTÁVEL fora do repositório (WA_SESSAO_DIR): escaneia o QR uma vez só.
 * - Versão do WhatsApp Web pode ser fixada (WA_WEB_VERSION_URL, .html do repositório wa-version):
 *   foi o que resolveu a quebra de 23/11/2026, quando o QR novo deixou de ser reconhecido.
 * - Número com ou sem o 9: pergunta ao WhatsApp qual forma existe antes de mandar (OPR-11).
 * - Caiu: tenta religar sozinho a cada 30 s; o painel avisa o admin depois de 10 min (OPR-04).
 */
const os = require('os');
const path = require('path');
const estado = require('./estado');
const { variantes, normalizar } = require('./telefone');

function criarClienteWhatsapp({
  lib = null, // { Client, LocalAuth } — injetável para teste
  sessaoDir = process.env.WA_SESSAO_DIR || path.join(os.homedir(), '.playsquash-whatsapp'),
  versaoUrl = process.env.WA_WEB_VERSION_URL || '',
  chromium = process.env.CHROMIUM_PATH || undefined,
  religarMs = 30000,
  log = console,
} = {}) {
  const { Client, LocalAuth, MessageMedia } = lib || require('whatsapp-web.js');
  const ouvintes = [];
  let client = null, pronto = false, parado = false, timer = null;

  function emitir(e) { for (const f of ouvintes) { try { f(e); } catch (err) { log.error(`[whatsapp] ouvinte: ${err.message}`); } } }

  function criar() {
    client = new Client({
      authStrategy: new LocalAuth({ dataPath: sessaoDir, clientId: 'playsquash' }),
      webVersionCache: versaoUrl ? { type: 'remote', remotePath: versaoUrl } : { type: 'none' },
      puppeteer: {
        headless: true,
        executablePath: chromium,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      },
    });
    client.on('qr', async qr => {
      let imagem = null;
      try { imagem = await require('qrcode').toDataURL(qr, { margin: 1, width: 280 }); } catch (_) {}
      estado.mudar('aguardando_qr', { qr: imagem });
      emitir({ tipo: 'qr' });
    });
    client.on('ready', () => {
      pronto = true;
      const numero = client.info && client.info.wid ? normalizar(client.info.wid.user) : null;
      estado.mudar('conectado', { numero });
      log.log(`[whatsapp] conectado${numero ? ' como ' + numero : ''}`);
      emitir({ tipo: 'pronto' });
    });
    client.on('auth_failure', m => { pronto = false; estado.mudar('desconectado'); log.error(`[whatsapp] falha de autenticação: ${m}`); });
    client.on('disconnected', motivo => {
      pronto = false;
      estado.mudar('desconectado');
      log.error(`[whatsapp] desconectado: ${motivo}`);
      emitir({ tipo: 'desconectado' });
      religar();
    });
    client.on('message', msg => {
      // Só conversa individual de outra pessoa (grupo, status e as nossas próprias ficam de fora).
      if (msg.fromMe || !/@c\.us$/.test(msg.from || '') || msg.isStatus) return;
      emitir({ tipo: 'mensagem', de: msg.from, texto: msg.body || '', em: (msg.timestamp ? msg.timestamp * 1000 : Date.now()) });
    });
    return client;
  }

  function religar() {
    if (parado || timer) return;
    timer = setTimeout(async () => {
      timer = null;
      try { if (client) await client.destroy(); } catch (_) {}
      if (!parado) iniciar();
    }, religarMs);
  }

  async function iniciar() {
    parado = false;
    estado.mudar('iniciando');
    try {
      await criar().initialize();
    } catch (e) {
      estado.mudar('desconectado');
      log.error(`[whatsapp] não iniciou: ${e.message}`);
      religar();
    }
  }

  // Acha a forma do número que existe no WhatsApp (com ou sem o 9).
  async function chatDe(telefone) {
    if (!pronto) throw new Error('WhatsApp desconectado');
    for (const v of variantes(telefone)) {
      const r = await client.getNumberId(v.replace(/\D/g, ''));
      if (r) return r._serialized;
    }
    throw new Error('número sem WhatsApp');
  }

  async function enviar(telefone, texto) {
    const m = await client.sendMessage(await chatDe(telefone), String(texto));
    return { id: m && m.id ? m.id._serialized : null };
  }

  // SOF-10: imagem ou PDF da pasta de anexos (fora do Git), com legenda.
  async function enviarArquivo(telefone, { arquivo, legenda = '' }) {
    const id = await chatDe(telefone);
    const media = MessageMedia.fromFilePath(arquivo);
    const m = await client.sendMessage(id, media, { caption: String(legenda || '') });
    return { id: m && m.id ? m.id._serialized : null };
  }

  return {
    iniciar,
    enviar,
    enviarArquivo,
    aoReceber(fn) { ouvintes.push(fn); },
    get conectado() { return pronto; },
    async parar() { parado = true; if (timer) clearTimeout(timer); timer = null; pronto = false; try { if (client) await client.destroy(); } catch (_) {} estado.mudar('desligado'); },
  };
}

module.exports = { criarClienteWhatsapp };
