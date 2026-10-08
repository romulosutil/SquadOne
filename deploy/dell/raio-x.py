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
VERSAO = 1
CAMINHO = "raio-x"
MARCA = f'data-raio-x="{VERSAO}"'
MAX_PONTOS = 3
LIMITE_DE_DEPLOY = re.compile(r"(?i)api-deployments-free-per-day|Resource is limited|too many deployments"
                              r"|maximum number of projects")
PRECO = "R$ 990 + R$ 69/mês"


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


def situacao_do_site(dados: dict) -> dict | None:
    """{'tipo': 'morto'|'rede'|'nenhum', 'url', 'motivo'}; None = não dá para afirmar."""
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


def diagnostico(dados: dict, site_hoje: str | None = None, hoje: str = "", fotos_baixadas: int = 0) -> dict:
    """O que já está bom e os pontos de melhoria (no máximo 3, na ordem de peso).
    Cada item é {'titulo', 'porque'} e só existe se o fato está no content.md.
    `site_hoje` = `conferir_site` do site que o Caçador viu fora do ar (None = não conferido:
    o ponto não sai); `hoje` = a data dessa conferência; `fotos_baixadas` = arquivos em Fotos/
    (sem nenhuma, "nenhuma foto é de vocês" poderia ser "o perfil não tem foto")."""
    c, sinais = dados["campos"], dados["sinais"]
    nota, n = dados["nota"], dados["avaliacoes"]
    cidade = c.get("Cidade", "").strip()
    vertical = c.get("Vertical", "").strip()
    telefone = tipo_de_telefone(c.get("Telefone", ""), c.get("País", ""))
    horario = None if sinais is None else any(s.startswith("horário preenchido no Google") for s in sinais)
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

    pontos: list[dict] = []
    site = situacao_do_site(dados)
    onde = f"{vertical} em {cidade}" if vertical and cidade else (f"em {cidade}" if cidade else "o serviço de vocês")
    quando = f" quando conferimos ({hoje})" if hoje else " quando conferimos"
    if site and site["tipo"] == "morto" and site_hoje == "fora":
        pontos.append({"titulo": "O site que aparece no Google não abre",
                       "porque": f"Quem toca em “Site” no perfil de vocês vai para {dominio(site['url'])}, que não abriu"
                                 f"{quando}. A pessoa volta para a busca, e o próximo resultado está a um toque."})
    elif site and site["tipo"] == "morto" and site_hoje == "sem_nome":
        pontos.append({"titulo": "O site do Google não leva a um site de vocês",
                       "porque": f"Quem toca em “Site” no perfil de vocês vai para {dominio(site['url'])}, que{quando} "
                                 "mostrava uma página sem o nome de vocês. A pessoa volta para a busca, e o próximo "
                                 "resultado está a um toque."})
    elif site and site["tipo"] == "rede":
        rede = nome_da_rede(site["url"])
        porque = ("Quem ainda está comparando quer ver o trabalho antes de chamar. Sem uma página com os serviços e as "
                  "fotos, só chama quem já decidiu, e quem está em dúvida vai para quem mostra.")
        if rede in ("o Instagram", "o Facebook", "o TikTok"):
            porque = ("Quem está comparando quer ver os serviços, as fotos e como chamar numa página só. Na rede social "
                      "isso fica espalhado entre posts, e muita gente desiste ali.")
        pontos.append({"titulo": f"O botão “Site” no Google leva para {rede}", "porque": porque})
    elif site and site["tipo"] == "nenhum":
        pontos.append({"titulo": "O perfil do Google não tem site",
                       "porque": f"Quem procura {onde} compara duas ou três opções. Sem site, vocês aparecem só com "
                                 "nome e nota, e quem mostra serviços e fotos leva o cliente."})
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
    if n is not None and n < 20:
        pontos.append({"titulo": "Ainda sem avaliações no Google" if n == 0 else f"Só {n} avaliaç{'ão' if n == 1 else 'ões'} no Google",
                       "porque": "Entre duas opções parecidas, o cliente confia em quem tem mais avaliações. Pedir na hora, "
                                 "a quem saiu satisfeito, é o jeito mais barato de crescer esse número."})
    if fotos == 0 and fotos_baixadas > 0:
        pontos.append({"titulo": "Nenhuma das primeiras fotos do perfil é de vocês",
                       "porque": "As fotos que o cliente vê primeiro foram publicadas por outras pessoas. É a primeira "
                                 "impressão do lugar, e vocês não escolheram."})
    return {"bons": bons, "pontos": pontos[:MAX_PONTOS], "lido_em": data_br(c.get("Criado em", "")),
            "maps": c.get("Google Maps", ""), "cidade": cidade, "vertical": vertical}


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
    nota, n = dados["nota"], dados["avaliacoes"]
    pontos, bons = diag["pontos"], diag["bons"]
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
    if nota is not None and n:
        partes.append(f'<div class="nota"><span class="num">{e(numero(nota))}</span>'
                      f'<span class="leitura">nota no Google<br>{e(n)} avaliaç{"ão" if n == 1 else "ões"}</span></div>')
    if bons:
        partes.append('<section class="bons"><h2>O que já está bom</h2><ul class="lista">'
                      + "".join(item("✓", b) for b in bons) + "</ul></section>")
    if pontos:
        partes.append(f'<section class="pontos"><h2>{e(titulo_pontos)}</h2><ul class="lista">'
                      + "".join(item(f"{i:02d}", p) for i, p in enumerate(pontos, 1)) + "</ul></section>")
    demo = ['<section class="demo"><h2>Montamos uma demonstração do site de vocês</h2>']
    if tem_og:
        demo.append(f'<a href="/" aria-label="Abrir a demonstração do site de {e(nome)}">'
                    f'<img src="/og.jpg" width="1200" height="630" alt="Prévia da demonstração do site de {e(nome)}" loading="lazy"></a>')
    demo.append('<p>Com o nome, o contato e o jeito de vocês. Abre no celular do mesmo jeito que o cliente veria.</p>'
                '<p><a class="botao" href="/">Ver a demonstração</a></p></section>')
    partes += demo
    partes.append('<section class="escura"><h2>Quer colocar no ar?</h2>'
                  f'<p class="preco">{e(PRECO)}</p>'
                  '<p>Com o endereço de vocês, hospedagem e ajustes incluídos. <strong>Vocês só pagam depois de ver '
                  'funcionando.</strong></p><p>É só responder a mensagem no WhatsApp.</p></section>')
    rodape = ["<footer>"]
    rodape.append(f"<span>Dados públicos do Google Maps{', lidos em ' + e(diag['lido_em']) if diag['lido_em'] else ''}."
                  + (f' <a href="{e(diag["maps"])}" rel="noopener">Ver o perfil no Google Maps</a>.' if diag["maps"].startswith("https://") else "")
                  + "</span>")
    rodape.append("<span>Rômulo Sutil · PRUMO · Espírito Santo</span></footer>")
    partes += rodape
    partes.append("</main></body></html>\n")
    return "\n".join(partes)


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
    site = situacao_do_site(dados)
    site_hoje = conferir_site(site["url"], dados["nome"]) if site and site["tipo"] == "morto" else None
    fotos = sum(1 for f in (pasta / "Fotos").glob("*") if f.is_file()) if (pasta / "Fotos").is_dir() else 0
    diag = diagnostico(dados, site_hoje, dt.date.today().strftime("%d/%m/%Y"), fotos)
    if not diag["pontos"]:
        raise ValueError("nenhum ponto de melhoria verificável no content.md")
    return dados, diag, pagina(dados, diag, recibo["site_url"], (pasta / "og.jpg").is_file(), fonte_css()), recibo


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
    m = re.search(r"(?i)aliased:\s*(https://\S+)", r.stdout or "")
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
    site = situacao_do_site(dados)
    site_hoje = conferir_site(site["url"], dados["nome"]) if site and site["tipo"] == "morto" else None
    fotos = sum(1 for f in (pasta / "Fotos").glob("*") if f.is_file()) if (pasta / "Fotos").is_dir() else 0
    d = diagnostico(dados, site_hoje, dt.date.today().strftime("%d/%m/%Y"), fotos)
    if site_hoje:
        d["bons"] = d["bons"] + [{"titulo": f"(site antigo hoje: {site_hoje})", "porque": ""}]
    linhas = [f"{pasta.name}: {dados['nome']} · nota {dados['nota']} ({dados['avaliacoes']}) · lido em {d['lido_em']}"]
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
            self.assertNotIn("fixo", json.dumps(d, ensure_ascii=False))
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

    class Publicar(unittest.TestCase):
        """Raiz temporária própria; o deploy e a rede são dublês."""

        def setUp(self):
            global AUTO, LOGS
            self.raiz = Path(tempfile.mkdtemp(prefix="raio-x-teste-"))
            assert self.raiz.name.startswith("raio-x-teste-") and str(self.raiz).startswith(tempfile.gettempdir())
            self.antes = (AUTO, LOGS, globals()["baixar"])
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
            AUTO, LOGS, globals()["baixar"] = self.antes
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
    for c in (Leitura, Diagnostico, Pagina, Publicar):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(c))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
