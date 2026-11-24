#!/usr/bin/env bash
# Atualiza um ambiente para uma versão (DEP-02, DEP-04):
#   1. baixa a versão (homologação: a marca "estavel" que o CI move; produção: a versão que o
#      dono liberou, informada por extenso);
#   2. instala as dependências numa pasta nova (a versão em uso não é tocada);
#   3. faz cópia do banco, aplica as migrações (sempre para a frente, DAD-08);
#   4. troca a versão, reinicia e confere /saude por até 30 s — se não responder,
#      volta sozinho para a versão anterior.
#
#   sudo infra/atualizar.sh homologacao            # versão "estavel"
#   sudo infra/atualizar.sh producao <tag-ou-commit>
set -euo pipefail

AMBIENTE="${1:?Use: atualizar.sh <producao|homologacao> [versao]}"
VERSAO="${2:-}"
PS_ETC="${PS_ETC:-/etc/playsquash}"
BASE="/srv/playsquash/$AMBIENTE"
REPO="/srv/playsquash/repo"
USUARIO="playsquash"
case "$AMBIENTE" in
  homologacao) VERSAO="${VERSAO:-estavel}" ;;
  producao) [[ -n "$VERSAO" ]] || { echo "Produção só recebe versão liberada: informe a tag ou o commit (DEP-02)." >&2; exit 1; } ;;
  *) echo "Ambiente inválido: $AMBIENTE" >&2; exit 1 ;;
esac
[[ $EUID -eq 0 ]] || { echo "Rode com sudo." >&2; exit 1; }
como() { sudo -u "$USUARIO" -H "$@"; }

PORTA="$(grep -E '^PORTA=' "$PS_ETC/$AMBIENTE.env" | cut -d= -f2-)"
como git -C "$REPO" fetch --quiet --force --tags origin
SHA="$(como git -C "$REPO" rev-parse --verify "$VERSAO^{commit}" 2>/dev/null || como git -C "$REPO" rev-parse --verify "origin/$VERSAO^{commit}")"
CURTO="${SHA:0:12}"
NOVA="$BASE/versoes/$CURTO"
ANTERIOR="$(readlink -f "$BASE/atual" 2>/dev/null || true)"

if [[ "$ANTERIOR" == "$NOVA" ]]; then echo "$AMBIENTE já está na versão $CURTO."; exit 0; fi

echo "→ Preparando $CURTO em $NOVA"
if [[ ! -d "$NOVA" ]]; then
  como mkdir -p "$NOVA.parcial"
  como bash -c "git -C '$REPO' archive '$SHA' | tar -x -C '$NOVA.parcial'"
  (cd "$NOVA.parcial" && como npm ci --omit=dev --no-audit --no-fund --loglevel=error)
  como mv "$NOVA.parcial" "$NOVA"
fi

echo "→ Cópia do banco antes de atualizar"
como "$NOVA/infra/backup.sh" "$AMBIENTE" antes-de-atualizar

echo "→ Migrações"
como bash -c "set -a; . '$PS_ETC/$AMBIENTE.env'; set +a; cd '$NOVA' && node scripts/migrar.js"

echo "→ Trocando a versão e reiniciando"
ln -sfn "$NOVA" "$BASE/atual"
systemctl restart "playsquash@$AMBIENTE"

for _ in $(seq 1 30); do
  if curl -fsS "http://127.0.0.1:$PORTA/saude" >/dev/null 2>&1; then
    echo "✓ $AMBIENTE no ar na versão $CURTO."
    echo "$(date -Is) $AMBIENTE $CURTO" >> "$BASE/versoes.log"
    # Guarda as 5 versões mais recentes (e a anterior, para voltar).
    find "$BASE/versoes" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -rn | tail -n +6 | cut -d' ' -f2- |
      while read -r velha; do [[ "$velha" != "$NOVA" && "$velha" != "$ANTERIOR" && "$velha" == "$BASE/versoes/"* ]] && rm -rf -- "$velha"; done
    exit 0
  fi
  sleep 1
done

echo "✗ A versão $CURTO não respondeu em 30 s. Voltando para a anterior." >&2
if [[ -n "$ANTERIOR" ]]; then
  ln -sfn "$ANTERIOR" "$BASE/atual"
  systemctl restart "playsquash@$AMBIENTE"
  echo "Voltou para $(basename "$ANTERIOR"). As migrações ficam (são compatíveis com a versão anterior, DAD-08)." >&2
fi
echo "Veja o erro: journalctl -u playsquash@$AMBIENTE -n 100" >&2
exit 1
