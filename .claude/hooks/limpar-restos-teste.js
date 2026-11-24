#!/usr/bin/env node
/**
 * Hook (Stop) — TST-07. Apaga restos de teste: pastas "ps-*" na pasta temporária do
 * sistema (cópias do sistema, prints das telas, repositórios de mentira) com mais de
 * 2 horas. Pasta mais nova fica (pode ser um teste rodando agora).
 *
 * Só mexe na pasta temporária do sistema (os.tmpdir()), nunca no repositório, em
 * dados/ nem no banco. Nunca bloqueia: qualquer erro é ignorado.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const IDADE_MS = Number(process.env.PS_RESTOS_IDADE_MS) || 2 * 60 * 60 * 1000;
const PREFIXOS = /^ps-(teste|telas|print)-/;

function limpar(pasta = os.tmpdir(), agora = Date.now()) {
  const apagadas = [];
  let nomes = [];
  try { nomes = fs.readdirSync(pasta); } catch (_) { return apagadas; }
  for (const n of nomes) {
    if (!PREFIXOS.test(n)) continue;
    const f = path.join(pasta, n);
    try {
      const st = fs.lstatSync(f);
      if (!st.isDirectory() || st.isSymbolicLink()) continue;
      if (agora - st.mtimeMs < IDADE_MS) continue;
      fs.rmSync(f, { recursive: true, force: true });
      apagadas.push(n);
    } catch (_) {}
  }
  return apagadas;
}

if (require.main === module) {
  process.stdin.resume();
  process.stdin.on('data', () => {}).on('end', () => { limpar(); process.exit(0); });
  setTimeout(() => { limpar(); process.exit(0); }, 3000).unref();
}

module.exports = { limpar, PREFIXOS };
