/**
 * Rotinas que rodam sozinhas no servidor:
 * - carga dos feriados nacionais do ano atual e do próximo (AGD-03), uma vez por dia;
 * - envio da fila do Google Agenda (AGD-09), a cada 30 s.
 */
const { tx } = require('./db');
const { feriadosNacionais } = require('./regras/feriados');
const { registrar } = require('./historico');
const { processarFila } = require('./agenda/sincronizar');
const { hojeSP } = require('./relogio');

const SISTEMA = { tipo: 'sistema', id: null };

// Insere os feriados nacionais que ainda não existem. Feriado removido pelo admin não volta
// (a linha continua lá, com cancelado_em). Devolve quantos entraram.
async function carregarFeriados(c, ano) {
  let n = 0;
  for (const f of feriadosNacionais(ano)) {
    const r = await c.query(
      `INSERT INTO feriado (data, nome, abrangencia) VALUES ($1,$2,'nacional') ON CONFLICT (data) DO NOTHING RETURNING data`, [f.data, f.nome]);
    if (r.rowCount) {
      n++;
      await registrar(c, { ator: SISTEMA, origem: 'sistema', acao: 'feriado.carregado', entidade: 'feriado', depois: f });
    }
  }
  return n;
}

function iniciarRotinas({ pool, google, log = console, intervaloMs = 30000 }) {
  let ultimoDiaFeriados = null;
  let rodando = false;
  async function volta() {
    if (rodando) return;
    rodando = true;
    try {
      const hoje = hojeSP();
      if (ultimoDiaFeriados !== hoje) {
        const ano = Number(hoje.slice(0, 4));
        const n = await tx(pool, async c => (await carregarFeriados(c, ano)) + (await carregarFeriados(c, ano + 1)));
        if (n) log.log(`[rotinas] ${n} feriado(s) nacional(is) carregado(s).`);
        ultimoDiaFeriados = hoje;
      }
      if (google) await processarFila({ pool, google, log });
    } catch (e) {
      log.error(`[rotinas] ${e.message}`);
    } finally {
      rodando = false;
    }
  }
  volta();
  const t = setInterval(volta, intervaloMs);
  return { parar: () => clearInterval(t), volta };
}

module.exports = { carregarFeriados, iniciarRotinas };
