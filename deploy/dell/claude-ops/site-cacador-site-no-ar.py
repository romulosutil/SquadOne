"""Caçador: site no ar não vira pasta; "fora do ar" só depois de 3 rodadas (idempotente).

Até 07/10/2026 o "01 · Caçador" decidia o +40 de "site próprio fora do ar" com
UMA requisição de 10 s na raiz do domínio (nó HTTP "Checar site próprio"), e
quem respondia saía calado no "Sem site ou site morto". Medido em 07/10: 74
leads ganharam o +40 assim e 22 terminaram em ~/auto-site/_descartados com o
site respondendo 200 (espadvocacia.com, carolinarochaadv.com.br; a Baby School
deu timeout no www com a raiz no ar e respondeu "hoje já temos uma agência").
Cada um custou uma rodada do Claude no gerador.

Agora "Checar site próprio" é um nó Code (código em site-cacador-site-no-ar.js)
que testa, em até 3 rodadas espaçadas de 30 s, o link do Google e a raiz em
https e http, com e sem www, seguindo redirecionamento com User-Agent de
navegador. Ele substitui o nó HTTP e o "Sem site ou site morto"; o IF "Site no
ar?" manda quem tem site (conteúdo real: 2 mil caracteres de texto visível, não
é estacionamento, "Hello world" nem página padrão) para o "Linha descartada",
com o motivo e a URL no briefing, antes do Gemini. Crédito de agência no rodapé
("Desenvolvido por <link>") vira "tem site e agência". Leads que já estão na
planilha não são tocados: o "Não está na planilha" roda antes.

Uso: python3 site-cacador-site-no-ar.py             aplica no Caçador do Dell (guarda o anterior em backups/)
     python3 site-cacador-site-no-ar.py --testar    roda o código do nó no node, com HTTP de mentira (sem n8n nem planilha)
     python3 site-cacador-site-no-ar.py --ensaiar URL[::Nome]...   roda o código do nó contra os sites de
                                                    verdade, só lendo, e mostra o estado de cada link testado
                                                    (nada no n8n nem na planilha; até ~2 min com site fora do ar)
"""
import copy
import importlib.util
from workflow_confiabilidade import desembrulhar
import json
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

# O id do "01 · Caçador" mora no site-antes-da-venda.py (uma fonte só). Ele importa o n8n.py, que lê a chave da
# API do n8n na importação: no Dell ela existe; num teste, HOME temporário com ~/.config/claude-ops/n8n-api-key.
_spec = importlib.util.spec_from_file_location("site_antes_da_venda", Path(__file__).resolve().parent / "site-antes-da-venda.py")
_sv = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_sv)
CACADOR = _sv.CACADOR  # "01 · Caçador" no n8n do Dell
CHECAR = "Checar site próprio"
VELHO = "Sem site ou site morto"
SE = "Site no ar?"
ANTES = "Portão"
DESCARTE = "Linha descartada"
SEGUE = ("Juntar lead + classificação", "Gemini: classificar e checar na web")
BACKUPS = Path.home() / ".local/share/claude-ops/backups"
CODIGO = (Path(__file__).resolve().parent / "site-cacador-site-no-ar.js").read_text(encoding="utf-8")


def ligacao(no, indice=0):
    return {"node": no, "type": "main", "index": indice}


def aplicar(wf: dict) -> dict:
    """Troca o nó HTTP pelo Code, tira o "Sem site ou site morto" e põe o IF.
    Rodar de novo só atualiza o código do nó."""
    wf = desembrulhar(wf)
    por = {n["name"]: n for n in wf["nodes"]}
    x, y = por[CHECAR]["position"]
    if por[CHECAR]["type"] != "n8n-nodes-base.code":
        codigo = {"id": "checar-site-proprio", "name": CHECAR, "type": "n8n-nodes-base.code", "typeVersion": 2,
                  "position": [x, y],
                  "notes": "Até 3 rodadas, https e http, com e sem www (claude-ops/site-cacador-site-no-ar.js). "
                           "Site no ar vai para a planilha como descartado; fora do ar segue com o +40.",
                  "parameters": {"mode": "runOnceForAllItems", "language": "javaScript", "jsCode": ""}}
        wf["nodes"] = [codigo if n["name"] == CHECAR else n for n in wf["nodes"]]
        por[CHECAR] = codigo
    por[CHECAR]["parameters"]["jsCode"] = CODIGO
    if SE not in por:
        sx, sy = por[VELHO]["position"] if VELHO in por else (x + 220, y)
        wf["nodes"].append({
            "id": "site-no-ar", "name": SE, "type": "n8n-nodes-base.if", "typeVersion": 2.2, "position": [sx, sy],
            "parameters": {"conditions": {
                "options": {"caseSensitive": True, "leftValue": "", "typeValidation": "strict"}, "combinator": "and",
                "conditions": [{"id": "site-no-ar", "leftValue": "={{ $json.descartar_site }}", "rightValue": "",
                                "operator": {"type": "boolean", "operation": "true", "singleValue": True}}]},
                "options": {}}})
    wf["nodes"] = [n for n in wf["nodes"] if n["name"] != VELHO]
    con = {}
    for de, tipos in wf["connections"].items():
        if de == VELHO:
            continue
        con[de] = {t: [[d for d in (s or []) if d["node"] != VELHO] for s in saidas] for t, saidas in tipos.items()}
    con[ANTES] = {"main": [[ligacao(CHECAR)]]}
    con[CHECAR] = {"main": [[ligacao(SE)]]}
    con[SE] = {"main": [[ligacao(DESCARTE)], [ligacao(SEGUE[0]), ligacao(SEGUE[1])]]}
    wf["connections"] = con
    return wf


def node_exe() -> str:
    exe = shutil.which("node") or max(Path.home().glob(".hermes/tools/node-*/bin/node"), default=None)
    if not exe:
        raise SystemExit("node não encontrado")
    return str(exe)


# this.helpers.httpRequest do n8n, de mentira: RESPOSTAS[url] é uma resposta ou
# uma lista (uma por chamada, a última se repete). {pendura} nunca responde,
# {erro} lança, {ssl_invalido} só responde com skipSslCertificateValidation.
HTTP_DUBLE = r"""
const usadas = {};
const httpRequest = async (o) => {
  chamadas.push({ url: o.url, ssl: o.skipSslCertificateValidation === true, semSeguir: o.disableFollowRedirect === true,
                  ua: (o.headers ?? {})['User-Agent'] ?? '' });
  const lista = RESPOSTAS[o.url];
  if (!lista) throw new Error('getaddrinfo ENOTFOUND ' + o.url.split('/')[2]);
  const i = usadas[o.url] = (usadas[o.url] ?? -1) + 1;
  const r = Array.isArray(lista) ? lista[Math.min(i, lista.length - 1)] : lista;
  if (r.pendura) return new Promise(() => {});
  if (r.erro) throw new Error(r.erro);
  if (r.ssl_invalido && !o.skipSslCertificateValidation) throw new Error('certificate has expired');
  return { statusCode: r.status ?? 200, headers: { 'content-type': 'text/html; charset=utf-8', ...(r.headers ?? {}) },
           body: r.body ?? '' };
};
"""

# O mesmo helper com HTTP de verdade (node:http, que é o que o axios do n8n usa).
HTTP_REAL = r"""
const httpRequest = (o) => new Promise((pronto, falhar) => {
  chamadas.push({ url: o.url, ssl: o.skipSslCertificateValidation === true });
  const mod = o.url.startsWith('https:') ? https : http;
  const req = mod.request(o.url, { method: 'GET', headers: { ...o.headers, 'Accept-Encoding': 'gzip, deflate, br' },
                                   rejectUnauthorized: !o.skipSslCertificateValidation, timeout: o.timeout }, (res) => {
    const pedacos = [];
    res.on('data', (c) => pedacos.push(c));
    res.on('error', falhar);
    res.on('end', () => {
      let corpo = Buffer.concat(pedacos);
      const cod = String(res.headers['content-encoding'] ?? '');
      try {
        if (cod.includes('gzip')) corpo = zlib.gunzipSync(corpo);
        else if (cod.includes('br')) corpo = zlib.brotliDecompressSync(corpo);
        else if (cod.includes('deflate')) corpo = zlib.inflateSync(corpo);
      } catch (e) { /* corpo como veio */ }
      pronto({ statusCode: res.statusCode, headers: res.headers, body: corpo.toString('utf8') });
    });
  });
  req.on('timeout', () => req.destroy(new Error('timeout of ' + o.timeout + 'ms exceeded')));
  req.on('error', falhar);
  req.end();
});
"""


DECIDIR = "l.decisao = decidir(feitos.filter((f) => f.l === l).map((f) => f.r), rodada === RODADAS);"


def rodar_no_node(leads, respostas=None, constantes=None, timeout=300):
    """Roda o código do nó como o n8n roda (this.helpers, $input), com o HTTP
    de mentira (`respostas`) ou de verdade (`respostas=None`). `diagnostico`
    volta com o estado de cada link testado, por lead e rodada."""
    codigo = CODIGO
    for nome, valor in (constantes or {}).items():
        codigo, n = re.subn(rf"^const {nome} = [^;]+;", f"const {nome} = {valor};", codigo, flags=re.M)
        assert n == 1, f"constante {nome} não achada no código do nó"
    assert DECIDIR in codigo, "o laço das rodadas mudou: atualize DECIDIR"
    codigo = codigo.replace(DECIDIR, "{ " + DECIDIR + " diagnostico.push({ id: l.p.place_id, rodada, links: "
                                     "feitos.filter((f) => f.l === l).map((f) => f.r) }); }")
    prog = "\n".join([
        "import http from 'node:http';", "import https from 'node:https';", "import zlib from 'node:zlib';",
        "const LEADS = " + json.dumps(leads, ensure_ascii=False) + ";",
        "const RESPOSTAS = " + json.dumps(respostas or {}, ensure_ascii=False) + ";",
        "const chamadas = [];",
        "const diagnostico = [];",
        HTTP_DUBLE if respostas is not None else HTTP_REAL,
        "const $input = { all: () => LEADS.map((json) => ({ json })) };",
        "const saida = await (async function () {", codigo, "}).call({ helpers: { httpRequest } });",
        "console.log(JSON.stringify({ saida, chamadas, diagnostico }));",
    ])
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "checar.mjs"
        arq.write_text(prog, encoding="utf-8")
        r = subprocess.run([node_exe(), str(arq)], capture_output=True, text=True, encoding="utf-8", timeout=timeout)
    if r.returncode != 0:
        raise AssertionError(r.stderr[-2000:])
    return json.loads(r.stdout)


def node_check() -> subprocess.CompletedProcess:
    """`node --check` no código do nó, embrulhado como o n8n embrulha (função async)."""
    with tempfile.TemporaryDirectory() as d:
        arq = Path(d) / "no.js"
        arq.write_text("async function VmCodeWrapper() {\n" + CODIGO + "\n}\n", encoding="utf-8")
        return subprocess.run([node_exe(), "--check", str(arq)], capture_output=True, text=True, encoding="utf-8")


def testar() -> int:
    import unittest

    rapido = {"ESPERA_ENTRE_RODADAS_MS": 5, "TIMEOUT_MS": 100, "PRAZO_DO_LINK_MS": 1000}
    texto = " ".join(["Atendimento em direito de família, sucessões e contratos, com escritório no centro."] * 40)
    real = (f"<html><head><title>Escritório</title><style>.x{{color:red}}</style></head><body><main><h1>Escritório</h1>"
            f"<p>{texto}</p></main><footer>© 2026 Escritório · <a href='https://instagram.com/esc'>Instagram</a></footer>"
            "<script>var a = 1;</script></body></html>")
    agencia = real.replace("</footer>", " Desenvolvido <b>por</b> <a href=\"https://www.agenciamix.com.br/?utm=rodape\">"
                                        "Agência Mix</a></footer>")
    tema = real.replace("</footer>", " Desenvolvido por <a href='https://wordpress.org'>WordPress</a> e "
                                     "<a href='https://www.espadvocacia.com.br/'>nós</a></footer>")
    estacionado = ("<html><head><title>dominioavenda.com.br</title></head><body><h1>This domain may be for sale</h1>"
                   "<script src='//sedoparking.com/frmpark/x.js'></script></body></html>")
    hello = ("<html><head><title>Meu site &#8211; Just another WordPress site</title></head><body><h2>Hello world!</h2>"
             "<p>Welcome to WordPress. This is your first post. Edit or delete it, then start writing!</p></body></html>")
    spa = "<html><head><title>Studio</title></head><body><div id='root'></div><script src='/app.js'></script></body></html>"
    desafio = {"status": 403, "headers": {"cf-mitigated": "challenge"},
               "body": "<html><head><title>Just a moment...</title></head><body></body></html>"}

    def lead(site, nome="Lead"):
        return {"place_id": "id-" + nome, "nome": nome, "tipo": "Advogado", "site_proprio": site}

    class Checar(unittest.TestCase):
        def rodar(self, leads, respostas):
            r = rodar_no_node(leads, respostas, rapido)
            return r["saida"], r["chamadas"]

        def um(self, site, respostas):
            return self.um_com_nome(site, "Lead", respostas)

        def um_com_nome(self, site, nome, respostas):
            saida, chamadas = self.rodar([dict(lead(site), nome=nome)], respostas)
            return (saida[0]["json"] if saida else None), chamadas

        def test_www_com_timeout_e_raiz_no_ar_e_tem_site(self):
            # Baby School: www.babyschool.com.br não responde; a raiz responde 301 -> 200.
            j, chamadas = self.um("https://www.babyschool.com.br/", {
                "https://www.babyschool.com.br/": {"pendura": True},
                "http://www.babyschool.com.br/": {"pendura": True},
                "https://babyschool.com.br/": {"status": 301, "headers": {"location": "/inicio/"}},
                "https://babyschool.com.br/inicio/": {"body": real},
                "http://babyschool.com.br/": {"status": 301, "headers": {"location": "https://babyschool.com.br/"}},
            })
            self.assertTrue(j["descartar_site"])
            self.assertFalse(j["site_morto"])
            self.assertEqual(j["site_no_ar_url"], "https://babyschool.com.br/inicio/")
            self.assertTrue(j["motivo_descarte"].startswith("tem site: https://babyschool.com.br/inicio/ (HTTP 200, "),
                            j["motivo_descarte"])
            # Decidiu na 1ª rodada: o www pendurado foi tentado uma vez só.
            self.assertEqual(sum(c["url"] == "https://www.babyschool.com.br/" for c in chamadas), 1)
            # Campos que o "Linha descartada" lê.
            self.assertEqual((j["score"], j["instagram_busca"], j["vertical_classificada"]), ("", "", "advogado"))
            self.assertTrue(all(c["semSeguir"] and "Chrome" in c["ua"] for c in chamadas))

        def test_todas_falham_e_fora_do_ar_depois_de_3_rodadas(self):
            j, chamadas = self.um("http://www.pousadaduasquedas.com.br/", {
                "http://www.pousadaduasquedas.com.br/": {"status": 500, "body": "erro"},
                "https://www.pousadaduasquedas.com.br/": {"pendura": True},
                "http://pousadaduasquedas.com.br/": {"erro": "connect ECONNREFUSED 1.2.3.4:80"},
            })
            self.assertTrue(j["site_morto"])
            self.assertFalse(j["descartar_site"])
            self.assertIn("nada respondeu em 3 tentativas, https e http, com e sem www", j["site_status"])
            testadas = {"http://www.pousadaduasquedas.com.br/", "https://www.pousadaduasquedas.com.br/",
                        "http://pousadaduasquedas.com.br/", "https://pousadaduasquedas.com.br/"}
            self.assertEqual({c["url"] for c in chamadas}, testadas)
            for url in testadas:
                self.assertEqual(sum(c["url"] == url for c in chamadas), 3, url)

        def test_pagina_de_estacionamento_e_fora_do_ar(self):
            j, chamadas = self.um("https://www.dominioavenda.com.br/", {
                "https://www.dominioavenda.com.br/": {"body": estacionado},
                "https://dominioavenda.com.br/": {"status": 301, "headers": {"location": "https://www.dominioavenda.com.br/"}},
                "http://www.dominioavenda.com.br/": {"body": estacionado},
                "http://dominioavenda.com.br/": {"body": estacionado},
            })
            self.assertTrue(j["site_morto"])
            self.assertTrue(j["site_status"].startswith("domínio à venda, expirado ou estacionado em "), j["site_status"])
            self.assertEqual(sum(c["url"] == "https://www.dominioavenda.com.br/" for c in chamadas), 6)  # 3 rodadas x 2 caminhos

        def test_rodape_de_agencia_e_descarte_com_agencia(self):
            j, _ = self.um("https://espadvocacia.com/", {"https://espadvocacia.com/": {"body": agencia}})
            self.assertTrue(j["descartar_site"])
            self.assertTrue(j["motivo_descarte"].startswith("tem site e agência (agenciamix.com.br): https://espadvocacia.com/"),
                            j["motivo_descarte"])

        def test_credito_de_plataforma_ou_do_proprio_dono_nao_e_agencia(self):
            j, _ = self.um("https://espadvocacia.com/", {"https://espadvocacia.com/": {"body": tema}})
            self.assertTrue(j["motivo_descarte"].startswith("tem site: "), j["motivo_descarte"])

        def test_sem_site_proprio_segue_sem_http(self):
            saida, chamadas = self.rodar([{"place_id": "x", "nome": "Sem site", "site_proprio": ""}], {})
            self.assertEqual(saida[0]["json"]["site_morto"], False)
            self.assertEqual(saida[0]["json"]["descartar_site"], False)
            self.assertEqual(chamadas, [])

        def test_wix_mora_no_caminho_e_sem_www_de_plataforma(self):
            j, chamadas = self.um("https://absoluteautomoveis.wixsite.com/absoluteautomoveis", {
                "https://absoluteautomoveis.wixsite.com/": {"status": 404, "body": "nada"},
                "https://absoluteautomoveis.wixsite.com/absoluteautomoveis": {"body": real},
            })
            self.assertEqual(j["site_no_ar_url"], "https://absoluteautomoveis.wixsite.com/absoluteautomoveis")
            self.assertFalse(any("www.absoluteautomoveis" in c["url"] for c in chamadas))

        def test_falha_passageira_na_1a_rodada_responde_na_2a(self):
            j, chamadas = self.um("https://www.gekopousada.com.br/", {
                "https://www.gekopousada.com.br/": [{"erro": "getaddrinfo EAI_AGAIN www.gekopousada.com.br"}, {"body": real}],
            })
            self.assertTrue(j["descartar_site"])
            self.assertEqual(sum(c["url"] == "https://www.gekopousada.com.br/" for c in chamadas), 2)

        def test_bloqueio_de_robo_e_pagina_so_de_javascript_ficam_de_fora(self):
            saida, _ = self.rodar([lead("https://cf.com.br/", "cf"), lead("https://spa.com.br/", "spa")],
                                  {"https://cf.com.br/": desafio, "https://spa.com.br/": {"body": spa}})
            self.assertEqual(saida, [])

        def test_dominio_que_so_redireciona_para_instagram_e_fora_do_ar(self):
            ig = {"status": 301, "headers": {"location": "https://www.instagram.com/studio/"}}
            j, _ = self.um("https://www.studio.com.br/", {u: ig for u in (
                "https://www.studio.com.br/", "http://www.studio.com.br/", "https://studio.com.br/", "http://studio.com.br/")})
            self.assertTrue(j["site_morto"])
            self.assertIn("redireciona para instagram.com", j["site_status"])

        def test_certificado_invalido_com_conteudo_e_tem_site(self):
            j, chamadas = self.um("https://bianchimoveis.com.br/", {
                "https://bianchimoveis.com.br/": {"ssl_invalido": True, "body": real}})
            self.assertTrue(j["descartar_site"])
            self.assertIn("certificado SSL inválido", j["motivo_descarte"])
            self.assertTrue(any(c["ssl"] for c in chamadas))

        def test_wordpress_recem_instalado_e_fora_do_ar(self):
            j, _ = self.um("https://meusite.com.br/", {"https://meusite.com.br/": {"body": hello}})
            self.assertTrue(j["site_morto"])
            self.assertIn("WordPress recém-instalado", j["site_status"])

        def test_link_que_leva_a_diretorio_de_outro_site_segue_sem_o_mais_40(self):
            # pousadasetemares.traveleto.com -> traveleto.com/hotel/...: anúncio, não site próprio.
            j, _ = self.um("https://pousadasetemares.traveleto.com/", {
                "https://pousadasetemares.traveleto.com/": {"status": 302, "headers": {
                    "location": "https://traveleto.com/hotel/br/pousada-sete-mares-ubatuba.html"}},
                "https://traveleto.com/hotel/br/pousada-sete-mares-ubatuba.html": {"body": real}})
            self.assertEqual((j["descartar_site"], j["site_morto"]), (False, False))
            self.assertEqual(j["site_status"], "o link leva a uma página de traveleto.com")

        def test_dominio_novo_do_mesmo_dono_na_raiz_e_tem_site(self):
            j, _ = self.um("https://antigo.com.br/", {
                "https://antigo.com.br/": {"status": 301, "headers": {"location": "https://www.novo.adv.br/"}},
                "https://www.novo.adv.br/": {"body": real}})
            self.assertEqual(j["site_no_ar_url"], "https://www.novo.adv.br/")

        def test_link_profundo_quebrado_com_raiz_do_negocio_no_ar_e_tem_site(self):
            # Progênie: o link do Google quebrou, a raiz do domínio dele está no ar.
            j, _ = self.um_com_nome("https://progenie.com.br/pagina/antiga", "Progênie Clínica", {
                "https://progenie.com.br/pagina/antiga": {"status": 404},
                "https://progenie.com.br/": {"body": real.replace("<h1>Escritório</h1>", "<h1>Progênie</h1>")}})
            self.assertEqual(j["site_no_ar_url"], "https://progenie.com.br/")

        def test_raiz_de_plataforma_que_nao_cita_o_negocio_nao_prova_site(self):
            # mechamenozap.com.br/<lead> sumiu; a raiz é a página da plataforma.
            saida, _ = self.rodar([dict(lead("https://mechamenozap.com.br/pousada-liras/"), nome="Pousada Liras da Poesia")], {
                "https://mechamenozap.com.br/pousada-liras/": {"status": 404},
                "https://mechamenozap.com.br/": {"body": real}})
            self.assertEqual(saida, [])

        def test_sem_tempo_para_as_3_rodadas_fica_de_fora_e_nao_vira_fora_do_ar(self):
            # Pior caso da 2ª rodada (500 ms de espera + 1,1 s) passa do teto de 1,5 s: para depois da 1ª.
            r = rodar_no_node([lead("https://lento.com.br/")], {"https://lento.com.br/": {"status": 503}},
                              dict(rapido, ESPERA_ENTRE_RODADAS_MS=500, TETO_MS=1500))
            self.assertEqual(r["saida"], [])
            self.assertEqual(sum(c["url"] == "https://lento.com.br/" for c in r["chamadas"]), 1)

        def test_cabecalho_grande_demais_responde_e_fica_de_fora(self):
            saida, _ = self.rodar([lead("https://hbook.com.br/Booking?id=1")],
                                  {"https://hbook.com.br/Booking?id=1": {"erro": "Parse Error: Header overflow"}})
            self.assertEqual(saida, [])

        def test_meta_refresh_e_seguido(self):
            pula = "<html><head><meta http-equiv='refresh' content='0; url=/site/'></head><body></body></html>"
            j, _ = self.um("https://pula.com.br/", {"https://pula.com.br/": {"body": pula}, "https://pula.com.br/site/": {"body": real}})
            self.assertEqual(j["site_no_ar_url"], "https://pula.com.br/site/")

        def test_ordem_e_pairedItem_com_leads_misturados(self):
            leads = [lead("https://vivo.com.br/", "vivo"), {"place_id": "s", "nome": "sem", "site_proprio": ""},
                     lead("https://cf.com.br/", "cf"), lead("https://morto.com.br/", "morto")]
            saida, _ = self.rodar(leads, {"https://vivo.com.br/": {"body": real}, "https://cf.com.br/": desafio,
                                          "https://morto.com.br/": {"status": 404}})
            self.assertEqual([(s["json"]["nome"], s["pairedItem"]) for s in saida], [("vivo", 0), ("sem", 1), ("morto", 3)])
            self.assertEqual([s["json"]["descartar_site"] for s in saida], [True, False, False])
            self.assertTrue(saida[2]["json"]["site_morto"])

        def test_codigo_passa_no_node_check(self):
            r = node_check()
            self.assertEqual(r.returncode, 0, r.stderr)

        def test_aplicar_troca_os_nos_e_e_idempotente(self):
            nos = [{"name": n, "type": "n8n-nodes-base.code", "position": [1, 2], "parameters": {}}
                   for n in (ANTES, VELHO, DESCARTE, *SEGUE, "Aprovado?")]
            nos.append({"name": CHECAR, "type": "n8n-nodes-base.httpRequest", "position": [3, 4], "parameters": {}})
            con = {ANTES: {"main": [[ligacao(CHECAR)]]}, CHECAR: {"main": [[ligacao(VELHO)]]},
                   VELHO: {"main": [[ligacao(SEGUE[0]), ligacao(SEGUE[1])]]},
                   SEGUE[1]: {"main": [[ligacao(SEGUE[0], 1)]]},
                   "Aprovado?": {"main": [[], [ligacao(DESCARTE)]]}}
            uma = aplicar({"nodes": nos, "connections": con})
            por = {n["name"]: n for n in uma["nodes"]}
            self.assertNotIn(VELHO, por)
            self.assertEqual(por[CHECAR]["type"], "n8n-nodes-base.code")
            self.assertEqual(por[CHECAR]["position"], [3, 4])
            self.assertEqual(por[CHECAR]["parameters"]["jsCode"], CODIGO)
            self.assertEqual(por[SE]["position"], [1, 2])
            self.assertNotIn(VELHO, uma["connections"])
            self.assertEqual(uma["connections"][CHECAR]["main"], [[ligacao(SE)]])
            self.assertEqual(uma["connections"][SE]["main"], [[ligacao(DESCARTE)], [ligacao(SEGUE[0]), ligacao(SEGUE[1])]])
            self.assertEqual(uma["connections"]["Aprovado?"]["main"], [[], [ligacao(DESCARTE)]])
            self.assertEqual(uma["connections"][SEGUE[1]]["main"], [[ligacao(SEGUE[0], 1)]])
            self.assertEqual(aplicar(uma), uma)

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Checar))
    return 0 if r.wasSuccessful() else 1


def ensaiar(args) -> int:
    """O código do nó contra os sites de verdade. Só GET nos sites; nada no n8n nem na planilha.
    Cada argumento é `URL` ou `URL::Nome do negócio` (o nome só pesa em link com caminho)."""
    pares = [a.split("::", 1) for a in args]
    urls = [p[0] for p in pares]
    leads = [{"place_id": str(i), "nome": p[1] if len(p) > 1 else "", "tipo": "", "site_proprio": p[0]}
             for i, p in enumerate(pares)]
    r = rodar_no_node(leads)
    por_item = {s["pairedItem"]: s["json"] for s in r["saida"]}
    ultima = {d["id"]: d for d in r["diagnostico"]}  # a última rodada de cada lead
    for i, u in enumerate(urls):
        j = por_item.get(i)
        if j is None:
            print(f"inconclusivo (fica de fora)  {u}")
        elif j["descartar_site"]:
            print(f"TEM SITE     {u}  ->  {j['motivo_descarte']}")
        elif j["site_morto"]:
            print(f"fora do ar   {u}  ->  {j['site_status']}")
        else:
            print(f"segue sem +40  {u}  ->  {j['site_status']}")
        d = ultima.get(str(i))
        for link in (d["links"] if d else []):
            print(f"      rodada {d['rodada']}: {link['estado']:<13} {link['url']}  {link['detalhe']}")
    print(f"{len(r['chamadas'])} pedidos HTTP")
    return 0


def main() -> int:
    from n8n import api, put
    atual = api("GET", f"/workflows/{CACADOR}")
    BACKUPS.mkdir(parents=True, exist_ok=True)
    copia = BACKUPS / f"cacador-{time.strftime('%Y%m%d-%H%M%S')}.json"
    copia.write_text(json.dumps(atual, ensure_ascii=False), encoding="utf-8")
    put(aplicar(atual))
    api("POST", f"/workflows/{CACADOR}/activate")  # o PUT guarda; ativar publica a versão nova
    vivo = api("GET", f"/workflows/{CACADOR}")
    por = {n["name"]: n for n in vivo["nodes"]}
    ok = (por[CHECAR]["parameters"].get("jsCode") == CODIGO and VELHO not in por
          and vivo["connections"][SE]["main"][0][0]["node"] == DESCARTE)
    print(f"Caçador: site checado em até 3 rodadas, site no ar vai à planilha como descartado: "
          f"{'ok' if ok else 'FALHOU'} (ativo={vivo['active']}; anterior em {copia})")
    return 0 if ok else 1


if __name__ == "__main__":
    if "--testar" in sys.argv:
        sys.exit(testar())
    if "--ensaiar" in sys.argv:
        sys.exit(ensaiar([a for a in sys.argv[1:] if not a.startswith("--")]))
    sys.exit(main())
