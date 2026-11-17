import datetime as dt
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import prospeccao_diaria as p

ID = 'ChIJexemploteste1234567890'
URL = 'https://www.google.com/maps/place/Exemplo/data=!19s'+ID
DOM = ('<h1>Empresa Exemplo</h1><span>'+ID+'</span>'
       '<button data-item-id="phone:tel:11999991111" aria-label="Telefone: (11) 99999-1111"></button>'
       '<button data-item-id="address" aria-label="Endereço: Rua Exemplo"></button>'
       '<button data-item-id="oh" aria-label="Aberto"></button>')


class Diaria(unittest.TestCase):
    def test_resultados_somente_fonte_permitida_e_place_id_sem_duplicata(self):
        dom = ''.join('<a href="'+u+'">Empresa</a>' for u in [URL, URL, URL.replace('www.google.com', 'evil.example')])
        self.assertEqual(p.resultados(dom), [(ID, URL)])

    def test_perfil_completo_sem_site_produz_so_hipotese(self):
        perfil = p.extrair(DOM, ID, URL)
        self.assertEqual(perfil['achados'], [{'id': 'sem-site'}])
        self.assertIn('Hoje, tem alguma dificuldade', p.mensagem(perfil['tipoSite']))
        self.assertNotIn('não tem site', p.mensagem(perfil['tipoSite']))

    def test_site_proprio_perfil_parcial_id_diferente_ou_fechado_nao_entram(self):
        for dom in [DOM+'<a data-item-id="authority" href="https://empresa.example">Site</a>',
                    DOM.replace('data-item-id="oh"', 'data-item-id="outro"'),
                    DOM.replace('phone:tel:', 'outro:'), DOM.replace(ID, 'outra-empresa'),
                    DOM+'Fechado permanentemente']:
            self.assertIsNone(p.extrair(dom, ID, URL))

    def test_destino_ambiguo_nao_entra(self):
        dom = DOM+'<button data-item-id="phone:tel:11988882222" aria-label="Telefone: 11 98888-2222"></button>'
        self.assertIsNone(p.extrair(dom, ID, URL))

    def test_pesquisa_minima_aceita_site_sem_inventar_ausencia_ou_necessidade(self):
        dom = DOM+'<a data-item-id="authority" href="https://empresa.example">Site</a>'
        perfil = p.extrair(dom, ID, URL, aceitar_site_proprio=True)
        self.assertEqual(perfil['tipoSite'], 'site-proprio-no-perfil')
        self.assertEqual(perfil['achados'], [{'id': 'site-proprio-publicado'}])
        self.assertEqual(p.mensagem(perfil['tipoSite']), p.mensagem('sem-link-de-site-no-perfil'))

    def test_pesquisa_independente_nao_exige_campanha_ativa(self):
        config = {'ativo':True,'versao':1,'estoqueAlvo':6,'aceitarSiteProprio':True}
        with patch('mensagem_inicial.pesquisa',return_value=config), patch('campanha_site.ler',return_value={'ativo':False}), patch('calendario_comercial.proximo_expediente',side_effect=RuntimeError('chegou-a-pesquisa')):
            with self.assertRaisesRegex(RuntimeError,'chegou-a-pesquisa'):
                p._executar(somente_pesquisa=True)

    def test_layout_atual_de_horarios_sem_item_oh_e_aceito(self):
        dom = DOM.replace('<button data-item-id="oh" aria-label="Aberto"></button>',
                          '<div role="button" jsaction="pane.openhours.wfvdle23.dropdown; keydown:pane.openhours.wfvdle23.dropdown"><span>Aberto</span></div>')
        self.assertIsNotNone(p.extrair(dom, ID, URL))
        # Horário em outro texto não comprova que o perfil terminou de carregar.
        self.assertIsNone(p.extrair(dom.replace('pane.openhours.', 'pane.outro.'), ID, URL))
        self.assertIsNone(p.extrair(dom.replace('phone:tel:', 'outro:'), ID, URL))

    def test_categoria_publica_e_transmitida_com_origem_sem_confirmar_atividade(self):
        dom = DOM+'<button jsaction="pane.wfvdle15.category">Pintor <span>residencial</span></button><p>Outra categoria</p>'
        perfil = p.extrair(dom, ID, URL)
        self.assertEqual(perfil['categoria'], 'Pintor residencial')
        now = dt.datetime.fromisoformat('2026-11-12T12:00:00-03:00')
        with tempfile.TemporaryDirectory() as temp, patch.object(p, 'H', Path(temp)):
            pasta = p.materializar(perfil, 'pintor em Cidade', 'Cidade', now)
            dados = json.loads((pasta/'raio-x-pesquisa-complementar.json').read_text())
            self.assertIn('Pintor residencial', dados['observacoes'][0])
            self.assertEqual(dados['fontes'][0]['url'], URL)
            from campanha_site import complemento_publico
            publico = complemento_publico(dados, ID, now)
            self.assertIsNotNone(publico)
            self.assertIn('não confirma atividade atual', publico['observacoes'][1])
            self.assertNotIn('5511999991111', json.dumps(publico))

    def test_campo_site_whatsapp_tem_texto_correspondente(self):
        dom = DOM+'<a data-item-id="authority" href="https://wa.me/5511999991111">Site</a>'
        perfil = p.extrair(dom, ID, URL)
        self.assertEqual(perfil['achados'], [{'id': 'site-e-rede-social'}])
        self.assertIn('organização do atendimento', p.mensagem(perfil['tipoSite']))
        self.assertNotIn('levava ao WhatsApp', p.mensagem(perfil['tipoSite']))

    def test_materializa_sem_demo_ou_publicacao_inventada_e_preserva_data(self):
        perfil = p.extrair(DOM, ID, URL); now = dt.datetime.fromisoformat('2026-11-12T12:00:00-03:00')
        with tempfile.TemporaryDirectory() as temp, patch.object(p, 'H', Path(temp)):
            pasta = p.materializar(perfil, 'setor em cidade', 'Cidade', now)
            self.assertFalse((pasta/'publicado.json').exists())
            dados = json.loads((pasta/'raio-x-places.json').read_text())
            self.assertEqual(dados['lido_em'], now.isoformat())
            self.assertEqual(dados['detalhes']['status'], 'NAO_CONFIRMADO')
            pesquisa = json.loads((pasta/'raio-x-pesquisa-gratuita.json').read_text())
            self.assertEqual(pesquisa['fontes'], [{'url': URL, 'em': now.isoformat()}])
            # Queda antes do append pode retomar o mesmo candidato, sem criar outra pasta.
            self.assertEqual(p.materializar(perfil, 'setor em cidade', 'Cidade', now), pasta)
            (pasta/'publicado.json').write_text('{}')
            with self.assertRaises(ValueError): p.materializar(perfil, 'setor em cidade', 'Cidade', now)

    def test_fonte_privada_ou_externa_e_recusada_antes_do_browser(self):
        with patch.object(p.subprocess, 'run') as run:
            for url in ['http://www.google.com/maps/teste', 'https://127.0.0.1/maps/teste', 'https://www.google.com.evil/maps/teste']:
                with self.assertRaises(ValueError): p.ler_dom(url)
            run.assert_not_called()


if __name__ == '__main__':
    unittest.main()
