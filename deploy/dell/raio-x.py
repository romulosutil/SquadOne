#!/usr/bin/env python3
"""Raio-X do PRUMO: uma página por lead, em `/raio-x` do próprio demo na Vercel (Dell, 08/10/2026).

O Raio-X grátis é a porta de entrada do PRUMO (plano de 08/10/2026, no lugar do
formulário de 16 perguntas): como a empresa aparece para quem procura no Google,
o que já está bom, até 3 pontos que mandam cliente para o concorrente, o link do
demo e o preço. Alimenta a variação C da primeira mensagem do Balcão.

Feito por código, não pelo modelo: o gerador já gasta até 45 min por lead, e o
Raio-X só pode dizer o que é verificável. A única fonte é o `content.md` que o
Caçador (n8n 01, nó "Montar lead") grava a partir do Google Places:

- `Nota Google: <nota> (<n> avaliações)`, `Telefone`, `Cidade`, `Vertical`,
  `Google Maps`, `Criado em` (a data em que os dados foram lidos);
- `Site antigo, fora do ar: <url> (<motivo>)` ou `Link no Google (não é site
  próprio): <url>`; sem as duas linhas, o perfil não tem site;
- as linhas de "## Por que este lead" saem do nó "Pontuar" com regra exata:
  `horário preenchido no Google` existe se e só se o Places devolveu
  `regularOpeningHours`; `N foto(s) enviadas pelo próprio negócio` conta as fotos
  com o nome do negócio como autor. Sem a seção (leads antigos), nada disso é
  afirmado, nem para o bem nem para o mal.

O que vem da busca do Gemini ("WhatsApp achado", Instagram "achado na busca",
"dono atende pessoalmente", o briefing das avaliações) NÃO entra: não é fato
público conferido, e o `content.md` diz "confirmar à mão".

Versão 2 (08/10/2026, "raso demais"): com a chave do Google Places (arquivo
`RAIO_X_CHAVE`, padrão `~/.config/prumo/places.env`), duas chamadas por lead,
guardadas em `<pasta>/raio-x-places.json` por até 30 dias (o limite dos termos do
Google para conteúdo do Places):

- Place Details do lead: nota e avaliações de hoje, horário, o link "Site" que o
  perfil mostra agora e as até 5 avaliações que o Google mostra primeiro, com o
  nome de quem escreveu (os temas são contados por palavra, sem modelo);
- Text Search "<tipo do perfil> em <cidade>" (o que um cliente digitaria): os 10
  primeiros, com nota, avaliações e se mostram site. Daí a posição do lead e a
  comparação com os 5 primeiros que não são ele.

Sem a chave, ou com a API fora, essas seções simplesmente não aparecem. O que o
Places não entrega (se o dono responde às avaliações, quanto tempo leva para
responder mensagem) a página diz que não conferiu. A página também lê o próprio
demo (o `index.html` que está no ar) para ligar cada passo do caminho do cliente a
uma seção dele: botões de WhatsApp, ligar, mapa e as seções com âncora.

Publicação: a Vercel troca o deployment inteiro, então o Raio-X sobe junto com o
`index.html` e o `og.jpg` da pasta, no mesmo projeto `demo-<slug>` (sem projeto
novo: o hobby limita projetos). Antes, o `index.html` da pasta é comparado byte a
byte com o que está no ar: se diferem, nada sobe (o Raio-X nunca troca o demo).
Cada Raio-X custa um deploy (hobby: 100 por dia, divididos com o gerador); a saída
vai para o log do lead, onde o `lote-continuo` procura o limite.

Recibo: o `publicado.json` do lead ganha `raio_x_url` (a URL que o Balcão manda),
`raio_x_pontos` (quantos pontos de melhoria a página mostra, 1 a 3), `raio_x_versao`
e `raio_x_em`. O Balcão lê o `publicado.json` inteiro (`recibo`); um refazer do
gerador escreve recibo novo, sem esses campos, e o gancho do gerador publica o
Raio-X de novo.

Uso: raio-x SLUG...               gera e publica o Raio-X destes leads (pasta na raiz)
     raio-x --pendentes [--max N] leads `pronto` na raiz sem Raio-X atual ou com ele fora do ar
     raio-x --simular SLUG...     mostra o diagnóstico, sem publicar nem gravar
     raio-x --html SLUG --saida F grava só a página em F (prévia, sem publicar)
     raio-x --testar              testes (raiz temporária; nada toca ~/auto-site nem a rede)

A prévia (`--html`) e o `--simular` também chamam o Places quando há chave e o cache
da pasta venceu, e gravam o `raio-x-places.json` na pasta do lead.
"""
from __future__ import annotations

import argparse
import base64
import datetime as dt
import html
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import unicodedata
import urllib.request
from pathlib import Path

AUTO = Path(os.environ.get("AUTO_DIR", str(Path.home() / "auto-site")))
LOGS = AUTO / ".logs"
SITE_LEADS = Path(os.environ.get("SITE_LEADS", str(Path.home() / ".local/share/n8n-estado/site-leads.json")))
FONTE = Path(os.environ.get("RAIO_X_FONTE", str(Path.home() / ".local/share/prumo-mapa/archivo.woff2")))
VERCEL_SCOPE = os.environ.get("VERCEL_SCOPE", "romulodesigns")
# Sobe quando o texto ou as regras mudam: `--pendentes` refaz quem está `pronto` com versão menor.
# 2 (08/10/2026): concorrência da mesma busca, o que as avaliações dizem, o perfil item por item,
# o caminho do cliente ligado às seções do demo e os dois serviços com preço.
VERSAO = 2
CAMINHO = "raio-x"
MARCA = f'data-raio-x="{VERSAO}"'
MAX_PONTOS = 3
MAX_BONS = 5
LIMITE_DE_DEPLOY = re.compile(r"(?i)api-deployments-free-per-day|Resource is limited|too many deployments"
                              r"|maximum number of projects")
PRECO = "R$ 990 + R$ 69/mês"
PRECO_RESPONDIDO = "R$ 2.400 + R$ 390/mês"

# Google Places (New), opcional: sem a chave o Raio-X sai só com o content.md, como na versão 1.
# A chave fica num arquivo (600) fora do repositório, linha PLACES_API_KEY= (ou GOOGLE_MAPS_API_KEY=);
# nunca vai a log, recibo, cache nem página (vai só no header X-Goog-Api-Key).
PLACES_ENV = Path(os.environ.get("RAIO_X_CHAVE", str(Path.home() / ".config/prumo/places.env")))
PLACES_URL = "https://places.googleapis.com/v1"
# Detalhes: Place Details Enterprise + Atmosphere (as avaliações puxam o SKU mais caro).
CAMPOS_DETALHES = ("id,displayName,rating,userRatingCount,reviews,regularOpeningHours,websiteUri,businessStatus,"
                   "primaryTypeDisplayName,googleMapsUri")
# Concorrência: Text Search Enterprise (nota, avaliações e site; sem avaliações dos outros).
CAMPOS_BUSCA = ("places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri,"
                "places.businessStatus")
CACHE_PLACES = "raio-x-places.json"
# Os termos do Google Maps Platform só deixam guardar conteúdo do Places por até 30 dias.
VALIDADE_CACHE_DIAS = 30
TAMANHO_DA_BUSCA = 20  # o máximo de uma página; o Text Search cobra por pedido, não por resultado
CONCORRENTES = 5
# Onde o Google explica como ordena a busca local (relevância, distância e destaque).
FONTE_RANKING = "https://support.google.com/business/answer/7091?hl=pt-BR"


# ------------------------------------------------------------------ leitura do content.md (PURO)

def ler_content(texto: str) -> dict:
    """Os campos do `content.md` do Caçador. `sinais` = None quando não há a seção
    "Por que este lead" (aí horário e fotos ficam desconhecidos)."""
    linhas = texto.splitlines()
    nome = next((l.lstrip("#").strip() for l in linhas if l.startswith("# ")), "")
    campos: dict[str, str] = {}
    sinais: list[str] | None = None
    secao = ""
    for l in linhas:
        if l.startswith("## "):
            secao = l[3:].strip().lower()
            if secao.startswith("por que este lead"):
                sinais = []
            continue
        m = re.match(r"^- \*\*(.+?):\*\*\s*(.*)$", l)
        if m and not secao:
            campos.setdefault(m.group(1).strip(), m.group(2).strip())
            continue
        s = re.match(r"^- ([+-]\d+) (.+)$", l)
        if s and sinais is not None and secao.startswith("por que este lead"):
            sinais.append(s.group(2).strip())
    nota, avaliacoes = None, None
    m = re.match(r"^(sem nota|[\d.,]+)\s*\((\d+) avalia", campos.get("Nota Google", ""))
    if m:
        nota = None if m.group(1) == "sem nota" else float(m.group(1).replace(",", "."))
        avaliacoes = int(m.group(2))
    return {"nome": nome, "campos": campos, "sinais": sinais, "nota": nota, "avaliacoes": avaliacoes}


def tipo_de_telefone(bruto: str, pais: str = "") -> str | None:
    """A mesma regra do nó "Pontuar" do Caçador: Brasil 55 + DDD + 9 + 8 dígitos é celular."""
    d = re.sub(r"\D", "", bruto or "")
    p = sem_acento(pais).lower()
    if not d:
        return None
    if p in ("brasil", "brazil") or d.startswith("55"):
        local = d[2:] if d.startswith("55") else d
        return "celular" if len(local) == 11 and local[2] == "9" else "fixo"
    if p == "portugal" or d.startswith("351"):
        local = d[3:] if d.startswith("351") else d
        return "celular" if local[:1] == "9" else "fixo"
    return None


def sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texto or "") if unicodedata.category(c) != "Mn")


def situacao_do_site(dados: dict, detalhes: dict | None = None) -> dict | None:
    """{'tipo': 'morto'|'proprio'|'rede'|'nenhum', 'url', 'motivo'}; None = não dá para afirmar.
    Com `detalhes` (o Places de hoje), vale o link que o perfil mostra agora; 'proprio' e 'morto'
    só viram ponto depois de `conferir_site`."""
    if detalhes is not None:
        url = str(detalhes.get("site") or "")
        tipo = tipo_de_link(url)
        if tipo == "proprio":
            morto = situacao_do_site(dados)
            if morto and morto["tipo"] == "morto" and dominio(morto["url"]).lower() == dominio(url).lower():
                return morto
        return {"tipo": tipo, "url": url, "motivo": ""}
    c = dados["campos"]
    morto = c.get("Site antigo, fora do ar")
    if morto:
        m = re.match(r"^(\S+)\s*\((.*)\)\s*$", morto)
        return {"tipo": "morto", "url": m.group(1) if m else morto, "motivo": m.group(2) if m else ""}
    rede = c.get("Link no Google (não é site próprio)")
    if not rede:
        for s in dados["sinais"] or []:
            m = re.match(r"^usa rede social como site no Google: (\S+)", s)
            if m:
                rede = m.group(1)
    if rede:
        return {"tipo": "rede", "url": rede, "motivo": ""}
    # Sem a seção de sinais é um content.md antigo ou reconstruído: a falta da linha não prova nada.
    return {"tipo": "nenhum", "url": "", "motivo": ""} if dados["sinais"] is not None else None


def nome_da_rede(url: str) -> str:
    u = url.lower()
    for chave, nome in (("instagram", "o Instagram"), ("facebook", "o Facebook"), ("wa.me", "uma conversa no WhatsApp"),
                        ("whatsapp", "uma conversa no WhatsApp"), ("linktr", "uma página de links (Linktree)"),
                        ("tiktok", "o TikTok"), ("youtube", "o YouTube")):
        if chave in u:
            return nome
    return "uma página que não é de vocês"


# Palavras que não distinguem um negócio: sozinhas, não provam que a página é dele.
GENERICAS = {"advogado", "advogada", "advogados", "advocacia", "associados", "escritorio", "juridica", "juridico",
             "consultoria", "pousada", "suites", "hotel", "hostel", "engenharia", "construtora", "construcoes", "reformas",
             "servicos", "prestadora", "clinica", "odontologia", "estetica", "eventos", "espaco", "studio", "estudio",
             "desentupidora", "dedetizadora", "locacao", "locacoes", "equipamentos", "obras", "trabalhista", "familia",
             "consumidor", "bancario", "criminalista", "previdenciario", "automotiva", "buffet", "festas", "moveis",
             "planejados", "vidracaria", "marcenaria", "refrigeracao", "ltda", "brasil", "centro", "grupo"}
# Hospedagem e espaço de eventos: o Google não mostra horário comum para eles, e o argumento
# do filtro "Aberto agora" não vale (revisão de 08/10/2026: os 17 casos eram desses ramos).
SEM_HORARIO_COMUM = ("pousada", "hotel", "hostel", "chale", "camping", "evento", "buffet", "chacara", "sitio")


def conferir_site(url: str, nome: str) -> str:
    """Como está hoje o site que o Google mostrava fora do ar (o Caçador checou uma vez, e erra:
    wixsite e páginas de reserva voltam). 'fora' = não respondeu 200; 'sem_nome' = respondeu,
    mas sem nenhuma palavra própria do nome (domínio estacionado, página padrão); 'no_ar' =
    respondeu com o nome, ou não dá para saber (aí o ponto sai: na dúvida, não se afirma)."""
    codigo, corpo = baixar(url, timeout=20, navegador=True)
    if codigo != 200:
        return "fora"
    rotulo = dominio(url).split(".")[0].lower()
    texto = sem_acento(corpo.decode("utf-8", errors="replace")).lower()
    texto = texto.replace(dominio(url).lower(), " ").replace(rotulo, " ")
    palavras = [w for w in re.findall(r"[a-z0-9]{4,}", sem_acento(nome).lower()) if w not in GENERICAS]
    if not palavras:
        return "no_ar"
    return "no_ar" if any(re.search(rf"\b{re.escape(w)}\b", texto) for w in palavras) else "sem_nome"


def dominio(url: str) -> str:
    return re.sub(r"^https?://(www\.)?", "", url).split("/")[0]


def numero(n: float) -> str:
    return f"{n:.1f}".replace(".", ",")


def data_br(iso: str) -> str:
    m = re.match(r"^(\d{4})-(\d{2})-(\d{2})", iso or "")
    return f"{m.group(3)}/{m.group(2)}/{m.group(1)}" if m else ""


# ------------------------------------------------------------------ Places, avaliações e demo (PURO)

REDES = ("instagram.", "facebook.", "fb.com", "wa.me", "whatsapp.", "linktr.ee", "tiktok.", "youtube.", "linkedin.",
         "twitter.", "x.com", "beacons.ai", "bio.link", "linkme.bio", "sites.google.com/view", "business.site",
         "g.page", "goo.gl")


def tipo_de_link(url: str) -> str:
    """'proprio' | 'rede' | 'nenhum' para o site que um perfil do Google mostra. 'proprio' só diz
    que o link não é rede social; não conferimos se ele abre (isso só fazemos no site do lead)."""
    u = (url or "").strip().lower()
    if not u:
        return "nenhum"
    return "rede" if any(r in u for r in REDES) else "proprio"


def resumo_do_horario(dias: list[str] | None) -> str:
    """'aberto 6 dias por semana' a partir do weekdayDescriptions do Places; '' sem horário."""
    if not dias:
        return ""
    if all("24 horas" in d.lower() for d in dias):
        return "aberto 24 horas, todos os dias"
    abertos = sum(1 for d in dias if "fechad" not in sem_acento(d).lower())
    return f"aberto {abertos} dia{'s' if abertos != 1 else ''} por semana"


# Temas contados nas avaliações, por raiz de palavra no começo de uma palavra (sem acento).
# Só as avaliações de 4 ou 5 estrelas contam para tema: "resolveu" numa nota 1 é queixa.
# (rótulo na lista, o que as avaliações fazem — "N de M avaliações <frase>" —, raízes)
TEMAS = (
    ("Atendimento", "elogiam o atendimento",
     # "atendimento" sozinho não é elogio ("precisei de atendimento urgente", visto em 08/10/2026).
     ("atencios", "acolh", "educad", "gentil", "simpatic", "cordial", "prestativ", "paciencia", "pacient", "carinh",
      "bem atendid", "otimo atendimento", "excelente atendimento", "bom atendimento", "atendimento excelente",
      "atendimento otimo", "atendimento impecavel", "atendimento de qualidade", "atendimento nota", "atendimento top",
      "atendimento maravilhoso", "atendimento perfeito")),
    ("Explica com clareza", "falam de explicação clara",
     ("explic", "esclarec", "clareza", "orient", "transparen", "duvida")),
    ("Rapidez", "falam de rapidez", ("rapid", "agil", "agilidade", "pontual", "pontualidade", "prontamente",
                                     "no mesmo dia")),
    ("Problema resolvido", "contam que o problema foi resolvido",
     ("resolv", "resolut", "solucion", "sucesso", "ganhamos", "ganhei", "deu certo")),
    ("Competência", "elogiam a competência",
     ("competen", "profissional", "profissionais", "conhecimento", "experien", "capacitad", "qualificad", "caprich",
      "bem feito", "excelente trabalho", "otimo trabalho", "servico de qualidade")),
    ("Confiança e ética", "falam de confiança e ética",
     ("confian", "honest", "etico", "etica", "seriedade", "integridade", "seguranca", "comprometid", "compromisso")),
    ("Preço justo", "falam de preço justo", ("preco", "precos", "valor justo", "justo", "barat", "custo", "orcamento")),
    ("Recomendam", "recomendam vocês", ("recomend", "indico", "super indico")),
)


def _tem_raiz(texto: str, raiz: str) -> bool:
    return re.search(r"(?<![a-z0-9])" + re.escape(raiz), texto) is not None


def trecho(texto: str, raizes: tuple[str, ...], maximo: int = 160) -> str:
    """A frase da avaliação que contém o tema, com no máximo `maximo` caracteres cortados em palavra
    e sempre com a palavra do tema dentro (frase longa é recortada em volta dela, com reticências)."""
    t = re.sub(r"([.!?;])(?=[A-Za-zÀ-ÿ])", r"\1 ", re.sub(r"\s+", " ", texto or "")).strip()
    frases = [f.strip() for f in re.split(r"(?<=[.!?;])\s+", t) if f.strip()]
    escolhida = next((f for f in frases if any(_tem_raiz(sem_acento(f).lower(), r) for r in raizes)), "")
    if len(escolhida) <= maximo:
        return escolhida
    baixa = sem_acento(escolhida).lower()
    pos = min((m.start() for r in raizes for m in [re.search(r"(?<![a-z0-9])" + re.escape(r), baixa)] if m),
              default=0)
    inicio = 0 if pos < maximo - 40 else max(0, pos - 60)
    pedaco = escolhida[inicio:inicio + maximo - 2]
    if inicio:
        pedaco = "…" + pedaco.split(" ", 1)[-1]
    if inicio + maximo - 2 < len(escolhida):
        pedaco = pedaco.rsplit(" ", 1)[0].rstrip(",;:—-") + "…"
    return pedaco


def temas_das_avaliacoes(avaliacoes: list[dict]) -> dict:
    """{'total', 'positivas', 'criticas', 'temas': [{'tema', 'n', 'trecho', 'autor', 'autor_uri', 'nota', 'quando'}]}.
    `avaliacoes` são as do Places (até 5, as mais relevantes): conta quantas citam cada tema,
    nunca mais do que se leu. Cada tema traz um trecho de uma avaliação diferente quando dá."""
    avs = [a for a in avaliacoes or [] if isinstance(a, dict)]
    positivas = [a for a in avs if (a.get("nota") or 0) >= 4 and (a.get("texto") or "").strip()]
    temas, usadas = [], set()
    for nome, frase, raizes in TEMAS:
        quem = [a for a in positivas if any(_tem_raiz(sem_acento(a["texto"]).lower(), r) for r in raizes)]
        if not quem:
            continue
        fonte = next((a for a in quem if id(a) not in usadas), quem[0])
        usadas.add(id(fonte))
        temas.append({"tema": nome, "frase": frase, "n": len(quem), "trecho": trecho(fonte["texto"], raizes),
                      "autor": fonte.get("autor") or "", "autor_uri": fonte.get("autor_uri") or "",
                      "nota": fonte.get("nota"), "quando": fonte.get("quando") or ""})
    temas.sort(key=lambda t: -t["n"])  # estável: empate fica na ordem de TEMAS
    return {"total": len(avs), "positivas": len(positivas),
            "criticas": sum(1 for a in avs if a.get("nota") is not None and a["nota"] <= 3), "temas": temas}


def mediana(valores: list[float]) -> float | None:
    v = sorted(valores)
    if not v:
        return None
    meio = len(v) // 2
    return float(v[meio]) if len(v) % 2 else (v[meio - 1] + v[meio]) / 2


def concorrencia(places: dict | None, place_id: str) -> dict | None:
    """Quem aparece na mesma busca: {'consulta', 'lido_em', 'posicao' (1.. ou None), 'lidos',
    'outros' (os CONCORRENTES primeiros que não são o lead nem fecharam), 'com_site', 'mediana_avaliacoes'}."""
    busca = (places or {}).get("busca") or {}
    resultados = [r for r in busca.get("resultados") or [] if isinstance(r, dict)]
    if not busca.get("consulta") or not resultados:
        return None
    posicao = next((i for i, r in enumerate(resultados, 1) if r.get("id") == place_id), None)
    outros = [dict(r, pos=i) for i, r in enumerate(resultados, 1) if r.get("id") != place_id
              and r.get("status") in (None, "", "OPERATIONAL")][:CONCORRENTES]
    if not outros:
        return None
    return {"consulta": busca["consulta"], "lido_em": data_br((places or {}).get("lido_em", "")), "posicao": posicao,
            "lidos": len(resultados), "outros": outros,
            "com_site": sum(1 for r in outros if tipo_de_link(r.get("site", "")) == "proprio"),
            "mediana_avaliacoes": mediana([r["avaliacoes"] for r in outros if isinstance(r.get("avaliacoes"), int)])}


def ler_demo(texto: str) -> dict:
    """O que o demo (o index.html que está no ar) oferece a quem chega: as seções com âncora e
    título, quantos botões de WhatsApp (e se já levam a mensagem começada), ligar e mapa."""
    secoes = []
    blocos = re.split(r"(?=<(?:section|main)\b)", texto or "")
    for b in blocos:
        m = re.match(r"<(?:section|main)\b[^>]*\bid=\"([A-Za-z][\w-]*)\"", b)
        h = re.search(r"<h2\b[^>]*>(.*?)</h2>", b, re.S)
        if not m or not h:
            continue
        titulo = html.unescape(re.sub(r"<[^>]+>", " ", h.group(1)))
        titulo = re.sub(r"\s+", " ", titulo).strip()
        if titulo and m.group(1) not in {s["id"] for s in secoes}:
            secoes.append({"id": m.group(1), "titulo": titulo})
    zap = re.findall(r"href=\"(https://(?:wa\.me|api\.whatsapp\.com)/[^\"]*)\"", texto or "")
    return {"secoes": secoes, "whatsapp": len(zap), "whatsapp_com_texto": any("text=" in z for z in zap),
            "telefone": 'href="tel:' in (texto or ""),
            "mapa": re.search(r"href=\"https://(?:maps\.google\.|www\.google\.com/maps|goo\.gl/maps|maps\.app\.goo)",
                              texto or "") is not None}


def diagnostico(dados: dict, site_hoje: str | None = None, hoje: str = "", fotos_baixadas: int = 0,
                places: dict | None = None, demo: dict | None = None) -> dict:
    """O que já está bom e os pontos de melhoria (no máximo 3, na ordem de peso).
    Cada item é {'titulo', 'porque'} e só existe se o fato está no content.md ou no Places.
    `site_hoje` = `conferir_site` do site que o perfil mostra (None = não conferido:
    o ponto não sai); `hoje` = a data dessa conferência; `fotos_baixadas` = arquivos em Fotos/
    (sem nenhuma, "nenhuma foto é de vocês" poderia ser "o perfil não tem foto"); `places` =
    `ler_places` (None = sem chave ou a API falhou: nada de concorrência nem de avaliações);
    `demo` = `ler_demo` do index.html que está no ar."""
    c, sinais = dados["campos"], dados["sinais"]
    detalhes = (places or {}).get("detalhes") or None
    nota, n = dados["nota"], dados["avaliacoes"]
    if detalhes and isinstance(detalhes.get("avaliacoes"), int):
        nota, n = detalhes.get("nota"), detalhes["avaliacoes"]  # o Places de hoje vale mais que o do Caçador
    cidade = c.get("Cidade", "").strip()
    vertical = c.get("Vertical", "").strip()
    telefone = tipo_de_telefone(c.get("Telefone", ""), c.get("País", ""))
    horario = None if sinais is None else any(s.startswith("horário preenchido no Google") for s in sinais)
    if detalhes:
        horario = bool(detalhes.get("horario"))  # o mesmo campo (regularOpeningHours), lido hoje
    fotos = None
    if sinais is not None:
        fotos = 0
        for s in sinais:
            m = re.match(r"^(\d+) foto\(s\) enviadas pelo próprio negócio", s)
            if m:
                fotos = int(m.group(1))
    recente = None if sinais is None else next((s for s in sinais if s.startswith("avaliação nos últimos 30 dias")), None)

    bons: list[dict] = []
    if nota is not None and n and nota >= 4.5 and n >= 5:
        # Com poucas avaliações o número vira ponto de melhoria logo abaixo: aqui só a nota.
        bons.append({"titulo": f"Nota {numero(nota)} com {n} avaliações" if n >= 20 else f"Nota {numero(nota)} no Google",
                     "porque": "Quem compara no Google vê que quem já foi atendido gostou. É o que vocês têm de mais forte, "
                               "e é o que mais pesa quando alguém escolhe entre duas opções."})
    if telefone == "celular":
        bons.append({"titulo": "O telefone do perfil é celular",
                     "porque": "Quem acha vocês no Google pode ligar ou mandar mensagem para o número que aparece ali."})
    if horario:
        bons.append({"titulo": "Horário de funcionamento preenchido",
                     "porque": "Quem procura sabe se vocês estão abertos antes de ligar, e aparece para quem usa o filtro "
                               "“Aberto agora”."})
    if fotos:
        bons.append({"titulo": f"{fotos} foto{'s' if fotos > 1 else ''} publicada{'s' if fotos > 1 else ''} por vocês",
                     "porque": "O cliente vê o lugar do jeito que vocês escolheram mostrar."})
    if recente:
        bons.append({"titulo": "Avaliação nova nos últimos 30 dias",
                     "porque": "O perfil está vivo: quem procura vê que tem gente sendo atendida agora."})

    conc = concorrencia(places, c.get("place_id", "")) if places else None
    avals = temas_das_avaliacoes((detalhes or {}).get("textos") or []) if detalhes else None
    basicos = len(bons)
    if conc and nota is not None and nota >= 4.5:
        notas = [r["nota"] for r in conc["outros"] if isinstance(r.get("nota"), (int, float))]
        abaixo = sum(1 for x in notas if x < nota)
        if notas and abaixo * 2 >= len(notas):
            bons.append({"titulo": f"Nota maior que a de {abaixo} dos {len(conc['outros'])} primeiros da busca",
                         "porque": f"Procuramos “{conc['consulta']}” no Google: vocês têm {numero(nota)}; os outros vão de "
                                   f"{numero(min(notas))} a {numero(max(notas))}. Quem compara vê isso primeiro."})
    if conc and n and conc["mediana_avaliacoes"] is not None and n > conc["mediana_avaliacoes"]:
        bons.append({"titulo": f"Mais avaliações que a maioria dos {len(conc['outros'])} primeiros da busca",
                     "porque": f"Vocês têm {n}; no meio da lista, os outros têm {int(conc['mediana_avaliacoes'])}. "
                               "Avaliação é prova de que tem gente sendo atendida, e ela não se compra."})
    if avals and avals["temas"] and avals["temas"][0]["n"] >= 2:
        t = avals["temas"][0]
        bons.append({"titulo": f"{t['n']} de {avals['total']} avaliações {t['frase']}",
                     "porque": "Contamos nas avaliações que o Google mostra primeiro no perfil. É o que o cliente novo "
                               "lê antes de chamar, e é o que a página de vocês deve mostrar."})
    # A página mostra até MAX_BONS: o que vem da comparação e das avaliações vale mais que celular,
    # horário e fotos (que o checklist do perfil já mostra), então sobe para logo depois da nota.
    extras = bons[basicos:][::-1]  # o tema das avaliações primeiro, depois as comparações com a busca
    cabeca = 1 if basicos and bons[0]["titulo"].startswith("Nota ") else 0
    bons = bons[:cabeca] + extras + bons[cabeca:basicos]

    pontos: list[dict] = []
    site = situacao_do_site(dados, detalhes)
    onde = f"{vertical} em {cidade}" if vertical and cidade else (f"em {cidade}" if cidade else "o serviço de vocês")
    quando = f" quando conferimos ({hoje})" if hoje else " quando conferimos"
    # Na mesma busca, quantos dos primeiros mostram site próprio: o fato que dá peso ao ponto do site.
    vizinhos = ""
    if conc:
        k, m = conc["com_site"], len(conc["outros"])
        vizinhos = (f" Na busca “{conc['consulta']}”, {k} dos {m} primeiros mostram site próprio no perfil." if k
                    else f" Na busca “{conc['consulta']}”, nenhum dos {m} primeiros mostra site próprio: quem tiver "
                         "um sai na frente.")
    if site and site["tipo"] in ("morto", "proprio") and site_hoje == "fora":
        pontos.append({"titulo": "O site que aparece no Google não abre",
                       "porque": f"Quem toca em “Site” no perfil de vocês vai para {dominio(site['url'])}, que não abriu"
                                 f"{quando}. A pessoa volta para a busca, e o próximo resultado está a um toque." + vizinhos})
    elif site and site["tipo"] in ("morto", "proprio") and site_hoje == "sem_nome":
        pontos.append({"titulo": "O site do Google não leva a um site de vocês",
                       "porque": f"Quem toca em “Site” no perfil de vocês vai para {dominio(site['url'])}, que{quando} "
                                 "mostrava uma página sem o nome de vocês. A pessoa volta para a busca, e o próximo "
                                 "resultado está a um toque." + vizinhos})
    elif site and site["tipo"] == "rede":
        rede = nome_da_rede(site["url"])
        porque = ("Quem ainda está comparando quer ver o trabalho antes de chamar. Sem uma página com os serviços e as "
                  "fotos, só chama quem já decidiu, e quem está em dúvida vai para quem mostra.")
        if rede in ("o Instagram", "o Facebook", "o TikTok"):
            porque = ("Quem está comparando quer ver os serviços, as fotos e como chamar numa página só. Na rede social "
                      "isso fica espalhado entre posts, e muita gente desiste ali.")
        pontos.append({"titulo": f"O botão “Site” no Google leva para {rede}", "porque": porque + vizinhos})
    elif site and site["tipo"] == "nenhum":
        pontos.append({"titulo": "O perfil do Google não tem site",
                       "porque": f"Quem procura {onde} compara duas ou três opções. Sem site, vocês aparecem só com "
                                 "nome e nota, e quem mostra serviços e fotos leva o cliente." + vizinhos})
    if conc and (conc["posicao"] is None or conc["posicao"] > 3):
        onde_aparece = (f"Vocês não aparecem entre os {conc['lidos']} primeiros" if conc["posicao"] is None
                        else f"Vocês aparecem em {conc['posicao']}º lugar")
        pontos.append({"titulo": (f"Fora dos {conc['lidos']} primeiros em “{conc['consulta']}”" if conc["posicao"] is None
                                  else f"{conc['posicao']}º lugar em “{conc['consulta']}”"),
                       "porque": f"{onde_aparece} quando se procura “{conc['consulta']}” (busca de {conc['lido_em']}). "
                                 "O Google diz que ordena a busca local por relevância, distância e destaque, e que o "
                                 "destaque leva em conta o que existe sobre o negócio na internet, como site e avaliações."})
    # Telefone fixo não vira ponto: o Caçador só deixa passar fixo com WhatsApp publicado, então
    # "não tem como mandar mensagem" seria falso em todos (revisão de 08/10/2026, 9 de 9).
    sem_horario_comum = any(r in sem_acento(vertical).lower() for r in SEM_HORARIO_COMUM)
    if horario is False and not sem_horario_comum:
        pontos.append({"titulo": "O horário de funcionamento não aparece no Google",
                       "porque": "Quem procura não sabe se vocês estão abertos, e quem usa o filtro “Aberto agora” nem vê "
                                 "vocês na lista."})
    if nota is not None and nota < 4.3:
        pontos.append({"titulo": f"Nota {numero(nota)} no Google",
                       "porque": "Na lista do Google a nota é a primeira coisa que se compara. Responder às avaliações e "
                                 "pedir avaliação a quem saiu satisfeito é o que mais mexe nesse número."})
    med = conc["mediana_avaliacoes"] if conc else None
    comparacao = (f" Na busca “{conc['consulta']}”, os {len(conc['outros'])} primeiros têm, no meio da lista, "
                  f"{int(med)} avaliações." if conc and med is not None else "")
    if n is not None and n < 20:
        pontos.append({"titulo": "Ainda sem avaliações no Google" if n == 0 else f"Só {n} avaliaç{'ão' if n == 1 else 'ões'} no Google",
                       "porque": "Entre duas opções parecidas, o cliente confia em quem tem mais avaliações. Pedir na hora, "
                                 "a quem saiu satisfeito, é o jeito mais barato de crescer esse número." + comparacao})
    elif n is not None and med is not None and n * 2 < med:
        pontos.append({"titulo": f"{n} avaliações, menos da metade do que os primeiros da busca têm",
                       "porque": "Entre duas opções parecidas, o cliente confia em quem tem mais avaliações." + comparacao
                                 + " Pedir na hora, a quem saiu satisfeito, é o jeito mais barato de encurtar a distância."})
    if fotos == 0 and fotos_baixadas > 0:
        pontos.append({"titulo": "Nenhuma das primeiras fotos do perfil é de vocês",
                       "porque": "As fotos que o cliente vê primeiro foram publicadas por outras pessoas. É a primeira "
                                 "impressão do lugar, e vocês não escolheram."})
    # O número de avaliações não pode ser força e fraqueza na mesma página.
    if any("menos da metade" in p["titulo"] for p in pontos[:MAX_PONTOS]) and bons and bons[0]["titulo"].startswith("Nota "):
        bons[0] = dict(bons[0], titulo=f"Nota {numero(nota)} no Google")
    return {"bons": bons, "pontos": pontos[:MAX_PONTOS], "lido_em": data_br(c.get("Criado em", "")),
            "maps": (detalhes or {}).get("maps") or c.get("Google Maps", ""), "cidade": cidade, "vertical": vertical,
            "nota": nota, "avaliacoes": n, "horario": horario, "fotos": fotos, "fotos_baixadas": fotos_baixadas,
            "telefone": telefone, "recente": recente, "site": site, "site_hoje": site_hoje, "hoje": hoje,
            "concorrencia": conc, "avaliacoes_lidas": avals, "demo": demo,
            "places_em": data_br((places or {}).get("lido_em", "")),
            "horario_resumo": resumo_do_horario((detalhes or {}).get("horario")),
            "endereco": c.get("Endereço", "").strip()}


# ------------------------------------------------------------------ página (PURO)

CSS = """
:root{--ferro-900:#1B1512;--ferro-800:#241D19;--ferro-600:#4A3E36;--brasa:#E0490F;--brasa-clara:#FF6A2B;
--oxido:#8A2B0C;--ocre:#E8A33D;--pedra-100:#E4DED6;--pedra-200:#CFC7BD;--pedra-400:#9A9089;--pedra-600:#6B625B;
color-scheme:light}
*{box-sizing:border-box;margin:0;padding:0;border-radius:0}
html{background:var(--pedra-100);-webkit-text-size-adjust:100%}
body{font-family:'Archivo','Arial Narrow','Helvetica Neue',Arial,sans-serif;font-size:17px;line-height:1.5;
color:var(--ferro-900);background:var(--pedra-100)}
a{color:inherit}
.folha{max-width:760px;margin:0 auto;padding:20px 16px 48px}
.topo{display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:2px solid var(--ferro-900);
padding-bottom:10px}
.marca{display:flex;align-items:center;gap:7px;font-size:15px;letter-spacing:.02em;font-weight:900;
font-variation-settings:'wdth' 118,'wght' 900}
.marca .fio{width:2px;height:15px;background:var(--brasa);display:block}
.brasa{color:var(--brasa)}
.miudo{font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--pedra-600)}
.kicker{font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--oxido);margin-top:36px}
h1{font-size:clamp(34px,8vw,54px);line-height:.98;letter-spacing:-.025em;font-weight:800;margin-top:10px;
font-variation-settings:'wdth' 108,'wght' 800;overflow-wrap:anywhere}
.lede{color:var(--ferro-600);margin-top:12px;max-width:60ch}
.nota{display:flex;align-items:flex-end;gap:16px;margin-top:28px;border-top:2px solid var(--ferro-900);
border-bottom:2px solid var(--ferro-900);padding:18px 0}
.nota .num{font-size:64px;line-height:.85;font-weight:900;letter-spacing:-.03em;font-variation-settings:'wdth' 118,'wght' 900}
.nota .leitura{color:var(--ferro-600);font-size:15px}
section{margin-top:44px}
h2{font-size:clamp(24px,5vw,32px);line-height:1.08;font-weight:800;letter-spacing:-.015em;
font-variation-settings:'wdth' 104,'wght' 800}
.lista{list-style:none;margin-top:16px;border-top:1px solid var(--pedra-400)}
.lista li{padding:16px 0;border-bottom:1px solid var(--pedra-400);display:grid;grid-template-columns:44px 1fr;gap:12px}
.lista li > div{min-width:0}
.lista .marcador{font-size:13px;font-weight:800;letter-spacing:.08em;padding-top:4px;color:var(--pedra-600)}
.lista h3{font-size:19px;line-height:1.25;font-weight:750;font-variation-settings:'wght' 750}
.lista p{color:var(--ferro-600);margin-top:4px;font-size:16px}
.pontos .lista li{border-left:4px solid var(--brasa);padding-left:14px;grid-template-columns:52px 1fr}
.pontos .lista .marcador{font-size:28px;line-height:1;color:var(--brasa);padding-top:0;font-weight:900;
font-variation-settings:'wdth' 118,'wght' 900}
.bons .lista .marcador{color:var(--ferro-900)}
.demo{display:grid;gap:16px}
.demo img{display:block;width:100%;height:auto;border:2px solid var(--ferro-900);background:var(--pedra-200)}
.botao{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 20px;
background:var(--ferro-900);color:var(--pedra-100);text-decoration:none;font-weight:800;letter-spacing:.02em;
border:2px solid var(--ferro-900)}
.botao:hover{background:var(--brasa);border-color:var(--brasa);color:var(--ferro-900)}
.botao:focus-visible{outline:3px solid var(--ocre);outline-offset:3px}
.escura{background:var(--ferro-900);color:var(--pedra-100);padding:28px 22px;display:grid;gap:12px}
.escura h2{color:var(--pedra-100)}
.escura .preco{font-size:clamp(28px,7vw,40px);font-weight:900;line-height:1;color:var(--brasa-clara);
font-variation-settings:'wdth' 112,'wght' 900}
.escura p{color:var(--pedra-200);max-width:56ch}
.escura strong{color:var(--pedra-100)}
footer{margin-top:40px;border-top:2px solid var(--pedra-400);padding-top:12px;font-size:13px;color:var(--pedra-600);
display:grid;gap:6px}
.intro{color:var(--ferro-600);margin-top:10px;max-width:60ch}
.resumo{margin-top:28px;display:grid;gap:0;border:2px solid var(--ferro-900)}
.resumo div{padding:14px 16px;display:grid;gap:2px}
.resumo div + div{border-top:2px solid var(--ferro-900);background:var(--ferro-900);color:var(--pedra-100)}
.resumo .miudo{color:inherit;opacity:.8}
.resumo strong{font-size:19px;line-height:1.25;font-weight:750}
.busca{list-style:none;margin-top:16px;border-top:2px solid var(--ferro-900)}
.busca li{display:grid;grid-template-columns:36px 1fr;gap:4px 10px;padding:12px 0;border-bottom:1px solid var(--pedra-400)}
.busca .pos{font-weight:900;font-size:20px;line-height:1.1;font-variation-settings:'wdth' 118,'wght' 900;color:var(--pedra-600)}
.busca .quem{font-weight:700;overflow-wrap:anywhere}
.busca .dados{grid-column:2;font-size:15px;color:var(--ferro-600)}
.busca .sem{color:var(--oxido);font-weight:700}
.busca li.voces{background:var(--pedra-200);border-left:4px solid var(--brasa);padding-left:8px}
.busca li.voces .pos{color:var(--brasa)}
.temas{list-style:none;margin-top:16px;display:grid;gap:8px}
.temas li{display:grid;grid-template-columns:1fr auto;gap:12px;align-items:baseline;border-bottom:1px solid var(--pedra-400);
padding-bottom:8px}
.temas .conta{font-weight:900;font-variation-settings:'wdth' 112,'wght' 900;white-space:nowrap}
.temas .barra{grid-column:1/-1;height:6px;background:var(--pedra-200)}
.temas .barra span{display:block;height:100%;background:var(--brasa)}
blockquote{margin-top:16px;border-left:4px solid var(--ferro-900);padding:4px 0 4px 14px}
blockquote p{font-size:18px;line-height:1.4}
blockquote cite{display:block;font-style:normal;font-size:14px;color:var(--pedra-600);margin-top:4px}
.check{list-style:none;margin-top:16px;border-top:1px solid var(--pedra-400)}
.check li{display:grid;grid-template-columns:28px 1fr;gap:4px 10px;padding:12px 0;border-bottom:1px solid var(--pedra-400)}
.check .sinal{font-weight:900;font-size:18px;line-height:1.2}
.check .ok .sinal{color:var(--ferro-900)}
.check .falta .sinal{color:var(--brasa)}
.check .nc .sinal{color:var(--pedra-400)}
.check .det{grid-column:2;font-size:15px;color:var(--ferro-600)}
.jornada{list-style:none;margin-top:16px;counter-reset:passo}
.jornada > li{border-top:2px solid var(--ferro-900);padding:14px 0 18px;display:grid;gap:8px}
.jornada h3{font-size:19px;line-height:1.25;font-weight:750}
.jornada h3 span{color:var(--brasa);margin-right:8px}
.jornada .hoje,.jornada .nodemo{display:grid;grid-template-columns:76px 1fr;gap:10px;font-size:16px;color:var(--ferro-600)}
.jornada .rotulo{font-size:12px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;padding-top:3px;color:var(--pedra-600)}
.jornada .nodemo .rotulo{color:var(--oxido)}
.jornada ul{list-style:none;display:grid;gap:4px}
.jornada ul a{color:var(--ferro-900);text-decoration-color:var(--brasa);text-underline-offset:3px}
.servicos{display:grid;gap:18px}
.servico{border-top:1px solid var(--ferro-600);padding-top:14px;display:grid;gap:6px}
.servico h3{font-size:20px;font-weight:800;color:var(--pedra-100)}
.metodo{list-style:none;margin-top:12px;display:grid;gap:8px;font-size:15px;color:var(--ferro-600)}
.metodo li{padding-left:14px;border-left:2px solid var(--pedra-400)}
.visualmente-oculto{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (min-width:640px){.resumo{grid-template-columns:1fr 1fr}.resumo div + div{border-top:0;border-left:2px solid var(--ferro-900)}
.servicos{grid-template-columns:1fr 1fr}}
@media (prefers-reduced-motion:no-preference){.botao{transition:background-color .15s ease,color .15s ease}}
"""


def fonte_css(caminho: Path = FONTE) -> str:
    """Archivo (a fonte do PRUMO) embutida: a página é um arquivo só, sem CDN."""
    try:
        dados = base64.b64encode(caminho.read_bytes()).decode("ascii")
    except OSError:
        return ""
    return ("@font-face{font-family:'Archivo';src:url(data:font/woff2;base64," + dados
            + ") format('woff2');font-weight:100 900;font-stretch:62% 125%;font-display:swap}")


def pagina(dados: dict, diag: dict, site_url: str, tem_og: bool, fonte: str = "") -> str:
    e = lambda t: html.escape(str(t), quote=True)  # noqa: E731
    nome = dados["nome"] or "a empresa"
    nota, n = diag.get("nota", dados["nota"]), diag.get("avaliacoes", dados["avaliacoes"])
    pontos, bons = diag["pontos"], diag["bons"][:MAX_BONS]
    base = site_url.rstrip("/")
    onde = " · ".join(x for x in (diag["vertical"].capitalize(), diag["cidade"]) if x)
    titulo_pontos = (f"{len(pontos)} ponto{'s' if len(pontos) > 1 else ''} que "
                     f"{'mandam' if len(pontos) > 1 else 'manda'} cliente para o concorrente")
    item = lambda i, x: (f'<li><span class="marcador">{e(i)}</span><div><h3>{e(x["titulo"])}</h3>'  # noqa: E731
                         f'<p>{e(x["porque"])}</p></div></li>')
    partes = [
        "<!doctype html><html lang=\"pt-BR\"><head><meta charset=\"utf-8\">",
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="robots" content="noindex,nofollow">',
        f"<title>Raio-X · {e(nome)}</title>",
        f'<meta name="description" content="Como {e(nome)} aparece para quem procura no Google: o que já está bom e o que manda cliente para o concorrente.">',
        '<meta property="og:type" content="website"><meta property="og:locale" content="pt_BR">',
        f'<meta property="og:title" content="Raio-X · {e(nome)}">',
        '<meta property="og:description" content="Como vocês aparecem para quem procura no Google, feito pelo PRUMO só com dados públicos.">',
    ]
    if tem_og:
        partes += [f'<meta property="og:image" content="{e(base)}/og.jpg">',
                   '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
                   '<meta name="twitter:card" content="summary_large_image">']
    partes += [
        '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E'
        '%3Crect width=%2216%22 height=%2216%22 fill=%22%231B1512%22/%3E%3Crect x=%227%22 y=%223%22 width=%222%22 height=%2210%22 fill=%22%23E0490F%22/%3E%3C/svg%3E">',
        f"<style>{fonte}{CSS}</style></head>",
        f'<body {MARCA}><main class="folha">',
        '<header class="topo"><div class="marca"><span class="fio"></span><span>PRU<span class="brasa">MO</span></span></div>'
        '<span class="miudo">Raio-X</span></header>',
        '<p class="kicker">Como vocês aparecem no Google</p>',
        f"<h1>{e(nome)}</h1>",
    ]
    if onde:
        partes.append(f'<p class="lede">{e(onde)}. Feito pelo PRUMO só com o que qualquer pessoa vê no Google, sem pedir nada a vocês.</p>')
    else:
        partes.append('<p class="lede">Feito pelo PRUMO só com o que qualquer pessoa vê no Google, sem pedir nada a vocês.</p>')
    lido = diag.get("places_em") or diag["lido_em"]
    if nota is not None and n:
        partes.append(f'<div class="nota"><span class="num">{e(numero(nota))}</span>'
                      f'<span class="leitura">nota no Google<br>{e(n)} avaliaç{"ão" if n == 1 else "ões"}'
                      f'{"<br>lida em " + e(lido) if lido else ""}</span></div>')
    if bons and pontos:
        partes.append('<div class="resumo"><div><span class="miudo">O que segura cliente</span>'
                      f'<strong>{e(bons[0]["titulo"])}</strong></div><div><span class="miudo">O que perde cliente</span>'
                      f'<strong>{e(pontos[0]["titulo"])}</strong></div></div>')
    if bons:
        partes.append('<section class="bons"><h2>O que já está bom</h2><ul class="lista">'
                      + "".join(item("✓", b) for b in bons) + "</ul></section>")
    if pontos:
        partes.append(f'<section class="pontos"><h2>{e(titulo_pontos)}</h2><ul class="lista">'
                      + "".join(item(f"{i:02d}", p) for i, p in enumerate(pontos, 1)) + "</ul></section>")
    partes.append(secao_busca(diag, nome, e))
    partes.append(secao_avaliacoes(diag, e))
    linhas = checklist(diag)
    if linhas:
        sinal = {"ok": "✓", "falta": "✕", "nc": "–"}
        partes.append('<section><h2>O perfil no Google, item por item</h2>'
                      '<p class="intro">O que o cliente encontra quando abre o perfil de vocês no Google Maps.</p><ul class="check">'
                      + "".join(f'<li class="{x["estado"]}"><span class="sinal" aria-hidden="true">{sinal[x["estado"]]}</span>'
                                f'<span><span class="visualmente-oculto">{e({"ok": "Em dia: ", "falta": "Falta: ", "nc": "Não conferido: "}[x["estado"]])}</span>'
                                f'{e(x["item"])}</span><span class="det">{e(x["detalhe"])}</span></li>' for x in linhas)
                      + "</ul></section>")
    passos = jornada(diag)
    if passos:
        corpo = []
        for i, p in enumerate(passos, 1):
            bloco = [f'<li><h3><span>{i:02d}</span>{e(p["titulo"])}</h3>',
                     f'<div class="hoje"><span class="rotulo">Hoje</span><span>{e(p["hoje"])}</span></div>']
            if p["demo"]:
                itens = "".join(f'<li><a href="{e(h)}">{e(t)}</a></li>' if h else f"<li>{e(t)}</li>" for t, h in p["demo"])
                bloco.append(f'<div class="nodemo"><span class="rotulo">{e(p["rotulo"])}</span><ul>{itens}</ul></div>')
            bloco.append("</li>")
            corpo.append("".join(bloco))
        partes.append('<section><h2>O caminho do cliente até vocês</h2>'
                      '<p class="intro">Do Google até a primeira conversa: onde o caminho de hoje perde gente e o que '
                      'a demonstração que montamos já resolve.</p><ol class="jornada">' + "".join(corpo) + "</ol></section>")
    demo = ['<section class="demo"><h2>Montamos uma demonstração do site de vocês</h2>']
    if tem_og:
        demo.append(f'<a href="/" aria-label="Abrir a demonstração do site de {e(nome)}">'
                    f'<img src="/og.jpg" width="1200" height="630" alt="Prévia da demonstração do site de {e(nome)}" loading="lazy"></a>')
    demo.append('<p>Com o nome, o contato e o jeito de vocês. Abre no celular do mesmo jeito que o cliente veria.</p>'
                '<p><a class="botao" href="/">Ver a demonstração</a></p></section>')
    partes += demo
    partes.append('<section class="escura"><h2>O próximo passo</h2><div class="servicos">'
                  '<div class="servico"><h3>Encontrado</h3>'
                  f'<p class="preco">{e(PRECO)}</p>'
                  '<p>Esta demonstração no ar, com o endereço de vocês e ligada ao botão “Site” do Google. Hospedagem e '
                  'ajustes incluídos. <strong>Vocês só pagam depois de ver funcionando.</strong></p></div>'
                  '<div class="servico"><h3>Respondido e Acompanhado</h3>'
                  f'<p class="preco">{e(PRECO_RESPONDIDO)}</p>'
                  '<p>O WhatsApp de vocês responde quem chama, tira as dúvidas de sempre e agenda.</p></div>'
                  '</div><p>Para conversar sobre qualquer um dos dois, é só responder a mensagem no WhatsApp.</p></section>')
    partes.append(secao_metodo(diag, e))
    rodape = ["<footer>"]
    rodape.append(f"<span>Dados públicos do Google Maps{', lidos em ' + e(lido) if lido else ''}."
                  + (f' <a href="{e(diag["maps"])}" rel="noopener">Ver o perfil no Google Maps</a>.' if diag["maps"].startswith("https://") else "")
                  + "</span>")
    rodape.append('<span>PRUMO · <a href="https://prumo.services" rel="noopener">prumo.services</a></span></footer>')
    partes += rodape
    partes.append("</main></body></html>\n")
    return "\n".join(p for p in partes if p)


def checklist(diag: dict) -> list[dict]:
    """O perfil item por item: {'estado': 'ok'|'falta'|'nc', 'item', 'detalhe'}. 'nc' = não conferido
    (o dado não existe para este lead); nada é marcado 'falta' sem o fato."""
    linhas = []
    nota, n = diag.get("nota"), diag.get("avaliacoes")
    if nota is not None and n:
        linhas.append({"estado": "ok" if nota >= 4.3 else "falta", "item": "Nota",
                       "detalhe": f"{numero(nota)} de 5"})
    if n is not None:
        linhas.append({"estado": "ok" if n >= 20 else "falta", "item": "Avaliações",
                       "detalhe": f"{n} no total" + ("" if n >= 20 else "; entre duas opções, pesa quem tem mais")})
    if diag.get("recente"):
        linhas.append({"estado": "ok", "item": "Avaliação recente", "detalhe": "há avaliação dos últimos 30 dias"})
    tel = diag.get("telefone")
    if tel:
        linhas.append({"estado": "ok", "item": "Telefone",
                       "detalhe": "celular: dá para ligar ou mandar mensagem" if tel == "celular" else "fixo"})
    h = diag.get("horario")
    sem_comum = any(r in sem_acento(diag.get("vertical", "")).lower() for r in SEM_HORARIO_COMUM)
    if h:
        linhas.append({"estado": "ok", "item": "Horário de funcionamento",
                       "detalhe": diag.get("horario_resumo") or "preenchido"})
    elif h is False:
        linhas.append({"estado": "nc" if sem_comum else "falta", "item": "Horário de funcionamento",
                       "detalhe": "o Google não mostra horário comum para este ramo" if sem_comum
                       else "não aparece; quem usa o filtro “Aberto agora” não vê vocês"})
    else:
        linhas.append({"estado": "nc", "item": "Horário de funcionamento", "detalhe": "não conferido"})
    f = diag.get("fotos")
    if f:
        linhas.append({"estado": "ok", "item": "Fotos", "detalhe": f"{f} publicada{'s' if f > 1 else ''} por vocês entre as primeiras"})
    elif f == 0 and diag.get("fotos_baixadas"):
        linhas.append({"estado": "falta", "item": "Fotos", "detalhe": "as primeiras foram publicadas por outras pessoas"})
    else:
        linhas.append({"estado": "nc", "item": "Fotos", "detalhe": "não conferido"})
    site, hoje = diag.get("site"), diag.get("site_hoje")
    if site is None:
        linhas.append({"estado": "nc", "item": "Site", "detalhe": "não conferido"})
    elif site["tipo"] == "nenhum":
        linhas.append({"estado": "falta", "item": "Site", "detalhe": "o perfil não tem"})
    elif site["tipo"] == "rede":
        linhas.append({"estado": "falta", "item": "Site", "detalhe": f"o botão leva para {nome_da_rede(site['url'])}"})
    elif hoje == "no_ar":
        linhas.append({"estado": "ok", "item": "Site", "detalhe": f"{dominio(site['url'])} abriu quando conferimos"})
    elif hoje in ("fora", "sem_nome"):
        linhas.append({"estado": "falta", "item": "Site",
                       "detalhe": f"{dominio(site['url'])} " + ("não abriu" if hoje == "fora" else "mostrava uma página sem o nome de vocês")
                                  + (f" em {diag['hoje']}" if diag.get("hoje") else "")})
    else:
        linhas.append({"estado": "nc", "item": "Site", "detalhe": "não conferido"})
    if diag.get("endereco"):
        linhas.append({"estado": "ok", "item": "Endereço no mapa", "detalhe": "aparece no perfil"})
    return linhas


def jornada(diag: dict) -> list[dict]:
    """O caminho do cliente: procura, compara, conhece, chama, espera. Cada passo diz o que está
    acontecendo hoje (só fato) e o que a demonstração já resolve (lido do index.html dela)."""
    conc, site, hoje, demo = diag.get("concorrencia"), diag.get("site"), diag.get("site_hoje"), diag.get("demo") or {}
    nota, n = diag.get("nota"), diag.get("avaliacoes")
    passos = []
    if conc:
        hoje_busca = (f"Em “{conc['consulta']}”, vocês aparecem em {conc['posicao']}º lugar." if conc["posicao"]
                      else f"Em “{conc['consulta']}”, vocês não aparecem entre os {conc['lidos']} primeiros.")
    else:
        hoje_busca = "Não medimos a posição de vocês na busca."
    passos.append({"titulo": "Procura no Google", "hoje": hoje_busca, "rotulo": "Com o site",
                   "demo": [("O botão “Site” do perfil passa a levar para uma página de vocês.", None)]})
    vistos = []
    if nota is not None and n:
        vistos.append(f"nota {numero(nota)} com {n} avaliações")
    if diag.get("fotos"):
        vistos.append(f"{diag['fotos']} fotos de vocês")
    if diag.get("horario"):
        vistos.append("o horário")
    passos.append({"titulo": "Abre o perfil e compara",
                   "hoje": ("Vê " + ", ".join(vistos) + ".") if vistos else "Vê o nome e o endereço.",
                   "rotulo": "", "demo": []})
    if site is None:
        hoje_site = "Não conferimos para onde leva o botão “Site”."
    elif site["tipo"] == "nenhum":
        hoje_site = "Não há botão “Site” no perfil: para saber mais, a pessoa precisa ligar ou procurar outro."
    elif site["tipo"] == "rede":
        hoje_site = f"O botão “Site” leva para {nome_da_rede(site['url'])}."
    elif hoje == "fora":
        hoje_site = f"O botão “Site” leva para {dominio(site['url'])}, que não abriu quando conferimos."
    elif hoje == "sem_nome":
        hoje_site = f"O botão “Site” leva para {dominio(site['url'])}, uma página sem o nome de vocês."
    else:
        hoje_site = f"O botão “Site” leva para {dominio(site['url'])}."
    secoes = [(s["titulo"] if len(s["titulo"]) <= 80 else s["titulo"][:79].rsplit(" ", 1)[0] + "…", f"/#{s['id']}")
              for s in (demo.get("secoes") or [])[:6]]
    passos.append({"titulo": "Toca em “Site” para conhecer o trabalho", "hoje": hoje_site, "rotulo": "No demo", "demo": secoes})
    tel = diag.get("telefone")
    hoje_chama = ("O número do perfil é celular: dá para ligar ou mandar mensagem." if tel == "celular"
                  else "O número do perfil é fixo." if tel == "fixo" else "Liga para o número do perfil.")
    chama = []
    if demo.get("whatsapp"):
        k = demo["whatsapp"]
        chama.append((f"Botão de WhatsApp em {k} ponto{'s' if k > 1 else ''} da página"
                      + (", com a mensagem já começada." if demo.get("whatsapp_com_texto") else "."), None))
    if demo.get("telefone"):
        chama.append(("Tocar no número liga direto.", None))
    if demo.get("mapa"):
        chama.append(("O endereço abre no Google Maps.", None))
    passos.append({"titulo": "Chama", "hoje": hoje_chama, "rotulo": "No demo", "demo": chama})
    passos.append({"titulo": "Espera a resposta",
                   "hoje": "De fora não dá para ver quanto tempo vocês levam para responder, nem quantas mensagens "
                           "ficam para depois.",
                   "rotulo": "Com o PRUMO",
                   "demo": [("O Respondido e Acompanhado responde quem chama, tira as dúvidas de sempre e agenda.", None)]})
    return passos


def secao_busca(diag: dict, nome: str, e) -> str:
    conc = diag.get("concorrencia")
    if not conc:
        return ""
    linhas = []
    voces_dentro = conc["posicao"] is not None and conc["posicao"] <= max(r["pos"] for r in conc["outros"])
    site = diag.get("site") or {}
    rotulo_site = {"nenhum": "sem site", "rede": "site: rede social"}.get(site.get("tipo", ""), "")
    if site.get("tipo") in ("morto", "proprio"):
        rotulo_site = {"fora": "site fora do ar", "sem_nome": "site sem o nome de vocês", "no_ar": "site próprio"}.get(
            diag.get("site_hoje") or "", "site não conferido")
    nota, n = diag.get("nota"), diag.get("avaliacoes")
    voces = {"pos": conc["posicao"], "nome": f"{nome} (vocês)", "nota": nota, "avaliacoes": n, "voces": True,
             "rotulo": rotulo_site}
    todos = sorted(conc["outros"] + ([voces] if voces_dentro else []), key=lambda r: r["pos"])
    for r in todos:
        if r.get("voces"):
            rot = r["rotulo"]
        else:
            t = tipo_de_link(r.get("site", ""))
            rot = {"proprio": "site próprio", "rede": "site: rede social", "nenhum": "sem site"}[t]
        nota_txt = f"{numero(r['nota'])} de nota" if isinstance(r.get("nota"), (int, float)) else "sem nota"
        aval = f"{r['avaliacoes']} avaliações" if isinstance(r.get("avaliacoes"), int) else "sem avaliações"
        classe = ' class="voces"' if r.get("voces") else ""
        sem = ' class="sem"' if rot in ("sem site", "site fora do ar", "site sem o nome de vocês", "site: rede social") else ""
        linhas.append(f'<li{classe}><span class="pos">{e(r["pos"])}º</span><span class="quem">{e(r.get("nome") or "")}</span>'
                      f'<span class="dados">{e(nota_txt)} · {e(aval)} · <span{sem}>{e(rot)}</span></span></li>')
    fora = "" if voces_dentro else (
        f'<p class="intro">Vocês aparecem em {e(conc["posicao"])}º lugar nesta busca.</p>' if conc["posicao"]
        else f'<p class="intro">Vocês não apareceram entre os {e(conc["lidos"])} primeiros desta busca.</p>')
    k, m = conc["com_site"], len(conc["outros"])
    return (f'<section><h2>Quem aparece quando procuram “{e(conc["consulta"])}”</h2>'
            f'<p class="intro">Fizemos a busca no Google em {e(conc["lido_em"])}. Dos {m} primeiros que não são vocês, '
            f'{e(k)} mostra{"m" if k != 1 else ""} site próprio no perfil.</p>'
            f'<ol class="busca">{"".join(linhas)}</ol>{fora}</section>')


def secao_avaliacoes(diag: dict, e) -> str:
    av = diag.get("avaliacoes_lidas")
    if not av or not av["total"]:
        return ""
    total = av["total"]
    partes = [f'<section><h2>O que os clientes dizem</h2><p class="intro">Lemos as {total} avaliações que o Google '
              f'mostra primeiro no perfil de vocês e contamos do que elas falam.'
              + (f" {av['criticas']} delas {'tem' if av['criticas'] == 1 else 'têm'} nota 3 ou menos." if av["criticas"] else "")
              + "</p>"]
    if av["temas"]:
        partes.append('<ul class="temas">' + "".join(
            f'<li><span>{e(t["tema"])}</span><span class="conta">{t["n"]} de {total}</span>'
            f'<span class="barra" aria-hidden="true"><span style="width:{round(100 * t["n"] / total)}%"></span></span></li>'
            for t in av["temas"][:5]) + "</ul>")
    citados, autores = set(), set()
    for t in av["temas"]:
        if len(citados) >= 3:
            break
        # Trecho curto ("Recomendo.") não prova nada, e a mesma pessoa não fala duas vezes.
        if len(t["trecho"]) < 25 or t["trecho"] in citados or (t["autor"] and t["autor"] in autores):
            continue
        citados.add(t["trecho"])
        autores.add(t["autor"])
        autor = e(t["autor"] or "cliente")
        if str(t.get("autor_uri") or "").startswith("https://"):
            autor = f'<a href="{e(t["autor_uri"])}" rel="noopener">{autor}</a>'
        estrelas = f", {t['nota']} estrelas" if t.get("nota") else ""
        quando = f", {e(t['quando'])}" if t.get("quando") else ""
        partes.append(f'<blockquote><p>“{e(t["trecho"])}”</p><cite>{autor}{e(estrelas)}{quando}, no Google</cite></blockquote>')
    partes.append("</section>")
    return "".join(partes)


def secao_metodo(diag: dict, e) -> str:
    itens = []
    if diag.get("places_em"):
        itens.append(f"Nota, avaliações, horário e site do perfil: lidos do Google em {e(diag['places_em'])}.")
    elif diag.get("lido_em"):
        itens.append(f"Nota, avaliações, horário, fotos e site do perfil: lidos do Google em {e(diag['lido_em'])}.")
    conc = diag.get("concorrencia")
    if conc:
        itens.append(f"A busca “{e(conc['consulta'])}”: feita em {e(conc['lido_em'])}. A ordem muda um pouco de pessoa "
                     "para pessoa, porque o Google leva em conta onde cada um está. "
                     f'<a href="{e(FONTE_RANKING)}" rel="noopener">Como o Google ordena a busca local</a>.')
    av = diag.get("avaliacoes_lidas")
    if av and av["total"]:
        itens.append(f"As avaliações: as {av['total']} que o Google mostra primeiro, com o nome de quem escreveu. "
                     "Contamos as palavras; não demos nota a ninguém.")
    site = diag.get("site")
    if site and site["tipo"] in ("morto", "proprio") and diag.get("site_hoje"):
        itens.append(f"O site {e(dominio(site['url']))}: abrimos o endereço em {e(diag.get('hoje') or 'hoje')}.")
    if (diag.get("demo") or {}).get("secoes"):
        itens.append("A demonstração: a página que montamos para vocês, no ar neste mesmo endereço.")
    itens.append("Não conferimos se vocês respondem às avaliações (o Google não entrega isso a sistemas de fora) "
                 "nem quanto tempo levam para responder uma mensagem.")
    return ('<section><h2>Como fizemos este Raio-X</h2><ul class="metodo">'
            + "".join(f"<li>{i}</li>" for i in itens) + "</ul></section>")


# ------------------------------------------------------------------ publicação (efeitos)

def agora() -> str:
    return dt.datetime.now().astimezone().isoformat(timespec="seconds")


def log(msg: str, arquivo: Path | None = None) -> None:
    linha = f"[{agora()}] [raio-x] {msg}"
    print(linha, flush=True)
    if arquivo:
        try:
            with open(arquivo, "a", encoding="utf-8") as f:
                f.write(linha + "\n")
        except OSError:
            pass


def ler_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8-sig"))
    except (OSError, ValueError):
        return None


NAVEGADOR = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36"


def baixar(url: str, timeout: int = 30, navegador: bool = False) -> tuple[int | str, bytes]:
    """GET (segue redirecionamento). `navegador`: o site do negócio, que pode recusar robô."""
    try:
        pedido = urllib.request.Request(url, headers={"User-Agent": NAVEGADOR if navegador else "prumo-raio-x"})
        with urllib.request.urlopen(pedido, timeout=timeout) as r:
            return r.status, r.read(3_000_000)
    except Exception as e:  # noqa: BLE001
        return getattr(e, "code", str(e)), b""


def chave_places(arquivo: Path | None = None) -> str | None:
    """A chave do Places: PLACES_API_KEY no ambiente ou no arquivo (PLACES_API_KEY= ou
    GOOGLE_MAPS_API_KEY=). None = sem chave: o Raio-X sai sem concorrência e sem avaliações."""
    if os.environ.get("PLACES_API_KEY", "").strip():
        return os.environ["PLACES_API_KEY"].strip()
    try:
        linhas = (arquivo or PLACES_ENV).read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    for l in linhas:
        m = re.match(r"^\s*(?:export\s+)?(PLACES_API_KEY|GOOGLE_MAPS_API_KEY)\s*=\s*(.*)$", l)
        if m and m.group(2).strip().strip("'\""):
            return m.group(2).strip().strip("'\"")
    return None


def pedir_places(caminho: str, campos: str, chave: str, corpo: dict | None = None) -> tuple[int | str, dict | None]:
    """Uma chamada ao Places (New). A chave vai só no header; erros devolvem o código, nunca a chave."""
    try:
        pedido = urllib.request.Request(
            f"{PLACES_URL}/{caminho}", method="POST" if corpo is not None else "GET",
            data=json.dumps(corpo).encode("utf-8") if corpo is not None else None,
            headers={"X-Goog-Api-Key": chave, "X-Goog-FieldMask": campos, "Content-Type": "application/json",
                     "User-Agent": "prumo-raio-x"})
        with urllib.request.urlopen(pedido, timeout=20) as r:
            return r.status, json.loads(r.read(2_000_000).decode("utf-8"))
    except Exception as e:  # noqa: BLE001
        return getattr(e, "code", type(e).__name__), None


def _texto(v) -> str:
    return str((v or {}).get("text") or "") if isinstance(v, dict) else ""


def resumir_detalhes(d: dict) -> dict:
    """Só o que o Raio-X usa, do Place Details: nada de foto, coordenada ou telefone no cache."""
    textos = []
    for r in d.get("reviews") or []:
        textos.append({"nota": r.get("rating"), "texto": _texto(r.get("text")) or _texto(r.get("originalText")),
                       "autor": str((r.get("authorAttribution") or {}).get("displayName") or ""),
                       "autor_uri": str((r.get("authorAttribution") or {}).get("uri") or ""),
                       "quando": str(r.get("relativePublishTimeDescription") or ""),
                       "publicado": str(r.get("publishTime") or "")})
    return {"nome": _texto(d.get("displayName")), "nota": d.get("rating"), "avaliacoes": d.get("userRatingCount"),
            "tipo": _texto(d.get("primaryTypeDisplayName")), "site": str(d.get("websiteUri") or ""),
            "horario": list((d.get("regularOpeningHours") or {}).get("weekdayDescriptions") or []) or None,
            "status": str(d.get("businessStatus") or ""), "maps": str(d.get("googleMapsUri") or ""), "textos": textos}


# Tipos do Google que não dizem o que o negócio faz (visto em 08/10/2026: desentupidora e locação
# de equipamentos vêm como "Serviços"); com eles a busca usa o ramo que o Caçador procurou.
TIPOS_GENERICOS = {"serviços", "serviço", "empresa", "estabelecimento", "loja", "ponto de interesse", "escritório",
                   "prestador de serviços", "escritório corporativo", "comércio"}


def consulta_da_busca(tipo: str, vertical: str, cidade: str) -> str:
    """O que um cliente digitaria: o tipo que o Google dá ao perfil (ou, se genérico, o ramo do
    Caçador) + a cidade."""
    t = (tipo or "").strip().lower()
    termo = t if t and t not in TIPOS_GENERICOS else (vertical or "").strip().lower()
    return f"{termo} em {cidade.strip()}" if termo and cidade.strip() else ""


def ler_places(pasta: Path, dados: dict, chave: str | None, hoje: dt.datetime | None = None, pedir=None) -> dict | None:
    """Detalhes do lead + a busca da concorrência, guardados em <pasta>/raio-x-places.json por até
    VALIDADE_CACHE_DIAS (um refazer do Raio-X no mesmo mês não paga de novo). Duas chamadas por lead:
    Place Details (Enterprise + Atmosphere) e Text Search (Enterprise). None sem chave ou sem detalhes."""
    pedir = pedir or pedir_places
    agora_ = hoje or dt.datetime.now().astimezone()
    pid = dados["campos"].get("place_id", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{4,300}", pid):
        return None
    cache = pasta / CACHE_PLACES
    guardado = ler_json(cache)
    if isinstance(guardado, dict) and guardado.get("place_id") == pid and guardado.get("detalhes"):
        # A regra da consulta pode mudar entre versões: busca guardada com outra consulta não vale.
        esperada = consulta_da_busca(str(guardado["detalhes"].get("tipo") or ""), dados["campos"].get("Vertical", ""),
                                     dados["campos"].get("Cidade", ""))
        try:
            lido = dt.datetime.fromisoformat(str(guardado["lido_em"]))
            if (agora_ - lido).days < VALIDADE_CACHE_DIAS and (guardado.get("busca") or {}).get("consulta", "") == esperada:
                return guardado
        except (KeyError, ValueError, TypeError):
            pass
    if not chave:
        return None
    codigo, d = pedir(f"places/{pid}?languageCode=pt-BR&regionCode=BR", CAMPOS_DETALHES, chave)
    if codigo != 200 or not isinstance(d, dict):
        log(f"{pasta.name}: Places Details respondeu {codigo}; Raio-X sem concorrência nem avaliações.")
        return None
    detalhes = resumir_detalhes(d)
    consulta = consulta_da_busca(detalhes["tipo"], dados["campos"].get("Vertical", ""), dados["campos"].get("Cidade", ""))
    busca = None
    if consulta:
        codigo, b = pedir("places:searchText", CAMPOS_BUSCA, chave,
                          {"textQuery": consulta, "languageCode": "pt-BR", "regionCode": "BR",
                           "pageSize": TAMANHO_DA_BUSCA})
        if codigo == 200 and isinstance(b, dict):
            busca = {"consulta": consulta, "resultados": [
                {"id": p.get("id"), "nome": _texto(p.get("displayName")), "nota": p.get("rating"),
                 "avaliacoes": p.get("userRatingCount"), "site": str(p.get("websiteUri") or ""),
                 "status": str(p.get("businessStatus") or "")} for p in (b.get("places") or [])[:TAMANHO_DA_BUSCA]]}
        else:
            log(f"{pasta.name}: Places Text Search respondeu {codigo}; Raio-X sem concorrência.")
    saida = {"versao": 1, "place_id": pid, "lido_em": agora_.isoformat(timespec="seconds"), "detalhes": detalhes,
             "busca": busca}
    try:
        tmp = cache.with_name("." + CACHE_PLACES + ".tmp")
        tmp.write_text(json.dumps(saida, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(cache)
    except OSError:
        pass
    return saida


def gravar_recibo(recibo_path: Path, extra: dict) -> None:
    """Acrescenta os campos ao publicado.json sem tocar nos outros (gravação atômica)."""
    r = ler_json(recibo_path)
    if not isinstance(r, dict):
        raise ValueError("publicado.json ilegível")
    r.update(extra)
    tmp = recibo_path.with_name(".publicado.json.raio-x.tmp")
    tmp.write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(recibo_path)


def montar(pasta: Path) -> tuple[dict, dict, str, dict]:
    """(dados, diagnóstico, html, recibo) de um lead; ValueError com o motivo se não dá."""
    recibo = ler_json(pasta / "publicado.json")
    if not isinstance(recibo, dict) or not str(recibo.get("site_url", "")).startswith("https://"):
        raise ValueError("sem publicado.json com site_url")
    if recibo.get("apagado_em"):
        raise ValueError(f"demo apagado da Vercel em {recibo['apagado_em']}")
    try:
        texto = (pasta / "content.md").read_text(encoding="utf-8", errors="replace")
    except OSError:
        raise ValueError("sem content.md") from None
    dados = ler_content(texto)
    diag = diagnosticar(pasta, dados)
    if not diag["pontos"]:
        raise ValueError("nenhum ponto de melhoria verificável no content.md nem no Places")
    return dados, diag, pagina(dados, diag, recibo["site_url"], (pasta / "og.jpg").is_file(), fonte_css()), recibo


def diagnosticar(pasta: Path, dados: dict) -> dict:
    """Junta as fontes de um lead: o Places (com chave; cache na pasta), o site do perfil conferido
    agora, as fotos baixadas e o demo que está no ar (o index.html da pasta, conferido no publicar)."""
    places = ler_places(pasta, dados, chave_places())
    site = situacao_do_site(dados, (places or {}).get("detalhes"))
    site_hoje = conferir_site(site["url"], dados["nome"]) if site and site["tipo"] in ("morto", "proprio") else None
    fotos = sum(1 for f in (pasta / "Fotos").glob("*") if f.is_file()) if (pasta / "Fotos").is_dir() else 0
    try:
        demo = ler_demo((pasta / "index.html").read_text(encoding="utf-8", errors="replace"))
    except OSError:
        demo = None
    return diagnostico(dados, site_hoje, dt.date.today().strftime("%d/%m/%Y"), fotos, places, demo)


def publicar(pasta: Path, deploy=None) -> tuple[bool, str]:
    """Gera, publica e grava o recibo. (ok, mensagem). Nunca troca o demo: o index.html e o
    og.jpg da pasta têm de ser os que estão no ar, e são esses bytes conferidos que sobem."""
    slug = pasta.name
    log_lead = LOGS / f"execucao-{slug}.log"
    try:
        dados, diag, pagina_html, recibo = montar(pasta)
    except ValueError as e:
        return False, str(e)
    site_url = recibo["site_url"].rstrip("/")
    projeto = recibo.get("vercel_project") or f"demo-{slug}"
    if not re.fullmatch(r"demo-[a-z0-9][a-z0-9._-]{0,95}", projeto):
        return False, f"vercel_project inesperado: {projeto!r}"
    arquivos: dict[str, bytes] = {}
    for nome in ("index.html", "og.jpg"):
        local = (pasta / nome).read_bytes() if (pasta / nome).is_file() else None
        codigo, no_ar = baixar(f"{site_url}/{'' if nome == 'index.html' else nome}")
        if nome == "index.html" and codigo != 200:
            return False, f"o demo não responde ({site_url} -> {codigo})"
        if (local is None) != (codigo != 200) or (local is not None and local != no_ar):
            return False, f"o {nome} da pasta não é o que está no ar; nada publicado (o Raio-X nunca troca o demo)"
        if local is not None:
            arquivos[nome] = local
    arquivos[f"{CAMINHO}/index.html"] = pagina_html.encode("utf-8")
    alias = (deploy or deploy_na_vercel)(arquivos, projeto, log_lead)
    if alias.rstrip("/") != site_url:
        return False, f"o deploy respondeu outro endereço ({alias or 'sem linha Aliased:'}) em vez de {site_url}"
    url = f"{site_url}/{CAMINHO}"
    codigo, corpo = baixar(url)
    if codigo != 200 or corpo != arquivos[f"{CAMINHO}/index.html"]:
        return False, f"publicado, mas {url} não respondeu com este Raio-X ({codigo})"
    codigo, corpo = baixar(site_url + "/")
    if codigo != 200 or corpo != arquivos["index.html"]:
        return False, f"depois do deploy o demo mudou ou caiu ({codigo}); confira {site_url}"
    gravar_recibo(pasta / "publicado.json", {"raio_x_url": url, "raio_x_pontos": len(diag["pontos"]),
                                             "raio_x_versao": VERSAO, "raio_x_em": agora()})
    try:
        (pasta / "raio-x.html").write_text(pagina_html, encoding="utf-8")  # cópia local, para o backup e para conferir
    except OSError:
        pass
    log(f"Raio-X no ar: {url} ({len(diag['pontos'])} ponto(s), {len(diag['bons'])} bom(ns)).", log_lead)
    return True, url


def deploy_na_vercel(arquivos: dict[str, bytes], projeto: str, log_lead: Path) -> str:
    """Sobe exatamente `arquivos` (os bytes conferidos com o que está no ar, mais o Raio-X) no
    projeto já existente e devolve a URL da linha "Aliased:" ("" sem ela). Sem o link certo,
    não há deploy: um `vercel deploy` numa pasta sem link criaria um projeto novo com o nome
    do palco, e o hobby limita projetos."""
    with tempfile.TemporaryDirectory(prefix="raio-x-palco-") as palco:
        p = Path(palco)
        for nome, conteudo in arquivos.items():
            (p / nome).parent.mkdir(parents=True, exist_ok=True)
            (p / nome).write_bytes(conteudo)
        log(f"Publicando o Raio-X em {projeto}...", log_lead)
        with open(log_lead, "a", encoding="utf-8") as saida:
            link = subprocess.run(["vercel", "link", "--yes", "--project", projeto, "--scope", VERCEL_SCOPE],
                                  cwd=palco, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180)
            saida.write(link.stdout or "")
            ligado = ler_json(p / ".vercel/project.json") or {}
            if link.returncode != 0 or not ligado.get("projectId") or ligado.get("projectName", projeto) != projeto:
                if LIMITE_DE_DEPLOY.search(link.stdout or ""):
                    raise LimiteDaVercel((link.stdout or "").strip().splitlines()[-1])
                raise RuntimeError(f"vercel link não ligou o palco a {projeto} (código {link.returncode}); nada publicado")
            r = subprocess.run(["vercel", "deploy", "--prod", "--yes", "--scope", VERCEL_SCOPE],
                               cwd=palco, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=300)
            saida.write(r.stdout or "")
    if LIMITE_DE_DEPLOY.search(r.stdout or ""):
        raise LimiteDaVercel(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "limite de deploys")
    # A CLI 59 escreve "▲ Aliased         https://…", sem os dois-pontos das versões anteriores
    # (visto em 08/10/2026: os dois primeiros Raio-X subiram e a trava não achou a linha).
    m = re.search(r"(?i)aliased:?\s+(https://\S+)", r.stdout or "")
    return m.group(1).rstrip(".,)") if r.returncode == 0 and m else ""


class LimiteDaVercel(Exception):
    pass


def status_no_retrato() -> dict[str, str] | None:
    """place_id -> status, do retrato da planilha (fluxo 07, até 26 h). None = sem retrato válido."""
    d = ler_json(SITE_LEADS)
    try:
        gerado = dt.datetime.fromisoformat(str(d.get("geradoEm")).replace("Z", "+00:00"))
        if dt.datetime.now(dt.timezone.utc) - gerado > dt.timedelta(hours=26):
            return None
        return {str(l.get("place_id")): str(l.get("status")) for l in d.get("leads", []) if l.get("place_id")}
    except (AttributeError, ValueError, TypeError):
        return None


def gerador_rodando() -> bool:
    """A trava do gerador (`.logs/gerador.lock`, {host, pid, desde}). Enquanto ele roda, um refazer
    pode trocar o demo de um lead `pronto` a qualquer momento, e um deploy do Raio-X por cima o
    desfaria: o `--pendentes` espera. O gancho do próprio gerador roda dentro da trava, em série.
    Trava deste host com o pid morto não conta (o gerador faz a mesma conta); ilegível conta."""
    trava = LOGS / "gerador.lock"
    if not trava.exists():
        return False
    dono = ler_json(trava)
    if not isinstance(dono, dict):
        return True
    if dono.get("host") == socket.gethostname():
        return Path(f"/proc/{dono.get('pid')}").exists()
    return (dt.datetime.now().timestamp() - float(dono.get("desde") or 0)) < 6 * 3600


def pendentes(maximo: int) -> list[Path]:
    """Leads `pronto` na raiz com demo no ar e sem Raio-X da versão atual (ou com ele fora do ar),
    o publicado mais recente primeiro (o próximo a ser enviado). Quem não teria Raio-X (sem ponto,
    demo apagado) não ocupa vaga."""
    status = status_no_retrato()
    if status is None:
        log("Sem retrato recente da planilha (site-leads.json); nada é pendente.")
        return []
    if gerador_rodando():
        log("O gerador está rodando (gerador.lock); os pendentes ficam para a próxima rodada.")
        return []
    candidatos = []
    for p in AUTO.iterdir():
        if not p.is_dir() or p.name.startswith((".", "_")):
            continue
        r = ler_json(p / "publicado.json")
        if not isinstance(r, dict) or r.get("apagado_em") or status.get(str(r.get("place_id"))) != "pronto":
            continue
        try:
            versao = int(r.get("raio_x_versao") or 0)
        except (TypeError, ValueError):
            versao = 0
        candidatos.append((str(r.get("publicado_em") or ""), p, r, versao))
    saida = []
    for _, p, r, versao in sorted(candidatos, key=lambda c: c[0], reverse=True):
        if len(saida) >= maximo:
            break
        if r.get("raio_x_url") and versao >= VERSAO:
            codigo, corpo = baixar(str(r["raio_x_url"]))
            if codigo == 200 and MARCA.encode() in corpo:
                continue
        try:
            montar(p)
        except ValueError as e:
            log(f"{p.name}: sem Raio-X ({e}).")
            continue
        saida.append(p)
    return saida


def simular(pasta: Path) -> str:
    dados = ler_content((pasta / "content.md").read_text(encoding="utf-8", errors="replace"))
    d = diagnosticar(pasta, dados)
    linhas = [f"{pasta.name}: {dados['nome']} · nota {d['nota']} ({d['avaliacoes']}) · lido em {d['places_em'] or d['lido_em']}"]
    if d["site_hoje"]:
        linhas.append(f"  site do perfil hoje: {d['site_hoje']}")
    conc = d["concorrencia"]
    linhas.append(f"  busca: “{conc['consulta']}”, posição {conc['posicao']}, {conc['com_site']} de {len(conc['outros'])} com site"
                  if conc else "  busca: sem dados (sem chave do Places ou a API falhou)")
    av = d["avaliacoes_lidas"]
    linhas.append(f"  avaliações lidas: {av['total']}, temas: " + ", ".join(f"{t['tema']} {t['n']}" for t in av["temas"])
                  if av else "  avaliações lidas: nenhuma")
    linhas += [f"  bom: {b['titulo']}" for b in d["bons"]]
    linhas += [f"  ponto {i}: {p['titulo']}" for i, p in enumerate(d["pontos"], 1)]
    return "\n".join(linhas)


def main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--pendentes", action="store_true")
    ap.add_argument("--max", type=int, default=6)
    ap.add_argument("--simular", action="store_true")
    ap.add_argument("--html")
    ap.add_argument("--saida")
    ap.add_argument("--testar", action="store_true")
    a = ap.parse_args(argv)
    if a.testar:
        return testar()
    if a.html:
        dados, diag, pagina_html, _ = montar(AUTO / a.html)
        Path(a.saida or "raio-x.html").write_text(pagina_html, encoding="utf-8")
        print(simular(AUTO / a.html))
        return 0
    if any(not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,179}", s) for s in a.slugs):
        ap.error("SLUG é o nome da pasta na raiz de ~/auto-site")
    alvos = pendentes(a.max) if a.pendentes else [AUTO / s for s in a.slugs]
    if a.simular:
        for p in alvos:
            try:
                print(simular(p))
            except OSError as e:
                print(f"{p.name}: {e}")
        return 0
    if not alvos:
        log("Nada a fazer.")
        return 0
    if not shutil.which("vercel"):
        log("'vercel' não encontrado no PATH; nada publicado.")
        return 2
    falhas = 0
    for p in alvos:
        if not p.is_dir():
            log(f"{p.name}: pasta não está na raiz de {AUTO}.")
            falhas += 1
            continue
        try:
            ok, msg = publicar(p)
        except LimiteDaVercel as e:
            log(f"Limite de deploys da Vercel: {e}. Parando; o resto fica para a próxima.", LOGS / f"execucao-{p.name}.log")
            return 1
        except Exception as e:  # noqa: BLE001 — um lead quebrado não para os outros
            ok, msg = False, f"{type(e).__name__}: {e}"
        if not ok:
            falhas += 1
            log(f"{p.name}: sem Raio-X: {msg}", LOGS / f"execucao-{p.name}.log")
    return 1 if falhas and falhas == len(alvos) else 0


# ------------------------------------------------------------------ testes

CONTENT_EXEMPLO = """# Higor Ferreira - Advogado

- **Vertical:** advocacia
- **Cidade:** Anápolis
- **País:** Brasil
- **Endereço:** Avenida Cachoeira Dourada, Anápolis - GO
- **Telefone:** +55 62 99392-0412
- **Instagram:** não informado pelo Google — confirmar à mão
- **WhatsApp achado na busca do Caçador:** +5562993920412 (confirmar à mão antes de publicar)
- **Site antigo, fora do ar:** https://higorferreira.adv.br/ (domínio expirado, estacionado ou em construção)
- **Nota Google:** 5 (18 avaliações)
- **Google Maps:** https://maps.google.com/?cid=7474463341335702400
- **place_id:** ChIJteste
- **Criado em:** 2026-10-07T23:17:11.850-03:00
- **Slug:** higor-ferreira-advogado

## Por que este lead

Score de intenção de ter site: **100/100** (mínimo para virar pasta: 60).

- +40 site próprio fora do ar (domínio expirado, estacionado ou em construção): https://higorferreira.adv.br/
- +15 telefone do Google é celular (WhatsApp provável, chega em uma pessoa)
- +10 dono ou titular atende pessoalmente
- +10 5 foto(s) enviadas pelo próprio negócio no Google
- +5 horário preenchido no Google
- +10 avaliação nos últimos 30 dias
- +5 nota 5

## Classificação

Estabelecimento com espaço físico e equipe. Escritório.

## Briefing — o que os clientes dizem

Elogiam: atencioso. Reclamam: nada.
"""


def places_exemplo(posicao: int | None = 7) -> dict:
    """Um raio-x-places.json de mentira (formato do cache), com o lead na `posicao` da busca."""
    nomes = ["Alfa Advocacia", "Beta <script>x</script>", "Gama Advogados", "Delta Jurídico", "Épsilon Adv",
             "Zeta Advocacia", "Eta Advogados", "Teta Adv", "Iota Advocacia"]
    sites = ["https://alfa.adv.br", "", "https://www.instagram.com/gama", "https://delta.com.br", "", "https://zeta.adv.br",
             "", "", ""]
    resultados = [{"id": f"ChIJoutro{i}", "nome": n, "nota": 4.6 + (i % 4) / 10, "avaliacoes": 40 + 10 * i,
                   "site": s, "status": "OPERATIONAL"} for i, (n, s) in enumerate(zip(nomes, sites))]
    resultados[3]["status"] = "CLOSED_PERMANENTLY"
    if posicao:
        resultados.insert(posicao - 1, {"id": "ChIJteste", "nome": "Higor", "nota": 5, "avaliacoes": 18,
                                        "site": "https://higorferreira.adv.br/", "status": "OPERATIONAL"})
    textos = [
        {"nota": 5, "texto": "Excelente profissional, muito atencioso. Explicou cada etapa do processo com clareza e paciência.",
         "autor": "Ana P.", "autor_uri": "https://www.google.com/maps/contrib/1", "quando": "há 2 meses"},
        {"nota": 5, "texto": "Ótimo atendimento, rápido, e resolveu meu problema em poucas semanas. Recomendo!",
         "autor": "Bruno", "autor_uri": "https://www.google.com/maps/contrib/2", "quando": "há 3 semanas"},
        {"nota": 5, "texto": "Muito atencioso e transparente durante todo o atendimento.",
         "autor": "Carla", "autor_uri": "", "quando": "há 1 mês"},
        {"nota": 4, "texto": "Bom advogado, " + "explica tudo direitinho e sem pressa nenhuma " * 6,
         "autor": "Davi", "autor_uri": "javascript:alert(1)", "quando": "há 5 meses"},
        {"nota": 2, "texto": "Demorou para resolver e o atendimento atencioso prometido não veio.",
         "autor": "Edu", "autor_uri": "", "quando": "há 1 ano"},
    ]
    return {"versao": 1, "place_id": "ChIJteste", "lido_em": "2026-10-08T10:00:00-03:00",
            "detalhes": {"nome": "Higor", "nota": 5, "avaliacoes": 18, "tipo": "Advogado",
                         "site": "https://higorferreira.adv.br/", "status": "OPERATIONAL",
                         "horario": ["segunda-feira: 08:00–18:30", "terça-feira: 08:00–18:30", "quarta-feira: 08:00–18:30",
                                     "quinta-feira: 08:00–18:30", "sexta-feira: 08:00–18:30", "sábado: Fechado",
                                     "domingo: Fechado"],
                         "maps": "https://maps.google.com/?cid=1", "textos": textos},
            "busca": {"consulta": "advogado em Anápolis", "resultados": resultados}}


DEMO_EXEMPLO = """<html><body><header id="topo"><h1>Higor</h1></header>
<section class="topo" id="topo"><h2 class="revela">Você já leu o seu <em>contrato</em> inteiro?</h2></section>
<section id="papeis"><div><h2 id="t">Os papéis que chegam &amp; ficam</h2></div><a href="https://wa.me/5562993920412?text=Ol%C3%A1">Zap</a></section>
<section id="sem-titulo"><p>nada</p></section>
<section id="conversa"><h2>A primeira conversa</h2><a href="https://wa.me/5562993920412">Zap</a>
<a href="tel:+5562993920412">Ligar</a><a href="https://maps.google.com/?cid=1">Mapa</a></section></body></html>"""


def testar() -> int:
    import unittest

    class Leitura(unittest.TestCase):
        def test_campos_nota_e_sinais(self):
            d = ler_content(CONTENT_EXEMPLO)
            self.assertEqual((d["nome"], d["nota"], d["avaliacoes"]), ("Higor Ferreira - Advogado", 5.0, 18))
            self.assertEqual(d["campos"]["Cidade"], "Anápolis")
            self.assertIn("horário preenchido no Google", d["sinais"])
            self.assertEqual(len(d["sinais"]), 7)

        def test_sem_nota(self):
            d = ler_content("# X\n- **Nota Google:** sem nota (0 avaliações)\n")
            self.assertEqual((d["nota"], d["avaliacoes"], d["sinais"]), (None, 0, None))

        def test_telefone(self):
            self.assertEqual(tipo_de_telefone("+55 62 99392-0412", "Brasil"), "celular")
            self.assertEqual(tipo_de_telefone("+55 27 3361-1234", "Brasil"), "fixo")
            self.assertEqual(tipo_de_telefone("+351 912 345 678", "Portugal"), "celular")
            self.assertIsNone(tipo_de_telefone("+1 555 0100", "EUA"))
            self.assertIsNone(tipo_de_telefone("", "Brasil"))

    class Diagnostico(unittest.TestCase):
        def test_lead_completo(self):
            d = diagnostico(ler_content(CONTENT_EXEMPLO), "fora", "08/10/2026", 5)
            self.assertEqual([p["titulo"] for p in d["pontos"]],
                             ["O site que aparece no Google não abre", "Só 18 avaliações no Google"])
            self.assertIn("vai para higorferreira.adv.br, que não abriu quando conferimos (08/10/2026)",
                          d["pontos"][0]["porque"])
            self.assertEqual(len(d["bons"]), 5)
            self.assertEqual(d["bons"][0]["titulo"], "Nota 5,0 no Google")  # o 18 vira ponto, não bom
            self.assertEqual(d["lido_em"], "07/10/2026")

        def test_site_antigo_so_vira_ponto_conferido_hoje(self):
            dados = ler_content(CONTENT_EXEMPLO)
            titulos = lambda h: [p["titulo"] for p in diagnostico(dados, h, "08/10/2026")["pontos"]]  # noqa: E731
            self.assertEqual(titulos(None), ["Só 18 avaliações no Google"])  # não conferido: não afirma
            self.assertEqual(titulos("no_ar"), ["Só 18 avaliações no Google"])  # voltou: não afirma
            self.assertEqual(titulos("sem_nome")[0], "O site do Google não leva a um site de vocês")

        def test_conferir_site(self):
            antes = globals()["baixar"]
            try:
                for resposta, esperado in (((404, b""), "fora"), (("timeout", b""), "fora"),
                                           ((200, b"<title>higorferreira.adv.br is for sale</title>"), "sem_nome"),
                                           ((200, b"<h1>Higor Ferreira Advocacia</h1>"), "no_ar"),
                                           ((200, b"<h1>Pousada qualquer</h1>"), "no_ar")):
                    globals()["baixar"] = lambda url, timeout=30, navegador=False, r=resposta: r
                    nome = "Pousada Suites" if b"Pousada" in resposta[1] else "Higor Ferreira - Advogado"
                    self.assertEqual(conferir_site("https://higorferreira.adv.br/", nome), esperado, resposta)
            finally:
                globals()["baixar"] = antes

        def test_fixo_nao_vira_ponto_e_pousada_nao_tem_ponto_de_horario(self):
            t = CONTENT_EXEMPLO.replace("+55 62 99392-0412", "+55 27 3361-1234")
            t = t.replace("- **Site antigo, fora do ar:** https://higorferreira.adv.br/ (domínio expirado, estacionado ou em construção)\n",
                          "- **Link no Google (não é site próprio):** https://www.instagram.com/higor/\n")
            t = t.replace("- +5 horário preenchido no Google\n", "").replace("- +10 5 foto(s) enviadas pelo próprio negócio no Google\n", "")
            d = diagnostico(ler_content(t), fotos_baixadas=3)
            self.assertEqual([p["titulo"] for p in d["pontos"]],
                             ["O botão “Site” no Google leva para o Instagram",
                              "O horário de funcionamento não aparece no Google", "Só 18 avaliações no Google"])
            self.assertNotIn("fixo", json.dumps(d["pontos"], ensure_ascii=False))
            d = diagnostico(ler_content(t.replace("advocacia", "pousada")), fotos_baixadas=3)
            self.assertNotIn("O horário de funcionamento não aparece no Google", [p["titulo"] for p in d["pontos"]])

        def test_fotos_so_com_fotos_baixadas(self):
            t = CONTENT_EXEMPLO.replace("- +10 5 foto(s) enviadas pelo próprio negócio no Google\n", "")
            titulos = lambda n: [p["titulo"] for p in diagnostico(ler_content(t), "fora", "", n)["pontos"]]  # noqa: E731
            self.assertNotIn("Nenhuma das primeiras fotos do perfil é de vocês", titulos(0))
            self.assertIn("Nenhuma das primeiras fotos do perfil é de vocês", titulos(4))

        def test_sem_secao_de_sinais_nao_afirma_horario_fotos_nem_falta_de_site(self):
            t = CONTENT_EXEMPLO.split("## Por que este lead")[0].replace(
                "- **Site antigo, fora do ar:** https://higorferreira.adv.br/ (domínio expirado, estacionado ou em construção)\n", "")
            d = diagnostico(ler_content(t))
            self.assertEqual([p["titulo"] for p in d["pontos"]], ["Só 18 avaliações no Google"])
            self.assertFalse(any("Horário" in b["titulo"] or "foto" in b["titulo"] for b in d["bons"]))

        def test_perfil_sem_site_e_nota_baixa(self):
            t = CONTENT_EXEMPLO.replace(
                "- **Site antigo, fora do ar:** https://higorferreira.adv.br/ (domínio expirado, estacionado ou em construção)\n", "")
            t = t.replace("5 (18 avaliações)", "4.1 (120 avaliações)")
            d = diagnostico(ler_content(t))
            self.assertEqual([p["titulo"] for p in d["pontos"]], ["O perfil do Google não tem site", "Nota 4,1 no Google"])
            self.assertIn("advocacia em Anápolis", d["pontos"][0]["porque"])

        def test_nada_do_gemini_entra(self):
            d = diagnostico(ler_content(CONTENT_EXEMPLO))
            textos = json.dumps(d, ensure_ascii=False)
            self.assertNotIn("dono", textos.lower())
            self.assertNotIn("5562993920412", textos)

    class Pagina(unittest.TestCase):
        def test_identidade_preco_link_e_escape(self):
            t = CONTENT_EXEMPLO.replace("# Higor Ferreira - Advogado", "# Bar <b>&</b> Cia")
            dados = ler_content(t)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026"), "https://demo-x.vercel.app/", True)
            self.assertIn("Bar &lt;b&gt;&amp;&lt;/b&gt; Cia", h)
            self.assertNotIn("<b>&</b>", h)
            self.assertIn("R$ 990 + R$ 69/mês", h)
            self.assertIn("só pagam depois de ver funcionando", h)
            self.assertIn('href="/"', h)
            self.assertIn("https://demo-x.vercel.app/og.jpg", h)
            self.assertIn(MARCA, h)
            self.assertIn("2 pontos que mandam cliente para o concorrente", h)
            self.assertIn("lidos em 07/10/2026", h)
            self.assertNotRegex(h.lower(), r"#(00f|0000ff|1e90ff|2563eb)|blue|border-radius:\s*[1-9]")
            self.assertTrue(h.rstrip().endswith("</html>"))

        def test_sem_og_nao_aponta_imagem(self):
            dados = ler_content(CONTENT_EXEMPLO)
            h = pagina(dados, diagnostico(dados), "https://demo-x.vercel.app", False)
            self.assertNotIn("og.jpg", h)

        def test_empresa_sem_nome_de_pessoa_e_dois_servicos_com_preco(self):
            dados = ler_content(CONTENT_EXEMPLO)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5), "https://demo-x.vercel.app", True)
            self.assertNotIn("Rômulo", h)
            self.assertIn("R$ 2.400 + R$ 390/mês", h)
            self.assertIn("Respondido e Acompanhado", h)
            self.assertIn("Não conferimos se vocês respondem às avaliações", h)
            # Sem Places: nada de concorrência nem de avaliações, e a busca não é afirmada.
            self.assertNotIn("Quem aparece quando procuram", h)
            self.assertNotIn("O que os clientes dizem", h)
            self.assertIn("Não medimos a posição de vocês na busca.", h)

    class Profundo(unittest.TestCase):
        """Versão 2: Places, avaliações, demo, checklist e caminho do cliente (tudo PURO)."""

        def test_temas_contam_so_o_que_se_leu_e_nota_baixa_nao_vira_elogio(self):
            av = temas_das_avaliacoes(places_exemplo()["detalhes"]["textos"])
            self.assertEqual((av["total"], av["positivas"], av["criticas"]), (5, 4, 1))
            temas = {t["tema"]: t["n"] for t in av["temas"]}
            self.assertEqual(temas["Atendimento"], 3)  # a nota 2 também diz "atencioso", e não conta
            self.assertEqual(temas_das_avaliacoes([{"nota": 5, "texto": "Precisei de atendimento urgente."}])["temas"], [])
            self.assertEqual(temas["Explica com clareza"], 3)
            self.assertEqual(temas["Rapidez"], 1)
            self.assertEqual(av["temas"][0]["tema"], "Atendimento")
            self.assertTrue(all(len(t["trecho"]) <= 161 for t in av["temas"]))
            longo = trecho("Bom advogado, " + "explica tudo direitinho e sem pressa nenhuma " * 6, ("explic",))
            self.assertTrue(longo.endswith("…") and len(longo) <= 161, longo)
            self.assertEqual(av["temas"][1]["autor"], "Carla")  # cada tema cita uma avaliação diferente
            # Ponto colado na palavra seguinte e tema no fim de frase longa: o recorte mantém a palavra.
            t = trecho("Achei essa empresa no Google.Fui " + "muito bem atendido desde o primeiro contato e " * 5
                       + "chegaram rápido.", ("rapid",))
            self.assertIn("rápido", t)
            self.assertTrue(t.startswith("…") and len(t) <= 160, t)
            self.assertEqual(temas_das_avaliacoes([])["temas"], [])

        def test_concorrencia_posicao_fechados_e_site_proprio(self):
            c = concorrencia(places_exemplo(7), "ChIJteste")
            self.assertEqual((c["consulta"], c["posicao"], c["lidos"]), ("advogado em Anápolis", 7, 10))
            self.assertEqual([r["pos"] for r in c["outros"]], [1, 2, 3, 5, 6])  # o 4º fechou
            self.assertEqual(c["com_site"], 2)  # alfa e zeta; o instagram não é site próprio, delta fechou
            self.assertIsNone(concorrencia(places_exemplo(None), "ChIJteste")["posicao"])
            self.assertIsNone(concorrencia({"busca": None}, "ChIJteste"))
            self.assertIsNone(concorrencia(None, "ChIJteste"))

        def test_diagnostico_com_places_compara_com_a_busca(self):
            dados = ler_content(CONTENT_EXEMPLO)
            d = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7))
            titulos = [p["titulo"] for p in d["pontos"]]
            self.assertEqual(titulos, ["O site que aparece no Google não abre", "7º lugar em “advogado em Anápolis”",
                                       "Só 18 avaliações no Google"])
            self.assertIn("2 dos 5 primeiros mostram site próprio", d["pontos"][0]["porque"])
            self.assertIn("no meio da lista, 60 avaliações", d["pontos"][2]["porque"])
            self.assertIn("relevância, distância e destaque", d["pontos"][1]["porque"])
            bons = [b["titulo"] for b in d["bons"]]
            self.assertIn("Nota maior que a de 5 dos 5 primeiros da busca", bons)
            self.assertIn("3 de 5 avaliações elogiam o atendimento", bons)
            self.assertEqual(d["horario_resumo"], "aberto 5 dias por semana")
            # Entre os 3 primeiros não há ponto de posição; com muitas avaliações, comparação só abaixo da metade.
            d = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(2))
            self.assertFalse(any("lugar" in p["titulo"] for p in d["pontos"]))

        def test_avaliacoes_abaixo_da_metade_da_busca_viram_ponto_mesmo_acima_de_20(self):
            p = places_exemplo(2)
            p["detalhes"]["avaliacoes"] = 29
            d = diagnostico(ler_content(CONTENT_EXEMPLO), "no_ar", "08/10/2026", 5, p)
            self.assertIn("29 avaliações, menos da metade do que os primeiros da busca têm", [x["titulo"] for x in d["pontos"]])
            p["detalhes"]["avaliacoes"] = 30
            d = diagnostico(ler_content(CONTENT_EXEMPLO), "no_ar", "08/10/2026", 5, p)
            self.assertEqual(d["pontos"], [])  # site no ar, 2º lugar, 30 é metade de 60: nada a apontar

        def test_site_do_perfil_de_hoje_vale_mais_que_o_do_cacador(self):
            dados = ler_content(CONTENT_EXEMPLO)
            p = places_exemplo(2)
            p["detalhes"]["site"] = "https://www.instagram.com/higor"
            self.assertEqual(situacao_do_site(dados, p["detalhes"])["tipo"], "rede")
            p["detalhes"]["site"] = ""
            self.assertEqual(situacao_do_site(dados, p["detalhes"])["tipo"], "nenhum")
            p["detalhes"]["site"] = "https://novo-site.com.br/"
            self.assertEqual(situacao_do_site(dados, p["detalhes"])["tipo"], "proprio")
            p["detalhes"]["site"] = "https://higorferreira.adv.br/contato"
            self.assertEqual(situacao_do_site(dados, p["detalhes"])["tipo"], "morto")

        def test_consulta_usa_o_ramo_quando_o_tipo_do_google_e_generico(self):
            self.assertEqual(consulta_da_busca("Advogado", "advocacia", "Anápolis"), "advogado em Anápolis")
            self.assertEqual(consulta_da_busca("Serviços", "desentupidora", "Goiânia"), "desentupidora em Goiânia")
            self.assertEqual(consulta_da_busca("", "locação de equipamentos", "Goiânia"), "locação de equipamentos em Goiânia")
            self.assertEqual(consulta_da_busca("Advogado", "advocacia", ""), "")

        def test_ler_demo(self):
            d = ler_demo(DEMO_EXEMPLO)
            self.assertEqual(d["secoes"], [{"id": "topo", "titulo": "Você já leu o seu contrato inteiro?"},
                                           {"id": "papeis", "titulo": "Os papéis que chegam & ficam"},
                                           {"id": "conversa", "titulo": "A primeira conversa"}])
            self.assertEqual((d["whatsapp"], d["whatsapp_com_texto"], d["telefone"], d["mapa"]), (2, True, True, True))
            self.assertEqual(ler_demo("")["secoes"], [])

        def test_checklist_so_marca_falta_com_o_fato(self):
            dados = ler_content(CONTENT_EXEMPLO.split("## Por que este lead")[0])
            itens = {x["item"]: x["estado"] for x in checklist(diagnostico(dados))}
            self.assertEqual((itens["Horário de funcionamento"], itens["Fotos"], itens["Site"]), ("nc", "nc", "nc"))
            dados = ler_content(CONTENT_EXEMPLO)
            itens = {x["item"]: x for x in checklist(diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo()))}
            self.assertEqual(itens["Site"]["estado"], "falta")
            self.assertIn("não abriu em 08/10/2026", itens["Site"]["detalhe"])
            self.assertEqual(itens["Horário de funcionamento"]["detalhe"], "aberto 5 dias por semana")
            self.assertEqual(itens["Avaliações"]["estado"], "falta")

        def test_jornada_liga_os_passos_as_secoes_do_demo(self):
            dados = ler_content(CONTENT_EXEMPLO)
            passos = jornada(diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7), ler_demo(DEMO_EXEMPLO)))
            self.assertEqual([p["titulo"] for p in passos], ["Procura no Google", "Abre o perfil e compara",
                                                            "Toca em “Site” para conhecer o trabalho", "Chama",
                                                            "Espera a resposta"])
            self.assertIn("7º lugar", passos[0]["hoje"])
            self.assertIn(("Os papéis que chegam & ficam", "/#papeis"), passos[2]["demo"])
            self.assertIn("com a mensagem já começada", passos[3]["demo"][0][0])
            self.assertIn("não abriu", passos[2]["hoje"])

        def test_pagina_completa_escapa_e_so_linka_https(self):
            dados = ler_content(CONTENT_EXEMPLO)
            diag = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7), ler_demo(DEMO_EXEMPLO))
            h = pagina(dados, diag, "https://demo-x.vercel.app", True)
            self.assertIn("Quem aparece quando procuram “advogado em Anápolis”", h)
            self.assertIn("Vocês aparecem em 7º lugar nesta busca.", h)
            self.assertIn("Beta &lt;script&gt;x&lt;/script&gt;", h)
            self.assertNotIn("<script>", h)
            self.assertIn('href="https://www.google.com/maps/contrib/1"', h)
            self.assertNotIn("javascript:", h)
            self.assertIn("O que os clientes dizem", h)
            self.assertIn("3 de 5", h)
            self.assertIn('href="/#papeis"', h)
            self.assertIn("3 pontos que mandam cliente para o concorrente", h)
            self.assertIn("lida em 08/10/2026", h)
            self.assertNotRegex(h.lower(), r"#(00f|0000ff|1e90ff|2563eb)|blue|border-radius:\s*[1-9]")
            # Com o lead entre os 5 primeiros, ele entra na lista, marcado.
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(2)), "https://demo-x.vercel.app", True)
            self.assertIn('<li class="voces"><span class="pos">2º</span>', h)
            self.assertIn("site fora do ar", h)

    class Places(unittest.TestCase):
        """Cache e chave numa raiz temporária própria; a rede é dublê."""

        def setUp(self):
            self.raiz = Path(tempfile.mkdtemp(prefix="raio-x-teste-"))
            assert self.raiz.name.startswith("raio-x-teste-") and str(self.raiz).startswith(tempfile.gettempdir())
            self.dados = ler_content(CONTENT_EXEMPLO)
            self.chamadas = []

        def tearDown(self):
            assert self.raiz.name.startswith("raio-x-teste-")
            shutil.rmtree(self.raiz)

        def pedir(self, caminho, campos, chave, corpo=None):
            self.chamadas.append((caminho, campos, corpo))
            if caminho.startswith("places/"):
                return 200, {"displayName": {"text": "Higor"}, "rating": 5, "userRatingCount": 19,
                             "primaryTypeDisplayName": {"text": "Advogado"}, "websiteUri": "https://higorferreira.adv.br/",
                             "regularOpeningHours": {"weekdayDescriptions": ["segunda-feira: 08:00–18:00"]},
                             "reviews": [{"rating": 5, "text": {"text": "Muito atencioso."},
                                          "authorAttribution": {"displayName": "Ana", "uri": "https://x"},
                                          "relativePublishTimeDescription": "há 1 mês"}],
                             "location": {"latitude": -16.3, "longitude": -48.9}, "nationalPhoneNumber": "(62) 9"}
            return 200, {"places": [{"id": "ChIJteste", "displayName": {"text": "Higor"}, "rating": 5, "userRatingCount": 19},
                                    {"id": "ChIJa", "displayName": {"text": "A"}, "rating": 4.5, "userRatingCount": 9,
                                     "websiteUri": "https://a.com", "businessStatus": "OPERATIONAL"}]}

        def test_duas_chamadas_cache_sem_a_chave_e_sem_dado_a_mais(self):
            agora_ = dt.datetime(2026, 10, 8, 10, 0, tzinfo=dt.timezone(dt.timedelta(hours=-3)))
            p = ler_places(self.raiz, self.dados, "CHAVE-SECRETA", agora_, self.pedir)
            self.assertEqual(len(self.chamadas), 2)
            self.assertTrue(self.chamadas[0][0].startswith("places/ChIJteste?"))
            self.assertEqual(self.chamadas[0][1], CAMPOS_DETALHES)
            self.assertEqual(self.chamadas[1][2]["textQuery"], "advogado em Anápolis")
            self.assertEqual(p["detalhes"]["avaliacoes"], 19)
            guardado = (self.raiz / CACHE_PLACES).read_text(encoding="utf-8")
            self.assertNotIn("CHAVE-SECRETA", guardado)
            self.assertNotIn("latitude", guardado)
            self.assertNotIn("(62) 9", guardado)
            # Dentro de 30 dias o cache vale, até sem chave; depois, pede de novo.
            self.assertEqual(ler_places(self.raiz, self.dados, None, agora_ + dt.timedelta(days=29), self.pedir), p)
            self.assertEqual(len(self.chamadas), 2)
            self.assertIsNone(ler_places(self.raiz, self.dados, None, agora_ + dt.timedelta(days=31), self.pedir))
            ler_places(self.raiz, self.dados, "CHAVE-SECRETA", agora_ + dt.timedelta(days=31), self.pedir)
            self.assertEqual(len(self.chamadas), 4)

        def test_sem_chave_ou_com_a_api_fora_nao_ha_places(self):
            self.assertIsNone(ler_places(self.raiz, self.dados, None, pedir=self.pedir))
            self.assertEqual(self.chamadas, [])
            self.assertIsNone(ler_places(self.raiz, self.dados, "k", pedir=lambda *a, **k: (403, None)))
            self.assertFalse((self.raiz / CACHE_PLACES).exists())
            # Busca fora, detalhes ok: avaliações sim, concorrência não.
            def meio(caminho, campos, chave, corpo=None):
                return self.pedir(caminho, campos, chave, corpo) if caminho.startswith("places/") else (500, None)
            p = ler_places(self.raiz, self.dados, "k", pedir=meio)
            self.assertIsNone(p["busca"])
            self.assertIsNone(concorrencia(p, "ChIJteste"))

        def test_chave_do_arquivo(self):
            antes = os.environ.pop("PLACES_API_KEY", None)
            try:
                arq = self.raiz / "places.env"
                self.assertIsNone(chave_places(arq))
                arq.write_text("# comentário\nOUTRA=1\nGOOGLE_MAPS_API_KEY=\n", encoding="utf-8")
                self.assertIsNone(chave_places(arq))
                arq.write_text("export PLACES_API_KEY='abc123'\n", encoding="utf-8")
                self.assertEqual(chave_places(arq), "abc123")
            finally:
                if antes is not None:
                    os.environ["PLACES_API_KEY"] = antes

    class Publicar(unittest.TestCase):
        """Raiz temporária própria; o deploy e a rede são dublês."""

        def setUp(self):
            global AUTO, LOGS
            self.raiz = Path(tempfile.mkdtemp(prefix="raio-x-teste-"))
            assert self.raiz.name.startswith("raio-x-teste-") and str(self.raiz).startswith(tempfile.gettempdir())
            self.antes = (AUTO, LOGS, globals()["baixar"], globals()["chave_places"], globals()["pedir_places"])
            globals()["chave_places"] = lambda arquivo=None: None
            globals()["pedir_places"] = lambda *a, **k: self.fail("o teste não pode chamar o Places")
            AUTO, LOGS = self.raiz, self.raiz / ".logs"
            LOGS.mkdir()
            self.pasta = self.raiz / "higor"
            (self.pasta / "Fotos").mkdir(parents=True)
            (self.pasta / "content.md").write_text(CONTENT_EXEMPLO, encoding="utf-8")
            (self.pasta / "index.html").write_bytes(b"<html>demo</html>")
            (self.pasta / "og.jpg").write_bytes(b"\xff\xd8og")
            (self.pasta / "publicado.json").write_text(json.dumps({
                "place_id": "ChIJteste", "slug": "higor", "nome": "Higor", "site_url": "https://demo-higor.vercel.app",
                "vercel_project": "demo-higor", "publicado_em": "2026-10-08T17:20:00-03:00"}), encoding="utf-8")
            self.no_ar = {"https://demo-higor.vercel.app/": (200, b"<html>demo</html>"),
                          "https://demo-higor.vercel.app/og.jpg": (200, b"\xff\xd8og")}
            self.subidos = []
            globals()["baixar"] = lambda url, timeout=30, navegador=False: self.no_ar.get(url, (404, b""))

        def tearDown(self):
            global AUTO, LOGS
            AUTO, LOGS, globals()["baixar"], globals()["chave_places"], globals()["pedir_places"] = self.antes
            assert self.raiz.name.startswith("raio-x-teste-")
            shutil.rmtree(self.raiz)

        def deploy(self, arquivos, projeto, log_lead):
            self.assertEqual(projeto, "demo-higor")
            self.subidos.append(sorted(arquivos))
            self.no_ar["https://demo-higor.vercel.app/raio-x"] = (200, arquivos["raio-x/index.html"])
            return "https://demo-higor.vercel.app"

        def recibo(self):
            return json.loads((self.pasta / "publicado.json").read_text(encoding="utf-8"))

        def test_publica_os_bytes_conferidos_e_grava_os_campos_sem_perder_os_outros(self):
            ok, msg = publicar(self.pasta, self.deploy)
            self.assertTrue(ok, msg)
            self.assertEqual(self.subidos, [["index.html", "og.jpg", "raio-x/index.html"]])
            r = self.recibo()
            self.assertEqual((r["raio_x_url"], r["raio_x_pontos"], r["raio_x_versao"], r["place_id"], r["site_url"]),
                             ("https://demo-higor.vercel.app/raio-x", 2, VERSAO, "ChIJteste", "https://demo-higor.vercel.app"))
            self.assertTrue((self.pasta / "raio-x.html").is_file())

        def test_index_ou_og_diferente_do_que_esta_no_ar_nao_publica(self):
            for url, corpo in (("https://demo-higor.vercel.app/", (200, b"<html>outro</html>")),
                               ("https://demo-higor.vercel.app/og.jpg", (200, b"outra imagem")),
                               ("https://demo-higor.vercel.app/og.jpg", (404, b""))):
                guardado = self.no_ar[url]
                self.no_ar[url] = corpo
                ok, msg = publicar(self.pasta, lambda *a: self.fail("não podia publicar"))
                self.assertFalse(ok)
                self.assertIn("não é o que está no ar", msg)
                self.no_ar[url] = guardado
            self.assertNotIn("raio_x_url", self.recibo())

        def test_demo_apagado_nao_publica(self):
            r = self.recibo()
            r["apagado_em"] = "2026-10-08T10:05:08-03:00"
            (self.pasta / "publicado.json").write_text(json.dumps(r), encoding="utf-8")
            ok, msg = publicar(self.pasta, lambda *a: self.fail("não podia publicar"))
            self.assertFalse(ok)
            self.assertIn("apagado", msg)

        def test_raio_x_que_nao_responde_ou_e_antigo_nao_grava_o_campo(self):
            ok, _ = publicar(self.pasta, lambda *a: "https://demo-higor.vercel.app")
            self.assertFalse(ok)
            self.no_ar["https://demo-higor.vercel.app/raio-x"] = (200, f"<body {MARCA}>versão anterior".encode())
            ok, _ = publicar(self.pasta, lambda *a: "https://demo-higor.vercel.app")
            self.assertFalse(ok)
            self.assertNotIn("raio_x_url", self.recibo())

        def test_alias_diferente_nao_grava_o_campo(self):
            def outro(arquivos, projeto, log_lead):
                self.deploy(arquivos, projeto, log_lead)
                return "https://demo-higor-abc123.vercel.app"
            ok, msg = publicar(self.pasta, outro)
            self.assertFalse(ok)
            self.assertIn("outro endereço", msg)
            self.assertNotIn("raio_x_url", self.recibo())

        def test_pendentes_so_pronto_na_raiz_sem_raio_x_e_nunca_com_o_gerador_rodando(self):
            global SITE_LEADS
            antes = SITE_LEADS
            SITE_LEADS = self.raiz / "site-leads.json"
            try:
                agora_iso = dt.datetime.now(dt.timezone.utc).isoformat()
                SITE_LEADS.write_text(json.dumps({"geradoEm": agora_iso, "leads": [
                    {"place_id": "ChIJteste", "status": "pronto"}, {"place_id": "ChIJenviado", "status": "enviado"},
                    {"place_id": "ChIJsemponto", "status": "pronto"}]}))
                outra = self.raiz / "enviado"
                outra.mkdir()
                (outra / "publicado.json").write_text(json.dumps({"place_id": "ChIJenviado", "site_url": "https://x"}))
                sem_ponto = self.raiz / "sem-ponto"  # sem content.md: nunca teria Raio-X, não ocupa vaga
                sem_ponto.mkdir()
                (sem_ponto / "publicado.json").write_text(json.dumps({
                    "place_id": "ChIJsemponto", "site_url": "https://demo-s.vercel.app", "raio_x_versao": "x"}))
                (self.raiz / "_recusados").mkdir()
                self.assertEqual([p.name for p in pendentes(1)], ["higor"])
                (LOGS / "gerador.lock").write_text(json.dumps({"host": socket.gethostname(), "pid": os.getpid(), "desde": 0}))
                self.assertEqual(pendentes(10), [])  # o gerador (aqui, este processo) está vivo
                (LOGS / "gerador.lock").write_text(json.dumps({"host": socket.gethostname(), "pid": 0, "desde": 0}))
                self.assertEqual([p.name for p in pendentes(10)], ["higor"])  # trava de processo morto
                ok, _ = publicar(self.pasta, self.deploy)
                self.assertTrue(ok)
                self.assertEqual(pendentes(10), [])
                SITE_LEADS.write_text(json.dumps({"geradoEm": "2026-01-01T00:00:00Z", "leads": []}))
                self.assertEqual(pendentes(10), [])  # retrato velho: nada
            finally:
                SITE_LEADS = antes

    suite = unittest.TestSuite()
    for c in (Leitura, Diagnostico, Pagina, Profundo, Places, Publicar):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(c))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
