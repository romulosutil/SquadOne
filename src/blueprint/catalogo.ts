/**
 * PURO (16/10/2026): o catálogo do blueprint. Cada peça tem um código fixo (BP-…)
 * para a gente se referir a ela numa conversa sem ambiguidade: "o BP-ESCOLHAS está
 * alto demais no celular" diz qual componente, em que arquivo e sob que regra.
 * Código uma vez publicado não muda nem se reaproveita (o teste confere que são únicos).
 */

export interface PecaDoCatalogo {
  id: string
  nome: string
  /** A classe (ou o componente) que se usa no template. */
  classe: string
  /** Onde mora o estilo ou o componente. */
  onde: string
  /** A regra de uso, numa frase. */
  regra: string
}

export const CATALOGO: readonly PecaDoCatalogo[] = [
  { id: 'BP-BOTAO', nome: 'Botão', classe: '.botao, .botao--primario, .botao--leve, .botao--perigo', onde: 'estilos/agentes.css', regra: 'Uma primária por grupo. Link que age é .botao também (na Ficha, desde 16/10).' },
  { id: 'BP-SEGMENTADO', nome: 'Segmentado', classe: '.segmentado', onde: 'estilos/agentes.css', regra: 'Duas a quatro opções curtas, numa linha. Escolhido em --destaque, com aria-pressed.' },
  { id: 'BP-ESCOLHAS', nome: 'Escolhas', classe: '.escolhas', onde: 'estilos/agentes.css', regra: 'Como o segmentado, mas quebra linha: rótulo longo ou número variável de opções.' },
  { id: 'BP-SELO', nome: 'Selo', classe: '.selo, .selo--ok, .selo--atencao, .selo--erro, .selo--destaque', onde: 'estilos/agentes.css', regra: 'Uma ou duas palavras, em caixa alta. A cor só reforça a palavra.' },
  { id: 'BP-RECADO', nome: 'Recado', classe: '.recado, .recado--ok, .recado--atencao, .recado--erro', onde: 'estilos/agentes.css', regra: 'Uma frase de estado dentro de um bloco. Sempre diz o que fazer, não só o que houve.' },
  { id: 'BP-CAMPO', nome: 'Campo', classe: '.rotulo + .campo', onde: 'estilos/agentes.css', regra: '16 px de texto (o iOS não dá zoom). Rótulo em cima, em caixa normal.' },
  { id: 'BP-CARTAO', nome: 'Cartão de decisão', classe: '.cartao, .cartao--decisao, .cartao--ajuste, .cartao--falha', onde: 'estilos/agentes.css', regra: 'A faixa à esquerda diz o tipo. Dentro de bloco com sombra, o cartão não tem a sua.' },
  { id: 'BP-ESTADO', nome: 'Estado de agente', classe: '.estado.is-…', onde: 'estilos/agentes.css', regra: 'Ponto + palavra. Sem fonte é "Sem sinal", tracejado; nunca um estado inventado.' },
  { id: 'BP-DOBRA', nome: 'Dobra', classe: 'details.dobra', onde: 'estilos/agentes.css', regra: 'O que é consulta e não decisão fica dobrado, com o título e a contagem à vista.' },
  { id: 'BP-ETAPA', nome: 'Etapa do funil', classe: '.crm-etapa.is-…', onde: 'operations/crm.css', regra: 'Pastel fixo nos dois temas, texto sempre --sobre-pastel.' },
  { id: 'BP-SINAL', nome: 'Sinal do funil', classe: '.crm-sinal.is-…', onde: 'operations/crm.css', regra: 'Uma palavra sobre o lead (Resposta, Follow-up, Divergência). Tracejado = incerto.' },
  { id: 'BP-TRECHO', nome: 'Texto pronto', classe: '<CrmTrecho>', onde: 'operations/CrmTrecho.vue', regra: 'Copiar e Abrir no WhatsApp. Marcador por preencher fica realçado e escrito por extenso.' },
  { id: 'BP-FOLHA', nome: 'Folha', classe: '<Sheet>', onde: 'components/Sheet.vue', regra: 'Tudo que abre por cima. Título sempre, "Fechar" com texto, ação principal no rodapé.' },
  { id: 'BP-TABELA', nome: 'Tabela do desktop', classe: '.fin-tabela, .crm-tabela', onde: 'operations/financas/financas.css, operations/crm.css', regra: 'Só a partir de 64 rem; abaixo, a lista de sempre. Cabeçalho preso, zebra no lugar do divisor, número à direita, linha de 44 px, uma linha por item.' },
  { id: 'BP-FICHA', nome: 'Ficha do lead', classe: '<CrmFicha>', onde: 'operations/CrmFicha.vue', regra: 'Na ordem da decisão: o que disse → onde está → como responder → anotar → histórico.' },
]

/** A ordem da Ficha, bloco a bloco, com a pergunta que cada um responde. É o contrato da tela. */
export const ANATOMIA_DA_FICHA: ReadonlyArray<{ bloco: string; pergunta: string; visivel: 'sempre' | 'quando houver' | 'dobrado' }> = [
  { bloco: 'Cabeça', pergunta: 'Quem é, em que etapa, quanto tempo falta para sair dela?', visivel: 'sempre' },
  { bloco: 'Faixa fixa', pergunta: 'Qual é a ação de hoje? (presa no topo ao rolar)', visivel: 'quando houver' },
  { bloco: 'O que respondeu', pergunta: 'O que ele disse, e de que tipo foi?', visivel: 'quando houver' },
  { bloco: 'Jornada', pergunta: 'Em que passo está, o que fazer agora e o que oferecer?', visivel: 'sempre' },
  { bloco: 'Colinha', pergunta: 'Com que texto respondo? (uma variante por vez)', visivel: 'sempre' },
  { bloco: 'Ações', pergunta: 'Onde abro o resto (demo, Maps, planilha)?', visivel: 'sempre' },
  { bloco: 'Anotar', pergunta: 'O que fica registrado? (um formulário por vez)', visivel: 'sempre' },
  { bloco: 'Sobre o lead · Linha do tempo · Gerador', pergunta: 'Consulta: de onde veio, o que já aconteceu.', visivel: 'dobrado' },
]

/** Os princípios, cada um com código, para citar numa conversa. */
export const PRINCIPIOS: ReadonlyArray<{ id: string; titulo: string; texto: string }> = [
  { id: 'BP-P1', titulo: 'Celular primeiro', texto: '390 px, 16 px de margem, sem rolagem lateral, toque de 44 px. O desktop só ganha colunas.' },
  { id: 'BP-P2', titulo: 'Texto antes da cor', texto: 'Todo estado tem palavra. A cor só reforça; semáforo sempre com rótulo.' },
  { id: 'BP-P3', titulo: 'Força em ação, calma em leitura', texto: '3 px e sombra no que se toca e no bloco de tela; 2 px em cartão; 1 px entre linhas.' },
  { id: 'BP-P4', titulo: 'Uma decisão por vez', texto: 'Uma ação primária por grupo; variantes e formulários um de cada vez; consulta dobrada.' },
  { id: 'BP-P5', titulo: 'Só tokens', texto: 'Nada de cor, espaço, tamanho ou peso solto. O teste do blueprint barra o que foge da escala.' },
  { id: 'BP-P6', titulo: 'Escolhido é amarelo', texto: 'Seleção, aba atual e ação primária em --destaque. Hover é --hover, nunca cor de estado.' },
]
