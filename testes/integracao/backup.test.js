/**
 * Cópia do banco e teste de restauração de verdade (DEP-06, OPR-06), no banco de TESTE e em
 * pastas temporárias (TST-01, TST-07). Precisa de pg_dump 16+, gpg e permissão de criar banco.
 */
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { URL_TESTE, prepararBanco } = require('../ajuda');

function versaoPgDump() {
  try { return Number(/(\d+)\./.exec(execFileSync('pg_dump', ['--version'], { encoding: 'utf8' }))[1]); } catch (_) { return 0; }
}
function temGpg() { try { execFileSync('gpg', ['--version'], { stdio: 'ignore' }); return true; } catch (_) { return false; } }
const motivo = !URL_TESTE ? 'sem DATABASE_URL_TESTE' : versaoPgDump() < 16 ? 'sem pg_dump 16+' : !temGpg() ? 'sem gpg' : false;
const opc = { skip: motivo };

const RAIZ = path.join(__dirname, '..', '..');
let pool, pasta;

before(async () => {
  if (motivo) return;
  pool = await prepararBanco();
  await pool.query(`INSERT INTO historico (ator_tipo, origem, acao, entidade) VALUES ('sistema','sistema','teste.backup','teste')`);
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-teste-backup-'));
  fs.mkdirSync(path.join(pasta, 'etc'));
  fs.writeFileSync(path.join(pasta, 'etc', 'producao.env'), `DATABASE_URL=${URL_TESTE}\nPORTA=3999\n`);
  fs.writeFileSync(path.join(pasta, 'etc', 'backup.chave'), 'chave-de-teste-'.padEnd(64, 'k'), { mode: 0o600 });
});
after(async () => {
  if (pool) await pool.end();
  if (pasta) fs.rmSync(pasta, { recursive: true, force: true });
});

const rodar = (script, args) => execFileSync('bash', [path.join(RAIZ, 'infra', script), ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, PS_ETC: path.join(pasta, 'etc'), PS_BACKUPS: path.join(pasta, 'backups') },
});

test('DEP-06 cópia do banco sai criptografada, com nome por data, e não abre sem a chave', opc, () => {
  const saida = rodar('backup.sh', ['producao']);
  // duas cópias seguidas não se sobrescrevem
  rodar('backup.sh', ['producao', 'antes-de-atualizar']);
  assert.match(saida, /Cópia criada: .*producao-\d{4}-\d{2}-\d{2}_\d{6}\.dump\.gpg/);
  const arqs = fs.readdirSync(path.join(pasta, 'backups', 'producao'));
  assert.equal(arqs.length, 2);
  const bruto = fs.readFileSync(path.join(pasta, 'backups', 'producao', arqs[0]));
  assert.ok(!bruto.includes(Buffer.from('teste.backup')), 'conteúdo não pode estar legível');
  assert.ok(!bruto.subarray(0, 5).equals(Buffer.from('PGDMP')), 'não pode ser um dump aberto');
  assert.throws(() => execFileSync('gpg', ['--batch', '--decrypt', '--passphrase', 'errada', path.join(pasta, 'backups', 'producao', arqs[0])], { stdio: 'pipe' }));
});

test('DEP-06 teste de restauração recria o banco num banco separado e confere migrações e histórico', opc, () => {
  const saida = rodar('restaurar.sh', ['producao', '--teste']);
  assert.match(saida, /Teste de restauração OK: .* \d+ migração\(ões\), 1 registro\(s\) no histórico/);
});
