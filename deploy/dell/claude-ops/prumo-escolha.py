"""Lead Scout: escolher a busca pelo que já foi buscado, não pela hora (idempotente).

Com a escolha pela hora, rodar de novo na mesma hora repetia a mesma busca e
não achava nada novo. Agora a combinação segmento × cidade menos presente em
Prospects + Descartados é a próxima; empate é sorteado. Vale para execução
manual e agendada.
"""
from n8n import api, put

LEAD_SCOUT = "e02c6f43-17ce-430b-9238-0b997a7656ce"

CONFIG = """// Alvo do PRUMO. Para mudar, edite só as duas listas; a escolha da busca
// acontece em "Preparar descoberta sem repetidos" (a menos usada até agora).
const SEGMENTOS = [
  'distribuidora de alimentos', 'distribuidora de bebidas', 'atacadista',
  'distribuidora de materiais de construção', 'distribuidora de produtos de limpeza',
  'distribuidora de autopeças', 'distribuidora de embalagens', 'distribuidora de cosméticos',
];
const CIDADES = [
  'São Paulo/SP', 'Campinas/SP', 'Guarulhos/SP', 'São Bernardo do Campo/SP', 'Santo André/SP',
  'Osasco/SP', 'Sorocaba/SP', 'Ribeirão Preto/SP', 'São José dos Campos/SP', 'Jundiaí/SP',
];
return [{ json: {
  combinacoes: SEGMENTOS.flatMap(segmento => CIDADES.map(cidade => ({ segmento, cidade }))),
  minimumReviewCount: 30,
  minimumRating: 4,
  reviewThreshold: 60,
  targetTerms: ['distribuidora', 'distribuidor', 'distribuicao', 'atacado', 'atacadista', 'wholesaler', 'warehouse_store'],
  requiredContactChannel: 'WHATSAPP_VERIFIED',
} }];"""

PREPARAR = """const cfg = $('Config — mercado-alvo').first().json;
// Prospects + Descartados: quem já foi visto não volta para a revisão.
const linhas = [...$('Ler empresas já registradas').all(), ...$input.all()].map(i => i.json);
const existingCompanyIds = [...new Set(linhas
  .map(json => String(json['ID'] ?? json['ID da empresa'] ?? json.company_id ?? '').trim().toLowerCase())
  .filter(Boolean))];
// Próxima busca: a combinação com menos empresas já vistas; empate sorteado.
const uso = new Map();
for (const l of linhas) {
  const k = String(l['Segmento'] ?? '') + '|' + String(l['Cidade'] ?? '');
  uso.set(k, (uso.get(k) ?? 0) + 1);
}
const conta = (c) => uso.get(c.segmento + '|' + c.cidade) ?? 0;
const menor = Math.min(...cfg.combinacoes.map(conta));
const candidatas = cfg.combinacoes.filter(c => conta(c) === menor);
const escolha = candidatas[Math.floor(Math.random() * candidatas.length)];
return [{ json: {
  ...cfg,
  city: escolha.cidade,
  targetVertical: escolha.segmento,
  query: `${escolha.segmento} em ${escolha.cidade}`,
  existingCompanyIds,
} }];"""


def main():
    wf = api("GET", f"/workflows/{LEAD_SCOUT}")
    por = {n["name"]: n for n in wf["nodes"]}
    por["Config — mercado-alvo"]["parameters"]["jsCode"] = CONFIG
    por["Preparar descoberta sem repetidos"]["parameters"]["jsCode"] = PREPARAR
    # Quem lia a busca do Config passa a ler da escolha feita na preparação.
    for nome in ("Normalizar empresas", "Resumo da busca: montar aviso", "Pontuar para revisão humana"):
        js = por[nome]["parameters"]["jsCode"]
        if nome == "Pontuar para revisão humana":
            continue  # usa só limites e termos, que seguem no Config
        por[nome]["parameters"]["jsCode"] = js.replace("$('Config — mercado-alvo').first().json",
                                                       "$('Preparar descoberta sem repetidos').first().json")
    put(wf)
    api("POST", f"/workflows/{LEAD_SCOUT}/activate")
    print("Lead Scout: busca escolhida pela menos usada")


if __name__ == "__main__":
    main()
