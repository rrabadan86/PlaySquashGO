/**
 * Google Agenda real, com conta de serviço (AGD-09, decisão do dono 24/11/2026).
 * Mesma interface do simulador testes/simuladores/google-falso.js (TST-08).
 *
 * A chave fica num arquivo fora do repositório (DAD-10): GOOGLE_CONTA_SERVICO_ARQUIVO.
 * Só escreve no Google (Sistema → Google); nada é lido de volta para o banco.
 */
const API = 'https://www.googleapis.com/calendar/v3';
const TZ = 'America/Sao_Paulo';

class ErroGoogle extends Error {
  constructor(status, msg) { super(`Google ${status}: ${msg}`); this.status = status; }
}

/**
 * @param {object} o
 * @param {() => Promise<string>} o.token   devolve o token de acesso
 * @param {typeof fetch} [o.fetch]
 */
function criarGoogleAgenda({ token, fetch: f = globalThis.fetch }) {
  async function chamar(metodo, caminho, corpo, { ignorar = [] } = {}) {
    const r = await f(API + caminho, {
      method: metodo,
      headers: { Authorization: `Bearer ${await token()}`, ...(corpo ? { 'Content-Type': 'application/json' } : {}) },
      body: corpo ? JSON.stringify(corpo) : undefined,
    });
    if (ignorar.includes(r.status)) return null;
    if (!r.ok) {
      let msg = r.statusText;
      try { msg = (await r.json()).error.message || msg; } catch (_) {}
      throw new ErroGoogle(r.status, msg);
    }
    return r.status === 204 ? null : r.json();
  }
  const enc = encodeURIComponent;
  const corpoEvento = ev => ({
    ...(ev.titulo != null ? { summary: ev.titulo } : {}),
    ...(ev.descricao != null ? { description: ev.descricao } : {}),
    ...(ev.inicio != null ? { start: { dateTime: new Date(ev.inicio).toISOString(), timeZone: TZ } } : {}),
    ...(ev.fim != null ? { end: { dateTime: new Date(ev.fim).toISOString(), timeZone: TZ } } : {}),
    ...(ev.cor != null ? { colorId: String(ev.cor) } : {}),
    ...(ev.privado ? { extendedProperties: { private: Object.fromEntries(Object.entries(ev.privado).map(([k, v]) => [k, String(v)])) } } : {}),
  });

  return {
    async criarAgenda(nome) {
      const r = await chamar('POST', '/calendars', { summary: nome, timeZone: TZ });
      return { id: r.id };
    },
    async compartilhar(agendaId, email) {
      await chamar('POST', `/calendars/${enc(agendaId)}/acl?sendNotifications=true`, { role: 'reader', scope: { type: 'user', value: email } });
    },
    async descompartilhar(agendaId, email) {
      await chamar('DELETE', `/calendars/${enc(agendaId)}/acl/${enc('user:' + email)}`, null, { ignorar: [404, 410] });
    },
    async criarEvento(agendaId, ev) {
      const r = await chamar('POST', `/calendars/${enc(agendaId)}/events`, corpoEvento(ev));
      return { id: r.id };
    },
    async atualizarEvento(agendaId, id, ev) {
      await chamar('PATCH', `/calendars/${enc(agendaId)}/events/${enc(id)}`, corpoEvento(ev));
      return { id };
    },
    async apagarEvento(agendaId, id) {
      await chamar('DELETE', `/calendars/${enc(agendaId)}/events/${enc(id)}`, null, { ignorar: [404, 410] });
    },
  };
}

// Token da conta de serviço a partir do arquivo de chave (só no servidor).
function tokenDaContaDeServico(arquivo) {
  const { JWT } = require('google-auth-library');
  const cli = new JWT({ keyFile: arquivo, scopes: ['https://www.googleapis.com/auth/calendar'] });
  return async () => (await cli.getAccessToken()).token;
}

// Google configurado no .env? Sem arquivo de chave, a fila acumula e nada é enviado.
function googleDoAmbiente(env = process.env) {
  if (!env.GOOGLE_CONTA_SERVICO_ARQUIVO) return null;
  return criarGoogleAgenda({ token: tokenDaContaDeServico(env.GOOGLE_CONTA_SERVICO_ARQUIVO) });
}

module.exports = { criarGoogleAgenda, googleDoAmbiente, ErroGoogle };
