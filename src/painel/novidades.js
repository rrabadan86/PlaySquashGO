/**
 * Novidades do painel (DEP-05): o que mudou em cada versão, em linguagem de quem usa.
 * Mudança que o dono ou os professores vão notar → item novo no topo desta lista.
 * "para": 'todos' ou 'admin' (professor só vê o que vale para ele).
 */
const { esc, pagina } = require('./html');

const NOVIDADES = [
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
