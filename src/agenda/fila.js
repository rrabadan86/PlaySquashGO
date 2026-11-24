/**
 * O que precisa ir para o Google Agenda entra em fila_google, na mesma transação da mudança
 * no banco (AGD-09). Quem envia é src/agenda/sincronizar.js, com nova tentativa se falhar.
 */

async function aulaMudou(c, aulaId, acao) {
  if (!['criar', 'atualizar', 'apagar'].includes(acao)) throw new Error(`ação inválida: ${acao}`);
  await c.query('INSERT INTO fila_google (aula_id, acao) VALUES ($1,$2)', [aulaId, acao]);
}

async function quadraCriada(c, quadraId) {
  await c.query(`INSERT INTO fila_google (quadra_id, acao) VALUES ($1,'criar_agenda')`, [quadraId]);
}

/**
 * Confere quem deve ver as agendas (administradores e professores ativos com e-mail, AGD-09)
 * contra o que já está compartilhado, e põe na fila o que falta compartilhar ou tirar.
 * Chamado depois de criar quadra ou mudar usuário.
 */
async function conferirCompartilhamentos(c) {
  const quadras = (await c.query('SELECT id FROM quadra WHERE ativa')).rows.map(r => r.id);
  const quer = new Set((await c.query(
    `SELECT lower(email) e FROM usuario WHERE ativo AND (eh_admin OR eh_professor) AND email IS NOT NULL`)).rows.map(r => r.e));
  const tem = (await c.query('SELECT id, quadra_id, lower(email) e FROM google_compartilhamento WHERE ate IS NULL')).rows;
  let mudancas = 0;
  for (const q of quadras) {
    const daQuadra = new Set(tem.filter(t => t.quadra_id === q).map(t => t.e));
    for (const e of quer) {
      if (daQuadra.has(e)) continue;
      await c.query('INSERT INTO google_compartilhamento (quadra_id, email) VALUES ($1,$2)', [q, e]);
      await c.query(`INSERT INTO fila_google (quadra_id, email, acao) VALUES ($1,$2,'compartilhar')`, [q, e]);
      mudancas++;
    }
  }
  for (const t of tem) {
    if (quer.has(t.e) && quadras.includes(t.quadra_id)) continue;
    await c.query('UPDATE google_compartilhamento SET ate = now() WHERE id = $1', [t.id]);
    await c.query(`INSERT INTO fila_google (quadra_id, email, acao) VALUES ($1,$2,'descompartilhar')`, [t.quadra_id, t.e]);
    mudancas++;
  }
  return mudancas;
}

// Resumo para o painel: pendentes e com erro.
async function situacao(c) {
  const { rows } = await c.query(
    `SELECT count(*) FILTER (WHERE feito_em IS NULL)::int pendentes,
            count(*) FILTER (WHERE feito_em IS NULL AND tentativas > 0)::int com_erro,
            max(erro) FILTER (WHERE feito_em IS NULL AND tentativas > 0) ultimo_erro
       FROM fila_google`);
  return rows[0];
}

module.exports = { aulaMudou, quadraCriada, conferirCompartilhamentos, situacao };
