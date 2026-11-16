"""Isolated tests: no Central, Sheets, or WhatsApp request is performed."""
import datetime as dt
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('frente', Path(__file__).with_name('frente-comercial.py'))
f = importlib.util.module_from_spec(spec)
spec.loader.exec_module(f)


def lead():
    return {'id': 'site:teste', 'produto': 'site', 'empresa': 'Teste', 'etapa': 'novo', 'sinal': 'pronto',
            'marcos': {}, 'achados': [{'id':'sem-site'}], 'mensagemPronta': 'Olá, posso apresentar?',
            'links': {'whatsapp': 'https://wa.me/5511998887766', 'enviar': 'https://mel.test/webhook/enviar'}}


class Revalidacao(unittest.TestCase):
    def check(self, atual, extra=(), config=None):
        original = lead()
        with tempfile.TemporaryDirectory() as tmp, patch.object(f, 'H', Path(tmp)), \
             patch.object(f, 'ler_config', return_value=config or {'ativo': True}), \
             patch.object(f, 'ler_crm', return_value={'leads': [atual, *extra]}):
            return f.revalidar_antes_do_envio(original, original['mensagemPronta'])

    def test_contexto_preservado(self): self.assertTrue(self.check(lead()))
    def test_assumir_interrompe(self): self.assertFalse(self.check(lead() | {'responsavelConversa': {'responsavel': 'romulo'}}))
    def test_proximo_passo_interrompe(self): self.assertFalse(self.check(lead() | {'proximoPasso': {'texto': 'Aguardar'}}))
    def test_saida_ou_resposta_nova_interrompe(self): self.assertFalse(self.check(lead() | {'conversa': {'mensagens': 1}}))
    def test_mensagem_alterada_interrompe(self): self.assertFalse(self.check(lead() | {'mensagemPronta': 'Novo texto'}))
    def test_numero_alterado_interrompe(self):
        self.assertFalse(self.check(lead() | {'links': lead()['links'] | {'whatsapp': 'https://wa.me/5511998887700'}}))
    def test_outra_oferta_mesma_conversa_humana_interrompe(self):
        self.assertFalse(self.check(lead(), [lead() | {'id': 'prumo:outro', 'responsavelConversa': {'responsavel': 'romulo'}}]))
    def test_pausa_global_interrompe(self): self.assertFalse(self.check(lead(), config={'ativo': False}))
    def test_pausa_temporaria_interrompe(self):
        futuro = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat()
        self.assertFalse(self.check(lead(), config={'ativo': True, 'pausadoAte': futuro}))


if __name__ == '__main__': unittest.main()
