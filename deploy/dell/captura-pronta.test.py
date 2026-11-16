import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock
from captura_pronta import preparar_captura


class CapturaPronta(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.arquivo = self.home / '.local/state/whatsapp-observador-prumo/leads.json'
        self.arquivo.parent.mkdir(parents=True)

    def gravar(self, chaves):
        self.arquivo.write_text(json.dumps(chaves))

    def test_lead_presente_nao_reinicia_nem_altera_lista(self):
        self.gravar(['2799999999']); antes = self.arquivo.read_bytes(); reiniciar = Mock()
        self.assertTrue(preparar_captura('2799999999', self.home, reiniciar))
        reiniciar.assert_not_called(); self.assertEqual(antes, self.arquivo.read_bytes())

    def test_lead_novo_so_libera_apos_observador_carregar_fonte(self):
        self.gravar(['2788888888'])
        reiniciar = Mock(side_effect=lambda: self.gravar(['2788888888', '2799999999']))
        self.assertTrue(preparar_captura('2799999999', self.home, reiniciar))
        reiniciar.assert_called_once()

    def test_lista_sem_lead_nao_e_fabricada_para_liberar(self):
        self.gravar(['2788888888']); antes = self.arquivo.read_bytes()
        self.assertFalse(preparar_captura('2799999999', self.home, Mock(), prazo=0))
        self.assertEqual(antes, self.arquivo.read_bytes())

    def test_lista_corrompida_ou_ausente_nao_libera(self):
        self.assertFalse(preparar_captura('2799999999', self.home, Mock(), prazo=0))
        self.arquivo.write_text('{')
        self.assertFalse(preparar_captura('2799999999', self.home, Mock(), prazo=0))

    def test_servico_indisponivel_nao_libera(self):
        self.assertFalse(preparar_captura('2799999999', self.home, Mock(side_effect=OSError), prazo=0))

    def test_lista_antiga_nao_e_prontidao(self):
        self.gravar(['2799999999'])
        self.assertFalse(preparar_captura('2799999999', self.home, Mock(), relogio=lambda: self.arquivo.stat().st_mtime + 1801, prazo=0))


if __name__ == '__main__':
    unittest.main()
