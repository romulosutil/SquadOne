// GERADO de deploy/dell/claude-ops/prumo-ofertas.json. Não editar.
// Mudou o JSON: npx tsx scripts/ofertas-gerar.ts (server/ofertas.test.ts falha se este arquivo ficar para trás).
// O que a oferta faz além destes campos (preço, ficha, textos do Plus) continua no código; ver server/ofertas.ts.

/** As ofertas próprias do PRUMO, na ordem do JSON. */
export const OFERTAS_PROPRIAS = ["iris", "estampa"] as const;
export type OfertaPropria = (typeof OFERTAS_PROPRIAS)[number];

export interface DadosDaOferta {
  /** Rótulo longo (Ficha, filtro do desktop, ROTULO_DO_PRODUTO). JSON: `rotulo`. */
  readonly rotulo: string;
  /** Rótulo curto, o mesmo no celular e no desktop (SIGLA_DO_PRODUTO). JSON: `sigla`. */
  readonly sigla: string;
  /** Só "propria" por enquanto: caminho curto, sem Raio-X nem Mapa, "combinar a demonstração". JSON: `tipo`. */
  readonly tipo: "propria";
  /** A aba da planilha do PRUMO de onde o CRM lê a oferta. JSON: `aba`. */
  readonly aba: string;
  /** O domínio (sala) da squad PRUMO no Escritório. JSON: `sala`. */
  readonly sala: `prumo--${string}`;
  /** Quem encontrou o lead, como a Ficha diz. JSON: `cacador_rotulo`. */
  readonly cacadorRotulo: string;
  /** O nome da fonte na tela (NOME_DA_FONTE). JSON: `fonte`. */
  readonly fonte: string;
  /** A chave do link da aba em CrmRetrato.links (o n8n 08 · CRM grava assim). JSON: `link_retrato`. */
  readonly linkRetrato: `planilha${string}`;
  /** O convite aprovado, com {OLA} e {NOME}. JSON: `mensagem`. */
  readonly mensagem: string;
}

export const OFERTA = {
  iris: {
    rotulo: "Iris · Clínicas",
    sigla: "Iris",
    tipo: "propria",
    aba: "Clínicas",
    sala: "prumo--iris",
    cacadorRotulo: "Encontrado pelo Caçador do Iris",
    fonte: "PRUMO — Clínicas (Iris)",
    linkRetrato: "planilhaIris",
    mensagem: "{OLA}! Sou o Rômulo, do Prumo. O Iris organiza as anotações das sessões para apoiar a preparação dos relatórios de reavaliação.\n\nPosso te mostrar um exemplo com dados fictícios para a equipe da {NOME}?",
  },
  estampa: {
    rotulo: "CRM de estamparia",
    sigla: "Estamparia",
    tipo: "propria",
    aba: "Estamparias",
    sala: "prumo--estamparias",
    cacadorRotulo: "Encontrado pelo Caçador de estamparias",
    fonte: "PRUMO — Estamparias (CRM de estamparia)",
    linkRetrato: "planilhaEstampa",
    mensagem: "{OLA}! Sou o Rômulo, do Prumo. Trabalho com um sistema de pedidos para estamparias que reúne arte, tamanhos e prazo em uma ficha para a produção.\n\nPosso te mostrar uma ficha de exemplo para a equipe da {NOME}, sem dados de clientes?",
  },
} as const satisfies Record<OfertaPropria, DadosDaOferta>;
