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
    # A senha pode ter "@": vale até o ÚLTIMO "@" que ainda é seguido de um host ("p@ss-Forte9@db:5432/x").
    ("url-com-credencial", re.compile(
        r"(?<![A-Za-z0-9+.\-])[a-zA-Z][a-zA-Z0-9+.\-]{1,20}://[^\s/:@]{1,100}:(?P<v>[^\s/]{1,200})@(?=[^\s@/]{1,255}(?:[:/]|\s|$))"), "v"),
    ("linha-de-comando", re.compile(
        r"(?i)--(?:password|passwd|pass|passphrase|token|secret|api-?key|apikey)(?:=|[ \t]+)(?P<v>\"[^\"]+\"|'[^']+'|[^\s\"']+)"), "v"),
    ("linha-de-comando", re.compile(
        r"(?i)\b(?:mysql|mysqldump|mariadb|mongo|mongosh|mongodump|sshpass|redis-cli|psql)\b[^\n]{0,300}?\s-p(?P<v>[^\s\-]\S*)"), "v"),
    ("linha-de-comando", re.compile(r"(?i)\bcurl\b[^\n]{0,300}?\s(?:-u|--user)[ =]?[\"']?[^\s:\"']+:(?P<v>[^\s\"']+)"), "v"),
    # Programas em que a flag seguida de ESPAÇO é a senha (`mysql -p db` não entra: ali o argumento é o banco).
    ("linha-de-comando", re.compile(
        r"(?i)\b(?:sshpass[^\n]{0,200}?\s-p|redis-cli[^\n]{0,200}?\s-a|docker\s+login[^\n]{0,200}?\s(?:-p|--password)|"
        r"zip[^\n]{0,200}?\s-P|ssh-keygen[^\n]{0,200}?\s-N|(?:mongo|mongosh|mongodump)[^\n]{0,200}?\s-p)"
        r"[ \t]+(?P<v>\"[^\"\n]+\"|'[^'\n]+'|[^\s\"']+)"), "v"),
    ("define-php", re.compile(
        r"(?i)\bdefine\s*\(\s*['\"][A-Z0-9_]{0,40}(?:pass\w*|secret|token|api_?key|salt|private_?key)[A-Z0-9_]{0,40}['\"]"
        r"\s*,\s*['\"](?P<v>[^'\"\n]{3,200})['\"]"), "v"),
    ("netrc", re.compile(r"(?i)\bmachine\s+\S{1,100}\s+login\s+\S{1,100}\s+password\s+(?P<v>\S{3,200})"), "v"),
    ("tag-xml", re.compile(
        r"(?i)<(?:password|passwd|senha|secret|segredo|token|api[_-]?key|private[_-]?key)\b[^>\n]{0,200}>(?P<v>[^<\n]{3,500})<"), "v"),
]
# Dica barata: a regra pesada só roda se o texto tem a palavra (em binário e em texto comum quase nunca tem).
_DICAS: dict[str, re.Pattern | str] = {
    "chave-privada": "PRIVATE KEY",
    "authorization": re.compile(r"(?i)bearer|authorization"),
    "url-com-credencial": "://",
    "linha-de-comando": re.compile(r"(?i)--(?:pass|token|secret|api)|\s-p\S|\s-[uUpPaN]\s|--user"),
    "tag-xml": "<",
    "define-php": re.compile(r"(?i)define\s*\("),
    "netrc": re.compile(r"(?i)machine\s"),
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
# `nome` = o resto do nome da chave ("_expiry" em token_expiry); `con` = "do bolo" em "segredo do bolo".
RE_SEPARADOR = re.compile(
    r"(?P<nome>[\w.\-]{0,80}+)(?P<con>(?:[ \t]++(?:d[aoe]s?|of|for|para)[ \t]++[\w.\-]++){0,4}+)[\"']?"
    r"(?:[ \t]*+(?P<s1>:|=>|=)|[ \t]++(?P<s2>é|eh|is)[ \t]*+:?)[ \t]*+", re.I)
_CAP_VALOR = 2000
# Referência ou máscara EXATA: ${VAR}, $VAR, %VAR%, {{ nome }}, <oculto>, ****. Qualquer outra coisa é valor.
# Variável sem chaves só em MAIÚSCULAS ($PG_PASS) ou só em minúsculas ($senha): "$Kx9mP2vL8" é uma senha que
# começa com "$", não uma referência. Placeholder <...> só com letras: "<aB3$kL9>" é valor.
RE_REFERENCIA = re.compile(
    r"\$\{[A-Za-z_]\w*\}|(?-i:\$[A-Z_][A-Z0-9_]*|\$[a-z_][a-z0-9_]*)|%[A-Za-z_]\w*%|\$?\{\{\s*[\w.\-]+\s*\}\}|"
    r"<[A-Za-z_\-]{1,30}>|[\*x•\.\-_#~]+|null|none|nil|true|false|undefined", re.I)


def _classes(s: str) -> int:
    # "paciência" não tem símbolo: letra acentuada é letra (\w), só pontuação e "_" contam como símbolo
    return sum(bool(re.search(p, s)) for p in ("[a-z]", "[A-Z]", "[0-9]", r"[^\w\s]|_"))


def _valor_ignorado(v: str) -> bool:
    return bool(RE_REFERENCIA.fullmatch(v))


def _parece_segredo(v: str, palavra: str) -> bool:
    """Palavra fraca (chave, key, pin, seed): só conta se o valor tiver cara de segredo."""
    if palavra.lower().rstrip("s") == "pin":
        return bool(re.fullmatch(r"\d{4,8}", v))
    if re.fullmatch(r"\d{4,10}", v):
        return True
    return len(v) >= 8 and " " not in v and _classes(v) >= 2


# Palavra que, num nome composto ou numa frase, fala DE segredo e não é um: "segredo do bolo", "o segredo é paciência".
_ASSUNTO = frozenset({"segredo", "segredos", "secret", "secrets"})
# Sufixo que marca metadado de configuração: token_expiry, password_min_length, secret_name, DB_PASSWORD_FILE...
_SUFIXO_CONFIG = re.compile(
    r"(?i)[_\-.](?:expir\w*|ttl|url|uri|endpoint|name|length|len|min|max|count|seconds?|secs?|timeout|type|file|path|"
    r"header|prefix|suffix|id|label|hint|policy|required?|enabled?|interval|rotation|reset|field)$")
_PONTUACAO_FINAL = "\"'`,;:.!?)"
_FECHOS = "}]),;\"'`"                                       # o que sobra colado ao valor em JSON/código de uma linha só
# Valor que descreve ou aponta, não é segredo: "ver no Bitwarden", "expira em 24h", "token=expired".
_DESCRITIVO = re.compile(
    r"(?i)(?:ver|veja|consultar|consulte|pedir|pe[çc]a|perguntar|see|ask|check|expira[a-zç]*|expired|expires|vence[a-z]*|"
    r"renov[a-zç]+|invalid[a-z]*|inv[áa]lid[a-z]*|missing|ausente|revoked|revogad[a-z]+|valid[ao]?|ok)\b")
# Valor que é código, não segredo: `getpass.getpass()`, `input('Senha: ')`, `req.headers.authorization`.
_CODIGO_CHAMADA = re.compile(r"[a-z_][a-z_.]*\(.*\);?")
_CODIGO_ATRIBUTO = re.compile(r"[a-z_]+(?:\.[A-Za-z_]\w*){2,}")
_REFERENCIA_NO_INICIO = re.compile(
    r"\$\{[A-Za-z_]\w*\}|(?-i:\$[A-Z_][A-Z0-9_]*|\$[a-z_][a-z0-9_]*)|%[A-Za-z_]\w*%|\{\{[^}]*\}\}")


def _aleatorio_forte(v: str) -> bool:
    return (len(v) >= 8 and " " not in v and _classes(v) >= 2 and not v.isdigit()
            and not re.match(r"[A-Za-z][A-Za-z0-9+.\-]*://", v)      # URL de endpoint não é segredo
            and not v.startswith(("/", "~/", "./", "../")))             # nem caminho de arquivo (DB_PASSWORD_FILE=/run/secrets/db)


def _valor_nao_e_segredo(v: str, s2: bool) -> bool:
    nu = v.rstrip(_FECHOS)
    if _valor_ignorado(v) or _valor_ignorado(nu):
        return True
    primeiro = v.split(None, 1)[0].rstrip(_FECHOS) if v.split() else ""
    if primeiro and _REFERENCIA_NO_INICIO.fullmatch(primeiro):       # "$PG_PASS postgres:16"
        return True
    if s2:
        return False
    return bool(_DESCRITIVO.match(v) or _CODIGO_CHAMADA.fullmatch(v) or _CODIGO_ATRIBUTO.fullmatch(nu))


_RE_BLOCO_YAML = re.compile(r"[|>][+-]?\d?")
_MAX_LINHAS_DE_BLOCO = 20


def _bloco_yaml(texto: str, pos_chave: int, fim_linha: int) -> tuple[int, int] | None:
    """`password: |` / `password: >-`: o valor são as linhas de baixo, mais recuadas que a chave. Devolve onde
    ele começa (no 1º caractere que não é recuo) e termina; None se não houver."""
    ini_linha = texto.rfind("\n", 0, pos_chave) + 1
    linha = texto[ini_linha:fim_linha]
    recuo = len(linha) - len(linha.lstrip(" \t"))
    cursor, ini, fim, n = fim_linha + 1, None, 0, 0
    while cursor <= len(texto) and n < _MAX_LINHAS_DE_BLOCO:
        f = texto.find("\n", cursor)
        f = len(texto) if f < 0 else f
        linha = texto[cursor:f]
        if not linha.strip() or len(linha) - len(linha.lstrip(" \t")) <= recuo:
            break
        if ini is None:
            ini = cursor + len(linha) - len(linha.lstrip(" \t"))
        fim, n, cursor = f, n + 1, f + 1
    return (ini, fim) if ini is not None and fim - ini >= 3 else None


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
        ini = m.end() + s.end()
        valor = resto.rstrip()                              # o que SE GUARDA: sempre até o fim da linha
        if s.group("s1") and _RE_BLOCO_YAML.fullmatch(valor.strip()):
            bloco = _bloco_yaml(texto, m.start(), fim_linha)
            if bloco is None:
                continue
            ini, valor = bloco[0], texto[bloco[0]:bloco[1]]  # YAML: o valor está nas linhas de baixo
            v = " ".join(valor.split())
        elif s.group("s2"):                                 # "a senha é X Y Z": decide pela 1ª palavra, guarda a frase toda
            tok = re.match(r"\S+", resto)
            v = (tok.group(0) if tok else "").strip(_PONTUACAO_FINAL)
        else:                                               # (sem cortar na aspa: senha aleatória pode ter aspas; redigir pela
            v = valor.strip().strip("\"'`,;")               #  metade é pior que redigir demais)
        if len(v) < 3 or _valor_nao_e_segredo(v, bool(s.group("s2"))):
            continue
        if m.group("w") and not _parece_segredo(v, m.group("w")):
            continue
        if _SUFIXO_CONFIG.search(s.group("nome") or "") and not _aleatorio_forte(v):
            continue                                        # token_expiry: 3600, password_min_length: 12, secret_name: app-tls
        palavra = (m.group("f") or m.group("w") or "").lower()
        if palavra in _ASSUNTO and (s.group("con").strip() or s.group("s2")) and not _parece_segredo(v, palavra):
            continue                                        # "segredo do bolo: ...", "o segredo é paciência"
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


# Constantes fixas que parecem aleatórias e não são segredo: o id do pacote XMP, que vai em todo PDF e imagem
# exportados por Word, LibreOffice, Acrobat ou editor de fotos.
_CONSTANTES_CONHECIDAS = frozenset({"W5M0MpCehiHzreSzNTczkc9d"})
_PARAM_SENSIVEL = re.compile(r"(?i)[?&;#][\w.\-]*(?:token|key|sig|secret|pass|pwd|auth|code|session)[\w.\-]*=\Z")


def _contexto_inofensivo(texto: str, ini: int, fim: int) -> bool:
    """O trecho [ini, fim) de uma cadeia longa está onde cadeia longa é normal: dentro de uma URL (id do Drive,
    do YouTube, do Notion), num `sha512-…` de integridade ou num `<id@host>` de cabeçalho de e-mail? Valor de
    parâmetro sensível (`?token=`, `&pwd=`, `&sig=`) NÃO é inofensivo. Olha só 300 caracteres para trás."""
    janela = texto[max(0, ini - 300):ini]
    corte = max(janela.rfind(c) for c in " \t\n\r") + 1
    antes = janela[corte:]                                   # o pedaço da "palavra" que vem antes do trecho
    if re.match(r"sha\d{1,3}-", texto[ini:ini + 8]):
        return True
    if re.search(r"(?i)data:[\w/+.\-]{1,60};base64,\Z", antes):         # imagem/fonte embutida em HTML, SVG ou CSS
        return True
    if antes.endswith("<") and texto[fim:fim + 1] == "@":
        return True
    if "://" in antes:
        return _PARAM_SENSIVEL.search(antes) is None
    return False


def _entropia_alta(s: str) -> bool:
    if s in _CONSTANTES_CONHECIDAS:
        return False
    if s.startswith(("/", "~/", "./", "../")):
        return False
    if re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)+", s):          # slug: "politica-de-privacidade-2026"
        return False
    if re.fullmatch(r"[a-z0-9._\-]+(?:/[a-z0-9._\-]+){2,}", s):    # caminho relativo em minúsculas: examples/functions/substr2
        return False
    if re.fullmatch(r"[0-9a-fA-F\-]+", s):                    # hash, UUID (o modelo recebe isto mascarado)
        return False
    if sum(bool(re.search(p, s)) for p in ("[a-z]", "[A-Z]", "[0-9]")) < 2:
        return False
    if len(s) < 32 and not re.search(r"[0-9]", s):          # 20 a 31 só com letras: nome em CamelCase, não chave
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
        if _entropia_alta(m.group(0)) and not _contexto_inofensivo(texto, m.start(), m.end()):
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


# ---- reforço da camada do modelo (2ª rodada de revisão, 04/10/2026). Tudo em varredura LINEAR: nada de regex
# aninhado sobre texto livre. O falso positivo aqui é de graça (o agente só arruma pastas).
# Palavra de contexto: a linha inteira some (fica só a palavra), o que cobre o valor ANTES da palavra
# ("X é a senha do wifi"), em outros idiomas ("contraseña", "Passwort") e abreviado ("psw", "pw").
_CTX = re.compile(
    r"(?i)(?<![a-zà-ÿ])(?:senhas?|passwords?|passwd|pwd|psw|pw|pass|passcode|passphrase|contrase[ñn]as?|clave|"
    r"passwort|kennwort|mot de passe|palavra-passe|tokens?|secrets?|segredos?|credenciai?s?|c[óo]digos?|codes?|"
    r"pin|cvv|otp|totp|2fa|2º fator|autenticador|authenticator|recupera[çc][ãa]o|recovery|seed|frase|"
    r"carteira|wallet|cart[ãa]o|card|wi-?fi|acesso|login)(?![a-zà-ÿ])")
_RE_SENT = re.compile("\ue000\\d+\ue001")
_FLAGS_DE_SENHA = frozenset({"-p", "-P", "-a", "-N", "-k", "-w"})
_FLAG_LONGA = re.compile(r"(?i)--?(?:pass\w*|token|secret|key|api-?key)")
_RE_ALNUM = re.compile(r"[A-Za-z0-9]+")
_RE_PALAVRA_SEMENTE = re.compile(r"[A-Za-z]{3,8}[,;.]?")
_RE_NUMERACAO = re.compile(r"\d{1,2}[.)]?")
_LINHAS_DE_BAIXO = 30                   # até quantas linhas seguintes somem depois de uma linha que só nomeia o segredo
_PALAVRAS_DE_PROSA = 12                 # linha mais longa que isto é prosa, não valor: a sequência escondida termina
_TETO_MASCARA = 100_000                 # o trecho do modelo tem até 8.000; isto é só uma trava contra abuso


def _so_marcadores(linha: str) -> str:
    return "".join(" " + s for s in _RE_SENT.findall(linha))


def _linha_de_rotulo(ln: str, m: re.Match) -> bool:
    """A linha só NOMEIA o segredo (o valor está na linha de baixo)? Nada depois da palavra, termina em ':',
    é curta, ou é cabeçalho de tabela (| ou TAB) ou de CSV (2+ vírgulas)."""
    resto = _RE_SENT.sub("", ln[m.end():]).strip(" \t:=|>-\"'")
    if not resto or ln.rstrip().endswith(":") or len(ln.split()) <= 4:
        return True
    return ln.count("|") >= 2 or "\t" in ln or ln.count(", ") >= 2


def _esconder_flags(linha: str) -> str:
    """O argumento das flags de senha (-p X, -P X, -a X, -N X, --password X, --token=X, /user:x, user%X)."""
    partes = re.split(r"(\s+)", linha)
    saida: list[str] = []
    esconder_proxima = False
    ultima_palavra = -1                                   # índice (em `saida`) da última palavra, para "X /user:nome"
    for p in partes:
        if not p or p.isspace():
            saida.append(p)
            continue
        if esconder_proxima:
            saida.append(OCULTO)
            esconder_proxima = False
        elif p in _FLAGS_DE_SENHA or _FLAG_LONGA.fullmatch(p):
            saida.append(p)
            esconder_proxima = True
        elif "=" in p and _FLAG_LONGA.fullmatch(p.split("=", 1)[0]):
            saida.append(p.split("=", 1)[0] + "=" + OCULTO)
        elif p.startswith("/user:"):
            if ultima_palavra >= 0:                       # `net use Z: \\nas\x W /user:r`: a senha vem ANTES
                saida[ultima_palavra] = OCULTO
            saida.append(p)
        elif 0 < p.find("%") < len(p) - 1 and p[:p.find("%")].isalnum():
            saida.append(p[:p.find("%") + 1] + OCULTO)    # smbclient -U user%senha
        else:
            saida.append(p)
        ultima_palavra = len(saida) - 1
    return "".join(saida)


def _esconder_pedacos_com_simbolo(linha: str) -> str:
    """Senha forte escrita em pedaços curtos separados por espaço ("Kx9; mP2) vL8]"): 3 ou mais palavras seguidas de
    3 a 8 caracteres em que cada uma mistura 3 classes (minúscula, maiúscula, número, símbolo)."""
    seq: list[re.Match] = []
    cortes: list[tuple[int, int]] = []
    for x in [*re.finditer(r"\S+", linha), None]:
        if x is not None and 3 <= len(x.group(0)) <= 8 and _classes(x.group(0)) >= 3:
            seq.append(x)
            continue
        if len(seq) >= 3:
            cortes.append((seq[0].start(), seq[-1].end()))
        seq = []
    for a, b in reversed(cortes):
        linha = linha[:a] + OCULTO + linha[b:]
    return linha


def _esconder_grupos(linha: str) -> str:
    """Senha de app do Google, chave do autenticador, códigos de backup, número de cartão: grupos curtos de
    3 a 8 caracteres separados por UM espaço ou hífen. Some um bloco de grupos seguidos de MESMO tamanho (4 ou
    mais; 3 se algum tem dígito), um bloco de 3 ou mais com dígito e um par só de números ("1234 5678")."""
    linha = _esconder_pedacos_com_simbolo(linha)
    ms = list(_RE_ALNUM.finditer(linha))
    if len(ms) < 2:
        return linha
    cortes: list[tuple[int, int]] = []

    def blocos(sub: list[re.Match]) -> None:
        # sub: grupos de 3 a 8 caracteres, seguidos e separados por 1 espaço/hífen
        textos = [x.group(0) for x in sub]
        n = len(sub)
        i = 0
        while i < n:                                              # (a) mesmo tamanho
            j = i
            while j + 1 < n and len(textos[j + 1]) == len(textos[i]):
                j += 1
            tam = j - i + 1
            if tam >= 4 or (tam >= 3 and any(re.search(r"\d", g) for g in textos[i:j + 1])) \
                    or (tam >= 2 and all(g.isdigit() for g in textos[i:j + 1])):
                cortes.append((sub[i].start(), sub[j].end()))
            i = j + 1
        i = 0
        while i < n:                                              # (b) com dígito
            if not re.search(r"\d", textos[i]):
                i += 1
                continue
            j = i
            while j + 1 < n and re.search(r"\d", textos[j + 1]):
                j += 1
            if j - i + 1 >= 3 or (j - i + 1 >= 2 and all(g.isdigit() for g in textos[i:j + 1])):
                cortes.append((sub[i].start(), sub[j].end()))
            i = j + 1

    sub: list[re.Match] = []
    anterior: re.Match | None = None
    for x in ms:
        curto = 3 <= len(x.group(0)) <= 8
        junto = anterior is not None and x.start() == anterior.end() + 1 and linha[anterior.end()] in " -"
        if curto and (junto or not sub):
            sub.append(x)
        else:
            blocos(sub)
            sub = [x] if curto else []
        anterior = x
    blocos(sub)
    # junta cortes que se tocam ou se sobrepõem e aplica de trás para a frente
    unidos: list[list[int]] = []
    for a, b in sorted(cortes):
        if unidos and a <= unidos[-1][1] + 1:
            unidos[-1][1] = max(unidos[-1][1], b)
        else:
            unidos.append([a, b])
    for a, b in reversed(unidos):
        linha = linha[:a] + OCULTO + linha[b:]
    return linha


def _esconder_semente_corrida(texto: str) -> str:
    """Frase-semente fora do formato canônico (numerada, com vírgulas, uma palavra por linha, com rótulo na
    frente, Capitalizada): 12 ou mais palavras seguidas de 3 a 8 letras, quase todas diferentes."""
    cortes: list[tuple[int, int]] = []
    run: list[re.Match] = []
    palavras: list[str] = []
    fim_run = 0

    def fechar() -> None:
        if len(palavras) >= 12 and len({w.lower() for w in palavras}) >= 10:
            cortes.append((run[0].start(), fim_run))

    for m in re.finditer(r"\S+", texto):
        tok = m.group(0)
        if _RE_PALAVRA_SEMENTE.fullmatch(tok):
            run.append(m)
            palavras.append(tok.strip(",;."))
            fim_run = m.end()
        elif _RE_NUMERACAO.fullmatch(tok) and run:
            fim_run = m.end()
        else:
            if run:
                fechar()
            run, palavras = [], []
    if run:
        fechar()
    for a, b in reversed(cortes):
        texto = texto[:a] + OCULTO + texto[b:]
    return texto


def _processar_linhas(linhas: list[str], reforco: bool) -> list[str]:
    saida: list[str] = []
    esconder = vazias = 0
    for ln in linhas:
        if esconder:
            if not ln.strip():
                vazias += 1
                esconder = 0 if vazias > 3 else esconder
                saida.append(ln)
                continue
            if len(ln.split()) <= _PALAVRAS_DE_PROSA:
                saida.append(OCULTO + _so_marcadores(ln))
                esconder -= 1
                continue
        esconder = vazias = 0
        if _frase_semente(ln.strip()):
            saida.append(OCULTO)
            continue
        if not reforco:
            saida.append(_mascarar_linha(ln))
            continue
        ln = _esconder_flags(ln)
        m = _CTX.search(ln)
        if m is None:
            saida.append(_esconder_grupos(_mascarar_linha(ln)))
            continue
        if not ln[:m.start()].strip() and _SO_SENTINELAS.fullmatch(ln[m.end():]):
            saida.append(ln)                                   # "senha: {{SEGREDO:id}}": já está no cofre, fica
            continue
        if _linha_de_rotulo(ln, m):
            esconder = _LINHAS_DE_BAIXO
        saida.append(f"{OCULTO} {m.group(0)} {OCULTO}" + _so_marcadores(ln))
    return saida


def mascarar_para_o_modelo(trecho: str, reforco: bool = True) -> str | None:
    """O trecho (já cortado) que pode ir ao modelo, com tudo que lembre segredo trocado por
    <oculto>. None = não mande texto (há sinal de segredo partido em linhas). O arquivo
    original NÃO muda; isto é só a visão do agente."""
    limpo, _ = _sem_invisiveis(trecho[:_TETO_MASCARA])
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
    texto = "\n".join(_processar_linhas(visao.split("\n"), reforco))
    if reforco:
        texto = _esconder_semente_corrida(texto)
    return _RE_SENTINELA.sub(lambda m: marcadores[int(m.group(1))], texto)


def mascarar_nome_para_o_modelo(nome: str) -> str:
    """Nome de arquivo ou rótulo que pode ir ao modelo e ao aviso do WhatsApp. Só mexe no que tem cara de segredo
    (palavra de contexto, ou o filtro principal achou): senão `contrato-silmer-2026.pdf` viraria `<oculto>` e
    o modelo não teria o que organizar. A extensão fica (o modelo precisa repeti-la)."""
    base, ponto, ext = nome.rpartition(".")
    if not ponto or not base or not re.fullmatch(r"[A-Za-z0-9]{1,8}", ext):
        base, ext = nome, ""
    m = _CTX.search(base)
    if m is None and not tem_segredo(base):
        return nome
    corpo = f"{OCULTO} {m.group(0)} {OCULTO}" if m else OCULTO
    return corpo + (f".{ext}" if ext else "")


# ---------------------------------------------------------------- varredura em fluxo
class Varredor:
    """Procura segredo em um fluxo de bytes (arquivo grande), sem guardar o conteúdo.
    Olha o texto como Latin-1 e também sem os bytes nulos (UTF-16: 'a\\x00b\\x00' vira 'ab')."""
    JANELA = 4096          # sobra de um pedaço para o outro, para o padrão não cair na emenda

    def __init__(self):
        self._cauda = b""
        self.regras: set[str] = set()

    @staticmethod
    def _parece_texto(visao: bytes) -> bool:
        """Cadeia longa e aleatória só vale como segredo em texto: num PDF, numa fonte ou numa imagem os bytes
        de dados formam cadeias que parecem chave e não são (revisão de 04/10: 141 de 320 arquivos reais
        bloqueados, sem segundo clique). Regras de forma (chave privada, token conhecido...) valem sempre."""
        amostra = visao[:65536]
        if not amostra:
            return True
        legiveis = sum(1 for b in amostra if b in (9, 10, 13) or 32 <= b <= 126)
        return legiveis / len(amostra) >= 0.85

    def alimentar(self, pedaco: bytes) -> bool:
        dados = self._cauda + pedaco
        visoes = (dados, dados.replace(b"\x00", b"")) if b"\x00" in dados else (dados,)
        for visao in visoes:
            for _, _, nome in _brutos(visao.decode("latin-1"), self._parece_texto(visao), primeiro=True):
                self.regras.add(nome)
        self._cauda = dados[-self.JANELA:]
        return bool(self.regras)
