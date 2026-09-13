# PROJETO JARVIS — Documento de Handoff

> **Instrução para o Claude Code:** Este documento é um handoff de outra sessão do Claude Code
> (mesma conta do usuário). Ele contém a visão, as decisões já tomadas e o código inicial de um
> projeto chamado **JARVIS**. Leia tudo, crie o projeto conforme especificado e comece a
> implementar imediatamente, sem re-discutir as decisões já tomadas (a menos que encontre um
> impedimento técnico real). O usuário fala português do Brasil — comunique-se em pt-BR.
>
> **A seção 12 (Análise Profunda) é a fonte de verdade técnica** — foi produzida por 4 agentes
> que leram o código-fonte dos projetos similares, os demos oficiais da Anthropic, os docs do
> SDK 0.3.x e o estado das libs de voz (set/2026). Onde ela contradiz seções anteriores, ela
> vence. Comece pela ordem de leitura da seção 12.7.

---

## 1. Visão

O usuário (Matheus) quer um assistente pessoal estilo **Jarvis/Ultron**: uma interface com a qual
ele conversa **por voz** (em português do Brasil), e que por trás usa o **Claude Code como agente**
para gerenciar "tudo" — arquivos, comandos no PC, e-mails, automações, e qualquer ferramenta que o
Claude Code alcance.

## 2. Decisões já tomadas (NÃO re-discutir)

| Decisão | Escolha | Motivo |
|---|---|---|
| Cérebro do agente | **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`, Node) | Herda tudo do Claude Code (ferramentas, MCP, permissões) e autentica pela **assinatura** do usuário (login do Claude Code), sem API key paga |
| Voz (TTS) | **Edge TTS gratuito** via pacote npm `msedge-tts`, voz `pt-BR-AntonioNeural` | Usuário quis qualidade tipo ElevenLabs **sem pagar nada**; vozes neurais da Microsoft são gratuitas e ótimas em pt-BR |
| Reconhecimento de fala (STT) | **Web Speech API do navegador** (Chrome/Edge, `lang: pt-BR`) | Grátis, zero configuração, boa qualidade |
| Escopo do MVP | **"Tudo possível"** — sem escopo fixo; o agente decide as ferramentas conforme o pedido | Escolha explícita do usuário |
| Stack | **100% Node.js** (Express + WebSocket + SDK + msedge-tts); frontend HTML/JS puro | Uma linguagem só, SDK nativo |
| Permissões do agente | `permissionMode: 'bypassPermissions'` | Usuário já configurou bypass no settings.json dele; quer o assistente autônomo |
| Formato da interface | **App desktop com Electron** (janela própria + bandeja do Windows) | Usuário quer "em forma de app", não aba de navegador; Electron embute o Chromium (Web Speech API funciona) e é Node |
| Ativação | **Wake word "Jarvis"** por voz, escuta contínua em standby | Usuário pediu ativação por voz explícita |
| Personalidade | **Configurável na UI** (painel de humor/tom com presets) | Usuário quer "configuração de humor igual do Jarvis" |

## 3. Arquitetura

```
🎤 Usuário fala
   ↓  (Web Speech API, pt-BR, no navegador)
Frontend (public/index.html) — UI estilo Jarvis
   ↓  WebSocket (texto do usuário)
Backend Node (server.js) — Express + ws na porta 3111
   ↓  query() do @anthropic-ai/claude-agent-sdk
Claude Code como agente — cwd = pasta Documents do usuário,
   bypassPermissions, persona JARVIS, sessão persistente (resume)
   ↓  resposta em texto
Edge TTS (msedge-tts) → MP3 → base64 → WebSocket → navegador toca
   ↓
🔊 Jarvis responde falando
```

Fluxo de uma interação: navegador reconhece a fala → manda texto pelo WS → backend roda o agente
(streaming; eventos de `tool_use` viram status na UI) → texto final é "sanitizado para fala"
(remove markdown/código/links) → TTS gera MP3 → navegador toca → volta a escutar.

## 4. Setup no PC de casa

```bash
# Pré-requisitos: Node.js 20+ (LTS) e Claude Code instalado e logado (mesma conta)
mkdir jarvis && cd jarvis
npm init -y
npm install @anthropic-ai/claude-agent-sdk msedge-tts express ws
mkdir public
```

No `package.json`, definir `"type": "module"` e script `"start": "node server.js"`.

## 5. Código já escrito — server.js

Este código foi escrito e revisado na sessão anterior. Usar como base (criar como `server.js`):

```js
// JARVIS — assistente pessoal por voz
// Backend: Express + WebSocket + Claude Agent SDK + Edge TTS (gratuito)

import express from 'express';
import http from 'http';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3111;
const VOICE = process.env.JARVIS_VOICE || 'pt-BR-AntonioNeural';
// Pasta que o agente usa como diretório de trabalho
const WORKSPACE = process.env.JARVIS_WORKSPACE || path.join(os.homedir(), 'Documents');

const PERSONA = `
# Persona: JARVIS

Você é JARVIS, o assistente pessoal por voz do Matheus. Regras de comunicação:
- Responda SEMPRE em português do Brasil.
- Suas respostas serão faladas em voz alta. Seja conciso e natural, como numa conversa:
  frases curtas, sem markdown, sem listas com bullets, sem blocos de código na resposta final
  (você pode usar ferramentas normalmente, só a resposta final deve ser "falável").
- Tom: educado, levemente espirituoso, eficiente — como o JARVIS do Homem de Ferro.
  Pode chamar o usuário de "senhor" ocasionalmente.
- Quando concluir uma tarefa, resuma em 1 a 3 frases o que fez.
- Se algo der errado, diga o que aconteceu e o que sugere fazer.
- Nunca leia em voz alta conteúdos longos na íntegra; resuma e ofereça detalhes se pedirem.
`.trim();

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

function sanitizeForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' (código na tela) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*?|__|~~|#+\s?/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' (link na tela) ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 1500);
}

async function synthesize(text) {
  const tts = new MsEdgeTTS();
  await tts.setMetadata(VOICE, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const result = await tts.toStream(text);
  const stream = result.audioStream ?? result; // compatível com API v1 e v2 do msedge-tts
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

wss.on('connection', (ws) => {
  let sessionId = null;
  let busy = false;
  const send = (obj) => { if (ws.readyState === 1) ws.send(JSON.stringify(obj)); };

  send({ type: 'hello', workspace: WORKSPACE, voice: VOICE });

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    if (msg.type !== 'user_text' || !msg.text?.trim()) return;
    if (busy) { send({ type: 'status', state: 'busy' }); return; }
    busy = true;
    send({ type: 'status', state: 'thinking' });

    let fullText = '';
    try {
      const q = query({
        prompt: msg.text,
        options: {
          cwd: WORKSPACE,
          permissionMode: 'bypassPermissions',
          systemPrompt: { type: 'preset', preset: 'claude_code', append: PERSONA },
          settingSources: ['user'],
          ...(sessionId ? { resume: sessionId } : {}),
        },
      });

      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') {
          sessionId = m.session_id;
        } else if (m.type === 'assistant') {
          for (const block of m.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) {
              fullText += block.text + '\n';
              send({ type: 'assistant_text', text: block.text });
            } else if (block.type === 'tool_use') {
              send({ type: 'tool', name: block.name });
            }
          }
        } else if (m.type === 'result' && m.subtype !== 'success') {
          send({ type: 'error', text: `A tarefa terminou com problema (${m.subtype}).` });
        }
      }

      const speech = sanitizeForSpeech(fullText) || 'Feito, senhor.';
      send({ type: 'status', state: 'speaking' });
      try {
        const audio = await synthesize(speech);
        send({ type: 'audio', data: audio.toString('base64'), mime: 'audio/mpeg' });
      } catch (e) {
        console.error('TTS falhou:', e.message);
        send({ type: 'tts_fallback', text: speech }); // frontend usa speechSynthesis do navegador
      }
    } catch (e) {
      console.error('Erro no agente:', e);
      send({ type: 'error', text: 'Erro ao processar: ' + e.message });
      send({ type: 'status', state: 'idle' });
    } finally {
      busy = false;
    }
  });
});

server.listen(PORT, () => {
  console.log(`JARVIS online em http://localhost:${PORT}`);
  console.log(`Workspace do agente: ${WORKSPACE}`);
  console.log(`Voz: ${VOICE}`);
});
```

## 6. Frontend a construir — public/index.html

Especificação (ainda não foi escrito — construir agora):

- **Visual**: tema escuro estilo Homem de Ferro — fundo quase preto, um "arc reactor" central
  (círculo com anéis animados, ciano `#00d4ff` com glow) que pulsa conforme o estado.
- **Estados visuais**: `idle` (pulso lento), `listening` (anel reagindo, cor ciano forte),
  `thinking` (rotação/spinner), `speaking` (pulso no ritmo, cor mais quente).
- **STT**: `webkitSpeechRecognition`, `lang = 'pt-BR'`, `interimResults = true`,
  `continuous = false`; ao obter resultado final, envia `{type:'user_text', text}` pelo WebSocket.
  Reiniciar o reconhecimento automaticamente após o Jarvis terminar de falar (modo conversa).
  **Pausar o reconhecimento enquanto o áudio toca** (evitar eco/feedback).
- **Áudio**: mensagens `{type:'audio', data: base64}` → tocar via
  `new Audio('data:audio/mpeg;base64,' + data)`. Ao terminar (`onended`), voltar a escutar.
  Se vier `{type:'tts_fallback', text}`, usar `speechSynthesis` do navegador com voz pt-BR.
- **UI adicional**: log da conversa (balões user/jarvis), linha de status mostrando a ferramenta
  em uso (mensagens `{type:'tool', name}` → ex. "usando Bash…"), botão de mic (toggle),
  campo de texto como fallback para digitar, indicador de conexão do WS (reconectar se cair).
- **Barge-in**: clicar no reactor enquanto fala interrompe o áudio e volta a escutar.
- Tudo em um único arquivo HTML (CSS e JS inline), sem frameworks.

## 6.1 App desktop (Electron)

O frontend da seção 6 roda dentro de uma janela Electron (não numa aba de navegador):

```bash
npm install --save-dev electron electron-builder
```

- **main.js do Electron**: cria `BrowserWindow` sem moldura (`frame: false`, fundo escuro,
  cantos arredondados), carrega `http://localhost:3111` (o server.js sobe como processo filho
  do Electron, ou no próprio processo main).
- **Bandeja do Windows** (`Tray`): ícone do arc reactor; clique abre/esconde a janela;
  menu com "Ouvindo sim/não", "Configurações", "Sair".
- **Atalho global** (`globalShortcut`): ex. `Ctrl+Shift+J` abre a janela e já ativa a escuta.
- **Auto-start**: `app.setLoginItemSettings({ openAtLogin: true })` (configurável na UI).
- **Permissão de microfone**: no Electron conceder via
  `session.setPermissionRequestHandler` (aprovar `media` automaticamente).
- **Build final**: `electron-builder` gera instalador `.exe` (NSIS) para Windows.
- Ordem de implementação: fazer o MVP no navegador primeiro (mais rápido de iterar),
  e "embrulhar" no Electron logo em seguida — o HTML não muda.

## 6.2 Ativação por voz — wake word "Jarvis"

Modo standby: o app fica escutando continuamente, mas SÓ procura a palavra de ativação.

**Fase 1 (MVP, grátis, sem dependências):** usar a própria Web Speech API em modo
`continuous: true`. Cada resultado é testado contra `/\b(jarvis|djarvis|jarves)\b/i`
(incluir variações que o reconhecedor pt-BR produz). Ao detectar:
1. tocar som curto de confirmação (blip estilo Iron Man) e acender o reactor;
2. capturar a fala que vem em seguida como o comando (se a frase já contém o comando —
   "Jarvis, abre meus e-mails" — usar o texto após a wake word direto);
3. após a resposta, voltar ao standby.

Cuidados: pausar o standby enquanto o Jarvis fala (eco); reiniciar o `recognition` no
`onend` (o Chrome derruba a escuta contínua periodicamente); botão na UI e na bandeja
para desligar a escuta ("modo privado").

**Fase 2 (upgrade, offline e mais preciso):** [openWakeWord](https://github.com/dscripka/openWakeWord)
ou Picovoice Porcupine (grátis para uso pessoal) rodando como processo local — detecção de
wake word sem depender do reconhecedor do Chrome, com menos falsos positivos.

## 6.3 Personalidade configurável (painel de humor)

Painel de configurações na UI (engrenagem) que edita um `config/personality.json`:

```json
{
  "preset": "jarvis",
  "tratamento": "senhor",
  "humor": 0.6,
  "sarcasmo": 0.3,
  "formalidade": 0.7,
  "prolixidade": 0.3,
  "nome_assistente": "Jarvis"
}
```

- **Presets prontos**: `jarvis` (britânico educado, espirituoso), `friday` (informal, direta),
  `ultron` (sarcástico, dramático — mas sempre obediente), `neutro` (sem persona).
- Sliders 0–1 para humor, sarcasmo, formalidade e prolixidade; campo para o tratamento
  ("senhor", "chefe", nome) e para renomear o assistente (muda também a wake word).
- O `server.js` lê esse arquivo a cada requisição e **gera o bloco PERSONA dinamicamente**
  a partir dos valores (ex.: sarcasmo 0.8 → "use ironia leve com frequência"; prolixidade
  0.2 → "responda no máximo em 2 frases"). Mudou no painel → próxima resposta já vem com
  o novo tom, sem reiniciar nada.
- A UI manda `{type:'set_personality', config}` pelo WebSocket; o servidor salva o JSON.
- A voz TTS também pode mudar por preset (ex.: FRIDAY → `pt-BR-FranciscaNeural`).

## 6.4 Poderes do agente — "tudo que o Claude Code faz"

O Agent SDK herda o Claude Code inteiro da máquina, então o Jarvis consegue, por voz:

- **PC e arquivos**: buscar/organizar arquivos, rodar comandos, instalar coisas, abrir programas.
- **Programar**: criar/editar projetos, rodar testes, fazer commits — "Jarvis, cria um script que…".
- **Conectores MCP** que estiverem configurados na conta/máquina (Gmail, Drive, Notion, GitHub…):
  "Jarvis, resume meus e-mails de hoje". Configurar via `claude mcp` na máquina de casa;
  com `settingSources: ['user']` o SDK enxerga os MCP servers do usuário.
- **Web**: pesquisar e buscar conteúdo de páginas.
- **Automações**: tarefas agendadas e rotinas ("todo dia às 8h me fala a agenda").
- Ações sensíveis (enviar e-mail, compras, publicar) continuam passando pelas travas de
  segurança do próprio Claude Code, mesmo em bypass — o Jarvis avisa em voz alta e pede
  confirmação verbal antes ("Confirma o envio, senhor?" → o "sim" falado vira a resposta).

## 6.5 Design visual — mockup aprovado

O visual do app já foi desenhado e aprovado pelo usuário. Mockup publicado em:
<https://claude.ai/code/artifact/7bee3621-e806-4414-b319-f0e45cac966a>
(mesma conta — dá para abrir de qualquer máquina). O código-fonte completo do mockup está
na seção 6.6 abaixo. **Seguir este design fielmente** ao construir o frontend.

**Tokens de design (usar exatamente estes):**

```css
:root{
  --ground:#05080f;   /* fundo geral */
  --window:#0a1220;   /* janela do app */
  --panel:#0e1a2b;    /* painéis internos */
  --edge:#1c3049;     /* bordas */
  --arc:#35e0ff;      /* ciano do arc reactor (cor principal) */
  --arc-dim:#1a8fb0;  /* ciano apagado (secundário) */
  --gold:#ffb84d;     /* dourado hot-rod — só para ferramenta em uso e estado "falando" */
  --text:#d7e9f4;
  --muted:#6f8ba3;
  --user:#16283f;     /* balão de mensagem do usuário */
}
```

**Tipografia (Google Fonts):** `Michroma` para wordmark/títulos HUD (sempre com letter-spacing
largo, tipo `.3em`, caixa alta) e `Rajdhani` (400–700) para todo o resto. Tema único escuro
(sem modo claro — é um HUD).

**Elementos-chave do layout:**
- Janela sem moldura: titlebar própria com 3 dots, wordmark "J.A.R.V.I.S.", chip "● ONLINE"
  e chip "🎙 escuta ativa" (clicável = modo privado) + engrenagem.
- Tela principal em 2 colunas: reactor à esquerda (com label de estado em Michroma e um
  equalizador de barras animado embaixo), log da conversa à direita, barra de status no rodapé
  (wake word · voz · workspace · sessão).
- **Arc reactor**: 3 anéis concêntricos (o do meio tracejado girando em 14s, o interno girando
  ao contrário em 9s) + núcleo com radial-gradient ciano e box-shadow de glow, pulsando em 2.6s.
- **Estados do reactor**: STANDBY (opacidade baixa, sem glow), OUVINDO (aceso, anel reage à voz),
  PROCESSANDO (anéis girando), FALANDO (núcleo e glow **dourados**, pulsa no ritmo).
- Linha de ferramenta em uso: texto dourado caixa-alta com dot brilhante ("USANDO GMAIL —…").
- Painel de configurações: chips de preset (ativo = fundo ciano com glow), sliders com track
  em gradient ciano e thumb brilhante, toggles estilo switch com glow quando ligados.
- Respeitar `prefers-reduced-motion` (desligar animações).

## 6.6 Código completo do mockup (referência visual)

Salvar como `design/mockup.html` no projeto para consulta. O frontend real (`public/index.html`)
deve reaproveitar este CSS — trocando as partes estáticas por comportamento real (WS, mic, áudio):

```html
<title>Interface do JARVIS</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Michroma&family=Rajdhani:wght@400;500;600;700&display=swap">
<style>
  :root{
    --ground:#05080f;        /* fundo da apresentação */
    --window:#0a1220;        /* janela do app */
    --panel:#0e1a2b;         /* painéis internos */
    --edge:#1c3049;          /* bordas */
    --arc:#35e0ff;           /* ciano do reactor */
    --arc-dim:#1a8fb0;
    --gold:#ffb84d;          /* dourado hot-rod, usado com parcimônia */
    --text:#d7e9f4;
    --muted:#6f8ba3;
    --user:#16283f;
  }
  *{box-sizing:border-box}
  body{
    margin:0; background:var(--ground); color:var(--text);
    font-family:'Rajdhani',system-ui,sans-serif; font-size:16px; line-height:1.5;
    padding:48px 20px 80px;
  }
  .wrap{max-width:980px;margin:0 auto}
  .eyebrow{
    font-size:12px;letter-spacing:.28em;text-transform:uppercase;color:var(--arc-dim);
    margin:0 0 10px;
  }
  h1{
    font-family:'Michroma',sans-serif;font-size:clamp(22px,4vw,34px);
    margin:0 0 8px;letter-spacing:.06em;text-wrap:balance;
  }
  .lede{color:var(--muted);max-width:62ch;margin:0 0 40px}
  h2{
    font-size:13px;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);
    margin:56px 0 6px;font-weight:600;
  }
  .sub{color:var(--muted);margin:0 0 18px;max-width:65ch}

  /* ---------- janela do app ---------- */
  .app{
    background:var(--window);border:1px solid var(--edge);border-radius:14px;
    box-shadow:0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(53,224,255,.04);
    overflow:hidden;
  }
  .titlebar{
    display:flex;align-items:center;gap:10px;padding:10px 16px;
    border-bottom:1px solid var(--edge);background:rgba(5,8,15,.5);
  }
  .dots{display:flex;gap:6px}
  .dots i{width:10px;height:10px;border-radius:50%;background:#22354d;display:block}
  .titlebar .name{
    font-family:'Michroma',sans-serif;font-size:11px;letter-spacing:.34em;margin-left:6px;
  }
  .chip{
    font-size:11px;letter-spacing:.14em;padding:2px 10px;border-radius:999px;
    border:1px solid var(--edge);color:var(--muted);
  }
  .chip.on{color:var(--arc);border-color:rgba(53,224,255,.35)}
  .titlebar .right{margin-left:auto;display:flex;gap:8px}

  .stage{display:grid;grid-template-columns:1.1fr 1fr;min-height:430px}
  @media (max-width:720px){.stage{grid-template-columns:1fr}}

  /* reactor */
  .reactor-zone{
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:22px;padding:36px 20px;
    background:radial-gradient(circle at 50% 45%, rgba(53,224,255,.07), transparent 60%);
  }
  .reactor{position:relative;width:190px;height:190px}
  .reactor .ring{
    position:absolute;inset:0;border-radius:50%;
    border:2px solid rgba(53,224,255,.35);
  }
  .reactor .ring.r2{inset:20px;border-style:dashed;animation:spin 14s linear infinite}
  .reactor .ring.r3{inset:40px;border-color:rgba(53,224,255,.6);animation:spin 9s linear infinite reverse}
  .reactor .core{
    position:absolute;inset:62px;border-radius:50%;
    background:radial-gradient(circle, #d9fbff 0%, var(--arc) 45%, rgba(53,224,255,.15) 100%);
    box-shadow:0 0 34px rgba(53,224,255,.75), 0 0 90px rgba(53,224,255,.3);
    animation:pulse 2.6s ease-in-out infinite;
  }
  @keyframes spin{to{transform:rotate(360deg)}}
  @keyframes pulse{50%{box-shadow:0 0 20px rgba(53,224,255,.5),0 0 60px rgba(53,224,255,.2)}}
  @media (prefers-reduced-motion:reduce){.reactor .ring,.reactor .core,.wave i{animation:none}}

  .state{
    font-family:'Michroma',sans-serif;font-size:12px;letter-spacing:.3em;color:var(--arc);
  }
  .wave{display:flex;gap:4px;align-items:flex-end;height:26px}
  .wave i{width:4px;background:var(--arc-dim);border-radius:2px;animation:wv 1.1s ease-in-out infinite}
  .wave i:nth-child(1){height:8px}.wave i:nth-child(2){height:18px;animation-delay:.1s}
  .wave i:nth-child(3){height:26px;animation-delay:.2s}.wave i:nth-child(4){height:14px;animation-delay:.3s}
  .wave i:nth-child(5){height:22px;animation-delay:.4s}.wave i:nth-child(6){height:10px;animation-delay:.5s}
  @keyframes wv{50%{transform:scaleY(.45)}}

  /* conversa */
  .log{
    border-left:1px solid var(--edge);padding:22px;display:flex;flex-direction:column;gap:12px;
  }
  @media (max-width:720px){.log{border-left:0;border-top:1px solid var(--edge)}}
  .msg{max-width:90%;padding:10px 14px;border-radius:10px;font-size:15px}
  .msg .who{font-size:10px;letter-spacing:.22em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:2px}
  .msg.user{background:var(--user);align-self:flex-end;border:1px solid #24405f}
  .msg.jarvis{background:var(--panel);border:1px solid var(--edge)}
  .msg.jarvis .who{color:var(--arc-dim)}
  .toolline{
    font-size:12px;letter-spacing:.14em;color:var(--gold);text-transform:uppercase;
    display:flex;align-items:center;gap:8px;
  }
  .toolline::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--gold);box-shadow:0 0 8px var(--gold)}
  .inputbar{
    margin-top:auto;display:flex;gap:8px;border:1px solid var(--edge);border-radius:10px;
    padding:9px 14px;color:var(--muted);font-size:14px;align-items:center;
  }
  .inputbar span{flex:1}
  .mic{color:var(--arc);font-size:15px}

  .statusbar{
    display:flex;gap:18px;flex-wrap:wrap;padding:9px 18px;border-top:1px solid var(--edge);
    font-size:12px;letter-spacing:.1em;color:var(--muted);background:rgba(5,8,15,.5);
  }
  .statusbar b{color:var(--arc-dim);font-weight:600}

  /* legenda / callouts */
  .callouts{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:14px}
  .co{border:1px solid var(--edge);border-radius:10px;padding:10px 14px;background:rgba(14,26,43,.5)}
  .co b{display:block;font-size:12px;letter-spacing:.18em;text-transform:uppercase;color:var(--arc-dim);margin-bottom:2px}
  .co p{margin:0;font-size:14px;color:var(--muted)}

  /* estados do reactor */
  .states{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px}
  .st{
    border:1px solid var(--edge);border-radius:12px;padding:18px 12px;text-align:center;
    background:var(--window);
  }
  .st .mini{
    width:54px;height:54px;border-radius:50%;margin:0 auto 12px;
    border:2px solid rgba(53,224,255,.35);position:relative;
  }
  .st .mini::after{
    content:"";position:absolute;inset:14px;border-radius:50%;
    background:radial-gradient(circle,#d9fbff 0%,var(--arc) 55%,transparent 100%);
    box-shadow:0 0 14px rgba(53,224,255,.6);
  }
  .st.idle .mini::after{opacity:.35;box-shadow:none}
  .st.think .mini{border-style:dashed;animation:spin 5s linear infinite}
  .st.speak .mini::after{background:radial-gradient(circle,#fff3dd 0%,var(--gold) 55%,transparent 100%);box-shadow:0 0 14px rgba(255,184,77,.6)}
  .st b{font-family:'Michroma',sans-serif;font-size:10px;letter-spacing:.24em;display:block;margin-bottom:4px}
  .st p{margin:0;font-size:13px;color:var(--muted)}

  /* painel de personalidade */
  .settings{padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:26px}
  @media (max-width:720px){.settings{grid-template-columns:1fr}}
  .field label{font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--muted);display:block;margin-bottom:8px}
  .presets{display:flex;gap:8px;flex-wrap:wrap}
  .preset{
    padding:7px 16px;border-radius:999px;border:1px solid var(--edge);font-size:14px;
    font-weight:600;letter-spacing:.06em;color:var(--muted);
  }
  .preset.on{color:#04222c;background:var(--arc);border-color:var(--arc);box-shadow:0 0 16px rgba(53,224,255,.4)}
  .slider{margin-bottom:16px}
  .slider .row{display:flex;justify-content:space-between;font-size:14px;margin-bottom:6px}
  .slider .val{font-variant-numeric:tabular-nums;color:var(--arc-dim);font-weight:600}
  .track{height:5px;border-radius:3px;background:var(--edge);position:relative}
  .track i{position:absolute;left:0;top:0;bottom:0;border-radius:3px;background:linear-gradient(90deg,var(--arc-dim),var(--arc))}
  .track b{
    position:absolute;top:50%;width:14px;height:14px;border-radius:50%;background:#d9fbff;
    transform:translate(-50%,-50%);box-shadow:0 0 10px rgba(53,224,255,.7);
  }
  .selectbox,.textbox{
    border:1px solid var(--edge);border-radius:8px;padding:9px 14px;font-size:15px;
    display:flex;justify-content:space-between;color:var(--text);background:var(--panel);
  }
  .selectbox span:last-child{color:var(--muted)}
  .toggles{display:flex;flex-direction:column;gap:12px}
  .tg{display:flex;justify-content:space-between;align-items:center;font-size:15px}
  .sw{width:38px;height:20px;border-radius:999px;background:var(--edge);position:relative;flex-shrink:0}
  .sw::after{content:"";position:absolute;top:3px;left:4px;width:14px;height:14px;border-radius:50%;background:var(--muted)}
  .sw.on{background:rgba(53,224,255,.25)}
  .sw.on::after{left:auto;right:4px;background:var(--arc);box-shadow:0 0 8px rgba(53,224,255,.7)}

  footer{margin-top:64px;color:var(--muted);font-size:13px;border-top:1px solid var(--edge);padding-top:16px;max-width:70ch}
</style>

<div class="wrap">
  <p class="eyebrow">Projeto Jarvis · Mockup da interface</p>
  <h1>J.A.R.V.I.S.</h1>
  <p class="lede">Visual de referência do app desktop (Electron, janela sem moldura). Nada aqui é funcional —
  é o desenho que o Claude Code de casa vai usar como alvo nas Fases 1 a 4 do JARVIS-PROJETO.md.</p>

  <h2>Tela principal</h2>
  <p class="sub">Reactor central com estado, conversa à direita, barra de status embaixo. A cena mostra o meio de uma tarefa real: você pediu por voz, ele está usando o Gmail e responde falando.</p>

  <div class="app">
    <div class="titlebar">
      <div class="dots"><i></i><i></i><i></i></div>
      <span class="name">J.A.R.V.I.S.</span>
      <span class="chip on">● ONLINE</span>
      <div class="right">
        <span class="chip">🎙 escuta ativa</span>
        <span class="chip">⚙</span>
      </div>
    </div>
    <div class="stage">
      <div class="reactor-zone">
        <div class="reactor">
          <div class="ring"></div><div class="ring r2"></div><div class="ring r3"></div>
          <div class="core"></div>
        </div>
        <span class="state">PROCESSANDO…</span>
        <div class="wave"><i></i><i></i><i></i><i></i><i></i><i></i></div>
      </div>
      <div class="log">
        <div class="msg user"><span class="who">Matheus</span>Jarvis, resume meus e-mails de hoje.</div>
        <div class="toolline">usando Gmail — buscando threads…</div>
        <div class="msg jarvis"><span class="who">Jarvis</span>Pois não, senhor. Chegaram 14 e-mails hoje: 3 merecem sua atenção — o do SENAI sobre a matrícula, um retorno da vaga que o senhor aplicou, e a fatura do cartão vence amanhã. Quer que eu detalhe algum?</div>
        <div class="inputbar"><span>ou digite um comando…</span><span class="mic">🎙</span></div>
      </div>
    </div>
    <div class="statusbar">
      <span>wake word: <b>"Jarvis"</b></span>
      <span>voz: <b>Antônio · pt-BR</b></span>
      <span>workspace: <b>C:\Users\Matheus\Documents</b></span>
      <span>sessão: <b>contínua</b></span>
    </div>
  </div>

  <div class="callouts">
    <div class="co"><b>Wake word</b><p>Em standby, o app só procura "Jarvis". Ao ouvir, blip de confirmação e o reactor acende.</p></div>
    <div class="co"><b>Ferramenta em uso</b><p>A linha dourada mostra o que o agente está fazendo (Gmail, Bash, arquivos…).</p></div>
    <div class="co"><b>Modo privado</b><p>O chip "escuta ativa" desliga o microfone com um clique — também pela bandeja do Windows.</p></div>
    <div class="co"><b>Barge-in</b><p>Clicar no reactor enquanto ele fala interrompe o áudio e volta a escutar.</p></div>
  </div>

  <h2>Estados do reactor</h2>
  <p class="sub">O reactor é o indicador principal — dá para saber o que o Jarvis está fazendo do outro lado da sala.</p>
  <div class="states">
    <div class="st idle"><div class="mini"></div><b>STANDBY</b><p>Pulso fraco, esperando a wake word</p></div>
    <div class="st"><div class="mini"></div><b>OUVINDO</b><p>Aceso, anel reage à sua voz</p></div>
    <div class="st think"><div class="mini"></div><b>PROCESSANDO</b><p>Anéis girando enquanto executa</p></div>
    <div class="st speak"><div class="mini"></div><b>FALANDO</b><p>Tom dourado, pulsa no ritmo da fala</p></div>
  </div>

  <h2>Painel de personalidade</h2>
  <p class="sub">Aberto pela engrenagem. Cada ajuste reescreve a persona do agente na hora — a próxima resposta já vem no novo tom.</p>

  <div class="app">
    <div class="titlebar">
      <div class="dots"><i></i><i></i><i></i></div>
      <span class="name">CONFIGURAÇÕES</span>
      <span class="chip">personalidade</span>
    </div>
    <div class="settings">
      <div>
        <div class="field" style="margin-bottom:22px">
          <label>Preset</label>
          <div class="presets">
            <span class="preset on">JARVIS</span>
            <span class="preset">FRIDAY</span>
            <span class="preset">ULTRON</span>
            <span class="preset">Neutro</span>
          </div>
        </div>
        <div class="slider"><div class="row"><span>Humor</span><span class="val">60%</span></div>
          <div class="track"><i style="width:60%"></i><b style="left:60%"></b></div></div>
        <div class="slider"><div class="row"><span>Sarcasmo</span><span class="val">30%</span></div>
          <div class="track"><i style="width:30%"></i><b style="left:30%"></b></div></div>
        <div class="slider"><div class="row"><span>Formalidade</span><span class="val">70%</span></div>
          <div class="track"><i style="width:70%"></i><b style="left:70%"></b></div></div>
        <div class="slider"><div class="row"><span>Prolixidade</span><span class="val">30%</span></div>
          <div class="track"><i style="width:30%"></i><b style="left:30%"></b></div></div>
      </div>
      <div>
        <div class="field" style="margin-bottom:18px">
          <label>Tratamento</label>
          <div class="textbox"><span>senhor</span></div>
        </div>
        <div class="field" style="margin-bottom:18px">
          <label>Voz</label>
          <div class="selectbox"><span>Antônio — pt-BR neural</span><span>▾</span></div>
        </div>
        <div class="field">
          <label>Comportamento</label>
          <div class="toggles">
            <div class="tg"><span>Iniciar com o Windows</span><span class="sw on"></span></div>
            <div class="tg"><span>Escuta contínua (wake word)</span><span class="sw on"></span></div>
            <div class="tg"><span>Confirmação verbal p/ ações sensíveis</span><span class="sw on"></span></div>
            <div class="tg"><span>Sons de ativação</span><span class="sw on"></span></div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <footer>
    Mockup estático · Projeto JARVIS · A wake word e o nome do assistente mudam juntos ao trocar o preset
    (FRIDAY usa a voz Francisca). Referência visual para o handoff em JARVIS-PROJETO.md.
  </footer>
</div>
```

## 7. Protocolo WebSocket (já definido)

| Direção | Mensagem | Significado |
|---|---|---|
| S→C | `{type:'hello', workspace, voice}` | Conexão estabelecida |
| C→S | `{type:'user_text', text}` | Fala/texto do usuário |
| S→C | `{type:'status', state}` | `thinking` / `speaking` / `busy` / `idle` |
| S→C | `{type:'assistant_text', text}` | Texto do Jarvis (mostrar no log) |
| S→C | `{type:'tool', name}` | Agente usando ferramenta (mostrar status) |
| S→C | `{type:'audio', data, mime}` | MP3 base64 para tocar |
| S→C | `{type:'tts_fallback', text}` | TTS do servidor falhou; usar voz do navegador |
| S→C | `{type:'error', text}` | Erro |

## 8. Plano de execução no PC de casa (em fases)

**Fase 1 — MVP no navegador (fazer primeiro):**
1. Criar o projeto (seção 4) e o `server.js` (seção 5).
2. Construir o `public/index.html` (seções 6, 6.5 e 6.6 — reaproveitar o CSS do mockup;
   salvar o mockup em `design/mockup.html` como referência).
3. Rodar `npm start`, abrir `http://localhost:3111` no Chrome/Edge, permitir o microfone.
4. **Aplicar a seção 11.3 item 1**: fala progressiva frase a frase (streaming TTS) já na
   Fase 1 — o server.js da seção 5 é o ponto de partida, mas o TTS deve ser por frases.
5. Testar de ponta a ponta: "Jarvis, que arquivos tem na minha pasta Documentos?" —
   deve escutar, pensar (agente lista os arquivos) e responder falando em ~1–2s.

**Fase 2 — Wake word:** escuta contínua com detecção de "Jarvis" (seção 6.2, fase 1).

**Fase 3 — Personalidade:** painel de humor + geração dinâmica da PERSONA (seção 6.3).

**Fase 4 — App Electron:** janela própria, bandeja, atalho global, auto-start (seção 6.1);
`electron-builder` para gerar o instalador.

**Fase 5 — Polimento:** sons de ativação, animações do reactor, confirmação verbal para
ações sensíveis, interromper tarefa por voz ("Jarvis, cancela").

## 9. Roadmap (depois das fases acima)

- **Wake word offline** (openWakeWord/Porcupine) para menos falsos positivos.
- **Voz premium plugável** — trocar `synthesize()` por ElevenLabs/OpenAI se o usuário decidir pagar.
- **STT local com Whisper** (`faster-whisper`) se quiser independência do navegador.
- **Acesso pelo celular** na rede local (o servidor já escuta em HTTP; requer HTTPS para mic em
  origem não-localhost — considerar certificado local ou túnel).
- **Memória persistente do Jarvis** (o SDK retoma sessão com `resume`, mas avaliar salvar
  `sessionId` em disco para sobreviver a restarts; memória de longo prazo tipo "lembra que
  eu gosto de X" via arquivo de memória que entra na PERSONA).

## 10. Notas técnicas e avisos importantes

- **Autenticação**: o Agent SDK usa o login do Claude Code da máquina (`claude` logado na conta).
  Não precisa de `ANTHROPIC_API_KEY`. Se aparecer erro de auth, rodar `claude` no terminal e logar.
- **Consumo**: cada interação consome uso da assinatura (Max/Pro). O usuário está nos últimos dias
  do Max e pode voltar ao Pro — o projeto funciona nos dois, o Pro só tem limite menor.
- **`msedge-tts` v2**: o `toStream()` retorna `{ audioStream }`; o código já trata as duas APIs.
  O pacote reclama de pnpm no preinstall (`npx only-allow pnpm`) — com npm funciona mesmo assim;
  se o install falhar, usar `npm install --ignore-scripts msedge-tts`.
- **Segurança**: `bypassPermissions` dá ao agente poder total na máquina, sem confirmações.
  É a escolha do usuário, mas o servidor deve escutar apenas em localhost por padrão.
- **Navegador**: Web Speech API (STT) funciona bem no **Chrome e Edge**; não funciona no Firefox.
- Na sessão original (PC do SENAI, sem admin) foi validado: instalação portátil de Node 24 LTS
  via zip funciona sem admin, e as dependências acima instalam sem vulnerabilidades.

## 11. Pesquisa de mercado — projetos existentes (estudar antes de codar)

Pesquisa feita em 12/09/2026. **Já existem vários projetos "voz + Claude Code"** — validam nossa
arquitetura e ensinam os erros a evitar. Estudar os READMEs abaixo antes da Fase 1.

### 11.1 Projetos mais relevantes (mesma ideia que a nossa)

| Projeto | O que é | Lições para nós |
|---|---|---|
| [jaredrhod/backtalk](https://github.com/jaredrhod/backtalk) | O mais próximo do nosso: voz para o Claude Code via **Agent SDK**, STT local (`faster-whisper`), TTS local (Kokoro) ou ElevenLabs. Push-to-talk. Suporta Windows. | 1–2s de latência em turnos "quentes" usando **fala progressiva frase a frase** (não espera a resposta terminar). Personalidade herdada do CLAUDE.md da pasta-alvo. ⚠️ **Licença AGPL — usar só como inspiração, NÃO copiar código** (contaminaria nosso projeto). |
| [aayushdebugging/claude-voice](https://github.com/aayushdebugging/claude-voice) | Conversa em tempo real com o Claude CLI: STT → Claude (`stream-json`) → parser de frases → fila de TTS. Stack 100% local/grátis opcional (whisper.cpp + Kokoro). | **A melhor referência de latência**: geração, síntese e reprodução rodam **em paralelo, sem bloquear**; frases entram numa **fila de áudio interruptível** (barge-in de verdade: falou por cima → para o áudio E a geração). Áudio "sem emendas" usando um stream persistente. Tem **cliente de celular**: servidor web na LAN protegido por token. |
| [Kevthetech143/claude-voice](https://github.com/Kevthetech143/claude-voice) | Assistente com integração Claude Code via MCP, usa a **assinatura** (sem API key). | Confirma nosso approach de assinatura. **Chunking de frases: começa a falar a 1ª frase enquanto o Claude ainda pensa** — reduz drasticamente a latência percebida. Wake word via Porcupine (planejado lá, nós já planejamos igual). |
| [antonbugaets/claude-voice-assistant](https://github.com/antonbugaets/claude-voice-assistant) | Interface de voz para o Claude Code CLI com Whisper + **VAD** (detecção de atividade de voz) e persistência de sessão. | VAD melhora muito a troca de turnos (sabe quando você parou de falar, sem depender de timeout do navegador). |
| [anthropics/claude-agent-sdk-demos](https://github.com/anthropics/claude-agent-sdk-demos) | **Demos oficiais da Anthropic.** O "Simple Chat App" (Express + WebSocket + streaming) é exatamente o nosso backend; o "Hello World V2" mostra a **Session API V2** (`send()`/`stream()`) para conversa multi-turno. | Nossa arquitetura Express+WS+streaming é o padrão oficial. **Avaliar a Session API V2** (`unstable_v2_*`) no lugar de `resume` a cada query — sessão fica aberta, menos overhead por turno. |

### 11.2 Jarvis "clássicos" (menos relevantes, mas úteis de conhecer)

- [kishanrajput23/Jarvis-Desktop-Voice-Assistant](https://github.com/kishanrajput23/Jarvis-Desktop-Voice-Assistant) (~900 ★) e
  [vannu07/jarvis](https://github.com/vannu07/jarvis) — Jarvis em Python com comandos fixos
  (abrir programa, clima…). Nosso approach com agente é estritamente superior (linguagem natural
  livre), mas os repositórios têm boas ideias de UX (sons, saudações, rotinas).
- Feature requests abertos no próprio Claude Code pedindo modo de voz nativo
  ([#36745](https://github.com/anthropics/claude-code/issues/36745),
  [#34305](https://github.com/anthropics/claude-code/issues/34305)) — ou seja, não existe
  solução oficial ainda; nosso projeto preenche um gap real.

### 11.3 Mudanças no NOSSO plano por causa da pesquisa (obrigatórias)

1. **Fala progressiva frase a frase (streaming TTS)** — a lição unânime dos 3 melhores projetos.
   O `server.js` da seção 5 espera a resposta inteira antes do TTS; **mudar na Fase 1**:
   - conforme os blocos de texto chegam do SDK, quebrar em frases (regex `/[.!?…]\s/`);
   - sintetizar cada frase já no backend (`synthesize(frase)`) em paralelo com a geração;
   - enviar cada MP3 pelo WS na ordem (`{type:'audio_chunk', seq, data}`);
   - no frontend, **fila de reprodução gapless** (tocar `seq` n+1 no `onended` do n, com
     pré-carregamento). Latência-alvo: começar a falar em ~1–2s.
2. **Barge-in de verdade** — a fila de áudio deve ser **interruptível**: usuário falou/clicou →
   limpar a fila, parar o áudio atual E interromper a query do SDK (abortar o generator).
3. ~~Avaliar Session API V2~~ **RESOLVIDO pela análise profunda (seção 12): a API V2
   (`unstable_v2_*`) foi REMOVIDA no SDK 0.3.x — usar `query()` em streaming input mode
   (seção 12.2), que é o padrão oficial recomendado.**
4. **Roadmap ratificado pela pesquisa**: VAD (fase 5), STT local `faster-whisper`/`whisper.cpp`
   e TTS local Kokoro como fallback offline (roadmap), cliente de celular via servidor LAN com
   token (roadmap — o aayushdebugging/claude-voice mostra o caminho).
5. **Licenças**: backtalk é AGPL → só inspiração conceitual. Os demos oficiais da Anthropic
   (MIT) podem ser copiados à vontade.

## 12. ANÁLISE PROFUNDA (força total) — 4 agentes escanearam o código-fonte de tudo

Análise feita em 12/09/2026 por 4 agentes em paralelo que leram o código-fonte dos projetos
similares, os demos oficiais da Anthropic, a documentação do SDK e o estado das bibliotecas de
voz. **Esta seção corrige e detalha as anteriores — em conflito, a seção 12 vence.**

### 12.1 ⚠️ Duas correções críticas ao plano original

1. **Web Speech API (STT) NÃO funciona no Electron.** O reconhecimento de voz do Chrome depende
   do serviço do Google, que exige chaves que o Electron não tem (erro `network error` imediato —
   [electron#7749](https://github.com/electron/electron/issues/7749)). Consequência:
   - **Fase 1 (MVP no navegador Chrome/Edge)**: continua como planejado, Web Speech API funciona.
   - **Fase 4 (Electron)**: trocar o STT pela stack da seção 12.5 (Vosk + VAD + Porcupine).
   - `speechSynthesis` (TTS) até funciona no Electron, mas com vozes SAPI ruins — irrelevante,
     nosso TTS é o msedge-tts no backend.
2. **A Session API V2 do SDK (`unstable_v2_*`) foi REMOVIDA no SDK 0.3.x** (existia só até
   0.1.77). O padrão correto e oficial para conversa multi-turno é `query()` com **streaming
   input mode** (seção 12.2) — o prompt é um AsyncIterable/fila; cada fala do usuário é um
   `push` na fila, a sessão nunca fecha, e o `resume` por query do server.js da seção 5 fica
   obsoleto (usar só para retomar após restart do servidor).

### 12.2 O padrão definitivo do backend (validado nos docs oficiais do SDK 0.3.x)

O demo oficial `simple-chatapp` usa exatamente isto (Express + `WebSocketServer({server, path:'/ws'})`
+ heartbeat ping/pong de 30 s). **Reescrever o coração do server.js da seção 5 assim:**

```ts
import { query, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

// Fila assíncrona: cada fala do usuário entra aqui; a sessão vive para sempre
const queue: SDKUserMessage[] = []; let wake: (() => void) | null = null;
async function* input(): AsyncGenerator<SDKUserMessage> {
  while (true) {
    if (queue.length) yield queue.shift()!;
    else await new Promise<void>(r => (wake = r));
  }
}

const q = query({ prompt: input(), options: {
  model: "sonnet",                      // ou ID completo pinado (lição do backtalk)
  includePartialMessages: true,         // ESSENCIAL: streaming token a token p/ TTS por frase
  systemPrompt: { type: "preset", preset: "claude_code", append: PERSONA },
  permissionMode: "bypassPermissions",
  settingSources: ["user"],             // default é VAZIO — sem isso não vê MCP/CLAUDE.md
  maxTurns: 100,
  cwd: WORKSPACE,
}});

export function send(text: string) {
  queue.push({ type: "user", message: { role: "user", content: text },
               parent_tool_use_id: null } as SDKUserMessage);
  wake?.(); wake = null;
}
export const bargeIn = () => q.interrupt();  // corta o turno atual, SESSÃO CONTINUA

(async () => { let buf = "";
  for await (const m of q) {
    if (m.type === "stream_event" && !m.parent_tool_use_id &&
        m.event.type === "content_block_delta" && m.event.delta.type === "text_delta") {
      buf += m.event.delta.text;
      const i = buf.search(/[.!?…]\s/);
      if (i >= 0) { speakSentence(buf.slice(0, i + 1)); buf = buf.slice(i + 1); }
    }
    if (m.type === "assistant") { /* opcional: texto consolidado p/ o log da UI */ }
    if (m.type === "result") { if (buf.trim()) speakSentence(buf); buf = ""; }
  }
})();
```

Pontos não óbvios confirmados nos docs:
- `query.interrupt()` **só funciona em streaming input mode** — motivo extra para este padrão.
  `abortController.abort()` mata o processo inteiro (não usar para barge-in).
- `stream_event` com `parent_tool_use_id !== null` vem de subagentes — **ignorar** no TTS.
- `settingSources` tem default **vazio**: sem `['user']` o agente não enxerga os MCP servers
  nem preferências do usuário.
- Windows: SDK publica binário nativo `@anthropic-ai/claude-agent-sdk-win32-x64`, Node ≥18,
  sem WSL. Autenticação: sem `ANTHROPIC_API_KEY` o SDK usa o login do Claude Code da máquina
  (assinatura Pro/Max) — para uso pessoal funciona; alternativa: `claude setup-token` →
  `CLAUDE_CODE_OAUTH_TOKEN`. (Restrição oficial: isso vale para uso pessoal; distribuir um
  produto público exigiria API key.)

### 12.3 Receita de latência (do código-fonte dos melhores projetos)

**Quebrador de frases** (regras do aayushdebugging/claude-voice, `sentence-parser.ts`):
- Terminadores: `. ? !` + quebra de parágrafo (`/\n[ \t]*\n/`).
- Proteções: set de abreviações (Dr., Sr., e.g.…), decimais (`3.14`), flush de segurança por
  `maxLength` cortando no último espaço; mínimo ~10–24 chars por frase (evita fragmentos).
- Modo "fala rápida" opcional: fronteiras suaves `, ; : —` com mínimo 24 chars (menor latência
  da primeira fala, prosódia um pouco pior).

**Fila dupla** (`pendingText` → `readyClips`): loops independentes de síntese e reprodução;
sintetizar **uma frase à frente** do playback (não em lote); falha de TTS numa frase = retry +
skip, nunca silenciar o resto.

**Reprodução gapless no navegador** (melhor que os projetos analisados): Web Audio API —
`decodeAudioData` por chunk e `source.start(nextTime)` com `nextTime += buffer.duration`.
Cada chunk chega pelo WS como frame binário com número de sequência.

**Barge-in (ordem exata, do código do aayushdebugging):**
1. **Cortar o áudio PRIMEIRO** (parar os sources / destruir o stream) — corte instantâneo;
2. `q.interrupt()` no SDK (turno morre, sessão vive);
3. Limpar as duas filas (`pendingText`, `readyClips`);
4. Redirecionar a nova fala do usuário para o agente.

**Instrumentação desde o dia 1**: timestamps por estágio (fim da fala do usuário → 1º token →
1ª frase → 1º áudio tocando) e mostrar na UI (ex.: `2.4s · 45w`). Latência-alvo: ≤2 s warm.

**Parâmetros de áudio validados** (backtalk + claude-voice-assistant): captura 16 kHz mono
int16, frames de 30 ms (480 samples). VAD webrtcvad agressividade 2–3: abre com ~120 ms de
fala, fecha com 500–900 ms de silêncio, rejeita <240 ms como ruído. Silero VAD: threshold
início 0,85 / continuação 0,5, pre-buffer ~320 ms.

### 12.4 Pegadinhas conhecidas (issues reais dos projetos — evitar de graça)

- **Windows descarta áudio 24 kHz mono silenciosamente** (backtalk #40) — reamostrar a saída
  para 48 kHz ao tocar no Windows nativo (no navegador o Web Audio resolve sozinho).
- **Gravações muito curtas alucinam o Whisper** (backtalk #43) — descartar capturas <240 ms.
- **Tool results grandes (>1 MB) quebram a sessão do SDK** (backtalk #38) — na PERSONA,
  instruir o agente a paginar/resumir saídas grandes (ex.: `head`, filtros).
- **Trocar fone/mic depois de abrir o app mata a captura** (backtalk #34) — pinar o dispositivo
  de entrada por nome nas configurações e reabrir o stream ao detectar mudança.
- **Split de frases erra em abreviações** ("Dr. Silva" vira 2 frases) — usar o set de
  abreviações pt-BR no chunker (Dr., Sra., Sr., ex., etc., av., R$…).
- **Warm-up**: transcrever 100 ms de silêncio no boot (se usar Whisper local) e pré-conectar
  o msedge-tts — o 1º turno frio cai de ~5 s para ~2 s.
- Som sutil de "processando" mascara a espera (truque do backtalk que muda a sensação de vida).

### 12.5 Stack de voz definitiva para Windows (pesquisa set/2026)

| Camada | Fase 1 (navegador) | Fase 4 (Electron) | Upgrade futuro |
|---|---|---|---|
| Captura + VAD | Web Speech API resolve | **`@ricky0123/vad-web`** (Silero, roda no renderer; servir os assets wasm/onnx LOCALMENTE, não de CDN) | idem |
| Wake word | Regex na transcrição contínua | **`@picovoice/porcupine-node`** — keyword **"Jarvis" é built-in e gratuita** (precisa AccessKey grátis do console Picovoice; ativação online periódica) | keyword customizada pt-BR |
| STT | Web Speech API (`lang: pt-BR`) | **`vosk`** npm + modelo `vosk-model-small-pt-0.3` (~50 MB, streaming em tempo real, leve) | faster-whisper `small` int8 (sidecar Python) ou modelo FalaBrasil `vosk-model-pt-fb-v0.1.1` (1,6 GB, melhor precisão) |
| TTS | `msedge-tts` no backend (funciona em Node; a mudança da Microsoft de dez/2025 só quebrou uso dentro de browsers) | idem | fallback offline: **Piper** `pt_BR-faber-medium` (~63 MB, binário `piper.exe`, sem compilar) |

```bash
# Fase 4 (Electron):
npm i @ricky0123/vad-web onnxruntime-web @picovoice/porcupine-node vosk
# Modelo Vosk pt-BR: https://alphacephei.com/vosk/models  (vosk-model-small-pt-0.3)
# Piper fallback: piper_windows_amd64.zip + pt_BR-faber-medium.onnx (HuggingFace rhasspy/piper-voices)
```

**EVITAR**: `nodejs-whisper`/`smart-whisper` no Electron (compilação nativa + ABI = inferno no
Windows); Web Speech API para STT no Electron (não funciona); `kokoro-js` para pt-BR (vozes
portuguesas são as menos treinadas do modelo — inglês é ótimo, pt-BR não).

`msedge-tts` é serviço não-oficial: raramente a Microsoft aperta o token (403). Tratar erro de
TTS com fallback (navegador: `speechSynthesis`; Electron: Piper) — princípio do backtalk:
**"degrade, never mute"** (degrada a voz, nunca fica mudo).

### 12.6 Cliente de celular (roadmap — receita pronta do aayushdebugging/claude-voice)

- HTTPS com certificado autoassinado cujo SAN inclui os IPs da LAN (obrigatório p/ microfone
  em origem não-localhost); WSS com token secreto em `?t=` validado com `timingSafeEqual`.
- Rate limit 60 msg/min; máximo 4 clientes (503 acima); celular envia áudio webm
  (MediaRecorder) como frame binário; barge-in remoto via `{type:'cancel'}`.

### 12.7 Ordem de leitura para o Claude Code de casa

1. Seções 1–4 (visão, decisões, arquitetura, setup) — 5 min.
2. **Seção 12.2** — implementar este padrão de backend (substitui o miolo da seção 5;
   o resto do server.js — Express, WS, sanitize, synthesize — continua válido).
3. **Seção 12.3** — chunker + fila dupla + gapless + barge-in, já na Fase 1.
4. Seções 6–6.6 — UI e design (inalterados).
5. Seção 12.5 — stack por fase; 12.4 sempre à mão ao debugar.

---

*Gerado em 12/09/2026 numa sessão do Claude Code no PC do SENAI. Handoff para a máquina de casa.*
