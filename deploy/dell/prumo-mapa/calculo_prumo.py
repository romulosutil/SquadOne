"""O cálculo PRUMO: o método único por trás da Nota de autonomia (Mapa) e da Nota de presença (Raio-X).

Fonte da verdade: ~/prumo/05-entrega-mapa/calculo-prumo.md. Este módulo implementa o
que está lá, e só isso; mudou a regra, muda o documento primeiro.

  - escala 0 a 3 por bloco, seis blocos, nota de 0 a 18 e as três faixas de leitura;
  - a regra do MIN (vale a menor nota entre as fontes; a divergência vira achado);
  - autonomia: os 16 IDs do Mapa, o rollup nos 6 blocos e o kit de fórmulas das travas;
  - presença: os 6 blocos do Raio-X, com os limiares, e "não medido" quando falta o dado;
  - a conta aberta da calculadora do Raio-X, em Python e no JS que vai na página
    (gerado aqui, com as mesmas constantes);
  - o HTML da Nota de presença no Raio-X, no CSS do raio-x.py: a faixa na frente (com o fio de
    prumo) e, no detalhe "Como fizemos", o "X de 18" com os blocos e a calculadora.

PURO: sem rede, disco, relógio nem ambiente. Usado por raio-x.py e prumo_mapa.py; os
dois rodam no Dell a partir da cópia em ~/.local/share/prumo-mapa/ (instalados.json).

Testes: python3 deploy/dell/prumo-mapa/calculo_prumo.test.py
"""
from __future__ import annotations

import html
import math
import re
from decimal import ROUND_HALF_UP, Decimal

# ------------------------------------------------------------------ escala, nota e faixas

NOTA_MAXIMA_BLOCO = 3
BLOCOS_POR_NOTA = 6
NOTA_MAXIMA = NOTA_MAXIMA_BLOCO * BLOCOS_POR_NOTA  # 18

# O que cada nível quer dizer. A autonomia usa a escala do roteiro do Mapa ao pé da letra;
# a presença é a mesma régua lida de fora (o que o cliente encontra, não o que existe por dentro).
ESCALA_AUTONOMIA = {
    0: "não existe",
    1: "existe só na cabeça de alguém",
    2: "existe escrito, mas não é seguido",
    3: "existe, é seguido, tem dono e data de revisão",
}
ESCALA_PRESENCA = {
    0: "não existe para quem procura",
    1: "existe, mas longe do que o cliente compara",
    2: "existe e funciona em parte: falta pouco",
    3: "em dia: igual ou melhor que os primeiros da busca",
}

# Faixas de leitura [proposta a confirmar no calculo-prumo.md]. A nota tem uma casa decimal:
# abaixo de 7 é a primeira faixa, de 7 até abaixo de 13 a segunda, 13 ou mais a terceira.
FAIXAS = (
    {"ate": 7, "chave": "baixa",
     "autonomia": ("Na cabeça", "As regras da casa moram na cabeça de poucas pessoas, e quase toda exceção "
                                "volta para você."),
     "presenca": ("Pouco visível", "Quem procura no Google acha pouco de vocês, e quem compara tende a "
                                   "escolher outro.")},
    {"ate": 13, "chave": "media",
     "autonomia": ("Em construção", "Parte das regras já está escrita, mas nem sempre é seguida. O time resolve "
                                    "o dia a dia e ainda sobe as exceções."),
     "presenca": ("Em construção", "Vocês aparecem, mas quem compara ainda vê lacunas que os concorrentes "
                                   "não têm.")},
    {"ate": None, "chave": "alta",
     "autonomia": ("Rodando", "As regras estão escritas, são seguidas e têm dono. A empresa roda sem você "
                              "no meio de cada decisão."),
     "presenca": ("Bem visível", "Quem procura acha vocês e encontra o que precisa para escolher. O trabalho "
                                 "agora é manter.")},
)


def faixa(nota: float | None, tipo: str) -> dict | None:
    """{'chave', 'rotulo', 'texto'} da faixa de uma nota de 0 a 18; tipo 'autonomia' ou 'presenca'."""
    if nota is None:
        return None
    if tipo not in ("autonomia", "presenca"):
        raise ValueError(f"tipo de nota desconhecido: {tipo!r}")
    for f in FAIXAS:
        if f["ate"] is None or nota < f["ate"]:
            rotulo, texto = f[tipo]
            return {"chave": f["chave"], "rotulo": rotulo, "texto": texto}
    raise AssertionError


# ------------------------------------------------------------------ arredondamento e números

def arredondar(valor: float, casas: int = 0) -> float | int:
    """Meio para cima (1072,5 -> 1073), como o Math.round do JS para positivos; o round() do
    Python arredonda o meio para o par e daria diferença entre a página e o documento."""
    d = Decimal(repr(valor)).quantize(Decimal(1).scaleb(-casas), rounding=ROUND_HALF_UP)
    return int(d) if casas == 0 else float(d)


def arredondar_real(valor: float) -> int:
    """Um valor mensal em reais, no real inteiro mais próximo (meio sobe)."""
    return int(arredondar(valor))


def num(x):
    """Número de um campo que o Rômulo preenche: aceita 12, 12.5, "12,5", "R$ 1.250,50", "10,9%";
    vazio = None."""
    if x is None or x == "":
        return None
    if isinstance(x, bool):
        raise ValueError(f"número esperado, veio {x!r}")
    if isinstance(x, (int, float)):
        return x
    t = str(x).strip().replace("R$", "").replace("%", "").strip()
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?", t):
        t = t.replace(".", "")
    return float(t.replace(",", "."))


def milhar(n: int) -> str:
    return f"{n:,}".replace(",", ".")


def brl(v) -> str:
    """R$ no formato pt-BR: inteiro sem centavos (R$ 15.232), fracionário com dois (R$ 112,50)."""
    v = num(v)
    if v is None:
        return "R$ ?"
    if abs(v - round(v)) < 0.005:
        return f"R$ {milhar(int(round(v)))}"
    inteiro_, frac = f"{v:.2f}".split(".")
    return f"R$ {milhar(int(inteiro_))},{frac}"


def decimal_br(v: float, casas: int = 1) -> str:
    return f"{v:.{casas}f}".replace(".", ",")


def mediana(valores: list[float]) -> float | None:
    v = sorted(valores)
    if not v:
        return None
    meio = len(v) // 2
    return float(v[meio]) if len(v) % 2 else (v[meio - 1] + v[meio]) / 2


def juntar(itens: list[str]) -> str:
    itens = [i for i in itens if i]
    if not itens:
        return ""
    return itens[0] if len(itens) == 1 else ", ".join(itens[:-1]) + " e " + itens[-1]


# ------------------------------------------------------------------ regra do MIN

def regra_do_min(votos: list[dict]) -> tuple[int | None, dict | None]:
    """Votos de várias fontes para o mesmo ponto ({'fonte', 'dono': bool, 'nota'}) -> (nota final,
    divergência). Vale a menor nota. Divergência = o dono e alguém do time deram notas diferentes;
    ela é achado à parte, não ajuste da nota."""
    validos = [v for v in votos if v.get("nota") is not None]
    if not validos:
        return None, None
    final = min(v["nota"] for v in validos)
    dono = [v for v in validos if v.get("dono")]
    time_ = [v for v in validos if not v.get("dono")]
    if dono and time_ and any(v["nota"] != dono[0]["nota"] for v in time_):
        menor = min(v["nota"] for v in time_)
        return final, {"dono": dono[0], "time": [v for v in time_ if v["nota"] == menor]}
    return final, None


# ------------------------------------------------------------------ autonomia (Mapa)

# ID -> (área, camada, tema curto para o cliente). Roteiro do Mapa (roteiro-mapa-execucao.md).
IDS_AUTONOMIA = {
    "AR1": ("A", "Regra", "Desconto"),
    "AR2": ("A", "Regra", "Crédito para cliente novo"),
    "AD1": ("A", "Dado", "Preço de tabela"),
    "AM1": ("A", "Memória", "Exceções de preço"),
    "BR1": ("B", "Regra", "Escolha de fornecedor"),
    "BR2": ("B", "Regra", "Teto de compra"),
    "BD1": ("B", "Dado", "Cadastro de fornecedor"),
    "BM1": ("B", "Memória", "Troca de fornecedor"),
    "CR1": ("C", "Regra", "Entrega para quem deve"),
    "CR2": ("C", "Regra", "Régua de cobrança"),
    "CD1": ("C", "Dado", "Quem está inadimplente"),
    "CM1": ("C", "Memória", "Corte de cliente"),
    "DR1": ("D", "Regra", "Substituto de função-chave"),
    "DR2": ("D", "Regra", "Limites de decisão"),
    "DD1": ("D", "Dado", "Quem faz o quê"),
    "DM1": ("D", "Memória", "Decisões repetidas"),
}

# Rollup dos 16 IDs nos 6 blocos (cada bloco = média dos seus IDs).
BLOCOS_AUTONOMIA = [
    ("vendemos", "Como vendemos", ["AR1", "AR2"]),
    ("compramos", "Como compramos", ["BR1", "BR2"]),
    ("entregamos", "Entrega e cobrança", ["CR1", "CR2"]),
    ("quem", "Quem faz o quê", ["DR1", "DR2"]),
    ("cadastros", "Cadastros oficiais", ["AD1", "BD1", "CD1", "DD1"]),
    ("decisoes", "Decisões", ["AM1", "BM1", "CM1", "DM1"]),
]


def eh_dono(sessao: dict) -> bool:
    return str(sessao.get("papel") or "").strip().lower().startswith("dono")


def eh_coleta(sessao: dict) -> bool:
    return "coleta" in str(sessao.get("papel") or "").lower()


def nota_de(valor) -> int | None:
    """Resposta de uma sessão: {"resposta", "nota"} ou só a nota (0 a 3)."""
    n = valor.get("nota") if isinstance(valor, dict) else valor
    if isinstance(n, bool) or n is None:
        return None
    if not isinstance(n, (int, float)) or not 0 <= n <= 3 or int(n) != n:
        raise ValueError(f"nota fora de 0 a 3: {n!r}")
    return int(n)


def consolidar(sessoes: list[dict]) -> dict:
    """Regra do MIN por ID; divergência quando dono e time dão notas diferentes."""
    por_id: dict[str, list[dict]] = {}
    for s in sessoes:
        for id_, valor in (s.get("respostas") or {}).items():
            if id_ not in IDS_AUTONOMIA:
                raise ValueError(f"ID desconhecido na sessão {s.get('papel')!r}: {id_}")
            n = nota_de(valor)
            if n is None:
                continue
            resposta = valor.get("resposta", "") if isinstance(valor, dict) else ""
            por_id.setdefault(id_, []).append({"papel": s.get("papel") or "?", "dono": eh_dono(s),
                                               "nota": n, "resposta": resposta})
    final, divergencias = {}, []
    for id_ in IDS_AUTONOMIA:
        votos = por_id.get(id_)
        if not votos:
            continue
        final[id_], div = regra_do_min(votos)
        if div:
            divergencias.append({"id": id_, "tema": IDS_AUTONOMIA[id_][2], **div})
    return {"final": final, "votos": por_id, "divergencias": divergencias}


def rollup(final: dict) -> tuple[list[dict], float | None]:
    """Os 6 blocos (média dos IDs de cada um) e a Nota de autonomia (soma dos 6, 0 a 18).
    Bloco sem nenhum ID respondido deixa a nota sem valor: a conta não inventa o que falta."""
    blocos = []
    for chave, nome, ids in BLOCOS_AUTONOMIA:
        notas = [final[i] for i in ids if i in final]
        blocos.append({"chave": chave, "nome": nome, "ids": ids,
                       "nota": sum(notas) / len(notas) if notas else None, "faltam": [i for i in ids if i not in final]})
    nota = sum(b["nota"] for b in blocos) if all(b["nota"] is not None for b in blocos) else None
    return blocos, nota


# ------------------------------------------------------------------ kit de fórmulas (R$ por mês)

SEMANAS_POR_MES = 4.33
HORAS_POR_MES = 160  # pró-labore mensal ÷ 160 h = valor-hora do dono
MESES_POR_ANO = 12
FORMULAS = ("tempo_dono", "margem", "retrabalho")  # recorrentes; o risco nunca é fórmula mensal


def valor_hora(pro_labore=None, valor_hora_direto=None) -> float | None:
    """O valor perguntado direto vence; sem ele, pró-labore ÷ 160 h."""
    if num(valor_hora_direto) is not None:
        return num(valor_hora_direto)
    pl = num(pro_labore)
    return pl / HORAS_POR_MES if pl is not None else None


def custo_tempo(por_semana, minutos, valor_hora_) -> float | None:
    """1 · tempo do dono: decisões/semana × minutos ÷ 60 × 4,33 × valor-hora."""
    n, m, vh = num(por_semana), num(minutos), num(valor_hora_)
    return None if None in (n, m, vh) else n * m / 60 * SEMANAS_POR_MES * vh


def custo_margem(base_mes, fracao_pct, taxa_pct) -> float | None:
    """2 · margem/erro: base mensal × fração afetada (%) × diferença medida (%)."""
    b, fr, tx = num(base_mes), num(fracao_pct), num(taxa_pct)
    return None if None in (b, fr, tx) else b * fr / 100 * tx / 100


def custo_retrabalho(por_mes, minutos, pessoas, valor_hora_, por_trimestre=None) -> float | None:
    """4 · retrabalho: vezes/mês (ou do trimestre ÷ 3) × minutos ÷ 60 × pessoas × valor-hora do time."""
    n = num(por_mes)
    if n is None and num(por_trimestre) is not None:
        n = num(por_trimestre) / 3
    m, p, vh = num(minutos), num(pessoas), num(valor_hora_)
    return None if None in (n, m, p, vh) else n * m / 60 * p * vh


def valor_da_trava(t: dict, valor_hora_dono: float | None, valor_hora_time: float | None) -> float | None:
    """Uma trava do dados.json do Mapa, em R$ por mês (sem arredondar). `valor_mes` direto vence."""
    if num(t.get("valor_mes")) is not None:
        return num(t["valor_mes"])
    f = t.get("formula")
    if f == "tempo_dono":
        return custo_tempo(t.get("por_semana"), t.get("minutos"), num(t.get("valor_hora")) or valor_hora_dono)
    if f == "margem":
        return custo_margem(t.get("base_mes"), t.get("fracao_pct"), t.get("taxa_pct"))
    if f == "retrabalho":
        return custo_retrabalho(t.get("por_mes"), t.get("minutos"), t.get("pessoas"),
                                num(t.get("valor_hora")) or valor_hora_time, t.get("por_trimestre"))
    return None


def total_mensal(valores_arredondados: list[int]) -> int:
    """Soma das parcelas JÁ arredondadas (os números impressos lado a lado batem). Só recorrente:
    risco e estoque ficam fora, em frase separada."""
    if any(not isinstance(v, int) for v in valores_arredondados):
        raise ValueError("some só valores já arredondados ao real")
    return sum(valores_arredondados)


def anualizar(mensal_arredondado: int) -> int:
    """Sempre o mensal já arredondado × 12, nunca o valor cheio."""
    if not isinstance(mensal_arredondado, int):
        raise ValueError("anualize o mensal já arredondado ao real")
    return mensal_arredondado * MESES_POR_ANO


# ------------------------------------------------------------------ presença (Raio-X)

BLOCOS_PRESENCA = [
    ("busca", "Aparece na busca"),
    ("nota", "Nota no Google"),
    ("avaliacoes", "Avaliações"),
    ("respostas", "Responde às avaliações"),
    ("perfil", "Perfil completo"),
    ("site", "Site e WhatsApp"),
]
MIN_BLOCOS_MEDIDOS = 4  # com menos, não há nota: só os blocos
CONCORRENTES_POR_BUSCA = 5  # os primeiros que não são a empresa (o raio-x.py usa os mesmos 5)

# Limiares (justificados no calculo-prumo.md, "Nota de presença").
BUSCA_TOPO = 3  # o pacote local do Google mostra 3 empresas antes de "Mais empresas"
BUSCA_LISTA = 10  # até aqui aparece rolando pouco a lista
NOTA_FILTRO_ALTO = 4.5  # degraus do filtro de nota do Google Maps
NOTA_FILTRO_MEDIO = 4.0
RESPOSTAS_MINIMO = 3  # menos que isso não diz nada sobre o hábito de responder
PERFIL_ITENS = [
    ("horario", "o horário"),
    ("fotos", "fotos publicadas por vocês"),
    ("categoria", "uma categoria que diga o que vocês fazem"),
    ("telefone", "o telefone"),
    ("site", "o botão “Site”"),
]
PERFIL_MINIMO_CONFERIDO = 3


def _bloco(chave: str, nota: int | None, linha: str, cenario: str | None = None) -> dict:
    nome = dict(BLOCOS_PRESENCA)[chave]
    return {"chave": chave, "nome": nome, "nota": nota, "medido": nota is not None, "linha": linha,
            "cenario": cenario if nota is not None and nota < NOTA_MAXIMA_BLOCO else None}


def _lugar(b: dict) -> str:
    return f"{b['posicao']}º lugar" if b.get("posicao") else f"fora dos {b.get('lidos') or 0} primeiros"


def nota_da_posicao(posicao: int | None) -> int:
    if posicao is None:
        return 0
    if posicao <= BUSCA_TOPO:
        return 3
    if posicao <= BUSCA_LISTA:
        return 2
    return 1


def bloco_busca(buscas: list[dict] | None) -> dict:
    """1 · Aparece na busca. `buscas`: [{'consulta', 'posicao' (1.. ou None = não apareceu), 'lidos'}].
    Mais de uma busca: vale a MENOR nota (regra do MIN), e as outras entram na linha."""
    buscas = [b for b in buscas or [] if b.get("consulta") and b.get("lidos")]
    if not buscas:
        return _bloco("busca", None, "Não medimos: a busca não foi feita para este Raio-X.")
    notas = [nota_da_posicao(b.get("posicao")) for b in buscas]
    pior = min(range(len(buscas)), key=lambda i: (notas[i], i))
    b = buscas[pior]
    linha = f"{_lugar(b).capitalize()} em “{b['consulta']}”."
    outras = [_lugar(x) for i, x in enumerate(buscas) if i != pior]
    if outras:
        iguais = len(set(outras)) == 1
        linha += (f" Nas outras {len(outras)} buscas, {outras[0]}." if iguais and len(outras) > 1
                  else f" Na outra busca, {outras[0]}." if len(outras) == 1
                  else f" Nas outras buscas: {juntar(outras)}.")
    cenario = f"Se vocês aparecessem entre os {BUSCA_TOPO} primeiros em “{b['consulta']}” (hoje, {_lugar(b)})"
    return _bloco("busca", notas[pior], linha, cenario)


def bloco_nota(nota: float | None, avaliacoes: int | None) -> dict:
    """2 · Nota no Google: 4,5 ou mais = 3; 4,0 a 4,4 = 2; abaixo de 4,0 = 1; sem nota = 0."""
    if avaliacoes is None:
        return _bloco("nota", None, "Não medimos a nota.")
    if avaliacoes == 0 or nota is None:
        return _bloco("nota", 0, "Ainda sem nota: o perfil não tem avaliações.")
    n = decimal_br(nota)
    if nota >= NOTA_FILTRO_ALTO:
        return _bloco("nota", 3, f"{n} de 5: aparece até para quem filtra por 4,5 estrelas no Google Maps.")
    cenario = f"Se a nota chegasse a 4,5 (hoje, {n})"
    if nota >= NOTA_FILTRO_MEDIO:
        return _bloco("nota", 2, f"{n} de 5: fica fora de quem filtra por 4,5 estrelas no Google Maps.", cenario)
    return _bloco("nota", 1, f"{n} de 5: fica fora de quem filtra por 4 estrelas no Google Maps.", cenario)


def concorrentes_da_busca(buscas: list[dict] | None) -> list[int]:
    """Avaliações dos concorrentes: os CONCORRENTES_POR_BUSCA primeiros de cada busca que não são a
    empresa, sem repetir o mesmo perfil entre buscas. Quem não tem número fica fora (não vira zero)."""
    vistos, valores = set(), []
    for b in buscas or []:
        for c in (b.get("concorrentes") or [])[:CONCORRENTES_POR_BUSCA]:
            chave = c.get("id") or c.get("nome") or id(c)
            if chave in vistos:
                continue
            vistos.add(chave)
            if isinstance(c.get("avaliacoes"), int) and not isinstance(c.get("avaliacoes"), bool):
                valores.append(c["avaliacoes"])
    return valores


def bloco_avaliacoes(avaliacoes: int | None, concorrentes: list[int] | None) -> dict:
    """3 · Avaliações contra a mediana dos concorrentes da mesma busca: na mediana ou acima = 3;
    da metade até a mediana = 2; abaixo da metade = 1; nenhuma = 0."""
    if avaliacoes is None:
        return _bloco("avaliacoes", None, "Não medimos o número de avaliações.")
    if avaliacoes == 0:
        return _bloco("avaliacoes", 0, "Nenhuma avaliação no Google.",
                      "Se as primeiras avaliações chegassem (hoje, nenhuma)")
    med = mediana(concorrentes or [])
    if med is None:
        return _bloco("avaliacoes", None, f"{avaliacoes} avaliações. Não comparamos: a busca não foi feita.")
    meta = math.ceil(med)  # mediana fracionada sobe: a meta nunca fica abaixo dela
    base = f"{avaliacoes} avaliaç{'ão' if avaliacoes == 1 else 'ões'}; no meio da lista, os concorrentes têm {meta}."
    cenario = f"Se as avaliações chegassem à mediana dos concorrentes (de {avaliacoes} para {meta})"
    if avaliacoes >= med:
        return _bloco("avaliacoes", 3, base)
    if avaliacoes * 2 >= med:
        return _bloco("avaliacoes", 2, base, cenario)
    return _bloco("avaliacoes", 1, f"{avaliacoes} avaliaç{'ão' if avaliacoes == 1 else 'ões'}, menos da metade das "
                                    f"{meta} que os concorrentes têm no meio da lista.", cenario)


def bloco_respostas(respostas: dict | None) -> dict:
    """4 · Responde às avaliações: {'lidas', 'respondidas'} das mais recentes. O Places não entrega a
    resposta do dono, então no Raio-X automático este bloco é sempre "não medido"."""
    if not respostas:
        return _bloco("respostas", None, "Não medimos: o Google não mostra a sistemas de fora se vocês respondem.")
    lidas, resp = int(respostas.get("lidas") or 0), int(respostas.get("respondidas") or 0)
    if lidas < RESPOSTAS_MINIMO:
        return _bloco("respostas", None, f"Não medimos: menos de {RESPOSTAS_MINIMO} avaliações recentes para conferir.")
    if not 0 <= resp <= lidas:
        raise ValueError(f"respondidas fora de 0 a {lidas}: {resp}")
    linha = f"{resp} de {lidas} avaliações recentes têm resposta de vocês."
    nota = 3 if resp == lidas else 2 if resp * 2 >= lidas else 1 if resp else 0
    return _bloco("respostas", nota, linha,
                  f"Se todas as avaliações recentes tivessem resposta de vocês (hoje, {resp} de {lidas})")


def bloco_perfil(itens: dict | None) -> dict:
    """5 · Perfil completo: horário, fotos de vocês, categoria, telefone e botão "Site".
    Cada item: 'ok', 'falta' ou None (não conferido: fica fora da conta, nunca vira falta).
    Nota = piso de 3 × itens em dia ÷ itens conferidos; com menos de 3 conferidos, não medido."""
    itens = itens or {}
    desconhecido = set(itens) - {k for k, _ in PERFIL_ITENS}
    if desconhecido:
        raise ValueError(f"item de perfil desconhecido: {sorted(desconhecido)}")
    conferidos = [(k, nome) for k, nome in PERFIL_ITENS if itens.get(k) in ("ok", "falta")]
    if len(conferidos) < PERFIL_MINIMO_CONFERIDO:
        return _bloco("perfil", None, f"Não medimos: conferimos só {len(conferidos)} dos {len(PERFIL_ITENS)} itens do perfil.")
    ok = sum(1 for k, _ in conferidos if itens[k] == "ok")
    faltas = [nome for k, nome in conferidos if itens[k] == "falta"]
    nota = NOTA_MAXIMA_BLOCO * ok // len(conferidos)
    linha = (f"Falta{'m' if len(faltas) > 1 else ''} {juntar(faltas)}. " if faltas else "") + \
        f"{ok} de {len(conferidos)} itens em dia."
    if len(conferidos) < len(PERFIL_ITENS):
        linha += f" {len(PERFIL_ITENS) - len(conferidos)} não conferido{'s' if len(PERFIL_ITENS) - len(conferidos) > 1 else ''}."
    return _bloco("perfil", nota, linha, f"Se o perfil tivesse {juntar(faltas)}" if faltas else None)


def bloco_site(site: dict | None) -> dict:
    """6 · Site e WhatsApp. `site`: {'tipo': 'nenhum'|'rede'|'proprio', 'estado': 'no_ar'|'fora'|
    'sem_nome'|None, 'celular': bool|None, 'whatsapp': bool|None, 'onde': 'o Instagram'}.
    Sem site = 0; leva a página que não abre = 0; rede social = 1; site próprio no ar = 3 menos
    cada falta CONFERIDA (não abre bem no celular, sem botão de WhatsApp)."""
    if not site or site.get("tipo") not in ("nenhum", "rede", "proprio"):
        return _bloco("site", None, "Não conferimos o site.")
    completo = "Se o botão “Site” levasse a um site de vocês, que abre no celular e tem botão de WhatsApp"
    if site["tipo"] == "nenhum":
        return _bloco("site", 0, "O perfil não tem site.", completo)
    if site["tipo"] == "rede":
        return _bloco("site", 1, f"O botão “Site” leva para {site.get('onde') or 'uma rede social'}, não a um site de vocês.",
                      completo)
    estado = site.get("estado")
    if estado is None:
        return _bloco("site", None, "Não conseguimos abrir o site para conferir.")
    if estado in ("fora", "sem_nome"):
        return _bloco("site", 0, "O botão “Site” leva a uma página que não abre." if estado == "fora"
                      else "O botão “Site” leva a uma página sem o nome de vocês.", completo)
    faltas = [t for t, v in (("não está pronto para celular", site.get("celular")),
                             ("não tem botão de WhatsApp", site.get("whatsapp"))) if v is False]
    nc = [t for t, v in (("o celular", site.get("celular")), ("o WhatsApp", site.get("whatsapp"))) if v is None]
    if faltas:
        linha = f"O site de vocês abre, mas {juntar(faltas)}."
    else:
        linha = "O site de vocês abre, está pronto para celular e tem botão de WhatsApp."
        if nc:
            linha = "O site de vocês abre." if len(nc) == 2 else (
                "O site de vocês abre e está pronto para celular." if site.get("celular") else
                "O site de vocês abre e tem botão de WhatsApp.")
    if nc:
        linha += f" Não conferimos {juntar(nc)}."
    cenario = None
    if faltas:
        cenario = "Se o site de vocês " + juntar([{"não está pronto para celular": "abrisse bem no celular",
                                                    "não tem botão de WhatsApp": "tivesse botão de WhatsApp"}[f]
                                                   for f in faltas])
    b = _bloco("site", NOTA_MAXIMA_BLOCO - len(faltas), linha)
    b["cenario"] = cenario
    return b


def nota_de_presenca(buscas: list[dict] | None = None, nota: float | None = None, avaliacoes: int | None = None,
                     respostas: dict | None = None, perfil: dict | None = None, site: dict | None = None) -> dict:
    """Os 6 blocos, a nota de 0 a 18 e a faixa. Bloco sem dado fica "não medido" (nunca zero calado);
    a nota sai proporcional aos blocos medidos (soma × 18 ÷ (3 × medidos), uma casa), e só com
    pelo menos MIN_BLOCOS_MEDIDOS medidos."""
    blocos = [bloco_busca(buscas), bloco_nota(nota, avaliacoes),
              bloco_avaliacoes(avaliacoes, concorrentes_da_busca(buscas)), bloco_respostas(respostas),
              bloco_perfil(perfil), bloco_site(site)]
    medidos = [b for b in blocos if b["medido"]]
    soma = sum(b["nota"] for b in medidos)
    valor = None
    if len(medidos) >= MIN_BLOCOS_MEDIDOS:
        valor = arredondar(soma * NOTA_MAXIMA / (NOTA_MAXIMA_BLOCO * len(medidos)), 1)
    return {"blocos": blocos, "soma": soma, "medidos": len(medidos), "nota": valor,
            "faixa": faixa(valor, "presenca"), "cenarios": cenarios(blocos)}


def cenarios(blocos: list[dict], maximo: int = 3) -> list[str]:
    """Até `maximo` cenários, dos blocos medidos abaixo de 3, o de menor nota primeiro."""
    com = [(b["nota"], i, b["cenario"]) for i, b in enumerate(blocos) if b.get("cenario")]
    return [c for _, _, c in sorted(com)[:maximo]]


# ------------------------------------------------------------------ calculadora (conta aberta)

# Cenário, não promessa: cada cenário vale "1 cliente a mais por mês". Ninguém sabe de fora quantos
# clientes uma distância fechada traz; o número de clientes é o menor possível, e o valor do
# cliente é o que o dono digita. Nenhum "valor típico do ramo".
CLIENTES_A_MAIS_POR_MES = 1


def ler_valor(texto) -> float | None:
    """O que o dono digita no campo: '1.250,50', '1250,5', 'R$ 800', '1250.50'. Até dois decimais;
    zero, negativo ou ilegível = None. O JS da página faz exatamente esta conta."""
    t = re.sub(r"\s", "", str(texto or "").replace("R$", ""))
    if not t:
        return None
    if re.fullmatch(r"\d{1,3}(\.\d{3})+(,\d+)?", t):
        t = t.replace(".", "")
    t = t.replace(",", ".", 1)
    if not re.fullmatch(r"\d+(\.\d{1,2})?", t):
        return None
    v = float(t)
    return v if v > 0 else None


def conta_da_calculadora(valor_cliente) -> dict | None:
    """{'clientes', 'valor', 'mensal', 'anual'}: mensal = clientes × valor, ao real (meio sobe),
    em centavos inteiros (igual no JS); anual = mensal arredondado × 12."""
    v = ler_valor(valor_cliente) if isinstance(valor_cliente, str) else valor_cliente
    if v is None or v <= 0:
        return None
    centavos = int(round(v * 100))
    mensal = (CLIENTES_A_MAIS_POR_MES * centavos + 50) // 100
    return {"clientes": CLIENTES_A_MAIS_POR_MES, "valor": centavos / 100, "mensal": mensal,
            "anual": anualizar(mensal)}


def frase_da_conta(conta: dict | None) -> tuple[str, str]:
    """As duas linhas da conta aberta, em texto (sem valor, com o espaço em branco)."""
    n = CLIENTES_A_MAIS_POR_MES
    quem = f"{n} cliente a mais" if n == 1 else f"{n} clientes a mais"
    if not conta:
        return (f"{quem} por mês × R$ ___ = R$ ___ por mês",
                f"R$ ___ por mês × {MESES_POR_ANO} = R$ ___ por ano")
    return (f"{quem} por mês × {brl(conta['valor'])} = {brl(conta['mensal'])} por mês",
            f"{brl(conta['mensal'])} por mês × {MESES_POR_ANO} = {brl(conta['anual'])} por ano")


# O mesmo cálculo no navegador. As constantes vêm daqui; o teste roda este JS no node e compara
# com ler_valor/conta_da_calculadora/frase_da_conta numa tabela de casos.
JS_CALCULADORA = """(function(){
var N=__N__,M=__M__;
function ler(t){t=String(t||'').replace(/R\\$/g,'').replace(/\\s/g,'');if(!t)return null;
if(/^\\d{1,3}(\\.\\d{3})+(,\\d+)?$/.test(t))t=t.replace(/\\./g,'');t=t.replace(',','.');
if(!/^\\d+(\\.\\d{1,2})?$/.test(t))return null;var v=parseFloat(t);return v>0?v:null}
function mil(n){return String(n).replace(/\\B(?=(\\d{3})+(?!\\d))/g,'.')}
function brl(v){if(Math.abs(v-Math.round(v))<0.005)return 'R$ '+mil(Math.round(v));
var p=v.toFixed(2).split('.');return 'R$ '+mil(parseInt(p[0],10))+','+p[1]}
function conta(v){if(v===null)return null;var cent=Math.round(v*100),m=Math.floor((N*cent+50)/100);
return {valor:cent/100,mensal:m,anual:m*M}}
function frases(k){var q=N+(N===1?' cliente a mais':' clientes a mais');
if(!k)return [q+' por mês × R$ ___ = R$ ___ por mês','R$ ___ por mês × '+M+' = R$ ___ por ano'];
return [q+' por mês × '+brl(k.valor)+' = '+brl(k.mensal)+' por mês',
brl(k.mensal)+' por mês × '+M+' = '+brl(k.anual)+' por ano']}
if(typeof module!=='undefined'&&module.exports){module.exports={ler:ler,conta:conta,frases:frases};return}
var c=document.getElementById('prumo-valor');if(!c)return;
var l1=document.getElementById('prumo-conta-1'),l2=document.getElementById('prumo-conta-2');
function mostrar(){var f=frases(conta(ler(c.value)));l1.textContent=f[0];l2.textContent=f[1]}
c.addEventListener('input',mostrar);mostrar();
})();"""


def js_calculadora() -> str:
    return JS_CALCULADORA.replace("__N__", str(CLIENTES_A_MAIS_POR_MES)).replace("__M__", str(MESES_POR_ANO))


# ------------------------------------------------------------------ o bloco HTML (Raio-X)

# No CSS do raio-x.py (tokens --ferro-*, --brasa, --pedra-*). A nota mora em dois lugares da página
# (três atos, 09/10/2026): na frente, só a faixa, numa régua de três com o fio de prumo da marca
# (bloco_faixa_html); no detalhe "Como fizemos", o "X de 18", a régua de 0 a 18, um ponto por bloco e
# a calculadora (bloco_html). O número não vai para a frente: quem decide lê a faixa, quem confere abre.
CSS_PRESENCA = """
.faixa-presenca{margin-top:12px;display:grid;gap:6px}
.faixa-presenca .faixa-rotulo{font-size:clamp(30px,8vw,40px);line-height:1;font-weight:900;letter-spacing:-.02em;
font-variation-settings:'wdth' 112,'wght' 900}
.faixa-presenca .faixa-texto{font-size:15px;color:var(--ferro-600);max-width:56ch}
/* overflow:hidden: o fio é uma camada da largura da régua, deslocada; sem o corte, empurraria a página para o lado. */
.regua-faixas{position:relative;margin-top:-1px;padding-top:9px;overflow:hidden}
.regua-faixas ol{list-style:none;display:grid;grid-template-columns:repeat(3,1fr);gap:0 3px}
.regua-faixas li{border-top:12px solid var(--pedra-200);padding-top:8px;font-size:11px;line-height:1.2;
letter-spacing:.05em;text-transform:uppercase;font-weight:700;color:var(--pedra-600)}
.regua-faixas li.atual{border-top-color:var(--ferro-900);color:var(--ferro-900);font-weight:900}
.regua-faixas .prumo-fio{position:absolute;left:0;top:0;width:100%;height:30px;pointer-events:none;
transform:translateX(var(--pos))}
.regua-faixas .prumo-fio::before{content:"";position:absolute;left:-2px;top:0;width:4px;height:100%;background:var(--brasa)}
@media (prefers-reduced-motion:no-preference){
.regua-faixas .prumo-fio{animation:prumo-assenta .8s cubic-bezier(.34,1.56,.64,1) .15s both}
@keyframes prumo-assenta{from{transform:translateX(0);opacity:0}30%{opacity:1}to{transform:translateX(var(--pos));opacity:1}}}
.presenca h3{font-size:20px;line-height:1.2;font-weight:800}
.presenca .placar{display:flex;flex-wrap:wrap;align-items:flex-end;gap:12px 16px;margin-top:12px;
border-top:2px solid var(--ferro-900);border-bottom:2px solid var(--ferro-900);padding:18px 0}
.presenca .placar .num{font-size:56px;line-height:.85;font-weight:900;letter-spacing:-.03em;color:var(--oxido);
font-variation-settings:'wdth' 118,'wght' 900;white-space:nowrap}
.presenca .placar .num small{font-size:22px;color:var(--ferro-900);font-variation-settings:'wdth' 108,'wght' 800}
.presenca .placar .lado{flex:1 1 200px;display:grid;gap:6px;min-width:0}
.presenca .placar .faixa{font-size:13px;letter-spacing:.12em;text-transform:uppercase;font-weight:800}
.presenca .placar .escala{display:flex;justify-content:space-between;font-size:12px;color:var(--pedra-600);
font-variant-numeric:tabular-nums}
.presenca .placar p{font-size:15px;color:var(--ferro-600)}
.presenca .trilho{display:flex;height:14px;background:var(--pedra-200);border:2px solid var(--ferro-900)}
.presenca .trilho i{display:block;background:var(--brasa)}
.presenca .blocos{list-style:none;margin-top:20px;display:grid;gap:18px}
.presenca .blocos li{display:grid;gap:6px}
.presenca .blocos .cab{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.presenca .blocos .cab span{font-weight:750;font-variation-settings:'wght' 750}
.presenca .blocos .cab b{font-weight:900;color:var(--oxido);white-space:nowrap}
.presenca .blocos .trilho{height:10px}
.presenca .blocos .nm .cab b{color:var(--pedra-600);font-weight:700}
.presenca .blocos .nm .trilho{border-style:dashed;border-color:var(--pedra-400);background:none}
.presenca .blocos p{font-size:15px;color:var(--ferro-600)}
.presenca .regra{margin-top:16px;font-size:14px;color:var(--pedra-600)}
.calculo{margin-top:28px;border:2px solid var(--ferro-900);border-left:6px solid var(--brasa);padding:20px 18px;
display:grid;gap:12px}
.calculo h4{font-size:19px;line-height:1.2;font-weight:800}
.calculo ul{list-style:none;display:grid;gap:6px}
.calculo li{padding-left:14px;border-left:2px solid var(--pedra-400);color:var(--ferro-600);font-size:16px}
.calculo label{font-weight:750;display:block}
.calculo .campo{display:flex;align-items:center;gap:8px;margin-top:6px}
.calculo input{font:inherit;font-size:20px;font-weight:800;width:11ch;min-height:48px;padding:8px 10px;
border:2px solid var(--ferro-900);background:var(--pedra-100);color:var(--ferro-900)}
.calculo input:focus-visible{outline:3px solid var(--ocre);outline-offset:2px}
.calculo .conta{display:grid;gap:4px;font-variant-numeric:tabular-nums;font-weight:750;font-size:17px}
.calculo .aviso{font-size:14px;color:var(--pedra-600)}
@media (min-width:640px){.presenca .blocos{grid-template-columns:1fr 1fr;gap:20px 28px}}
"""


def _barra(nota, maximo) -> str:
    pct = 0 if nota is None else max(0.0, min(100.0, nota / maximo * 100))
    return f'<span class="trilho" aria-hidden="true"><i style="width:{pct:.1f}%"></i></span>'


def bloco_faixa_html(presenca: dict) -> str:
    """A frente da página: a faixa ("Pouco visível", "Em construção", "Bem visível") e a frase dela,
    numa régua de três em que o fio de prumo assenta uma vez (só CSS; parado com reduced-motion).
    Sem o número de 0 a 18, que fica no detalhe (bloco_html). '' quando não há nota."""
    if presenca.get("nota") is None:
        return ""
    e = lambda t: html.escape(str(t), quote=True)  # noqa: E731
    f = presenca["faixa"]
    i = [x["chave"] for x in FAIXAS].index(f["chave"])
    itens = []
    for k, x in enumerate(FAIXAS):
        rotulo = x["presenca"][0]
        itens.append(f'<li class="atual">{e(rotulo)}<span class="visualmente-oculto"> (vocês estão aqui)</span></li>'
                     if k == i else f"<li>{e(rotulo)}</li>")
    pos = (2 * i + 1) * 100 / (2 * len(FAIXAS))  # o meio da faixa, em % da régua
    return (f'<div class="faixa-presenca faixa-{e(f["chave"])}"><span class="miudo">Presença no Google</span>'
            f'<p class="faixa-rotulo">{e(f["rotulo"])}</p>'
            f'<div class="regua-faixas"><ol aria-label="Faixas da presença no Google">{"".join(itens)}</ol>'
            f'<span class="prumo-fio" style="--pos:{pos:.3f}%" aria-hidden="true"></span></div>'
            f'<p class="faixa-texto">{e(f["texto"])}</p></div>')


def bloco_html(presenca: dict, nome: str = "") -> str:
    """O detalhe da Nota de presença (em "Como fizemos"): o "X de 18" com a régua de 0 a 18, um ponto
    por bloco e a calculadora. '' quando não há nota (menos de MIN_BLOCOS_MEDIDOS blocos medidos):
    sem nota, a página não mostra o bloco."""
    if presenca.get("nota") is None:
        return ""
    e = lambda t: html.escape(str(t), quote=True)  # noqa: E731
    nota, f = presenca["nota"], presenca["faixa"]
    medidos = presenca["medidos"]
    partes = ['<div class="presenca"><h3>Nota de presença</h3>',
              '<p class="intro">Seis pontos que quem procura no Google confere antes de chamar, cada um de 0 a 3, '
              'pelo cálculo PRUMO.</p>',
              f'<div class="placar"><span class="num">{e(decimal_br(nota))} <small>de {NOTA_MAXIMA}</small></span>'
              f'<div class="lado"><span class="faixa">{e(f["rotulo"])}</span>{_barra(nota, NOTA_MAXIMA)}'
              f'<span class="escala" aria-hidden="true"><span>0</span><span>{NOTA_MAXIMA}</span></span>'
              f'<p>{e(f["texto"])}</p></div></div>',
              '<ul class="blocos">']
    for b in presenca["blocos"]:
        if b["medido"]:
            partes.append(f'<li><div class="cab"><span>{e(b["nome"])}</span><b>{b["nota"]} de 3</b></div>'
                          f'{_barra(b["nota"], NOTA_MAXIMA_BLOCO)}<p>{e(b["linha"])}</p></li>')
        else:
            partes.append(f'<li class="nm"><div class="cab"><span>{e(b["nome"])}</span><b>não medimos</b></div>'
                          f'{_barra(None, NOTA_MAXIMA_BLOCO)}<p>{e(b["linha"])}</p></li>')
    partes.append("</ul>")
    if medidos < BLOCOS_POR_NOTA:
        fora = juntar([f"“{b['nome']}”" for b in presenca["blocos"] if not b["medido"]])
        partes.append(f'<p class="regra">Medimos {medidos} dos {BLOCOS_POR_NOTA} pontos. O que não medimos ({e(fora)}) '
                      f'fica fora da conta, e a nota é proporcional aos que medimos: {presenca["soma"]} de '
                      f'{NOTA_MAXIMA_BLOCO * medidos} pontos, que valem {e(decimal_br(nota))} numa escala de 18.</p>')
    if presenca["cenarios"]:
        l1, l2 = frase_da_conta(None)
        n = CLIENTES_A_MAIS_POR_MES
        partes += ['<div class="calculo"><h4>Quanto vale fechar essas distâncias</h4>',
                   f'<p>Se uma destas mudanças trouxesse {"1 cliente" if n == 1 else f"{n} clientes"} a mais por mês:</p><ul>',
                   "".join(f"<li>{e(c)}</li>" for c in presenca["cenarios"]), "</ul>",
                   '<div><label for="prumo-valor">Quanto vale, em média, um cliente fechado para vocês?</label>'
                   '<div class="campo"><span aria-hidden="true">R$</span>'
                   '<input id="prumo-valor" name="valor" type="text" inputmode="decimal" autocomplete="off" '
                   'placeholder="___" aria-describedby="prumo-conta-aviso"></div></div>',
                   f'<p class="conta" aria-live="polite"><span id="prumo-conta-1">{e(l1)}</span>'
                   f'<span id="prumo-conta-2">{e(l2)}</span></p>',
                   '<p class="aviso" id="prumo-conta-aviso">É um cenário, não uma promessa. A conta é feita neste '
                   'aparelho, com o valor que vocês digitam, e ele não é enviado a ninguém. Os cenários não se somam: '
                   'é um cliente a mais, venha de onde vier. E é faturamento, não lucro.</p>',
                   f"<script>{js_calculadora()}</script></div>"]
    partes.append("</div>")
    return "".join(partes)
