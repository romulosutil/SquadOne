#!/usr/bin/env python3
"""Filtro de segredos da Entrada: o módulo único que decide o que é segredo.

Quem usa: a página (bloqueia "Organizar" e "Só guardar" quando acha segredo), o
executor e o agente (nada que o filtro reconhece chega ao modelo ou ao diário) e o
cofre (rótulo e nome de arquivo não podem ser segredo, porque o índice é texto claro).

Filtro por padrões NUNCA é garantia: ele acha o que tem forma de segredo. Por isso são
DUAS camadas, com critérios diferentes:

1. `procurar` / `redigir`: o filtro principal. Acha, e o fluxo BLOQUEIA (ou, no segundo
   clique, guarda o valor no cofre e deixa `{{SEGREDO:id}}` no texto). Tem de ter poucos
   falsos positivos, porque cada um custa um clique.
2. `mascarar_para_o_modelo`: a camada do que vai ao modelo. Aqui o falso positivo é de
   graça (o modelo só arruma pastas e não precisa do valor exato), então ela é agressiva:
   o resto de toda linha com palavra de segredo, todo "pedaço de senha" (palavra longa
   misturando letras, números e símbolos; hex; base32) e frase-semente viram `<oculto>`.
   Se desconfiar de segredo partido em linhas, não manda texto nenhum.

O que o filtro principal reconhece (nome da regra): chave-privada (PEM, OpenSSH, PGP),
age-chave-secreta, token-conhecido (ghp_, github_pat_, sk-, sk_live_, AKIA, xox, AIza,
glpat-, hf_, npm_, SG., Telegram, JWT...), authorization, url-com-credencial,
linha-de-comando (--password X, mysql -pX, curl -u u:X), tag-xml (<password>X</password>),
chave-valor (`senha: x`, `a senha é x`, `chave da API do cliente: x`, `"password": "x"`,
`DB_PWD=x`), base64-de-usuario-e-senha e alta-entropia (cadeia longa e aleatória).

Limites, ditos na página: arquivo compactado, cifrado ou imagem não é lido por dentro; hex
puro sem palavra-chave (parece checksum) só é mascarado para o modelo, não bloqueado.
Para segredo, o caminho certo é o cofre.
"""
from __future__ import annotations

import base64
import binascii
import bisect
import math
import re
from dataclasses import dataclass
from itertools import islice
from typing import Callable, Iterable

MARCADOR = "{{SEGREDO:%s}}"
OCULTO = "<oculto>"
# Só o formato real de id do cofre: um marcador com outro conteúdo dentro não é mascarado (não passa).
RE_MARCADOR = re.compile(r"\{\{SEGREDO:c-\d{8}-\d{6}-[0-9a-f]{4}\}\}")

# Invisíveis que escondem segredo ao copiar de PDF/web: hífen suave, largura zero, marcas de direção.
RE_INVISIVEL = re.compile("[\u00ad\u200b-\u200f\u202a-\u202e\u2060\ufeff]")
_ALFA = "A-Za-z0-9+/_\\-"
# Segredo partido por quebra de linha ou espaço entre dois pedaços de 8+ caracteres.
RE_COLAR = re.compile(rf"(?<=[{_ALFA}]{{8}})(?:[ \t]*\r?\n[ \t]*|[ \t]+)(?=[{_ALFA}]{{8}})")

_PREFIXO = r"(?<![A-Za-z0-9])"          # no lugar de \b: "x_ghp_..." e "id=AKIA..." também casam


class NaoRedigivel(Exception):
    """O texto tem segredo cuja posição não se sabe (ex.: partido em linhas): só dá para bloquear."""


@dataclass(frozen=True)
class Achado:
    regra: str
    inicio: int       # onde começa o VALOR do segredo no texto (-1 se não localizável)
    fim: int
    linha: int        # 1-based (0 se não localizável); nunca guarda o valor
    redigivel: bool = True


# --------------------------------------------------------------------- regras fixas
# (nome, regex, grupo que é o VALOR; 0 = o trecho todo)
_REGRAS: list[tuple[str, re.Pattern, int | str]] = [
    ("chave-privada", re.compile(
        r"-----BEGIN [A-Z0-9 ]{0,30}PRIVATE KEY(?: BLOCK)?-----(?:[\s\S]*?-----END [A-Z0-9 ]{0,30}PRIVATE KEY(?: BLOCK)?-----|[\s\S]*\Z)"), 0),
    ("age-chave-secreta", re.compile(r"AGE-SECRET-KEY-1[A-Za-z0-9]{10,}"), 0),
    ("token-conhecido", re.compile(
        _PREFIXO + r"(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|"
        r"sk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_\-]{16,}|(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{16,}|"
        r"(?:AKIA|ASIA)[0-9A-Z]{16}(?![A-Za-z0-9])|xox[abprs]-[A-Za-z0-9-]{10,}|xapp-[A-Za-z0-9-]{10,}|"
        r"AIza[0-9A-Za-z_\-]{35}|ya29\.[A-Za-z0-9_\-]{20,}|1//0[A-Za-z0-9_\-]{30,}|"
        r"glpat-[A-Za-z0-9_\-]{20,}|hf_[A-Za-z0-9]{30,}|npm_[A-Za-z0-9]{30,}|pypi-[A-Za-z0-9_\-]{40,}|"
        r"dop_v1_[0-9a-f]{40,}|shp(?:at|ca|ss|pa)_[0-9a-f]{20,}|SG\.[A-Za-z0-9_\-]{16,}\.[A-Za-z0-9_\-]{16,}|"
        r"(?:SK|AC)[0-9a-f]{32}(?![A-Za-z0-9])|key-[0-9a-f]{32}(?![A-Za-z0-9])|"
        r"[0-9]{8,10}:[A-Za-z0-9_\-]{35}(?![A-Za-z0-9_\-])|"
        r"eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,})"), 0),
    ("authorization", re.compile(
        r"(?i)\bauthorization[\"']?\s*[:=]\s*[\"']?(?:bearer|basic|token)\s+(?P<v>[A-Za-z0-9._~+/=\-]{8,})"), "v"),
    ("authorization", re.compile(r"(?i)\bbearer\s+(?P<v>[A-Za-z0-9._~+/=\-]{20,})"), "v"),
    ("url-com-credencial", re.compile(
        r"(?<![A-Za-z0-9+.\-])[a-zA-Z][a-zA-Z0-9+.\-]{1,20}://[^\s/:@]{1,100}:(?P<v>[^\s/@]{1,200})@"), "v"),
    ("linha-de-comando", re.compile(
        r"(?i)--(?:password|passwd|pass|passphrase|token|secret|api-?key|apikey)(?:=|[ \t]+)(?P<v>\"[^\"]+\"|'[^']+'|[^\s\"']+)"), "v"),
    ("linha-de-comando", re.compile(
        r"(?i)\b(?:mysql|mysqldump|mariadb|mongo|mongosh|mongodump|sshpass|redis-cli|psql)\b[^\n]{0,300}?\s-p(?P<v>[^\s\-]\S*)"), "v"),
    ("linha-de-comando", re.compile(r"(?i)\bcurl\b[^\n]{0,300}?\s(?:-u|--user)[ =]?[\"']?[^\s:\"']+:(?P<v>[^\s\"']+)"), "v"),
    ("tag-xml", re.compile(
        r"(?i)<(?:password|passwd|senha|secret|segredo|token|api[_-]?key|private[_-]?key)\b[^>\n]{0,200}>(?P<v>[^<\n]{3,500})<"), "v"),
]
# Dica barata: a regra pesada só roda se o texto tem a palavra (em binário e em texto comum quase nunca tem).
_DICAS: dict[str, re.Pattern | str] = {
    "chave-privada": "PRIVATE KEY",
    "authorization": re.compile(r"(?i)bearer|authorization"),
    "url-com-credencial": "://",
    "linha-de-comando": re.compile(r"(?i)--(?:pass|token|secret|api)|\s-p\S|\s-u|--user"),
    "tag-xml": "<",
}
_SO_FRAGMENTAVEIS = ("token-conhecido", "age-chave-secreta")


def _tem_dica(nome: str, texto: str) -> bool:
    d = _DICAS.get(nome)
    if d is None:
        return True
    return (d in texto) if isinstance(d, str) else bool(d.search(texto))


# ------------------------------------------------------------ chave: valor (em código)
# Palavra que dá cara de segredo a um nome. Forte: qualquer valor de 3+ caracteres.
_FORTE_LIVRE = (r"pass(?:word|wd|phrase)|senha|secret|segredo|token|credencia(?:l|is)|"
                r"api[_-]?key|private[_-]?key|secret[_-]?key|access[_-]?key|auth[_-]?key|mnemonic")
_FORTE_COM_FRONTEIRA = r"pass|pwd|otp|totp|cvv|cvc|2fa"
# Fraca: palavra comum; só vale se o valor parecer segredo (ou PIN).
_FRACA = r"chave|key|pin|seed"
RE_PALAVRA = re.compile(
    rf"(?i)(?P<f>(?:{_FORTE_LIVRE})(?:s|es)?(?![a-z])|(?<![a-z])(?:{_FORTE_COM_FRONTEIRA})s?(?![a-z]))"
    rf"|(?<![a-z])(?P<w>(?:{_FRACA})s?)(?![a-z])")
# O que vem depois da palavra: resto do nome, "do/da/de..." e o separador (: = => ou "é").
RE_SEPARADOR = re.compile(
    r"[\w.\-]{0,80}+(?:[ \t]++(?:d[aoe]s?|of|for|para)[ \t]++[\w.\-]++){0,4}+[\"']?"
    r"(?:[ \t]*+(?P<s1>:|=>|=)|[ \t]++(?P<s2>é|eh|is)[ \t]*+:?)[ \t]*+", re.I)
_CAP_VALOR = 2000
# Referência ou máscara EXATA: ${VAR}, $VAR, %VAR%, {{ nome }}, <oculto>, ****. Qualquer outra coisa é valor.
RE_REFERENCIA = re.compile(
    r"\$\{?[A-Za-z_]\w*\}?|%[A-Za-z_]\w*%|\$?\{\{\s*[\w.\-]+\s*\}\}|<[^<>\s]{1,30}>|[\*x•\.\-_#~]+|"
    r"null|none|nil|true|false|undefined", re.I)


def _classes(s: str) -> int:
    return sum(bool(re.search(p, s)) for p in ("[a-z]", "[A-Z]", "[0-9]", r"[^A-Za-z0-9\s]"))


def _valor_ignorado(v: str) -> bool:
    return bool(RE_REFERENCIA.fullmatch(v))


def _parece_segredo(v: str, palavra: str) -> bool:
    """Palavra fraca (chave, key, pin, seed): só conta se o valor tiver cara de segredo."""
    if palavra.lower().rstrip("s") == "pin":
        return bool(re.fullmatch(r"\d{4,8}", v))
    if re.fullmatch(r"\d{4,10}", v):
        return True
    return len(v) >= 8 and " " not in v and _classes(v) >= 2


def _achar_chave_valor(texto: str, primeiro: bool = False) -> list[tuple[int, int, str]]:
    achados: list[tuple[int, int, str]] = []
    consumido = 0
    for m in RE_PALAVRA.finditer(texto):
        if m.start() < consumido:
            continue
        fim_linha = texto.find("\n", m.end(), m.end() + _CAP_VALOR)
        fim_linha = min(len(texto), m.end() + _CAP_VALOR) if fim_linha < 0 else fim_linha
        trecho = texto[m.end():fim_linha]
        s = RE_SEPARADOR.match(trecho)
        if not s:
            continue
        resto = trecho[s.end():]
        if s.group("s2"):                                    # "a senha é X": só a próxima palavra
            tok = re.match(r"\S+", resto)
            resto = tok.group(0) if tok else ""
        valor = resto.rstrip()
        v = valor.strip().strip("\"'`,;")
        if len(v) < 3 or _valor_ignorado(v):
            continue
        if m.group("w") and not _parece_segredo(v, m.group("w")):
            continue
        ini = m.end() + s.end()
        achados.append((ini, ini + len(valor), "chave-valor"))
        consumido = ini + len(valor)
        if primeiro:
            break
    return achados


# -------------------------------------------------------------------- alta entropia
_RE_LONGO = re.compile(r"[A-Za-z0-9+/_\-]{20,}={0,2}")                # "=" só como preenchimento do base64, no fim
_RE_B64 = re.compile(r"[A-Za-z0-9+/]{16,}={0,2}")


def entropia(s: str) -> float:
    if not s:
        return 0.0
    n = len(s)
    freq: dict[str, int] = {}
    for c in s:
        freq[c] = freq.get(c, 0) + 1
    return -sum(f / n * math.log2(f / n) for f in freq.values())


def _entropia_alta(s: str) -> bool:
    if s.startswith(("/", "~/", "./", "../")):
        return False
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", s):          # slug: "politica-de-privacidade-2026"
        return False
    if re.fullmatch(r"[0-9a-fA-F\-]+", s):                    # hash, UUID (o modelo recebe isto mascarado)
        return False
    if sum(bool(re.search(p, s)) for p in ("[a-z]", "[A-Z]", "[0-9]")) < 2:
        return False
    return entropia(s) >= (4.3 if len(s) >= 32 else 4.0)


def _base64_de_usuario_e_senha(s: str) -> bool:
    """'dXNlcjpzZW5oYQ==' (user:senha) sem a palavra Basic."""
    try:
        d = base64.b64decode(s + "=" * (-len(s) % 4), validate=True).decode("ascii")
    except (binascii.Error, UnicodeDecodeError, ValueError):
        return False
    return bool(re.fullmatch(r"[\w.\-@]{1,64}:[\x21-\x7e]{3,}", d))


def _achar_entropia(texto: str, primeiro: bool = False) -> list[tuple[int, int, str]]:
    out: list[tuple[int, int, str]] = []
    for m in _RE_LONGO.finditer(texto):
        if _entropia_alta(m.group(0)):
            out.append((m.start(), m.end(), "alta-entropia"))
            if primeiro:
                return out
    for m in islice(_RE_B64.finditer(texto), 5000):
        s = m.group(0)
        if _classes(s) >= 2 and _base64_de_usuario_e_senha(s):
            out.append((m.start(), m.end(), "base64-de-usuario-e-senha"))
            if primeiro:
                return out
    return out


# ----------------------------------------------------------------------- procurar
def _sem_invisiveis(texto: str) -> tuple[str, list[int] | None]:
    """Texto sem os invisíveis e, se havia algum, as posições onde eles ficavam, no texto LIMPO
    (c_k = p_k - k): um índice limpo `c` volta ao original em `c + bisect_right(cs, c)`. Só as posições dos
    invisíveis (normalmente poucas) são guardadas, não um índice por caractere."""
    if not RE_INVISIVEL.search(texto):
        return texto, None
    cs = [m.start() - k for k, m in enumerate(RE_INVISIVEL.finditer(texto))]
    return RE_INVISIVEL.sub("", texto), cs


def _brutos(visao: str, com_entropia: bool, so_fragmentaveis: bool = False,
            primeiro: bool = False) -> list[tuple[int, int, str]]:
    bruto: list[tuple[int, int, str]] = []
    # O marcador {{SEGREDO:id}} é nosso e contém a palavra "SEGREDO": mascarado (mesmo tamanho,
    # então as posições valem) para nenhuma regra o ler como "chave: valor".
    visao = RE_MARCADOR.sub(lambda m: "~" * len(m.group(0)), visao)
    for nome, rx, grupo in _REGRAS:
        if so_fragmentaveis and nome not in _SO_FRAGMENTAVEIS:
            continue
        if not _tem_dica(nome, visao):
            continue
        for m in rx.finditer(visao):
            ini, fim = m.span(grupo)
            if ini < 0 or fim <= ini:
                continue
            if nome in ("authorization", "url-com-credencial", "linha-de-comando") and _valor_ignorado(visao[ini:fim]):
                continue
            bruto.append((ini, fim, nome))
            if primeiro:
                return bruto
    if not so_fragmentaveis and RE_PALAVRA.search(visao):
        bruto += _achar_chave_valor(visao, primeiro)
        if primeiro and bruto:
            return bruto
    if com_entropia:
        bruto += _achar_entropia(visao, primeiro)
    return bruto


def _colar(limpo: str) -> tuple[str, list[tuple[int, int]]]:
    """O texto sem as quebras/espaços entre dois pedaços de 8+ caracteres e as junções:
    (posição no colado onde houve o corte, posição no original logo depois do corte)."""
    partes: list[str] = []
    juncoes: list[tuple[int, int]] = []
    cursor = tam = 0
    for m in RE_COLAR.finditer(limpo):
        seg = limpo[cursor:m.start()]
        partes.append(seg)
        tam += len(seg)
        juncoes.append((tam, m.end()))
        cursor = m.end()
    partes.append(limpo[cursor:])
    return "".join(partes), juncoes


def _parece_aleatorio(pedaco: str) -> bool:
    """Pedaço de segredo costuma ter dígito ou maiúscula no meio; palavra comum ('Combinar') não."""
    return bool(re.search(r"[0-9]", pedaco) or re.search(r"[a-z][A-Z]", pedaco))


def _fragmentado(limpo: str, com_entropia: bool, planos: list[tuple[int, int]]) -> bool:
    """Há segredo que só aparece com as quebras de linha/espaços retirados (AWS secret copiada de PDF)?
    Só vale se cada pedaço que o filtro comum NÃO pegou parece aleatório: uma chave completa seguida de
    uma palavra comum na linha de baixo não é segredo partido."""
    if not RE_COLAR.search(limpo):
        return False
    colado, juncoes = _colar(limpo)
    if not juncoes:
        return False
    posicoes = [j[0] for j in juncoes]
    achados = _brutos(colado, False, so_fragmentaveis=True) + (_achar_entropia(colado) if com_entropia else [])
    inicios = [ini for ini, _ in planos]                       # planos: trechos ordenados e sem sobreposição

    def original(g: int) -> int:
        k = bisect.bisect_right(posicoes, g) - 1
        return g if k < 0 else juncoes[k][1] + (g - posicoes[k])

    def coberto(a: int, b: int) -> bool:                       # [a, b] (original) cabe inteiro num achado comum?
        k = bisect.bisect_right(inicios, a) - 1
        return k >= 0 and planos[k][0] <= a and b < planos[k][1]

    for gi, gf, _ in achados:
        cortes = posicoes[bisect.bisect_right(posicoes, gi):bisect.bisect_left(posicoes, gf)]
        if not cortes:
            continue                                            # não atravessa junção: é o filtro comum
        limites = [gi, *cortes, gf]
        pedacos = [(limites[n], limites[n + 1]) for n in range(len(limites) - 1)]
        novos = [(a, b) for a, b in pedacos if not coberto(original(a), original(b - 1))]
        if novos and all(_parece_aleatorio(colado[a:b]) for a, b in novos):
            return True
    return False


def procurar(texto: str, com_entropia: bool = True) -> list[Achado]:
    """Todos os segredos do texto, em ordem de posição, sem sobreposição. Segredo partido em
    linhas (visto só no texto 'colado') vem como achado não redigível."""
    limpo, idx = _sem_invisiveis(texto)
    bruto = _brutos(limpo, com_entropia)
    bruto.sort(key=lambda t: (t[0], -(t[1] - t[0])))
    mesclados: list[list] = []
    for ini, fim, nome in bruto:
        if mesclados and ini < mesclados[-1][1]:                # sobreposto: o primeiro (e maior) vale
            if fim > mesclados[-1][1]:
                mesclados[-1][1] = fim
            continue
        mesclados.append([ini, fim, nome])
    nl = [m.start() for m in re.finditer("\n", texto)] if mesclados else []
    achados: list[Achado] = []
    for ini, fim, nome in mesclados:
        oi, of_ = ((ini + bisect.bisect_right(idx, ini), fim - 1 + bisect.bisect_right(idx, fim - 1) + 1)
                   if idx is not None else (ini, fim))
        achados.append(Achado(nome, oi, of_, bisect.bisect_left(nl, oi) + 1))
    if _fragmentado(limpo, com_entropia, [(m[0], m[1]) for m in mesclados]):
        achados.append(Achado("segredo-partido-em-linhas", -1, -1, 0, redigivel=False))
    return achados


def tem_segredo(texto: str, com_entropia: bool = True) -> bool:
    """Como `procurar`, mas para no primeiro achado (barato em texto enorme)."""
    limpo, _ = _sem_invisiveis(texto)
    if _brutos(limpo, com_entropia, primeiro=True):
        return True
    return _fragmentado(limpo, com_entropia, [])


def redigir(texto: str, armazenar: Callable[[str, str], str]) -> tuple[str, list[Achado]]:
    """Troca cada valor por {{SEGREDO:id}}. `armazenar(valor, regra)` guarda o valor
    (no cofre) e devolve o id. Devolve o texto novo e o que foi achado. Levanta NaoRedigivel se
    houver segredo sem posição (partido em linhas) ou se sobrar pedaço colado ao marcador."""
    achados = procurar(texto)
    if not achados:
        return texto, []
    if any(not a.redigivel for a in achados):
        raise NaoRedigivel("segredo partido em linhas")
    partes: list[str] = []
    cursor = 0
    for a in achados:
        partes.append(texto[cursor:a.inicio])
        partes.append(MARCADOR % armazenar(texto[a.inicio:a.fim], a.regra))
        cursor = a.fim
    partes.append(texto[cursor:])
    novo = "".join(partes)
    # Pedaço de segredo colado ao marcador = o valor não foi pego inteiro: não segue.
    if re.search(r"\}\}[A-Za-z0-9_\-+/=]|[A-Za-z0-9_\-+/]\{\{SEGREDO:c-", novo):    # "=" antes é só o separador
        raise NaoRedigivel("sobrou parte do segredo ao lado do marcador")
    return novo, achados


def resumo(achados: Iterable[Achado], limite: int = 5) -> dict:
    """O que se pode dizer ao usuário sobre o achado: regras e linhas, nunca o valor."""
    achados = list(achados)
    return {"total": len(achados),
            "regras": sorted({a.regra for a in achados}),
            "linhas": sorted({a.linha for a in achados if a.linha})[:limite]}


# ------------------------------------------------------- a camada do que vai ao modelo
_RE_TOKEN = re.compile(r"\S+")
_RE_SENTINELA = re.compile("\ue000(\\d+)\ue001")
_SO_SENTINELAS = re.compile("[\\s:=>\"',;.\\-]*(?:\ue000\\d+\ue001[\\s,;.]*)+")
_BORDA = "\"'()[]{}<>,;:!?`"
_SIMBOLOS = r"[!@#$%^&*+=/\\|~`;()\[\]{}<>?]"


def cortar_em_linha(texto: str, limite: int) -> tuple[str, bool]:
    """Até `limite` caracteres, cortando no fim de uma linha (corte no meio de `senha: x` deixaria a
    linha seguinte virar o 'valor'). Devolve (trecho, foi_cortado)."""
    if len(texto) <= limite:
        return texto, False
    corte = texto.rfind("\n", 0, limite)
    return texto[:corte if corte > limite // 4 else limite], True


def _token_suspeito(core: str) -> bool:
    """Só vale para a camada do modelo, onde o falso positivo é de graça (o agente só arruma pastas)."""
    n = len(core)
    if n >= 8 and re.search(_SIMBOLOS, core):
        return True                                           # símbolo no meio de uma palavra de 8+: senha, caminho ou URL
    if n >= 10 and re.search(r"[A-Za-z]", core) and re.search(r"[0-9]", core):
        return True                                           # letra e número juntos em 10+
    if n >= 8 and sum(bool(re.search(p, core)) for p in ("[a-z]", "[A-Z]", "[0-9]")) == 3:
        return True                                           # minúscula, maiúscula e número em 8+
    if n < 16:
        return False
    if re.fullmatch(r"[0-9a-fA-F]{16,}", core) or re.fullmatch(r"[A-Z2-7]{16,}", core):
        return True                                           # hex (chave, hash), base32 (TOTP)
    if re.search(r"[a-z]", core) and re.search(r"[A-Z]", core):
        return True                                           # maiúsculas e minúsculas misturadas (CamelCase também: sai de graça)
    return n >= 20 and entropia(core) >= 4.0 and _classes(core) >= 2


def _mascarar_linha(linha: str) -> str:
    for m in RE_PALAVRA.finditer(linha):
        if m.group("f"):                                       # palavra forte: tudo depois dela
            if _SO_SENTINELAS.fullmatch(linha[m.end():]):      # "senha: {{SEGREDO:id}}": já está no cofre, fica
                break
            linha = linha[:m.end()] + " " + OCULTO
            break
        s = RE_SEPARADOR.match(linha, m.end())                 # palavra fraca: só com separador (chave: x)
        if s:
            linha = linha[:s.end()] + OCULTO
            break

    def troca(t: re.Match) -> str:
        tok = t.group(0)
        core = tok.strip(_BORDA)
        if core and OCULTO not in core and _token_suspeito(core):
            return tok.replace(core, OCULTO, 1)
        return tok
    return _RE_TOKEN.sub(troca, linha)


def _frase_semente(linha: str) -> bool:
    palavras = linha.split()
    return len(palavras) in (12, 15, 18, 21, 24) and all(re.fullmatch(r"[a-z]{3,8}", p) for p in palavras)


def mascarar_para_o_modelo(trecho: str) -> str | None:
    """O trecho (já cortado) que pode ir ao modelo, com tudo que lembre segredo trocado por
    <oculto>. None = não mande texto (há sinal de segredo partido em linhas). O arquivo
    original NÃO muda; isto é só a visão do agente."""
    limpo, _ = _sem_invisiveis(trecho)
    achados = procurar(limpo)
    if any(not a.redigivel for a in achados):
        return None
    partes: list[str] = []
    cursor = 0
    for a in achados:
        partes.append(limpo[cursor:a.inicio])
        partes.append(OCULTO)
        cursor = a.fim
    partes.append(limpo[cursor:])
    visao = "".join(partes)
    marcadores = RE_MARCADOR.findall(visao)                    # os do cofre atravessam a camada intactos
    for i, mk in enumerate(marcadores):
        visao = visao.replace(mk, f"\ue000{i}\ue001", 1)
    linhas = [OCULTO if _frase_semente(l.strip()) else _mascarar_linha(l) for l in visao.split("\n")]
    return _RE_SENTINELA.sub(lambda m: marcadores[int(m.group(1))], "\n".join(linhas))


# ---------------------------------------------------------------- varredura em fluxo
class Varredor:
    """Procura segredo em um fluxo de bytes (arquivo grande), sem guardar o conteúdo.
    Olha o texto como Latin-1 e também sem os bytes nulos (UTF-16: 'a\\x00b\\x00' vira 'ab')."""
    JANELA = 4096          # sobra de um pedaço para o outro, para o padrão não cair na emenda

    def __init__(self):
        self._cauda = b""
        self.regras: set[str] = set()

    def alimentar(self, pedaco: bytes) -> bool:
        dados = self._cauda + pedaco
        visoes = (dados, dados.replace(b"\x00", b"")) if b"\x00" in dados else (dados,)
        for visao in visoes:
            for _, _, nome in _brutos(visao.decode("latin-1"), True, primeiro=True):
                self.regras.add(nome)
        self._cauda = dados[-self.JANELA:]
        return bool(self.regras)
