// Suíte de auto-teste do JARVIS — `npm test`
// Protocolo de auto-evolução: rodar SEMPRE antes de commitar mudanças em
// lib/core.mjs, server.js ou public/wake.js.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import {
  sanitizeForSpeech, makeSentenceChunker, DANGEROUS_BASH, SENSITIVE_TOOL,
  isInsideHome, fastLaneReply,
} from '../lib/core.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- sanitize ----------
test('sanitize remove markdown e links', () => {
  assert.equal(sanitizeForSpeech('**olá** `mundo` [site](http://x.com)'), 'olá mundo site');
  assert.match(sanitizeForSpeech('veja ```js\ncode\n``` fim'), /código na tela/);
  assert.match(sanitizeForSpeech('acesse https://exemplo.com agora'), /link na tela/);
});

// ---------- chunker ----------
function chunk(pieces) {
  const out = [];
  const c = makeSentenceChunker((s) => out.push(s));
  for (const p of pieces) c.feed(p);
  c.flush();
  return out;
}

test('chunker separa frases normais', () => {
  const out = chunk(['Primeira frase completa aqui. Segunda frase também completa aqui.']);
  assert.equal(out.length, 2);
});

test('chunker não corta abreviações', () => {
  const out = chunk(['O Dr. Silva chegou cedo hoje para a reunião importante.']);
  assert.equal(out.length, 1);
  assert.match(out[0], /Dr\. Silva/);
});

test('chunker não corta decimais', () => {
  const out = chunk(['O valor de pi é aproximadamente 3.14 nesse contexto todo.']);
  assert.equal(out.length, 1);
});

test('chunker emite incrementalmente com feed parcial', () => {
  const out = [];
  const c = makeSentenceChunker((s) => out.push(s));
  c.feed('Uma frase que chega ');
  c.feed('em pedaços pequenos. E continua');
  assert.equal(out.length, 1);
  c.flush();
  assert.equal(out.length, 2);
});

// ---------- travas ----------
test('DANGEROUS_BASH pega o perigoso e libera o inocente', () => {
  for (const cmd of ['sudo dnf install x', 'rm -rf /home/matheus/tudo', 'dd if=/dev/zero of=/dev/sda', 'shutdown now'])
    assert.match(cmd, DANGEROUS_BASH, cmd);
  for (const cmd of ['ls -la', 'rm arquivo.txt', 'git status', 'grep -r foo .', 'echo formar'])
    assert.doesNotMatch(cmd, DANGEROUS_BASH, cmd);
});

test('SENSITIVE_TOOL: ações sim, leituras não', () => {
  for (const t of ['mcp__google_workspace__send_gmail_message', 'mcp__x__delete_event', 'mcp__x__reply_to_thread'])
    assert.match(t, SENSITIVE_TOOL, t);
  for (const t of ['mcp__google_workspace__search_gmail_messages', 'mcp__google_workspace__get_events', 'mcp__x__list_files'])
    assert.doesNotMatch(t, SENSITIVE_TOOL, t);
});

test('isInsideHome', () => {
  const home = '/home/matheus', ws = '/home/matheus/Documentos';
  assert.equal(isInsideHome(home, ws, 'nota.txt', path), true);
  assert.equal(isInsideHome(home, ws, '/home/matheus/jarvis/x.js', path), true);
  assert.equal(isInsideHome(home, ws, '/etc/passwd', path), false);
  assert.equal(isInsideHome(home, ws, '../../etc/passwd', path), false);
});

// ---------- fast lane ----------
test('fast lane responde o trivial e ignora o resto', () => {
  const now = new Date(2026, 8, 13, 14, 30);
  assert.match(fastLaneReply('que horas são?', 'senhor', now), /14 horas e 30, senhor/);
  assert.match(fastLaneReply('bom dia', '', now), /Boa tarde/); // 14h → corrige a saudação
  assert.match(fastLaneReply('obrigado', 'chefe', now), /Às ordens, chefe/);
  assert.equal(fastLaneReply('que horas são no japão?', '', now), null);
  assert.equal(fastLaneReply('abre meus e-mails', '', now), null);
});

// ---------- wake word (public/wake.js via vm) ----------
const wakeSrc = fs.readFileSync(path.join(__dirname, '..', 'public', 'wake.js'), 'utf8');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(wakeSrc, ctx);
const { makeWake, findFuzzyWake } = ctx;

test('wake: variantes do Jarvis', () => {
  const w = makeWake('Jarvis');
  for (const s of ['jarvis abre isso', 'ei djarvis', 'ok járvis', 'fala jarves'])
    assert.match(s, w.re, s);
  assert.doesNotMatch('vou jantar agora', w.re);
});

test('wake: Sexta-feira com e sem hífen', () => {
  const w = makeWake('Sexta-feira');
  assert.match('sexta feira que horas são', w.re);
  assert.match('sexta-feira abre o gmail', w.re);
  assert.doesNotMatch('na sexta eu viajo', w.re);
});

test('wake fuzzy: 1 letra de erro aciona, palavras comuns não', () => {
  const w = makeWake('Jarvis');
  assert.ok(findFuzzyWake('garvis me ajuda aqui', w.list));
  assert.ok(findFuzzyWake('tá bom járves pode parar', w.list));
  assert.equal(findFuzzyWake('vou jantar com a maria', w.list), null);
  assert.equal(findFuzzyWake('preciso de um jardim novo', w.list), null);
});
