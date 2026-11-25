/**
 * WhatsApp falso (TST-01, TST-08): mesma interface do cliente real (src/whatsapp/cliente.js),
 * mas guarda tudo em memória. Nada sai para a rede.
 *
 *   const wa = criarWhatsappFalso();
 *   await wa.enviar('+5562999990000', 'Olá');   // → { id }
 *   wa.receber('+5562999990000', 'sim');        // simula mensagem chegando (chama os ouvintes)
 *   wa.enviadas                                  // [{ id, para, texto, em }]
 */
function criarWhatsappFalso({ conectado = true } = {}) {
  const enviadas = [];
  const ouvintes = [];
  let seq = 0;
  let online = conectado;
  return {
    enviadas,
    get conectado() { return online; },
    async iniciar() { online = true; },
    async parar() { online = false; },
    conectar() { online = true; ouvintes.forEach(f => f({ tipo: 'pronto' })); },
    desconectar() { online = false; ouvintes.forEach(f => f({ tipo: 'desconectado' })); },
    async enviar(para, texto) {
      if (!online) throw new Error('WhatsApp desconectado');
      const msg = { id: `falso-${++seq}`, para, texto, em: Date.now() };
      enviadas.push(msg);
      return { id: msg.id };
    },
    async enviarArquivo(para, { arquivo, tipoMime, legenda = '' }) {
      if (!online) throw new Error('WhatsApp desconectado');
      const msg = { id: `falso-${++seq}`, para, texto: legenda, arquivo, tipoMime, em: Date.now() };
      enviadas.push(msg);
      return { id: msg.id };
    },
    aoReceber(f) { ouvintes.push(f); },
    receber(de, texto, em = Date.now()) { ouvintes.forEach(f => f({ tipo: 'mensagem', de, texto, em })); },
    para(telefone) { return enviadas.filter(m => m.para === telefone); },
    limpar() { enviadas.length = 0; },
  };
}
module.exports = { criarWhatsappFalso };
