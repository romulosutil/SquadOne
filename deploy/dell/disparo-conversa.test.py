"""Testes do disparo-conversa --do-dia: sem a lista do dia, nada sai. Nenhuma rede, nenhum arquivo real."""
import datetime as dt
import importlib.util
import io
import contextlib
import sys
import tempfile
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location('disparo', Path(__file__).with_name('disparo-conversa.py'))
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)


class DoDiaTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        m.LOG = Path(self.tmp.name)
        m.LISTAS = m.LOG / 'listas'
        self.chamadas = []
        # Qualquer acesso à Central ou à Evolution é falha do teste: sem lista, nada pode ser lido nem enviado.
        m.http = lambda *a, **k: self.chamadas.append(a) or (_ for _ in ()).throw(AssertionError('http chamado'))
        self.argv = sys.argv

    def tearDown(self):
        sys.argv = self.argv
        self.tmp.cleanup()

    def rodar(self, *args):
        sys.argv = ['disparo-conversa', *args]
        with contextlib.redirect_stdout(io.StringIO()) as saida:
            codigo = m.main()
        return codigo, saida.getvalue()

    def test_sem_lista_do_dia_nao_envia_e_sai_com_zero(self):
        codigo, saida = self.rodar('--do-dia', '--enviar')
        self.assertEqual(codigo, 0)
        self.assertIn('nada enviado', saida)
        self.assertEqual(self.chamadas, [])
        log = next(m.LOG.glob('*.jsonl')).read_text()
        self.assertIn('"sem-lista"', log)

    def test_a_lista_de_ontem_nao_vale_hoje(self):
        ontem = dt.datetime.now(m.SP).date() - dt.timedelta(days=1)
        m.LISTAS.mkdir(parents=True)
        m.lista_do_dia(ontem).write_text('{"lido_ate": "2026-10-28T22:45:00Z", "mensagens": [{"lead_id": "site:x", "texto": "oi"}]}')
        codigo, _ = self.rodar('--do-dia', '--enviar')
        self.assertEqual(codigo, 0)
        self.assertEqual(self.chamadas, [])

    def test_o_caminho_do_dia_e_fixo(self):
        self.assertEqual(m.lista_do_dia(dt.date(2026, 10, 29)), m.LISTAS / '2026-10-29.json')

    def test_sem_argumento_mostra_o_uso(self):
        codigo, saida = self.rodar()
        self.assertEqual(codigo, 2)
        self.assertIn('--do-dia', saida)


if __name__ == '__main__':
    unittest.main()
