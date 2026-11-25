/**
 * Estado da conexão do WhatsApp neste processo (o painel e o envio rodam juntos).
 * OPR-04: desconectado ou pedindo QR por mais de 10 min → aviso no painel do admin.
 */
const AVISO_MS = 10 * 60000;

const estado = { situacao: 'desligado', desde: Date.now(), qr: null, numero: null, avisado: false };

function mudar(situacao, extra = {}) {
  if (estado.situacao !== situacao) { estado.situacao = situacao; estado.desde = Date.now(); estado.avisado = false; }
  Object.assign(estado, extra);
  if (situacao !== 'aguardando_qr') estado.qr = null;
}

function ler() { return { ...estado }; }

// O admin precisa ser avisado agora? (fora do ar há mais de 10 min; desligado de propósito não conta)
function precisaAviso(agora = Date.now()) {
  return (estado.situacao === 'desconectado' || estado.situacao === 'aguardando_qr') && agora - estado.desde >= AVISO_MS;
}

function zerar() { Object.assign(estado, { situacao: 'desligado', desde: Date.now(), qr: null, numero: null, avisado: false }); }

module.exports = { mudar, ler, precisaAviso, zerar, AVISO_MS, _estado: estado };
