#!/usr/bin/env python3
"""Apaga na Vercel o demo de quem está em Perdido no CRM (Dell, 07/10/2026; critério de 08/10/2026).

Decisão do Rômulo (08/10/2026): "quando um site entrar em perdido, faz sentido
excluir ele do Vercel; já temos o backup dele no Dell". Antes (07/10) só saía o
demo de quem nunca interagiu, 10 dias depois do envio. Os projetos são o limite
do plano (hobby): demo de lead perdido ocupa vaga que o gerador precisa.

Proteção de 18/10/2026, após conferir a conversa da Comece: recusa ao canal,
conversa humana, próximo passo, proposta, pausa ou histórico ausente exigem revisão.
Antes de cada exclusão automática, o CRM é lido novamente. Uma classificação
automática negativa não autoriza sozinha apagar a demo.

Quem está em Perdido é o que o Funil mostra: o script lê a visão da Central
(GET /api/operations/crm, no loopback) em vez de refazer as regras de etapa, que
moram em server/crm.ts — recusou, sem resposta em 7 dias, parou de responder,
sem contato fácil, descartado. Entra, tudo ao mesmo tempo:
- lead do Site, etapa `perdido`, há FOLGA_DIAS dias ou mais (dá tempo de desfazer
  um "Recusou" tocado errado ou de o lead responder no dia seguinte);
- pasta na raiz de ~/auto-site, em _recusados/, _concluidos/, _em-conversa/ ou
  _descartados/ (_fechados/ nunca: o demo é do cliente);
- projeto `demo-*` no publicado.json da pasta (a pasta é a prova, não só o CRM),
  ainda sem `apagado_em`.
Visão sem retrato válido, sem as pastas lidas ou com o retrato com mais de 1 h
não vale: uma resposta de agora poderia estar de fora.

O que NÃO apaga: a pasta do lead em ~/auto-site (conteúdo, fotos, DESIGN.md)
fica, para regerar ou republicar. Só ganha `apagado_em` no publicado.json e o CRM
tira o link do demo. O demo apagado só volta republicando (o site-demos-pausa, que
o religava no Desfazer, foi aposentado em 19/10/2026).

O timer diário (09:50) e o `lote-continuo` rodam `--apagar`: apagam sozinhos e
mandam UM aviso com o que saiu. No máximo MAX_POR_RODADA por rodada (os mais
antigos em Perdido primeiro): um erro de regra não leva a Vercel inteira de uma vez.

    site-demos-limpeza                      lista quem entra e, se há novo, manda UM aviso
    site-demos-limpeza --simular            só lista, sem aviso e sem gravar estado
    site-demos-limpeza --apagar             apaga os que entram (é o que o timer roda)
    site-demos-limpeza --apagar demo-a demo-b   apaga só esses (têm de estar entre os que entram)
    site-demos-limpeza --exclusao           lista os pedidos de exclusão ainda no ar (nada apaga)
    site-demos-limpeza --exclusao demo-a    apaga já o demo de quem PEDIU para apagar, sem esperar a folga

Pedido de exclusão (`--exclusao`, 07/10/2026): o lead respondeu pedindo para
apagar o site ou o conteúdo ("se puder excluir esse conteúdo por gentileza",
Baby School). O classificador do WhatsApp grava `resposta_tipo` "exclusao", marca
o lead como recusado e o aviso (Telegram) traz este comando. Desde 18/10 a classificação automática fica protegida na regra geral;
o comando explícito continua servindo para atender um pedido confirmado de exclusão. Entra só o projeto nomeado cujo lead, no retrato da planilha (site-leads.json),
tem `resposta_tipo` "exclusao", não está fechado e tem o publicado.json da pasta
confirmando o projeto. A pasta fica.

Token: o da Vercel CLI (auth.json), renovado pela própria CLI; nunca é impresso.
Estado em ~/.local/state/site-demos-limpeza/ (avisados.json, historico.jsonl).
"""
from __future__ import annotations

import importlib.util
import json
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
AUTO = HOME / "auto-site"
CENTRAL_CRM = "http://127.0.0.1:9120/api/operations/crm"  # a Central (squadone-operations), só loopback
RETRATO = HOME / ".local/share/n8n-estado/site-leads.json"
ESTADO = HOME / ".local/state/site-demos-limpeza/avisados.json"
HISTORICO = ESTADO.with_name("historico.jsonl")
FILA_AVISOS = HOME / ".local/share/avisos/fila"
AUTH = HOME / ".local/share/com.vercel.cli/auth.json"
VERCEL_CLI = HOME / ".local/bin/vercel"
TIME_VERCEL = "team_fgUUHtNBYtsrwTNGwn2gzxF2"  # romulodesigns
API = "https://api.vercel.com"

FOLGA_DIAS = 2  # dias em Perdido antes de apagar
MAX_POR_RODADA = 60
RETRATO_VELHO = timedelta(hours=3)  # site-leads.json (só o --exclusao): o fluxo 07 grava de hora em hora (:20)
CRM_VELHO = timedelta(hours=1)  # o 08 · CRM relê as planilhas a cada 10 min
MAX_NOMES = 25
MAX_FALHAS = 10  # no aviso; as outras vão ao journal (stdout)
MAX_LINHA_FALHA = 200
TETO_DO_TEXTO = 3900  # o texto do aviso vai até 4000 (deploy/dell/README.md, "Fila de avisos"), com folga
SP =timezone(timedelta(hours=-3))  # São Paulo, sem horário de verão desde 2019
# Como o CRM diz o lugar da pasta -> o diretório em ~/auto-site. _fechados/ fica de fora de propósito.
LUGARES_QUE_ENTRAM = {"raiz": "", "_recusados/": "_recusados", "_concluidos/": "_concluidos",
                      "_em-conversa/": "_em-conversa", "_descartados/": "_descartados"}
ROTULO_DA_PERDA = {"recusou": "recusou", "expirou": "sem resposta em 7 dias", "esfriou": "parou de responder",
                   "sem-contato": "sem contato fácil", "descartado": "descartado"}
# Pedido de exclusão: onde a pasta de quem pediu pode estar (recusado vai para _recusados/ pelo site-pastas).
PASTAS_DA_EXCLUSAO = ("", "_recusados", "_em-conversa", "_concluidos")
SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,179}$")


def ler_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def instante(valor) -> float:
    try:
        return datetime.fromisoformat(str(valor).replace('Z', '+00:00')).timestamp()
    except (ValueError, TypeError, OverflowError):
        return 0


def motivo_protecao(lead: dict) -> str:
    """Não confunde classificação automática, silêncio ou pausa com encerramento humano."""
    proximo = lead.get('proximoPasso') or {}
    conversa, marcos, resposta = (lead.get(k) or {} for k in ('conversa', 'marcos', 'resposta'))
    eventos = sorted((e for e in lead.get('eventos', []) if e.get('origem') == 'manual'), key=lambda e: instante(e.get('em')), reverse=True)
    finais = {'recusou', 'sem_contato', 'dispensado'}
    desfechos = finais | {'recusou_desfeito', 'sem_contato_desfeito', 'dispensado_desfeito'}
    final = next((e for e in eventos if e.get('tipo') in desfechos), {})
    pausa_em = 0
    for e in eventos:
        if e.get('tipo') == 'nota' and str(e.get('texto', '')).startswith('[aprendizado-v1] '):
            try:
                a = json.loads(e['texto'].split(' ', 1)[1])
                if a.get('pausarAteResposta'):
                    pausa_em = instante(e.get('em'))
                break
            except (ValueError, TypeError):
                continue
    contexto = max(instante(conversa.get('ultimaEntrada')), instante(marcos.get('respondeu')), instante(resposta.get('em')), instante((lead.get('proposta') or {}).get('em')), instante(proximo.get('registradoEm')), pausa_em)
    if final.get('tipo') in finais and instante(final.get('em')) > 0 and instante(final.get('em')) >= contexto:
        return ''
    if proximo.get('texto'):
        return 'próximo passo salvo: resolva antes de apagar'
    if lead.get('revisaoComercial') or lead.get('demoProtegida'):
        return str(lead.get('revisaoComercial') or lead['demoProtegida'])
    if pausa_em and instante(conversa.get('ultimaEntrada')) <= pausa_em:
        return 'contato em espera por decisão humana'
    if lead.get('proposta'):
        return 'proposta sem encerramento manual posterior'
    if resposta.get('tipo') in ('negativa', 'exclusao') or lead.get('motivoPerda') in ('recusou', 'sem-interesse'):
        return 'recusa automática exige encerramento manual conferido'
    if conversa.get('ultimaEntrada') or (marcos.get('respondeu') and resposta.get('tipo') != 'bot'):
        return 'há conversa humana: revisar antes de encerrar e apagar'
    if not conversa.get('mensagens'):
        return 'sem histórico disponível: não comprova ausência de conversa; revisar antes de expirar'
    return ''


def escolher(leads: list[dict], projeto_de, folga: int = FOLGA_DIAS, agora: datetime | None = None) -> tuple[list[dict], list[tuple[str, str]]]:
    """PURO: (quem entra, [(nome, por que não entrou)]) a partir dos leads do CRM.

    `projeto_de(pasta)` diz o projeto do publicado.json da pasta (None sem demo ou já apagado).
    Só os perdidos do Site com demo no ar aparecem em `guardados`; o resto não é assunto daqui.
    Quem entra vem do mais antigo em Perdido para o mais novo (é a ordem do corte por rodada).
    """
    eleitos, guardados = [], []
    for l in leads:
        if l.get("produto") != "site" or l.get("etapa") != "perdido" or l.get("demoApagadoEm"):
            continue
        nome = str(l.get("empresa") or l.get("chave") or "?")
        p = l.get("pasta") if isinstance(l.get("pasta"), dict) else {}
        slug, lugar = str(p.get("slug") or ""), str(p.get("lugar") or "")
        if not SLUG.match(slug):
            continue  # sem pasta em ~/auto-site: não há demo para apagar
        if lugar not in LUGARES_QUE_ENTRAM:
            guardados.append((nome, f"pasta em {lugar or '?'}: fora dos lugares de quem perdeu"))
            continue
        caminho = f"{LUGARES_QUE_ENTRAM[lugar]}/{slug}".lstrip("/")
        projeto = str(projeto_de(caminho) or "")
        if not projeto.startswith("demo-"):
            continue  # nunca publicado, ou já apagado
        protecao = motivo_protecao(l)
        if protecao:
            guardados.append((nome, protecao))
            continue
        dias = l.get("diasNaEtapa")
        # Confirmação manual recente reinicia a folga, mesmo que a recusa automática seja antiga.
        finais = [e for e in l.get('eventos', []) if e.get('origem') == 'manual' and e.get('tipo') in ('recusou', 'sem_contato', 'dispensado') and instante(e.get('em'))]
        if finais:
            encerrado = max(instante(e.get('em')) for e in finais)
            dias = ((agora or datetime.now(timezone.utc)).astimezone(SP).date() - datetime.fromtimestamp(encerrado, SP).date()).days
        if isinstance(dias, int) and dias < folga:
            guardados.append((nome, f"em Perdido há {dias} dia(s); entra em {folga - dias}"))
            continue
        eleitos.append({"nome": nome, "projeto": projeto, "pasta": caminho, "motivo": str(l.get("motivoPerda") or ""),
                        "desde": str(l.get("desde") or "")})
    eleitos.sort(key=lambda e: (e["desde"] != "", e["desde"]))  # sem data (o acervo de 25/09) é o mais antigo
    return eleitos, guardados


def escolher_exclusao(leads: list[dict], projetos: list[str]) -> tuple[list[dict], list[str]]:
    """PURO: dos projetos nomeados, os que se apagam a pedido do lead, e por que cada um dos outros não."""
    por_projeto: dict[str, list[dict]] = {}
    for l in leads:
        por_projeto.setdefault(str(l.get("vercel_project") or ""), []).append(l)
    eleitos, recusas = [], []
    for projeto in projetos:
        achados = por_projeto.get(projeto, []) if projeto.startswith("demo-") else []
        if len(achados) != 1:
            recusas.append(f"{projeto}: {'nenhum lead' if not achados else 'mais de um lead'} com esse projeto no retrato")
            continue
        l = achados[0]
        nome = str(l.get("nome") or l.get("pasta") or "?")
        topo, _, resto = str(l.get("pasta") or "").rpartition("/")
        tipo = str(l.get("resposta_tipo") or "")
        if tipo != "exclusao":
            recusas.append(f"{projeto} ({nome}): no retrato o lead não pediu exclusão (resposta_tipo {tipo or 'vazio'})")
        elif l.get("status") == "fechado" or topo == "_fechados":
            recusas.append(f"{projeto} ({nome}): lead fechado; o demo é dele")
        elif topo not in PASTAS_DA_EXCLUSAO or not SLUG.match(resto or ""):
            recusas.append(f"{projeto} ({nome}): pasta {l.get('pasta') or '?'} não é a de um lead")
        else:
            eleitos.append({"nome": nome, "projeto": projeto, "pasta": str(l["pasta"]), "enviado_em": str(l.get("enviado_em") or "")})
    return eleitos, recusas


def ler_retrato_com_hora() -> tuple[list[dict], datetime]:
    d = ler_json(RETRATO)
    if not isinstance(d, dict):
        raise RuntimeError("sem retrato da planilha (site-leads.json)")
    try:
        gerado = datetime.fromisoformat(str(d.get("geradoEm")).replace("Z", "+00:00"))
    except ValueError:
        raise RuntimeError("retrato da planilha sem data") from None
    if datetime.now(timezone.utc) - gerado > RETRATO_VELHO:
        raise RuntimeError(f"retrato da planilha velho ({gerado.astimezone(SP):%d/%m %H:%M}); uma resposta recente "
                           "poderia estar de fora. O fluxo 07 grava de hora em hora")
    return [l for l in d.get("leads", []) if isinstance(l, dict)], gerado


def ler_crm(url: str = CENTRAL_CRM) -> list[dict]:
    """Os leads como o Funil os mostra. Sem retrato bom, sem pastas lidas ou velho: erro (não apaga nada)."""
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            d = json.loads(r.read())
    except (OSError, ValueError) as e:
        raise RuntimeError(f"não consegui ler o CRM da Central ({url}): {e}") from None
    if not isinstance(d, dict) or d.get("estado") != "ok":
        raise RuntimeError(f"o CRM da Central está sem retrato válido ({(d or {}).get('estado')}): {(d or {}).get('mensagem') or ''}")
    if not d.get("pastasLidas"):
        raise RuntimeError("a Central não leu ~/auto-site agora: sem as pastas, não dá para conferir demo apagado")
    try:
        gerado = datetime.fromisoformat(str(d.get("geradoEm")).replace("Z", "+00:00"))
    except ValueError:
        raise RuntimeError("retrato do CRM sem data") from None
    if datetime.now(timezone.utc) - gerado > CRM_VELHO:
        raise RuntimeError(f"retrato do CRM velho ({gerado.astimezone(SP):%d/%m %H:%M}); o 08 · CRM relê a cada 10 min, "
                           "uma resposta recente poderia estar de fora")
    return [l for l in d.get("leads", []) if isinstance(l, dict)]


def projeto_da_pasta(pasta: str) -> str | None:
    """O projeto da Vercel do publicado.json da pasta; None sem recibo ou já apagado."""
    r = ler_json(AUTO / pasta / "publicado.json")
    if not isinstance(r, dict) or r.get("apagado_em"):
        return None
    return str(r.get("vercel_project") or "") or None


def ja_apagado(pasta: str) -> bool:
    return bool((ler_json(AUTO / pasta / "publicado.json") or {}).get("apagado_em"))


# ---------------------------------------------------------------- Vercel

def token() -> str:
    """Token da Vercel CLI; a própria CLI renova quando está para vencer (nunca imprime)."""
    d = ler_json(AUTH) or {}
    if not d.get("token") or float(d.get("expiresAt") or 0) < time.time() + 600:
        subprocess.run([str(VERCEL_CLI), "whoami", "--non-interactive"], capture_output=True, timeout=120, check=False,
                       env={"PATH": f"{HOME}/.local/bin:/usr/local/bin:/usr/bin:/bin", "HOME": str(HOME)})
        d = ler_json(AUTH) or {}
    if not d.get("token") or float(d.get("expiresAt") or 0) < time.time():
        raise RuntimeError("token da Vercel CLI vencido e não renovou (rode `vercel login` no Dell)")
    return str(d["token"])


def vercel(metodo: str, caminho: str, chave: str) -> dict:
    url = f"{API}{caminho}{'&' if '?' in caminho else '?'}teamId={TIME_VERCEL}"
    req = urllib.request.Request(url, method=metodo, headers={"Authorization": f"Bearer {chave}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        corpo = e.read().decode(errors="replace")[:200]
        raise RuntimeError(f"{metodo} {caminho.split('?')[0]} -> {e.code}: {corpo}") from None


def projeto_na_vercel(nome: str, chave: str) -> dict | None:
    try:
        return vercel("GET", f"/v9/projects/{urllib.parse.quote(nome)}", chave)
    except RuntimeError as e:
        if " -> 404" in str(e):
            return None
        raise


# ---------------------------------------------------------------- rodada

# A lib de aviso (deploy/dell/lib/aviso.py, 11/10/2026): no repo, em lib/ ao
# lado deste arquivo; no Dell, instalada em ~/.local/lib/mel/ (instalados.json).
# Primeiro a do repo, para o teste nunca pegar uma cópia instalada.
PASTAS_DA_LIB = [Path(__file__).resolve().parent / "lib", HOME / ".local/lib/mel"]


def lib_de_aviso():
    """O módulo da lib, ou None quando nenhuma cópia existe ou carrega."""
    for pasta in PASTAS_DA_LIB:
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", pasta / "aviso.py")
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — ausente ou quebrada: tenta a próxima
            continue
    return None


def avisar(texto: str) -> bool:
    """True quando o aviso ficou na fila. Nada levanta: fila ausente, aviso recusado
    ou lib ausente voltam False e o motivo vai ao journal."""
    aviso = {"titulo": "🧹 Site antes da venda: demos de leads perdidos", "texto": texto, "origem": "site-demos-limpeza"}
    lib = lib_de_aviso()
    if lib is None:  # sem a lib não há validação (nem a regra do R$): não grava na fila, só registra e segue
        print(f"lib de aviso ausente em ~/.local/lib/mel: aviso não gravado: {aviso['titulo']}", file=sys.stderr, flush=True)
        return False
    # Os nomes vêm de planilha/CRM; se um deles trouxer "R$" a lib recusaria o
    # aviso inteiro, e calar uma exclusão na Vercel é pior que mandá-lo sem o valor.
    if lib.VALOR_EM_REAIS.search(texto):
        aviso["texto"] = lib.sem_valores(texto)
    return lib.gravar(aviso, fila=FILA_AVISOS, prefixo="site-demos-limpeza").gravado


def _montar_texto(apagados: list[dict], falhas: list[str], a_pedido: bool, max_nomes: int, max_falhas: int) -> str:
    linhas = []
    if apagados and a_pedido:
        linhas += [f"Apaguei {len(apagados)} demo(s) na Vercel a pedido do lead (pediu exclusão no WhatsApp). "
                   "A pasta continua em ~/auto-site; se o pedido for de apagar tudo, apague a pasta à mão."]
        linhas += [f"• {e['nome']}" for e in apagados[:max_nomes]]
    elif apagados:
        linhas += [f"Apaguei {len(apagados)} demo(s) na Vercel de leads em Perdido no CRM (há {FOLGA_DIAS}+ dias). "
                   "A pasta continua em ~/auto-site: para mandar de novo, é republicar."]
        linhas += [f"• {e['nome']} ({ROTULO_DA_PERDA.get(e.get('motivo', ''), 'perdido')})" for e in apagados[:max_nomes]]
        if len(apagados) > max_nomes:
            linhas.append(f"• e mais {len(apagados) - max_nomes} (lista em {HISTORICO})")
    if falhas:
        linhas += ([""] if linhas else []) + [f"Não consegui ({len(falhas)}):"]
        linhas += [f"• {f if len(f) <= MAX_LINHA_FALHA else f[:MAX_LINHA_FALHA - 1] + '…'}" for f in falhas[:max_falhas]]
        if len(falhas) > max_falhas:
            linhas.append(f"• e mais {len(falhas) - max_falhas} (todas no journal do site-demos-limpeza)")
    return "\n".join(linhas)


def texto_do_aviso(apagados: list[dict], falhas: list[str], a_pedido: bool = False) -> str:
    """O aviso de uma rodada de `apagar`. Até 25 nomes e 10 falhas (200 caracteres
    cada), com "e mais N" no resto; se ainda assim passar de TETO_DO_TEXTO, tenta com
    menos nomes e menos falhas. O teto do aviso é 4000 caracteres e cortar seco
    levaria o fim, que é onde está a lista do que NÃO deu certo."""
    for max_nomes, max_falhas in ((MAX_NOMES, MAX_FALHAS), (15, 6), (8, 4), (4, 2), (2, 1)):
        texto = _montar_texto(apagados, falhas, a_pedido, max_nomes, max_falhas)
        if len(texto) <= TETO_DO_TEXTO:
            break
    return texto  # nomes enormes: o que passar de 4000 a lib corta, com a marca "(cortado)"


def anotar(evento: dict) -> None:
    HISTORICO.parent.mkdir(parents=True, exist_ok=True)
    with HISTORICO.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"em": datetime.now(SP).isoformat(timespec="seconds"), **evento}, ensure_ascii=False) + "\n")


def marcar_apagado(pasta: str) -> None:
    recibo = AUTO / pasta / "publicado.json"
    r = ler_json(recibo)
    if not isinstance(r, dict):
        return
    r["apagado_em"] = datetime.now(SP).isoformat(timespec="seconds")
    tmp = recibo.with_name(".publicado.json.tmp")
    tmp.write_text(json.dumps(r, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    tmp.replace(recibo)


def apagar(alvos: list[dict], a_pedido: bool = False) -> int:
    chave = token()
    apagados, falhas = [], []
    for e in alvos:
        r = ler_json(AUTO / e["pasta"] / "publicado.json") or {}
        if r.get("vercel_project") != e["projeto"]:
            falhas.append(f"{e['nome']}: o publicado.json da pasta não confirma o projeto {e['projeto']}")
            continue
        try:
            info = projeto_na_vercel(e["projeto"], chave)
            if not a_pedido:
                # Entre a seleção e o DELETE podem chegar resposta, próximo passo ou proposta.
                # Sem CRM atual, ou se deixou de ser elegível, não executa a exclusão.
                atuais, _ = escolher(ler_crm(), projeto_da_pasta)
                confirmados = [a for a in atuais if a['projeto'] == e['projeto'] and a['pasta'] == e['pasta']]
                if len(confirmados) != 1:
                    falhas.append(f"{e['nome']}: contexto mudou ou falta confirmação atual; demo preservada")
                    continue
            if info is not None:
                vercel("DELETE", f"/v9/projects/{info['id']}", chave)  # a API apaga pelo id (prj_...)
            marcar_apagado(e["pasta"])
            apagados.append(e)
            acao = "apagou" if info is not None else "ja_nao_existia"
            anotar({"acao": acao + ("_a_pedido" if a_pedido else ""), "projeto": e["projeto"], "nome": e["nome"],
                    **{k: e[k] for k in ("motivo", "desde", "enviado_em") if e.get(k)}})
            print(f"{'apagado' if info is not None else 'já não existia'}: {e['projeto']}")
        except RuntimeError as err:
            falhas.append(f"{e['nome']}: {err}")
    for f in falhas:
        print(f"não consegui: {f}")  # o aviso mostra só as primeiras; aqui vão todas
    if apagados or falhas:
        avisar(texto_do_aviso(apagados, falhas, a_pedido))
    return 1 if falhas else 0


def exclusao(nomes: list[str]) -> int:
    """Sem nomes, lista os pedidos de exclusão com o demo ainda no ar; com nomes, apaga os que o retrato confirma."""
    leads, gerado = ler_retrato_com_hora()
    vivos = [l for l in leads if not (l.get("pasta") and ja_apagado(str(l["pasta"])))]
    if not nomes:
        pedidos = [l for l in vivos if l.get("resposta_tipo") == "exclusao" and str(l.get("vercel_project") or "").startswith("demo-")]
        print(f"{len(pedidos)} pedido(s) de exclusão com o demo no ar (retrato das {gerado.astimezone(SP):%H:%M})")
        for l in pedidos:
            print(f"  site-demos-limpeza --exclusao {l['vercel_project']}   ({l.get('nome') or l.get('pasta')})")
        return 0
    apagados_antes = {str(l.get("vercel_project")) for l in leads if l not in vivos}
    eleitos, recusas = escolher_exclusao(vivos, [n for n in nomes if n not in apagados_antes])
    recusas += [f"{n}: já foi apagado (apagado_em no publicado.json)" for n in nomes if n in apagados_antes]
    if recusas:
        print("Nada foi apagado:")
        for r in recusas:
            print(f"  {r}")
        if any("não pediu exclusão" in r for r in recusas):
            print(f"O retrato é das {gerado.astimezone(SP):%H:%M}; o fluxo 07 grava de hora em hora (:20). Pedido mais novo que "
                  "isso aparece no próximo (ou agora: cd ~/.local/share/claude-ops && python3 site-lead-acoes.py --retrato-agora).")
        return 2
    return apagar(eleitos, a_pedido=True)


def main(argv: list[str]) -> int:
    if argv[:1] == ["--exclusao"]:
        nomes = argv[1:]
        if any(not n.startswith("demo-") for n in nomes):
            print("--exclusao leva só nomes de projeto demo-* (e nenhuma outra opção)")
            return 2
        return exclusao(nomes)
    quero_apagar, nomes, simular = False, [], False
    for a in argv:
        if a == "--apagar":
            quero_apagar = True
        elif a == "--simular":
            simular = True  # lista sem mandar aviso nem gravar o que já foi avisado
        elif a.startswith("demo-"):
            nomes.append(a)
        else:
            print(__doc__)
            return 2
    if nomes and not quero_apagar:
        print("nomes de projeto só com --apagar")
        return 2
    if simular and quero_apagar:
        print("--simular não apaga: escolha um dos dois")
        return 2

    eleitos, guardados = escolher(ler_crm(), projeto_da_pasta)
    print(f"{len(eleitos)} entram (em Perdido no CRM há {FOLGA_DIAS}+ dias, com o demo no ar)")
    for e in eleitos:
        print(f"  {e['projeto']}  ({e['nome']}, {ROTULO_DA_PERDA.get(e['motivo'], e['motivo'] or 'perdido')})")
    print(f"{len(guardados)} perdido(s) com demo no ar ficam de fora:")
    for nome, motivo in guardados:
        print(f"  {nome}: {motivo}")

    if quero_apagar:
        if nomes:
            desconhecidos = [n for n in nomes if n not in {e['projeto'] for e in eleitos}]
            if desconhecidos:
                print("não entram nos critérios, nada foi apagado: " + ", ".join(desconhecidos))
                return 2
            eleitos = [e for e in eleitos if e["projeto"] in nomes]
        if len(eleitos) > MAX_POR_RODADA:
            print(f"{len(eleitos)} entram; apago os {MAX_POR_RODADA} mais antigos em Perdido nesta rodada, o resto na próxima")
            eleitos = eleitos[:MAX_POR_RODADA]
        return apagar(eleitos)

    if eleitos and not simular:
        avisados = ler_json(ESTADO) or {}
        novos = [e for e in eleitos if e["projeto"] not in (avisados.get("projetos") or [])]
        if novos:
            linhas = [f"{len(eleitos)} demo(s) de leads em Perdido no CRM ainda no ar. Nada foi apagado agora; o timer das "
                      "09:50 apaga. Para apagar já, no Dell: site-demos-limpeza --apagar",
                      "(ou só alguns: site-demos-limpeza --apagar demo-x demo-y)"]
            linhas += [f"• {e['nome']}" for e in eleitos[:MAX_NOMES]]
            if len(eleitos) > MAX_NOMES:
                linhas.append(f"• e mais {len(eleitos) - MAX_NOMES}")
            # Só marca como avisado o que ficou na fila: sem a lib, o aviso que não
            # grava levanta (e o estado não é escrito); com ela, devolve False.
            if avisar("\n".join(linhas)):
                ESTADO.parent.mkdir(parents=True, exist_ok=True)
                tmp = ESTADO.with_suffix(".tmp")
                tmp.write_text(json.dumps({"projetos": sorted(e["projeto"] for e in eleitos)}, ensure_ascii=False), encoding="utf-8")
                tmp.replace(ESTADO)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv[1:]))
    except RuntimeError as e:
        print(e)
        sys.exit(1)
