/**
 * Ritmo de envio do WhatsApp (OPR-02): protege o número de bloqueio. Regra pura.
 *
 * - Intervalo aleatório entre duas mensagens (padrão 20 a 60 s).
 * - Limite por hora e por dia (contando todas as saídas).
 * - Campanha só dentro da janela (padrão 08:00–20:00) e nunca para quem conversou com a
 *   Play Squash nos últimos N minutos (padrão 30).
 * - Avisos, cobranças, Sofia e mensagem fixa não esperam janela, mas respeitam os limites.
 */
const { dataSP, instanteSP } = require('../relogio');

const MIN = 60000;
const PADRAO = { intervaloMinS: 20, intervaloMaxS: 60, limiteHora: 40, limiteDia: 300, campanhaJanela: '08:00-20:00', conversandoMin: 30 };

function deRegras(r = {}) {
  return {
    intervaloMinS: Number(r['whatsapp.intervalo_min_s'] ?? PADRAO.intervaloMinS),
    intervaloMaxS: Number(r['whatsapp.intervalo_max_s'] ?? PADRAO.intervaloMaxS),
    limiteHora: Number(r['whatsapp.limite_hora'] ?? PADRAO.limiteHora),
    limiteDia: Number(r['whatsapp.limite_dia'] ?? PADRAO.limiteDia),
    campanhaJanela: String(r['whatsapp.campanha_janela'] ?? PADRAO.campanhaJanela),
    conversandoMin: Number(r['whatsapp.conversando_min'] ?? PADRAO.conversandoMin),
  };
}

// Próximo intervalo aleatório entre duas mensagens, em ms.
function intervalo(cfg = PADRAO, aleatorio = Math.random) {
  const a = cfg.intervaloMinS * 1000, b = Math.max(cfg.intervaloMaxS, cfg.intervaloMinS) * 1000;
  return Math.round(a + (b - a) * aleatorio());
}

/**
 * Pode enviar agora? Se não, a partir de quando tentar de novo.
 * @param {object} p
 * @param {number} p.agora
 * @param {'sofia'|'aviso'|'cobranca'|'campanha'|'fixa'|'professor'} p.tipo
 * @param {number[]} p.saidas          instantes (ms) das mensagens enviadas nas últimas 24 h
 * @param {number|null} [p.ultimaConversa] instante da última mensagem recebida desse contato
 * @param {object} [cfg]
 * @returns {{ pode: boolean, motivo?: string, aPartirDe?: number }}
 */
function decidir({ agora, tipo, saidas, ultimaConversa = null }, cfg = PADRAO) {
  const naHora = saidas.filter(t => agora - t < 60 * MIN).sort((a, b) => a - b);
  if (naHora.length >= cfg.limiteHora) return { pode: false, motivo: 'limite por hora', aPartirDe: naHora[naHora.length - cfg.limiteHora] + 60 * MIN };
  const noDia = saidas.filter(t => agora - t < 24 * 60 * MIN).sort((a, b) => a - b);
  if (noDia.length >= cfg.limiteDia) return { pode: false, motivo: 'limite por dia', aPartirDe: noDia[noDia.length - cfg.limiteDia] + 24 * 60 * MIN };
  if (tipo === 'campanha') {
    const [ini, fim] = cfg.campanhaJanela.split('-');
    const hoje = dataSP(agora);
    const a = instanteSP(hoje, ini), b = instanteSP(hoje, fim);
    if (agora < a) return { pode: false, motivo: 'fora da janela de campanhas', aPartirDe: a };
    if (agora >= b) return { pode: false, motivo: 'fora da janela de campanhas', aPartirDe: a + 24 * 60 * MIN };
    if (ultimaConversa != null && agora - ultimaConversa < cfg.conversandoMin * MIN) {
      return { pode: false, motivo: 'contato conversando', aPartirDe: ultimaConversa + cfg.conversandoMin * MIN };
    }
  }
  return { pode: true };
}

// "SAIR" (OPR-03): a pessoa pede para não receber campanhas.
function pedeSair(texto) {
  return /^\s*(sair|parar|pare|stop|cancelar campanhas?|n[aã]o quero mais (receber )?(mensagens|campanhas))\s*[.!]*\s*$/i.test(String(texto || ''));
}

module.exports = { PADRAO, deRegras, intervalo, decidir, pedeSair };
