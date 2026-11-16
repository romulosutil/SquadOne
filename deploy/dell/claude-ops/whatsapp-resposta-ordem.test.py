"""Replays e respostas atuais em nós JS reais, com planilhas fictícias e sem rede."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('conversa_fixture', Path(__file__).with_name('whatsapp-conversa.py'))
c = importlib.util.module_from_spec(spec); spec.loader.exec_module(c)


class OrdemDasRespostas(unittest.TestCase):
    def decidir(self, em, registrado, tipo='licenca', anterior='negativa', planilha='site'):
        linha = {'place_id': 'TESTE', 'nome': 'Empresa fictícia', 'status': 'recusado', 'resposta_tipo': anterior,
                 'resposta_em': registrado, 'ID': 'TESTE', 'Empresa': 'Empresa fictícia', 'Etapa': 'Sem interesse',
                 'Tipo da resposta': anterior, 'Resposta em': registrado}
        texto = {'licenca': 'Pode mandar o exemplo', 'negativa': 'Não tenho interesse', 'bot': 'Mensagem automática: escolha uma opção', 'neutra': 'Obrigado'}[tipo]
        m = {'mensagens': [{'em': em, 'texto': texto}], 'contexto': [{'quem': 'Rômulo', 'em': '2026-11-01T10:00:00Z', 'texto': 'Posso mandar um exemplo?'}],
             'achados': [{'planilha': planilha, 'linha': linha}]}
        resposta = {'content': {'parts': [{'text': json.dumps({'tipo': tipo})}]}, 'text': json.dumps({'tipo': tipo})}
        dados = {'Montar pergunta': m, 'Gemini: classificar resposta': resposta, 'Classificar resposta sem API': resposta}
        codigo = c.codigo_site_mensagem() + '\n' + c.DECIDIR_RESPOSTA_JS
        return c.rodar_js('const dados='+json.dumps(dados)+'; const $=n=>({first:()=>({json:dados[n]})});'
                          'console.log(JSON.stringify((()=>{'+codigo+'})().map(i=>i.json)));')

    def test_lote_antigo_nao_substitui_recusa_mais_recente_no_site(self):
        self.assertEqual(self.decidir('2026-10-30T12:00:00Z', '2026-11-13T12:00:00Z'), [{'planilha': 'nenhuma'}])

    def test_mesma_protecao_nas_ofertas_e_timezone_diferente(self):
        self.assertEqual(self.decidir('2026-11-13T10:00:00-0300', '2026-11-13T13:01:00Z', planilha='iris'), [{'planilha': 'nenhuma'}])

    def test_resposta_atual_e_gravada_com_hora_original(self):
        r = self.decidir('2026-11-13T14:00:00Z', '2026-11-13T13:00:00Z', tipo='negativa', anterior='licenca')
        self.assertEqual(r[0]['resposta_tipo'], 'negativa')
        self.assertEqual(r[0]['resposta_em'], '2026-11-13T14:00:00Z')
        self.assertEqual(r[0]['status'], 'recusado')

    def test_repeticao_no_mesmo_horario_ainda_pode_confirmar_persistencia(self):
        r = self.decidir('2026-11-13T14:00:00Z', '2026-11-13T14:00:00Z', tipo='negativa')
        self.assertEqual(r[0]['resposta_tipo'], 'negativa')

    def test_robo_e_agradecimento_nao_apagam_recusa(self):
        for tipo in ['bot', 'neutra']:
            self.assertEqual(self.decidir('2026-11-13T14:00:00Z', '2026-11-13T13:00:00Z', tipo=tipo), [{'planilha': 'nenhuma'}])


if __name__ == '__main__':
    unittest.main()
