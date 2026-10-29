"""Contexto canônico da Prumo em todo início de execução do n8n; sem IO na transformação."""
from copy import deepcopy
import hashlib
import json
import os
import shutil
import subprocess
from pathlib import Path

PREFIXO = "prumo-organizacao-"
GATILHOS = {"scheduleTrigger", "manualTrigger", "webhook", "executeWorkflowTrigger", "formTrigger", "errorTrigger", "cron"}


RECEITAS = ("isca", "porta", "projeto", "recorrente", "assinatura", "incubacao")
ORGANIZACAO = "00-contexto/organizacao.md"
CATALOGO = "06-qualidade/catalogo.json"
_BUSCADOS = set()


def raiz_padrao():
    return Path(os.environ.get("PRUMO_REPO") or str(Path.home() / "prumo"))


def _git(raiz, *args, timeout=20):
    """Saída do git em bytes, ou None. Sem prompt de senha: falha vira None, nunca trava o timer."""
    git = shutil.which("git")
    if not git:
        return None
    try:
        r = subprocess.run([git, "-C", str(raiz), *args], capture_output=True, stdin=subprocess.DEVNULL, timeout=timeout,
                           env={**os.environ, "GIT_TERMINAL_PROMPT": "0"})
    except (OSError, subprocess.SubprocessError):
        return None
    return r.stdout if r.returncode == 0 else None


def ler_da_prumo(raiz, caminho, buscar=True):
    """(texto, lido_de) de um arquivo da Prumo, preferindo a origin/main à árvore de trabalho.

    29/10/2026: o ~/prumo da Mel estava 46 commits atrás e com 22 arquivos mexidos à mão por outro trabalho;
    o contexto lia um catálogo velho, e um `git pull` automático ali atropelaria esse trabalho. Então: fetch
    (só atualiza a referência remota) e `git show origin/main:<caminho>`, a mesma main que `origem` declara,
    sem tocar a árvore. Fetch que falha usa a origin/main já conhecida; sem repositório ou sem o arquivo
    nela, cai no disco. Nunca pull, checkout nem reset.

    lido_de = "origin/main@<commit>" (o último commit da main que mexeu NESTE arquivo: commit alheio na Prumo
    não muda o contexto nem regrava os fluxos do n8n) ou "disco"."""
    raiz = Path(raiz)
    if (raiz / ".git").exists():  # só a raiz do repo: subpasta de outro repo não pode ler o git do pai
        # Um fetch por raiz por processo: o n8n.py carrega o contexto a cada PUT de fluxo do escopo.
        if buscar and raiz.resolve() not in _BUSCADOS:
            _BUSCADOS.add(raiz.resolve())
            _git(raiz, "fetch", "-q", "origin", "main", timeout=60)
        texto = _git(raiz, "show", f"origin/main:{caminho}")
        commit = _git(raiz, "log", "-1", "--format=%h", "origin/main", "--", caminho)
        if texto is not None and commit and commit.strip():
            return texto.decode("utf-8"), "origin/main@" + commit.decode().strip()
    return (raiz / caminho).read_text(encoding="utf-8"), "disco"


def comercial(catalogo):
    """{id: {receita, funil}} só dos produtos que já trazem os dois campos (catálogo antigo: fica de fora)."""
    saida = {}
    for p in catalogo.get("produtos", []):
        if p.get("receita") in RECEITAS and isinstance(p.get("funil"), bool):
            saida[p["id"]] = {"receita": p["receita"], "funil": p["funil"]}
    return saida


def carregar(raiz=None, buscar=True):
    raiz = Path(raiz) if raiz else raiz_padrao()
    doc, de_doc = ler_da_prumo(raiz, ORGANIZACAO, buscar)
    doc = doc.replace("\r\n", "\n")
    texto, de_cat = ler_da_prumo(raiz, CATALOGO, buscar=False)  # um fetch só por carga
    catalogo = json.loads(texto)
    return {"versao": 1, "organizacao_sha256": hashlib.sha256(doc.encode()).hexdigest(),
            "origem": "https://github.com/romulosutil/prumo/blob/main/00-contexto/organizacao.md",
            "lido_de": de_doc if de_doc == de_cat else f"organizacao {de_doc}; catalogo {de_cat}",
            "organizacao": doc, "familias": catalogo["familias"],
            "produtos": {p["id"]: p["nome"] for p in catalogo["produtos"]},
            "comercial": comercial(catalogo),
            "regra": "Profissional exige 100% dos obrigatórios e IQS completo. Pronto no funil não é selo de qualidade. A publicação é validada pelo executor sobre os bytes finais."
                     " Produto com funil false ou receita incubacao (em comercial) não é oferecido a lead: nem convite, nem proposta, nem preço.",
            "indices": {"conformidade": "0–100% dos obrigatórios", "iqs": "Comunicação e Estrutura, 50% cada", "indice_prumo": "0–18, diagnóstico do cliente"}}


def do_escopo(wf):
    nome = wf.get("name", "").casefold()
    return any(x in nome for x in ("prumo", "site antes da venda", "01 · caçador", "whatsapp —", "04 · clique no wa_link", "00 · avisar falha"))


def preparar(wf, contexto, forcar=False):
    if not forcar and not do_escopo(wf):
        return wf
    out = deepcopy(wf)
    codigo = ("// Gerado de prumo/00-contexto/organizacao.md. Não editar a cópia.\n"
              "const contexto = " + json.dumps(contexto, ensure_ascii=False) + ";\n"
              "if (contexto.versao !== 1 || !contexto.organizacao_sha256) throw new Error('Contexto Prumo inválido');\n"
              "$getWorkflowStaticData('global').prumo_contexto = contexto;\n"
              "return $input.all();")
    nos = out.setdefault("nodes", [])
    conexoes = out.setdefault("connections", {})
    for n in list(nos):
        # O contexto também acompanha subworkflows de persistência reconstruídos pelos outros guards.
        p = n.get("parameters", {})
        filho = p.get("workflowJson")
        if isinstance(filho, str):
            try:
                p["workflowJson"] = json.dumps(preparar(json.loads(filho), contexto, True), ensure_ascii=False)
            except json.JSONDecodeError:
                pass
        if n.get("disabled") or n.get("type", "").split(".")[-1] not in GATILHOS:
            continue
        id_ = PREFIXO + n["id"]
        nome = "Prumo · organização · " + n["name"]
        existentes = [x for x in nos if x.get("id") == id_ or x.get("id", "").startswith(id_ + " · ")]
        if existentes:
            for existente in existentes:
                existente["parameters"]["jsCode"] = codigo
                existente["notes"] = "Fonte canônica: " + contexto["origem"] + " · SHA256 " + contexto["organizacao_sha256"]
            continue
        saida = conexoes.get(n["name"])
        if not saida or not saida.get("main"):
            continue
        # Um nó por saída preserva o roteamento original de webhooks com múltiplos ramos.
        for indice, destinos in enumerate(saida["main"]):
            if not destinos:
                continue
            sufixo = "" if indice == 0 else f" · {indice}"
            novo = {"id": id_ + sufixo, "name": nome + sufixo, "type": "n8n-nodes-base.code", "typeVersion": 2,
                    "position": [n.get("position", [0, 0])[0] + 160, n.get("position", [0, 0])[1] + 100 * indice],
                    "parameters": {"mode": "runOnceForAllItems", "jsCode": codigo},
                    "notes": "Fonte canônica: " + contexto["origem"] + " · SHA256 " + contexto["organizacao_sha256"]}
            nos.append(novo)
            conexoes[novo["name"]] = {"main": [deepcopy(destinos)]}
            destinos[:] = [{"node": novo["name"], "type": "main", "index": 0}]
    return out
