#!/usr/bin/env python3
"""Confere e apresenta o registro de projetos da Mel (deploy/hermes/projetos.toml).

  python3 deploy/hermes/scripts/projetos_verificar.py        # confere o registro
  python3 deploy/hermes/scripts/projetos_verificar.py --md   # gera o PROJETOS.md

Só lê: não cria pasta, não escreve em repositório e não usa a rede. O único
comando externo é `git config --get remote.origin.url`, que não toma lock.

Por que existe: o Dell acumulou várias cópias do mesmo projeto, quase sempre
criadas por agente que não sabia que a pasta existia. O registro diz qual é o
caminho de cada projeto; este script é o que impede o registro de mentir
(caminho que não existe, dois caminhos para o mesmo repositório, clone vivo
apontando para o repositório errado, pasta nova na home que ninguém registrou).

Erro sai com código 1. Aviso (pasta de topo fora do registro, "a-criar" que já
existe) não derruba: é para alguém olhar, nunca para agir sozinho.
"""
import argparse
import os
import re
import subprocess
import sys
import tomllib
from pathlib import Path

REGISTRO = Path(__file__).resolve().parent.parent / "projetos.toml"

TIPOS = ("clone-vivo", "pasta", "espelho", "congelado")
DONOS = ("Rômulo", "Hermes")
ESTADOS = ("existe", "a-criar")
OBRIGATORIOS = ("nome", "caminho", "repositorio", "tipo", "dono", "estado", "grafo", "papel")

TITULOS = {
    "clone-vivo": "Clones vivos (Git atualizado do GitHub; edita-se por worktree e pull request)",
    "pasta": "Pastas (sem Git, ou sem repositório próprio; os serviços dependem do caminho)",
    "espelho": "Espelhos (clone raso mantido pelo Hermes; ninguém edita)",
    "congelado": "Congelados (réplicas do PC que queimou; só consulta)",
}


def carregar(caminho: Path = REGISTRO) -> dict:
    with open(caminho, "rb") as f:
        return tomllib.load(f)


def expandir(caminho: str, home: Path) -> str:
    """'~/x' vira home/x; devolve texto normalizado (sem seguir link simbólico:
    ~/PRUMO é uma pasta de atalhos e não deve virar o destino deles)."""
    if caminho == "~":
        return os.path.normpath(str(home))
    if caminho.startswith("~/"):
        return os.path.normpath(str(home / caminho[2:]))
    return os.path.normpath(caminho)


def dentro_de(filho: str, pai: str) -> bool:
    return filho != pai and filho.startswith(pai.rstrip(os.sep) + os.sep)


def repositorio_de_url(url: str) -> str:
    """https://github.com/dono/nome.git e git@github.com:dono/nome.git viram 'dono/nome'."""
    url = re.sub(r"^https?://[^@/]*@", "https://", url.strip())  # tira credencial, se houver
    m = re.search(r"github\.com[:/]+([^/]+/[^/]+?)(?:\.git)?/?$", url)
    return m.group(1) if m else ""


def origin_do_git(pasta: str) -> str:
    r = subprocess.run(
        ["git", "-C", pasta, "config", "--get", "remote.origin.url"],
        capture_output=True, text=True, env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"},
    )
    return repositorio_de_url(r.stdout) if r.returncode == 0 else ""


def validar(reg: dict, home: Path, origin=origin_do_git, checar_disco: bool = True) -> list:
    """Devolve [(nivel, mensagem)], nivel 'erro' ou 'aviso'. `origin` e
    `checar_disco` existem para os testes não dependerem do Dell."""
    achados = []

    def erro(msg):
        achados.append(("erro", msg))

    def aviso(msg):
        achados.append(("aviso", msg))

    projetos = reg.get("projeto", [])
    if not projetos:
        erro("registro sem nenhum [[projeto]]")
        return achados

    # 1. Campos e valores.
    for p in projetos:
        nome = p.get("nome", "?")
        faltam = [c for c in OBRIGATORIOS if c not in p]
        if faltam:
            erro(f"{nome}: faltam campos {faltam}")
            continue
        if p["tipo"] not in TIPOS:
            erro(f"{nome}: tipo '{p['tipo']}' inválido (use {', '.join(TIPOS)})")
        if p["dono"] not in DONOS:
            erro(f"{nome}: dono '{p['dono']}' inválido (use {', '.join(DONOS)})")
        if p["estado"] not in ESTADOS:
            erro(f"{nome}: estado '{p['estado']}' inválido (use {', '.join(ESTADOS)})")
        if not isinstance(p["grafo"], bool):
            erro(f"{nome}: grafo deve ser true ou false")
        if not p["caminho"].startswith("~/"):
            erro(f"{nome}: caminho deve começar com '~/'")
        if p["tipo"] == "clone-vivo" and not p["repositorio"]:
            erro(f"{nome}: clone-vivo precisa de repositorio")
        if p["tipo"] == "espelho" and not p["repositorio"]:
            erro(f"{nome}: espelho precisa de repositorio")
        if "grupo" in p and not (isinstance(p["grupo"], str) and " · " in p["grupo"]):
            erro(f"{nome}: grupo deve ser 'Frente · Parte' (ex.: Silmer · Site)")
    projetos = [p for p in projetos if all(c in p for c in OBRIGATORIOS)]

    # 2. Unicidade: nome, caminho, repositório (a regra "uma pasta por projeto").
    vistos_nome, vistos_caminho, vistos_repo = {}, {}, {}
    for p in projetos:
        c = expandir(p["caminho"], home)
        for chave, tabela, rotulo in ((p["nome"], vistos_nome, "nome"), (c, vistos_caminho, "caminho")):
            if chave in tabela:
                erro(f"{rotulo} repetido: '{chave}' em {tabela[chave]} e {p['nome']}")
            tabela[chave] = p["nome"]
        repo = p["repositorio"]
        if repo and not repo.endswith("/*"):
            if repo in vistos_repo:
                erro(f"repositório {repo} aparece em {vistos_repo[repo]} e {p['nome']}: um só caminho por projeto")
            vistos_repo[repo] = p["nome"]

    # 3. Pasta dentro de pasta só se declarada (dentro_de), e a declarada tem de ser pai de verdade.
    por_nome = {p["nome"]: p for p in projetos}
    for p in projetos:
        c = expandir(p["caminho"], home)
        pai_decl = p.get("dentro_de")
        if pai_decl:
            pai = por_nome.get(pai_decl)
            if not pai:
                erro(f"{p['nome']}: dentro_de '{pai_decl}' não existe no registro")
            elif not dentro_de(c, expandir(pai["caminho"], home)):
                erro(f"{p['nome']}: o caminho não está dentro de {pai_decl} ({pai['caminho']})")
        for q in projetos:
            if q is not p and dentro_de(c, expandir(q["caminho"], home)) and pai_decl != q["nome"]:
                erro(f"{p['nome']} está dentro de {q['nome']} mas não declara dentro_de = \"{q['nome']}\"")

    # 4. Disco: o que "existe" existe; o que é "a-criar" ainda não.
    if checar_disco:
        for p in projetos:
            c = expandir(p["caminho"], home)
            existe = os.path.exists(c)
            if p["estado"] == "existe" and not existe:
                erro(f"{p['nome']}: {p['caminho']} não existe (estado = existe)")
            if p["estado"] == "a-criar" and existe:
                aviso(f"{p['nome']}: {p['caminho']} já existe; mude o estado para 'existe'")
            for w in p.get("worktrees", []):
                if p["estado"] == "existe" and not os.path.exists(expandir(w, home)):
                    aviso(f"{p['nome']}: worktree {w} não existe mais")
            # Clone vivo tem de ser Git de verdade e apontar para o repositório certo.
            if p["tipo"] == "clone-vivo" and existe:
                if not os.path.exists(os.path.join(c, ".git")):
                    erro(f"{p['nome']}: clone-vivo sem .git em {p['caminho']}")
                else:
                    real = origin(c)
                    if real != p["repositorio"]:
                        erro(f"{p['nome']}: origin é '{real or 'ilegível'}', o registro diz {p['repositorio']}")

        # 5. Pasta de topo da home que ninguém registrou (nunca age; só avisa).
        ignorar = set(reg.get("geral", {}).get("home_ignorar", []))
        # Os worktrees declarados também cobrem a pasta onde moram (~/crm-silmer-wt).
        registrados = [expandir(p["caminho"], home) for p in projetos]
        registrados += [expandir(w, home) for p in projetos for w in p.get("worktrees", [])]
        for entrada in sorted(home.iterdir()):
            if not entrada.is_dir() or entrada.name.startswith(".") or entrada.name in ignorar:
                continue
            topo = os.path.normpath(str(entrada))
            if not any(r == topo or dentro_de(r, topo) for r in registrados):
                aviso(f"pasta de topo fora do registro: ~/{entrada.name}")
    return achados


def _celula(texto: str) -> str:
    return str(texto).replace("|", "\\|").replace("\n", " ")


def renderizar_md(reg: dict) -> str:
    """O PROJETOS.md para humanos, gerado do mesmo TOML (nunca editado à mão)."""
    projetos = reg.get("projeto", [])
    linhas = [
        "# Projetos da Mel: um caminho por projeto",
        "",
        "**Gerado** de `~/SquadOne/deploy/hermes/projetos.toml`: para mudar algo, edite o TOML (por pull request) e gere de novo com",
        "`python3 deploy/hermes/scripts/projetos_verificar.py --md > ~/PRUMO/PROJETOS.md`. Não edite este arquivo.",
        "",
        "Regras, para qualquer agente (Claude, Codex, Hermes), no Dell e no PC:",
        "",
        "1. **Antes de criar pasta ou clonar, leia este registro.** Se o projeto existe, trabalhe nele; nada de \"outra cópia ao lado\".",
        "2. **Projeto novo entra no registro primeiro.** Só depois nasce a pasta.",
        "3. **Cópia de leitura é espelho** e ninguém edita nela.",
        "4. **Para guardar uma versão, use `~/Arquivo/<AAAA-MM-DD>`**, nunca uma pasta ao lado. Descarte vai para a lixeira (`gio trash`), nunca `rm`.",
        "",
        "`Grafo` diz se o graphify lê a pasta. `Dono`: Rômulo edita; Hermes é a Mel mantendo sozinha.",
    ]
    # Uma frente (ex.: Silmer) pode ter site, CRM e marketing em tipos e pastas
    # diferentes; o mapa por frente junta tudo num lugar antes das tabelas por tipo.
    frentes = {}
    for p in projetos:
        if p.get("grupo"):
            frentes.setdefault(p["grupo"].split(" · ")[0], []).append(p)
    for frente, doGrupo in frentes.items():
        linhas += ["", f"## {frente}: mapa por frente", "", "| Parte | Projeto | Caminho | Repositório | Papel |", "|---|---|---|---|---|"]
        for p in sorted(doGrupo, key=lambda x: x["grupo"]):
            caminho = f"`{p['caminho']}`" + (" *(a criar)*" if p["estado"] == "a-criar" else "")
            repo = f"`{p['repositorio']}`" if p["repositorio"] else "—"
            linhas.append(f"| {p['grupo'].split(' · ', 1)[1]} | **{_celula(p['nome'])}** | {caminho} | {repo} | {_celula(p['papel'])} |")
    for tipo in TIPOS:
        grupo = [p for p in projetos if p.get("tipo") == tipo]
        if not grupo:
            continue
        linhas += ["", f"## {TITULOS[tipo]}", "", "| Projeto | Caminho | Repositório | Dono | Grafo | Papel |", "|---|---|---|---|---|---|"]
        for p in grupo:
            caminho = f"`{p['caminho']}`" + (" *(a criar)*" if p["estado"] == "a-criar" else "")
            repo = f"`{p['repositorio']}`" if p["repositorio"] else "—"
            linhas.append(
                f"| **{_celula(p['nome'])}** | {caminho} | {repo} | {p['dono']} | {'sim' if p['grafo'] else 'não'} | {_celula(p['papel'])} |"
            )
        notas = [p for p in grupo if p.get("observacao") or p.get("worktrees") or p.get("cobertura_github")]
        if notas:
            linhas += [""]
            for p in notas:
                partes = []
                if p.get("cobertura_github"):
                    partes.append(f"o GitHub cobre {p['cobertura_github']} da pasta local")
                if p.get("worktrees"):
                    partes.append("worktrees: " + ", ".join(f"`{w}`" for w in p["worktrees"]))
                if p.get("observacao"):
                    partes.append(p["observacao"])
                linhas.append(f"- **{p['nome']}**: " + "; ".join(partes))
    ignorar = reg.get("geral", {}).get("home_ignorar", [])
    if ignorar:
        linhas += ["", "## Fora do registro de propósito", "", "Pastas de topo da home que não são projeto: " + ", ".join(f"`{i}`" for i in ignorar) + "."]
    return "\n".join(linhas) + "\n"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--md", action="store_true", help="imprime o PROJETOS.md gerado do registro")
    ap.add_argument("--registro", type=Path, default=REGISTRO, help="caminho do projetos.toml")
    args = ap.parse_args()
    reg = carregar(args.registro)
    if args.md:
        sys.stdout.write(renderizar_md(reg))
        return 0
    achados = validar(reg, Path.home())
    for nivel, msg in achados:
        print(f"{'ERRO ' if nivel == 'erro' else 'aviso'}  {msg}")
    erros = sum(1 for n, _ in achados if n == "erro")
    avisos = len(achados) - erros
    total = len(reg.get("projeto", []))
    print(f"{total} projetos no registro: {erros} erro(s), {avisos} aviso(s)")
    return 1 if erros else 0


if __name__ == "__main__":
    sys.exit(main())
