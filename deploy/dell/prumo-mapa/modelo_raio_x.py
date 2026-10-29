"""O Raio-X no modelo aprovado (piloto CDL, 13 e 14/10/2026): o molde da página e a trava de qualidade.

Fonte da verdade do desenho: o `gerar.py` do piloto (prumo, `04-venda/piloto-cdl/`), que gera o exemplo da
Odonto Maré e o Raio-X dos leads feitos à mão, e está no ar em prumo-piloto-cdl.vercel.app/raio-x. Este
módulo é o mesmo código, para o Raio-X automático do Dell (`raio-x.py`, versão 5) sair igual: os dois
recebem um JSON no esquema de `modelos/raio-x.json` do piloto e dão a mesma página. Com um JSON feito à mão,
a página sai byte a byte igual à do `gerar.py`; as chaves de GANCHOS (todas opcionais) são o que o
automático precisa a mais, porque só lê o Google: o lede e o método dizem isso, o checklist do perfil
marca "não conferido" e as avaliações são as que o Google mostra primeiro.

A trava também é a do piloto: `conferir_raio_x`, `conferir_pagina` e `conferir_esqueleto` (os mesmos blocos, na
mesma ordem, da página do exemplo; o Dell guarda o JSON do exemplo em `exemplo-raio-x.json`).

Este arquivo sai do `gerar.py` (copiado, com os ganchos): mudou o Raio-X lá, refaça este e rode o
`conferir_squadone.py` do piloto, que exige os mesmos bytes nas duas vias. Refazer este arquivo:
`python modelo_para_squadone.py gerar.py <este arquivo>`, no piloto.

`rx` é o módulo do `raio-x.py` (CSS, JS_PAGINA, detalhe, secao_avaliacoes, temas_das_avaliacoes, numero,
fonte_css, FONTE, FONTE_RANKING); `cp` é o `calculo_prumo`; `precos` é o `precos.json` do piloto.
"""
from __future__ import annotations

import html
import re
import urllib.parse

"""Índice Prumo: assinatura aprovada para Raio-X e Mapa."""
import html
import re
e = lambda t: html.escape(str(t), quote=True)

def ip_numero(n):
    return f'{n:.1f}'.replace('.', ',')


def ip_dimensao(n):
    return (f'{n:.2f}'.rstrip('0').rstrip('.').replace('.', ',') if n is not None else '—')


def assinatura_indice(tipo, nota, faixa, dimensoes, leitura, explicacao):
    rotulos = (['Pouco visível', 'Em construção', 'Bem visível'] if tipo == 'Presença'
               else ['Quase tudo passa por você', 'Parte já anda sozinha', 'Anda sem você'])
    indice = 0 if nota < 7 else 1 if nota < 13 else 2
    labels = ''.join(f'<li class="{"ip-atual" if i == indice else ""}">{e(x)}'
                     + ('<span class="visualmente-oculto"> · faixa atual</span>' if i == indice else '') + '</li>'
                     for i, x in enumerate(rotulos))
    linhas = ''.join(f'<li><span>{e(nome)}</span><b>{e(ip_dimensao(n))}<small> / 3</small></b></li>' for nome,n in dimensoes)
    return (
        f'<div class="ip-instrumento" aria-labelledby="ip-titulo" data-indice="{nota}" data-maximo="18">'
        f'<div class="ip-cabecalho"><h2 id="ip-titulo">Índice Prumo <span>de {e(tipo)}</span></h2>'
        '<span class="ip-edicao">Leitura inicial</span></div>'
        f'<div class="ip-leitura"><div class="ip-valor" aria-label="{e(ip_numero(nota))} de 18 pontos">'
        f'<strong>{e(ip_numero(nota))}</strong><span>de 18</span></div>'
        f'<div class="ip-interpretacao"><p class="ip-faixa">{e(faixa)}</p><p>{e(explicacao)}</p></div></div>'
        f'<div class="ip-escala" role="img" aria-label="Régua do Índice Prumo: {e(ip_numero(nota))} de 18, {e(faixa)}">'
        '<div class="ip-extremos"><span>0</span><span>18</span></div>'
        '<div class="ip-trilho"><span></span><span></span><span></span>'
        f'<i class="ip-fio" style="--indice-pos:{nota / 18 * 100:.6f}%" aria-hidden="true"></i></div>'
        f'<ol class="ip-faixas">{labels}</ol></div>'
        '<details class="ip-metodo" id="ip-metodo"><summary>Por que 18? Conheça as 6 dimensões</summary>'
        '<div><p>O método do Prumo reúne seis dimensões, com até três pontos em cada uma. A escala completa vai até 18. '
        'A mesma régua é usada em todas as empresas; o diagnóstico explica o que precisa mudar em cada caso. Quando uma dimensão não foi conferida, ela fica fora da conta. A leitura identifica o que foi medido.</p>'
        f'<ul class="ip-dimensoes">{linhas}</ul>'
        '<p>A pontuação resume esta leitura. Para acompanhar a evolução, repetimos os critérios e registramos o que mudou; '
        'uma nota maior, sozinha, não comprova aumento de vendas ou economia.</p></div></details>'
        f'<p class="ip-origem">{e(leitura)}</p></div>'
    )


def aplicar_indice(doc, instrumento):
    # O índice vem antes do diagnóstico; a frase editorial passa a explicá-lo.
    ponto = '</h1>'
    if doc.count(ponto) != 1 or doc.count('class="v2-tese"') != 1:
        raise ValueError('A abertura de avaliação precisa ter um nome e uma tese')
    doc = doc.replace(ponto, ponto + instrumento, 1)
    doc = re.sub(r'<body([^>]*)>', lambda m: '<body' + (re.sub(r'class="([^"]*)"', lambda c: 'class="'+c[1]+' prumo-assinatura"', m[1]) if 'class=' in m[1] else m[1]+' class="prumo-assinatura"') + '>', doc, count=1)
    return doc



def acrescentar_presenca(doc, dados, presenca):
    if presenca.get('nota') is None:
        return doc
    nomes=['Posição nas buscas','Nota dos clientes','Volume de avaliações','Respostas às avaliações','Perfil no Google','Site e contato']
    dimensoes=list(zip(nomes,[x['nota'] for x in presenca['blocos']]))
    cfg=dados.get('indice') or {}
    instrumento=assinatura_indice('Presença',presenca['nota'],presenca['faixa']['rotulo'],dimensoes,
        cfg.get('leitura') or f"{dados['nome']} · dados públicos lidos em {dados['lido_em']} · {presenca['medidos']} dimensões avaliadas.",
        cfg.get('explicacao') or presenca['faixa']['texto'])
    doc=aplicar_indice(doc,instrumento)
    doc=re.sub(r'Nota [0-9,]+/18 · [^<]+?\. ', '',doc,count=1)
    return doc

CSS_INDICE = "/* Ensaio isolado: Índice Prumo como instrumento. Nenhuma regra altera o padrão. */\n.prumo-assinatura .v2-abertura h1{margin-bottom:1.25rem}\n.prumo-assinatura .v2-abertura .v2-tese{font-size:clamp(1.65rem,3.7vw,2.5rem);line-height:1.12;max-width:28ch;letter-spacing:-.035em;margin:2rem 0 1rem}\n.ip-instrumento{border-top:4px solid #e0490f;border-bottom:1px solid #9a9089;padding:1.2rem 0 1rem;color:#1b1512}\n.ip-cabecalho{display:flex;align-items:baseline;justify-content:space-between;gap:1rem}\n.ip-cabecalho h2{font-size:1.05rem;font-weight:800;line-height:1.3;margin:0;letter-spacing:-.015em;text-transform:uppercase}\n.ip-cabecalho h2 span{font-weight:500;text-transform:none;white-space:nowrap}\n.ip-edicao{font-size:.73rem;text-transform:uppercase;letter-spacing:.06em;color:#5e564f;white-space:nowrap}\n.ip-leitura{display:grid;grid-template-columns:max-content minmax(0,1fr);gap:2rem;align-items:center;margin:1.35rem 0 1.1rem}\n.ip-valor{display:flex;align-items:baseline;gap:.6rem;font-variant-numeric:tabular-nums}\n.ip-valor strong{font-size:6.2rem;font-weight:850;line-height:.95;letter-spacing:-.065em}\n.ip-valor>span{font-size:1rem;white-space:nowrap;color:#5e564f}\n.ip-interpretacao .ip-faixa{font-size:1.55rem;font-weight:750;letter-spacing:-.025em;line-height:1.15;margin:0 0 .6rem;max-width:20ch}\n.ip-interpretacao p:not(.ip-faixa){font-size:.91rem;line-height:1.5;max-width:40ch;margin:0;color:#4a3e36}\n.ip-extremos{display:flex;justify-content:space-between;font-size:.7rem;color:#5e564f;margin-bottom:.5rem}\n.ip-trilho{position:relative;display:grid;grid-template-columns:7fr 6fr 5fr;height:10px;gap:3px}\n.ip-trilho>span:nth-child(1){background:#cfc7bd}.ip-trilho>span:nth-child(2){background:#9a9089}.ip-trilho>span:nth-child(3){background:#4a3e36}\n.ip-fio{position:absolute;left:var(--indice-pos);top:-11px;width:2px;height:32px;background:#e0490f;transform:translateX(-50%)}\n.ip-fio:after{content:'';position:absolute;left:-5px;bottom:-3px;width:12px;height:13px;background:#e0490f;clip-path:polygon(50% 100%,0 35%,15% 0,85% 0,100% 35%)}\n.ip-faixas{list-style:none;padding:0;margin:.85rem 0 0;display:grid;grid-template-columns:7fr 6fr 5fr;gap:.6rem}\n.ip-faixas li{font-size:.72rem;line-height:1.35;color:#5e564f;max-width:18ch}\n.ip-faixas .ip-atual{font-weight:800;color:#1b1512}\n.ip-metodo{border-top:1px solid rgba(20,15,12,.16);margin-top:1.1rem;padding-top:.85rem}\n.ip-metodo summary{font-size:.8rem;font-weight:650;cursor:pointer;line-height:1.4;list-style-position:inside}\n.ip-metodo summary:focus-visible{outline:2px solid #8a2b0c;outline-offset:4px}\n.ip-metodo>div>p{font-size:.84rem;line-height:1.6;max-width:65ch}\n.ip-dimensoes{list-style:none;padding:0;margin:1rem 0;display:grid;grid-template-columns:1fr 1fr;column-gap:1.4rem}\n.ip-dimensoes li{display:flex;justify-content:space-between;align-items:center;gap:.8rem;font-size:.82rem;line-height:1.4;border-bottom:1px solid rgba(20,15,12,.16);padding:.65rem 0}\n.ip-dimensoes b{white-space:nowrap;font-variant-numeric:tabular-nums}\n.ip-dimensoes small{font-weight:400;color:#5e564f}\n.ip-origem{font-size:.7rem;line-height:1.5;color:#5e564f;margin:.9rem 0 0;max-width:75ch}\n@media(max-width:560px){.ip-cabecalho{align-items:flex-start;gap:.5rem}.ip-cabecalho h2{font-size:.95rem;max-width:19ch}.ip-cabecalho h2 span{display:block}.ip-edicao{font-size:.62rem}.ip-leitura{grid-template-columns:1fr;gap:.9rem;margin:1.1rem 0 1rem}.ip-valor strong{font-size:5rem}.ip-interpretacao .ip-faixa{font-size:1.25rem;max-width:none;margin-bottom:.4rem}.ip-interpretacao p:not(.ip-faixa){font-size:.85rem;max-width:none}.ip-faixas li{font-size:.66rem}.ip-dimensoes{grid-template-columns:1fr}.ip-origem{font-size:.67rem}.prumo-assinatura .v2-abertura .v2-tese{margin-top:1.6rem}}\n"

CSS_MAPA_EDITORIAL = '/* Mapa: contas com naturezas diferentes permanecem em colunas distintas. */\n.m2-duas-contas{display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin:1.6rem 0}\n.m2-duas-contas article{padding:1.3rem;border-top:3px solid #e0490f;background:rgba(20,15,12,.035)}\n.m2-duas-contas h3{font-size:2rem;line-height:1.15;margin:.8rem 0;letter-spacing:-.035em}\n.m2-duas-contas h3 small{display:block;font-size:.85rem;font-weight:500;letter-spacing:0;margin-top:.5rem}\n.m2-duas-contas p{font-size:.95rem;line-height:1.6;margin:0}\n.m2-contas .detalhe{margin-top:1rem}\n@media(max-width:560px){.m2-duas-contas{grid-template-columns:1fr;gap:1rem}.m2-duas-contas h3{font-size:1.8rem}}\n'
"""Apresentação editorial do Raio-X, aprovada pelo Rômulo em 17/10/2026.

A nota continua no método PRUMO. A síntese e a ação são próprias de cada empresa.
O fallback permite que o Dell use a mesma estrutura com dados parciais.
"""
import html
import re

e = lambda t: html.escape(str(t), quote=True)
numero = lambda n: str(n).replace('.', ',').removesuffix(',0')

def substituir(doc, padrao, texto):
    novo, n = re.subn(padrao, lambda _: texto, doc, flags=re.S)
    if n != 1:
        raise ValueError(f"Esperava exatamente um bloco para {padrao!r}; encontrei {n}")
    return novo


def aplicar(doc, dados, presenca):
    editorial = dados.get("editorial") or editorial_basico(dados)
    a = editorial["abertura"]
    leitura_nota = (f'Nota {e(numero(presenca["nota"]))}/18 · {e(presenca["faixa"]["rotulo"])}. '
                    if presenca.get("nota") is not None else 'Nota ainda não calculada: faltam dados confirmados. ')
    evidencias = "".join(
        f'<li><strong>{e(x["numero"])}</strong><span>{e(x["rotulo"])}</span><small>{e(x["detalhe"])}</small></li>'
        for x in a["evidencias"])
    abertura = (
        '<section class="ato veredito v2-abertura" id="veredito" aria-labelledby="t-veredito">'
        f'<p class="kicker">Raio-X · {e(dados["cidade"])}</p><h1 id="t-veredito">{e(dados["nome"])}</h1>'
        f'<h2 class="v2-tese">{e(a["titulo"])}</h2><p class="lede">{e(a["leitura"])}</p>'
        f'<ul class="v2-evidencias" aria-label="O que encontramos">{evidencias}</ul>'
        '<div class="v2-prioridade"><span class="miudo">Nossa primeira recomendação</span>'
        f'<p>{e(a["prioridade"])}</p><a class="link-escuro" href="#primeira-acao">Ver o que precisa ficar pronto ↓</a></div>'
        '<div class="v2-medicao"><p><strong>Uma referência de presença, não uma previsão de vendas.</strong> '
        f'{leitura_nota}'
        f'Leitura de {e(dados["lido_em"])}. '
        '<a class="link-escuro" href="#a-nota" onclick="document.getElementById(\'a-nota\').open=true">Como conferimos</a></p>'
        f'<p><b>Conferido:</b> {e(a["confirmado"])}</p><p><b>Limites:</b> {e(a["limites"])}</p>'
        # Regra de conselho de classe (advocacia: Provimento 205/2021 da OAB) dita na primeira tela, não escondida:
        # quem recebe precisa ver que a página não promete resultado nem fala de preço. Só com o dado.
        + (f'<p>{e(dados["conformidade"])}</p>' if dados.get("conformidade") else '')
        + '</div></section>'
    )
    doc = substituir(doc, r'<section class="ato veredito".*?</section>', abertura)
    pontos = "".join(
        f'<li><span class="marcador">{i:02d}</span><div><h3>{e(x["titulo"])}</h3><p>{e(x["porque"])}</p></div></li>'
        for i, x in enumerate(editorial["pontos"], 1))
    doc = substituir(doc, r'<div class="pontos">.*?</ul></div>',
        '<div class="pontos"><h2>O que pode dificultar a contratação</h2><ul class="lista">' + pontos + '</ul></div>')
    comp = re.search(r'<div class="comparacao">.*?</div>', doc, re.S).group()
    doc = doc.replace(comp, '<details class="detalhe v2-comparacao"><summary>Comparar com os 3 primeiros da busca</summary>'
        '<div class="corpo">' + comp + '</div></details>', 1)
    # A metodologia permanece acessível; a régua passa a apoiar a análise, sem dominar a abertura.
    doc = doc.replace('<summary>A nota e de onde vem cada dado</summary>', '<summary>Como conferimos · nota, fontes e limites</summary>')
    doc = doc.replace('A ordem muda um pouco de pessoa para pessoa, porque o Google leva em conta onde cada um está.',
        'Posições observadas nesta consulta do Maps. A ordem pode mudar por localização e personalização.')
    doc = doc.replace('>sem site</span>', '>sem link de site no perfil</span>')
    # Não extrapolar de uma busca sem link para afirmar inexistência de site do concorrente.
    fontes = '<h3 class="sub">Confira nas fontes públicas</h3><ul class="metodo">' + ''.join(
        f'<li><a class="link-escuro" href="{e(x["url"])}" target="_blank" rel="noopener">{e(x["nome"])}</a></li>'
        for x in editorial["fontes"]) + '</ul>'
    doc = substituir(doc, r'(<details class="detalhe" id="a-nota">.*?)(</div></details>)',
        re.search(r'<details class="detalhe" id="a-nota">.*?(?=</div></details>)', doc, re.S).group() + fontes + '</div></details>')
    acao = editorial["acao"]
    sequencia = ''.join(f'<li><h3>{e(x["titulo"])}</h3><p>{e(x["texto"])}</p></li>' for x in acao["sequencia"])
    m = editorial["mapa"]
    fechamento = (
        '<section class="ato o-que-fazer fazer v2-fazer" id="o-que-fazer" aria-labelledby="t-o-que-fazer">'
        '<p class="kicker" id="t-o-que-fazer">O que fazer primeiro</p>'
        f'<article class="v2-acao" id="primeira-acao"><span class="miudo">Prioridade 01</span>'
        f'<h2>{e(acao["titulo"])}</h2><p class="intro">{e(acao["motivo"])}</p>'
        '<h3>O que precisa ficar pronto</h3><ul class="v2-checklist">'
        + ''.join(f'<li>{e(x)}</li>' for x in acao["itens"]) + '</ul>'
        f'<div class="v2-execucao"><h3>O primeiro passo de vocês</h3><p>{e(acao["preparar"])}</p>'
        f'<h3>Quem faz</h3><p>{e(acao["quem"])}</p></div>'
        f'<div class="v2-pronto"><span class="miudo">Como saber que ficou pronto</span><p>{e(acao["pronto"])}</p></div></article>'
        f'<ul class="v2-sequencia">{sequencia}</ul>'
        '<div class="mapa-convite"><span class="miudo">O próximo passo · grátis</span>'
        f'<h2>{e(m["titulo"])}</h2><p><strong>{e(m["ponte"])}</strong></p><p>{e(m["texto"])}</p>'
        '<p class="fatos"><span>16 perguntas</span><span>~10 minutos</span><span>sem extrato nem senha</span>'
        '<span>conversa de 45 min</span></p>'
        f'<a class="botao-zap" href="{e(dados["mapa_link"])}" target="_blank" rel="noopener">Começar o Mapa grátis</a>'
        f'<a class="link-escuro" href="{e(dados["mapa_exemplo_url"])}">Ver um Mapa de exemplo</a></div>'
        # O fecho pessoal (29/10/2026): o Raio-X chega pelo WhatsApp, e quem lê até aqui precisa saber que a
        # resposta é na mesma conversa e quem está do outro lado. Vem depois do convite do Mapa, sem tirá-lo.
        # Sem classe nova: o esqueleto do exemplo (que não tem fecho) continua valendo para todo lead.
        + (f'<p><strong>{e(editorial["fecho"]["texto"])}</strong><br>{e(editorial["fecho"]["assinatura"])}</p>'
           if editorial.get("fecho") else '')
        + '</section>'
    )
    doc = substituir(doc, r'<section class="ato o-que-fazer fazer".*?</section>', fechamento)
    doc = doc.replace('Responder as 16 perguntas do Mapa', 'Começar o Mapa grátis')
    return acrescentar_presenca(doc, dados, presenca)


FECHO = {'texto': 'Para conversar, é só responder na mesma conversa do WhatsApp.',
         'assinatura': 'Rômulo Sutil Corrêa · PRUMO'}


def primeira_frase(t):
    """A primeira frase de um porquê: a abertura cita o fato, e o ponto 01 traz o resto (sem repetir o parágrafo)."""
    return re.split(r'(?<=[.!?])\s+(?=[A-ZÁÉÍÓÚÂÊÔÃÕÇ“"])', t.strip(), maxsplit=1)[0]


def minuscula_inicial(t):
    # "Nota 5,0 no Google" vira "nota 5,0 no Google" depois de dois-pontos; sigla ou número fica como está.
    return t[:1].lower() + t[1:] if len(t) > 1 and t[1].islower() else t


def editorial_basico(d):
    """Estrutura comum para o automático; não transforma dados não lidos em fatos.

    29/10/2026 (comparação com um Raio-X feito à mão que vende melhor): a abertura é o fato mais forte,
    que é o ponto 01 (quem monta os pontos os entrega na ordem da força do fato verificável), e a leitura
    cita só a primeira frase dele, mais o que já ajuda; a primeira ação usa o motivo, os entregáveis, o
    primeiro passo e o critério de pronto que vierem nela (`motivo`, `itens`, `preparar`, `pronto`), em vez
    de repetir o mesmo texto três vezes; e a página termina no fecho pessoal, depois do convite do Mapa."""
    g=d.get('google'); ac=d['o_que_fazer']; primeiro=ac[0]; forte=d['pontos'][0]
    # Sem ficha no Google (dados["google"] é None, como no gerar.py), não há nota nem avaliação para citar.
    if g and g.get('nota') is not None:
        no_google={'numero': numero(g['nota']), 'rotulo':'nota no Google', 'detalhe':str(g['avaliacoes'])+' avaliações'}
    else:
        no_google={'numero':'0', 'rotulo':'avaliações no Google', 'detalhe':'sem ficha no Google Maps'}
    return {
        'abertura': {
            'titulo': forte['titulo'],
            'leitura': primeira_frase(forte['porque'])
                       + (f" O que já ajuda: {minuscula_inicial(d['bons'][0]['titulo'])}." if d.get('bons') else ''),
            'prioridade': primeiro['texto'],
            'evidencias': [
                no_google,
                {'numero':str(len(d['buscas'])), 'rotulo':'buscas consultadas', 'detalhe':'Posições e concorrentes em detalhe abaixo'},
                {'numero':'01', 'rotulo':'primeira melhoria recomendada', 'detalhe':primeiro['titulo']}],
            'confirmado':'Os dados disponíveis do perfil e das buscas, descritos nas fontes abaixo.',
            'limites':'A ordem das buscas varia por pessoa. O que não foi conferido está identificado nos detalhes.'},
        'pontos':d['pontos'],
        'acao':{'titulo':primeiro['titulo'],'motivo':primeiro.get('motivo') or forte['porque'],
            'itens':primeiro.get('itens') or [primeiro['texto']], 'preparar':primeiro.get('preparar') or primeiro['texto'],
            'quem':primeiro['quem'],
            'pronto':primeiro.get('pronto')
                     or 'Conferir no celular se a mudança descrita acima ficou acessível para quem procura a empresa.',
            'sequencia':[{'titulo':x['titulo'],'texto':x['texto']} for x in ac[1:]]},
        'mapa':{'titulo':'Do primeiro contato ao serviço fechado',
            'ponte':'Agora vale entender o que acontece entre o primeiro contato e o serviço fechado.',
            'texto':'O Mapa usa as respostas de vocês e uma conversa para entender como os pedidos chegam, quem acompanha os orçamentos e onde o atendimento pode melhorar. A recomendação vem dessa análise. O documento fica com vocês, contratem ou não.'},
        'fontes':[{'nome':'Como o Google escolhe a ordem','url':'https://support.google.com/business/answer/7091?hl=pt-BR'}],
        'fecho':dict(FECHO)}

CSS_EDITORIAL = "\n/* Proposta de apresentação. Mantém Archivo, cores e medidas do PRUMO. */\n.v2-abertura h1{font-size:clamp(1.15rem,3vw,1.6rem);line-height:1.2;letter-spacing:-.025em;margin-bottom:1.4rem}\n.v2-abertura .v2-tese{font-size:clamp(2.15rem,5.8vw,4.15rem);line-height:1.03;letter-spacing:-.045em;max-width:19ch;margin:0 0 1.5rem;font-weight:800}\n.v2-abertura .lede{max-width:62ch;font-size:clamp(1.05rem,2vw,1.22rem);line-height:1.6}\n.v2-evidencias{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1.2rem;list-style:none;padding:0;margin:2.2rem 0}\n.v2-evidencias li{border-top:1px solid var(--linha,rgba(20,15,12,.2));padding-top:1rem;display:flex;flex-direction:column;gap:.4rem}\n.v2-evidencias strong{font-size:clamp(2rem,4vw,3rem);font-weight:800;line-height:1;letter-spacing:-.05em}\n.v2-evidencias span{font-weight:650;font-size:.95rem;line-height:1.35}\n.v2-evidencias small{font-size:.8rem;line-height:1.5;opacity:.7}\n.v2-prioridade{border-left:4px solid #e0490f;padding:1rem 1.4rem;background:rgba(224,73,15,.055);margin-top:1.5rem}\n.v2-prioridade p{font-size:1.15rem;line-height:1.45;font-weight:650;margin:.6rem 0 1rem;max-width:55ch}\n.v2-medicao{margin:1.6rem 0 0;padding-top:1.2rem;border-top:1px solid rgba(20,15,12,.16);max-width:70ch}\n.v2-medicao p{font-size:.8rem;line-height:1.6;margin:.5rem 0;opacity:.85}\n.v2-comparacao{margin-bottom:1rem}\n.v2-comparacao .comparacao{border:0;padding:0;margin:0}\n.v2-acao{scroll-margin-top:1.5rem;border-top:4px solid #e0490f;padding-top:1.5rem}\n.v2-acao h2{max-width:24ch;margin:.8rem 0 1rem}\n.v2-acao h3{font-size:1.03rem;margin:1.7rem 0 .6rem}\n.v2-checklist{list-style:none;padding:0;margin:1rem 0 1.7rem}\n.v2-checklist li{padding:.85rem 0 .85rem 1.7rem;position:relative;border-bottom:1px solid rgba(20,15,12,.12);line-height:1.6}\n.v2-checklist li:before{content:'✓';position:absolute;left:0;color:#c43b09;font-weight:700}\n.v2-execucao p,.v2-pronto p,.v2-sequencia p{line-height:1.65;max-width:65ch}\n.v2-pronto{padding:1.3rem 1.5rem;margin:1.8rem 0;background:rgba(20,15,12,.045)}\n.v2-pronto p{margin:.6rem 0 0}\n.v2-sequencia{list-style:none;padding:0;margin:2rem 0 3rem;display:grid;grid-template-columns:1fr 1fr;gap:1.8rem}\n.v2-sequencia li{border-top:1px solid rgba(20,15,12,.2);padding-top:1rem}\n.v2-sequencia h3{font-size:1.05rem;line-height:1.4;margin:0 0 .7rem}\n.v2-sequencia p{font-size:.92rem;margin:0}\n.v2-fazer .mapa-convite h2{max-width:24ch}\n@media(max-width:560px){.v2-evidencias{gap:.8rem;margin:1.8rem 0}.v2-evidencias strong{font-size:1.9rem}.v2-evidencias span{font-size:.8rem}.v2-evidencias small{font-size:.72rem}.v2-prioridade{padding:1rem}.v2-prioridade p{font-size:1.05rem}.v2-sequencia{grid-template-columns:1fr;gap:1.5rem}.v2-medicao p{font-size:.78rem}.v2-pronto{padding:1.1rem}}\n"

editorial_raio_x = aplicar


e = lambda t: html.escape(str(t), quote=True)  # noqa: E731


def zap(texto: str, precos: dict) -> str:
    """O wa.me do PRUMO com a mensagem já começada."""
    return f"https://wa.me/{precos['whatsapp']}?text=" + urllib.parse.quote(texto, safe="")


def rico(t: str) -> str:
    """Escapa e aceita **negrito**."""
    return re.sub(r"\*\*(.+?)\*\*", r"<strong>\1</strong>", e(t))


def negrito(t: str) -> str:
    """O trecho em **negrito** de um texto (o título curto de uma ação)."""
    m = re.search(r"\*\*(.+?)\*\*", t)
    return m.group(1) if m else t


def avaliacoes(n) -> str:
    """"1 avaliação", "12 avaliações"."""
    return f"{e(n)} avaliaç{'ão' if n == 1 else 'ões'}"


def brl(v: int) -> str:
    return "R$ " + f"{v:,}".replace(",", ".")


def num(v: float, casas: int = 1) -> str:
    return (f"{v:.{casas}f}".rstrip("0").rstrip(".") if casas else str(round(v))).replace(".", ",")


def cartoes(nome: str, origem: str, motivos: dict, precos: dict) -> str:
    """Os quatro serviços do pitch, cada um com preço, o porquê tirado do documento e o botão de
    WhatsApp com a mensagem começada."""
    itens = []
    for s in precos["servicos"]:
        motivo = motivos.get(s["chave"])
        texto = f"Olá, PRUMO. Vi o {origem} da {nome} e quero falar de {s['nome'].lower()}."
        itens.append(
            f'<article class="cartao{" principal" if s["chave"] == "site" else ""}">'
            f'<h3>{e(s["nome"])}</h3><p class="preco">{e(s["preco"])} <small>{e(s["mensal"])}</small></p>'
            + (f'<p class="motivo">{rico(motivo)}</p>' if motivo else "")
            + f'<p>{e(s["linha"])}</p><p class="garantia">{e(s["garantia"])}</p>'
            f'<a class="botao-zap" href="{e(zap(texto, precos))}" target="_blank" rel="noopener">{e(s["botao"])}</a></article>')
    return "".join(itens)


def lista_servicos(nome: str, origem: str, motivos: dict, precos: dict) -> str:
    """Os quatro serviços em linhas curtas, sem preço: para o Raio-X que leva ao Mapa."""
    itens = []
    for s in precos["servicos"]:
        texto = f"Olá, PRUMO. Vi o {origem} da {nome} e quero falar de {s['nome'].lower()}."
        motivo = motivos.get(s["chave"])
        itens.append(f'<li><div><b>{e(s["nome"])}</b>'
                     + (f'<span class="motivo">{rico(motivo)}</span>' if motivo else "")
                     + f'</div><a href="{e(zap(texto, precos))}" target="_blank" rel="noopener">{e(s["botao"])}</a></li>')
    return "".join(itens)


# ------------------------------------------------------------------ estilo

CSS_COMUM = """
.exemplo{margin-top:14px;background:var(--ocre);color:var(--ferro-900);padding:10px 14px;font-size:14px;line-height:1.4;
font-weight:700}
.exemplo a{font-weight:800}
.comparacao{margin-top:40px}
.tabela-comp{width:100%;border-collapse:collapse;margin-top:14px;font-size:16px}
.tabela-comp th,.tabela-comp td{padding:10px 6px;border-bottom:1px solid var(--pedra-400);text-align:left;vertical-align:top}
.tabela-comp th:first-child,.tabela-comp td:first-child{padding-left:0}
.tabela-comp thead th{font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--pedra-600);font-weight:800;
border-bottom:2px solid var(--ferro-900)}
.tabela-comp td.v{font-weight:900;font-size:20px;line-height:1.1;font-variation-settings:'wdth' 112,'wght' 900;
white-space:nowrap}
.tabela-comp tr.perde td.voces{color:var(--brasa)}
.tabela-comp small{display:block;font-size:12px;color:var(--pedra-600);font-weight:600;white-space:normal}
.comparacao .frase{margin-top:14px;font-size:22px;line-height:1.2;font-weight:800;font-variation-settings:'wdth' 104,'wght' 800}
.buscas-resumo{list-style:none;margin-top:12px;display:grid;gap:6px}
.buscas-resumo li{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid var(--pedra-400);padding:8px 0}
.buscas-resumo b{white-space:nowrap}
.buscas-resumo .pior b{color:var(--brasa)}
.fazer .lista .quem{font-size:14px;font-weight:800;color:var(--oxido);margin-top:6px}
.bloco{margin-top:40px}
.bloco > .intro{margin-top:8px}
.cartoes{display:grid;gap:14px;margin-top:16px}
.cartao{border:2px solid var(--ferro-900);padding:20px 18px;display:grid;gap:8px;align-content:start}
.cartao.principal{background:var(--ferro-900);color:var(--pedra-100)}
.cartao h3{font-size:22px;line-height:1.1;font-weight:800;font-variation-settings:'wdth' 106,'wght' 800}
.cartao .preco{font-size:28px;line-height:1.05;font-weight:900;color:var(--oxido);font-variation-settings:'wdth' 112,'wght' 900}
.cartao.principal .preco{color:var(--brasa-clara)}
.cartao .preco small{display:block;margin-top:4px;font-size:15px;font-weight:800;color:var(--ferro-600);
font-variation-settings:'wdth' 100,'wght' 800}
.cartao.principal .preco small{color:var(--pedra-200)}
.cartao p{font-size:15px;color:var(--ferro-600)}
.cartao.principal p{color:var(--pedra-200)}
.cartao .motivo{color:var(--ferro-900);border-left:3px solid var(--brasa);padding-left:10px}
.cartao.principal .motivo{color:var(--pedra-100)}
.cartao .garantia{font-weight:700;color:var(--ferro-900)}
.cartao.principal .garantia{color:var(--pedra-100)}
.cartao .selo{justify-self:start;background:var(--brasa);color:var(--ferro-900);font-size:12px;font-weight:800;
letter-spacing:.08em;text-transform:uppercase;padding:4px 8px}
.cartao .botao-zap{margin-top:6px;width:100%;font-size:17px;min-height:52px}
@media (min-width:640px){.cartoes{grid-template-columns:1fr 1fr}}
.mapa-convite{margin-top:28px;border:2px solid var(--ferro-900);border-left:6px solid var(--brasa);padding:22px 20px;
display:grid;gap:10px}
.mapa-convite h2{margin-top:0}
.mapa-convite p{color:var(--ferro-600);max-width:58ch}
.mapa-convite .fatos{display:flex;flex-wrap:wrap;gap:4px 18px;font-size:14px;font-weight:800;color:var(--ferro-900)}
.mapa-convite .botao-zap{justify-self:stretch}
.servicos-curto{margin-top:32px}
.servicos-curto h3{font-size:20px;line-height:1.2;font-weight:800}
.servicos-curto ul{list-style:none;margin-top:12px;border-top:2px solid var(--ferro-900)}
.servicos-curto li{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;padding:12px 0;border-bottom:1px solid var(--pedra-400)}
.servicos-curto li > div{display:grid;gap:2px}
.servicos-curto b{font-size:17px}
.servicos-curto .motivo{font-size:14px;color:var(--ferro-600)}
.servicos-curto a,.link-escuro{justify-self:start;min-height:44px;display:inline-flex;align-items:center;font-weight:800;
text-decoration:underline;text-decoration-color:var(--brasa);text-decoration-thickness:2px;text-underline-offset:4px}
.servicos-curto a:hover,.link-escuro:hover{color:var(--oxido)}
.servicos-curto a:focus-visible,.link-escuro:focus-visible{outline:3px solid var(--ocre);outline-offset:2px}
@media (min-width:640px){.servicos-curto li{grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px}}
/* A nota, sem a fórmula */
.faixas-nota{list-style:none;margin-top:14px;display:grid;gap:8px}
.faixas-nota li{padding:10px 12px;border:2px solid var(--pedra-400)}
.faixas-nota li.atual{border-color:var(--ferro-900);background:var(--pedra-200)}
.faixas-nota b{font-weight:800}
.faixas-nota span{font-size:13px;font-weight:700;color:var(--pedra-600)}
.faixas-nota p{font-size:15px;color:var(--ferro-600);margin-top:2px}
.nota-pe strong{color:var(--ferro-900)}
.escapa{margin-top:18px;border-left:6px solid var(--brasa);background:var(--pedra-200);padding:14px 16px;display:grid;gap:4px}
.escapa p{font-size:17px;line-height:1.45;color:var(--ferro-900)}
.escapa strong{white-space:nowrap}
.cartao .link-demo{justify-self:start;min-height:44px;display:inline-flex;align-items:center;font-weight:800;color:inherit;text-decoration:underline;text-underline-offset:3px}
.cartao .link-demo:focus-visible{outline:3px solid var(--ocre);outline-offset:2px}
.plano-nao h3{color:var(--ferro-600)}
/* Mapa */
.bloco h3.sub{font-size:20px;line-height:1.2;font-weight:800;margin-top:28px}
.bloco .regras + .intro,.bloco h3.sub + .intro{margin-top:8px}
.dinheiro{list-style:none;margin-top:16px;border-top:2px solid var(--ferro-900)}
.dinheiro li{display:grid;grid-template-columns:34px minmax(0,1fr);gap:4px 12px;padding:14px 0;border-bottom:1px solid var(--pedra-400)}
.dinheiro .n{font-size:24px;line-height:1;font-weight:900;color:var(--pedra-400);font-variation-settings:'wdth' 118,'wght' 900}
.dinheiro h3{font-size:18px;line-height:1.25;font-weight:750}
.dinheiro .valor{grid-column:2;font-size:24px;line-height:1.1;font-weight:900;color:var(--oxido);
font-variation-settings:'wdth' 112,'wght' 900}
.dinheiro .valor small{font-size:13px;font-weight:700;color:var(--pedra-600)}
.dinheiro .conta{grid-column:2;font-size:14px;color:var(--ferro-600)}
.soma{margin-top:18px;background:var(--brasa);color:var(--ferro-900);padding:20px 18px;display:grid;gap:4px}
.soma .num{font-size:clamp(34px,9vw,48px);line-height:1;font-weight:900;letter-spacing:-.02em;font-variation-settings:'wdth' 118,'wght' 900}
.soma p{font-size:15px}
.riscos{margin-top:14px;background:var(--ferro-900);color:var(--pedra-100);padding:20px 18px;display:grid;gap:12px}
.riscos .miudo{color:var(--ocre)}
.riscos b{display:block;font-size:26px;line-height:1.1;font-weight:900;font-variation-settings:'wdth' 112,'wght' 900}
.riscos p{font-size:15px;color:var(--pedra-200)}
.nota-pe{margin-top:12px;font-size:14px;color:var(--pedra-600)}
.semana{list-style:none;margin-top:14px;border-top:2px solid var(--ferro-900)}
.semana li{display:grid;grid-template-columns:minmax(0,1fr);gap:2px;padding:12px 0;border-bottom:1px solid var(--pedra-400)}
.semana .q{font-weight:750}
.semana .det{font-size:14px;color:var(--ferro-600)}
.semana .tag{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--oxido)}
.semana .tag.nao{color:var(--pedra-600)}
.numeros{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border:2px solid var(--ferro-900);margin-top:16px}
.numeros > div{padding:12px 10px;border-right:2px solid var(--ferro-900);display:grid;gap:4px;align-content:start}
.numeros > div:last-child{border-right:0;background:var(--brasa)}
.numeros b{font-size:26px;line-height:1;font-weight:900;font-variation-settings:'wdth' 118,'wght' 900}
.numeros span{font-size:13px;line-height:1.3;color:var(--ferro-600)}
.numeros > div:last-child span{color:var(--ferro-900)}
.onde-esta{list-style:none;margin-top:14px;border-top:2px solid var(--ferro-900)}
.onde-esta li{padding:12px 0;border-bottom:1px solid var(--pedra-400);display:grid;gap:6px}
.onde-esta .q{font-weight:750}
.onde-esta .lugares{display:flex;flex-wrap:wrap;gap:6px}
.onde-esta .lugar{font-size:13px;font-weight:700;padding:3px 8px;border:2px solid var(--pedra-400);color:var(--pedra-600)}
.onde-esta .lugar.vive{background:var(--ferro-900);border-color:var(--ferro-900);color:var(--pedra-100)}
.onde-esta .lugar.duvida{border-color:var(--oxido);color:var(--oxido)}
.destaque-num{margin-top:16px;display:grid;grid-template-columns:auto minmax(0,1fr);gap:14px;align-items:start;
border:2px solid var(--ferro-900);padding:16px}
.destaque-num .n{font-size:52px;line-height:.9;font-weight:900;color:var(--oxido);font-variation-settings:'wdth' 118,'wght' 900}
.destaque-num p{font-size:15px;color:var(--ferro-600);margin-top:4px}
.partes{list-style:none;margin-top:14px;display:grid;gap:16px}
.partes li{display:grid;gap:6px}
.partes .cab{display:flex;justify-content:space-between;gap:8px;align-items:baseline}
.partes .cab span{font-weight:750}
.partes .cab b{font-weight:900;color:var(--oxido);white-space:nowrap}
.partes p{font-size:15px;color:var(--ferro-600)}
.trilho{display:flex;height:10px;background:var(--pedra-200);border:2px solid var(--ferro-900)}
.trilho i{display:block;background:var(--brasa)}
.nao-agora{margin-top:20px;background:var(--ferro-900);color:var(--pedra-100);padding:18px;display:grid;gap:4px}
.nao-agora .miudo{color:var(--ocre)}
.nao-agora p{color:var(--pedra-200);font-size:15px}
.nao-agora h3{font-size:19px;line-height:1.25;font-weight:800}
.regras{list-style:none;margin-top:12px;border-top:2px solid var(--ferro-900)}
.regras li{display:grid;gap:2px;padding:10px 0;border-bottom:1px solid var(--pedra-400);font-size:16px}
.regras small{font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--oxido)}
.chat{margin-top:12px;background:var(--ferro-900);padding:14px;display:flex;flex-direction:column;gap:8px;font-size:15px;
line-height:1.35;max-width:440px}
.chat .cab{color:var(--pedra-100);font-weight:800;border-bottom:2px solid var(--ferro-600);padding-bottom:8px}
.chat .cab small{display:block;color:var(--pedra-400);font-weight:400;font-size:13px}
.chat .p{align-self:flex-end;max-width:85%;background:#332A24;color:var(--pedra-100);padding:8px 10px}
.chat .r{align-self:flex-start;max-width:90%;background:var(--ferro-800);color:var(--pedra-100);border:2px solid var(--ocre);padding:8px 10px}
.chat .r.nao{border-style:dashed;border-color:var(--pedra-400)}
.chat .aviso{color:var(--pedra-400);font-size:12px}
.inclui{list-style:none;margin-top:12px;display:grid;gap:8px}
.inclui li{padding-left:14px;border-left:3px solid var(--brasa);font-size:16px}
.inclui li.leve{border-left-color:var(--pedra-400);color:var(--ferro-600);font-size:15px}
.cartao .n8n{font-size:14px;border-top:1px solid var(--ferro-600);padding-top:8px}
.conversa{margin-top:40px;background:var(--ferro-900);color:var(--pedra-100);padding:24px 20px;display:grid;gap:12px}
.conversa h2{color:var(--pedra-100);margin-top:0}
.conversa p{color:var(--pedra-200)}
.agenda{list-style:none;border:2px solid var(--pedra-400)}
.agenda li{padding:10px 14px;border-bottom:2px solid var(--pedra-400);display:grid;gap:2px}
.agenda li:last-child{border-bottom:0}
.agenda .miudo{color:var(--pedra-400)}
.agenda b{font-size:16px;color:var(--pedra-100)}
"""


# Regras do CSS do SquadOne que nenhuma das duas páginas usa (são da versão automática do Raio-X).
# A lista é fixa, não sai do conteúdo de cada página: assim todo lead leva o mesmo estilo.css.
CSS_SEM_USO = (".presenca .placar .escala", ".presenca .blocos", ".presenca .blocos li", ".presenca .blocos .cab",
               ".presenca .blocos .cab span", ".presenca .blocos .cab b", ".presenca .blocos .trilho",
               ".presenca .blocos .nm .cab b", ".presenca .blocos .nm .trilho", ".presenca .blocos p")


def css_da_pagina(css: str) -> str:
    """O CSS que vai para a página: sem comentários e sem CSS_SEM_USO. Se uma regra da lista sumir do
    SquadOne, para aqui, em vez de sair uma página diferente sem ninguém ver."""
    css = re.sub(r"/\*.*?\*/\n?", "", css, flags=re.S)
    for sel in CSS_SEM_USO:
        css, n = re.subn(r"(?:(?<=[{}\n])|^)" + re.escape(sel) + r"\{[^{}]*\}\n?", "", css)
        if not n:
            raise ValueError(f"CSS do SquadOne mudou: não achei “{sel}”")
    # O título da calculadora aqui é h3 (lá era h4): a mesma regra, no mesmo lugar.
    css, n = re.subn(r"(?<=[}\n])\.calculo h4\{", ".calculo h3{", css)
    if n != 1:
        raise ValueError("CSS do SquadOne mudou: não achei “.calculo h4”")
    return re.sub(r"@media[^{}]*\{\s*\}\n?", "", css)


def js_da_pagina(rx, doc: str) -> str:
    """O JS do Raio-X sem comentários; no Mapa, os eventos levam o nome do Mapa."""
    js = re.sub(r"^//.*\n", "", rx.JS_PAGINA, flags=re.M)
    js = js.replace("const URL_EVENTOS = '';", "const URL_EVENTOS = 'https://aladdin-prumo-automacoes.jicnzg.easypanel.host/eventos';")
    js = js.replace("const a=ev.target&&ev.target.closest?ev.target.closest('[data-evento]'):null;if(a)evento(a.getAttribute('data-evento'))});", "const a=ev.target&&ev.target.closest?ev.target.closest('a[href],[data-evento]'):null;if(!a)return;const nome=a.getAttribute('data-evento')||((a.href||'').includes('docs.google.com/forms/')?'raiox-mapa':(a.href||'').startsWith('https://wa.me/')?'raiox-whatsapp':'');if(nome)evento(nome)});")
    js = js.replace('function evento(e){if(!URL_EVENTOS||!navigator.sendBeacon)return;\ntry{navigator.sendBeacon(URL_EVENTOS,JSON.stringify({e:e,p:location.pathname,t:Date.now()}))}catch(_){}}', "function evento(e){if(!URL_EVENTOS)return;\ntry{const corpo=JSON.stringify({e:e,p:location.pathname,t:Date.now(),id:crypto.randomUUID()});if(!navigator.sendBeacon||!navigator.sendBeacon(URL_EVENTOS,corpo))fetch(URL_EVENTOS,{method:'POST',body:corpo,keepalive:true,credentials:'omit'}).catch(function(){})}catch(_){}}")
    js = js.replace("p:location.pathname", "p:'/" + ("mapa" if doc == "mapa" else "raio-x") + "'")
    if doc == "mapa":
        js = js.replace("'raiox-mapa'", "'mapa-formulario'").replace("'raiox-", "'mapa-")
    return js


def pagina(titulo: str, descricao: str, corpo: list[str], barra: tuple[str, str], rx, cp, doc: str,
           cabeca: str = "", corpo_attr: str = "") -> str:
    """O esqueleto comum: cabeça, fonte embutida, o corpo, a barra fixa do celular e o JS do Raio-X
    (a barra aparece quando o "O que fazer" chega na tela; medição ativa, sem cookies)."""
    return "\n".join([
        '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">',
        '<meta name="viewport" content="width=device-width,initial-scale=1">',
        '<meta name="robots" content="noindex,nofollow">',
        f"<title>{e(titulo)}</title>", f'<meta name="description" content="{e(descricao)}">',
        '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 16 16%22%3E'
        '%3Crect width=%2216%22 height=%2216%22 fill=%22%231B1512%22/%3E%3Crect x=%227%22 y=%223%22 width=%222%22 height=%2210%22 fill=%22%23E0490F%22/%3E%3C/svg%3E">',
        *([cabeca] if cabeca else []),
        f"<style>{rx.fonte_css(rx.FONTE)}{css_da_pagina(rx.CSS + cp.CSS_PRESENCA + CSS_COMUM + CSS_EDITORIAL + CSS_INDICE + CSS_MAPA_EDITORIAL)}</style></head>",
        f'<body{" " + corpo_attr if corpo_attr else ""}><main class="folha">', *[c for c in corpo if c], "</main>",
        f'<div class="barra-fixa"><a class="botao-zap" href="{e(barra[0])}" target="_blank" rel="noopener">{e(barra[1])}</a></div>',
        f"<script>{js_da_pagina(rx, doc)}</script></body></html>\n"])


def topo(rotulo: str) -> str:
    return ('<header class="topo"><div class="marca"><span class="fio"></span><span>PRU<span class="brasa">MO</span></span></div>'
            f'<span class="miudo">{e(rotulo)}</span></header>')


def regua(cp, nota: float, tipo: str, rotulos: list[str], titulo: str, texto: str) -> str:
    """A régua de três faixas com o fio de prumo (as classes do CSS_PRESENCA), com rótulos simples."""
    f = cp.faixa(nota, tipo)
    i = [x["chave"] for x in cp.FAIXAS].index(f["chave"])
    itens = "".join(f'<li class="atual">{e(r)}<span class="visualmente-oculto"> (vocês estão aqui)</span></li>' if k == i
                    else f"<li>{e(r)}</li>" for k, r in enumerate(rotulos))
    pos = (2 * i + 1) * 100 / (2 * len(rotulos))
    return (f'<div class="faixa-presenca"><span class="miudo">{e(titulo)} · nota {e(num(nota))} de 18</span>'
            f'<p class="faixa-rotulo">{e(rotulos[i])}</p>'
            f'<div class="regua-faixas"><ol aria-label="{e(titulo)}">{itens}</ol>'
            f'<span class="prumo-fio" style="--pos:{pos:.3f}%" aria-hidden="true"></span></div>'
            f'<p class="faixa-texto">{e(texto)}</p></div>')


# ------------------------------------------------------------------ o que a nota quer dizer

# A página explica o que a nota diz, nunca como ela é feita: quantos pontos, o peso de cada um, a
# régua de 0 a 3 e a regra do MIN são do método do PRUMO e não aparecem (decisão de 13/10/2026).
SIGNIFICADO = {
    "presenca": ("Nota de presença",
                 "Quanto maior, mais fácil para quem procura achar vocês e escolher vocês quando compara com os "
                 "primeiros da busca."),
    "autonomia": ("Nota de autonomia",
                  "Quanto maior, mais a empresa anda sem você: as regras estão escritas, são seguidas e têm um "
                  "responsável, e o time resolve sem te chamar."),
}
FAIXAS_NOTA = ("de 0 a 6,9", "de 7 a 12,9", "de 13 a 18")

# O documento é o de verdade; a empresa, não. A LGPD é o motivo verdadeiro de não haver caso real à
# mostra (nenhum Raio-X ou Mapa de cliente vai para terceiros), e não um disfarce: a página nunca diz
# que há uma empresa real por trás do exemplo (tom de voz: caso fictício nunca passa por real).
AVISO_EXEMPLO = ("Este é o {doc} de verdade, como o associado recebe. Só a empresa é de exemplo: pela LGPD, o PRUMO "
                 "não mostra o {doc} de nenhum cliente a terceiros, e por isso a {empresa} e as pessoas daqui não existem.")

# Palavras do ramo: "paciente" numa clínica, "cliente" no resto. Cada JSON pode trocar em "termos".
TERMOS = {"cliente": "cliente", "clientes": "clientes", "empresa": "empresa", "chat_onde": "no WhatsApp do time"}


def termos(dados: dict) -> dict:
    return {**TERMOS, **(dados.get("termos") or {})}


def calculadora(cp, presenca: dict) -> str:
    """A conta aberta do Raio-X (1 cliente a mais × o valor que o dono digita), sem o detalhe da nota."""
    if not presenca.get("cenarios"):
        return ""
    l1, l2 = cp.frase_da_conta(None)
    n = cp.CLIENTES_A_MAIS_POR_MES
    return ('<div class="calculo"><h3>Quanto vale fechar essas distâncias</h3>'
            f'<p>Se uma destas mudanças trouxesse {"1 cliente" if n == 1 else f"{n} clientes"} a mais por mês:</p><ul>'
            + "".join(f"<li>{e(c)}</li>" for c in presenca["cenarios"]) + "</ul>"
            '<div><label for="prumo-valor">Quanto vale, em média, um cliente fechado para vocês?</label>'
            '<div class="campo"><span aria-hidden="true">R$</span>'
            '<input id="prumo-valor" name="valor" type="text" inputmode="decimal" autocomplete="off" '
            'placeholder="___" aria-describedby="prumo-conta-aviso"></div></div>'
            f'<p class="conta" aria-live="polite"><span id="prumo-conta-1">{e(l1)}</span>'
            f'<span id="prumo-conta-2">{e(l2)}</span></p>'
            '<p class="aviso" id="prumo-conta-aviso">É um cenário, não uma promessa. A conta é feita neste aparelho, com '
            'o valor que vocês digitam, e ele não é enviado a ninguém. Os cenários não se somam: é um cliente a mais, '
            'venha de onde vier. E é faturamento, não lucro.</p>'
            f"<script>{cp.js_calculadora()}</script></div>")


def nota_html(cp, nota: float, tipo: str, rotulos: list[str], textos: list[str]) -> str:
    """O número, a faixa e o que cada faixa quer dizer. A fórmula fica de fora."""
    nome, sentido = SIGNIFICADO[tipo]
    f = cp.faixa(nota, tipo)
    i = [x["chave"] for x in cp.FAIXAS].index(f["chave"])
    pct = max(0.0, min(100.0, nota / 18 * 100))
    faixas = "".join(f'<li class="{"atual" if k == i else ""}"><b>{e(rotulos[k])}</b> <span>{e(FAIXAS_NOTA[k])}</span>'
                     f'<p>{e(textos[k])}</p></li>' for k in range(3))
    return (f'<section class="presenca"><h3>{e(nome)}: {e(num(nota))} de 18</h3>'
            f'<div class="placar"><span class="num">{e(num(nota))}<small>/18</small></span><div class="lado">'
            f'<span class="faixa">{e(rotulos[i])}</span><span class="trilho" aria-hidden="true"><i style="width:{pct:.1f}%">'
            f'</i></span><p>{e(sentido)}</p></div></div>'
            f'<ul class="faixas-nota">{faixas}</ul>'
            '<p class="regra">A nota sai do método do PRUMO, com as mesmas regras para todas as empresas. A fórmula é '
            'nossa; o que ela leva em conta está nesta página.</p></section>')


# ------------------------------------------------------------------ Raio-X

# Frases do cálculo que levam nome de método; na página, em palavras do dono.
TROCAS_RAIO_X = [
    ("pelo cálculo PRUMO", "com as mesmas regras para todas as empresas"),
    ("à mediana dos concorrentes", "ao número do meio da lista dos concorrentes"),
    # O Raio-X feito à mão lê as mais recentes (é o que "De onde vem cada dado" diz), não as que o
    # Google mostra primeiro, como no automático.
    ("avaliações que o Google mostra primeiro no perfil de vocês e contamos", "avaliações mais recentes com texto e contamos"),
]


# Sem ficha no Google Maps (google: null, Radix, 19/10/2026): onde a página mostraria a nota, as avaliações e o
# perfil, diz que a ficha não existe. A presença conta o que é verdade sem ela: nenhuma avaliação, nada do perfil.
CENARIO_SEM_FICHA = "Se vocês tivessem uma ficha no Google Maps, com horário, fotos, telefone e o botão “Site”"
SEM_FICHA_ITENS = ("Horário de funcionamento", "Telefone", "Fotos", "Categoria", "Botão “Site”")


def sem_ficha(dados: dict) -> bool:
    return "google" in dados and dados["google"] is None


LEDE = "Feito pelo PRUMO só com o que qualquer pessoa vê no Google, nas redes e nos anúncios, sem pedir nada a vocês."
# As chaves opcionais de `dados` (o Raio-X à mão do piloto não usa nenhuma):
GANCHOS = {
    "lede": "a frase depois do ramo e da cidade, no lugar de LEDE (o automático só lê o Google)",
    "descricao": "a meta description",
    "perfil_linhas": "o checklist do perfil já pronto ([{estado, item, detalhe}], estado ok|falta|nc)",
    "metodo": "as linhas de “De onde vem cada dado”, em texto ({como_ordena} vira o link do Google)",
    "avaliacoes_ordem": "'google' = as avaliações são as que o Google mostra primeiro (não as mais recentes)",
    "site_rotulo": "o rótulo do site de vocês na lista da busca (ex.: “site fora do ar”)",
    "cabeca": "HTML a mais no <head> (as og: do automático)",
    "corpo_attr": "atributo do <body> (a marca de versão do automático)",
}


def raio_x(dados: dict, rx, cp, precos: dict) -> tuple[str, dict]:
    """A página do Raio-X e a nota de presença. `dados` no esquema de modelos/raio-x.json do piloto;
    as chaves de GANCHOS são opcionais (o Raio-X automático do Dell usa) e, ausentes, a página sai
    byte a byte como a do piloto."""
    nome, g = dados["nome"], dados["google"]
    if sem_ficha(dados):
        g = {"nota": None, "avaliacoes": 0, "horario": "", "categoria": "", "fotos_total": 0, "fotos_da_empresa": 0}
    buscas = [{"consulta": b["consulta"], "posicao": b["posicao"], "lidos": b["lidos"],
               "concorrentes": [{"id": c["id"], "avaliacoes": c["avaliacoes"]} for c in b["concorrentes"]]}
              for b in dados["buscas"]]
    presenca = cp.nota_de_presenca(buscas=buscas, nota=g["nota"], avaliacoes=g["avaliacoes"],
                                   respostas=dados.get("respostas"), perfil=dados["perfil"], site=dados["site"])
    if sem_ficha(dados):
        perfil = next(b for b in presenca["blocos"] if b["chave"] == "perfil")
        presenca["cenarios"] = [CENARIO_SEM_FICHA if x == perfil["cenario"] else x for x in presenca["cenarios"]]
    pontos, bons = dados["pontos"], dados["bons"]
    item = lambda i, x: (f'<li><span class="marcador">{e(i)}</span><div><h3>{e(x["titulo"])}</h3>'  # noqa: E731
                         f'<p>{e(x["porque"])}</p></div></li>')
    sinal = {"ok": "✓", "falta": "✕", "nc": "–"}
    oculto = {"ok": "Em dia: ", "falta": "Falta: ", "nc": "Não conferido: "}

    def checklist(linhas: list[dict], intro: str) -> str:
        return (f'<p class="intro">{e(intro)}</p><ul class="check">'
                + "".join(f'<li class="{x["estado"]}"><span class="sinal" aria-hidden="true">{sinal[x["estado"]]}</span>'
                          f'<span><span class="visualmente-oculto">{oculto[x["estado"]]}</span>{e(x["item"])}</span>'
                          f'<span class="det">{e(x["detalhe"])}</span></li>' for x in linhas) + "</ul>")

    t = termos(dados)
    c = [topo("Raio-X")]
    if dados.get("exemplo"):
        c.append(f'<p class="exemplo">{AVISO_EXEMPLO.format(doc="Raio-X", empresa=t["empresa"])} O de um associado usa só o que é público '
                 'sobre a empresa dele, conferido pelo PRUMO.</p>')

    # Ato 1 · Veredito
    c += ['<section class="ato veredito" id="veredito" aria-labelledby="t-veredito">',
          '<p class="kicker">Como vocês aparecem para quem procura</p>', f'<h1 id="t-veredito">{e(nome)}</h1>',
          f'<p class="lede">{e(dados["ramo"])} · {e(dados["cidade"])}. {e(dados.get("lede") or LEDE)}</p>',
          (f'<div class="nota"><span class="num">—</span><span class="leitura">sem ficha no Google<br>'
           f'nenhuma nota, nenhuma avaliação<br>lida em {e(dados["lido_em"])}</span></div>' if sem_ficha(dados) else
           f'<div class="nota"><span class="num">{e(rx.numero(g["nota"]))}</span><span class="leitura">nota no Google<br>'
           f'{avaliacoes(g["avaliacoes"])}<br>lida em {e(dados["lido_em"])}</span></div>'),
          cp.bloco_faixa_html(presenca),
          (f'<p class="nota-pe">Nota de presença: <strong>{e(num(presenca["nota"]))} de 18</strong> · '
           '<a class="link-escuro" href="#a-nota" onclick="document.getElementById(\'a-nota\').open=true">'
           'o que ela quer dizer</a></p>' if presenca.get("nota") is not None else ""),
          '<div class="resumo"><div><span class="miudo">O que segura cliente</span>'
          f'<strong>{e(bons[0]["titulo"])}</strong></div><div><span class="miudo">O que perde cliente</span>'
          f'<strong>{e(pontos[0]["titulo"])}</strong></div></div>', "</section>"]

    # Ato 2 · Por quê
    comp = dados["comparacao"]
    linhas_comp = "".join(
        f'<tr class="{"perde" if l.get("perde") else ""}"><td>{e(l["item"])}</td><td class="v voces">{e(l["voces"])}</td>'
        f'<td class="v">{e(l["eles"])}{"<small>" + e(l["nota_eles"]) + "</small>" if l.get("nota_eles") else ""}</td></tr>'
        for l in comp["linhas"])
    b1 = dados["buscas"][0]
    rotulos = {"nenhum": "sem site", "rede": "site: rede social", "proprio": "site próprio"}
    todos = [dict(x) for x in b1["concorrentes"]]
    voces = {"nome": f"{nome} (vocês)", "nota": g["nota"], "avaliacoes": g["avaliacoes"], "site": dados["site"]["tipo"],
             "voces": True, "pos": b1["posicao"]}
    if todos and all(x.get("pos") for x in todos):
        if b1["posicao"] and b1["posicao"] <= max(x["pos"] for x in todos) + 1:
            todos = sorted(todos + [voces], key=lambda x: x["pos"])
    elif b1["posicao"] and b1["posicao"] <= len(todos) + 1:
        todos.insert(b1["posicao"] - 1, voces)
    lista_busca = []
    for i, x in enumerate(todos, 1):
        i = x.get("pos") or i
        rot = (dados.get("site_rotulo") if x.get("voces") else None) or rotulos[x.get("site", "nenhum")]
        sem = ' class="sem"' if rot != "site próprio" else ""
        lista_busca.append(f'<li{" class=voces" if x.get("voces") else ""}><span class="pos">{i}º</span>'
                           f'<span class="quem">{e(x["nome"])}</span><span class="dados">{e(rx.numero(x["nota"]))} de nota · '
                           f'{avaliacoes(x["avaliacoes"])} · <span{sem}>{e(rot)}</span></span></li>')
    notas_busca = [cp.nota_da_posicao(b["posicao"]) for b in dados["buscas"]]
    pior = notas_busca.index(min(notas_busca))
    resumo_buscas = "".join(
        f'<li class="{"pior" if i == pior else ""}"><span>“{e(b["consulta"])}”</span>'
        f'<b>{e(str(b["posicao"]) + "º lugar" if b["posicao"] else "fora dos " + str(b["lidos"]))}</b></li>'
        for i, b in enumerate(dados["buscas"]))
    secao_busca = (f'<p class="intro">Fizemos {len(dados["buscas"])} buscas que um {e(t["cliente"])} faria, escolhidas antes de ver '
                   f'o resultado, em {e(dados["lido_em"])}.</p><ul class="buscas-resumo">{resumo_buscas}</ul>'
                   f'<h3 class="sub">Quem aparece em “{e(b1["consulta"])}”</h3><ol class="busca">{"".join(lista_busca)}</ol>'
                   '<p class="intro">' + ("Os nomes dos concorrentes estão trocados por letras neste exemplo. "
                                          if dados.get("exemplo") else "")
                   + 'A ordem muda um pouco de pessoa para pessoa, porque o Google leva em conta onde cada um está.</p>')
    avals = rx.temas_das_avaliacoes(dados.get("avaliacoes_recentes") or [])
    secao_avaliacoes = rx.secao_avaliacoes({"avaliacoes_lidas": avals}, e)
    if sem_ficha(dados):
        secao_avaliacoes = (f'<p class="intro">Sem ficha no Google Maps, não há onde um {e(t["cliente"])} deixe avaliação, '
                            'e quem procura vocês no Google não lê nenhuma.</p>')
    r = dados.get("respostas") or {}
    if r:
        secao_avaliacoes += (f'<p class="intro">Das {r["lidas"]} avaliações mais recentes, {r["respondidas"]} '
                             f'{"tem" if r["respondidas"] == 1 else "têm"} resposta de vocês.</p>')
    perfil_linhas = dados.get("perfil_linhas") or [
        {"estado": "ok" if g["horario"] else "falta", "item": "Horário de funcionamento", "detalhe": g["horario"] or "não aparece"},
        {"estado": "ok" if g.get("telefone") else "falta", "item": "Telefone",
         "detalhe": "celular: dá para ligar ou mandar mensagem" if g.get("telefone") == "celular" else "fixo"},
        # O detalhe de cada item vem do JSON quando o caso pede mais que o número (fotos poucas,
        # categoria geral, site que existe mas não abre); sem ele, a frase neutra.
        {"estado": dados["perfil"]["fotos"], "item": "Fotos",
         "detalhe": g.get("fotos_detalhe")
         or f'{g["fotos_total"]} no perfil, {g["fotos_da_empresa"]} publicadas por vocês'},
        {"estado": dados["perfil"]["categoria"], "item": "Categoria",
         "detalhe": g.get("categoria_detalhe") or g["categoria"]},
        # site_estado: o botão existe (conta como em dia no perfil), mas o que ele abre está quebrado,
        # e isso já pesa no ponto do site; aqui só a marca de falta, para o dono ver.
        {"estado": g.get("site_estado") or dados["perfil"]["site"], "item": "Botão “Site”",
         "detalhe": g.get("site_detalhe") or ("o perfil não tem" if dados["perfil"]["site"] == "falta" else "leva ao site de vocês")},
    ]
    if sem_ficha(dados):
        perfil_linhas = ([{"estado": "falta", "item": "Ficha no Google Maps", "detalhe": dados["sem_ficha"]}]
                         + [{"estado": "falta", "item": x, "detalhe": "sem a ficha, não aparece no Google"}
                            for x in SEM_FICHA_ITENS])
    lidos = sorted({b["lidos"] for b in dados["buscas"]})
    quantos = (f"os {lidos[0]} primeiros resultados de cada uma" if len(lidos) == 1
               else f"pelo menos os {lidos[0]} primeiros resultados de cada uma")
    metodo = [e(m) for m in dados["metodo"]] if dados.get("metodo") else [
        f"Nota, avaliações, horário, fotos e categoria: lidos no perfil do Google em {e(dados['lido_em'])}.",
        f"As buscas: {len(dados['buscas'])}, no Google Maps, em {e(dados['lido_em'])}; lemos {quantos}. "
        f'<a href="{e(rx.FONTE_RANKING)}" rel="noopener">Como o Google escolhe a ordem</a>.',
        "As avaliações: as 5 mais recentes, lidas uma a uma, com a resposta de vocês quando há.",
        e(dados.get("metodo_redes") or "As redes: as que aparecem no perfil e quando se procura o nome de vocês, "
                                       "abertas no dia."),
        "Os anúncios: a página de resultados do Google, nas mesmas buscas, e a Biblioteca de Anúncios da Meta "
        "(Instagram e Facebook), que é pública.",
        "Não conferimos quanto tempo vocês levam para responder uma mensagem: isso só se vê por dentro.",
    ]
    if sem_ficha(dados):
        metodo[0] = (f"A ficha no Google Maps: procurada pelo nome e pelo endereço de vocês em {e(dados['lido_em'])}; "
                     "não existe, e por isso não há nota, avaliações, horário, fotos nem categoria para ler.")
        metodo[2] = "As avaliações: sem ficha, não há nenhuma no Google para ler."
    metodo = [m.replace("{como_ordena}", f'<a href="{e(rx.FONTE_RANKING)}" rel="noopener">Como o Google escolhe a ordem</a>') for m in metodo]
    nota_presenca = nota_html(cp, presenca["nota"], "presenca", [x["presenca"][0] for x in cp.FAIXAS],
                              [x["presenca"][1] for x in cp.FAIXAS]) if presenca.get("nota") is not None else ""
    c += ['<section class="ato por-que" id="por-que" aria-labelledby="t-por-que">',
          '<p class="kicker" id="t-por-que">Por quê</p>',
          f'<div class="pontos"><h2>{len(pontos)} pontos que mandam cliente para o concorrente</h2><ul class="lista">'
          + "".join(item(f"{i:02d}", x) for i, x in enumerate(pontos, 1)) + "</ul></div>",
          f'<div class="comparacao"><h2>Vocês e os 3 primeiros em “{e(comp["busca"])}”</h2>'
          '<table class="tabela-comp"><thead><tr><th scope="col">O que o cliente compara</th><th scope="col">Vocês</th>'
          f'<th scope="col">Os 3 primeiros</th></tr></thead><tbody>{linhas_comp}</tbody></table>'
          f'<p class="frase">{e(comp["frase"])}</p></div>',
          '<div class="detalhes">',
          rx.detalhe("O que já está bom", '<ul class="lista">' + "".join(item("✓", b) for b in bons) + "</ul>"
                     + (f'<p class="intro"><strong>{e(dados["bons_fecho"])}</strong></p>' if dados.get("bons_fecho") else ""),
                     "bons"),
          rx.detalhe("A busca, em detalhe", secao_busca),
          rx.detalhe(f"O que os {t['clientes']} dizem", secao_avaliacoes),
          rx.detalhe("O perfil no Google, item por item",
                     checklist(perfil_linhas, f"O que o {t['cliente']} encontra quando procura vocês no Google Maps: hoje, "
                               "nenhuma ficha." if sem_ficha(dados) else
                               f"O que o {t['cliente']} encontra quando abre o perfil de vocês no Google Maps.")),
          rx.detalhe("Redes sociais", checklist(dados["redes"], f"O que aparece quando o {t['cliente']} procura vocês fora do Google.")),
          rx.detalhe("Anúncios", checklist(dados["anuncios"], "Quem paga para aparecer antes, nas mesmas buscas.")),
          rx.detalhe("A nota e de onde vem cada dado", nota_presenca + calculadora(cp, presenca)
                     + '<h3 class="sub">De onde vem cada dado</h3>'
                     '<ul class="metodo">' + "".join(f"<li>{m}</li>" for m in metodo) + "</ul>")
          .replace('<details class="detalhe">', '<details class="detalhe" id="a-nota">', 1),
          "</div></section>"]

    # Ato 3 · O que fazer. Todo Raio-X leva ao Mapa e quem vende é o Mapa: sem preço aqui.
    c += ['<section class="ato o-que-fazer fazer" id="o-que-fazer" aria-labelledby="t-o-que-fazer">',
          '<p class="kicker" id="t-o-que-fazer">O que fazer</p>',
          f'<h2>{len(dados["o_que_fazer"])} coisas, nesta ordem</h2><ul class="lista">'
          + "".join(f'<li><span class="marcador">{e(f["n"])}</span><div><h3>{e(f["titulo"])}</h3><p>{e(f["texto"])}</p>'
                    f'<p class="quem">{e(f["quem"])}</p></div></li>' for f in dados["o_que_fazer"]) + "</ul>"]
    exemplo_mapa = (f'<a class="link-escuro" href="{e(dados["mapa_exemplo_url"])}">Ver como fica um Mapa pronto</a>'
                    if dados.get("mapa_exemplo_url") else "")
    c.append('<div class="mapa-convite"><span class="miudo">O próximo passo · grátis</span>'
             '<h2>Agora, o olhar por dentro: o Mapa</h2>'
             f'<p><strong>O Raio-X mostrou por que o {e(t["cliente"])} não chega. O Mapa mostra por que ele escapa '
             f'depois que chega.</strong> Com {e(dados.get("equipe") or "equipe")}, parte disso está em quem decide o desconto, o '
             'parcelamento e a agenda. O Mapa mostra o que passa por você, quanto tempo leva e quanto custa; o documento '
             'é de vocês, contratem ou não.</p>'
             '<p class="fatos"><span>16 perguntas</span><span>~10 minutos</span><span>sem extrato nem senha</span>'
             '<span>conversa de 45 min</span></p>'
             f'<a class="botao-zap" href="{e(dados["mapa_link"])}" target="_blank" rel="noopener">Responder as 16 perguntas</a>'
             f'{exemplo_mapa}</div>')
    c.append('<div class="servicos-curto"><h3>Já sabe o que quer arrumar?</h3>'
             '<p class="intro">Os preços vêm no fim do Mapa. Se preferir conversar antes, cada link abre o WhatsApp do '
             'PRUMO com a mensagem começada.</p>'
             f'<ul>{lista_servicos(nome, "Raio-X", dados.get("servicos_motivo") or {}, precos)}</ul></div>')
    c.append("</section>")
    c.append(f'<footer><span>Feito pelo PRUMO com dados públicos, lidos em {e(dados["lido_em"])}.'
             '</span><span>PRUMO · <a href="https://prumo.services" rel="noopener">prumo.services</a> · '
             'WhatsApp +55 27 99976-2786</span></footer>')
    barra = (dados["mapa_link"], "Responder as 16 perguntas do Mapa")
    doc = pagina(f"Raio-X · {nome}", dados.get("descricao")
                 or f"Como {nome} aparece para quem procura: Google, site, redes, anúncios e concorrentes.",
                 c, barra, rx, cp, "raio-x", dados.get("cabeca") or "", dados.get("corpo_attr") or "")
    for velho, novo in TROCAS_RAIO_X:
        # As avaliações que o Google mostra primeiro (o automático) não viram "as mais recentes".
        if dados.get("avaliacoes_ordem") == "google" and velho.startswith("avaliações que o Google"):
            continue
        doc = doc.replace(velho, novo)
    doc = re.sub(r"\b1 de (\d+) avaliações recentes têm resposta", r"1 de \1 avaliações recentes tem resposta", doc)
    doc = editorial_raio_x(doc, dados, presenca)
    return doc, presenca


# ------------------------------------------------------------------ o padrão (a trava de qualidade)

PROIBIDAS = ("trava", "delegáv", "alçada", "mediana", "cálculo prumo", "de 0 a 3", "vale a pior",
             "mais baixa", "regra do min", "índice do prumo", "proporcional", "<<")


def _lacunas(x, caminho: str = "") -> list[str]:
    """Os campos do modelo que ainda têm <<...>>."""
    if isinstance(x, dict):
        return [c for k, v in x.items() if not k.startswith("_")
                for c in _lacunas(v, f"{caminho}.{k}" if caminho else k)]
    if isinstance(x, list):
        return [c for i, v in enumerate(x) for c in _lacunas(v, f"{caminho}[{i}]")]
    return [caminho] if isinstance(x, str) and "<<" in x else []


def _lista(erros: list[str], d: dict, campo: str, minimo: int, exato: bool = False) -> list:
    v = d
    for k in campo.split("."):
        v = v.get(k) if isinstance(v, dict) else None
    n = len(v) if isinstance(v, (list, dict)) else 0
    if n < minimo or (exato and n != minimo):
        erros.append(f"{campo}: {'exatamente' if exato else 'pelo menos'} {minimo}, tem {n}")
    return v if isinstance(v, list) else []


def _texto(erros: list[str], itens: list, nome: str, chave: str, minimo: int, numero: bool = False) -> None:
    for i, x in enumerate(itens, 1):
        texto = str(x.get(chave) or "")
        if len(texto) < minimo:
            erros.append(f"{nome} {i}: “{chave}” com {len(texto)} letras; o padrão pede {minimo} ou mais")
        if numero and not re.search(r"\d", f'{x.get("titulo", "")} {texto}'):
            erros.append(f"{nome} {i}: sem um número que o dono confira (posição, nota, quantidade, R$)")


def _motivos(erros: list[str], d: dict, precos: dict, so: tuple = ()) -> None:
    faltam = [s["nome"] for s in precos["servicos"] if (not so or s["chave"] in so) if not (d.get("servicos_motivo") or {}).get(s["chave"])]
    if faltam:
        erros.append(f"servicos_motivo: falta o motivo de {', '.join(faltam)}")


def conferir_raio_x(d: dict, precos: dict, automatico: bool = False) -> list[str]:
    """O que falta para o padrão; vazio = no padrão. `automatico` (o Dell): os nomes dos concorrentes vêm
    direto do Google, então não se procura nome de exemplo; e o motivo de cada serviço só é exigido onde
    há dado (site e anúncios; redes e WhatsApp não são conferidos de fora)."""
    erros = [f"falta preencher: {c}" for c in _lacunas(d)]
    erros += [f"falta: {c}" for c in ("nome", "ramo", "cidade", "lido_em") if not d.get(c)]
    g = d.get("google") or {}
    if sem_ficha(d):
        erros += conferir_sem_ficha(d)
    elif g.get("nota") is None or g.get("avaliacoes") is None:
        erros.append("falta: google.nota e google.avaliacoes")
    for b in _lista(erros, d, "buscas", 3, exato=True):
        if len(b.get("concorrentes") or []) < 3:
            erros.append(f"busca “{b.get('consulta')}”: pelo menos 3 concorrentes lidos")
    _texto(erros, _lista(erros, d, "pontos", 3, exato=True), "ponto", "porque", 150, numero=True)
    _texto(erros, _lista(erros, d, "bons", 3, exato=True), "o que está bom", "porque", 80)
    _texto(erros, _lista(erros, d, "o_que_fazer", 3, exato=True), "o que fazer", "texto", 80)
    for campo, minimo in (("avaliacoes_recentes", 0 if sem_ficha(d) else 3), ("comparacao.linhas", 4), ("redes", 1),
                          ("anuncios", 1)):
        _lista(erros, d, campo, minimo)
    _motivos(erros, d, precos, ("site", "trafego") if automatico else ())
    ed = d.get("editorial") or (editorial_basico(d) if automatico else {})
    if not ed:
        erros.append("editorial: falta a síntese e a primeira ação do padrão aprovado em 17/10")
    else:
        for campo in ("abertura.titulo", "abertura.leitura", "abertura.prioridade", "abertura.confirmado",
                      "abertura.limites", "acao.titulo", "acao.motivo", "acao.preparar", "acao.quem",
                      "acao.pronto", "mapa.titulo", "mapa.ponte", "mapa.texto"):
            valor = ed
            for chave in campo.split("."):
                valor = valor.get(chave, {}) if isinstance(valor, dict) else {}
            if not isinstance(valor, str) or len(valor.strip()) < 10:
                erros.append(f"editorial.{campo}: precisa de texto próprio da empresa")
        _lista(erros, ed, "abertura.evidencias", 3, exato=True)
        _lista(erros, ed, "pontos", 3, exato=True)
        _lista(erros, ed, "acao.itens", 1)
        _lista(erros, ed, "acao.sequencia", 2, exato=True)
        _lista(erros, ed, "fontes", 1)
    if not d.get("exemplo") and not automatico:
        if not str(d.get("mapa_link") or "").startswith("https://docs.google.com/forms/"):
            erros.append("mapa_link: todo Raio-X termina no convite para o Mapa; o link das 16 perguntas "
                         "(o mapa_link do exemplo) não pode ficar vazio")
        else:
            link = urllib.parse.urlsplit(d["mapa_link"])
            campos = urllib.parse.parse_qs(link.query)
            empresas = campos.get("entry.171063854", [])
            empresa = empresas[0].split("::", 1) if len(empresas) == 1 else []
            if (link.netloc != "docs.google.com" or len(empresa) != 2
                    or not empresa[0].strip() or empresa[1].strip() != str(d.get("nome") or "").strip()
                    or campos.get("entry.1936869861") != ["Dono"]):
                erros.append("mapa_link: preencha uma única Empresa como <ID>::<nome desta empresa> "
                             "e o papel Dono; sem isso a resposta não chega ao lead correto")
        if str(d.get("mapa_exemplo_url") or "").startswith("/"):
            erros.append("mapa_exemplo_url: num lead, o endereço completo do exemplo "
                         "(https://prumo-piloto-cdl.vercel.app/mapa)")
        letras = sorted({c["nome"] for b in d.get("buscas") or [] for c in b.get("concorrentes") or []
                         if re.fullmatch(r"\S+ [A-Z]", str(c.get("nome") or ""))})
        if letras:
            erros.append(f"concorrentes com nome de exemplo ({', '.join(letras)}): num lead, os nomes reais")
    return erros


def conferir_sem_ficha(d: dict) -> list[str]:
    """google: null quer dizer que a ficha não existe; nada na página pode dizer o contrário."""
    erros = []
    if len(str(d.get("sem_ficha") or "")) < 60:
        erros.append("sem_ficha: 60 letras ou mais, dizendo como a ficha foi procurada e o que o Google mostrou")
    if any((d.get("perfil") or {}).get(k) != "falta" for k in ("horario", "fotos", "categoria", "telefone", "site")):
        erros.append("perfil: sem ficha, os 5 itens são “falta”")
    if any(b.get("posicao") for b in d.get("buscas") or []):
        erros.append("buscas: sem ficha, a empresa não tem posição no Google Maps")
    if d.get("avaliacoes_recentes") or d.get("respostas"):
        erros.append("avaliacoes_recentes e respostas: sem ficha, não há avaliações para ler")
    return erros


def conferir_pagina(doc: str) -> list[str]:
    """O texto que o dono lê não tem vocabulário interno, a fórmula da nota nem campo do modelo."""
    texto = re.sub(r"<script.*?</script>|<style.*?</style>", " ", doc, flags=re.S)
    texto = html.unescape(re.sub(r"<[^>]+>", " ", texto)).lower()
    erros = [f"a página diz “{p}”: vocabulário interno, fórmula da nota ou campo do modelo" for p in PROIBIDAS if p in texto]
    corpo = re.sub(r"<script.*?</script>|<style.*?</style>", "", doc, flags=re.S)
    if 'class="ip-instrumento"' in corpo:
        if corpo.count('class="ip-instrumento"') != 1 or corpo.count('class="ip-dimensoes"') != 1:
            erros.append("o Índice Prumo e suas dimensões devem aparecer uma vez")
        ids = re.findall(r'\bid="([^"]+)"', corpo)
        if len(ids) != len(set(ids)):
            erros.append("há IDs repetidos na página")
    return erros


# Campos do exemplo que um lead não tem: o aviso de exemplo, os links entre as páginas do exemplo e,
# no Raio-X, o mapa_link (o do lead é o formulário, às vezes com a empresa preenchida).
SO_DO_EXEMPLO = {"_como_usar", "_conferir", "exemplo", "origem", "raio_x_url", "mapa_link", "mapa_exemplo_url", "versao"}
# Vazio também é resposta: a busca em que a empresa não aparece entre as lidas não tem posição.
PODEM_FICAR_VAZIOS = {"posicao"}


def vazio(v) -> bool:
    return v is None or v == "" or v == [] or v == {}


def molde_raio_x(exemplo: dict, lead: dict) -> dict:
    """A equipe pode ficar vazia (o Places não diz, e "equipe a confirmar" fala mal da empresa): vazia, a
    página diz só "Com equipe" e não cita número. Todo Raio-X leva o convite para o Mapa. Sem ficha no Google,
    a nota, as avaliações e as respostas não existem para ler (o sem_ficha diz isso no lugar)."""
    fora = set() if lead.get("equipe") else {"equipe"}
    if sem_ficha(lead):
        fora |= {"google", "avaliacoes_recentes", "respostas"}
    return {k: v for k, v in exemplo.items() if k not in fora}


def molde_mapa(exemplo: dict, lead: dict) -> dict:
    """No Mapa, a equipe pode ficar vazia: o formulário não pergunta quantas pessoas são, e uma página com
    "equipe a confirmar" fala mal da empresa para o dono (Roda Mais, 14/10). Vazia, a página não fala dela.
    Os riscos também, quando as respostas não trazem nenhum dado em R$: aí o riscos_motivo (60+ letras) diz
    que dado faltou, e o bloco "Fora dessa soma" fica, com o motivo no lugar dos valores."""
    fora = {"equipe"}
    if not lead.get("riscos") and len(str(lead.get("riscos_motivo") or "")) >= 60:
        fora.add("riscos")
    return {k: v for k, v in exemplo.items() if k not in fora}


def conferir_campos(lead: dict, exemplo: dict, caminho: str = "") -> list[str]:
    """Todo campo que o exemplo preenche, o lead preenche: um campo vazio é um parágrafo ou um bloco que
    some da página sem erro nenhum. Nas listas, cada item do lead tem os campos que todos os itens do
    exemplo têm."""
    erros = []
    for k, v in exemplo.items():
        if k in SO_DO_EXEMPLO or k in PODEM_FICAR_VAZIOS or vazio(v):
            continue
        onde = f"{caminho}.{k}" if caminho else k
        x = lead.get(k) if isinstance(lead, dict) else None
        if vazio(x):
            erros.append(f"{onde}: vazio, e o exemplo preenche (o bloco sumiria da página)")
        elif isinstance(v, dict) and isinstance(x, dict):
            erros += conferir_campos(x, v, onde)
        elif isinstance(v, list) and isinstance(x, list) and v and all(isinstance(i, dict) for i in v):
            comuns = {c for c in v[0] if c not in PODEM_FICAR_VAZIOS and all(not vazio(i.get(c)) for i in v)}
            erros += [f"{onde}[{n}].{c}: vazio, e no exemplo todo item tem" for n, i in enumerate(x)
                      if isinstance(i, dict) for c in sorted(comuns) if vazio(i.get(c))]
    return erros


# Classes que aparecem ou não conforme a empresa (o dado), e não conforme o modelo: ficam fora do esqueleto.
CLASSES_DO_DADO = {"exemplo", "pior", "atual", "voces", "perde", "sem", "ok", "falta", "nc", "vive", "duvida", "nada",
                   "principal", "selo", "nao", "link-escuro", "leve", "plano-nao", "link-demo",
                   # a faixa da presença ("Pouco visível", "Em construção", "Bem visível"): o exemplo é "media",
                   # e um lead em outra faixa barrava sem motivo (Gaius Engenharia, 14/10/2026)
                   "faixa-baixa", "faixa-media", "faixa-alta"}


def esqueleto(doc: str) -> tuple[list[str], dict[str, int]]:
    """Os blocos da página, em ordem: cada classe que o modelo usa uma vez só (o veredito, a régua, a
    comparação, o convite do Mapa, a conversa…), e quantas seções e quantos detalhes abrem e fecham.
    Listas (pontos, buscas, avaliações) variam de tamanho e não entram; o bloco que as contém, sim."""
    marcas = []
    for tag, attrs in re.findall(r"<([a-z0-9]+)\b([^>]*)>", doc):
        m = re.search(r'\bclass="([^"]*)"', attrs)
        marcas += [f"{tag}.{c}" for c in (m.group(1).split() if m else []) if c not in CLASSES_DO_DADO]
    contagem = {"seções": len(re.findall(r"<section\b", doc)), "detalhes": len(re.findall(r"<details\b", doc))}
    return marcas, contagem


# Blocos que só existem com a ficha no Google: sem ela, o esqueleto não os cobra.
SO_COM_FICHA = {"ul.temas"}


def conferir_esqueleto(doc: str, modelo: str, fora: set[str] | frozenset = frozenset()) -> list[str]:
    """A página de um lead tem os mesmos blocos, na mesma ordem, da página do exemplo, feita agora pelo
    mesmo código. Um campo opcional esquecido no JSON (riscos, o que não recomendar, a comparação…)
    sumiria com um bloco sem erro nenhum; aqui, para."""
    ref, cont_ref = esqueleto(modelo)
    unicos = [x for x in ref if ref.count(x) == 1 and x not in fora]
    seq, cont = esqueleto(doc)
    seq = [x for x in seq if x in unicos]
    erros = [f"{k}: o exemplo tem {cont_ref[k]}, esta página tem {cont[k]}" for k in cont_ref if cont[k] != cont_ref[k]]
    faltam = [x for x in unicos if x not in seq]
    sobram = sorted({x for x in seq if seq.count(x) > 1})
    erros += [f"falta o bloco “{x}”, que o exemplo tem" for x in faltam]
    erros += [f"o bloco “{x}” aparece mais de uma vez" for x in sobram]
    if not (faltam or sobram) and seq != unicos:
        i = next(k for k, (a, b) in enumerate(zip(seq, unicos)) if a != b)
        erros.append(f"blocos fora da ordem do exemplo: “{seq[i]}” onde o exemplo tem “{unicos[i]}”")
    return erros


def barrar(nome: str, erros: list[str]) -> None:
    if erros:
        sys.exit(f"\n{nome}; nada foi gerado:\n  - " + "\n  - ".join(erros))
