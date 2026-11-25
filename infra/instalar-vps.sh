#!/usr/bin/env bash
# Instala a Play Squash numa VPS Ubuntu 24.04 limpa (Hostinger KVM 2 ou parecida).
# Pode ser rodado de novo: o que já existe é mantido (senhas e chaves não são trocadas).
#
#   sudo bash infra/instalar-vps.sh --dominio-producao painel.exemplo.com.br --dominio-homolog homolog.exemplo.com.br
#
# O que faz: Node 22, PostgreSQL 16, Caddy (HTTPS automático), firewall, usuário "playsquash",
# um banco e um arquivo de configuração por ambiente (senhas aleatórias), chave das cópias,
# serviços do systemd (painel + cópia diária + teste de restauração mensal) e o Caddyfile.
# Não guarda nenhuma senha no Git nem na tela (DAD-01).
set -euo pipefail

DOM_PROD=""; DOM_HOM=""; REPO_URL="https://github.com/rrabadan86/PlaySquashGO.git"; REPO_SSH="git@github.com:rrabadan86/PlaySquashGO.git"
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dominio-producao) DOM_PROD="$2"; shift 2 ;;
    --dominio-homolog) DOM_HOM="$2"; shift 2 ;;
    --repo) REPO_URL="$2"; shift 2 ;;
    --repo-ssh) REPO_SSH="$2"; shift 2 ;;
    *) echo "Opção desconhecida: $1" >&2; exit 1 ;;
  esac
done
[[ $EUID -eq 0 ]] || { echo "Rode com sudo." >&2; exit 1; }
[[ -n "$DOM_PROD" && -n "$DOM_HOM" ]] || { echo "Informe --dominio-producao e --dominio-homolog." >&2; exit 1; }
grep -q 'Ubuntu 24.04' /etc/os-release || echo "AVISO: feito para Ubuntu 24.04." >&2

AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ETC=/etc/playsquash
USUARIO=playsquash
export DEBIAN_FRONTEND=noninteractive

echo "→ Pacotes"
apt-get update -qq
apt-get install -y -qq curl git ufw gnupg ca-certificates debian-keyring debian-archive-keyring apt-transport-https \
  postgresql-16 rclone unattended-upgrades >/dev/null
# Bibliotecas do Chrome usado pelo WhatsApp Web (whatsapp-web.js / puppeteer).
apt-get install -y -qq fonts-liberation libasound2t64 libatk-bridge2.0-0t64 libatk1.0-0t64 libcairo2 libcups2t64 \
  libdbus-1-3 libdrm2 libgbm1 libglib2.0-0t64 libgtk-3-0t64 libnspr4 libnss3 libpango-1.0-0 libx11-xcb1 libxcomposite1 \
  libxdamage1 libxfixes3 libxkbcommon0 libxrandr2 libxss1 libxtst6 >/dev/null
if ! command -v node >/dev/null || ! node -v | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
if ! command -v caddy >/dev/null; then
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq && apt-get install -y -qq caddy >/dev/null
fi

echo "→ Firewall (SSH, HTTP, HTTPS)"
ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "→ Usuário $USUARIO e pastas"
id "$USUARIO" >/dev/null 2>&1 || useradd --system --create-home --home-dir /srv/playsquash --shell /bin/bash "$USUARIO"
install -d -o "$USUARIO" -g "$USUARIO" -m 750 /srv/playsquash /srv/playsquash/producao/versoes /srv/playsquash/homologacao/versoes
install -d -o "$USUARIO" -g "$USUARIO" -m 700 /var/backups/playsquash
install -d -o root -g "$USUARIO" -m 750 "$ETC"

echo "→ Código (repositório público por HTTPS; privado por chave só de leitura)"
if [[ ! -d /srv/playsquash/repo/.git ]]; then
  if ! GIT_TERMINAL_PROMPT=0 sudo -u "$USUARIO" -H git clone --quiet "$REPO_URL" /srv/playsquash/repo 2>/dev/null; then
    if [[ ! -f /srv/playsquash/.ssh/id_ed25519 ]]; then
      sudo -u "$USUARIO" mkdir -p /srv/playsquash/.ssh && chmod 700 /srv/playsquash/.ssh
      sudo -u "$USUARIO" ssh-keygen -q -t ed25519 -N '' -C "playsquash-vps" -f /srv/playsquash/.ssh/id_ed25519
      sudo -u "$USUARIO" bash -c 'ssh-keyscan -t ed25519 github.com >> ~/.ssh/known_hosts 2>/dev/null'
    fi
    if ! sudo -u "$USUARIO" -H git clone --quiet "$REPO_SSH" /srv/playsquash/repo 2>/dev/null; then
      echo
      echo "Repositório privado: cadastre esta chave no GitHub (repositório → Settings → Deploy keys → Add, SEM permissão de escrita):"
      cat /srv/playsquash/.ssh/id_ed25519.pub
      echo
      echo "Depois rode este script de novo."
      exit 2
    fi
  fi
fi

echo "→ Bancos e configuração de cada ambiente"
segredo() { head -c 48 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
for AMB in producao homologacao; do
  ARQ="$ETC/$AMB.env"
  ROLE="ps_$AMB"; BANCO="playsquash_$AMB"
  if [[ ! -f "$ARQ" ]]; then
    SENHA="$(segredo 32)"
    sudo -u postgres psql -q -v ON_ERROR_STOP=1 -c "CREATE ROLE $ROLE LOGIN CREATEDB PASSWORD '$SENHA';"
    sudo -u postgres createdb -O "$ROLE" "$BANCO"
    PORTA=3000; [[ "$AMB" == homologacao ]] && PORTA=3001
    umask 027
    cat > "$ARQ" <<EOF
NODE_ENV=production
PORTA=$PORTA
DATABASE_URL=postgres://$ROLE:$SENHA@127.0.0.1:5432/$BANCO
PAINEL_SEGREDO=$(segredo 64)
# Google Agenda (conta de serviço): caminho do arquivo da chave, fora do repositório (DAD-10).
GOOGLE_CONTA_SERVICO_ARQUIVO=
# Cópias fora do servidor (rclone), ex.: drive:playsquash-backups — configure com "rclone config".
BACKUP_REMOTO=
# WhatsApp: um número só pode estar conectado em UM ambiente — ligue só na produção (OPR-01).
WHATSAPP_LIGADO=0
WA_SESSAO_DIR=/srv/playsquash/$AMB/whatsapp
EOF
    chown root:"$USUARIO" "$ARQ"; chmod 640 "$ARQ"
    echo "  $AMB: banco $BANCO criado; configuração em $ARQ"
  else
    echo "  $AMB: já configurado ($ARQ mantido)"
  fi
done
if [[ ! -f "$ETC/backup.chave" ]]; then
  (umask 027; segredo 64 > "$ETC/backup.chave")
  chown root:"$USUARIO" "$ETC/backup.chave"; chmod 640 "$ETC/backup.chave"
  echo "  Chave das cópias criada em $ETC/backup.chave — GUARDE UMA CÓPIA FORA DO SERVIDOR (sem ela, as cópias não abrem)."
fi

echo "→ Serviços (systemd)"
install -m 644 "$AQUI"/systemd/*.service "$AQUI"/systemd/*.timer /etc/systemd/system/
systemctl daemon-reload
for AMB in producao homologacao; do
  systemctl enable "playsquash@$AMB" >/dev/null
  systemctl enable --now "playsquash-backup@$AMB.timer" "playsquash-restauro-teste@$AMB.timer" >/dev/null
done

echo "→ HTTPS (Caddy)"
sed -e "s/{DOMINIO_PRODUCAO}/$DOM_PROD/" -e "s/{DOMINIO_HOMOLOG}/$DOM_HOM/" "$AQUI/Caddyfile.modelo" > /etc/caddy/Caddyfile
systemctl reload caddy || systemctl restart caddy

echo
echo "Instalado. Próximos passos:"
echo "  1. Aponte o DNS de $DOM_PROD e $DOM_HOM para o IP desta VPS."
echo "  2. Suba a homologação:  sudo /srv/playsquash/repo/infra/atualizar.sh homologacao"
echo "  3. Crie o administrador: veja infra/README.md (passo 'Primeiro acesso')."
