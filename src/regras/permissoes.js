/**
 * Quem pode o quê no painel (PER-01, PER-02, PER-03, AGD-02). Conferido no servidor em toda rota.
 *
 * - Administrador: tudo.
 * - Professor: só as telas que o admin liberou (usuario_tela); nunca altera grade/cadastros,
 *   usuários, nem vê valores ou caixa. Por padrão recebe a tela "grade".
 */
const TELAS = {
  grade: 'Grade do dia',
  cadastros: 'Quadras e professores',
  usuarios: 'Usuários',
  historico: 'Histórico',
};
const TELAS_PROFESSOR_PADRAO = ['grade'];
// Telas que o admin pode liberar a um professor (as outras são só de admin).
const TELAS_LIBERAVEIS = ['grade', 'cadastros'];

function temTela(u, tela) {
  if (!u) return false;
  if (u.eh_admin) return true;
  return !!u.eh_professor && Array.isArray(u.telas) && u.telas.includes(tela);
}

// ação → regra
const ACOES = {
  'grade.ver': u => temTela(u, 'grade'),
  'cadastros.ver': u => temTela(u, 'cadastros'),
  'cadastros.editar': u => !!u.eh_admin, // AGD-02
  'usuarios.ver': u => !!u.eh_admin,
  'usuarios.editar': u => !!u.eh_admin, // PER-01
  'historico.ver': u => !!u.eh_admin,
  'valores.ver': u => !!u.eh_admin, // PER-02
};

function pode(u, acao) {
  const regra = ACOES[acao];
  if (!regra) throw new Error(`ação desconhecida: ${acao}`);
  return !!u && regra(u);
}

module.exports = { TELAS, TELAS_PROFESSOR_PADRAO, TELAS_LIBERAVEIS, ACOES, pode, temTela };
