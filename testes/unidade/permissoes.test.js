const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pode, ACOES } = require('../../src/regras/permissoes');
const senha = require('../../src/auth/senha');
const sessao = require('../../src/auth/sessao');
const { mesmaOrigem } = require('../../src/servidor');

const admin = { id: 1, eh_admin: true, eh_professor: true, telas: [] };
const prof = { id: 2, eh_admin: false, eh_professor: true, telas: ['grade'] };
const profCad = { ...prof, telas: ['grade', 'cadastros'] };

test('PER-01 administrador pode todas as ações', () => {
  for (const a of Object.keys(ACOES)) assert.equal(pode(admin, a), true, a);
});

test('PER-02 professor vê só as telas liberadas e nunca valores, usuários ou histórico', () => {
  assert.equal(pode(prof, 'grade.ver'), true);
  assert.equal(pode(prof, 'cadastros.ver'), false);
  assert.equal(pode(profCad, 'cadastros.ver'), true);
  for (const a of ['valores.ver', 'usuarios.ver', 'usuarios.editar', 'historico.ver']) assert.equal(pode(profCad, a), false, a);
});

test('AGD-02 só administrador altera grade e cadastros, mesmo com a tela liberada', () => {
  assert.equal(pode(profCad, 'cadastros.editar'), false);
  assert.equal(pode(admin, 'cadastros.editar'), true);
});

test('PER-03 sem usuário nada é permitido e ação desconhecida é erro', () => {
  assert.equal(pode(null, 'grade.ver'), false);
  assert.throws(() => pode(admin, 'nao.existe'), /desconhecida/);
});

test('PER-03 senha só como hash e cookie de sessão não pode ser forjado', () => {
  const h = senha.gerarHash('squash2026!');
  assert.match(h, /^scrypt\$/);
  assert.ok(!h.includes('squash2026!'));
  assert.equal(senha.conferir('squash2026!', h), true);
  assert.equal(senha.conferir('errada123', h), false);
  assert.throws(() => senha.gerarHash('curta'), /8 caracteres/);
  const seg = 'x'.repeat(40);
  const ck = sessao.cookieDe(seg, 'abc123').split(';')[0].split('=')[1];
  assert.equal(sessao.idDoCookie(seg, decodeURIComponent(ck)), 'abc123');
  assert.equal(sessao.idDoCookie(seg, 'abc123.' + '0'.repeat(64)), null);
  assert.equal(sessao.idDoCookie('y'.repeat(40), decodeURIComponent(ck)), null);
});

test('PER-03 envio de formulário só aceito vindo do próprio painel', () => {
  const req = (h) => ({ headers: { host: 'painel.playsquash.com.br', ...h } });
  assert.equal(mesmaOrigem(req({ origin: 'https://painel.playsquash.com.br' })), true);
  assert.equal(mesmaOrigem(req({ referer: 'https://painel.playsquash.com.br/cadastros' })), true);
  assert.equal(mesmaOrigem(req({ origin: 'https://site-malicioso.com' })), false);
  assert.equal(mesmaOrigem(req({})), false);
});
