// Wake word do JARVIS — detecção com variantes, alternativas e tolerância a 1 letra.
// Carregado ANTES do script principal do index.html; testado por npm test (via node:vm).

const WAKE_VARIANTS = {
  jarvis: ['jarvis', 'djarvis', 'jarves', 'jarbis', 'járvis', 'jarvys'],
  friday: ['friday', 'fraidei', 'fraide', 'frida', 'fridei'],
  'sexta-feira': ['sexta-feira', 'sexta feira', 'sextafeira'],
  ultron: ['ultron', 'últron', 'utron', 'ultrom'],
};

function stripAcc(s) { return s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }

// distância de edição ≤ 1 (inserção, remoção ou troca de 1 caractere)
function within1(a, b) {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0, j = 0, edits = 0;
  while (i < la && j < lb) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++edits > 1) return false;
    if (la > lb) i++; else if (lb > la) j++; else { i++; j++; }
  }
  return edits + (la - i) + (lb - j) <= 1;
}

// nome → { re: regex das variantes, list: variantes para o fuzzy }
function makeWake(nome) {
  const n = (nome || 'Jarvis').toLowerCase();
  const vs = WAKE_VARIANTS[n] || [n];
  const re = new RegExp(
    `\\b(${vs.map((v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})\\b`, 'i');
  return { re, list: vs };
}

// procura a wake word com tolerância de 1 letra; devolve pseudo-match {index, 0} ou null
function findFuzzyWake(text, list) {
  const targets = list.filter((v) => !v.includes(' ') && v.length >= 5).map(stripAcc);
  if (!targets.length) return null;
  const re = /[\p{L}\p{N}-]+/gu;
  let w;
  while ((w = re.exec(text)) !== null) {
    const word = stripAcc(w[0].toLowerCase());
    if (word.length >= 4 && targets.some((t) => within1(word, t))) {
      return { index: w.index, 0: w[0] };
    }
  }
  return null;
}
