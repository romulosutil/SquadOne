"""Aplica somente o delta da curadoria, conservando a versão instalada do executor."""
from pathlib import Path
import sys


def aplicar(texto):
    if 'def parecer_curadoria(' in texto:
        raise ValueError('Curadoria já integrada; conferir versão antes de repetir')
    def substituir(antes, depois):
        nonlocal texto
        if texto.count(antes) != 1:
            raise ValueError('Âncora ausente ou ambígua: '+antes[:70])
        texto = texto.replace(antes, depois, 1)
    substituir("VERSAO_AVALIACAO = 'justificativa-comercial-v3-20261026'", "VERSAO_AVALIACAO = 'marina-curadoria-v1-20261026'")
    substituir('def iso(now=None):', '''_MODELO_CURADORIA = None
_LIB_CURADORIA = None


def lib_curadoria():
    global _LIB_CURADORIA
    if _LIB_CURADORIA is None:
        arquivo = Path(__file__).resolve().parent / 'filtro_leads.py'
        spec = importlib.util.spec_from_file_location('marina_filtro_leads', arquivo)
        modulo = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(modulo)
        _LIB_CURADORIA = modulo
    return _LIB_CURADORIA


def parecer_curadoria(l):
    return lib_curadoria().avaliar(l, _MODELO_CURADORIA, texto_do_lead(l))


def iso(now=None):''')
    substituir("    return j['porQueComprar']", "    p=parecer_curadoria(l)\n    return j['porQueComprar']+' Marina: perfil e coerência da mensagem conferidos; ajuste histórico '+str(p['ajuste'])+' (não é probabilidade de venda).'" )
    substituir('    return fonte\n', "    return fonte + parecer_curadoria(l)['ajuste']\n")
    substituir('def elegivel(lead):\n', "def elegivel(lead):\n    if parecer_curadoria(lead)['decisao'] != 'apto': return False\n")
    substituir("    dados['mensagemAvaliada']=texto_do_lead(l)", "    dados['mensagemAvaliada']=texto_do_lead(l)\n    dados['curadoria']=parecer_curadoria(l)")
    entrada_rodada = 'def _rodada(estado, now, alvo, dia_):\n' if 'def _rodada(' in texto else 'def rodada():\n'
    substituir(entrada_rodada, entrada_rodada+'    global _MODELO_CURADORIA\n')
    substituir('        crm=ler_crm()\n', "        crm=ler_crm()\n        _MODELO_CURADORIA=lib_curadoria().carregar_modelo(H/'.local/share/curadoria-leads/modelo.json',now)\n")
    substituir("    c = http('http://127.0.0.1:9120/api/operations/crm')", "    c = http('http://127.0.0.1:9120/api/operations/crm', timeout=90)")
    substituir('            lote=candidatos[inicio:inicio+20];anteriores={}', '            lote=candidatos[inicio:inicio+20];anteriores={};lote_incompleto=False')
    substituir("                    registro.consumir_ia(dia(now));resultado=inferir(agente,especialidade,faltam,{},estado['funil'],taxas)", """                    registro.consumir_ia(dia(now))
                    try:resultado=inferir(agente,especialidade,faltam,{},estado['funil'],taxas)
                    except ValueError:
                        # Um parecer fora do contrato não aprova o lote nem derruba os já aprovados.
                        estado['lotesEmRevisao']=estado.get('lotesEmRevisao',0)+1
                        lote_incompleto=True;break""")
    substituir('            if sem_orcamento:break', '            if sem_orcamento:break\n            if lote_incompleto:continue')
    # Os pareceres continuam com nota mínima 65: aprendizado só ordena quem já passou.
    substituir("        estado['fila']=intercalar_ofertas(anteriores_validos+nova,lambda l:l['nota'])[:100]" if 'anteriores_validos+nova' in texto else "        estado['fila']=intercalar_ofertas(nova,lambda l:l['nota'])[:100]",
               "        estado['fila']=intercalar_ofertas(anteriores_validos+nova,lambda l:l['nota']+parecer_curadoria(atuais_do_plano[l['id']])['ajuste'] if l['id'] in atuais_do_plano else l['nota'])[:100]" if 'anteriores_validos+nova' in texto else
               "        estado['fila']=intercalar_ofertas(nova,lambda l:l['nota']+parecer_curadoria(atuais_do_plano[l['id']])['ajuste'])[:100]")
    return texto


if __name__ == '__main__':
    origem, destino = map(Path, sys.argv[1:])
    destino.write_text(aplicar(origem.read_text(encoding='utf-8-sig')), encoding='utf-8', newline='\n')
