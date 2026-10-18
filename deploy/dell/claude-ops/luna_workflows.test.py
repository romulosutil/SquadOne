import importlib.util
import json
from pathlib import Path
import unittest


def carregar(nome):
    spec = importlib.util.spec_from_file_location(nome, Path(__file__).with_name(nome + '.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Contrato(unittest.TestCase):
    def test_rejeita_comando_ferramenta_modelo_e_prompt_excessivo(self):
        m = carregar('luna_workflows')
        for extra in [{'model': 'outro'}, {'tools': ['terminal']}, {'command': 'rm'}]:
            with self.assertRaises(ValueError):
                m.validar_pedido({'tarefa': 'resumir', 'prompt': 'teste', **extra})
        for prompt in ['', 'á' * 30001, None]:
            with self.assertRaises(ValueError):
                m.validar_pedido({'tarefa': 'classificar', 'prompt': prompt})

    def test_classificacao_incompleta_ou_booleano_textual_falha_fechado(self):
        m = carregar('luna_workflows')
        for saida in ['{}', 'não sei', '{"e_estabelecimento":"true"}']:
            with self.assertRaises(ValueError):
                m.validar_saida('classificar', saida)
        self.assertEqual(m.validar_saida('resumir', 'Resumo')['content']['parts'][0]['text'], 'Resumo')

    def test_troca_so_cacador_preserva_prompt_e_nao_leva_segredo(self):
        m = carregar('workflow_luna')
        wf = {'name': '01 · Caçador', 'nodes': [{'name': 'Gemini: resumir avaliações',
            'type': '@n8n/n8n-nodes-langchain.googleGemini', 'parameters': {'messages': {'values': [{'content': '=Dados {{ $json.nome }}'}]}},
            'credentials': {'googlePalmApi': {'id': 'gemini'}}}]}
        saida = m.usar_luna(wf, 'credencial-n8n')
        n = saida['nodes'][0]
        self.assertEqual(n['parameters']['bodyParameters']['parameters'][1]['value'], '=Dados {{ $json.nome }}')
        self.assertNotIn('googlePalmApi', n['credentials'])
        self.assertEqual(m.usar_luna(saida, 'credencial-n8n'), saida)
        self.assertIn('googlePalmApi', wf['nodes'][0]['credentials'])


if __name__ == '__main__':
    unittest.main()
