import copy
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('filtro', Path(__file__).with_name('filtro_leads.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
NOW = dt.datetime(2026, 10, 26, 22, tzinfo=dt.timezone.utc)


def lead(i=1, nicho='advocacia', classe='silencio', idade=72):
    return {'id': f'site:{i}', 'produto': 'site', 'empresa': 'Empresa', 'nicho': nicho,
            'marcos': {'enviado': (NOW-dt.timedelta(hours=idade)).isoformat()},
            'classificacaoResposta': {'classe': classe}, 'achados': [{'id': 'sem-site'}],
            'links': {'whatsapp': f'https://wa.me/551199{i:07d}'}}


def qualificar(l):
    l['spiced'] = {'dor': 'Pedidos perdidos', 'impacto': 'Perde horas de trabalho',
                   'decisao': {'decisor_confirmado': 'sim', 'quem': 'Responsável'}}
    return l


class Curadoria(unittest.TestCase):
    def test_recusa_nao_e_apagada_por_agradecimento(self):
        l = lead(classe='neutra'); l['conversa'] = {'sinaisComerciais': {'restricao': {'tipo': 'recusa'}}}
        self.assertEqual(m.resultado(l, NOW), 'recusa')
        self.assertEqual(m.avaliar(l)['decisao'], 'revisar')

    def test_silencio_robo_acesso_permissao_nao_sao_negativos(self):
        ls = [lead(i, classe=c) for i, c in enumerate(['silencio', 'robo', 'acesso', 'permissao', 'interesse'], 1)]
        modelo, _ = m.aprender(ls, NOW)
        self.assertEqual(modelo['rotulados'], 0)
        self.assertEqual(modelo['padroes'], [])

    def test_encaminhamento_nao_e_apagado_por_agradecimento(self):
        l = lead(classe='neutra'); l['classificacaoResposta']['houveRespostaHumana'] = True
        l['conversa'] = {'recentes': [{'direcao': 'entrada', 'em': NOW.isoformat(), 'trecho': 'Ele é a pessoa que cuida da divulgação da empresa.'}]}
        self.assertEqual(m.resultado(l, NOW), 'acesso')

    def test_hoje_nao_treina_mesmo_com_recusa(self):
        modelo, _ = m.aprender([lead(classe='recusa', idade=2)], NOW)
        self.assertEqual(modelo['maduros'], 0)
        self.assertEqual(modelo['rotulados'], 0)

    def test_menos_de_dez_abstem(self):
        ls = [qualificar(lead(i, 'dedetizadora')) for i in range(1, 10)] + [lead(i, classe='recusa') for i in range(20, 40)]
        self.assertEqual(m.aprender(ls, NOW)[0]['padroes'], [])

    def test_aprende_avanco_nao_taxa_de_resposta(self):
        ls = [qualificar(lead(i, 'dedetizadora')) for i in range(1, 21)] + [lead(i, classe='recusa') for i in range(30, 50)]
        modelo, _ = m.aprender(ls, NOW)
        self.assertEqual(m.avaliar(lead(99, 'dedetizadora'), modelo)['ajuste'], 5)
        negativo = m.avaliar(lead(100), modelo)
        self.assertEqual(negativo['ajuste'], -5)
        self.assertEqual(negativo['decisao'], 'apto', 'Nenhum veto aprendido por setor')

    def test_grupos_sem_diferenca_abstem(self):
        ls = [qualificar(lead(i, 'dedetizadora' if i < 20 else 'advocacia')) for i in range(1, 40)]
        self.assertEqual(m.aprender(ls, NOW)[0]['padroes'], [])

    def test_fonte_sem_qualificacao_nao_vira_venda(self):
        l = lead(classe='interesse'); l['etapa'] = 'ganho'
        self.assertEqual(m.resultado(l, NOW), 'interesse')
        l['spiced'] = {'dor': 'a confirmar', 'impacto': 'pendente', 'decisao': {'decisor_confirmado': 'sim', 'quem': 'Alguém'}}
        self.assertFalse(m.qualificado(l))

    def test_pagamento_precisa_ser_posterior_ao_contato(self):
        l = lead(); l['aarr'] = {'pagamentos': [{'em': (NOW-dt.timedelta(days=9)).isoformat()}]}
        self.assertEqual(m.resultado(l, NOW), 'silencio')
        l['aarr']['pagamentos'] = [{'em': NOW.isoformat()}]
        self.assertEqual(m.resultado(l, NOW), 'pagamento')

    def test_nao_duplica_maturacao_entre_dias(self):
        l = lead(); a, memoria = m.aprender([l, copy.deepcopy(l)], NOW)
        b, _ = m.aprender([l], NOW+dt.timedelta(days=1), memoria=memoria)
        self.assertEqual(a['casos'], 1); self.assertEqual(b['casos'], 1)

    def test_multiplas_ofertas_mesmo_numero_nao_contaminam(self):
        a = lead(); b = copy.deepcopy(a); b.update(id='iris:2', produto='iris')
        modelo, _ = m.aprender([a, b], NOW)
        self.assertEqual(modelo['ambiguosExcluidos'], 1); self.assertEqual(modelo['casos'], 0)

    def test_demo_sob_demanda_permitida_mas_afirmacao_sem_prova_aguarda(self):
        l = lead()
        self.assertEqual(m.avaliar(l, texto='Posso preparar uma demonstração?')['decisao'], 'apto')
        self.assertEqual(m.avaliar(l, texto='Montei uma demonstração de site')['decisao'], 'revisar')
        l['links']['site'] = 'https://demo.example.org'
        self.assertEqual(m.avaliar(l, texto='Montei uma demonstração de site')['decisao'], 'apto')

    def test_numero_confirmado_sem_whatsapp_bloqueia_todas_ofertas(self):
        l = lead(); modelo, _ = m.aprender([], NOW, [{'chave': m.chave(l), 'estado': 'sem_whatsapp'}])
        self.assertEqual(m.avaliar(l, modelo)['decisao'], 'revisar')
        modelo, _ = m.aprender([], NOW, [{'chave': m.chave(l), 'estado': 'incerto'}])
        self.assertEqual(m.avaliar(l, modelo)['decisao'], 'apto')

    def test_perfil_iris_e_qualificacao_estampa(self):
        l = lead(); l.update(produto='iris', nicho='saúde', empresa='Clínica')
        self.assertEqual(m.avaliar(l)['decisao'], 'revisar')
        l['triagem'] = {'sinais': 'atendimento infantil TEA'}
        self.assertEqual(m.avaliar(l)['decisao'], 'apto')
        l['produto'] = 'estampa'
        self.assertEqual(m.avaliar(l)['decisao'], 'revisar')
        self.assertEqual(m.avaliar(qualificar(l))['decisao'], 'apto')

    def test_modelo_vencido_e_rejeitado_hash_estavel(self):
        a, _ = m.aprender([], NOW); b, _ = m.aprender([], NOW+dt.timedelta(hours=1))
        self.assertEqual(a['hash'], b['hash'])
        with tempfile.TemporaryDirectory() as d:
            p = Path(d)/'modelo.json'; p.write_text(json.dumps(a), encoding='utf-8')
            self.assertEqual(m.carregar_modelo(p, NOW)['hash'], a['hash'])
            with self.assertRaises(ValueError): m.carregar_modelo(p, NOW+dt.timedelta(hours=31))

    def test_memoria_preserva_perfil_observado_antes_do_contato(self):
        l = lead(); l['marcos'] = {}
        _, memoria = m.aprender([l], NOW)
        l['nicho'] = 'dedetizadora'; l['marcos']['enviado'] = (NOW-dt.timedelta(hours=72)).isoformat()
        modelo, _ = m.aprender([l], NOW, memoria=memoria)
        self.assertEqual(modelo['coortes'][0]['valor'], 'advocacia')


if __name__ == '__main__': unittest.main()
