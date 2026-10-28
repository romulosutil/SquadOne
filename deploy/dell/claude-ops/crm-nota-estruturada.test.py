"""Executa só o VALIDAR_JS de crm.py: sem publicar, rede ou planilhas."""
import importlib.util
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def validar_js():
    """VALIDAR_JS montado por crm.py (a lista de produtos vem de prumo-ofertas.json desde 28/10/2026).
    crm.py lê a chave do n8n ao importar: HOME temporário com uma chave falsa; nada é chamado."""
    with tempfile.TemporaryDirectory() as tmp:
        chave = Path(tmp) / '.config/claude-ops/n8n-api-key'
        chave.parent.mkdir(parents=True); chave.write_text('fixture-sem-acesso')
        with patch.object(Path, 'home', return_value=Path(tmp)):
            spec = importlib.util.spec_from_file_location('crm_fixture_validar', Path(__file__).with_name('crm.py'))
            m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    return m.VALIDAR_JS


VALIDAR = validar_js()


def validar_nota(texto):
    corpo = {'produto': 'site', 'id': 'FICTICIO', 'tipo': 'nota', 'texto': texto, 'data': ''}
    programa = (
        "const b=JSON.parse(require('node:fs').readFileSync(0,'utf8'));"
        "const $=()=>({first:()=>({json:{body:b}})});"
        "const resultado=new Function('$'," + json.dumps(VALIDAR) + ")($);"
        "console.log(JSON.stringify(resultado[0].json));"
    )
    processo = subprocess.run(['node', '-e', programa], input=json.dumps(corpo),
                              capture_output=True, text=True, encoding='utf-8', check=True)
    return json.loads(processo.stdout)


def nota_no_limite(prefixo, tamanho):
    esqueleto = prefixo + json.dumps({'v': 1, 'id': 'fato-ficticio', 'evidencia': ''}, separators=(',', ':'))
    return esqueleto[:-2] + 'x' * (tamanho - len(esqueleto)) + esqueleto[-2:]


class IntegridadeDaNota(unittest.TestCase):
    def test_json_estruturado_longo_e_recusado_antes_de_cortar(self):
        for prefixo in ['[ciclo-comercial-v1] ', '[qualificacao-comercial-v1] ', '[responsavel-conversa-v1] ']:
            with self.subTest(prefixo=prefixo):
                texto = nota_no_limite(prefixo, 1001)
                self.assertEqual(len(texto), 1001)
                json.loads(texto[len(prefixo):])
                resultado = validar_nota(texto)
                self.assertFalse(resultado['ok'])
                self.assertNotIn('linha', resultado, 'recusa não pode gerar linha para append')
                self.assertIn('1000', resultado['erro'])

    def test_limite_exato_preserva_nota_inteira_sem_criar_colunas(self):
        texto = nota_no_limite('[ciclo-comercial-v1] ', 1000)
        resultado = validar_nota(texto)
        self.assertTrue(resultado['ok'])
        self.assertEqual(resultado['linha']['texto'], texto)
        self.assertEqual(resultado['linha']['tipo'], 'nota')
        self.assertEqual(set(resultado['linha']), {'em', 'produto', 'id', 'empresa', 'tipo', 'texto', 'data', 'origem'})

    def test_limite_e_em_unidades_do_javascript_inclusive_unicode(self):
        texto = '[ciclo-comercial-v1] ' + json.dumps({'evidencia': '🙂' * 500}, ensure_ascii=False)
        self.assertLess(len(texto), 1000)
        self.assertGreater(len(texto.encode('utf-16-le')) // 2, 1000)
        self.assertFalse(validar_nota(texto)['ok'])

    def test_nota_simples_valida_preserva_texto_e_longa_nao_e_truncada(self):
        texto = 'Condição histórica conferida pelo operador.'
        self.assertEqual(validar_nota(texto)['linha']['texto'], texto)
        self.assertFalse(validar_nota('x' * 1001)['ok'])
        self.assertFalse(validar_nota('')['ok'])
        self.assertFalse(validar_nota({'id': 'ficticio'})['ok'])


if __name__ == '__main__':
    unittest.main()
