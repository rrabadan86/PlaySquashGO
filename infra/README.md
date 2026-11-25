# Servidor da Play Squash (VPS) — passo a passo

Uma VPS só, com **homologação** (para testar antes) e **produção** (a que a Play Squash usa).
Cada uma tem o próprio banco, a própria configuração e o próprio endereço.

| | Homologação | Produção |
|---|---|---|
| Endereço | `homolog.<domínio>` | `painel.<domínio>` |
| Porta interna | 3001 | 3000 |
| Configuração | `/etc/playsquash/homologacao.env` | `/etc/playsquash/producao.env` |
| Recebe | a marca `estavel` (a `main` com o CI ✓) | só a versão que o dono liberar |
| Cópias do banco | `/var/backups/playsquash/homologacao` | `/var/backups/playsquash/producao` |

## Antes de começar (uma vez)

1. **VPS** Ubuntu 24.04 (Hostinger KVM 2: 2 vCPU, 8 GB) com acesso SSH.
2. **Domínio**: crie dois registros DNS tipo A apontando para o IP da VPS — `painel` e `homolog`.
3. **Conta Google da Play Squash** (dona do projeto da conta de serviço e da pasta das cópias).

## 1. Instalar

```bash
sudo apt-get install -y git
git clone https://github.com/rrabadan86/PlaySquashGO.git /tmp/playsquash
sudo bash /tmp/playsquash/infra/instalar-vps.sh --dominio-producao painel.exemplo.com.br --dominio-homolog homolog.exemplo.com.br
```

Se o repositório for **privado**, o `git clone` acima pede seu usuário e um token do GitHub, e o script mostra uma
**chave pública** para o servidor: cadastre em GitHub → repositório → Settings → Deploy keys → Add (**sem** permissão de
escrita) e rode o mesmo comando de novo.

Ele instala Node 22, PostgreSQL 16, Caddy (HTTPS automático) e o firewall; cria o usuário `playsquash`, os dois bancos com
senhas aleatórias, a configuração de cada ambiente e a **chave das cópias** (`/etc/playsquash/backup.chave`).

> **Guarde uma cópia da chave das cópias fora do servidor** (num gerenciador de senhas). Sem ela, nenhuma cópia do banco abre.
> Para ver: `sudo cat /etc/playsquash/backup.chave` — nunca mande por WhatsApp nem cole no chat.

## 2. Subir a homologação

```bash
sudo /srv/playsquash/repo/infra/atualizar.sh homologacao
```

## 3. Primeiro acesso (criar o administrador)

```bash
sudo -u playsquash bash -c 'set -a; . /etc/playsquash/homologacao.env; set +a; cd /srv/playsquash/homologacao/atual && read -rs -p "Senha: " SENHA_NOVA && export SENHA_NOVA && node scripts/criar-usuario.js --nome "Guilherme" --email email@exemplo.com --admin --professor'
```

## 4. Google Agenda (conta de serviço)

1. Em console.cloud.google.com (com a conta Google da Play Squash): crie um projeto, ative a **Google Calendar API**,
   crie uma **conta de serviço** e gere uma **chave JSON**.
2. Envie o arquivo para a VPS e proteja:
   ```bash
   sudo install -o root -g playsquash -m 640 chave.json /etc/playsquash/google-conta-servico.json
   ```
3. Em `/etc/playsquash/<ambiente>.env`: `GOOGLE_CONTA_SERVICO_ARQUIVO=/etc/playsquash/google-conta-servico.json`
4. `sudo systemctl restart playsquash@homologacao` — as agendas das quadras são criadas e compartilhadas sozinhas.

## 5. Cópias fora do servidor

```bash
sudo -u playsquash rclone config        # crie um remoto "drive" (Google Drive da Play Squash)
```
Em cada `/etc/playsquash/<ambiente>.env`: `BACKUP_REMOTO=drive:playsquash-backups`.
As cópias rodam todo dia às 3h30; no dia 1º de cada mês, um teste restaura a cópia mais recente num banco separado.

## 6. WhatsApp da Play Squash (só na produção)

Um número só pode estar conectado num lugar. Por isso a homologação fica com o WhatsApp desligado.

1. Em `/etc/playsquash/producao.env`: `WHATSAPP_LIGADO=1`
2. `sudo systemctl restart playsquash@producao`
3. Abra o painel → **WhatsApp → Conexão e mensagens** e leia o QR com o celular da Play Squash
   (WhatsApp → Aparelhos conectados → Conectar aparelho). A sessão fica guardada; não precisa ler de novo.

Se o QR parar de funcionar depois de uma mudança do WhatsApp, fixe uma versão do WhatsApp Web em
`WA_WEB_VERSION_URL` (um `.html` do repositório `wppconnect-team/wa-version`) e reinicie.

## Atualizar

```bash
sudo /srv/playsquash/repo/infra/atualizar.sh homologacao            # versão "estavel"
sudo /srv/playsquash/repo/infra/atualizar.sh producao v2026.12.15   # só versão liberada pelo dono
```
Se a versão nova não responder em 30 s, o script volta sozinho para a anterior.
Atualize a produção fora do horário de aulas.

## Comandos do dia a dia

| Para | Comando |
|---|---|
| Ver se está no ar | `systemctl status playsquash@producao` |
| Ver os registros | `journalctl -u playsquash@producao -n 100` |
| Reiniciar | `sudo systemctl restart playsquash@producao` |
| Fazer uma cópia agora | `sudo -u playsquash /srv/playsquash/producao/atual/infra/backup.sh producao` |
| Testar a restauração | `sudo -u playsquash /srv/playsquash/producao/atual/infra/restaurar.sh producao --teste` |
| Restaurar de verdade | `sudo /srv/playsquash/producao/atual/infra/restaurar.sh producao <arquivo> --substituir` |
