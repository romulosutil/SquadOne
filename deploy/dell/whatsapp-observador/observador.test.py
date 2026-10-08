#!/usr/bin/env python3
"""Testes do observador do WhatsApp com linhas de log de mentira, n8n de mentira
e relógio fixo. Nada é lido do Hermes nem gravado na planilha; números fictícios.

  python3 deploy/dell/whatsapp-observador/observador.test.py
"""
import importlib.util
import json
import os
import shutil
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path

AQUI = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("observador", AQUI / "observador.py")
ob = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ob)

LEAD, LEAD2, OUTRO = "5527999887766", "5511988776655", "5521977776666"
CHAVE, CHAVE2 = ob.chave_do_numero(LEAD), ob.chave_do_numero(LEAD2)
T0 = 1790773200.0  # 30/09/2026 10:00 (Brasília)


def recebida(numero, dominio="s.whatsapp.net"):
    return json.dumps({"event": "ignored", "reason": ob.MOTIVO, "chatId": f"{numero}@{dominio}", "senderId": f"{numero}@{dominio}"}) + "\n"


def enviada(numero, ts, dominio="s.whatsapp.net"):
    return json.dumps({"event": "owner_sent", "chatId": f"{numero}@{dominio}", "ts": ts}) + "\n"


def recibo(numero, status, ts):
    return json.dumps({"event": "owner_receipt", "chatId": f"{numero}@s.whatsapp.net", "status": status, "ts": ts}) + "\n"


class EntregaImediata(unittest.TestCase):
    """O aviso gravado pede ao dell-status para esvaziar a fila já; sem o binário, nada acontece."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp())
        self.antes = (ob.FILA_DE_AVISOS, ob.DELL_STATUS, ob.subprocess.run)
        ob.FILA_DE_AVISOS = self.tmp / "fila"
        self.chamadas = []
        ob.subprocess.run = lambda *a, **k: self.chamadas.append(a[0])

    def tearDown(self):
        ob.FILA_DE_AVISOS, ob.DELL_STATUS, ob.subprocess.run = self.antes
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_aviso_gravado_manda_drenar(self):
        ob.DELL_STATUS = self.tmp / "dell-status"
        ob.DELL_STATUS.write_text("#!/bin/sh\n")
        ob.avisar_pelo_hermes("X respondeu")
        self.assertEqual(len(list(ob.FILA_DE_AVISOS.glob("observador-*.json"))), 1)
        self.assertEqual(len(self.chamadas), 1)
        self.assertEqual(self.chamadas[0][-1], str(ob.DELL_STATUS))
        self.assertIn("--drenar", self.chamadas[0][2])

    def test_sem_dell_status_so_grava(self):
        ob.DELL_STATUS = self.tmp / "nao-existe"
        ob.avisar_pelo_hermes("X respondeu")
        self.assertEqual(len(list(ob.FILA_DE_AVISOS.glob("observador-*.json"))), 1)
        self.assertEqual(self.chamadas, [])

    def test_aviso_que_nao_grava_nao_pede_entrega(self):
        ob.DELL_STATUS = self.tmp / "dell-status"
        ob.DELL_STATUS.write_text("#!/bin/sh\n")
        (self.tmp / "fila").write_text("é um arquivo, não uma pasta")
        ob.avisar_pelo_hermes("X respondeu")
        self.assertEqual(self.chamadas, [])


class N8nDeMentira:
    def __init__(self):
        self.chamadas, self.respostas, self.falhar = [], [], None

    def __call__(self, metodo, caminho, corpo=None):
        if self.falhar:
            raise self.falhar
        self.chamadas.append((metodo, caminho, corpo))
        if caminho == "whatsapp-telefones":
            return {"chaves": [CHAVE, CHAVE2]}
        return self.respostas.pop(0) if self.respostas else {"ok": True, "marcados": []}


class Base(unittest.TestCase):
    def setUp(self):
        self.agora = T0
        self.n8n = N8nDeMentira()
        self.avisos = []
        self.dir = Path(tempfile.mkdtemp())
        self.bridge = self.dir / "bridge.js"
        self.bridge.write_text("// >>> squadone:envios\n// >>> squadone:recibos\n// >>> squadone:respostas\n")
        self._sessao, ob.SESSAO_HERMES = ob.SESSAO_HERMES, self.dir
        self.obs = ob.Observador({CHAVE, CHAVE2}, chamar=self.n8n, avisar=self.avisos.append,
                                 relogio=lambda: self.agora, bridge_js=self.bridge, pasta=self.dir / "estado")

    def tearDown(self):
        ob.SESSAO_HERMES = self._sessao
        shutil.rmtree(self.dir)

    def posts(self):
        return [c[2] for c in self.n8n.chamadas if c[1] == "whatsapp-conversa"]

    def passar(self, segundos):
        self.agora += segundos
        self.obs.tick()


class Envio(Base):
    def test_numero_que_nao_e_lead_nao_sai_daqui(self):
        self.obs.linha(enviada(OUTRO, T0))
        self.obs.linha(recibo(OUTRO, "lido", T0))
        self.assertEqual(self.posts(), [])

    def test_abordagem_vira_saida_com_a_hora_da_mensagem_e_um_aviso(self):
        self.n8n.respostas.append({"ok": True, "marcados": [
            {"planilha": "site", "nome": "Padaria Teste", "acao": "abordou", "antes": "pronto"}]})
        self.obs.linha(enviada(LEAD, T0 - 60))
        self.assertEqual(self.posts(), [{"chave": CHAVE, "direcao": "saida", "em": ob.iso(T0 - 60)}])
        self.passar(4 * 60)
        self.assertEqual(self.avisos, [])  # espera juntar o lote
        self.passar(61)
        self.assertEqual(self.avisos, ["Registrado: você abordou Padaria Teste (Site antes da venda) às 09:59."])

    def test_varias_abordagens_num_aviso_so(self):
        self.n8n.respostas += [
            {"ok": True, "marcados": [{"planilha": "site", "nome": "Padaria Teste", "acao": "abordou", "antes": "novo"}]},
            {"ok": True, "marcados": [{"planilha": "prumo", "nome": "Oficina Teste", "acao": "abordou", "antes": "Revisar"},
                                      {"planilha": "site", "nome": "Oficina Teste", "acao": "retomou", "antes": "recusado"}]},
        ]
        self.obs.linha(enviada(LEAD, T0))
        self.passar(120)
        self.obs.linha(enviada(LEAD2, T0 + 120))
        self.passar(200)
        self.assertEqual(len(self.avisos), 1)
        self.assertEqual(self.avisos[0].split("\n"), [
            "Registrado: você abordou 3 leads:",
            "• Padaria Teste (Site antes da venda) às 10:00",
            "• Oficina Teste (PRUMO) às 10:02",
            "• Oficina Teste (Site antes da venda; retomou a conversa, estava recusado) às 10:02",
        ])

    def test_conversa_normal_nao_avisa(self):
        self.obs.linha(enviada(LEAD, T0))  # n8n responde marcados: [] (lead já enviado)
        self.passar(600)
        self.assertEqual(len(self.posts()), 1)
        self.assertEqual(self.avisos, [])

    def test_um_aviso_ao_n8n_a_cada_30_min_por_lead(self):
        for minuto in (0, 1, 29):
            self.agora = T0 + minuto * 60
            self.obs.linha(enviada(LEAD, self.agora))
        self.assertEqual(len(self.posts()), 1)
        self.agora = T0 + 31 * 60
        self.obs.linha(enviada(LEAD, self.agora))
        self.assertEqual(len(self.posts()), 2)

    def test_lid_vira_telefone_pelo_mapa_da_sessao(self):
        (self.dir / "lid-mapping-123456789_reverse.json").write_text(json.dumps(LEAD))
        self.obs.linha(enviada("123456789", T0, dominio="lid"))
        self.obs.linha(enviada("999999999", T0, dominio="lid"))  # sem mapa: ignora
        self.assertEqual([p["chave"] for p in self.posts()], [CHAVE])

    def test_retomou_sozinho(self):
        self.assertEqual(ob.texto_do_lote([{"planilha": "site", "nome": "Padaria Teste", "acao": "retomou",
                                            "antes": "expirado", "hora": "10:00"}]),
                         "Registrado: você retomou a conversa com Padaria Teste (Site antes da venda, estava expirado) às 10:00.")

    def test_parar_o_servico_nao_engole_o_aviso(self):
        self.n8n.respostas.append({"ok": True, "marcados": [{"planilha": "site", "nome": "P", "acao": "abordou", "antes": "novo"}]})
        self.obs.linha(enviada(LEAD, T0))
        self.obs.avisar_lote()
        self.assertEqual(len(self.avisos), 1)


class Recibo(Base):
    def test_entregue_fica_no_log_lido_vai_ao_n8n(self):
        self.obs.linha(recibo(LEAD, "entregue", T0))
        self.assertEqual(self.posts(), [])
        self.obs.linha(recibo(LEAD, "lido", T0 + 30))
        self.assertEqual(self.posts(), [{"chave": CHAVE, "direcao": "lido", "em": ob.iso(T0 + 30)}])
        self.agora = T0 + 3600
        self.obs.linha(recibo(LEAD, "lido", self.agora))
        self.assertEqual(len(self.posts()), 1)  # um a cada 6 h
        self.agora = T0 + 7 * 3600
        self.obs.linha(recibo(LEAD, "lido", self.agora))
        self.assertEqual(len(self.posts()), 2)
        self.passar(600)
        self.assertEqual(self.avisos, [])  # leitura nunca avisa


class Resposta(Base):
    """Regra de 29/09: primeiro aviso, segundo só depois de 5 min, depois silêncio por 6 h."""

    def test_janela(self):
        self.obs.linha(recebida(LEAD))
        self.agora += 60
        self.obs.linha(recebida(LEAD))
        self.agora += 5 * 60
        self.obs.linha(recebida(LEAD))
        self.agora += 60
        self.obs.linha(recebida(LEAD))
        self.assertEqual([p.get("seguinte", False) for p in self.posts()], [False, True])
        self.assertEqual(self.posts()[0], {"chave": CHAVE, "direcao": "entrada", "em": ob.iso(T0)})
        self.agora += 6 * 3600
        self.obs.linha(recebida(LEAD))
        self.assertEqual(len(self.posts()), 3)

    def test_grupo_canal_e_status_sao_ignorados(self):
        for chat in ("120363000000000000@g.us", "status@broadcast", "120363000000000001@newsletter"):
            self.obs.linha(json.dumps({"event": "ignored", "reason": ob.MOTIVO, "chatId": chat}) + "\n")
        self.assertEqual(self.posts(), [])

    def test_resposta_atrasada_ganha_a_ultima_hora_do_log(self):
        # O serviço estava parado: envio às 09:00 e a saudação logo depois, relidos às 10:00.
        self.obs.linha(enviada(LEAD, T0 - 3600), atrasada=True, desde=T0 - 7200)
        self.obs.linha(recebida(LEAD), atrasada=True, desde=T0 - 7200)
        self.assertEqual(self.posts()[1], {"chave": CHAVE, "direcao": "entrada", "em": ob.iso(T0 - 3600)})
        # Sem hora nenhuma no atraso: a hora da posição gravada.
        self.obs.hora_do_log = None
        self.obs.linha(recebida(LEAD2), atrasada=True, desde=T0 - 7200)
        self.assertEqual(self.posts()[2]["em"], ob.iso(T0 - 7200))
        # Ao vivo: agora.
        self.obs.respostas.clear()
        self.obs.linha(recebida(LEAD2))
        self.assertEqual(self.posts()[3]["em"], ob.iso(T0))

    def test_linha_do_pino_da_hora_ao_log(self):
        self.obs.linha(json.dumps({"level": 50, "time": int((T0 - 100) * 1000), "msg": "stream errored out"}) + "\n")
        self.obs.linha(recebida(LEAD), atrasada=True, desde=T0 - 7200)
        self.assertEqual(self.posts()[0]["em"], ob.iso(T0 - 100))


class N8nComErro(Base):
    def test_evento_fica_na_fila_na_ordem_e_a_posicao_nao_passa_dele(self):
        self.n8n.falhar = urllib.error.HTTPError("u", 500, "erro", {}, None)
        self.obs.linha(enviada(LEAD, T0), origem=(7, 1000))
        self.obs.linha(recebida(LEAD2), origem=(7, 1100))
        self.assertEqual(len(self.obs.pendentes), 2)
        self.assertEqual(self.obs.posicao_segura({"inode": 7, "posicao": 5000}), (7, 1000))
        self.passar(30)
        self.assertEqual(len(self.obs.pendentes), 2)  # 1 min de espera
        self.n8n.falhar = None
        self.passar(31)
        self.assertEqual([p["direcao"] for p in self.posts()], ["saida", "entrada"])
        self.assertEqual(self.obs.posicao_segura({"inode": 7, "posicao": 5000}), (7, 5000))

    def test_espera_cresce_com_falha_do_fluxo_e_nao_com_n8n_fora(self):
        http500 = urllib.error.HTTPError("u", 500, "erro", {}, None)
        self.assertEqual([ob.espera_da_falha(http500, n) for n in (1, 2, 3, 4, 9)], [60, 240, 960, 3600, 3600])
        self.assertEqual(ob.espera_da_falha(urllib.error.URLError("recusada"), 9), 30)

    def test_lista_de_numeros_com_erro_mantem_a_anterior(self):
        self.n8n.falhar = urllib.error.HTTPError("u", 500, "erro", {}, None)
        self.passar(ob.RELER_NUMEROS_S)
        self.assertEqual(self.obs.chaves, {CHAVE, CHAVE2})
        self.assertEqual(self.obs.proxima_leitura, self.agora + 60)
        self.n8n.falhar = None
        self.passar(60)
        self.assertEqual(self.obs.proxima_leitura, self.agora + ob.RELER_NUMEROS_S)


class Remendo(Base):
    def test_avisa_uma_vez_quando_some_e_de_novo_depois_de_voltar(self):
        self.passar(1)
        self.assertEqual(self.avisos, [])
        self.bridge.write_text("// bridge nova, sem remendo\n")
        self.passar(ob.RELER_NUMEROS_S)
        self.passar(ob.RELER_NUMEROS_S)
        self.assertEqual(len(self.avisos), 1)
        self.assertIn("patch_bridge_envios.py", self.avisos[0])
        self.bridge.write_text("// >>> squadone:envios\n// >>> squadone:recibos\n// >>> squadone:respostas\n")
        self.passar(ob.RELER_NUMEROS_S)
        self.bridge.write_text("")
        self.passar(ob.RELER_NUMEROS_S)
        self.assertEqual(len(self.avisos), 2)


class Respostas(Base):
    """Texto das respostas: a bridge grava respostas.jsonl, o observador junta e manda ao n8n."""

    def escrever(self, *linhas):
        with open(self.obs.pasta / "respostas.jsonl", "a", encoding="utf-8") as f:
            for chave, ts, texto in linhas:
                f.write(json.dumps({"chave": chave, "ts": ts, "texto": texto}, ensure_ascii=False) + "\n")

    def conversas(self):
        return [c[2] for c in self.n8n.chamadas if c[1] == "whatsapp-resposta"]

    def test_grava_a_lista_de_leads_para_a_bridge(self):
        lista = self.obs.pasta / "leads.json"
        self.assertEqual(json.loads(lista.read_text()), sorted([CHAVE, CHAVE2]))
        if os.name != "nt":
            self.assertEqual(lista.stat().st_mode & 0o777, 0o600)
        self.passar(ob.RELER_NUMEROS_S)  # n8n de mentira devolve as mesmas duas
        self.assertEqual(json.loads(lista.read_text()), sorted([CHAVE, CHAVE2]))

    def test_junta_a_conversa_e_manda_depois_da_pausa(self):
        # O tick lê o arquivo; a pausa conta da última leitura com mensagem nova.
        self.escrever((CHAVE, T0, "Olá! Obrigado pelo contato. Em breve retornaremos."))
        self.passar(1)
        self.passar(29)
        self.escrever((CHAVE, T0 + 30, "não temos interesse"))
        self.passar(1)
        self.passar(ob.ESPERA_DA_CONVERSA_S - 2)
        self.assertEqual(self.conversas(), [])  # ainda dentro da pausa
        self.passar(2)
        self.assertEqual(self.conversas(), [{"chave": CHAVE, "mensagens": [
            {"em": ob.iso(T0), "texto": "Olá! Obrigado pelo contato. Em breve retornaremos."},
            {"em": ob.iso(T0 + 30), "texto": "não temos interesse"}]}])
        self.assertFalse((self.obs.pasta / "respostas.jsonl").exists())  # lido e apagado
        self.assertFalse((self.obs.pasta / "respostas.lendo.jsonl").exists())

    def test_quem_nao_e_lead_nao_sai_daqui(self):
        self.escrever((ob.chave_do_numero(OUTRO), T0, "oi"), (CHAVE2, T0, "pode mandar"))
        self.passar(1)
        self.passar(ob.ESPERA_DA_CONVERSA_S)
        self.assertEqual([c["chave"] for c in self.conversas()], [CHAVE2])

    def test_aviso_do_n8n_vai_pelo_hermes_e_falha_tenta_de_novo(self):
        self.escrever((CHAVE, T0, "pode mandar o link"))
        self.passar(1)
        self.n8n.falhar = urllib.error.HTTPError("u", 500, "erro", {}, None)
        self.passar(ob.ESPERA_DA_CONVERSA_S)
        self.assertEqual(self.conversas(), [])
        self.n8n.falhar = None
        self.n8n.respostas.append({"ok": True, "marcados": [{"planilha": "site", "tipo": "interesse", "aviso": "X respondeu"}]})
        self.passar(30)
        self.assertEqual(self.conversas(), [])  # espera de 1 min depois da falha
        self.passar(31)
        self.assertEqual(len(self.conversas()), 1)
        self.assertEqual(self.avisos, ["X respondeu"])

    def test_sobra_de_uma_parada_no_meio_e_lida(self):
        self.obs.pasta.mkdir(parents=True, exist_ok=True)
        (self.obs.pasta / "respostas.lendo.jsonl").write_text(json.dumps({"chave": CHAVE, "ts": T0, "texto": "a"}) + "\n")
        self.escrever((CHAVE2, T0, "b"))
        self.passar(1)
        self.passar(1)
        self.obs.fechar_conversas(todas=True)
        self.obs.mandar_conversas()
        self.assertEqual(sorted(c["chave"] for c in self.conversas()), sorted([CHAVE, CHAVE2]))


class Seguir(unittest.TestCase):
    def test_continua_da_posicao_e_marca_o_atraso(self):
        d = Path(tempfile.mkdtemp())
        try:
            logf, pos = d / "bridge.log", d / "posicao.json"
            logf.write_text("a\nb\n")
            inode = os.stat(logf).st_ino
            pos.write_text(json.dumps({"inode": inode, "posicao": 2}))  # formato antigo, sem salvo_em
            antigo, ob.POSICAO = ob.POSICAO, pos
            try:
                onde = {}
                g = ob.seguir(logf, onde)
                self.addCleanup(g.close)
                self.assertEqual(next(g), "b\n")
                self.assertEqual((onde["posicao"], onde["atraso_ate"]), (2, 4))
                self.assertAlmostEqual(onde["salvo_em"], os.stat(pos).st_mtime, delta=1)
                self.assertIsNone(next(g))
                with open(logf, "a") as f:
                    f.write("c\n")
                self.assertEqual(next(g), "c\n")
                self.assertEqual(onde["posicao"], 4)  # começo de "c": ao vivo (não < atraso_ate)
                ob.salvar_posicao(inode, 6)
                self.assertEqual(ob.posicao_salva()[:2], (inode, 6))
                self.assertAlmostEqual(ob.posicao_salva()[2], time.time(), delta=5)
            finally:
                ob.POSICAO = antigo
        finally:
            shutil.rmtree(d)


if __name__ == "__main__":
    unittest.main(verbosity=2)
