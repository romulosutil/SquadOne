"""Confere o cadastro real no capturador antes do transporte; não escreve listas."""
import json
from pathlib import Path
import subprocess
import time


def preparar_captura(chave, home=None, reiniciar=None, relogio=time.time, esperar=time.sleep, prazo=25):
    arquivo = (home or Path.home()) / '.local/state/whatsapp-observador-prumo/leads.json'

    def presente():
        try:
            idade = relogio() - arquivo.stat().st_mtime
            dados = json.loads(arquivo.read_text())
            return 0 <= idade <= 30 * 60 and isinstance(dados, list) and chave in dados
        except (OSError, ValueError):
            return False

    if presente():
        return True
    try:
        if reiniciar:
            reiniciar()
        else:
            subprocess.run(['systemctl', '--user', 'restart', 'whatsapp-observador-prumo.service'],
                           check=True, timeout=20, capture_output=True)
    except (OSError, subprocess.SubprocessError):
        return False
    fim = relogio() + prazo
    while True:
        if presente():
            return True
        if relogio() >= fim:
            return False
        esperar(min(0.5, max(0, fim - relogio())))
