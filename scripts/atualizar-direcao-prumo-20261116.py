"""Prepara diff local; --aplicar exige plano intacto e fontes sem alterações.

Não publica, não altera preços, não executa envios. A aplicação ao repositório
irmão exige a permissão de filesystem correspondente fora deste script.
"""
import argparse
import difflib
import hashlib
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

WORKSPACE = Path(__file__).resolve().parents[1]
PRUMO = (WORKSPACE.parent / "prumo").resolve()
OUT = WORKSPACE / "outputs/reconstrucao-crm-20261116/prumo"
FILES = ("negocio.md", "organizacao.md", "decisoes.md")
MARKER = "Direção vigente de 16/11/2026"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def ensure_paths():
    if not PRUMO.is_absolute() or PRUMO.parent != WORKSPACE.parent or PRUMO.name.lower() != "prumo":
        raise RuntimeError("Destino não é o diretório absoluto irmão Prumo")
    for name in FILES:
        p = PRUMO / "00-contexto" / name
        if p.is_symlink() or p.resolve() != p or not p.is_file():
            raise RuntimeError(f"Destino inválido ou redirecionado: {p}")
    if OUT.resolve() != OUT or not OUT.resolve().is_relative_to(WORKSPACE):
        raise RuntimeError("Saída fora do workspace ou redirecionada")


def transform(name, text):
    operations = []

    def change(old, new):
        nonlocal text
        if text.count(old) != 1:
            raise RuntimeError(f"{name}: anchor não é único: {old[:90]!r}")
        operations.append({"antes": old, "depois": new})
        text = text.replace(old, new, 1)

    def line(prefix, new):
        found = [x for x in text.splitlines() if x.startswith(prefix)]
        if len(found) != 1:
            raise RuntimeError(f"{name}: prefixo ambíguo/ausente: {prefix}")
        change(found[0], new)

    def section(start, end, new):
        if text.count(start) != 1 or text.count(end) != 1:
            raise RuntimeError(f"{name}: limites de seção inválidos")
        a, b = text.index(start), text.index(end)
        if b <= a:
            raise RuntimeError("Ordem de anchors inválida")
        change(text[a:b], new.rstrip() + "\n\n")

    if MARKER in text:
        raise RuntimeError(f"{name}: direção já presente; não reaplicar")
    if name == "negocio.md":
        change("## Posicionamento", """## Direção vigente de 16/11/2026

Rômulo confirmou restrição do WhatsApp por spam após os disparos de 13/11 e autorizou reconstruir negócio, CRM e operação. A decisão é manter primeiros contatos automáticos bloqueados; reconexão, timer ou manifesto ativo não autorizam envio. Esta direção documental não atesta deploy nem bloqueio de todos os emissores.

A entrada é pela necessidade concreta, sem vender uma nova marca ou exigir diagnóstico institucional antes do serviço. Site/Encontrado e implantação delimitada de um fluxo comercial são as duas hipóteses iniciais, não o limite permanente do portfólio. O fundador conduz descoberta e venda; o SquadOne registra evidência, próxima ação, proposta, aceite, entrega e recebimento.

Raio-X e Mapa são opcionais quando acrescentam informação à decisão. Para Fonte, obter entendimento suficiente do problema e conferir regras com a equipe; o método, escopo contratado, qualidade e condições comerciais permanecem. Produtos por assinatura seguem avaliação dirigida de prontidão, comprador e economia, fora da aquisição ampla; piloto não vira produto pronto por esta decisão.

Priorizar oportunidades existentes, rede profissional, indicações, parcerias e interessados que iniciam conversa, respeitando autorização e elegibilidade de contato. Não tratar número público como opt-in. Preservar preços, contratos, autorizações de suporte e histórico. Plano e critérios propostos: [reconstrução comercial](../../SquadOne/docs/PRUMO-RECONSTRUCAO-COMERCIAL-2026-11-16.md); evidências: [pesquisa](../../SquadOne/docs/PRUMO-PESQUISA-CRM-2026-11-16.md).

## Posicionamento""")
        line('"Organizado" é o nome', '"Organizado" é o nome do trecho (o resultado). O serviço que leva até ele se chama **Fonte**; o **Mapa** é um instrumento opcional para compreender e priorizar esse trabalho.')
        line('**A frase antiga continua', '**A frase antiga continua valendo, no degrau de dentro:** *"Organizamos empresas onde a informação está espalhada e tudo depende do dono."* É a frase do Mapa e da Fonte, acionados por necessidade demonstrada, inclusive por indicação e parceiros.')
        old = 'Pelo Raio-X, a porta de todos; depois, o Mapa (empresa com equipe) e a proposta com o cardápio (ver "A oferta" e "Jornada do cliente").'
        change(old, 'Pela necessidade e conversa suficiente para definir escopo; Raio-X e Mapa são opcionais. Proposta da entrega pertinente, sem cardápio ou diagnóstico obrigatório (ver "A oferta" e "Jornada do cliente").')
        line('- **Conciliar entrada e continuidade:**', '- **Conciliar entrada e continuidade:** Site/Encontrado e implantação delimitada são hipóteses iniciais. Assinaturas têm avaliação dirigida e ficam fora da aquisição ampla até demonstrar prontidão, comprador e economia. Permissão para material não comprova venda; primeiras abordagens automáticas permanecem bloqueadas por decisão de 16/11, cuja aplicação operacional exige verificação própria.')
        line('| Porte |', '| Porte | Sem corte universal por tamanho. **Mapa e Fonte:** equipe e problema de regras/informações demonstrados; porte sozinho não comprova necessidade nem retorno. |')
        line('**A caça do Site usa', '**Pesquisa de candidatos:** os nichos históricos da esteira são referência, não autorização de contato. O recorte inicial vigente testa empresas de projetos sob orçamento; necessidade, decisor e canal elegível precisam ser confirmados. Primeiros contatos automáticos bloqueados por decisão de 16/11.')
        line('**Nicho ruim de lead é pausado.**', '**Avaliação de segmento:** revisar evidência de problema, proposta, pagamento e custo de acesso. Contagem histórica de envios sem interesse não substitui descoberta; critérios propostos estão no plano de reconstrução de 16/11.')
        change('Três etapas, nesta ordem. Cada oferta é de um tipo só (decisão de 09/10/2026, em [`decisoes.md`](decisoes.md)).', 'Ver, arrumar e manter descrevem funções do trabalho. Desde 16/11/2026 não exigem três etapas comerciais: o diagnóstico só entra quando necessário para uma decisão suficiente. Cada oferta conserva escopo próprio.')
        section('```\n            CAMINHO DO CLIENTE', '| Tipo | Oferta |', '''Necessidade → conversa suficiente → proposta → aceite → entrega → recebimento e manutenção contratada.

- **Diagnóstico opcional:** Raio-X para presença pública e Mapa para regras/rotina da equipe quando acrescentam informação. A Fonte não exige o documento Mapa como etapa comercial anterior.
- **Execução:** Encontrado, implantação de atendimento e Fonte resolvem problemas distintos e podem ser contratados separadamente. A Fonte pode alimentar a implantação com regras conferidas, sem obrigação de pacote.

''')
        change('**Raio-X** *(porta de entrada)*', '**Raio-X** *(diagnóstico opcional)*')
        change('**Mapa** *(só empresa com equipe, ~8 pessoas ou mais)*', '**Mapa** *(diagnóstico opcional para empresa com equipe e problema pertinente)*')
        change('A construção: semana 1, conferir o Mapa com o time (entrevistas, regra do MIN, R$ das travas conferidos);', 'A construção: semana 1, conferir o diagnóstico suficiente com o time (o Mapa, quando utilizado; entrevistas, regra do MIN, R$ das travas conferidos);')
        section('```\n CAPTAÇÃO (ver)', '| Etapa | Artefato |', 'Necessidade → conversa → proposta com escopo → aceite → entrega e conferência → cobrança e recebimento → suporte contratado.\n\nRaio-X e Mapa entram quando necessários; não há abordagem fria automática nem obrigação de demo antes de qualificar a necessidade.')
        line('| Abordagem fria |', '| Pesquisa e contato elegível | Fontes, hipótese e próxima ação; roteiros históricos não autorizam envio | `03-captacao/roteiro-raio-x.md` e plano de 16/11 no SquadOne |')
        line('**Regra de velocidade:**', '**Próximo passo:** combinar ação, responsável e data. Preparar proposta quando necessidade, interlocutor e escopo forem suficientes; um "gostei" sozinho não obriga nem justifica proposta.')
        section('## Canais\n', '### Leads que chegam sozinhos', '''## Canais

Priorizar carteira com conversa existente, rede profissional, indicações e parceiros; depois testar canais de demanda com custo e compromisso medidos. Nenhuma parceria com CDL ou outra entidade é presumida. WhatsApp serve atendimento e continuidade com permissão comprovada; número público não é opt-in. Primeiros contatos automáticos permanecem bloqueados por decisão de 16/11. Avaliar LinkedIn e outros canais por acesso ao comprador, sem replicar disparos em massa.

''')
        change('### Leads que chegam sozinhos (sem processo ainda)', '### Leads que chegam sozinhos (registro manual enquanto não integrado)')
        line('2. Montar o Raio-X à mão', '2. Entender a necessidade e combinar próximo passo. Se o Raio-X ajudar a decisão, gerar pelo `gerar.py` do piloto, publicar no projeto próprio do lead e enviar pelo canal autorizado; não é etapa obrigatória para proposta.')
        section('## Fase atual\n', '## Tom de voz', '''## Fase atual

Rodada de descoberta e venda conduzida pelo fundador, com critérios propostos e responsáveis no plano de reconstrução de 16/11. Medir necessidade, proposta, aceite, recebimento, custos e horas. As metas vencidas de 08/11 e regras baseadas em quantidade de disparos deixam de orientar a aquisição. Duas propostas atuais e zero ganhos registrados não provam ausência de venda fora do CRM.

---

''')
    elif name == "organizacao.md":
        change('## Conceito institucional de referência · 30/10/2026', '## Conceito institucional de referência · 16/11/2026\n\n**Direção vigente de 16/11/2026:** atualiza aquisição e jornada do conceito de 30/10; preserva identidade, método, preços, contratos, qualidade e histórico. Rômulo confirmou restrição por spam e autorizou a reconstrução. Primeiros contatos automáticos bloqueados por decisão; a efetividade na produção exige verificação operacional, não é atestada por este texto.')
        line('- **Como começa:**', '- **Como começa:** pela necessidade concreta e conversa suficiente para decidir o escopo, sem diagnóstico institucional obrigatório. Raio-X e Mapa são opcionais quando ajudam essa decisão. A Fonte conserva entrevistas, conferência das regras com a equipe, método e escopo contratado; não exige Mapa como etapa comercial anterior. O Mapa usa estimativas, sem extratos nem senhas; manutenção da Fonte mantém até 10 mudanças por mês em até 2 dias úteis após os 30 dias de ajustes.')
        line('- **O que a operação busca:**', '- **O que a operação busca:** validar Site/Encontrado e implantação delimitada como hipóteses iniciais, sem limitar o portfólio para sempre. SaaS segue avaliação dirigida, fora da aquisição ampla, com prontidão e comprador demonstrados. O fundador conduz descoberta/venda; o SquadOne separa cadastro, conversa, oportunidade, proposta, contratação e recebimento. Permissão para material não é venda. Medir custos e horas; não inferir margem. Priorizar relações existentes, indicações e demanda consentida; não autorizar contato por número público.')
        change('**Ver → arrumar → manter** descreve a jornada comercial. Essa sequência continua válida', '**Ver → arrumar → manter** descreve funções do trabalho, sem impor etapas comerciais obrigatórias. Essa organização continua válida')
    else:
        change(text[:text.index('\n### ')], text[:text.index('\n### ')] + '''
### 2026-11-16 · Direção vigente de 16/11/2026
- **Contexto:** Rômulo confirmou softban por spam após os disparos de 13/11. Auditoria distingue desconexão, relato e 49 marcos de primeiro envio, não mensagens totais.
- **Autorização:** reconstruir negócio, CRM e operação; não é nova venda, mudança de preço ou ampliação de suporte.
- **Decisão:** primeiros contatos automáticos bloqueados; entrada pela necessidade, sem marca nova nem Raio-X/Mapa obrigatórios. Site e implantação de um fluxo são hipóteses iniciais, não limite eterno. SaaS em avaliação dirigida fora da aquisição ampla. Fundador conduz descoberta/venda; CRM acompanha proposta, aceite, entrega, recebimento, custos e horas.
- **Método:** diagnóstico suficiente para o escopo; Raio-X/Mapa opcionais. Fonte conserva conferência com equipe, método, qualidade e condições contratadas. Piloto não vira produto pronto.
- **Substituídas parcialmente:** somente regras conflitantes de aquisição/jornada: WhatsApp frio principal, exclusão de rede própria, Raio-X obrigatório para todos, Mapa obrigatório antes da Fonte e decisão por volume de disparos. Demais decisões, contratos, preços e autorizações de suporte permanecem; histórico preservado.
- **Trade-off:** menos atividade automática e mais contato do fundador com compradores; expansão depende de evidência, sem teto permanente de portfólio.
- **Aplicação:** documento não atesta deploy. Política, executores e espelhos exigem publicação/conferência próprias. Não contornar restrição com reconexão ou troca de número.
- **Onde mora:** `negocio.md`, `organizacao.md`; SquadOne `docs/PRUMO-RECONSTRUCAO-COMERCIAL-2026-11-16.md`, `docs/PRUMO-PESQUISA-CRM-2026-11-16.md`, `outputs/reconstrucao-crm-20261116/auditoria-cadencia.json`.

''')
    return text, operations


def build():
    ensure_paths()
    entries = []
    for name in FILES:
        path = PRUMO / '00-contexto' / name
        before = path.read_bytes()
        raw = before.decode('utf-8')
        newline = '\r\n' if '\r\n' in raw else '\n'
        text = raw.replace('\r\n', '\n')
        updated, ops = transform(name, text)
        after = updated.replace('\n', newline).encode('utf-8')
        entries.append({'arquivo': name, 'destino': str(path), 'sha256Antes': sha(before),
                        'sha256Depois': sha(after), 'anchors': ops,
                        'antes': before, 'depois': after})
    return entries


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--aplicar', action='store_true')
    args = parser.parse_args()
    entries = build()  # Todas as fontes/anchors validadas antes de qualquer escrita.
    plan = {'schema': 1, 'workspace': str(WORKSPACE), 'prumo': str(PRUMO),
            'scriptSha256': sha(Path(__file__).read_bytes()),
            'arquivos': [{k: v for k, v in e.items() if k not in ('antes', 'depois')} for e in entries]}
    plan_path = OUT / 'plano.json'
    if not args.aplicar:
        OUT.mkdir(parents=True, exist_ok=True)
        plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
        for e in entries:
            diff = ''.join(difflib.unified_diff(e['antes'].decode().splitlines(True), e['depois'].decode().splitlines(True), fromfile=e['destino'], tofile=e['destino']))
            (OUT / (e['arquivo'] + '.diff')).write_text(diff, encoding='utf-8')
            print(diff)
        print(f'Plano preparado: {plan_path}. Nenhum arquivo Prumo alterado.')
        return
    if not plan_path.is_file() or json.loads(plan_path.read_text(encoding='utf-8')) != plan:
        raise RuntimeError('Plano ausente ou divergente: fontes, script, destino ou anchors mudaram. Gere e revise novamente.')
    backup = OUT / ('backup-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    backup.mkdir(parents=True, exist_ok=False)
    for e in entries:
        (backup / e['arquivo']).write_bytes(e['antes'])
    for e in entries:
        if sha(Path(e['destino']).read_bytes()) != e['sha256Antes']:
            raise RuntimeError('Fonte mudou após validação; aplicação interrompida antes da escrita.')
    written = []
    try:
        for e in entries:
            Path(e['destino']).write_bytes(e['depois'])
            written.append(e['arquivo'])
            if sha(Path(e['destino']).read_bytes()) != e['sha256Depois']:
                raise RuntimeError('Verificação após escrita falhou')
    finally:
        (backup / 'recibo.json').write_text(json.dumps({'arquivosEscritos': written, 'plano': plan}, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'Aplicados somente os três arquivos canônicos. Backup e recibo: {backup}. Sem deploy.')


if __name__ == '__main__':
    main()
