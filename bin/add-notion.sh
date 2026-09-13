#!/usr/bin/env bash
# Conecta o Notion ao JARVIS.
# Antes: crie uma integração interna em https://www.notion.so/my-integrations,
# copie o token (ntn_...) e COMPARTILHE com a integração as páginas que o Jarvis
# pode ver (menu ••• da página → Conexões → sua integração).
set -e
read -s -p "Cole o token do Notion (ntn_...): " TOKEN; echo
[ -z "$TOKEN" ] && { echo "token vazio, abortado"; exit 1; }
grep -q '^NOTION_TOKEN=' ~/jarvis/.env \
  && sed -i "s|^NOTION_TOKEN=.*|NOTION_TOKEN=$TOKEN|" ~/jarvis/.env \
  || echo "NOTION_TOKEN=$TOKEN" >> ~/jarvis/.env
chmod 600 ~/jarvis/.env
python3 - <<EOF
import json
p = '$HOME/.claude.json'
d = json.load(open(p))
d.setdefault('mcpServers', {})['notionApi'] = {
    'type': 'stdio',
    'command': 'npx',
    'args': ['-y', '@notionhq/notion-mcp-server'],
    'env': {'NOTION_TOKEN': '$TOKEN'},
}
json.dump(d, open(p, 'w'), indent=2)
print('MCP do Notion registrado')
EOF
systemctl --user restart jarvis
echo "✔ Pronto. Teste: 'Jarvis, o que tem nas minhas páginas do Notion?'"
