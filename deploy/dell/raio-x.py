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
demo (o `index.html` que está no ar): as seções com âncora e os botões de WhatsApp,
ligar e mapa.

Versão 3 (09/10/2026): a Nota de presença, de 0 a 18, pelo cálculo PRUMO
(`prumo-mapa/calculo_prumo.py`; método em ~/prumo/05-entrega-mapa/calculo-prumo.md):
seis blocos de 0 a 3 (aparece na busca, nota, avaliações, responde às avaliações,
perfil completo, site e WhatsApp). Bloco sem dado sai "não medimos" e fica fora da
conta; com menos de 4 medidos a seção não aparece. Junto, a conta aberta em R$: o dono
digita quanto vale um cliente e a página faz "1 cliente a mais por mês × valor" (JS
inline gerado pelo módulo), sempre como cenário. Para o bloco do site, a página do
site do perfil é lida uma vez (viewport para celular, link de WhatsApp).

Versão 4 (09/10/2026, teste de usabilidade e funil): a página em três atos. Veredito, na
primeira tela do celular: nome, nota do Google, a faixa da Nota de presença (sem o "X de 18")
e o que segura e o que perde cliente. Por quê: os pontos abertos e o resto em detalhes
fechados (`<details>`, sem JS), com o "X de 18" e a calculadora em "Como fizemos". O que
fazer: a demonstração, o Encontrado com preço e o botão para o WhatsApp do PRUMO (no
celular, também numa barra fixa). O preço do Respondido só na conversa. Medição sem cookie
preparada e desligada (URL_EVENTOS vazia no JS da página).

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
import urllib.parse
import urllib.request
from pathlib import Path

# O cálculo PRUMO (Nota de presença e a calculadora) mora com o Mapa, em prumo-mapa/calculo_prumo.py:
# no repo, ao lado deste arquivo; no Dell, na cópia instalada em ~/.local/share/prumo-mapa/ (a mesma
# pasta de onde vem a fonte). Sem ele o Raio-X sai como na versão 2, sem a nota (e o main avisa no log).
for _pasta in (Path(__file__).resolve().parent / "prumo-mapa",
               Path(os.environ.get("RAIO_X_CALCULO", str(Path.home() / ".local/share/prumo-mapa")))):
    if (_pasta / "calculo_prumo.py").is_file():
        sys.path.insert(0, str(_pasta))
        break
try:
    import calculo_prumo
except ImportError:
    calculo_prumo = None

AUTO = Path(os.environ.get("AUTO_DIR", str(Path.home() / "auto-site")))
LOGS = AUTO / ".logs"
SITE_LEADS = Path(os.environ.get("SITE_LEADS", str(Path.home() / ".local/share/n8n-estado/site-leads.json")))
FONTE = Path(os.environ.get("RAIO_X_FONTE", str(Path.home() / ".local/share/prumo-mapa/archivo.woff2")))
VERCEL_SCOPE = os.environ.get("VERCEL_SCOPE", "romulodesigns")
# Sobe quando o texto ou as regras mudam: `--pendentes` refaz quem está `pronto` com versão menor.
# 2 (08/10/2026): concorrência da mesma busca, o que as avaliações dizem, o perfil item por item,
# o caminho do cliente ligado às seções do demo e os dois serviços com preço.
# 3 (09/10/2026): a Nota de presença (cálculo PRUMO, seis blocos de 0 a 3) e a conta aberta em R$.
# 4 (09/10/2026): três atos (veredito, por quê, o que fazer), o botão do WhatsApp do PRUMO e sem o
# preço do Respondido; sai o caminho do cliente.
# 5 (14/10/2026): o mesmo conteúdo numa folha de desktop de verdade (referência do Dribbble no CSS):
# abertura em duas colunas, campo de brasa com a nota e a demonstração ao lado, as avaliações da
# busca em barras e o fecho em duas metades. Aprovado pelo Rômulo no Raio-X da Jéssica Barbosa.
# Sem o calculo_prumo instalado a página sai sem a nota e a versão fica 2: nada de refazer à toa.
VERSAO = 5 if calculo_prumo else 2
CAMINHO = "raio-x"
MARCA = f'data-raio-x="{VERSAO}"'
MAX_PONTOS = 3
MAX_BONS = 5
LIMITE_DE_DEPLOY = re.compile(r"(?i)api-deployments-free-per-day|Resource is limited|too many deployments"
                              r"|maximum number of projects")
PRECO = "R$ 990 + R$ 69/mês"
# O preço do Respondido não vai na página: só se fala na conversa (decisões de 08 e 09/10/2026).
# O WhatsApp do PRUMO (chip novo de 09/10/2026) é o destino dos dois botões do fim da página.
WHATSAPP_PRUMO = "5527999762786"

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
    return conferir_site_completo(url, nome)["estado"]


def conferir_site_completo(url: str, nome: str) -> dict:
    """`conferir_site` e, com o site no ar, o que a página diz de celular e WhatsApp
    (`ler_pagina_do_site`), numa leitura só: {'estado', 'celular', 'whatsapp'}."""
    codigo, corpo = baixar(url, timeout=20, navegador=True)
    if codigo != 200:
        return {"estado": "fora", "celular": None, "whatsapp": None}
    bruto = corpo.decode("utf-8", errors="replace")
    rotulo = dominio(url).split(".")[0].lower()
    texto = sem_acento(bruto).lower()
    texto = texto.replace(dominio(url).lower(), " ").replace(rotulo, " ")
    palavras = [w for w in re.findall(r"[a-z0-9]{4,}", sem_acento(nome).lower()) if w not in GENERICAS]
    estado = "no_ar" if not palavras or any(re.search(rf"\b{re.escape(w)}\b", texto) for w in palavras) else "sem_nome"
    if estado != "no_ar":
        return {"estado": estado, "celular": None, "whatsapp": None}
    return {"estado": estado, **ler_pagina_do_site(bruto)}


def ler_pagina_do_site(texto: str) -> dict:
    """O HTML da página que o botão "Site" abre: {'celular': bool, 'whatsapp': True|False|None}.
    Celular = tem a meta viewport com width=device-width (sem ela o celular desenha a página
    na largura de computador). WhatsApp = link wa.me/api.whatsapp/whatsapp://; sem link mas
    com a palavra no HTML (widget montado por script) = None: na dúvida, não se afirma falta."""
    t = texto or ""
    celular = any(re.search(r"name\s*=\s*[\"']?viewport", m, re.I) and re.search(r"width\s*=\s*device-width", m, re.I)
                  for m in re.findall(r"<meta\b[^>]*>", t, re.I))
    if re.search(r"(?i)(https?://(wa\.me|wa\.link|api\.whatsapp\.com|web\.whatsapp\.com/send)|whatsapp://)", t):
        whatsapp = True
    else:
        whatsapp = None if re.search(r"(?i)whatsapp", t) else False
    return {"celular": celular, "whatsapp": whatsapp}


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
                places: dict | None = None, demo: dict | None = None, site_pagina: dict | None = None) -> dict:
    """O que já está bom e os pontos de melhoria (no máximo 3, na ordem de peso).
    Cada item é {'titulo', 'porque'} e só existe se o fato está no content.md ou no Places.
    `site_hoje` = `conferir_site` do site que o perfil mostra (None = não conferido:
    o ponto não sai); `hoje` = a data dessa conferência; `fotos_baixadas` = arquivos em Fotos/
    (sem nenhuma, "nenhuma foto é de vocês" poderia ser "o perfil não tem foto"); `places` =
    `ler_places` (None = sem chave ou a API falhou: nada de concorrência nem de avaliações);
    `demo` = `ler_demo` do index.html que está no ar; `site_pagina` = celular e WhatsApp da
    página do site do perfil (`ler_pagina_do_site`, só com ela no ar). Sai também `presenca`,
    a Nota de presença do cálculo PRUMO (None sem o módulo)."""
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
    diag = {"bons": bons, "pontos": pontos[:MAX_PONTOS], "lido_em": data_br(c.get("Criado em", "")),
            "maps": (detalhes or {}).get("maps") or c.get("Google Maps", ""), "cidade": cidade, "vertical": vertical,
            "nota": nota, "avaliacoes": n, "horario": horario, "fotos": fotos, "fotos_baixadas": fotos_baixadas,
            "telefone": telefone, "recente": recente, "site": site, "site_hoje": site_hoje, "hoje": hoje,
            "concorrencia": conc, "avaliacoes_lidas": avals, "demo": demo,
            "places_em": data_br((places or {}).get("lido_em", "")),
            "horario_resumo": resumo_do_horario((detalhes or {}).get("horario")),
            "endereco": c.get("Endereço", "").strip(),
            "categoria": str((detalhes or {}).get("tipo") or "").strip(),
            "tem_telefone": len(re.sub(r"\D", "", c.get("Telefone", ""))) >= 8,
            "site_pagina": site_pagina if site_hoje == "no_ar" else None}
    diag["presenca"] = calculo_prumo.nota_de_presenca(**entradas_da_presenca(diag)) if calculo_prumo else None
    return diag


def entradas_da_presenca(diag: dict) -> dict:
    """O diagnóstico nos termos do cálculo PRUMO (calculo_prumo.nota_de_presenca). Item que o
    Raio-X não conferiu vai como None: o módulo o deixa fora da conta, nunca como falta."""
    conc = diag.get("concorrencia")
    buscas = None
    if conc:
        buscas = [{"consulta": conc["consulta"], "posicao": conc["posicao"], "lidos": conc["lidos"],
                   "concorrentes": [{"id": r.get("id"), "avaliacoes": r.get("avaliacoes")} for r in conc["outros"]]}]
    sem_comum = any(r in sem_acento(diag.get("vertical", "")).lower() for r in SEM_HORARIO_COMUM)
    h, f = diag.get("horario"), diag.get("fotos")
    categoria = diag.get("categoria", "").lower()
    site = diag.get("site")
    perfil = {
        "horario": "ok" if h else ("falta" if h is False and not sem_comum else None),
        "fotos": "ok" if f else ("falta" if f == 0 and diag.get("fotos_baixadas") else None),
        # Categoria genérica ("Serviços") pode ser só o limite da tabela de tipos do Places, não o
        # perfil: não vira falta. Específica = em dia.
        "categoria": "ok" if categoria and categoria not in TIPOS_GENERICOS else None,
        "telefone": "ok" if diag.get("tem_telefone") else None,
        "site": None if site is None else ("falta" if site["tipo"] == "nenhum" else "ok"),
    }
    s = None
    if site is not None:
        if site["tipo"] in ("nenhum", "rede"):
            s = {"tipo": site["tipo"], "onde": nome_da_rede(site["url"]) if site["tipo"] == "rede" else ""}
        else:  # próprio ou o antigo fora do ar: vale o que a conferência de hoje achou
            pag = diag.get("site_pagina") or {}
            s = {"tipo": "proprio", "estado": diag.get("site_hoje"), "celular": pag.get("celular"),
                 "whatsapp": pag.get("whatsapp")}
    return {"buscas": buscas, "nota": diag.get("nota"), "avaliacoes": diag.get("avaliacoes"), "respostas": None,
            "perfil": perfil, "site": s}


# ------------------------------------------------------------------ página (PURO)

CSS = """
:root{--ferro-900:#1B1512;--ferro-800:#241D19;--ferro-700:#332A24;--ferro-600:#4A3E36;--brasa:#E0490F;
--brasa-clara:#FF6A2B;--oxido:#8A2B0C;--ocre:#E8A33D;--sobre-brasa:#110B08;--pedra-100:#E4DED6;--pedra-200:#CFC7BD;
--pedra-400:#9A9089;--pedra-600:#6B625B;--nota-claro:#5E564F;--lado:clamp(16px,3.2vw,40px);color-scheme:light}
*{box-sizing:border-box;margin:0;padding:0;border-radius:0}
html{background:var(--pedra-100);-webkit-text-size-adjust:100%}
body{font-family:'Archivo','Arial Narrow','Helvetica Neue',Arial,sans-serif;font-size:17px;line-height:1.5;
color:var(--ferro-900);background:var(--pedra-100);overflow-x:hidden}
a{color:inherit}
img{display:block;max-width:100%;height:auto}
/* Versão 5 (14/10/2026): a folha usa a largura do desktop. Composição do relatório anual "Monetone"
   (Sebo, Dribbble 18889326): numeral gigante, abertura em duas colunas, campo de cor com a foto ao lado,
   faixa escura com barras e o fecho em duas metades. As cores e a fonte continuam as do PRUMO. */
.folha{max-width:1280px;margin:0 auto;padding:0 var(--lado) 56px}
.topo{display:flex;align-items:center;gap:16px;border-bottom:2px solid var(--ferro-900);min-height:64px}
.marca{display:flex;align-items:center;gap:7px;font-size:15px;letter-spacing:.02em;font-weight:900;
font-variation-settings:'wdth' 118,'wght' 900}
.marca .fio{width:2px;height:15px;background:var(--brasa);display:block}
.topo .miudo{margin-right:auto}
.topo-demo{display:none;align-items:center;min-height:44px;font-weight:750;text-decoration:underline;
text-decoration-color:var(--brasa);text-decoration-thickness:2px;text-underline-offset:5px}
.brasa{color:var(--brasa)}
.miudo{font-size:12px;letter-spacing:.12em;text-transform:uppercase;font-weight:700;color:var(--nota-claro)}
.kicker{font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--oxido)}
.ato{margin-top:clamp(64px,9vw,128px)}
.ato.veredito{margin-top:clamp(28px,5vw,64px)}
.ato > .kicker:first-child{display:flex;align-items:center;gap:8px;margin-bottom:clamp(18px,2.4vw,28px)}
.ato > .kicker:first-child::before{content:"";width:3px;height:16px;background:var(--brasa);display:block}
h1{font-size:clamp(36px,5.6vw,80px);line-height:.95;letter-spacing:-.03em;font-weight:800;margin-top:12px;
font-variation-settings:'wdth' 100,'wght' 800;overflow-wrap:break-word;max-width:18ch}
/* nome do Google comprido ("Fulana Advocacia - Advogada Trabalhista e Previdenciarista"): letra menor, não sete linhas */
h1.longo{font-size:clamp(30px,3.8vw,56px);max-width:24ch}
h2{font-size:clamp(26px,3.4vw,44px);line-height:1.02;font-weight:800;letter-spacing:-.02em;
font-variation-settings:'wdth' 100,'wght' 800}
.lede{color:var(--ferro-600);max-width:44ch;font-size:clamp(16px,1.3vw,19px)}

/* Ato 1 · a abertura em duas colunas, o campo de brasa com o numeral e a demonstração ao lado */
.abertura{display:grid;gap:16px;align-items:end}
.abertura .kicker{margin:0}
.placa{display:grid;margin-top:clamp(24px,4vw,48px)}
.campo{background:var(--brasa);color:var(--sobre-brasa);padding:clamp(22px,3.6vw,48px);display:grid;gap:clamp(18px,2.4vw,28px);
align-content:space-between}
.nota{display:grid;gap:clamp(18px,2.6vw,34px)}
.nota .num{font-size:clamp(108px,16vw,232px);line-height:.78;font-weight:900;letter-spacing:-.05em;
font-variation-settings:'wdth' 112,'wght' 900;font-variant-numeric:lining-nums}
.nota .leitura{font-size:15px;line-height:1.35;font-weight:600}
.nota .leitura br{display:none}
.nota .leitura .sep::before{content:" · "}
.campo .faixa-presenca{margin-top:0;border-top:2px solid rgba(20,15,12,.28);padding-top:16px}
.campo .faixa-presenca .miudo,.campo .faixa-presenca .faixa-texto{color:var(--sobre-brasa)}
.campo .regua-faixas li{border-top-color:rgba(20,15,12,.18);color:var(--sobre-brasa);font-weight:600}
.campo .regua-faixas li.atual{border-top-color:var(--sobre-brasa);font-weight:900}
.campo .regua-faixas .prumo-fio::before{background:var(--pedra-100)}
.vitrine{display:none;position:relative;background:var(--ferro-900);text-decoration:none;overflow:hidden}
.vitrine img{width:100%;height:100%;object-fit:cover;object-position:50% 30%}
.vitrine span{position:absolute;left:0;right:0;bottom:0;padding:44px 22px 18px;color:var(--pedra-100);font-weight:750;
background:linear-gradient(to top,rgba(17,11,8,.86),rgba(17,11,8,0))}
.resumo{margin-top:clamp(8px,1vw,12px);display:grid;gap:clamp(8px,1vw,12px)}
.resumo div{padding:18px 20px;display:grid;gap:4px;border:2px solid var(--ferro-900)}
.resumo div + div{background:var(--ferro-900);color:var(--pedra-100)}
.resumo .miudo{color:inherit;opacity:.8}
.resumo strong{font-size:clamp(19px,1.6vw,22px);line-height:1.25;font-weight:750}

/* Ato 2 · os pontos à direita do título; a faixa escura com as avaliações; os detalhes em duas colunas */
.pontos{display:grid;gap:20px}
.lista{list-style:none;border-top:2px solid var(--ferro-900)}
.lista li{padding:18px 0;border-bottom:1px solid var(--pedra-400);display:grid;grid-template-columns:44px 1fr;gap:12px}
.lista li > div{min-width:0}
.lista .marcador{font-size:13px;font-weight:800;letter-spacing:.08em;padding-top:4px;color:var(--nota-claro)}
.lista h3{font-size:clamp(19px,1.7vw,23px);line-height:1.22;font-weight:750;font-variation-settings:'wght' 750}
.lista p{color:var(--ferro-600);margin-top:6px;font-size:16px;max-width:62ch}
.pontos .lista li{grid-template-columns:clamp(56px,6vw,96px) 1fr;padding:24px 0}
.pontos .lista .marcador{font-size:clamp(34px,4.4vw,64px);line-height:.85;color:var(--brasa);padding-top:0;font-weight:900;
letter-spacing:-.03em;font-variation-settings:'wdth' 112,'wght' 900}
.bons .lista .marcador{color:var(--ferro-900)}
.placar-busca{background:var(--ferro-900);color:var(--pedra-100);margin:clamp(48px,6vw,80px) calc(50% - 50vw) 0;
padding:clamp(40px,6vw,80px) calc(50vw - 50% + var(--lado))}
.placar-busca .dentro{max-width:1200px;display:grid;gap:clamp(20px,3vw,40px)}
.placar-busca h2{color:var(--pedra-100);max-width:24ch;font-size:clamp(24px,2.6vw,36px)}
.placar-busca .intro{color:var(--pedra-200);margin-top:12px}
.barras{list-style:none;display:grid;gap:14px}
.barras li{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:6px 16px;align-items:baseline}
.barras .quem{font-weight:650;overflow-wrap:anywhere;color:var(--pedra-200)}
.barras .conta{font-weight:900;font-variation-settings:'wdth' 112,'wght' 900;white-space:nowrap;font-variant-numeric:tabular-nums}
.barras .barra{grid-column:1/-1;height:14px;background:var(--ferro-700)}
.barras .barra span{display:block;height:100%;background:var(--pedra-400)}
.barras li.voces .quem{color:var(--pedra-100)}
.barras li.voces .conta{color:var(--brasa-clara)}
.barras li.voces .barra span{background:var(--brasa)}
.detalhes{margin-top:clamp(40px,5vw,72px);border-top:2px solid var(--ferro-900)}
.detalhe{border-bottom:1px solid var(--pedra-400)}
.detalhe > summary{list-style:none;cursor:pointer;min-height:56px;display:flex;align-items:center;
justify-content:space-between;gap:12px;padding:14px 0;font-size:clamp(19px,1.6vw,22px);line-height:1.25;font-weight:750;
font-variation-settings:'wght' 750}
.detalhe > summary::-webkit-details-marker{display:none}
.detalhe > summary::after{content:"+";flex:none;width:28px;text-align:center;font-size:28px;line-height:1;font-weight:700;
color:var(--brasa)}
.detalhe[open] > summary::after{content:"–"}
.detalhe > summary:hover{color:var(--oxido)}
.detalhe > summary:focus-visible{outline:3px solid var(--ocre);outline-offset:2px}
.detalhe .corpo{padding:0 0 28px;max-width:860px}
.detalhe .corpo > .intro:first-child{margin-top:0}
.detalhe .corpo h3.sub{font-size:20px;line-height:1.2;font-weight:800;margin-top:28px}

/* Ato 3 · a demonstração e a oferta, lado a lado no desktop */
.fecho{display:grid;gap:clamp(8px,1vw,12px)}
.demo{display:grid;gap:16px;align-content:start}
.demo img{width:100%;height:auto;border:2px solid var(--ferro-900);background:var(--pedra-200)}
.demo p{color:var(--ferro-600);max-width:52ch}
.botao{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:12px 20px;
background:var(--ferro-900);color:var(--pedra-100);text-decoration:none;font-weight:800;letter-spacing:.02em;
border:2px solid var(--ferro-900)}
.botao:hover{background:var(--brasa);border-color:var(--brasa);color:var(--ferro-900)}
.botao:focus-visible{outline:3px solid var(--ocre);outline-offset:3px}
.oferta{background:var(--ferro-900);color:var(--pedra-100);padding:clamp(28px,4vw,56px);display:grid;gap:14px;align-content:center}
.oferta h2{color:var(--pedra-100)}
.oferta .miudo{color:var(--pedra-400)}
.oferta .preco{white-space:nowrap;font-size:clamp(26px,2.9vw,42px);font-weight:900;line-height:1;color:var(--brasa-clara);letter-spacing:-.02em;
font-variation-settings:'wdth' 112,'wght' 900}
.oferta p{color:var(--pedra-200);max-width:52ch}
.oferta strong{color:var(--pedra-100)}
.acoes{display:grid;gap:6px;margin-top:8px;justify-items:start}
.botao-zap{display:inline-flex;align-items:center;justify-content:center;width:100%;min-height:56px;padding:14px 24px;
background:var(--brasa);color:var(--ferro-900);border:2px solid var(--brasa);text-decoration:none;font-size:19px;
line-height:1.2;font-weight:800;letter-spacing:.01em;font-variation-settings:'wdth' 108,'wght' 800}
.botao-zap:hover{background:var(--brasa-clara);border-color:var(--brasa-clara)}
.botao-zap:focus-visible{outline:3px solid var(--ocre);outline-offset:3px}
.link-zap{display:inline-flex;align-items:center;min-height:44px;color:var(--pedra-100);font-weight:700;
text-decoration:underline;text-decoration-color:var(--brasa);text-decoration-thickness:2px;text-underline-offset:4px}
.link-zap:hover{color:var(--brasa-clara)}
.link-zap:focus-visible{outline:3px solid var(--ocre);outline-offset:2px}
.barra-fixa{display:none}
footer{margin-top:clamp(48px,6vw,80px);border-top:2px solid var(--ferro-900);padding-top:14px;font-size:13px;
color:var(--nota-claro);display:grid;gap:6px}
.intro{color:var(--ferro-600);margin-top:10px;max-width:62ch}
.busca{list-style:none;margin-top:16px;border-top:2px solid var(--ferro-900)}
.busca li{display:grid;grid-template-columns:36px 1fr;gap:4px 10px;padding:12px 0;border-bottom:1px solid var(--pedra-400)}
.busca .pos{font-weight:900;font-size:20px;line-height:1.1;font-variation-settings:'wdth' 118,'wght' 900;color:var(--nota-claro)}
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
blockquote cite{display:block;font-style:normal;font-size:14px;color:var(--nota-claro);margin-top:4px}
.check{list-style:none;margin-top:16px;border-top:1px solid var(--pedra-400)}
.check li{display:grid;grid-template-columns:28px 1fr;gap:4px 10px;padding:12px 0;border-bottom:1px solid var(--pedra-400)}
.check .sinal{font-weight:900;font-size:18px;line-height:1.2}
.check .ok .sinal{color:var(--ferro-900)}
.check .falta .sinal{color:var(--brasa)}
.check .nc .sinal{color:var(--pedra-400)}
.check .det{grid-column:2;font-size:15px;color:var(--ferro-600)}
.metodo{list-style:none;margin-top:12px;display:grid;gap:8px;font-size:15px;color:var(--ferro-600)}
.metodo li{padding-left:14px;border-left:2px solid var(--pedra-400)}
.visualmente-oculto{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (min-width:640px){.resumo{grid-template-columns:1fr 1fr}.botao-zap{width:auto}}
@media (min-width:900px){
.topo-demo{display:inline-flex}
.abertura{grid-template-columns:1.35fr 1fr;gap:48px}
.placa{grid-template-columns:1fr 1.1fr}
.placa.so-campo{grid-template-columns:1fr}
.vitrine{display:block;min-height:100%}
.pontos{grid-template-columns:5fr 7fr;gap:48px;align-items:start}
.pontos h2{position:sticky;top:24px}
.placar-busca .dentro{grid-template-columns:5fr 7fr;gap:48px;align-items:start}
.detalhes{display:grid;grid-template-columns:5fr 7fr;column-gap:48px;border-top:0}
.detalhes::before{content:"Para conferir";font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;
color:var(--oxido);border-top:2px solid var(--ferro-900);padding-top:18px;grid-row:1 / span 9}
.detalhes .detalhe{grid-column:2}
.detalhes .detalhe:first-of-type{border-top:2px solid var(--ferro-900)}
.fecho{grid-template-columns:1.15fr 1fr;align-items:stretch}
.demo{border:2px solid var(--ferro-900);padding:clamp(24px,3vw,40px);align-content:space-between}
}
@media (max-width:719.98px){
html.com-js body{padding-bottom:88px}
html.com-js .barra-fixa{display:block;position:fixed;left:0;right:0;bottom:0;z-index:10;background:var(--ferro-900);
border-top:2px solid var(--brasa);padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));
transform:translateY(100%);visibility:hidden}
html.com-js .barra-fixa.visivel{transform:none;visibility:visible}
.barra-fixa .botao-zap{width:100%;min-height:52px}}
@media (prefers-reduced-motion:no-preference){.botao,.botao-zap{transition:background-color .15s ease,color .15s ease}
.detalhe[open] > .corpo{animation:detalhe-abre .22s ease-out}
@keyframes detalhe-abre{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}
.campo .nota .num{animation:numeral-entra .7s cubic-bezier(.2,.8,.2,1) both}
@keyframes numeral-entra{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:none}}}
@media (max-width:719.98px) and (prefers-reduced-motion:no-preference){
html.com-js .barra-fixa{transition:transform .32s cubic-bezier(.2,.8,.2,1),visibility 0s linear .32s}
html.com-js .barra-fixa.visivel{transition:transform .32s cubic-bezier(.2,.8,.2,1),visibility 0s}}
"""

# O único JS da página fora da calculadora: a barra fixa do celular (aparece quando o "O que fazer"
# entra na tela) e a medição sem cookie, preparada e desligada. Sem JS, a barra não aparece e o
# botão do fim continua lá; com URL_EVENTOS vazia, nada é enviado a ninguém.
JS_PAGINA = """(function(){
// Fica vazia até existir o webhook de eventos no n8n do Dell. Vazia, nada sai desta página.
const URL_EVENTOS = '';
// Só o nome do evento, o caminho e a hora: nada de cookie, localStorage ou identificador.
function evento(e){if(!URL_EVENTOS||!navigator.sendBeacon)return;
try{navigator.sendBeacon(URL_EVENTOS,JSON.stringify({e:e,p:location.pathname,t:Date.now()}))}catch(_){}}
document.documentElement.classList.add('com-js');
addEventListener('load',function(){evento('raiox-aberto')});
document.addEventListener('click',function(ev){
const a=ev.target&&ev.target.closest?ev.target.closest('[data-evento]'):null;if(a)evento(a.getAttribute('data-evento'))});
const ato=document.getElementById('o-que-fazer'),barra=document.querySelector('.barra-fixa');
if(!ato||!('IntersectionObserver' in window))return;
const olho=new IntersectionObserver(function(itens){
if(!itens.some(function(i){return i.isIntersecting}))return;
olho.disconnect();if(barra)barra.classList.add('visivel');evento('raiox-o-que-fazer')});
olho.observe(ato);
})();"""


def fonte_css(caminho: Path = FONTE) -> str:
    """Archivo (a fonte do PRUMO) embutida: a página é um arquivo só, sem CDN."""
    try:
        dados = base64.b64encode(caminho.read_bytes()).decode("ascii")
    except OSError:
        return ""
    return ("@font-face{font-family:'Archivo';src:url(data:font/woff2;base64," + dados
            + ") format('woff2');font-weight:100 900;font-stretch:62% 125%;font-display:swap}")


def link_whatsapp(texto: str) -> str:
    """O wa.me do PRUMO com a mensagem já começada (codificada; o nome do lead vai dentro dela)."""
    return f"https://wa.me/{WHATSAPP_PRUMO}?text=" + urllib.parse.quote(texto, safe="")


def detalhe(titulo: str, corpo: str, classe: str = "") -> str:
    """Um `<details>` fechado: abre no toque, sem JS, e o leitor de tela anuncia aberto/fechado.
    Corpo vazio = detalhe ausente (seção que não existe para este lead não aparece)."""
    if not corpo:
        return ""
    return (f'<details class="detalhe{" " + classe if classe else ""}"><summary>{html.escape(titulo)}</summary>'
            f'<div class="corpo">{corpo}</div></details>')


def pagina(dados: dict, diag: dict, site_url: str, tem_og: bool, fonte: str = "") -> str:
    """A página em três atos (versão 4): veredito (a primeira tela do celular), por quê (os pontos
    abertos e o resto em detalhes fechados) e o que fazer (demonstração, preço e o WhatsApp)."""
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
    presenca = diag.get("presenca") if calculo_prumo else None
    zap_site = link_whatsapp(f"Olá, PRUMO. Vi o Raio-X da {nome} e quero o site no ar.")
    zap_respondido = link_whatsapp(f"Olá, PRUMO. Vi o Raio-X da {nome} e quero conversar sobre o WhatsApp que responde.")
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
        f"<style>{fonte}{CSS}{calculo_prumo.CSS_PRESENCA if calculo_prumo else ''}</style></head>",
        f'<body {MARCA}><main class="folha">',
        '<header class="topo"><div class="marca"><span class="fio"></span><span>PRU<span class="brasa">MO</span></span></div>'
        '<span class="miudo">Raio-X</span>'
        '<a class="topo-demo" href="/" data-evento="raiox-demo">A demonstração do site</a></header>',
    ]

    # Ato 1 · Veredito: a abertura em duas colunas e o campo de brasa com a nota; no desktop, a
    # demonstração ao lado do campo. No celular cabe na primeira tela, sem a demonstração.
    classe_h1 = ' class="longo"' if len(nome) > 36 else ""
    sep = '<span class="sep"></span>'  # no celular, quebra de linha; no campo, " · " (CSS)
    ato1 = ['<section class="ato veredito" id="veredito" data-ato="veredito" aria-labelledby="t-veredito">',
            '<div class="abertura"><div><p class="kicker">Como vocês aparecem no Google</p>',
            f'<h1 id="t-veredito"{classe_h1}>{e(nome)}</h1></div>']
    if onde:
        ato1.append(f'<p class="lede">{e(onde)}. Feito pelo PRUMO só com o que qualquer pessoa vê no Google, sem pedir nada a vocês.</p>')
    else:
        ato1.append('<p class="lede">Feito pelo PRUMO só com o que qualquer pessoa vê no Google, sem pedir nada a vocês.</p>')
    ato1.append("</div>")
    lido = diag.get("places_em") or diag["lido_em"]
    campo = []
    if nota is not None and n:
        campo.append(f'<div class="nota"><span class="num">{e(numero(nota))}</span>'
                     f'<span class="leitura">nota no Google<br>{sep}{e(n)} avaliaç{"ão" if n == 1 else "ões"}'
                     f'{"<br>" + sep + "lida em " + e(lido) if lido else ""}</span></div>')
    if presenca:
        campo.append(calculo_prumo.bloco_faixa_html(presenca))
    if campo:
        ato1.append(f'<div class="placa{"" if tem_og else " so-campo"}"><div class="campo">' + "".join(campo) + "</div>")
        if tem_og:
            ato1.append(f'<a class="vitrine" href="/" data-evento="raiox-demo" aria-label="Abrir a demonstração do site de {e(nome)}">'
                        '<img src="/og.jpg" width="1200" height="630" alt="" loading="lazy">'
                        '<span>A demonstração que montamos para vocês →</span></a>')
        ato1.append("</div>")
    if bons and pontos:
        ato1.append('<div class="resumo"><div><span class="miudo">O que segura cliente</span>'
                    f'<strong>{e(bons[0]["titulo"])}</strong></div><div><span class="miudo">O que perde cliente</span>'
                    f'<strong>{e(pontos[0]["titulo"])}</strong></div></div>')
    ato1.append("</section>")
    partes.append("".join(x for x in ato1 if x))

    # Ato 2 · Por quê: os pontos abertos; o resto em detalhes fechados, para quem quer conferir.
    ato2 = ['<section class="ato por-que" id="por-que" data-ato="por-que" aria-labelledby="t-por-que">',
            '<p class="kicker" id="t-por-que">Por quê</p>']
    if pontos:
        ato2.append(f'<div class="pontos"><h2>{e(titulo_pontos)}</h2><ul class="lista">'
                    + "".join(item(f"{i:02d}", p) for i, p in enumerate(pontos, 1)) + "</ul></div>")
    ato2.append(placar_da_busca(diag, nome, e))
    ato2.append('<div class="detalhes">')
    if bons:
        ato2.append(detalhe("O que já está bom", '<ul class="lista">' + "".join(item("✓", b) for b in bons) + "</ul>",
                            "bons"))
    ato2.append(detalhe("Quem aparece antes de vocês na busca", secao_busca(diag, nome, e)))
    ato2.append(detalhe("O que os clientes dizem", secao_avaliacoes(diag, e)))
    linhas = checklist(diag)
    if linhas:
        sinal = {"ok": "✓", "falta": "✕", "nc": "–"}
        ato2.append(detalhe("O perfil no Google, item por item",
                            '<p class="intro">O que o cliente encontra quando abre o perfil de vocês no Google Maps.</p><ul class="check">'
                            + "".join(f'<li class="{x["estado"]}"><span class="sinal" aria-hidden="true">{sinal[x["estado"]]}</span>'
                                      f'<span><span class="visualmente-oculto">{e({"ok": "Em dia: ", "falta": "Falta: ", "nc": "Não conferido: "}[x["estado"]])}</span>'
                                      f'{e(x["item"])}</span><span class="det">{e(x["detalhe"])}</span></li>' for x in linhas)
                            + "</ul>"))
    nota_html = calculo_prumo.bloco_html(presenca, nome) if presenca else ""
    ato2.append(detalhe("Como fizemos este Raio-X",
                        nota_html + ('<h3 class="sub">De onde vem cada dado</h3>' if nota_html else "")
                        + secao_metodo(diag, e)))
    ato2.append("</div></section>")
    partes.append("".join(x for x in ato2 if x))

    # Ato 3 · O que fazer: a demonstração, o preço do Encontrado e o WhatsApp do PRUMO.
    ato3 = ['<section class="ato o-que-fazer" id="o-que-fazer" data-ato="o-que-fazer" aria-labelledby="t-o-que-fazer">',
            '<p class="kicker" id="t-o-que-fazer">O que fazer</p>',
            '<div class="fecho"><div class="demo"><h2>Montamos uma demonstração do site de vocês</h2>']
    if tem_og:
        ato3.append(f'<a href="/" data-evento="raiox-demo" aria-label="Abrir a demonstração do site de {e(nome)}">'
                    f'<img src="/og.jpg" width="1200" height="630" alt="Prévia da demonstração do site de {e(nome)}" loading="lazy"></a>')
    ato3.append('<p>Com o nome, o contato e o jeito de vocês. Abre no celular do mesmo jeito que o cliente veria.</p>'
                '<p><a class="botao" href="/" data-evento="raiox-demo">Ver a demonstração</a></p></div>')
    ato3.append('<div class="oferta"><span class="miudo">Para colocar no ar</span><h2>Encontrado</h2>'
                f'<p class="preco">{e(PRECO)}</p>'
                '<p>Esta demonstração no ar, com o endereço de vocês e ligada ao botão “Site” do Google. Hospedagem e '
                'ajustes incluídos. <strong>Vocês só pagam depois de ver funcionando.</strong></p>'
                f'<div class="acoes"><a class="botao-zap" href="{e(zap_site)}" target="_blank" rel="noopener" '
                'data-evento="raiox-whatsapp-site">Quero o site no ar</a>'
                f'<a class="link-zap" href="{e(zap_respondido)}" target="_blank" rel="noopener" '
                'data-evento="raiox-whatsapp-respondido">Quero conversar sobre o WhatsApp que responde</a></div></div>')
    ato3.append("</div></section>")
    partes.append("".join(ato3))

    rodape = ["<footer>"]
    rodape.append(f"<span>Dados públicos do Google Maps{', lidos em ' + e(lido) if lido else ''}."
                  + (f' <a href="{e(diag["maps"])}" rel="noopener">Ver o perfil no Google Maps</a>.' if diag["maps"].startswith("https://") else "")
                  + "</span>")
    rodape.append('<span>PRUMO · <a href="https://prumo.services" rel="noopener">prumo.services</a></span></footer>')
    partes.append("".join(rodape))
    partes.append("</main>")
    # A barra do celular: o mesmo botão, fixa no rodapé depois que o "O que fazer" aparece (JS_PAGINA).
    partes.append(f'<div class="barra-fixa"><a class="botao-zap" href="{e(zap_site)}" target="_blank" rel="noopener" '
                  'data-evento="raiox-whatsapp-site">Quero o site no ar</a></div>')
    partes.append(f"<script>{JS_PAGINA}</script>")
    partes.append("</body></html>\n")
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


def placar_da_busca(diag: dict, nome: str, e) -> str:
    """A faixa escura do Ato 2 (versão 5): as avaliações de vocês ao lado das dos primeiros da mesma
    busca, em barras. Avaliação é o dado que o dono reconhece e que ninguém compra; a ordem e o site
    de cada um ficam no detalhe "Quem aparece antes de vocês na busca". '' sem a busca ou sem
    avaliações de vocês."""
    conc, n = diag.get("concorrencia"), diag.get("avaliacoes")
    if not conc or not isinstance(n, int):
        return ""
    linhas = [{"nome": r.get("nome") or "", "n": r["avaliacoes"]} for r in conc["outros"]
              if isinstance(r.get("avaliacoes"), int)]
    if not linhas:
        return ""
    linhas = sorted(linhas + [{"nome": f"{nome} (vocês)", "n": n, "voces": True}], key=lambda r: -r["n"])
    maior = max(r["n"] for r in linhas) or 1
    marca_voces = ' class="voces"'
    itens = "".join(
        f'<li{marca_voces if r.get("voces") else ""}><span class="quem">{e(r["nome"])}</span>'
        f'<span class="conta">{e(r["n"])}</span><span class="barra" aria-hidden="true">'
        f'<span style="width:{max(1, round(100 * r["n"] / maior))}%"></span></span></li>' for r in linhas)
    return (f'<div class="placar-busca"><div class="dentro"><div><h2>Avaliações no Google: vocês e quem aparece '
            f'primeiro em “{e(conc["consulta"])}”</h2><p class="intro">Busca feita em {e(conc["lido_em"])}. '
            'Quem compara olha a nota e quantas pessoas já foram atendidas.</p></div>'
            f'<ol class="barras">{itens}</ol></div></div>')


def secao_busca(diag: dict, nome: str, e) -> str:
    """O corpo do detalhe "Quem aparece antes de vocês na busca"; '' sem a busca do Places."""
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
    return (f'<p class="intro">Procuramos “{e(conc["consulta"])}” no Google em {e(conc["lido_em"])}. Dos {m} primeiros '
            f'que não são vocês, {e(k)} mostra{"m" if k != 1 else ""} site próprio no perfil.</p>'
            f'<ol class="busca">{"".join(linhas)}</ol>{fora}')


def secao_avaliacoes(diag: dict, e) -> str:
    """O corpo do detalhe "O que os clientes dizem"; '' sem avaliações lidas."""
    av = diag.get("avaliacoes_lidas")
    if not av or not av["total"]:
        return ""
    total = av["total"]
    partes = [f'<p class="intro">Lemos as {total} avaliações que o Google '
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
    return "".join(partes)


def secao_metodo(diag: dict, e) -> str:
    """A lista de onde vem cada dado, no detalhe "Como fizemos este Raio-X" (depois da Nota de presença)."""
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
    if (diag.get("presenca") or {}).get("nota") is not None:
        itens.append("A Nota de presença: seis pontos de 0 a 3 pelo cálculo PRUMO, com as mesmas regras para todas as "
                     "empresas. O que não medimos fica fora da conta, nunca vira zero.")
    itens.append("Não conferimos se vocês respondem às avaliações (o Google não entrega isso a sistemas de fora) "
                 "nem quanto tempo levam para responder uma mensagem.")
    return '<ul class="metodo">' + "".join(f"<li>{i}</li>" for i in itens) + "</ul>"


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
# 14/10/2026: "Consultoria" também. Uma advogada trabalhista de Ribeirão Preto com essa categoria
# no perfil foi comparada com consultorias bancárias e de RH ("consultoria em Ribeirão Preto"),
# e o ponto "fora dos 20 primeiros" saiu de uma busca que cliente dela não faz.
TIPOS_GENERICOS = {"serviços", "serviço", "empresa", "estabelecimento", "loja", "ponto de interesse", "escritório",
                   "prestador de serviços", "escritório corporativo", "comércio", "consultoria", "consultor"}


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
    conferido = (conferir_site_completo(site["url"], dados["nome"]) if site and site["tipo"] in ("morto", "proprio")
                 else None)
    fotos = sum(1 for f in (pasta / "Fotos").glob("*") if f.is_file()) if (pasta / "Fotos").is_dir() else 0
    try:
        demo = ler_demo((pasta / "index.html").read_text(encoding="utf-8", errors="replace"))
    except OSError:
        demo = None
    return diagnostico(dados, conferido["estado"] if conferido else None, dt.date.today().strftime("%d/%m/%Y"), fotos,
                       places, demo, conferido)


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
    pr = d.get("presenca")
    if pr:
        nota = "sem nota" if pr["nota"] is None else f"{numero(pr['nota'])}/18 ({pr['faixa']['rotulo']})"
        linhas.append(f"  nota de presença: {nota}, {pr['medidos']} de 6 medidos: "
                      + ", ".join(f"{b['chave']} {b['nota'] if b['medido'] else '-'}" for b in pr["blocos"]))
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
    if calculo_prumo is None:
        log("calculo_prumo.py não encontrado (nem em prumo-mapa/ ao lado nem em ~/.local/share/prumo-mapa/): "
            "o Raio-X sai sem a Nota de presença. Instale: dell-status --instalados.")
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

        def test_empresa_sem_nome_de_pessoa_e_so_o_preco_do_encontrado(self):
            dados = ler_content(CONTENT_EXEMPLO)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5), "https://demo-x.vercel.app", True)
            self.assertNotIn("Rômulo", h)
            # O preço do Respondido só se fala na conversa (08 e 09/10/2026).
            self.assertNotIn("2.400", h)
            self.assertNotIn("390/mês", h)
            self.assertNotIn("Respondido e Acompanhado", h)
            self.assertNotIn("é só responder a mensagem", h)
            self.assertIn("Não conferimos se vocês respondem às avaliações", h)
            # Sem Places: nada de concorrência nem de avaliações (detalhe ausente, não vazio).
            self.assertNotIn("Quem aparece antes de vocês na busca", h)
            self.assertNotIn("O que os clientes dizem", h)
            self.assertNotIn("O caminho do cliente", h)

    class Profundo(unittest.TestCase):
        """Versão 2: Places, avaliações, demo e checklist (tudo PURO)."""

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
            self.assertEqual(consulta_da_busca("Consultoria", "advocacia", "Ribeirão Preto"), "advocacia em Ribeirão Preto")
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

        def test_pagina_completa_escapa_e_so_linka_https(self):
            dados = ler_content(CONTENT_EXEMPLO)
            diag = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7), ler_demo(DEMO_EXEMPLO))
            h = pagina(dados, diag, "https://demo-x.vercel.app", True)
            self.assertIn("<summary>Quem aparece antes de vocês na busca</summary>", h)
            self.assertIn("Procuramos “advogado em Anápolis” no Google em 08/10/2026", h)
            self.assertIn("Vocês aparecem em 7º lugar nesta busca.", h)
            self.assertIn("Beta &lt;script&gt;x&lt;/script&gt;", h)
            self.assertNotIn("<script>x</script>", h)
            self.assertEqual(h.count("<script>"), 2)  # a calculadora da Nota de presença e a barra/medição
            self.assertIn('href="https://www.google.com/maps/contrib/1"', h)
            self.assertNotIn("javascript:", h)
            self.assertIn("O que os clientes dizem", h)
            self.assertIn("3 de 5", h)
            self.assertIn("3 pontos que mandam cliente para o concorrente", h)
            self.assertIn("lida em 08/10/2026", h)
            self.assertNotRegex(h.lower(), r"#(00f|0000ff|1e90ff|2563eb)|blue|border-radius:\s*[1-9]")
            # Com o lead entre os 5 primeiros, ele entra na lista, marcado.
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(2)), "https://demo-x.vercel.app", True)
            self.assertIn('<li class="voces"><span class="pos">2º</span>', h)
            self.assertIn("site fora do ar", h)

    class Presenca(unittest.TestCase):
        """Versão 3: a Nota de presença a partir do diagnóstico. Os limiares de cada bloco são
        testados no calculo_prumo.test.py; aqui, o que o Raio-X entrega ao módulo e mostra."""

        def test_modulo_achado_no_repo(self):
            self.assertIsNotNone(calculo_prumo, "prumo-mapa/calculo_prumo.py ao lado deste arquivo")
            self.assertEqual(VERSAO, 5)

        def test_nota_com_places_bloco_a_bloco(self):
            d = diagnostico(ler_content(CONTENT_EXEMPLO), "fora", "08/10/2026", 5, places_exemplo(7))
            p = d["presenca"]
            self.assertEqual({b["chave"]: b["nota"] for b in p["blocos"]},
                             {"busca": 2, "nota": 3, "avaliacoes": 1, "respostas": None, "perfil": 3, "site": 0})
            self.assertEqual((p["soma"], p["medidos"], p["nota"], p["faixa"]["chave"]), (9, 5, 10.8, "media"))
            self.assertEqual(p["cenarios"][0], "Se o botão “Site” levasse a um site de vocês, que abre no celular "
                                               "e tem botão de WhatsApp")
            self.assertIn("Se as avaliações chegassem à mediana dos concorrentes (de 18 para 60)", p["cenarios"])
            self.assertIn("Não medimos", p["blocos"][3]["linha"])

        def test_site_no_ar_le_celular_e_whatsapp(self):
            dados = ler_content(CONTENT_EXEMPLO)
            pag = {"estado": "no_ar", "celular": True, "whatsapp": False}
            site = diagnostico(dados, "no_ar", "08/10/2026", 5, places_exemplo(2), site_pagina=pag)["presenca"]["blocos"][5]
            self.assertEqual((site["nota"], site["linha"]), (2, "O site de vocês abre, mas não tem botão de WhatsApp."))
            # O que não abriu não tem celular nem WhatsApp para ler.
            self.assertIsNone(diagnostico(dados, "fora", "", 5, places_exemplo(2), site_pagina=pag)["site_pagina"])

        def test_sem_places_nao_ha_nota_e_a_pagina_nao_mostra(self):
            dados = ler_content(CONTENT_EXEMPLO)
            d = diagnostico(dados, "fora", "08/10/2026", 5)
            p = d["presenca"]
            self.assertEqual([b["chave"] for b in p["blocos"] if not b["medido"]], ["busca", "avaliacoes", "respostas"])
            self.assertIsNone(p["nota"])
            h = pagina(dados, d, "https://demo-x.vercel.app", True)
            self.assertNotIn("Nota de presença", h)
            self.assertNotIn('class="faixa-presenca', h)
            self.assertNotIn('id="prumo-valor"', h)
            self.assertEqual(h.count("<script>"), 1)  # só a barra/medição

        def test_item_nao_conferido_nunca_vira_falta(self):
            dados = ler_content(CONTENT_EXEMPLO.split("## Por que este lead")[0])  # sem horário nem fotos conferidos
            p = places_exemplo(7)
            p["detalhes"]["tipo"] = "Serviços"  # genérico: pode ser só a tabela do Places
            p["detalhes"]["horario"] = None
            perfil = entradas_da_presenca(diagnostico(dados, "fora", "", 0, p))["perfil"]
            self.assertEqual(perfil, {"horario": "falta", "fotos": None, "categoria": None, "telefone": "ok",
                                      "site": "ok"})
            dados = ler_content(CONTENT_EXEMPLO.split("## Por que este lead")[0].replace("advocacia", "pousada"))
            self.assertIsNone(entradas_da_presenca(diagnostico(dados, "fora", "", 0, p))["perfil"]["horario"])

        def test_pagina_com_a_nota_e_a_calculadora(self):
            dados = ler_content(CONTENT_EXEMPLO)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7)), "https://demo-x.vercel.app", True)
            self.assertIn('<div class="presenca"><h3>Nota de presença</h3>', h)
            self.assertIn("10,8 <small>de 18</small>", h)
            self.assertIn("não medimos", h)
            self.assertIn('<label for="prumo-valor">', h)
            self.assertIn('inputmode="decimal"', h)
            self.assertIn("1 cliente a mais por mês × R$ ___ = R$ ___ por mês", h)
            # Na frente, só a faixa ("Em construção") e a frase dela; o "X de 18" fica em "Como fizemos".
            ato1 = h[h.index('data-ato="veredito"'):h.index('data-ato="por-que"')]
            self.assertIn('<p class="faixa-rotulo">Em construção</p>', ato1)
            self.assertIn("Vocês aparecem, mas quem compara ainda vê lacunas", ato1)
            self.assertIn('class="prumo-fio"', ato1)
            self.assertNotIn("de 18", ato1)
            self.assertNotIn("10,8", ato1)
            como = h[h.index("<summary>Como fizemos este Raio-X</summary>"):]
            self.assertIn("10,8 <small>de 18</small>", como)
            self.assertLess(como.index("Nota de presença"), como.index("A Nota de presença: seis pontos de 0 a 3"))
            self.assertLess(h.index("pontos que mandam cliente"), h.index("<summary>Quem aparece antes"))
            self.assertLess(h.index("<summary>Quem aparece antes"), h.index('<div class="presenca">'))
            self.assertNotIn("sem custo", h)
            self.assertNotRegex(h.lower(), r"#(00f|0000ff|1e90ff|2563eb)|blue|border-radius:\s*[1-9]")

        def test_ler_pagina_do_site(self):
            v = '<meta name="viewport" content="width=device-width, initial-scale=1">'
            self.assertEqual(ler_pagina_do_site(v + '<a href="https://wa.me/5511999">Zap</a>'),
                             {"celular": True, "whatsapp": True})
            self.assertEqual(ler_pagina_do_site("<meta content='width=device-width' name='viewport'>"
                                                "<a href='https://api.whatsapp.com/send?phone=1'>"),
                             {"celular": True, "whatsapp": True})
            self.assertEqual(ler_pagina_do_site("<html><p>contato</p>"), {"celular": False, "whatsapp": False})
            self.assertEqual(ler_pagina_do_site(v + '<script src="/whatsapp-widget.js"></script>'),
                             {"celular": True, "whatsapp": None})  # widget por script: não se afirma falta
            self.assertEqual(ler_pagina_do_site('<meta name="viewport" content="width=1024">'),
                             {"celular": False, "whatsapp": False})

        def test_conferir_site_completo_le_a_pagina_uma_vez(self):
            antes = globals()["baixar"]
            chamadas = []
            pagina_ = (b'<meta name="viewport" content="width=device-width"><h1>Higor Ferreira Advocacia</h1>'
                       b'<a href="https://wa.me/55">Zap</a>')
            try:
                for resposta, esperado in (((200, pagina_), {"estado": "no_ar", "celular": True, "whatsapp": True}),
                                           ((200, b"<title>dominio a venda</title>"),
                                            {"estado": "sem_nome", "celular": None, "whatsapp": None}),
                                           ((404, b""), {"estado": "fora", "celular": None, "whatsapp": None})):
                    globals()["baixar"] = lambda url, timeout=30, navegador=False, r=resposta: chamadas.append(url) or r
                    self.assertEqual(conferir_site_completo("https://higorferreira.adv.br/", "Higor Ferreira - Advogado"),
                                     esperado)
                self.assertEqual(len(chamadas), 3)
            finally:
                globals()["baixar"] = antes

    class TresAtos(unittest.TestCase):
        """Versão 4: veredito, por quê e o que fazer; o WhatsApp do PRUMO; sem o preço do Respondido."""

        def setUp(self):
            dados = ler_content(CONTENT_EXEMPLO.replace("# Higor Ferreira - Advogado", "# Bar & Cia <Ltda>"))
            self.diag = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7), ler_demo(DEMO_EXEMPLO))
            self.dados = dados
            self.h = pagina(dados, self.diag, "https://demo-x.vercel.app", True)

        def test_os_tres_atos_na_ordem(self):
            h = self.h
            atos = [h.index(f'data-ato="{a}"') for a in ("veredito", "por-que", "o-que-fazer")]
            self.assertEqual(atos, sorted(atos))
            self.assertEqual(h.count("data-ato="), 3)
            ato1, ato2, ato3 = h[atos[0]:atos[1]], h[atos[1]:atos[2]], h[atos[2]:]
            # Ato 1: nome, nota do Google, a faixa e as duas linhas do resumo.
            for trecho in ("Como vocês aparecem no Google", "Bar &amp; Cia &lt;Ltda&gt;", 'class="nota"',
                           "faixa-presenca", "O que segura cliente", "O que perde cliente"):
                self.assertIn(trecho, ato1)
            # Ato 2: os pontos abertos, antes de qualquer detalhe.
            self.assertIn("3 pontos que mandam cliente para o concorrente", ato2)
            self.assertLess(ato2.index("pontos que mandam"), ato2.index("<details"))
            # Ato 3: demonstração, Encontrado com preço e os botões.
            for trecho in ("Ver a demonstração", "Encontrado", PRECO, "Vocês só pagam depois de ver funcionando",
                           "Quero o site no ar", "Quero conversar sobre o WhatsApp que responde"):
                self.assertIn(trecho, ato3)
            self.assertLess(ato3.index("Ver a demonstração"), ato3.index("Quero o site no ar"))

        def test_versao_5_desktop_placa_placar_e_fecho(self):
            h = self.h
            atos = [h.index(f'data-ato="{a}"') for a in ("veredito", "por-que", "o-que-fazer")]
            ato1, ato2, ato3 = h[atos[0]:atos[1]], h[atos[1]:atos[2]], h[atos[2]:]
            # Ato 1: a nota dentro do campo de brasa, a demonstração ao lado (só desktop, pelo CSS).
            self.assertLess(ato1.index('<div class="campo">'), ato1.index('class="nota"'))
            self.assertIn('<a class="vitrine" href="/" data-evento="raiox-demo"', ato1)
            # Ato 2: as avaliações da busca em barras, vocês marcados, antes dos detalhes.
            self.assertIn('<div class="placar-busca">', ato2)
            self.assertIn('<li class="voces"><span class="quem">Bar &amp; Cia &lt;Ltda&gt; (vocês)</span>', ato2)
            self.assertLess(ato2.index("placar-busca"), ato2.index("<details"))
            # Ato 3: demonstração e oferta lado a lado.
            self.assertLess(ato3.index('<div class="fecho">'), ato3.index('<div class="demo">'))
            # Sem a busca do Places, a faixa não aparece; sem og.jpg, a vitrine não aparece.
            dados = ler_content(CONTENT_EXEMPLO)
            h2 = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5), "https://demo-x.vercel.app", False)
            self.assertNotIn('<div class="placar-busca">', h2)
            self.assertNotIn('class="vitrine"', h2)

        def test_detalhes_sao_details_fechados_na_ordem(self):
            h = self.h
            titulos = re.findall(r"<details class=\"detalhe[^\"]*\"><summary>([^<]+)</summary>", h)
            self.assertEqual(titulos, ["O que já está bom", "Quem aparece antes de vocês na busca", "O que os clientes dizem",
                                       "O perfil no Google, item por item", "Como fizemos este Raio-X"])
            self.assertEqual(h.count("<details"), 5)
            self.assertEqual(h.count("</details>"), 5)
            self.assertNotIn("<details open", h)  # fechados por padrão
            self.assertNotIn("<section><h2>O que já está bom", h)

        def test_secao_ausente_e_detalhe_ausente(self):
            dados = ler_content(CONTENT_EXEMPLO)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5), "https://demo-x.vercel.app", True)
            titulos = re.findall(r"<summary>([^<]+)</summary>", h)
            self.assertEqual(titulos, ["O que já está bom", "O perfil no Google, item por item", "Como fizemos este Raio-X"])
            self.assertNotIn("<summary></summary>", h)

        def test_botao_do_whatsapp_com_o_numero_novo_e_o_nome_na_mensagem(self):
            h = self.h
            texto = "Olá, PRUMO. Vi o Raio-X da Bar & Cia <Ltda> e quero o site no ar."
            esperado = "https://wa.me/5527999762786?text=" + urllib.parse.quote(texto, safe="")
            self.assertIn(f'href="{html.escape(esperado)}"', h)
            self.assertNotIn("<Ltda>", h)  # o nome vai codificado no link e escapado no texto
            self.assertEqual(h.count(html.escape(esperado)), 2)  # o botão do Ato 3 e a barra do celular
            m = re.search(r'<a class="botao-zap" href="([^"]+)" target="_blank" rel="noopener" '
                          r'data-evento="raiox-whatsapp-site">Quero o site no ar</a>', h)
            self.assertTrue(m)
            self.assertEqual(urllib.parse.unquote(html.unescape(m.group(1)).split("?text=")[1]), texto)
            resp = "Olá, PRUMO. Vi o Raio-X da Bar & Cia <Ltda> e quero conversar sobre o WhatsApp que responde."
            self.assertIn(html.escape("https://wa.me/5527999762786?text=" + urllib.parse.quote(resp, safe="")), h)
            self.assertIn('data-evento="raiox-whatsapp-respondido"', h)
            for velho in ("5527997780954", "27997780954", "99778-0954", "997780954"):
                self.assertNotIn(velho, h)

        def test_sem_preco_do_respondido_nem_caminho_do_cliente(self):
            h = self.h
            self.assertNotIn("2.400", h)
            self.assertNotIn("390/mês", h)
            self.assertNotIn("O caminho do cliente", h)
            self.assertNotIn("O próximo passo", h)
            self.assertNotIn('class="escura"', h)
            self.assertNotIn("PRECO_RESPONDIDO", globals())

        def test_barra_fixa_e_medicao_desligada_sem_cookie(self):
            h = self.h
            self.assertIn('<div class="barra-fixa">', h)
            self.assertLess(h.index("</main>"), h.index('<div class="barra-fixa">'))
            self.assertIn(".barra-fixa{display:none}", h)  # sem JS a barra não aparece
            self.assertIn("html.com-js body{padding-bottom:88px}", h)  # não cobre o fim da página
            self.assertIn("@media (max-width:719.98px)", h)
            js = JS_PAGINA
            self.assertIn("const URL_EVENTOS = '';", js)
            self.assertIn("if(!URL_EVENTOS||!navigator.sendBeacon)return;", js)
            for ev in ("raiox-aberto", "raiox-o-que-fazer"):
                self.assertIn(f"'{ev}'", js)
            for ev in ("raiox-demo", "raiox-whatsapp-site", "raiox-whatsapp-respondido"):
                self.assertIn(f'data-evento="{ev}"', h)
            self.assertIn("IntersectionObserver", js)
            self.assertIn("{e:e,p:location.pathname,t:Date.now()}", js)
            codigo = re.sub(r"//[^\n]*", "", js)  # o comentário diz o que não se faz; o código não faz
            for proibido in ("cookie", "localStorage", "sessionStorage", "indexedDB"):
                self.assertNotIn(proibido, codigo)

        def test_movimento_so_transform_opacity_e_nada_com_reduced_motion(self):
            css = CSS
            self.assertIn("animation:detalhe-abre .22s", css)
            self.assertIn("from{opacity:0;transform:translateY(-6px)}", css)
            self.assertIn("transition:transform .32s", css)
            # Toda animação e transição moram dentro de um prefers-reduced-motion:no-preference.
            sem_movimento = re.sub(r"@media \([^{]*prefers-reduced-motion:no-preference\)\{(?:[^{}]|\{(?:[^{}]|\{[^{}]*\})*\})*\}",
                                   "", css)
            self.assertNotIn("animation", sem_movimento)
            self.assertNotIn("transition", sem_movimento)

        def test_alvos_de_toque(self):
            self.assertIn(".detalhe > summary{list-style:none;cursor:pointer;min-height:56px", CSS)
            self.assertIn("min-height:56px", CSS[CSS.index(".botao-zap{"):])
            self.assertIn("min-height:44px", CSS[CSS.index(".link-zap{"):])

        def test_html_balanceado(self):
            from html.parser import HTMLParser
            vazias = {"meta", "link", "img", "br", "input", "hr", "source"}

            class Contador(HTMLParser):
                def __init__(self):
                    super().__init__()
                    self.pilha, self.erros = [], []

                def handle_starttag(self, tag, attrs):
                    if tag not in vazias:
                        self.pilha.append(tag)

                def handle_endtag(self, tag):
                    if not self.pilha or self.pilha[-1] != tag:
                        self.erros.append((tag, list(self.pilha[-3:])))
                    else:
                        self.pilha.pop()

            for diag in (self.diag, diagnostico(self.dados, "fora", "08/10/2026", 5)):
                c = Contador()
                c.feed(pagina(self.dados, diag, "https://demo-x.vercel.app", True))
                self.assertEqual((c.erros, c.pilha), ([], []))

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
    for c in (Leitura, Diagnostico, Pagina, Profundo, Presenca, TresAtos, Places, Publicar):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(c))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
