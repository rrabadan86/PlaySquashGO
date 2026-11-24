/**
 * Registro de histórico (DAD-04, OPR-07): quem, por onde, quando, o quê, antes/depois e motivo.
 * A tabela só aceita inclusão (trava no banco). Use dentro da mesma transação da mudança.
 */
const ATORES = new Set(['aluno', 'professor', 'admin', 'sofia', 'sistema']);
const ORIGENS = new Set(['app', 'painel', 'whatsapp', 'sistema']);

// Ator a partir do usuário logado no painel.
function atorDoUsuario(u) {
  if (!u) return { tipo: 'sistema', id: null };
  return { tipo: u.eh_admin ? 'admin' : 'professor', id: u.id };
}

async function registrar(c, { ator, origem = 'painel', acao, entidade, entidadeId = null, antes = null, depois = null, motivo = null }) {
  if (!ator || !ATORES.has(ator.tipo)) throw new Error('histórico: ator inválido');
  if (!ORIGENS.has(origem)) throw new Error('histórico: origem inválida');
  if (!acao || !entidade) throw new Error('histórico: ação e entidade são obrigatórias');
  await c.query(
    `INSERT INTO historico (ator_tipo, ator_id, origem, acao, entidade, entidade_id, antes, depois, motivo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [ator.tipo, ator.id ?? null, origem, acao, entidade, entidadeId,
      antes == null ? null : JSON.stringify(antes), depois == null ? null : JSON.stringify(depois), motivo],
  );
}

module.exports = { registrar, atorDoUsuario };
