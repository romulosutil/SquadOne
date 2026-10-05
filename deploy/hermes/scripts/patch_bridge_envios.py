#!/usr/bin/env python3
"""Remendo da bridge do WhatsApp do Hermes: envios, recibos e respostas de leads.

O Rômulo aborda os leads pelo celular. O Hermes está vinculado ao número dele
(aparelho conectado, modo self-chat), então a bridge já recebe tudo o que ele
manda e os recibos de entregue/lido dessas mensagens, mas descarta sem registrar.
Este remendo acrescenta três coisas, só leitura passiva (nada é enviado a
ninguém). As duas primeiras vão ao bridge.log sem conteúdo:

- `squadone:envios`: quando o dono escreve numa conversa 1:1 que não é a dele
  mesmo, uma linha `{"event":"owner_sent","chatId","ts"}`. Eco do próprio Hermes
  (recentlySentIds), reação, edição, apagar e voto em enquete não contam.
- `squadone:recibos`: quando uma mensagem do dono numa conversa 1:1 chega ou é
  lida, `{"event":"owner_receipt","chatId","status":"entregue"|"lido","ts"}`
  (3 = entregue; 4 lido e 5 ouviu = lido). No máximo uma linha por chat e
  estado a cada 30 min. `key.fromMe` separa "o lead leu a mensagem do dono" de
  "o dono leu a do lead em outro aparelho" (read-self).
- `squadone:respostas` (05/10/2026, pedido do Rômulo: o CRM precisa saber se a
  resposta é negativa, robô ou interesse): o TEXTO do que um lead escreveu, até
  1000 caracteres (mídia vira "[áudio]", "[imagem] legenda"...), em
  ~/.local/state/whatsapp-observador/respostas.jsonl (600) como
  `{"chave", "ts", "texto"}`. Só para número que está em `leads.json` da mesma
  pasta, a lista que o observador grava a partir das planilhas; sem a lista,
  nada. Amigos, família e clientes não são leads e não têm nada gravado. O
  observador repassa ao n8n e apaga o arquivo.

O `whatsapp-observador` (deploy/dell/whatsapp-observador) lê essas linhas.

`hermes update` guarda e reaplica mudanças locais (autostash), mas pode perder o
remendo se a bridge mudar perto das âncoras. Por isso o aplicar-hermes.py roda
este script, e o observador avisa se o remendo sumir do bridge.js.

Idempotente: tira os blocos `// >>> squadone:` ... `// <<< squadone:` que
houver e põe de novo; se nada muda, não grava. Âncora não encontrada (a bridge
mudou) = sai com 2 e não toca no arquivo. Antes de gravar, confere a sintaxe
com `node --check` e guarda o original em
~/.local/share/claude-ops/backups/<data>/ (fora do git do Hermes, para o
autostash do `hermes update` não levar junto).

Uso:
  patch_bridge_envios.py [--bridge CAMINHO] [--reiniciar] [--avisar]
  patch_bridge_envios.py --verificar      0 = aplicado e atual, 1 = falta aplicar, 2 = bridge incompatível
  patch_bridge_envios.py --remover        volta a bridge ao original (tira os blocos)
  patch_bridge_envios.py --testar         testa numa cópia (nada no Hermes muda)

--reiniciar reinicia o hermes-gateway quando o arquivo muda (a bridge só relê o
bridge.js no boot; o gateway vê o hash diferente e sobe a bridge nova).
--avisar grava um aviso na fila do Hermes (~/.local/share/avisos/fila) se falhar.
"""
from __future__ import annotations

import argparse
import glob
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HOME = Path.home()
BRIDGE = HOME / ".hermes/hermes-agent/scripts/whatsapp-bridge/bridge.js"
BACKUPS = HOME / ".local/share/claude-ops/backups"
FILA_DE_AVISOS = HOME / ".local/share/avisos/fila"

INICIO, FIM = "// >>> squadone:", "// <<< squadone:"

# Envio: dentro do `if (!isSelfChat) {` do modo self-chat (grupo e status já saíram antes).
ENVIOS = """// >>> squadone:envios (SquadOne deploy/hermes/scripts/patch_bridge_envios.py)
// O dono escreveu numa conversa 1:1: só o chat e a hora vão para o log, nunca o conteúdo.
// Eco do Hermes (recentlySentIds), reação, edição, apagar e voto não contam como envio.
try {
  const naoEEnvio = ['protocolMessage', 'reactionMessage', 'encReactionMessage', 'pollUpdateMessage', 'editedMessage',
    'keepInChatMessage', 'pinInChatMessage', 'senderKeyDistributionMessage', 'messageContextInfo'];
  const tipos = Object.keys(getMessageContent(msg) || {}).filter((k) => !naoEEnvio.includes(k));
  if (/@(s\\.whatsapp\\.net|lid)$/.test(chatId) && tipos.length && !recentlySentIds.has(msg.key.id)) {
    writeJsonLine({ event: 'owner_sent', chatId: jidNormalizedUser(chatId), ts: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000) });
  }
} catch {}
// <<< squadone:envios"""

# Recibos: listener próprio, logo antes do messages.upsert (o messages.update original só trata enquete).
RECIBOS = """// >>> squadone:recibos (SquadOne deploy/hermes/scripts/patch_bridge_envios.py)
// Entregue/lido do que o dono mandou numa conversa 1:1 (3 entregue; 4 lido e 5 ouviu = lido).
// Só chat, estado e hora; uma linha por chat e estado a cada 30 min. key.fromMe separa
// "o lead leu a mensagem do dono" de "o dono leu a do lead em outro aparelho" (read-self).
const squadoneRecibos = new Map();
sock.ev.on('messages.update', (updates) => {
  try {
    const meus = [sock.user?.id, sock.user?.lid].map((j) => String(j || '').replace(/[:@].*/, '')).filter(Boolean);
    for (const { key, update } of updates || []) {
      const st = Number(update?.status);
      if (!key?.fromMe || !(st >= 3 && st <= 5)) continue;
      const chatId = jidNormalizedUser(String(key.remoteJid || ''));
      if (!/@(s\\.whatsapp\\.net|lid)$/.test(chatId) || meus.includes(chatId.replace(/@.*/, ''))) continue;
      const status = st === 3 ? 'entregue' : 'lido';
      const agora = Date.now();
      const k = `${chatId}|${status}`;
      if (agora - (squadoneRecibos.get(k) || 0) < 30 * 60 * 1000) continue;
      squadoneRecibos.delete(k);
      squadoneRecibos.set(k, agora);
      if (squadoneRecibos.size > 2000) squadoneRecibos.delete(squadoneRecibos.keys().next().value);
      writeJsonLine({ event: 'owner_receipt', chatId, status, ts: Number(update.messageTimestamp) || Math.floor(agora / 1000) });
    }
  } catch {}
});
// <<< squadone:recibos"""

# Respostas (05/10/2026): o texto do que um LEAD escreveu, para o n8n separar negativa, bot e
# interesse. Fica no ramo do self-chat que hoje só registra "ignored" para quem não é o dono.
# Só grava quando o número está em leads.json (a lista que o observador mantém a partir das
# planilhas): conversa com quem não é lead continua sem nada gravado. Vai para um arquivo
# próprio (600), nunca para o bridge.log; o observador apaga o que já repassou.
RESPOSTAS = """// >>> squadone:respostas (SquadOne deploy/hermes/scripts/patch_bridge_envios.py)
// Texto de LEAD (número em ~/.local/state/whatsapp-observador/leads.json) vai para respostas.jsonl
// (600), nunca para o bridge.log. Número fora da lista: nada é gravado.
try {
  const fs = process.getBuiltinModule('fs');
  const pasta = path.join(process.env.HOME || '~', '.local', 'state', 'whatsapp-observador');
  const lista = path.join(pasta, 'leads.json');
  const st = fs.statSync(lista, { throwIfNoEntry: false });
  const cache = globalThis.squadoneLeads ??= { mtime: -1, chaves: new Set() };
  if (st && st.mtimeMs !== cache.mtime) {
    cache.chaves = new Set(JSON.parse(fs.readFileSync(lista, 'utf8')));
    cache.mtime = st.mtimeMs;
  }
  const usuario = (j) => String(j || '').replace(/[:@].*/, '');
  let tel = '';
  if (/@s\\.whatsapp\\.net$/.test(chatId)) tel = usuario(chatId);
  else if (String(senderAltId || '').endsWith('@s.whatsapp.net')) tel = usuario(senderAltId);
  else if (/@lid$/.test(chatId)) {
    try { tel = String(JSON.parse(fs.readFileSync(path.join(SESSION_DIR, `lid-mapping-${usuario(chatId)}_reverse.json`), 'utf8'))); } catch {}
  }
  let d = tel.replace(/\\D/g, '');
  if (d.length >= 12 && d.startsWith('55')) d = d.slice(2);
  const chave = d.length >= 10 && d.length <= 11 ? d.slice(0, 2) + d.slice(-8) : '';
  if (st && chave && cache.chaves.has(chave)) {
    const c = getMessageContent(msg) || {};
    const legenda = (m) => String(m?.caption || '').trim();
    const texto = String(
      c.conversation ?? c.extendedTextMessage?.text
      ?? c.buttonsResponseMessage?.selectedDisplayText ?? c.templateButtonReplyMessage?.selectedDisplayText
      ?? c.listResponseMessage?.title
      ?? (c.imageMessage ? ('[imagem] ' + legenda(c.imageMessage)).trim()
        : c.videoMessage ? ('[vídeo] ' + legenda(c.videoMessage)).trim()
        : c.audioMessage ? '[áudio]'
        : c.documentMessage ? ('[documento] ' + String(c.documentMessage.fileName || '')).trim()
        : c.stickerMessage ? '[figurinha]'
        : c.contactMessage || c.contactsArrayMessage ? '[contato]'
        : c.locationMessage ? '[localização]' : '')
    ).slice(0, 1000);
    if (texto) {
      fs.appendFileSync(path.join(pasta, 'respostas.jsonl'),
        JSON.stringify({ chave, ts: Number(msg.messageTimestamp) || Math.floor(Date.now() / 1000), texto }) + '\\n',
        { mode: 0o600 });
    }
  }
} catch {}
// <<< squadone:respostas"""

# (nome, regex da âncora, onde entra, recuo extra). A âncora tem de aparecer exatamente uma vez.
ANCORAS = [
    ("respostas",
     re.compile(r"^( *)if \(WHATSAPP_MODE === 'self-chat'\) \{\n(?=\s*try \{\s*\n\s*writeJsonLine\(\{\s*\n\s*event: 'ignored',\s*\n"
                r"\s*reason: 'self_chat_mode_rejects_non_self')", re.M),
     "depois", "  "),
    ("envios",
     re.compile(r"^( *)if \(!isSelfChat\) \{\n(?=\s*emitDebugEvent\(\{\s*\n\s*stage: 'ignored',\s*\n\s*reason: 'self_chat_mismatch')",
                re.M),
     "depois", "  "),
    ("recibos", re.compile(r"^( *)sock\.ev\.on\('messages\.upsert', ", re.M), "antes", ""),
]
BLOCOS = {"envios": ENVIOS, "recibos": RECIBOS, "respostas": RESPOSTAS}

# O que os blocos usam da bridge; se sumir, a bridge mudou demais para remendar às cegas.
REQUISITOS = [
    ("writeJsonLine importado de bridge_helpers.js", re.compile(r"import \{[^}]*\bwriteJsonLine\b[^}]*\} from './bridge_helpers\.js'")),
    ("getMessageContent importado de bridge_helpers.js", re.compile(r"import \{[^}]*\bgetMessageContent\b[^}]*\} from './bridge_helpers\.js'")),
    ("jidNormalizedUser importado do Baileys", re.compile(r"import \{[^}]*\bjidNormalizedUser\b[^}]*\} from '@whiskeysockets/baileys'")),
    ("recentlySentIds (ids do que o Hermes mandou)", re.compile(r"^const recentlySentIds = ", re.M)),
    ("modo self-chat com isSelfChat", re.compile(r"const isSelfChat = ")),
    ("senderAltId e SESSION_DIR (número do lead no formato de telefone)",
     re.compile(r"const senderAltId = [\s\S]*const SESSION_DIR = |const SESSION_DIR = [\s\S]*const senderAltId = ")),
]


class Incompativel(Exception):
    """A bridge mudou de um jeito que o remendo não sabe tratar."""


def sem_remendo(texto: str) -> str:
    """Tira todo bloco `// >>> squadone:` ... `// <<< squadone:` (linhas inteiras)."""
    linhas, fora, dentro = texto.split("\n"), [], None
    for n, linha in enumerate(linhas, 1):
        s = linha.strip()
        if dentro is None and s.startswith(INICIO):
            dentro = n
            continue
        if dentro is not None:
            if s.startswith(FIM):
                dentro = None
            continue
        fora.append(linha)
    if dentro is not None:
        raise Incompativel(f"bloco squadone aberto na linha {dentro} e nunca fechado (remendo pela metade?)")
    return "\n".join(fora)


def remendar(texto: str) -> str:
    """Devolve o bridge.js com os blocos atuais (idempotente)."""
    if re.search(r"^(<{7}|>{7}|={7})( |$)", texto, re.M):
        raise Incompativel("o bridge.js tem marcas de conflito do git (um `hermes update` não reaplicou as mudanças locais)")
    base = sem_remendo(texto)
    faltam = [nome for nome, rx in REQUISITOS if not rx.search(base)]
    if faltam:
        raise Incompativel("a bridge mudou, faltam: " + "; ".join(faltam))
    achados = []
    for nome, rx, onde, extra in ANCORAS:
        ms = list(rx.finditer(base))
        if len(ms) != 1:
            raise Incompativel(f"âncora do bloco {nome!r} encontrada {len(ms)} vez(es), esperado 1 (a bridge mudou)")
        achados.append((ms[0], nome, onde, extra))
    # Do fim para o começo: inserir não desloca as âncoras que faltam.
    for m, nome, onde, extra in sorted(achados, key=lambda a: a[0].start(), reverse=True):
        recuo = m.group(1) + extra
        bloco = "\n".join((recuo + l) if l else l for l in BLOCOS[nome].split("\n")) + "\n"
        pos = m.end() if onde == "depois" else m.start()
        base = base[:pos] + bloco + base[pos:]
    return base


def node() -> str | None:
    achados = sorted(glob.glob(str(HOME / ".hermes/tools/node-*/bin/node")))
    return achados[-1] if achados else shutil.which("node")


def conferir_sintaxe(texto: str) -> None:
    exe = node()
    if not exe:
        print("aviso: node não encontrado; sintaxe não conferida", file=sys.stderr)
        return
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "bridge.mjs"  # .mjs: ESM, como o package.json da bridge ("type": "module")
        arq.write_text(texto, encoding="utf-8")
        r = subprocess.run([exe, "--check", str(arq)], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise Incompativel("o bridge.js remendado não passa no node --check: " + (r.stderr.strip().splitlines() or ["?"])[-1])


def gravar(caminho: Path, texto: str) -> Path:
    """Backup do original fora do git do Hermes e troca atômica (mantém as permissões)."""
    pasta = BACKUPS / time.strftime("%Y-%m-%d")
    pasta.mkdir(parents=True, exist_ok=True)
    backup, n = pasta / f"bridge.js.{time.strftime('%H%M%S')}", 1
    while backup.exists():
        backup, n = pasta / f"bridge.js.{time.strftime('%H%M%S')}-{n}", n + 1
    shutil.copy2(caminho, backup)
    tmp = caminho.with_name(caminho.name + ".squadone-tmp")
    tmp.write_text(texto, encoding="utf-8")
    os.chmod(tmp, caminho.stat().st_mode & 0o7777)
    tmp.replace(caminho)
    return backup


def avisar(texto: str) -> None:
    try:
        FILA_DE_AVISOS.mkdir(parents=True, exist_ok=True)
        (FILA_DE_AVISOS / f"bridge-envios-{int(time.time())}.json").write_text(
            json.dumps({"titulo": "⚠️ Hermes (WhatsApp)", "texto": texto}, ensure_ascii=False), encoding="utf-8")
    except OSError as e:
        print("aviso não gravado:", e, file=sys.stderr)


def aplicar(caminho: Path, remover: bool = False) -> bool:
    """True se o arquivo mudou."""
    atual = caminho.read_text(encoding="utf-8")
    novo = sem_remendo(atual) if remover else remendar(atual)
    if novo == atual:
        return False
    conferir_sintaxe(novo)
    backup = gravar(caminho, novo)
    print(f"backup    {backup}")
    return True


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--bridge", type=Path, default=BRIDGE)
    grupo = ap.add_mutually_exclusive_group()
    grupo.add_argument("--verificar", action="store_true")
    grupo.add_argument("--remover", action="store_true")
    grupo.add_argument("--testar", action="store_true")
    ap.add_argument("--reiniciar", action="store_true", help="reinicia o hermes-gateway se o bridge.js mudou")
    ap.add_argument("--avisar", action="store_true", help="falha vira aviso na fila do Hermes")
    a = ap.parse_args()

    if a.testar:
        return testar(a.bridge)
    try:
        if not a.bridge.is_file():
            raise Incompativel(f"{a.bridge} não existe")
        if a.verificar:
            atual = a.bridge.read_text(encoding="utf-8")
            if remendar(atual) == atual:
                print(f"aplicado  {a.bridge}")
                return 0
            print(f"falta     {a.bridge}")
            return 1
        mudou = aplicar(a.bridge, remover=a.remover)
    except (Incompativel, OSError, subprocess.SubprocessError) as e:
        print(f"ERRO: remendo da bridge não aplicado: {e}", file=sys.stderr)
        if a.avisar:
            avisar("O remendo da bridge do WhatsApp não entrou (" + str(e) + "). Enquanto isso, as mensagens que "
                   "você manda aos leads e os recibos de leitura não marcam a planilha; as respostas dos leads "
                   "continuam marcando. Precisa ajustar deploy/hermes/scripts/patch_bridge_envios.py.")
        return 2
    acao = "removido" if a.remover else "aplicado"
    print(f"{acao if mudou else 'igual'}{' ' * (10 - len(acao if mudou else 'igual'))}{a.bridge}")
    if mudou and a.reiniciar:
        subprocess.run(["systemctl", "--user", "restart", "hermes-gateway"], check=True)
        print("reiniciado hermes-gateway")
    elif mudou:
        print("a bridge só relê o bridge.js no boot: systemctl --user restart hermes-gateway")
    return 0


# ---------------------------------------------------------------- testes

TESTE_ENVIOS = r"""
const saida = [];
const writeJsonLine = (p) => saida.push(p);
const getMessageContent = (m) => { let c = m?.message || {}; while (c.ephemeralMessage?.message) c = c.ephemeralMessage.message; return c; };
const jidNormalizedUser = (j) => String(j).replace(/:\d+@/, '@');
const recentlySentIds = new Set(['ECO1']);
const casos = CASOS;
for (const [chatId, msg] of casos) {
  (() => {
BLOCO
  })();
}
console.log(JSON.stringify(saida));
"""

TESTE_RECIBOS = r"""
const saida = [];
const writeJsonLine = (p) => saida.push(p);
const jidNormalizedUser = (j) => String(j).replace(/:\d+@/, '@');
const ouvintes = [];
const sock = { user: { id: '5527999990000:12@s.whatsapp.net', lid: '11112222:12@lid' }, ev: { on: (n, f) => ouvintes.push([n, f]) } };
BLOCO
const f = ouvintes.find(([n]) => n === 'messages.update')[1];
for (const lote of LOTES) f(lote);
console.log(JSON.stringify({ saida, ouvintes: ouvintes.map(([n]) => n) }));
"""


def rodar_js(codigo: str):
    exe = node()
    if not exe:
        raise SystemExit("node não encontrado")
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "t.mjs"
        arq.write_text(codigo, encoding="utf-8")
        r = subprocess.run([exe, str(arq)], capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        raise AssertionError(r.stderr)
    return json.loads(r.stdout)


def testar(bridge: Path) -> int:
    import unittest

    original = bridge.read_text(encoding="utf-8")

    class Remendo(unittest.TestCase):
        def setUp(self):
            self.dir = Path(tempfile.mkdtemp())
            self.copia = self.dir / "bridge.js"
            self.copia.write_text(sem_remendo(original), encoding="utf-8")
            global BACKUPS
            self._backups, BACKUPS = BACKUPS, self.dir / "backups"

        def tearDown(self):
            global BACKUPS
            BACKUPS = self._backups
            shutil.rmtree(self.dir)

        def test_aplica_uma_vez_e_depois_nao_mexe(self):
            limpo = self.copia.read_text()
            self.assertTrue(aplicar(self.copia))
            uma = self.copia.read_text()
            self.assertEqual(uma.count("// >>> squadone:envios"), 1)
            self.assertEqual(uma.count("// >>> squadone:recibos"), 1)
            self.assertEqual(uma.count("// >>> squadone:respostas"), 1)
            i_resp = uma.index("// >>> squadone:respostas")
            self.assertLess(uma.index("if (WHATSAPP_MODE === 'self-chat') {", uma.index("if (!msg.key.fromMe) {")), i_resp)
            self.assertLess(i_resp, uma.index("reason: 'self_chat_mode_rejects_non_self'"))
            self.assertFalse(aplicar(self.copia))
            self.assertEqual(self.copia.read_text(), uma)
            self.assertEqual(len(list((self.dir / "backups").rglob("bridge.js.*"))), 1)
            self.assertEqual(sem_remendo(uma), limpo)
            conferir_sintaxe(uma)

        def test_envio_fica_no_ramo_do_self_chat_e_recibos_antes_do_upsert(self):
            aplicar(self.copia)
            t = self.copia.read_text()
            i_self = t.index("if (!isSelfChat) {")
            i_env = t.index("// >>> squadone:envios")
            i_dbg = t.index("reason: 'self_chat_mismatch'")
            self.assertTrue(i_self < i_env < i_dbg)
            self.assertLess(t.index("// <<< squadone:recibos"), t.index("sock.ev.on('messages.upsert'"))
            self.assertNotIn("body", ENVIOS + RECIBOS)  # nada de conteúdo

        def test_remover_volta_ao_original(self):
            limpo = self.copia.read_text()
            aplicar(self.copia)
            self.assertTrue(aplicar(self.copia, remover=True))
            self.assertEqual(self.copia.read_text(), limpo)

        def test_versao_antiga_do_bloco_e_trocada(self):
            aplicar(self.copia)
            velho = self.copia.read_text().replace("event: 'owner_sent'", "event: 'owner_sent_v0'")
            self.copia.write_text(velho)
            self.assertTrue(aplicar(self.copia))
            self.assertNotIn("owner_sent_v0", self.copia.read_text())

        def test_ancora_sumiu_nao_toca_no_arquivo(self):
            mudado = self.copia.read_text().replace("reason: 'self_chat_mismatch'", "reason: 'outro_motivo'")
            self.copia.write_text(mudado)
            with self.assertRaises(Incompativel):
                aplicar(self.copia)
            self.assertEqual(self.copia.read_text(), mudado)
            self.assertFalse((self.dir / "backups").exists())

        def test_requisito_sumiu(self):
            self.copia.write_text(self.copia.read_text().replace("const recentlySentIds = ", "const idsEnviados = "))
            with self.assertRaisesRegex(Incompativel, "recentlySentIds"):
                aplicar(self.copia)

        def test_conflito_do_git(self):
            self.copia.write_text("<<<<<<< Updated upstream\n" + self.copia.read_text())
            with self.assertRaisesRegex(Incompativel, "conflito"):
                aplicar(self.copia)

        def test_bloco_aberto(self):
            self.copia.write_text(self.copia.read_text() + "\n// >>> squadone:envios\n")
            with self.assertRaisesRegex(Incompativel, "nunca fechado"):
                aplicar(self.copia)

        def test_saida_do_script(self):
            r = subprocess.run([sys.executable, __file__, "--bridge", str(self.copia), "--verificar"], capture_output=True)
            self.assertEqual(r.returncode, 1)
            env = dict(os.environ, HOME=str(self.dir))  # backup e aviso na pasta do teste
            r = subprocess.run([sys.executable, __file__, "--bridge", str(self.copia)], capture_output=True, env=env)
            self.assertEqual(r.returncode, 0, r.stderr)
            r = subprocess.run([sys.executable, __file__, "--bridge", str(self.copia), "--verificar"], capture_output=True)
            self.assertEqual(r.returncode, 0)
            self.copia.write_text(self.copia.read_text().replace("if (!isSelfChat) {", "if (!ehSelf) {"))
            r = subprocess.run([sys.executable, __file__, "--bridge", str(self.copia), "--avisar"], capture_output=True, env=env)
            self.assertEqual(r.returncode, 2)
            avisos = list((self.dir / ".local/share/avisos/fila").glob("*.json"))
            self.assertEqual(len(avisos), 1)
            self.assertIn("remendo da bridge", json.loads(avisos[0].read_text())["texto"])

    class Comportamento(unittest.TestCase):
        def test_envios(self):
            casos = [
                ["5527988887777@s.whatsapp.net", {"key": {"id": "A"}, "message": {"conversation": "oi"}, "messageTimestamp": 1790770000}],
                ["123456789@lid", {"key": {"id": "B"}, "message": {"ephemeralMessage": {"message": {"extendedTextMessage": {"text": "x"}}}}}],
                ["5527988887777:3@s.whatsapp.net", {"key": {"id": "C"}, "message": {"imageMessage": {}, "messageContextInfo": {}}, "messageTimestamp": 7}],
                ["5527988887777@s.whatsapp.net", {"key": {"id": "ECO1"}, "message": {"conversation": "eco do Hermes"}}],
                ["5527988887777@s.whatsapp.net", {"key": {"id": "D"}, "message": {"reactionMessage": {"text": "👍"}}}],
                ["5527988887777@s.whatsapp.net", {"key": {"id": "E"}, "message": {"protocolMessage": {"type": 0}}}],
                ["5527988887777@s.whatsapp.net", {"key": {"id": "F"}, "message": {"editedMessage": {}, "messageContextInfo": {}}}],
                ["120363000000000000@newsletter", {"key": {"id": "G"}, "message": {"conversation": "canal"}}],
                ["1234567890@broadcast", {"key": {"id": "H"}, "message": {"conversation": "lista"}}],
            ]
            bloco = "\n".join("    " + l for l in ENVIOS.split("\n"))
            saida = rodar_js(TESTE_ENVIOS.replace("CASOS", json.dumps(casos)).replace("BLOCO", bloco))
            self.assertEqual([s["chatId"] for s in saida],
                             ["5527988887777@s.whatsapp.net", "123456789@lid", "5527988887777@s.whatsapp.net"])
            self.assertEqual(saida[0], {"event": "owner_sent", "chatId": "5527988887777@s.whatsapp.net", "ts": 1790770000})
            self.assertEqual(saida[2]["ts"], 7)
            self.assertGreater(saida[1]["ts"], 1700000000)  # sem messageTimestamp: agora
            self.assertTrue(all(set(s) == {"event", "chatId", "ts"} for s in saida))

        def test_recibos(self):
            lead, eu, eu_lid = "5527988887777@s.whatsapp.net", "5527999990000@s.whatsapp.net", "11112222@lid"
            lotes = [
                [{"key": {"remoteJid": lead, "fromMe": True, "id": "1"}, "update": {"status": 2}}],  # servidor: não
                [{"key": {"remoteJid": lead, "fromMe": True, "id": "1"}, "update": {"status": 3, "messageTimestamp": 100}},
                 {"key": {"remoteJid": "5527988887777:2@s.whatsapp.net", "fromMe": True, "id": "1"}, "update": {"status": 3}}],
                [{"key": {"remoteJid": lead, "fromMe": True, "id": "1"}, "update": {"status": 4, "messageTimestamp": 200}},
                 {"key": {"remoteJid": lead, "fromMe": True, "id": "2"}, "update": {"status": 4}}],
                [{"key": {"remoteJid": lead, "fromMe": False, "id": "9"}, "update": {"status": 4}}],  # read-self
                [{"key": {"remoteJid": eu, "fromMe": True, "id": "3"}, "update": {"status": 4}}],     # self-chat
                [{"key": {"remoteJid": eu_lid, "fromMe": True, "id": "4"}, "update": {"status": 4}}],
                [{"key": {"remoteJid": "120363@g.us", "fromMe": True, "id": "5"}, "update": {"status": 4}}],
                [{"key": {"remoteJid": "777@lid", "fromMe": True, "id": "6"}, "update": {"status": 5, "messageTimestamp": 300}}],
                [{"key": {"remoteJid": lead, "fromMe": True, "id": "7"}, "update": {"pollUpdates": []}}],
            ]
            bloco = RECIBOS
            r = rodar_js(TESTE_RECIBOS.replace("LOTES", json.dumps(lotes)).replace("BLOCO", bloco))
            self.assertEqual(r["ouvintes"], ["messages.update"])
            self.assertEqual(r["saida"], [
                {"event": "owner_receipt", "chatId": lead, "status": "entregue", "ts": 100},
                {"event": "owner_receipt", "chatId": lead, "status": "lido", "ts": 200},
                {"event": "owner_receipt", "chatId": "777@lid", "status": "lido", "ts": 300},
            ])

        def test_respostas_so_de_lead_e_fora_do_log(self):
            casa = Path(tempfile.mkdtemp())
            try:
                pasta = casa / ".local/state/whatsapp-observador"
                sessao = casa / "sessao"
                pasta.mkdir(parents=True)
                sessao.mkdir()
                (pasta / "leads.json").write_text(json.dumps(["2788887777", "1144445555"]))
                (sessao / "lid-mapping-999_reverse.json").write_text(json.dumps("5511944445555"))
                lead, amigo = "5527988887777@s.whatsapp.net", "5521911112222@s.whatsapp.net"
                casos = [
                    [lead, "", {"conversation": "Não temos interesse, obrigado"}, 1790770000],
                    [amigo, "", {"conversation": "conversa pessoal"}, 1790770001],          # fora da lista
                    ["999@lid", "", {"extendedTextMessage": {"text": "pode mandar"}}, 1790770002],  # lid -> mapa
                    ["555@lid", lead, {"audioMessage": {}}, 1790770003],                      # lid -> senderAltId
                    [lead, "", {"imageMessage": {"caption": "cardápio"}}, 1790770004],
                    [lead, "", {"reactionMessage": {"text": "👍"}}, 1790770005],             # sem texto
                ]
                bloco = "\n".join("    " + l for l in RESPOSTAS.split("\n"))
                prog = ("import path from 'path';\nconst saida = [];\nconst writeJsonLine = (p) => saida.push(p);\n"
                        f"process.env.HOME = {json.dumps(str(casa))};\nconst SESSION_DIR = {json.dumps(str(sessao))};\n"
                        "const getMessageContent = (m) => m.message;\n"
                        f"for (const [chatId, senderAltId, message, ts] of {json.dumps(casos)}) {{\n"
                        "  const msg = { message, messageTimestamp: ts };\n  (() => {\n" + bloco + "\n  })();\n}\n"
                        "console.log(JSON.stringify(saida));\n")
                self.assertEqual(rodar_js(prog), [])  # nada no bridge.log
                linhas = [json.loads(l) for l in (pasta / "respostas.jsonl").read_text().splitlines()]
                self.assertEqual(linhas, [
                    {"chave": "2788887777", "ts": 1790770000, "texto": "Não temos interesse, obrigado"},
                    {"chave": "1144445555", "ts": 1790770002, "texto": "pode mandar"},
                    {"chave": "2788887777", "ts": 1790770003, "texto": "[áudio]"},
                    {"chave": "2788887777", "ts": 1790770004, "texto": "[imagem] cardápio"},
                ])
                if os.name != "nt":
                    self.assertEqual((pasta / "respostas.jsonl").stat().st_mode & 0o777, 0o600)
                # Sem leads.json: nada é gravado.
                (pasta / "respostas.jsonl").unlink()
                (pasta / "leads.json").unlink()
                rodar_js(prog.replace("globalThis.squadoneLeads", "globalThis.squadoneLeads2"))
                self.assertFalse((pasta / "respostas.jsonl").exists())
            finally:
                shutil.rmtree(casa)

    carga = unittest.TestLoader()
    suite = unittest.TestSuite([carga.loadTestsFromTestCase(Remendo), carga.loadTestsFromTestCase(Comportamento)])
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main())
