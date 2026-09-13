# JARVIS — assistente pessoal por voz

Assistente estilo Jarvis: fala em pt-BR pelo microfone, o Claude Agent SDK executa, a resposta
volta falada (Edge TTS, voz Antônio). Plano completo e decisões: `design/JARVIS-PROJETO.md`
(handoff original) — **as decisões revisadas em 12/09/2026 valem sobre ele** (ver abaixo).

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
  single-user, `--tools gmail calendar --tool-tier core`. OAuth client próprio (projeto "jarvis"
  no Google Cloud, app em teste, Matheus como test user); client id/secret em `~/jarvis/.env`;
  token em `~/.google_workspace_mcp/credentials/`. Enviar e-mail exige confirmação verbal
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

## Operação

- Servidor: `systemctl --user {status,restart,stop} jarvis` · logs: `journalctl --user -u jarvis -f`
- Janela: `bin/jarvis-window.sh` (ou ícone JARVIS no GNOME); autostart em
  `~/.config/autostart/jarvis-window.desktop`.
- Workspace do agente: `~/Documentos` · porta 3111, só localhost.

## Diário de evolução

13/09/2026 — primeira auto-modificação, executada por mim mesmo
