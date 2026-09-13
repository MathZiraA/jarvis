# JARVIS — assistente pessoal por voz

Assistente estilo Jarvis: fala em pt-BR pelo microfone, o Claude Agent SDK executa, a resposta
volta falada (Edge TTS, voz Antônio). Plano completo e decisões: `design/JARVIS-PROJETO.md`
(handoff original) — **as decisões revisadas em 12/09/2026 valem sobre ele** (ver abaixo).

## Instalação

Requisitos: Linux com systemd (usuário), GNOME de preferência (os atalhos de janela/dock
assumem isso, mas o servidor em si funciona em qualquer Linux), Node.js 20+, Google Chrome ou
Edge (a interface usa a Web Speech API do navegador, que não existe no Firefox), e uma conta
Claude com acesso ao Agent SDK.

```bash
git clone https://github.com/MathZiraA/jarvis.git ~/jarvis
cd ~/jarvis
bin/install.sh
```

O `install.sh` instala as dependências, cria `.env` e `config/personality.json` a partir dos
`.example`, e registra o serviço systemd e os atalhos de desktop — sem sobrescrever nada que já
exista. Ao final ele mostra os 3 passos que faltam (gerar o token do Claude, ligar o serviço,
abrir a janela). Cada um usa sua própria conta/token do zero — nada deste repositório depende de
dados de quem o escreveu.

Conectores opcionais (Gmail/Calendar/Drive, Notion) são configurados por fora, direto no
`~/.claude.json` do Claude Code — veja a seção "Conectores" abaixo para o passo a passo de cada
um (ou rode `bin/add-notion.sh` para o Notion).

## Estado (12/09/2026)

- **Fase 1 (MVP) implementada**: servidor + HUD prontos, TTS por frases com fila gapless,
  travas de confirmação verbal, sessão do dia persistida, autostart configurado.
- **Pendente: login** — o SDK precisa de autenticação própria (o login do app desktop não vale).
  Rodar uma vez:
  `node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude setup-token`
  e salvar o token em `.env` como `CLAUDE_CODE_OAUTH_TOKEN=...` (chmod 600).

## Decisões revisadas (vencem o documento original)

- Alvo é **este Fedora 44 (GNOME/Wayland)**, não Windows.
- **Sem Electron**: a janela é Chrome em modo app (`bin/jarvis-window.sh`), que mantém a
  Web Speech API funcionando. Atalho global → atalho customizado do GNOME chamando o script.
- **Sem `bypassPermissions`**: `canUseTool` auto-aprova o cotidiano e exige confirmação verbal
  para: comandos destrutivos, sudo, escrita fora do home, ferramentas MCP sensíveis.
- Modelo **Sonnet**; erros de limite/auth são falados, nunca silêncio.
- Sessão retomada por dia (`data/session.json`); nova sessão a cada dia.
- Fases: 1 MVP ✅ · 2 wake word ✅ (12/09) · 2.5 conectores: Gmail + Calendar ✅ (13/09; Drive e
  Notion pendentes) · 3 personalidade ✅ (13/09) · 4 GNOME ✅ (13/09) · 5 polimento ✅ (13/09).
- Fase 5: barge-in por voz (escuta segue ligada durante a fala — AEC do Chrome; enquanto o
  áudio toca só wake word é aceita, e a persona evita dizer o próprio nome); "Jarvis,
  cancela/para/esquece" corta áudio+tarefa sem virar turno; ping sutil de "processando"
  (toggle de sons); saudação "Sistemas online" na primeira conexão pós-boot.
- Fase 4: JARVIS fixo na dock (Super+9 abre/foca) + atalho global Ctrl+Shift+J (gsettings
  custom-keybinding) + jarvis-window.sh com trava anti-duplicata (pgrep no perfil
  jarvis-chrome). Voz premium: ElevenLabs "Elvis" (eleven:zNEsdgTUa3ndwKry8Xcq, modelo
  flash v2.5, speed 0.7–1.2) com ELEVENLABS_API_KEY no .env; sem chave/crédito cai
  automático para o William do Edge.
- Fase 3: `config/personality.json` + painel na engrenagem (presets JARVIS/FRIDAY/ULTRON/Neutro,
  sliders, tratamento, nome → muda wake word, voz). O servidor gera a persona dinamicamente e
  recria o query com `resume` na troca (sessão preservada). Memória de longo prazo em
  `data/memoria.md` ("lembra que…"), injetada na persona a cada recriação do agente.
- Conectores: servidor `workspace-mcp` (taylorwilsdon) em `~/.claude.json` (escopo user), modo
  single-user, `--tools gmail calendar --tool-tier core`. Precisa de um OAuth client próprio
  (crie um projeto no Google Cloud Console, tipo de app "Desktop", com a sua própria conta como
  test user) — client id/secret vão no seu `~/jarvis/.env`, nunca no repositório; token fica em
  `~/.google_workspace_mcp/credentials/`. Enviar e-mail exige confirmação verbal
  (regex SENSITIVE_TOOL no server.js); leitura passa direto. Links de autorização OAuth do
  workspace-mcp expiram em 10 min.
- Fase 2: standby contínuo descarta tudo sem "Jarvis" no frontend; comando na mesma frase
  executa direto; blip de ativação; chip 🎙 = modo privado. Mic interno (Mic1) é a entrada
  padrão — se trocar de mic, conferir Configurações → Som → Entrada.
- Atenção inteligente (13/09): janela de conversa de 90s renovada a cada interação; 10s
  pós-resposta aceitam fala direto; no resto da janela um classificador Haiku (sessão query()
  paralela, sem ferramentas, prompt SIM/NÃO com contexto do último turno) decide se a fala era
  com o assistente (~1–3s). Fora da janela, wake word obrigatória. Watchdog religa o
  reconhecimento a cada 5s se cair. Voz padrão: William multilíngue a 120% de velocidade
  (slider "Velocidade da fala" no painel).

## Lote de melhorias (13/09 — noite)

- **Fast lane**: hora/data/saudações/obrigado respondidos pelo servidor em ~10ms, sem gastar
  cota (lib/core.mjs `fastLaneReply`).
- **Emoção na voz** (ElevenLabs): erro soa sóbrio, boa notícia soa animada (`moodSettings`).
- **Medidor de consumo** na statusbar: % dos créditos ElevenLabs do mês + turnos do dia.
- **Modo ditado**: "Jarvis, anota aí" → transcreve tudo sem interpretar até "terminei";
  salva em ~/Documentos/notas/. "Cancela o ditado" descarta.
- **Modo mini**: chip ▭ na titlebar compacta a janela (estado no localStorage).
- **Barge-in por voz**: detector de energia com piso adaptativo + AEC — falar por cima do
  Jarvis por ~400ms o interrompe sem wake word (initVoiceDetector no index.html).
- **Celular na LAN**: https://IP-do-PC:3443/?t=TOKEN (token em .env JARVIS_LAN_TOKEN; cert
  autoassinado em certs/, aceitar o aviso do navegador uma vez; firewall já liberava >1024).
- **npm test**: 12 testes (chunker, sanitize, travas, fast lane, wake/fuzzy). Funções puras
  extraídas para lib/core.mjs e public/wake.js. A suíte já pegou um furo real: SENSITIVE_TOOL
  usava \b que não casa após "_" — envio de e-mail não estava sendo gateado.
- **Drive** ✓ funcionando (re-autorização Google concluída em 13/09).
- **Notion** ✓ funcionando (servidor oficial como `notionApi` em ~/.claude.json;
  `bin/add-notion.sh` automatiza esse passo — pede o token e configura tudo).
- **Pendentes (dependem de conta/vontade)**: wake word offline Porcupine (precisa AccessKey
  grátis do console Picovoice; a stack atual com alternativas+fuzzy cobre bem), WhatsApp
  (servidores MCP da comunidade ainda instáveis; reavaliar).

## Conectores

Nenhum é obrigatório — o Jarvis funciona sem eles, só perde essas capacidades específicas.

- **Gmail/Calendar/Drive**: crie um projeto no [Google Cloud Console](https://console.cloud.google.com),
  ative as APIs necessárias, crie credenciais OAuth tipo "Desktop app", e coloque o client
  id/secret no seu `.env` (`GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`). O servidor
  MCP (`workspace-mcp`) já está registrado pelo `install.sh`; na primeira chamada de uma
  ferramenta do Google, o Jarvis te manda um link de autorização.
- **Notion**: crie uma integração interna em notion.so/my-integrations, copie o token, e rode
  `bin/add-notion.sh` — ele pede o token e registra tudo. Depois compartilhe as páginas
  desejadas com a integração (menu ••• → Conexões).

## Operação

- Servidor: `systemctl --user {status,restart,stop} jarvis` · logs: `journalctl --user -u jarvis -f`
- Janela: `bin/jarvis-window.sh` (ou ícone JARVIS no GNOME); autostart em
  `~/.config/autostart/jarvis-window.desktop`.
- Workspace do agente: `~/Documentos` · porta 3111, só localhost.

## Diário de evolução

13/09/2026 — primeira auto-modificação, executada por mim mesmo
