"""Pausa reversível da aquisição legada no Dell; não toca conversas nem conecta contas."""
import argparse
import datetime as dt
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

TIMERS = ('frente-comercial.timer', 'prospeccao-diaria.timer')
ARQUIVOS = ('frente-comercial-config.json', 'campanha-site-ativa.json')
MOTIVO = 'Aquisição em reconstrução após softban por spam em 13/11/2026; não retomar pela reconexão.'


def alvos(home):
    raiz = (home / '.local/share/squadone-operations').resolve(strict=True)
    esperada = home.resolve() / '.local/share/squadone-operations'
    if raiz != esperada:
        raise ValueError('Diretório operacional fora do destino esperado.')
    saida = []
    for nome in ARQUIVOS:
        p = raiz / nome
        if p.resolve(strict=True).parent != raiz or p.is_symlink():
            raise ValueError('Configuração fora do diretório operacional.')
        d = json.loads(p.read_text(encoding='utf-8'))
        if not isinstance(d, dict) or type(d.get('ativo')) is not bool:
            raise ValueError('Configuração sem estado ativo explícito: ' + nome)
        saida.append((p, d))
    return saida


def estado_timer(nome):
    r = subprocess.run(['systemctl', '--user', 'show', nome, '-p', 'ActiveState', '-p', 'UnitFileState'],
                       text=True, capture_output=True, check=True, timeout=15)
    return dict(linha.split('=', 1) for linha in r.stdout.splitlines() if '=' in linha)


def gravar_json(p, d):
    modo = p.stat().st_mode & 0o777
    fd, temporario = tempfile.mkstemp(prefix=p.name + '.', dir=p.parent)
    try:
        os.fchmod(fd, modo)
        with os.fdopen(fd, 'w', encoding='utf-8') as f:
            json.dump(d, f, ensure_ascii=False, indent=2)
            f.write('\n')
            f.flush()
            os.fsync(f.fileno())
        os.replace(temporario, p)
    finally:
        if os.path.exists(temporario):
            os.unlink(temporario)


def executar(aplicar=False):
    home = Path.home()
    configs = alvos(home)
    agora = dt.datetime.now(dt.timezone.utc)
    antes = {nome: estado_timer(nome) for nome in TIMERS}
    recibo = {'consultadoEm': agora.isoformat(), 'aplicado': False, 'motivo': MOTIVO,
              'antes': {'timers': antes, 'configs': {p.name: {'ativo': d['ativo']} for p, d in configs}},
              'escopo': 'Somente timers de aquisição e dois manifestos vigentes; sem envios, reconexão ou mudança de histórico.'}
    if not aplicar:
        return recibo
    backup = home / '.cache/squadone-contencao' / agora.strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True, mode=0o700, exist_ok=False)
    for p, _ in configs:
        shutil.copy2(p, backup / p.name)
    (backup / 'antes.json').write_text(json.dumps(recibo, ensure_ascii=False, indent=2), encoding='utf-8')
    # Desliga também o agendamento persistente. Nenhuma restauração automática pode religar envios.
    subprocess.run(['systemctl', '--user', 'disable', '--now', *TIMERS], check=True, timeout=30,
                   capture_output=True, text=True)
    for p, d in configs:
        d.update(ativo=False, atualizadoEm=agora.isoformat(), pausadoEm=agora.isoformat(),
                 pausadoPor='reconstrucao-comercial-20261116', motivoDaPausa=MOTIVO)
        gravar_json(p, d)
    depois = {nome: estado_timer(nome) for nome in TIMERS}
    if any(v.get('ActiveState') != 'inactive' or v.get('UnitFileState') not in ('disabled', 'masked') for v in depois.values()):
        raise RuntimeError('Pausa persistente dos timers não confirmada; backup em ' + str(backup))
    if any(json.loads(p.read_text(encoding='utf-8')).get('ativo') is not False for p, _ in configs):
        raise RuntimeError('Pausa dos manifestos não confirmada; backup em ' + str(backup))
    recibo.update(aplicado=True, backup=str(backup), depois={'timers': depois, 'configsAtivas': 0})
    (backup / 'recibo.json').write_text(json.dumps(recibo, ensure_ascii=False, indent=2), encoding='utf-8')
    return recibo


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aplicar', action='store_true', help='Pausar persistentemente os timers e manifestos vigentes.')
    print(json.dumps(executar(parser.parse_args().aplicar), ensure_ascii=False))
