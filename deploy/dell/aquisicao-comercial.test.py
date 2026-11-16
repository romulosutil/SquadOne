import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import sys
import types
import datetime
from unittest.mock import patch

import aquisicao_comercial as politica

if sys.platform == 'win32':
    sys.modules.setdefault('fcntl', types.ModuleType('fcntl'))
spec = importlib.util.spec_from_file_location('frente_aquisicao', Path(__file__).with_name('frente-comercial.py'))
frente = importlib.util.module_from_spec(spec)
with patch('zoneinfo.ZoneInfo', return_value=datetime.timezone.utc) if sys.platform == 'win32' else patch.dict('os.environ', {}):
    spec.loader.exec_module(frente)


class Aquisicao(unittest.TestCase):
    def test_arquivo_ausente_invalido_e_tentativa_de_liberacao_bloqueiam(self):
        with tempfile.TemporaryDirectory() as temp:
            arquivo = Path(temp) / 'politica.json'
            for valor in (None, '{', json.dumps({'versao': 1, 'estado': 'liberado'}), json.dumps({'versao': 1, 'estado': 'bloqueado', 'motivo': politica._MOTIVO})):
                if valor is not None:
                    arquivo.write_text(valor, encoding='utf-8')
                self.assertTrue(politica.bloqueio_aquisicao(arquivo)['bloqueado'])
        self.assertEqual(politica.bloqueio_aquisicao(), {'bloqueado': True, 'motivo': 'operacao-preparada-aguardando-retomada'})
        with tempfile.TemporaryDirectory() as temp:
            arquivo = Path(temp) / 'politica.json'
            for respostas in (True, None, 'false'):
                arquivo.write_text(json.dumps({'versao': 2, 'estado': 'primeiro-contato', 'respostasAutomaticas': respostas}), encoding='utf-8')
                self.assertTrue(politica.bloqueio_aquisicao(arquivo)['bloqueado'])

    def test_barreira_final_impede_transporte_apos_reserva(self):
        with patch.object(frente, 'bloqueio_aquisicao', return_value={'bloqueado': True}), patch.object(frente, 'http') as http:
            self.assertFalse(frente.revalidar_antes_do_envio({}, 'texto'))
            with self.assertRaisesRegex(RuntimeError, 'Aquisição comercial bloqueada'):
                frente.enviar({}, 'texto', {})
            http.assert_not_called()


if __name__ == '__main__':
    unittest.main()
