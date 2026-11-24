#!/usr/bin/env node
/**
 * Matriz de rastreabilidade (docs/rastreabilidade.md): regra → casos planejados → testes escritos.
 *
 *   node scripts/matriz.js             reescreve docs/rastreabilidade.md
 *   node scripts/matriz.js --conferir  só confere (sai com erro se a matriz está velha ou há código errado)
 *   node scripts/matriz.js --resumo    imprime só o resumo (markdown, para o CI)
 *
 * Fontes:
 *   - regras: linhas "- **ÁREA-NN** texto" em .claude/rules/*.md (TST-02)
 *   - casos planejados: tabela de docs/casos-de-teste.md
 *   - testes escritos: títulos de test('ÁREA-NN ...') em testes/** que começam pelo código
 * Só lê arquivos; não toca em dado nenhum. Mantém a seção "Achados" escrita à mão.
 */
const fs = require('fs');
const path = require('path');

const RAIZ = path.resolve(__dirname, '..');
const REGRAS = path.join(RAIZ, '.claude', 'rules');
const CASOS = path.join(RAIZ, 'docs', 'casos-de-teste.md');
const MATRIZ = path.join(RAIZ, 'docs', 'rastreabilidade.md');
const TESTES = path.join(RAIZ, 'testes');
const PROCESSO = new Set(['TST', 'DEP', 'DAD', 'VIS']); // regras de trabalho: sem teste vira "processo"
const COD = '[A-Z]{3}-\\d{2}[a-z]?';

function lerRegras() {
  const regras = [];
  for (const arq of fs.readdirSync(REGRAS).filter(f => f.endsWith('.md')).sort()) {
    const txt = fs.readFileSync(path.join(REGRAS, arq), 'utf8');
    const titulo = (txt.match(/^# (.+)$/m) || [, arq])[1];
    for (const m of txt.matchAll(new RegExp(`^- \\*\\*(${COD})\\*\\* (.+)$`, 'gm'))) {
      const texto = m[2].replace(/\s*_\(.*\)_\s*$/, '').trim();
      regras.push({ codigo: m[1], area: titulo, arquivo: arq, texto, kickoff: /⏳ kickoff/.test(m[2]) });
    }
  }
  return regras;
}

function lerCasos() {
  const porCodigo = {};
  if (!fs.existsSync(CASOS)) return porCodigo;
  for (const m of fs.readFileSync(CASOS, 'utf8').matchAll(new RegExp(`^\\| (CT-\\d{3}) \\| (${COD}) \\|`, 'gm'))) {
    (porCodigo[m[2]] = porCodigo[m[2]] || []).push(m[1]);
  }
  return porCodigo;
}

function arquivosTeste(pasta) {
  const out = [];
  for (const e of fs.readdirSync(pasta, { withFileTypes: true })) {
    const f = path.join(pasta, e.name);
    if (e.isDirectory()) out.push(...arquivosTeste(f));
    else if (e.name.endsWith('.test.js')) out.push(f);
  }
  return out.sort();
}

// "REP-01/REP-02 título" → ['REP-01','REP-02']
function codigosDoTitulo(titulo) {
  const m = String(titulo).match(new RegExp(`^(${COD}(?:\\/${COD})*)\\b`));
  return m ? m[1].split('/') : [];
}

function lerTestes() {
  const testes = [];
  for (const f of arquivosTeste(TESTES)) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/\btest\(\s*(['"`])(.*?)\1/g)) {
      testes.push({ arquivo: path.relative(RAIZ, f), titulo: m[2], codigos: codigosDoTitulo(m[2]) });
    }
  }
  return testes;
}

function montar() {
  const regras = lerRegras(), casos = lerCasos(), testes = lerTestes();
  const conhecidos = new Set(regras.map(r => r.codigo));
  const erros = [];
  const dup = regras.map(r => r.codigo).filter((c, i, a) => a.indexOf(c) !== i);
  if (dup.length) erros.push(`código repetido nas regras: ${[...new Set(dup)].join(', ')}`);
  for (const t of testes) for (const c of t.codigos) if (!conhecidos.has(c)) erros.push(`teste cita código inexistente ${c}: ${t.arquivo} › ${t.titulo}`);
  for (const c of Object.keys(casos)) if (!conhecidos.has(c)) erros.push(`caso de teste cita código inexistente: ${c}`);

  const linhas = regras.map(r => {
    const escritos = testes.filter(t => t.codigos.includes(r.codigo));
    const planejados = (casos[r.codigo] || []).length;
    const area = r.codigo.slice(0, 3);
    let cob;
    if (!escritos.length) cob = PROCESSO.has(area) && !planejados ? 'processo' : '❌';
    else cob = escritos.length >= planejados ? '✅' : 'parcial';
    return { ...r, escritos, planejados, cob };
  });

  const areas = [...new Set(linhas.map(l => l.area))];
  const conta = (ls, c) => ls.filter(l => l.cob === c).length;
  let resumo = '| Área | Regras | Casos planejados | Testes escritos | ✅ | parcial | ❌ | processo | ⏳ kickoff |\n|---|---|---|---|---|---|---|---|---|\n';
  for (const a of areas) {
    const ls = linhas.filter(l => l.area === a);
    resumo += `| ${a} | ${ls.length} | ${ls.reduce((s, l) => s + l.planejados, 0)} | ${ls.reduce((s, l) => s + l.escritos.length, 0)} | ${conta(ls, '✅')} | ${conta(ls, 'parcial')} | ${conta(ls, '❌')} | ${conta(ls, 'processo')} | ${ls.filter(l => l.kickoff).length} |\n`;
  }
  const tot = linhas;
  resumo += `| **Total** | ${tot.length} | ${tot.reduce((s, l) => s + l.planejados, 0)} | ${testes.filter(t => t.codigos.length).length} | ${conta(tot, '✅')} | ${conta(tot, 'parcial')} | ${conta(tot, '❌')} | ${conta(tot, 'processo')} | ${tot.filter(l => l.kickoff).length} |\n`;
  const semCodigo = testes.filter(t => !t.codigos.length);
  resumo += `\nTestes: ${testes.length} no total, ${testes.length - semCodigo.length} ligados a uma regra.`;
  if (semCodigo.length) resumo += ` Sem código no título: ${semCodigo.map(t => `\`${t.arquivo}\` › ${t.titulo}`).join('; ')}.`;

  let tabela = '';
  for (const a of areas) {
    tabela += `\n### ${a}\n\n| Código | Regra | Casos | Testes escritos | Cobertura |\n|---|---|---|---|---|\n`;
    for (const l of linhas.filter(x => x.area === a)) {
      const ts = l.escritos.map(t => `\`${path.basename(t.arquivo)}\` › ${t.titulo.replace(/\|/g, '/')}`).join('<br>') || '—';
      tabela += `| ${l.codigo}${l.kickoff ? ' ⏳' : ''} | ${l.texto.replace(/\|/g, '/')} | ${l.planejados} | ${ts} | ${l.cob} |\n`;
    }
  }
  return { resumo, tabela, erros };
}

function documento({ resumo, tabela }, achados) {
  return `# Matriz de rastreabilidade — regra → casos de teste → testes escritos

Gerada por \`npm run matriz\` (não edite à mão, exceto a seção "Achados"). O CI roda
\`npm run matriz:conferir\` e falha se esta matriz estiver velha ou se um teste citar código que não existe.

- Regras: \`.claude/rules/*.md\` (código \`ÁREA-NN\`). ⏳ = depende do kickoff.
- Casos planejados: \`docs/casos-de-teste.md\` (110 casos, formato Dado / Quando / Então).
- Testes escritos: títulos de teste que começam pelo código (TST-02).
- **✅** testes escritos ≥ casos planejados · **parcial** há teste, faltam casos · **❌** sem teste · **processo** regra de trabalho garantida por revisão e CI.

## Resumo

${resumo}

## Regras
${tabela}
## Achados

${achados}
`;
}

function achadosAtuais() {
  if (!fs.existsSync(MATRIZ)) return 'Nenhum até agora. Erro ou contradição de regra de negócio encontrado no desenvolvimento entra aqui e é mostrado ao dono.';
  const t = fs.readFileSync(MATRIZ, 'utf8');
  const i = t.indexOf('## Achados');
  return i < 0 ? '' : t.slice(i + '## Achados'.length).trim();
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const m = montar();
  if (args.includes('--resumo')) { process.stdout.write('## Matriz de rastreabilidade\n\n' + m.resumo + '\n'); process.exit(0); }
  if (m.erros.length) { console.error('Erros na matriz:\n' + m.erros.map(e => '  - ' + e).join('\n')); process.exit(1); }
  const novo = documento(m, achadosAtuais());
  if (args.includes('--conferir')) {
    const atual = fs.existsSync(MATRIZ) ? fs.readFileSync(MATRIZ, 'utf8') : '';
    if (atual !== novo) { console.error('docs/rastreabilidade.md está velha: rode "npm run matriz".'); process.exit(1); }
    console.log('Matriz em dia.');
  } else {
    fs.writeFileSync(MATRIZ, novo);
    console.log('docs/rastreabilidade.md atualizada.');
  }
}

module.exports = { montar, codigosDoTitulo, lerRegras, lerTestes };
