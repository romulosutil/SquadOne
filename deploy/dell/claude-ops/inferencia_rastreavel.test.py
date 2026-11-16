import concurrent.futures
import datetime
import importlib.util
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
from unittest.mock import patch

from inferencia_rastreavel import Registro, chave


def luna():
    spec = importlib.util.spec_from_file_location('luna_medida', Path(__file__).with_name('luna_workflows.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


class Inferencia(unittest.TestCase):
    def setUp(self):
        # O serviço roda em Linux com tzdata. Windows sem pacote tzdata usa o
        # fuso fixo apenas neste teste, para não depender de instalação global.
        tz = patch('zoneinfo.ZoneInfo', return_value=datetime.timezone(datetime.timedelta(hours=-3)))
        tz.start()
        self.addCleanup(tz.stop)

    def test_hash_muda_com_contexto_modelo_e_tarefa(self):
        base = chave('luna', {'tarefa': 'resumir', 'prompt': 'a'})
        for modelo, dado in [('luna2', {'tarefa':'resumir','prompt':'a'}),
                             ('luna', {'tarefa':'classificar','prompt':'a'}),
                             ('luna', {'tarefa':'resumir','prompt':'b'})]:
            self.assertNotEqual(base, chave(modelo, dado))

    def test_cache_duravel_expira_e_nao_grava_prompt(self):
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as pasta:
            arquivo = Path(pasta) / 'estado.sqlite3'
            registro = Registro(arquivo)
            registro.guardar('hash', 'classificar', {'content':'ok'}, agora=100)
            self.assertEqual(Registro(arquivo).consultar('hash', agora=999), {'content':'ok'})
            self.assertIsNone(registro.consultar('hash', agora=1000))
            registro.medir('hash','classificar','luna',21,False,'sucesso',1)
            self.assertEqual(registro.resumo()[0]['chamadas_modelo'],1)
            with registro.conectar() as db:
                colunas = [l[1] for l in db.execute('PRAGMA table_info(chamadas)')]
            self.assertNotIn('prompt', colunas)

    def test_repeticao_concorrente_faz_uma_inferencia(self):
        m = luna()
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as pasta:
            base = Path(pasta)
            with patch.object(m,'BASE',base), patch.object(m,'PASTA',base/'isolada'), \
                 patch.object(m,'limpar_sessoes'), patch.object(m,'executar',return_value='Resumo') as executar:
                dado = {'tarefa':'resumir','prompt':'dados públicos'}
                with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
                    resultados = list(pool.map(lambda _: m.inferir(dado), range(5)))
                self.assertEqual(executar.call_count,1)
                self.assertEqual(sum(r['inferencia']['cache'] for r in resultados),4)
                # Sobrevive à recarga do módulo, sem memória de processo.
                outra = luna()
                with patch.object(outra,'BASE',base),patch.object(outra,'PASTA',base/'isolada'), \
                     patch.object(outra,'executar',side_effect=AssertionError('Não chamar')):
                    self.assertTrue(outra.inferir(dado)['inferencia']['cache'])
            resumo = Registro(base/'inferencia.sqlite3').resumo()
            self.assertEqual(sum(r['chamadas_modelo'] for r in resumo),1)
            self.assertEqual(sum(r['solicitacoes'] for r in resumo),6)

    def test_falha_nao_entra_no_cache_nem_vira_fallback(self):
        m = luna()
        with tempfile.TemporaryDirectory(dir=Path.cwd()) as pasta:
            base = Path(pasta)
            with patch.object(m,'BASE',base),patch.object(m,'PASTA',base/'isolada'), \
                 patch.object(m,'limpar_sessoes'),patch.object(m,'executar',side_effect=RuntimeError('falhou')) as executar:
                dado = {'tarefa':'resumir','prompt':'dados'}
                for _ in range(2):
                    with self.assertRaises(RuntimeError):
                        m.inferir(dado)
                self.assertEqual(executar.call_count,2)
                self.assertIsNone(Registro(base/'inferencia.sqlite3').consultar(chave(m.MODELO,dado)))


if __name__ == '__main__':
    unittest.main()
