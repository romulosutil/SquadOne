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

Versão 5 (14/10/2026): o Raio-X aprovado do piloto CDL (prumo, `04-venda/piloto-cdl/gerar.py`, no ar em
prumo-piloto-cdl.vercel.app/raio-x). Este arquivo junta os dados; o desenho e a trava de qualidade são os do
piloto, em `prumo-mapa/modelo_raio_x.py`, que recebe o JSON do esquema do piloto (`dados_do_modelo`). Três
buscas (`consultas_das_buscas`), a comparação com os 3 primeiros, 3 pontos, 3 coisas boas e "3 coisas, nesta
ordem" com quem faz; redes e anúncios marcados "não conferido" (o Dell não os abre). Desde 15/10/2026 todo
Raio-X daqui termina no convite para o Mapa (a variante "com equipe" do molde, `MAPA_LINK`), com os quatro
serviços sem preço: o Raio-X precisa dizer que o Mapa existe (pedido do Rômulo). Abaixo do padrão do piloto
(AbaixoDoPadrao), não há página.

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

Avulso (demo sob pedido, 14/10/2026): com `~/auto-site/.demo-sob-pedido`, o lead novo do Brasil
não ganha demo antes do contato (de ~230 demos, 7 viraram conversa). O Raio-X sai sozinho, em
`raio-x-prumo.vercel.app/<nome>` (projeto `prumo-raio-x`, o mesmo dos Raio-X feitos à mão, pasta
`~/prumo-entregas/prumo-raio-x` com `cleanUrls`; cada deploy sobe a pasta inteira, então nenhuma
página já enviada sai do ar). O recibo nasce: `publicado.json` SEM `site_url` (= ainda sem demo),
com `place_id`, `raio_x_*` e `raio_x_projeto: "prumo-raio-x"`, e é ele que leva o lead ao Balcão.
A página oferece a demonstração em vez de apontar para ela; quando o demo sai (botão "Gerar demo",
gerador-de-sites --pedidos), o gerador chama o raio-x de novo e a página passa a citar o endereço
do demo. Recibo com `raio_x_projeto` avulso nunca vira `/raio-x` dentro do demo.

Uso: raio-x SLUG...               gera e publica o Raio-X destes leads (pasta na raiz, ou `_em-conversa/SLUG`)
     raio-x --pendentes [--max N] leads `pronto` na raiz sem Raio-X atual ou com ele fora do ar (sob pedido,
                                  também os novos sem recibo)
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
# Desde a versão 5, da mesma pasta vêm também o molde da página (modelo_raio_x.py, o do piloto CDL) e os
# preços (precos.json, os mesmos do piloto). Sem os três, não há Raio-X (o main avisa no log).
PASTA_PRUMO = None
for _pasta in (Path(__file__).resolve().parent / "prumo-mapa",
               Path(os.environ.get("RAIO_X_CALCULO", str(Path.home() / ".local/share/prumo-mapa")))):
    if (_pasta / "calculo_prumo.py").is_file():
        sys.path.insert(0, str(_pasta))
        PASTA_PRUMO = _pasta
        break
try:
    import calculo_prumo
except ImportError:
    calculo_prumo = None
try:
    import modelo_raio_x
except ImportError:
    modelo_raio_x = None
try:
    PRECOS = json.loads((PASTA_PRUMO / "precos.json").read_text(encoding="utf-8")) if PASTA_PRUMO else None
except (OSError, ValueError):
    PRECOS = None
# O exemplo do piloto (raio-x-odonto-mare.json): a página dele, com o convite do Mapa, é o esqueleto que toda
# página daqui tem de ter (os mesmos blocos, na mesma ordem; conferir_esqueleto do piloto).
try:
    EXEMPLO = json.loads((PASTA_PRUMO / "exemplo-raio-x.json").read_text(encoding="utf-8")) if PASTA_PRUMO else None
except (OSError, ValueError):
    EXEMPLO = None

# Todo Raio-X convida para o Mapa (15/10/2026): o formulário das 16 perguntas é o do exemplo, e o Mapa de
# exemplo vai com o endereço completo (num lead, o modelo recusa o "/mapa" relativo).
MAPA_LINK = (EXEMPLO or {}).get("mapa_link") or ""
MAPA_EXEMPLO_URL = "https://prumo-piloto-cdl.vercel.app/mapa"

AUTO = Path(os.environ.get("AUTO_DIR", str(Path.home() / "auto-site")))
LOGS = AUTO / ".logs"
SITE_LEADS = Path(os.environ.get("SITE_LEADS", str(Path.home() / ".local/share/n8n-estado/site-leads.json")))
FONTE = Path(os.environ.get("RAIO_X_FONTE", str(Path.home() / ".local/share/prumo-mapa/archivo.woff2")))
VERCEL_SCOPE = os.environ.get("VERCEL_SCOPE", "romulodesigns")
# Avulso (demo sob pedido, 14/10/2026; ver a docstring).
SOB_PEDIDO = ".demo-sob-pedido"  # na raiz de AUTO (lido na hora: o teste troca o AUTO)
AVULSO_PASTA = Path(os.environ.get("RAIO_X_AVULSO_PASTA", str(Path.home() / "prumo-entregas/prumo-raio-x")))
AVULSO_URL = os.environ.get("RAIO_X_AVULSO_URL", "https://raio-x-prumo.vercel.app").rstrip("/")
AVULSO_PROJETO = "prumo-raio-x"
TRAVA_AVULSO = "raio-x-avulso.lock"  # em LOGS; dois deploys da mesma pasta ao mesmo tempo: o segundo apagaria a página do primeiro
TAMANHO_DO_NOME = 60  # o endereço vai na mensagem: o slug do Caçador passa de 100 letras
FUNIL = Path(os.environ.get("SITE_FUNIL", str(Path.home() / ".local/share/n8n-estado/site-funil.json")))
# Lead novo abaixo do padrão do modelo (sem 3 pontos...): não é abordado, e a pasta ganha este arquivo com o
# motivo para o --pendentes não refazer a conta toda rodada (vale o mesmo prazo do cache do Places).
SEM_PADRAO = "raio-x-sem-padrao.json"
# Sobe quando o texto ou as regras mudam: `--pendentes` refaz quem está `pronto` com versão menor.
# 2 (08/10/2026): concorrência da mesma busca, o que as avaliações dizem, o perfil item por item,
# o caminho do cliente ligado às seções do demo e os dois serviços com preço.
# 3 (09/10/2026): a Nota de presença (cálculo PRUMO, seis blocos de 0 a 3) e a conta aberta em R$.
# 4 (09/10/2026): três atos (veredito, por quê, o que fazer), o botão do WhatsApp do PRUMO e sem o
# preço do Respondido; sai o caminho do cliente.
# 5 (14/10/2026): o modelo aprovado do piloto CDL (modelo_raio_x.py): três buscas, a comparação com os
# 3 primeiros, "3 coisas, nesta ordem" com quem faz, redes e anúncios (marcados "não conferido") e os
# quatro serviços com preço. Abaixo do padrão do piloto (3 pontos, 3 bons, 3 avaliações...), não sai.
VERSAO = 5
CAMINHO = "raio-x"
MARCA = f'data-raio-x="{VERSAO}"'
MAX_PONTOS = 3  # o modelo pede exatamente 3 pontos, 3 coisas que estão boas e 3 coisas a fazer
MAX_BONS = 3
LIMITE_DE_DEPLOY = re.compile(r"(?i)api-deployments-free-per-day|Resource is limited|too many deployments"
                              r"|maximum number of projects")
# O WhatsApp do PRUMO (chip novo de 09/10/2026), o destino dos botões do fim da página (o mesmo do precos.json).
WHATSAPP_PRUMO = "5527999762786"

# Google Places (New), opcional: sem a chave o Raio-X sai só com o content.md, como na versão 1.
# A chave fica num arquivo (600) fora do repositório, linha PLACES_API_KEY= (ou GOOGLE_MAPS_API_KEY=);
# nunca vai a log, recibo, cache nem página (vai só no header X-Goog-Api-Key).
PLACES_ENV = Path(os.environ.get("RAIO_X_CHAVE", str(Path.home() / ".config/prumo/places.env")))
PLACES_URL = "https://places.googleapis.com/v1"
# Detalhes: Place Details Enterprise + Atmosphere (as avaliações puxam o SKU mais caro).
CAMPOS_DETALHES = ("id,displayName,rating,userRatingCount,reviews,regularOpeningHours,websiteUri,businessStatus,"
                   "primaryTypeDisplayName,googleMapsUri,addressComponents")
# Concorrência: Text Search Enterprise (nota, avaliações, site e se mostram horário; sem avaliações dos outros).
# Três buscas por lead desde a versão 5 (consultas_das_buscas).
CAMPOS_BUSCA = ("places.id,places.displayName,places.rating,places.userRatingCount,places.websiteUri,"
                "places.businessStatus,places.regularOpeningHours")
CACHE_PLACES = "raio-x-places.json"
VERSAO_CACHE = 2  # 1 = uma busca ("busca"); 2 = três ("buscas"), com o horário dos concorrentes
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
    """A primeira busca (a do termo do ramo): {'consulta', 'lido_em', 'posicao' (1.. ou None), 'lidos',
    'outros' (os CONCORRENTES primeiros que não são o lead nem fecharam), 'com_site', 'mediana_avaliacoes'}."""
    todas = buscas_lidas(places, place_id)
    return todas[0] if todas else None


def buscas_lidas(places: dict | None, place_id: str) -> list[dict]:
    """As buscas do cache, cada uma como `concorrencia` (o cache da versão 1 tem uma só, em "busca")."""
    p = places or {}
    brutas = p.get("buscas") if isinstance(p.get("buscas"), list) else [p.get("busca")]
    saida = []
    for busca in brutas:
        busca = busca if isinstance(busca, dict) else {}
        resultados = [r for r in busca.get("resultados") or [] if isinstance(r, dict)]
        if not busca.get("consulta") or not resultados:
            continue
        posicao = next((i for i, r in enumerate(resultados, 1) if r.get("id") == place_id), None)
        outros = [dict(r, pos=i) for i, r in enumerate(resultados, 1) if r.get("id") != place_id
                  and r.get("status") in (None, "", "OPERATIONAL")][:CONCORRENTES]
        if not outros:
            continue
        saida.append({"consulta": busca["consulta"], "lido_em": data_br(p.get("lido_em", "")), "posicao": posicao,
                      "lidos": len(resultados), "outros": outros,
                      "com_site": sum(1 for r in outros if tipo_de_link(r.get("site", "")) == "proprio"),
                      "mediana_avaliacoes": mediana([r["avaliacoes"] for r in outros
                                                     if isinstance(r.get("avaliacoes"), int)])})
    return saida


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

    buscas = buscas_lidas(places, c.get("place_id", "")) if places else []
    conc = buscas[0] if buscas else None
    avals = temas_das_avaliacoes((detalhes or {}).get("textos") or []) if detalhes else None
    site = situacao_do_site(dados, detalhes)
    top3 = conc["outros"][:3] if conc else []
    med = conc["mediana_avaliacoes"] if conc else None
    sem_horario_comum = any(r in sem_acento(vertical).lower() for r in SEM_HORARIO_COMUM)
    quando = f" quando conferimos ({hoje})" if hoje else " quando conferimos"

    # Os pontos que mandam cliente para o concorrente, na ordem de peso do modelo aprovado (a busca, o
    # site, a nota, as avaliações, o perfil). Cada um com um número que o dono confere e a ação que o
    # resolve (vira "3 coisas, nesta ordem"). Só existe o que está no content.md ou no Places.
    pontos: list[dict] = []
    fora_do_topo = [b for b in buscas if b["posicao"] is None or b["posicao"] > 3]
    if fora_do_topo:
        b = fora_do_topo[0]
        frase = (f"Quem procura “{b['consulta']}” no Google vê {b['posicao'] - 1} "
                 f"{'outro resultado' if b['posicao'] == 2 else 'outros resultados'} antes de vocês."
                 if b["posicao"] else
                 f"Quem procura “{b['consulta']}” no Google não acha vocês entre os {b['lidos']} primeiros resultados.")
        resto = [x for x in buscas if x is not b]
        if resto and not b["posicao"] and all(not x["posicao"] and x["lidos"] == b["lidos"] for x in resto):
            consultas = [f"“{x['consulta']}”" for x in resto]
            frase += f" Em {juntar(consultas)}, também não."
        elif resto:
            outras = "; ".join(f"em “{x['consulta']}”, " + (f"vocês estão em {x['posicao']}º" if x["posicao"]
                                                             else f"não estão entre os {x['lidos']} primeiros")
                               for x in resto)
            frase += " " + outras[0].upper() + outras[1:] + "."
        pontos.append({"chave": "busca", "consulta": b["consulta"],
                       "titulo": (f"{b['posicao']}º lugar em “{b['consulta']}”" if b["posicao"]
                                  else f"Fora dos {b['lidos']} primeiros em “{b['consulta']}”"),
                       "porque": frase + " O Google ordena a busca local por relevância, distância e destaque, e o "
                                         "destaque leva em conta o que existe sobre o negócio na internet, como site e "
                                         "avaliações."})
    # Na mesma busca, quantos dos 3 primeiros mostram site próprio: o fato que dá peso ao ponto do site.
    vizinhos = ""
    if top3:
        k = sum(1 for r in top3 if tipo_de_link(r.get("site", "")) == "proprio")
        vizinhos = (f" Na busca “{conc['consulta']}”, {'os 3' if k == 3 else f'{k} dos 3'} primeiros mostra"
                    f"{'m' if k > 1 else ''} site próprio no perfil." if k
                    else f" Na busca “{conc['consulta']}”, nenhum dos 3 primeiros mostra site próprio: quem tiver um "
                         "sai na frente.")
    if site and site["tipo"] in ("morto", "proprio") and site_hoje == "fora":
        pontos.append({"chave": "site", "titulo": "O site que aparece no Google não abre",
                       "porque": f"Quem toca em “Site” no perfil de vocês vai para {dominio(site['url'])}, que não abriu"
                                 f"{quando}. A pessoa volta para a busca, e o próximo resultado está a um toque." + vizinhos})
    elif site and site["tipo"] in ("morto", "proprio") and site_hoje == "sem_nome":
        pontos.append({"chave": "site", "titulo": "O site do Google não leva a um site de vocês",
                       "porque": f"Quem toca em “Site” no perfil de vocês vai para {dominio(site['url'])}, que abria uma "
                                 f"página sem o nome de vocês{quando}. A pessoa volta para a busca, e o próximo "
                                 "resultado está a um toque." + vizinhos})
    elif site and site["tipo"] == "rede":
        rede = nome_da_rede(site["url"])
        porque = ("Quem ainda está comparando quer ver o trabalho antes de chamar. Sem uma página com os serviços e as "
                  "fotos, só chama quem já decidiu, e quem está em dúvida vai para quem mostra.")
        if rede in ("o Instagram", "o Facebook", "o TikTok"):
            porque = ("Quem está comparando quer ver os serviços, as fotos e como chamar numa página só. Na rede social "
                      "isso fica espalhado entre posts, e muita gente desiste ali.")
        pontos.append({"chave": "site", "titulo": f"O botão “Site” no Google leva para {rede}", "porque": porque + vizinhos})
    elif site and site["tipo"] == "nenhum":
        onde = f"{vertical} em {cidade}" if vertical and cidade else (f"em {cidade}" if cidade else "o serviço de vocês")
        pontos.append({"chave": "site", "titulo": "O perfil do Google não tem site",
                       "porque": f"Quem procura {onde} compara duas ou três opções. Sem site, vocês aparecem só com "
                                 "nome e nota, e quem mostra serviços e fotos leva o cliente." + vizinhos})
    notas3 = [r["nota"] for r in top3 if isinstance(r.get("nota"), (int, float))]
    if nota is not None and nota < 4.3:
        pontos.append({"chave": "nota", "titulo": f"Nota {numero(nota)} no Google",
                       "porque": "Na lista do Google a nota é a primeira coisa que se compara. Responder às avaliações e "
                                 "pedir avaliação a quem saiu satisfeito é o que mais mexe nesse número."
                                 + (f" Os 3 primeiros de “{conc['consulta']}” têm {juntar([numero(x) for x in notas3])}."
                                    if len(notas3) == 3 else "")})
    comparacao = (f" Na busca “{conc['consulta']}”, os {len(conc['outros'])} primeiros têm, no meio da lista, "
                  f"{int(med)} avaliações." if conc and med is not None else "")
    if n is not None and n < 20:
        pontos.append({"chave": "avaliacoes",
                       "titulo": "Ainda sem avaliações no Google" if n == 0 else f"Só {n} avaliaç{'ão' if n == 1 else 'ões'} no Google",
                       "porque": f"Entre duas opções parecidas, o cliente confia em quem tem mais avaliações, e vocês têm {n}."
                                 + comparacao + " Pedir na hora, a quem saiu satisfeito, é o jeito mais barato de "
                                 "crescer esse número."})
    elif n is not None and med is not None and n * 2 < med:
        pontos.append({"chave": "avaliacoes", "titulo": f"{n} avaliações, menos da metade do que os primeiros da busca têm",
                       "porque": "Entre duas opções parecidas, o cliente confia em quem tem mais avaliações." + comparacao
                                 + " Pedir na hora, a quem saiu satisfeito, é o jeito mais barato de encurtar a distância."})
    # Telefone fixo não vira ponto: o Caçador só deixa passar fixo com WhatsApp publicado, então
    # "não tem como mandar mensagem" seria falso em todos (revisão de 08/10/2026, 9 de 9).
    if horario is False and not sem_horario_comum:
        h3 = [r for r in top3 if isinstance(r.get("horario"), bool)]
        k = sum(1 for r in h3 if r["horario"])
        pontos.append({"chave": "horario", "titulo": "O horário de funcionamento não aparece no Google",
                       "porque": "Quem procura não sabe se vocês estão abertos, e quem usa o filtro “Aberto agora” nem vê "
                                 "vocês na lista."
                                 + (f" Na busca “{conc['consulta']}”, {k} dos 3 primeiros mostram o horário."
                                    if len(h3) == 3 and k else "")
                                 + " Preencher leva 5 minutos no Perfil da Empresa do Google."})
    pag = site_pagina or {}
    if site and site["tipo"] in ("morto", "proprio") and site_hoje == "no_ar" and False in (pag.get("celular"),
                                                                                           pag.get("whatsapp")):
        faltas = [t for t, v in (("não está pronto para celular", pag.get("celular")),
                                 ("não tem botão de WhatsApp", pag.get("whatsapp"))) if v is False]
        pontos.append({"chave": "site", "titulo": f"O site de vocês {juntar(faltas)}",
                       "porque": f"Quem toca em “Site” no perfil vai para {dominio(site['url'])}, que abriu{quando}, mas "
                                 f"{juntar(faltas)}. Quase todo mundo que chega pelo Google está no celular e quer "
                                 "chamar na hora; se não dá, volta para a busca." + vizinhos})
    avs3 = [r["avaliacoes"] for r in top3 if isinstance(r.get("avaliacoes"), int)]
    if (n and len(avs3) == 3 and n < (mediana(avs3) or 0)
            and not any(p["chave"] == "avaliacoes" for p in pontos)):
        pontos.append({"chave": "avaliacoes", "alvo": int(mediana(avs3)),
                       "titulo": f"{n} avaliações, menos que os 3 primeiros da busca",
                       "porque": f"Na busca “{conc['consulta']}”, os 3 primeiros têm {juntar([str(x) for x in avs3])} "
                                 "avaliações. Entre duas opções com nota parecida, o cliente escolhe quem tem mais gente "
                                 "dizendo que deu certo. Pedir na hora, a quem saiu satisfeito, é o jeito mais barato de "
                                 "encurtar a distância."})
    if fotos == 0 and fotos_baixadas > 0:
        pontos.append({"chave": "fotos", "titulo": "Nenhuma das primeiras fotos do perfil é de vocês",
                       "porque": "Das primeiras fotos que o Google mostra no perfil, 0 foram publicadas por vocês: quem "
                                 "publicou foram outras pessoas. É a primeira impressão do lugar, e vocês não escolheram "
                                 "qual é."})
    pontos = pontos[:MAX_PONTOS]

    # O que já está bom: cada um com o porquê em números quando a busca dá.
    bons: list[dict] = []
    avaliacoes_ponto = any(p["chave"] == "avaliacoes" for p in pontos)
    if nota is not None and n and nota >= 4.5 and n >= 5:
        titulo = f"Nota {numero(nota)} com {n} avaliações" if n >= 20 and not avaliacoes_ponto else f"Nota {numero(nota)} no Google"
        notas5 = [r["nota"] for r in (conc["outros"] if conc else []) if isinstance(r.get("nota"), (int, float))]
        if len(notas5) >= 3 and nota >= min(notas5):
            porque = (f"Os {len(notas5)} primeiros de “{conc['consulta']}” têm entre {numero(min(notas5))} e "
                      f"{numero(max(notas5))}. A nota de vocês está " + ("acima de todos" if nota > max(notas5)
                                                                         else "no mesmo nível")
                      + ", e é a primeira coisa que alguém olha quando compara duas opções.")
        else:
            porque = ("Quem compara no Google vê que quem já foi atendido gostou. É o que vocês têm de mais forte, e é o "
                      "que mais pesa quando alguém escolhe entre duas opções.")
        bons.append({"titulo": titulo, "porque": porque})
    no_topo = [b for b in buscas if b["posicao"] and b["posicao"] <= 3]
    if no_topo:
        b = no_topo[0]
        bons.append({"titulo": f"{b['posicao']}º lugar em “{b['consulta']}”",
                     "porque": f"Quem procura “{b['consulta']}” vê vocês entre os 3 primeiros, os que o Google mostra antes "
                               "de “Mais empresas”. É o lugar que mais recebe toque."})
    if avals and avals["temas"] and avals["temas"][0]["n"] >= 2:
        t = avals["temas"][0]
        bons.append({"titulo": f"{t['n']} de {avals['total']} avaliações {t['frase']}",
                     "porque": "Contamos nas avaliações que o Google mostra primeiro no perfil. É o que o cliente novo "
                               "lê antes de chamar, e é o que a página de vocês deve mostrar."})
    if conc and n and med is not None and n > med:
        bons.append({"titulo": f"Mais avaliações que a maioria dos {len(conc['outros'])} primeiros da busca",
                     "porque": f"Vocês têm {n}; no meio da lista, os outros têm {int(med)}. "
                               "Avaliação é prova de que tem gente sendo atendida, e ela não se compra."})
    if site and site["tipo"] in ("morto", "proprio") and site_hoje == "no_ar":
        pag = site_pagina or {}
        extra = ("pronto para celular e com botão de WhatsApp" if pag.get("celular") and pag.get("whatsapp")
                 else "pronto para celular" if pag.get("celular") else "com botão de WhatsApp" if pag.get("whatsapp") else "")
        bons.append({"titulo": "O botão “Site” leva a um site de vocês",
                     "porque": f"Quem toca em “Site” no perfil vai para {dominio(site['url'])}, que abriu{quando}"
                               + (f", {extra}" if extra else "") + ". Quem está comparando vê o trabalho antes de chamar."})
    if telefone == "celular":
        bons.append({"titulo": "O telefone do perfil é celular",
                     "porque": "Quem acha vocês no Google pode ligar ou mandar mensagem para o número que aparece ali, "
                               "sem procurar outro contato."})
    if horario:
        bons.append({"titulo": "Horário de funcionamento preenchido",
                     "porque": "Quem procura sabe se vocês estão abertos antes de ligar, e aparece para quem usa o filtro "
                               "“Aberto agora”."})
    if fotos:
        bons.append({"titulo": f"{fotos} foto{'s' if fotos > 1 else ''} publicada{'s' if fotos > 1 else ''} por vocês",
                     "porque": "O cliente vê o lugar do jeito que vocês escolheram mostrar. Foto do lugar e do trabalho "
                               "passa confiança antes da primeira conversa."})
    if recente:
        bons.append({"titulo": "Avaliação nova nos últimos 30 dias",
                     "porque": "O perfil está vivo: quem procura vê que tem gente sendo atendida agora, e não um perfil "
                               "parado há anos."})
    bons = bons[:MAX_BONS]

    diag = {"bons": bons, "pontos": pontos, "lido_em": data_br(c.get("Criado em", "")),
            "maps": (detalhes or {}).get("maps") or c.get("Google Maps", ""), "cidade": cidade, "vertical": vertical,
            "nota": nota, "avaliacoes": n, "horario": horario, "fotos": fotos, "fotos_baixadas": fotos_baixadas,
            "telefone": telefone, "recente": recente, "site": site, "site_hoje": site_hoje, "hoje": hoje,
            "concorrencia": conc, "buscas": buscas, "avaliacoes_lidas": avals, "demo": demo,
            "avaliacoes_textos": (detalhes or {}).get("textos") or [],
            "places_em": data_br((places or {}).get("lido_em", "")),
            "horario_resumo": resumo_do_horario((detalhes or {}).get("horario")),
            "horario_dias": (detalhes or {}).get("horario"),
            "endereco": c.get("Endereço", "").strip(),
            "categoria": str((detalhes or {}).get("tipo") or "").strip(),
            "tem_telefone": len(re.sub(r"\D", "", c.get("Telefone", ""))) >= 8,
            "site_pagina": site_pagina if site_hoje == "no_ar" else None}
    diag["presenca"] = calculo_prumo.nota_de_presenca(**entradas_da_presenca(diag)) if calculo_prumo else None
    return diag


def entradas_da_presenca(diag: dict) -> dict:
    """O diagnóstico nos termos do cálculo PRUMO (calculo_prumo.nota_de_presenca). Item que o
    Raio-X não conferiu vai como None: o módulo o deixa fora da conta, nunca como falta."""
    todas = diag.get("buscas") or ([diag["concorrencia"]] if diag.get("concorrencia") else [])
    buscas = [{"consulta": b["consulta"], "posicao": b["posicao"], "lidos": b["lidos"],
               "concorrentes": [{"id": r.get("id"), "avaliacoes": r.get("avaliacoes")} for r in b["outros"]]}
              for b in todas] or None
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


# ------------------------------------------------------------------ o JSON do modelo aprovado (PURO)

def juntar(itens: list[str]) -> str:
    itens = [i for i in itens if i]
    return itens[0] if len(itens) == 1 else ", ".join(itens[:-1]) + " e " + itens[-1] if itens else ""


DIAS = ("segunda", "terça", "quarta", "quinta", "sexta", "sábado", "domingo")


def _hora(h: str, m: str) -> str:
    return f"{int(h)}h" + ("" if m == "00" else m)


def horario_legivel(dias: list[str] | None) -> str:
    """'segunda a sexta, 8h às 18h; sábado, 8h às 12h' a partir do weekdayDescriptions do Places (de
    segunda a domingo, em pt-BR). Dias fechados ficam fora; o que não dá para ler cai no resumo
    ('aberto 6 dias por semana'). '' sem horário."""
    if not dias:
        return ""
    if len(dias) != 7:
        return resumo_do_horario(dias)
    if all("24 horas" in d.lower() for d in dias):
        return "aberto 24 horas, todos os dias"
    faixas = []
    for d in dias:
        texto = d.split(":", 1)[1].strip() if ":" in d else ""
        if "fechad" in sem_acento(texto).lower():
            faixas.append(None)
            continue
        if "24 horas" in texto.lower():
            faixas.append("24 horas")
            continue
        pares = re.findall(r"(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})", texto)
        if not pares:
            return resumo_do_horario(dias)
        faixas.append(" e ".join(f"{_hora(a, b)} às {_hora(c, d_)}" for a, b, c, d_ in pares))
    grupos: list[list] = []
    for i, f in enumerate(faixas):
        if f is None:
            continue
        if grupos and grupos[-1][1] == i - 1 and grupos[-1][2] == f:
            grupos[-1][1] = i
        else:
            grupos.append([i, i, f])
    partes = []
    for a, b, f in grupos:
        dias_txt = DIAS[a] if a == b else f"{DIAS[a]} e {DIAS[b]}" if b == a + 1 else f"{DIAS[a]} a {DIAS[b]}"
        partes.append(f"{dias_txt}, {f}")
    return "; ".join(partes) or resumo_do_horario(dias)


def fecha_as(dias: list[str] | None) -> str:
    """A hora em que o atendimento acaba nos dias úteis ('18h'), se for a mesma de segunda a sexta; '' se não dá."""
    fins = set()
    for d in (dias or [])[:5]:
        pares = re.findall(r"(\d{1,2}):(\d{2})\s*[–-]\s*(\d{1,2}):(\d{2})", d)
        if not pares:
            return ""
        fins.add(_hora(*pares[-1][2:]))
    return fins.pop() if len(fins) == 1 and len(dias or []) == 7 else ""


# Palavras do ramo na página: "paciente" em saúde, "escritório" em advocacia.
TERMOS_DO_RAMO = (
    (("odonto", "dentist", "clinica", "fisio", "psicolog", "nutri", "medic", "saude"),
     {"cliente": "paciente", "clientes": "pacientes", "empresa": "clínica"}),
    (("advoc", "advog", "juridic", "contab", "contador", "arquitet", "engenhar"),
     {"cliente": "cliente", "clientes": "clientes", "empresa": "escritório"}),
)


def termos_do_ramo(vertical: str, tipo: str = "") -> dict:
    v = sem_acento(f"{vertical} {tipo}").lower()
    for raizes, termos in TERMOS_DO_RAMO:
        if any(r in v for r in raizes):
            return dict(termos)
    return {"cliente": "cliente", "clientes": "clientes", "empresa": "empresa"}


def lugar(b: dict) -> str:
    return f"{b['posicao']}º lugar" if b["posicao"] else f"fora dos {b['lidos']} primeiros"


def _mediana_inteira(valores: list[int]) -> int | None:
    m = mediana(valores)
    return None if m is None else int(round(m))


def completar_pelas_outras_buscas(r: dict, buscas: list[dict]) -> dict:
    """O Places às vezes devolve um concorrente sem nota ou sem avaliações numa busca e com elas noutra
    (15/10/2026, Verde + Prestadora: 5,0 e 85 nas duas outras, nada na primeira). O mesmo place_id
    completa o que faltou; sem ele em busca nenhuma, a falta continua e a linha sai."""
    r = dict(r)
    for chave, tipo in (("nota", (int, float)), ("avaliacoes", int)):
        if isinstance(r.get(chave), tipo):
            continue
        r[chave] = next((o[chave] for b in buscas for o in b.get("outros", [])
                         if o.get("id") and o.get("id") == r.get("id") and isinstance(o.get(chave), tipo)), r.get(chave))
    return r


def comparacao_com_os_3(diag: dict) -> dict | None:
    """'Vocês e os 3 primeiros' da primeira busca: só linhas com o dado dos dois lados."""
    conc = diag.get("concorrencia")
    top3 = [completar_pelas_outras_buscas(r, diag.get("buscas") or []) for r in (conc or {}).get("outros", [])[:3]]
    if len(top3) < 3:
        return None
    nota, n = diag.get("nota"), diag.get("avaliacoes")
    linhas = []
    notas = [r.get("nota") for r in top3]
    if nota is not None and all(isinstance(x, (int, float)) for x in notas):
        linhas.append({"item": "Nota no Google", "voces": numero(nota), "eles": " · ".join(numero(x) for x in notas),
                       "perde": nota < (mediana(notas) or 0), "falta": "na nota"})
    avs = [r.get("avaliacoes") for r in top3]
    if n is not None and all(isinstance(x, int) for x in avs):
        med = _mediana_inteira(avs)
        linhas.append({"item": "Avaliações", "voces": str(n), "eles": str(med), "nota_eles": "no meio dos 3",
                       "perde": n < med, "falta": "nas avaliações"})
    site, hoje = diag.get("site"), diag.get("site_hoje")
    voces_site = None
    if site and site["tipo"] in ("nenhum", "rede"):
        voces_site = "não"
    elif site and hoje == "no_ar":
        voces_site = "sim"
    elif site and hoje == "fora":
        voces_site = "não abre"
    elif site and hoje == "sem_nome":
        voces_site = "não"  # abre, mas sem o nome de vocês: não é um site de vocês
    if voces_site:
        k = sum(1 for r in top3 if tipo_de_link(r.get("site", "")) == "proprio")
        linhas.append({"item": "Site próprio", "voces": voces_site, "eles": f"{k} de 3", "nota_eles": "com link no perfil",
                       "perde": voces_site != "sim" and k > 0, "falta": "no site"})
    sem_comum = any(r in sem_acento(diag.get("vertical", "")).lower() for r in SEM_HORARIO_COMUM)
    h3 = [r.get("horario") for r in top3]
    if isinstance(diag.get("horario"), bool) and not sem_comum and all(isinstance(x, bool) for x in h3):
        k = sum(1 for x in h3 if x)
        linhas.append({"item": "Horário no perfil", "voces": "sim" if diag["horario"] else "não", "eles": f"{k} de 3",
                       "perde": not diag["horario"] and k > 0, "falta": "no horário do perfil"})
    if len(linhas) < 4:
        pos3 = [r["pos"] for r in top3]
        # A célula não quebra linha: "fora dos 20" não cabe no celular; o número vai na nota miúda.
        linhas.append({"item": "Lugar nesta busca", "voces": f"{conc['posicao']}º" if conc["posicao"] else "fora",
                       "eles": " · ".join(f"{p}º" for p in pos3),
                       **({} if conc["posicao"] else {"nota_eles": f"vocês: fora dos {conc['lidos']} primeiros"}),
                       "perde": not conc["posicao"] or conc["posicao"] > max(pos3), "falta": "no lugar na busca"})
    perdas = [l["falta"] for l in linhas if l["perde"]]
    nota_perde = any(l["perde"] for l in linhas if l["item"] == "Nota no Google")
    if nota_perde:
        frase = "A primeira coisa que o cliente compara, a nota, está abaixo dos 3 primeiros."
    elif perdas:
        frase = f"A nota está no nível dos 3 primeiros. A diferença está {juntar(perdas)}."
    else:
        frase = "Vocês estão no nível dos 3 primeiros em tudo o que o cliente compara aqui."
    return {"busca": conc["consulta"],
            "linhas": [{k: v for k, v in l.items() if k != "falta"} for l in linhas], "frase": frase}


def onde_esta_o_demo(diag: dict) -> tuple[str, str]:
    """(frase do site no ar, frase do site novo): onde está a demonstração. O Raio-X dentro do demo diz "neste
    mesmo endereço"; o avulso (demo sob pedido) cita o endereço do demo quando ele existe e, antes disso,
    oferece montá-lo, porque não existe demo para mostrar."""
    if not diag.get("avulso"):
        return ("a demonstração que fizemos para vocês, na página inicial deste endereço, já mostra como fica.",
                "A demonstração já está pronta: é a página inicial deste mesmo endereço.")
    if diag.get("demo_url"):
        onde = dominio(diag["demo_url"])
        return (f"a demonstração que fizemos para vocês, em {onde}, já mostra como fica.",
                f"A demonstração já está pronta, em {onde}.")
    return ("se quiserem ver como fica, montamos uma demonstração para vocês, sem compromisso.",
            "Se quiserem ver antes, montamos uma demonstração com as fotos e as avaliações de vocês, sem compromisso.")


def acao_do_ponto(p: dict, diag: dict, site: dict | None) -> dict:
    """A coisa a fazer que resolve o ponto, com quem faz. `ordem`: o que vocês fazem hoje vem antes."""
    chave = p["chave"]
    demo_no_ar, demo_novo = onde_esta_o_demo(diag)
    if chave == "busca":
        oab = " Sem promessa de resultado, como o Provimento 205/2021 da OAB pede." if any(
            r in sem_acento(diag.get("vertical", "")).lower() for r in ("advoc", "advog")) else ""
        return {"ordem": 3, "titulo": f"Anunciar para quem procura “{p['consulta']}”",
                "texto": f"Um anúncio no Google para “{p['consulta']}”, levando ao site. O anúncio aparece acima da lista "
                         "do mapa desde o primeiro dia; o lugar na lista sobe com o tempo, com site e avaliações." + oab,
                "quem": "Quem cuida dos anúncios de vocês, ou o PRUMO."}
    if chave == "site" and diag.get("site_hoje") == "no_ar":
        return {"ordem": 2, "titulo": "Deixar o site pronto para o celular, com botão de WhatsApp",
                "texto": "Quem chega pelo Google está no celular e quer chamar na hora. Um botão de WhatsApp com a "
                         "mensagem começada e a página no tamanho da tela resolvem; " + demo_no_ar,
                "quem": "Quem cuida do site de vocês, ou o PRUMO."}
    if chave == "site":
        tipo = (site or {}).get("tipo")
        titulo = ("Um site no botão “Site” do perfil" if tipo == "nenhum"
                  else f"Um site de vocês no lugar de {nome_da_rede(site['url'])}" if tipo == "rede"
                  else "Um site no lugar da página que não abre")
        return {"ordem": 2, "titulo": titulo,
                "texto": "Os serviços, as fotos, como é a primeira conversa e o botão de WhatsApp, numa página que abre "
                         "bem no celular e fica no botão “Site” do Google. " + demo_novo,
                "quem": "Um fornecedor de site de vocês, ou o PRUMO."}
    if chave == "avaliacoes":
        med = p.get("alvo") or (diag.get("concorrencia") or {}).get("mediana_avaliacoes")
        alvo = (f"chegar perto das {int(med)} avaliações que os primeiros da busca têm" if med
                else "passar das 20 avaliações, quando o número começa a pesar na escolha")
        return {"ordem": 1, "titulo": "Pedir avaliação a quem saiu satisfeito",
                "texto": f"No fim de cada atendimento, mandar o link do perfil pelo WhatsApp e pedir uma avaliação. É o "
                         f"jeito mais barato de {alvo}.",
                "quem": "Vocês mesmos, a partir de hoje."}
    if chave == "nota":
        return {"ordem": 1, "titulo": "Responder às avaliações, a começar pelas críticas",
                "texto": "Uma resposta curta e educada a cada avaliação, sem discutir, mostra a quem lê que do outro lado "
                         "tem gente cuidando. E pedir avaliação a quem saiu satisfeito é o que mais sobe a nota.",
                "quem": "Vocês mesmos, esta semana."}
    if chave == "horario":
        return {"ordem": 0, "titulo": "Preencher o horário no perfil do Google",
                "texto": "São 5 minutos no Perfil da Empresa do Google. Com o horário, vocês aparecem para quem usa o "
                         "filtro “Aberto agora”, e o cliente sabe quando chamar.",
                "quem": "Vocês mesmos, hoje."}
    return {"ordem": 1, "titulo": "Publicar fotos do lugar e do trabalho",
            "texto": "Fotos da fachada, da equipe e do trabalho pronto, publicadas pelo próprio perfil, passam a ser as "
                     "que o cliente vê primeiro. Dá para fazer do celular, no Perfil da Empresa do Google.",
            "quem": "Vocês mesmos, esta semana."}


def perfil_linhas(diag: dict) -> list[dict]:
    """Os 5 itens do perfil do modelo aprovado, cada detalhe tirado dos dados; 'nc' = não conferido."""
    linhas = []
    h = diag.get("horario")
    sem_comum = any(r in sem_acento(diag.get("vertical", "")).lower() for r in SEM_HORARIO_COMUM)
    if h:
        linhas.append({"estado": "ok", "item": "Horário de funcionamento",
                       "detalhe": horario_legivel(diag.get("horario_dias")) or diag.get("horario_resumo") or "preenchido"})
    elif h is False:
        linhas.append({"estado": "nc" if sem_comum else "falta", "item": "Horário de funcionamento",
                       "detalhe": "o Google não mostra horário comum para este ramo" if sem_comum
                       else "não aparece; quem usa o filtro “Aberto agora” não vê vocês"})
    else:
        linhas.append({"estado": "nc", "item": "Horário de funcionamento", "detalhe": "não conferido"})
    tel = diag.get("telefone")
    if tel:
        linhas.append({"estado": "ok", "item": "Telefone",
                       "detalhe": "celular: dá para ligar ou mandar mensagem" if tel == "celular" else "fixo"})
    else:
        linhas.append({"estado": "ok" if diag.get("tem_telefone") else "nc", "item": "Telefone",
                       "detalhe": "aparece no perfil" if diag.get("tem_telefone") else "não conferido"})
    f = diag.get("fotos")
    if f:
        linhas.append({"estado": "ok", "item": "Fotos", "detalhe": f"{f} das primeiras publicada{'s' if f > 1 else ''} por vocês"})
    elif f == 0 and diag.get("fotos_baixadas"):
        linhas.append({"estado": "falta", "item": "Fotos", "detalhe": "as primeiras foram publicadas por outras pessoas"})
    else:
        linhas.append({"estado": "nc", "item": "Fotos", "detalhe": "não conferido"})
    cat = diag.get("categoria", "")
    if cat and cat.lower() not in TIPOS_GENERICOS:
        linhas.append({"estado": "ok", "item": "Categoria", "detalhe": cat})
    else:
        linhas.append({"estado": "nc", "item": "Categoria",
                       "detalhe": f"“{cat}”: uma categoria geral; não conferimos qual delas ajudaria mais na busca" if cat
                       else "não conferido"})
    site, hoje = diag.get("site"), diag.get("site_hoje")
    if site is None:
        linhas.append({"estado": "nc", "item": "Botão “Site”", "detalhe": "não conferido"})
    elif site["tipo"] == "nenhum":
        linhas.append({"estado": "falta", "item": "Botão “Site”", "detalhe": "o perfil não tem"})
    elif site["tipo"] == "rede":
        linhas.append({"estado": "falta", "item": "Botão “Site”", "detalhe": f"leva para {nome_da_rede(site['url'])}"})
    elif hoje == "no_ar":
        linhas.append({"estado": "ok", "item": "Botão “Site”", "detalhe": f"leva a {dominio(site['url'])}, que abriu quando conferimos"})
    elif hoje in ("fora", "sem_nome"):
        linhas.append({"estado": "falta", "item": "Botão “Site”",
                       "detalhe": f"existe, mas {dominio(site['url'])} "
                                  + ("não abriu" if hoje == "fora" else "abria uma página sem o nome de vocês")
                                  + (f" em {diag['hoje']}" if diag.get("hoje") else "")})
    else:
        linhas.append({"estado": "nc", "item": "Botão “Site”", "detalhe": f"leva a {dominio(site['url'])}; não conseguimos abrir"})
    return linhas


def dados_do_modelo(dados: dict, diag: dict) -> dict:
    """O diagnóstico no esquema do raio-x.json do piloto (modelos/raio-x.json), para o modelo_raio_x.
    Só entra o que o Raio-X automático conferiu: sem respostas às avaliações, sem redes nem anúncios
    (as duas seções saem marcadas "não conferido"). Sem equipe conhecida, mas com o convite do Mapa (15/10/2026):
    o texto do convite diz "com equipe" quando `equipe` está vazia."""
    nome = dados["nome"] or "a empresa"
    lido = diag.get("places_em") or diag["lido_em"]
    site = diag.get("site")
    entradas = entradas_da_presenca(diag)
    termos = termos_do_ramo(diag.get("vertical", ""), diag.get("categoria", ""))
    cat = diag.get("categoria", "")
    ramo = cat if cat and cat.lower() not in TIPOS_GENERICOS else (diag.get("vertical") or "").capitalize()
    buscas = [{"consulta": b["consulta"], "posicao": b["posicao"], "lidos": b["lidos"],
               "concorrentes": [{"id": r.get("id"), "pos": r["pos"], "nome": r.get("nome") or "", "nota": r.get("nota"),
                                 "avaliacoes": r.get("avaliacoes"), "site": tipo_de_link(r.get("site", ""))}
                                for r in b["outros"]]} for b in diag.get("buscas") or []]
    for b in buscas:  # o molde escreve "X de nota" e "N avaliações": sem número, o concorrente não entra
        b["concorrentes"] = [c for c in b["concorrentes"] if isinstance(c["nota"], (int, float))
                             and isinstance(c["avaliacoes"], int)]
    acoes = sorted((acao_do_ponto(p, diag, site) for p in diag["pontos"]), key=lambda a: a["ordem"])
    avals = (diag.get("avaliacoes_lidas") or {}).get("total") or 0
    hoje_site = diag.get("site_hoje")
    site_rotulo = ({"nenhum": "sem site", "rede": "site: rede social"}.get((site or {}).get("tipo", ""))
                   or {"fora": "site fora do ar", "sem_nome": "site sem o nome de vocês", "no_ar": "site próprio"}.get(
                       hoje_site or "", "site não conferido"))
    # Os motivos dos serviços: só o que o Raio-X mostrou. Sem dado (redes), sem motivo.
    motivos = {}
    if site and site["tipo"] == "nenhum":
        motivos["site"] = "No Raio-X: o perfil do Google não tem site."
    elif site and site["tipo"] == "rede":
        motivos["site"] = f"No Raio-X: o botão “Site” do Google leva para {nome_da_rede(site['url'])}."
    elif hoje_site == "fora":
        motivos["site"] = "No Raio-X: o site do perfil não abriu quando conferimos."
    elif hoje_site == "sem_nome":
        motivos["site"] = "No Raio-X: o site do perfil abria uma página sem o nome de vocês."
    elif not diag.get("avulso"):
        motivos["site"] = "No Raio-X: a demonstração do site já está pronta, neste mesmo endereço."
    elif diag.get("demo_url"):
        motivos["site"] = f"No Raio-X: a demonstração do site já está pronta, em {dominio(diag['demo_url'])}."
    else:
        motivos["site"] = "No Raio-X: montamos a demonstração do site de vocês, sem compromisso, se quiserem ver."
    if buscas:
        notas = [calculo_prumo.nota_da_posicao(b["posicao"]) for b in buscas] if calculo_prumo else [0] * len(buscas)
        pior = buscas[notas.index(min(notas))]
        motivos["trafego"] = (f"No Raio-X: {lugar(pior)} em “{pior['consulta']}”." if not pior["posicao"] or pior["posicao"] > 3
                              else f"No Raio-X: vocês estão entre os 3 primeiros nas {len(buscas)} buscas.")
    fim = fecha_as(diag.get("horario_dias"))
    if fim:
        motivos["produtos"] = f"No Raio-X: o atendimento do perfil acaba às {fim}; o robô responde depois disso."
    redes = []
    if site and site["tipo"] == "rede" and nome_da_rede(site["url"]) in ("o Instagram", "o Facebook", "o TikTok"):
        rede = nome_da_rede(site["url"])[2:]
        redes.append({"estado": "ok", "item": f"{rede} no perfil do Google", "detalhe": "o botão “Site” leva até ele."})
    redes.append({"estado": "nc", "item": "Instagram e Facebook",
                  "detalhe": "não conferidos neste Raio-X, que lê só o Google. Seguidores e posts ficam para a conversa."})
    anuncios = [{"estado": "nc", "item": "Google",
                 "detalhe": "não conferido: os anúncios mudam a cada busca, e este Raio-X lê só a lista do mapa."},
                {"estado": "nc", "item": "Instagram e Facebook", "detalhe": "não conferido neste Raio-X."}]
    lidos = sorted({b["lidos"] for b in buscas})
    quantos = (f"os {lidos[0]} primeiros resultados de cada uma" if len(lidos) == 1
               else f"pelo menos os {lidos[0]} primeiros resultados de cada uma") if lidos else ""
    metodo = [f"Nota, avaliações, horário e categoria: lidos no perfil do Google em {lido}."]
    if diag.get("fotos") is not None and diag.get("lido_em"):
        metodo.append(f"As fotos: contadas quando o PRUMO encontrou vocês no Google, em {diag['lido_em']}.")
    if buscas:
        metodo.append(f"As buscas: {len(buscas)}, na lista de lugares do Google, em {lido}; lemos {quantos}. {{como_ordena}}.")
    if avals:
        metodo.append(f"As avaliações: as {avals} que o Google mostra primeiro no perfil, lidas uma a uma. Se vocês "
                      "respondem a elas não conferimos: o Google não entrega as respostas a sistemas de fora.")
    if site and site["tipo"] in ("morto", "proprio") and hoje_site:
        metodo.append(f"O site {dominio(site['url'])}: abrimos o endereço em {diag.get('hoje') or lido}.")
    metodo += ["As redes e os anúncios: não conferidos neste Raio-X, que lê só o Google. Na conversa, olhamos com vocês.",
               "Não conferimos quanto tempo vocês levam para responder uma mensagem: isso só se vê por dentro."]
    return {
        "exemplo": False, "nome": nome, "ramo": ramo, "cidade": diag.get("cidade") or "", "lido_em": lido, "equipe": "",
        "google": {"nota": diag.get("nota"), "avaliacoes": diag.get("avaliacoes")},
        "buscas": buscas, "respostas": None,
        "perfil": entradas["perfil"], "site": entradas["site"] or {"tipo": None},
        "avaliacoes_recentes": [a for a in ((diag.get("avaliacoes_textos") or [])) if isinstance(a, dict)],
        "bons": [{"titulo": b["titulo"], "porque": b["porque"]} for b in diag["bons"]],
        "pontos": [{"titulo": p["titulo"], "porque": p["porque"]} for p in diag["pontos"]],
        "comparacao": comparacao_com_os_3(diag) or {"busca": "", "linhas": [], "frase": ""},
        "redes": redes, "anuncios": anuncios,
        "o_que_fazer": [{"n": f"{i:02d}", "titulo": a["titulo"], "texto": a["texto"], "quem": a["quem"]}
                        for i, a in enumerate(acoes, 1)],
        "mapa_link": MAPA_LINK, "mapa_exemplo_url": MAPA_EXEMPLO_URL, "servicos_motivo": motivos, "termos": termos,
        # os ganchos do modelo_raio_x (GANCHOS): o automático só lê o Google
        "lede": "Feito pelo PRUMO só com o que qualquer pessoa vê no Google, sem pedir nada a vocês.",
        "descricao": f"Como {nome} aparece para quem procura no Google: a busca, as avaliações, o perfil, o site e os "
                     "concorrentes.",
        "perfil_linhas": perfil_linhas(diag), "metodo": metodo, "avaliacoes_ordem": "google", "site_rotulo": site_rotulo,
    }


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
.kicker{font-size:13px;letter-spacing:.14em;text-transform:uppercase;font-weight:800;color:var(--oxido);margin-top:24px}
.ato{margin-top:64px}
.ato.veredito{margin-top:0}
.ato > .kicker:first-child{margin-top:0;display:flex;align-items:center;gap:8px}
.ato > .kicker:first-child::before{content:"";width:3px;height:16px;background:var(--brasa);display:block}
.ato.veredito > .kicker:first-child{margin-top:20px}
.veredito .lede{font-size:15px;margin-top:8px}
.ato.veredito > .kicker:first-child::before{display:none}
.ato > h2,.ato > div > h2{margin-top:10px}
h1{font-size:clamp(34px,8vw,54px);line-height:.98;letter-spacing:-.025em;font-weight:800;margin-top:10px;
font-variation-settings:'wdth' 108,'wght' 800;overflow-wrap:anywhere}
.lede{color:var(--ferro-600);margin-top:12px;max-width:60ch}
.nota{display:flex;align-items:flex-end;gap:16px;margin-top:16px;border-top:2px solid var(--ferro-900);
border-bottom:2px solid var(--ferro-900);padding:12px 0}
.nota .num{font-size:56px;line-height:.85;font-weight:900;letter-spacing:-.03em;font-variation-settings:'wdth' 118,'wght' 900}
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
.oferta{margin-top:32px;background:var(--ferro-900);color:var(--pedra-100);padding:28px 22px;display:grid;gap:12px}
.oferta h2{color:var(--pedra-100);margin-top:0}
.oferta .miudo{color:var(--pedra-400)}
.oferta .preco{font-size:clamp(28px,7vw,40px);font-weight:900;line-height:1;color:var(--brasa-clara);
font-variation-settings:'wdth' 112,'wght' 900}
.oferta p{color:var(--pedra-200);max-width:56ch}
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
.detalhes{margin-top:36px;border-top:2px solid var(--ferro-900)}
.detalhe{border-bottom:1px solid var(--pedra-400)}
.detalhe > summary{list-style:none;cursor:pointer;min-height:56px;display:flex;align-items:center;
justify-content:space-between;gap:12px;padding:12px 0;font-size:19px;line-height:1.25;font-weight:750;
font-variation-settings:'wght' 750}
.detalhe > summary::-webkit-details-marker{display:none}
.detalhe > summary::after{content:"+";flex:none;width:28px;text-align:center;font-size:28px;line-height:1;font-weight:700;
color:var(--brasa)}
.detalhe[open] > summary::after{content:"–"}
.detalhe > summary:hover{color:var(--oxido)}
.detalhe > summary:focus-visible{outline:3px solid var(--ocre);outline-offset:2px}
.detalhe .corpo{padding:0 0 28px}
.detalhe .corpo > .intro:first-child{margin-top:0}
.detalhe .corpo h3.sub{font-size:20px;line-height:1.2;font-weight:800;margin-top:28px}
.barra-fixa{display:none}
footer{margin-top:40px;border-top:2px solid var(--pedra-400);padding-top:12px;font-size:13px;color:var(--pedra-600);
display:grid;gap:6px}
.intro{color:var(--ferro-600);margin-top:10px;max-width:60ch}
.resumo{margin-top:18px;display:grid;gap:0;border:2px solid var(--ferro-900)}
.resumo div{padding:12px 14px;display:grid;gap:2px}
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
.metodo{list-style:none;margin-top:12px;display:grid;gap:8px;font-size:15px;color:var(--ferro-600)}
.metodo li{padding-left:14px;border-left:2px solid var(--pedra-400)}
.visualmente-oculto{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (min-width:640px){.resumo{grid-template-columns:1fr 1fr}.resumo div + div{border-top:0;border-left:2px solid var(--ferro-900)}
.botao-zap{width:auto}}
@media (max-width:719.98px){
html.com-js body{padding-bottom:88px}
html.com-js .barra-fixa{display:block;position:fixed;left:0;right:0;bottom:0;z-index:10;background:var(--ferro-900);
border-top:2px solid var(--brasa);padding:10px 16px calc(10px + env(safe-area-inset-bottom,0px));
transform:translateY(100%);visibility:hidden}
html.com-js .barra-fixa.visivel{transform:none;visibility:visible}
.barra-fixa .botao-zap{width:100%;min-height:52px}}
@media (prefers-reduced-motion:no-preference){.botao,.botao-zap{transition:background-color .15s ease,color .15s ease}
.detalhe[open] > .corpo{animation:detalhe-abre .22s ease-out}
@keyframes detalhe-abre{from{opacity:0;transform:translateY(-6px)}to{opacity:1;transform:none}}}
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


def detalhe(titulo: str, corpo: str, classe: str = "") -> str:
    """Um `<details>` fechado: abre no toque, sem JS, e o leitor de tela anuncia aberto/fechado.
    Corpo vazio = detalhe ausente (seção que não existe para este lead não aparece)."""
    if not corpo:
        return ""
    return (f'<details class="detalhe{" " + classe if classe else ""}"><summary>{html.escape(titulo)}</summary>'
            f'<div class="corpo">{corpo}</div></details>')


class AbaixoDoPadrao(ValueError):
    """A página não chega ao padrão do modelo aprovado (a trava do piloto): não sai."""


def pagina(dados: dict, diag: dict, site_url: str, tem_og: bool) -> str:
    """A página no modelo aprovado do piloto CDL (versão 5): o diagnóstico vira o raio-x.json do piloto
    (dados_do_modelo) e o modelo_raio_x desenha, com a mesma trava de qualidade. Abaixo do padrão,
    AbaixoDoPadrao com o que falta. A fonte embutida vem de FONTE (sem ela, a Arial Narrow)."""
    if not (calculo_prumo and modelo_raio_x and PRECOS and EXEMPLO):
        raise AbaixoDoPadrao("faltam calculo_prumo.py, modelo_raio_x.py, precos.json ou exemplo-raio-x.json em "
                             "prumo-mapa/ (instale: dell-status --instalados)")
    modelo = dados_do_modelo(dados, diag)
    erros = modelo_raio_x.conferir_raio_x(modelo, PRECOS, automatico=True)
    if erros:
        raise AbaixoDoPadrao("abaixo do padrão do modelo: " + "; ".join(erros))
    e = lambda t: html.escape(str(t), quote=True)  # noqa: E731
    nome = modelo["nome"]
    base = site_url.rstrip("/")
    cabeca = ['<meta property="og:type" content="website"><meta property="og:locale" content="pt_BR">',
              f'<meta property="og:title" content="Raio-X · {e(nome)}">',
              '<meta property="og:description" content="Como vocês aparecem para quem procura no Google, feito pelo PRUMO '
              'só com dados públicos.">']
    if tem_og:
        cabeca += [f'<meta property="og:image" content="{e(base)}/og.jpg">',
                   '<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">',
                   '<meta name="twitter:card" content="summary_large_image">']
    modelo["cabeca"], modelo["corpo_attr"] = "".join(cabeca), MARCA
    rx = sys.modules[__name__]
    doc, _ = modelo_raio_x.raio_x(modelo, rx, calculo_prumo, PRECOS)
    molde, _ = modelo_raio_x.raio_x(EXEMPLO, rx, calculo_prumo, PRECOS)
    erros = modelo_raio_x.conferir_pagina(doc) + modelo_raio_x.conferir_esqueleto(doc, molde)
    if erros:
        raise AbaixoDoPadrao("; ".join(erros))
    return doc


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
            "status": str(d.get("businessStatus") or ""), "maps": str(d.get("googleMapsUri") or ""), "textos": textos,
            "bairro": next((str(c.get("longText") or "") for c in d.get("addressComponents") or []
                            if isinstance(c, dict) and {"sublocality_level_1", "sublocality"} & set(c.get("types") or [])), "")}


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


# As três buscas do modelo aprovado: a do termo do ramo, a da área (ou o outro jeito de pedir o mesmo) e a de um
# serviço que vale mais (ou "melhor ..."). Escolhidas antes de ver o resultado, pelo ramo do Caçador, pelo tipo
# do Google e por palavras do nome; nunca por quem aparece. (raízes do ramo, termo do cliente, outro jeito de
# pedir, [(raízes no nome ou no tipo, a busca da área, a do serviço de valor)])
RAMOS = (
    (("advoc", "advog", "juridic"), "advogado", "escritório de advocacia", (
        (("trabalhist",), "advogado trabalhista", "advogado acidente de trabalho"),
        (("previdenc", "inss", "aposentad"), "advogado previdenciário", "advogado INSS"),
        (("famil", "divorc"), "advogado de família", "advogado divórcio"),
        (("criminal", "penal"), "advogado criminalista", "advogado criminal"),
        (("consumid",), "advogado do consumidor", "advogado contra banco"),
        (("bancari",), "advogado bancário", "advogado revisão de financiamento"),
        (("imobiliar", "usucapi"), "advogado imobiliário", "advogado usucapião"),
        (("tributar",), "advogado tributário", "advogado para empresas"),
        (("empresarial",), "advogado empresarial", "advogado para empresas"))),
    (("odonto", "dentist", "dental"), "dentista", "clínica odontológica", (
        (("ortodon",), "ortodontista", "aparelho ortodôntico"),
        (("implant",), "implante dentário", "prótese protocolo"))),
    (("contab", "contador"), "contador", "escritório de contabilidade", ()),
    (("pilates",), "pilates", "estúdio de pilates", ()),
    (("escola infantil", "bercario", "educacao infantil"), "escola infantil", "berçário", ()),
    (("estetic",), "clínica de estética", "estética facial", ()),
    (("fisioter",), "fisioterapia", "clínica de fisioterapia", ()),
    (("psicolog",), "psicólogo", "terapia", ()),
    (("nutri",), "nutricionista", "consulta com nutricionista", ()),
    (("veterin",), "veterinário", "clínica veterinária", ()),
    (("arquitet",), "arquiteto", "escritório de arquitetura", ()),
    (("desentup",), "desentupidora", "desentupimento", ()),
    (("dedetiz",), "dedetizadora", "dedetização", ()),
    (("refrigera", "ar condicionado"), "conserto de ar condicionado", "instalação de ar condicionado", ()),
    (("marcenar", "planejad"), "móveis planejados", "marcenaria", ()),
    (("vidrac",), "vidraçaria", "box de vidro", ()),
)


def consultas_das_buscas(tipo: str, vertical: str, cidade: str, nome: str = "", bairro: str = "") -> list[str]:
    """As três buscas (sem repetir): a do termo do ramo, a da área achada no nome ou no tipo (ou o outro
    jeito de pedir o mesmo serviço) e a do serviço de valor da área (ou "melhor <termo>"). Ramo fora de
    RAMOS: a de `consulta_da_busca`, "melhor <termo>" e o termo no bairro (sem bairro, só duas)."""
    cidade = (cidade or "").strip()
    if not cidade:
        return []
    texto = sem_acento(f"{vertical} {tipo}").lower()
    em = lambda termo: f"{termo} em {cidade}"  # noqa: E731
    ramo = next((r for r in RAMOS if any(x in texto for x in r[0])), None)
    if ramo:
        _, termo, outro, areas = ramo
        pistas = sem_acento(f"{nome} {tipo}").lower()
        area = next((a for a in areas if any(x in pistas for x in a[0])), None)
        lista = [em(termo)] + ([em(area[1]), em(area[2])] if area else [em(outro), em(f"melhor {termo}")])
    else:
        primeira = consulta_da_busca(tipo, vertical, cidade)
        if not primeira:
            return []
        termo = primeira[: -len(f" em {cidade}")]
        lista = [primeira, em(f"melhor {termo}")] + ([f"{termo} em {bairro.strip()}, {cidade}"] if bairro.strip() else [])
    saida: list[str] = []
    for c in lista:
        if c.lower() not in [x.lower() for x in saida]:
            saida.append(c)
    return saida[:3]


def ler_places(pasta: Path, dados: dict, chave: str | None, hoje: dt.datetime | None = None, pedir=None) -> dict | None:
    """Detalhes do lead + as três buscas da concorrência, guardados em <pasta>/raio-x-places.json por até
    VALIDADE_CACHE_DIAS (um refazer do Raio-X no mesmo mês não paga de novo). Quatro chamadas por lead:
    Place Details (Enterprise + Atmosphere) e três Text Search (Enterprise). None sem chave ou sem detalhes."""
    pedir = pedir or pedir_places
    agora_ = hoje or dt.datetime.now().astimezone()
    pid = dados["campos"].get("place_id", "").strip()
    if not re.fullmatch(r"[A-Za-z0-9_-]{4,300}", pid):
        return None
    cache = pasta / CACHE_PLACES
    guardado = ler_json(cache)
    if isinstance(guardado, dict) and guardado.get("place_id") == pid and guardado.get("detalhes"):
        # A regra das consultas pode mudar entre versões: buscas guardadas com outras consultas não valem
        # (o cache da versão 1, de uma busca só, também não).
        g = guardado["detalhes"]
        esperadas = consultas_das_buscas(str(g.get("tipo") or ""), dados["campos"].get("Vertical", ""),
                                         dados["campos"].get("Cidade", ""), dados["nome"], str(g.get("bairro") or ""))
        try:
            lido = dt.datetime.fromisoformat(str(guardado["lido_em"]))
            feitas = [b.get("consulta") for b in guardado.get("buscas") or [] if isinstance(b, dict)]
            if ((agora_ - lido).days < VALIDADE_CACHE_DIAS and guardado.get("versao") == VERSAO_CACHE
                    and feitas == esperadas):
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
    buscas = []
    for consulta in consultas_das_buscas(detalhes["tipo"], dados["campos"].get("Vertical", ""),
                                         dados["campos"].get("Cidade", ""), dados["nome"], detalhes["bairro"]):
        codigo, b = pedir("places:searchText", CAMPOS_BUSCA, chave,
                          {"textQuery": consulta, "languageCode": "pt-BR", "regionCode": "BR",
                           "pageSize": TAMANHO_DA_BUSCA})
        if codigo == 200 and isinstance(b, dict):
            # Sem regularOpeningHours na resposta = o perfil não mostra horário (o campo foi pedido).
            buscas.append({"consulta": consulta, "resultados": [
                {"id": p.get("id"), "nome": _texto(p.get("displayName")), "nota": p.get("rating"),
                 "avaliacoes": p.get("userRatingCount"), "site": str(p.get("websiteUri") or ""),
                 "status": str(p.get("businessStatus") or ""),
                 "horario": bool((p.get("regularOpeningHours") or {}).get("weekdayDescriptions"))}
                for p in (b.get("places") or [])[:TAMANHO_DA_BUSCA]]})
        else:
            log(f"{pasta.name}: Places Text Search respondeu {codigo} em “{consulta}”; essa busca fica de fora.")
    saida = {"versao": VERSAO_CACHE, "place_id": pid, "lido_em": agora_.isoformat(timespec="seconds"),
             "detalhes": detalhes, "buscas": buscas}
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


def sob_pedido() -> bool:
    return (AUTO / SOB_PEDIDO).exists()


def eh_avulso(recibo: dict | None) -> bool:
    """O Raio-X deste lead mora no projeto avulso (e não em `/raio-x` do demo)?"""
    return isinstance(recibo, dict) and recibo.get("raio_x_projeto") == AVULSO_PROJETO


def site_do_recibo(recibo: dict | None) -> str:
    s = str((recibo or {}).get("site_url") or "").strip() if isinstance(recibo, dict) else ""
    return s if s.startswith("https://") and not (recibo or {}).get("apagado_em") else ""


def montar(pasta: Path) -> tuple[dict, dict, str, dict]:
    """(dados, diagnóstico, html, recibo) de um lead; ValueError com o motivo se não dá. Sem demo (recibo sem
    site_url), só no modo avulso: demo sob pedido ligado ou um Raio-X avulso já publicado."""
    recibo = ler_json(pasta / "publicado.json")
    recibo = recibo if isinstance(recibo, dict) else {}
    site = site_do_recibo(recibo)
    avulso = eh_avulso(recibo) or (not recibo.get("site_url") and sob_pedido())
    if not avulso:
        if not str(recibo.get("site_url", "")).startswith("https://"):
            raise ValueError("sem publicado.json com site_url")
        if recibo.get("apagado_em"):
            raise ValueError(f"demo apagado da Vercel em {recibo['apagado_em']}")
    try:
        texto = (pasta / "content.md").read_text(encoding="utf-8", errors="replace")
    except OSError:
        raise ValueError("sem content.md") from None
    dados = ler_content(texto)
    diag = diagnosticar(pasta, dados)
    diag["avulso"], diag["demo_url"] = avulso, site or None
    if not diag["pontos"]:
        raise ValueError("nenhum ponto de melhoria verificável no content.md nem no Places")
    # A trava do modelo (AbaixoDoPadrao é um ValueError): sem 3 pontos, 3 bons, 3 avaliações, 3 buscas...,
    # não há Raio-X, e o --pendentes passa para o próximo. O avulso usa o og.jpg do demo, quando há demo.
    return dados, diag, pagina(dados, diag, site, bool(site) and (pasta / "og.jpg").is_file()), recibo


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
    if diag.get("avulso"):
        return publicar_avulso(pasta, dados, diag, pagina_html, recibo, deploy)
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


def nome_avulso(slug: str, recibo: dict) -> str:
    """O nome da página avulsa (raio-x-prumo.vercel.app/<nome>): o de antes, se já foi publicada (o link pode
    ter ido na mensagem); senão o slug cortado num hífen, com sufixo se o arquivo já é de outro lead."""
    antes = str(recibo.get("raio_x_url") or "")
    if eh_avulso(recibo) and antes.startswith(AVULSO_URL + "/"):
        nome = antes[len(AVULSO_URL) + 1:].strip("/")
        if re.fullmatch(r"[a-z0-9][a-z0-9-]{0,99}", nome):
            return nome
    nome = slug if len(slug) <= TAMANHO_DO_NOME else slug[:TAMANHO_DO_NOME].rsplit("-", 1)[0]
    nome = re.sub(r"[^a-z0-9-]+", "-", nome).strip("-") or "lead"
    candidato, n = nome, 2
    while (AVULSO_PASTA / f"{candidato}.html").exists():
        candidato, n = f"{nome}-{n}", n + 1
    return candidato


def gravar_recibo_avulso(pasta: Path, dados: dict, extra: dict) -> None:
    """Como gravar_recibo, mas cria o publicado.json quando o lead ainda não tem demo (o recibo do Raio-X
    avulso é o que leva o lead ao Balcão). Sem site_url: é assim que o resto da esteira sabe que não há demo."""
    caminho = pasta / "publicado.json"
    r = ler_json(caminho) if caminho.exists() else {}
    if not isinstance(r, dict):
        raise ValueError("publicado.json ilegível")
    pid = dados["campos"].get("place_id", "")
    if not r:
        r = {"place_id": pid, "slug": pasta.name, "nome": dados["nome"] or pasta.name}
    elif pid and r.get("place_id") and r["place_id"] != pid:
        raise ValueError(f"o place_id do publicado.json ({r['place_id']}) não é o do content.md ({pid})")
    r.update(extra)
    tmp = caminho.with_name(".publicado.json.raio-x.tmp")
    tmp.write_text(json.dumps(r, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(caminho)


def publicar_avulso(pasta: Path, dados: dict, diag: dict, pagina_html: str, recibo: dict, deploy=None) -> tuple[bool, str]:
    """O Raio-X sem demo (ou do lead cujo demo saiu depois): uma página na pasta do projeto avulso e um deploy
    da pasta inteira. Só grava o recibo depois de a página responder exatamente com estes bytes."""
    import fcntl  # só no Dell: o teste roda no Linux; no Windows este caminho nunca roda
    slug = pasta.name
    log_lead = LOGS / f"execucao-{slug}.log"
    if not dados["campos"].get("place_id"):
        return False, "sem place_id no content.md (o Balcão não acharia a linha)"
    if not (AVULSO_PASTA / ".vercel/project.json").is_file():
        return False, f"{AVULSO_PASTA} não está ligada a um projeto da Vercel (vercel link --project {AVULSO_PROJETO})"
    LOGS.mkdir(parents=True, exist_ok=True)
    with open(LOGS / TRAVA_AVULSO, "w") as trava:
        fcntl.flock(trava, fcntl.LOCK_EX)
        nome = nome_avulso(slug, recibo)
        alvo = AVULSO_PASTA / f"{nome}.html"
        corpo = pagina_html.encode("utf-8")
        anterior = alvo.read_bytes() if alvo.exists() else None
        alvo.write_bytes(corpo)
        try:
            (deploy or deploy_da_pasta)(AVULSO_PASTA, log_lead)
        except Exception:
            # Nada subiu (ou não se sabe): a pasta volta ao que está no ar, para o próximo deploy não levar meia página.
            if anterior is None:
                alvo.unlink(missing_ok=True)
            else:
                alvo.write_bytes(anterior)
            raise
    url = f"{AVULSO_URL}/{nome}"
    codigo, no_ar = baixar(url)
    if codigo != 200 or no_ar != corpo:
        return False, f"publicado, mas {url} não respondeu com este Raio-X ({codigo})"
    gravar_recibo_avulso(pasta, dados, {"raio_x_url": url, "raio_x_pontos": len(diag["pontos"]), "raio_x_versao": VERSAO,
                                        "raio_x_em": agora(), "raio_x_projeto": AVULSO_PROJETO})
    try:
        (pasta / "raio-x.html").write_text(pagina_html, encoding="utf-8")
    except OSError:
        pass
    log(f"Raio-X avulso no ar: {url} ({len(diag['pontos'])} ponto(s), {len(diag['bons'])} bom(ns)"
        + (f", com o demo {diag['demo_url']}" if diag.get("demo_url") else ", sem demo: demo sob pedido") + ").", log_lead)
    return True, url


def deploy_da_pasta(pasta: Path, log_lead: Path) -> str:
    """`vercel deploy --prod` da pasta do projeto avulso (já ligada; o link é conferido antes). Devolve a URL
    da linha "Aliased:" ("" sem ela); a conferência que vale é o GET da página, no publicar_avulso."""
    ligado = ler_json(pasta / ".vercel/project.json") or {}
    if ligado.get("projectName") != AVULSO_PROJETO:
        raise RuntimeError(f"{pasta} está ligada a {ligado.get('projectName')!r}, não a {AVULSO_PROJETO}; nada publicado")
    log(f"Publicando a pasta do Raio-X avulso ({AVULSO_PROJETO})...", log_lead)
    r = subprocess.run(["vercel", "deploy", "--prod", "--yes", "--scope", VERCEL_SCOPE], cwd=pasta,
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=300)
    with open(log_lead, "a", encoding="utf-8") as saida:
        saida.write(r.stdout or "")
    if LIMITE_DE_DEPLOY.search(r.stdout or ""):
        raise LimiteDaVercel(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "limite de deploys")
    if r.returncode != 0:
        raise RuntimeError(f"vercel deploy saiu com código {r.returncode}")
    m = re.search(r"(?i)aliased:?\s+(https://\S+)", r.stdout or "")
    return m.group(1).rstrip(".,)") if m else ""


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


def pendentes(maximo: int, simulando: bool = False) -> list[Path]:
    """Leads `pronto` na raiz com demo no ar e sem Raio-X da versão atual (ou com ele fora do ar),
    o publicado mais recente primeiro (o próximo a ser enviado). Quem não teria Raio-X (sem ponto,
    demo apagado) não ocupa vaga."""
    if gerador_rodando():
        log("O gerador está rodando (gerador.lock); os pendentes ficam para a próxima rodada.")
        return []
    novos = novos_sem_demo(maximo, gravar=not simulando) if sob_pedido() else []
    status = status_no_retrato()
    if status is None:
        log("Sem retrato recente da planilha (site-leads.json); só os leads novos, sem recibo, são pendentes.")
        return novos
    maximo -= len(novos)
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
    return novos + saida


def nao_gerar() -> set[str]:
    """place_id dos leads de busca pausada (06 · Funil semanal), como no gerador. Sem arquivo: nenhum."""
    d = ler_json(FUNIL)
    try:
        return {str(x["place_id"]) for x in d.get("nao_gerar") or [] if isinstance(x, dict) and x.get("place_id")}
    except (AttributeError, TypeError):
        return set()


def do_brasil(dados: dict) -> bool:
    """O Raio-X é só em português: lead de fora segue com o demo da fila de sempre (gerador)."""
    pais = sem_acento(dados["campos"].get("País", "")).strip().lower()
    return pais in ("", "brasil", "brazil")


def molde_instalado() -> bool:
    return bool(calculo_prumo and modelo_raio_x and PRECOS and EXEMPLO)


def novos_sem_demo(maximo: int, gravar: bool = True) -> list[Path]:
    """Demo sob pedido: leads da raiz que o Caçador trouxe e que ainda não têm recibo nenhum (nem demo nem
    Raio-X), o mais novo primeiro. Fora: descartado, de busca pausada, de fora do Brasil, e quem não chega ao
    padrão do modelo (sem 3 pontos verificáveis: esse lead não é abordado, porque não há o que mostrar).
    `gravar=False` (o --simular) não deixa o SEM_PADRAO nas pastas."""
    if not molde_instalado():
        # Sem o molde, todo lead daria "abaixo do padrão" e ficaria 30 dias de fora (14/10/2026: 32 marcados assim).
        log("Sem o molde do Raio-X (calculo_prumo, modelo_raio_x, precos.json, exemplo-raio-x.json): nenhum lead novo.")
        return []
    pausados = nao_gerar()
    candidatos = []
    validade = dt.timedelta(days=VALIDADE_CACHE_DIAS).total_seconds()
    for p in AUTO.iterdir():
        try:
            if (not p.is_dir() or p.name.startswith((".", "_")) or not (p / "content.md").is_file()
                    or (p / "publicado.json").exists() or (p / "DESCARTAR.md").exists()):
                continue
            # Abaixo do padrão há pouco: com o Places em cache, o resultado seria o mesmo; tenta de novo quando ele vence.
            recusa = p / SEM_PADRAO
            if recusa.exists() and dt.datetime.now().timestamp() - recusa.stat().st_mtime < validade:
                continue
            candidatos.append(((p / "content.md").stat().st_mtime, p))
        except OSError:
            continue
    saida = []
    for _, p in sorted(candidatos, key=lambda c: c[0], reverse=True):
        if len(saida) >= maximo:
            break
        dados = ler_content((p / "content.md").read_text(encoding="utf-8", errors="replace"))
        if not do_brasil(dados) or dados["campos"].get("place_id") in pausados:
            continue
        try:
            montar(p)
        except ValueError as e:
            log(f"{p.name}: sem Raio-X avulso ({e}).")
            if gravar:
                try:
                    (p / SEM_PADRAO).write_text(json.dumps({"motivo": str(e)[:500], "em": agora(), "versao": VERSAO},
                                                           ensure_ascii=False), encoding="utf-8")
                except OSError:
                    pass
            continue
        saida.append(p)
    return saida


def simular(pasta: Path) -> str:
    dados = ler_content((pasta / "content.md").read_text(encoding="utf-8", errors="replace"))
    d = diagnosticar(pasta, dados)
    linhas = [f"{pasta.name}: {dados['nome']} · nota {d['nota']} ({d['avaliacoes']}) · lido em {d['places_em'] or d['lido_em']}"]
    if d["site_hoje"]:
        linhas.append(f"  site do perfil hoje: {d['site_hoje']}")
    for conc in d["buscas"]:
        linhas.append(f"  busca: “{conc['consulta']}”, posição {conc['posicao']}, {conc['com_site']} de {len(conc['outros'])} com site")
    if not d["buscas"]:
        linhas.append("  busca: sem dados (sem chave do Places ou a API falhou)")
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
    if not (calculo_prumo and modelo_raio_x and PRECOS and EXEMPLO):
        log("calculo_prumo.py, modelo_raio_x.py, precos.json ou exemplo-raio-x.json não encontrado (nem em prumo-mapa/ ao lado nem em "
            "~/.local/share/prumo-mapa/): nenhum Raio-X sai. Instale: dell-status --instalados.")
    if a.html:
        try:
            dados, diag, pagina_html, _ = montar(AUTO / a.html)
        except ValueError as e:  # AbaixoDoPadrao diz o que falta
            print(simular(AUTO / a.html))
            print(f"sem página: {e}")
            return 1
        Path(a.saida or "raio-x.html").write_text(pagina_html, encoding="utf-8")
        print(simular(AUTO / a.html))
        return 0
    # `_em-conversa/SLUG`: o gerador chama assim depois do demo pedido de quem já respondeu.
    if any(not re.fullmatch(r"(?:_[a-z-]{1,30}/)?[a-z0-9][a-z0-9._-]{0,179}", s) for s in a.slugs):
        ap.error("SLUG é o nome da pasta na raiz de ~/auto-site (ou _em-conversa/SLUG)")
    alvos = pendentes(a.max, a.simular) if a.pendentes else [AUTO / s for s in a.slugs]
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


def places_exemplo(posicao: int | None = 7, outras: tuple = (3, 9)) -> dict:
    """Um raio-x-places.json de mentira (formato do cache, versão 2), com o lead na `posicao` da primeira busca
    e em `outras` nas outras duas (as consultas de consultas_das_buscas para o CONTENT_EXEMPLO)."""
    nomes = ["Alfa Advocacia", "Beta <script>x</script>", "Gama Advogados", "Delta Jurídico", "Épsilon Adv",
             "Zeta Advocacia", "Eta Advogados", "Teta Adv", "Iota Advocacia"]
    sites = ["https://alfa.adv.br", "", "https://www.instagram.com/gama", "https://delta.com.br", "", "https://zeta.adv.br",
             "", "", ""]
    def busca(consulta, pos):
        resultados = [{"id": f"ChIJoutro{i}", "nome": n, "nota": 4.6 + (i % 4) / 10, "avaliacoes": 40 + 10 * i,
                       "site": s, "status": "OPERATIONAL", "horario": i != 1} for i, (n, s) in enumerate(zip(nomes, sites))]
        resultados[3]["status"] = "CLOSED_PERMANENTLY"
        if pos:
            resultados.insert(pos - 1, {"id": "ChIJteste", "nome": "Higor", "nota": 5, "avaliacoes": 18,
                                        "site": "https://higorferreira.adv.br/", "status": "OPERATIONAL", "horario": True})
        return {"consulta": consulta, "resultados": resultados}
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
    return {"versao": 2, "place_id": "ChIJteste", "lido_em": "2026-10-08T10:00:00-03:00",
            "detalhes": {"nome": "Higor", "nota": 5, "avaliacoes": 18, "tipo": "Advogado",
                         "site": "https://higorferreira.adv.br/", "status": "OPERATIONAL",
                         "horario": ["segunda-feira: 08:00–18:30", "terça-feira: 08:00–18:30", "quarta-feira: 08:00–18:30",
                                     "quinta-feira: 08:00–18:30", "sexta-feira: 08:00–18:30", "sábado: Fechado",
                                     "domingo: Fechado"],
                         "maps": "https://maps.google.com/?cid=1", "textos": textos, "bairro": "Centro"},
            "buscas": [busca("advogado em Anápolis", posicao), busca("escritório de advocacia em Anápolis", outras[0]),
                       busca("melhor advogado em Anápolis", outras[1])]}


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
            self.assertEqual([b["titulo"] for b in d["bons"]],  # o 18 vira ponto, não bom; no máximo 3
                             ["Nota 5,0 no Google", "O telefone do perfil é celular", "Horário de funcionamento preenchido"])
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
                             ["O botão “Site” no Google leva para o Instagram", "Só 18 avaliações no Google",
                              "O horário de funcionamento não aparece no Google"])
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
        """Versão 5: o modelo aprovado do piloto CDL (modelo_raio_x), só com o que foi conferido."""

        def test_identidade_preco_link_e_escape(self):
            t = CONTENT_EXEMPLO.replace("# Higor Ferreira - Advogado", "# Bar <b>&</b> Cia")
            dados = ler_content(t)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7)), "https://demo-x.vercel.app/", True)
            self.assertIn("Bar &lt;b&gt;&amp;&lt;/b&gt; Cia", h)
            self.assertNotIn("<b>&</b>", h)
            self.assertIn("https://demo-x.vercel.app/og.jpg", h)
            self.assertIn(f"<body {MARCA}>", h)
            self.assertIn("3 pontos que mandam cliente para o concorrente", h)
            self.assertIn("lidos em 08/10/2026", h)
            for s in PRECOS["servicos"]:  # os quatro serviços, sem o preço: os preços vêm no fim do Mapa
                self.assertIn(f">{html.escape(s['nome'])}<", h[h.index('class="servicos-curto"'):])
                self.assertNotIn(html.escape(s["preco"]), h)
            self.assertIn("Os preços vêm no fim do Mapa.", h)
            self.assertNotIn("R$ 990", h)
            self.assertNotRegex(h.lower(), r"#(00f|0000ff|1e90ff|2563eb)|blue|border-radius:\s*[1-9]")
            self.assertTrue(h.rstrip().endswith("</html>"))

        def test_sem_og_nao_aponta_imagem(self):
            dados = ler_content(CONTENT_EXEMPLO)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7)), "https://demo-x.vercel.app", False)
            self.assertNotIn("og.jpg", h)
            self.assertIn('<meta property="og:title"', h)

        def test_abaixo_do_padrao_nao_sai(self):
            dados = ler_content(CONTENT_EXEMPLO)
            with self.assertRaises(AbaixoDoPadrao) as erro:  # sem o Places: sem buscas, comparação nem avaliações
                pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5), "https://demo-x.vercel.app", True)
            self.assertIn("buscas: exatamente 3, tem 0", str(erro.exception))
            p = places_exemplo(2, (1, 2))  # entre os 3 primeiros nas três buscas e o site no ar: 2 pontos só
            p["detalhes"]["avaliacoes"] = 25
            with self.assertRaises(AbaixoDoPadrao) as erro:
                pagina(dados, diagnostico(dados, "no_ar", "08/10/2026", 5, p), "https://demo-x.vercel.app", True)
            self.assertIn("pontos: exatamente 3", str(erro.exception))
            self.assertTrue(issubclass(AbaixoDoPadrao, ValueError))  # o montar e o --pendentes já tratam ValueError

        def test_so_afirma_o_que_conferiu(self):
            dados = ler_content(CONTENT_EXEMPLO)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7)), "https://demo-x.vercel.app", True)
            self.assertIn("Feito pelo PRUMO só com o que qualquer pessoa vê no Google, sem pedir nada a vocês.", h)
            self.assertNotIn("nas redes e nos anúncios, sem pedir", h)
            # As avaliações: as que o Google mostra primeiro, nas duas frases (e não "as mais recentes").
            self.assertIn("Lemos as 5 avaliações que o Google mostra primeiro no perfil de vocês", h)
            self.assertIn("As avaliações: as 5 que o Google mostra primeiro no perfil", h)
            self.assertNotIn("mais recentes", h)
            # Respostas às avaliações, redes e anúncios: não conferidos, nunca inventados.
            self.assertNotIn("têm resposta de vocês", h)
            self.assertNotIn("Responde às avaliações</td>", h)
            redes = h[h.index("<summary>Redes sociais</summary>"):h.index("<summary>Anúncios</summary>")]
            anuncios = h[h.index("<summary>Anúncios</summary>"):h.index("<summary>A nota e de onde vem cada dado</summary>")]
            for trecho in (redes, anuncios):
                self.assertIn('<li class="nc">', trecho)
                self.assertNotIn('<li class="ok">', trecho)
                self.assertNotIn('<li class="falta">', trecho)
            self.assertIn("As redes e os anúncios: não conferidos neste Raio-X", h)
            # O convite do Mapa em todo Raio-X (15/10/2026): o formulário, o Mapa de exemplo e nenhum preço.
            self.assertIn('<div class="mapa-convite"', h)
            self.assertIn(f'href="{MAPA_LINK}"', h)
            self.assertIn('href="https://prumo-piloto-cdl.vercel.app/mapa"', h)
            self.assertIn("Responder as 16 perguntas do Mapa", h)
            for s in PRECOS["servicos"]:  # o único R$ da página é o da calculadora
                self.assertNotIn(html.escape(s["preco"]), h)
            # O vocabulário interno e a fórmula da nota não aparecem (a trava do modelo).
            self.assertEqual(modelo_raio_x.conferir_pagina(h), [])

        def test_mesmo_esqueleto_do_exemplo_do_piloto(self):
            dados = ler_content(CONTENT_EXEMPLO)
            h = pagina(dados, diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7)), "https://demo-x.vercel.app", True)
            molde, _ = modelo_raio_x.raio_x(EXEMPLO, sys.modules[__name__], calculo_prumo, PRECOS)
            self.assertEqual(modelo_raio_x.conferir_esqueleto(h, molde), [])
            # Um bloco a menos (a comparação vazia, por exemplo) e a página não sai.
            sem = h.replace('<div class="comparacao">', '<div class="outra">')
            self.assertIn("falta o bloco “div.comparacao”, que o exemplo tem", modelo_raio_x.conferir_esqueleto(sem, molde))
            # A faixa é dado: o exemplo está em "Em construção", e um lead "Pouco visível" sai igual.
            baixa = h.replace("faixa-presenca faixa-media", "faixa-presenca faixa-baixa")
            self.assertEqual(modelo_raio_x.conferir_esqueleto(baixa, molde), [])

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
            self.assertEqual([b["posicao"] for b in buscas_lidas(places_exemplo(7, (3, None)), "ChIJteste")], [7, 3, None])
            self.assertEqual(len(buscas_lidas({"busca": places_exemplo()["buscas"][0]}, "ChIJteste")), 1)  # cache v1
            self.assertIsNone(concorrencia(None, "ChIJteste"))

        def test_diagnostico_com_places_compara_com_a_busca(self):
            dados = ler_content(CONTENT_EXEMPLO)
            d = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7, (3, None)))
            titulos = [p["titulo"] for p in d["pontos"]]
            self.assertEqual(titulos, ["7º lugar em “advogado em Anápolis”", "O site que aparece no Google não abre",
                                       "Só 18 avaliações no Google"])
            self.assertIn("vê 6 outros resultados antes de vocês", d["pontos"][0]["porque"])
            self.assertIn("Em “escritório de advocacia em Anápolis”, vocês estão em 3º; em “melhor advogado em Anápolis”, "
                          "não estão entre os 9 primeiros.", d["pontos"][0]["porque"])
            self.assertIn("relevância, distância e destaque", d["pontos"][0]["porque"])
            self.assertIn("1 dos 3 primeiros mostra site próprio", d["pontos"][1]["porque"])
            self.assertIn("no meio da lista, 60 avaliações", d["pontos"][2]["porque"])
            self.assertEqual([b["titulo"] for b in d["bons"]],
                             ["Nota 5,0 no Google", "3º lugar em “escritório de advocacia em Anápolis”",
                              "3 de 5 avaliações elogiam o atendimento"])
            self.assertIn("Os 5 primeiros de “advogado em Anápolis” têm entre 4,6 e 4,8. A nota de vocês está acima de todos",
                          d["bons"][0]["porque"])
            self.assertEqual(d["horario_resumo"], "aberto 5 dias por semana")
            # Entre os 3 primeiros nas três buscas não há ponto de posição.
            d = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(2, (1, 3)))
            self.assertFalse(any("lugar" in p["titulo"] for p in d["pontos"]))
            # Fora nas três: uma frase só para as outras duas.
            d = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(None, (None, None)))
            self.assertIn("Em “escritório de advocacia em Anápolis” e “melhor advogado em Anápolis”, também não.",
                          d["pontos"][0]["porque"])

        def test_avaliacoes_abaixo_da_metade_da_busca_viram_ponto_mesmo_acima_de_20(self):
            p = places_exemplo(2, (1, 2))
            p["detalhes"]["avaliacoes"] = 29
            d = diagnostico(ler_content(CONTENT_EXEMPLO), "no_ar", "08/10/2026", 5, p)
            self.assertIn("29 avaliações, menos da metade do que os primeiros da busca têm", [x["titulo"] for x in d["pontos"]])
            # Acima da metade dos 5, abaixo do meio dos 3 primeiros: o ponto mais leve, com os 3 números.
            p["detalhes"]["avaliacoes"] = 30
            d = diagnostico(ler_content(CONTENT_EXEMPLO), "no_ar", "08/10/2026", 5, p)
            self.assertEqual([x["titulo"] for x in d["pontos"]], ["30 avaliações, menos que os 3 primeiros da busca"])
            self.assertIn("os 3 primeiros têm 40, 50 e 60 avaliações", d["pontos"][0]["porque"])
            p["detalhes"]["avaliacoes"] = 61
            d = diagnostico(ler_content(CONTENT_EXEMPLO), "no_ar", "08/10/2026", 5, p)
            self.assertEqual(d["pontos"], [])  # site no ar, entre os 3 nas buscas, mais avaliações: nada a apontar

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

        def test_tres_buscas_escolhidas_antes_de_ver_o_resultado(self):
            self.assertEqual(consultas_das_buscas("Advogado", "advocacia", "Anápolis", "Higor Ferreira - Advogado"),
                             ["advogado em Anápolis", "escritório de advocacia em Anápolis", "melhor advogado em Anápolis"])
            # A área sai do nome (ou do tipo): a busca da área e a do serviço de valor dela.
            self.assertEqual(consultas_das_buscas("Consultoria", "advocacia", "Ribeirão Preto", "Silva Advocacia Previdenciária"),
                             ["advogado em Ribeirão Preto", "advogado previdenciário em Ribeirão Preto",
                              "advogado INSS em Ribeirão Preto"])
            self.assertEqual(consultas_das_buscas("Dentista", "odontologia", "Vitória", "OrtoVix Ortodontia")[1:],
                             ["ortodontista em Vitória", "aparelho ortodôntico em Vitória"])
            # Ramo fora da tabela: o termo, "melhor" e o bairro; sem bairro, só duas (e a trava barra a página).
            self.assertEqual(consultas_das_buscas("Serviços", "locação de equipamentos", "Goiânia", "X", "Setor Bueno"),
                             ["locação de equipamentos em Goiânia", "melhor locação de equipamentos em Goiânia",
                              "locação de equipamentos em Setor Bueno, Goiânia"])
            self.assertEqual(len(consultas_das_buscas("Serviços", "locação de equipamentos", "Goiânia")), 2)
            self.assertEqual(consultas_das_buscas("Advogado", "advocacia", ""), [])

        def test_horario_legivel_e_fim_do_atendimento(self):
            dias = places_exemplo()["detalhes"]["horario"]
            self.assertEqual(horario_legivel(dias), "segunda a sexta, 8h às 18h30")
            self.assertEqual(fecha_as(dias), "18h30")
            dias = [f"{d}: 08:00–12:00, 14:00–18:00" for d in ("segunda-feira", "terça-feira", "quarta-feira",
                                                                  "quinta-feira", "sexta-feira")]
            self.assertEqual(horario_legivel(dias + ["sábado: 08:00–12:00", "domingo: Fechado"]),
                             "segunda a sexta, 8h às 12h e 14h às 18h; sábado, 8h às 12h")
            self.assertEqual(horario_legivel(["segunda-feira: Atendimento 24 horas"] * 7), "aberto 24 horas, todos os dias")
            self.assertEqual(horario_legivel(["segunda-feira: com hora marcada"] * 7), "aberto 7 dias por semana")
            self.assertEqual(fecha_as(["x: 24 horas"] * 7), "")
            self.assertEqual(horario_legivel(None), "")

        def test_ler_demo(self):
            d = ler_demo(DEMO_EXEMPLO)
            self.assertEqual(d["secoes"], [{"id": "topo", "titulo": "Você já leu o seu contrato inteiro?"},
                                           {"id": "papeis", "titulo": "Os papéis que chegam & ficam"},
                                           {"id": "conversa", "titulo": "A primeira conversa"}])
            self.assertEqual((d["whatsapp"], d["whatsapp_com_texto"], d["telefone"], d["mapa"]), (2, True, True, True))
            self.assertEqual(ler_demo("")["secoes"], [])

        def test_perfil_so_marca_falta_com_o_fato(self):
            dados = ler_content(CONTENT_EXEMPLO.split("## Por que este lead")[0])
            itens = {x["item"]: x["estado"] for x in perfil_linhas(diagnostico(dados))}
            self.assertEqual(list(itens), ["Horário de funcionamento", "Telefone", "Fotos", "Categoria", "Botão “Site”"])
            self.assertEqual((itens["Horário de funcionamento"], itens["Fotos"], itens["Botão “Site”"]), ("nc", "nc", "nc"))
            dados = ler_content(CONTENT_EXEMPLO)
            itens = {x["item"]: x for x in perfil_linhas(diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo()))}
            self.assertEqual(itens["Botão “Site”"]["estado"], "falta")
            self.assertIn("higorferreira.adv.br não abriu em 08/10/2026", itens["Botão “Site”"]["detalhe"])
            self.assertEqual(itens["Horário de funcionamento"]["detalhe"], "segunda a sexta, 8h às 18h30")
            self.assertEqual((itens["Categoria"]["estado"], itens["Categoria"]["detalhe"]), ("ok", "Advogado"))
            p = places_exemplo()
            p["detalhes"]["tipo"] = "Consultoria"  # genérica: pode ser só a tabela do Places, não vira falta
            itens = {x["item"]: x for x in perfil_linhas(diagnostico(dados, "fora", "08/10/2026", 5, p))}
            self.assertEqual(itens["Categoria"]["estado"], "nc")

        def test_comparacao_com_os_3_primeiros(self):
            dados = ler_content(CONTENT_EXEMPLO)
            c = comparacao_com_os_3(diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7)))
            self.assertEqual(c["busca"], "advogado em Anápolis")
            self.assertEqual([(l["item"], l["voces"], l["eles"], l["perde"]) for l in c["linhas"]],
                             [("Nota no Google", "5,0", "4,6 · 4,7 · 4,8", False), ("Avaliações", "18", "50", True),
                              ("Site próprio", "não abre", "1 de 3", True), ("Horário no perfil", "sim", "2 de 3", False)])
            self.assertEqual(c["frase"], "A nota está no nível dos 3 primeiros. A diferença está nas avaliações e no site.")
            self.assertIsNone(comparacao_com_os_3(diagnostico(dados, "fora", "08/10/2026", 5)))

        def test_comparacao_completa_o_concorrente_pelas_outras_buscas(self):
            dados = ler_content(CONTENT_EXEMPLO)
            completo = comparacao_com_os_3(diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7)))
            p = places_exemplo(7)
            p["buscas"][0]["resultados"][0].update(nota=None, avaliacoes=None)  # o 1º sem nota só na primeira busca
            self.assertEqual(comparacao_com_os_3(diagnostico(dados, "fora", "08/10/2026", 5, p)), completo)
            for b in p["buscas"]:  # sem nota em busca nenhuma: as duas linhas saem, nada é inventado
                b["resultados"][0].update(nota=None, avaliacoes=None)
            itens = [l["item"] for l in comparacao_com_os_3(diagnostico(dados, "fora", "08/10/2026", 5, p))["linhas"]]
            self.assertNotIn("Nota no Google", itens)
            self.assertNotIn("Avaliações", itens)

        def test_o_que_fazer_resolve_cada_ponto_com_quem_faz(self):
            dados = ler_content(CONTENT_EXEMPLO)
            diag = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7))
            m = dados_do_modelo(dados, diag)
            self.assertEqual([(x["n"], x["titulo"], x["quem"]) for x in m["o_que_fazer"]],
                             [("01", "Pedir avaliação a quem saiu satisfeito", "Vocês mesmos, a partir de hoje."),
                              ("02", "Um site no lugar da página que não abre", "Um fornecedor de site de vocês, ou o PRUMO."),
                              ("03", "Anunciar para quem procura “advogado em Anápolis”",
                               "Quem cuida dos anúncios de vocês, ou o PRUMO.")])
            self.assertIn("Provimento 205/2021 da OAB", m["o_que_fazer"][2]["texto"])  # advocacia: sem promessa
            self.assertEqual(m["servicos_motivo"], {
                "site": "No Raio-X: o site do perfil não abriu quando conferimos.",
                "trafego": "No Raio-X: 7º lugar em “advogado em Anápolis”.",
                "produtos": "No Raio-X: o atendimento do perfil acaba às 18h30; o robô responde depois disso."})
            self.assertEqual(modelo_raio_x.conferir_raio_x(m, PRECOS, automatico=True), [])

        def test_pagina_completa_escapa_e_so_linka_https(self):
            dados = ler_content(CONTENT_EXEMPLO)
            diag = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7), ler_demo(DEMO_EXEMPLO))
            h = pagina(dados, diag, "https://demo-x.vercel.app", True)
            self.assertIn("<summary>A busca, em detalhe</summary>", h)
            self.assertIn("Fizemos 3 buscas que um cliente faria, escolhidas antes de ver o resultado, em 08/10/2026.", h)
            self.assertIn('<li class=voces><span class="pos">7º</span>', h)  # logo depois do 6º: entra na lista
            self.assertIn("site fora do ar", h)
            self.assertIn("Beta &lt;script&gt;x&lt;/script&gt;", h)
            self.assertNotIn("<script>x</script>", h)
            self.assertEqual(h.count("<script>"), 2)  # a calculadora da Nota de presença e a barra/medição
            self.assertIn('href="https://www.google.com/maps/contrib/1"', h)
            self.assertNotIn("javascript:", h)
            self.assertIn("O que os clientes dizem", h)
            self.assertIn("3 de 5", h)
            self.assertIn("lida em 08/10/2026", h)
            self.assertNotRegex(h.lower(), r"#(00f|0000ff|1e90ff|2563eb)|blue|border-radius:\s*[1-9]")
            # O 4º fechou: a lista pula do 3º para o 5º, sem renumerar.
            self.assertIn('<span class="pos">3º</span><span class="quem">Gama Advogados</span>', h)
            self.assertIn('<span class="pos">5º</span><span class="quem">Épsilon Adv</span>', h)

    class Presenca(unittest.TestCase):
        """Versão 3: a Nota de presença a partir do diagnóstico. Os limiares de cada bloco são
        testados no calculo_prumo.test.py; aqui, o que o Raio-X entrega ao módulo e mostra."""

        def test_modulo_achado_no_repo(self):
            self.assertIsNotNone(calculo_prumo, "prumo-mapa/calculo_prumo.py ao lado deste arquivo")
            self.assertIsNotNone(modelo_raio_x, "prumo-mapa/modelo_raio_x.py ao lado deste arquivo")
            self.assertEqual(PRECOS["whatsapp"], WHATSAPP_PRUMO)
            self.assertEqual([s["chave"] for s in PRECOS["servicos"]], ["site", "trafego", "redes", "produtos"])
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
            with self.assertRaises(AbaixoDoPadrao):  # e sem as buscas a página nem sai
                pagina(dados, d, "https://demo-x.vercel.app", True)

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
            self.assertIn('<label for="prumo-valor">', h)
            self.assertIn('inputmode="decimal"', h)
            self.assertIn("1 cliente a mais por mês × R$ ___ = R$ ___ por mês", h)
            # Na frente, a faixa e a nota com o link para o que ela quer dizer; a explicação, sem a fórmula, embaixo.
            ato1 = h[h.index('id="veredito"'):h.index('id="por-que"')]
            self.assertIn('<p class="faixa-rotulo">Em construção</p>', ato1)
            self.assertIn('class="prumo-fio"', ato1)
            self.assertIn("Nota de presença: <strong>10,8 de 18</strong>", ato1)
            self.assertIn('href="#a-nota"', ato1)
            nota = h[h.index('<details class="detalhe" id="a-nota">'):]
            self.assertIn("Nota de presença: 10,8 de 18", nota)
            self.assertIn("A fórmula é nossa", nota)
            self.assertLess(nota.index("Nota de presença"), nota.index("De onde vem cada dado"))
            for formula in ("de 0 a 3", "mediana", "proporcional", "cálculo PRUMO"):
                self.assertNotIn(formula, h)
            self.assertLess(h.index("pontos que mandam cliente"), h.index("<summary>A busca, em detalhe"))

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
        """Os três atos do modelo aprovado: veredito, por quê e o que fazer; o WhatsApp do PRUMO."""

        def setUp(self):
            dados = ler_content(CONTENT_EXEMPLO.replace("# Higor Ferreira - Advogado", "# Bar & Cia <Ltda>"))
            self.diag = diagnostico(dados, "fora", "08/10/2026", 5, places_exemplo(7), ler_demo(DEMO_EXEMPLO))
            self.dados = dados
            self.h = pagina(dados, self.diag, "https://demo-x.vercel.app", True)

        def test_os_tres_atos_na_ordem(self):
            h = self.h
            atos = [h.index(f'id="{a}"') for a in ("veredito", "por-que", "o-que-fazer")]
            self.assertEqual(atos, sorted(atos))
            ato1, ato2, ato3 = h[atos[0]:atos[1]], h[atos[1]:atos[2]], h[atos[2]:]
            for trecho in ("Como vocês aparecem para quem procura", "Bar &amp; Cia &lt;Ltda&gt;", 'class="nota"',
                           "faixa-presenca", "O que segura cliente", "O que perde cliente"):
                self.assertIn(trecho, ato1)
            # Ato 2: os pontos abertos e a comparação com os 3 primeiros, antes de qualquer detalhe.
            self.assertIn("3 pontos que mandam cliente para o concorrente", ato2)
            self.assertIn("Vocês e os 3 primeiros em “advogado em Anápolis”", ato2)
            self.assertIn('<p class="frase">', ato2)
            self.assertLess(ato2.index("pontos que mandam"), ato2.index("Vocês e os 3 primeiros"))
            self.assertLess(ato2.index("Vocês e os 3 primeiros"), ato2.index("<details"))
            # Ato 3: 3 coisas com quem faz, o convite do Mapa e os quatro serviços sem preço, cada um com o link.
            self.assertIn("3 coisas, nesta ordem", ato3)
            self.assertEqual(ato3.count('<p class="quem">'), 3)
            self.assertIn("Agora, o olhar por dentro: o Mapa", ato3)
            self.assertLess(ato3.index('class="mapa-convite"'), ato3.index('class="servicos-curto"'))
            self.assertEqual(ato3.count('href="https://wa.me/'), 4)
            self.assertNotIn('<article class="cartao', ato3)

        def test_detalhes_sao_details_fechados_na_ordem(self):
            h = self.h
            titulos = re.findall(r"<details class=\"detalhe[^\"]*\"(?: id=\"a-nota\")?><summary>([^<]+)</summary>", h)
            self.assertEqual(titulos, ["O que já está bom", "A busca, em detalhe", "O que os clientes dizem",
                                       "O perfil no Google, item por item", "Redes sociais", "Anúncios",
                                       "A nota e de onde vem cada dado"])
            self.assertEqual(h.count("<details"), 7)
            self.assertEqual(h.count("</details>"), 7)
            self.assertNotIn("<details open", h)  # fechados por padrão

        def test_botao_do_whatsapp_com_o_numero_novo_e_o_nome_na_mensagem(self):
            h = self.h
            texto = "Olá, PRUMO. Vi o Raio-X da Bar & Cia <Ltda> e quero falar de site."
            esperado = "https://wa.me/5527999762786?text=" + urllib.parse.quote(texto, safe="")
            self.assertIn(f'href="{html.escape(esperado)}"', h)
            self.assertNotIn("<Ltda>", h)  # o nome vai codificado no link e escapado no texto
            self.assertEqual(h.count(html.escape(esperado)), 1)  # a lista dos serviços; a barra do celular vai ao Mapa
            for servico in ("anúncios", "redes sociais", "whatsapp que responde"):
                resp = f"Olá, PRUMO. Vi o Raio-X da Bar & Cia <Ltda> e quero falar de {servico}."
                self.assertIn(html.escape("https://wa.me/5527999762786?text=" + urllib.parse.quote(resp, safe="")), h)
            for velho in ("5527997780954", "27997780954", "99778-0954", "997780954"):
                self.assertNotIn(velho, h)

        def test_sem_preco_e_nada_da_versao_4(self):
            h = self.h
            for s in PRECOS["servicos"]:  # com o Mapa, quem dá o preço é o Mapa (15/10/2026)
                self.assertNotIn(html.escape(s["preco"]), h)
            self.assertNotIn("Preços de outubro de 2026.", h)
            for velho in ("R$ 990", "Encontrado", "O caminho do cliente", "Montamos uma demonstração", "data-ato="):
                self.assertNotIn(velho, h)

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

            for diag in (self.diag, diagnostico(self.dados, "sem_nome", "08/10/2026", 5, places_exemplo(None, (None, 2)))):
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
                             "addressComponents": [{"longText": "Jundiaí", "types": ["sublocality_level_1", "sublocality"]},
                                                   {"longText": "Anápolis", "types": ["administrative_area_level_2"]}],
                             "reviews": [{"rating": 5, "text": {"text": "Muito atencioso."},
                                          "authorAttribution": {"displayName": "Ana", "uri": "https://x"},
                                          "relativePublishTimeDescription": "há 1 mês"}],
                             "location": {"latitude": -16.3, "longitude": -48.9}, "nationalPhoneNumber": "(62) 9"}
            return 200, {"places": [{"id": "ChIJteste", "displayName": {"text": "Higor"}, "rating": 5, "userRatingCount": 19},
                                    {"id": "ChIJa", "displayName": {"text": "A"}, "rating": 4.5, "userRatingCount": 9,
                                     "websiteUri": "https://a.com", "businessStatus": "OPERATIONAL",
                                     "regularOpeningHours": {"weekdayDescriptions": ["segunda-feira: Fechado"]}}]}

        def test_quatro_chamadas_cache_sem_a_chave_e_sem_dado_a_mais(self):
            agora_ = dt.datetime(2026, 10, 8, 10, 0, tzinfo=dt.timezone(dt.timedelta(hours=-3)))
            p = ler_places(self.raiz, self.dados, "CHAVE-SECRETA", agora_, self.pedir)
            self.assertEqual(len(self.chamadas), 4)
            self.assertTrue(self.chamadas[0][0].startswith("places/ChIJteste?"))
            self.assertEqual(self.chamadas[0][1], CAMPOS_DETALHES)
            self.assertEqual([c[2]["textQuery"] for c in self.chamadas[1:]],
                             ["advogado em Anápolis", "escritório de advocacia em Anápolis", "melhor advogado em Anápolis"])
            self.assertTrue(all(c[1] == CAMPOS_BUSCA and "regularOpeningHours" in c[1] for c in self.chamadas[1:]))
            self.assertEqual(p["detalhes"]["avaliacoes"], 19)
            self.assertEqual(p["detalhes"]["bairro"], "Jundiaí")
            self.assertEqual([r["horario"] for r in p["buscas"][0]["resultados"]], [False, True])
            guardado = (self.raiz / CACHE_PLACES).read_text(encoding="utf-8")
            self.assertNotIn("CHAVE-SECRETA", guardado)
            self.assertNotIn("latitude", guardado)
            self.assertNotIn("(62) 9", guardado)
            # Dentro de 30 dias o cache vale, até sem chave; depois, pede de novo.
            self.assertEqual(ler_places(self.raiz, self.dados, None, agora_ + dt.timedelta(days=29), self.pedir), p)
            self.assertEqual(len(self.chamadas), 4)
            self.assertIsNone(ler_places(self.raiz, self.dados, None, agora_ + dt.timedelta(days=31), self.pedir))
            ler_places(self.raiz, self.dados, "CHAVE-SECRETA", agora_ + dt.timedelta(days=31), self.pedir)
            self.assertEqual(len(self.chamadas), 8)

        def test_cache_da_versao_4_com_uma_busca_so_nao_vale(self):
            agora_ = dt.datetime(2026, 10, 8, 10, 0, tzinfo=dt.timezone(dt.timedelta(hours=-3)))
            velho = places_exemplo()
            velho["versao"], velho["busca"] = 1, velho.pop("buscas")[0]
            (self.raiz / CACHE_PLACES).write_text(json.dumps(velho), encoding="utf-8")
            self.assertIsNone(ler_places(self.raiz, self.dados, None, agora_, self.pedir))
            p = ler_places(self.raiz, self.dados, "k", agora_, self.pedir)
            self.assertEqual((p["versao"], len(p["buscas"])), (VERSAO_CACHE, 3))

        def test_sem_chave_ou_com_a_api_fora_nao_ha_places(self):
            self.assertIsNone(ler_places(self.raiz, self.dados, None, pedir=self.pedir))
            self.assertEqual(self.chamadas, [])
            self.assertIsNone(ler_places(self.raiz, self.dados, "k", pedir=lambda *a, **k: (403, None)))
            self.assertFalse((self.raiz / CACHE_PLACES).exists())
            # Busca fora, detalhes ok: avaliações sim, concorrência não.
            def meio(caminho, campos, chave, corpo=None):
                return self.pedir(caminho, campos, chave, corpo) if caminho.startswith("places/") else (500, None)
            p = ler_places(self.raiz, self.dados, "k", pedir=meio)
            self.assertEqual(p["buscas"], [])
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
            # O Places já lido (cache de hoje na pasta): sem ele, a página fica abaixo do padrão e não sai.
            cache = dict(places_exemplo(7), lido_em=dt.datetime.now().astimezone().isoformat(timespec="seconds"))
            (self.pasta / CACHE_PLACES).write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
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
                             ("https://demo-higor.vercel.app/raio-x", 3, VERSAO, "ChIJteste", "https://demo-higor.vercel.app"))
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

    class Avulso(Publicar):
        """Demo sob pedido (14/10/2026): sem demo, o Raio-X vai para o projeto avulso e cria o recibo."""

        def setUp(self):
            super().setUp()
            global AVULSO_PASTA, FUNIL
            self.antes_avulso = (AVULSO_PASTA, FUNIL)
            AVULSO_PASTA, FUNIL = self.raiz / "prumo-raio-x", self.raiz / "funil.json"
            (AVULSO_PASTA / ".vercel").mkdir(parents=True)
            (AVULSO_PASTA / ".vercel/project.json").write_text(json.dumps({"projectName": AVULSO_PROJETO}))
            (AVULSO_PASTA / "roda-mais.html").write_text("feito à mão")
            (self.pasta / "publicado.json").unlink()
            (self.pasta / "index.html").unlink()
            (self.pasta / "og.jpg").unlink()
            (self.raiz / SOB_PEDIDO).write_text("")
            self.deploys = []

        def tearDown(self):
            global AVULSO_PASTA, FUNIL
            AVULSO_PASTA, FUNIL = self.antes_avulso
            super().tearDown()

        def deploy_avulso(self, pasta, log_lead):
            self.assertEqual(pasta, AVULSO_PASTA)
            self.deploys.append(sorted(p.name for p in pasta.glob("*.html")))
            for f in pasta.glob("*.html"):
                self.no_ar[f"{AVULSO_URL}/{f.stem}"] = (200, f.read_bytes())
            return AVULSO_URL

        def test_sem_demo_publica_avulso_e_cria_o_recibo_sem_site_url(self):
            ok, url = publicar(self.pasta, self.deploy_avulso)
            self.assertTrue(ok, url)
            self.assertEqual(url, f"{AVULSO_URL}/higor")
            self.assertEqual(self.deploys, [["higor.html", "roda-mais.html"]])  # a página feita à mão continua no deploy
            r = self.recibo()
            self.assertEqual((r["place_id"], r["raio_x_url"], r["raio_x_pontos"], r["raio_x_projeto"]),
                             ("ChIJteste", url, 3, AVULSO_PROJETO))
            self.assertNotIn("site_url", r)
            h = (AVULSO_PASTA / "higor.html").read_text(encoding="utf-8")
            self.assertNotIn("neste mesmo endereço", h)
            self.assertNotIn("og:image", h)

        def test_depois_do_demo_republica_no_mesmo_endereco_citando_o_demo(self):
            publicar(self.pasta, self.deploy_avulso)
            r = self.recibo()
            r.update({"site_url": "https://demo-higor.vercel.app", "vercel_project": "demo-higor"})
            (self.pasta / "publicado.json").write_text(json.dumps(r), encoding="utf-8")
            (self.raiz / SOB_PEDIDO).unlink()  # o recibo avulso basta, com o modo desligado
            ok, url = publicar(self.pasta, self.deploy_avulso)
            self.assertTrue(ok, url)
            self.assertEqual(url, f"{AVULSO_URL}/higor")
            self.assertIn("demo-higor.vercel.app", (AVULSO_PASTA / "higor.html").read_text(encoding="utf-8"))
            self.assertEqual(self.recibo()["site_url"], "https://demo-higor.vercel.app")

        def test_deploy_que_falha_tira_a_pagina_da_pasta(self):
            def quebra(pasta, log_lead):
                raise RuntimeError("vercel fora")
            with self.assertRaises(RuntimeError):
                publicar(self.pasta, quebra)
            self.assertFalse((AVULSO_PASTA / "higor.html").exists())
            self.assertFalse((self.pasta / "publicado.json").exists())

        def test_sem_o_modo_lead_sem_demo_nao_tem_raio_x(self):
            (self.raiz / SOB_PEDIDO).unlink()
            ok, msg = publicar(self.pasta, lambda *a: self.fail("não podia publicar"))
            self.assertFalse(ok)
            self.assertIn("site_url", msg)

        def test_novos_sem_demo_pula_pausado_estrangeiro_e_abaixo_do_padrao(self):
            self.assertEqual([p.name for p in novos_sem_demo(10)], ["higor"])
            FUNIL.write_text(json.dumps({"nao_gerar": [{"place_id": "ChIJteste"}]}))
            self.assertEqual(novos_sem_demo(10), [])
            FUNIL.unlink()
            fraco = self.raiz / "fraco"  # sem o cache do Places: abaixo do padrão
            fraco.mkdir()
            (fraco / "content.md").write_text(CONTENT_EXEMPLO.replace("ChIJteste", "ChIJfraco"), encoding="utf-8")
            self.assertEqual([p.name for p in novos_sem_demo(10)], ["higor"])
            self.assertTrue((fraco / SEM_PADRAO).is_file())
            fora = self.raiz / "fora"
            fora.mkdir()
            (fora / "content.md").write_text(CONTENT_EXEMPLO.replace("Brasil", "Estados Unidos"), encoding="utf-8")
            self.assertEqual([p.name for p in novos_sem_demo(10)], ["higor"])
            # O --simular não marca ninguém (14/10/2026: a primeira simulação marcou 32 leads).
            (fraco / SEM_PADRAO).unlink()
            self.assertEqual([p.name for p in novos_sem_demo(10, gravar=False)], ["higor"])
            self.assertFalse((fraco / SEM_PADRAO).exists())

        def test_sem_o_molde_nenhum_lead_novo_e_ninguem_marcado(self):
            global EXEMPLO
            antes, EXEMPLO = EXEMPLO, None
            try:
                self.assertEqual(novos_sem_demo(10), [])
                self.assertFalse((self.pasta / SEM_PADRAO).exists())
            finally:
                EXEMPLO = antes

        def test_nome_avulso_curto_e_sem_colisao(self):
            longo = "advogado-em-maringa-advocacia-beneton-atendimento-nacional-busca-e-apreensao-revisoes"
            self.assertLessEqual(len(nome_avulso(longo, {})), TAMANHO_DO_NOME)
            self.assertFalse(nome_avulso(longo, {}).endswith("-"))
            self.assertEqual(nome_avulso("roda-mais", {}), "roda-mais-2")
            self.assertEqual(nome_avulso("x", {"raio_x_projeto": AVULSO_PROJETO, "raio_x_url": f"{AVULSO_URL}/roda-mais"}),
                             "roda-mais")

        # Herdados do Publicar que supõem demo: não valem aqui.
        test_publica_os_bytes_conferidos_e_grava_os_campos_sem_perder_os_outros = None
        test_index_ou_og_diferente_do_que_esta_no_ar_nao_publica = None
        test_demo_apagado_nao_publica = None
        test_raio_x_que_nao_responde_ou_e_antigo_nao_grava_o_campo = None
        test_alias_diferente_nao_grava_o_campo = None
        test_pendentes_so_pronto_na_raiz_sem_raio_x_e_nunca_com_o_gerador_rodando = None

    suite = unittest.TestSuite()
    for c in (Leitura, Diagnostico, Pagina, Profundo, Presenca, TresAtos, Places, Publicar, Avulso):
        suite.addTests(unittest.defaultTestLoader.loadTestsFromTestCase(c))
    return 0 if unittest.TextTestRunner(verbosity=2).run(suite).wasSuccessful() else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
