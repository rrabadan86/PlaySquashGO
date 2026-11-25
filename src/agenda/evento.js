/**
 * Como uma aula aparece no Google Agenda (AGD-09): título padrão, cor por tipo e o id da aula
 * nas propriedades privadas. Regra pura, sem banco.
 *
 *   "Aula — Ana Souza", "Aula — Carla + Diego (dupla)", "Experimental — Rafael Lima ✓",
 *   "Reposição — Júlia Martins", "Avulsa — Pedro Alves"
 */
const NOME = { fixa: 'Aula', experimental: 'Experimental', reposicao: 'Reposição', avulsa: 'Avulsa' };
// Cores do Google Agenda (colorId): 10 verde, 6 laranja, 9 azul, 3 roxo — próximas de VIS-01.
const COR = { fixa: 10, experimental: 6, reposicao: 9, avulsa: 3, dupla: 3 };

function montarEvento({ id, origem, situacao, categoria, tipo, professor, quadra, inicio, fim, alunos = [] }) {
  const nomes = alunos.length ? alunos.join(' + ') : 'sem aluno';
  const dupla = categoria === 'dupla' && origem === 'fixa';
  const titulo = `${NOME[origem] || 'Aula'} — ${nomes}${dupla ? ' (dupla)' : ''}${situacao === 'confirmada' ? ' ✓' : ''}`;
  return {
    titulo,
    descricao: `${tipo} · Professor: ${professor} · ${quadra}\nGerado pelo sistema da Play Squash. Alterações são feitas pelo painel.`,
    inicio, fim,
    cor: COR[dupla ? 'dupla' : origem] || COR.fixa,
    privado: { aulaId: id, origem },
  };
}

// Espera antes da próxima tentativa, em minutos: 1, 5, 15, 60, 180 e depois de 6 em 6 horas.
function esperaMin(tentativas) {
  return [1, 5, 15, 60, 180][tentativas - 1] ?? 360;
}

module.exports = { montarEvento, esperaMin, COR };
