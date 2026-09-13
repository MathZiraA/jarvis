#!/usr/bin/env bash
# Instala o JARVIS: dependências, .env, config, serviço systemd e atalhos de
# desktop. Idempotente — pode rodar de novo sem duplicar nada.
set -e
cd "$(dirname "$0")/.."
JARVIS_DIR="$(pwd)"

echo "==> Instalando dependências (npm)…"
npm install

if [ ! -f .env ]; then
  cp .env.example .env
  chmod 600 .env
  echo "==> Criei .env a partir do .env.example — edite antes de rodar (token do Claude, etc.)."
else
  echo "==> .env já existe, mantendo."
fi

if [ ! -f config/personality.json ]; then
  cp config/personality.example.json config/personality.json
  echo "==> Criei config/personality.json com a personalidade padrão (edite ou use o painel ⚙ depois)."
else
  echo "==> config/personality.json já existe, mantendo."
fi

mkdir -p "$HOME/.config/systemd/user" "$HOME/.local/share/applications" "$HOME/.config/autostart"

sed "s|%h|$HOME|g" systemd/jarvis.service > "$HOME/.config/systemd/user/jarvis.service"
systemctl --user daemon-reload
echo "==> Serviço systemd instalado (~/.config/systemd/user/jarvis.service)."

DESKTOP_ENTRY="[Desktop Entry]
Type=Application
Name=JARVIS
Comment=Assistente pessoal por voz
Exec=$JARVIS_DIR/bin/jarvis-window.sh
Icon=$JARVIS_DIR/assets/icon.svg
Terminal=false
Categories=Utility;
StartupWMClass=chrome-localhost__-Default"

echo "$DESKTOP_ENTRY" > "$HOME/.local/share/applications/jarvis.desktop"
echo "$DESKTOP_ENTRY
X-GNOME-Autostart-enabled=true
X-GNOME-Autostart-Delay=5" > "$HOME/.config/autostart/jarvis-window.desktop"
update-desktop-database "$HOME/.local/share/applications" 2>/dev/null || true
echo "==> Atalhos de desktop criados (menu de aplicativos + autostart)."

echo "
Falta só:
  1. Editar .env (pelo menos CLAUDE_CODE_OAUTH_TOKEN — veja o comentário no arquivo).
     Se não tiver o token ainda, rode:
       node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude setup-token
  2. Iniciar o serviço:
       systemctl --user enable --now jarvis
  3. Abrir a janela:
       bin/jarvis-window.sh   (ou o ícone JARVIS no menu de aplicativos)

Documentação completa: README.md"
