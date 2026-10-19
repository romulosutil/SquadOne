#!/usr/bin/env python3
"""Pausa na Vercel o demo de quem recusou ou expirou há 15 dias (Dell, 30/09/2026).

Decisão do Rômulo (29/09/2026): demo de lead recusado ou expirado é PAUSADO na
Vercel 15 dias depois desse status. Pausar, nunca apagar: é reversível, e a
pasta continua em ~/auto-site e no espelho do Drive. Se o lead voltar (Desfazer
na página do lead, resposta de um expirado), o demo volta ao ar.

Quem está fora é a pasta que diz, porque é ela que muda na hora:
- _recusados/<slug>  -> recusado (botão "Recusou" da página do lead ou recusa
  anotada à mão, como o acervo de 25/09/2026);
- _concluidos/<slug> -> expirado (10 dias sem resposta; o Balcão move);
- raiz, _em-conversa/, _fechados/ -> no jogo: nunca pausa, e despausa o que
  este script pausou. "fechado" na planilha também veta a pausa.

Desde quando (a contagem dos 15 dias), da evidência mais firme para a mais fraca:
1. planilha (~/.local/share/n8n-estado/site-leads.json, retrato que o fluxo 07
   grava a cada hora; só vale com até 26 h): recusado_em; para expirado,
   enviado_em + 10 dias (a regra do 05 · Acompanhamento);
2. registro.md: linha "**Recusou.**" com o slug (data da linha);
3. ctime da pasta em _recusados/ ou _concluidos/ (o rename que a pôs lá);
   entre 2 e 3 vale a data MAIS RECENTE (conservador);
4. sem nada disso: o dia em que este script viu o lead fora pela primeira vez.
As datas 2-4 ficam congeladas no estado enquanto o lead continuar fora (a
ctime anda quando alguém mexe na pasta); a da planilha é relida a cada rodada.

Só toca em projeto "demo-*" que veio do publicado.json de um lead; só despausa
o que ele mesmo pausou. Estado em ~/.local/state/site-demos-pausa/estado.json
(o que está sendo contado, desde quando, e o que foi pausado quando) e cada
pausa/despausa em historico.jsonl. Um aviso ao Rômulo por rodada, só quando
algo mudou (fila do dell-status). Token: o da Vercel CLI (auth.json), renovado
pela própria CLI quando está para vencer; nunca é impresso.

Uso: site-demos-pausa            roda (timer diário, 09:40; o site-pastas também
                                 acorda este serviço depois de um botão da página)
     site-demos-pausa --simular  mostra o que faria, sem pausar nem gravar estado
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
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

HOME = Path.home()
AUTO = HOME / "auto-site"
REGISTRO = AUTO / "registro.md"
RETRATO = HOME / ".local/share/n8n-estado/site-leads.json"
ESTADO = HOME / ".local/state/site-demos-pausa/estado.json"
HISTORICO = ESTADO.with_name("historico.jsonl")
FILA_AVISOS = HOME / ".local/share/avisos/fila"
AUTH = HOME / ".local/share/com.vercel.cli/auth.json"
VERCEL_CLI = HOME / ".local/bin/vercel"
TIME_VERCEL = "team_fgUUHtNBYtsrwTNGwn2gzxF2"  # romulodesigns
API = "https://api.vercel.com"

DIAS_ATE_PAUSAR = 15
EXPIRA_DIAS = 10  # site-acompanhamento.py: expirado no 10º dia depois do envio
RETRATO_VELHO = timedelta(hours=26)
MAX_NOMES = 25  # no aviso; em 10/10/2026 o acervo inteiro (73) pausa de uma vez
MAX_FALHAS = 10  # no aviso; a falha de cada projeto fica em `falha` no estado.json
MAX_LINHA_FALHA = 200
TETO_DO_TEXTO = 3900  # o texto do aviso vai até 4000 (deploy/dell/README.md, "Fila de avisos"), com folga
SP = timezone(timedelta(hours=-3))  # São Paulo, sem horário de verão desde 2019
FORA = {"_recusados": "recusado", "_concluidos": "expirado"}
LUGARES = ["", "_em-conversa", "_concluidos", "_recusados", "_fechados"]
SLUG = re.compile(r"^[a-z0-9][a-z0-9._-]{0,179}$")

hoje = datetime.now(SP).date()


def ler_json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def dia_de(iso: str) -> date | None:
    try:
        t = datetime.fromisoformat(str(iso).strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return (t if t.tzinfo else t.replace(tzinfo=SP)).astimezone(SP).date()


# ---------------------------------------------------------------- quem está fora

def leads_publicados() -> list[dict]:
    """Um item por pasta com publicado.json (fora de _descartados/)."""
    leads = []
    for topo in LUGARES:
        base = AUTO / topo
        for recibo in sorted(base.glob("*/publicado.json")) if base.is_dir() else []:
            pasta = recibo.parent
            if pasta.name.startswith((".", "_")) or not SLUG.match(pasta.name):
                continue
            r = ler_json(recibo) or {}
            if r.get("apagado_em"):  # site-demos-limpeza apagou o projeto: pausar daria "não existe"
                continue
            if r.get("raio_x_projeto") == "prumo-raio-x" and not str(r.get("site_url") or "").strip():
                continue  # demo sob pedido (14/10/2026): o recibo só do Raio-X avulso não tem projeto demo-* para pausar
            projeto = str(r.get("vercel_project") or f"demo-{pasta.name}")
            leads.append({"place_id": str(r.get("place_id") or ""), "slug": pasta.name, "topo": topo,
                          "pasta": pasta, "nome": str(r.get("nome") or pasta.name), "projeto": projeto})
    return leads


def ler_retrato() -> tuple[dict, str]:
    """place_id -> linha da planilha, se o retrato do fluxo 07 tiver até 26 h."""
    d = ler_json(RETRATO)
    if not isinstance(d, dict):
        return {}, "sem retrato da planilha (site-leads.json)"
    try:
        gerado = datetime.fromisoformat(str(d.get("geradoEm")).replace("Z", "+00:00"))
    except ValueError:
        return {}, "retrato da planilha sem data"
    if datetime.now(timezone.utc) - gerado > RETRATO_VELHO:
        return {}, f"retrato da planilha velho ({gerado.astimezone(SP):%d/%m %H:%M}); só pastas e evidência local"
    return {str(l.get("place_id")): l for l in d.get("leads", []) if l.get("place_id")}, ""


def recusas_no_registro() -> dict:
    """slug -> data da linha "**Recusou.**" mais recente do registro.md."""
    datas = {}
    try:
        linhas = REGISTRO.read_text(encoding="utf-8").splitlines()
    except OSError:
        return datas
    for linha in linhas:
        celulas = [c.strip() for c in linha.strip().strip("|").split("|")]
        if len(celulas) < 5 or "**Recusou.**" not in linha:
            continue
        try:
            d = datetime.strptime(celulas[0], "%d/%m/%Y").date()
        except ValueError:
            continue
        datas[celulas[2]] = max(d, datas.get(celulas[2], d))
    return datas


def motivo_de(lead: dict, planilha: dict) -> str | None:
    if str(planilha.get("status", "")).strip() == "fechado":
        return None
    return FORA.get(lead["topo"])


def protecoes_do_crm() -> dict[str, str]:
    """Mesma proteção da limpeza: pasta antiga não autoriza tirar uma negociação do ar."""
    from importlib.machinery import SourceFileLoader
    from importlib.util import spec_from_loader, module_from_spec
    base = Path(__file__).resolve().parent
    arquivo = base / 'site-demos-limpeza.py'
    if not arquivo.is_file():
        arquivo = base / 'site-demos-limpeza'
    loader = SourceFileLoader('protecao_da_limpeza', str(arquivo))
    spec = spec_from_loader('protecao_da_limpeza', loader)
    modulo = module_from_spec(spec)
    try:
        loader.exec_module(modulo)
        return {l['chave']: modulo.motivo_protecao(l) for l in modulo.ler_crm() if l.get('produto') == 'site'}
    except Exception as e:
        raise RuntimeError('Sem CRM atual para conferir a proteção; nenhuma nova pausa autorizada') from e


def desde_da_planilha(motivo: str, planilha: dict) -> tuple[date | None, str]:
    status = str(planilha.get("status", "")).strip()
    if motivo == "recusado" and status == "recusado":
        d = dia_de(planilha.get("recusado_em", ""))
        return d, "planilha: recusado_em"
    if motivo == "expirado" and status == "expirado":
        d = dia_de(planilha.get("enviado_em", ""))
        return (d + timedelta(days=EXPIRA_DIAS) if d else None), "planilha: enviado_em + 10 dias (05 · Acompanhamento)"
    return None, ""


def desde_local(lead: dict, motivo: str, registro: dict) -> tuple[date, str]:
    """Evidência local; a mais recente entre registro.md e ctime (conservador)."""
    candidatas = []
    if motivo == "recusado" and lead["slug"] in registro:
        candidatas.append((registro[lead["slug"]], "registro.md (**Recusou.**)"))
    try:
        ctime = datetime.fromtimestamp(lead["pasta"].stat().st_ctime, SP).date()
        candidatas.append((ctime, f"ctime da pasta em {lead['topo']}/"))
    except OSError:
        pass
    if not candidatas:
        return hoje, "primeira vez visto fora"
    d = max(c[0] for c in candidatas)
    return d, " + ".join(n for c, n in candidatas if c == d)


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
    req = urllib.request.Request(url, method=metodo, data=b"{}" if metodo == "POST" else None,
                                 headers={"Authorization": f"Bearer {chave}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            t = r.read()
            return json.loads(t) if t else {}
    except urllib.error.HTTPError as e:
        corpo = e.read().decode(errors="replace")[:200]
        raise RuntimeError(f"{metodo} {caminho.split('?')[0]} -> {e.code}: {corpo}") from None


def projeto(nome: str, chave: str) -> dict | None:
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
    """O módulo da lib, ou None quando nenhuma cópia existe ou carrega: aí o
    avisar() volta ao jeito antigo e o aviso sai do mesmo modo que antes."""
    for pasta in PASTAS_DA_LIB:
        arquivo = pasta / "aviso.py"
        if not arquivo.is_file():
            continue
        try:
            spec = importlib.util.spec_from_file_location("mel_aviso", arquivo)
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
        except Exception:  # noqa: BLE001 — cópia quebrada não derruba a rodada: tenta a próxima
            continue
    return None


def avisar(texto: str) -> bool:
    """True quando o aviso ficou na fila. Com a lib nada levanta (fila ausente ou
    aviso recusado voltam False e o motivo vai ao journal); sem ela, como antes:
    ou grava, ou levanta."""
    aviso = {"titulo": "⏸️ Site antes da venda: demos", "texto": texto, "origem": "site-demos-pausa"}
    lib = lib_de_aviso()
    if lib is not None:
        # Os nomes vêm de planilha/CRM e as falhas da Vercel; se um deles trouxer
        # "R$" a lib recusaria o aviso inteiro, e calar uma pausa é pior que
        # mandá-lo sem o valor.
        if lib.VALOR_EM_REAIS.search(texto):
            aviso["texto"] = lib.sem_valores(texto)
        return lib.gravar(aviso, fila=FILA_AVISOS, prefixo="site-demos-pausa").gravado
    # Sem a lib instalada: o jeito de antes, sem mudar nada.
    FILA_AVISOS.mkdir(parents=True, exist_ok=True)
    (FILA_AVISOS / f"site-demos-pausa-{time.time_ns()}.json").write_text(json.dumps(aviso, ensure_ascii=False), encoding="utf-8")
    return True


def _montar_texto(pausados: list[dict], voltaram: list[dict], falhas: list[str], max_nomes: int, max_falhas: int) -> str:
    linhas = []
    if pausados:
        linhas += [f"Pausei {len(pausados)} demo(s) na Vercel (recusado ou expirado há {DIAS_ATE_PAUSAR}+ dias). "
                   "Nada foi apagado; a pasta continua em ~/auto-site."]
        linhas += [f"• {i['nome']} ({i['motivo']} desde {date.fromisoformat(i['desde']):%d/%m})" for i in pausados[:max_nomes]]
        if len(pausados) > max_nomes:
            linhas.append(f"• e mais {len(pausados) - max_nomes} (lista em {HISTORICO})")
    if voltaram:
        linhas += ([""] if linhas else []) + [f"De volta ao ar ({len(voltaram)}), o lead voltou:"]
        linhas += [f"• {d.get('nome')}" for d in voltaram[:max_nomes]]
        if len(voltaram) > max_nomes:
            linhas.append(f"• e mais {len(voltaram) - max_nomes} (lista em {HISTORICO})")
    if falhas:
        linhas += ([""] if linhas else []) + [f"Não consegui ({len(falhas)}):"]
        linhas += [f"• {f if len(f) <= MAX_LINHA_FALHA else f[:MAX_LINHA_FALHA - 1] + '…'}" for f in falhas[:max_falhas]]
        if len(falhas) > max_falhas:
            linhas.append(f"• e mais {len(falhas) - max_falhas} (cada uma em `falha` no {ESTADO})")
    return "\n".join(linhas)


def texto_do_aviso(pausados: list[dict], voltaram: list[dict], falhas: list[str]) -> str:
    """O aviso de uma rodada. Até 25 nomes em cada lista e 10 falhas (200 caracteres
    cada), com "e mais N" no resto; se ainda assim passar de TETO_DO_TEXTO, tenta com
    menos nomes e menos falhas. O teto do aviso é 4000 caracteres e cortar seco
    levaria o fim, que é onde está a lista do que NÃO deu certo."""
    for max_nomes, max_falhas in ((MAX_NOMES, MAX_FALHAS), (15, 6), (8, 4), (4, 2), (2, 1)):
        texto = _montar_texto(pausados, voltaram, falhas, max_nomes, max_falhas)
        if len(texto) <= TETO_DO_TEXTO:
            break
    return texto  # nomes enormes: o que passar de 4000 a lib corta, com a marca "(cortado)"


def anotar(evento: dict) -> None:
    HISTORICO.parent.mkdir(parents=True, exist_ok=True)
    with HISTORICO.open("a", encoding="utf-8") as f:
        f.write(json.dumps({"em": datetime.now(SP).isoformat(timespec="seconds"), **evento}, ensure_ascii=False) + "\n")


def main() -> int:
    simular = "--simular" in sys.argv[1:]
    protecoes = protecoes_do_crm()
    estado = ler_json(ESTADO) or {}
    antes = estado.get("projetos") or {}
    retrato, nota_retrato = ler_retrato()
    registro = recusas_no_registro()
    if nota_retrato:
        print(f"obs.: {nota_retrato}")

    agora_contando, pausar, despausar = {}, [], []
    vistos = set()
    for lead in leads_publicados():
        p = lead["projeto"]
        if not p.startswith("demo-") or p in vistos:
            continue
        vistos.add(p)
        planilha = retrato.get(lead["place_id"], {})
        motivo = motivo_de(lead, planilha)
        ant = antes.get(p) or {}
        if motivo and (lead['place_id'] not in protecoes or protecoes[lead['place_id']]):
            print(f"Preservado {p}: {protecoes.get(lead['place_id']) or 'lead sem confirmação atual no CRM'}")
            if ant:
                agora_contando[p] = ant
            continue
        if not motivo:
            if ant.get("pausado_em"):
                despausar.append({**ant, "projeto": p, "voltou_para": lead["topo"] or "raiz"})
            continue
        desde, evidencia = desde_da_planilha(motivo, planilha)
        if not desde:
            if ant.get("motivo") == motivo and ant.get("desde") and not str(ant.get("evidencia", "")).startswith("planilha"):
                desde, evidencia = date.fromisoformat(ant["desde"]), ant["evidencia"]  # congelada
            else:
                desde, evidencia = desde_local(lead, motivo, registro)
        item = {"place_id": lead["place_id"], "slug": lead["slug"], "nome": lead["nome"], "motivo": motivo,
                "desde": desde.isoformat(), "evidencia": evidencia,
                "pausa_em": (desde + timedelta(days=DIAS_ATE_PAUSAR)).isoformat()}
        for chave in ("pausado_em", "projeto_id", "falha"):
            if ant.get(chave):
                item[chave] = ant[chave]
        if not item.get("pausado_em") and hoje >= desde + timedelta(days=DIAS_ATE_PAUSAR):
            pausar.append(p)
        agora_contando[p] = item
    # Pausado por este script cujo lead sumiu das pastas (renomeado, descartado): fica pausado e na memória.
    for p, ant in antes.items():
        if ant.get("pausado_em") and p not in vistos:
            agora_contando[p] = ant

    if simular:
        pendentes = sorted((i["pausa_em"], p) for p, i in agora_contando.items() if p not in pausar and not i.get("pausado_em"))
        print(f"Pausaria agora ({len(pausar)}):")
        for p in pausar:
            i = agora_contando[p]
            print(f"  {p}  [{i['motivo']} desde {i['desde']}; {i['evidencia']}]")
        print(f"Já pausados por este script: {sum(1 for i in agora_contando.values() if i.get('pausado_em'))}")
        print(f"Despausaria ({len(despausar)}): " + ", ".join(d["projeto"] for d in despausar))
        print(f"Depois ({len(pendentes)}), por data de pausa:")
        for quando, p in pendentes:
            i = agora_contando[p]
            print(f"  {quando}  {p}  [{i['motivo']} desde {i['desde']}; {i['evidencia']}]")
        return 0

    pausados, voltaram, falhas = [], [], []
    # Falha só vira aviso na primeira vez (a mesma falha amanhã não é novidade).
    def falhou(i: dict, texto: str) -> None:
        if i.get("falha") != texto:
            falhas.append(f"{i.get('nome')}: {texto}")
        i["falha"] = texto

    if pausar or despausar:
        chave = token()
        for p in pausar:
            i = agora_contando[p]
            try:
                info = projeto(p, chave)
                if info is None:
                    falhou(i, f"projeto {p} não existe na Vercel")
                    continue
                if info.get("paused"):
                    # Pausado por outra mão: não é deste script, que então nunca o despausa.
                    i.pop("falha", None)
                    continue
                atuais = protecoes_do_crm()
                if i['place_id'] not in atuais or atuais[i['place_id']]:
                    falhou(i, 'contexto mudou ou está protegido no CRM; demo preservada')
                    continue
                # pause/unpause só aceitam o id (prj_...), não o nome.
                vercel("POST", f"/v1/projects/{info['id']}/pause", chave)
                i["pausado_em"], i["projeto_id"] = datetime.now(SP).isoformat(timespec="seconds"), info["id"]
                i.pop("falha", None)
                pausados.append(i)
                anotar({"acao": "pausou", "projeto": p, **{k: i[k] for k in ("nome", "motivo", "desde", "evidencia")}})
            except RuntimeError as e:
                falhou(i, str(e))
        for d in despausar:
            p = d["projeto"]
            try:
                info = projeto(p, chave)
                if info is not None and info.get("paused"):
                    vercel("POST", f"/v1/projects/{info['id']}/unpause", chave)
                voltaram.append(d)
                anotar({"acao": "despausou", "projeto": p, "nome": d.get("nome"), "voltou_para": d["voltou_para"]})
            except RuntimeError as e:
                # Continua na memória como pausado: a próxima rodada tenta de novo.
                agora_contando[p] = {k: v for k, v in d.items() if k not in ("projeto", "voltou_para")}
                falhou(agora_contando[p], f"não voltou ao ar: {e}")

    ESTADO.parent.mkdir(parents=True, exist_ok=True)
    tmp = ESTADO.with_suffix(".tmp")
    tmp.write_text(json.dumps({"atualizado": datetime.now(SP).isoformat(timespec="seconds"), "obs": nota_retrato,
                               "projetos": dict(sorted(agora_contando.items()))}, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(ESTADO)

    contando = sum(1 for i in agora_contando.values() if not i.get("pausado_em"))
    print(f"pausados agora: {len(pausados)}; voltaram ao ar: {len(voltaram)}; falhas: {len(falhas)}; "
          f"contando os 15 dias: {contando}")
    if pausados or voltaram or falhas:
        avisar(texto_do_aviso(pausados, voltaram, falhas))
    return 1 if falhas else 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except RuntimeError as e:  # token: um aviso, e o systemd registra a falha
        print(e)
        if "--simular" not in sys.argv[1:]:
            avisar(f"A pausa dos demos não rodou: {e}")
        sys.exit(1)
