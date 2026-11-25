/**
 * O que fazer com cada mensagem que chega no número da Play Squash.
 *
 * - Registra a mensagem (contato criado como lead se o número é novo).
 * - "SAIR" (OPR-03): tira das campanhas na hora e confirma.
 * - Aluno ativo ou responsável de aluno ativo (SOF-01): mensagem fixa, no máximo uma por dia;
 *   a IA não é chamada.
 * - Número de professor/admin: só registra.
 * - Conversa em atendimento humano (SOF-09): só registra.
 * - Lead: devolve 'sofia' — quem responde é a Sofia (etapa 2, parte 2).
 */
const { tx } = require('../db');
const { lerRegras } = require('../config');
const { registrar } = require('../historico');
const { normalizar, variantes } = require('./telefone');
const { pedeSair } = require('./ritmo');
const { enfileirar } = require('./envio');
const { dataSP } = require('../relogio');

const SISTEMA = { tipo: 'sistema', id: null };

async function receberMensagem(pool, { de, texto, em = Date.now() }) {
  const tel = normalizar(de);
  if (!tel) return { acao: 'ignorar', motivo: 'número inválido' };
  return tx(pool, async c => {
    const vs = variantes(tel);
    const equipe = (await c.query('SELECT id FROM usuario WHERE telefone = ANY($1) AND ativo', [vs])).rows[0];
    let ct = (await c.query('SELECT * FROM contato WHERE telefone = ANY($1) ORDER BY id LIMIT 1 FOR UPDATE', [vs])).rows[0];
    if (!ct && !equipe) {
      ct = (await c.query(`INSERT INTO contato (telefone, tipo, origem) VALUES ($1,'lead','whatsapp') RETURNING *`, [tel])).rows[0];
      await registrar(c, { ator: SISTEMA, origem: 'whatsapp', acao: 'contato.criado', entidade: 'contato', entidadeId: ct.id, depois: { tipo: 'lead', origem: 'whatsapp' } });
    }
    await c.query(
      `INSERT INTO mensagem (contato_id, usuario_id, direcao, texto, motivo, em) VALUES ($1,$2,'entrada',$3,'recebida',to_timestamp($4/1000.0))`,
      [ct ? ct.id : null, ct ? null : equipe.id, String(texto || ''), em]);
    if (!ct) return { acao: 'equipe', usuarioId: equipe.id };

    const regras = await lerRegras(c);
    const hoje = dataSP(em);
    if (pedeSair(texto)) {
      if (!ct.sem_campanha) {
        await c.query('UPDATE contato SET sem_campanha = true WHERE id = $1', [ct.id]);
        await registrar(c, { ator: SISTEMA, origem: 'whatsapp', acao: 'contato.saiu_das_campanhas', entidade: 'contato', entidadeId: ct.id, motivo: 'pediu SAIR pelo WhatsApp' });
      }
      await enfileirar(c, { contatoId: ct.id, tipo: 'aviso', texto: regras['whatsapp.mensagem_sair'], chaveUnica: `sair:${ct.id}:${hoje}` });
      return { acao: 'sair', contatoId: ct.id };
    }
    const alunoAtivo = (await c.query(
      `SELECT 1 FROM aluno WHERE (contato_id = $1 OR responsavel_contato_id = $1) AND situacao = 'ativo' LIMIT 1`, [ct.id])).rowCount > 0;
    if (alunoAtivo) {
      await enfileirar(c, { contatoId: ct.id, tipo: 'fixa', texto: regras['whatsapp.mensagem_fixa'], chaveUnica: `fixa:${ct.id}:${hoje}` });
      return { acao: 'fixa', contatoId: ct.id };
    }
    const conversa = (await c.query('SELECT * FROM conversa WHERE contato_id = $1 ORDER BY id DESC LIMIT 1', [ct.id])).rows[0];
    if (conversa && conversa.estado === 'humano') return { acao: 'humano', contatoId: ct.id, conversaId: conversa.id };
    const conv = conversa || (await c.query(`INSERT INTO conversa (contato_id) VALUES ($1) RETURNING *`, [ct.id])).rows[0];
    await c.query('UPDATE mensagem SET conversa_id = $2 WHERE contato_id = $1 AND conversa_id IS NULL', [ct.id, conv.id]);
    return { acao: 'sofia', contatoId: ct.id, conversaId: conv.id };
  });
}

module.exports = { receberMensagem };
