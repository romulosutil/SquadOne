import type { CrmLead } from '../operations/types'

/**
 * Lead inventado para a Ficha viva do blueprint (16/10/2026). Nome e telefone de
 * mentira, links para example.com: abrir não manda nada a ninguém, e a Ficha do
 * blueprint recebe o registro como indisponível, então nada é gravado na planilha.
 * Em contato, respondeu com interesse, com follow-up de hoje e uma divergência:
 * é o caso que mais enche a tela, para ver a ordem dos blocos sob carga.
 */
export const LEAD_DE_EXEMPLO: CrmLead = {
  id: 'site:exemplo',
  produto: 'site',
  chave: 'exemplo',
  empresa: 'Studio Exemplo Pilates',
  nicho: 'pilates',
  cidade: 'Guarapari',
  etapa: 'contato',
  sinal: 'respondeu',
  subEtapa: 'Respondeu com interesse',
  diasParaSair: 4,
  estadoNaPlanilha: 'enviado',
  diasNaEtapa: 3,
  diasDesdeUltimoEvento: 0,
  leitura: 'pela-resposta',
  marcos: { enviado: '2026-10-13T12:02:00-03:00', respondeu: '2026-10-16T09:40:00-03:00' },
  followupHoje: false,
  respostaNova: true,
  acervo: false,
  notas: 1,
  resposta: { tipo: 'interesse', trecho: 'Boa tarde, sim! Pode mandar o link.', em: '2026-10-16T09:40:00-03:00' },
  abordagem: { mensagem: 'A', site: 'v5' },
  eventos: [
    { tipo: 'enviado', rotulo: 'Primeira mensagem enviada', em: '2026-10-13T12:02:00-03:00', origem: 'automático', fonte: 'planilha' },
    { tipo: 'respondeu', rotulo: 'Respondeu', em: '2026-10-16T09:40:00-03:00', origem: 'automático', fonte: 'WhatsApp', texto: 'Boa tarde, sim! Pode mandar o link.' },
    { tipo: 'nota', rotulo: 'Nota', em: '2026-10-16T10:05:00-03:00', origem: 'manual', fonte: 'Central', texto: 'Dona do estúdio; prefere falar depois das 14h.' },
  ],
  links: {
    segunda: 'https://example.com/segunda',
    whatsapp: 'https://example.com/whatsapp',
    site: 'https://example.com/demo',
    maps: 'https://example.com/maps',
    acoes: 'https://example.com/acoes',
    planilha: 'https://example.com/planilha',
  },
  pasta: { lugar: 'publicados/', slug: 'studio-exemplo-pilates', artefatos: { conteudo: true, fotos: 6, capa: true, gerado: true, publicado: true, falha: false } },
  divergencias: [],
}
