#!/usr/bin/env python3
"""Testes do adaptador da Evolution API com webhooks de mentira, pasta temporária e relógio fixo.
Nada sobe a Evolution, toca o Dell, o n8n, a fila de avisos real ou a pasta ~/.local/state; os
números são fictícios. O fim da cadeia é o observador de verdade (`observador.py`) lendo o que o
adaptador escreveu, com o n8n de mentira: é o que prova que os dois falam a mesma língua.

  python3 deploy/dell/whatsapp-observador/evolution-adaptador.test.py
"""
import contextlib
import importlib.util
import io
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
# A conversa dos leads em disco nunca cai na pasta de verdade: o padrão do módulo aponta para um temporário.
_CONVERSAS_TESTE = tempfile.mkdtemp(prefix="conversas-teste-")
os.environ["WHATSAPP_CONVERSAS_DIR"] = _CONVERSAS_TESTE
# A transcrição de áudio (17/10/2026) nasce desligada nos testes: nada chama a Evolution nem o Gemini de verdade.
os.environ["OBSERVADOR_TRANSCREVER"] = "0"
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
        casos = [({"audioMessage": {}}, "[áudio]"), ({"audioMessage": {"seconds": 27}}, "[áudio 27s]"),
                 ({"audioMessage": {"seconds": "9"}}, "[áudio 9s]"), ({"audioMessage": {"seconds": True}}, "[áudio]"),
                 ({"imageMessage": {"caption": " cardápio "}}, "[imagem] cardápio"),
                 ({"imageMessage": {}}, "[imagem]"), ({"videoMessage": {"caption": "x"}}, "[vídeo] x"),
                 ({"documentMessage": {"fileName": "tabela.pdf"}}, "[documento] tabela.pdf"),
                 ({"stickerMessage": {}}, "[figurinha]"), ({"contactMessage": {}}, "[contato]"),
                 ({"locationMessage": {}}, "[localização]"),
                 ({"buttonsResponseMessage": {"selectedDisplayText": "Quero saber mais"}}, "Quero saber mais"),
                 ({"listResponseMessage": {"title": "Orçamento"}}, "Orçamento")]
        for msg, esperado in casos:
            self.assertEqual(ev.texto_da_mensagem(msg), esperado, msg)

    def test_mensagens_de_empresa(self):
        # 16/10/2026, Conecta Kids (API oficial da Meta): o menu de botões e a recepcionista com assinatura.
        menu = {"buttonsMessage": {"contentText": "Olá! Eu sou a Conecta. Por este canal, você pode:", "headerType": 1,
                                   "buttons": [{"buttonId": "1", "buttonText": {"displayText": "1º Atendimento"}, "type": 1},
                                               {"buttonId": "2", "buttonText": {"displayText": "Já sou Paciente"}, "type": 1}]},
                "messageContextInfo": {"deviceListMetadata": {}}}
        self.assertEqual(ev.texto_da_mensagem(menu),
                         "Olá! Eu sou a Conecta. Por este canal, você pode:\n[opções: 1º Atendimento | Já sou Paciente]")
        modelo = {"templateMessage": {"hydratedTemplate": {"hydratedContentText": "Aqui é a Bruna. Informe o nome e a idade do paciente.",
                                                           "hydratedFooterText": "Clínica Conecta Kids"}},
                  "messageContextInfo": {}}
        self.assertEqual(ev.texto_da_mensagem(modelo), "Aqui é a Bruna. Informe o nome e a idade do paciente.\n— Clínica Conecta Kids")
        interativo = {"interactiveMessage": {"body": {"text": "Escolha uma opção"}, "footer": {"text": "Loja X"},
                                             "nativeFlowMessage": {"buttons": [{"name": "quick_reply", "buttonParamsJson": "{}"}]}}}
        self.assertEqual(ev.texto_da_mensagem(interativo), "Escolha uma opção\n— Loja X")
        lista = {"listMessage": {"title": "Horários", "description": "Escolha o dia", "buttonText": "Ver",
                                 "sections": [{"rows": [{"title": "Segunda"}]}]}}
        self.assertIn("Escolha o dia", ev.texto_da_mensagem(lista))
        self.assertEqual(ev.texto_da_mensagem({"templateMessage": {"hydratedTemplate": {}}}), "")

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
        self.assertEqual(t.respostas, [{"chave": CHAVE, "ts": int(T0) - 5, "texto": "Sim, quero ver", "id": "A1"}])
        self.assertEqual(t.enviadas, ())

    def test_o_prumo_escreveu_vira_owner_sent_sem_texto(self):
        t = self.tr(upsert(LEAD, "olá, tudo bem?", de_mim=True, ts=T0 - 30))
        self.assertEqual(t.linhas, [{"event": "owner_sent", "chatId": f"{LEAD}@s.whatsapp.net", "ts": int(T0) - 30,
                                     "id": "A1"}])
        self.assertEqual(t.respostas, [])
        self.assertNotIn("olá", json.dumps(t.linhas))
        # O texto vai só para o enviadas.jsonl (a conversa do lead em disco), com o mesmo id.
        self.assertEqual(t.enviadas, ({"chave": CHAVE, "ts": int(T0) - 30, "texto": "olá, tudo bem?", "id": "A1"},))

    def test_enviada_a_quem_nao_e_lead_nao_deixa_texto(self):
        t = self.tr(upsert(OUTRO, "conversa pessoal", de_mim=True))
        self.assertEqual((t.linhas, t.respostas, t.enviadas), ([], [], ()))

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
        # senderPn identifica o participante, não prova qual é o chat: sozinho não resolve um @lid.
        t = self.tr(corpo)
        self.assertEqual((t.linhas, t.respostas, t.ignorados), ([], [], {"lid_sem_telefone": 1}))
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
        self.assertEqual(t.respostas[0]["texto"], "[áudio 4s]")
        # Sem url/mediaKey não há o que baixar, mas a marca diz que esta instância responde pelo áudio (revisão de 17/10).
        self.assertEqual(t.respostas[0]["audio"], {"seg": 4})

    # Um audioMessage como o Baileys entrega (valores de mentira): o que o download precisa e o que não pode ir.
    AUDIO = {"url": "https://mmg.whatsapp.net/v/t62/abc.enc", "directPath": "/v/t62/abc.enc", "mimetype": "audio/ogg; codecs=opus",
             "mediaKey": "Q2hhdmUtZGUtbWVudGlyYQ==", "fileSha256": "aGFzaA==", "fileEncSha256": "aGFzaDI=",
             "fileLength": {"low": 48213, "high": 0, "unsigned": True}, "seconds": 27, "ptt": True,
             "mediaKeyTimestamp": "1790773100", "waveform": "AAECAwQFBgcICQ==", "jpegThumbnail": "/9j/4AAQSkZJRg==",
             "contextInfo": {"stanzaId": "X", "participant": f"{LEAD}@s.whatsapp.net"}, "streamingSidecar": "c2lkZWNhcg=="}

    def test_audio_de_lead_leva_o_que_o_observador_precisa_para_baixar(self):
        corpo = upsert(LEAD, id_="AUD1")
        corpo["data"]["message"] = {"audioMessage": dict(self.AUDIO), "base64": "QVVESU8tSU5URUlSTw=="}
        t = self.tr(corpo)
        r = t.respostas[0]
        self.assertEqual((r["texto"], r["id"]), ("[áudio 27s]", "AUD1"))
        self.assertEqual(r["audio"]["seg"], 27)
        msg = r["audio"]["msg"]
        self.assertEqual(msg["key"], {"id": "AUD1", "fromMe": False, "remoteJid": f"{LEAD}@s.whatsapp.net"})
        self.assertEqual(set(msg["message"]), {"audioMessage"})
        am = msg["message"]["audioMessage"]
        self.assertEqual(set(am), {"url", "directPath", "mimetype", "mediaKey", "fileSha256", "fileEncSha256", "fileLength",
                                   "seconds", "ptt", "mediaKeyTimestamp"})
        texto = json.dumps(r)
        for vazou in ("jpegThumbnail", "waveform", "contextInfo", "streamingSidecar", "QVVESU8tSU5URUlSTw=="):
            self.assertNotIn(vazou, texto)  # nem miniatura, nem bytes do arquivo

    def test_audio_longo_sem_duracao_ou_dentro_de_embrulho(self):
        longo = upsert(LEAD, id_="L1")
        longo["data"]["message"] = {"audioMessage": {**self.AUDIO, "seconds": 121}}
        r = self.tr(longo).respostas[0]
        self.assertEqual(r["texto"], "[áudio 121s]")
        self.assertEqual(r["audio"], {"seg": 121})  # acima de 120 s não baixa, mas fica a marca (sem msg)
        sem = upsert(LEAD, id_="L2")
        sem["data"]["message"] = {"audioMessage": {k: v for k, v in self.AUDIO.items() if k != "seconds"}}
        r = self.tr(sem).respostas[0]
        self.assertEqual(r["texto"], "[áudio]")
        self.assertEqual(r["audio"], {})  # sem duração: nem baixa, mas é áudio de lead que esta instância recebeu
        temporaria = upsert(LEAD, id_="L3")
        temporaria["data"]["message"] = {"ephemeralMessage": {"message": {"audioMessage": dict(self.AUDIO)}}}
        r = self.tr(temporaria).respostas[0]
        self.assertEqual((r["texto"], r["audio"]["seg"]), ("[áudio 27s]", 27))

    def test_audio_do_prumo_nao_vai_para_transcricao(self):
        corpo = upsert(LEAD, de_mim=True, id_="S1")
        corpo["data"]["message"] = {"audioMessage": dict(self.AUDIO)}
        t = self.tr(corpo)
        self.assertEqual(t.enviadas, ({"chave": CHAVE, "ts": int(T0) - 5, "texto": "[áudio 27s]", "id": "S1"},))
        # Vídeo, documento e imagem do Rômulo seguem com os marcadores de sempre.
        for msg, esperado in (({"videoMessage": {"caption": "veja"}}, "[vídeo] veja"),
                              ({"documentMessage": {"fileName": "proposta.pdf"}}, "[documento] proposta.pdf"),
                              ({"imageMessage": {}}, "[imagem]")):
            corpo = upsert(LEAD, de_mim=True, id_="S-" + esperado)
            corpo["data"]["message"] = msg
            self.assertEqual(self.tr(corpo).enviadas[0]["texto"], esperado)

    def test_campo_de_bytes_grande_ou_estranho_nao_passa(self):
        audio = {**self.AUDIO, "mediaKey": {str(i): i % 256 for i in range(32)}, "fileSha256": "x" * 5000,
                 "url": {"nao": "texto"}}
        msg = ev.pedido_do_audio({"key": {"id": "Z", "remoteJid": "1@lid"}}, audio)
        am = msg["message"]["audioMessage"]
        self.assertEqual(len(am["mediaKey"]), 32)  # Uint8Array serializado como objeto: aceito, é pequeno
        self.assertNotIn("fileSha256", am)
        self.assertNotIn("url", am)
        self.assertEqual(am["directPath"], "/v/t62/abc.enc")
        self.assertIsNone(ev.pedido_do_audio({"key": {"id": "Z"}}, {"seconds": 3}))  # sem chave de mídia
        self.assertIsNone(ev.pedido_do_audio({"key": {}}, dict(self.AUDIO)))  # sem id

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


LID = "207678898962522"


def upsert_lid(numero, id_, de_mim=True, texto="oi", alt=True):
    """Como a Evolution 2.3.7 mandou no ensaio de 16/10/2026: remoteJid em @lid, o telefone em remoteJidAlt."""
    key = {"remoteJid": f"{LID}@lid", "fromMe": de_mim, "id": id_, "participant": "", "addressingMode": "lid"}
    if alt:
        key["remoteJidAlt"] = f"{numero}@s.whatsapp.net"
    return {"event": "messages.upsert", "instance": "prumo",
            "data": {"instanceId": "x", "key": key, "message": {"conversation": texto}, "messageType": "conversation",
                     "messageTimestamp": int(T0 - 5), "pushName": "Fulana", "source": "android", "status": "SERVER_ACK"}}


def recibo_lid(key_id, status="READ", de_mim=True, lid=LID):
    """O MESSAGES_UPDATE do ensaio: só remoteJid em @lid e o keyId, sem telefone."""
    return {"event": "messages.update", "instance": "prumo",
            "data": {"fromMe": de_mim, "instanceId": "x", "keyId": key_id, "remoteJid": f"{lid}@lid", "status": status}}


class CorrelacaoHermesEvolution(unittest.TestCase):
    def test_resposta_sem_telefone_usa_o_mapa_confirmado_da_sessao(self):
        with tempfile.TemporaryDirectory() as tmp:
            pasta=Path(tmp);lid='998877665544'
            (pasta/f'lid-mapping-{lid}_reverse.json').write_text(json.dumps(LEAD))
            mapas=ev.Mapas(sessao_hermes=pasta)
            t=ev.traduzir(upsert(lid,dominio='lid'),LEADS,T0,ev.Recentes(),'prumo',mapas)
            self.assertEqual(len(t.respostas),1)
            self.assertEqual(t.respostas[0]['chave'],CHAVE)
            self.assertEqual(mapas.lid[lid],LEAD+'@s.whatsapp.net')

    def test_correlacao_nao_amplia_captura_pessoal_nem_aceita_caminho_arbitrario(self):
        with tempfile.TemporaryDirectory() as tmp:
            pasta=Path(tmp);lid='998877665544'
            (pasta/f'lid-mapping-{lid}_reverse.json').write_text(json.dumps(OUTRO))
            mapas=ev.Mapas(sessao_hermes=pasta)
            t=ev.traduzir(upsert(lid,dominio='lid'),LEADS,T0,ev.Recentes(),'prumo',mapas)
            self.assertFalse(t.respostas);self.assertFalse(t.linhas)
            self.assertFalse(mapas.lid)
            self.assertEqual(mapas.da_sessao('../creds'),'')
            (pasta/f'lid-mapping-{lid}_reverse.json').write_text(json.dumps('invalido'))
            self.assertEqual(mapas.da_sessao(lid),'')

    def test_sessao_prevalece_sobre_cache_e_hint_para_chat_pessoal(self):
        with tempfile.TemporaryDirectory() as tmp:
            pasta = Path(tmp)
            (pasta / f'lid-mapping-{LID}_reverse.json').write_text(json.dumps(OUTRO))
            mapas = ev.Mapas(sessao_hermes=pasta)
            mapas.guardar(LID, 'SAIDA', LEAD + '@s.whatsapp.net')
            corpos = [upsert_lid(LEAD, 'SAIDA', alt=False),
                      upsert_lid(LEAD, 'SAIDA', alt=True), recibo_lid('SAIDA')]
            for corpo in corpos:
                with self.subTest(evento=corpo['event'], alt=corpo['data'].get('key', {}).get('remoteJidAlt')):
                    t = ev.traduzir(corpo, LEADS, T0, ev.Recentes(), '', mapas)
                    self.assertEqual((t.linhas, t.respostas, t.enviadas), ([], [], ()))
                    self.assertEqual(t.ignorados, {'nao_e_lead': 1})

    def test_sessao_corrige_lead_errado_inclusive_apos_reinicio(self):
        with tempfile.TemporaryDirectory() as tmp:
            pasta = Path(tmp)
            (pasta / f'lid-mapping-{LID}_reverse.json').write_text(json.dumps(LEAD2))
            arquivo = pasta / 'mapa.json'
            mapas = ev.Mapas(arquivo=arquivo, sessao_hermes=pasta)
            mapas.guardar(LID, 'SAIDA', LEAD + '@s.whatsapp.net')
            t = ev.traduzir(upsert_lid(LEAD, 'SAIDA'), LEADS, T0, ev.Recentes(), '', mapas)
            self.assertEqual(t.enviadas[0]['chave'], CHAVE2)
            reaberto = ev.Mapas(arquivo=arquivo, sessao_hermes=pasta)
            self.assertEqual(reaberto.lid[LID], LEAD2 + '@s.whatsapp.net')
            self.assertEqual(reaberto.msg['SAIDA'], LEAD2 + '@s.whatsapp.net')
            t = ev.traduzir(recibo_lid('SAIDA'), LEADS, T0, ev.Recentes(), '', reaberto)
            self.assertEqual(t.linhas[0]['chatId'], LEAD2 + '@s.whatsapp.net')

    def test_remetente_e_participante_nao_identificam_chat_lid(self):
        for campo in ('senderPn', 'participantAlt'):
            for local in ('key', 'data'):
                for de_mim in (True, False):
                    corpo = upsert_lid(LEAD, 'SEM-CHAT', de_mim=de_mim, alt=False)
                    onde = corpo['data']['key'] if local == 'key' else corpo['data']
                    onde[campo] = LEAD + '@s.whatsapp.net'
                    mapas = ev.Mapas()
                    t = ev.traduzir(corpo, LEADS, T0, ev.Recentes(), '', mapas)
                    self.assertEqual((t.linhas, t.respostas, t.enviadas), ([], [], ()))
                    self.assertEqual(t.ignorados, {'lid_sem_telefone': 1})
                    self.assertEqual((mapas.lid, mapas.msg), ({}, {}))

    def test_remotejid_telefone_nao_aprende_lid_alternativo_contraditorio(self):
        with tempfile.TemporaryDirectory() as tmp:
            pasta = Path(tmp)
            (pasta / f'lid-mapping-{LID}_reverse.json').write_text(json.dumps(OUTRO))
            mapas = ev.Mapas(sessao_hermes=pasta)
            t = ev.traduzir(upsert(LEAD, remoteJidAlt=LID + '@lid'), LEADS, T0, ev.Recentes(), '', mapas)
            self.assertEqual(t.respostas[0]['chave'], CHAVE)
            self.assertFalse(mapas.lid)

    def test_caches_contraditorios_sem_sessao_aguardam_confirmacao(self):
        mapas = ev.Mapas()
        mapas.guardar(LID, '', LEAD + '@s.whatsapp.net')
        mapas.guardar('', 'SAIDA', LEAD2 + '@s.whatsapp.net')
        t = ev.traduzir(recibo_lid('SAIDA'), LEADS, T0, ev.Recentes(), '', mapas)
        self.assertEqual(t.ignorados, {'lid_conflitante': 1})
        self.assertFalse(t.linhas)


class RecibosEmLid(unittest.TestCase):
    """O recibo de leitura da Evolution não traz telefone: o adaptador lembra, só de lead, de onde veio o id."""

    def setUp(self):
        self.mapas, self.vistos = ev.Mapas(), ev.Recentes()

    def tr(self, corpo, leads=LEADS):
        return ev.traduzir(corpo, leads, T0, self.vistos, "", self.mapas)

    def test_recibo_resolve_pelo_id_da_mensagem_enviada(self):
        enviado = self.tr(upsert_lid(LEAD, "MSG1"))
        self.assertEqual(enviado.linhas[0]["event"], "owner_sent")
        self.assertEqual(enviado.linhas[0]["chatId"], f"{LEAD}@s.whatsapp.net")
        lido = self.tr(recibo_lid("MSG1"))
        self.assertEqual(lido.linhas, [{"event": "owner_receipt", "chatId": f"{LEAD}@s.whatsapp.net", "status": "lido",
                                        "ts": int(T0)}])

    def test_recibo_resolve_pelo_lid_quando_o_id_e_outro(self):
        self.tr(upsert_lid(LEAD, "MSG1"))
        lido = self.tr(recibo_lid("OUTRA-MSG-QUE-NAO-VIMOS"))
        self.assertEqual([l["event"] for l in lido.linhas], ["owner_receipt"])

    def test_recibo_sem_nada_aprendido_continua_descartado(self):
        t = self.tr(recibo_lid("MSG-DESCONHECIDA", lid="999111222"))
        self.assertEqual((t.linhas, t.ignorados), ([], {"lid_sem_telefone": 1}))

    def test_so_o_que_e_de_lead_e_lembrado(self):
        self.tr(upsert_lid(OUTRO, "MSG9"))  # OUTRO não é lead
        self.assertEqual((self.mapas.lid, self.mapas.msg), ({}, {}))
        t = self.tr(recibo_lid("MSG9"))
        self.assertEqual(t.ignorados, {"lid_sem_telefone": 1})

    def test_modo_ensaio_resolve_o_recibo_de_quem_nao_e_lead(self):
        # Prova a resolução sem usar o número de ninguém: o recibo deixa de ser lid_sem_telefone e vira nao_e_lead.
        self.mapas = ev.Mapas(todos=True)
        self.tr(upsert_lid(OUTRO, "MSG9"))
        t = self.tr(recibo_lid("MSG9"))
        self.assertEqual((t.linhas, t.ignorados), ([], {"nao_e_lead": 1}))
        self.assertFalse(ev.Mapas().todos)  # desligado por padrão

    def test_recibo_do_que_o_lead_mandou_nao_conta(self):
        self.tr(upsert_lid(LEAD, "MSG1"))
        t = self.tr(recibo_lid("MSG1", de_mim=False))
        self.assertEqual((t.linhas, t.ignorados), ([], {"recibo_de_entrada": 1}))

    def test_so_o_estado_lido_vale(self):
        self.tr(upsert_lid(LEAD, "MSG1"))
        for status, motivo in (("DELIVERY_ACK", "recibo_entregue"), ("SERVER_ACK", "recibo_sem_estado")):
            t = self.tr(recibo_lid("MSG1", status))
            self.assertEqual((t.linhas, t.ignorados), ([], {motivo: 1}), status)
        self.assertEqual(len(self.tr(recibo_lid("MSG1", "PLAYED")).linhas), 1)

    def test_resposta_do_lead_em_lid_com_alt_vira_entrada_e_texto(self):
        t = self.tr(upsert_lid(LEAD, "IN1", de_mim=False, texto="Sim, quero ver"))
        self.assertEqual([l["event"] for l in t.linhas], ["ignored"])
        self.assertEqual(t.respostas[0]["texto"], "Sim, quero ver")

    def test_o_proprio_lid_que_ja_veio_com_alt_resolve_a_entrada_sem_alt(self):
        self.tr(upsert_lid(LEAD, "MSG1"))
        t = self.tr(upsert_lid(LEAD, "IN2", de_mim=False, texto="olá", alt=False))
        self.assertEqual(t.respostas[0]["chave"], CHAVE)

    def test_telefone_no_remotejid_e_lid_no_alt_tambem_ensina(self):
        corpo = upsert(LEAD, "oi", de_mim=True, id_="MSG5", remoteJidAlt=f"{LID}@lid")
        self.tr(corpo)
        self.assertEqual(self.mapas.lid.get(LID), f"{LEAD}@s.whatsapp.net")
        self.assertEqual(len(self.tr(recibo_lid("MSG5")).linhas), 1)

    def test_mapas_tem_teto(self):
        m = ev.Mapas(maximo=3)
        for i in range(10):
            m.guardar(f"10000{i}", f"id{i}", f"{LEAD}@s.whatsapp.net")
        self.assertEqual((len(m.lid), len(m.msg)), (3, 3))
        self.assertIn("id9", m.msg)
        self.assertNotIn("id0", m.msg)

    def test_resumo_seguro_nao_leva_numero_nome_nem_texto(self):
        corpo = upsert_lid(LEAD, "MSG1", texto="segredo do cliente")
        resumo = ev.resumo_seguro("MESSAGES_UPSERT", corpo["data"])
        for vazou in (LEAD, LID, "segredo", "Fulana", "MSG1", CHAVE):
            self.assertNotIn(vazou, resumo)
        self.assertIn("fromMe=True", resumo)
        self.assertIn("chat=lid", resumo)
        self.assertIn("alt=s.whatsapp.net", resumo)
        r2 = ev.resumo_seguro("MESSAGES_UPDATE", recibo_lid("MSG1")["data"])
        self.assertIn("status=READ", r2)
        self.assertNotIn(LID, r2)

    def test_resumo_seguro_filtra_status_estranho(self):
        item = {"remoteJid": f"{LEAD}@s.whatsapp.net", "status": "READ; DROP", "fromMe": True}
        self.assertIn("status=READDROP ", ev.resumo_seguro("MESSAGES_UPDATE", item) + " ")


class AchadosDaRevisao(unittest.TestCase):
    """Cada caso vem da revisão adversarial de 16/10/2026 e foi reproduzido antes de ser corrigido."""

    def tr(self, corpo, leads=LEADS, vistos=None, mapas=None):
        return ev.traduzir(corpo, leads, T0, vistos if vistos is not None else ev.Recentes(), "", mapas)

    def test_grupo_e_status_com_participante_lead_nao_viram_conversa(self):
        for dominio in ("g.us", "broadcast", "newsletter"):
            corpo = upsert("120363000000", "mensagem no grupo", dominio=dominio, participantAlt=f"{LEAD}@s.whatsapp.net")
            corpo["data"]["participantAlt"] = f"{LEAD}@s.whatsapp.net"
            t = self.tr(corpo)
            self.assertEqual((t.linhas, t.respostas, t.ignorados), ([], [], {"nao_e_conversa_1a1": 1}), dominio)

    def test_reacao_dentro_de_mensagem_temporaria_continua_sendo_reacao(self):
        for msg in ({"ephemeralMessage": {"message": {"reactionMessage": {"text": "👍"}}}},
                    {"viewOnceMessageV2": {"message": {"protocolMessage": {"type": 0}}}},
                    {"messageContextInfo": {"deviceListMetadata": {}}}, {}):
            for de_mim in (True, False):
                corpo = upsert(LEAD, de_mim=de_mim, id_=f"E{de_mim}{len(str(msg))}")
                corpo["data"]["message"] = msg
                t = self.tr(corpo)
                self.assertEqual((t.linhas, t.respostas), ([], []), (msg, de_mim))
        self.assertFalse(ev.sem_conversa({"ephemeralMessage": {"message": {"conversation": "oi"}}}))
        self.assertFalse(ev.sem_conversa({"audioMessage": {}}))

    def test_placeholder_sem_conteudo_nao_engole_a_mensagem_decifrada_do_mesmo_id(self):
        vistos = ev.Recentes()
        vazio = upsert(LEAD, id_="MESMO")
        vazio["data"]["message"] = None
        a = self.tr(vazio, vistos=vistos)
        b = self.tr(upsert(LEAD, "Sim, quero", id_="MESMO"), vistos=vistos)
        self.assertEqual(a.ignorados, {"recebida_sem_conteudo": 1})
        self.assertEqual(b.respostas[0]["texto"], "Sim, quero")
        c = self.tr(upsert(LEAD, "Sim, quero", id_="MESMO"), vistos=vistos)  # a reentrega de verdade segue valendo
        self.assertEqual(c.ignorados, {"reentrega": 1})

    def test_mensagem_que_a_evolution_entrega_horas_depois_nao_vira_resposta_de_agora(self):
        t = self.tr(upsert(LEAD, "Olá! Em que posso ajudar?", ts=T0 - 3 * 3600))
        self.assertEqual(t.linhas, [])
        self.assertEqual(t.ignorados, {"entrada_atrasada": 1})
        self.assertEqual(t.respostas[0]["ts"], int(T0) - 3 * 3600)  # o texto segue, com a hora certa
        recente = self.tr(upsert(LEAD, "oi", id_="NOVA", ts=T0 - 120))
        self.assertEqual(len(recente.linhas), 1)

    def test_o_que_o_prumo_enviou_continua_valendo_mesmo_atrasado(self):
        self.assertEqual(self.tr(upsert(LEAD, "olá", de_mim=True, ts=T0 - 3 * 3600)).linhas[0]["ts"], int(T0) - 3 * 3600)

    def test_forma_nao_leva_telefone_como_nome_de_campo(self):
        f = ev.forma({"id": "x@g.us", "presences": {f"{OUTRO}@s.whatsapp.net": {"lastKnownPresence": "composing"},
                                                      f"{LEAD}@lid": {"x": 1}}})
        texto = json.dumps(f)
        for vazou in (OUTRO, LEAD, "@s.whatsapp.net", "@lid"):
            self.assertNotIn(vazou, texto)
        self.assertEqual(f["presences"], {"<chave>": {"x": "int"}})  # dois JIDs viram o mesmo nome neutro
        self.assertEqual(f["id"], "str")

    def test_recibo_com_numero_malformado_nao_derruba_o_lote(self):
        for ruim in (float("nan"), float("inf"), -float("inf")):
            self.assertEqual(ev.estado_do_recibo(ruim), "")
        corpo = atualizacao(LEAD)
        corpo["data"]["status"] = float("nan")
        self.assertEqual(self.tr(corpo).ignorados, {"recibo_sem_estado": 1})

    def test_recebimentos_simultaneos_do_mesmo_id_produzem_uma_linha_so(self):
        dir_ = Path(tempfile.mkdtemp(prefix="evolution-teste-"))
        self.addCleanup(shutil.rmtree, dir_, ignore_errors=True)
        g = ev.Gravador(dir_)
        (dir_ / "leads.json").write_text(json.dumps(sorted(LEADS)))
        a = ev.Adaptador(g, relogio=lambda: T0, avisar=lambda t: None)
        saida = []
        corpo = upsert(LEAD, "oi", id_="CONCORRENTE")
        fios = [threading.Thread(target=lambda: saida.append(len(a.receber(corpo).linhas))) for _ in range(12)]
        for f in fios:
            f.start()
        for f in fios:
            f.join()
        self.assertEqual(sum(saida), 1)
        self.assertEqual(len(list((dir_ / 'capturas-adaptador').glob('*.json'))), 1)


class GravadorEndurecido(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp(prefix="evolution-teste-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)

    def test_lista_de_leads_velha_vale_como_ausente(self):
        relogio = [T0]
        g = ev.Gravador(self.dir, relogio=lambda: relogio[0])
        arquivo = self.dir / "leads.json"
        arquivo.write_text(json.dumps([CHAVE]))
        os.utime(arquivo, (T0, T0))
        self.assertEqual(g.leads(), {CHAVE})
        relogio[0] = T0 + ev.LEADS_VELHOS_S - 5
        self.assertEqual(g.leads(), {CHAVE})
        relogio[0] = T0 + ev.LEADS_VELHOS_S + 5  # o observador do PRUMO parou
        self.assertIsNone(g.leads())
        os.utime(arquivo, (relogio[0], relogio[0]))  # ele voltou e regravou
        self.assertEqual(g.leads(), {CHAVE})

    def test_respostas_que_ninguem_consome_tem_teto(self):
        g = ev.Gravador(self.dir, limite_respostas=300)
        v = ev.Recentes()
        for i in range(12):
            g.escrever(ev.traduzir(upsert(LEAD, "texto " + "x" * 40, id_=f"r{i}"), LEADS, T0, v))
        self.assertLess((self.dir / "respostas.jsonl").stat().st_size, 600)
        self.assertGreater(g.respostas_descartadas, 0)
        self.assertEqual(len((self.dir / "evolution.log").read_text().splitlines()), 12)  # o log de eventos segue

    def test_separadores_de_linha_do_unicode_nao_partem_a_resposta(self):
        g = ev.Gravador(self.dir)
        g.escrever(ev.traduzir(upsert(LEAD, "primeira segunda terceira\x85quarta", id_="U1"), LEADS, T0))
        bruto = (self.dir / "respostas.jsonl").read_text(encoding="utf-8")
        self.assertEqual(len(bruto.splitlines()), 1)
        self.assertEqual(json.loads(bruto)["texto"], "primeira segunda terceira\x85quarta")


class ServidorEndurecido(unittest.TestCase):
    SEGREDO = "segredo-de-teste"

    def subir(self, maximo=32, tempo=10):
        self.dir = Path(tempfile.mkdtemp(prefix="evolution-teste-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        (self.dir / "leads.json").write_text(json.dumps(sorted(LEADS)))
        anterior = ev.TEMPO_DA_CONEXAO_S
        ev.TEMPO_DA_CONEXAO_S = tempo
        self.addCleanup(setattr, ev, "TEMPO_DA_CONEXAO_S", anterior)
        self.adaptador = ev.Adaptador(ev.Gravador(self.dir), avisar=lambda t: None)
        self.servidor = ev.criar_servidor(self.adaptador, self.SEGREDO, porta=0, maximo=maximo)
        self.porta = self.servidor.server_address[1]
        threading.Thread(target=self.servidor.serve_forever, daemon=True).start()
        self.addCleanup(self.servidor.server_close)
        self.addCleanup(self.servidor.shutdown)

    def cru(self, bytes_):
        import socket
        s = socket.create_connection(("127.0.0.1", self.porta), timeout=5)
        self.addCleanup(s.close)
        s.sendall(bytes_)
        return s

    def test_content_length_negativo_nao_prende_a_thread(self):
        self.subir()
        s = self.cru(f"POST /evolution HTTP/1.1\r\nX-Adaptador: {self.SEGREDO}\r\nContent-Length: -1\r\n\r\n".encode())
        self.assertIn(b" 400 ", s.recv(200).split(b"\r\n")[0])

    def test_cabecalho_que_nao_termina_e_cortado(self):
        self.subir(tempo=1)
        s = self.cru(b"POST /evolution HTTP/1.1\r\nContent-Le")  # nunca termina o cabeçalho
        s.settimeout(4)
        self.assertEqual(s.recv(100), b"")  # o servidor fechou a conexão

    def test_corpo_prometido_e_nunca_enviado_e_cortado(self):
        self.subir(tempo=1)
        s = self.cru(f"POST /evolution HTTP/1.1\r\nX-Adaptador: errado\r\nContent-Length: 5000\r\n\r\n".encode())
        s.settimeout(4)
        resposta = b""
        try:
            while True:
                pedaco = s.recv(200)
                if not pedaco:
                    break
                resposta += pedaco
        except OSError:
            pass
        self.assertLessEqual(len(resposta), 400)  # não ficou pendurado: terminou dentro do prazo

    def test_teto_de_conexoes_simultaneas(self):
        self.subir(maximo=2, tempo=5)
        presas = [self.cru(b"POST /evolution HTTP/1.1\r\nContent-Le") for _ in range(2)]
        import socket
        terceira = socket.create_connection(("127.0.0.1", self.porta), timeout=5)
        self.addCleanup(terceira.close)
        terceira.settimeout(3)
        try:
            self.assertEqual(terceira.recv(100), b"")  # fechada na hora, sem thread
        except ConnectionError:
            pass
        self.assertEqual(len(presas), 2)

    def test_pedidos_recusados_aparecem_no_saude(self):
        self.subir()
        import urllib.request
        req = urllib.request.Request(f"http://127.0.0.1:{self.porta}/saude", headers={"X-Adaptador": "errado"})
        for _ in range(3):
            try:
                urllib.request.urlopen(req, timeout=5).close()
            except urllib.error.HTTPError as e:
                e.close()
        req = urllib.request.Request(f"http://127.0.0.1:{self.porta}/saude", headers={"X-Adaptador": self.SEGREDO})
        with urllib.request.urlopen(req, timeout=5) as r:
            saude = json.loads(r.read())
        self.assertEqual(saude["rejeitados"], {"401": 3})
        self.assertEqual(saude["respostas_descartadas"], 0)


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
        captura = next((self.dir/'capturas-adaptador').glob('*.json')).read_text()
        self.assertIn(ev.MOTIVO, captura)
        self.assertIn('Sim, quero ver', captura)

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
        self.chamar(corpo=volta)  # o número já chegou a conectar
        self.chamar(corpo=queda)
        self.chamar(corpo=queda)
        self.assertEqual(len(self.avisos), 1)
        self.assertIn("desconectou", self.avisos[0])
        self.chamar(corpo=volta)
        self.chamar(corpo=queda)
        self.assertEqual(len(self.avisos), 2)

    def test_close_sem_nunca_ter_conectado_nao_e_queda(self):
        # QR não lido: a Evolution fecha a instância depois do limite de QRs. Ninguém caiu.
        queda = {"event": "connection.update", "instance": "prumo", "data": {"state": "close"}}
        for _ in range(3):
            self.chamar(corpo=queda)
        self.assertEqual(self.avisos, [])
        self.assertFalse(self.g.ja_conectou())

    def test_a_marca_de_conectou_sobrevive_a_reinicio(self):
        self.chamar(corpo={"event": "connection.update", "instance": "prumo", "data": {"state": "open"}})
        self.assertTrue((self.dir / "conectou").is_file())
        novo = ev.Adaptador(ev.Gravador(self.dir), relogio=lambda: T0, avisar=self.avisos.append, instancia="prumo")
        novo.receber({"event": "connection.update", "instance": "prumo", "data": {"state": "close"}})
        self.assertEqual(len(self.avisos), 1)

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

    def test_falha_interna_pede_reentrega_sem_expor_excecao(self):
        def quebra(_):
            raise RuntimeError("boom")
        self.adaptador.receber = quebra
        self.assertEqual(self.chamar(corpo=upsert(LEAD)), (503, {"ok": False, 'erro': 'persistencia_indisponivel'}))

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
        self.conversas = self.dir / "conversas"
        self.obs = ob.Observador(set(LEADS), chamar=self.n8n, avisar=lambda t: None, relogio=lambda: self.agora,
                                 pasta=self.dir, bridge_js=self.dir / "nao-existe.js",
                                 conversas=ob.Conversas(self.conversas, "prumo", relogio=lambda: self.agora))
        self.addCleanup(self.obs.liberar_entrada)
        # leads.json foi gravado pelo próprio observador no __init__: é o que o adaptador lê.
        self.g = ev.Gravador(self.dir)
        self.adaptador = ev.Adaptador(self.g, relogio=lambda: self.agora, avisar=lambda t: None)

    def n8n(self, metodo, caminho, corpo=None):
        self.chamadas.append((caminho, corpo))
        return {"ok": True, "marcados": []}

    def alimentar(self, webhook):
        self.adaptador.receber(webhook)
        self.obs.ler_capturas_adaptador()

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
        self.obs.tick()
        self.assertFalse(self.conversas.exists() and list(self.conversas.glob("*.jsonl")))

    def test_a_conversa_do_lead_fica_em_disco_nas_duas_direcoes(self):
        self.alimentar(upsert(LEAD, "olá, vi seu anúncio", de_mim=True, id_="1", ts=T0 - 600))
        self.alimentar(atualizacao(LEAD))  # recibo de leitura não é linha
        self.alimentar(upsert(LEAD, "Sim, quero ver", id_="2", ts=T0 - 5))
        self.obs.tick()
        # A Evolution reentrega e o mesmo chip chega pela bridge: o mesmo id não vira segunda linha.
        (self.dir / "respostas.jsonl").write_text(json.dumps({"chave": CHAVE, "ts": int(T0) - 5, "texto": "Sim, quero ver",
                                                              "id": "2"}) + "\n")
        self.obs.tick()
        linhas = [json.loads(l) for l in (self.conversas / f"{CHAVE}.jsonl").read_text().splitlines()]
        self.assertCountEqual(linhas, [
            {"em": ob.iso_utc(T0 - 5), "direcao": "entrada", "texto": "Sim, quero ver", "origem": "prumo", "id": "2"},
            {"em": ob.iso_utc(T0 - 600), "direcao": "saida", "texto": "olá, vi seu anúncio", "origem": "prumo", "id": "1"},
        ])
        self.assertNotIn(LEAD[-8:], (self.conversas / f"{CHAVE}.jsonl").read_text())  # nenhum número na linha
        self.assertFalse((self.dir / "enviadas.jsonl").exists())  # o observador apagou depois de ler

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
        self.alimentar(upsert(LEAD, "Olá! Em que posso ajudar?", id_="1", ts=self.agora - 1))
        self.agora += 60
        self.alimentar(upsert(LEAD, "outra", id_="2", ts=self.agora - 1))  # dentro dos 5 min: sem segundo aviso
        self.agora += 600
        self.alimentar(upsert(LEAD, "sou eu mesmo", id_="3", ts=self.agora - 1))
        eventos = [c[1] for c in self.chamadas if c[0] == "whatsapp-conversa"]
        self.assertEqual([bool(e.get("seguinte")) for e in eventos], [False, True])

    def test_texto_com_separadores_do_unicode_chega_inteiro_ao_n8n(self):
        self.alimentar(upsert(LEAD, "primeira segunda", id_="U1", ts=self.agora - 1))
        self.alimentar(upsert(LEAD, "com\x85nel", id_="U2", ts=self.agora - 1))
        self.obs.ler_respostas()
        self.agora += ob.ESPERA_DA_CONVERSA_S + 1
        self.obs.fechar_conversas()
        self.obs.mandar_conversas()
        enviadas = [c[1] for c in self.chamadas if c[0] == "whatsapp-resposta"]
        self.assertEqual([m["texto"] for m in enviadas[0]["mensagens"]], ["primeira segunda", "com\x85nel"])

    def test_enviado_e_lido_em_lid_chegam_ao_n8n_como_saida_e_lido(self):
        self.alimentar(upsert_lid(LEAD, "MSG1"))
        self.alimentar(recibo_lid("MSG1"))
        eventos = [c[1] for c in self.chamadas if c[0] == "whatsapp-conversa"]
        self.assertEqual([(e["chave"], e["direcao"]) for e in eventos], [(CHAVE, "saida"), (CHAVE, "lido")])

    def lote(self):
        self.obs.tick()
        self.agora += ob.ESPERA_DA_CONVERSA_S + 1
        self.obs.tick()
        return [c[1] for c in self.chamadas if c[0] == "whatsapp-resposta"]

    def test_audio_do_lead_e_baixado_transcrito_e_chega_ao_n8n(self):
        pedidos = []

        def baixar(msg, apikey):
            pedidos.append((msg, apikey))
            return b"OggS-de-mentira", "audio/ogg; codecs=opus"
        self.obs.transcritor = ob.Transcritor(self.dir, relogio=lambda: self.agora, ligado=True, baixar=baixar,
                                              gemini=lambda dados, mime, chave: "No momento não, obrigado.",
                                              chave_gemini=lambda: "chave-falsa", apikey=lambda: "apikey-falsa")
        corpo = upsert(LEAD, id_="AUD9", ts=T0 - 5)
        corpo["data"]["message"] = {"audioMessage": dict(Traducao.AUDIO)}
        self.alimentar(corpo)
        enviadas = self.lote()
        self.assertEqual(enviadas[0]["mensagens"][0]["texto"], "[áudio 27s] No momento não, obrigado.")
        msg, apikey = pedidos[0]
        self.assertEqual((msg["key"]["id"], apikey), ("AUD9", "apikey-falsa"))
        self.assertIn("mediaKey", msg["message"]["audioMessage"])
        linha = json.loads((self.conversas / f"{CHAVE}.jsonl").read_text().splitlines()[0])
        self.assertEqual((linha["texto"], linha["id"]), ("[áudio 27s] No momento não, obrigado.", "AUD9"))

    def test_o_sim_chega_com_a_pergunta_do_romulo(self):
        self.alimentar(upsert(LEAD, "Posso te mandar o vídeo? Sem compromisso", de_mim=True, id_="P1", ts=T0 - 120))
        self.alimentar(upsert(LEAD, "CLaro, pode enviar sim", id_="R1", ts=T0 - 5))
        enviadas = self.lote()
        self.assertEqual(enviadas[0]["contexto"], {"saidas": [{"em": ob.iso_utc(T0 - 120),
                                                               "texto": "Posso te mandar o vídeo? Sem compromisso"}]})
        self.assertEqual([m["texto"] for m in enviadas[0]["mensagens"]], ["CLaro, pode enviar sim"])

    def test_silencio_do_log_e_desligavel(self):
        self.assertTrue(ob.silencio_suspeito(T0 + 7 * 3600, T0, False, limite=6 * 3600))
        self.assertFalse(ob.silencio_suspeito(T0 + 7 * 3600, T0, False, limite=0))
        self.assertFalse(ob.silencio_suspeito(T0 + 7 * 3600, T0, True, limite=6 * 3600))
        self.assertFalse(ob.silencio_suspeito(T0 + 3600, T0, False, limite=6 * 3600))


class AvisoPelaLib(unittest.TestCase):
    """O avisar() do adaptador: pela lib de aviso do repo; sem ela nada vai à fila (uma linha no stderr)."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="ev-aviso-teste-"))
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.antes = (ev.FILA_DE_AVISOS, ev.PASTAS_DA_LIB)
        self.addCleanup(lambda: setattr(ev, "FILA_DE_AVISOS", self.antes[0]) or setattr(ev, "PASTAS_DA_LIB", self.antes[1]))
        ev.FILA_DE_AVISOS = self.tmp / "fila"
        ev.FILA_DE_AVISOS.mkdir()

    def avisar(self, texto):
        err = io.StringIO()
        with contextlib.redirect_stdout(err), contextlib.redirect_stderr(err):
            ev.avisar(texto)
        return err.getvalue()

    def test_grava_pela_lib_do_repo(self):
        ev.PASTAS_DA_LIB = [AQUI.parent / "lib"]
        self.avisar("O número desconectou")
        [arquivo] = list(ev.FILA_DE_AVISOS.glob("evolution-*.json"))
        self.assertEqual(json.loads(arquivo.read_text(encoding="utf-8")),
                         {"titulo": "📱 Número do PRUMO no WhatsApp", "texto": "O número desconectou", "origem": "evolution-adaptador"})

    def test_sem_a_lib_nada_e_gravado_e_a_linha_vai_ao_stderr(self):
        ev.PASTAS_DA_LIB = [self.tmp / "sem-lib"]
        saida = self.avisar("O número desconectou")
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: 📱 Número do PRUMO no WhatsApp", saida)
        self.assertEqual(list(ev.FILA_DE_AVISOS.iterdir()), [])


if __name__ == "__main__":
    try:
        unittest.main(verbosity=1)
    finally:
        shutil.rmtree(_CONVERSAS_TESTE, ignore_errors=True)
