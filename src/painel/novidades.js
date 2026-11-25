/**
 * Novidades do painel (DEP-05): o que mudou em cada versão, em linguagem de quem usa.
 * Mudança que o dono ou os professores vão notar → item novo no topo desta lista.
 * "para": 'todos' ou 'admin' (professor só vê o que vale para ele).
 */
const { esc, pagina } = require('./html');

const NOVIDADES = [
  {
    data: '2026-11-25', titulo: 'Confirmação da experimental e pós-aula', para: 'admin', itens: [
      'Na véspera, às 19h, o lead recebe o pedido de confirmação; sem resposta, recebe de novo 3 h antes e a aula é cancelada 90 min antes (tudo editável na tela Sofia).',
      'A Sofia entende "sim" e "não vou": confirmada, a aula ganha ✓ no Google; desistiu, o horário fica livre e ela oferece outra data.',
      'Quem estava na lista de espera daquele horário é avisado; o primeiro que marcar leva, e os outros recebem "vaga já preenchida".',
      'Nova tela "Experimentais": próximas e recentes, com botões de confirmou/não vai, presença e resultado (matriculou ou perdido, com o motivo).',
      'Depois da aula, a Sofia manda uma mensagem no mesmo dia e outra 2 dias depois, até você registrar o resultado.',
    ],
  },
  {
    data: '2026-11-25', titulo: 'Experimental confirmada ou cancelada', para: 'todos', itens: [
      'Você recebe no WhatsApp quando o lead confirma, desiste ou a experimental é cancelada por falta de confirmação.',
    ],
  },
  {
    data: '2026-11-25', titulo: 'Sofia atendendo no WhatsApp', para: 'admin', itens: [
      'A Sofia responde quem é novo: pergunta o nome, se já jogou, quem vai fazer a aula, dias e período, e oferece até 3 horários livres com o professor.',
      'Quando a pessoa escolhe, a aula experimental entra na grade e no Google Agenda, e o professor recebe um aviso no WhatsApp.',
      'Cada pessoa faz uma experimental (nome + data de nascimento). Para liberar mais uma, abra a conversa e use "Liberar nova aula experimental".',
      'Nova tela "Conversas": veja o que cada lead escreveu, assuma a conversa, responda e devolva à Sofia.',
      'Nova tela "Sofia": ligue ou desligue, escreva as informações da escola que ela pode passar, cadastre fotos e PDFs e acompanhe o custo da IA por dia.',
      'A Sofia não fala de valores nem cobra a experimental: isso fica para combinarmos no kickoff.',
    ],
  },
  {
    data: '2026-11-25', titulo: 'Avisos de aula experimental', para: 'todos', itens: [
      'Quando a Sofia marca uma experimental no seu horário, você recebe no WhatsApp o nome, o contato, o dia, a hora e a quadra.',
    ],
  },
  {
    data: '2026-11-25', titulo: 'WhatsApp da Play Squash no painel', para: 'admin', itens: [
      'Nova tela "WhatsApp": conecte o número lendo o QR e acompanhe tudo o que entrou e saiu.',
      'As mensagens saem com intervalo e limites para proteger o número; campanhas só em horário comercial.',
      'Quem responder SAIR deixa de receber campanhas na hora.',
      'Aluno que escrever no número recebe uma mensagem pedindo para usar o app ou falar com o professor.',
      'Se o WhatsApp cair por mais de 10 minutos, aparece um aviso no topo do painel.',
    ],
  },
  {
    data: '2026-11-25', titulo: 'Google Agenda, aulas pelo painel e mais', para: 'admin', itens: [
      'Botão "+ Aula" na grade: escolha o dia e o tipo e veja só os horários livres.',
      'Cada aula da grade abre a tela dela; dá para cancelar com motivo e o horário volta a ficar livre.',
      'As aulas vão sozinhas para o Google Agenda (uma agenda por quadra, que os professores veem no celular).',
      'Feriados nacionais entram sozinhos; os estaduais e municipais você cadastra em "Quadras e professores".',
      'Nova tela "Contatos", com o botão para anonimizar quem pedir para sair.',
      'Nova tela "Exportar dados": contatos, aulas, contratos, pagamentos e histórico em arquivos que abrem no Excel.',
    ],
  },
  {
    data: '2026-11-25', titulo: 'Google Agenda', para: 'todos', itens: [
      'As agendas "Play Squash — Quadra 1" e "Quadra 2" aparecem no seu Google Agenda, só para consulta. Mudanças são feitas pelo painel.',
    ],
  },
  {
    data: '2026-11-24', titulo: 'Painel da Play Squash no ar', para: 'todos', itens: [
      'Entrada com e-mail e senha; cada professor tem o próprio acesso.',
      'Grade do dia com as duas quadras lado a lado: aulas, horários livres e bloqueios.',
    ],
  },
  {
    data: '2026-11-24', titulo: 'Cadastros e histórico', para: 'admin', itens: [
      'Quadras, tipos de aula, grade de horários, bloqueios e feriados.',
      'Usuários: crie professores e escolha as telas que cada um vê.',
      'Histórico: tudo o que muda fica registrado com quem fez, quando e o que mudou.',
    ],
  },
];

function paraUsuario(u) { return NOVIDADES.filter(n => n.para === 'todos' || (n.para === 'admin' && u && u.eh_admin)); }

async function getNovidades(ctx) {
  const dataBR = iso => iso.split('-').reverse().join('/');
  const corpo = paraUsuario(ctx.usuario).map(n => `<div class="card"><h2>${esc(n.titulo)} <span class="muted" style="font-weight:400;font-size:13px">· ${dataBR(n.data)}</span></h2>
<ul>${n.itens.map(i => `<li>${esc(i)}</li>`).join('')}</ul></div>`).join('');
  ctx.html(200, pagina({ titulo: 'Novidades', usuario: ctx.usuario, ativo: 'novidades', corpo }));
}

module.exports = { NOVIDADES, paraUsuario, ROTAS_NOVIDADES: [['GET', '/novidades', getNovidades, true]] };
