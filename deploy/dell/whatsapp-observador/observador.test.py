#!/usr/bin/env python3
"""Testes do observador do WhatsApp com linhas de log de mentira, n8n de mentira
e relógio fixo. Nada é lido do Hermes nem gravado na planilha; números fictícios.

O avisar() pela lib de aviso (11/10/2026) tem as suas classes (AvisoPelaLib,
SemLib, AvisoDeLead): o dell-status aceita o que a lib grava, sem a lib nada vai à
fila (uma linha no stderr) e não se pede entrega, a fila ausente não derruba o
laço nem pede a entrega, e "R$" no trecho do
lead vira [valor] em vez de a resposta do lead se perder. Nada sobe o serviço, lê o
bridge.log do Hermes nem toca a fila real: a fila, o dell-status e o subprocess
são dublês ou pastas temporárias.

  python3 deploy/dell/whatsapp-observador/observador.test.py
"""
import contextlib
import importlib.util
import io
import json
import os
import re
import shutil
import tempfile
import time
import unittest
import urllib.error
from pathlib import Path

AQUI = Path(__file__).resolve().parent
# A conversa dos leads em disco (16/10/2026) nunca cai na pasta de verdade: o padrão do módulo é um temporário.
_CONVERSAS_TESTE = tempfile.mkdtemp(prefix="conversas-teste-")
os.environ["WHATSAPP_CONVERSAS_DIR"] = _CONVERSAS_TESTE
# O Plus (OT-13) também: o padrão aponta para um arquivo que não existe, nunca para o ~/prumo-entregas real.
os.environ["OBSERVADOR_PLUS"] = str(Path(_CONVERSAS_TESTE) / "sem-plus" / "leads.json")
# A transcrição de áudio (17/10/2026) nasce desligada: só os testes dela ligam, com Evolution e Gemini dublês.
os.environ["OBSERVADOR_TRANSCREVER"] = "0"
spec =importlib.util.spec_from_file_location("observador", AQUI / "observador.py")
ob = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ob)

try:
    _spec_ds = importlib.util.spec_from_file_location("dell_status_para_observador", AQUI.parent / "dell-status.py")
    ds = importlib.util.module_from_spec(_spec_ds)
    _spec_ds.loader.exec_module(ds)
except Exception:  # noqa: BLE001 — sem fcntl (Windows)
    ds = None

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
        ob.FILA_DE_AVISOS.mkdir()  # a lib de aviso não cria a pasta da fila
        ob.avisar("X respondeu")
        self.assertEqual(len(list(ob.FILA_DE_AVISOS.glob("observador-*.json"))), 1)
        self.assertEqual(len(self.chamadas), 1)
        self.assertEqual(self.chamadas[0][-1], str(ob.DELL_STATUS))
        self.assertIn("--drenar", self.chamadas[0][2])

    def test_sem_dell_status_so_grava(self):
        ob.DELL_STATUS = self.tmp / "nao-existe"
        ob.FILA_DE_AVISOS.mkdir()
        ob.avisar("X respondeu")
        self.assertEqual(len(list(ob.FILA_DE_AVISOS.glob("observador-*.json"))), 1)
        self.assertEqual(self.chamadas, [])

    def test_aviso_que_nao_grava_nao_pede_entrega(self):
        ob.DELL_STATUS = self.tmp / "dell-status"
        ob.DELL_STATUS.write_text("#!/bin/sh\n")
        (self.tmp / "fila").write_text("é um arquivo, não uma pasta")
        ob.avisar("X respondeu")
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
        self.pasta_conversas = self.dir / "conversas"
        self.obs = ob.Observador({CHAVE, CHAVE2}, chamar=self.n8n, avisar=self.avisos.append,
                                 relogio=lambda: self.agora, bridge_js=self.bridge, pasta=self.dir / "estado",
                                 conversas=ob.Conversas(self.pasta_conversas, "pessoal", relogio=lambda: self.agora))

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

    def test_aviso_do_n8n_vai_para_a_fila_e_falha_tenta_de_novo(self):
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


# Textos como o serviço os monta: o aviso de abordagem, o do remendo que sumiu e o que
# o n8n devolve com o trecho do que o lead escreveu.
TEXTOS_DO_AVISO = [
    ob.texto_do_lote([{"planilha": "site", "nome": "Padaria Açaí & Cia", "acao": "abordou", "hora": "09:59"}]),
    ob.texto_do_lote([{"planilha": "site", "nome": "A", "acao": "abordou", "hora": "09:59"},
                      {"planilha": "prumo", "nome": "B", "acao": "retomou", "antes": "pronto", "hora": "10:01"}]),
    "A bridge do WhatsApp perdeu o remendo (provável `hermes update`). Para pôr de volta: " + ob.COMANDO_REMENDO,
    "Padaria Teste (Site antes da venda) respondeu: \"pode mandar o link\" — ação, coração\nsegunda linha",
    "dois  espaços  e  nada de moeda",
]


class BaseDoAviso(unittest.TestCase):
    """A fila, o dell-status e o subprocess do módulo trocados por dublês, e a lib do repo na frente."""

    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="obs-teste-"))
        nomes = ("FILA_DE_AVISOS", "DELL_STATUS", "PASTAS_DA_LIB")
        self.antes = {k: getattr(ob, k) for k in nomes}
        self.run_antes = ob.subprocess.run
        self.addCleanup(self.restaurar)
        ob.FILA_DE_AVISOS = self.tmp / "fila"
        ob.DELL_STATUS = self.tmp / "dell-status"
        ob.DELL_STATUS.write_text("#!/bin/sh\n")
        self.entregas = []
        ob.subprocess.run = lambda *a, **k: self.entregas.append(a[0])
        self.lib_do_repo = list(self.antes["PASTAS_DA_LIB"])

    def restaurar(self):
        for k, v in self.antes.items():
            setattr(ob, k, v)
        ob.subprocess.run = self.run_antes
        shutil.rmtree(self.tmp, ignore_errors=True)

    def fila(self):
        return sorted(ob.FILA_DE_AVISOS.glob("*.json")) if ob.FILA_DE_AVISOS.is_dir() else []

    def avisos(self):
        return [json.loads(p.read_text(encoding="utf-8")) for p in self.fila()]

    def sem_lib(self):
        ob.PASTAS_DA_LIB = [self.tmp / "sem-lib"]

    def avisar(self, texto):
        """Roda o avisar e devolve o que ele escreveu no stdout (o log) e no stderr."""
        saida = io.StringIO()
        with contextlib.redirect_stdout(saida), contextlib.redirect_stderr(saida):
            ob.avisar(texto)
        return saida.getvalue()

    def gravado_pela_lib(self, texto: str) -> bytes:
        """O aviso gravado pela lib do repo, numa fila limpa."""
        shutil.rmtree(ob.FILA_DE_AVISOS, ignore_errors=True)
        ob.FILA_DE_AVISOS.mkdir()
        ob.PASTAS_DA_LIB = self.lib_do_repo
        self.avisar(texto)
        self.assertEqual(len(self.fila()), 1, self.fila())
        return self.fila()[0].read_bytes()


class AvisoPelaLib(BaseDoAviso):
    def test_a_lib_do_repo_e_a_que_carrega(self):
        self.assertEqual(Path(ob.lib_de_aviso().__file__).resolve(), (AQUI.parent / "lib" / "aviso.py").resolve())

    def test_aviso_gravado_le_de_volta_igual(self):
        for texto in TEXTOS_DO_AVISO:
            with self.subTest(texto=texto):
                d = json.loads(self.gravado_pela_lib(texto).decode("utf-8"))
                self.assertEqual(d, {"titulo": "📱 Observador do WhatsApp", "texto": texto, "origem": "whatsapp-observador"})

    def test_conteudo_fixado(self):
        esperado = '{"titulo": "📱 Observador do WhatsApp", "texto": "uma\\nduas", "origem": "whatsapp-observador"}'
        self.assertEqual(self.gravado_pela_lib("uma\nduas"), esperado.encode("utf-8"))

    def test_nome_e_atomicidade(self):
        ob.FILA_DE_AVISOS.mkdir()
        self.avisar("x")
        self.assertRegex(self.fila()[0].name, r"^observador-\d+-[0-9a-f]{6}\.json$")
        self.assertEqual([p for p in ob.FILA_DE_AVISOS.iterdir() if not p.name.endswith(".json")], [])

    @unittest.skipIf(ds is None, "dell-status não carrega aqui (sem fcntl)")
    def test_dell_status_aceita(self):
        ob.FILA_DE_AVISOS.mkdir()
        for texto in TEXTOS_DO_AVISO:
            self.avisar(texto)
        self.assertEqual(len(self.fila()), len(TEXTOS_DO_AVISO))
        for aviso in self.avisos():
            ds.validar_aviso(aviso)

    def test_gravado_pede_a_entrega_imediata_uma_vez(self):
        ob.FILA_DE_AVISOS.mkdir()
        self.avisar("X respondeu")
        self.assertEqual(len(self.entregas), 1)
        self.assertEqual(self.entregas[0][-1], str(ob.DELL_STATUS))
        self.assertIn("--drenar", self.entregas[0][2])

    def test_fila_ausente_nao_e_criada_nao_levanta_e_nao_pede_entrega(self):
        saida = self.avisar("X respondeu")
        self.assertFalse(ob.FILA_DE_AVISOS.exists())
        self.assertEqual(self.entregas, [])
        self.assertIn("aviso não gravado: fila_ausente", saida)

    def test_fila_que_e_arquivo_nao_levanta_e_nao_pede_entrega(self):
        ob.FILA_DE_AVISOS.write_text("é um arquivo, não uma pasta")
        self.avisar("X respondeu")
        self.assertEqual(self.entregas, [])

    def test_aviso_recusado_nao_pede_entrega(self):
        ob.FILA_DE_AVISOS.mkdir()
        self.assertIn("aviso não gravado: recusado", self.avisar("   "))
        self.assertEqual((self.fila(), self.entregas), ([], []))

    def test_valor_em_reais_no_trecho_do_lead_nao_perde_a_resposta(self):
        ob.FILA_DE_AVISOS.mkdir()
        self.avisar("Padaria Teste respondeu: \"quanto custa? é R$ 50 por mês?\" (interesse)")
        texto = self.avisos()[0]["texto"]
        self.assertNotRegex(texto, r"R\s*\$")
        self.assertIn("Padaria Teste respondeu:", texto)
        self.assertIn("quanto custa? é [valor]", texto)
        self.assertIn("por mês?", texto)
        self.assertEqual(len(self.entregas), 1)  # gravou: manda esvaziar a fila

    def test_variantes_de_r_cifrao_do_lead(self):
        ob.FILA_DE_AVISOS.mkdir()
        for bruto in ("r$ 30", "R $30,00", "R$", "R\n$ 5"):
            with self.subTest(bruto=bruto):
                self.avisar(f"Lead disse: custa {bruto} certo?")
        self.assertEqual(len(self.fila()), 4)
        self.assertTrue(all("[valor]" in a["texto"] and not re.search(r"R\s*\$", a["texto"], re.I) for a in self.avisos()))

    def test_texto_sem_valor_nao_e_mexido(self):
        ob.FILA_DE_AVISOS.mkdir()
        self.avisar("  dois  espaços  ")
        self.assertEqual(self.avisos()[0]["texto"], "  dois  espaços  ")

    def test_texto_enorme_de_lead_e_cortado_e_o_aviso_sai(self):
        ob.FILA_DE_AVISOS.mkdir()
        self.avisar("Padaria Teste respondeu: " + "blá " * 2000)
        aviso = self.avisos()[0]
        self.assertLessEqual(len(aviso["texto"]), 4000)
        self.assertTrue(aviso["texto"].endswith("… (cortado)"))
        self.assertTrue(aviso["texto"].startswith("Padaria Teste respondeu:"))
        if ds is not None:
            ds.validar_aviso(aviso)

    def test_valor_e_texto_enorme_juntos(self):
        ob.FILA_DE_AVISOS.mkdir()
        self.avisar("Lead: R$ 10 " + "x" * 5000)
        aviso = self.avisos()[0]
        self.assertNotRegex(aviso["texto"], r"R\s*\$")
        self.assertLessEqual(len(aviso["texto"]), 4000)


class SemLib(BaseDoAviso):
    def sem_gravar(self, saida):
        self.assertIn("lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: 📱 Observador do WhatsApp", saida)
        self.assertFalse(ob.FILA_DE_AVISOS.exists(), "sem a lib nada é criado nem gravado na fila")
        self.assertEqual(self.entregas, [])  # nada gravado: não há o que entregar

    def test_sem_copia_registra_no_stderr_e_nao_grava(self):
        self.sem_lib()
        self.assertIsNone(ob.lib_de_aviso())
        self.sem_gravar(self.avisar("x"))

    def test_copia_quebrada_registra_no_stderr_e_nao_grava(self):
        quebrada = self.tmp / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("def x(:\n", encoding="utf-8")
        ob.PASTAS_DA_LIB = [quebrada]
        self.assertIsNone(ob.lib_de_aviso())
        self.sem_gravar(self.avisar("x"))

    def test_copia_quebrada_cai_na_seguinte(self):
        quebrada = self.tmp / "quebrada"
        quebrada.mkdir()
        (quebrada / "aviso.py").write_text("raise RuntimeError('x')\n", encoding="utf-8")
        ob.PASTAS_DA_LIB = [quebrada] + self.lib_do_repo
        self.assertEqual(Path(ob.lib_de_aviso().__file__).resolve(), (AQUI.parent / "lib" / "aviso.py").resolve())

    def test_sem_a_do_repo_a_instalada_serve(self):
        instalada = self.tmp / "mel"
        instalada.mkdir()
        shutil.copy(AQUI.parent / "lib" / "aviso.py", instalada / "aviso.py")
        ob.PASTAS_DA_LIB = [self.tmp / "sem-lib", instalada]
        self.assertEqual(Path(ob.lib_de_aviso().__file__).resolve(), (instalada / "aviso.py").resolve())

    def test_sem_a_lib_o_valor_em_reais_nao_chega_a_fila(self):
        self.sem_lib()
        ob.FILA_DE_AVISOS.mkdir()
        self.avisar("custa R$ 5")
        self.assertEqual(self.fila(), [])


class AvisoDeLead(BaseDoAviso):
    """O caminho inteiro: o n8n devolve o aviso de uma resposta e o Observador o grava pela lib."""

    def setUp(self):
        super().setUp()
        self.agora = T0
        self.n8n = N8nDeMentira()
        self.dir = Path(tempfile.mkdtemp(prefix="obs-teste-"))
        self.addCleanup(shutil.rmtree, self.dir, ignore_errors=True)
        self.bridge = self.dir / "bridge.js"
        self.bridge.write_text("// >>> squadone:envios\n// >>> squadone:recibos\n// >>> squadone:respostas\n")
        self._sessao, ob.SESSAO_HERMES = ob.SESSAO_HERMES, self.dir
        self.addCleanup(lambda: setattr(ob, "SESSAO_HERMES", self._sessao))
        ob.FILA_DE_AVISOS.mkdir()
        self.obs = ob.Observador({CHAVE}, chamar=self.n8n, avisar=ob.avisar,
                                 relogio=lambda: self.agora, bridge_js=self.bridge, pasta=self.dir / "estado")

    def passar(self, segundos):
        self.agora += segundos
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            self.obs.tick()

    def test_resposta_do_lead_com_valor_chega_na_fila_sem_o_valor(self):
        with open(self.obs.pasta / "respostas.jsonl", "a", encoding="utf-8") as f:
            f.write(json.dumps({"chave": CHAVE, "ts": T0, "texto": "quanto custa? R$ 50?"}, ensure_ascii=False) + "\n")
        self.n8n.respostas.append({"ok": True, "marcados": [
            {"planilha": "site", "tipo": "interesse", "aviso": "Padaria Teste respondeu: \"quanto custa? R$ 50?\""}]})
        self.passar(1)
        self.passar(ob.ESPERA_DA_CONVERSA_S)
        self.assertEqual(len(self.avisos()), 1)
        self.assertEqual(self.avisos()[0]["texto"], "Padaria Teste respondeu: \"quanto custa? [valor] ?\"")  # sem_valores deixa um espaço depois do [valor]
        self.assertEqual(self.avisos()[0]["origem"], "whatsapp-observador")
        self.assertEqual(len(self.entregas), 1)

    def test_remendo_que_sumiu_avisa_uma_vez_pela_fila(self):
        self.bridge.write_text("// bridge nova, sem remendo\n")
        self.passar(ob.RELER_NUMEROS_S)
        self.passar(ob.RELER_NUMEROS_S)
        self.assertEqual(len(self.avisos()), 1)
        self.assertIn(ob.COMANDO_REMENDO, self.avisos()[0]["texto"])
        if ds is not None:
            ds.validar_aviso(self.avisos()[0])

    def test_fila_ausente_nao_derruba_o_laco(self):
        shutil.rmtree(ob.FILA_DE_AVISOS)
        self.bridge.write_text("// bridge nova, sem remendo\n")
        self.passar(ob.RELER_NUMEROS_S)  # conferir_remendo -> avisar -> fila ausente: segue
        self.passar(1)
        self.assertTrue(self.obs.remendo_avisado)
        self.assertFalse(ob.FILA_DE_AVISOS.exists())
        self.assertEqual(self.entregas, [])


class Seguir(unittest.TestCase):
    def test_continua_da_posicao_e_marca_o_atraso(self):
        d = Path(tempfile.mkdtemp())
        try:
            logf, pos = d / "bridge.log", d / "posicao.json"
            logf.write_bytes(b"a\nb\n")  # bridge.log tem LF; a fixture não deve virar CRLF no Windows.
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
                with open(logf, "ab") as f:
                    f.write(b"c\n")
                self.assertEqual(next(g), "c\n")
                self.assertEqual(onde["posicao"], 4)  # começo de "c": ao vivo (não < atraso_ate)
                ob.salvar_posicao(inode, 6)
                self.assertEqual(ob.posicao_salva()[:2], (inode, 6))
                self.assertAlmostEqual(ob.posicao_salva()[2], time.time(), delta=5)
            finally:
                g.close()  # libere o arquivo antes da limpeza também no Windows.
                ob.POSICAO = antigo
        finally:
            shutil.rmtree(d)


class ConversaEmDisco(Base):
    """A conversa de cada lead em WHATSAPP_CONVERSAS_DIR/<chave>.jsonl (contrato lido pela Central)."""

    def gravar(self, nome, *linhas):
        with open(self.obs.pasta / f"{nome}.jsonl", "a", encoding="utf-8") as f:
            for l in linhas:
                f.write(json.dumps(l, ensure_ascii=False) + "\n")

    def linhas(self, chave=CHAVE):
        arquivo = self.pasta_conversas / f"{chave}.jsonl"
        return [json.loads(l) for l in arquivo.read_text(encoding="utf-8").splitlines()] if arquivo.exists() else []

    def test_entrada_e_saida_com_texto_id_e_hora_utc(self):
        self.gravar("respostas", {"chave": CHAVE, "ts": T0 - 60, "texto": "Sim, quero ver", "id": "M1"})
        self.gravar("enviadas", {"chave": CHAVE, "ts": T0 - 30, "texto": "Oi! Segue o link", "id": "M2"})
        self.passar(1)
        self.assertEqual(self.linhas(), [
            {"em": "2026-09-30T12:59:00Z", "direcao": "entrada", "texto": "Sim, quero ver", "origem": "pessoal", "id": "M1"},
            {"em": "2026-09-30T12:59:30Z", "direcao": "saida", "texto": "Oi! Segue o link", "origem": "pessoal", "id": "M2"},
        ])
        self.assertFalse((self.obs.pasta / "enviadas.jsonl").exists())  # lido e apagado
        # A enviada não vai ao n8n (o envio já foi marcado pela linha owner_sent do log).
        self.assertFalse([c for c in self.n8n.chamadas if c[1] == "whatsapp-conversa"])

    def test_mesmo_id_nao_entra_duas_vezes(self):
        msg = {"chave": CHAVE, "ts": T0, "texto": "oi", "id": "M1"}
        self.gravar("respostas", msg)
        self.passar(1)
        self.gravar("respostas", msg)  # reinício, replay ou o mesmo chip pelo outro observador
        self.passar(1)
        outro = ob.Conversas(self.pasta_conversas, "prumo", relogio=lambda: self.agora)
        self.assertFalse(outro.anexar(CHAVE, "entrada", T0, "oi", "M1"))
        self.assertEqual(len(self.linhas()), 1)

    def test_sem_id_deduplica_por_direcao_hora_e_texto(self):
        c = self.obs.conversa
        self.assertTrue(c.anexar(CHAVE, "saida", T0, ""))
        self.assertFalse(c.anexar(CHAVE, "saida", T0, ""))
        self.assertTrue(c.anexar(CHAVE, "saida", T0 + 60, ""))
        self.assertTrue(c.anexar(CHAVE, "entrada", T0, "ok", "X"))
        self.assertFalse(c.anexar(CHAVE, "entrada", T0, "ok"))  # a mesma, por outro caminho sem id
        self.assertEqual(len(self.linhas()), 3)

    def test_quem_nao_e_lead_nao_tem_conversa(self):
        self.gravar("respostas", {"chave": ob.chave_do_numero(OUTRO), "ts": T0, "texto": "conversa pessoal", "id": "P1"})
        self.gravar("enviadas", {"chave": ob.chave_do_numero(OUTRO), "ts": T0, "texto": "oi mãe", "id": "P2"})
        self.obs.linha(enviada(OUTRO, T0))
        self.passar(1)
        self.assertFalse(self.pasta_conversas.exists() and list(self.pasta_conversas.glob("*.jsonl")))

    def test_owner_sent_sem_id_da_bridge_antiga_vira_saida_sem_texto(self):
        self.obs.linha(enviada(LEAD, T0 - 100))
        self.obs.linha(enviada(LEAD, T0 - 100))  # replay do log: não duplica
        self.assertEqual(self.linhas(), [{"em": ob.iso_utc(T0 - 100), "direcao": "saida", "texto": "", "origem": "pessoal"}])

    def test_owner_sent_com_id_espera_o_texto_do_enviadas(self):
        linha = json.dumps({"event": "owner_sent", "chatId": f"{LEAD}@s.whatsapp.net", "ts": T0 - 100, "id": "M9"}) + "\n"
        self.obs.linha(linha)
        self.assertEqual(self.linhas(), [])
        self.assertEqual([c[2]["direcao"] for c in self.n8n.chamadas if c[1] == "whatsapp-conversa"], ["saida"])  # n8n igual

    def test_recibo_de_leitura_nao_e_linha(self):
        self.obs.linha(recibo(LEAD, "lido", T0))
        self.assertEqual(self.linhas(), [])

    def test_texto_cortado_em_2000_e_sem_numero_na_linha(self):
        self.obs.conversa.anexar(CHAVE, "entrada", T0, "a" * 5000, "L")
        linha = self.linhas()[0]
        self.assertEqual(len(linha["texto"]), 2000)
        self.assertEqual(set(linha), {"em", "direcao", "texto", "origem", "id"})

    def test_nome_do_arquivo_e_saneado(self):
        self.assertEqual(ob.nome_da_conversa("27/../99887766 x"), "27_.._99887766_x")
        self.assertEqual(ob.nome_da_conversa("site:abc.DEF-1_2"), "site:abc.DEF-1_2")
        self.assertEqual(len(ob.nome_da_conversa("9" * 500)), 200)
        for ruim in ("", None, "..", "."):
            self.assertEqual(ob.nome_da_conversa(ruim), "")
            self.assertFalse(self.obs.conversa.anexar(ruim, "entrada", T0, "x"))

    def test_poda_o_que_passou_de_120_dias_uma_vez_por_dia(self):
        c = ob.Conversas(self.pasta_conversas, "pessoal", relogio=lambda: self.agora)
        self.agora = T0 - 200 * 86400
        c.anexar(CHAVE, "entrada", self.agora, "velha", "V")
        self.agora = T0
        c.anexar(CHAVE, "entrada", T0 - 10 * 86400, "recente", "R")  # primeira escrita do dia: poda
        self.assertEqual([l["texto"] for l in self.linhas()], ["recente"])
        # No mesmo dia não relê nem regrava para podar.
        with (self.pasta_conversas / f"{CHAVE}.jsonl").open("a", encoding="utf-8") as f:
            f.write(json.dumps({"em": "2020-01-01T00:00:00Z", "direcao": "entrada", "texto": "antiga", "origem": "x"}) + "\n")
        c.anexar(CHAVE, "saida", T0, "nova", "N")
        self.assertEqual([l["texto"] for l in self.linhas()], ["recente", "antiga", "nova"])
        self.agora = T0 + 86400 + 1
        c.anexar(CHAVE, "saida", self.agora, "amanhã", "A")
        self.assertEqual([l["texto"] for l in self.linhas()], ["recente", "nova", "amanhã"])

    def test_falha_ao_gravar_nao_derruba_o_fluxo(self):
        self.pasta_conversas.parent.mkdir(parents=True, exist_ok=True)
        self.pasta_conversas.write_text("é um arquivo, não uma pasta")
        self.gravar("respostas", {"chave": CHAVE, "ts": T0, "texto": "Sim", "id": "F1"})
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            self.passar(1)
            self.passar(ob.ESPERA_DA_CONVERSA_S)
        self.assertIn("conversa não gravada", saida.getvalue())
        self.assertNotIn("Sim", saida.getvalue())  # o journal não leva o texto
        # A classificação seguiu igual.
        self.assertEqual(len([c for c in self.n8n.chamadas if c[1] == "whatsapp-resposta"]), 1)

    @unittest.skipIf(os.name == "nt", "permissões POSIX")
    def test_pasta_700_e_arquivo_600(self):
        self.obs.conversa.anexar(CHAVE, "entrada", T0, "oi", "P")
        self.assertEqual(self.pasta_conversas.stat().st_mode & 0o777, 0o700)
        self.assertEqual((self.pasta_conversas / f"{CHAVE}.jsonl").stat().st_mode & 0o777, 0o600)

    def test_padrao_da_pasta_e_da_origem(self):
        self.assertEqual(str(ob.CONVERSAS), _CONVERSAS_TESTE)  # o teste nunca toca a pasta de verdade
        self.assertIn(ob.ORIGEM, ("pessoal", "prumo"))


PLUS, PLUS_E_PLANILHA = "5531988112233", LEAD2  # o segundo está no Plus E numa planilha
CHAVE_PLUS = ob.chave_do_numero(PLUS)


class ConversaDoPlus(Base):
    """17/10/2026 (OT-13): os leads do Plus (plus/leads.json, sem planilha) entram no filtro da bridge e têm a
    conversa em disco, mas nada deles vai ao n8n. O arquivo é um temporário; números fictícios."""

    gravar = ConversaEmDisco.gravar
    linhas = ConversaEmDisco.linhas

    def setUp(self):
        super().setUp()
        self.plus = self.dir / "plus" / "leads.json"
        self.plus.parent.mkdir()
        self.escrever_plus(PLUS, PLUS_E_PLANILHA)
        self.obs = ob.Observador({CHAVE, CHAVE2}, chamar=self.n8n, avisar=self.avisos.append,
                                 relogio=lambda: self.agora, bridge_js=self.bridge, pasta=self.dir / "estado",
                                 conversas=ob.Conversas(self.pasta_conversas, "prumo", relogio=lambda: self.agora),
                                 ler_plus=lambda: ob.ler_chaves_do_plus(self.plus))

    def escrever_plus(self, *numeros):
        self.plus.write_text(json.dumps({"versao": 1, "geradoEm": "2026-10-15T12:00:00Z", "leads": [
            {"id": f"p{i}", "empresa": f"Loja {i}", "whatsapp": n, "oferta": "site"} for i, n in enumerate(numeros)]}))

    def test_le_so_as_chaves_do_arquivo_e_ilegivel_e_vazio(self):
        self.assertEqual(ob.ler_chaves_do_plus(self.plus), {CHAVE_PLUS, CHAVE2})
        for ruim in ("{ quebrado", "[]", '{"leads": {}}', '{"leads": [{"whatsapp": "123"}, "x", {}]}'):
            self.plus.write_text(ruim)
            self.assertEqual(ob.ler_chaves_do_plus(self.plus), set(), ruim)
        self.assertEqual(ob.ler_chaves_do_plus(self.dir / "nao-existe.json"), set())

    def test_entra_no_filtro_da_bridge_e_do_adaptador(self):
        self.assertEqual(json.loads((self.obs.pasta / "leads.json").read_text()), sorted([CHAVE, CHAVE2, CHAVE_PLUS]))

    def test_resposta_e_envio_do_plus_viram_conversa_e_nao_vao_ao_n8n(self):
        self.gravar("respostas", {"chave": CHAVE_PLUS, "ts": T0 - 60, "texto": "Meu Ir.'., tenho interesse", "id": "X1"})
        self.gravar("enviadas", {"chave": CHAVE_PLUS, "ts": T0 - 120, "texto": "Meu Ir.'., tudo bem?", "id": "X0"})
        self.obs.linha(recebida(PLUS))
        self.obs.linha(json.dumps({"event": "owner_sent", "chatId": f"{PLUS}@s.whatsapp.net", "ts": T0 - 120, "id": "X0"}) + "\n")
        self.obs.linha(recibo(PLUS, "lido", T0 - 90))
        self.passar(1)
        self.passar(ob.ESPERA_DA_CONVERSA_S)
        self.assertEqual([(l["direcao"], l["texto"]) for l in self.linhas(CHAVE_PLUS)],
                         [("entrada", "Meu Ir.'., tenho interesse"), ("saida", "Meu Ir.'., tudo bem?")])
        self.assertEqual([c for c in self.n8n.chamadas if c[1] != "whatsapp-telefones"], [])

    def test_quem_esta_no_plus_e_numa_planilha_segue_indo_ao_n8n(self):
        self.gravar("respostas", {"chave": CHAVE2, "ts": T0, "texto": "pode mandar", "id": "Y1"})
        self.passar(1)
        self.passar(ob.ESPERA_DA_CONVERSA_S)
        self.assertEqual([c[2]["chave"] for c in self.n8n.chamadas if c[1] == "whatsapp-resposta"], [CHAVE2])
        self.assertEqual(len(self.linhas(CHAVE2)), 1)

    def test_releitura_pega_o_plus_novo_mesmo_com_o_n8n_fora(self):
        novo = "5541977665544"
        self.escrever_plus(PLUS, novo)
        self.n8n.falhar = urllib.error.URLError("fora")
        with contextlib.redirect_stdout(io.StringIO()):
            self.passar(ob.RELER_NUMEROS_S)
        self.assertIn(ob.chave_do_numero(novo), self.obs.todas)
        self.assertEqual(self.obs.chaves, {CHAVE, CHAVE2})  # a lista do n8n fica a anterior
        self.n8n.falhar = None
        self.gravar("respostas", {"chave": ob.chave_do_numero(novo), "ts": T0, "texto": "oi", "id": "Z1"})
        self.passar(1)
        self.assertEqual(len(self.linhas(ob.chave_do_numero(novo))), 1)

    def test_sem_ler_plus_nao_ha_plus(self):
        obs = ob.Observador({CHAVE}, chamar=self.n8n, avisar=self.avisos.append, relogio=lambda: self.agora,
                            bridge_js=self.bridge, pasta=self.dir / "outro", conversas=self.pasta_conversas)
        self.assertEqual(obs.todas, {CHAVE})
        self.assertFalse(str(ob.PLUS).startswith(str(Path.home() / "prumo-entregas")))


class Papel(unittest.TestCase):
    """17/10/2026: quem escreveu, pela marca no texto (contrato: ausente = gente)."""

    def test_tabela_unica_com_a_central(self):
        # A MESMA tabela do teste do papelDaMensagem (src/operations-marcadores-da-conversa.test.ts): um caso que
        # mude de um lado só falha nos dois. "[Botão]" deixou de ser robô e "[Atendimento" sem "]" também.
        casos = json.loads((AQUI / "papel-da-mensagem.casos.json").read_text(encoding="utf-8"))["casos"]
        self.assertGreater(len(casos), 20)
        for texto, esperado in casos:
            self.assertEqual(ob.papel_da_mensagem(texto), esperado, texto)
        self.assertIsNone(ob.papel_da_mensagem(None))


class MarcadorDeAudio(unittest.TestCase):
    def test_so_marcador_e_texto_com_transcricao(self):
        for t in ("[áudio]", "[áudio 27s]", " [áudio 5s] "):
            self.assertTrue(ob.so_marcador_de_audio(t), t)
        for t in ("[áudio 27s] não", "[audio 27s]", "[áudio27s]", "áudio", "", None, "[imagem]"):
            self.assertFalse(ob.so_marcador_de_audio(t), t)
        self.assertEqual(ob.texto_com_transcricao("[áudio 27s]", " Agradeço, mas no momento não. "),
                         "[áudio 27s] Agradeço, mas no momento não.")
        self.assertEqual(len(ob.texto_com_transcricao("[áudio 9s]", "a" * 5000)), ob.MAX_TEXTO_NA_CONVERSA)

    def test_melhora_o_audio(self):
        self.assertTrue(ob.so_marcador_de_audio("[áudio não transcrito]"))
        self.assertTrue(ob.melhora_o_audio("[áudio não transcrito]", "[áudio 20s] pode falar amanhã"))
        self.assertTrue(ob.melhora_o_audio("[áudio]", "[áudio 27s] não quero"))
        self.assertTrue(ob.melhora_o_audio("[áudio 27s]", "[áudio 27s] não quero"))
        self.assertTrue(ob.melhora_o_audio("[áudio]", "[áudio 27s]"))  # ganhou a duração
        self.assertFalse(ob.melhora_o_audio("[áudio 27s]", "[áudio]"))  # nunca piora
        self.assertFalse(ob.melhora_o_audio("[áudio 27s] não", "[áudio 27s] outra coisa"))  # texto de gente não se troca
        self.assertFalse(ob.melhora_o_audio("oi", "[áudio 27s] oi"))
        self.assertFalse(ob.melhora_o_audio("[áudio 27s]", "[áudio 27s]"))

    def test_ler_transcricao_e_resposta_do_gemini(self):
        self.assertEqual(ob.ler_transcricao("  Agradeço,\n mas  não. "), "Agradeço, mas não.")
        for nada in ("SEM_FALA", " SEM_FALA. ", "", None, "   "):
            self.assertIsNone(ob.ler_transcricao(nada), nada)
        r = {"candidates": [{"content": {"parts": [{"text": "pensando", "thought": True}, {"text": "Oi, "}, {"text": "tudo bem"}]}}]}
        self.assertEqual(ob.texto_da_resposta_gemini(r), "Oi, tudo bem")
        for ruim in ({}, {"candidates": []}, None, {"candidates": [{"content": {}}]}):
            self.assertEqual(ob.texto_da_resposta_gemini(ruim), "")

    def test_dia_de_sao_paulo(self):
        self.assertEqual(ob.dia_de_sao_paulo(T0), "2026-09-30")
        # 02:30 UTC do dia 01/10 ainda é 30/09 em São Paulo; 03:00 UTC já é 01/10.
        meia_noite_sp = 1790823600.0  # 2026-10-01T03:00:00Z
        self.assertEqual(ob.dia_de_sao_paulo(meia_noite_sp - 1800), "2026-09-30")
        self.assertEqual(ob.dia_de_sao_paulo(meia_noite_sp), "2026-10-01")

    def test_motivo_para_nao_transcrever(self):
        bom = {"seg": 27, "msg": {"key": {"id": "A"}, "message": {"audioMessage": {"fileLength": {"low": 48000}}}}}
        self.assertEqual(ob.motivo_para_nao_transcrever(bom), "")
        casos = [(None, "sem_dados"), ({"seg": 3}, "sem_dados"), ({**bom, "seg": 121}, "longo"), ({**bom, "seg": True}, "sem_duracao"),
                 ({**bom, "seg": None}, "sem_duracao"), ({"seg": 3, "msg": {"key": {}, "message": {"audioMessage": {}}}}, "sem_dados"),
                 ({"seg": 3, "msg": {"key": {"id": "A"}, "message": {}}}, "sem_dados"),
                 ({"seg": 3, "msg": {"key": {"id": "A"}, "message": {"audioMessage": {"fileLength": "6000000"}}}}, "grande")]
        for audio, motivo in casos:
            self.assertEqual(ob.motivo_para_nao_transcrever(audio), motivo, audio)


class Contexto(unittest.TestCase):
    def linha(self, t, direcao, texto, id_=None, papel=None):
        return {"em": ob.iso_utc(t), "direcao": direcao, "texto": texto, "origem": "prumo",
                **({"id": id_} if id_ else {}), **({"papel": papel} if papel else {})}

    def test_ultimas_tres_de_cada_lado_e_o_lote_fora(self):
        linhas = [self.linha(T0 - 900, "saida", "Oi! Montei um site para vocês."),
                  self.linha(T0 - 800, "entrada", "*[Bruna]* Quem fala?", "E1", "recepcao"),
                  self.linha(T0 - 700, "saida", ""),  # bridge antiga: saída sem texto não ajuda
                  self.linha(T0 - 600, "entrada", "Agradeço, mas no momento não", "E2"),
                  self.linha(T0 - 500, "saida", "Entendo! Posso mandar o vídeo? Sem compromisso"),
                  self.linha(T0 - 400, "saida", "a" * 900),
                  self.linha(T0 - 300, "saida", "Fico à disposição"),
                  self.linha(T0 - 10, "entrada", "CLaro, pode enviar sim", "L1"),  # o lote
                  self.linha(T0 + 600, "saida", "depois do lote não é a pergunta")]
        ctx = ob.contexto_da_conversa(linhas, ["L1"], T0 - 10, T0 - 10)
        self.assertEqual([s["texto"][:20] for s in ctx["saidas"]],
                         ["Entendo! Posso manda", "a" * 20, "Fico à disposição"])
        self.assertEqual(len(ctx["saidas"][1]["texto"]), ob.CONTEXTO_CORTE)
        self.assertEqual(ctx["anteriores"], [
            {"em": ob.iso_utc(T0 - 800), "texto": "*[Bruna]* Quem fala?", "papel": "recepcao"},
            {"em": ob.iso_utc(T0 - 600), "texto": "Agradeço, mas no momento não"}])

    def test_vazio_e_desordem(self):
        self.assertEqual(ob.contexto_da_conversa([], [], T0, T0), {})
        linhas = [self.linha(T0 - 100, "saida", "segunda"), self.linha(T0 - 200, "saida", "primeira"), {"em": "x", "texto": "ruim"}]
        self.assertEqual([s["texto"] for s in ob.contexto_da_conversa(linhas, [], T0, T0)["saidas"]], ["primeira", "segunda"])


class Transcricao(Base):
    """Áudio de lead (17/10/2026): baixar, transcrever, teto do dia e falhas, com Evolution e Gemini dublês."""

    AUDIO = {"seg": 27, "msg": {"key": {"id": "AUD1", "fromMe": False, "remoteJid": f"{LEAD}@s.whatsapp.net"},
                                "message": {"audioMessage": {"url": "https://x/enc", "mediaKey": "bWVudGlyYQ==",
                                                             "mimetype": "audio/ogg; codecs=opus", "seconds": 27}}}}

    def setUp(self):
        super().setUp()
        self.baixados, self.ao_gemini = [], []
        self.resposta_gemini = "Agradeço, mas no momento não."
        self.erro = None
        self.obs.transcritor = self.transcritor()

    def transcritor(self, **k):
        def baixar(msg, apikey):
            if self.erro:
                raise self.erro
            self.baixados.append((msg["key"]["id"], apikey))
            return b"\x00" * 1000, "audio/ogg; codecs=opus"

        def gemini(dados, mime, chave):
            self.ao_gemini.append((len(dados), mime, chave))
            return self.resposta_gemini
        base = dict(ligado=True, baixar=baixar, gemini=gemini, chave_gemini=lambda: "chave-gemini-falsa",
                    apikey=lambda: "apikey-falsa")
        return ob.Transcritor(self.obs.pasta, relogio=lambda: self.agora, **{**base, **k})

    def escrever(self, *linhas):
        with open(self.obs.pasta / "respostas.jsonl", "a", encoding="utf-8") as f:
            for l in linhas:
                f.write(json.dumps(l, ensure_ascii=False) + "\n")

    def audio(self, id_="AUD1", texto="[áudio 27s]", **k):
        return {"chave": CHAVE, "ts": T0 - 5, "texto": texto, "id": id_,
                "audio": {**self.AUDIO, "msg": {**self.AUDIO["msg"], "key": {**self.AUDIO["msg"]["key"], "id": id_}}, **k}}

    def conversa(self):
        arquivo = self.pasta_conversas / f"{CHAVE}.jsonl"
        return [json.loads(l) for l in arquivo.read_text(encoding="utf-8").splitlines()] if arquivo.exists() else []

    def lotes(self):
        return [c[2] for c in self.n8n.chamadas if c[1] == "whatsapp-resposta"]

    def rodar(self):
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            self.passar(1)
            self.passar(ob.ESPERA_DA_CONVERSA_S)
        return saida.getvalue()

    def test_transcreve_e_grava_na_conversa_e_no_lote(self):
        self.escrever(self.audio())
        journal = self.rodar()
        esperado = "[áudio 27s] Agradeço, mas no momento não."
        self.assertEqual([l["texto"] for l in self.conversa()], [esperado])
        self.assertEqual([m["texto"] for m in self.lotes()[0]["mensagens"]], [esperado])
        self.assertEqual(self.baixados, [("AUD1", "apikey-falsa")])
        self.assertEqual(self.ao_gemini, [(1000, "audio/ogg; codecs=opus", "chave-gemini-falsa")])
        self.assertIn("transcrito", journal)
        for vazou in ("Agradeço", "apikey-falsa", "chave-gemini-falsa", LEAD):
            self.assertNotIn(vazou, journal)
        teto = json.loads((self.obs.pasta / "transcricoes.json").read_text())
        self.assertEqual(teto, {"dia": "2026-09-30", "usadas": 1})
        if os.name != "nt":
            self.assertEqual((self.obs.pasta / "transcricoes.json").stat().st_mode & 0o777, 0o600)

    def test_falhas_gravam_so_o_marcador_e_o_motivo(self):
        casos = [
            (dict(chave_gemini=lambda: None), None, "sem_chave_gemini"),
            (dict(apikey=lambda: None), None, "sem_apikey_evolution"),
            ({}, urllib.error.HTTPError("u", 401, "x", {}, None), "http_401"),
            ({}, TimeoutError(), "tempo_esgotado"),
            ({}, urllib.error.URLError(TimeoutError()), "tempo_esgotado"),
            ({}, urllib.error.URLError("recusada"), "sem_conexao"),
            ({}, ob.AudioGrande(), "grande"),
            ({}, ValueError("json"), "resposta_ilegivel"),
            (dict(ligado=False), None, "desligado"),
        ]
        for i, (k, erro, motivo) in enumerate(casos):
            self.erro = erro
            self.obs.transcritor = self.transcritor(**k)
            self.escrever(self.audio(id_=f"F{i}"))
            journal = self.rodar()
            self.assertIn(f"sem transcrição: {motivo}", journal, motivo)
            self.assertNotIn("apikey-falsa", journal)
        self.assertEqual({l["texto"] for l in self.conversa()}, {"[áudio 27s]"})
        self.assertEqual(len(self.conversa()), len(casos))

    def test_sem_fala_e_audio_longo(self):
        self.resposta_gemini = "SEM_FALA"
        self.escrever(self.audio(id_="S1"))
        self.assertIn("sem transcrição: sem_fala", self.rodar())
        self.escrever(self.audio(id_="S2", texto="[áudio 300s]", seg=300))
        self.assertIn("sem transcrição: longo", self.rodar())
        self.assertEqual(len(self.ao_gemini), 1)  # o longo nem foi baixado
        self.assertEqual([l["texto"] for l in self.conversa()], ["[áudio 27s]", "[áudio 300s]"])

    def test_teto_do_dia_vira_a_meia_noite_de_sao_paulo(self):
        self.obs.transcritor = self.transcritor(teto=2)
        for i in range(3):
            self.escrever(self.audio(id_=f"T{i}"))
        journal = self.rodar()
        self.assertEqual(len(self.baixados), 2)
        self.assertIn("sem transcrição: teto_do_dia", journal)
        self.agora = 1790823600.0 + 60  # 01/10 00:01 em São Paulo
        self.escrever(self.audio(id_="T9"))
        self.rodar()
        self.assertEqual(len(self.baixados), 3)
        self.assertEqual(json.loads((self.obs.pasta / "transcricoes.json").read_text()), {"dia": "2026-10-01", "usadas": 1})

    def test_contador_ilegivel_recomeca_a_conta_do_dia(self):
        # Revisão de 17/10/2026: JSON quebrado de verdade e `usadas` que não é número recomeçam a conta, com o motivo
        # próprio no journal; antes viravam "teto_do_dia" calado e nenhum áudio era ouvido até alguém apagar o arquivo.
        self.obs.pasta.mkdir(parents=True, exist_ok=True)
        conta = self.obs.pasta / "transcricoes.json"
        for i, bruto in enumerate(('{"dia": "2026-09-30", "usadas": 3', '{"dia": "2026-09-30", "usadas": "muitas"}',
                                   '{"dia": "2026-09-30", "usadas": true}', '[1, 2]')):
            conta.write_text(bruto, encoding="utf-8")
            self.escrever(self.audio(id_=f"I{i}"))
            journal = self.rodar()
            self.assertIn("contador_ilegivel", journal, bruto)
            self.assertNotIn("teto_do_dia", journal, bruto)
            self.assertIn("transcrito", journal, bruto)
            self.assertEqual(json.loads(conta.read_text()), {"dia": "2026-09-30", "usadas": 1}, bruto)
        self.assertEqual(len(self.baixados), 4)

    def test_contador_que_nao_grava_nao_gasta(self):
        self.obs.pasta.mkdir(parents=True, exist_ok=True)
        (self.obs.pasta / "transcricoes.json").mkdir()  # nem lê nem grava
        self.escrever(self.audio())
        journal = self.rodar()
        self.assertIn("sem transcrição: contador_sem_gravar", journal)
        self.assertNotIn("teto_do_dia", journal)
        self.assertEqual(self.ao_gemini, [])  # sem conta gravada, o Gemini não é chamado

    def test_download_que_falha_nao_gasta_a_cota(self):
        # A cota só é consumida com o áudio em mãos: Evolution fora do ar ou mídia vencida não gasta o dia.
        self.obs.transcritor = self.transcritor(teto=1)
        self.erro = urllib.error.HTTPError("u", 410, "x", {}, None)
        self.escrever(self.audio(id_="V1"))
        self.assertIn("sem transcrição: http_410", self.rodar())
        self.assertFalse((self.obs.pasta / "transcricoes.json").exists())
        self.erro = None
        self.escrever(self.audio(id_="V2"))
        self.assertIn("transcrito", self.rodar())
        self.assertEqual(json.loads((self.obs.pasta / "transcricoes.json").read_text()), {"dia": "2026-09-30", "usadas": 1})

    def test_transcritor_que_explode_nao_derruba_o_laco(self):
        class Quebrado:
            def transcrever(self, audio):
                raise RuntimeError("boom")
        self.obs.transcritor = Quebrado()
        self.escrever(self.audio(), {"chave": CHAVE, "ts": T0, "texto": "e outra coisa", "id": "X2"})
        self.assertIn("sem transcrição: RuntimeError", self.rodar())
        self.assertEqual([m["texto"] for m in self.lotes()[0]["mensagens"]], ["[áudio 27s]", "e outra coisa"])

    def test_linha_sem_audio_nao_chama_ninguem(self):
        self.escrever({"chave": CHAVE, "ts": T0, "texto": "[áudio]", "id": "B1"})  # a bridge do Hermes
        self.rodar()
        self.assertEqual((self.baixados, self.ao_gemini), ([], []))

    def test_corrida_das_duas_instancias_fica_com_a_transcrita(self):
        pessoal = ob.Conversas(self.pasta_conversas, "pessoal", relogio=lambda: self.agora)
        self.assertTrue(pessoal.anexar(CHAVE, "entrada", T0 - 5, "[áudio]", "AUD1"))
        self.assertTrue(pessoal.anexar(CHAVE, "saida", T0 - 1, "depois", "S9"))
        self.obs.conversa = ob.Conversas(self.pasta_conversas, "prumo", relogio=lambda: self.agora)
        self.escrever(self.audio())
        self.rodar()
        # A linha do áudio é trocada no lugar (a ordem do arquivo fica) e ganha a origem de quem transcreveu.
        self.assertEqual([(l["id"], l["texto"], l["origem"]) for l in self.conversa()],
                         [("AUD1", "[áudio 27s] Agradeço, mas no momento não.", "prumo"), ("S9", "depois", "pessoal")])
        # Na ordem inversa, o "[áudio]" que chega depois não apaga a transcrição.
        self.assertFalse(pessoal.anexar(CHAVE, "entrada", T0 - 5, "[áudio]", "AUD1"))
        self.assertEqual(self.conversa()[0]["texto"], "[áudio 27s] Agradeço, mas no momento não.")

    # ---- revisão de 17/10/2026: no máximo um aviso por áudio (as duas instâncias postam no n8n)

    def duas_instancias(self, transcritor_prumo):
        """A instância do número pessoal (bridge: só "[áudio]", sem `audio`) e a do PRUMO (Evolution: com `audio`),
        a mesma pasta de conversas e o mesmo n8n de mentira, como na Mel."""
        pessoal = self.obs
        pessoal.transcritor = ob.Transcritor(pessoal.pasta, relogio=lambda: self.agora, ligado=False)
        prumo = ob.Observador({CHAVE, CHAVE2}, chamar=self.n8n, avisar=self.avisos.append, relogio=lambda: self.agora,
                              bridge_js=self.bridge, pasta=self.dir / "estado-prumo",
                              conversas=ob.Conversas(self.pasta_conversas, "prumo", relogio=lambda: self.agora),
                              transcritor=transcritor_prumo)
        return pessoal, prumo

    def rodar_as_duas(self, pessoal, prumo, da_bridge, da_evolution):
        for obs, linha in ((pessoal, da_bridge), (prumo, da_evolution)):
            obs.pasta.mkdir(parents=True, exist_ok=True)
            with open(obs.pasta / "respostas.jsonl", "a", encoding="utf-8") as f:
                f.write(json.dumps(linha, ensure_ascii=False) + "\n")
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            for passo in (1, ob.ESPERA_DA_CONVERSA_S):
                self.agora += passo
                pessoal.tick()
                prumo.tick()
        return saida.getvalue()

    def textos_dos_lotes(self):
        return [[m["texto"] for m in l["mensagens"]] for l in self.lotes()]

    def test_audio_transcrito_um_lote_so(self):
        pessoal, prumo = self.duas_instancias(self.transcritor())
        journal = self.rodar_as_duas(pessoal, prumo, {"chave": CHAVE, "ts": T0 - 5, "texto": "[áudio]", "id": "AUD1"}, self.audio())
        self.assertEqual(self.textos_dos_lotes(), [["[áudio 27s] Agradeço, mas no momento não."]])
        self.assertIn("sem ouvinte", journal)
        self.assertEqual([l["texto"] for l in self.conversa()], ["[áudio 27s] Agradeço, mas no momento não."])

    def test_audio_que_nao_foi_transcrito_vai_uma_vez_pela_instancia_que_o_recebeu(self):
        for i, (k, resposta) in enumerate(((dict(chave_gemini=lambda: None), "x"), (dict(teto=0), "x"), ({}, "SEM_FALA"))):
            self.n8n.chamadas.clear()
            self.resposta_gemini = resposta
            pessoal, prumo = self.duas_instancias(self.transcritor(**k))
            self.rodar_as_duas(pessoal, prumo, {"chave": CHAVE, "ts": T0 - 5, "texto": "[áudio]", "id": f"N{i}"}, self.audio(id_=f"N{i}"))
            self.assertEqual(self.textos_dos_lotes(), [["[áudio 27s]"]], k)

    def test_audio_longo_sem_download_tambem_vai_uma_vez(self):
        pessoal, prumo = self.duas_instancias(self.transcritor())
        longo = {"chave": CHAVE, "ts": T0 - 5, "texto": "[áudio 300s]", "id": "LG1", "audio": {"seg": 300}}
        journal = self.rodar_as_duas(pessoal, prumo, {"chave": CHAVE, "ts": T0 - 5, "texto": "[áudio]", "id": "LG1"}, longo)
        self.assertIn("sem transcrição: longo", journal)
        self.assertEqual(self.textos_dos_lotes(), [["[áudio 300s]"]])

    def test_bridge_com_texto_junto_continua_mandando(self):
        # Só o lote SÓ de marcador sem ouvinte fica de fora; com texto junto, a bridge manda como antes.
        self.obs.transcritor = ob.Transcritor(self.obs.pasta, relogio=lambda: self.agora, ligado=False)
        self.escrever({"chave": CHAVE, "ts": T0 - 5, "texto": "[áudio]", "id": "B1"},
                      {"chave": CHAVE, "ts": T0 - 4, "texto": "não temos interesse", "id": "B2"})
        self.rodar()
        self.assertEqual(self.textos_dos_lotes(), [["[áudio]", "não temos interesse"]])

    # ---- auditoria de 19/10/2026 (DELL-1): o mesmo chip pelos dois observadores, um lote só ao n8n

    def test_mesma_mensagem_pelas_duas_instancias_vai_uma_vez_ao_n8n(self):
        pessoal, prumo = self.duas_instancias(self.transcritor())
        msg = {"chave": CHAVE, "ts": T0 - 5, "texto": "não temos interesse", "id": "TX1"}
        self.rodar_as_duas(pessoal, prumo, msg, dict(msg))
        self.assertEqual(self.textos_dos_lotes(), [["não temos interesse"]])
        self.assertEqual([l["texto"] for l in self.conversa()], ["não temos interesse"])

    def test_quem_chega_depois_so_manda_o_que_a_outra_nao_viu(self):
        pessoal, prumo = self.duas_instancias(self.transcritor())
        for obs, ids in ((pessoal, ("A1", "A2")), (prumo, ("A2", "A3"))):
            obs.pasta.mkdir(parents=True, exist_ok=True)
            with open(obs.pasta / "respostas.jsonl", "a", encoding="utf-8") as f:
                for i in ids:
                    f.write(json.dumps({"chave": CHAVE, "ts": T0 - 5, "texto": f"texto {i}", "id": i}) + "\n")
        with contextlib.redirect_stdout(io.StringIO()):
            for passo in (1, ob.ESPERA_DA_CONVERSA_S):
                self.agora += passo
                pessoal.tick()
                prumo.tick()
        textos = sorted(t for lote in self.textos_dos_lotes() for t in lote)
        self.assertEqual(textos, ["texto A1", "texto A2", "texto A3"])  # nenhuma perdida, nenhuma em dobro

    def test_reinicio_reenvia_o_que_a_propria_instancia_gravou(self):
        # A instância gravou na conversa e caiu antes de mandar o lote: o .lendo é relido e a mensagem, que já
        # está no arquivo COM A ORIGEM DELA, ainda vai ao n8n (só a gravada pela outra instância fica de fora).
        self.escrever({"chave": CHAVE, "ts": T0 - 5, "texto": "quero ver", "id": "R1"})
        self.obs.conversa.anexar(CHAVE, "entrada", T0 - 5, "quero ver", "R1")
        self.rodar()
        self.assertEqual(self.textos_dos_lotes(), [["quero ver"]])

    def test_mensagem_gravada_pela_outra_instancia_nao_vai_ao_n8n_daqui(self):
        ob.Conversas(self.pasta_conversas, "prumo", relogio=lambda: self.agora).anexar(CHAVE, "entrada", T0 - 5, "quero ver", "R2")
        self.escrever({"chave": CHAVE, "ts": T0 - 5, "texto": "quero ver", "id": "R2"})
        self.rodar()
        self.assertEqual(self.lotes(), [])
        self.assertEqual(len(self.conversa()), 1)

    def test_numeros_so_no_journal_quando_a_contagem_muda(self):
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            self.passar(ob.RELER_NUMEROS_S)
            self.passar(ob.RELER_NUMEROS_S)
        self.assertNotIn("número(s) de lead", saida.getvalue())  # o n8n de mentira devolve as mesmas duas
        original = self.n8n
        self.obs.chamar = lambda m, c, corpo=None: {"chaves": [CHAVE]} if c == "whatsapp-telefones" else original(m, c, corpo)
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            self.passar(ob.RELER_NUMEROS_S)
        self.assertIn("1 número(s) de lead no filtro", saida.getvalue())

    # ---- revisão de 17/10/2026: reinício no meio da transcrição não perde nada

    def test_queda_no_meio_da_transcricao_nao_perde_nem_duplica(self):
        class Queda(BaseException):
            """O SIGTERM no meio do pedido ao Gemini (não é Exception: nada no caminho o engole)."""
        chamadas = []

        def gemini_que_cai(dados, mime, chave):
            chamadas.append(1)
            if len(chamadas) == 2:
                raise Queda()
            return "Primeiro áudio, ouvido."
        self.obs.transcritor = self.transcritor(gemini=gemini_que_cai)
        self.escrever({"chave": CHAVE, "ts": T0 - 9, "texto": "oi, quem fala?", "id": "Q0"},
                      self.audio(id_="Q1"), self.audio(id_="Q2"),
                      {"chave": CHAVE, "ts": T0 - 3, "texto": "e outra coisa", "id": "Q3"})
        with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(Queda):
            self.passar(1)
        # Tudo na conversa em disco (o texto e os marcadores), e o .lendo continua lá para o próximo início.
        self.assertEqual([l["id"] for l in self.conversa()], ["Q0", "Q1", "Q2", "Q3"])
        self.assertTrue((self.obs.pasta / "respostas.lendo.jsonl").exists())
        self.assertEqual(self.lotes(), [])
        # Reinício: um Observador novo, a mesma pasta; o 1º áudio não é pago de novo, o 2º é transcrito.
        baixados_antes = len(self.baixados)
        self.obs = ob.Observador({CHAVE, CHAVE2}, chamar=self.n8n, avisar=self.avisos.append, relogio=lambda: self.agora,
                                 bridge_js=self.bridge, pasta=self.obs.pasta,
                                 conversas=ob.Conversas(self.pasta_conversas, "pessoal", relogio=lambda: self.agora))
        self.resposta_gemini = "Segundo áudio, ouvido."
        self.obs.transcritor = self.transcritor()
        self.rodar()
        self.assertEqual(len(self.baixados) - baixados_antes, 1)
        self.assertEqual([(l["id"], l["texto"]) for l in self.conversa()],
                         [("Q0", "oi, quem fala?"), ("Q1", "[áudio 27s] Primeiro áudio, ouvido."),
                          ("Q2", "[áudio 27s] Segundo áudio, ouvido."), ("Q3", "e outra coisa")])
        self.assertEqual(self.textos_dos_lotes(), [["oi, quem fala?", "[áudio 27s] Primeiro áudio, ouvido.",
                                                    "[áudio 27s] Segundo áudio, ouvido.", "e outra coisa"]])
        self.assertFalse((self.obs.pasta / "respostas.lendo.jsonl").exists())

    def test_parar_o_servico_com_audio_pendente_deixa_para_o_proximo_inicio(self):
        self.escrever(self.audio(id_="P9"), {"chave": CHAVE, "ts": T0 - 3, "texto": "e mais isto", "id": "P8"})
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            self.obs.ler_respostas(ouvir=False)  # o finally do main
            self.obs.fechar_conversas(todas=True)
            self.obs.mandar_conversas()
        self.assertIn("fica para o próximo início", saida.getvalue())
        self.assertEqual((self.baixados, self.lotes()), ([], []))
        self.assertEqual([l["texto"] for l in self.conversa()], ["[áudio 27s]", "e mais isto"])
        self.assertTrue((self.obs.pasta / "respostas.lendo.jsonl").exists())
        self.rodar()  # o próximo início
        self.assertEqual(self.textos_dos_lotes(), [["[áudio 27s] Agradeço, mas no momento não.", "e mais isto"]])

    def test_papel_na_conversa_e_no_lote(self):
        self.escrever({"chave": CHAVE, "ts": T0 - 5, "texto": "*[Bruna]* Pode mandar sim", "id": "P1"},
                      {"chave": CHAVE, "ts": T0 - 4, "texto": "[Atendimento] Digite 1", "id": "P2"},
                      {"chave": CHAVE, "ts": T0 - 3, "texto": "obrigado", "id": "P3"})
        self.rodar()
        self.assertEqual([l.get("papel") for l in self.conversa()], ["recepcao", "robo", None])
        self.assertEqual([m.get("papel") for m in self.lotes()[0]["mensagens"]], ["recepcao", "robo", None])

    def test_contexto_vai_com_o_lote(self):
        self.obs.conversa.anexar(CHAVE, "entrada", T0 - 3600, "Agradeço, mas no momento não", "N1")
        self.obs.conversa.anexar(CHAVE, "saida", T0 - 60, "Posso mandar o vídeo? Sem compromisso", "S1")
        self.escrever({"chave": CHAVE, "ts": T0 - 5, "texto": "CLaro, pode enviar sim", "id": "R1"})
        self.rodar()
        self.assertEqual(self.lotes()[0]["contexto"], {
            "saidas": [{"em": ob.iso_utc(T0 - 60), "texto": "Posso mandar o vídeo? Sem compromisso"}],
            "anteriores": [{"em": ob.iso_utc(T0 - 3600), "texto": "Agradeço, mas no momento não"}]})


class Download(unittest.TestCase):
    """baixar_da_evolution e transcrever_no_gemini com o urlopen trocado por um dublê: nenhuma rede."""

    class Resposta(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def setUp(self):
        self.pedidos = []
        self._antes = ob.urllib.request.urlopen
        self.corpo = b"{}"

        def urlopen(req, timeout=None):
            self.pedidos.append((req, timeout))
            return self.Resposta(self.corpo)
        ob.urllib.request.urlopen = urlopen

    def tearDown(self):
        ob.urllib.request.urlopen = self._antes

    def test_pede_a_mensagem_inteira_com_a_apikey_no_cabecalho(self):
        import base64
        self.corpo = json.dumps({"mediaType": "audioMessage", "mimetype": "audio/ogg; codecs=opus",
                                 "base64": base64.b64encode(b"OggS1234").decode()}).encode()
        msg = Transcricao.AUDIO["msg"]
        dados, mime = ob.baixar_da_evolution(msg, "apikey-falsa", url="http://127.0.0.1:8081", instancia="prumo")
        self.assertEqual((dados, mime), (b"OggS1234", "audio/ogg; codecs=opus"))
        req, timeout = self.pedidos[0]
        self.assertEqual(req.full_url, "http://127.0.0.1:8081/chat/getBase64FromMediaMessage/prumo")
        self.assertEqual((req.get_method(), req.get_header("Apikey"), timeout), ("POST", "apikey-falsa", ob.TEMPO_DO_AUDIO_S))
        self.assertEqual(json.loads(req.data), {"message": msg, "convertToMp4": False})
        self.assertNotIn("apikey-falsa", req.full_url)

    def test_resposta_sem_audio_ou_grande(self):
        import base64
        for corpo in (b'{"base64": ""}', b"{}", b'{"base64": "@@@"}'):
            self.corpo = corpo
            with self.assertRaises(ob.SemAudio):
                ob.baixar_da_evolution(Transcricao.AUDIO["msg"], "k")
        self.corpo = json.dumps({"base64": base64.b64encode(b"\x00" * (ob.MAX_AUDIO_BYTES + 1)).decode()}).encode()
        with self.assertRaises(ob.AudioGrande):
            ob.baixar_da_evolution(Transcricao.AUDIO["msg"], "k")

    def test_gemini_recebe_o_audio_inline_e_a_chave_no_cabecalho(self):
        self.corpo = json.dumps({"candidates": [{"content": {"parts": [{"text": "Pode mandar sim"}]}}]}).encode()
        self.assertEqual(ob.transcrever_no_gemini(b"OggS", "audio/ogg; codecs=opus", "chave-falsa"), "Pode mandar sim")
        req, _ = self.pedidos[0]
        self.assertIn(f"/models/{ob.MODELO_DA_TRANSCRICAO}:generateContent", req.full_url)
        self.assertEqual(req.get_header("X-goog-api-key"), "chave-falsa")
        self.assertNotIn("chave-falsa", req.full_url)
        partes = json.loads(req.data)["contents"][0]["parts"]
        self.assertEqual(partes[0]["inlineData"]["mimeType"], "audio/ogg")
        self.assertIn("SEM_FALA", partes[1]["text"])


if __name__ == "__main__":
    try:
        unittest.main(verbosity=2)
    finally:
        shutil.rmtree(_CONVERSAS_TESTE, ignore_errors=True)
