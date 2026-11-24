#!/usr/bin/env bash
# Restaura uma cópia do banco (DEP-06).
#
#   Teste (padrão, não mexe no sistema): restaura num banco separado "<banco>_restauro",
#   confere que tem histórico e apaga o banco de teste no fim.
#     sudo -u postgres infra/restaurar.sh producao [arquivo.dump.gpg] --teste
#   De verdade (para o sistema, cópia de segurança antes, restaura por cima):
#     sudo infra/restaurar.sh producao arquivo.dump.gpg --substituir
#
# Sem arquivo, usa a cópia mais recente do ambiente.
# Variáveis (com padrão): PS_ETC=/etc/playsquash  PS_BACKUPS=/var/backups/playsquash
set -euo pipefail

AMBIENTE="${1:?Use: restaurar.sh <producao|homologacao> [arquivo] [--teste|--substituir]}"
shift
ARQUIVO=""; MODO="--teste"
for a in "$@"; do case "$a" in --teste|--substituir) MODO="$a" ;; *) ARQUIVO="$a" ;; esac; done
PS_ETC="${PS_ETC:-/etc/playsquash}"
PS_BACKUPS="${PS_BACKUPS:-/var/backups/playsquash}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
case "$AMBIENTE" in producao|homologacao) ;; *) echo "Ambiente inválido: $AMBIENTE" >&2; exit 1 ;; esac

ENV_ARQ="$PS_ETC/$AMBIENTE.env"
CHAVE="$PS_ETC/backup.chave"
DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_ARQ" | cut -d= -f2-)"
PORTA="$(grep -E '^PORTA=' "$ENV_ARQ" | cut -d= -f2- || true)"
if [[ -z "$ARQUIVO" ]]; then
  ARQUIVO="$(find "$PS_BACKUPS/$AMBIENTE" -maxdepth 1 -name "$AMBIENTE-*.dump.gpg" | sort | tail -1)"
fi
[[ -r "$ARQUIVO" ]] || { echo "Cópia não encontrada: ${ARQUIVO:-nenhuma}" >&2; exit 1; }

TMPDIR_R="$(mktemp -d -t ps-restauro-XXXX)"
trap 'rm -rf "$TMPDIR_R"' EXIT
gpg --batch --quiet --decrypt --passphrase-file "$CHAVE" -o "$TMPDIR_R/banco.dump" "$ARQUIVO"

# Restaura via SQL, parando no primeiro erro. Ignora só os SET que um pg_dump mais novo grava e um
# servidor mais antigo não conhece (ex.: transaction_timeout do PostgreSQL 17+), para a cópia
# continuar restaurável mesmo com versões diferentes de cliente e servidor.
restaurar_sql() { # <url> [opções extras do pg_restore]
  local url="$1"; shift
  pg_restore --no-owner "$@" -f - "$TMPDIR_R/banco.dump" \
    | grep -vE '^SET (transaction_timeout) = ' \
    | psql -q -X -v ON_ERROR_STOP=1 --single-transaction "$url" >/dev/null
}

# URL do mesmo servidor apontando para outro banco.
url_com_banco() { node -e 'const u=new URL(process.argv[1]); u.pathname="/"+process.argv[2]; console.log(u.toString())' "$1" "$2"; }

if [[ "$MODO" == "--teste" ]]; then
  BANCO="$(node -e 'console.log(new URL(process.argv[1]).pathname.slice(1))' "$DATABASE_URL")_restauro"
  ADMIN_URL="${PS_ADMIN_URL:-$(url_com_banco "$DATABASE_URL" postgres)}"
  psql -q "$ADMIN_URL" -c "DROP DATABASE IF EXISTS \"$BANCO\";" -c "CREATE DATABASE \"$BANCO\";"
  ALVO="$(url_com_banco "$DATABASE_URL" "$BANCO")"
  restaurar_sql "$ALVO"
  N="$(psql -tAq "$ALVO" -c 'SELECT count(*) FROM historico')"
  M="$(psql -tAq "$ALVO" -c 'SELECT count(*) FROM schema_migracao')"
  psql -q "$ADMIN_URL" -c "DROP DATABASE \"$BANCO\";"
  [[ "$M" -ge 1 ]] || { echo "FALHOU: a cópia restaurada não tem as migrações." >&2; exit 1; }
  echo "Teste de restauração OK: $(basename "$ARQUIVO") — $M migração(ões), $N registro(s) no histórico."
  exit 0
fi

# --substituir: só com confirmação digitada.
echo "ATENÇÃO: isto substitui o banco de $AMBIENTE pela cópia $(basename "$ARQUIVO")."
read -r -p "Digite RESTAURAR $AMBIENTE para continuar: " OK
[[ "$OK" == "RESTAURAR $AMBIENTE" ]] || { echo "Cancelado."; exit 1; }
sudo -u playsquash "$RAIZ/infra/backup.sh" "$AMBIENTE" antes-de-restaurar
systemctl stop "playsquash@$AMBIENTE"
restaurar_sql "$DATABASE_URL" --clean --if-exists
systemctl start "playsquash@$AMBIENTE"
sleep 3
curl -fsS "http://127.0.0.1:${PORTA:-3000}/saude" >/dev/null && echo "Restaurado e no ar." || { echo "Restaurado, mas o painel não respondeu. Veja: journalctl -u playsquash@$AMBIENTE" >&2; exit 1; }
