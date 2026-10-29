#!/usr/bin/env python3
"""Avisa pelo Telegram que uma rotina comercial do systemd falhou (29/10/2026).

Chamado pelo `falha-pelo-telegram@.service` no OnFailure= das units (hoje, revisao-comercial-diaria e
disparo-conversa). Até então a revisão das 08:30 dependia do chat do Codex: se ele não rodasse, ninguém
sabia. Uma unit em falha só aparecia em amarelo na Central (dell-status, "Units em falha fora das
verificadas"), que não interrompe ninguém.

O aviso vai pela fila de avisos (deploy/dell/lib/aviso.py, ~/.local/lib/mel/ no Dell) com a origem
`rotina-comercial`, que sai só pelo Telegram (ORIGENS_TELEGRAM_EXCLUSIVO). Leva o nome da unit, o
resultado e o comando para ver o log; nunca o log em si, que pode ter nome de lead ou texto de conversa.
Uso: falha-pelo-telegram <unit>
"""
import datetime as dt
import importlib.util
import subprocess
import sys
from pathlib import Path

ORIGEM = 'rotina-comercial'


def lib_de_aviso():
    """A lib ao lado deste arquivo no repo; ~/.local/lib/mel/ no Dell."""
    for pasta in (Path(__file__).resolve().parent / 'lib', Path.home() / '.local/lib/mel'):
        if (pasta / 'aviso.py').exists():
            spec = importlib.util.spec_from_file_location('mel_aviso', pasta / 'aviso.py')
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            return mod
    raise RuntimeError('lib de aviso ausente')


def resultado(unit):
    try:
        r = subprocess.run(['systemctl', '--user', 'show', unit, '-p', 'Result', '-p', 'ExecMainStatus', '--value'],
                           capture_output=True, text=True, timeout=10)
        partes = r.stdout.split()
        return f'{partes[0]}, código {partes[1]}' if len(partes) >= 2 else 'resultado não lido'
    except Exception as e:  # noqa: BLE001
        return f'resultado não lido ({type(e).__name__})'


def montar(unit, como, hoje):
    return {
        'titulo': f'Falhou: {unit}'[:120],
        'texto': f'A rotina {unit} falhou ({como}). Nada foi refeito sozinho. Veja: journalctl --user -u {unit} -n 50',
        'origem': ORIGEM,
        # Uma por unit e dia: um timer que falha de novo no mesmo dia não repete o aviso.
        'chave': f'{ORIGEM}:{unit}:{hoje}',
    }


def main(argv):
    if len(argv) != 2 or not argv[1]:
        print(__doc__); return 2
    unit = argv[1]
    a = montar(unit, resultado(unit), dt.date.today().isoformat())
    r = lib_de_aviso().avisar(a['titulo'], a['texto'], a['origem'], chave=a['chave'])
    print(r)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
