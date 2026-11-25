#!/usr/bin/env bash
# Cópia do banco de um ambiente (DEP-06): pg_dump criptografado (AES-256, chave só no servidor),
# junto com os anexos da Sofia (SOFIA_ANEXOS_DIR, mesmo nome + .anexos.tar.gpg), rotação de
# 30 diárias + 12 mensais e envio para fora do servidor (rclone), se configurado.
#
#   sudo -u playsquash infra/backup.sh producao [motivo]
#
# Variáveis (com padrão): PS_ETC=/etc/playsquash  PS_BACKUPS=/var/backups/playsquash
# No arquivo <ambiente>.env: DATABASE_URL e, opcional, BACKUP_REMOTO (ex.: drive:playsquash-backups).
set -euo pipefail

AMBIENTE="${1:?Use: backup.sh <producao|homologacao> [motivo]}"
MOTIVO="${2:-}"
PS_ETC="${PS_ETC:-/etc/playsquash}"
PS_BACKUPS="${PS_BACKUPS:-/var/backups/playsquash}"
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

case "$AMBIENTE" in producao|homologacao) ;; *) echo "Ambiente inválido: $AMBIENTE" >&2; exit 1 ;; esac
[[ -z "$MOTIVO" || "$MOTIVO" =~ ^[a-z0-9-]+$ ]] || { echo "Motivo só com letras minúsculas, números e hífen." >&2; exit 1; }

ENV_ARQ="$PS_ETC/$AMBIENTE.env"
CHAVE="$PS_ETC/backup.chave"
[[ -r "$ENV_ARQ" ]] || { echo "Sem $ENV_ARQ" >&2; exit 1; }
[[ -r "$CHAVE" ]] || { echo "Sem a chave de backup $CHAVE" >&2; exit 1; }

DATABASE_URL="$(grep -E '^DATABASE_URL=' "$ENV_ARQ" | cut -d= -f2-)"
BACKUP_REMOTO="$(grep -E '^BACKUP_REMOTO=' "$ENV_ARQ" | cut -d= -f2- || true)"
ANEXOS_DIR="$(grep -E '^SOFIA_ANEXOS_DIR=' "$ENV_ARQ" | cut -d= -f2- || true)"
[[ -n "$DATABASE_URL" ]] || { echo "DATABASE_URL vazio em $ENV_ARQ" >&2; exit 1; }

PASTA="$PS_BACKUPS/$AMBIENTE"
mkdir -p "$PASTA"
chmod 700 "$PASTA"
NOME="$AMBIENTE-$(TZ=America/Sao_Paulo date +%F_%H%M%S)${MOTIVO:+-$MOTIVO}.dump.gpg"
TMP="$PASTA/.$NOME.parcial"
NOME_ANEXOS="${NOME%.dump.gpg}.anexos.tar.gpg"
TMP_ANEXOS="$PASTA/.$NOME_ANEXOS.parcial"
trap 'rm -f "$TMP" "$TMP_ANEXOS"' EXIT

pg_dump --format=custom --no-owner "$DATABASE_URL" \
  | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase-file "$CHAVE" -o "$TMP"
mv "$TMP" "$PASTA/$NOME"
chmod 600 "$PASTA/$NOME"
echo "Cópia criada: $PASTA/$NOME ($(du -h "$PASTA/$NOME" | cut -f1))"

# Anexos da Sofia (imagens/PDF cadastrados no painel, SOF-10): ficam fora do banco.
if [[ -n "$ANEXOS_DIR" && -d "$ANEXOS_DIR" ]] && [[ -n "$(ls -A "$ANEXOS_DIR")" ]]; then
  tar -C "$ANEXOS_DIR" -cf - . \
    | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase-file "$CHAVE" -o "$TMP_ANEXOS"
  mv "$TMP_ANEXOS" "$PASTA/$NOME_ANEXOS"
  chmod 600 "$PASTA/$NOME_ANEXOS"
  echo "Anexos da Sofia: $PASTA/$NOME_ANEXOS ($(find "$ANEXOS_DIR" -type f | wc -l) arquivo(s))"
fi

# Rotação: a regra fica em scripts/rotacao-backups.js (testada).
while IFS= read -r velho; do
  [[ -n "$velho" && "$velho" != */* ]] && rm -f -- "${PASTA:?}/$velho" && echo "Apagada (rotação): $velho"
done < <(node "$RAIZ/scripts/rotacao-backups.js" "$PASTA")

if [[ -n "$BACKUP_REMOTO" ]]; then
  rclone sync --quiet "$PASTA" "$BACKUP_REMOTO/$AMBIENTE" --exclude '.*'
  echo "Enviada para fora do servidor: $BACKUP_REMOTO/$AMBIENTE"
else
  echo "AVISO: BACKUP_REMOTO não configurado — a cópia ficou só neste servidor." >&2
fi
