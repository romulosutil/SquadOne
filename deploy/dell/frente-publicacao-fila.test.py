"""A reserva lê a fila publicada; candidato novo não pode esperar outro ciclo."""
import importlib.util
import json
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('fixture_frente', Path(__file__).with_name('frente-comercial.test.py'))
base = importlib.util.module_from_spec(spec); spec.loader.exec_module(base)


class Publicacao(unittest.TestCase):
    def test_fila_vazia_nao_exibe_um_horario_de_envio_ficticio(self):
        caso = base.Frente()
        caso.setUp()
        try:
            resultado = caso.rodar({'estado': 'ok', 'leads': []}, lambda _: self.fail('fila vazia não reserva'))
            self.assertEqual(resultado.estados[-1]['estado'], 'concluido')
            self.assertIsNone(resultado.estados[-1].get('proximoEnvioEm'))
            resultado.envio.assert_not_called()
        finally:
            caso.doCleanups()

    def test_novo_aprovado_e_publicado_antes_da_primeira_reserva(self):
        caso = base.Frente()
        caso.setUp()
        try:
            arquivo = caso.data/'fila-que-a-central-le.json'
            def publicar(estado):
                arquivo.write_text(json.dumps(estado))
            def reservar(lead):
                estado = json.loads(arquivo.read_text())
                fila = {l['id']: l['estado'] for l in estado['fila']}
                return {'reservado': fila.get(lead['id']) == 'pronto', 'texto': base.MSG,
                        'motivo': 'nao-e-do-time'}
            resultado = caso.rodar({'estado': 'ok', 'leads': [base.lead()]}, reservar, publicar=publicar)
            self.assertEqual(resultado.envio.call_count, 1, 'a primeira rodada já deve conseguir reservar o aprovado')
            self.assertEqual(resultado.reservar.call_count, 1)
            self.assertEqual(resultado.estados[-1]['enviados'], 1)
        finally:
            caso.doCleanups()


if __name__ == '__main__': unittest.main()
