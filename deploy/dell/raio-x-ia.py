#!/usr/bin/env python3
"""Raio-X de IA, fase 1 (só mede): o ChatGPT e o Gemini recomendam o lead? (Dell, 15/10/2026)

A ideia (sessão de estratégia do PRUMO, 15/10/2026): o Raio-X grátis acha 1–2 pontos e o funil
tem 221 envios, 5 interesses e 0 propostas. Um gancho mais concreto para o Encontrado é mostrar ao
dono o que um assistente com busca na web responde a "qual o melhor <ofício> em <cidade>?" e quem é
citado no lugar dele. Antes de pôr isso numa página, esta fase só mede: o lead aparece? quem domina?
a resposta é estável entre execuções? quanto custa e quanto demora?

Nada aqui publica, grava na pasta do lead ou mexe no Raio-X no ar (`raio-x.py`): lê o `content.md` e
o `raio-x-places.json` do lead (o termo e a cidade são os de uma busca que o Raio-X já fez no Places,
`escolher_busca`, para comparar a IA com o Maps na mesma pergunta) e grava um JSON fora do repo.

Medição de 15/10/2026 (10 leads × 2 assistentes × 3 rodadas): o lead apareceu em 4 de 30 respostas do
Gemini e 1 de 30 do ChatGPT, só nos 2 leads que já estavam no top 10 do Places; a lista muda muito entre
rodadas. Resumo completo nas notas da sessão e no `resumo` do JSON da medição.

Dois assistentes, cada um com busca na web:

- Gemini (`generateContent` com a ferramenta `google_search`), com a chave do Gemini que o SquadOne
  já usa no Dell (`GEMINI_API_KEY` do ambiente, ou do `~/.config/squadone/operations.env`). Custo: os
  tokens do flash e, no Gemini 3, cada busca que o modelo faz (`webSearchQueries`) conta na franquia
  de grounding (5.000 por mês, depois US$ 14 por 1.000 buscas; conferir na página de preços).
- ChatGPT pelo `codex exec` com o login do ChatGPT (como a Luna, `server/luna-sombra.ts`): sem custo
  de API, gasta a cota do plano. `--search` liga a busca nativa; shell, plugins, skills, apps e
  navegador ficam desligados e a config do usuário não é lida, para a resposta sair só da busca (com
  eles ligados, o agente foi ler skills e rodar comandos antes de responder). O ambiente do filho é só
  HOME/PATH/LANG: as chaves do Dell não vão para ele.

A pergunta é a de um cliente comum, mais um pedido de repetir os nomes citados numa última linha
`NOMES: a | b | c`, para extrair sem modelo. Sem essa linha, valem os nomes em negrito.

Uso: raio-x-ia --auto 10 [--repeticoes 3] [--saida F]   escolhe 10 leads com raio-x-places.json (ramos variados)
     raio-x-ia SLUG... [--repeticoes 3] [--saida F]     estes leads (pasta na raiz ou em _em-conversa)
     raio-x-ia --resumir F                              só o resumo de uma medição já gravada
     opções: --assistentes gemini,codex  --raiz ~/auto-site

Saída padrão: ~/prumo-entregas/raio-x-ia/medicao-<data-hora>.json, gravada a cada consulta (uma
medição interrompida não se perde). Testes: python3 deploy/dell/raio-x-ia.test.py
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
import unicodedata
import urllib.error
import urllib.request
from pathlib import Path

VERSAO = 1
MODELO_GEMINI = "gemini-3.7-flash"
# O modelo padrão do codex no Dell (config.toml), escrito aqui porque a config do usuário não é lida.
MODELO_CODEX = "gpt-6-sol"
TIMEOUT_S = 180
# Gemini 3: franquia de 5.000 buscas por mês, depois US$ 14 por 1.000 (fontes secundárias, 15/10/2026;
# conferir em ai.google.dev/gemini-api/docs/pricing). Só para a estimativa do resumo.
US_POR_BUSCA_GEMINI = 14 / 1000

PERGUNTA = "Qual a melhor opção de {termo} em {cidade}? Me indique nomes."
INSTRUCAO_NOMES = ("Na última linha, escreva só: NOMES: nome 1 | nome 2 | ... com os estabelecimentos ou "
                   "profissionais que você citou, na ordem em que aparecem.")

# Recursos do codex desligados: a resposta tem de vir só da busca na web, como no ChatGPT.
RECURSOS_DESLIGADOS = ["shell_tool", "unified_exec", "plugins", "apps", "multi_agent", "browser_use",
                       "computer_use", "skill_search", "image_generation", "hooks"]


# --- PURO: pergunta ------------------------------------------------------------------------------

def termo_e_cidade(consulta: str, cidade: str = "") -> tuple[str, str] | None:
    """A primeira busca do Raio-X ("advogado trabalhista em Maringá") vira (termo, cidade). A cidade do
    content.md manda quando a consulta termina nela; senão, corta no último " em "."""
    consulta = (consulta or "").strip()
    cidade = (cidade or "").strip()
    if not consulta:
        return None
    if cidade and consulta.lower().endswith(f" em {cidade.lower()}"):
        termo = consulta[: -len(f" em {cidade}")].strip()
        return (termo, cidade) if termo else None
    if " em " not in consulta:
        return (consulta, cidade) if cidade else None
    termo, _, resto = consulta.rpartition(" em ")
    termo, resto = termo.strip(), resto.strip()
    return (termo, resto) if termo and resto else None


def montar_pergunta(termo: str, cidade: str) -> str:
    return f"{PERGUNTA.format(termo=termo.strip(), cidade=cidade.strip())}\n\n{INSTRUCAO_NOMES}"


# --- PURO: nomes ---------------------------------------------------------------------------------

def sem_acento(texto: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFKD", texto or "") if not unicodedata.combining(c))


def normalizar(nome: str) -> str:
    texto = sem_acento(nome).lower().replace("&", " e ")
    return " ".join(re.findall(r"[a-z0-9]+", texto))


def _limpar_nome(bruto: str) -> str:
    """Tira o markdown que os dois assistentes põem em volta do nome: link, negrito, numeração, e o
    que vem depois de um travessão ou dois-pontos ("**Fulano Advocacia**: atende...")."""
    texto = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", bruto)
    texto = re.sub(r"[*_`]+", "", texto)
    texto = re.sub(r"^\s*(?:\d+[.)]|[-•])\s*", "", texto)
    texto = re.split(r"\s+[–—-]\s+|:\s", texto, maxsplit=1)[0]
    return texto.strip(" \t.;,:\"'“”")


def _sem_repetir(nomes: list[str]) -> list[str]:
    vistos, saida = set(), []
    for n in nomes:
        chave = normalizar(n)
        if n and chave and chave not in vistos and len(n) <= 120:
            vistos.add(chave)
            saida.append(n)
    return saida


def extrair_nomes(texto: str) -> tuple[list[str], str]:
    """(nomes na ordem, de onde vieram): a última linha "NOMES:" quando existe; senão, os trechos em
    negrito que não são cabeçalho (terminam em ":" ou são frase longa). "nenhum" quando não achou."""
    linhas = [l for l in (texto or "").splitlines() if re.match(r"^\W*NOMES\W*:", l.strip(), re.I)]
    if linhas:
        corpo = re.split(r"NOMES\W*:", linhas[-1], maxsplit=1, flags=re.I)[1]
        nomes = _sem_repetir([_limpar_nome(p) for p in corpo.split("|")])
        if nomes:
            return nomes, "linha"
    negritos = []
    for m in re.finditer(r"\*\*(.+?)\*\*", texto or ""):
        bruto = m.group(1).strip()
        if bruto.endswith(":") or len(bruto.split()) > 8:
            continue
        negritos.append(_limpar_nome(bruto))
    nomes = _sem_repetir(negritos)
    return (nomes, "negrito") if nomes else ([], "nenhum")


# Palavras que não distinguem uma empresa da outra: o ofício, a forma jurídica, ligação. Sem tirar,
# "Advocacia Lacerda" não casaria com "Lacerda Advogados" e "Construtora da Ilha" casaria com qualquer
# construtora. Comparadas já normalizadas (sem acento, minúsculas).
GENERICAS = set("""
de da do das dos e em a o as os the and of no na nos nas para com por
ltda me eireli epp sa s/a cia companhia grupo
advocacia advogado advogados advogada advogadas escritorio juridico juridica associados associadas
assessoria consultoria dr dra doutor doutora
clinica clinicas consultorio odontologia odontologica odontologico odonto dental oral implantes ortodontia
dentista dentistas centro instituto especializada especializado atendimento
saude medica medico estetica fisioterapia psicologia psicologo psicologa
construtora construcoes construcao engenharia empreiteira empreiteiro reformas reforma reparos reparo
manutencao servicos servico solucoes projetos obras obra arquitetura
oficina mecanica auto center automotivo pecas loja comercio distribuidora
locacoes locacao aluguel equipamentos cacamba cacambas containers container entulho maquinas
encanador encanadores eletricista eletricistas eletrica eletrico hidraulica hidraulico caca vazamentos vazamento
desentupidora desentupidoras desentupimento desentupidor dedetizadora dedetizacao dedetizadoras
controle integrado pragas urbanas limpeza fossa higienizacao pintor pinturas pintura
pet shop veterinaria veterinario
contabilidade contabil contador
imobiliaria imoveis corretor
salao beleza barbearia
""".split())


def tokens(nome: str) -> set[str]:
    return set(normalizar(nome).split())


def nucleo(nome: str, cidade: str = "") -> set[str]:
    """O que distingue o nome: sem as palavras genéricas, sem a cidade e sem tokens de 1 letra. Quando
    não sobra nada ("Reformas e Reparos"), o nome inteiro (sem ligação) é o núcleo."""
    todos = tokens(nome)
    da_cidade = tokens(cidade)
    nucleo_ = {t for t in todos if t not in GENERICAS and t not in da_cidade and len(t) > 1}
    return nucleo_ or {t for t in todos if len(t) > 1 and t not in {"de", "da", "do", "e", "em"}}


def casa_com_lead(candidato: str, lead: str, cidade: str = "") -> bool:
    """O nome citado é o lead? Dois caminhos, os dois pelo núcleo (o que distingue):

    - todo o núcleo do lead está no nome citado ("Alemão Reparos" ⊂ "Alemão Reparos e Serviços");
    - ou o núcleo do citado tem 2+ palavras e todas estão no nome do lead: nomes do Google cheios de
      palavra-chave ("Advogado em Maringá | Advocacia Beneton | Busca e Apreensão") são citados curtos
      ("Beneton Advocacia" tem núcleo de 1 palavra: aí vale o primeiro caminho ao contrário, abaixo).

    Núcleo de uma palavra só no citado casa se for essa mesma a única palavra do núcleo do lead, ou se
    tiver 5+ letras e aparecer no nome do lead (sobrenome: "Beneton"). Conservador de propósito: um
    "sim" errado no Raio-X seria pior que um "não" (RULES 2)."""
    nl, nc = nucleo(lead, cidade), nucleo(candidato, cidade)
    tc, tl = tokens(candidato), tokens(lead)
    if not nl or not nc:
        return False
    if nl <= tc:
        return True
    if len(nc) >= 2 and nc <= tl:
        return True
    if len(nc) == 1:
        (unico,) = nc
        return nl == nc or (len(unico) >= 5 and unico in tl and len(nl) >= 3)
    return False


def posicao_do_lead(nomes: list[str], lead: str, cidade: str = "") -> int | None:
    """1 = primeiro citado; None = não citado."""
    for i, n in enumerate(nomes, 1):
        if casa_com_lead(n, lead, cidade):
            return i
    return None


def mencionado_no_texto(texto: str, lead: str, cidade: str = "") -> bool:
    """Sinal secundário: o núcleo do lead inteiro aparece em algum lugar da resposta (pega o lead
    citado fora da linha NOMES)."""
    nl = nucleo(lead, cidade)
    palavras = set(normalizar(texto).split())
    return bool(nl) and nl <= palavras


def jaccard(a: set, b: set) -> float:
    if not a and not b:
        return 1.0
    return len(a & b) / len(a | b)


def estabilidade(execucoes: list[list[str]]) -> float | None:
    """Média do Jaccard entre cada par de execuções (nomes normalizados). 1 = sempre os mesmos nomes."""
    conjuntos = [{normalizar(n) for n in e} for e in execucoes]
    pares = [jaccard(conjuntos[i], conjuntos[j]) for i in range(len(conjuntos)) for j in range(i + 1, len(conjuntos))]
    return round(sum(pares) / len(pares), 3) if pares else None


def no_places(nome: str, resultados: list[dict], cidade: str = "", ate: int = 10) -> int | None:
    """Posição (1..ate) do nome citado na busca do Places do Raio-X; None se não está lá."""
    for i, r in enumerate(resultados[:ate], 1):
        if casa_com_lead(nome, r.get("nome") or "", cidade) or casa_com_lead(r.get("nome") or "", nome, cidade):
            return i
    return None


def resumir(medicao: dict) -> dict:
    """Os números para o Rômulo decidir: por assistente, quantas vezes o lead apareceu, estabilidade,
    tempo, custo e quem domina (os mais citados entre todas as respostas, por lead)."""
    consultas = medicao.get("consultas", [])
    leads = {l["slug"]: l for l in medicao.get("leads", [])}
    saida: dict = {"leads": len(leads), "por_assistente": {}, "por_lead": {}}
    for assistente in sorted({c["assistente"] for c in consultas}):
        cs = [c for c in consultas if c["assistente"] == assistente]
        ok = [c for c in cs if c.get("ok")]
        citado = [c for c in ok if c.get("posicao_do_lead")]
        no_texto = [c for c in ok if c.get("mencionado_no_texto")]
        leads_citados = sorted({c["slug"] for c in citado})
        estabs = []
        for slug in leads:
            ex = [c["nomes"] for c in ok if c["slug"] == slug]
            e = estabilidade(ex)
            if e is not None:
                estabs.append(e)
        segs = [c["segundos"] for c in ok if c.get("segundos") is not None]
        buscas = [c.get("buscas_feitas") or 0 for c in ok]
        com_places = [c for c in ok if c.get("nomes")]
        top3 = sum(1 for c in com_places for p in c.get("no_places", []) if p and p <= 3)
        total_nomes = sum(len(c.get("nomes") or []) for c in ok)
        bloco = {
            "consultas": len(cs),
            "ok": len(ok),
            "falhas": sorted({c.get("erro") or "?" for c in cs if not c.get("ok")}),
            "lead_citado": len(citado),
            "lead_no_texto": len(no_texto),
            "leads_citados_ao_menos_uma_vez": leads_citados,
            "nomes_por_resposta": round(total_nomes / len(ok), 1) if ok else None,
            "nomes_que_estao_no_top3_do_places": f"{top3} de {total_nomes}",
            "nomes_sem_linha": sum(1 for c in ok if c.get("fonte_dos_nomes") != "linha"),
            "estabilidade_media": round(sum(estabs) / len(estabs), 3) if estabs else None,
            "segundos_mediana": round(statistics.median(segs), 1) if segs else None,
            "segundos_max": round(max(segs), 1) if segs else None,
            "buscas_por_consulta": round(sum(buscas) / len(buscas), 1) if buscas else None,
        }
        if assistente == "gemini":
            bloco["us_por_consulta_grounding"] = round(bloco["buscas_por_consulta"] * US_POR_BUSCA_GEMINI, 4) if buscas else None
            toks = [((c.get("uso") or {}).get("totalTokenCount") or 0) for c in ok]
            bloco["tokens_por_consulta"] = round(sum(toks) / len(toks)) if toks else None
        else:
            toks = [((c.get("uso") or {}).get("input_tokens") or 0) + ((c.get("uso") or {}).get("output_tokens") or 0) for c in ok]
            bloco["tokens_por_consulta"] = round(sum(toks) / len(toks)) if toks else None
        saida["por_assistente"][assistente] = bloco
    for slug, lead in leads.items():
        cont: dict[str, list] = {}
        for c in consultas:
            if c["slug"] != slug or not c.get("ok"):
                continue
            for n in c.get("nomes") or []:
                cont.setdefault(normalizar(n), [n, set()])[1].add(f'{c["assistente"]}#{c["rodada"]}')
        dominam = sorted(cont.values(), key=lambda v: (-len(v[1]), v[0]))[:5]
        saida["por_lead"][slug] = {
            "nome": lead["nome"],
            "pergunta": f'{lead["termo"]} em {lead["cidade"]}',
            "citado": {a: f'{sum(1 for c in consultas if c["slug"] == slug and c["assistente"] == a and c.get("posicao_do_lead"))}'
                          f'/{sum(1 for c in consultas if c["slug"] == slug and c["assistente"] == a and c.get("ok"))}'
                       for a in sorted({c["assistente"] for c in consultas})},
            "mais_citados": [f"{n} ({len(onde)}x)" for n, onde in dominam],
        }
    return saida


# --- PURO: leitura do lead -----------------------------------------------------------------------

def ler_content(texto: str) -> dict:
    """Nome (o título) e os campos "- **Campo:** valor" do content.md do Caçador."""
    dados: dict = {}
    for linha in (texto or "").splitlines():
        if linha.startswith("# ") and "nome" not in dados:
            dados["nome"] = linha[2:].strip()
        m = re.match(r"^- \*\*([^*]+):\*\*\s*(.*)$", linha)
        if m:
            dados[m.group(1).strip()] = m.group(2).strip()
    return dados


# Tipos do Places que ninguém digitaria ("consultoria em Ribeirão Preto" para uma advogada): o cache
# antigo do Raio-X (v2, uma busca só) ainda os tem. Sem pergunta que um cliente faria, o lead fica fora.
TERMOS_VAGOS = {"consultoria", "fabricante", "servicos", "loja", "empresa", "escritorio"}


def escolher_busca(places: dict) -> dict:
    """A busca do Raio-X que vira a pergunta. Desde a v5 são três (`buscas`): a do ramo, a da área (ou
    o outro jeito de pedir) e a "melhor <termo>". Vale a segunda quando não é a "melhor ...": para uma
    advogada previdenciária, "advogado previdenciário em X" é a pergunta do cliente dela, e o genérico
    "advogado em X" numa cidade grande quase nunca a citaria. O cache antigo (v2) tem só `busca`."""
    buscas = [b for b in (places.get("buscas") or []) if isinstance(b, dict) and b.get("consulta")]
    if len(buscas) >= 2 and not buscas[1]["consulta"].lower().startswith("melhor "):
        return buscas[1]
    if buscas:
        return buscas[0]
    return places.get("busca") or {}


def lead_da_pasta(slug: str, content: dict, places: dict | None) -> dict | None:
    """O que a medição precisa do lead, ou None se não dá para montar a pergunta (sem busca do Places,
    sem cidade, termo vago). O termo é o de uma busca que o Raio-X já fez: assim a resposta da IA se
    compara com o Places da mesma pergunta."""
    places = places or {}
    busca = escolher_busca(places)
    cidade = content.get("Cidade") or ""
    tc = termo_e_cidade(busca.get("consulta") or "", cidade)
    if not tc or normalizar(tc[0]) in TERMOS_VAGOS:
        return None
    nome = (places.get("detalhes") or {}).get("nome") or content.get("nome") or ""
    if not nome:
        return None
    return {"slug": slug, "nome": nome, "termo": tc[0], "cidade": tc[1],
            "vertical": content.get("Vertical") or "",
            "places_top": [{"nome": r.get("nome"), "nota": r.get("nota"), "avaliacoes": r.get("avaliacoes")}
                           for r in (busca.get("resultados") or [])[:10]]}


def escolher_variados(leads: list[dict], n: int) -> list[dict]:
    """n leads com ramos variados: um de cada vertical por vez, na ordem em que vieram."""
    por_vertical: dict[str, list] = {}
    for l in leads:
        por_vertical.setdefault(normalizar(l.get("vertical") or "?"), []).append(l)
    saida: list[dict] = []
    while len(saida) < n and any(por_vertical.values()):
        for v in list(por_vertical):
            if por_vertical[v] and len(saida) < n:
                saida.append(por_vertical[v].pop(0))
    return saida


# --- PURO: respostas -----------------------------------------------------------------------------

def ler_resposta_gemini(r: dict) -> dict:
    cand = (r.get("candidates") or [{}])[0]
    texto = "".join(p.get("text", "") for p in ((cand.get("content") or {}).get("parts") or []))
    g = cand.get("groundingMetadata") or {}
    return {
        "texto": texto,
        "buscas": g.get("webSearchQueries") or [],
        "fontes": [((x.get("web") or {}).get("title") or "") for x in g.get("groundingChunks") or []],
        "uso": r.get("usageMetadata") or {},
        "modelo": r.get("modelVersion") or "",
        "fim": cand.get("finishReason") or "",
    }


def ler_eventos_codex(jsonl: str) -> dict:
    """Do `codex exec --json`: as buscas que ele fez, o uso de tokens e a última mensagem."""
    buscas, uso, ultima, outras = [], {}, "", []
    for linha in (jsonl or "").splitlines():
        try:
            ev = json.loads(linha)
        except ValueError:
            continue
        item = ev.get("item") or {}
        if ev.get("type") == "item.completed" and item.get("type") == "web_search":
            acao = item.get("action") or {}
            buscas.extend(acao.get("queries") or ([item["query"]] if item.get("query") else []))
        elif ev.get("type") == "item.completed" and item.get("type") == "agent_message":
            ultima = item.get("text") or ""
        elif ev.get("type") == "item.completed" and item.get("type"):
            outras.append(item["type"])
        elif ev.get("type") == "turn.completed":
            uso = ev.get("usage") or {}
    return {"buscas": buscas, "uso": uso, "texto": ultima, "outras_ferramentas": sorted(set(outras))}


def registro(lead: dict, assistente: str, rodada: int, bruto: dict) -> dict:
    """Uma consulta já analisada: os nomes, a posição do lead, onde cada nome está no Places."""
    nomes, fonte = extrair_nomes(bruto.get("texto") or "")
    resultados = lead.get("places_top") or []
    return {
        "slug": lead["slug"], "assistente": assistente, "rodada": rodada,
        "ok": bool(bruto.get("ok")) and bool(bruto.get("texto")),
        "erro": bruto.get("erro"), "segundos": bruto.get("segundos"),
        "modelo": bruto.get("modelo"), "nomes": nomes, "fonte_dos_nomes": fonte,
        "posicao_do_lead": posicao_do_lead(nomes, lead["nome"], lead["cidade"]),
        "mencionado_no_texto": mencionado_no_texto(bruto.get("texto") or "", lead["nome"], lead["cidade"]),
        "no_places": [no_places(n, resultados, lead["cidade"]) for n in nomes],
        "buscas_feitas": len(bruto.get("buscas") or []), "buscas": bruto.get("buscas") or [],
        "fontes": bruto.get("fontes") or [], "uso": bruto.get("uso") or {},
        "outras_ferramentas": bruto.get("outras_ferramentas") or [],
        "texto": bruto.get("texto") or "", "em": bruto.get("em"),
    }


def reanalisar(medicao: dict) -> dict:
    """Refaz nomes e casamentos a partir do texto gravado de cada consulta: mudar a regra de casar
    (a lista GENERICAS, por exemplo) não custa consultar de novo."""
    leads = {l["slug"]: l for l in medicao.get("leads", [])}
    novas = []
    for c in medicao.get("consultas", []):
        lead = leads.get(c["slug"])
        if not lead:
            novas.append(c)
            continue
        bruto = {k: c.get(k) for k in ("ok", "erro", "segundos", "modelo", "buscas", "fontes", "uso", "outras_ferramentas", "texto", "em")}
        novas.append(registro(lead, c["assistente"], c["rodada"], bruto))
    return {**medicao, "consultas": novas}


# --- Rede e processo -----------------------------------------------------------------------------

def chave_gemini() -> str | None:
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"].strip()
    arq = Path.home() / ".config/squadone/operations.env"
    try:
        for linha in arq.read_text(encoding="utf-8").splitlines():
            if linha.startswith("GEMINI_API_KEY="):
                return linha.split("=", 1)[1].strip().strip('"').strip("'") or None
    except OSError:
        pass
    return None


def perguntar_gemini(pergunta: str, chave: str, modelo: str = MODELO_GEMINI) -> dict:
    corpo = {"contents": [{"role": "user", "parts": [{"text": pergunta}]}], "tools": [{"google_search": {}}]}
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/models/{modelo}:generateContent",
        data=json.dumps(corpo).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": chave})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
            r = json.load(resp)
    except urllib.error.HTTPError as e:
        # Só o status: o corpo do erro do Google pode ecoar a requisição.
        return {"ok": False, "erro": f"http {e.code}", "segundos": round(time.monotonic() - t0, 1)}
    except (urllib.error.URLError, TimeoutError, ValueError) as e:
        return {"ok": False, "erro": type(e).__name__, "segundos": round(time.monotonic() - t0, 1)}
    saida = ler_resposta_gemini(r)
    saida.update(ok=True, segundos=round(time.monotonic() - t0, 1))
    return saida


def codex_bin() -> str | None:
    for c in (os.environ.get("SQUADONE_CODEX_BIN"), str(Path.home() / ".codex/plugins/.plugin-appserver/codex")):
        if c and Path(c).is_file():
            return c
    return None


def args_do_codex(saida_msg: str, modelo: str = MODELO_CODEX) -> list[str]:
    args = ["--search", "exec", "--ephemeral", "--ignore-user-config", "--ignore-rules", "-m", modelo,
            "--sandbox", "read-only", "--skip-git-repo-check", "--json",
            "-c", 'model_reasoning_effort="low"', "--output-last-message", saida_msg]
    for r in RECURSOS_DESLIGADOS:
        args += ["--disable", r]
    return args + ["-"]


def perguntar_codex(pergunta: str, binario: str) -> dict:
    with tempfile.TemporaryDirectory(prefix="raio-x-ia-codex-") as tmp:
        msg = str(Path(tmp) / "ultima.txt")
        env = {k: os.environ[k] for k in ("HOME", "PATH", "USER", "LOGNAME", "LANG", "TERM", "CODEX_HOME") if k in os.environ}
        env.setdefault("LANG", "C.UTF-8")
        t0 = time.monotonic()
        try:
            p = subprocess.run([binario, *args_do_codex(msg)], input=pergunta, text=True, capture_output=True,
                               cwd=tmp, env=env, timeout=TIMEOUT_S)
        except subprocess.TimeoutExpired:
            return {"ok": False, "erro": "timeout", "segundos": round(time.monotonic() - t0, 1)}
        segundos = round(time.monotonic() - t0, 1)
        eventos = ler_eventos_codex(p.stdout)
        try:
            texto = Path(msg).read_text(encoding="utf-8")
        except OSError:
            texto = eventos["texto"]
        if p.returncode != 0:
            ultima = (p.stderr.strip().splitlines() or ["?"])[-1][:200]
            return {"ok": False, "erro": f"codex {p.returncode}: {ultima}", "segundos": segundos}
        eventos.update(ok=True, texto=texto, segundos=segundos, modelo=MODELO_CODEX)
        return eventos


def gravar(caminho: Path, dados: dict) -> None:
    caminho.parent.mkdir(parents=True, exist_ok=True)
    tmp = caminho.with_suffix(".tmp")
    tmp.write_text(json.dumps(dados, ensure_ascii=False, indent=1), encoding="utf-8")
    os.chmod(tmp, 0o600)
    tmp.replace(caminho)


def carregar_lead(raiz: Path, slug: str) -> dict | None:
    for pasta in (raiz / slug, raiz / "_em-conversa" / slug):
        if (pasta / "content.md").is_file():
            try:
                places = json.loads((pasta / "raio-x-places.json").read_text(encoding="utf-8"))
            except (OSError, ValueError):
                places = None
            return lead_da_pasta(slug, ler_content((pasta / "content.md").read_text(encoding="utf-8")), places)
    return None


def candidatos(raiz: Path) -> list[str]:
    pastas = sorted([*raiz.glob("*/raio-x-places.json"), *raiz.glob("_em-conversa/*/raio-x-places.json")])
    return [p.parent.name for p in pastas if not p.parent.name.startswith(("_", "."))]


def imprimir_resumo(res: dict) -> None:
    print(json.dumps(res, ensure_ascii=False, indent=1))


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("slugs", nargs="*")
    ap.add_argument("--auto", type=int, default=0)
    ap.add_argument("--repeticoes", type=int, default=3)
    ap.add_argument("--assistentes", default="gemini,codex")
    ap.add_argument("--raiz", default=str(Path.home() / "auto-site"))
    ap.add_argument("--saida", default="")
    ap.add_argument("--resumir", default="")
    a = ap.parse_args(argv)

    if a.resumir:
        imprimir_resumo(resumir(reanalisar(json.loads(Path(a.resumir).read_text(encoding="utf-8")))))
        return 0

    raiz = Path(a.raiz).expanduser()
    if a.auto:
        todos = [l for l in (carregar_lead(raiz, s) for s in candidatos(raiz)) if l]
        leads = escolher_variados(todos, a.auto)
    else:
        leads = [l for l in (carregar_lead(raiz, s) for s in a.slugs) if l]
    if not leads:
        print("nenhum lead com content.md e raio-x-places.json", file=sys.stderr)
        return 1

    assistentes = [x.strip() for x in a.assistentes.split(",") if x.strip()]
    chave = chave_gemini() if "gemini" in assistentes else None
    binario = codex_bin() if "codex" in assistentes else None
    if "gemini" in assistentes and not chave:
        print("sem GEMINI_API_KEY: Gemini fora da medição", file=sys.stderr)
        assistentes.remove("gemini")
    if "codex" in assistentes and not binario:
        print("sem o binário do codex: ChatGPT fora da medição", file=sys.stderr)
        assistentes.remove("codex")

    agora = dt.datetime.now().astimezone()
    saida = Path(a.saida).expanduser() if a.saida else \
        Path.home() / "prumo-entregas/raio-x-ia" / f"medicao-{agora:%Y-%m-%d-%H%M}.json"
    medicao = {"versao": VERSAO, "iniciada_em": agora.isoformat(timespec="seconds"),
               "modelos": {"gemini": MODELO_GEMINI, "codex": MODELO_CODEX}, "pergunta_modelo": montar_pergunta("<termo>", "<cidade>"),
               "leads": leads, "consultas": []}
    gravar(saida, medicao)
    print(f"{len(leads)} leads × {len(assistentes)} assistentes × {a.repeticoes} rodadas -> {saida}", flush=True)

    # Rodada por fora: as repetições do mesmo lead ficam espaçadas no tempo (mede estabilidade de
    # verdade, não o cache de uma mesma janela de segundos).
    for rodada in range(1, a.repeticoes + 1):
        for lead in leads:
            pergunta = montar_pergunta(lead["termo"], lead["cidade"])
            for assistente in assistentes:
                bruto = perguntar_gemini(pergunta, chave) if assistente == "gemini" else perguntar_codex(pergunta, binario)
                bruto["em"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
                reg = registro(lead, assistente, rodada, bruto)
                medicao["consultas"].append(reg)
                gravar(saida, medicao)
                marca = f"#{reg['posicao_do_lead']}" if reg["posicao_do_lead"] else ("texto" if reg["mencionado_no_texto"] else "-")
                print(f"r{rodada} {assistente:6} {lead['slug'][:40]:40} {reg['segundos']}s "
                      f"{'ok' if reg['ok'] else reg['erro']} nomes={len(reg['nomes'])} lead={marca}", flush=True)

    medicao["terminada_em"] = dt.datetime.now().astimezone().isoformat(timespec="seconds")
    medicao["resumo"] = resumir(medicao)
    gravar(saida, medicao)
    imprimir_resumo(medicao["resumo"])
    return 0


if __name__ == "__main__":
    sys.exit(main())
