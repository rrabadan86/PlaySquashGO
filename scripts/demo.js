#!/usr/bin/env node
/**
 * Dados de DEMONSTRAÇÃO (DEP-09): professores, quadras, grade e uma semana de aulas com nomes
 * fictícios, para o kickoff e para a homologação. Recusa banco que já tenha contatos ou aulas
 * (nunca mistura com dados reais). Os e-mails são do domínio reservado .invalid.
 *
 *   DATABASE_URL=... DEMO_SENHA='...' node scripts/demo.js
 */
const { criarPool, tx } = require('../src/db');
const { aplicar } = require('./migrar');
const senha = require('../src/auth/senha');
const { registrar } = require('../src/historico');
const fila = require('../src/agenda/fila');
const { hojeSP, somarDias, diaSemana, instanteSP } = require('../src/relogio');
const { carregarFeriados } = require('../src/rotinas');

const SISTEMA = { tipo: 'sistema', id: null };
const NOMES = ['Ana Souza', 'Bruno Lima', 'Carla Mendes', 'Diego Ramos', 'Eduarda Pires', 'Felipe Rocha', 'Gabriela Teles',
  'Helena Prado', 'Igor Matos', 'Júlia Martins', 'Lucas Barros', 'Marina Couto', 'Nicolas Freitas', 'Olívia Duarte',
  'Paulo Neves', 'Renata Dias', 'Sérgio Alves', 'Tatiana Lopes', 'Vitor Nunes', 'Bianca Costa', 'Gustavo Melo',
  'Laura Dias', 'Marcos Pereira', 'Rafael Lima', 'Camila Reis', 'Tiago Moura', 'Lia Santos', 'Pedro Alves'];

// Gerador pseudoaleatório fixo: a demonstração sai igual toda vez.
function aleatorio(semente) { let x = semente; return () => { x = (x * 1103515245 + 12345) % 2147483648; return x / 2147483648; }; }

async function bancoVazio(c) {
  const { rows } = await c.query('SELECT (SELECT count(*) FROM contato) + (SELECT count(*) FROM aula) AS n');
  return Number(rows[0].n) === 0;
}

async function gerarDemo(c, { senhaDemo, hoje = hojeSP() }) {
  if (!(await bancoVazio(c))) throw new Error('Este banco já tem contatos ou aulas: a demonstração só entra em banco vazio (DEP-09).');
  const r = aleatorio(20261125);
  const usuario = async (nome, email, admin) => (await c.query(
    `INSERT INTO usuario (nome, email, eh_admin, eh_professor, senha_hash) VALUES ($1,$2,$3,true,$4)
     ON CONFLICT (email) DO UPDATE SET nome = EXCLUDED.nome RETURNING id`, [nome, email, admin, senha.gerarHash(senhaDemo)])).rows[0].id;
  const gui = await usuario('Guilherme (demonstração)', 'guilherme@playsquash-demo.invalid', true);
  const fra = await usuario('Francisco (demonstração)', 'francisco@playsquash-demo.invalid', false);
  await c.query(`INSERT INTO usuario_tela VALUES ($1,'grade') ON CONFLICT DO NOTHING`, [fra]);

  const q1 = (await c.query(`INSERT INTO quadra (nome) VALUES ('Quadra 1') RETURNING id`)).rows[0].id;
  const q2 = (await c.query(`INSERT INTO quadra (nome) VALUES ('Quadra 2') RETURNING id`)).rows[0].id;
  await fila.quadraCriada(c, q1); await fila.quadraCriada(c, q2);
  const tipo = async (nome, cat, dur, n) => (await c.query(
    'INSERT INTO tipo_aula (nome, categoria, duracao_min, alunos_por_aula) VALUES ($1,$2,$3,$4) RETURNING id', [nome, cat, dur, n])).rows[0].id;
  const ind = await tipo('Individual', 'individual', 30, 1);
  const dup = await tipo('Dupla', 'dupla', 30, 2);
  const kids = await tipo('Kids', 'kids', 30, 1);
  const ind60 = await tipo('Individual 60 min', 'individual', 60, 1);

  const faixa = async (q, dia, ini, fim, prof) => {
    const id = (await c.query(
      `INSERT INTO grade_faixa (quadra_id, dia_semana, inicio, fim, professor_id, vigente_desde) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [q, dia, ini, fim, prof, somarDias(hoje, -30)])).rows[0].id;
    for (const t of [ind, dup, kids, ind60]) await c.query('INSERT INTO grade_faixa_tipo VALUES ($1,$2)', [id, t]);
  };
  for (let d = 1; d <= 5; d++) {
    await faixa(q1, d, '06:30', '12:00', gui); await faixa(q1, d, '16:00', '20:30', gui);
    await faixa(q2, d, '16:00', '21:00', fra);
  }
  await faixa(q1, 6, '08:00', '12:00', gui);
  await fila.conferirCompartilhamentos(c);
  await carregarFeriados(c, Number(hoje.slice(0, 4)));

  const contatos = [];
  for (const [i, nome] of NOMES.entries()) {
    contatos.push((await c.query(
      `INSERT INTO contato (nome, telefone, tipo, origem) VALUES ($1,$2,$3,'demonstração') RETURNING id`,
      [nome, `+55629000${String(10000 + i).slice(1)}`, i < 22 ? 'aluno' : 'lead'])).rows[0].id);
  }

  // Semana atual (segunda a sábado) e a próxima: ~55% dos horários ocupados.
  const seg = somarDias(hoje, -((diaSemana(hoje) + 6) % 7));
  const faixas = (await c.query(`SELECT quadra_id, dia_semana, to_char(inicio,'HH24:MI') i, to_char(fim,'HH24:MI') f, professor_id FROM grade_faixa`)).rows;
  let aulas = 0;
  for (let d = 0; d < 13; d++) {
    const dia = somarDias(seg, d);
    for (const f of faixas.filter(x => x.dia_semana === diaSemana(dia))) {
      for (let t = instanteSP(dia, f.i); t + 1800000 <= instanteSP(dia, f.f); t += 1800000) {
        if (r() > 0.55) continue;
        const sorte = r();
        const [tp, dur, origem, n] = sorte < 0.12 ? [dup, 30, 'fixa', 2] : sorte < 0.2 ? [ind60, 60, 'fixa', 1]
          : sorte < 0.28 ? [ind, 30, 'experimental', 1] : sorte < 0.36 ? [ind, 30, 'reposicao', 1]
            : sorte < 0.42 ? [kids, 30, 'fixa', 1] : [ind, 30, 'fixa', 1];
        const fim = t + dur * 60000;
        if (fim > instanteSP(dia, f.f)) continue;
        const situacao = origem === 'experimental' && r() < 0.6 ? 'confirmada' : 'marcada';
        let a;
        try {
          await c.query('SAVEPOINT aula');
          a = (await c.query(
            `INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem, situacao)
             VALUES ($1,$2,$3,tstzrange(to_timestamp($4/1000.0), to_timestamp($5/1000.0)),$6,$7) RETURNING id`,
            [f.quadra_id, f.professor_id, tp, t, fim, origem, situacao])).rows[0].id;
          await c.query('RELEASE SAVEPOINT aula');
        } catch (e) {
          await c.query('ROLLBACK TO SAVEPOINT aula'); // horário já ocupado por aula de 60 min
          continue;
        }
        const pool = origem === 'experimental' ? contatos.slice(22) : contatos.slice(0, 22);
        const escolhidos = new Set();
        while (escolhidos.size < n) escolhidos.add(pool[Math.floor(r() * pool.length)]);
        for (const ct of escolhidos) await c.query('INSERT INTO aula_participante (aula_id, contato_id) VALUES ($1,$2)', [a, ct]);
        await fila.aulaMudou(c, a, 'criar');
        aulas++;
      }
    }
  }
  const quinta = somarDias(seg, 3);
  await c.query(`INSERT INTO bloqueio (quadra_id, periodo, motivo, criado_por)
    VALUES ($1, tstzrange(to_timestamp($2/1000.0), to_timestamp($3/1000.0)), 'Manutenção da quadra', $4)`,
  [q2, instanteSP(quinta, '19:00'), instanteSP(quinta, '20:00'), gui]);
  const canceladas = (await c.query(`UPDATE aula SET situacao = 'cancelada', cancelada_motivo = 'Manutenção da quadra'
    WHERE quadra_id = $1 AND periodo && tstzrange(to_timestamp($2/1000.0), to_timestamp($3/1000.0)) RETURNING id`,
  [q2, instanteSP(quinta, '19:00'), instanteSP(quinta, '20:00')])).rows;
  for (const x of canceladas) await fila.aulaMudou(c, x.id, 'apagar');
  await registrar(c, { ator: SISTEMA, origem: 'sistema', acao: 'demo.gerada', entidade: 'demonstracao', depois: { aulas, contatos: contatos.length }, motivo: 'dados de demonstração' });
  return { aulas, contatos: contatos.length, emails: ['guilherme@playsquash-demo.invalid', 'francisco@playsquash-demo.invalid'] };
}

async function main() {
  if (!senha.senhaValida(process.env.DEMO_SENHA)) throw new Error(`Defina DEMO_SENHA com pelo menos ${senha.MINIMO} caracteres.`);
  const pool = criarPool();
  try {
    const c0 = await pool.connect(); try { await aplicar(c0); } finally { c0.release(); }
    const r = await tx(pool, c => gerarDemo(c, { senhaDemo: process.env.DEMO_SENHA }));
    console.log(`Demonstração criada: ${r.aulas} aulas, ${r.contatos} contatos. Entre com ${r.emails.join(' ou ')}.`);
  } finally { await pool.end(); }
}

if (require.main === module) main().catch(e => { console.error(e.message); process.exit(1); });

module.exports = { gerarDemo };
