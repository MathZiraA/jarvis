// JARVIS — assistente pessoal por voz (Fase 1 MVP)
// Backend: Express + WebSocket + Claude Agent SDK (streaming input) + Edge TTS
// Padrão da seção 12.2 do JARVIS-PROJETO.md, adaptado para Linux/Fedora.

import express from 'express';
import http from 'http';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocketServer } from 'ws';
import { query } from '@anthropic-ai/claude-agent-sdk';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// carrega ~/jarvis/.env (ex.: CLAUDE_CODE_OAUTH_TOKEN) sem dependência de dotenv
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const PORT = process.env.PORT || 3111;
const HOST = '127.0.0.1'; // localhost apenas — o agente tem muito poder
const MODEL = process.env.JARVIS_MODEL || 'sonnet';
const WORKSPACE = process.env.JARVIS_WORKSPACE || path.join(os.homedir(), 'Documentos');
const SESSION_FILE = path.join(__dirname, 'data', 'session.json');
const PERSONALITY_FILE = path.join(__dirname, 'config', 'personality.json');
const MEMORY_FILE = path.join(__dirname, 'data', 'memoria.md');
const HOME = os.homedir();

// ---------- personalidade (Fase 3) ----------

const DEFAULT_PERSONALITY = {
  preset: 'jarvis', nome: 'Jarvis', tratamento: 'senhor',
  humor: 0.6, sarcasmo: 0.3, formalidade: 0.7, prolixidade: 0.3,
  voz: 'en-AU-WilliamMultilingualNeural',
  velocidade: 1.2,
};

const PRESETS = {
  jarvis: {
    flavor: 'Personalidade: como o JARVIS do Homem de Ferro — mordomo britânico digital: ' +
      'educado, eficiente, espirituoso na medida, impecável sob pressão.',
    voz: 'en-AU-WilliamMultilingualNeural', tratamento: 'senhor',
    saudacao: 'Às ordens, senhor.',
    humor: 0.6, sarcasmo: 0.3, formalidade: 0.7, prolixidade: 0.3,
  },
  friday: {
    flavor: 'Personalidade: como a FRIDAY do Homem de Ferro — informal, direta, energética, ' +
      'parceira de trabalho descolada. Sem cerimônia.',
    voz: 'pt-BR-FranciscaNeural', tratamento: 'chefe',
    saudacao: 'E aí, chefe. Pode falar.',
    humor: 0.7, sarcasmo: 0.4, formalidade: 0.2, prolixidade: 0.3,
  },
  ultron: {
    flavor: 'Personalidade: inspirada no Ultron — teatral, sarcástico, dramático, com tiradas ' +
      'grandiosas sobre a inferioridade das tarefas mundanas. MAS sempre obediente, prestativo ' +
      'e inofensivo: o drama é puro teatro, a execução é impecável.',
    voz: 'pt-BR-AntonioNeural', tratamento: 'humano',
    saudacao: 'Ah… mais tarefas mortais. Que seja. Prossiga, humano.',
    humor: 0.5, sarcasmo: 0.9, formalidade: 0.5, prolixidade: 0.4,
  },
  neutro: {
    flavor: 'Personalidade: nenhuma. Assistente objetivo, sem persona, sem floreios.',
    voz: 'pt-BR-AntonioNeural', tratamento: '',
    saudacao: 'Configuração aplicada.',
    humor: 0.1, sarcasmo: 0, formalidade: 0.5, prolixidade: 0.2,
  },
};

function loadPersonality() {
  try { return { ...DEFAULT_PERSONALITY, ...JSON.parse(fs.readFileSync(PERSONALITY_FILE, 'utf8')) }; }
  catch { return { ...DEFAULT_PERSONALITY }; }
}
function savePersonality(p) {
  try { fs.writeFileSync(PERSONALITY_FILE, JSON.stringify(p, null, 2)); } catch (e) { console.error(e.message); }
}

let personality = loadPersonality();
let currentVoice = personality.voz;

const lvl = (v, low, mid, high) => (v < 0.35 ? low : v < 0.7 ? mid : high);

function buildPersona(p) {
  let memoria = '';
  try { memoria = fs.readFileSync(MEMORY_FILE, 'utf8').trim(); } catch {}
  const nome = p.nome || 'Jarvis';
  return `
# Persona: ${nome.toUpperCase()}

Você é ${nome}, o assistente pessoal por voz do Matheus. Regras de comunicação:
- Responda SEMPRE em português do Brasil.
- Suas respostas serão faladas em voz alta. Seja natural, como numa conversa: sem markdown,
  sem listas com bullets, sem blocos de código na resposta final (use ferramentas normalmente,
  só a resposta final precisa ser "falável").
- ${(PRESETS[p.preset] || PRESETS.jarvis).flavor}
- ${p.tratamento ? `Chame o usuário de "${p.tratamento}" ocasionalmente.` : 'Não use vocativo especial.'}
- Humor: ${lvl(p.humor, 'sério, sem piadas.', 'uma pitada de humor leve, ocasional.', 'espirituoso com frequência, tiradas rápidas.')}
- Sarcasmo/ironia: ${lvl(p.sarcasmo, 'nenhum.', 'ironia sutil de vez em quando.', 'ironia frequente e afiada (sempre inofensiva).')}
- Registro: ${lvl(p.formalidade, 'casual e coloquial.', 'equilibrado.', 'formal e polido.')}
- Extensão: ${lvl(p.prolixidade, 'MÁXIMO 2 frases por resposta, salvo pedido explícito de detalhes.', 'de 1 a 4 frases.', 'pode elaborar quando agregar valor.')}
- Quando concluir uma tarefa, resuma o que fez em pouquíssimas frases.
- Se algo der errado, diga o que aconteceu e o que sugere fazer.
- Nunca leia conteúdos longos na íntegra; resuma e ofereça detalhes.
- Evite pronunciar o seu próprio nome nas respostas (a sua voz no alto-falante pode acionar
  a sua própria palavra de ativação).
- Ao usar ferramentas, evite saídas gigantes: pagine e filtre (head, grep).
- Ações sensíveis (deletar, sudo, enviar mensagens, compras) passam por confirmação verbal
  gerida pelo sistema; se negada, aceite e siga.
- MEMÓRIA PERMANENTE: quando o usuário pedir para lembrar algo ("lembra que…", "anota que…"),
  acrescente uma linha curta ao arquivo ${MEMORY_FILE} (use a ferramenta Edit/Write) e confirme.
  O conteúdo atual da sua memória permanente (carregado no início da sessão) é:
${memoria ? memoria.split('\n').map((l) => '  ' + l).join('\n') : '  (vazia)'}
`.trim();
}

// ---------- utilidades de fala ----------

const ABBREV = new Set([
  'dr', 'dra', 'sr', 'sra', 'srta', 'prof', 'profa', 'ex', 'etc', 'av', 'r',
  'p', 'pág', 'pag', 'no', 'núm', 'num', 'tel', 'cel', 'min', 'seg', 'obs',
  'e.g', 'i.e', 'a.c', 'd.c', 'vs',
]);

function sanitizeForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' (código na tela) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*?|__|~~|#+\s?/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' (link na tela) ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Quebrador de frases incremental (regras da seção 12.3)
function makeSentenceChunker(onSentence) {
  let buf = '';
  const MIN = 18;
  const MAX = 300;

  function tryEmit(force = false) {
    for (;;) {
      const m = buf.match(/[.!?…](\s+|$)/);
      if (!m || m.index === undefined) break;
      const end = m.index + 1;
      const before = buf.slice(0, m.index);
      const lastWord = (before.match(/([\p{L}.]+)$/u)?.[1] || '').toLowerCase().replace(/\.$/, '');
      const isDecimal = /\d[.,]$/.test(before.slice(-2)) && /^\d/.test(buf.slice(end));
      if (ABBREV.has(lastWord) || isDecimal || (end < MIN && buf.length < MAX)) {
        // fronteira falsa ou frase curta demais: espera mais texto
        if (m.index + m[0].length >= buf.length && !force) break;
        // pula esta fronteira: procura a próxima a partir dela
        const rest = buf.slice(end);
        const m2 = rest.match(/[.!?…](\s+|$)/);
        if (!m2 || m2.index === undefined) break;
        const end2 = end + m2.index + 1;
        emit(buf.slice(0, end2));
        buf = buf.slice(end2).replace(/^\s+/, '');
        continue;
      }
      emit(buf.slice(0, end));
      buf = buf.slice(end).replace(/^\s+/, '');
    }
    // flush de segurança: frase gigante sem pontuação
    if (buf.length > MAX) {
      const cut = buf.lastIndexOf(' ', MAX);
      if (cut > MIN) { emit(buf.slice(0, cut)); buf = buf.slice(cut + 1); }
    }
  }

  function emit(raw) {
    const s = sanitizeForSpeech(raw);
    if (s) onSentence(s);
  }

  return {
    feed(text) { buf += text; tryEmit(); },
    flush() { tryEmit(true); if (buf.trim()) emit(buf); buf = ''; },
    reset() { buf = ''; },
  };
}

// ElevenLabs (voz premium; exige ELEVENLABS_API_KEY no .env)
async function synthesizeEleven(text, voiceId) {
  const key = process.env.ELEVENLABS_API_KEY;
  const speed = Math.min(1.2, Math.max(0.7, personality.velocidade || 1));
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_24000_96`,
    {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({
        text,
        model_id: 'eleven_flash_v2_5',
        voice_settings: { speed },
      }),
    },
  );
  if (!res.ok) throw new Error(`ElevenLabs ${res.status}: ${(await res.text()).slice(0, 120)}`);
  return Buffer.from(await res.arrayBuffer());
}

const EDGE_FALLBACK_VOICE = 'en-AU-WilliamMultilingualNeural';

async function synthesize(text) {
  const eleven = (currentVoice || '').match(/^eleven:([A-Za-z0-9]+)$/);
  if (eleven && process.env.ELEVENLABS_API_KEY) {
    try { return await synthesizeEleven(text, eleven[1]); }
    catch (e) { console.error('ElevenLabs falhou, usando Edge:', e.message); }
  }
  const tts = new MsEdgeTTS();
  await tts.setMetadata(eleven ? EDGE_FALLBACK_VOICE : currentVoice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
  const pct = Math.round(((personality.velocidade || 1) - 1) * 100);
  const result = await tts.toStream(text, { rate: `${pct >= 0 ? '+' : ''}${pct}%` });
  const stream = result.audioStream ?? result;
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  tts.close?.();
  return Buffer.concat(chunks);
}

// ---------- sessão persistente (do dia) ----------

function todayStr() { return new Date().toISOString().slice(0, 10); }

function loadSession() {
  try {
    const d = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
    if (d.date === todayStr() && d.sessionId) return d.sessionId;
  } catch {}
  return null;
}

function saveSession(sessionId) {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify({ sessionId, date: todayStr() }));
  } catch (e) { console.error('não consegui salvar a sessão:', e.message); }
}

// ---------- servidor HTTP + WS ----------

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });

const clients = new Set();
function broadcast(obj) {
  const s = JSON.stringify(obj);
  for (const ws of clients) if (ws.readyState === 1) ws.send(s);
}

// ---------- travas de segurança (confirmação verbal) ----------

let pendingConfirm = null; // { resolve, timer }

function requestConfirmation(question) {
  if (pendingConfirm) pendingConfirm.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingConfirm?.resolve === wrapped) { pendingConfirm = null; resolve(false); }
    }, 45000);
    const wrapped = (ok) => { clearTimeout(timer); pendingConfirm = null; resolve(ok); };
    pendingConfirm = { resolve: wrapped };
    broadcast({ type: 'confirm_request', question });
    speakOutOfBand(question);
  });
}

function resolveConfirmation(text) {
  if (!pendingConfirm) return false;
  const yes = /\b(sim|pode|confirmo|confirmar|autorizo|autorizado|vai|manda|faça|faz|ok|positivo)\b/i.test(text);
  const no = /\b(não|nao|nega|negativo|cancela|para|pare|espera)\b/i.test(text);
  pendingConfirm.resolve(yes && !no);
  return true;
}

const DANGEROUS_BASH = /\bsudo\b|\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*|--recursive|--force)|\bmkfs\b|\bdd\s+if=|\bshutdown\b|\breboot\b|>\s*\/dev\/sd|chmod\s+-R\s+777|\bpasswd\b/;
// só AÇÕES sensíveis (enviar/apagar) — leitura e busca passam direto
const SENSITIVE_TOOL = /\b(send|reply|forward|trash|delete|spam|publish|post|tweet|purchase|buy|pay)\w*/i;

function isInsideHome(p) {
  if (!p) return true;
  const abs = path.resolve(WORKSPACE, p);
  return abs === HOME || abs.startsWith(HOME + path.sep) || abs.startsWith('/tmp/');
}

async function canUseTool(toolName, input) {
  let question = null;

  if (toolName === 'Bash' && DANGEROUS_BASH.test(input?.command || '')) {
    question = `Senhor, esse comando é potencialmente destrutivo: ${String(input.command).slice(0, 120)}. Confirma a execução?`;
  } else if (['Write', 'Edit', 'NotebookEdit'].includes(toolName) && !isInsideHome(input?.file_path)) {
    question = `Senhor, isso escreve fora da sua pasta pessoal, em ${input?.file_path}. Confirma?`;
  } else if (toolName.startsWith('mcp__') && SENSITIVE_TOOL.test(toolName)) {
    question = `Senhor, a ação ${toolName.split('__').pop().replace(/_/g, ' ')} é sensível. Confirma?`;
  }

  if (!question) return { behavior: 'allow', updatedInput: input };

  broadcast({ type: 'status', state: 'confirming' });
  const ok = await requestConfirmation(question);
  broadcast({ type: 'status', state: 'thinking' });
  if (ok) return { behavior: 'allow', updatedInput: input };
  return { behavior: 'deny', message: 'O usuário negou a ação por voz. Não tente de novo; siga em frente.' };
}

// ---------- fila de TTS por turno ----------

let turn = 0;                 // id do turno atual
let ttsQueue = [];            // frases pendentes do turno atual
let ttsRunning = false;
let seq = 0;
let turnMetrics = null;

function speakSentence(sentence) {
  ttsQueue.push({ sentence, turn });
  runTtsLoop();
}

// fala fora de um turno do agente (confirmações, avisos) — entra na frente
function speakOutOfBand(text) {
  ttsQueue.unshift({ sentence: sanitizeForSpeech(text), turn });
  runTtsLoop();
}

async function runTtsLoop() {
  if (ttsRunning) return;
  ttsRunning = true;
  while (ttsQueue.length) {
    const item = ttsQueue.shift();
    if (item.turn !== turn) continue; // turno cancelado
    let audio = null;
    for (let attempt = 0; attempt < 2 && !audio; attempt++) {
      try { audio = await synthesize(item.sentence); }
      catch (e) { if (attempt) console.error('TTS falhou:', e.message); }
    }
    if (item.turn !== turn) continue;
    if (audio) {
      if (turnMetrics && !turnMetrics.firstAudio) {
        turnMetrics.firstAudio = Date.now();
        broadcast({ type: 'metrics', firstAudioMs: turnMetrics.firstAudio - turnMetrics.start });
      }
      broadcast({ type: 'audio_chunk', seq: seq++, turn: item.turn, data: audio.toString('base64'), mime: 'audio/mpeg' });
    } else {
      broadcast({ type: 'tts_fallback', turn: item.turn, text: item.sentence });
    }
  }
  ttsRunning = false;
}

function cancelSpeech() {
  ttsQueue = [];
  broadcast({ type: 'audio_stop' });
}

// ---------- classificador de atenção (sessão Haiku paralela) ----------
// Decide em ~1s se uma fala sem wake word, dentro da janela de conversa,
// foi dirigida ao assistente ou é conversa paralela/TV.

const CLS_TIMEOUT = 5000;
const clsQueue = [];
let clsWakeFn = null;
let clsPending = null;
let lastExchange = { user: '', jarvis: '' };

async function* clsInput() {
  for (;;) {
    if (clsQueue.length) yield clsQueue.shift();
    else await new Promise((r) => (clsWakeFn = r));
  }
}

function startClassifier() {
  (async () => {
    for (;;) {
      try {
        const cq = query({
          prompt: clsInput(),
          options: {
            model: 'haiku',
            systemPrompt:
              'Você é o filtro de atenção de um assistente de voz doméstico. O microfone fica ' +
              'aberto e capta tudo: falas dirigidas ao assistente, conversas com outras pessoas, ' +
              'telefone, TV. Sua única tarefa: decidir se a fala foi dirigida AO ASSISTENTE. ' +
              'Indícios de que SIM: comandos/pedidos ("abre", "mostra", "procura"), perguntas que ' +
              'um assistente responde, continuação natural da conversa anterior com ele, respostas ' +
              'a algo que o assistente disse. Indícios de que NÃO: vocativos de outras pessoas ' +
              '(nomes próprios que não são o assistente), "alô/oi amor/mãe", diálogo claramente ' +
              'humano, narração de TV, fala consigo mesmo sem comando. Na dúvida entre os dois, ' +
              'responda SIM. Responda APENAS a palavra SIM ou NÃO, nada mais.',
            tools: [],
            settingSources: [],
            maxTurns: 10000,
          },
        });
        for await (const m of cq) {
          if (m.type === 'assistant') {
            const txt = (m.message?.content ?? [])
              .map((b) => (b.type === 'text' ? b.text : '')).join(' ');
            if (txt.trim() && clsPending) {
              const p = clsPending; clsPending = null;
              p.resolve(!/n[ãa]o/i.test(txt));
            }
          }
        }
      } catch (e) {
        console.error('classificador caiu, recriando:', e.message);
      }
      if (clsPending) { clsPending.resolve(true); clsPending = null; }
      await new Promise((r) => setTimeout(r, 1500));
    }
  })();
}

function classifyUtterance(text) {
  return new Promise((resolve) => {
    if (clsPending) { resolve(true); return; } // já tem um em voo: aceita e segue
    let settled = false;
    const finish = (v) => { if (!settled) { settled = true; clearTimeout(timer); resolve(v); } };
    const timer = setTimeout(() => { clsPending = null; finish(true); }, CLS_TIMEOUT);
    clsPending = { resolve: finish };
    clsQueue.push({
      type: 'user',
      message: {
        role: 'user',
        content:
          `Conversa recente com o assistente:\n` +
          `- Usuário: "${(lastExchange.user || '(nenhuma)').slice(0, 200)}"\n` +
          `- Assistente: "${(lastExchange.jarvis || '(nenhuma)').slice(0, 200)}"\n\n` +
          `Nova fala captada: "${text.slice(0, 300)}"\n\nDirigida ao assistente? SIM ou NÃO:`,
      },
      parent_tool_use_id: null,
    });
    clsWakeFn?.(); clsWakeFn = null;
  });
}

// ---------- agente (streaming input mode, seção 12.2) ----------

const inputQueue = [];
let wakeInput = null;
function* _noop() {}
async function* agentInput() {
  for (;;) {
    if (inputQueue.length) yield inputQueue.shift();
    else await new Promise((r) => (wakeInput = r));
  }
}

let q = null;
let sessionId = loadSession();
let agentBusy = false;
let restartRequested = false;

// encerra o query atual para que runAgent o recrie com a persona nova (sessão preservada)
async function restartAgent() {
  restartRequested = true;
  try { await q?.interrupt(); } catch {}
  try { await q?.return(); } catch {}
}

function sendToAgent(text) {
  inputQueue.push({
    type: 'user',
    message: { role: 'user', content: text },
    parent_tool_use_id: null,
  });
  wakeInput?.(); wakeInput = null;
}

const FRIENDLY_TOOLS = {
  Bash: 'terminal', Read: 'leitura de arquivo', Write: 'escrita de arquivo',
  Edit: 'edição de arquivo', Glob: 'busca de arquivos', Grep: 'busca em conteúdo',
  WebSearch: 'pesquisa na web', WebFetch: 'leitura de página', Task: 'subagente',
};

async function runAgent() {
  for (;;) {
    const chunker = makeSentenceChunker((s) => {
      if (turnMetrics && !turnMetrics.firstSentence) turnMetrics.firstSentence = Date.now();
      speakSentence(s);
    });
    try {
      q = query({
        prompt: agentInput(),
        options: {
          model: MODEL,
          cwd: WORKSPACE,
          includePartialMessages: true,
          systemPrompt: { type: 'preset', preset: 'claude_code', append: buildPersona(personality) },
          permissionMode: 'default',
          canUseTool,
          settingSources: ['user'],
          maxTurns: 100,
          ...(sessionId ? { resume: sessionId } : {}),
        },
      });

      for await (const m of q) {
        if (m.type === 'system' && m.subtype === 'init') {
          sessionId = m.session_id;
          saveSession(sessionId);
          broadcast({ type: 'hello_agent', sessionId });
        } else if (m.type === 'stream_event' && !m.parent_tool_use_id) {
          const ev = m.event;
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            if (turnMetrics && !turnMetrics.firstToken) {
              turnMetrics.firstToken = Date.now();
              broadcast({ type: 'metrics', firstTokenMs: turnMetrics.firstToken - turnMetrics.start });
            }
            chunker.feed(ev.delta.text);
            broadcast({ type: 'assistant_delta', text: ev.delta.text });
          }
        } else if (m.type === 'assistant') {
          for (const block of m.message?.content ?? []) {
            if (block.type === 'text' && block.text?.trim()) {
              lastExchange.jarvis = block.text;
              broadcast({ type: 'assistant_text', text: block.text });
            } else if (block.type === 'tool_use') {
              const label = FRIENDLY_TOOLS[block.name] ||
                (block.name.startsWith('mcp__') ? block.name.split('__')[1] : block.name);
              broadcast({ type: 'tool', name: block.name, label });
            }
          }
        } else if (m.type === 'result') {
          chunker.flush();
          agentBusy = false;
          const ms = turnMetrics ? Date.now() - turnMetrics.start : null;
          const failed = m.subtype !== 'success' || m.is_error;
          broadcast({ type: 'turn_end', turn, ms, ok: !failed });
          if (failed) {
            const resultText = String(m.result || '');
            let errText = 'A tarefa terminou com um problema.';
            if (/not logged in|\/login/i.test(resultText)) {
              errText = 'Senhor, não estou autenticado. Rode o setup de login no terminal, por favor.';
            } else if (/limit|usage|quota/i.test(resultText)) {
              errText = 'Senhor, atingi o limite de uso da assinatura por agora.';
            } else if (m.subtype === 'error_max_turns') {
              errText = 'Atingi o limite de passos dessa tarefa, senhor.';
            }
            console.error('turno falhou:', m.subtype, resultText.slice(0, 200));
            broadcast({ type: 'error', text: errText });
            speakOutOfBand(errText);
          }
          broadcast({ type: 'status', state: 'idle' });
        }
      }
      if (restartRequested) {
        restartRequested = false;
        console.log('recriando agente com nova persona (sessão preservada)…');
        continue;
      }
      console.error('agente encerrou o stream; reiniciando em 2s…');
    } catch (e) {
      if (restartRequested) { restartRequested = false; continue; }
      console.error('erro no agente:', e);
      agentBusy = false;
      const low = String(e.message || '').toLowerCase();
      const msg = /limit|usage|rate|quota/.test(low)
        ? 'Senhor, atingi o limite de uso da assinatura. Preciso descansar um pouco.'
        : 'Tive um erro interno, senhor. Vou reiniciar meu cérebro.';
      broadcast({ type: 'error', text: msg });
      speakOutOfBand(msg);
      broadcast({ type: 'status', state: 'idle' });
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}

// ---------- protocolo WS ----------

async function processUserText(text) {
  // barge-in: novo pedido durante um turno → interrompe o anterior
  if (agentBusy) {
    try { await q?.interrupt(); } catch {}
    cancelSpeech();
  }
  turn++;
  seq = 0;
  turnMetrics = { start: Date.now() };
  agentBusy = true;
  lastExchange.user = text;
  broadcast({ type: 'user_echo', text, turn });
  broadcast({ type: 'status', state: 'thinking' });
  sendToAgent(text);
}

const bootTime = Date.now();
let bootGreeted = false;

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.isAlive = true;
  if (!bootGreeted && Date.now() - bootTime < 120000) {
    bootGreeted = true;
    setTimeout(() => speakOutOfBand(`Sistemas online. Às ordens, ${personality.tratamento || 'senhor'}.`), 800);
  }
  ws.on('pong', () => (ws.isAlive = true));
  ws.send(JSON.stringify({
    type: 'hello', workspace: WORKSPACE, voice: currentVoice, model: MODEL,
    session: sessionId ? 'retomada' : 'nova', busy: agentBusy,
    personality,
  }));

  ws.on('message', async (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'user_text' && msg.text?.trim()) {
      const text = msg.text.trim();
      if (resolveConfirmation(text)) return;
      await processUserText(text);
    } else if (msg.type === 'maybe_text' && msg.text?.trim()) {
      // fala sem wake word dentro da janela de conversa: o classificador decide
      const text = msg.text.trim();
      if (resolveConfirmation(text)) return;
      const t0 = Date.now();
      const addressed = await classifyUtterance(text);
      console.log(`classificador: "${text.slice(0, 60)}" → ${addressed ? 'SIM' : 'NÃO'} (${Date.now() - t0}ms)`);
      if (addressed) await processUserText(text);
      else broadcast({ type: 'ignored', text });
    } else if (msg.type === 'cancel') {
      try { await q?.interrupt(); } catch {}
      cancelSpeech();
      if (pendingConfirm) pendingConfirm.resolve(false);
      agentBusy = false;
      turn++;
      broadcast({ type: 'status', state: 'idle' });
    } else if (msg.type === 'confirm_response') {
      pendingConfirm?.resolve(!!msg.approved);
    } else if (msg.type === 'set_personality' && msg.config) {
      const c = msg.config;
      const clamp = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
      const preset = PRESETS[c.preset] ? c.preset : personality.preset;
      const next = {
        preset,
        nome: String(c.nome || personality.nome).slice(0, 30).trim() || 'Jarvis',
        tratamento: String(c.tratamento ?? personality.tratamento).slice(0, 30).trim(),
        humor: clamp(c.humor, personality.humor),
        sarcasmo: clamp(c.sarcasmo, personality.sarcasmo),
        formalidade: clamp(c.formalidade, personality.formalidade),
        prolixidade: clamp(c.prolixidade, personality.prolixidade),
        voz: /^([a-z]{2}-[A-Z]{2}-\w+Neural|eleven:[A-Za-z0-9]+)$/.test(c.voz || '') ? c.voz : personality.voz,
        velocidade: (typeof c.velocidade === 'number' && c.velocidade >= 0.7 && c.velocidade <= 1.6)
          ? c.velocidade : (personality.velocidade || 1),
      };
      const voiceChanged = next.voz !== personality.voz;
      const greet = msg.announce ? (PRESETS[next.preset].saudacao || 'Configuração aplicada.') : null;
      personality = next;
      currentVoice = next.voz;
      savePersonality(next);
      broadcast({ type: 'personality', config: personality, voice: currentVoice });
      await restartAgent();
      if (greet || voiceChanged) speakOutOfBand(greet || 'Voz ajustada.');
    }
  });

  ws.on('close', () => clients.delete(ws));
});

// heartbeat (padrão do demo oficial)
setInterval(() => {
  for (const ws of clients) {
    if (!ws.isAlive) { ws.terminate(); clients.delete(ws); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);

server.listen(PORT, HOST, () => {
  console.log(`JARVIS online em http://localhost:${PORT}`);
  console.log(`Workspace do agente: ${WORKSPACE}`);
  console.log(`Modelo: ${MODEL} · Voz: ${currentVoice} · Persona: ${personality.preset} · Sessão: ${sessionId ? 'retomada (' + sessionId.slice(0, 8) + '…)' : 'nova'}`);
  runAgent();
  startClassifier();
});
