#!/usr/bin/env python3
"""Testes do adaptador da Evolution API com webhooks de mentira, pasta temporária e relógio fixo.
Nada sobe a Evolution, toca o Dell, o n8n, a fila de avisos real ou a pasta ~/.local/state; os
números são fictícios. O fim da cadeia é o observador de verdade (`observador.py`) lendo o que o
adaptador escreveu, com o n8n de mentira: é o que prova que os dois falam a mesma língua.

  python3 deploy/dell/whatsapp-observador/evolution-adaptador.test.py
"""
import importlib.util
import json
import os
import shutil
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from pathlib import Path

AQUI = Path(__file__).resolve().parent


def carregar(nome, arquivo):
    spec = importlib.util.spec_from_file_location(nome, AQUI / arquivo)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


ev = carregar("evolution_adaptador", "evolution-adaptador.py")
ob = carregar("observador", "observador.py")

LEAD, LEAD2, OUTRO = "5527999887766", "5511988776655", "5521977776666"
CHAVE, CHAVE2 = ev.chave_do_numero(LEAD), ev.chave_do_numero(LEAD2)
LEADS = {CHAVE, CHAVE2}
T0 = 1790773200.0  # 30/09/2026 10:00 (Brasília)


def upsert(numero, texto="oi", de_mim=False, id_="A1", ts=None, dominio="s.whatsapp.net", **extra_key):
    key = {"remoteJid": f"{numero}@{dominio}", "fromMe": de_mim, "id": id_, **extra_key}
    return {"event": "messages.upsert", "instance": "prumo",
            "data": {"key": key, "pushName": "Fulana", "message": {"conversation": texto}, "messageType": "conversation",
                     "messageTimestamp": int(ts if ts is not None else T0 - 5), "source": "android"}}


def atualizacao(numero, status="READ", de_mim=True, via_key=False):
    base = {"remoteJid": f"{numero}@s.whatsapp.net", "status": status}
    if via_key:
        return {"event": "MESSAGES_UPDATE", "instance": "prumo",
                "data": {"key": {"remoteJid": base["remoteJid"], "fromMe": de_mim, "id": "B1"}, "status": status}}
    return {"event": "MESSAGES_UPDATE", "instance": "prumo", "data": {**base, "fromMe": de_mim, "messageId": "B1"}}


class Nomes(unittest.TestCase):
    def test_evento_com_ponto_hifen_ou_maiusculas_e_o_mesmo(self):
        for n in ("messages.upsert", "MESSAGES_UPSERT", "messages-upsert", " Messages.Upsert "):
            self.assertEqual(ev.normalizar_evento(n), "MESSAGES_UPSERT")
        self.assertEqual(ev.normalizar_evento(None), "")

    def test_chave_igual_a_do_observador(self):
        for n in (LEAD, LEAD2, "552799887766", "27999887766", "5527988776655", "123", "", None, "55279998877661234"):
            self.assertEqual(ev.chave_do_numero(n), ob.chave_do_numero(n), n)

    def test_jid_de_telefone(self):
        self.assertEqual(ev.jid_de_telefone(f"{LEAD}@s.whatsapp.net"), f"{LEAD}@s.whatsapp.net")
        self.assertEqual(ev.jid_de_telefone(f"{LEAD}:12@s.whatsapp.net"), f"{LEAD}@s.whatsapp.net")  # aparelho
        self.assertEqual(ev.jid_de_telefone(f"{LEAD}@c.us"), f"{LEAD}@s.whatsapp.net")
        for ruim in ("123@lid", "1203630@g.us", "status@broadcast", "x@newsletter", "semarroba", "", None, 5,
                     "12@s.whatsapp.net"):
            self.assertEqual(ev.jid_de_telefone(ruim), "", ruim)

    def test_hora(self):
        self.assertEqual(ev.hora_do_evento(T0 - 60, T0), T0 - 60)
        self.assertEqual(ev.hora_do_evento(str(int(T0 - 60)), T0), int(T0) - 60)
        self.assertEqual(ev.hora_do_evento((T0 - 60) * 1000, T0), T0 - 60)  # milissegundos
        for ruim in (None, "x", 0, 123, T0 + 99999, {"low": 1}):
            self.assertEqual(ev.hora_do_evento(ruim, T0), T0, ruim)


class Textos(unittest.TestCase):
    def test_texto_simples_e_estendido(self):
        self.assertEqual(ev.texto_da_mensagem({"conversation": "  Sim, quero ver  "}), "Sim, quero ver")
        self.assertEqual(ev.texto_da_mensagem({"extendedTextMessage": {"text": "olha https://x.com"}}), "olha https://x.com")

    def test_midia_como_na_bridge(self):
        casos = [({"audioMessage": {}}, "[áudio]"), ({"imageMessage": {"caption": " cardápio "}}, "[imagem] cardápio"),
                 ({"imageMessage": {}}, "[imagem]"), ({"videoMessage": {"caption": "x"}}, "[vídeo] x"),
                 ({"documentMessage": {"fileName": "tabela.pdf"}}, "[documento] tabela.pdf"),
                 ({"stickerMessage": {}}, "[figurinha]"), ({"contactMessage": {}}, "[contato]"),
                 ({"locationMessage": {}}, "[localização]"),
                 ({"buttonsResponseMessage": {"selectedDisplayText": "Quero saber mais"}}, "Quero saber mais"),
                 ({"listResponseMessage": {"title": "Orçamento"}}, "Orçamento")]
        for msg, esperado in casos:
            self.assertEqual(ev.texto_da_mensagem(msg), esperado, msg)

    def test_embrulhos_abrem_e_ruido_some(self):
        self.assertEqual(ev.texto_da_mensagem({"ephemeralMessage": {"message": {"conversation": "oi"}}}), "oi")
        self.assertEqual(ev.texto_da_mensagem({"viewOnceMessageV2": {"message": {"imageMessage": {"caption": "k"}}}}), "[imagem] k")
        for ruido in ({"reactionMessage": {"text": "👍"}}, {"protocolMessage": {"type": 0}},
                      {"editedMessage": {"message": {"conversation": "oi 2"}}}, {"pollUpdateMessage": {}}, {}, None, "texto"):
            self.assertEqual(ev.texto_da_mensagem(ruido), "", ruido)

    def test_limite_de_1000(self):
        self.assertEqual(len(ev.texto_da_mensagem({"conversation": "a" * 5000})), 1000)

    def test_recibos(self):
        for v in ("READ", "read", "PLAYED", 4, 5):
            self.assertEqual(ev.estado_do_recibo(v), "lido", v)
        for v in ("DELIVERY_ACK", "DELIVERED", 3):
            self.assertEqual(ev.estado_do_recibo(v), "entregue", v)
        for v in ("SERVER_ACK", "PENDING", "ERROR", 0, 1, 2, None, True, ""):
            self.assertEqual(ev.estado_do_recibo(v), "", v)

    def test_forma_nao_leva_valor_nenhum(self):
        f = ev.forma({"key": {"remoteJid": f"{LEAD}@s.whatsapp.net", "fromMe": True}, "message": {"conversation": "segredo"},
                      "n": 3, "lista": [{"a": 1}], "vazia": [], "nada": None})
        texto = json.dumps(f)
        for vazou in (LEAD, "segredo", "s.whatsapp.net"):
            self.assertNotIn(vazou, texto)
        self.assertEqual(f["key"], {"fromMe": "bool", "remoteJid": "str"})
        self.assertEqual(f["lista"], [{"a": "int"}])
        self.assertEqual(f["nada"], "null")


class Traducao(unittest.TestCase):
    def tr(self, corpo, leads=LEADS, vistos=None, instancia=""):
        return ev.traduzir(corpo, leads, T0, vistos, instancia)

    def test_lead_escreveu_vira_linha_da_bridge_e_texto(self):
        t = self.tr(upsert(LEAD, "Sim, quero ver"))
        self.assertEqual(t.linhas, [{"event": "ignored", "reason": ev.MOTIVO, "chatId": f"{LEAD}@s.whatsapp.net",
                                     "senderId": f"{LEAD}@s.whatsapp.net"}])
        self.assertEqual(t.respostas, [{"chave": CHAVE, "ts": int(T0) - 5, "texto": "Sim, quero ver"}])

    def test_o_prumo_escreveu_vira_owner_sent_sem_texto(self):
        t = self.tr(upsert(LEAD, "olá, tudo bem?", de_mim=True, ts=T0 - 30))
        self.assertEqual(t.linhas, [{"event": "owner_sent", "chatId": f"{LEAD}@s.whatsapp.net", "ts": int(T0) - 30}])
        self.assertEqual(t.respostas, [])
        self.assertNotIn("olá", json.dumps(t.linhas))

    def test_lead_leu_vira_owner_receipt(self):
        for corpo in (atualizacao(LEAD), atualizacao(LEAD, via_key=True), atualizacao(LEAD, "PLAYED"), atualizacao(LEAD, 4)):
            t = self.tr(corpo)
            self.assertEqual(t.linhas, [{"event": "owner_receipt", "chatId": f"{LEAD}@s.whatsapp.net",
                                         "status": "lido", "ts": int(T0)}], corpo)

    def test_recibo_que_nao_e_o_do_lead_ler_o_nosso(self):
        t = self.tr(atualizacao(LEAD, "DELIVERY_ACK"))
        self.assertEqual((t.linhas, t.ignorados), ([], {"recibo_entregue": 1}))
        t = self.tr(atualizacao(LEAD, "SERVER_ACK"))
        self.assertEqual(t.ignorados, {"recibo_sem_estado": 1})
        t = self.tr(atualizacao(LEAD, "READ", de_mim=False))  # o PRUMO leu a mensagem do lead
        self.assertEqual((t.linhas, t.ignorados), ([], {"recibo_de_entrada": 1}))
        sem = atualizacao(LEAD)
        del sem["data"]["fromMe"]
        t = self.tr(sem)
        self.assertEqual((t.linhas, t.ignorados), ([], {"recibo_sem_fromMe": 1}))

    def test_quem_nao_e_lead_nao_deixa_rastro(self):
        for corpo in (upsert(OUTRO, "oi mãe"), upsert(OUTRO, "olá", de_mim=True), atualizacao(OUTRO)):
            t = self.tr(corpo)
            self.assertEqual((t.linhas, t.respostas, t.ignorados), ([], [], {"nao_e_lead": 1}), corpo)

    def test_sem_a_lista_de_leads_nada_e_gravado(self):
        for corpo in (upsert(LEAD), upsert(LEAD, de_mim=True), atualizacao(LEAD)):
            t = self.tr(corpo, leads=None)
            self.assertEqual((t.linhas, t.respostas, t.ignorados), ([], [], {"sem_lista_de_leads": 1}))

    def test_grupo_canal_e_status_ficam_de_fora(self):
        for dominio in ("g.us", "newsletter", "broadcast"):
            t = self.tr(upsert("120363000000", dominio=dominio))
            self.assertEqual((t.linhas, t.ignorados), ([], {"nao_e_conversa_1a1": 1}), dominio)

    def test_lid_usa_o_telefone_alternativo_ou_descarta(self):
        t = self.tr(upsert("207678898962522", dominio="lid", remoteJidAlt=f"{LEAD}@s.whatsapp.net"))
        self.assertEqual(t.linhas[0]["chatId"], f"{LEAD}@s.whatsapp.net")
        corpo = upsert("207678898962522", dominio="lid")
        corpo["data"]["senderPn"] = f"{LEAD2}@s.whatsapp.net"
        self.assertEqual(self.tr(corpo).linhas[0]["chatId"], f"{LEAD2}@s.whatsapp.net")
        t = self.tr(upsert("207678898962522", dominio="lid"))
        self.assertEqual((t.linhas, t.respostas, t.ignorados), ([], [], {"lid_sem_telefone": 1}))
        # um alternativo que também é @lid não é telefone
        t = self.tr(upsert("207678898962522", dominio="lid", remoteJidAlt="999@lid"))
        self.assertEqual(t.ignorados, {"lid_sem_telefone": 1})

    def test_reentrega_do_mesmo_id_nao_conta_duas_vezes(self):
        vistos = ev.Recentes()
        a = self.tr(upsert(LEAD, "oi", id_="X"), vistos=vistos)
        b = self.tr(upsert(LEAD, "oi", id_="X"), vistos=vistos)
        c = self.tr(upsert(LEAD, "oi", id_="Y"), vistos=vistos)
        self.assertEqual((len(a.respostas), len(b.respostas), len(c.respostas)), (1, 0, 1))
        self.assertEqual(b.ignorados, {"reentrega": 1})

    def test_recentes_tem_teto(self):
        r = ev.Recentes(maximo=3)
        for i in range(10):
            r.add(i)
        self.assertEqual(len(r.conjunto), 3)
        self.assertIn(9, r)
        self.assertNotIn(0, r)

    def test_reacao_edicao_e_apagar_nao_sao_conversa(self):
        for msg in ({"reactionMessage": {"text": "👍"}}, {"protocolMessage": {"type": 0}}, {"editedMessage": {}}):
            for de_mim in (True, False):
                corpo = upsert(LEAD, de_mim=de_mim, id_=f"R{de_mim}{list(msg)[0]}")
                corpo["data"]["message"] = msg
                t = self.tr(corpo)
                self.assertEqual((t.linhas, t.respostas), ([], []), (msg, de_mim))

    def test_mensagem_de_lead_sem_texto_ainda_e_entrada(self):
        corpo = upsert(LEAD)
        corpo["data"]["message"] = {"audioMessage": {"seconds": 4}}
        t = self.tr(corpo)
        self.assertEqual(len(t.linhas), 1)
        self.assertEqual(t.respostas[0]["texto"], "[áudio]")

    def test_formas_do_data(self):
        a, b = upsert(LEAD, id_="L1"), upsert(LEAD2, id_="L2")
        lista = {"event": "MESSAGES_UPSERT", "data": [a["data"], b["data"]]}
        self.assertEqual(len(self.tr(lista).linhas), 2)
        embrulhada = {"event": "MESSAGES_UPSERT", "data": {"messages": [upsert(LEAD, id_="L3")["data"]]}}
        self.assertEqual(len(self.tr(embrulhada).linhas), 1)

    def test_instancia_diferente_e_ignorada(self):
        t = self.tr(upsert(LEAD), instancia="outra")
        self.assertEqual((t.linhas, t.ignorados), ([], {"outra_instancia": 1}))
        self.assertEqual(len(self.tr(upsert(LEAD), instancia="prumo").linhas), 1)

    def test_eventos_sem_uso_e_lixo(self):
        self.assertEqual(self.tr({"event": "PRESENCE_UPDATE", "data": {}}).ignorados, {"evento_sem_uso": 1})
        for lixo in (None, [], "texto", 3):
            self.assertEqual(self.tr(lixo).ignorados, {"corpo_invalido": 1})
        self.assertEqual(self.tr({"event": "MESSAGES_UPSERT"}).linhas, [])
        self.assertEqual(self.tr({"event": "MESSAGES_UPSERT", "data": {"key": "x"}}).linhas, [])

    def test_conexao(self):
        for estado in ("open", "close", "connecting"):
            t = self.tr({"event": "connection.update", "data": {"state": estado, "statusReason": 401}})
            self.assertEqual((t.conexao, t.linhas), (estado, []))
        self.assertEqual(self.tr({"event": "CONNECTION_UPDATE", "data": {"state": "?"}}).conexao, "")


class Arquivos(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="evolution-teste-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.pasta = self.dir / "prumo"

    def test_cria_o_log_vazio_para_o_observador_achar(self):
        ev.Gravador(self.pasta)
        self.assertTrue((self.pasta / "evolution.log").is_file())
        self.assertEqual((self.pasta / "evolution.log").read_text(), "")

    @unittest.skipIf(os.name == "nt", "modo 600 não se aplica no Windows")
    def test_arquivos_sao_600(self):
        g = ev.Gravador(self.pasta)
        g.escrever(ev.traduzir(upsert(LEAD, "oi"), LEADS, T0))
        for nome in ("evolution.log", "respostas.jsonl"):
            self.assertEqual((self.pasta / nome).stat().st_mode & 0o777, 0o600, nome)

    def test_anexa_em_vez_de_sobrescrever(self):
        g = ev.Gravador(self.pasta)
        v = ev.Recentes()
        g.escrever(ev.traduzir(upsert(LEAD, "um", id_="1"), LEADS, T0, v))
        g.escrever(ev.traduzir(upsert(LEAD, "dois", id_="2"), LEADS, T0, v))
        self.assertEqual(len((self.pasta / "evolution.log").read_text().splitlines()), 2)
        textos = [json.loads(l)["texto"] for l in (self.pasta / "respostas.jsonl").read_text().splitlines()]
        self.assertEqual(textos, ["um", "dois"])

    def test_o_log_nao_tem_texto_de_conversa(self):
        g = ev.Gravador(self.pasta)
        g.escrever(ev.traduzir(upsert(LEAD, "meu segredo", id_="9"), LEADS, T0))
        g.escrever(ev.traduzir(upsert(LEAD, "outro segredo", de_mim=True, id_="10"), LEADS, T0))
        self.assertNotIn("segredo", (self.pasta / "evolution.log").read_text())

    def test_leads_lidos_so_quando_o_arquivo_muda_e_falha_fechada(self):
        g = ev.Gravador(self.pasta)
        self.assertIsNone(g.leads())  # nada gravado ainda pelo observador
        (self.pasta / "leads.json").write_text(json.dumps([CHAVE]))
        self.assertEqual(g.leads(), {CHAVE})
        (self.pasta / "leads.json").write_text("{ não é json")
        os.utime(self.pasta / "leads.json", (1, 2))
        self.assertIsNone(g.leads())
        (self.pasta / "leads.json").write_text(json.dumps({"não": "lista"}))
        os.utime(self.pasta / "leads.json", (3, 4))
        self.assertIsNone(g.leads())

    def test_rotaciona_o_log_grande(self):
        g = ev.Gravador(self.pasta, limite_log=200)
        v = ev.Recentes()
        for i in range(12):
            g.escrever(ev.traduzir(upsert(LEAD, "oi", de_mim=True, id_=f"m{i}", ts=T0 - i), LEADS, T0, v))
        self.assertTrue((self.pasta / "evolution.log.1").is_file())
        self.assertLess((self.pasta / "evolution.log").stat().st_size, 600)


class Servico(unittest.TestCase):
    """O adaptador por trás do HTTP de verdade (porta efêmera no loopback)."""

    SEGREDO = "segredo-de-teste"

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="evolution-teste-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.avisos = []
        self.g = ev.Gravador(self.dir)
        (self.dir / "leads.json").write_text(json.dumps(sorted(LEADS)))
        self.adaptador = ev.Adaptador(self.g, relogio=lambda: T0, avisar=self.avisos.append, instancia="prumo")
        self.servidor = ev.criar_servidor(self.adaptador, self.SEGREDO, porta=0)
        self.porta = self.servidor.server_address[1]
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()
        self.addCleanup(self.servidor.server_close)
        self.addCleanup(self.servidor.shutdown)

    def chamar(self, metodo="POST", caminho="/evolution", corpo=None, segredo=SEGREDO, bruto=None):
        dados = bruto if bruto is not None else (json.dumps(corpo).encode() if corpo is not None else None)
        req = urllib.request.Request(f"http://127.0.0.1:{self.porta}{caminho}", method=metodo, data=dados,
                                     headers={"X-Adaptador": segredo, "Content-Type": "application/json"} if segredo else {})
        try:
            with urllib.request.urlopen(req, timeout=5) as r:
                return r.status, json.loads(r.read() or b"{}")
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            finally:
                e.close()

    def test_sem_segredo_ou_com_segredo_errado_401_e_nada_gravado(self):
        for segredo in ("", "errado", self.SEGREDO + "x"):
            codigo, _ = self.chamar(corpo=upsert(LEAD), segredo=segredo)
            self.assertEqual(codigo, 401, segredo)
        self.assertEqual((self.dir / "evolution.log").read_text(), "")
        self.assertEqual(self.chamar("GET", "/saude", segredo="errado")[0], 401)

    def test_webhook_valido_grava(self):
        codigo, corpo = self.chamar(corpo=upsert(LEAD, "Sim, quero ver"))
        self.assertEqual((codigo, corpo), (200, {"ok": True, "linhas": 1, "respostas": 1}))
        self.assertIn(ev.MOTIVO, (self.dir / "evolution.log").read_text())
        self.assertIn("Sim, quero ver", (self.dir / "respostas.jsonl").read_text())

    def test_caminho_com_sufixo_por_evento(self):
        self.assertEqual(self.chamar(caminho="/evolution/messages-upsert", corpo=upsert(LEAD))[0], 200)
        self.assertEqual(self.chamar(caminho="/outra-coisa", corpo=upsert(LEAD))[0], 404)

    def test_json_invalido_e_corpo_grande(self):
        self.assertEqual(self.chamar(bruto=b"{ nao eh json")[0], 400)
        # O servidor responde 413 sem ler o corpo e fecha; no Windows o cliente ainda enviando pode
        # ver a conexão abortada em vez do 413. As duas saídas valem: o que importa é não gravar nada.
        try:
            self.assertEqual(self.chamar(bruto=b"x" * (ev.LIMITE_CORPO + 1))[0], 413)
        except (ConnectionError, urllib.error.URLError):
            pass
        self.assertEqual((self.dir / "evolution.log").read_text(), "")

    def test_evento_irrelevante_responde_200_para_a_evolution_nao_reentregar(self):
        self.assertEqual(self.chamar(corpo={"event": "PRESENCE_UPDATE", "instance": "prumo", "data": {}})[0], 200)

    def test_saude_mostra_contadores_sem_numero_nem_texto(self):
        self.chamar(corpo=upsert(LEAD, "texto sigiloso"))
        self.chamar(corpo=upsert(OUTRO, "oi"))
        codigo, s = self.chamar("GET", "/saude")
        self.assertEqual(codigo, 200)
        self.assertEqual((s["linhas"], s["respostas"], s["lista_de_leads"], s["desconectado"]), (1, 1, True, False))
        self.assertEqual(s["ignorados"], {"nao_e_lead": 1})
        self.assertEqual(s["eventos"], {"MESSAGES_UPSERT": 2})
        texto = json.dumps(s)
        for vazou in (LEAD, OUTRO, "sigiloso"):
            self.assertNotIn(vazou, texto)

    def test_queda_da_conexao_avisa_uma_vez_ate_voltar(self):
        queda = {"event": "connection.update", "instance": "prumo", "data": {"state": "close"}}
        volta = {"event": "connection.update", "instance": "prumo", "data": {"state": "open"}}
        self.chamar(corpo=queda)
        self.chamar(corpo=queda)
        self.assertEqual(len(self.avisos), 1)
        self.assertIn("desconectou", self.avisos[0])
        self.chamar(corpo=volta)
        self.chamar(corpo=queda)
        self.assertEqual(len(self.avisos), 2)

    def test_forma_nova_vai_ao_journal_uma_vez_sem_valores(self):
        saida = []
        original = ev.log
        ev.log = lambda *a: saida.append(" ".join(str(x) for x in a))
        self.addCleanup(setattr, ev, "log", original)
        self.chamar(corpo=atualizacao(LEAD))
        self.chamar(corpo=atualizacao(LEAD))
        formas = [l for l in saida if "forma nova" in l]
        self.assertEqual(len(formas), 1)
        self.assertIn('"status": "str"', formas[0])
        self.assertNotIn(LEAD, " ".join(saida))
        self.assertNotIn("READ", formas[0])

    def test_falha_interna_responde_200_sem_derrubar(self):
        def quebra(_):
            raise RuntimeError("boom")
        self.adaptador.receber = quebra
        self.assertEqual(self.chamar(corpo=upsert(LEAD)), (200, {"ok": False}))

    def test_sem_a_lista_o_servico_responde_mas_nao_grava(self):
        (self.dir / "leads.json").unlink()
        self.chamar(corpo=upsert(LEAD))
        self.assertEqual((self.dir / "evolution.log").read_text(), "")
        self.assertFalse((self.dir / "respostas.jsonl").exists())
        self.assertFalse(self.chamar("GET", "/saude")[1]["lista_de_leads"])


class ComOObservadorDeVerdade(unittest.TestCase):
    """O adaptador escreve, o observador.py lê: se a gramática divergir, este grupo quebra."""

    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="evolution-teste-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.chamadas = []
        self.agora = T0
        self.obs = ob.Observador(set(LEADS), chamar=self.n8n, avisar=lambda t: None, relogio=lambda: self.agora,
                                 pasta=self.dir, bridge_js=self.dir / "nao-existe.js")
        # leads.json foi gravado pelo próprio observador no __init__: é o que o adaptador lê.
        self.g = ev.Gravador(self.dir)
        self.adaptador = ev.Adaptador(self.g, relogio=lambda: self.agora, avisar=lambda t: None)

    def n8n(self, metodo, caminho, corpo=None):
        self.chamadas.append((caminho, corpo))
        return {"ok": True, "marcados": []}

    def alimentar(self, webhook):
        antes = (self.dir / "evolution.log").read_text()
        self.adaptador.receber(webhook)
        for linha in (self.dir / "evolution.log").read_text()[len(antes):].splitlines():
            self.obs.linha(linha)

    def test_lista_do_observador_e_a_que_o_adaptador_le(self):
        self.assertEqual(self.g.leads(), LEADS)

    def test_a_conversa_inteira(self):
        self.alimentar(upsert(LEAD, "olá, vi seu anúncio", de_mim=True, id_="1", ts=T0 - 600))
        self.alimentar(atualizacao(LEAD))
        self.alimentar(upsert(LEAD, "Sim, quero ver", id_="2", ts=T0))
        eventos = [c[1] for c in self.chamadas if c[0] == "whatsapp-conversa"]
        self.assertEqual([(e["chave"], e["direcao"]) for e in eventos],
                         [(CHAVE, "saida"), (CHAVE, "lido"), (CHAVE, "entrada")])
        self.assertEqual(eventos[0]["em"][:10], ob.iso(T0 - 600)[:10])

    def test_nao_lead_nao_chega_ao_n8n(self):
        self.alimentar(upsert(OUTRO, "oi", id_="1"))
        self.alimentar(upsert(OUTRO, "olá", de_mim=True, id_="2"))
        self.assertEqual(self.chamadas, [])

    def test_o_texto_chega_para_classificar(self):
        self.alimentar(upsert(LEAD, "Oi", id_="1"))
        self.alimentar(upsert(LEAD, "não temos interesse", id_="2"))
        self.obs.ler_respostas()
        self.agora += ob.ESPERA_DA_CONVERSA_S + 1
        self.obs.fechar_conversas()
        self.obs.mandar_conversas()
        enviadas = [c[1] for c in self.chamadas if c[0] == "whatsapp-resposta"]
        self.assertEqual(len(enviadas), 1)
        self.assertEqual(enviadas[0]["chave"], CHAVE)
        self.assertEqual([m["texto"] for m in enviadas[0]["mensagens"]], ["Oi", "não temos interesse"])
        self.assertFalse((self.dir / "respostas.jsonl").exists())  # o observador apagou depois de ler

    def test_saudacao_automatica_segue_a_regra_dos_5_minutos(self):
        self.alimentar(upsert(LEAD, "Olá! Em que posso ajudar?", id_="1"))
        self.agora += 60
        self.alimentar(upsert(LEAD, "outra", id_="2"))  # dentro dos 5 min: sem segundo aviso
        self.agora += 600
        self.alimentar(upsert(LEAD, "sou eu mesmo", id_="3"))
        eventos = [c[1] for c in self.chamadas if c[0] == "whatsapp-conversa"]
        self.assertEqual([bool(e.get("seguinte")) for e in eventos], [False, True])

    def test_silencio_do_log_e_desligavel(self):
        self.assertTrue(ob.silencio_suspeito(T0 + 7 * 3600, T0, False, limite=6 * 3600))
        self.assertFalse(ob.silencio_suspeito(T0 + 7 * 3600, T0, False, limite=0))
        self.assertFalse(ob.silencio_suspeito(T0 + 7 * 3600, T0, True, limite=6 * 3600))
        self.assertFalse(ob.silencio_suspeito(T0 + 3600, T0, False, limite=6 * 3600))


if __name__ == "__main__":
    unittest.main(verbosity=1)
