#!/usr/bin/env python3
"""SEO técnico dos demos do "Site antes da venda" (15/10/2026).

Até aqui os demos saíam só com <title> e og:image: nenhum dado estruturado, sitemap,
robots ou llms.txt. O Google diz que AI Overviews e AI Mode seguem o SEO comum, e o
ChatGPT e o Perplexity citam as 2 ou 3 empresas cujas páginas trazem fatos fáceis de
extrair (dados estruturados, perguntas com resposta direta). É também o argumento do
serviço Encontrado do PRUMO: o demo precisa mostrar isso pronto.

O que este script faz numa pasta de lead (`~/auto-site/<slug>/`), depois de o Claude
escrever o `index.html` e o `og.jpg`, e antes do deploy:

- põe no <head> um JSON-LD (`<script type="application/ld+json" id="dados-estruturados">`)
  com o LocalBusiness no subtipo do ofício e, se a página tiver a seção de perguntas, o
  FAQPage. **Nenhum valor é escrito à mão**: nome, endereço, telefone e nota vêm do
  `content.md` do Caçador; coordenadas, endereço estruturado e horário vêm do Google Places
  (cache `seo-places.json` na pasta, até 30 dias, como pedem os termos do Maps); as
  perguntas e respostas vêm do texto visível da página. O que não tem fonte fica de fora;
- a nota (aggregateRating) só entra com os números exatos do Google, só quando a própria
  página os mostra (o Google pede marcação igual ao que se vê) e nunca em advocacia ou
  saúde (Provimento 205/2021 da OAB e conselhos: nada de avaliação na página);
- grava `robots.txt`, `sitemap.xml` e `llms.txt` na pasta. Sobem com o `index.html` e o
  `og.jpg`; o resto da pasta continua fora da Vercel (lista de permissão).

`--conferir` refaz o JSON-LD esperado a partir das mesmas fontes (sem rede) e compara com o
que está no `index.html`: campo a mais é "sem fonte", valor diferente é "diverge da fonte".
É o teste de "nenhum dado sem fonte", e o gerador-de-sites.test.py o usa.

  seo-do-site <pasta do lead> --url https://demo-<slug>.vercel.app [--exigir-faq]
  seo-do-site <pasta do lead> --conferir

Código 0 = ok; 1 = FALHA (cada linha diz o que corrigir); 2 = erro de uso ou de leitura.
"""

from __future__ import annotations

import argparse
import datetime as dt
import html as html_lib
import json
import os
import re
import sys
import unicodedata
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from xml.sax.saxutils import escape as xml_escape

ID_DO_BLOCO = "dados-estruturados"
ID_DA_SECAO = "perguntas"
ARQUIVOS = ("robots.txt", "sitemap.xml", "llms.txt")
CACHE = "seo-places.json"
VERSAO_CACHE = 1
# Os termos do Google Maps Platform só deixam guardar conteúdo do Places por até 30 dias.
VALIDADE_CACHE_DIAS = 30
PLACES_ENV = Path(os.environ.get("RAIO_X_CHAVE", str(Path.home() / ".config/prumo/places.env")))
PLACES_URL = "https://places.googleapis.com/v1/places"
# Essentials (location, postalAddress) + Enterprise (regularOpeningHours): um pedido por lead publicado.
CAMPOS_PLACES = "id,location,postalAddress,formattedAddress,regularOpeningHours,googleMapsUri"
# De onde vem a resposta de uma pergunta (atributo data-fonte do <details>; mais de uma, separadas por espaço).
FONTES_DA_RESPOSTA = ("google", "avaliacoes", "instagram", "facebook", "cnpj", "dossie")
MIN_PERGUNTAS, MAX_PERGUNTAS = 3, 5
MAX_RESPOSTA = 400

# Subtipo do schema.org pelo "Vertical:" do content.md (raízes sem acento, a primeira que bate vale).
# Ramo sem subtipo honesto no schema.org (locação, caçamba, eventos, indústria) fica LocalBusiness.
TIPOS = (
    (("advoc", "advog", "jurid"), "LegalService"),
    (("contab", "contador"), "AccountingService"),
    (("odonto", "dentist", "ortodon"), "Dentist"),
    (("dermat", "clinica medica", "medic"), "MedicalClinic"),
    (("psicolog", "terapia", "terapeut", "fisioter", "nutri", "fonoaud"), "MedicalBusiness"),
    (("desentup", "encanad", "hidraul", "caca vazament", "fossa"), "Plumber"),
    (("eletricist",), "Electrician"),
    (("climatiz", "refrigera", "ar-condicionado", "ar condicionado"), "HVACBusiness"),
    (("pintura", "pintor"), "HousePainter"),
    (("chaveir",), "Locksmith"),
    (("loja de moveis", "moveis planejados loja"), "FurnitureStore"),
    (("materiais de construcao",), "HardwareStore"),
    (("marido de aluguel", "manutencao residencial", "dedetiz", "pragas", "marcenaria", "moveis planejados",
      "vidracaria", "energia solar"), "HomeAndConstructionBusiness"),
    (("empreiteir", "construtor", "reforma", "impermeabiliz", "reparos"), "GeneralContractor"),
    (("engenharia", "arquitetura"), "ProfessionalService"),
    (("pousada",), "BedAndBreakfast"),
    (("hostel",), "Hostel"),
    (("hotel",), "Hotel"),
    (("pet shop", "petshop"), "PetStore"),
    (("veterinar",), "VeterinaryCare"),
    (("academia", "crosstraining", "treinamento funcional", "pilates"), "ExerciseGym"),
    (("estetica automotiva", "lava-jato", "lava jato"), "AutoWash"),
    (("mecanica", "auto center", "funilaria"), "AutoRepair"),
    (("estetica", "salao", "barbearia"), "HealthAndBeautyBusiness"),
    (("escola infantil", "bercario", "creche"), "ChildCare"),
    (("imobiliar",), "RealEstateAgent"),
)
TIPOS_LOCAIS = {"LocalBusiness"} | {t for _, t in TIPOS}
# Advocacia e saúde: sem avaliação na página (Provimento 205/2021 da OAB; conselhos de saúde),
# então nem aggregateRating no JSON-LD nem resposta tirada das avaliações.
RESTRITOS = ("advoc", "advog", "jurid", "odonto", "dentist", "ortodon", "psicol", "psiqu", "medic", "clinica",
             "saude", "dermat", "fisioter", "nutri", "fonoaud", "terapia", "terapeut", "oftalm", "pediatr")
PAISES = {"brasil": "BR", "brazil": "BR", "portugal": "PT", "estados unidos": "US", "eua": "US", "usa": "US",
          "united states": "US"}
DIAS = ("Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday")  # dia 0 do Places = domingo


# ------------------------------------------------------------------ leitura (PURO)

def sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn")


def ler_content(texto: str) -> dict:
    """Os campos do `content.md` do Caçador (o mesmo formato que o raio-x.py lê)."""
    linhas = texto.splitlines()
    nome = next((l.lstrip("#").strip() for l in linhas if l.startswith("# ")), "")
    campos: dict[str, str] = {}
    secao = ""
    for l in linhas:
        if l.startswith("## "):
            secao = l[3:].strip()
            continue
        m = re.match(r"^- \*\*(.+?):\*\*\s*(.*)$", l)
        if m and not secao:
            campos.setdefault(m.group(1).strip(), m.group(2).strip())
    nota, avaliacoes = None, None
    m = re.match(r"^(sem nota|[\d.,]+)\s*\((\d+) avalia", campos.get("Nota Google", ""))
    if m:
        nota = None if m.group(1) == "sem nota" else float(m.group(1).replace(",", "."))
        avaliacoes = int(m.group(2))
    return {"nome": nome, "campos": campos, "nota": nota, "avaliacoes": avaliacoes}


def tipo_do_negocio(vertical: str) -> str:
    v = sem_acento(vertical).lower()
    return next((tipo for raizes, tipo in TIPOS if any(r in v for r in raizes)), "LocalBusiness")


def restrito(vertical: str) -> bool:
    v = sem_acento(vertical).lower()
    return any(r in v for r in RESTRITOS)


def texto_visivel(pagina: str) -> str:
    """O texto que o visitante lê: sem <head>, script, style e template; entidades resolvidas."""
    t = re.sub(r"(?is)<head\b.*?</head>", " ", pagina or "")
    t = re.sub(r"(?is)<(script|style|template)\b.*?</\1>", " ", t)
    t = re.sub(r"(?s)<!--.*?-->", " ", t)
    t = re.sub(r"(?s)<[^>]+>", " ", t)
    return re.sub(r"\s+", " ", html_lib.unescape(t)).strip()


def _formatos_da_nota(nota: float) -> list[str]:
    um = f"{nota:.1f}"
    saida = [um, um.replace(".", ",")]
    if nota == int(nota):
        saida.append(str(int(nota)))
    return saida


def pagina_mostra_a_nota(visivel: str, nota: float | None, avaliacoes: int | None) -> bool:
    """A página mostra a nota E o número de avaliações do Google? (A marcação tem de refletir o que se vê.)"""
    if nota is None or not avaliacoes:
        return False
    numero = rf"(?<![\d.,]){avaliacoes}(?![\d.,])\W+(?:[\w-]+\W+){{0,2}}?(?:avalia|review|opini|nota)"
    tem_n = re.search(numero, visivel, re.I) is not None
    tem_nota = any(re.search(rf"(?<![\d.,]){re.escape(f)}(?![\d,]|\.\d)", visivel) for f in _formatos_da_nota(nota))
    return tem_n and tem_nota


class _LeitorDePerguntas(HTMLParser):
    """Os <details> da <section id="perguntas">: summary = pergunta, o resto = resposta."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.profundidade_secao = 0  # >0 = dentro da seção
        self.itens: list[dict] = []
        self.atual: dict | None = None
        self.no_summary = False
        self.tem_secao = False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if self.profundidade_secao:
            if tag == "section":
                self.profundidade_secao += 1
            elif tag == "details":
                self.atual = {"pergunta": "", "resposta": "", "fonte": (a.get("data-fonte") or "").strip()}
            elif tag == "summary" and self.atual is not None:
                self.no_summary = True
            elif tag in ("p", "br", "li") and self.atual is not None and not self.no_summary:
                self.atual["resposta"] += " "
        elif tag == "section" and a.get("id") == ID_DA_SECAO:
            self.profundidade_secao, self.tem_secao = 1, True

    def handle_endtag(self, tag):
        if not self.profundidade_secao:
            return
        if tag == "summary":
            self.no_summary = False
        elif tag == "details" and self.atual is not None:
            self.itens.append({k: re.sub(r"\s+", " ", v).strip() for k, v in self.atual.items()})
            self.atual = None
        elif tag == "section":
            self.profundidade_secao -= 1

    def handle_data(self, data):
        if self.atual is None:
            return
        self.atual["pergunta" if self.no_summary else "resposta"] += data


def perguntas_da_pagina(pagina: str, vertical: str = "") -> tuple[list[dict], list[str], bool]:
    """(perguntas aceitas, problemas, a seção existe). Pergunta sem fonte, com fonte desconhecida,
    sem "?" ou vazia fica fora do FAQPage e vira problema; em advocacia e saúde a resposta não
    pode vir das avaliações."""
    leitor = _LeitorDePerguntas()
    leitor.feed(pagina or "")
    aceitas, problemas = [], []
    for i, p in enumerate(leitor.itens, 1):
        rotulo = f"pergunta {i} ({p['pergunta'][:60] or 'sem texto'})"
        fontes = p["fonte"].split()
        if not p["pergunta"] or not p["resposta"]:
            problemas.append(f"{rotulo}: pergunta ou resposta vazia")
        elif not p["pergunta"].endswith("?"):
            problemas.append(f"{rotulo}: o <summary> tem de ser a pergunta, terminada em \"?\"")
        elif not fontes:
            problemas.append(f"{rotulo}: sem data-fonte (de onde vem a resposta: {', '.join(FONTES_DA_RESPOSTA)})")
        elif any(f not in FONTES_DA_RESPOSTA for f in fontes):
            problemas.append(f"{rotulo}: data-fonte \"{p['fonte']}\" fora da lista ({', '.join(FONTES_DA_RESPOSTA)})")
        elif "avaliacoes" in fontes and restrito(vertical):
            problemas.append(f"{rotulo}: advocacia e saúde não respondem com as avaliações (regra dos conselhos)")
        elif len(p["resposta"]) > MAX_RESPOSTA:
            problemas.append(f"{rotulo}: resposta com {len(p['resposta'])} caracteres; a direta cabe em {MAX_RESPOSTA}")
        else:
            aceitas.append({"pergunta": p["pergunta"], "resposta": p["resposta"]})
    return aceitas, problemas, leitor.tem_secao


def link_do_google(campos: dict, places: dict | None) -> str:
    """O perfil do Google pelo cid (sem os parâmetros de rastreio do link do Places); sem cid, pelo place_id."""
    for bruto in ((places or {}).get("maps"), campos.get("Google Maps")):
        m = re.search(r"[?&]cid=(\d+)", bruto or "")
        if m:
            return f"https://maps.google.com/?cid={m.group(1)}"
    pid = campos.get("place_id", "")
    return f"https://www.google.com/maps/place/?q=place_id:{pid}" if re.fullmatch(r"[A-Za-z0-9_-]+", pid) else ""


def instagram_confirmado(campos: dict) -> str:
    """O Instagram só entra em sameAs quando o Google o mostra (o "achado na busca" pede conferência à mão)."""
    bruto = campos.get("Instagram", "")
    if not bruto or re.search(r"(?i)confirmar|achado|não informado|nao informado", bruto):
        return ""
    m = re.search(r"instagram\.com/([A-Za-z0-9_.]+)", bruto) or re.match(r"^@([A-Za-z0-9_.]+)", bruto.strip())
    return f"https://www.instagram.com/{m.group(1)}/" if m else ""


def endereco(campos: dict, places: dict | None) -> dict | None:
    """PostalAddress do Places (estruturado); sem ele, o "Endereço:" do content.md no formato do Google
    no Brasil ("Rua, 12 - Bairro, Cidade - UF, 00000-000, Brasil"); fora disso, o texto inteiro."""
    pais = PAISES.get(sem_acento(campos.get("País", "Brasil")).strip().lower())
    postal = (places or {}).get("postal") or {}
    if postal.get("addressLines") and postal.get("locality"):
        e = {"@type": "PostalAddress", "streetAddress": ", ".join(postal["addressLines"]),
             "addressLocality": postal["locality"]}
        for chave, campo in (("addressRegion", "administrativeArea"), ("postalCode", "postalCode"),
                             ("addressCountry", "regionCode")):
            if postal.get(campo):
                e[chave] = postal[campo]
        return e
    texto = campos.get("Endereço", "").strip()
    if not texto:
        return None
    m = re.match(r"^(?P<rua>.+?) - (?P<bairro>[^,]+), (?P<cidade>[^,]+?) - (?P<uf>[A-Z]{2}), (?P<cep>\d{5}-?\d{3})(?:,.*)?$", texto)
    if m:
        e = {"@type": "PostalAddress", "streetAddress": m.group("rua"), "addressLocality": m.group("cidade"),
             "addressRegion": m.group("uf"), "postalCode": m.group("cep")}
    else:
        e = {"@type": "PostalAddress", "streetAddress": re.sub(r",\s*(Brasil|Brazil|Portugal)$", "", texto)}
    if pais:
        e["addressCountry"] = pais
    return e


def _hora(h: int, m: int) -> str:
    return f"{h:02d}:{m:02d}"


def horario(periods: list | None) -> list[dict] | None:
    """openingHoursSpecification a partir dos `periods` do Places (o horário exato do Google). Um período
    só, aberto no domingo 00:00 e sem fechamento, é o "24 horas" do Google. Período que vira a noite fica
    com closes antes de opens (o schema.org lê como "no dia seguinte"). None = sem horário confiável."""
    if not periods:
        return None
    if len(periods) == 1 and "close" not in periods[0]:
        a = periods[0].get("open") or {}
        if (a.get("day"), a.get("hour", 0), a.get("minute", 0)) == (0, 0, 0):
            return [{"@type": "OpeningHoursSpecification", "dayOfWeek": [DIAS[d] for d in (1, 2, 3, 4, 5, 6, 0)],
                     "opens": "00:00", "closes": "23:59"}]
        return None
    grupos: dict[tuple[str, str], list[int]] = {}
    for p in periods:
        a, f = p.get("open") or {}, p.get("close") or {}
        if not isinstance(a.get("day"), int) or not isinstance(f.get("day"), int) or not 0 <= a["day"] <= 6:
            return None  # período sem fechamento ou truncado: melhor nenhum horário que um errado
        chave = (_hora(a.get("hour", 0), a.get("minute", 0)), _hora(f.get("hour", 0), f.get("minute", 0)))
        if chave[1] == "00:00" and f["day"] != a["day"]:
            chave = (chave[0], "23:59")  # fecha à meia-noite
        grupos.setdefault(chave, [])
        if a["day"] not in grupos[chave]:
            grupos[chave].append(a["day"])
    ordem = lambda d: (d + 6) % 7  # segunda primeiro
    return [{"@type": "OpeningHoursSpecification", "dayOfWeek": [DIAS[d] for d in sorted(dias, key=ordem)],
             "opens": abre, "closes": fecha}
            for (abre, fecha), dias in sorted(grupos.items(), key=lambda g: (min(ordem(d) for d in g[1]), g[0]))]


def montar(dados: dict, places: dict | None, url: str, perguntas: list[dict], visivel: str, tem_og: bool) -> dict:
    """O JSON-LD inteiro (@graph) só com o que tem fonte. PURO: as conferências refazem isto e comparam."""
    c = dados["campos"]
    base = url.rstrip("/")
    vertical = c.get("Vertical", "")
    negocio: dict = {"@type": tipo_do_negocio(vertical), "@id": f"{base}/#negocio", "name": dados["nome"],
                     "url": f"{base}/"}
    if tem_og:
        negocio["image"] = f"{base}/og.jpg"
    telefone = c.get("Telefone", "").strip()
    if len(re.sub(r"\D", "", telefone)) >= 8:
        negocio["telephone"] = telefone
    e = endereco(c, places)
    if e:
        negocio["address"] = e
    local = (places or {}).get("location") or {}
    if isinstance(local.get("latitude"), (int, float)) and isinstance(local.get("longitude"), (int, float)):
        negocio["geo"] = {"@type": "GeoCoordinates", "latitude": local["latitude"], "longitude": local["longitude"]}
    h = horario((places or {}).get("periods"))
    if h:
        negocio["openingHoursSpecification"] = h
    if not restrito(vertical) and pagina_mostra_a_nota(visivel, dados["nota"], dados["avaliacoes"]):
        negocio["aggregateRating"] = {"@type": "AggregateRating", "ratingValue": dados["nota"],
                                      "reviewCount": dados["avaliacoes"]}
    perfis = [p for p in (link_do_google(c, places), instagram_confirmado(c)) if p]
    if perfis:
        negocio["sameAs"] = perfis
    grafo = [negocio]
    if perguntas:
        grafo.append({"@type": "FAQPage", "@id": f"{base}/#{ID_DA_SECAO}", "about": {"@id": f"{base}/#negocio"},
                      "mainEntity": [{"@type": "Question", "name": p["pergunta"],
                                      "acceptedAnswer": {"@type": "Answer", "text": p["resposta"]}}
                                     for p in perguntas]})
    return {"@context": "https://schema.org", "@graph": grafo}


def blocos_json_ld(pagina: str) -> list[str]:
    return re.findall(r"(?is)<script\b[^>]*type\s*=\s*[\"']?application/ld\+json[\"']?[^>]*>(.*?)</script>", pagina or "")


def inserir(pagina: str, grafo: dict, url: str) -> str:
    """Troca todo JSON-LD da página pelo nosso (um feito à mão poderia ter dado sem fonte) e põe o
    canonical, se faltar. Idempotente."""
    if not re.search(r"(?i)</head>", pagina):
        raise ValueError("index.html sem </head>")
    corpo = json.dumps(grafo, ensure_ascii=False, indent=2).replace("</", "<\\/")
    bloco = f'<script type="application/ld+json" id="{ID_DO_BLOCO}">\n{corpo}\n</script>\n'
    if not re.search(r"(?i)<link\b[^>]*rel\s*=\s*[\"']?canonical", pagina):
        bloco = f'<link rel="canonical" href="{html_lib.escape(url.rstrip("/") + "/")}">\n' + bloco
    sem = re.sub(r"(?is)[ \t]*<script\b[^>]*type\s*=\s*[\"']?application/ld\+json[\"']?[^>]*>.*?</script>[ \t]*\n?", "",
                 pagina)
    i = re.search(r"(?i)</head>", sem).start()
    return sem[:i] + bloco + sem[i:]


def robots(url: str) -> str:
    # /raio-x é o diagnóstico do PRUMO para o dono, não página do negócio.
    return f"User-agent: *\nAllow: /\nDisallow: /raio-x\n\nSitemap: {url.rstrip('/')}/sitemap.xml\n"


def sitemap(url: str, hoje: dt.date) -> str:
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
            f"  <url><loc>{xml_escape(url.rstrip('/') + '/')}</loc><lastmod>{hoje.isoformat()}</lastmod></url>\n"
            "</urlset>\n")


def resumo_da_pagina(pagina: str) -> str:
    """O <h1> (uma frase com o ofício e o lugar, pelas regras do CLAUDE.md); sem ele, a meta description."""
    m = re.search(r"(?is)<h1\b[^>]*>(.*?)</h1>", pagina or "")
    if m:
        h1 = re.sub(r"\s+", " ", html_lib.unescape(re.sub(r"(?s)<[^>]+>", " ", m.group(1)))).strip()
        if h1:
            return h1
    m = re.search(r"(?is)<meta\b[^>]*name\s*=\s*[\"']description[\"'][^>]*content\s*=\s*[\"']([^\"']+)", pagina or "")
    return html_lib.unescape(m.group(1)).strip() if m else ""


def llms(dados: dict, places: dict | None, grafo: dict, pagina: str) -> str:
    """O llms.txt (llmstxt.org): o mesmo conteúdo do JSON-LD, em Markdown, para quem lê com modelo."""
    c = dados["campos"]
    negocio = grafo["@graph"][0]
    linhas = [f"# {dados['nome']}", ""]
    resumo = resumo_da_pagina(pagina)
    if resumo:
        linhas += [f"> {resumo}", ""]
    linhas += ["## Contato", ""]
    if negocio.get("telephone"):
        linhas.append(f"- Telefone: {negocio['telephone']}")
    end = (places or {}).get("endereco") or c.get("Endereço", "")
    if end:
        linhas.append(f"- Endereço: {end}")
    dias = (places or {}).get("dias")
    if negocio.get("openingHoursSpecification") and dias:
        linhas.append(f"- Horário (Google): {'; '.join(dias)}")
    nota = negocio.get("aggregateRating")
    if nota:
        n = f"{nota['ratingValue']:.1f}".replace(".", ",")
        linhas.append(f"- Nota no Google: {n} ({nota['reviewCount']} avaliações)")
    for perfil in negocio.get("sameAs", []):
        linhas.append(f"- {'Perfil no Google' if 'google.com' in perfil else 'Instagram'}: {perfil}")
    faq = next((n for n in grafo["@graph"] if n.get("@type") == "FAQPage"), None)
    if faq:
        linhas += ["", "## Perguntas frequentes", ""]
        for q in faq["mainEntity"]:
            linhas += [f"### {q['name']}", "", q["acceptedAnswer"]["text"], ""]
        linhas.pop()
    linhas += ["", "## Páginas", "", f"- [{dados['nome']}]({negocio['url']}): a página do negócio, com serviços e contato."]
    return "\n".join(linhas) + "\n"


def _comparar(publicado, esperado, caminho: str, problemas: list[str]) -> None:
    if isinstance(esperado, dict) and isinstance(publicado, dict):
        for k in publicado:
            if k not in esperado:
                problemas.append(f"sem fonte: {caminho}.{k}")
        for k, v in esperado.items():
            if k not in publicado:
                problemas.append(f"falta: {caminho}.{k}")
            else:
                _comparar(publicado[k], v, f"{caminho}.{k}", problemas)
    elif isinstance(esperado, list) and isinstance(publicado, list):
        if len(publicado) != len(esperado):
            problemas.append(f"diverge da fonte: {caminho} tem {len(publicado)} item(ns), a fonte dá {len(esperado)}")
        for i, (p, e) in enumerate(zip(publicado, esperado)):
            _comparar(p, e, f"{caminho}[{i}]", problemas)
    elif publicado != esperado or type(publicado) is not type(esperado):
        problemas.append(f"diverge da fonte: {caminho} = {json.dumps(publicado, ensure_ascii=False)[:80]} "
                         f"(fonte: {json.dumps(esperado, ensure_ascii=False)[:80]})")


def conferir(pagina: str, dados: dict, places: dict | None, url: str, tem_og: bool) -> list[str]:
    """Problemas do JSON-LD publicado; [] = ok. Lê (parse), exige os campos que o Google pede ao
    LocalBusiness e compara com o que as fontes dão: nada sem fonte, nada diferente da fonte."""
    blocos = blocos_json_ld(pagina)
    if len(blocos) != 1:
        return [f"{len(blocos)} bloco(s) application/ld+json; tem de haver exatamente 1 (o id=\"{ID_DO_BLOCO}\")"]
    try:
        publicado = json.loads(blocos[0].replace("<\\/", "</"))
    except ValueError as e:
        return [f"JSON-LD ilegível: {e}"]
    problemas = []
    if not isinstance(publicado, dict) or publicado.get("@context") != "https://schema.org":
        problemas.append("@context tem de ser https://schema.org")
    grafo = publicado.get("@graph") if isinstance(publicado, dict) else None
    negocio = next((n for n in grafo or [] if isinstance(n, dict) and n.get("@type") in TIPOS_LOCAIS), None)
    if negocio is None:
        return problemas + ["nenhum nó LocalBusiness (ou subtipo) no @graph"]
    for campo in ("name", "address", "url"):
        if not negocio.get(campo):
            problemas.append(f"LocalBusiness sem {campo}")
    if negocio.get("address") and (negocio["address"].get("@type") != "PostalAddress"
                                   or not negocio["address"].get("streetAddress")):
        problemas.append("address tem de ser PostalAddress com streetAddress")
    perguntas, erros_faq, _ = perguntas_da_pagina(pagina, dados["campos"].get("Vertical", ""))
    problemas += [f"FAQ: {e}" for e in erros_faq]
    esperado = montar(dados, places, url, perguntas, texto_visivel(pagina), tem_og)
    _comparar(publicado, esperado, "$", problemas)
    return problemas


# ------------------------------------------------------------------ Places e pasta (I/O)

def chave_places(arquivo: Path | None = None) -> str | None:
    """A mesma chave do raio-x (arquivo 600 fora do repositório). Nunca vai a log nem a arquivo publicado."""
    try:
        texto = (arquivo or PLACES_ENV).read_text(encoding="utf-8")
    except OSError:
        return None
    m = re.search(r"(?m)^\s*(?:export\s+)?(?:PLACES_API_KEY|GOOGLE_MAPS_API_KEY)\s*=\s*['\"]?([^'\"\s]+)", texto)
    return m.group(1) if m else None


def pedir_places(place_id: str, chave: str) -> dict | None:
    req = urllib.request.Request(f"{PLACES_URL}/{place_id}?languageCode=pt-BR",
                                 headers={"X-Goog-Api-Key": chave, "X-Goog-FieldMask": CAMPOS_PLACES})
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)
    except Exception:  # noqa: BLE001 — sem Places o JSON-LD sai sem geo e sem horário, nunca com dado inventado
        return None


def resumir_places(bruto: dict, place_id: str, agora: dt.datetime) -> dict:
    h = bruto.get("regularOpeningHours") or {}
    return {"versao": VERSAO_CACHE, "place_id": place_id, "lido_em": agora.isoformat(timespec="seconds"),
            "location": bruto.get("location"), "postal": bruto.get("postalAddress"),
            "endereco": bruto.get("formattedAddress"), "periods": h.get("periods"),
            "dias": h.get("weekdayDescriptions"), "maps": bruto.get("googleMapsUri")}


def ler_cache(pasta: Path, place_id: str, agora: dt.datetime) -> dict | None:
    try:
        d = json.loads((pasta / CACHE).read_text(encoding="utf-8"))
        lido = dt.datetime.fromisoformat(d["lido_em"])
    except (OSError, ValueError, KeyError, TypeError):
        return None
    if d.get("versao") != VERSAO_CACHE or d.get("place_id") != place_id:
        return None
    if agora - lido > dt.timedelta(days=VALIDADE_CACHE_DIAS):
        return None
    return d


def places_do_lead(pasta: Path, place_id: str, agora: dt.datetime, pedir=None, usar_rede: bool = True) -> dict | None:
    """Do cache da pasta (até 30 dias) ou de um pedido novo ao Places; None = sem chave, sem rede ou erro."""
    cache = ler_cache(pasta, place_id, agora)
    if cache or not usar_rede or not place_id:
        return cache
    chave = chave_places()
    if pedir is None and not chave:
        return None
    bruto = (pedir or pedir_places)(place_id, chave or "")
    if not isinstance(bruto, dict) or bruto.get("id") not in (None, place_id):
        return None
    d = resumir_places(bruto, place_id, agora)
    try:
        tmp = pasta / f".{CACHE}.tmp"
        tmp.write_text(json.dumps(d, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(pasta / CACHE)
    except OSError:
        pass
    return d


def url_da_pasta(pasta: Path) -> str:
    """A URL do recibo; sem ela, o canonical da página."""
    try:
        url = json.loads((pasta / "publicado.json").read_text(encoding="utf-8-sig")).get("site_url") or ""
        if str(url).startswith("https://"):
            return str(url)
    except (OSError, ValueError, AttributeError):
        pass
    try:
        m = re.search(r"(?i)<link\b[^>]*rel\s*=\s*[\"']?canonical[\"']?[^>]*href\s*=\s*[\"']([^\"']+)",
                      (pasta / "index.html").read_text(encoding="utf-8", errors="replace"))
    except OSError:
        return ""
    return m.group(1) if m else ""


def aplicar(pasta: Path, url: str, exigir_faq: bool = False, agora: dt.datetime | None = None, pedir=None,
            usar_rede: bool = True) -> list[str]:
    """Grava o JSON-LD no index.html e os três arquivos na pasta. Devolve as FALHAs (vazia = ok).
    Com FAQ fora do contrato e `exigir_faq`, nada é gravado: o Claude corrige a seção e roda de novo."""
    agora = agora or dt.datetime.now().astimezone()
    if not re.fullmatch(r"https://[a-z0-9.-]+(?:/[A-Za-z0-9._~-]*)*", url.rstrip("/")):
        return [f"URL inválida: {url!r} (use a da linha Aliased:, ex. https://demo-<slug>.vercel.app)"]
    dados = ler_content((pasta / "content.md").read_text(encoding="utf-8", errors="replace"))
    pagina = (pasta / "index.html").read_text(encoding="utf-8")
    perguntas, erros, tem_secao = perguntas_da_pagina(pagina, dados["campos"].get("Vertical", ""))
    if exigir_faq:
        if not tem_secao:
            erros.append(f"sem <section id=\"{ID_DA_SECAO}\"> (seção de perguntas frequentes)")
        elif not MIN_PERGUNTAS <= len(perguntas) + len(erros) <= MAX_PERGUNTAS:
            erros.append(f"{len(perguntas) + len(erros)} pergunta(s); são de {MIN_PERGUNTAS} a {MAX_PERGUNTAS}")
        if erros:
            return erros
    places = places_do_lead(pasta, dados["campos"].get("place_id", ""), agora, pedir, usar_rede)
    grafo = montar(dados, places, url, perguntas, texto_visivel(pagina), (pasta / "og.jpg").is_file())
    nova = inserir(pagina, grafo, url)
    for nome, conteudo in (("index.html", nova), ("robots.txt", robots(url)), ("sitemap.xml", sitemap(url, agora.date())),
                           ("llms.txt", llms(dados, places, grafo, nova))):
        tmp = pasta / f".{nome}.seo.tmp"
        tmp.write_text(conteudo, encoding="utf-8")
        tmp.replace(pasta / nome)
    # Sem `exigir_faq` (o runner, num demo antigo) a pergunta fora do contrato fica fora do FAQPage e
    # aparece aqui como "FAQ: ...", para o log do lead.
    return conferir(nova, dados, places, url, (pasta / "og.jpg").is_file())


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("pasta", type=Path)
    ap.add_argument("--url", help="a URL do demo (linha Aliased: do deploy)")
    ap.add_argument("--exigir-faq", action="store_true", help="falha sem a seção de perguntas no contrato")
    ap.add_argument("--conferir", action="store_true", help="só confere o JSON-LD do index.html contra as fontes")
    ap.add_argument("--sem-rede", action="store_true", help="não pede o Places (usa só o cache da pasta)")
    a = ap.parse_args(argv)
    pasta = a.pasta.expanduser().resolve()
    if not (pasta / "content.md").is_file() or not (pasta / "index.html").is_file():
        print(f"ERRO: {pasta} precisa de content.md e index.html", file=sys.stderr)
        return 2
    url = a.url or url_da_pasta(pasta)
    if not url:
        print("ERRO: sem --url, sem site_url no publicado.json e sem canonical no index.html", file=sys.stderr)
        return 2
    try:
        if a.conferir:
            dados = ler_content((pasta / "content.md").read_text(encoding="utf-8", errors="replace"))
            places = ler_cache(pasta, dados["campos"].get("place_id", ""), dt.datetime.now().astimezone())
            problemas = conferir((pasta / "index.html").read_text(encoding="utf-8"), dados, places, url,
                                 (pasta / "og.jpg").is_file())
        else:
            problemas = aplicar(pasta, url, a.exigir_faq, usar_rede=not a.sem_rede)
    except (OSError, ValueError) as e:
        print(f"ERRO: {e}", file=sys.stderr)
        return 2
    for p in problemas:
        print(f"FALHA: {p}")
    if problemas:
        return 1
    print(f"OK: JSON-LD conferido com as fontes{'' if a.conferir else '; robots.txt, sitemap.xml e llms.txt gravados'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
