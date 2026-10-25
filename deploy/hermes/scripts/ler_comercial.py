"""Consulta comercial somente leitura. Transporte fixo local, sem cache ou fallback."""
import argparse
from datetime import datetime
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request

URL = "http://127.0.0.1:9120/api/operations/crm/leitura-comercial"
MAX_BYTES = 262144
LACUNAS = {"necessidade", "adequação da oferta", "intenção de avaliar ou contratar", "participantes e processo de decisão", "próximo passo aceito", "fonte, evidência e confirmação humana", "dor", "impacto", "decisor confirmado"}
BLOQUEIOS = {"encerramento", "recusa-ou-exclusao", "pausa", "espera", "revisao-pendente", "qualificacao-invalida", "qualificacao-negativa", "ciclo-comercial", "responsabilidade-humana", "responsabilidade-indefinida", "identidade-ou-registro-pendente", "atendimento-interno", "conteudo-ou-autoria-pendente", "decisao-comercial-humana"}
OFERTAS = {"", "raio-x", "mapa", "encontrado", "respondido", "anuncios", "anuncios-duas", "redes", "fonte", "fonte-em-dia", "iris", "estampa", "pacote"}

ACOES_TRABALHO = set(["Aguardar a resposta ou a condição combinada", "Aguardar retorno após a última resposta enviada", "Conferir a restrição comercial registrada", "Conferir condições já discutidas e preparar decisão, sem novo envio", "Conferir necessidade e a próxima lacuna comercial", "Conferir o canal e a autoria da resposta", "Conferir o ciclo comercial e decidir o próximo marco com Rômulo", "Conferir o pedido comercial atual com Rômulo", "Conferir o pedido recebido antes de escolher a próxima ação", "Conferir se há uma conversa comercial e evidência disponível", "Conferir uma lacuna da qualificação por vez", "Preparar a decisão comercial com Rômulo", "Preservar o desfecho e a restrição de contato", "Resolver contexto antes de preparar qualquer contato"])
RESULTADOS_TRABALHO = set(["Condições e contexto conferidos por Rômulo; nenhuma retomada presumida.", "Escopo, condições e versão da proposta conferidos antes de apresentação.", "Espera preservada; revisão interna não autoriza retomada.", "Histórico e restrição preservados; nenhuma nova abordagem.", "Identidade, fonte e pendência conferidas na ficha.", "Indício comercial separado de qualificação e condição humana confirmadas.", "Nenhuma oportunidade pronta presumida pela ausência de dados.", "Não repetir apresentação, proposta ou pergunta já respondida.", "Permissão, encaminhamento e curiosidade separados de intenção de contratar.", "Preço, proposta ou contratação revisados pelo humano; nenhuma resposta ou contratação automática.", "Próxima pergunta ou conferência interna escolhida sem repetir o que já foi confirmado.", "Resposta automática não tratada como intenção de compra.", "Revisão humana negativa preservada, sem rascunho de contato.", "Uma lacuna pertinente identificada, sem reunião ou proposta presumida.", "Versão, evidência e condição de proposta, contratação ou recebimento conferidas; sem confirmação automática."])

class SemRedirecionamento(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None

def indisponivel():
    return {"v": 1, "somenteLeitura": True, "contatoAutorizado": False, "resultado": "indisponivel", "orientacao": "Não verificado. Confira a leitura atual na Central; não retome contato nem use o retrato legado como substituto."}

def opcao(valor, permitidos):
    if valor not in permitidos:
        raise ValueError("Estado desconhecido")
    return valor

def booleano(valor):
    if type(valor) is not bool:
        raise ValueError("Estado desconhecido")
    return valor

def lista_opcoes(valor, permitidos):
    if not isinstance(valor, list) or len(valor) > 30:
        raise ValueError("Estado desconhecido")
    return [opcao(v, permitidos) for v in valor]

def rotulo(valor):
    if not isinstance(valor, str) or len(valor) > 160:
        raise ValueError("Rótulo inválido")
    valor = re.sub(r"https?://\S+|[\w.+-]+@[\w.-]+", "[dado omitido]", valor, flags=re.I)
    valor = re.sub(r"(?:\+?\d[ ()./-]*){8,}", "[dado omitido]", valor)
    return re.sub(r"[\x00-\x1f\x7f]", " ", valor)

def ficha_fonte(valor):
    if valor is None:
        return None
    if not isinstance(valor, str) or len(valor) > 2048:
        raise ValueError("Ficha inválida")
    u = urllib.parse.urlsplit(valor)
    q = urllib.parse.parse_qs(u.query, strict_parsing=True)
    if u.scheme != "https" or u.port != 8443 or not u.hostname or u.username or u.password or u.fragment or u.path != "/crm" or set(q) != {"lead"} or len(q["lead"]) != 1:
        raise ValueError("Ficha inválida")
    return valor

def prioridade_trabalho(item, consultado_em):
    p = item["prioridadeTrabalho"]
    if p.get("contatoAutorizado") is not False:
        raise ValueError("Prioridade não autoriza contato")
    evidencia = p["evidencia"]
    em = p["em"]
    if em is not None:
        if not isinstance(em, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", em):
            raise ValueError("Data de origem inválida")
        datetime.strptime(em, "%Y-%m-%dT%H:%M:%S.%fZ")
    destaque, urgente = booleano(p["destaque"]), booleano(p["urgente"])
    grupo = opcao(p["grupo"], {"decidir", "qualificar", "conferir", "aguardar", "encerrado"})
    if type(p["nivel"]) is not int or not 1 <= p["nivel"] <= 5 or type(p["ordem"]) is not int or p["ordem"] not in {10, 11, 20, 21, 25, 30, 31, 45, 60, 65, 70, 75, 80, 81, 90}:
        raise ValueError("Ordem de trabalho inválida")
    if destaque and em is None or grupo in {"aguardar", "encerrado"} and (destaque or urgente) or urgente and (not destaque or grupo != "decidir" or p["ordem"] != 10 or evidencia.get("fonte") != "atendimento" or evidencia.get("estado") != "atual"):
        raise ValueError("Prioridade inconsistente")
    if urgente:
        if not isinstance(consultado_em, str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", consultado_em):
            raise ValueError("Frescor da urgência indisponível")
        idade = (datetime.strptime(consultado_em, "%Y-%m-%dT%H:%M:%S.%fZ") - datetime.strptime(em, "%Y-%m-%dT%H:%M:%S.%fZ")).total_seconds()
        if not 0 <= idade <= 900:
            raise ValueError("Urgência exige evento original recente")
    return {"grupo": grupo, "nivel": p["nivel"], "ordem": p["ordem"], "acao": opcao(p["acao"], ACOES_TRABALHO), "resultado": opcao(p["resultado"], RESULTADOS_TRABALHO), "evidencia": {"fonte": opcao(evidencia["fonte"], {"qualificacao-humana", "ciclo-humano", "classificacao-atual", "sinal-recebido", "atendimento", "restricao", "sem-evidencia"}), "tipo": opcao(evidencia["tipo"], {"necessidade", "adequacao", "intencao", "decisao", "proximoPasso", "evidencia", "proposta", "proposta_enviada", "aceite", "entrega_vista", "condicao_cobranca", "cobranca", "pagamento", "correcao", "preco", "contratar", "material", "interesse", "recusa", "exclusao", "espera", "sem-interesse", "inadequada", "sem-prova", "conflito", "indisponivel", "contexto-pendente", "qualificacao-invalida", "robo", "revisao-pendente", "revisao", "saida-posterior", "qualificacao-suficiente", "sem-contexto", "conversa", "permissao", "acesso", "curiosidade", "silencio", "neutra", "pendente", "nao-contatado"}), "estado": opcao(evidencia["estado"], {"atual", "historica", "pendente"})}, "em": em, "destaque": destaque, "urgente": urgente, "contatoAutorizado": False}

def resposta_segura(dados):
    # Projeção explícita: campos extras jamais atravessam para o Hermes.
    if not isinstance(dados, dict) or dados.get("v") != 1 or dados.get("somenteLeitura") is not True or dados.get("contatoAutorizado") is not False:
        raise ValueError("Contrato inválido")
    resultado = opcao(dados.get("resultado"), {"lista", "individual", "ambiguo", "nao-encontrado"})
    fonte = dados["fonte"]
    if fonte.get("atual") is not True or not isinstance(fonte.get("geradoEm"), str) or not re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", fonte["geradoEm"]):
        raise ValueError("Fonte sem frescor")
    if type(fonte.get("idadeMs")) is not int or not 0 <= fonte["idadeMs"] <= 900000 or fonte.get("limiteMs") != 900000:
        raise ValueError("Fonte sem frescor")
    itens = dados["oportunidades"]
    if not isinstance(itens, list) or len(itens) > 20:
        raise ValueError("Lista inválida")
    if resultado == "individual" and len(itens) != 1 or resultado == "nao-encontrado" and itens or resultado == "ambiguo" and len(itens) < 2:
        raise ValueError("Seleção inconsistente")
    saida = []
    for item in itens:
        if item.get("somenteLeitura") is not True or item.get("contatoAutorizado") is not False or not re.fullmatch(r"[a-f0-9]{64}", item.get("referencia", "")):
            raise ValueError("Oportunidade inválida")
        q, c, dono, att = (item[k] for k in ("qualificacao", "ciclo", "responsavel", "atendimento"))
        qualificacao = {"estado": opcao(q["estado"], {"ausente", "invalida", "parcial", "suficiente", "sem-interesse", "inadequada"}), "confirmacaoHumana": booleano(q["confirmacaoHumana"]), "lacunas": lista_opcoes(q["lacunas"], LACUNAS), "camposConfirmados": {k: booleano(q["camposConfirmados"][k]) for k in ("necessidade", "adequacao", "intencao", "decisao", "proximoPasso")}}
        if "ofertaId" in q:
            qualificacao["ofertaId"] = opcao(q["ofertaId"], OFERTAS)
        if "intencao" in q:
            qualificacao["intencao"] = opcao(q["intencao"], {"desconhecida", "permissao", "avaliar", "contratar", "sem-interesse"})
        linha = {"referencia": item["referencia"], "empresa": rotulo(item["empresa"]), "produto": opcao(item["produto"], {"site", "prumo", "iris", "estampa", "plus"}), "etapa": opcao(item["etapa"], {"novo", "contato", "proposta", "ganho", "perdido"}), "autoridade": opcao(item["autoridade"], {"qualificacao-nova", "spiced-legado", "sem-revisao"}), "qualificacao": qualificacao, "ciclo": {"estado": opcao(c["estado"], {"ausente", "revisar", "cobranca-pendente", "recebimento", "condicao", "aceite", "proposta-enviada", "rascunho"}), "marcosConfirmados": lista_opcoes(c["marcosConfirmados"], {"proposta", "proposta_enviada", "aceite", "entrega_vista", "condicao_cobranca", "cobranca", "pagamento", "correcao"}), "exigeHumano": booleano(c["exigeHumano"])}, "responsavel": {"estado": opcao(dono["estado"], {"definido", "ausente", "bloqueado"}), "quem": opcao(dono["quem"], {None, "time", "romulo"})}, "atendimento": {"presente": booleano(att["presente"]), "tipo": opcao(att["tipo"], {None, "rascunho", "handoff", "aguardando-fonte", "automatico"}), "alvo": opcao(att["alvo"], {None, "operador", "cliente", "time"})}, "bloqueios": lista_opcoes(item["bloqueios"], BLOQUEIOS), "proximaAcao": opcao(item["proximaAcao"], {"preservar-desfecho", "aguardar", "conferir-com-romulo", "conferir-qualificacao-na-ficha"}), "contatoAutorizado": False}
        linha["prioridadeTrabalho"] = prioridade_trabalho(item, dados.get("consultadoEm"))
        if resultado == "individual":
            linha["ficha"] = ficha_fonte(item.get("ficha"))
        saida.append(linha)
    return {"v": 1, "somenteLeitura": True, "contatoAutorizado": False, "resultado": resultado, "fonte": {k: fonte[k] for k in ("geradoEm", "idadeMs", "limiteMs", "atual")}, "total": len(saida) if dados.get("truncado") is not True else "mais-de-20", "truncado": booleano(dados["truncado"]), "oportunidades": saida}

def consultar(nome=None, referencia=None, abrir=None):
    try:
        if nome is not None and (referencia is not None or not isinstance(nome, str) or not 2 <= len(nome.strip()) <= 100 or re.search(r"[\x00-\x1f\x7f]", nome)):
            raise ValueError("Seleção inválida")
        if referencia is not None and (not isinstance(referencia, str) or not re.fullmatch(r"[a-f0-9]{64}", referencia)):
            raise ValueError("Seleção inválida")
        parametros = {"nome": nome.strip()} if nome is not None else {"referencia": referencia} if referencia is not None else {}
        req = urllib.request.Request(URL + ("?" + urllib.parse.urlencode(parametros) if parametros else ""), method="GET", headers={"Accept": "application/json"})
        opener = abrir or urllib.request.build_opener(urllib.request.ProxyHandler({}), SemRedirecionamento()).open
        with opener(req, timeout=5) as r:
            if r.status != 200 or r.geturl() != req.full_url:
                raise ValueError("Resposta inválida")
            bruto = r.read(MAX_BYTES + 1)
            if len(bruto) > MAX_BYTES:
                raise ValueError("Resposta excede limite")
        return resposta_segura(json.loads(bruto))
    except urllib.error.HTTPError as erro:
        erro.close()
        return indisponivel()
    except (OSError, ValueError, TypeError, KeyError, AttributeError):
        return indisponivel()

class ArgumentosSeguros(argparse.ArgumentParser):
    def error(self, message):
        self.exit(2, "Seleção inválida. Use somente --nome ou --referencia.\n")

def main(argv=None):
    parser = ArgumentosSeguros(description="Estados comerciais atuais da Central; somente leitura, sem contato.")
    grupo = parser.add_mutually_exclusive_group()
    grupo.add_argument("--nome", help="Buscar empresa; resultados ambíguos exigem seleção explícita")
    grupo.add_argument("--referencia", help="Referência opaca retornada por uma consulta anterior")
    args = parser.parse_args(argv)
    saida = consultar(args.nome, args.referencia)
    print(json.dumps(saida, ensure_ascii=False))
    return 1 if saida["resultado"] == "indisponivel" else 0

if __name__ == "__main__":
    sys.exit(main())
