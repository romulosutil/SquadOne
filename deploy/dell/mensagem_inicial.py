"""Abertura canônica; carregar configuração não envia, reserva ou altera contatos."""
import json
from pathlib import Path

def configuracao(nome):
    local = Path(__file__).with_name(nome)
    arquivo = local if local.exists() else Path(__file__).resolve().parents[2] / 'config' / nome
    return json.loads(arquivo.read_text(encoding='utf-8'))

def mensagem():
    c = configuracao('mensagem-inicial.json')
    if c.get('versao') != 'prumo-necessidade-v1-20261116' or not isinstance(c.get('texto'), str) or not 30 <= len(c['texto']) <= 700 or 'http' in c['texto'] or '{' in c['texto']:
        raise ValueError('Abertura do Prumo inválida')
    return c['texto']

def pesquisa():
    c = configuracao('pesquisa-comercial.json')
    if c.get('versao') != 1 or type(c.get('ativo')) is not bool or type(c.get('aceitarSiteProprio')) is not bool or type(c.get('estoqueAlvo')) is not int or not 1 <= c['estoqueAlvo'] <= 10:
        raise ValueError('Configuração de pesquisa inválida')
    return c
