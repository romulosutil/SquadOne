#!/usr/bin/env python3
"""Testes do servidor da Entrada, com HTTP de verdade em loopback. python3 servidor.test.py

Usa o age para o cofre (sem ele os testes de cofre pulam). Segredos falsos.
"""
import http.client
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
import urllib.parse
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cofre as cofre_mod  # noqa: E402
import entrada as ent_mod  # noqa: E402
import servidor as srv_mod  # noqa: E402

TEM_AGE = bool(shutil.which("age") and shutil.which("age-keygen"))
AGE_FALSA = "AGE-SECRET" + "-KEY-1" + "Q" * 40
NOME_TAILNET = "mel-teste.tail0000.ts.net"


class Base(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="servidor-teste-"))
        self.cofre = None
        if TEM_AGE:
            raiz = self.tmp / "Cofre"
            raiz.mkdir(mode=0o700)
            ident = self.tmp / "mel.txt"
            subprocess.run(["age-keygen", "-o", str(ident)], check=True, capture_output=True)
            pub = subprocess.run(["age-keygen", "-y", str(ident)], check=True, capture_output=True, text=True).stdout.strip()
            (raiz / "recipients.txt").write_text(pub + "\n")
            self.cofre = cofre_mod.Cofre(raiz, ident)
        self.logs = []
        self.ent = ent_mod.Entrada(self.tmp / "Entrada", self.cofre, limite=20 * 1024 * 1024)
        self.srv = srv_mod.Servidor(self.ent, self.cofre, {NOME_TAILNET}, porta=0, logar=self.logs.append)
        self.httpd = self.srv.criar()
        self.porta = self.srv.porta
        self.th = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.th.start()

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        shutil.rmtree(self.tmp, ignore_errors=True)

    # ---- helpers
    def req(self, metodo, caminho, corpo=None, headers=None, host=None, origem="auto"):
        h = {"Host": host if host is not None else f"127.0.0.1:{self.porta}"}
        if origem == "auto" and metodo == "POST":
            h["Origin"] = f"http://127.0.0.1:{self.porta}"
        elif origem not in ("auto", None):
            h["Origin"] = origem
        h.update(headers or {})
        c = http.client.HTTPConnection("127.0.0.1", self.porta, timeout=20)
        c.putrequest(metodo, caminho, skip_host=True, skip_accept_encoding=True)
        for k, v in h.items():
            c.putheader(k, v)
        dados = corpo.encode() if isinstance(corpo, str) else corpo
        if dados is not None:
            c.putheader("Content-Length", str(len(dados)))
        c.endheaders(dados)
        r = c.getresponse()
        body = r.read()
        out = (r.status, dict(r.getheaders()), body)
        c.close()
        return out

    def enviar(self, acao, dados, rotulo="", nome=None, extra=None, **kw):
        h = {"X-Acao": acao, "X-Rotulo": urllib.parse.quote(rotulo)}
        if nome:
            h["X-Nome"] = urllib.parse.quote(nome)
        h.update(extra or {})
        s, hd, b = self.req("POST", "/api/enviar", dados, h, **kw)
        try:
            return s, json.loads(b), hd
        except ValueError:
            return s, b, hd

    def tudo_no_log(self):
        return "\n".join(self.logs)


class Pagina(Base):
    def test_pagina_tem_os_tres_botoes_e_csp_com_o_mesmo_nonce(self):
        s, h, b = self.req("GET", "/")
        self.assertEqual(s, 200)
        html = b.decode()
        for rotulo in ("Guardar no cofre (segredo)", "Organizar", "Só guardar (sem IA)"):
            self.assertIn(rotulo, html)
        self.assertNotIn("__NONCE__", html)
        nonce = h["Content-Security-Policy"].split("script-src 'nonce-")[1].split("'")[0]
        self.assertIn(f'nonce="{nonce}"', html)
        self.assertIn("default-src 'none'", h["Content-Security-Policy"])
        self.assertEqual(h["Cache-Control"], "no-store")
        self.assertEqual(h["X-Frame-Options"], "DENY")
        self.assertNotIn("innerHTML", html, "nada do servidor pode virar HTML")
        self.assertNotIn('style="', html, "CSP com nonce bloqueia style inline")

    def test_nonce_muda_a_cada_pedido(self):
        n = {self.req("GET", "/")[1]["Content-Security-Policy"] for _ in range(3)}
        self.assertEqual(len(n), 3)

    def test_estado_e_healthz_e_404(self):
        s, _, b = self.req("GET", "/api/estado")
        j = json.loads(b)
        self.assertEqual((s, j["limite_mb"], j["pendentes"]), (200, 20, 0))
        if TEM_AGE:
            self.assertEqual(j["cofre"], {"destinatarios": 1, "itens": 0})
            self.assertTrue(any("falta a chave pública" in a for a in j["avisos"]))
        self.assertEqual(self.req("GET", "/healthz")[0], 200)
        self.assertEqual(self.req("GET", "/nao-existe")[0], 404)
        self.assertEqual(self.req("GET", "/api/enviar")[0], 404)

    def test_outros_metodos_nao_passam(self):
        for m in ("PUT", "DELETE", "PATCH", "OPTIONS", "HEAD"):
            self.assertEqual(self.req(m, "/")[0], 405, m)


class Portoes(Base):
    def test_host_de_fora_e_recusado_contra_dns_rebinding(self):
        for host in ("evil.example.com", f"evil.example.com:{self.porta}", "mel-teste.tail0000.ts.net.evil.com", "", "10.0.0.5"):
            self.assertEqual(self.req("GET", "/", host=host)[0], 403, host)
        self.assertEqual(self.req("GET", "/", host=f"{NOME_TAILNET}:10000")[0], 200)
        self.assertEqual(self.req("GET", "/", host=NOME_TAILNET.upper())[0], 200)
        self.assertEqual(self.req("GET", "/", host=f"localhost:{self.porta}")[0], 200)

    def test_origin_obrigatorio_com_host_e_porta_exatos_nas_escritas(self):
        recusadas = [None, "https://evil.example.com", "null", "ftp://127.0.0.1", "http://10.1.1.1",
                     "http://127.0.0.1:9130" if self.porta != 9130 else "http://127.0.0.1:9131",
                     f"https://{NOME_TAILNET}",                            # sem porta = 443: o painel do Hermes, outro site
                     f"https://{NOME_TAILNET}:10000", f"https://{NOME_TAILNET}:8444", "http://127.0.0.1",
                     f"http://localhost:{self.porta + 1}", f"https://{NOME_TAILNET}:abc"]
        for origem in recusadas:
            self.assertEqual(self.enviar("guardar", "oi", origem=origem)[0], 403, origem)
        # a Central repassa a página: 8443 pela tailnet, 9120 no Dell; e o próprio servidor
        for origem in (f"https://{NOME_TAILNET}:8443", "http://127.0.0.1:9120", "http://localhost:9120",
                       f"http://localhost:{self.porta}", f"http://127.0.0.1:{self.porta}"):
            self.assertEqual(self.enviar("guardar", "oi", origem=origem)[0], 200, origem)

    def test_sec_fetch_site_de_outro_site_e_recusado(self):
        self.assertEqual(self.enviar("guardar", "oi", extra={"Sec-Fetch-Site": "cross-site"})[0], 403)
        self.assertEqual(self.enviar("guardar", "oi", extra={"Sec-Fetch-Site": "same-site"})[0], 403)
        self.assertEqual(self.enviar("guardar", "oi", extra={"Sec-Fetch-Site": "same-origin"})[0], 200)

    def test_x_forwarded_for_so_da_tailnet_ou_loopback(self):
        # TODOS os IPs da cadeia contam (o proxy pode acrescentar ou sobrescrever; um IP de fora em qualquer lugar nega)
        for xff in ("8.8.8.8", "lixo", "100.63.0.1", "100.128.0.1", "8.8.8.8, 100.101.102.103", "100.101.102.103, 8.8.8.8",
                    "2001:db8::1", "100.64.0.1,,"):
            self.assertEqual(self.req("GET", "/", headers={"X-Forwarded-For": xff})[0], 403, xff)
        for xff in ("100.101.102.103", "100.64.0.1", "100.127.255.254", "fd7a:115c:a1e0::1", "127.0.0.1", "100.101.102.103, 100.64.0.9"):
            self.assertEqual(self.req("GET", "/", headers={"X-Forwarded-For": xff})[0], 200, xff)
        self.assertEqual(self.req("GET", "/", headers={"Tailscale-Funnel-Request": "?1"})[0], 403)

    def test_ip_permitido(self):
        self.assertTrue(all(srv_mod.ip_permitido(i) for i in ("100.68.136.88", "fd7a:115c:a1e0:ab12::1", "::1", "127.0.0.1")))
        self.assertFalse(any(srv_mod.ip_permitido(i) for i in ("192.168.0.2", "10.0.0.1", "100.200.0.1", "", "x", "8.8.8.8")))

    def test_sem_content_length_ou_em_pedacos(self):
        for extra in (b"", b"Transfer-Encoding: chunked\r\n"):
            s = socket.create_connection(("127.0.0.1", self.porta), timeout=10)
            s.sendall(f"POST /api/enviar HTTP/1.1\r\nHost: 127.0.0.1:{self.porta}\r\nOrigin: http://127.0.0.1:{self.porta}\r\n"
                      f"X-Acao: guardar\r\n".encode() + extra + b"\r\n0\r\n\r\n")
            resp = s.recv(4096).decode()
            s.close()
            self.assertRegex(resp, r"HTTP/1.1 (411|501)")


class Envio(Base):
    def test_organizar_texto_limpo(self):
        s, j, _ = self.enviar("organizar", "Ligar para o cliente na terça.", rotulo="lembrete")
        self.assertEqual((s, j["ok"]), (200, True))
        self.assertEqual(len(self.ent.pendentes()), 1)

    def test_organizar_com_age_falsa_e_bloqueado_422_sem_eco_e_sem_log(self):
        s, j, hd = self.enviar("organizar", f"chave:\n{AGE_FALSA}\n", rotulo="MARCADOR-ROTULO-123", nome="chave-teste.txt")
        self.assertEqual(s, 422)
        self.assertTrue(j["bloqueado"])
        self.assertIn("age-chave-secreta", j["regras"])
        self.assertEqual(hd.get("Connection"), "close")
        self.assertNotIn(AGE_FALSA, json.dumps(j))
        self.assertNotIn(AGE_FALSA, self.tudo_no_log())
        self.assertEqual(list(self.ent.chegou.iterdir()), [])
        self.assertEqual(self.ent.pendentes(), [])

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_cofre_cifra_e_o_valor_nao_volta_nem_vai_ao_log(self):
        s, j, _ = self.enviar("cofre", f"{AGE_FALSA}\n", rotulo="MARCADOR-ROTULO-456", nome="chave-teste.txt")
        self.assertEqual((s, j["ok"]), (200, True))
        self.assertNotIn(AGE_FALSA, json.dumps(j))
        self.assertNotIn(AGE_FALSA, self.tudo_no_log())
        self.assertNotIn("MARCADOR-ROTULO-456", self.tudo_no_log(), "nem o rótulo vai para log")
        self.assertNotIn("chave-teste", self.tudo_no_log(), "nem o nome do arquivo")
        self.assertEqual(self.cofre.ler(j["id"]).decode(), f"{AGE_FALSA}\n")
        self.assertEqual(self.req("GET", "/api/estado")[0], 200)

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_cofre_sem_rotulo_400(self):
        s, j, _ = self.enviar("cofre", "valor")
        self.assertEqual(s, 400)

    @unittest.skipUnless(TEM_AGE, "age não instalado")
    def test_segundo_clique_pelo_http(self):
        texto = "migrar o servidor\nsenha: s3nh4-Forte-9X\nfim"
        s, j, _ = self.enviar("organizar", texto)
        self.assertEqual((s, j["bloqueado"], j["pode_redigir"]), (422, True, True))
        s, j, _ = self.enviar("organizar", texto, extra={"X-Com-Cofre": "1"})
        self.assertEqual(s, 200)
        self.assertEqual(len(j["segredos_no_cofre"]), 1)
        self.assertNotIn("s3nh4-Forte-9X", self.ent.pendentes()[0]["texto"])

    def test_guardar_sem_ia(self):
        s, j, _ = self.enviar("guardar", "uma ideia", nome="ideia.txt")
        self.assertEqual((s, j["ok"]), (200, True))
        self.assertEqual(self.ent.pendentes(), [])

    def test_acao_invalida_e_vazio(self):
        self.assertEqual(self.enviar("apagar", "x")[0], 400)
        self.assertEqual(self.enviar("organizar", b"")[0], 400)

    def test_acima_do_limite_413_sem_ler_o_corpo_e_fecha_a_conexao(self):
        # só os cabeçalhos: o servidor tem que responder 413 antes de qualquer byte do corpo
        s = socket.create_connection(("127.0.0.1", self.porta), timeout=10)
        s.sendall(f"POST /api/enviar HTTP/1.1\r\nHost: 127.0.0.1:{self.porta}\r\nOrigin: http://127.0.0.1:{self.porta}\r\n"
                  f"X-Acao: organizar\r\nContent-Length: {20 * 1024 * 1024 + 1}\r\n\r\n".encode())
        resp = s.recv(8192).decode()
        s.close()
        self.assertIn("HTTP/1.1 413", resp)
        self.assertIn("Connection: close", resp)
        self.assertEqual(list(self.ent.chegou.iterdir()), [])

    def test_arquivo_binario_grande_em_fluxo(self):
        dados = b"\x00" + (b"abcdefghij" * 800_000)          # 8 MB, acima do limite de texto
        s, j, _ = self.enviar("organizar", dados, nome="grande.bin")
        self.assertEqual((s, j["ok"]), (200, True))
        it = self.ent.pendentes()[0]
        self.assertEqual((self.ent.chegou / it["arquivo"]).stat().st_size, len(dados))

    def test_erro_interno_nao_vaza_texto_da_excecao(self):
        def quebra(*a, **k):
            raise RuntimeError(f"vazou {AGE_FALSA}")
        self.ent.receber = quebra
        s, j, _ = self.enviar("organizar", "x")
        self.assertEqual(s, 500)
        self.assertNotIn(AGE_FALSA, json.dumps(j))
        self.assertNotIn(AGE_FALSA, self.tudo_no_log())
        self.assertIn("RuntimeError", self.tudo_no_log())

    def test_log_nao_tem_query_nem_cabecalhos(self):
        self.req("GET", "/api/estado?token=SEGREDO-NA-QUERY")
        self.assertNotIn("SEGREDO-NA-QUERY", self.tudo_no_log())


class Revisao_de_seguranca(Base):
    """O que a revisão adversarial de 04/10 conseguiu quebrar no servidor, agora como teste."""

    def raw(self, dados: bytes, espera=3.0, porta=None) -> bytes:
        s = socket.create_connection(("127.0.0.1", porta or self.porta), timeout=espera)
        s.sendall(dados)
        out = b""
        try:
            while True:
                c = s.recv(65536)
                if not c:
                    break
                out += c
        except socket.timeout:
            pass
        s.close()
        return out

    def cab(self, extra=""):
        return (f"Host: 127.0.0.1:{self.porta}\r\nOrigin: http://127.0.0.1:{self.porta}\r\n{extra}")

    def test_get_com_corpo_nao_contrabandeia_um_post(self):
        escondido = (f"POST /api/enviar HTTP/1.1\r\n{self.cab('X-Acao: guardar\r\nContent-Length: 7\r\n')}\r\ncontrab")
        req = (f"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1:{self.porta}\r\nContent-Length: {len(escondido)}\r\n\r\n" + escondido).encode()
        out = self.raw(req)
        self.assertIn(b"400", out.split(b"\r\n")[0])
        self.assertEqual(out.count(b"HTTP/1.1"), 1, "uma resposta só: o pedido de dentro nunca foi lido")
        self.assertEqual(list(self.ent.chegou.iterdir()), [])
        # o mesmo vale para os métodos que respondem 405
        out2 = self.raw(f"PUT / HTTP/1.1\r\nHost: 127.0.0.1:{self.porta}\r\nContent-Length: 3\r\n\r\nabc".encode())
        self.assertIn(b"400", out2.split(b"\r\n")[0])

    def test_content_length_so_com_digitos_e_um_so(self):
        for v in ("+2", "0_2", " 2 ", "2, 2", "-1", "99999999999999", "0x2", "2.0", ""):
            out = self.raw(f"POST /api/enviar HTTP/1.1\r\n{self.cab('X-Acao: guardar\r\n')}Content-Length:{v}\r\n\r\noi".encode())
            self.assertRegex(out.split(b"\r\n")[0].decode(), r"HTTP/1.1 (400|411)", repr(v))
        dup = self.raw(f"POST /api/enviar HTTP/1.1\r\n{self.cab('X-Acao: guardar\r\n')}Content-Length: 2\r\nContent-Length: 2\r\n\r\noi".encode())
        self.assertIn(b"400", dup.split(b"\r\n")[0])
        self.assertEqual(list(self.ent.chegou.iterdir()), [])

    def test_options_nunca_devolve_cabecalhos_de_cors(self):
        for origem in (None, "https://evil.example.com", f"http://127.0.0.1:{self.porta}"):
            h = {"Origin": origem} if origem else {}
            s, hd, _ = self.req("OPTIONS", "/api/enviar", headers=h, origem=None)
            self.assertEqual(s, 405)
            self.assertEqual([k for k in hd if k.lower().startswith("access-control-")], [])

    def test_pagina_de_erro_padrao_tambem_sai_com_csp(self):
        out = self.raw(f"BREW / HTTP/1.1\r\nHost: 127.0.0.1:{self.porta}\r\n\r\n".encode())
        self.assertIn(b"501", out.split(b"\r\n")[0])
        self.assertIn(b"Content-Security-Policy", out)
        self.assertIn(b"no-store", out)

    def test_log_nunca_leva_o_caminho_desconhecido(self):
        self.req("GET", "/" + "AGE-SECRET" + "-KEY-1" + "Q" * 40)
        self.assertNotIn("AGE-SECRET", self.tudo_no_log())
        self.assertIn("<outro>", self.tudo_no_log())
        self.req("GET", "/healthz")
        self.assertIn("/healthz 200", self.tudo_no_log())

    def test_slowloris_perde_a_vaga_no_prazo_total(self):
        original = srv_mod.prazo_do_envio
        srv_mod.prazo_do_envio = lambda n: 1.0
        try:
            s = socket.create_connection(("127.0.0.1", self.porta), timeout=10)
            s.sendall(f"POST /api/enviar HTTP/1.1\r\n{self.cab('X-Acao: guardar\r\nContent-Length: 1000000\r\n')}\r\nx".encode())
            time.sleep(1.5)
            s.sendall(b"y")                                   # chega depois do prazo: a leitura volta ao laço e recusa
            out = b""
            try:
                while True:
                    c = s.recv(65536)
                    if not c:
                        break
                    out += c
            except socket.timeout:
                pass
            s.close()
            self.assertIn(b"408", out.split(b"\r\n")[0])
            self.assertEqual(list(self.ent.chegou.iterdir()), [])
            # a vaga voltou: o próximo envio funciona
            self.assertEqual(self.enviar("guardar", "oi", nome="a.txt")[0], 200)
        finally:
            srv_mod.prazo_do_envio = original

    def test_prazo_do_envio_escala_com_o_tamanho(self):
        self.assertEqual(srv_mod.prazo_do_envio(1000), 120.0)
        self.assertEqual(srv_mod.prazo_do_envio(10_000_000), 200.0)
        self.assertEqual(srv_mod.prazo_do_envio(200 * 1024 * 1024), 3600.0)

    def test_teto_de_conexoes_fecha_a_que_passa_do_limite(self):
        srv = srv_mod.Servidor(self.ent, self.cofre, {NOME_TAILNET}, porta=0, logar=self.logs.append, limite_conexoes=2)
        httpd = srv.criar()
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        try:
            ociosas = [socket.create_connection(("127.0.0.1", srv.porta), timeout=5) for _ in range(2)]
            time.sleep(0.3)
            terceira = socket.create_connection(("127.0.0.1", srv.porta), timeout=5)
            terceira.sendall(b"GET /healthz HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
            self.assertEqual(terceira.recv(100), b"", "sem vaga: a conexão é fechada sem resposta")
            terceira.close()
            for s in ociosas:
                s.close()
            time.sleep(0.5)
            c = http.client.HTTPConnection("127.0.0.1", srv.porta, timeout=5)           # com vaga de novo
            c.request("GET", "/healthz", headers={"Host": f"127.0.0.1:{srv.porta}"})
            self.assertEqual(c.getresponse().status, 200)
            c.close()
        finally:
            httpd.shutdown()
            httpd.server_close()

    def test_nome_da_tailnet_que_faltou_no_boot_e_relido(self):
        srv = srv_mod.Servidor(self.ent, self.cofre, set(), porta=0, logar=self.logs.append, reler_nome_a_cada_s=0)
        httpd = srv.criar()
        threading.Thread(target=httpd.serve_forever, daemon=True).start()
        original = srv_mod.nome_da_mel_na_tailnet
        try:
            def pega(host):
                c = http.client.HTTPConnection("127.0.0.1", srv.porta, timeout=5)
                c.request("GET", "/healthz", headers={"Host": host})
                r = c.getresponse()
                r.read()
                c.close()
                return r.status
            srv_mod.nome_da_mel_na_tailnet = lambda: None
            self.assertEqual(pega("mel-tardia.tail1.ts.net:10000"), 403)
            srv_mod.nome_da_mel_na_tailnet = lambda: "mel-tardia.tail1.ts.net"
            self.assertEqual(pega("mel-tardia.tail1.ts.net:10000"), 200)
            self.assertEqual(pega("outro.ts.net"), 403)
        finally:
            srv_mod.nome_da_mel_na_tailnet = original
            httpd.shutdown()
            httpd.server_close()

    def test_sem_nome_nenhum_o_servidor_sai_para_o_systemd_tentar_de_novo(self):
        original = srv_mod.descobrir_nomes
        srv_mod.descobrir_nomes = lambda *a, **k: set()
        try:
            self.assertEqual(srv_mod.principal(), 1)
        finally:
            srv_mod.descobrir_nomes = original

    def test_a_pagina_continua_respondendo_durante_um_envio_pesado(self):
        # o filtro roda em thread do servidor: se ele segurasse o interpretador por segundos, nem /healthz responderia
        pesado = ("mysql " * 150_000)[:900_000] + "\nfind . -path x\n" + ("token=abcd\n" * 60_000)
        resultado = {}

        def envia():
            ini = time.time()
            resultado["status"] = self.enviar("guardar", pesado, nome="pesado.txt")[0]
            resultado["dur"] = time.time() - ini
        th = threading.Thread(target=envia)
        th.start()
        piores = []
        while th.is_alive():
            ini = time.time()
            s, _, _ = self.req("GET", "/healthz")
            piores.append(time.time() - ini)
            self.assertEqual(s, 200)
            time.sleep(0.02)
        th.join()
        self.assertEqual(resultado["status"], 422, "token=abcd... é segredo: bloqueado")
        self.assertLess(resultado["dur"], 15)
        self.assertLess(max(piores), 1.5, f"o /healthz demorou {max(piores):.2f} s durante o envio")

    def test_a_vaga_de_conexao_volta_quando_a_thread_nao_sobe(self):
        srv = srv_mod.Servidor(self.ent, self.cofre, {NOME_TAILNET}, porta=0, logar=self.logs.append, limite_conexoes=1)
        httpd = srv.criar()
        try:
            from unittest import mock
            with mock.patch("socketserver.ThreadingMixIn.process_request", side_effect=RuntimeError("can't start new thread")):
                with self.assertRaises(RuntimeError):
                    httpd.process_request(mock.Mock(), ("127.0.0.1", 1))
            self.assertTrue(httpd._vagas.acquire(blocking=False), "a vaga não pode ter ficado presa")
        finally:
            httpd.server_close()

    def test_envio_em_pedacos_lentos_mas_dentro_do_prazo_funciona(self):
        s = socket.create_connection(("127.0.0.1", self.porta), timeout=10)
        corpo = b"texto enviado em tres pedacos"
        s.sendall(f"POST /api/enviar HTTP/1.1\r\n{self.cab(f'X-Acao: guardar\r\nContent-Length: {len(corpo)}\r\n')}\r\n".encode())
        for i in range(0, len(corpo), 10):
            s.sendall(corpo[i:i + 10])
            time.sleep(0.1)
        out = s.recv(65536)
        s.close()
        self.assertIn(b"200", out.split(b"\r\n")[0])


if __name__ == "__main__":
    unittest.main(verbosity=1)
