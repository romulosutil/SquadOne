"""Duas consultas Sheets frescas, sem cache, preservando os quatro aliases v1.

Transformação pura e opt-in. Aceita somente a configuração 4.7 auditada:
leitura completa, opções vazias e uma execução. Metadados de reversão são as
definições dos leitores, nunca linhas de planilha. Não publica/executa nada.
"""
import copy
import json
import re

import workflow_contexto_whatsapp as v1

MARCA = '[contexto-whatsapp-lote-v2]'
PRUMO = 'Contexto: consultar PRUMO fresco'
SITE = 'Contexto: consultar Site fresco'
NORMALIZAR = 'Contexto: normalizar quatro fontes'
NOVOS = (PRUMO, SITE, NORMALIZAR)

# Reprodução deliberada das funções da GoogleSheet 4.7 instalada no n8n 2.38.7:
# prepareSheetData + structureArrayDataByColumn + convertSheetDataArrayToObjectArray.
# Não "corrigir" peculiaridades de cabeçalhos, tipos ou linhas vazias aqui.
CONVERTER_JS = r"""
function linhas47(values) {
  if (values === undefined || values.length === 0) return [];
  if (!Array.isArray(values) || values.some(r => !Array.isArray(r) || r.some(v => v !== null && !['string','number','boolean'].includes(typeof v)))) throw Error('Matriz Sheets inválida');
  let data = values.map((row, i) => [i + 1, ...row]);
  data[0][0] = 'row_number';
  const columns = [];
  const longest = data.reduce((a,b) => a.length > b.length ? a : b, []).length;
  for (let col = 0; col < longest; col++) {
    const column = data.map(row => row[col]);
    if (column[0] !== '' || column.slice(1).some(cell => cell || typeof cell === 'number')) columns.push(column);
  }
  data = (columns[0] || []).map((_,i) => columns.map(row => row[i] === undefined ? '' : row[i]));
  const first = data.findIndex(row => row.slice(1).some(cell => cell || typeof cell === 'number'));
  data = data.slice(first);
  data[0][0] = 'row_number';
  data = data.filter(row => row.slice(1).some(cell => cell || typeof cell === 'number' || typeof cell === 'boolean'));
  data[0][0] = 'row_number';
  const keys = [];
  const width = data.reduce((a,b) => a.length > b.length ? a : b, []).length;
  for (let col = 0; col < width; col++) keys.push(data[0][col] || `col_${col}`);
  const result = [];
  for (let row = 1; row < data.length; row++) {
    const item = {};
    for (let col = 0; col < data[row].length; col++) if (keys[col]) item[keys[col]] = data[row][col] ?? '';
    if (Object.keys(item).length) result.push({json:item, pairedItem:{item:0}});
  }
  return result;
}
"""


def _compact(valor):
    return json.dumps(valor, ensure_ascii=False, separators=(',', ':'))


def _leitores(filho):
    leitores = [copy.deepcopy(v1._no(filho, n)) for n in v1.LEITURAS]
    documentos = []
    for i, n in enumerate(leitores):
        p = n.get('parameters', {})
        if (n.get('type') != 'n8n-nodes-base.googleSheets' or n.get('typeVersion') != 4.7
                or n.get('executeOnce') is not True or n.get('alwaysOutputData') is not True
                or p.get('resource') != 'sheet' or p.get('operation', 'read') != 'read'
                or set(p) - {'resource', 'operation', 'documentId', 'sheetName', 'options', 'filtersUI'}
                or p.get('options') != {} or p.get('filtersUI', {}) not in ({}, {'values': []})):
            raise ValueError('Leitura fora do contrato Sheets 4.7 completo; revisão explícita necessária.')
        cred = n.get('credentials', {})
        if set(cred) != {'googleSheetsOAuth2Api'} or not isinstance(cred['googleSheetsOAuth2Api'], dict) or not cred['googleSheetsOAuth2Api'].get('id'):
            raise ValueError('Credencial Sheets ausente ou ambígua.')
        doc = p.get('documentId', {})
        if doc.get('mode') != 'id' or not isinstance(doc.get('value'), str) or not re.fullmatch(r'[A-Za-z0-9_-]+', doc['value']):
            raise ValueError('Documento deve ter ID literal; expressões não são suportadas.')
        documentos.append(doc['value'])
        sheet = p.get('sheetName', {})
        valor = sheet.get('value')
        if i < 2:
            if sheet.get('mode') != 'id' or isinstance(valor, bool) or not re.fullmatch(r'\d+', str(valor)):
                raise ValueError('Aba por ID deve ter identificador numérico literal.')
        elif sheet.get('mode') != 'name' or not isinstance(valor, str) or not valor or valor.startswith('=') or any(ord(c) < 32 for c in valor):
            raise ValueError('Nome de aba deve ser literal e não vazio.')
        if (n.get('disabled') or n.get('continueOnFail') or n.get('onError') not in (None, 'stopWorkflow')
                or n.get('retryOnFail') is not True or n.get('maxTries', 3) != 3
                or n.get('waitBetweenTries') not in (None, 1000)):
            raise ValueError('Orçamento/falha de leitor fora do contrato auditado.')
    if not (documentos[0] == documentos[2] == documentos[3] and documentos[1] != documentos[0]):
        raise ValueError('Agrupamento exige três abas PRUMO e uma Site, em dois documentos.')
    if any(n['credentials'] != leitores[0]['credentials'] for n in leitores):
        raise ValueError('Lote não pode misturar identidades Google.')
    return leitores


def _filtro(leitor):
    p = leitor['parameters']['sheetName']
    return {'gridRange': {'sheetId': int(p['value'])}} if p['mode'] == 'id' else {'a1Range': "'" + p['value'].replace("'", "''") + "'"}


def _http(nome, id_, leitores):
    return {'id': id_, 'name': nome, 'type': 'n8n-nodes-base.httpRequest', 'typeVersion': 4.2,
            'position': [0 if nome == PRUMO else 240, -180], 'executeOnce': True,
            'retryOnFail': True, 'maxTries': 3,
            'credentials': copy.deepcopy(leitores[0]['credentials']),
            'parameters': {'method': 'POST', 'url': 'https://sheets.googleapis.com/v4/spreadsheets/' + leitores[0]['parameters']['documentId']['value'] + '/values:batchGetByDataFilter',
                           'authentication': 'predefinedCredentialType', 'nodeCredentialType': 'googleSheetsOAuth2Api',
                           'sendBody': True, 'specifyBody': 'json',
                           'jsonBody': _compact({'dataFilters': [_filtro(n) for n in leitores], 'majorDimension': 'ROWS', 'valueRenderOption': 'UNFORMATTED_VALUE', 'dateTimeRenderOption': 'FORMATTED_STRING'}),
                           'options': {'timeout': 30000, 'response': {'response': {'responseFormat': 'json', 'fullResponse': True, 'neverError': False}}}}}


def _normalizador(leitores):
    grupos = [(PRUMO, [leitores[i] for i in (0, 2, 3)]), (SITE, [leitores[1]])]
    contrato = [{'node': nome, 'documento': ns[0]['parameters']['documentId']['value'],
                 'fontes': [{'nome': n['name'], 'filtro': _filtro(n)} for n in ns]} for nome, ns in grupos]
    codigo = CONVERTER_JS + '\nconst contrato = ' + _compact(contrato) + r""";
const igual = (a,b) => {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false;
  const ka=Object.keys(a).sort(), kb=Object.keys(b).sort();
  return JSON.stringify(ka)===JSON.stringify(kb) && ka.every(k=>igual(a[k],b[k]));
};
const fontes = {};
for (const grupo of contrato) {
  const itens = $(grupo.node).all();
  if (itens.length !== 1) throw Error('Resposta de lote ausente ou multiplicada');
  const resposta = itens[0].json;
  if (resposta.statusCode !== 200 || !resposta.body || resposta.body.spreadsheetId !== grupo.documento) throw Error('Documento Sheets incompleto');
  const ranges = resposta.body.valueRanges;
  if (!Array.isArray(ranges) || ranges.length !== grupo.fontes.length) throw Error('Lote Sheets parcial');
  const usados = new Set();
  for (const fonte of grupo.fontes) {
    const matches = ranges.map((r,i)=>({r,i})).filter(({r})=>Array.isArray(r.dataFilters) && r.dataFilters.length===1 && igual(r.dataFilters[0],fonte.filtro));
    if (matches.length !== 1 || usados.has(matches[0].i)) throw Error('Fonte Sheets ausente ou repetida');
    const {r,i} = matches[0]; usados.add(i);
    if (!r.valueRange || typeof r.valueRange.range !== 'string' || r.valueRange.majorDimension !== 'ROWS') throw Error('Range Sheets inválido');
    if (r.valueRange.values !== undefined && !Array.isArray(r.valueRange.values)) throw Error('Valores Sheets inválidos');
    fontes[fonte.nome] = linhas47(r.valueRange.values);
  }
}
return [{json:{fontes}}];"""
    return {'id': 'contexto-lote-normalizar', 'name': NORMALIZAR, 'type': 'n8n-nodes-base.code', 'typeVersion': 2,
            'position': [480, -180], 'parameters': {'mode': 'runOnceForAllItems', 'jsCode': codigo}}


def _conexoes(gatilho, fim, org):
    caminho = [gatilho, *([org] if org else []), *NOVOS, *v1.LEITURAS, v1.GUARDA, fim]
    return {a: {'main': [[v1._destino(b)]]} for a, b in zip(caminho, caminho[1:])}


def _converter(wf, spec):
    _, gatilho, fim = spec
    chamada = v1._no(wf, fim)
    filho = json.loads(chamada['parameters']['workflowJson'])
    leitores = _leitores(filho)
    aliases = []
    for i, n in enumerate(leitores):
        alias = {k: copy.deepcopy(v) for k, v in n.items() if k not in ('parameters', 'credentials', 'type', 'typeVersion', 'retryOnFail', 'maxTries', 'waitBetweenTries', 'notes')}
        alias.update(type='n8n-nodes-base.code', typeVersion=2, retryOnFail=False,
                     parameters={'mode': 'runOnceForAllItems', 'jsCode': 'return $(' + _compact(NORMALIZAR) + ').first().json.fontes[' + _compact(n['name']) + '];'})
        if i == 0:
            alias['notes'] = _compact({'v': 1, 'leitoresOriginais': leitores})
        aliases.append(alias)
    substitutos = {n['name']: n for n in aliases}
    filho['nodes'] = [substitutos.get(n['name'], n) for n in filho['nodes']]
    filho['nodes'] += [_http(PRUMO, 'contexto-lote-prumo', [leitores[i] for i in (0, 2, 3)]),
                       _http(SITE, 'contexto-lote-site', [leitores[1]]), _normalizador(leitores)]
    org = 'Prumo · organização · ' + gatilho
    filho['connections'] = _conexoes(gatilho, fim, org if any(n['name'] == org for n in filho['nodes']) else None)
    chamada['parameters']['workflowJson'] = json.dumps(filho, ensure_ascii=False)
    chamada['notes'] = chamada.get('notes', '') + '\n' + MARCA + ' Duas consultas Sheets frescas; aliases, guarda e consumidor v1 preservados.'
    return wf


def _restaurar_validando(workflow, spec):
    """Restaura só em memória e compara grafo exato; marcador não é autorização."""
    wf = copy.deepcopy(workflow)
    _, gatilho, fim = spec
    chamada = v1._no(wf, fim)
    try:
        filho = json.loads(chamada['parameters']['workflowJson'])
        meta = json.loads(v1._no(filho, v1.LEITURAS[0])['notes'])
        if set(meta) != {'v', 'leitoresOriginais'} or type(meta['v']) is not int or meta['v'] != 1:
            raise ValueError('Metadados de leitores inválidos.')
        leitores = meta['leitoresOriginais']
        if not isinstance(leitores, list) or [n['name'] for n in leitores] != list(v1.LEITURAS):
            raise ValueError('Leitores originais incompletos.')
        originais = {n['name']: n for n in leitores}
        filho['nodes'] = [copy.deepcopy(originais.get(n['name'], n)) for n in filho['nodes'] if n['name'] not in NOVOS]
        org = 'Prumo · organização · ' + gatilho
        filho['connections'] = v1._conexoes_filho(gatilho, fim, org if any(n['name'] == org for n in filho['nodes']) else None)
        chamada['parameters']['workflowJson'] = json.dumps(filho, ensure_ascii=False)
        chamada['notes'] = '\n'.join(line for line in chamada.get('notes', '').split('\n') if not line.startswith(MARCA))
        validado = v1.preparar(wf)
        esperado = _converter(copy.deepcopy(validado), spec)
        # Prumo pode inserir sua entrada antes ou depois da conversão. A ordem
        # visual de nodes não executa o grafo; arestas/saídas e todo o conteúdo
        # continuam comparados exatamente, inclusive IDs e credenciais.
        def comparavel(valor):
            valor = copy.deepcopy(valor)
            p = v1._no(valor, fim)['parameters']
            c = json.loads(p['workflowJson'])
            c['nodes'] = sorted(c['nodes'], key=lambda n: n['name'])
            p['workflowJson'] = c
            return valor
        if comparavel(esperado) != comparavel(workflow):
            raise ValueError('Contexto em lote foi alterado; revisar grafo, credenciais e código antes de publicar.')
        return validado
    except (KeyError, TypeError, json.JSONDecodeError) as erro:
        raise ValueError('Contexto em lote inválido.') from erro


def preparar_contexto_compativel(workflow):
    """Hook inicial v2: valida lote já instalado ou prepara o contexto v1."""
    spec = v1._especificacao(workflow)
    if spec and MARCA in v1._no(workflow, spec[2]).get('notes', ''):
        _restaurar_validando(workflow, spec)
        return copy.deepcopy(workflow)
    return v1.preparar(workflow)


def preparar(workflow):
    spec = v1._especificacao(workflow)
    if spec is None:
        return copy.deepcopy(workflow)
    if MARCA in v1._no(workflow, spec[2]).get('notes', ''):
        _restaurar_validando(workflow, spec)
        return copy.deepcopy(workflow)
    return _converter(v1.preparar(workflow), spec)
