#!/usr/bin/env python3
"""Site antes da venda: amplia as buscas do Caçador com as cidades novas (07/10/2026, idempotente).

As 16 buscas da migração de nicho de 05/10 renderam ~36 leads com os filtros do Caçador
(30 resultados do Places -> 2 a 10 leads por busca). Os ramos que renderam foram advocacia,
locação de equipamentos, construção/reformas/engenharia, controle de pragas e desentupidora;
contabilidade, usinagem e caldeiraria não renderam. Esta lista repete os cinco ramos que
renderam em cidades médias ainda sem busca, nos estados que mais procuram site (Google
Trends de 05/10: DF, SP, GO, SC, PR). Busca que já existe (mesma query, lat e lng) não entra
de novo; as novas entram ativas, no fim da aba Buscas, e o Caçador roda as nunca rodadas primeiro.

Uso: python3 site-buscas-ampliar.py --simular   mostra o que entraria, sem gravar
     python3 site-buscas-ampliar.py             acrescenta na aba Buscas
     python3 site-buscas-ampliar.py --testar    só a função pura, sem planilha
"""
import sys
import time

PLANILHA = "1ObvUtTTefAA9PoQocPWmiSMMkxJgoiG_TCR7tNEYu0o"  # "Leads — Site antes da venda"
COLUNAS = ["query", "lat", "lng", "raio_m", "vertical", "ativa", "ultima_rodada", "pausada_em", "pausa_motivo"]

# query, lat, lng, raio_m, vertical
BUSCAS = [
    # advocacia (a preferida do Caçador)
    ("advogado previdenciário", "-23.3045", "-51.1696", "8000", "advocacia"),   # Londrina
    ("advogado trabalhista", "-23.4205", "-51.9331", "8000", "advocacia"),      # Maringá
    ("advogado de família", "-27.5954", "-48.5480", "8000", "advocacia"),       # Florianópolis
    ("advogado", "-26.9194", "-49.0661", "8000", "advocacia"),                  # Blumenau
    ("advogado", "-22.9056", "-47.0608", "9000", "advocacia"),                  # Campinas
    ("advogado", "-16.3281", "-48.9534", "8000", "advocacia"),                  # Anápolis
    ("advogado previdenciário", "-25.0945", "-50.1633", "8000", "advocacia"),   # Ponta Grossa
    ("advogado", "-15.8330", "-48.0577", "9000", "advocacia"),                  # Taguatinga/DF
    # locação de equipamentos para obra
    ("locação de equipamentos para construção", "-22.9056", "-47.0608", "12000", "locação de equipamentos"),  # Campinas
    ("locação de equipamentos para construção", "-23.3045", "-51.1696", "12000", "locação de equipamentos"),  # Londrina
    ("locação de andaimes", "-27.5954", "-48.5480", "12000", "locação de equipamentos"),                       # Florianópolis
    ("locação de equipamentos para construção", "-18.9186", "-48.2772", "12000", "locação de equipamentos"),  # Uberlândia
    ("locação de andaimes", "-24.9578", "-53.4595", "12000", "locação de equipamentos"),                       # Cascavel
    # construção, reformas e engenharia
    ("empresa de reformas", "-22.9056", "-47.0608", "10000", "reformas"),       # Campinas
    ("empresa de reformas", "-23.3045", "-51.1696", "10000", "reformas"),       # Londrina
    ("empresa de reformas", "-16.6869", "-49.2648", "10000", "reformas"),       # Goiânia
    ("escritório de engenharia", "-16.6869", "-49.2648", "10000", "engenharia"),  # Goiânia
    ("construtora", "-27.5954", "-48.5480", "10000", "construção"),             # Florianópolis
    # controle de pragas
    ("dedetizadora", "-22.9056", "-47.0608", "12000", "dedetização"),           # Campinas
    ("dedetizadora", "-16.6869", "-49.2648", "12000", "dedetização"),           # Goiânia
    ("dedetizadora", "-23.3045", "-51.1696", "12000", "dedetização"),           # Londrina
    ("controle de pragas", "-23.4205", "-51.9331", "12000", "dedetização"),     # Maringá
    ("dedetizadora", "-27.5954", "-48.5480", "12000", "dedetização"),           # Florianópolis
    # desentupidora
    ("desentupidora", "-23.5015", "-47.4526", "12000", "desentupidora"),        # Sorocaba
    ("desentupidora", "-23.3045", "-51.1696", "12000", "desentupidora"),        # Londrina
    ("desentupidora", "-27.5954", "-48.5480", "12000", "desentupidora"),        # Florianópolis
    ("desentupidora", "-15.7939", "-47.8828", "12000", "desentupidora"),        # Brasília
    ("desentupidora", "-23.4205", "-51.9331", "12000", "desentupidora"),        # Maringá
    # Brasil todo (14/10/2026, pedido do Rômulo: "muito focado no ES, ir para o Brasil todo"):
    # os três ramos que renderam, nas capitais e polos que ainda não tinham busca, de todas as regiões.
    ("advogado", "-23.5505", "-46.6333", "10000", "advocacia"),                 # São Paulo
    ("advogado", "-22.9068", "-43.1729", "10000", "advocacia"),                 # Rio de Janeiro
    ("advogado", "-19.9167", "-43.9345", "10000", "advocacia"),                 # Belo Horizonte
    ("advogado", "-30.0346", "-51.2177", "10000", "advocacia"),                 # Porto Alegre
    ("advogado", "-12.9714", "-38.5014", "10000", "advocacia"),                 # Salvador
    ("advogado", "-3.7319", "-38.5267", "10000", "advocacia"),                  # Fortaleza
    ("advogado", "-8.0476", "-34.8770", "10000", "advocacia"),                  # Recife
    ("advogado", "-3.1190", "-60.0217", "10000", "advocacia"),                  # Manaus
    ("advogado", "-1.4558", "-48.4902", "10000", "advocacia"),                  # Belém
    ("advogado", "-20.4697", "-54.6201", "10000", "advocacia"),                 # Campo Grande
    ("advogado", "-15.6014", "-56.0979", "10000", "advocacia"),                 # Cuiabá
    ("advogado", "-5.7945", "-35.2110", "10000", "advocacia"),                  # Natal
    ("advogado", "-7.1195", "-34.8450", "10000", "advocacia"),                  # João Pessoa
    ("advogado", "-9.6498", "-35.7089", "10000", "advocacia"),                  # Maceió
    ("advogado", "-5.0892", "-42.8019", "10000", "advocacia"),                  # Teresina
    ("advogado", "-2.5307", "-44.3068", "10000", "advocacia"),                  # São Luís
    ("advogado", "-10.9472", "-37.0731", "10000", "advocacia"),                 # Aracaju
    ("advogado", "-8.7612", "-63.9004", "10000", "advocacia"),                  # Porto Velho
    ("advogado", "-10.1689", "-48.3317", "10000", "advocacia"),                 # Palmas
    ("dedetizadora", "-23.5505", "-46.6333", "12000", "dedetização"),           # São Paulo
    ("dedetizadora", "-22.9068", "-43.1729", "12000", "dedetização"),           # Rio de Janeiro
    ("dedetizadora", "-19.9167", "-43.9345", "12000", "dedetização"),           # Belo Horizonte
    ("dedetizadora", "-30.0346", "-51.2177", "12000", "dedetização"),           # Porto Alegre
    ("dedetizadora", "-12.9714", "-38.5014", "12000", "dedetização"),           # Salvador
    ("dedetizadora", "-3.7319", "-38.5267", "12000", "dedetização"),            # Fortaleza
    ("dedetizadora", "-8.0476", "-34.8770", "12000", "dedetização"),            # Recife
    ("dedetizadora", "-3.1190", "-60.0217", "12000", "dedetização"),            # Manaus
    ("dedetizadora", "-1.4558", "-48.4902", "12000", "dedetização"),            # Belém
    ("dedetizadora", "-20.4697", "-54.6201", "12000", "dedetização"),           # Campo Grande
    ("dedetizadora", "-15.6014", "-56.0979", "12000", "dedetização"),           # Cuiabá
    ("dedetizadora", "-5.7945", "-35.2110", "12000", "dedetização"),            # Natal
    ("dedetizadora", "-7.1195", "-34.8450", "12000", "dedetização"),            # João Pessoa
    ("dedetizadora", "-9.6498", "-35.7089", "12000", "dedetização"),            # Maceió
    ("dedetizadora", "-5.0892", "-42.8019", "12000", "dedetização"),            # Teresina
    ("dedetizadora", "-2.5307", "-44.3068", "12000", "dedetização"),            # São Luís
    ("dedetizadora", "-10.9472", "-37.0731", "12000", "dedetização"),           # Aracaju
    ("desentupidora", "-23.5505", "-46.6333", "12000", "desentupidora"),        # São Paulo
    ("desentupidora", "-22.9068", "-43.1729", "12000", "desentupidora"),        # Rio de Janeiro
    ("desentupidora", "-19.9167", "-43.9345", "12000", "desentupidora"),        # Belo Horizonte
    ("desentupidora", "-30.0346", "-51.2177", "12000", "desentupidora"),        # Porto Alegre
    ("desentupidora", "-12.9714", "-38.5014", "12000", "desentupidora"),        # Salvador
    ("desentupidora", "-3.7319", "-38.5267", "12000", "desentupidora"),         # Fortaleza
    ("desentupidora", "-8.0476", "-34.8770", "12000", "desentupidora"),         # Recife
    ("desentupidora", "-3.1190", "-60.0217", "12000", "desentupidora"),         # Manaus
    ("desentupidora", "-1.4558", "-48.4902", "12000", "desentupidora"),         # Belém
    ("desentupidora", "-20.4697", "-54.6201", "12000", "desentupidora"),        # Campo Grande
    ("desentupidora", "-15.6014", "-56.0979", "12000", "desentupidora"),        # Cuiabá
    ("desentupidora", "-5.7945", "-35.2110", "12000", "desentupidora"),         # Natal
    ("desentupidora", "-7.1195", "-34.8450", "12000", "desentupidora"),         # João Pessoa
    ("desentupidora", "-9.6498", "-35.7089", "12000", "desentupidora"),         # Maceió
]


def novas_buscas(valores: list[list[str]]) -> list[tuple]:
    """PURO: as buscas de BUSCAS que ainda não estão na aba (mesma query, lat e lng)."""
    cab = valores[0] if valores else COLUNAS
    existentes = set()
    for linha in valores[1:]:
        d = dict(zip(cab, list(linha) + [""] * (len(cab) - len(linha))))
        existentes.add((d.get("query", "").strip().lower(), d.get("lat", "").strip(), d.get("lng", "").strip()))
    return [b for b in BUSCAS if (b[0].lower(), b[1], b[2]) not in existentes]


def testar() -> int:
    import unittest

    class Casos(unittest.TestCase):
        def test_busca_que_ja_existe_nao_entra_de_novo(self):
            cab = COLUNAS
            ja = [cab, ["advogado previdenciário", "-23.3045", "-51.1696", "8000", "advocacia", "TRUE", "", "", ""]]
            novas = novas_buscas(ja)
            self.assertEqual(len(novas), len(BUSCAS) - 1)
            self.assertNotIn(("advogado previdenciário", "-23.3045", "-51.1696", "8000", "advocacia"), novas)

        def test_aba_vazia_traz_todas(self):
            self.assertEqual(len(novas_buscas([COLUNAS])), len(BUSCAS))

        def test_nenhuma_busca_repetida_na_propria_lista(self):
            chaves = [(b[0].lower(), b[1], b[2]) for b in BUSCAS]
            self.assertEqual(len(chaves), len(set(chaves)))

        def test_coordenadas_e_raio_legiveis(self):
            for q, lat, lng, raio, vertical in BUSCAS:
                self.assertTrue(-35 < float(lat) < 6 and -75 < float(lng) < -30, q)
                self.assertTrue(5000 <= int(raio) <= 20000, q)

    r = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(Casos))
    return 0 if r.wasSuccessful() else 1


def main() -> int:
    from sheets_proxy import SheetsProxy

    simular = "--simular" in sys.argv[1:]
    base = f"/v4/spreadsheets/{PLANILHA}"
    with SheetsProxy([PLANILHA]) as s:
        valores = s.get(f"{base}/values/Buscas!A1:Z1000").get("values", [])
        cab = valores[0]
        novas = novas_buscas(valores)
        print(f"{len(novas)} busca(s) nova(s) de {len(BUSCAS)} (a aba tem {len(valores) - 1})")
        for q, lat, lng, raio, vertical in novas:
            print(f"  {q}  [{vertical}]  {lat},{lng}  raio {raio}")
        if simular or not novas:
            return 0
        # Na ordem das colunas da aba, que pode ter coluna a mais no fim.
        linhas = [[dict(zip(COLUNAS, (*n, "TRUE", "", "", ""))).get(c, "") for c in cab] for n in novas]
        s.post(f"{base}/values/Buscas!A1:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS", {"values": linhas})
        print(f"gravadas {len(linhas)} linha(s) em {time.strftime('%Y-%m-%d %H:%M')}")
    return 0


if __name__ == "__main__":
    sys.exit(testar() if "--testar" in sys.argv[1:] else main())
