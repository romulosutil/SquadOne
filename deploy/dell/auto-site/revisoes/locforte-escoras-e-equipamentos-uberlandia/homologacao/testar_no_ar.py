"""Testes no ar do site da Locforte (rotas, HTTPS, metas, destinos dos botões, erro). Grava JSON datado."""
import datetime, hashlib, html, json, re, ssl, socket, sys, urllib.parse, urllib.request

URL = "https://demo-locforte-escoras-e-equipamento.vercel.app"
saida = sys.argv[1]
r = {"url": URL, "em": datetime.datetime.now().astimezone().isoformat(timespec="seconds"), "casos": []}

def caso(nome, ok, detalhe):
    r["casos"].append({"caso": nome, "ok": bool(ok), "detalhe": detalhe})

class SemRedirecionar(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a, **k): return None
abre = urllib.request.build_opener(SemRedirecionar)

def pegar(u, seguir=True):
    req = urllib.request.Request(u, headers={"User-Agent": "Mozilla/5.0 (homologacao Prumo)"})
    try:
        resp = (urllib.request.urlopen if seguir else abre.open)(req, timeout=20)
        return resp.status, dict(resp.headers), resp.read()
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers), e.read()

for rota, esperado in [("/", 200), ("/og.jpg", 200), ("/robots.txt", 200), ("/sitemap.xml", 200), ("/llms.txt", 200),
                       ("/content.md", 404), ("/.vercel/project.json", 404), ("/rota-que-nao-existe", 404)]:
    st, hd, corpo = pegar(URL + rota)
    caso(f"rota {rota}", st == esperado, f"HTTP {st} (esperado {esperado}); {hd.get('Content-Type','')}")

st, _, corpo = pegar(URL + "/rota-que-nao-existe")
erro = corpo.decode("utf-8", "replace")
caso("erro 404 com saída: início, WhatsApp e Ligar", st == 404 and 'href="/"' in erro and "wa.me/5534991026371" in erro and "tel:+5534991026371" in erro,
     f"HTTP {st}; página própria: {'Esta página não existe' in erro}")
st, _, _ = pegar("http://demo-locforte-escoras-e-equipamento.vercel.app/", seguir=False)
caso("HTTP redireciona para HTTPS", st in (301, 308), f"HTTP {st}")
ctx = ssl.create_default_context()
with socket.create_connection(("demo-locforte-escoras-e-equipamento.vercel.app", 443), timeout=15) as s:
    with ctx.wrap_socket(s, server_hostname="demo-locforte-escoras-e-equipamento.vercel.app") as t:
        cert = t.getpeercert()
caso("certificado TLS válido para o domínio", True, f"válido até {cert['notAfter']}")

st, hd, corpo = pegar(URL + "/")
doc = corpo.decode("utf-8")
r["index_sha1"] = hashlib.sha1(corpo).hexdigest()
def meta(nome):
    m = re.search(r'<meta (?:name|property)="%s" content="([^"]*)"' % re.escape(nome), doc)
    return html.unescape(m.group(1)) if m else None
titulo = re.search(r"<title>(.*?)</title>", doc, re.S).group(1)
caso("title", "Uberlândia" in titulo and "escoras" in titulo.lower(), titulo)
caso("meta description", bool(meta("description")), meta("description"))
caso("og:image no domínio", meta("og:image") == URL + "/og.jpg", meta("og:image"))
can = re.search(r'<link rel="canonical" href="([^"]*)"', doc)
caso("canonical", bool(can) and can.group(1).startswith(URL), can.group(1) if can else None)
caso("JSON-LD presente", "application/ld+json" in doc, "")
caso("robots noindex (demo antes da venda)", meta("robots") == "noindex", meta("robots"))
caso("h1 com ofício e cidade", "Aluguel de escoras e andaimes em Uberlândia" in doc, "")
caso("nota e avaliações", "5,0" in doc and "48 avaliações" in doc, "")
caso("aviso de homologação presente", 'data-prumo-homologacao="1"' in doc, "a versão no ar é prévia")
externos = sorted(set(re.findall(r'(?:src|href)="(https?://[^"/]+)', doc)))
caso("sem script ou recurso de terceiros carregado", not re.search(r'<script[^>]+src="https?://', doc) and "<iframe" not in doc and not re.search(r'<link[^>]+stylesheet[^>]+https?://', doc), "domínios só em links: " + ", ".join(externos))
caso("sem formulário nem campo de texto", "<form" not in doc and "<input" not in doc and "<textarea" not in doc, "")

was = sorted(set(re.findall(r'href="(https://wa\.me/[^"]+)"', doc)))
numeros = sorted(set(urllib.parse.urlparse(html.unescape(u)).path.strip("/") for u in was))
caso("WhatsApp: um número só", numeros == ["5534991026371"], f"{len(was)} links distintos; números {numeros}")
textos = [urllib.parse.parse_qs(urllib.parse.urlparse(html.unescape(u)).query).get("text", [""])[0] for u in was]
caso("WhatsApp: toda mensagem pronta preenchida", all(t.strip() for t in textos), " | ".join(t[:60] for t in textos))
st, hd, _ = pegar(html.unescape(was[0]), seguir=False)
caso("wa.me responde e leva ao WhatsApp", st in (200, 301, 302), f"HTTP {st} -> {hd.get('Location','')[:90]}")
tels = sorted(set(re.findall(r'href="(tel:[^"]+)"', doc)))
caso("Ligar: um número só, o mesmo", tels == ["tel:+5534991026371"], ", ".join(tels))
for nome, padrao in [("Maps", r'href="(https://maps\.google\.com/[^"]+)"'), ("Instagram", r'href="(https://(?:www\.)?instagram\.com/[^"]+)"'), ("Ver no Google (avaliações)", r'<a [^>]*href="([^"]+)"[^>]*>\s*Ver no Google')]:
    ls = sorted(set(html.unescape(x) for x in re.findall(padrao, doc)))
    if not ls:
        caso(f"{nome}: link", False, "nenhum"); continue
    st, hd, _ = pegar(ls[0], seguir=False)
    caso(f"{nome}: link responde", st in (200, 301, 302, 303), f"{ls[0][:80]} -> HTTP {st}")
ancoras = set(re.findall(r'href="#([^"]+)"', doc)); ids = set(re.findall(r'id="([^"]+)"', doc))
caso("âncoras internas apontam para seções existentes", ancoras <= ids, f"{sorted(ancoras)}; sem destino: {sorted(ancoras - ids)}")
r["passaram"] = sum(c["ok"] for c in r["casos"]); r["total"] = len(r["casos"])
json.dump(r, open(saida, "w", encoding="utf-8", newline="\n"), ensure_ascii=False, indent=2); open(saida, "a", newline="\n").write("\n")
for c in r["casos"]: print("OK " if c["ok"] else "FALHA", c["caso"], "|", (c["detalhe"] or "")[:110])
print(r["passaram"], "/", r["total"])
