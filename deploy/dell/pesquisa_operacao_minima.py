"""Uma entrada para descoberta e higiene. Não importa o emissor nem libera campanha."""
import fcntl
from pathlib import Path
import sys

def executar(limite=5):
    sys.path.insert(0, str(Path.home() / '.local/bin'))
    from prospeccao_diaria import executar as descobrir
    from pesquisa_leads import executar as higienizar
    pasta = Path.home() / '.local/share/pesquisa-operacao-minima'
    pasta.mkdir(mode=0o700, parents=True, exist_ok=True)
    with (pasta / 'rodada.lock').open('a') as lock:
        try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: return {'ok': True, 'estado': 'pesquisa-em-andamento'}
        descoberta = descobrir(somente_pesquisa=True)
        if descoberta.get('falha'): raise RuntimeError('Descoberta não concluída; nenhuma mensagem enviada')
        resultado = higienizar(limite, somente_pesquisa=True)
        return {**resultado, 'descoberta': {k: descoberta[k] for k in ['estado', 'incluidosNestaRodada', 'mensagensEnviadas'] if k in descoberta}}
