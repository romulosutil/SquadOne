#!/usr/bin/env python3
"""Sites e pendências: a mensagem diária das 10:30 (job `no_agent` do Hermes).

Junta dois recados que seriam quase iguais: o briefing dos sites, que às 08h
saía antes do gerador e nunca trazia os sites do dia, e a fila do que depende
do Rômulo ("Esperando você" na Central). Sai às 10:30 porque o gerador começa
às 08h e, de 24 a 28/09/2026, terminou entre 09:17 e 10:17; se ainda estiver
rodando, a mensagem diz, e cada site que sair depois chega pelo aviso de
publicação.

Fontes, só leitura:
- ~/auto-site/.logs/status.json: o resumo que o gerador grava ao terminar;
- ~/auto-site: a fila do gerador (mesma regra do gerador-de-sites) e os
  publicados hoje;
- ~/.local/share/n8n-estado/*.json: contagens e links que o n8n grava;
- ~/.local/share/n8n-estado/site-leads.json: o retrato da planilha que o fluxo
  07 grava a cada hora, com o link da página de cada lead (30/09/2026). Cada
  enviado sem resposta e cada lead em conversa ganha uma linha com o link, onde
  um toque marca "recusou" ou "fechou" (nada vai ao lead);
- ~/.local/share/squadone-operations/status.json: pendências do dell-status
  que não vêm do n8n.

Links saem dos dados; nada é montado aqui. A contagem de cada dia fica em
~/.local/share/sites-e-pendencias/contagens.json para mostrar a variação.

Uso manual: sites_e_pendencias.py [--teste]   (--teste prefixa "[teste]" e não grava a contagem)
"""

import json
import re
import sys
from datetime import datetime, timedelta
from pathlib import Path

HOME = Path.home()
AUTO = HOME / "auto-site"
GERADOR = AUTO / ".logs/status.json"
N8N = HOME / ".local/share/n8n-estado"
STATUS = HOME / ".local/share/squadone-operations/status.json"
CONTAGENS = HOME / ".local/share/sites-e-pendencias/contagens.json"
MAX_FALHAS = 2  # igual ao gerador-de-sites: 2 falhas tiram o lead da fila
N8N_VELHO = timedelta(hours=26)
STATUS_VELHO = timedelta(minutes=15)
# Primeiro os sites, depois o PRUMO; o resto na ordem do nome do arquivo.
ORDEM_N8N = ["site-antes-da-venda", "prumo"]
DIAS_GUARDADOS = 14
RETRATO = N8N / "site-leads.json"
# Uma linha por lead; passando disso, o resto está na coluna acoes_link da planilha.
MAX_LEADS = 15

agora = datetime.now().astimezone()
hoje = agora.date()


def ler_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def quando(iso: str):
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone()
    except (AttributeError, ValueError):
        return None


def minuscula(s: str) -> str:
    # "Sites prontos" vira "sites prontos"; sigla ("PRUMO: ...") fica como está.
    primeira = s.split(maxsplit=1)[0] if s.strip() else ""
    return s if len(primeira) > 1 and primeira.isupper() else s[:1].lower() + s[1:]


def variacao(chave: str, qtd: int, antes: dict) -> str:
    if chave not in antes or antes[chave] == qtd:
        return ""
    d = qtd - antes[chave]
    return f" ({'+' if d > 0 else '−'}{abs(d)})"


def falhas_registradas(pasta: Path) -> int:
    f = pasta / "falha.log"
    if not f.is_file():
        return 0
    return sum(1 for l in f.read_text(encoding="utf-8", errors="replace").splitlines() if l.strip())


def pastas_de_lead():
    if not AUTO.is_dir():
        return []
    return [p for p in AUTO.iterdir() if p.is_dir() and not p.name.startswith((".", "_"))]


def bloco_gerador(antes: dict, contagens: dict) -> list:
    leads = pastas_de_lead()
    if not leads:
        return ["*Gerador:* não li ~/auto-site."]
    sem_site = [p for p in leads if (p / "content.md").is_file() and not (p / "publicado.json").exists()]
    parados = [p for p in sem_site if falhas_registradas(p) >= MAX_FALHAS]
    fila = len(sem_site) - len(parados)
    publicados = sum(1 for p in leads if (p / "publicado.json").is_file()
                     and datetime.fromtimestamp((p / "publicado.json").stat().st_mtime).date() == hoje)
    contagens["fila-gerador"] = fila

    linhas = []
    st = ler_json(GERADOR) or {}
    resumo = st.get("ultimo_resumo") or {}
    fim = quando(resumo.get("fim", ""))
    if st.get("estado") == "processando":
        inicio = quando(st.get("inicio", ""))
        linhas.append(f"*Gerador:* ainda rodando, em {st.get('lead', '?')}"
                      + (f" desde {inicio:%H:%M}" if inicio else "")
                      + ". Cada site que sair chega pelo aviso de publicação.")
    elif fim and fim.date() == hoje:
        falhas = resumo.get("falhas") or []
        # descartados: o Claude tirou o lead da raiz (duplicado ou já tinha site); não é falha.
        descartados = resumo.get("descartados") or []
        linhas.append(f"*Gerador:* terminou às {fim:%H:%M}, com {len(resumo.get('concluidos') or [])} "
                      f"concluído(s) e {len(falhas)} falha(s)"
                      + (f"; {len(descartados)} descartado(s) pelo Claude" if descartados else "") + ".")
        if resumo.get("erro"):
            linhas.append(f"• A execução parou: {str(resumo['erro'])[:140]}")
        linhas += [f"• {f[:140]}" for f in falhas]
    elif fim:
        linhas.append(f"*Gerador:* não rodou hoje (última rodada em {fim:%d/%m %H:%M}).")
    else:
        linhas.append("*Gerador:* sem resumo em ~/auto-site/.logs/status.json.")

    hoje_txt = f"*Hoje:* {publicados} site(s) publicado(s) · {fila} na fila{variacao('fila-gerador', fila, antes)}"
    if parados:
        hoje_txt += f" · {len(parados)} parado(s) por {MAX_FALHAS} falhas (apagar o falha.log devolve à fila)"
    linhas.append(hoje_txt)
    return linhas


def itens_pendentes(avisos: list) -> list:
    """Pendências com quantidade > 0: primeiro as do n8n, depois as do dell-status."""
    itens, vistos = [], set()
    arquivos = sorted(N8N.glob("*.json")) if N8N.is_dir() else []
    arquivos.sort(key=lambda a: (ORDEM_N8N.index(a.stem) if a.stem in ORDEM_N8N else len(ORDEM_N8N), a.stem))
    for arq in arquivos:
        d = ler_json(arq)
        if not isinstance(d, dict) or "itens" not in d:
            continue  # ex.: prumo-avisados.json, memória de outro fluxo
        gerado = quando(d.get("geradoEm", ""))
        nota = f" (contagem de {gerado:%d/%m %H:%M})" if gerado and agora - gerado > N8N_VELHO else ""
        for it in d["itens"]:
            chave = f"pend:{it.get('id')}"
            vistos.add(chave)
            qtd = int(it.get("quantidade") or 0)
            if qtd:
                itens.append({"chave": chave, "qtd": qtd, "nome": str(it.get("nome", "")),
                              "detalhe": str(it.get("detalhe", "")), "link": it.get("link"),
                              "nota": nota, "sub": sublinks(it)})

    st = ler_json(STATUS)
    if not isinstance(st, dict):
        avisos.append("⚠️ Não li o status.json do dell-status.")
        return itens
    gerado = quando(st.get("geradoEm", ""))
    if gerado and agora - gerado > STATUS_VELHO:
        avisos.append(f"⚠️ O dell-status não atualiza desde {gerado:%d/%m %H:%M}.")
    for c in st.get("verificacoes", []):
        chave = c.get("id", "")
        if c.get("grupo") != "pendencias" or chave in vistos or chave == "pend:sites-fila":
            continue  # a fila do gerador já está no bloco de cima
        m = re.match(r"\s*(\d+)", c.get("detalhe") or "")
        if c.get("estado") == "ok" or not m:
            continue
        detalhe = re.sub(r"^\s*\d+\s*·\s*", "", c.get("detalhe") or "")
        itens.append({"chave": chave, "qtd": int(m.group(1)), "nome": str(c.get("nome", "")),
                      "detalhe": detalhe, "link": c.get("link"), "nota": "", "sub": []})
    return itens


def sublinks(item: dict) -> list:
    """Se o n8n mandar uma lista com links (um por lead), mostra até 3."""
    out = []
    for v in item.values():
        if isinstance(v, list):
            out += [x for x in v if isinstance(x, dict) and x.get("link")]
    return out[:3]


def leads_do_retrato() -> dict:
    """grupo ("resposta", "conversa") -> [{nome, link}] do retrato do fluxo 07, se tiver até 26 h."""
    d = ler_json(RETRATO)
    gerado = quando(d.get("geradoEm", "")) if isinstance(d, dict) else None
    if not gerado or agora - gerado > N8N_VELHO:
        return {}
    grupos = {}
    for l in d.get("leads") or []:
        if l.get("grupo") and l.get("link"):
            grupos.setdefault(l["grupo"], []).append({"nome": l.get("nome") or l.get("place_id"), "link": l["link"],
                                                      "enviado_em": l.get("enviado_em") or ""})
    return {g: sorted(ls, key=lambda l: l["enviado_em"]) for g, ls in grupos.items()}


def com_links_dos_leads(itens: list) -> list:
    """Um link por lead: sob "Enviados esperando resposta" e num item "em conversa" logo depois."""
    grupos = leads_do_retrato()
    if not grupos:
        return itens
    planilha = None
    for it in itens:
        if it["chave"] == "pend:site-resposta":
            it["sub"], planilha = grupos.get("resposta", []), it["link"]
    conversa = grupos.get("conversa", [])
    if conversa:
        depois = max((i + 1 for i, it in enumerate(itens) if it["chave"].startswith("pend:site-")), default=0)
        itens.insert(depois, {"chave": "pend:site-conversa", "qtd": len(conversa), "nome": "Leads em conversa",
                              "detalhe": "fechou ou recusou? Toque no link do lead", "link": planilha,
                              "nota": "", "sub": conversa})
    return itens


def bloco_pendencias(antes: dict, contagens: dict, avisos: list) -> list:
    itens = com_links_dos_leads(itens_pendentes(avisos))
    if not itens:
        return [] if avisos else ["*Esperando você:* nada."]
    linhas = ["*Esperando você*"]
    for i, it in enumerate(itens):
        contagens[it["chave"]] = it["qtd"]
        texto = f"• *{it['qtd']}* {minuscula(it['nome'])}{variacao(it['chave'], it['qtd'], antes)}{it['nota']}"
        if it["detalhe"]:
            texto += f" — {minuscula(it['detalhe'])}"
        linhas.append(texto)
        linhas += [f"   – {s.get('nome') or s.get('titulo') or ''} {s['link']}".replace("  ", " ") for s in it["sub"][:MAX_LEADS]]
        if len(it["sub"]) > MAX_LEADS:
            linhas.append(f"  – e mais {len(it['sub']) - MAX_LEADS}: coluna acoes_link da planilha")
        # Um link por grupo: itens seguidos com o mesmo link (mesma planilha) dividem a linha.
        proximo = itens[i + 1]["link"] if i + 1 < len(itens) else None
        if it["link"] and it["link"] != proximo:
            linhas.append(f"↳ {it['link']}")
    return linhas


def main() -> int:
    teste = "--teste" in sys.argv[1:]
    guardado = ler_json(CONTAGENS) or {}
    anteriores = sorted(d for d in guardado if d < hoje.isoformat())
    antes = guardado[anteriores[-1]] if anteriores else {}
    contagens, avisos = {}, []

    linhas = [f"{'[teste] ' if teste else ''}🌐 *Sites e pendências — {agora:%d/%m}*", ""]
    linhas += bloco_gerador(antes, contagens)
    linhas.append("")
    linhas += bloco_pendencias(antes, contagens, avisos)
    if avisos:
        linhas += [""] + avisos
    print("\n".join(linhas).strip())

    if not teste:
        guardado[hoje.isoformat()] = contagens
        for velho in sorted(guardado)[:-DIAS_GUARDADOS]:
            guardado.pop(velho)
        CONTAGENS.parent.mkdir(parents=True, exist_ok=True)
        tmp = CONTAGENS.with_suffix(".tmp")
        tmp.write_text(json.dumps(guardado, ensure_ascii=False, indent=1), encoding="utf-8")
        tmp.replace(CONTAGENS)
    return 0


if __name__ == "__main__":
    sys.exit(main())
