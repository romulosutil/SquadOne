"""Lead Scout do PRUMO com rodízio de buscas (idempotente).

Antes a busca era sempre "distribuidora em São Paulo/SP", com 20 resultados:
depois do primeiro dia todos já estavam na fila e o fluxo terminava vazio.
Agora cada execução pega uma combinação segmento × cidade pela hora corrente
(a das 9h muda a cada dia; uma execução manual mais tarde pega outra) e lê até
3 páginas do Places (60 resultados).
"""
from n8n import api, put

LEAD_SCOUT = "e02c6f43-17ce-430b-9238-0b997a7656ce"

CONFIG = """// Rodízio: cada hora aponta para uma combinação segmento × cidade.
// Para mudar o alvo, edite só as duas listas.
const SEGMENTOS = [
  'distribuidora de alimentos', 'distribuidora de bebidas', 'atacadista',
  'distribuidora de materiais de construção', 'distribuidora de produtos de limpeza',
  'distribuidora de autopeças', 'distribuidora de embalagens', 'distribuidora de cosméticos',
];
const CIDADES = [
  'São Paulo/SP', 'Campinas/SP', 'Guarulhos/SP', 'São Bernardo do Campo/SP', 'Santo André/SP',
  'Osasco/SP', 'Sorocaba/SP', 'Ribeirão Preto/SP', 'São José dos Campos/SP', 'Jundiaí/SP',
];
const combinacoes = SEGMENTOS.flatMap(segmento => CIDADES.map(cidade => ({ segmento, cidade })));
const escolha = combinacoes[Math.floor(Date.now() / 3_600_000) % combinacoes.length];
const city = escolha.cidade;
const targetVertical = escolha.segmento;
return [{ json: {
  city,
  targetVertical,
  query: `${targetVertical} em ${city}`,
  minimumReviewCount: 30,
  minimumRating: 4,
  reviewThreshold: 60,
  targetTerms: ['distribuidora', 'distribuidor', 'distribuicao', 'atacado', 'atacadista', 'wholesaler', 'warehouse_store'],
  requiredContactChannel: 'WHATSAPP_VERIFIED',
  diagnosticFormUrl: 'https://docs.google.com/forms/d/e/1FAIpQLScknF_YOBUHrX94tfgykv37NaEryAzqzIdc55Hel8RX1wp2Sg/viewform',
  diagnosticCompanyEntryId: '171063854',
} }];"""


def main():
    wf = api("GET", f"/workflows/{LEAD_SCOUT}")
    nos = {n["name"]: n for n in wf["nodes"]}

    nos["Config — mercado-alvo"]["parameters"]["jsCode"] = CONFIG

    places = nos["Google Places — busca pública"]["parameters"]
    mask = places["headerParameters"]["parameters"][0]
    if "nextPageToken" not in mask["value"]:
        mask["value"] += ",nextPageToken"
    places.pop("body", None)
    places.pop("rawContentType", None)
    places.update({
        "contentType": "json", "specifyBody": "json",
        "jsonBody": "={{ { \"textQuery\": $json.query, \"languageCode\": \"pt-BR\", \"regionCode\": \"BR\", \"pageSize\": 20 } }}",
    })
    places.setdefault("options", {})["pagination"] = {"pagination": {
        "paginationMode": "updateAParameterInEachRequest",
        "parameters": {"parameters": [{"type": "body", "name": "pageToken", "value": "={{ $response.body.nextPageToken }}"}]},
        "paginationCompleteWhen": "other", "completeExpression": "={{ !$response.body.nextPageToken }}",
        "limitPagesFetched": True, "maxRequests": 3, "requestInterval": 1500,
    }}

    norm = nos["Normalizar empresas"]["parameters"]
    antigo = "const places = $json.places ?? [];"
    if antigo in norm["jsCode"]:
        norm["jsCode"] = norm["jsCode"].replace(antigo, "// Uma página do Places por item (paginação): junta todas.\nconst places = $input.all().flatMap(item => item.json.places ?? []);")

    resumo = nos["Resumo da busca: montar aviso"]["parameters"]
    resumo["jsCode"] = resumo["jsCode"].replace("const places = itens[0]?.json.places ?? [];",
                                                "const places = itens.flatMap(x => x.json.places ?? []);")
    resumo["jsCode"] = resumo["jsCode"].replace('troque cidade ou segmento no nó "Config — mercado-alvo".',
                                                "a próxima execução tenta outra combinação do rodízio.")

    put(wf)
    api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    print("Lead Scout com rodízio; busca desta hora:",
          next(n for n in api("GET", f"/workflows/{LEAD_SCOUT}")["nodes"] if n["name"] == "Config — mercado-alvo")["parameters"]["jsCode"].count("SEGMENTOS"), "ok")


if __name__ == "__main__":
    main()
