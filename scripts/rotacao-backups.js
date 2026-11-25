#!/usr/bin/env node
/**
 * Quais cópias do banco apagar (DEP-06): guarda a última de cada um dos 30 dias mais
 * recentes e a primeira de cada um dos 12 meses mais recentes. Cópia feita antes de atualizar
 * (nome com "-antes-") vale 30 dias. Só lista; quem apaga é infra/backup.sh.
 *
 *   node scripts/rotacao-backups.js /var/backups/playsquash/producao [AAAA-MM-DD]
 *
 * Nome dos arquivos: <ambiente>-AAAA-MM-DD_HHMMSS[-motivo].dump.gpg (com segundos: duas cópias no
 * mesmo minuto não se sobrescrevem). Os anexos da Sofia da mesma cópia têm o mesmo nome com
 * .anexos.tar.gpg e seguem o destino da cópia do banco (sem a cópia do banco, saem também).
 */
const fs = require('fs');

const DIAS = 30;
const MESES = 12;
const RE = /^[a-z]+-(\d{4}-\d{2}-\d{2})_(\d{6})(-[a-z0-9-]+)?\.dump\.gpg$/;

function diasEntre(a, b) { return Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000); }

function paraApagar(nomes, hoje) {
  const copias = nomes.map(n => { const m = RE.exec(n); return m && { n, dia: m[1], hora: m[2], motivo: m[3] || '' }; }).filter(Boolean)
    .sort((x, y) => (x.dia + x.hora).localeCompare(y.dia + y.hora));
  const fica = new Set();
  const normais = copias.filter(c => !c.motivo);
  // Última cópia de cada dia, nos últimos 30 dias.
  const porDia = new Map();
  for (const c of normais) if (diasEntre(c.dia, hoje) < DIAS) porDia.set(c.dia, c.n);
  porDia.forEach(n => fica.add(n));
  // Primeira cópia de cada mês, nos últimos 12 meses.
  const porMes = new Map();
  const [ah, mh] = hoje.split('-').map(Number);
  for (const c of normais) {
    const [a, m] = c.dia.split('-').map(Number);
    const idadeMeses = (ah - a) * 12 + (mh - m);
    if (idadeMeses < MESES && !porMes.has(c.dia.slice(0, 7))) porMes.set(c.dia.slice(0, 7), c.n);
  }
  porMes.forEach(n => fica.add(n));
  // Cópias "antes de atualizar": 30 dias.
  for (const c of copias) if (c.motivo && diasEntre(c.dia, hoje) < DIAS) fica.add(c.n);
  const apagar = copias.map(c => c.n).filter(n => !fica.has(n));
  // Anexos acompanham a cópia do banco de mesmo nome.
  for (const n of nomes) {
    const m = /^(.+)\.anexos\.tar\.gpg$/.exec(n);
    if (m && RE.test(`${m[1]}.dump.gpg`) && !fica.has(`${m[1]}.dump.gpg`)) apagar.push(n);
  }
  return apagar;
}

if (require.main === module) {
  const pasta = process.argv[2];
  const hoje = process.argv[3] || new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
  if (!pasta) { console.error('Use: node scripts/rotacao-backups.js <pasta> [AAAA-MM-DD]'); process.exit(1); }
  for (const n of paraApagar(fs.readdirSync(pasta), hoje)) console.log(n);
}

module.exports = { paraApagar };
