// Funções puras do JARVIS — extraídas do server.js para serem testáveis (npm test).
// Regra da casa: mudou aqui, rode npm test antes do commit.

export const ABBREV = new Set([
  'dr', 'dra', 'sr', 'sra', 'srta', 'prof', 'profa', 'ex', 'etc', 'av', 'r',
  'p', 'pág', 'pag', 'no', 'núm', 'num', 'tel', 'cel', 'min', 'seg', 'obs',
  'e.g', 'i.e', 'a.c', 'd.c', 'vs',
]);

export function sanitizeForSpeech(text) {
  return text
    .replace(/```[\s\S]*?```/g, ' (código na tela) ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\*\*?|__|~~|#+\s?/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/https?:\/\/\S+/g, ' (link na tela) ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Quebrador de frases incremental (regras da seção 12.3 do handoff)
export function makeSentenceChunker(onSentence) {
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
        if (m.index + m[0].length >= buf.length && !force) break;
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

// Travas de segurança (usadas pelo canUseTool do server.js)
export const DANGEROUS_BASH = /\bsudo\b|\brm\s+(-[a-zA-Z]*[rf][a-zA-Z]*|--recursive|--force)|\bmkfs\b|\bdd\s+if=|\bshutdown\b|\breboot\b|>\s*\/dev\/sd|chmod\s+-R\s+777|\bpasswd\b/;
// só AÇÕES sensíveis (enviar/apagar) — leitura e busca passam direto.
// (^|_) em vez de \b: nomes MCP usam underscore (…__send_gmail_message) e
// underscore é caractere de palavra — \b nunca casaria ali.
// "post" fica de fora: é o verbo REST genérico que a Notion usa até pra criar
// página/comentário (API-post-page, API-post-search) — não é "publicar" nada,
// é só como a API dela nomeia "criar". "publish"/"tweet" continuam cobrindo
// publicação de verdade.
export const SENSITIVE_TOOL = /(^|_|\b)(send|reply|forward|trash|delete|spam|publish|tweet|purchase|buy|pay)/i;

export function isInsideHome(home, workspace, p, pathMod) {
  if (!p) return true;
  const abs = pathMod.resolve(workspace, p);
  return abs === home || abs.startsWith(home + pathMod.sep) || abs.startsWith('/tmp/');
}

// fast lane: perguntas triviais respondidas sem gastar cota nem latência
export function fastLaneReply(text, tratamento = '', now = new Date()) {
  const t = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[?!.,]+/g, '').trim();
  const trat = tratamento || '';
  if (/^(que horas sao|me diz as horas|horas agora|que horas)$/.test(t))
    return `São ${now.getHours()} horas e ${now.getMinutes() === 0 ? 'em ponto' : now.getMinutes()}${trat ? ', ' + trat : ''}.`;
  if (/^(que dia e hoje|data de hoje|que data e hoje)$/.test(t))
    return `Hoje é ${now.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}.`;
  if (/^(oi|ola|e ai|opa|bom dia|boa tarde|boa noite)$/.test(t)) {
    const h = now.getHours();
    const sauda = h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
    return `${sauda}${trat ? ', ' + trat : ''}. Em que posso ajudar?`;
  }
  // "obrigado/valeu/beleza" NÃO respondem: o frontend trata como encerramento
  // social silencioso (CLOSING_ACK) — fim de conversa não precisa de fala
  return null;
}
