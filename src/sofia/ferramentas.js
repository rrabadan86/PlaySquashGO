/**
 * Ferramentas da Sofia: o que a IA pode fazer no sistema. Cada uma roda numa transação própria,
 * grava histórico (ator 'sofia', origem 'whatsapp', só IDs — DAD-07) e devolve um texto curto
 * para a IA. Erro de regra volta como { erro } para a IA explicar ao lead; nunca derruba a conversa.
 *
 * SOF-02 salvar_dados · SOF-04 ver_horarios · SOF-05/06/07 marcar_experimental ·
 * SOF-08 remarcar_experimental · SOF-11 entrar_lista_espera · SOF-10 enviar_anexo ·
 * SOF-09 chamar_humano.
 * SOF-03 (quem já jogou paga a experimental) está ⏳ kickoff: a Sofia NÃO fala de valor nem
 * cobra; a marcação segue e o professor/admin recebe o aviso "já jogou" para combinar.
 */
const { tx } = require('../db');
const { registrar } = require('../historico');
const { lerRegras } = require('../config');
const { livresDoDia } = require('../agenda/livres');
const fila = require('../agenda/fila');
const { enfileirar } = require('../whatsapp/envio');
const { normalizar } = require('../whatsapp/telefone');
const { agendaConfirmacao } = require('../regras/confirmacao');
const { agora, dataSP, hojeSP, somarDias, diaSemana, instanteSP } = require('../relogio');
const { chaveNome, dataValida, periodo, DIAS } = require('./texto');
const confirmacao = require('./confirmacao');

const SOFIA = { tipo: 'sofia', id: null };
const ORIGEM = 'whatsapp';

class ErroRegra extends Error {}
const recusar = msg => { throw new ErroRegra(msg); };

const hhmm = ms => new Date(ms).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' });
const dataBR = iso => iso.split('-').reverse().join('/');
const quando = ms => { const d = dataSP(ms); return `${DIAS[diaSemana(d)]}, ${dataBR(d).slice(0, 5)} às ${hhmm(ms)}`; };

// ───────────── Definições (JSON Schema) que a IA enxerga ─────────────
const DEFINICOES = [
  {
    name: 'salvar_dados',
    description: 'Guarda o que o lead contou sobre ele mesmo (SOF-02). Chame assim que souber o nome ou se já jogou squash.',
    input_schema: {
      type: 'object', additionalProperties: false,
      properties: {
        nome: { type: 'string', description: 'Nome da pessoa que está conversando.' },
        ja_jogou: { type: 'boolean', description: 'Já jogou squash antes?' },
      },
    },
  },
  {
    name: 'ver_horarios',
    description: 'Busca até 3 horários livres para a aula experimental, próximos da preferência do lead (SOF-04). Não reserva nada.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['pessoas'],
      properties: {
        pessoas: { type: 'integer', enum: [1, 2], description: '1 = individual, 2 = em dupla.' },
        dias_semana: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 6 }, description: 'Dias preferidos: 0=domingo … 6=sábado. Vazio = qualquer dia.' },
        periodo: { type: 'string', enum: ['manha', 'tarde', 'noite', 'qualquer'] },
        a_partir_de: { type: 'string', description: 'Data AAAA-MM-DD a partir da qual procurar (opcional).' },
      },
    },
  },
  {
    name: 'marcar_experimental',
    description: 'Marca a aula experimental no horário escolhido (código vindo de ver_horarios). Trava a vaga, cria a aula e avisa o professor (SOF-05). Cada participante precisa de nome e data de nascimento (SOF-06); em dupla, o parceiro precisa de telefone (SOF-07).',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['codigo', 'participantes'],
      properties: {
        codigo: { type: 'string', description: 'Código do horário, exatamente como veio de ver_horarios.' },
        participantes: {
          type: 'array', minItems: 1, maxItems: 2,
          items: {
            type: 'object', additionalProperties: false, required: ['nome', 'data_nascimento', 'eh_quem_conversa'],
            properties: {
              nome: { type: 'string' },
              data_nascimento: { type: 'string', description: 'AAAA-MM-DD' },
              eh_quem_conversa: { type: 'boolean', description: 'true se o participante é a própria pessoa que está conversando.' },
              telefone: { type: 'string', description: 'WhatsApp do participante (obrigatório para o parceiro da dupla).' },
            },
          },
        },
      },
    },
  },
  {
    name: 'remarcar_experimental',
    description: 'Troca uma experimental já marcada por este lead para outro horário (código de ver_horarios). Libera o horário antigo (SOF-08). Se o lead tiver mais de uma marcada (ex.: dois filhos), informe aula_id.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['codigo'],
      properties: {
        codigo: { type: 'string' },
        aula_id: { type: 'integer', description: 'Qual experimental trocar (ver "Experimentais marcadas" no contexto).' },
      },
    },
  },
  {
    name: 'registrar_confirmacao',
    description: 'Registra a resposta do lead ao pedido de confirmação da experimental (CNF-02/03): "confirmou" ou "nao_vai". Use só quando a resposta for clara; se houver dúvida, pergunte de novo ou chame chamar_humano.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['aula_id', 'resposta'],
      properties: {
        aula_id: { type: 'integer', description: 'A aula (ver "Experimentais marcadas" no contexto).' },
        resposta: { type: 'string', enum: ['confirmou', 'nao_vai'] },
      },
    },
  },
  {
    name: 'entrar_lista_espera',
    description: 'Põe o lead na lista de espera de um horário que ele queria e está cheio (SOF-11). Se a vaga abrir, ele é avisado.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['data', 'hora'],
      properties: {
        data: { type: 'string', description: 'AAAA-MM-DD' },
        hora: { type: 'string', description: 'HH:MM' },
      },
    },
  },
  {
    name: 'enviar_anexo',
    description: 'Manda ao lead um dos anexos cadastrados (imagem ou PDF) quando ele pedir (SOF-10).',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['anexo_id'],
      properties: { anexo_id: { type: 'integer' } },
    },
  },
  {
    name: 'chamar_humano',
    description: 'Passa a conversa para a equipe e para de responder neste contato (SOF-09). Use quando não souber responder, quando o lead pedir uma pessoa, reclamar, ou quando uma regra impedir a marcação.',
    input_schema: {
      type: 'object', additionalProperties: false, required: ['motivo'],
      properties: { motivo: { type: 'string', description: 'Resumo curto para a equipe.' } },
    },
  },
];

// ───────────── Apoio ─────────────
async function tipoExperimental(c) {
  return (await c.query(`SELECT * FROM tipo_aula WHERE categoria = 'experimental' ORDER BY id LIMIT 1`)).rows[0] || null;
}

async function nomesDe(c) {
  const quadras = new Map((await c.query('SELECT id, nome FROM quadra')).rows.map(q => [q.id, q.nome]));
  const profs = new Map((await c.query('SELECT id, nome FROM usuario')).rows.map(u => [u.id, u.nome]));
  return { quadras, profs };
}

const lerCodigo = codigo => {
  const m = String(codigo || '').match(/^(\d+)-(\d{10,})$/);
  if (!m) recusar('Código de horário inválido. Use ver_horarios de novo.');
  return { quadraId: Number(m[1]), inicio: Number(m[2]) };
};

async function confirmaLivre(c, tipo, { quadraId, inicio }, pessoas, regras) {
  const antecedenciaMin = Number(regras['marcar.antecedencia_min.experimental'] ?? 180);
  const livres = await livresDoDia(c, dataSP(inicio), { id: tipo.id, duracaoMin: tipo.duracao_min, alunosPorAula: tipo.alunos_por_aula }, { antecedenciaMin });
  // A experimental não divide a quadra com outra aula: só horário vazio (vagas = capacidade).
  const l = livres.find(x => x.quadraId === quadraId && x.inicio === inicio && x.vagas >= Math.max(pessoas, tipo.alunos_por_aula));
  if (!l) recusar('Esse horário não está mais livre. Chame ver_horarios e ofereça outros.');
  return l;
}

// Experimentais ativas e futuras marcadas por este lead (um responsável pode marcar para dois filhos).
async function experimentaisAtivas(c, contatoId) {
  return (await c.query(
    `SELECT a.*, extract(epoch FROM lower(a.periodo))*1000 AS inicio_ms FROM aula a
      WHERE a.marcada_por_contato_id = $1 AND a.origem = 'experimental' AND a.situacao <> 'cancelada'
        AND upper(a.periodo) > to_timestamp($2/1000.0)
      ORDER BY lower(a.periodo) FOR UPDATE`, [contatoId, agora()])).rows;
}

// SOF-06: esta pessoa (nome + nascimento) já teve experimental? Devolve a liberação a usar, se houver.
async function conferirUmaExperimental(c, { nome, nascimento }, ignorarAulaId = null) {
  const chave = chaveNome(nome);
  const ja = (await c.query(
    `SELECT ct.nome FROM aula_participante p JOIN contato ct ON ct.id = p.contato_id JOIN aula a ON a.id = p.aula_id
      WHERE a.origem = 'experimental' AND a.situacao <> 'cancelada' AND p.situacao = 'ativo'
        AND ct.data_nascimento = $1 AND ($2::bigint IS NULL OR a.id <> $2)`, [nascimento, ignorarAulaId])).rows
    .some(r => chaveNome(r.nome) === chave);
  if (!ja) return { ok: true, liberacaoId: null };
  const lib = (await c.query(
    `SELECT id FROM experimental_liberacao WHERE nome_chave = $1 AND data_nascimento = $2 AND usada_aula_id IS NULL
      ORDER BY id LIMIT 1 FOR UPDATE`, [chave, nascimento])).rows[0];
  return lib ? { ok: true, liberacaoId: lib.id } : { ok: false };
}

// Participante → contato (o próprio lead, alguém pelo telefone, ou um contato novo — criança sem telefone).
async function contatoDoParticipante(c, p, lead) {
  if (p.eh_quem_conversa) {
    await c.query('UPDATE contato SET nome = $2, data_nascimento = $3 WHERE id = $1', [lead.id, p.nome, p.nascimento]);
    return lead.id;
  }
  if (p.telefone) {
    const ex = (await c.query('SELECT id, nome FROM contato WHERE telefone = $1', [p.telefone])).rows[0];
    if (ex) {
      await c.query('UPDATE contato SET nome = COALESCE(nome, $2), data_nascimento = COALESCE(data_nascimento, $3) WHERE id = $1', [ex.id, p.nome, p.nascimento]);
      return ex.id;
    }
  }
  const novo = (await c.query(
    `INSERT INTO contato (nome, telefone, data_nascimento, tipo, origem) VALUES ($1,$2,$3,'lead','sofia') RETURNING id`,
    [p.nome, p.telefone || null, p.nascimento])).rows[0];
  await registrar(c, { ator: SOFIA, origem: ORIGEM, acao: 'contato.criado', entidade: 'contato', entidadeId: novo.id, depois: { tipo: 'lead', origem: 'sofia', indicado_por: lead.id } });
  return novo.id;
}

// Cria a aula experimental travando a vaga no banco (SOF-05; a trava contra sobreposição é do banco).
async function criarAula(c, { tipo, livre, lead, contatos, regras }) {
  const fim = livre.inicio + tipo.duracao_min * 60000;
  const conf = agendaConfirmacao({ inicioAula: livre.inicio, marcadaEm: agora() }, { pedidoHora: String(regras['confirmacao.pedido_hora'] || '19:00') });
  const aula = (await c.query(
    `INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem, situacao, marcada_por_contato_id)
     VALUES ($1,$2,$3,tstzrange(to_timestamp($4/1000.0), to_timestamp($5/1000.0)),'experimental',$6,$7) RETURNING id`,
    [livre.quadraId, livre.professorId, tipo.id, livre.inicio, fim, conf.nasceConfirmada ? 'confirmada' : 'marcada', lead.id])).rows[0];
  for (const id of contatos) {
    await c.query('INSERT INTO aula_participante (aula_id, contato_id, confirmacao) VALUES ($1,$2,$3)', [aula.id, id, conf.nasceConfirmada ? 'confirmou' : null]);
  }
  await fila.aulaMudou(c, aula.id, 'criar');
  await confirmacao.vagaPreenchida(c, { inicio: livre.inicio, marcouContatoIds: [lead.id, ...contatos] }); // LES-02
  return { aulaId: aula.id, nasceConfirmada: conf.nasceConfirmada };
}

async function avisarProfessor(c, { professorId, chave, texto }) {
  await enfileirar(c, { usuarioId: professorId, tipo: 'professor', texto, chaveUnica: chave });
}

// ───────────── Execução ─────────────
const EXECUTAR = {
  async salvar_dados(c, ctx, e) {
    const campos = {};
    if (typeof e.nome === 'string' && e.nome.trim()) campos.nome = e.nome.trim().slice(0, 80);
    if (typeof e.ja_jogou === 'boolean') campos.ja_jogou = e.ja_jogou;
    if (!Object.keys(campos).length) return { ok: true };
    const sets = Object.keys(campos).map((k, i) => `${k} = $${i + 2}`).join(', ');
    await c.query(`UPDATE contato SET ${sets} WHERE id = $1`, [ctx.contatoId, ...Object.values(campos)]);
    await registrar(c, { ator: SOFIA, origem: ORIGEM, acao: 'contato.dados_sofia', entidade: 'contato', entidadeId: ctx.contatoId, depois: { campos: Object.keys(campos) } });
    return { ok: true };
  },

  async ver_horarios(c, ctx, e) {
    const tipo = await tipoExperimental(c);
    if (!tipo) recusar('Não há tipo de aula experimental cadastrado. Chame chamar_humano.');
    const regras = await lerRegras(c);
    const pessoas = e.pessoas === 2 ? 2 : 1;
    if (pessoas > tipo.alunos_por_aula) recusar('A experimental em dupla não está disponível no cadastro atual. Chame chamar_humano.');
    const antecedenciaMin = Number(regras['marcar.antecedencia_min.experimental'] ?? 180);
    const maxDias = Number(regras['marcar.antecedencia_max_dias'] ?? 14);
    const dias = Array.isArray(e.dias_semana) && e.dias_semana.length ? e.dias_semana : null;
    const per = ['manha', 'tarde', 'noite'].includes(e.periodo) ? e.periodo : null;
    const desde = dataValida(e.a_partir_de);
    const hoje = hojeSP();
    const { quadras, profs } = await nomesDe(c);
    const achados = [];
    for (let i = 0; i <= maxDias && new Set(achados.map(a => a.dia)).size < 3; i++) {
      const d = somarDias(hoje, i);
      if (desde && d < desde) continue;
      if (dias && !dias.includes(diaSemana(d))) continue;
      const livres = await livresDoDia(c, d, { id: tipo.id, duracaoMin: tipo.duracao_min, alunosPorAula: tipo.alunos_por_aula }, { antecedenciaMin });
      for (const l of livres) {
        if (l.vagas < tipo.alunos_por_aula) continue; // só horário vazio (ver confirmaLivre)
        if (per && periodo(hhmm(l.inicio)) !== per) continue;
        achados.push({ ...l, dia: d });
      }
    }
    // Até 3, espalhados em dias diferentes quando dá.
    const escolha = [];
    for (const l of achados) if (escolha.length < 3 && !escolha.some(x => x.dia === l.dia)) escolha.push(l);
    for (const l of achados) if (escolha.length < 3 && !escolha.includes(l)) escolha.push(l);
    escolha.sort((a, b) => a.inicio - b.inicio);
    if (!escolha.length) return { horarios: [], aviso: 'Nenhum horário livre com essa preferência. Ofereça outra preferência ou a lista de espera.' };
    return {
      horarios: escolha.map(l => ({ codigo: `${l.quadraId}-${l.inicio}`, quando: quando(l.inicio), quadra: quadras.get(l.quadraId), professor: profs.get(l.professorId) })),
    };
  },

  async marcar_experimental(c, ctx, e) {
    const tipo = await tipoExperimental(c) || recusar('Não há tipo de aula experimental cadastrado. Chame chamar_humano.');
    const regras = await lerRegras(c);
    const lead = (await c.query('SELECT * FROM contato WHERE id = $1 FOR UPDATE', [ctx.contatoId])).rows[0];
    const ps = (Array.isArray(e.participantes) ? e.participantes : []).slice(0, 2).map(p => ({
      nome: String(p.nome || '').trim().slice(0, 80),
      nascimento: dataValida(p.data_nascimento),
      eh_quem_conversa: !!p.eh_quem_conversa,
      telefone: p.telefone ? normalizar(p.telefone) : null,
    }));
    if (!ps.length) recusar('Informe quem vai fazer a aula.');
    for (const p of ps) {
      if (!p.nome) recusar('Falta o nome de um participante.');
      if (!p.nascimento) recusar(`Falta a data de nascimento de ${p.nome} (AAAA-MM-DD).`);
      if (ps.length === 2 && !p.eh_quem_conversa && !p.telefone) recusar(`Em dupla, peça o WhatsApp de ${p.nome} (SOF-07).`);
    }
    if (ps.filter(p => p.eh_quem_conversa).length > 1) recusar('Só um participante pode ser a pessoa que está conversando.');
    const usarLiberacao = [];
    for (const p of ps) {
      const r = await conferirUmaExperimental(c, p);
      if (!r.ok) recusar(`${p.nome} já tem ou já fez a aula experimental (1 por pessoa). Se for para trocar o horário, use remarcar_experimental; senão, explique com gentileza e chame chamar_humano se a pessoa insistir.`);
      if (r.liberacaoId) usarLiberacao.push(r.liberacaoId);
    }
    const livre = await confirmaLivre(c, tipo, lerCodigo(e.codigo), ps.length, regras);
    const contatos = [];
    for (const p of ps) contatos.push(await contatoDoParticipante(c, p, lead));
    const { aulaId, nasceConfirmada } = await criarAula(c, { tipo, livre, lead, contatos, regras });
    for (const id of usarLiberacao) await c.query('UPDATE experimental_liberacao SET usada_aula_id = $2 WHERE id = $1', [id, aulaId]);
    // LES-03: quem marca sai das listas de espera de experimental.
    await c.query(
      `UPDATE lista_espera SET saiu_em = now(), motivo_saida = 'marcou experimental'
        WHERE contato_id = ANY($1) AND tipo = 'experimental' AND saiu_em IS NULL`, [[lead.id, ...contatos]]);
    await registrar(c, {
      ator: SOFIA, origem: ORIGEM, acao: 'aula.marcada', entidade: 'aula', entidadeId: aulaId,
      depois: { quadra: livre.quadraId, inicio: new Date(livre.inicio).toISOString(), tipo: tipo.id, origem: 'experimental', marcada_por: lead.id, participantes: contatos, liberacoes: usarLiberacao },
    });
    const { quadras, profs } = await nomesDe(c);
    const fresco = (await c.query('SELECT nome, telefone, ja_jogou FROM contato WHERE id = $1', [lead.id])).rows[0];
    await avisarProfessor(c, {
      professorId: livre.professorId, chave: `prof-exp:${aulaId}`,
      texto: `Nova aula experimental: ${quando(livre.inicio)}, ${quadras.get(livre.quadraId)}.\n`
        + `${ps.map(p => p.nome).join(' e ')} · contato ${fresco.telefone || '—'}`
        + (fresco.ja_jogou ? '\nJá jogou squash: combinar o pagamento da experimental (regra ainda em definição).' : ''),
    });
    return {
      ok: true, quando: quando(livre.inicio), quadra: quadras.get(livre.quadraId), professor: profs.get(livre.professorId),
      confirmada: nasceConfirmada,
    };
  },

  async remarcar_experimental(c, ctx, e) {
    const tipo = await tipoExperimental(c) || recusar('Não há tipo de aula experimental cadastrado.');
    const regras = await lerRegras(c);
    const lead = (await c.query('SELECT * FROM contato WHERE id = $1 FOR UPDATE', [ctx.contatoId])).rows[0];
    const ativas = await experimentaisAtivas(c, lead.id);
    if (!ativas.length) recusar('Não achei experimental marcada por este lead. Para marcar, use marcar_experimental.');
    const velha = e.aula_id ? ativas.find(a => a.id === Number(e.aula_id)) : ativas.length === 1 ? ativas[0] : null;
    if (!velha) recusar('Este lead tem mais de uma experimental marcada: informe aula_id de qual trocar.');
    const contatos = (await c.query(`SELECT contato_id FROM aula_participante WHERE aula_id = $1 AND situacao = 'ativo' ORDER BY id`, [velha.id])).rows.map(r => r.contato_id);
    // Libera o antigo antes de travar o novo (o novo pode até encostar no antigo).
    await c.query(`UPDATE aula SET situacao = 'cancelada', cancelada_motivo = 'remarcada pelo lead' WHERE id = $1`, [velha.id]);
    await fila.aulaMudou(c, velha.id, 'apagar');
    const livre = await confirmaLivre(c, tipo, lerCodigo(e.codigo), contatos.length, regras);
    const { aulaId, nasceConfirmada } = await criarAula(c, { tipo, livre, lead, contatos, regras });
    if (livre.inicio !== Number(velha.inicio_ms) || livre.quadraId !== velha.quadra_id) {
      await confirmacao.vagaLiberada(c, { quadraId: velha.quadra_id, inicio: Number(velha.inicio_ms) }); // LES-02
    }
    await registrar(c, { ator: SOFIA, origem: ORIGEM, acao: 'aula.remarcada', entidade: 'aula', entidadeId: velha.id, antes: { situacao: velha.situacao }, depois: { situacao: 'cancelada', nova_aula: aulaId }, motivo: 'remarcada pelo lead' });
    await registrar(c, { ator: SOFIA, origem: ORIGEM, acao: 'aula.marcada', entidade: 'aula', entidadeId: aulaId, depois: { quadra: livre.quadraId, inicio: new Date(livre.inicio).toISOString(), tipo: tipo.id, origem: 'experimental', marcada_por: lead.id, participantes: contatos, remarcacao_de: velha.id } });
    const { quadras, profs } = await nomesDe(c);
    const nomes = (await c.query('SELECT nome FROM contato WHERE id = ANY($1)', [contatos])).rows.map(r => r.nome).join(' e ');
    const textoVelha = `Experimental remarcada: ${nomes} não vem mais em ${quando(Number(velha.inicio_ms))}.`;
    if (velha.professor_id !== livre.professorId) await avisarProfessor(c, { professorId: velha.professor_id, chave: `prof-exp-sai:${velha.id}`, texto: textoVelha });
    await avisarProfessor(c, {
      professorId: livre.professorId, chave: `prof-exp:${aulaId}`,
      texto: `${velha.professor_id === livre.professorId ? textoVelha + '\n' : ''}Nova aula experimental: ${quando(livre.inicio)}, ${quadras.get(livre.quadraId)}. ${nomes}.`,
    });
    return { ok: true, antes: quando(Number(velha.inicio_ms)), agora: quando(livre.inicio), quadra: quadras.get(livre.quadraId), professor: profs.get(livre.professorId), confirmada: nasceConfirmada };
  },

  async registrar_confirmacao(c, ctx, e) {
    const aulaId = Number(e.aula_id) || 0;
    const a = (await c.query(`SELECT id FROM aula WHERE id = $1 AND marcada_por_contato_id = $2 AND origem = 'experimental'`, [aulaId, ctx.contatoId])).rows[0];
    if (!a) recusar('Aula não encontrada para este lead. Veja "Experimentais marcadas" no contexto.');
    const r = await confirmacao.registrarResposta(c, { aulaId, resposta: e.resposta, ator: SOFIA });
    if (!r.ok) recusar(r.motivo);
    return r.resposta === 'nao_vai' ? { ok: true, cancelada: true, proximo_passo: 'Ofereça outra data com ver_horarios.' } : { ok: true, confirmada: true };
  },

  async entrar_lista_espera(c, ctx, e) {
    const d = dataValida(e.data) || recusar('Data inválida (AAAA-MM-DD).');
    if (!/^\d{2}:\d{2}$/.test(String(e.hora || ''))) recusar('Hora inválida (HH:MM).');
    const inicio = instanteSP(d, e.hora);
    if (inicio <= agora()) recusar('Esse horário já passou.');
    const ja = (await c.query(
      `SELECT id FROM lista_espera WHERE contato_id = $1 AND tipo = 'experimental' AND inicio = to_timestamp($2/1000.0) AND saiu_em IS NULL`, [ctx.contatoId, inicio])).rows[0];
    if (ja) return { ok: true, ja_estava: true };
    const r = (await c.query(
      `INSERT INTO lista_espera (contato_id, inicio, tipo) VALUES ($1, to_timestamp($2/1000.0), 'experimental') RETURNING id`, [ctx.contatoId, inicio])).rows[0];
    await registrar(c, { ator: SOFIA, origem: ORIGEM, acao: 'lista_espera.entrou', entidade: 'lista_espera', entidadeId: r.id, depois: { contato: ctx.contatoId, inicio: new Date(inicio).toISOString() } });
    return { ok: true, quando: quando(inicio) };
  },

  async enviar_anexo(c, ctx, e) {
    const a = (await c.query('SELECT * FROM sofia_anexo WHERE id = $1 AND ativo', [Number(e.anexo_id) || 0])).rows[0] || recusar('Anexo não encontrado.');
    const id = await enfileirar(c, { contatoId: ctx.contatoId, tipo: 'sofia', texto: a.nome, anexoId: a.id, chaveUnica: `anexo:${ctx.conversaId}:${a.id}:${ctx.mensagemId}` });
    return { ok: true, ja_enviado: !id };
  },

  async chamar_humano(c, ctx, e) {
    const motivo = String(e.motivo || 'sem motivo').slice(0, 200);
    const r = await c.query(
      `UPDATE conversa SET estado = 'humano', humano_desde = now(), humano_motivo = $2 WHERE id = $1 AND estado = 'sofia'`, [ctx.conversaId, motivo]);
    if (r.rowCount) {
      await registrar(c, { ator: SOFIA, origem: ORIGEM, acao: 'conversa.transbordo', entidade: 'conversa', entidadeId: ctx.conversaId, antes: { estado: 'sofia' }, depois: { estado: 'humano' }, motivo });
      await avisarAdmins(c, { chave: `humano:${ctx.conversaId}:${ctx.mensagemId}`, texto: `A Sofia passou uma conversa para a equipe: ${motivo}\nAbra no painel: Conversas.` });
    }
    return { ok: true };
  },
};

// Aviso a todos os administradores ativos com WhatsApp (SOF-09, falha da IA).
async function avisarAdmins(c, { chave, texto }) {
  const adms = (await c.query(`SELECT id FROM usuario WHERE eh_admin AND ativo AND telefone IS NOT NULL ORDER BY id`)).rows;
  for (const a of adms) await enfileirar(c, { usuarioId: a.id, tipo: 'professor', texto, chaveUnica: `${chave}:${a.id}` });
}

/**
 * Executa uma ferramenta pedida pela IA. Sempre devolve { conteudo, erro } (texto para a IA).
 * @param {object} ctx { pool, contatoId, conversaId, mensagemId }
 */
async function executar(ctx, nome, entrada) {
  const fn = EXECUTAR[nome];
  if (!fn) return { conteudo: `Ferramenta desconhecida: ${nome}`, erro: true };
  try {
    const r = await tx(ctx.pool, c => fn(c, ctx, entrada || {}));
    return { conteudo: JSON.stringify(r), erro: false };
  } catch (e) {
    if (e instanceof ErroRegra) return { conteudo: e.message, erro: true };
    if (e.code === '23P01') return { conteudo: 'Esse horário acabou de ser ocupado. Chame ver_horarios e ofereça outros.', erro: true };
    throw e;
  }
}

module.exports = { DEFINICOES, executar, avisarAdmins, ErroRegra };
