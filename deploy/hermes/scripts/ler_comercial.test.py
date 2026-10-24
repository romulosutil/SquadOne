import copy
import importlib.util
import io
import json
from pathlib import Path
import unittest
import urllib.error
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("ler_comercial", Path(__file__).with_name("ler_comercial.py"))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

def dados(resultado="individual"):
    return {"v": 1, "somenteLeitura": True, "contatoAutorizado": False, "resultado": resultado, "fonte": {"geradoEm": "2026-10-24T15:00:00.000Z", "idadeMs": 1000, "limiteMs": 900000, "atual": True}, "total": 1, "truncado": False, "oportunidades": [{"referencia": "a" * 64, "empresa": "Empresa teste", "produto": "site", "etapa": "contato", "autoridade": "qualificacao-nova", "qualificacao": {"estado": "parcial", "confirmacaoHumana": True, "ofertaId": "encontrado", "intencao": "avaliar", "camposConfirmados": {"necessidade": True, "adequacao": True, "intencao": True, "decisao": True, "proximoPasso": False}, "lacunas": ["próximo passo aceito"]}, "ciclo": {"estado": "proposta-enviada", "marcosConfirmados": ["proposta", "proposta_enviada"], "exigeHumano": True}, "responsavel": {"estado": "definido", "quem": "romulo"}, "atendimento": {"presente": True, "tipo": "handoff", "alvo": "operador"}, "bloqueios": ["responsabilidade-humana", "ciclo-comercial"], "proximaAcao": "conferir-com-romulo", "somenteLeitura": True, "contatoAutorizado": False, "ficha": "https://central.test.ts.net:8443/crm?lead=site%3Ateste"}]}

class Resposta:
    def __init__(self, obj=None, status=200, url=None, bruto=None):
        self.bruto = bruto if bruto is not None else json.dumps(obj).encode()
        self.status, self.url = status, url
    def __enter__(self):
        return self
    def __exit__(self, *args):
        return False
    def geturl(self):
        return self.url
    def read(self, tamanho):
        return self.bruto[:tamanho]

class LeituraTests(unittest.TestCase):
    def test_transporte_get_fixo_sem_headers_de_segredos_e_query_codificada(self):
        chamadas = []
        def abrir(req, timeout):
            chamadas.append((req.full_url, req.get_method(), dict(req.header_items()), timeout))
            return Resposta(dados(), url=req.full_url)
        r = m.consultar(nome="Empresa & / teste", abrir=abrir)
        self.assertEqual(r["resultado"], "individual")
        self.assertEqual(chamadas, [(m.URL + "?nome=Empresa+%26+%2F+teste", "GET", {"Accept": "application/json"}, 5)])
        self.assertFalse(r["contatoAutorizado"])

    def test_whitelist_nao_repassa_notas_condicoes_recibos_ou_fone_oculto_em_empresa(self):
        d = dados()
        d["segredo"] = "segredo-fonte"
        item = d["oportunidades"][0]
        item.update({"texto": "texto-privado", "telefone": "5511999991234", "links": {"whatsapp": "https://wa.me/5511999991234"}, "registroTexto": "nota-bruta"})
        item["empresa"] = "Empresa (11) 99999-1234 contato@example.test https://wa.me/5511999991234"
        item["ciclo"].update({"valor": 987654, "recibo": "recibo-privado"})
        item["qualificacao"].update({"evidencia": "evidencia-privada", "fonte": "fonte-privada"})
        texto = json.dumps(m.resposta_segura(d))
        for segredo in ("segredo-fonte", "texto-privado", "5511999991234", "nota-bruta", "987654", "recibo-privado", "evidencia-privada", "fonte-privada", "99999-1234", "contato@example.test", "wa.me"):
            self.assertNotIn(segredo, texto)

    def test_lista_sem_ficha_e_ambiguidade_sem_selecao_automatica(self):
        d = dados("lista")
        self.assertNotIn("ficha", m.resposta_segura(d)["oportunidades"][0])
        d["resultado"] = "ambiguo"
        d["oportunidades"].append(copy.deepcopy(d["oportunidades"][0]))
        self.assertEqual(len(m.resposta_segura(d)["oportunidades"]), 2)
        d["resultado"] = "individual"
        with self.assertRaises(ValueError):
            m.resposta_segura(d)

    def test_ficha_replica_somente_central_na_porta_correta(self):
        self.assertEqual(m.resposta_segura(dados())["oportunidades"][0]["ficha"], dados()["oportunidades"][0]["ficha"])
        d = dados()
        d["oportunidades"][0]["ficha"] = None
        self.assertIsNone(m.resposta_segura(d)["oportunidades"][0]["ficha"])
        for url in ("https://central.test.ts.net/crm?lead=a", "http://central.test.ts.net:8443/crm?lead=a", "https://central.test.ts.net:9119/crm?lead=a", "https://central.test.ts.net:8443/webhook/lead?id=a", "https://u:p@central.test.ts.net:8443/crm?lead=a"):
            with self.subTest(url=url):
                d["oportunidades"][0]["ficha"] = url
                with self.assertRaises(ValueError):
                    m.resposta_segura(d)

    def test_fonte_velha_parcial_invalida_ou_autorizacao_inesperada_falha_fechada(self):
        casos = []
        for chave, valor in (("atual", False), ("idadeMs", 900001), ("idadeMs", -1), ("idadeMs", True), ("limiteMs", 1000000), ("geradoEm", "texto-privado")):
            d = dados(); d["fonte"][chave] = valor; casos.append(d)
        for chave, valor in (("v", 2), ("contatoAutorizado", True), ("somenteLeitura", False), ("resultado", "indisponivel")):
            d = dados(); d[chave] = valor; casos.append(d)
        for d in casos:
            self.assertEqual(m.consultar(abrir=lambda req, timeout: Resposta(d, url=req.full_url))["resultado"], "indisponivel")

    def test_erro_http_timeout_body_grande_json_ruim_nao_tem_fallback_ou_echo(self):
        chamadas = []
        def erro(req, timeout):
            chamadas.append(req)
            raise urllib.error.HTTPError(req.full_url, 503, "segredo-http", {}, None)
        self.assertEqual(m.consultar(abrir=erro)["resultado"], "indisponivel")
        self.assertEqual(len(chamadas), 1)
        for bruto in (b"{" + b"x" * m.MAX_BYTES, b"nao-json", b"\xff"):
            self.assertEqual(m.consultar(abrir=lambda req, timeout: Resposta(bruto=bruto, url=req.full_url))["resultado"], "indisponivel")
        self.assertNotIn("segredo-http", str(m.consultar(abrir=erro)))

    def test_sem_redirecionamento_ou_proxies_do_ambiente(self):
        self.assertIsNone(m.SemRedirecionamento().redirect_request(None, None, 302, "", {}, "http://evil.test"))
        self.assertEqual(m.consultar(abrir=lambda req, timeout: Resposta(dados(), url="http://evil.test"))["resultado"], "indisponivel")
        class FakeOpener:
            def open(self, req, timeout):
                return Resposta(dados(), url=req.full_url)
        with patch.object(m.urllib.request, "build_opener", return_value=FakeOpener()) as construir:
            m.consultar()
            args = construir.call_args.args
            self.assertEqual(args[0].proxies, {})
            self.assertIsInstance(args[1], m.SemRedirecionamento)

    def test_argumentos_invalidos_nao_consultam_e_nao_aceitam_url(self):
        def falhar(*args, **kwargs):
            self.fail("Não deveria consultar")
        for nome, ref in (("a", None), ("ab\ncd", None), ("nome", "a" * 64), (None, "site:id")):
            self.assertEqual(m.consultar(nome, ref, abrir=falhar)["resultado"], "indisponivel")
        with patch("sys.stderr", io.StringIO()), self.assertRaises(SystemExit):
            m.main(["--url", "http://evil.test"])

    def test_opcoes_desconhecidas_nao_viram_texto_livre(self):
        for alvo, chave, valor in (("qualificacao", "estado", "texto-privado"), ("qualificacao", "lacunas", ["texto-privado"]), ("ciclo", "marcosConfirmados", ["recibo-privado"])):
            d = dados(); d["oportunidades"][0][alvo][chave] = valor
            with self.assertRaises(ValueError):
                m.resposta_segura(d)

if __name__ == "__main__":
    unittest.main()
