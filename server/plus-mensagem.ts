// Mensagens do filtro Plus (15/10/2026): os leads do Catálogo de Negócios Maçônicos, abordados
// com a saudação da Ordem. Servem às quatro ofertas do funil; o que muda é só o pedido do meio.
//
// Mesmo guia dos textos do Site e do PRUMO (site-mensagem.js): "Oi" vira a saudação, quem fala é o
// Rômulo, nada de preço nem de link na primeira mensagem, uma pergunta só e a mesma saída fácil.
// A origem ("encontrei no Catálogo") vai na frente porque é o que dá motivo ao contato, e não se
// afirma nada que não aconteceu: nenhuma demonstração ou raio-x "já pronto" (eles saem depois do sim).
//
// PURO: sem relógio, env ou arquivo.

import { nomeDaEmpresa } from "./prumo-mensagem.ts";
import { artigoDe } from "./site-mensagem.ts";
import type { OfertaDoPlus } from "./plus-catalogo.ts";

/** A saudação que abre toda mensagem Plus. "Ir.'." é a abreviatura de Irmão e T.F.A., o Triplo Fraternal Abraço. */
export const SAUDACAO_MACONICA = "Meu Ir.'., sou o Rômulo, do Prumo";
export const DESPEDIDA_MACONICA = "T.F.A.";

const SAIDA_FACIL = "Se não for o momento, é só dizer.";

// Os moldes usam quatro formas do nome, para a frase fechar com o artigo certo:
//   {ORIGEM} "encontrei a Viaconta no Catálogo de Negócios Maçônicos"   {REF} "a Viaconta"
//   {DE}     "da Viaconta"                                              {POR} "pela Viaconta"
// Sem nome que se diga, viram "o seu negócio", "do seu negócio" e "pelo seu negócio".
export const PRIMEIRA_PLUS: Record<OfertaDoPlus, string> = {
  site:
    `${SAUDACAO_MACONICA} e {ORIGEM}. Trabalho com sites que apresentam os serviços da empresa e facilitam o contato pelo WhatsApp.\n\nPosso preparar uma demonstração independente de site {DE}, com informações públicas, para você avaliar sem compromisso?\n\n${SAIDA_FACIL}\n\n${DESPEDIDA_MACONICA}`,
  prumo:
    `${SAUDACAO_MACONICA} e {ORIGEM}. Trabalho com sites para empresas. Posso analisar como {REF} aparece no Google e te enviar uma página com o que facilita ou dificulta o contato dos clientes? A análise é gratuita.\n\n${SAIDA_FACIL}\n\n${DESPEDIDA_MACONICA}`,
  iris:
    `${SAUDACAO_MACONICA} e {ORIGEM}. O Iris organiza as anotações das sessões para apoiar a preparação dos relatórios de reavaliação.\n\nPosso te mostrar um exemplo com dados fictícios?\n\n${SAIDA_FACIL}\n\n${DESPEDIDA_MACONICA}`,
  estampa:
    `${SAUDACAO_MACONICA} e {ORIGEM}. Trabalho com um sistema de pedidos para estamparias que reúne arte, tamanhos e prazo em uma ficha para a produção.\n\nPosso te mostrar uma ficha de exemplo, sem dados de clientes?\n\n${SAIDA_FACIL}\n\n${DESPEDIDA_MACONICA}`,
};

// Follow-up do 3º dia: curto, sem repetir a oferta inteira; a saudação continua, porque é ela que faz o contato soar de quem é.
export const FOLLOWUP_PLUS: Record<OfertaDoPlus, string> = {
  site: `Meu Ir.'., é o Rômulo de novo. Sobre a demonstração de site {DE}: posso montar e te mandar o link? É sem compromisso. ${SAIDA_FACIL}\n\n${DESPEDIDA_MACONICA}`,
  prumo: `Meu Ir.'., é o Rômulo de novo. Posso te mandar o raio-x de como {REF} aparece no Google? É uma página só, sem compromisso. ${SAIDA_FACIL}\n\n${DESPEDIDA_MACONICA}`,
  iris: `Meu Ir.'., é o Rômulo de novo. Consegue me indicar quem coordena {REF}? Quero mostrar o dossiê da reavaliação do Iris em 20 minutos. ${SAIDA_FACIL}\n\n${DESPEDIDA_MACONICA}`,
  estampa: `Meu Ir.'., é o Rômulo de novo. Consegue me indicar o responsável {POR}? Quero mostrar a ficha de pedido em 20 minutos. ${SAIDA_FACIL}\n\n${DESPEDIDA_MACONICA}`,
};

export interface ReferenciasDaEmpresa {
  origem: string;
  ref: string;
  de: string;
  por: string;
}

/** Nome longo ou com título ("Advogado - Regularização de Imóveis…") não é um nome que se diga: vira "o seu negócio". */
export function referenciasDaEmpresa(empresa: string): ReferenciasDaEmpresa {
  const nome = nomeDaEmpresa(empresa);
  const generico = nome.length === 0 || nome.length > 40 || / [-–|] /.test(nome);
  if (generico) {
    return { origem: "encontrei o seu negócio no Catálogo de Negócios Maçônicos", ref: "o seu negócio", de: "do seu negócio", por: "pelo seu negócio" };
  }
  const artigo = artigoDe(nome);
  const feminino = artigo === "da";
  const ref = `${feminino ? "a" : "o"} ${nome}`;
  return { origem: `encontrei ${ref} no Catálogo de Negócios Maçônicos`, ref, de: `${artigo} ${nome}`, por: `${feminino ? "pela" : "pelo"} ${nome}` };
}

function preencher(molde: string, empresa: string): string {
  const { origem, ref, de, por } = referenciasDaEmpresa(empresa);
  return molde.split("{ORIGEM}").join(origem).split("{REF}").join(ref).split("{DE}").join(de).split("{POR}").join(por);
}

export interface MensagemPlus {
  texto: string;
  /** wa.me com o texto; vazio sem número do Brasil (55 + DDD + número). */
  link: string;
}

const montar = (whatsapp: string, texto: string): MensagemPlus => ({
  texto,
  link: /^55\d{10,11}$/.test(whatsapp) ? `https://wa.me/${whatsapp}?text=${encodeURIComponent(texto)}` : "",
});

export function primeiraDoPlus(lead: { empresa: string; oferta: OfertaDoPlus; whatsapp: string }): MensagemPlus {
  return montar(lead.whatsapp, preencher(PRIMEIRA_PLUS[lead.oferta], lead.empresa));
}

export function followupDoPlus(lead: { empresa: string; oferta: OfertaDoPlus; whatsapp: string }): MensagemPlus {
  return montar(lead.whatsapp, preencher(FOLLOWUP_PLUS[lead.oferta], lead.empresa));
}
