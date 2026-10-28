#!/usr/bin/env python3
"""Oferta nova do PRUMO: um bloco em prumo-ofertas.json + este comando. 28/10/2026. Sem rede.

Pedido do Rômulo (vai criar mais três ofertas): que seja fácil. Antes eram ~50 pontos em ~35 arquivos,
metade calada (ops/n8n/NOVA-OFERTA.md). Agora o lado Python/n8n deriva do JSON (ofertas.py) e o lado TS
é gerado (scripts/ofertas-gerar.ts); sobra o texto de negócio e os passos na Mel, que este comando lista.

  python3 nova-oferta.py <id> --como iris [--rotulo "Prisma PDV" --plural lojas --aba Lojas --sigla PDV --empresa loja]
      Cria `ofertas.<id>` no JSON copiando a estrutura da oferta-modelo, com os nomes derivados
      (convite-<id>, caçador e clique "PRUMO · <rótulo> — ...", webhook_id novo, sala prumo--<id>,
      link planilha<Id>, tipo "propria", teto 15) e "TODO: ..." em todo campo de negócio. Nunca
      sobrescreve uma oferta; insere o texto no fim do bloco "ofertas" sem reescrever o resto do arquivo.

  python3 nova-oferta.py --conferir [<id>]
      Lint da oferta (ou de todas), código gerado de todas as ofertas com `node --check`, testes Python de
      contrato e, no fim, o que falta, na ordem: lado TS, listas escritas fora de claude-ops, decisões e
      os passos na Mel. Sai com 1 se houver o que corrigir antes de publicar.

  --arquivo <json>  outro registro (testes: nunca o JSON real).  --sem-testes  pula os testes Python.

NUNCA publica, nunca chama a API do n8n, nunca liga caçador (--ativar é decisão do Rômulo, oferta por oferta).
"""
import argparse
import contextlib
import copy
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

AQUI = Path(__file__).resolve().parent
sys.dont_write_bytecode = True  # roda também no checkout de produção da Mel: não deixa __pycache__ lá
sys.path.insert(0, str(AQUI))
import ofertas as registro  # noqa: E402
import prospeccao_contrato  # noqa: E402

DEPLOY = AQUI.parent.parent
REPO = DEPLOY.parent
TODO = "TODO"
# Campos de negócio: o Rômulo (ou quem cria a oferta) escreve; nada aqui é derivável com segurança.
NEGOCIO = {
    "rotulo": "TODO: nome longo (Ficha, aviso do caçador, prefixo do Motivo em Descartados)",
    "sigla": "TODO: nome curto único (chip, cartão, Próxima venda)",
    "aba": "TODO: aba na planilha do PRUMO (única; não Prospects, Descartados, CRM nem Leads)",
    "empresa": "TODO: palavra do convite quando o nome da empresa é ilegível",
    "plural": "TODO: plural do público (\"Fora do segmento (nada de <plural>...)\")",
    "segmento": "TODO: regex sem acento que tem de casar no nome, tipo do Google ou site",
    "fora": "TODO: regex do que é do ramo mas não é cliente (descarte \"Fora do perfil (<tipo>)\")",
    "perfil": "TODO: regex do perfil obrigatório (nome, tipo ou site)",
    "perfil_motivo": "TODO: motivo do descarte sem perfil",
    "fora_sem_perfil": "TODO: regex do que, sem perfil, é descartado",
    "fora_sem_perfil_motivo": "TODO: motivo desse descarte",
    "cacador_rotulo": "TODO: \"Encontrado pelo Caçador de <plural>\" (o de onde veio da Ficha)",
    "fonte": "TODO: \"PRUMO — <aba> (<rótulo>)\" (nome da fonte na Central)",
    "mensagem": "TODO: {OLA}! Sou o Rômulo, do Prumo. <o que é, sem prometer o que não existe>\n\n<uma pergunta só, com {NOME}>?",
    "proxima_enviado": "TODO: a Próxima ação que o observador grava quando o convite sai",
}
NEGOCIO_LISTAS = {
    "nichos": ["TODO: busca curta no Google Places (a que rende mais primeiro)"],
    "cidades": ["TODO: cidade UF"],
    "sinais": [["TODO: rótulo do sinal", "TODO: regex do sinal"]],
}
CONVERSA = {"o_que_foi": "TODO: o que o convite ofereceu, para o Gemini (sem dado de ninguém)",
            "interesse": "TODO: o passo de quem respondeu com interesse"}
# Opcionais da triagem: na oferta nova nascem desligados (vazio), nunca copiados do modelo.
OPCIONAIS = ("solo", "instituicao", "fora_entidade", "site_diretorio", "fora_entidade_motivo", "site_diretorio_motivo")
MENSAGEM_ABRE = "{OLA}! Sou o Rômulo, do Prumo."
# src/operations/glossario.ts: "CRM" solto é proibido na tela, exceto "CRM de estamparia" e "CRM da Silmer".
CRM_SOLTO = re.compile(r"(?<!aba )(?<!· )\bCRM\b(?! de estamparia| da Silmer)")
TESTES_PYTHON = ("ofertas.test.py", "prospeccao_contrato.test.py", "crm.test.py")
# Listas que ficaram escritas de propósito em arquivos instalados fora de claude-ops (sem o JSON ao lado).
LISTAS_ESCRITAS = (
    ("deploy/dell/whatsapp-observador/observador.py", "ROTULO", "rótulo do aviso do observador"),
    ("deploy/dell/publicador-crm.py", "FONTES", "fontes aceitas pelo publicador do retrato"),
    ("deploy/dell/aquisicao-guarda.py", "WORKFLOWS", "caçadores com posse exclusiva (daemon)"),
    ("deploy/dell/frente-comercial.py", "PRODUTOS_DO_FUNIL", "métricas do funil do time comercial"),
    ("deploy/hermes/scripts/ler_comercial.py", "PRODUTOS", "produtos da consulta do Hermes"),
)


# ------------------------------------------------------------------ criar

def _atomico(arquivo, texto):
    tmp = arquivo.with_name(arquivo.name + ".novo")
    tmp.write_text(texto, encoding="utf-8", newline="\n")
    os.replace(tmp, arquivo)


def bloco_novo(cfg, id_, como, rotulo=None, plural=None, aba=None, sigla=None, empresa=None):
    """O bloco da oferta nova: a ordem de chaves do modelo, nomes derivados e TODO no negócio."""
    if not registro.ID.fullmatch(id_ or "") or id_ in registro.RESERVADOS:
        raise SystemExit(f"id {id_!r}: use 3 a 12 letras minúsculas, fora de {', '.join(sorted(registro.PRODUTOS_FORA_DO_REGISTRO + ('registros',)))}"
                         " e das palavras do código gerado.")
    if id_ in cfg["ofertas"]:
        raise SystemExit(f"a oferta {id_!r} já existe em prumo-ofertas.json: nada foi mudado (nunca sobrescrevo).")
    if como not in cfg["ofertas"]:
        raise SystemExit(f"--como {como!r}: modelo inexistente (há: {', '.join(cfg['ofertas'])}).")
    modelo = cfg["ofertas"][como]
    valores = {**NEGOCIO, **{k: copy.deepcopy(v) for k, v in NEGOCIO_LISTAS.items()}, "conversa": dict(CONVERSA)}
    for k, v in (("rotulo", rotulo), ("plural", plural), ("aba", aba), ("sigla", sigla), ("empresa", empresa)):
        if v:
            valores[k] = v
    r = rotulo or "TODO: rótulo"
    p = plural or "TODO: plural"
    derivados = {
        "tipo": "propria",
        "sala": f"prumo--{id_}",
        "link_retrato": "planilha" + id_.capitalize(),
        # Nome do workflow: achado e trocado POR NOME. Depois de publicado, não mude (nasceria um segundo).
        "fluxo": f"PRUMO · {r} — Caçador de {p}",
        "clique": f"PRUMO · {r} — Clique em Enviar convite",
        "convite": f"convite-{id_}",
        "webhook_id": str(uuid.uuid4()),
        "teto_por_rodada": 15,
    }
    if plural:
        valores["cacador_rotulo"] = f"Encontrado pelo Caçador de {plural}"
    if rotulo and aba:
        valores["fonte"] = f"PRUMO — {aba} ({rotulo})"
    usados = {o.get("webhook_id") for o in cfg["ofertas"].values()}
    while derivados["webhook_id"] in usados:
        derivados["webhook_id"] = str(uuid.uuid4())
    bloco = {"_nova": f"Criada por nova-oferta.py a partir de '{como}'. Troque todo TODO e rode `python3 nova-oferta.py --conferir {id_}`."
                      " Caçador nasce desligado; ligar é decisão do Rômulo (prumo-ofertas.py --ativar " + id_ + ")."}
    for k in modelo:
        if k.startswith("_"):
            continue  # notas do modelo falam dele, não da oferta nova
        if k in derivados:
            bloco[k] = derivados[k]
        elif k in valores:
            bloco[k] = valores[k]
        elif k in OPCIONAIS:
            bloco[k] = ""
        else:
            raise SystemExit(f"campo {k!r} do modelo {como!r} sem regra em nova-oferta.py: acrescente-o em NEGOCIO ou OPCIONAIS.")
    for k, v in {**derivados, **valores}.items():
        bloco.setdefault(k, v)  # campo que o modelo não tem mas o contrato exige
    return bloco


def criar(arquivo, id_, como, **nomes):
    """Insere o bloco no fim de "ofertas" sem reescrever o resto. Confere que nada mais mudou."""
    arquivo = Path(arquivo)
    texto = arquivo.read_text(encoding="utf-8")
    cfg = registro.carregar(arquivo)
    bloco = bloco_novo(cfg, id_, como, **nomes)
    fim = re.search(r"\n    }\n  }\n}\s*$", texto)
    if not fim or list(json.loads(texto))[-1] != "ofertas":
        raise SystemExit("prumo-ofertas.json fora do formato esperado (\"ofertas\" por último, indentação de 2): nada foi mudado.")
    corpo = json.dumps(bloco, ensure_ascii=False, indent=2).replace("\n", "\n    ")
    novo = texto[:fim.start()] + "\n    },\n    " + json.dumps(id_) + ": " + corpo + texto[fim.start() + len("\n    }"):]
    depois = json.loads(novo)
    antes = json.loads(texto)
    # Prova de que só entrou o bloco: o resto do JSON é o mesmo, e o texto até o ponto de inserção também.
    if ({k: v for k, v in depois.items() if k != "ofertas"} != {k: v for k, v in antes.items() if k != "ofertas"}
            or {k: v for k, v in depois["ofertas"].items() if k != id_} != antes["ofertas"]
            or depois["ofertas"][id_] != bloco or not novo.startswith(texto[:fim.start()])):
        raise SystemExit("a inserção mudaria outra coisa além da oferta nova: nada foi gravado.")
    _atomico(arquivo, novo)
    return bloco


# ------------------------------------------------------------------ conferir

def _textos(valor, caminho=""):
    if isinstance(valor, str):
        yield caminho, valor
    elif isinstance(valor, dict):
        for k, v in valor.items():
            yield from _textos(v, f"{caminho}.{k}" if caminho else k)
    elif isinstance(valor, list):
        for i, v in enumerate(valor):
            yield from _textos(v, f"{caminho}[{i}]")


def _regex(fonte):
    """Compila como o triar.js (sem acento, 'i'); com node, pelo próprio motor do JavaScript."""
    if "\b" in fonte:
        return "tem um backspace (\\b virou caractere ao editar pelo shell)"
    node = shutil.which("node")
    if node:
        r = subprocess.run([node, "-e", "new RegExp(process.argv[1], 'i')", fonte], capture_output=True, text=True, encoding="utf-8")
        return None if r.returncode == 0 else (r.stderr.strip().splitlines() or ["inválida"])[-1][:160]
    try:
        re.compile(fonte, re.I)
    except re.error as e:
        return str(e)
    return None


def problemas_da_oferta(cfg, id_):
    """O que impede publicar esta oferta. Lista vazia = pronta para os passos na Mel."""
    o = cfg["ofertas"][id_]
    p = []
    todo = [c for c, t in _textos(o) if TODO in t and not c.startswith("_")]
    if todo:
        p.append("campos ainda com TODO: " + ", ".join(todo))
    try:
        prospeccao_contrato.contrato_oferta(cfg, id_)
    except ValueError as e:
        p.append(f"contrato: {e}")
    if not registro.ID.fullmatch(id_) or id_ in registro.RESERVADOS:
        p.append("id: 3 a 12 letras minúsculas, fora de site/prumo/plus/registros e das palavras do código gerado")
    if o.get("aba") in registro.ABAS_RESERVADAS:
        p.append(f"aba {o.get('aba')!r} é de outro dono (Prospects, Descartados, CRM, Leads)")
    teto = o.get("teto_por_rodada")
    if type(teto) is not int or not 1 <= teto <= 15:
        p.append("teto_por_rodada: inteiro de 1 a 15 (o teto diário de primeiros contatos é um só para todas)")
    for k in ("nichos", "cidades"):
        if not isinstance(o.get(k), list) or not o[k]:
            p.append(f"{k}: lista não vazia")
    fontes = [(k, o.get(k)) for k in ("segmento", "fora", "perfil", "fora_sem_perfil", *OPCIONAIS[:4])]
    fontes += [(f"sinais[{i}]", s[1]) for i, s in enumerate(o.get("sinais") or []) if isinstance(s, list) and len(s) == 2]
    for k, fonte in fontes:
        if isinstance(fonte, str) and fonte and TODO not in fonte:
            erro = _regex(fonte)
            if erro:
                p.append(f"regex {k}: {erro}")
    m = o.get("mensagem")
    if isinstance(m, str) and TODO not in m:
        if not m.startswith(MENSAGEM_ABRE):
            p.append(f"mensagem: começa por {MENSAGEM_ABRE!r} (Rômulo e Prumo identificados)")
        if "{NOME}" not in m:
            p.append("mensagem: falta {NOME}")
        if m.count("?") != 1:
            p.append(f"mensagem: uma pergunta só (tem {m.count('?')})")
        for padrao, nome in ((r"R\$", "R$"), (r"https?://|www\.", "link"), (r"fundador", "\"fundador\""), (r"desconto", "\"desconto\"")):
            if re.search(padrao, m, re.I):
                p.append(f"mensagem: sem {nome}")
    for k in ("rotulo", "sigla", "cacador_rotulo", "fonte"):
        if isinstance(o.get(k), str) and CRM_SOLTO.search(o[k]):
            p.append(f"{k}: \"CRM\" solto é proibido na tela (src/operations/glossario.ts); use \"CRM de ...\" aprovado ou outro nome")
    if isinstance(o.get("fluxo"), str) and TODO in o["fluxo"] and TODO not in str(o.get("rotulo")) + str(o.get("plural")):
        p.append(f"fluxo/clique ainda com TODO; sugestão: \"PRUMO · {o['rotulo']} — Caçador de {o['plural']}\" e"
                 f" \"PRUMO · {o['rotulo']} — Clique em Enviar convite\" (depois de publicado, nunca renomeie)")
    catalogo = REPO.parent / "prumo/06-qualidade/catalogo.json"
    if o.get("catalogo_prumo") and catalogo.exists():
        ids_catalogo = {x.get("id") for x in json.loads(catalogo.read_text(encoding="utf-8")).get("produtos", [])}
        if o["catalogo_prumo"] not in ids_catalogo:
            p.append(f"catalogo_prumo {o['catalogo_prumo']!r} não está em prumo/06-qualidade/catalogo.json (qualidade.py --novo-produto)")
    return list(dict.fromkeys(p))


@contextlib.contextmanager
def _home_falso():
    """Os geradores importam n8n.py, que lê a chave do n8n na importação: HOME temporário com uma chave falsa.
    Nada é chamado na rede; só montamos o código."""
    with tempfile.TemporaryDirectory() as tmp:
        chave = Path(tmp) / ".config/claude-ops/n8n-api-key"
        chave.parent.mkdir(parents=True)
        chave.write_text("nova-oferta-sem-acesso")
        with patch.object(Path, "home", return_value=Path(tmp)):
            yield Path(tmp)


def _modulo(nome, arquivo):
    spec = importlib.util.spec_from_file_location(nome, AQUI / arquivo)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def codigo_gerado(cfg):
    """{descrição: código JS} dos nós Code de TODAS as ofertas (caçador, escolha, clique) e do 08 · CRM."""
    saida = {}
    with _home_falso():
        po = _modulo("nova_oferta_prumo_ofertas", "prumo-ofertas.py")
        crm = _modulo("nova_oferta_crm", "crm.py")
    po.CONFIG = cfg
    for (oferta, no), js in po.codigo_das_ofertas().items():
        saida[f"{oferta} · {no}"] = js
    saida["08 · CRM · Montar retrato"] = crm.montar_js(config=cfg)
    saida["08 · CRM · Validar registro"] = crm.validar_js(cfg)
    with patch.object(crm, "REGISTRO", cfg):
        crm.fluxo("erro", {"httpHeaderAuth": {"id": "x", "name": "CRM Central"}})  # nós e ids únicos
    return saida


def node_check(codigos):
    node = shutil.which("node")
    if not node:
        return None
    erros = []
    with tempfile.TemporaryDirectory() as tmp:
        for i, (nome, js) in enumerate(codigos.items()):
            f = Path(tmp) / f"no-{i}.js"
            f.write_text("(async function () {\n" + js + "\n});\n", encoding="utf-8")
            r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True, encoding="utf-8")
            if r.returncode:
                erros.append(f"{nome}: {(r.stderr.strip().splitlines() or ['erro'])[-1][:200]}")
    return erros


def _constante(arquivo, nome):
    import ast
    for n in ast.parse(Path(arquivo).read_text(encoding="utf-8")).body:
        if isinstance(n, ast.Assign) and any(isinstance(t, ast.Name) and t.id == nome for t in n.targets):
            v = n.value
            if isinstance(v, ast.Call) and getattr(v.func, "id", "") in ("frozenset", "set") and v.args:
                return set(ast.literal_eval(v.args[0]))
            return ast.literal_eval(v)
    return None


def listas_escritas(cfg):
    """[(arquivo, nome, o que é, ok, o que deveria ser)] das listas que ficaram escritas fora de claude-ops."""
    ids = registro.ids(cfg)
    esperado = {
        "ROTULO": {"site": "Site antes da venda", "prumo": "PRUMO", **{k: cfg["ofertas"][k].get("rotulo") for k in ids}},
        "FONTES": set(registro.fontes_do_retrato(cfg)),
        "WORKFLOWS": {"01 · Caçador", *(cfg["ofertas"][k].get("fluxo") for k in ids)},
        "PRODUTOS_DO_FUNIL": tuple(registro.produtos_do_crm(cfg)),
        "PRODUTOS": set(registro.produtos_do_crm(cfg)),
    }
    saida = []
    for arquivo, nome, oque in LISTAS_ESCRITAS:
        if not (REPO / arquivo).exists():
            # Cópia instalada (~/.local/share/claude-ops): o resto do repo não está ao lado.
            saida.append((arquivo, nome, oque + "; arquivo não achado: rode no checkout do repo", False, esperado[nome]))
            continue
        atual = _constante(REPO / arquivo, nome)
        saida.append((arquivo, nome, oque, atual == esperado[nome], esperado[nome]))
    return saida


def testes_python():
    """Os testes de contrato contra o JSON real (num HOME temporário; nada vai à rede)."""
    saida = []
    with tempfile.TemporaryDirectory() as tmp:
        chave = Path(tmp) / ".config/claude-ops/n8n-api-key"
        chave.parent.mkdir(parents=True)
        chave.write_text("nova-oferta-sem-acesso")
        env = {**os.environ, "HOME": tmp, "USERPROFILE": tmp, "PYTHONUTF8": "1", "PYTHONDONTWRITEBYTECODE": "1"}
        for t in TESTES_PYTHON:
            r = subprocess.run([sys.executable, t], cwd=AQUI, env=env, capture_output=True, text=True, encoding="utf-8")
            falhas = [l for l in r.stderr.splitlines() if l.startswith(("FAIL:", "ERROR:"))]
            saida.append((t, r.returncode == 0, falhas or [l for l in r.stderr.splitlines()[-1:]]))
    return saida


def passos(ids_alvo):
    alvo = ", ".join(ids_alvo) or "<id>"
    um = ids_alvo[0] if len(ids_alvo) == 1 else "<id>"
    return [
        "No PC, lado TS (o gerador lê o mesmo JSON): `npx tsx scripts/ofertas-gerar.ts`, depois `npx vue-tsc --noEmit` e `npm test`.",
        "Decisões que o JSON não toma (o código fica fechado para a oferta nova até alguém decidir):"
        " preço (crm.py OFERTAS_COM_TABELA e a Central: sem preço aprovado, valor e pagamento são recusados);"
        " time comercial automático (deploy/dell/frente-comercial.py OFERTAS_DO_EXECUTOR: fora dele, só o Rômulo aborda);"
        " Plus (server/plus-*.ts) só se o Plus puder mandar a oferta.",
        "Documentação no mesmo commit: CLAUDE.md (Perfis), ARCHITECTURE.md (tabela de salas),"
        " docs/referencia/perfis-e-experimentos.md, docs/blueprint/servico.json (cartões OFERTAS-*), ops/n8n/CATALOGO.md;"
        " no repo prumo: 00-contexto/produtos.md (ficha), 06-qualidade/catalogo.json, decisoes.md, glossario.md.",
        "Commit e push na main. Na Mel, nesta ordem (nada liga caçador):",
        "  1. reinstalar o que mudou: `dell-status --instalados` (prumo-ofertas.json vai para ~/.local/share/claude-ops/;"
        " as listas escritas acima, para ~/.local/bin e ~/.hermes/scripts).",
        "  2. `cd ~/SquadOne/deploy/dell/claude-ops && python3 nova-oferta.py --conferir " + um + "` (de novo, lá, com o"
        " node da Mel; só lê, não grava nada no checkout).",
        "  3. `python3 prumo-ofertas.py`: aba nova na planilha, caçador DESLIGADO e o clique convite-" + um + ".",
        "  4. `python3 crm.py`: o 08 · CRM passa a ler a aba; confira no retrato a fonte nova com contagem.",
        "  5. `python3 whatsapp-conversa.py`: os três fluxos do WhatsApp leem a aba; com o opt-in"
        " ~/.config/claude-ops/workflow-contexto-whatsapp.json, confira que a guarda aceitou a cadeia (uma leitura de"
        " Sheets a mais por chamada). Reinicie o observador (whatsapp-observador e whatsapp-observador-prumo).",
        "  6. Roster de produção: sala prumo--" + um + " com PO e escopo \"Não cuida de\" (✎ na Central). A squad PRUMO"
        " tem 9 salas no máximo.",
        "  7. `python3 prumo-ofertas.py --estado`: o caçador de " + alvo + " tem de aparecer DESLIGADO.",
        "  Ligar o caçador: só com aprovação específica do Rômulo (`python3 prumo-ofertas.py --ativar " + um + "`).",
    ]


def conferir(arquivo, ids_alvo, rodar_testes=True):
    cfg = registro.carregar(arquivo)
    ids_alvo = ids_alvo or registro.ids(cfg)
    for k in ids_alvo:
        if k not in cfg["ofertas"]:
            raise SystemExit(f"oferta {k!r} não está em {arquivo}.")
    bloqueios = 0
    print(f"== registro: {arquivo} ({', '.join(cfg['ofertas'])})")
    for k in ids_alvo:
        p = problemas_da_oferta(cfg, k)
        bloqueios += len(p)
        print(f"-- {k}: " + ("ok" if not p else f"{len(p)} problema(s)"))
        for x in p:
            print(f"   - {x}")
    outras = [k for k in cfg["ofertas"] if k not in ids_alvo]
    for k in outras:
        try:
            prospeccao_contrato.contrato_oferta(cfg, k)
        except ValueError as e:
            bloqueios += 1
            print(f"-- {k} (já existente): contrato: {e}")
    print("== código gerado (todas as ofertas e o 08 · CRM)")
    try:
        codigos = codigo_gerado(cfg)
        erros = node_check(codigos)
        if erros is None:
            print(f"   {len(codigos)} nós montados; node ausente aqui: rode `--conferir` de novo na Mel.")
        else:
            bloqueios += len(erros)
            print(f"   {len(codigos)} nós, node --check: " + ("ok" if not erros else f"{len(erros)} com erro"))
            for e in erros:
                print(f"   - {e}")
    except (SystemExit, Exception) as e:  # noqa: BLE001
        bloqueios += 1
        print(f"   não montou: {type(e).__name__}: {e}")
    if rodar_testes and Path(arquivo).resolve() == registro.ARQUIVO:
        print("== testes Python de contrato")
        for t, ok, detalhes in testes_python():
            print(f"   {t}: " + ("ok" if ok else "FALHOU"))
            if not ok:
                bloqueios += 1
                for d in detalhes[:6]:
                    print(f"     {d}")
    elif rodar_testes:
        print("== testes Python: pulados (só valem contra o prumo-ofertas.json ao lado deste arquivo)")
    print("== listas escritas fora de claude-ops (não têm o JSON ao lado; ofertas.test.py confere)")
    faltam = []
    for arquivo_lista, nome, oque, ok, esperado in listas_escritas(cfg):
        print(f"   {'ok   ' if ok else 'FALTA'} {arquivo_lista} {nome} ({oque})")
        if not ok:
            texto = ("{" + ", ".join(repr(x) for x in sorted(esperado)) + "}") if isinstance(esperado, set) else repr(esperado)
            faltam.append(f"{arquivo_lista}: {nome} = {texto}")
    print("\n== O que falta, na ordem")
    n = 0
    if bloqueios:
        n += 1
        print(f"{n}. Corrigir os {bloqueios} problema(s) acima e rodar `python3 nova-oferta.py --conferir {' '.join(ids_alvo)}` de novo.")
    if faltam:
        n += 1
        print(f"{n}. Atualizar as listas escritas (mesmo texto do JSON):")
        for f in faltam:
            print(f"   - {f}")
    for passo in passos(ids_alvo):
        if passo.startswith("  "):
            print("   " + passo.strip())
        else:
            n += 1
            print(f"{n}. {passo}")
    print("\nNada foi publicado nem ligado.")
    return 1 if bloqueios or faltam else 0


def main(argv=None):
    a = argparse.ArgumentParser(description="Oferta nova do PRUMO (sem rede; nunca publica nem liga caçador).")
    a.add_argument("id", nargs="*", help="id da oferta (3 a 12 letras minúsculas)")
    a.add_argument("--como", help="oferta-modelo para copiar a estrutura (ex.: iris)")
    a.add_argument("--conferir", action="store_true", help="lint, código gerado, testes e o que falta")
    a.add_argument("--arquivo", default=str(registro.ARQUIVO), help="registro (padrão: prumo-ofertas.json ao lado)")
    a.add_argument("--sem-testes", action="store_true")
    for campo in ("rotulo", "plural", "aba", "sigla", "empresa"):
        a.add_argument(f"--{campo}")
    args = a.parse_args(argv)
    if args.conferir:
        return conferir(args.arquivo, args.id, rodar_testes=not args.sem_testes)
    if len(args.id) != 1 or not args.como:
        a.error("use `nova-oferta.py <id> --como <modelo>` ou `nova-oferta.py --conferir [<id>]`")
    bloco = criar(args.arquivo, args.id[0], args.como, rotulo=args.rotulo, plural=args.plural, aba=args.aba,
                  sigla=args.sigla, empresa=args.empresa)
    todo = [c for c, t in _textos(bloco) if TODO in t and not c.startswith("_")]
    print(f"ofertas.{args.id[0]} criada em {args.arquivo} (modelo {args.como}; webhook_id {bloco['webhook_id']}).")
    print(f"{len(todo)} campo(s) com TODO: {', '.join(todo)}" if todo else "Sem TODO.")
    print(f"Agora: preencha os TODO e rode `python3 nova-oferta.py --conferir {args.id[0]}`.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
