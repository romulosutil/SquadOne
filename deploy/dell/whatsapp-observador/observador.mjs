// Observador de conversas com leads no WhatsApp do Rômulo (Dell).
//
// O Rômulo aborda os leads direto no WhatsApp e não tem tempo de voltar à
// planilha. Este processo é MAIS UM dispositivo vinculado no número dele
// (independente do Hermes, que muda de versão todo dia) e, para cada mensagem
// numa conversa 1:1 com um número que está nas planilhas, avisa o n8n do Dell:
// quem (chave do número), direção (saida/entrada) e quando. O n8n marca a
// planilha (deploy/dell/claude-ops/whatsapp-conversa.py).
//
// Privacidade, de propósito:
// - o CONTEÚDO nunca é lido para nada além de "é uma mensagem de verdade", nem
//   gravado, nem logado, nem enviado;
// - conversa com quem não é lead não sai daqui (o filtro é a lista do n8n);
// - grupos, status e canais são ignorados;
// - o log mostra só DDD + 2 últimos dígitos.
//
// Uso:
//   node observador.mjs --parear 5521999998888   # uma vez: imprime o código de 8 letras
//   node observador.mjs                          # serviço (systemd)

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import path from 'node:path';
import os from 'node:os';
import { mkdirSync, readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';

const HOME = os.homedir();
const SESSAO = process.env.OBSERVADOR_SESSAO || path.join(HOME, '.local/share/whatsapp-observador/sessao');
const N8N = process.env.OBSERVADOR_N8N || 'http://127.0.0.1:5679/webhook';
const SEGREDO = readFileSync(path.join(HOME, '.config/claude-ops/whatsapp-observador-segredo'), 'utf8').trim();
const FILA_DE_AVISOS = path.join(HOME, '.local/share/avisos/fila');

/** Números dos leads relidos do n8n a cada 10 min: lead novo entra sem reiniciar. */
const RELER_NUMEROS_MS = 10 * 60 * 1000;
/** Uma conversa de 30 mensagens não vira 30 leituras da planilha: um aviso por número e direção a cada 6 h. */
const JANELA_DEDUPE_MS = 6 * 3600 * 1000;
/** Mensagem mais velha que isto é sincronização/backlog, não ação de agora. */
const IDADE_MAXIMA_S = 15 * 60;

const logger = pino({ level: 'warn' });
const log = (...a) => console.log(new Date().toISOString(), ...a);

/** DDD + últimos 8 dígitos: o WhatsApp guarda celular antigo sem o 9, a planilha às vezes com. */
export function chaveDoNumero(bruto) {
  let d = String(bruto ?? '').replace(/\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  if (d.length < 10 || d.length > 11) return '';
  return d.slice(0, 2) + d.slice(-8);
}

const mascarar = (chave) => `${chave.slice(0, 2)}******${chave.slice(-2)}`;

/** Só mensagem de gente: reação, apagamento, edição, chamada e afins não contam como conversa. */
function ehMensagemDeVerdade(m) {
  if (!m) return false;
  const tipos = Object.keys(m).filter((k) => k !== 'messageContextInfo' && k !== 'senderKeyDistributionMessage');
  const ignorar = new Set(['protocolMessage', 'reactionMessage', 'pollUpdateMessage', 'keepInChatMessage', 'pinInChatMessage', 'call', 'editedMessage']);
  return tipos.some((t) => !ignorar.has(t));
}

function avisarPeloHermes(texto) {
  try {
    mkdirSync(FILA_DE_AVISOS, { recursive: true });
    writeFileSync(path.join(FILA_DE_AVISOS, `observador-${Date.now()}.json`), JSON.stringify({ titulo: '📱 Observador do WhatsApp', texto }));
  } catch (e) {
    log('não consegui gravar o aviso:', e.message);
  }
}

let chaves = new Set();
async function relerNumeros() {
  try {
    const r = await fetch(`${N8N}/whatsapp-telefones`, { headers: { 'X-Observador': SEGREDO }, signal: AbortSignal.timeout(60_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    chaves = new Set((j.chaves ?? []).filter(Boolean));
    log(`${chaves.size} número(s) de lead no filtro`);
  } catch (e) {
    // Mantém a lista anterior: n8n fora por um instante não pode cegar o observador.
    log('não consegui reler os números dos leads:', e.message);
  }
}

const vistos = new Map();
async function avisarN8n(chave, direcao, em) {
  const k = `${chave}:${direcao}`;
  const ultimo = vistos.get(k) ?? 0;
  if (em.getTime() - ultimo < JANELA_DEDUPE_MS) return;
  vistos.set(k, em.getTime());
  try {
    const r = await fetch(`${N8N}/whatsapp-conversa`, {
      method: 'POST',
      headers: { 'X-Observador': SEGREDO, 'Content-Type': 'application/json' },
      body: JSON.stringify({ chave, direcao, em: em.toISOString() }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    log(`conversa com lead: ${direcao} ${mascarar(chave)}`);
  } catch (e) {
    vistos.delete(k); // a próxima mensagem tenta de novo
    log(`n8n não recebeu (${direcao} ${mascarar(chave)}):`, e.message);
  }
}

/** Telefone de um chat 1:1: JID de telefone direto, o "alt" que o Baileys 7 manda com LID, ou o mapa LID gravado na sessão. */
async function telefoneDoChat(sock, key) {
  for (const jid of [key.remoteJid, key.remoteJidAlt]) {
    if (jid && jid.endsWith('@s.whatsapp.net')) return jidNormalizedUser(jid).split('@')[0];
  }
  if (key.remoteJid?.endsWith('@lid')) {
    const lid = key.remoteJid.split('@')[0].split(':')[0];
    try {
      const pn = await sock.signalRepository?.lidMapping?.getPNForLID?.(key.remoteJid);
      if (pn) return String(pn).split('@')[0].split(':')[0];
    } catch {}
    const reverso = path.join(SESSAO, `lid-mapping-${lid}_reverse.json`);
    if (existsSync(reverso)) {
      try { return String(JSON.parse(readFileSync(reverso, 'utf8'))); } catch {}
    }
  }
  return '';
}

async function conectar({ parearCom } = {}) {
  mkdirSync(SESSAO, { recursive: true });
  chmodSync(path.dirname(SESSAO), 0o700);
  const { state, saveCreds } = await useMultiFileAuthState(SESSAO);
  const { version } = await fetchLatestBaileysVersion().catch(() => ({}));
  const sock = makeWASocket({
    ...(version ? { version } : {}),
    auth: state,
    logger,
    printQRInTerminal: false,
    browser: ['SquadOne Observador', 'Chrome', '120.0'],
    syncFullHistory: false,
    shouldSyncHistoryMessage: () => false,
    markOnlineOnConnect: false,
    getMessage: async () => ({ conversation: '' }),
  });
  sock.ev.on('creds.update', saveCreds);

  if (parearCom && !state.creds.registered) {
    await new Promise((r) => setTimeout(r, 3000));
    const codigo = await sock.requestPairingCode(parearCom.replace(/\D/g, ''));
    console.log(`\nCódigo de pareamento: ${codigo}\nNo celular: WhatsApp > Dispositivos conectados > Conectar dispositivo > Conectar com número de telefone.\n`);
  }

  sock.ev.on('connection.update', ({ connection, lastDisconnect }) => {
    if (connection === 'open') {
      log('conectado');
      if (parearCom) {
        console.log('Pareado. Pode instalar o serviço.');
        setTimeout(() => process.exit(0), 5000);
      }
    }
    if (connection === 'close') {
      const motivo = lastDisconnect?.error?.output?.statusCode;
      if (motivo === DisconnectReason.loggedOut) {
        log('desconectado pelo celular: é preciso parear de novo');
        avisarPeloHermes('O observador do WhatsApp foi desconectado pelo celular. As conversas com leads não marcam mais a planilha até parear de novo (node observador.mjs --parear).');
        process.exit(3); // systemd não insiste: RestartPreventExitStatus=3
      }
      log('conexão caiu, reconectando em 5 s:', motivo ?? lastDisconnect?.error?.message);
      setTimeout(() => conectar({ parearCom }), 5000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    if (parearCom) return;
    for (const msg of messages) {
      const jid = msg.key?.remoteJid ?? '';
      if (!jid || jid.endsWith('@g.us') || jid === 'status@broadcast' || jid.endsWith('@newsletter') || jid.endsWith('@broadcast')) continue;
      if (!ehMensagemDeVerdade(msg.message)) continue;
      const ts = Number(msg.messageTimestamp ?? 0);
      if (!ts || Date.now() / 1000 - ts > IDADE_MAXIMA_S) continue;
      const chave = chaveDoNumero(await telefoneDoChat(sock, msg.key));
      if (!chave || !chaves.has(chave)) continue;
      await avisarN8n(chave, msg.key.fromMe ? 'saida' : 'entrada', new Date(ts * 1000));
    }
  });
  return sock;
}

const i = process.argv.indexOf('--parear');
if (i > -1) {
  const numero = process.argv[i + 1];
  if (!numero) {
    console.error('Uso: node observador.mjs --parear 55DDDNUMERO');
    process.exit(2);
  }
  await conectar({ parearCom: numero });
} else {
  if (!existsSync(path.join(SESSAO, 'creds.json'))) {
    console.error('Sem sessão: pareie antes com --parear.');
    process.exit(3);
  }
  await relerNumeros();
  setInterval(relerNumeros, RELER_NUMEROS_MS);
  await conectar();
}
