"""Diagnóstico e aviso de campanha encerrada/pausa de proteção; nunca libera envio."""
import datetime as dt
from contextlib import closing
import hashlib
import json
import os
from pathlib import Path
from zoneinfo import ZoneInfo
from politica_envios import LIMITES_OPERACIONAIS

SP = ZoneInfo('America/Sao_Paulo')


def mostrar_reposicao(estado, config, data, agora):
    """Fila consumida em operação contínua é espera por reposição, não fim do dia."""
    if (estado.get('estado') not in ('concluido', 'pronto') or config.get('ativo') is not True
            or estado.get('motivoOperacional') == 'campanha-concluida'
            or any(l.get('estado') == 'pronto' for l in estado.get('fila', []))):
        return
    from campanha_site import ler
    try:
        campanha = ler()
        if (not campanha or campanha.get('modo') != 'continuo-dias-uteis'
                or (LIMITES_OPERACIONAIS and estado.get('enviados', 0) >= campanha.get('metaContatos', 20))):
            return
        arquivo = Path(data)/'prospeccao-diaria.json'
        resumo = json.loads(arquivo.read_text()) if arquivo.exists() else {}
        em = dt.datetime.fromisoformat(resumo['atualizadoEm']) if resumo.get('atualizadoEm') else None
        parado = bool(em and (agora-em).total_seconds() > 15*60)
        falha = resumo.get('estado') in ('bloqueado', 'limite-de-pesquisa', 'rodada-aguarda-revisao')
        estado.update(estado='bloqueado' if falha or parado else 'avaliando', proximoEnvioEm=None,
                      motivoOperacional='reposicao-pendente',
                      detalhe=('A reposição de contatos precisa de atenção. Confira a pesquisa e a rodada; os envios anteriores estão preservados.'
                               if falha or parado else 'A fila aprovada foi consumida. A reposição automática busca novos contatos para os três pareceres.'))
    except (OSError, ValueError, TypeError):
        estado.update(estado='bloqueado', proximoEnvioEm=None, motivoOperacional='reposicao-ilegivel',
                      detalhe='Não foi possível conferir a reposição de contatos. Os envios anteriores estão preservados.')


def diagnosticar(config, campanha, contatos, agora):
    if not LIMITES_OPERACIONAIS: return None
    if not config.get('ativo'):
        if config.get('pausadoPor') == 'protecao':
            return {'estado': 'pausado', 'codigo': 'pausa-de-protecao',
                    'desde': config.get('pausadoEm'),
                    'detalhe': config.get('motivoDaPausa') or 'Proteção da conta exige conferência antes de retomar.'}
        return None  # Pausa manual não é falha operacional.
    if campanha is None:
        return None
    try:
        if (campanha.get('versao') != 1 or campanha.get('ativo') is not True
                or campanha.get('produto') != 'site' or agora.tzinfo is None):
            raise ValueError('Campanha inválida')
        inicio = dt.date.fromisoformat(campanha['inicioEnvios'])
        continuo = campanha.get('modo') == 'continuo-dias-uteis' and campanha.get('escopo') == 'novos-site'
        fim = agora.astimezone(SP).date() if continuo else dt.date.fromisoformat(campanha['fimEnvios'])
        if inicio > fim:
            raise ValueError('Período inválido')
        from campanha_site import quantidade_confirmados
        meta = campanha.get('metaContatos')
        if meta is not None:
            if type(meta) is not int or not 1 <= meta <= 60:
                raise ValueError('Meta inválida')
            confirmados = quantidade_confirmados(campanha, contatos, agora)
            if confirmados >= meta:
                return {'estado': 'concluido', 'codigo': 'campanha-concluida', 'desde': fim.isoformat(),
                        'detalhe': (f'Limite de hoje atingido: {confirmados} contatos com recibo. A prospecção continua no próximo dia útil, com novas avaliações.' if continuo else
                                    f'Campanha concluída: {confirmados} de {meta} contatos com recibo. Prepare a próxima campanha; o lote concluído não será reenviado.')}
        if agora.astimezone(SP).date() > fim:
            return {'estado': 'bloqueado', 'codigo': 'campanha-vencida', 'desde': fim.isoformat(),
                    'detalhe': f'A campanha terminou em {fim:%d/%m/%Y}. Prepare e libere uma nova campanha com fontes e pareceres atuais; a autorização anterior não foi prorrogada.'}
        return None
    except (ValueError, KeyError, TypeError, AttributeError):
        return {'estado': 'bloqueado', 'codigo': 'campanha-invalida', 'desde': None,
                'detalhe': 'O manifesto ou os recibos da campanha precisam de conferência. Novos primeiros contatos permanecem bloqueados.'}


def conferir(config, agora):
    """Só leitura. Ausência de recibos nunca vira confirmação ou liberação."""
    if not LIMITES_OPERACIONAIS: return None
    from campanha_site import ler, REGISTRO
    import sqlite3
    # Uma pausa tem precedência, inclusive quando o manifesto está ilegível.
    pausa = diagnosticar(config, None, [], agora)
    if pausa or not config.get('ativo'):
        return pausa
    try:
        campanha = ler()
        linhas = []
        if campanha and 'metaContatos' in campanha:
            with closing(sqlite3.connect(Path(REGISTRO).resolve().as_uri() + '?mode=ro', uri=True)) as db:
                linhas = db.execute('SELECT chave,id,estado,em,recibo FROM contatos').fetchall()
        return diagnosticar(config, campanha, linhas, agora)
    except (OSError, ValueError, TypeError, sqlite3.Error):
        return {'estado': 'bloqueado', 'codigo': 'campanha-ilegivel', 'desde': None,
                'detalhe': 'Não foi possível conferir a campanha e seus recibos. Novos primeiros contatos permanecem bloqueados.'}


def avisar_pendencia(diagnostico, arquivo, agora, avisar):
    """Um aviso durável por causa, com nova tentativa após falha. Sem conteúdo de leads."""
    if not diagnostico:
        return
    chave = hashlib.sha256(json.dumps({k: diagnostico.get(k) for k in ('codigo', 'desde', 'detalhe')},
                                     sort_keys=True, ensure_ascii=False).encode()).hexdigest()[:20]
    arquivo = Path(arquivo)
    try:
        anterior = json.loads(arquivo.read_text(encoding='utf-8'))
    except FileNotFoundError:
        anterior = {}
    # Um arquivo inválido deve ser conferido, não apagado silenciosamente.
    if anterior.get('chave') == chave:
        if anterior.get('avisado'):
            return
        tentativa = dt.datetime.fromisoformat(anterior['tentativaEm'])
        if (agora - tentativa).total_seconds() < 300:
            return
    arquivo.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    def salvar(valor):
        tmp = arquivo.with_suffix('.tmp')
        tmp.write_text(json.dumps(valor, ensure_ascii=False), encoding='utf-8')
        tmp.chmod(0o600)
        os.replace(tmp, arquivo)
    estado = {'chave': chave, 'tentativaEm': agora.isoformat(), 'avisado': False}
    salvar(estado)
    if avisar('Time comercial precisa de atenção', diagnostico['detalhe'],
              'frente-comercial:continuidade:' + chave, prioridade=1):
        estado['avisado'] = True
        salvar(estado)


def interromper(estado, config, agora, data, gravar, avisar):
    """Antes de CRM/IA/reserva: publica causa verificável e avisa sem alterar autorização."""
    diagnostico = conferir(config, agora)
    if diagnostico is None:
        return False
    try:
        anterior = json.loads((Path(data)/'frente-comercial.json').read_text(encoding='utf-8'))
        if anterior.get('dia') == estado['dia']:
            for campo in ('avaliados', 'selecionados', 'enviados', 'respondidos', 'semWhatsapp',
                          'semConfirmacao', 'fila', 'setores', 'funil'):
                if campo in anterior:
                    estado[campo] = anterior[campo]
    except (OSError, ValueError):
        pass
    estado.update(estado=diagnostico['estado'], detalhe=diagnostico['detalhe'],
                  motivoOperacional=diagnostico['codigo'], proximoEnvioEm=None)
    gravar(estado)
    # Falha no aviso não desfaz a interrupção nem apaga o motivo publicado.
    try:
        avisar_pendencia(diagnostico, Path(data)/'frente-comercial-continuidade.json', agora, avisar)
    except Exception:
        import sys
        print('frente-comercial: aviso de continuidade pendente; nova tentativa no próximo ciclo', file=sys.stderr)
    return True
