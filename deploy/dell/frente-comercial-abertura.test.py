"""Teste puro da anotação pós-recibo: sem importar o executor Linux nem chamar a rede."""
import ast
import json
from pathlib import Path
import unittest

fonte = Path(__file__).with_name('frente-comercial.py').read_text(encoding='utf-8')
funcao = next(n for n in ast.parse(fonte).body if isinstance(n, ast.FunctionDef) and n.name == 'anotar_na_central')

class AberturaConfirmada(unittest.TestCase):
    def registrar(self, produto='prumo', texto='MENSAGEM', preview='MENSAGEM', abordagem=None):
        chamadas = []
        namespace = {'json': json, 'CENTRAL': 'http://central-ficticia', 'ORIGEM': {}, 'iso': lambda: '2026-10-19T20:00:00Z',
                     'texto_do_lead': lambda l: preview, 'http': lambda url, body, headers, timeout: chamadas.append(body)}
        exec(compile(ast.Module(body=[funcao], type_ignores=[]), '<anotacao-isolada>', 'exec'), namespace)
        lead = {'id': f'{produto}:teste', 'produto': produto, 'abordagem': abordagem or {'mensagem': 'D', 'elegiveis': 'AD'}}
        self.assertTrue(namespace['anotar_na_central'](lead, texto, '2026-10-19T20:00:00Z'))
        return json.loads(chamadas[0]['texto'].split('\n', 1)[1])
    def test_so_conteudo_confirmado_igual_ao_preview_guarda_o_braco(self):
        self.assertEqual(self.registrar()['abertura'], {'mensagem_variante': 'D', 'ab_elegiveis': 'AD'})
        self.assertNotIn('abertura', self.registrar(texto='MENSAGEM EDITADA'))
    def test_nao_inventa_braco_para_outra_oferta_ou_metadata_invalida(self):
        for produto in ('iris', 'estampa'):
            self.assertNotIn('abertura', self.registrar(produto=produto))
        self.assertNotIn('abertura', self.registrar(abordagem={'mensagem': 'D', 'elegiveis': 'A'}))

if __name__ == '__main__': unittest.main()
