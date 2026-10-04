#!/usr/bin/env python3
"""Servidor da Entrada: a página privada onde o Rômulo manda texto e arquivos.

Escuta SÓ em 127.0.0.1 (porta 9130). Quem expõe na tailnet é o `tailscale serve`
(um listener HTTPS próprio; nunca funnel). Mesmo assim o servidor se defende:

- só aceita conexão de loopback (é de onde o tailscale serve chega);
- confere o cabeçalho Host (contra DNS rebinding): só o nome da Mel na tailnet e loopback;
- nas escritas exige Origin com host E PORTA exatos: a da Central que repassa a página (8443 pela tailnet,
  9120 no Dell) ou a do próprio servidor; qualquer outro site ou porta não passa. Sec-Fetch-Site
  same-origin quando o navegador manda; os
  cabeçalhos próprios (X-Acao) travam o envio de outro site, e o servidor não responde a CORS;
- se vier X-Forwarded-For, TODOS os IPs da cadeia têm que ser da tailnet (100.64.0.0/10,
  fd7a:115c:a1e0::/48) ou loopback; pedido marcado como Funnel é recusado;
- só Content-Length (um só, só dígitos; nada de chunked) e métodos sem corpo não podem trazer
  corpo (senão um GET contrabandearia um POST pela conexão);
- limite de 200 MB por envio, no máximo 3 envios ao mesmo tempo, prazo total por envio (vazão
  mínima de ~50 KB/s) e teto de 32 conexões; o corpo é lido em fluxo, nunca inteiro na memória;
- NUNCA mostra segredo de volta, e nada do conteúdo, do rótulo, do nome ou de caminho desconhecido
  vai para log (só método, rota conhecida, status e tamanho).

O envio é um POST /api/enviar com o corpo cru (texto ou o arquivo) e os dados em
cabeçalhos: X-Acao (cofre | organizar | guardar), X-Rotulo e X-Nome (com
percent-encoding), X-Com-Cofre: 1 (só o segundo clique).
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import secrets
import signal
import subprocess
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Callable

sys.path.insert(0, str(Path(__file__).resolve().parent))
import cofre as cofre_mod  # noqa: E402
import entrada as entrada_mod  # noqa: E402

TAILNET_V4 = ipaddress.ip_network("100.64.0.0/10")
TAILNET_V6 = ipaddress.ip_network("fd7a:115c:a1e0::/48")
LOOPBACK = {"127.0.0.1", "::1", "localhost"}
SIMULTANEOS = 3
CONEXOES = 32
ROTAS_CONHECIDAS = {"/", "/api/estado", "/healthz", "/api/enviar"}
# A página é aberta pela Central (menu "Entrada", server/entrada-proxy.ts): no Dell em 127.0.0.1:9120 e pela tailnet
# em :8443. Essas são as únicas origens (além da própria porta) que podem escrever; qualquer outro site/porta não.
PORTAS_TAILNET = {8443, 9120}
PAGINA = Path(__file__).with_name("pagina.html")


def ip_permitido(txt: str) -> bool:
    try:
        ip = ipaddress.ip_address(txt.strip())
    except ValueError:
        return False
    if ip.is_loopback:
        return True
    return ip in TAILNET_V4 or ip in TAILNET_V6


def prazo_do_envio(tamanho: int) -> float:
    """Segundos que um envio de `tamanho` bytes pode levar: vazão mínima de ~50 KB/s, de 2 min a 1 h."""
    return min(3600.0, max(120.0, tamanho / 50_000))


def nome_da_mel_na_tailnet() -> str | None:
    try:
        r = subprocess.run(["tailscale", "status", "--json"], capture_output=True, text=True, timeout=10)
        dns = json.loads(r.stdout)["Self"]["DNSName"].rstrip(".")
        return dns.lower() or None
    except Exception:  # noqa: BLE001
        return None


class _Leitor:
    """Lê o corpo do pedido com prazo total: slowloris (um byte a cada 59 s) não segura uma vaga para sempre."""

    def __init__(self, rfile, tamanho: int):
        self.rfile = rfile
        self.limite = time.monotonic() + prazo_do_envio(tamanho)

    def read(self, n: int) -> bytes:
        """Em pedaços de até 64 KB (read1) e conferindo o prazo a cada volta: `read(n)` de 1 MB só voltaria
        com 1 MB inteiro, e um cliente pingando 1 byte por minuto escaparia do prazo."""
        partes: list[bytes] = []
        falta = n
        while falta > 0:
            if time.monotonic() > self.limite:
                raise entrada_mod.Recusado(408, "O envio está lento demais: tente de novo.")
            p = self.rfile.read1(min(falta, 65536))
            if not p:
                break
            partes.append(p)
            falta -= len(p)
        return b"".join(partes)


class _Http(ThreadingHTTPServer):
    allow_reuse_address = True
    daemon_threads = True

    def __init__(self, *a, limite_conexoes: int = CONEXOES, **k):
        self._vagas = threading.BoundedSemaphore(limite_conexoes)
        super().__init__(*a, **k)

    def process_request(self, request, client_address):
        if not self._vagas.acquire(blocking=False):          # sem vaga: fecha na hora, sem criar thread
            self.shutdown_request(request)
            return
        try:
            super().process_request(request, client_address)
        except BaseException:                                # a thread não subiu (TasksMax...): devolve a vaga
            self._vagas.release()
            raise

    def process_request_thread(self, request, client_address):
        try:
            super().process_request_thread(request, client_address)
        finally:
            self._vagas.release()


class Servidor:
    def __init__(self, entrada: entrada_mod.Entrada, cofre: cofre_mod.Cofre | None, nomes: set[str],
                 bind: str = "127.0.0.1", porta: int = 9130, logar: Callable[[str], None] | None = None,
                 limite_conexoes: int = CONEXOES, portas_tailnet: set[int] | None = None,
                 reler_nome_a_cada_s: float = 60.0):
        self.entrada = entrada
        self.cofre = cofre
        self.nomes = {n.lower() for n in nomes} | LOOPBACK
        self.bind = bind
        self.porta = porta
        self.logar = logar or (lambda linha: print(linha, file=sys.stderr, flush=True))
        self.livres = threading.BoundedSemaphore(SIMULTANEOS)
        self.pagina = PAGINA.read_text(encoding="utf-8")
        self.limite_conexoes = limite_conexoes
        self.portas_tailnet = set(portas_tailnet if portas_tailnet is not None else PORTAS_TAILNET)
        self.reler_nome_a_cada_s = reler_nome_a_cada_s
        self._ultima_leitura_do_nome = time.monotonic()
        self._trava_nome = threading.Lock()
        self.httpd: _Http | None = None

    # -------------------------------------------------------------- nome da tailnet
    def recarregar_nome(self) -> bool:
        """Se o nome da Mel na tailnet não foi lido no boot (o tailscaled ainda subia), tenta de novo,
        no máximo uma vez por minuto. Devolve True se apareceu um nome novo."""
        with self._trava_nome:
            if time.monotonic() - self._ultima_leitura_do_nome < self.reler_nome_a_cada_s:
                return False
            self._ultima_leitura_do_nome = time.monotonic()
        dns = nome_da_mel_na_tailnet()
        if dns and dns not in self.nomes:
            self.nomes.add(dns)
            self.logar(f"nome da tailnet lido: {dns}")
            return True
        return False

    # -------------------------------------------------------------- estado
    def estado(self) -> dict:
        d = {"limite_mb": self.entrada.limite // (1024 * 1024), "pendentes": len(self.entrada.pendentes()),
             "cofre": None, "avisos": []}
        if self.cofre is not None:
            try:
                s = self.cofre.status()
                d["cofre"] = s
                if s["destinatarios"] < 2:
                    d["avisos"].append("O cofre só abre aqui na Mel: falta a chave pública (age1…) do Rômulo em recipients.txt.")
            except cofre_mod.CofreErro as ex:
                d["avisos"].append(f"Cofre indisponível: {ex}")
        else:
            d["avisos"].append("Cofre não configurado.")
        return d

    # ------------------------------------------------------------ handler
    def _handler(self):
        srv = self

        class H(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            timeout = 60
            server_version = "Entrada"
            sys_version = ""
            _com_cabecalhos = False

            def log_message(self, *a):          # nada do log padrão: ele escreve a linha do pedido
                pass

            def handle_one_request(self):
                self._com_cabecalhos = False
                super().handle_one_request()

            def _log(self, status, extra=""):
                caminho = self.path.split("?", 1)[0]
                caminho = caminho if caminho in ROTAS_CONHECIDAS else "<outro>"   # o caminho pode ser um segredo colado na URL
                srv.logar(f"{self.command} {caminho} {status}{(' ' + extra) if extra else ''}")

            # ----- respostas
            def _cabecalhos_comuns(self, nonce=None):
                self._com_cabecalhos = True
                self.send_header("Cache-Control", "no-store")
                self.send_header("X-Content-Type-Options", "nosniff")
                self.send_header("Referrer-Policy", "no-referrer")
                self.send_header("X-Frame-Options", "DENY")
                csp = "default-src 'none'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"
                if nonce:
                    csp += f"; script-src 'nonce-{nonce}'; style-src 'nonce-{nonce}'"
                self.send_header("Content-Security-Policy", csp)

            def end_headers(self):               # também as páginas de erro padrão (501...) saem com CSP e no-store
                if not self._com_cabecalhos:
                    self._cabecalhos_comuns()
                super().end_headers()

            def _json(self, status, corpo, fechar=False):
                dados = json.dumps(corpo, ensure_ascii=False).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Length", str(len(dados)))
                if fechar:
                    self.send_header("Connection", "close")
                    self.close_connection = True
                self._cabecalhos_comuns()
                self.end_headers()
                self.wfile.write(dados)
                self._log(status)

            def _erro(self, status, msg):
                self._json(status, {"ok": False, "mensagem": msg}, fechar=True)

            # ----- portões
            def _nome_do_host(self) -> str:
                try:
                    return (urllib.parse.urlsplit("//" + (self.headers.get("Host") or "")).hostname or "").lower()
                except ValueError:
                    return ""

            def _origem_ok(self, origem: str) -> bool:
                try:
                    u = urllib.parse.urlsplit(origem)
                    porta = u.port
                except ValueError:
                    return False
                if u.scheme not in ("http", "https") or (u.hostname or "").lower() not in srv.nomes:
                    return False
                return porta is not None and (porta in srv.portas_tailnet or porta == srv.porta)   # sem porta = 443: é o painel do Hermes, outro site

            def _portao(self, escrita: bool) -> bool:
                if self.client_address[0] not in ("127.0.0.1", "::1"):
                    self._erro(403, "Só pela tailnet.")
                    return False
                if self._nome_do_host() not in srv.nomes and not (srv.recarregar_nome() and self._nome_do_host() in srv.nomes):
                    self._erro(403, "Host não permitido.")
                    return False
                if self.headers.get("Tailscale-Funnel-Request"):
                    self._erro(403, "Só pela tailnet.")
                    return False
                xff = self.headers.get("X-Forwarded-For")
                if xff and not all(ip_permitido(ip) for ip in xff.split(",")):
                    self._erro(403, "Origem fora da tailnet.")
                    return False
                if escrita:
                    origem = self.headers.get("Origin")
                    if not origem:
                        self._erro(403, "Origem ausente.")
                        return False
                    if not self._origem_ok(origem):
                        self._erro(403, "Origem não permitida.")
                        return False
                    sfs = self.headers.get("Sec-Fetch-Site")
                    if sfs and sfs not in ("same-origin", "none"):
                        self._erro(403, "Pedido de outro site.")
                        return False
                return True

            def _sem_corpo(self) -> bool:
                """Método sem corpo que traz corpo é tentativa de contrabandear um pedido na mesma conexão."""
                cl = self.headers.get_all("Content-Length") or []
                if self.headers.get("Transfer-Encoding") or any(v.strip() not in ("", "0") for v in cl):
                    self._erro(400, "Este método não aceita corpo.")
                    return False
                return True

            # ----- métodos
            def do_GET(self):
                if not self._sem_corpo() or not self._portao(False):
                    return
                caminho = self.path.split("?", 1)[0]
                if caminho == "/":
                    nonce = secrets.token_urlsafe(16)
                    dados = srv.pagina.replace("__NONCE__", nonce).encode()
                    self.send_response(200)
                    self.send_header("Content-Type", "text/html; charset=utf-8")
                    self.send_header("Content-Length", str(len(dados)))
                    self._cabecalhos_comuns(nonce)
                    self.end_headers()
                    self.wfile.write(dados)
                    self._log(200)
                elif caminho == "/api/estado":
                    self._json(200, srv.estado())
                elif caminho == "/healthz":
                    self._json(200, {"ok": True})
                else:
                    self._erro(404, "Não existe.")

            def _tamanho(self) -> int | None:
                valores = self.headers.get_all("Content-Length") or []
                if len(valores) != 1 or not re.fullmatch(r"\d{1,12}", valores[0]):
                    self._erro(411 if not valores else 400, "Falta um Content-Length só, com dígitos." if not valores
                               else "Content-Length inválido.")
                    return None
                return int(valores[0])

            def do_POST(self):
                if self.path.split("?", 1)[0] != "/api/enviar":
                    self._erro(404, "Não existe.")
                    return
                if not self._portao(True):
                    return
                if self.headers.get("Transfer-Encoding"):
                    self._erro(501, "Envio em partes não é aceito: mande com Content-Length.")
                    return
                tamanho = self._tamanho()
                if tamanho is None:
                    return
                if not srv.livres.acquire(blocking=False):
                    self._erro(429, "Muitos envios ao mesmo tempo. Tente de novo em instantes.")
                    return
                try:
                    acao = self.headers.get("X-Acao", "")
                    rotulo = urllib.parse.unquote(self.headers.get("X-Rotulo", ""))
                    nome = urllib.parse.unquote(self.headers.get("X-Nome", "")) or None
                    com_cofre = self.headers.get("X-Com-Cofre") == "1"
                    try:
                        res = srv.entrada.receber(acao, _Leitor(self.rfile, tamanho), tamanho, rotulo, nome, com_cofre)
                    except entrada_mod.Recusado as r:
                        self._json(r.codigo, {"ok": False, "mensagem": r.mensagem, **r.extra}, fechar=True)
                        return
                    except Exception as ex:  # noqa: BLE001  (nunca o texto da exceção: pode ter conteúdo)
                        srv.logar(f"erro interno em /api/enviar: {type(ex).__name__}")
                        self._erro(500, "Algo deu errado aqui. Nada foi mostrado nem enviado a modelo.")
                        return
                    self._json(200, res)
                finally:
                    srv.livres.release()

            def _nao_permitido(self):
                if not self._sem_corpo():
                    return
                self._erro(405, "Método não permitido.")
            do_PUT = do_DELETE = do_PATCH = do_OPTIONS = do_HEAD = _nao_permitido

        return H

    # -------------------------------------------------------------- ciclo
    def criar(self) -> _Http:
        self.httpd = _Http((self.bind, self.porta), self._handler(), limite_conexoes=self.limite_conexoes)
        self.porta = self.httpd.server_address[1]
        return self.httpd


def descobrir_nomes(tentativas: int = 6, espera_s: float = 5.0) -> set[str]:
    """Nome da Mel na tailnet, com algumas tentativas (no boot o tailscaled pode ainda estar subindo)."""
    nomes = {n.strip() for n in os.environ.get("ENTRADA_NOMES", "").split(",") if n.strip()}
    for n in range(tentativas):
        dns = nome_da_mel_na_tailnet()
        if dns:
            nomes.add(dns)
            break
        if n < tentativas - 1:
            time.sleep(espera_s)
    return nomes


def portas_de_origem() -> set[int]:
    bruto = os.environ.get("ENTRADA_PORTAS_ORIGEM", "")
    portas = {int(p) for p in re.findall(r"\d{1,5}", bruto)}
    return portas or set(PORTAS_TAILNET)


def principal() -> int:
    home = Path.home()
    raiz = Path(os.environ.get("ENTRADA_RAIZ", home / "Mel/Entrada"))
    raiz_cofre = Path(os.environ.get("COFRE_RAIZ", home / "Mel/Cofre"))
    ident = Path(os.environ.get("ENTRADA_IDENTIDADE") or cofre_mod.identidade_padrao(home))
    porta = int(os.environ.get("ENTRADA_PORTA", "9130"))
    nomes = descobrir_nomes()
    if not nomes:                                           # sem nome só a loopback abriria, e a tailnet receberia 403 calada
        print("Entrada: não consegui o nome da Mel na tailnet (tailscale status) e ENTRADA_NOMES está vazio; saio para o systemd tentar de novo.",
              file=sys.stderr, flush=True)
        return 1
    cofre = cofre_mod.Cofre(raiz_cofre, ident) if raiz_cofre.is_dir() else None
    ent = entrada_mod.Entrada(raiz, cofre)
    srv = Servidor(ent, cofre, nomes, porta=porta, portas_tailnet=portas_de_origem())
    httpd = srv.criar()
    srv.logar(f"Entrada em 127.0.0.1:{srv.porta}; nomes aceitos: {', '.join(sorted(srv.nomes - LOOPBACK))}")
    signal.signal(signal.SIGTERM, lambda *_: threading.Thread(target=httpd.shutdown, daemon=True).start())
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    sys.exit(principal())
