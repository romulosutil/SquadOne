"""Registro das ofertas do PRUMO (28/10/2026): prumo-ofertas.json, lido de um lugar só.

Pedido do Rômulo: "uma oferta nova = um bloco em prumo-ofertas.json + um comando" (nova-oferta.py).
Até aqui crm.py, whatsapp-conversa.py, workflow_contexto_whatsapp.py, serializacao_aquisicao.py e
jev-respostas-resumo.py tinham "iris" e "estampa" escritos à mão, e esquecer um deles calava a oferta
nova (registro recusado como "Produto inválido", aba fora da guarda do contexto, caçador sem a posse
exclusiva). Agora eles derivam daqui.

O JSON mora AO LADO deste arquivo (no Dell, ~/.local/share/claude-ops/, entrada própria em
deploy/dell/instalados.json). Falta dele ou JSON inválido é exceção, nunca lista vazia: uma lista vazia
publicaria o CRM e os fluxos do WhatsApp sem nenhuma oferta, calados.

Puro: sem rede, sem n8n, sem relógio. Scripts instalados fora de claude-ops (observador, frente-comercial,
publicador-crm, aquisicao-guarda, Hermes) não têm o JSON ao lado: lá a lista continua escrita e
ofertas.test.py falha se ela divergir do JSON.
"""
import json
import re
import unicodedata
from pathlib import Path

AQUI = Path(__file__).resolve().parent
ARQUIVO = AQUI / "prumo-ofertas.json"

# Produtos do CRM que não são oferta deste registro, e nomes que o código gerado usa como variável ou
# chave do retrato (crm.py MONTAR_JS: `const <id> = ler(...)`, `fontes.<id>`). Uma oferta com um destes
# ids sobrescreveria a fonte de outra.
PRODUTOS_FORA_DO_REGISTRO = ("site", "prumo", "plus")
RESERVADOS = frozenset({
    *PRODUTOS_FORA_DO_REGISTRO, "registros", "agora", "arquivo", "ler", "txt", "norm", "links", "fontes",
    "versao", "origem", "porte", "erro", "webhook",
    # palavras reservadas do JavaScript com 3 a 12 letras minúsculas
    "await", "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete", "do",
    "else", "enum", "export", "extends", "false", "finally", "for", "function", "if", "implements", "import",
    "in", "instanceof", "interface", "let", "new", "null", "package", "private", "protected", "public",
    "return", "static", "super", "switch", "this", "throw", "true", "try", "typeof", "var", "void", "while",
    "with", "yield", "async", "of", "undefined", "arguments", "eval",
})
ID = re.compile(r"^[a-z]{3,12}$")
# Abas que já existem nas planilhas com outro dono: uma oferta nelas gravaria por cima do PRUMO ou do CRM.
ABAS_RESERVADAS = frozenset({"Prospects", "Descartados", "CRM", "Leads"})
# Links do retrato que já têm dono (crm.py MONTAR_JS).
LINKS_RESERVADOS = frozenset({"planilhaSite", "planilhaPrumo", "planilhaCrm", "webhook"})


class RegistroInvalido(ValueError):
    """prumo-ofertas.json ausente, ilegível ou sem o que o gerador precisa. Nunca vira lista vazia."""


def carregar(arquivo=None):
    """O JSON inteiro (nível de cima + ofertas). Exceção se faltar, não ler ou não tiver oferta."""
    caminho = Path(arquivo) if arquivo is not None else ARQUIVO
    try:
        config = json.loads(caminho.read_text(encoding="utf-8"))
    except FileNotFoundError as e:
        raise RegistroInvalido(f"registro de ofertas ausente: {caminho}") from e
    except (OSError, UnicodeError, json.JSONDecodeError) as e:
        raise RegistroInvalido(f"registro de ofertas ilegível ({caminho}): {e}") from e
    if not isinstance(config, dict) or not isinstance(config.get("ofertas"), dict) or not config["ofertas"]:
        raise RegistroInvalido(f"registro de ofertas sem bloco 'ofertas' ({caminho})")
    for k, o in config["ofertas"].items():
        if not isinstance(o, dict):
            raise RegistroInvalido(f"oferta {k!r} não é um objeto")
    return config


def _cfg(config):
    return carregar() if config is None else config


def ids(config=None):
    """Ids na ordem do JSON (a ordem é a das leituras nos fluxos: não reordene o arquivo à toa)."""
    return list(_cfg(config)["ofertas"])


def oferta(id_, config=None):
    cfg = _cfg(config)
    try:
        return cfg["ofertas"][id_]
    except KeyError:
        raise RegistroInvalido(f"oferta {id_!r} não está em prumo-ofertas.json (há: {', '.join(cfg['ofertas'])})") from None


def campo(id_, nome, config=None):
    """Campo obrigatório de uma oferta, com erro que diz qual oferta e qual campo (nunca KeyError cru)."""
    o = oferta(id_, config)
    if nome not in o:
        raise RegistroInvalido(f"oferta {id_!r} sem o campo {nome!r} em prumo-ofertas.json")
    return o[nome]


def abas(config=None):
    """{id: aba}."""
    return {k: campo(k, "aba", config) for k in ids(config)}


def leituras(config=None):
    """Nome do nó de leitura de cada oferta nos fluxos ("Ler <aba>"), na ordem do JSON."""
    return [f"Ler {a}" for a in abas(config).values()]


def fluxos(config=None):
    """Nome do caçador de cada oferta (é por ele que o n8n e a guarda de aquisição acham o fluxo)."""
    return [campo(k, "fluxo", config) for k in ids(config)]


def conversa(id_, config=None):
    """O que os fluxos do WhatsApp contam ao Gemini sobre o convite e o passo de quem respondeu."""
    c = campo(id_, "conversa", config)
    if not isinstance(c, dict) or any(not isinstance(c.get(k), str) or not c[k].strip() for k in ("o_que_foi", "interesse")):
        raise RegistroInvalido(f"oferta {id_!r}: 'conversa' precisa de 'o_que_foi' e 'interesse' (texto)")
    return {"o_que_foi": c["o_que_foi"], "interesse": c["interesse"]}


def produtos_do_crm(config=None):
    """Produtos que o registro da Central aceita (crm.py VALIDAR_JS), na ordem das telas."""
    return ["site", "prumo", *ids(config), "plus"]


def fontes_do_retrato(config=None):
    """Chaves de `fontes` no crm.json (o publicador-crm exige exatamente estas)."""
    return ["site", "prumo", *ids(config), "registros"]


def slug(texto):
    """'Clínicas' -> 'clinicas': id de nó estável, sem acento."""
    t = unicodedata.normalize("NFD", texto.lower()).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")


def js_texto(texto):
    """Literal JS entre aspas simples, do jeito que o código gerado sempre escreveu. Recusa o que precisaria
    de escape (aspas, barra, quebra de linha): aba e nomes vão literais para o código do n8n."""
    if not isinstance(texto, str) or re.search(r"['\\\n\r  ]", texto):
        raise RegistroInvalido(f"texto não cabe literal no código gerado: {texto!r}")
    return "'" + texto + "'"


def conferir(config=None):
    """O contrato de prospeccao_contrato.py para todas as ofertas; exceção na primeira que falhar.
    Os publicadores chamam antes de tocar o n8n."""
    import prospeccao_contrato  # import tardio: o contrato usa as constantes deste módulo
    cfg = _cfg(config)
    for k in ids(cfg):
        try:
            prospeccao_contrato.contrato_oferta(cfg, k)
        except ValueError as e:
            raise RegistroInvalido(f"oferta {k!r} fora do contrato: {e}") from e
    return cfg


if __name__ == "__main__":
    cfg = carregar()
    for k in ids(cfg):
        o = cfg["ofertas"][k]
        print(f"{k}: {o.get('rotulo')} · aba {o.get('aba')} · {o.get('fluxo')}")
