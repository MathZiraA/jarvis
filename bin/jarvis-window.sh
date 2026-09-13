#!/usr/bin/env bash
# Abre a janela do JARVIS (Chrome em modo app) quando o servidor estiver de pé.
# Se a janela já existe, não abre outra (o foco fica com a dock: Super+N / Alt+Tab).
URL="http://localhost:3111"
if pgrep -f "user-data-dir=$HOME/.config/jarvis-chrome" >/dev/null; then
  exit 0
fi
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "$URL"; then
    exec google-chrome --app="$URL" --user-data-dir="$HOME/.config/jarvis-chrome"
  fi
  sleep 1
done
notify-send "JARVIS" "O servidor não subiu em 60s." 2>/dev/null
exit 1
