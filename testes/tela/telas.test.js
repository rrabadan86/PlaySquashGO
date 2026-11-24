/**
 * Teste de telas (TST-03, VIS-06): cada tela no computador (1366 px) e no celular (390 px),
 * com dados de teste. Reprova: erro de JavaScript, status ≠ 200, texto "undefined/NaN/null"
 * e rolagem lateral da página. Prints na pasta temporária ps-telas-... (apagada pelo hook depois de 2 h).
 *
 * Precisa de DATABASE_URL_TESTE e do Playwright; sem eles, pula.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { URL_TESTE, SENHA, prepararBanco, criarUsuario, subirPainel } = require('../ajuda');

let playwright = null;
try { playwright = require('playwright'); } catch (_) {}
const opc = { skip: !URL_TESTE ? 'sem DATABASE_URL_TESTE' : !playwright ? 'sem playwright' : false };

// Telas do painel (TST-03): tela nova entra aqui.
const TELAS = ['/grade?data=2026-12-01', '/cadastros', '/usuarios', '/historico'];
const TAMANHOS = [{ nome: 'computador', width: 1366, height: 900 }, { nome: 'celular', width: 390, height: 844 }];

let pool, painel, navegador, pasta;

before(async () => {
  if (opc.skip) return;
  pool = await prepararBanco();
  const g = await criarUsuario(pool, { nome: 'Guilherme', email: 'admin@teste.local', admin: true, telas: [] });
  const f = await criarUsuario(pool, { nome: 'Francisco', email: 'prof@teste.local' });
  const q1 = (await pool.query(`INSERT INTO quadra (nome) VALUES ('Quadra 1') RETURNING id`)).rows[0].id;
  const q2 = (await pool.query(`INSERT INTO quadra (nome) VALUES ('Quadra 2') RETURNING id`)).rows[0].id;
  const t = (await pool.query(`INSERT INTO tipo_aula (nome, categoria) VALUES ('Individual','individual') RETURNING id`)).rows[0].id;
  for (const [q, p] of [[q1, g], [q2, f]]) {
    const fx = (await pool.query(`INSERT INTO grade_faixa (quadra_id, dia_semana, inicio, fim, professor_id, vigente_desde) VALUES ($1,2,'16:00','20:30',$2,'2026-11-01') RETURNING id`, [q, p])).rows[0].id;
    await pool.query('INSERT INTO grade_faixa_tipo VALUES ($1,$2)', [fx, t]);
  }
  const ct = (await pool.query(`INSERT INTO contato (nome, telefone, tipo) VALUES ('Ana Souza','+5562900000001','aluno') RETURNING id`)).rows[0].id;
  const a = (await pool.query(`INSERT INTO aula (quadra_id, professor_id, tipo_aula_id, periodo, origem) VALUES ($1,$2,$3,tstzrange('2026-12-01 16:00-03','2026-12-01 17:00-03'),'fixa') RETURNING id`, [q1, g, t])).rows[0].id;
  await pool.query('INSERT INTO aula_participante (aula_id, contato_id) VALUES ($1,$2)', [a, ct]);
  await pool.query(`INSERT INTO bloqueio (quadra_id, periodo, motivo) VALUES ($1, tstzrange('2026-12-01 19:00-03','2026-12-01 20:00-03'), 'Manutenção')`, [q2]);
  await pool.query(`INSERT INTO historico (ator_tipo, ator_id, origem, acao, entidade, depois) VALUES ('admin',$1,'painel','quadra.criada','quadra','{"nome":"Quadra 1"}')`, [g]);
  painel = await subirPainel(pool);
  navegador = await playwright.chromium.launch();
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-telas-'));
});

after(async () => {
  if (navegador) await navegador.close();
  if (painel) await painel.fechar();
  if (pool) await pool.end();
});

for (const tam of TAMANHOS) {
  test(`VIS-06 telas do painel no ${tam.nome} (${tam.width} px): sem erro, sem rolagem lateral, sem "undefined"`, opc, async () => {
    const ctx = await navegador.newContext({ viewport: { width: tam.width, height: tam.height }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo' });
    const pag = await ctx.newPage();
    const errosJs = [];
    pag.on('pageerror', e => errosJs.push(e.message));
    await pag.goto(painel.base + '/login');
    await pag.fill('input[name=email]', 'admin@teste.local');
    await pag.fill('input[name=senha]', SENHA);
    await Promise.all([pag.waitForURL('**/grade'), pag.click('button:has-text("Entrar")')]);
    for (const tela of TELAS) {
      const r = await pag.goto(painel.base + tela);
      assert.equal(r.status(), 200, tela);
      const { texto, largura, janela } = await pag.evaluate(() => ({
        texto: document.body.innerText, largura: document.documentElement.scrollWidth, janela: window.innerWidth,
      }));
      assert.doesNotMatch(texto, /\bundefined\b|\bNaN\b|\bnull\b/, `${tela}: texto quebrado`);
      assert.doesNotMatch(texto, /\((?:[A-Z]{3}-\d{2}[a-z]?)(?:[,/ ][^)]*)?\)/, `${tela}: código interno de regra aparecendo na tela`);
      assert.ok(largura <= janela, `${tela}: rolagem lateral (${largura} > ${janela})`);
      await pag.screenshot({ path: path.join(pasta, `${tam.nome}${tela.replace(/[/?=]/g, '_')}.png`), fullPage: true });
    }
    assert.deepEqual(errosJs, []);
    await ctx.close();
  });
}
