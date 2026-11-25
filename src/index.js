#!/usr/bin/env node
/**
 * Sobe o painel e as rotinas.  DATABASE_URL=... PAINEL_SEGREDO=... PORTA=3000 node src/index.js
 * Google Agenda: GOOGLE_CONTA_SERVICO_ARQUIVO=/caminho/fora/do/repo/chave.json (DAD-10).
 */
const { criarPool } = require('./db');
const { aplicar } = require('../scripts/migrar');
const { criarServidor } = require('./servidor');
const { googleDoAmbiente } = require('./agenda/google');
const { iniciarRotinas, iniciarWhatsapp } = require('./rotinas');
const { criarClienteWhatsapp } = require('./whatsapp/cliente');

async function main() {
  const pool = criarPool();
  const c = await pool.connect();
  try { const a = await aplicar(c); if (a.length) console.log(`Migrações aplicadas: ${a.join(', ')}`); } finally { c.release(); }
  const google = googleDoAmbiente();
  if (!google) console.log('Google Agenda não configurado (GOOGLE_CONTA_SERVICO_ARQUIVO): as mudanças ficam na fila até configurar.');
  iniciarRotinas({ pool, google });
  // WhatsApp (OPR-01): só liga com WHATSAPP_LIGADO=1; sem isso as mensagens ficam na fila.
  if (process.env.WHATSAPP_LIGADO === '1') {
    const wa = criarClienteWhatsapp();
    iniciarWhatsapp({ pool, wa });
    wa.iniciar();
  } else {
    console.log('WhatsApp desligado (WHATSAPP_LIGADO): as mensagens ficam na fila até ligar.');
  }
  const porta = Number(process.env.PORTA || 3000);
  criarServidor({ pool, segredo: process.env.PAINEL_SEGREDO || '', googleConfigurado: !!google })
    .listen(porta, () => console.log(`Painel em http://localhost:${porta}`));
}

main().catch(e => { console.error(e.message); process.exit(1); });
