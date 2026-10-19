// Nome da empresa como o dono escreve: sem Ltda/ME e fora da caixa alta ("CACAU PEÇAS PARA MOTORES" ->
// "Cacau Peças para Motores"; "roda mais distribuidora" -> "Roda Mais Distribuidora"). Nome todo em caixa alta
// ou todo em minúsculas denuncia mensagem automática.
// FONTE ÚNICA desta regra no n8n: prumo-simples.py (convite do PRUMO) e prumo-ofertas.py (convite do Iris e do
// CRM de estamparia) embutem este arquivo no nó "Decidir". O par em TypeScript é nomeDaEmpresa, em
// server/prumo-mensagem.ts (o CRM); server/prumo-nome-paridade.test.ts compara os dois numa tabela de casos.
// Mudou aqui: mude lá, rode o teste e republique os dois construtores.
function nomeDaEmpresa(bruto) {
  let nome = String(bruto ?? '').trim();
  for (let i = 0; i < 2; i++) nome = nome.replace(/[\s,.-]+(ltda|me|epp|eireli|s\.?\/?a\.?)\.?$/i, '').trim();
  if (nome === nome.toUpperCase() || nome === nome.toLowerCase()) {
    nome = nome.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_m, a, b) => a + b.toUpperCase())
      .replace(/ (D[aeo]s?|E|Para|Em) /g, (m) => m.toLowerCase());
  }
  return nome;
}
